# Roster Engine — System Documentation

> **Version:** Engine **v1.0.0** · Config schema **v2** · Control Panel **v1.0.0** · 36 whitelisted endpoints
> **Updated:** 2026-07-28
>
> A white-label, schema-driven personnel-management engine for Google Sheets, built in Google Apps Script.
> Everything below describes the code in this folder; the live project is these files synced into the Apps Script
> editor via `clasp push -f`. The folder is a git repo — commit before every sync.

---

## 1 · Architecture

**The bound workbook IS the internal roster.** It holds everything private: the member roster (including the
private EMAIL / DATE OF BIRTH / PHONE columns), the LOA Tracker, the Patrol Log, Roster Signups, Webhooks,
⚙️ Config, and the system logs. Google file sharing is the access control — only staff are ever
invited to this file. Members read a **separate public spreadsheet** that receives a ONE-WAY publish (§9); nothing
ever flows back. There is no separate "admin file" — `adminFile_()` resolves to the active spreadsheet.

**File set (9 files, one system):**

| File | Role |
|---|---|
| `RosterConfig.gs` | Config layer: ⚙️ Config tab schema (`BLOCK_SPECS_`), parse → validate → materialize (`cfg_()`), error registry + coded errors, SYS Log ring buffer, theme, migrations, cross-execution config cache, `perf_` timing |
| `RosterSystem.gs` | The engine: CONFIG bridge, header-resolved columns, status engine, transfers, leave lifecycle, Patrol Log crediting, dashboard + #tags, promotions feed, derived-tab rebuilds, menus, First-Run wizard |
| `RosterControlPanel.gs` | Control Panel server: the D5 `dispatch()` whitelist gateway and every `cp*` endpoint; signup sync + approval; the public-roster publish pipeline; webhooks; rank-icon storage |
| `RosterTrust.gs` | Snapshots/restore, the always-on Edit Log audit (with editor-name resolution), health & schema checks |
| `RosterExtras.gs` | Integrity scan, leave coverage board, the Activity Panel board (§5a), hours history + cadence-aware reset + period archive, group / Police Academy tab builders, full-lifecycle demo seeder |
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
**Key renames AND moves use `aka` aliases:** a spec key with `aka` (e.g. `LEAVE_FORM_RESPONSES` aka `FORM_RESPONSES`,
`PATROL_FORM_RESPONSES` aka `PATROL_RESPONSES`) accepts the legacy row's value at validate time (explicit
new-name row wins), and re-seeding migrates the old row's value into the new-name row and retires the old one —
so renaming a key never breaks an existing sheet. An `aka` containing a dot (`SCHEDULE.AUTO_RESET`) means the key
**moved between blocks**: the value is pulled from the old block, the old row is retired rather than re-emitted as
"unknown key — preserved", and the target block is considered even when the sheet has no such block yet — that
absent-block case IS the pre-move sheet, and skipping it silently reset every moved setting to its default.

