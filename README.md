# OpenHymns

OpenHymns is a versioned, normalized hymn catalog. It gathers hymn data from public repositories, converts different JSON shapes into one schema, writes searchable indexes, and publishes a static `data/` feed that apps, websites, and tools can download and cache offline.

## Quick Start

```bash
npm test
npm run clone:sources
npm run build
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
