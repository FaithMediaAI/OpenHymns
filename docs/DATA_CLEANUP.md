# Catalog cleanup — 17 October 2026

## One song in the default feed

Version 0.3.0 fixes the default catalog, rather than offering deduplication only
through an optional index. Previously, a client loading the collection files or
search index could still see five copies of `How Great Thou Art`. Every current
primary collection and index now uses one song ID per song per language.

| Measure | Count |
| --- | ---: |
| Source records examined | 18,870 |
| Fully empty placeholders skipped | 3 |
| Imported records, including source stubs | 18,867 |
| Source stubs quarantined | 230 |
| Retained source hymnbook entries | 18,637 |
| Published unique song records | 15,239 |
| Repeated hymnbook entries consolidated | 3,398 |
| Collections / language codes | 44 / 25 |
| Source titles recovered from lyrics | 2,258 |

All 18,637 retained source entries remain represented in numbered `references`.
The 3,398 repeated entries belong to 1,819 grouped songs. They are no longer
separate search results or duplicate rows in different collection files.

## Sampled decisions

| Source sample | Decision |
| --- | --- |
| How Great Thou Art: 5 matching-title copies | One song; shorter verse selections, wording and chorus placement vary |
| Amazing Grace: 6 matching-title copies | One song; editions select different verses, and additional alternate-title entries are linked |
| What a Friend We Have in Jesus: 11 copies | One song with all hymnbook references |
| High in the Heavens, Eternal God: 2 copies | One song; both St. Peter and Alsace tune references retained |
| Holy, Holy, Holy: 9 matching-title entries | Two different songs; each song's hymnbook copies grouped separately |

Titles alone do not identify a composition. Matching first compares lyrics in
the same language, then uses normalized titles and shared verse content to join
editions with small wording changes, repeated choruses, punctuation differences,
and selected verses. A shared chorus alone cannot combine unrelated verses.
A complete same-titled edition can support shorter editions with different
verse selections. Different-title joins require stronger lyric evidence.
Accents and non-Latin combining marks remain significant.

The most complete source version supplies the displayed text, with its wording
unchanged. A scripture epigraph does not count as an additional verse when
choosing a representative. Alternate source metadata, titles, numbers, authors,
topics, tune names, repository paths and rights metadata remain attached as
references. Full source-specific lyric variants can be traced to those original
repository/path references; the feed publishes a single selected lyric copy.

## Collection storage and filtering

Each song has one storage owner, `collectionId`, so concatenating all collection
files yields one row per song. `collectionIds` lists every hymnbook containing
that song. A hymnbook filter must match this list and use the corresponding
reference number. A book may own no storage rows while still have song
memberships; its `membershipCount` describes those memberships.

`manifest.hymnCount` counts unique songs. `manifest.sourceHymnCount` counts source
entries before global grouping. Collection `hymnCount` counts owned storage rows,
`sourceHymnCount` counts original source entries, and `membershipCount` counts
unique songs linked to that hymnbook. Search/title indexes contain one metadata
row per song; canonical/collection files provide the full selected song text.

Version 0.3.0 requires replacing old cached collections and indexes together.
Appending the new data to an older cache leaves the old duplicate rows visible.

## Metadata corrections retained

The build recovers Malayalam and placeholder Yoruba titles from opening lyrics,
uses HymnFlow's actual hymn numbers instead of timestamp IDs, moves proven meter
headings into meter metadata, and uses source-provided hymnbook names. Swahili
and Luo collections use `sw` and `luo` paths. Known HTML formatting, character
references, whitespace and Windows punctuation artifacts are normalized while
preserving accents and Malayalam joiners. Every derived title is marked and
replaced source titles are retained where available.

## Remaining source issues

`data/quarantine.json` retains 224 SDAH stubs, one Christ in Song stub, and five
Tumbuka heading-only records. Both available Tumbuka snapshots lack the lyrics.
Missing source titles are explicitly marked; `Untitled` is a display placeholder.
These records are excluded from search and song collections. Three fully empty
objects are skipped with exact source pointers in the quality report.

The quality report lists 161 unresolved title/text comparison groups. They can
contain genuinely different songs, incompatible editions, or source mistakes;
no replacement words were invented. For example, local copies repeat the same
text under different Twi and Dholuo titles. Gospel Hymns #186 also repeats #175
under a different title. Original and backup snapshots offer no replacement
text for these records. The same text is grouped as one song with its original
numbered source references.

One source labels a collection `Ndebele/IsiZulu` without a precise ISO code. The
inherited `nr` mapping is marked for source-owner verification. Five advertised
GospelSounders hymnals lack local JSON files (MH1843, HSAB1852, HT1869, HT1886,
SAHB1867), and the SQLite research source has no enabled importer. These limits
remain visible in the report. Unsupported author or other metadata is left
unspecified rather than inferred.

## Repeatable checks

Run `npm test`, `npm run build`, and `npm run validate`. Published-data regression
tests check the sampled songs in the default search index and concatenate every
collection to ensure each primary song appears once. Synthetic matching tests
cover shorter editions, repeated refrains, real title collisions, unrelated
verses sharing a chorus, medleys, different languages, Unicode marks, tune
references, representative selection and input-order stability.

Validation independently checks checksums, unique primary/index rows, counts,
all original source references, hymnbook memberships, search metadata and
quarantine accounting. `data/quality-report.json` records grouping decisions,
source anomalies and unavailable imports. Historical release snapshots and
upstream source clones are not rewritten by a normal build.