**Blocks (inventory):** SYSTEM · SHEETS (tab names for every role incl. `PATROL_LOG`, `SIGNUPS`,
`SIGNUP_FORM_RESPONSES`, `ACTIVITY` — the Activity Panel board (§5a), and `WELCOME` — the Welcome/dashboard tab
the publish keep/force ranges resolve
against; roles must resolve to distinct tabs) · ROSTER_LAYOUT (header/data rows, divider mode,
`UNIT_FORMAT` callsign template, `ID_TYPE` + digit range, the SHIFT column's header/values/ownership) ·
COLUMNS *(table — SLOT vs MEMBER classes)* ·
SECTION_TAGS *(table)* · STATUSES / STATUS_OVERRIDES / STATUS_RULES *(tables — tier ladder,
per-rank overrides, fixed-point transition rules)* · RANKS *(table)* · LEAVE · FORM_MAP *(table)* · DISCORD ·
NOTIFICATIONS (opt-in event embeds) · EMBEDS *(table — per-event embed overrides from the Settings builder)* ·
PATROL (mode, max hours, statuses, form column keywords, `FUTURE_GRACE_HOURS` — §5) ·
PUBLISH (`NEVER_PUBLISH`, `KEEP_RANGES`, `FORCE_RANGES`) · FORMATS ·
**ACTIVITY** *(the whole activity cycle in one block — `AUTO_RESET`, cadence/day/hour/day-of-month, `PERIOD_BUCKET`,
`PERIOD_LABEL_FORMAT`, `LAST_ACTIVITY_COLS` + style, `PANEL_TAB`; §3a)* · SCHEDULE (`NIGHTLY_HOUR`) · LOGGING · LIMITS · THEME · DASHBOARD / DASHBOARD_GROUPS.

Every key in every block reaches an engine consumer. A block or key that is withdrawn is listed in `RETIRED_`
(RosterConfig.gs) rather than merely deleted from the schema: an existing sheet still carries the row, and the
retirement list is what stops it becoming a permanent "unknown key — preserved" warning and gets the next seed to
drop it. `tools/cfgcheck.js` fails if anything is both retired and live.

---

## 3 · The Roster Engine

**Header-resolved columns.** `rosterCols_(sheet)` matches headers by keyword (RANK, NAME, UNIQUE ID/DISCORD,
ACTIVITY, HOURS, JOIN, PROMOT, UNIT/CALLSIGN, OOC, SHIFT); configured positions are only the fallback. Columns
can be reordered freely if labels stay — and optional columns (OOC NAME, SHIFT…) can be deleted outright.
Cached per sheet id; invalidated with config. **Entry-time data validation self-heals:** deleting/inserting a
column strands the old rules on whichever column slid into that position, so `installDataValidation_` first
scrubs any engine-owned rule (identified by its help text — operator rules are never touched) from columns it no
longer belongs to, then re-applies at the current header-resolved positions. Re-run 🚀 First-Run Setup after
layout surgery. The tracker, Patrol Log,
and Signups tabs each have their own header-resolved maps (`trackerCols_`, `patrolLogCols_`, `signupCols_` —
the latter auto-detects the header row, so a themed tab with a banner works).

**Layout ownership.** The operator lays out the sheets; the engine FILLS values and formulas — it never inserts
or deletes rows/columns on user sheets and never repaints their formatting. (The Police Academy and #group
division tabs are engine-built exceptions.) An existing STATUS dropdown is **never rebuilt**: Apps Script cannot
read per-value chip colours, so any `setDataValidation` on a live dropdown wipes them — the engine only creates
a dropdown where none exists and WARNs when an engine status is missing from the operator's list.

**Auto-rows** (`tidyTailRows_`, `[LIMITS].BLANK_TAIL_ROWS`, default **0**, -1 = OFF): the LOA Tracker, Patrol
Log, and Signup review tabs keep exactly N blank rows between the last entry and the tab's **closing row** — the
sanctioned exception to the no-row-surgery rule, scoped to these three tabs' data regions. At the default 0 the
data runs right up to the operator's end-bar with no gap, and **each arriving submission grows the sheet by
exactly one row**: `ensureRoomAboveCap_` inserts it *inside* the styled band before the write, so formatting,
STATUS dropdowns and chip colours inherit natively — the engine still paints nothing. It guards every append
path (patrol/signup form syncs) and both grow paths (the tracker and patrol sorts). Surplus blanks are deleted
in one contiguous run, so a legacy tab's thousand empty rows disappear on the first pass and nobody ever adds
rows by hand.

**The sheet's final row is the operator's closing row** (themed tabs end in a deliberate black end-bar): it is
never written, styled, deleted, or counted as a spare — inserts go *above* it. If a multi-row batch consumes it,
the next pass restores a final row. Runs at the end of each tab's sort (every mutation path finishes there); a
row is deleted only when every cell is display-blank, rows above the data start are never touched, and 🧪
sandbox tabs are exempt. New rows also get the last entry's **row height** set explicitly — height is a sheet
property that neither an insert nor a format paste carries, so without it a correctly-skinned row still sat
short.

`healUnstyledRows_` repairs rows that already hold data but were never dressed. Background is not a reliable
tell — a row inserted below the data inherits the fill of the row above, so it can look right while missing its
STATUS dropdown, borders, font size and number formats (reported on the LOA Tracker: a new leave landed with its
status as flat text and no chip). The **missing dropdown is the signal**: every real data row on these tabs has
one. Repair copies a good row's `PASTE_FORMAT` + `PASTE_DATA_VALIDATION` across — the only way chip colours move
at all — choosing a **same-parity** source so alternating banding survives, and setting row height explicitly
(no paste carries it; these tabs are fixed-height with long text clipping, so a fresh row left on auto towers
over its neighbours). With no dropdown anywhere the operator never made one, and the engine invents nothing.
It runs for all three tabs from `tidyTailRows_`, which now takes the tab's STATUS column.

`styleTailRows_` then makes the tail rows — the ones the next submission lands in — **look like the operator's
data rows**, and heals any row already holding data that still wears the blank/canvas skin (these tabs' empty
region was never styled, so the first submission to land there after the blanks were trimmed came out unbanded).
It copies from the **parity partner two rows up** (an alternating band keeps alternating) using
`PASTE_FORMAT` + `PASTE_DATA_VALIDATION` — fills, borders, number formats, wrap and the STATUS dropdown with
its chip colours all travel, values never do (a whole-row `PASTE_NORMAL` would duplicate the Patrol Log's col-A
credit marker — invariant 4). The engine still paints nothing of its own: it propagates the operator's look.
Row **height** is matched first and independently (no paste carries it); the look pass then costs one
backgrounds read per sort and returns immediately once the tail already matches. The closing row is excluded
from both passes.

**Editable assignment/group tabs (`buildGroupSheets_`).** A #group / assignment tab (Canine Unit, District
Patrol…) is an **editable upsert**, not a read-only FILTER: the engine keeps one row per matching member (matched
by Unique ID, else name), mirrors the roster's columns by header, places members into the tab's RANK GROUP bands
via the roster's own band ranges — and **preserves any column the tab has that the roster doesn't** (the
operator's own per-member fields, e.g. a K9 dog's name), never overwriting them. Members who leave the group are
removed; column B bands and the operator's data validations (their checkboxes/dropdowns) are untouched, and
columns carrying a real checkbox rule are written as **booleans** (never ☑/☐ text, which violates the rule). The
Police Academy uses a parallel builder with the same preservation, plus a GRADUATE LOG and rank-stem band
placement.

**Hinted rebuilds.** A single-cell member edit passes a hint (the member's row + the cell's old value) so only
the group tab(s) that member is or was in rebuild (~1–2 tabs instead of all); multi-cell pastes fall back to a
full rebuild. The deferred-work queue is cleared only **after** a rebuild completes — a throw or LIMITED-budget
timeout leaves the flag queued so the 1-minute sweep re-runs it.

**Unique IDs.** Discord IDs (17–19 digits) or Community IDs (1–8 digits) — switchable from the menu (🆔 Unique
ID Type). IDs are **text**: `'@'`-formatted before every write, `copyTo` on moves, never coerced to Number.

**Status engine.** `computeStatusCore_(rank, hours, engine)`: per-rank override ladder if one matches, else the
global tier ladder, then `[STATUS_RULES]` applied to a fixed point. `resolveStatus_` protects LEAVE/PROTECTED
statuses. Hour edits recompute via `onEdit`; batch recompute reports every change.

**Transfers.** `moveMemberColumns_` — MEMBER columns follow the person, SLOT columns stay, cross-section moves
clear opted-in section columns; columns move in contiguous runs (one `copyTo` + one clear per run) because the
sheet-edit path runs inside the ~30-second LIMITED onEdit budget that also hosts the confirm dialog. Both paths
share the core: pasting an existing ID into a new row (`checkForMemberMove`, confirm-gated) and the panel's
`cpMoveMember` (identity-guarded). A sheet-edit transfer stamps the publisher stand-down (`PUBLISH_BACKOFF`)
first thing — before the roster scan and the confirm dialog, giving an in-flight publish the longest head-start
to yield — and **clears it once the move and its derived rebuild settle**, so the settled result reaches the
public copy via the ~8s catch-up instead of waiting out the stamp + sweep. The derived rebuild runs lock-free
after the transfer's lock releases (transfers are serialized by their confirm dialog, so it can't stampede).
A move-up records a promotion (§3b).

