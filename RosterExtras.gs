/**
 * ============================================================================
 * ROSTER EXTRAS — optional add-ons for the core Roster System.
 * ----------------------------------------------------------------------------
 * Paste this as a SECOND file alongside RosterSystem.gs. It reuses the core's
 * CONFIG and helpers (getSheetOrWarn_, runAction_, log_/logWarn_/logInfo_,
 * clamp_, computeStatus_, parseHours_, isProtectedStatus_, isValidMemberValues_,
 * recomputeStatuses_, sendWebhookPayload_, footer_, todayInSheetTz_, startOfDay_).
 *
 * Adds: the hours-history + period-archive reset, group / Police Academy tab builders, the leave-coverage
 * view, the Activity Panel board, the data-integrity scan, and the demo-roster seeder.
 *
 * SETUP (after RosterSystem.gs is in and working): paste this file, save, then run
 * 📋 Roster ▸ 🔌 Install Triggers — the core installer calls installExtrasTriggers_ for the integrity
 * scan (7am), the coverage rebuild (6am) and the cadence-aware hours reset. There is no separate Extras
 * menu; its actions live in 👥 Roster (Capture & Reset Activity, Run Integrity Scan) and 🧪 Dev / QA
 * (Load Demo Roster).
 *
 * NOTE: edits are audited by auditEdit (RosterTrust.gs), which is always-on and self-installing.
 *   This file no longer carries a second edit logger — two of them double-logged.
 * ============================================================================
 */

/**
 * Extras settings. v1.0 — the tab names now resolve LIVE from [SHEETS] on ⚙️ Config (getters, so every existing
 * `EXTRAS.historySheet` read stays dynamic with zero call-site churn). Blank/absent config → the shipped default.
 */
const EXTRAS = Object.freeze({
  get historySheet() { return cfgSheetName_('hoursHistory', '_Hours History'); }, // hidden record of weekly hours
  get coverageSheet() { return cfgSheetName_('coverage', 'Leave Coverage'); },
  get activitySheet() { return cfgSheetName_('activity', ''); }, // '' = OFF (config default is 'Activity Panel'; the operator blanks the row to disable)
  get integritySheet() { return cfgSheetName_('integrity', 'Integrity Log'); },
});

/* ======================================================================
 * MENU & INSTALL
 * ====================================================================== */

// The Extras menu is retired — its actions moved into the 👥 Roster menu (Run Integrity Scan) and 🧪 Dev / QA
// (Load Demo Roster). The functions below still power the daily/6am triggers and those relocated menu items.

/**
 * Core: (re)install the extras time-driven triggers from [SCHEDULE] (integrity scan, coverage rebuild, cadence-aware
 * hours reset). No UI — returns a human description of the reset schedule. Shared by 📋 Roster ▸ Install Triggers.
 */
