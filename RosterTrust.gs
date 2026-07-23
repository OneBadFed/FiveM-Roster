/**
 * ============================================================================
 * ROSTER TRUST — health checks, in-sheet snapshots/restore, and audit-log read.
 * ----------------------------------------------------------------------------
 * Powers the Control Panel's "System" tab. Paste alongside RosterSystem.gs +
 * RosterControlPanel.gs. Reuses CONFIG + helpers (isValidMemberValues_,
 * isMemberSlot_, getWebhookUrl_, ssTz_, DISCORD_ID_RE).
 *
 * Snapshots are stored on a hidden "_Snapshots" tab — a lightweight, in-sheet
 * replacement for the removed Drive backup. The audit viewer reads the "Edit Log"
 * tab produced by RosterExtras.gs (recordEdit); if it's absent, the viewer just
 * says so.
 * ============================================================================
 */

const TRUST = Object.freeze({
  // v1.0 — tab names resolve LIVE from [SHEETS] on ⚙️ Config (getters → zero call-site churn; blank = shipped default).
  get snapshotSheet() { return cfgSheetName_('snapshots', '_Snapshots'); },
  get auditSheet() { return cfgSheetName_('audit', 'Edit Log'); },   // matches RosterExtras EXTRAS.auditSheet
  get keepSnapshots() { try { return cfg_().kv.LIMITS.SNAPSHOT_KEEP || 20; } catch (e) { return 20; } }, // v1.0: configurable
});

/** One call powering the System tab. */
function cpSystemInfo() {
  try { cpEnsureAuditTrigger(); } catch (e) { log_('cpSystemInfo', e); } // audit is always-on
  return {
    health: cpHealthCheckCached_(),
    snapshots: cpListSnapshots(),
    audit: cpAuditTail(100),
    auditAvailable: !!SpreadsheetApp.getActive().getSheetByName(TRUST.auditSheet),
    autoSnapshot: cpSnapshotAutoStatus(),
    auditLogging: cpAuditAutoStatus(),
  };
}

/** F-023: the structural health check rarely changes but is expensive; memoize it ~5 min so the 15s System-tab poll doesn't re-run it every tick. */
function cpHealthCheckCached_() {
  try {
    const cache = CacheService.getScriptCache();
    const hit = cache.get('cp:health');
    if (hit) { const o = JSON.parse(hit); o.cached = true; return o; }
    const fresh = cpHealthCheck_();
    try { cache.put('cp:health', JSON.stringify(fresh), 300); } catch (e) { /* cache best-effort */ }
    return fresh;
  } catch (e) {
    return cpHealthCheck_(); // cache/parse failure → just compute it
  }
}

/** Drop the memoized health check so the next System-tab poll reflects a just-made change (triggers, webhook, …). */
function cpInvalidateHealth_() {
  try { CacheService.getScriptCache().remove('cp:health'); } catch (e) { /* best-effort */ }
}

/* ----------------------------------------------------------------------------
 * HEALTH CHECK
 * ------------------------------------------------------------------------- */

