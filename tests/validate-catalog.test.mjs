import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCatalog } from "../scripts/lib/build-catalog.mjs";
import { validateCatalog } from "../scripts/lib/validate-catalog.mjs";

test("published feed validates; canonical duplicates and broken provenance fail independently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "open-hymns-validation-"));
  try {
    await mkdir(path.join(root, "sources", "fixture"), { recursive: true });
    await writeFile(path.join(root, "sources", "fixture", "songs.json"), JSON.stringify([
      { number: 1, title: "Shared Song", verses: [["Sing with joy", "Praise today"]] },
      { number: 2, title: "Alternate Number", verses: [["Sing with joy Praise today"]] },
      { number: 3, title: "Known Stub", verses: [] }
    ]));
    await buildCatalog({ rootDir: root, registry: { version: "test", sources: [{ id: "fixture", repo: "fixture/repo", localPath: "sources/fixture", adapters: [{ type: "josmithua-song-data", path: "songs.json", collectionId: "fixture", name: "Fixture", language: "en" }] }] } });
    const feed = path.join(root, "data");
    const result = await validateCatalog(feed);
    assert.deepEqual(result.errors, []);
    assert.equal(result.counts.hymns, 2);
    assert.equal(result.counts.quarantined, 1);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].type, "missing-lyrics");
    const manifestPath = path.join(feed, "manifest.json");
    const originalManifestText = await readFile(manifestPath, "utf8");
    const missingQuarantine = JSON.parse(originalManifestText);
    delete missingQuarantine.quarantine;
    await writeFile(manifestPath, JSON.stringify(missingQuarantine));
    const orphaned = await validateCatalog(feed);
    assert(orphaned.errors.some((error) => error.includes("Missing manifest field: quarantine")));
    await writeFile(manifestPath, originalManifestText);
    const canonicalPath = path.join(feed, "indexes", "canonical.json");
    const canonical = JSON.parse(await readFile(canonicalPath, "utf8"));
    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].references.length, 2);
    canonical.push({ ...canonical[0], id: "corrupt-duplicate" });
    canonical[0].references[0].source.repo = "wrong/repo";
    await writeFile(canonicalPath, JSON.stringify(canonical));
    const corrupted = await validateCatalog(feed);
    assert(corrupted.errors.some((error) => error.includes("Checksum mismatch")));
    assert(corrupted.errors.some((error) => error.includes("duplicate lyrics")));
    assert(corrupted.errors.some((error) => error.includes("invalid source reference")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("published feed validator rejects paths outside the catalog", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "open-hymns-validation-paths-"));
  try {
    await writeFile(path.join(root, "manifest.json"), JSON.stringify({ collections: [{ id: "bad", path: "../outside.json" }], indexes: [] }));
    const result = await validateCatalog(root);
    assert(result.errors.some((error) => error.includes("Unsafe feed path")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
