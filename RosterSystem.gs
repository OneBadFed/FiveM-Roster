/**
 * ============================================================================
 * ROSTER SYSTEM — core automation for a personnel roster in Google Sheets.
 * ----------------------------------------------------------------------------
 * Automates member activity status, LOA/ROA leave scheduling, and Discord
 * notifications. Single-file by design: every function is global so the menu
 * and installable triggers (which reference functions by name) keep working.
 *
 * TABS (names must match exactly):
 *   CONFIG.sheets.roster   — master roster   (headers row 5, data from row 7)
 *   CONFIG.sheets.tracker  — leave dashboard (headers row 5, data from row 6)
 *   CONFIG.sheets.form     — raw form feed   (headers row 1, data from row 2)
 *
 * SETUP (once):
 *   1. Paste this file, save.
 *   2. Run setWebhookUrl() once with your Discord webhook (then clear it).
 *   3. Run installTriggers() to create the form-submit + daily-check triggers.
 *   4. Reload the sheet for the "📋 Roster" menu.
 *
 * DESIGN NOTES:
 *   • Discord IDs are TEXT — 17-19 digits exceed JS's safe-integer range, so
 *     reads use getDisplayValues() and all comparisons are trimmed strings.
 *   • Business logic lives in injectable "_" cores (processDailyLOAs_,
 *     syncFormToTracker_) that take sheets + options, so they can be unit-tested
 *     against throwaway tabs without touching live data.
 *   • UI alerts live in entrypoints, never in the cores.
 * ============================================================================
 */

/**
 * CONFIGURATION — Phase 1 (Roster Engine): the classic CONFIG object is now a
 * BRIDGE into the schema-driven config layer (RosterConfig.gs). Every existing
 * `CONFIG.<x>` read resolves through cfg_().legacy:
 *   • no ⚙️ Config tab  → built-in defaults (BLOCK_SPECS_ seeds) — behavior is
 *     byte-identical to the old hardcoded object ("unchanged on defaults").
 *   • ⚙️ Config tab present → parsed + validated values from the tab.
 * To change a setting, edit the ⚙️ Config tab (or BLOCK_SPECS_ seeds in
 * RosterConfig.gs for shipped defaults) — not this file.
 * defineProperty is configurable:true + try/catch so a duplicate paste of this
 * file can never brick startup.
 */
try {
  Object.defineProperty(globalThis, 'CONFIG', { configurable: true, get: function () { return cfg_().legacy; } });
} catch (e) { console.error('CONFIG bridge install failed: ' + e); }

const DISCORD_ID_RE = /^\d{17,19}$/; // STRICT Discord snowflake — used ONLY to gate @mention pings (see mention_)

/**
 * Validates a member Unique ID against the CONFIGURED digit range ([ROSTER_LAYOUT].ID_MIN_DIGITS…ID_MAX_DIGITS).
 * Default 17-19 (a Discord ID); set the range to e.g. 1-8 for a short Community/CID. Digits only; blank is invalid.
 * This — not DISCORD_ID_RE — is the identity check used everywhere a Unique ID is accepted (roster, tracker, form).
 * @mention pings deliberately keep the strict Discord test, because a short Community ID isn't a pingable snowflake.
 */
function isValidId_(id) {
  const s = String(id == null ? '' : id).trim();
  if (!/^\d+$/.test(s)) return false;
  let lo = 17, hi = 19;
  try { if (CONFIG.idMinDigits) lo = CONFIG.idMinDigits; if (CONFIG.idMaxDigits) hi = CONFIG.idMaxDigits; } catch (e) {}
  return s.length >= lo && s.length <= hi;
}

/** Human label for the accepted ID length, e.g. "17-19" or "8" (used in operator-facing messages). */
function idDigitsLabel_() {
  let lo = 17, hi = 19;
  try { if (CONFIG.idMinDigits) lo = CONFIG.idMinDigits; if (CONFIG.idMaxDigits) hi = CONFIG.idMaxDigits; } catch (e) {}
  return lo === hi ? String(lo) : (lo + '-' + hi);
}

/** Regex SOURCE (for a Sheets/Forms REGEXMATCH rule) that accepts the configured ID digit range. */
function idRegexSource_() {
  let lo = 17, hi = 19;
  try { if (CONFIG.idMinDigits) lo = CONFIG.idMinDigits; if (CONFIG.idMaxDigits) hi = CONFIG.idMaxDigits; } catch (e) {}
  return '^\\d{' + lo + ',' + hi + '}$';
}

/* ======================================================================
 * HEADER-BASED COLUMN RESOLUTION
 * Resolves the roster's key columns by their HEADER NAME (the configured HEADER_ROW) so columns
 * can be reordered without breaking the code. Falls back to the CONFIG.roster
 * positions when a header can't be matched. Cached per sheet for the execution.
 * ====================================================================== */
// Bridged like CONFIG: [ROSTER_LAYOUT].HEADER_ROW on the ⚙️ Config tab (default 5).
try {
  Object.defineProperty(globalThis, 'ROSTER_HEADER_ROW', { configurable: true, get: function () { return cfg_().legacy.headerRow; } });
} catch (e) { console.error('ROSTER_HEADER_ROW bridge install failed: ' + e); }
let _rosterColCache = {};

/** @return {{rank,name,unit,discord,join,promo,activity,hours,ooc,shift,mayHours,junHours,timeInRank,headerRow}} resolved 1-based columns (optional ones are 0 when absent; headerRow = the row labels were read from). */
function rosterCols_(sheet) {
  const id = (sheet && sheet.getSheetId) ? String(sheet.getSheetId()) : 'def';
  if (_rosterColCache[id]) return _rosterColCache[id];
  const d = CONFIG.roster;
  const cols = { rank: d.rank, name: d.name, unit: d.unit, discord: d.discord, join: 6, promo: 7, activity: d.activity, hours: d.hours,
    ooc: 0, shift: 0, mayHours: 0, junHours: 0, timeInRank: 0, email: 0, dob: 0, headerRow: 0 }; // optional display columns — 0 = not present; headerRow = the resolved label row
  try {
    const lastCol = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();
    if (lastCol >= 1 && lastRow >= 1) {
      const match = {
        rank: (h) => h.indexOf('RANK') !== -1 && h.indexOf('GROUP') === -1,        // the real RANK column, not a "RANK GROUP" band header
        name: (h) => h.indexOf('NAME') !== -1 && h.indexOf('OOC') === -1,          // the canonical NAME, not "OOC NAME"
        unit: (h) => /^UNIT\b/.test(h) || h.indexOf('CALLSIGN') !== -1,
        discord: (h) => h.indexOf('DISCORD') !== -1 || h.indexOf('UNIQUE') !== -1, // a Discord ID OR a community "UNIQUE ID"
        join: (h) => h.indexOf('JOIN') !== -1,
        promo: (h) => h.indexOf('PROMOT') !== -1,
        activity: (h) => h.indexOf('ACTIVITY') !== -1 || h.indexOf('STATUS') !== -1, // "STATUS" is the new label for the activity tier
        hours: (h) => h.indexOf('HOURS') !== -1,
        ooc: (h) => h.indexOf('OOC') !== -1,
        shift: (h) => h.indexOf('SHIFT') !== -1,
        mayHours: (h) => h.indexOf('MAY') !== -1 && h.indexOf('HOUR') !== -1,
        junHours: (h) => h.indexOf('JUN') !== -1 && h.indexOf('HOUR') !== -1,
        timeInRank: (h) => h.indexOf('TIME') !== -1 && h.indexOf('RANK') !== -1,
        email: (h) => h.indexOf('EMAIL') !== -1,
        dob: (h) => h.indexOf('DOB') !== -1 || h.indexOf('BIRTH') !== -1,          // "DOB" or "DATE OF BIRTH"
      };
      const readRow = (r) => sheet.getRange(r, 1, 1, lastCol).getDisplayValues()[0].map((h) => String(h).toUpperCase().trim());
      const looksHdr = (row) => !!row && row.some((h) => match.rank(h)) && row.some((h) => match.hours(h) || match.name(h));
      // Prefer the configured HEADER_ROW; but if it isn't the real label row (e.g. it points at a two-row header's
      // group-banner row, or wasn't updated for this layout), auto-find the label row in the top rows so resolution
      // still works. Back-compatible: a correctly-configured header row matches on the first try — no scan.
      let hdr = (ROSTER_HEADER_ROW >= 1 && ROSTER_HEADER_ROW <= lastRow) ? readRow(ROSTER_HEADER_ROW) : null;
      let hdrRow = hdr ? ROSTER_HEADER_ROW : 0;
      if (!looksHdr(hdr)) {
        for (let r = 1; r <= Math.min(15, lastRow); r++) { const row = readRow(r); if (looksHdr(row)) { hdr = row; hdrRow = r; break; } }
      }
      if (hdr) {
        cols.headerRow = hdrRow;
        Object.keys(match).forEach((k) => {
          for (let c = 0; c < hdr.length; c++) { if (match[k](hdr[c])) { cols[k] = c + 1; break; } }
        });
      }
    }
  } catch (e) { log_('rosterCols_', e); }
  _rosterColCache[id] = cols;
  return cols;
}

/* ======================================================================
 * SCALABLE COLUMN CLASSIFICATION
 * Every populated row-5 header is auto-discovered and classified SLOT (static, stays with the
 * position on a transfer — Rank/Callsign) or MEMBER (follows the person — Name/Discord/new columns).
 * Per-column overrides live in the hidden "_Columns" tab; otherwise a keyword default applies.
 * ====================================================================== */

/** Normalizes a header to its lookup key (uppercase, trimmed). */
function colKey_(h) { return String(h == null ? '' : h).toUpperCase().trim(); }

/** Default class for a header key when "_Columns" has no override. Mirrors rosterCols_'s rank/unit match. */
function defaultColumnClass_(keyUpper) {
  const isRank = keyUpper.indexOf('RANK') !== -1;
  const isUnit = /^UNIT\b/.test(keyUpper) || keyUpper.indexOf('CALLSIGN') !== -1; // not "COMMUNITY" — needs the word boundary
  return (isRank || isUnit) ? 'SLOT' : 'MEMBER';
}

/**
 * {NORMALIZED_HEADER: 'SLOT'|'MEMBER'} override map. Phase 1 fold (brief Part E): the source of truth is the
 * [COLUMNS] block on ⚙️ Config (blank-Role rows = exact-header class overrides). The legacy hidden "_Columns"
 * tab is still read FIRST as a fallback so a sheet that hasn't run First-Run Setup yet keeps its manual
 * classifications — config rows then overlay it. ('USER' is an alias for MEMBER.)
 */
function columnClassOverrides_() {
  const out = {};
  // 1. Legacy "_Columns" tab (pre-wizard compatibility; retired by the wizard's import step).
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.columns.configSheet);
  if (sh && sh.getLastRow() >= 2) {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getDisplayValues(); // Column | Header | Class (display — consistent with the import path)
    v.forEach((r) => {
      const header = colKey_(r[1]);
      const klass = colKey_(r[2]);
      if (header && (klass === 'SLOT' || klass === 'MEMBER' || klass === 'USER')) out[header] = klass === 'USER' ? 'MEMBER' : klass;
    });
  }
  // 2. [COLUMNS] class rows from the ⚙️ Config tab overlay (win over) the legacy tab.
  try {
    const cv = cfg_();
    if (cv.fromTab) {
      cv.tables.COLUMNS.forEach((r) => {
        const klass = colKey_(r.Class);
        if (r.Role === '' && r.Match && (klass === 'SLOT' || klass === 'MEMBER')) out[colKey_(r.Match)] = klass;
      });
    }
  } catch (e) { log_('columnClassOverrides_', e); }
  return out;
}

/** The roster's resolved label row — auto-detected by rosterCols_ (handles a two-row banner+label header), else the configured ROSTER_HEADER_ROW. */
function rosterLabelRow_(roster) {
  try { const h = rosterCols_(roster).headerRow; if (h) return h; } catch (e) { log_('rosterLabelRow_', e); }
  return ROSTER_HEADER_ROW;
}

/** Per-column header labels at `labelRow`, each falling back to the banner row above when its own cell is blank (cells merged across both rows, e.g. RANK GROUP). */
function rosterHeaderLabels_(roster, labelRow) {
  const lastCol = Math.max(roster.getLastColumn(), 1);
  const lbl = roster.getRange(labelRow, 1, 1, lastCol).getDisplayValues()[0];
  const banner = labelRow > 1 ? roster.getRange(labelRow - 1, 1, 1, lastCol).getDisplayValues()[0] : [];
  return lbl.map((v, i) => { const s = String(v || '').trim(); return s !== '' ? s : String(banner[i] || '').trim(); });
}

/**
 * Discovers every populated header on the roster's resolved label row (row 6 on a two-row banner+label layout; a
 * blank label cell falls back to the merged banner above, e.g. RANK GROUP) and resolves each column's class.
 * @param {Object} [overrides] - {NORMALIZED_HEADER:class}; defaults to the live "_Columns" tab (tests inject {}).
 * @return {Array<{col:number, header:string, klass:string}>}
 */
function columnRegistry_(roster, overrides) {
  const ov = overrides || columnClassOverrides_();
  const out = [];
  try {
    const lastCol = roster.getLastColumn();
    const labelRow = rosterLabelRow_(roster);
    if (lastCol >= 1 && roster.getLastRow() >= labelRow) {
      const hdr = rosterHeaderLabels_(roster, labelRow);
      for (let c = 1; c <= lastCol; c++) {
        const header = String(hdr[c - 1] || '').trim();
        if (header === '') continue;
        const key = colKey_(header);
        out.push({ col: c, header, klass: ov[key] || defaultColumnClass_(key) });
      }
    }
  } catch (e) { log_('columnRegistry_', e); }
  return out;
}

/** Set of 1-based SLOT columns (static, stay with the position) for the given roster. */
function slotColumnSet_(roster, overrides) {
  const set = {};
  columnRegistry_(roster, overrides).forEach((c) => { if (c.klass === 'SLOT') set[c.col] = true; });
  return set;
}

/**
 * Menu/action core: (re)builds the hidden "_Columns" tab from the current row-5 headers, defaulting each
 * column's class by keyword and PRESERVING any class you set manually. Run after adding a roster column.
 * @return {number} number of columns written.
 */
function syncColumnConfig_() {
  // Phase 1 fold: classifications live in the [COLUMNS] block on ⚙️ Config (not the hidden "_Columns" tab).
  // This re-scan adds a class row for every roster header not already covered by a role keyword or an existing
  // class row, defaulting by keyword and PRESERVING everything already classified.
  const ss = SpreadsheetApp.getActive();
  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  if (!roster) return null;
  let configSheet = findConfigSheet_(ss);
  if (!configSheet) { seedConfigTab_(ss); configSheet = findConfigSheet_(ss); }
  if (!configSheet) return null;
  const existing = columnClassOverrides_(); // legacy tab + config rows, keyed by header
  const lastCol = roster.getLastColumn();
  const labelRow = rosterLabelRow_(roster);
  const hdr = roster.getLastRow() >= labelRow ? rosterHeaderLabels_(roster, labelRow) : [];
  let seenCount = 0;
  const added = []; // {header, klass} — headers newly classified this run (not counting ones already in [COLUMNS])
  for (let c = 1; c <= lastCol; c++) {
    const header = String(hdr[c - 1] || '').trim();
    if (header === '') continue;
    seenCount++;
    const key = colKey_(header);
    if (existing[key]) continue; // already classified (legacy tab or config row) — preserve
    const klass = defaultColumnClass_(key);
    setColumnClassRow_(configSheet, header, klass);
    added.push({ header: header, klass: klass });
  }
  cfgInvalidate_();
  SpreadsheetApp.flush();
  logInfo_('syncColumnConfig_', `scanned ${seenCount} column(s); added ${added.length} new class row(s) to the [COLUMNS] block on "${CONFIG_SHEET_NAME}".`);
  return { scanned: seenCount, added: added };
}

/** Menu action: re-scan roster headers into the [COLUMNS] block on ⚙️ Config and report exactly which columns were newly classified. */
function syncColumnConfig() {
  runAction_('Sync Column Config', () => {
    const res = syncColumnConfig_();
    if (!res) { SpreadsheetApp.getUi().alert(`Roster tab "${CONFIG.sheets.roster}" not found.`); return; }
    const head = res.added.length
      ? `🧩 Added ${res.added.length} new column${res.added.length === 1 ? '' : 's'} to the config:\n` +
        res.added.slice(0, 15).map((a) => `•  ${a.header} → ${a.klass}`).join('\n') +
        (res.added.length > 15 ? `\n…and ${res.added.length - 15} more` : '') +
        `\n\n(${res.scanned} column${res.scanned === 1 ? '' : 's'} tracked in total.)`
      : `🧩 All ${res.scanned} roster column${res.scanned === 1 ? ' is' : 's are'} already classified — nothing new to add.`;
    SpreadsheetApp.getUi().alert(
      `${head}\n\n` +
      `Classifications live in the [COLUMNS] block on the "${CONFIG_SHEET_NAME}" tab (or the Control Panel's ` +
      `Columns tab). SLOT stays with the position (Rank/Callsign); MEMBER follows the person (Name/Discord/…). New columns default to MEMBER.`,
    );
  });
}

/* ======================================================================
 * MENU & TRIGGERS
 * ====================================================================== */

/**
 * Builds all menus. `prefix` is '' in bound mode; in library mode (Phase 2, the public template) the shim
 * calls onOpenLib('RE') and every item name becomes 'RE.functionName' — Sheets invokes library functions
 * directly through the identifier, so the shim needs NO per-menu-item forwarders.
 */
function buildMenus_(prefix) {
  const p = prefix || '';
  try {
    // Grouped by WORKFLOW (panels → members → leave → hours → presentation → setup), not by feature age —
    // an admin scans for the job they're doing, so each separator block is one job family.
    SpreadsheetApp.getUi().createMenu('👥 Roster')
      // Open
      .addItem('🎛️ Open Control Panel', p + 'openControlPanel')
      .addItem('⚙️ Engine Settings', p + 'openSettingsPanel')
      .addSeparator()
      // Daily operations
      .addItem('🔄 Refresh & Update All', p + 'refreshDashboard')
      .addItem('📥 Sync Leave Forms to Tracker', p + 'manualSyncLOA')
      .addItem('🧾 Sync Signup Form to Review', p + 'manualSyncSignups')
      .addItem('📸 Capture & Reset Activity', p + 'weeklyResetWithHistory')
      .addItem('🔍 Run Integrity Scan', p + 'scanIntegrity')
      .addItem('🌐 Publish Public Roster', p + 'publishPublicRosterNow')
      .addSeparator()
      // Roster editing
      .addItem('➕ Add Member Rows…', p + 'addMemberRow')
      .addItem('🎙️ Fix All Callsign Numbers', p + 'updateUnitNumbers')
      .addItem('🗂️ Build / Refresh Group Sheets', p + 'buildGroupSheets')
      .addItem('🎓 Build / Refresh Police Academy', p + 'buildAcademySheets')
      .addSeparator()
      // Setup & wiring (run rarely)
      .addItem('🌐 Set Up Public Roster', p + 'setupPublicRoster')
      .addSubMenu(SpreadsheetApp.getUi().createMenu('🆔 Unique ID Type')
        .addItem('Discord ID (17–19 digits)', p + 'idTypeDiscord')
        .addItem('Community ID (1–8 digits)', p + 'idTypeCommunity'))
      .addItem('🧩 Sync Column Config', p + 'syncColumnConfig')
      .addItem('🚀 First-Run Setup', p + 'setupWizard')
      .addItem('🔌 Install Triggers', p + 'installTriggers')
      .addToUi();
  } catch (err) {
    log_('onOpen', err);
  }
  // Companion-file menu (guarded with typeof so a not-yet-pasted add-on never breaks the core menu).
  try { if (typeof addDevMenu_ === 'function') addDevMenu_(p); } catch (err) { log_('onOpen.devqa', err); }           // 🧪 Dev / QA (RosterDevQA.gs)
}

/** Simple trigger: builds the custom menus when the spreadsheet opens (bound mode). */
function onOpen() {
  buildMenus_('');
}

/**
 * Library-mode onOpen (Phase 2): called by the template shim's simple trigger as RE.onOpenLib('RE').
 * @param {string} libId - the identifier the template chose when adding the library (must match).
 */
function onOpenLib(libId) {
  const id = String(libId || '').trim();
  // F-022: the shim passes its own library identifier; menu targets are built with this prefix, so it MUST match the
  // identifier chosen when adding the library (the runbook fixes it to 'RE'). A blank/malformed value means the
  // template was misconfigured — fall back to 'RE' and leave a diagnostic breadcrumb instead of silently dead menus.
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id)) {
    try { console.warn(`onOpenLib received an invalid library identifier "${libId}"; falling back to 'RE'. Add the engine library with identifier RE (see ROSTER-ENGINE-V2-RUNBOOK).`); } catch (e) { /* nothing */ }
    buildMenus_('RE.');
    return;
  }
  buildMenus_(id + '.');
}

