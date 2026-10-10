# Demo command audit — October 9, 2026

The `seedDemoRoster` command and its member, leave, patrol, signup, history, promotion and Welcome helpers were reviewed and repaired. The local verification gate passes **28 suites/checks**, including **16 demo scenario groups**. These results use synthetic services; the destructive command has **not** been run on a live Google workbook.

The initial audit missed a valid empty-tier configuration: department reset deliberately leaves the status table empty, and First-Run Setup preserves it. The reported October 9 failure occurred while preparing demo people, before demo sheet writes. The loader now supports that configuration: ordinary activity/history statuses remain blank, hours are still seeded, and configured leaves/per-rank ladders still apply. Its result explains the limitation without changing settings. Preflight failures explicitly report no demo data changes and do not queue public publishing; failures after writing begins retain the partial-write warning and queue.

## Findings and repairs

| Area | Problem found | Resulting behavior |
|---|---|---|
| IDs | Fixed Discord length; suffix wrapping; pending applicants could collide with roster members | Numeric text IDs honor configured lengths and remain distinct. Capacity is checked before writing; four applicants receive IDs beyond the member slot range. |
| Activity | Fixed hour bands and three-tier assumptions produced wrong statuses under custom settings; the audited loader then rejected valid empty tiers | Demo hours follow the rank's configured ladder, including one/two-tier configurations and overrides. Tierless ranks receive hours with blank ordinary activity/history statuses, without inventing statuses or changing configuration. The real status rules compute configured ladders. Disabled leave types stay disabled. |
| Leaves/history | Active tracker rows assumed `Approved`; history statuses were disconnected from snapshot dates | Approval/expiry values follow configuration. Active leaves use the tracker's single implicit type; returning members have ended leave records, so scheduler and coverage agree. Snapshot statuses reflect their Sunday dates and the matching leave intervals. The summary correctly describes four fortnightly snapshots. |
| Shifts | Hard-coded choices overwrote slot assignments | Member shifts use configured choices. Slot-owned shifts survive unchanged, including open positions. |
| Stale member data | Old custom fields, notes and extra previous-activity columns survived reloads | Old literal MEMBER fields/notes are cleared; custom calculation formulas and SLOT fields remain. All configured previous-activity columns update. The row-local Time in Rank formula remains supported with its normal SLOT classification. |
| Mapping/recovery | Fallback columns and overlapping tabs could target unrelated data; interrupted operations were not checked | Required physical headers, distinct/in-bounds columns, table starts, ownership and tab roles are checked before writes. Pending reset, move, assignment, signup and patrol recovery block the load. |
| Patrol | Session lengths could exceed policy limits; overnight/DST calculations could disagree with credit markers | Sessions sum exactly in hundredths and respect policy limits. Daytime sessions avoid DST-night shifts. The real processor and reconciler leave seeded markers and roster hours unchanged. Narrow valid patrol layouts resolve without an out-of-bounds header read. |
| Signup/promotion | Pending timestamps could be future-dated; stale promotion records remained without candidates; promotion dates disagreed with the roster | Pending timestamps are past dates. Promotion dates use the seeded roster values; empty candidate sets clear the feed. Demo phone fields use fictional numbers. |
| Welcome | Demo helpers rewrote category labels/notes and could mistake an unrelated merged banner for leadership | Counts use the normal configured dashboard renderer. Only a recognized leadership box on the configured Welcome tab is seeded; leftover leadership rows clear. Custom labels, formulas, tag notes and other tabs are retained. |
| Derived views | Coverage and group/academy views could retain prior members | Coverage uses a shared noninteractive writer. Group/academy builders and a full dashboard scan run after seeding. Failed or skipped stages appear in the result. |
| Notifications/failures | Suppression ended before menu auditing/error reporting; partial failures did not queue publishing | Confirmed loads suppress webhooks through auditing/error handling, then restore the prior state. The writer lock releases before modal UI. Partial writes queue publishing; queue failures and partial-write risks are explicitly reported. |

## Verification

Run `node tools/qa.js`. The new `tools/democheck.js` executes the actual demo helpers, status engine, header resolvers, tracker row/formula writers, leave scheduler/coverage writer, patrol processor and credit reconciler against bounded in-memory sheets. It checks repeated loading, an 850-slot signup fixture, 1,600 unique IDs per ID configuration, custom tiers/rules, disabled leaves, ownership, notes/formulas, borders/growth, history capacity, DST dates, promotion clearing, mapping refusals and failure injection. Live workbook, network, form-creation and trigger services are denied.

Derived view builders are observed separately in the demo fixture; their actual implementations remain covered by the group, dashboard and platform suites. The actual demo lifecycle check verifies stable scheduler results and rebuilt coverage, including returned members. Coverage's shared writer also retains the platform regression checks for populated/empty tables and retained filters. Menu and Welcome regressions were updated to reflect the changed contracts.

## Operational boundaries

The command replaces records on **existing roster slots**; it does not create a roster layout or invent missing required headers. Configured tracker/patrol/signup tabs must exist with valid mappings. Headers, ranks, callsigns, dividers, slot-owned shifts, custom calculation formulas and template styling are retained; native table growth/sorting continues to use the existing engine helpers.

Linked form response rows, existing connections, configuration, snapshots and audit logs are not replaced. The form-backed Activity Panel is not populated with invented submissions. Later form synchronization can import retained responses into this demo. Use a dedicated copy with its own connections; a linked public roster can receive demo data through the normal publish queue. These effects are stated in the confirmation prompt.

The operation is not transactional. A service failure or Apps Script timeout can leave a partial load; failure messages and subsequent retries do not imply rollback. Local service models do not establish live permissions, Sheets formula recalculation, actual merge/validation rendering, trigger concurrency or runtime limits on large workbooks.

## Remaining live acceptance

On a dedicated demo workbook, run First-Run Setup and confirm its required mappings. Load twice, inspect retained ranks/callsigns/dividers/shift assignments and table frames, then run a patrol refresh to confirm unchanged hours. Verify tracker countdowns, history, signups, leadership/promotions, coverage/group/academy views and configured Welcome counters. Check that the confirmed load sends no Discord messages and that any dedicated public copy receives the expected queued update. Record those platform results before calling this command live verified.
