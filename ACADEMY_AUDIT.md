# Academy and training audit

Reviewed October 7, 2026. Scope: source configuration, discovery, membership, editable training records, graduate placement, refresh entry points, shared group machinery and publishing integration. Local service doubles exercise the real builder functions; this is not a live Google Sheets certification.

## Code map

- `RosterExtras.gs`: `academyMarker_`, `isAcademyTab_`, `academyTrainingRanksFromLabels_`, `academyHeaderRow_`, `academyCols_`, `academyGradSection_`, `academyStems_`, `buildAcademySheets_`, `buildAcademySheetsCore_`, `buildAcademySheets`. This is the complete academy discovery and builder implementation.
- `RosterExtras.gs`: shared `groupNorm_`, `groupValueMatches_`, `groupIdentityProblem_`, `tabBandRanges_`, `derivedWriteRows_`, `derivedReport_`, `withDerivedLock_`. Group sheets exclude academy tabs so two builders do not overwrite the same view.
- `RosterConfig.gs`: `ROSTER_LAYOUT.TRAINING_KEYWORDS`, `RANKS` schema/validation and `rankList.trainingRanks`, dashboard group/section category parsing. TRAINING rank flags apply regardless of divider mode.
- `RosterControlPanel.gs`: assignment and move refreshes, signup seating/recovery refreshes, `cpApplyConfig`, `cpRunAction` buildAcademy case, public publishing dirty queue/sweep. Settings UI rank labels edit DASHBOARD_GROUPS; explicit training rank flags are in RANKS.
- `RosterSystem.gs`: academy menu item, `syncDerivedNow_`, `deferWork_`, deferred worker/retries, roster edit refresh, full dashboard refresh and member move recovery.
- `RosterTrust.gs`: snapshot restoration queues academy, groups and dashboard refresh.
- `RosterDevQA.gs`: department reset clears training flags, dashboard groups and derived member records alongside other department data.
- `tools/groupcheck.js`: real academy/group builder tests; `tools/resetcheck.js`, `tools/publishcheck.js`, `tools/privacycheck.js`, `tools/recoverycheck.js`: related reset, publishing and recovery boundaries.

## Intended behavior checked

An existing sheet is recognized by academy in its name or a top-left #academy marker. The builder does not create an academy template. A per-sheet marker overrides global training flags/labels. Explicit designations match exact normalized ranks; only the default path uses training keyword/probation matching. Training labels may reference a real rank that shares a section-tag name.

Headers and roster data start are resolved dynamically. Exact header matching precedes partial matching. Identity, rank and name mirror the roster; custom fields under academy-only section banners remain owned by the department. Training values and relative formulas follow member identity. ID matching uses displayed strings to avoid rounding long identifiers; ambiguous or missing identities stop a rebuild before content clearing.

Fixed rank bands must match active trainees and have enough capacity; overflow produces a skipped report, not silent omission or graduation. Existing trainees promoted to a nontraining rank retain their training records in the graduate area. Removed roster members are removed from this roster-derived tracker. A previously graduated member returning to training retains their record. Blank unused slots are cleared; custom band columns are retained.

Shared script locks prevent concurrent cooperating builders. Deferred jobs retain skipped/failed refreshes for retry. Assignment, moves, seating and snapshot recovery already refresh or queue academy changes. Training-related Settings saves now also queue academy/groups/dashboard and mark publishing dirty. Existing publishing policy and privacy exclusions still govern whether an academy sheet appears publicly; this change does not force a private training sheet into the public workbook.

## Fixes

1. Graduate boundary detection previously matched any cell containing GRADUATE, including a member's Graduated status, notes or the generated divider. Dedicated Graduate Log/History/Records banners now establish the fixed boundary. Other text remains data.
2. Graduate banner sizing previously incorporated unrelated merges up to four rows below the banner, potentially skipping valid graduate slots. Only merges intersecting the banner extend it.
3. Existing academy identity validation now uses the displayed key read used by preservation lookup, rather than potentially rounded numeric getValues IDs.
4. Training rank/label/section/column or roster layout/sheet settings could leave academy membership stale until a later roster edit. Successful related Settings saves now queue derived refreshes and publishing.

## Verification and limits

Graduate-log follow-up: a dedicated graduate area now retains at least three data slots and grows above its detected closing border when graduate count exceeds capacity. Growth uses the same framed-table copier as intake trackers, including format, validation, conditional formatting and row height. Clearing stops before the closing bar. Existing larger graduate areas are retained rather than trimmed. Tests cover a separate row-41 frame with extra columns and two-row expansion, plus builder initialization with no graduates.

All 15 repository check suites passed; Apps Script sources parsed and git diff whitespace validation passed. Added actual graduate-detector checks plus repeated refresh, graduation, return to training, record retention and roster removal checks. Existing tests cover explicit Cadet versus Cadet Supervisor, zero hours, custom fields/formulas, overflow refusal, duplicate identities and nested lock ownership.

Google's live merged-range, validation, formatting and authorization behavior still requires a test copy. Builders preserve destination layout rather than cloning every member's original formatting. Graduate validations are copied best effort from a template row; custom per-member styling is not an identity journal. Builder writes are not transactional: a service failure after clearing can require recovery from a snapshot/version history. Fixed bands intentionally do not grow automatically. Distinct ranks with identical word stems can select the same first best band; use distinct band labels. Name fallback is inherently weaker than exact IDs; use UNIQUE ID on both sheets. These are material operating limits, not guarantees established by local tests.

Suggested live acceptance: refresh twice; promote and return one trainee with custom exam values and a formula; remove a member; exhaust a band and verify refusal; change a training label in Settings and let the deferred worker run; verify allowed public output without exposing private columns. Perform this on a copy with a snapshot.