**Dashboard & #tags.** `refreshDashboard_` computes stats once and writes plain values into label-matched KPI
boxes and `#members`-style tags. A Document Property (`RE_DASH_TABS`) remembers which tabs render dashboard
content so edit-driven refreshes touch only those; menu/nightly runs do full rescans. A `[DASHBOARD_GROUPS]`
entry that is **both** a SECTION_TAGS label and a real rank registers as both (rank wins per member) — so a
"Cadet" rank isn't swallowed by the tag-only branch and #training-style stats count correctly.

**PREVIOUS ACTIVITY (up to 3 columns).** These columns snapshot each member's status **as the period closed**:
📸 Capture & Reset writes them *before* zeroing hours and recomputing tiers (so they show what everyone earned
last period, not the post-reset drop). `[ROSTER_LAYOUT].LAST_ACTIVITY_COLS` names them **newest first**, up to
three — each entry is either a **column letter** (`AB, AC, AD`) or a **header name** (`LAST ACTIVITY, 2 Periods
Ago, …`), resolved by `lastActivityCols_` against the roster's configured header row; the first member row is
`DATA_START_ROW`, so neither is ever assumed. Blank keeps the classic behavior: one column auto-detected by its
"LAST ACTIVITY" header (`lastActivityCol_` still returns the newest, so older callers are unchanged).

