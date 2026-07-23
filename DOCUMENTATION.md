# Roster Engine — System Documentation

> **Version:** Engine **v1.0.0** · Config schema **v2** · Control Panel **v1.0.0** · 36 whitelisted endpoints
> **Updated:** 2026-07-22 (the 1.0 full release)
>
> A white-label, schema-driven personnel-management engine for Google Sheets, built in Google Apps Script.
> Everything below describes the code in this folder; the live project is these files synced into the Apps Script
> editor via `clasp push -f`. The folder is a git repo — commit before every sync.

---

## 1 · Architecture

**The bound workbook IS the internal roster.** It holds everything private: the member roster (including the
private EMAIL / DATE OF BIRTH / PHONE columns), the LOA Tracker, the Patrol Log, Roster Signups, the Disciplinary
Log, Webhooks, ⚙️ Config, and the system logs. Google file sharing is the access control — only staff are ever
invited to this file. Members read a **separate public spreadsheet** that receives a ONE-WAY publish (§9); nothing
ever flows back. There is no separate "admin file" — `adminFile_()` resolves to the active spreadsheet.

**File set (9 files, one system):**

| File | Role |
|---|---|
| `RosterConfig.gs` | Config layer: ⚙️ Config tab schema (`BLOCK_SPECS_`), parse → validate → materialize (`cfg_()`), error registry + coded errors, SYS Log ring buffer, theme, migrations, cross-execution config cache, `perf_` timing |
| `RosterSystem.gs` | The engine: CONFIG bridge, header-resolved columns, status engine, transfers, leave lifecycle, Patrol Log crediting, dashboard + #tags, promotions feed, derived-tab rebuilds, menus, First-Run wizard |
| `RosterControlPanel.gs` | Control Panel server: the D5 `dispatch()` whitelist gateway and every `cp*` endpoint; signup sync + approval; the public-roster publish pipeline; webhooks; rank-icon + divider-style storage |
| `RosterTrust.gs` | Snapshots/restore, the always-on Edit Log audit (with editor-name resolution), health & schema checks |
| `RosterExtras.gs` | Integrity scan, leave coverage board, hours history + cadence-aware reset, helper-column tools, full-lifecycle demo seeder |
| `RosterDevQA.gs` | The QA suite — 23 sections, sandbox-only, run in three parts (or all / per-section) from the 🧪 menu |
| `ControlPanel.html` | Control Panel UI (single HtmlService dialog, Studio design system, deep-linkable tabs) |
| `SettingsPanel.html` | Settings Studio UI (full-screen config editor incl. the per-channel Discord embed builder) |
| `TEMPLATE-SHIM.gs` | **Library mode only** — endpoint whitelist mirror + trigger forwarders. Held out of `clasp push` by `.claspignore`; never paste alongside the engine |

**One global scope.** All `.gs` files share a single namespace — file boundaries are organisational. A syntax
error anywhere breaks everything; every change runs through the Node syntax check (`new Function(src)` per file,
scriptlet-stubbed `node --check` for the HTML script blocks) before commit.

**Design decisions (D1–D5, settled):** library + thin shim (D1); full white-label, sheet-as-untrusted-input with
one hardcoded anchor — the ⚙️ Config tab + marker rescue (D2); template → copy → First-Run wizard (D3);
diagnostics-first with coded errors (D4); **every** panel server call through one whitelisted
`dispatch(name, args)` gateway (D5).

---

## 2 · The Config Layer

