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
 *   3. Extras menu items are added by the core buildMenus_() — no extra call needed.
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
 * Extras settings. v1.0 — the tab names now resolve LIVE from [SHEETS] on ⚙️ Config (getters, so every existing
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
  // v1.0 — cadence-aware reset trigger. MANUAL (or WEEKLY_HOURS_RESET=OFF) installs no trigger. MONTHLY fires on
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
  const TC = trackerCols_(tracker);
  const v = tracker.getRange(CONFIG.trackerStartRow, 2, n, TC.width - 1).getValues(); // cols B..(width)
  const ids = tracker.getRange(CONFIG.trackerStartRow, TC.discord, n, 1).getDisplayValues(); // IDs EXACT — getValues rounds a 17-19 digit ID
  const today = todayInSheetTz_();
  for (let i = 0; i < n; i++) {
    if (v[i][TC.status - 2] !== CONFIG.approvedStatus) continue;
    const start = startOfDay_(new Date(v[i][TC.start - 2]));
    const end = startOfDay_(new Date(v[i][TC.end - 2]));
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || today.getTime() > end.getTime()) continue;
    out.push({
      name: v[i][TC.name - 2],
      type: trackerLeaveType_(),
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
  // Replace this week's rows (don't duplicate) if the snapshot is re-run within the same week. A week's rows were
  // appended as one contiguous block, so remove them in RUNS — one deleteRows per block instead of one deleteRow
  // per member (a same-week re-run on a big roster paid hundreds of sequential calls inside the reset's lock).
  if (sh.getLastRow() >= 2) {
    const weeks = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
    const wk = String(when).trim();
    let r = weeks.length - 1;
    while (r >= 0) {
      if (String(weeks[r][0]).trim() !== wk) { r--; continue; }
      let top = r;
      while (top - 1 >= 0 && String(weeks[top - 1][0]).trim() === wk) top--;
      sh.deleteRows(top + 2, r - top + 1);
      r = top - 1;
    }
  }
  const rows = members.map((m) => [when, m.id, m.name, m.rank, parseHours_(m.hours), m.activity]);
  const startRow = sh.getLastRow() + 1;
  sh.getRange(startRow, 2, rows.length, 1).setNumberFormat('@'); // keep IDs exact
  sh.getRange(startRow, 1, rows.length, 6).setValues(rows);
  // F-024: cap growth like the sibling Integrity/Edit logs — trim the oldest rows so the sheet can't grow unbounded.
  const CAP = logRowCap_(); // v1.0: configurable
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
    if (CONFIG.notify && CONFIG.notify.weeklyDigest) { // v1.0 richer opt-in digest supersedes the basic reset notice
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
    try { PropertiesService.getScriptProperties().setProperty(LAST_RESET_PROP, String(Date.now())); } catch (e) { /* best-effort cadence marker */ } // v1.0: advance the cadence clock (manual + scheduled both count)
    return { captured: captured, shifted: shifted, total: after.length, droppedNames: dropped.map((m) => m.name), lowestTier: lowestTier, totalHours: totalHours };
  } finally {
    lock.releaseLock();
  }
}

/** Menu action: confirm, then reset with history. */
function weeklyResetWithHistory() {
  runAction_('Capture & Reset Activity', () => {
    const ui = SpreadsheetApp.getUi();
    const label = periodLabel_(); // the auto-detected period this capture will be logged under — shown so it can be verified
    const resp = ui.alert('📸 Capture & Reset Activity',
      `Capture the current period as “${label}”, roll the period columns forward, save a history snapshot, then zero HOURS and recompute statuses?\n\nLOA/ROA/Reserve stay protected.`,
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
 * v1.0 — is the hours reset due now, given [SCHEDULE].RESET_CADENCE and the LAST_RESET marker? WEEKLY fires every
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
 * GROUP / DIVISION SHEETS — a live, rank-ordered view of one category (shift,
 * district, troop, …) on its own tab. Make a tab, drop a marker like
 * "#group: Shift = Day" in the top-left cell, then Build / Refresh Group
 * Sheets: the engine writes a FILTER that mirrors matching members in rank
 * order (roster order) and updates live as the roster changes.
 * ====================================================================== */

/** 1-based column number → letter (guards cpColLetter_ in RosterTrust.gs). */
function groupColLetter_(n) {
  if (typeof cpColLetter_ === 'function') return cpColLetter_(n);
  let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s;
}

/**
 * Reads a tab's top-left cells for a "#group: …" marker. Forms:
 *   "#group: Column = Value"            group by that column's value (or "Column: Value")
 *   "#group: Column in V1, V2, …"       any of several values (e.g. two ranks — cadets + probationary)
 *   "#group: Value"                     shorthand — engine auto-finds the column
 *   "#group: … | A, B, C"               after the "|", extra roster columns (e.g. hidden Beat, Vehicle) to also show
 * @return {{row,col,column,values:string[],extras:string[],raw}|null}
 */
function groupMarker_(sh) {
  const rows = Math.min(5, sh.getLastRow());
  if (rows < 1) return null;
  const cols = Math.min(4, Math.max(1, sh.getLastColumn()));
  const grid = sh.getRange(1, 1, rows, cols).getDisplayValues();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const m = String(grid[r][c] || '').match(/^#group:\s*(.+)$/i);
      if (!m) continue;
      const raw = m[1].trim();
      const parts = raw.split('|');
      const spec = parts[0].trim();
      const extras = parts.length > 1 ? parts[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
      const inM = spec.match(/^(.+?)\s+in\s+(.+)$/i); // "Column in V1, V2, …" → any of these values
      if (inM) return { row: r + 1, col: c + 1, column: inM[1].trim(), values: inM[2].split(',').map((s) => s.trim()).filter(Boolean), extras: extras, raw: raw };
      const eq = spec.match(/^(.+?)\s*[:=]\s*(.+)$/);
      if (eq) return { row: r + 1, col: c + 1, column: eq[1].trim(), values: [eq[2].trim()], extras: extras, raw: raw };
      return { row: r + 1, col: c + 1, column: '', values: [spec], extras: extras, raw: raw };
    }
  }
  return null;
}

/** Auto-find the first roster column (left→right) whose data holds `value`. @return {number} 1-based col, or 0. */
function findGroupColumn_(roster, start, value) {
  const lastRow = roster.getLastRow();
  const lastCol = roster.getLastColumn();
  const n = lastRow - start + 1;
  if (n <= 0 || lastCol < 1) return 0;
  const data = roster.getRange(start, 1, n, lastCol).getDisplayValues();
  const want = String(value).trim().toUpperCase();
  for (let c = 0; c < lastCol; c++) {
    for (let r = 0; r < n; r++) { if (String(data[r][c] || '').trim().toUpperCase() === want) return c + 1; }
  }
  return 0;
}

/**
 * Suggest a "#group:" marker from a tab name so the "no marker" help can be specific.
 *   "Day Shift"  → "#group: Shift = Day"      "Troop A" → "#group: Troop = A"
 *   "Academy"    → "#group: Rank in Police Cadet, Probationary Officer"
 * @return {string}
 */
function suggestMarker_(name) {
  const raw = String(name).trim();
  if (/academy|cadet|recruit|training/i.test(raw)) return '#group: Rank in Police Cadet, Probationary Officer';
  const words = raw.split(/\s+/);
  const noun = /^(shift|division|troop|district|squad|platoon|precinct|watch|beat|sector|zone)$/i;
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  if (words.length >= 2 && noun.test(words[words.length - 1])) return '#group: ' + cap(words[words.length - 1]) + ' = ' + words.slice(0, -1).join(' ');
  if (words.length >= 2 && noun.test(words[0])) return '#group: ' + cap(words[0]) + ' = ' + words.slice(1).join(' ');
  return '#group: ' + raw;
}

/** Find the header row on a group tab (the row holding a RANK + NAME label) and its uppercased labels. @return {{row:number, headers:string[]}} */
function groupHeaderRow_(sh) {
  const maxScan = Math.min(15, sh.getLastRow());
  if (maxScan < 1) return { row: 0, headers: [] };
  const w = Math.max(1, sh.getLastColumn());
  const grid = sh.getRange(1, 1, maxScan, w).getDisplayValues();
  for (let r = 0; r < maxScan; r++) {
    const up = grid[r].map((x) => String(x).toUpperCase().trim());
    const hasRank = up.some((h) => h.indexOf('RANK') !== -1 && h.indexOf('GROUP') === -1);
    const hasName = up.some((h) => h === 'NAME' || (h.indexOf('NAME') !== -1 && h.indexOf('OOC') === -1 && h.indexOf('UNIQUE') === -1));
    if (hasRank && hasName) return { row: r + 1, headers: up };
  }
  return { row: 0, headers: [] };
}

/** Infer a group filter from a tab name: "Day Shift" → {column:'Shift', values:['Day']}. @return {{column:string, values:string[]}} */
function inferGroup_(name) {
  const raw = String(name).trim();
  if (/academy|cadet|recruit|training/i.test(raw)) return { column: 'Rank', values: ['Police Cadet', 'Probationary Officer'] };
  const words = raw.split(/\s+/);
  const noun = /^(shift|division|troop|district|squad|platoon|precinct|watch|beat|sector|zone)$/i;
  if (words.length >= 2 && noun.test(words[words.length - 1])) return { column: words[words.length - 1], values: [words.slice(0, -1).join(' ')] };
  if (words.length >= 2 && noun.test(words[0])) return { column: words[0], values: [words.slice(1).join(' ')] };
  return { column: '', values: [raw] };
}

/** Normalize a group value for matching: lowercase, collapse whitespace, trim. */
function groupNorm_(x) { return String(x).toLowerCase().replace(/\s+/g, ' ').trim(); }

/** A normalized value as an RE2-safe, quote-safe fragment for a "^…" REGEXMATCH inside a FILTER formula. */
function groupRe_(v) { return groupNorm_(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, '""'); }

/** 0-based column offsets within [firstCol, firstCol+width-1] that carry a CHECKBOX data-validation rule (scans a few rows). @return {number[]} */
function checkboxOffsets_(sheet, firstRow, firstCol, width) {
  const out = {};
  try {
    const n = Math.max(1, Math.min(5, sheet.getMaxRows() - firstRow + 1));
    const vlds = sheet.getRange(firstRow, firstCol, n, width).getDataValidations();
    for (let r = 0; r < vlds.length; r++) { for (let i = 0; i < vlds[r].length; i++) { const v = vlds[r][i]; if (v && v.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX) out[i] = true; } }
  } catch (e) { /* no validations to read */ }
  return Object.keys(out).map(Number);
}

/**
 * Roster RANK GROUP bands as { normalized label → {top, bottom} } roster-row ranges, read from the column's actual
 * merged ranges (a plain read blanks every merged cell but the top). Lets each group's members be selected by their
 * roster row range. @return {Object<string,{top:number,bottom:number}>}
 */
function rosterBandRanges_(roster, rosterBandCol) {
  const out = {};
  if (!rosterBandCol) return out;
  const maxR = roster.getMaxRows();
  const rng = roster.getRange(1, rosterBandCol, maxR, 1);
  const vals = rng.getValues();
  const merges = rng.getMergedRanges();
  const covered = {};
  const add = (label, top, bottom) => {
    if (!label) return;
    if (!(label in out)) out[label] = { top: top, bottom: bottom };
    else { out[label].top = Math.min(out[label].top, top); out[label].bottom = Math.max(out[label].bottom, bottom); }
  };
  merges.forEach((m) => {
    const top = m.getRow();
    for (let r = top; r < top + m.getNumRows(); r++) covered[r] = true;
    add(groupNorm_(vals[top - 1][0]), top, top + m.getNumRows() - 1);
  });
  for (let r = 1; r <= maxR; r++) { if (!covered[r]) add(groupNorm_(vals[r - 1][0]), r, r); } // single-cell (unmerged) bands
  return out;
}

/**
 * A group tab's OWN RANK GROUP bands as [{label(normalized), top, height}], read from column B's merged ranges below
 * the header — these are the fixed-size bands the user laid out. The engine fills members into each and never resizes
 * them. @return {Array<{label:string,top:number,height:number}>}
 */
function tabBandRanges_(sh, dataRow, tabBandCol) {
  const out = [];
  if (!tabBandCol) return out;
  const maxR = sh.getMaxRows();
  if (maxR < dataRow) return out;
  const rng = sh.getRange(dataRow, tabBandCol, maxR - dataRow + 1, 1);
  const vals = rng.getValues();
  const merges = rng.getMergedRanges();
  const covered = {};
  merges.forEach((m) => {
    const top = m.getRow();
    for (let r = top; r < top + m.getNumRows(); r++) covered[r] = true;
    const label = groupNorm_(vals[top - dataRow][0]);
    if (label) out.push({ label: label, top: top, height: m.getNumRows() });
  });
  for (let i = 0; i < vals.length; i++) { // single-cell (unmerged) bands
    const r = dataRow + i;
    if (covered[r]) continue;
    const label = groupNorm_(vals[i][0]);
    if (label) out.push({ label: label, top: r, height: 1 });
  }
  out.sort((a, b) => a.top - b.top);
  return out;
}

/**
 * FILL-ONLY. For each group tab (one carrying a "#group:" marker, or simply named like a group — "Day Shift",
 * "Troop A", "Academy"), the engine leaves the tab's own layout exactly as laid out — header, banners, widths,
 * formatting AND the RANK GROUP bands in column B (their sizes/blank spots are yours). Into each band it drops a live,
 * capped FILTER that fills that rank group's members for this shift at the band's top, leaving the remaining spots
 * blank. Tabs without rank-group bands get one contiguous FILTER instead. Nothing above the data area, and nothing in
 * column B, is touched. @return {{built:number, sheets:string[], skipped:Array<{name,why}>}}
 */
function buildGroupSheets_() {
  const ss = SpreadsheetApp.getActive();
  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  if (!roster) return { built: 0, sheets: [], skipped: [] };
  const RC = rosterCols_(roster);
  if (!RC.headerRow || !RC.name || !RC.rank) return { built: 0, sheets: [], skipped: [] };
  const lastCol = roster.getLastColumn();
  const rHdrUp = roster.getRange(RC.headerRow, 1, 1, lastCol).getDisplayValues()[0].map((h) => String(h).toUpperCase().trim());
  const rName = "'" + String(CONFIG.sheets.roster).replace(/'/g, "''") + "'";
  const start = CONFIG.rosterStartRow;
  const headerToData = Math.max(1, start - RC.headerRow); // roster gap between the label row and the first member row (e.g. divider row 7 → data starts row 8)
  const L = (c) => groupColLetter_(c);
  // marker/inferred column name → roster column: exact match wins (so "NAME" beats "OOC NAME"), then a contains match.
  const colFor = (label) => {
    const key = String(label).toUpperCase().trim();
    if (!key) return 0;
    for (let c = 0; c < rHdrUp.length; c++) { if (rHdrUp[c] === key) return c + 1; }
    for (let c = 0; c < rHdrUp.length; c++) { if (rHdrUp[c] && rHdrUp[c].indexOf(key) !== -1) return c + 1; }
    return 0;
  };
  // Punctuation-tolerant match for the pulled block: a tab's "JUN. HOURS" must still find the roster's "JUN HOURS".
  const hnorm = (h) => String(h == null ? '' : h).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const rHdrN = rHdrUp.map(hnorm);
  const colForTab = (label) => {
    const key = hnorm(label);
    if (!key) return 0;
    for (let c = 0; c < rHdrN.length; c++) { if (rHdrN[c] === key) return c + 1; }             // exact (normalized) wins
    for (let c = 0; c < rHdrN.length; c++) { if (rHdrN[c] && rHdrN[c].indexOf(key) !== -1) return c + 1; } // then contains
    return 0;
  };
  const firstCol = RC.rank;
  const rosterWidth = lastCol - firstCol + 1;
  // Roster checkbox columns can't be REAL checkboxes in a live FILTER (the rule occupies the array's cells → #REF!), so
  // the per-tab block below mirrors them with a filled box ☑ (checked) / empty box ☐ (unchecked) instead.
  const cbSet = {}; checkboxOffsets_(roster, start, firstCol, rosterWidth).forEach((off) => { cbSet[firstCol + off] = true; });
  const nameRange = rName + '!' + L(RC.name) + start + ':' + L(RC.name);
  // The roster's RANK GROUP column (merged bands) — header "RANK … GROUP", else the column just left of RANK.
  let rosterBandCol = 0;
  for (let c = 0; c < rHdrUp.length; c++) { if (rHdrUp[c].indexOf('RANK') !== -1 && rHdrUp[c].indexOf('GROUP') !== -1) { rosterBandCol = c + 1; break; } }
  if (!rosterBandCol && RC.rank > 1) rosterBandCol = RC.rank - 1;
  const firstColRange = rName + '!' + L(firstCol) + start + ':' + L(firstCol); // for ROW() row-range tests
  const rosterRanges = rosterBandRanges_(roster, rosterBandCol); // group label → roster row range
  // Don't touch the roster or the engine's own system tabs.
  const sysNames = {};
  Object.keys(CONFIG.sheets || {}).forEach((k) => { if (CONFIG.sheets[k]) sysNames[String(CONFIG.sheets[k]).toUpperCase()] = true; });
  ['CONTROL PANEL', 'CONFIG', '⚙️ CONFIG', 'DEV / QA', 'DEV/QA', 'DASHBOARD'].forEach((n) => { sysNames[n] = true; });
  const groupNoun = /(shift|division|troop|district|squad|platoon|precinct|watch|beat|sector|zone)/i; // NB: "academy" is handled by buildAcademySheets_ (editable), not here
  const built = [];
  const skipped = [];
  ss.getSheets().forEach((sh) => {
    if (sh.getSheetId() === roster.getSheetId()) return;
    const nm = sh.getName();
    if (sysNames[nm.toUpperCase()]) return;
    if (isAcademyTab_(sh)) return; // the Academy is an editable tracker, not a read-only #group view
    const marker = groupMarker_(sh);
    // A tab counts as a group tab if it has an explicit marker OR its name reads like a group.
    if (!marker && !groupNoun.test(nm)) return;
    const grp = marker ? { column: marker.column, values: marker.values } : inferGroup_(nm);
    const gCol = grp.column ? colFor(grp.column) : findGroupColumn_(roster, start, grp.values[0]);
    // Find where the member rows begin on THIS tab (right below its own RANK/NAME header row) — never assume a position.
    const hdr = groupHeaderRow_(sh);
    if (!hdr.row) { skipped.push({ name: nm, why: 'no RANK/NAME header row found — lay out the columns first' }); return; }
    let rankTabCol = 0;
    for (let i = 0; i < hdr.headers.length; i++) { const h = hdr.headers[i]; if (h.indexOf('RANK') !== -1 && h.indexOf('GROUP') === -1) { rankTabCol = i + 1; break; } }
    if (!rankTabCol) rankTabCol = 1;
    if (!gCol) { skipped.push({ name: nm, why: 'couldn\'t match "' + (marker ? marker.raw : nm) + '" to a roster column' }); return; }
    const dataRow = hdr.row + headerToData; // skip the same divider gap the roster leaves below its header (member rows start there)
    // Map THIS tab's headers (from its RANK column rightward) to roster columns, so each value lands under the matching
    // header even when the tab OMITS columns (e.g. EMAIL/DOB) or REORDERS them (MAY before JUN). A header matching no
    // roster column becomes a blank column, keeping everything after it aligned. Replaces the old contiguous mirror,
    // which shifted every value right once the roster carried columns the tab doesn't show.
    let tabLastCol = rankTabCol;
    for (let i = hdr.headers.length - 1; i >= rankTabCol - 1; i--) { if (String(hdr.headers[i] || '').trim() !== '') { tabLastCol = i + 1; break; } }
    const fillW = Math.min(tabLastCol - rankTabCol + 1, sh.getMaxColumns() - rankTabCol + 1);
    if (fillW <= 0) { skipped.push({ name: nm, why: 'not enough columns to the right of RANK' }); return; }
    const blockParts = [];
    for (let tc = rankTabCol; tc < rankTabCol + fillW; tc++) {
      const rc = colForTab(hdr.headers[tc - 1] || '');
      if (!rc) { blockParts.push('IF(' + firstColRange + '="","","")'); continue; } // header maps to no roster column → blank, aligned
      const rgc = rName + '!' + L(rc) + start + ':' + L(rc);
      blockParts.push(cbSet[rc] ? ('IF(' + rgc + ',"☑","☐")') : rgc);
    }
    const block = '{' + blockParts.join(',') + '}';
    // Find the tab's RANK GROUP column. Its "RANK GROUP" label is usually merged across the banner+label rows, so its
    // value only sits in the top row — scan both rows, and fall back to the column just left of RANK (mirrors the roster).
    const topHdr = hdr.row > 1 ? sh.getRange(hdr.row - 1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0].map((x) => String(x).toUpperCase()) : [];
    let tabBandCol = 0;
    for (let i = 0; i < Math.max(hdr.headers.length, topHdr.length); i++) {
      const combined = (hdr.headers[i] || '') + ' ' + (topHdr[i] || '');
      if (combined.indexOf('RANK') !== -1 && combined.indexOf('GROUP') !== -1) { tabBandCol = i + 1; break; }
    }
    if (!tabBandCol && rankTabCol > 1) tabBandCol = rankTabCol - 1;
    // Clear only the member CELLS we fill (content + any blocking merges + stray validations, e.g. a checkbox rule that
    // would occupy the array's cells) — never formatting, never column B (your bands stay put) — so the FILTER can spill.
    if (sh.getMaxRows() >= dataRow) {
      const area = sh.getRange(dataRow, rankTabCol, sh.getMaxRows() - dataRow + 1, fillW);
      area.breakApart(); area.clearContent(); area.clearDataValidations();
    }
    const gRange = rName + '!' + L(gCol) + start + ':' + L(gCol);
    // "Starts with" (case/space-tolerant) so a "Day Shift" tab finds a roster SHIFT of "Days"; OR across listed values.
    const shiftOR = '(' + grp.values.map((v) => 'REGEXMATCH(LOWER(TRIM(' + gRange + ')),"^' + groupRe_(v) + '")').join('+') + ')';
    // Fill INSIDE your bands: one capped FILTER per band drops that rank group's members at the band's top and leaves the
    // rest of the band's spots blank. ARRAY_CONSTRAIN caps each to its band height, so it can never overflow into the next.
    const bands = tabBandRanges_(sh, dataRow, tabBandCol);
    let placed = 0;
    bands.forEach((tb) => {
      const rb = rosterRanges[tb.label];
      if (!rb) return; // a tab band whose label isn't one of the roster's rank groups — leave it blank
      const f = '=IFERROR(ARRAY_CONSTRAIN(FILTER(' + block + ',' + shiftOR + ',' + nameRange + '<>"",ROW(' + firstColRange + ')>=' + rb.top + ',ROW(' + firstColRange + ')<=' + rb.bottom + '),' + tb.height + ',' + fillW + '),"")';
      sh.getRange(tb.top, rankTabCol).setFormula(f);
      placed++;
    });
    if (!placed) {
      // Tab has no rank-group bands — fall back to one contiguous FILTER (everyone in rank order, no blank spots).
      sh.getRange(dataRow, rankTabCol).setFormula('=IFERROR(FILTER(' + block + ',' + shiftOR + ',' + nameRange + '<>""),"No members in this group yet.")');
    }
    built.push(nm);
  });
  return { built: built.length, sheets: built, skipped: skipped };
}

/** Menu action: fill / refresh every group tab. */
function buildGroupSheets() {
  runAction_('Build Group Sheets', () => {
    const ui = SpreadsheetApp.getUi();
    const res = buildGroupSheets_();
    let msg = '';
    if (res.built) {
      msg += 'Filled ' + res.built + ' group tab' + (res.built === 1 ? '' : 's') + ':\n• ' + res.sheets.join('\n• ') +
        '\n\nMembers drop into the top of each of your RANK GROUP bands (blank spots left as-is). Your bands aren’t resized.\n';
    }
    if (res.skipped && res.skipped.length) {
      msg += (msg ? '\n' : '') + 'Skipped:\n' + res.skipped.map((s) => '• ' + s.name + ' — ' + s.why).join('\n') + '\n';
    }
    if (!msg) {
      msg = 'No group tabs found.\n\nName a tab after the group — e.g. “Day Shift”, “Troop A”, “Academy” — lay out the columns like the roster, then run this again.\n\n' +
        'Prefer to be explicit? Put a marker in the tab instead:\n  #group: Shift = Day\n  #group: Rank in Police Cadet, Probationary Officer';
    }
    ui.alert('🗂️ Build / Refresh Group Sheets', msg, ui.ButtonSet.OK);
  });
}

/* ======================================================================
 * POLICE ACADEMY — an EDITABLE, roster-synced training tracker. Unlike the
 * read-only #group tabs, the engine keeps one row per Cadet / Probationary
 * member (matched by UNIQUE ID so your edits stay put), fills the identity
 * columns (UNIQUE ID / RANK / NAME / CALLSIGN) from the roster, and NEVER
 * touches your own training columns (Exam, Ride-Alongs, Notes, …). Members
 * who leave those ranks drop below a "— GRADUATED —" divider with everything
 * you typed kept. Tab is any sheet named "…Academy…" or carrying a marker:
 *   #academy: Rank in Police Cadet, Probationary Officer
 * ====================================================================== */

const ACADEMY_DEFAULT_RANKS = ['Police Cadet', 'Probationary Officer'];
const ACADEMY_GRAD_DIVIDER = '— GRADUATED —';

/** Read a tab's top cells for "#academy: Rank in A, B" (which ranks to track). @return {{ranks:string[]}|null} */
function academyMarker_(sh) {
  const rows = Math.min(5, sh.getLastRow());
  if (rows < 1) return null;
  const cols = Math.min(4, Math.max(1, sh.getLastColumn()));
  const grid = sh.getRange(1, 1, rows, cols).getDisplayValues();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const m = String(grid[r][c] || '').match(/^#academy:\s*(.+)$/i);
      if (!m) continue;
      const inM = m[1].trim().match(/^(?:rank\s+in\s+|rank\s*[:=]\s*)?(.+)$/i);
      const list = (inM ? inM[1] : m[1]).split(',').map((s) => s.trim()).filter(Boolean);
      return { ranks: list.length ? list : ACADEMY_DEFAULT_RANKS.slice() };
    }
  }
  return null;
}

/** Is this an Academy tab? (name contains "academy", or it carries a #academy: marker). */
function isAcademyTab_(sh) { return /academy/i.test(sh.getName()) || !!academyMarker_(sh); }

/**
 * Rank names that belong to a "Training" dashboard label — i.e. any [DASHBOARD_GROUPS] group whose NAME matches a
 * training keyword (TRAINING_KEYWORDS: TRAINING, CADET). This is what the Engine Settings → Ranks panel writes when
 * you tag a rank "Training", so tagging there ALSO designates it as a Police Academy training rank. @return {string[]}
 */
function academyTrainingRanksFromLabels_() {
  const out = [];
  try {
    const groups = (CONFIG.dashboard && CONFIG.dashboard.groups) ? CONFIG.dashboard.groups : {};
    const kw = CONFIG.trainingDividers || []; // normalized training keywords (e.g. TRAINING, CADET)
    if (!kw.length) return out;
    const tagSet = {}; (CONFIG.sectionCategories || []).forEach((t) => { tagSet[norm_(t.label)] = true; });
    Object.keys(groups).forEach((g) => {
      const gn = norm_(g);
      if (!kw.some((k) => k && gn.indexOf(k) !== -1)) return;                       // group name isn't a training label
      (groups[g] || []).forEach((cat) => { if (cat && !tagSet[norm_(cat)]) out.push(String(cat).trim()); }); // keep rank entries, skip section-tag labels
    });
  } catch (e) { if (typeof log_ === 'function') log_('academyTrainingRanksFromLabels_', e); }
  return out;
}

/** Find the Academy header row (the row that holds a NAME label) + its uppercased labels. */
function academyHeaderRow_(sh) {
  const maxScan = Math.min(15, sh.getLastRow());
  if (maxScan < 1) return { row: 0, headers: [] };
  const w = Math.max(1, sh.getLastColumn());
  const grid = sh.getRange(1, 1, maxScan, w).getDisplayValues();
  for (let r = 0; r < maxScan; r++) {
    const up = grid[r].map((x) => String(x).toUpperCase().trim());
    if (up.some((h) => h === 'NAME' || (h.indexOf('NAME') !== -1 && h.indexOf('OOC') === -1 && h.indexOf('UNIQUE') === -1))) return { row: r + 1, headers: up };
  }
  return { row: 0, headers: [] };
}

/** Resolve the Academy sheet's engine-owned columns from its header labels (1-based; 0 when absent). Everything else is yours. */
function academyCols_(headers) {
  const find = (pred) => { for (let i = 0; i < headers.length; i++) { if (headers[i] && pred(headers[i])) return i + 1; } return 0; };
  return {
    id: find((h) => h.indexOf('UNIQUE') !== -1 || h.indexOf('DISCORD') !== -1 || h === 'ID' || /\bID\b/.test(h)),
    rank: find((h) => h.indexOf('RANK') !== -1 && h.indexOf('GROUP') === -1),
    name: find((h) => h === 'NAME' || (h.indexOf('NAME') !== -1 && h.indexOf('OOC') === -1 && h.indexOf('UNIQUE') === -1)),
    call: find((h) => h.indexOf('CALLSIGN') !== -1 || h.indexOf('UNIT') !== -1),
    grad: find((h) => h.indexOf('GRADUAT') !== -1),
  };
}

/**
 * Find a "GRADUATE LOG" section below the roster area: the header row (a row holding the word "GRADUATE") and the
 * first data row beneath its banner. Graduates are written there; the header row also caps the member bands.
 * @return {{headerRow:number, dataStart:number}|null}
 */
function academyGradSection_(sh, fromRow, width) {
  const maxR = sh.getMaxRows();
  if (fromRow > maxR) return null;
  const disp = sh.getRange(fromRow, 1, maxR - fromRow + 1, width).getDisplayValues();
  let hdr = 0;
  for (let i = 0; i < disp.length; i++) { if (disp[i].some((c) => /GRADUATE/i.test(String(c)))) { hdr = fromRow + i; break; } }
  if (!hdr) return null;
  const merges = sh.getRange(hdr, 1, Math.min(6, maxR - hdr + 1), width).getMergedRanges(); // banner is usually merged — data starts under it
  let bottom = hdr;
  merges.forEach((m) => { if (m.getRow() <= hdr + 4) bottom = Math.max(bottom, m.getRow() + m.getNumRows() - 1); });
  return { headerRow: hdr, dataStart: Math.min(bottom + 1, maxR) };
}

/** Significant rank/label word-stems for matching an Academy band to a rank ("CADETS"→[CADET], "Probationary Officer"→[PROBATIONARY]). */
function academyStems_(s) {
  const STOP = { MEMBER: 1, MEMBERS: 1, TEAM: 1, TEAMS: 1, OFFICER: 1, OFFICERS: 1, POLICE: 1, THE: 1, OF: 1, GROUP: 1, GROUPS: 1, RANK: 1, RANKS: 1, DIVISION: 1, SECTION: 1, UNIT: 1, DEPARTMENT: 1 };
  return String(s || '').toUpperCase().split(/[^A-Z]+/).filter((w) => w && !STOP[w]).map((w) => w.replace(/S$/, ''));
}

/**
 * Sync every Academy tab. Fills members INTO the RANK GROUP bands you laid out (each band matched to a rank by its
 * label — "CADETS"→Police Cadet, "PROBATIONARY MEMBERS"→Probationary Officer), at the band's top with blank spots
 * below. Identity columns come from the roster; your training columns are preserved (matched by UNIQUE ID) and never
 * overwritten; column B (your bands) is untouched. Anyone no longer in a band drops below a "— GRADUATED —" divider.
 * A tab with no rank-group bands falls back to one contiguous list. @return {{built:number, sheets:string[], skipped}}
 */
function buildAcademySheets_() {
  const ss = SpreadsheetApp.getActive();
  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  if (!roster) return { built: 0, sheets: [], skipped: [] };
  const RC = rosterCols_(roster);
  if (!RC.headerRow || !RC.name || !RC.rank) return { built: 0, sheets: [], skipped: [] };
  const start = CONFIG.rosterStartRow;
  const headerToData = Math.max(1, start - RC.headerRow);
  const lastRowR = roster.getLastRow();
  const nR = Math.max(0, lastRowR - start + 1);
  const rd = nR ? roster.getRange(start, 1, nR, roster.getLastColumn()).getDisplayValues() : [];
  const rHdrUp = roster.getRange(RC.headerRow, 1, 1, roster.getLastColumn()).getDisplayValues()[0].map((h) => String(h).toUpperCase().trim());
  const colForRoster = (label) => { // academy header label → roster column: exact match wins (NAME beats OOC NAME), then contains
    const key = String(label).toUpperCase().trim();
    if (!key) return 0;
    for (let c = 0; c < rHdrUp.length; c++) { if (rHdrUp[c] === key) return c + 1; }
    for (let c = 0; c < rHdrUp.length; c++) { if (rHdrUp[c] && rHdrUp[c].indexOf(key) !== -1) return c + 1; }
    return 0;
  };
  // The roster's section banners (the row above its header). The Academy only MIRRORS columns that sit under a section
  // the roster ALSO has (MEMBER INFORMATION / TENURE / …). Columns under the tab's OWN sections (LEO EXAM, RIDE-ALONGS…)
  // are training fields the engine must never overwrite — even when a header collides, e.g. a LEO-EXAM "STATUS".
  const rosterBannerSet = {};
  if (RC.headerRow > 1) roster.getRange(RC.headerRow - 1, 1, 1, roster.getLastColumn()).getDisplayValues()[0].forEach((b) => { const nb = norm_(b); if (nb) rosterBannerSet[nb] = true; });
  // Training ranks (shared across academy tabs): the "Training" dashboard label (Engine Settings → Ranks) + any
  // [RANKS] TRAINING flags. Either way of designating a training rank works; a per-tab #academy marker overrides both.
  const baseTraining = ((CONFIG.rankList && CONFIG.rankList.trainingRanks) ? CONFIG.rankList.trainingRanks : [])
    .concat(academyTrainingRanksFromLabels_());
  const built = [];
  const skipped = [];
  ss.getSheets().forEach((sh) => {
    if (sh.getSheetId() === roster.getSheetId()) return;
    if (!isAcademyTab_(sh)) return;
    const mk = academyMarker_(sh);
    const wanted = ((mk && mk.ranks.length) ? mk.ranks : (baseTraining.length ? baseTraining : ACADEMY_DEFAULT_RANKS)).map(groupNorm_);
    const isTrainee = (rank) => { const r = groupNorm_(rank); return wanted.some((w) => w && r.indexOf(w) === 0); };
    const H = academyHeaderRow_(sh);
    if (!H.row) { skipped.push({ name: sh.getName(), why: 'no header row with a NAME column found' }); return; }
    const AC = academyCols_(H.headers);
    if (!AC.name) { skipped.push({ name: sh.getName(), why: 'no NAME column' }); return; }
    const useId = !!(AC.id && RC.discord);          // match rows by UNIQUE ID when both sides have one; else by NAME
    const keyCol = useId ? AC.id : AC.name;
    const dataRow = H.row + headerToData;
    const maxRows = sh.getMaxRows();
    const width = Math.max(sh.getLastColumn(), AC.name, keyCol, AC.rank || 0, AC.grad || 0);
    // Map each academy column to a roster column (by header) — but ONLY within sections the roster also has, so a
    // training field that reuses a roster header (e.g. a LEO-EXAM "STATUS") is never overwritten. The tab's banner per
    // column is forward-filled across the merged banner row. Unmapped columns (your training fields) are preserved.
    const aBannerRow = H.row > 1 ? H.row - 1 : 0;
    const aBanners = [];
    if (aBannerRow) { const raw = sh.getRange(aBannerRow, 1, 1, width).getDisplayValues()[0]; let cur = ''; for (let c = 0; c < width; c++) { const v = norm_(raw[c]); if (v) cur = v; aBanners[c] = cur; } }
    const colMap = [];
    for (let c = 0; c < width; c++) {
      if (AC.grad && c + 1 === AC.grad) { colMap[c] = 0; continue; }                        // GRADUATED col is engine-owned
      if (aBannerRow && !rosterBannerSet[aBanners[c] || '']) { colMap[c] = 0; continue; }    // under one of YOUR sections → a training field, never overwritten
      colMap[c] = colForRoster(H.headers[c] || '');
    }
    // Find the tab's RANK GROUP band column (its label is often merged across the banner+label rows → scan both; else col left of RANK).
    const topHdr = H.row > 1 ? sh.getRange(H.row - 1, 1, 1, width).getDisplayValues()[0].map((x) => String(x).toUpperCase()) : [];
    let tabBandCol = 0;
    for (let i = 0; i < Math.max(H.headers.length, topHdr.length); i++) {
      const combined = (H.headers[i] || '') + ' ' + (topHdr[i] || '');
      if (combined.indexOf('RANK') !== -1 && combined.indexOf('GROUP') !== -1) { tabBandCol = i + 1; break; }
    }
    if (!tabBandCol && AC.rank > 1) tabBandCol = AC.rank - 1;
    const memberCol1 = tabBandCol ? tabBandCol + 1 : 1; // first member column = right of the band column (never write column B)
    // Read the existing body (to preserve your training columns) keyed by ID; a display read of the key avoids number rounding.
    const existVals = maxRows >= dataRow ? sh.getRange(dataRow, 1, maxRows - dataRow + 1, width).getValues() : [];
    const existKeys = maxRows >= dataRow ? sh.getRange(dataRow, keyCol, maxRows - dataRow + 1, 1).getDisplayValues() : [];
    const existByKey = {};
    for (let i = 0; i < existVals.length; i++) {
      if (String(existVals[i][AC.name - 1] || '').trim() === ACADEMY_GRAD_DIVIDER) continue; // never re-ingest the divider row
      const k = String(existKeys[i][0] || '').trim();
      if (k && existVals[i].some((c) => String(c || '').trim() !== '')) existByKey[k] = existVals[i].slice();
    }
    const blank = () => new Array(width).fill('');
    const keyOfIdx = (i) => (useId ? String(rd[i][RC.discord - 1] || '') : String(rd[i][RC.name - 1] || '')).trim();
    const rowForIdx = (i, graduated) => {
      const k = keyOfIdx(i);
      const row = (k && existByKey[k]) ? existByKey[k].slice() : blank();
      while (row.length < width) row.push('');
      for (let c = memberCol1; c <= width; c++) { const rc = colMap[c - 1]; if (rc) row[c - 1] = String(rd[i][rc - 1] || ''); } // fill roster-mapped columns
      if (AC.grad) row[AC.grad - 1] = graduated ? 'Graduated' : '';
      return row;
    };
    const filled = {};
    // Write helper: member columns only (right of the band column), so your column-B bands are never touched.
    const writeBlock = (rowsFull, atRow) => {
      if (!rowsFull.length) return;
      sh.getRange(atRow, memberCol1, rowsFull.length, width - memberCol1 + 1).setValues(rowsFull.map((r) => r.slice(memberCol1 - 1, width)));
    };
    if (AC.id && AC.id >= memberCol1) sh.getRange(dataRow, AC.id, maxRows - dataRow + 1, 1).setNumberFormat('@'); // keep long IDs exact
    // A "GRADUATE LOG" section (a row holding "GRADUATE") tells us where graduates go AND caps the member bands above it.
    const gradSec = academyGradSection_(sh, dataRow, width);
    // Clear member columns in [top, bottom] — break merges so setValues is safe, but never touch the GRADUATE LOG banner.
    const clearMemberCols = (top, bottom) => { if (bottom >= top && bottom >= dataRow) { const a = sh.getRange(top, memberCol1, bottom - top + 1, width - memberCol1 + 1); a.breakApart(); a.clearContent(); } };
    // Members STILL on the roster (named), keyed the same way. A member GONE from the roster is REMOVED from the Academy;
    // one who left the training ranks but remains on the roster (e.g. promoted to Officer) goes to the GRADUATE LOG.
    const rosterKeys = {};
    for (let i = 0; i < rd.length; i++) { const kk = keyOfIdx(i); if (kk && String(rd[i][RC.name - 1] || '').trim()) rosterKeys[kk] = true; }
    const gradRowsFrom = () => Object.keys(existByKey).filter((k) => !filled[k] && rosterKeys[k]).map((k) => { const r = existByKey[k].slice(); while (r.length < width) r.push(''); if (AC.grad) r[AC.grad - 1] = 'Graduated'; return r; });
    const putGrads = (grads, bandBottom, tmplRow) => {
      const top = gradSec ? gradSec.dataStart : bandBottom + 1;
      clearMemberCols(top, sh.getMaxRows()); // clear the graduate destination first so removed graduates don't linger (banner above untouched)
      if (!grads.length) return;
      let writeAt;
      if (gradSec) {
        const need = top + grads.length - 1; if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
        writeBlock(grads, top); writeAt = top;
      } else {
        const need = top + grads.length; if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
        const div = blank(); div[AC.name - 1] = ACADEMY_GRAD_DIVIDER;
        writeBlock([div], top); writeBlock(grads, top + 1); writeAt = top + 1;
      }
      // Carry the band row's data validations (checkboxes, dates, dropdowns) onto the graduate rows so a moved checkbox
      // renders as a box — not "TRUE"/"FALSE" — and dates keep their picker.
      if (tmplRow) { try { sh.getRange(tmplRow, memberCol1, 1, width - memberCol1 + 1).copyTo(sh.getRange(writeAt, memberCol1, grads.length, width - memberCol1 + 1), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false); } catch (e) { /* validations are best-effort */ } }
    };

    const bands = tabBandRanges_(sh, dataRow, tabBandCol).filter((b) => !gradSec || b.top < gradSec.headerRow);
    if (bands.length) {
      const bandBottom = bands.reduce((mx, b) => Math.max(mx, b.top + b.height - 1), dataRow - 1);
      clearMemberCols(dataRow, bandBottom);
      // Assign each named roster member to the band whose label best matches their rank (word-stem overlap).
      const bandStems = bands.map((b) => academyStems_(b.label));
      const byBand = bands.map(() => []);
      for (let i = 0; i < rd.length; i++) {
        if (String(rd[i][RC.name - 1] || '').trim() === '') continue;
        if (!isTrainee(rd[i][RC.rank - 1])) continue; // only designated training ranks belong on the Academy
        const rs = academyStems_(rd[i][RC.rank - 1]);
        if (!rs.length) continue;
        let best = -1, score = 0;
        bands.forEach((b, bi) => { let s = 0; rs.forEach((w) => { if (bandStems[bi].indexOf(w) !== -1) s++; }); if (s > score) { score = s; best = bi; } });
        if (best >= 0) byBand[best].push(i);
      }
      bands.forEach((b, bi) => {
        const idxs = byBand[bi];
        const rows = [];
        for (let j = 0; j < b.height; j++) {
          if (j < idxs.length) { const i = idxs[j]; const k = keyOfIdx(i); if (k) filled[k] = true; rows.push(rowForIdx(i, false)); }
          else rows.push(blank());
        }
        writeBlock(rows, b.top);
      });
      putGrads(gradRowsFrom(), bandBottom, bands[0].top); // bands[0].top carries your checkbox/date/dropdown validations
      built.push(sh.getName());
      return;
    }

    // ---- No rank-group bands on the tab: one contiguous list (active in rank order), graduates to the log / a divider. ----
    clearMemberCols(dataRow, gradSec ? gradSec.headerRow - 1 : sh.getMaxRows());
    const activeRows = [];
    for (let i = 0; i < rd.length; i++) {
      const rk = groupNorm_(rd[i][RC.rank - 1]);
      if (!wanted.some((w) => rk.indexOf(w) === 0)) continue;
      if (String(rd[i][RC.name - 1] || '').trim() === '') continue;
      const k = keyOfIdx(i); if (k) filled[k] = true;
      activeRows.push(rowForIdx(i, false));
    }
    const grads = gradRowsFrom();
    if (gradSec) {
      writeBlock(activeRows.slice(0, Math.max(0, gradSec.headerRow - dataRow)), dataRow); // active fits above the GRADUATE LOG header
      putGrads(grads, dataRow - 1, dataRow);
    } else {
      const body = activeRows.slice();
      if (grads.length) { const div = blank(); div[AC.name - 1] = ACADEMY_GRAD_DIVIDER; body.push(div); grads.forEach((r) => body.push(r)); }
      const need = dataRow + Math.max(body.length, 1) - 1;
      if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
      writeBlock(body, dataRow);
    }
    built.push(sh.getName());
  });
  return { built: built.length, sheets: built, skipped: skipped };
}

/** Menu action: sync / refresh the Police Academy tab(s). */
function buildAcademySheets() {
  runAction_('Build Police Academy', () => {
    const ui = SpreadsheetApp.getUi();
    const res = buildAcademySheets_();
    let msg = '';
    if (res.built) {
      msg += 'Synced ' + res.built + ' academy tab' + (res.built === 1 ? '' : 's') + ':\n• ' + res.sheets.join('\n• ') +
        '\n\nMembers drop into the top of their RANK GROUP band (blank spots left as-is); roster columns are filled, your training columns are left untouched. Anyone promoted out drops below a “— GRADUATED —” divider.\n';
    }
    if (res.skipped && res.skipped.length) {
      msg += (msg ? '\n' : '') + 'Skipped:\n' + res.skipped.map((s) => '• ' + s.name + ' — ' + s.why).join('\n') + '\n';
    }
    if (!msg) {
      msg = 'No Police Academy tab found.\n\nMake a tab named “Police Academy” with a header row that has at least a UNIQUE ID and a NAME column, plus your own training columns (Exam, In-Game Training, Ride-Alongs, Notes…). Then run this again.\n\n' +
        'To track specific ranks, add a marker in the top-left cell:\n  #academy: Rank in Police Cadet, Probationary Officer';
    }
    ui.alert('🎓 Build / Refresh Police Academy', msg, ui.ButtonSet.OK);
  });
}

const HELPER_COLS_PROP = 'RE_HELPER_COLS'; // remembered "hide these" header list (per spreadsheet)

/** Hide each roster column whose header matches a name in `list` (exact header wins, then contains). @return {string[]} headers hidden. */
function hideHelperColumns_(roster, list) {
  const RC = rosterCols_(roster);
  if (!RC.headerRow) return [];
  const lastCol = roster.getLastColumn();
  const hdr = roster.getRange(RC.headerRow, 1, 1, lastCol).getDisplayValues()[0];
  const hdrUp = hdr.map((h) => String(h).toUpperCase().trim());
  const hidden = [];
  list.forEach((label) => {
    const key = String(label).toUpperCase().trim();
    if (!key) return;
    let col = 0;
    for (let c = 0; c < hdrUp.length; c++) { if (hdrUp[c] === key) { col = c + 1; break; } }
    if (!col) for (let c = 0; c < hdrUp.length; c++) { if (hdrUp[c] && hdrUp[c].indexOf(key) !== -1) { col = c + 1; break; } }
    if (col) { roster.hideColumns(col); hidden.push(hdr[col - 1]); }
  });
  return hidden;
}

/** Menu action: hide a named set of roster "helper" columns (remembered so it's easy to re-hide). */
function hideHelperColumns() {
  runAction_('Hide Helper Columns', () => {
    const ui = SpreadsheetApp.getUi();
    const roster = getSheetOrWarn_(SpreadsheetApp.getActive(), CONFIG.sheets.roster);
    if (!roster) return;
    const props = PropertiesService.getDocumentProperties();
    const cur = props.getProperty(HELPER_COLS_PROP) || '';
    const resp = ui.prompt('🙈 Hide Helper Columns',
      'Roster column headers to hide, comma-separated (e.g. Beat, Vehicle, Radio).' + (cur ? '\n\nCurrently: ' + cur : ''),
      ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    const list = String(resp.getResponseText() || '').split(',').map((s) => s.trim()).filter(Boolean);
    props.setProperty(HELPER_COLS_PROP, list.join(', '));
    const hidden = hideHelperColumns_(roster, list);
    ui.alert(hidden.length
      ? '✅ Hid ' + hidden.length + ' column' + (hidden.length === 1 ? '' : 's') + ': ' + hidden.join(', ') + '.\n\nUse 👁️ Show All Columns to reveal them.'
      : 'No matching columns found — check the header names against the roster.');
  });
}

/** Menu action: reveal every roster column (undo Hide Helper Columns). */
function showAllRosterColumns() {
  runAction_('Show All Columns', () => {
    const roster = getSheetOrWarn_(SpreadsheetApp.getActive(), CONFIG.sheets.roster);
    if (!roster) return;
    roster.showColumns(1, roster.getMaxColumns());
    SpreadsheetApp.getUi().alert('✅ All roster columns are visible.');
  });
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
  const cap = logRowCap_(), last = log.getLastRow(); if (last > cap) log.deleteRows(2, last - cap); // bound growth (v1.0: config cap)
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
      if (!isValidId_(m.id)) issues.push(`Malformed Unique ID: ${m.name}`);
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
    const who = (email && typeof auditWho_ === 'function') ? auditWho_(email) : (email || 'unknown'); // member NAME when the email is on their roster row
    log.appendRow([new Date(), who, sheetName, e.range.getA1Notation(), oldV, newV]);
    const cap = logRowCap_(), last = log.getLastRow(); if (last > cap) log.deleteRows(2, last - cap); // prune oldest, keep header (v1.0: config cap)
  } catch (err) {
    log_('recordEdit', err);
  }
}

/* ======================================================================
 * DEMO / PREVIEW DATA — seedDemoRoster()
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

/** A fake work email from a full name — "James Bennett" → "james.bennett@lspd.example" (RFC-2606 reserved TLD, never routable). */
function demoEmail_(name) {
  const slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  return slug ? slug + '@lspd.example' : '';
}

/** A believable adult date of birth for slot `i` (age 21–55, day-jittered so birthdays spread across the year). Deterministic — reseeds identically. */
function demoDob_(i) {
  const age = 21 + Math.floor(demoRand_(i, 11) * 35);        // 21–55
  const jitter = Math.floor(demoRand_(i, 12) * 365);         // scatter across the year, not all on one date
  return demoDay_(-(Math.round(age * 365.25) + jitter));
}

/**
 * Build a believable demo member for member-slot index `i` (0-based), given the rank already in the row.
 * Deterministic (salted hash, no RNG — reseeding the same layout reproduces the same demo).
 * Hours land inside the intended status's tier band so recompute is a no-op;
 * LOA/ROA carry an active leave; a few active members carry a recently-expired leave for history variety.
 */
function demoPerson_(i, rank, total) {
  // ≈ 60% top tier / 15% mid / 15% low / 5% + 5% leave, spread by a coprime stride — every name is read from CONFIG,
  // so a renamed OR LOA-only setup never seeds a status that doesn't exist (e.g. ROA). (No "Reserve" in the mix.)
  const tiers = (CONFIG.tierNames && CONFIG.tierNames.length >= 3) ? CONFIG.tierNames : ['Active', 'Semi-Active', 'Inactive'];
  const TOP = tiers[0], MID = tiers[1], LOW = tiers[tiers.length - 1];
  const lts = (CONFIG.leaveTypes && CONFIG.leaveTypes.length) ? CONFIG.leaveTypes : ['LOA'];
  const lv1 = lts[0], lv2 = lts[lts.length > 1 ? 1 : 0]; // 2nd leave slot reuses the only type on an LOA-only setup
  const rst = norm_(CONFIG.returnStatus || '');           // the "returning" leave (default ROA), if configured
  const DIST = [TOP, TOP, TOP, TOP, TOP, TOP, TOP, TOP, TOP, TOP, TOP, TOP, MID, MID, MID, LOW, LOW, LOW, lv1, lv2];
  const act = DIST[(i * 7) % DIST.length];
  let hours, last = act, leave = null, checks = null;
  const pastLeaves = [];
  const r = demoRand_(i, 1), r2 = demoRand_(i, 2);
  if (act === TOP) hours = demoQuarter_(10 + r * r * 15 + (r2 > 0.93 ? 6 : 0)); // right-skewed; rare ~30h grinder (top tier)
  else if (act === MID) hours = demoQuarter_(5 + r * 4.7);                       // mid tier band
  else if (act === LOW) hours = demoQuarter_(r * r * 4.7);                       // low tier, clustered low
  else if (rst && norm_(act) === rst) { hours = demoQuarter_(5 + r * 3.7); last = LOW; leave = { type: act, from: -(2 + i % 5), to: 6 + (i % 9), status: 'Approved' }; checks = [LOW, act, act, act]; } // returning leave (ROA-like)
  else { hours = 0; last = TOP; leave = { type: act, from: -(2 + i % 6), to: 5 + (i % 10), status: 'Approved' }; checks = [TOP, TOP, act, act]; } // protected leave (LOA-like)
  // Past (EXPIRED) leaves — a real LOA history. Members not currently ON leave accrue 0–3 finished leaves scattered
  // across the past ~7 months (deterministic). The most recent one tints their activity checks. This is what makes the
  // tracker's "history" section look lived-in instead of near-empty.
  if (!leave) {
    const cnt = [0, 0, 1, 1, 1, 2, 2, 3][Math.floor(demoRand_(i, 8) * 8)]; // ~25% none · mostly 1–2 · a few with 3
    let back = 26 + Math.floor(demoRand_(i, 9) * 34);                       // most recent ended 26–60 days ago
    for (let k = 0; k < cnt; k++) {
      const dur = 5 + Math.floor(demoRand_(i, 20 + k) * 19);                // a 5–23 day leave
      pastLeaves.push({ type: (k % 2 ? lv2 : lv1), from: -(back + dur), to: -back });
      back += dur + 18 + Math.floor(demoRand_(i, 30 + k) * 45);            // walk further back for the previous one
    }
    if (pastLeaves.length) checks = [pastLeaves[0].type, TOP, act, act];
  }
  const tenure = 1600 - Math.round((i / Math.max(total, 1)) * 1200); // seniority: earlier rows = longer tenure
  const shift = ''; // real shift is assigned per-rank (evenly across the 3 shifts) once all people are built — see seedDemoRoster
  const may = demoQuarter_(demoRand_(i, 3) * demoRand_(i, 6) * 30); // prior-month totals — right-skewed 0–30h
  const jun = demoQuarter_(demoRand_(i, 4) * demoRand_(i, 7) * 30);
  const nm = demoName_(i);
  return {
    name: nm, id: demoId_(i), email: demoEmail_(nm), dob: demoDob_(i), shift: shift, may: may, jun: jun,
    join: demoDay_(-tenure), promo: demoDay_(-(20 + (i % 10) * 16)),
    hours: hours, act: act, last: last, leave: leave, pastLeaves: pastLeaves,
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
function demoBlank_() { return { open: true, name: '', id: '', email: '', dob: '', shift: '', may: '', jun: '', join: '', promo: '', hours: '', act: '', last: '', leave: null, pastLeaves: [], checks: null }; }

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
function demoWriteLeave_(tracker, m, L, r, oiIn) {
  const TC = trackerCols_(tracker); // resolve columns by header (any layout)
  const start = demoDay_(L.from), end = demoDay_(L.to);
  const key = makeLeaveKey_(m.id, `${startOfDay_(start).getTime()}-${startOfDay_(end).getTime()}-${norm_(L.type)}`);
  const oi = oiIn || rosterOocShift_(m.id); // OOC + shift + unit/callsign from the already-filled demo roster (passed in to skip a per-leave rescan)
  if (TC.discord) tracker.getRange(r, TC.discord).setNumberFormat('@'); // keep the 17-19 digit ID exact
  const row = buildTrackerRow_(TC, TC.width, { key: key, rank: m.rank, unit: oi.unit, ooc: oi.ooc, name: m.name, discord: m.id, shift: oi.shift, start: start, end: end, status: L.status || 'Approved' });
  tracker.getRange(r, 1, 1, TC.width).setValues([row]);
  if (TC.start) tracker.getRange(r, TC.start).setNumberFormat('d mmm. yyyy');
  if (TC.end) tracker.getRange(r, TC.end).setNumberFormat('d mmm. yyyy');
  writeLeaveFormulas_(tracker, r, TC);
}

/** A time-of-day Date on a FIXED date base (2020-01-01), so a patrol TOTAL formula that subtracts start from end cancels the date part out. */
function demoTimeOfDay_(h, m) { return new Date(2020, 0, 1, h, m || 0, 0); }

/** A deterministic, non-routable demo phone number (555 exchange — RFC-fictional, never a real line). */
function demoPhone_(i) { const a = 100 + Math.floor(demoRand_(i, 13) * 900); const b = 1000 + Math.floor(demoRand_(i, 14) * 9000); return '(555) ' + a + '-' + b; }

/** Split a member's total hours into 1–4 believable quarter-hour patrol sessions that sum EXACTLY back to it. */
function demoSplitHours_(hours) {
  const q = Math.round(Number(hours) * 4); // total quarter-hours
  if (q <= 0) return [];
  const k = Math.min(4, Math.max(1, Math.round(q / 12))); // ~3 hrs per session
  const base = Math.floor(q / k), rem = q - base * k, out = [];
  for (let s = 0; s < k; s++) out.push((base + (s < rem ? 1 : 0)) / 4);
  return out; // sum === hours (quarter-exact)
}

/**
 * Seed the Patrol Log so each member's VALID sessions sum to the hours they now hold on the roster — the log
 * literally "reflects" their current hours. The hidden credit marker (col A = "hours|id") is set to match, so a
 * later refreshPatrolLog_/onEdit sweep sees it already credited and is a no-op (never double-credits). Sessions are
 * dated across the last ~4 weeks and auto-grouped. @return {number} rows written; 0 unless a Patrol Log tab exists.
 */
function seedDemoPatrolLog_(ss, memberRows, people, calls, start) {
  const plName = CONFIG.sheets.patrolLog;
  if (!plName) return 0;
  const patrol = ss.getSheetByName(plName);
  if (!patrol) return 0;
  const PC = patrolLogCols_(patrol);
  if (!PC.discord || !PC.startDate || !PC.endDate || !PC.startTime || !PC.endTime || !PC.status) return 0;
  const ds = CONFIG.patrolStartRow, W = Math.max(PC.width, 14);
  if (PC.labelRow && ds <= PC.labelRow) return 0; // misconfigured start row — never stomp the header
  if (patrol.getLastRow() >= ds) patrol.getRange(ds, 1, patrol.getLastRow() - ds + 1, Math.max(patrol.getLastColumn(), W)).clearContent(); // keep header + formatting

  const recs = [];
  memberRows.forEach((m, i) => {
    const p = people[i];
    if (p.open || !(Number(p.hours) > 0)) return; // open slots + members on protected (0-hour) leave log nothing
    const unit = String(calls[m.r - start][0] || '').trim(), ooc = demoOocName_(p.name);
    demoSplitHours_(p.hours).forEach((dur, k) => {
      const back = 1 + ((i * 3 + k * 7) % 27);                                       // 1–27 days ago (deterministic)
      const startMin = (7 + ((i + k * 2) % 12)) * 60 + [0, 15, 30, 45][(i + k) % 4]; // 07:00–18:45 start
      const endMin = startMin + Math.round(dur * 60);
      recs.push({
        mark: (Math.round(dur * 100) / 100) + '|' + p.id, rank: m.rank, unit: unit, ooc: ooc, name: p.name, id: p.id, shift: p.shift,
        sd: demoDay_(-back), ed: demoDay_(-back + Math.floor(endMin / 1440)),
        st: demoTimeOfDay_(Math.floor(startMin / 60), startMin % 60), et: demoTimeOfDay_(Math.floor((endMin % 1440) / 60), endMin % 60),
        status: CONFIG.patrol.processedStatus,
      });
    });
  });
  if (!recs.length) return 0;
  if (patrol.getMaxRows() < ds + recs.length - 1) patrol.insertRowsAfter(patrol.getMaxRows(), ds + recs.length - 1 - patrol.getMaxRows());
  if (PC.discord) patrol.getRange(ds, PC.discord, recs.length, 1).setNumberFormat('@'); // 18-digit ID exact...
  if (PC.mark) patrol.getRange(ds, PC.mark, recs.length, 1).setNumberFormat('@');       // ...and the "hours|id" marker as text
  const grid = recs.map((r) => {
    const a = new Array(W).fill('');
    const put = (c, v) => { if (c) a[c - 1] = v; };
    put(PC.mark, r.mark); put(PC.rank, r.rank); put(PC.unit, r.unit); put(PC.ooc, r.ooc); put(PC.name, r.name);
    put(PC.discord, r.id); put(PC.shift, r.shift); put(PC.startDate, r.sd); put(PC.endDate, r.ed);
    put(PC.startTime, r.st); put(PC.endTime, r.et); put(PC.status, r.status);
    return a;
  });
  patrol.getRange(ds, 1, recs.length, W).setValues(grid);
  if (PC.total) { const f = []; for (let k = 0; k < recs.length; k++) f.push([patrolTotalFormula_(PC, ds + k)]); patrol.getRange(ds, PC.total, recs.length, 1).setFormulas(f).setNumberFormat('0.00" hrs"'); }
  patrol.getRange(ds, PC.startDate, recs.length, 1).setNumberFormat(PATROL_DATE_FMT_);
  patrol.getRange(ds, PC.endDate, recs.length, 1).setNumberFormat(PATROL_DATE_FMT_);
  patrol.getRange(ds, PC.startTime, recs.length, 1).setNumberFormat(PATROL_TIME_FMT_);
  patrol.getRange(ds, PC.endTime, recs.length, 1).setNumberFormat(PATROL_TIME_FMT_);
  try { if (typeof sortPatrolLog_ === 'function') sortPatrolLog_(patrol); } catch (e) { log_('seedDemoPatrolLog_.sort', e); }
  return recs.length;
}

/**
 * Seed the Roster Signups review tab so it reflects the department: every FILLED member is shown as a Processed
 * signup (applied → approved → seated), plus a handful of fresh Pending applicants (IDs NOT on the roster) so the
 * review/approve flow has something to action. Sorted Pending→Processed. @return {{processed,pending}} rows written.
 */
function seedDemoSignups_(ss, memberRows, people) {
  const out = { processed: 0, pending: 0 };
  const nm = CONFIG.sheets.signups;
  if (!nm) return out;
  const sh = ss.getSheetByName(nm);
  if (!sh) return out;
  const SC = signupCols_(sh);
  if (!SC.status || !SC.name || !SC.discord) return out;
  const ds = SC.dataStart, W = SC.width;
  if (sh.getLastRow() >= ds) sh.getRange(ds, 1, sh.getLastRow() - ds + 1, W).clearContent(); // keep banner/header

  const recs = [];
  const mkRow = (o) => {
    const a = new Array(W).fill('');
    const put = (c, v) => { if (c) a[c - 1] = v; };
    put(SC.timestamp, o.ts); put(SC.name, o.name); put(SC.ooc, o.ooc); put(SC.discord, o.id);
    put(SC.email, o.email); put(SC.dob, o.dob); put(SC.phone, o.phone); put(SC.join, o.join);
    put(SC.status, o.status); put(SC.notes, o.notes || '');
    return a;
  };
  // Processed: one per filled member — they applied a few days before the join date they now carry.
  memberRows.forEach((m, i) => {
    const p = people[i];
    if (p.open) return;
    const j = (p.join instanceof Date) ? p.join : demoDay_(-30);
    const ts = new Date(j.getFullYear(), j.getMonth(), j.getDate() - (2 + (i % 6)), 9 + (i % 10), [0, 15, 30, 45][i % 4]);
    recs.push(mkRow({ ts: ts, name: p.name, ooc: demoOocName_(p.name), id: p.id, email: p.email, dob: p.dob, phone: demoPhone_(i), join: j, status: SIGNUP_STATUSES_[2], notes: 'Approved & seated' }));
    out.processed++;
  });
  // Pending: a few fresh applicants whose IDs are NOT on the roster, so they can actually be approved in the demo.
  const now = todayInSheetTz_();
  for (let k = 0; k < 4; k++) {
    const idx = 720 + k * 7, name = demoName_(idx);
    const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - k, 8 + k, [5, 25, 40, 50][k % 4]);
    recs.push(mkRow({ ts: ts, name: name, ooc: demoOocName_(name), id: demoId_(idx), email: demoEmail_(name), dob: demoDob_(idx), phone: demoPhone_(idx), join: '', status: SIGNUP_STATUSES_[0], notes: '' }));
    out.pending++;
  }
  if (!recs.length) return out;
  if (sh.getMaxRows() < ds + recs.length - 1) sh.insertRowsAfter(sh.getMaxRows(), ds + recs.length - 1 - sh.getMaxRows());
  if (SC.discord) sh.getRange(ds, SC.discord, recs.length, 1).setNumberFormat('@'); // ID exact BEFORE the write
  sh.getRange(ds, 1, recs.length, W).setValues(recs);
  if (SC.dob) sh.getRange(ds, SC.dob, recs.length, 1).setNumberFormat('d mmm yyyy');
  if (SC.join) sh.getRange(ds, SC.join, recs.length, 1).setNumberFormat('d mmm yyyy');
  if (SC.timestamp) sh.getRange(ds, SC.timestamp, recs.length, 1).setNumberFormat('d mmm yyyy h:mm am/pm');
  try { if (typeof sortSignups_ === 'function') sortSignups_(sh); } catch (e) { log_('seedDemoSignups_.sort', e); }
  return out;
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

    // Spread each RANK's filled members as evenly as possible across the 3 shifts (round-robin within the rank), and
    // rotate each rank's starting shift so any remainder doesn't always pile onto the same shift.
    (function assignShiftsByRank() {
      const SHIFTS = ['Days', 'Swings', 'Nights'];
      const seen = {}; // rank → count assigned so far
      const startAt = {}; // rank → starting offset (rotates per rank)
      let ranksSeen = 0;
      people.forEach((p, i) => {
        if (p.open) return;
        const rank = String(memberRows[i].rank || '').trim().toUpperCase();
        if (!(rank in seen)) { startAt[rank] = ranksSeen % SHIFTS.length; seen[rank] = 0; ranksSeen++; }
        p.shift = SHIFTS[(startAt[rank] + seen[rank]) % SHIFTS.length];
        seen[rank]++;
      });
    })();

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
      if (RC.email) roster.getRange(run.startRow, RC.email, len, 1).setValues(s.map((p) => [p.email]));
      if (RC.dob) roster.getRange(run.startRow, RC.dob, len, 1).setValues(s.map((p) => [p.dob])).setNumberFormat('d mmm yyyy'); // else a raw Date renders as a serial
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
      if (tracker.getLastRow() >= ts) tracker.getRange(ts, 1, tracker.getLastRow() - ts + 1, Math.max(tracker.getLastColumn(), 16)).clearContent();
      const leaves = [];
      memberRows.forEach((m, i) => {
        const p = people[i];
        if (p.open) return;
        const oi = { unit: String(calls[m.r - start][0] || '').trim(), ooc: demoOocName_(p.name), shift: p.shift }; // from the just-filled roster (skip a rescan per leave)
        const who = { id: p.id, rank: m.rank, name: p.name };
        if (p.leave) leaves.push({ m: who, L: p.leave, oi: oi });
        (p.pastLeaves || []).forEach((pl) => leaves.push({ m: who, L: { type: pl.type, from: pl.from, to: pl.to, status: CONFIG.expiredStatus || 'Expired' }, oi: oi }));
      });
      if (leaves.length && tracker.getMaxRows() < ts + leaves.length - 1) tracker.insertRowsAfter(tracker.getMaxRows(), ts + leaves.length - 1 - tracker.getMaxRows());
      leaves.forEach((x, i) => demoWriteLeave_(tracker, x.m, x.L, ts + i, x.oi));
      try { if (typeof sortTracker_ === 'function') sortTracker_(null, tracker); } catch (e) { log_('seedDemoRoster.sortTracker', e); } // group the demo leaves by status too
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

    // ---- PATROL LOG: valid sessions per member that sum to their current hours (log reconciles to the roster) ----
    let patrolCount = 0;
    try { patrolCount = seedDemoPatrolLog_(ss, memberRows, people, calls, start); } catch (e) { log_('seedDemoRoster.patrol', e); }

    // ---- SIGNUPS: every member reflects a processed signup; a few fresh Pending applicants left to review ----
    let signupInfo = { processed: 0, pending: 0 };
    try { signupInfo = seedDemoSignups_(ss, memberRows, people); } catch (e) { log_('seedDemoRoster.signups', e); }

    try { refreshDashboard_(); } catch (e) { log_('seedDemoRoster.dashboard', e); }
    try { if (typeof cpInvalidateHealth_ === 'function') cpInvalidateHealth_(); } catch (e) { /* Trust.gs may be absent */ }
    logInfo_('seedDemoRoster', `demo filled ${filledCount}/${total} member rows (${total - filledCount} open); ${leaveCount} leave record(s); ${patrolCount} patrol log(s); signups ${signupInfo.processed} processed + ${signupInfo.pending} pending; ${promoCount} promotion(s); stats ${statsFilled ? 'populated' : 'not found'}.`);
    ui.alert('🎬 Demo Roster Loaded',
      `Filled ${filledCount} of ${total} member rows with names, Discord IDs, join/promotion dates, hours and activity status — the other ${total - filledCount} are left as open positions.\n\n` +
      `• LOA/ROA Tracker — ${leaveCount} leave record(s): a few active, plus a deep history of expired leaves.\n` +
      (patrolCount ? `• Patrol Log — ${patrolCount} session(s); each member's logged hours add up to the hours shown on the roster.\n` : '') +
      (signupInfo.processed || signupInfo.pending ? `• Roster Signups — ${signupInfo.processed} processed (every member came through a signup) + ${signupInfo.pending} fresh Pending applicant(s) to review.\n` : '') +
      `• Added 4 weeks of activity-check history${statsFilled ? ', populated the stats sheet (employee counts + leadership)' : ''}${promoCount ? `, and seeded ${promoCount} recent promotions` : ''}.\n\n` +
      `Your ranks, callsigns, section dividers, colours and dropdowns were left untouched. Open 🎛️ Control Panel ▸ Signups to review the pending applicants.`,
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
  renderPromotions_(true); // full rescan — the demo may have just created/filled a promo table on a fresh workbook
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
