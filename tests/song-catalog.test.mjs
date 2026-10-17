import assert from "node:assert/strict";
import test from "node:test";
import { buildSongCatalog } from "../scripts/lib/song-catalog.mjs";

const stanzaA = "Morning sunlight fills the valley as the patient workers gather near the river bringing baskets full of flowers for the waiting children";
const stanzaB = "Evening shadows cross the garden while the distant bells are ringing and the weary travelers find a welcome table in the village";
const refrain = "Sing together as we journey onward sharing all the hope we carry";
const section = (type, text) => ({ type, label: "1", lines: [text] });
function hymn(id, overrides = {}) {
  return {
    schemaVersion: 1, id, collectionId: id, language: "en", number: "1",
    title: "Across the Valley", sections: [section("verse", stanzaA)], searchText: "fixture",
    source: { repo: `fixture/${id}`, path: "songs.json", license: "MIT", rightsStatus: "repo-license" },
    ...overrides
  };
}

test("one song combines hymnbook copies, punctuation, shorter verse selections, and repeated choruses", () => {
  const complete = hymn("complete", { sections: [section("verse", stanzaA), section("chorus", refrain), section("verse", stanzaB), section("chorus", refrain)] });
  const short = hymn("short", { title: "ACROSS THE VALLEY!", number: "89", sections: [section("verse", stanzaA.replace("sunlight", "sunshine")), section("chorus", refrain)] });
  const result = buildSongCatalog([short, complete]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].collectionId, "complete");
  assert.deepEqual(result.records[0].collectionIds, ["complete", "short"]);
  assert.equal(result.records[0].references.length, 2);
  assert.equal(result.report.duplicateReferenceCount, 1);
});

test("shared title and refrain do not combine unrelated verse text", () => {
  const first = hymn("first", { sections: [section("verse", stanzaA), section("chorus", refrain)] });
  const second = hymn("second", { sections: [section("verse", stanzaB), section("chorus", refrain)] });
  assert.equal(buildSongCatalog([first, second]).records.length, 2);
});

test("a complete same-titled edition connects editions selecting different verses", () => {
  const rows = [
    hymn("first", { sections: [section("verse", stanzaA)] }),
    hymn("complete", { sections: [section("verse", stanzaA), section("verse", stanzaB)] }),
    hymn("second", { sections: [section("verse", stanzaB)] })
  ];
  const result = buildSongCatalog(rows);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].references.length, 3);
  assert.equal(result.records[0].collectionId, "complete");
});

test("a medley does not bridge separate songs with different titles", () => {
  const rows = [
    hymn("first", { title: "Morning across the valley", sections: [section("verse", stanzaA)] }),
    hymn("medley", { title: "Morning and evening medley", sections: [section("verse", stanzaA), section("verse", stanzaB)] }),
    hymn("second", { title: "Evening in the village", sections: [section("verse", stanzaB)] })
  ];
  assert.equal(buildSongCatalog(rows).records.length, 3);
});

test("common multiword titles combine with strong verse evidence while distinct songs remain", () => {
  const rows = [
    hymn("first", { title: "Holy Holy Holy", sections: [section("verse", stanzaA), section("verse", stanzaB)] }),
    hymn("short", { title: "Holy, holy, holy!", sections: [section("verse", stanzaA)] }),
    hymn("different", { title: "Holy Holy Holy", sections: [section("verse", "Golden lanterns mark the harbor where the quiet ships are resting under silver clouds beside the ancient palace walls")] })
  ];
  const result = buildSongCatalog(rows);
  assert.equal(result.records.length, 2);
  assert(result.records.some((song) => song.references.length === 2));
});

test("even short exact lyric copies have one song identity", () => {
  const result = buildSongCatalog([hymn("a", { title: "Amen", sections: [section("verse", "Amen.")] }), hymn("b", { title: "Amen", sections: [section("verse", "AMEN!")] })]);
  assert.equal(result.records.length, 1);
});

test("translations and significant Unicode combining marks stay distinct", () => {
  assert.equal(buildSongCatalog([hymn("en"), hymn("fr", { language: "fr" })]).records.length, 2);
  const result = buildSongCatalog([
    hymn("ml-a", { language: "ml", title: "ആദ്യം", sections: [section("verse", "കി")] }),
    hymn("ml-b", { language: "ml", title: "ആദ്യം", sections: [section("verse", "കു")] })
  ]);
  assert.equal(result.records.length, 2);
});

test("different tunes and all source metadata remain references on one song", () => {
  const result = buildSongCatalog([
    hymn("a", { tune: "First Tune", authors: ["First Writer"], topics: ["Hope"] }),
    hymn("b", { tune: "Second Tune", authors: ["Second Writer"], titleSource: "first-line", sourceTitle: "1" })
  ]);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].references.map((reference) => reference.tune).sort(), ["First Tune", "Second Tune"]);
  assert.deepEqual(result.records[0].references.find((reference) => reference.id === "a").topics, ["Hope"]);
  assert.equal(result.records[0].references.find((reference) => reference.id === "b").sourceTitle, "1");
});

test("a scripture epigraph is not counted as an extra verse when choosing a complete copy", () => {
  const clean = hymn("clean", { sections: [{ ...section("verse", stanzaA), label: "1" }, { ...section("verse", stanzaB), label: "2" }] });
  const epigraph = hymn("epigraph", {
    titleSource: "first-line", sourceTitle: "6.6.6.", meter: "6.6.6.",
    sections: [
      { ...section("verse", "An extended scripture epigraph placed here for the reference and introduction to the following text"), label: "1" },
      { ...section("verse", stanzaA), label: "2" },
      { ...section("verse", stanzaB), label: "3" }
    ]
  });
  const result = buildSongCatalog([epigraph, clean]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].collectionId, "clean");
});

test("song grouping, selected lyrics, IDs and references do not depend on source order", () => {
  const rows = [hymn("a"), hymn("b", { sections: [section("verse", stanzaA), section("verse", stanzaB)] }), hymn("c", { language: "fr" })];
  assert.deepEqual(buildSongCatalog(rows), buildSongCatalog(rows.toReversed()));
});
