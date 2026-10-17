const DEFAULT_SECTION_TYPE = "verse";

export function slugify(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    // Keep combining marks used by non-Latin writing systems. Latin accents
    // are folded so existing ASCII IDs remain stable (e.g. Église -> eglise).
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
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
    .flatMap((line) => cleanText(line, { formatted: true }).split(/\r?\n/))
    .map((line) => line.replace(/[\t\v\f\u00a0\p{Zs}]+/gu, " ").trim().normalize("NFC"))
    .filter(Boolean);
}

const NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["aacute", "á"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", "\u00a0"],
  ["quot", '"']
]);

const WINDOWS_1252_CONTROLS = new Map([
  [0x80, "€"], [0x82, "‚"], [0x83, "ƒ"], [0x84, "„"], [0x85, "…"],
  [0x86, "†"], [0x87, "‡"], [0x88, "ˆ"], [0x89, "‰"], [0x8a, "Š"],
  [0x8b, "‹"], [0x8c, "Œ"], [0x8e, "Ž"], [0x91, "‘"], [0x92, "’"],
  [0x93, "“"], [0x94, "”"], [0x95, "•"], [0x96, "–"], [0x97, "—"],
  [0x98, "˜"], [0x99, "™"], [0x9a, "š"], [0x9b, "›"], [0x9c, "œ"],
  [0x9e, "ž"], [0x9f, "Ÿ"]
]);

const FORMATTING_TAGS = new Set([
  "br", "p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  "b", "strong", "i", "em", "u", "span", "font"
]);

function stripKnownFormattingTags(text) {
  return text.replace(/<\/?([a-z][a-z0-9]*)(?:\s[^<>]*?)?\s*\/?>/giu, (tag, name) => {
    const normalizedName = name.toLowerCase();
    if (!FORMATTING_TAGS.has(normalizedName)) return tag;
    if (normalizedName === "br" || ["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6"].includes(normalizedName)) {
      return "\n";
    }
    return "";
  });
}

function cleanText(value, { formatted = false } = {}) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  let text = String(value);
  // Interpret only a bounded set of common formatting tags. Run this before
  // entity decoding so an escaped literal such as &lt;code&gt; stays literal.
  if (formatted) text = stripKnownFormattingTags(text);
  return text
    .replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/giu, (entity, reference) => {
      if (reference[0] !== "#") return NAMED_ENTITIES.get(reference.toLowerCase()) ?? entity;
      const hex = reference[1]?.toLowerCase() === "x";
      const digits = reference.slice(hex ? 2 : 1);
      const codePoint = Number.parseInt(digits, hex ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        // NUL and impossible scalar values are not displayable text.
        if (codePoint === 0) return "";
        return entity;
      }
      return String.fromCodePoint(codePoint);
    })
    // HTML non-breaking spaces should behave like ordinary spaces in text.
    .replace(/\u00a0/g, " ")
    .replace(/[\u0080-\u009f]/g, (character) => WINDOWS_1252_CONTROLS.get(character.charCodeAt(0)) ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .normalize("NFC");
}

function cleanString(value, { formatted = false } = {}) {
  const text = cleanText(value, { formatted }).replace(/[\t\v\f\r\n\p{Zs}]+/gu, " ").trim().normalize("NFC");
  return text || undefined;
}

function cleanStringArray(value) {
  const parts = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(parts.map(cleanString).filter(Boolean))];
}

export function normalizeHymn(input) {
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const collectionId = slugify(input.collectionId);
  const language = (cleanString(input.language) ?? "und").toLowerCase();
  const title = cleanString(input.title, { formatted: true }) ?? "Untitled";
  const number = cleanString(input.number) ?? "";
  const sections = (Array.isArray(input.sections) ? input.sections : [])
    .filter((section) => section && typeof section === "object" && !Array.isArray(section))
    .map((section, index) => ({
      type: normalizeSectionType(section.type),
      label: cleanString(section.label, { formatted: true }) ?? String(index + 1),
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
      .normalize("NFC")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim(),
    source: {
      repo: cleanString(input.source?.repo) ?? "unknown",
      path: cleanString(input.source?.path) ?? "unknown",
      license: cleanString(input.source?.license) ?? "NOASSERTION",
      rightsStatus: cleanString(input.source?.rightsStatus) ?? "source-repository"
    }
  };
}
