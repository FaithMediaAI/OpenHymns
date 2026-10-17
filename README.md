# OpenHymns

OpenHymns is a versioned, normalized hymn catalog. It gathers hymn data from public repositories, converts different JSON shapes into one schema, writes searchable indexes, and publishes a static `data/` feed that apps, websites, and tools can download and cache offline.

## Quick Start

```bash
npm test
npm run clone:sources
npm run build
npm run validate
npm run release
```

Start from:

```text
data/manifest.json
```

The public feed is available at:

```text
https://raw.githubusercontent.com/FaithMediaAI/OpenHymns/main/data/manifest.json
```

Each manifest entry includes a `path`, `sha256`, `version`, `language`, `hymnCount`, `rightsStatus`, and `publishable` flag. Clients can cache files locally by `collection.id + version + sha256`.

## Layout

```text
config/sources.json      Source repos, clone paths, adapters, and source metadata
scripts/                 Clone/build tools
schema/                  JSON schema for generated data
sources/                 Local cloned source repos; ignored by git
data/                    Generated searchable catalog feed
releases/vX.Y.Z/         Versioned generated release folders
tests/                   Node test runner tests
```

## Client Flow

1. Fetch `manifest.json`.
2. Compare `version` and each collection `sha256` with local cache.
3. Download changed collection files only.
4. Download `indexes/search.json` for fast local search.
5. Keep all downloaded files available offline.

Generated hymn data keeps source repository, license, and rights-status metadata from the configured sources.

## Clean catalog and duplicate handling

Use `data/indexes/canonical.json` to browse unique lyrics. Each record groups the
same lyrics in the same language and links to every source hymn through
`references`. The `titles` and `search` indexes expose `canonicalId` for the same
purpose. The collection files preserve hymnbook membership, numbering, tune
variants, and source attribution; repeated appearances there are intentional.
Canonical counts exclude entries whose sources provide no lyrics.

Matching preserves accents, punctuation, word order, and language. The unique
lyric view ignores case, line wrapping, and stanza/chorus boundaries; those
performance details remain in each original collection entry. Equal titles
alone never justify deleting a hymn.
Within a collection, only records agreeing on number, title, full lyrics,
section layout, identifying metadata, and provenance are removed automatically.
Conflicting IDs receive stable content-derived suffixes. Titles recovered from
lyrics carry `titleSource: "first-line"`; retained records without lyrics carry
`contentStatus: "missing-lyrics"` in `data/quarantine.json`. These incomplete
source records are kept for review and excluded from collection/search results.
Missing source titles use the display label `Untitled` with `titleSource: "missing"`.

Every build regenerates `data/quality-report.json`: duplicate groups, removal
decisions, resolved ID collisions, ambiguous title/lyric matches, missing lyrics,
and unavailable upstream sources. `npm run validate` independently checks counts,
checksums, IDs, index membership, source references, and unique canonical lyrics.
Source omissions are reported separately from structural integrity errors.
See [data cleanup notes](docs/DATA_CLEANUP.md) for the current findings and limits.
