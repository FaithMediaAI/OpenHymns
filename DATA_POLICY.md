# OpenHymns Data Policy

OpenHymns can ingest any configured source into local generated data, but public release decisions must use the collection-level rights metadata.

## Rights Status Values

- `public-domain-verified`: The collection has been reviewed and can be redistributed.
- `repo-license`: The source repository declares a license that appears to permit redistribution.
- `copyleft-review`: The source repository uses GPL/AGPL or similar terms that may affect redistribution.
- `needs-review`: No clear data license or rights status has been confirmed.
- `unsupported`: The source is cloned for research but not imported by the current build.

## Publishing Rule

Before publishing generated hymn data as a public GitHub release, review every collection where `publishable` is `true`. Keep `publishable` as `false` for collections that are unknown, copied from copyrighted hymnals, or legally ambiguous.

## Why This Exists

Many hymns are public domain, but not all hymn texts, translations, tunes, or arrangements are public domain. A hymnal being available on GitHub does not prove redistribution rights.
