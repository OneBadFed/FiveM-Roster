# Data-integrity and recovery audit

7 October 2026. Local changes and fault-injection checks; no push, deployment or live spreadsheet mutation. This report covers the recovery work performed after the error-handling audit. It does not certify every possible Google service failure.

## Findings and corrections

| Operation | Failure risk | Correction |
| --- | --- | --- |
| Patrol credits/reversals | Marking a submission complete before its hour write could lose credits. Retrying a reversal could subtract twice. | Persist a before/after credit journal before mutation. Retry writes absolute totals only when live hours match the recorded before or after value. Preflight both members for a reassignment. Preserve exact IDs and refuse duplicate identities, formulas, conflicting totals, changed columns or another workbook. |
| Patrol imports | A completed source marker could hide incomplete destination fields. Sorting could move a reserved row. | Persist source import plans and destination tokens. Fill missing compatible fields, retain tokens through sorting/crediting, and acknowledge the source last. Incomplete imports remain excluded from crediting. Layout changes and conflicting edits stop recovery. |
| Leave imports | A surviving submission key could cause an incomplete tracker row to be skipped forever. | Durable keys map to physical rows. Repair only missing engine fields in incomplete rows; validate existing identity/dates and preserve manual notes/formulas. Batch duplicate-source acknowledgements follow destination writes/sorting. Unexpected row errors stop the import with a partial-work error. |
| Member transfers | Clearing one source run before copying later runs could lose custom MEMBER fields. | Journal snapshots, copy every MEMBER run before clearing any source cells, then persist a clearing phase. Recovery validates the source, destination, layout and MEMBER/SLOT classification. SLOT fields stay in place. |
| Member seating | Partial required-field writes could occupy an unusable slot and prevent retry. | Journal original/desired fields before writes, reserve the slot and set NAME last. Resume compatible fields, reject conflicting requests/edits and preserve SLOT values. Oversized records fail before mutation. An unnamed slot containing an ID cannot silently be reused. |
| Activity reset | Archive or previous-activity errors were logged while hours could still be zeroed. A retry could roll a partial archive twice. | Stop on those failures. Persist a phase checkpoint before mutation. Incomplete resets require inspection rather than automatic replay; completed resets acknowledge a failed clock/property write without rolling or zeroing again. Preserve the original error if lock release also fails. |
| Hours history | Deleting the prior same-week snapshot before writing its replacement could erase the only record. A retention cap below member count could truncate the current snapshot. | Append and flush the replacement first, then remove prior same-week runs. Expand the history grid when needed. Retain the entire current member batch even when it exceeds the cap. Write leading-equals strings as literal text. |
| Public publishing | A failed transfer, assignment or reset could expose an intermediate roster state. | Pause publishing while these incomplete recovery records exist; completed reset checkpoints may publish. Failures remain queued and are reported. Incomplete reset checkpoints also block new patrol credits, transfers and panel member writes until reviewed. |
| Department isolation | Library Script Properties could share reset timestamps or credential-cleanup effects across departments. | Store reset clocks in Document Properties, scope error-throttle cache keys by workbook, and retain explicit BOUND/LIBRARY runtime identity through department reset. Migrate/clear legacy Script Properties only in explicitly identified bound projects. |

## Signup reliability and outbound privacy follow-up

Signup mutations now share the writer lock and resolve exact submission keys after sorting. Ambiguous ID-only requests are refused, explicit flag requests are idempotent, and pending approvals reserve their member slot and source record. Sorting uses each submission timestamp and skips form reads when review keys already provide it. Failed organization remains queued for retry. Discord audit values are withheld for private review/form/config tabs and sensitive roster columns, including when privacy context cannot be read; ordinary hours/status edits remain visible. Both custom-template variables and fallback embed fields use the sanitized values.

## Recovery procedure

Keep recovery cells/properties intact. They are evidence, not disposable flags. Make a private workbook copy before resolving a conflict. Do not reset hours, restore members or rearrange columns around unfinished patrol/transfer/assignment work.

