import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { cleanLines, normalizeHymn, normalizeSectionType, slugify } from "./normalize.mjs";
import { resolveSourcePath } from "./source-registry.mjs";

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
    const firstLine = chunk.split(/\r?\n/)[0]?.trim().toLowerCase() ?? "";
    const isChorus = firstLine === "refrain" || firstLine === "chorus";
    const lines = cleanLines(isChorus ? chunk.split(/\r?\n/).slice(1).join("\n") : chunk);
    return { type: isChorus ? "chorus" : "verse", label: isChorus ? "Refrain" : String(index + 1), lines };
  });
}

function normalizeCollectionHymn(source, adapter, hymn, sections, extra = {}) {
  const meta = sourceMeta(source, adapter);
  return normalizeHymn({
    collectionId: adapter.collectionId,
    language: adapter.language,
    number: hymn.number ?? hymn.index ?? hymn.id ?? hymn.metadata?.number ?? "",
    title: hymn.title ?? hymn.starts ?? hymn.firstLine ?? "Untitled",
    authors: hymn.authors ?? hymn.author,
    tune: hymn.tune ?? hymn.tuneName,
    meter: hymn.meter,
    topics: [hymn.theme, hymn.subtheme, ...(hymn.topics ?? [])].filter(Boolean),
    sections,
    source: {
      repo: meta.repo,
      path: extra.path ?? adapter.path ?? "",
      license: meta.license,
      rightsStatus: meta.rightsStatus
    }
  });
}

function fromCis(source, adapter, data) {
  return data.map((hymn) => {
    const sections = (hymn.lyrics ?? []).map((section, index) => ({
      type: normalizeSectionType(section.type),
      label: section.index ? String(section.index) : section.type === "refrain" ? "Refrain" : String(index + 1),
      lines: cleanLines(section.lines)
    }));
    return normalizeCollectionHymn(source, adapter, hymn, sections);
  });
}

function fromGospelSounders(source, adapter, data) {
  return Object.values(data.songs ?? {}).map((hymn) => {
    const stanzas = Object.entries(hymn.stanzas ?? {}).map(([label, text]) => sectionFromText("verse", label, text));
    const choruses = Object.entries(hymn.choruses ?? {}).map(([label, text]) => sectionFromText("chorus", label, text));
    return normalizeCollectionHymn(source, adapter, hymn, [...stanzas, ...choruses]);
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
    const sections = [];
    if (Array.isArray(hymn.verses)) {
      sections.push(...hymn.verses.map((verse, index) => sectionFromText("verse", index + 1, verse)));
    }
    if (hymn.chorus) sections.push(sectionFromText("chorus", "Refrain", hymn.chorus));
    return normalizeCollectionHymn(source, adapter, hymn, sections);
  });
}

function fromYozacharFile(source, adapter, hymn, sourcePath) {
  const sections = [];
  if (Array.isArray(hymn.verses)) {
    sections.push(...hymn.verses.map((verse, index) => sectionFromText("verse", index + 1, verse)));
  }
  if (Array.isArray(hymn.chorus) && hymn.chorus.length) sections.push(sectionFromText("chorus", "Refrain", hymn.chorus));
  if (Array.isArray(hymn.bridge) && hymn.bridge.length) sections.push(sectionFromText("bridge", "Bridge", hymn.bridge));
  return normalizeCollectionHymn(source, adapter, hymn, sections, { path: sourcePath });
}

async function discoverCisAdapters(rootDir, source, adapter) {
  const basePath = resolveSourcePath(rootDir, source, adapter.path);
  if (!(await pathExists(basePath))) return [];
  const files = (await walkJsonFiles(basePath)).filter((file) => !file.endsWith("config.json"));
  return files.map((file) => {
    const relative = path.relative(resolveSourcePath(rootDir, source), file);
    const parts = relative.split(path.sep);
    const languageFolder = parts.at(-2) ?? "unknown";
    const filename = path.basename(file, ".json");
    return {
      ...adapter,
      type: "cis-v2",
      path: relative,
      collectionId: adapter.collectionIdPrefix ? `${adapter.collectionIdPrefix}-${slugify(filename)}` : `${slugify(filename)}-${slugify(languageFolder)}`,
      name: `${languageFolder} ${filename}`.replace(/\s+/g, " ").trim(),
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

  if (adapter.type === "cis-v2") return fromCis(source, adapter, data);
  if (adapter.type === "gospel-sounders") return fromGospelSounders(source, adapter, data);
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
  await rm(outRoot, { recursive: true, force: true });

  for (const source of registry.sources ?? []) {
    const adapters = await expandAdapters(rootDir, source);
    for (const adapter of adapters) {
      const hymns = await importAdapter(rootDir, source, adapter, warnings);
      if (!hymns.length) continue;
      const collection = collectionDocument(registry, source, adapter, hymns);
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
  const titles = allHymns
    .map((hymn) => ({
      id: hymn.id,
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

  const titlesJson = stableJson(titles);
  const languagesJson = stableJson(languages);
  const searchJson = stableJson(search);
  const manifest = {
    schemaVersion: 1,
    version: registry.version,
    generatedAt: new Date().toISOString(),
    collectionCount: collections.length,
    hymnCount: allHymns.length,
    collections: collections.map((collection) => collection.manifest),
    indexes: [
      { id: "titles", path: "indexes/titles.json", sha256: sha256(titlesJson), recordCount: titles.length },
      { id: "languages", path: "indexes/languages.json", sha256: sha256(languagesJson), recordCount: languages.length },
      { id: "search", path: "indexes/search.json", sha256: sha256(searchJson), recordCount: search.length }
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