/** Structural + integrity checks. @return {{ok:boolean, checks:Array}} */
function cpHealthCheck_() {
  const ss = SpreadsheetApp.getActive();
  const checks = [];
  const add = (label, ok, detail, fix) => checks.push({ label, ok: !!ok, detail: detail || '', fix: fix || '' });

  // ⚙️ Config validity (Phase 1): the same validators as live runs — "passes Health Check, fails live"
  // is impossible by construction (brief B6). Absent tab = OK (built-in defaults).
  try {
    const v = cfg_();
    add('⚙️ Config valid', true, v.fromTab ? `"${CONFIG_SHEET_NAME}" parsed + validated.` : 'No Config tab yet — running on built-in defaults (run 🚀 First-Run Setup to create it).');
  } catch (e) {
    add('⚙️ Config valid', false, e.message);
    // Everything below reads CONFIG (which resolves through the broken config) — report what we know and stop
    // instead of dying mid-check. Fixing the Config tab is the one action that unblocks the rest.
    return { checks };
  }

  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  const tracker = ss.getSheetByName(CONFIG.sheets.tracker);
  const form = ss.getSheetByName(CONFIG.sheets.form);
  add(`Roster tab "${CONFIG.sheets.roster}"`, roster, roster ? '' : 'Not found — check the exact tab name.');
  add(`Tracker tab "${CONFIG.sheets.tracker}"`, tracker, tracker ? '' : 'Not found — check the exact tab name.');
  add(`Form tab "${CONFIG.sheets.form}"`, form, form ? '' : 'Not found — check the exact tab name.');

  let memberCount = 0;
  if (roster && roster.getLastRow() >= CONFIG.rosterStartRow) {
    const n = roster.getLastRow() - CONFIG.rosterStartRow + 1;
    const v = roster.getRange(CONFIG.rosterStartRow, 2, n, 2).getDisplayValues();
    v.forEach((r) => { if (isValidMemberValues_(r[0], r[1])) memberCount++; });
  }
  add('Roster has members', memberCount > 0, `${memberCount} member(s) found.`);

  const handlers = {};
  try { ScriptApp.getProjectTriggers().forEach((t) => { handlers[t.getHandlerFunction()] = true; }); } catch (e) { /* no scope yet */ }
  add('Form-submit trigger', handlers.onFormSubmit, handlers.onFormSubmit ? '' : 'New leave forms won’t auto-sync.', 'fixTriggers');
  add('Daily schedule trigger', handlers.processDailyLOAs, handlers.processDailyLOAs ? '' : 'Leaves won’t auto-start or expire.', 'fixTriggers');

  const whs = (typeof cpWebhookStatus_ === 'function') ? cpWebhookStatus_() : {};
  const whn = Object.keys(whs).filter((k) => whs[k]).length;
  add('Discord webhooks', whn > 0, whn > 0 ? `${whn} channel(s) configured.` : 'No channels visible to your account — set them on Tools (stored in the admin roster).');

  let bad = 0;
  if (roster && roster.getLastRow() >= CONFIG.rosterStartRow) {
    const RC = rosterCols_(roster);
    const n = roster.getLastRow() - CONFIG.rosterStartRow + 1;
    const ranks = roster.getRange(CONFIG.rosterStartRow, RC.rank, n, 1).getValues();
    const names = roster.getRange(CONFIG.rosterStartRow, RC.name, n, 1).getValues();
    const ids = roster.getRange(CONFIG.rosterStartRow, RC.discord, n, 1).getDisplayValues();
    const seen = {};
    for (let i = 0; i < n; i++) {
      if (!isValidMemberValues_(ranks[i][0], names[i][0])) continue;
      const id = String(ids[i][0]).trim();
      if (id === '') continue;
      if (!isValidId_(id)) bad++;
      seen[id] = (seen[id] || 0) + 1;
    }
    Object.keys(seen).forEach((k) => { if (seen[k] > 1) bad += seen[k] - 1; });
  }
  add('Discord IDs valid & unique', bad === 0, bad === 0 ? '' : `${bad} duplicate/malformed ID(s) — see Tools ▸ Check duplicate IDs.`);

  const schemaIssues = cpSchemaCheck_();
  add('Sheet structure matches the code', schemaIssues.length === 0,
    schemaIssues.length ? schemaIssues.join('  ·  ') : 'Key columns & headers are where the code expects them.');

  return { ok: checks.every((c) => c.ok), checks };
}

/* ----------------------------------------------------------------------------
 * SCHEMA GUARD — detect when the sheet layout drifts from what the code expects
 * ------------------------------------------------------------------------- */

/** 1-based column number → letter (1→A, 27→AA). */
function cpColLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Injectable core: checks a sheet's header row against an expected {col:keyword} map.
 * Each header (uppercased) must CONTAIN its keyword. @return {string[]} human-readable issues.
 */
