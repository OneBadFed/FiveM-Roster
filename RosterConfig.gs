/**
 * ============================================================================
 * ROSTER ENGINE v2 — CONFIG LAYER, ERROR REGISTRY & SYS LOG  (Phase 1)
 * ============================================================================
 * New in Phase 1 (per ROSTER-ENGINE-V2-BRIEF.md). This file adds the schema-
 * driven configuration layer OVER the existing, working subsystems:
 *
 *   • ⚙️ Config tab — INI-style blocks, seeded with defaults that EXACTLY
 *     reproduce today's behavior ("unchanged on defaults" is the Phase 1 gate).
 *   • cfg_() — parse → validate (collect ALL problems) → memoize. Exposes a
 *     `.legacy` view shaped exactly like the old CONFIG object; RosterSystem.gs
 *     bridges the global CONFIG identifier to it, so all ~450 existing
 *     CONFIG.* reads flow through this layer with zero call-site churn.
 *   • norm_() — whitespace-collapsing, case-folding name/header matching
 *     (kills the "Form  Response" double-space bug class forever).
 *   • Coded error framework — AppError + REGISTRY_ + raise_ + guarded_.
 *     No silent failures: every abnormal condition has a code, a message with
 *     the real offending values, and a fix hint.
 *   • SYS Log — hidden engine-diagnostics sheet (ring buffer). SEPARATE from
 *     the user-facing "Edit Log" audit trail (two-log model, brief Part B).
 *   • theme_() — every engine-painted surface reads [THEME]; defaults equal
 *     the verified live palette.
 *   • Status ladders — [STATUSES] global tiers + [STATUS_OVERRIDES] per-rank
 *     ladders (the Auxiliary Trooper rule, now data instead of code).
 *
 * ENGINE CONSTANTS (the only hardcoded names, per brief Part 2 / A6):
 * the Config tab name + marker, and the SYS Log sheet name.
 * ============================================================================
 */

const CONFIG_SHEET_NAME = '⚙️ Config';
const CONFIG_MARKER = 'RE_CONFIG';   // written to A1 of the Config tab; rescue-scan target if the tab is renamed
const SYS_LOG_SHEET = 'SYS Log';
const ENGINE_SCHEMA = 2;             // v1.0: added [STATUS_RULES], [RANKS], [SHEETS] system-tab names, [SCHEDULE] cadence
const ENGINE_VERSION = 'v1.0.0';     // release tag — the 1.0 full release
const ERRORS_WEBHOOK_PROP = 'WEBHOOK_ERRORS'; // optional second Discord channel for engine errors (Phase 3, resolved G2)
const LAST_RESET_PROP = 'RE_LAST_HOURS_RESET_MS'; // v1.0: last hours-reset timestamp (ms) — gates BIWEEKLY/MONTHLY cadence
// Docs-site base for error-code anchors, e.g. 'https://yourdomain.com/roster-engine/errors'.
// Empty = no docs links shown. Set once the docs pages are deployed (see ROSTER-ENGINE-V2-RUNBOOK.md).
const DOCS_URL = '';

/** Engine-wide name/header normalizer: trim, collapse internal whitespace, uppercase. */
function norm_(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toUpperCase();
}

/* ======================================================================
 * ERROR REGISTRY — code = condition, severity = default handling.
 * Messages are templates; {param} slots get the real offending values.
 * ====================================================================== */

const REGISTRY_ = Object.freeze({
  'E-101': { sev: 'ERROR', msg: 'Config tab not found (searched name "{name}" and the {marker} marker).', hint: 'Run 🚀 First-Run Setup to recreate it.' },
  'E-102': { sev: 'ERROR', msg: 'Config invalid — {n} problem(s): {list}', hint: 'Fix the listed keys on the ⚙️ Config tab, then retry.' },
  'E-103': { sev: 'ERROR', msg: '{key} = "{value}" is not a valid {type}.', hint: 'Expected: {expected}' },
  'E-104': { sev: 'ERROR', msg: 'Config schema v{sheet} is newer than engine v{engine}.', hint: 'Update the engine code, then retry.' },
  'E-110': { sev: 'ERROR', msg: 'Status tiers invalid: {reason}', hint: 'Exactly one TIER must have Min hours 0; thresholds must be unique.' },
  'E-201': { sev: 'ERROR', msg: 'Tab "{name}" not found (role: {role}).', hint: 'Check [SHEETS] on ⚙️ Config — closest live tab: "{closest}".' },
  'E-202': { sev: 'ERROR', msg: 'Required column role {role} (match "{match}") not found in the roster header row.', hint: 'Check [COLUMNS] on ⚙️ Config and the roster header row.' },
  'E-205': { sev: 'ERROR', msg: 'Engine attempted to write role-less column "{header}".', hint: 'Every engine-written column needs an explicit [COLUMNS] role. This is an engine bug — report it.' },
  'E-301': { sev: 'WARN', msg: 'Row {row}: "{value}" is not a pingable Discord ID.', hint: 'Discord @mention pings need a 17-19 digit snowflake; pings are skipped for this member (identity still works with the configured ID length).' },
  'E-501': { sev: 'INFO', msg: 'Another run holds the lock; this one exited.', hint: 'Normal under concurrency — retry shortly.' },
  'E-506': { sev: 'ERROR', msg: 'Unknown panel endpoint "{name}".', hint: 'Only whitelisted endpoints may be dispatched (brief D5 — enforced in Phase 2).' },
  'E-601': { sev: 'ERROR', msg: 'Unexpected error in {fn}: {msg}', hint: 'Open the SYS Log tab (or script editor → Executions) for the stack.' },
});

/** Render a registry template with real values. Unknown params render as "?" so a bad call still surfaces. */
function renderMsg_(code, params) {
  const entry = REGISTRY_[code];
  const tpl = entry ? entry.msg : `Unregistered error code ${code}.`;
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : '?'));
}
function renderHint_(code, params) {
  const entry = REGISTRY_[code];
  if (!entry || !entry.hint) return '';
  return entry.hint.replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : '?'));
}

/** Coded application error. `params` fill the message template; `ctx` is extra JSON for the SYS Log. */
class AppError extends Error {
  constructor(code, params, ctx) {
    super(renderMsg_(code, params || {}));
    this.name = 'AppError';
    this.code = code;
    this.params = params || {};
    this.ctx = ctx || {};
    this.sev = (REGISTRY_[code] || {}).sev || 'ERROR';
    this.hint = renderHint_(code, params || {});
  }
}
function raise_(code, params, ctx) { throw new AppError(code, params, ctx); }

/** Wrap a non-AppError into E-601 so every failure leaves a coded trail. */
function wrapUnexpected_(fnName, e) {
  const ae = new AppError('E-601', { fn: fnName, msg: (e && e.message) ? e.message : String(e) }, { stack: e && e.stack ? String(e.stack) : '' });
  return ae;
}

/** Docs-site anchor for a code (brief B1: every code gets an anchor). Empty string when DOCS_URL isn't set. */
function docsLink_(code) {
  return DOCS_URL ? `\nDocs: ${DOCS_URL}#${String(code).toLowerCase()}` : '';
}

/** The optional errors-channel webhook — the ERRORS row of the admin file's Webhooks tab. Empty = feature off. */
function getErrorsWebhookUrl_() {
  try { return webhookFor_('ERRORS'); } catch (e) { return ''; }
}

/**
 * Best-effort ERROR notification to the optional errors channel (Phase 3, resolved G2). Contract mirrors slog_:
 * this can NEVER be the thing that crashes a run. Property unset = silent no-op (presence IS the opt-in).
 * Throttled to one post per code per 5 minutes via CacheService, so an error storm (e.g. a broken config tab
 * failing on every edit) posts once, not hundreds of times. Reads the CFG_ memo, never cfg_() (error paths run
 * exactly when config may be broken).
 */
function maybeErrorWebhook_(ae, fnName) {
  try {
    if (!ae || ae.sev !== 'ERROR') return;
    const key = 'errwh:' + (ae.code || 'E-601') + ':' + (fnName || ''); // F-045: throttle per code AND function, not code alone
    const cache = CacheService.getScriptCache();
    if (cache.get(key)) return; // throttle FIRST — the URL now lives in the admin file, so don't open it during a storm
    const url = getErrorsWebhookUrl_();
    if (!url) return;
    cache.put(key, '1', 300);
    const sysName = (CFG_ && CFG_.legacy) ? CFG_.legacy.systemName : 'Roster System';
    let desc = String(ae.message || '');
    if (ae.hint) desc += `\n\n**Fix:** ${ae.hint}`;
    desc = desc.slice(0, 1500) + '\n\n_See SYS Log for the complete record._'; // F-044: one safe bound on the whole description + pointer
    const fallbackEmbed = {
      title: `⚠️ ${ae.code} — ${fnName || 'engine'}`,
      description: desc,
      color: 14702415, // #e0574f — semantic red
      footer: { text: `${sysName} • ${ENGINE_VERSION}` },
    };
    // Template override, memo-safe: embedFromTemplate_ reads CONFIG (may be broken on an error path) inside its
    // own try/catch and falls back to the built-in embed — an error notification is never lost to a bad template.
    const eVars = { code: ae.code || 'E-601', message: String(ae.message || ''), hint: String(ae.hint || ''), 'function': fnName || 'engine' };
    let tpl = null; try { tpl = CFG_ && CFG_.legacy && CFG_.legacy.embedTpl && CFG_.legacy.embedTpl.error; } catch (e) { tpl = null; } // memo only — never force a config load on an error path
    const embed = (typeof embedFromTemplate_ === 'function') ? embedFromTemplate_('error', eVars, fallbackEmbed) : fallbackEmbed;
    const body = { username: `${sysName} — errors` };
    if (tpl && tpl.content) { try { body.content = String(fill_(String(tpl.content), eVars)).slice(0, 2000); } catch (e) { /* ignore */ } }
    if (!tpl || tpl.sendEmbed !== false) body.embeds = [embed];
    if (!body.content && !body.embeds) body.embeds = [fallbackEmbed]; // never post an empty message
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true, // a webhook failure must not throw into the caller's error path
      payload: JSON.stringify(body),
    });
    // F-044: surface an otherwise-muted delivery failure (never throw — mirrors the "never fatal" contract). slog_ reads CFG_.
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) slog_('WARN', 'E-501', 'maybeErrorWebhook_', `errors-webhook post returned HTTP ${code}`, { code });
  } catch (e) {
    try { console.error(`maybeErrorWebhook_ failed (never fatal): ${e && e.message}`); } catch (e2) { /* nothing left */ }
  }
}

/**
 * Entry-point guard: run fn; on failure log a coded SYS Log entry and (when a UI
 * exists) show code + message + fix hint. Returns fn's result, or undefined on error.
 * runAction_ (RosterSystem.gs) builds on this and adds the menu-audit side-effect.
 */