function installExtrasTriggers_() {
  const sc=cfg_().kv.ACTIVITY; // validate before altering existing triggers
  // 'dailyBackup' stays listed so re-running deletes any leftover backup trigger from earlier.
  // Reset cadence/day/hour come from [SCHEDULE] on ⚙️ Config (defaults WEEKLY · SUN · 23 — the classic schedule).
  // Resolved G1: the reset captures the hours-history tab BEFORE zeroing, so the panel sparkline survives.
  let day = 'SUN', hour = 23, cadence = 'WEEKLY', dom = 1, autoReset = true;
  day=sc.WEEKLY_HOURS_RESET;hour=sc.WEEKLY_RESET_HOUR;cadence=sc.RESET_CADENCE;dom=sc.RESET_DOM;autoReset=sc.AUTO_RESET!==false;
  const weekDays = { SUN: ScriptApp.WeekDay.SUNDAY, MON: ScriptApp.WeekDay.MONDAY, TUE: ScriptApp.WeekDay.TUESDAY, WED: ScriptApp.WeekDay.WEDNESDAY, THU: ScriptApp.WeekDay.THURSDAY, FRI: ScriptApp.WeekDay.FRIDAY, SAT: ScriptApp.WeekDay.SATURDAY };
  let resetDesc;
  replaceManagedTriggers_(['dailyBackup','scanIntegrity','buildCoverage','weeklyResetScheduled'],add=>{
  add(ScriptApp.newTrigger('scanIntegrity').timeBased().atHour(7).everyDays(1).create());
  add(ScriptApp.newTrigger('buildCoverage').timeBased().atHour(6).everyDays(1).create());
  // v1.0 — cadence-aware reset trigger. MANUAL (or WEEKLY_HOURS_RESET=OFF) installs no trigger. MONTHLY fires on
  // RESET_DOM. WEEKLY/BIWEEKLY fire weekly on the chosen weekday; the handler (resetDue_) gates BIWEEKLY to ~14 days
  // apart via the LAST_RESET marker, so Apps Script's lack of a native bi-weekly trigger doesn't matter.
  resetDesc = autoReset ? 'OFF (no auto-reset)' : 'OFF (auto-reset switched off in Settings)';
  if (autoReset && cadence !== 'MANUAL' && (cadence === 'MONTHLY' || day !== 'OFF')) {
    if (cadence === 'MONTHLY') {
      add(ScriptApp.newTrigger('weeklyResetScheduled').timeBased().onMonthDay(dom).atHour(hour).create());
      resetDesc = `MONTHLY (day ${dom}, ${hour}:00)`;
    } else {
      add(ScriptApp.newTrigger('weeklyResetScheduled').timeBased().onWeekDay(weekDays[day] || ScriptApp.WeekDay.SUNDAY).atHour(hour).create());
      resetDesc = `${cadence} (${day} ${hour}:00)`;
    }
  }
  });
  logInfo_('installExtrasTriggers_', `extras triggers installed (reset: ${resetDesc}).`);
  return resetDesc;
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
  const keys = tracker.getRange(CONFIG.trackerStartRow, TC.key, n, 1).getDisplayValues();
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
      submitted: Number((String(keys[i][0]).match(/^KEY\|[^|]*\|(\d{10,})$/)||[])[1])||start.getTime(),
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

/** Posts a simple summary embed to the AUDIT channel (no-op if none set). House style: the title renders as a "# "
 *  markdown heading at the top of the DESCRIPTION (so a boxed `emoji` in it renders — native titles can't). */
function postSummary_(title, description, color) {
  sendWebhookPayloadCh_('AUDIT', {
    embeds: [{
      description: clamp_('# ' + String(title || '') + '\n' + String(description || ''), 4000),
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
  return supportSheetLock_(()=>{
  const ss = SpreadsheetApp.getActive();
  const roster = getSheetOrWarn_(ss, CONFIG.sheets.roster);
  if (!roster) return 0;
  let sh = ss.getSheetByName(EXTRAS.historySheet);
  if (!sh) {
    sh = ss.insertSheet(EXTRAS.historySheet);
    sh.hideSheet();
    sh.getRange(1, 1, 1, 6).setValues([['WeekOf', 'DiscordID', 'Name', 'Rank', 'Hours', 'Status']]).setFontWeight('bold');
    styleStartupSupportSheet_(sh,['WeekOf','DiscordID','Name','Rank','Hours','Status']);
  }
  const when = weekLabel || weekKey_();
  const members = readMembers_(roster);
  if (!members.length) return 0;
  // Append and flush the replacement BEFORE deleting the prior week's snapshot. A failed append must not
  // destroy the only existing record. Remove prior rows in contiguous runs, excluding the new batch.
  const previousLast=sh.getLastRow();
  const rows = members.map((m) => [when, m.id, m.name, m.rank, parseHours_(m.hours), m.activity]);
  const startRow = previousLast + 1, requiredRows = startRow+rows.length-1;
  ensureSupportRoom_(sh,requiredRows,6);
  sh.getRange(startRow, 2, rows.length, 1).setNumberFormat('@');
  sh.getRange(startRow, 1, rows.length, 6).setValues(rows.map(r=>r.map(v=>typeof v==='string' && v.startsWith('=') ? "'"+v : v)));
  SpreadsheetApp.flush();
  if (previousLast >= 2) {
    const weeks = sh.getRange(2, 1, previousLast - 1, 1).getValues();
    const weekOf=value=>value instanceof Date?fmtDate_(value):String(value).trim();
    const wk = weekOf(when);
    let r = weeks.length - 1;
    while (r >= 0) {
      if (weekOf(weeks[r][0]) !== wk) { r--; continue; }
      let top = r;
      while (top - 1 >= 0 && weekOf(weeks[top - 1][0]) === wk) top--;
      sh.deleteRows(top + 2, r - top + 1);
      r = top - 1;
    }
  }
  // F-024: cap growth like the sibling Integrity/Edit logs — trim the oldest rows so the sheet can't grow unbounded.
  const CAP = logRowCap_(); // v1.0: configurable
  const keep=Math.max(CAP,rows.length); // the complete current roster snapshot survives even when it exceeds the retention cap
  sortSupportRows_(sh,1,6,'week');
  trimSupportRows_(sh,keep);
  ensureSupportFilter_(sh,Math.max(6,sh.getLastColumn()));
  logInfo_('captureHoursSnapshot_', `captured ${rows.length} member-hours for week ${when}.`);
  return rows.length;
  });
}

/**
 * Period label for the archive column just captured, from [SCHEDULE].RESET_CADENCE + the date. Always ends in
 * "HOURS" so the archive auto-detector keeps finding the column after it's relabelled.
 *   MONTHLY → "JUL HOURS" (the month being closed; an early-in-month capture labels the month that just ended)
 *   WEEKLY / BIWEEKLY → "13 JUL HOURS" (the period-ending date)
 */
function periodLabel_() {
  const tz = ssTz_();
  let cad = 'MONTHLY', fmt = '', bucket = 'RESET';
  try {
    const sc = cfg_().kv.ACTIVITY;
    cad = String(sc.RESET_CADENCE || 'MONTHLY').toUpperCase();
    fmt = String(sc.PERIOD_LABEL_FORMAT || '').trim();   // operator override; blank = the cadence's own shape
    bucket = String(sc.PERIOD_BUCKET || 'RESET').toUpperCase();
  } catch (e) { /* config broken → monthly */ }
  // WHICH date the period is named after is the cadence's call; HOW it reads is the operator's.
  const now = todayInSheetTz_();
  let when = now, auto = 'd MMM';                        // weekly / bi-weekly → the period-ENDING date
  if (cad === 'MONTHLY') {
    const d = new Date(now);
    if (d.getDate() <= 7) d.setDate(0);                  // just after a month boundary → label the month that ended
    when = d; auto = 'MMM';
  } else if (bucket === 'MONTH') {
    // Monthly buckets under a weekly/bi-weekly check: the column is named for the month the check RUNS in, with
    // no previous-month grace — checks land ~4x a month, so the first one of a month legitimately opens it.
    auto = 'MMM';
  }
  let text;
  try { text = Utilities.formatDate(when, tz, fmt || auto); }
  catch (e) { // a bad pattern must never block a capture — fall back and say so
    logWarn_('periodLabel_', `[SCHEDULE].PERIOD_LABEL_FORMAT "${fmt}" is not a valid date pattern — using the automatic ${cad} label instead.`);
    text = Utilities.formatDate(when, tz, auto);
  }
  text = String(text).toUpperCase().trim();
  // shiftArchiveColumns_ finds the period columns by the word HOURS in their header, so a custom label that omits
  // it would drop that column out of the rolling set on the NEXT capture. Append it rather than let that happen.
  return /HOURS/.test(text) ? text : (text + ' HOURS');
}

/**
 * Rolling archive: before hours are zeroed, shift the visible period columns (every "* HOURS" column EXCEPT the
 * primary HOURS) one to the LEFT — each takes the next one's data + header, the oldest drops off the visible set,
 * and the rightmost receives the current HOURS under `periodLabel`. No visible archive columns → a no-op (the
 * hidden history tab still keeps the record). @return {number} archive columns shifted.
 */
function shiftArchiveColumns_(roster, periodLabel, accumulate) {
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
  // MONTHLY BUCKETS: the rightmost column already belongs to this period (same label) → this check's hours are
  // ADDED to it and nothing rolls. That is what turns four weekly 5-hour checks into one 20-hour month column;
  // the roll happens only when the label changes, i.e. when the month does.
  const lastArch = archive[archive.length - 1];
  if (accumulate && norm_(hdr[lastArch - 1]) === norm_(periodLabel)) {
    const ranks = roster.getRange(startRow, RC.rank, n, 1).getValues();
    const names = roster.getRange(startRow, RC.name, n, 1).getValues();
    const prior = roster.getRange(startRow, lastArch, n, 1).getValues();
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!isValidMemberValues_(ranks[i][0], names[i][0])) { out.push([prior[i][0]]); continue; } // dividers/empty slots keep whatever they hold
      const was = parseHours_(prior[i][0]) || 0, add = parseHours_(curHours[i][0]) || 0;
      const sum = Math.round((was + add) * 100) / 100;
      out.push([(sum === 0 && String(prior[i][0]).trim() === '' && String(curHours[i][0]).trim() === '') ? '' : sum]);
    }
    roster.getRange(startRow, lastArch, n, 1).setValues(out);
    return 0; // nothing rolled — the caller reports an accumulation instead
  }
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

/** The header currently on the RIGHTMOST period column ('' when the tab has none) — used to tell an accumulation apart from a roll. */
function archiveRightHeader_(roster) {
  try {
    const RC = rosterCols_(roster);
    if (!RC.hours || !RC.headerRow) return '';
    const lastCol = roster.getLastColumn();
    const hdr = roster.getRange(RC.headerRow, 1, 1, lastCol).getDisplayValues()[0];
    let out = '';
    for (let c = 1; c <= lastCol; c++) {
      if (c === RC.hours) continue;
      if (String(hdr[c - 1] || '').toUpperCase().indexOf('HOURS') !== -1) out = String(hdr[c - 1]);
    }
    return out;
  } catch (e) { return ''; }
}

/** Core reset: archive-shift, capture history, then zero + recompute. Locked; no UI (safe from triggers). */
function doWeeklyReset_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) raise_('E-503');
  let primary;
  try {
    const ss = SpreadsheetApp.getActive();
    const roster = getSheetOrWarn_(ss, CONFIG.sheets.roster);
    if (!roster) return;
    assertNoPendingRosterRecovery_(roster,'Activity reset');
    const resetProps = PropertiesService.getDocumentProperties(), resetKey = 'RE_ACTIVITY_RESET_PENDING';
    const saved = resetProps.getProperty(resetKey);
    if (saved) {
      let pending;
      try { pending=JSON.parse(saved); } catch (e) { throw new Error('Activity-reset checkpoint is unreadable. Inspect it before resetting again.'); }
      if (!pending || pending.book !== ss.getId() || pending.sheet !== roster.getSheetId()) throw new Error('Activity-reset checkpoint belongs to a different roster. Inspect it before resetting again.');
      if (pending.phase === 'committed' && pending.summary) {
        resetProps.setProperty(LAST_RESET_PROP,String(pending.started));
        resetProps.deleteProperty(resetKey);
        return Object.assign({},pending.summary,{recovered:true}); // acknowledge a completed reset; never roll/zero twice
      }
      throw new Error('An activity reset stopped during '+String(pending.phase || 'an unknown phase')+'. Current hours have not been safely reconciled. Review the hours-history snapshot and archive columns before clearing RE_ACTIVITY_RESET_PENDING; do not rerun blindly.');
    }
    const checkpoint = {book:ss.getId(),sheet:roster.getSheetId(),started:Date.now(),phase:'history'};
    const stage = phase => { checkpoint.phase=phase; resetProps.setProperty(resetKey,JSON.stringify(checkpoint)); };
    stage('history'); // persist BEFORE any non-atomic history/archive mutations
    const captured = captureHoursSnapshot_() || 0; // preserve history BEFORE zeroing
    const before = readMembers_(roster);
    stage('archive');
    let shifted = 0, bucketLabel = '', accumulated = false; // roll the visible period columns BEFORE hours are zeroed
    try {
      // [SCHEDULE].PERIOD_BUCKET = MONTH → checks inside one month ADD into that month's column instead of
      // rolling a fresh column each time (weekly checks, monthly archive totals).
      let acc = false;
      acc = String(cfg_().kv.ACTIVITY.PERIOD_BUCKET || 'RESET').toUpperCase() === 'MONTH';
      bucketLabel = periodLabel_();
      const rightHdrBefore = acc ? archiveRightHeader_(roster) : ''; // NOT `before` — that is the member snapshot above
      shifted = shiftArchiveColumns_(roster, bucketLabel, acc);
      accumulated = acc && !shifted && norm_(rightHdrBefore) === norm_(bucketLabel);
    } catch (e) { log_('doWeeklyReset_.archive', e); throw e; }
    // LAST ACTIVITY must snapshot each member's status AS THE PERIOD CLOSED — i.e. BEFORE the recompute below
    // re-tiers everyone off zeroed hours. (This was the whole point of the column and was never wired in here.)
    let lastAct = -1;
    stage('previous activity');
    try {
      if (typeof captureLastActivityCore_ === 'function') lastAct = captureLastActivityCore_(roster);
      // [ACTIVITY].LAST_ACTIVITY_STYLE (MATCH / NEUTRAL) is applied HERE, on the capture that actually runs. Its only
      // caller used to be a "📸 Capture Last Activity" menu item that no longer exists, so the setting did nothing at
      // all — you could switch it in Settings and the column never changed.
      if (lastAct >= 0 && typeof ensureLastActivityFormat_ === 'function' && typeof lastActivityCols_ === 'function') {
        lastActivityCols_(roster).forEach((c) => { try { ensureLastActivityFormat_(roster, c); } catch (e2) { log_('doWeeklyReset_.laStyle', e2); } });
      }
    } catch (e) { log_('doWeeklyReset_.lastActivity', e); throw e; }
    stage('hours and statuses');
    recomputeStatuses_(roster, true);     // core function: zero + recompute
    SpreadsheetApp.flush();
    const after = readMembers_(roster);
    const prev = {};
    before.forEach((m) => { prev[m.id] = m.activity; });
    const lowestTier = CONFIG.tierNames.length ? CONFIG.tierNames[CONFIG.tierNames.length - 1] : 'Inactive';
    const dropped = after.filter((m) => m.activity === lowestTier && prev[m.id] !== lowestTier);
    const totalHours = before.reduce((s, m) => s + parseHours_(m.hours), 0); // hoisted: used by the digest AND the return summary
    const activeCount = after.filter((m) => m.activity !== lowestTier).length;
    const summary = { captured:captured,shifted:shifted,accumulated:accumulated,periodLabel:bucketLabel,lastActivity:lastAct,total:after.length,droppedNames:dropped.map(m=>m.name),lowestTier:lowestTier,totalHours:totalHours };
    checkpoint.summary=Object.assign({},summary,{droppedNames:summary.droppedNames.slice(0,20).map(n=>String(n).slice(0,128))});
    stage('committed');
    resetProps.setProperty(LAST_RESET_PROP,String(checkpoint.started));
    resetProps.deleteProperty(resetKey);
    logInfo_('doWeeklyReset_', `reset complete; ${dropped.length} dropped to ${lowestTier}.`);
    if (CONFIG.notify && CONFIG.notify.weeklyDigest) { // v1.0 richer opt-in digest supersedes the basic reset notice
      notifyCh_('AUDIT', true, {
        color: hexToInt_(CONFIG.notify.digestColor, 5793266),
        description: `# ${fill_(CONFIG.notify.digestTitle, {})}\nHours have been zeroed and statuses recomputed for the new period.`,
        fields: [
          { name: '`👥` Roster', value: `${after.length} member(s)`, inline: true },
          { name: '`🟢` Active', value: `${activeCount}`, inline: true },
          { name: '`🔻` Dropped', value: `${dropped.length} → ${lowestTier}`, inline: true },
          { name: '`⏱️` Hours Logged', value: `${Math.round(totalHours * 10) / 10} hrs this period`, inline: true },
        ],
      });
    } else {
      postSummary_('`🗑️` Weekly Reset', `Hours zeroed and statuses recomputed. **${dropped.length}** member(s) dropped to ${lowestTier}.`, 15105570);
    }
    return summary;
  } catch (e) {
    primary=e; throw e;
  } finally {
    try { lock.releaseLock(); } catch (e) { if (primary) log_('doWeeklyReset_.release',e); else throw e; }
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
    const laLine = res.lastActivity === -1 ? 'No LAST ACTIVITY column (add one to snapshot closing statuses)' : `LAST ACTIVITY snapshotted for ${res.lastActivity} member(s)`;
    const archLine = res.accumulated
      ? `Hours ADDED into the “${res.periodLabel}” column (monthly totals — columns roll when the month changes)`
      : (res.shifted ? `${res.shifted} period column${res.shifted === 1 ? '' : 's'} rolled forward` : 'No visible period columns (history-only)');
    ui.alert(`✅ Activity captured & reset.\n\n• ${archLine}\n• ${res.captured} member-hours saved to history\n• ${laLine}\n• ${res.total} member(s) recomputed\n• ${dn.length} dropped to ${res.lowestTier}${sample}\n• ${Math.round(res.totalHours * 10) / 10} hrs logged this period`);
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
 * floors). MANUAL never runs from the trigger. An unreadable config or cadence marker stops the reset to protect member hours.
 */
/** One-time bound-project migration. Library callers must never inherit another department's shared legacy clock. */
function lastResetMarker_() {
  const doc = PropertiesService.getDocumentProperties();
  const current = doc.getProperty(LAST_RESET_PROP);
  if (current != null) return current;
  if (doc.getProperty('RE_RUNTIME_MODE') !== 'BOUND') return null;
  const legacy = PropertiesService.getScriptProperties().getProperty(LAST_RESET_PROP);
  if (legacy != null) {
    const timestamp = Number(legacy);
    if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('Legacy hours-reset timestamp is invalid.');
    doc.setProperty(LAST_RESET_PROP,String(timestamp));
  }
  return legacy;
}
function resetDue_() {
  try {
    const sc = cfg_().kv.ACTIVITY;
    // The weekly OFF setting disables weekly/biweekly resets; monthly resets use RESET_DOM instead.
    // Check live settings at runtime too, so changes take effect before triggers are reinstalled.
    if (sc.AUTO_RESET === false) return false; // the master switch — checked FIRST, and at run time so flipping it
    const cad = sc.RESET_CADENCE;
    if (sc.WEEKLY_HOURS_RESET === 'OFF' && cad !== 'MONTHLY') return false; // monthly uses RESET_DOM, not a weekday
    if (cad === 'MANUAL') return false;
    if (cad === 'WEEKLY') return true;
    const marker=lastResetMarker_();
    const last=Number(marker||0);
    if(!Number.isFinite(last)||last<0)throw new Error('The last-reset marker is invalid; member hours were left unchanged.');
    if (!last) return true; // never reset before → run now
    const days = (Date.now() - last) / 86400000;
    if (cad === 'BIWEEKLY') return days >= 13; // ~2 weeks (13-day floor absorbs weekly-trigger jitter)
    if (cad === 'MONTHLY') return days >= 25;  // ~1 month (25-day floor guards against a double-fire)
    return true;
  } catch (e) { log_('resetDue_',e);return false; }
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
 *   "#group: … | A, B, C"               after the "|", legacy extra-column hints; destination headers determine which columns are mirrored
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
function groupValueMatches_(value,wanted) { const v=groupNorm_(value), w=groupNorm_(wanted); return !!w && (v===w || v.indexOf(w+' ')===0); }
/** Ambiguous identities must never overwrite another member's custom fields. */
function groupIdentityProblem_(rows,keyCol,nameCol,location) {
  const seen=Object.create(null);
  const at=i=>location?' on "'+location.sheet+'" row '+(location.start+i)+' ('+groupColLetter_(location.key||keyCol)+(location.start+i)+')':'';
  for (let i=0;i<rows.length;i++) {
    if (!String(rows[i][nameCol-1]||'').trim()) continue;
    const key=String(rows[i][keyCol-1]||'').trim();
    if (!key) return 'a named member has no matching identity'+at(i);
    if (seen[key]!==undefined) return 'duplicate matching identity: '+key+at(i)+(location?'; first found'+at(seen[key]):'');
    seen[key]=i;
  }
  return '';
}

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
    if (!(label in out)) out[label] = { top: top, bottom: bottom, ranges:[] };
    out[label].ranges.push({top:top,bottom:bottom});
    out[label].top = Math.min(out[label].top, top); out[label].bottom = Math.max(out[label].bottom, bottom);
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

/** Refresh editable group rows inside operator-owned layouts. Fixed bands must have enough capacity. */
function derivedWriteRows_(sheet,row,col,rows) {
  if(!rows.length)return;
  sheet.getRange(row,col,rows.length,rows[0].length).setValues(rows.map(r=>r.map(v=>v&&v.derivedFormula?'':(typeof v==='string'&&v.charAt(0)==='='?"'"+v:v))));
  rows.forEach((values,r)=>values.forEach((value,c)=>{if(value&&value.derivedFormula)sheet.getRange(row+r,col+c).setFormulaR1C1(value.derivedFormula);}));
}
function derivedReport_(where,result) {
  if(typeof logWarn_==='function') (result.skipped||[]).forEach(item=>logWarn_(where,item.name+': '+item.why));
  if(typeof diagnosticNotice_==='function') (result.inactive||[]).forEach(item=>diagnosticNotice_('INFO','',where,item.name+': '+item.why,21600));
  return result;
}
function withDerivedLock_(fn) {
  const lock=LockService.getScriptLock(), held=lock.hasLock();
  if(!held&&!lock.tryLock(1000))throw new Error('Derived roster refresh is busy; queued refresh will retry.');
  try{return fn();}finally{if(!held)lock.releaseLock();}
}
function buildGroupSheets_(hint) { return withDerivedLock_(()=>derivedReport_("buildGroupSheets_",buildGroupSheetsCore_(hint))); }
function buildGroupSheetsCore_(hint) { // optional hint rebuilds only affected tabs
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
  // Mirror checkbox values as booleans when the destination has checkbox validation, otherwise as glyphs.
  const cbSet = {}; checkboxOffsets_(roster, start, firstCol, rosterWidth).forEach((off) => { cbSet[firstCol + off] = true; });
  const nameRange = rName + '!' + L(RC.name) + start + ':' + L(RC.name);
  // The roster's RANK GROUP column (merged bands) — header "RANK … GROUP", else the column just left of RANK.
  let rosterBandCol = 0;
  for (let c = 0; c < rHdrUp.length; c++) { if (rHdrUp[c].indexOf('RANK') !== -1 && rHdrUp[c].indexOf('GROUP') !== -1) { rosterBandCol = c + 1; break; } }
  if (!rosterBandCol && RC.rank > 1) rosterBandCol = RC.rank - 1;
  const firstColRange = rName + '!' + L(firstCol) + start + ':' + L(firstCol); // for ROW() row-range tests
  const rosterRanges = rosterBandRanges_(roster, rosterBandCol); // group label → roster row range
  const nRg = Math.max(0, roster.getLastRow() - start + 1);
  // Keep physical row offsets for rank-band placement, but exclude layout rows exactly
  // as the roster/member panel does. A footer or divider is not a member missing an ID.
  const rd = nRg ? roster.getRange(start, 1, nRg, lastCol).getDisplayValues().map(row=>isValidMemberValues_(row[RC.rank-1],row[RC.name-1])?row:new Array(lastCol).fill('')) : [];
  // Don't touch the roster or the engine's own system tabs.
  const sysNames = {};
  Object.keys(CONFIG.sheets || {}).forEach((k) => { if (CONFIG.sheets[k]) sysNames[String(CONFIG.sheets[k]).toUpperCase()] = true; });
  ['CONTROL PANEL', 'CONFIG', '⚙️ CONFIG', 'DEV / QA', 'DEV/QA', 'DASHBOARD'].forEach((n) => { sysNames[n] = true; });
  const groupNoun = /(shift|division|troop|district|squad|platoon|precinct|watch|beat|sector|zone)/i; // NB: "academy" is handled by buildAcademySheets_ (editable), not here
  const built = [];
  const skipped = [];
  const inactive = [];
  ss.getSheets().forEach((sh) => {
    if (sh.getSheetId() === roster.getSheetId()) return;
    const nm = sh.getName();
    if (sysNames[nm.toUpperCase()]) return;
    if (isAcademyTab_(sh)) return; // the Academy has its own builder (graduate log); this handles the assignment/group tabs
    const marker = groupMarker_(sh);
    // A tab counts as a group tab if it has an explicit marker OR its name reads like a group.
    if (!marker && !groupNoun.test(nm)) return;
    const grp = marker ? { column: marker.column, values: marker.values } : inferGroup_(nm);
    // Named column first; if that header no longer exists (e.g. SHIFT renamed to ASSIGNMENT), fall back to the
    // value scan — the tab keeps working across a rename instead of silently emptying.
    const gCol = (grp.column ? colFor(grp.column) : 0) || (/^(shift|assignment|division|district|watch)$/i.test(grp.column||'') ? RC.shift : 0) || findGroupColumn_(roster, start, grp.values[0]);
    if(!gCol&&Array.isArray(CONFIG.shiftKeywords)&&!CONFIG.shiftKeywords.length&&/^(shift|assignment|division|district|watch)$/i.test(grp.column||'')){
      inactive.push({name:nm,why:'Assignment grouping is off ([ROSTER_LAYOUT].SHIFT_HEADER is blank). Existing rows retained; configure the department\'s actual heading or update its #group marker to enable this view.'});
      return;
    }
    // FAST PATH (targeted rebuild): with a single-cell edit hint, skip a tab the edited member is neither in NOW nor
    // WAS in — only the old + new value of the edited cell can change their group membership, so every other tab is
    // untouched by this edit. Skipped before the tab's own reads, so a single move rebuilds ~1-2 tabs, not all of them.
    // (The 1-minute sweep runs a FULL rebuild as the backstop, so anything this skips still self-heals.)
    if (gCol && hint && hint.rowVals) {
      const gvN = grp.values.map((v) => groupNorm_(v)).filter(Boolean);
      const cur = groupNorm_(gCol <= hint.rowVals.length ? (hint.rowVals[gCol - 1] || '') : '');
      const isNow = gvN.some((v) => groupValueMatches_(cur,v));
      const wasBefore = (hint.editedCol === gCol) && gvN.some((v) => groupValueMatches_(hint.oldVal||'',v));
      if (!isNow && !wasBefore) return; // this tab is unaffected by the edit
    }
    // Find where the member rows begin on THIS tab (right below its own RANK/NAME header row) — never assume a position.
    const hdr = groupHeaderRow_(sh);
    if (!hdr.row) { skipped.push({ name: nm, why: 'no RANK/NAME header row found — lay out the columns first' }); return; }
    let rankTabCol = 0;
    for (let i = 0; i < hdr.headers.length; i++) { const h = hdr.headers[i]; if (h.indexOf('RANK') !== -1 && h.indexOf('GROUP') === -1) { rankTabCol = i + 1; break; } }
    if (!rankTabCol) rankTabCol = 1;
    if (!gCol) {
      const why=grp.column
        ? 'No roster column matches "'+grp.column+'" for '+(marker ? '#group: '+marker.raw : nm)+'. Set the marker column to the actual roster heading'+(/^(shift|assignment|division|district|watch)$/i.test(grp.column) ? ' or add that heading to [ROSTER_LAYOUT].SHIFT_HEADER' : '')+'. Keep the department\'s actual values ('+grp.values.join(', ')+'); changing them does not fix a missing column. Existing rows left unchanged.'
        : 'No roster column contains "'+grp.values.join(', ')+'". Use an explicit marker such as "'+suggestMarker_(nm)+'" with the actual roster heading and values. Existing rows left unchanged.';
      skipped.push({ name:nm, why }); return;
    }
    const dataRow = hdr.row + headerToData; // skip the same divider gap the roster leaves below its header (member rows start there)
    // EDITABLE UPSERT (replaces the old read-only FILTER): mirror the roster's columns onto the tab BY HEADER, keep
    // one row per matching member (matched by UNIQUE ID / NAME so the operator's edits stay put), and PRESERVE every
    // column the tab has that the roster does NOT (their own fields — e.g. a K9 dog's name). Members drop into the
    // tab's RANK GROUP bands by the roster's own band structure; anyone who leaves the group is removed.
    let tabLastCol = rankTabCol;
    for (let i = hdr.headers.length - 1; i >= rankTabCol - 1; i--) { if (String(hdr.headers[i] || '').trim() !== '') { tabLastCol = i + 1; break; } }
    const fillW = Math.min(tabLastCol - rankTabCol + 1, sh.getMaxColumns() - rankTabCol + 1);
    if (fillW <= 0) { skipped.push({ name: nm, why: 'not enough columns to the right of RANK' }); return; }
    // tab column → roster column (0 = a column the roster doesn't have → operator-owned, preserved & never overwritten).
    const colMap = {};
    for (let tc = rankTabCol; tc < rankTabCol + fillW; tc++) colMap[tc] = colForTab(hdr.headers[tc - 1] || '');
    let tabIdCol = 0, tabNameCol = 0;
    for (let tc = rankTabCol; tc < rankTabCol + fillW; tc++) { if (colMap[tc] === RC.discord && !tabIdCol) tabIdCol = tc; if (colMap[tc] === RC.name && !tabNameCol) tabNameCol = tc; }
    const useId = !!(tabIdCol && RC.discord);
    const keyTabCol = useId ? tabIdCol : tabNameCol;
    if (!keyTabCol) { skipped.push({ name: nm, why: 'no NAME or UNIQUE ID column to match members by' }); return; }
    // The tab's RANK GROUP band column (label often merged across banner+label rows → scan both; else col left of RANK).
    const topHdr = hdr.row > 1 ? sh.getRange(hdr.row - 1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0].map((x) => String(x).toUpperCase()) : [];
    let tabBandCol = 0;
    for (let i = 0; i < Math.max(hdr.headers.length, topHdr.length); i++) {
      const combined = (hdr.headers[i] || '') + ' ' + (topHdr[i] || '');
      if (combined.indexOf('RANK') !== -1 && combined.indexOf('GROUP') !== -1) { tabBandCol = i + 1; break; }
    }
    if (!tabBandCol && rankTabCol > 1) tabBandCol = rankTabCol - 1;
    const maxRows = sh.getMaxRows();
    const bands = tabBandRanges_(sh, dataRow, tabBandCol);
    // Which of THIS tab's fill columns are REAL checkboxes → write/keep them as booleans, never "☑/☐" TEXT (which
    // violates the checkbox rule and shows the red "invalid" flag). Detected BEFORE clearing, while validations exist.
    const tabCb = {}; checkboxOffsets_(sh, dataRow, rankTabCol, fillW).forEach((off) => { tabCb[rankTabCol + off] = true; });
    // PRESERVE the operator's own columns: read the current body keyed by ID/NAME BEFORE clearing anything. Bound the
    // read to the last row with real content, not all ~1000 grid rows — every member + operator value lives at/above it.
    const readTo = Math.min(Math.max(sh.getLastRow(), dataRow - 1), maxRows);
    const bodyN = Math.max(0, readTo - dataRow + 1);
    const existVals = bodyN ? sh.getRange(dataRow, rankTabCol, bodyN, fillW).getValues() : [];
    const existFormulas = bodyN ? sh.getRange(dataRow, rankTabCol, bodyN, fillW).getFormulasR1C1() : [];
    const existKeys = bodyN ? sh.getRange(dataRow, keyTabCol, bodyN, 1).getDisplayValues() : [];
    existVals.forEach((row,i)=>{row[keyTabCol-rankTabCol]=String(existKeys[i][0]||'').trim();});
    const identityProblem = groupIdentityProblem_(rd,useId?RC.discord:RC.name,RC.name,{sheet:roster.getName(),start,key:useId?RC.discord:RC.name}) || groupIdentityProblem_(existVals,keyTabCol-rankTabCol+1,tabNameCol-rankTabCol+1,{sheet:nm,start:dataRow,key:keyTabCol});
    if (identityProblem) { skipped.push({name:nm,why:identityProblem+' — existing rows left unchanged'}); return; }
    existFormulas.forEach((row,r)=>row.forEach((formula,c)=>{ if(formula&&!colMap[rankTabCol+c]) existVals[r][c]={derivedFormula:formula}; }));
    const existByKey = Object.create(null);
    for (let i = 0; i < existVals.length; i++) { const k = String(existKeys[i][0] || '').trim(); if (k && existVals[i].some((c) => String(c || '').trim() !== '')) existByKey[k] = existVals[i].slice(); }
    const blankRow = () => new Array(fillW).fill('');
    const keyOfIdx = (i) => (useId ? String(rd[i][RC.discord - 1] || '') : String(rd[i][RC.name - 1] || '')).trim();
    const boolish = (v) => (v === true || v === '☑' || String(v).trim().toUpperCase() === 'TRUE'); // ☑/☐ text, "TRUE"/"FALSE", or a real bool → strict bool
    const rowForIdx = (i) => { // preserved custom columns + mirrored roster columns
      const k = keyOfIdx(i);
      const row = (k && existByKey[k]) ? existByKey[k].slice() : blankRow();
      while (row.length < fillW) row.push('');
      for (let tc = rankTabCol; tc < rankTabCol + fillW; tc++) {
        const rc = colMap[tc];
        if (rc) { // mirrored roster column
          if (cbSet[rc]) { const checked = String(rd[i][rc - 1]).trim().toUpperCase() === 'TRUE'; row[tc - rankTabCol] = tabCb[tc] ? checked : (checked ? '☑' : '☐'); } // real checkbox on the tab → bool; else pretty text
          else row[tc - rankTabCol] = String(rd[i][rc - 1] == null ? '' : rd[i][rc - 1]);
        } else if (tabCb[tc]) {
          row[tc - rankTabCol] = boolish(row[tc - rankTabCol]); // operator's OWN checkbox column: keep their state, but as a valid bool (no red flag)
        }
        // else: operator-owned non-checkbox column → keep whatever they typed
      }
      return row;
    };
    // Selected members: named AND matching the group value (starts-with, case/space-tolerant), in roster order.
    const gvals = grp.values.map((v) => groupNorm_(v)).filter(Boolean);
    const selected = [];
    for (let i = 0; i < rd.length; i++) {
      if (String(rd[i][RC.name - 1] || '').trim() === '') continue;
      const cell = groupNorm_(rd[i][gCol - 1] || '');
      if (gvals.some((v) => groupValueMatches_(cell,v))) selected.push(i);
    }
    const bandLabelOfRow = (rrow) => { for (const lbl in rosterRanges) { if (rosterRanges[lbl].ranges.some((range)=>rrow>=range.top&&rrow<=range.bottom)) return groupNorm_(lbl); } return ''; };
    if(bands.length&&!Object.keys(rosterRanges).length){skipped.push({name:nm,why:"destination has rank bands but roster bands are missing — existing rows left unchanged"});return;}
    const byBand = Object.create(null);
    if (bands.length && Object.keys(rosterRanges).length) {
      bands.forEach((b)=>{if(!byBand[groupNorm_(b.label)])byBand[groupNorm_(b.label)]=[];});
      const unassigned=[];
      selected.forEach((i)=>{const label=bandLabelOfRow(start+i);if(label in byBand)byBand[label].push(i);else unassigned.push(i);});
      const repeated=bands.some((b,i)=>bands.slice(0,i).some((other)=>groupNorm_(other.label)===groupNorm_(b.label)));
      const overflow=bands.some((b)=>(byBand[groupNorm_(b.label)]||[]).length>b.height);
      if(repeated||overflow||unassigned.length){skipped.push({name:nm,why:'rank bands are duplicated, too small, or missing for matching members — existing rows left unchanged'});return;}
    }
    // Clear the member area (content + merges) — NEVER data validations, so the operator's own checkboxes/dropdowns on
    // their columns survive; then '@' the ID column so long IDs write exact. Column B (your bands) is never touched.
    if (maxRows >= dataRow) { const area = sh.getRange(dataRow, rankTabCol, maxRows - dataRow + 1, fillW); try { area.breakApart(); } catch (e) { /* nothing merged */ } area.clearContent(); }
    if (tabIdCol && maxRows >= dataRow) sh.getRange(dataRow, tabIdCol, maxRows - dataRow + 1, 1).setNumberFormat('@');
    const writeBlock = (rows, atRow) => derivedWriteRows_(sh,atRow,rankTabCol,rows);
    if (bands.length && Object.keys(rosterRanges).length) {
      bands.forEach((b) => {
        const idxs = byBand[groupNorm_(b.label)] || [];
        const rows = [];
        for (let j = 0; j < b.height; j++) rows.push(j < idxs.length ? rowForIdx(idxs[j]) : blankRow());
        writeBlock(rows, b.top);
      });
    } else {
      const rows = selected.map((i) => rowForIdx(i));
      const need = dataRow + Math.max(rows.length, 1) - 1;
      if (need > maxRows) sh.insertRowsAfter(maxRows, need - maxRows);
      writeBlock(rows, dataRow);
    }
    built.push(nm);
  });
  return { built: built.length, sheets: built, skipped: skipped, inactive: inactive };
}

/** Menu action: fill / refresh every group tab. */
function buildGroupSheets() {
  runAction_('Build Group Sheets', () => {
    const ui = SpreadsheetApp.getUi();
    const res = buildGroupSheets_();
    let msg = '';
    if (res.built) {
      msg += 'Filled ' + res.built + ' group tab' + (res.built === 1 ? '' : 's') + ':\n• ' + res.sheets.join('\n• ') +
        '\n\nMembers drop into the top of each RANK GROUP band. These tabs are now EDITABLE — any column you add that the roster doesn’t have (e.g. a K9 dog’s name) is kept per member (matched by Unique ID) and never overwritten. Your bands aren’t resized.\n';
    }
    if (res.skipped && res.skipped.length) {
      msg += (msg ? '\n' : '') + 'Skipped:\n' + res.skipped.map((s) => '• ' + s.name + ' — ' + s.why).join('\n') + '\n';
    }
    if(res.inactive&&res.inactive.length)msg+=(msg?'\n':'')+'Inactive:\n'+res.inactive.map(s=>'• '+s.name+' — '+s.why).join('\n')+'\n';
    if (!msg) {
      msg = 'No group tabs found.\n\nName a tab after the group — e.g. “Day Shift”, “Troop A”, “Academy” — lay out the columns like the roster, then run this again.\n\n' +
        'Prefer to be explicit? Put a marker in the tab instead:\n  #group: Shift = Day\n  #group: Rank in Police Cadet, Probationary Officer';
    }
    ui.alert('🗂️ Build / Refresh Group Sheets', msg, ui.ButtonSet.OK);
  });
}

/* ======================================================================
 * POLICE ACADEMY — an EDITABLE, roster-synced training tracker with a
 * GRADUATE LOG. (Group/assignment tabs are also editable now — see
 * buildGroupSheets_ above — but without the graduate flow.) One row per Cadet / Probationary
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
function academyTrainingRanksFromLabels_(liveRanks) {
  const out = [];
  try {
    const groups = (CONFIG.dashboard && CONFIG.dashboard.groups) ? CONFIG.dashboard.groups : {};
    const kw = CONFIG.trainingDividers || []; // normalized training keywords (e.g. TRAINING, CADET)
    if (!kw.length) return out;
    const tagSet = {}; (CONFIG.sectionCategories || []).forEach((t) => { tagSet[norm_(t.label)] = true; });
    Object.keys(groups).forEach((g) => {
      const gn = norm_(g);
      if (!kw.some((k) => k && gn.indexOf(k) !== -1)) return;                       // group name isn't a training label
      (groups[g] || []).forEach((cat) => {
        if (!cat) return;
        // Skip section-tag sub-labels — UNLESS a real roster rank bears that exact name. "Cadet" is BOTH a
        // shipped tag label AND a common rank name; tagging the Cadet rank "Training" must count as a rank.
        const isTag = !!tagSet[norm_(cat)];
        const isLiveRank = !!(liveRanks && liveRanks[groupNorm_(cat)]);
        if (!isTag || isLiveRank) out.push(String(cat).trim());
      });
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
    id: find((h) => /^(UNIQUE ID|DISCORD ID|COMMUNITY ID|MEMBER ID|ID)$/.test(h)) || find((h) => h.indexOf('UNIQUE') !== -1 || h.indexOf('DISCORD') !== -1 || /\bID\b/.test(h)),
    rank: find((h) => h.indexOf('RANK') !== -1 && h.indexOf('GROUP') === -1),
    name: find((h)=>h==='NAME') || find((h) => h.indexOf('NAME') !== -1 && h.indexOf('OOC') === -1 && h.indexOf('UNIQUE') === -1),
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
  // Only a dedicated log banner establishes a fixed boundary. A member's Graduated
  // status, notes, or our generated divider must not become a header on the next refresh.
  for (let i = 0; i < disp.length; i++) { if (disp[i].some((c) => /^(?:GRADUATE|GRADUATED|GRADUATES)\s+(?:LOG|HISTORY|RECORDS)$/i.test(String(c).trim()))) { hdr = fromRow + i; break; } }
  if (!hdr) return null;
  const merges = sh.getRange(hdr, 1, Math.min(6, maxR - hdr + 1), width).getMergedRanges(); // banner is usually merged — data starts under it
  let bottom = hdr;
  merges.forEach((m) => { if (m.getRow() <= hdr && m.getRow()+m.getNumRows()>hdr) bottom = Math.max(bottom, m.getRow() + m.getNumRows() - 1); });
  return { headerRow: hdr, dataStart: bottom + 1 }; // grow below a final-row banner instead of overwriting it
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
function buildAcademySheets_() { return withDerivedLock_(()=>derivedReport_("buildAcademySheets_",buildAcademySheetsCore_())); }
function buildAcademySheetsCore_() {
  const ss = SpreadsheetApp.getActive();
  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  if (!roster) return { built: 0, sheets: [], skipped: [] };
  const RC = rosterCols_(roster);
  if (!RC.headerRow || !RC.name || !RC.rank) return { built: 0, sheets: [], skipped: [] };
  const start = CONFIG.rosterStartRow;
  const headerToData = Math.max(1, start - RC.headerRow);
  const lastRowR = roster.getLastRow();
  const nR = Math.max(0, lastRowR - start + 1);
  const rd = nR ? roster.getRange(start, 1, nR, roster.getLastColumn()).getDisplayValues().map(row=>isValidMemberValues_(row[RC.rank-1],row[RC.name-1])?row:new Array(row.length).fill('')) : [];
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
  // Live roster ranks — lets a Training-label entry that collides with a section-tag name still count as a rank.
  const liveRanks = {};
  rd.forEach((row) => { const rk = groupNorm_(String(row[RC.rank - 1] || '').trim()); if (rk) liveRanks[rk] = true; });
  const baseTraining = ((CONFIG.rankList && CONFIG.rankList.trainingRanks) ? CONFIG.rankList.trainingRanks : [])
    .concat(academyTrainingRanksFromLabels_(liveRanks));
  const built = [];
  const skipped = [];
  ss.getSheets().forEach((sh) => {
    if (sh.getSheetId() === roster.getSheetId()) return;
    if (!isAcademyTab_(sh)) return;
    const mk = academyMarker_(sh);
    const explicit = (mk && mk.ranks.length) ? mk.ranks : baseTraining; // operator-designated ranks, when any
    const wanted = (explicit.length ? explicit : ACADEMY_DEFAULT_RANKS).map(groupNorm_);
    // DEFAULTS-ONLY fallback: nobody designated training ranks anywhere, so don't demand the shipped names
    // verbatim — a rank merely CONTAINING a training keyword (TRAINING_KEYWORDS: TRAINING/CADET…) or PROBATION
    // counts. A department whose ranks are plain "Cadet" / "Probationary Officer" works out of the box; any
    // explicit designation (marker, [RANKS] TRAINING, the Training label) switches back to exact intent.
    const kwFallback = explicit.length ? [] : (CONFIG.trainingDividers || []).map(groupNorm_).concat(['PROBATION']).filter(Boolean);
    const isTrainee = (rank) => {
      const r = groupNorm_(rank);
      if (wanted.some((w) => w && (explicit.length ? r===w : groupValueMatches_(r,w)))) return true;
      return kwFallback.some((k) => r.indexOf(k) !== -1);
    };
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
    colMap[AC.name-1]=RC.name;
    if(AC.rank)colMap[AC.rank-1]=RC.rank;
    if(AC.id&&RC.discord)colMap[AC.id-1]=RC.discord;
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
    const existFormulas = maxRows >= dataRow ? sh.getRange(dataRow, 1, maxRows - dataRow + 1, width).getFormulasR1C1() : [];
    const existKeys = maxRows >= dataRow ? sh.getRange(dataRow, keyCol, maxRows - dataRow + 1, 1).getDisplayValues() : [];
    // Validate and preserve the same exact displayed identity used by the lookup below;
    // numeric getValues() can round long Discord IDs before duplicate detection.
    existVals.forEach((row,i)=>{ row[keyCol-1]=String(existKeys[i][0]||'').trim(); });
    // Skip the generated divider without removing a row: diagnostics must retain
    // the original row numbers, and genuine trainees without an ID stay protected.
    const identityRows=existVals.map(row=>String(row[AC.name-1]||'').trim()===ACADEMY_GRAD_DIVIDER?new Array(width).fill(''):row);
    const identityProblem = groupIdentityProblem_(rd,useId?RC.discord:RC.name,RC.name,{sheet:roster.getName(),start,key:useId?RC.discord:RC.name}) || groupIdentityProblem_(identityRows,keyCol,AC.name,{sheet:sh.getName(),start:dataRow,key:keyCol});
    if(identityProblem){skipped.push({name:sh.getName(),why:identityProblem+' — existing rows left unchanged'});return;}
    existFormulas.forEach((row,r)=>row.forEach((formula,c)=>{if(formula&&!colMap[c])existVals[r][c]={derivedFormula:formula};}));
    const existByKey = Object.create(null);
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
      for (let c = memberCol1; c <= width; c++) { const rc = colMap[c - 1]; if (rc) row[c - 1] = String(rd[i][rc - 1] == null ? '' : rd[i][rc - 1]); }
      if (AC.grad) row[AC.grad - 1] = graduated ? 'Graduated' : '';
      return row;
    };
    const filled = {};
    // Write helper: member columns only (right of the band column), so your column-B bands are never touched.
    const writeBlock = (rowsFull, atRow) => {
      if (!rowsFull.length) return;
      derivedWriteRows_(sh,atRow,memberCol1,rowsFull.map((r)=>r.slice(memberCol1-1,width)));
    };
    if (AC.id && AC.id >= memberCol1 && maxRows >= dataRow) sh.getRange(dataRow, AC.id, maxRows - dataRow + 1, 1).setNumberFormat('@');
    // A "GRADUATE LOG" section (a row holding "GRADUATE") tells us where graduates go AND caps the member bands above it.
    const gradSec = academyGradSection_(sh, dataRow, width);
    // Clear member columns in [top, bottom] — break merges so setValues is safe, but never touch the GRADUATE LOG banner.
    const clearMemberCols = (top, bottom) => { if (bottom >= top && bottom >= dataRow) { const a = sh.getRange(top, memberCol1, bottom - top + 1, width - memberCol1 + 1); a.breakApart(); a.clearContent(); } };
    // Members STILL on the roster (named), keyed the same way. A member GONE from the roster is REMOVED from the Academy;
    // one who left the training ranks but remains on the roster (e.g. promoted to Officer) goes to the GRADUATE LOG.
    const rosterKeys = Object.create(null);
    for (let i = 0; i < rd.length; i++) { const kk = keyOfIdx(i); if (kk && String(rd[i][RC.name - 1] || '').trim()) rosterKeys[kk] = i; }
    const gradRowsFrom = () => Object.keys(existByKey).filter((k) => !filled[k] && Object.prototype.hasOwnProperty.call(rosterKeys,k)).map((k) => rowForIdx(rosterKeys[k],true));
    const putGrads = (grads, bandBottom, tmplRow) => {
      const top = gradSec ? gradSec.dataStart : bandBottom + 1;
      if(gradSec) {
        // Use the graduate area's own frame, not the academy's active-member bands.
        // Three initial slots; only grow when more graduates need room. Never consume the closing bar.
        ensureRoomAboveCap_(sh,top+Math.max(3,grads.length)-1,top);
        const frame=framedTable_(sh,top);
        clearMemberCols(top,frame.cap-1);
        if(AC.id && AC.id>=memberCol1) sh.getRange(top,AC.id,frame.cap-top,1).setNumberFormat('@');
      } else clearMemberCols(top, sh.getMaxRows());
      if (!grads.length) return;
      let writeAt;
      if (gradSec) {
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
    // Validate placement BEFORE clearing any training records. Overflow is never graduation.
    const counts=bands.map(()=>0); let unmatched=0, activeCount=0;
    rd.forEach((row)=>{
      if(!String(row[RC.name-1]||'').trim()||!isTrainee(row[RC.rank-1]))return;
      activeCount++;
      if(!bands.length)return;
      const stems=academyStems_(row[RC.rank-1]);let best=-1,score=0;
      bands.forEach((band,i)=>{const bs=academyStems_(band.label);const s=stems.filter((stem)=>bs.indexOf(stem)!==-1).length;if(s>score){score=s;best=i;}});
      if(best<0)unmatched++;else counts[best]++;
    });
    const overflow=bands.some((band,i)=>counts[i]>band.height || (gradSec && band.top+band.height>gradSec.headerRow));
    if(unmatched||overflow||(!bands.length&&gradSec&&activeCount>gradSec.headerRow-dataRow)){
      skipped.push({name:sh.getName(),why:'training bands are too small or do not match active trainees — existing records left unchanged'});return;
    }
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
      // isTrainee(), not a second copy of the exact-name test: the banded path above uses it, and the two
      // deciding membership differently meant the SAME roster filled or emptied depending only on whether the
      // operator had laid out rank-group bands.
      if (!isTrainee(rd[i][RC.rank - 1])) continue;
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

/* ======================================================================
 * LEAVE COVERAGE VIEW
 * ====================================================================== */

/** Menu/trigger: refresh the Leave Coverage tab from the tracker. */
function buildCoverage() {
  runAction_('Rebuild Leave Coverage', () => {
    const ss = SpreadsheetApp.getActive();
    const tracker = getSheetOrWarn_(ss, CONFIG.sheets.tracker);
    if (!tracker) return;
    const result=buildCoverageCore_(ss,tracker);
    logInfo_('buildCoverage', `${result.total} active/upcoming leaves.`);
    try { // manual run only — the 6am trigger has no UI
      SpreadsheetApp.getUi().alert(`🗓️ Leave Coverage rebuilt — ${result.outNow} out now, ${result.total} active/upcoming.\n\nSee the "${EXTRAS.coverageSheet}" tab.`);
    } catch (e) { /* no UI in a time-driven run */ }
  });
}

/** Shared noninteractive coverage writer, including demo loading under its existing writer lock. */
function buildCoverageCore_(ss,tracker) {
  return supportSheetLock_(()=>{
    const leaves = activeLeaves_(tracker).sort((a, b) => b.submitted-a.submitted||b.start-a.start);
    const sh = ss.getSheetByName(EXTRAS.coverageSheet) || ss.insertSheet(EXTRAS.coverageSheet);
    if(sh.getMaxRows()<leaves.length+3)sh.insertRowsAfter(sh.getMaxRows(),leaves.length+3-sh.getMaxRows());
    if(sh.getMaxColumns()<5)sh.insertColumnsAfter(sh.getMaxColumns(),5-sh.getMaxColumns());
    sh.clearContents();
    sh.getRange(1, 1, 1, 5).setValues([['Name', 'Type', 'Start', 'End', 'Status']]).setFontWeight('bold');
    const rows = leaves.map((l) => [l.name, l.type, fmtDate_(l.start), fmtDate_(l.end), l.started ? 'OUT NOW' : 'upcoming'].map(v=>typeof v==='string'&&v.startsWith('=')?"'"+v:v));
    if (rows.length) sh.getRange(2, 1, rows.length, 5).setValues(rows);
    const outNow = leaves.filter((l) => l.started).length;
    sh.getRange(rows.length + 3, 1).setValue(`${outNow} member(s) currently out (${leaves.length} active/upcoming).`);
    styleStartupSupportSheet_(sh,['Name','Type','Start','End','Status']);
    ensureSupportFilter_(sh,5,rows.length+1);
    return {total:leaves.length,outNow};
  });
}

/* ======================================================================
 * ACTIVITY PANEL (engine-built board tab)
 * One row per patrol-form submission — member identity, start/end, patrol
 * length, and the row's CURRENT status pulled live from the Patrol Log —
 * under a native filter row, so admins search and sort by ANY column
 * (member, dates, length, status…). The tab is a VIEW: it is rebuilt from
 * its sources on every patrol sync/refresh, so hand edits don't survive —
 * statuses are managed on the Patrol Log itself. OFF when [SHEETS].ACTIVITY
 * is blank. Themed exactly like the form-response tabs (console look).
 * ====================================================================== */

const ACTIVITY_HEADERS_ = Object.freeze(['SUBMITTED', 'NAME', 'UNIQUE ID', 'RANK', 'CALLSIGN', 'START', 'END', 'HOURS', 'STATUS', 'NOTES']);

/**
 * Rebuild the Activity Panel from the patrol form responses + the Patrol Log. Silent core — callers wrap it.
 * Reads each source ONCE (one block read per tab + one roster snapshot); log rows are matched to submissions by
 * Unique ID + exact start/end datetimes — the same key the patrol sync's backfill uses, so the two always agree.
 * @return {{rows:number, name:string}|null} null = OFF/unconfigured (no tab touched).
 */
function buildActivityPanel_() {
  const name = EXTRAS.activitySheet;
  if (!name || !CONFIG.sheets.patrol) return null; // needs a board name AND a patrol form to read
  const ss = SpreadsheetApp.getActive();
  const form = ss.getSheetByName(CONFIG.sheets.patrol);
  if (!form) return null;

  // --- Patrol Log index. Each log row is one shared entry reachable by up to three keys, consumed once:
  //   1. "S:id|submissionMs" — the marker's submission stamp (hours|id|submissionMs). PRIMARY: it survives
  //      credits, reversals AND hand-corrected dates/times, so an admin fixing a member's typo'd date never
  //      orphans the row (the old exact-times-only key broke on every correction — corrected rows read
  //      "Not on log" while sitting right there on the log).
  //   2. "id|startMs|endMs" — exact times, for rows without a stamp.
  //   3. "N:name|startMs|endMs" — the NAME breadcrumb, for blank-ID landings (Flagged "unknown member").
  const log = CONFIG.sheets.patrolLog ? ss.getSheetByName(CONFIG.sheets.patrolLog) : null;
  const byKey = {};
  const put = (k, entry) => { (byKey[k] = byKey[k] || []).push(entry); };
  const take = (k) => { const q = byKey[k]; while (q && q.length) { const e2 = q.shift(); if (!e2.used) { e2.used = true; return e2; } } return null; };
  if (log) {
    try {
      const PC = patrolLogCols_(log);
      const startL = CONFIG.patrolStartRow, lastL = log.getLastRow();
      if (PC.status && PC.discord && PC.startDate && PC.width && lastL >= startL) {
        const nL = lastL - startL + 1;
        const lv = log.getRange(startL, 1, nL, PC.width).getValues();
        const ld = log.getRange(startL, 1, nL, PC.width).getDisplayValues();
        for (let i = 0; i < nL; i++) {
          const lid = String(ld[i][PC.discord - 1] || '').trim();
          const lnm = PC.name ? String(ld[i][PC.name - 1] || '').trim() : '';
          const lsd = combineDateTime_(lv[i][PC.startDate - 1], lv[i][PC.startTime - 1]);
          const led = combineDateTime_(lv[i][PC.endDate - 1], lv[i][PC.endTime - 1]);
          const tot = PC.total ? lv[i][PC.total - 1] : null; // the TOTAL formula's raw number (format adds " hrs")
          const entry = {
            used: false,
            status: String(ld[i][PC.status - 1] || '').trim() || CONFIG.patrol.pendingStatus,
            notes: PC.notes ? String(ld[i][PC.notes - 1] || '').trim() : '',
            sd: lsd, ed: led,
            hours: (typeof tot === 'number' && isFinite(tot)) ? Math.round(tot * 100) / 100
              : ((lsd && led) ? Math.round(((led.getTime() - lsd.getTime()) / 3600000) * 100) / 100 : null),
          };
          const mparts = (PC.mark ? String(ld[i][PC.mark - 1] == null ? '' : ld[i][PC.mark - 1]).trim() : '').split('|');
          const subMs = (mparts.length > 2 && Number(mparts[2]) > 0) ? Number(mparts[2]) : 0;
          const kid = lid || String(mparts[1] || '').trim();
          if (subMs && kid) put('S:' + kid + '|' + subMs, entry);
          if (lsd && led) {
            const tk = '|' + lsd.getTime() + '|' + led.getTime();
            if (lid) put(lid + tk, entry); else if (lnm) put('N:' + norm_(lnm) + tk, entry);
          }
        }
      }
    } catch (e) { log_('buildActivityPanel_.log', e); }
  }

  // --- One pass over the form: identity (same resolution as the sync), times, length, then the status join ---
  const rows = [];
  const lastF = form.getLastRow();
  if (lastF >= 2) {
    const cols = patrolCols_(form);
    const markCol = patrolMarkerCol_(form);
    const width = form.getLastColumn();
    // Per-field date+time pairs first, single datetime columns as the fallback — mirrors syncPatrolFormToLog_.
    const fh = form.getRange(1, 1, 1, width).getDisplayValues()[0].map((h) => norm_(h));
    const fFind = (...toks) => { for (let c = 0; c < fh.length; c++) { if (fh[c] && toks.every((t) => fh[c].indexOf(t) !== -1)) return c + 1; } return 0; };
    const F = {
      sDate: fFind('START', 'DATE'), sTime: fFind('START', 'TIME'), eDate: fFind('END', 'DATE'), eTime: fFind('END', 'TIME'),
      narrative: fFind('NARRATIVE') || fFind('NOTES') || fFind('NOTE') || fFind('REASON') || fFind('DETAILS'), name: 0,
    };
    for (let c = 0; c < fh.length; c++) { if (fh[c].indexOf('NAME') !== -1 && fh[c].indexOf('OOC') === -1) { F.name = c + 1; break; } }
    const n = lastF - 1;
    const grid = form.getRange(2, 1, n, width).getValues();
    const bgs = form.getRange(2, 1, n, 1).getBackgrounds();
    const errBg = String(CONFIG.bg.error).toLowerCase();
    const roster = ss.getSheetByName(CONFIG.sheets.roster);
    const idx = roster ? patrolRosterIndex_(roster) : null; // one snapshot serves every row
    const rMap = {};
    if (idx) {
      for (let i = 0; i < idx.n; i++) {
        const rid = String(idx.ids[i][0] || '').trim();
        if (rid && !rMap[rid]) rMap[rid] = { rank: String(idx.ranks[i][0] || ''), name: String(idx.names[i][0] || ''), unit: String(idx.units[i][0] || '') };
      }
    }
    const durationMode = norm_(CONFIG.patrol.mode) === 'DURATION';
    const asDate = (v) => { const d = (v instanceof Date) ? v : (v === '' || v == null ? null : new Date(v)); return (d && !isNaN(d.getTime())) ? d : null; };
    for (let i = 0; i < n; i++) {
      const cell = (c) => (c > 0 && c <= width) ? grid[i][c - 1] : '';
      const tsv = cell(cols.timestamp);
      const ts = (tsv instanceof Date && !isNaN(tsv.getTime())) ? tsv : '';
      // Identity — valid ID passes through; an invalid one gets the same corroborated name+callsign resolution the sync uses.
      let id = String(cell(cols.discord) == null ? '' : cell(cols.discord)).trim();
      const csRaw = String(cell(cols.callsign) == null ? '' : cell(cols.callsign)).trim(); // often "2519 | L. Forger"
      const unit = csRaw.indexOf('|') !== -1 ? csRaw.split('|')[0].trim() : csRaw;
      const csName = csRaw.indexOf('|') !== -1 ? csRaw.split('|').slice(1).join('|').trim() : '';
      let nm = String(F.name ? cell(F.name) : '').trim() || csName;
      if (id && !isValidId_(id) && idx) { const rec = rosterMatchByFields_(idx, { name: nm, rank: '', unit: unit }); if (rec) id = rec.id; }
      const R = rMap[id] || null; // the roster is the source of truth for rank/callsign (current values)
      if (R && !nm) nm = R.name;
      // Times + length. START_END computes hours from the same combined datetimes the sync writes; DURATION reads the hours answer.
      let sd = null, ed = null, hours = '';
      if (durationMode) {
        const h = parseHours_(cell(cols.duration));
        if (h != null) hours = h;
      } else {
        sd = (F.sDate && F.sTime) ? combineDateTime_(cell(F.sDate), cell(F.sTime)) : asDate(cell(cols.start));
        ed = (F.eDate && F.eTime) ? combineDateTime_(cell(F.eDate), cell(F.eTime)) : asDate(cell(cols.end));
        if (sd && ed) {
          let ms = ed.getTime() - sd.getTime();
          if (ms < 0 && CONFIG.patrol.overnight) ms += 86400000; // crossed midnight
          hours = Math.round((ms / 3600000) * 100) / 100; // shown even when invalid — the STATUS column explains
        }
      }
      // Status: the live Patrol Log row wins; else the durable form marker (transferred/credited); else Pending.
      const marker = String(cell(markCol) == null ? '' : cell(markCol)).trim();
      let notes = String(F.narrative ? cell(F.narrative) : '').trim();
      let status;
      let hit = null;
      const subMs = (ts instanceof Date) ? ts.getTime() : 0;
      if (id && subMs) hit = take('S:' + id + '|' + subMs); // submission-stamp join — immune to admin-corrected dates
      if (!hit && sd && ed) {
        const tk = '|' + sd.getTime() + '|' + ed.getTime();
        if (id) hit = take(id + tk);
        if (!hit && nm) hit = take('N:' + norm_(nm) + tk); // blank/unresolvable-ID rows match the log's NAME breadcrumb
      }
      if (hit) {
        status = hit.status; if (hit.notes) notes = hit.notes;
        // The log is the source of truth once a row lands there: show ITS (possibly admin-corrected) times and
        // hours, not the raw submission's — a fixed typo (wrong month, AM instead of PM) reads correctly here
        // instead of surfacing the member's 145-hour "patrol" again.
        if (hit.sd) sd = hit.sd;
        if (hit.ed) ed = hit.ed;
        if (hit.hours != null) hours = hit.hours;
      }
      else if (String(bgs[i][0] || '').toLowerCase() === errBg) status = 'Error — fix the red form row';
      else if (marker) status = log ? 'Not on log' : CONFIG.patrol.processedStatus; // transferred but since removed from the log / direct-credited
      else status = CONFIG.patrol.pendingStatus; // not yet synced — the next patrol sync picks it up
      rows.push([ts, nm, id, R ? R.rank : '', R ? R.unit : unit, sd || '', ed || '', hours, status, clamp_(notes, 500)]);
    }
    // Newest submitted first (the filter re-sorts any way the admin likes); timestamp-less rows keep their order at the bottom.
    rows.sort((a, b) => ((b[0] instanceof Date ? b[0].getTime() : 0) - (a[0] instanceof Date ? a[0].getTime() : 0)));
  }

  // --- Write the board: engine-owned tab, auto-created like the coverage board ---
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const W = ACTIVITY_HEADERS_.length;
  if (sh.getMaxColumns() < W) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
  const needRows = Math.max(rows.length + 1, 2); // header + at least one body row: "band" below must never be 0
  if (sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  const maxRows = sh.getMaxRows();
  const band = maxRows - 1;
  sh.getRange(1, 1, 1, W).setValues([ACTIVITY_HEADERS_.slice()]);
  sh.getRange(2, 1, band, W).clearContent();
  // Formats BEFORE values: '@' on every text column (user text never becomes a formula — invariant 3; the ID never
  // coerces to Number — invariant 1), real date/number formats where sorting must be typed.
  const DT_FMT = 'd mmm yyyy h:mm am/pm';
  [[1, DT_FMT], [6, DT_FMT], [7, DT_FMT], [8, '0.00']].forEach((p) => sh.getRange(2, p[0], band, 1).setNumberFormat(p[1]));
  [2, 3, 4, 5, 9, 10].forEach((c) => sh.getRange(2, c, band, 1).setNumberFormat('@'));
  if (rows.length) sh.getRange(2, 1, rows.length, W).setValues(rows);
  // The native filter row — per-column search/sort/date-range from the header dropdowns. The operator's active
  // filter (its criteria) is KEPT while its range still covers the grid; only a grown grid recreates it.
  try {
    let f = sh.getFilter();
    if (f && (f.getRange().getLastRow() < maxRows || f.getRange().getLastColumn() < W || f.getRange().getRow() !== 1)) { f.remove(); f = null; }
    if (!f) sh.getRange(1, 1, maxRows, W).createFilter();
  } catch (e) { log_('buildActivityPanel_.filter', e); }
  try { if (typeof styleFormResponses_ === 'function') styleFormResponses_(sh); } catch (e) { log_('buildActivityPanel_.style', e); } // the form-response console theme, verbatim
  try { if (typeof publishMarkDirty_ === 'function') publishMarkDirty_(); } catch (e) { /* best-effort */ } // script writes fire no publish trigger — the sweep carries a public copy of this tab
  return { rows: rows.length, name: name };
}

/** Menu action: build/refresh the Activity Panel board tab. */
function buildActivityPanel() {
  runAction_('Build Activity Panel', () => {
    const ui = SpreadsheetApp.getUi();
    const r = buildActivityPanel_();
    if (!r) {
      ui.alert('📊 Activity Panel', 'The Activity Panel is OFF.\n\nIt needs [SHEETS].ACTIVITY (the board tab name — default "Activity Panel") and [SHEETS].PATROL_FORM_RESPONSES (your patrol form\'s responses tab). Both live in ⚙️ Engine Settings ▸ Sheets & layout.', ui.ButtonSet.OK);
      return;
    }
    ui.alert('📊 Activity Panel', `✅ "${r.name}" rebuilt — ${r.rows} patrol${r.rows === 1 ? '' : 's'} listed.\n\nUse the filter row to search and sort by any column (member, dates, patrol length, status). Statuses are managed on the Patrol Log — this board is a live view and rebuilds itself on every patrol sync.`, ui.ButtonSet.OK);
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
  supportSheetLock_(()=>{
    if (log.getLastRow() === 0) {
      log.appendRow(['Time', '# Issues', 'Detail']);
      styleStartupSupportSheet_(log,['Time','# Issues','Detail']);
    }
    ensureSupportRoom_(log,log.getLastRow()+1,3);
    log.appendRow([new Date(), issues.length, issues.join(' | ')].map(v=>typeof v==='string'&&v.startsWith('=')?"'"+v:v));
    sortSupportRows_(log,1,3);trimSupportRows_(log,logRowCap_()-1);
    ensureSupportFilter_(log,Math.max(3,log.getLastColumn()));
  });
  if (issues.length) postSummary_(`\`🔍\` Integrity Scan — ${issues.length} Issue(s)`, issues.slice(0, 12).map((s) => '`❌` ' + s).join('\n'), 15548997);
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

  // ASSIGNMENT-TYPO failsafe: a group-column value that matches NO group tab but sits within 2 edits of a declared
  // value (e.g. "Distict 1 Patrol" vs "District 1 Patrol") silently keeps that member off their tab while LOOKING
  // correct — surface it with the member's name. Near-miss only: an assignment that legitimately has no tab (e.g.
  // "Office of the Chief") is never flagged. Capped at 10 per scan so a systemic rename can't flood the log.
  try {
    const start = CONFIG.rosterStartRow, lastR = roster.getLastRow();
    const RCr = rosterCols_(roster);
    if (lastR >= start && RCr.name) {
      const byCol = {}; // roster group-column → [{tab, vals(normalized)}] from each tab's #group marker
      ss.getSheets().forEach((sh) => {
        try {
          const mk = groupMarker_(sh);
          if (!mk || !mk.values || !mk.values.length) return;
          const col = findGroupColumn_(roster, start, mk.values[0]);
          if (col > 0) (byCol[col] = byCol[col] || []).push({ tab: sh.getName(), vals: mk.values.map(groupNorm_).filter(Boolean) });
        } catch (e2) { /* unreadable tab → skip */ }
      });
      let flagged = 0;
      Object.keys(byCol).forEach((ck) => {
        if (flagged >= 10) return;
        const colN = Number(ck), n = lastR - start + 1;
        const cells = roster.getRange(start, colN, n, 1).getDisplayValues();
        const names = roster.getRange(start, RCr.name, n, 1).getDisplayValues();
        for (let i = 0; i < n && flagged < 10; i++) {
          const raw = String(cells[i][0] || '').trim(), nm = String(names[i][0] || '').trim();
          if (!raw || !nm) continue;
          const cell = groupNorm_(raw);
          let matched = false, near = null;
          byCol[colN].forEach((t) => t.vals.forEach((v) => {
            if (matched || !v) return;
            if (cell.indexOf(v) === 0) { matched = true; return; } // same starts-with rule the tabs select by
            if (!near && levDist_(cell, v) <= 2) near = { v: v, tab: t.tab };
          }));
          if (!matched && near) { issues.push(`${nm}: assignment "${raw}" looks like a typo of "${near.v}" — they're missing from "${near.tab}"`); flagged++; }
        }
      });
    }
  } catch (e) { logWarn_('runIntegritySummary_', 'assignment-typo check skipped: ' + ((e && e.message) || e)); }
  return issues;
}

/** Bounded edit distance for the assignment-typo check: exact value, early-exit 3 as soon as the distance must exceed 2. */
function levDist_(a, b) {
  a = String(a); b = String(b);
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = []; for (let j = 0; j <= b.length; j++) prev.push(j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
      if (cur[j] < best) best = cur[j];
    }
    if (best > 2) return 3; // the row minimum never decreases → already past the threshold
    prev = cur;
  }
  return prev[b.length];
}

/* ======================================================================
 * DEMO / PREVIEW DATA — seedDemoRoster()
 * Replaces member fields on existing slots, preserving ranks, callsigns,
 * dividers, slot-owned shifts and layout. IDs, tiers, leave statuses and
 * member-owned shifts follow configuration. Tracker/history/patrol/signup
 * records refer to the same demo members. Four fortnightly history snapshots
 * are generated; pre-credited patrol sessions remain stable on reconciliation.
 * Configured counts and derived group/academy views use the normal builders.
 * Leadership and promotion displays reflect the newly seeded roster.
 * Requires typed confirmation, holds the writer lock, suppresses notifications
 * through menu auditing/error handling and queues publishing even after failure.
 * ====================================================================== */

/** Deterministic numeric text ID within the department's configured length. */
function demoId_(i) {
  const min = Number(CONFIG.idMinDigits) || 17, max = Number(CONFIG.idMaxDigits) || 19;
  const suffix = String(i + 1);
  const digits = Math.min(max, Math.max(min, norm_(CONFIG.idType || 'DISCORD') === 'DISCORD' ? 18 : suffix.length + 1));
  if (!Number.isSafeInteger(i) || i < 0 || suffix.length > (digits === 1 ? 1 : digits - 1)) throw new Error('The configured Unique ID length cannot fit this demo.');
  return digits === 1 ? suffix : '7' + suffix.padStart(digits - 1, '0');
}

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

/** A believable four-snapshot hours series that ENDS at the member's current hours. */
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
 * Build a believable demo member for member-slot index `i` (0-based).
 * Deterministic (salted hash, no RNG — reseeding the same layout reproduces the same demo).
 * Hours land inside the intended status's tier band so recompute is a no-op;
 * Active leaves use the tracker's implicit type; returning members carry ended leaves.
 */
function demoPerson_(i, total, rank) {
  // ≈ 60% top tier / 15% mid / 15% low / 5% + 5% leave, spread by a coprime stride — every name is read from CONFIG,
  // so a renamed OR LOA-only setup never seeds a status that doesn't exist (e.g. ROA). (No "Reserve" in the mix.)
  const engine = statusEngine_(), ladder = statusLadderFor_(rank || '', engine);
  const tiers = ladder.map(t => t.name);
  const TOP = tiers[0] || '', MID = tiers[Math.min(1, tiers.length - 1)] || '', LOW = tiers[tiers.length - 1] || '';
  const lts = CONFIG.leaveTypes || [];
  const lv1 = lts[0]; // the tracker has one implicit type, regardless of how many LEAVE statuses exist
  const rst = norm_(CONFIG.returnStatus || '');           // the "returning" leave (default ROA), if configured
  const lv2 = lv1 && rst && rst!==norm_(lv1) ? CONFIG.returnStatus : lv1;
  const DIST = [TOP, TOP, TOP, TOP, TOP, TOP, TOP, TOP, TOP, TOP, TOP, TOP, MID, MID, MID, LOW, LOW, LOW, lv1 || LOW, lv2 || TOP];
  let act = DIST[(i * 7) % DIST.length];
  let hours, last = act, leave = null;
  const pastLeaves = [];
  const r = demoRand_(i, 1), r2 = demoRand_(i, 2);
  if (act === TOP) hours = demoQuarter_(10 + r * r * 15 + (r2 > 0.93 ? 6 : 0)); // right-skewed; rare ~30h grinder (top tier)
  else if (act === MID) hours = demoQuarter_(5 + r * 4.7);                       // mid tier band
  else if (act === LOW) hours = demoQuarter_(r * r * 4.7);                       // low tier, clustered low
  else if (rst && norm_(act) === rst) {
    hours = demoQuarter_(Math.max(5, CONFIG.thresholds.semi) + r * 3.7); last = LOW;
    pastLeaves.push({type:lv1,from:-(20+i%7),to:-(2+i%3)});
  }
  else { hours = 0; last = TOP; leave = { type: act, from: -(2 + i % 6), to: 5 + (i % 10), status: CONFIG.approvedStatus }; }
  if (!tiers.length) {
    // A tierless department is valid: demo hours still exist, but no ordinary status is invented.
    if (!act) hours = demoQuarter_(r * r2 * 30);
    last = act;
  }
  if (!leave && tiers.indexOf(act)!==-1) {
    const ti = tiers.indexOf(act), floor = ladder[ti].min, ceiling = ti ? ladder[ti - 1].min : Infinity;
    hours = Math.max(floor, Math.min(hours, Number.isFinite(ceiling) ? ceiling - Math.min(.25, (ceiling - floor) / 2) : hours));
    hours = Math.round(hours * 100) / 100;
    act = computeStatusCore_(rank || '', hours, engine); last = act;
  }
  // Past (EXPIRED) leaves — a real LOA history. Members not currently ON leave accrue 0–3 finished leaves scattered
  // across the past ~7 months (deterministic). The most recent one tints their activity checks. This is what makes the
  // tracker's "history" section look lived-in instead of near-empty.
  if (!leave && lts.length) {
    const cnt = [0, 0, 1, 1, 1, 2, 2, 3][Math.floor(demoRand_(i, 8) * 8)]; // ~25% none · mostly 1–2 · a few with 3
    let back = 26 + Math.floor(demoRand_(i, 9) * 34);                       // most recent ended 26–60 days ago
    for (let k = 0; k < cnt; k++) {
      const dur = 5 + Math.floor(demoRand_(i, 20 + k) * 19);                // a 5–23 day leave
      pastLeaves.push({ type: lv1, from: -(back + dur), to: -back });
      back += dur + 18 + Math.floor(demoRand_(i, 30 + k) * 45);            // walk further back for the previous one
    }
  }
  const tenure = 1600 - Math.round((i / Math.max(total, 1)) * 1200); // seniority: earlier rows = longer tenure
  const shift = ''; // real shift is assigned per-rank (evenly across the configured shifts) once all people are built — see seedDemoRoster
  const may = demoQuarter_(demoRand_(i, 3) * demoRand_(i, 6) * 30); // prior-month totals — right-skewed 0–30h
  const jun = demoQuarter_(demoRand_(i, 4) * demoRand_(i, 7) * 30);
  const nm = demoName_(i);
  // Snapshots describe the actual Sunday, including leaves that were active then.
  const checks = demoHours_(hours).map((h,k) => {
    const at=demoSunday_((3-k)*2).getTime();
    const active=[leave].concat(pastLeaves).filter(Boolean).find(l=>at>=demoDay_(l.from).getTime()&&at<demoDay_(l.to).getTime());
    if(active && !(rst&&norm_(active.type)===rst&&h<CONFIG.thresholds.semi))return active.type;
    if(rst&&norm_(act)===rst&&pastLeaves.length&&at>=demoDay_(pastLeaves[0].to).getTime()&&h>=CONFIG.thresholds.semi)return act;
    return ladder.length ? computeStatusCore_(rank || '',h,engine) : '';
  });
  return {
    name: nm, id: demoId_(i), email: demoEmail_(nm), dob: demoDob_(i), shift: shift, may: may, jun: jun,
    join: demoDay_(-tenure), promo: demoDay_(-Math.min(tenure, 20 + (i % 10) * 16)),
    hours: hours, act: act, last: last, leave: leave, pastLeaves: pastLeaves,
    checks: checks,
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
  const row = buildTrackerRow_(TC, TC.width, { key: key, rank: m.rank, unit: oi.unit, ooc: oi.ooc, name: m.name, discord: m.id, shift: oi.shift, start: start, end: end, status: L.status || CONFIG.approvedStatus });
  tracker.getRange(r, 1, 1, TC.width).setValues([row]);
  if (TC.start) tracker.getRange(r, TC.start).setNumberFormat('d mmm. yyyy');
  if (TC.end) tracker.getRange(r, TC.end).setNumberFormat('d mmm. yyyy');
  writeLeaveFormulas_(tracker, r, TC);
}

/** A time-of-day Date on a FIXED date base (2020-01-01), so a patrol TOTAL formula that subtracts start from end cancels the date part out. */
function demoTimeOfDay_(h, m) { return new Date(2020, 0, 1, h, m || 0, 0); }

/** A deterministic fictional phone number in the reserved 555-0100 through 555-0199 range. */
function demoPhone_(i) { return '(202) 555-01'+String(i%100).padStart(2,'0'); }

/** Split a total into exact hundredths, with every session inside the configured patrol limit. */
function demoSplitHours_(hours) {
  const cents = Math.round(Number(hours) * 100);
  if (!Number.isFinite(cents) || cents <= 0) return [];
  const cap = Math.floor(Math.min(12, CONFIG.patrol.maxHours) * 100);
  if (!Number.isFinite(cap) || cap < 1) throw new Error('The patrol limit must allow at least 0.01 hours for demo sessions.');
  const k = Math.max(1, Math.ceil(cents / cap), Math.min(4, Math.round(cents / 300)));
  const base = Math.floor(cents / k), rem = cents - base * k, out = [];
  for (let s = 0; s < k; s++) out.push((base + (s < rem ? 1 : 0)) / 100);
  return out;
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
  const ds = CONFIG.patrolStartRow, W = PC.width;
  if (PC.labelRow && ds <= PC.labelRow) return 0; // misconfigured start row — never stomp the header
  const frame=framedTable_(patrol,ds),end=Math.min(frame.cap-1,patrol.getMaxRows());
  if(end>=ds)patrol.getRange(ds,1,end-ds+1,frame.width).clearContent();

  const recs = [];
  memberRows.forEach((m, i) => {
    const p = people[i];
    if (p.open || !(Number(p.hours) > 0)) return; // open slots + members on protected (0-hour) leave log nothing
    const unit = String(calls[m.r - start][0] || '').trim(), ooc = demoOocName_(p.name);
    demoSplitHours_(p.hours).forEach((dur, k) => {
      const back = 1 + ((i * 3 + k * 7) % 27);                                       // 1–27 days ago (deterministic)
      // Daytime sessions finish on the same date, avoiding DST-night clock changes.
      const startMin = (7 + ((i + k * 2) % 4)) * 60 + [0, 15, 30, 45][(i + k) % 4]; // 07:00–10:45 start
      const startSec = startMin * 60, endSec = startSec + Math.round(dur * 3600);
      recs.push({
        mark: (Math.round(dur * 100) / 100) + '|' + p.id, rank: m.rank, unit: unit, ooc: ooc, name: p.name, id: p.id, shift: p.shift,
        sd: demoDay_(-back - 1), ed: demoDay_(-back - 1 + Math.floor(endSec / 86400)),
        st: new Date(2020, 0, 1, 0, 0, startSec), et: new Date(2020, 0, 1, 0, 0, endSec % 86400),
        status: CONFIG.patrol.processedStatus,
      });
    });
  });
  if (!recs.length) return 0;
  ensureRoomAboveCap_(patrol,ds+recs.length-1,ds);
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
  if (typeof sortPatrolLog_ === 'function') sortPatrolLog_(patrol);
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
  const frame=framedTable_(sh,ds),end=Math.min(frame.cap-1,sh.getMaxRows());
  if(end>=ds)sh.getRange(ds,1,end-ds+1,frame.width).clearContent();

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
    const idx = memberRows.length + k, name = demoName_(idx);
    const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - k - 1, 8 + k, [5, 25, 40, 50][k % 4]);
    recs.push(mkRow({ ts: ts, name: name, ooc: demoOocName_(name), id: demoId_(idx), email: demoEmail_(name), dob: demoDob_(idx), phone: demoPhone_(idx), join: '', status: SIGNUP_STATUSES_[0], notes: '' }));
    out.pending++;
  }
  if (!recs.length) return out;
  ensureRoomAboveCap_(sh,ds+recs.length-1,ds);
  if (SC.discord) sh.getRange(ds, SC.discord, recs.length, 1).setNumberFormat('@'); // ID exact BEFORE the write
  sh.getRange(ds, 1, recs.length, W).setValues(recs);
  if (SC.dob) sh.getRange(ds, SC.dob, recs.length, 1).setNumberFormat('d mmm yyyy');
  if (SC.join) sh.getRange(ds, SC.join, recs.length, 1).setNumberFormat('d mmm yyyy');
  if (SC.timestamp) sh.getRange(ds, SC.timestamp, recs.length, 1).setNumberFormat('d mmm yyyy h:mm am/pm');
  if (typeof sortSignups_ === 'function') sortSignups_(sh);
  return out;
}

/** Menu / command: fill the member-info columns of the rows the operator already set up (see the header note). */
function seedDemoRoster() {
  let previous, suppressed=false;
  try { runAction_('Load Demo Roster',()=>{
    const ui=SpreadsheetApp.getUi();
    const answer=ui.prompt('Load demo data into this copy',
      'This OVERWRITES member fields, dates, member-owned shifts, hours, statuses, LOAs, patrol logs, signups, history and demo dashboard / promotion data. Ranks, callsigns, slot-owned shifts and template layout stay. Linked form responses are retained and later syncs can import them. A linked public roster will receive the demo through its publishing queue. Use a demo COPY with its own connections.\n\nType LOAD DEMO to continue.',ui.ButtonSet.OK_CANCEL);
    if(answer.getSelectedButton()!==ui.Button.OK||answer.getResponseText().trim()!=='LOAD DEMO')return;
    const message=withPatrolCreditLock_(()=>{
      previous=DEV_WEBHOOKS_OFF_;suppressed=true;DEV_WEBHOOKS_OFF_=true;
      let failure;
      const progress={writesStarted:false};
      try{return seedDemoRosterCore_(progress);}
      catch(e){failure=e;throw new Error((progress.writesStarted?'Demo loading stopped: ':'Demo loading stopped before changing demo data: ')+diagnosticText_(e&&e.message||e,400)+(progress.writesStarted?'\nSome data may already have been written; inspect this copy before retrying.':''));}
      // Queue even a partial write while still holding the writer lock.
      finally{
        try{if(progress.writesStarted&&typeof publishMarkDirty_==='function')publishMarkDirty_();}
        catch(e){throw new Error('Demo publishing could not be queued: '+diagnosticText_(e&&e.message||e,300)+(failure?'\nDemo loading also stopped: '+diagnosticText_(failure&&failure.message||failure,300):'')+'. Demo data may already have been written; inspect this copy before retrying.');}
      }
    });
    ui.alert(message.indexOf('⚠')===-1?'Demo data loaded':'Demo loaded with notes',message,ui.ButtonSet.OK);
  }); } finally { if(suppressed)DEV_WEBHOOKS_OFF_=previous; }
}

/** Fail on unsafe mappings before any demo content is changed. */
function demoPreflight_(ss, roster, RC) {
  const start = CONFIG.rosterStartRow, width = roster.getMaxColumns();
  if (!RC.headerRow || start <= RC.headerRow || start > roster.getMaxRows()) throw new Error('Resolve roster headers and put the first member row below them before loading a demo.');
  const required = ['rank','unit','name','discord','join','promo','hours','activity'], used = new Set();
  required.forEach(key => {
    const col=RC[key]; if(!Number.isInteger(col)||col<1||col>width||used.has(col))throw new Error('Demo roster column is missing or overlaps another role: '+key+'.');
    used.add(col);
  });
  // rosterCols_ has legacy fallbacks; a fallback is not permission to overwrite an unlabeled cell.
  const headers=roster.getRange(RC.headerRow,1,1,roster.getLastColumn()).getDisplayValues()[0].map(norm_);
  const matches={rank:h=>/RANK/.test(h)&&!/GROUP|TIME/.test(h),unit:h=>/^UNIT\b|CALLSIGN/.test(h),
    name:h=>/NAME/.test(h)&&!/OOC/.test(h),discord:h=>/UNIQUE|DISCORD|COMMUNITY.*ID|MEMBER.*ID|CID/.test(h),
    join:h=>/JOIN/.test(h),promo:h=>/PROMOT/.test(h),hours:h=>/HOURS/.test(h)&&!/MAY|JUN|PREVIOUS|LAST/.test(h),
    activity:h=>/ACTIVITY|STATUS/.test(h)&&!/PREVIOUS|LAST/.test(h)};
  required.forEach(k=>{if(!matches[k](headers[RC[k]-1]||''))throw new Error('Resolve the demo roster '+k+' header before loading.');});
  const names = new Map();
  Object.keys(CONFIG.sheets).forEach(role => {
    const name=CONFIG.sheets[role];if(!name)return;
    const key=tabKey_(name);if(names.has(key))throw new Error('Demo sheet mappings overlap: '+role+' and '+names.get(key)+'.');names.set(key,role);
    if(key===tabKey_(CONFIG_SHEET_NAME)||key===tabKey_(SYS_LOG_SHEET))throw new Error('Demo data is mapped to an engine settings/log tab.');
  });
  assertNoPendingActivityReset_(roster);assertNoPendingRosterRecovery_(roster,'Load Demo Roster');
  const check=(role,resolve,startRow,keys)=>{
    const name=CONFIG.sheets[role];if(!name)return null;
    const sh=ss.getSheetByName(name);if(!sh)throw new Error('Configured demo '+role+' tab was not found: '+name+'.');
    const cols=resolve(sh),begin=typeof startRow==='function'?startRow(cols):startRow;
    const label=cols.labelRow||cols.headerRow;
    if(!label||begin<=label||begin>sh.getMaxRows())throw new Error('Resolve '+role+' headers/data start before loading a demo.');
    const seen=new Set();
    Object.keys(cols).filter(k=>!['width','labelRow','headerRow','dataStart'].includes(k)&&cols[k]).forEach(k=>{
      const col=cols[k];if(!Number.isInteger(col)||col<1||col>sh.getMaxColumns()||seen.has(col))throw new Error('Missing or overlapping '+role+' column: '+k+'.');seen.add(col);
    });
    if(!Number.isInteger(cols.width)||cols.width<1||cols.width>sh.getMaxColumns()||keys.some(k=>!cols[k]))throw new Error('Resolve required '+role+' columns before loading a demo.');
    return sh;
  };
  const tracker=check('tracker',trackerCols_,CONFIG.trackerStartRow,['key','discord','start','end','status']);
  if((CONFIG.leaveTypes||[]).length&&!tracker)throw new Error('Configure a leave tracker before loading demo leaves.');
  check('patrolLog',patrolLogCols_,CONFIG.patrolStartRow,['mark','discord','startDate','endDate','startTime','endTime','status']);
  check('signups',signupCols_,c=>c.dataStart,['discord','name','status']);
}

/** Caller holds the writer lock; no modal UI or outward notifications while mutating the demo copy. */
function seedDemoRosterCore_(progress) {
    const warnings=[];
    const ss = SpreadsheetApp.getActive();
    const roster = getSheetOrWarn_(ss, CONFIG.sheets.roster);
    if (!roster) throw new Error('The configured roster tab was not found.');
    const RC = rosterCols_(roster);           // header-resolved — respects THIS sheet's layout (CALLSIGN, HOURS/ACTIVITY order)
    demoPreflight_(ss, roster, RC);
    const laCols = lastActivityCols_(roster);
    const registry = columnRegistry_(roster);
    const writable = ['name','discord','join','promo','hours','activity','ooc','email','dob','mayHours','junHours','timeInRank'].map(k=>RC[k]).filter(Boolean).concat(laCols);
    if(CONFIG.shiftAssignedBy!=='RANK'&&RC.shift)writable.push(RC.shift);
    // TIME IN RANK is a row-local formula derived from PROMOTION, even when its default class is SLOT.
    if(new Set(writable).size!==writable.length||writable.some(c=>c===RC.rank||c===RC.unit||c>roster.getMaxColumns()||!registry.some(x=>x.col===c&&(x.klass==='MEMBER'||c===RC.timeInRank))))throw new Error('Demo member columns overlap or are classified as SLOT. Review Columns before loading.');
    const start = CONFIG.rosterStartRow;
    const lastRow = roster.getLastRow();
    if (lastRow < start) throw new Error('This roster has no member rows. Add ranks and callsigns before loading a demo.');

    // ---- Identify the member rows (rank + callsign are the OPERATOR's; we only read them) ----
    const n = lastRow - start + 1;
    const ranks = roster.getRange(start, RC.rank, n, 1).getDisplayValues();     // rank label OR (on a legacy divider) a section title
    const calls = roster.getRange(start, RC.unit, n, 1).getDisplayValues();     // callsign; blank on divider rows
    const bandCol = RC.rank > 1 ? RC.rank - 1 : 0;                              // the merged RANK GROUP column sits just left of RANK
    const bands = bandCol ? roster.getRange(start, bandCol, n, 1).getDisplayValues() : null;
    const memberRows = [];                                                      // { r, rank, section } for every real member row
    let currentSection = '';
    for (let i = 0; i < n; i++) {
      const rank = String(ranks[i][0] || '').trim();
      const call = String(calls[i][0] || '').trim();
      const band = bands ? String(bands[i][0] || '').trim() : '';               // merged label only in the band's top row → forward-fill
      if (band) currentSection = band;                                          // RANK GROUP band label tags the rows beneath it
      if (rank && !isMemberSlot_(rank)) {currentSection=rank;continue;}
      if (call || rank) memberRows.push({ r: start + i, rank: rank || 'Member', section: currentSection });
    }
    if (!memberRows.length) throw new Error('No member rows found. Fill ranks / callsigns before loading a demo.');

    // ---- Build a believable person for each member row (some slots stay blank = open positions) ----
    const total = memberRows.length;
    demoId_(total + 3); // reserve non-colliding IDs for all four pending applicants before any writes
    const engine=statusEngine_();
    if(memberRows.some(m=>!statusLadderFor_(m.rank,engine).length))warnings.push('Some ranks have no activity ladder configured. Demo hours are populated, but ordinary activity and history statuses for those ranks are left blank; configured leave statuses still apply. Configure tiers in Settings Studio → Statuses & tiers to enable calculation.');
    const people = memberRows.map((m, i) => demoIsOpen_(i, total) ? demoBlank_() : demoPerson_(i, total, m.rank));
    const filledCount = people.filter((p) => !p.open).length;

    // Spread each RANK's filled members as evenly as possible across the 3 shifts (round-robin within the rank), and
    // rotate each rank's starting shift so any remainder doesn't always pile onto the same shift.
    (function assignShiftsByRank() {
      const SHIFTS = CONFIG.shiftValues || [];
      const slotShifts = RC.shift && CONFIG.shiftAssignedBy==='RANK' ? roster.getRange(start,RC.shift,n,1).getDisplayValues() : null;
      const seen = Object.create(null);
      const startAt = Object.create(null);
      let ranksSeen = 0;
      people.forEach((p, i) => {
        if(slotShifts){p.shift=slotShifts[memberRows[i].r-start][0];return;}
        if (p.open || !SHIFTS.length) return;
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
    if(progress)progress.writesStarted=true;
    runs.forEach((run) => {
      const len = run.endRow - run.startRow + 1;
      const s = people.slice(run.begin, run.end + 1);
      registry.filter(c=>c.klass==='MEMBER'&&writable.indexOf(c.col)===-1&&!(c.col===RC.shift&&CONFIG.shiftAssignedBy==='RANK')).forEach(c=>{
        // Preserve custom calculation formulas while removing old literal member data.
        const formulas=roster.getRange(run.startRow,c.col,len,1).getFormulas();
        formulas.forEach((f,k)=>{if(!f[0])roster.getRange(run.startRow+k,c.col).clearContent().clearNote();});
      });
      writable.forEach(col=>roster.getRange(run.startRow,col,len,1).clearNote());
      roster.getRange(run.startRow,RC.discord,len,1).setNumberFormat('@');
      roster.getRange(run.startRow, RC.name, len, 1).setValues(s.map((p) => [p.name]));
      roster.getRange(run.startRow, RC.discord, len, 1).setValues(s.map((p) => [p.id]));
      roster.getRange(run.startRow, RC.join, len, 1).setValues(s.map((p) => [p.join])).setNumberFormat('d mmm yyyy');
      roster.getRange(run.startRow, RC.promo, len, 1).setValues(s.map((p) => [p.promo])).setNumberFormat('d mmm yyyy');
      roster.getRange(run.startRow, RC.hours, len, 1).setValues(s.map((p) => [p.hours]));
      roster.getRange(run.startRow, RC.activity, len, 1).setValues(s.map((p) => [p.act]));
      laCols.forEach((col,k)=>roster.getRange(run.startRow,col,len,1).setValues(s.map(p=>[p.open?'':p.checks[3-k]])));
      // Optional display columns — filled only when the sheet has them (RC.* is 0 when absent).
      if (RC.ooc) roster.getRange(run.startRow, RC.ooc, len, 1).setValues(s.map((p) => [p.name ? demoOocName_(p.name) : '']));
      if (RC.email) roster.getRange(run.startRow, RC.email, len, 1).setValues(s.map((p) => [p.email]));
      if (RC.dob) roster.getRange(run.startRow, RC.dob, len, 1).setValues(s.map((p) => [p.dob])).setNumberFormat('d mmm yyyy'); // else a raw Date renders as a serial
      if (RC.shift && CONFIG.shiftAssignedBy!=='RANK') roster.getRange(run.startRow, RC.shift, len, 1).setValues(s.map((p) => [p.shift]));
      if (RC.mayHours) roster.getRange(run.startRow, RC.mayHours, len, 1).setValues(s.map((p) => [p.may]));
      if (RC.junHours) roster.getRange(run.startRow, RC.junHours, len, 1).setValues(s.map((p) => [p.jun]));
      if (RC.timeInRank && RC.promo) { // live "days since last promotion" — recalculates daily
        const pc = (typeof cpColLetter_ === 'function') ? cpColLetter_(RC.promo) : String.fromCharCode(64 + RC.promo);
        roster.getRange(run.startRow, RC.timeInRank, len, 1)
          .setFormulas(s.map((p, k) => [`=IF(${pc}${run.startRow + k}="","",TODAY()-INT(${pc}${run.startRow + k}))`]))
          .setNumberFormat('[=1]0" day";0" days"'); // singular at exactly 1 ("1 day", "5 days")
      }
    });

    // ---- TRACKER (in place: clear old data rows, keep header / formatting) ----
    let leaveCount = 0;
    const tracker = ss.getSheetByName(CONFIG.sheets.tracker);
    if (tracker) {
      const ts = CONFIG.trackerStartRow;
      const frame=framedTable_(tracker,ts),end=Math.min(frame.cap-1,tracker.getMaxRows());
      if(end>=ts)tracker.getRange(ts,1,end-ts+1,frame.width).clearContent();
      const leaves = [];
      memberRows.forEach((m, i) => {
        const p = people[i];
        if (p.open) return;
        const oi = { unit: String(calls[m.r - start][0] || '').trim(), ooc: demoOocName_(p.name), shift: p.shift }; // from the just-filled roster (skip a rescan per leave)
        const who = { id: p.id, rank: m.rank, name: p.name };
        if (p.leave) leaves.push({ m: who, L: p.leave, oi: oi });
        (p.pastLeaves || []).forEach((pl) => leaves.push({ m: who, L: { type: pl.type, from: pl.from, to: pl.to, status: CONFIG.expiredStatus || 'Expired' }, oi: oi }));
      });
      if(leaves.length)ensureRoomAboveCap_(tracker,ts+leaves.length-1,ts);
      leaves.forEach((x, i) => demoWriteLeave_(tracker, x.m, x.L, ts + i, x.oi));
      if (typeof sortTracker_ === 'function') sortTracker_(null, tracker);
      leaveCount = leaves.length;
    }

    // ---- HOURS HISTORY (hidden engine tab: 4 fortnightly activity checks per member) ----
    const hist = ss.getSheetByName(CONFIG.sheets.hoursHistory) || ss.insertSheet(CONFIG.sheets.hoursHistory);
    hist.clear();
    if(hist.getMaxColumns()<6)hist.insertColumnsAfter(hist.getMaxColumns(),6-hist.getMaxColumns());
    hist.getRange(1, 1, 1, 6).setValues([['WeekOf', 'DiscordID', 'Name', 'Rank', 'Hours', 'Status']]);
    const hrows = [];
    memberRows.forEach((m, i) => {
      const p = people[i];
      if (p.open) return; // open positions carry no history
      const hs = demoHours_(p.hours);
      for (let k = 0; k < 4; k++) hrows.push([demoSunday_((3 - k) * 2), p.id, p.name, m.rank, hs[k], p.checks[k]]); // *2 = fortnightly cadence
    });
    if (hrows.length) {
      if(hist.getMaxRows()<hrows.length+1)hist.insertRowsAfter(hist.getMaxRows(),hrows.length+1-hist.getMaxRows());
      hist.getRange(2, 2, hrows.length, 1).setNumberFormat('@');
      hist.getRange(2, 1, hrows.length, 6).setValues(hrows);
      hist.getRange(2, 1, hrows.length, 1).setNumberFormat('d mmm yyyy');
    }
    styleStartupSupportSheet_(hist,['WeekOf','DiscordID','Name','Rank','Hours','Status']);
    sortSupportRows_(hist,1,6,'week');ensureSupportFilter_(hist,6);
    try { hist.hideSheet(); } catch (e) { /* already hidden */ }

    // ---- STATS SHEET: employee-count breakdown + leadership box, computed from the FILLED members ----
    const leaders = [];
    for (let i = 0; i < memberRows.length && leaders.length < 4; i++) {
      if (people[i].open) continue;
      const m = memberRows[i];
      leaders.push({ rank: m.rank, callsign: String(calls[m.r - start][0] || '').trim(), name: people[i].name });
    }
    let statsFilled = false;
    try { statsFilled = seedDemoStats_(ss, leaders); } catch (e) { warnings.push('stats: '+diagnosticText_(e&&e.message||e,300));log_('seedDemoRoster.stats', e); }

    // ---- RECENT PROMOTIONS feed: a believable rolling history so the Welcome-page table demos full ----
    let promoCount = 0;
    try { promoCount = seedDemoPromotions_(memberRows, people); } catch (e) { warnings.push('promotions: '+diagnosticText_(e&&e.message||e,300));log_('seedDemoRoster.promotions', e); }

    // ---- PATROL LOG: valid sessions per member that sum to their current hours (log reconciles to the roster) ----
    let patrolCount = 0;
    try { patrolCount = seedDemoPatrolLog_(ss, memberRows, people, calls, start); } catch (e) { warnings.push('patrol: '+diagnosticText_(e&&e.message||e,300));log_('seedDemoRoster.patrol', e); }

    // ---- SIGNUPS: every member reflects a processed signup; a few fresh Pending applicants left to review ----
    let signupInfo = { processed: 0, pending: 0 };
    try { signupInfo = seedDemoSignups_(ss, memberRows, people); } catch (e) { warnings.push('signups: '+diagnosticText_(e&&e.message||e,300));log_('seedDemoRoster.signups', e); }

    [['coverage',()=>tracker?buildCoverageCore_(ss,tracker):null],['groups',()=>buildGroupSheets_()],['academy',()=>buildAcademySheets_()],['dashboard',()=>refreshDashboard_(true)]].forEach(([label,fn])=>{
      try{const result=fn();if(result&&result.skipped&&result.skipped.length)throw new Error(result.skipped.map(s=>s.name+': '+s.why).join('; '));}
      catch(e){warnings.push(label+': '+diagnosticText_(e&&e.message||e,300));log_('seedDemoRoster.'+label,e);}
    });
    try { if (typeof cpInvalidateHealth_ === 'function') cpInvalidateHealth_(); } catch (e) { /* Trust.gs may be absent */ }
    logInfo_('seedDemoRoster', `demo filled ${filledCount}/${total} member rows (${total - filledCount} open); ${leaveCount} leave record(s); ${patrolCount} patrol log(s); signups ${signupInfo.processed} processed + ${signupInfo.pending} pending; ${promoCount} promotion(s); stats ${statsFilled ? 'populated' : 'not found'}.`);
    SpreadsheetApp.flush();
    return `Filled ${filledCount} of ${total} member rows with names, Unique IDs, join/promotion dates, hours and activity status — the other ${total - filledCount} are left as open positions.\n\n` +
      `• Leave Tracker — ${leaveCount} leave record(s).\n` +
      (patrolCount ? `• Patrol Log — ${patrolCount} session(s); each member's logged hours add up to the hours shown on the roster.\n` : '') +
      (signupInfo.processed || signupInfo.pending ? `• Roster Signups — ${signupInfo.processed} processed (every member came through a signup) + ${signupInfo.pending} fresh Pending applicant(s) to review.\n` : '') +
      `• Added 4 fortnightly activity-check snapshots${statsFilled ? ', populated the leadership box' : ''}${promoCount ? `, and seeded ${promoCount} recent promotions` : ''}.\n\n` +
      `Your ranks, callsigns, section dividers, colours and dropdowns were left untouched.`+(signupInfo.pending?' Open 🎛️ Control Panel ▸ Signups to review the pending applicants.':'')+(warnings.length?'\n\n⚠ Notes and incomplete steps:\n'+warnings.join('\n'):'');

}

/**
 * Seed the RECENT PROMOTIONS feed (Document Properties) from the freshly-filled demo members: up to PROMO_MAX_
 * entries at their roster last-promotion dates. Deterministic (demoRand_).
 * Open slots, members on leave and the very top command are skipped. @return {number} entries seeded (0 without the engine file).
 */
function seedDemoPromotions_(memberRows, people) {
  if (typeof renderPromotions_ !== 'function') return 0; // RosterSystem.gs owns the feed — check what we actually call
  const cands = [];
  memberRows.forEach((m, i) => {
    const p = people[i];
    if (p.open || p.leave || i < 2) return;
    cands.push({ n: p.name, r: m.rank, i: i });
  });
  if (!cands.length) {PropertiesService.getDocumentProperties().setProperty(PROMO_STORE_PROP_,'[]');renderPromotions_(true);return 0;}
  cands.sort((a, b) => demoRand_(a.i, 5) - demoRand_(b.i, 5)); // deterministic shuffle — promotions shouldn't run in roster order
  const picks = cands.slice(0, PROMO_MAX_);
  const list = picks.map((c, k) => {
    const entry = { t: people[c.i].promo.getTime(), n: c.n, r: c.r };
    return entry;
  }).sort((a,b)=>b.t-a.t);
  PropertiesService.getDocumentProperties().setProperty(PROMO_STORE_PROP_, JSON.stringify(list));
  renderPromotions_(true); // full rescan — the demo may have just created/filled a promo table on a fresh workbook
  return list.length;
}

/**
 * Fill a recognized leadership box on the configured Welcome tab.
 * The normal dashboard renderer owns counts, category labels and live tags.
 * @return {boolean} whether the leadership box was filled.
 */
function seedDemoStats_(ss, leaders) {
  const sh=ss.getSheetByName(CONFIG.sheets.welcome || 'Welcome Page');
  if(!sh||dashboardSkip_(sh.getName())||sh.getName()===CONFIG.sheets.roster)return false;
  // Counts are owned by the normal configured dashboard renderer; never invent category labels here.
  return fillExecBox_(sh,leaders);
}

/** Fill the leadership box (rank | callsign | name per row) below its wide header — found by a recognized title and callsign/name sub-merges. @return {boolean} */
function fillExecBox_(sheet, leaders) {
  if (!leaders || !leaders.length) return false;
  const limit = Math.min(sheet.getLastRow(), 40);
  if (limit < 4) return false;
  let header = null; // only a recognized single-row leadership header
  sheet.getRange(1, 1, Math.min(limit, sheet.getMaxRows()), sheet.getLastColumn()).getMergedRanges().forEach((mr) => {
    if (mr.getNumRows() === 1 && mr.getNumColumns() >= 4 && /^(EXECUTIVE COMMAND|COMMAND STAFF|LEADERSHIP)$/i.test(String(sheet.getRange(mr.getRow(),mr.getColumn()).getDisplayValue()).trim()) && mr.getRow() <= limit &&
        (!header || mr.getNumColumns() > header.width)) header = { row: mr.getRow(), left: mr.getColumn(), right: mr.getLastColumn(), width: mr.getNumColumns() };
  });
  if (!header) return false;
  let wrote = 0;
  for (let k = 0; k < 4; k++) {
    const r = header.row + 1 + k;
    if (r > sheet.getMaxRows()) break;
    const inner = sheet.getRange(r, header.left, 1, header.right - header.left + 1).getMergedRanges()
      .filter((mr) => mr.getNumRows() === 1 && mr.getRow() === r && mr.getNumColumns() > 1 && mr.getColumn() > header.left && mr.getLastColumn() <= header.right).sort((a, b) => a.getColumn() - b.getColumn());
    if (inner.length < 2) break;                                               // a row without the callsign+name sub-merges = box ended
    const L = leaders[k] || {rank:'',callsign:'',name:''};
    sheet.getRange(r, header.left).setValue(L.rank);                           // rank in the box's left column
    sheet.getRange(r, inner[0].getColumn()).setValue(L.callsign);             // callsign in the first inner merge
    sheet.getRange(r, inner[1].getColumn()).setValue(demoInitialName_(L.name)); // name in the second
    wrote++;
  }
  return wrote > 0;
}
