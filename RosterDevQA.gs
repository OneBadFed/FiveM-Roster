/**
 * ============================================================================
 * ROSTER DEV / QA — adversarial self-verifying test suite.
 * ----------------------------------------------------------------------------
 * Paste as a THIRD file alongside RosterSystem.gs (+ RosterExtras.gs optional).
 * Run devRunAllTests() (or 🧪 Dev / QA → Run ALL Tests). Add addDevMenu_() to
 * your core onOpen() to get the menu.
 *
 * SAFETY: every write-test runs against "🧪SANDBOX_" tabs — never your real
 * "Member Information" / "LOA/ROA Tracker" / "LOA/ROA Form Response" tabs (the
 * SANDBOX_ naming is the guarantee, not teardown). For SPEED, the ~20 sandbox
 * tabs are created once and then PERSIST HIDDEN, reused + cleared on each run so
 * a repeated run pays no insert/delete churn. Remove them any time via
 * 🧪 Dev / QA → "Delete Sandbox / Results Tabs". Tests call the REAL injectable
 * cores (processDailyLOAs_, syncFormToTracker_, recomputeStatuses_, checkForMemberMove).
 *
 * Results go to a themed "🧪 Test Results" tab + a popup. Detail strings are
 * forced to plain text so nothing renders as a #NAME? formula.
 * ============================================================================
 */

const SANDBOX_PREFIX = '🧪SANDBOX_';
const RESULTS_TAB = '🧪 Test Results';

// Theming the transient sandbox tabs is pure overhead (they're deleted at teardown) and was a big
// chunk of the run time, so it's OFF by default to keep "Run ALL Tests" under Apps Script's ~6-min
// execution cap. The persistent "🧪 Test Results" tab is ALWAYS themed. Flip to true to theme sandboxes.
const DEV_THEME_SANDBOX = false;

/* ======================================================================
 * MENU
 * ====================================================================== */
function addDevMenu_(prefix) {
  const p = prefix || ''; // '' bound; 'RE.' in library mode (Phase 2)
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🧪 Dev / QA')
    .addItem('🎬 Load Demo Roster (preview)', p + 'seedDemoRoster')
    .addSeparator()
    .addItem('▶️ Run ALL Tests', p + 'devRunAllTests')
    .addSubMenu(ui.createMenu('🔬 Run one section')
      .addItem('1 · Unit / pure functions', p + 'devRunSection1')
      .addItem('2 · Status engine', p + 'devRunSection2')
      .addItem('3 · Leave lifecycle', p + 'devRunSection3')
      .addItem('4 · Form sync & dedup', p + 'devRunSection4')
      .addItem('5 · Roster maintenance', p + 'devRunSection5')
      .addItem('6 · Discord field guard', p + 'devRunSection6')
      .addItem('7 · ID matching / precision', p + 'devRunSection7')
      .addItem('8 · Adversarial & platform', p + 'devRunSection8')
      .addItem('9 · Control Panel & audit', p + 'devRunSection9')
      .addItem('10 · Extras: history / coverage', p + 'devRunSection10')
      .addItem('11 · Trust: snapshots / schema', p + 'devRunSection11')
      .addItem('12 · Config engine', p + 'devRunSection12')
      .addItem('13 · Dispatch & migrations', p + 'devRunSection13')
      .addItem('14 · White-label & config', p + 'devRunSection14')
      .addItem('15 · Identity-keyed writes', p + 'devRunSection15')
      .addItem('16 · Config-tab robustness', p + 'devRunSection16')
      .addItem('17 · Dashboard render safety', p + 'devRunSection17')
      .addItem('18 · Settings apply', p + 'devRunSection18')
      .addItem('19 · v2.5.0 config extensions', p + 'devRunSection19')
      .addItem('20 · New-layout column resolution', p + 'devRunSection20'))
    .addItem('🧹 Delete Sandbox / Results Tabs', p + 'devCleanup')
    .addToUi();
}

function devCleanup() {
  const ss = SpreadsheetApp.getActive();
  devDeleteSandbox_();
  const res = ss.getSheetByName(RESULTS_TAB);
  if (res) ss.deleteSheet(res);
  SpreadsheetApp.getUi().alert('🧹 Removed sandbox + results tabs.');
}

/* ======================================================================
 * GROUP REGISTRY — single source of truth for Run-ALL and Run-one-section.
 * (Function declarations are hoisted, so referencing them here is safe.)
 * ====================================================================== */
const DEV_GROUPS = [
  ['Unit / pure functions', devUnitTests_],
  ['Status engine (sandbox)', devStatusTests_],
  ['Leave lifecycle (sandbox)', devLifecycleTests_],
  ['Form sync & dedup (sandbox)', devSyncTests_],
  ['Roster maintenance (sandbox)', devMaintenanceTests_],
  ['Discord field guard', devWebhookTests_],
  ['ID matching / precision (sandbox)', devIdMatchTests_],
  ['Adversarial & platform', devAdversarialTests_],
  ['Control Panel & audit (sandbox)', devPanelTests_],
  ['Extras: history / coverage (sandbox)', devExtrasTests_],
  ['Trust: snapshots / schema (sandbox)', devTrustTests_],
  ['Config engine (sandbox)', devConfigTests_],
  ['Dispatch & migrations (sandbox)', devConfigDispatchTests_],
  ['White-label & config vocabulary (sandbox)', devWhiteLabelTests_],
  ['Identity-keyed writes & concurrency (sandbox)', devIdentityWriteTests_],
  ['Config-tab robustness (sandbox)', devConfigRobustnessTests_],
  ['Dashboard render safety (sandbox)', devDashboardRenderTests_],
  ['Settings apply (sandbox)', devSettingsApplyTests_],
  ['v2.5.0 config extensions (sandbox)', devV25Tests_],
  ['New-layout column resolution (sandbox)', devNewLayoutTests_],
];

/* ======================================================================
 * ENTRY POINT — runs every group, guarantees teardown, reports
 * ====================================================================== */
function devRunAllTests() {
  const collectors = [];
  // PREFLIGHT (F-028) — runs before every section so a customized live config is flagged up front, not as mystery reds.
  try { collectors.push(devConfigPreflight_()); }
  catch (e) { const R = devNewResults_('Config preflight — CRASHED'); devCheck_(R, 'preflight ran without throwing', false, String((e && e.stack) || e)); collectors.push(R); }
  try {
    DEV_GROUPS.forEach(([label, fn]) => {
      try {
        collectors.push(fn());
      } catch (e) {
        const R = devNewResults_(`${label} — CRASHED`);
        devCheck_(R, 'group ran without throwing', false, String((e && e.stack) || e));
        collectors.push(R);
      }
    });
  } finally {
    devHideSandbox_(); // teardown ALWAYS — hide (not delete) so a repeated run reuses the tabs (no create/delete churn)
  }
  const totals = devWriteResults_(collectors);
  devPopup_(totals);
}

/* ======================================================================
 * RUN ONE SECTION — same teardown/report as Run-ALL, for a single group.
 * Faster, and stays comfortably under the execution cap on a consumer account.
 * ====================================================================== */
/** Runs one group fn with guaranteed sandbox teardown, then writes results + popup. */
function devRunOne_(label, fn) {
  let collector;
  try {
    try {
      collector = fn();
    } catch (e) {
      collector = devNewResults_(`${label} — CRASHED`);
      devCheck_(collector, 'group ran without throwing', false, String((e && e.stack) || e));
    }
  } finally {
    devHideSandbox_(); // teardown ALWAYS — hide (not delete) so a repeated run reuses the tabs (no create/delete churn)
  }
  const totals = devWriteResults_([collector]);
  devPopup_(totals);
}

/** Menu dispatcher: runs DEV_GROUPS[i] (1-based index) on its own. */
function devRunSectionByIndex_(i) {
  const g = DEV_GROUPS[i - 1];
  if (!g) { SpreadsheetApp.getUi().alert(`No test section #${i}.`); return; }
  devRunOne_(g[0], g[1]);
}

// One named global per section — menu targets must be global, non-underscore function names.
function devRunSection1() { devRunSectionByIndex_(1); }
function devRunSection2() { devRunSectionByIndex_(2); }
function devRunSection3() { devRunSectionByIndex_(3); }
function devRunSection4() { devRunSectionByIndex_(4); }
function devRunSection5() { devRunSectionByIndex_(5); }
function devRunSection6() { devRunSectionByIndex_(6); }
function devRunSection7() { devRunSectionByIndex_(7); }
function devRunSection8() { devRunSectionByIndex_(8); }
function devRunSection9() { devRunSectionByIndex_(9); }
function devRunSection10() { devRunSectionByIndex_(10); }
function devRunSection11() { devRunSectionByIndex_(11); }
function devRunSection12() { devRunSectionByIndex_(12); }
function devRunSection13() { devRunSectionByIndex_(13); }
function devRunSection14() { devRunSectionByIndex_(14); }
function devRunSection15() { devRunSectionByIndex_(15); }
function devRunSection16() { devRunSectionByIndex_(16); }
function devRunSection17() { devRunSectionByIndex_(17); }
function devRunSection18() { devRunSectionByIndex_(18); }
function devRunSection19() { devRunSectionByIndex_(19); }
function devRunSection20() { devRunSectionByIndex_(20); }

/* ======================================================================
 * RESULTS FRAMEWORK
 * ====================================================================== */
function devNewResults_(suite) { return { suite, rows: [], pass: 0, fail: 0 }; }

function devCheck_(R, name, cond, detail) {
  if (cond) { R.pass++; R.rows.push(['PASS', name, detail || '']); }
  else { R.fail++; R.rows.push(['FAIL', name, detail || '']); }
}

function devEq_(R, name, actual, expected) {
  const ok = actual === expected;
  devCheck_(R, name, ok, ok ? `→ ${devShow_(expected)}` : `got ${devShow_(actual)}, expected ${devShow_(expected)}`);
}

function devInfo_(R, name, detail) { R.rows.push(['INFO', name, detail || '']); }

function devShow_(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (v instanceof Date) return isNaN(v.getTime()) ? 'Invalid Date' : Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return String(v);
}

/** Neutralizes a value that could render as a formula/boolean in a cell. */
function devSafeText_(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  return (s.length && '=+-@'.indexOf(s.charAt(0)) !== -1) ? `'${s}` : s;
}