/** Creates the installable triggers (form submit + daily check), replacing any duplicates. */
function installTriggers() {
  runAction_('Install Triggers', () => {
    const keep = { onFormSubmit: true, processDailyLOAs: true, publishPublicRoster: true, publishOnChange: true, publishSweep: true };
    ScriptApp.getProjectTriggers().forEach((t) => {
      if (keep[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
    });
    const ss = SpreadsheetApp.getActive();
    const hour = cfg_().kv.SCHEDULE.NIGHTLY_HOUR; // [SCHEDULE].NIGHTLY_HOUR — default 0 (midnight, the classic behavior)
    ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
    ScriptApp.newTrigger('processDailyLOAs').timeBased().atHour(hour).everyDays(1).create();
    // Public roster: near-live. An INSTALLABLE onEdit runs authorized (unlike the simple one) so it can write to the
    // other file; onChange additionally catches row insert/DELETE, which onEdit never fires for. The 1-minute sweep
    // publishes anything a burst skipped, and does nothing at all when the sheet is idle.
    let pubLine = '';
    try {
      if (typeof publishOnChange === 'function') {
        ScriptApp.newTrigger('publishOnChange').forSpreadsheet(ss).onEdit().create();
        ScriptApp.newTrigger('publishOnChange').forSpreadsheet(ss).onChange().create();
        ScriptApp.newTrigger('publishSweep').timeBased().everyMinutes(1).create();
        pubLine = '\n• Public roster: live on edit + row delete (1-min catch-up)';
      }
    } catch (e) { log_('installTriggers.publish', e); }
    // v1.0 — ONE installer: also (re)install the Extras triggers when that companion file is present (integrity scan,
    // coverage rebuild, cadence-aware hours reset). Guarded so a bound project WITHOUT RosterExtras.gs still installs core.
    let extrasLine = '';
    try { if (typeof installExtrasTriggers_ === 'function') { const rd = installExtrasTriggers_(); extrasLine = `\n• Integrity scan (7am), coverage rebuild (6am)\n• Hours reset — ${rd}`; } } catch (e) { log_('installTriggers.extras', e); }
    logInfo_('installTriggers', `installed core triggers (daily hour ${hour})${extrasLine ? ' + extras' : ''}.`);
    SpreadsheetApp.getUi().alert(`✅ Triggers installed:\n• Form submit\n• Daily schedule check (${hour === 0 ? 'midnight' : hour + ':00'})${pubLine}${extrasLine}`);
  });
}

/**
 * Phase 2 (brief Part C): programmatically create the leave Google Form from [FORM_MAP] + [LEAVE], link its
 * destination to this spreadsheet, and capture the REAL response-tab name into [SHEETS].FORM_RESPONSES —
 * eliminating the copy-and-relink-by-hand step (and the tab-name-mismatch bug class) at the source.
 * The Discord-ID question carries the ^\d{17,19}$ validation so a bad ID can't even be submitted.
 * @return {{tab:string, url:string, editUrl:string}}
 */
function createLeaveForm_(ss) {
  const s = ss || SpreadsheetApp.getActive();
  const v = cfg_();
  const types = v.leave.LEAVE_TYPES.length ? v.leave.LEAVE_TYPES : ['LOA', 'ROA'];
  const label = (role, fallback) => {
    const row = v.tables.FORM_MAP.filter((r) => norm_(r.Role) === role)[0];
    return (row && row.Header) ? row.Header : fallback;
  };
  let form;
  try {
    form = FormApp.create(`${v.legacy.systemName} — Leave (${types.join('/')}) Request`);
  } catch (e) {
    // Most common cause: the Forms permission wasn't granted (scope prompt declined / stale authorization).
    throw new Error(`Could not create the Google Form — re-run setup and accept ALL permission prompts (Forms access is required). (${e.message})`);
  }
  // F-020: everything AFTER FormApp.create runs in a guard — a failure here would otherwise strand an orphan form
  // in the user's Drive (and every setup re-run would create another).
  try {
    form.setDescription('Submit a leave request. It appears on the tracker as Pending for command approval.');
    form.addTextItem().setTitle(label('NAME', 'Name')).setRequired(true);
    form.addTextItem().setTitle(label('DISCORD_ID', 'Discord ID')).setRequired(true)
      .setValidation(FormApp.createTextValidation()
        .setHelpText(idDigitsLabel_() + ' digits — copy-paste it, never retype it.')
        .requireTextMatchesPattern(idRegexSource_()).build());
    form.addTextItem().setTitle(label('CALLSIGN', 'Callsign')).setRequired(true);
    form.addTextItem().setTitle(label('RANK', 'Rank')).setRequired(true);
    form.addListItem().setTitle(label('TYPE', 'Status')).setChoiceValues(types).setRequired(true);
    form.addDateItem().setTitle(label('START', 'Start Date')).setRequired(true);
    form.addDateItem().setTitle(label('END', 'End Date')).setRequired(true);

    const before = {};
    s.getSheets().forEach((sh) => { before[sh.getName()] = true; });
    form.setDestination(FormApp.DestinationType.SPREADSHEET, s.getId());
    SpreadsheetApp.flush();
    // F-040: poll with backoff (Sheets can be slow to attach the tab) and prefer a "Form Responses"-pattern name so a
    // concurrently-inserted, unrelated tab can't be mis-recorded as the response sheet.
    let tab = '';
    for (let attempt = 0; attempt < 5 && !tab; attempt++) {
      Utilities.sleep(attempt === 0 ? 1500 : 2000); // ~1.5s then up to 4×2s ≈ 9.5s worst case
      const fresh = SpreadsheetApp.openById(s.getId()).getSheets().filter((sh) => !before[sh.getName()]);
      const match = fresh.filter((sh) => /form responses/i.test(sh.getName()))[0] || fresh[0];
      if (match) tab = match.getName();
    }

    // The premium move: write the ACTUAL created tab name into config so nothing ever has to match by hand.
    const configSheet = findConfigSheet_(s);
    if (configSheet && tab) { setKvValue_(configSheet, 'SHEETS', 'FORM_RESPONSES', tab); cfgInvalidate_(); }
    logInfo_('createLeaveForm_', `form created; responses land on "${tab}".`);
    return { tab, url: form.getPublishedUrl(), editUrl: form.getEditUrl() };
  } catch (e) {
    try { DriveApp.getFileById(form.getId()).setTrashed(true); } // remove the orphan (needs Drive scope)
    catch (ce) { logWarn_('createLeaveForm_', `partial form left in Drive (id ${form.getId()}); trash it manually: ${ce && ce.message}`); }
    throw new Error(`Leave form setup failed after the form was created (the partial form was removed): ${e.message}`);
  }
}

/**
 * Menu: one-click first-run setup. Idempotent — installs the core + audit triggers, themes the
 * Form Response sheet, and reports a checklist of what's done vs. still manual (the webhook).
 * Composes existing functions; companion-file calls are typeof-guarded so it works standalone.
 */
function setupWizard() {
  runAction_('First-Run Setup', () => {
    const ui = SpreadsheetApp.getUi();
    const ss = SpreadsheetApp.getActive();
    const steps = [];

    // 0. ⚙️ Config tab (Roster Engine, Phase 1) — seed missing blocks/keys with the shipped defaults
    //    (idempotent + additive: existing values are never overwritten), fold the legacy "_Columns"
    //    classifications into [COLUMNS], and validate the whole tab.
    try {
      try { ensureSysLog_(ss); } catch (e) { /* best-effort; slog_ retries lazily */ } // F-016: pre-create the diagnostics log under full auth so LIMITED triggers never have to
      const mig = migrateConfig_(ss); // additive seed + ordered schema steps + SCHEMA_VERSION stamp (brief A5)
      const imported = importColumnsFromHiddenTab_(ss);
      steps.push(mig.created
        ? `✅ Config: created "${CONFIG_SHEET_NAME}" with defaults (schema v${mig.to}; behavior unchanged until you edit it).`
        : `✅ Config: "${CONFIG_SHEET_NAME}" verified${mig.added ? ` — ${mig.added} missing entr${mig.added === 1 ? 'y' : 'ies'} added` : ''}${mig.from < mig.to ? ` (schema v${mig.from} → v${mig.to})` : ''}.`);
      if (imported) steps.push(`✅ Config: imported ${imported} column classification(s) from the legacy "_Columns" tab.`);
      cfg_(); // parse + validate now so problems surface HERE, not mid-action (throws aggregate E-102 if broken)
    } catch (e) { steps.push(`⚠️ Config: ${e.message}`); }

    // 1. Core triggers (form submit + daily schedule) — replace any duplicates.
    try {
      const keep = { onFormSubmit: true, processDailyLOAs: true };
      let hour = 0;
      try { hour = cfg_().kv.SCHEDULE.NIGHTLY_HOUR; } catch (e) { /* config broken — classic midnight */ }
      ScriptApp.getProjectTriggers().forEach((t) => { if (keep[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t); });
      ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
      ScriptApp.newTrigger('processDailyLOAs').timeBased().atHour(hour).everyDays(1).create();
      steps.push('✅ Triggers: form-submit + daily schedule check installed.');
    } catch (e) { steps.push(`⚠️ Triggers: ${e.message}`); }

    // 2. Always-on audit trigger (RosterTrust).
    try {
      if (typeof cpEnsureAuditTrigger === 'function') { cpEnsureAuditTrigger(); steps.push('✅ Audit log trigger active.'); }
      else steps.push('⏳ Audit log: paste RosterTrust.gs to enable.');
    } catch (e) { steps.push(`⚠️ Audit: ${e.message}`); }

    // 3. Leave form — create + link it if missing (Phase 2), then theme the response tab.
    try {
      let form = ss.getSheetByName(CONFIG.sheets.form);
      // F-021: a template "Make a copy" clones the response SHEET but not the form link — leaving a dead decoy that
      // sync would read from forever. If the tab exists but isn't linked to any form, retire it and create a fresh one.
      if (form) {
        let linked = false;
        try { linked = !!form.getFormUrl(); } catch (e) { linked = false; }
        if (!linked) {
          const deadName = `_DECOY ${CONFIG.sheets.form}`.slice(0, 99);
          try { form.setName(deadName); } catch (e) { /* name clash — leave it, we still create the real one */ }
          steps.push(`⚠️ Found an unlinked "${CONFIG.sheets.form}" tab (copied template decoy) — renamed it to "${deadName}" and creating a fresh linked form.`);
          form = null;
        }
      }
      if (!form) {
        const created = createLeaveForm_(ss); // builds the Google Form from [FORM_MAP]/[LEAVE], links it, captures the tab name
        form = created.tab ? ss.getSheetByName(created.tab) : null;
        steps.push(created.tab
          ? `✅ Leave form created + linked (responses → "${created.tab}"). Share: ${created.url}`
          : '❌ Leave form link FAILED — the response tab was not detected, so submissions will NOT sync. Re-run First-Run Setup; if it persists, open the form and check its response destination.');
      }
      if (form) { styleFormResponses_(form); steps.push('✅ Form Response sheet themed.'); }
    } catch (e) { steps.push(`⚠️ Leave form: ${e.message}`); }

    // 4. Column classification — scan roster headers into the [COLUMNS] block.
    try { const r = syncColumnConfig_(); steps.push(r ? `✅ Column config synced — ${r.scanned} column(s), ${r.added.length} newly classified.` : '⚠️ Column config skipped (roster tab not found).'); }
    catch (e) { steps.push(`⚠️ Column config: ${e.message}`); }

    // 5. Force the ID columns to exact text so appends never coerce a 17-19 digit Discord ID to a rounded Number.
    try {
      const tr = ss.getSheetByName(CONFIG.sheets.tracker);
      if (tr) { const tc = trackerCols_(tr).discord; if (tc) tr.getRange(1, tc, tr.getMaxRows(), 1).setNumberFormat('@'); }
      const fm = ss.getSheetByName(CONFIG.sheets.form);
      if (fm) fm.getRange(1, CONFIG.form.discord, fm.getMaxRows(), 1).setNumberFormat('@');
      steps.push('✅ ID columns locked to exact text (tracker + form Discord).');
    } catch (e) { steps.push(`⚠️ ID columns: ${e.message}`); }

    // 5b. Entry-time data validation — reject malformed Discord IDs, warn on bad dates / dropdown values.
    try {
      const v = installDataValidation_();
      steps.push(`✅ Data validation applied (${v.roster + v.tracker} rule${(v.roster + v.tracker) === 1 ? '' : 's'}: roster ${v.roster}, tracker ${v.tracker}).`);
    } catch (e) { steps.push(`⚠️ Data validation: ${e.message}`); }

    // 5c. Populate the live summary dashboard (finds the KPI boxes by label and writes current values).
    try {
      const dn = refreshDashboard_(true); // wizard = explicit full discovery scan (finds KPI boxes/#tags on any tab)
      steps.push(dn ? `✅ Dashboard refreshed (${dn} value${dn === 1 ? '' : 's'}).` : '⏳ Dashboard: no KPI labels found — check CONFIG.dashboard.cells labels match your sheet.');
    } catch (e) { steps.push(`⚠️ Dashboard: ${e.message}`); }

    // 6. Webhook (manual one-time step).
    steps.push(getWebhookUrl_()
      ? '✅ Discord webhook is set.'
      : '⏳ Discord webhook NOT set — run setWebhookUrl() once to enable notifications.');

    // 5. Health summary (RosterTrust).
    let healthLine = '';
    try {
      if (typeof cpHealthCheck_ === 'function') {
        const failed = cpHealthCheck_().checks.filter((c) => !c.ok);
        healthLine = failed.length
          ? `\n\nStill needs attention:\n• ${failed.map((c) => c.label).join('\n• ')}`
          : '\n\nHealth check: ✅ all green.';
      }
    } catch (e) { /* RosterTrust not pasted — skip */ }

    logInfo_('setupWizard', `setup run — ${steps.length} step(s).`);
    ui.alert('🚀 First-Run Setup', `${steps.join('\n')}${healthLine}`, ui.ButtonSet.OK);
  });
}

/**
 * Applies entry-time data validation so bad data is caught the moment a person types it. Validation only
 * affects MANUAL UI entry — the script's own writes (form sync, status updates, transfers) are never blocked,
 * so this is safe to layer over all the automation. Header-based on the roster (survives column reorders),
 * position-based on the tracker. Rules:
 *   • Discord ID (roster + tracker) → REJECT: must be a 17-19 digit string or blank (no valid edge case exists).
 *   • Join / Promotion / Start / End dates → WARN (red-triangle flag, still accepted) so an edge paste isn't blocked.
 *   • Tracker Type (LOA/ROA) + Status (Pending/Approved/Denied/Expired) → WARN dropdowns.
 * Empty cells always pass (open slots + dividers have blank IDs/dates). Idempotent — re-applies cleanly; re-run
 * First-Run Setup after adding rows/columns to extend it. @return {{roster:number, tracker:number}} rules applied.
 */
function installDataValidation_() {
  const ss = SpreadsheetApp.getActive();
  const counts = { roster: 0, tracker: 0, patrolLog: 0 };

  // Custom-formula rule: blank OR a 17-19 digit string. The formula references the range's top-left cell and
  // auto-adjusts down each row (like conditional formatting). REJECT because no non-17-19-digit ID is ever valid.
  const idRuleFor = (range) => {
    const top = range.getCell(1, 1).getA1Notation();
    return SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied(`=OR(${top}="",REGEXMATCH(TO_TEXT(${top}),"${idRegexSource_()}"))`)
      .setAllowInvalid(false)
      .setHelpText('Unique ID must be a ' + idDigitsLabel_() + '-digit number (digits only), or left blank. Copy-paste it — never retype it.')
      .build();
  };
  const dateRule = (msg) => SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).setHelpText(msg).build();
  const listRule = (vals, msg) => SpreadsheetApp.newDataValidation().requireValueInList(vals, true).setAllowInvalid(true).setHelpText(msg).build();

  // Apply a STATUS dropdown, but PRESERVE an existing one that already offers the same set of values. Apps Script
  // cannot read or set the per-value dropdown CHIP COLOURS, so blindly re-applying the rule wipes a user's custom
  // status colours — so we only (re)build the dropdown when it's missing or its value set actually changed.
  const applyStatusDropdown = (range, wantVals, msg) => {
    try {
      const dv = range.getCell(1, 1).getDataValidation();
      if (dv && dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
        const have = (dv.getCriteriaValues()[0] || []).map((v) => norm_(v)).sort();
        const want = wantVals.map((v) => norm_(v)).sort();
        if (have.length === want.length && have.every((v, i) => v === want[i])) return; // same values → leave it (keeps the colours)
      }
    } catch (e) { /* unreadable → fall through and (re)apply a fresh dropdown */ }
    range.setDataValidation(listRule(wantVals, msg));
  };

  // Roster (Member Information) — resolve columns by header so it tracks reorders.
  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  if (roster) {
    const RC = rosterCols_(roster);
    // F-042: validate only the live data range + a 50-row buffer (re-run setup after big growth), not all ~994 rows.
    const n = Math.min(roster.getMaxRows(), Math.max(roster.getLastRow(), CONFIG.rosterStartRow - 1) + CONFIG.limits.validationBuffer) - CONFIG.rosterStartRow + 1;
    if (n > 0) {
      const idCol = roster.getRange(CONFIG.rosterStartRow, RC.discord, n, 1);
      idCol.setDataValidation(idRuleFor(idCol)); counts.roster++;
      roster.getRange(CONFIG.rosterStartRow, RC.join, n, 1).setDataValidation(dateRule('Enter a valid join date, or leave blank.')); counts.roster++;
      roster.getRange(CONFIG.rosterStartRow, RC.promo, n, 1).setDataValidation(dateRule('Enter a valid promotion date, or leave blank.')); counts.roster++;
    }
  }

  // Tracker (LOA/ROA Tracker) — columns resolved by header (any layout; absent columns are skipped).
  const tracker = ss.getSheetByName(CONFIG.sheets.tracker);
  if (tracker) {
    const T = trackerCols_(tracker), start = CONFIG.trackerStartRow;
    const n = Math.min(tracker.getMaxRows(), Math.max(tracker.getLastRow(), start - 1) + CONFIG.limits.validationBuffer) - start + 1; // F-042: live range + buffer (config), not all rows
    if (n > 0) {
      if (T.discord) { const idCol = tracker.getRange(start, T.discord, n, 1); idCol.setDataValidation(idRuleFor(idCol)); counts.tracker++; }
      if (T.start) { tracker.getRange(start, T.start, n, 1).setDataValidation(dateRule('Enter a valid start date.')); counts.tracker++; }
      if (T.end) { tracker.getRange(start, T.end, n, 1).setDataValidation(dateRule('Enter a valid end date.')); counts.tracker++; }
      // STATUS dropdown values come from [LEAVE] on ⚙️ Config (defaults: Pending/Approved/Denied/Expired). LOA-only tracker: no TYPE column.
      let statusFlow = ['Pending', 'Approved', 'Denied', 'Expired'];
      try { const lv = cfg_().leave; if (lv.STATUS_FLOW.length) statusFlow = lv.STATUS_FLOW; } catch (e) { /* config broken — classic list */ }
      if (T.status) { applyStatusDropdown(tracker.getRange(start, T.status, n, 1), statusFlow, 'Choose a leave status.'); counts.tracker++; }
    }
  }

  // Patrol Log (manual tracker) — header-resolved; validated only when the tab exists.
  const patrolLog = CONFIG.sheets.patrolLog ? ss.getSheetByName(CONFIG.sheets.patrolLog) : null;
  if (patrolLog) {
    const PC = patrolLogCols_(patrolLog), pstart = CONFIG.patrolStartRow;
    const n = Math.min(patrolLog.getMaxRows(), Math.max(patrolLog.getLastRow(), pstart - 1) + CONFIG.limits.validationBuffer) - pstart + 1;
    if (n > 0) {
      if (PC.discord) { const idCol = patrolLog.getRange(pstart, PC.discord, n, 1); idCol.setNumberFormat('@').setDataValidation(idRuleFor(idCol)); counts.patrolLog++; }
      if (PC.startDate) { patrolLog.getRange(pstart, PC.startDate, n, 1).setDataValidation(dateRule('Enter the patrol start date.')); counts.patrolLog++; }
      if (PC.endDate) { patrolLog.getRange(pstart, PC.endDate, n, 1).setDataValidation(dateRule('Enter the patrol end date.')); counts.patrolLog++; }
      const pflow = (CONFIG.patrol.statusFlow && CONFIG.patrol.statusFlow.length) ? CONFIG.patrol.statusFlow : ['Pending', 'Flagged', 'Processed'];
      if (PC.status) { applyStatusDropdown(patrolLog.getRange(pstart, PC.status, n, 1), pflow, 'Patrol status: Pending, Flagged, or Processed.'); counts.patrolLog++; }
    }
  }
  return counts;
}

/**
 * Injectable core: compute the live-dashboard numbers from a roster sheet. POSITION-INDEPENDENT — each member's
 * section is found by the nearest all-caps divider LABEL above it (via sectionCategory_), exactly like the rest
 * of the system, so reordering rows never changes the result. Hours summed via parseHours_ (tolerates "5h 30m").
 * Buckets take section-tag labels AND exact rank names: a [DASHBOARD_GROUPS] Categories entry that matches no
 * [SECTION_TAGS] label is treated as a RANK (case/space-insensitive, e.g. "Sergeant and up" spelled out), and a
 * rank match wins over the row's section — every member still lands in exactly one bucket.
 * @return {{totalHours:number, leaves:number, total:number, active:number, semi:number, inactive:number,
 *   openSlots:number, tierCounts:Object, groups:Object, top:Array}} tierCounts = a headcount per configured TIER
 *   name; active/semi/inactive are back-compat aliases (highest / in-between / lowest tier); groups = per dashboard
 *   bucket; top = the LEADER_MAX_ highest-hours members ({n:name, h:hours}, zero-hour members excluded).
 */
function dashboardStats_(roster) {
  const RC = rosterCols_(roster);
  const scanStart = ROSTER_HEADER_ROW + 1; // include a divider that sits in the gap row above rosterStartRow
  const n = Math.max(0, roster.getLastRow() - scanStart + 1);
  const groupOf = {};     // section-category label -> bucket name
  const rankGroupOf = {}; // normalized rank -> bucket name (a Categories entry that matches no [SECTION_TAGS] label)
  const tagByNorm = {}; (CONFIG.sectionCategories || []).forEach((t) => { tagByNorm[norm_(t.label)] = t.label; });
  Object.keys(CONFIG.dashboard.groups).forEach((g) => CONFIG.dashboard.groups[g].forEach((cat) => {
    const canon = tagByNorm[norm_(cat)];
    if (canon) { groupOf[canon] = g; groupOf[cat] = g; }                // category entry (canonical + as-typed keys)
    else if (!(norm_(cat) in rankGroupOf)) rankGroupOf[norm_(cat)] = g; // rank entry — the FIRST group listing it wins
  }));
  const groups = {}; Object.keys(CONFIG.dashboard.groups).forEach((g) => { groups[g] = 0; });
  // Config-driven buckets: one per configured TIER, and a normalized leave-type set. No hardcoded status names.
  const tierByNorm = {}; const tierCounts = {};
  CONFIG.tiers.forEach((t) => { tierByNorm[norm_(t.name)] = t.name; tierCounts[t.name] = 0; });
  const leaveSet = {}; CONFIG.leaveTypes.forEach((t) => { leaveSet[norm_(t)] = true; });
  const out = { totalHours: 0, leaves: 0, total: 0, active: 0, semi: 0, inactive: 0, openSlots: 0, tierCounts, groups, top: [] };
  const tops = [];
  if (n > 0) {
    const block = roster.getRange(scanStart, 1, n, roster.getLastColumn()).getDisplayValues();
    let curGroup = null;
    for (let i = 0; i < n; i++) {
      const rank = String(block[i][RC.rank - 1]).trim();
      const name = String(block[i][RC.name - 1]).trim();
      if (isDividerValue_(rank)) { const c = sectionCategory_(rank); curGroup = c ? (groupOf[c.label] || null) : null; continue; }
      if (isMemberSlot_(rank) && !name) out.openSlots++;
      if (!isValidMemberValues_(rank, name)) continue;
      out.total++;
      const hrs = parseHours_(block[i][RC.hours - 1]);
      out.totalHours += hrs;
      if (hrs > 0) tops.push({ n: name, h: hrs }); // leaderboard candidates — zero-hour members never "lead"
      const st = String(block[i][RC.activity - 1]).trim();
      const stn = norm_(st);
      if (leaveSet[stn]) out.leaves++;
      else if (tierByNorm[stn]) tierCounts[tierByNorm[stn]]++;
      const rankBucket = rankGroupOf[norm_(rank)]; // an exact-rank entry beats the section, so nobody counts twice
      if (rankBucket) out.groups[rankBucket]++;
      else if (curGroup) out.groups[curGroup]++;
    }
    out.top = tops.sort((a, b) => b.h - a.h).slice(0, LEADER_MAX_);
  }
  // Back-compat aliases: active = highest tier, inactive = lowest tier, semi = every tier in between.
  const tn = CONFIG.tierNames;
  out.active = tn.length ? tierCounts[tn[0]] : 0;
  out.inactive = tn.length ? tierCounts[tn[tn.length - 1]] : 0;
  for (let ti = 1; ti < tn.length - 1; ti++) out.semi += tierCounts[tn[ti]];
  out.totalHours = Math.round(out.totalHours * 100) / 100;
  return out;
}

/**
 * Resolve a friendly stat-tag key (case-insensitive, punctuation-stripped) to a value from a dashboardStats_
 * result. Supports base keys + aliases, and one key per CONFIG.dashboard.groups bucket (by its lowercased name).
 * @return {number|null} the value, or null if the key is unknown.
 */
function statTagValue_(s, key) {
  const k = String(key).toLowerCase().replace(/[^a-z]/g, '');
  const base = {
    members: s.total, total: s.total, count: s.total, headcount: s.total,
    active: s.active, semi: s.semi, semiactive: s.semi, inactive: s.inactive,
    onleave: s.leaves, leave: s.leaves, leaves: s.leaves, loa: s.leaves, roa: s.leaves, loaroa: s.leaves,
    openslots: s.openSlots, open: s.openSlots, openslot: s.openSlots, slots: s.openSlots,
    hours: s.totalHours, totalhours: s.totalHours, hrs: s.totalHours,
  };
  if (Object.prototype.hasOwnProperty.call(base, k)) return base[k];
  // Configured tier names (so a renamed tier like #moderate resolves to its live count).
  const tcs = s.tierCounts || {};
  const tks = Object.keys(tcs);
  for (let i = 0; i < tks.length; i++) { if (tks[i].toLowerCase().replace(/[^a-z]/g, '') === k) return tcs[tks[i]]; }
  const gks = Object.keys(s.groups);
  for (let i = 0; i < gks.length; i++) { if (gks[i].toLowerCase().replace(/[^a-z]/g, '') === k) return s.groups[gks[i]]; } // strip like tiers do — "Command Staff" answers #commandstaff
  return null;
}

/** True for tabs the dashboard renderer should NOT scan/write — the data feeds + the system/hidden tabs. */
function dashboardSkip_(name) {
  if (name === CONFIG.sheets.tracker || name === CONFIG.sheets.form) return true;
  if (name.indexOf('_') === 0 || name.indexOf('🧪') === 0) return true; // hidden/config + sandbox-tab conventions
  return [CONFIG.sheets.audit, CONFIG.sheets.coverage, CONFIG.sheets.integrity, CONFIG.sheets.hoursHistory, CONFIG.sheets.snapshots, CONFIG.columns.configSheet, CONFIG_SHEET_NAME, SYS_LOG_SHEET].indexOf(name) !== -1;
}

/**
 * Render the dashboard onto ONE sheet given pre-computed stats: free-form STAT TAGS, written as plain VALUES (no
 * formula to break), position-independent — a cell that is just "#<stat>" (e.g. #members, #active, #troopers,
 * #hours) becomes the live number; the key is remembered in the cell's NOTE so it keeps refreshing wherever the
 * cell moves. Clearing the cell's value stops it being managed. Unknown #tags are left untouched. Tags plus the
 * PATROL LEADERBOARD table are the only render mechanisms: the engine never writes a dashboard cell the user
 * didn't explicitly tag or title.
 * @return {number} cells written on this sheet.
 */
function renderDashboardOnSheet_(sheet, s) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return 0;
  const grid = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  let written = 0;

  // Free-form "#stat" tags anywhere on this sheet — kept live via the cell's note.
  const notes = sheet.getRange(1, 1, lastRow, lastCol).getNotes();
  const TAG = /^#\s*([A-Za-z]+)$/;
  const MARK = 'roster-stat:';
  const seenKeys = {}; // F-043: catch a stat key managed by two cells (e.g. a copy/paste) — both would ghost-update
  const noteDup = (key, r, c) => { const k = String(key).toLowerCase(); if (seenKeys[k]) { logWarn_('renderDashboardOnSheet_', `stat #${k} is managed by more than one cell on "${sheet.getName()}" (e.g. R${r + 1}C${c + 1}) — a copied tag cell ghost-updates; keep one.`); } else seenKeys[k] = true; };
  for (let r = 0; r < lastRow; r++) {
    for (let c = 0; c < lastCol; c++) {
      const val = String(grid[r][c]).trim();
      const m = val.match(TAG);
      if (m) { // a freshly-typed (or re-typed) tag — convert to the live value + remember the key in the note
        const v = statTagValue_(s, m[1]);
        if (v !== null) { sheet.getRange(r + 1, c + 1).setValue(v).setNote(MARK + m[1].toLowerCase()); noteDup(m[1], r, c); written++; }
      } else if (String(notes[r][c] || '').indexOf(MARK) === 0) { // snapshot says managed — re-verify the LIVE note before touching it (F-033)
        const cell = sheet.getRange(r + 1, c + 1);
        const liveNote = String(cell.getNote() || '');
        if (liveNote.indexOf(MARK) !== 0) continue; // a concurrent edit replaced the managed note — leave the user's note alone
        if (val === '') { cell.clearNote(); } // user deleted the value — stop managing this cell
        else { const key = liveNote.slice(MARK.length).trim(); const v = statTagValue_(s, key); if (v !== null) { cell.setValue(v); noteDup(key, r, c); written++; } }
      }
    }
  }

  // PATROL LEADERBOARD — rendered from the same stats pass whenever this sheet carries the table.
  written += renderLeaderboardOnSheet_(sheet, grid, s);
  return written;
}

const LEADER_TITLE_ = 'PATROL LEADERBOARD';
const LEADER_MAX_ = 5;

/**
 * Render the hours leaderboard into THIS sheet's PATROL LEADERBOARD table, if it carries one: the title cell is
 * matched anywhere (case-insensitive) with a NAME + HOURS header row within 3 rows below it (any columns — the
 * header text anchors each column, so merged bands are fine). The RANK column's 1–5 labels are user styling and
 * never touched; NAME/HOURS rewrite all LEADER_MAX_ rows so departed leaders clear. Names are '@'-formatted
 * BEFORE the write (a member named "=X" must never execute); hours stay numbers. @return {number} cells written.
 */
function renderLeaderboardOnSheet_(sheet, grid, s) {
  const top = s.top || [];
  const lastRow = grid.length, lastCol = lastRow ? grid[0].length : 0;
  let tr = 0;
  for (let r = 0; r < lastRow && !tr; r++) {
    for (let c = 0; c < lastCol; c++) {
      if (String(grid[r][c]).trim().toUpperCase() === LEADER_TITLE_) { tr = r + 1; break; }
    }
  }
  if (!tr) return 0;
  let hr = 0, nameCol = 0, hoursCol = 0;
  for (let r = tr; r < Math.min(tr + 3, lastRow) && !hr; r++) {
    let nm = 0, hh = 0;
    for (let c = 0; c < lastCol; c++) {
      const v = String(grid[r][c]).trim().toUpperCase();
      if (v === 'NAME') nm = c + 1; else if (v === 'HOURS') hh = c + 1;
    }
    if (nm && hh) { hr = r + 1; nameCol = nm; hoursCol = hh; }
  }
  if (!hr) { logWarn_('renderLeaderboardOnSheet_', `"${LEADER_TITLE_}" title on "${sheet.getName()}" has no NAME / HOURS header row beneath it.`); return 0; }
  const n = Math.min(LEADER_MAX_, sheet.getMaxRows() - hr);
  if (n < 1) return 0;
  const names = [], hours = [];
  for (let i = 0; i < n; i++) { const p = top[i]; names.push([p ? p.n : '']); hours.push([p ? p.h : '']); }
  sheet.getRange(hr + 1, nameCol, n, 1).setNumberFormat('@').setValues(names);
  sheet.getRange(hr + 1, hoursCol, n, 1).setValues(hours);
  return n * 2;
}

/* ======================================================================
 * RECENT-PROMOTIONS FEED — a rolling "last N promotions" table on any
 * dashboard-eligible tab. A move counts as a PROMOTION when the member
 * lands on an EARLIER row (the roster is ordered top = highest) AND the
 * rank label actually changed; demotions and same-rank shuffles are not
 * recorded. History lives in Document Properties (PROMO_STORE_PROP_) so
 * the table can be moved or restyled freely and refilled at any time;
 * it is found by its title cell + a DATE / NAME / NEW RANK header row.
 * ====================================================================== */
const PROMO_STORE_PROP_ = 'RE_PROMOS';
const PROMO_TITLE_ = 'RECENT PROMOTIONS';
const PROMO_MAX_ = 20; // history + render cap — sized to the Welcome-page table (20 data rows)

/** Pure predicate: does this move qualify as a promotion? (Injectable — DevQA drives it directly.) */
function promoIsPromotion_(srcRow, dstRow, fromRank, toRank) {
  if (!(Number(dstRow) < Number(srcRow))) return false; // up the sheet = up the ladder
  const f = norm_(fromRank), t = norm_(toRank);
  return !!t && t !== 'UNKNOWN' && f !== t;             // the rank label must actually change
}

/** Record a promotion (newest first, capped at PROMO_MAX_) and re-render the feed. Never throws into the move. */
function promoRecord_(srcRow, dstRow, name, fromRank, toRank) {
  try {
    if (!promoIsPromotion_(srcRow, dstRow, fromRank, toRank)) return;
    const P = PropertiesService.getDocumentProperties();
    let list; try { list = JSON.parse(P.getProperty(PROMO_STORE_PROP_) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    list.unshift({ t: Date.now(), n: String(name || '').trim(), r: String(toRank).trim() });
    P.setProperty(PROMO_STORE_PROP_, JSON.stringify(list.slice(0, PROMO_MAX_)));
    renderPromotions_();
  } catch (e) { logWarn_('promoRecord_', String((e && e.message) || e)); }
}

/**
 * Injectable core: render `list` into THIS sheet's RECENT PROMOTIONS table, if it carries one. The title cell is
 * matched anywhere on the sheet (case-insensitive); the DATE / NAME / NEW RANK header row must sit within 3 rows
 * below it (any columns — merged bands are fine, the header text anchors each column). The full PROMO_MAX_ block
 * is rewritten every time so removed entries clear, and every cell is '@'-formatted BEFORE the write (a member
 * named "=X" must never execute as a formula). @return {boolean} true when a table was found and filled.
 */
function renderPromotionsOnSheet_(sheet, list) {
  const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 3) return false;
  const grid = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  let tr = 0;
  for (let r = 0; r < lastRow && !tr; r++) {
    for (let c = 0; c < lastCol; c++) {
      if (String(grid[r][c]).trim().toUpperCase() === PROMO_TITLE_) { tr = r + 1; break; }
    }
  }
  if (!tr) return false;
  let hr = 0, dateCol = 0, nameCol = 0, rankCol = 0;
  for (let r = tr; r < Math.min(tr + 3, lastRow) && !hr; r++) {
    let d = 0, n = 0, k = 0;
    for (let c = 0; c < lastCol; c++) {
      const v = String(grid[r][c]).trim().toUpperCase();
      if (v === 'DATE') d = c + 1; else if (v === 'NAME') n = c + 1; else if (v === 'NEW RANK') k = c + 1;
    }
    if (d && n && k) { hr = r + 1; dateCol = d; nameCol = n; rankCol = k; }
  }
  if (!hr) { logWarn_('renderPromotionsOnSheet_', `"${PROMO_TITLE_}" title on "${sheet.getName()}" has no DATE / NAME / NEW RANK header row beneath it.`); return false; }
  const n = Math.min(PROMO_MAX_, sheet.getMaxRows() - hr);
  if (n < 1) return false;
  const dates = [], names = [], ranks = [];
  for (let i = 0; i < n; i++) {
    const p = list[i];
    dates.push([p ? fmtDisplay_(new Date(Number(p.t))) : '']);
    names.push([p ? p.n : '']);
    ranks.push([p ? p.r : '']);
  }
  [[dateCol, dates], [nameCol, names], [rankCol, ranks]].forEach((w) => {
    sheet.getRange(hr + 1, w[0], n, 1).setNumberFormat('@').setValues(w[1]);
  });
  return true;
}

/** Live wrapper: refill the promotions table on every tab that carries one. @return {number} tables found.
 *  PERF (same convention as DASH_TABS_PROP_): the tabs that actually contain a RECENT PROMOTIONS table are remembered
 *  in a document property, because this runs from promoRecord_ INSIDE the LIMITED onEdit transfer window — and the
 *  discovery scan reads every visible tab's ENTIRE grid. Pass fullScan=true (the menu Refresh / demo do) to rediscover;
 *  an unknown state (no property yet) always falls back to the classic full scan. */
const PROMO_TABS_PROP_ = 'RE_PROMO_TABS';
function renderPromotions_(fullScan) {
  const P = PropertiesService.getDocumentProperties();
  let list; try { list = JSON.parse(P.getProperty(PROMO_STORE_PROP_) || '[]'); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  let known = null;
  if (!fullScan) { try { const v = JSON.parse(P.getProperty(PROMO_TABS_PROP_) || 'null'); known = Array.isArray(v) ? v : null; } catch (e) { known = null; } }
  const ss = SpreadsheetApp.getActive();
  const sheets = (known == null)
    ? ss.getSheets().filter((sh) => !sh.isSheetHidden() && !dashboardSkip_(sh.getName()))
    : known.map((n) => ss.getSheetByName(n)).filter(Boolean);
  const hits = [];
  sheets.forEach((sh) => {
    try { if (renderPromotionsOnSheet_(sh, list)) hits.push(sh.getName()); } catch (e) { logWarn_('renderPromotions_', String((e && e.message) || e)); }
  });
  if (known == null || hits.length !== known.length) { try { P.setProperty(PROMO_TABS_PROP_, JSON.stringify(hits)); } catch (e) { /* best-effort */ } }
  return hits.length;
}

/**
 * Live wrapper: compute the stats from the member roster, then render the dashboard (#stat tags)
 * onto EVERY visible tab except the data feeds and system/hidden tabs. The banner can live on its own tab — the
 * stats still come from the full roster ("Member Information"); the labels/tags just have to be wherever they are.
 * @return {number} total cells written across all tabs.
 */
/**
 * v1.0 PERF — remember which tabs actually contain dashboard boxes/#tags (a JSON name-list in Document Properties)
 * so the every-edit refresh renders ONLY those tabs instead of full-sheet-scanning every visible tab. Discovery stays
 * automatic: the onEdit single-sheet path adds a tab the moment a box/#tag first renders there, and the menu Refresh
 * always does a full rescan. An unknown state (no property yet) falls back to the classic full scan.
 */
const DASH_TABS_PROP_ = 'RE_DASH_TABS';
function dashTabsGet_() {
  try { const v = JSON.parse(PropertiesService.getDocumentProperties().getProperty(DASH_TABS_PROP_) || 'null'); return Array.isArray(v) ? v : null; }
  catch (e) { return null; }
}
function dashTabsSet_(names) {
  try {
    if (names.length > 100) logWarn_('dashTabsSet_', `${names.length} dashboard tabs — keeping the first 100.`); // never truncate silently
    PropertiesService.getDocumentProperties().setProperty(DASH_TABS_PROP_, JSON.stringify(names.slice(0, 100)));
  } catch (e) { /* best-effort — worst case is the classic full scan */ }
}

function refreshDashboard_(fullRescan) {
  try { if (!cfg_().dashboardEnabled) return 0; } catch (e) { /* config broken — dashboard stays on (classic behavior) */ }
  const ss = SpreadsheetApp.getActive();
  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  if (!roster) return 0;
  const s = dashboardStats_(roster);
  const known = fullRescan ? null : dashTabsGet_();
  let written = 0;
  if (known) {
    // Fast path: only the remembered tabs — and NEVER auto-prune. A render that throws (protected tab under a
    // non-owner's onEdit, transient Sheets error) or transiently writes 0 must not permanently drop a live tab;
    // a stale entry costs one cheap render per refresh and only the menu's full rescan rebuilds the set. Not
    // writing the property here also removes the read-modify-write race — only full scans and discovery add.
    known.forEach((name) => {
      const sh = ss.getSheetByName(name);
      if (!sh || dashboardSkip_(name)) return; // deleted/renamed tabs are simply skipped (rescan cleans the list)
      try { written += renderDashboardOnSheet_(sh, s); } catch (e) { log_('refreshDashboard.sheet', e); }
    });
    return written;
  }
  const live = []; // full scan (first run / menu refresh / wizard) — rebuild the remembered set from what actually renders
  ss.getSheets().forEach((sh) => {
    if (dashboardSkip_(sh.getName())) return;
    try { const w = renderDashboardOnSheet_(sh, s); written += w; if (w > 0) live.push(sh.getName()); } catch (e) { log_('refreshDashboard.sheet', e); }
  });
  dashTabsSet_(live);
  return written;
}

/** Render the dashboard onto ONE sheet (cheap onEdit path: a #tag on a non-data tab only affects that tab). Newly discovered tabs join the remembered set. */
function refreshDashboardOnOneSheet_(sheet) {
  try { if (!cfg_().dashboardEnabled) return 0; } catch (e) { /* on by default when config is broken */ }
  const ss = SpreadsheetApp.getActive();
  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  if (!roster || !sheet || dashboardSkip_(sheet.getName())) return 0;
  try {
    const w = renderDashboardOnSheet_(sheet, dashboardStats_(roster));
    if (w > 0) { // a box/#tag lives here — make sure the fast path knows
      const known = dashTabsGet_();
      if (known && known.indexOf(sheet.getName()) === -1) { known.push(sheet.getName()); dashTabsSet_(known); }
    }
    return w;
  } catch (e) { log_('refreshDashboardOnOneSheet_', e); return 0; }
}

/** Menu action: recompute the dashboard across all tabs now. */
/**
 * Menu "Refresh & Update All": one button that brings the whole roster current — pulls new leave-form
 * submissions, starts/expires leaves for today, recomputes every status from hours (leave/protected preserved),
 * then repaints the dashboard, promotions and leaderboard. The three mutating steps run under ONE script lock so
 * they can't collide with a trigger or another run; webhooks/audit for the form path fire AFTER the lock releases.
 */
function refreshDashboard() {
  runAction_('Refresh & Update', () => {
    const ui = SpreadsheetApp.getUi();
    const ss = SpreadsheetApp.getActive();
    const roster = ss.getSheetByName(CONFIG.sheets.roster);
    if (!roster) {
      ui.alert(`Member-data tab "${CONFIG.sheets.roster}" was not found. Rename your roster tab to exactly "${CONFIG.sheets.roster}", or set it under Engine Settings ▸ Sheets & layout.`);
      return;
    }
    const tracker = ss.getSheetByName(CONFIG.sheets.tracker);
    const form = ss.getSheetByName(CONFIG.sheets.form);

    let newLeaves = [], sched = null, recompute = null, tir = 0;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) { ui.alert('Another roster operation is running — try again in a moment.'); return; }
    try {
      // 1) Pull any new leave-form submissions onto the tracker (webhooks/audit deferred until the lock releases).
      if (form && tracker) { try { newLeaves = syncFormToTracker_(form, tracker, { sendWebhooks: false }); } catch (e) { log_('refreshDashboard.sync', e); } }
      // 2) Start due leaves + expire ended ones (matches the nightly schedule check).
      if (tracker) { try { sched = processDailyLOAs_(roster, tracker, todayInSheetTz_(), { sendWebhooks: true }); } catch (e) { log_('refreshDashboard.schedule', e); } }
      // 3) Recompute every member's status from current hours — leave/protected rows are left alone.
      try { recompute = recomputeStatuses_(roster, false); } catch (e) { log_('refreshDashboard.status', e); }
      // 3b) Keep TIME IN RANK live for EVERY member (days since LAST PROMOTION) — fills empties + new rows.
      try { tir = fillTimeInRank_(roster); } catch (e) { log_('refreshDashboard.tir', e); }
      // 3c) Re-process the manual Patrol Log — matures once-future logs, reconciles any credit deltas, re-groups.
      try { refreshPatrolLog_(); } catch (e) { log_('refreshDashboard.patrol', e); }
    } finally {
      lock.releaseLock();
    }
    try { if (typeof publishPublicRoster === 'function') publishPublicRoster(); } catch (e) { log_('refreshDashboard.publish', e); } // refresh the public copy
    // Deferred side-effects for the form path (post after the lock, like manualSyncLOA does).
    newLeaves.forEach((L) => { try { sendDiscordWebhook(L.name, L.rank, L.callsign, L.type, L.startStr, L.endStr, L.durationStr, L.discord); } catch (e) { log_('refreshDashboard.leafwh', e); } });
    if (newLeaves.length && typeof auditEvent_ === 'function') {
      newLeaves.forEach((L) => { try { auditEvent_('leave', '', `${L.type} ${L.startStr}–${L.endStr} (form)`, '', L.name); } catch (e) { /* best-effort */ } });
    }
    // 4) Repaint the dashboard (#tags), the promotions feed and the patrol leaderboard.
    let cells = 0;
    try { cells = refreshDashboard_(true); } catch (e) { log_('refreshDashboard.dash', e); }
    try { renderPromotions_(true); } catch (e) { log_('refreshDashboard.promos', e); } // full rescan — rediscovers newly-added promo tables
    try { if (typeof buildGroupSheets_ === 'function') buildGroupSheets_(); } catch (e) { log_('refreshDashboard.groups', e); } // refresh any #group division tabs
    try { if (typeof buildAcademySheets_ === 'function') buildAcademySheets_(); } catch (e) { log_('refreshDashboard.academy', e); } // sync the editable Police Academy tab(s)

    // 5) Integrity scan — duplicate/malformed IDs, status-vs-hours mismatches, orphaned/mis-targeted leaves.
    //    Guarded (the checks live in RosterExtras.gs); logs to the Integrity Log + posts a Discord summary.
    let issues = null;
    try { if (typeof scanIntegrityCore_ === 'function') issues = scanIntegrityCore_(); } catch (e) { log_('refreshDashboard.integrity', e); }

    const started = sched ? sched.started.length : 0;
    const expired = sched ? sched.expired.length : 0;
    const changed = recompute ? recompute.changed.length : 0;
    const total = recompute ? recompute.total : 0;
    const intLine = issues == null
      ? '\n• Integrity scan skipped (Extras file not loaded)'
      : (issues.length
        ? `\n\n⚠️ ${issues.length} integrity issue${issues.length === 1 ? '' : 's'}:\n${issues.slice(0, 8).join('\n')}${issues.length > 8 ? `\n…and ${issues.length - 8} more (see the Integrity Log tab)` : ''}`
        : '\n• Integrity scan: clean');
    ui.alert('✅ Refresh & update complete.\n\n' +
      `• ${newLeaves.length} new leave form${newLeaves.length === 1 ? '' : 's'} synced\n` +
      `• ${started} leave${started === 1 ? '' : 's'} started · ${expired} expired\n` +
      `• ${total} member${total === 1 ? '' : 's'} checked — ${changed} status change${changed === 1 ? '' : 's'}\n` +
      `• ${tir} member${tir === 1 ? '' : 's'} — TIME IN RANK kept live\n` +
      `• Dashboard, promotions & leaderboard updated${cells ? ` (${cells} cell${cells === 1 ? '' : 's'})` : ''}` +
      intLine);
  });
}

/** Simple trigger: routes roster edits (transfer / hours) and tracker approvals. */
/* ----------------------------------------------------------------------
 * DEFERRED WORK — the Academy/group rebuilds and the dashboard refresh are
 * whole-tab rebuilds. Running them from onEdit meant a single keystroke rebuilt
 * three tabs, and editing twenty cells did it twenty times. They are now QUEUED
 * and run at most ONCE per sweep, so a burst of edits costs one rebuild.
 * -------------------------------------------------------------------- */
const DEFER_PROP_ = 'DEFERRED_WORK';

/** Queue a heavy rebuild. Cheap: one property write, no sheet access. */
function deferWork_(key) {
  try {
    const p = PropertiesService.getDocumentProperties();
    const cur = String(p.getProperty(DEFER_PROP_) || '|');
    if (cur.indexOf('|' + key + '|') === -1) p.setProperty(DEFER_PROP_, cur + key + '|');
  } catch (e) { /* best-effort: the nightly run rebuilds anyway */ }
}

/** Run whatever is queued, clearing the queue FIRST so edits during a rebuild re-queue rather than being lost. */
function runDeferredWork_() {
  let pending = '';
  try {
    const p = PropertiesService.getDocumentProperties();
    pending = String(p.getProperty(DEFER_PROP_) || '');
    if (pending.replace(/\|/g, '') === '') return;
    p.deleteProperty(DEFER_PROP_);
  } catch (e) { return; }
  const has = (k) => pending.indexOf('|' + k + '|') !== -1;
  if (has('academy')) { try { if (typeof buildAcademySheets_ === 'function') buildAcademySheets_(); } catch (e) { log_('deferred.academy', e); } }
  if (has('groups')) { try { if (typeof buildGroupSheets_ === 'function') buildGroupSheets_(); } catch (e) { log_('deferred.groups', e); } }
  if (has('dashboard')) { try { refreshDashboard_(); } catch (e) { log_('deferred.dashboard', e); } }
}

const DERIVED_LAST_PROP_ = 'DERIVED_LAST_SYNC';
const DERIVED_GAP_MS_ = 4000; // isolated edits rebuild instantly; edits closer together than this batch onto the sweep

/**
 * Reflect a roster edit in the derived tabs (editable Police Academy + group tabs) RIGHT NOW instead of leaving it for
 * the 1-minute sweep — but throttled so a burst of edits still costs one rebuild, not one per keystroke. The caller has
 * already queued the work via deferWork_, so when this is throttled (or fails / times out under the simple-trigger
 * budget) the sweep is the guaranteed backstop and nothing is lost. Runs runDeferredWork_, which clears the queue it
 * satisfies so the next sweep won't redo it.
 */
function syncDerivedNow_() {
  try {
    const p = PropertiesService.getDocumentProperties();
    const now = Date.now();
    if (now - Number(p.getProperty(DERIVED_LAST_PROP_) || 0) < DERIVED_GAP_MS_) return; // inside the burst window → the sweep batches it
    p.setProperty(DERIVED_LAST_PROP_, String(now));
  } catch (e) { return; }
  try { runDeferredWork_(); } catch (e) { log_('syncDerivedNow_', e); }
}

function onEdit(e) {
  try {
    if (!e?.range) return;
    const sheet = e.range.getSheet();
    const name = sheet.getName();
    // F-029: an edit to the ⚙️ Config tab refreshes the config memo so a fix — including recovering from a broken or
    // E-104 config — takes effect on the next read, not only after a fresh execution. Runs BEFORE any CONFIG access
    // (which itself throws when the config is broken). A renamed config tab still recovers across executions as before.
    if (name === CONFIG_SHEET_NAME) { cfgInvalidate_(); return; }

    const row = e.range.getRow();
    const col = e.range.getColumn();

    if (name === CONFIG.sheets.roster) {
      const RC = rosterCols_(sheet);
      if (col === RC.discord && e.value) checkForMemberMove(sheet, e.range, e.value);
      if (col === RC.hours && row >= CONFIG.rosterStartRow && isValidMemberRow(sheet, row)) {
        updateStatusFromHours(sheet, row);
      }
      // Any edit to a member row can change what the derived Police Academy / group tabs show — RANK re-bands a member
      // (and a CLEAR/bulk-delete removes them), while NAME / SHIFT / HOURS / STATUS and the rest are mirrored. Queue the
      // rebuild as the guaranteed backstop, then reflect it IMMEDIATELY for isolated edits (syncDerivedNow_ throttles a
      // burst down to one rebuild, and the sweep carries the tail). No isValidMemberRow guard: a just-cleared row must
      // still rebuild to REMOVE the member. The Unique-ID column is left to the sweep / transfer path so a heavy rebuild
      // never runs inside the member-transfer flow (which is on the same script lock).
      const cLast = (e.range && e.range.getLastColumn) ? e.range.getLastColumn() : col;
      if (row >= CONFIG.rosterStartRow) {
        deferWork_('academy'); // whole-tab rebuilds: queued so the sweep is always a backstop
        deferWork_('groups');
        const spansDiscord = RC.discord && col <= RC.discord && cLast >= RC.discord;
        if (!spansDiscord) syncDerivedNow_(); // isolated edit → rebuild the derived tabs now, not in ≤60s
      }
    }
    if (name === CONFIG.sheets.tracker && row >= CONFIG.trackerStartRow) {
      const TRC = trackerCols_(sheet);
      // Entering a Unique ID auto-fills the member's details from the roster — a leave needs only ID + start + end.
      // Span the edited range so a paste covering the ID column across rows fills each of them.
      const c2 = (e.range && e.range.getLastColumn) ? e.range.getLastColumn() : col;
      if (TRC.discord && col <= TRC.discord && c2 >= TRC.discord) {
        const rLast = (e.range && e.range.getLastRow) ? e.range.getLastRow() : row;
        const r0 = Math.max(row, CONFIG.trackerStartRow);
        if (rLast >= r0) {
          // Batch the ID reads + ONE roster snapshot for the whole paste. Per-row autofill re-read the entire roster
          // per pasted ID, which could blow the ~30s LIMITED budget on a bulk import and leave later rows half-initialised.
          const pasted = sheet.getRange(r0, TRC.discord, rLast - r0 + 1, 1).getDisplayValues();
          let fIdx = null;
          try { const rSh = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster); if (rSh) fIdx = patrolRosterIndex_(rSh); } catch (e2) { /* fall back to per-row lookups */ }
          for (let rr = r0; rr <= rLast; rr++) {
            const idv = String(pasted[rr - r0][0]).trim();
            if (isValidId_(idv)) autoFillTrackerRow_(sheet, rr, TRC, idv, fIdx);
          }
        }
      }
      // A STATUS change — or DELETING a leave — re-groups + compacts the tracker so the survivors slide up to the
      // top with no gap. STATUS is checked by SPAN (a whole-row clear covers it too), not just the starting column.
      const spans = (t) => t && col <= t && c2 >= t;
      const statusTouched = spans(TRC.status);
      let deletedRow = false;
      if (e.value == null) { // a clear/delete carries no incoming value (single- or multi-cell); a paste has values, so it won't match
        const rLast2 = (e.range && e.range.getLastRow) ? e.range.getLastRow() : row;
        for (let rr = Math.max(row, CONFIG.trackerStartRow); rr <= rLast2 && !deletedRow; rr++) {
          const idv = TRC.discord ? String(sheet.getRange(rr, TRC.discord).getDisplayValue()).trim() : '';
          const nmv = TRC.name ? String(sheet.getRange(rr, TRC.name).getDisplayValue()).trim() : '';
          const kyv = TRC.key ? String(sheet.getRange(rr, TRC.key).getDisplayValue()).trim() : '';
          if (!idv && !nmv && !kyv) deletedRow = true; // row is now empty (sortTracker_ would drop it) → a leave was removed
        }
      }
      if (statusTouched && e.value === CONFIG.approvedStatus && e.oldValue !== CONFIG.approvedStatus) { // only the transition INTO approved re-applies (a re-confirm must not revert a manual roster override)
        checkImmediateLOAStart(sheet, row);
        notifyLeaveApproved_(sheet, row); // v1.0 optional embed (toggle off by default)
      }
      if (statusTouched || deletedRow) {
        try { sortTracker_(null, sheet); } catch (e2) { log_('onEdit.sortTracker', e2); } // re-group by status + compact away any gap left by the delete
      }
    }
    // PATROL LOG: entering a Unique ID + start/end date+time auto-fills the member, computes TOTAL TIME, credits the
    // hours, and (auto-)flags a bad log. Re-process every edited row, then re-group Pending → Flagged → Processed.
    if (CONFIG.sheets.patrolLog && name === CONFIG.sheets.patrolLog && row >= CONFIG.patrolStartRow) {
      const PC = patrolLogCols_(sheet);
      const rosterSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster);
      if (rosterSheet && PC.status) {
        const rLast = (e.range && e.range.getLastRow) ? e.range.getLastRow() : row;
        const pIdx = patrolRosterIndex_(rosterSheet); // one roster snapshot for the whole edited span (was one per row)
        for (let rr = Math.max(row, CONFIG.patrolStartRow); rr <= rLast; rr++) { try { processPatrolLog_(sheet, rr, PC, rosterSheet, pIdx); } catch (e2) { log_('onEdit.processPatrol', e2); } }
        try { sortPatrolLog_(sheet); } catch (e2) { log_('onEdit.sortPatrolLog', e2); }
      }
    }
    // Roster Signups: setting a row's STATUS to Approved on the review tab pops a slot picker + places the applicant on
    // the roster (sheet-driven approval). LIMITED-safe — every write is in THIS workbook.
    if (CONFIG.sheets.signups && name === CONFIG.sheets.signups && e.value != null) {
      if (typeof approveSignupFromSheet_ === 'function') { try { approveSignupFromSheet_(sheet, row, col, e.value, e.oldValue); } catch (e2) { log_('onEdit.approveSignup', e2); } }
    }
    // F-003: refreshing the WHOLE workbook on every keystroke is the biggest recurring cost. Short-circuit:
    //  • roster/tracker edits change the numbers → full refresh (all tag/KPI locations may need updating).
    //  • any other tab → only when THIS edit could touch a #stat tag (new value is a tag, or the cell was a managed
    //    tag), and then re-render ONLY that one sheet — a non-data edit can't change roster stats elsewhere.
    if (name === CONFIG.sheets.roster || name === CONFIG.sheets.tracker || (CONFIG.sheets.patrolLog && name === CONFIG.sheets.patrolLog)) {
      deferWork_('dashboard'); // queued for the same reason
    } else if (!dashboardSkip_(name)) {
      let touchesTag = /^#\s*[A-Za-z]/.test(String(e.value || ''));
      if (!touchesTag) { try { touchesTag = String(e.range.getNote() || '').indexOf('roster-stat:') === 0; } catch (ig) {} }
      // v1.0 PERF discovery: an edit on a tab the remembered set doesn't know yet also renders that one sheet, so a
      // new banner (typed KPI label) or a PASTED #tag block is adopted the moment it's created — same as the old
      // every-edit full scan, but at single-tab cost, and only until the tab joins the set.
      if (!touchesTag) { try { const known = dashTabsGet_(); touchesTag = !known || known.indexOf(name) === -1; } catch (ig) {} }
      if (touchesTag) { try { refreshDashboardOnOneSheet_(sheet); } catch (e2) { log_('onEdit.dashboard', e2); } }
    }
  } catch (err) {
    log_('onEdit', err);
  }
}

