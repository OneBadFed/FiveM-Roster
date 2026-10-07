# First-Run Setup and trigger audit

Reviewed setupWizard, configuration seeding/migration, column discovery, response-tab verification, ID formatting, entry validation, dashboard refresh, core/publishing/Extras trigger installation, audit verification and the panel trigger-repair action.

## Changes

- Startup, Install Triggers and panel repair share one installer and use the configured nightly hour. Startup stops when configuration validation fails instead of installing a midnight fallback.
- Trigger batches create replacements before removing old managed triggers. Creation failure removes known staged replacements and retains the old batch. A writer lock prevents overlapping replacement batches. Unrelated handlers remain untouched.
- Unlinked public rosters have no publishing edit/change/minute triggers. Monthly reset scheduling uses the monthly cadence even when the weekly day is Off. Auto-reset Off still removes its scheduled reset.
- Audit verification returning false is reported as incomplete installation, rather than success. Failures in optional installation groups are reported alongside the completed core installation.
- Setup does not create Google Forms, change destinations, add sample answers, or restyle department-owned response tabs. Disabled intakes are reported as off. Leave-form ID formatting uses resolved headers and skips unresolved layouts instead of formatting a fixed answer column.
- An unchanged configuration grid is not cleared, rewritten or restyled. Explicitly empty tables remain empty through startup. Configuration construction completes before clearing an existing grid; schema stamps are not rewritten on every verification.

## Verification and limits

`tools/startupcheck.js` exercises the real installation functions with configured hours, duplicate handlers, custom handlers, staged creation failures, public-link gating, monthly/Off combinations and failed audit verification. It also runs the real configuration seeder twice and verifies zero additional clears/writes on the second pass. All 15 local suites and HTML/Apps Script syntax checks pass.

Google authorization, live trigger execution, quota behavior, department/library ownership and real formatting need acceptance testing on a private workbook copy. Trigger service operations are not transactional: an ambiguous creation result or failed deletion can require inspection of the project's trigger list. The installer reports partial failures; it cannot guarantee rollback of an unacknowledged service operation. Startup still intentionally performs column discovery, validation and dashboard refresh; those costs depend on workbook size. No measured live speedup is claimed. These changes are local until committed, pushed and uploaded.
