# Roster menu audit

Reviewed all 23 Roster callbacks and all 6 Dev / QA callbacks, their service boundaries, trigger forwarding and overlapping workflows. The implemented menu has **8 top-level Roster entries** and **3 Dev / QA entries**. Every existing action remains available. Menu construction reads no spreadsheet data, config or network services; missing optional modules omit their actions and empty submenus.

## Simpler navigation

| Roster entry | Purpose / contained actions |
|---|---|
| Open Control Panel | Everyday member management, connections, snapshots and health |
| Engine Settings | Guided configuration |
| Review Roster Signups | Direct access to the applicant queue |
| Refresh & Update All | Form imports, reconciliation, ordering, derived views, integrity and final publishing |
| Public roster | Publish now; set up / change the public file |
| Form sync | Leave forms → tracker; signup form → review; patrol forms → log |
| Maintenance | Add rows; renumber callsigns; refresh views; integrity scan; recovery; column configuration; Config restyling; activity capture/reset |
| Setup | First-Run Setup; install/repair triggers; ID type |

Dev / QA exposes **Run all QA tests**, **More testing tools** (core-only, platform-only, cleanup), and **Demo / department reset**. Demo loading now explicitly says it overwrites the copy; it is not labeled a preview.

Consolidation recommendation implemented: keep panels and the everyday refresh visible; group individual imports, derived-sheet builders and infrequent setup tools. Keep destructive tools inside maintenance/demo groups with their confirmations. Preserve individual repair commands because they let operators retry one failed step without rerunning everything. No function, trigger, panel endpoint or capability was deleted.

## Findings fixed

1. **Refresh could claim success after errors and publish stale views.** It now imports all three linked form types, reconciles patrol credits before recalculating statuses, refreshes derived views while serialized, flushes, releases the lock, then publishes. Its summary distinguishes failure, unavailable/off features, builder skips, integrity findings and incomplete publishing. A failed flush prevents the final publish. A busy initial lock performs no refresh writes. Patrol entry points reuse an existing writer lock rather than releasing the caller's lock.
2. **Library installations lacked public-update trigger handlers.** `TEMPLATE-SHIM.gs` now forwards `publishOnChange`, `publishSweep` and the legacy publish handler. `publishCatchup` forwards its event, including the trigger UID that protects a newer catch-up from an old delayed event. Bound installations already have the handlers in the engine. Library users must update both the shim and their deployed library version.
3. **Multi-row insertion could format only the first row or erase a merged group label.** Each new row now receives formatting, validation and conditional formatting. Vertical group columns are excluded from row copying/clearing; the containing band extends over inserted rows. Heights are set in one batch. Template discovery uses one rank-column read. Invalid, fractional, blank or out-of-range counts cause no insertion, and a missing data-row template is refused. Insertion and callsign renumbering use the shared writer lock.
4. **Manual signup import sorted after releasing its import lock.** Import and sorting now run within one serialized operation. Leave import no longer hides an ordering failure behind a success message; it explains that imports were retained and ordering needs retrying.
5. **Demo loading was misleading and could overwrite table borders.** It always requires `LOAD DEMO`, serializes writes, suppresses notifications and restores suppression even after errors. LOA, patrol and signup clears exclude the closing border and growth uses the existing styled-row expansion helper. History capacity grows when necessary. Optional seeding failures appear in the summary; sorting failures propagate. Demo loading still replaces records and is intended for a copy.
6. **QA cleanup missed current reports and could delete a running sandbox.** Cleanup recognizes legacy and current/numbered report names, shows the proposed tabs, acquires QA's writer lock and deletes only reviewed IDs with recognized names. Cancellation/busy locks delete nothing. It refuses to delete the workbook's last tab and reports partial deletion if a service error occurs. Department reset restores its prior notification-suppression state and logs failures.
7. **Configuration menu writers were not serialized.** First-run writes, column sync, Config restyling and ID-type changes now use the shared writer lock. Startup and restyling display their completion dialogs after releasing it. ID-type validation failures explicitly state that the setting was saved but validation needs repair.
8. **Public linking ignored the first publish result.** The link dialog now distinguishes completed, busy and incomplete first publishes instead of implying that linking proves the initial mirror succeeded.

## Every action reviewed

