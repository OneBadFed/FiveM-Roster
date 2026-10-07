/** Department demo/reset utilities. In-sheet Dev/QA test suites have been removed. */
const SANDBOX_PREFIX = '🧪SANDBOX_'; // legacy sandbox cleanup only
const RESULTS_TAB = '🧪 Test Results'; // legacy results cleanup only

function addDevMenu_(prefix) {
  const p=prefix||'';
  SpreadsheetApp.getUi().createMenu('🧪 Dev / QA')
    .addItem('🎬 Load Demo Roster (preview)',p+'seedDemoRoster')
    .addItem('🗑️ Reset for a new department…',p+'devResetForNewDepartment')
    .addItem('🧹 Delete old Sandbox / Results Tabs',p+'devCleanup')
    .addToUi();
}

function devCleanup() {
  const ss=SpreadsheetApp.getActive();
  devDeleteSandbox_();
  const results=ss.getSheetByName(RESULTS_TAB);
  if(results)ss.deleteSheet(results);
  SpreadsheetApp.getUi().alert('Removed old sandbox and results tabs.');
}

function devResetForNewDepartment() {
  const ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive();
  const answer = ui.prompt('Reset this copy for a new department',
    'Permanently remove all roster members, LOAs, patrol logs, signups, linked response-sheet rows, history, snapshots and saved department settings.\n\n'
    + 'Ranks, callsigns, SLOT columns, table borders and formatting stay. Structural sheet/column mappings stay; other configuration returns to defaults. Webhooks, rank icons and the public-roster link are removed. Engine triggers owned by your account are removed.\n\n'
    + 'Google Forms and other spreadsheets are NOT changed. Other owners must remove their engine triggers separately. Use this on a COPY before handing it over; there is no undo.\n\nType RESET DEPARTMENT to continue.', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK || answer.getResponseText().trim() !== 'RESET DEPARTMENT') return;
  // Match cpWithLock_ / sync / restore: a different lock would allow overlapping writes.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { ui.alert('The roster is busy. Wait for the current action to finish and retry.'); return; }
  let message;
  try {
    DEV_WEBHOOKS_OFF_ = true;
    const plan = devDepartmentResetPlan_(ss);
    devApplyDepartmentReset_(ss, plan);
    message = 'Reset complete. Member data and department settings were cleared; layout and formatting were retained.\n\nLink the new department’s own form response tabs in Settings, configure its connections, then run First-Run Setup. No Google Form was created.';
  } catch (e) {
    message = 'Reset did not finish: ' + (e && e.message || e) + '\nSome data may already have been cleared. Keep this copy private and retry after fixing the problem.';
  } finally { lock.releaseLock(); }
  ui.alert(message);
}

