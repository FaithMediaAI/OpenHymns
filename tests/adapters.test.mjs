import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCatalog } from "../scripts/lib/build-catalog.mjs";

async function writeJson(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value));
}

test("adapters preserve catalog numbers, recover lyric titles, map indexed languages, and parse stanza labels", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "open-hymns-adapters-test-"));
  try {
    await writeJson(root, "sources/flow/hymn-bundle/metadata.json", [
      { filename: "songs.json", name: "Fixture Songs", fullName: "Fixture Hymnal", abbr: "FX" }
    ]);
    await writeJson(root, "sources/flow/hymn-bundle/songs.json", [
      {
        id: "hymn_internal_7788",
        title: "A Known Hymn",
        author: "Ada Writer",
        verses: ["First verse"],
        chorus: "Refrain line",
        metadata: { number: 27 },
        tune: "Known Tune",
        meter: "8.8.8.8"
      },
      {
        id: "hymn_internal_7789",
        title: "6.6.6.",
        verses: ["6.6.6.\nPsalm 61:1", "Hear my cry, O God"],
        metadata: { number: 28 }
      },
      {
        id: "hymn_internal_7790",
        title: "11.11.11. & Ref.",
        verses: ["11.11.11. & Ref.", "Lord, hear our prayer"],
        metadata: { number: 29 }
      },
      {
        id: "hymn_internal_7791",
        title: "C M",
        verses: ["C M\nScripture epigraph", "Opening lyric"],
        metadata: { number: 30 }
      }
    ]);
    await writeJson(root, "sources/malayalam/data/lyrics/mal/0000001.json", {
      id: 1,
      author: "KVS",
      starts: "chorus",
      chorus: ["വാഴ്ത്തുക നീ മനമേ എൻ പരനെ", "വാഴ്ത്തുക നീ മനമേ"],
      verses: [["വാഴ്ത്തുക തൻ ശുദ്ധനാമത്തെ പേർത്തു", "പാർത്ഥിവൻ തന്നുപകാരത്തെയോർത്തു"]]
    });
    await writeJson(root, "sources/sounders/index.json", {
      hymnals: [
        { shortname: "NZK", longName: "Nyimbo za Kristo", Language: "KISWAHILI", path: "NZK" },
        { shortname: "WNY", longName: "Wende Nyasaye", Language: "LUO", path: "WNY" },
        { shortname: "SDAH", longName: "Fixture SDA Hymnal", Language: "ENGLISH", path: "SDAH" }
      ]
    });
    for (const [book, title] of [["NZK", "Swahili Song"], ["WNY", "Luo Song"]]) {
      await writeJson(root, `sources/sounders/${book}/index.json`, {
        songs: {
          1: { id: 1, title, stanzas: { 1: "Song line" }, choruses: {} },
          2: { id: 2, title: "", stanzas: {}, choruses: {} },
          3: { id: "", title: "", stanzas: {}, choruses: {} }
        }
      });
    }
    await writeJson(root, "sources/sounders/SDAH/index.json", {
      songs: {
        19: {
          id: 20,
          title: "20 O Praise Ye the Lord",
          stanzas: { 1: "O praise ye the Lord! Praise Him in the height; Rejoice in His word." },
          choruses: {}
        },
        20: { id: 21, title: "21", stanzas: { 1: "A separate hymn without a title prefix." }, choruses: {} }
      }
    });
    await writeJson(root, "sources/french/hymns.json", [
      {
        number: "8",
        title: "Hymne de test",
        lyrics: "1.\nPremière ligne\nDeuxième ligne\n\n2.\nAutre ligne\n\nRefrain\nChantez ensemble\n\n10000 reasons to sing\nAnd worship together"
      }
    ]);
    await writeJson(root, "sources/open/hymns.json", [
      { number: 9, title: "Category Hymn", category: "Praise", lyrics: [{ verse: 1, content: "Praise line" }] }
    ]);
    await writeJson(root, "sources/cis/v2/config.json", [
      { key: "english", title: "Christ in Song", language: "English" },
      { key: "sdah", title: "SDA Hymnal", language: "English" },
      { key: "xhosa", title: "IsiXhosa Hymnal", language: "IsiXhosa" },
      { key: "tumbuka", title: "Tumbuka Hymnal", language: "Tumbuka" }
    ]);
    await writeJson(root, "sources/cis/v2/english/sdah.json", [
      { number: 1, title: "SDA Sample", lyrics: [{ type: "verse", lines: ["SDA line"] }] }
    ]);
    await writeJson(root, "sources/cis/v2/isiXhosa/xhosa.json", [
      { number: 1, title: "Molo", lyrics: [{ type: "verse", lines: ["Molo line"] }] }
    ]);
    await writeJson(root, "sources/cis/v2/tumbuka/tumbuka.json", [
      { index: "051", number: 51, title: "", lyrics: [{ type: "verse", index: 51, lines: ["### 51"] }] }
    ]);

    const { collections, warnings } = await buildCatalog({
      rootDir: root,
      registry: {
        version: "0.1.0",
        sources: [
          {
            id: "flow", repo: "fixture/flow", localPath: "sources/flow", adapters: [
              { type: "hymnflow-root", path: "hymn-bundle", languageMap: { "songs.json": "en" } }
            ]
          },
          {
            id: "malayalam", repo: "fixture/malayalam", localPath: "sources/malayalam", adapters: [
              { type: "yozachar-directory", collectionId: "malayalam-ml", name: "Malayalam", language: "ml", path: "data/lyrics/mal" }
            ]
          },
          {
            id: "sounders", repo: "fixture/sounders", localPath: "sources/sounders", adapters: [
              { type: "gospel-sounders-index", path: "index.json", languageMap: { ENGLISH: "en", KISWAHILI: "sw", LUO: "luo" } }
            ]
          },
          {
            id: "french", repo: "fixture/french", localPath: "sources/french", adapters: [
              { type: "french-sda", collectionId: "french", name: "French", language: "fr", path: "hymns.json" }
            ]
          },
          {
            id: "open", repo: "fixture/open", localPath: "sources/open", adapters: [
              { type: "open-hymnal-json", collectionId: "open", name: "Open", language: "en", path: "hymns.json" }
            ]
          },
          {
            id: "cis", repo: "fixture/cis", localPath: "sources/cis", adapters: [
              { type: "cis-v2-root", path: "v2", collectionIdPrefix: "cis", languageMap: { english: "en", sdah: "en", xhosa: "xh", tumbuka: "tum" } }
            ]
          }
        ]
      }
    });

    const hymn = (collectionId) => collections.find((collection) => collection.id === collectionId).hymns[0];
    const flowCollection = collections.find((collection) => collection.id === "fx");
    assert.equal(flowCollection.hymns[0].number, "27");
    assert.equal(flowCollection.hymns[0].authors[0], "Ada Writer");
    assert.equal(flowCollection.hymns[0].tune, "Known Tune");
    const repairedMeterTitle = flowCollection.hymns.find((record) => record.number === "28");
    assert.equal(repairedMeterTitle.title, "Hear my cry, O God");
    assert.equal(repairedMeterTitle.meter, "6.6.6.");
    assert.equal(repairedMeterTitle.sourceTitle, "6.6.6.");
    assert.equal(repairedMeterTitle.titleSource, "first-line");
    assert.equal(repairedMeterTitle.sections[0].lines[0], "Psalm 61:1");
    const repairedRefrainMeter = flowCollection.hymns.find((record) => record.number === "29");
    assert.equal(repairedRefrainMeter.title, "Lord, hear our prayer");
    assert.equal(repairedRefrainMeter.meter, "11.11.11. & Ref.");
    assert.equal(repairedRefrainMeter.sourceTitle, "11.11.11. & Ref.");
    const repairedCommonMeter = flowCollection.hymns.find((record) => record.number === "30");
    assert.equal(repairedCommonMeter.title, "Opening lyric");
    assert.equal(repairedCommonMeter.meter, "C M");
    assert.equal(repairedCommonMeter.sections[0].lines[0], "Scripture epigraph");
    assert.equal(hymn("malayalam-ml").title, "വാഴ്ത്തുക നീ മനമേ എൻ പരനെ");
    assert.equal(hymn("malayalam-ml").titleSource, "first-line");
    assert.equal(collections.find((collection) => collection.id === "nzk").language, "sw");
    assert.equal(collections.find((collection) => collection.id === "wny").language, "luo");
    assert.equal(collections.find((collection) => collection.id === "nzk").hymnCount, 1);
    const sdahCollection = collections.find((collection) => collection.id === "sdah");
    const repairedNumberedTitle = sdahCollection.hymns.find((record) => record.number === "20");
    assert.equal(repairedNumberedTitle.title, "O Praise Ye the Lord");
    assert.equal(repairedNumberedTitle.sourceTitle, "20 O Praise Ye the Lord");
    assert.equal(repairedNumberedTitle.titleSource, "number-prefix-removed");
    assert.equal(repairedNumberedTitle.source.path, "SDAH/index.json#songs.19");
    assert.equal(sdahCollection.hymns.find((record) => record.number === "21").title, "21");
    assert.ok(warnings.some((warning) => warning.message.includes("identified hymn stub")));
    assert.ok(warnings.some((warning) => warning.message.includes("empty song-index placeholder")));
    assert.ok(warnings.some((warning) => warning.code === "empty-placeholder"));
    assert.deepEqual(hymn("french").sections.map(({ label, lines }) => [label, lines[0]]), [
      ["1", "Première ligne"],
      ["2", "Autre ligne"],
      ["Refrain", "Chantez ensemble"],
      ["4", "10000 reasons to sing"]
    ]);
    assert.deepEqual(hymn("open").topics, ["Praise"]);
    const cisCollection = collections.find((collection) => collection.id === "cis-xhosa");
    assert.equal(cisCollection.name, "IsiXhosa Hymnal");
    assert.equal(cisCollection.language, "xh");
    assert.equal(collections.find((collection) => collection.id === "cis-sdah").name, "SDA Hymnal");
    const quarantine = JSON.parse(await readFile(path.join(root, "data", "quarantine.json"), "utf8"));
    assert.equal(quarantine.find((record) => record.collectionId === "cis-tumbuka").sections.length, 0);
    assert.ok(warnings.some((warning) => warning.message.includes("no usable lyric text")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