/** Installable trigger: syncs a new form submission to the tracker, then re-themes the response sheet. */
function onFormSubmit(e) {
  try {
    const form = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.form);
    const before = form ? form.getLastRow() : -1; // capture BEFORE the settle window
    Utilities.sleep(2000); // let Sheets finish writing the row
    // F-036: if a response row disappeared during the settle window, the submission would vanish silently — log it.
    if (form && before >= 2 && form.getLastRow() < before) {
      const who = (e && e.namedValues) ? String(JSON.stringify(e.namedValues)).slice(0, 300) : '(event data unavailable)';
      logWarn_('onFormSubmit', `a response row disappeared during the 2s settle window (rows ${before} → ${form.getLastRow()}); a submission may not have synced. Submitted: ${who}`);
    }
    syncFormToTracker();
  } catch (err) {
    log_('onFormSubmit', err);
  }
  // v1.0 — the same spreadsheet onFormSubmit fires for BOTH forms; the patrol sync only scans its own tab (no-op when
  // that form wasn't the one submitted, or when the feature is off), so running it here needs no per-form routing.
  try { syncPatrolHours(); } catch (err) { log_('onFormSubmit.patrol', err); }
  // Roster Signups: a submission lands on the FORM's own response tab (SIGNUP_FORM_RESPONSES); the sync field-matches it
  // into the themed SIGNUPS review tab and stamps Pending — just like the LOA form feeds the LOA Tracker. syncSignupForm
  // only scans its own tab and no-ops when the feature is off, so (like the patrol sync) it needs no per-form routing.
  try { if (typeof syncSignupForm === 'function') syncSignupForm(); } catch (err) { log_('onFormSubmit.signups', err); }
  // Re-apply the dark theme so every new submission looks polished + on-brand (runs even if the sync above threw).
  try {
    const form = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.form);
    if (form) styleFormResponses_(form);
  } catch (err) {
    log_('onFormSubmit.style', err);
  }
}

