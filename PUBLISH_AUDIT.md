# Public roster publishing audit

Reviewed linking and spreadsheet caching, private-tab blocking, sensitive-column masking, header detection, formula/value transfer, merges and preserved ranges, framed tables, Welcome snapshots, grid growth/trimming, dimensions, self-computing tabs, per-tab writer locks, pass leases, dirty flags, burst/catch-up triggers, sweep retries, and manual publication.

## Fixes

- Pass claims now use a short document lock, an owner-tagged lease and ownership-checked release. Concurrent publishers cannot both claim an idle property; an old owner cannot release a newer pass. Unreadable state fails closed. The ten-minute lease outlasts ordinary six-minute Apps Script execution limits.
- Partial cell-write errors propagate to the existing retry queue instead of merely logging success. Empty internal sheets clear stale public content while respecting preserved areas.
- Known header labels outweigh dense member data when detecting headers. Renamed private/system/form-response tabs are blocked using loaded configuration even when a secondary configuration read fails.
- Literal text beginning with `=` remains text during publication; actual formulas retain the existing transfer rules.
- Linking the internal workbook as its own public target is refused before changing the link. Link changes refresh the per-execution spreadsheet cache, and setup uses the serialized public publishing wrapper.
- Targeted Welcome publication resolves leading emoji differences. F6:W7 remains the sole Welcome exception; its public content and cell formatting are preserved while dimensions come from the internal sheet.
- Self-computing tabs no longer invoke broad automatic spill clearing. The former cleanup could remove unrelated neighboring content; blocked spill areas require deliberate repair in the public template.

## Efficiency

Welcome and framed-table dimension writes are batched into contiguous equal-height/equal-width runs. A local regression with 1,000 rows in two height bands and 40 equal-width columns takes **3 dimension writes instead of 1,040**. Each source dimension is still read, preserving correctness for formatting-only edits. This is a call-count result, not a live timing claim.

The existing per-execution spreadsheet memo, targeted edit passes, burst guard, deferred rebuilds, trailing catch-up and idle sweep checks remain. Whole-sheet source/format fingerprints were deliberately not introduced: incomplete fingerprints could miss borders, images, merges, conditional rules, rich text or public drift and incorrectly skip updates.

Full Welcome copying, source dimension reads and scanning dependent public formulas remain significant costs. Native Welcome snapshots preserve sheet objects but replace the public tab ID. Refer to WELCOME_AUDIT.md for direct-link limitations, formula-result snapshot behavior and the live template checks still needed.

## Verification

Expanded `tools/publishcheck.js` covers failure retries, clean passes, settled-table updates, lease contention and ownership, literal/formula behavior, dense-data header detection, dimension write counts, and empty-source cleanup/failure. `tools/welcomecheck.js` covers the F6:W7 exception, snapshot dimensions/style metadata, public formula references and swap rollback. Table and other repository regression checks also pass locally.

No live spreadsheet was inspected, modified or benchmarked. A 100% operational/visual guarantee cannot be established by mocks. Before production deployment, use a test internal/public pair to check permissions, renamed/added columns, sensitive columns, formulas/spills, in-cell images/smart chips, charts/drawings, title preservation, structural and formatting-only edits, simultaneous submissions and publication, retry recovery, direct links and Apps Script quotas/timeouts. Google service failures and external user edits make publication nontransactional.

Changes remain local and uncommitted; no GitHub push or Apps Script deployment was performed.
