# Error-handling audit and remediation

Audit date: 7 October 2026. Scope: the local RosterSystem repository. Status: code corrections and local fault-injection verification completed; changes have not been pushed or deployed. Live Google Sheets, authorization, quota and network behavior were not available for verification.

## Executive assessment

The most consequential weaknesses were not missing `try/catch` blocks. They were failures being reported as success, destructive work proceeding under uncertain state, cleanup replacing the primary error, and recovery paths doing excessive work after an infrastructure failure.

The corrections establish these boundaries:

1. Invalid reset configuration and cadence markers stop destructive scheduled work.
2. Publishing validates configuration before applying privacy rules. An incomplete publish is not reported as complete.
3. Panel errors have a code, actionable hint and execution reference. Diagnostics redact credentials and survive logger failures.
4. Cleanup preserves the primary error and respects nested lock ownership.
5. Deferred rebuilds retain newer edits, preserve failed work and back off independently.
6. Signup sync acknowledges incomplete work and can recover a deterministic submission after its source acknowledgement fails.
7. Quota and permission errors do not trigger a cell-by-cell write storm.
8. Client transport and callback exceptions reach a recovery message without replaying writes.
9. Invalid configuration is memoized before error notifications read templates, preventing recursive error reporting. Invalid cache shapes fall back to the configuration sheet.

These changes improve the handling of the audited failure modes. They do not establish that every possible production failure has been eliminated.

## Scope and review method

Reviewed the error registry, dispatch allow-list, configuration parsing and validation, diagnostics and notification plumbing, menu/trigger guards, lock and publishing cleanup, deferred maintenance, resets, snapshots/restores, signup imports, table sorting, merged-cell writes, public publishing, optional cache and notification fallbacks, and Control/Settings Panel RPC handling.

The reproducible inventory covers all ten root Apps Script/HTML files, including the library shim, Dev/QA and the placeholder Signups HTML file. It contains **491 source lines containing catches** after the follow-on [data-integrity recovery work](DATA_INTEGRITY_AUDIT.md). Some lines contain multiple catches. This is a textual index, not a compiler-level catch count or proof that a handler is correct.

- [Complete inventory](ERROR_HANDLING_INVENTORY.json)
- [Inventory generator](tools/errorinventory.js)
- [Fault-injection regressions](tools/errorcheck.js)

Inventory classifications are review aids: 262 lines contain observable/propagated handling, 69 have explicit optional/fallback handling, 43 are QA/assertion code, and 117 require interpretation of surrounding code. The latter include cosmetic fallbacks, returned health-check failures, identity safeguards, merge recovery and destructive reset handling. Their classification does not mean they are 117 confirmed defects.

The work followed consequence-based prioritization: protect data first; correct outcome reporting; isolate cleanup; make recovery durable; harden diagnostics; bound retry costs; then verify compatibility with the existing regression suites.

## Findings and corrections

