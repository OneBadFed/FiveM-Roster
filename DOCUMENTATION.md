# Roster Engine v2 — System Documentation

> **Version:** Engine **v2.5.0** · Config schema **v2** · Control Panel **v1.4.0** · 33 whitelisted endpoints
> **Updated:** 2026-07-16 · Release record: `CHANGELOG.md` · Feature pitch: `ROSTER-ENGINE-FEATURES.md` · Staff manual: `STAFF-GUIDE.md` *(staff guide prose is June-era; this file is current)*
>
> A white-label, schema-driven personnel-management engine for Google Sheets, built in Google Apps Script.
> Everything below describes the code in this folder; the live project is these files pasted into the Apps Script editor.

---

## 1 · Architecture

**File set (9 files, one system):**

| File | Role |
|---|---|
| `RosterConfig.gs` | Config layer: ⚙️ Config tab schema (`BLOCK_SPECS_`), parse → validate → materialize (`cfg_()`), error registry + coded errors, SYS Log ring buffer, theme, migrations, cross-execution config cache, `perf_` timing |
| `RosterSystem.gs` | The engine: CONFIG bridge, header-resolved columns, status engine, transfers, leave lifecycle, patrol-hours sync, event notifications, dashboard + #tags, menus, First-Run wizard, data validation |
| `RosterControlPanel.gs` | Control Panel server: the D5 `dispatch()` whitelist gateway and every `cp*` endpoint; rank-icon + divider-style storage; the Admin Roster |
| `RosterTrust.gs` | Snapshots/restore, the always-on Edit Log audit system, health & schema checks |
| `RosterExtras.gs` | Integrity scan, leave coverage board, hours history + cadence-aware weekly reset, demo seeder |
| `RosterDevQA.gs` | The QA suite — 19 sections, sandbox-only, run-all or per-section from the 🧪 menu |
| `ControlPanel.html` | Control Panel UI (single HtmlService dialog, Studio design system) |
| `SettingsPanel.html` | Settings Studio UI (full-screen config editor) |
| `TEMPLATE-SHIM.gs` | **Library mode only** — the public template's entire bound script: endpoint whitelist mirror + trigger forwarders. Never paste alongside the engine |

**Two deployment modes.** *Bound:* paste files 1–8 into a sheet's own Apps Script project. *Library:* files 1–8 live in a standalone project deployed as a versioned library (identifier must be `RE`); each community template carries only `TEMPLATE-SHIM.gs`. See `ROSTER-ENGINE-V2-RUNBOOK.md`.

**One global scope.** All `.gs` files share a single namespace — file boundaries are organisational. A syntax error anywhere breaks everything (the DevQA suite and the Node syntax check exist for this).

**Design decisions (D1–D5, settled):** library + thin shim (D1); full white-label, sheet-as-untrusted-input with one hardcoded anchor — the ⚙️ Config tab + marker rescue (D2); template → copy → First-Run wizard (D3); diagnostics-first with coded errors (D4); **every** panel server call through one whitelisted `dispatch(name, args)` gateway (D5).

---

## 2 · The Config Layer