function guarded_(fnName, fn) {
  try {
    return fn();
  } catch (e) {
    const ae = (e instanceof AppError) ? e : wrapUnexpected_(fnName, e);
    slog_(ae.sev, ae.code, fnName, ae.message, ae.ctx);
    maybeErrorWebhook_(ae, fnName); // Phase 3: optional errors channel (silent no-op unless WEBHOOK_ERRORS is set)
    try {
      SpreadsheetApp.getUi().alert(
        `⚠️ ${ae.code} — "${fnName}" stopped`,
        `${ae.message}${ae.hint ? `\n\nFix: ${ae.hint}` : ''}${docsLink_(ae.code)}\n\n(Logged to the hidden "${SYS_LOG_SHEET}" tab.)`,
        SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (uiErr) { /* no UI (trigger context) — the SYS Log entry is the record */ }
    return undefined;
  }
}

/* ======================================================================
 * SYS LOG — hidden engine-diagnostics sheet. Failure-proof by contract:
 * the logger can never be the thing that crashes a run (falls back to
 * console). Ring buffer capped by [LOGGING].LOG_MAX_ROWS.
 * NOTE: deliberately independent of cfg_() success — config failures are
 * exactly what this log must record.
 * ====================================================================== */

const EXEC_ID_ = Math.random().toString(36).slice(2, 8); // groups all lines from one execution
const LOG_ORDER_ = Object.freeze({ ERROR: 3, WARN: 2, INFO: 1, DEBUG: 0 });
let _sysLogSheet = null;
let _sysLogUnavailable_ = false; // set once if the sheet can't be created this execution (e.g. LIMITED-auth simple trigger) — don't retry every call

/** Create + hide the SYS Log sheet (full-auth contexts). Called by First-Run Setup so slog_ never has to insertSheet in a LIMITED trigger (F-016). */
function ensureSysLog_(ss) {
  const s = ss || SpreadsheetApp.getActive();
  let sheet = s.getSheetByName(SYS_LOG_SHEET);
  if (sheet) return sheet;
  sheet = s.insertSheet(SYS_LOG_SHEET);
  sheet.hideSheet();
  sheet.getRange(1, 1, 1, 8)
    .setValues([['Timestamp', 'Ver', 'Sev', 'Code', 'Function', 'Message', 'Context', 'Exec']])
    .setBackground(theme_('BANNER')).setFontColor(theme_('TEXT_STRONG')).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, sheet.getMaxRows(), 8).setNumberFormat('@'); // text-safety rule (brief Part D)
  return sheet;
}

function slog_(sev, code, fn, message, ctx) {
  try {
    // Read the MEMO (CFG_) directly, never cfg_(): cfg_ logs its own WARN problems mid-load, so calling
    // cfg_() from here would recurse infinitely. Before the memo exists we simply use the defaults.
    let maxRows = 500, minLevel = 'INFO';
    if (CFG_) { maxRows = CFG_.logging.maxRows; minLevel = CFG_.logging.level; }
    if ((LOG_ORDER_[sev] || 1) < (LOG_ORDER_[minLevel] || 1)) return;
    const ss = SpreadsheetApp.getActive();
    if (!_sysLogSheet || _sysLogSheet.getParent().getId() !== ss.getId()) {
      _sysLogSheet = ss.getSheetByName(SYS_LOG_SHEET);
      if (!_sysLogSheet) {
        // F-016: don't retry insertSheet on every call once it has failed this execution (LIMITED-auth triggers can't
        // create sheets) — always preserve the ORIGINAL message + a breadcrumb to run First-Run Setup with full auth.
        if (_sysLogUnavailable_) { try { console.error(`[slog_ no-sheet] ${sev} ${code} ${fn}: ${message}`); } catch (ig) {} return; }
        try {
          _sysLogSheet = ensureSysLog_(ss);
        } catch (ce) {
          _sysLogUnavailable_ = true;
          try { console.error(`[slog_ no-sheet] ${sev} ${code} ${fn}: ${message} :: "${SYS_LOG_SHEET}" missing and could not be created (run 📋 Roster ▸ First-Run Setup with full authorization): ${ce && ce.message}`); } catch (ig) {}
          return;
        }
      }
    }
    const ctxJson = ctx ? JSON.stringify(ctx).slice(0, 900) : '';
    _sysLogSheet.appendRow([new Date(), ENGINE_VERSION, sev, code || '', fn || '', String(message || '').slice(0, 900), ctxJson, EXEC_ID_]);
    const last = _sysLogSheet.getLastRow();
    if (last > maxRows + 25) _sysLogSheet.deleteRows(2, last - maxRows - 1); // trim oldest, keep header
  } catch (e) {
    try { console.error(`[slog_ fallback] ${sev} ${code} ${fn}: ${message} :: logger failed: ${e && e.message}`); } catch (e2) { /* nothing left to do */ }
  }
}

/* ======================================================================
 * THEME — every engine-painted surface reads [THEME]. Defaults equal the
 * verified live palette (brief Part A3 / Part D). theme_() must NEVER
 * throw: a broken config still gets correctly-painted error surfaces.
 * ====================================================================== */

const THEME_DEFAULTS = Object.freeze({
  CANVAS: '#1c1c1c', BANNER: '#1f2933', GRID: '#2a2f37', ACCENT: '#3f86e6',
  TEXT: '#eceef2', TEXT_STRONG: '#ffffff', SUBHEAD: '#222831', SUBHEAD_TEXT: '#aeb6c0',
  PASS: '#1e6b3a', FAIL: '#7a1f2b', INFO: '#236995', PROCESSING: '#6b531f',
});

function theme_(key) {
  // Same re-entrancy rule as slog_: read the memo, never cfg_() (slog_ paints its header via theme_
  // and can run mid-config-load). Unloaded/broken config → verified live defaults.
  if (CFG_ && CFG_.theme && CFG_.theme[key]) return CFG_.theme[key];
  return THEME_DEFAULTS[key] || '#000000';
}

/* ======================================================================
 * BLOCK SPECS — the single source of truth for the ⚙️ Config tab.
 * One spec drives seeding, parsing, AND validation, so they can't drift.
 * kv blocks:    { type:'kv', keys: { KEY: {t, d, req, enum?, min?, max?, help} } }
 * table blocks: { type:'table', cols:[...], seed:[[...]], help }
 * Defaults (d / seed) EXACTLY reproduce today's live behavior.
 * ====================================================================== */

const BLOCK_SPECS_ = Object.freeze({
  SYSTEM: { type: 'kv', keys: {
    SCHEMA_VERSION: { t: 'int', d: ENGINE_SCHEMA, req: true, min: 1, max: 999, help: 'Engine-managed. Do not edit.' },
    SYSTEM_NAME: { t: 'string', d: 'Roster System', req: true, help: 'Shown in Discord embed footers.' },
    DEV_MODE: { t: 'bool', d: true, req: true, help: 'Phase 1: informational (Dev/QA menu still appears when RosterDevQA.gs is pasted).' },
    MAINTENANCE_MODE: { t: 'bool', d: false, req: true, help: 'Phase 1: validated only; write-refusal ships in Phase 2.' },
  } },
  SHEETS: { type: 'kv', keys: {
    ROSTER: { t: 'string', d: 'Member Information', req: true, help: 'The roster tab name.' },
    TRACKER: { t: 'string', d: 'LOA/ROA Tracker', req: true, help: 'The leave-tracker tab name.' },
    FORM_RESPONSES: { t: 'string', d: 'LOA/ROA Form Response', req: true, help: 'The Google Form responses tab name.' },
    // v1.0 — the system/log tab names are now editable too (every role must resolve to a DISTINCT tab).
    // NOTE: "SYS Log" (engine diagnostics) is intentionally NOT here — slog_/theme_ must resolve it without cfg_() (re-entrancy).
    AUDIT: { t: 'string', d: 'Edit Log', req: false, help: 'The who/what/when audit-log tab. Blank = "Edit Log".' },
    HOURS_HISTORY: { t: 'string', d: '_Hours History', req: false, help: 'Hidden weekly-hours history tab. Blank = "_Hours History".' },
    COVERAGE: { t: 'string', d: 'Leave Coverage', req: false, help: 'Leave-coverage view tab. Blank = "Leave Coverage".' },
    INTEGRITY: { t: 'string', d: 'Integrity Log', req: false, help: 'Integrity-scan log tab. Blank = "Integrity Log".' },
    SNAPSHOTS: { t: 'string', d: '_Snapshots', req: false, help: 'Hidden snapshot/restore tab. Blank = "_Snapshots".' },
    PATROL_RESPONSES: { t: 'string', d: '', req: false, help: 'Patrol-log Google Form responses tab name. BLANK = patrol-hours sync OFF. Point this at the tab your own linked patrol form writes to; each new submission credits its patrol time to the matching member.' },
    PATROL_LOG: { t: 'string', d: 'Patrol Log', req: false, help: 'Manual Patrol Log tracker tab (like the LOA Tracker). Enter Unique ID + start/end date + start/end time; the engine auto-fills member info, computes TOTAL TIME, credits the hours to the roster, and sorts Pending → Flagged → Processed. BLANK = OFF. Activates only if a tab with this name exists.' },
    SIGNUPS: { t: 'string', d: 'Roster Signups', req: false, help: 'Roster Signup REVIEW tab (like the LOA Tracker): the engine adds field-matched form submissions here (from SIGNUP_FORM_RESPONSES) for admins to review — STATUS + NOTES are admin-owned. Lay it out with a header row (NAME / OOC NAME / UNIQUE ID / DOB / EMAIL / STATUS / NOTES…) anywhere in the top rows. Approving adds the member to a slot and writes their private details to the Internal Roster.' },
    SIGNUP_FORM_RESPONSES: { t: 'string', d: '', req: false, help: 'The Google Form\'s OWN responses tab for roster signups (Forms own row 1, so it is separate from the themed Signups tab). BLANK = signup sync OFF. Point this at the tab your signup form writes to; each submission is matched by header name and added to the SIGNUPS review tab. Name the form questions to match: Name, OOC Name, Unique ID, DOB (or Date of Birth), Email.' },
  } },
  ROSTER_LAYOUT: { type: 'kv', keys: {
    HEADER_ROW: { t: 'int', d: 5, req: true, min: 1, max: 50, help: 'Row holding the roster column labels.' },
    DATA_START_ROW: { t: 'int', d: 7, req: true, min: 2, max: 100, help: 'First possible member row (must be > HEADER_ROW).' },
    TRACKER_START_ROW: { t: 'int', d: 8, req: true, min: 2, max: 100, help: 'First data row on the tracker (row 8: banner row 5, label row 6, divider row 7, data from row 8).' },
    PATROL_START_ROW: { t: 'int', d: 8, req: true, min: 2, max: 100, help: 'First data row on the Patrol Log tab (same layout as the tracker: banner, label row 6, divider row 7, data from row 8).' },
    DIVIDER_MODE: { t: 'enum', d: 'ALLCAPS_RANK', req: true, enum: ['ALLCAPS_RANK', 'EXPLICIT_LIST'], help: 'How ranks/section-dividers are detected. ALLCAPS_RANK = the all-caps heuristic (default). EXPLICIT_LIST = consult the [RANKS] table, falling back to the heuristic for anything unlisted.' },
    TRAINING_KEYWORDS: { t: 'list', d: 'TRAINING, CADET', req: true, help: 'Divider labels containing these words are TRAINING sections.' },
    UNIT_FORMAT: { t: 'string', d: 'S-{00}', req: true, help: 'Callsign/unit-number template. The {0…} token is the slot number zero-padded to that many digits — "S-{00}" → S-01, "TRP-{000}" → TRP-001. Text outside the token is literal (prefix/suffix). No token → the number is appended.' },
    LAST_ACTIVITY_STYLE: { t: 'enum', d: 'MATCH', req: false, enum: ['MATCH', 'NEUTRAL'], help: 'How the LAST ACTIVITY column is coloured. MATCH = mirror CURRENT ACTIVITY\'s status colours (default). NEUTRAL = a calm grey chip so only CURRENT ACTIVITY is colour-coded. Applied by 📸 Capture Last Activity.' },
    ID_TYPE: { t: 'enum', d: 'DISCORD', req: true, enum: ['DISCORD', 'COMMUNITY', 'CUSTOM'], help: 'THE Unique-ID switch for this department. DISCORD = a 17-19 digit Discord ID (default). COMMUNITY = a short 1-8 digit Community ID / CID. CUSTOM = use the ID_MIN_DIGITS…ID_MAX_DIGITS range below. NOTE: Discord @mention pings only fire for a real 17-19 digit ID, so a COMMUNITY department simply gets no pings.' },
    ID_MIN_DIGITS: { t: 'int', d: 17, req: true, min: 1, max: 30, help: 'Shortest accepted Unique ID length in digits. ONLY used when ID_TYPE = CUSTOM (DISCORD forces 17, COMMUNITY forces 1).' },
    ID_MAX_DIGITS: { t: 'int', d: 19, req: true, min: 1, max: 30, help: 'Longest accepted Unique ID length in digits. ONLY used when ID_TYPE = CUSTOM (DISCORD forces 19, COMMUNITY forces 8).' },
  } },
  COLUMNS: { type: 'table', cols: ['Role', 'Match', 'Class', 'Required'],
    seed: [
      ['RANK', 'RANK', 'SLOT', 'TRUE'], ['NAME', 'NAME', 'MEMBER', 'TRUE'],
      ['UNIT', 'UNIT, CALLSIGN', 'SLOT', 'FALSE'], ['DISCORD_ID', 'DISCORD', 'MEMBER', 'TRUE'],
      ['JOIN_DATE', 'JOIN', 'MEMBER', 'FALSE'], ['LAST_PROMOTION', 'PROMOT', 'MEMBER', 'FALSE'],
      ['ACTIVITY', 'ACTIVITY', 'MEMBER', 'TRUE'], ['LAST_ACTIVITY', 'LAST ACTIVITY', 'MEMBER', 'FALSE'],
      ['HOURS', 'HOURS', 'MEMBER', 'TRUE'], ['NOTES', 'NOTES', 'MEMBER', 'FALSE'],
    ],
    help: 'Role rows: Match = keyword the header CONTAINS (case/space-proof). Rows with a blank Role are exact-header class overrides (managed by the Control Panel Columns tab). Class: SLOT stays with the position on transfer, MEMBER follows the person.' },
  SECTIONS: { type: 'table', cols: ['Section', 'CertSlots', 'Labels', 'SkipOnTransfer'], seed: [],
    help: 'Per-section cert-slot repurposing (opt-in). Ships EMPTY: carrying all member data on transfer is the safe default.' },
  SECTION_TAGS: { type: 'table', cols: ['Label', 'Keywords', 'Tone'],
    seed: [
      ['Executive', 'EXECUTIVE', 'exec'], ['Administrative', 'ADMINISTRATIV', 'admin'],
      ['Supervisor', 'SUPERVISOR', 'super'], ['Cadet', 'CADET', 'cadet'],
      ['Training', 'TRAINING', 'training'], ['Patrol', 'PATROL', 'patrol'],
      ['Auxiliary', 'AUXILIAR', 'aux'], ['Command', 'COMMAND', 'aux'],
    ],
    help: 'Informational tags for the Dividers view. FIRST match wins — order specific → general.' },
  STATUSES: { type: 'table', cols: ['Status', 'Kind', 'MinHours', 'Color', 'Announce'],
    seed: [
      ['Active', 'TIER', '10', '#57b85a', 'FALSE'], ['Semi-Active', 'TIER', '5', '#e0a52c', 'FALSE'],
      ['Inactive', 'TIER', '0', '#e0574f', 'FALSE'], ['LOA', 'LEAVE', '', '#4ea7d6', 'FALSE'],
      ['ROA', 'LEAVE', '', '#e0a52c', 'FALSE'], ['Reserve', 'PROTECTED', '', '#9d8cf2', 'FALSE'],
    ],
    help: 'TIER = computed from hours (highest tier whose MinHours is met; exactly one TIER must have MinHours 0). LEAVE = set/cleared by the leave engine. PROTECTED = never auto-overwritten. Announce wiring ships in Phase 2.' },
  STATUS_OVERRIDES: { type: 'table', cols: ['Scope', 'Match', 'Ladder'],
    seed: [['RANK', 'Auxiliary Trooper', 'Active:5, Inactive:0']],
    help: 'Per-rank tier ladders layered over the global tiers. Ladder = "Status:MinHours, …" with exactly one 0. SECTION scope is validated but not applied until Phase 2.' },
  STATUS_RULES: { type: 'table', cols: ['Source', 'Op', 'Hours', 'Target'], seed: [],
    help: 'Optional STATELESS override matrix layered on the [STATUSES] tiers. Each rule reroutes a computed status: Source = a status name or * (any); Op = < · <= · > · >= · == (or * for "always"); Hours = the threshold; Target = the resulting status. Rules apply first-match-wins and iterate to a FIXED POINT, so the result depends only on hours (idempotent — never a per-run "strike"). EMPTY (the default) = the tier ladder alone. Protected statuses are never rerouted unless named as a Source.' },
  RANKS: { type: 'table', cols: ['Value', 'Kind'], seed: [],
    help: 'Explicit rank/divider list. Value = the exact rank or divider label. Kind = RANK (a member slot), DIVIDER (a section header), or TRAINING (a member rank that ALSO lands on the Police Academy — e.g. Police Cadet, Probationary Officer). RANK/DIVIDER rows are only consulted for divider detection when [ROSTER_LAYOUT].DIVIDER_MODE = EXPLICIT_LIST (unlisted labels fall back to the all-caps heuristic, so a partial list is safe). TRAINING rows are read for the Academy regardless of DIVIDER_MODE.' },
  LEAVE: { type: 'kv', keys: {
    LEAVE_TYPES: { t: 'list', d: 'LOA, ROA', req: true, help: 'Each must be a LEAVE-kind status in [STATUSES].' },
    RETURN_TYPE: { t: 'string', d: '', req: false, help: 'Form value meaning "I am back" (closes leave early). EMPTY = disabled — ROA is a leave TYPE here, not a return.' },
    STATUS_FLOW: { t: 'list', d: 'Pending, Approved, Denied, Expired', req: true, help: 'Tracker status dropdown values. First = default on sync.' },
    APPROVED_STATUS: { t: 'string', d: 'Approved', req: false, help: 'The STATUS_FLOW value that ACTIVATES a leave. The nightly job starts/expires only leaves in this state.' },
    EXPIRED_STATUS: { t: 'string', d: 'Expired', req: false, help: 'The STATUS_FLOW value the nightly job writes when a leave END date passes.' },
    RETURN_STATUS: { t: 'string', d: 'ROA', req: false, help: 'The "returning" leave status: protected, but auto-downgrades to a computed tier when hours stay below the semi threshold. EMPTY = no returning status.' },
    AUTO_EXPIRE: { t: 'bool', d: true, req: true, help: 'Nightly job expires Approved leaves past END.' },
    EXPIRE_NEVER_APPROVED: { t: 'bool', d: false, req: true, help: 'FALSE = Pending leaves are never auto-expired.' },
    MAX_DAYS_WARN: { t: 'int', d: 30, req: false, min: 1, max: 365, help: 'Longer requests get a WARN in the sync summary (Phase 2 wiring).' },
  } },
  FORM_MAP: { type: 'table', cols: ['Role', 'Header'],
    seed: [
      ['TIMESTAMP', 'Timestamp'], ['NAME', 'Name'], ['DISCORD_ID', 'Discord'], ['CALLSIGN', 'Callsign'],
      ['RANK', 'Rank'], ['TYPE', 'Status'], ['START', 'Start'], ['END', 'End'],
    ],
    help: 'Role → form-question keyword (header CONTAINS it, case/space-proof). Phase 1: used only when ALL 8 resolve on row 1; otherwise the engine falls back to the classic fixed column order with a WARN.' },
  DISCORD: { type: 'kv', keys: {
    PING_ROLES: { t: 'string', d: '', req: false, help: 'Optional role mentions appended to notifications, e.g. <@&123> <@&456>.' },
    EMBED_COLOR: { t: 'color', d: '#236995', req: false, help: 'Reserved general embed accent.' },
    MENTION_MEMBERS: { t: 'bool', d: true, req: true, help: 'Ping <@id> when the Discord ID is valid (currently always on).' },
    SUBMIT_COLOR: { t: 'color', d: '#3498db', req: true, help: 'Colour bar of a new leave-submission embed.' },
    RETURN_COLOR: { t: 'color', d: '#e67e22', req: true, help: 'Colour bar when the submission is the returning-leave type.' },
    EXPIRE_COLOR: { t: 'color', d: '#ed4245', req: true, help: 'Colour bar of a leave-expired embed.' },
    SUBMIT_TITLE: { t: 'string', d: '📥 New {type} Submission', req: true, help: 'Title of a new leave-submission embed. {type} = the leave type.' },
    EXPIRE_TITLE: { t: 'string', d: '⏳ {type} Expired', req: true, help: 'Title of a leave-expired embed. {type} = the leave type.' },
    EMBED_AUTHOR: { t: 'string', d: '', req: false, help: 'Small author line shown ABOVE the title (e.g. the department name). Blank = off.' },
    EMBED_AUTHOR_ICON: { t: 'string', d: '', req: false, help: 'Author icon image URL (https://…), shown beside the author name. Needs an author.' },
    EMBED_THUMBNAIL: { t: 'string', d: '', req: false, help: 'Thumbnail image URL (https://…) shown at the embed\'s top-right. Blank = off.' },
    EMBED_IMAGE: { t: 'string', d: '', req: false, help: 'Large image URL (https://…) shown below the fields. Blank = off.' },
    EMBED_FOOTER: { t: 'string', d: '', req: false, help: 'Footer text. Blank = the system name.' },
    EMBED_FOOTER_ICON: { t: 'string', d: '', req: false, help: 'Footer icon image URL (https://…), shown beside the footer text. Blank = off.' },
  } },
  NOTIFICATIONS: { type: 'kv', help: 'Optional Discord embeds for roster events. All OFF by default; each posts to the same webhook and reuses the [DISCORD] embed author/thumbnail/image/footer.', keys: {
    MEMBER_ADDED: { t: 'bool', d: false, req: false, help: 'Post an embed when a member is seated into a slot.' },
    MEMBER_ADDED_TITLE: { t: 'string', d: '➕ {name} joined the roster', req: false, help: 'Title for the member-added embed. {name} = the member name.' },
    MEMBER_ADDED_COLOR: { t: 'color', d: '#57b85a', req: false, help: 'Colour bar of the member-added embed.' },
    TRANSFER: { t: 'bool', d: false, req: false, help: 'Post an embed when a member moves rows (transfer / promotion / demotion).' },
    TRANSFER_TITLE: { t: 'string', d: '🔄 {name} — {from} → {to}', req: false, help: 'Title for the transfer embed. {name}, {from} rank, {to} rank.' },
    TRANSFER_COLOR: { t: 'color', d: '#5865f2', req: false, help: 'Colour bar of the transfer embed.' },
    LEAVE_APPROVED: { t: 'bool', d: false, req: false, help: 'Post an embed when a leave is approved on the tracker.' },
    LEAVE_APPROVED_TITLE: { t: 'string', d: '✅ {type} Approved', req: false, help: 'Title for the leave-approved embed. {type} = the leave type.' },
    LEAVE_APPROVED_COLOR: { t: 'color', d: '#57b85a', req: false, help: 'Colour bar of the leave-approved embed.' },
    LEAVE_STARTED: { t: 'bool', d: false, req: false, help: 'Post an embed when a leave becomes active (its start date arrives).' },
    LEAVE_STARTED_TITLE: { t: 'string', d: '▶️ {type} Started', req: false, help: 'Title for the leave-started embed. {type} = the leave type.' },
    LEAVE_STARTED_COLOR: { t: 'color', d: '#4ea7d6', req: false, help: 'Colour bar of the leave-started embed.' },
    WEEKLY_DIGEST: { t: 'bool', d: false, req: false, help: 'Post a roster-summary embed (headcount by status) at each hours reset.' },
    WEEKLY_DIGEST_TITLE: { t: 'string', d: '📊 Weekly Roster Summary', req: false, help: 'Title for the weekly digest embed.' },
    WEEKLY_DIGEST_COLOR: { t: 'color', d: '#5865f2', req: false, help: 'Colour bar of the weekly digest embed.' },
    PATROL_LOGGED: { t: 'bool', d: false, req: false, help: 'Post an embed when a patrol log credits hours to a member.' },
    PATROL_LOGGED_TITLE: { t: 'string', d: '🚔 {name} logged {hours}h of patrol', req: false, help: 'Title for the patrol-logged embed. Tokens: {name}, {hours} (this log), {total} (new total).' },
    PATROL_LOGGED_COLOR: { t: 'color', d: '#4ea7d6', req: false, help: 'Colour bar of the patrol-logged embed.' },
  } },
  PUBLISH: { type: 'kv', help: 'Public-roster publishing. Cells on the PUBLIC copy that must never be overwritten. A destination cell containing a FORMULA is always left alone automatically (so its own live date/time/counters keep recalculating) — this list is for STATIC text that should differ, like the public title.', keys: {
    NEVER_PUBLISH: { t: 'list', d: 'EMAIL, DATE OF BIRTH, DOB, PHONE, ADDRESS', req: false, help: 'Column headers whose data is NEVER copied to the public roster, and is wiped there if a tab copy brought it along. Matched case/space-insensitively as a substring, except CID and DOB which must match exactly. Remove an entry to publish that column (e.g. drop "UNIQUE ID" if members should see IDs).' },
    KEEP_RANGES: { t: 'list', d: 'Welcome Page!F6:W7, Member Information!D3:H3', req: false, help: 'Comma-separated Tab!Range entries the publish never writes to, e.g. "Welcome Page!F6:W7, Welcome Page!A1". Use * as the tab name to apply a range to every tab.' },
  } },
  PATROL: { type: 'kv', help: 'Patrol-log form → member hours. Each new submission on the [SHEETS].PATROL_RESPONSES tab credits its patrol time to the matching member\'s HOURS. Column keywords match your form\'s question headers (header CONTAINS the keyword, case/space-proof). OFF until [SHEETS].PATROL_RESPONSES is set.', keys: {
    MODE: { t: 'enum', d: 'START_END', req: false, enum: ['START_END', 'DURATION'], help: 'START_END = compute hours from a start + end time. DURATION = read a single "hours patrolled" number.' },
    MAX_HOURS: { t: 'int', d: 16, req: false, min: 1, max: 24, help: 'Reject a single patrol log longer than this many hours (guards typos / bad times).' },
    OVERNIGHT: { t: 'bool', d: true, req: false, help: 'START_END only: if the end time is before the start, treat it as crossing midnight (+24h) instead of an error.' },
    RECOMPUTE: { t: 'bool', d: true, req: false, help: 'Recompute the member\'s activity status from their new hours after crediting a patrol.' },
    STATUS_FLOW: { t: 'list', d: 'Pending, Flagged, Processed', req: false, help: 'Manual Patrol Log tab: the STATUS dropdown values AND their top-to-bottom sort order (Pending at the top, then Flagged, then Processed).' },
    FLAGGED_STATUS: { t: 'string', d: 'Flagged', req: false, help: 'Patrol Log: the status auto-set on a log the engine flags (bad time, over-max, unknown ID, future date). The reason is written to NOTES.' },
    PROCESSED_STATUS: { t: 'string', d: 'Processed', req: false, help: 'Patrol Log: the "reviewed / done" status. Hours credit on entry regardless; this just marks a log as handled.' },
    COL_DISCORD: { t: 'string', d: 'Discord', req: false, help: 'Form-header keyword for the Discord-ID column (primary match key).' },
    COL_CALLSIGN: { t: 'string', d: 'Callsign', req: false, help: 'Form-header keyword for the callsign column (fallback match key when the ID is blank/unmatched).' },
    COL_START: { t: 'string', d: 'Start', req: false, help: 'START_END mode: header keyword for the on-duty / start-time column.' },
    COL_END: { t: 'string', d: 'End', req: false, help: 'START_END mode: header keyword for the off-duty / end-time column.' },
    COL_DURATION: { t: 'string', d: 'Hours', req: false, help: 'DURATION mode: header keyword for the hours-patrolled column.' },
  } },
  FORMATS: { type: 'kv', keys: {
    DATE_DISPLAY: { t: 'string', d: 'd MMM. yyyy', req: true, help: 'Date format for leave dates shown in Discord embeds, the coverage view and the panel. Java date patterns (d=day, MMM=Jan, yyyy=2026); a bad pattern falls back to the default.' },
    TIMESTAMP_DISPLAY: { t: 'string', d: 'd MMM yyyy, h:mm a', req: true, help: 'Date+time format for "last updated" / snapshot timestamps. Java date patterns; a bad pattern falls back to the default.' },
  } },
  SCHEDULE: { type: 'kv', keys: {
    NIGHTLY_HOUR: { t: 'int', d: 0, req: true, min: 0, max: 23, help: 'Hour for the daily schedule check trigger (0 = midnight, the live default).' },
    TIMEZONE: { t: 'enum', d: 'SPREADSHEET', req: true, enum: ['SPREADSHEET'], help: 'Phase 1 supports the spreadsheet timezone.' },
    RESET_CADENCE: { t: 'enum', d: 'WEEKLY', req: true, enum: ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'MANUAL'], help: 'How often the hours reset runs. WEEKLY = the classic behavior. BIWEEKLY = every 14 days. MONTHLY = on RESET_DOM. MANUAL = no auto-reset trigger.' },
    WEEKLY_HOURS_RESET: { t: 'enum', d: 'SUN', req: true, enum: ['OFF', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], help: 'Weekday for WEEKLY/BIWEEKLY reset (captures history BEFORE zeroing — resolved G1). OFF disables the reset regardless of cadence.' },
    WEEKLY_RESET_HOUR: { t: 'int', d: 23, req: true, min: 0, max: 23, help: 'Hour of day for the reset trigger.' },
    RESET_DOM: { t: 'int', d: 1, req: true, min: 1, max: 28, help: 'Day of month the reset runs under MONTHLY cadence (1–28, v1.0).' },
  } },
  LOGGING: { type: 'kv', keys: {
    LOG_LEVEL: { t: 'enum', d: 'INFO', req: true, enum: ['ERROR', 'WARN', 'INFO', 'DEBUG'], help: 'Minimum severity written to the SYS Log.' },
    LOG_MAX_ROWS: { t: 'int', d: 500, req: true, min: 50, max: 10000, help: 'SYS Log ring-buffer cap.' },
    EMAIL_ON_ERROR: { t: 'bool', d: false, req: true, help: 'Phase 2 wiring (uses the ADMIN_EMAIL Script Property).' },
    DIAG_INCLUDE_NAMES: { t: 'bool', d: true, req: true, help: 'FALSE redacts member names from diagnostic reports (Phase 2).' },
    PERF_TIMING: { t: 'bool', d: false, req: false, help: 'Log each panel action / trigger duration to the SYS Log. Entries log at INFO — set LOG_LEVEL to INFO while measuring. Turn on briefly to find slow spots, then off.' },
  } },
  LIMITS: { type: 'kv', keys: {
    SNAPSHOT_KEEP: { t: 'int', d: 20, req: true, min: 1, max: 200, help: 'How many in-sheet snapshots to keep before the oldest are pruned.' },
    LOG_ROW_CAP: { t: 'int', d: 5000, req: true, min: 200, max: 50000, help: 'Row cap for the Edit Log, Integrity Log and hours-history tabs before the oldest rows are trimmed.' },
    VALIDATION_BUFFER: { t: 'int', d: 50, req: true, min: 0, max: 1000, help: 'Extra rows below the live data that entry-time data-validation covers; re-run First-Run Setup after big growth.' },
  } },
  THEME: { type: 'kv', keys: {
    CANVAS: { t: 'color', d: THEME_DEFAULTS.CANVAS, req: true, help: 'Dark canvas below engine tables.' },
    BANNER: { t: 'color', d: THEME_DEFAULTS.BANNER, req: true, help: 'Header banner fill on engine sheets.' },
    GRID: { t: 'color', d: THEME_DEFAULTS.GRID, req: true, help: 'Console-grid border color.' },
    ACCENT: { t: 'color', d: THEME_DEFAULTS.ACCENT, req: true, help: 'Accent (header underline).' },
    TEXT: { t: 'color', d: THEME_DEFAULTS.TEXT, req: true, help: 'Body text on engine sheets.' },
    TEXT_STRONG: { t: 'color', d: THEME_DEFAULTS.TEXT_STRONG, req: true, help: 'Header text.' },
    SUBHEAD: { t: 'color', d: THEME_DEFAULTS.SUBHEAD, req: true, help: 'Column-header fill (results tables).' },
    SUBHEAD_TEXT: { t: 'color', d: THEME_DEFAULTS.SUBHEAD_TEXT, req: true, help: 'Column-header text (results tables).' },
    PASS: { t: 'color', d: THEME_DEFAULTS.PASS, req: true, help: 'Semantic green (PASS / done).' },
    FAIL: { t: 'color', d: THEME_DEFAULTS.FAIL, req: true, help: 'Semantic red (FAIL / error).' },
    INFO: { t: 'color', d: THEME_DEFAULTS.INFO, req: true, help: 'Semantic blue (INFO).' },
    PROCESSING: { t: 'color', d: THEME_DEFAULTS.PROCESSING, req: true, help: 'Form-row "processing" tint.' },
  } },
  DASHBOARD: { type: 'kv', keys: {
    ENABLE: { t: 'bool', d: true, req: true, help: 'Master switch for the KPI-box + #stat-tag renderer.' },
    SEARCH_ROWS: { t: 'int', d: 60, req: true, min: 1, max: 500, help: 'How many top rows are scanned for KPI labels.' },
  } },
  DASHBOARD_GROUPS: { type: 'table', cols: ['Group', 'Categories'],
    seed: [['Supervisors', 'Executive, Administrative, Supervisor'], ['Troopers', 'Patrol, Training, Cadet'], ['Auxiliary', 'Auxiliary']],
    help: 'Headcount buckets: section-tag labels (from [SECTION_TAGS]) and/or exact rank names rolled into named groups. An entry that matches no section tag counts members by RANK (case-insensitive) wherever they sit, and beats the section — list "Sergeant and up" by name for a rank-based group. Each group is also a #tag.' },
  DASHBOARD_CELLS: { type: 'table', cols: ['Label', 'Dir', 'Stat'],
    seed: [
      ['TOTAL HOURS', 'below', 'totalHours'], ['CURRENT LOAS/ROAS', 'below', 'leaves'],
      ['SUPERVISORS', 'right', 'group:Supervisors'], ['TROOPERS', 'right', 'group:Troopers'],
      ['AUXILIARY', 'right', 'group:Auxiliary'], ['TOTAL', 'right', 'total'],
    ],
    help: 'Fixed KPI boxes: the engine finds each Label by text and writes the Stat value below/right of it.' },
  EMBEDS: { type: 'table', cols: ['Event', 'Json'], seed: [],
    help: 'Per-event Discord embed templates (JSON), managed by Engine Settings ▸ Discord. EMPTY = the built-in embeds. Edit through the builder — hand-broken JSON rows are ignored.' },
});

