/**
 * ============================================================================
 * ROSTER EXTRAS — optional add-ons for the core Roster System.
 * ----------------------------------------------------------------------------
 * Paste this as a SECOND file alongside RosterSystem.gs. It reuses the core's
 * CONFIG and helpers (getSheetOrWarn_, runAction_, log_/logWarn_/logInfo_,
 * clamp_, computeStatus_, parseHours_, isProtectedStatus_, isValidMemberValues_,
 * recomputeStatuses_, sendWebhookPayload_, footer_, todayInSheetTz_, startOfDay_).
 *
 * Adds: weekly hours history, a leave-coverage view, a data-integrity scan,
 * and a who/what/when audit log.
 *
 * SETUP (after RosterSystem.gs is in and working):
 *   1. Paste this file, save.
 *   2. Run installExtras().
 *   3. In your core onOpen(), add one line:  addExtrasMenu_();
 *   4. Reload the sheet for the "🛠️ Extras" menu.
 *
 * NOTE: do NOT install an onEdit trigger for recordEdit — the Control Panel's audit log (auditEdit in
 * RosterTrust.gs) already records edits, and adding recordEdit too would double-log. recordEdit is kept
 * only for installs without RosterTrust.gs.
 *
 * NOTE: the core's "Reset Weekly Hours" does NOT save history; use this file's
 *   "Weekly Reset (saves history)" instead if you want the historical record.
 * ============================================================================
 */

/**
 * Extras settings. v2.5.0 — the tab names now resolve LIVE from [SHEETS] on ⚙️ Config (getters, so every existing
 * `EXTRAS.historySheet` read stays dynamic with zero call-site churn). Blank/absent config → the shipped default.
 */
const EXTRAS = Object.freeze({
  get historySheet() { return cfgSheetName_('hoursHistory', '_Hours History'); }, // hidden record of weekly hours
  get coverageSheet() { return cfgSheetName_('coverage', 'Leave Coverage'); },
  get integritySheet() { return cfgSheetName_('integrity', 'Integrity Log'); },
  get auditSheet() { return cfgSheetName_('audit', 'Edit Log'); },
});

/* ======================================================================
 * MENU & INSTALL
 * ====================================================================== */

// The Extras menu is retired — its actions moved into the 👥 Roster menu (Run Integrity Scan) and 🧪 Dev / QA
// (Load Demo Roster). The functions below still power the daily/6am triggers and those relocated menu items.

/** Creates the extras' time-driven triggers (replacing any duplicates). */
/**
 * Core: (re)install the extras time-driven triggers from [SCHEDULE] (integrity scan, coverage rebuild, cadence-aware
 * hours reset). No UI — returns a human description of the reset schedule. Shared by 📋 Roster ▸ Install Triggers.
 */
function installExtrasTriggers_() {
  // 'dailyBackup' stays listed so re-running deletes any leftover backup trigger from earlier.
  const managed = { dailyBackup: true, scanIntegrity: true, buildCoverage: true, weeklyResetScheduled: true };
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (managed[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
  // Reset cadence/day/hour come from [SCHEDULE] on ⚙️ Config (defaults WEEKLY · SUN · 23 — the classic schedule).
  // Resolved G1: the reset captures the hours-history tab BEFORE zeroing, so the panel sparkline survives.
  let day = 'SUN', hour = 23, cadence = 'WEEKLY', dom = 1;
  try { const sc = cfg_().kv.SCHEDULE; day = sc.WEEKLY_HOURS_RESET; hour = sc.WEEKLY_RESET_HOUR; cadence = sc.RESET_CADENCE; dom = sc.RESET_DOM; } catch (e) { /* config broken — classic weekly schedule */ }
  const weekDays = { SUN: ScriptApp.WeekDay.SUNDAY, MON: ScriptApp.WeekDay.MONDAY, TUE: ScriptApp.WeekDay.TUESDAY, WED: ScriptApp.WeekDay.WEDNESDAY, THU: ScriptApp.WeekDay.THURSDAY, FRI: ScriptApp.WeekDay.FRIDAY, SAT: ScriptApp.WeekDay.SATURDAY };
  ScriptApp.newTrigger('scanIntegrity').timeBased().atHour(7).everyDays(1).create();
  ScriptApp.newTrigger('buildCoverage').timeBased().atHour(6).everyDays(1).create();
  // v2.5.0 — cadence-aware reset trigger. MANUAL (or WEEKLY_HOURS_RESET=OFF) installs no trigger. MONTHLY fires on
  // RESET_DOM. WEEKLY/BIWEEKLY fire weekly on the chosen weekday; the handler (resetDue_) gates BIWEEKLY to ~14 days
  // apart via the LAST_RESET marker, so Apps Script's lack of a native bi-weekly trigger doesn't matter.
  let resetDesc = 'OFF (no auto-reset)';
  if (cadence !== 'MANUAL' && day !== 'OFF') {
    if (cadence === 'MONTHLY') {
      ScriptApp.newTrigger('weeklyResetScheduled').timeBased().onMonthDay(dom).atHour(hour).create();
      resetDesc = `MONTHLY (day ${dom}, ${hour}:00)`;
    } else {
      ScriptApp.newTrigger('weeklyResetScheduled').timeBased().onWeekDay(weekDays[day] || ScriptApp.WeekDay.SUNDAY).atHour(hour).create();
      resetDesc = `${cadence} (${day} ${hour}:00)`;
    }
  }
  logInfo_('installExtrasTriggers_', `extras triggers installed (reset: ${resetDesc}).`);
  return resetDesc;
}

/** Kept for direct use / back-compat. The menu now folds this into 📋 Roster ▸ Install Triggers (one installer). */
function installExtras() {
  runAction_('Install Extras', () => {
    const resetDesc = installExtrasTriggers_();
    SpreadsheetApp.getUi().alert(`✅ Extras triggers installed.\n\nIntegrity scan (7am), coverage rebuild (6am), hours reset — ${resetDesc}.`);
  });
}

/* ======================================================================
 * SHARED HELPERS (extras-local; reuse core helpers where possible)
 * ====================================================================== */

/** Reads valid roster members. IDs via getDisplayValues to stay exact (17-19 digits). */
function readMembers_(roster) {
  const out = [];
  const last = roster.getLastRow();
  if (last < CONFIG.rosterStartRow) return out;
  const RC = rosterCols_(roster);
  const n = last - CONFIG.rosterStartRow + 1;
  const v = roster.getRange(CONFIG.rosterStartRow, 1, n, roster.getLastColumn()).getDisplayValues(); // full width; index by RC (col-1)
  for (let i = 0; i < n; i++) {
    const rank = v[i][RC.rank - 1];
    const name = v[i][RC.name - 1];
    if (!isValidMemberValues_(rank, name)) continue;
    out.push({
      row: CONFIG.rosterStartRow + i,
      rank: String(rank).trim(),
      name: String(name).trim(),
      id: String(v[i][RC.discord - 1]).trim(),
      activity: String(v[i][RC.activity - 1]).trim(),
      hours: v[i][RC.hours - 1],
    });
  }
  return out;
}

/** Approved, not-yet-ended leaves from the tracker. */
function activeLeaves_(tracker) {
  const out = [];
  const last = tracker.getLastRow();
  if (last < CONFIG.trackerStartRow) return out;
  const n = last - CONFIG.trackerStartRow + 1;
  const v = tracker.getRange(CONFIG.trackerStartRow, 2, n, 11).getValues(); // cols B..L
  const ids = tracker.getRange(CONFIG.trackerStartRow, CONFIG.tracker.discord, n, 1).getDisplayValues(); // IDs EXACT — getValues rounds a 17-19 digit ID
  const today = todayInSheetTz_();
  for (let i = 0; i < n; i++) {
    if (v[i][CONFIG.tracker.status - 2] !== CONFIG.approvedStatus) continue;
    const start = startOfDay_(new Date(v[i][CONFIG.tracker.start - 2]));
    const end = startOfDay_(new Date(v[i][CONFIG.tracker.end - 2]));
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || today.getTime() > end.getTime()) continue;
    out.push({
      name: v[i][CONFIG.tracker.name - 2],
      type: v[i][CONFIG.tracker.type - 2],
      id: String(ids[i][0]).trim(),
      start, end,
      started: today.getTime() >= start.getTime(),
    });
  }
  return out;
}

/** Formats a Date to yyyy-MM-dd (sheet TZ); passes other values through as trimmed text. */
function fmtDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return String(v ?? '').trim();
}