function cpHeaderIssues_(sheet, label, headerRow, colsSpec) {
  if (!sheet) return []; // a missing tab is reported by the main health check, not here
  const issues = [];
  if (sheet.getLastRow() < headerRow) { issues.push(`${label}: header row ${headerRow} is missing.`); return issues; }
  const hdr = sheet.getRange(headerRow, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  Object.keys(colsSpec).forEach((colStr) => {
    const col = Number(colStr);
    const want = colsSpec[colStr];
    const got = String(hdr[col - 1] || '').toUpperCase().trim();
    if (got.indexOf(want) === -1) {
      issues.push(`${label} col ${cpColLetter_(col)}: expected a "${want}" header, found "${hdr[col - 1] || '(blank)'}"`);
    }
  });
  return issues;
}

/** Roster columns are header-resolved, so verify the required columns resolve on the roster's ACTUAL label row (auto-detected). */
function cpRosterHeaderIssues_(roster) {
  if (!roster) return [];
  const issues = [];
  const RC = rosterCols_(roster);
  if (!RC.headerRow) { issues.push(`${CONFIG.sheets.roster}: couldn't find a header row — need a row with a RANK label plus NAME/HOURS. Columns are resolved by header.`); return issues; }
  const hdr = roster.getRange(RC.headerRow, 1, 1, Math.max(roster.getLastColumn(), 1)).getDisplayValues()[0].map((h) => String(h).toUpperCase().trim());
  // Same matchers rosterCols_ uses (so UNIQUE ID counts as DISCORD and STATUS as ACTIVITY) — check by resolution, not literal text.
  const required = [
    { label: 'RANK', ok: (h) => h.indexOf('RANK') !== -1 && h.indexOf('GROUP') === -1 },
    { label: 'NAME', ok: (h) => h.indexOf('NAME') !== -1 && h.indexOf('OOC') === -1 },
    { label: 'UNIQUE ID / DISCORD', ok: (h) => h.indexOf('DISCORD') !== -1 || h.indexOf('UNIQUE') !== -1 },
    { label: 'STATUS / ACTIVITY', ok: (h) => h.indexOf('ACTIVITY') !== -1 || h.indexOf('STATUS') !== -1 },
    { label: 'HOURS', ok: (h) => h.indexOf('HOURS') !== -1 },
  ];
  required.forEach((req) => {
    if (!hdr.some(req.ok)) issues.push(`${CONFIG.sheets.roster}: no ${req.label} header in row ${RC.headerRow} — columns are resolved by header, so this label is required.`);
  });
  // F-019: duplicate headers silently shadow each other (only one wins on header-resolved ops / snapshot restore) — flag them.
  const seen = {};
  hdr.forEach((h, idx) => {
    if (h === '') return;
    if (seen[h] !== undefined) issues.push(`${CONFIG.sheets.roster}: duplicate "${h}" header in columns ${cpColLetter_(seen[h] + 1)} and ${cpColLetter_(idx + 1)} — header-resolved operations use only one; rename one to avoid silent data loss on restore.`);
    else seen[h] = idx;
  });
  return issues;
}

/** Validates the core tabs. Roster + tracker = required columns resolve by header (any layout); form = fixed positions. */
function cpSchemaCheck_() {
  const ss = SpreadsheetApp.getActive();
  let issues = [];
  issues = issues.concat(cpRosterHeaderIssues_(ss.getSheetByName(CONFIG.sheets.roster)));
  const tracker = ss.getSheetByName(CONFIG.sheets.tracker);
  if (tracker) { // the tracker resolves columns by header (trackerCols_) — verify the required ones are present
    const TC = trackerCols_(tracker);
    [['RANK', TC.rank], ['NAME', TC.name], ['UNIQUE ID / DISCORD', TC.discord], ['START DATE', TC.start], ['END DATE', TC.end], ['STATUS', TC.status]]
      .forEach((x) => { if (!x[1]) issues.push(`${CONFIG.sheets.tracker}: no ${x[0]} column found — the tracker resolves columns by header, so a ${x[0]} label is required.`); });
  }
  issues = issues.concat(cpHeaderIssues_(ss.getSheetByName(CONFIG.sheets.form), CONFIG.sheets.form, 1,
    { 1: 'TIME', 3: 'DISCORD', 6: 'STATUS', 7: 'START', 8: 'END' }));
  return issues;
}

/** One-click fix: (re)install the form-submit + daily triggers. Returns a status string. */
function cpFixTriggers() {
  const keep = { onFormSubmit: true, processDailyLOAs: true };
  ScriptApp.getProjectTriggers().forEach((t) => { if (keep[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t); });
  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('processDailyLOAs').timeBased().atHour(0).everyDays(1).create();
  auditEvent_('action', '', 'Installed form-submit + daily triggers.', '', '');
  cpInvalidateHealth_(); // triggers just changed — don't show a stale health check for 5 min
  return 'Triggers installed: form submit + daily schedule check.';
}

/* ----------------------------------------------------------------------------
 * SNAPSHOTS (in-sheet backup / restore)
 * ------------------------------------------------------------------------- */

/** Capture current member data to the hidden snapshot tab. @return {{id, when, count}} */
function cpTakeSnapshot() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Another snapshot/restore is in progress — try again in a moment.');
  try {
    const ss = SpreadsheetApp.getActive();
    const roster = ss.getSheetByName(CONFIG.sheets.roster);
    if (!roster) throw new Error(`Roster tab "${CONFIG.sheets.roster}" not found.`);
    let sh = ss.getSheetByName(TRUST.snapshotSheet);
    if (!sh) {
      sh = ss.insertSheet(TRUST.snapshotSheet);
      sh.hideSheet();
      sh.getRange(1, 1, 1, 9).setValues([['SnapshotId', 'When', 'Row', 'Name', 'Discord', 'Status', 'Hours', 'Rank', 'Extra']]).setFontWeight('bold');
    }
    const id = String(new Date().getTime());
    const when = fmtTs_(new Date()); // v1.0: configurable timestamp format
    const rows = cpSnapshotRows_(roster, id, when);
    if (!rows.length) throw new Error('No members to snapshot.');
    const start = sh.getLastRow() + 1;
    const w = rows[0].length; // 9 cols incl. the Extra(JSON) blob of any non-core MEMBER columns
    sh.getRange(start, 1, rows.length, w).setNumberFormat('@'); // keep IDs/values exact text
    sh.getRange(start, 1, rows.length, w).setValues(rows);
    cpPruneSnapshots_(sh);
    auditEvent_('snapshot', '', rows.length + ' members', '', '');
    return { id, when, count: rows.length };
  } finally {
    lock.releaseLock();
  }
}

/** Keeps only the most recent TRUST.keepSnapshots snapshots. */
function cpPruneSnapshots_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return;
  const ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  const order = [];
  ids.forEach((r) => { const id = String(r[0]).trim(); if (id && order.indexOf(id) === -1) order.push(id); });
  if (order.length <= TRUST.keepSnapshots) return;
  const remove = {};
  order.slice(0, order.length - TRUST.keepSnapshots).forEach((id) => { remove[id] = true; });
  // Decide from the ids already batch-read above (per-cell re-reads cost one call per history row), and delete
  // CONTIGUOUS RUNS bottom-up — a snapshot's rows are appended as one block, so pruning one is a single deleteRows
  // call instead of one deleteRow per member.
  let r = last;
  while (r >= 2) {
    if (!remove[String(ids[r - 2][0]).trim()]) { r--; continue; }
    let top = r;
    while (top - 1 >= 2 && remove[String(ids[top - 3][0]).trim()]) top--;
    sh.deleteRows(top, r - top + 1);
    r = top - 1;
  }
}

