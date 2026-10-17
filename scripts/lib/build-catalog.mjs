import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { cleanLines, normalizeHymn, normalizeSectionType, slugify } from "./normalize.mjs";
import { resolveSourcePath } from "./source-registry.mjs";
import { buildCanonicalCatalog, cleanCollection } from "./catalog-quality.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortObject(v)]));
}

function stableJson(value) {
  return `${JSON.stringify(sortObject(value), null, 2)}\n`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
}

function sourceMeta(source, adapter) {
  return {
    repo: source.repo,
    license: adapter.license ?? source.license ?? "NOASSERTION",
    rightsStatus: adapter.rightsStatus ?? source.rightsStatus ?? "source-repository"
  };
}

function sectionFromText(type, label, text) {
  return { type: normalizeSectionType(type), label: String(label ?? ""), lines: cleanLines(text) };
}

function textFromMaybeLines(value) {
  if (Array.isArray(value)) return value.map(textFromMaybeLines).join("\n");
  if (value && typeof value === "object") {
    return textFromMaybeLines(value.content ?? value.lines ?? value.text ?? value.lyrics ?? "");
  }
  return String(value ?? "");
}

function sectionsFromLyricsText(text) {
  const chunks = String(text ?? "")
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.map((chunk, index) => {
    const chunkLines = chunk.split(/\r?\n/);
    const firstLine = chunkLines[0]?.trim() ?? "";
    const isChorus = /^(refrain|chorus)$/i.test(firstLine);
    const stanzaHeading = !isChorus ? firstLine.match(/^(\d{1,3})(?:[.)]\s*(.*))?$/) : null;
    const stanzaHeadingText = stanzaHeading?.[2] ?? "";
    const content = isChorus || (stanzaHeading && !stanzaHeadingText.trim())
      ? chunkLines.slice(1).join("\n")
      : stanzaHeading
        ? [stanzaHeadingText, ...chunkLines.slice(1)].join("\n")
        : chunk;
    const lines = cleanLines(content);
    return {
      type: isChorus ? "chorus" : "verse",
      label: isChorus ? "Refrain" : stanzaHeading?.[1] ?? String(index + 1),
      lines
    };
  });
}

function firstLyricLine(value) {
  return cleanLines(textFromMaybeLines(value))[0];
}

function normalizeMeterTitle(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[.,\s]+$/g, "").replace(/\s+/g, " ");
}

function isMeterTitle(value) {
  return /^(?:[CSLP]\s*\.?\s*M\.?|\d+(?:\.\d+)*\.?\s*(?:D\.?|C\.?M\.?|S\.?M\.?|L\.?M\.?|P\.?M\.?|&\s*Ref\.?|and\s+Ref\.?|Ref\.?)?\.?)$/i.test(String(value ?? "").trim());
}

function normalizeCollectionHymn(source, adapter, hymn, sections, extra = {}) {
  const meta = sourceMeta(source, adapter);
  const number = hymn.number ?? hymn.index ?? hymn.id ?? hymn.metadata?.number ?? "";
  const rawTitle = hymn.title ?? hymn.firstLine ?? hymn.first_line ?? "Untitled";
  const numberedTitle = String(rawTitle).match(/^\s*(\d+)\s+(.+?)\s*$/);
  const opening = sections.flatMap((section) => section.lines)[0] ?? "";
  const normalizeTitleMatch = (value) => String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const hasNumberedTitlePrefix = Boolean(
    numberedTitle && String(number).replace(/^0+(?=\d)/, "") === numberedTitle[1].replace(/^0+(?=\d)/, "") &&
    normalizeTitleMatch(opening).startsWith(normalizeTitleMatch(numberedTitle[2])) &&
    normalizeTitleMatch(numberedTitle[2]).length >= 4
  );
  const title = hasNumberedTitlePrefix ? numberedTitle[2] : rawTitle;
  const normalized = normalizeHymn({
    collectionId: adapter.collectionId,
    language: adapter.language,
    number,
    title,
    authors: hymn.authors ?? hymn.author,
    tune: hymn.tune ?? hymn.tuneName,
    meter: hymn.meter,
    topics: [hymn.theme, hymn.subtheme, hymn.category, ...(hymn.topics ?? [])].filter(Boolean),
    sections,
    source: {
      repo: meta.repo,
      path: extra.path ?? adapter.path ?? "",
      license: meta.license,
      rightsStatus: meta.rightsStatus
    }
  });
  return {
    ...normalized,
    ...((extra.titleSource ?? (hasNumberedTitlePrefix ? "number-prefix-removed" : undefined))
      ? { titleSource: extra.titleSource ?? "number-prefix-removed" }
      : {}),
    ...((extra.sourceTitle ?? (hasNumberedTitlePrefix ? String(rawTitle) : undefined))
      ? { sourceTitle: extra.sourceTitle ?? String(rawTitle) }
      : {})
  };
}