const BLOCK_ORDER_ = Object.freeze(['SYSTEM', 'SHEETS', 'ROSTER_LAYOUT', 'RANKS', 'COLUMNS', 'SECTIONS', 'SECTION_TAGS',
  'STATUSES', 'STATUS_OVERRIDES', 'STATUS_RULES', 'LEAVE', 'FORM_MAP', 'DISCORD', 'NOTIFICATIONS', 'PATROL', 'PUBLISH', 'FORMATS', 'SCHEDULE', 'LOGGING', 'LIMITS', 'THEME',
  'DASHBOARD', 'DASHBOARD_GROUPS', 'DASHBOARD_CELLS', 'EMBEDS']);

/* ======================================================================
 * PARSING — one bulk read of the Config tab into raw blocks.
 * ====================================================================== */

/** Locate the Config tab: by name, else rescue-scan every sheet for the A1 marker. @return {Sheet|null} */
function findConfigSheet_(ss) {
  const s = (ss || SpreadsheetApp.getActive());
  const byName = s.getSheetByName(CONFIG_SHEET_NAME);
  if (byName) return byName;
  const sheets = s.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    try { if (String(sheets[i].getRange(1, 1).getDisplayValue()).trim() === CONFIG_MARKER) return sheets[i]; } catch (e) { /* keep scanning */ }
  }
  return null;
}