/**
 * Applies the dark "command-console" theme to the LOA/ROA Form Response sheet so new
 * submissions look polished + on-brand. Does NOT touch data-row backgrounds — those are the
 * status tints (processing/done/error) owned by syncFormToTracker_; this themes only the
 * header, fonts, monospace IDs, the empty canvas below, borders, and column widths.
 */
function styleFormResponses_(sheet) {
  if (!sheet) return;
  const maxRows = sheet.getMaxRows();
  const lastCol = Math.max(sheet.getLastColumn(), CONFIG.form.end);
  const lastRow = Math.max(sheet.getLastRow(), 1);

  // Base text: light Roboto across the grid (row backgrounds belong to the header / status tints / canvas below).
  // Phase 1: every hex here comes from [THEME] via theme_() — brief Part D rule zero (no hardcoded hex in engine UI).
  sheet.getRange(1, 1, maxRows, lastCol)
    .setFontFamily('Roboto').setFontColor(theme_('TEXT')).setFontSize(10).setVerticalAlignment('middle');

  // Header bar: banner fill, bold strong text, wrapped, frozen, taller.
  const header = sheet.getRange(1, 1, 1, lastCol);
  header.setBackground(theme_('BANNER')).setFontColor(theme_('TEXT_STRONG')).setFontWeight('bold').setFontSize(11).setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 42);

  // Discord IDs in monospace so the 17-19 digit strings line up.
  sheet.getRange(1, CONFIG.form.discord, maxRows, 1).setFontFamily('Roboto Mono');

  // Empty canvas below the data → dark fill so the whole sheet reads as one console.
  if (maxRows > lastRow) {
    sheet.getRange(lastRow + 1, 1, maxRows - lastRow, lastCol).setBackground(theme_('CANVAS'));
  }

  // Subtle console grid over the populated block, then a brighter accent underline beneath the header.
  sheet.getRange(1, 1, lastRow, lastCol)
    .setBorder(true, true, true, true, true, true, theme_('GRID'), SpreadsheetApp.BorderStyle.SOLID);
  header.setBorder(null, null, true, null, null, null, theme_('ACCENT'), SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // Widths sized for the long form-question headers.
  const widths = { 1: 150, 2: 235, 3: 180, 4: 95, 5: 150, 6: 115, 7: 110, 8: 110 };
  Object.keys(widths).forEach((c) => { if (Number(c) <= lastCol) sheet.setColumnWidth(Number(c), widths[Number(c)]); });

  SpreadsheetApp.flush();
}

/* ======================================================================
 * SHARED HELPERS
 * ====================================================================== */

/** Leveled logging helpers — filterable in Cloud Logging. Never pass secrets/URLs/tokens here. */
// Phase 1: the console helpers now ALSO write coded rows to the hidden SYS Log (RosterConfig.gs slog_ —
// failure-proof by contract), so every existing call site gains a persistent diagnostic trail for free.
function log_(scope, err) {
  console.error(`[${scope}] ${err?.stack ?? err}`);
  const ae = (err instanceof AppError) ? err : null;
  slog_(ae ? ae.sev : 'ERROR', ae ? ae.code : 'E-601', scope, ae ? ae.message : String((err && err.message) || err), ae ? ae.ctx : {});
}
function logWarn_(scope, msg) { console.warn(`[${scope}] ${msg}`); slog_('WARN', '', scope, msg); }
function logInfo_(scope, msg) { console.info(`[${scope}] ${msg}`); slog_('INFO', '', scope, msg); }

/**
 * Runs a user/trigger-invoked action with uniform handling: logs the real error
 * (with stack), and shows a clean non-technical message when a UI is available.
 * In trigger contexts (no UI) the log is the record. Returns fn()'s result, or undefined on failure.
 * @param {string} label - human name of the action (shown to the user, used in the log).
 * @param {function():*} fn
 */
function runAction_(label, fn) {
  try {
    const result = fn();
    // Audit-log every menu/scheduled command that ran. Skip the UI-open ('Open Control Panel') as noise;
    // the Control Panel's own Tools actions already log via cpAudit_. Guarded so a missing RosterTrust.gs is fine.
    if (label !== 'Open Control Panel' && typeof auditEvent_ === 'function') {
      try { auditEvent_('action', '', `Menu command: ${label}`, '', ''); } catch (e) { /* audit is best-effort */ }
    }
    return result;
  } catch (err) {
    // Phase 1: every failure is CODED (brief Part B) — real values in the message, a fix hint, a SYS Log row.
    const ae = (err instanceof AppError) ? err : wrapUnexpected_(label, err);
    console.error(`[${label}] ${err?.stack ?? err}`);
    slog_(ae.sev, ae.code, label, ae.message, ae.ctx);
    maybeErrorWebhook_(ae, label); // Phase 3: optional errors channel (no-op unless WEBHOOK_ERRORS is set)
    try {
      SpreadsheetApp.getUi().alert(
        `⚠️ ${ae.code} — "${label}" stopped`,
        `${ae.message}${ae.hint ? `\n\nFix: ${ae.hint}` : ''}${docsLink_(ae.code)}\n\n(Details are on the hidden "${SYS_LOG_SHEET}" tab and in script editor → Executions.)`,
        SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (uiErr) { /* no UI (time-driven trigger): the SYS Log row is the record */ }
  }
}

/**
 * Fetches a sheet by name; alerts (when a UI is available) and returns null if missing.
 * @return {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function getSheetOrWarn_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    // Phase 1: coded, loud, with a fix — E-201 names the missing tab AND the closest live match
    // (the "silent getSheetByName null" bug class is retired; guarded_/runAction_ surface this as a modal).
    let role = 'sheet';
    try {
      const sh = CONFIG.sheets;
      role = (name === sh.roster) ? 'ROSTER' : (name === sh.tracker) ? 'TRACKER' : (name === sh.form) ? 'FORM_RESPONSES' : 'sheet';
    } catch (e) { /* config broken — keep generic role */ }
    raise_('E-201', { name, role, closest: closestSheetName_(name) });
  }
  return sheet;
}

/** Mutates a Date to midnight (local) and returns it. */
function startOfDay_(d) {
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Parse a form date cell robustly (F-035): a real Date passes through; a 'yyyy-MM-dd' STRING (hand-edited cell)
 * is read as LOCAL midnight via cpParseYMD_ — `new Date('2026-03-15')` is UTC and shifts a day in western zones;
 * any other string format falls back to JS parsing so we don't reject dates we previously accepted.
 * @return {Date} (possibly Invalid — callers already NaN-check).
 */
function parseFormDate_(raw) {
  if (raw instanceof Date) return raw;
  const s = String(raw == null ? '' : raw).trim();
  if (s === '') return new Date(NaN);
  const ymd = cpParseYMD_(s);
  return isNaN(ymd.getTime()) ? new Date(s) : ymd;
}

/** "Today" at midnight in the SPREADSHEET timezone, to match TODAY()-based sheet formulas. */
function todayInSheetTz_() {
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const [y, m, day] = Utilities.formatDate(new Date(), tz, 'yyyy/MM/dd').split('/').map(Number);
  return new Date(y, m - 1, day);
}

function ssTz_() {
  return SpreadsheetApp.getActive().getSpreadsheetTimeZone();
}

/** Truncates a string to a Discord-safe length. */
function clamp_(s, n) {
  const str = s == null ? '' : String(s);
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

/** Coalesces a blank value to an em-dash (Discord rejects empty embed field values). */
function dash_(v) {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? '—' : s;
}

/* ======================================================================
 * v1.0 — CONFIGURABLE LOGIC HELPERS (unit format, date formats, embed
 * colours, retention). All fault-tolerant: a broken/absent config or a bad
 * user pattern falls back to the shipped default, never throws.
 * ====================================================================== */

/** Callsign/unit label from CONFIG.unitFormat: the {0…} token → the number zero-padded to that width (default "S-{00}" → S-01). */
function formatUnit_(n) {
  let fmt = 'S-{00}';
  try { fmt = CONFIG.unitFormat || 'S-{00}'; } catch (e) { /* config broken — classic S-NN */ }
  const m = String(fmt).match(/\{(0+)\}/);
  const num = String(n);
  if (!m) return fmt + num;                                       // no token → append the number
  return fmt.replace(m[0], num.length >= m[1].length ? num : num.padStart(m[1].length, '0'));
}

/** Format a Date for DISPLAY (embeds / coverage / panel) via CONFIG.formats.date; a bad pattern falls back to the default. */
function fmtDisplay_(d) {
  const def = 'd MMM. yyyy';
  let pat = def;
  try { pat = (CONFIG.formats && CONFIG.formats.date) || def; } catch (e) { /* config broken */ }
  try { return Utilities.formatDate(d, ssTz_(), pat); }
  catch (e) { logWarn_('fmtDisplay_', `bad DATE_DISPLAY pattern "${pat}" — using the default`); return Utilities.formatDate(d, ssTz_(), def); }
}

/** Format a Date+time for "updated"/snapshot stamps via CONFIG.formats.timestamp; a bad pattern falls back to the default. */
function fmtTs_(d) {
  const def = 'd MMM yyyy, h:mm a';
  let pat = def;
  try { pat = (CONFIG.formats && CONFIG.formats.timestamp) || def; } catch (e) { /* config broken */ }
  try { return Utilities.formatDate(d, ssTz_(), pat); }
  catch (e) { logWarn_('fmtTs_', `bad TIMESTAMP_DISPLAY pattern "${pat}" — using the default`); return Utilities.formatDate(d, ssTz_(), def); }
}

/** #rrggbb → Discord embed colour int; falls back to `def` (an int) on a malformed hex. */
function hexToInt_(hex, def) {
  const m = String(hex == null ? '' : hex).trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : def;
}

/** Ring-buffer row cap for the audit / integrity / history tabs (CONFIG.limits.logRowCap; default 5000). */
function logRowCap_() {
  try { return CONFIG.limits.logRowCap || 5000; } catch (e) { return 5000; }
}

/* ======================================================================
 * ACTIVITY STATUS
 * ====================================================================== */

/**
 * Computes activity status from weekly hours.
 * @return {string} 'Active' | 'Semi-Active' | 'Inactive'
 */
function computeStatus_(rank, hrs) {
  // Phase 1: ladder-driven via [STATUSES] tiers + [STATUS_OVERRIDES] (RosterConfig.gs). The old hardcoded
  // "Auxiliary Trooper" branch is now the seeded override row "RANK | Auxiliary Trooper | Active:5, Inactive:0",
  // so on defaults this returns exactly what it always did — but any community can now add its own ladders.
  return computeStatusCore_(rank, hrs, statusEngine_());
}

/** Parses a number, '5.5', or '5h 30m' into decimal hours. Always returns a number. */
function parseHours_(raw) {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string') return 0;
  const h = (raw.match(/(\d+(?:\.\d+)?)\s*h/i) || [])[1];
  const m = (raw.match(/(\d+(?:\.\d+)?)\s*m/i) || [])[1];
  if (h || m) return Math.round((parseFloat(h || 0) + parseFloat(m || 0) / 60) * 100) / 100;
  return parseFloat(raw) || 0;
}

function isProtectedStatus_(status) {
  return CONFIG.protectedStatuses.indexOf(status) !== -1;
}

/** True for the "returning" status (default ROA) that auto-downgrades below the semi threshold. */
function isReturningStatus_(status) {
  const rs = CONFIG.returnStatus;
  return rs !== '' && norm_(status) === norm_(rs);
}

/**
 * Single source of truth for status-from-hours, honoring leave protection.
 * Any LEAVE/PROTECTED-kind status (LOA, Reserve, and community-defined ones like
 * MEDICAL) is preserved — an hours edit never silently overwrites it. The one
 * exception is the configured "returning" status (default ROA), which auto-
 * downgrades to the hours-computed tier once hours fall below the semi threshold.
 * @return {string|null} new status, or null to leave the current one unchanged.
 */
function resolveStatus_(rank, currentStatus, hrs) {
  if (isReturningStatus_(currentStatus)) return hrs < CONFIG.thresholds.semi ? computeStatus_(rank, hrs) : null;
  if (isProtectedStatus_(currentStatus)) return null; // fully protected (LOA, Reserve, custom LEAVE/PROTECTED)
  return computeStatus_(rank, hrs);
}

/** Menu action: recompute every member's status from current hours, and report exactly what changed. */
function updateAllStatuses() {
  runAction_('Update All Statuses', () => {
    const ui = SpreadsheetApp.getUi();
    const sheet = getSheetOrWarn_(SpreadsheetApp.getActive(), CONFIG.sheets.roster);
    if (!sheet) return;
    const res = recomputeStatuses_(sheet, false);
    try { refreshDashboard_(); } catch (e) { log_('updateAllStatuses.dashboard', e); }
    if (!res.total) { ui.alert('No members found on the roster to update.'); return; }
    const prot = res.protectedSkipped ? `\n\n🛡️ ${res.protectedSkipped} member(s) on leave/protected were left alone.` : '';
    if (!res.changed.length) {
      ui.alert(`✅ All ${res.total} member statuses already match their hours — nothing to change.${prot}`);
      return;
    }
    const CAP = 15;
    const lines = res.changed.slice(0, CAP).map((c) => `•  ${c.name || ('Row ' + c.row)}:  ${c.from || '—'} → ${c.to}`).join('\n');
    const more = res.changed.length > CAP ? `\n…and ${res.changed.length - CAP} more` : '';
    ui.alert(`✅ Recomputed ${res.total} member(s) from their hours.\n\nChanged ${res.changed.length}:\n${lines}${more}${prot}`);
  });
}

/** Menu action: zero all hours and recompute (protected statuses preserved). */
function resetWeeklyStats() {
  runAction_('Weekly Reset', () => {
    const ui = SpreadsheetApp.getUi();
    const resp = ui.alert('🗑️ Weekly Reset',
      "Save this week's hours to history, then reset ALL member hours to 0?\n\n• Active/Semi-Active → Inactive\n• LOA/ROA/Reserve → protected",
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
    const sheet = getSheetOrWarn_(SpreadsheetApp.getActive(), CONFIG.sheets.roster);
    if (!sheet) return;
    // Preserve the week BEFORE zeroing so the panel sparkline / trends survive (was a data-loss gap). Guarded so a
    // bound project without RosterExtras.gs still resets — it just can't snapshot.
    let captured = 0;
    try { if (typeof captureHoursSnapshot_ === 'function') captured = captureHoursSnapshot_() || 0; } catch (e) { log_('resetWeeklyStats.snapshot', e); }
    const res = recomputeStatuses_(sheet, true);
    try { refreshDashboard_(); } catch (e) { log_('resetWeeklyStats.dashboard', e); }
    logInfo_('resetWeeklyStats', `weekly reset: ${res.changed.length} dropped, ${res.protectedSkipped} protected, ${captured} hours-snapshot row(s).`);
    ui.alert(`✅ Weekly reset complete.\n\n• ${res.total} member(s) recomputed — ${res.changed.length} dropped to the lowest tier\n• ${res.protectedSkipped} on leave/protected preserved` +
      (captured ? `\n• ${captured} member-hours saved to history first` : '\n\n⚠️ Hours history was NOT captured (the 🛠️ Extras file is not pasted).'));
  });
}

/**
 * Batched recompute over the whole roster.
 * @param {boolean} zeroHours - if true, zero every member's hours before recomputing.
 */
function recomputeStatuses_(sheet, zeroHours) {
  const empty = { total: 0, changed: [], protectedSkipped: 0 };
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.rosterStartRow) return empty;
  const RC = rosterCols_(sheet);
  const n = lastRow - CONFIG.rosterStartRow + 1;
  const ranks = sheet.getRange(CONFIG.rosterStartRow, RC.rank, n, 1).getValues();
  const names = sheet.getRange(CONFIG.rosterStartRow, RC.name, n, 1).getValues();
  const statuses = sheet.getRange(CONFIG.rosterStartRow, RC.activity, n, 1).getValues();
  const hours = sheet.getRange(CONFIG.rosterStartRow, RC.hours, n, 1).getValues();

  const changed = []; // {row, name, from, to} — for the caller's summary (menu alert / panel toast)
  let total = 0, protectedSkipped = 0;
  for (let i = 0; i < n; i++) {
    if (!isValidMemberValues_(ranks[i][0], names[i][0])) continue;
    total++;
    if (zeroHours) hours[i][0] = 0;
    const before = String(statuses[i][0]).trim();
    const next = resolveStatus_(ranks[i][0], statuses[i][0], parseHours_(hours[i][0]));
    if (next === null) { protectedSkipped++; continue; } // protected (LOA/ROA/Reserve/custom) — left as-is
    if (String(next).trim() !== before) changed.push({ row: CONFIG.rosterStartRow + i, name: String(names[i][0]).trim(), from: before, to: String(next) });
    statuses[i][0] = next;
  }
  sheet.getRange(CONFIG.rosterStartRow, RC.activity, n, 1).setValues(statuses);
  if (zeroHours) sheet.getRange(CONFIG.rosterStartRow, RC.hours, n, 1).setValues(hours);
  return { total: total, changed: changed, protectedSkipped: protectedSkipped };
}

/** Per-row status update used by the onEdit trigger. */
function updateStatusFromHours(sheet, row) {
  const RC = rosterCols_(sheet);
  const rank = sheet.getRange(row, RC.rank).getValue();
  const status = sheet.getRange(row, RC.activity).getValue();
  const raw = sheet.getRange(row, RC.hours).getValue();
  const hrs = parseHours_(raw);
  if (typeof raw === 'string' && hrs > 0) sheet.getRange(row, RC.hours).setValue(hrs);
  const next = resolveStatus_(rank, status, hrs);
  if (next !== null) sheet.getRange(row, RC.activity).setValue(next);
}

/* ======================================================================
 * LAST ACTIVITY — snapshot of the previous activity-check status (optional column)
 * ====================================================================== */

/** @return {number} 1-based column of the "LAST ACTIVITY" header in row 5, or -1 if the column isn't present. */
function lastActivityCol_(sheet) {
  try {
    const lastCol = sheet.getLastColumn();
    if (lastCol < 1 || sheet.getLastRow() < ROSTER_HEADER_ROW) return -1;
    const hdr = sheet.getRange(ROSTER_HEADER_ROW, 1, 1, lastCol).getDisplayValues()[0];
    for (let c = 0; c < hdr.length; c++) { if (/LAST\s*ACTIVITY/.test(String(hdr[c]).toUpperCase())) return c + 1; }
  } catch (e) { log_('lastActivityCol_', e); }
  return -1;
}

/** Injectable core: mirror each VALID member's current ACTIVITY into LAST ACTIVITY (exact copy). @return {number} captured, or -1 if no LAST ACTIVITY column. */
function captureLastActivityCore_(roster) {
  const laCol = lastActivityCol_(roster);
  if (laCol === -1) return -1;
  const RC = rosterCols_(roster);
  const n = Math.max(0, roster.getLastRow() - CONFIG.rosterStartRow + 1);
  if (!n) return 0;
  const ranks = roster.getRange(CONFIG.rosterStartRow, RC.rank, n, 1).getValues();
  const names = roster.getRange(CONFIG.rosterStartRow, RC.name, n, 1).getValues();
  const acts = roster.getRange(CONFIG.rosterStartRow, RC.activity, n, 1).getValues();
  const out = roster.getRange(CONFIG.rosterStartRow, laCol, n, 1).getValues(); // preserve divider/empty-slot rows
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!isValidMemberValues_(ranks[i][0], names[i][0])) continue;
    out[i][0] = acts[i][0];
    count++;
  }
  roster.getRange(CONFIG.rosterStartRow, laCol, n, 1).setValues(out);
  return count;
}

/**
 * Gives the LAST ACTIVITY column the ACTIVITY dropdown, then styles it per [ROSTER_LAYOUT].LAST_ACTIVITY_STYLE:
 * MATCH mirrors CURRENT ACTIVITY's status colours (default), NEUTRAL strips them for a calm grey chip so only the
 * current status is colour-coded. Idempotent either way.
 */
function ensureLastActivityFormat_(roster, laCol) {
  const RC = rosterCols_(roster);
  const n = Math.max(roster.getLastRow(), CONFIG.rosterStartRow) - CONFIG.rosterStartRow + 1;
  // 1) Dropdown: copy the ACTIVITY column's data validation onto LAST ACTIVITY (both styles keep the dropdown).
  roster.getRange(CONFIG.rosterStartRow, RC.activity, n, 1)
    .copyTo(roster.getRange(CONFIG.rosterStartRow, laCol, n, 1), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  // 2) Colours: NEUTRAL → calm grey chip; MATCH (default) → mirror ACTIVITY's conditional-format colours.
  if (norm_(CONFIG.lastActivityStyle) === 'NEUTRAL') neutralizeLastActivityCol_(roster, laCol, RC);
  else colorMatchLastActivityCol_(roster, laCol, RC);
}

/** MATCH: extend every conditional-format rule that covers ACTIVITY to also cover LAST ACTIVITY (skip if already extended). */
function colorMatchLastActivityCol_(roster, laCol, RC) {
  const rules = roster.getConditionalFormatRules();
  const updated = rules.map((rule) => {
    const ranges = rule.getRanges();
    const coversAct = ranges.some((r) => r.getColumn() <= RC.activity && r.getLastColumn() >= RC.activity);
    const coversLA = ranges.some((r) => r.getColumn() <= laCol && r.getLastColumn() >= laCol);
    if (!coversAct || coversLA) return rule;
    const add = ranges.filter((r) => r.getColumn() <= RC.activity && r.getLastColumn() >= RC.activity)
      .map((r) => roster.getRange(r.getRow(), laCol, r.getNumRows(), 1));
    return rule.copy().setRanges(ranges.concat(add)).build();
  });
  roster.setConditionalFormatRules(updated);
}

/**
 * NEUTRAL: drop LAST ACTIVITY from the status conditional-format rules (the single-column ranges MATCH added on laCol)
 * and paint each member cell a calm grey chip (theme GRID on TEXT), leaving divider/empty-slot rows untouched.
 */
function neutralizeLastActivityCol_(roster, laCol, RC) {
  RC = RC || rosterCols_(roster);
  // 1) Exclude LAST ACTIVITY from EVERY status conditional-format rule. The activity colours come from the template's
  //    CF, whose ranges may cover LAST ACTIVITY on its own OR as part of a wider block (e.g. CURRENT+LAST together) —
  //    so SPLIT any range that spans laCol into its left/right parts and drop the laCol column itself.
  const rules = roster.getConditionalFormatRules();
  const out = [];
  rules.forEach((rule) => {
    const kept = [];
    rule.getRanges().forEach((r) => {
      const c0 = r.getColumn(), c1 = r.getLastColumn(), row0 = r.getRow(), nr = r.getNumRows();
      if (laCol < c0 || laCol > c1) { kept.push(r); return; }                                 // range doesn't touch laCol → keep as-is
      if (c0 <= laCol - 1) kept.push(roster.getRange(row0, c0, nr, laCol - c0));               // left part (columns before laCol)
      if (c1 >= laCol + 1) kept.push(roster.getRange(row0, laCol + 1, nr, c1 - laCol));        // right part (columns after laCol)
    });
    if (kept.length) out.push(rule.copy().setRanges(kept).build());                            // a rule left with no ranges is dropped
  });
  roster.setConditionalFormatRules(out);
  // 2) Give each member cell the SAME background as the row's HOURS cell (the row's normal, non-status data colour),
  //    with readable text — so LAST ACTIVITY blends into the row instead of showing a status colour. Dividers/empty
  //    rows are left exactly as they are.
  const n = Math.max(0, roster.getLastRow() - CONFIG.rosterStartRow + 1);
  if (!n) return;
  const ranks = roster.getRange(CONFIG.rosterStartRow, RC.rank, n, 1).getValues();
  const names = roster.getRange(CONFIG.rosterStartRow, RC.name, n, 1).getValues();
  const srcBg = roster.getRange(CONFIG.rosterStartRow, RC.hours, n, 1).getBackgrounds(); // a plain data column → the row's base colour
  const rng = roster.getRange(CONFIG.rosterStartRow, laCol, n, 1);
  const bg = rng.getBackgrounds(), fc = rng.getFontColors(), fw = rng.getFontWeights();
  const NEUTRAL_FC = theme_('TEXT');
  for (let i = 0; i < n; i++) {
    if (isValidMemberValues_(ranks[i][0], names[i][0])) { bg[i][0] = srcBg[i][0]; fc[i][0] = NEUTRAL_FC; fw[i][0] = 'normal'; }
  }
  rng.setBackgrounds(bg).setFontColors(fc).setFontWeights(fw);
}

/** Menu: snapshot the current ACTIVITY of every member into LAST ACTIVITY, and ensure LAST ACTIVITY mirrors the ACTIVITY dropdown + colors. */
function captureLastActivity() {
  runAction_('Capture Last Activity', () => {
    const roster = getSheetOrWarn_(SpreadsheetApp.getActive(), CONFIG.sheets.roster);
    if (!roster) return;
    const laCol = lastActivityCol_(roster);
    if (laCol === -1) { SpreadsheetApp.getUi().alert('No "LAST ACTIVITY" header found in row 5.\n\nAdd that header, then run this again.'); return; }
    try { ensureLastActivityFormat_(roster, laCol); } catch (e) { log_('captureLastActivity.format', e); }
    const count = captureLastActivityCore_(roster);
    SpreadsheetApp.getUi().alert(count <= 0
      ? 'No members found to capture.'
      : `✅ LAST ACTIVITY captured for ${count} member(s) — mirrored from each member's current ACTIVITY.`);
  });
}

/**
 * Persist [ROSTER_LAYOUT].ID_TYPE — the department's Unique-ID switch ('DISCORD' 17-19 | 'COMMUNITY' 1-8) — and re-apply
 * the roster/tracker ID data-validation so the new length range takes effect immediately. Creates the ⚙️ Config tab if
 * missing so the choice persists. @return {string} the new accepted-digit label (e.g. "17-19" or "1-8").
 */
function setIdType_(type) {
  const ss = SpreadsheetApp.getActive();
  let configSheet = findConfigSheet_(ss);
  if (!configSheet) { seedConfigTab_(ss); configSheet = findConfigSheet_(ss); }
  if (configSheet) setKvValue_(configSheet, 'ROSTER_LAYOUT', 'ID_TYPE', type);
  cfgInvalidate_();
  try { installDataValidation_(); } catch (e) { log_('setIdType_.validation', e); } // refresh the ID rule to the new range
  return idDigitsLabel_();
}

/** Menu: switch this department to Discord IDs (17-19 digits — @mention pings work). */
function idTypeDiscord() {
  runAction_('ID Type: Discord', () => {
    const label = setIdType_('DISCORD');
    SpreadsheetApp.getUi().alert('🆔 Unique ID type → DISCORD (' + label + ' digits).\n\nExisting IDs are unchanged; new entries must be ' + label + ' digits. Discord @mention pings work with these IDs.');
  });
}

/** Menu: switch this department to short Community IDs / CIDs (1-8 digits). */
function idTypeCommunity() {
  runAction_('ID Type: Community', () => {
    const label = setIdType_('COMMUNITY');
    SpreadsheetApp.getUi().alert('🆔 Unique ID type → COMMUNITY (' + label + ' digits).\n\nNew entries must be ' + label + ' digits. Note: Discord @mention pings are skipped for community IDs (they aren\'t Discord accounts). Any existing 17-19 digit IDs will show a validation warning until updated.');
  });
}

/* ======================================================================
 * DAILY SCHEDULER & AUTO-EXPIRE
 * ====================================================================== */

/** Menu / daily-trigger entrypoint for the leave scheduler. */
function processDailyLOAs() {
  runAction_('Daily Schedule Check', () => {
    // Guard against the daily trigger overlapping a manual "Force Run" (would double-process).
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) { logWarn_('processDailyLOAs', 'another run holds the lock; skipping.'); return; }
    let summary = null;
    try {
      const ss = SpreadsheetApp.getActive();
      const tracker = getSheetOrWarn_(ss, CONFIG.sheets.tracker);
      const roster = getSheetOrWarn_(ss, CONFIG.sheets.roster);
      if (!tracker || !roster) return;
      summary = processDailyLOAs_(roster, tracker, todayInSheetTz_(), { sendWebhooks: true });
      try { sortTracker_(null, tracker); } catch (e) { log_('processDailyLOAs.sort', e); } // expiries/starts changed statuses → re-group (Pending, Approved, Denied, Expired)
      try { runDeferredWork_(); } catch (e) { log_('processDailyLOAs.deferred', e); } // flush anything queued
      try { refreshPatrolLog_(); } catch (e) { log_('processDailyLOAs.patrol', e); } // matures once-future patrol logs, re-credits any deltas, re-groups the Patrol Log
      try { refreshDashboard_(true); } catch (e) { log_('processDailyLOAs.dashboard', e); } // nightly = full discovery rescan (self-heals renames/missed tabs daily)
      logInfo_('processDailyLOAs', `scanned ${summary.scanned}, expired ${summary.expired.length}, started ${summary.started.length}.`);
    } finally {
      lock.releaseLock();
    }
    try { if (typeof publishPublicRoster === 'function') publishPublicRoster(); } catch (e) { log_('processDailyLOAs.publish', e); } // refresh the public copy
    // Confirm to the operator on a MANUAL run only — the daily trigger runs headless (no UI), so getUi() is guarded.
    if (summary) {
      let ui = null; try { ui = SpreadsheetApp.getUi(); } catch (e) { /* time-driven trigger context — no UI */ }
      if (ui) {
        const names = (arr) => arr.slice(0, 6).map((x) => x.name || ('Row ' + x.row)).join(', ') + (arr.length > 6 ? `, +${arr.length - 6}` : '');
        ui.alert(`✅ Schedule check complete.\n\n• Scanned ${summary.scanned} active leave(s)\n• Started ${summary.started.length}${summary.started.length ? ' — ' + names(summary.started) : ''}\n• Expired ${summary.expired.length}${summary.expired.length ? ' — ' + names(summary.expired) : ''}`);
      }
    }
  });
}