/** Writes all collectors to the themed results tab. Returns {pass, fail}. */
function devWriteResults_(collectors) {
  const ss = SpreadsheetApp.getActive();
  const old = ss.getSheetByName(RESULTS_TAB);
  if (old) ss.deleteSheet(old);
  const sh = ss.insertSheet(RESULTS_TAB, 0);

  let totalPass = 0;
  let totalFail = 0;
  collectors.forEach((c) => { totalPass += c.pass; totalFail += c.fail; });

  const out = [];
  out.push(['Roster — Dev / QA Results', '', '']);
  out.push(['Run', Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss'), '']);
  out.push([totalFail === 0 ? '✅ ALL PASSED' : `❌ ${totalFail} FAILED`, `${totalPass} passed / ${totalFail} failed`, '']);
  out.push(['', '', '']);

  const sectionRows = [];
  collectors.forEach((c) => {
    sectionRows.push({ type: 'section', row: out.length });
    out.push([c.suite, `${c.pass} passed, ${c.fail} failed`, '']);
    sectionRows.push({ type: 'header', row: out.length });
    out.push(['Result', 'Test', 'Detail']);
    c.rows.forEach((r) => out.push([r[0], devSafeText_(r[1]), devSafeText_(r[2])]));
    out.push(['', '', '']);
  });

  const range = sh.getRange(1, 1, out.length, 3);
  range.setNumberFormat('@'); // force text BEFORE writing — the real #NAME? guard
  range.setValues(out).setFontFamily('Roboto');
  sh.getRange(1, 3, out.length, 1).setFontFamily('Roboto Mono'); // detail column = monospace

  // Colour + weight the WHOLE grid in THREE bulk writes (setBackgrounds/setFontColors/setFontWeights) instead
  // of a per-row setBackground loop — that loop (one Sheets round-trip per assertion) was by far the biggest
  // slice of the run's wall-clock, and is what pushed a full run toward the ~6-min execution cap.
  const cCANVAS = theme_('CANVAS'), cTXT = theme_('TEXT'), cSTRONG = theme_('TEXT_STRONG');
  const cPASS = theme_('PASS'), cFAIL = theme_('FAIL'), cINFO = theme_('INFO');
  const cBANNER = theme_('BANNER'), cSUB = theme_('SUBHEAD'), cSUBTX = theme_('SUBHEAD_TEXT');
  const bg = new Array(out.length), fc = new Array(out.length), fw = new Array(out.length);
  for (let r = 0; r < out.length; r++) {
    const tag = out[r][0];
    if (tag === 'FAIL') { bg[r] = [cFAIL, cFAIL, cFAIL]; fc[r] = [cSTRONG, cSTRONG, cSTRONG]; }
    else {
      bg[r] = [tag === 'PASS' ? cPASS : tag === 'INFO' ? cINFO : cCANVAS, cCANVAS, cCANVAS];
      fc[r] = [(tag === 'PASS' || tag === 'INFO') ? cSTRONG : cTXT, cTXT, cTXT];
    }
    fw[r] = ['normal', 'normal', 'normal'];
  }
  const band = (i, b, f) => { bg[i] = [b, b, b]; fc[i] = [f, f, f]; fw[i] = ['bold', 'bold', 'bold']; };
  band(0, cBANNER, cSTRONG);                                              // title row
  band(2, totalFail === 0 ? cPASS : cFAIL, cSTRONG);                      // summary row
  sectionRows.forEach((s) => band(s.row, s.type === 'section' ? cCANVAS : cSUB, s.type === 'section' ? cSTRONG : cSUBTX));
  range.setBackgrounds(bg).setFontColors(fc).setFontWeights(fw);

  sh.getRange(1, 1, 1, 3).merge().setFontSize(18).setFontFamily('Squada One'); // title = merged banner
  sh.setColumnWidth(1, 90); sh.setColumnWidth(2, 430); sh.setColumnWidth(3, 560);
  sh.setFrozenRows(3);

  SpreadsheetApp.flush();
  return { pass: totalPass, fail: totalFail };
}

function devPopup_(totals) {
  const msg = totals.fail === 0
    ? `✅ All tests passed (${totals.pass} assertions).\n\nSee the "${RESULTS_TAB}" tab.`
    : `❌ ${totals.fail} of ${totals.pass + totals.fail} assertions FAILED.\n\nOpen "${RESULTS_TAB}" — failing rows are red.`;
  SpreadsheetApp.getUi().alert(msg);
}

/* ======================================================================
 * SANDBOX BUILDERS + TEST DATA (batched writes; precision-safe IDs)
 * ====================================================================== */
function devFreshSheet_(suffix) {
  const ss = SpreadsheetApp.getActive();
  const name = SANDBOX_PREFIX + suffix;
  const existing = ss.getSheetByName(name);
  if (existing) {
    // REUSE the tab (clear content + formats) instead of delete+insert. insert/deleteSheet are the slowest
    // Sheets ops; sandboxes now PERSIST (hidden) between runs, so a repeated run pays ZERO create/delete
    // churn — the ~20 sandbox tabs are made once and reused. Invalidate rosterCols_'s per-sheet-id cache too.
    existing.clear();
    if (!existing.isSheetHidden()) existing.hideSheet();
    try { if (typeof _rosterColCache === 'object' && _rosterColCache) delete _rosterColCache[String(existing.getSheetId())]; } catch (e) { /* cache is best-effort */ }
    return existing;
  }
  const sh = ss.insertSheet(name);
  sh.hideSheet(); // hidden + persistent: reused on the next run, cleared each time, removed via the Cleanup menu
  return sh;
}

/** Hides every sandbox tab (cheap — only touches ones still visible). Sandboxes persist between runs for reuse. */
function devHideSandbox_() {
  const ss = SpreadsheetApp.getActive();
  ss.getSheets().forEach((sh) => { if (sh.getName().indexOf(SANDBOX_PREFIX) === 0 && !sh.isSheetHidden()) sh.hideSheet(); });
}

/** Applies the dark "command-console" theme (navy header, mono IDs) to a sandbox tab. */
function devTheme_(sheet, headerRow, idCol) {
  const last = Math.max(sheet.getLastRow(), headerRow);
  const cols = Math.max(sheet.getLastColumn(), 1);
  sheet.getRange(1, 1, last, cols).setBackground(theme_('CANVAS')).setFontColor(theme_('TEXT')).setFontFamily('Roboto');
  sheet.getRange(headerRow, 1, 1, cols).setBackground(theme_('BANNER')).setFontColor(theme_('TEXT_STRONG')).setFontWeight('bold');
  if (idCol >= 1 && idCol <= cols) sheet.getRange(1, idCol, last, 1).setFontFamily('Roboto Mono');
}

function devDeleteSandbox_() {
  const ss = SpreadsheetApp.getActive();
  ss.getSheets().forEach((sh) => { if (sh.getName().indexOf(SANDBOX_PREFIX) === 0) ss.deleteSheet(sh); });
}

/** Unique, precision-safe 18-digit Discord-like ID by STRING concat (never arithmetic). */
function devId_(i) {
  let suffix = String(i);
  while (suffix.length < 7) suffix = `0${suffix}`;
  return `11000000000${suffix}`; // 11 fixed + 7 = 18 digits, all distinct
}

/** Today +/- offset days at midnight (keeps the suite from rotting). */
function devDay_(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

/** Sandbox roster: headers row 5, members from CONFIG.rosterStartRow. members:{rank,name,id,activity,hours}. */
function devBuildRoster_(members) {
  const sh = devFreshSheet_('Roster');
  sh.getRange(5, 2, 1, 8).setValues([['RANK', 'NAME', 'UNIT', 'DISCORD', 'JOIN', 'PROMO', 'ACTIVITY', 'HOURS']]);
  if (members.length) {
    const rows = members.map((m) => [
      m.rank ?? 'Trooper', m.name ?? '', m.unit ?? '', m.id ?? '', m.join ?? '', m.promo ?? '',
      m.activity ?? '', m.hours === undefined ? '' : m.hours,
    ]);
    sh.getRange(CONFIG.rosterStartRow, CONFIG.roster.discord, members.length, 1).setNumberFormat('@'); // IDs exact
    sh.getRange(CONFIG.rosterStartRow, 2, members.length, 8).setValues(rows); // cols B..I
  }
  if (DEV_THEME_SANDBOX) devTheme_(sh, 5, CONFIG.roster.discord);
  return sh;
}

/** Sandbox tracker: data from CONFIG.trackerStartRow. leaves:{key,rank,name,id,type,start,end,status}. */
function devBuildTracker_(leaves) {
  const sh = devFreshSheet_('Tracker');
  sh.getRange(5, 1, 1, 12).setValues([['KEY', 'RANK', 'NAME', 'UNIT', 'DISCORD', 'TYPE', 'START', 'END', 'LEN', 'UNTIL', 'LEFT', 'STATUS']]);
  if (leaves.length) {
    const rows = leaves.map((L) => [
      L.key ?? '', L.rank ?? 'Trooper', L.name ?? '', L.unit ?? '', L.id ?? '', L.type ?? 'LOA',
      L.start ?? '', L.end ?? '', '', '', '', L.status ?? 'Pending',
    ]);
    sh.getRange(CONFIG.trackerStartRow, CONFIG.tracker.discord, leaves.length, 1).setNumberFormat('@');
    sh.getRange(CONFIG.trackerStartRow, 1, leaves.length, 12).setValues(rows); // cols A..L
  }
  if (DEV_THEME_SANDBOX) devTheme_(sh, 5, CONFIG.tracker.discord);
  return sh;
}

/** Sandbox form: headers row 1, submissions from row 2. subs:{ts,name,id,callsign,rank,type,start,end}. */
function devBuildForm_(subs) {
  const sh = devFreshSheet_('Form');
  sh.getRange(1, 1, 1, 8).setValues([['Timestamp', 'Name', 'Discord', 'Callsign', 'Rank', 'Type', 'Start', 'End']]);
  if (subs.length) {
    const rows = subs.map((s) => [
      s.ts ?? new Date(), s.name ?? '', s.id ?? '', s.callsign ?? '', s.rank ?? 'Trooper',
      s.type ?? 'LOA', s.start ?? '', s.end ?? '',
    ]);
    sh.getRange(2, CONFIG.form.discord, subs.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, subs.length, 8).setValues(rows);
  }
  if (DEV_THEME_SANDBOX) devTheme_(sh, 1, CONFIG.form.discord);
  return sh;
}

/* --- mirrors of NON-injectable live functions (flagged in results) --- */

/** Mirror of updateUnitNumbers_ against a sandbox sheet (uses the REAL isMemberSlot_). */
function devNumberSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.rosterStartRow) return;
  const n = lastRow - CONFIG.rosterStartRow + 1;
  const ranks = sheet.getRange(CONFIG.rosterStartRow, CONFIG.roster.rank, n, 1).getValues();
  const units = [];
  let counter = 1;
  for (let i = 0; i < n; i++) {
    if (isMemberSlot_(ranks[i][0])) { units.push([formatUnit_(counter)]); counter++; } // v2.5.0: mirror the real formatUnit_
    else units.push(['']);
  }
  sheet.getRange(CONFIG.rosterStartRow, CONFIG.roster.unit, n, 1).setValues(units);
}

/** Mirror of checkDuplicateDiscordIds against a sandbox sheet (uses the REAL isValidMemberValues_). */
function devScanDuplicateIds_(roster) {
  const last = roster.getLastRow();
  const n = Math.max(0, last - CONFIG.rosterStartRow + 1);
  const ranks = n ? roster.getRange(CONFIG.rosterStartRow, CONFIG.roster.rank, n, 1).getValues() : [];
  const names = n ? roster.getRange(CONFIG.rosterStartRow, CONFIG.roster.name, n, 1).getValues() : [];
  const ids = n ? roster.getRange(CONFIG.rosterStartRow, CONFIG.roster.discord, n, 1).getDisplayValues() : [];
  const seen = {};
  const malformed = [];
  for (let i = 0; i < n; i++) {
    if (!isValidMemberValues_(ranks[i][0], names[i][0])) continue;
    const id = String(ids[i][0]).trim();
    if (id === '') continue;
    if (!/^\d{17,19}$/.test(id)) malformed.push(id);
    (seen[id] = seen[id] || []).push(i);
  }
  const duplicates = Object.keys(seen).filter((k) => seen[k].length > 1);
  return { duplicates, malformed };
}

/** Reads a sandbox roster row's activity / a tracker row's status. */
function devActivity_(roster, idx) { return roster.getRange(CONFIG.rosterStartRow + idx, CONFIG.roster.activity).getValue(); }
function devTrackerStatus_(tracker, idx) { return tracker.getRange(CONFIG.trackerStartRow + idx, CONFIG.tracker.status).getValue(); }
function devDataRows_(sheet, startRow) { return Math.max(0, sheet.getLastRow() - startRow + 1); }

/* ======================================================================
 * SECTION 20 — NEW-LAYOUT COLUMN RESOLUTION
 * Two-row header (group banners + labels), a merged RANK GROUP band, renamed
 * labels (STATUS, UNIQUE ID) and the added display columns. Covers rosterCols_'s
 * header auto-find + the optional columns that had no test before.
 * ====================================================================== */
function devNewLayoutTests_() {
  const R = devNewResults_('New-layout column resolution (sandbox)');
  const sh = devFreshSheet_('Layout');

  // Group BANNERS on row 5, real labels on row 6, data from row 8. Row 5 deliberately does NOT look like a
  // header (no RANK/HOURS) so this also exercises the auto-find scan when HEADER_ROW points at the banner row.
  sh.getRange(5, 3, 1, 1).setValue('MEMBER INFORMATION');
  sh.getRange(6, 2, 1, 14).setValues([[
    'RANK GROUP', 'RANK', 'UNIT NUMBER', 'OOC NAME', 'NAME', 'UNIQUE ID', 'SHIFT',
    'HOURS', 'STATUS', 'MAY HOURS', 'JUN. HOURS', 'JOIN DATE', 'TIME IN RANK', 'LAST PROMOTION',
  ]]);
  sh.getRange(8, 3, 1, 1).setValue('Chief of Police'); // one data row so getLastRow() clears the header

  const RC = rosterCols_(sh);
  devEq_(R, 'auto-finds label row → rank = C (RANK, skips RANK GROUP)', RC.rank, 3);
  devEq_(R, 'unit = D (UNIT NUMBER)', RC.unit, 4);
  devEq_(R, 'ooc = E (OOC NAME)', RC.ooc, 5);
  devEq_(R, 'name = F (NAME, skips OOC NAME)', RC.name, 6);
  devEq_(R, 'discord = G (UNIQUE ID — no "Discord" in the label)', RC.discord, 7);
  devEq_(R, 'shift = H (SHIFT)', RC.shift, 8);
  devEq_(R, 'hours = I (first HOURS, not MAY/JUN)', RC.hours, 9);
  devEq_(R, 'activity = J (STATUS)', RC.activity, 10);
  devEq_(R, 'mayHours = K (MAY HOURS)', RC.mayHours, 11);
  devEq_(R, 'junHours = L (JUN. HOURS)', RC.junHours, 12);
  devEq_(R, 'join = M (JOIN DATE)', RC.join, 13);
  devEq_(R, 'timeInRank = N (TIME IN RANK)', RC.timeInRank, 14);
  devEq_(R, 'promo = O (LAST PROMOTION)', RC.promo, 15);

  // fillTimeInRank_ gives every member slot a live "days since LAST PROMOTION" formula; non-members stay blank.
  sh.getRange(8, 15).setValue(devDay_(-30)); // LAST PROMOTION 30 days ago on the member row
  const tirCount = fillTimeInRank_(sh);
  devCheck_(R, 'fillTimeInRank_ writes a live TODAY() formula on the member row', /TODAY\(\)/.test(sh.getRange(8, 14).getFormula()));
  devCheck_(R, 'fillTimeInRank_ reports the member as filled', tirCount >= 1);

  // Rolling archive shift (RosterExtras.gs): HOURS → rightmost period col; each takes the next; oldest drops off.
  if (typeof shiftArchiveColumns_ === 'function') {
    sh.getRange(8, 9).setValue(20);  // HOURS (I)
    sh.getRange(8, 11).setValue(5);  // MAY HOURS (K)
    sh.getRange(8, 12).setValue(10); // JUN. HOURS (L)
    const shiftedN = shiftArchiveColumns_(sh, 'JUL HOURS');
    devEq_(R, 'shiftArchiveColumns_ reports 2 period columns', shiftedN, 2);
    devEq_(R, 'archive shift: left col takes the next period\'s data', sh.getRange(8, 11).getValue(), 10);
    devEq_(R, 'archive shift: right col takes current HOURS', sh.getRange(8, 12).getValue(), 20);
    devEq_(R, 'archive relabel: right header = new period label', String(sh.getRange(6, 12).getValue()), 'JUL HOURS');
    devEq_(R, 'archive relabel: left header = the previous right header', String(sh.getRange(6, 11).getValue()), 'JUN. HOURS');
  } else { devInfo_(R, 'shiftArchiveColumns_ not loaded', 'RosterExtras.gs absent — skipped'); }

  // Group-sheet marker parsing (RosterExtras.gs): "#group: Column = Value" and the "#group: Value" shorthand.
  if (typeof groupMarker_ === 'function') {
    const gsh = devFreshSheet_('Group');
    gsh.getRange(1, 1).setValue('#group: Shift = Day');
    const g1 = groupMarker_(gsh);
    devEq_(R, 'groupMarker_ parses the column', g1 && g1.column, 'Shift');
    devEq_(R, 'groupMarker_ single value', g1 && g1.values.join(','), 'Day');
    devEq_(R, 'groupMarker_ no pipe → no extras', g1 && g1.extras.length, 0);
    gsh.getRange(1, 1).setValue('#group: Rank in Police Cadet, Probationary Officer');
    const gm = groupMarker_(gsh);
    devEq_(R, 'groupMarker_ multi-value "in" → 2 values', gm && gm.values.length, 2);
    devEq_(R, 'groupMarker_ multi-value first value', gm && gm.values[0], 'Police Cadet');
    gsh.getRange(1, 1).setValue('#group: Shift = Day | Beat, Vehicle');
    const g3 = groupMarker_(gsh);
    devEq_(R, 'groupMarker_ parses 2 extra columns', g3 && g3.extras.length, 2);
    devEq_(R, 'groupMarker_ first extra column', g3 && g3.extras[0], 'Beat');
    gsh.getRange(1, 1).setValue('#group: Nights');
    const g2 = groupMarker_(gsh);
    devEq_(R, 'groupMarker_ shorthand → value only', g2 && g2.values.join(','), 'Nights');
    devEq_(R, 'groupMarker_ shorthand → no column', g2 && g2.column, '');
    gsh.getRange(1, 1).setValue('not a marker');
    devEq_(R, 'groupMarker_ no marker → null', groupMarker_(gsh), null);
    if (typeof suggestMarker_ === 'function') {
      devEq_(R, 'suggestMarker_ "Day Shift" → Shift = Day', suggestMarker_('Day Shift'), '#group: Shift = Day');
      devEq_(R, 'suggestMarker_ "Troop A" → Troop = A', suggestMarker_('Troop A'), '#group: Troop = A');
      devEq_(R, 'suggestMarker_ "Academy" → Rank in …', suggestMarker_('Academy'), '#group: Rank in Police Cadet, Probationary Officer');
    }
    if (typeof inferGroup_ === 'function') {
      const iDay = inferGroup_('Day Shift');
      devEq_(R, 'inferGroup_ "Day Shift" → column Shift', iDay.column, 'Shift');
      devEq_(R, 'inferGroup_ "Day Shift" → value Day', iDay.values.join(','), 'Day');
      devEq_(R, 'inferGroup_ "Academy" → 2 rank values', inferGroup_('Academy').values.length, 2);
      devEq_(R, 'inferGroup_ bare name → no column (auto-find)', inferGroup_('Alpha').column, '');
    }
  } else { devInfo_(R, 'groupMarker_ not loaded', 'RosterExtras.gs absent — skipped'); }

  // Police Academy (editable tracker) marker + column resolution (RosterExtras.gs).
  if (typeof academyMarker_ === 'function') {
    const ash = devFreshSheet_('Academy');
    ash.getRange(1, 1).setValue('#academy: Rank in Police Cadet, Probationary Officer');
    const am = academyMarker_(ash);
    devEq_(R, 'academyMarker_ → 2 ranks', am && am.ranks.length, 2);
    devEq_(R, 'academyMarker_ first rank', am && am.ranks[0], 'Police Cadet');
    ash.getRange(1, 1).setValue('nothing here');
    devEq_(R, 'academyMarker_ none → null', academyMarker_(ash), null);
    const AC = academyCols_(['UNIQUE ID', 'RANK', 'NAME', 'EXAM', 'RIDE-ALONGS', 'GRADUATED']);
    devEq_(R, 'academyCols_ id col', AC.id, 1);
    devEq_(R, 'academyCols_ name col', AC.name, 3);
    devEq_(R, 'academyCols_ graduated col', AC.grad, 6);
    devEq_(R, 'academyCols_ ignores training cols', AC.rank, 2);
    if (typeof academyStems_ === 'function') {
      devEq_(R, 'academyStems_ "CADETS" → CADET', academyStems_('CADETS').join(','), 'CADET');
      devEq_(R, 'academyStems_ "Police Cadet" → CADET', academyStems_('Police Cadet').join(','), 'CADET');
      devEq_(R, 'academyStems_ "PROBATIONARY MEMBERS" → PROBATIONARY', academyStems_('PROBATIONARY MEMBERS').join(','), 'PROBATIONARY');
      devEq_(R, 'academyStems_ "Probationary Officer" → PROBATIONARY', academyStems_('Probationary Officer').join(','), 'PROBATIONARY');
    }
  } else { devInfo_(R, 'academyMarker_ not loaded', 'RosterExtras.gs absent — skipped'); }

  // Back-compat: the classic single-row layout still resolves; optional columns report 0 when absent.
  const RCo = rosterCols_(devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Active', hours: 12 }]));
  devEq_(R, 'classic layout: activity still col 8', RCo.activity, 8);
  devEq_(R, 'classic layout: discord still col 5', RCo.discord, 5);
  devEq_(R, 'optional OOC absent → 0', RCo.ooc, 0);
  devEq_(R, 'optional SHIFT absent → 0', RCo.shift, 0);
  devEq_(R, 'optional MAY HOURS absent → 0', RCo.mayHours, 0);
  devEq_(R, 'optional TIME IN RANK absent → 0', RCo.timeInRank, 0);

  // ACTIVITY and STATUS are interchangeable labels for the activity column.
  const ac = devFreshSheet_('LayoutAct');
  ac.getRange(6, 2, 1, 4).setValues([['RANK', 'NAME', 'HOURS', 'ACTIVITY']]);
  ac.getRange(8, 2, 1, 1).setValue('Trooper');
  devEq_(R, 'legacy "ACTIVITY" label still resolves as activity', rosterCols_(ac).activity, 5);

  // Demo OOC-name helper (RosterExtras.gs — optional file, so guard it).
  if (typeof demoOocName_ === 'function') {
    devEq_(R, 'demoOocName_ "James Bennett" → "James B."', demoOocName_('James Bennett'), 'James B.');
    devEq_(R, 'demoOocName_ three-part name uses the LAST initial', demoOocName_('Ana Maria Reyes'), 'Ana R.');
    devEq_(R, 'demoOocName_ single name → unchanged', demoOocName_('Cher'), 'Cher');
    devEq_(R, 'demoOocName_ blank → blank', demoOocName_(''), '');
  } else { devInfo_(R, 'demoOocName_ not loaded', 'RosterExtras.gs absent — skipped'); }

  return R;
}

/* ======================================================================
 * GROUP 1 — PURE / UNIT
 * ====================================================================== */
function devUnitTests_() {
  const R = devNewResults_('Unit / pure functions');

  // computeStatus_ — standard rule, exact boundaries. Isolated against DEFAULTS so a customized live
  // [STATUSES]/[STATUS_OVERRIDES] (e.g. a sheet without the seeded Auxiliary Trooper override) can't red these.
  devWithConfig_({}, () => {
    devEq_(R, 'Trooper 4.99 → Inactive', computeStatus_('Trooper', 4.99), 'Inactive');
    devEq_(R, 'Trooper 5.00 → Semi-Active', computeStatus_('Trooper', 5.00), 'Semi-Active');
    devEq_(R, 'Trooper 5.01 → Semi-Active', computeStatus_('Trooper', 5.01), 'Semi-Active');
    devEq_(R, 'Trooper 9.99 → Semi-Active', computeStatus_('Trooper', 9.99), 'Semi-Active');
    devEq_(R, 'Trooper 10.00 → Active', computeStatus_('Trooper', 10.00), 'Active');
    devEq_(R, 'Trooper 10.01 → Active', computeStatus_('Trooper', 10.01), 'Active');
    devEq_(R, 'Trooper negative → Inactive', computeStatus_('Trooper', -3), 'Inactive');
    devEq_(R, 'Colonel uses standard rule (8h→Semi)', computeStatus_('Colonel', 8), 'Semi-Active');
    // Auxiliary — single 5h threshold, no Semi band
    devEq_(R, 'Aux 4.99 → Inactive', computeStatus_('Auxiliary Trooper', 4.99), 'Inactive');
    devEq_(R, 'Aux 5.00 → Active', computeStatus_('Auxiliary Trooper', 5.00), 'Active');
    devEq_(R, 'Aux 7 → Active (never Semi)', computeStatus_('Auxiliary Trooper', 7), 'Active');
    devEq_(R, 'Aux 0 → Inactive', computeStatus_('Auxiliary Trooper', 0), 'Inactive');
    // REGRESSION (audit): a padded Aux rank must still use the Aux rule (6h→Active, not standard 6h→Semi)
    devEq_(R, 'Aux rank padded still uses Aux rule (6h→Active)', computeStatus_('Auxiliary Trooper ', 6), 'Active');
    devEq_(R, 'Aux rank padded 4.99 → Inactive', computeStatus_(' Auxiliary Trooper', 4.99), 'Inactive');
  });

  // parseHours_ — every input type
  devEq_(R, 'parseHours 12 (int)', parseHours_(12), 12);
  devEq_(R, 'parseHours 12.5 (num)', parseHours_(12.5), 12.5);
  devEq_(R, "parseHours '12.5'", parseHours_('12.5'), 12.5);
  devEq_(R, "parseHours '5h 30m' → 5.5", parseHours_('5h 30m'), 5.5);
  devEq_(R, "parseHours '5.5h' → 5.5", parseHours_('5.5h'), 5.5);
  devEq_(R, "parseHours '1.5h 15m' → 1.75", parseHours_('1.5h 15m'), 1.75);
  devEq_(R, "parseHours '90m' → 1.5", parseHours_('90m'), 1.5);
  devEq_(R, "parseHours '5h' → 5", parseHours_('5h'), 5);
  devEq_(R, "parseHours '30m' → 0.5", parseHours_('30m'), 0.5);
  devEq_(R, "parseHours whitespace → 0", parseHours_('   '), 0);
  devEq_(R, "parseHours '' → 0", parseHours_(''), 0);
  devEq_(R, 'parseHours null → 0', parseHours_(null), 0);
  devEq_(R, 'parseHours undefined → 0', parseHours_(undefined), 0);
  devEq_(R, 'parseHours boolean → 0', parseHours_(true), 0);
  devEq_(R, 'parseHours object → 0', parseHours_({}), 0);
  devEq_(R, "parseHours 'xyz' → 0", parseHours_('xyz'), 0);
  devEq_(R, "parseHours '-3' → -3", parseHours_('-3'), -3);

  // isProtectedStatus_
  devEq_(R, 'LOA protected', isProtectedStatus_('LOA'), true);
  devEq_(R, 'ROA protected', isProtectedStatus_('ROA'), true);
  devEq_(R, 'Reserve protected', isProtectedStatus_('Reserve'), true);
  devEq_(R, 'Active not protected', isProtectedStatus_('Active'), false);
  devEq_(R, 'empty not protected', isProtectedStatus_(''), false);

  // resolveStatus_
  devEq_(R, 'resolve LOA → null', resolveStatus_('Trooper', 'LOA', 0), null);
  devEq_(R, 'resolve Reserve → null', resolveStatus_('Sergeant', 'Reserve', 0), null);
  devEq_(R, 'resolve ROA 3h → Inactive', resolveStatus_('Senior Trooper', 'ROA', 3), 'Inactive');
  devEq_(R, 'resolve ROA 6h → null', resolveStatus_('Senior Trooper', 'ROA', 6), null);
  devEq_(R, 'resolve Active 12h → Active', resolveStatus_('Trooper', 'Active', 12), 'Active');
  devEq_(R, 'resolve Active 3h → Inactive', resolveStatus_('Trooper', 'Active', 3), 'Inactive');

  // isMemberSlot_ / isValidMemberValues_
  devEq_(R, 'ALL-CAPS divider not a slot', isMemberSlot_('PATROL TROOPERS'), false);
  devEq_(R, 'real rank is a slot', isMemberSlot_('Sergeant'), true);
  devEq_(R, 'empty not a slot', isMemberSlot_(''), false);
  devEq_(R, 'null not a slot', isMemberSlot_(null), false);
  devEq_(R, 'short caps K9 IS a slot', isMemberSlot_('K9'), true);
  devEq_(R, 'valid member (rank+name)', isValidMemberValues_('Trooper', 'J. Doe'), true);
  devEq_(R, 'rejects empty name', isValidMemberValues_('Trooper', ''), false);
  devEq_(R, 'rejects null name', isValidMemberValues_('Trooper', null), false);
  devEq_(R, "rejects 'Rank' placeholder", isValidMemberValues_('Rank', 'x'), false);
  devEq_(R, 'rejects divider with text in name', isValidMemberValues_('CADETS', 'x'), false);

  // isTrainingRow_ is now label-based (takes a sheet) — covered in the "Control Panel & audit" group.

  // dash_
  devEq_(R, 'dash empty → —', dash_(''), '—');
  devEq_(R, 'dash null → —', dash_(null), '—');
  devEq_(R, 'dash undefined → —', dash_(undefined), '—');
  devEq_(R, 'dash whitespace → —', dash_('   '), '—');
  devEq_(R, 'dash value preserved', dash_('S-15'), 'S-15');
  devEq_(R, 'dash 0 → "0"', dash_(0), '0');

  // makeLeaveKey_
  devEq_(R, 'key from string ts', makeLeaveKey_('123', '1700000000000'), 'KEY|123|1700000000000');
  devEq_(R, 'key from Date ts uses ms', makeLeaveKey_('123', new Date(1700000000000)), 'KEY|123|1700000000000');
  devEq_(R, 'key empty id → ""', makeLeaveKey_('', 'x'), '');
  devEq_(R, 'key trims id', makeLeaveKey_(' 123 ', 'x'), 'KEY|123|x');

  // startOfDay_ / todayInSheetTz_
  const sod = startOfDay_(new Date(2026, 2, 15, 14, 33, 7));
  devCheck_(R, 'startOfDay_ zeroes the clock', sod.getHours() === 0 && sod.getMinutes() === 0 && sod.getSeconds() === 0);
  const t = todayInSheetTz_();
  devCheck_(R, 'todayInSheetTz_ is a midnight Date', t instanceof Date && !isNaN(t.getTime()) && t.getHours() === 0);

  // devId_ uniqueness + format (the precision trap)
  const set = {};
  let dup = false;
  let bad = false;
  for (let i = 0; i < 1005; i++) {
    const id = devId_(i);
    if (!/^\d{18}$/.test(id)) bad = true;
    if (set[id]) dup = true;
    set[id] = true;
  }
  devCheck_(R, 'devId_ generates 1005 UNIQUE ids', !dup);
  devCheck_(R, 'devId_ ids are all 18 digits', !bad);

  // --- boundary pins & direct fact-checks (added for full coverage) ---
  // resolveStatus_ ROA at exactly the semi threshold (hrs===5): 5<5 is false → stays ROA
  devEq_(R, 'resolve ROA exactly 5h → null (stays ROA)', resolveStatus_('Senior Trooper', 'ROA', 5), null);
  devEq_(R, 'resolve ROA 4.99h → Inactive (below threshold)', resolveStatus_('Senior Trooper', 'ROA', 4.99), 'Inactive');

  // isMemberSlot_ / isValidMemberValues_ — the ALL-CAPS rule is length>3, so 3-char caps IS a real slot
  devEq_(R, 'isMemberSlot_ 3-char caps "SGT" IS a slot', isMemberSlot_('SGT'), true);
  devEq_(R, 'isMemberSlot_ 4-char caps "SSGT" is a divider', isMemberSlot_('SSGT'), false);
  devEq_(R, 'isValidMemberValues_ "SGT"+name valid (3-char caps)', isValidMemberValues_('SGT', 'J. Doe'), true);
  devEq_(R, 'isValidMemberValues_ "UNIT"+name rejected (4-char caps divider)', isValidMemberValues_('UNIT', 'J. Doe'), false);

  // makeLeaveKey_ — an Invalid-Date timestamp falls through to String(), never a NaN ms
  (() => {
    const k = makeLeaveKey_('123', new Date('not-a-date'));
    devCheck_(R, 'makeLeaveKey_ Invalid Date → key starts "KEY|123|"', k.indexOf('KEY|123|') === 0, k);
    devCheck_(R, 'makeLeaveKey_ Invalid Date → no "NaN" in key', k.indexOf('NaN') === -1, k);
    devCheck_(R, 'makeLeaveKey_ Invalid Date → non-empty (dedup still works)', k.length > 0, k);
  })();

  // clamp_ — the Discord embed-field truncation helper, asserted directly
  devEq_(R, 'clamp_ under limit unchanged', clamp_('hello', 10), 'hello');
  devEq_(R, 'clamp_ exactly at limit unchanged', clamp_('hello', 5), 'hello');
  devEq_(R, 'clamp_ over limit → n-1 chars + ellipsis', clamp_('hello', 4), 'hel…');
  devEq_(R, 'clamp_ null → "" (coalesced)', clamp_(null, 5), '');

  // defaultColumnClass_ — SLOT for rank/unit/callsign headers, MEMBER otherwise (no COMMUNITY/UNIT collision)
  devEq_(R, 'colClass RANK → SLOT', defaultColumnClass_('RANK'), 'SLOT');
  devEq_(R, 'colClass UNIT NUMBER → SLOT', defaultColumnClass_('UNIT NUMBER'), 'SLOT');
  devEq_(R, 'colClass CALLSIGN → SLOT', defaultColumnClass_('CALLSIGN'), 'SLOT');
  devEq_(R, 'colClass NAME → MEMBER', defaultColumnClass_('NAME'), 'MEMBER');
  devEq_(R, 'colClass DISCORD UNIQUE ID → MEMBER', defaultColumnClass_('DISCORD UNIQUE ID'), 'MEMBER');
  devEq_(R, 'colClass COMMUNITY ID → MEMBER (substring "UNIT" needs a word boundary)', defaultColumnClass_('COMMUNITY ID'), 'MEMBER');

  return R;
}

/* ======================================================================
 * GROUP 2 — STATUS ENGINE (real recomputeStatuses_ / updateStatusFromHours)
 * ====================================================================== */
function devStatusTests_() {
  const R = devNewResults_('Status engine (sandbox)');

  // batch recompute: protection + ROA<5 + dividers + empty-name
  let roster = devBuildRoster_([
    { rank: 'Trooper', name: 'Active12', id: devId_(1), activity: 'Inactive', hours: 12 },
    { rank: 'Trooper', name: 'Semi7', id: devId_(2), activity: 'Inactive', hours: 7 },
    { rank: 'Trooper', name: 'Low2', id: devId_(3), activity: 'Active', hours: 2 },
    { rank: 'Trooper', name: 'OnLOA', id: devId_(4), activity: 'LOA', hours: 0 },
    { rank: 'Sergeant', name: 'OnReserve', id: devId_(5), activity: 'Reserve', hours: 0 },
    { rank: 'Senior Trooper', name: 'RoaLow', id: devId_(6), activity: 'ROA', hours: 3 },
    { rank: 'Senior Trooper', name: 'RoaOk', id: devId_(7), activity: 'ROA', hours: 8 },
    { rank: 'PATROL TROOPERS', name: '', id: '', activity: '', hours: '' },         // divider
    { rank: 'Trooper', name: '', id: '', activity: '', hours: '' },                  // empty-name slot
  ]);
  const recRes = recomputeStatuses_(roster, false);
  devEq_(R, 'recompute summary: total counts the 7 valid members (dividers/empty excluded)', recRes.total, 7);
  devCheck_(R, 'recompute summary: reports Active12 as Inactive→Active', recRes.changed.some(function (c) { return c.name === 'Active12' && c.from === 'Inactive' && c.to === 'Active'; }));
  devCheck_(R, 'recompute summary: a protected member (LOA) is skipped, not listed as changed', !recRes.changed.some(function (c) { return c.name === 'OnLOA'; }) && recRes.protectedSkipped >= 1);
  devEq_(R, 'batch: 12h → Active', devActivity_(roster, 0), 'Active');
  devEq_(R, 'batch: 7h → Semi-Active', devActivity_(roster, 1), 'Semi-Active');
  devEq_(R, 'batch: 2h → Inactive', devActivity_(roster, 2), 'Inactive');
  devEq_(R, 'batch: LOA protected', devActivity_(roster, 3), 'LOA');
  devEq_(R, 'batch: Reserve protected', devActivity_(roster, 4), 'Reserve');
  devEq_(R, 'batch: ROA 3h → Inactive', devActivity_(roster, 5), 'Inactive');
  devEq_(R, 'batch: ROA 8h → stays ROA', devActivity_(roster, 6), 'ROA');
  devEq_(R, 'batch: divider untouched', devActivity_(roster, 7), '');
  devEq_(R, 'batch: empty-name slot untouched', devActivity_(roster, 8), '');

  // weekly reset (zero hours)
  roster = devBuildRoster_([
    { rank: 'Trooper', name: 'Worker', id: devId_(10), activity: 'Active', hours: 20 },
    { rank: 'Trooper', name: 'OnLOA', id: devId_(11), activity: 'LOA', hours: 0 },
    { rank: 'Sergeant', name: 'OnReserve', id: devId_(12), activity: 'Reserve', hours: 0 },
    { rank: 'Senior Trooper', name: 'OnROA', id: devId_(13), activity: 'ROA', hours: 3 },
  ]);
  recomputeStatuses_(roster, true);
  devEq_(R, 'reset: hours zeroed', roster.getRange(CONFIG.rosterStartRow, CONFIG.roster.hours).getValue(), 0);
  devEq_(R, 'reset: Active → Inactive', devActivity_(roster, 0), 'Inactive');
  devEq_(R, 'reset: LOA protected', devActivity_(roster, 1), 'LOA');
  devEq_(R, 'reset: Reserve protected', devActivity_(roster, 2), 'Reserve');
  devEq_(R, 'reset: ROA<5 → Inactive', devActivity_(roster, 3), 'Inactive');

  // per-row path agrees with batch
  roster = devBuildRoster_([{ rank: 'Trooper', name: 'StrHours', id: devId_(20), activity: 'Inactive', hours: '8h 15m' }]);
  updateStatusFromHours(roster, CONFIG.rosterStartRow);
  devEq_(R, 'per-row: string hours normalized to 8.25', roster.getRange(CONFIG.rosterStartRow, CONFIG.roster.hours).getValue(), 8.25);
  devEq_(R, 'per-row: 8.25h → Semi-Active', devActivity_(roster, 0), 'Semi-Active');

  roster = devBuildRoster_([{ rank: 'Trooper', name: 'P', id: devId_(21), activity: 'LOA', hours: 0 }]);
  updateStatusFromHours(roster, CONFIG.rosterStartRow);
  devEq_(R, 'per-row: LOA protected', devActivity_(roster, 0), 'LOA');

  // per-row ROA branch via resolveStatus_: <5h flips to Inactive, >=5h stays ROA
  roster = devBuildRoster_([{ rank: 'Senior Trooper', name: 'RoaLow', id: devId_(30), activity: 'ROA', hours: 3 }]);
  updateStatusFromHours(roster, CONFIG.rosterStartRow);
  devEq_(R, 'per-row: ROA 3h → Inactive', devActivity_(roster, 0), 'Inactive');
  roster = devBuildRoster_([{ rank: 'Senior Trooper', name: 'RoaOk', id: devId_(31), activity: 'ROA', hours: 8 }]);
  updateStatusFromHours(roster, CONFIG.rosterStartRow);
  devEq_(R, 'per-row: ROA 8h → stays ROA', devActivity_(roster, 0), 'ROA');

  // write-back guard: a non-numeric hours cell (parsed 0) must NOT be overwritten with 0
  roster = devBuildRoster_([{ rank: 'Trooper', name: 'BadHours', id: devId_(32), activity: 'Inactive', hours: 'xyz' }]);
  updateStatusFromHours(roster, CONFIG.rosterStartRow);
  devEq_(R, 'per-row: non-numeric hours cell left intact (not zeroed)', roster.getRange(CONFIG.rosterStartRow, CONFIG.roster.hours).getDisplayValue(), 'xyz');
  devEq_(R, 'per-row: non-numeric hours → Inactive', devActivity_(roster, 0), 'Inactive');

  return R;
}

/* ======================================================================
 * GROUP 3 — LEAVE LIFECYCLE (real processDailyLOAs_)
 * ====================================================================== */
function devLifecycleTests_() {
  const R = devNewResults_('Leave lifecycle (sandbox)');
  const NO_HOOK = { sendWebhooks: false };

  // A: started approved LOA → member set to LOA
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Starter', id: devId_(1), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'Starter', id: devId_(1), type: 'LOA', start: devDay_(-1), end: devDay_(10), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'A: started leave → roster LOA', devActivity_(ro, 0), 'LOA');
    devEq_(R, 'A: future-end stays Approved', devTrackerStatus_(tr, 0), 'Approved');
  })();

  // B: expired approved LOA, 0h return → Inactive (not Active)
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Returner', id: devId_(2), activity: 'LOA', hours: 0 }]);
    const tr = devBuildTracker_([{ name: 'Returner', id: devId_(2), type: 'LOA', start: devDay_(-10), end: devDay_(-1), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'B: tracker → Expired', devTrackerStatus_(tr, 0), 'Expired');
    devEq_(R, 'B: 0h returner → Inactive (not Active)', devActivity_(ro, 0), 'Inactive');
  })();

  // C: expired with hours → Active
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Busy', id: devId_(3), activity: 'LOA', hours: 15 }]);
    const tr = devBuildTracker_([{ name: 'Busy', id: devId_(3), type: 'LOA', start: devDay_(-10), end: devDay_(-1), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'C: 15h returner → Active', devActivity_(ro, 0), 'Active');
  })();

  // D: never-approved past end → not expired, member untouched
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Pending', id: devId_(4), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'Pending', id: devId_(4), type: 'LOA', start: devDay_(-10), end: devDay_(-1), status: 'Pending' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'D: pending NOT expired', devTrackerStatus_(tr, 0), 'Pending');
    devEq_(R, 'D: member untouched (Active)', devActivity_(ro, 0), 'Active');
  })();

  // E: future leave → nothing yet
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Future', id: devId_(5), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'Future', id: devId_(5), type: 'LOA', start: devDay_(3), end: devDay_(10), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'E: future leave → member stays Active', devActivity_(ro, 0), 'Active');
    devEq_(R, 'E: future leave → stays Approved', devTrackerStatus_(tr, 0), 'Approved');
  })();

  // F: ROA returner under 5h → Inactive
  (() => {
    const ro = devBuildRoster_([{ rank: 'Senior Trooper', name: 'RoaLow', id: devId_(6), activity: 'ROA', hours: 3 }]);
    const tr = devBuildTracker_([{ name: 'RoaLow', id: devId_(6), type: 'ROA', start: devDay_(-10), end: devDay_(-1), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'F: ROA 3h return → Inactive', devActivity_(ro, 0), 'Inactive');
  })();

  // G: ends exactly today → Expired
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'EndsToday', id: devId_(7), activity: 'LOA', hours: 0 }]);
    const tr = devBuildTracker_([{ name: 'EndsToday', id: devId_(7), type: 'LOA', start: devDay_(-5), end: devDay_(0), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'G: ends today → Expired', devTrackerStatus_(tr, 0), 'Expired');
  })();

  // H: starts exactly today → activated
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'StartsToday', id: devId_(8), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'StartsToday', id: devId_(8), type: 'ROA', start: devDay_(0), end: devDay_(10), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'H: starts today → roster ROA', devActivity_(ro, 0), 'ROA');
  })();

  // I: already Expired left alone
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Done', id: devId_(9), activity: 'Inactive', hours: 2 }]);
    const tr = devBuildTracker_([{ name: 'Done', id: devId_(9), type: 'LOA', start: devDay_(-20), end: devDay_(-10), status: 'Expired' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'I: Expired stays Expired', devTrackerStatus_(tr, 0), 'Expired');
    devEq_(R, 'I: member untouched (Inactive)', devActivity_(ro, 0), 'Inactive');
  })();

  // J: idempotent (run twice)
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Twice', id: devId_(10), activity: 'LOA', hours: 8 }]);
    const tr = devBuildTracker_([{ name: 'Twice', id: devId_(10), type: 'LOA', start: devDay_(-10), end: devDay_(-1), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    const after1 = devActivity_(ro, 0);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'J: 8h → Semi-Active', after1, 'Semi-Active');
    devEq_(R, 'J: idempotent (2nd run identical)', devActivity_(ro, 0), after1);
  })();

  // K: expiry does not clobber a different protected status
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'NewLeave', id: devId_(11), activity: 'ROA', hours: 0 }]);
    const tr = devBuildTracker_([{ name: 'NewLeave', id: devId_(11), type: 'LOA', start: devDay_(-20), end: devDay_(-1), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'K: expiring LOA does not overwrite current ROA', devActivity_(ro, 0), 'ROA');
  })();

  // L: orphan leave → tracker expires, member untouched, summary correct, no crash
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Present', id: devId_(12), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'Ghost', id: devId_(9999999), type: 'LOA', start: devDay_(-10), end: devDay_(-1), status: 'Approved' }]);
    const summary = processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'L: orphan leave still Expired', devTrackerStatus_(tr, 0), 'Expired');
    devEq_(R, 'L: present member untouched', devActivity_(ro, 0), 'Active');
    devEq_(R, 'L: summary counts the expiry', summary.expired.length, 1);
  })();

  // M: bulk 50 expiring at once
  (() => {
    const members = [];
    const leaves = [];
    for (let i = 0; i < 50; i++) {
      members.push({ rank: 'Trooper', name: `Bulk${i}`, id: devId_(100 + i), activity: 'LOA', hours: 0 });
      leaves.push({ name: `Bulk${i}`, id: devId_(100 + i), type: 'LOA', start: devDay_(-10), end: devDay_(-1), status: 'Approved' });
    }
    const ro = devBuildRoster_(members);
    const tr = devBuildTracker_(leaves);
    const summary = processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'M: all 50 expired', summary.expired.length, 50);
    devEq_(R, 'M: first → Inactive (0h)', devActivity_(ro, 0), 'Inactive');
    devEq_(R, 'M: 50th → Inactive (0h)', devActivity_(ro, 49), 'Inactive');
  })();

  // N: a tracker row with a BLANK Discord ID is skipped — never expired or counted
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'P', id: devId_(60), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'BlankId', id: '', type: 'LOA', start: devDay_(-10), end: devDay_(-1), status: 'Approved' }]);
    const s = processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'N: blank-ID leave NOT expired (skipped)', devTrackerStatus_(tr, 0), 'Approved');
    devEq_(R, 'N: blank-ID leave not counted in summary', s.expired.length, 0);
  })();

  // O: REGRESSION (audit) — full form→sync→schedule path matches the member by EXACT ID (no Number coercion)
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Chain', id: devId_(70), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([]);
    syncFormToTracker_(devBuildForm_([{ ts: devDay_(0), name: 'Chain', id: devId_(70), callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(-1), end: devDay_(10) }]), tr, NO_HOOK);
    tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.status).setValue('Approved'); // sync writes 'Pending'; approve it so the scheduler starts it
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'O: sync→process matches by exact ID → roster set to LOA', devActivity_(ro, 0), 'LOA');
  })();

  // P: REGRESSION (audit medium) — overlapping leaves are order-INDEPENDENT; a leave starting today wins
  // over a different leave expiring the same day. Row order here (start row first) is the one the old single
  // loop got WRONG (it left the member Inactive). Member currently on the expiring LOA.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Overlap', id: devId_(80), activity: 'LOA', hours: 0 }]);
    const tr = devBuildTracker_([
      { name: 'Overlap', id: devId_(80), type: 'ROA', start: devDay_(0), end: devDay_(10), status: 'Approved' },   // row 0: starts today
      { name: 'Overlap', id: devId_(80), type: 'LOA', start: devDay_(-10), end: devDay_(0), status: 'Approved' },  // row 1: expires today
    ]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'P: starting ROA wins over same-day expiring LOA (order-independent)', devActivity_(ro, 0), 'ROA');
    devEq_(R, 'P: expiring LOA row → Expired', devTrackerStatus_(tr, 1), 'Expired');
    devEq_(R, 'P: starting ROA row stays Approved', devTrackerStatus_(tr, 0), 'Approved');
  })();

  return R;
}

/* ======================================================================
 * GROUP 4 — FORM SYNC & DEDUP (real syncFormToTracker_)
 * ====================================================================== */