1. **Interrupted patrol credit/import:** rerun the same sync route with the original sheet mappings. Recovery follows row tokens and exact IDs. If it reports conflicting hours, identities, dates or columns, inspect the recorded before/after values and live/source rows before making a decision. Never erase a pending credit marker and credit the same submission again blindly.
2. **Interrupted transfer or assignment:** use **Roster → Recover Interrupted Transfer**. This action handles recorded transfers, assignments and linked signup approvals. It does not replay Discord notifications. Inspect the affected rows and refresh the panel afterward. Conflicting manual changes stop recovery. New signup approvals retain their source submission key and private-field plan until seating, private details and Processed acknowledgement are confirmed. Changed answers, layouts or conflicting values stop recovery.
3. **Interrupted activity reset:** `RE_ACTIVITY_RESET_PENDING` records the workbook, roster sheet, start time and last phase. A `committed` checkpoint can be acknowledged by invoking Capture & Reset again; it will not reset twice. Other phases require an administrator/developer to reconcile the hours-history snapshot, current HOURS, visible archive headers/values and previous-activity chain. Preserve/export the checkpoint. Clear it only after the resulting state has been deliberately reconciled, then verify the document reset clock and scheduled cadence. Clearing it alone is not recovery.
4. **Copied recovery records:** records tied to another workbook are refused. Resolve the copy's state deliberately rather than replaying another department's records. Runtime deployment identity is separate from department settings; reopen the spreadsheet after updating to establish BOUND or LIBRARY mode.

Hidden patrol markers retain legacy finalized-marker compatibility. Old finalized markers without a new recovery journal cannot prove whether an earlier version lost a credit. Those historical inconsistencies require administrative reconciliation.

## Verification

`tools/recoverycheck.js` executes the real helpers and major entry paths against an in-memory Sheets/services model. It injects failures both before and after accepted writes, so successful-but-unacknowledged calls are exercised. Checks cover:

- Credit preparation, hour updates, final markers, all credit flush boundaries, reversals, two-member reconciliation and conflicts.
- Import fields, source acknowledgements, sorted destination tokens, duplicated tokens and preservation of credited markers.
- Transfer journal writes, copy/clear phases, final acknowledgement, conflicting edits, oversized journals and SLOT preservation.
- Direct form-credit processing, delayed Processed status/notification, missing leave fields and destructive-operation guards.
- Reset archive failure, repeat prevention, completed-reset acknowledgement, assignment reservations/field failures and safe history replacement.

All 14 repository check suites pass locally: configuration, tables, publishing, Welcome, performance, panel opening, selection, department reset, hardening, Settings, groups, errors, recovery and audit privacy. HTML script parsing, Apps Script syntax parsing and whitespace checks also pass. The GitHub workflow includes recovery checks. Local models cannot reproduce Google's complete formatting, permission, timeout, formula recalculation or concurrent-human-edit behavior.

## Live acceptance and remaining limits

- Test on a private department copy before deployment: interrupt a patrol sync, move, assignment and activity reset; verify exact IDs/hours, recovery messages, row formatting and public retry behavior.
- Test two library-backed departments independently. Verify reset clocks and webhook cleanup in one do not change the other. Libraries share their own Script Properties/lock instances; [Google resource-scoping documentation](https://developers.google.com/apps-script/guides/libraries#resource_scoping) explains why document state is needed. Shared library locks still serialize engine callers and can add latency.
- Apps Script locks coordinate engine executions, not a human editing cells simultaneously. Recovery preflight detects many conflicts but is not a database transaction or a guarantee against edits between a read and write.
- Financial/state recovery does not provide exactly-once delivery for audit messages or Discord notifications. Ambiguous notification delivery is not automatically replayed. Group/dashboard rebuilds remain deferred/best effort after core changes.
- Snapshot restore and department wipe remain multi-step destructive operations. Existing preflight/partial-error reporting improves safety; they do not have automatic rollback. A failed wipe must remain private until resolved.
- New signup approvals recover private-detail writes and Processed acknowledgements from a linked journal. Historical incomplete approvals created before these journals existed still require manual reconciliation. Live tests must include an approval interrupted after seating and after each private-field write.
- Recovery property records are bounded below Google's per-value storage limit; large transfers/assignments are refused before writing member fields. A recovery record's deletion after a completed operation can still return an error even though the core change landed; inspect the resulting state before retrying a new operation.
- No historical lost credits are guessed, no Google Forms are created by this work, and no code was pushed or uploaded during the overnight audit.
