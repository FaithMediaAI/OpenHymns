import test from "node:test";
import assert from "node:assert/strict";

import { buildCanonicalCatalog, cleanCollection } from "../scripts/lib/catalog-quality.mjs";

function hymn(overrides = {}) {
  return {
    id: "collection-001-song",
    collectionId: "collection",
    language: "en",
    number: "1",
    title: "Song",
    sections: [{ type: "verse", label: "1", lines: ["A line", "Second line"] }],
    source: { repo: "example/hymns", path: "songs.json", license: "CC0", rightsStatus: "public-domain" },
    ...overrides
  };
}

test("cleanCollection removes only an exact same-number/title/lyrics/metadata duplicate", () => {
  const first = hymn();
  const duplicate = hymn({ id: "duplicate-id" });
  const { hymns, report } = cleanCollection([first, duplicate]);

  assert.equal(hymns.length, 1);
  assert.equal(report.removedCount, 1);
  assert.equal(report.removed[0].removed.id, "duplicate-id");
});

test("cleanCollection preserves otherwise identical records with different provenance", () => {
  const first = hymn();
  const otherSource = hymn({
    id: "same-source-entry",
    source: { repo: "other/repo", path: "other.json", license: "CC-BY", rightsStatus: "licensed" }
  });
  const { hymns, report } = cleanCollection([first, otherSource]);

  assert.equal(hymns.length, 2);
  assert.equal(report.removedCount, 0);
});

test("cleanCollection keeps unmodeled source metadata that differs", () => {
  const first = hymn({ titleSource: "source-title" });
  const inferred = hymn({ id: "inferred", titleSource: "first-line" });
  const { hymns, report } = cleanCollection([first, inferred]);

  assert.equal(hymns.length, 2);
  assert.equal(report.removedCount, 0);
});

test("same lyrics with distinct numbers, titles, tunes, or section layout remain separate", () => {
  const base = hymn();
  const cases = [
    hymn({ number: "2" }),
    hymn({ title: "A different title" }),
    hymn({ tune: "Different tune" }),
    hymn({ sections: [{ type: "chorus", label: "Refrain", lines: ["A line", "Second line"] }] })
  ];
  const { hymns, report } = cleanCollection([base, ...cases]);

  assert.equal(hymns.length, 5);
  assert.equal(report.removedCount, 0);
  assert.ok(report.ambiguous.some((item) => item.reason === "same-lyrics-different-title"));
});

test("canonical catalog groups exact lyrics by language and preserves every source reference", () => {
  const first = hymn();
  const crossCollection = hymn({
    id: "other-007-song",
    collectionId: "other",
    number: "7",
    source: { repo: "another/repo", path: "other.json", license: "CC-BY", rightsStatus: "licensed" },
    sections: [{ type: "verse", label: "I", lines: [" A   LINE ", "Second line"] }]
  });
  const translated = hymn({ id: "fr-001-chanson", collectionId: "french", language: "fr" });
  const { records, report } = buildCanonicalCatalog([first, crossCollection, translated]);

  assert.equal(records.length, 2);
  const english = records.find((record) => record.language === "en");
  assert.equal(english.references.length, 2);
  assert.deepEqual(english.references.map((item) => item.number), ["1", "7"]);
  assert.deepEqual(english.references.map((item) => item.source.license), ["CC0", "CC-BY"]);
  assert.equal(report.duplicateGroupCount, 1);
  assert.equal(report.duplicateReferenceCount, 1);
});

test("canonical identity collapses line wrapping while preserving ordered words", () => {
  const split = hymn({ sections: [{ type: "verse", label: "1", lines: ["The first line", "continues here"] }] });
  const wrapped = hymn({
    id: "other-001-song",
    collectionId: "other",
    sections: [{ type: "verse", label: "1", lines: ["The first line continues here"] }]
  });
  const reordered = hymn({
    id: "third-001-song",
    collectionId: "third",
    sections: [{ type: "verse", label: "1", lines: ["continues here The first line"] }]
  });
  const { records, report } = buildCanonicalCatalog([split, wrapped, reordered]);

  assert.equal(records.length, 2);
  assert.equal(report.duplicateReferenceCount, 1);
  assert.equal(records.find((record) => record.references.length === 2).references.length, 2);
});

test("canonical representative and references are stable across input order", () => {
  const first = hymn({ title: "Z song" });
  const second = hymn({
    id: "other-001-song",
    collectionId: "other",
    title: "A song",
    source: { repo: "another/repo", path: "other.json", license: "CC-BY", rightsStatus: "licensed" }
  });

  assert.deepEqual(buildCanonicalCatalog([first, second]).records, buildCanonicalCatalog([second, first]).records);
});

test("accent differences and empty lyrics never collapse", () => {
  const accented = hymn({ sections: [{ type: "verse", label: "1", lines: ["café"] }] });
  const unaccented = hymn({ id: "plain", sections: [{ type: "verse", label: "1", lines: ["cafe"] }] });
  const empty = hymn({ id: "empty", sections: [] });
  const { records, report } = buildCanonicalCatalog([accented, unaccented, empty]);

  assert.equal(records.length, 2);
  assert.equal(report.emptyLyricCount, 1);
  assert.equal(report.duplicateGroupCount, 0);
});

test("collection ID collisions receive stable content-derived suffixes", () => {
  const first = hymn();
  const second = hymn({ number: "2", title: "Other", sections: [{ type: "verse", label: "1", lines: ["Different"] }] });
  const { hymns, report } = cleanCollection([first, second]);

  assert.match(hymns[0].id, new RegExp(`^${first.id}--[a-f0-9]{12}$`));
  assert.match(hymns[1].id, new RegExp(`^${first.id}--[a-f0-9]{12}$`));
  assert.notEqual(hymns[0].id, hymns[1].id);
  assert.equal(report.idCollisions.length, 2);
  assert.deepEqual(report.idCollisions.map((item) => item.resolvedId).sort(), hymns.map((item) => item.id).sort());
});

test("ID resolution is independent of input order and avoids real source IDs", () => {
  const first = hymn();
  const duplicate = hymn({ number: "2", title: "Other", sections: [{ type: "verse", label: "1", lines: ["Different"] }] });
  const reserved = hymn({ id: `${first.id}--reserved`, number: "3", title: "Third", sections: [{ type: "verse", label: "1", lines: ["Third"] }] });
  const forward = cleanCollection([first, duplicate, reserved]);
  const reverse = cleanCollection([reserved, duplicate, first]);

  const idsByTitle = (hymns) => Object.fromEntries(hymns.map((item) => [item.title, item.id]));
  assert.deepEqual(idsByTitle(forward.hymns), idsByTitle(reverse.hymns));
  assert.ok(idsByTitle(forward.hymns).Other.startsWith(`${first.id}--`));
  assert.equal(new Set(forward.hymns.map((item) => item.id)).size, 3);
});