function devSyncTests_() {
  const R = devNewResults_('Form sync & dedup (sandbox)');
  const NO_HOOK = { sendWebhooks: false };

  // append-once + idempotent + date-coercion immunity
  (() => {
    const ts = devDay_(-1);
    const form = devBuildForm_([{ ts, name: 'Filer', id: devId_(1), callsign: 'S-9', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]);
    const tr = devBuildTracker_([]);
    syncFormToTracker_(form, tr, NO_HOOK);
    devEq_(R, 'sync appended exactly one row', tr.getLastRow(), CONFIG.trackerStartRow);
    devCheck_(R, 'appended row has a KEY in column A', String(tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.key).getValue()).indexOf('KEY|') === 0);
    const lenFormula = tr.getRange(CONFIG.trackerStartRow, 9).getFormula();
    devCheck_(R, 'LENGTH cell has an INT()-wrapped formula', lenFormula.indexOf('INT(') !== -1);

    // simulate Sheets coercing/corrupting the stored dates, wipe the form color → rerun must NOT duplicate
    tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.start).setValue(new Date(devDay_(2)));
    tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.end).setValue('garbage-not-a-date');
    form.getRange(2, 1, 1, 8).setBackground('#ffffff');
    syncFormToTracker_(form, tr, NO_HOOK);
    devEq_(R, 'rerun did NOT duplicate (timestamp key, date-coercion-immune)', tr.getLastRow(), CONFIG.trackerStartRow);
  })();

  // F-035 — a hand-edited STRING date must not shift a day (new Date('yyyy-MM-dd') is UTC)
  (() => {
    const d5 = devDay_(5);
    const s5 = Utilities.formatDate(d5, ssTz_(), 'yyyy-MM-dd');
    devEq_(R, 'parseFormDate_ Date passthrough', parseFormDate_(d5).getTime(), d5.getTime());
    devEq_(R, 'parseFormDate_ ISO string → same local day', Utilities.formatDate(parseFormDate_(s5), ssTz_(), 'yyyy-MM-dd'), s5);
    devCheck_(R, 'parseFormDate_ empty → invalid', isNaN(parseFormDate_('').getTime()));

    const tr = devBuildTracker_([]);
    const sStr = Utilities.formatDate(devDay_(3), ssTz_(), 'yyyy-MM-dd');
    const eStr = Utilities.formatDate(devDay_(10), ssTz_(), 'yyyy-MM-dd');
    const form = devBuildForm_([{ ts: devDay_(0), name: 'StrDate', id: devId_(30), callsign: 'S-30', rank: 'Trooper', type: 'LOA', start: sStr, end: eStr }]);
    syncFormToTracker_(form, tr, NO_HOOK);
    devEq_(R, 'string-date sync appended one row', devDataRows_(tr, CONFIG.trackerStartRow), 1);
    const storedDay = Utilities.formatDate(new Date(tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.start).getValue()), ssTz_(), 'yyyy-MM-dd');
    devEq_(R, 'F-035: string start date does NOT shift a day', storedDay, sStr);
  })();

  // a genuinely NEW leave (new timestamp) IS allowed
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([
      { ts: devDay_(-2), name: 'X', id: devId_(2), callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(1), end: devDay_(5) },
    ]);
    syncFormToTracker_(form, tr, NO_HOOK);
    // add a second submission with a different timestamp
    form.getRange(3, 1, 1, 8).setValues([[devDay_(-1), 'X', devId_(2), 'S-1', 'Trooper', 'ROA', devDay_(6), devDay_(9)]]);
    form.getRange(3, CONFIG.form.discord).setNumberFormat('@').setValue(devId_(2));
    syncFormToTracker_(form, tr, NO_HOOK);
    devEq_(R, 'new submission (new ts) → second row appended', devDataRows_(tr, CONFIG.trackerStartRow), 2);
  })();

  // missing dates → error, no append
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([{ ts: devDay_(0), name: 'NoDate', id: devId_(3), callsign: 'S-3', rank: 'Trooper', type: 'LOA' }]);
    syncFormToTracker_(form, tr, NO_HOOK);
    devCheck_(R, 'missing dates → nothing appended', tr.getLastRow() < CONFIG.trackerStartRow);
    devEq_(R, 'missing dates → row marked error', form.getRange(2, 1).getBackground().toLowerCase(), CONFIG.bg.error);
  })();

  // non-numeric Discord ID → error, no append
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([{ ts: devDay_(0), name: 'BadId', id: 'not-a-number', callsign: 'S-4', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]);
    syncFormToTracker_(form, tr, NO_HOOK);
    devCheck_(R, 'bad ID → nothing appended', tr.getLastRow() < CONFIG.trackerStartRow);
    devEq_(R, 'bad ID → row marked error', form.getRange(2, 1).getBackground().toLowerCase(), CONFIG.bg.error);
  })();

  // reversed dates (end before start) → no crash, still appends
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([{ ts: devDay_(0), name: 'Backwards', id: devId_(5), callsign: 'S-5', rank: 'Trooper', type: 'LOA', start: devDay_(10), end: devDay_(2) }]);
    let threw = false;
    try { syncFormToTracker_(form, tr, NO_HOOK); } catch (e) { threw = true; }
    devCheck_(R, 'reversed dates do not crash', !threw);
    devEq_(R, 'reversed dates still append a row', devDataRows_(tr, CONFIG.trackerStartRow), 1);
  })();

  // buildSyncedKeySet_ only honors KEY| rows
  (() => {
    const tr = devBuildTracker_([
      { key: 'KEY|111|999', name: 'A', id: devId_(6), status: 'Approved' },
      { key: '104', name: 'B', id: devId_(7), status: 'Approved' }, // legacy numeric col-A value, ignored
    ]);
    const set = buildSyncedKeySet_(tr);
    devEq_(R, 'syncedKeySet includes KEY| row', set['KEY|111|999'], true);
    devEq_(R, 'syncedKeySet ignores non-KEY col-A value', set['104'], undefined);
  })();

  // DISCORD_ID_RE length boundaries: 16 and 20 digits (and whitespace) rejected; 17 accepted
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([{ ts: devDay_(0), name: 'Sixteen', id: '1234567890123456', callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]);
    syncFormToTracker_(form, tr, NO_HOOK);
    devCheck_(R, '16-digit ID rejected (nothing appended)', tr.getLastRow() < CONFIG.trackerStartRow);
    devEq_(R, '16-digit ID → row marked error', form.getRange(2, 1).getBackground().toLowerCase(), CONFIG.bg.error);
  })();
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([{ ts: devDay_(0), name: 'Twenty', id: '12345678901234567890', callsign: 'S-2', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]);
    syncFormToTracker_(form, tr, NO_HOOK);
    devCheck_(R, '20-digit ID rejected (nothing appended)', tr.getLastRow() < CONFIG.trackerStartRow);
  })();
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([{ ts: devDay_(0), name: 'Blank', id: '   ', callsign: 'S-3', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]);
    syncFormToTracker_(form, tr, NO_HOOK);
    devCheck_(R, 'whitespace-only ID rejected (nothing appended)', tr.getLastRow() < CONFIG.trackerStartRow);
  })();
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([{ ts: devDay_(0), name: 'Seventeen', id: '12345678901234567', callsign: 'S-4', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]);
    syncFormToTracker_(form, tr, NO_HOOK);
    devEq_(R, '17-digit ID accepted → exactly one row appended', devDataRows_(tr, CONFIG.trackerStartRow), 1);
  })();

  // durationStr singular vs plural in the returned leaf (assertable without a webhook)
  (() => {
    const out1 = syncFormToTracker_(devBuildForm_([{ ts: devDay_(0), name: 'OneDay', id: devId_(40), callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(3) }]), devBuildTracker_([]), NO_HOOK);
    devEq_(R, 'durationStr 1-day span → "1 Day" (singular)', out1[0].durationStr, '1 Day');
    const out2 = syncFormToTracker_(devBuildForm_([{ ts: devDay_(0), name: 'TwoDay', id: devId_(41), callsign: 'S-2', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(4) }]), devBuildTracker_([]), NO_HOOK);
    devEq_(R, 'durationStr 2-day span → "2 Days" (plural)', out2[0].durationStr, '2 Days');
  })();

  // styleFormResponses_ themes the form sheet (navy header + monospace IDs) without throwing or touching data
  (() => {
    const form = devBuildForm_([{ ts: devDay_(0), name: 'Styled', id: devId_(50), callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]);
    let threw = false;
    try { styleFormResponses_(form); } catch (e) { threw = true; }
    devCheck_(R, 'styleFormResponses_ runs without throwing', !threw);
    devEq_(R, 'styleFormResponses_ paints the header navy', String(form.getRange(1, 1).getBackground()).toLowerCase(), theme_('BANNER').toLowerCase());
    devEq_(R, 'styleFormResponses_ sets the Discord column to Roboto Mono', form.getRange(2, CONFIG.form.discord).getFontFamily(), 'Roboto Mono');
  })();

  // REGRESSION (audit critical): the appended tracker Discord ID must stay EXACT, not coerce to a rounded Number.
  // devBuildTracker_([]) leaves col E at General format — faithful to a fresh production tracker.
  (() => {
    const tr = devBuildTracker_([]);
    const id = devId_(7);
    syncFormToTracker_(devBuildForm_([{ ts: devDay_(0), name: 'Exact', id, callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]), tr, NO_HOOK);
    devEq_(R, 'sync: appended tracker Discord ID is EXACT text (not coerced)', String(tr.getRange(tr.getLastRow(), CONFIG.tracker.discord).getDisplayValue()), id);
  })();

  return R;
}

/* ======================================================================
 * GROUP 5 — ROSTER MAINTENANCE
 * ====================================================================== */
function devMaintenanceTests_() {
  const R = devNewResults_('Roster maintenance (sandbox)');
  devInfo_(R, 'unit numbering / dup scan run via MIRRORS', 'the live functions read the real roster (not injectable); mirrors reuse the real isMemberSlot_/isValidMemberValues_. Live menu run needed for full proof.');

  // unit numbering: padding, 9→10, 99→100, scaling, divider skip-but-continue. Default S-{00} format
  // (devWithConfig_) so a live custom UNIT_FORMAT (e.g. D-{00}) can't red these — build+number+read all run inside.
  devWithConfig_({}, () => {
    const many = [];
    for (let i = 0; i < 105; i++) many.push({ rank: 'Trooper', name: `M${i}`, id: devId_(i), hours: 5 });
    const ro = devBuildRoster_(many);
    devNumberSheet_(ro);
    devEq_(R, 'unit #1 = S-01', ro.getRange(CONFIG.rosterStartRow, CONFIG.roster.unit).getValue(), 'S-01');
    devEq_(R, 'unit #9 = S-09', ro.getRange(CONFIG.rosterStartRow + 8, CONFIG.roster.unit).getValue(), 'S-09');
    devEq_(R, 'unit #10 = S-10 (padding boundary)', ro.getRange(CONFIG.rosterStartRow + 9, CONFIG.roster.unit).getValue(), 'S-10');
    devEq_(R, 'unit #99 = S-99', ro.getRange(CONFIG.rosterStartRow + 98, CONFIG.roster.unit).getValue(), 'S-99');
    devEq_(R, 'unit #100 = S-100 (scales past 99)', ro.getRange(CONFIG.rosterStartRow + 99, CONFIG.roster.unit).getValue(), 'S-100');
  });

  devWithConfig_({}, () => { // default S-{00} format so a live custom UNIT_FORMAT can't red these
    const ro = devBuildRoster_([
      { rank: 'Colonel', name: 'A', id: devId_(200), hours: 5 },
      { rank: 'Major', name: 'B', id: devId_(201), hours: 5 },
      { rank: 'PATROL TROOPERS', name: '', id: '', hours: '' }, // divider mid-list
      { rank: 'Trooper', name: 'C', id: devId_(202), hours: 5 },
    ]);
    devNumberSheet_(ro);
    devEq_(R, 'numbering: row 1 = S-01', ro.getRange(CONFIG.rosterStartRow, CONFIG.roster.unit).getValue(), 'S-01');
    devEq_(R, 'numbering: row 2 = S-02', ro.getRange(CONFIG.rosterStartRow + 1, CONFIG.roster.unit).getValue(), 'S-02');
    devEq_(R, 'numbering: divider blank', ro.getRange(CONFIG.rosterStartRow + 2, CONFIG.roster.unit).getValue(), '');
    devEq_(R, 'numbering: continues past divider → S-03', ro.getRange(CONFIG.rosterStartRow + 3, CONFIG.roster.unit).getValue(), 'S-03');
  });

  // transfer (real checkForMemberMove with injected confirm) — same-section carries + clears
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Mover', id: devId_(300), activity: 'Active', hours: 14 },
      { rank: 'Sergeant', name: '', id: '', activity: '', hours: '' },
    ]);
    const targetRow = CONFIG.rosterStartRow + 1;
    ro.getRange(targetRow, CONFIG.roster.discord).setNumberFormat('@').setValue(devId_(300));
    checkForMemberMove(ro, ro.getRange(targetRow, CONFIG.roster.discord), devId_(300), () => true, () => {});
    devEq_(R, 'transfer: name moved to target', ro.getRange(targetRow, CONFIG.roster.name).getValue(), 'Mover');
    devEq_(R, 'transfer: source name cleared', ro.getRange(CONFIG.rosterStartRow, CONFIG.roster.name).getValue(), '');
  })();

  // cross-section transfer CARRIES every member column (incl. col 10) by default — trainingCheckboxCols is empty,
  // so nothing is wiped on a move. (Opt a column into CONFIG.columns.trainingCheckboxCols only if it must reset.)
  // A cross-section move is still exercised here: an ALL-CAPS CADETS divider makes the target a training row while
  // the source isn't — the column must still follow the person rather than being destructively cleared.
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Mover', id: devId_(400), activity: 'Active', hours: 5 }, // source @ start (non-training)
      { rank: 'CADETS', name: '' },                                                       // ALL-CAPS training divider @ start+1
      { rank: 'Cadet', name: '', id: '' },                                                // target @ start+2 (training section)
    ]);
    ro.getRange(CONFIG.rosterStartRow, 10).setValue('F.T.O.'); // a col-10 member value on the source
    const targetRow = CONFIG.rosterStartRow + 2;
    ro.getRange(targetRow, CONFIG.roster.discord).setNumberFormat('@').setValue(devId_(400));
    checkForMemberMove(ro, ro.getRange(targetRow, CONFIG.roster.discord), devId_(400), () => true, () => {});
    devEq_(R, 'cross-section transfer carries member col 10 to target (no positional wipe)', String(ro.getRange(targetRow, 10).getValue()), 'F.T.O.');
    devEq_(R, 'cross-section transfer clears member col 10 on source', String(ro.getRange(CONFIG.rosterStartRow, 10).getValue()), '');
  })();

  // duplicate / malformed ID detection (mirror)
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Dup1', id: '111111111111111111', hours: 5 },
      { rank: 'Trooper', name: 'Dup2', id: '111111111111111111', hours: 5 },
      { rank: 'Trooper', name: 'Bad', id: 'not-an-id', hours: 5 },
      { rank: 'Trooper', name: 'Short', id: '123', hours: 5 },
    ]);
    const report = devScanDuplicateIds_(ro);
    devEq_(R, 'detector finds the duplicate ID', report.duplicates.length, 1);
    devEq_(R, 'detector flags 2 malformed IDs', report.malformed.length, 2);
  })();
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Clean1', id: '111111111111111111', hours: 5 },
      { rank: 'Trooper', name: 'Clean2', id: '222222222222222222', hours: 5 },
    ]);
    const report = devScanDuplicateIds_(ro);
    devEq_(R, 'clean roster: 0 duplicates', report.duplicates.length, 0);
    devEq_(R, 'clean roster: 0 malformed', report.malformed.length, 0);
  })();

  devInfo_(R, 'member-transfer tests run unattended (no dialogs)',
    'checkForMemberMove now takes an injectable notifier; these tests pass a no-op, so the success/declined "Transfer complete" / "Action cancelled" alerts are suppressed during the run.');

  // transfer CONFIRM DECLINED — target ID cell cleared, NO move performed
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Mover', id: devId_(300), activity: 'Active', hours: 14 },
      { rank: 'Sergeant', name: '', id: '', activity: '', hours: '' },
    ]);
    const targetRow = CONFIG.rosterStartRow + 1;
    ro.getRange(targetRow, CONFIG.roster.discord).setNumberFormat('@').setValue(devId_(300));
    checkForMemberMove(ro, ro.getRange(targetRow, CONFIG.roster.discord), devId_(300), () => false, () => {});
    devEq_(R, 'declined transfer: source name still "Mover"', ro.getRange(CONFIG.rosterStartRow, CONFIG.roster.name).getValue(), 'Mover');
    devEq_(R, 'declined transfer: target name still empty (no move)', String(ro.getRange(targetRow, CONFIG.roster.name).getValue()), '');
    devEq_(R, 'declined transfer: target ID cell cleared', String(ro.getRange(targetRow, CONFIG.roster.discord).getDisplayValue()), '');
  })();

  // self-edit / NO source row — entering an ID on the only row holding it does nothing
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Solo', id: devId_(301), activity: 'Active', hours: 5 }]);
    checkForMemberMove(ro, ro.getRange(CONFIG.rosterStartRow, CONFIG.roster.discord), devId_(301), () => true, () => {});
    devEq_(R, 'no-source: name unchanged ("Solo")', ro.getRange(CONFIG.rosterStartRow, CONFIG.roster.name).getValue(), 'Solo');
    devEq_(R, 'no-source: activity unchanged ("Active")', devActivity_(ro, 0), 'Active');
  })();

  // multiple BLANK-ID rows must NOT collide on "" as a fake duplicate
  (() => {
    const report = devScanDuplicateIds_(devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: '', hours: 5 },
      { rank: 'Trooper', name: 'B', id: '', hours: 5 },
      { rank: 'Trooper', name: 'C', id: '111111111111111111', hours: 5 },
    ]));
    devEq_(R, 'multiple blank IDs → 0 duplicates', report.duplicates.length, 0);
    devEq_(R, 'multiple blank IDs → 0 malformed', report.malformed.length, 0);
  })();

  // scalable columns: columnRegistry_ classifies headers; _Columns overrides win over keyword defaults
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Active', hours: 5 }]);
    ro.getRange(5, 13).setValue('COMMUNITY ID'); // a new, unknown column header
    SpreadsheetApp.flush();
    const byCol = {}; columnRegistry_(ro, {}).forEach((c) => { byCol[c.col] = c.klass; }); // {} → pure keyword defaults
    devEq_(R, 'registry: RANK → SLOT', byCol[CONFIG.roster.rank], 'SLOT');
    devEq_(R, 'registry: UNIT → SLOT', byCol[CONFIG.roster.unit], 'SLOT');
    devEq_(R, 'registry: NAME → MEMBER', byCol[CONFIG.roster.name], 'MEMBER');
    devEq_(R, 'registry: new COMMUNITY ID → MEMBER (default)', byCol[13], 'MEMBER');
    const byCol2 = {}; columnRegistry_(ro, { 'COMMUNITY ID': 'SLOT' }).forEach((c) => { byCol2[c.col] = c.klass; });
    devEq_(R, 'registry: _Columns override flips COMMUNITY ID → SLOT', byCol2[13], 'SLOT');
  })();

  // transfer is classification-driven: a new MEMBER column follows the person; SLOT (Rank) stays with the slot
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Mover', id: devId_(500), activity: 'Active', hours: 10 },
      { rank: 'Sergeant', name: '', id: '' },
    ]);
    ro.getRange(5, 13).setValue('COMMUNITY ID');                              // new MEMBER column
    const src = CONFIG.rosterStartRow; const tgt = src + 1;
    ro.getRange(src, 13).setNumberFormat('@').setValue('99900011122233344');  // source's community id (precision-sensitive)
    ro.getRange(tgt, CONFIG.roster.discord).setNumberFormat('@').setValue(devId_(500));
    SpreadsheetApp.flush();
    checkForMemberMove(ro, ro.getRange(tgt, CONFIG.roster.discord), devId_(500), () => true, () => {});
    devEq_(R, 'transfer: new MEMBER column (Community ID) follows the member', String(ro.getRange(tgt, 13).getDisplayValue()), '99900011122233344');
    devEq_(R, 'transfer: Community ID cleared on the source row', String(ro.getRange(src, 13).getDisplayValue()), '');
    devEq_(R, 'transfer: SLOT column (Rank) stays with the target position', String(ro.getRange(tgt, CONFIG.roster.rank).getDisplayValue()), 'Sergeant');
  })();

  return R;
}

/* ======================================================================
 * GROUP 6 — DISCORD FIELD GUARD (dash_ is the live guard)
 * ====================================================================== */
function devWebhookTests_() {
  const R = devNewResults_('Discord field guard');
  devInfo_(R, 'embed field values are guarded by dash_', 'sendDiscordWebhook wraps every field value in clamp_(dash_(...)). dash_ is proven exhaustively below; the full embed needs a live webhook or an extracted payload-builder to assert end-to-end (NEEDS LIVE).');
  // dash_ guarantees no empty field value for any blank input
  ['', null, undefined, '   '].forEach((bad, i) => {
    devEq_(R, `dash_ blank input #${i} → non-empty`, dash_(bad), '—');
  });
  devCheck_(R, 'dash_ output is always a non-empty string', ['', null, undefined, '  ', 'x', 0].every((v) => String(dash_(v)).length > 0));

  // F-011/F-044 — postToWebhook_ REPORTS the outcome (no network for the empty-URL path).
  devEq_(R, 'postToWebhook_ empty URL → ok:false', postToWebhook_('', { embeds: [] }).ok, false);
  devEq_(R, 'postToWebhook_ empty URL → code 0 (never sent)', postToWebhook_('', {}).code, 0);
  devCheck_(R, 'postToWebhook_ returns a {ok,code} shape', (() => { const r = postToWebhook_('', {}); return typeof r.ok === 'boolean' && typeof r.code === 'number'; })());

  // mention_ ping gate: pings ONLY for a valid 17-19 digit ID (independent of CONFIG.pingRoles)
  (() => {
    const suffix = mention_('not-an-id'); // invalid ID → no ping, just the (possibly empty) role suffix
    devEq_(R, 'mention_ valid 18-digit ID → "<@id> " prefix', mention_('123456789012345678'), `<@123456789012345678> ${suffix}`);
    devEq_(R, 'mention_ 16-digit ID → no ping (gate rejects)', mention_('1234567890123456'), suffix);
    devEq_(R, 'mention_ non-numeric ID → no ping', mention_('not-an-id'), suffix);
  })();
  return R;
}

/* ======================================================================
 * GROUP 7 — ID MATCHING / PRECISION (real updateRosterStatus)
 * ====================================================================== */
function devIdMatchTests_() {
  const R = devNewResults_('ID matching / precision (sandbox)');

  // exact 18-digit match sets status
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'X', id: '533653499049934878', activity: 'Active', hours: 5 }]);
    updateRosterStatus(ro, '533653499049934878', 'LOA');
    devEq_(R, 'exact 18-digit string match sets status', devActivity_(ro, 0), 'LOA');
  })();

  // near-miss (last digit differs) must NOT match
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Y', id: '533653499049934878', activity: 'Active', hours: 5 }]);
    updateRosterStatus(ro, '533653499049934879', 'LOA');
    devEq_(R, 'near-miss ID does NOT match (precision-safe)', devActivity_(ro, 0), 'Active');
  })();

  // whitespace around an ID still matches (trim)
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Z', id: ' 123456789012345678 ', activity: 'Active', hours: 5 }]);
    updateRosterStatus(ro, '123456789012345678', 'LOA');
    devEq_(R, 'whitespace-padded ID still matches (trimmed)', devActivity_(ro, 0), 'LOA');
  })();

  // empty lookup does not match an empty cell
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'E', id: '', activity: 'Active', hours: 5 }]);
    updateRosterStatus(ro, '', 'LOA');
    devEq_(R, 'empty ID lookup does NOT match empty cell', devActivity_(ro, 0), 'Active');
  })();

  // first-match-wins when an ID is duplicated
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Auxiliary Trooper', name: 'First', id: '909090909090909090', activity: 'Active', hours: 0 },
      { rank: 'Sergeant', name: 'Second', id: '909090909090909090', activity: 'Active', hours: 0 },
    ]);
    updateRosterStatus(ro, '909090909090909090', 'LOA');
    devEq_(R, 'first-match-wins: first row updated', devActivity_(ro, 0), 'LOA');
    devEq_(R, 'first-match-wins: second row untouched', devActivity_(ro, 1), 'Active');
  })();

  return R;
}

/* ======================================================================
 * GROUP 8 — ADVERSARIAL & PLATFORM
 * ====================================================================== */
function devAdversarialTests_() {
  const R = devNewResults_('Adversarial & platform');
  const NO_HOOK = { sendWebhooks: false };

  // empty roster / empty tracker / header-only → no throw
  (() => {
    const ro = devFreshSheet_('Roster'); ro.getRange(5, 2).setValue('RANK');
    const tr = devFreshSheet_('Tracker'); tr.getRange(5, 2).setValue('RANK');
    let threw = false;
    try {
      recomputeStatuses_(ro, false);
      processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    } catch (e) { threw = true; }
    devCheck_(R, 'empty roster + tracker: no throw', !threw);
  })();

  // rank but no name, and a member-like divider → not assigned a status
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: '', id: '', activity: '', hours: '' }, // no name
      { rank: 'EXECUTIVE COMMAND', name: 'looksReal', id: '', activity: '', hours: '' }, // divider w/ name
      { rank: 'Trooper', name: 'Real', id: devId_(1), activity: '', hours: 12 },
    ]);
    recomputeStatuses_(ro, false);
    devEq_(R, 'no-name slot not assigned', devActivity_(ro, 0), '');
    devEq_(R, 'member-like divider not assigned', devActivity_(ro, 1), '');
    devEq_(R, 'real member assigned', devActivity_(ro, 2), 'Active');
  })();

  // invalid/blank dates in a tracker row → no throw, not expired
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'NoDates', id: devId_(2), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'NoDates', id: devId_(2), type: 'LOA', status: 'Approved' }]); // no start/end
    let threw = false;
    try { processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK); } catch (e) { threw = true; }
    devCheck_(R, 'blank tracker dates: no throw', !threw);
    devEq_(R, 'blank-date leave not expired', devTrackerStatus_(tr, 0), 'Approved');
  })();

  // hex-case difference in processing colors is tolerated by sync
  (() => {
    const tr = devBuildTracker_([]);
    const ts = devDay_(-1);
    const form = devBuildForm_([{ ts, name: 'HexCase', id: devId_(3), callsign: 'S-3', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]);
    syncFormToTracker_(form, tr, NO_HOOK);
    // mark the (already-synced) row DONE with UPPER-case hex; rerun must still skip it
    form.getRange(2, 1, 1, 8).setBackground(CONFIG.bg.done.toUpperCase()); // upper-case of the themed DONE color
    syncFormToTracker_(form, tr, NO_HOOK);
    devEq_(R, 'upper-case DONE hex still treated as processed (no dup)', devDataRows_(tr, CONFIG.trackerStartRow), 1);
  })();

  // very large roster (1000) recompute → completes without throwing
  (() => {
    const members = [];
    for (let i = 0; i < 1000; i++) members.push({ rank: 'Trooper', name: `Big${i}`, id: devId_(1000 + i), activity: 'Inactive', hours: i % 15 });
    const ro = devBuildRoster_(members);
    let threw = false;
    try { recomputeStatuses_(ro, false); } catch (e) { threw = true; }
    devCheck_(R, '1000-member recompute: no throw / no timeout', !threw);
    devEq_(R, '1000-member spot check: idx with 12h → Active', devActivity_(ro, 12), 'Active');
  })();

  devInfo_(R, 'TZ + date-coercion are exercised on REAL sandbox tabs', 'todayInSheetTz_ and the appendRow→getLastRow / Date-on-read paths run live here, so these results reflect real Apps Script behavior (not a mock).');
  return R;
}

/* ======================================================================
 * GROUP 9 — CONTROL PANEL & AUDIT (sandbox) — the new injectable cores
 * ====================================================================== */