/** @return {Array<{id, when, count}>} newest first. */
function cpListSnapshots() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TRUST.snapshotSheet);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues(); // id, when
  const map = {};
  const order = [];
  v.forEach((r) => {
    const id = String(r[0]).trim();
    if (!id) return;
    if (!map[id]) { map[id] = { id, when: String(r[1]).trim(), count: 0 }; order.push(id); }
    map[id].count++;
  });
  return order.map((id) => map[id]).reverse();
}

/** Restores a snapshot's member data back into the roster by row. @return {{restored}} */
function cpRestoreSnapshot(id) {
  const sid = String(id).trim();
  if (!sid) throw new Error('No snapshot specified.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Another snapshot/restore is in progress — try again in a moment.');
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(TRUST.snapshotSheet);
    const roster = ss.getSheetByName(CONFIG.sheets.roster);
    if (!sh || !roster) throw new Error('Snapshot or roster tab is missing.');
    if (sh.getLastRow() < 2) throw new Error('No snapshots stored.');
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, 9).getDisplayValues(); // id,when,row,name,discord,status,hours,rank,extra(JSON)
    const snapRows = v.filter((r) => String(r[0]).trim() === sid);
    const restored = cpApplyRestore_(roster, snapRows);
    if (!restored) throw new Error('Nothing restored — snapshot not found or no matching slots.');
    auditEvent_('restore', '', restored + ' members', '', '');
    return { restored };
  } finally {
    lock.releaseLock();
  }
}

/** Injectable core: build snapshot rows from the given roster (no writes; testable). */
function cpSnapshotRows_(roster, id, when) {
  const rows = [];
  if (roster.getLastRow() >= CONFIG.rosterStartRow) {
    const RC = rosterCols_(roster);
    // Extra = MEMBER columns beyond the four captured explicitly (name/discord/status/hours), excluding any
    // section-specific columns opted into trainingCheckboxCols (none by default). Keyed by header so restore is
    // column-order-independent. Auto-captures new columns like LAST ACTIVITY.
    const core = {}; [RC.name, RC.discord, RC.activity, RC.hours].forEach((c) => { core[c] = true; });
    const cbox = {}; CONFIG.columns.trainingCheckboxCols.forEach((c) => { cbox[c] = true; });
    const extraCols = columnRegistry_(roster).filter((c) => c.klass === 'MEMBER' && !core[c.col] && !cbox[c.col]);
    const n = roster.getLastRow() - CONFIG.rosterStartRow + 1;
    const v = roster.getRange(CONFIG.rosterStartRow, 1, n, roster.getLastColumn()).getDisplayValues(); // full width; index by RC
    for (let i = 0; i < n; i++) {
      const rank = String(v[i][RC.rank - 1]).trim();
      const name = String(v[i][RC.name - 1]).trim();
      if (!isValidMemberValues_(rank, name)) continue;
      const extra = {};
      extraCols.forEach((c) => { extra[c.header.toUpperCase()] = String(v[i][c.col - 1]).trim(); });
      rows.push([id, when, CONFIG.rosterStartRow + i, name, String(v[i][RC.discord - 1]).trim(),
        String(v[i][RC.activity - 1]).trim(), String(v[i][RC.hours - 1]).trim(), rank, JSON.stringify(extra)]);
    }
  }
  return rows;
}

