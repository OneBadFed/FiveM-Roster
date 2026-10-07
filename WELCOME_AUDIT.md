# Welcome Page audit and public mirror

The code audit covered statistics and stat tags, cached discovery and refresh, leaderboard rendering, promotions, demo statistics/leadership, Welcome tab configuration, and public publishing.

## Corrected behavior

- The Welcome Page has its own full-sheet publishing path. It no longer uses header matching, public formula preservation, arbitrary protected ranges, or the self-computing-tab bypass. The sole exception is F6:W7, whose public content, formatting and merges are preserved.
- A native sheet snapshot carries the complete grid and sheet design, including the blank canvas. Every source row height and column width is reapplied explicitly. Rich text and hyperlinks are restored after formula results are frozen to their internal values.
- Google native sheet copying carries sheet objects and sheet settings rather than attempting to reconstruct them from cell backgrounds alone. Actual charts, images, drawings, conditional formatting and validations must still be checked with the department's template in Google Sheets.
- A missing Welcome Page is created on the public workbook. Leading emojis resolve to the configured name without creating another copy when a normalized equivalent already exists.
- The previous public tab is retained until preparation succeeds. Other public tabs' formulas referencing it are restored during replacement. Preparation failures preserve the previous copy and flow through the publisher's existing failure/retry handling.
- Section-based headcount groups now follow first-match priority, matching rank-based grouping. Invalid/nonfinite or negative hours cannot poison dashboard totals.
- Cached dashboard and promotions discovery includes the configured Welcome Page. Malformed saved promotion records are ignored rather than aborting the table.
- Demo employee totals and leadership boxes both populate; a successful first box no longer short-circuits the second.

## Operational details

The public Welcome Page is a snapshot of the internal page's computed results at publication time. Its formulas do not independently recalculate between publishes. This prevents formulas referring to private/internal sheets from breaking or revealing those dependencies on the public file.

Native replacement changes the public Welcome Page's sheet ID (`gid`). Workbook links remain valid, but saved direct links to its previous `gid` need updating. Literal hyperlinks/strings referring to that old ID are not automatically rewritten. Unlike data-tab publication, this path copies all Welcome Page content intentionally; put only public-facing content on that page.

The snapshot uses additional Google Sheets calls and temporary sheet copies. Failures before the swap preserve the old public tab; Apps Script timeout or an external concurrent edit during the swap is not a transactional operation. Existing publisher locks/retry flags remain in place.

## Verification and remaining live checks

`node tools/welcomecheck.js` tests snapshot dimensions, style/object metadata using mocks, full row/column dimensions, title preservation in F6:W7 and equality elsewhere, computed values, dependent public formulas, preparation failure preservation, dashboard counts, group priority, and demo boxes. Existing configuration, publishing, table and performance checks also pass.

No live workbook was available to inspect or execute against in this task. Local tests cannot certify a 100% visual match in Google Sheets. After deployment, run Publish Now on a test copy and compare the internal/public Welcome tabs for all merges, formatting, conditional rules, rich text, hyperlinks, images/charts/drawings, hidden/frozen dimensions and full grid size; also test changing a title, resizing a row/column, adding/removing rows/columns, and dashboard updates. The production roster was not modified, and these changes have not been pushed or deployed.