Each capture **shifts the chain one period older** — the 3rd column takes what the 2nd held, the 2nd takes the
1st, and the 1st takes the closing ACTIVITY — reading every column before writing any, so nothing is lost.
Divider and empty-slot rows are left alone; an entry that resolves to no column is skipped with a WARN rather
than shifting the rest out of position, and a duplicate is dropped (it would copy a column onto itself). Every
capture stamps a NOTE on each header — the newest gets capture date + the cadence-aware period label ("Captured
1 Aug 2026 · closing the JUL HOURS period"), the older ones say which period they now hold. Each column gets the
ACTIVITY dropdown and `[ROSTER_LAYOUT].LAST_ACTIVITY_STYLE` colouring. Add a **LAST ACTIVITY DATE** column and
each capture also writes the date per member (the engine fills it only when the operator adds it — layout
ownership as usual).

**§3a · Period columns & their labels.** *(All ten activity options — checks, period columns, previous activity, the Activity Panel board — are edited together under Engine Settings ▸ **Activity & periods**; the keys themselves stay in their own config blocks.)*

**The roll.** `shiftArchiveColumns_` rolls every "… HOURS" column (all but the live
HOURS) one to the LEFT on each 📸 Capture & Reset — data *and* header — the oldest dropping off the visible set
and the rightmost receiving the hours just closed under `periodLabel_()`. **How many periods stay visible is
simply how many such columns the operator laid out.**

**Bucketing (`[SCHEDULE].PERIOD_BUCKET`, default `RESET`).** `RESET` = one column per activity check, the
classic behavior. **`MONTH`** decouples the check cadence from the archive grain: when the label the check
produces already matches the rightmost column's header, the check's hours are **added into that column and
nothing rolls** — so weekly checks of 5 hrs read 5 → 10 → 15 → 20 through July, and the columns roll only when
the month changes, opening a fresh AUG column while JUL keeps its 20. Only member rows accumulate (dividers and
empty slots keep whatever they hold), and hours still zero on every check either way — this changes how the
archive is *grouped*, not how the activity engine runs. Under `MONTH` with a weekly/bi-weekly cadence the column
is named for the month the check **runs in** (no previous-month grace: checks land ~4× a month, so the first of
a month legitimately opens it); a MONTHLY cadence keeps its "first 7 days label the month that ended" rule. `periodLabel_()` picks the date by cadence — MONTHLY names
the month that ended (dates in the first 7 days label the previous month), WEEKLY/BIWEEKLY name the
period-ending date — and formats it with `[SCHEDULE].PERIOD_LABEL_FORMAT`, a Java date pattern with quoted
literals (`'WEEK OF' d MMM`). Blank keeps the built-in shapes (`JUL HOURS` / `27 JUL HOURS`). The word **HOURS
is appended when a custom pattern omits it** — that word is how the roll finds these columns, so a label without
it would silently drop the column out of the rolling set on the next capture. An invalid pattern WARNs and falls
back rather than blocking the capture. Renames propagate to the public copy via `publishSyncPeriodHeaders_` (§9).

**§3b · Promotions feed.** `promoRecord_` stores recent promotions (Document Property `RE_PROMOS`);
`renderPromotions_` fills every "RECENT PROMOTIONS" table. The table-bearing tabs are remembered in
`RE_PROMO_TABS` (same convention as the dashboard memo) so the per-transfer render doesn't full-scan every tab;
🔄 Refresh & Update All rediscovers. Entries can be removed from Control Panel ▸ Tools ▸ Promotions feed
(`cpPromoList` / `cpPromoRemove` — matched by index+timestamp+name so a concurrent promotion can't shift the
wrong row out; removal repaints every table, marks the public copy dirty, and is audited).

**Derived tabs.** The Police Academy and #group division tabs rebuild from the roster: immediately on member
edits via `syncDerivedNow_` (simple-trigger safe, debounced 4s so bursts collapse to one rebuild), with the
deferred-work queue + 1-minute sweep as backstop.

---

## 4 · Leave Lifecycle (LOA/ROA)

1. **Intake** — the wizard-generated Google Form (questions from `[FORM_MAP]`) writes to the response tab.
2. **Sync** — `onFormSubmit` → `syncFormToTracker()`: response columns are resolved **by header**
   (`leaveFormCols_`: `[FORM_MAP]` keywords + built-in synonyms, UNIQUE/COMMUNITY ID count as the ID column;
   the classic fixed order 1–8 applies with a WARN when the required roles don't all resolve) — so a reordered
   or operator-made leave form still files fields correctly. Per-row validation (ID, known type, parseable
   dates), `KEY|id|timestamp` dedup keys (idempotent even if row colours are lost). **ID failsafe
   (`rosterMatchByFields_`):** a blank/malformed ID falls back to a corroborated roster match — NAME plus every
   other provided field (rank, callsign) must agree on exactly ONE member, whose ID is then used; ambiguity or
   a valid-but-unknown ID still errors (a typo is fixed, never guessed around). The roster is the source of truth
   for identity fields (one roster snapshot serves the whole batch). Accepted rows are seated with **one**
   tracker sort for the whole batch, landing new Pending leaves at the top. Errored rows go red and retry.
   Manual: 📥 Sync Leave Forms to Tracker.
3. **Approval** — tracker STATUS → approved. The `onEdit` transition applies an already-active leave
   immediately and fires the leave-approved notification.
4. **Daily job** — `processDailyLOAs` (nightly, script-locked): starts due leaves, ends leaves whose END date has
   passed (status recomputed from hours), posts the configured embeds. Ending is gated by `[LEAVE].AUTO_EXPIRE`
   — OFF and a leave only ever ends when an admin changes its status by hand, while due leaves still start. By
   default only `APPROVED_STATUS` rows are ended; `[LEAVE].EXPIRE_NEVER_APPROVED` extends that to rows still on
   the first STATUS_FLOW value (a request nobody acted on, whose dates have already gone by). Anything else — a
   Denied row, a custom terminal state — is left exactly as an admin set it.
5. **Coverage** — the "who's out now" board rebuilds on schedule and from the menu.

Entering a Unique ID on a tracker row auto-fills the member's identity from the roster (bulk pastes are batched:
one ID read + one roster snapshot for the whole span). The tracker re-groups by the STATUS column's **own
dropdown order** (`statusDropdownOrder_` reads the VALUE_IN_LIST rule, so an operator-customized flow groups the
way the dropdown says; `[LEAVE].STATUS_FLOW` is the fallback), **newest submission first** within each group —
recency is the millis embedded in the dedup KEY (the form's Timestamp; panel rows stamp creation time), START
date for key-less rows. The rewrite is stable and value-only — formatting, dropdowns, and banding never move —
and the menu syncs always leave the tab in canonical order even with nothing new to file. The panel's
`cpScheduleLeave` appends exactly like the form path.

---

## 5 · Patrol Hours (the Patrol Log tab)

Sessions live on the **Patrol Log tab** (`[SHEETS].PATROL_LOG`): identity + start/end date + time columns,
header-resolved. Each row is processed by `processPatrolLog_`: identity auto-fills from the roster, the
ISNUMBER-guarded TOTAL TIME formula computes hours — and a row with a blank/malformed ID gets the same
corroborated name+rank/unit failsafe as the leave sync (the resolved ID is written onto the row so crediting
stays ID-keyed; a valid-but-unknown ID still Flags).

**Five-state status model** (`[PATROL].STATUS_FLOW`): **PENDING** (engine processing / incomplete — no credit) ·
**FLAGGED** (a parameter failed — reason in NOTES, no credit) · **APPROVED** (admin-owned override — credits a
corrected/flagged log; the engine never reverts it) · **DENIED** (admin-owned rejection — reverses any credit,
engine leaves it alone) · **PROCESSED** (engine verified clean + credited). Credit states = PROCESSED + APPROVED;
the engine recomputes only the non-admin states, so an admin decision is never overwritten by a sweep.
`evaluatePatrolLog_` classifies problems — **blocking**
(unknown ID, non-positive or >24h span → Flagged, data must be fixed) vs **advisory** (over the configured max,
or ending in the future — Flagged until an admin Approves). "Future" respects
`[PATROL].FUTURE_GRACE_HOURS` (default 6, 0 = strict, max 48): a log flags only when it **ends** more than the
grace past now in sheet time — members abroad enter their *local* times on the form, so a UK member on a
US-East sheet runs ~5h "ahead" legitimately. Valid rows auto-mark Processed and credit.

**Transition embeds.** `patrolNotifyRow_` posts ONE Discord embed when a row transitions **into** Processed
(name, rank, callsign, hours, new total, start, end) or Flagged (identity + start/end + reason) — fired only on
the status change, so nightly sweeps and re-edits never re-post. A set PATROL webhook is the opt-in; the legacy
DURATION path routes through the same helper. Sandbox (🧪-prefixed) tabs never post.

**Crediting is reconciliation, not addition.** A hidden col-A marker `"hours|id|submissionMs"` records exactly
what was last credited (the third field — the form's submission time, stamped at transfer and preserved through
every credit/reverse — exists for sorting and is additive; legacy two-field markers still parse);
`reconcilePatrolCredit_` reverses the prior credit and applies the new one, so a member's HOURS always
equals the sum of their valid logs — idempotent across edits, flag/unflag, ID changes, and deletes. The marker
is written and flushed **before** the roster is touched: a crash under-credits (self-heals next pass), never
double-credits. **Never seed patrol rows without a matching marker.**

**Ordering.** `sortPatrolLog_` groups by the STATUS dropdown's own order (config flow fallback, same rule as the
tracker), **newest submission first** within each group — the marker's `submissionMs`, with the log's own start
date+time as the fallback for hand-typed rows. 🚔 Sync Patrol Forms backfills stamps onto already-transferred
rows (matched by Unique ID + exact start/end datetimes), self-terminating once every row is stamped. Any
STATUS-column edit re-sorts immediately.

The nightly `refreshPatrolLog_` sweep re-processes every row (maturing once-future logs) off **one block read**
of the whole log — cached row data and markers thread through processing, and per-row format churn is skipped
because the closing `sortPatrolLog_` re-applies formats and formulas batched. A legacy form-based intake
(`[SHEETS].PATROL_FORM_RESPONSES` + `[PATROL]` column keywords) still syncs submissions into the same crediting path.

**§5a · The Activity Panel.** An engine-built board tab (`[SHEETS].ACTIVITY`, default "Activity Panel", blank =
OFF; auto-created like the coverage board) showing **one row per patrol form submission** — SUBMITTED · NAME ·
UNIQUE ID · RANK · CALLSIGN · START · END · HOURS · STATUS · NOTES — under a **native filter row**, so admins
search and sort by any column (member, dates, patrol length, status…). Identity resolves exactly like the sync
(valid ID → the roster's current rank/callsign; invalid → the corroborated name+callsign failsafe); STATUS and
NOTES join **live from the Patrol Log**, primary key = Unique ID + the marker's **submission stamp**
(`hours|id|submissionMs` — survives credits, reversals, and admin-corrected dates, so fixing a member's typo'd
date never orphans the row), falling back to ID + exact start/end datetimes for unstamped rows, then to the
NAME breadcrumb + times for blank-ID landings (a Flagged "unknown member" row still shows its status and
reason); each log row is consumed once. **On a join hit the panel shows the log's own start/end/hours** — the
log is the source of truth after transfer, so an admin's correction reads back, not the typo'd submission.
Unmatched rows show Pending (not yet synced), "Not on log"
(transferred but since removed), or an error hint for red form rows; DURATION-mode forms list the submitted hours
with marker-derived status (no start/end to join on). Default order: newest submitted first — the filter re-sorts
any way. The tab is a **VIEW**: rebuilt immediately on every patrol sync, within a minute of Patrol Log edits and
sweep/nightly passes (deferred-queue key `activity`), and from 📊 Build / Refresh Activity Panel or 🔄 Refresh &
Update All — hand edits don't survive, and statuses are managed on the Patrol Log itself. Themed by
`styleFormResponses_` (the form-response console look; column widths stay the operator's), text columns
`'@'`-formatted, dates/hours typed so filter sorting is real. Rebuilds mark the publish-dirty flag, so a copy of
the tab on the public roster stays live.

---

## 6 · Roster Signups

A Google Form writes to its **own** plain tab (`[SHEETS].SIGNUP_FORM_RESPONSES`). `syncSignupForm_`
field-matches each submission by role (name / OOC / Unique ID / email / DOB / phone / join date) into the themed
**review tab** (`[SHEETS].SIGNUPS`), stamps STATUS **Pending**, marks synced form rows done so re-scans never
double-add, and re-groups by the STATUS dropdown's **own order** (built-in Pending → Approved → Processed flow
as the fallback), **newest submission first** within each group — the submission time is looked up *live* from
the signup form tab by Unique ID (latest wins on a re-submit; the review tab's TIMESTAMP column, then stable
order, are the fallbacks). A hand-edited STATUS re-sorts the tab immediately via `onEdit`. STATUS + NOTES are
admin-owned columns. Free rows are
found by *identity* (a stray STATUS value never counts as occupied), and a backfill computes them once for the
whole batch. Runs on `onFormSubmit` and 🧾 Sync Signup Form to Review. A newly-synced applicant can post the
opt-in signup-submitted embed (§10) — name + Unique ID only, PII never reaches Discord.

**Approval, two ways:**
- **Control Panel ▸ Signups** (the primary path): applicant chips, a read-only detail card, and a rank-grouped
  open-slot picker with live search (type a callsign or rank to filter) → `cpSignupApprove`. The approval is
  **identity-verified** — the panel sends the applicant's
  Unique ID and the server re-resolves the row under the lock (`signupResolveRow_`), because a form submission's
  re-sort can shift rows under an open panel. The RPC returns right after seat + re-sort (the audit's webhook
  posts after the lock releases); the panel then fires `cpSignupPostSeat` in the **background** — a hinted
  group-tab rebuild (only the tab(s) the member joined) plus Academy + dashboard — with the deferred queue as
  the sweep backstop, so "Seating…" resolves in seconds instead of spanning a full derived rebuild.
- **Sheet-driven:** setting a review row's STATUS to Approved fires the simple-trigger flow — a plain
  `ui.prompt` slot picker (AuthMode.LIMITED can never open an HTML dialog; permanent platform restriction),
  the same identity re-check after the prompt, and a reset to Pending on cancel or failure.

`approveSignup_` seats the member in the chosen open slot, copies their private details (email/DOB/phone) onto
their roster row, carries the join date, and stamps the signup **Processed** — last, so a failure leaves it
actionable. Both approval paths refresh the derived tabs (the member inherits the slot's rank + assignment, so
their group tab and the Academy must show them) **and** the welcome-page dashboard (seating changes the counts)
immediately, with the deferred queue as backstop.

---

## 7 · The Control Panel

`ControlPanel.html` + `RosterControlPanel.gs`, opened via 👥 Roster ▸ 🎛️. Modeless 1180×760 dialog, Studio
design system, deep-linkable (`openControlPanel('signups')` lands on a tab directly).

**Security architecture (D5):** the client calls exactly one server function — `dispatch(name, args)` — which
validates `name` against the frozen `DISPATCH_ENDPOINTS_` map (unknown → `E-506`). **36 endpoints**; the shim's
`RE_ENDPOINTS` list mirrors it one-for-one (adding an endpoint = one line in each — and a DevQA regression test
now round-trips the whitelist, so a forgotten registration fails the suite instead of erroring in production). Writes are **identity-keyed**: the
client sends each row's Unique ID so a shifted row can't hit the wrong member (`cpResolveMemberRow_` for
members, `signupResolveRow_` for signups).

**Tabs:** Members (search/filter/sort, bulk status — one batched read + one RangeList write per selection,
expandable profile cards with move/transfer, leave scheduling, hours trend, leave history) ·
Add member (rank-grouped slot dropdown + live preview) · **Signups** (§6) ·
Tools (one-click actions, webhook setup, the Promotions-feed manager — §3b) · Columns (SLOT/MEMBER toggles) ·
System (health checks, snapshots, audit timeline).

**Rank icons:** uploaded in Settings, stored chunked in Document Properties (`REICON:`) and lazy-loaded after
first paint. A member card's accent comes from the roster's own rank-cell background, so colouring those cells
on the sheet is what drives it.

**Testing pattern:** every mutating endpoint has an injectable `_`-core taking sheet objects, driven by DevQA
against sandbox tabs; the live wrapper adds lock/audit/notify.

---

## 8 · The Settings Studio

`SettingsPanel.html`, full-screen. Edits **every** config block: typed kv controls, generic table editors, live
search, per-section dirty dots. **Validate-before-write:** the prospective config runs the full validator; any
ERROR refuses the entire change set.

**Discord sections (per channel):** Audit log · LOAs · Patrol logs · Signups · Errors. Each owns its webhook
(write-only field), renders its channel's `[NOTIFICATIONS]` opt-in toggles, and holds its slice of the **embed
builder** — per-event templates stored as JSON rows in `[EMBEDS]`, edited against a Discord-accurate live
preview. The form inputs **pre-fill from the event's built-in default** when no override exists (so the actual
content is visible and tweakable); an untouched or reverted pre-fill never saves a redundant override
(`embIsDefault_`). Each channel header has **Reset ALL to defaults**: clears that channel's `[EMBEDS]` overrides
and factory-resets its stored `*_TITLE` keys (confirm first; nothing writes until Save). The sidebar dirty dot
is computed from **that channel's event rows only** (the `[EMBEDS]` table is shared, so a whole-table compare
would light every section). The "Public roster" card under Sheets & layout surfaces `[SHEETS].WELCOME` (a
sheet-name dropdown) and `[PUBLISH].FORCE_RANGES` beside KEEP_RANGES.