/**
 * Parse the Config tab into raw blocks (injectable — tests pass a sandbox sheet).
 * @return {Object} { BLOCK: {kind:'kv', kv:{KEY:'value'}} | {kind:'table', header:[...], rows:[[...]]} }
 */
function parseBlocks_(sheet) {
  const out = {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return out;
  const v = sheet.getRange(1, 1, lastRow, Math.max(sheet.getLastColumn(), 5)).getDisplayValues(); // 5 = widest block ([STATUSES])
  let i = 0;
  while (i < v.length) {
    const a = String(v[i][0]).trim();
    const m = a.match(/^\[([A-Z_]+)\]$/);
    if (!m) { i++; continue; }
    const name = m[1];
    const spec = BLOCK_SPECS_[name];
    i++;
    if (spec && spec.type === 'table') {
      const header = (i < v.length) ? v[i].map((x) => String(x).trim()) : [];
      i++; // past the table header row
      const rows = [];
      while (i < v.length && v[i].some((x) => String(x).trim() !== '')) { rows.push(v[i].map((x) => String(x).trim())); i++; }
      out[name] = { kind: 'table', header, rows, truncated: blankTruncates_(v, i) };
    } else {
      const kv = {};
      while (i < v.length && String(v[i][0]).trim() !== '' && !String(v[i][0]).trim().match(/^\[/)) {
        kv[norm_(v[i][0]).replace(/ /g, '_')] = String(v[i][1]).trim();
        i++;
      }
      out[name] = { kind: 'kv', kv, truncated: blankTruncates_(v, i) };
    }
  }
  return out;
}

/**
 * True if, starting at index i (which the block-reader stopped at because of a BLANK row), more non-blank content
 * appears before the next [BLOCK] marker — i.e. a blank row silently TRUNCATED the block and dropped rows (F-013).
 */
function blankTruncates_(v, i) {
  for (let j = i; j < v.length; j++) {
    if (String(v[j][0]).trim().match(/^\[([A-Z_]+)\]$/)) return false; // clean end — reached the next block
    if (v[j].some((x) => String(x).trim() !== '')) return true;        // real content after the blank gap
  }
  return false;
}

/* ======================================================================
 * VALIDATION — collect ALL problems in one pass, report once (E-102).
 * Unknown keys/blocks are preserved with a WARN, never fatal.
 * ====================================================================== */

function coerce_(key, rawValue, keySpec, problems) {
  const bad = (expected) => { problems.push({ sev: 'ERROR', code: 'E-103', key, value: rawValue, type: keySpec.t, expected }); return keySpec.d; };
  const raw = String(rawValue == null ? '' : rawValue).trim();
  if (raw === '') {
    if (keySpec.req) return bad('a non-empty ' + keySpec.t);
    // An explicitly-EMPTY optional value means "off/none" and must STAY empty — lists already return [] (not the
    // default list) and strings follow the same rule ("EMPTY = disabled" is a documented contract, e.g.
    // [LEAVE].RETURN_STATUS). Defaults apply only when the KEY IS ABSENT (validateConfig_'s present-check).
    // Typed values (int/bool/enum/color) have no meaningful "empty" and keep falling back to the default.
    if (keySpec.t === 'list') return [];
    if (keySpec.t === 'string') return '';
    return keySpec.d;
  }
  switch (keySpec.t) {
    case 'int': {
      const n = parseInt(raw, 10);
      if (isNaN(n) || String(n) !== raw.replace(/^\+/, '')) return bad('a whole number');
      if (keySpec.min != null && n < keySpec.min) return bad(`>= ${keySpec.min}`);
      if (keySpec.max != null && n > keySpec.max) return bad(`<= ${keySpec.max}`);
      return n;
    }
    case 'bool': {
      const u = raw.toUpperCase();
      if (u === 'TRUE' || u === 'YES' || u === '1') return true;
      if (u === 'FALSE' || u === 'NO' || u === '0') return false;
      return bad('TRUE or FALSE');
    }
    case 'enum': {
      const hit = (keySpec.enum || []).filter((x) => norm_(x) === norm_(raw))[0];
      if (hit === undefined) return bad((keySpec.enum || []).join(' · '));
      return hit;
    }
    case 'color': {
      if (!/^#[0-9a-fA-F]{6}$/.test(raw)) return bad('a #rrggbb hex color');
      return raw.toLowerCase();
    }
    case 'list':
      return raw.split(',').map((x) => x.trim()).filter((x) => x !== '');
    default:
      return raw;
  }
}

/** Parse a "Status:Min, Status:Min" ladder string. @return {Array<{name:string,min:number}>|null} null = malformed. */
function parseLadder_(raw) {
  const parts = String(raw || '').split(',').map((x) => x.trim()).filter((x) => x !== '');
  if (!parts.length) return null;
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const m = parts[i].match(/^(.+?)\s*:\s*(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    out.push({ name: m[1].trim(), min: parseFloat(m[2]) });
  }
  out.sort((a, b) => b.min - a.min);
  return out;
}

/** Validate a tier ladder: unique thresholds + exactly one zero. Pushes E-110 problems. */
function checkLadder_(ladder, label, problems) {
  const zeros = ladder.filter((t) => t.min === 0).length;
  if (zeros !== 1) problems.push({ sev: 'ERROR', code: 'E-110', key: label, value: ladder.map((t) => `${t.name}:${t.min}`).join(', '), type: 'ladder', expected: 'exactly one entry with MinHours 0', reason: `${label} has ${zeros} zero-threshold entries` });
  const mins = {};
  ladder.forEach((t) => { if (mins[t.min]) problems.push({ sev: 'ERROR', code: 'E-110', key: label, value: String(t.min), type: 'ladder', expected: 'unique thresholds', reason: `${label} repeats threshold ${t.min}` }); mins[t.min] = true; });
}

/**
 * Validate raw blocks into a typed config object + problem list (injectable/pure — tests feed
 * synthetic raw blocks). Missing blocks/keys fall back to spec defaults (additive migration, brief A5).
 * @return {{config:Object, problems:Array}}
 */
function validateConfig_(raw) {
  const problems = [];
  const c = { kv: {}, tables: {} };

  Object.keys(raw || {}).forEach((b) => { if (!BLOCK_SPECS_[b]) problems.push({ sev: 'WARN', code: 'E-103', key: `[${b}]`, value: 'unknown block', type: 'block', expected: 'a known block (preserved, ignored)' }); });
  // F-013: a blank row inside a block truncates it — WARN so the dropped rows aren't lost silently.
  Object.keys(raw || {}).forEach((b) => { if (raw[b] && raw[b].truncated) problems.push({ sev: 'WARN', code: 'E-103', key: `[${b}]`, value: 'blank row inside the block', type: 'truncation', expected: 'no blank rows within a block — rows after the first blank were dropped' }); });

  BLOCK_ORDER_.forEach((name) => {
    const spec = BLOCK_SPECS_[name];
    const rawBlock = (raw || {})[name];
    if (spec.type === 'kv') {
      const kv = {};
      Object.keys(spec.keys).forEach((key) => {
        const present = rawBlock && rawBlock.kv && Object.prototype.hasOwnProperty.call(rawBlock.kv, key);
        kv[key] = present ? coerce_(`[${name}].${key}`, rawBlock.kv[key], spec.keys[key], problems)
                          : (spec.keys[key].t === 'list' ? String(spec.keys[key].d).split(',').map((x) => x.trim()).filter(Boolean) : spec.keys[key].d);
      });
      if (rawBlock && rawBlock.kv) Object.keys(rawBlock.kv).forEach((k) => { if (!spec.keys[k]) problems.push({ sev: 'WARN', code: 'E-103', key: `[${name}].${k}`, value: rawBlock.kv[k], type: 'key', expected: 'a known key (preserved, ignored)' }); });
      c.kv[name] = kv;
    } else {
      // F-013: if a header row is PRESENT but doesn't match the schema columns, a deleted/renamed header has shifted
      // every row positionally — don't trust the mapping. Fall back to seed defaults + WARN (system stays functional).
      let rows;
      const hasHeader = rawBlock && rawBlock.kind === 'table' && Array.isArray(rawBlock.header) && rawBlock.header.some((h) => String(h).trim() !== '');
      if (hasHeader) {
        const hdr = rawBlock.header.slice(0, spec.cols.length).map((h) => norm_(h));
        const headerOk = spec.cols.every((col, idx) => hdr[idx] === norm_(col));
        if (headerOk) rows = rawBlock.rows;
        else {
          problems.push({ sev: 'WARN', code: 'E-103', key: `[${name}]`, value: (rawBlock.header || []).join(' | ') || '(header row not recognized)', type: 'header', expected: `header row "${spec.cols.join(', ')}" — using built-in defaults until the header is restored` });
          rows = spec.seed.map((r) => r.slice());
        }
      } else {
        rows = (rawBlock && rawBlock.kind === 'table') ? rawBlock.rows : spec.seed.map((r) => r.slice());
      }
      c.tables[name] = rows.map((r) => { const o = {}; spec.cols.forEach((col, idx) => { o[col] = String(r[idx] == null ? '' : r[idx]).trim(); }); return o; });
    }
  });

  // ---- Semantic checks (cross-field) ----
  if (c.kv.SYSTEM.SCHEMA_VERSION > ENGINE_SCHEMA) problems.push({ sev: 'ERROR', code: 'E-104', key: '[SYSTEM].SCHEMA_VERSION', value: c.kv.SYSTEM.SCHEMA_VERSION, type: 'schema', expected: `<= ${ENGINE_SCHEMA}`, sheet: c.kv.SYSTEM.SCHEMA_VERSION, engine: ENGINE_SCHEMA });
  if (c.kv.ROSTER_LAYOUT.DATA_START_ROW <= c.kv.ROSTER_LAYOUT.HEADER_ROW) problems.push({ sev: 'ERROR', code: 'E-103', key: '[ROSTER_LAYOUT].DATA_START_ROW', value: c.kv.ROSTER_LAYOUT.DATA_START_ROW, type: 'int', expected: `> HEADER_ROW (${c.kv.ROSTER_LAYOUT.HEADER_ROW})` });
  if (norm_(c.kv.ROSTER_LAYOUT.ID_TYPE) === 'CUSTOM' && c.kv.ROSTER_LAYOUT.ID_MIN_DIGITS > c.kv.ROSTER_LAYOUT.ID_MAX_DIGITS) problems.push({ sev: 'ERROR', code: 'E-103', key: '[ROSTER_LAYOUT].ID_MIN_DIGITS', value: c.kv.ROSTER_LAYOUT.ID_MIN_DIGITS, type: 'int', expected: `<= ID_MAX_DIGITS (${c.kv.ROSTER_LAYOUT.ID_MAX_DIGITS})` });
  if (!/\{0+\}/.test(String(c.kv.ROSTER_LAYOUT.UNIT_FORMAT || ''))) problems.push({ sev: 'WARN', code: 'E-103', key: '[ROSTER_LAYOUT].UNIT_FORMAT', value: c.kv.ROSTER_LAYOUT.UNIT_FORMAT, type: 'format', expected: 'a {0…} number token (e.g. "S-{00}") — without one every slot gets the same label' });

  // [STATUSES]
  const statuses = [];
  const seen = {};
  c.tables.STATUSES.forEach((row) => {
    if (!row.Status) return;
    const kind = norm_(row.Kind);
    if (['TIER', 'LEAVE', 'PROTECTED'].indexOf(kind) === -1) { problems.push({ sev: 'ERROR', code: 'E-103', key: `[STATUSES].${row.Status}`, value: row.Kind, type: 'kind', expected: 'TIER · LEAVE · PROTECTED' }); return; }
    if (seen[norm_(row.Status)]) { problems.push({ sev: 'ERROR', code: 'E-103', key: '[STATUSES]', value: row.Status, type: 'status', expected: 'unique status names' }); return; }
    seen[norm_(row.Status)] = true;
    const min = (kind === 'TIER') ? parseFloat(row.MinHours) : null;
    if (kind === 'TIER' && (row.MinHours === '' || isNaN(min))) { problems.push({ sev: 'ERROR', code: 'E-103', key: `[STATUSES].${row.Status}`, value: row.MinHours, type: 'number', expected: 'MinHours for a TIER' }); return; }
    statuses.push({ name: row.Status, kind, min, color: row.Color || '', announce: norm_(row.Announce) === 'TRUE' });
  });
  const tiers = statuses.filter((s) => s.kind === 'TIER').sort((a, b) => b.min - a.min);
  if (!tiers.length) problems.push({ sev: 'ERROR', code: 'E-110', key: '[STATUSES]', value: 'no TIER rows', type: 'ladder', expected: 'at least one TIER', reason: 'no TIER statuses defined' });
  else checkLadder_(tiers.map((t) => ({ name: t.name, min: t.min })), '[STATUSES]', problems);

  // [STATUS_OVERRIDES]
  const overrides = [];
  c.tables.STATUS_OVERRIDES.forEach((row) => {
    if (!row.Scope && !row.Match && !row.Ladder) return;
    const scope = norm_(row.Scope);
    if (scope !== 'RANK' && scope !== 'SECTION') { problems.push({ sev: 'ERROR', code: 'E-103', key: '[STATUS_OVERRIDES].Scope', value: row.Scope, type: 'scope', expected: 'RANK · SECTION' }); return; }
    if (scope === 'SECTION') problems.push({ sev: 'WARN', code: 'E-103', key: '[STATUS_OVERRIDES]', value: row.Match, type: 'scope', expected: 'SECTION scope is not applied until Phase 2' });
    const ladder = parseLadder_(row.Ladder);
    if (!ladder) { problems.push({ sev: 'ERROR', code: 'E-103', key: `[STATUS_OVERRIDES].${row.Match}`, value: row.Ladder, type: 'ladder', expected: '"Status:MinHours, Status:MinHours"' }); return; }
    checkLadder_(ladder, `[STATUS_OVERRIDES].${row.Match}`, problems);
    ladder.forEach((t) => { if (!seen[norm_(t.name)]) problems.push({ sev: 'WARN', code: 'E-103', key: `[STATUS_OVERRIDES].${row.Match}`, value: t.name, type: 'status', expected: 'a status defined in [STATUSES]' }); });
    overrides.push({ scope, match: row.Match, ladder });
  });

  // [STATUS_RULES] — stateless override matrix layered on the tiers; validated for known statuses + convergence
  const statusRules = [];
  const RULE_OPS = ['<', '<=', '>', '>=', '==', '*'];
  c.tables.STATUS_RULES.forEach((row) => {
    if (!row.Source && !row.Op && !row.Hours && !row.Target) return;
    const source = String(row.Source || '').trim();
    const op = String(row.Op || '').trim();
    const target = String(row.Target || '').trim();
    const isAny = source === '*';
    if (RULE_OPS.indexOf(op) === -1) { problems.push({ sev: 'ERROR', code: 'E-103', key: '[STATUS_RULES].Op', value: row.Op, type: 'op', expected: '< · <= · > · >= · == · *' }); return; }
    const hrs = parseFloat(row.Hours);
    if (op !== '*' && (row.Hours === '' || isNaN(hrs))) { problems.push({ sev: 'ERROR', code: 'E-103', key: `[STATUS_RULES].${source || '*'}`, value: row.Hours, type: 'number', expected: 'a numeric Hours threshold' }); return; }
    if (!target) { problems.push({ sev: 'ERROR', code: 'E-103', key: '[STATUS_RULES]', value: '(blank Target)', type: 'status', expected: 'a Target status' }); return; }
    if (!seen[norm_(target)]) problems.push({ sev: 'ERROR', code: 'E-103', key: '[STATUS_RULES].Target', value: target, type: 'status', expected: 'a status defined in [STATUSES]' });
    if (!isAny && !seen[norm_(source)]) problems.push({ sev: 'WARN', code: 'E-103', key: '[STATUS_RULES].Source', value: source, type: 'status', expected: 'a status in [STATUSES] (or * for any) — this rule never matches' });
    statusRules.push({ source: isAny ? '*' : norm_(source), op, hours: isNaN(hrs) ? 0 : hrs, target });
  });
  // Convergence advisory: a Source→Target cycle would loop (the runtime evaluator caps iteration + converges, but WARN so the author knows).
  (function () {
    const edges = {};
    statusRules.forEach((r) => { if (r.source !== '*') (edges[r.source] = edges[r.source] || []).push(norm_(r.target)); });
    const color = {}; // 1 = visiting, 2 = done
    const hasCycle = (n) => {
      color[n] = 1;
      const outs = edges[n] || [];
      for (let i = 0; i < outs.length; i++) { const m = outs[i]; if (color[m] === 1) return true; if (color[m] === undefined && hasCycle(m)) return true; }
      color[n] = 2; return false;
    };
    const nodes = Object.keys(edges);
    let cyclic = false;
    for (let i = 0; i < nodes.length && !cyclic; i++) { if (color[nodes[i]] === undefined) cyclic = hasCycle(nodes[i]); }
    if (cyclic) problems.push({ sev: 'WARN', code: 'E-103', key: '[STATUS_RULES]', value: 'cyclic transitions', type: 'rules', expected: 'no Source→Target cycles — the engine caps iteration and still converges, but the outcome may surprise you' });
  })();

  // [RANKS] — explicit rank/divider list (only applied when [ROSTER_LAYOUT].DIVIDER_MODE = EXPLICIT_LIST)
  c.tables.RANKS.forEach((row) => {
    if (!row.Value && !row.Kind) return;
    const kind = norm_(row.Kind);
    if (kind !== 'RANK' && kind !== 'DIVIDER' && kind !== 'TRAINING') problems.push({ sev: 'ERROR', code: 'E-103', key: `[RANKS].${row.Value || '(blank)'}`, value: row.Kind, type: 'kind', expected: 'RANK · DIVIDER · TRAINING' });
  });
  if (norm_(c.kv.ROSTER_LAYOUT.DIVIDER_MODE) === 'EXPLICIT_LIST' && !c.tables.RANKS.some((r) => String(r.Value || '').trim() !== '')) {
    problems.push({ sev: 'WARN', code: 'E-103', key: '[RANKS]', value: '(empty)', type: 'ranks', expected: 'DIVIDER_MODE is EXPLICIT_LIST but [RANKS] is empty — the all-caps heuristic is used until you list ranks/dividers' });
  }

  // [SHEETS] — every tab role must resolve to a DISTINCT tab (a collision silently aliases two roles onto one sheet → data loss).
  (function () {
    const roles = {
      '[SHEETS].ROSTER': c.kv.SHEETS.ROSTER, '[SHEETS].TRACKER': c.kv.SHEETS.TRACKER, '[SHEETS].FORM_RESPONSES': c.kv.SHEETS.FORM_RESPONSES,
      '[SHEETS].AUDIT': c.kv.SHEETS.AUDIT || 'Edit Log', '[SHEETS].HOURS_HISTORY': c.kv.SHEETS.HOURS_HISTORY || '_Hours History',
      '[SHEETS].COVERAGE': c.kv.SHEETS.COVERAGE || 'Leave Coverage', '[SHEETS].INTEGRITY': c.kv.SHEETS.INTEGRITY || 'Integrity Log',
      '[SHEETS].SNAPSHOTS': c.kv.SHEETS.SNAPSHOTS || '_Snapshots', '[SHEETS].PATROL_RESPONSES': c.kv.SHEETS.PATROL_RESPONSES, // '' is skipped below
      '[SHEETS].PATROL_LOG': c.kv.SHEETS.PATROL_LOG, '[SHEETS].SIGNUPS': c.kv.SHEETS.SIGNUPS || 'Roster Signups', // the manual patrol log + signup feeds each need their OWN tab too ('' skipped)
      '[SHEETS].SIGNUP_FORM_RESPONSES': c.kv.SHEETS.SIGNUP_FORM_RESPONSES, // the signup form's response tab must be distinct from its review tab ('' skipped)
    };
    const byName = {};
    Object.keys(roles).forEach((role) => {
      const nm = norm_(roles[role]);
      if (!nm) return;
      if (byName[nm]) problems.push({ sev: 'ERROR', code: 'E-103', key: role, value: roles[role], type: 'sheet', expected: `a tab name distinct from ${byName[nm]} — two roles cannot share one tab` });
      else byName[nm] = role;
    });
    [CONFIG_SHEET_NAME, SYS_LOG_SHEET].forEach((reserved) => {
      Object.keys(roles).forEach((role) => { if (norm_(roles[role]) === norm_(reserved)) problems.push({ sev: 'ERROR', code: 'E-103', key: role, value: roles[role], type: 'sheet', expected: `a name other than the reserved "${reserved}" tab` }); });
    });
  })();

  // [COLUMNS]
  const requiredRoles = ['RANK', 'NAME', 'DISCORD_ID', 'ACTIVITY', 'HOURS'];
  const roleRows = c.tables.COLUMNS.filter((r) => r.Role !== '');
  requiredRoles.forEach((role) => {
    const hit = roleRows.filter((r) => norm_(r.Role) === role)[0];
    if (!hit || !hit.Match) problems.push({ sev: 'ERROR', code: 'E-202', key: `[COLUMNS].${role}`, value: hit ? hit.Match : '(missing row)', type: 'role', expected: 'a Match keyword', role, match: hit ? hit.Match : '' });
  });
  c.tables.COLUMNS.forEach((r) => {
    const klass = norm_(r.Class);
    if (r.Class !== '' && klass !== 'SLOT' && klass !== 'MEMBER') problems.push({ sev: 'ERROR', code: 'E-103', key: `[COLUMNS].${r.Role || r.Match}`, value: r.Class, type: 'class', expected: 'SLOT · MEMBER' });
  });

  // [DASHBOARD_CELLS] — Dir must be below|right ("no silent failures": a typo would otherwise coerce to 'right').
  c.tables.DASHBOARD_CELLS.forEach((r) => {
    if (r.Label && r.Dir !== '' && norm_(r.Dir) !== 'BELOW' && norm_(r.Dir) !== 'RIGHT') {
      problems.push({ sev: 'WARN', code: 'E-103', key: `[DASHBOARD_CELLS].${r.Label}`, value: r.Dir, type: 'dir', expected: 'below · right (treated as right)' });
    }
  });

  // [LEAVE] semantics
  c.kv.LEAVE.LEAVE_TYPES.forEach((t) => {
    const st = statuses.filter((s) => norm_(s.name) === norm_(t))[0];
    if (!st || st.kind !== 'LEAVE') problems.push({ sev: 'ERROR', code: 'E-103', key: '[LEAVE].LEAVE_TYPES', value: t, type: 'status', expected: 'a LEAVE-kind status from [STATUSES]' });
  });
  // APPROVED_STATUS / EXPIRED_STATUS must be members of STATUS_FLOW (the leave engine writes them onto the tracker).
  ['APPROVED_STATUS', 'EXPIRED_STATUS'].forEach((k) => {
    const v = c.kv.LEAVE[k];
    if (v && !c.kv.LEAVE.STATUS_FLOW.some((f) => norm_(f) === norm_(v))) {
      problems.push({ sev: 'ERROR', code: 'E-103', key: `[LEAVE].${k}`, value: v, type: 'status', expected: 'a value listed in [LEAVE].STATUS_FLOW' });
    }
  });
  // RETURN_STATUS (optional) must be a LEAVE-kind status when set.
  if (c.kv.LEAVE.RETURN_STATUS) {
    const rs = statuses.filter((s) => norm_(s.name) === norm_(c.kv.LEAVE.RETURN_STATUS))[0];
    if (!rs || rs.kind !== 'LEAVE') problems.push({ sev: 'ERROR', code: 'E-103', key: '[LEAVE].RETURN_STATUS', value: c.kv.LEAVE.RETURN_STATUS, type: 'status', expected: 'a LEAVE-kind status from [STATUSES] (or empty)' });
  }

  c.statuses = statuses;
  c.tiers = tiers;
  c.overrides = overrides;
  c.statusRules = statusRules; // v1.0: stateless override matrix (empty = tier ladder alone)
  return { config: c, problems };
}

/* ======================================================================
 * cfg_() — the loading pipeline (brief A4). Memoized per execution.
 * No Config tab → built-in defaults (Phase 1 bound-script mode: the tab
 * is optional until First-Run Setup seeds it; sandboxed tests also run
 * without it). ERROR-level problems → one aggregate E-102.
 * ====================================================================== */

let CFG_ = null;
let CFG_ERROR_ = null; // the failure is memoized too — a broken tab must not re-parse + re-log on every CONFIG read

function cfgInvalidate_() {
  CFG_ = null; CFG_ERROR_ = null;
  // Header-resolved columns depend on config (headerRow, sheet names) — drop them too so a config change can't
  // leave stale column positions cached within the same execution (F-018). Cache lives in RosterSystem.gs.
  try { if (typeof _rosterColCache !== 'undefined') _rosterColCache = {}; } catch (e) { /* absent in isolation */ }
  try { CacheService.getDocumentCache().remove(CFG_CACHE_KEY_); } catch (e) { /* cache is best-effort */ } // cross-execution cache too
}

/**
 * v1.0 PERF — cross-execution config cache. Every panel click / trigger run is a NEW Apps Script execution that
 * would otherwise re-READ the ⚙️ Config tab (the expensive part is the sheet I/O, not validation). We cache the RAW
 * parsed blocks (parseBlocks_ output — pure display-value strings, JSON-safe) in the document cache and re-run
 * validate+materialize on a hit (CPU-only, keeps semantics identical). Invalidation: cfgInvalidate_ (setKvValue_,
 * cpApplyConfig, and the onEdit config-tab hook all call it) removes the entry; the short TTL bounds any missed path.
 */
const CFG_CACHE_KEY_ = 'RE_CFG_RAW_v1';
const CFG_CACHE_TTL_ = 300; // seconds

/**
 * v1.0 PERF — measure-first: wrap an entrypoint; when [LOGGING].PERF_TIMING is TRUE, log its duration to the SYS
 * Log. Never throws, never alters behavior or return values. The flag is read from the ALREADY-LOADED config memo
 * ONLY (checked AFTER fn ran, which loads config for any config-using endpoint) — the wrapper must never FORCE a
 * config load, or a broken config tab would fire E-102 side effects from endpoints that don't even touch config
 * (e.g. cpPing). Config-free endpoints simply aren't timed — they're the trivially fast ones.
 */
function perf_(label, fn) {
  const t0 = Date.now();
  try { return fn(); }
  finally {
    try { if (CFG_ && CFG_.kv && CFG_.kv.LOGGING && CFG_.kv.LOGGING.PERF_TIMING === true) slog_('INFO', 'PERF', 'perf_', `${label} took ${Date.now() - t0}ms`); } catch (e) { /* logging is best-effort */ }
  }
}

/**
 * Fault-tolerant tab-name resolver: the configured name for a [SHEETS] role (key = roster/tracker/form/
 * audit/hoursHistory/coverage/integrity/snapshots), or `fallback` when config is unavailable/blank. Lets the
 * EXTRAS/TRUST tab constants resolve dynamically with zero call-site churn (mirrors the CONFIG bridge).
 */
function cfgSheetName_(key, fallback) {
  try { const nm = cfg_().legacy.sheets[key]; return nm || fallback; } catch (e) { return fallback; }
}

function cfg_() {
  if (CFG_) return CFG_;
  if (CFG_ERROR_) throw CFG_ERROR_;
  let raw = null, sheet = null, fromCache = false;
  try { // cross-execution cache first — skips BOTH the tab lookup and the config-sheet read on a hit
    const hit = CacheService.getDocumentCache().get(CFG_CACHE_KEY_);
    if (hit) { raw = JSON.parse(hit); fromCache = true; }
  } catch (e) { /* cache unavailable/corrupt → fall through to the sheet */ }
  if (!fromCache) {
    sheet = findConfigSheet_();
    raw = sheet ? parseBlocks_(sheet) : {};
    if (sheet) { // only cache a REAL tab's contents — a missing tab must be discovered immediately once created
      try { CacheService.getDocumentCache().put(CFG_CACHE_KEY_, JSON.stringify(raw), CFG_CACHE_TTL_); } catch (e) { /* oversized/unavailable → uncached is fine */ }
    }
  }
  const hasTab = fromCache || !!sheet; // a cached raw always came from a real tab
  const { config, problems } = validateConfig_(raw);
  const errors = problems.filter((p) => p.sev === 'ERROR');
  if (hasTab && errors.length) {
    const list = errors.slice(0, 8).map((p) => `${p.key} = "${p.value}" (want ${p.expected})`).join(' · ');
    const ae = new AppError('E-102', { n: errors.length, list }, { problems: errors.slice(0, 20) });
    slog_('ERROR', 'E-102', 'cfg_', ae.message, ae.ctx);
    maybeErrorWebhook_(ae, 'cfg_'); // once per 5 min (throttled) — a broken config tab is exactly what the errors channel is for
    CFG_ERROR_ = ae;
    throw ae;
  }
  problems.forEach((p) => slog_(p.sev === 'WARN' ? 'WARN' : 'INFO', p.code, 'cfg_', `${p.key} = "${p.value}" — expected ${p.expected}`));
  CFG_ = materialize_(config, hasTab);
  return CFG_;
}

/** Build the final typed config object, including the `.legacy` view shaped exactly like the classic CONFIG. */
function materialize_(c, fromTab) {
  const kv = c.kv;
  const N = kv.NOTIFICATIONS || {};   // v1.0 event-notification toggles (guarded — absent on a older config)
  const P = kv.PATROL || {};          // v1.0 patrol-log → hours settings (guarded — absent on a older config)
  const t = kv.THEME;
  const statusNames = c.statuses.map((s) => s.name);
  const protectedStatuses = c.statuses.filter((s) => s.kind === 'LEAVE' || s.kind === 'PROTECTED').map((s) => s.name);
  const tierOf = (name) => { const hit = c.tiers.filter((x) => norm_(x.name) === norm_(name))[0]; return hit ? hit.min : null; };

  // Unique-ID switch: DISCORD (17-19) | COMMUNITY (1-8) | CUSTOM (the ID_MIN/MAX_DIGITS range). Drives isValidId_.
  const idType = norm_(kv.ROSTER_LAYOUT.ID_TYPE || 'DISCORD');
  const idRange = idType === 'COMMUNITY' ? { min: 1, max: 8 }
                : idType === 'CUSTOM'    ? { min: kv.ROSTER_LAYOUT.ID_MIN_DIGITS || 1, max: kv.ROSTER_LAYOUT.ID_MAX_DIGITS || 19 }
                :                          { min: 17, max: 19 }; // DISCORD (default)

  // Legacy slotKeywords = every Match keyword of SLOT-classed role rows (defaults: RANK, UNIT, CALLSIGN).
  const slotKeywords = [];
  c.tables.COLUMNS.forEach((r) => {
    if (r.Role !== '' && norm_(r.Class) === 'SLOT') String(r.Match).split(',').forEach((kw) => { const k = norm_(kw); if (k && slotKeywords.indexOf(k) === -1) slotKeywords.push(k); });
  });

  // Dashboard groups/cells from their table blocks.
  const groups = {};
  c.tables.DASHBOARD_GROUPS.forEach((r) => { if (r.Group) groups[r.Group] = String(r.Categories).split(',').map((x) => x.trim()).filter(Boolean); });
  const cells = c.tables.DASHBOARD_CELLS.filter((r) => r.Label).map((r) => ({ label: r.Label, dir: (norm_(r.Dir) === 'BELOW' ? 'below' : 'right'), stat: r.Stat }));

  // Per-event Discord embed templates (the Settings Studio's builder writes valid JSON; a hand-broken row is ignored).
  const embedTpl = {};
  (c.tables.EMBEDS || []).forEach((r) => {
    const ev = String(r.Event || '').trim(); if (!ev) return;
    try { const o = JSON.parse(String(r.Json || '')); if (o && typeof o === 'object') embedTpl[ev] = o; } catch (e) { /* ignored */ }
  });

  const sectionCategories = c.tables.SECTION_TAGS.filter((r) => r.Label).map((r) => ({
    label: r.Label, keywords: String(r.Keywords).split(',').map((x) => norm_(x)).filter(Boolean), tone: r.Tone || 'aux',
  }));

  // v1.0 — explicit rank/divider list (normalized) consulted when DIVIDER_MODE = EXPLICIT_LIST.
  const rankList = { ranks: [], dividers: [], trainingRanks: [] };
  c.tables.RANKS.forEach((r) => {
    const val = String(r.Value || '').trim();
    if (!val) return;
    const kind = norm_(r.Kind);
    if (kind === 'DIVIDER') rankList.dividers.push(norm_(val));
    else if (kind === 'TRAINING') { rankList.ranks.push(norm_(val)); rankList.trainingRanks.push(val); } // a member rank ALSO flagged for the Police Academy (read regardless of DIVIDER_MODE)
    else if (kind === 'RANK') rankList.ranks.push(norm_(val));
  });

  const legacy = {
    systemName: kv.SYSTEM.SYSTEM_NAME,
    pingRoles: kv.DISCORD.PING_ROLES,
    webhookProp: 'DISCORD_WEBHOOK_URL', // engine constant (brief A6) — secrets live in Script Properties
    // v1.0 — configurable logic (unit-number format, date formats, embed appearance, retention limits).
    unitFormat: kv.ROSTER_LAYOUT.UNIT_FORMAT || 'S-{00}',
    lastActivityStyle: kv.ROSTER_LAYOUT.LAST_ACTIVITY_STYLE || 'MATCH', // v1.0: MATCH mirrors CURRENT ACTIVITY colours, NEUTRAL = calm grey
    formats: { date: kv.FORMATS.DATE_DISPLAY || 'd MMM. yyyy', timestamp: kv.FORMATS.TIMESTAMP_DISPLAY || 'd MMM yyyy, h:mm a' },
    embed: {
      submitColor: kv.DISCORD.SUBMIT_COLOR || '#3498db', returnColor: kv.DISCORD.RETURN_COLOR || '#e67e22', expireColor: kv.DISCORD.EXPIRE_COLOR || '#ed4245',
      submitTitle: kv.DISCORD.SUBMIT_TITLE || '📥 New {type} Submission', expireTitle: kv.DISCORD.EXPIRE_TITLE || '⏳ {type} Expired',
      authorName: kv.DISCORD.EMBED_AUTHOR || '', authorIcon: kv.DISCORD.EMBED_AUTHOR_ICON || '', // v1.0 embed-body chrome (all blank by default)
      thumbnail: kv.DISCORD.EMBED_THUMBNAIL || '', image: kv.DISCORD.EMBED_IMAGE || '',
      footerText: kv.DISCORD.EMBED_FOOTER || '', footerIcon: kv.DISCORD.EMBED_FOOTER_ICON || '',
    },
    notify: { // v1.0 event notifications — all default off
      memberAdded: N.MEMBER_ADDED === true, memberAddedTitle: N.MEMBER_ADDED_TITLE || '➕ {name} joined the roster', memberAddedColor: N.MEMBER_ADDED_COLOR || '#57b85a',
      transfer: N.TRANSFER === true, transferTitle: N.TRANSFER_TITLE || '🔄 {name} — {from} → {to}', transferColor: N.TRANSFER_COLOR || '#5865f2',
      leaveApproved: N.LEAVE_APPROVED === true, approvedTitle: N.LEAVE_APPROVED_TITLE || '✅ {type} Approved', approvedColor: N.LEAVE_APPROVED_COLOR || '#57b85a',
      leaveStarted: N.LEAVE_STARTED === true, startedTitle: N.LEAVE_STARTED_TITLE || '▶️ {type} Started', startedColor: N.LEAVE_STARTED_COLOR || '#4ea7d6',
      weeklyDigest: N.WEEKLY_DIGEST === true, digestTitle: N.WEEKLY_DIGEST_TITLE || '📊 Weekly Roster Summary', digestColor: N.WEEKLY_DIGEST_COLOR || '#5865f2',
      patrolLogged: N.PATROL_LOGGED === true, patrolTitle: N.PATROL_LOGGED_TITLE || '🚔 {name} logged {hours}h of patrol', patrolColor: N.PATROL_LOGGED_COLOR || '#4ea7d6',
    },
    limits: { snapshotKeep: kv.LIMITS.SNAPSHOT_KEEP, logRowCap: kv.LIMITS.LOG_ROW_CAP, validationBuffer: kv.LIMITS.VALIDATION_BUFFER },
    patrol: { // v1.0 patrol-log → hours (all default; feature OFF until sheets.patrol is set)
      mode: P.MODE || 'START_END', maxHours: P.MAX_HOURS || 16, overnight: P.OVERNIGHT !== false, recompute: P.RECOMPUTE !== false,
      colDiscord: P.COL_DISCORD || 'Discord', colCallsign: P.COL_CALLSIGN || 'Callsign',
      colStart: P.COL_START || 'Start', colEnd: P.COL_END || 'End', colDuration: P.COL_DURATION || 'Hours',
      // Manual Patrol Log tab statuses (sort order + the flagged/processed names).
      statusFlow: (P.STATUS_FLOW && P.STATUS_FLOW.length) ? P.STATUS_FLOW : ['Pending', 'Flagged', 'Processed'],
      pendingStatus: (P.STATUS_FLOW && P.STATUS_FLOW.length ? P.STATUS_FLOW[0] : 'Pending'),
      flaggedStatus: P.FLAGGED_STATUS || 'Flagged',
      processedStatus: P.PROCESSED_STATUS || 'Processed',
    },
    sheets: {
      roster: kv.SHEETS.ROSTER, tracker: kv.SHEETS.TRACKER, form: kv.SHEETS.FORM_RESPONSES, patrol: kv.SHEETS.PATROL_RESPONSES || '',
      patrolLog: kv.SHEETS.PATROL_LOG || '',   // manual Patrol Log tracker tab (blank = OFF; only activates if the tab exists)
      signups: kv.SHEETS.SIGNUPS || 'Roster Signups', // signup REVIEW/destination tab (engine fills it from the form)
      signupForm: kv.SHEETS.SIGNUP_FORM_RESPONSES || '', // the signup Google Form's own responses tab (blank = signup sync OFF)
      // v1.0 — system/log tab names (blank falls back to the shipped default so older configs keep working).
      audit: kv.SHEETS.AUDIT || 'Edit Log',
      hoursHistory: kv.SHEETS.HOURS_HISTORY || '_Hours History',
      coverage: kv.SHEETS.COVERAGE || 'Leave Coverage',
      integrity: kv.SHEETS.INTEGRITY || 'Integrity Log',
      snapshots: kv.SHEETS.SNAPSHOTS || '_Snapshots',
    },
    rosterStartRow: kv.ROSTER_LAYOUT.DATA_START_ROW,
    trackerStartRow: kv.ROSTER_LAYOUT.TRACKER_START_ROW,
    patrolStartRow: kv.ROSTER_LAYOUT.PATROL_START_ROW || 8,
    headerRow: kv.ROSTER_LAYOUT.HEADER_ROW,
    idType: idType,                 // 'DISCORD' | 'COMMUNITY' | 'CUSTOM' — the department's Unique-ID switch
    idMinDigits: idRange.min,       // accepted Unique ID length range, derived from ID_TYPE (isValidId_ reads these)
    idMaxDigits: idRange.max,
    roster: { rank: 2, name: 3, unit: 4, discord: 5, activity: 8, hours: 9 },        // positional FALLBACKS only (header resolution wins)
    tracker: { key: 1, rank: 2, unit: 3, ooc: 4, name: 5, discord: 6, shift: 7, start: 8, end: 9, length: 10, untilStart: 11, timeLeft: 12, returnDate: 13, status: 14, approvedBy: 15, notes: 16 }, // LOA Tracker layout: A key · B rank · C unit · D OOC · E name · F unique-ID · G shift · H start · I end · J len · K until · L left · M return · N status · O approved-by · P notes (LOA-only — no TYPE column)
    form: { timestamp: 1, name: 2, discord: 3, callsign: 4, rank: 5, type: 6, start: 7, end: 8 },
    bg: { processing: t.PROCESSING, done: t.PASS, error: t.FAIL },
    protectedStatuses,
    // ---- Config-driven status vocabulary (single source of truth; hot paths must read these, not literals) ----
    leaveTypes: kv.LEAVE.LEAVE_TYPES.slice(),                                    // e.g. ['LOA','ROA'] — members on leave
    statusFlow: kv.LEAVE.STATUS_FLOW.slice(),                                    // tracker dropdown values
    pendingStatus: kv.LEAVE.STATUS_FLOW[0] || 'Pending',                         // default tracker status on sync
    approvedStatus: kv.LEAVE.APPROVED_STATUS || 'Approved',                      // the state the nightly job acts on
    expiredStatus: kv.LEAVE.EXPIRED_STATUS || 'Expired',                         // written when a leave END passes
    returnStatus: kv.LEAVE.RETURN_STATUS || '',                                  // ROA-style auto-downgrading leave ('' = none)
    tiers: c.tiers.map((x) => ({ name: x.name, min: x.min })),                   // TIER statuses, sorted high→low by MinHours
    tierNames: c.tiers.map((x) => x.name),
    // Thresholds resolve by tier NAME (back-compat), falling back to tier POSITION when a community renames the
    // shipped tiers — so 'active' always tracks the highest tier's MinHours and 'semi' the second-highest.
    thresholds: {
      active: tierOf('Active') != null ? tierOf('Active') : (c.tiers[0] ? c.tiers[0].min : 10),
      semi: tierOf('Semi-Active') != null ? tierOf('Semi-Active') : (c.tiers[1] ? c.tiers[1].min : 5),
      auxActive: 5,
    },
    trainingDividers: kv.ROSTER_LAYOUT.TRAINING_KEYWORDS.map((k) => norm_(k)),
    sectionCategories,
    dividerMode: kv.ROSTER_LAYOUT.DIVIDER_MODE,                                  // v1.0: ALLCAPS_RANK | EXPLICIT_LIST
    rankList,                                                                    // v1.0: {ranks:[NORM], dividers:[NORM]} — for EXPLICIT_LIST mode
    columns: { configSheet: '_Columns', slotKeywords, trainingCheckboxCols: [] }, // configSheet retained for the one-time import
    dashboard: { searchRows: kv.DASHBOARD.SEARCH_ROWS, groups, cells },
    embedTpl,
  };

  return {
    fromTab,
    kv,
    tables: c.tables,
    statuses: c.statuses,
    statusNames,
    tiers: c.tiers,
    overrides: c.overrides,
    rules: (c.statusRules || []).slice(),  // v1.0: stateless status-transition matrix
    leave: kv.LEAVE,
    logging: { level: kv.LOGGING.LOG_LEVEL, maxRows: kv.LOGGING.LOG_MAX_ROWS },
    theme: kv.THEME,
    dashboardEnabled: kv.DASHBOARD.ENABLE,
    legacy,
  };
}

/* ======================================================================
 * STATUS LADDERS — [STATUSES] tiers + [STATUS_OVERRIDES] (resolved B1).
 * computeStatusCore_ is pure/injectable; computeStatus_ (RosterSystem.gs)
 * delegates here with the live engine.
 * ====================================================================== */

/** @return {{global:Array<{name,min}>, overrides:Array<{scope,match,ladder}>, rules:Array<{source,op,hours,target}>}} */
function statusEngine_() {
  const v = cfg_();
  return { global: v.tiers.map((t) => ({ name: t.name, min: t.min })), overrides: v.overrides, rules: (v.rules || []).slice() };
}

/** Pick the ladder for a rank: first RANK-scope override whose Match equals the rank (norm_), else the global tiers. */
function statusLadderFor_(rank, engine) {
  const e = engine || statusEngine_();
  const key = norm_(rank);
  for (let i = 0; i < e.overrides.length; i++) {
    const o = e.overrides[i];
    if (o.scope === 'RANK' && norm_(o.match) === key) return o.ladder;
  }
  return e.global;
}

/** True if an hours value satisfies a [STATUS_RULES] operator against its threshold. */
function statusOpMatch_(op, hrs, threshold) {
  switch (op) {
    case '*': return true;
    case '<': return hrs < threshold;
    case '<=': return hrs <= threshold;
    case '>': return hrs > threshold;
    case '>=': return hrs >= threshold;
    case '==': return hrs === threshold;
    default: return false;
  }
}

/**
 * Apply the STATELESS [STATUS_RULES] override matrix to a tier-computed status. Rules are evaluated
 * first-match-wins and iterated to a FIXED POINT, so the result is a pure function of (status, hours): running it
 * again yields the same status (idempotent — never a per-run "strike"). A cycle can't hang the run: each status is
 * visited at most once (the `seen` guard), so evaluation always terminates. Empty rules → status returned unchanged.
 */
function applyStatusRules_(status, hours, rules) {
  if (!rules || !rules.length) return status;
  const hrs = parseFloat(hours) || 0;
  let cur = status;
  const seen = {};
  while (true) {
    const key = norm_(cur);
    if (seen[key]) break;   // revisiting a status → stop (cycle / fixed-point guard; keeps it terminating + idempotent)
    seen[key] = true;
    let moved = false;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.source !== '*' && r.source !== key) continue;     // Source filter (norm_ names; * = any)
      if (!statusOpMatch_(r.op, hrs, r.hours)) continue;      // hours condition
      if (norm_(r.target) === key) continue;                 // a self-target rule is a no-op
      cur = r.target; moved = true; break;                   // first match wins
    }
    if (!moved) break;                                       // no rule fired → fixed point reached
  }
  return cur;
}

/**
 * Pure status computation: the highest ladder tier whose threshold is met (ladders are sorted desc; exactly one 0
 * floor), then the stateless [STATUS_RULES] override matrix layered on top. On defaults ([STATUS_RULES] empty) this
 * is byte-identical to the tier-only result.
 */
function computeStatusCore_(rank, hours, engine) {
  const e = engine || statusEngine_();
  const hrs = parseFloat(hours) || 0;
  const ladder = statusLadderFor_(rank, e);
  let status = ladder.length ? ladder[ladder.length - 1].name : 'Inactive';
  for (let i = 0; i < ladder.length; i++) { if (hrs >= ladder[i].min) { status = ladder[i].name; break; } }
  return applyStatusRules_(status, hrs, e.rules); // v1.0: stateless override matrix (no-op when empty)
}

/* ======================================================================
 * SEEDING — creates/repairs the ⚙️ Config tab. IDEMPOTENT and ADDITIVE:
 * existing values are preserved; only missing blocks/keys/roles are added
 * (brief A5 — migrations never destroy user data).
 * ====================================================================== */

/** @return {{created:boolean, added:number}} */
function seedConfigTab_(ss) {
  const s = ss || SpreadsheetApp.getActive();
  let sheet = findConfigSheet_(s);
  const created = !sheet;
  if (!sheet) sheet = s.insertSheet(CONFIG_SHEET_NAME);
  const existing = parseBlocks_(sheet); // preserve every user value; only missing keys/blocks get defaults
  let added = 0;

  const W = 5; // widest table block
  // F-014: clear ONLY the core A-E grid we rebuild — NOT sheet.clear(), which also destroys the user's extra
  // columns (F onward), their notes, formats, and validations. Everything past column E is preserved untouched.
  const region = sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 1), W);
  region.clearContent(); region.clearFormat(); region.clearNote(); region.clearDataValidations();

  // Build the full grid in memory (values only), remembering which rows are banners / table headers.
  const grid = [];   // rows of length W
  const banners = []; // 1-based row numbers to paint as block banners
  const subheads = []; // 1-based row numbers to paint as table headers
  const pad = (arr) => { const row = arr.slice(0, W).map((x) => String(x == null ? '' : x)); while (row.length < W) row.push(''); return row; };

  grid.push(pad([CONFIG_MARKER, `Roster Engine ${ENGINE_VERSION} configuration — edit column B values / table cells. Column C is help.`]));
  banners.push(1);
  grid.push(pad([]));

  BLOCK_ORDER_.forEach((name) => {
    const spec = BLOCK_SPECS_[name];
    grid.push(pad([`[${name}]`, '', spec.help || '']));
    banners.push(grid.length);
    if (spec.type === 'kv') {
      const have = (existing[name] && existing[name].kv) || {};
      Object.keys(spec.keys).forEach((key) => {
        const k = spec.keys[key];
        let val;
        if (Object.prototype.hasOwnProperty.call(have, key)) val = have[key];
        else { val = (k.t === 'bool') ? (k.d ? 'TRUE' : 'FALSE') : String(k.d); added++; }
        grid.push(pad([key, val, k.help || '']));
      });
      Object.keys(have).forEach((key) => { if (!spec.keys[key]) grid.push(pad([key, have[key], '(unknown key — preserved)'])); });
    } else {
      grid.push(pad(spec.cols));
      subheads.push(grid.length);
      const have = (existing[name] && existing[name].kind === 'table') ? existing[name].rows : null;
      const dataRows = (have && have.length) ? have : spec.seed;
      if (!have) added += dataRows.length;
      dataRows.forEach((row) => grid.push(pad(row)));
    }
    grid.push(pad([]));
  });

  // One bulk write, then theme: canvas + text first, banner/subhead overrides after.
  sheet.getRange(1, 1, grid.length, W).setValues(grid);
  const all = sheet.getRange(1, 1, grid.length, W);
  all.setNumberFormat('@'); // text-safety rule (brief Part D) — keeps hex colors, TRUE/FALSE, and big IDs literal
  all.setBackground(theme_('CANVAS')).setFontColor(theme_('TEXT')).setFontFamily('Roboto Mono').setFontSize(10);
  banners.forEach((r) => sheet.getRange(r, 1, 1, W).setBackground(theme_('BANNER')).setFontColor(theme_('TEXT_STRONG')).setFontWeight('bold'));
  subheads.forEach((r) => sheet.getRange(r, 1, 1, W).setBackground(theme_('SUBHEAD')).setFontColor(theme_('SUBHEAD_TEXT')).setFontWeight('bold'));
  sheet.setColumnWidth(1, 190); sheet.setColumnWidth(2, 260); sheet.setColumnWidth(3, 430); sheet.setColumnWidth(4, 150); sheet.setColumnWidth(5, 120);
  sheet.setFrozenRows(1);
  try {
    const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    if (!protections.length) sheet.protect().setWarningOnly(true).setDescription('Roster Engine configuration — edits take effect on the next action.');
  } catch (e) { /* protection is best-effort */ }
  cfgInvalidate_();
  SpreadsheetApp.flush();
  return { created, added };
}