function devPanelTests_() {
  const R = devNewResults_('Control Panel & audit (sandbox)');
  const start = CONFIG.rosterStartRow;

  // cpSetStatus_
  let roster = devBuildRoster_([
    { rank: 'Trooper', name: 'A. One', id: devId_(1), activity: 'Active', hours: 12 },
    { rank: 'Trooper', name: 'B. Two', id: devId_(2), activity: 'Inactive', hours: 0 },
  ]);
  const s0 = cpSetStatus_(roster, start, 'LOA');
  devEq_(R, 'cpSetStatus_ sets the activity cell', devActivity_(roster, 0), 'LOA');
  devEq_(R, 'cpSetStatus_ returns updated status', s0.status, 'LOA');
  devEq_(R, 'cpSetStatus_ returns the member name', s0.name, 'A. One');
  let bad = false; try { cpSetStatus_(roster, start, 'Nope'); } catch (e) { bad = true; }
  devCheck_(R, 'cpSetStatus_ rejects an invalid status', bad);

  // cpSetStatusBulk_
  roster = devBuildRoster_([
    { rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Inactive' },
    { rank: 'Trooper', name: 'B', id: devId_(2), activity: 'Inactive' },
    { rank: 'Trooper', name: 'C', id: devId_(3), activity: 'Inactive' },
  ]);
  const bulk = cpSetStatusBulk_(roster, [start, start + 2], 'Active');
  devEq_(R, 'cpSetStatusBulk_ count', bulk.count, 2);
  devEq_(R, 'cpSetStatusBulk_ row 0 → Active', devActivity_(roster, 0), 'Active');
  devEq_(R, 'cpSetStatusBulk_ row 1 untouched', devActivity_(roster, 1), 'Inactive');
  devEq_(R, 'cpSetStatusBulk_ row 2 → Active', devActivity_(roster, 2), 'Active');

  // cpAssignMember_ — fills open slots, rejects bad input
  roster = devBuildRoster_([
    { rank: 'Trooper', name: 'Seated', id: devId_(1), activity: 'Active' },
    { rank: 'Corporal', name: '', id: '' },
    { rank: 'Sergeant', name: '', id: '' },
  ]);
  const seated = cpAssignMember_(roster, { row: start + 1, name: 'New Guy', discord: devId_(9) });
  devEq_(R, 'cpAssignMember_ writes the name', roster.getRange(start + 1, CONFIG.roster.name).getDisplayValue(), 'New Guy');
  devEq_(R, 'cpAssignMember_ writes the ID exactly', roster.getRange(start + 1, CONFIG.roster.discord).getDisplayValue(), devId_(9));
  devEq_(R, 'cpAssignMember_ defaults to Inactive', devActivity_(roster, 1), 'Inactive');
  devEq_(R, 'cpAssignMember_ returns the slot rank', seated.rank, 'Corporal');
  let dup = false; try { cpAssignMember_(roster, { row: start + 2, name: 'X', discord: devId_(1) }); } catch (e) { dup = true; }
  devCheck_(R, 'cpAssignMember_ rejects a duplicate ID', dup);
  let fmt = false; try { cpAssignMember_(roster, { row: start + 2, name: 'Y', discord: '123' }); } catch (e) { fmt = true; }
  devCheck_(R, 'cpAssignMember_ rejects a malformed ID', fmt);
  let filled = false; try { cpAssignMember_(roster, { row: start, name: 'Z', discord: devId_(50) }); } catch (e) { filled = true; }
  devCheck_(R, 'cpAssignMember_ rejects an already-filled slot', filled);

  // cpMoveMember_ — relocate a member into an open slot; MEMBER columns follow, SLOT rank/callsign belong to the destination
  roster = devBuildRoster_([
    { rank: 'Trooper', name: 'Mover', id: devId_(1), activity: 'Active', hours: 9 },
    { rank: 'Sergeant', name: '', id: '' },                                    // open promotion target
    { rank: 'Trooper', name: 'Stay', id: devId_(2), activity: 'Active', hours: 3 },
  ]);
  (() => {
    const RC = rosterCols_(roster);
    const mv = cpMoveMember_(roster, start, start + 1);
    devEq_(R, 'cpMoveMember_ reports the origin rank', mv.fromRank, 'Trooper');
    devEq_(R, 'cpMoveMember_ reports the destination rank', mv.toRank, 'Sergeant');
    devEq_(R, 'cpMoveMember_ moves the name to the destination', roster.getRange(start + 1, RC.name).getDisplayValue(), 'Mover');
    devEq_(R, 'cpMoveMember_ moves the ID exactly (precision-safe)', roster.getRange(start + 1, RC.discord).getDisplayValue(), devId_(1));
    devEq_(R, 'cpMoveMember_ carries MEMBER columns (hours follow the person)', String(roster.getRange(start + 1, RC.hours).getValue()), '9');
    devEq_(R, 'cpMoveMember_ clears the source name', roster.getRange(start, RC.name).getDisplayValue(), '');
    devEq_(R, 'cpMoveMember_ clears the source ID', roster.getRange(start, RC.discord).getDisplayValue(), '');
    devEq_(R, 'cpMoveMember_ keeps the SLOT rank at the source (now an open slot)', roster.getRange(start, RC.rank).getDisplayValue(), 'Trooper');
    devEq_(R, 'cpMoveMember_ returns the member at the new slot rank', mv.member.rank, 'Sergeant');
    let occ = false; try { cpMoveMember_(roster, start + 2, start + 1); } catch (e) { occ = true; }
    devCheck_(R, 'cpMoveMember_ rejects a move into an occupied slot', occ);
    let emptySrc = false; try { cpMoveMember_(roster, start, start + 1); } catch (e) { emptySrc = true; } // source emptied by the move above
    devCheck_(R, 'cpMoveMember_ rejects moving an empty source row', emptySrc);
    let same = false; try { cpMoveMember_(roster, start + 1, start + 1); } catch (e) { same = true; }
    devCheck_(R, 'cpMoveMember_ rejects a same-row move', same);
  })();

  // cpScheduleLeave_ — appends, dedup key, Approved applies, validates
  roster = devBuildRoster_([{ rank: 'Trooper', name: 'Leaver', id: devId_(1), activity: 'Active', hours: 12 }]);
  const tracker = devBuildTracker_([]);
  const sStr = Utilities.formatDate(devDay_(2), ssTz_(), 'yyyy-MM-dd');
  const eStr = Utilities.formatDate(devDay_(5), ssTz_(), 'yyyy-MM-dd');
  const lv = cpScheduleLeave_(roster, tracker, { row: start, type: 'LOA', status: 'Pending', start: sStr, end: eStr }, { sendWebhooks: false });
  devEq_(R, 'cpScheduleLeave_ appends one tracker row', devDataRows_(tracker, CONFIG.trackerStartRow), 1);
  devEq_(R, 'cpScheduleLeave_ status is Pending', devTrackerStatus_(tracker, 0), 'Pending');
  devEq_(R, 'cpScheduleLeave_ writes the member name', tracker.getRange(CONFIG.trackerStartRow, CONFIG.tracker.name).getDisplayValue(), 'Leaver');
  devEq_(R, 'cpScheduleLeave_ Pending is not applied', lv.applied, false);
  const key = String(tracker.getRange(CONFIG.trackerStartRow, CONFIG.tracker.key).getDisplayValue());
  devCheck_(R, 'cpScheduleLeave_ writes a KEY| dedup key', key.indexOf('KEY|') === 0, key);
  const aStr = Utilities.formatDate(devDay_(-1), ssTz_(), 'yyyy-MM-dd');
  const a2 = Utilities.formatDate(devDay_(3), ssTz_(), 'yyyy-MM-dd');
  const lv2 = cpScheduleLeave_(roster, tracker, { row: start, type: 'ROA', status: 'Approved', start: aStr, end: a2 }, { sendWebhooks: false });
  devEq_(R, 'cpScheduleLeave_ Approved+active applies to roster', devActivity_(roster, 0), 'ROA');
  devEq_(R, 'cpScheduleLeave_ applied flag is true', lv2.applied, true);
  let bt = false; try { cpScheduleLeave_(roster, tracker, { row: start, type: 'XYZ', start: sStr, end: eStr }, { sendWebhooks: false }); } catch (e) { bt = true; }
  devCheck_(R, 'cpScheduleLeave_ rejects a bad type', bt);
  let bd = false; try { cpScheduleLeave_(roster, tracker, { row: start, type: 'LOA', start: eStr, end: sStr }, { sendWebhooks: false }); } catch (e) { bd = true; }
  devCheck_(R, 'cpScheduleLeave_ rejects end-before-start', bd);

  // cpDetectMove_ — audit move detection
  roster = devBuildRoster_([
    { rank: 'Major', name: 'Mover', id: devId_(7), activity: 'Active', unit: 'S-04' },
    { rank: 'Captain', name: '', id: '', unit: 'S-12' },
  ]);
  roster.getRange(start + 1, CONFIG.roster.discord).setNumberFormat('@');
  roster.getRange(start + 1, CONFIG.roster.discord).setValue(devId_(7)); // ID copied to target; source still has it
  const mv = cpDetectMove_(roster, start + 1, devId_(7));
  devCheck_(R, 'cpDetectMove_ detects a move', !!mv);
  devEq_(R, 'cpDetectMove_ from = source rank · callsign', mv ? mv.from : '', 'Major · S-04');
  devEq_(R, 'cpDetectMove_ to = target rank · callsign', mv ? mv.to : '', 'Captain · S-12');
  devEq_(R, 'cpDetectMove_ member = source name', mv ? mv.member : '', 'Mover');
  devCheck_(R, 'cpDetectMove_ null for a brand-new ID', cpDetectMove_(roster, start + 1, devId_(99)) === null);
  devCheck_(R, 'cpDetectMove_ null for a malformed ID', cpDetectMove_(roster, start + 1, '123') === null);

  // snapshot capture + restore
  roster = devBuildRoster_([
    { rank: 'Trooper', name: 'Snap A', id: devId_(1), activity: 'Active', hours: 11 },
    { rank: 'Trooper', name: 'Snap B', id: devId_(2), activity: 'Inactive', hours: 0 },
    { rank: 'SUPERVISORY COMMAND', name: '', id: '' }, // ALL-CAPS divider — excluded
  ]);
  const snap = cpSnapshotRows_(roster, 'TID', 'now');
  devEq_(R, 'cpSnapshotRows_ captures members only (skips divider)', snap.length, 2);
  devEq_(R, 'cpSnapshotRows_ row[0] name', snap[0][3], 'Snap A');
  devEq_(R, 'cpSnapshotRows_ row[0] ID exact', snap[0][4], devId_(1));
  cpSetStatus_(roster, start, 'Inactive');
  roster.getRange(start, CONFIG.roster.name).setValue('CHANGED');
  const restored = cpApplyRestore_(roster, snap);
  devEq_(R, 'cpApplyRestore_ restored count', restored, 2);
  devEq_(R, 'cpApplyRestore_ restores the name', roster.getRange(start, CONFIG.roster.name).getDisplayValue(), 'Snap A');
  devEq_(R, 'cpApplyRestore_ restores the status', devActivity_(roster, 0), 'Active');

  // schema guard — cpHeaderIssues_ (position-based, used for tracker/form)
  const sg = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Active' }]);
  devEq_(R, 'cpHeaderIssues_ clean layout → no issues', cpHeaderIssues_(sg, 'Sandbox', 5, { 2: 'RANK', 3: 'NAME', 5: 'DISCORD', 8: 'ACTIVITY', 9: 'HOURS' }).length, 0);
  sg.getRange(5, 8).setValue('WRONG');
  devCheck_(R, 'cpHeaderIssues_ flags a header drift', cpHeaderIssues_(sg, 'Sandbox', 5, { 8: 'ACTIVITY' }).length >= 1);
  devCheck_(R, 'cpColLetter_ maps 1→A / 5→E / 27→AA', cpColLetter_(1) === 'A' && cpColLetter_(5) === 'E' && cpColLetter_(27) === 'AA');

  // header-based resolution — rosterCols_ tracks reordered columns; cpRosterHeaderIssues_ flags missing labels
  const hb = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Active', hours: 12 }]);
  devEq_(R, 'rosterCols_ default: ACTIVITY → col 8', rosterCols_(hb).activity, 8);
  devEq_(R, 'cpRosterHeaderIssues_ clean roster → no issues', cpRosterHeaderIssues_(hb).length, 0);
  const hb2 = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(1) }]);
  hb2.getRange(5, 16).setValue('ACTIVITY'); hb2.getRange(5, 8).setValue('SOMETHING ELSE'); // move ACTIVITY to col 16
  devEq_(R, 'rosterCols_ tracks a moved ACTIVITY header → col 16', rosterCols_(hb2).activity, 16);
  const hb3 = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(1) }]);
  hb3.getRange(5, 8).setValue('SOMETHING ELSE'); // remove the ACTIVITY header entirely
  devCheck_(R, 'cpRosterHeaderIssues_ flags a missing ACTIVITY header', cpRosterHeaderIssues_(hb3).length >= 1, cpRosterHeaderIssues_(hb3).join(' | '));

  // end-to-end: a fully REORDERED roster still works through the REAL functions (not just the resolver)
  const rr = devFreshSheet_('Reorder');
  rr.getRange(5, 2).setValue('HOURS');            // scrambled layout, headers on row 5
  rr.getRange(5, 3).setValue('NAME');
  rr.getRange(5, 4).setValue('UNIT NUMBER');
  rr.getRange(5, 5).setValue('ACTIVITY');
  rr.getRange(5, 7).setValue('RANK');
  rr.getRange(5, 8).setValue('JOIN DATE');
  rr.getRange(5, 9).setValue('LAST PROMOTION');
  rr.getRange(5, 10).setValue('DISCORD UNIQUE ID');
  const drow = CONFIG.rosterStartRow;
  rr.getRange(drow, 2).setValue(3);               // HOURS
  rr.getRange(drow, 3).setValue('Reorder Test');  // NAME
  rr.getRange(drow, 4).setValue('S-99');          // UNIT NUMBER
  rr.getRange(drow, 5).setValue('Active');        // ACTIVITY (3h should recompute to Inactive)
  rr.getRange(drow, 7).setValue('Trooper');       // RANK
  rr.getRange(drow, 10).setNumberFormat('@'); rr.getRange(drow, 10).setValue(devId_(1)); // DISCORD
  SpreadsheetApp.flush();
  const RCx = rosterCols_(rr);
  devEq_(R, 'reorder: rosterCols_ resolves RANK → col 7', RCx.rank, 7);
  devEq_(R, 'reorder: rosterCols_ resolves DISCORD → col 10', RCx.discord, 10);
  devEq_(R, 'reorder: rosterCols_ resolves HOURS → col 2', RCx.hours, 2);
  const mm = cpMemberAt_(rr, drow);
  devEq_(R, 'reorder: cpMemberAt_ reads NAME from its real column', mm.name, 'Reorder Test');
  devEq_(R, 'reorder: cpMemberAt_ reads RANK from its real column', mm.rank, 'Trooper');
  devEq_(R, 'reorder: cpMemberAt_ reads CALLSIGN from its real column', mm.callsign, 'S-99');
  devEq_(R, 'reorder: cpMemberAt_ reads DISCORD exactly', mm.discord, devId_(1));
  recomputeStatuses_(rr, false);
  devEq_(R, 'reorder: recomputeStatuses_ writes ACTIVITY in its real column (3h→Inactive)', rr.getRange(drow, 5).getDisplayValue(), 'Inactive');

  // dividers — the engine must skip ALL-CAPS section-divider rows everywhere
  devCheck_(R, 'isMemberSlot_ rejects an ALL-CAPS divider', isMemberSlot_('EXECUTIVE COMMAND') === false);
  devCheck_(R, 'isMemberSlot_ accepts normal ranks', isMemberSlot_('Trooper') === true && isMemberSlot_('Auxiliary Trooper') === true);
  const dv = devBuildRoster_([
    { rank: 'EXECUTIVE COMMAND', name: '' },                                            // divider @ start
    { rank: 'Colonel', name: 'A. One', id: devId_(1), activity: 'Active', hours: 12 },  // member @ start+1
    { rank: 'TROOPERS', name: '' },                                                     // divider @ start+2
    { rank: 'Trooper', name: 'B. Two', id: devId_(2), activity: 'Active', hours: 3 },   // member @ start+3
  ]);
  recomputeStatuses_(dv, false);
  devEq_(R, 'dividers: member status recomputed (12h→Active)', devActivity_(dv, 1), 'Active');
  devEq_(R, 'dividers: member status recomputed (3h→Inactive)', devActivity_(dv, 3), 'Inactive');
  devEq_(R, 'dividers: divider label untouched by recompute', dv.getRange(start, rosterCols_(dv).rank).getDisplayValue(), 'EXECUTIVE COMMAND');
  devWithConfig_({}, () => { // default S-{00} format so a live custom UNIT_FORMAT can't red these (dv uses the fixed default column layout)
    devNumberSheet_(dv);
    devEq_(R, 'dividers: numbering gives first member S-01', dv.getRange(start + 1, CONFIG.roster.unit).getDisplayValue(), 'S-01');
    devEq_(R, 'dividers: numbering gives next member S-02 (divider skipped)', dv.getRange(start + 3, CONFIG.roster.unit).getDisplayValue(), 'S-02');
  });
  devEq_(R, 'dividers: divider row gets no callsign', dv.getRange(start, CONFIG.roster.unit).getDisplayValue(), '');
  devEq_(R, 'dividers: snapshot excludes dividers (2 members captured)', cpSnapshotRows_(dv, 'T', 'now').length, 2);
  let dvThrow = false; try { cpAssignMember_(dv, { row: start, name: 'X', discord: devId_(8) }); } catch (e) { dvThrow = true; }
  devCheck_(R, 'dividers: cannot seat a member into a divider row', dvThrow);

  // training sections are label-based (immune to row shifts) + rename behavior
  const tr = devBuildRoster_([
    { rank: 'CADET PROGRAM', name: '' },                                       // training divider @ start
    { rank: 'Cadet', name: 'C. Three', id: devId_(3), activity: 'Inactive' },  // under training @ start+1
    { rank: 'PATROL DIVISION', name: '' },                                     // non-training divider @ start+2
    { rank: 'Trooper', name: 'D. Four', id: devId_(4), activity: 'Active' },   // non-training @ start+3
  ]);
  devCheck_(R, 'isTrainingRow_ true under a CADET/TRAINING divider', isTrainingRow_(tr, start + 1) === true);
  devCheck_(R, 'isTrainingRow_ false under a non-training divider', isTrainingRow_(tr, start + 3) === false);
  const tr2 = devBuildRoster_([
    { rank: 'EXECUTIVE COMMAND', name: '' },
    { rank: 'Colonel', name: 'E. Five', id: devId_(5), activity: 'Active' },
    { rank: 'FIELD TRAINING', name: '' },                                      // training divider lower down
    { rank: 'Trooper', name: 'F. Six', id: devId_(6), activity: 'Active' },    // under training @ start+3
  ]);
  devCheck_(R, 'isTrainingRow_ tracks a training section at a shifted row', isTrainingRow_(tr2, start + 3) === true);
  devCheck_(R, 'isTrainingRow_ false under EXECUTIVE COMMAND', isTrainingRow_(tr2, start + 1) === false);
  devCheck_(R, 'renamed ALL-CAPS divider still skipped', isMemberSlot_('COMMAND STAFF') === false);
  devCheck_(R, 'mixed-case "divider" is treated as a member (must stay ALL-CAPS)', isMemberSlot_('Command Staff') === true);

  // --- cpParseYMD_ (pure date entry point for cpScheduleLeave_) ---
  (() => {
    const d = cpParseYMD_('2026-03-15');
    devCheck_(R, 'cpParseYMD_ "2026-03-15" → local midnight 2026-03-15',
      d.getFullYear() === 2026 && d.getMonth() === 2 && d.getDate() === 15 && d.getHours() === 0);
    const d2 = cpParseYMD_('2026-3-15'); // no zero-pad still parses (Number coercion)
    devCheck_(R, 'cpParseYMD_ "2026-3-15" → month index 2 / day 15', d2.getMonth() === 2 && d2.getDate() === 15);
    ['', '2026-03', 'not-a-date'].forEach((bad) => {
      devCheck_(R, `cpParseYMD_ "${bad}" → Invalid Date`, isNaN(cpParseYMD_(bad).getTime()));
    });
    devCheck_(R, 'cpParseYMD_ null → Invalid Date', isNaN(cpParseYMD_(null).getTime()));
    // REGRESSION (audit): out-of-range parts must be REJECTED, not silently rolled into a valid date
    devCheck_(R, 'cpParseYMD_ "2026-13-40" → Invalid (no rollover)', isNaN(cpParseYMD_('2026-13-40').getTime()));
    devCheck_(R, 'cpParseYMD_ "2026-02-30" → Invalid (Feb 30 rolls)', isNaN(cpParseYMD_('2026-02-30').getTime()));
  })();

  // --- cpColLetter_ base-26 (no-zero) rollover boundaries ---
  devEq_(R, 'cpColLetter_ 26 → Z', cpColLetter_(26), 'Z');
  devEq_(R, 'cpColLetter_ 28 → AB', cpColLetter_(28), 'AB');
  devEq_(R, 'cpColLetter_ 52 → AZ', cpColLetter_(52), 'AZ');
  devEq_(R, 'cpColLetter_ 53 → BA', cpColLetter_(53), 'BA');

  // --- cpScheduleLeave_ approved-but-FUTURE leave: appended but NOT applied yet ---
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'F', id: devId_(1), activity: 'Active', hours: 12 }]);
    const tk = devBuildTracker_([]);
    const fmt = (d) => Utilities.formatDate(d, ssTz_(), 'yyyy-MM-dd');
    const res = cpScheduleLeave_(ro, tk, { row: start, type: 'LOA', status: 'Approved', start: fmt(devDay_(3)), end: fmt(devDay_(10)) }, { sendWebhooks: false });
    devEq_(R, 'future Approved leave: applied === false', res.applied, false);
    devEq_(R, 'future Approved leave: roster stays Active (not yet applied)', devActivity_(ro, 0), 'Active');
    devEq_(R, 'future Approved leave: one row appended', devDataRows_(tk, CONFIG.trackerStartRow), 1);
    devEq_(R, 'future Approved leave: tracker status Approved', devTrackerStatus_(tk, 0), 'Approved');
  })();

  // --- cpScheduleLeave_ throw-guards (NO tracker row appended on any throw) ---
  (() => {
    const ro = devBuildRoster_([{ rank: 'Sergeant', name: '', id: '' }]); // OPEN slot
    const tk = devBuildTracker_([]);
    const fmt = (d) => Utilities.formatDate(d, ssTz_(), 'yyyy-MM-dd');
    let threw = false;
    try { cpScheduleLeave_(ro, tk, { row: start, type: 'LOA', status: 'Pending', start: fmt(devDay_(2)), end: fmt(devDay_(5)) }, { sendWebhooks: false }); } catch (e) { threw = true; }
    devCheck_(R, 'cpScheduleLeave_ open slot → throws', threw);
    devEq_(R, 'cpScheduleLeave_ open slot → nothing appended', devDataRows_(tk, CONFIG.trackerStartRow), 0);
  })();
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'NoId', id: '123', activity: 'Active', hours: 5 }]); // malformed ID
    const tk = devBuildTracker_([]);
    const fmt = (d) => Utilities.formatDate(d, ssTz_(), 'yyyy-MM-dd');
    let threw = false;
    try { cpScheduleLeave_(ro, tk, { row: start, type: 'LOA', status: 'Pending', start: fmt(devDay_(2)), end: fmt(devDay_(5)) }, { sendWebhooks: false }); } catch (e) { threw = true; }
    devCheck_(R, 'cpScheduleLeave_ malformed Discord ID → throws', threw);
    devEq_(R, 'cpScheduleLeave_ malformed Discord ID → nothing appended', devDataRows_(tk, CONFIG.trackerStartRow), 0);
  })();
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Dated', id: devId_(1), activity: 'Active', hours: 5 }]);
    const tk = devBuildTracker_([]);
    const fmt = (d) => Utilities.formatDate(d, ssTz_(), 'yyyy-MM-dd');
    let bothBlank = false;
    try { cpScheduleLeave_(ro, tk, { row: start, type: 'LOA', status: 'Pending', start: '', end: '' }, { sendWebhooks: false }); } catch (e) { bothBlank = true; }
    devCheck_(R, 'cpScheduleLeave_ both dates blank → throws', bothBlank);
    let endBlank = false;
    try { cpScheduleLeave_(ro, tk, { row: start, type: 'LOA', status: 'Pending', start: fmt(devDay_(2)), end: '' }, { sendWebhooks: false }); } catch (e) { endBlank = true; }
    devCheck_(R, 'cpScheduleLeave_ end blank → throws', endBlank);
    devEq_(R, 'cpScheduleLeave_ missing dates → nothing appended', devDataRows_(tk, CONFIG.trackerStartRow), 0);
  })();

  // --- cpSetStatusBulk_ guards + partial success ---
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Inactive' }]);
    [[], null, undefined].forEach((badRows, idx) => {
      let threw = false;
      try { cpSetStatusBulk_(ro, badRows, 'Active'); } catch (e) { threw = true; }
      devCheck_(R, `cpSetStatusBulk_ empty/non-array rows #${idx} → throws`, threw);
    });
    let badStatus = false;
    try { cpSetStatusBulk_(ro, [start], 'BadStatus'); } catch (e) { badStatus = true; }
    devCheck_(R, 'cpSetStatusBulk_ invalid status → throws', badStatus);
  })();
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Inactive' },
      { rank: 'PATROL TROOPERS', name: '' }, // divider in the middle → silently skipped
      { rank: 'Trooper', name: 'C', id: devId_(3), activity: 'Inactive' },
    ]);
    const res = cpSetStatusBulk_(ro, [start, start + 1, start + 2], 'Active');
    devEq_(R, 'cpSetStatusBulk_ partial: count === 2 (divider skipped)', res.count, 2);
    devEq_(R, 'cpSetStatusBulk_ partial: row 0 → Active', devActivity_(ro, 0), 'Active');
    devEq_(R, 'cpSetStatusBulk_ partial: divider activity untouched', String(ro.getRange(start + 1, rosterCols_(ro).activity).getDisplayValue()), '');
    devEq_(R, 'cpSetStatusBulk_ partial: row 2 → Active', devActivity_(ro, 2), 'Active');
  })();

  // --- cpAssignMember_ join-date default + hours init ---
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Seated', id: devId_(1), activity: 'Active' },
      { rank: 'Corporal', name: '', id: '' },
    ]);
    const RC = rosterCols_(ro);
    cpAssignMember_(ro, { row: start + 1, name: 'New', discord: devId_(9) }); // no joinDate
    devCheck_(R, 'cpAssignMember_ no joinDate → defaults to today',
      new Date(ro.getRange(start + 1, RC.join).getValue()).toDateString() === todayInSheetTz_().toDateString());
    devEq_(R, 'cpAssignMember_ initializes hours to 0', ro.getRange(start + 1, RC.hours).getValue(), 0);
  })();
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Seated', id: devId_(1), activity: 'Active' },
      { rank: 'Corporal', name: '', id: '' },
    ]);
    const RC = rosterCols_(ro);
    cpAssignMember_(ro, { row: start + 1, name: 'New', discord: devId_(9), joinDate: 'totally-bogus' }); // unparseable
    devCheck_(R, 'cpAssignMember_ unparseable joinDate → falls back to today',
      new Date(ro.getRange(start + 1, RC.join).getValue()).toDateString() === todayInSheetTz_().toDateString());
  })();
  (() => {
    // REGRESSION (audit): a valid joinDate lands on the EXACT local date — no new Date('yyyy-MM-dd') UTC day-shift
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Seated', id: devId_(1), activity: 'Active' },
      { rank: 'Corporal', name: '', id: '' },
    ]);
    const RC = rosterCols_(ro);
    cpAssignMember_(ro, { row: start + 1, name: 'Dated', discord: devId_(9), joinDate: '2026-03-15' });
    const jd = new Date(ro.getRange(start + 1, RC.join).getValue());
    devCheck_(R, 'cpAssignMember_ valid joinDate → exact local 2026-03-15 (no off-by-one)', jd.getFullYear() === 2026 && jd.getMonth() === 2 && jd.getDate() === 15);
  })();

  // --- low-level guards: cpAssertUniqueId_ / cpAssertSlotRow_ ---
  // NB: devBuildRoster_([]) replaces the SANDBOX_Roster tab, so do the empty-roster check FIRST —
  // building it after `ro` would delete `ro`'s sheet and leave a stale reference.
  (() => {
    let emptyRoster = false; try { cpAssertUniqueId_(devBuildRoster_([]), devId_(1), -1); } catch (e) { emptyRoster = true; }
    devCheck_(R, 'cpAssertUniqueId_ empty roster → no throw', !emptyRoster);

    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'One', id: devId_(1), activity: 'Active' }]);
    let ownRow = false; try { cpAssertUniqueId_(ro, devId_(1), start); } catch (e) { ownRow = true; }
    devCheck_(R, 'cpAssertUniqueId_ exempts own row (no throw)', !ownRow);
    let otherRow = false; try { cpAssertUniqueId_(ro, devId_(1), start + 99); } catch (e) { otherRow = true; }
    devCheck_(R, 'cpAssertUniqueId_ throws when ID exists on a different row', otherRow);
    [start - 1, 0, NaN].forEach((badRow, idx) => {
      let threw = false; try { cpAssertSlotRow_(ro, badRow); } catch (e) { threw = true; }
      devCheck_(R, `cpAssertSlotRow_ rejects row "${String(badRow)}" (#${idx})`, threw);
    });
    let okRow = false; try { cpAssertSlotRow_(ro, start); } catch (e) { okRow = true; }
    devCheck_(R, 'cpAssertSlotRow_ accepts a real member row (no throw)', !okRow);
  })();

  // --- cpMemberAt_ on an OPEN slot: filled === false, rank still read ---
  (() => {
    const ro = devBuildRoster_([{ rank: 'Sergeant', name: '', id: '' }]);
    const m = cpMemberAt_(ro, start);
    devEq_(R, 'cpMemberAt_ open slot: filled === false', m.filled, false);
    devEq_(R, 'cpMemberAt_ open slot: name === ""', m.name, '');
    devEq_(R, 'cpMemberAt_ open slot: rank still read', m.rank, 'Sergeant');
  })();

  // --- cpDetectMove_ DISCORD_ID_RE length boundaries (17 & 19 digits) + trim-tolerant ---
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Major', name: 'Src17', id: '12345678901234567', activity: 'Active', unit: 'S-01' }, // 17 digits
      { rank: 'Captain', name: '', id: '' },
    ]);
    ro.getRange(start + 1, CONFIG.roster.discord).setNumberFormat('@').setValue('12345678901234567');
    devCheck_(R, 'cpDetectMove_ 17-digit ID → detected', !!cpDetectMove_(ro, start + 1, '12345678901234567'));
  })();
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Major', name: 'Src19', id: '1234567890123456789', activity: 'Active', unit: 'S-01' }, // 19 digits
      { rank: 'Captain', name: '', id: '' },
    ]);
    ro.getRange(start + 1, CONFIG.roster.discord).setNumberFormat('@').setValue('1234567890123456789');
    devCheck_(R, 'cpDetectMove_ 19-digit ID → detected', !!cpDetectMove_(ro, start + 1, '1234567890123456789'));
  })();
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Major', name: 'Padded', id: ' 909090909090909090 ', activity: 'Active', unit: 'S-04' }, // padded stored ID
      { rank: 'Captain', name: '', id: '' },
    ]);
    ro.getRange(start + 1, CONFIG.roster.discord).setNumberFormat('@').setValue('909090909090909090');
    const mv = cpDetectMove_(ro, start + 1, '909090909090909090');
    devCheck_(R, 'cpDetectMove_ trim-tolerant match against padded stored ID', !!mv);
    devEq_(R, 'cpDetectMove_ trim-tolerant: member = source name', mv ? mv.member : '', 'Padded');
  })();

  // Columns tab cores — cpColumnsInfo_ (samples + classes + counts) and cpSetColumnClass_ (save to _Columns)
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Alpha', id: devId_(1), activity: 'Active', hours: 12 },
      { rank: 'Sergeant', name: '', id: '' }, // open slot — not a valid member
    ]);
    ro.getRange(5, 13).setValue('COMMUNITY ID');
    ro.getRange(start, 13).setValue('CID-1');
    SpreadsheetApp.flush();
    const byH = {}; cpColumnsInfo_(ro, {}).forEach((c) => { byH[c.header.toUpperCase()] = c; }); // {} → pure defaults
    devEq_(R, 'cpColumnsInfo_ RANK → SLOT', byH['RANK'].klass, 'SLOT');
    devEq_(R, 'cpColumnsInfo_ NAME → MEMBER', byH['NAME'].klass, 'MEMBER');
    devEq_(R, 'cpColumnsInfo_ NAME sample = first member', byH['NAME'].sample, 'Alpha');
    devEq_(R, 'cpColumnsInfo_ counts valid members only (total 1)', byH['NAME'].total, 1);
    devEq_(R, 'cpColumnsInfo_ new COMMUNITY ID → MEMBER', byH['COMMUNITY ID'].klass, 'MEMBER');
  })();
  (() => {
    // Phase 1 fold: classes live in the [COLUMNS] block of ⚙️ Config — sandbox mimics a mini Config tab.
    const cfg = devFreshSheet_('Columns');
    cfg.getRange(1, 1, 7, 4).setValues([
      ['RE_CONFIG', '', '', ''],                       // row 1: marker banner
      ['', '', '', ''],                                // row 2: gap
      ['[COLUMNS]', '', '', ''],                       // row 3: block banner
      ['Role', 'Match', 'Class', 'Required'],          // row 4: table header
      ['RANK', 'RANK', 'SLOT', 'TRUE'],                // row 5: role row (never touched)
      ['', 'COMMUNITY ID', 'MEMBER', ''],              // row 6: existing blank-Role class row
      ['', '', '', ''],                                // row 7: blank row ends the block
    ]);
    SpreadsheetApp.flush();
    cpSetColumnClass_(cfg, 'COMMUNITY ID', 'SLOT'); // flip the existing class row in place
    devEq_(R, 'cpSetColumnClass_ flips an existing class row inside [COLUMNS]', String(cfg.getRange(6, 3).getDisplayValue()), 'SLOT');
    devEq_(R, 'cpSetColumnClass_ flip leaves the role row (RANK) untouched', String(cfg.getRange(5, 3).getDisplayValue()), 'SLOT');
    cpSetColumnClass_(cfg, 'STEAM ID', 'MEMBER');   // new header → blank-Role row appended inside the block
    devEq_(R, 'cpSetColumnClass_ appends a new blank-Role row before the block-ending blank row', String(cfg.getRange(7, 2).getDisplayValue()), 'STEAM ID');
    devEq_(R, 'cpSetColumnClass_ appended row has an empty Role cell', String(cfg.getRange(7, 1).getDisplayValue()), '');
    devEq_(R, 'cpSetColumnClass_ writes the appended class', String(cfg.getRange(7, 3).getDisplayValue()), 'MEMBER');
    devEq_(R, 'cpSetColumnClass_ append keeps the blank row after the block', String(cfg.getRange(8, 1, 1, 4).getDisplayValues()[0].join('')), '');
    let bad = false; try { cpSetColumnClass_(cfg, 'X', 'BOGUS'); } catch (e) { bad = true; }
    devCheck_(R, 'cpSetColumnClass_ rejects an invalid class', bad);
  })();

  // Dividers tab core — cpDividersInfo_ auto-detects all-caps section headers + counts members/slots beneath each
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Alpha', id: devId_(1), activity: 'Active', hours: 12 }, // above any divider — uncounted
      { rank: 'COMMAND STAFF', name: '' },                                              // standard divider
      { rank: 'Captain', name: 'Bravo', id: devId_(2), activity: 'Active', hours: 9 },
      { rank: 'Sergeant', name: '', id: '' },                                           // open slot (a slot, not a member)
      { rank: 'CADETS', name: '' },                                                     // training divider
      { rank: 'Cadet', name: 'Charlie', id: devId_(3), activity: 'Active', hours: 4 },
      { rank: 'Cadet', name: 'Delta', id: devId_(4), activity: 'Active', hours: 6 },
    ]);
    const divs = cpDividersInfo_(ro);
    devEq_(R, 'cpDividersInfo_ finds both dividers', divs.length, 2);
    const byL = {}; divs.forEach((d) => { byL[d.label] = d; });
    devEq_(R, 'cpDividersInfo_ COMMAND STAFF at the right row', byL['COMMAND STAFF'].row, start + 1);
    devEq_(R, 'cpDividersInfo_ COMMAND STAFF not flagged training', byL['COMMAND STAFF'].training, false);
    devEq_(R, 'cpDividersInfo_ COMMAND STAFF members exclude the open slot', byL['COMMAND STAFF'].members, 1);
    devEq_(R, 'cpDividersInfo_ COMMAND STAFF slots include the open slot', byL['COMMAND STAFF'].slots, 2);
    devEq_(R, 'cpDividersInfo_ CADETS flagged as a training section', byL['CADETS'].training, true);
    devEq_(R, 'cpDividersInfo_ CADETS members counted', byL['CADETS'].members, 2);
    devEq_(R, 'cpDividersInfo_ CADETS slots counted', byL['CADETS'].slots, 2);
    // people[] backs the expandable member dropdowns
    devEq_(R, 'cpDividersInfo_ COMMAND STAFF people lists only the filled member', byL['COMMAND STAFF'].people.length, 1);
    devEq_(R, 'cpDividersInfo_ COMMAND STAFF people[0] name', byL['COMMAND STAFF'].people[0].name, 'Bravo');
    devEq_(R, 'cpDividersInfo_ COMMAND STAFF people[0] status mirrors ACTIVITY', byL['COMMAND STAFF'].people[0].status, 'Active');
    devEq_(R, 'cpDividersInfo_ CADETS people lists both cadets in order', byL['CADETS'].people.map((p) => p.name).join(','), 'Charlie,Delta');
    // category[] backs the colored section-type tags
    devEq_(R, 'cpDividersInfo_ COMMAND STAFF category → Command', byL['COMMAND STAFF'].category.label, 'Command');
    devEq_(R, 'cpDividersInfo_ CADETS category → Cadet', byL['CADETS'].category.label, 'Cadet');
  })();
  // Bug fix — a divider in the gap row directly under the header (row 6, above rosterStartRow) is now detected
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Topmost', id: devId_(5), activity: 'Active', hours: 11 }]);
    ro.getRange(ROSTER_HEADER_ROW + 1, CONFIG.roster.rank).setValue('EXECUTIVE COMMAND'); // B6 divider (e.g. a merged B6:D6)
    SpreadsheetApp.flush();
    const byL = {}; cpDividersInfo_(ro).forEach((d) => { byL[d.label] = d; });
    devCheck_(R, 'cpDividersInfo_ catches a divider in the row under the header (row 6)', !!byL['EXECUTIVE COMMAND']);
    devEq_(R, 'cpDividersInfo_ row-6 divider reports ROSTER_HEADER_ROW+1', byL['EXECUTIVE COMMAND'].row, ROSTER_HEADER_ROW + 1);
    devEq_(R, 'cpDividersInfo_ row-6 divider counts the member below it', byL['EXECUTIVE COMMAND'].members, 1);
    devEq_(R, 'cpDividersInfo_ row-6 divider people includes that member', byL['EXECUTIVE COMMAND'].people[0].name, 'Topmost');
    devEq_(R, 'cpDividersInfo_ EXECUTIVE COMMAND category → Executive', byL['EXECUTIVE COMMAND'].category.label, 'Executive');
  })();
  // section-category classifier — first CONFIG.sectionCategories match wins (specific → general); overlap resolution
  devEq_(R, 'sectionCategory_ EXECUTIVE COMMAND → Executive', sectionCategory_('EXECUTIVE COMMAND').label, 'Executive');
  devEq_(R, 'sectionCategory_ ADMINISTRATIVE COMMAND → Administrative', sectionCategory_('ADMINISTRATIVE COMMAND').label, 'Administrative');
  devEq_(R, 'sectionCategory_ SUPERVISORY COMMAND → Supervisor', sectionCategory_('SUPERVISORY COMMAND').label, 'Supervisor');
  devEq_(R, 'sectionCategory_ SUPERVISOR IN TRAINING → Supervisor (beats Training)', sectionCategory_('SUPERVISOR IN TRAINING').label, 'Supervisor');
  devEq_(R, 'sectionCategory_ FIELD TRAINING → Training', sectionCategory_('FIELD TRAINING').label, 'Training');
  devEq_(R, 'sectionCategory_ CADETS → Cadet (beats Training)', sectionCategory_('CADETS').label, 'Cadet');
  devEq_(R, 'sectionCategory_ PATROL TROOPERS → Patrol', sectionCategory_('PATROL TROOPERS').label, 'Patrol');
  devEq_(R, 'sectionCategory_ AUXILIARY TROOPERS → Auxiliary', sectionCategory_('AUXILIARY TROOPERS').label, 'Auxiliary');
  devEq_(R, 'sectionCategory_ plain COMMAND STAFF → Command', sectionCategory_('COMMAND STAFF').label, 'Command');
  devCheck_(R, 'sectionCategory_ → null for an unmatched label', sectionCategory_('RANGERS') === null);
  devCheck_(R, 'sectionCategory_ every category has a tone token', CONFIG.sectionCategories.every((c) => !!c.tone));
  // dashboardStats_ — section-aware headcount buckets + hours/leaves, all by divider LABEL (position-independent)
  (() => {
    const ro = devBuildRoster_([
      { rank: 'EXECUTIVE COMMAND', name: '' },                                              // → Supervisors bucket (Executive)
      { rank: 'Colonel', name: 'A', id: devId_(1), activity: 'Active', hours: 10 },
      { rank: 'Sergeant', name: '', id: '' },                                               // open slot (counts as a slot, not a member)
      { rank: 'PATROL TROOPERS', name: '' },                                                // → Troopers bucket (Patrol)
      { rank: 'Trooper', name: 'B', id: devId_(2), activity: 'LOA', hours: 0 },
      { rank: 'Trooper', name: 'C', id: devId_(3), activity: 'Inactive', hours: 3 },
      { rank: 'AUXILIARY TROOPERS', name: '' },                                             // → Auxiliary bucket
      { rank: 'Auxiliary Trooper', name: 'D', id: devId_(4), activity: 'Active', hours: 6 },
    ]);
    const s = dashboardStats_(ro);
    devEq_(R, 'dashboardStats_ total members', s.total, 4);
    devEq_(R, 'dashboardStats_ total hours summed', s.totalHours, 19);
    devEq_(R, 'dashboardStats_ current LOAs/ROAs', s.leaves, 1);
    devEq_(R, 'dashboardStats_ Supervisors bucket', s.groups.Supervisors, 1);
    devEq_(R, 'dashboardStats_ Troopers bucket', s.groups.Troopers, 2);
    devEq_(R, 'dashboardStats_ Auxiliary bucket', s.groups.Auxiliary, 1);
    devEq_(R, 'dashboardStats_ open slots counted', s.openSlots, 1);
    devEq_(R, 'dashboardStats_ total = sum of buckets', s.groups.Supervisors + s.groups.Troopers + s.groups.Auxiliary, s.total);
    devEq_(R, 'dashboardStats_ top hours: leader first', s.top[0] && s.top[0].n, 'A');
    devEq_(R, 'dashboardStats_ top hours: zero-hour members excluded', s.top.length, 3);
  })();
  // dashboardStats_ — RANK-NAME bucket entries: a Categories entry that isn't a section tag matches members by
  // exact rank (case-insensitive) and WINS over the row's section ("Sergeant and up" style groups).
  (() => {
    devWithConfig_({ DASHBOARD_GROUPS: { kind: 'table', header: ['Group', 'Categories'], rows: [
      ['Brass', 'Executive, sergeant'], ['Rest', 'Patrol, Auxiliary'],
    ] } }, () => {
      const ro = devBuildRoster_([
        { rank: 'EXECUTIVE COMMAND', name: '' },
        { rank: 'Colonel', name: 'A', id: devId_(1), activity: 'Active', hours: 10 },
        { rank: 'PATROL TROOPERS', name: '' },
        { rank: 'Sergeant', name: 'B', id: devId_(2), activity: 'Active', hours: 5 }, // rank listed → Brass, not Rest
        { rank: 'Trooper', name: 'C', id: devId_(3), activity: 'Active', hours: 2 },
      ]);
      const s = dashboardStats_(ro);
      devEq_(R, 'rank entry: Sergeant under a Patrol divider lands in Brass (lowercase entry matches)', s.groups.Brass, 2);
      devEq_(R, 'rank entry: unlisted ranks keep their section bucket', s.groups.Rest, 1);
      devEq_(R, 'rank entry: no double count — total = sum of buckets', s.groups.Brass + s.groups.Rest, s.total);
    });
  })();
  // statTagValue_ — the "#stat" tag keys, aliases, and group-by-name lookups (case-insensitive)
  (() => {
    const s = { total: 30, active: 18, semi: 2, inactive: 10, leaves: 1, openSlots: 5, totalHours: 266.81, groups: { Supervisors: 14, Troopers: 10, Auxiliary: 6 } };
    devEq_(R, 'statTagValue_ #members', statTagValue_(s, 'members'), 30);
    devEq_(R, 'statTagValue_ multi-word group name answers its stripped tag', statTagValue_({ tierCounts: {}, groups: { 'Command Staff': 4 } }, 'commandstaff'), 4);
    devEq_(R, 'statTagValue_ #active', statTagValue_(s, 'active'), 18);
    devEq_(R, 'statTagValue_ #onleave alias', statTagValue_(s, 'onleave'), 1);
    devEq_(R, 'statTagValue_ #hours', statTagValue_(s, 'hours'), 266.81);
    devEq_(R, 'statTagValue_ #openslots', statTagValue_(s, 'openslots'), 5);
    devEq_(R, 'statTagValue_ group by name #troopers', statTagValue_(s, 'Troopers'), 10);
    devEq_(R, 'statTagValue_ case-insensitive #AUXILIARY', statTagValue_(s, 'AUXILIARY'), 6);
    devCheck_(R, 'statTagValue_ unknown key → null', statTagValue_(s, 'bogus') === null);
  })();
  // divider primitives — isDividerValue_ (all-caps, > 3 chars) + isTrainingDividerLabel_ (keyword match)
  devCheck_(R, 'isDividerValue_ true for an all-caps section label', isDividerValue_('CADETS'));
  devCheck_(R, 'isDividerValue_ false for a normal mixed-case rank', !isDividerValue_('Trooper'));
  devCheck_(R, 'isDividerValue_ false for a short all-caps rank (<= 3 chars)', !isDividerValue_('PFC'));
  devCheck_(R, 'isDividerValue_ false for a blank value', !isDividerValue_(''));
  devCheck_(R, 'isTrainingDividerLabel_ matches a CADET divider', isTrainingDividerLabel_('CADETS'));
  devCheck_(R, 'isTrainingDividerLabel_ matches a TRAINING divider', isTrainingDividerLabel_('FIELD TRAINING'));
  devCheck_(R, 'isTrainingDividerLabel_ false for a non-training divider', !isTrainingDividerLabel_('COMMAND STAFF'));

  // LAST ACTIVITY capture core — mirror ACTIVITY → LAST ACTIVITY for valid members; preserve dividers; -1 if no column
  devEq_(R, 'lastActivityCol_ → -1 when the header is absent', lastActivityCol_(devBuildRoster_([{ rank: 'Trooper', name: 'X', id: devId_(1), activity: 'Active' }])), -1);
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Active', hours: 12 },
      { rank: 'PATROL TROOPERS', name: '' },                                       // divider
      { rank: 'Trooper', name: 'B', id: devId_(2), activity: 'Inactive', hours: 0 },
    ]);
    ro.getRange(5, 10).setValue('LAST ACTIVITY');
    ro.getRange(start, 10).setValue('PRESET');        // member row → overwritten
    ro.getRange(start + 1, 10).setValue('DIV-KEEP');  // divider row → preserved
    SpreadsheetApp.flush();
    devEq_(R, 'lastActivityCol_ finds the header (col 10)', lastActivityCol_(ro), 10);
    const count = captureLastActivityCore_(ro);
    devEq_(R, 'captureLastActivityCore_ count = members only (2)', count, 2);
    devEq_(R, 'LAST ACTIVITY mirrors member 1 ACTIVITY', String(ro.getRange(start, 10).getDisplayValue()), 'Active');
    devEq_(R, 'LAST ACTIVITY mirrors member 2 (Inactive) exactly', String(ro.getRange(start + 2, 10).getDisplayValue()), 'Inactive');
    devEq_(R, 'divider LAST ACTIVITY left untouched', String(ro.getRange(start + 1, 10).getDisplayValue()), 'DIV-KEEP');
  })();

  devInfo_(R, 'Live-only paths not covered here', 'cpEnsureAuditTrigger / cpSetSnapshotAuto / cpFixTriggers mutate project triggers, and classifyAudit runs client-side — verified by design, not in the sandbox.');
  return R;
}