---

## 9 · The Public Roster (one-way publish)

Members read a separate spreadsheet that mirrors selected tabs from this workbook. Nothing flows back.

- **The public file's own tab list is the allow-list** — copy a tab across to publish it, delete it to stop.
  Blocked name patterns (Config, Webhooks, Disciplin…, Signup…, logs, snapshots, history) are never mirrored.
- **Mode is chosen by grid width** (`getMaxColumns()` — content-independent): same width → wholesale positional
  mirror (required for dashboards with fixed-cell boxes); narrower → header-matched columns only. The
  header-matched path publishes computed **VALUES**, not formulas — a formula's relative refs don't survive a
  column shift on the narrower public layout — and a mirrored column's internal value **wins over any public
  formula** (`mirrorWins`), which also heals stale formula residue left by older publishes.
- **Sensitive columns never leave the server.** `[PUBLISH].NEVER_PUBLISH` (default EMAIL / DOB / PHONE /
  ADDRESS) is blanked in the outgoing block **before** the write in both modes — the **Unique ID column
  publishes** by design (members find themselves by ID). Residue a manual tab copy brought along is scrubbed.
- **On the same-width path formulas are carried across** (`publishReadCells_`), number formats too. Destination
  formulas and
  `[PUBLISH].KEEP_RANGES` are never overwritten (built-ins protect the Welcome Page + roster title blocks even
  when a stored Config row overrides the schema default). `[PUBLISH].FORCE_RANGES` is the **inverse of KEEP**
  (built-in for three Welcome Page cells): those cells always mirror — a self-contained internal formula copies
  as-is (a `=NOW()` clock keeps ticking), a cross-sheet formula copies as its computed value so it can't break
  on the public file. Built-in keep/force ranges resolve against `[SHEETS].WELCOME`, and tab matching tolerates
  a leading emoji (`tabKey_` — exact match after the strip, never a substring, so "Roster" can't match "Roster
  Signups"). Self-computing tabs (cross-sheet ARRAY formulas) are
  left alone and their blocked spill residue is freed — only genuine spill anchors claim their block.
- **Row counts mirror too** (`publishFitRows_`): a public tab is grown so rows added here appear there, and
  trimmed so it ends as neatly. The old check only grew when the internal's *content* passed the public's whole
  *grid* — a public copy sitting on 1000 default rows never grew — and appended past the operator's closing bar.
  Growth now inserts **above the public tab's final row**, so new rows inherit that tab's own banding, formatting
  and row height, and its end-bar stays last. The target is **data + one closing row**: the public copy never
  receives submissions, so mirroring this workbook's spare row would just leave a stray blank there. Shrinking
  runs after the write, only when this tab is itself tight (`srcTail <= 3` — a tab that deliberately keeps a
  buffer, like the roster's validation rows or a dashboard's canvas, keeps that room publicly), only when
  everything from the target row down is empty (one `getLastRow` check, no block read), and never removes the
  final row.
- **Period-column labels stay in step** (`publishSyncPeriodHeaders_`, header-matched path only): 📸 Capture &
  Reset rolls the archive hours columns left here and **rewrites their headers** (`MAY HOURS` → `JUN HOURS`, the
  rightmost taking the period just closed — `shiftArchiveColumns_`). The header-matched publish never writes the
  public header row, so without this the two files drifted one month per capture: the public's oldest column
  stopped matching anything and froze, and the newest period had no column to publish into. The labels are now
  mirrored positionally before pairing, so name-matching realigns and every month lands. Conservative by design —
  it acts only when both tabs expose the **same number** of period columns (a public copy deliberately showing
  fewer months is left alone; shuffled labels would be worse than stale ones), the live HOURS column is excluded
  (its header never moves), and the count-mismatch warning is raised only on an explicit publish so the
  every-few-seconds background pass can't flood the SYS Log. Same-width wholesale mirrors need none of this —
  they copy the header row along with everything else.
- **Row heights are mirrored** (`publishMirrorHeights_`): height is a sheet property that no value write, format
  paste or row insert carries, so a published row could sit at the wrong height with the right skin. This
  workbook is the source of truth. Apps Script has no bulk height API, so cost is bounded by scope: an explicit
  publish (menu / setup) re-syncs every row of the block, while the frequent background catch-ups check only the
  last few rows — exactly where a new submission lands. Data rows only; the banner keeps its own sizing, and only
  rows that actually differ are written.
- **Published rows are styled** (`publishStyleableTab_` → `styleTailRows_`): a row landing where the public tab
  was never styled came out raw. The publish now propagates the **public tab's own** look onto it, exactly as the
  internal side does. Restricted to the banded data tabs (roster · LOA Tracker · Patrol Log), where every row is
  a peer of the one above it — dashboards are deliberately excluded, since a Welcome Page's rows are bespoke and
  copying a neighbour's format there would wreck the design.
- **All block writes are merge-safe** (`writeValuesSafe_` — plain `setValues` across merged cells throws), and
  in-cell images/chips (CellImage values, which `setValues` can never overwrite) are detected by
  `publishKeepMask_` and kept cleanly — an image always wins the mask, even over a FORCE range.
- **Liveness:** the installable `publishOnChange` (onEdit + onChange) publishes the edited tab within seconds
  (3s burst guard, ~8s trailing catch-up trigger); script writes mark a dirty flag carried by the 1-minute
  sweep. A partial (single-tab) publish never clears the global dirty flag — only a full pass does. After a
  form submission, `onFormSubmit` clears the publisher stand-down and schedules the ~8s catch-up once its syncs
  settle (a submission fires no onEdit, so nothing else would), and a settled member move does the same — a
  credited patrol log or a transfer reaches the public copy in ~8s, not backoff-expiry + sweep. Linkage checks
  read the stored property — never an `openById` round-trip per keystroke.
- **Chunked + preemptible:** `publishPublicRoster_` locks **per tab** (seconds each, released between tabs); a
  pass mutex (`PUBLISH_PASS_UNTIL`, 5-min stale-out) keeps two passes from interleaving now that no lock spans
  the pass. Background passes are **preemptible** — between tabs they check the interactive stand-down stamp
  (`PUBLISH_BACKOFF`), and if it's set (or a tab's lock is busy) the pass aborts, re-marks dirty, and the sweep
  finishes the leftover tabs within a minute. The menu/trigger publish chunks the same way but never yields —
  an explicit publish runs every tab.