/**
 * Set/insert a header's SLOT|MEMBER class row in the [COLUMNS] block of the given
 * Config sheet (injectable — tests pass a sandbox tab). Role rows are never touched:
 * classes for extra headers live in blank-Role rows keyed by exact header text.
 * The panel's cpSetColumnClass_ delegates here.
 * @return {string} the class written.
 */
function setColumnClassRow_(configSheet, header, klass) {
  const h = String(header || '').trim();
  const k = norm_(klass);
  if (!h) throw new Error('No column specified.');
  if (k !== 'SLOT' && k !== 'MEMBER') throw new Error('Class must be SLOT or MEMBER.');
  const lastRow = configSheet.getLastRow();
  const colA = configSheet.getRange(1, 1, lastRow, 1).getDisplayValues();
  let markerRow = 0;
  for (let i = 0; i < colA.length; i++) { if (String(colA[i][0]).trim() === '[COLUMNS]') { markerRow = i + 1; break; } }
  if (!markerRow) throw new Error(`No [COLUMNS] block on "${configSheet.getName()}" — run 🚀 First-Run Setup.`);
  const headerRow = markerRow + 1;              // the Role|Match|Class|Required table header
  let end = headerRow;                          // last data row of the block
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const rowVals = configSheet.getRange(r, 1, 1, 4).getDisplayValues()[0];
    if (rowVals.every((x) => String(x).trim() === '')) break;
    if (/^\[[A-Z_]+\]$/.test(String(rowVals[0]).trim())) break; // next block marker — a hand-deleted separator must not let the walk bleed into it
    end = r;
    // Update an existing blank-Role class row for this exact header.
    if (String(rowVals[0]).trim() === '' && norm_(rowVals[1]) === norm_(h)) {
      configSheet.getRange(r, 3).setValue(k);
      cfgInvalidate_();
      return k;
    }
  }
  configSheet.insertRowAfter(end);
  configSheet.getRange(end + 1, 1, 1, 4).setValues([['', h, k, '']]).setNumberFormat('@');
  cfgInvalidate_();
  return k;
}