/** Canonical week bucket (the week's Sunday, yyyy-MM-dd) so repeat captures collapse. */
function weekKey_(d) {
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  let base = d instanceof Date ? new Date(d.getTime()) : todayInSheetTz_();
  base = new Date(base.getFullYear(), base.getMonth(), base.getDate() - base.getDay());
  return Utilities.formatDate(base, tz, 'yyyy-MM-dd');
}

/** Posts a simple summary embed to the AUDIT channel (no-op if none set). */
function postSummary_(title, description, color) {
  sendWebhookPayloadCh_('AUDIT', {
    embeds: [{
      title,
      description: clamp_(description, 4000),
      color: color || 3447003,
      footer: footer_(),
      timestamp: new Date().toISOString(),
    }],
  });
}

/* ======================================================================
 * HOURS HISTORY + WEEKLY RESET
 * ====================================================================== */

/** Appends this week's hours for every member to the hidden history tab. */
function captureHoursSnapshot_(weekLabel) {
  const ss = SpreadsheetApp.getActive();
  const roster = getSheetOrWarn_(ss, CONFIG.sheets.roster);
  if (!roster) return 0;
  let sh = ss.getSheetByName(EXTRAS.historySheet);
  if (!sh) {
    sh = ss.insertSheet(EXTRAS.historySheet);
    sh.hideSheet();
    sh.getRange(1, 1, 1, 6).setValues([['WeekOf', 'DiscordID', 'Name', 'Rank', 'Hours', 'Status']]).setFontWeight('bold');
  }
  const when = weekLabel || weekKey_();
  const members = readMembers_(roster);
  if (!members.length) return 0;
  // Replace this week's rows (don't duplicate) if the snapshot is re-run within the same week.
  if (sh.getLastRow() >= 2) {
    const weeks = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
    for (let r = weeks.length - 1; r >= 0; r--) { if (String(weeks[r][0]).trim() === String(when).trim()) sh.deleteRow(r + 2); }
  }
  const rows = members.map((m) => [when, m.id, m.name, m.rank, parseHours_(m.hours), m.activity]);
  const startRow = sh.getLastRow() + 1;
  sh.getRange(startRow, 2, rows.length, 1).setNumberFormat('@'); // keep IDs exact
  sh.getRange(startRow, 1, rows.length, 6).setValues(rows);
  // F-024: cap growth like the sibling Integrity/Edit logs — trim the oldest rows so the sheet can't grow unbounded.
  const CAP = logRowCap_(); // v2.5.0: configurable
  const last = sh.getLastRow();
  if (last > CAP + 1) sh.deleteRows(2, last - CAP - 1); // keep the header + newest CAP rows
  logInfo_('captureHoursSnapshot_', `captured ${rows.length} member-hours for week ${when}.`);
  return rows.length;
}

/**
 * Period label for the archive column just captured, from [SCHEDULE].RESET_CADENCE + the date. Always ends in
 * "HOURS" so the archive auto-detector keeps finding the column after it's relabelled.
 *   MONTHLY → "JUL HOURS" (the month being closed; an early-in-month capture labels the month that just ended)
 *   WEEKLY / BIWEEKLY → "13 JUL HOURS" (the period-ending date)
 */
function periodLabel_() {
  const tz = ssTz_();
  let cad = 'MONTHLY';
  try { cad = String(cfg_().kv.SCHEDULE.RESET_CADENCE || 'MONTHLY').toUpperCase(); } catch (e) { /* config broken → monthly */ }
  const now = todayInSheetTz_();
  if (cad === 'MONTHLY') {
    const d = new Date(now);
    if (d.getDate() <= 7) d.setDate(0); // just after a month boundary → label the month that ended
    return Utilities.formatDate(d, tz, 'MMM').toUpperCase() + ' HOURS';
  }
  return Utilities.formatDate(now, tz, 'd MMM').toUpperCase() + ' HOURS'; // weekly / bi-weekly → the period-ending date
}

/**
 * Rolling archive: before hours are zeroed, shift the visible period columns (every "* HOURS" column EXCEPT the
 * primary HOURS) one to the LEFT — each takes the next one's data + header, the oldest drops off the visible set,
 * and the rightmost receives the current HOURS under `periodLabel`. No visible archive columns → a no-op (the
 * hidden history tab still keeps the record). @return {number} archive columns shifted.
 */
function shiftArchiveColumns_(roster, periodLabel) {
  const RC = rosterCols_(roster);
  if (!RC.hours || !RC.headerRow) return 0;
  const lastCol = roster.getLastColumn();
  const hdr = roster.getRange(RC.headerRow, 1, 1, lastCol).getDisplayValues()[0];
  const archive = [];
  for (let c = 1; c <= lastCol; c++) {
    if (c === RC.hours) continue;
    if (String(hdr[c - 1] || '').toUpperCase().indexOf('HOURS') !== -1) archive.push(c);
  }
  if (!archive.length) return 0;
  const startRow = CONFIG.rosterStartRow;
  const n = roster.getLastRow() - startRow + 1;
  if (n <= 0) return 0;
  const curHours = roster.getRange(startRow, RC.hours, n, 1).getValues();
  const archData = archive.map((c) => roster.getRange(startRow, c, n, 1).getValues()); // read ALL before writing
  for (let i = 0; i < archive.length - 1; i++) { // shift data + headers LEFT: col i takes col (i+1)
    roster.getRange(startRow, archive[i], n, 1).setValues(archData[i + 1]);
    roster.getRange(RC.headerRow, archive[i], 1, 1).setValue(hdr[archive[i + 1] - 1]);
  }
  const last = archive[archive.length - 1]; // rightmost = the period just closed
  roster.getRange(startRow, last, n, 1).setValues(curHours);
  roster.getRange(RC.headerRow, last, 1, 1).setValue(periodLabel);
  return archive.length;
}

