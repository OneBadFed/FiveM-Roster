# Ranks, Dashboard and live Welcome statistics audit

Reviewed October 8, 2026. This is a source audit and local regression verification; the production spreadsheet was not changed or used as a test fixture.

## Code map

| Responsibility | Implementation |
|---|---|
| Settings rank labels, icons, loading, dirty tracking and save | `SettingsPanel.html`: Ranks section, `loadRanksList`, `renderRankLabels`, `rlToggle`, `fromData`, `saveAll` |
| Rank discovery/counts, stored icon merge, configuration saves | `RosterControlPanel.gs`: `cpRankIcons`, `rankIconsMap_`, `cpApplyConfig_`, `cpApplyConfig`, `cpAudit_` |
| Rank classification, section tags, groups and validation | `RosterConfig.gs`: RANKS / SECTION_TAGS / DASHBOARD_GROUPS schemas, `validateConfig_`, `materialize_`; `RosterSystem.gs`: `isDividerValue_`, `sectionCategory_` |
| Statistics, tags, Welcome boxes and patrol leaderboard | `RosterSystem.gs`: `dashboardStats_`, `statTagValue_`, `renderDashboardOnSheet_`, `renderWelcomeStatsBoxes_`, `renderLeaderboardOnSheet_` |
| Edit discovery, cached tab discovery and durable refresh | `RosterSystem.gs`: `onEdit`, `refreshDashboard_`, `refreshDashboardOnOneSheet_`, `runDeferredWorkCore_` |
| Public snapshot and refresh dependency guard | `RosterControlPanel.gs`: `publishPublicRoster`, `publishWelcomePage_`; `RosterPublishFast.gs`: `publishAssertSettled_` |

## Corrections

- Rank loading refreshes on section entry and after configuration saves; stale asynchronous responses cannot replace a newer result. Equivalent case/whitespace variants collapse into one rank. Configured RANK/TRAINING entries with no physical slots remain selectable, and stored icons remain available for retired ranks. UI label toggling uses the same whitespace normalization as the engine.
- Rank labels edit DASHBOARD_GROUPS; classification remains in Advanced → RANKS and uses the configured divider mode. Explicit rank assignments take precedence over section matches. The first matching group in each category wins; a member contributes to at most one headcount group.
- Duplicate rank classifications, colliding normalized group tags and incomplete/duplicate section labels fail validation before panel writes. Empty tables remain valid. Maps support group names such as `constructor` without inherited object properties affecting counts.
- Statistics start below the resolved roster header instead of assuming a fixed header position. Invalid/nonfinite/negative hours contribute zero. Active is the highest configured tier; inactive is the lowest; semi includes intervening tiers. Leave counts use configured leave statuses. With no tiers or leave statuses, their counters are zero and remaining counts still work.
- Digits survive tag normalization: Division 1 and Division 2 have distinct tags. Use `#group:division1` or `#group:active` for explicit groups; built-in `#active` retains its tier meaning. Deleted explicit groups become zero; deleted legacy aliases restore their literal tag instead of leaving stale numbers. Legitimate repeated tags no longer generate duplicate warnings.
- Live Welcome box updates replace the previous demo-only employee breakdown behavior. The renderer changes counter values and its own notes, preserving labels, merges, formulas, ordinary notes, formatting, dimensions and template objects. Explicit `#tags` override automatic box selection. An unchanged refresh makes no counter/leaderboard writes and does not dirty public publishing.
- Recognized Welcome titles include TOTAL EMPLOYEES / TOTAL MEMBERS, TOTAL HOURS / TOTAL PATROL HOURS, ACTIVE MEMBERS / ACTIVE EMPLOYEES / TOTAL ACTIVE MEMBERS, SEMI ACTIVE MEMBERS, INACTIVE MEMBERS, CURRENT LOAS/ROAS / CURRENT LOAS / CURRENT ROAS / MEMBERS ON LEAVE, OPEN SLOTS / AVAILABLE POSITIONS. Punctuation and spaces are ignored. A standalone counter uses the first row below the title merge. An employee breakdown uses existing group labels at the left and counts at the right of the title span; TOTAL is the overall member count. Missing group mappings display zero. Other layouts can use explicit tags.
- The leaderboard clears departed members, keeps numeric hours and writes names as literal rich text, including names beginning with `=`. It retains the existing five-entry limit and highest-hours-first order.
- Panel member mutations and relevant Settings changes queue derived/dashboard updates, including Dashboard ENABLE. Tier/rule/ladder changes first queue status recomputation. Config-sheet edits also queue recomputation and views. Multi-cell pasted tags are discovered even on a cached dashboard tab; the configured Welcome tab is always included in refresh discovery.
- Failed status recomputation blocks dependent views until retry. Failed sheet rendering retains its queued dashboard work. Successful value changes mark their source tab dirty for public publication. Manual full publishing settles queued work first; the publisher refuses to snapshot pending status/dashboard work. The public Welcome snapshot still preserves its existing F6:W7 exception.