/**
 * One-time fold (brief Part E): import SLOT/MEMBER classifications from the legacy
 * hidden "_Columns" tab into the [COLUMNS] block, then hide the old tab.
 * Idempotent: rows already covered in [COLUMNS] are left alone.
 * @return {number} classifications imported.
 */
function importColumnsFromHiddenTab_(ss) {
  const s = ss || SpreadsheetApp.getActive();
  const legacyTab = s.getSheetByName('_Columns');
  const configSheet = findConfigSheet_(s);
  if (!legacyTab || !configSheet || legacyTab.getLastRow() < 2) return 0;
  const v = legacyTab.getRange(2, 1, legacyTab.getLastRow() - 1, 3).getDisplayValues(); // Column | Header | Class
  let imported = 0;
  const cv = cfg_();               // parse ONCE (each setColumnClassRow_ invalidates the memo — re-parsing per row was O(n²))
  const written = {};              // headers written THIS run (replaces the per-row re-parse as the intra-run dedupe)
  v.forEach((row) => {
    const header = String(row[1]).trim();
    const klass = norm_(row[2]) === 'USER' ? 'MEMBER' : norm_(row[2]);
    if (!header || (klass !== 'SLOT' && klass !== 'MEMBER')) return;
    if (written[norm_(header)]) return;
    // Skip headers already covered: a role row whose keyword matches with the same class, or an existing class row.
    const covered = cv.tables.COLUMNS.some((r) => (r.Role !== '' && String(r.Match).split(',').some((kw) => norm_(kw) && norm_(header).indexOf(norm_(kw)) !== -1) && norm_(r.Class) === klass)
      || (r.Role === '' && norm_(r.Match) === norm_(header)));
    if (covered) return;
    setColumnClassRow_(configSheet, header, klass);
    written[norm_(header)] = true;
    imported++;
  });
  try { legacyTab.hideSheet(); } catch (e) { /* already hidden */ }
  return imported;
}