/* ======================================================================
 * GROUP 10 — EXTRAS (RosterExtras.gs: readMembers_ / activeLeaves_ / weekKey_ / fmtDate_)
 * The whole file previously had ZERO coverage — these are the highest-value adds.
 * ====================================================================== */
function devExtrasTests_() {
  const R = devNewResults_('Extras: history / coverage (sandbox)');

  // --- readMembers_ (data entry point for hours-history / weekly reset / integrity) ---
  devEq_(R, 'readMembers_ empty roster → []', readMembers_(devBuildRoster_([])).length, 0);
  (() => {
    const ro = devBuildRoster_([
      { rank: 'PATROL TROOPERS', name: '' },                                              // divider dropped
      { rank: 'Trooper', name: '' },                                                      // blank-name slot dropped
      { rank: 'Trooper', name: 'J. Doe', id: devId_(1), activity: 'Active', hours: 12 },  // real member
    ]);
    const m = readMembers_(ro);
    devEq_(R, 'readMembers_ drops divider + blank-name slot → 1 member', m.length, 1);
    devEq_(R, 'readMembers_ returns the real member name', m[0].name, 'J. Doe');
  })();
  (() => {
    const ro = devBuildRoster_([{ rank: ' Trooper ', name: ' J. Doe ', id: '533653499049934878', activity: ' Active ', hours: 7 }]);
    const m = readMembers_(ro)[0];
    devEq_(R, 'readMembers_ trims rank', m.rank, 'Trooper');
    devEq_(R, 'readMembers_ trims name', m.name, 'J. Doe');
    devEq_(R, 'readMembers_ keeps Discord ID exact (17-19 digits)', m.id, '533653499049934878');
    devEq_(R, 'readMembers_ trims activity', m.activity, 'Active');
    devEq_(R, 'readMembers_ reports the real row', m.row, CONFIG.rosterStartRow);
  })();
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Raw', id: devId_(2), activity: 'Active', hours: '8h 15m' }]);
    devEq_(R, 'readMembers_ returns hours RAW (unparsed, not 8.25)', readMembers_(ro)[0].hours, '8h 15m');
  })();
  (() => {
    // scrambled column order — readMembers_ must honor rosterCols_ (header-based, reorder-safe)
    const ro = devFreshSheet_('Roster');
    ro.getRange(5, 2).setValue('HOURS');
    ro.getRange(5, 3).setValue('NAME');
    ro.getRange(5, 4).setValue('UNIT NUMBER');
    ro.getRange(5, 5).setValue('ACTIVITY');
    ro.getRange(5, 7).setValue('RANK');
    ro.getRange(5, 8).setValue('JOIN DATE');
    ro.getRange(5, 9).setValue('LAST PROMOTION');
    ro.getRange(5, 10).setValue('DISCORD UNIQUE ID');
    const drow = CONFIG.rosterStartRow;
    ro.getRange(drow, 2).setValue(9);            // HOURS
    ro.getRange(drow, 3).setValue('Scrambled');  // NAME
    ro.getRange(drow, 5).setValue('Active');     // ACTIVITY
    ro.getRange(drow, 7).setValue('Trooper');    // RANK
    ro.getRange(drow, 10).setNumberFormat('@'); ro.getRange(drow, 10).setValue(devId_(5)); // DISCORD
    SpreadsheetApp.flush();
    const m = readMembers_(ro)[0];
    devEq_(R, 'readMembers_ scrambled: NAME from col 3', m.name, 'Scrambled');
    devEq_(R, 'readMembers_ scrambled: RANK from col 7', m.rank, 'Trooper');
    devEq_(R, 'readMembers_ scrambled: DISCORD from col 10', m.id, devId_(5));
    devEq_(R, 'readMembers_ scrambled: ACTIVITY from col 5', m.activity, 'Active');
  })();

  // --- activeLeaves_ (Approved & not-yet-ended; ends-today inclusive; started flag) ---
  devEq_(R, 'activeLeaves_ empty tracker → []', activeLeaves_(devBuildTracker_([])).length, 0);
  (() => {
    const tr = devBuildTracker_([
      { name: 'PendingOne', id: devId_(1), type: 'LOA', start: devDay_(-1), end: devDay_(10), status: 'Pending' },
      { name: 'ApprovedOne', id: devId_(2), type: 'LOA', start: devDay_(-1), end: devDay_(10), status: 'Approved' },
    ]);
    const a = activeLeaves_(tr);
    devEq_(R, 'activeLeaves_ filters non-Approved → 1', a.length, 1);
    devEq_(R, 'activeLeaves_ returns the Approved leave', a[0].name, 'ApprovedOne');
  })();
  (() => {
    const tr = devBuildTracker_([{ name: 'Ended', id: devId_(1), type: 'LOA', start: devDay_(-10), end: devDay_(-1), status: 'Approved' }]);
    devEq_(R, 'activeLeaves_ excludes already-ended (today > end) → []', activeLeaves_(tr).length, 0);
  })();
  (() => {
    const tr = devBuildTracker_([{ name: 'EndsToday', id: devId_(1), type: 'LOA', start: devDay_(-5), end: devDay_(0), status: 'Approved' }]);
    const a = activeLeaves_(tr);
    devEq_(R, 'activeLeaves_ ends-today is INCLUSIVE → 1', a.length, 1);
    devCheck_(R, 'activeLeaves_ ends-today: started === true', a[0] && a[0].started === true);
  })();
  (() => {
    const tr = devBuildTracker_([
      { name: 'Now', id: devId_(1), type: 'LOA', start: devDay_(-1), end: devDay_(10), status: 'Approved' },
      { name: 'Soon', id: devId_(2), type: 'LOA', start: devDay_(3), end: devDay_(10), status: 'Approved' },
    ]);
    const a = activeLeaves_(tr);
    const now = a.filter((x) => x.name === 'Now')[0];
    const soon = a.filter((x) => x.name === 'Soon')[0];
    devCheck_(R, 'activeLeaves_ currently-out (start<=today) → started true', now && now.started === true);
    devCheck_(R, 'activeLeaves_ upcoming (start>today) → started false', soon && soon.started === false);
  })();
  (() => {
    const tr = devBuildTracker_([{ name: 'NoDates', id: devId_(1), type: 'LOA', status: 'Approved' }]); // no start/end
    let threw = false; let len = -1;
    try { len = activeLeaves_(tr).length; } catch (e) { threw = true; }
    devCheck_(R, 'activeLeaves_ blank dates → no throw', !threw);
    devEq_(R, 'activeLeaves_ blank dates → skipped ([])', len, 0);
  })();
  (() => {
    const tr = devBuildTracker_([{ name: 'IdTest', id: '533653499049934878', type: 'ROA', start: devDay_(-1), end: devDay_(10), status: 'Approved' }]);
    const a = activeLeaves_(tr)[0];
    devEq_(R, 'activeLeaves_ keeps ID exact', a.id, '533653499049934878');
    devEq_(R, 'activeLeaves_ passes type through raw', a.type, 'ROA');
  })();
  (() => {
    // documents that activeLeaves_ does NOT validate start<=end (reversed still returned while today<=end)
    const tr = devBuildTracker_([{ name: 'Rev', id: devId_(1), type: 'LOA', start: devDay_(10), end: devDay_(2), status: 'Approved' }]);
    const a = activeLeaves_(tr);
    devEq_(R, 'activeLeaves_ reversed dates still returned (today<=end) → 1', a.length, 1);
    devCheck_(R, 'activeLeaves_ reversed: started false (future start)', a[0] && a[0].started === false);
  })();

  // --- weekKey_ (canonical week bucket = the week's Sunday, yyyy-MM-dd) ---
  devEq_(R, 'weekKey_ Sunday maps to itself', weekKey_(new Date(2026, 5, 14)), '2026-06-14');
  devEq_(R, 'weekKey_ Mon & Fri of one week collapse to a single key', weekKey_(new Date(2026, 5, 15)), weekKey_(new Date(2026, 5, 19)));
  devEq_(R, 'weekKey_ cross-month rollback (Tue 1 Sep → 30 Aug)', weekKey_(new Date(2026, 8, 1)), '2026-08-30');
  devCheck_(R, 'weekKey_() no-arg → today fallback (yyyy-MM-dd, no throw)', /^\d{4}-\d{2}-\d{2}$/.test(weekKey_()));
  devCheck_(R, 'weekKey_("garbage") → today fallback (no throw)', /^\d{4}-\d{2}-\d{2}$/.test(weekKey_('garbage')));

  // --- fmtDate_ ---
  devEq_(R, 'fmtDate_ valid Date → yyyy-MM-dd', fmtDate_(new Date(2026, 2, 15)), '2026-03-15');
  devEq_(R, 'fmtDate_ Invalid Date → "Invalid Date" (date-coercion immune)', fmtDate_(new Date('not-a-date')), 'Invalid Date');
  devEq_(R, 'fmtDate_ trims a string value', fmtDate_('  hello '), 'hello');
  devEq_(R, 'fmtDate_ "" → ""', fmtDate_(''), '');
  devEq_(R, 'fmtDate_ null → ""', fmtDate_(null), '');
  devEq_(R, 'fmtDate_ undefined → ""', fmtDate_(undefined), '');

  return R;
}

/* ======================================================================
 * GROUP 11 — TRUST (RosterTrust.gs: snapshots / restore / schema guards)
 * ====================================================================== */
function devTrustTests_() {
  const R = devNewResults_('Trust: snapshots / schema (sandbox)');
  const start = CONFIG.rosterStartRow;

  // --- cpSnapshotRows_ ---
  devEq_(R, 'cpSnapshotRows_ empty roster → []', cpSnapshotRows_(devBuildRoster_([]), 'T', 'now').length, 0);
  (() => {
    const ro = devBuildRoster_([{ rank: 'Sergeant', name: 'Snap', id: devId_(1), activity: 'LOA', hours: 7 }]);
    const r = cpSnapshotRows_(ro, 'TID', 'now')[0];
    devEq_(R, 'cpSnapshotRows_ captures Status (protected preserved)', r[5], 'LOA');
    devEq_(R, 'cpSnapshotRows_ captures Hours as display text', r[6], '7');
    devEq_(R, 'cpSnapshotRows_ captures Rank', r[7], 'Sergeant');
  })();

  // --- cpApplyRestore_ skip guards (divider / below-start) ---
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'OrigA', id: devId_(1), activity: 'Active', hours: 10 },
      { rank: 'PATROL TROOPERS', name: '' }, // divider at start+1
    ]);
    const snap = [
      ['s', 'now', start, 'GoodName', devId_(1), 'Active', 10, 'Trooper'],
      ['s', 'now', start + 1, 'BleedName', devId_(2), 'Active', 10, 'Trooper'],  // points at divider → skip
      ['s', 'now', start - 1, 'OutOfRange', devId_(3), 'Active', 10, 'Trooper'], // below start → skip
    ];
    const restored = cpApplyRestore_(ro, snap);
    const RC = rosterCols_(ro);
    devEq_(R, 'cpApplyRestore_ skips divider + below-start → restored 1', restored, 1);
    devEq_(R, 'cpApplyRestore_ wrote the valid member row', ro.getRange(start, RC.name).getDisplayValue(), 'GoodName');
    devEq_(R, 'cpApplyRestore_ did NOT write the divider row', String(ro.getRange(start + 1, RC.name).getDisplayValue()), '');
    devEq_(R, 'cpApplyRestore_ did NOT write above the start row', String(ro.getRange(start - 1, RC.name).getDisplayValue()), '');
  })();

  // --- cpApplyRestore_ hours coercion (numeric → float, NON-numeric → raw string) ---
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Active', hours: 0 },
      { rank: 'Trooper', name: 'B', id: devId_(2), activity: 'Active', hours: 0 },
    ]);
    const RC = rosterCols_(ro);
    cpApplyRestore_(ro, [
      ['s', 'now', start, 'A', devId_(1), 'Active', '7.5', 'Trooper'],
      ['s', 'now', start + 1, 'B', devId_(2), 'Active', 'xyz', 'Trooper'], // parseFloat('xyz') → NaN → raw
    ]);
    const h0 = ro.getRange(start, RC.hours).getValue();
    devCheck_(R, 'cpApplyRestore_ numeric hours "7.5" → number 7.5', typeof h0 === 'number' && h0 === 7.5);
    devEq_(R, 'cpApplyRestore_ non-numeric hours preserved as raw string', ro.getRange(start + 1, RC.hours).getDisplayValue(), 'xyz');
  })();

  // --- cpRosterHeaderIssues_ / cpHeaderIssues_ guards ---
  devEq_(R, 'cpRosterHeaderIssues_ null sheet → []', cpRosterHeaderIssues_(null).length, 0);
  devEq_(R, 'cpHeaderIssues_ null sheet → []', cpHeaderIssues_(null, 'X', 5, { 3: 'NAME' }).length, 0);
  (() => {
    const sh = devFreshSheet_('HeaderMissing');
    sh.getRange(1, 1).setValue('only row 1'); // getLastRow() === 1, below the header rows
    const ri = cpRosterHeaderIssues_(sh);
    devEq_(R, 'cpRosterHeaderIssues_ header row missing → 1 issue', ri.length, 1);
    devCheck_(R, 'cpRosterHeaderIssues_ issue names the missing header row', ri[0].indexOf('header row') !== -1, ri[0]);
    const hi = cpHeaderIssues_(sh, 'Tracker', 5, { 3: 'NAME' });
    devEq_(R, 'cpHeaderIssues_ header row missing → 1 issue', hi.length, 1);
    devCheck_(R, 'cpHeaderIssues_ issue mentions "header row 5 is missing"', hi[0].indexOf('header row 5 is missing') !== -1, hi[0]);
  })();
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Active' }]);
    ro.getRange(5, 5).setValue('SOMETHING ELSE'); // overwrite the DISCORD header (devBuildRoster_ puts DISCORD at col 5)
    const issues = cpRosterHeaderIssues_(ro);
    devCheck_(R, 'cpRosterHeaderIssues_ flags a missing DISCORD header', issues.some((s) => s.indexOf('DISCORD') !== -1), issues.join(' | '));
  })();

  // --- cpPruneSnapshots_ (keeps the most recent TRUST.keepSnapshots distinct IDs) ---
  (() => {
    const sh = devSnapshotSheet_(22, 2); // 22 distinct snapshot IDs, 2 rows each (~44 rows)
    cpPruneSnapshots_(sh);
    const ids = devDistinctSnapshotIds_(sh);
    devEq_(R, `cpPruneSnapshots_ keeps exactly ${TRUST.keepSnapshots} distinct IDs`, ids.length, TRUST.keepSnapshots);
    devCheck_(R, 'cpPruneSnapshots_ removed the oldest ID "1"', ids.indexOf('1') === -1);
    devCheck_(R, 'cpPruneSnapshots_ removed the oldest ID "2"', ids.indexOf('2') === -1);
    devCheck_(R, 'cpPruneSnapshots_ kept the newest ID "22"', ids.indexOf('22') !== -1);
    devEq_(R, 'cpPruneSnapshots_ "22" still has its 2 rows', devSnapshotRowCount_(sh, '22'), 2);
  })();
  (() => {
    const sh = devSnapshotSheet_(3, 2); // only 3 distinct IDs (≤ keep) → no-op
    const before = sh.getLastRow();
    cpPruneSnapshots_(sh);
    devEq_(R, 'cpPruneSnapshots_ ≤ keep → no rows removed (early return)', sh.getLastRow(), before);
  })();

  // snapshots capture + restore EXTRA member columns, so a new column survives snapshot/restore
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Snap', id: devId_(1), activity: 'Active', hours: 7 }]);
    ro.getRange(5, 13).setValue('COMMUNITY ID');
    ro.getRange(start, 13).setNumberFormat('@').setValue('99900011122233344');
    SpreadsheetApp.flush();
    const snap = cpSnapshotRows_(ro, 'T', 'now');
    devCheck_(R, 'cpSnapshotRows_ captures an Extra JSON blob (index 8)',
      snap[0].length >= 9 && String(snap[0][8]).indexOf('COMMUNITY ID') !== -1, String(snap[0][8]));
    ro.getRange(start, 13).setValue('CHANGED');
    cpApplyRestore_(ro, snap);
    devEq_(R, 'cpApplyRestore_ restores the extra column exactly (precision-safe)', String(ro.getRange(start, 13).getDisplayValue()), '99900011122233344');
  })();

  // REGRESSION (audit) — cpApplyRestore_ restores by IDENTITY: a snapshot whose stored row no longer holds
  // that member lands on the row currently holding the ID, and does NOT corrupt whoever sits at the stored row.
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'OrigA', id: devId_(1), activity: 'Active', hours: 10 },
      { rank: 'Trooper', name: 'OrigB', id: devId_(2), activity: 'Active', hours: 10 },
    ]);
    // Snapshot says devId_(1) was at row `start` with name 'BackupA' — but rows have since shifted:
    const snap = [['s', 'now', start, 'BackupA', devId_(1), 'LOA', 5, 'Trooper', '{}']];
    ro.getRange(start, CONFIG.roster.discord).setNumberFormat('@').setValue(devId_(2));      // `start` now holds devId_(2)
    ro.getRange(start, CONFIG.roster.name).setValue('OrigB');
    ro.getRange(start + 1, CONFIG.roster.discord).setNumberFormat('@').setValue(devId_(1));  // devId_(1) is now at start+1
    ro.getRange(start + 1, CONFIG.roster.name).setValue('OrigA');
    SpreadsheetApp.flush();
    cpApplyRestore_(ro, snap);
    devEq_(R, 'restore-by-ID: lands on the row currently holding the ID (start+1)', String(ro.getRange(start + 1, CONFIG.roster.name).getDisplayValue()), 'BackupA');
    devEq_(R, 'restore-by-ID: does NOT corrupt the other member at the stored row (start)', String(ro.getRange(start, CONFIG.roster.name).getDisplayValue()), 'OrigB');
  })();

  return R;
}

/** Builds a sandbox _Snapshots-schema sheet: `idCount` distinct IDs ("1".."N"), each repeated `perId` rows. */
function devSnapshotSheet_(idCount, perId) {
  const sh = devFreshSheet_('Snapshots');
  sh.getRange(1, 1, 1, 8).setValues([['SnapshotId', 'When', 'Row', 'Name', 'Discord', 'Status', 'Hours', 'Rank']]);
  const rows = [];
  for (let i = 1; i <= idCount; i++) {
    for (let j = 0; j < perId; j++) {
      rows.push([String(i), 'when', CONFIG.rosterStartRow + j, `N${i}-${j}`, devId_(i * 10 + j), 'Active', 5, 'Trooper']);
    }
  }
  sh.getRange(2, 1, rows.length, 1).setNumberFormat('@'); // SnapshotIds as exact text
  sh.getRange(2, 1, rows.length, 8).setValues(rows);
  if (DEV_THEME_SANDBOX) devTheme_(sh, 1, 5);
  return sh;
}

/** Distinct snapshot IDs currently in column A (rows 2..last) of a snapshot sheet, in first-seen order. */
function devDistinctSnapshotIds_(sh) {
  if (sh.getLastRow() < 2) return [];
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
  const out = [];
  v.forEach((r) => { const id = String(r[0]).trim(); if (id && out.indexOf(id) === -1) out.push(id); });
  return out;
}

/** Count of rows in a snapshot sheet belonging to a given snapshot ID. */
function devSnapshotRowCount_(sh, id) {
  if (sh.getLastRow() < 2) return 0;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
  return v.filter((r) => String(r[0]).trim() === String(id)).length;
}

/* ======================================================================
 * GROUP 12 — CONFIG ENGINE (RosterConfig.gs: norm_ / validateConfig_ /
 * ladders / parseBlocks_ / setColumnClassRow_ / theme_ / errors / guarded_)
 * validateConfig_ and computeStatusCore_ are PURE (fed synthetic raw blocks /
 * an injected engine); sheet-touching cores run only against sandboxes.
 * cfg_/seedConfigTab_/slog_ sheet-write paths are deliberately NOT exercised
 * here — they target the real ⚙️ Config / SYS Log tabs.
 * ====================================================================== */
/* ======================================================================
 * PREFLIGHT — live-config guard (F-028). Runs FIRST in devRunAllTests().
 * The sandbox builders + many assertions read the LIVE ⚙️ Config through the
 * CONFIG bridge, so a customized LOAD-BEARING value silently skews default-
 * assuming tests. This surfaces that up front: hard FAIL only if the config
 * won't load; INFO (not FAIL) for legitimate customization.
 * LOAD-BEARING KEYS (keep in sync): [ROSTER_LAYOUT].HEADER_ROW/DATA_START_ROW/
 * TRACKER_START_ROW · [THEME].PASS/FAIL · [SHEETS].* · [STATUSES] tier names ·
 * [LEAVE].LEAVE_TYPES/STATUS_FLOW/APPROVED_STATUS.
 * ====================================================================== */
function devConfigPreflight_() {
  const R = devNewResults_('Config preflight (live-config guard)');
  let v;
  try { v = cfg_(); }
  catch (e) {
    devCheck_(R, 'live ⚙️ Config loads without ERROR — FIX THE CONFIG TAB before trusting any result below', false, String((e && e.message) || e));
    return R;
  }
  const L = v.legacy;
  devCheck_(R, 'bridge resolves theme colors (bg.done/error non-empty)', !!L.bg.done && !!L.bg.error, `${L.bg.done} / ${L.bg.error}`);
  devCheck_(R, 'bridge resolves sheet names (roster/tracker non-empty)', !!L.sheets.roster && !!L.sheets.tracker, `${L.sheets.roster} / ${L.sheets.tracker}`);
  const flag = (label, actual, expected) => {
    if (actual === expected) devCheck_(R, `${label} = shipped default`, true, devShow_(actual));
    else devInfo_(R, `${label} CUSTOMIZED — sandbox tests assume ${devShow_(expected)}`, `live = ${devShow_(actual)} (default-assuming tests may skew — not necessarily a bug)`);
  };
  flag('rosterStartRow', L.rosterStartRow, 7);
  flag('trackerStartRow', L.trackerStartRow, 6);
  flag('headerRow', L.headerRow, 5);
  flag('thresholds.active', L.thresholds.active, 10);
  flag('thresholds.semi', L.thresholds.semi, 5);
  flag('tier names', L.tierNames.join(','), 'Active,Semi-Active,Inactive');
  flag('leave types', L.leaveTypes.join(','), 'LOA,ROA');
  flag('approved status', L.approvedStatus, 'Approved');
  return R;
}

/**
 * Run fn() with a SYNTHETIC config injected into the CFG_ memo the bridge reads, then hard-restore the live
 * config. Lets stateful, cfg_()-backed functions (resolveStatus_, computeStatus_, processDailyLOAs_, dashboardStats_)
 * be exercised under a white-label (renamed) config without touching the operator's real ⚙️ Config tab.
 * ALWAYS restores in finally — a throw can't leak a fake config into later sections.
 * @param {Object} rawBlocks synthetic raw blocks (validateConfig_ shape); omitted blocks fall back to defaults.
 * @param {Function} fn receives (materializedConfig, validation) and runs assertions.
 */
function devWithConfig_(rawBlocks, fn) {
  const val = validateConfig_(rawBlocks || {});
  const injected = materialize_(val.config, true);
  CFG_ = injected; CFG_ERROR_ = null;                 // bridge now returns the synthetic config
  try { return fn(injected, val); }
  finally { cfgInvalidate_(); if (typeof _rosterColCache === 'object' && _rosterColCache) { Object.keys(_rosterColCache).forEach((k) => delete _rosterColCache[k]); } } // force a live re-read + drop cached columns
}

/* ======================================================================
 * SECTION 14 — WHITE-LABEL & CONFIG VOCABULARY (F-004/005/006/034)
 * Proves the hot logic reads status/leave/tier names from config, not literals:
 * a community can rename everything and the scheduler, status protection,
 * counters, and leave-type validation still work.
 * ====================================================================== */
function devWhiteLabelTests_() {
  const R = devNewResults_('White-label & config vocabulary (sandbox)');
  const NO_HOOK = { sendWebhooks: false };

  // --- New optional [LEAVE] keys default to the shipped names (additive, back-compat) ---
  (() => {
    const v = validateConfig_({});
    devEq_(R, 'default APPROVED_STATUS = "Approved"', v.config.kv.LEAVE.APPROVED_STATUS, 'Approved');
    devEq_(R, 'default EXPIRED_STATUS = "Expired"', v.config.kv.LEAVE.EXPIRED_STATUS, 'Expired');
    devEq_(R, 'default RETURN_STATUS = "ROA"', v.config.kv.LEAVE.RETURN_STATUS, 'ROA');
    const L = materialize_(v.config, true).legacy;
    devEq_(R, 'legacy.approvedStatus (default)', L.approvedStatus, 'Approved');
    devEq_(R, 'legacy.expiredStatus (default)', L.expiredStatus, 'Expired');
    devEq_(R, 'legacy.pendingStatus = STATUS_FLOW[0]', L.pendingStatus, 'Pending');
    devEq_(R, 'legacy.returnStatus (default)', L.returnStatus, 'ROA');
    devEq_(R, 'legacy.leaveTypes (default)', L.leaveTypes.join(','), 'LOA,ROA');
    devEq_(R, 'legacy.tierNames (default)', L.tierNames.join(','), 'Active,Semi-Active,Inactive');
  })();

  // --- Validation of the new keys ---
  (() => {
    const v = validateConfig_({ LEAVE: { kind: 'kv', kv: { APPROVED_STATUS: 'Nope' } } });
    devCheck_(R, 'APPROVED_STATUS outside STATUS_FLOW → E-103',
      v.problems.some((p) => p.sev === 'ERROR' && p.code === 'E-103' && p.key === '[LEAVE].APPROVED_STATUS'),
      v.problems.map((p) => p.key).join(' · '));
  })();
  (() => {
    const v = validateConfig_({ LEAVE: { kind: 'kv', kv: { RETURN_STATUS: 'Active' } } }); // Active is a TIER, not LEAVE
    devCheck_(R, 'RETURN_STATUS pointing at a non-LEAVE status → E-103',
      v.problems.some((p) => p.sev === 'ERROR' && p.code === 'E-103' && p.key === '[LEAVE].RETURN_STATUS'),
      v.problems.map((p) => p.key).join(' · '));
  })();

  // --- The RENAMED community: every shipped status/leave/tier name changed (mid tier min = 6 to prove semi tracks position) ---
  const RENAMED = {
    STATUSES: { kind: 'table', header: ['Status', 'Kind', 'MinHours', 'Color', 'Announce'], rows: [
      ['Duty', 'TIER', '10', '', ''], ['Light', 'TIER', '6', '', ''], ['Off', 'TIER', '0', '', ''],
      ['Vacation', 'LEAVE', '', '', ''], ['Returning', 'LEAVE', '', '', ''], ['Medical', 'LEAVE', '', '', ''],
      ['Standby', 'PROTECTED', '', '', ''],
    ] },
    LEAVE: { kind: 'kv', kv: {
      LEAVE_TYPES: 'Vacation, Returning, Medical', STATUS_FLOW: 'New, Greenlit, Rejected, Closed',
      APPROVED_STATUS: 'Greenlit', EXPIRED_STATUS: 'Closed', RETURN_STATUS: 'Returning',
    } },
  };

  devWithConfig_(RENAMED, (cfg, val) => {
    devEq_(R, 'renamed config validates with zero ERRORs', val.problems.filter((p) => p.sev === 'ERROR').length, 0);
    // Vocabulary accessors (F-004/006/034)
    devEq_(R, 'CONFIG.approvedStatus tracks rename', CONFIG.approvedStatus, 'Greenlit');
    devEq_(R, 'CONFIG.expiredStatus tracks rename', CONFIG.expiredStatus, 'Closed');
    devEq_(R, 'CONFIG.pendingStatus tracks rename', CONFIG.pendingStatus, 'New');
    devEq_(R, 'CONFIG.returnStatus tracks rename', CONFIG.returnStatus, 'Returning');
    devEq_(R, 'CONFIG.leaveTypes track rename', CONFIG.leaveTypes.join(','), 'Vacation,Returning,Medical');
    devEq_(R, 'CONFIG.tierNames track rename', CONFIG.tierNames.join(','), 'Duty,Light,Off');
    devEq_(R, 'thresholds.active tracks highest tier by position', CONFIG.thresholds.active, 10);
    devEq_(R, 'thresholds.semi tracks 2nd tier by position (6, not default 5)', CONFIG.thresholds.semi, 6);
    // Protection (F-005)
    devEq_(R, 'isProtectedStatus_ custom LEAVE (Medical)', isProtectedStatus_('Medical'), true);
    devEq_(R, 'isProtectedStatus_ custom PROTECTED (Standby)', isProtectedStatus_('Standby'), true);
    devEq_(R, 'isReturningStatus_ tracks RETURN_STATUS', isReturningStatus_('Returning'), true);
    devEq_(R, 'isReturningStatus_ false for a non-return leave', isReturningStatus_('Vacation'), false);
    // computeStatus_ emits RENAMED tier names
    devEq_(R, 'computeStatus_ 12h → renamed top tier Duty', computeStatus_('Trooper', 12), 'Duty');
    devEq_(R, 'computeStatus_ 0h → renamed bottom tier Off', computeStatus_('Trooper', 0), 'Off');
    devEq_(R, 'computeStatus_ 6h → renamed mid tier Light', computeStatus_('Trooper', 6), 'Light');
    // resolveStatus_ (F-005 headline): a custom LEAVE status is NOT overwritten by an hours edit
    devEq_(R, 'resolveStatus_ Medical + 20h → null (custom leave protected)', resolveStatus_('Trooper', 'Medical', 20), null);
    devEq_(R, 'resolveStatus_ Vacation + 0h → null (custom leave protected)', resolveStatus_('Trooper', 'Vacation', 0), null);
    devEq_(R, 'resolveStatus_ Standby → null (custom protected)', resolveStatus_('Trooper', 'Standby', 0), null);
    devEq_(R, 'resolveStatus_ Returning + 5h (<6) → recomputed Off', resolveStatus_('Trooper', 'Returning', 5), 'Off');
    devEq_(R, 'resolveStatus_ Returning + 6h (=6) → null (stays Returning)', resolveStatus_('Trooper', 'Returning', 6), null);
    // Scheduler (F-004): a leave in the RENAMED approved state activates + expires
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'WL', id: devId_(70), activity: 'Duty', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'WL', id: devId_(70), type: 'Vacation', start: devDay_(0), end: devDay_(10), status: 'Greenlit' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'scheduler starts a "Greenlit" leave → roster shows Vacation', devActivity_(ro, 0), 'Vacation');
    const ro2 = devBuildRoster_([{ rank: 'Trooper', name: 'WL2', id: devId_(71), activity: 'Vacation', hours: 0 }]);
    const tr2 = devBuildTracker_([{ name: 'WL2', id: devId_(71), type: 'Vacation', start: devDay_(-10), end: devDay_(-1), status: 'Greenlit' }]);
    processDailyLOAs_(ro2, tr2, devDay_(0), NO_HOOK);
    devEq_(R, 'scheduler expires a past "Greenlit" leave → tracker Closed', devTrackerStatus_(tr2, 0), 'Closed');
  });

  // --- F-034: an unknown leave type is rejected, not silently synced (DEFAULT config) ---
  (() => {
    const form = devBuildForm_([{ name: 'BadType', id: devId_(72), type: 'Training', start: devDay_(1), end: devDay_(5) }]);
    const tr = devBuildTracker_([]);
    const before = tr.getLastRow();
    syncFormToTracker_(form, tr, NO_HOOK);
    devEq_(R, 'unknown leave type appends NOTHING to the tracker', tr.getLastRow(), before);
    const bg = String(form.getRange(2, 1).getBackground()).toLowerCase();
    devEq_(R, 'unknown leave type marks the form row error-colored', bg, String(CONFIG.bg.error).toLowerCase());
  })();

  // --- F-006: counter aliases derive from tier positions; tierCounts keyed by configured name (DEFAULT config) ---
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: devId_(80), activity: 'Active', hours: 12 },
      { rank: 'Trooper', name: 'B', id: devId_(81), activity: 'Semi-Active', hours: 7 },
      { rank: 'Trooper', name: 'C', id: devId_(82), activity: 'Inactive', hours: 1 },
      { rank: 'Trooper', name: 'D', id: devId_(83), activity: 'LOA', hours: 0 },
    ]);
    const s = dashboardStats_(ro);
    devEq_(R, 'dashboardStats active alias = highest tier count', s.active, 1);
    devEq_(R, 'dashboardStats semi alias = middle tier count', s.semi, 1);
    devEq_(R, 'dashboardStats inactive alias = lowest tier count', s.inactive, 1);
    devEq_(R, 'dashboardStats leaves counts LEAVE-kind (LOA)', s.leaves, 1);
    devEq_(R, 'dashboardStats tierCounts keyed by configured name', s.tierCounts['Active'], 1);
    devEq_(R, 'statTagValue_ resolves a tier name', statTagValue_(s, 'inactive'), 1);
  })();

  return R;
}