/** Core reset: archive-shift, capture history, then zero + recompute. Locked; no UI (safe from triggers). */
function doWeeklyReset_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { logWarn_('doWeeklyReset_', 'another run holds the lock; skipping.'); return; }
  try {
    const ss = SpreadsheetApp.getActive();
    const roster = getSheetOrWarn_(ss, CONFIG.sheets.roster);
    if (!roster) return;
    const captured = captureHoursSnapshot_() || 0; // preserve history BEFORE zeroing
    const before = readMembers_(roster);
    let shifted = 0; // roll the visible period columns (MAY HOURS → JUN HOURS → …) BEFORE hours are zeroed
    try { shifted = shiftArchiveColumns_(roster, periodLabel_()); } catch (e) { log_('doWeeklyReset_.archive', e); }
    recomputeStatuses_(roster, true);     // core function: zero + recompute
    const after = readMembers_(roster);
    const prev = {};
    before.forEach((m) => { prev[m.id] = m.activity; });
    const lowestTier = CONFIG.tierNames.length ? CONFIG.tierNames[CONFIG.tierNames.length - 1] : 'Inactive';
    const dropped = after.filter((m) => m.activity === lowestTier && prev[m.id] !== lowestTier);
    const totalHours = before.reduce((s, m) => s + parseHours_(m.hours), 0); // hoisted: used by the digest AND the return summary
    const activeCount = after.filter((m) => m.activity !== lowestTier).length;
    logInfo_('doWeeklyReset_', `reset complete; ${dropped.length} dropped to ${lowestTier}.`);
    if (CONFIG.notify && CONFIG.notify.weeklyDigest) { // v2.5.0 richer opt-in digest supersedes the basic reset notice
      notifyCh_('AUDIT', true, {
        title: fill_(CONFIG.notify.digestTitle, {}),
        color: hexToInt_(CONFIG.notify.digestColor, 5793266),
        description: `Hours have been zeroed and statuses recomputed for the new period.`,
        fields: [
          { name: '👥 Roster', value: `${after.length} member(s)`, inline: true },
          { name: '🟢 Active', value: `${activeCount}`, inline: true },
          { name: '🔻 Dropped', value: `${dropped.length} → ${lowestTier}`, inline: true },
          { name: '⏱️ Hours logged', value: `${Math.round(totalHours * 10) / 10} hrs this period`, inline: true },
        ],
      });
    } else {
      postSummary_('🗑️ Weekly Reset', `Hours zeroed and statuses recomputed. **${dropped.length}** member(s) dropped to ${lowestTier}.`, 15105570);
    }
    try { PropertiesService.getScriptProperties().setProperty(LAST_RESET_PROP, String(Date.now())); } catch (e) { /* best-effort cadence marker */ } // v2.5.0: advance the cadence clock (manual + scheduled both count)
    return { captured: captured, shifted: shifted, total: after.length, droppedNames: dropped.map((m) => m.name), lowestTier: lowestTier, totalHours: totalHours };
  } finally {
    lock.releaseLock();
  }
}