/** Injectable core: write snapshot rows back into the roster by row (testable). @return {number} restored. */
function cpApplyRestore_(roster, snapRows) {
  const RC = rosterCols_(roster);
  const byHeader = {}; columnRegistry_(roster).forEach((c) => { byHeader[c.header.toUpperCase()] = c.col; });
  // Restore by member IDENTITY: map the CURRENT roster Discord IDs → row, so a row insert/delete since the
  // snapshot can't drop a member's data onto a different member's row.
  const last = roster.getLastRow();
  const idToRow = {};
  let rankCache = null; // ranks batch-read once — a restore never writes the RANK column, so the cache can't go stale
  if (last >= CONFIG.rosterStartRow) {
    const n = last - CONFIG.rosterStartRow + 1;
    const ids = roster.getRange(CONFIG.rosterStartRow, RC.discord, n, 1).getDisplayValues();
    for (let k = 0; k < ids.length; k++) { const id = String(ids[k][0]).trim(); if (id && !(id in idToRow)) idToRow[id] = CONFIG.rosterStartRow + k; }
    rankCache = roster.getRange(CONFIG.rosterStartRow, RC.rank, n, 1).getDisplayValues();
  }
  let restored = 0;
  for (let i = 0; i < snapRows.length; i++) {
    const snapId = String(snapRows[i][4]).trim();
    // Prefer the row that currently holds this member's ID; else the stored row, but only if it's safe (empty / same ID).
    let row = (snapId && idToRow[snapId]) ? idToRow[snapId] : -1;
    if (row === -1) {
      const storedRow = Number(snapRows[i][2]);
      if (!(storedRow >= CONFIG.rosterStartRow)) continue;
      const rowId = String(roster.getRange(storedRow, RC.discord).getDisplayValue()).trim();
      if (rowId !== '' && rowId !== snapId) { log_('cpApplyRestore_', `snapshot row ${storedRow} now holds a different member — skipped to avoid overwrite`); continue; }
      row = storedRow;
    }
    const rank = (rankCache && row >= CONFIG.rosterStartRow && (row - CONFIG.rosterStartRow) < rankCache.length)
      ? String(rankCache[row - CONFIG.rosterStartRow][0]).trim()
      : String(roster.getRange(row, RC.rank).getDisplayValue()).trim();
    if (!isMemberSlot_(rank) || rank === '' || rank === 'Rank') continue;
    roster.getRange(row, RC.name).setValue(snapRows[i][3]);
    const idCell = roster.getRange(row, RC.discord); idCell.setNumberFormat('@'); idCell.setValue(snapRows[i][4]);
    roster.getRange(row, RC.activity).setValue(snapRows[i][5]);
    const hrs = parseFloat(snapRows[i][6]);
    roster.getRange(row, RC.hours).setValue(isNaN(hrs) ? snapRows[i][6] : hrs);
    // Restore any extra MEMBER columns the snapshot captured (index 8 = JSON {header:value}), by header.
    if (snapRows[i][8]) {
      try {
        const extra = JSON.parse(snapRows[i][8]);
        Object.keys(extra).forEach((h) => {
          const col = byHeader[h];
          if (!col) { log_('cpApplyRestore_', `snapshot column "${h}" no longer maps to a current header — its value was NOT restored`); return; }
          const cell = roster.getRange(row, col);
          if (/^\d{16,}$/.test(String(extra[h]))) cell.setNumberFormat('@'); // keep long IDs exact
          cell.setValue(extra[h]);
        });
      } catch (e) { log_('cpApplyRestore_', e); }
    }
    restored++;
  }
  return restored;
}

/** Injectable core: detect a member move (ID already on another roster row). Returns move info or null (testable). */
function cpDetectMove_(sheet, editedRow, newId) {
  const id = String(newId).trim();
  if (!isValidId_(id)) return null;
  const RC = rosterCols_(sheet);
  const cnt = sheet.getLastRow() - CONFIG.rosterStartRow + 1;
  if (cnt <= 0) return null;
  const ids = sheet.getRange(CONFIG.rosterStartRow, RC.discord, cnt, 1).getDisplayValues();
  let otherRow = -1;
  for (let j = 0; j < cnt; j++) {
    const rr = CONFIG.rosterStartRow + j;
    if (rr !== editedRow && String(ids[j][0]).trim() === id) { otherRow = rr; break; }
  }
  if (otherRow === -1) return null;
  const fr = String(sheet.getRange(otherRow, RC.rank).getDisplayValue()).trim() || 'Unknown';
  const fu = String(sheet.getRange(otherRow, RC.unit).getDisplayValue()).trim() || '—';
  const tr = String(sheet.getRange(editedRow, RC.rank).getDisplayValue()).trim() || 'Unknown';
  const tu = String(sheet.getRange(editedRow, RC.unit).getDisplayValue()).trim() || '—';
  const member = String(sheet.getRange(otherRow, RC.name).getDisplayValue()).trim();
  return { from: fr + ' · ' + fu, to: tr + ' · ' + tu, member: member, sourceRow: otherRow, nameCellA1: sheet.getRange(editedRow, RC.name).getA1Notation() };
}