## Ownership and activation

Dashboard ENABLE governs boxes, tags and the patrol leaderboard; off retains displayed values. An explicit tag can be removed by clearing its cell. Automatic Welcome boxes remain live while their recognized title/category labels remain; change the title, provide an explicit tag/formula/user note, or turn Dashboard off to take control back. An unmapped label does not automatically create or change configuration.

After upload, the installed worker carries queued updates; run Install / repair triggers once if the new worker triggers from the transfer fix are not installed. Updates are coalesced by the worker rather than requiring a full rebuild in a Settings save callback. A department's copied script must receive the updated code separately.

## Verification and limits

`node tools/dashboardcheck.js` executes the actual configuration validator/materializer, rank classifiers, statistics/renderers, rank endpoint, Settings label actions/save, edit discovery and durable dependency handling against synthetic sheets and service fixtures. Assertions include modular/reordered columns, configured uppercase training ranks, priority collisions, empty configuration, invalid hours, merged boxes, zero counts, preserved styles/formulas/notes, literal leaderboard names, clearing departed leaders, concurrent edits, disabled/cached refresh, protected destinations, stale replies and failure/backoff/retry. The existing public snapshot, privacy, queue, panel, group and transfer suites remain in the full gate.

`node tools/qa.js` passes all 26 suites/checks. HTML syntax/listener checks and schema-driven previews also pass. These additional local assertions are not added to the in-sheet QA scenario count. Actual Apps Script permissions, service quotas, merge behavior and the department's Welcome template need a live test copy: edit a member's hours/status, save a rank label/group, toggle Dashboard off/on, compare counters to roster totals, and confirm the public Welcome receives the result without changing its protected title block. No claim of complete live coverage is made.

## Guided Ranks and Dashboard interface — October 8, 2026

Ranks & badges now offers local search, an unassigned filter, checkmarked group assignments, a counted-under explanation, icon previews and adjacent immediate-save guidance. Group creation, renaming, ordering and deletion live in Dashboard; deletion has an Undo action. The guided group editor offers detected/configured ranks, section labels, retained custom categories and manual single-category entry. Empty-state instructions and inline overlap/counter-name warnings explain safe configuration. Priority is preserved explicitly in materialized configuration, including numeric-only group names.

The lazy, read-only cpDashboardPreview endpoint reuses dashboardStats_ and statTagValue_. It returns aggregate counts and actual queued-work flags, never member names or webhook secrets. The endpoint is present in both dispatch whitelists. Preview numbers use saved configuration and are marked separately from unsaved drafts. Refresh is available manually and every 30 seconds while Dashboard is visible; requests are deduplicated and stale responses ignored. No roster writer or refresh lock runs from this preview. Background reads preserve active fields; explicit selection refreshes retain open pickers and keyboard focus.

Counter placement is collapsed by default, groups counters by purpose and shows friendly names, saved current values and Copy buttons. Section appearance has a collapsed editor with named presets and swatches matching the Control Panel palette; custom existing tone values survive unchanged.

Verification: tools/rankdashboarduicheck.js exercises actual UI handlers, read-only endpoint, filtering, ordering, selection, custom entries, collision protection, deletion/undo, escaping, focus/caret preservation and failed/stale preview reads. tools/dashboardcheck.js additionally verifies real numeric-group priority with engine statistics. Generated previews and syntax/schema consistency pass. No live spreadsheet was edited, and rendered visual verification remains pending.