/** Menu action: confirm, then reset with history. */
function weeklyResetWithHistory() {
  runAction_('Capture & Reset Activity', () => {
    const ui = SpreadsheetApp.getUi();
    const resp = ui.alert('📸 Capture & Reset Activity',
      'Roll this period\'s HOURS into the previous-period column(s), save a history snapshot, then zero HOURS and recompute statuses?\n\nLOA/ROA/Reserve stay protected.',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
    const res = doWeeklyReset_();
    if (!res) { ui.alert('Capture skipped — another reset is already running.'); return; }
    const dn = res.droppedNames.filter(Boolean);
    const sample = dn.length ? ` (${dn.slice(0, 8).join(', ')}${dn.length > 8 ? `, +${dn.length - 8}` : ''})` : '';
    ui.alert(`✅ Activity captured & reset.\n\n• ${res.shifted ? `${res.shifted} period column${res.shifted === 1 ? '' : 's'} rolled forward` : 'No visible period columns (history-only)'}\n• ${res.captured} member-hours saved to history\n• ${res.total} member(s) recomputed\n• ${dn.length} dropped to ${res.lowestTier}${sample}\n• ${Math.round(res.totalHours * 10) / 10} hrs logged this period`);
  });
}

/** Trigger handler: scheduled reset. Gated by the configured cadence (WEEKLY runs every fire; BIWEEKLY/MONTHLY need enough elapsed days). */
function weeklyResetScheduled() {
  if (!resetDue_()) { logInfo_('weeklyResetScheduled', 'hours reset not due yet for the current cadence — skipping this fire.'); return; }
  runAction_('Weekly Reset (scheduled)', doWeeklyReset_);
}

/**
 * v2.5.0 — is the hours reset due now, given [SCHEDULE].RESET_CADENCE and the LAST_RESET marker? WEEKLY fires every
 * scheduled run; BIWEEKLY/MONTHLY fire weekly/monthly but only proceed once enough days have elapsed (jitter-tolerant
 * floors). MANUAL never runs from the trigger. A broken config errs toward running — never silently skip a reset.
 */
function resetDue_() {
  try {
    const sc = cfg_().kv.SCHEDULE;
    // OFF is authoritative regardless of cadence (matches installExtras + the [SCHEDULE] contract). Enforced HERE at
    // run time too, so setting WEEKLY_HOURS_RESET=OFF via Settings takes effect immediately even if the operator
    // didn't re-run Install Extras Triggers — the live CONFIG bridge makes that the expected behavior everywhere else.
    if (sc.WEEKLY_HOURS_RESET === 'OFF') return false;
    const cad = sc.RESET_CADENCE;
    if (cad === 'MANUAL') return false;
    if (cad === 'WEEKLY') return true;
    const last = Number(PropertiesService.getScriptProperties().getProperty(LAST_RESET_PROP) || 0);
    if (!last) return true; // never reset before → run now
    const days = (Date.now() - last) / 86400000;
    if (cad === 'BIWEEKLY') return days >= 13; // ~2 weeks (13-day floor absorbs weekly-trigger jitter)
    if (cad === 'MONTHLY') return days >= 25;  // ~1 month (25-day floor guards against a double-fire)
    return true;
  } catch (e) { return true; }
}

/* ======================================================================
 * LEAVE COVERAGE VIEW
 * ====================================================================== */

/** Menu/trigger: refresh the Leave Coverage tab from the tracker. */
function buildCoverage() {
  runAction_('Rebuild Leave Coverage', () => {
    const ss = SpreadsheetApp.getActive();
    const tracker = getSheetOrWarn_(ss, CONFIG.sheets.tracker);
    if (!tracker) return;
    const leaves = activeLeaves_(tracker).sort((a, b) => a.start - b.start);
    const sh = ss.getSheetByName(EXTRAS.coverageSheet) || ss.insertSheet(EXTRAS.coverageSheet);
    sh.clearContents();
    sh.getRange(1, 1, 1, 5).setValues([['Name', 'Type', 'Start', 'End', 'Status']]).setFontWeight('bold');
    const rows = leaves.map((l) => [l.name, l.type, fmtDate_(l.start), fmtDate_(l.end), l.started ? 'OUT NOW' : 'upcoming']);
    if (rows.length) sh.getRange(2, 1, rows.length, 5).setValues(rows);
    const outNow = leaves.filter((l) => l.started).length;
    sh.getRange(rows.length + 3, 1).setValue(`${outNow} member(s) currently out (${leaves.length} active/upcoming).`);
    logInfo_('buildCoverage', `${leaves.length} active/upcoming leaves.`);
    try { // manual run only — the 6am trigger has no UI
      SpreadsheetApp.getUi().alert(`🗓️ Leave Coverage rebuilt — ${outNow} out now, ${leaves.length} active/upcoming.\n\nSee the "${EXTRAS.coverageSheet}" tab.`);
    } catch (e) { /* no UI in a time-driven run */ }
  });
}

/* ======================================================================
 * INTEGRITY SCAN
 * ====================================================================== */

/** Menu/trigger: run the integrity checks, log them, and post if any issues. */
function scanIntegrity() {
  runAction_('Integrity Scan', () => {
    const issues = scanIntegrityCore_();
    try {
      SpreadsheetApp.getUi().alert(issues.length
        ? `🔍 ${issues.length} integrity issue(s) found:\n\n${issues.slice(0, 12).join('\n')}` +
          (issues.length > 12 ? `\n…and ${issues.length - 12} more` : '') +
          `\n\n(Full history on the "${EXTRAS.integritySheet}" tab.)`
        : '✅ No integrity issues found — the roster and tracker look clean.');
    } catch (e) { /* no UI in a time-driven run */ }
  });
}

/** Run the integrity checks, log them to the Integrity Log, and post a Discord summary. @return {Array<string>} issues. Shared by the menu scan, the daily trigger, and Refresh & Update All. */
function scanIntegrityCore_() {
  const issues = runIntegritySummary_();
  const ss = SpreadsheetApp.getActive();
  const log = ss.getSheetByName(EXTRAS.integritySheet) || ss.insertSheet(EXTRAS.integritySheet);
  if (log.getLastRow() === 0) log.appendRow(['Time', '# Issues', 'Detail']);
  log.appendRow([new Date(), issues.length, issues.join(' | ')]);
  const cap = logRowCap_(), last = log.getLastRow(); if (last > cap) log.deleteRows(2, last - cap); // bound growth (v2.5.0: config cap)
  if (issues.length) postSummary_(`🔍 Integrity Scan — ${issues.length} issue(s)`, issues.slice(0, 12).join('\n'), 15548997);
  logInfo_('scanIntegrity', `${issues.length} issue(s) found.`);
  return issues;
}

/** Read-only integrity checks. Returns an array of human-readable issue strings. */
function runIntegritySummary_() {
  const ss = SpreadsheetApp.getActive();
  const roster = getSheetOrWarn_(ss, CONFIG.sheets.roster);
  if (!roster) return ['Roster tab missing'];
  const tracker = ss.getSheetByName(CONFIG.sheets.tracker);
  const issues = [];
  const members = readMembers_(roster);
  const seen = {};
  const idToName = {};

  members.forEach((m) => {
    if (m.id !== '') {
      idToName[m.id] = m.name;
      if (!/^\d{17,19}$/.test(m.id)) issues.push(`Malformed Discord ID: ${m.name}`);
      (seen[m.id] = seen[m.id] || []).push(m.name);
    }
    if (!isProtectedStatus_(m.activity) && m.activity !== '') {
      const expected = computeStatus_(m.rank, parseHours_(m.hours));
      if (m.activity !== expected) issues.push(`${m.name}: status "${m.activity}" but hours imply "${expected}"`);
    }
  });
  Object.keys(seen).forEach((k) => {
    if (seen[k].length > 1) issues.push(`Duplicate ID ${k} → ${seen[k].join(', ')}`);
  });

  if (tracker) {
    activeLeaves_(tracker).forEach((l) => {
      if (!l.id) return;
      if (!idToName[l.id]) {
        issues.push(`Leave with no roster member: ${l.name || l.id}`);
      } else if (String(idToName[l.id]).trim() !== String(l.name).trim()) {
        issues.push(`Mis-target: tracker says "${l.name}" but that ID belongs to roster member "${idToName[l.id]}"`);
      }
    });
  }
  return issues;
}

/* ======================================================================
 * AUDIT LOG (installable onEdit → recordEdit)
 * ====================================================================== */

/** Logs who edited what, when. Point an INSTALLABLE onEdit trigger at this. */
function recordEdit(e) {
  try {
    if (!e?.range) return;
    const sheetName = e.range.getSheet().getName();
    const systemSheets = [EXTRAS.historySheet, EXTRAS.coverageSheet, EXTRAS.integritySheet, EXTRAS.auditSheet];
    if (systemSheets.indexOf(sheetName) !== -1) return; // don't audit the script's own tabs

    const ss = SpreadsheetApp.getActive();
    let log = ss.getSheetByName(EXTRAS.auditSheet);
    if (!log) {
      log = ss.insertSheet(EXTRAS.auditSheet);
      log.appendRow(['Time', 'Editor', 'Sheet', 'Cell', 'Old', 'New']);
    }
    let email = '';
    try { email = Session.getActiveUser().getEmail() || ''; } catch (x) { /* cross-domain: not available */ }

    const multi = e.range.getNumRows() * e.range.getNumColumns() > 1;
    const oldV = multi ? '(multi-cell — not captured)' : (e.oldValue === undefined ? '' : e.oldValue);
    const newV = multi ? '(multi-cell — see range)' : (e.value === undefined ? '' : e.value);
    log.appendRow([new Date(), email || 'unknown', sheetName, e.range.getA1Notation(), oldV, newV]);
    const cap = logRowCap_(), last = log.getLastRow(); if (last > cap) log.deleteRows(2, last - cap); // prune oldest, keep header (v2.5.0: config cap)
  } catch (err) {
    log_('recordEdit', err);
  }
}

/* ======================================================================
 * DEMO / PREVIEW DATA (v2.5.0) — seedDemoRoster()
 * Fills the MEMBER-INFORMATION columns of the rows you already set up, so a
 * fresh copy looks like a community that is actually running it. The operator
 * lays out their own ranks, section dividers and callsigns; this only writes
 * NAME, DISCORD ID, JOIN / LAST-PROMOTION dates, HOURS, and CURRENT / LAST
 * ACTIVITY — resolved BY HEADER (rosterCols_) — plus a realistic status mix
 * (~60% Active / Semi / Inactive / LOA / ROA — no "Reserve"), matching leave
 * records on the tracker, and 4 weeks of activity-check history.
 *   • RANK (col B) and CALLSIGN (col D) are NEVER touched — the operator owns them.
 *   • Section-divider rows (merged bands between the member runs) are skipped:
 *     writes happen per contiguous run of member rows, so a merged cell is never hit.
 *   • Member rows are detected by a present callsign OR a real (non-divider) rank.
 *   • Some slots are left BLANK as open positions (denser toward the lower ranks;
 *     leadership always staffed) so the roster looks like a real, hiring department.
 *   • The stats/dashboard tab is populated too (seedDemoStats_): the TOTAL EMPLOYEES
 *     breakdown (Supervisors/Troopers/Auxiliary/Total, computed from the filled
 *     members) and the leadership box — both position-found and guarded.
 *   • The RECENT PROMOTIONS feed is seeded too (seedDemoPromotions_): a spread of members "promoted" to the
 *     rank they now hold over the last ~2 months, so the Welcome-page table demos full.
 *   • Guarded: confirms before overwriting rows that already hold a name.
 * Seeded hours sit inside each status's tier band (Active ≥ MinHours, etc.), so a
 * later "Update All Statuses" is a no-op; LOA/ROA are backed by an active tracker
 * leave so they survive recompute.
 * ====================================================================== */

/** Deterministic, precision-safe 18-digit demo Discord ID. */
function demoId_(i) { return '77000000000000' + ('0000' + (100 + i)).slice(-4); }

/** Midnight Date `d` days from today (sheet TZ). */
function demoDay_(d) { const t = todayInSheetTz_(); t.setDate(t.getDate() + d); return t; }

/** The Sunday on/before today, `k` weeks earlier, at midnight. */
function demoSunday_(k) { const t = todayInSheetTz_(); t.setDate(t.getDate() - t.getDay() - 7 * k); return t; }

/** Deterministic pseudo-random in [0,1) for slot `i` (salted) — organic-looking demo numbers that reseed identically. */
function demoRand_(i, salt) {
  let h = (i * 374761393 + salt * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Round to the nearest quarter hour — demo hours read as log-derived (12.75), not synthetic (12). */
function demoQuarter_(x) { return Math.round(x * 4) / 4; }

/** A believable 4-week hours series that ENDS at the member's current hours. */
function demoHours_(cur) {
  const c = Number(cur) || 0;
  if (c >= 10) return [Math.max(0, c - 6), Math.max(0, c - 4), Math.max(0, c - 1), c]; // building up
  if (c < 5) return [c + 5, c + 3, c + 1, c];                                          // declining
  return [Math.max(0, c - 2), c + 1, Math.max(0, c - 1), c];                           // steady wobble
}

/** A distinct, believable full name for slot `i`. 17×16 diagonal walk → unique for any i < 272 (gcd(17,16)=1). */
function demoName_(i) {
  const F = ['James', 'Maria', 'David', 'Aisha', 'Liam', 'Sofia', 'Noah', 'Priya', 'Ethan', 'Chen', 'Diego', 'Fatima', 'Marcus', 'Elena', 'Kwame', 'Hana', 'Owen'];
  const L = ['Bennett', 'Alvarez', 'Okafor', 'Nguyen', 'Kowalski', 'Rossi', 'Haddad', 'Sato', 'Delgado', 'Petrov', 'Osei', 'Lindqvist', 'Reyes', 'Kaur', 'Fischer', 'Moreau'];
  return F[i % F.length] + ' ' + L[i % L.length];
}

/**
 * Build a believable demo member for member-slot index `i` (0-based), given the rank already in the row.
 * Deterministic (salted hash, no RNG — reseeding the same layout reproduces the same demo).
 * Hours land inside the intended status's tier band so recompute is a no-op;
 * LOA/ROA carry an active leave; a few active members carry a recently-expired leave for history variety.
 */
function demoPerson_(i, rank, total) {
  // ≈ 60% Active / 15% Semi-Active / 15% Inactive / 5% LOA / 5% ROA, spread by a coprime stride. (No "Reserve" — the operator asked to keep it off the activity mix.)
  const DIST = ['Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Semi-Active', 'Semi-Active', 'Semi-Active', 'Inactive', 'Inactive', 'Inactive', 'LOA', 'ROA'];
  const act = DIST[(i * 7) % DIST.length];
  let hours, last = act, leave = null, pastLeave = null, checks = null;
  const r = demoRand_(i, 1), r2 = demoRand_(i, 2);
  if (act === 'Active') hours = demoQuarter_(10 + r * r * 15 + (r2 > 0.93 ? 6 : 0)); // 10–25, right-skewed; rare ~30h grinder (tier: ≥ 10)
  else if (act === 'Semi-Active') hours = demoQuarter_(5 + r * 4.7);                 // 5–9.75  (tier: ≥ 5, < 10)
  else if (act === 'Inactive') hours = demoQuarter_(r * r * 4.7);                    // 0–4.75, clustered low (tier: < 5)
  else if (act === 'LOA') { hours = 0; last = 'Active'; leave = { type: 'LOA', from: -(2 + i % 6), to: 5 + (i % 10), status: 'Approved' }; checks = ['Active', 'Active', 'LOA', 'LOA']; }
  else { hours = demoQuarter_(5 + r * 3.7); last = 'Inactive'; leave = { type: 'ROA', from: -(2 + i % 5), to: 6 + (i % 9), status: 'Approved' }; checks = ['Inactive', 'ROA', 'ROA', 'ROA']; } // ROA
  // Sprinkle a few recently-EXPIRED leaves onto active members (tracker + activity-check variety).
  if (!leave && i % 17 === 5) { pastLeave = { type: (i % 2 ? 'LOA' : 'ROA'), from: -(48 + i % 10), to: -(30 + i % 8) }; checks = [pastLeave.type, pastLeave.type, 'Active', act]; }
  const tenure = 1600 - Math.round((i / Math.max(total, 1)) * 1200); // seniority: earlier rows = longer tenure
  const shift = ['Day', 'Swings', 'Nights'][Math.floor(demoRand_(i, 8) * 3)];
  const may = demoQuarter_(demoRand_(i, 3) * demoRand_(i, 6) * 30); // prior-month totals — right-skewed 0–30h
  const jun = demoQuarter_(demoRand_(i, 4) * demoRand_(i, 7) * 30);
  return {
    name: demoName_(i), id: demoId_(i), shift: shift, may: may, jun: jun,
    join: demoDay_(-tenure), promo: demoDay_(-(20 + (i % 10) * 16)),
    hours: hours, act: act, last: last, leave: leave, pastLeave: pastLeave,
    checks: checks || [act, act, act, act],
  };
}

/** Should member-slot `i` be left OPEN (blank)? Leadership (first 4) is always staffed; openings get denser toward the lower ranks. Deterministic. */
function demoIsOpen_(i, total) {
  if (i < 4) return false;
  const chance = Math.min(65, 8 + Math.floor((i / Math.max(total, 1)) * 55)); // ~9% near the top → ~62% near the bottom
  return ((i * 41 + 17) % 100) < chance;
}

/** A blank "open position" — the row keeps the operator's rank + callsign but carries no member data. */
function demoBlank_() { return { open: true, name: '', id: '', shift: '', may: '', jun: '', join: '', promo: '', hours: '', act: '', last: '', leave: null, pastLeave: null, checks: null }; }

/** Classify a member into a stats group by their section label (rank as fallback). Supervisors = command/staff tiers, Auxiliary = reserve, else Troopers. */
function demoGroupOf_(section, rank) {
  const S = String(section || '').toUpperCase();
  if (S) {
    if (/RESERVE|AUXILIAR/.test(S)) return 'auxiliary';
    if (/COMMAND|ADMIN|SUPERVISOR/.test(S) || (/STAFF/.test(S) && !/TRAINING/.test(S))) return 'supervisors';
    return 'troopers';
  }
  const R = String(rank || '').toUpperCase(); // no section header → fall back to the rank name
  if (/RESERVE|AUXILIAR/.test(R)) return 'auxiliary';
  if (/CHIEF|COMMANDER|CAPTAIN|LIEUTENANT|COLONEL|MAJOR|SERGEANT/.test(R)) return 'supervisors';
  return 'troopers';
}

/** "James Bennett" → "James B." (first name + last initial — the OOC-name style). */
function demoOocName_(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.length < 2 ? String(name || '') : parts[0] + ' ' + parts[parts.length - 1].charAt(0) + '.';
}

/** "James Bennett" → "J. Bennett" (leadership-box style). */
function demoInitialName_(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.length < 2 ? String(name || '') : parts[0].charAt(0) + '. ' + parts.slice(1).join(' ');
}

/** Write one demo leave at tracker row `r` (mirrors the real append: dedup key + countdown formulas; keeps the tracker template). */
function demoWriteLeave_(tracker, m, L, r) {
  const start = demoDay_(L.from), end = demoDay_(L.to);
  const key = makeLeaveKey_(m.id, `${startOfDay_(start).getTime()}-${startOfDay_(end).getTime()}-${norm_(L.type)}`);
  tracker.getRange(r, CONFIG.tracker.discord).setNumberFormat('@'); // keep the 17-19 digit ID exact
  tracker.getRange(r, 1, 1, 13).setValues([[key, m.rank, m.name, '', m.id, L.type, start, end, '', '', '', L.status || 'Approved', '']]);
  tracker.getRange(r, CONFIG.tracker.start, 1, 2).setNumberFormat('d mmm. yyyy');
  tracker.getRange(r, 9).setFormula(`=LET(d, INT(H${r})-INT(G${r}), d & IF(d=1, " Day", " Days"))`);
  tracker.getRange(r, 10).setFormula(`=IF(INT(G${r})>TODAY(), LET(d, INT(G${r})-TODAY(), d & IF(d=1, " Day", " Days")), "Started")`);
  tracker.getRange(r, 11).setFormula(`=IF(INT(G${r})>TODAY(), "Pending Start", IF(INT(H${r})<=TODAY(), "Expired", LET(d, INT(H${r})-TODAY(), d & IF(d=1, " Day", " Days"))))`);
}

/** Menu / command: fill the member-info columns of the rows the operator already set up (see the header note). */
function seedDemoRoster() {
  runAction_('Load Demo Roster', () => {
    const ui = SpreadsheetApp.getUi();
    const ss = SpreadsheetApp.getActive();
    const roster = getSheetOrWarn_(ss, CONFIG.sheets.roster);
    if (!roster) return;
    const RC = rosterCols_(roster);           // header-resolved — respects THIS sheet's layout (CALLSIGN, HOURS/ACTIVITY order)
    const laCol = lastActivityCol_(roster);   // -1 when the sheet has no LAST ACTIVITY column
    const start = CONFIG.rosterStartRow;
    const lastRow = roster.getLastRow();
    if (lastRow < start) { ui.alert('🎬 Load Demo Roster', 'This roster has no member rows yet. Add your ranks and callsigns first, then run this again.', ui.ButtonSet.OK); return; }

    // ---- Identify the member rows (rank + callsign are the OPERATOR's; we only read them) ----
    const n = lastRow - start + 1;
    const ranks = roster.getRange(start, RC.rank, n, 1).getDisplayValues();     // rank label OR (on a legacy divider) a section title
    const calls = roster.getRange(start, RC.unit, n, 1).getDisplayValues();     // callsign; blank on divider rows
    const names0 = roster.getRange(start, RC.name, n, 1).getDisplayValues();    // existing names (overwrite guard)
    const bandCol = RC.rank > 1 ? RC.rank - 1 : 0;                              // the merged RANK GROUP column sits just left of RANK
    const bands = bandCol ? roster.getRange(start, bandCol, n, 1).getDisplayValues() : null;
    const memberRows = [];                                                      // { r, rank, section } for every real member row
    let currentSection = '';
    for (let i = 0; i < n; i++) {
      const rank = String(ranks[i][0] || '').trim();
      const call = String(calls[i][0] || '').trim();
      const band = bands ? String(bands[i][0] || '').trim() : '';               // merged label only in the band's top row → forward-fill
      if (band) currentSection = band;                                          // RANK GROUP band label tags the rows beneath it
      if (call || (rank && isMemberSlot_(rank))) memberRows.push({ r: start + i, rank: rank || 'Member', section: currentSection }); // member row
      else if (rank && !isMemberSlot_(rank)) currentSection = rank;             // legacy: ALL-CAPS section-divider label in the rank column
    }
    if (!memberRows.length) { ui.alert('🎬 Load Demo Roster', 'No member rows found — make sure your rows have ranks and/or callsigns filled in.', ui.ButtonSet.OK); return; }

    const already = memberRows.filter((m) => String(names0[m.r - start][0] || '').trim()).length;
    if (already > 0 && ui.alert('🎬 Load Demo Roster',
      `${already} of ${memberRows.length} member rows already have a name. Loading demo data OVERWRITES the name and activity columns — your RANKS, CALLSIGNS, banner, headers, colours and dropdowns are KEPT.\n\nContinue?`,
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

    // ---- Build a believable person for each member row (some slots stay blank = open positions) ----
    const total = memberRows.length;
    const people = memberRows.map((m, i) => demoIsOpen_(i, total) ? demoBlank_() : demoPerson_(i, m.rank, total));
    const filledCount = people.filter((p) => !p.open).length;

    // Group member rows into CONTIGUOUS runs — the merged section-divider rows fall BETWEEN runs and are never written.
    const runs = [];
    memberRows.forEach((m, i) => {
      const prev = runs.length ? runs[runs.length - 1] : null;
      if (prev && m.r === prev.endRow + 1) { prev.endRow = m.r; prev.end = i; }
      else runs.push({ startRow: m.r, endRow: m.r, begin: i, end: i });
    });

    // ---- ROSTER: write ONLY the member-info columns (C, E, F, G, H, I, J) — never RANK (B) or CALLSIGN (D) ----
    roster.getRange(start, RC.discord, n, 1).setNumberFormat('@'); // keep 17-19 digit IDs exact before writing (col E is never merged)
    runs.forEach((run) => {
      const len = run.endRow - run.startRow + 1;
      const s = people.slice(run.begin, run.end + 1);
      roster.getRange(run.startRow, RC.name, len, 1).setValues(s.map((p) => [p.name]));
      roster.getRange(run.startRow, RC.discord, len, 1).setValues(s.map((p) => [p.id]));
      roster.getRange(run.startRow, RC.join, len, 1).setValues(s.map((p) => [p.join])).setNumberFormat('d mmm yyyy');
      roster.getRange(run.startRow, RC.promo, len, 1).setValues(s.map((p) => [p.promo])).setNumberFormat('d mmm yyyy');
      roster.getRange(run.startRow, RC.hours, len, 1).setValues(s.map((p) => [p.hours]));
      roster.getRange(run.startRow, RC.activity, len, 1).setValues(s.map((p) => [p.act]));
      if (laCol > 0) roster.getRange(run.startRow, laCol, len, 1).setValues(s.map((p) => [p.last]));
      // Optional display columns — filled only when the sheet has them (RC.* is 0 when absent).
      if (RC.ooc) roster.getRange(run.startRow, RC.ooc, len, 1).setValues(s.map((p) => [p.name ? demoOocName_(p.name) : '']));
      if (RC.shift) roster.getRange(run.startRow, RC.shift, len, 1).setValues(s.map((p) => [p.shift]));
      if (RC.mayHours) roster.getRange(run.startRow, RC.mayHours, len, 1).setValues(s.map((p) => [p.may]));
      if (RC.junHours) roster.getRange(run.startRow, RC.junHours, len, 1).setValues(s.map((p) => [p.jun]));
      if (RC.timeInRank && RC.promo) { // live "days since last promotion" — recalculates daily
        const pc = (typeof cpColLetter_ === 'function') ? cpColLetter_(RC.promo) : String.fromCharCode(64 + RC.promo);
        roster.getRange(run.startRow, RC.timeInRank, len, 1)
          .setFormulas(s.map((p, k) => [`=IF(${pc}${run.startRow + k}="","",TODAY()-INT(${pc}${run.startRow + k}))`]))
          .setNumberFormat('0" days"');
      }
    });

    // ---- TRACKER (in place: clear old data rows, keep header / formatting) ----
    let leaveCount = 0;
    const tracker = ss.getSheetByName(CONFIG.sheets.tracker);
    if (tracker) {
      const ts = CONFIG.trackerStartRow;
      if (tracker.getLastRow() >= ts) tracker.getRange(ts, 1, tracker.getLastRow() - ts + 1, Math.max(tracker.getLastColumn(), 13)).clearContent();
      const leaves = [];
      memberRows.forEach((m, i) => {
        const p = people[i];
        if (p.leave) leaves.push({ m: { id: p.id, rank: m.rank, name: p.name }, L: p.leave });
        if (p.pastLeave) leaves.push({ m: { id: p.id, rank: m.rank, name: p.name }, L: { type: p.pastLeave.type, from: p.pastLeave.from, to: p.pastLeave.to, status: 'Expired' } });
      });
      if (leaves.length && tracker.getMaxRows() < ts + leaves.length - 1) tracker.insertRowsAfter(tracker.getMaxRows(), ts + leaves.length - 1 - tracker.getMaxRows());
      leaves.forEach((x, i) => demoWriteLeave_(tracker, x.m, x.L, ts + i));
      leaveCount = leaves.length;
    }

    // ---- HOURS HISTORY (hidden engine tab: 4 fortnightly activity checks per member) ----
    const hist = ss.getSheetByName(CONFIG.sheets.hoursHistory) || ss.insertSheet(CONFIG.sheets.hoursHistory);
    hist.clear();
    hist.getRange(1, 1, 1, 6).setValues([['WeekOf', 'DiscordID', 'Name', 'Rank', 'Hours', 'Status']]);
    const hrows = [];
    memberRows.forEach((m, i) => {
      const p = people[i];
      if (p.open) return; // open positions carry no history
      const hs = demoHours_(p.hours);
      for (let k = 0; k < 4; k++) hrows.push([demoSunday_((3 - k) * 2), p.id, p.name, m.rank, hs[k], p.checks[k] || p.act]); // *2 = fortnightly cadence
    });
    if (hrows.length) {
      hist.getRange(2, 2, hrows.length, 1).setNumberFormat('@');
      hist.getRange(2, 1, hrows.length, 6).setValues(hrows);
      hist.getRange(2, 1, hrows.length, 1).setNumberFormat('d mmm yyyy');
    }
    try { hist.hideSheet(); } catch (e) { /* already hidden */ }

    // ---- STATS SHEET: employee-count breakdown + leadership box, computed from the FILLED members ----
    const groups = { supervisors: 0, troopers: 0, auxiliary: 0 };
    memberRows.forEach((m, i) => { if (!people[i].open) groups[demoGroupOf_(m.section, m.rank)]++; });
    groups.total = groups.supervisors + groups.troopers + groups.auxiliary;
    const leaders = [];
    for (let i = 0; i < memberRows.length && leaders.length < 4; i++) {
      if (people[i].open) continue;
      const m = memberRows[i];
      leaders.push({ rank: m.rank, callsign: String(calls[m.r - start][0] || '').trim(), name: people[i].name });
    }
    let statsFilled = false;
    try { statsFilled = seedDemoStats_(ss, groups, leaders); } catch (e) { log_('seedDemoRoster.stats', e); }

    // ---- RECENT PROMOTIONS feed: a believable rolling history so the Welcome-page table demos full ----
    let promoCount = 0;
    try { promoCount = seedDemoPromotions_(memberRows, people); } catch (e) { log_('seedDemoRoster.promotions', e); }

    try { refreshDashboard_(); } catch (e) { log_('seedDemoRoster.dashboard', e); }
    try { if (typeof cpInvalidateHealth_ === 'function') cpInvalidateHealth_(); } catch (e) { /* Trust.gs may be absent */ }
    logInfo_('seedDemoRoster', `demo filled ${filledCount}/${total} member rows (${total - filledCount} open); ${leaveCount} leave record(s); ${promoCount} promotion(s); stats ${statsFilled ? 'populated' : 'not found'}.`);
    ui.alert('🎬 Demo Roster Loaded',
      `Filled ${filledCount} of ${total} member rows with names, Discord IDs, join/promotion dates, hours and activity status (${leaveCount} on active or recently-expired leave) — the other ${total - filledCount} are left as open positions. Added 4 weeks of activity-check history${statsFilled ? ', and populated the stats sheet (employee counts + leadership)' : ''}${promoCount ? `, and seeded ${promoCount} recent promotions` : ''}.\n\nYour ranks, callsigns, section dividers, colours and dropdowns were left untouched. Open 🎛️ Control Panel and click a member to see their recent activity checks.`,
      ui.ButtonSet.OK);
  });
}

/**
 * Seed the RECENT PROMOTIONS feed (Document Properties) from the freshly-filled demo members: up to PROMO_MAX_
 * entries, each "promoting" a member to the rank they now hold, newest a couple of days ago and spreading back
 * ~2 months with 1–6 day gaps. Deterministic (demoRand_). Open slots, members on leave, and the very top command
 * are skipped — a Chief promoted last Tuesday reads wrong. @return {number} entries seeded (0 without the engine file).
 */
function seedDemoPromotions_(memberRows, people) {
  if (typeof promoRecord_ !== 'function') return 0; // RosterSystem.gs owns the feed
  const cands = [];
  memberRows.forEach((m, i) => {
    const p = people[i];
    if (p.open || p.leave || i < 2) return;
    cands.push({ n: p.name, r: m.rank, i: i });
  });
  if (!cands.length) return 0;
  cands.sort((a, b) => demoRand_(a.i, 5) - demoRand_(b.i, 5)); // deterministic shuffle — promotions shouldn't run in roster order
  const picks = cands.slice(0, PROMO_MAX_);
  let day = 1 + Math.round(demoRand_(0, 3) * 3); // newest entry 1–4 days ago
  const list = picks.map((c, k) => {
    const entry = { t: demoDay_(-day).getTime(), n: c.n, r: c.r };
    day += 1 + Math.round(demoRand_(k, 4) * 5); // 1–6 day gaps walking back in time
    return entry;
  });
  PropertiesService.getDocumentProperties().setProperty(PROMO_STORE_PROP_, JSON.stringify(list));
  renderPromotions_();
  return list.length;
}

/**
 * Fill the stats/dashboard tab's visual boxes from the demo numbers: the TOTAL EMPLOYEES breakdown
 * (Supervisors / Troopers / Auxiliary / Total) and, when a leadership box is present, the top command.
 * Position-found and heavily guarded — a tab without these boxes is skipped, never errors. TOTAL HOURS /
 * CURRENT LOAS-ROAS stay owned by the engine's own dashboard renderer.
 * @return {boolean} whether any box was filled on any tab.
 */
function seedDemoStats_(ss, groups, leaders) {
  let any = false;
  ss.getSheets().forEach((sh) => {
    const name = sh.getName();
    if (dashboardSkip_(name) || name === CONFIG.sheets.roster || name === CONFIG.sheets.tracker) return; // only KPI/stat tabs
    try { if (fillEmployeeBox_(sh, groups) || fillExecBox_(sh, leaders)) any = true; } catch (e) { log_('seedDemoStats_.sheet', e); }
  });
  return any;
}

/** Scan the top `searchRows` rows for a cell whose text equals `want` (case-insensitive). @return {{row,col}|null} 1-based. */
function findLabelCell_(sheet, want, searchRows) {
  const lastRow = Math.min(sheet.getLastRow(), searchRows || 60);
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return null;
  const grid = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const W = String(want).trim().toUpperCase();
  for (let r = 0; r < lastRow; r++) for (let c = 0; c < lastCol; c++) {
    if (String(grid[r][c]).trim().toUpperCase() === W) return { row: r + 1, col: c + 1 };
  }
  return null;
}

/** Write SUPERVISORS/TROOPERS/AUXILIARY/TOTAL labels + counts into the 4 rows below a "TOTAL EMPLOYEES" header. @return {boolean} */
function fillEmployeeBox_(sheet, groups) {
  const hit = findLabelCell_(sheet, 'TOTAL EMPLOYEES', 40);
  if (!hit) return false;
  const merges = sheet.getRange(hit.row, hit.col).getMergedRanges();
  let leftCol = hit.col, rightCol = hit.col;
  if (merges.length) { leftCol = merges[0].getColumn(); rightCol = merges[0].getLastColumn(); }
  if (rightCol <= leftCol) rightCol = leftCol + 1;                              // need a value column to the right of the label
  const rows = [['SUPERVISORS', groups.supervisors], ['TROOPERS', groups.troopers], ['AUXILIARY', groups.auxiliary], ['TOTAL', groups.total]];
  let wrote = 0;
  rows.forEach((rw, k) => {
    const r = hit.row + 1 + k;
    if (r > sheet.getMaxRows()) return;
    sheet.getRange(r, leftCol).setValue(rw[0]).clearNote();                     // label (top-left of any E:F-style merge on the row)
    // clearNote keeps this count OUT of the engine's KPI-adoption path (else a re-run would overwrite it with the
    // engine's own group count — 0 for sections the operator hasn't mapped to [DASHBOARD_GROUPS]).
    sheet.getRange(r, rightCol).setValue(rw[1]).clearNote();                    // count
    wrote++;
  });
  return wrote > 0;
}

/** Fill the leadership box (rank | callsign | name per row) below its wide header — found as the widest 1-row merge above the first KPI. @return {boolean} */
function fillExecBox_(sheet, leaders) {
  if (!leaders || !leaders.length) return false;
  const kpi = findLabelCell_(sheet, 'TOTAL HOURS', 30) || findLabelCell_(sheet, 'TOTAL EMPLOYEES', 30) || findLabelCell_(sheet, 'CURRENT LOAS/ROAS', 30);
  const limit = kpi ? kpi.row - 1 : Math.min(sheet.getLastRow(), 12);
  if (limit < 4) return false;
  let header = null; // widest single-row horizontal merge in rows 4..limit = the leadership box header
  sheet.getRange(1, 1, Math.min(limit, sheet.getMaxRows()), sheet.getLastColumn()).getMergedRanges().forEach((mr) => {
    if (mr.getNumRows() === 1 && mr.getNumColumns() >= 4 && mr.getRow() >= 4 && mr.getRow() <= limit &&
        (!header || mr.getNumColumns() > header.width)) header = { row: mr.getRow(), left: mr.getColumn(), right: mr.getLastColumn(), width: mr.getNumColumns() };
  });
  if (!header) return false;
  if (String(sheet.getRange(header.row, header.left).getDisplayValue()).trim() === '') sheet.getRange(header.row, header.left).setValue('EXECUTIVE COMMAND');
  let wrote = 0;
  for (let k = 0; k < leaders.length; k++) {
    const r = header.row + 1 + k;
    if (r > sheet.getMaxRows()) break;
    const inner = sheet.getRange(r, header.left, 1, header.right - header.left + 1).getMergedRanges()
      .filter((mr) => mr.getNumColumns() > 1).sort((a, b) => a.getColumn() - b.getColumn());
    if (inner.length < 2) break;                                               // a row without the callsign+name sub-merges = box ended
    const L = leaders[k];
    sheet.getRange(r, header.left).setValue(L.rank);                           // rank in the box's left column
    sheet.getRange(r, inner[0].getColumn()).setValue(L.callsign);             // callsign in the first inner merge
    sheet.getRange(r, inner[1].getColumn()).setValue(demoInitialName_(L.name)); // name in the second
    wrote++;
  }
  return wrote > 0;
}
