import { createHash } from "node:crypto";

/*
 * Conservative duplicate handling for normalized hymn records.
 *
 * Lyrics are compared after trimming/collapsing whitespace and Unicode
 * lowercasing. Accents, punctuation, word order, and line order are retained.
 * Empty lyrics never receive an identity. A canonical record is only an index
 * over source records; it does not replace them or their rights metadata.
 */

function normalizedText(value) {
  return String(value ?? "").normalize("NFC").toLowerCase().trim().replace(/\s+/gu, " ");
}

function hymnLines(hymn) {
  return (Array.isArray(hymn?.sections) ? hymn.sections : [])
    .flatMap((section) => Array.isArray(section?.lines) ? section.lines : [])
    .map(normalizedText)
    .filter(Boolean);
}

function lyricIdentity(hymn) {
  const lines = hymnLines(hymn);
  return lines.length ? normalizedText(lines.join(" ")) : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function metadataSignature(hymn) {
  const knownFields = new Set([
    "id", "collectionId", "language", "number", "title", "authors", "tune", "meter", "topics",
    "sections", "searchText", "source"
  ]);
  return stableStringify({
    collectionId: hymn.collectionId ?? "",
    language: hymn.language ?? "und",
    authors: hymn.authors ?? [],
    tune: hymn.tune ?? "",
    meter: hymn.meter ?? "",
    topics: hymn.topics ?? [],
    source: hymn.source ?? null,
    sections: (hymn.sections ?? []).map((section) => ({
      type: section.type ?? "verse",
      label: section.label ?? "",
      lines: section.lines ?? []
    })),
    extra: Object.fromEntries(Object.entries(hymn).filter(([key]) => !knownFields.has(key)))
  });
}

function reference(hymn) {
  return {
    id: hymn.id ?? "",
    collectionId: hymn.collectionId ?? "",
    number: hymn.number ?? "",
    title: hymn.title ?? "",
    source: hymn.source ?? null
  };
}

function uniqueIds(hymns) {
  const reserved = new Set(hymns.map((hymn) => String(hymn.id ?? "hymn")));
  const used = new Set();
  const idCounts = new Map();
  for (const hymn of hymns) {
    const base = String(hymn.id ?? "hymn");
    idCounts.set(base, (idCounts.get(base) ?? 0) + 1);
  }
  const collisions = [];
  const result = hymns.map((original) => {
    const hymn = { ...original };
    const base = String(hymn.id ?? "hymn");
    if (idCounts.get(base) > 1) {
      const fingerprint = { ...hymn };
      delete fingerprint.id;
      const suffix = createHash("sha256").update(stableStringify(fingerprint)).digest("hex").slice(0, 12);
      let id = `${base}--${suffix}`;
      let collisionIndex = 2;
      while (used.has(id) || reserved.has(id)) id = `${base}--${suffix}-${collisionIndex++}`;
      collisions.push({ originalId: base, resolvedId: id, reference: reference(hymn) });
      hymn.id = id;
    } else if (used.has(base)) throw new Error(`Could not resolve duplicate hymn id: ${base}`);
    used.add(hymn.id);
    return hymn;
  });
  return { hymns: result, collisions };
}

/** Remove only same-collection records that agree on number, title, full
 * section layout, and identifying metadata. Variants stay in the collection.
 */
export function cleanCollection(hymns) {
  const kept = [];
  const exactByKey = new Map();
  const removed = [];
  const ambiguous = [];

  for (const hymn of hymns ?? []) {
    const body = lyricIdentity(hymn);
    const title = normalizedText(hymn.title);
    const number = normalizedText(hymn.number);
    const exactKey = body === null ? null : JSON.stringify([
      number,
      title,
      body,
      metadataSignature(hymn)
    ]);
    if (exactKey !== null && exactByKey.has(exactKey)) {
      const original = exactByKey.get(exactKey);
      removed.push({ reason: "same-number-title-lyrics-and-metadata", kept: reference(original), removed: reference(hymn) });
      continue;
    }
    if (exactKey !== null) exactByKey.set(exactKey, hymn);
    kept.push(hymn);
  }

  const byLyrics = new Map();
  const byTitle = new Map();
  for (const hymn of kept) {
    const body = lyricIdentity(hymn);
    const title = normalizedText(hymn.title);
    if (body !== null) {
      const key = JSON.stringify([hymn.language ?? "und", body]);
      if (!byLyrics.has(key)) byLyrics.set(key, []);
      byLyrics.get(key).push(hymn);
    }
    if (title) {
      const key = JSON.stringify([hymn.language ?? "und", title]);
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(hymn);
    }
  }
  for (const records of byLyrics.values()) {
    if (records.length < 2) continue;
    const titles = new Set(records.map((hymn) => normalizedText(hymn.title)));
    if (titles.size > 1) ambiguous.push({ reason: "same-lyrics-different-title", records: records.map(reference) });
  }
  for (const records of byTitle.values()) {
    if (records.length < 2) continue;
    const bodies = new Set(records.map(lyricIdentity));
    if (bodies.size > 1) ambiguous.push({ reason: "same-title-different-lyrics", records: records.map(reference) });
  }

  const ids = uniqueIds(kept);
  return {
    hymns: ids.hymns,
    report: {
      inputCount: (hymns ?? []).length,
      outputCount: ids.hymns.length,
      removedCount: removed.length,
      removed,
      idCollisions: ids.collisions,
      ambiguous
    }
  };
}

/** Build a language-aware index of exact nonempty lyric identities. Every
 * source hymn remains represented as a reference, including across collections.
 */
export function buildCanonicalCatalog(allHymns) {
  const groups = new Map();
  let emptyLyricCount = 0;
  for (const hymn of allHymns ?? []) {
    const body = lyricIdentity(hymn);
    if (body === null) {
      emptyLyricCount += 1;
      continue;
    }
    const language = String(hymn.language ?? "und").trim().toLowerCase() || "und";
    const key = JSON.stringify([language, body]);
    if (!groups.has(key)) groups.set(key, { language, body, hymns: [] });
    groups.get(key).hymns.push(hymn);
  }

  const records = [...groups.values()].map(({ language, body, hymns }) => {
    const id = `lyrics-${createHash("sha256").update(JSON.stringify([language, body])).digest("hex").slice(0, 20)}`;
    const orderedHymns = hymns.toSorted((a, b) =>
      stableStringify(reference(a)).localeCompare(stableStringify(reference(b))) ||
      stableStringify(a).localeCompare(stableStringify(b))
    );
    return {
      id,
      language,
      title: orderedHymns[0].title ?? "",
      sections: orderedHymns[0].sections ?? [],
      references: orderedHymns.map(reference)
    };
  }).sort((a, b) => a.language.localeCompare(b.language) || a.id.localeCompare(b.id));

  const duplicateGroups = records.filter((record) => record.references.length > 1);
  const sameCollectionGroups = duplicateGroups.filter((record) => {
    const collectionIds = new Set(record.references.map((item) => item.collectionId));
    return collectionIds.size < record.references.length;
  });
  return {
    records,
    report: {
      inputCount: (allHymns ?? []).length,
      canonicalCount: records.length,
      emptyLyricCount,
      duplicateGroupCount: duplicateGroups.length,
      duplicateReferenceCount: duplicateGroups.reduce((total, record) => total + record.references.length - 1, 0),
      repeatedWithinCollectionGroupCount: sameCollectionGroups.length,
      duplicateGroups: duplicateGroups.map((record) => ({ id: record.id, language: record.language, references: record.references }))
    }
  };
}
