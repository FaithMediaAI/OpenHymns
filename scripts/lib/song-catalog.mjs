import { createHash } from "node:crypto";

const TITLE_STOPWORDS = new Set([
  "a", "an", "and", "art", "as", "at", "be", "by", "for", "from", "how", "i", "in", "is", "it", "me",
  "my", "of", "o", "on", "or", "the", "thou", "thy", "to", "we", "with", "you", "your"
]);
const COMMON_TITLE_WORDS = new Set([
  "amen", "alleluia", "hallelujah", "praise", "glory", "holy", "jesus", "lord", "god", "sing", "song",
  "joy", "love", "faith", "grace", "peace", "home", "come", "thanks", "thank", "worship"
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’‘‛`´]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function tokensFor(value) {
  return normalizeText(value).match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

function titleKey(value) {
  // Parenthetical setting notes vary by hymnbook; lyric evidence still gates
  // every match, so removing them only broadens candidate generation.
  const withoutNotes = String(value ?? "").replace(/\([^)]*\)/gu, " ");
  return tokensFor(withoutNotes).join(" ");
}

function isGenericTitle(key) {
  const tokens = key.split(" ").filter(Boolean);
  return tokens.length < 2 || tokens.every((token) => TITLE_STOPWORDS.has(token) || COMMON_TITLE_WORDS.has(token));
}

function sectionTokens(hymn, types = null) {
  return (Array.isArray(hymn?.sections) ? hymn.sections : [])
    .filter((section) => !types || types.has(section?.type))
    .flatMap((section) => Array.isArray(section?.lines) ? section.lines : [])
    .flatMap(tokensFor);
}

function features(hymn) {
  const language = String(hymn.language ?? "und").trim().toLowerCase() || "und";
  const title = titleKey(hymn.title);
  const allTokens = sectionTokens(hymn);
  const bodyKey = allTokens.join(" ");
  const trigrams = new Set();
  for (const section of hymn.sections ?? []) {
    const sectionWords = (section.lines ?? []).flatMap(tokensFor);
    for (let i = 0; i + 2 < sectionWords.length; i += 1) trigrams.add(sectionWords.slice(i, i + 3).join(" "));
  }
  // The adapter marks a recovered meter title and retains its opening
  // scripture epigraph as section 1. It is not an additional sung stanza.
  const isEpigraph = (section) => section.label === "1" && hymn.titleSource === "first-line" && hymn.sourceTitle && hymn.sourceTitle === hymn.meter;
  const verseSections = (hymn.sections ?? []).filter((section) => section.type === "verse" && !isEpigraph(section));
  const verseTokens = verseSections.flatMap((section) => (section.lines ?? []).flatMap(tokensFor));
  const verseTrigrams = new Set();
  for (const section of verseSections) {
    const words = (section.lines ?? []).flatMap(tokensFor);
    for (let i = 0; i + 2 < words.length; i += 1) verseTrigrams.add(words.slice(i, i + 3).join(" "));
  }
  const distinctVerseContent = new Set();
  for (let i = 0; i < verseTokens.length; i += 1) distinctVerseContent.add(verseTokens[i]);
  const distinctVerses = new Set(verseSections.map((section) => section.lines.map((line) => tokensFor(line).join(" ")).join(" ")).filter((verse) => verse.split(" ").filter(Boolean).length >= 12));
  return {
    hymn,
    language,
    title,
    genericTitle: isGenericTitle(title),
    bodyKey,
    tokenCount: allTokens.length,
    trigrams,
    verseTrigrams,
    distinctVerseTokenCount: distinctVerseContent.size,
    distinctVerseCount: distinctVerses.size,
    epigraphCount: (hymn.sections ?? []).filter(isEpigraph).length,
    cleanLineCount: (hymn.sections ?? []).reduce((n, section) => n + (section.lines ?? []).filter((line) => String(line).trim()).length, 0)
  };
}

function overlap(a, b) {
  let shared = 0;
  for (const gram of a.trigrams) if (b.trigrams.has(gram)) shared += 1;
  const min = Math.min(a.trigrams.size, b.trigrams.size);
  const union = a.trigrams.size + b.trigrams.size - shared;
  return {
    shared,
    containment: min ? shared / min : 0,
    jaccard: union ? shared / union : 0
  };
}

function verseOverlap(a, b) {
  return a.verseTrigrams.size >= 6 && b.verseTrigrams.size >= 6
    ? overlap({ trigrams: a.verseTrigrams }, { trigrams: b.verseTrigrams })
    : overlap(a, b);
}

function compatibleLyrics(a, b) {
  if (a.language !== b.language) return false;
  if (a.bodyKey && a.bodyKey === b.bodyKey) return true;
  const similarity = verseOverlap(a, b);
  return similarity.shared >= 8 && similarity.containment >= 0.45;
}

function matchEvidence(a, b) {
  if (a.language !== b.language) return null;
  if (a.bodyKey && a.bodyKey === b.bodyKey) {
    return { kind: "exact-lyrics", score: 3 };
  }
  if (!a.title || !b.title) return null;
  // Shared refrain text alone does not establish that the verses are the same
  // song. Compare verse content whenever both sources provide usable verses.
  const similarity = verseOverlap(a, b);
  if (a.title === b.title && a.genericTitle && similarity.shared >= 12 && similarity.containment >= 0.72) {
    return { kind: "generic-title-very-strong-lyric-overlap", score: similarity.containment + similarity.jaccard };
  }
  if (a.genericTitle || b.genericTitle) return null;
  if (a.title === b.title && similarity.shared >= 8 && similarity.containment >= 0.45) {
    return { kind: "same-title-strong-lyric-overlap", score: similarity.containment + similarity.jaccard };
  }
  if (a.title !== b.title && similarity.shared >= 8 && similarity.containment >= 0.82 && similarity.jaccard >= 0.68) {
    return { kind: "alternate-title-strong-lyric-overlap", score: similarity.containment + similarity.jaccard };
  }
  return null;
}

function candidatePairs(items) {
  const pairs = new Map();
  const add = (i, j) => {
    if (i === j) return;
    const left = Math.min(i, j);
    const right = Math.max(i, j);
    pairs.set(`${left}:${right}`, [left, right]);
  };
  const titleGroups = new Map();
  const exactGroups = new Map();
  const gramGroups = new Map();
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.title && (!item.genericTitle || item.title.split(" ").length > 1)) {
      if (!titleGroups.has(item.title)) titleGroups.set(item.title, []);
      titleGroups.get(item.title).push(i);
    }
    if (item.bodyKey) {
      if (!exactGroups.has(item.bodyKey)) exactGroups.set(item.bodyKey, []);
      exactGroups.get(item.bodyKey).push(i);
    }
    for (const gram of item.trigrams) {
      if (!gramGroups.has(gram)) gramGroups.set(gram, []);
      gramGroups.get(gram).push(i);
    }
  }
  for (const group of [...titleGroups.values(), ...exactGroups.values()]) {
    for (let i = 0; i < group.length; i += 1) for (let j = i + 1; j < group.length; j += 1) add(group[i], group[j]);
  }
  // Common refrain fragments can have huge postings; omit them from candidate
  // discovery. The exact-title and exact-lyrics paths still cover those cases.
  for (const group of gramGroups.values()) {
    if (group.length > 80) continue;
    for (let i = 0; i < group.length; i += 1) for (let j = i + 1; j < group.length; j += 1) add(group[i], group[j]);
  }
  return [...pairs.values()];
}

function reference(hymn) {
  return {
    id: hymn.id ?? "",
    collectionId: hymn.collectionId ?? "",
    language: hymn.language ?? "und",
    number: hymn.number ?? "",
    title: hymn.title ?? "",
    ...(hymn.authors?.length ? { authors: hymn.authors } : {}),
    ...(hymn.tune ? { tune: hymn.tune } : {}),
    ...(hymn.meter ? { meter: hymn.meter } : {}),
    ...(hymn.topics?.length ? { topics: hymn.topics } : {}),
    ...(hymn.sourceTitle ? { sourceTitle: hymn.sourceTitle } : {}),
    ...(hymn.titleSource ? { titleSource: hymn.titleSource } : {}),
    source: hymn.source ?? null
  };
}

function representativeScore(item) {
  return [item.distinctVerseCount, -item.epigraphCount, item.distinctVerseTokenCount, item.trigrams.size, item.cleanLineCount];
}

function compareRepresentatives(a, b) {
  const left = representativeScore(a);
  const right = representativeScore(b);
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return right[i] - left[i];
  return stableStringify(reference(a.hymn)).localeCompare(stableStringify(reference(b.hymn))) ||
    stableStringify(a.hymn).localeCompare(stableStringify(b.hymn));
}

function unionClusters(items, edges) {
  const groups = items.map((_, i) => [i]);
  const groupOf = items.map((_, i) => i);
  const ranked = edges.toSorted((a, b) => b.evidence.score - a.evidence.score || a.a - b.a || a.b - b.b);
  for (const edge of ranked) {
    let left = groupOf[edge.a];
    let right = groupOf[edge.b];
    if (left === right) continue;
    const merged = [...groups[left], ...groups[right]];
    const leftTitles = new Set(groups[left].map((i) => items[i].title));
    const commonTitles = new Set(groups[right].map((i) => items[i].title).filter((title) => title && leftTitles.has(title)));
    // Verse selections can be disjoint in two short editions. A more complete
    // source of the same titled song must support every edition in the group.
    // Different-title matches retain the stricter pairwise compatibility rule.
    const anchored = commonTitles.size > 0 && merged.some((anchor) =>
      commonTitles.has(items[anchor].title) && merged.every((i) => compatibleLyrics(items[anchor], items[i]))
    );
    const compatible = anchored || groups[left].every((i) =>
      groups[right].every((j) => compatibleLyrics(items[i], items[j]))
    );
    if (!compatible) continue;
    const newIndex = groups.length;
    groups.push(merged);
    for (const i of merged) groupOf[i] = newIndex;
    groups[left] = [];
    groups[right] = [];
  }
  return groups.filter((group) => group.length).map((group) => group.map((i) => items[i]));
}

function songRecord(group) {
  const ordered = group.toSorted(compareRepresentatives);
  const primary = ordered[0].hymn;
  const refs = group.map((item) => reference(item.hymn)).sort((a, b) =>
    stableStringify(a).localeCompare(stableStringify(b))
  );
  const titles = [...new Set(group.map((item) => String(item.hymn.title ?? "").trim()).filter(Boolean))]
    .sort((a, b) => normalizeText(a).localeCompare(normalizeText(b)) || a.localeCompare(b));
  const canonicalTitle = String(primary.title ?? "").trim();
  const alternateTitles = titles.filter((title) => normalizeText(title) !== normalizeText(canonicalTitle));
  const collectionIds = [...new Set(refs.map((item) => item.collectionId))].sort((a, b) => a.localeCompare(b));
  const identity = JSON.stringify([
    ordered[0].language,
    [...new Set(group.map((item) => item.title))].sort(),
    [...new Set(group.map((item) => item.bodyKey))].sort()
  ]);
  const id = `song-${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
  return { ...primary, id, collectionIds, alternateTitles, references: refs };
}

/** Merge cross-hymnal source entries into one same-language song record while
 * retaining every original book entry as a reference.
 */
export function buildSongCatalog(hymns) {
  const all = (hymns ?? []).toSorted((a, b) => stableStringify(a).localeCompare(stableStringify(b))).map(features);
  const byLanguage = new Map();
  for (const item of all) {
    if (!byLanguage.has(item.language)) byLanguage.set(item.language, []);
    byLanguage.get(item.language).push(item);
  }

  const groups = [];
  for (const items of byLanguage.values()) {
    const edges = [];
    for (const [a, b] of candidatePairs(items)) {
      const evidence = matchEvidence(items[a], items[b]);
      if (evidence) edges.push({ a, b, evidence });
    }
    groups.push(...unionClusters(items, edges));
  }

  const songIdByItem = new Map();
  const records = groups.map((group) => {
    const record = songRecord(group);
    for (const item of group) songIdByItem.set(item, record.id);
    return record;
  }).sort((a, b) =>
    a.language.localeCompare(b.language) || a.id.localeCompare(b.id)
  );

  const ambiguous = [];
  const titleGroups = new Map();
  const bodyGroups = new Map();
  for (const item of all) {
    if (item.title) {
      const key = JSON.stringify([item.language, item.title]);
      if (!titleGroups.has(key)) titleGroups.set(key, []);
      titleGroups.get(key).push(item);
    }
    if (item.bodyKey && item.tokenCount < 8) {
      const key = JSON.stringify([item.language, item.bodyKey]);
      if (!bodyGroups.has(key)) bodyGroups.set(key, []);
      bodyGroups.get(key).push(item);
    }
  }
  for (const items of titleGroups.values()) {
    const distinctSongs = new Set(items.map((item) => songIdByItem.get(item)));
    if (distinctSongs.size > 1 && (items[0].genericTitle || new Set(items.map((item) => item.bodyKey)).size > 1)) {
      ambiguous.push({ reason: items[0].genericTitle ? "common-title-collision" : "same-title-weak-lyrics", references: items.map((item) => reference(item.hymn)).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))) });
    }
  }
  for (const items of bodyGroups.values()) {
    if (items.length > 1 && new Set(items.map((item) => item.title)).size > 1) {
      ambiguous.push({ reason: "short-identical-lyrics-different-title", references: items.map((item) => reference(item.hymn)).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))) });
    }
  }

  const duplicateGroups = records.filter((record) => record.references.length > 1);
  return {
    records,
    report: {
      inputCount: all.length,
      sourceHymnCount: all.length,
      count: records.length,
      songCount: records.length,
      canonicalCount: records.length,
      duplicateGroupCount: duplicateGroups.length,
      duplicateReferenceCount: duplicateGroups.reduce((total, record) => total + record.references.length - 1, 0),
      duplicateGroups: duplicateGroups.map((record) => ({ id: record.id, language: record.language, references: record.references })),
      ambiguousGroupCount: ambiguous.length,
      ambiguous,
      ambiguousGroups: ambiguous,
      emptyLyricCount: all.filter((item) => !item.bodyKey).length
    }
  };
}