The **⚙️ Config tab** is the single source of truth (it survives "Make a copy"; Script Properties don't).
INI-style blocks; `BLOCK_SPECS_` defines every block/key with type, default, validation, and help — one spec
drives seeding, parsing, validation, and the Settings Studio.

**Flow:** `parseBlocks_(sheet)` (display-value strings) → `validateConfig_(raw)` (collects ALL problems; any
ERROR → `E-102`, nothing half-applied) → `materialize_(config)` (typed views incl. `.legacy`) → memoized in `CFG_`.

**The CONFIG bridge:** `Object.defineProperty(globalThis,'CONFIG',{get:()=>cfg_().legacy})` — the classic
`CONFIG.*` reads all flow through the config layer with zero call-site churn.

**Cross-execution cache:** `cfg_()` first tries `CacheService.getDocumentCache()` (`RE_CFG_RAW_v1`, TTL 300s,
raw parsed strings only). Every config write path funnels through `cfgInvalidate_()`, which clears the
per-execution memo, the column cache, **and** the document cache — changes propagate to all users instantly.

**Schema & migrations:** `SYSTEM.SCHEMA_VERSION` (currently **2**; this is a migration counter, independent of
the release version). `migrateConfig_` seeds additively — First-Run Setup upgrades an older sheet without
deleting anything; `validateConfig_({})` yields zero ERRORs and defaults reproduce shipped behavior exactly.

**Blocks (inventory):** SYSTEM · SHEETS (tab names for every role incl. `PATROL_LOG`, `SIGNUPS`,
`SIGNUP_FORM_RESPONSES`; roles must resolve to distinct tabs) · ROSTER_LAYOUT (header/data rows, divider mode,
`UNIT_FORMAT` callsign template, last-activity style) · COLUMNS *(table — SLOT vs MEMBER classes)* ·
SECTIONS / SECTION_TAGS *(tables)* · STATUSES / STATUS_OVERRIDES / STATUS_RULES *(tables — tier ladder,
per-rank overrides, fixed-point transition rules)* · RANKS *(table)* · LEAVE · FORM_MAP *(table)* · DISCORD ·
NOTIFICATIONS (opt-in event embeds) · EMBEDS *(table — per-event embed overrides from the Settings builder)* ·
PATROL (mode, max hours, statuses, form column keywords) · PUBLISH (`NEVER_PUBLISH`, `KEEP_RANGES`) · FORMATS ·
SCHEDULE · LOGGING · LIMITS · THEME · DASHBOARD / DASHBOARD_GROUPS / DASHBOARD_CELLS.

---

## 3 · The Roster Engine

**Header-resolved columns.** `rosterCols_(sheet)` matches headers by keyword (RANK, NAME, UNIQUE ID/DISCORD,
ACTIVITY, HOURS, JOIN, PROMOT, UNIT/CALLSIGN, OOC, SHIFT); configured positions are only the fallback. Columns
can be reordered freely if labels stay. Cached per sheet id; invalidated with config. The tracker, Patrol Log,
and Signups tabs each have their own header-resolved maps (`trackerCols_`, `patrolLogCols_`, `signupCols_` —
the latter auto-detects the header row, so a themed tab with a banner works).

**Layout ownership.** The operator lays out the sheets; the engine FILLS values and formulas — it never inserts
or deletes rows/columns on user sheets and never repaints their formatting. (The Police Academy and #group
division tabs are engine-built exceptions.)

**Unique IDs.** Discord IDs (17–19 digits) or Community IDs (1–8 digits) — switchable from the menu (🆔 Unique
ID Type). IDs are **text**: `'@'`-formatted before every write, `copyTo` on moves, never coerced to Number.

**Status engine.** `computeStatusCore_(rank, hours, engine)`: per-rank override ladder if one matches, else the
global tier ladder, then `[STATUS_RULES]` applied to a fixed point. `resolveStatus_` protects LEAVE/PROTECTED
statuses. Hour edits recompute via `onEdit`; batch recompute reports every change.

**Transfers.** `moveMemberColumns_` — MEMBER columns follow the person, SLOT columns stay, cross-section moves
clear opted-in section columns; columns move in contiguous runs (one `copyTo` + one clear per run) because the
sheet-edit path runs inside the ~30-second LIMITED onEdit budget that also hosts the confirm dialog. Both paths
share the core: pasting an existing ID into a new row (`checkForMemberMove`, confirm-gated) and the panel's
`cpMoveMember` (identity-guarded). A move-up records a promotion (§3a).

**Dashboard & #tags.** `refreshDashboard_` computes stats once and writes plain values into label-matched KPI
boxes and `#members`-style tags. A Document Property (`RE_DASH_TABS`) remembers which tabs render dashboard
content so edit-driven refreshes touch only those; menu/nightly runs do full rescans.

**§3a · Promotions feed.** `promoRecord_` stores recent promotions (Document Property `RE_PROMOS`);
`renderPromotions_` fills every "RECENT PROMOTIONS" table. The table-bearing tabs are remembered in
`RE_PROMO_TABS` (same convention as the dashboard memo) so the per-transfer render doesn't full-scan every tab;
🔄 Refresh & Update All rediscovers.

**Derived tabs.** The Police Academy and #group division tabs rebuild from the roster: immediately on member
edits via `syncDerivedNow_` (simple-trigger safe, debounced 4s so bursts collapse to one rebuild), with the
deferred-work queue + 1-minute sweep as backstop.

---

## 4 · Leave Lifecycle (LOA/ROA)

1. **Intake** — the wizard-generated Google Form (questions from `[FORM_MAP]`) writes to the response tab.
2. **Sync** — `onFormSubmit` → `syncFormToTracker()`: per-row validation (ID, known type, parseable dates),
   `KEY|id|timestamp` dedup keys (idempotent even if row colours are lost). The roster is the source of truth
   for identity fields (one roster snapshot serves the whole batch). Accepted rows are seated with **one**
   tracker sort for the whole batch, landing new Pending leaves at the top. Errored rows go red and retry.
   Manual: 📥 Sync Leave Forms to Tracker.
3. **Approval** — tracker STATUS → approved. The `onEdit` transition applies an already-active leave
   immediately and fires the leave-approved notification.
4. **Daily job** — `processDailyLOAs` (nightly, script-locked): starts due leaves, expires ended ones
   (status recomputed from hours), posts the configured embeds.
5. **Coverage** — the "who's out now" board rebuilds on schedule and from the menu.

Entering a Unique ID on a tracker row auto-fills the member's identity from the roster (bulk pastes are batched:
one ID read + one roster snapshot for the whole span). The tracker re-groups by `[LEAVE].STATUS_FLOW` with a
stable, value-only rewrite — formatting, dropdowns, and banding never move. The panel's `cpScheduleLeave`
appends exactly like the form path.

