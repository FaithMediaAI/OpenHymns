# Publishing OpenHymns

OpenHymns publishes a static generated catalog in `data/`.

## Build

```bash
npm run build
npm run validate
```

This writes:

```text
data/manifest.json
data/indexes/*.json
data/collections/**/*.json
data/quality-report.json
data/quarantine.json
```

## Release Folder

```bash
npm run release
```

This writes the same generated catalog to `releases/vX.Y.Z/`.

## Versioning

The release version comes from `config/sources.json`.

- Patch: importer fixes, typo cleanup, metadata corrections.
- Minor: added sources, new collections, schema-compatible fields.
- Major: breaking schema or client contract changes.

Each collection and index has a SHA-256 checksum in `manifest.json`, so clients can download only changed files and keep everything cached offline.

The primary collection files and every song index use one record per song per
language. `manifest.hymnCount` and `manifest.canonicalHymnCount` both count unique
songs; `manifest.sourceHymnCount` counts original source entries. Each song has
one storage owner (`collectionId`) and all hymnbook memberships (`collectionIds`)
plus numbered source `references`. Collections expose `membershipCount` for
filter counts. The manifest also checksums the quality report and quarantine.
Validation must pass before publishing. Review source issues separately;
validation cannot supply lyrics missing upstream.

Version 0.3.0 changes primary IDs to song IDs and removes repeated hymnbook rows
from all default collections and indexes. Clients should replace cached
collections and indexes together, use `collectionIds` for book membership, and
read alternate hymn numbers from `references`. Historical release folders are
not rewritten by `npm run build`.
