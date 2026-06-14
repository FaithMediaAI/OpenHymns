import assert from "node:assert/strict";
import test from "node:test";

import { normalizeHymn, slugify, stableId } from "../scripts/lib/normalize.mjs";

test("slugify creates stable ascii lookup keys", () => {
  assert.equal(slugify("Praise to the Lord, the Almighty!"), "praise-to-the-lord-the-almighty");
  assert.equal(slugify("  Église adore -- Dieu  "), "eglise-adore-dieu");
});

test("stableId includes collection, number, and normalized title", () => {
  assert.equal(stableId("sdah-en", "001", "Praise to the Lord"), "sdah-en-001-praise-to-the-lord");
});

test("normalizeHymn preserves verses, chorus, attribution, and searchable text", () => {
  const hymn = normalizeHymn({
    collectionId: "fixture-en",
    language: "en",
    number: "7",
    title: "Amazing Grace",
    authors: ["John Newton"],
    tune: "New Britain",
    sections: [
      { type: "verse", label: "1", lines: ["Amazing grace! how sweet the sound", "That saved a wretch like me"] },
      { type: "chorus", label: "Refrain", lines: ["Praise God, praise God"] }
    ],
    source: {
      repo: "fixture/source",
      path: "hymns.json",
      license: "MIT",
      rightsStatus: "repo-license"
    }
  });

  assert.equal(hymn.id, "fixture-en-007-amazing-grace");
  assert.equal(hymn.language, "en");
  assert.equal(hymn.number, "7");
  assert.equal(hymn.title, "Amazing Grace");
  assert.deepEqual(hymn.authors, ["John Newton"]);
  assert.equal(hymn.tune, "New Britain");
  assert.equal(hymn.sections.length, 2);
  assert.equal(hymn.searchText.includes("amazing grace"), true);
  assert.equal(hymn.source.repo, "fixture/source");
});