---

## 5 · Patrol Hours (the Patrol Log tab)

Sessions live on the **Patrol Log tab** (`[SHEETS].PATROL_LOG`): identity + start/end date + time columns,
header-resolved. Each row is processed by `processPatrolLog_`: identity auto-fills from the roster, the
ISNUMBER-guarded TOTAL TIME formula computes hours, `evaluatePatrolLog_` classifies problems — **blocking**
(unknown ID, non-positive or >24h span → Flagged, data must be fixed) vs **advisory** (over the configured max,
future-dated → Flagged until an admin marks it Processed, which credits with an override note). Valid rows
auto-mark Processed and credit.

**Crediting is reconciliation, not addition.** A hidden col-A marker `"hours|id"` records exactly what was last
credited; `reconcilePatrolCredit_` reverses the prior credit and applies the new one, so a member's HOURS always
equals the sum of their valid logs — idempotent across edits, flag/unflag, ID changes, and deletes. The marker
is written and flushed **before** the roster is touched: a crash under-credits (self-heals next pass), never
double-credits. **Never seed patrol rows without a matching marker.**

The nightly `refreshPatrolLog_` sweep re-processes every row (maturing once-future logs) off **one block read**
of the whole log — cached row data and markers thread through processing, and per-row format churn is skipped
because the closing `sortPatrolLog_` re-applies formats and formulas batched. A legacy form-based intake
(`[SHEETS].PATROL_RESPONSES` + `[PATROL]` column keywords) still syncs submissions into the same crediting path.

---

## 6 · Roster Signups

A Google Form writes to its **own** plain tab (`[SHEETS].SIGNUP_FORM_RESPONSES`). `syncSignupForm_`
field-matches each submission by role (name / OOC / Unique ID / email / DOB / phone / join date) into the themed
**review tab** (`[SHEETS].SIGNUPS`), stamps STATUS **Pending**, marks synced form rows done so re-scans never
double-add, and re-groups Pending → Approved → Processed. STATUS + NOTES are admin-owned columns. Free rows are
found by *identity* (a stray STATUS value never counts as occupied), and a backfill computes them once for the
whole batch. Runs on `onFormSubmit` and 🧾 Sync Signup Form to Review.

**Approval, two ways:**
- **Control Panel ▸ Signups** (the primary path): applicant chips, a read-only detail card, and a rank-grouped
  open-slot picker → `cpSignupApprove`. The approval is **identity-verified** — the panel sends the applicant's
  Unique ID and the server re-resolves the row under the lock (`signupResolveRow_`), because a form submission's
  re-sort can shift rows under an open panel.