| Finding | Severity | Previous consequence | Correction |
| --- | --- | --- | --- |
| Reset gate failed open | Critical | An unreadable cadence property could permit a reset at the wrong time. | `resetDue_` now logs the failure and returns false. Malformed markers are rejected. Extras trigger installation validates configuration before deleting existing triggers. |
| Privacy configuration could fall back during publishing | High | Custom privacy rules could be replaced by defaults on an error path. | The public publish core requires successful configuration validation before opening the publishing path. |
| Incomplete publishing reported as successful | High | Control Panel could say “Published” while some tabs failed. | Failed, aborted or skipped-tab outcomes produce E-504 with completed-tab information. Existing dirty flags continue to carry recovery work. |
| Cleanup could hide the original action error | High | Publishing or lock-release errors could replace the useful write failure. | Shared write cleanup tracks the primary failure, flushes before releasing, handles cleanup independently and preserves the original exception. Optional post-write publishing does not turn a completed write into a failed write. |
| Nested writers could release a parent's lock | High | A nested helper could release serialization before its caller finished. | Nested `cpWithLock_` calls run under the parent's ownership. Snapshots and restores use the shared boundary. |
| New queued work could be erased by an older rebuild | High | An edit arriving after a rebuild's read could be cleared without being reflected. | Per-job generation tokens, document-lock-protected queue bookkeeping and completion checks retain newer generations. Legacy flags migrate automatically. |
| Signup sync swallowed failures | High | A partial import could return zero or a partial count as if the scan completed. | Required headers/missing tabs now fail explicitly. E-504 reports completed rows and warns that some data may already be saved. |
| Signup acknowledgement failure could duplicate a row on retry | High | Review row was written, source marking failed, then a later scan appended it again. | Existing deterministic submission keys are indexed once and reused to acknowledge the source without adding another row. IDs are taken from displayed text. |
| Unwritable table cells did not always fail their caller | High | Imports/sorts could continue after the merge-safe helper reported failed cells. | Signup import and all three table sorts check failed-cell results. Sort failures propagate instead of only producing a warning. |
| Infrastructure failures could cause write amplification | High | A failed bulk operation could cascade into row and individual-cell attempts. | Bulk fallback is restricted to merge/spill/array-result failures. Quota, permission and unrelated exceptions propagate immediately. |
| Welcome rollback could fail before later cleanup ran | High | A failed replacement deletion could prevent restoring the original name/references and hide the primary error. | Deletion, naming and reference recovery are attempted independently, with secondary failures logged. |
| Dispatcher error handling was inconsistent | Medium | Plain exceptions lacked a consistent diagnostic trail; inherited object methods were not excluded explicitly. | Own-property endpoint checks, argument-array/size checks, shared reporting, coded client messages and execution references. Invalid webhook channels cannot silently fall back to another channel. |
| Logger context could fail or leak credentials | Medium | Circular context could defeat logging; URLs and bearer tokens could reach diagnostics. | Bounded recursive context handling, credential-key redaction, webhook/bearer/token text redaction, formula-safe log cells and console fallback. Entire form event payloads are no longer included in the vanished-row warning. |
| Repeated diagnostics incurred repeated sheet I/O | Medium | Identical failures in a batch could append the same row repeatedly. | Per-execution deduplication and a logger-unavailable guard. Execution references use UUIDs with a local fallback. |
| Webhook serialization happened outside its failure boundary | Medium | Circular or unsupported payloads could violate the documented never-throw contract. | Serialization is inside the protected path. Raw response bodies are omitted from diagnostics. |
| Rate-limit retries could occur earlier than Discord requested | Medium | Long Retry-After values were shortened to five seconds before retrying. | A delay above the inline budget returns a failed result without sleeping/retrying early. Short delays receive one retry; uncertain network failures are not automatically replayed. |
| Client callback failures could leave misleading UI state | Medium | The server succeeded, but a rendering exception left the panel without an actionable result. | Both API wrappers distinguish server completion from display failure, invoke recovery handlers and ignore duplicate completion callbacks. |
| Snapshot extra-field failures could be counted as restored | Medium | Invalid JSON or failed extra-field writes could leave partially restored records looking complete. | Malformed extra-field JSON is rejected before restore writes begin; extra-field write failures produce E-504. The restore response and panel also disclose skipped member rows. |

## Error and recovery policy

| Failure class | Response | Automatic retry |
| --- | --- | --- |
| Invalid configuration or destructive-state marker | Stop, retain data, log the condition. | After configuration/state is repaired; no destructive fallback. |
| Interactive lock contention | E-503: busy, wait and try again. | No replay of the user's write. |
| Partially completed import/restore/publish | E-504: incomplete, completed-item count and inspection guidance. | Only where existing recovery semantics make the retry safe. |
| Invalid panel request | E-506/E-507; reject before endpoint work. | None. |
| Unexpected server exception | E-601 plus execution reference, sanitized context and optional error-channel notification. | No blanket write retry. |
| Failed derived rebuild | Keep that generation pending; exponential backoff. | 30 seconds, 60 seconds, 120 seconds, bounded at 15 minutes; a newer edit resets its job state. |
| Discord 429 | Respect the requested delay. | At most one inline retry when the delay fits the five-second budget. |
| Uncertain Discord network outcome | Return a failed result and log it. | None, to avoid replaying a message that may have arrived. |
| Cache, cosmetic UI or optional notification failure | Preserve primary work; use a bounded fallback where available. | No repeated expensive fallback in a loop. |

The central reporter does not log dispatch arguments. Error-channel delivery remains optional and throttled per code/function; a cache outage still has an execution-local throttle. Diagnostics are a safety net, not an assertion that storage or external delivery always succeeds.

## Efficiency evidence

These are local model measurements, not live Google latency benchmarks:

- **Quota failure:** a 100-row, 20-column range makes one failed bulk write and stops. It no longer proceeds toward 2,000 individual cell writes.
- **Repeated log:** two identical errors in one execution produce one SYS Log append in the fault test.
- **Logger outage:** a failed logger enters console fallback for the remainder of the execution rather than repeatedly attempting failed storage.
- **Deferred work:** failed jobs are not attempted again before their next eligible time. Idle sweeps avoid reading the entire property store. Each job backs off independently.
- **Signup recovery:** deterministic review keys are indexed once per scan. A source-acknowledgement failure followed by retry leaves one applicant row in the model.
- **Webhook delays:** a ten-second Retry-After causes no sleep and no premature second fetch; a 100-millisecond eligible delay causes one retry.

Per-job durable state and lock-safe bookkeeping add some property/lock operations. That is an intentional cost for avoiding lost updates. There is no claimed universal improvement in wall-clock runtime.