/* ----------------------------------------------------------------------------
 * AUTOMATIC WEEKLY SNAPSHOT (own trigger; runs Sundays ~22:00, before any reset)
 * ------------------------------------------------------------------------- */

/** Scheduled handler: take a weekly roster snapshot. No UI — safe from triggers. */
function weeklySnapshotScheduled() {
  try {
    const r = cpTakeSnapshot();
    logInfo_('weeklySnapshotScheduled', `weekly snapshot saved (${r.count} members).`);
  } catch (err) {
    log_('weeklySnapshotScheduled', err);
  }
}

/** @return {boolean} whether the weekly auto-snapshot trigger is installed. */
function cpSnapshotAutoStatus() {
  try {
    return ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'weeklySnapshotScheduled');
  } catch (e) {
    return false;
  }
}

/** Turns the weekly auto-snapshot trigger on/off (Sunday ~22:00). @return {{enabled:boolean}} */
function cpSetSnapshotAuto(on) {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'weeklySnapshotScheduled') ScriptApp.deleteTrigger(t);
  });
  if (on) {
    ScriptApp.newTrigger('weeklySnapshotScheduled').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(22).create();
  }
  return { enabled: !!on };
}

/* ----------------------------------------------------------------------------
 * AUDIT LOG (read the Edit Log tab from RosterExtras)
 * ------------------------------------------------------------------------- */

/**
 * @return {Array} newest first. Roster edits are enriched with `member` (the name on
 * that row) and `field` (the column's header label, e.g. "FTO PROGRAM"), resolved here.
 */
function cpAuditTail(n) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(TRUST.auditSheet);
  const out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  const take = Math.min(n || 25, sh.getLastRow() - 1);
  const start = sh.getLastRow() - take + 1;
  const v = sh.getRange(start, 1, take, 8).getDisplayValues(); // Time, Editor, Sheet, Cell, Old, New, Type, Member

  // Read once for enrichment: roster names by row + column header labels (row 5).
  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  let names = [];
  const headers = {};
  const d = CONFIG.roster;
  let RC = { rank: d.rank, name: d.name, unit: d.unit, discord: d.discord, join: 6, promo: 7, activity: d.activity, hours: d.hours };
  if (roster) {
    RC = rosterCols_(roster);
    const lastRow = roster.getLastRow();
    if (lastRow >= CONFIG.rosterStartRow) {
      names = roster.getRange(CONFIG.rosterStartRow, RC.name, lastRow - CONFIG.rosterStartRow + 1, 1).getDisplayValues();
    }
    const hdr = roster.getRange(5, 1, 1, roster.getLastColumn()).getDisplayValues()[0]; // column labels live on row 5
    for (let c = 0; c < hdr.length; c++) headers[c + 1] = String(hdr[c]).trim();
  }
  const FRIENDLY = {};
  FRIENDLY[RC.rank] = 'Rank'; FRIENDLY[RC.name] = 'Name'; FRIENDLY[RC.unit] = 'Callsign';
  FRIENDLY[RC.discord] = 'Discord ID'; FRIENDLY[RC.join] = 'Join date'; FRIENDLY[RC.promo] = 'Last promotion';
  FRIENDLY[RC.activity] = 'Status'; FRIENDLY[RC.hours] = 'Hours';

  for (let i = v.length - 1; i >= 0; i--) {
    const sheet = String(v[i][2]).trim();
    const cell = String(v[i][3]).trim();
    let member = '';
    let field = '';
    if (roster && sheet === CONFIG.sheets.roster) {
      const letters = (cell.match(/[A-Z]+/) || [''])[0];
      let cn = 0;
      for (let k = 0; k < letters.length; k++) cn = cn * 26 + (letters.charCodeAt(k) - 64);
      const rowNum = parseInt((cell.match(/\d+/) || ['0'])[0], 10);
      field = (headers[cn] && headers[cn] !== '') ? headers[cn] : (FRIENDLY[cn] || '');
      if (rowNum >= CONFIG.rosterStartRow) {
        const idx = rowNum - CONFIG.rosterStartRow;
        if (idx >= 0 && idx < names.length) member = String(names[idx][0]).trim();
      }
    }
    const explicitMember = String(v[i][7] || '').trim();
    if (explicitMember) member = explicitMember; // semantic entries carry the member name directly
    out.push({ time: String(v[i][0]).trim(), editor: String(v[i][1]).trim(), sheet, cell,
      oldV: String(v[i][4]).trim(), newV: String(v[i][5]).trim(), type: String(v[i][6]).trim(), member, field });
  }
  return out;
}