- **Sheet-driven:** setting a review row's STATUS to Approved fires the simple-trigger flow — a plain
  `ui.prompt` slot picker (AuthMode.LIMITED can never open an HTML dialog; permanent platform restriction),
  the same identity re-check after the prompt, and a reset to Pending on cancel or failure.

`approveSignup_` seats the member in the chosen open slot, copies their private details (email/DOB/phone) onto
their roster row, carries the join date, and stamps the signup **Processed** — last, so a failure leaves it
actionable.

---

## 7 · The Control Panel

`ControlPanel.html` + `RosterControlPanel.gs`, opened via 👥 Roster ▸ 🎛️. Modeless 1180×760 dialog, Studio
design system, deep-linkable (`openControlPanel('signups')` lands on a tab directly).

**Security architecture (D5):** the client calls exactly one server function — `dispatch(name, args)` — which
validates `name` against the frozen `DISPATCH_ENDPOINTS_` map (unknown → `E-506`). **36 endpoints**; the shim's
`RE_ENDPOINTS` list mirrors it one-for-one (adding an endpoint = one line in each). Writes are **identity-keyed**: the
client sends each row's Unique ID so a shifted row can't hit the wrong member (`cpResolveMemberRow_` for
members, `signupResolveRow_` for signups).

**Tabs:** Members (search/filter/sort, bulk status — one batched read + one RangeList write per selection,
expandable profile cards with move/transfer, leave scheduling, private-details link, discipline history) ·
Add member (rank-grouped slot dropdown + live preview) · **Signups** (§6) · Dividers (per-section styling) ·
Tools (one-click actions, webhook setup) · Columns (SLOT/MEMBER toggles) · System (health checks, snapshots,
audit timeline).

**Rank icons:** uploaded in Settings, compressed client-side, stored chunked in Document Properties, lazy-loaded
after first paint.

**Testing pattern:** every mutating endpoint has an injectable `_`-core taking sheet objects, driven by DevQA
against sandbox tabs; the live wrapper adds lock/audit/notify.

---

## 8 · The Settings Studio

`SettingsPanel.html`, full-screen. Edits **every** config block: typed kv controls, generic table editors, live
search, per-section dirty dots. **Validate-before-write:** the prospective config runs the full validator; any
ERROR refuses the entire change set.

**Discord sections (per channel):** Audit log · LOAs · Patrol logs · Errors. Each owns its webhook (write-only
field) and its slice of the **embed builder** — per-event templates stored as JSON rows in `[EMBEDS]`, edited
against a Discord-accurate live preview with built-in defaults shown until overridden. The sidebar dirty dot is
computed from **that channel's event rows only** (the `[EMBEDS]` table is shared, so a whole-table compare would
light all four).

---

## 9 · The Public Roster (one-way publish)

Members read a separate spreadsheet that mirrors selected tabs from this workbook. Nothing flows back.

- **The public file's own tab list is the allow-list** — copy a tab across to publish it, delete it to stop.
  Blocked name patterns (Config, Webhooks, Disciplin…, Signup…, logs, snapshots, history) are never mirrored.
- **Mode is chosen by grid width** (`getMaxColumns()` — content-independent): same width → wholesale positional
  mirror (required for dashboards with fixed-cell boxes); narrower → header-matched columns only.
- **Sensitive columns never leave the server.** `[PUBLISH].NEVER_PUBLISH` (default EMAIL / DOB / PHONE /
  ADDRESS) is blanked in the outgoing block **before** the write in both modes — the **Unique ID column
  publishes** by design (members find themselves by ID). Residue a manual tab copy brought along is scrubbed.
- **Formulas are carried across** (`publishReadCells_`), number formats too. Destination formulas and
  `[PUBLISH].KEEP_RANGES` are never overwritten (built-ins protect the Welcome Page + roster title blocks even
  when a stored Config row overrides the schema default). Self-computing tabs (cross-sheet ARRAY formulas) are
  left alone and their blocked spill residue is freed — only genuine spill anchors claim their block.