/**
 * Injectable scheduler core. Expires past-end Approved leaves and starts due ones.
 * @param {Date} today - "today" at midnight (injected so tests can simulate dates).
 * @param {{sendWebhooks?: boolean}} [opts]
 * @return {{expired: Array, started: Array, scanned: number}} summary for tests.
 */
function processDailyLOAs_(roster, tracker, today, opts = {}) {
  const sendWebhooks = opts.sendWebhooks !== false;
  const summary = { expired: [], started: [], scanned: 0 };
  const lastRow = tracker.getLastRow();
  if (lastRow < CONFIG.trackerStartRow) return summary;

  const n = lastRow - CONFIG.trackerStartRow + 1;
  const TC = trackerCols_(tracker); // header-resolved TRACKER columns (any layout)
  const data = tracker.getRange(CONFIG.trackerStartRow, 2, n, TC.width - 1).getValues(); // cols B..(width)
  const trkIds = tracker.getRange(CONFIG.trackerStartRow, TC.discord, n, 1).getDisplayValues(); // IDs as EXACT text — getValues would round a 17-19 digit ID
  const statusOut = data.map((r) => [r[TC.status - 2]]);

  const RC = rosterCols_(roster);
  const rCount = Math.max(0, roster.getLastRow() - CONFIG.rosterStartRow + 1);
  const rosterIds = rCount ? roster.getRange(CONFIG.rosterStartRow, RC.discord, rCount, 1).getDisplayValues() : [];
  const activity = rCount ? roster.getRange(CONFIG.rosterStartRow, RC.activity, rCount, 1).getValues() : [];
  const origActivity = activity.map((r) => r[0]); // snapshot BEFORE we mutate in-memory — used to detect concurrent edits at write time (F-007)
  const rRank = rCount ? roster.getRange(CONFIG.rosterStartRow, RC.rank, rCount, 1).getValues() : [];
  const rHrs = rCount ? roster.getRange(CONFIG.rosterStartRow, RC.hours, rCount, 1).getValues() : [];

  const idToIndex = new Map();
  rosterIds.forEach(([id], k) => {
    const key = String(id).trim();
    if (key !== '' && !idToIndex.has(key)) idToIndex.set(key, k);
  });

  const changedRis = new Set(); // only the member rows we actually change — written back individually so we never clobber an unrelated concurrent edit
  const expirations = [];
  const APPROVED = CONFIG.approvedStatus; // config-driven leave-active state (default 'Approved')
  const EXPIRED = CONFIG.expiredStatus;   // config-driven leave-terminal state (default 'Expired')
  const okToChange = (ri, type) => (ri !== -1) && (!isProtectedStatus_(activity[ri][0]) || activity[ri][0] === type);

  // PASS 1 — expire approved leaves whose end date has passed (the end date is the return day).
  for (let i = 0; i < n; i++) {
    summary.scanned++;
    const discordId = String(trkIds[i][0]).trim(); // exact ID text (not the coercion-prone getValues cell)
    if (!discordId) continue;
    const status = data[i][TC.status - 2];
    const end = startOfDay_(new Date(data[i][TC.end - 2]));
    if (status === APPROVED && isNaN(end.getTime())) {
      logWarn_('processDailyLOAs_', `tracker row ${CONFIG.trackerStartRow + i} is ${APPROVED} but has no valid End date; it will not auto-expire.`);
    }
    if (status !== APPROVED || isNaN(end.getTime()) || today.getTime() < end.getTime()) continue;
    const type = trackerLeaveType_();
    const ri = idToIndex.has(discordId) ? idToIndex.get(discordId) : -1;
    statusOut[i][0] = EXPIRED;
    if (okToChange(ri, type)) { // recompute from hours (a 0h return is Inactive, not Active)
      activity[ri][0] = computeStatus_(rRank[ri][0], parseHours_(rHrs[ri][0]));
      changedRis.add(ri);
    }
    expirations.push({ name: data[i][TC.name - 2], rank: data[i][TC.rank - 2], id: discordId, type });
    summary.expired.push({ row: CONFIG.trackerStartRow + i, name: data[i][TC.name - 2], id: discordId });
  }

  // PASS 2 — start approved leaves whose start date has arrived. Runs AFTER all expiries so a leave
  // starting today deterministically WINS over a different leave expiring the same day (no tracker row-order dependence).
  for (let i = 0; i < n; i++) {
    if (statusOut[i][0] === EXPIRED) continue; // a leave that expired this run can't also "start"
    const discordId = String(trkIds[i][0]).trim();
    if (!discordId) continue;
    const status = data[i][TC.status - 2];
    if (status !== APPROVED) continue;
    const start = startOfDay_(new Date(data[i][TC.start - 2]));
    if (isNaN(start.getTime()) || today.getTime() < start.getTime()) continue;
    const type = trackerLeaveType_();
    const ri = idToIndex.has(discordId) ? idToIndex.get(discordId) : -1;
    if (okToChange(ri, type)) { activity[ri][0] = type; changedRis.add(ri); }
    summary.started.push({ row: CONFIG.trackerStartRow + i, name: data[i][TC.name - 2], rank: data[i][TC.rank - 2], id: discordId, type });
  }

  // F-007: guard both write-backs against a concurrent structural change during the (potentially slow) compute window.
  // If the tracker changed size, a bulk write of `n` rows would misalign — skip it; the run is idempotent and reconciles next time.
  if (tracker.getLastRow() === lastRow) {
    tracker.getRange(CONFIG.trackerStartRow, TC.status, n, 1).setValues(statusOut);
  } else {
    logWarn_('processDailyLOAs_', `the tracker changed size during the run (was ${lastRow}, now ${tracker.getLastRow()}); skipping the status write-back to avoid misaligning rows — it will reconcile on the next run.`);
  }
  // Per-row roster writes re-read the cell first: if a human edited a member's activity during the window, respect it (skip).
  changedRis.forEach((ri) => {
    const cell = roster.getRange(CONFIG.rosterStartRow + ri, RC.activity);
    if (String(cell.getValue()) !== String(origActivity[ri])) {
      logInfo_('processDailyLOAs_', `roster row ${CONFIG.rosterStartRow + ri} was edited during the run — leaving the concurrent value in place.`);
      return;
    }
    cell.setValue(activity[ri][0]);
  });
  if (sendWebhooks) {
    if (CONFIG.notify && CONFIG.notify.leaveStarted) {
      summary.started.forEach((s) => {
        notifyEvent_('LOA', true, 'loaStarted', { name: s.name, rank: s.rank, type: s.type }, {
          title: fill_(CONFIG.notify.startedTitle, { type: s.type }),
          color: hexToInt_(CONFIG.notify.startedColor, 5154774),
          fields: [
            { name: '👤 Name', value: clamp_(dash_(s.name), 1000), inline: true },
            { name: '🛡️ Rank', value: clamp_(dash_(withIcon_(s.rank)), 1000), inline: true },
          ],
        }, mention_(s.id));
        Utilities.sleep(300);
      });
    }
    expirations.forEach((ex) => {
      sendExpirationWebhook(ex.name, ex.rank, ex.id, ex.type);
      Utilities.sleep(300); // stay under Discord's webhook rate limit on a mass expiry
    });
  }
  return summary;
}

/** Activates a just-approved leave immediately if its start date has arrived. */
function checkImmediateLOAStart(sheet, row) {
  const roster = getSheetOrWarn_(SpreadsheetApp.getActive(), CONFIG.sheets.roster);
  if (!roster) return;
  const RC = trackerCols_(sheet);
  const discordId = sheet.getRange(row, RC.discord).getDisplayValue(); // exact ID text — getValue would round a 17-19 digit ID
  const type = trackerLeaveType_(); // LOA-only tracker: no per-row TYPE column
  const start = startOfDay_(new Date(sheet.getRange(row, RC.start).getValue()));
  const end = startOfDay_(new Date(sheet.getRange(row, RC.end).getValue()));
  const today = todayInSheetTz_();
  const ui = SpreadsheetApp.getUi();

  if (!isNaN(end.getTime()) && today.getTime() >= end.getTime()) {
    ui.alert("⚠️ This leave's end date has already passed — not activating.");
    return;
  }
  if (!isNaN(start.getTime()) && start.getTime() <= today.getTime()) {
    updateRosterStatus(roster, discordId, type);
    ui.alert(`✅ Member status updated to ${type} on the roster.`);
  }
}

/** Sets a member's roster activity by Discord ID (first match wins; string compare). */
function updateRosterStatus(roster, discordId, newStatus) {
  const lastRow = roster.getLastRow();
  if (lastRow < CONFIG.rosterStartRow) return;
  const RC = rosterCols_(roster);
  const target = String(discordId).trim();
  if (target === '') return;
  const ids = roster.getRange(CONFIG.rosterStartRow, RC.discord, lastRow - CONFIG.rosterStartRow + 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === target) {
      try { roster.getRange(CONFIG.rosterStartRow + i, RC.activity).setValue(newStatus); }
      catch (err) { log_('updateRosterStatus', err); }
      return;
    }
  }
}

/* ======================================================================
 * LOA TRACKER HELPERS — LOA-only layout (A key · B rank · C unit · D OOC ·
 * E name · F unique-ID · G shift · H start · I end · J len · K until · L left ·
 * M return · N status · O approved-by · P notes). No per-row TYPE column.
 * ====================================================================== */

/** The tracker has no TYPE column (LOA-only). The implicit leave type = first configured leave type, else 'LOA'. */
function trackerLeaveType_() {
  try { return (CONFIG.leaveTypes && CONFIG.leaveTypes[0]) || 'LOA'; } catch (e) { return 'LOA'; }
}

/** Look up a member's roster details — name, rank, unit/callsign, OOC name, shift — by Unique ID (exact text). The
 * roster is the source of truth for a leave's identity fields. `found` is false when the ID isn't on the roster. */
function rosterOocShift_(discordId, idx) {
  const out = { found: false, name: '', rank: '', unit: '', ooc: '', shift: '' };
  const target = String(discordId || '').trim();
  if (!target) return out;
  if (idx && idx.n) { // prebuilt patrolRosterIndex_ snapshot: one roster read serves a whole batch of lookups
    for (let i = 0; i < idx.n; i++) {
      if (String(idx.ids[i][0]).trim() !== target) continue;
      const iv = (arr) => (arr && arr.length > i) ? String(arr[i][0] == null ? '' : arr[i][0]).trim() : '';
      out.found = true;
      out.name = iv(idx.names); out.rank = iv(idx.ranks); out.unit = iv(idx.units); out.ooc = iv(idx.oocs); out.shift = iv(idx.shifts);
      break;
    }
    return out;
  }
  try {
    const roster = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster);
    if (!roster) return out;
    const RC = rosterCols_(roster);
    if (!RC.discord) return out;
    const start = CONFIG.rosterStartRow, last = roster.getLastRow();
    if (last < start) return out;
    const ids = roster.getRange(start, RC.discord, last - start + 1, 1).getDisplayValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() !== target) continue;
      const row = start + i;
      const get = (c) => c ? String(roster.getRange(row, c).getDisplayValue()).trim() : '';
      out.found = true;
      out.name = get(RC.name); out.rank = get(RC.rank); out.unit = get(RC.unit); out.ooc = get(RC.ooc); out.shift = get(RC.shift);
      break;
    }
  } catch (e) { log_('rosterOocShift_', e); }
  return out;
}

/**
 * onEdit helper: when a Unique ID is entered on a tracker data row, auto-fill the member's rank / unit-callsign / OOC /
 * name / shift from the roster (source of truth), plus the dedup key, a default Pending status, and the computed
 * formulas — so a leave needs only a Unique ID + start + end. A member NOT on the roster still gets the key/status/
 * formulas (identity fields left blank). Best-effort; never throws into the trigger.
 */
function autoFillTrackerRow_(tracker, row, TC, id, idx) {
  try {
    if (!isValidId_(id)) return;
    const mi = rosterOocShift_(id, idx); // full roster record by Unique ID (idx = prebuilt snapshot for bulk pastes)
    const put = (c, v) => { if (c && v !== undefined && String(v) !== '') tracker.getRange(row, c).setValue(v); };
    if (mi.found) { put(TC.rank, mi.rank); put(TC.unit, mi.unit); put(TC.ooc, mi.ooc); put(TC.name, mi.name); put(TC.shift, mi.shift); }
    if (TC.discord) tracker.getRange(row, TC.discord).setNumberFormat('@'); // keep the ID exact
    if (TC.key && !String(tracker.getRange(row, TC.key).getValue()).trim()) tracker.getRange(row, TC.key).setValue(makeLeaveKey_(id, new Date()));
    if (TC.status && !String(tracker.getRange(row, TC.status).getValue()).trim()) tracker.getRange(row, TC.status).setValue(CONFIG.pendingStatus);
    writeLeaveFormulas_(tracker, row, TC);
  } catch (e) { log_('autoFillTrackerRow_', e); }
}

/** The computed-leave formula strings for tracker row r, referencing the resolved START/END columns (RC). */
function leaveFormulaStrings_(RC, r) {
  const s = String.fromCharCode(64 + RC.start) + r, e = String.fromCharCode(64 + RC.end) + r; // e.g. H8 / I8
  // Every branch is ISNUMBER-guarded: a blank OR non-date cell yields "" (never #VALUE!). This also protects the
  // header — if a formula ever lands on a text row, it shows blank instead of "INT of text" #VALUE! errors.
  return {
    len: `=IF(AND(ISNUMBER(${s}),ISNUMBER(${e})), LET(d, INT(${e})-INT(${s}), d & IF(d=1, " Day", " Days")), "")`,
    until: `=IF(ISNUMBER(${s}), IF(INT(${s})>TODAY(), LET(d, INT(${s})-TODAY(), d & IF(d=1, " Day", " Days")), "Started"), "")`,
    left: `=IF(AND(ISNUMBER(${s}),ISNUMBER(${e})), IF(INT(${s})>TODAY(), "Pending Start", IF(INT(${e})<=TODAY(), "Expired", LET(d, INT(${e})-TODAY(), d & IF(d=1, " Day", " Days")))), "")`,
    ret: `=IF(ISNUMBER(${e}), INT(${e})+1, "")`,
  };
}

/** Write the computed leave columns that EXIST on this tracker for row r (length · time-until-start · time-left · return date). Absent columns are skipped. */
function writeLeaveFormulas_(tracker, r, RC) {
  RC = RC || trackerCols_(tracker);
  if (!RC.start || !RC.end) return; // no date columns → nothing to compute
  const f = leaveFormulaStrings_(RC, r);
  if (RC.length) tracker.getRange(r, RC.length).setFormula(f.len);
  if (RC.untilStart) tracker.getRange(r, RC.untilStart).setFormula(f.until);
  if (RC.timeLeft) tracker.getRange(r, RC.timeLeft).setFormula(f.left);
  if (RC.returnDate) tracker.getRange(r, RC.returnDate).setFormula(f.ret).setNumberFormat('d mmm. yyyy');
}

/** Auto-detect the tracker's label row (the row holding a STATUS label plus a NAME/START/END label), scanning the top rows. @return {number} 1-based row, or 0 if not found. */
function trackerLabelRow_(tracker) {
  const scan = Math.min(15, tracker.getLastRow());
  if (scan < 1) return 0;
  const w = Math.max(1, tracker.getLastColumn());
  const grid = tracker.getRange(1, 1, scan, w).getDisplayValues();
  for (let r = 0; r < scan; r++) {
    const up = grid[r].map((x) => String(x).toUpperCase());
    const hasStatus = up.some((h) => h.indexOf('STATUS') !== -1);
    const hasField = up.some((h) => h === 'NAME' || h.indexOf('START') !== -1 || h.indexOf('END') !== -1);
    if (hasStatus && hasField) return r + 1;
  }
  return 0;
}

/**
 * Resolve the LOA Tracker's columns by HEADER LABEL (auto-detected label row) so any column arrangement works — an
 * operator can rename, reorder, or OMIT columns (e.g. no Return Date, since End Date already tells you when it ends).
 * Column A (the hidden dedup key) has no header, so it's always 1. When no header row is detected, falls back to the
 * classic CONFIG.tracker fixed positions. 1-based; 0 = that column isn't present. @return {Object} resolved columns
 * + labelRow + width (the furthest column, for block reads/writes).
 */
function trackerCols_(tracker) {
  const T = CONFIG.tracker;
  const out = { key: 1, rank: T.rank, unit: T.unit, ooc: T.ooc, name: T.name, discord: T.discord, shift: T.shift, start: T.start, end: T.end, length: T.length, untilStart: T.untilStart, timeLeft: T.timeLeft, returnDate: T.returnDate, status: T.status, approvedBy: T.approvedBy, notes: T.notes, labelRow: 0, width: 16 };
  try {
    const labelRow = trackerLabelRow_(tracker);
    if (labelRow) {
      out.labelRow = labelRow;
      const w = Math.max(1, tracker.getLastColumn());
      const hdr = tracker.getRange(labelRow, 1, 1, w).getDisplayValues()[0].map((h) => String(h).toUpperCase().trim());
      const find = (pred) => { for (let i = 0; i < hdr.length; i++) { if (hdr[i] && pred(hdr[i])) return i + 1; } return 0; };
      // Header detected → resolve EVERY column from the labels (0 = genuinely absent, e.g. no RETURN DATE column).
      out.rank = find((h) => h.indexOf('RANK') !== -1 && h.indexOf('GROUP') === -1);
      out.unit = find((h) => (h.indexOf('UNIT') !== -1 && h.indexOf('COMMUNITY') === -1) || h.indexOf('CALLSIGN') !== -1);
      out.ooc = find((h) => h.indexOf('OOC') !== -1);
      out.name = find((h) => h === 'NAME' || (h.indexOf('NAME') !== -1 && h.indexOf('OOC') === -1 && h.indexOf('UNIQUE') === -1));
      out.discord = find((h) => h.indexOf('UNIQUE') !== -1 || h.indexOf('DISCORD') !== -1 || h.indexOf('CID') !== -1 || h.indexOf('COMMUNITY ID') !== -1);
      out.shift = find((h) => h.indexOf('SHIFT') !== -1 || h.indexOf('DIVISION') !== -1 || h.indexOf('DISTRICT') !== -1);
      out.start = find((h) => h.indexOf('START') !== -1);
      out.end = find((h) => h.indexOf('END') !== -1);
      out.length = find((h) => h.indexOf('LENGTH') !== -1 || h === 'LEN');
      out.untilStart = find((h) => h.indexOf('UNTIL') !== -1);
      out.timeLeft = find((h) => h.indexOf('TIME LEFT') !== -1 || (h.indexOf('LEFT') !== -1 && h.indexOf('UNTIL') === -1));
      out.returnDate = find((h) => h.indexOf('RETURN') !== -1);
      out.status = find((h) => h.indexOf('STATUS') !== -1);
      out.approvedBy = find((h) => h.indexOf('APPROV') !== -1);
      out.notes = find((h) => h.indexOf('NOTE') !== -1);
    }
  } catch (e) { log_('trackerCols_', e); }
  out.width = Math.max(out.key, out.rank, out.unit, out.ooc, out.name, out.discord, out.shift, out.start, out.end, out.length, out.untilStart, out.timeLeft, out.returnDate, out.status, out.approvedBy, out.notes, 16);
  return out;
}

/** Build a tracker VALUE row (width W) placing each provided field at its resolved column; absent columns (0) + omitted fields stay blank. */
function buildTrackerRow_(RC, W, f) {
  const row = new Array(W).fill('');
  const put = (col, val) => { if (col >= 1 && col <= W && val !== undefined) row[col - 1] = val; };
  put(RC.key, f.key); put(RC.rank, f.rank); put(RC.unit, f.unit); put(RC.ooc, f.ooc);
  put(RC.name, f.name); put(RC.discord, f.discord); put(RC.shift, f.shift);
  put(RC.start, f.start); put(RC.end, f.end); put(RC.status, f.status);
  put(RC.approvedBy, f.approvedBy); put(RC.notes, f.notes);
  return row;
}

/**
 * Group the LOA Tracker by STATUS — order = [LEAVE].STATUS_FLOW (default: Pending → Approved → Denied → Expired) —
 * via a STABLE, VALUE-ONLY rewrite: the cells stay put (your row banding / STATUS dropdown / borders are preserved),
 * only the leave data is reordered into them. Regenerates the four computed columns + the ID/date formats (they
 * reference the physical row, so a reorder must rewrite them). Pass `prepend` (a new leave's 16-value row) to seat a
 * just-added leave at the very TOP first, so it lands at the top of the Pending group. Best-effort; never throws.
 * @param {Array} [prepend] a 16-column value row to add at the top before sorting.
 * @param {Sheet} [trackerSheet] the tracker to sort (defaults to the live tracker tab; the injectable add-cores pass their own so tests + white-label runs stay isolated).
 */