/* ======================================================================
 * SECTION 15 — IDENTITY-KEYED WRITES & CONCURRENCY (F-001/002/008/027/037/039)
 * Panel writes must target a member by Discord-ID identity, not a stale row
 * index, so a concurrent insert/delete can't land a write on the wrong member.
 * ====================================================================== */
function devIdentityWriteTests_() {
  const R = devNewResults_('Identity-keyed writes & concurrency (sandbox)');
  const NO_HOOK = { sendWebhooks: false };
  const start = CONFIG.rosterStartRow;
  const fmt = (d) => Utilities.formatDate(d, ssTz_(), 'yyyy-MM-dd');

  // --- cpFindRowById_ / cpResolveMemberRow_ (F-002) ---
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Inactive' },
      { rank: 'Trooper', name: 'B', id: devId_(2), activity: 'Inactive' },
      { rank: 'Trooper', name: 'C', id: devId_(3), activity: 'Inactive' },
    ]);
    devEq_(R, 'cpFindRowById_ finds a member by ID', cpFindRowById_(ro, devId_(2)), start + 1);
    devEq_(R, 'cpFindRowById_ missing ID → -1', cpFindRowById_(ro, devId_(99)), -1);
    devEq_(R, 'resolve: ID still at its row → same row', cpResolveMemberRow_(ro, start + 1, devId_(2)), start + 1);
    devEq_(R, 'resolve: stale row → relocates to the ID’s real row', cpResolveMemberRow_(ro, start, devId_(3)), start + 2);
    let gone = false; try { cpResolveMemberRow_(ro, start, devId_(99)); } catch (e) { gone = true; }
    devCheck_(R, 'resolve: vanished ID → throws (refresh required)', gone);
    devEq_(R, 'resolve: no ID → slot-validate returns the row', cpResolveMemberRow_(ro, start, ''), start);
  })();

  // --- cpSetStatusBulk_ identity (F-027): stale rows, IDs authoritative ---
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Inactive' },
      { rank: 'Trooper', name: 'B', id: devId_(2), activity: 'Inactive' },
      { rank: 'Trooper', name: 'C', id: devId_(3), activity: 'Inactive' },
    ]);
    const res = cpSetStatusBulk_(ro, [start], 'Active', [devId_(3)]); // client thinks C is at `start` (stale) — its ID says otherwise
    devEq_(R, 'bulk identity: C (by ID) becomes Active despite stale row', devActivity_(ro, 2), 'Active');
    devEq_(R, 'bulk identity: A (the stale row’s real occupant) is untouched', devActivity_(ro, 0), 'Inactive');
    devEq_(R, 'bulk identity: audit records the real member', res.members.join(','), 'C');
  })();

  // --- cpScheduleLeave_ dedup (F-039) + ID precision (F-001) ---
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Dup', id: devId_(4), activity: 'Active', hours: 12 }]);
    const tk = devBuildTracker_([]);
    const s = fmt(devDay_(2)); const e = fmt(devDay_(5));
    cpScheduleLeave_(ro, tk, { row: start, type: 'LOA', status: 'Pending', start: s, end: e }, NO_HOOK);
    devEq_(R, 'dedup: first identical leave appends', devDataRows_(tk, CONFIG.trackerStartRow), 1);
    let dup = false; try { cpScheduleLeave_(ro, tk, { row: start, type: 'LOA', status: 'Pending', start: s, end: e }, NO_HOOK); } catch (err) { dup = true; }
    devCheck_(R, 'dedup: second identical leave throws (no duplicate row)', dup);
    devEq_(R, 'dedup: still exactly one tracker row', devDataRows_(tk, CONFIG.trackerStartRow), 1);
    const idText = String(tk.getRange(CONFIG.trackerStartRow, CONFIG.tracker.discord).getDisplayValue()).trim();
    devEq_(R, 'ID precision: scheduled 18-digit ID round-trips exactly (F-001)', idText, devId_(4));
  })();

  // --- checkForMemberMove occupied target (F-037) ---
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Mover', id: devId_(5), activity: 'Active', hours: 10 },   // source @ start
      { rank: 'Trooper', name: 'Sitting', id: devId_(6), activity: 'Active', hours: 10 },  // occupied target @ start+1
    ]);
    let msg = '';
    ro.getRange(start + 1, rosterCols_(ro).discord).setValue(devId_(5)); // the edit that fires the trigger
    checkForMemberMove(ro, ro.getRange(start + 1, rosterCols_(ro).discord), devId_(5), (m) => { msg = m; return false; }, () => {});
    devCheck_(R, 'occupied target: prompt warns it already holds the occupant', msg.indexOf('already holds') !== -1 && msg.indexOf('Sitting') !== -1, msg);
    devEq_(R, 'occupied target: declining leaves the occupant’s name intact', String(ro.getRange(start + 1, rosterCols_(ro).name).getDisplayValue()), 'Sitting');
  })();

  // --- checkForMemberMove post-dialog re-read guard (F-008) ---
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Shifter', id: devId_(7), activity: 'Active', hours: 10 }, // source @ start
      { rank: 'Sergeant', name: '', id: '' },                                             // OPEN target @ start+1
    ]);
    ro.getRange(start + 1, rosterCols_(ro).discord).setValue(devId_(7));
    const confirm = () => { ro.getRange(start, rosterCols_(ro).discord).setValue(devId_(77)); return true; }; // concurrent edit moves the source mid-dialog
    checkForMemberMove(ro, ro.getRange(start + 1, rosterCols_(ro).discord), devId_(7), confirm, () => {});
    devEq_(R, 'race guard: target NOT seated when the source shifted mid-dialog', String(ro.getRange(start + 1, rosterCols_(ro).name).getDisplayValue()), '');
  })();

  return R;
}

/* ======================================================================
 * SECTION 16 — CONFIG-TAB ROBUSTNESS (F-013/019/030)
 * The ⚙️ Config tab is a USER-edited sheet: a deleted header, a blank row
 * mid-block, a duplicated roster header, or a future schema bump must fail
 * loud + safe, never silently.
 * ====================================================================== */
function devConfigRobustnessTests_() {
  const R = devNewResults_('Config-tab robustness (sandbox)');

  // --- F-013a: a table block whose header row was deleted (a DATA row masquerades as header) → WARN + seed fallback ---
  (() => {
    const v = validateConfig_({ STATUSES: { kind: 'table', header: ['Active', 'TIER', '10', '#57b85a', 'FALSE'], rows: [
      ['Semi-Active', 'TIER', '5', '', ''], ['Inactive', 'TIER', '0', '', ''],
    ] } });
    devCheck_(R, 'F-013: mismatched STATUSES header → WARN (type=header)',
      v.problems.some((p) => p.sev === 'WARN' && p.key === '[STATUSES]' && p.type === 'header'),
      v.problems.map((p) => `${p.key}:${p.type}`).join(' · '));
    devEq_(R, 'F-013: mismatched header falls back to seed (6 default statuses, not the 2 shifted rows)', v.config.statuses.length, 6);
  })();

  // --- F-013b: a valid header still parses normally (no false positive) ---
  (() => {
    const v = validateConfig_({ STATUSES: { kind: 'table', header: ['Status', 'Kind', 'MinHours', 'Color', 'Announce'], rows: [
      ['Active', 'TIER', '10', '', ''], ['Inactive', 'TIER', '0', '', ''],
    ] } });
    devCheck_(R, 'F-013: matching header → NO header WARN', !v.problems.some((p) => p.type === 'header'));
    devEq_(R, 'F-013: matching header uses the user rows (2 statuses)', v.config.statuses.length, 2);
  })();

  // --- F-013c: a blank row inside a block truncates it → WARN ---
  (() => {
    const v = validateConfig_({ STATUSES: { kind: 'table', header: ['Status', 'Kind', 'MinHours', 'Color', 'Announce'],
      rows: [['Active', 'TIER', '10', '', ''], ['Inactive', 'TIER', '0', '', '']], truncated: true } });
    devCheck_(R, 'F-013: truncated block → WARN (type=truncation)',
      v.problems.some((p) => p.sev === 'WARN' && p.key === '[STATUSES]' && p.type === 'truncation'));
  })();

  // --- F-013d: parseBlocks_ blankTruncates_ helper detects a gap-then-content, ignores a clean end ---
  (() => {
    const withGap = [['[STATUSES]'], ['x'], [''], ['orphan']];        // content after the blank
    const cleanEnd = [['[STATUSES]'], ['x'], [''], ['[LEAVE]']];       // next block after the blank
    devEq_(R, 'F-013: blankTruncates_ true when content follows the blank', blankTruncates_(withGap, 2), true);
    devEq_(R, 'F-013: blankTruncates_ false when the next block follows', blankTruncates_(cleanEnd, 2), false);
  })();

  // --- F-019: duplicate roster header is flagged by the health check ---
  (() => {
    const sh = devFreshSheet_('DupHdr');
    sh.getRange(ROSTER_HEADER_ROW, 2, 1, 9).setValues([['RANK', 'NAME', 'UNIT', 'DISCORD', 'JOIN', 'PROMO', 'ACTIVITY', 'HOURS', 'NAME']]); // duplicate NAME
    const issues = cpRosterHeaderIssues_(sh);
    devCheck_(R, 'F-019: duplicate NAME header is reported', issues.some((i) => i.indexOf('duplicate') !== -1 && i.indexOf('NAME') !== -1), issues.join(' | '));
  })();
  (() => {
    const sh = devFreshSheet_('UniqHdr');
    sh.getRange(ROSTER_HEADER_ROW, 2, 1, 8).setValues([['RANK', 'NAME', 'UNIT', 'DISCORD', 'JOIN', 'PROMO', 'ACTIVITY', 'HOURS']]);
    devCheck_(R, 'F-019: unique headers → no duplicate issue', !cpRosterHeaderIssues_(sh).some((i) => i.indexOf('duplicate') !== -1));
  })();

  // --- F-030: every schema bump above v1 must ship a migration step (loaded-gun guard for v3) ---
  (() => {
    const missing = [];
    for (let v = 2; v <= ENGINE_SCHEMA; v++) { if (typeof MIGRATIONS_[v] !== 'function') missing.push(v); }
    devCheck_(R, 'F-030: every ENGINE_SCHEMA bump has a MIGRATIONS_ step',
      missing.length === 0, missing.length ? `missing steps for v${missing.join(', v')}` : `schema v${ENGINE_SCHEMA}, ${Object.keys(MIGRATIONS_).length} step(s)`);
  })();

  return R;
}

/* ======================================================================
 * SECTION 17 — DASHBOARD RENDER SAFETY (F-009/043)
 * Label-seeking KPI boxes are RETIRED (they adopted cells on user-designed
 * pages): a bare label must attract NO engine write. #stat tags stay live
 * via their note marker. Pinned to DEFAULT config so the seed
 * [DASHBOARD_CELLS] rows (incl. the risky bare "TOTAL") are deterministic.
 * ====================================================================== */
function devDashboardRenderTests_() {
  const R = devNewResults_('Dashboard render safety (sandbox)');
  const s = { total: 30, totalHours: 100, leaves: 2, active: 10, semi: 8, inactive: 12, openSlots: 3, tierCounts: {}, groups: {} };

  devWithConfig_({}, () => { // default DASHBOARD_CELLS: ['TOTAL','right','total'] etc. — must be inert now
    // F-009 (retired mechanism): a matching label with an EMPTY neighbor gets NO value and NO marker.
    (() => {
      const sh = devFreshSheet_('Dash1');
      sh.getRange(1, 1).setValue('TOTAL'); // old dir 'right' would have written B1
      renderDashboardOnSheet_(sh, s);
      devEq_(R, 'retired KPI boxes: label neighbor stays EMPTY', String(sh.getRange(1, 2).getDisplayValue()), '');
      devEq_(R, 'retired KPI boxes: no roster-kpi marker is written', String(sh.getRange(1, 2).getNote()), '');
    })();
    // #stat tag → live value + marker (F-043 path).
    (() => {
      const sh = devFreshSheet_('Dash3');
      sh.getRange(2, 3).setValue('#members');
      renderDashboardOnSheet_(sh, s);
      devEq_(R, 'stat tag #members → live value', String(sh.getRange(2, 3).getDisplayValue()), '30');
      devCheck_(R, 'tag cell carries the roster-stat marker', String(sh.getRange(2, 3).getNote()).indexOf('roster-stat:') === 0);
    })();
    // RECENT-PROMOTIONS feed — the pure promotion predicate + the injectable table renderer (sandbox tab).
    (() => {
      devCheck_(R, 'promoIsPromotion_ up-sheet + rank change → true', promoIsPromotion_(20, 8, 'Trooper', 'Sergeant'));
      devCheck_(R, 'promoIsPromotion_ down-sheet (demotion) → false', !promoIsPromotion_(8, 20, 'Sergeant', 'Trooper'));
      devCheck_(R, 'promoIsPromotion_ same-rank shuffle → false', !promoIsPromotion_(20, 8, 'Trooper', 'Trooper'));
      const sh = devFreshSheet_('Promos');
      sh.getRange(1, 2).setValue('Recent Promotions'); // mixed case — the finder is case-insensitive
      sh.getRange(2, 1, 1, 4).setValues([['DATE', '', 'NAME', 'NEW RANK']]);
      const list = [{ t: Date.now(), n: '=SUM(A1)', r: 'Sergeant' }, { t: Date.now(), n: 'B. Chen', r: 'Lieutenant' }];
      devCheck_(R, 'renderPromotionsOnSheet_ finds the table by title + headers', renderPromotionsOnSheet_(sh, list));
      devEq_(R, 'promotions: newest first, formula-safe name stays literal text', String(sh.getRange(3, 3).getDisplayValue()), '=SUM(A1)');
      devEq_(R, 'promotions: new rank written beside the name', String(sh.getRange(3, 4).getDisplayValue()), 'Sergeant');
      devCheck_(R, 'promotions: date cell filled', String(sh.getRange(3, 1).getDisplayValue()) !== '');
      devEq_(R, 'promotions: second entry on the next row', String(sh.getRange(4, 3).getDisplayValue()), 'B. Chen');
      devEq_(R, 'promotions: unused rows are cleared', String(sh.getRange(5, 3).getDisplayValue()), '');
    })();
    // PATROL LEADERBOARD — title + NAME/HOURS header; names/hours fill top-down, the RANK labels stay untouched.
    (() => {
      const sh = devFreshSheet_('Leader');
      sh.getRange(1, 1).setValue('Patrol Leaderboard'); // mixed case — the finder is case-insensitive
      sh.getRange(2, 1, 1, 3).setValues([['RANK', 'NAME', 'HOURS']]);
      sh.getRange(3, 1, 5, 1).setValues([[1], [2], [3], [4], [5]]);
      renderDashboardOnSheet_(sh, Object.assign({}, s, { top: [{ n: '=BAD()', h: 12.5 }, { n: 'Y', h: 9 }] }));
      devEq_(R, 'leaderboard: top name is formula-safe literal text', String(sh.getRange(3, 2).getDisplayValue()), '=BAD()');
      devEq_(R, 'leaderboard: top hours written as a number', Number(sh.getRange(3, 3).getValue()), 12.5);
      devEq_(R, 'leaderboard: second entry on the next row', String(sh.getRange(4, 2).getDisplayValue()), 'Y');
      devEq_(R, 'leaderboard: unused rows are cleared', String(sh.getRange(5, 2).getDisplayValue()), '');
      devEq_(R, 'leaderboard: RANK labels untouched', String(sh.getRange(5, 1).getDisplayValue()), '3');
    })();
  });

  return R;
}

/* ======================================================================
 * SECTION 18 — SETTINGS APPLY (the Settings Studio dialog: cpGetConfig_/cpApplyConfig_/
 * setTableRows_). The VALIDATE-BEFORE-WRITE contract is the point: a change set
 * that would produce config ERRORs is refused wholesale — NOTHING is written.
 * All sheet work runs against a SANDBOX mini-config sheet (never the real ⚙️ Config).
 * ====================================================================== */
function devSettingsApplyTests_() {
  const R = devNewResults_('Settings apply (sandbox)');

  const buildMiniConfig_ = () => {
    const sh = devFreshSheet_('ConfigApply');
    sh.getRange(1, 1, 13, 5).setValues([
      ['RE_CONFIG', '', '', '', ''],
      ['', '', '', '', ''],
      ['[SHEETS]', '', '', '', ''],
      ['ROSTER', 'Member Information', '', '', ''],
      ['', '', '', '', ''],
      ['[STATUSES]', '', '', '', ''],
      ['Status', 'Kind', 'MinHours', 'Color', 'Announce'],
      ['Active', 'TIER', '10', '', 'FALSE'],
      ['Semi-Active', 'TIER', '5', '', 'FALSE'],
      ['Inactive', 'TIER', '0', '', 'FALSE'],
      ['LOA', 'LEAVE', '', '', 'FALSE'],
      ['', '', '', '', ''],
      ['[LEAVE]', '', '', '', ''],
    ]);
    sh.getRange(14, 1, 3, 5).setValues([
      ['LEAVE_TYPES', 'LOA', '', '', ''],
      ['RETURN_STATUS', '', '', '', ''], // explicit EMPTY — the default 'ROA' isn't a status on this mini sheet and would E-103 every validation
      ['', '', '', '', ''],
    ]);
    SpreadsheetApp.flush();
    return sh;
  };

  // --- MF-1 pin: an EXPLICITLY-EMPTY optional string stays empty ("EMPTY = disabled" contract);
  //     the default applies only when the key is ABSENT. Caught by the Settings-feature verification. ---
  (() => {
    const P = [];
    devEq_(R, 'coerce_: explicit empty optional string stays "" (MF-1)', coerce_('[LEAVE].RETURN_STATUS', '', { t: 'string', d: 'ROA', req: false }, P), '');
    devEq_(R, 'coerce_: empty optional string raises no problem', P.length, 0);
    const v = validateConfig_({ LEAVE: { kind: 'kv', kv: { RETURN_STATUS: '' } } });
    devEq_(R, 'validateConfig_: explicit blank RETURN_STATUS → zero ERRORs', v.problems.filter((p) => p.sev === 'ERROR').length, 0);
    devEq_(R, 'materialize_: blank RETURN_STATUS disables the returning status', materialize_(v.config, true).legacy.returnStatus, '');
    devEq_(R, 'validateConfig_: ABSENT RETURN_STATUS still defaults to ROA', validateConfig_({}).config.kv.LEAVE.RETURN_STATUS, 'ROA');
    const v2 = validateConfig_({ LEAVE: { kind: 'kv', kv: { APPROVED_STATUS: '' } } });
    devEq_(R, 'blank APPROVED_STATUS → zero ERRORs (legacy accessor falls back)', v2.problems.filter((p) => p.sev === 'ERROR').length, 0);
    devEq_(R, 'materialize_: blank APPROVED_STATUS falls back to "Approved"', materialize_(v2.config, true).legacy.approvedStatus, 'Approved');
  })();

  // --- cpGetConfig_ shape (read-only; uses the LIVE spreadsheet's config state) ---
  (() => {
    const d = cpGetConfig_();
    devCheck_(R, 'cpGetConfig_ returns blocks[]', Array.isArray(d.blocks) && d.blocks.length > 0);
    const names = d.blocks.map((b) => b.name);
    devCheck_(R, 'cpGetConfig_ exposes the kv blocks', ['SYSTEM', 'SHEETS', 'LEAVE', 'THEME'].every((n) => names.indexOf(n) !== -1), names.join(','));
    devCheck_(R, 'cpGetConfig_ exposes STATUSES + STATUS_OVERRIDES tables', names.indexOf('STATUSES') !== -1 && names.indexOf('STATUS_OVERRIDES') !== -1);
    const sys = d.blocks.filter((b) => b.name === 'SYSTEM')[0];
    devCheck_(R, 'cpGetConfig_ hides SCHEMA_VERSION (engine-managed)', sys.keys.every((k) => k.key !== 'SCHEMA_VERSION'), sys.keys.map((k) => k.key).join(','));
    const statuses = d.blocks.filter((b) => b.name === 'STATUSES')[0];
    devCheck_(R, 'cpGetConfig_ STATUSES rows padded to the 5 spec cols', statuses.rows.every((r) => r.length === 5));
    devCheck_(R, 'cpGetConfig_ reports problems[] (possibly empty)', Array.isArray(d.problems));
    devCheck_(R, 'cpGetConfig_ provides ranks[] for the override dropdowns', Array.isArray(d.ranks));
  })();

  // --- VALIDATE-BEFORE-WRITE: an invalid change set is refused, sheet untouched ---
  (() => {
    const sh = buildMiniConfig_();
    const res = cpApplyConfig_(sh, { kv: [{ block: 'LEAVE', key: 'APPROVED_STATUS', value: 'NotInFlow' }] });
    devEq_(R, 'invalid APPROVED_STATUS → ok:false (refused)', res.ok, false);
    devCheck_(R, 'refusal carries the E-103 problem naming the key', res.problems.some((p) => p.key === '[LEAVE].APPROVED_STATUS'), res.problems.map((p) => p.key).join(','));
    devEq_(R, 'refusal wrote NOTHING (sheet value unchanged)', String(sh.getRange(4, 2).getDisplayValue()), 'Member Information');
    devCheck_(R, 'refusal wrote NOTHING (no APPROVED_STATUS row added)', sh.getRange(1, 1, sh.getLastRow(), 1).getDisplayValues().every((r) => String(r[0]).trim() !== 'APPROVED_STATUS'));
  })();
  (() => {
    const sh = buildMiniConfig_();
    // two 0-hour tiers via the table path → E-110 → refused, original rows intact
    const res = cpApplyConfig_(sh, { tables: { STATUSES: [
      ['Active', 'TIER', '10', '', 'FALSE'], ['Idle', 'TIER', '0', '', 'FALSE'], ['Dormant', 'TIER', '0', '', 'FALSE'],
    ] } });
    devEq_(R, 'two 0-tiers → ok:false (E-110 refused)', res.ok, false);
    devCheck_(R, 'refusal problem is E-110', res.problems.some((p) => p.code === 'E-110'), res.problems.map((p) => p.code).join(','));
    devEq_(R, 'STATUSES rows untouched after refusal', String(sh.getRange(9, 1).getDisplayValue()), 'Semi-Active');
  })();

  // --- valid kv apply writes in place ---
  (() => {
    const sh = buildMiniConfig_();
    const res = cpApplyConfig_(sh, { kv: [{ block: 'SHEETS', key: 'ROSTER', value: 'Personnel' }] });
    devEq_(R, 'valid kv change → ok:true', res.ok, true);
    devEq_(R, 'valid kv change written to col B', String(sh.getRange(4, 2).getDisplayValue()), 'Personnel');
    devEq_(R, 'written summary counts 1 kv', res.written.kv, 1);
  })();

  // --- valid table apply: GROW the block (4 → 5 rows) without disturbing the next block ---
  (() => {
    const sh = buildMiniConfig_();
    const res = cpApplyConfig_(sh, { tables: { STATUSES: [
      ['Active', 'TIER', '10', '', 'FALSE'], ['Semi-Active', 'TIER', '5', '', 'FALSE'], ['Inactive', 'TIER', '0', '', 'FALSE'],
      ['LOA', 'LEAVE', '', '', 'FALSE'], ['Medical', 'LEAVE', '', '#4ea7d6', 'FALSE'],
    ] } });
    devEq_(R, 'table grow → ok:true', res.ok, true);
    devEq_(R, 'table grow: new row 5 written (Medical)', String(sh.getRange(12, 1).getDisplayValue()), 'Medical');
    devCheck_(R, 'table grow: blank separator restored before [LEAVE]', String(sh.getRange(13, 1).getDisplayValue()).trim() === '' && String(sh.getRange(14, 1).getDisplayValue()) === '[LEAVE]',
      `r13="${sh.getRange(13, 1).getDisplayValue()}" r14="${sh.getRange(14, 1).getDisplayValue()}"`);
    devEq_(R, 'table grow: [LEAVE] kv content intact', String(sh.getRange(15, 1).getDisplayValue()), 'LEAVE_TYPES');
  })();

  // --- valid table apply: SHRINK the block (4 → 2 TIER-only + LEAVE row config change together) ---
  (() => {
    const sh = buildMiniConfig_();
    const res = cpApplyConfig_(sh, {
      kv: [{ block: 'LEAVE', key: 'LEAVE_TYPES', value: 'Vacation' }],
      tables: { STATUSES: [
        ['Active', 'TIER', '10', '', 'FALSE'], ['Inactive', 'TIER', '0', '', 'FALSE'], ['Vacation', 'LEAVE', '', '', 'FALSE'],
      ] },
    });
    devEq_(R, 'shrink+kv combined apply → ok:true', res.ok, true);
    devEq_(R, 'shrink: row count reduced (row 10 = Vacation)', String(sh.getRange(10, 1).getDisplayValue()), 'Vacation');
    devCheck_(R, 'shrink: [LEAVE] block follows intact', String(sh.getRange(12, 1).getDisplayValue()) === '[LEAVE]' && String(sh.getRange(13, 2).getDisplayValue()) === 'Vacation',
      `r12="${sh.getRange(12, 1).getDisplayValue()}" r13B="${sh.getRange(13, 2).getDisplayValue()}"`);
  })();

  // --- SF-1: an override ladder naming a MISSING status is load-time-WARN but PANEL-SAVE-blocking ---
  (() => {
    const sh = buildMiniConfig_();
    const res = cpApplyConfig_(sh, { tables: { STATUS_OVERRIDES: [['RANK', 'Auxiliary Trooper', 'Ghost:5, Inactive:0']] } });
    devEq_(R, 'override ladder naming a missing status → refused on the panel path', res.ok, false);
    devCheck_(R, 'refusal names the [STATUS_OVERRIDES] problem', res.problems.some((p) => String(p.key).indexOf('[STATUS_OVERRIDES]') === 0), res.problems.map((p) => p.key).join(','));
  })();

  // --- SF-3: rows carrying non-empty data past the 5-col grid are refused, not silently truncated ---
  (() => {
    const sh = buildMiniConfig_();
    let threw = false;
    try { cpApplyConfig_(sh, { tables: { STATUSES: [['Active', 'TIER', '10', '', 'FALSE', 'OVERFLOW']] } }); } catch (e) { threw = true; }
    devCheck_(R, 'row with non-empty 6th column → throws (no silent truncation)', threw);
  })();

  // --- guardrails: unknown key / non-editable block / engine-managed key all throw ---
  (() => {
    const sh = buildMiniConfig_();
    let a = false; try { cpApplyConfig_(sh, { kv: [{ block: 'SHEETS', key: 'NOT_A_KEY', value: 'x' }] }); } catch (e) { a = true; }
    devCheck_(R, 'unknown key → throws', a);
    let b = false; try { cpApplyConfig_(sh, { kv: [{ block: 'COLUMNS', key: 'RANK', value: 'x' }] }); } catch (e) { b = true; }
    devCheck_(R, 'non-editable block → throws', b);
    let c = false; try { cpApplyConfig_(sh, { kv: [{ block: 'SYSTEM', key: 'SCHEMA_VERSION', value: '999' }] }); } catch (e) { c = true; }
    devCheck_(R, 'engine-managed SCHEMA_VERSION → throws', c);
    let d = false; try { cpApplyConfig_(sh, { tables: { FORM_MAP: [['NAME', 'Name']] } }); } catch (e) { d = true; }
    devCheck_(R, 'non-editable table → throws', d);
  })();

  // --- setTableRows_ primitive: empty rows + missing block ---
  (() => {
    const sh = buildMiniConfig_();
    const n = setTableRows_(sh, 'STATUSES', []);
    devEq_(R, 'setTableRows_ empty rows → 0 written', n, 0);
    devCheck_(R, 'setTableRows_ empty: header directly followed by the separator', String(sh.getRange(7, 1).getDisplayValue()) === 'Status' && String(sh.getRange(8, 1).getDisplayValue()).trim() === '',
      `r7="${sh.getRange(7, 1).getDisplayValue()}" r8="${sh.getRange(8, 1).getDisplayValue()}"`);
    let threw = false; try { setTableRows_(sh, 'DASHBOARD_CELLS', [['X', 'below', 'total']]); } catch (e) { threw = true; }
    devCheck_(R, 'setTableRows_ missing block → throws', threw);
    let bad = false; try { setTableRows_(sh, 'SHEETS', [['a']]); } catch (e) { bad = true; }
    devCheck_(R, 'setTableRows_ on a kv block → throws', bad);
  })();

  return R;
}

