import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const lyricsKey = (hymn) => JSON.stringify([hymn.language, (hymn.sections ?? []).flatMap((section) => section.lines ?? []).join(" ").normalize("NFC").toLowerCase().trim().replace(/\s+/gu, " ")]);

// Validate the published feed itself, independently of the importer and source clones.
export async function validateCatalog(rootDir) {
  const errors = [];
  const issues = [];
  const documents = new Map();
  const load = async (relative, checksum) => {
    if (typeof relative !== "string" || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
      errors.push(`Unsafe feed path: ${relative}`);
      return null;
    }
    try {
      const text = await readFile(path.join(rootDir, relative), "utf8");
      if (checksum && hash(text) !== checksum) errors.push(`Checksum mismatch: ${relative}`);
      const document = JSON.parse(text);
      documents.set(relative, document);
      return document;
    } catch (error) {
      errors.push(`Cannot read ${relative}: ${error.message}`);
      return null;
    }
  };
  const manifest = await load("manifest.json");
  if (!manifest) return { errors, issues, counts: {} };
  if (!Array.isArray(manifest.collections) || !Array.isArray(manifest.indexes)) {
    errors.push("Manifest collections and indexes must be arrays");
    return { errors, issues, counts: {} };
  }
  for (const key of ["canonicalHymnCount", "quarantine", "qualityReport"]) if (manifest[key] == null) errors.push(`Missing manifest field: ${key}`);
  const hymns = [];
  const ids = new Set();
  const collectionIds = new Set();
  const languageCounts = new Map();
  for (const entry of manifest.collections) {
    if (collectionIds.has(entry.id)) errors.push(`Duplicate collection ID: ${entry.id}`);
    collectionIds.add(entry.id);
    const collection = await load(entry.path, entry.sha256);
    if (!collection) continue;
    for (const key of ["id", "name", "language", "hymnCount"]) {
      if (collection[key] !== entry[key]) errors.push(`Collection ${entry.id}: manifest ${key} mismatch`);
    }
    if (!Array.isArray(collection.hymns)) {
      errors.push(`Collection ${entry.id}: hymns must be an array`);
      continue;
    }
    if (collection.hymnCount !== collection.hymns.length) errors.push(`Collection ${entry.id}: hymn count mismatch`);
    const counts = languageCounts.get(collection.language) ?? { language: collection.language, collectionCount: 0, hymnCount: 0 };
    counts.collectionCount++;
    counts.hymnCount += collection.hymns.length;
    languageCounts.set(collection.language, counts);
    for (const hymn of collection.hymns) {
      if (!hymn.id || ids.has(hymn.id)) errors.push(`Missing or duplicate hymn ID: ${hymn.id}`);
      ids.add(hymn.id);
      if (hymn.collectionId !== collection.id || hymn.language !== collection.language) errors.push(`Membership mismatch: ${hymn.id}`);
      if (!/^[a-z]{2,3}(?:-[a-z0-9]+)*$/.test(hymn.language)) errors.push(`Invalid language code: ${hymn.id}`);
      if (typeof hymn.title !== "string" || !hymn.title.trim()) errors.push(`Missing title: ${hymn.id}`);
      if (!Array.isArray(hymn.sections)) errors.push(`Invalid sections: ${hymn.id}`);
      const sections = Array.isArray(hymn.sections) ? hymn.sections : [];
      for (const section of sections) {
        if (!["verse", "chorus", "bridge"].includes(section.type) || !Array.isArray(section.lines) || !section.lines.length || section.lines.some((line) => typeof line !== "string" || !line.trim())) errors.push(`Invalid lyric section: ${hymn.id}`);
      }
      if (!hymn.sections?.length) {
        issues.push({ type: "missing-lyrics", id: hymn.id, collectionId: hymn.collectionId, number: hymn.number, title: hymn.title });
        errors.push(`Active hymn has no lyrics; must be quarantined: ${hymn.id}`);
      }
      if (/^(?:untitled|chorus|verse[- ]?\d*)$/i.test(hymn.title)) issues.push({ type: "placeholder-title", id: hymn.id, title: hymn.title });
      for (const key of ["repo", "path", "license", "rightsStatus"]) {
        if (typeof hymn.source?.[key] !== "string" || !hymn.source[key]) errors.push(`Missing source ${key}: ${hymn.id}`);
      }
      if (typeof hymn.searchText !== "string" || hymn.searchText.includes("[object object]")) errors.push(`Invalid search text: ${hymn.id}`);
      const expectedSearch = [hymn.title, hymn.number, ...(hymn.authors ?? []), hymn.tune, hymn.meter, ...(hymn.topics ?? []), ...sections.flatMap((section) => section.lines ?? [])].filter(Boolean).join(" ").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
      if (hymn.searchText !== expectedSearch) errors.push(`Stale hymn search text: ${hymn.id}`);
      hymns.push(hymn);
    }
  }
  if (manifest.collectionCount !== collectionIds.size) errors.push("Manifest collection count mismatch");
  if (manifest.hymnCount !== hymns.length) errors.push("Manifest hymn count mismatch");
  const indexIds = new Set();
  const canonicalByHymnId = new Map();
  for (const entry of manifest.indexes) {
    if (indexIds.has(entry.id)) errors.push(`Duplicate index ID: ${entry.id}`);
    indexIds.add(entry.id);
    const index = await load(entry.path, entry.sha256);
    if (!index) continue;
    if (!Array.isArray(index)) {
      errors.push(`Index ${entry.id}: expected an array`);
      continue;
    }
    if (entry.recordCount !== index.length) errors.push(`Index ${entry.id}: count mismatch`);
    if (["titles", "search"].includes(entry.id)) {
      const indexMap = new Map(index.map((item) => [item.id, item]));
      if (index.length !== hymns.length || indexMap.size !== index.length) errors.push(`Index ${entry.id}: duplicate or missing records`);
      for (const hymn of hymns) {
        const row = indexMap.get(hymn.id);
        const keys = ["collectionId", "language", "number", "title", ...(entry.id === "search" ? ["searchText"] : [])];
        if (!row || keys.some((key) => row[key] !== hymn[key])) errors.push(`Index ${entry.id}: stale record ${hymn.id}`);
      }
    }
    if (entry.id === "languages") {
      const indexMap = new Map(index.map((item) => [item.language, item]));
      if (index.length !== languageCounts.size || indexMap.size !== index.length) errors.push("Languages index: duplicate or missing languages");
      for (const [language, counts] of languageCounts) {
        const row = indexMap.get(language);
        if (!row || row.hymnCount !== counts.hymnCount || row.collectionCount !== counts.collectionCount) errors.push(`Languages index: stale counts for ${language}`);
      }
    }
    if (entry.id === "canonical") {
      const fingerprints = new Set();
      const canonicalIds = new Set();
      const hymnMap = new Map(hymns.map((hymn) => [hymn.id, hymn]));
      for (const record of index) {
        const fingerprint = lyricsKey(record);
        if (!record.id || canonicalIds.has(record.id)) errors.push(`Canonical index: duplicate ID ${record.id}`);
        canonicalIds.add(record.id);
        if (fingerprints.has(fingerprint)) errors.push(`Canonical index: duplicate lyrics ${record.id}`);
        fingerprints.add(fingerprint);
        if (!record.sections?.length || !Array.isArray(record.references) || !record.references.length) errors.push(`Canonical index: empty record ${record.id}`);
        for (const reference of record.references ?? []) {
          const hymn = hymnMap.get(reference.id);
          if (canonicalByHymnId.has(reference.id)) errors.push(`Canonical index: repeated reference ${reference.id}`);
          canonicalByHymnId.set(reference.id, record.id);
          if (!hymn || lyricsKey(hymn) !== fingerprint || reference.collectionId !== hymn.collectionId || reference.number !== hymn.number || reference.title !== hymn.title || ["repo", "path", "license", "rightsStatus"].some((key) => reference.source?.[key] !== hymn.source?.[key])) errors.push(`Canonical index: invalid source reference ${reference.id}`);
        }
      }
      if (manifest.canonicalHymnCount !== index.length) errors.push("Manifest canonical count mismatch");
      for (const hymn of hymns) {
        if (hymn.sections?.length && !canonicalByHymnId.has(hymn.id)) errors.push(`Canonical index: missing hymn ${hymn.id}`);
      }
    }
  }
  for (const id of ["titles", "search", "languages", "canonical"]) if (!indexIds.has(id)) errors.push(`Missing index: ${id}`);
  if (indexIds.has("canonical")) {
    for (const entry of manifest.indexes.filter((item) => ["titles", "search"].includes(item.id))) {
      for (const row of documents.get(entry.path) ?? []) {
        if (row.canonicalId !== canonicalByHymnId.get(row.id)) errors.push(`Index ${entry.id}: incorrect canonical link ${row.id}`);
      }
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
        if (!hymn.id || quarantineIds.has(hymn.id) || ids.has(hymn.id)) errors.push(`Quarantine: duplicate or active ID ${hymn.id}`);
        quarantineIds.add(hymn.id);
        if (hymn.contentStatus !== "missing-lyrics" || hymn.sections?.length) errors.push(`Quarantine: incorrect status ${hymn.id}`);
        if (!collectionIds.has(hymn.collectionId)) errors.push(`Quarantine: unknown collection ${hymn.id}`);
        for (const key of ["repo", "path", "license", "rightsStatus"]) if (!hymn.source?.[key]) errors.push(`Quarantine: missing source ${key}: ${hymn.id}`);
        issues.push({ type: "missing-lyrics", quarantined: true, id: hymn.id, collectionId: hymn.collectionId, number: hymn.number, title: hymn.title });
      }
    }
  }
  if (manifest.qualityReport) {
    const report = await load(manifest.qualityReport.path, manifest.qualityReport.sha256);
    if (report && (report.summary?.hymnCount !== hymns.length || report.summary?.missingLyricsCount !== issues.filter((issue) => issue.type === "missing-lyrics").length || report.summary?.quarantinedRecordCount !== quarantinedCount || report.summary?.canonicalHymnCount !== manifest.canonicalHymnCount)) errors.push("Quality report: stale counts");
    if (report && (report.summary?.importedRecordCount !== hymns.length + quarantinedCount + report.summary?.removedDuplicateCount || report.summary?.sourceRecordCount !== report.summary?.importedRecordCount + report.summary?.skippedPlaceholderCount)) errors.push("Quality report: source records are unaccounted for");
    if (report && report.summary?.activeMissingLyricsCount !== issues.filter((issue) => issue.type === "missing-lyrics" && !issue.quarantined).length) errors.push("Quality report: active missing lyric count mismatch");
    for (const review of report?.metadataReviews ?? []) issues.push({ ...review, type: "metadata-review" });
  }
  return { errors, issues, counts: { collections: collectionIds.size, hymns: hymns.length, languages: languageCounts.size, quarantined: quarantinedCount }, documents };
}