- **All block writes are merge-safe** (`writeValuesSafe_` — plain `setValues` across merged cells throws).
- **Liveness:** the installable `publishOnChange` (onEdit + onChange) publishes the edited tab within seconds
  (3s burst guard, ~8s trailing catch-up trigger); script writes mark a dirty flag carried by the 1-minute
  sweep. A partial (single-tab) publish never clears the global dirty flag — only a full pass does. The
  publisher deliberately steps aside for member transfers (Unique-ID-column edits defer; EDIT/OTHER/FORMAT
  onChange firings skip) so a publish and a roster mutation never race for the script lock. Linkage checks read
  the stored property — never an `openById` round-trip per keystroke.

---

## 10 · Discord Integration

- **Webhooks per channel** (AUDIT / LOA / PATROL / ERRORS), stored in this workbook's Webhooks tab — Google
  sharing gates them. One webhook URL can serve **many** channels (`cpSetWebhookChannels`); per-channel test
  posts. URLs are **write-only secrets**: set from the panel/Settings, never echoed back to any page, never
  logged or audited.
- **Embeds:** built-in defaults per event, overridable per-field in the Settings embed builder (`[EMBEDS]`),
  shared chrome (author/thumbnail/image/footer, http(s)-only), `{token}` substitution, native-emoji field
  labels. `notify_` never throws and posts after locks release.
- **Events:** leave lifecycle, patrol credits + flag summaries, audit entries, coded errors (throttled
  1/code/5min), plus the `[NOTIFICATIONS]` opt-ins (member added, transfer, weekly digest…).

---

## 11 · Trust & Safety

- **Audit (always-on):** the installable `auditEdit` trigger logs who/what/when to the Edit Log; panel and menu
  actions log semantically via `auditEvent_`. **Editor identity resolves to a member name:** `auditWho_(email)`
  matches the editing account's email against the roster's private EMAIL column — a match shows the member's
  NAME everywhere (Edit Log, Discord audit embeds, webhook set-by stamps, discipline "Issued by"); no match
  keeps the raw email. Memoized to one roster read per execution.