/** Resolve everything before clearing config, including departments with custom columns/tab names. */
function devDepartmentResetPlan_(ss) {
  const cv = cfg_(), roster = ss.getSheetByName(CONFIG.sheets.roster);
  if (!roster) throw new Error('Configured roster tab was not found. Fix its setting before resetting.');
  const rc = rosterCols_(roster), start = CONFIG.rosterStartRow, last = roster.getLastRow();
  if (!rc.name || !rc.rank || !rc.unit || start <= (rc.headerRow || CONFIG.headerRow)) throw new Error('Roster headers/data rows could not be resolved safely.');
  const values = last >= start ? roster.getRange(start, 1, last - start + 1, roster.getLastColumn()).getDisplayValues() : [];
  const rows = [], identities = {};
  values.forEach((r, i) => {
    if (!String(r[rc.unit - 1] || '').trim() && !isMemberSlot_(String(r[rc.rank - 1] || '').trim())) return;
    rows.push(start + i);
    [rc.name, rc.discord].filter(Boolean).forEach((c) => { const v = String(r[c - 1] || '').trim(); if (v) identities[v] = true; });
  });
  const columns = columnRegistry_(roster).filter((c) => c.klass === 'MEMBER').map((c) => c.col);
  if (columns.indexOf(rc.name) === -1) throw new Error('NAME is classified as SLOT. Classify it as MEMBER before resetting.');
  const preserved = [];
  ['ROSTER','TRACKER','PATROL_LOG','SIGNUPS','AUDIT','HOURS_HISTORY','COVERAGE','INTEGRITY','SNAPSHOTS','WELCOME'].forEach((key) => preserved.push(['SHEETS', key, cv.kv.SHEETS[key]]));
  ['HEADER_ROW','DATA_START_ROW','TRACKER_START_ROW','PATROL_START_ROW','DIVIDER_MODE','UNIT_FORMAT','SHIFT_HEADER','SHIFT_ASSIGNED_BY'].forEach((key) => preserved.push(['ROSTER_LAYOUT', key, cv.kv.ROSTER_LAYOUT[key]]));
  const tables = [], seen = {};
  const add = (name, dataStart, framed) => {
    const sh = name && ss.getSheetByName(name); if (!sh) return;
    if (sh.getSheetId() === roster.getSheetId()) throw new Error('A data/history tab is mapped to the roster itself. Fix the sheet mappings first.');
    if (seen[sh.getSheetId()]) return;
    seen[sh.getSheetId()] = true;
    const frame = framed ? framedTable_(sh, dataStart) : null;
    tables.push({ sheet: sh, start: dataStart, end: frame ? Math.min(frame.cap - 1, sh.getMaxRows()) : sh.getLastRow(), width: frame ? frame.width : sh.getLastColumn() });
  };
  add(CONFIG.sheets.tracker, CONFIG.trackerStartRow, true);
  add(CONFIG.sheets.patrolLog, CONFIG.patrolStartRow, true);
  const signup = ss.getSheetByName(CONFIG.sheets.signups);
  if (signup) { const sc = signupCols_(signup); add(signup.getName(), sc.dataStart, sc.headerRow > 1); }
  ['form','patrol','signupForm','audit','hoursHistory','integrity','snapshots','coverage','activity'].forEach((key) => add(CONFIG.sheets[key], 2, false));
  add('Webhooks', 2, false); add('_Rank Icons', 2, false); add(SYS_LOG_SHEET, 2, false);
  return { roster, rows, columns, identities, tables, preserved,
    structural: ['COLUMNS'].map((name) => ({ name, rows: (cv.tables[name] || []).map((r) => BLOCK_SPECS_[name].cols.map((c) => r[c] == null ? '' : r[c])) })) };
}