- **Interactive writes outrank the publisher:** every interactive path — panel saves (`cpWithLock_`), transfers,
  Approve & seat, menu actions — stamps `PUBLISH_BACKOFF` *before* waiting on the lock, so
  no new publish pass starts against it and an in-flight pass yields at its next tab boundary. The dirty flag
  still queues the publish, so the public copy catches up right after via catch-up/sweep. The publisher also
  steps aside for member transfers at the trigger level (Unique-ID-column edits defer; EDIT/OTHER/FORMAT
  onChange firings skip) so a publish and a roster mutation never race for the script lock.

---

## 10 · Discord Integration

- **Webhooks per channel** (AUDIT / LOA / PATROL / SIGNUP / ERRORS — `WEBHOOK_CHANNELS_` is the single source),
  stored in this workbook's Webhooks tab — Google
  sharing gates them. One webhook URL can serve **many** channels (`cpSetWebhookChannels`); per-channel test
  posts. SIGNUP falls back to AUDIT until its own webhook is saved, so existing setups keep posting unchanged.
  URLs are **write-only secrets**: set from the panel/Settings, never echoed back to any page, never
  logged or audited.
- **Embeds:** built-in defaults per event, overridable per-field in the Settings embed builder (`[EMBEDS]`),
  shared chrome (author/thumbnail/image/footer, http(s)-only), `{token}` substitution. **House style** on every
  embed, builder-premade or server-fallback: field labels lead with a code-boxed emoji (`` `👮` `` Name,
  `` `▶️` `` Start Date…), the big title renders as a `# ` markdown heading inside the *description* (native
  embed titles can't box emoji — the configurable `*_TITLE` strings supply the heading text), lifecycle-sentence
  descriptions, ❌-led list lines for flagged/integrity summaries. `notify_` never throws and posts after locks
  release.
- **Events:** leave lifecycle, per-row patrol Processed/Flagged transition embeds (rank, callsign, start/end —
  §5) + flag summaries, signup submitted (`[NOTIFICATIONS].SIGNUP_SUBMITTED` — name + Unique ID only, no PII),
  audit entries, coded errors (throttled
  1/code/5min), plus the `[NOTIFICATIONS]` opt-ins (member added, transfer, weekly digest…).

---

## 11 · Trust & Safety

- **Audit (always-on):** the installable `auditEdit` trigger logs who/what/when to the Edit Log; panel and menu
  actions log semantically via `auditEvent_`. **Editor identity resolves to a member name:** `auditWho_(email)`
  matches the editing account's email against the roster's private EMAIL column — a match shows the member's
  NAME everywhere (Edit Log, Discord audit embeds, webhook set-by stamps); no match
  keeps the raw email. Memoized to one roster read per execution. Installable onEdit triggers are per-user —
  every admin who opens the panel installs their own `auditEdit`, and ALL of them fire on each edit — so a
  trigger that can't identify the editor (blank cross-account email) bails: the editor's own trigger logs it by
  name, and the blank pass would be a pure "unknown" duplicate. `cpEnsureAuditTrigger` keeps exactly one audit
  trigger per account.
- **Snapshots:** hidden `_Snapshots` tab, keeps the last `SNAPSHOT_KEEP`; restore is identity-mapped (a row
  shift since the snapshot can't drop data on the wrong member) with an ID-precision guard; pruning deletes
  contiguous runs. Optional weekly auto-snapshot.
- **Integrity scan:** duplicate/malformed IDs, status-vs-hours mismatches, orphaned leaves, and assignment
  typos — a group-column value matching no group tab but within 2 edits of a declared value (bounded
  Levenshtein, near-miss only so tab-less assignments never false-positive, capped at 10/scan) names the
  member, the typo, and the tab they're missing from. Logged + posted.
- **Health check:** config validity first, then structure/triggers/webhooks; drives the panel health pill.
  Every roster read in it is header-resolved (member count included), and the leave-form check asks
  `leaveFormCols_` whether the headers resolve rather than testing fixed column positions — a reordered form or
  roster is supported by the engine, so it must not fail its own health check.
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
8. The engine fills user sheets — it never restructures or reformats their layout. (Sole carve-out: auto-rows
   manages the data-region row COUNT on the three tracker-style tabs — §3 — inserting inside the styled band
   and trimming trailing blanks; `[LIMITS].BLANK_TAIL_ROWS = 0` turns it off.)
9. DevQA touches 🧪-prefixed sandbox tabs only.

---

## 12 · Menus & Triggers

**👥 Roster:** 🎛️ Open Control Panel · ⚙️ Engine Settings │ 🔄 Refresh & Update All · 📥 Sync Leave Forms to
Tracker · 🧾 Sync Signup Form to Review · 🚔 Sync Patrol Forms to Log (START_END submissions transfer onto the
Patrol Log — marker-deduped on the form — and credit through the log's own path; DURATION mode or no log tab →
the classic direct credit) · 🧾 Review Roster Signups (deep-links Control Panel ▸ Signups) · 📸 Capture & Reset
Activity · 🔍 Run Integrity Scan · 🌐 Publish
Public Roster │ ➕ Add Member Rows… · 🎙️ Fix All Callsign Numbers · 🗂️ Build / Refresh Group Sheets · 🎓 Build /
Refresh Police Academy · 📊 Build / Refresh Activity Panel │ 🌐 Set Up Public Roster · 🆔 Unique ID Type ▸
(Discord / Community) · 🧩 Sync Column
Config · 🚀 First-Run Setup · 🔌 Install Triggers.

**🧪 Dev / QA:** 🎬 Load Demo Roster · 🎲/🚔/🧾 Add Random LOA / Patrol Log / Signup │ ▶️ Run Tests Part 1
(1–8) / Part 2 (9–16) / Part 3 (17–23) · ⏱️ Run ALL Tests · 🔬 Run one section (1–23) · 🧹 Delete Sandbox /
Results Tabs.

Every action reports what it actually did (counts, names, changes).

**Triggers:** simple — `onOpen` (menus), `onEdit` (status recompute, transfer detect, tracker/patrol/signup row
handling, approval hooks, derived-tab rebuilds, dashboard refresh). Installable (🔌 Install Triggers) —
`onFormSubmit` (leave + patrol + signup syncs — routed by the submitted form's response tab via `e.range`, so a
patrol submission runs only the patrol sync; no identifiable range → all three, correctness over speed;
afterwards it clears the publish stand-down and schedules the ~8s catch-up), `processDailyLOAs` (nightly),
`auditEdit`, `publishOnChange`
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
- **Interactive-first locking** — every interactive writer stamps the publisher stand-down before waiting; the
  publisher locks per tab and yields to the stamp between tabs (§9), so panel saves never wait out a whole
  multi-tab publish pass.
- **Hinted derived rebuilds** — a single-cell member edit rebuilds only the group tab(s) that member is or was
  in; signup seating defers its rebuild to the background `cpSignupPostSeat`; `onFormSubmit` runs only the
  submitted form's sync.
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

**A test run never touches production surfaces:** the part/section runners set the `DEV_WEBHOOKS_OFF_`
execution flag, checked at the three choke points — `sendWebhookPayload_` (every channel embed), `auditEvent_`
(Edit Log + audit mirror), and `maybeErrorWebhook_` — so sandbox activity posts no Discord embeds and writes no
live Edit Log rows. The flag resets per execution; live behavior outside a test run is untouched (patrol
transition embeds are additionally sandbox-tab-gated).

Sandbox limits to remember: plain grids — no merges, no formatting, no timezone quirks. Passing tests prove
logic, not layout behavior; the live smoke test (one signup, one leave, one patrol log, one transfer, one
publish) is part of every release.

**Local static validation** (no Apps Script needed): Node `new Function(src)` syntax check + zero-control-byte
scan per file; HTML script blocks are extracted, GAS scriptlets stubbed, and `node --check`ed the same way.
**`tools/cfgcheck.js` goes further — it EXECUTES the config pipeline** (`node tools/cfgcheck.js RosterConfig.gs`):
GAS services stubbed, then **65 real assertions** over `parseBlocks_` / `validateConfig_` / `materialize_` —
empty-config = zero ERRORs, legacy bridge values, `aka` alias precedence (same-block and cross-block),
list/enum/int coercion, schema self-consistency, `BLOCK_ORDER_` ↔ `BLOCK_SPECS_` parity, nothing both retired and
live, block boundaries surviving a hand-deleted separator row, every `[SHEETS]` role colliding loudly,
status-name membership, the silent-failure guards (list overflow, unreadable colour), and that the two leave
ending switches reach a real consumer. Run it after any config-layer change.
(`tools/**` is clasp-ignored — it must never reach the Apps Script project.)

---

## 15 · Maintenance

**Release recipe:** bump `ENGINE_VERSION` (+ `CP_VERSION`) → syntax-check every file → commit → `clasp push -f`
→ run all three QA parts → live smoke test. After schema-affecting changes: run 🚀 First-Run Setup once
(idempotent).

**Sync rules:** `clasp push -f` syncs every engine file (`.claspignore` keeps `TEMPLATE-SHIM.gs` out — it ships
only inside community templates). Library users re-paste `TEMPLATE-SHIM.gs` whenever the endpoint list changes.

**Time zone:** `appsscript.json` pins the script to `America/New_York` — engine-written dates (join dates, LOA
dates, log stamps) format Eastern. The spreadsheet's own File ▸ Settings time zone is separate and drives the
in-sheet `NOW()`/`TODAY()` clock — keep it matched.

**Keep-current rule:** when code changes, update the matching section here in the same commit. Companion docs
(staff guide, feature pitch, menu reference) live outside this folder and predate 1.0 — this file is the
authoritative system reference.