- **Snapshots:** hidden `_Snapshots` tab, keeps the last `SNAPSHOT_KEEP`; restore is identity-mapped (a row
  shift since the snapshot can't drop data on the wrong member) with an ID-precision guard; pruning deletes
  contiguous runs. Optional weekly auto-snapshot.
- **Discipline:** the Disciplinary Log is append-only under the script lock (concurrent panels can't overwrite
  each other), `'@'`-formatted before every write.
- **Integrity scan:** duplicate/malformed IDs, status-vs-hours mismatches, orphaned leaves — logged + posted.
- **Health check:** config validity first, then structure/triggers/webhooks; drives the panel health pill.
- **Coded errors:** `REGISTRY_` defines every code with a hint; `runAction_` wraps menu commands with coded-modal
  handling and success audit.

**Hard invariants (never violate):**
1. Unique IDs are **text** — `'@'` before writing, `copyTo` on moves, never Number.
2. Webhook URLs are write-only secrets — never echoed to a page, never logged.
3. Any user-text cell write gets `'@'` first (formula injection).
4. Accumulating writes (hours) reconcile against a durable marker written **before** the mutation.
5. Notifications never throw into their triggering action; webhooks post after locks release.
6. Simple `onEdit` runs in AuthMode.LIMITED: no other-file opens, no UrlFetch, no trigger creation, no HTML
   dialogs (`ui.alert`/`ui.prompt` only) — and its ~30s budget spans any human dialog.
7. Publishing and roster mutations never contend for the same script lock.
8. The engine fills user sheets — it never restructures or reformats their layout.
9. DevQA touches 🧪-prefixed sandbox tabs only.

---

## 12 · Menus & Triggers

**👥 Roster:** 🎛️ Open Control Panel · ⚙️ Engine Settings │ 🔄 Refresh & Update All · 📥 Sync Leave Forms to
Tracker · 🧾 Sync Signup Form to Review · 📸 Capture & Reset Activity · 🔍 Run Integrity Scan · 🌐 Publish
Public Roster │ ➕ Add Member Rows… · 🎙️ Fix All Callsign Numbers · 🗂️ Build / Refresh Group Sheets · 🎓 Build /
Refresh Police Academy │ 🌐 Set Up Public Roster · 🆔 Unique ID Type ▸ (Discord / Community) · 🧩 Sync Column
Config · 🚀 First-Run Setup · 🔌 Install Triggers.

**🧪 Dev / QA:** 🎬 Load Demo Roster · 🎲/🚔/🧾 Add Random LOA / Patrol Log / Signup │ ▶️ Run Tests Part 1
(1–8) / Part 2 (9–16) / Part 3 (17–23) · ⏱️ Run ALL Tests · 🔬 Run one section (1–23) · 🧹 Delete Sandbox /
Results Tabs.

Every action reports what it actually did (counts, names, changes).

**Triggers:** simple — `onOpen` (menus), `onEdit` (status recompute, transfer detect, tracker/patrol/signup row
handling, approval hooks, derived-tab rebuilds, dashboard refresh). Installable (🔌 Install Triggers) —
`onFormSubmit` (leave + patrol + signup syncs), `processDailyLOAs` (nightly), `auditEdit`, `publishOnChange`
(onEdit **and** onChange), `publishSweep` (1-minute), integrity/coverage/reset schedules, optional weekly
snapshot. In library mode the shim forwards all of these.

---

## 13 · Performance Architecture

- **Config cache** (§2) — panel actions and triggers skip the config-tab read on cache hits.
- **Tab memories** — `RE_DASH_TABS` (dashboard) and `RE_PROMO_TABS` (promotions) bound per-edit rendering to
  the tabs that actually need it; menu refreshes rediscover.
- **Batched sweeps** — the Patrol Log refresh reads the whole log once and threads cached rows + markers
  through processing; the leave-form sync seats a whole batch with one tracker sort; bulk status = one
  RangeList write; snapshot pruning and history dedup delete contiguous runs.
- **LIMITED-budget discipline** — everything on the simple-onEdit path (transfers, tracker/patrol pastes)
  batches its reads and hoists one roster snapshot for the span; cheap critical writes run before heavy
  rebuilds, UrlFetch last.
- **Lazy rank icons**, **derived-tab debounce** (4s), **`[LOGGING].PERF_TIMING`** opt-in per-action timings.
- General discipline: batch full-width reads/writes; per-cell writes only where merge-safety or durability
  demands them (`writeValuesSafe_` anchors, the patrol credit marker).

---

## 14 · The QA System

`RosterDevQA.gs`: **23 sections** (unit/pure, status engine, leave lifecycle, form sync, maintenance, Discord
guards, ID precision, adversarial, panel & audit, extras, trust, config engine, dispatch & migrations,
white-label, identity-keyed writes, config robustness, dashboard render, settings apply, config extensions,
new-layout columns, Patrol Log, Roster Signups, public publish). Everything runs against 🧪-prefixed **sandbox
tabs** (reused via `clear()` for speed) — never live data.

**Run it in three parts** (▶️ Part 1 / 2 / 3) — the full 23-section run can exceed Apps Script's ~6-minute
execution cap; the split points live in one array (`DEV_PART_ENDS_`). Each part repeats the live-config
preflight; results render to the "🧪 Test Results" tab (last run wins, header labeled with the part).

Sandbox limits to remember: plain grids — no merges, no formatting, no timezone quirks. Passing tests prove
logic, not layout behavior; the live smoke test (one signup, one leave, one patrol log, one transfer, one
publish) is part of every release.

**Local static validation** (no Apps Script needed): Node `new Function(src)` syntax check + zero-control-byte
scan per file; HTML script blocks are extracted, GAS scriptlets stubbed, and `node --check`ed the same way.

---

## 15 · Maintenance

**Release recipe:** bump `ENGINE_VERSION` (+ `CP_VERSION`) → syntax-check every file → commit → `clasp push -f`
→ run all three QA parts → live smoke test. After schema-affecting changes: run 🚀 First-Run Setup once
(idempotent).

**Sync rules:** `clasp push -f` syncs every engine file (`.claspignore` keeps `TEMPLATE-SHIM.gs` out — it ships
only inside community templates). Library users re-paste `TEMPLATE-SHIM.gs` whenever the endpoint list changes.

**Keep-current rule:** when code changes, update the matching section here in the same commit. Companion docs
(staff guide, feature pitch, menu reference) live outside this folder and predate 1.0 — this file is the
authoritative system reference.