function fromCis(source, adapter, data, warnings) {
  return data.map((hymn) => {
    const sourceNumber = String(hymn.number ?? hymn.index ?? "").replace(/^0+/, "");
    const sections = (hymn.lyrics ?? []).map((section, index) => ({
      type: normalizeSectionType(section.type),
      label: section.index ? String(section.index) : section.type === "refrain" ? "Refrain" : String(index + 1),
      lines: cleanLines(section.lines).filter((line) => {
        const placeholder = line.match(/^###\s*(\d+)\s*$/);
        return !placeholder || placeholder[1].replace(/^0+/, "") !== sourceNumber;
      })
    }));
    const sourceTitle = String(hymn.title ?? "").trim();
    const firstLine = sections.flatMap((section) => section.lines)[0];
    const hasLyrics = sections.some((section) => section.lines.length > 0);
    const normalized = normalizeCollectionHymn(
      source,
      adapter,
      { ...hymn, ...(!sourceTitle && firstLine ? { title: firstLine } : {}) },
      sections,
      { ...(!sourceTitle && firstLine ? { titleSource: "first-line" } : {}) }
    );
    if (!hasLyrics) {
      warnings.push({ source: source.id, path: adapter.path, number: normalized.number, message: "Source record has no usable lyric text; identified source stub will be quarantined." });
    }
    return normalized;
  });
}

function fromGospelSounders(source, adapter, data, warnings) {
  return Object.entries(data.songs ?? {}).flatMap(([key, hymn]) => {
    const sourcePath = `${adapter.path}#songs.${key}`;
    if (!hymn || typeof hymn !== "object" || Array.isArray(hymn)) {
      warnings.push({ source: source.id, path: sourcePath, code: "invalid-record", message: "Skipped non-record value in song index." });
      return [];
    }
    const stanzas = Object.entries(hymn.stanzas ?? {}).map(([label, text]) => sectionFromText("verse", label, text));
    const choruses = Object.entries(hymn.choruses ?? {}).map(([label, text]) => sectionFromText("chorus", label, text));
    const hasLyrics = [...stanzas, ...choruses].some((section) => section.lines.length);
    const hasIdentity = String(hymn.id ?? "").trim() || String(hymn.title ?? "").trim();
    if (!hasLyrics && !hasIdentity) {
      warnings.push({ source: source.id, path: sourcePath, code: "empty-placeholder", message: "Skipped empty song-index placeholder with no title, identifier, or lyrics." });
      return [];
    }
    if (!hasLyrics) {
      warnings.push({ source: source.id, path: sourcePath, number: hymn.id ?? "", message: "Source record is an identified hymn stub with no lyrics; it will be quarantined." });
    }
    return [normalizeCollectionHymn(source, adapter, hymn, [...stanzas, ...choruses], { path: sourcePath })];
  });
}

function fromOpenHymnalJson(source, adapter, data) {
  const hymns = Array.isArray(data) ? data : data.hymns ?? [];
  return hymns.map((hymn) => {
    const sections = [];
    if (Array.isArray(hymn.verses)) {
      sections.push(...hymn.verses.map((verse, index) => sectionFromText("verse", index + 1, verse.lines ?? verse)));
    }
    if (Array.isArray(hymn.lyrics)) {
      sections.push(
        ...hymn.lyrics.map((section, index) =>
          sectionFromText(
            section.type ?? "verse",
            section.verse ?? section.label ?? index + 1,
            textFromMaybeLines(section.content ?? section.lines ?? section.text ?? section)
          )
        )
      );
    }
    if (Array.isArray(hymn.chorus) && hymn.chorus.length) {
      sections.push(sectionFromText("chorus", "Refrain", hymn.chorus));
    }
    if (!sections.length && hymn.lyrics) sections.push(...sectionsFromLyricsText(textFromMaybeLines(hymn.lyrics)));
    return normalizeCollectionHymn(source, adapter, hymn, sections);
  });
}

function fromJosmithuaSongData(source, adapter, data) {
  return data.map((hymn) => {
    const sections = [];
    if (Array.isArray(hymn.verses)) {
      sections.push(...hymn.verses.map((verse, index) => sectionFromText("verse", index + 1, verse)));
    }
    if (Array.isArray(hymn.chorus) && hymn.chorus.length) sections.push(sectionFromText("chorus", "Refrain", hymn.chorus));
    if (Array.isArray(hymn.addedChorus) && hymn.addedChorus.length) {
      sections.push(sectionFromText("chorus", "Additional refrain", hymn.addedChorus));
    }
    return normalizeCollectionHymn(source, adapter, hymn, sections);
  });
}

function fromGospelHymnsDb(source, adapter, data) {
  return Object.values(data.hymns ?? {}).map((hymn) => {
    const sections = [];
    if (Array.isArray(hymn.verses)) {
      sections.push(...hymn.verses.map((verse, index) => sectionFromText("verse", index + 1, verse)));
    }
    if (hymn.chorus) sections.push(sectionFromText("chorus", "Refrain", hymn.chorus));
    return normalizeCollectionHymn(source, adapter, hymn, sections);
  });
}

function fromTrinity(source, adapter, data) {
  return data.map((hymn) => normalizeCollectionHymn(source, adapter, hymn, sectionsFromLyricsText(hymn.lyrics)));
}

function fromFrenchSda(source, adapter, data) {
  return data.map((hymn) => normalizeCollectionHymn(source, adapter, hymn, sectionsFromLyricsText(hymn.lyrics)));
}

function fromHymnFlow(source, adapter, data) {
  const hymns = Array.isArray(data) ? data : data.hymns ?? [];
  return hymns.map((hymn) => {
    const sourceTitle = String(hymn.title ?? "").trim();
    const rawVerses = Array.isArray(hymn.verses) ? hymn.verses : [];
    const firstVerse = textFromMaybeLines(rawVerses[0]);
    const firstVerseLine = firstVerse.split(/\r?\n/)[0]?.trim() ?? "";
    const hasMeterHeading = isMeterTitle(sourceTitle) && normalizeMeterTitle(sourceTitle) === normalizeMeterTitle(firstVerseLine);
    const meterFromTitle = hasMeterHeading ? (hymn.meter || sourceTitle) : undefined;
    const verses = [...rawVerses];
    if (hasMeterHeading) verses[0] = firstVerse.split(/\r?\n/).slice(1).join("\n");
    const recoveredTitle = hasMeterHeading
      ? rawVerses.slice(1).map(firstLyricLine).find(Boolean) ?? firstLyricLine(hymn.chorus)
      : undefined;
    const sections = [];
    if (Array.isArray(verses)) {
      sections.push(...verses.map((verse, index) => sectionFromText("verse", index + 1, verse)));
    }
    if (hymn.chorus) sections.push(sectionFromText("chorus", "Refrain", hymn.chorus));
    return normalizeCollectionHymn(source, adapter, {
      ...hymn,
      number: hymn.number ?? hymn.metadata?.number ?? hymn.index ?? hymn.id,
      ...(hasMeterHeading ? { meter: meterFromTitle } : {}),
      ...(recoveredTitle ? { title: recoveredTitle } : {})
    }, sections, {
      ...(hasMeterHeading ? { sourceTitle } : {}),
      ...(recoveredTitle ? { titleSource: "first-line" } : {})
    });
  });
}

function fromYozacharFile(source, adapter, hymn, sourcePath) {
  const sections = [];
  if (Array.isArray(hymn.verses)) {
    sections.push(...hymn.verses.map((verse, index) => sectionFromText("verse", index + 1, verse)));
  }
  if (Array.isArray(hymn.chorus) && hymn.chorus.length) sections.push(sectionFromText("chorus", "Refrain", hymn.chorus));
  if (Array.isArray(hymn.bridge) && hymn.bridge.length) sections.push(sectionFromText("bridge", "Bridge", hymn.bridge));
  const startsWithChorus = hymn.starts === "chorus";
  const title = startsWithChorus
    ? firstLyricLine(hymn.chorus) ?? firstLyricLine(hymn.verses?.[0])
    : firstLyricLine(hymn.verses?.[0]) ?? firstLyricLine(hymn.chorus);
  return normalizeCollectionHymn(source, adapter, { ...hymn, title: hymn.title || title }, sections, {
    path: sourcePath,
    ...(!hymn.title && title ? { titleSource: "first-line" } : {})
  });
}

async function discoverCisAdapters(rootDir, source, adapter) {
  const basePath = resolveSourcePath(rootDir, source, adapter.path);
  if (!(await pathExists(basePath))) return [];
  const configPath = path.join(basePath, "config.json");
  const config = (await pathExists(configPath)) ? await readJson(configPath) : [];
  const files = (await walkJsonFiles(basePath)).filter((file) => !file.endsWith("config.json"));
  return files.map((file) => {
    const relative = path.relative(resolveSourcePath(rootDir, source), file);
    const parts = relative.split(path.sep);
    const languageFolder = parts.at(-2) ?? "unknown";
    const filename = path.basename(file, ".json");
    const collectionConfig = config.find((entry) => entry.key === filename) ?? config.find((entry) => entry.key === languageFolder);
    return {
      ...adapter,
      type: "cis-v2",
      path: relative,
      collectionId: adapter.collectionIdPrefix ? `${adapter.collectionIdPrefix}-${slugify(filename)}` : `${slugify(filename)}-${slugify(languageFolder)}`,
      name: collectionConfig?.title || `${languageFolder} ${filename}`.replace(/\s+/g, " ").trim(),
      language: adapter.languageMap?.[languageFolder] ?? adapter.languageMap?.[filename] ?? slugify(filename) ?? "und"
    };
  });
}

async function discoverGospelSoundersAdapters(rootDir, source, adapter) {
  const indexPath = resolveSourcePath(rootDir, source, adapter.path);
  if (!(await pathExists(indexPath))) return [];
  const index = await readJson(indexPath);
  return (index.hymnals ?? [])
    .filter((hymnal) => hymnal.path)
    .map((hymnal) => ({
      ...adapter,
      type: "gospel-sounders",
      collectionId: slugify(hymnal.shortname || hymnal.path),
      name: hymnal.longName || hymnal.name || hymnal.shortname || hymnal.path,
      language: adapter.languageMap?.[hymnal.Language] ?? String(hymnal.Language ?? "und").toLowerCase().slice(0, 2),
      path: `${hymnal.path}/index.json`
    }));
}

async function discoverHymnFlowAdapters(rootDir, source, adapter) {
  const basePath = resolveSourcePath(rootDir, source, adapter.path);
  if (!(await pathExists(basePath))) return [];
  const metadataPath = path.join(basePath, "metadata.json");
  const metadata = (await pathExists(metadataPath)) ? await readJson(metadataPath) : [];
  return metadata.map((entry) => ({
    ...adapter,
    type: "hymnflow-bundle",
    collectionId: slugify(entry.abbr || path.basename(entry.filename, ".json")),
    name: entry.fullName || entry.name || entry.filename,
    language: adapter.languageMap?.[entry.filename] ?? "und",
    path: path.join(adapter.path, entry.filename)
  }));
}

async function expandAdapters(rootDir, source) {
  const adapters = [];
  for (const adapter of source.adapters ?? []) {
    if (adapter.type === "cis-v2-root") adapters.push(...(await discoverCisAdapters(rootDir, source, adapter)));
    else if (adapter.type === "gospel-sounders-index") adapters.push(...(await discoverGospelSoundersAdapters(rootDir, source, adapter)));
    else if (adapter.type === "hymnflow-root") adapters.push(...(await discoverHymnFlowAdapters(rootDir, source, adapter)));
    else adapters.push(adapter);
  }
  return adapters;
}

async function importAdapter(rootDir, source, adapter, warnings) {
  if (adapter.type === "unsupported") {
    warnings.push({ source: source.id, adapter: adapter.type, message: adapter.note ?? "Adapter is not implemented." });
    return [];
  }

  if (adapter.type === "yozachar-directory") {
    const dir = resolveSourcePath(rootDir, source, adapter.path);
    if (!(await pathExists(dir))) {
      warnings.push({ source: source.id, path: adapter.path, message: "Source path is missing; run npm run clone:sources." });
      return [];
    }
    const files = await walkJsonFiles(dir);
    const hymns = [];
    for (const file of files) {
      hymns.push(fromYozacharFile(source, adapter, await readJson(file), path.relative(resolveSourcePath(rootDir, source), file)));
    }
    return hymns;
  }

  const filePath = resolveSourcePath(rootDir, source, adapter.path);
  if (!(await pathExists(filePath))) {
    const sourceRoot = resolveSourcePath(rootDir, source);
    const message = (await pathExists(sourceRoot))
      ? "Source-listed JSON file is absent in the cloned repository; the upstream index may include unfinished hymnals."
      : "Source path is missing; run npm run clone:sources.";
    warnings.push({ source: source.id, path: adapter.path, message });
    return [];
  }

  let data;
  try {
    data = await readJson(filePath);
  } catch (error) {
    warnings.push({ source: source.id, path: adapter.path, message: `Could not parse JSON: ${error.message}` });
    return [];
  }

  if (adapter.type === "cis-v2") return fromCis(source, adapter, data, warnings);
  if (adapter.type === "gospel-sounders") return fromGospelSounders(source, adapter, data, warnings);
  if (adapter.type === "open-hymnal-json") return fromOpenHymnalJson(source, adapter, data);
  if (adapter.type === "josmithua-song-data") return fromJosmithuaSongData(source, adapter, data);
  if (adapter.type === "gospel-hymns-db") return fromGospelHymnsDb(source, adapter, data);
  if (adapter.type === "trinity-hymnal") return fromTrinity(source, adapter, data);
  if (adapter.type === "french-sda") return fromFrenchSda(source, adapter, data);
  if (adapter.type === "hymnflow-bundle") return fromHymnFlow(source, adapter, data);

  warnings.push({ source: source.id, adapter: adapter.type, message: "Unknown adapter type." });
  return [];
}

function collectionDocument(registry, source, adapter, hymns) {
  const sortedHymns = hymns.toSorted((a, b) => {
    const number = String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
    return number || a.title.localeCompare(b.title);
  });
  return {
    schemaVersion: 1,
    id: slugify(adapter.collectionId),
    name: adapter.name,
    language: adapter.language,
    version: registry.version,
    source: {
      id: source.id,
      repo: source.repo,
      url: source.url ?? `https://github.com/${source.repo}`,
      path: adapter.path,
      license: adapter.license ?? source.license ?? "NOASSERTION",
      rightsStatus: adapter.rightsStatus ?? source.rightsStatus ?? "source-repository",
      publishable: Boolean(adapter.publishable ?? source.publishable)
    },
    hymnCount: sortedHymns.length,
    hymns: sortedHymns
  };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, stableJson(value), "utf8");
}