/**
 * Set ONE kv value inside a block on the given Config sheet (injectable). Finds the [BLOCK] marker, walks its
 * kv rows (col A = key) until the blank separator or the next marker, and updates col B — or inserts the key
 * at the end of the block if missing. Used by migrations and the wizard (e.g. writing the real form-response
 * tab name into [SHEETS].FORM_RESPONSES). @return {boolean} true if written.
 */
function setKvValue_(configSheet, blockName, key, value) {
  const lastRow = configSheet.getLastRow();
  const colA = configSheet.getRange(1, 1, lastRow, 1).getDisplayValues();
  let markerRow = 0;
  for (let i = 0; i < colA.length; i++) { if (String(colA[i][0]).trim() === `[${blockName}]`) { markerRow = i + 1; break; } }
  if (!markerRow) return false;
  let end = markerRow;
  for (let r = markerRow + 1; r <= lastRow; r++) {
    const a = String(colA[r - 1][0]).trim();
    if (a === '' || /^\[[A-Z_]+\]$/.test(a)) break;
    if (norm_(a).replace(/ /g, '_') === norm_(key).replace(/ /g, '_')) {
      configSheet.getRange(r, 2).setValue(String(value));
      cfgInvalidate_();
      return true;
    }
    end = r;
  }
  configSheet.insertRowAfter(end);
  configSheet.getRange(end + 1, 1, 1, 3).setValues([[String(key), String(value), '(added by migration)']]).setNumberFormat('@');
  cfgInvalidate_();
  return true;
}

