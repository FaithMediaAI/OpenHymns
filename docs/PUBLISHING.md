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

The canonical index provides a unique lyric view while collection records retain
the original hymnbook memberships. Its count is `manifest.canonicalHymnCount`;
`manifest.hymnCount` counts source collection records. The manifest also checksums
the quality report. Validation must pass before publishing. Review source issues
in that report independently; validation cannot supply lyrics missing upstream.

Version 0.2.0 changes IDs where corrected titles/numbers or non-Latin title slugs
require it and moves incorrectly labeled language paths. Clients should refresh
the manifest and indexes together. Existing release folders are historical
snapshots and are not rewritten by `npm run build`.