function sortTracker_(prepend, trackerSheet) {
  try {
    try { if (typeof publishMarkDirty_ === 'function') publishMarkDirty_(); } catch (ig) {}
    const tracker = trackerSheet || SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.tracker);
    if (!tracker) return;
    const RC = trackerCols_(tracker), start = CONFIG.trackerStartRow, W = RC.width;
    if (!RC.status) return; // no STATUS column resolved → nothing to group by
    // SAFETY: never write into the header. If TRACKER_START_ROW points AT/ABOVE the label row, bail — a misconfigured
    // start would otherwise overwrite the header labels (and drop INT-of-text formulas → #VALUE!).
    if (RC.labelRow && start <= RC.labelRow) {
      logWarn_('sortTracker_', `TRACKER_START_ROW (${start}) is at/above the tracker header (row ${RC.labelRow}); auto-sort skipped to protect the header. Set [ROSTER_LAYOUT].TRACKER_START_ROW to the FIRST DATA ROW.`);
      return;
    }
    const last = tracker.getLastRow();
    const records = [];
    if (last >= start) {
      const n = last - start + 1;
      const vals = tracker.getRange(start, 1, n, W).getValues();                        // Dates preserved
      const ids = RC.discord ? tracker.getRange(start, RC.discord, n, 1).getDisplayValues() : null; // exact ID text
      for (let i = 0; i < n; i++) {
        const row = vals[i].slice(0, W);
        if (ids) row[RC.discord - 1] = String(ids[i][0]).trim();                         // keep the ID exact (getValues rounds a digit string)
        const idv = RC.discord ? String(row[RC.discord - 1] || '').trim() : '';
        if (!String(row[RC.key - 1] || '').trim() && !String(row[RC.name - 1] || '').trim() && !idv) continue; // skip blank rows
        records.push(row);
      }
    }
    if (prepend && prepend.length) {
      // ONE row (an array of values) or SEVERAL (an array of rows) — the form sync seats a whole batch in one pass
      // instead of paying a full tracker read+rewrite per leave.
      const rowsIn = Array.isArray(prepend[0]) ? prepend : [prepend];
      for (let k = rowsIn.length - 1; k >= 0; k--) records.unshift(rowsIn[k].slice(0, W));
    }
    if (!records.length) return;

    // Status priority from [LEAVE].STATUS_FLOW (Pending < Approved < Denied < Expired); unknown/blank → bottom.
    let flow = ['Pending', 'Approved', 'Denied', 'Expired'];
    try { const f = cfg_().leave.STATUS_FLOW; if (f && f.length) flow = f; } catch (e) { /* config broken — classic order */ }
    const rankOf = {}; flow.forEach((s, i) => { rankOf[norm_(s)] = i; });
    const prio = (row) => { const k = norm_(String(row[RC.status - 1] || '').trim()); return (k in rankOf) ? rankOf[k] : flow.length; };
    const dec = records.map((row, i) => ({ row: row, i: i, p: prio(row) }));
    dec.sort((a, b) => (a.p - b.p) || (a.i - b.i)); // stable: ties keep prior order, so a prepended new leave stays on top
    const sorted = dec.map((d) => d.row);

    // Write reordered VALUES back into the SAME physical rows. '@' the ID column BEFORE writing so long IDs stay exact.
    if (start + sorted.length - 1 > tracker.getMaxRows()) tracker.insertRowsAfter(tracker.getMaxRows(), start + sorted.length - 1 - tracker.getMaxRows());
    if (RC.discord) tracker.getRange(start, RC.discord, sorted.length, 1).setNumberFormat('@');
    // Merge-safe: a merged cell anywhere in the tracker's data rows would make a full-width setValues throw, and this
    // whole function is wrapped in a catch — so sorting would silently stop working.
    writeValuesSafe_(tracker, start, 1, sorted, null);
    if (last > start + sorted.length - 1) tracker.getRange(start + sorted.length, 1, last - (start + sorted.length) + 1, W).clearContent(); // blank any now-unused trailing rows

    // Date formats + regenerated computed columns (batched setFormulas — only the columns that actually exist).
    if (RC.start) tracker.getRange(start, RC.start, sorted.length, 1).setNumberFormat('d mmm. yyyy');
    if (RC.end) tracker.getRange(start, RC.end, sorted.length, 1).setNumberFormat('d mmm. yyyy');
    if (RC.start && RC.end) {
      const lenF = [], untF = [], lftF = [], retF = [];
      for (let k = 0; k < sorted.length; k++) { const f = leaveFormulaStrings_(RC, start + k); lenF.push([f.len]); untF.push([f.until]); lftF.push([f.left]); retF.push([f.ret]); }
      if (RC.length) tracker.getRange(start, RC.length, sorted.length, 1).setFormulas(lenF);
      if (RC.untilStart) tracker.getRange(start, RC.untilStart, sorted.length, 1).setFormulas(untF);
      if (RC.timeLeft) tracker.getRange(start, RC.timeLeft, sorted.length, 1).setFormulas(lftF);
      if (RC.returnDate) tracker.getRange(start, RC.returnDate, sorted.length, 1).setFormulas(retF).setNumberFormat('d mmm. yyyy');
    }
  } catch (e) { logWarn_('sortTracker_', 'tracker sort failed: ' + ((e && e.message) ? e.message : e)); }
}

/* ======================================================================
 * LEAVE FORM SYNC
 * ====================================================================== */

/** Menu action: sync leave forms now. */
function manualSyncLOA() {
  runAction_('Sync Leave Forms', () => {
    const res = syncFormToTracker();
    SpreadsheetApp.getUi().alert(
      res === false ? 'Sync skipped — another sync is already running.'
        : res > 0 ? `✅ Synced ${res} new leave form${res === 1 ? '' : 's'} to the tracker.`
          : '✅ Sync complete — no new leave forms to add.');
  });
}

/* ======================================================================
 * PATROL LOG → HOURS
 * An operator-linked Google Form logs patrol sessions; each new submission
 * credits its patrol time to the matching member's HOURS. OFF until
 * [SHEETS].PATROL_RESPONSES names the form's response tab. Runs from the same
 * onFormSubmit trigger as the leave sync (each self-guards by its own tab).
 * ====================================================================== */

/** Resolve patrol-form columns by header keyword — the operator links their OWN form, so column order is unknown. 1-based; -1 if absent. */
function patrolCols_(sheet) {
  const out = { timestamp: 1, discord: -1, callsign: -1, start: -1, end: -1, duration: -1 };
  try {
    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) return out;
    const hdr = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map((h) => norm_(h));
    const find = (kw) => { const k = norm_(kw); if (!k) return -1; for (let c = 0; c < hdr.length; c++) { if (hdr[c].indexOf(k) !== -1) return c + 1; } return -1; };
    const P = CONFIG.patrol;
    out.discord = find(P.colDiscord); out.callsign = find(P.colCallsign);
    out.start = find(P.colStart); out.end = find(P.colEnd); out.duration = find(P.colDuration);
  } catch (e) { log_('patrolCols_', e); }
  return out;
}

/**
 * Find the member ROW to credit. Safe-by-construction against mis-credits (a patrol must NEVER hit the wrong member):
 *   • If a Discord ID is PROVIDED, it must be valid AND on the roster — else return -1 (flag it; we never "guess" a
 *     member by callsign when the submitter gave an ID, because a typo'd-but-real ID could collide with someone's callsign).
 *   • Only when NO ID is given do we fall back to callsign, and ONLY when it matches EXACTLY ONE member (a reassigned /
 *     stale / duplicated callsign is ambiguous → refuse rather than credit the first row). @return {number} 1-based row, or -1.
 */
/**
 * Snapshot the four roster columns patrolFindRow_ matches on, so a caller sweeping many rows reads them ONCE instead
 * of once per lookup. Safe to hold for the length of one execution: patrol crediting only ever writes HOURS and
 * ACTIVITY in place (updateStatusFromHours), so no row ever moves under a cached index.
 */
function patrolRosterIndex_(roster) {
  const RC = rosterCols_(roster);
  const last = roster.getLastRow();
  const n = last - CONFIG.rosterStartRow + 1;
  if (n < 1) return { RC: RC, n: 0, ranks: [], names: [], ids: [], units: [], oocs: [], shifts: [] };
  const col = (c, disp) => {
    const rg = roster.getRange(CONFIG.rosterStartRow, c, n, 1);
    return disp ? rg.getDisplayValues() : rg.getValues();
  };
  return { RC: RC, n: n, ranks: col(RC.rank), names: col(RC.name), ids: col(RC.discord, true), units: col(RC.unit, true),
    oocs: RC.ooc ? col(RC.ooc, true) : [], shifts: RC.shift ? col(RC.shift, true) : [] }; // full identity so sweeps/fills never re-read per cell
}

/** @param {Object=} idx optional prebuilt patrolRosterIndex_ — pass it when looking up in a loop. */
function patrolFindRow_(roster, discord, callsign, idx) {
  const X = idx || patrolRosterIndex_(roster);
  const n = X.n;
  if (n < 1) return -1;
  const id = String(discord == null ? '' : discord).trim();
  if (id !== '') { // an ID was given — trust it, don't fall back to callsign
    if (!isValidId_(id)) return -1; // malformed ID → error (operator fixes it), not a callsign guess
    for (let i = 0; i < n; i++) { if (isValidMemberValues_(X.ranks[i][0], X.names[i][0]) && String(X.ids[i][0]).trim() === id) return CONFIG.rosterStartRow + i; }
    return -1; // valid ID but not on the roster → error, NOT a callsign fallback
  }
  const cs = norm_(callsign); // no ID → callsign fallback, but only if it uniquely identifies a member
  if (cs) {
    let hit = -1, count = 0;
    for (let i = 0; i < n; i++) { if (isValidMemberValues_(X.ranks[i][0], X.names[i][0]) && norm_(X.units[i][0]) === cs) { hit = CONFIG.rosterStartRow + i; count++; } }
    if (count === 1) return hit; // unambiguous — safe to credit; 0 or 2+ falls through to -1
  }
  return -1;
}

/** Compute a patrol's hours from raw cell values per [PATROL].MODE. @return {number|null} hours (>0, <= MAX_HOURS), or null if invalid. */
function patrolDuration_(startVal, endVal, durVal) {
  const P = CONFIG.patrol;
  let hours;
  if (norm_(P.mode) === 'DURATION') {
    hours = parseHours_(durVal);
  } else { // START_END — Google Forms time/datetime answers arrive as Date objects
    const s = (startVal instanceof Date) ? startVal : new Date(startVal);
    const e = (endVal instanceof Date) ? endVal : new Date(endVal);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
    let ms = e.getTime() - s.getTime();
    if (ms < 0 && P.overnight) ms += 86400000; // crossed midnight
    hours = ms / 3600000;
  }
  hours = Math.round(hours * 100) / 100;
  if (!(hours > 0) || hours > P.maxHours) return null; // reject 0 / negative / absurd
  return hours;
}

/** Find or create the durable "_Credited" dedup-key column on the patrol response tab (a data column that survives a lost row background). @return {number} 1-based col. */
function patrolMarkerCol_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol >= 1) {
    const hdr = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map((h) => norm_(h));
    for (let c = 0; c < hdr.length; c++) { if (hdr[c] === norm_('_Credited')) return c + 1; }
  }
  const col = lastCol + 1;
  sheet.getRange(1, col).setValue('_Credited');
  return col;
}

/**
 * Injectable core: credit each UNPROCESSED patrol-form row to the matching member's HOURS. Idempotency is DURABLE — a
 * dedup key is written to the "_Credited" column BEFORE the roster is touched and flushed, so a log can NEVER be credited
 * twice even if the run dies mid-row, setBackground throws, or the row's colour is later cleared/sorted. Rows with a bad
 * time or no matching member are painted red and RE-TRIED on the next run (so a later fix takes effect). Returns a summary.
 */
function syncPatrolHours_(patrolSheet, roster, opts = {}) {
  const sendWebhooks = opts.sendWebhooks !== false;
  const summary = { credited: [], hoursAdded: 0, errored: 0, scanned: 0, flags: [] };
  const last = patrolSheet.getLastRow();
  if (last < 2) return summary; // header only
  const RC = rosterCols_(roster);
  const cols = patrolCols_(patrolSheet);          // resolve DATA columns by header keyword FIRST (before we add the marker col)
  const markCol = patrolMarkerCol_(patrolSheet);  // durable per-row dedup key column
  const width = patrolSheet.getLastColumn();       // now includes markCol
  const n = last - 1;
  const bgs = patrolSheet.getRange(2, 1, n, 1).getBackgrounds();
  const grid = patrolSheet.getRange(2, 1, n, width).getValues();
  const done = String(CONFIG.bg.done).toLowerCase();
  for (let i = 0; i < n; i++) {
    const marker = String(grid[i][markCol - 1] == null ? '' : grid[i][markCol - 1]).trim();
    const bg = String(bgs[i][0] || '').toLowerCase();
    if (marker !== '' || bg === done) continue; // durably credited already → NEVER re-credit
    summary.scanned++;
    const rowIndex = 2 + i;
    const cell = (c) => (c > 0 && c <= width) ? grid[i][c - 1] : '';
    const markErr = (reason) => {
      try { patrolSheet.getRange(rowIndex, 1, 1, width).setBackground(CONFIG.bg.error); } catch (e) { /* best-effort */ }
      summary.errored++; summary.flags.push({ row: rowIndex, reason: reason || 'invalid log' });
    };
    const hours = patrolDuration_(cell(cols.start), cell(cols.end), cell(cols.duration));
    if (hours === null) { markErr('bad or missing time (unparseable, zero, or over the max)'); continue; }
    const memberRow = patrolFindRow_(roster, cell(cols.discord), cell(cols.callsign));
    if (memberRow === -1) { markErr('no matching member (unknown Discord ID / callsign)'); continue; }
    try {
      // 1) DURABLE dedup key FIRST (+ flush): once written, this log can never be credited again — even if the credit
      //    below, the status recompute, or the green paint throws / is killed by the 6-min limit. Rare cost: a crash in
      //    the tiny window before the credit lands drops that one credit (recoverable), which is far safer than a double.
      patrolSheet.getRange(rowIndex, markCol).setValue('✓ ' + Utilities.formatDate(new Date(), ssTz_(), 'yyyy-MM-dd HH:mm'));
      SpreadsheetApp.flush();
      // 2) Credit the hours + recompute status.
      const cur = parseHours_(roster.getRange(memberRow, RC.hours).getValue());
      const next = Math.round((cur + hours) * 100) / 100;
      roster.getRange(memberRow, RC.hours).setValue(next);
      if (CONFIG.patrol.recompute) { try { updateStatusFromHours(roster, memberRow); } catch (e) { log_('syncPatrolHours_.recompute', e); } }
      const memberName = String(roster.getRange(memberRow, RC.name).getDisplayValue()).trim();
      const memberId = String(roster.getRange(memberRow, RC.discord).getDisplayValue()).trim();
      if (typeof auditEvent_ === 'function') { try { auditEvent_('patrol', String(cur), String(next), roster.getRange(memberRow, RC.hours).getA1Notation(), memberName); } catch (e) { /* best-effort */ } }
      patrolSheet.getRange(rowIndex, 1, 1, width).setBackground(CONFIG.bg.done);
      summary.credited.push({ name: memberName, hours: hours, total: next, discord: memberId });
      summary.hoursAdded += hours;
    } catch (e) { log_('syncPatrolHours_.credit', e); } // dedup key already written → this log is never re-credited (a partial failure is logged, not doubled)
  }
  // Notifications fire AFTER all writes (never block a credit). Off by default.
  if (sendWebhooks && CONFIG.notify && CONFIG.notify.patrolLogged) {
    summary.credited.forEach((c) => {
      notifyEvent_('PATROL', true, 'patrolLogged', { name: c.name, hours: String(c.hours), total: String(c.total) }, {
        title: fill_(CONFIG.notify.patrolTitle, { name: c.name, hours: c.hours, total: c.total }),
        color: hexToInt_(CONFIG.notify.patrolColor, 5154774),
        fields: [
          { name: '👤 Name', value: clamp_(dash_(c.name), 1000), inline: true },
          { name: '🚔 Patrol', value: `${c.hours} hr${c.hours === 1 ? '' : 's'}`, inline: true },
          { name: '⏱️ New total', value: `${c.total} hrs`, inline: true },
        ],
      }, mention_(c.discord));
      Utilities.sleep(200); // stay under Discord's webhook rate limit on a batch
    });
  }
  // Flagged rows → ONE summary embed on the PATROL channel (webhook presence = the opt-in; never per-row spam).
  if (sendWebhooks && summary.flags.length && webhookFor_('PATROL')) {
    const lines = summary.flags.slice(0, 15).map((f) => `• Row ${f.row} — ${f.reason}`);
    if (summary.flags.length > 15) lines.push(`…and ${summary.flags.length - 15} more`);
    notifyEvent_('PATROL', true, 'patrolFlagged', { count: String(summary.flags.length), rows: lines.join('\n') }, {
      title: `⚠️ ${summary.flags.length} patrol log${summary.flags.length === 1 ? '' : 's'} flagged`,
      description: clamp_(lines.join('\n') + `\n\nFlagged rows are red on "${CONFIG.sheets.patrol}" — fix them and re-run 🚔 Sync Patrol Hours.`, 4000),
      color: hexToInt_('#e0a52c', 14721324),
    }, '');
  }
  summary.hoursAdded = Math.round(summary.hoursAdded * 100) / 100;
  return summary;
}

/** Entrypoint: sync the patrol form to member hours. No-op if the feature isn't configured. @return {Object|false} summary, or false on lock-skip. */
function syncPatrolHours() {
  const patrolName = CONFIG.sheets.patrol;
  if (!patrolName) return { credited: [], hoursAdded: 0, errored: 0, scanned: 0, off: true }; // feature OFF (no response tab set)
  const ss = SpreadsheetApp.getActive();
  const patrolSheet = ss.getSheetByName(patrolName);
  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  if (!patrolSheet || !roster) return { credited: [], hoursAdded: 0, errored: 0, scanned: 0, missing: true };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return false;
  try { return syncPatrolHours_(patrolSheet, roster, { sendWebhooks: true }); }
  finally { lock.releaseLock(); }
}

/* ======================================================================
 * PATROL LOG TRACKER (manual entry — parallel to the LOA Tracker)
 * A curated tab (default "Patrol Log") where an operator enters only a
 * Unique ID + start date/time + end date/time. The engine auto-fills the
 * member's rank/unit/OOC/name/shift from the roster, computes TOTAL TIME,
 * credits the hours to the roster IMMEDIATELY, and auto-flags bad logs
 * (unknown ID, end≤start, future-dated, over [PATROL].MAX_HOURS) with a
 * one-line reason in NOTES. Rows sort Pending → Flagged → Processed.
 * Crediting is RECONCILED durably (a hidden "hours|memberId" marker in the
 * row's column A): an edit adjusts the delta, a flag/delete reverses it, so
 * a member's HOURS always equals the sum of their VALID patrol logs.
 * OFF unless a tab named [SHEETS].PATROL_LOG exists.
 * ====================================================================== */

const PATROL_DATE_FMT_ = 'd mmm. yyyy';
const PATROL_TIME_FMT_ = 'h:mm am/pm';

/** The Patrol Log's 1-based label row (scans the top rows for STATUS + a member column). 0 if none. */
function patrolLabelRow_(sheet) {
  try {
    const scan = Math.min(15, sheet.getLastRow());
    if (scan < 1) return 0;
    const grid = sheet.getRange(1, 1, scan, Math.max(1, sheet.getLastColumn())).getDisplayValues();
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r].map((h) => norm_(h));
      const has = (kw) => row.some((h) => h.indexOf(norm_(kw)) !== -1);
      if (has('STATUS') && (has('NAME') || has('UNIQUE') || has('START'))) return r + 1;
    }
  } catch (e) { log_('patrolLabelRow_', e); }
  return 0;
}

/** Header-resolve the Patrol Log columns (any order). 0 = column absent. mark = hidden credited-marker (col A). */
function patrolLogCols_(sheet) {
  const out = { mark: 1, rank: 0, unit: 0, ooc: 0, name: 0, discord: 0, shift: 0, startDate: 0, endDate: 0, startTime: 0, endTime: 0, total: 0, status: 0, notes: 0, labelRow: 0, width: 0 };
  try {
    out.labelRow = patrolLabelRow_(sheet) || (CONFIG.patrolStartRow - 2);
    const lastCol = Math.max(sheet.getLastColumn(), 14);
    const hdr = sheet.getRange(out.labelRow, 1, 1, lastCol).getDisplayValues()[0].map((h) => norm_(h));
    const all = (...toks) => { for (let c = 0; c < hdr.length; c++) { if (toks.every((t) => hdr[c].indexOf(norm_(t)) !== -1)) return c + 1; } return 0; };
    out.rank = all('RANK');
    out.unit = all('UNIT') || all('CALLSIGN');
    out.ooc = all('OOC');
    for (let c = 0; c < hdr.length; c++) { if (hdr[c].indexOf('NAME') !== -1 && (c + 1) !== out.ooc) { out.name = c + 1; break; } } // NAME that isn't "OOC NAME"
    out.discord = all('UNIQUE', 'ID') || all('DISCORD') || all('COMMUNITY', 'ID') || all('CID');
    out.shift = all('SHIFT') || all('DIVISION') || all('DISTRICT');
    out.startDate = all('START', 'DATE'); out.endDate = all('END', 'DATE');
    out.startTime = all('START', 'TIME'); out.endTime = all('END', 'TIME');
    out.total = all('TOTAL'); out.status = all('STATUS');
    out.notes = all('NOTES') || all('NOTE') || all('REASON');
    out.width = Math.max(lastCol, out.notes, out.status, out.total, out.endTime, out.endDate, out.startTime, out.startDate, out.shift, out.discord, out.name, out.ooc, out.unit, out.rank);
  } catch (e) { log_('patrolLogCols_', e); }
  return out;
}

/** Combine a DATE cell value + a TIME cell value into one Date, or null if either is missing/unparseable. */
function combineDateTime_(dateVal, timeVal) {
  const d = (dateVal instanceof Date) ? dateVal : (dateVal === '' || dateVal == null ? null : new Date(dateVal));
  if (!d || isNaN(d.getTime())) return null;
  let hh = 0, mm = 0, ss = 0;
  if (timeVal instanceof Date) { hh = timeVal.getHours(); mm = timeVal.getMinutes(); ss = timeVal.getSeconds(); }
  else if (typeof timeVal === 'number') { const s = Math.round(timeVal * 86400); hh = Math.floor(s / 3600) % 24; mm = Math.floor((s % 3600) / 60); ss = s % 60; }
  else return null; // blank/text time → treat the log as incomplete
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, ss);
}

/** ISNUMBER-guarded TOTAL TIME formula (hours, 2dp) for a Patrol Log row r: ((endDate+endTime)−(startDate+startTime))*24. */
function patrolTotalFormula_(PC, r) {
  const A1 = (c) => String.fromCharCode(64 + c) + r; // Patrol Log lives in columns A..O (single letters)
  const sd = A1(PC.startDate), st = A1(PC.startTime), ed = A1(PC.endDate), et = A1(PC.endTime);
  return `=IF(AND(ISNUMBER(${sd}),ISNUMBER(${st}),ISNUMBER(${ed}),ISNUMBER(${et})),ROUND(((${ed}+${et})-(${sd}+${st}))*24,2),"")`;
}

/**
 * Evaluate a COMPLETE patrol log → { reason, blocking }. reason='' means valid.
 *  • BLOCKING (blocking:true) = crediting is impossible/nonsensical, so an admin CANNOT approve it by changing the
 *    status — the data must be fixed: unknown member, non-positive duration, or an over-a-day span (a date typo).
 *  • ADVISORY (blocking:false) = a computable but suspicious log (over the hour max, or future-dated). Flagged by
 *    default, but an admin can APPROVE it by setting the status to Pending/Processed → the hours then credit.
 * Priority: unknown member → bad duration → over-a-day → over-max → future.
 */
function evaluatePatrolLog_(memberRow, startDT, endDT, hours, now) {
  if (memberRow === -1) return { reason: 'Unique ID not on roster.', blocking: true };
  if (!startDT || !endDT) return { reason: 'Missing or invalid start/end.', blocking: true };
  if (!(hours > 0)) return { reason: 'End is not after start.', blocking: true };
  if (hours > 24) return { reason: 'Over 24 hrs — check the dates.', blocking: true }; // a single session can't exceed a day → force a fix, don't let it be approved
  if (hours > CONFIG.patrol.maxHours) return { reason: `Exceeds ${CONFIG.patrol.maxHours} hr max.`, blocking: false };
  // Compare DATES (sheet timezone), not instants: a script/sheet timezone gap would otherwise flag a log entered
  // earlier today as "future" purely from the offset.
  const endOfToday = (function () { const t = todayInSheetTz_(); return new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 59); })();
  if (startDT.getTime() > endOfToday.getTime() || endDT.getTime() > endOfToday.getTime()) return { reason: 'Dated in the future.', blocking: false };
  return { reason: '', blocking: false };
}

/**
 * Process ONE Patrol Log data row: auto-fill member identity + TOTAL TIME, decide Pending/Flagged (+reason), and
 * reconcile the member's credited hours. Idempotent — safe on every edit and on the nightly refresh. Never throws.
 */
function processPatrolLog_(sheet, row, PC, roster, idx, rowData) {
  try {
    idx = idx || patrolRosterIndex_(roster); // one roster snapshot serves all three lookups this row makes
    // `rowData` ({vals, disp, mark, sweep}) is the sweep's ONE block read of this row — without it every disp()/rawv()
    // was its own round trip, making a 250-row nightly refresh thousands of sequential Sheets calls.
    const disp = rowData ? ((c) => c ? String(rowData.disp[c - 1] == null ? '' : rowData.disp[c - 1]).trim() : '')
      : ((c) => c ? String(sheet.getRange(row, c).getDisplayValue()).trim() : '');
    const rawv = rowData ? ((c) => c ? rowData.vals[c - 1] : '')
      : ((c) => c ? sheet.getRange(row, c).getValue() : '');
    const priorMark = rowData ? rowData.mark : null;
    const idv = disp(PC.discord);
    const anyInput = !!(idv || rawv(PC.startDate) !== '' || rawv(PC.startTime) !== '' || rawv(PC.endDate) !== '' || rawv(PC.endTime) !== '');
    if (!anyInput) { reconcilePatrolCredit_(sheet, row, PC, roster, idx.RC, null, idx, priorMark); return; } // empty/deleted row → reverse any prior credit, stay blank

    const startDT = combineDateTime_(rawv(PC.startDate), rawv(PC.startTime));
    const endDT = combineDateTime_(rawv(PC.endDate), rawv(PC.endTime));
    const complete = !!(idv && startDT && endDT);
    const RCr = idx.RC;
    const memberRow = isValidId_(idv) ? patrolFindRow_(roster, idv, '', idx) : -1;

    if (memberRow !== -1) { // fill identity from the roster snapshot (source of truth) — no per-cell roster reads
      const k = memberRow - CONFIG.rosterStartRow;
      const iv = (arr) => (arr && arr.length > k) ? String(arr[k][0] == null ? '' : arr[k][0]).trim() : '';
      const put = (c, v) => { if (c && v !== '' && (!rowData || disp(c) !== v)) sheet.getRange(row, c).setValue(v); };
      put(PC.rank, iv(idx.ranks)); put(PC.unit, iv(idx.units)); put(PC.ooc, iv(idx.oocs)); put(PC.name, iv(idx.names)); put(PC.shift, iv(idx.shifts));
    }
    if (!(rowData && rowData.sweep)) { // the sweep ends in sortPatrolLog_, which re-applies all of these batched per kept row
      if (PC.discord) sheet.getRange(row, PC.discord).setNumberFormat('@');
      if (PC.total && PC.startDate && PC.endDate && PC.startTime && PC.endTime) sheet.getRange(row, PC.total).setFormula(patrolTotalFormula_(PC, row)).setNumberFormat('0.00" hrs"');
      // Dates and TIMES both need an explicit format: a row typed by hand (or arriving on a new row past whatever the
      // sheet was formatted down to) would otherwise render a time as a raw serial or a full datetime.
      if (PC.startDate) sheet.getRange(row, PC.startDate).setNumberFormat(PATROL_DATE_FMT_);
      if (PC.endDate) sheet.getRange(row, PC.endDate).setNumberFormat(PATROL_DATE_FMT_);
      if (PC.startTime) sheet.getRange(row, PC.startTime).setNumberFormat(PATROL_TIME_FMT_);
      if (PC.endTime) sheet.getRange(row, PC.endTime).setNumberFormat(PATROL_TIME_FMT_);
    }

    const hours = (startDT && endDT) ? Math.round(((endDT.getTime() - startDT.getTime()) / 3600000) * 100) / 100 : null;
    const P = CONFIG.patrol;
    const curStatus = PC.status ? disp(PC.status) : '';
    const setStatus = (s) => { if (PC.status && norm_(curStatus) !== norm_(s)) sheet.getRange(row, PC.status).setValue(s); };
    const setNote = (t) => { if (PC.notes && disp(PC.notes) !== t) sheet.getRange(row, PC.notes).setValue(t); };

    let desired = null;
    if (!complete) {
      if (!curStatus) setStatus(P.pendingStatus); // half-entered → Pending, no credit yet
    } else {
      const ev = evaluatePatrolLog_(memberRow, startDT, endDT, hours, new Date());
      const wantsProcessed = norm_(curStatus) === norm_(P.processedStatus);
      if (ev.blocking) {
        setStatus(P.flaggedStatus); setNote(ev.reason);        // can't credit (unknown ID / bad time / date typo) → Flagged; a Processed override snaps back
      } else if (ev.reason) {
        // ADVISORY (over the hour max / future-dated): counts ONLY once an admin approves it by marking it Processed
        if (wantsProcessed) { setNote('Override: ' + ev.reason); desired = { hours: hours, mid: idv }; } // approved → credit, keep Processed
        else { setStatus(P.flaggedStatus); setNote(ev.reason); }                                        // not yet approved → Flagged, no credit
      } else {
        setStatus(P.processedStatus); setNote(''); desired = { hours: hours, mid: idv };                // fully valid → auto-mark Processed + credit
      }
    }
    reconcilePatrolCredit_(sheet, row, PC, roster, RCr, desired, idx, priorMark);
  } catch (e) { log_('processPatrolLog_', e); }
}