/**
 * Replace ALL data rows of a TABLE block on the given Config sheet (injectable — the panel's Settings tab
 * writes [STATUSES]/[STATUS_OVERRIDES] through here). Walks from the [BLOCK] marker past the column-header
 * row, resizes the data region (insert/delete rows INSIDE the block only — the blank separator and every
 * following block are untouched), and writes the new rows text-formatted. Same boundary rules as its
 * siblings setKvValue_/setColumnClassRow_: a next-block marker terminates the walk even if the blank
 * separator was hand-deleted.
 * @param {Sheet} configSheet  @param {string} blockName  @param {Array<Array>} rows data rows (no header)
 * @return {number} rows written.
 */
function setTableRows_(configSheet, blockName, rows) {
  const spec = BLOCK_SPECS_[blockName];
  if (!spec || spec.type !== 'table') throw new Error(`[${blockName}] is not a table block.`);
  if (!Array.isArray(rows) || rows.some((r) => !Array.isArray(r))) throw new Error('Rows must be an array of arrays.');
  const W = 5; // grid width (widest block)
  const lastRow = configSheet.getLastRow();
  const colA = configSheet.getRange(1, 1, lastRow, 1).getDisplayValues();
  let markerRow = 0;
  for (let i = 0; i < colA.length; i++) { if (String(colA[i][0]).trim() === `[${blockName}]`) { markerRow = i + 1; break; } }
  if (!markerRow) throw new Error(`No [${blockName}] block on "${configSheet.getName()}" — run 🚀 First-Run Setup.`);
  const headerRow = markerRow + 1;   // the block's column-header row
  const dataStart = headerRow + 1;
  let oldCount = 0;                  // existing data rows
  for (let r = dataStart; r <= lastRow; r++) {
    const rowVals = configSheet.getRange(r, 1, 1, W).getDisplayValues()[0];
    if (rowVals.every((x) => String(x).trim() === '')) break;               // blank separator = end of block
    if (/^\[[A-Z_]+\]$/.test(String(rowVals[0]).trim())) break;             // next marker (separator hand-deleted)
    oldCount++;
  }
  const newCount = rows.length;
  if (oldCount > newCount) {
    configSheet.deleteRows(dataStart + newCount, oldCount - newCount);
  } else if (newCount > oldCount) {
    // insert after the last existing data row (or the header when the block is empty) — never past the separator
    configSheet.insertRowsAfter(headerRow + oldCount, newCount - oldCount);
  }
  if (newCount > 0) {
    const pad = (arr) => { const row = arr.slice(0, W).map((x) => String(x == null ? '' : x)); while (row.length < W) row.push(''); return row; };
    const range = configSheet.getRange(dataStart, 1, newCount, W);
    range.setNumberFormat('@'); // text-safety rule (brief Part D) — hex colors, TRUE/FALSE, big IDs stay literal
    range.setValues(rows.map(pad));
    range.setBackground(theme_('CANVAS')).setFontColor(theme_('TEXT')).setFontWeight('normal');
  }
  cfgInvalidate_();
  return newCount;
}

/**
 * Schema migration (brief A5): additive, non-destructive, version-stamped.
 *   • seedConfigTab_ IS the additive step — missing blocks/keys appear with defaults, user values untouched.
 *   • MIGRATIONS_ holds ordered per-version steps for future schema bumps (renames/copies — never deletes).
 *   • Afterwards SCHEMA_VERSION is stamped to ENGINE_SCHEMA and the migration is logged.
 * Sheet NEWER than engine is not handled here — validateConfig_ raises E-104 and the engine stays read-only.
 * @return {{created:boolean, added:number, from:number, to:number}}
 */
const MIGRATIONS_ = Object.freeze({
  // v2 (schema 1→2, v1.0): [SHEETS] system-tab names, [SCHEDULE] cadence keys, [STATUS_RULES] + [RANKS] blocks.
  // All ADDITIVE with back-compat defaults, so the additive seed (seedConfigTab_, run right after this) does the
  // whole migration — there is no user data to move or rename. This step exists to satisfy the "every schema bump
  // has a migration step" invariant and to leave a breadcrumb in the SYS Log.
  2: function (configSheet) { logInfo_('migrateConfig_', 'schema v2: additive blocks/keys are added by the seed (no data migration needed).'); },
  // 3: function (configSheet) { … }   ← future: steps keyed by the version they migrate TO.
});

function migrateConfig_(ss) {
  const s = ss || SpreadsheetApp.getActive();
  const before = findConfigSheet_(s);
  let from = ENGINE_SCHEMA;
  if (before) {
    const raw = parseBlocks_(before);
    from = parseInt((raw.SYSTEM && raw.SYSTEM.kv && raw.SYSTEM.kv.SCHEMA_VERSION) || ENGINE_SCHEMA, 10) || ENGINE_SCHEMA;
    // F-030: run migration steps BEFORE the additive seed, on the EXISTING tab. A v→v+1 rename must move the user's
    // value onto the new key first; otherwise seed adds the new key with its default and the old value is stranded.
    for (let v = from + 1; v <= ENGINE_SCHEMA; v++) {
      if (typeof MIGRATIONS_[v] === 'function') { MIGRATIONS_[v](before); logInfo_('migrateConfig_', `applied schema step → v${v} (pre-seed).`); }
    }
  }
  const seed = seedConfigTab_(s);
  const sheet = findConfigSheet_(s);
  if (from < ENGINE_SCHEMA) {
    setKvValue_(sheet, 'SYSTEM', 'SCHEMA_VERSION', ENGINE_SCHEMA);
    logInfo_('migrateConfig_', `config schema migrated v${from} → v${ENGINE_SCHEMA} (additive; nothing deleted).`);
  } else {
    setKvValue_(sheet, 'SYSTEM', 'SCHEMA_VERSION', ENGINE_SCHEMA); // fresh tab: stamp the current schema
  }
  cfgInvalidate_();
  return { created: seed.created, added: seed.added, from, to: ENGINE_SCHEMA };
}

/** Closest live tab name to a missing one (for the E-201 hint) — normalized containment, then shared-prefix length. */
function closestSheetName_(missing) {
  try {
    const want = norm_(missing);
    const names = SpreadsheetApp.getActive().getSheets().map((s) => s.getName());
    let best = '', bestScore = 0;
    names.forEach((n) => {
      const have = norm_(n);
      let score = 0;
      if (have === want) score = 999;
      else if (have.indexOf(want) !== -1 || want.indexOf(have) !== -1) score = 500 + Math.min(have.length, want.length);
      else { let i = 0; while (i < Math.min(have.length, want.length) && have[i] === want[i]) i++; score = i; }
      if (score > bestScore) { bestScore = score; best = n; }
    });
    return best || '(none)';
  } catch (e) { return '(unknown)'; }
}
