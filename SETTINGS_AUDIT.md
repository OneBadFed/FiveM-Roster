# Settings panel audit

Reviewed the Settings data contract, section rendering, controls, dropdowns, search, previews, dirty tracking, saving, Discord templates, rank uploads, accessibility, and responsive styles.

## Fixes

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
