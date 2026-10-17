import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCatalog } from "../scripts/lib/build-catalog.mjs";

test("buildCatalog writes language collections, indexes, and a checksum manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "open-hymns-test-"));
  try {
    const sourceRoot = path.join(root, "sources", "fixture-cis");
    await mkdir(path.join(sourceRoot, "v2", "english"), { recursive: true });
    await writeFile(
      path.join(sourceRoot, "v2", "english", "sample.json"),
      JSON.stringify([
        {
          number: 1,
          title: "Praise to the Lord",
          lyrics: [
            { type: "verse", index: 1, lines: ["Praise to the Lord", "The Almighty"] },
            { type: "refrain", lines: ["Alleluia"] }
          ]
        }
      ])
    );

    const registry = {
      version: "0.1.0",
      sources: [
        {
          id: "fixture-cis",
          repo: "fixture/cis",
          localPath: "sources/fixture-cis",
          license: "NOASSERTION",
          rightsStatus: "source-repository",
          publishable: false,
          adapters: [
            {
              type: "cis-v2",
              collectionId: "sample-en",
              name: "Sample Hymnal",
              language: "en",
              path: "v2/english/sample.json"
            }
          ]
        }
      ]
    };

    const result = await buildCatalog({
      rootDir: root,
      registry,
      outputDir: "data",
      release: true
    });

    assert.equal(result.collections.length, 1);
    assert.equal(result.manifest.version, "0.1.0");
    assert.equal(result.manifest.collections[0].id, "sample-en");
    assert.equal(result.manifest.collections[0].hymnCount, 1);
    assert.match(result.manifest.collections[0].sha256, /^[a-f0-9]{64}$/);

    const collection = JSON.parse(await readFile(path.join(root, "data", "collections", "en", "sample-en.json"), "utf8"));
    assert.match(collection.hymns[0].id, /^song-[a-f0-9]+$/);
    assert.equal(collection.hymns[0].references[0].id, "sample-en-001-praise-to-the-lord");
    assert.equal(collection.hymns[0].sections[1].type, "chorus");

    const titles = JSON.parse(await readFile(path.join(root, "data", "indexes", "titles.json"), "utf8"));
    const canonical = JSON.parse(await readFile(path.join(root, "data", "indexes", "canonical.json"), "utf8"));
    assert.equal(result.manifest.canonicalHymnCount, 1);
    assert.deepEqual(titles[0], {
      id: collection.hymns[0].id,
      canonicalId: canonical[0].id,
      collectionId: "sample-en",
      collectionIds: ["sample-en"],
      language: "en",
      number: "1",
      title: "Praise to the Lord",
      alternateTitles: [],
      references: collection.hymns[0].references
    });
    assert.equal(titles[0].canonicalId, titles[0].id);

    const releaseManifest = JSON.parse(await readFile(path.join(root, "releases", "v0.1.0", "manifest.json"), "utf8"));
    assert.equal(releaseManifest.collections[0].path, "collections/en/sample-en.json");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildCatalog discovers collection files from a directory adapter", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "open-hymns-directory-test-"));
  try {
    const sourceRoot = path.join(root, "sources", "fixture-cis");
    await mkdir(path.join(sourceRoot, "v2", "english"), { recursive: true });
    await writeFile(
      path.join(sourceRoot, "v2", "english", "sdah.json"),
      JSON.stringify([
        {
          number: 12,
          title: "Joyful Song",
          lyrics: [{ type: "verse", index: 1, lines: ["Joyful song"] }]
        }
      ])
    );

    const result = await buildCatalog({
      rootDir: root,
      registry: {
        version: "0.1.0",
        sources: [
          {
            id: "fixture-cis",
            repo: "fixture/cis",
            localPath: "sources/fixture-cis",
            license: "NOASSERTION",
            rightsStatus: "source-repository",
            publishable: false,
            adapters: [
              {
                type: "cis-v2-root",
                path: "v2",
                collectionIdPrefix: "cis",
                languageMap: { english: "en" }
              }
            ]
          }
        ]
      }
    });

    assert.equal(result.collections.length, 1);
    assert.equal(result.collections[0].id, "cis-sdah");
    assert.equal(result.collections[0].language, "en");
    assert.equal(result.collections[0].hymnCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildCatalog imports object-based lyric sections from open-hymnal-json sources", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "open-hymns-open-hymnal-test-"));
  try {
    await mkdir(path.join(root, "sources", "fixture-open-hymnal"), { recursive: true });
    await writeFile(
      path.join(root, "sources", "fixture-open-hymnal", "hymns.json"),
      JSON.stringify([
        {
          number: 92,
          title: "Amazing Grace!",
          lyrics: [
            {
              verse: 1,
              type: "verse",
              content: "Amazing grace! how sweet the sound\nThat saved a wretch like me"
            }
          ]
        }
      ])
    );

    const result = await buildCatalog({
      rootDir: root,
      registry: {
        version: "0.1.0",
        sources: [
          {
            id: "fixture-open-hymnal",
            repo: "fixture/open-hymnal",
            localPath: "sources/fixture-open-hymnal",
            license: "MIT",
            rightsStatus: "repo-license",
            publishable: true,
            adapters: [
              {
                type: "open-hymnal-json",
                collectionId: "watchman-en",
                name: "Watchman Hymns",
                language: "en",
                path: "hymns.json"
              }
            ]
          }
        ]
      }
    });

    assert.equal(result.manifest.collectionCount, 1);
    assert.equal(result.manifest.hymnCount, 1);
    assert.equal(result.manifest.collections[0].id, "watchman-en");

    const collection = JSON.parse(await readFile(path.join(root, "data", "collections", "en", "watchman-en.json"), "utf8"));
    assert.equal(collection.hymns[0].sections[0].lines[0], "Amazing grace! how sweet the sound");
    assert.equal(collection.hymns[0].searchText.includes("[object Object]"), false);

    const search = JSON.parse(await readFile(path.join(root, "data", "indexes", "search.json"), "utf8"));
    assert.equal(search[0].title, "Amazing Grace!");
    assert.equal(search[0].searchText.includes("that saved a wretch like me"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
