import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateCatalog } from "../scripts/lib/validate-catalog.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const writeJson = async (root, relative, value) => {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text);
  return { path: relative, sha256: sha256(text) };
};

async function makeOneSongCatalog(root) {
  const sourceA = { repo: "fixture/repo-a", path: "a.json#1", license: "MIT", rightsStatus: "repo-license" };
  const sourceB = { repo: "fixture/repo-b", path: "b.json#7", license: "MIT", rightsStatus: "repo-license" };
  const references = [
    { id: "book-a-001-come-to-jesus", collectionId: "book-a", language: "en", number: "1", title: "Come to Jesus", authors: ["A. Writer"], source: sourceA },
    { id: "book-b-007-come-unto-jesus", collectionId: "book-b", language: "en", number: "7", title: "Come unto Jesus", authors: ["A. Writer"], tune: "Mercy", source: sourceB }
  ];
  const song = {
    schemaVersion: 1,
    id: "song-0123456789abcdefabcd",
    canonicalId: "song-0123456789abcdefabcd",
    collectionId: "book-a",
    collectionIds: ["book-a", "book-b"],
    alternateTitles: ["Come unto Jesus"],
    language: "en",
    number: "1",
    title: "Come to Jesus",
    authors: ["A. Writer"],
    sections: [
      { type: "verse", label: "1", lines: ["Come to Jesus, weary one", "Come and rest today"] },
      { type: "verse", label: "2", lines: ["Leave your heavy burden", "Walk with him always"] }
    ],
    searchText: "",
    source: sourceA,
    references
  };
  song.searchText = [
    song.title, song.number, ...song.authors, song.tune, song.meter, ...(song.topics ?? []),
    ...song.sections.flatMap((section) => section.lines), ...song.alternateTitles,
    ...references.flatMap((reference) => [reference.title, reference.number, ...(reference.authors ?? []), reference.tune, reference.meter, ...(reference.topics ?? [])])
  ].filter(Boolean).join(" ").normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
  const canonical = { ...song, sections: structuredClone(song.sections), references: structuredClone(references) };

  const collectionEntries = [];
  for (const [id, name, hymnRows, sourceHymnCount, membershipCount] of [
    ["book-a", "Book A", [song], 1, 1],
    ["book-b", "Book B", [], 1, 1]
  ]) {
    const collection = {
      schemaVersion: 1, id, name, language: "en", version: "test",
      hymnCount: hymnRows.length, sourceHymnCount, membershipCount, hymns: hymnRows
    };
    const checksum = await writeJson(root, `collections/en/${id}.json`, collection);
    collectionEntries.push({ id, name, language: "en", hymnCount: hymnRows.length, sourceHymnCount, membershipCount, ...checksum });
  }

  const titles = [{ id: song.id, canonicalId: song.id, collectionId: song.collectionId, collectionIds: song.collectionIds, language: song.language, number: song.number, title: song.title, alternateTitles: song.alternateTitles, references: song.references }];
  const search = [{ ...titles[0], searchText: song.searchText }];
  const languages = [{ language: "en", collectionCount: 2, hymnCount: 1, sourceHymnCount: 2 }];
  const canonicalIndex = [canonical];
  const indexes = [];
  for (const [id, rows] of [["titles", titles], ["search", search], ["languages", languages], ["canonical", canonicalIndex]]) {
    indexes.push({ id, recordCount: rows.length, ...(await writeJson(root, `indexes/${id}.json`, rows)) });
  }
  const quarantine = [];
  const quarantineEntry = { recordCount: 0, ...(await writeJson(root, "quarantine.json", quarantine)) };
  const qualityReport = {
    summary: {
      hymnCount: 1, canonicalHymnCount: 1, sourceHymnCount: 2,
      groupedDuplicateReferenceCount: 1, removedDuplicateCount: 0,
      importedRecordCount: 2, skippedPlaceholderCount: 0, sourceRecordCount: 2,
      quarantinedRecordCount: 0, activeMissingLyricsCount: 0
    }
  };
  const qualityReportEntry = await writeJson(root, "quality-report.json", qualityReport);
  await writeJson(root, "manifest.json", {
    schemaVersion: 1, version: "test", generatedAt: "test", catalogMode: "one-song-per-language",
    collectionCount: 2, hymnCount: 1, canonicalHymnCount: 1, sourceHymnCount: 2,
    collections: collectionEntries, indexes,
    quarantine: quarantineEntry, qualityReport: qualityReportEntry
  });
}

test("one-song catalog has one primary/search/title/canonical row with every source reference", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "open-hymns-one-song-"));
  try {
    await makeOneSongCatalog(root);
    const result = await validateCatalog(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.counts.hymns, 1);
    assert.equal(result.counts.sourceHymns, 2);
    assert.equal(result.documents.get("indexes/search.json").length, 1);
    assert.equal(result.documents.get("indexes/titles.json").length, 1);
    assert.equal(result.documents.get("indexes/canonical.json")[0].references.length, 2);
    assert(result.documents.get("indexes/search.json")[0].searchText.includes("come unto jesus"));
    assert(result.documents.get("indexes/search.json")[0].searchText.includes("mercy"));
    assert.equal(result.documents.get("collections/en/book-a.json").hymns.length, 1);
    assert.equal(result.documents.get("collections/en/book-b.json").hymns.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validator rejects duplicate search rows and repeated or orphaned source references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "open-hymns-one-song-invalid-"));
  try {
    await makeOneSongCatalog(root);
    const searchPath = path.join(root, "indexes/search.json");
    const search = JSON.parse(await readFile(searchPath, "utf8"));
    search.push({ ...search[0] });
    const searchChecksum = await writeJson(root, "indexes/search.json", search);

    const manifestPath = path.join(root, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.indexes.find((entry) => entry.id === "search").sha256 = searchChecksum.sha256;
    await writeJson(root, "manifest.json", manifest);

    const result = await validateCatalog(root);
    assert(result.errors.some((error) => error.includes("Index search: count mismatch")));
    assert(result.errors.some((error) => error.includes("duplicate or invalid song row")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validator requires provenance and quarantine accounting fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "open-hymns-one-song-contract-"));
  try {
    await makeOneSongCatalog(root);
    const manifestPath = path.join(root, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.quarantine;
    delete manifest.sourceHymnCount;
    await writeJson(root, "manifest.json", manifest);
    const result = await validateCatalog(root);
    assert(result.errors.some((error) => error.includes("Missing manifest field: quarantine")));
    assert(result.errors.some((error) => error.includes("Missing manifest field: sourceHymnCount")));
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
