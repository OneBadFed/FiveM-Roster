# Fresh Dev/QA framework

Built October 7, 2026. The old 23-section Apps Script suite is not restored. `RosterQA.gs` contains new assertions, deterministic scenarios, a new runner and explicit sandbox fixtures. Legacy tests were not copied into it.

## Running it

- Local/CI: `node tools/qa.js`. It runs all checks, continues after failed suites, exits nonzero if any fail and writes a machine-readable report to ignored `tools/.qa/latest.json`. Every subprocess has a one-minute timeout. GitHub's upload step is gated by this command.
- Apps Script: Dev / QA → QA — all new scenarios, QA — core logic, or QA — Sheets platform. Every run creates a blank **🧪SANDBOX_…** tab inside the current internal roster. Platform scenarios reset and reuse it; the native-copy scenario briefly creates one run-owned helper tab. After testing (including failed or skipped cases), only registered helper tabs are removed and the **same sandbox tab** becomes **🧪 QA Results**. Its sheet ID and direct link are retained, and the report is selected. Older reports stay intact; subsequent reports receive numbered names. Tests use invented names, identifiers and values. No separate workbook is created.
- Existing demo/reset commands are separate and are never called by a QA run.

The 271 core scenarios run in Node and Apps Script. Seven shared platform scenarios run against a newly written local cell model and can run against Google's actual services, including a native snapshot paste across merged banners with literal text and long identifiers, and support-sheet filters, retention and mixed date/text ordering. An additional 44 newly authored Node fault scenarios inject scheduling, HTTP, prospective settings and endpoint failures. Runner lifecycle assertions test report failures, busy locks, deadlines and suppression restoration separately. Existing repository regression suites remain additional protection; they are not counted as freshly authored scenarios.

## Coverage matrix

| Area | Fresh coverage | Additional regression protection |
|---|---|---|
| Statuses | Threshold edges, monotonicity, exact rank overrides, every rule operator, fixed points, cycle termination | cfgcheck, hardeningcheck, resetcheck |
| Configuration | Defaults, empty statuses, malformed ladders, duplicate floors/thresholds, bad header rows, real block read/write/grow/empty roundtrip, colour preview | cfgcheck, settingscheck, startupcheck |
| Intakes | Hours parsing, precision-safe synthetic submission keys, one-millisecond differences, blank keys | tablecheck, recoverycheck, selectioncheck |
| Academy/groups | Exact word boundaries, missing/duplicate identities, header priority, stems, 75 column positions, real merged graduate banner | groupcheck, resetcheck |
| Row growth | Frames at three different widths including more than 26 columns; closing border, checkbox validation, conditional rules, fonts, heights, number formats and long text ID | tablecheck, welcomecheck |
| Support sheets | Shared sandbox checks descending record order, bottom retention, filter resizing with retained criteria and legacy Date/ISO week ordering. Node regressions exercise all six actual support-sheet writers, recent-edit readers, complete snapshot pruning/restore payloads, custom columns, coverage footer/empty views and nested/busy/failure locks | qaplatform, startupcheck, recoverycheck, errorcheck |
| Scheduling | Auto-reset on/off × every cadence × weekday/off; invalid/future markers | startupcheck, recoverycheck |
| Error handling | Secret redaction, circular context, bounded diagnostics, transport errors, 2xx/4xx/429/5xx responses, bounded retry | errorcheck |
| Panel saves | Prospective invalid values/tables, mixed valid/invalid edits, no writes after refusal, protected keys, excess table columns | settingscheck, panelopencheck, selectioncheck |
| Dispatch | Prototype keys, administrative functions and non-endpoints refused | errorcheck, hardeningcheck |
| Welcome/public | Existing integration regressions test dimensions, excluded F6:W7, privacy, retries and partial publishing | welcomecheck, publishcheck, privacycheck, tablecheck |
| Transfers/signup recovery/reset | Existing injected-failure and exact-identity workflows retained in the local gate | recoverycheck, resetcheck |
| UI/performance | Existing HTML listener/syntax, panel boot, selections and service-count checks retained | htmlchk, panelopencheck, selectioncheck, perfcheck |

Fresh cases found and fixed two defects: missing-comma status ladders accepted an extra colon in a status name; monthly resets were blocked by a weekly OFF value despite monthly trigger installation being valid.

## Isolation and result semantics

The in-sheet runner acquires the shared script lock before work and releases it after failures. It temporarily suppresses Discord and restores the prior value. It records pre-existing tab IDs and rejects any of those IDs as a sandbox **before** resetting or writing a report. Fixture APIs receive the explicit run-owned sandbox; no production reset, sync, snapshot restore, publishing, form creation or trigger installer is invoked. Config fixture writers invalidate execution/cache state as their normal implementation requires, but never write live configuration values. Cleanup removes only IDs registered as helper tabs during this run, never unrelated tabs, older reports or interrupted sandboxes. The original sandbox ID survives as the report. Its content, merges, conditional rules, banding, validation, charts/images, hidden/frozen rows/columns and dimensions reset before the report is written. Cleanup failures appear in results. A hard Apps Script termination cannot execute `finally`, so an unfinished sandbox can remain inside the roster.

QA tabs retain the 🧪 prefix throughout testing/reporting. Public publishing and edit-audit notifications skip these tabs; Settings pickers and dashboards already exclude that prefix. Config's fallback marker scan also skips QA tabs, so a temporary `RE_CONFIG` fixture cannot be mistaken for a renamed live Config sheet.

## Results appearance

The report follows Config's dark palette, Arial text, monospace case IDs, blue section headers and alternating row fills. A top summary shows passed, failed, not run, total tests and elapsed seconds. The complete case table below includes area, PASS/FAIL/NOT RUN, milliseconds and wrapped failure details. Green/red/amber status cells and the tab colour distinguish outcomes. The title/summary/header remain frozen, and the case table has a filter. Rows are sized to their text, unused columns are hidden, and the sheet ends with two dark padding rows. Summary counts are static observations of this run, not formulas or live roster data. Diagnostic strings are text-safe even when they begin with `=`.

Each test has a unique ID, area, PASS/FAIL/NOT RUN result, duration and bounded failure detail. One failed case does not prevent subsequent cases. The case runner stops starting new tests after three minutes, leaving time for reporting. Unstarted cases are NOT RUN, never PASS. Google service calls already in progress cannot be cancelled by that budget. Tab-creation and report failures are reported as runner failures; no successful formatting attempt substitutes for failed feature assertions. Local pure tests deny access to workbooks/network/triggers.

## What has and has not been verified

Local checks can verify service contracts, deterministic state transitions and failure recovery using service doubles. They cannot establish Google's real permissions, recalculation, concurrent trigger scheduling, dropdown chip colours, cross-workbook publishing or browser interactions. The Sheets-platform menu is provided specifically for those real formatting API checks, but has not been executed in the signed-out browser session. Publishing and member-writer workflows are not exercised on production by the in-sheet menu.

This finite test set is not proof that every possible input or platform outage works. Whole-roster/browser acceptance still requires a separate authorized copy with fake members/forms and a test public workbook: submit/replay an intake; approve/deny; move/graduate; restore; reset; publish; verify every protected field and frame visually. Platform outcomes must be recorded before calling them live verified. The report intentionally distinguishes the fresh cases, inherited regressions and this outstanding acceptance layer.