/**
 * The audit identity for an editor: when the editing account's email is listed on a member's roster row (the
 * roster's private EMAIL column), every audit reference shows that member's NAME; otherwise it stays the raw
 * email. One roster read per execution — the email→name map is memoized because auditEdit fires on every edit.
 */
let _auditWhoMemo_ = null;
function auditWho_(email) {
  const em = String(email || '').trim();
  if (!em) return 'unknown';
  try {
    if (_auditWhoMemo_ === null) {
      _auditWhoMemo_ = {};
      const roster = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster);
      if (roster && typeof rosterPiiCols_ === 'function') {
        const P = rosterPiiCols_(roster);
        const RC = rosterCols_(roster);
        const start = CONFIG.rosterStartRow, last = roster.getLastRow();
        if (P.email && RC.name && last >= start) {
          const n = last - start + 1;
          const emails = roster.getRange(start, P.email, n, 1).getDisplayValues();
          const names = roster.getRange(start, RC.name, n, 1).getDisplayValues();
          for (let i = 0; i < n; i++) {
            const k = String(emails[i][0]).trim().toLowerCase();
            const nm = String(names[i][0]).trim();
            if (k && nm && !(k in _auditWhoMemo_)) _auditWhoMemo_[k] = nm; // first row wins on a duplicated email
          }
        }
      }
    }
    return _auditWhoMemo_[em.toLowerCase()] || em;
  } catch (e2) { return em; }
}

/**
 * Installable onEdit handler: logs who/what/when to the Edit Log tab. Self-contained
 * (does not need RosterExtras). Point an installable onEdit trigger here — or just
 * flip the "Audit log" toggle in the panel, which manages the trigger for you.
 */
function auditEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheetName = e.range.getSheet().getName();
    // Never audit the system/working tabs.
    // System tabs are never audited. ⚙️ Config is deliberately NOT skipped — who changed the config is
    // exactly what an audit trail is for. SYS Log is engine diagnostics (script writes don't fire onEdit,
    // but a human poking it shouldn't spam the audit).
    const skip = [TRUST.snapshotSheet, TRUST.auditSheet, CONFIG.sheets.hoursHistory, CONFIG.sheets.coverage, CONFIG.sheets.integrity, SYS_LOG_SHEET];
    if (skip.indexOf(sheetName) !== -1) return;

    // A member move (an existing roster ID entered into another row) is logged as a transfer.
    if (sheetName === CONFIG.sheets.roster && e.range.getColumn() === rosterCols_(e.range.getSheet()).discord) {
      const mv = cpDetectMove_(e.range.getSheet(), e.range.getRow(), e.value === undefined ? '' : String(e.value));
      if (mv) { auditEvent_('move', mv.from, mv.to, mv.nameCellA1, mv.member); return; }
    }

    const ss = SpreadsheetApp.getActive();
    let log = ss.getSheetByName(TRUST.auditSheet);
    if (!log) {
      log = ss.insertSheet(TRUST.auditSheet);
      log.appendRow(['Time', 'Editor', 'Sheet', 'Cell', 'Old', 'New', 'Type', 'Member']);
      log.setFrozenRows(1);
    }
    let email = '';
    try { email = Session.getActiveUser().getEmail() || ''; } catch (x) { /* cross-account: not available */ }

    const multi = e.range.getNumRows() * e.range.getNumColumns() > 1;
    const oldV = multi ? '(multi-cell)' : (e.oldValue === undefined ? '' : e.oldValue);
    const newV = multi ? '(multi-cell — see range)' : (e.value === undefined ? '' : e.value);
    const who = auditWho_(email); // member NAME when the email is on their roster row, else the email
    log.appendRow([new Date(), who, sheetName, e.range.getA1Notation(), oldV, newV, '', '']);
    const cap = logRowCap_(), last = log.getLastRow(); if (last > cap) log.deleteRows(2, last - cap); // prune oldest, keep header (v1.0: config cap)
    auditNotify_(who, sheetName, e.range.getA1Notation(), oldV, newV, 'edit', ''); // AUDIT channel mirror (webhook presence = opt-in)
  } catch (err) {
    log_('auditEdit', err);
  }
}

