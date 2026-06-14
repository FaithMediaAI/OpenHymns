# Publishing OpenHymns

OpenHymns currently builds a complete local catalog into `data/` and `releases/vX.Y.Z/`. Those folders are ignored by git by default because many collections still have `rightsStatus` values such as `needs-review` or `copyleft-review`.

## Recommended Public Feed

After rights review, publish one of these:

1. **GitHub Releases assets**
   - Attach `manifest.json`, `indexes/*.json`, and `collections/**/*.json` from `releases/vX.Y.Z/`.
   - Desktop app fetches the latest release manifest and downloads changed assets by `sha256`.

2. **Tracked `data/` folder**
   - Remove `data/` from `.gitignore` after the publishable set is curated.
   - Commit `data/manifest.json`, `data/indexes/*.json`, and selected `data/collections/**`.
   - Desktop app reads `https://raw.githubusercontent.com/<org>/OpenHymns/main/data/manifest.json`.

## Versioning

The release version comes from `config/sources.json`.

- Patch: importer fixes, typo cleanup, metadata corrections.
- Minor: added sources, new collections, schema-compatible fields.
- Major: breaking schema or desktop-client contract changes.

Each collection and index has a SHA-256 checksum in `manifest.json`, so the desktop app can download only changed files and keep everything cached offline.
