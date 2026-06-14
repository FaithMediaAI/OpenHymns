# Publishing OpenHymns

OpenHymns publishes a static generated catalog in `data/`.

## Build

```bash
npm run build
```

This writes:

```text
data/manifest.json
data/indexes/*.json
data/collections/**/*.json
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
