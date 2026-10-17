# Catalog cleanup — 17 October 2026

The 0.2.0 feed was rebuilt from the existing local source snapshots. Three
GPT-6 Luna workers handled text normalization, importer metadata, and duplicate
identity; the main worker integrated the changes and independently validated
the published files. Historical release folders and upstream clones were not
rewritten.

## Current inventory

| Measure | Count |
| --- | ---: |
| Source records examined | 18,870 |
| Empty, unidentifiable source placeholders skipped | 3 |
| Imported records, including source stubs | 18,867 |
| Source stubs quarantined | 230 |
| Searchable hymnbook entries | 18,637 |
| Unique same-language lyric records | 18,328 |
| Repeated appearances linked to a canonical lyric record | 309 |
| Collections / language codes | 44 / 25 |
| Titles recovered from source lyrics | 2,157 |
| Number-prefixed titles corrected | 1 |
| Conflicting hymn IDs resolved | 2 |

The 309 repeated appearances form 276 groups. They remain represented as
source references in `indexes/canonical.json`, so clients can show one lyric
record while retaining each hymnbook's number, title, and attribution. No
current within-collection entry met the stricter rule for deleting an entire
source record with identical number, title, metadata, section layout, and
provenance. The canonical index contains no repeated normalized lyric keys.

## Corrections

- Malayalam section selectors such as `chorus` and `verse-1` no longer become
  titles. Titles come from the indicated opening section, retain the original
  script, and are marked as derived.
- HymnFlow uses the actual `metadata.number`, rather than timestamp identifiers.
  Its 522 CAC English meter headings are stored as meter metadata, with the
  original title retained in `sourceTitle`. Three Yoruba `C M` headings receive
  the same treatment. Titles come from the later opening
  stanza. Scripture epigraph text remains preserved in the source sections.
- The Swahili and Luo GospelSounders collections use `sw` and `luo`, replacing
  the incorrect `ki` and `lu` paths. CIS collection names come from its source
  configuration. Categories and supplied author/tune metadata are retained.
- Known HTML formatting, character references, extra whitespace, and observed
  Windows punctuation encoding artifacts are normalized. Display text keeps
  accents and Malayalam joiners. Non-Latin titles have meaningful Unicode IDs.
- Standalone numbered stanza headings are parsed as labels. Five Tumbuka
  records containing only numbered headings have no recoverable lyrics in
  either local source copy and are quarantined.

## Source issues that still need evidence

`data/quarantine.json` retains 224 SDAH stubs, one Christ in Song stub, and five
Tumbuka heading-only records. They have no lyrics in the available source
snapshots, and are excluded from searchable collections. Missing source titles
are explicitly marked; `Untitled` is only a display placeholder. Three further
fully empty objects are skipped with exact source pointers in the report.

The quality report lists 206 groups for source review: 113 have the same lyrics
under differing titles, and 93 share a title but have different lyrics. These
can represent alternate titles, tune/stanza versions, or upstream transcription
mistakes. Equal titles do not establish duplicate hymns. The canonical lyric
view groups equal text, while the collection entries preserve the evidence.
Its identity deliberately ignores case, whitespace, line wrapping, and section
boundaries, but preserves language, accents, punctuation, and word order. It
does not claim that punctuation or wording variants are the same composition.

The flagged CIS copies were also checked against the original and `New_Files`
snapshots. The same Twi, Dholuo, Kinyarwanda, and Portuguese text repetitions
already occur there, so those local copies cannot supply a distinct replacement
lyric. The matching Swahili entries use alternate source titles. No replacement
text was inferred from a title alone.

An independent source audit matched all 246 references in the 113
same-lyrics/different-title groups to raw entries. Differences in imported text
were limited to the documented character cleanup and stanza-label parsing.
Trinity #52 keeps two explicit source versions with different tunes (`St. Peter`
and `Alsace`). Gospel Hymns #186, titled `God Of All Power And Truth And Grace`,
contains the same source lyrics as #175, `He Is Comimg Again`; the available
source does not establish a correct replacement for #186.

The CIS source labels one collection `Ndebele/IsiZulu` without a specific ISO
code. Its inherited `nr` mapping remains marked for verification in
`metadataReviews`; no more specific language claim was inferred.

Five hymnals advertised by the upstream GospelSounders index have no local
JSON files: MH1843, HSAB1852, HT1869, HT1886, and SAHB1867. The SQLite research
source still has no enabled importer. These limitations are recorded as source
warnings. Missing authors or other unsupported metadata are left unspecified.

## Repeatable checks

Run `npm test`, `npm run build`, and `npm run validate`. Validation reads the
generated feed independently and checks checksums, counts, ID uniqueness,
source membership, canonical lyric uniqueness, source references, search text,
and quarantine accounting. Source-review issues are reported separately from
integrity failures. The build writes a checksummed quality report and quarantine
file, so corrections and exclusions stay inspectable on future imports.

Clients upgrading to 0.2.0 should refresh their manifest and indexes together:
corrected hymn numbers, recovered titles, Unicode IDs, and language paths can
change lookup keys. Existing collection IDs continue to identify hymnbooks;
canonical IDs identify normalized lyric content within a language.