## Validation

All **12 local regression suites passed**: configuration, table growth/sorting, publishing, Welcome, profile performance, panel opening, selections, department reset, prior hardening, Settings, group/Academy and error handling. Configuration reports 71 individual checks passing.

The new error suite injects failures into actual server/client functions and covers:

- Secret redaction, circular and hostile diagnostic objects, log deduplication and logger-storage failure.
- Inherited endpoint rejection, malformed RPC arguments, coded errors and execution references.
- Primary/secondary cleanup precedence, nested locks and failed post-write publishing.
- Edits arriving during rebuilds, legacy queue migration and independent retry backoff.
- Circular webhook payloads, long/short rate-limit delays and redacted network errors.
- False-success publishing, partial signup acknowledgement and deterministic recovery.
- Invalid reset configuration, malformed reset markers and trigger-installation preflight.
- Corrupt snapshot extra fields being rejected before restore writes.
- Quota failure producing one bulk attempt.
- Both panels' synchronous transport errors, success-callback failures and duplicate completion callbacks.

Both HTML checks, compilation of every `.gs` file and `git diff --check` passed. The error regression suite is included in GitHub Actions. Regenerate the inventory with `node tools/errorinventory.js` after changing handlers.

## Remaining production limits and acceptance checks

1. **Multi-call writes are not atomic.** A runtime termination, quota limit or manual sheet edit can interrupt imports, transfers, restores and resets between calls. The changes improve reporting and specific recovery paths; they do not implement a general transaction journal or automatic rollback.
2. **Signup deduplication requires a deterministic key.** The demonstrated acknowledgement recovery applies to framed review tables with usable submission timestamps. Legacy layouts without those fields still require inspection before retrying an uncertain partial import.
3. **Discord delivery is best effort.** There is no durable outbox/receipt ledger. A long rate limit or network failure can leave a notification undelivered. A durable outbox would be a separate architectural change requiring retention, deduplication and privacy rules.
4. **Logger storage can fail.** Cloud console fallback preserves diagnostic intent, but platform termination can prevent any final log. Credential redaction is defensive pattern/key filtering, not a complete detector for arbitrary personal data embedded in arbitrary messages.
5. **Locks coordinate engine executions.** They cannot prevent a person editing the spreadsheet directly. A document-property outage can also prevent enqueuing a job; this is logged but cannot be made durable using the same unavailable store.
6. **Trigger installation still consists of multiple platform calls.** Configuration is preflighted, but quota/permission failure during installation can leave a partial trigger set. Verify System health after installation. Fully transactional trigger replacement is not available through these helpers.
7. **Snapshot compatibility has intentional skips.** Removed headers, SLOT-owned fields and unsafe identity targets can be excluded. A restored-member count is not a guarantee that every historical column still exists.
8. **No live acceptance run was performed.** On a disposable department copy, exercise actual permissions, missing/renamed tabs, invalid configuration, concurrent assignments, form acknowledgements, snapshot restoration, Welcome replacement, inaccessible public files and real trigger execution. Inspect both the internal data and public mirror after each failure/recovery. Verify that the execution reference resolves in SYS Log and that error-channel messages contain no webhook credentials.

A successful live acceptance run is the remaining gate for production confidence. “100% audited” must not be confused with a guarantee that the Google runtime, network and every department-specific layout will behave identically to the local models.

## Operational response

- E-503: let the active operation finish; do not repeatedly click the action.
- E-504: inspect the affected table and the completed-item count before repeating the operation. Some data may already be saved.
- E-601: retain the reference from the panel, locate that execution in SYS Log/Executions, and address the reported function/condition.
- Failed public publish: inspect diagnostics and the affected public tabs; the dirty state remains available for catch-up. An internal write can succeed while its public mirror is delayed.
- Deferred failure: inspect builder diagnostics, repair the tab/configuration, then use its manual Build/Refresh action or make the corrected edit.
- Logger unavailable: inspect script-editor Executions/Cloud Logging; repair permissions/storage before relying on SYS Log alone.

## Platform references

Google documents lock ownership and flushing pending spreadsheet changes before release in [Class Lock](https://developers.google.com/apps-script/reference/lock/lock). RPC failure callbacks are documented in [HTML Service communication](https://developers.google.com/apps-script/guides/html/communication). Platform quota exceptions and trigger limits are documented in [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

## Follow-up: missing error boundaries

Added diagnostic boundaries to bound and library menu loading; configuration preflight and partial-install reporting to trigger installation; partial-work reporting when patrol imports complete but log evaluation fails; missing-sheet checks and primary-error-preserving cleanup to leave sync; and observable publish lease storage/release failures. Fault-injection tests cover these cases. Genuine lease contention still returns the existing busy result.
