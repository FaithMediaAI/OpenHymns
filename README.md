# OpenHymns

OpenHymns is a versioned hymn catalog pipeline for SmartVerses desktop clients. It clones public hymn data repositories, normalizes their different JSON shapes into one schema, writes searchable language/collection indexes, and creates release folders that desktop apps can download and cache offline.

## Important Rights Note

Hymns are not automatically public domain because they are old, online, or stored as HTML/JSON. Text, tune, translation, and arrangement can each have separate rights. OpenHymns keeps source license and rights-review metadata on every collection so SmartVerses can curate what is safe to publish.

The code and schemas in this repository are MIT-licensed. Generated hymn data retains the rights and license status of its original sources.

## Quick Start

```bash
npm test
npm run clone:sources
npm run build
npm run release
```

The desktop app should start from:

```text
data/manifest.json
```

After this repository is published, the app can read:

```text
https://raw.githubusercontent.com/<org>/OpenHymns/main/data/manifest.json
```

Each manifest entry includes a `path`, `sha256`, `version`, `language`, `hymnCount`, `rightsStatus`, and `publishable` flag. The desktop app should cache files locally by `collection.id + version + sha256`.

## Layout

```text
config/sources.json      Source repos, clone paths, adapters, and rights status
scripts/                 Clone/build tools
schema/                  JSON schema for generated data
sources/                 Local cloned source repos; ignored by git
data/                    Generated catalog; ignored until intentionally published
releases/vX.Y.Z/         Versioned generated release folders
tests/                   Node test runner tests
```

## Recommended Desktop Flow

1. Fetch `manifest.json`.
2. Compare `version` and each collection `sha256` with local cache.
3. Download changed collection files only.
4. Download `indexes/search.json` for fast local search.
5. Keep all downloaded files available offline.
6. Display rights/license information in debug/admin views before enabling broad distribution.
