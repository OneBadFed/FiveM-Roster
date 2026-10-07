# Reliability review and completed plan

Reviewed the roster writer/identity helpers, Dev/QA reset, snapshots, form intake and signup approval, framed tables, public publishing, configuration validation, and both HTML panels. Changes were tested locally, without opening or modifying the live spreadsheet.

| Priority | Likely failure point | Change completed |
| --- | --- | --- |
| High | Reset and normal writes used different locks, allowing concurrent changes during a wipe. | Reset now uses the same script lock as roster writers. |
| High | Snapshot fallback could overwrite an occupied slot with no ID, read invalid row numbers, or restore a field now classified as SLOT. | Reject unverified occupied targets and invalid rows; restore extra fields only into MEMBER columns. Track restored IDs and reject duplicate current IDs. |
| High | Signup prompts may remain open while rows move or a slot is claimed. Recovery could reset another applicant's status. | Resolve the applicant and approve under the shared writer lock after the prompt. Recovery also locks and never falls back to a stale row; its failure message reports whether recovery actually succeeded. |
| High | Snapshot restores did not queue a public-roster refresh. | Mark publishing dirty, queue the restored tab and derived views, and invoke publishing after releasing the writer lock. |
| Medium | Bulk status updates silently skipped stale selections, counted duplicate targets, or accepted mismatched identity arrays. | Validate identity-array length and integer rows, reject ambiguous IDs and empty slots, deduplicate targets, and return/display skipped counts. |
| Medium | Edits or a second save during an in-flight Settings request could be overwritten by the response. | Freeze editing/navigation during save, guard duplicate requests, and release controls on success, validation refusal and transport failure. A delayed Saved animation cannot hide newer unsaved changes. |
| Medium | Hand-edited embed JSON could crash the builder; channel dirty dots missed notification edits or depended on table row order. | Validate template shapes server-side, tolerate malformed shapes in the builder so they can be repaired, enforce the Add field limit, and compare channel rows in stable order. Include notification/title edits in channel dirty state. |
| Low | Dropdown placeholders used the page-header class, changing layout. | Use the dedicated `ddph` class consistently. |

The existing framed-table and public-mirror checks still cover added columns, border preservation, copied styles/heights/formulas, oldest-first grouping, public privacy filtering, carrier cleanup and publish retries. The panel checks cover member selection, bootstrap timing, request deduplication and stale profile responses.

Regression commands now included in GitHub Actions:

```text
node tools/cfgcheck.js
node tools/tablecheck.js
node tools/publishcheck.js
node tools/perfcheck.js
node tools/panelopencheck.js
node tools/selectioncheck.js
node tools/resetcheck.js
node tools/hardeningcheck.js
node tools/htmlchk.js ControlPanel.html SettingsPanel.html
```

## Remaining environmental risks

Local mocks cannot reproduce Google authorization, execution quotas, trigger ownership, UI prompt suspension or cross-workbook timing. After deploying, validate on a disposable copy with two concurrent users, a moved applicant during approval, a snapshot restore into occupied/empty slots, custom columns, and a linked disposable public roster. Do not run reset on production as a test.

Google Sheets operations are not transactional: an execution failure can leave partial changes. The reset reports this explicitly; arbitrary manually maintained content outside recognized data areas still needs inspection before a copy is handed over. Legacy callers that omit member IDs retain compatibility, so refresh an old panel before sensitive actions. Engine locks coordinate engine executions but cannot prevent users from manually editing cells while an operation runs. This review and its tests do not establish that the entire codebase is error-free.
