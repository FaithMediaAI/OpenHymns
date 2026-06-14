const DEFAULT_SECTION_TYPE = "verse";

export function slugify(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

function normalizeIdNumber(number) {
  const raw = String(number ?? "").trim();
  if (!raw) return "000";
  if (/^\d+$/.test(raw)) return raw.padStart(3, "0");
  return slugify(raw);
}

export function stableId(collectionId, number, title) {
  return `${slugify(collectionId)}-${normalizeIdNumber(number)}-${slugify(title)}`;
}

export function normalizeSectionType(type) {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (["refrain", "chorus", "choir", "response"].includes(normalized)) return "chorus";
  if (["bridge", "ending", "tag"].includes(normalized)) return "bridge";
  if (["verse", "stanza", "stanzas"].includes(normalized)) return "verse";
  return DEFAULT_SECTION_TYPE;
}

export function cleanLines(lines) {
  const parts = Array.isArray(lines) ? lines : [lines];
  return parts
    .flatMap((line) => String(line ?? "").split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function cleanString(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function cleanStringArray(value) {
  const parts = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(parts.map(cleanString).filter(Boolean))];
}

export function normalizeHymn(input) {
  const collectionId = slugify(input.collectionId);
  const language = String(input.language ?? "und").trim().toLowerCase() || "und";
  const title = cleanString(input.title) ?? "Untitled";
  const number = cleanString(input.number) ?? "";
  const sections = (input.sections ?? [])
    .map((section, index) => ({
      type: normalizeSectionType(section.type),
      label: cleanString(section.label) ?? String(index + 1),
      lines: cleanLines(section.lines)
    }))
    .filter((section) => section.lines.length > 0);

  const authors = cleanStringArray(input.authors ?? input.author);
  const tune = cleanString(input.tune);
  const meter = cleanString(input.meter);
  const topics = cleanStringArray(input.topics);
  const searchParts = [
    title,
    number,
    ...authors,
    tune,
    meter,
    ...topics,
    ...sections.flatMap((section) => section.lines)
  ];

  return {
    schemaVersion: 1,
    id: stableId(collectionId, number, title),
    collectionId,
    language,
    number,
    title,
    ...(authors.length ? { authors } : {}),
    ...(tune ? { tune } : {}),
    ...(meter ? { meter } : {}),
    ...(topics.length ? { topics } : {}),
    sections,
    searchText: searchParts
      .filter(Boolean)
      .join(" ")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim(),
    source: {
      repo: cleanString(input.source?.repo) ?? "unknown",
      path: cleanString(input.source?.path) ?? "unknown",
      license: cleanString(input.source?.license) ?? "NOASSERTION",
      rightsStatus: cleanString(input.source?.rightsStatus) ?? "needs-review"
    }
  };
}
