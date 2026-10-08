# Settings panel audit

Reviewed the Settings data contract, section rendering, controls, dropdowns, search, previews, dirty tracking, saving, Discord templates, rank uploads, accessibility, and responsive styles.

## Fixes

- October 8 Ranks/Dashboard audit: rank requests refresh and reject stale replies; label matching collapses whitespace like the engine; configured ranks with no slots are included. Dashboard help/tag copying supports live Welcome boxes and explicit digit-preserving group tags. Relevant saves and panel member mutations queue statistics updates. The actual label add/delete/toggle/save and server validation paths are covered by `tools/dashboardcheck.js`; see [DASHBOARD_AUDIT.md](DASHBOARD_AUDIT.md).
- October 8 status-save regression: the status cards still rendered the retired Announce control and appended its fifth value when adding a row. The schema accepts Status / Kind / MinHours / Color only. Removed that control/handler and changed new status rows to four cells, retaining the server's extra-data rejection. The regression executes the actual add/color/save handlers through prospective server validation for all status kinds and an empty table.
- Search now matches the friendly labels and displayed help used by the fields. Discord and Ranks section descriptions contribute to navigation search counts.
- Dropdown options normalize values and labels, support keyboard navigation and selection, return focus on dismissal, expose expanded state, show filtered empty results, and fit inside the viewport.
- Date previews preserve quoted words and escaped apostrophes rather than replacing their letters as date tokens.
- Blank embed field drafts retain their indexes, preventing subsequent editing or deletion from targeting another field.
- Controls receive accessible names; interactive chips, token insertion, label deletion, and rank uploads support keyboard activation. Focus exposes status deletion controls.
- Custom Discord and Ranks views show configuration errors rather than bypassing issue rendering.
- Removed malformed CSS, supplied the missing informational-callout background token, added narrow-window layouts, and reduced spinner/transition motion when requested.

## Verification

`node tools/settingscheck.js` checks displayed search text, quoted date patterns, and blank embed drafts. The existing configuration, table, public-mirror, publishing, performance, startup, member-selection, reset, save-safety, and HTML checks also passed locally. The Settings preview confirms all 75 referenced section keys are served; COLUMNS intentionally belongs to the Control Panel.

Browser verification remains incomplete: the available Edge executable returned no rendered DOM in headless mode, and the browser connector reported Edge unavailable. The generated preview is `tools/.preview/SettingsPanel.preview.html`. No live spreadsheet, webhook, upload, or deployment was exercised.

## Remaining limits

- Search highlights section matches and filters ordinary settings; it does not globally filter every custom table, rank, and embed field.
- Date examples use the viewer's local time; they do not query the spreadsheet's time zone.
- Actual Google permissions, Apps Script quotas, image encoding differences, and live webhook delivery require integration testing in a test roster.

Changes are local until committed and pushed.

## Ranks and Dashboard usability update

The guided interface now replaces the Dashboard raw group/category table with selections, explicit priority and deletion undo. Ranks search and its unassigned filter operate independently of sidebar search. Badge previews and immediate-save guidance clarify icon persistence. Dashboard displays saved Welcome statistics through a whitelisted read-only endpoint, with real queue indicators and an unsaved-draft notice. Counters and section appearance are collapsed by default. Focused inputs survive background refreshes. See DASHBOARD_AUDIT.md and tools/rankdashboarduicheck.js for implementation and coverage.