export async function buildCatalog({
  rootDir,
  registry,
  outputDir = "data",
  release = false
}) {
  const outRoot = path.join(rootDir, outputDir);
  const warnings = [];
  const collections = [];
  const collectionReports = [];
  const quarantined = [];
  await rm(outRoot, { recursive: true, force: true });

  for (const source of registry.sources ?? []) {
    const adapters = await expandAdapters(rootDir, source);
    for (const adapter of adapters) {
      const hymns = await importAdapter(rootDir, source, adapter, warnings);
      if (!hymns.length) continue;
      const cleaned = cleanCollection(hymns);
      collectionReports.push({ collectionId: slugify(adapter.collectionId), ...cleaned.report });
      quarantined.push(...cleaned.hymns.filter((hymn) => !hymn.sections.length).map((hymn) => ({
        ...hymn,
        contentStatus: "missing-lyrics",
        ...(hymn.title === "Untitled" ? { titleSource: "missing", sourceTitle: "" } : {})
      })));
      const collection = collectionDocument(registry, source, adapter, cleaned.hymns.filter((hymn) => hymn.sections.length));
      if (collections.some((entry) => entry.document.id === collection.id)) throw new Error(`Duplicate collection ID: ${collection.id}`);
      const collectionPath = `collections/${slugify(collection.language)}/${collection.id}.json`;
      const json = stableJson(collection);
      await writeJson(path.join(outRoot, collectionPath), collection);
      collections.push({
        document: collection,
        json,
        manifest: {
          id: collection.id,
          name: collection.name,
          language: collection.language,
          hymnCount: collection.hymnCount,
          path: collectionPath,
          sha256: sha256(json),
          license: collection.source.license,
          rightsStatus: collection.source.rightsStatus,
          publishable: collection.source.publishable,
          sourceRepo: collection.source.repo
        }
      });
    }
  }

  collections.sort((a, b) => a.manifest.language.localeCompare(b.manifest.language) || a.manifest.name.localeCompare(b.manifest.name));
  const allHymns = collections.flatMap((collection) => collection.document.hymns);
  const canonical = buildCanonicalCatalog(allHymns);
  const canonicalIds = new Map(canonical.records.flatMap((record) => record.references.map((reference) => [reference.id, record.id])));
  const titles = allHymns
    .map((hymn) => ({
      id: hymn.id,
      ...(canonicalIds.has(hymn.id) ? { canonicalId: canonicalIds.get(hymn.id) } : {}),
      collectionId: hymn.collectionId,
      language: hymn.language,
      number: hymn.number,
      title: hymn.title
    }))
    .sort((a, b) => a.language.localeCompare(b.language) || a.title.localeCompare(b.title));
  const languages = Object.values(
    collections.reduce((acc, collection) => {
      const language = collection.manifest.language;
      acc[language] ??= { language, collectionCount: 0, hymnCount: 0 };
      acc[language].collectionCount += 1;
      acc[language].hymnCount += collection.manifest.hymnCount;
      return acc;
    }, {})
  ).sort((a, b) => a.language.localeCompare(b.language));
  const search = allHymns
    .map((hymn) => ({
      id: hymn.id,
      ...(canonicalIds.has(hymn.id) ? { canonicalId: canonicalIds.get(hymn.id) } : {}),
      collectionId: hymn.collectionId,
      language: hymn.language,
      title: hymn.title,
      number: hymn.number,
      searchText: hymn.searchText
    }))
    .sort((a, b) => a.language.localeCompare(b.language) || a.title.localeCompare(b.title));

  await writeJson(path.join(outRoot, "indexes", "titles.json"), titles);
  await writeJson(path.join(outRoot, "indexes", "languages.json"), languages);
  await writeJson(path.join(outRoot, "indexes", "search.json"), search);
  await writeJson(path.join(outRoot, "indexes", "canonical.json"), canonical.records);
  await writeJson(path.join(outRoot, "quarantine.json"), quarantined);

  const qualityReport = {
    schemaVersion: 1,
    version: registry.version,
    summary: {
      collectionCount: collections.length,
      importedRecordCount: collectionReports.reduce((total, report) => total + report.inputCount, 0),
      skippedPlaceholderCount: warnings.filter((warning) => ["empty-placeholder", "invalid-record"].includes(warning.code)).length,
      sourceRecordCount: collectionReports.reduce((total, report) => total + report.inputCount, 0) + warnings.filter((warning) => ["empty-placeholder", "invalid-record"].includes(warning.code)).length,
      hymnCount: allHymns.length,
      removedDuplicateCount: collectionReports.reduce((total, report) => total + report.removedCount, 0),
      resolvedIdCollisionCount: collectionReports.reduce((total, report) => total + report.idCollisions.length, 0),
      canonicalHymnCount: canonical.records.length,
      groupedDuplicateReferenceCount: canonical.report.duplicateReferenceCount,
      recoveredTitleCount: allHymns.filter((hymn) => hymn.titleSource === "first-line").length,
      missingLyricsCount: quarantined.length,
      activeMissingLyricsCount: canonical.report.emptyLyricCount,
      quarantinedRecordCount: quarantined.length,
      ambiguousGroupCount: collectionReports.reduce((total, report) => total + report.ambiguous.length, 0)
    },
    collections: collectionReports,
    canonical: canonical.report,
    missingLyrics: quarantined.map((hymn) => ({ id: hymn.id, collectionId: hymn.collectionId, number: hymn.number, title: hymn.title, source: hymn.source })),
    sourceWarnings: warnings,
    metadataReviews: registry.metadataReviews ?? []
  };
  await writeJson(path.join(outRoot, "quality-report.json"), qualityReport);

  const titlesJson = stableJson(titles);
  const languagesJson = stableJson(languages);
  const searchJson = stableJson(search);
  const canonicalJson = stableJson(canonical.records);
  const manifest = {
    schemaVersion: 1,
    version: registry.version,
    generatedAt: new Date().toISOString(),
    collectionCount: collections.length,
    hymnCount: allHymns.length,
    canonicalHymnCount: canonical.records.length,
    qualityReport: { path: "quality-report.json", sha256: sha256(stableJson(qualityReport)) },
    quarantine: { path: "quarantine.json", sha256: sha256(stableJson(quarantined)), recordCount: quarantined.length },
    collections: collections.map((collection) => collection.manifest),
    indexes: [
      { id: "titles", path: "indexes/titles.json", sha256: sha256(titlesJson), recordCount: titles.length },
      { id: "languages", path: "indexes/languages.json", sha256: sha256(languagesJson), recordCount: languages.length },
      { id: "search", path: "indexes/search.json", sha256: sha256(searchJson), recordCount: search.length },
      { id: "canonical", path: "indexes/canonical.json", sha256: sha256(canonicalJson), recordCount: canonical.records.length }
    ],
    warnings
  };
  await writeJson(path.join(outRoot, "manifest.json"), manifest);

  if (release) {
    const releaseRoot = path.join(rootDir, "releases", `v${registry.version}`);
    await rm(releaseRoot, { recursive: true, force: true });
    await mkdir(path.dirname(releaseRoot), { recursive: true });
    await cp(outRoot, releaseRoot, { recursive: true });
  }

  return {
    collections: collections.map((collection) => collection.document),
    manifest,
    warnings
  };
}
