import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (file) => JSON.parse(await readFile(new URL(`../data/${file}`, import.meta.url), "utf8"));
const key = (value) => (value.normalize("NFC").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).join(" ");
const matching = (rows, title) => rows.filter((row) => row.language === "en" && [row.title, ...(row.alternateTitles ?? []), ...row.references.map((reference) => reference.title)].some((candidate) => key(candidate) === key(title)));

test("published search has one How Great Thou Art, Amazing Grace and What a Friend result", async () => {
  const search = await read("indexes/search.json");
  for (const [title, minimumSources] of [["How Great Thou Art", 5], ["Amazing Grace", 6], ["What A Friend We Have In Jesus", 11]]) {
    const rows = matching(search, title);
    assert.equal(rows.length, 1, `${title} must appear once in the default search feed`);
    assert(rows[0].references.length >= minimumSources, `${title} must preserve the hymnbook references`);
  }
  const distinctHolySongs = matching(search, "Holy Holy Holy");
  assert.equal(distinctHolySongs.length, 2, "two different songs sharing this title must remain separate");
});

test("concatenating every default collection yields exactly one row per song", async () => {
  const manifest = await read("manifest.json");
  const collections = await Promise.all(manifest.collections.map((entry) => read(entry.path)));
  const songs = collections.flatMap((collection) => collection.hymns);
  assert.equal(new Set(songs.map((song) => song.id)).size, songs.length);
  assert.equal(songs.length, manifest.hymnCount);
  assert.equal(matching(songs, "How Great Thou Art").length, 1);
  assert.equal(songs.reduce((count, song) => count + song.references.length, 0), manifest.sourceHymnCount);
});