function devConfigTests_() {
  const R = devNewResults_('Config engine (sandbox)');

  // --- norm_ — trim, internal-whitespace collapse, case-fold, null-safety ---
  devEq_(R, 'norm_ trims + collapses + uppercases', norm_('  LOA/ROA Form  Response '), 'LOA/ROA FORM RESPONSE');
  devEq_(R, 'norm_ double-space equals single-space (the Form  Response bug class)', norm_('LOA/ROA Form  Response'), norm_('LOA/ROA Form Response'));
  devEq_(R, 'norm_ case-folds a rank', norm_('auxiliary Trooper'), 'AUXILIARY TROOPER');
  devEq_(R, 'norm_ null → ""', norm_(null), '');
  devEq_(R, 'norm_ undefined → ""', norm_(undefined), '');

  // --- THE BRIDGE — the Phase 1 shipping contract: every classic CONFIG.* read resolves through cfg_().legacy.
  // Runs against the LIVE config (real ⚙️ Config tab if present, else built-in defaults); the identity checks
  // (CONFIG.x === cfg_().legacy.x, CONFIG.bg.done === theme_('PASS')) pin the BRIDGE itself and hold under any
  // config edits; the value checks pin the shipped defaults. ---
  (() => {
    const v = cfg_();
    devCheck_(R, 'bridge: cfg_() loads and reports tab presence as a boolean', typeof v.fromTab === 'boolean');
    devEq_(R, 'bridge: CONFIG.rosterStartRow resolves through cfg_().legacy', CONFIG.rosterStartRow, v.legacy.rosterStartRow);
    devEq_(R, 'bridge: CONFIG.thresholds.active (default 10)', CONFIG.thresholds.active, 10);
    devEq_(R, 'bridge: ROSTER_HEADER_ROW resolves through the config layer', ROSTER_HEADER_ROW, v.legacy.headerRow);
    devEq_(R, 'bridge: CONFIG.bg.done is [THEME].PASS by construction', CONFIG.bg.done, theme_('PASS'));
    devEq_(R, 'bridge: CONFIG.sheets.roster matches the config layer', CONFIG.sheets.roster, v.legacy.sheets.roster);
  })();

  // --- computeStatusCore_ hard fallback: an empty ladder can never crash a status write ---
  devEq_(R, 'empty ladder → the Inactive hard fallback', computeStatusCore_('Trooper', 12, { global: [], overrides: [] }), 'Inactive');

  // --- validateConfig_({}) — empty raw = pure built-in defaults, zero errors ---
  (() => {
    const v = validateConfig_({});
    devEq_(R, 'defaults: zero ERROR problems', v.problems.filter((p) => p.sev === 'ERROR').length, 0);
    devEq_(R, 'defaults: 6 statuses seeded', v.config.statuses.length, 6);
    devEq_(R, 'defaults: 3 tiers', v.config.tiers.length, 3);
    devEq_(R, 'defaults: tier ladder desc = Active:10, Semi-Active:5, Inactive:0',
      v.config.tiers.map((t) => `${t.name}:${t.min}`).join(', '), 'Active:10, Semi-Active:5, Inactive:0');
    devEq_(R, 'defaults: 1 status override seeded', v.config.overrides.length, 1);
    devEq_(R, 'defaults: override is RANK-scoped', v.config.overrides[0].scope, 'RANK');
    devEq_(R, 'defaults: override match = Auxiliary Trooper', v.config.overrides[0].match, 'Auxiliary Trooper');
    devEq_(R, 'defaults: override ladder = Active:5, Inactive:0',
      v.config.overrides[0].ladder.map((t) => `${t.name}:${t.min}`).join(', '), 'Active:5, Inactive:0');
    devEq_(R, 'defaults: [SHEETS].ROSTER = "Member Information"', v.config.kv.SHEETS.ROSTER, 'Member Information');
    devEq_(R, 'defaults: [SCHEDULE].NIGHTLY_HOUR = 0 (typed int)', v.config.kv.SCHEDULE.NIGHTLY_HOUR, 0);
    devEq_(R, 'defaults: [LEAVE].RETURN_TYPE = "" (disabled)', v.config.kv.LEAVE.RETURN_TYPE, '');
  })();

  // --- bad-type coercion — ALL problems collected in ONE pass (aggregate, not fail-fast) ---
  (() => {
    const v = validateConfig_({
      SYSTEM: { kind: 'kv', kv: { MAINTENANCE_MODE: 'ture' } },
      ROSTER_LAYOUT: { kind: 'kv', kv: { HEADER_ROW: 'abc' } },
      THEME: { kind: 'kv', kv: { ACCENT: 'blue' } },
    });
    const e103 = v.problems.filter((p) => p.sev === 'ERROR' && p.code === 'E-103');
    const keys = e103.map((p) => p.key);
    devCheck_(R, 'bad types: E-103 for [SYSTEM].MAINTENANCE_MODE "ture"', keys.indexOf('[SYSTEM].MAINTENANCE_MODE') !== -1, keys.join(' · '));
    devCheck_(R, 'bad types: E-103 for [ROSTER_LAYOUT].HEADER_ROW "abc"', keys.indexOf('[ROSTER_LAYOUT].HEADER_ROW') !== -1, keys.join(' · '));
    devCheck_(R, 'bad types: E-103 for [THEME].ACCENT "blue"', keys.indexOf('[THEME].ACCENT') !== -1, keys.join(' · '));
    devCheck_(R, 'bad types: all 3 collected in one pass (aggregate)', e103.length >= 3, `${e103.length} E-103 error(s)`);
    devEq_(R, 'bad types: MAINTENANCE_MODE falls back to default false', v.config.kv.SYSTEM.MAINTENANCE_MODE, false);
    devEq_(R, 'bad types: HEADER_ROW falls back to default 5', v.config.kv.ROSTER_LAYOUT.HEADER_ROW, 5);
    devEq_(R, 'bad types: ACCENT falls back to default #3f86e6', v.config.kv.THEME.ACCENT, '#3f86e6');
  })();

  // --- E-110 — tier-ladder semantics ---
  (() => {
    const v = validateConfig_({ STATUSES: { kind: 'table', header: ['Status', 'Kind', 'MinHours', 'Color', 'Announce'], rows: [
      ['Active', 'TIER', '10', '', ''], ['Inactive', 'TIER', '0', '', ''], ['Dormant', 'TIER', '0', '', ''],
    ] } });
    devCheck_(R, 'E-110: two 0-tiers in [STATUSES] → ERROR E-110',
      v.problems.some((p) => p.sev === 'ERROR' && p.code === 'E-110' && p.key === '[STATUSES]'),
      v.problems.filter((p) => p.code === 'E-110').map((p) => p.reason).join(' · '));
  })();
  (() => {
    const v = validateConfig_({ STATUS_OVERRIDES: { kind: 'table', header: ['Scope', 'Match', 'Ladder'], rows: [
      ['RANK', 'Auxiliary Trooper', 'Active:5, Inactive:1'],
    ] } });
    devCheck_(R, 'E-110: override ladder with no 0 floor → ERROR E-110',
      v.problems.some((p) => p.sev === 'ERROR' && p.code === 'E-110' && p.key === '[STATUS_OVERRIDES].Auxiliary Trooper'),
      v.problems.filter((p) => p.code === 'E-110').map((p) => p.reason).join(' · '));
  })();

  // --- E-104 — sheet schema newer than the engine ---
  (() => {
    const v = validateConfig_({ SYSTEM: { kind: 'kv', kv: { SCHEMA_VERSION: '999' } } });
    devCheck_(R, 'E-104: SCHEMA_VERSION 999 > engine → ERROR E-104',
      v.problems.some((p) => p.sev === 'ERROR' && p.code === 'E-104'),
      v.problems.map((p) => p.code).join(' · '));
  })();

  // --- parseLadder_ — parse + desc sort; malformed → null ---
  (() => {
    const lad = parseLadder_('Inactive:0, Active:5');
    devEq_(R, 'parseLadder_ parses 2 entries', lad ? lad.length : -1, 2);
    devEq_(R, 'parseLadder_ sorts desc: [0] = Active:5', lad ? `${lad[0].name}:${lad[0].min}` : '', 'Active:5');
    devEq_(R, 'parseLadder_ sorts desc: [1] = Inactive:0', lad ? `${lad[1].name}:${lad[1].min}` : '', 'Inactive:0');
    devCheck_(R, 'parseLadder_ malformed "Active-5" → null', parseLadder_('Active-5') === null);
  })();

  // --- computeStatusCore_ — pure, with an INJECTED engine (no sheets) ---
  (() => {
    const auxLadder = [{ name: 'Active', min: 5 }, { name: 'Inactive', min: 0 }];
    const engine = {
      global: [{ name: 'Active', min: 10 }, { name: 'Semi-Active', min: 5 }, { name: 'Inactive', min: 0 }],
      overrides: [{ scope: 'RANK', match: 'Auxiliary Trooper', ladder: auxLadder }],
    };
    devEq_(R, 'core: Trooper 10 → Active', computeStatusCore_('Trooper', 10, engine), 'Active');
    devEq_(R, 'core: Trooper 9.99 → Semi-Active', computeStatusCore_('Trooper', 9.99, engine), 'Semi-Active');
    devEq_(R, 'core: Trooper 4.99 → Inactive', computeStatusCore_('Trooper', 4.99, engine), 'Inactive');
    devEq_(R, 'core: Aux 5 → Active (override ladder)', computeStatusCore_('Auxiliary Trooper', 5, engine), 'Active');
    devEq_(R, 'core: Aux 4.99 → Inactive (no Semi band)', computeStatusCore_('Auxiliary Trooper', 4.99, engine), 'Inactive');
    // Part H gate: remove the override → the SAME rank follows the global ladder
    const engineNoOverrides = { global: engine.global, overrides: [] };
    devEq_(R, 'core (Part H gate): Aux 5 with overrides:[] → Semi-Active (global ladder)', computeStatusCore_('Auxiliary Trooper', 5, engineNoOverrides), 'Semi-Active');
    // statusLadderFor_ rank match is norm_-based (trim + collapse + case-fold)
    devCheck_(R, 'statusLadderFor_ "  auxiliary trooper  " matches the override (norm_-based)', statusLadderFor_('  auxiliary trooper  ', engine) === auxLadder);
    devCheck_(R, 'statusLadderFor_ unmatched rank falls back to the global ladder', statusLadderFor_('Trooper', engine) === engine.global);
  })();

  // --- parseBlocks_ — against a SANDBOX mini-config sheet (injectable) ---
  (() => {
    const sh = devFreshSheet_('ConfigParse');
    sh.getRange(1, 1, 8, 5).setValues([
      ['[STATUSES]', '', '', '', ''],                              // table block
      ['Status', 'Kind', 'MinHours', 'Color', 'Announce'],
      ['Active', 'TIER', '10', '#57b85a', 'FALSE'],
      ['Inactive', 'TIER', '0', '#e0574f', 'FALSE'],
      ['', '', '', '', ''],                                        // blank row ends the block
      ['[SHEETS]', '', '', '', ''],                                // second block (kv)
      ['ROSTER', 'Member Information', '', '', ''],
      ['Form  Responses', 'LOA/ROA Form Response', '', '', ''],    // double-spaced key name
    ]);
    SpreadsheetApp.flush();
    const b = parseBlocks_(sh);
    devEq_(R, 'parseBlocks_ [STATUSES] parsed as a table', b.STATUSES ? b.STATUSES.kind : '(missing)', 'table');
    devEq_(R, 'parseBlocks_ table header captured', b.STATUSES ? b.STATUSES.header.slice(0, 5).join('|') : '', 'Status|Kind|MinHours|Color|Announce');
    devEq_(R, 'parseBlocks_ table stops at the blank row (2 rows, not 5)', b.STATUSES ? b.STATUSES.rows.length : -1, 2);
    devEq_(R, 'parseBlocks_ table row values land intact', b.STATUSES ? b.STATUSES.rows[0][0] : '', 'Active');
    devEq_(R, 'parseBlocks_ [SHEETS] parsed as kv (block separation at the blank row)', b.SHEETS ? b.SHEETS.kind : '(missing)', 'kv');
    devEq_(R, 'parseBlocks_ kv value captured', b.SHEETS ? b.SHEETS.kv.ROSTER : '', 'Member Information');
    devEq_(R, 'parseBlocks_ double-spaced key name normalized → FORM_RESPONSES', b.SHEETS ? b.SHEETS.kv.FORM_RESPONSES : '', 'LOA/ROA Form Response');
  })();

  // --- setColumnClassRow_ — against a SANDBOX mini-config sheet (injectable) ---
  (() => {
    const sh = devFreshSheet_('ConfigCols');
    sh.getRange(1, 1, 7, 4).setValues([
      ['RE_CONFIG', '', '', ''],
      ['', '', '', ''],
      ['[COLUMNS]', '', '', ''],
      ['Role', 'Match', 'Class', 'Required'],
      ['RANK', 'RANK', 'SLOT', 'TRUE'],
      ['', 'COMMUNITY ID', 'MEMBER', ''],
      ['', '', '', ''],
    ]);
    SpreadsheetApp.flush();
    devEq_(R, 'setColumnClassRow_ returns the class written', setColumnClassRow_(sh, 'COMMUNITY ID', 'SLOT'), 'SLOT');
    devEq_(R, 'setColumnClassRow_ updates the existing class row in place', String(sh.getRange(6, 3).getDisplayValue()), 'SLOT');
    setColumnClassRow_(sh, 'STEAM ID', 'MEMBER');
    devEq_(R, 'setColumnClassRow_ appends a blank-Role row inside the block', String(sh.getRange(7, 2).getDisplayValue()), 'STEAM ID');
    devEq_(R, 'setColumnClassRow_ appended class cell = MEMBER', String(sh.getRange(7, 3).getDisplayValue()), 'MEMBER');
    let bogus = false; try { setColumnClassRow_(sh, 'X', 'WEIRD'); } catch (e) { bogus = true; }
    devCheck_(R, 'setColumnClassRow_ rejects a class outside SLOT|MEMBER', bogus);
    let empty = false; try { setColumnClassRow_(sh, '   ', 'SLOT'); } catch (e) { empty = true; }
    devCheck_(R, 'setColumnClassRow_ rejects an empty header', empty);
    const noBlock = devFreshSheet_('ConfigNoCols');
    noBlock.getRange(1, 1).setValue('RE_CONFIG'); // marker but NO [COLUMNS] block
    let missing = false; try { setColumnClassRow_(noBlock, 'STEAM ID', 'SLOT'); } catch (e) { missing = true; }
    devCheck_(R, 'setColumnClassRow_ throws when the sheet has no [COLUMNS] block', missing);
  })();

  // --- theme_ — memo/defaults lookup, never throws ---
  devCheck_(R, 'theme_("BANNER") is a #rrggbb color', /^#[0-9a-fA-F]{6}$/.test(theme_('BANNER')), theme_('BANNER'));
  devEq_(R, 'theme_ unknown key → "#000000" fallback', theme_('NO_SUCH_KEY'), '#000000');

  // --- error registry — templated messages, hints, severity ---
  (() => {
    const ae = new AppError('E-201', { name: 'X', role: 'ROSTER', closest: 'Y' });
    devCheck_(R, 'AppError E-201 message contains the tab name', ae.message.indexOf('X') !== -1, ae.message);
    devCheck_(R, 'AppError E-201 message contains the role', ae.message.indexOf('ROSTER') !== -1, ae.message);
    devCheck_(R, 'AppError E-201 hint names the closest live tab', ae.hint.indexOf('Y') !== -1, ae.hint);
    devEq_(R, 'AppError E-201 severity = ERROR', ae.sev, 'ERROR');
    devEq_(R, 'AppError code preserved', ae.code, 'E-201');
    devCheck_(R, 'renderMsg_ missing param renders as "?" (bad call still surfaces)', renderMsg_('E-201', {}).indexOf('?') !== -1, renderMsg_('E-201', {}));
    const wrapped = wrapUnexpected_('devFakeFn', new Error('kaboom'));
    devEq_(R, 'wrapUnexpected_ → code E-601', wrapped.code, 'E-601');
    devCheck_(R, 'wrapUnexpected_ message names the wrapped fn', wrapped.message.indexOf('devFakeFn') !== -1, wrapped.message);
    devCheck_(R, 'wrapUnexpected_ message carries the original error', wrapped.message.indexOf('kaboom') !== -1, wrapped.message);
  })();

  // --- guarded_ — swallow-and-log entry guard ---
  (() => {
    devEq_(R, 'guarded_ passes the return value through', guarded_('t', () => 42), 42);
    let rethrew = false; let out = 'sentinel';
    try { out = guarded_('t', () => { throw new Error('boom'); }); } catch (e) { rethrew = true; }
    devCheck_(R, 'guarded_ swallows a thrown error (never rethrows)', !rethrew);
    devCheck_(R, 'guarded_ returns undefined on error', out === undefined);
  })();

  return R;
}

/* ======================================================================
 * GROUP 13 — DISPATCH & MIGRATIONS (RosterControlPanel.gs: dispatch /
 * DISPATCH_ENDPOINTS_ · RosterConfig.gs: setKvValue_ / MIGRATIONS_)
 * dispatch() is exercised ONLY via the pure E-506 reject path and cpPing
 * (constants-only — no sheet, no properties, no network). setKvValue_ runs
 * against a SANDBOX mini-config sheet. migrateConfig_/seedConfigTab_/
 * cpSetWebhook/cpTestWebhook are deliberately NEVER called here — they write
 * the real ⚙️ Config tab / Script Properties / Discord.
 * ====================================================================== */
function devConfigDispatchTests_() {
  const R = devNewResults_('Dispatch & migrations (sandbox)');

  // --- E-506 (Part H gate): an unknown endpoint is rejected BEFORE anything runs ---
  (() => {
    let err = null;
    try { dispatch('definitelyNotAnEndpoint'); } catch (e) { err = e; }
    devCheck_(R, 'E-506: dispatch("definitelyNotAnEndpoint") throws', err !== null);
    // dispatch folds the code + hint into the MESSAGE so they survive google.script.run serialization (F-017).
    devCheck_(R, 'E-506: thrown message carries the E-506 code', !!err && String(err.message).indexOf('E-506') !== -1, err && err.message);
    devCheck_(R, 'E-506: message names the bogus endpoint', !!err && String(err.message).indexOf('definitelyNotAnEndpoint') !== -1, err && err.message);
    devCheck_(R, 'E-506: message includes the fix hint', !!err && String(err.message).indexOf('Fix:') !== -1, err && err.message);
  })();

  // --- argument passthrough — cpPing is the one constants-only endpoint, safe to invoke ---
  (() => {
    const r = dispatch('cpPing', []);
    devCheck_(R, 'dispatch("cpPing", []) → { ok: true }', !!r && r.ok === true, devShow_(r));
    devCheck_(R, 'cpPing result carries a version', !!r && !!r.version, r && r.version);
    devCheck_(R, 'cpPing result carries the engine version', !!r && !!r.engine, r && r.engine);
    devCheck_(R, 'cpPing result carries the schema number', !!r && r.schema != null, r && r.schema);
    const r2 = dispatch('cpPing'); // args undefined — dispatch defaults to []
    devCheck_(R, 'dispatch("cpPing") with args undefined defaults to [] and still pings', !!r2 && r2.ok === true, devShow_(r2));
  })();

  // --- whitelist contract — EXACTLY these 33 endpoints. This is also the shim-parity
  // contract: TEMPLATE-SHIM.gs mirrors this list; a drift here means a drift there. ---
  (() => {
    const expected = [
      'cpPing', 'cpBootstrap', 'cpRefresh', 'cpGetProfile', 'cpSetStatus',
      'cpSetStatusBulk', 'cpScheduleLeave', 'cpAssignMember', 'cpMoveMember', 'cpRunAction', 'cpJumpTo',
      'cpSystemInfo', 'cpColumnsInfo', 'cpSetColumnClass', 'cpDividersInfo', 'cpFixTriggers',
      'cpTakeSnapshot', 'cpRestoreSnapshot', 'cpSetSnapshotAuto', 'cpSetWebhook', 'cpTestWebhook',
      'cpGetConfig', 'cpApplyConfig', 'cpOpenSettings',
      'cpRankIcons', 'cpSetRankIcon', 'cpDeleteRankIcon',
      'cpSetDividerStyle', 'cpDeleteDividerStyle',
      'cpAdminSetup', 'cpAdminInfo', 'cpAdminSave', 'cpAddDiscipline',
    ];
    const actual = Object.keys(DISPATCH_ENDPOINTS_);
    devEq_(R, 'whitelist: exactly 33 endpoints (shim parity)', actual.length, expected.length);
    expected.forEach((name) => {
      devCheck_(R, `whitelist: ${name} present`, Object.prototype.hasOwnProperty.call(DISPATCH_ENDPOINTS_, name));
    });
    const nonFns = actual.filter((k) => typeof DISPATCH_ENDPOINTS_[k] !== 'function');
    devCheck_(R, 'whitelist: every endpoint value is a function', nonFns.length === 0, nonFns.join(' · ') || 'all functions');
  })();

  // --- rank icons: input validation rejects bad icons BEFORE any sheet write (each case throws pre-write, so nothing is created) ---
  (() => {
    const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
    devCheck_(R, 'cpSetRankIcon: empty rank rejected (pre-write)', throws(() => cpSetRankIcon('', 'data:image/png;base64,AAAA')));
    devCheck_(R, 'cpSetRankIcon: non-image URI rejected (pre-write)', throws(() => cpSetRankIcon('QA-Rank', 'https://example.com/x.png')));
    devCheck_(R, 'cpSetRankIcon: URL-encoded SVG (non-base64) rejected (pre-write)', throws(() => cpSetRankIcon('QA-Rank', 'data:image/svg+xml,<svg/>')));
    devCheck_(R, 'cpSetRankIcon: oversize icon rejected (pre-write)', throws(() => cpSetRankIcon('QA-Rank', 'data:image/png;base64,' + new Array(RANK_ICON_MAX_LEN_ + 10).join('A'))));
    // NB: not calling rankIconsMap_() here — it now runs the legacy-tab migration (a write), which a read-only test must not trigger.
  })();

  // --- v1.4.0 admin roster — injectable cores against SANDBOX tabs (the read-only status probe below may touch the linked file); ID precision + upsert + append-only log ---
  (() => {
    const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
    const details = devFreshSheet_('AdmDetails');
    details.getRange(1, 1, 1, 6).setValues([['Discord ID', 'Name', 'Email', 'Date of Birth', 'Notes', 'Phone']]); // Phone = an admin-added column
    const logSh = devFreshSheet_('AdmLog');
    logSh.getRange(1, 1, 1, 7).setValues([['Date', 'Discord ID', 'Name', 'Action', 'Reason', 'Issued By', 'Status']]);
    // field discovery: the header row IS the schema (cols 3+ in sheet order)
    devEq_(R, 'admin fields: header row discovered (Email·DOB·Notes·Phone)', adminFieldCols_(details).map(function (f) { return f.label; }).join('|'), 'Email|Date of Birth|Notes|Phone');
    // upsert: insert, then update the SAME row (no duplicates), ID round-trips exactly; custom column writes like a built-in
    cpAdminUpsert_(details, { discordId: devId_(1), name: 'A. One', fields: { 'Email': 'a@ex.com', 'Date of Birth': '1999-01-02', 'Notes': 'n1', 'Phone': '555-0142' } });
    devEq_(R, 'admin upsert: inserted at row 2', adminDetailsRow_(details, devId_(1)), 2);
    devEq_(R, 'admin upsert: 18-digit ID round-trips exactly (text)', details.getRange(2, 1).getDisplayValue(), devId_(1));
    devEq_(R, 'admin upsert: custom Phone column written', details.getRange(2, 6).getDisplayValue(), '555-0142');
    cpAdminUpsert_(details, { discordId: devId_(1), name: 'A. One', fields: { 'Email': 'new@ex.com' } });
    devEq_(R, 'admin upsert: same ID updates in place (no duplicate row)', details.getLastRow(), 2);
    devEq_(R, 'admin upsert: email updated', details.getRange(2, 3).getDisplayValue(), 'new@ex.com');
    devEq_(R, 'admin upsert: untouched fields preserved (Phone survives an Email-only save)', details.getRange(2, 6).getDisplayValue(), '555-0142');
    const ig = cpAdminUpsert_(details, { discordId: devId_(1), name: 'A. One', fields: { 'Bogus Field': 'x' } });
    devEq_(R, 'admin upsert: unknown label ignored (never creates a column)', details.getLastColumn(), 6);
    devEq_(R, 'admin upsert: unknown label REPORTED as ignored', ig.ignored.join('|'), 'Bogus Field');
    devEq_(R, 'admin upsert: unknown label wrote 0 fields', ig.written, 0);
    // email classification is WHOLE-label — 'Voicemail'/'Email Preferences' are free text
    devCheck_(R, 'adminIsEmailLabel_: Email / E-Mail Address are email fields', adminIsEmailLabel_('Email') && adminIsEmailLabel_('E-Mail Address'));
    devCheck_(R, 'adminIsEmailLabel_: Voicemail / Email Preferences are NOT', !adminIsEmailLabel_('Voicemail') && !adminIsEmailLabel_('Email Preferences'));
    devCheck_(R, 'admin upsert: malformed ID rejected (pre-write)', throws(() => cpAdminUpsert_(details, { discordId: '123', fields: { 'Email': 'x@y.z' } })));
    devCheck_(R, 'admin upsert: bad email rejected (pre-write)', throws(() => cpAdminUpsert_(details, { discordId: devId_(2), fields: { 'Email': 'not-an-email' } })));
    devCheck_(R, 'admin upsert: overlong email rejected, not truncated (pre-write)', throws(() => cpAdminUpsert_(details, { discordId: devId_(2), fields: { 'Email': new Array(200).join('a') + '@ex.com' } })));
    devEq_(R, 'admin upsert: rejects wrote nothing (still 1 data row)', details.getLastRow(), 2);
    // formula-injection guard: a value starting '=' must land as literal TEXT, never a live formula — incl. a CUSTOM field
    cpAdminUpsert_(details, { discordId: devId_(3), name: 'Inj', fields: { 'Notes': '=2+2', 'Phone': '=HYPERLINK("http://x","y")' } });
    devEq_(R, 'admin upsert: "=2+2" note stays literal text', details.getRange(3, 5).getDisplayValue(), '=2+2');
    devEq_(R, 'admin upsert: no live formula in the notes cell', details.getRange(3, 5).getFormula(), '');
    devEq_(R, 'admin upsert: custom-field "=…" also stays literal (no formula)', details.getRange(3, 6).getFormula(), '');
    // 17- and 19-digit ID bounds round-trip exactly
    const id17 = '12345678901234567', id19 = '1234567890123456789';
    cpAdminUpsert_(details, { discordId: id17 });
    cpAdminUpsert_(details, { discordId: id19 });
    devEq_(R, 'admin upsert: 17-digit ID exact', details.getRange(adminDetailsRow_(details, id17), 1).getDisplayValue(), id17);
    devEq_(R, 'admin upsert: 19-digit ID exact', details.getRange(adminDetailsRow_(details, id19), 1).getDisplayValue(), id19);
    // DUPLICATE header labels: only the FIRST column is surfaced/written — the sibling column's data can never be clobbered
    details.getRange(1, 7).setValue('Notes'); // a second 'Notes' column (col 7)
    details.getRange(2, 7).setValue('sibling data');
    devEq_(R, 'admin fields: duplicate label deduped (first Notes col only)', adminFieldCols_(details).filter(function (f) { return f.label === 'Notes'; }).length, 1);
    cpAdminUpsert_(details, { discordId: devId_(1), fields: { 'Notes': 'edited' } });
    devEq_(R, 'admin upsert: duplicate-label save writes the FIRST column', details.getRange(2, 5).getDisplayValue(), 'edited');
    devEq_(R, 'admin upsert: the sibling duplicate column is untouched', details.getRange(2, 7).getDisplayValue(), 'sibling data');
    // discipline log: append-only, ID exact, action required
    cpAppendDiscipline_(logSh, { discordId: devId_(1), name: 'A. One', action: 'Warning', reason: 'test', issuedBy: 'qa@ex.com' });
    cpAppendDiscipline_(logSh, { discordId: devId_(1), name: 'A. One', action: 'Suspension', reason: 'later', issuedBy: 'qa@ex.com' });
    devEq_(R, 'discipline: two entries appended', logSh.getLastRow(), 3);
    devEq_(R, 'discipline: ID round-trips exactly (text)', logSh.getRange(2, 2).getDisplayValue(), devId_(1));
    devCheck_(R, 'discipline: missing action rejected (pre-write)', throws(() => cpAppendDiscipline_(logSh, { discordId: devId_(1), action: '' })));
    cpAppendDiscipline_(logSh, { discordId: devId_(1), name: 'A. One', action: 'Note', reason: '=IMPORTRANGE("x","A1")', issuedBy: 'qa@ex.com' });
    devEq_(R, 'discipline: "=…" reason stays literal text (no live formula)', logSh.getRange(4, 5).getFormula(), '');
    // read: merges details + history newest-first; the cap limits the batch; unknown ID → blank fields
    const fv = (info, lab) => { const f = (info.fields || []).filter((x) => x.label === lab)[0]; return f ? f.value : null; };
    const info = cpAdminRead_(details, logSh, devId_(1));
    devEq_(R, 'admin read: email field from details', fv(info, 'Email'), 'new@ex.com');
    devEq_(R, 'admin read: custom Phone field returned', fv(info, 'Phone'), '555-0142');
    devEq_(R, 'admin read: 3 discipline entries', info.discipline.length, 3);
    devEq_(R, 'admin read: newest entry first', info.discipline[0].action, 'Note');
    devEq_(R, 'admin read: cap=2 returns only the 2 newest', cpAdminRead_(details, logSh, devId_(1), 2).discipline.length, 2);
    const none = cpAdminRead_(details, logSh, devId_(9));
    devCheck_(R, 'admin read: unknown ID → blank fields + empty history', fv(none, 'Email') === '' && fv(none, 'Phone') === '' && none.discipline.length === 0);
    // status probe shape only (must not depend on whether the live doc has a file linked)
    const st = cpAdminStatus_();
    devCheck_(R, 'cpAdminStatus_ returns {linked,access} booleans + url string', typeof st.linked === 'boolean' && typeof st.access === 'boolean' && typeof st.url === 'string');
    // adminIdFromUrl_ — pure URL/ID parser
    const FID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345678901234';
    devEq_(R, 'adminIdFromUrl_ extracts the /d/ segment', adminIdFromUrl_('https://docs.google.com/spreadsheets/d/' + FID + '/edit#gid=0'), FID);
    devEq_(R, 'adminIdFromUrl_ accepts a bare ID', adminIdFromUrl_(FID), FID);
    devEq_(R, 'adminIdFromUrl_ ignores long query tokens (prefers /d/)', adminIdFromUrl_('https://docs.google.com/spreadsheets/d/' + FID + '/edit?usp=sharing_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456'), FID);
    devCheck_(R, 'adminIdFromUrl_ rejects a published-to-web /d/e/ link', throws(() => adminIdFromUrl_('https://docs.google.com/spreadsheets/d/e/2PACX-abcdefghijklmnopqrstuvwxyz/pubhtml')));
    devCheck_(R, 'adminIdFromUrl_ rejects garbage', throws(() => adminIdFromUrl_('not a link')));
  })();

  // --- setKvValue_ — against a SANDBOX mini-config sheet (injectable; never the real ⚙️ Config) ---
  (() => {
    const sh = devFreshSheet_('ConfigKv');
    sh.getRange(1, 1, 9, 3).setValues([
      ['RE_CONFIG', '', ''],                                // marker row
      ['', '', ''],
      ['[SHEETS]', '', ''],                                 // block under test (2 kv rows)
      ['ROSTER', 'Member Information', ''],
      ['FORM_RESPONSES', 'LOA/ROA Form Response', ''],
      ['', '', ''],                                         // blank separator ends the block
      ['[SYSTEM]', '', ''],                                 // second block — must not be disturbed
      ['TIMEZONE', 'America/New_York', ''],
      ['', '', ''],
    ]);
    SpreadsheetApp.flush();

    // update an existing key in place — col B changes, nothing moves
    devCheck_(R, 'setKvValue_ updates an existing key → true', setKvValue_(sh, 'SHEETS', 'ROSTER', 'Roster v2') === true);
    devEq_(R, 'setKvValue_ existing key: col B updated in place', String(sh.getRange(4, 2).getDisplayValue()), 'Roster v2');
    devEq_(R, 'setKvValue_ existing key: no row inserted ([SYSTEM] still at row 7)', String(sh.getRange(7, 1).getDisplayValue()), '[SYSTEM]');

    // key matching is norm_-based: trim + whitespace-collapse + case-fold (spaces ≡ underscores)
    devCheck_(R, 'setKvValue_ "form  responses" matches FORM_RESPONSES (norm_-based) → true', setKvValue_(sh, 'SHEETS', 'form  responses', 'Renamed Responses') === true);
    devEq_(R, 'setKvValue_ case/space-insensitive match updated in place (no duplicate row)', String(sh.getRange(5, 2).getDisplayValue()), 'Renamed Responses');
    devEq_(R, 'setKvValue_ after fuzzy update [SYSTEM] still at row 7', String(sh.getRange(7, 1).getDisplayValue()), '[SYSTEM]');

    // insert a missing key at the END of the block — before the blank separator
    devCheck_(R, 'setKvValue_ inserts a missing key → true', setKvValue_(sh, 'SHEETS', 'PANEL_TITLE', 'Command Console') === true);
    devEq_(R, 'setKvValue_ new key lands at the end of the block (row 6)', String(sh.getRange(6, 1).getDisplayValue()), 'PANEL_TITLE');
    devEq_(R, 'setKvValue_ new key value written to col B', String(sh.getRange(6, 2).getDisplayValue()), 'Command Console');
    devCheck_(R, 'setKvValue_ blank separator still directly precedes the next marker', String(sh.getRange(7, 1).getDisplayValue()).trim() === '' && String(sh.getRange(8, 1).getDisplayValue()) === '[SYSTEM]',
      `row7="${sh.getRange(7, 1).getDisplayValue()}" row8="${sh.getRange(8, 1).getDisplayValue()}"`);
    devEq_(R, 'setKvValue_ next block content intact (TIMEZONE follows [SYSTEM])', String(sh.getRange(9, 1).getDisplayValue()), 'TIMEZONE');

    // missing block — returns false, writes nothing
    devCheck_(R, 'setKvValue_ missing block → false', setKvValue_(sh, 'NO_SUCH_BLOCK', 'KEY', 'value') === false);
  })();

  // --- MIGRATIONS_ shape + ENGINE_SCHEMA — read-only structural checks (migrateConfig_ is NEVER run) ---
  (() => {
    devCheck_(R, 'MIGRATIONS_ is a plain object', MIGRATIONS_ !== null && typeof MIGRATIONS_ === 'object' && !Array.isArray(MIGRATIONS_));
    const badSteps = Object.keys(MIGRATIONS_).filter((k) => typeof MIGRATIONS_[k] !== 'function');
    devCheck_(R, 'MIGRATIONS_ values (if any) are all functions', badSteps.length === 0, badSteps.join(' · ') || `${Object.keys(MIGRATIONS_).length} step(s)`);
    devCheck_(R, 'ENGINE_SCHEMA is a positive integer', typeof ENGINE_SCHEMA === 'number' && Number.isInteger(ENGINE_SCHEMA) && ENGINE_SCHEMA >= 1, String(ENGINE_SCHEMA));
  })();

  // --- Phase 3: errors channel + docs links — failure-proof contracts (no property set → total no-op) ---
  (() => {
    // maybeErrorWebhook_ must NEVER throw. With WEBHOOK_ERRORS unset it returns before any fetch/cache work;
    // non-ERROR severities and null input return immediately regardless.
    let threw = false;
    try {
      maybeErrorWebhook_(null, 'test');
      maybeErrorWebhook_(new AppError('E-501', {}), 'test');                         // INFO — filtered by severity
      if (!getErrorsWebhookUrl_()) maybeErrorWebhook_(new AppError('E-601', { fn: 't', msg: 'x' }), 'test'); // ERROR, but property unset → no-op
    } catch (e) { threw = true; }
    devCheck_(R, 'maybeErrorWebhook_ is failure-proof (never throws)', !threw);
    devCheck_(R, 'getErrorsWebhookUrl_ returns a string', typeof getErrorsWebhookUrl_() === 'string');
    // docsLink_ contract: empty DOCS_URL → empty string; set → lowercase code anchor.
    if (DOCS_URL === '') devEq_(R, 'docsLink_ with DOCS_URL unset → ""', docsLink_('E-201'), '');
    else devCheck_(R, 'docsLink_ builds a lowercase anchor', docsLink_('E-201').indexOf('#e-201') !== -1, docsLink_('E-201'));
    devEq_(R, 'ENGINE_VERSION is the v2.5.0 release tag', ENGINE_VERSION, 'v2.5.0');
    devEq_(R, 'ENGINE_SCHEMA is 2 (v2.5.0)', ENGINE_SCHEMA, 2);
  })();

  return R;
}

/* ======================================================================
 * GROUP 19 — v2.5.0 CONFIG EXTENSIONS
 * Config-driven system-tab names + collision guard, the STATELESS status-rules
 * matrix (fixed-point + idempotency + cycle safety), EXPLICIT_LIST ranks, and
 * reset-cadence resolution. Pure/injected: validateConfig_/materialize_/
 * applyStatusRules_ are pure; devWithConfig_ injects a synthetic config so the
 * live ⚙️ Config tab is never touched, and the LAST_RESET marker is never mutated.
 * ====================================================================== */
function devV25Tests_() {
  const R = devNewResults_('v2.5.0 config extensions (sandbox)');

  // ---------- A) statusOpMatch_ + applyStatusRules_ (pure evaluator) ----------
  devEq_(R, 'statusOpMatch_ <', statusOpMatch_('<', 1, 2), true);
  devEq_(R, 'statusOpMatch_ <= at boundary', statusOpMatch_('<=', 2, 2), true);
  devEq_(R, 'statusOpMatch_ > false at boundary', statusOpMatch_('>', 2, 2), false);
  devEq_(R, 'statusOpMatch_ >= at boundary', statusOpMatch_('>=', 2, 2), true);
  devEq_(R, 'statusOpMatch_ ==', statusOpMatch_('==', 2, 2), true);
  devEq_(R, 'statusOpMatch_ * always true', statusOpMatch_('*', 0, 999), true);
  devEq_(R, 'statusOpMatch_ unknown op → false', statusOpMatch_('!!', 1, 2), false);

  const chain = [
    { source: 'ACTIVE', op: '<', hours: 2, target: 'Probation' },
    { source: 'PROBATION', op: '<', hours: 2, target: 'Inactive' },
  ];
  devEq_(R, 'applyStatusRules_ empty rules → unchanged', applyStatusRules_('Active', 1, []), 'Active');
  devEq_(R, 'applyStatusRules_ null rules → unchanged', applyStatusRules_('Active', 1, null), 'Active');
  devEq_(R, 'applyStatusRules_ fixed-point Active→Probation→Inactive at <2h', applyStatusRules_('Active', 1, chain), 'Inactive');
  devEq_(R, 'applyStatusRules_ IDEMPOTENT (apply twice = once)', applyStatusRules_(applyStatusRules_('Active', 1, chain), 1, chain), 'Inactive');
  devEq_(R, 'applyStatusRules_ no rule matches at 5h → unchanged', applyStatusRules_('Active', 5, chain), 'Active');
  devEq_(R, 'applyStatusRules_ mid-chain seed Probation → Inactive', applyStatusRules_('Probation', 1, chain), 'Inactive');
  devEq_(R, 'applyStatusRules_ wildcard source reroutes any status', applyStatusRules_('Whatever', 30, [{ source: '*', op: '>=', hours: 20, target: 'Elite' }]), 'Elite');
  devEq_(R, 'applyStatusRules_ self-target rule is a no-op', applyStatusRules_('Active', 1, [{ source: 'ACTIVE', op: '*', hours: 0, target: 'Active' }]), 'Active');

  // cycle safety — must terminate + converge to a stable fixed point (never hang / throw)
  (function () {
    const cyc = [{ source: 'A', op: '*', hours: 0, target: 'B' }, { source: 'B', op: '*', hours: 0, target: 'A' }];
    let threw = false; let res = null;
    try { res = applyStatusRules_('A', 0, cyc); } catch (e) { threw = true; }
    devCheck_(R, 'applyStatusRules_ cyclic rules do NOT throw/hang', !threw);
    devCheck_(R, 'applyStatusRules_ cyclic → a stable status', res === 'A' || res === 'B');
    devEq_(R, 'applyStatusRules_ cyclic result is idempotent', applyStatusRules_(res, 0, cyc), res);
  })();

  // ---------- B) [STATUS_RULES] validation + materialization ----------
  const RULE_STATUSES = { kind: 'table', header: ['Status', 'Kind', 'MinHours', 'Color', 'Announce'], rows: [
    ['Active', 'TIER', '10', '', ''], ['Semi-Active', 'TIER', '5', '', ''], ['Inactive', 'TIER', '0', '', ''],
    ['LOA', 'LEAVE', '', '', ''], ['ROA', 'LEAVE', '', '', ''], ['Reserve', 'PROTECTED', '', '', ''],
    ['Probation', 'PROTECTED', '', '', ''],
  ] };
  const rulesBlock = (rows) => ({ STATUSES: RULE_STATUSES, STATUS_RULES: { kind: 'table', header: ['Source', 'Op', 'Hours', 'Target'], rows } });
  const hasErr = (v, key, type) => v.problems.some((p) => p.sev === 'ERROR' && (key ? String(p.key).indexOf(key) === 0 : true) && (type ? p.type === type : true));
  const hasWarn = (v, key) => v.problems.some((p) => p.sev === 'WARN' && String(p.key).indexOf(key) === 0);

  devCheck_(R, 'STATUS_RULES unknown Target → ERROR', hasErr(validateConfig_(rulesBlock([['Active', '<', '2', 'Ghost']])), '[STATUS_RULES].Target'));
  devCheck_(R, 'STATUS_RULES invalid Op → ERROR', hasErr(validateConfig_(rulesBlock([['Active', '!!', '2', 'Inactive']])), '[STATUS_RULES].Op'));
  devCheck_(R, 'STATUS_RULES non-numeric Hours (non-*) → ERROR', hasErr(validateConfig_(rulesBlock([['Active', '<', 'abc', 'Inactive']])), '[STATUS_RULES]', 'number'));
  devCheck_(R, 'STATUS_RULES unknown Source → WARN (never matches)', hasWarn(validateConfig_(rulesBlock([['Ghost', '<', '2', 'Inactive']])), '[STATUS_RULES].Source'));
  devCheck_(R, 'STATUS_RULES * source + * op needs no Hours (valid)', !hasErr(validateConfig_(rulesBlock([['*', '*', '', 'Inactive']])), '[STATUS_RULES]'));

  const vRules = validateConfig_(rulesBlock([['Active', '<', '2', 'Inactive'], ['*', '>=', '20', 'Active']]));
  devEq_(R, 'STATUS_RULES valid set → zero ERRORs', vRules.problems.filter((p) => p.sev === 'ERROR').length, 0);
  const matRules = materialize_(vRules.config, true).rules;
  devEq_(R, 'materialize rules count', matRules.length, 2);
  devEq_(R, 'materialize normalizes a named Source', matRules[0].source, 'ACTIVE');
  devEq_(R, 'materialize keeps * Source as *', matRules[1].source, '*');
  devEq_(R, 'materialize coerces Hours to number', matRules[0].hours, 2);
  devCheck_(R, 'STATUS_RULES cyclic Source→Target → WARN', hasWarn(validateConfig_(rulesBlock([['Active', '*', '0', 'Semi-Active'], ['Semi-Active', '*', '0', 'Active']])), '[STATUS_RULES]'));

  // ---------- C) STATUS_RULES end-to-end via computeStatus_/resolveStatus_ (injected config) ----------
  devWithConfig_({
    STATUSES: { kind: 'table', header: ['Status', 'Kind', 'MinHours', 'Color', 'Announce'], rows: [
      ['Active', 'TIER', '10', '', ''], ['Semi-Active', 'TIER', '5', '', ''], ['Probation', 'TIER', '2', '', ''], ['Inactive', 'TIER', '0', '', ''],
      ['LOA', 'LEAVE', '', '', ''], ['ROA', 'LEAVE', '', '', ''], ['Reserve', 'PROTECTED', '', '', ''],
    ] },
    STATUS_RULES: { kind: 'table', header: ['Source', 'Op', 'Hours', 'Target'], rows: [['Inactive', '<', '1', 'Probation']] },
  }, (cfg, val) => {
    devEq_(R, 'e2e STATUS_RULES validates clean', val.problems.filter((p) => p.sev === 'ERROR').length, 0);
    devEq_(R, 'e2e 0h Inactive rerouted → Probation (matrix over tier)', computeStatus_('Trooper', 0), 'Probation');
    devEq_(R, 'e2e 6h → Semi-Active (base tier, no rule matches)', computeStatus_('Trooper', 6), 'Semi-Active');
    devEq_(R, 'e2e matrix idempotent through resolveStatus_', resolveStatus_('Trooper', computeStatus_('Trooper', 0), 0), 'Probation');
    devEq_(R, 'e2e protected LOA NOT rerouted by matrix', resolveStatus_('Trooper', 'LOA', 0), null);
  });

  // ---------- D) EXPLICIT_LIST ranks ----------
  devCheck_(R, 'RANKS invalid Kind → ERROR', hasErr(validateConfig_({ RANKS: { kind: 'table', header: ['Value', 'Kind'], rows: [['X', 'BOGUS']] } }), '[RANKS]', 'kind'));
  devCheck_(R, 'EXPLICIT_LIST + empty [RANKS] → WARN (heuristic fallback)',
    hasWarn(validateConfig_({ ROSTER_LAYOUT: { kind: 'kv', kv: { DIVIDER_MODE: 'EXPLICIT_LIST' } }, RANKS: { kind: 'table', header: ['Value', 'Kind'], rows: [] } }), '[RANKS]'));

  devWithConfig_({
    ROSTER_LAYOUT: { kind: 'kv', kv: { DIVIDER_MODE: 'EXPLICIT_LIST' } },
    RANKS: { kind: 'table', header: ['Value', 'Kind'], rows: [['SUPREME COMMANDER', 'RANK'], ['Field Division', 'DIVIDER']] },
  }, (cfg, val) => {
    devEq_(R, 'EXPLICIT_LIST validates clean', val.problems.filter((p) => p.sev === 'ERROR').length, 0);
    devEq_(R, 'EXPLICIT_LIST: ALL-CAPS listed RANK is NOT a divider', isDividerValue_('SUPREME COMMANDER'), false);
    devEq_(R, 'EXPLICIT_LIST: ALL-CAPS listed RANK → isMemberSlot_ true', isMemberSlot_('SUPREME COMMANDER'), true);
    devEq_(R, 'EXPLICIT_LIST: mixed-case listed DIVIDER is a divider', isDividerValue_('Field Division'), true);
    devEq_(R, 'EXPLICIT_LIST: mixed-case listed DIVIDER → isMemberSlot_ false', isMemberSlot_('Field Division'), false);
    devEq_(R, 'EXPLICIT_LIST: unlisted ALL-CAPS falls back to heuristic (divider)', isDividerValue_('PATROL TROOPERS'), true);
    devEq_(R, 'EXPLICIT_LIST: unlisted mixed-case falls back to heuristic (member)', isDividerValue_('Trooper'), false);
  });
  devEq_(R, 'default ALLCAPS_RANK: ALL-CAPS is a divider', isDividerValue_('COMMAND STAFF'), true);
  devEq_(R, 'default ALLCAPS_RANK: mixed-case rank is not a divider', isDividerValue_('Sergeant'), false);

  // ---------- E) config-driven [SHEETS] system-tab names + collision guard ----------
  const vRenamed = validateConfig_({ SHEETS: { kind: 'kv', kv: { AUDIT: 'Change History', HOURS_HISTORY: 'Hours Log', SNAPSHOTS: 'Backups' } } });
  devEq_(R, 'renamed system tabs validate clean', vRenamed.problems.filter((p) => p.sev === 'ERROR').length, 0);
  const renamedSheets = materialize_(vRenamed.config, true).legacy.sheets;
  devEq_(R, 'materialize audit tab tracks rename', renamedSheets.audit, 'Change History');
  devEq_(R, 'materialize hoursHistory tab tracks rename', renamedSheets.hoursHistory, 'Hours Log');
  devEq_(R, 'materialize snapshots tab tracks rename', renamedSheets.snapshots, 'Backups');
  devEq_(R, 'blank AUDIT falls back to default "Edit Log"', materialize_(validateConfig_({ SHEETS: { kind: 'kv', kv: { AUDIT: '' } } }).config, true).legacy.sheets.audit, 'Edit Log');

  devCheck_(R, 'colliding tab names (AUDIT = default COVERAGE) → ERROR', hasErr(validateConfig_({ SHEETS: { kind: 'kv', kv: { AUDIT: 'Leave Coverage' } } }), '[SHEETS]', 'sheet'));
  devCheck_(R, 'reusing reserved config tab → ERROR', hasErr(validateConfig_({ SHEETS: { kind: 'kv', kv: { AUDIT: CONFIG_SHEET_NAME } } }), '[SHEETS]', 'sheet'));
  devCheck_(R, 'reusing reserved SYS Log tab → ERROR', hasErr(validateConfig_({ SHEETS: { kind: 'kv', kv: { SNAPSHOTS: SYS_LOG_SHEET } } }), '[SHEETS]', 'sheet'));
  devEq_(R, 'default config has NO tab-name collision (unchanged-on-defaults gate)', validateConfig_({}).problems.filter((p) => p.type === 'sheet').length, 0);

  devWithConfig_({ SHEETS: { kind: 'kv', kv: { AUDIT: 'Change History' } } }, () => {
    devEq_(R, 'cfgSheetName_ resolves the configured name', cfgSheetName_('audit', 'Edit Log'), 'Change History');
    devEq_(R, 'EXTRAS.auditSheet getter tracks config', EXTRAS.auditSheet, 'Change History');
    devEq_(R, 'TRUST.auditSheet getter tracks config', TRUST.auditSheet, 'Change History');
  });
  devEq_(R, 'cfgSheetName_ unknown key → fallback', cfgSheetName_('nope', 'Fallback'), 'Fallback');

  // ---------- F) reset cadence resolution (LAST_RESET never mutated) ----------
  devWithConfig_({ SCHEDULE: { kind: 'kv', kv: { RESET_CADENCE: 'MANUAL' } } }, () => {
    devEq_(R, 'cadence MANUAL materialized', cfg_().kv.SCHEDULE.RESET_CADENCE, 'MANUAL');
    devEq_(R, 'resetDue_ MANUAL → false (no auto reset)', resetDue_(), false);
  });
  devWithConfig_({ SCHEDULE: { kind: 'kv', kv: { RESET_CADENCE: 'WEEKLY' } } }, () => {
    devEq_(R, 'resetDue_ WEEKLY → true (runs every fire)', resetDue_(), true);
  });
  // CAD-1 regression: WEEKLY_HOURS_RESET=OFF must be authoritative at RUN time (not only at install time), regardless of cadence.
  devWithConfig_({ SCHEDULE: { kind: 'kv', kv: { WEEKLY_HOURS_RESET: 'OFF' } } }, () => {
    devEq_(R, 'resetDue_ OFF → false even under default WEEKLY cadence (OFF authoritative)', resetDue_(), false);
  });
  devWithConfig_({ SCHEDULE: { kind: 'kv', kv: { RESET_CADENCE: 'MONTHLY', WEEKLY_HOURS_RESET: 'OFF' } } }, () => {
    devEq_(R, 'resetDue_ OFF → false regardless of cadence (MONTHLY)', resetDue_(), false);
  });
  devWithConfig_({ SCHEDULE: { kind: 'kv', kv: { RESET_CADENCE: 'MONTHLY', RESET_DOM: '15' } } }, () => {
    devEq_(R, 'RESET_DOM coerced to int 15', cfg_().kv.SCHEDULE.RESET_DOM, 15);
    devEq_(R, 'cadence MONTHLY materialized', cfg_().kv.SCHEDULE.RESET_CADENCE, 'MONTHLY');
  });
  devInfo_(R, 'BIWEEKLY/MONTHLY elapsed-day gating is live-only', 'resetDue_ reads Date.now() + the LAST_RESET script property; not asserted here so the real cadence marker is never mutated.');

  // ---------- G) Settings Studio surface (v2.5.0): the full schema is editable via cpGetConfig_/cpApplyConfig_ ----------
  ['STATUS_RULES', 'RANKS', 'SECTION_TAGS', 'DASHBOARD_GROUPS', 'DASHBOARD_CELLS', 'FORM_MAP', 'SECTIONS'].forEach(function (nm) {
    devCheck_(R, 'CP_SETTINGS_TABLES_ exposes [' + nm + '] to the panel', CP_SETTINGS_TABLES_.indexOf(nm) !== -1);
  });
  devCheck_(R, 'COLUMNS stays OUT of the Settings surface (edited on the dedicated Columns tab)', CP_SETTINGS_TABLES_.indexOf('COLUMNS') === -1);
  (function () {
    var names = cpGetConfig_().blocks.map(function (b) { return b.name; });
    devCheck_(R, 'cpGetConfig_ surfaces [STATUS_RULES] to the Studio', names.indexOf('STATUS_RULES') !== -1);
    devCheck_(R, 'cpGetConfig_ surfaces [RANKS] to the Studio', names.indexOf('RANKS') !== -1);
    devCheck_(R, 'cpGetConfig_ surfaces [DASHBOARD_CELLS] to the Studio', names.indexOf('DASHBOARD_CELLS') !== -1);
    devCheck_(R, 'cpGetConfig_ still surfaces the kv blocks (SHEETS + SCHEDULE)', names.indexOf('SHEETS') !== -1 && names.indexOf('SCHEDULE') !== -1);
    var sheets = cpGetConfig_().blocks.filter(function (b) { return b.name === 'SHEETS'; })[0];
    var keys = sheets ? sheets.keys.map(function (k) { return k.key; }) : [];
    devCheck_(R, 'SHEETS block now includes the system-tab-name keys', keys.indexOf('AUDIT') !== -1 && keys.indexOf('SNAPSHOTS') !== -1);
  })();

  // ---------- H) v2.5.0 configurable logic: unit format, dates, embed colours, limits ----------
  devWithConfig_({}, function () {
    devEq_(R, 'formatUnit_ default → S-01', formatUnit_(1), 'S-01');
    devEq_(R, 'formatUnit_ default 10 → S-10', formatUnit_(10), 'S-10');
    devEq_(R, 'formatUnit_ default 100 → S-100 (grows past pad)', formatUnit_(100), 'S-100');
    devEq_(R, 'fmtDisplay_ default → "15 Mar. 2026"', fmtDisplay_(new Date(2026, 2, 15, 14, 30)), '15 Mar. 2026');
  });
  devWithConfig_({ ROSTER_LAYOUT: { kind: 'kv', kv: { UNIT_FORMAT: 'TRP-{000}' } } }, function () {
    devEq_(R, 'formatUnit_ TRP-{000} 7 → TRP-007', formatUnit_(7), 'TRP-007');
    devEq_(R, 'formatUnit_ TRP-{000} 1234 → TRP-1234 (grows past pad)', formatUnit_(1234), 'TRP-1234');
  });
  devWithConfig_({ ROSTER_LAYOUT: { kind: 'kv', kv: { UNIT_FORMAT: 'Squad-' } } }, function () {
    // NB: config strings are trimmed by coerce_, so a separator must be part of the template (e.g. "Squad-"), not a trailing space.
    devEq_(R, 'formatUnit_ no {0} token → number appended', formatUnit_(5), 'Squad-5');
  });
  devEq_(R, 'hexToInt_ #3498db → 3447003 (submit default int)', hexToInt_('#3498db', 0), 3447003);
  devEq_(R, 'hexToInt_ #e67e22 → 15105570 (return default int)', hexToInt_('#e67e22', 0), 15105570);
  devEq_(R, 'hexToInt_ #ed4245 → 15548997 (expire default int)', hexToInt_('#ed4245', 0), 15548997);
  devEq_(R, 'hexToInt_ malformed → default', hexToInt_('nope', 999), 999);
  devEq_(R, 'hexToInt_ blank → default', hexToInt_('', 42), 42);
  // --- v2.5.0 embed chrome (author / thumbnail / image / footer) — pure + URL-guarded ---
  (function () {
    var e0 = embedChromeFrom_({}, 'Roster System');
    devCheck_(R, 'embedChromeFrom_ blank → footer only', !!(e0.footer && e0.footer.text === 'Roster System' && !e0.author && !e0.thumbnail && !e0.image));
    var eFull = embedChromeFrom_({ authorName: 'PD', authorIcon: 'https://x/a.png', thumbnail: 'https://x/t.png', image: 'http://y/i.jpg', footerText: 'Ping', footerIcon: 'https://x/f.png' }, 'Sys');
    devCheck_(R, 'embedChromeFrom_ full → author/thumb/image/footer all present', !!(eFull.author && eFull.author.icon_url && eFull.thumbnail && eFull.thumbnail.url && eFull.image && eFull.image.url && eFull.footer.icon_url && eFull.footer.text === 'Ping'));
    var eBad = embedChromeFrom_({ authorName: 'PD', authorIcon: 'javascript:alert(1)', thumbnail: 'not a url', image: 'ftp://z', footerIcon: 'data:x' }, 'Sys');
    devCheck_(R, 'embedChromeFrom_ drops non-http(s) URLs (name kept, icons/images omitted)', !!(eBad.author && !eBad.author.icon_url && !eBad.thumbnail && !eBad.image && !eBad.footer.icon_url));
    devEq_(R, 'footerFrom_ blank text → system name', footerFrom_({}, 'MyDept').text, 'MyDept');
    devEq_(R, 'embedUrl_ passes https', embedUrl_('https://a.com'), 'https://a.com');
    devEq_(R, 'embedUrl_ rejects javascript:', embedUrl_('javascript:x'), '');
  })();
  // --- v2.5.0 event notifications — fill_ token substitution, notify view defaults/overrides, notify_ OFF is a no-op ---
  (function () {
    devEq_(R, 'fill_ replaces {name}', fill_('{name} joined', { name: 'Bravo' }), 'Bravo joined');
    devEq_(R, 'fill_ replaces {from}/{to}', fill_('{from} → {to}', { from: 'Officer', to: 'Sergeant' }), 'Officer → Sergeant');
    devEq_(R, 'fill_ leaves an unmatched token as-is', fill_('{missing}!', { name: 'x' }), '{missing}!');
    devEq_(R, 'fill_ null template → empty string', fill_(null, { name: 'x' }), '');
    var N = materialize_(validateConfig_({}).config, true).legacy.notify;
    devEq_(R, 'notify.memberAdded default OFF', N.memberAdded, false);
    devEq_(R, 'notify.transfer default OFF', N.transfer, false);
    devEq_(R, 'notify.leaveApproved default OFF', N.leaveApproved, false);
    devEq_(R, 'notify.leaveStarted default OFF', N.leaveStarted, false);
    devEq_(R, 'notify.weeklyDigest default OFF', N.weeklyDigest, false);
    devEq_(R, 'notify.memberAddedTitle default', N.memberAddedTitle, '➕ {name} joined the roster');
    devEq_(R, 'notify.transferColor default', N.transferColor, '#5865f2');
    devEq_(R, 'notify.startedColor default', N.startedColor, '#4ea7d6');
    var Non = materialize_(validateConfig_({ NOTIFICATIONS: { kind: 'kv', kv: { MEMBER_ADDED: 'TRUE', TRANSFER: 'TRUE', WEEKLY_DIGEST_TITLE: 'Recap' } } }).config, true).legacy.notify;
    devEq_(R, 'notify.memberAdded honours TRUE', Non.memberAdded, true);
    devEq_(R, 'notify.transfer honours TRUE', Non.transfer, true);
    devEq_(R, 'notify.leaveApproved stays OFF when unset', Non.leaveApproved, false);
    devEq_(R, 'notify.digestTitle honours an override', Non.digestTitle, 'Recap');
    var threw = false; try { notify_(false, { title: 'must not send' }); } catch (e) { threw = true; }
    devCheck_(R, 'notify_ with the toggle OFF is a no-op (no throw, no webhook call)', !threw);
    var cg = cpGetConfig_();
    devCheck_(R, 'cpGetConfig_ surfaces the NOTIFICATIONS block', cg.blocks.map(function (b) { return b.name; }).indexOf('NOTIFICATIONS') !== -1);
  })();
  // --- v2.5.0 patrol log → hours: config defaults, duration math, member match (ID→callsign), end-to-end credit + dedup ---
  (function () {
    var L = materialize_(validateConfig_({}).config, true).legacy;
    devEq_(R, 'patrol default mode START_END', L.patrol.mode, 'START_END');
    devEq_(R, 'patrol default maxHours 16', L.patrol.maxHours, 16);
    devEq_(R, 'patrol default overnight ON', L.patrol.overnight, true);
    devEq_(R, 'patrol default recompute ON', L.patrol.recompute, true);
    devEq_(R, 'sheets.patrol default OFF (empty)', L.sheets.patrol, '');
    devEq_(R, 'notify.patrolLogged default OFF', L.notify.patrolLogged, false);
    devEq_(R, 'PATROL block additive: validateConfig_({}) still 0 ERRORs', validateConfig_({}).problems.filter(function (p) { return p.sev === 'ERROR'; }).length, 0);
    devCheck_(R, 'cpGetConfig_ surfaces the PATROL block', cpGetConfig_().blocks.map(function (b) { return b.name; }).indexOf('PATROL') !== -1);
  })();
  devWithConfig_({}, function () { // defaults: START_END, max 16, overnight ON
    var d = function (h, m) { return new Date(2026, 0, 1, h, m || 0, 0); };
    devEq_(R, 'patrolDuration_ 14:00→17:30 = 3.5h', patrolDuration_(d(14, 0), d(17, 30), ''), 3.5);
    devEq_(R, 'patrolDuration_ 22:00→01:00 overnight = 3h', patrolDuration_(d(22, 0), d(1, 0), ''), 3);
    devEq_(R, 'patrolDuration_ 09:00→09:00 (zero) → null', patrolDuration_(d(9, 0), d(9, 0), ''), null);
    devEq_(R, 'patrolDuration_ 20h span > MAX_HOURS → null', patrolDuration_(new Date(2026, 0, 1, 4, 0), new Date(2026, 0, 2, 0, 0), ''), null);
    devEq_(R, 'patrolDuration_ non-date start → null', patrolDuration_('not a time', d(17, 0), ''), null);
  });
  devWithConfig_({ PATROL: { kind: 'kv', kv: { MODE: 'DURATION' } } }, function () {
    devEq_(R, 'patrolDuration_ DURATION "2.5" → 2.5', patrolDuration_('', '', '2.5'), 2.5);
    devEq_(R, 'patrolDuration_ DURATION "0" → null', patrolDuration_('', '', '0'), null);
    devEq_(R, 'patrolDuration_ DURATION "99" > cap → null', patrolDuration_('', '', '99'), null);
  });
  devWithConfig_({ PATROL: { kind: 'kv', kv: { OVERNIGHT: 'FALSE' } } }, function () {
    devEq_(R, 'patrolDuration_ overnight OFF: end<start → null', patrolDuration_(new Date(2026, 0, 1, 22, 0), new Date(2026, 0, 1, 1, 0), ''), null);
  });
  (function () { // patrolFindRow_ — ID primary, callsign fallback
    var ro = devBuildRoster_([
      { rank: 'Trooper', name: 'IdGuy', id: devId_(1), activity: 'Active', hours: 5, unit: 'S-01' },
      { rank: 'Trooper', name: 'CallGuy', id: '', activity: 'Active', hours: 5, unit: 'S-02' },
    ]);
    var start = CONFIG.rosterStartRow;
    devEq_(R, 'patrolFindRow_ matches by Discord ID', patrolFindRow_(ro, devId_(1), 'nope'), start);
    devEq_(R, 'patrolFindRow_ empty ID → unique callsign', patrolFindRow_(ro, '', 'S-02'), start + 1);
    devEq_(R, 'patrolFindRow_ ID wins over callsign', patrolFindRow_(ro, devId_(1), 'S-02'), start);
    devEq_(R, 'patrolFindRow_ no match → -1', patrolFindRow_(ro, devId_(99), 'S-99'), -1);
    // safety: a PROVIDED-but-unmatched ID must NOT silently fall back to a callsign (wrong-member guard)
    devEq_(R, 'patrolFindRow_ valid unmatched ID does NOT fall back to callsign → -1', patrolFindRow_(ro, devId_(99), 'S-02'), -1);
    devEq_(R, 'patrolFindRow_ malformed ID → -1 (no callsign guess)', patrolFindRow_(ro, '12345', 'S-02'), -1);
    var dup = devBuildRoster_([
      { rank: 'Trooper', name: 'DupA', id: '', activity: 'Active', hours: 5, unit: 'S-05' },
      { rank: 'Trooper', name: 'DupB', id: '', activity: 'Active', hours: 5, unit: 'S-05' },
    ]);
    devEq_(R, 'patrolFindRow_ ambiguous callsign (2 members share it) → -1', patrolFindRow_(dup, '', 'S-05'), -1);
  })();
  devWithConfig_({}, function () { // syncPatrolHours_ end-to-end: credit, recompute, mark done, retry errors, dedup
    var ro = devBuildRoster_([{ rank: 'Trooper', name: 'Patroller', id: devId_(1), activity: 'Inactive', hours: 8, unit: 'S-01' }]);
    var start = CONFIG.rosterStartRow, RC = rosterCols_(ro);
    var ps = devFreshSheet_('Patrol');
    ps.getRange(1, 1, 1, 5).setValues([['Timestamp', 'Discord', 'Callsign', 'Start', 'End']]);
    ps.getRange(2, 2, 3, 1).setNumberFormat('@');
    ps.getRange(2, 1, 3, 5).setValues([
      [new Date(), devId_(1), 'S-01', new Date(2026, 0, 1, 14, 0), new Date(2026, 0, 1, 17, 0)], // valid → +3h
      [new Date(), devId_(99), 'S-99', new Date(2026, 0, 1, 9, 0), new Date(2026, 0, 1, 10, 0)],  // no member → error
      [new Date(), devId_(1), 'S-01', new Date(2026, 0, 1, 9, 0), new Date(2026, 0, 1, 9, 0)],    // zero duration → error
    ]);
    var res = syncPatrolHours_(ps, ro, { sendWebhooks: false });
    devEq_(R, 'syncPatrolHours_ credited 1 log', res.credited.length, 1);
    devEq_(R, 'syncPatrolHours_ added 3 hrs', res.hoursAdded, 3);
    devEq_(R, 'syncPatrolHours_ flagged 2 bad rows', res.errored, 2);
    devEq_(R, 'member hours 8 → 11', ro.getRange(start, RC.hours).getValue(), 11);
    devEq_(R, 'member recomputed 11h → Active', devActivity_(ro, 0), 'Active');
    devEq_(R, 'credited row painted done (green)', String(ps.getRange(2, 1).getBackground()).toLowerCase(), String(CONFIG.bg.done).toLowerCase());
    var res2 = syncPatrolHours_(ps, ro, { sendWebhooks: false }); // dedup: credited rows skipped
    devEq_(R, 'syncPatrolHours_ re-run credits 0 (dedup)', res2.credited.length, 0);
    devEq_(R, 'member hours unchanged after re-run', ro.getRange(start, RC.hours).getValue(), 11);
    // DURABLE dedup: even if the credited row's background is CLEARED (operator reformat/sort), the _Credited key blocks a re-credit
    ps.getRange(2, 1, 1, ps.getLastColumn()).setBackground(null);
    var res3 = syncPatrolHours_(ps, ro, { sendWebhooks: false });
    devEq_(R, 'syncPatrolHours_ durable key survives a cleared background → 0 credits', res3.credited.length, 0);
    devEq_(R, 'member hours still 11 after background clear + re-run', ro.getRange(start, RC.hours).getValue(), 11);
  });
  devWithConfig_({ FORMATS: { kind: 'kv', kv: { DATE_DISPLAY: 'yyyy-MM-dd' } } }, function () {
    devEq_(R, 'fmtDisplay_ honours a custom DATE_DISPLAY', fmtDisplay_(new Date(2026, 2, 15)), '2026-03-15');
  });
  devWithConfig_({ FORMATS: { kind: 'kv', kv: { DATE_DISPLAY: "'oops" } } }, function () {
    var threw = false, out = '';
    try { out = fmtDisplay_(new Date(2026, 2, 15)); } catch (e) { threw = true; }
    devCheck_(R, 'fmtDisplay_ bad pattern does NOT throw (fault-tolerant)', !threw);
    devEq_(R, 'fmtDisplay_ bad pattern falls back to the default', out, '15 Mar. 2026');
  });
  (function () {
    var L = materialize_(validateConfig_({}).config, true).legacy;
    devEq_(R, 'legacy.unitFormat default', L.unitFormat, 'S-{00}');
    devEq_(R, 'legacy.lastActivityStyle default = MATCH', L.lastActivityStyle, 'MATCH');
    devEq_(R, 'legacy.lastActivityStyle honours NEUTRAL', materialize_(validateConfig_({ ROSTER_LAYOUT: { kind: 'kv', kv: { LAST_ACTIVITY_STYLE: 'NEUTRAL' } } }).config, true).legacy.lastActivityStyle, 'NEUTRAL');
    devEq_(R, 'LAST_ACTIVITY_STYLE bad value → ERROR (enum guard)', validateConfig_({ ROSTER_LAYOUT: { kind: 'kv', kv: { LAST_ACTIVITY_STYLE: 'RAINBOW' } } }).problems.filter(function (p) { return p.sev === 'ERROR' && /LAST_ACTIVITY_STYLE/.test(p.key || ''); }).length, 1);
    devEq_(R, 'legacy.embed.submitTitle default', L.embed.submitTitle, '📥 New {type} Submission');
    devEq_(R, 'legacy.embed.submitColor default', L.embed.submitColor, '#3498db');
    devEq_(R, 'legacy.limits.snapshotKeep default', L.limits.snapshotKeep, 20);
    devEq_(R, 'legacy.limits.logRowCap default', L.limits.logRowCap, 5000);
    devEq_(R, 'legacy.limits.validationBuffer default', L.limits.validationBuffer, 50);
    devEq_(R, 'legacy.formats.date default', L.formats.date, 'd MMM. yyyy');
    devEq_(R, 'v2.5.0 additive keys: default config still has zero ERRORs', validateConfig_({}).problems.filter(function (p) { return p.sev === 'ERROR'; }).length, 0);
  })();
  // --- v2.5.0 PERF: cross-execution config cache + dashboard tab memory ---
  (function () {
    cfg_(); // a live parse fills the cross-execution cache when a real config tab exists
    cfgInvalidate_();
    var after = 'x'; try { after = CacheService.getDocumentCache().get(CFG_CACHE_KEY_); } catch (e) { after = null; }
    devCheck_(R, 'cfg cache: cleared by cfgInvalidate_()', after === null);
    devCheck_(R, 'cfg_() rebuilds fine after invalidation', !!cfg_().legacy);
    var prevTabs = dashTabsGet_();
    dashTabsSet_(['QA Tab A', 'QA Tab B']);
    devEq_(R, 'dash tab memory round-trips', (dashTabsGet_() || []).join('|'), 'QA Tab A|QA Tab B');
    try { if (prevTabs) dashTabsSet_(prevTabs); else PropertiesService.getDocumentProperties().deleteProperty(DASH_TABS_PROP_); } catch (e) { /* restore best-effort */ }
    devInfo_(R, 'dash tab memory restored', 'the live RE_DASH_TABS value (if any) was put back; a menu Refresh Dashboard rebuilds it anyway.');
  })();

  return R;
}
