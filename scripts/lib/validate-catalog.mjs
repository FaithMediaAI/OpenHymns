import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};
const stableStringify = (value) => JSON.stringify(stableValue(value));
const list = (value) => Array.isArray(value) ? value : [];
const lyricKey = (hymn) => JSON.stringify([
  String(hymn.language ?? "und").trim().toLowerCase(),
  list(hymn.sections).flatMap((section) => list(section?.lines))
    .map((line) => String(line ?? "").normalize("NFC").toLowerCase().trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
]);
const SOURCE_FIELDS = ["repo", "path", "license", "rightsStatus"];
const OPTIONAL_METADATA_FIELDS = ["authors", "tune", "meter", "topics"];

function validSource(source) {
  return SOURCE_FIELDS.every((key) => typeof source?.[key] === "string" && source[key].trim());
}

function primaryMatchesReference(song, reference) {
  if (!reference || typeof reference !== "object") return false;
  return reference.collectionId === song.collectionId && reference.number === song.number &&
    reference.title === song.title && stableStringify(reference.source) === stableStringify(song.source) &&
    OPTIONAL_METADATA_FIELDS.every((key) => stableStringify(reference[key] ?? null) === stableStringify(song[key] ?? null));
}

function expectedSearchText(song) {
  const references = list(song.references).filter((reference) => reference && typeof reference === "object");
  return [
    song.title,
    song.number,
    ...list(song.authors),
    song.tune,
    song.meter,
    ...list(song.topics),
    ...list(song.sections).flatMap((section) => list(section?.lines)),
    ...list(song.alternateTitles),
    ...references.flatMap((reference) => [
      reference.title,
      reference.number,
      ...list(reference.authors),
      reference.tune,
      reference.meter,
      ...list(reference.topics)
    ])
  ].filter(Boolean).join(" ").normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
}

// Validate the published feed itself, independently of the importer and source clones.
export async function validateCatalog(rootDir) {
  const errors = [];
  const issues = [];
  const documents = new Map();
  const load = async (relative, checksum) => {
    if (relative !== "manifest.json" && !/^[a-f0-9]{64}$/.test(checksum ?? "")) errors.push(`Missing or invalid checksum: ${relative}`);
    if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
      errors.push(`Unsafe feed path: ${relative}`);
      return null;
    }
    if (checksum !== undefined && (typeof checksum !== "string" || !/^[a-f0-9]{64}$/.test(checksum))) {
      errors.push(`Missing or invalid checksum: ${relative}`);
    }
    try {
      const text = await readFile(path.join(rootDir, relative), "utf8");
      if (typeof checksum === "string" && hash(text) !== checksum) errors.push(`Checksum mismatch: ${relative}`);
      const document = JSON.parse(text);
      documents.set(relative, document);
      return document;
    } catch (error) {
      errors.push(`Cannot read ${relative}: ${error.message}`);
      return null;
    }
  };

  const manifest = await load("manifest.json");
  if (!manifest) return { errors, issues, counts: {}, documents };
  if (!Array.isArray(manifest.collections) || !Array.isArray(manifest.indexes)) {
    errors.push("Manifest collections and indexes must be arrays");
    return { errors, issues, counts: {}, documents };
  }
  for (const field of ["canonicalHymnCount", "sourceHymnCount", "quarantine", "qualityReport"]) {
    if (manifest[field] == null) errors.push(`Missing manifest field: ${field}`);
  }
  if (manifest.catalogMode !== "one-song-per-language") errors.push("Manifest must declare one-song-per-language catalog mode");

  const songs = [];
  const songIds = new Set();
  const collectionIds = new Set();
  const collectionsById = new Map();
  const collectionCounts = new Map();
  const languageCounts = new Map();
  const sourceIds = new Set();
  const sourceCountByCollection = new Map();
  const membershipCountByCollection = new Map();

  for (const entry of manifest.collections) {
    if (!entry || typeof entry !== "object") continue;
    if (collectionIds.has(entry.id)) errors.push(`Duplicate collection ID: ${entry.id}`);
    collectionIds.add(entry.id);
    sourceCountByCollection.set(entry.id, 0);
    membershipCountByCollection.set(entry.id, 0);
  }

  for (const entry of manifest.collections) {
    if (!entry || typeof entry !== "object") {
      errors.push("Invalid collection manifest entry");
      continue;
    }
    const collection = await load(entry.path, entry.sha256);
    if (!collection) continue;
    collectionsById.set(collection.id, collection);
    for (const key of ["id", "name", "language", "hymnCount", "sourceHymnCount", "membershipCount"]) {
      if (collection[key] !== entry[key]) errors.push(`Collection ${entry.id}: manifest ${key} mismatch`);
    }
    if (!Array.isArray(collection.hymns)) {
      errors.push(`Collection ${entry.id}: hymns must be an array`);
      continue;
    }
    if (collection.hymnCount !== collection.hymns.length) errors.push(`Collection ${entry.id}: owner hymn count mismatch`);
    collectionCounts.set(entry.id, collection.hymns.length);
    for (const song of collection.hymns) {
      if (!song || typeof song !== "object") {
        errors.push(`Collection ${entry.id}: invalid song row`);
        continue;
      }
      if (!song.id || songIds.has(song.id)) errors.push(`Missing or duplicate song ID: ${song.id}`);
      songIds.add(song.id);
      songs.push(song);
      if (song.collectionId !== entry.id || song.language !== collection.language) errors.push(`Owner membership mismatch: ${song.id}`);
      if (typeof song.language !== "string" || !/^[a-z]{2,3}(?:-[a-z0-9]+)*$/.test(song.language)) errors.push(`Invalid language code: ${song.id}`);
      if (typeof song.title !== "string" || !song.title.trim()) errors.push(`Missing title: ${song.id}`);
      if (!Array.isArray(song.sections) || !song.sections.length) errors.push(`Active song has no lyrics: ${song.id}`);
      for (const section of Array.isArray(song.sections) ? song.sections : []) {
        if (!section || !["verse", "chorus", "bridge"].includes(section.type) || !Array.isArray(section.lines) || !section.lines.length || section.lines.some((line) => typeof line !== "string" || !line.trim())) {
          errors.push(`Invalid lyric section: ${song.id}`);
        }
      }
      if (!validSource(song.source)) errors.push(`Missing or invalid source metadata: ${song.id}`);
      if (song.canonicalId !== song.id) errors.push(`Song canonical ID mismatch: ${song.id}`);
      if (!Array.isArray(song.collectionIds) || new Set(song.collectionIds).size !== song.collectionIds.length || !song.collectionIds.includes(song.collectionId)) {
        errors.push(`Invalid song collection memberships: ${song.id}`);
      }
      if (!Array.isArray(song.alternateTitles)) errors.push(`Invalid alternate titles: ${song.id}`);
      if (!Array.isArray(song.references) || song.references.length === 0) {
        errors.push(`Song has no source references: ${song.id}`);
      } else {
        const matchingPrimaryReference = song.references.some((reference) => primaryMatchesReference(song, reference));
        if (!matchingPrimaryReference) errors.push(`No source reference matches primary song metadata: ${song.id}`);
        const referenceIds = new Set();
        for (const reference of song.references) {
          if (!reference || typeof reference !== "object" || typeof reference.id !== "string" || !reference.id) {
            errors.push(`Invalid source reference: ${song.id}`);
            continue;
          }
          if (referenceIds.has(reference.id) || sourceIds.has(reference.id)) errors.push(`Duplicate source hymn reference: ${reference.id}`);
          referenceIds.add(reference.id);
          sourceIds.add(reference.id);
          if (!collectionIds.has(reference.collectionId)) errors.push(`Unknown source collection ${reference.collectionId}: ${reference.id}`);
          if (!song.collectionIds?.includes(reference.collectionId)) errors.push(`Source membership absent from song ${song.id}: ${reference.id}`);
          if (reference.collectionId) sourceCountByCollection.set(reference.collectionId, (sourceCountByCollection.get(reference.collectionId) ?? 0) + 1);
          const collectionLanguage = manifest.collections.find((item) => item.id === reference.collectionId)?.language;
          if (collectionLanguage !== song.language || (reference.language != null && reference.language !== song.language)) errors.push(`Source language mismatch: ${reference.id}`);
          if (typeof reference.number !== "string" || typeof reference.title !== "string" || !reference.title.trim() || !validSource(reference.source)) {
            errors.push(`Incomplete source reference metadata: ${reference.id}`);
          }
        }
        const referenceCollections = new Set(song.references.filter((reference) => reference && typeof reference === "object").map((reference) => reference.collectionId));
        const memberships = new Set(Array.isArray(song.collectionIds) ? song.collectionIds : []);
        if (referenceCollections.size !== memberships.size || [...referenceCollections].some((id) => !memberships.has(id))) {
          errors.push(`Song memberships do not match its source references: ${song.id}`);
        }
      }
      for (const memberId of list(song.collectionIds)) {
        if (!collectionIds.has(memberId)) errors.push(`Unknown song collection membership ${memberId}: ${song.id}`);
        membershipCountByCollection.set(memberId, (membershipCountByCollection.get(memberId) ?? 0) + 1);
      }
      if (typeof song.searchText !== "string" || song.searchText !== expectedSearchText(song)) errors.push(`Invalid or stale song search text: ${song.id}`);
      if (/^(?:untitled|chorus|verse[- ]?\d*)$/i.test(song.title)) issues.push({ type: "placeholder-title", id: song.id, title: song.title });
    }

    const language = collection.language;
    const counts = languageCounts.get(language) ?? { language, collectionCount: 0, hymnCount: 0, sourceHymnCount: 0 };
    counts.collectionCount++;
    counts.hymnCount += collection.hymns.length;
    languageCounts.set(language, counts);
  }

  for (const entry of manifest.collections) {
    if (!collectionIds.has(entry.id)) continue;
    if (entry.sourceHymnCount !== sourceCountByCollection.get(entry.id)) errors.push(`Collection ${entry.id}: source hymn count mismatch`);
    if (entry.membershipCount !== membershipCountByCollection.get(entry.id)) errors.push(`Collection ${entry.id}: membership count mismatch`);
  }
  for (const song of songs) {
    const counts = languageCounts.get(song.language);
    if (counts) counts.sourceHymnCount += song.references?.length ?? 0;
  }

  if (manifest.collectionCount !== collectionIds.size) errors.push("Manifest collection count mismatch");
  if (manifest.hymnCount !== songs.length || manifest.hymnCount !== manifest.canonicalHymnCount) errors.push("Manifest unique song count mismatch");
  if (manifest.sourceHymnCount !== sourceIds.size) errors.push("Manifest source hymn count mismatch");

  const indexEntries = new Map();
  for (const entry of manifest.indexes) {
    if (!entry || typeof entry !== "object") {
      errors.push("Invalid index manifest entry");
      continue;
    }
    if (indexEntries.has(entry.id)) errors.push(`Duplicate index ID: ${entry.id}`);
    indexEntries.set(entry.id, entry);
  }
  for (const id of ["titles", "search", "languages", "canonical"]) if (!indexEntries.has(id)) errors.push(`Missing index: ${id}`);

  for (const id of ["titles", "search"]) {
    const entry = indexEntries.get(id);
    if (!entry) continue;
    const index = await load(entry.path, entry.sha256);
    if (!Array.isArray(index)) {
      errors.push(`Index ${id}: expected an array`);
      continue;
    }
    if (entry.recordCount !== index.length || index.length !== songs.length) errors.push(`Index ${id}: count mismatch`);
    const byId = new Map();
    for (const row of index) {
      if (!row || typeof row !== "object" || !row.id || byId.has(row.id)) errors.push(`Index ${id}: duplicate or invalid song row ${row?.id}`);
      else byId.set(row.id, row);
    }
    if (byId.size !== songs.length) errors.push(`Index ${id}: missing song records`);
    for (const song of songs) {
      const row = byId.get(song.id);
      const fields = ["id", "canonicalId", "collectionId", "collectionIds", "language", "number", "title", "alternateTitles", "references"];
      if (id === "search") fields.push("searchText");
      if (!row || fields.some((field) => stableStringify(row[field]) !== stableStringify(song[field]))) errors.push(`Index ${id}: stale song record ${song.id}`);
    }
  }

  const languageEntry = indexEntries.get("languages");
  if (languageEntry) {
    const index = await load(languageEntry.path, languageEntry.sha256);
    if (!Array.isArray(index)) errors.push("Index languages: expected an array");
    else {
      if (languageEntry.recordCount !== index.length || index.length !== languageCounts.size) errors.push("Languages index: count mismatch");
      const byLanguage = new Map(index.filter((row) => row && typeof row === "object").map((row) => [row.language, row]));
      if (byLanguage.size !== index.length) errors.push("Languages index: duplicate language rows");
      for (const [language, counts] of languageCounts) {
        const row = byLanguage.get(language);
        if (!row || row.hymnCount !== counts.hymnCount || row.sourceHymnCount !== counts.sourceHymnCount || row.collectionCount !== counts.collectionCount) {
          errors.push(`Languages index: stale counts for ${language}`);
        }
      }
    }
  }

  const canonicalEntry = indexEntries.get("canonical");
  const canonicalIds = new Set();
  const canonicalById = new Map();
  if (canonicalEntry) {
    const index = await load(canonicalEntry.path, canonicalEntry.sha256);
    if (!Array.isArray(index)) errors.push("Index canonical: expected an array");
    else {
      if (canonicalEntry.recordCount !== index.length || index.length !== songs.length) errors.push("Canonical index: count mismatch");
      const songById = new Map(songs.map((song) => [song.id, song]));
      const fingerprints = new Set();
      const canonicalReferences = new Set();
      for (const record of index) {
        if (!record || typeof record !== "object") {
          errors.push("Canonical index: invalid song row");
          continue;
        }
        if (!record.id || canonicalIds.has(record.id)) errors.push(`Canonical index: duplicate song ID ${record.id}`);
        canonicalIds.add(record.id);
        canonicalById.set(record.id, record);
        if (record.canonicalId !== record.id) errors.push(`Canonical index: canonicalId mismatch ${record.id}`);
        const fingerprint = lyricKey(record);
        if (fingerprints.has(fingerprint)) errors.push(`Canonical index: duplicate full lyrics ${record.id}`);
        fingerprints.add(fingerprint);
        const song = songById.get(record.id);
        if (!song) errors.push(`Canonical index: unknown song ${record.id}`);
        else {
          const { canonicalId: _canonicalId, ...canonicalSong } = record;
          const { canonicalId: _songCanonicalId, ...primarySong } = song;
          if (stableStringify(canonicalSong) !== stableStringify(primarySong)) errors.push(`Canonical index: stale full song record ${record.id}`);
        }
        if (!Array.isArray(record.references) || !record.references.length) errors.push(`Canonical index: missing source references ${record.id}`);
        for (const reference of Array.isArray(record.references) ? record.references : []) {
          if (!reference || typeof reference !== "object" || typeof reference.id !== "string") {
            errors.push(`Canonical index: invalid source reference ${record.id}`);
            continue;
          }
          if (canonicalReferences.has(reference.id)) errors.push(`Canonical index: repeated source reference ${reference.id}`);
          canonicalReferences.add(reference.id);
        }
      }
      if (canonicalIds.size !== songs.length || songs.some((song) => !canonicalById.has(song.id))) errors.push("Canonical index: missing or extra songs");
      if (canonicalReferences.size !== sourceIds.size || [...sourceIds].some((id) => !canonicalReferences.has(id))) errors.push("Canonical index: source references do not match primary songs");
    }
  }

  let quarantinedCount = 0;
  if (manifest.quarantine) {
    const quarantine = await load(manifest.quarantine.path, manifest.quarantine.sha256);
    if (!Array.isArray(quarantine)) errors.push("Quarantine: expected an array");
    else {
      quarantinedCount = quarantine.length;
      if (manifest.quarantine.recordCount !== quarantine.length) errors.push("Quarantine: count mismatch");
      const quarantineIds = new Set();
      for (const hymn of quarantine) {
        if (!hymn?.id || quarantineIds.has(hymn.id) || songIds.has(hymn.id) || sourceIds.has(hymn.id)) errors.push(`Quarantine: duplicate or active ID ${hymn?.id}`);
        quarantineIds.add(hymn?.id);
        if (hymn.contentStatus !== "missing-lyrics" || hymn.sections?.length) errors.push(`Quarantine: incorrect status ${hymn.id}`);
        if (!collectionIds.has(hymn.collectionId) || !validSource(hymn.source)) errors.push(`Quarantine: missing source membership ${hymn.id}`);
        issues.push({ type: "missing-lyrics", quarantined: true, id: hymn.id, collectionId: hymn.collectionId, number: hymn.number, title: hymn.title });
      }
    }
  }

  const qualityEntry = manifest.qualityReport;
  if (qualityEntry) {
    const report = await load(qualityEntry.path, qualityEntry.sha256);
    if (report) {
      const summary = report.summary ?? {};
      const importedRecordCount = manifest.sourceHymnCount + quarantinedCount + (summary.removedDuplicateCount ?? 0);
      const expectedSourceRecordCount = importedRecordCount + (summary.skippedPlaceholderCount ?? 0);
      if (summary.hymnCount !== songs.length || summary.canonicalHymnCount !== songs.length || summary.quarantinedRecordCount !== quarantinedCount) errors.push("Quality report: stale song counts");
      if (summary.sourceHymnCount !== manifest.sourceHymnCount || summary.groupedDuplicateReferenceCount !== manifest.sourceHymnCount - songs.length) errors.push("Quality report: source grouping counts mismatch");
      if (summary.importedRecordCount !== importedRecordCount || summary.sourceRecordCount !== expectedSourceRecordCount) errors.push("Quality report: source records are unaccounted for");
      if (summary.activeMissingLyricsCount !== 0) errors.push("Quality report: active songs with missing lyrics");
      for (const review of report.metadataReviews ?? []) issues.push({ ...review, type: "metadata-review" });
    }
  }

  return {
    errors,
    issues,
    counts: { collections: collectionIds.size, hymns: songs.length, languages: languageCounts.size, sourceHymns: sourceIds.size, quarantined: quarantinedCount },
    documents,
    canonicalById,
    collectionsById,
    collectionCounts
  };
}