The **⚙️ Config tab** is the single source of truth (it survives "Make a copy"; Script Properties don't). INI-style blocks; `BLOCK_SPECS_` defines every block/key with type, default, validation, and help — one spec drives seeding, parsing, validation, and the Settings Studio.

**Flow:** `parseBlocks_(sheet)` (display-value strings) → `validateConfig_(raw)` (collects ALL problems; any ERROR → `E-102`, nothing half-applied) → `materialize_(config)` (typed views incl. `.legacy`) → memoized in `CFG_`.

**The CONFIG bridge:** `Object.defineProperty(globalThis,'CONFIG',{get:()=>cfg_().legacy})` — ~450 classic `CONFIG.*` reads flow through the config layer with zero call-site churn.

**Cross-execution cache (v2.5.0 perf):** `cfg_()` first tries `CacheService.getDocumentCache()` (`RE_CFG_RAW_v1`, TTL 300s, raw parsed strings only). Every config write path funnels through `cfgInvalidate_()`, which clears the per-execution memo, the column cache, **and** the document cache — so changes propagate to all users instantly; the TTL only bounds genuinely unreachable paths.

**Schema & migrations:** `SYSTEM.SCHEMA_VERSION` (currently **2**). `migrateConfig_` seeds additively — First-Run Setup upgrades an older sheet without deleting anything. All v2.5.0 additions are additive: `validateConfig_({})` yields zero ERRORs and defaults reproduce prior behavior exactly.

### Config blocks (key inventory)

- **SYSTEM** — `SYSTEM_NAME`, `DEV_MODE`, `MAINTENANCE_MODE`, `SCHEMA_VERSION` (engine-managed, hidden in Settings).
- **SHEETS** — tab names for every role: `ROSTER`, `TRACKER`, `FORM_RESPONSES`, `AUDIT`, `HOURS_HISTORY`, `COVERAGE`, `INTEGRITY`, `SNAPSHOTS`, `PATROL_RESPONSES` ('' = patrol off). Roles must resolve to distinct tabs (collision → ERROR). `SYS Log` is deliberately not configurable (re-entrancy: `slog_`/`theme_` must never call `cfg_()`).
- **ROSTER_LAYOUT** — `HEADER_ROW` (5), `DATA_START_ROW` (7), `TRACKER_START_ROW` (6), `DIVIDER_MODE` (`ALLCAPS_RANK` | `EXPLICIT_LIST`), `TRAINING_KEYWORDS`, `UNIT_FORMAT` (callsign template, e.g. `S-{00}`), `LAST_ACTIVITY_STYLE` (`MATCH` | `NEUTRAL`).
- **COLUMNS** *(table)* — Role/Match/Class/Required rows classifying every roster column **SLOT** (stays with the position) or **MEMBER** (follows the person). Managed via the panel's Columns tab; `syncColumnConfig` discovers new columns.
- **SECTIONS / SECTION_TAGS** *(tables)* — per-section cert-slot opt-ins (ships empty) and divider tag labels/keywords/tones.
- **STATUSES / STATUS_OVERRIDES / STATUS_RULES** *(tables)* — the global tier ladder (each status = TIER with MinHours, LEAVE, or PROTECTED); per-rank/section ladder overrides (seed: `Auxiliary Trooper → Active:5, Inactive:0`); optional stateless transition rules (`Source · op · hours · Target`) evaluated to a fixed point — pure function of (status, hours), so re-runs never drift.
- **RANKS** *(table)* — explicit rank/divider list used when `DIVIDER_MODE=EXPLICIT_LIST`; unlisted labels fall back to the all-caps heuristic.
- **LEAVE** — `LEAVE_TYPES` (LOA, ROA), `RETURN_TYPE`, `STATUS_FLOW`, `APPROVED_STATUS`, `EXPIRED_STATUS`, `RETURN_STATUS`, `AUTO_EXPIRE`, `EXPIRE_NEVER_APPROVED`, `MAX_DAYS_WARN`.
- **FORM_MAP** *(table)* — leave-form question keywords (the engine *creates* this form, so `CONFIG.form` uses fixed columns 1–8).
- **DISCORD** — `MENTION_MEMBERS`, `PING_ROLES`, submit/return/expire titles & colours, and the embed chrome: `EMBED_AUTHOR(_ICON)`, `EMBED_THUMBNAIL`, `EMBED_IMAGE`, `EMBED_FOOTER(_ICON)` — all optional, http(s)-only.
- **NOTIFICATIONS** — six opt-in event embeds, each `TOGGLE` + `_TITLE` (tokens `{name}/{from}/{to}/{type}/{hours}/{total}`) + `_COLOR`: `MEMBER_ADDED`, `TRANSFER`, `LEAVE_APPROVED`, `LEAVE_STARTED`, `WEEKLY_DIGEST`, `PATROL_LOGGED`. All OFF by default.
- **PATROL** — `MODE` (`START_END` | `DURATION`), `MAX_HOURS`, `OVERNIGHT`, `RECOMPUTE`, and header keywords `COL_DISCORD/COL_CALLSIGN/COL_START/COL_END/COL_DURATION` (the operator links their *own* form, so columns resolve by header).
- **FORMATS** — `DATE_DISPLAY`, `TIMESTAMP_DISPLAY` (fault-tolerant; bad patterns fall back).
- **SCHEDULE** — `NIGHTLY_HOUR`, `WEEKLY_HOURS_RESET` (day or OFF), `WEEKLY_RESET_HOUR`, `RESET_CADENCE` (`WEEKLY/BIWEEKLY/MONTHLY/MANUAL`), `RESET_DOM`, `TIMEZONE`.
- **LOGGING** — `LOG_LEVEL`, `LOG_MAX_ROWS`, `EMAIL_ON_ERROR`, `DIAG_INCLUDE_NAMES`, `PERF_TIMING` (log per-action durations; entries log at INFO).
- **LIMITS** — `SNAPSHOT_KEEP`, `LOG_ROW_CAP`, `VALIDATION_BUFFER`.
- **THEME** — 12 colours driving every engine-painted surface (see `roster-sheet-theme`: canvas `#1c1c1c`, banner `#1f2933`, accent `#3f86e6`, PASS/FAIL/INFO semantics…).
- **DASHBOARD / DASHBOARD_GROUPS / DASHBOARD_CELLS** — enable flag, search depth, headcount group buckets, and KPI label→stat mappings.

---

## 3 · The Roster Engine

**Header-resolved columns.** `rosterCols_(sheet)` matches row-5 headers by keyword (RANK, NAME, DISCORD, ACTIVITY, HOURS, JOIN, PROMOT, `^UNIT\b`/CALLSIGN); `CONFIG.roster` positions are only the fallback. Columns can be reordered freely if labels stay. Cached per sheet id; invalidated with config.

**Dividers & sections.** `isDividerValue_` = ALL-CAPS >3 chars (default) or the explicit `[RANKS]` list. Everything divider-vs-member routes through one primitive, so the panel, transfers, stats, and validity checks always agree. `sectionCategory_` maps divider labels → typed tags (Executive/Administrative/Supervisor/Cadet/Training/Patrol/Auxiliary/Command) for the panel's role-colour system.

**Status engine.** `computeStatusCore_(rank, hours, engine)`: per-rank override ladder if one matches, else the global tier ladder, then `[STATUS_RULES]` applied to a fixed point. `resolveStatus_` protects LEAVE/PROTECTED statuses from being overwritten. Single-cell hour edits recompute that row via `onEdit`; **Update All Statuses** batch-recomputes and reports every change. `recomputeStatuses_(sheet, zeroHours)` returns `{total, changed[], protectedSkipped}`.

**Callsigns.** `formatUnit_(n)` renders `[ROSTER_LAYOUT].UNIT_FORMAT` (`{00}`-style token = zero-pad width, grows past pad). `updateUnitNumbers_` renumbers every member slot, skipping dividers.

**Transfers.** `moveMemberColumns_(sheet, src, dst)` — the single shared core: MEMBER columns follow the person (`copyTo` = value+format, precision-safe for IDs), SLOT columns stay, cross-section moves clear opted-in section columns only. Used by both the sheet-edit path (`checkForMemberMove`, triggered by typing an existing Discord ID into another row) and the panel's `cpMoveMember` (open-slot picker, `expectedId`-guarded, audited as `move`, fires the transfer notification).

**LAST ACTIVITY.** Optional column (header-matched). 📸 Capture snapshots current → last for every member. Colour style: `MATCH` mirrors the ACTIVITY conditional formats onto the column; `NEUTRAL` splits the CF rules around the column and paints row-base colours (menu items apply instantly; the choice persists in config).

**Dashboard & #tags.** `refreshDashboard_` computes stats once from the roster, then writes **plain values** into KPI boxes found by *label text* (merged-range aware; below/right per `DASHBOARD_CELLS`) and converts/updates `#members`-style tags (state kept in cell notes `roster-stat:`). **Perf (v2.5.0):** a Document Property (`RE_DASH_TABS`) remembers which tabs actually render dashboard content; edit-driven refreshes touch only those. Discovery stays automatic (an edit on an unknown tab renders that one tab), the menu/wizard/nightly job do full rescans, and the fast path never prunes (a throw or transient zero can't drop a live tab).

---

## 4 · Leave Lifecycle (LOA/ROA)

1. **Intake** — the wizard-generated Google Form (questions from `[FORM_MAP]`, Discord-ID regex enforced on the form itself) writes to the response tab.
2. **Sync** — `onFormSubmit` → `syncFormToTracker()`: per-row validation (ID regex, known type, parseable dates), append to the tracker with a `KEY|id|timestamp` dedup key (idempotent even if row colours are lost), countdown formulas, themed done/error row tints. Errored rows stay red and retry after fixes. Manual: 🔗 Sync Leave Forms (reports the count).
3. **Approval** — tracker Status → `APPROVED_STATUS`. The `onEdit` transition applies an already-active leave immediately (`checkImmediateLOAStart`) and fires the leave-approved notification.
4. **Daily job** — `processDailyLOAs` (nightly + menu Force-Run, script-locked): starts due leaves (roster status → leave type; leave-started notifications) and expires ended ones (status recomputed from hours; expiry embed). Manual runs show a scanned/started/expired summary.
5. **Coverage** — `buildCoverage` (6am + menu) rebuilds the "who's out now" tab.

Panel equivalent: `cpScheduleLeave` appends exactly like the form path (same dedup key + formulas).

---

## 5 · Patrol Hours

Operator links their **own** patrol form: set `[SHEETS].PATROL_RESPONSES` to its response tab (blank = feature off). Columns resolve by header keyword (`patrolCols_`). Each unprocessed row: `patrolDuration_` computes hours (`START_END` = end−start, overnight +24h if enabled, reject ≤0 or >`MAX_HOURS`; `DURATION` = `parseHours_`), `patrolFindRow_` matches the member (**a provided Discord ID must be valid AND on the roster — no callsign guessing on bad IDs; callsign fallback only when the ID field is empty AND exactly one member matches**), then the credit: hours added, status optionally recomputed, audited as `patrol`.

**Idempotency is durable:** a `_Credited` stamp column is written + flushed *before* the roster is touched — a crash, timeout, or cleared row background can never double-count a log. Error rows go red and retry. Runs from the same `onFormSubmit` (each sync self-guards by its own tab — no per-form routing) and from 🚔 Sync Patrol Hours (reports credits, totals, and flagged rows).

---

## 6 · The Control Panel

`ControlPanel.html` + `RosterControlPanel.gs`, opened via 📋 Roster ▸ 🎛️. Modeless 1180×760 dialog, Studio design system.

**Security architecture (D5):** the client calls exactly one server function — `dispatch(name, args)` — which validates `name` against the frozen `DISPATCH_ENDPOINTS_` map (unknown → `E-506`). The shim mirrors the list (`RE_ENDPOINTS`), and a DevQA pin asserts **exactly 33** in both. Adding an endpoint = 3 lock-step edits. Writes are **identity-keyed**: the client sends each row's Discord ID (`expectedId`) so a shifted row can't hit the wrong member.

**The 33 endpoints:** `cpPing, cpBootstrap, cpRefresh, cpGetProfile, cpSetStatus, cpSetStatusBulk, cpScheduleLeave, cpAssignMember, cpMoveMember, cpRunAction, cpJumpTo, cpSystemInfo, cpColumnsInfo, cpSetColumnClass, cpDividersInfo, cpFixTriggers, cpTakeSnapshot, cpRestoreSnapshot, cpSetSnapshotAuto, cpSetWebhook, cpTestWebhook, cpGetConfig, cpApplyConfig, cpOpenSettings, cpRankIcons, cpSetRankIcon, cpDeleteRankIcon, cpSetDividerStyle, cpDeleteDividerStyle, cpAdminSetup, cpAdminInfo, cpAdminSave, cpAddDiscipline`.

**Tabs:** Members (search/filter/sort, bulk status, expandable profile cards: stats, status segmented control, **Move/transfer** open-slot picker, schedule leave, **Admin · private** section, activity checks, hours sparkline, leave history) · Add member (rank-grouped slot dropdown + live preview) · Dividers (per-section counts, expandable member lists, per-divider pill/tone/icon editor — `DIVSTYLE:` Document Properties) · Tools (one-click actions, webhook setup — write-only fields, admin-roster setup) · Columns (SLOT/MEMBER toggles with live samples) · System (health checks, snapshots, the audit timeline with 15s auto-refresh).

**Rank icons:** uploaded in Settings, auto-compressed client-side (fit-inside square; PNG→WebP-with-alpha→JPEG ladder), stored chunked in **Document Properties** (`REICON:` — never sheet cells, never script properties which the library shares across templates). Lazy-loaded after first paint for a fast open.

**Testing pattern:** every mutating endpoint has an injectable `_`-core taking sheet objects, driven by DevQA against sandbox tabs; the live wrapper adds lock/audit/notify.

---

## 7 · The Settings Studio

`SettingsPanel.html`, full-screen. Edits **every** config block: kv keys render by type (dropdowns, toggles, colour pickers, chip editors, ladder step-builders), tables get a generic editor, live search, per-section dirty state. **Validate-before-write:** the prospective config runs the full validator; any ERROR refuses the entire change set. Live previews: a faithful full-message Discord embed (XSS-safe `dcRender` markdown renderer — escape-sequence placeholders, never raw control bytes) and a theme mini-sheet.

---

## 8 · The Admin Roster (private member data)

A **separate, admin-only spreadsheet** — required because *anyone who can view a Google Sheet can read every tab in it* (hidden tabs and protected ranges are not privacy). Linked by file ID in Document Properties (`ADMIN_ROSTER_ID`), keyed by Discord ID.

**Security model:** panel dialogs execute *as the person using them*, so every admin read/write goes through `SpreadsheetApp.openById()` under **that user's Google permissions** — the file's share list is the access control, enforceable even against direct `dispatch` calls. Hard rules: admin data never touches the main spreadsheet (no cells, no Edit Log, no logs); the **link is gated** (`assertMayRelink_`: once set, only someone who can open the current admin file, or the sheet owner, may change it — every change is logged and stamped "linked by X on date" on the Tools tab); all writes are `'@'`-formatted first (pasted `=…` can never execute as a formula).

**Scalable fields:** the admin file's **header row is the schema.** `Member Details` fixes only cols 1–2 (Discord ID, Name); every column added after them (≤30) auto-renders as an editable private field on profile cards — field *names* stay out of the public sheet. Duplicate labels are deduped (first column wins; siblings untouched), saves only touch provided fields (empty = clear, omitted = preserve), unknown labels are reported (never silently dropped), fields named like "…Notes" render as textareas, whole-label `Email` fields get address validation. `Disciplinary Log` is append-only: Date · ID · Name · Action · Reason · Issued By · Status (issuer captured automatically; card shows newest 50).

---

## 9 · Discord Integration

- **Webhooks:** MAIN (notifications) + optional ERRORS (coded errors, CacheService-throttled 1/code/5min). URLs live **only** in Script Properties, set via write-only panel fields, never echoed back.
- **Embeds:** native-emoji field labels (`👤 Name`, `🛡️ Rank`, `🎙️ Callsign`, `▶️ Start Date`…), configurable titles/colours, shared chrome via `embedChromeFrom_`/`footerFrom_` (author/thumbnail/image/footer; http(s)-only via `embedUrl_`). `notify_(on, embed, content)` never throws and posts after locks release; `fill_(template, vars)` does `{token}` substitution; `mention_` pings only valid IDs.
- **Events:** leave submission/expiry (always, classic) + the six `[NOTIFICATIONS]` opt-ins (§2).

---

## 10 · Trust & Safety

- **Audit (always-on):** installable `auditEdit` trigger logs who/what/when to the Edit Log; panel actions and menu commands log semantically via `auditEvent_(type,…)` (types: add/status/bulk/leave/move/patrol/action/snapshot/restore). Member moves are detected in `auditEdit` itself. Known limit: consumer-Gmail installable triggers may report "unknown" editor for *other* accounts' raw sheet edits.
- **Snapshots:** `_Snapshots` tab, keeps last `SNAPSHOT_KEEP`; captures extra MEMBER columns as JSON; restore is two-click with an ID-precision guard. Optional weekly auto-snapshot (Sun ~22:00).
- **Integrity scan:** daily 7am + menu — duplicate/malformed IDs, status-vs-hours mismatches, orphaned leaves; logs to Integrity Log, posts a Discord summary, and the manual run shows the actual issue list.
- **Health check:** `cpHealthCheck_` — config validity first, then structure/triggers/webhook; drives the panel health pill and one-click fixes.
- **Coded errors:** `REGISTRY_` in RosterConfig.gs defines 12 codes (config: E-101/102/103/104/110 · structure: E-201/202/205 · plus E-301/501/506/601); every error carries a hint and a docs anchor (`DOCS_URL` + `/errors#e-xxx` once the docs site is deployed). `runAction_` wraps every menu command with coded-modal handling and success audit.

**Hard invariants (never violate):**
1. Discord IDs are 17–19 digit **text** — `setNumberFormat('@')` *before* writing; `copyTo` for moves; never coerce to Number.
2. Webhooks/secrets only in Script Properties. Panel-scoped storage in **Document** Properties.
3. Any user-text write into a cell gets `'@'` first (a string starting `=` becomes a live formula otherwise).
4. Accumulating writes (hours) need a durable dedup key written before the mutation.
5. Notifications/side-effects never throw into their triggering action; webhooks post after locks release.
6. Admin data never touches the main file.
7. DevQA touches sandbox tabs only.

---

## 11 · Menus & Triggers

**📋 Roster:** Open Control Panel · Engine Settings │ Add Member Rows… · Fix All Unit Numbers │ Update All Statuses · Refresh Dashboard · Reset Weekly Hours (saves history first) · 📸 Last Activity ▸ (Capture / Colours→Neutral / Colours→Match) │ Sync Leave Forms · 🚔 Sync Patrol Hours · Style Form Responses · Force Run Daily Schedule Check │ Check Duplicate Discord IDs · Sync Column Config │ First-Run Setup · **Install Triggers** (installs core *and* extras triggers in one click).
**🛠️ Extras:** Rebuild Leave Coverage · Run Integrity Scan · Weekly Reset (saves history) │ Load Demo Roster (preview).
**🧪 Dev / QA:** Run ALL Tests · Run one section (1–19).
Every action reports what it actually did (counts, names, changes).

**Triggers:** simple — `onOpen` (menus), `onEdit` (status recompute, transfer detect, approval hook, config invalidation, dashboard refresh). Installable (via Install Triggers / wizard) — `onFormSubmit`, `processDailyLOAs` (nightly, `NIGHTLY_HOUR`), `auditEdit`, `scanIntegrity` (7am), `buildCoverage` (6am), `weeklyResetScheduled` (cadence-gated by `resetDue_` + `LAST_RESET` marker), optional `weeklySnapshotScheduled`. In library mode the shim forwards all of these.

---

## 12 · Performance Architecture (v2.5.0)

- **Config cache** (§2) — panel actions/triggers skip the config-tab read on cache hits.
- **Dashboard tab memory** (§3) — edit-driven refreshes render only remembered tabs; full rescans on menu/wizard/nightly; never prunes on failure.
- **Lazy rank icons** — `cpBootstrap` ships `rankIcons:{}`; the panel fetches `cpRankIcons` after first paint (shape: `{ranks:[{rank,icon,members}]}`).
- **`[LOGGING].PERF_TIMING`** — opt-in per-action duration logging via `perf_` wrapping `dispatch` (reads the flag from the already-loaded config memo only — never forces a config load).
- General discipline: batch full-width reads/writes; per-cell loops only where formats matter (transfers) or durability demands it (patrol stamps).

---

## 13 · The QA System

`RosterDevQA.gs`: ~850+ assertions in **19 sections** (unit/pure, status engine, leave lifecycle, form sync, maintenance, Discord guards, ID precision, adversarial, panel & audit, extras, trust, config engine, dispatch & migrations, white-label, settings apply, v2.5 features, …). Everything runs against 🧪-prefixed **sandbox tabs** (reused via `clear()` for speed; `DEV_THEME_SANDBOX=false`) — never live data. A live-config **preflight** flags customized configs up front; tests asserting engine defaults wrap in `devWithConfig_({})` so a customized sheet can't red them. Results render to a themed "🧪 Test Results" tab. The whitelist parity test doubles as the shim contract.

**Local static validation** (no Apps Script needed): Node `new Function(src)` syntax check + a zero-control-byte scan per file; the panel `<script>` blocks check the same way.

---

## 14 · Maintenance

**Release recipe:** bump `ENGINE_VERSION` → write `CHANGELOG.md` → regen bundles (`FULL-SOURCE.md`, `Roster-Engine-<ver>-full-source.txt`, `_files/*.txt` — the regen script fence-checks and control-byte-scans) → deploy a library version → bump the template's pinned version → sync the web changelog (`web/lib/roster-engine.ts`).

**Re-paste rules:** all engine `.gs` files + changed HTML; library users also re-paste `TEMPLATE-SHIM.gs` whenever the endpoint list changes. After schema-affecting changes: run 🚀 First-Run Setup once (idempotent), then 🧪 Run ALL Tests.

**Docs set:** this file (current, 2026-07-16) · `STAFF-GUIDE.md` (user manual — June-era prose) · `ROSTER-ENGINE-FEATURES.md` (presentation) · `MENU-REFERENCE.md` / `ROSTER-CELL-REFERENCE.md` · `ROSTER-ENGINE-V2-BRIEF.md` (design contract) · `ROSTER-ENGINE-V2-RUNBOOK.md` (publish/deploy). Keep-current rule: when code changes, update the matching section here and regen the bundle.
