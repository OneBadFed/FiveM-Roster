# Group and Academy audit

Reviewed assignment configuration, roster column ownership, group markers/name inference, header and identity mapping, fixed rank bands, custom fields, Academy membership/graduation, menu and Control Panel callers, edit/deferred refresh paths and signup post-seat refresh.

## Corrections

- Assignment tabs retain their configured assignment column when its header is renamed or their final member leaves. Prefix matching respects word boundaries (Day does not match Daylight).
- Repeated roster band labels use separate ranges instead of including intervening unrelated bands.
- Destination band overflow, missing bands, ambiguous identities and missing IDs stop before clearing existing records. Skipped refreshes are reported in diagnostics. Fixed operator-owned bands are not resized automatically.
- Custom formulas are preserved as R1C1 formulas and follow the member on relocation. Literal leading equals signs remain text. Zero hours remain zero.
- Explicit Academy training ranks match exactly. Active trainees cannot become graduates because their band is full. Graduate rows refresh roster identity/details while retaining custom training records.
- Graduate data begins below its banner, including when the banner is the final existing grid row. Academy identity fields remain mapped across custom section banners.
- Group and Academy writers share the script lock, respecting locks already held by callers. Signup post-seat refresh also acquires the existing Control Panel lock.

## Verification and limits

All eleven local regression suites passed, including tools/groupcheck.js exercising the actual builders with a Sheets model. Both HTML checks, all Apps Script syntax checks, and git diff whitespace checks passed. The new suite is included in GitHub Actions.

This is a code audit and simulated regression verification, not a guarantee about every live spreadsheet. No live workbook was available. After deployment, verify actual merged bands, custom validations/formulas, assignment edits, transfers, approvals and trigger execution. Formatting remains owned by the destination layout; these builders preserve member field content and validations rather than moving complete row styles. Deferred refresh timing and concurrent event delivery require live verification. Legacy marker extra-column hints do not create columns; destination headers determine the fields shown.

Edits are local and have not been pushed or deployed.