/**
 * Reconcile a Patrol Log row's credited hours against the roster. The row's hidden marker (col A) holds "hours|memberId"
 * of what was LAST credited; `desired` is {hours, mid} to credit now, or null. Reverses the prior credit and applies the
 * new one so a member's HOURS always equals the sum of their VALID logs — idempotent across edits, flag/unflag, ID
 * changes and deletes. The marker is written BEFORE the roster is touched (a crash under-credits, never double-credits).
 */
function reconcilePatrolCredit_(sheet, row, PC, roster, RCr, desired, idx, priorMark) {
  try {
    try { if (typeof publishMarkDirty_ === 'function') publishMarkDirty_(); } catch (ig) {}
    if (!PC.mark || !RCr.hours) return;
    const markCell = sheet.getRange(row, PC.mark);
    // `priorMark` is the sweep's cached read of this cell (each row is processed exactly once per sweep, and only this
    // function writes the marker — so the cache can't be stale). null = read live (the onEdit single-row path).
    const prior = (priorMark == null) ? String(markCell.getDisplayValue()).trim() : String(priorMark).trim();
    let priorHours = 0, priorMid = '';
    if (prior) { const p = prior.split('|'); priorHours = parseFloat(p[0]) || 0; priorMid = (p[1] || '').trim(); }
    const wantHours = desired ? (Math.round(desired.hours * 100) / 100) : 0;
    const wantMid = desired ? String(desired.mid).trim() : '';
    if (prior && priorMid === wantMid && Math.abs(priorHours - wantHours) < 0.005) return; // already exactly credited → no-op

    if (priorMid && priorHours) { // reverse the prior credit on whoever actually got it
      const prow = patrolFindRow_(roster, priorMid, '', idx);
      if (prow !== -1) {
        const cur = parseHours_(roster.getRange(prow, RCr.hours).getValue());
        roster.getRange(prow, RCr.hours).setValue(Math.round((cur - priorHours) * 100) / 100);
        if (CONFIG.patrol.recompute) { try { updateStatusFromHours(roster, prow); } catch (e) { /* best-effort */ } }
      }
    }
    // Durably "uncredited" before any re-credit (self-heals on the next process if we die here). Only when there IS a
    // marker: an uncredited row (flagged/incomplete) must not pay for a write + flush on every single edit and on every
    // row of the nightly refreshPatrolLog_ sweep.
    if (prior) { markCell.clearContent(); SpreadsheetApp.flush(); }

    if (desired && wantHours > 0 && wantMid) { // apply the new credit on the target member
      const trow = patrolFindRow_(roster, wantMid, '', idx);
      if (trow !== -1) {
        markCell.setValue(wantHours + '|' + wantMid); SpreadsheetApp.flush(); // durable marker BEFORE the credit
        const cur = parseHours_(roster.getRange(trow, RCr.hours).getValue());
        const next = Math.round((cur + wantHours) * 100) / 100;
        roster.getRange(trow, RCr.hours).setValue(next);
        if (CONFIG.patrol.recompute) { try { updateStatusFromHours(roster, trow); } catch (e) { /* best-effort */ } }
        if (typeof auditEvent_ === 'function') { try { auditEvent_('patrol', String(cur), String(next), roster.getRange(trow, RCr.hours).getA1Notation(), String(roster.getRange(trow, RCr.name).getDisplayValue()).trim()); } catch (e) { /* best-effort */ } }
      }
    }
  } catch (e) { log_('reconcilePatrolCredit_', e); }
}

/** Re-group + compact the Patrol Log by [PATROL].STATUS_FLOW (Pending → Flagged → Processed); preserves formatting, carries the marker. */
function sortPatrolLog_(patrolSheet) {
  try {
    try { if (typeof publishMarkDirty_ === 'function') publishMarkDirty_(); } catch (ig) {}
    const sheet = patrolSheet || (CONFIG.sheets.patrolLog ? SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.patrolLog) : null);
    if (!sheet) return;
    const PC = patrolLogCols_(sheet), start = CONFIG.patrolStartRow, W = PC.width;
    if (!PC.status || !W) return;
    if (PC.labelRow && start <= PC.labelRow) { logWarn_('sortPatrolLog_', `PATROL_START_ROW (${start}) is at/above the header (row ${PC.labelRow}); sort skipped.`); return; }
    const last = sheet.getLastRow();
    const records = [];
    if (last >= start) {
      const n = last - start + 1;
      const vals = sheet.getRange(start, 1, n, W).getValues();
      const ids = PC.discord ? sheet.getRange(start, PC.discord, n, 1).getDisplayValues() : null;
      for (let i = 0; i < n; i++) {
        const r = vals[i].slice(0, W);
        if (ids) r[PC.discord - 1] = String(ids[i][0]).trim();
        const idv = PC.discord ? String(r[PC.discord - 1] || '').trim() : '';
        const nmv = PC.name ? String(r[PC.name - 1] || '').trim() : '';
        if (!idv && !nmv) continue; // drop blank rows (compaction)
        records.push(r);
      }
    }
    if (!records.length) return;
    const flow = (CONFIG.patrol.statusFlow && CONFIG.patrol.statusFlow.length) ? CONFIG.patrol.statusFlow : ['Pending', 'Flagged', 'Processed'];
    const rankOf = {}; flow.forEach((s, i) => { rankOf[norm_(s)] = i; });
    const prio = (r) => { const k = norm_(String(r[PC.status - 1] || '').trim()); return (k in rankOf) ? rankOf[k] : flow.length; };
    const dec = records.map((r, i) => ({ r: r, i: i, p: prio(r) }));
    dec.sort((a, b) => (a.p - b.p) || (a.i - b.i)); // stable
    const sorted = dec.map((d) => d.r);

    if (start + sorted.length - 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), start + sorted.length - 1 - sheet.getMaxRows());
    if (PC.discord) sheet.getRange(start, PC.discord, sorted.length, 1).setNumberFormat('@');
    writeValuesSafe_(sheet, start, 1, sorted, null); // merge-safe (see sortTracker_)
    if (last > start + sorted.length - 1) sheet.getRange(start + sorted.length, 1, last - (start + sorted.length) + 1, W).clearContent();

    if (PC.total && PC.startDate && PC.endDate && PC.startTime && PC.endTime) { // TOTAL formula per physical row
      const tf = []; for (let k = 0; k < sorted.length; k++) tf.push([patrolTotalFormula_(PC, start + k)]);
      sheet.getRange(start, PC.total, sorted.length, 1).setFormulas(tf).setNumberFormat('0.00" hrs"');
    }
    if (PC.startDate) sheet.getRange(start, PC.startDate, sorted.length, 1).setNumberFormat(PATROL_DATE_FMT_);
    if (PC.endDate) sheet.getRange(start, PC.endDate, sorted.length, 1).setNumberFormat(PATROL_DATE_FMT_);
    if (PC.startTime) sheet.getRange(start, PC.startTime, sorted.length, 1).setNumberFormat(PATROL_TIME_FMT_);
    if (PC.endTime) sheet.getRange(start, PC.endTime, sorted.length, 1).setNumberFormat(PATROL_TIME_FMT_);
  } catch (e) { logWarn_('sortPatrolLog_', 'patrol sort failed: ' + ((e && e.message) ? e.message : e)); }
}

/** Nightly/refresh: re-process every Patrol Log row (matures a once-future log, re-credits deltas) + re-group. No-op if OFF. */
function refreshPatrolLog_() {
  try {
    if (!CONFIG.sheets.patrolLog) return;
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(CONFIG.sheets.patrolLog);
    const roster = ss.getSheetByName(CONFIG.sheets.roster);
    if (!sheet || !roster) return;
    const PC = patrolLogCols_(sheet);
    if (!PC.status) return;
    const last = sheet.getLastRow();
    const idx = patrolRosterIndex_(roster); // ONE roster read for the whole sweep, not three per row
    const start = CONFIG.patrolStartRow;
    let grid = null;
    if (last >= start && PC.width) { // ONE block read for the whole log — per-row disp()/rawv() made this sweep O(rows × cols) round trips
      const rg = sheet.getRange(start, 1, last - start + 1, PC.width);
      grid = { vals: rg.getValues(), disp: rg.getDisplayValues() };
    }
    for (let r = start; r <= last; r++) {
      const i = r - start;
      const rowData = grid ? {
        vals: grid.vals[i], disp: grid.disp[i], sweep: true,
        mark: PC.mark ? String(grid.disp[i][PC.mark - 1] == null ? '' : grid.disp[i][PC.mark - 1]).trim() : null,
      } : null;
      processPatrolLog_(sheet, r, PC, roster, idx, rowData);
    }
    sortPatrolLog_(sheet);
  } catch (e) { log_('refreshPatrolLog_', e); }
}

/**
 * Entrypoint: locks, syncs, then fires Discord webhooks AFTER releasing the lock
 * (so a slow network call never blocks the critical section).
 * @return {boolean} false if the lock could not be acquired.
 */
function syncFormToTracker() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log('syncFormToTracker: could not obtain lock, skipping.');
    return false;
  }
  let newLeaves = [];
  try {
    const ss = SpreadsheetApp.getActive();
    const form = getSheetOrWarn_(ss, CONFIG.sheets.form);
    const tracker = getSheetOrWarn_(ss, CONFIG.sheets.tracker);
    if (form && tracker) newLeaves = syncFormToTracker_(form, tracker, { sendWebhooks: false });
  } finally {
    lock.releaseLock();
  }
  newLeaves.forEach((L) => sendDiscordWebhook(L.name, L.rank, L.callsign, L.type, L.startStr, L.endStr, L.durationStr, L.discord));
  // Audit-log each leave a form submission added (so the trail covers the auto/onFormSubmit path, not just the panel).
  if (newLeaves.length && typeof auditEvent_ === 'function') {
    newLeaves.forEach((L) => { try { auditEvent_('leave', '', `${L.type} ${L.startStr}–${L.endStr} (form)`, '', L.name); } catch (e) { /* audit is best-effort */ } });
  }
  return newLeaves.length; // how many NEW leaves were appended (false is reserved for the lock-skip case above)
}

/**
 * Injectable sync core. Idempotent: a per-submission key (col A) prevents
 * duplicates even if the row color is lost. Stores REAL Date objects in
 * START/END so the INT() countdown formulas never depend on re-parsing a string.
 * @return {Array<Object>} newly-appended leaves (for the entrypoint to announce).
 */
function syncFormToTracker_(form, tracker, opts = {}) {
  const sendWebhooks = opts.sendWebhooks !== false;
  const appended = [];
  const lastRow = form.getLastRow();
  if (lastRow < 2) return appended;
  logInfo_('syncFormToTracker_', `scanning ${lastRow - 1} form row(s).`);

  const width = form.getLastColumn();
  const range = form.getRange(2, 1, lastRow - 1, width);
  const values = range.getValues();
  const backgrounds = range.getBackgrounds();
  const synced = buildSyncedKeySet_(tracker);
  const RC = trackerCols_(tracker); // resolve the tracker's columns by header (any layout)
  const tz = ssTz_();
  const doneBg = String(CONFIG.bg.done).toLowerCase(); // lowercase once — a Studio-picked theme colour can be uppercase (getBackgrounds returns lowercase)
  // ONE roster snapshot serves every rosterOocShift_ lookup below (a backfill was one full roster scan per row),
  // and accepted rows are collected so sortTracker_ runs ONCE for the whole batch, not once per leave.
  let rIdx = null;
  try { const rSh = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster); if (rSh) rIdx = patrolRosterIndex_(rSh); } catch (e) { log_('syncFormToTracker_.idx', e); }
  const accepted = [];

  for (let i = 0; i < values.length; i++) {
    const rowIndex = i + 2;
    const bg = String(backgrounds[i][0] || '').toLowerCase();
    if (bg === doneBg || bg === '#00ff00') continue;

    try {
      const row = values[i];
      const timestamp = row[CONFIG.form.timestamp - 1];
      const name = row[CONFIG.form.name - 1];
      const discord = String(row[CONFIG.form.discord - 1]).trim();
      const callsign = row[CONFIG.form.callsign - 1];
      const rank = row[CONFIG.form.rank - 1];
      const type = row[CONFIG.form.type - 1];
      const startRaw = row[CONFIG.form.start - 1];
      const endRaw = row[CONFIG.form.end - 1];

      if (!startRaw || !endRaw) { form.getRange(rowIndex, 1, 1, width).setBackground(CONFIG.bg.error); continue; }
      if (!isValidId_(discord)) { form.getRange(rowIndex, 1, 1, width).setBackground(CONFIG.bg.error); continue; }
      // LOA-only tracker: reject any non-LOA submission (e.g. an ROA form row) — the tracker has no TYPE column, so a
      // different type would sync "done" (green) yet activate/expire as the wrong status.
      const trkType = trackerLeaveType_();
      if (norm_(String(type).trim()) !== norm_(trkType)) {
        logWarn_('syncFormToTracker_', `form row ${rowIndex}: leave type "${type}" is not "${trkType}" (LOA-only tracker); marking error and skipping.`);
        form.getRange(rowIndex, 1, 1, width).setBackground(CONFIG.bg.error);
        continue;
      }

      // Form dedup key is submission-TIMESTAMP based (not date/identity based) — deliberately different from the
      // panel path (cpScheduleLeave_ uses member+dates+type). buildSyncedKeySet_ collects keys from ALL tracker rows
      // regardless of status, so re-scan idempotency depends only on the key persisting in col A. A timestamp key lets
      // a member RE-REQUEST the same dates after a denial (new submission → new timestamp → new key → new row). Do NOT
      // switch this to the composite key: it would match the denied row and silently swallow the re-request. (Cross-path
      // form+panel duplicates are harmless — processDailyLOAs_ writes are deterministic + idempotent within a run.)
      const dedupKey = makeLeaveKey_(discord, timestamp);
      if (dedupKey && synced[dedupKey]) { form.getRange(rowIndex, 1, 1, width).setBackground(CONFIG.bg.done); continue; }

      const startDate = parseFormDate_(startRaw);
      const endDate = parseFormDate_(endRaw);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        logWarn_('syncFormToTracker_', `form row ${rowIndex}: unparseable start/end date; marking error and skipping.`);
        form.getRange(rowIndex, 1, 1, width).setBackground(CONFIG.bg.error);
        continue;
      }
      const startStr = fmtDisplay_(startDate);
      const endStr = fmtDisplay_(endDate);
      const diff = Math.round(Math.abs((endDate - startDate) / 86400000));
      const durationStr = `${diff} ${diff === 1 ? 'Day' : 'Days'}`;

      // The ROSTER is the source of truth: look the member up by Unique ID and use their name/rank/unit/OOC/shift when
      // found; fall back to the form's fields only for someone not (yet) on the roster. So the form needs only ID + dates.
      const mi = rosterOocShift_(discord, rIdx);
      const fName = (mi.found && mi.name) ? mi.name : name;
      const fRank = (mi.found && mi.rank) ? mi.rank : rank;
      const fUnit = (mi.found && mi.unit) ? mi.unit : callsign;
      if (dedupKey) synced[dedupKey] = true; // in-loop, so a duplicate submission later in this same scan still dedups
      accepted.push({
        rowVals: buildTrackerRow_(RC, RC.width, { key: dedupKey, rank: fRank, unit: fUnit, ooc: mi.ooc, name: fName, discord: discord, shift: mi.shift, start: startDate, end: endDate, status: CONFIG.pendingStatus }),
        rowIndex: rowIndex,
        leaf: { name: fName, rank: fRank, callsign: fUnit, type, startStr, endStr, durationStr, discord },
      });
    } catch (err) {
      form.getRange(rowIndex, 1, 1, width).setBackground(CONFIG.bg.error);
      log_('syncFormToTracker_', err); // skip this row, keep processing the rest
    }
  }

  if (accepted.length) {
    // Prepend the whole batch at the TOP and re-group by status ONCE — new Pending leaves land at the top of the list.
    // (Per-leave sortTracker_ calls made a K-row backfill K full tracker reads + rewrites.)
    sortTracker_(accepted.map((a) => a.rowVals), tracker);
    accepted.forEach((a) => {
      if (sendWebhooks) sendDiscordWebhook(a.leaf.name, a.leaf.rank, a.leaf.callsign, a.leaf.type, a.leaf.startStr, a.leaf.endStr, a.leaf.durationStr, a.leaf.discord);
      appended.push(a.leaf);
      form.getRange(a.rowIndex, 1, 1, width).setBackground(CONFIG.bg.done);
    });
  }
  if (appended.length) logInfo_('syncFormToTracker_', `appended ${appended.length} new leave(s).`);
  return appended;
}

/** Builds a set of dedup keys already present in the tracker (col A). */
function buildSyncedKeySet_(tracker) {
  const set = {};
  const last = tracker.getLastRow();
  if (last < CONFIG.trackerStartRow) return set;
  const n = last - CONFIG.trackerStartRow + 1;
  const keys = tracker.getRange(CONFIG.trackerStartRow, trackerCols_(tracker).key, n, 1).getValues();
  keys.forEach(([k]) => {
    const key = String(k).trim();
    if (key.indexOf('KEY|') === 0) set[key] = true;
  });
  return set;
}

/** Stable per-submission dedup key (independent of date formatting). */
function makeLeaveKey_(discordId, timestamp) {
  const id = String(discordId ?? '').trim();
  if (id === '') return '';
  const ts = (timestamp instanceof Date && !isNaN(timestamp.getTime()))
    ? String(timestamp.getTime())
    : String(timestamp ?? '').trim();
  return `KEY|${id}|${ts}`;
}

/* ======================================================================
 * DISCORD WEBHOOKS
 * ====================================================================== */

const WEBHOOK_TAB_ = 'Webhooks';
const WEBHOOK_CHANNELS_ = Object.freeze(['AUDIT', 'LOA', 'PATROL', 'ERRORS']);
let _webhookMemo_ = null; // per-execution only — NEVER cached anywhere shared (the admin file's ACL is the gate)

/** Normalize a channel name; unknown/legacy names map to LOA (the classic "main" traffic). */
function webhookChannel_(ch) { const c = norm_(ch || ''); return WEBHOOK_CHANNELS_.indexOf(c) !== -1 ? c : 'LOA'; }

/**
 * The webhook URL for a channel, read from the ADMIN spreadsheet's Webhooks tab under the CURRENT user's Google
 * permissions — file sharing IS the access control: unshare the admin file and a rogue admin loses every webhook.
 * No admin file, no access, or no row = '' (that channel is off). Never throws; memoized per execution.
 */
function webhookFor_(channel) {
  try {
    if (_webhookMemo_ === null) {
      _webhookMemo_ = {};
      // Webhook URLs are secrets, so they live on a tab of THIS workbook — which members never open (they read the
      // separate published public roster). The file's own ACL is the gate.
      const sh = SpreadsheetApp.getActive().getSheetByName(WEBHOOK_TAB_);
      if (sh && sh.getLastRow() >= 2) {
        sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach((r) => {
          const c = norm_(r[0]), u = String(r[1] || '').trim();
          if (c && /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(u)) _webhookMemo_[c] = u;
        });
      }
    }
    return _webhookMemo_[webhookChannel_(channel)] || '';
  } catch (e) { return ''; } // no access → silently off (that IS the permission model)
}

/** Back-compat shim: the classic "main" webhook is the LOA channel now. */
function getWebhookUrl_() { return webhookFor_('LOA'); }

/** Retired one-time setup: webhooks live in the admin spreadsheet now. */
function setWebhookUrl() {
  runAction_('Set Webhook URL', () => {
    SpreadsheetApp.getUi().alert('Webhooks are stored in the ADMIN ROSTER now. Open 🎛️ Control Panel ▸ Tools ▸ Discord integration to set the per-channel URLs.');
  });
}

function sendDiscordWebhook(name, rank, callsign, type, start, end, duration, discordId) {
  const typeStr = String(type == null ? '' : type).trim() || 'Leave';
  const isReturn = CONFIG.returnStatus && norm_(typeStr) === norm_(CONFIG.returnStatus); // ROA-style returning leave → warmer color
  const E = CONFIG.embed; // v1.0: configurable title/colour
  const fallback = {
    title: String(E.submitTitle).replace(/\{type\}/g, typeStr),
    color: isReturn ? hexToInt_(E.returnColor, 15105570) : hexToInt_(E.submitColor, 3447003),
    fields: [
      { name: '👤 Name', value: clamp_(dash_(name), 1000), inline: true },
      { name: '🛡️ Rank', value: clamp_(dash_(withIcon_(rank)), 1000), inline: true },
      { name: '🎙️ Callsign', value: clamp_(dash_(callsign), 1000), inline: true },
      { name: '▶️ Start Date', value: clamp_(dash_(start), 1000), inline: true },
      { name: '⏹️ End Date', value: clamp_(dash_(end), 1000), inline: true },
      { name: '⏳ Length', value: clamp_(dash_(duration), 1000), inline: true },
    ],
  };
  const vars = { name, rank, callsign, type: typeStr, start, end, length: duration };
  notifyEvent_('LOA', true, 'loaSubmitted', vars, fallback, mention_(discordId));
}

function sendExpirationWebhook(name, rank, discordId, type) {
  const E = CONFIG.embed; // v1.0: configurable title/colour
  const fallback = {
    title: String(E.expireTitle).replace(/\{type\}/g, type),
    description: clamp_(`This member's **${type}** has ended. Their status has been updated on the roster.`, 4000),
    color: hexToInt_(E.expireColor, 15548997),
    fields: [
      { name: '👤 Name', value: clamp_(dash_(name), 1000), inline: true },
      { name: '🛡️ Rank', value: clamp_(dash_(withIcon_(rank)), 1000), inline: true },
    ],
  };
  notifyEvent_('LOA', true, 'loaExpired', { name, rank, type }, fallback, mention_(discordId));
}

/** Builds the webhook content line (pings the member only if the ID is valid). */
function mention_(discordId) {
  const ping = DISCORD_ID_RE.test(String(discordId)) ? `<@${discordId}> ` : '';
  return ping + (CONFIG.pingRoles ? `|| ${CONFIG.pingRoles} ||` : '');
}

/** Only http(s) URLs are safe to hand Discord as an image source; everything else → '' (omit). */
function embedUrl_(u) { const s = String(u == null ? '' : u).trim(); return /^https?:\/\/\S+$/i.test(s) ? s : ''; }

/** Footer object from an embed-config view + system name (pure — testable). Blank text → system name; icon only when http(s). */
function footerFrom_(E, systemName) {
  E = E || {};
  const out = { text: clamp_(String(E.footerText || '').trim() || String(systemName || ''), 2048) };
  const fi = embedUrl_(E.footerIcon);
  if (fi) out.icon_url = fi;
  return out;
}
/** Embed footer for the current config. Shared by the leave embeds and summary embeds. */
function footer_() { return footerFrom_(CONFIG.embed, CONFIG.systemName); }

/** Optional embed chrome (author / thumbnail / large image + footer) from an embed-config view (pure — testable). Blank parts omitted; URLs must be http(s). */
function embedChromeFrom_(E, systemName) {
  E = E || {};
  const out = { footer: footerFrom_(E, systemName) };
  const author = clamp_(String(E.authorName || '').trim(), 256);
  if (author) { out.author = { name: author }; const ai = embedUrl_(E.authorIcon); if (ai) out.author.icon_url = ai; }
  const th = embedUrl_(E.thumbnail); if (th) out.thumbnail = { url: th };
  const img = embedUrl_(E.image); if (img) out.image = { url: img };
  return out;
}
/**
 * v1.0: optional embed-body chrome merged into every leave-notification embed. All parts are off by default
 * (blank config), so existing embeds are unchanged; the footer is always present. Image/icon URLs must be http(s).
 */
function embedChrome_() { return embedChromeFrom_(CONFIG.embed, CONFIG.systemName); }

/** Fill {token} placeholders in a title template from a vars map (unmatched tokens are left as-is). */
function fill_(template, vars) {
  return String(template == null ? '' : template).replace(/\{(\w+)\}/g, function (m, k) { return (vars && vars[k] != null) ? String(vars[k]) : m; });
}

/**
 * v1.0 event notifications: post ONE event embed to the webhook only when its toggle is on. The embed gets a
 * timestamp + the shared [DISCORD] chrome (author/thumbnail/image/footer); `content` optionally pings a member.
 * Never throws — a notification must never break the action that triggered it.
 */
function notify_(on, embed, content) { notifyCh_('LOA', on, embed, content); }

/**
 * Build an embed from the admin-edited [EMBEDS] template for `event`, with {token} placeholders filled from
 * `vars` — or return `fallback` (the built-in embed) when no template exists or anything at all goes wrong.
 * Templates come from the Settings Studio's builder; every text part is clamped to Discord's limits.
 */
function embedFromTemplate_(event, vars, fallback) {
  try {
    const t = (CONFIG.embedTpl && CONFIG.embedTpl[event]) || null;
    if (!t) return fallback;
    const F = (s) => fill_(String(s == null ? '' : s), vars || {});
    const e = {};
    if (t.title) e.title = clamp_(F(t.title), 256);
    if (t.desc) e.description = clamp_(F(t.desc), 4000);
    if (t.color) e.color = hexToInt_(t.color, 5793266);
    if (t.author) {
      e.author = { name: clamp_(F(t.author), 256) };
      const au = embedUrl_(t.authorUrl); if (au) e.author.url = au;
      const ai = embedUrl_(t.authorIcon); if (ai) e.author.icon_url = ai;
    }
    const th = embedUrl_(t.thumb); if (th) e.thumbnail = { url: th };
    const im = embedUrl_(t.image); if (im) e.image = { url: im };
    if (t.footer || t.footerIcon) {
      e.footer = { text: clamp_(F(t.footer || ''), 2048) };
      const fi = embedUrl_(t.footerIcon); if (fi) e.footer.icon_url = fi;
    }
    if (Array.isArray(t.fields)) {
      e.fields = t.fields.filter((f) => f && (String(f.n || '').trim() || String(f.v || '').trim())).slice(0, 25)
        .map((f) => ({ name: clamp_(F(f.n) || '​', 256), value: clamp_(F(f.v) || '​', 1024), inline: !!f.inline }));
    }
    return (e.title || e.description || (e.fields && e.fields.length)) ? e : fallback;
  } catch (err) { return fallback; } // a broken template (or broken config) must never eat the notification
}

