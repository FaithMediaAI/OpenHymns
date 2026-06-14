# OpenHymns Data Notes

OpenHymns preserves source metadata on every generated collection so clients can display where each hymn came from.

## Rights Status Values

- `source-repository`: The collection was imported from the configured source repository.
- `repo-license`: The source repository declares a permissive license.
- `unsupported`: The source is cloned for research but not imported by the current build.

## Generated Data

The code and schemas in this repository are MIT-licensed. Generated hymn data keeps the source repository, license, and rights-status values declared in `config/sources.json`.