| Action / handler | Behavior and verification |
|---|---|
| Control Panel / `openControlPanel` | Lightweight HTML shell with deferred data; panel-open and HTML regressions retained. Optional-file guard added. |
| Engine Settings / `openSettingsPanel` | Deferred settings shell, validated config writes and dirty-state handling; settings/panel regressions retained. Optional-file guard added. |
| Review Signups / `openSignupsDialog` | Opens the queue; signup routing/approval/recovery/privacy regressions retained. |
| Refresh All / `refreshDashboard` | Ordered serialized stages and visible partial results; each stage receives fault injection plus missing-tab, busy, skipped-builder and publishing tests. |
| Leave sync / `manualSyncLOA` | Uses idempotent leave import; busy lock stops sorting. Ordering failure now surfaces as partial completion. Empty leave configuration preserves submissions. |
| Signup sync / `manualSyncSignups` | Disabled/missing mappings are explained. Import and final ordering share one lock. Signup deduplication and journal recovery tests retained. |
| Patrol sync / `manualSyncPatrol` | START_END imports to the log; DURATION/logless credit path retained. Nested ownership fixed; existing credit/import recovery and validation tests retained. |
| Activity reset / `weeklyResetWithHistory` | Existing confirmation, writer lock, period snapshot/checkpoints and protected-status behavior retained; reset/recovery regressions pass. |
| Integrity / `scanIntegrity` | Writes current findings to the themed, filterable log and preserves configured checks. Existing config/group/identity tests retained. Findings are not treated as a clean refresh. |
| Recovery / `recoverMemberMove` | Recovers pending transfers, assignments and signup seating. Renamed to **Recover interrupted member changes** to reflect its actual scope. Patrol and reset recovery retain their separate journal paths. |
| Publish now / `publishPublicRosterNow` | Trigger repair precedes force publishing; busy and incomplete results are surfaced. Existing native-copy, privacy, dimensions, incremental publish and Welcome regressions pass. |
| Public setup / `setupPublicRoster` | Link/create, reject internal-file self-link, install automatic triggers, perform initial publish. Initial publish status is now included. Existing trigger/link tests pass. |
| Add rows / `addMemberRow` | Strict 1–100 input, real row template, serialized insertion, every new row copied, band label preserved, height/renumbering applied; service-double tests include merged/unmerged templates. |
| Callsigns / `updateUnitNumbers` | Configured format, divider exclusion and header-resolved unit column retained; writes now serialized and public update requested afterward. |
| Groups / `buildGroupSheets` | Editable member-keyed group views, custom columns preserved, missing identity stops affected rebuild; group and recovery tests pass. |
| Academy / `buildAcademySheets` | Editable training records and graduation log retained; group/platform scenarios cover member mapping, overflow and record preservation. |
| Activity view / `buildActivityPanel` | Linked patrol-response view; disabled/missing response setup returns an explanation. Existing correlation/feature regressions retained. |
| Discord ID / `idTypeDiscord` | Persists DISCORD policy; validation failures surfaced after saving; serialized. Existing ID values are retained. |
| Community ID / `idTypeCommunity` | Persists COMMUNITY policy; validation failures surfaced after saving; serialized. Existing ID values are retained. |
| Columns / `syncColumnConfig` | Additive header-resolved classifications, existing roles preserved; serialized; config/startup regressions pass. |
| Startup / `setupWizard` | Additive configuration and themed support sheets, no Google Form creation, configured trigger replacement, validation/health summary; serialized writes, invalid configuration stops early. |
| Restyle / `restyleConfigSheet` | Presentation updates preserve settings/table values; serialized; existing Config styling regressions pass. |
| Triggers / `installTriggers` | Separate user setup lock, validated schedule, staged replacement/rollback, optional feature gates and public-link gates; duplicate/quota/audit-failure tests pass. |
| All QA / `qaRunAll` | New in-roster sandbox, shared writer lock, synthetic tests, same sheet repurposed for results; runner lifecycle/platform checks retained. |
| Core QA / `qaRunCore` | Same runner, core cases only. Callback/prefix and runner-mode tests retained. |
| Platform QA / `qaRunPlatform` | Same runner, actual Sheets sandbox tests only. Callback/prefix and platform tests retained. |
| Demo / `seedDemoRoster` | Explicit overwrite confirmation, lock/suppression, framed table growth and visible failures; actual demo builders exercised with bounded synthetic sheets. |
| Department reset / `devResetForNewDepartment` | Existing typed confirmation, mapping preflight, private member/settings cleanup and public disconnect retained. Reset and recovery regressions pass; suppression restoration corrected. |
| QA cleanup / `devCleanup` | Reviewed IDs, recognized names, shared lock, last-tab protection and cancellation verified. |

## Verification and limits

`node tools/qa.js` passes **24 suites/checks**, including the new `tools/menucheck.js`. Menu tests prove all 23 Roster and 6 QA callbacks exist, preserve every former action, use correct bound/library prefixes, omit unavailable modules, and avoid data/network access during construction. Trigger tests enumerate every literal `ScriptApp.newTrigger` target and verify the shim forwarders. New workflow tests use service doubles; they do not run menu commands on a production workbook.

The existing in-sheet QA previously passed according to the user. This audit did not click every updated menu command in an authenticated Google Sheets session. Google authorization, another user's triggers, real concurrent executions, live dropdown colours and the visual result of merged-band insertion require live acceptance. A successful local test is not proof of those platform behaviors.

Recommended live acceptance on a **copy** after the source sync:

1. Reload the spreadsheet; verify the 8-entry menu and the 3-entry Dev / QA menu. Open both panels and the signup queue.
2. Run Setup → First-Run Setup and Install / repair triggers twice; check the summaries and absence of duplicate managed triggers. Existing forms/records must remain intact.
3. Refresh a copy containing one new leave, signup and patrol submission. Confirm credits/statuses, table order, derived views and the final public mirror. Remove/rename a configured response tab temporarily; the summary must identify that missing step.
4. Add three member rows inside and at the end of a merged rank-group band. Verify its label, merge, border, all three row formats/validations/conditional rules and heights. Try a fractional count; it must add nothing.
5. Run QA, retain two reports, cancel cleanup, then confirm cleanup. On a disposable demo copy, cancel demo loading before typing `LOAD DEMO`, then load it; all three framed tables must retain their bottom borders. Inspect the reset confirmation separately before using it.

New menus do not require trigger reinstallation; they appear on the next sheet reload. Library deployments additionally require the updated shim and library version. No production roster reset, demo load, cleanup, form submission or direct public-sheet mutation was performed during this audit.