/** notify_ with an explicit channel first — call-site friendly (the trailing content/mention arg stays last). */
function notifyCh_(channel, on, embed, content) {
  if (!on) return;
  try {
    const payload = { embeds: [Object.assign({ timestamp: new Date().toISOString() }, embed, embedChrome_())] };
    if (content) payload.content = content;
    sendWebhookPayload_(payload, channel);
  } catch (e) { log_('notify_', e); }
}

/**
 * Post a builder-driven event: the template's Message text (placeholders filled) above the embed, the embed itself
 * (skipped when the template's "Send the embed" toggle is off), and any mention — all combined into ONE Discord
 * message on `channel`. A user template owns its own author/thumbnail/image/footer, so [DISCORD] chrome is applied
 * ONLY to the built-in fallback embed. Never throws; sends nothing when there's neither content nor an embed.
 */
function notifyEvent_(channel, on, event, vars, fallbackEmbed, mention) {
  if (!on) return;
  try {
    const m = String(mention || '');
    const v = Object.assign({ user: m, mention: m }, vars || {}); // {user}/{mention} resolve to the ping everywhere
    const tpl = (CONFIG.embedTpl && CONFIG.embedTpl[event]) || null;
    let content = m; // no template → just the ping (classic behaviour)
    if (tpl && tpl.content) {
      const raw = String(tpl.content);
      // If the message text positions the ping itself ({user}/{mention}), don't also append it; otherwise append.
      content = /\{(user|mention)\}/.test(raw) ? fill_(raw, v) : (m ? `${fill_(raw, v)}\n${m}` : fill_(raw, v));
    }
    const payload = {};
    if (content) payload.content = clamp_(content, 2000);
    if (!tpl || tpl.sendEmbed !== false) {
      const base = { timestamp: new Date().toISOString() };
      const embed = embedFromTemplate_(event, v, fallbackEmbed);
      payload.embeds = [tpl ? Object.assign(base, embed) : Object.assign(base, embed, embedChrome_())];
    }
    if (payload.content || payload.embeds) sendWebhookPayload_(payload, channel);
  } catch (e) { log_('notifyEvent_', e); }
}

/** Post the "leave approved" embed for a tracker row (reads the row fresh). Called from onEdit on the Pending→Approved transition. */
function notifyLeaveApproved_(sheet, row) {
  if (!CONFIG.notify || !CONFIG.notify.leaveApproved) return;
  try {
    const RC = trackerCols_(sheet);
    const g = (col) => String(sheet.getRange(row, col).getDisplayValue());
    const type = trackerLeaveType_() || 'Leave';
    const vars = { name: g(RC.name), rank: g(RC.rank), type, start: g(RC.start), end: g(RC.end) };
    notifyEvent_('LOA', true, 'loaApproved', vars, {
      title: fill_(CONFIG.notify.approvedTitle, { type: type }),
      color: hexToInt_(CONFIG.notify.approvedColor, 5749594),
      fields: [
        { name: '👤 Name', value: clamp_(dash_(vars.name), 1000), inline: true },
        { name: '🛡️ Rank', value: clamp_(dash_(withIcon_(vars.rank)), 1000), inline: true },
        { name: '▶️ Start Date', value: clamp_(dash_(vars.start), 1000), inline: true },
        { name: '⏹️ End Date', value: clamp_(dash_(vars.end), 1000), inline: true },
      ],
    }, mention_(g(RC.discord)));
  } catch (e) { log_('notifyLeaveApproved_', e); }
}

function withIcon_(rank) {
  const icon = getRankIcon(rank);
  return icon ? `${icon} ${rank}` : rank;
}

/** Optional: map ranks to Discord custom-emoji strings here. Empty by default. */
function getRankIcon(rank) {
  const icons = {};
  return icons[rank] || '';
}

/** Posts to the configured webhook, logging non-2xx responses and retrying once on 429. */
/**
 * Low-level: POST a JSON payload to a webhook URL with one 429 retry, and REPORT the outcome so callers can
 * distinguish "delivered" from "no exception thrown" (F-011). Never throws.
 * @return {{ok:boolean, code:number, error?:string}} ok = HTTP 2xx confirmed.
 */
function postToWebhook_(url, payload) {
  if (!url) return { ok: false, code: 0, error: 'no-url' };
  const opts = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
  try {
    let res = UrlFetchApp.fetch(url, opts);
    let code = res.getResponseCode();
    if (code === 429) {
      const headers = res.getHeaders();
      const retryAfter = parseFloat(headers['Retry-After'] ?? headers['retry-after'] ?? '1') || 1;
      logWarn_('postToWebhook_', `Discord rate-limited (429); retrying once after ${retryAfter}s.`);
      Utilities.sleep(Math.min(5000, retryAfter * 1000));
      res = UrlFetchApp.fetch(url, opts);
      code = res.getResponseCode();
    }
    const ok = code >= 200 && code < 300;
    if (!ok) logWarn_('postToWebhook_', `non-2xx response (${code}): ${clamp_(res.getContentText(), 300)}`);
    return { ok, code };
  } catch (err) {
    log_('postToWebhook_', err);
    return { ok: false, code: -1, error: String((err && err.message) || err) };
  }
}

/** Posts to the MAIN webhook. @return {{ok:boolean, code:number, error?:string}} (callers may ignore the return). */
function sendWebhookPayload_(payload, channel) {
  const url = webhookFor_(channel || 'LOA');
  if (!url) return { ok: false, code: 0, error: 'no-url' }; // channel unconfigured, or this account can't read the admin file
  return postToWebhook_(url, payload);
}

/** sendWebhookPayload_ with the channel first — keeps multi-line payload call sites tidy. */
function sendWebhookPayloadCh_(channel, payload) { return sendWebhookPayload_(payload, channel); }

/* ======================================================================
 * ROSTER MANAGEMENT
 * ====================================================================== */

function isValidMemberRow(sheet, row) {
  const RC = rosterCols_(sheet);
  return isValidMemberValues_(
    sheet.getRange(row, RC.rank).getValue(),
    sheet.getRange(row, RC.name).getValue(),
  );
}

/**
 * Single source of truth for "is this rank-column value a SECTION DIVIDER?" Default (DIVIDER_MODE = ALLCAPS_RANK):
 * a divider is an all-caps label longer than 3 chars (e.g. "CADETS", "COMMAND STAFF") — a section header, not a
 * real rank. v1.0 (DIVIDER_MODE = EXPLICIT_LIST): the [RANKS] list wins — a listed DIVIDER is a divider, a listed
 * RANK is a member slot (even if it's ALL-CAPS), and anything unlisted falls back to the heuristic. Used by
 * isValidMemberValues_, isMemberSlot_, isTrainingRow_, and the panel's Dividers list, so every place that
 * distinguishes a divider from a member agrees by definition. Must NEVER throw (a broken config → heuristic).
 */
function isDividerValue_(rankValue) {
  if (!rankValue) return false;
  const s = String(rankValue).trim();
  if (s === '') return false;
  try {
    const rl = CONFIG.rankList;
    if (norm_(CONFIG.dividerMode) === 'EXPLICIT_LIST' && rl) {
      const key = norm_(s);
      if (rl.dividers.indexOf(key) !== -1) return true;   // explicitly a divider
      if (rl.ranks.indexOf(key) !== -1) return false;     // explicitly a member rank (may be ALL-CAPS)
      // unlisted → fall through to the heuristic (partial lists stay safe)
    }
  } catch (e) { /* config unavailable/broken → heuristic below */ }
  return s === s.toUpperCase() && s.length > 3;
}

/** True if a divider's label denotes a TRAINING section (matches a CONFIG.trainingDividers keyword). */
function isTrainingDividerLabel_(label) {
  const s = String(label || '').toUpperCase();
  return CONFIG.trainingDividers.some((kw) => s.indexOf(kw) !== -1);
}

/**
 * Classify a divider label into an informational section category for the panel's Dividers view (purely
 * cosmetic — does NOT affect transfers). First CONFIG.sectionCategories entry whose keyword is a substring of
 * the uppercased label wins. @return {{label:string, tone:string}|null} the matched category, or null.
 */
function sectionCategory_(label) {
  const s = String(label || '').toUpperCase();
  const cats = CONFIG.sectionCategories || [];
  for (let i = 0; i < cats.length; i++) {
    if (cats[i].keywords.some((kw) => s.indexOf(kw) !== -1)) {
      return { label: cats[i].label, tone: cats[i].tone };
    }
  }
  return null;
}

/** True for a real member row (not a section divider, header, or empty slot). */
function isValidMemberValues_(rankValue, nameValue) {
  if (!rankValue) return false;
  const rank = String(rankValue).trim();
  if (isDividerValue_(rank)) return false;                          // ALL-CAPS divider
  if (rank === 'Rank') return false;                                // placeholder
  if (nameValue == null || nameValue === '') return false;          // empty slot
  return true;
}

/** True for any numberable slot (a real rank, even if the name is blank). */
function isMemberSlot_(rankValue) {
  if (!rankValue) return false;
  return !isDividerValue_(rankValue);
}

function isTrainingRow_(sheet, row) {
  if (!sheet || row < CONFIG.rosterStartRow) return false;
  const n = row - CONFIG.rosterStartRow + 1;
  if (n < 1) return false;
  const ranks = sheet.getRange(CONFIG.rosterStartRow, rosterCols_(sheet).rank, n, 1).getDisplayValues();
  for (let i = n - 1; i >= 0; i--) { // nearest section divider at/above the row
    const s = String(ranks[i][0]).trim();
    if (isDividerValue_(s)) return isTrainingDividerLabel_(s);
  }
  return false;
}

/**
 * Transfers a member to a new row when their Discord ID is entered there.
 * @param {function(string):boolean} [confirmFn] - injectable confirm (tests pass a stub).
 * @param {function(string):void} [notifyFn] - injectable notifier for the result/cancel alerts (tests pass a no-op).
 */
/**
 * Move a member's MEMBER-class columns from sourceRow → targetRow, keeping SLOT columns (Rank/Callsign) at each
 * position, and clearing the source. A cross-section move (training ⇄ non-training) drops opted-in section-specific
 * columns at the destination instead of carrying them. Returns true iff such a column was cleared. Copies with
 * PASTE_NO_BORDERS: value/formula, number format and validation still follow the person (so TIME IN RANK stays a
 * live formula and 17-19 digit IDs stay exact), but the source cell's BORDERS do not — a move used to carry a
 * band/section border into the destination row and repaint the roster. The caller must hold the script lock and have
 * validated both rows. Shared by the sheet-edit transfer (checkForMemberMove) and the Control Panel's Move action.
 */
function moveMemberColumns_(sheet, sourceRow, targetRow) {
  const crossSection = isTrainingRow_(sheet, sourceRow) !== isTrainingRow_(sheet, targetRow);
  const slot = slotColumnSet_(sheet);
  const checkbox = {};
  CONFIG.columns.trainingCheckboxCols.forEach((c) => { checkbox[c] = true; });
  const lastCol = sheet.getLastColumn();
  let wiped = false;
  // MEMBER columns are moved in CONTIGUOUS RUNS — one copyTo + one clearContent per run instead of two calls per
  // column. The transfer runs inside the LIMITED onEdit budget that also hosts the human confirm dialog, so the
  // per-column churn directly ate the margin. Semantics are unchanged: SLOT stays put, cross-section checkbox
  // columns are wiped instead of carried, borders are never repainted.
  let c = 2;
  while (c <= lastCol) {
    if (slot[c]) { c++; continue; }                // SLOT stays with the destination position (and on the source)
    if (crossSection && checkbox[c]) {
      sheet.getRange(targetRow, c).clearContent(); // section-specific column (opted in): don't carry it across sections
      sheet.getRange(sourceRow, c).clearContent(); // the member has left the source row
      wiped = true;
      c++; continue;
    }
    let e = c;
    while (e + 1 <= lastCol && !slot[e + 1] && !(crossSection && checkbox[e + 1])) e++;
    // Carry value/formula + number format + validation, but NOT borders — so a move never repaints the roster's band/section lines.
    sheet.getRange(sourceRow, c, 1, e - c + 1).copyTo(sheet.getRange(targetRow, c, 1, e - c + 1), SpreadsheetApp.CopyPasteType.PASTE_NO_BORDERS, false);
    sheet.getRange(sourceRow, c, 1, e - c + 1).clearContent(); // the member has left the source row
    c = e + 1;
  }
  sheet.getRange(targetRow, rosterCols_(sheet).discord).setNumberFormat('@'); // keep the moved ID exact
  return wiped;
}

function checkForMemberMove(sheet, targetRange, discordId, confirmFn, notifyFn) {
  const targetRow = targetRange.getRow();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.rosterStartRow) return;
  const RC = rosterCols_(sheet);

  const target = String(discordId).trim();
  if (target === '') return;
  const ids = sheet.getRange(CONFIG.rosterStartRow, RC.discord, lastRow - CONFIG.rosterStartRow + 1, 1).getDisplayValues();
  let sourceRow = -1;
  for (let i = 0; i < ids.length; i++) {
    const rowNum = CONFIG.rosterStartRow + i;
    if (String(ids[i][0]).trim() === target && rowNum !== targetRow) { sourceRow = rowNum; break; }
  }
  if (sourceRow === -1) return;

  const memberName = sheet.getRange(sourceRow, RC.name).getValue();
  const sourceRank = sheet.getRange(sourceRow, RC.rank).getValue() || 'Unknown';
  const targetRank = sheet.getRange(targetRow, RC.rank).getValue() || 'Unknown';
  const targetName = String(sheet.getRange(targetRow, RC.name).getDisplayValue()).trim(); // who (if anyone) already sits at the destination
  const ui = SpreadsheetApp.getUi();
  const confirmMove = confirmFn || ((msg) => ui.alert('🔄 Member Transfer', msg, ui.ButtonSet.YES_NO) === ui.Button.YES);
  const notify = notifyFn || ((msg) => ui.alert(msg)); // tests pass a no-op so the suite never blocks on a dialog

  // F-037: the destination already holds a DIFFERENT member — surface the overwrite instead of doing it silently.
  const occupiedWarning = (targetName && targetName !== String(memberName).trim())
    ? `\n\n⚠️ Row ${targetRow} already holds ${targetName} — continuing OVERWRITES ${targetName}'s row.`
    : '';

  if (!confirmMove(`Move ${memberName} from ${sourceRank} to ${targetRank}?${occupiedWarning}`)) {
    targetRange.clearContent();
    notify('❌ Action cancelled.');
    return;
  }

  // F-008: serialize the mutation and re-verify the source didn't shift during the (open-ended) confirm dialog —
  // a concurrent row insert/delete could otherwise make sourceRow point at a different member.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) { targetRange.clearContent(); notify('⏳ Another roster change is in progress — the transfer was cancelled. Please try again.'); return; }
  try {
    if (String(sheet.getRange(sourceRow, RC.discord).getDisplayValue()).trim() !== target) {
      targetRange.clearContent();
      notify('⚠️ The roster changed while the transfer dialog was open — nothing was moved. Please retry.');
      return;
    }

    // Classification-driven transfer: MEMBER columns follow the person, SLOT columns (Rank/Callsign) stay with the
    // position; cross-section moves drop opted-in section-specific columns. Shared with the panel's Move action.
    const wiped = moveMemberColumns_(sheet, sourceRow, targetRow);

    notify(wiped
      ? '✅ Transfer complete.\n\n⚠️ Cross-section move — section-specific columns were NOT carried over; re-enter them manually.'
      : '✅ Transfer complete.');
  } finally {
    lock.releaseLock();
  }
  // Cheap, important, and AuthMode.LIMITED-safe — do these RIGHT AFTER the move, BEFORE the heavy rebuilds below.
  // checkForMemberMove runs on the SIMPLE onEdit trigger, whose ~30s budget also spans the (human) confirm dialog; a big
  // Academy rebuild afterwards could blow it, so record the promotion and flag the public copy FIRST — then neither is
  // lost even if the rebuild gets cut short.
  promoRecord_(sourceRow, targetRow, memberName, sourceRank, targetRank); // RECENT PROMOTIONS feed (no-op unless it was a promotion)
  // Flag the public copy stale so the ~8s catch-up + 1-minute sweep publish it. We must NOT publish from here: the SIMPLE
  // trigger is AuthMode.LIMITED and can't open the separate public file — the previous direct publish failed at openById
  // AND deleted the dirty flag on the way in, which made the sweep SKIP the move (the public roster never caught up).
  // publishOnChange (installable) schedules the catch-up on the ID paste.
  if (sheet.getName() === CONFIG.sheets.roster) {
    try { if (typeof publishMarkDirty_ === 'function') publishMarkDirty_(); } catch (ig) {}
  }
  // A transfer changes the member's rank (SLOT rank stays with the destination), which can move them in/out of the
  // Police Academy's rank-group bands — re-sync it (and the group tabs). Heavy, but ALSO queued by onEdit's deferWork_,
  // so the sweep still carries it if this is cut short. Live roster tab only (sandbox moves must not rebuild).
  if (sheet.getName() === CONFIG.sheets.roster) {
    try { if (typeof buildAcademySheets_ === 'function') buildAcademySheets_(); } catch (e2) { log_('checkForMemberMove.academy', e2); }
    try { if (typeof buildGroupSheets_ === 'function') buildGroupSheets_(); } catch (e2) { log_('checkForMemberMove.groups', e2); }
  }
  // Discord webhook LAST: UrlFetchApp is unavailable in AuthMode.LIMITED, so this may throw — nothing important is after it.
  notifyCh_('AUDIT', CONFIG.notify.transfer, { // roster-change traffic → AUDIT channel; only reached on a successful move
    title: fill_(CONFIG.notify.transferTitle, { name: memberName, from: sourceRank, to: targetRank }),
    color: hexToInt_(CONFIG.notify.transferColor, 5793266),
    fields: [
      { name: '👤 Name', value: clamp_(dash_(memberName), 1000), inline: true },
      { name: '↗️ From', value: clamp_(dash_(withIcon_(sourceRank)), 1000), inline: true },
      { name: '🛡️ To', value: clamp_(dash_(withIcon_(targetRank)), 1000), inline: true },
    ],
  }, mention_(target));
}

/** Menu action: insert N blank member rows below the cursor (asks how many) and renumber units. */
/**
 * Fills the TIME IN RANK column with a live "days since LAST PROMOTION" formula for EVERY member slot, so it
 * stays current on its own (TODAY() recalculates daily) and empty / newly-added rows get it too. Divider and
 * blank-scaffolding rows are left empty. No-op when the sheet has no TIME IN RANK or LAST PROMOTION column.
 * @return {number} member rows given the formula.
 */
function fillTimeInRank_(roster) {
  const RC = rosterCols_(roster);
  if (!RC.timeInRank || !RC.promo) return 0;                       // column not present on this layout → nothing to do
  const lastRow = roster.getLastRow();
  const n = lastRow - CONFIG.rosterStartRow + 1;
  if (n <= 0) return 0;
  let pc = '';                                                     // LAST PROMOTION column letter (cpColLetter_ lives in RosterTrust.gs — guard it)
  if (typeof cpColLetter_ === 'function') pc = cpColLetter_(RC.promo);
  else { let c = RC.promo; while (c > 0) { const m = (c - 1) % 26; pc = String.fromCharCode(65 + m) + pc; c = Math.floor((c - 1) / 26); } }
  const ranks = roster.getRange(CONFIG.rosterStartRow, RC.rank, n, 1).getValues();
  const out = [];
  let count = 0;
  for (let r = 0; r < n; r++) {
    const row = CONFIG.rosterStartRow + r;
    if (isMemberSlot_(ranks[r][0])) { out.push([`=IF(${pc}${row}="","",TODAY()-INT(${pc}${row}))`]); count++; }
    else out.push(['']);                                          // dividers / empty scaffolding rows stay blank (never #VALUE)
  }
  roster.getRange(CONFIG.rosterStartRow, RC.timeInRank, n, 1).setFormulas(out).setNumberFormat('0" days"');
  return count;
}

function addMemberRow() {
  runAction_('Add Member Row', () => {
    const ui = SpreadsheetApp.getUi();
    const sheet = SpreadsheetApp.getActive().getActiveSheet();
    if (sheet.getName() !== CONFIG.sheets.roster) {
      ui.alert(`Select a cell on the "${CONFIG.sheets.roster}" tab first.`);
      return;
    }
    const resp = ui.prompt('➕ Add Member Rows', 'How many member rows to add? (1–100)', ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    let count = parseInt(String(resp.getResponseText()).trim(), 10);
    if (isNaN(count) || count < 1) count = 1;      // blank / bad input → add one
    count = Math.min(count, 100);
    let currentRow = sheet.getActiveCell().getRow();
    if (currentRow < CONFIG.rosterStartRow) currentRow = CONFIG.rosterStartRow;
    const RC = rosterCols_(sheet);
    // TEMPLATE row: the nearest REAL member row at/above the cursor (then below, then the cursor itself) —
    // copying a section-divider band would stamp its merged banner formatting onto every new row.
    const isMemberRowAt = (r) => {
      if (r < CONFIG.rosterStartRow || r > sheet.getLastRow()) return false;
      const rk = String(sheet.getRange(r, RC.rank).getDisplayValue()).trim();
      return rk !== '' && !isDividerValue_(rk);
    };
    let template = 0;
    for (let r = currentRow; r >= CONFIG.rosterStartRow && !template; r--) { if (isMemberRowAt(r)) template = r; }
    for (let r = currentRow + 1; r <= sheet.getLastRow() && !template; r++) { if (isMemberRowAt(r)) template = r; }
    if (!template) template = currentRow;
    sheet.insertRowsAfter(currentRow, count);
    const tRow = template > currentRow ? template + count : template; // a below-cursor template shifted down with the insert
    const w = Math.max(1, sheet.getLastColumn()); // FULL width incl. col A — the new rows should look exactly like a member row
    const src = sheet.getRange(tRow, 1, 1, w);
    const tgt = sheet.getRange(currentRow + 1, 1, count, w);
    try { tgt.breakApart(); } catch (e) { /* nothing merged */ }
    src.copyTo(tgt, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);          // copyTo tiles the template row's format across every new row
    src.copyTo(tgt, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false); // dropdowns (status etc.) carry over too
    tgt.clearContent();
    const th = sheet.getRowHeight(tRow);
    for (let i = 0; i < count; i++) sheet.setRowHeight(currentRow + 1 + i, th); // copyTo doesn't carry row height
    sheet.getRange(currentRow + 1, RC.rank, count, 1).setValue('Rank');
    updateUnitNumbers_(); // renumber using the configured [ROSTER_LAYOUT].UNIT_FORMAT (call the core, avoid nesting the error wrapper)
    try { fillTimeInRank_(sheet); } catch (e) { log_('addMemberRow.tir', e); } // new rows get the live TIME IN RANK formula
    ui.alert(`✅ Added ${count} member row${count === 1 ? '' : 's'} after row ${currentRow}.\n\nFill in each rank + name — callsigns are assigned automatically.`);
  });
}

/** Menu action: set the callsign/unit format (persisted to config so new members inherit it) and renumber, skipping dividers. */
function updateUnitNumbers() {
  runAction_('Fix Callsign Numbers', () => {
    // No input prompt: the format is config ([ROSTER_LAYOUT].UNIT_FORMAT), edited in Engine Settings ▸ Sheets & layout.
    const ui = SpreadsheetApp.getUi();
    const count = updateUnitNumbers_(); // reads CONFIG.unitFormat via formatUnit_
    if (!count) { ui.alert('No member slots found to renumber.\n\n(Add member rows first, or check that the roster tab is correct.)'); return; }
    ui.alert(`✅ Renumbered ${count} callsign${count === 1 ? '' : 's'} — ${formatUnit_(1)} … ${formatUnit_(count)}.\n\nThe format comes from Engine Settings ▸ Sheets & layout ▸ UNIT FORMAT.`);
  });
}

/** Core renumber logic (S-01, S-02, …). Separated so addMemberRow can reuse it. @return {number} member slots renumbered. */
function updateUnitNumbers_() {
  const sheet = getSheetOrWarn_(SpreadsheetApp.getActive(), CONFIG.sheets.roster);
  if (!sheet) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.rosterStartRow) return 0;
  const RC = rosterCols_(sheet);
  const n = lastRow - CONFIG.rosterStartRow + 1;
  const ranks = sheet.getRange(CONFIG.rosterStartRow, RC.rank, n, 1).getValues();
  const units = [];
  let counter = 1;
  for (let i = 0; i < n; i++) {
    if (isMemberSlot_(ranks[i][0])) {
      units.push([formatUnit_(counter)]);
      counter++;
    } else {
      units.push(['']);
    }
  }
  sheet.getRange(CONFIG.rosterStartRow, RC.unit, n, 1).setValues(units);
  return counter - 1; // number of member slots that received a callsign
}

/** Menu action: report duplicate and malformed Discord IDs on the roster. */
function checkDuplicateDiscordIds() {
  runAction_('Check Duplicate IDs', () => {
  const ss = SpreadsheetApp.getActive();
  const roster = getSheetOrWarn_(ss, CONFIG.sheets.roster);
  if (!roster) return;
  const last = roster.getLastRow();
  if (last < CONFIG.rosterStartRow) { SpreadsheetApp.getUi().alert('Roster is empty.'); return; }

  const RC = rosterCols_(roster);
  const n = last - CONFIG.rosterStartRow + 1;
  const ranks = roster.getRange(CONFIG.rosterStartRow, RC.rank, n, 1).getValues();
  const names = roster.getRange(CONFIG.rosterStartRow, RC.name, n, 1).getValues();
  const ids = roster.getRange(CONFIG.rosterStartRow, RC.discord, n, 1).getDisplayValues();

  const seen = {};
  const malformed = [];
  for (let i = 0; i < n; i++) {
    if (!isValidMemberValues_(ranks[i][0], names[i][0])) continue;
    const id = String(ids[i][0]).trim();
    if (id === '') continue;
    const who = `${names[i][0] || '(no name)'} (row ${CONFIG.rosterStartRow + i})`;
    if (!isValidId_(id)) malformed.push(`${who}: "${id}"`);
    (seen[id] = seen[id] || []).push(who);
  }

  const dup = Object.keys(seen).filter((k) => seen[k].length > 1).map((k) => `ID ${k} → ${seen[k].join(', ')}`);
  const out = [dup.length ? `DUPLICATE IDs (${dup.length}):\n${dup.join('\n')}` : 'No duplicate Discord IDs found.'];
  if (malformed.length) out.push(`\nNOT ${idDigitsLabel_()} DIGITS (${malformed.length}):\n${malformed.join('\n')}`);
  SpreadsheetApp.getUi().alert(out.join('\n'));
  });
}