function devApplyDepartmentReset_(ss, plan) {
  // Disconnect first so cleanup cannot propagate into a different, linked spreadsheet.
  const props = PropertiesService.getDocumentProperties();
  const runtime = props.getProperties();
  props.deleteProperty('PUBLIC_ROSTER_ID');
  const handlers = ['onFormSubmit','processDailyLOAs','publishPublicRoster','publishOnChange','publishSweep','publishCatchup','dailyBackup','scanIntegrity','buildCoverage','weeklyResetScheduled','weeklySnapshotScheduled','auditEdit','recordEdit'];
  ScriptApp.getProjectTriggers().forEach((t) => { if (handlers.indexOf(t.getHandlerFunction().replace(/^RE\./, '')) !== -1) ScriptApp.deleteTrigger(t); });
  const clear = (sh, addresses) => { if (addresses.length) sh.getRangeList(addresses).clearContent().clearNote(); };
  const letter = (col) => { let s = ''; for (; col > 0; col = Math.floor((col - 1) / 26)) s = String.fromCharCode(65 + (col - 1) % 26) + s; return s; };
  const cells = []; plan.rows.forEach((r) => plan.columns.forEach((c) => cells.push(letter(c) + r)));
  for (let i = 0; i < cells.length; i += 500) clear(plan.roster, cells.slice(i, i + 500));
  plan.tables.forEach((t) => {
    if (t.end >= t.start && t.width) t.sheet.getRange(t.start, 1, t.end - t.start + 1, t.width).clearContent().clearNote();
  });
  // Clear copied leadership/member labels outside the source roster without erasing template labels.
  const oldConfig = findConfigSheet_(ss);
  ss.getSheets().forEach((sh) => {
    if (sh.getSheetId() === plan.roster.getSheetId() || (oldConfig && sh.getSheetId() === oldConfig.getSheetId()) || sh.getName().indexOf(SANDBOX_PREFIX) === 0) return;
    const grid = sh.getDataRange().getDisplayValues(), hits = [];
    grid.forEach((r, ri) => r.forEach((v, ci) => { if (plan.identities[String(v).trim()]) hits.push(letter(ci + 1) + (ri + 1)); }));
    for (let i = 0; i < hits.length; i += 500) clear(sh, hits.slice(i, i + 500));
  });
  Object.keys(props.getProperties()).forEach((key) => {
    if (key !== 'RE_RUNTIME_MODE' && key !== 'RE_LIBRARY_MODE' && /^(REICON:|RECOLOR:|RE_|PUBLIC_|PUBLISH_|DEFERRED_WORK$|DERIVED_LAST_SYNC$|ADMIN_)/.test(key)) props.deleteProperty(key);
  });
  // Only known legacy engine credentials/cadence; never wipe unrelated script properties.
  if (runtime.RE_RUNTIME_MODE === 'BOUND') {
    const legacy = PropertiesService.getScriptProperties();
    ['DISCORD_WEBHOOK_URL','WEBHOOK_ERRORS','RE_LAST_HOURS_RESET_MS'].forEach((key) => legacy.deleteProperty(key));
  }
  let config = findConfigSheet_(ss);
  if (config) config.getDataRange().clearContent().clearNote();
  cfgInvalidate_(); seedConfigTab_(ss); config = findConfigSheet_(ss);
  plan.preserved.forEach((p) => { if (p[2] != null) setKvValue_(config, p[0], p[1], Array.isArray(p[2]) ? p[2].join(', ') : p[2]); });
  plan.structural.forEach((t) => setTableRows_(config, t.name, t.rows));
  // Empty blocks must remain present so additive startup does not recreate seeded department vocabulary.
  ['STATUSES','STATUS_OVERRIDES','STATUS_RULES','RANKS','SECTION_TAGS','DASHBOARD_GROUPS','EMBEDS'].forEach((name) => setTableRows_(config, name, []));
  setKvValue_(config, 'LEAVE', 'LEAVE_TYPES', '');
  setKvValue_(config, 'LEAVE', 'RETURN_STATUS', '');
  // Leave the required LOA response name at its default placeholder; optional intakes reset to off.
  setKvValue_(config, 'ACTIVITY', 'AUTO_RESET', 'FALSE');
  cfgInvalidate_();
  devDeleteSandbox_(); const results = ss.getSheetByName(RESULTS_TAB); if (results) ss.deleteSheet(results);
  // Rebuild derived member lists using the empty roster, preserving their template styles.
  if (typeof buildGroupSheets_ === 'function') buildGroupSheets_();
  if (typeof buildAcademySheets_ === 'function') buildAcademySheets_();
  // Coverage/activity were cleared above; do not call menu wrappers that create logs or dialogs.
  if (typeof refreshDashboard_ === 'function') refreshDashboard_(true);
  if (typeof renderPromotions_ === 'function') renderPromotions_(true);
  if (typeof cpInvalidateHealth_ === 'function') cpInvalidateHealth_();
  SpreadsheetApp.flush();
}


function devDeleteSandbox_() {
  const ss = SpreadsheetApp.getActive();
  ss.getSheets().forEach((sh) => { if (sh.getName().indexOf(SANDBOX_PREFIX) === 0) ss.deleteSheet(sh); });
}
