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

The default feed contains **one record per song per language**. Collection
files, `indexes/search.json`, `indexes/titles.json`, and `indexes/canonical.json`
all use the same unique song IDs. Apps concatenating collection files receive
one copy, without needing a separate deduplication step.

Copies in different hymnbooks are matched using normalized titles and lyric
evidence, allowing punctuation, repeated choruses, small wording differences,
and shorter verse selections. Different songs sharing a title remain distinct.
The most complete source version supplies the displayed lyrics; its original
wording is preserved. Other hymnbook titles, numbers, attribution, topics and
tune metadata are retained in `references` and `alternateTitles`. The original
source texts remain accessible through their repository/path references.

Each song is stored in one representative owner's collection. `collectionIds`
lists **all** hymnbooks containing that song; use it for hymnbook filters rather
than just `collectionId`. Collection `hymnCount` counts stored unique rows,
`membershipCount` counts songs belonging to that book, and `sourceHymnCount`
counts its original imported entries. The manifest's `hymnCount` is the unique
song count and `sourceHymnCount` is the count before global song grouping.

Version 0.3.0 replaces the older feed that exposed separate hymnbook copies.
Clients must replace cached collections and indexes together when upgrading;
appending new rows to a 0.2.0 cache will retain the old duplicates.

Titles recovered from
lyrics carry `titleSource: "first-line"`; retained records without lyrics carry
`contentStatus: "missing-lyrics"` in `data/quarantine.json`. These incomplete
source records are kept for review and excluded from collection/search results.
Missing source titles use the display label `Untitled` with `titleSource: "missing"`.

Every build regenerates `data/quality-report.json`: duplicate groups, removal
decisions, resolved ID collisions, ambiguous title/lyric matches, missing lyrics,
and unavailable upstream sources. `npm run validate` independently checks counts,
checksums, IDs, unique primary/index rows, hymnbook memberships, source references,
and source/quarantine accounting.
Source omissions are reported separately from structural integrity errors.
See [data cleanup notes](docs/DATA_CLEANUP.md) for the current findings and limits.
