# Publishing OpenHymns

OpenHymns can build a complete local catalog, but the tracked public `data/` feed should contain only collections marked `publishable: true`.

Use `npm run build:public` before publishing to `main`. This writes `data/manifest.json`, indexes, and collection files for the public feed only.

## Recommended Public Feed

After rights review, publish one of these:

1. **GitHub Releases assets**
   - Attach `manifest.json`, `indexes/*.json`, and `collections/**/*.json` from `releases/vX.Y.Z/`.
   - Desktop app fetches the latest release manifest and downloads changed assets by `sha256`.

2. **Tracked `data/` folder**
   - Commit `data/manifest.json`, `data/indexes/*.json`, and selected `data/collections/**`.
   - Desktop app reads `https://raw.githubusercontent.com/<org>/OpenHymns/main/data/manifest.json`.

## Versioning

The release version comes from `config/sources.json`.

- Patch: importer fixes, typo cleanup, metadata corrections.
- Minor: added sources, new collections, schema-compatible fields.
- Major: breaking schema or desktop-client contract changes.

Each collection and index has a SHA-256 checksum in `manifest.json`, so the desktop app can download only changed files and keep everything cached offline.