/**
 * Writes a SEMANTIC audit entry (e.g. a member move) so the viewer shows it as a real
 * action rather than a raw cell edit. `type` drives the viewer's label/icon; `cellA1`
 * lets the viewer resolve the member name from that row.
 */
function auditEvent_(type, oldText, newText, cellA1, member) {
  try {
    const ss = SpreadsheetApp.getActive();
    let log = ss.getSheetByName(TRUST.auditSheet);
    if (!log) {
      log = ss.insertSheet(TRUST.auditSheet);
      log.appendRow(['Time', 'Editor', 'Sheet', 'Cell', 'Old', 'New', 'Type', 'Member']);
      log.setFrozenRows(1);
    }
    let email = '';
    try { email = Session.getActiveUser().getEmail() || ''; } catch (x) { /* not available */ }
    const who = auditWho_(email); // member NAME when the email is on their roster row, else the email
    log.appendRow([new Date(), who, CONFIG.sheets.roster, cellA1 || '', oldText || '', newText || '', type || '', member || '']);
    const cap = logRowCap_(), last = log.getLastRow(); if (last > cap) log.deleteRows(2, last - cap); // v1.0: config cap
    auditNotify_(who, CONFIG.sheets.roster, cellA1 || '', oldText || '', newText || '', type || 'action', member || ''); // AUDIT channel mirror
  } catch (err) {
    log_('auditEvent_', err);
  }
}

/** Human label for an audit type — shared by the Discord mirror. */
function auditTypeLabel_(t) {
  const m = { add: 'Member added', status: 'Status change', bulk: 'Bulk status change', leave: 'Leave scheduled', move: 'Member moved', patrol: 'Patrol hours credited', action: 'System action', snapshot: 'Snapshot taken', restore: 'Snapshot restored', cert: 'Certification change', hours: 'Hours change', edit: 'Sheet edit' };
  return m[String(t || '').toLowerCase()] || 'Sheet edit';
}

/**
 * Mirror an audit entry to the AUDIT Discord channel. Webhook presence IS the opt-in (like the errors channel);
 * no webhook (or no admin-file access for this account) = silent no-op. Never throws into the edit that fired it.
 */
function auditNotify_(editor, sheetName, cellA1, oldV, newV, type, member) {
  try {
    if (!webhookFor_('AUDIT')) return; // memoized per execution — cheap when unset
    const fields = [];
    const add = (n, v) => { if (String(v == null ? '' : v).trim() !== '') fields.push({ name: n, value: clamp_(dash_(String(v)), 1000), inline: true }); };
    add('👤 Editor', editor);
    add('📄 Sheet', sheetName);
    add('📍 Cell', cellA1);
    add('🧾 Member', member);
    add('◀️ Old', oldV);
    add('▶️ New', newV);
    const vars = { editor, sheet: sheetName, cell: cellA1, member, old: oldV, 'new': newV, action: auditTypeLabel_(type) };
    const fallback = {
      title: `📝 ${auditTypeLabel_(type)}`,
      color: 5793266,
      fields,
      footer: { text: `${CONFIG.systemName} • audit` },
    };
    notifyEvent_('AUDIT', true, 'audit', vars, fallback, '');
  } catch (e) { /* the audit trail itself already saved — a Discord failure must never surface */ }
}

/** @return {boolean} whether an installable onEdit audit trigger is active. */
function cpAuditAutoStatus() {
  try {
    return ScriptApp.getProjectTriggers().some((t) => {
      const fn = t.getHandlerFunction();
      return (fn === 'auditEdit' || fn === 'recordEdit') && String(t.getEventType()) === 'ON_EDIT';
    });
  } catch (e) {
    return false;
  }
}

/** Guarantees the audit trigger exists (audit is always-on). Idempotent; removes dup recordEdit triggers. */
function cpEnsureAuditTrigger() {
  // Lock so two near-simultaneous panel opens can't both pass the "no auditEdit" check and create duplicate triggers (double-logging).
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return false; // someone else is already ensuring it
  try {
    let hasAudit = false;
    ScriptApp.getProjectTriggers().forEach((t) => {
      const fn = t.getHandlerFunction();
      if (fn === 'auditEdit' && String(t.getEventType()) === 'ON_EDIT') hasAudit = true;
      else if (fn === 'recordEdit' && String(t.getEventType()) === 'ON_EDIT') ScriptApp.deleteTrigger(t);
    });
    if (!hasAudit) ScriptApp.newTrigger('auditEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
    return true;
  } finally {
    lock.releaseLock();
  }
}
