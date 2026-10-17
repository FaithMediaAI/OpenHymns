import assert from "node:assert/strict";
import test from "node:test";

import { normalizeHymn, slugify, stableId } from "../scripts/lib/normalize.mjs";

test("slugify creates stable ascii lookup keys", () => {
  assert.equal(slugify("Praise to the Lord, the Almighty!"), "praise-to-the-lord-the-almighty");
  assert.equal(slugify("  Église adore -- Dieu  "), "eglise-adore-dieu");
});

test("slugify keeps non-Latin letters when they cannot be folded to ASCII", () => {
  assert.equal(slugify("കർത്താവേ"), "കർത്താവേ");
  assert.equal(slugify("Praise ለእግዚአብሔር"), "praise-ለእግዚአብሔር");
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

test("normalization decodes observed HTML entities without stripping lyric text", () => {
  const hymn = normalizeHymn({
    collectionId: "xhosa",
    language: "xh",
    title: "Praise &amp; Thanks",
    sections: [{ type: "verse", lines: ["Tenor &amp; Bass: Praise&#33;", "&nbsp;Néa akra brɛfo"] }],
    authors: ["D&apos;Ávila", "D&#39;Ávila"],
    source: { repo: "fixture", path: "hymns.json" }
  });

  assert.equal(hymn.title, "Praise & Thanks");
  assert.deepEqual(hymn.sections[0].lines, ["Tenor & Bass: Praise!", "Néa akra brɛfo"]);
  assert.deepEqual(hymn.authors, ["D'Ávila"]);
  assert.equal(hymn.searchText.includes("néa akra brɛfo"), true);
  assert.equal(hymn.searchText.includes("&amp;"), false);
});

test("normalization tolerates malformed optional fields and filters non-text values", () => {
  const hymn = normalizeHymn({
    collectionId: "fixture",
    title: { text: "not a string" },
    language: { code: "en" },
    authors: ["Ada", null, { name: "Grace" }],
    sections: "not a section list"
  });

  assert.equal(hymn.title, "Untitled");
  assert.equal(hymn.language, "und");
  assert.deepEqual(hymn.authors, ["Ada"]);
  assert.deepEqual(hymn.sections, []);
});

test("normalization handles known markup and whitespace while preserving path text", () => {
  const hymn = normalizeHymn({
    collectionId: "cis-gikuyu",
    number: "296",
    title: "Twi  Gakundi Ga Twaana<br/>",
    sections: [{ type: "verse", lines: ["<p>Twĩ   gakuundi</p><p>ga\t twaana</p>"] }],
    source: { repo: "fixture", path: "folder/<custom-tag>.json" }
  });

  assert.equal(hymn.title, "Twi Gakundi Ga Twaana");
  assert.equal(hymn.id, "cis-gikuyu-296-twi-gakundi-ga-twaana");
  assert.deepEqual(hymn.sections[0].lines, ["Twĩ gakuundi", "ga twaana"]);
  assert.equal(hymn.source.path, "folder/<custom-tag>.json");
});

test("normalization removes invalid controls and repairs common Windows punctuation", () => {
  const hymn = normalizeHymn({
    collectionId: "fixture",
    title: "Praise&#0; the Lord",
    sections: [{ type: "verse", lines: ["Praise\u0000 God\u0096 forever\u0097"] }]
  });

  assert.equal(hymn.title, "Praise the Lord");
  assert.deepEqual(hymn.sections[0].lines, ["Praise God– forever—"]);
  assert.equal(JSON.stringify(hymn).includes("\u0000"), false);
});

test("normalization preserves Malayalam joiners and folds accented Latin labels in NFC", () => {
  const withJoiner = "ക്\u200dക";
  const hymn = normalizeHymn({
    collectionId: "ml",
    title: `Cafe\u0301 ${withJoiner}`,
    sections: [{ type: "verse", lines: [`Cafe\u0301  ${withJoiner}`] }]
  });

  assert.equal(hymn.title, `Café ${withJoiner}`);
  assert.deepEqual(hymn.sections[0].lines, [`Café ${withJoiner}`]);
  assert.equal(hymn.searchText.includes(`café ${withJoiner.toLowerCase()}`), true);
});
