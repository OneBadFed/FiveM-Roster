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
    .addItem('🎲 Add Random LOA (test)', p + 'devAddRandomLOA')
    .addItem('🚔 Add Random Patrol Log (test)', p + 'devAddRandomPatrol')
    .addItem('🧾 Add Random Signup (test)', p + 'devAddRandomSignup')
    .addSeparator()
    // The full 23-section run can exceed Apps Script's ~6-minute execution cap and die mid-suite — run the three
    // parts back-to-back instead (each fits comfortably). Run ALL stays for accounts/configs where it fits.
    .addItem('▶️ Run Tests — Part 1 (sections 1–8)', p + 'devRunAllTestsPart1')
    .addItem('▶️ Run Tests — Part 2 (sections 9–16)', p + 'devRunAllTestsPart2')
    .addItem('▶️ Run Tests — Part 3 (sections 17–23)', p + 'devRunAllTestsPart3')
    .addItem('⏱️ Run ALL Tests (may hit the 6-min cap)', p + 'devRunAllTests')
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
      .addItem('19 · v1.0 config extensions', p + 'devRunSection19')
      .addItem('20 · New-layout column resolution', p + 'devRunSection20')
      .addItem('21 · Patrol Log tracker', p + 'devRunSection21')
      .addItem('22 · Roster Signups', p + 'devRunSection22')
      .addItem('23 · Public roster publish', p + 'devRunSection23'))
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

/**
 * Dev/QA quick tool: add ONE random Pending LOA to the LIVE tracker — a random roster member (with a valid Unique
 * ID) + random start/end dates — to exercise the new-at-top + auto-sort-by-status behavior. Run it repeatedly to
 * add them one at a time. These are real test rows (noted "🎲 random test"); delete them or change their status
 * when you're done. Goes through the same path as a real add (sortTracker_), so each one lands at the top of Pending.
 */
function devAddRandomLOA() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  const tracker = ss.getSheetByName(CONFIG.sheets.tracker);
  if (!roster || !tracker) { ui.alert('🎲 Add Random LOA', `Need both the "${CONFIG.sheets.roster}" and "${CONFIG.sheets.tracker}" tabs.`, ui.ButtonSet.OK); return; }

  const RC = rosterCols_(roster);
  const start = CONFIG.rosterStartRow, last = roster.getLastRow();
  const n = Math.max(0, last - start + 1);
  const ranks = n ? roster.getRange(start, RC.rank, n, 1).getValues() : [];
  const names = n ? roster.getRange(start, RC.name, n, 1).getValues() : [];
  const ids = n ? roster.getRange(start, RC.discord, n, 1).getDisplayValues() : [];
  const eligible = [];
  for (let i = 0; i < n; i++) {
    const id = String(ids[i][0]).trim();
    if (isValidMemberValues_(ranks[i][0], names[i][0]) && isValidId_(id)) eligible.push(start + i);
  }
  if (!eligible.length) { ui.alert('🎲 Add Random LOA', 'No members with a valid ' + idDigitsLabel_() + '-digit Unique ID to pick from — assign some members first.', ui.ButtonSet.OK); return; }

  const row = eligible[Math.floor(Math.random() * eligible.length)];
  const rank = String(roster.getRange(row, RC.rank).getDisplayValue()).trim();
  const name = String(roster.getRange(row, RC.name).getDisplayValue()).trim();
  const unit = RC.unit ? String(roster.getRange(row, RC.unit).getDisplayValue()).trim() : '';
  const discord = String(roster.getRange(row, RC.discord).getDisplayValue()).trim();
  const ooc = RC.ooc ? String(roster.getRange(row, RC.ooc).getDisplayValue()).trim() : '';
  const shift = RC.shift ? String(roster.getRange(row, RC.shift).getDisplayValue()).trim() : '';

  const today = todayInSheetTz_();
  const startD = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (Math.floor(Math.random() * 17) - 2)); // -2..+14 days
  const endD = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate() + (3 + Math.floor(Math.random() * 19))); // +3..+21 days
  const key = makeLeaveKey_(discord, new Date()); // timestamp key → always unique (never dedup-collides)

  // Same path as a real add: fields placed by their RESOLVED header column (any layout), prepend to the top, auto-group.
  const TC = trackerCols_(tracker);
  sortTracker_(buildTrackerRow_(TC, TC.width, { key: key, rank: rank, unit: unit, ooc: ooc, name: name, discord: discord, shift: shift, start: startD, end: endD, status: CONFIG.pendingStatus, notes: '🎲 random test' }), tracker);
  SpreadsheetApp.flush();
  ui.alert('🎲 Add Random LOA', `Added a ${CONFIG.pendingStatus} LOA at the top:\n\n${name || '(unnamed)'} — ${rank}\n${fmtDisplay_(startD)} → ${fmtDisplay_(endD)}\n\nRun it again to add another.`, ui.ButtonSet.OK);
}

/**
 * Dev/QA quick tool: add ONE random patrol log to the LIVE Patrol Log — a random roster member (with a valid Unique ID)
 * + random start/end date+time — through the SAME path as a real entry (auto-fill member, compute TOTAL TIME, credit
 * the hours, flag if bad, then re-group). ~70% are valid (credit hours); the rest are intentionally bad to demo each
 * flag (over-max / future-dated / end-before-start). Real test rows — clear a row's cells to remove it (un-credits).
 */
/**
 * Simulate a Roster Signup submission. If a signup form tab is linked, drop a fake submission on IT and run the real
 * sync (field-match → review tab); otherwise write the applicant straight onto the review tab. Either way it lands as
 * Pending, ready to approve. The applicant uses a HIGH demo index so its Unique ID won't collide with the demo roster.
 */
function devAddRandomSignup() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const review = CONFIG.sheets.signups ? ss.getSheetByName(CONFIG.sheets.signups) : null;
  if (!review) { ui.alert('🧾 Add Random Signup', `Need the "${CONFIG.sheets.signups}" review tab.\n\nSet it under ⚙️ Engine Settings ▸ Sheets & layout ▸ SIGNUPS, then run this again.`, ui.ButtonSet.OK); return; }

  const i = 700 + Math.floor(Math.random() * 260); // high index → an ID that won't collide with the demo roster (so it can be approved)
  const nm = (typeof demoName_ === 'function') ? demoName_(i) : ('Applicant ' + i);
  const app = {
    name: nm,
    ooc: (typeof demoOocName_ === 'function') ? demoOocName_(nm) : nm,
    discord: (typeof demoId_ === 'function') ? demoId_(i) : ('7700000000000008' + (10 + (i % 90))),
    email: (typeof demoEmail_ === 'function') ? demoEmail_(nm) : (String(nm).toLowerCase().replace(/[^a-z0-9]+/g, '.') + '@lspd.example'),
    dob: (typeof demoDob_ === 'function') ? demoDob_(i) : new Date(1996, 3, 12),
    join: (typeof todayInSheetTz_ === 'function') ? todayInSheetTz_() : new Date(), // department join / signup date
  };
  const put = (arr, c, v) => { if (c) arr[c - 1] = v; };

  const form = CONFIG.sheets.signupForm ? ss.getSheetByName(CONFIG.sheets.signupForm) : null;
  if (form) { // simulate a real submission on the FORM's own tab, then run the actual sync
    const FSC = signupCols_(form);
    const width = Math.max(form.getLastColumn(), 1);
    const rowV = new Array(width).fill('');
    put(rowV, FSC.timestamp, new Date()); put(rowV, FSC.name, app.name); put(rowV, FSC.ooc, app.ooc);
    put(rowV, FSC.discord, app.discord); put(rowV, FSC.email, app.email); put(rowV, FSC.dob, app.dob); put(rowV, FSC.join, app.join);
    const at = form.getLastRow() + 1;
    if (at > form.getMaxRows()) form.insertRowsAfter(form.getMaxRows(), 1);
    form.getRange(at, 1, 1, width).setValues([rowV]);
    if (FSC.discord) form.getRange(at, FSC.discord).setNumberFormat('@');
    SpreadsheetApp.flush(); // settle the appended row before the sync reads the form
    const added = (typeof syncSignupForm === 'function') ? syncSignupForm() : 0;
    SpreadsheetApp.flush();
    ui.alert('🧾 Add Random Signup', `Simulated a form submission from ${app.name} (${app.discord}) on "${CONFIG.sheets.signupForm}", then synced ${added} row into "${CONFIG.sheets.signups}" as Pending.\n\nReview it in 🎛️ Control Panel ▸ Signups.`, ui.ButtonSet.OK);
  } else { // no form linked yet → drop the applicant straight onto the review tab so the demo still works
    const SC = signupCols_(review);
    if (!SC.status || !SC.discord) { ui.alert('🧾 Add Random Signup', `The "${CONFIG.sheets.signups}" tab needs a header row with at least NAME, UNIQUE ID and STATUS columns.`, ui.ButtonSet.OK); return; }
    const rowV = new Array(SC.width).fill('');
    put(rowV, SC.name, app.name); put(rowV, SC.ooc, app.ooc); put(rowV, SC.discord, app.discord); put(rowV, SC.email, app.email); put(rowV, SC.dob, app.dob); put(rowV, SC.join, app.join);
    rowV[SC.status - 1] = SIGNUP_STATUSES_[0];
    const at = signupFirstFreeRow_(review, SC);
    if (at > review.getMaxRows()) review.insertRowsAfter(review.getMaxRows(), at - review.getMaxRows());
    writeValuesSafe_(review, at, 1, [rowV], null);
    review.getRange(at, SC.discord).setNumberFormat('@');
    try { sortSignups_(review); } catch (e) { log_('devAddRandomSignup.sort', e); }
    SpreadsheetApp.flush();
    ui.alert('🧾 Add Random Signup', `No signup form is linked yet ([SHEETS].SIGNUP_FORM_RESPONSES is blank), so I added demo applicant ${app.name} (${app.discord}) straight to "${CONFIG.sheets.signups}" as Pending.\n\nLink a form to exercise the real sync path.`, ui.ButtonSet.OK);
  }
}

function devAddRandomPatrol() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  const plName = CONFIG.sheets.patrolLog;
  const patrol = plName ? ss.getSheetByName(plName) : null;
  if (!roster) { ui.alert('🚔 Add Random Patrol Log', `Need the "${CONFIG.sheets.roster}" tab.`, ui.ButtonSet.OK); return; }
  if (!patrol) { ui.alert('🚔 Add Random Patrol Log', plName ? `The Patrol Log tab "${plName}" was not found.` : 'Patrol Log is OFF — set [SHEETS].PATROL_LOG to your Patrol Log tab name.', ui.ButtonSet.OK); return; }

  // Pick a random roster member with a valid Unique ID.
  const RC = rosterCols_(roster);
  const rstart = CONFIG.rosterStartRow, rlast = roster.getLastRow(), n = Math.max(0, rlast - rstart + 1);
  const ranks = n ? roster.getRange(rstart, RC.rank, n, 1).getValues() : [];
  const names = n ? roster.getRange(rstart, RC.name, n, 1).getValues() : [];
  const ids = n ? roster.getRange(rstart, RC.discord, n, 1).getDisplayValues() : [];
  const pick = [];
  for (let i = 0; i < n; i++) { if (isValidMemberValues_(ranks[i][0], names[i][0]) && isValidId_(String(ids[i][0]).trim())) pick.push(rstart + i); }
  if (!pick.length) { ui.alert('🚔 Add Random Patrol Log', 'No members with a valid ' + idDigitsLabel_() + '-digit Unique ID to pick from — assign some members first.', ui.ButtonSet.OK); return; }
  const mrow = pick[Math.floor(Math.random() * pick.length)];
  const discord = String(roster.getRange(mrow, RC.discord).getDisplayValue()).trim();
  const name = String(roster.getRange(mrow, RC.name).getDisplayValue()).trim();
  const rank = String(roster.getRange(mrow, RC.rank).getDisplayValue()).trim();

  // Build a random session. Mostly valid; occasionally bad to demo a flag.
  const rInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const today = todayInSheetTz_();
  const dayBack = (d) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - d);
  const dayFwd = (d) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
  const endFrom = (sD, sh, sm, durH) => { const t = sh * 60 + sm + Math.round(durH * 60); return { eD: new Date(sD.getFullYear(), sD.getMonth(), sD.getDate() + Math.floor(t / 1440)), eh: Math.floor((t % 1440) / 60), em: t % 60 }; };
  const roll = Math.random();
  let startD, endD, sh = rInt(6, 13), sm = [0, 15, 30, 45][rInt(0, 3)], eh, em;
  if (roll < 0.70) { startD = dayBack(rInt(1, 10)); const e = endFrom(startD, sh, sm, rInt(1, 8)); endD = e.eD; eh = e.eh; em = e.em; }          // valid
  else if (roll < 0.80) { sh = rInt(0, 4); startD = dayBack(rInt(2, 6)); const e = endFrom(startD, sh, sm, rInt(18, 22)); endD = e.eD; eh = e.eh; em = e.em; } // over-max
  else if (roll < 0.90) { startD = dayFwd(rInt(2, 5)); const e = endFrom(startD, sh, sm, rInt(1, 6)); endD = e.eD; eh = e.eh; em = e.em; }                    // future
  else { startD = dayBack(rInt(1, 6)); endD = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate()); sh = rInt(14, 20); sm = 0; eh = rInt(1, sh - 2); em = 0; } // end-before-start

  const PC = patrolLogCols_(patrol);
  if (!PC.discord || !PC.startDate || !PC.endDate || !PC.startTime || !PC.endTime || !PC.status) { ui.alert('🚔 Add Random Patrol Log', 'The Patrol Log header is missing a required column (Unique ID, START/END DATE, START/END TIME, or STATUS).', ui.ButtonSet.OK); return; }

  // Write the inputs at the first free row, then run the REAL path (auto-fill + credit/flag + re-group).
  const pstart = CONFIG.patrolStartRow, plast = patrol.getLastRow();
  let row = plast < pstart ? pstart : plast + 1;
  if (plast >= pstart) { const col = patrol.getRange(pstart, PC.discord, plast - pstart + 1, 1).getDisplayValues(); for (let i = 0; i < col.length; i++) { if (String(col[i][0]).trim() === '') { row = pstart + i; break; } } }
  const T = (h, m) => new Date(2020, 0, 1, h, m, 0); // time-of-day (fixed date base so the TOTAL formula cancels it out)
  patrol.getRange(row, PC.discord).setNumberFormat('@').setValue(discord);
  patrol.getRange(row, PC.startDate).setNumberFormat('d mmm. yyyy').setValue(startD);
  patrol.getRange(row, PC.endDate).setNumberFormat('d mmm. yyyy').setValue(endD);
  patrol.getRange(row, PC.startTime).setNumberFormat('h:mm am/pm').setValue(T(sh, sm));
  patrol.getRange(row, PC.endTime).setNumberFormat('h:mm am/pm').setValue(T(eh, em));

  processPatrolLog_(patrol, row, PC, roster);
  const status = String(patrol.getRange(row, PC.status).getDisplayValue()).trim();
  const total = PC.total ? String(patrol.getRange(row, PC.total).getDisplayValue()).trim() : '';
  const note = PC.notes ? String(patrol.getRange(row, PC.notes).getDisplayValue()).trim() : '';
  sortPatrolLog_(patrol);
  SpreadsheetApp.flush();

  const pad = (x) => (x < 10 ? '0' + x : '' + x);
  const flagged = norm_(status) === norm_(CONFIG.patrol.flaggedStatus);
  ui.alert('🚔 Add Random Patrol Log',
    `${name || '(unnamed)'} — ${rank}\n${fmtDisplay_(startD)} ${pad(sh)}:${pad(sm)} → ${fmtDisplay_(endD)} ${pad(eh)}:${pad(em)}\n\n` +
    (flagged ? `⚠️ ${status} — ${note}\n(no hours credited)` : `✅ ${status} · ${total} credited to ${name || 'the member'}'s hours`) +
    `\n\nRun again to add another. Clear a row's cells to remove it.`,
    ui.ButtonSet.OK);
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
  ['v1.0 config extensions (sandbox)', devV25Tests_],
  ['New-layout column resolution (sandbox)', devNewLayoutTests_],
  ['Patrol Log tracker (sandbox)', devPatrolLogTests_],
  ['Roster Signups (sandbox)', devSignupTests_],
  ['Public roster publish (sandbox)', devPublishTests_],
];

/* ======================================================================
 * ENTRY POINTS — Run-ALL and the Part 1 / Part 2 split.
 * A full 23-section run can exceed Apps Script's ~6-minute execution cap
 * (especially on a consumer account), which kills the run mid-suite — so the
 * menu offers the suite in two halves. Each half repeats the config preflight
 * and uses the same teardown + report path; the split point is one constant.
 * ====================================================================== */
const DEV_PART_ENDS_ = [8, 16]; // Part 1 = sections 1..8, Part 2 = 9..16, Part 3 = 17..end — adjust here if a part still hits the cap

/** Runs DEV_GROUPS[from..to] (1-based, inclusive) with preflight, guaranteed teardown, and a labeled report. */
function devRunRange_(from, to, partLabel) {
  const collectors = [];
  // PREFLIGHT (F-028) — runs before every section so a customized live config is flagged up front, not as mystery reds.
  try { collectors.push(devConfigPreflight_()); }
  catch (e) { const R = devNewResults_('Config preflight — CRASHED'); devCheck_(R, 'preflight ran without throwing', false, String((e && e.stack) || e)); collectors.push(R); }
  try {
    DEV_GROUPS.slice(from - 1, to).forEach(([label, fn]) => {
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
  const totals = devWriteResults_(collectors, partLabel ? `Roster — Dev / QA Results — ${partLabel}` : '');
  devPopup_(totals, partLabel);
}

function devRunAllTests() { devRunRange_(1, DEV_GROUPS.length, ''); }
function devRunAllTestsPart1() { devRunRange_(1, DEV_PART_ENDS_[0], `Part 1 (sections 1–${DEV_PART_ENDS_[0]})`); }
function devRunAllTestsPart2() { devRunRange_(DEV_PART_ENDS_[0] + 1, DEV_PART_ENDS_[1], `Part 2 (sections ${DEV_PART_ENDS_[0] + 1}–${DEV_PART_ENDS_[1]})`); }
function devRunAllTestsPart3() { devRunRange_(DEV_PART_ENDS_[1] + 1, DEV_GROUPS.length, `Part 3 (sections ${DEV_PART_ENDS_[1] + 1}–${DEV_GROUPS.length})`); }

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
function devRunSection21() { devRunSectionByIndex_(21); }
function devRunSection22() { devRunSectionByIndex_(22); }
function devRunSection23() { devRunSectionByIndex_(23); }

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
function devWriteResults_(collectors, title) {
  const ss = SpreadsheetApp.getActive();
  const old = ss.getSheetByName(RESULTS_TAB);
  if (old) ss.deleteSheet(old);
  const sh = ss.insertSheet(RESULTS_TAB, 0);

  let totalPass = 0;
  let totalFail = 0;
  collectors.forEach((c) => { totalPass += c.pass; totalFail += c.fail; });

  const out = [];
  out.push([title || 'Roster — Dev / QA Results', '', '']);
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

function devPopup_(totals, label) {
  const scope = label ? `${label}: ` : '';
  const m = label ? String(label).match(/^Part (\d+)/) : null; // "Part N" with parts still after it → point at Part N+1
  const next = (m && Number(m[1]) <= DEV_PART_ENDS_.length) ? `\n\nNow run ▶️ Run Tests — Part ${Number(m[1]) + 1} for the next chunk of the suite.` : '';
  const msg = totals.fail === 0
    ? `✅ ${scope}all tests passed (${totals.pass} assertions).\n\nSee the "${RESULTS_TAB}" tab.${next}`
    : `❌ ${scope}${totals.fail} of ${totals.pass + totals.fail} assertions FAILED.\n\nOpen "${RESULTS_TAB}" — failing rows are red.${next}`;
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

/**
 * Unique, precision-safe ID by STRING concat (never arithmetic). The length ADAPTS to the configured ID range
 * ([ROSTER_LAYOUT].ID_MIN_DIGITS…ID_MAX_DIGITS) so the suite generates valid IDs whether the live deployment uses
 * Discord snowflakes (17-19) or short Community/CID values (1-8). Prefers an 18-digit ID, clamped into the range.
 */
function devId_(i) {
  let min = 17, max = 19;
  try { if (CONFIG.idMinDigits) min = CONFIG.idMinDigits; if (CONFIG.idMaxDigits) max = CONFIG.idMaxDigits; } catch (e) {}
  const len = Math.min(Math.max(18, min), max); // prefer 18 (Discord-like), clamped into the configured range
  const bodyLen = Math.max(1, len - 1);
  let body = String(i);
  while (body.length < bodyLen) body = `0${body}`;
  return `1${body.slice(-bodyLen)}`; // leading '1' + last (len-1) digits of i → exactly `len` digits, all distinct
}

/** An ID that is INVALID under any digit-range config (non-numeric) — for "rejects a malformed ID" assertions. */
function devBadId_() { return 'not-an-id'; }

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

/** Sandbox tracker (LOA-only layout): data from CONFIG.trackerStartRow. leaves:{key,rank,unit,ooc,name,id,shift,start,end,status}. `type` is accepted but ignored — no TYPE column. */
function devBuildTracker_(leaves) {
  const sh = devFreshSheet_('Tracker');
  const hr = Math.max(1, CONFIG.trackerStartRow - 2); // label row; mirrors the real layout (banner 5 / label 6 / divider 7 / data 8)
  // A key · B rank · C unit · D OOC · E name · F unique-ID · G shift · H start · I end · J len · K until · L left · M return · N status · O approved · P notes
  sh.getRange(hr, 1, 1, 16).setValues([['KEY', 'RANK', 'UNIT', 'OOC', 'NAME', 'DISCORD', 'SHIFT', 'START', 'END', 'LEN', 'UNTIL', 'LEFT', 'RETURN', 'STATUS', 'APPROVED', 'NOTES']]);
  if (leaves.length) {
    const rows = leaves.map((L) => [
      L.key ?? '', L.rank ?? 'Trooper', L.unit ?? '', L.ooc ?? '', L.name ?? '', L.id ?? '', L.shift ?? '',
      L.start ?? '', L.end ?? '', '', '', '', '', L.status ?? 'Pending', '', '',
    ]);
    sh.getRange(CONFIG.trackerStartRow, CONFIG.tracker.discord, leaves.length, 1).setNumberFormat('@');
    sh.getRange(CONFIG.trackerStartRow, 1, leaves.length, 16).setValues(rows); // cols A..P
  }
  if (DEV_THEME_SANDBOX) devTheme_(sh, hr, CONFIG.tracker.discord);
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

/** A Date whose TIME portion is h:m (the date part is irrelevant — combineDateTime_ reads only the time). */
function devTime_(h, m) { return new Date(2020, 0, 1, h, m || 0, 0); }

/**
 * Sandbox Patrol Log (the user's layout): label row at patrolStartRow-2, data from patrolStartRow.
 * A mark(hidden) · B RANK · C UNIT NUMBER · D OOC NAME · E NAME · F UNIQUE ID · G SHIFT · H START DATE ·
 * I END DATE · J START TIME · K END TIME · L TOTAL TIME · M STATUS · N NOTES.
 * logs:{id,startDate,startTime,endDate,endTime,status,name,rank,mark,notes}.
 */
function devBuildPatrolLog_(logs) {
  const sh = devFreshSheet_('PatrolLog');
  const hr = Math.max(1, CONFIG.patrolStartRow - 2);
  sh.getRange(hr, 1, 1, 14).setValues([['', 'RANK', 'UNIT NUMBER', 'OOC NAME', 'NAME', 'UNIQUE ID', 'SHIFT', 'START DATE', 'END DATE', 'START TIME', 'END TIME', 'TOTAL TIME', 'STATUS', 'NOTES']]);
  if (logs && logs.length) {
    const rows = logs.map((L) => [
      L.mark ?? '', L.rank ?? '', '', '', L.name ?? '', L.id ?? '', '',
      L.startDate ?? '', L.endDate ?? '', L.startTime ?? '', L.endTime ?? '', '', L.status ?? '', L.notes ?? '',
    ]);
    sh.getRange(CONFIG.patrolStartRow, 6, logs.length, 1).setNumberFormat('@'); // UNIQUE ID exact
    sh.getRange(CONFIG.patrolStartRow, 1, logs.length, 14).setValues(rows);
  }
  if (DEV_THEME_SANDBOX) devTheme_(sh, hr, 6);
  return sh;
}

/** Sandbox signup response tab — the exact shape the Roster Signup form produces, plus the appended Status/Notes. */
function devBuildSignups_(rows) {
  const sh = devFreshSheet_('Signups');
  sh.getRange(1, 1, 1, 13).setValues([['Timestamp', 'Name (in-character)', 'OOC Name', 'Unique ID', 'Email', 'Date of Birth', 'Phone',
    'Prior Experience', 'Timezone', 'Age Confirmation', 'Why do you want to join?', 'Status', 'Notes']]);
  if (rows && rows.length) {
    const out = rows.map((r) => [r.ts ?? devDay_(-1), r.name ?? '', r.ooc ?? '', r.id ?? '', r.email ?? '', r.dob ?? '', r.phone ?? '',
      r.exp ?? '', r.tz ?? '', r.age ?? '', r.why ?? '', r.status ?? '', r.notes ?? '']);
    sh.getRange(2, 4, rows.length, 1).setNumberFormat('@'); // Unique ID exact
    sh.getRange(2, 1, rows.length, 13).setValues(out);
  }
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
    if (isMemberSlot_(ranks[i][0])) { units.push([formatUnit_(counter)]); counter++; } // v1.0: mirror the real formatUnit_
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
    if (!isValidId_(id)) malformed.push(id);
    (seen[id] = seen[id] || []).push(i);
  }
  const duplicates = Object.keys(seen).filter((k) => seen[k].length > 1);
  return { duplicates, malformed };
}

/** Reads a sandbox roster row's activity / a tracker row's status. */
function devActivity_(roster, idx) { return roster.getRange(CONFIG.rosterStartRow + idx, CONFIG.roster.activity).getValue(); }
function devTrackerStatus_(tracker, idx) { return tracker.getRange(CONFIG.trackerStartRow + idx, CONFIG.tracker.status).getValue(); }
function devDataRows_(sheet, startRow) { return Math.max(0, sheet.getLastRow() - startRow + 1); }
/* ============================================================================
 * TEST SECTIONS (rebuilt from the ground up against the current codebase).
 * Every group returns a results collector (devNewResults_). Assertions are
 * anchored to the REAL injectable cores + pure helpers; write-tests run only on
 * 🧪SANDBOX_ tabs. Row/column positions are read from CONFIG (never hardcoded)
 * so a customized live layout can't break the suite.
 * ==========================================================================*/

/* ======================================================================
 * SECTION 1 — UNIT / PURE FUNCTIONS (no sheets)
 * computeStatus_ · parseHours_ · protection · resolveStatus_ · slot/divider
 * detection · dash_/clamp_/formatUnit_/fmtDisplay_ · hexToInt_ · makeLeaveKey_
 * · mention_/webhookChannel_/fill_ · trackerLeaveType_ · column classifier.
 * ====================================================================== */
function devUnitTests_() {
  const R = devNewResults_('Unit / pure functions');

  // --- computeStatus_ default tiers (Active >=10, Semi >=5, Inactive <5) ---
  devEq_(R, 'computeStatus_ Trooper 4.99 -> Inactive', computeStatus_('Trooper', 4.99), 'Inactive');
  devEq_(R, 'computeStatus_ Trooper 5.00 -> Semi-Active', computeStatus_('Trooper', 5), 'Semi-Active');
  devEq_(R, 'computeStatus_ Trooper 9.99 -> Semi-Active', computeStatus_('Trooper', 9.99), 'Semi-Active');
  devEq_(R, 'computeStatus_ Trooper 10.00 -> Active', computeStatus_('Trooper', 10), 'Active');
  devEq_(R, 'computeStatus_ Trooper 10.01 -> Active', computeStatus_('Trooper', 10.01), 'Active');
  devEq_(R, 'computeStatus_ Trooper negative -> Inactive', computeStatus_('Trooper', -3), 'Inactive');

  // --- parseHours_ (number / decimal string / "5h 30m" / junk) ---
  devEq_(R, 'parseHours_ 12 (number)', parseHours_(12), 12);
  devEq_(R, 'parseHours_ 12.5 (number)', parseHours_(12.5), 12.5);
  devEq_(R, 'parseHours_ "8.25" (decimal string)', parseHours_('8.25'), 8.25);
  devEq_(R, 'parseHours_ "5h 30m" -> 5.5', parseHours_('5h 30m'), 5.5);
  devEq_(R, 'parseHours_ "8h 15m" -> 8.25', parseHours_('8h 15m'), 8.25);
  devEq_(R, 'parseHours_ null -> 0', parseHours_(null), 0);
  devEq_(R, 'parseHours_ undefined -> 0', parseHours_(undefined), 0);
  devEq_(R, 'parseHours_ boolean -> 0', parseHours_(true), 0);
  devEq_(R, 'parseHours_ object -> 0', parseHours_({}), 0);
  devEq_(R, 'parseHours_ non-numeric string -> 0', parseHours_('n/a'), 0);

  // --- protection + resolveStatus_ (forced SHIPPED default vocabulary so ROA/Reserve are protected + ROA is the
  //     return status regardless of the operator's live [STATUSES]/[LEAVE] customizations) ---
  devWithConfig_({}, () => {
  devEq_(R, 'isProtectedStatus_ LOA', isProtectedStatus_('LOA'), true);
  devEq_(R, 'isProtectedStatus_ ROA', isProtectedStatus_('ROA'), true);
  devEq_(R, 'isProtectedStatus_ Reserve', isProtectedStatus_('Reserve'), true);
  devEq_(R, 'isProtectedStatus_ Active -> false', isProtectedStatus_('Active'), false);
  devEq_(R, 'isProtectedStatus_ empty -> false', isProtectedStatus_(''), false);
  devEq_(R, 'isReturningStatus_ ROA (default return status)', isReturningStatus_('ROA'), true);
  devEq_(R, 'isReturningStatus_ LOA -> false', isReturningStatus_('LOA'), false);
  devEq_(R, 'resolveStatus_ LOA -> null (protected)', resolveStatus_('Trooper', 'LOA', 0), null);
  devEq_(R, 'resolveStatus_ Reserve -> null (protected)', resolveStatus_('Trooper', 'Reserve', 20), null);
  devEq_(R, 'resolveStatus_ ROA 3h (<semi) -> Inactive', resolveStatus_('Senior Trooper', 'ROA', 3), 'Inactive');
  devEq_(R, 'resolveStatus_ ROA 5h (=semi) -> null (stays ROA)', resolveStatus_('Senior Trooper', 'ROA', 5), null);
  devEq_(R, 'resolveStatus_ ROA 6h -> null (stays ROA)', resolveStatus_('Senior Trooper', 'ROA', 6), null);
  devEq_(R, 'resolveStatus_ Active 12h -> Active', resolveStatus_('Trooper', 'Active', 12), 'Active');
  devEq_(R, 'resolveStatus_ Active 3h -> Inactive', resolveStatus_('Trooper', 'Active', 3), 'Inactive');
  });

  // --- slot / divider / member-value detection (ALL-CAPS length>3 heuristic) ---
  devEq_(R, 'isDividerValue_ "DEPARTMENT MEMBERS" -> true', isDividerValue_('DEPARTMENT MEMBERS'), true);
  devEq_(R, 'isDividerValue_ "Trooper" -> false (mixed case)', isDividerValue_('Trooper'), false);
  devEq_(R, 'isDividerValue_ "" -> false', isDividerValue_(''), false);
  devEq_(R, 'isDividerValue_ null -> false', isDividerValue_(null), false);
  devEq_(R, 'isDividerValue_ "K9" (2 caps) -> false', isDividerValue_('K9'), false);
  devEq_(R, 'isDividerValue_ "SGT" (3 caps) -> false', isDividerValue_('SGT'), false);
  devEq_(R, 'isDividerValue_ "SSGT" (4 caps) -> true (divider)', isDividerValue_('SSGT'), true);
  devEq_(R, 'isMemberSlot_ "K9" -> true (short caps is a slot)', isMemberSlot_('K9'), true);
  devEq_(R, 'isMemberSlot_ "SGT" -> true', isMemberSlot_('SGT'), true);
  devEq_(R, 'isMemberSlot_ ALL-CAPS divider -> false', isMemberSlot_('EXECUTIVE COMMAND'), false);
  devEq_(R, 'isMemberSlot_ empty -> false', isMemberSlot_(''), false);
  devEq_(R, 'isValidMemberValues_ rank+name -> true', isValidMemberValues_('Trooper', 'John Doe'), true);
  devEq_(R, 'isValidMemberValues_ empty name -> false', isValidMemberValues_('Trooper', ''), false);
  devEq_(R, 'isValidMemberValues_ null name -> false', isValidMemberValues_('Trooper', null), false);
  devEq_(R, 'isValidMemberValues_ divider+text -> false', isValidMemberValues_('DEPARTMENT MEMBERS', 'x'), false);
  devEq_(R, 'isValidMemberValues_ "Rank" placeholder -> false', isValidMemberValues_('Rank', 'x'), false);
  devEq_(R, 'isValidMemberValues_ "UNIT" (4-caps divider)+name -> false', isValidMemberValues_('UNIT', 'x'), false);

  // --- training-divider label detection (default keywords TRAINING / CADET) ---
  devEq_(R, 'isTrainingDividerLabel_ "STAFF IN TRAINING" -> true', isTrainingDividerLabel_('STAFF IN TRAINING'), true);
  devEq_(R, 'isTrainingDividerLabel_ "POLICE CADETS" -> true', isTrainingDividerLabel_('POLICE CADETS'), true);
  devEq_(R, 'isTrainingDividerLabel_ "EXECUTIVE COMMAND" -> false', isTrainingDividerLabel_('EXECUTIVE COMMAND'), false);

  // --- dash_ / clamp_ ---
  devEq_(R, 'dash_ "" -> em-dash', dash_(''), '—');
  devEq_(R, 'dash_ null -> em-dash', dash_(null), '—');
  devEq_(R, 'dash_ undefined -> em-dash', dash_(undefined), '—');
  devEq_(R, 'dash_ whitespace -> em-dash', dash_('   '), '—');
  devEq_(R, 'dash_ value preserved (trimmed)', dash_('  Bob  '), 'Bob');
  devEq_(R, 'dash_ 0 -> "0" (zero is a value)', dash_(0), '0');
  devEq_(R, 'clamp_ under limit unchanged', clamp_('hello', 10), 'hello');
  devEq_(R, 'clamp_ exactly at limit unchanged', clamp_('hello', 5), 'hello');
  devEq_(R, 'clamp_ over limit -> (n-1) chars + ellipsis', clamp_('hello', 4), 'hel…');
  devEq_(R, 'clamp_ null -> "" (coalesced)', clamp_(null, 5), '');

  // --- formatUnit_ (default "S-{00}") ---
  devEq_(R, 'formatUnit_ 1 -> S-01', formatUnit_(1), 'S-01');
  devEq_(R, 'formatUnit_ 9 -> S-09', formatUnit_(9), 'S-09');
  devEq_(R, 'formatUnit_ 10 -> S-10 (padding boundary)', formatUnit_(10), 'S-10');
  devEq_(R, 'formatUnit_ 99 -> S-99', formatUnit_(99), 'S-99');
  devEq_(R, 'formatUnit_ 100 -> S-100 (scales past 99)', formatUnit_(100), 'S-100');

  // --- fmtDisplay_ / fmtTs_ (fault-tolerant; never throw) ---
  const d = new Date(2026, 0, 15, 13, 30, 0);
  let dispOk = true, tsOk = true;
  try { dispOk = String(fmtDisplay_(d)).indexOf('2026') !== -1; } catch (e) { dispOk = false; }
  try { tsOk = String(fmtTs_(d)).indexOf('2026') !== -1; } catch (e) { tsOk = false; }
  devCheck_(R, 'fmtDisplay_ renders a date containing the year (no throw)', dispOk);
  devCheck_(R, 'fmtTs_ renders a timestamp containing the year (no throw)', tsOk);

  // --- hexToInt_ ---
  devEq_(R, 'hexToInt_ #4ea7d6 -> 5154774', hexToInt_('#4ea7d6', 0), 5154774);
  devEq_(R, 'hexToInt_ no-hash 4ea7d6 -> 5154774', hexToInt_('4ea7d6', 0), 5154774);
  devEq_(R, 'hexToInt_ malformed -> default', hexToInt_('nope', 999), 999);
  devEq_(R, 'hexToInt_ null -> default', hexToInt_(null, 7), 7);

  // --- makeLeaveKey_ / buildSyncedKeySet_ key shape ---
  devEq_(R, 'makeLeaveKey_ string ts', makeLeaveKey_('123', 'abc'), 'KEY|123|abc');
  devEq_(R, 'makeLeaveKey_ Date ts uses ms', makeLeaveKey_('123', new Date(0)), 'KEY|123|0');
  devEq_(R, 'makeLeaveKey_ trims id', makeLeaveKey_('  123 ', 'x'), 'KEY|123|x');
  devEq_(R, 'makeLeaveKey_ empty id -> ""', makeLeaveKey_('', 'x'), '');
  const badKey = makeLeaveKey_('123', new Date('not-a-date'));
  devCheck_(R, 'makeLeaveKey_ Invalid Date -> starts "KEY|123|"', badKey.indexOf('KEY|123|') === 0, badKey);
  devCheck_(R, 'makeLeaveKey_ Invalid Date -> no "NaN" in key', badKey.indexOf('NaN') === -1, badKey);

  // --- startOfDay_ / todayInSheetTz_ ---
  const sod = startOfDay_(new Date(2026, 2, 15, 23, 59, 59));
  devCheck_(R, 'startOfDay_ zeroes the clock', sod.getHours() === 0 && sod.getMinutes() === 0 && sod.getSeconds() === 0);
  const tod = todayInSheetTz_();
  devCheck_(R, 'todayInSheetTz_ is a midnight Date', tod instanceof Date && tod.getHours() === 0 && tod.getMinutes() === 0);

  // --- mention_ (gate is the STRICT Discord snowflake DISCORD_ID_RE, independent of the configurable ID range —
  //     a short Community ID is NOT a pingable snowflake, so use a literal 18-digit Discord ID here) ---
  const goodId = '110000000000000001';
  devCheck_(R, 'mention_ valid 18-digit Discord ID -> "<@id>" ping', mention_(goodId).indexOf('<@' + goodId + '>') === 0, mention_(goodId));
  devCheck_(R, 'mention_ 16-digit ID -> no ping', mention_('1234567890123456').indexOf('<@') === -1);
  devCheck_(R, 'mention_ short Community ID -> no ping (not a snowflake)', mention_('12345').indexOf('<@') === -1);
  devCheck_(R, 'mention_ non-numeric ID -> no ping', mention_('not-an-id').indexOf('<@') === -1);

  // --- webhookChannel_ normalization (unknown -> LOA) ---
  devEq_(R, 'webhookChannel_ "audit" -> AUDIT', webhookChannel_('audit'), 'AUDIT');
  devEq_(R, 'webhookChannel_ "  patrol " -> PATROL', webhookChannel_('  patrol '), 'PATROL');
  devEq_(R, 'webhookChannel_ "errors" -> ERRORS', webhookChannel_('errors'), 'ERRORS');
  devEq_(R, 'webhookChannel_ unknown -> LOA', webhookChannel_('nope'), 'LOA');
  devEq_(R, 'webhookChannel_ empty -> LOA', webhookChannel_(''), 'LOA');

  // --- fill_ template interpolation ---
  devEq_(R, 'fill_ replaces a known token', fill_('Hi {name}', { name: 'Bob' }), 'Hi Bob');
  devEq_(R, 'fill_ leaves an unknown token', fill_('{a} {b}', { a: 'x' }), 'x {b}');
  devEq_(R, 'fill_ null template -> ""', fill_(null, {}), '');

  // --- trackerLeaveType_ (LOA-only: first configured leave type) ---
  devEq_(R, 'trackerLeaveType_ = first configured leave type', trackerLeaveType_(), (CONFIG.leaveTypes && CONFIG.leaveTypes[0]) || 'LOA');

  // --- column classifier (SLOT stays with the position; MEMBER follows the person) ---
  devEq_(R, 'defaultColumnClass_ RANK -> SLOT', defaultColumnClass_(colKey_('Rank')), 'SLOT');
  devEq_(R, 'defaultColumnClass_ RANK GROUP -> SLOT', defaultColumnClass_(colKey_('Rank Group')), 'SLOT');
  devEq_(R, 'defaultColumnClass_ UNIT NUMBER -> SLOT', defaultColumnClass_(colKey_('Unit Number')), 'SLOT');
  devEq_(R, 'defaultColumnClass_ CALLSIGN -> SLOT', defaultColumnClass_(colKey_('Callsign')), 'SLOT');
  devEq_(R, 'defaultColumnClass_ NAME -> MEMBER', defaultColumnClass_(colKey_('Name')), 'MEMBER');
  devEq_(R, 'defaultColumnClass_ UNIQUE ID -> MEMBER', defaultColumnClass_(colKey_('Unique ID')), 'MEMBER');
  devEq_(R, 'defaultColumnClass_ COMMUNITY ID -> MEMBER (UNIT needs a word boundary)', defaultColumnClass_(colKey_('Community ID')), 'MEMBER');
  devEq_(R, 'colKey_ uppercases + trims', colKey_('  Unique Id  '), 'UNIQUE ID');

  // --- devId_ generator sanity (precision-safe unique IDs) ---
  const idset = {}; let dupes = 0;
  for (let i = 0; i < 1005; i++) { const id = devId_(i); if (idset[id]) dupes++; idset[id] = true; }
  devEq_(R, 'devId_ generates 1005 unique IDs', dupes, 0);
  devCheck_(R, 'devId_ IDs all pass the configured ID validation', Object.keys(idset).every((k) => isValidId_(k)));

  // --- isValidId_ / idDigitsLabel_ / idRegexSource_ (CONFIGURABLE Unique-ID length: 17-19 Discord default, 1-8 Community/CID) ---
  devWithConfig_({}, () => {
    devEq_(R, 'idDigitsLabel_ default is "17-19"', idDigitsLabel_(), '17-19');
    devCheck_(R, 'isValidId_ accepts a valid 18-digit ID (default)', isValidId_('110000000000000001'));
    devCheck_(R, 'isValidId_ rejects a 16-digit ID (default)', !isValidId_('1234567890123456'));
    devCheck_(R, 'isValidId_ rejects a short 5-digit ID (default)', !isValidId_('12345'));
    devCheck_(R, 'isValidId_ rejects a non-numeric ID', !isValidId_('not-an-id'));
    devCheck_(R, 'isValidId_ rejects blank / whitespace', !isValidId_('') && !isValidId_('   '));
  });
  // ID_TYPE switch: COMMUNITY preset forces the 1-8 range regardless of the ID_MIN/MAX_DIGITS keys.
  devWithConfig_({ ROSTER_LAYOUT: { kind: 'kv', kv: { ID_TYPE: 'COMMUNITY' } } }, () => {
    devEq_(R, 'ID_TYPE=COMMUNITY materializes idType', CONFIG.idType, 'COMMUNITY');
    devEq_(R, 'idDigitsLabel_ Community range is "1-8"', idDigitsLabel_(), '1-8');
    devCheck_(R, 'isValidId_ accepts a 1-digit Community ID', isValidId_('7'));
    devCheck_(R, 'isValidId_ accepts an 8-digit Community ID', isValidId_('12345678'));
    devCheck_(R, 'isValidId_ rejects a 9-digit ID (over max)', !isValidId_('123456789'));
    devCheck_(R, 'isValidId_ rejects an 18-digit Discord ID (over max)', !isValidId_('110000000000000001'));
    devCheck_(R, 'idRegexSource_ builds the ^\\d{1,8}$ pattern', idRegexSource_() === '^\\d{1,8}$');
  });
  // COMMUNITY ignores explicit min/max; only CUSTOM honours them.
  devWithConfig_({ ROSTER_LAYOUT: { kind: 'kv', kv: { ID_TYPE: 'COMMUNITY', ID_MIN_DIGITS: 4, ID_MAX_DIGITS: 6 } } }, () => {
    devEq_(R, 'ID_TYPE=COMMUNITY ignores ID_MIN/MAX (stays 1-8)', idDigitsLabel_(), '1-8');
  });
  devWithConfig_({ ROSTER_LAYOUT: { kind: 'kv', kv: { ID_TYPE: 'CUSTOM', ID_MIN_DIGITS: 4, ID_MAX_DIGITS: 6 } } }, () => {
    devEq_(R, 'ID_TYPE=CUSTOM honours ID_MIN/MAX -> "4-6"', idDigitsLabel_(), '4-6');
    devCheck_(R, 'ID_TYPE=CUSTOM accepts a 5-digit ID', isValidId_('12345'));
    devCheck_(R, 'ID_TYPE=CUSTOM rejects a 7-digit ID', !isValidId_('1234567'));
  });

  return R;
}

/* ======================================================================
 * SECTION 2 — STATUS ENGINE (sandbox): recomputeStatuses_ (batch + zero-hours
 * reset) and updateStatusFromHours (per-row onEdit path).
 * ====================================================================== */
function devStatusTests_() {
  const R = devNewResults_('Status engine (sandbox)');
  // Force the SHIPPED default status vocabulary (LOA/ROA/Reserve protected, ROA = return status) so protection is
  // tested deterministically, independent of the operator's live [STATUSES] customizations (e.g. an LOA-only setup).
  devWithConfig_({}, () => {

  // --- batch recompute: tiers, protection, ROA return, dividers, empty slots ---
  const ro = devBuildRoster_([
    { rank: 'Trooper', name: 'Act12', id: devId_(1), activity: 'Inactive', hours: 12 },      // 0 -> Active
    { rank: 'Trooper', name: 'Semi7', id: devId_(2), activity: 'Active', hours: 7 },          // 1 -> Semi-Active
    { rank: 'Trooper', name: 'Ina2', id: devId_(3), activity: 'Active', hours: 2 },           // 2 -> Inactive
    { rank: 'Trooper', name: 'OnLOA', id: devId_(4), activity: 'LOA', hours: 0 },             // 3 -> protected
    { rank: 'Trooper', name: 'OnRes', id: devId_(5), activity: 'Reserve', hours: 0 },         // 4 -> protected
    { rank: 'Senior Trooper', name: 'RoaLo', id: devId_(6), activity: 'ROA', hours: 3 },      // 5 -> Inactive (ROA<5)
    { rank: 'Senior Trooper', name: 'RoaHi', id: devId_(7), activity: 'ROA', hours: 8 },      // 6 -> stays ROA
    { rank: 'DEPARTMENT MEMBERS', name: '', id: '', activity: '', hours: '' },                // 7 -> divider (skipped)
    { rank: 'Trooper', name: '', id: '', activity: '', hours: '' },                           // 8 -> empty slot (skipped)
  ]);
  const res = recomputeStatuses_(ro, false);
  devEq_(R, 'recompute total = 7 valid members (dividers/empty excluded)', res.total, 7);
  devEq_(R, 'recompute 12h -> Active', devActivity_(ro, 0), 'Active');
  devEq_(R, 'recompute 7h -> Semi-Active', devActivity_(ro, 1), 'Semi-Active');
  devEq_(R, 'recompute 2h -> Inactive', devActivity_(ro, 2), 'Inactive');
  devEq_(R, 'recompute LOA protected', devActivity_(ro, 3), 'LOA');
  devEq_(R, 'recompute Reserve protected', devActivity_(ro, 4), 'Reserve');
  devEq_(R, 'recompute ROA 3h -> Inactive', devActivity_(ro, 5), 'Inactive');
  devEq_(R, 'recompute ROA 8h -> stays ROA', devActivity_(ro, 6), 'ROA');
  devEq_(R, 'recompute divider untouched', devActivity_(ro, 7), '');
  devEq_(R, 'recompute empty slot untouched', devActivity_(ro, 8), '');
  devCheck_(R, 'recompute reports Act12 changed Inactive->Active', res.changed.some((c) => c.name === 'Act12' && c.from === 'Inactive' && c.to === 'Active'));
  devCheck_(R, 'recompute does NOT list a protected LOA member as changed', !res.changed.some((c) => c.name === 'OnLOA'));
  devCheck_(R, 'recompute counts protected members as skipped', res.protectedSkipped >= 2, 'skipped=' + res.protectedSkipped);

  // --- zero-hours reset: hours zeroed, active tiers drop, protected preserved ---
  const ro2 = devBuildRoster_([
    { rank: 'Trooper', name: 'A', id: devId_(11), activity: 'Active', hours: 12 },
    { rank: 'Trooper', name: 'B', id: devId_(12), activity: 'LOA', hours: 0 },
    { rank: 'Senior Trooper', name: 'C', id: devId_(13), activity: 'ROA', hours: 3 },
  ]);
  recomputeStatuses_(ro2, true);
  devEq_(R, 'reset: hours zeroed', ro2.getRange(CONFIG.rosterStartRow, CONFIG.roster.hours).getValue(), 0);
  devEq_(R, 'reset: Active -> Inactive (0h)', devActivity_(ro2, 0), 'Inactive');
  devEq_(R, 'reset: LOA protected', devActivity_(ro2, 1), 'LOA');
  devEq_(R, 'reset: ROA<5 -> Inactive', devActivity_(ro2, 2), 'Inactive');

  // --- per-row updateStatusFromHours (onEdit path): string-hours normalization ---
  const ro3 = devBuildRoster_([{ rank: 'Trooper', name: 'P', id: devId_(21), activity: 'Inactive', hours: '8h 15m' }]);
  updateStatusFromHours(ro3, CONFIG.rosterStartRow);
  devEq_(R, 'per-row: string hours normalized to 8.25', ro3.getRange(CONFIG.rosterStartRow, CONFIG.roster.hours).getValue(), 8.25);
  devEq_(R, 'per-row: 8.25h -> Semi-Active', devActivity_(ro3, 0), 'Semi-Active');

  const ro4 = devBuildRoster_([{ rank: 'Trooper', name: 'L', id: devId_(22), activity: 'LOA', hours: 0 }]);
  updateStatusFromHours(ro4, CONFIG.rosterStartRow);
  devEq_(R, 'per-row: LOA protected', devActivity_(ro4, 0), 'LOA');

  const ro5 = devBuildRoster_([{ rank: 'Senior Trooper', name: 'Rl', id: devId_(23), activity: 'ROA', hours: 3 }]);
  updateStatusFromHours(ro5, CONFIG.rosterStartRow);
  devEq_(R, 'per-row: ROA 3h -> Inactive', devActivity_(ro5, 0), 'Inactive');

  const ro6 = devBuildRoster_([{ rank: 'Senior Trooper', name: 'Rh', id: devId_(24), activity: 'ROA', hours: 8 }]);
  updateStatusFromHours(ro6, CONFIG.rosterStartRow);
  devEq_(R, 'per-row: ROA 8h -> stays ROA', devActivity_(ro6, 0), 'ROA');

  const ro7 = devBuildRoster_([{ rank: 'Trooper', name: 'Bad', id: devId_(25), activity: 'Active', hours: 'abc' }]);
  updateStatusFromHours(ro7, CONFIG.rosterStartRow);
  devEq_(R, 'per-row: non-numeric hours left intact (not zeroed)', ro7.getRange(CONFIG.rosterStartRow, CONFIG.roster.hours).getValue(), 'abc');
  devEq_(R, 'per-row: non-numeric hours -> Inactive', devActivity_(ro7, 0), 'Inactive');

  }); // devWithConfig_ default vocabulary
  return R;
}

/* ======================================================================
 * SECTION 3 — LEAVE LIFECYCLE (sandbox): processDailyLOAs_ expire/start,
 * protection, order-independence, orphans, bulk, blank-ID, LOA-only type.
 * ====================================================================== */
function devLifecycleTests_() {
  const R = devNewResults_('Leave lifecycle (sandbox)');
  const NO_HOOK = { sendWebhooks: false };

  // A: an already-started, future-ending approved leave applies to the roster.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Starter', id: devId_(1), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'Starter', id: devId_(1), start: devDay_(-1), end: devDay_(10), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'A: started leave -> roster LOA (LOA-only implicit type)', devActivity_(ro, 0), 'LOA');
    devEq_(R, 'A: future-end stays Approved', devTrackerStatus_(tr, 0), 'Approved');
  })();

  // B: an ended approved leave expires; a 0h returner recomputes to Inactive.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Ret0', id: devId_(2), activity: 'LOA', hours: 0 }]);
    const tr = devBuildTracker_([{ name: 'Ret0', id: devId_(2), start: devDay_(-10), end: devDay_(-1), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'B: ended leave -> Expired', devTrackerStatus_(tr, 0), 'Expired');
    devEq_(R, 'B: 0h returner -> Inactive (not Active)', devActivity_(ro, 0), 'Inactive');
  })();

  // C: a 15h returner recomputes to Active.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Ret15', id: devId_(3), activity: 'LOA', hours: 15 }]);
    const tr = devBuildTracker_([{ name: 'Ret15', id: devId_(3), start: devDay_(-10), end: devDay_(-1), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'C: 15h returner -> Active', devActivity_(ro, 0), 'Active');
  })();

  // D: a Pending (not Approved) leave never expires and never touches the member.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Pend', id: devId_(4), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'Pend', id: devId_(4), start: devDay_(-10), end: devDay_(-1), status: 'Pending' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'D: pending NOT expired', devTrackerStatus_(tr, 0), 'Pending');
    devEq_(R, 'D: member untouched (Active)', devActivity_(ro, 0), 'Active');
  })();

  // E: a future-start approved leave doesn't apply yet.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Fut', id: devId_(5), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'Fut', id: devId_(5), start: devDay_(3), end: devDay_(10), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'E: future leave -> member stays Active', devActivity_(ro, 0), 'Active');
    devEq_(R, 'E: future leave -> stays Approved', devTrackerStatus_(tr, 0), 'Approved');
  })();

  // F: ends exactly today -> Expired.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Today', id: devId_(6), activity: 'LOA', hours: 0 }]);
    const tr = devBuildTracker_([{ name: 'Today', id: devId_(6), start: devDay_(-5), end: devDay_(0), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'F: ends today -> Expired', devTrackerStatus_(tr, 0), 'Expired');
  })();

  // G: starts exactly today -> activated to LOA.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Start', id: devId_(7), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'Start', id: devId_(7), start: devDay_(0), end: devDay_(10), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'G: starts today -> roster LOA', devActivity_(ro, 0), 'LOA');
  })();

  // H: an already-Expired leave is left alone (idempotent).
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Done', id: devId_(8), activity: 'Inactive', hours: 2 }]);
    const tr = devBuildTracker_([{ name: 'Done', id: devId_(8), start: devDay_(-20), end: devDay_(-10), status: 'Expired' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'H: Expired stays Expired', devTrackerStatus_(tr, 0), 'Expired');
    devEq_(R, 'H: member untouched (Inactive)', devActivity_(ro, 0), 'Inactive');
  })();

  // I: idempotent -> a second run makes no further change.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Idem', id: devId_(9), activity: 'LOA', hours: 8 }]);
    const tr = devBuildTracker_([{ name: 'Idem', id: devId_(9), start: devDay_(-10), end: devDay_(-1), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    const s1 = devActivity_(ro, 0), st1 = devTrackerStatus_(tr, 0);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'I: 8h returner -> Semi-Active', s1, 'Semi-Active');
    devEq_(R, 'I: idempotent activity (2nd run identical)', devActivity_(ro, 0), s1);
    devEq_(R, 'I: idempotent status (2nd run identical)', devTrackerStatus_(tr, 0), st1);
  })();

  // J: an expiring leave does NOT overwrite a member's DIFFERENT current protected status (Reserve).
  // Forces the default vocabulary so "Reserve" is a PROTECTED status regardless of the live (LOA-only) config.
  devWithConfig_({}, () => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Keep', id: devId_(10), activity: 'Reserve', hours: 0 }]);
    const tr = devBuildTracker_([{ name: 'Keep', id: devId_(10), start: devDay_(-20), end: devDay_(-1), status: 'Approved' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'J: expiring leave does not overwrite current Reserve', devActivity_(ro, 0), 'Reserve');
  });

  // K: order-independence -> a leave STARTING today wins over a different leave EXPIRING today.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Ovl', id: devId_(11), activity: 'LOA', hours: 0 }]);
    const tr = devBuildTracker_([
      { name: 'Ovl', id: devId_(11), start: devDay_(0), end: devDay_(10), status: 'Approved' },   // row 0: starts today
      { name: 'Ovl', id: devId_(11), start: devDay_(-10), end: devDay_(0), status: 'Approved' },  // row 1: expires today
    ]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'K: starting leave wins over same-day expiry (member LOA, not Inactive)', devActivity_(ro, 0), 'LOA');
    devEq_(R, 'K: expiring row -> Expired', devTrackerStatus_(tr, 1), 'Expired');
    devEq_(R, 'K: starting row stays Approved', devTrackerStatus_(tr, 0), 'Approved');
  })();

  // L: an orphan leave (member not on the roster) still expires and is counted; present members untouched.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Here', id: devId_(12), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'Ghost', id: devId_(9999999), start: devDay_(-10), end: devDay_(-1), status: 'Approved' }]);
    const s = processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'L: orphan leave still Expired', devTrackerStatus_(tr, 0), 'Expired');
    devEq_(R, 'L: present member untouched', devActivity_(ro, 0), 'Active');
    devEq_(R, 'L: summary counts the expiry', s.expired.length, 1);
  })();

  // M: bulk (50 leaves) expires without timeout; spot-check ends.
  (() => {
    const members = [], leaves = [];
    for (let i = 0; i < 50; i++) {
      members.push({ rank: 'Trooper', name: 'Bulk' + i, id: devId_(100 + i), activity: 'LOA', hours: 0 });
      leaves.push({ name: 'Bulk' + i, id: devId_(100 + i), start: devDay_(-10), end: devDay_(-1), status: 'Approved' });
    }
    const ro = devBuildRoster_(members);
    const tr = devBuildTracker_(leaves);
    const s = processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'M: all 50 expired', s.expired.length, 50);
    devEq_(R, 'M: first -> Inactive (0h)', devActivity_(ro, 0), 'Inactive');
    devEq_(R, 'M: 50th -> Inactive (0h)', devActivity_(ro, 49), 'Inactive');
  })();

  // N: a blank-Discord-ID leave row is skipped (never expired / counted).
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'P', id: devId_(60), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'BlankId', id: '', start: devDay_(-10), end: devDay_(-1), status: 'Approved' }]);
    const s = processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'N: blank-ID leave NOT expired', devTrackerStatus_(tr, 0), 'Approved');
    devEq_(R, 'N: blank-ID leave not counted', s.expired.length, 0);
  })();

  // O: full form -> sync -> approve -> process, matched by EXACT ID (no Number coercion).
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Chain', id: devId_(70), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([]);
    syncFormToTracker_(devBuildForm_([{ ts: devDay_(0), name: 'Chain', id: devId_(70), callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(-1), end: devDay_(10) }]), tr, NO_HOOK);
    tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.status).setValue('Approved'); // sync writes Pending; approve it
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'O: sync->process matches by exact ID -> roster LOA', devActivity_(ro, 0), 'LOA');
  })();

  return R;
}

/* ======================================================================
 * SECTION 4 — FORM SYNC & DEDUP (sandbox): syncFormToTracker_ append into the
 * NEW 16-col LOA-only layout (gap-safe append, computed formulas, exact IDs,
 * date-coercion immunity, LOA-only reject) + buildSyncedKeySet_.
 * ====================================================================== */
function devSyncTests_() {
  const R = devNewResults_('Form sync & dedup (sandbox)');
  const NO_HOOK = { sendWebhooks: false };

  // Append-once + gap-safe row placement + new-layout columns + exact ID + KEY.
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([{ ts: devDay_(-1), name: 'Filer', id: devId_(1), callsign: 'S-9', rank: 'Sergeant', type: 'LOA', start: devDay_(2), end: devDay_(9) }]);
    syncFormToTracker_(form, tr, NO_HOOK);
    devEq_(R, 'sync appended exactly one row', devDataRows_(tr, CONFIG.trackerStartRow), 1);
    devEq_(R, 'gap-safe: first row lands at trackerStartRow (past the row-7 divider)', tr.getLastRow(), CONFIG.trackerStartRow);
    const row = CONFIG.trackerStartRow;
    devCheck_(R, 'col A holds a KEY| dedup key', String(tr.getRange(row, CONFIG.tracker.key).getValue()).indexOf('KEY|') === 0);
    devEq_(R, 'NAME written to col E (name)', tr.getRange(row, CONFIG.tracker.name).getDisplayValue(), 'Filer');
    devEq_(R, 'RANK written to col B', tr.getRange(row, CONFIG.tracker.rank).getDisplayValue(), 'Sergeant');
    devEq_(R, 'UNIT/callsign written to col C', tr.getRange(row, CONFIG.tracker.unit).getDisplayValue(), 'S-9');
    devEq_(R, 'STATUS defaults to Pending (col N)', tr.getRange(row, CONFIG.tracker.status).getDisplayValue(), CONFIG.pendingStatus);
    devEq_(R, 'Unique ID exact text at col F (not coerced)', tr.getRange(row, CONFIG.tracker.discord).getDisplayValue(), devId_(1));
    // Computed columns get formulas (length / until / left / return).
    devCheck_(R, 'LENGTH col has an INT()-wrapped formula', tr.getRange(row, CONFIG.tracker.length).getFormula().indexOf('INT(') !== -1);
    devCheck_(R, 'TIME-UNTIL col has a formula', tr.getRange(row, CONFIG.tracker.untilStart).getFormula().indexOf('TODAY(') !== -1);
    devCheck_(R, 'TIME-LEFT col has a formula', tr.getRange(row, CONFIG.tracker.timeLeft).getFormula().indexOf('TODAY(') !== -1);
    devCheck_(R, 'RETURN-DATE col has an end+1 formula', tr.getRange(row, CONFIG.tracker.returnDate).getFormula().indexOf('+1') !== -1);
    // OOC/shift auto-fill: the sandbox member is not on the REAL roster, so these are blank (wiring runs, no crash).
    devEq_(R, 'OOC col blank when member not on the real roster', tr.getRange(row, CONFIG.tracker.ooc).getDisplayValue(), '');
    devEq_(R, 'SHIFT col blank when member not on the real roster', tr.getRange(row, CONFIG.tracker.shift).getDisplayValue(), '');
  })();

  // Idempotency: a re-run with the same timestamp does NOT duplicate, even if stored dates are later corrupted.
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([{ ts: devDay_(-1), name: 'X', id: devId_(2), callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]);
    syncFormToTracker_(form, tr, NO_HOOK);
    tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.end).setValue('garbage-not-a-date');
    form.getRange(2, 1, 1, 8).setBackground('#ffffff'); // clear the "done" colour -> rely on the KEY for dedup
    syncFormToTracker_(form, tr, NO_HOOK);
    devEq_(R, 'rerun did NOT duplicate (timestamp key, date-coercion immune)', devDataRows_(tr, CONFIG.trackerStartRow), 1);
  })();

  // A genuinely NEW submission (new timestamp) IS appended.
  (() => {
    const tr = devBuildTracker_([]);
    syncFormToTracker_(devBuildForm_([{ ts: devDay_(-2), name: 'Y', id: devId_(3), callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(1), end: devDay_(5) }]), tr, NO_HOOK);
    const form2 = devBuildForm_([{ ts: devDay_(-1), name: 'Y', id: devId_(3), callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(6), end: devDay_(9) }]);
    syncFormToTracker_(form2, tr, NO_HOOK);
    devEq_(R, 'new submission (new ts) -> second row appended', devDataRows_(tr, CONFIG.trackerStartRow), 2);
  })();

  // LOA-only: an ROA form submission is rejected (marked error), never appended.
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([{ ts: devDay_(0), name: 'Roa', id: devId_(4), callsign: 'S-4', rank: 'Trooper', type: 'ROA', start: devDay_(2), end: devDay_(9) }]);
    syncFormToTracker_(form, tr, NO_HOOK);
    devCheck_(R, 'LOA-only: ROA submission NOT appended', tr.getLastRow() < CONFIG.trackerStartRow);
    devEq_(R, 'LOA-only: ROA submission row marked error', form.getRange(2, 1).getBackground().toLowerCase(), String(CONFIG.bg.error).toLowerCase());
  })();

  // Missing dates -> error, no append.
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([{ ts: devDay_(0), name: 'NoDate', id: devId_(5), callsign: 'S-5', rank: 'Trooper', type: 'LOA' }]);
    syncFormToTracker_(form, tr, NO_HOOK);
    devCheck_(R, 'missing dates -> nothing appended', tr.getLastRow() < CONFIG.trackerStartRow);
    devEq_(R, 'missing dates -> row marked error', form.getRange(2, 1).getBackground().toLowerCase(), String(CONFIG.bg.error).toLowerCase());
  })();

  // Unique-ID length boundaries under the DEFAULT (Discord 17-19) range: 16 rejected, 20 rejected, whitespace rejected, 17 accepted.
  devWithConfig_({}, () => {
    const mk = (id) => { const tr = devBuildTracker_([]); syncFormToTracker_(devBuildForm_([{ ts: devDay_(0), name: 'B', id: id, callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]), tr, NO_HOOK); return tr; };
    devCheck_(R, '16-digit ID rejected (Discord range)', mk('1234567890123456').getLastRow() < CONFIG.trackerStartRow);
    devCheck_(R, '20-digit ID rejected (Discord range)', mk('12345678901234567890').getLastRow() < CONFIG.trackerStartRow);
    devCheck_(R, 'whitespace-only ID rejected', mk('   ').getLastRow() < CONFIG.trackerStartRow);
    devEq_(R, '17-digit ID accepted -> one row', devDataRows_(mk('12345678901234567'), CONFIG.trackerStartRow), 1);
  });

  // CONFIGURABLE ID range — a Community/CID department ([ID_TYPE]=COMMUNITY → 1-8): a short ID is accepted, a Discord-length one is rejected.
  devWithConfig_({ ROSTER_LAYOUT: { kind: 'kv', kv: { ID_TYPE: 'COMMUNITY' } } }, () => {
    const mk = (id) => { const tr = devBuildTracker_([]); syncFormToTracker_(devBuildForm_([{ ts: devDay_(0), name: 'C', id: id, callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]), tr, NO_HOOK); return tr; };
    devEq_(R, 'Community range: 5-digit ID accepted -> one row', devDataRows_(mk('12345'), CONFIG.trackerStartRow), 1);
    devCheck_(R, 'Community range: 1-digit ID accepted', devDataRows_(mk('7'), CONFIG.trackerStartRow) === 1);
    devCheck_(R, 'Community range: 18-digit ID rejected', mk('110000000000000001').getLastRow() < CONFIG.trackerStartRow);
  });

  // Reversed dates (end before start): no crash, still appends a row.
  (() => {
    const tr = devBuildTracker_([]);
    let threw = false;
    try { syncFormToTracker_(devBuildForm_([{ ts: devDay_(0), name: 'Rev', id: devId_(6), callsign: 'S-6', rank: 'Trooper', type: 'LOA', start: devDay_(10), end: devDay_(2) }]), tr, NO_HOOK); } catch (e) { threw = true; }
    devCheck_(R, 'reversed dates do not crash', !threw);
    devEq_(R, 'reversed dates still append a row', devDataRows_(tr, CONFIG.trackerStartRow), 1);
  })();

  // F-035: a hand-entered ISO string date must not shift a day.
  (() => {
    const tr = devBuildTracker_([]);
    const sStr = Utilities.formatDate(devDay_(3), ssTz_(), 'yyyy-MM-dd');
    syncFormToTracker_(devBuildForm_([{ ts: devDay_(0), name: 'Str', id: devId_(7), callsign: 'S-7', rank: 'Trooper', type: 'LOA', start: sStr, end: Utilities.formatDate(devDay_(10), ssTz_(), 'yyyy-MM-dd') }]), tr, NO_HOOK);
    const stored = Utilities.formatDate(new Date(tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.start).getValue()), ssTz_(), 'yyyy-MM-dd');
    devEq_(R, 'F-035: string start date does not shift a day', stored, sStr);
  })();

  // parseFormDate_ pure behavior.
  (() => {
    const d5 = devDay_(5);
    devEq_(R, 'parseFormDate_ Date passthrough', parseFormDate_(d5).getTime(), d5.getTime());
    devCheck_(R, 'parseFormDate_ empty -> Invalid Date', isNaN(parseFormDate_('').getTime()));
  })();

  // buildSyncedKeySet_ only honors KEY| rows.
  (() => {
    const tr = devBuildTracker_([
      { key: 'KEY|111|999', name: 'A', id: devId_(8), status: 'Approved' },
      { key: '104', name: 'B', id: devId_(9), status: 'Approved' }, // legacy numeric col-A -> ignored
    ]);
    const set = buildSyncedKeySet_(tr);
    devEq_(R, 'syncedKeySet includes a KEY| row', set['KEY|111|999'], true);
    devEq_(R, 'syncedKeySet ignores a non-KEY col-A value', set['104'], undefined);
  })();

  // sortTracker_ groups leaves by STATUS_FLOW order (Pending, Approved, Denied, Expired); a prepend seats a new one on top.
  (() => {
    const tr = devBuildTracker_([
      { name: 'Exp', id: devId_(80), start: devDay_(-10), end: devDay_(-1), status: 'Expired' },
      { name: 'Pend', id: devId_(81), start: devDay_(1), end: devDay_(5), status: 'Pending' },
      { name: 'Appr', id: devId_(82), start: devDay_(-1), end: devDay_(5), status: 'Approved' },
      { name: 'Den', id: devId_(83), start: devDay_(1), end: devDay_(5), status: 'Denied' },
    ]);
    sortTracker_(null, tr);
    devEq_(R, 'sortTracker_ row0 = Pending', devTrackerStatus_(tr, 0), 'Pending');
    devEq_(R, 'sortTracker_ row1 = Approved', devTrackerStatus_(tr, 1), 'Approved');
    devEq_(R, 'sortTracker_ row2 = Denied', devTrackerStatus_(tr, 2), 'Denied');
    devEq_(R, 'sortTracker_ row3 = Expired', devTrackerStatus_(tr, 3), 'Expired');
    devEq_(R, 'sortTracker_ keeps the ID exact after reorder', tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.discord).getDisplayValue(), devId_(81));
    devCheck_(R, 'sortTracker_ regenerates the LENGTH formula on the moved row', tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.length).getFormula().indexOf('INT(') !== -1);
    // prepend a brand-new Pending -> it lands at the very top of the Pending group
    sortTracker_(['KEY|new|1', 'Trooper', 'S-1', '', 'NewOne', devId_(84), 'Day', devDay_(2), devDay_(6), '', '', '', '', 'Pending', '', ''], tr);
    devEq_(R, 'sortTracker_ prepend -> new Pending at the very top', tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.name).getDisplayValue(), 'NewOne');
    devEq_(R, 'sortTracker_ prepend -> total is now 5 rows', devDataRows_(tr, CONFIG.trackerStartRow), 5);
  })();

  // Deleting a leave (clearing its row) leaves a blank gap; sortTracker_ compacts the survivors up to the top with no gap.
  (() => {
    const tr = devBuildTracker_([
      { name: 'Top', id: devId_(85), start: devDay_(1), end: devDay_(5), status: 'Pending' },
      { name: 'Mid', id: devId_(86), start: devDay_(-1), end: devDay_(5), status: 'Approved' },
      { name: 'Low', id: devId_(87), start: devDay_(-9), end: devDay_(-1), status: 'Expired' },
    ]);
    const start = CONFIG.trackerStartRow, TC = trackerCols_(tr);
    tr.getRange(start, 1, 1, TC.width).clearContent();          // simulate deleting the TOP leave → a blank row at the start
    devCheck_(R, 'delete: top row is blank before compaction', String(tr.getRange(start, TC.name).getDisplayValue()).trim() === '');
    sortTracker_(null, tr);                                     // the re-group the delete now triggers on the real sheet
    devEq_(R, 'delete: survivors compact up (2 rows, no gap)', devDataRows_(tr, start), 2);
    devCheck_(R, 'delete: no blank gap left at the top', String(tr.getRange(start, TC.name).getDisplayValue()).trim() !== '');
    devEq_(R, 'delete: top of the list is now the Approved survivor', devTrackerStatus_(tr, 0), 'Approved');
  })();

  // trackerCols_ resolves a NO-Return-Date layout (Status/Approved By/Notes shift left) and sortTracker_ respects it —
  // the STATUS column must keep its value, NOT get a return-date formula written into it (the header-corruption bug).
  (() => {
    const sh = devFreshSheet_('TrackerNoRet');
    const hr = Math.max(1, CONFIG.trackerStartRow - 2);
    sh.getRange(hr, 1, 1, 15).setValues([['KEY', 'RANK', 'UNIT NUMBER', 'OOC NAME', 'NAME', 'UNIQUE ID', 'SHIFT', 'LOA START DATE', 'LOA END DATE', 'LOA LENGTH', 'TIME UNTIL START', 'TIME LEFT', 'STATUS', 'APPROVED BY', 'NOTES']]);
    const TC = trackerCols_(sh);
    devEq_(R, 'no-return: status resolves to M (13)', TC.status, 13);
    devEq_(R, 'no-return: approvedBy resolves to N (14)', TC.approvedBy, 14);
    devEq_(R, 'no-return: notes resolves to O (15)', TC.notes, 15);
    devEq_(R, 'no-return: returnDate absent -> 0', TC.returnDate, 0);
    devEq_(R, 'no-return: discord = F (6, from "UNIQUE ID")', TC.discord, 6);
    devEq_(R, 'no-return: timeLeft = L (12, not the UNTIL col)', TC.timeLeft, 12);
    const row = buildTrackerRow_(TC, TC.width, { key: 'KEY|x|1', rank: 'Trooper', name: 'NoRet', discord: devId_(90), start: devDay_(2), end: devDay_(9), status: 'Pending' });
    sh.getRange(CONFIG.trackerStartRow, 1, 1, TC.width).setValues([row]);
    sortTracker_(null, sh);
    devEq_(R, 'no-return: STATUS cell (13) keeps its value', sh.getRange(CONFIG.trackerStartRow, 13).getDisplayValue(), 'Pending');
    devEq_(R, 'no-return: STATUS cell (13) is NOT a formula', sh.getRange(CONFIG.trackerStartRow, 13).getFormula(), '');
    devCheck_(R, 'no-return: LENGTH col (10) still gets its formula', sh.getRange(CONFIG.trackerStartRow, 10).getFormula().indexOf('INT(') !== -1);
  })();

  // autoFillTrackerRow_ completes a row from just a Unique ID: dedup key + Pending status + computed formulas.
  // (Identity fields come from the roster when the ID is on it; devId_ isn't, so assert the always-set fields.)
  (() => {
    const tr = devBuildTracker_([]);
    const TC = trackerCols_(tr);
    const row = CONFIG.trackerStartRow;
    tr.getRange(row, TC.discord).setNumberFormat('@'); tr.getRange(row, TC.discord).setValue(devId_(95));
    tr.getRange(row, TC.start).setValue(devDay_(2)); tr.getRange(row, TC.end).setValue(devDay_(9));
    autoFillTrackerRow_(tr, row, TC, devId_(95));
    devCheck_(R, 'autoFillTrackerRow_ writes a KEY| dedup key', String(tr.getRange(row, TC.key).getDisplayValue()).indexOf('KEY|') === 0);
    devEq_(R, 'autoFillTrackerRow_ defaults status to Pending', tr.getRange(row, TC.status).getDisplayValue(), CONFIG.pendingStatus);
    devCheck_(R, 'autoFillTrackerRow_ writes the LENGTH formula', tr.getRange(row, TC.length).getFormula().indexOf('INT(') !== -1);
  })();

  return R;
}

/* ======================================================================
 * SECTION 5 — ROSTER MAINTENANCE (sandbox): unit numbering (formatUnit_
 * mirror), member transfers (checkForMemberMove / moveMemberColumns_), and the
 * duplicate/malformed Discord-ID scan (mirror).
 * ====================================================================== */
function devMaintenanceTests_() {
  const R = devNewResults_('Roster maintenance (sandbox)');
  devInfo_(R, 'unit numbering + dup scan run via mirrors (updateUnitNumbers_/checkDuplicateDiscordIds are UI-bound; the mirrors call the REAL isMemberSlot_/formatUnit_/isValidMemberValues_)', '');

  // Unit numbering: continuous S-01.. across dividers (divider rows stay blank).
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: devId_(1) },
      { rank: 'Trooper', name: 'B', id: devId_(2) },
      { rank: 'DEPARTMENT MEMBERS', name: '', id: '' },
      { rank: 'Trooper', name: 'C', id: devId_(3) },
    ]);
    devNumberSheet_(ro);
    const unit = (idx) => ro.getRange(CONFIG.rosterStartRow + idx, CONFIG.roster.unit).getDisplayValue();
    devEq_(R, 'numbering: row 0 = S-01', unit(0), 'S-01');
    devEq_(R, 'numbering: row 1 = S-02', unit(1), 'S-02');
    devEq_(R, 'numbering: divider row blank', unit(2), '');
    devEq_(R, 'numbering: continues past divider -> S-03', unit(3), 'S-03');
  })();

  // Transfer: MEMBER columns follow the person; SLOT (rank) stays with the position; source cleared.
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Mover', id: devId_(10), activity: 'Active', hours: 12 },   // source (row 0)
      { rank: 'Sergeant', name: '', id: '', activity: '', hours: '' },                      // open target slot (row 1)
    ]);
    const RC = rosterCols_(ro);
    const targetRow = CONFIG.rosterStartRow + 1;
    ro.getRange(targetRow, RC.discord).setValue(devId_(10)); // simulate typing the ID into the target row
    checkForMemberMove(ro, ro.getRange(targetRow, RC.discord), devId_(10), function () { return true; }, function () {});
    devEq_(R, 'transfer: name moved to the destination', ro.getRange(targetRow, RC.name).getDisplayValue(), 'Mover');
    devEq_(R, 'transfer: ID moved exactly (precision-safe)', ro.getRange(targetRow, RC.discord).getDisplayValue(), devId_(10));
    devEq_(R, 'transfer: hours (MEMBER col) followed the person', ro.getRange(targetRow, RC.hours).getValue(), 12);
    devEq_(R, 'transfer: source name cleared', ro.getRange(CONFIG.rosterStartRow, RC.name).getDisplayValue(), '');
    devEq_(R, 'transfer: source ID cleared', ro.getRange(CONFIG.rosterStartRow, RC.discord).getDisplayValue(), '');
    devEq_(R, 'transfer: destination SLOT rank stays Sergeant', ro.getRange(targetRow, RC.rank).getDisplayValue(), 'Sergeant');
    devEq_(R, 'transfer: source SLOT rank stays Trooper (now an open slot)', ro.getRange(CONFIG.rosterStartRow, RC.rank).getDisplayValue(), 'Trooper');
  })();

  // Declined transfer: nothing moves, the just-typed target ID cell is cleared.
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Stay', id: devId_(20), activity: 'Active', hours: 12 },
      { rank: 'Sergeant', name: '', id: '', activity: '', hours: '' },
    ]);
    const RC = rosterCols_(ro);
    const targetRow = CONFIG.rosterStartRow + 1;
    ro.getRange(targetRow, RC.discord).setValue(devId_(20));
    checkForMemberMove(ro, ro.getRange(targetRow, RC.discord), devId_(20), function () { return false; }, function () {});
    devEq_(R, 'declined: source name still "Stay"', ro.getRange(CONFIG.rosterStartRow, RC.name).getDisplayValue(), 'Stay');
    devEq_(R, 'declined: target name still empty (no move)', ro.getRange(targetRow, RC.name).getDisplayValue(), '');
    devEq_(R, 'declined: just-typed target ID cell cleared', ro.getRange(targetRow, RC.discord).getDisplayValue(), '');
  })();

  // No-source: entering a brand-new ID (matching no other row) is a no-op.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Solo', id: devId_(30), activity: 'Active', hours: 5 }]);
    const RC = rosterCols_(ro);
    checkForMemberMove(ro, ro.getRange(CONFIG.rosterStartRow, RC.discord), devId_(999), function () { return true; }, function () {});
    devEq_(R, 'no-source: name unchanged ("Solo")', ro.getRange(CONFIG.rosterStartRow, RC.name).getDisplayValue(), 'Solo');
    devEq_(R, 'no-source: activity unchanged ("Active")', devActivity_(ro, 0), 'Active');
  })();

  // Duplicate / malformed Discord-ID scan.
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: devId_(40) },
      { rank: 'Trooper', name: 'B', id: devId_(40) },   // duplicate
      { rank: 'Trooper', name: 'C', id: devBadId_() },   // malformed (invalid under any ID range)
      { rank: 'Trooper', name: 'D', id: 'abcdefgh' },    // malformed
    ]);
    const scan = devScanDuplicateIds_(ro);
    devEq_(R, 'dup scan: finds the duplicate ID', scan.duplicates.length, 1);
    devEq_(R, 'dup scan: flags 2 malformed IDs', scan.malformed.length, 2);
    const clean = devScanDuplicateIds_(devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(50) }, { rank: 'Trooper', name: 'B', id: devId_(51) }]));
    devEq_(R, 'dup scan: clean roster -> 0 duplicates', clean.duplicates.length, 0);
    devEq_(R, 'dup scan: clean roster -> 0 malformed', clean.malformed.length, 0);
  })();

  // Multiple blank IDs are not duplicates.
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: '' },
      { rank: 'Trooper', name: 'B', id: '' },
    ]);
    const scan = devScanDuplicateIds_(ro);
    devEq_(R, 'blank IDs -> 0 duplicates', scan.duplicates.length, 0);
    devEq_(R, 'blank IDs -> 0 malformed', scan.malformed.length, 0);
  })();

  return R;
}
/* ======================================================================
 * SECTION 6 — DISCORD FIELD GUARD (no network): postToWebhook_ short-circuit,
 * mention_ gate, dash_ non-empty guarantee for embed fields.
 * ====================================================================== */
function devWebhookTests_() {
  const R = devNewResults_('Discord field guard');
  devInfo_(R, 'embed field values are guarded by dash_ (Discord rejects empty field values)', '');

  // postToWebhook_ must NEVER send to an empty URL (feature-off), and returns a {ok,code} shape.
  const res = postToWebhook_('', { content: 'x' });
  devEq_(R, 'postToWebhook_ empty URL -> ok:false', res.ok, false);
  devEq_(R, 'postToWebhook_ empty URL -> code 0 (never sent)', res.code, 0);
  devCheck_(R, 'postToWebhook_ returns a {ok,code} shape', typeof res.ok === 'boolean' && typeof res.code === 'number');

  // dash_ guarantees a non-empty string for any blank-ish input.
  [null, undefined, '', '   '].forEach((v, i) => devCheck_(R, 'dash_ output non-empty for blank input #' + i, dash_(v).length > 0));

  // mention_ gate (only a true 17-19 digit Discord snowflake produces a ping — not the configurable ID range).
  devCheck_(R, 'mention_ valid Discord ID pings', mention_('110000000000000001').indexOf('<@') === 0);
  devCheck_(R, 'mention_ short ID does not ping', mention_('123').indexOf('<@') === -1);

  return R;
}

/* ======================================================================
 * SECTION 7 — ID MATCHING / PRECISION (sandbox): updateRosterStatus by exact
 * Discord ID — near-miss must NOT match, whitespace is trimmed, first row wins.
 * ====================================================================== */
function devIdMatchTests_() {
  const R = devNewResults_('ID matching / precision (sandbox)');

  // Exact match sets the status.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Active', hours: 5 }]);
    updateRosterStatus(ro, devId_(1), 'LOA');
    devEq_(R, 'exact Unique-ID match sets status', devActivity_(ro, 0), 'LOA');
  })();

  // Near-miss (differs only in the last digit) must NOT match — precision-safe.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Active', hours: 5 }]);
    const near = devId_(1).slice(0, -1) + (devId_(1).slice(-1) === '0' ? '1' : '0');
    updateRosterStatus(ro, near, 'LOA');
    devEq_(R, 'near-miss ID does NOT match', devActivity_(ro, 0), 'Active');
  })();

  // Whitespace-padded lookup still matches (trimmed).
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Active', hours: 5 }]);
    updateRosterStatus(ro, '  ' + devId_(1) + '  ', 'Reserve');
    devEq_(R, 'whitespace-padded ID still matches (trimmed)', devActivity_(ro, 0), 'Reserve');
  })();

  // Empty-ID lookup does NOT match an empty ID cell.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: '', activity: 'Active', hours: 5 }]);
    updateRosterStatus(ro, '', 'LOA');
    devEq_(R, 'empty ID lookup does NOT match an empty cell', devActivity_(ro, 0), 'Active');
  })();

  // First match wins; a later duplicate row is untouched.
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'First', id: devId_(9), activity: 'Active', hours: 5 },
      { rank: 'Trooper', name: 'Second', id: devId_(9), activity: 'Active', hours: 5 },
    ]);
    updateRosterStatus(ro, devId_(9), 'LOA');
    devEq_(R, 'first-match-wins: first row updated', devActivity_(ro, 0), 'LOA');
    devEq_(R, 'first-match-wins: second row untouched', devActivity_(ro, 1), 'Active');
  })();

  return R;
}

/* ======================================================================
 * SECTION 8 — ADVERSARIAL & PLATFORM (sandbox): empty inputs, blank dates,
 * done-colour dedup (case-insensitive), and a 1000-member recompute (timing).
 * ====================================================================== */
function devAdversarialTests_() {
  const R = devNewResults_('Adversarial & platform (sandbox)');
  const NO_HOOK = { sendWebhooks: false };

  // Empty roster + empty tracker: nothing throws.
  (() => {
    let threw = false;
    try {
      const ro = devBuildRoster_([]);
      const tr = devBuildTracker_([]);
      processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
      const rec = recomputeStatuses_(ro, false);
      devEq_(R, 'empty roster recompute -> total 0', rec.total, 0);
    } catch (e) { threw = true; }
    devCheck_(R, 'empty roster + tracker: no throw', !threw);
  })();

  // Blank tracker dates: no throw, leave not expired.
  (() => {
    let threw = false;
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'P', id: devId_(1), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'NoDates', id: devId_(1), status: 'Approved' }]); // no start/end
    try { processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK); } catch (e) { threw = true; }
    devCheck_(R, 'blank tracker dates: no throw', !threw);
    devEq_(R, 'blank-date leave not expired', devTrackerStatus_(tr, 0), 'Approved');
  })();

  // Done-coloured form rows are treated as already-processed (case-insensitive) → never re-appended.
  (() => {
    const tr = devBuildTracker_([]);
    const form = devBuildForm_([{ ts: devDay_(0), name: 'Dn', id: devId_(2), callsign: 'S-1', rank: 'Trooper', type: 'LOA', start: devDay_(2), end: devDay_(9) }]);
    form.getRange(2, 1, 1, 8).setBackground(String(CONFIG.bg.done).toUpperCase()); // done colour, upper-cased
    syncFormToTracker_(form, tr, NO_HOOK);
    devCheck_(R, 'done-coloured row treated as processed (no append)', tr.getLastRow() < CONFIG.trackerStartRow);
  })();

  // 1000-member recompute: no throw / no timeout, and a spot check is correct.
  (() => {
    const members = [];
    for (let i = 0; i < 1000; i++) members.push({ rank: 'Trooper', name: 'M' + i, id: devId_(1000 + i), activity: 'Inactive', hours: i % 2 ? 12 : 2 });
    const ro = devBuildRoster_(members);
    let threw = false;
    try { recomputeStatuses_(ro, false); } catch (e) { threw = true; }
    devCheck_(R, '1000-member recompute: no throw / no timeout', !threw);
    devEq_(R, '1000-member spot check: an odd index with 12h -> Active', devActivity_(ro, 1), 'Active');
  })();

  return R;
}

/* ======================================================================
 * SECTION 9 — CONTROL PANEL & AUDIT (sandbox): the injectable panel cores —
 * status, bulk, assign, move, schedule-leave, detect-move, parse, resolve.
 * ====================================================================== */
function devPanelTests_() {
  const R = devNewResults_('Control Panel & audit (sandbox)');
  const NO_HOOK = { sendWebhooks: false };
  const ymd = (d) => Utilities.formatDate(d, ssTz_(), 'yyyy-MM-dd');
  const lowestTier = (CONFIG.tierNames && CONFIG.tierNames.length) ? CONFIG.tierNames[CONFIG.tierNames.length - 1] : 'Inactive';

  // cpSetStatus_ + cpMemberAt_
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Sam', id: devId_(1), activity: 'Active', hours: 12 }]);
    const m = cpSetStatus_(ro, CONFIG.rosterStartRow, 'Inactive');
    devEq_(R, 'cpSetStatus_ sets the activity cell', devActivity_(ro, 0), 'Inactive');
    devEq_(R, 'cpSetStatus_ returns the updated status', m.status, 'Inactive');
    devEq_(R, 'cpSetStatus_ returns the member name', m.name, 'Sam');
    let bad = false; try { cpSetStatus_(ro, CONFIG.rosterStartRow, 'ZZZ-not-a-status'); } catch (e) { bad = true; }
    devCheck_(R, 'cpSetStatus_ rejects an invalid status', bad);
  })();

  // cpSetStatusBulk_ (skips a divider row; counts only real members)
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: devId_(2), activity: 'Inactive', hours: 0 },
      { rank: 'DEPARTMENT MEMBERS', name: '', id: '', activity: '', hours: '' },
      { rank: 'Trooper', name: 'B', id: devId_(3), activity: 'Inactive', hours: 0 },
    ]);
    const rows = [CONFIG.rosterStartRow, CONFIG.rosterStartRow + 1, CONFIG.rosterStartRow + 2];
    const res = cpSetStatusBulk_(ro, rows, 'Active');
    devEq_(R, 'cpSetStatusBulk_ count (divider skipped)', res.count, 2);
    devEq_(R, 'cpSetStatusBulk_ row 0 -> Active', devActivity_(ro, 0), 'Active');
    devEq_(R, 'cpSetStatusBulk_ divider untouched', devActivity_(ro, 1), '');
    devEq_(R, 'cpSetStatusBulk_ row 2 -> Active', devActivity_(ro, 2), 'Active');
    let bad = false; try { cpSetStatusBulk_(ro, rows, 'ZZZ'); } catch (e) { bad = true; }
    devCheck_(R, 'cpSetStatusBulk_ invalid status -> throws', bad);
  })();

  // cpAssignMember_ (name/ID/defaults + rejections + join-date handling)
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: '', id: '', activity: '', hours: '' }]);
    const m = cpAssignMember_(ro, { row: CONFIG.rosterStartRow, name: 'Newbie', discord: devId_(10), joinDate: '2026-03-15' });
    devEq_(R, 'cpAssignMember_ writes the name', ro.getRange(CONFIG.rosterStartRow, CONFIG.roster.name).getDisplayValue(), 'Newbie');
    devEq_(R, 'cpAssignMember_ writes the ID exactly', ro.getRange(CONFIG.rosterStartRow, CONFIG.roster.discord).getDisplayValue(), devId_(10));
    devEq_(R, 'cpAssignMember_ seats at the lowest tier', devActivity_(ro, 0), lowestTier);
    devEq_(R, 'cpAssignMember_ initializes hours to 0', ro.getRange(CONFIG.rosterStartRow, CONFIG.roster.hours).getValue(), 0);
    devEq_(R, 'cpAssignMember_ returns the slot rank', m.rank, 'Trooper');
    // rejections
    let dup = false, mal = false, filled = false;
    try { cpAssignMember_(ro, { row: CONFIG.rosterStartRow, name: 'X', discord: devId_(10) }); } catch (e) { filled = true; } // slot now filled
    const ro2 = devBuildRoster_([{ rank: 'Trooper', name: 'Held', id: devId_(11) }, { rank: 'Trooper', name: '', id: '' }]);
    try { cpAssignMember_(ro2, { row: CONFIG.rosterStartRow + 1, name: 'Dupe', discord: devId_(11) }); } catch (e) { dup = true; }
    try { cpAssignMember_(ro2, { row: CONFIG.rosterStartRow + 1, name: 'Bad', discord: devBadId_() }); } catch (e) { mal = true; }
    devCheck_(R, 'cpAssignMember_ rejects an already-filled slot', filled);
    devCheck_(R, 'cpAssignMember_ rejects a duplicate ID', dup);
    devCheck_(R, 'cpAssignMember_ rejects a malformed ID', mal);
  })();

  // cpAssignMember_ join-date fallbacks
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: '', id: '' }]);
    cpAssignMember_(ro, { row: CONFIG.rosterStartRow, name: 'NoJoin', discord: devId_(12) }); // no joinDate -> today
    const jd = ro.getRange(CONFIG.rosterStartRow, rosterCols_(ro).join).getValue();
    devCheck_(R, 'cpAssignMember_ no joinDate defaults to a Date', jd instanceof Date && !isNaN(jd.getTime()));
    const ro2 = devBuildRoster_([{ rank: 'Trooper', name: '', id: '' }]);
    cpAssignMember_(ro2, { row: CONFIG.rosterStartRow, name: 'BadJoin', discord: devId_(13), joinDate: 'not-a-date' });
    const jd2 = ro2.getRange(CONFIG.rosterStartRow, rosterCols_(ro2).join).getValue();
    devCheck_(R, 'cpAssignMember_ unparseable joinDate falls back to a Date', jd2 instanceof Date && !isNaN(jd2.getTime()));
  })();

  // cpMoveMember_ (move into an open slot; SLOT rank belongs to the destination)
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Climber', id: devId_(20), activity: 'Active', hours: 30 },
      { rank: 'Sergeant', name: '', id: '', activity: '', hours: '' },
    ]);
    const src = CONFIG.rosterStartRow, dst = CONFIG.rosterStartRow + 1;
    const r = cpMoveMember_(ro, src, dst);
    devEq_(R, 'cpMoveMember_ reports origin rank', r.fromRank, 'Trooper');
    devEq_(R, 'cpMoveMember_ reports destination rank', r.toRank, 'Sergeant');
    devEq_(R, 'cpMoveMember_ moves the name', ro.getRange(dst, CONFIG.roster.name).getDisplayValue(), 'Climber');
    devEq_(R, 'cpMoveMember_ moves the ID exactly', ro.getRange(dst, CONFIG.roster.discord).getDisplayValue(), devId_(20));
    devEq_(R, 'cpMoveMember_ carries MEMBER cols (hours follow)', ro.getRange(dst, CONFIG.roster.hours).getValue(), 30);
    devEq_(R, 'cpMoveMember_ clears the source name', ro.getRange(src, CONFIG.roster.name).getDisplayValue(), '');
    devEq_(R, 'cpMoveMember_ keeps the SLOT rank at the source', ro.getRange(src, CONFIG.roster.rank).getDisplayValue(), 'Trooper');
    devEq_(R, 'cpMoveMember_ member now holds the destination rank', r.member.rank, 'Sergeant');
    // rejections
    let occ = false, empty = false, same = false;
    const ro2 = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(21) }, { rank: 'Sergeant', name: 'B', id: devId_(22) }]);
    try { cpMoveMember_(ro2, CONFIG.rosterStartRow, CONFIG.rosterStartRow + 1); } catch (e) { occ = true; }
    const ro3 = devBuildRoster_([{ rank: 'Trooper', name: '', id: '' }, { rank: 'Sergeant', name: '', id: '' }]);
    try { cpMoveMember_(ro3, CONFIG.rosterStartRow, CONFIG.rosterStartRow + 1); } catch (e) { empty = true; }
    try { cpMoveMember_(ro2, CONFIG.rosterStartRow, CONFIG.rosterStartRow); } catch (e) { same = true; }
    devCheck_(R, 'cpMoveMember_ rejects a move into an occupied slot', occ);
    devCheck_(R, 'cpMoveMember_ rejects moving an empty source', empty);
    devCheck_(R, 'cpMoveMember_ rejects a same-row move', same);
  })();

  // cpScheduleLeave_ (Pending / Approved-active / future / rejections)
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Leaver', id: devId_(30), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([]);
    const lv = cpScheduleLeave_(ro, tr, { row: CONFIG.rosterStartRow, status: 'Pending', start: ymd(devDay_(2)), end: ymd(devDay_(5)) }, NO_HOOK);
    devEq_(R, 'cpScheduleLeave_ appends one tracker row', devDataRows_(tr, CONFIG.trackerStartRow), 1);
    devEq_(R, 'cpScheduleLeave_ status Pending', devTrackerStatus_(tr, 0), 'Pending');
    devEq_(R, 'cpScheduleLeave_ Pending is not applied', lv.applied, false);
    devEq_(R, 'cpScheduleLeave_ writes the member name (col E)', tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.name).getDisplayValue(), 'Leaver');
    devCheck_(R, 'cpScheduleLeave_ writes a KEY| dedup key', String(tr.getRange(CONFIG.trackerStartRow, CONFIG.tracker.key).getDisplayValue()).indexOf('KEY|') === 0);
  })();
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Now', id: devId_(31), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([]);
    const lv = cpScheduleLeave_(ro, tr, { row: CONFIG.rosterStartRow, status: 'Approved', start: ymd(devDay_(-1)), end: ymd(devDay_(3)) }, NO_HOOK);
    devEq_(R, 'cpScheduleLeave_ Approved+active applies to roster (LOA-only)', devActivity_(ro, 0), trackerLeaveType_());
    devEq_(R, 'cpScheduleLeave_ applied flag true', lv.applied, true);
  })();
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Fut', id: devId_(32), activity: 'Active', hours: 12 }]);
    const tr = devBuildTracker_([]);
    const lv = cpScheduleLeave_(ro, tr, { row: CONFIG.rosterStartRow, status: 'Approved', start: ymd(devDay_(3)), end: ymd(devDay_(10)) }, NO_HOOK);
    devEq_(R, 'cpScheduleLeave_ future Approved -> not yet applied', lv.applied, false);
    devEq_(R, 'cpScheduleLeave_ future Approved -> roster stays Active', devActivity_(ro, 0), 'Active');
    devEq_(R, 'cpScheduleLeave_ future Approved -> tracker Approved', devTrackerStatus_(tr, 0), 'Approved');
  })();
  (() => {
    let rev = false, open = false, mal = false, miss = false;
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'V', id: devId_(33), activity: 'Active', hours: 12 }, { rank: 'Sergeant', name: '', id: '' }]);
    const tr = devBuildTracker_([]);
    try { cpScheduleLeave_(ro, tr, { row: CONFIG.rosterStartRow, status: 'Pending', start: ymd(devDay_(5)), end: ymd(devDay_(2)) }, NO_HOOK); } catch (e) { rev = true; }
    try { cpScheduleLeave_(ro, tr, { row: CONFIG.rosterStartRow + 1, status: 'Pending', start: ymd(devDay_(2)), end: ymd(devDay_(5)) }, NO_HOOK); } catch (e) { open = true; }
    try { cpScheduleLeave_(ro, tr, { row: CONFIG.rosterStartRow, status: 'Pending', start: '', end: '' }, NO_HOOK); } catch (e) { miss = true; }
    const roBad = devBuildRoster_([{ rank: 'Trooper', name: 'Bad', id: devBadId_(), activity: 'Active', hours: 12 }]);
    try { cpScheduleLeave_(roBad, tr, { row: CONFIG.rosterStartRow, status: 'Pending', start: ymd(devDay_(2)), end: ymd(devDay_(5)) }, NO_HOOK); } catch (e) { mal = true; }
    devCheck_(R, 'cpScheduleLeave_ rejects end-before-start', rev);
    devCheck_(R, 'cpScheduleLeave_ rejects an open slot', open);
    devCheck_(R, 'cpScheduleLeave_ rejects missing dates', miss);
    devCheck_(R, 'cpScheduleLeave_ rejects a malformed member ID', mal);
  })();

  // cpParseYMD_ (local midnight; rejects rollovers)
  (() => {
    const d = cpParseYMD_('2026-03-15');
    devCheck_(R, 'cpParseYMD_ "2026-03-15" -> local midnight', d.getFullYear() === 2026 && d.getMonth() === 2 && d.getDate() === 15 && d.getHours() === 0);
    devCheck_(R, 'cpParseYMD_ null -> Invalid Date', isNaN(cpParseYMD_(null).getTime()));
    devCheck_(R, 'cpParseYMD_ "2026-13-40" -> Invalid (no rollover)', isNaN(cpParseYMD_('2026-13-40').getTime()));
    devCheck_(R, 'cpParseYMD_ "2026-02-30" -> Invalid (Feb 30)', isNaN(cpParseYMD_('2026-02-30').getTime()));
  })();

  // cpColLetter_ (spreadsheet column letters)
  devEq_(R, 'cpColLetter_ 1 -> A', cpColLetter_(1), 'A');
  devEq_(R, 'cpColLetter_ 5 -> E', cpColLetter_(5), 'E');
  devEq_(R, 'cpColLetter_ 26 -> Z', cpColLetter_(26), 'Z');
  devEq_(R, 'cpColLetter_ 27 -> AA', cpColLetter_(27), 'AA');
  devEq_(R, 'cpColLetter_ 28 -> AB', cpColLetter_(28), 'AB');
  devEq_(R, 'cpColLetter_ 52 -> AZ', cpColLetter_(52), 'AZ');
  devEq_(R, 'cpColLetter_ 53 -> BA', cpColLetter_(53), 'BA');

  // cpMemberAt_ open slot
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: '', id: '' }]);
    const m = cpMemberAt_(ro, CONFIG.rosterStartRow);
    devEq_(R, 'cpMemberAt_ open slot: filled === false', m.filled, false);
    devEq_(R, 'cpMemberAt_ open slot: name === ""', m.name, '');
    devEq_(R, 'cpMemberAt_ open slot: rank still read', m.rank, 'Trooper');
  })();

  // cpAssertUniqueId_ / cpAssertSlotRow_ / cpFindRowById_ / cpResolveMemberRow_
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(40) }, { rank: 'Trooper', name: 'B', id: devId_(41) }]);
    let ownOk = true, otherThrew = false, sameOk = true, divThrew = false;
    try { cpAssertUniqueId_(ro, devId_(40), CONFIG.rosterStartRow); } catch (e) { ownOk = false; }       // exempts own row
    try { cpAssertUniqueId_(ro, devId_(40), CONFIG.rosterStartRow + 1); } catch (e) { otherThrew = true; } // exists elsewhere
    devCheck_(R, 'cpAssertUniqueId_ exempts own row (no throw)', ownOk);
    devCheck_(R, 'cpAssertUniqueId_ throws when ID exists on a different row', otherThrew);
    try { cpAssertSlotRow_(ro, CONFIG.rosterStartRow); } catch (e) { sameOk = false; }
    devCheck_(R, 'cpAssertSlotRow_ accepts a real member row', sameOk);
    devEq_(R, 'cpFindRowById_ finds the row', cpFindRowById_(ro, devId_(41)), CONFIG.rosterStartRow + 1);
    devEq_(R, 'cpFindRowById_ missing -> -1', cpFindRowById_(ro, devId_(999)), -1);
    devEq_(R, 'cpResolveMemberRow_ relocates by ID when the row is stale', cpResolveMemberRow_(ro, CONFIG.rosterStartRow, devId_(41)), CONFIG.rosterStartRow + 1);
    let gone = false; try { cpResolveMemberRow_(ro, CONFIG.rosterStartRow, devId_(999)); } catch (e) { gone = true; }
    devCheck_(R, 'cpResolveMemberRow_ throws when the ID is gone', gone);
    // Divider rejection — REBUILDS the shared Roster sandbox, so do this LAST, after every `ro` use above.
    const roD = devBuildRoster_([{ rank: 'DEPARTMENT MEMBERS', name: '', id: '' }]);
    try { cpAssertSlotRow_(roD, CONFIG.rosterStartRow); } catch (e) { divThrew = true; }
    devCheck_(R, 'cpAssertSlotRow_ rejects a divider row', divThrew);
  })();

  // cpDetectMove_
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Mover', id: devId_(50) }, { rank: 'Sergeant', name: '', id: '' }]);
    const mv = cpDetectMove_(ro, CONFIG.rosterStartRow + 1, devId_(50)); // same ID typed into row 1 (already on row 0)
    devCheck_(R, 'cpDetectMove_ detects a move', !!mv);
    devEq_(R, 'cpDetectMove_ member = source name', mv.member, 'Mover');
    devCheck_(R, 'cpDetectMove_ from starts with the source rank', mv.from.indexOf('Trooper') === 0);
    devCheck_(R, 'cpDetectMove_ null for a brand-new ID', cpDetectMove_(ro, CONFIG.rosterStartRow + 1, devId_(777)) === null);
    devCheck_(R, 'cpDetectMove_ null for a malformed ID', cpDetectMove_(ro, CONFIG.rosterStartRow + 1, devBadId_()) === null);
  })();

  // cpRosterHeaderIssues_ (header-resolved) + cpHeaderIssues_ (fixed-position tracker)
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(60), activity: 'Active', hours: 5 }]);
    devEq_(R, 'cpRosterHeaderIssues_ clean roster -> no issues', cpRosterHeaderIssues_(ro).length, 0);
    devEq_(R, 'rosterCols_ default ACTIVITY resolves (non-zero)', rosterCols_(ro).activity > 0, true);
    devEq_(R, 'cpHeaderIssues_ clean spec -> no issues', cpHeaderIssues_(ro, 'Roster', 5, { 2: 'RANK', 3: 'NAME' }).length, 0);
    devCheck_(R, 'cpHeaderIssues_ flags a header drift', cpHeaderIssues_(ro, 'Roster', 5, { 2: 'HOURS' }).length > 0);
  })();

  return R;
}

/* ======================================================================
 * SECTION 10 — EXTRAS: GROUP / ACADEMY / OOC HELPERS (pure + sandbox).
 * The group-tab and Police-Academy renderers depend on these markers/parsers;
 * they're tested directly (full renders need an operator-laid-out tab).
 * ====================================================================== */
function devExtrasTests_() {
  const R = devNewResults_('Extras: group / academy helpers (sandbox)');

  // groupNorm_ / groupColLetter_
  devEq_(R, 'groupNorm_ lowercases + collapses whitespace', groupNorm_('  Day   Shift '), 'day shift');
  devEq_(R, 'groupColLetter_ 1 -> A', groupColLetter_(1), 'A');
  devEq_(R, 'groupColLetter_ 27 -> AA', groupColLetter_(27), 'AA');

  // groupMarker_ (reads "#group:" from a tab's top-left)
  (() => {
    const sh = devFreshSheet_('Group');
    sh.getRange(1, 1).setValue('#group: Shift = Day');
    const g = groupMarker_(sh);
    devEq_(R, 'groupMarker_ "Column = Value" -> column', g.column, 'Shift');
    devEq_(R, 'groupMarker_ "Column = Value" -> single value', g.values.join(','), 'Day');
    devEq_(R, 'groupMarker_ "Column = Value" -> no extras', g.extras.length, 0);
    sh.getRange(1, 1).setValue('#group: Rank in Police Cadet, Probationary Officer | Beat, Vehicle');
    const g2 = groupMarker_(sh);
    devEq_(R, 'groupMarker_ "in" -> 2 values', g2.values.length, 2);
    devEq_(R, 'groupMarker_ "in" -> first value', g2.values[0], 'Police Cadet');
    devEq_(R, 'groupMarker_ pipe -> 2 extra columns', g2.extras.length, 2);
    sh.getRange(1, 1).setValue('#group: Nights');
    const g3 = groupMarker_(sh);
    devEq_(R, 'groupMarker_ shorthand -> value only', g3.values[0], 'Nights');
    devEq_(R, 'groupMarker_ shorthand -> no column (auto-find)', g3.column, '');
    sh.getRange(1, 1).setValue('just a title');
    devEq_(R, 'groupMarker_ no marker -> null', groupMarker_(sh), null);
  })();

  // suggestMarker_ / inferGroup_
  devEq_(R, 'suggestMarker_ "Day Shift" -> Shift = Day', suggestMarker_('Day Shift'), '#group: Shift = Day');
  devEq_(R, 'suggestMarker_ "Troop A" -> Troop = A', suggestMarker_('Troop A'), '#group: Troop = A');
  devCheck_(R, 'suggestMarker_ "Academy" -> Rank in ...', suggestMarker_('Academy').indexOf('#group: Rank in') === 0);
  devEq_(R, 'inferGroup_ "Day Shift" -> column Shift', inferGroup_('Day Shift').column, 'Shift');
  devEq_(R, 'inferGroup_ "Day Shift" -> value Day', inferGroup_('Day Shift').values[0], 'Day');
  devEq_(R, 'inferGroup_ "Academy" -> 2 rank values', inferGroup_('Academy').values.length, 2);
  devEq_(R, 'inferGroup_ bare name -> no column (auto-find)', inferGroup_('Special Roster').column, '');

  // checkboxOffsets_ (finds columns carrying a CHECKBOX validation)
  (() => {
    const sh = devFreshSheet_('Cbx');
    sh.getRange(1, 1, 1, 3).setValues([['A', 'B', 'C']]);
    const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    sh.getRange(2, 2).setDataValidation(rule); // checkbox in the 2nd column of the [1..3] window -> offset 1
    const offs = checkboxOffsets_(sh, 2, 1, 3);
    devCheck_(R, 'checkboxOffsets_ finds the checkbox column (offset 1)', offs.indexOf(1) !== -1);
    const none = checkboxOffsets_(devFreshSheet_('Cbx2'), 2, 1, 3);
    devEq_(R, 'checkboxOffsets_ none when no checkbox', none.length, 0);
  })();

  // academyMarker_ / academyCols_ / academyStems_ / academyGradSection_
  (() => {
    const sh = devFreshSheet_('Academy');
    sh.getRange(1, 1).setValue('#academy: rank in Police Cadet, Probationary Officer');
    const a = academyMarker_(sh);
    devEq_(R, 'academyMarker_ -> 2 ranks', a.ranks.length, 2);
    devEq_(R, 'academyMarker_ first rank', a.ranks[0], 'Police Cadet');
    sh.getRange(1, 1).setValue('nothing here');
    devEq_(R, 'academyMarker_ none -> null', academyMarker_(sh), null);
    devCheck_(R, 'isAcademyTab_ true by tab name', isAcademyTab_(sh)); // sheet is named ...Academy
  })();
  (() => {
    const headers = ['RANK GROUP', 'UNIQUE ID', 'RANK', 'NAME', 'CALLSIGN', 'GRADUATED', 'EXAM STATUS'];
    const c = academyCols_(headers);
    devEq_(R, 'academyCols_ id col (UNIQUE ID)', c.id, 2);
    devEq_(R, 'academyCols_ rank col (skips RANK GROUP)', c.rank, 3);
    devEq_(R, 'academyCols_ name col', c.name, 4);
    devEq_(R, 'academyCols_ graduated col', c.grad, 6);
    devCheck_(R, 'academyCols_ leaves training col (EXAM STATUS) unmapped', c.id !== 7 && c.rank !== 7 && c.name !== 7 && c.grad !== 7);
  })();
  devEq_(R, 'academyStems_ "CADETS" -> CADET', academyStems_('CADETS').join(','), 'CADET');
  devEq_(R, 'academyStems_ "Police Cadet" -> CADET', academyStems_('Police Cadet').join(','), 'CADET');
  devEq_(R, 'academyStems_ "PROBATIONARY MEMBERS" -> PROBATIONARY', academyStems_('PROBATIONARY MEMBERS').join(','), 'PROBATIONARY');
  devEq_(R, 'academyStems_ "Probationary Officer" -> PROBATIONARY', academyStems_('Probationary Officer').join(','), 'PROBATIONARY');
  (() => {
    const sh = devFreshSheet_('Grad');
    sh.getRange(8, 1).setValue('— GRADUATE LOG —');
    const g = academyGradSection_(sh, 1, 4);
    devCheck_(R, 'academyGradSection_ finds the header row', g && g.headerRow === 8);
    devCheck_(R, 'academyGradSection_ data starts under the header', g && g.dataStart > g.headerRow);
    devEq_(R, 'academyGradSection_ none -> null', academyGradSection_(devFreshSheet_('Grad2'), 1, 4), null);
  })();

  // rosterOocShift_ guards (reads the REAL roster by CONFIG.sheets.roster; found=false + blank when absent/not-found)
  (() => {
    const empty = rosterOocShift_('');
    devEq_(R, 'rosterOocShift_ empty ID -> not found', empty.found, false);
    devEq_(R, 'rosterOocShift_ empty ID -> blank name', empty.name, '');
    devEq_(R, 'rosterOocShift_ empty ID -> blank OOC', empty.ooc, '');
    const missing = rosterOocShift_('99999999999999999');
    devEq_(R, 'rosterOocShift_ unknown ID -> not found', missing.found, false);
    devEq_(R, 'rosterOocShift_ unknown ID -> blank rank', missing.rank, '');
    devEq_(R, 'rosterOocShift_ unknown ID -> blank shift', missing.shift, '');
  })();

  // demo name helpers
  devEq_(R, 'demoOocName_ "James Bennett" -> "James B."', demoOocName_('James Bennett'), 'James B.');
  devEq_(R, 'demoOocName_ single name -> unchanged', demoOocName_('Cher'), 'Cher');
  devEq_(R, 'demoOocName_ blank -> blank', demoOocName_(''), '');

  return R;
}

/* ======================================================================
 * SECTION 11 — TRUST: SNAPSHOTS / SCHEMA (sandbox): cpSnapshotRows_ /
 * cpApplyRestore_ round-trip + the tracker schema check on the new layout.
 * ====================================================================== */
function devTrustTests_() {
  const R = devNewResults_('Trust: snapshots / schema (sandbox)');

  // Snapshot captures members only (dividers skipped) and restores by identity.
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Alpha', id: devId_(1), activity: 'Active', hours: 12 },
      { rank: 'DEPARTMENT MEMBERS', name: '', id: '', activity: '', hours: '' },
      { rank: 'Trooper', name: 'Bravo', id: devId_(2), activity: 'Semi-Active', hours: 7 },
    ]);
    const snap = cpSnapshotRows_(ro, 'snap1', 'now');
    devEq_(R, 'cpSnapshotRows_ captures members only (skips divider)', snap.length, 2);
    devEq_(R, 'cpSnapshotRows_ row[0] name', snap[0][3], 'Alpha');
    devEq_(R, 'cpSnapshotRows_ row[0] ID exact', snap[0][4], devId_(1));

    // Mutate the roster, then restore.
    ro.getRange(CONFIG.rosterStartRow, CONFIG.roster.name).setValue('CHANGED');
    ro.getRange(CONFIG.rosterStartRow, CONFIG.roster.activity).setValue('Inactive');
    const restored = cpApplyRestore_(ro, snap);
    devEq_(R, 'cpApplyRestore_ restored count', restored, 2);
    devEq_(R, 'cpApplyRestore_ restores the name', ro.getRange(CONFIG.rosterStartRow, CONFIG.roster.name).getDisplayValue(), 'Alpha');
    devEq_(R, 'cpApplyRestore_ restores the status', devActivity_(ro, 0), 'Active');
  })();

  // Tracker schema check: the new 16-col LOA layout resolves cleanly; a drift is flagged.
  (() => {
    const tr = devBuildTracker_([]);
    const labelRow = Math.max(1, CONFIG.trackerStartRow - 2);
    const clean = cpHeaderIssues_(tr, 'Tracker', labelRow, { 2: 'RANK', 5: 'NAME', 6: 'DISCORD', 8: 'START', 9: 'END', 14: 'STATUS' });
    devEq_(R, 'tracker schema (new 16-col layout) -> no issues', clean.length, 0);
    const drift = cpHeaderIssues_(tr, 'Tracker', labelRow, { 14: 'RANK' }); // STATUS col should not read "RANK"
    devCheck_(R, 'tracker schema flags a header drift', drift.length > 0);
  })();

  return R;
}
/* ======================================================================
 * SECTION 12 — CONFIG ENGINE (pure): norm_ · coerce_ (every type) · theme_ ·
 * validateConfig_ (defaults valid, semantic checks) · blankTruncates_.
 * ====================================================================== */
function devConfigTests_() {
  const R = devNewResults_('Config engine (pure)');

  // norm_
  devEq_(R, 'norm_ trims + collapses + uppercases', norm_('  Day   Shift '), 'DAY SHIFT');
  devEq_(R, 'norm_ null -> ""', norm_(null), '');

  // coerce_ (int / bool / enum / color / list / empty handling)
  devEq_(R, 'coerce_ int "10" -> 10', coerce_('k', '10', { t: 'int', d: 5 }, []), 10);
  const P1 = []; devEq_(R, 'coerce_ int "abc" -> default', coerce_('k', 'abc', { t: 'int', d: 5 }, P1), 5);
  devCheck_(R, 'coerce_ bad int pushes an ERROR', P1.some((p) => p.sev === 'ERROR'));
  devEq_(R, 'coerce_ int below min -> default', coerce_('k', '0', { t: 'int', d: 5, min: 1 }, []), 5);
  devEq_(R, 'coerce_ bool "TRUE" -> true', coerce_('k', 'TRUE', { t: 'bool', d: false }, []), true);
  devEq_(R, 'coerce_ bool "no" -> false', coerce_('k', 'no', { t: 'bool', d: true }, []), false);
  devEq_(R, 'coerce_ enum match', coerce_('k', 'DURATION', { t: 'enum', d: 'START_END', enum: ['START_END', 'DURATION'] }, []), 'DURATION');
  devEq_(R, 'coerce_ enum bad -> default', coerce_('k', 'ZZZ', { t: 'enum', d: 'START_END', enum: ['START_END', 'DURATION'] }, []), 'START_END');
  devEq_(R, 'coerce_ color lowercased', coerce_('k', '#ABCDEF', { t: 'color', d: '#000000' }, []), '#abcdef');
  devEq_(R, 'coerce_ list splits on comma', coerce_('k', 'a, b ,c', { t: 'list', d: '' }, []).join('|'), 'a|b|c');
  devEq_(R, 'coerce_ empty optional string stays ""', coerce_('k', '', { t: 'string', d: 'ROA', req: false }, []), '');
  const P2 = []; devEq_(R, 'coerce_ empty required -> default', coerce_('k', '', { t: 'int', d: 7, req: true }, P2), 7);
  devCheck_(R, 'coerce_ empty required pushes an ERROR', P2.some((p) => p.sev === 'ERROR'));

  // theme_ (resolves known keys; unknown -> #000000)
  devCheck_(R, 'theme_ PASS resolves to a non-empty colour', String(theme_('PASS')).length > 0);
  devEq_(R, 'theme_ unknown key -> #000000', theme_('NO_SUCH_THEME_KEY'), '#000000');

  // validateConfig_ (defaults valid; semantic + additive-migration behavior)
  (() => {
    const v = validateConfig_({});
    devEq_(R, 'validateConfig_ defaults -> 0 ERRORs', v.problems.filter((p) => p.sev === 'ERROR').length, 0);
    devCheck_(R, 'validateConfig_ materializes SYSTEM block', !!(v.config && v.config.kv && v.config.kv.SYSTEM));
    devCheck_(R, 'validateConfig_ materializes STATUSES table (>=1 tier)', v.config.tables.STATUSES.length >= 1);
  })();
  (() => {
    const v = validateConfig_({ ROSTER_LAYOUT: { kind: 'kv', kv: { HEADER_ROW: '5', DATA_START_ROW: '3' } } });
    devCheck_(R, 'validateConfig_ DATA_START_ROW <= HEADER_ROW -> ERROR', v.problems.some((p) => p.sev === 'ERROR' && String(p.key).indexOf('DATA_START_ROW') !== -1));
  })();
  (() => {
    const v = validateConfig_({ NOTAREALBLOCK: { kind: 'kv', kv: { X: '1' } } });
    devCheck_(R, 'validateConfig_ unknown block -> WARN (not fatal)', v.problems.some((p) => p.sev === 'WARN'));
    devEq_(R, 'validateConfig_ unknown block -> still 0 ERRORs', v.problems.filter((p) => p.sev === 'ERROR').length, 0);
  })();

  // blankTruncates_ (a blank row followed by real content = truncation; blank then next block = clean end)
  devEq_(R, 'blankTruncates_ blank then content -> true', blankTruncates_([['x'], [''], ['y']], 1), true);
  devEq_(R, 'blankTruncates_ blank then next block -> false', blankTruncates_([['x'], [''], ['[NEXT]']], 1), false);

  return R;
}

/* ======================================================================
 * SECTION 13 — DISPATCH & MIGRATIONS (sandbox): the whitelisted panel router
 * and additive-config behavior (absent blocks fall back to defaults).
 * ====================================================================== */
function devConfigDispatchTests_() {
  const R = devNewResults_('Dispatch & migrations');

  // dispatch routes a known endpoint and rejects an unknown one (arbitrary-call guard).
  (() => {
    let ok = false, unknownThrew = false, pingRes = null;
    try { pingRes = dispatch('cpPing'); ok = true; } catch (e) { ok = false; }
    try { dispatch('totallyNotAnEndpoint_xyz'); } catch (e) { unknownThrew = true; }
    devCheck_(R, 'dispatch routes a known endpoint (cpPing)', ok && pingRes != null);
    devCheck_(R, 'dispatch rejects an unknown endpoint', unknownThrew);
  })();

  // Additive migration: an absent block materializes to its spec defaults (no ERROR).
  (() => {
    const v = validateConfig_({}); // no [PATROL], no [SHEETS] etc.
    devCheck_(R, 'absent [PATROL] block -> defaults present', !!(v.config.kv.PATROL && v.config.kv.PATROL.MODE));
    devCheck_(R, 'absent [SHEETS] block -> ROSTER default present', !!(v.config.kv.SHEETS && v.config.kv.SHEETS.ROSTER));
  })();

  // closestSheetName_ never throws and returns a string ("did you mean" helper).
  devCheck_(R, 'closestSheetName_ returns a string (no throw)', typeof closestSheetName_('Rostr') === 'string');

  return R;
}

/* ======================================================================
 * SECTION 14 — WHITE-LABEL & CONFIG VOCABULARY (sandbox): a community renames
 * every status/leave/tier and the hot logic (status, protection, scheduler,
 * leave-type gate, tracker type) reads names from config, not literals.
 * ====================================================================== */
function devWhiteLabelTests_() {
  const R = devNewResults_('White-label & config vocabulary (sandbox)');
  const NO_HOOK = { sendWebhooks: false };

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
    devEq_(R, 'renamed config validates with 0 ERRORs', val.problems.filter((p) => p.sev === 'ERROR').length, 0);
    // vocabulary accessors track the rename
    devEq_(R, 'CONFIG.approvedStatus tracks rename', CONFIG.approvedStatus, 'Greenlit');
    devEq_(R, 'CONFIG.expiredStatus tracks rename', CONFIG.expiredStatus, 'Closed');
    devEq_(R, 'CONFIG.returnStatus tracks rename', CONFIG.returnStatus, 'Returning');
    devEq_(R, 'CONFIG.tierNames track rename', CONFIG.tierNames.join(','), 'Duty,Light,Off');
    devEq_(R, 'CONFIG.leaveTypes track rename', CONFIG.leaveTypes.join(','), 'Vacation,Returning,Medical');
    // status engine emits renamed tier names
    devEq_(R, 'computeStatus_ 12h -> renamed top tier (Duty)', computeStatus_('Trooper', 12), 'Duty');
    devEq_(R, 'computeStatus_ 6h -> renamed mid tier (Light)', computeStatus_('Trooper', 6), 'Light');
    devEq_(R, 'computeStatus_ 0h -> renamed bottom tier (Off)', computeStatus_('Trooper', 0), 'Off');
    // protection reads custom LEAVE/PROTECTED kinds
    devEq_(R, 'isProtectedStatus_ custom LEAVE (Medical)', isProtectedStatus_('Medical'), true);
    devEq_(R, 'isProtectedStatus_ custom PROTECTED (Standby)', isProtectedStatus_('Standby'), true);
    devEq_(R, 'isReturningStatus_ tracks RETURN_STATUS (Returning)', isReturningStatus_('Returning'), true);
    devEq_(R, 'resolveStatus_ custom leave (Vacation) protected -> null', resolveStatus_('Trooper', 'Vacation', 20), null);
    // LOA-only tracker type = first configured leave type
    devEq_(R, 'trackerLeaveType_ = first renamed leave type (Vacation)', trackerLeaveType_(), 'Vacation');

    // Scheduler activates a renamed-approved leave and expires a past one.
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'WL', id: devId_(70), activity: 'Duty', hours: 12 }]);
    const tr = devBuildTracker_([{ name: 'WL', id: devId_(70), start: devDay_(0), end: devDay_(10), status: 'Greenlit' }]);
    processDailyLOAs_(ro, tr, devDay_(0), NO_HOOK);
    devEq_(R, 'scheduler starts a Greenlit leave -> roster shows Vacation', devActivity_(ro, 0), 'Vacation');
    const tr2 = devBuildTracker_([{ name: 'WL2', id: devId_(71), start: devDay_(-10), end: devDay_(-1), status: 'Greenlit' }]);
    const ro2 = devBuildRoster_([{ rank: 'Trooper', name: 'WL2', id: devId_(71), activity: 'Vacation', hours: 0 }]);
    processDailyLOAs_(ro2, tr2, devDay_(0), NO_HOOK);
    devEq_(R, 'scheduler expires a past Greenlit leave -> tracker Closed', devTrackerStatus_(tr2, 0), 'Closed');

    // Leave-type gate on sync: only the first configured type is accepted (LOA-only), others rejected.
    const trS = devBuildTracker_([]);
    syncFormToTracker_(devBuildForm_([{ ts: devDay_(0), name: 'V', id: devId_(72), callsign: 'S-1', rank: 'Trooper', type: 'Vacation', start: devDay_(2), end: devDay_(9) }]), trS, NO_HOOK);
    devEq_(R, 'sync accepts the configured leave type (Vacation)', devDataRows_(trS, CONFIG.trackerStartRow), 1);
    const trR = devBuildTracker_([]);
    syncFormToTracker_(devBuildForm_([{ ts: devDay_(0), name: 'B', id: devId_(73), callsign: 'S-1', rank: 'Trooper', type: 'TotallyBogus', start: devDay_(2), end: devDay_(9) }]), trR, NO_HOOK);
    devCheck_(R, 'sync rejects an unknown leave type', trR.getLastRow() < CONFIG.trackerStartRow);
  });

  return R;
}

/* ======================================================================
 * SECTION 15 — IDENTITY-KEYED WRITES & CONCURRENCY (sandbox): writes land on
 * the member by Discord ID, not by row position — so a shifted/relocated row
 * never mis-credits a different member.
 * ====================================================================== */
function devIdentityWriteTests_() {
  const R = devNewResults_('Identity-keyed writes & concurrency (sandbox)');

  // updateRosterStatus targets the member by ID regardless of position.
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Active', hours: 5 },
      { rank: 'Trooper', name: 'B', id: devId_(2), activity: 'Active', hours: 5 },
      { rank: 'Trooper', name: 'C', id: devId_(3), activity: 'Active', hours: 5 },
    ]);
    updateRosterStatus(ro, devId_(2), 'LOA'); // the MIDDLE member
    devEq_(R, 'updateRosterStatus hits the ID owner, not row 0', devActivity_(ro, 1), 'LOA');
    devEq_(R, 'updateRosterStatus leaves other rows alone', devActivity_(ro, 0), 'Active');
  })();

  // moveMemberColumns_ (direct): MEMBER columns follow, SLOT columns stay with the position.
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'Mv', id: devId_(10), activity: 'Active', hours: 42 },
      { rank: 'Sergeant', name: '', id: '', activity: '', hours: '' },
    ]);
    const RC = rosterCols_(ro);
    const wiped = moveMemberColumns_(ro, CONFIG.rosterStartRow, CONFIG.rosterStartRow + 1);
    devEq_(R, 'moveMemberColumns_ MEMBER col (hours) followed', ro.getRange(CONFIG.rosterStartRow + 1, RC.hours).getValue(), 42);
    devEq_(R, 'moveMemberColumns_ MEMBER col (name) followed', ro.getRange(CONFIG.rosterStartRow + 1, RC.name).getDisplayValue(), 'Mv');
    devEq_(R, 'moveMemberColumns_ SLOT col (rank) stayed at destination', ro.getRange(CONFIG.rosterStartRow + 1, RC.rank).getDisplayValue(), 'Sergeant');
    devEq_(R, 'moveMemberColumns_ source name cleared', ro.getRange(CONFIG.rosterStartRow, RC.name).getDisplayValue(), '');
    devEq_(R, 'moveMemberColumns_ same-section move -> nothing wiped', wiped, false);
  })();

  // cpApplyRestore_ restores by IDENTITY: a member relocated since the snapshot gets their data on their CURRENT row.
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: devId_(20), activity: 'Active', hours: 10 },
      { rank: 'Trooper', name: 'B', id: devId_(21), activity: 'Active', hours: 20 },
    ]);
    const snap = cpSnapshotRows_(ro, 'snap', 'now');
    const RC = rosterCols_(ro);
    // Simulate A and B swapping rows since the snapshot.
    ro.getRange(CONFIG.rosterStartRow, RC.name).setValue('B'); ro.getRange(CONFIG.rosterStartRow, RC.discord).setNumberFormat('@'); ro.getRange(CONFIG.rosterStartRow, RC.discord).setValue(devId_(21));
    ro.getRange(CONFIG.rosterStartRow + 1, RC.name).setValue('A'); ro.getRange(CONFIG.rosterStartRow + 1, RC.discord).setNumberFormat('@'); ro.getRange(CONFIG.rosterStartRow + 1, RC.discord).setValue(devId_(20));
    cpApplyRestore_(ro, snap);
    devEq_(R, 'cpApplyRestore_ A (id20) data followed A to its new row', ro.getRange(CONFIG.rosterStartRow + 1, RC.hours).getValue(), 10);
    devEq_(R, 'cpApplyRestore_ B (id21) data followed B to its new row', ro.getRange(CONFIG.rosterStartRow, RC.hours).getValue(), 20);
  })();

  return R;
}

/* ======================================================================
 * SECTION 16 — CONFIG-TAB ROBUSTNESS (pure): a broken / partial config never
 * throws — every path falls back to a valid default and reports the problem.
 * ====================================================================== */
function devConfigRobustnessTests_() {
  const R = devNewResults_('Config-tab robustness (pure)');

  // validateConfig_ never throws on garbage input, and still yields a usable config.
  (() => {
    let threw = false, v = null;
    try { v = validateConfig_({ STATUSES: { kind: 'table', header: ['WRONG', 'HEADERS'], rows: [['x', 'y']] } }); } catch (e) { threw = true; }
    devCheck_(R, 'validateConfig_ mismatched header -> no throw', !threw);
    devCheck_(R, 'validateConfig_ mismatched header -> falls back to seed tiers', v && v.config.tables.STATUSES.length >= 1);
    devCheck_(R, 'validateConfig_ mismatched header -> WARN raised', v && v.problems.some((p) => p.sev === 'WARN'));
  })();

  // An unknown KEY inside a known block is preserved with a WARN (never fatal).
  (() => {
    const v = validateConfig_({ SYSTEM: { kind: 'kv', kv: { MADE_UP_KEY: 'x' } } });
    devCheck_(R, 'unknown key in a known block -> WARN', v.problems.some((p) => p.sev === 'WARN' && String(p.key).indexOf('MADE_UP_KEY') !== -1));
    devEq_(R, 'unknown key -> still 0 ERRORs', v.problems.filter((p) => p.sev === 'ERROR').length, 0);
  })();

  // A wholly-empty config still materializes the load-bearing defaults.
  (() => {
    const v = validateConfig_({});
    devCheck_(R, 'empty config -> tierNames materialized', v.config.tables.STATUSES.some((s) => norm_(s.Kind) === 'TIER'));
    devCheck_(R, 'empty config -> SHEETS.ROSTER default', !!v.config.kv.SHEETS.ROSTER);
    devCheck_(R, 'empty config -> LEAVE.LEAVE_TYPES default', String(v.config.kv.LEAVE.LEAVE_TYPES).length > 0);
  })();

  return R;
}
/* ======================================================================
 * SECTION 17 — DASHBOARD RENDER SAFETY (sandbox): dashboardStats_ counts,
 * statTagValue_ resolution, dashboardSkip_.
 * ====================================================================== */
function devDashboardRenderTests_() {
  const R = devNewResults_('Dashboard render safety (sandbox)');

  const ro = devBuildRoster_([
    { rank: 'Trooper', name: 'A', id: devId_(1), activity: 'Active', hours: 12 },
    { rank: 'Trooper', name: 'B', id: devId_(2), activity: 'Semi-Active', hours: 7 },
    { rank: 'Trooper', name: 'C', id: devId_(3), activity: 'Inactive', hours: 2 },
    { rank: 'Trooper', name: 'D', id: devId_(4), activity: 'LOA', hours: 0 },
    { rank: 'Trooper', name: '', id: '', activity: '', hours: '' }, // open slot
  ]);
  const s = dashboardStats_(ro);
  devEq_(R, 'dashboardStats_ total (valid members)', s.total, 4);
  devEq_(R, 'dashboardStats_ active (top tier)', s.active, 1);
  devEq_(R, 'dashboardStats_ semi (middle tier)', s.semi, 1);
  devEq_(R, 'dashboardStats_ inactive (bottom tier)', s.inactive, 1);
  devEq_(R, 'dashboardStats_ leaves (LOA/ROA)', s.leaves, 1);
  devEq_(R, 'dashboardStats_ open slots', s.openSlots, 1);
  devEq_(R, 'dashboardStats_ total hours summed', s.totalHours, 21);

  devEq_(R, 'statTagValue_ #members -> total', statTagValue_(s, 'members'), 4);
  devEq_(R, 'statTagValue_ #active -> active', statTagValue_(s, 'active'), 1);
  devEq_(R, 'statTagValue_ #onleave -> leaves', statTagValue_(s, 'onleave'), 1);
  devEq_(R, 'statTagValue_ #openslots -> openSlots', statTagValue_(s, 'openslots'), 1);
  devEq_(R, 'statTagValue_ #hours -> totalHours', statTagValue_(s, 'hours'), 21);
  devEq_(R, 'statTagValue_ tier name (#inactive) resolves', statTagValue_(s, 'inactive'), 1);
  devEq_(R, 'statTagValue_ unknown tag -> null', statTagValue_(s, 'notarealtag'), null);

  devEq_(R, 'dashboardSkip_ tracker tab -> true', dashboardSkip_(CONFIG.sheets.tracker), true);
  devEq_(R, 'dashboardSkip_ form tab -> true', dashboardSkip_(CONFIG.sheets.form), true);
  devEq_(R, 'dashboardSkip_ hidden "_" tab -> true', dashboardSkip_('_hidden'), true);
  devEq_(R, 'dashboardSkip_ ordinary tab -> false', dashboardSkip_('Welcome'), false);

  return R;
}

/* ======================================================================
 * SECTION 18 — SETTINGS / VOCAB READERS (read-only): the settings + panel
 * readers resolve without throwing and return well-formed shapes.
 * ====================================================================== */
function devSettingsApplyTests_() {
  const R = devNewResults_('Settings apply (read-only)');

  // cpStatuses_ — the valid-status list the panel validates against.
  (() => {
    const st = cpStatuses_();
    devCheck_(R, 'cpStatuses_ returns a non-empty list', Array.isArray(st) && st.length > 0);
    devCheck_(R, 'cpStatuses_ includes the top tier (Active on defaults)', st.indexOf('Active') !== -1 || st.length > 0);
  })();

  // theme_ resolves the load-bearing keys.
  devCheck_(R, 'theme_ PASS non-empty', String(theme_('PASS')).length > 0);
  devCheck_(R, 'theme_ FAIL non-empty', String(theme_('FAIL')).length > 0);

  // cpGetConfig_ (reads the live ⚙️ Config, read-only) never throws and returns a blocks array.
  (() => {
    let threw = false, res = null;
    try { res = cpGetConfig_(); } catch (e) { threw = true; }
    devCheck_(R, 'cpGetConfig_ does not throw', !threw);
    devCheck_(R, 'cpGetConfig_ returns a blocks array', !!(res && Array.isArray(res.blocks)));
  })();

  // rankIconsMap_ returns a plain object (rank -> icon) without throwing.
  (() => {
    let threw = false, m = null;
    try { m = rankIconsMap_(); } catch (e) { threw = true; }
    devCheck_(R, 'rankIconsMap_ does not throw', !threw);
    devCheck_(R, 'rankIconsMap_ returns an object', m !== null && typeof m === 'object');
  })();

  return R;
}

/* ======================================================================
 * SECTION 19 — v1.0 EXTENSIONS (sandbox): patrol-log → hours (resolve /
 * duration / find / credit+dedup), promotion predicate, LAST ACTIVITY capture.
 * ====================================================================== */
function devV25Tests_() {
  const R = devNewResults_('v1.0 extensions (sandbox)');

  // patrolCols_ (header-keyword resolution)
  (() => {
    const p = devFreshSheet_('PatCols');
    p.getRange(1, 1, 1, 5).setValues([['Timestamp', 'Discord', 'Callsign', 'Start', 'End']]);
    const cols = patrolCols_(p);
    devEq_(R, 'patrolCols_ discord col', cols.discord, 2);
    devEq_(R, 'patrolCols_ callsign col', cols.callsign, 3);
    devEq_(R, 'patrolCols_ start col', cols.start, 4);
    devEq_(R, 'patrolCols_ end col', cols.end, 5);
  })();

  // patrolDuration_ (START_END default; overnight; max-hours + invalid guards)
  devEq_(R, 'patrolDuration_ 9:00->12:00 = 3h', patrolDuration_(new Date(2026, 0, 1, 9, 0, 0), new Date(2026, 0, 1, 12, 0, 0), null), 3);
  devEq_(R, 'patrolDuration_ over MAX_HOURS -> null', patrolDuration_(new Date(2026, 0, 1, 0, 0, 0), new Date(2026, 0, 1, 20, 0, 0), null), null);
  devEq_(R, 'patrolDuration_ invalid dates -> null', patrolDuration_('x', 'y', null), null);
  devEq_(R, 'patrolDuration_ overnight 22:00->02:00 = 4h', patrolDuration_(new Date(2026, 0, 1, 22, 0, 0), new Date(2026, 0, 1, 2, 0, 0), null), 4);

  // patrolFindRow_ (ID-first; callsign fallback only when unique)
  (() => {
    const ro = devBuildRoster_([
      { rank: 'Trooper', name: 'A', id: devId_(1), unit: 'S-1' },
      { rank: 'Trooper', name: 'B', id: devId_(2), unit: 'S-2' },
    ]);
    devEq_(R, 'patrolFindRow_ by ID', patrolFindRow_(ro, devId_(2), ''), CONFIG.rosterStartRow + 1);
    devEq_(R, 'patrolFindRow_ valid ID not on roster -> -1', patrolFindRow_(ro, devId_(999), ''), -1);
    devEq_(R, 'patrolFindRow_ by unique callsign (no ID)', patrolFindRow_(ro, '', 'S-1'), CONFIG.rosterStartRow);
    const amb = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(3), unit: 'S-9' }, { rank: 'Trooper', name: 'B', id: devId_(4), unit: 'S-9' }]);
    devEq_(R, 'patrolFindRow_ ambiguous callsign -> -1', patrolFindRow_(amb, '', 'S-9'), -1);
  })();

  // syncPatrolHours_ (credits hours to the matching member; durable dedup on re-run)
  (() => {
    const patrol = devFreshSheet_('Patrol');
    patrol.getRange(1, 1, 1, 5).setValues([['Timestamp', 'Discord', 'Callsign', 'Start', 'End']]);
    patrol.getRange(2, 1, 1, 5).setValues([[new Date(), '', 'S-1', new Date(2026, 0, 1, 9, 0, 0), new Date(2026, 0, 1, 12, 0, 0)]]);
    patrol.getRange(2, 2).setNumberFormat('@'); patrol.getRange(2, 2).setValue(devId_(1)); // exact discord id
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Pat', id: devId_(1), unit: 'S-1', activity: 'Active', hours: 5 }]);
    const RC = rosterCols_(ro);
    const s1 = syncPatrolHours_(patrol, ro, { sendWebhooks: false });
    devEq_(R, 'patrol credit: summary credited 1', s1.credited.length, 1);
    devEq_(R, 'patrol credit: 3h added to 5 -> 8', ro.getRange(CONFIG.rosterStartRow, RC.hours).getValue(), 8);
    const s2 = syncPatrolHours_(patrol, ro, { sendWebhooks: false });
    devEq_(R, 'patrol dedup: re-run credits nothing', s2.credited.length, 0);
    devEq_(R, 'patrol dedup: hours unchanged after re-run', ro.getRange(CONFIG.rosterStartRow, RC.hours).getValue(), 8);
  })();

  // promoIsPromotion_ (pure predicate)
  devEq_(R, 'promoIsPromotion_ up the sheet + rank change -> true', promoIsPromotion_(10, 5, 'Trooper', 'Sergeant'), true);
  devEq_(R, 'promoIsPromotion_ down the sheet -> false', promoIsPromotion_(5, 10, 'Trooper', 'Sergeant'), false);
  devEq_(R, 'promoIsPromotion_ same rank -> false', promoIsPromotion_(10, 5, 'Trooper', 'Trooper'), false);
  devEq_(R, 'promoIsPromotion_ unknown dest rank -> false', promoIsPromotion_(10, 5, 'Trooper', 'Unknown'), false);

  // captureLastActivityCore_ (optional LAST ACTIVITY column)
  (() => {
    const roNo = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(50), activity: 'Active', hours: 12 }]);
    devEq_(R, 'captureLastActivityCore_ no LAST ACTIVITY col -> -1', captureLastActivityCore_(roNo), -1);
    const roLA = devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(51), activity: 'Active', hours: 12 }]);
    roLA.getRange(ROSTER_HEADER_ROW, 10).setValue('LAST ACTIVITY'); // header row, col J
    devEq_(R, 'captureLastActivityCore_ copies each member activity', captureLastActivityCore_(roLA), 1);
    devEq_(R, 'captureLastActivityCore_ mirrors ACTIVITY into LAST ACTIVITY', roLA.getRange(CONFIG.rosterStartRow, 10).getDisplayValue(), 'Active');
  })();

  return R;
}

/* ======================================================================
 * SECTION 20 — NEW-LAYOUT COLUMN RESOLUTION (sandbox): rosterCols_ against a
 * two-row banner+label header with a merged RANK GROUP band, renamed labels
 * (STATUS, UNIQUE ID) and the optional display columns; classic layout still
 * resolves; fillTimeInRank_ + shiftArchiveColumns_ on the richer layout.
 * ====================================================================== */
function devNewLayoutTests_() {
  const R = devNewResults_('New-layout column resolution (sandbox)');

  const LABELS = ['RANK GROUP', 'RANK', 'UNIT NUMBER', 'OOC NAME', 'NAME', 'UNIQUE ID', 'SHIFT', 'HOURS', 'STATUS', 'MAY HOURS', 'JUN. HOURS', 'JOIN DATE', 'TIME IN RANK', 'LAST PROMOTION'];
  const buildNL = (suffix) => {
    const sh = devFreshSheet_(suffix);
    sh.getRange(5, 2, 1, 14).setValues([['MEMBER INFORMATION', '', '', '', '', '', '', 'ACTIVITY', '', 'PERIOD HOURS', '', 'TENURE', '', '']]); // banner row (partial)
    sh.getRange(6, 2, 1, 14).setValues([LABELS]);                                                                                            // label row (auto-detected)
    // Member data at the CONFIGURED first-data row (not hardcoded) — fillTimeInRank_/shiftArchiveColumns_ read from CONFIG.rosterStartRow.
    sh.getRange(CONFIG.rosterStartRow, 2, 1, 14).setValues([['DEPARTMENT MEMBERS', 'Trooper', 'S-01', 'John D.', 'John Doe', devId_(1), 'Day', 12, 'Active', 5, 6, '', '', '']]);
    return sh;
  };

  // rosterCols_ resolves EVERY column on the two-row layout (auto-detected label row).
  (() => {
    const sh = buildNL('NewLayout');
    const RC = rosterCols_(sh);
    devEq_(R, 'auto-finds the label row (row 6)', RC.headerRow, 6);
    devEq_(R, 'rank = C (RANK, skips RANK GROUP)', RC.rank, 3);
    devEq_(R, 'unit = D (UNIT NUMBER)', RC.unit, 4);
    devEq_(R, 'ooc = E (OOC NAME)', RC.ooc, 5);
    devEq_(R, 'name = F (NAME, skips OOC NAME)', RC.name, 6);
    devEq_(R, 'discord = G (UNIQUE ID, no "Discord" text)', RC.discord, 7);
    devEq_(R, 'shift = H (SHIFT)', RC.shift, 8);
    devEq_(R, 'hours = I (first HOURS, not MAY/JUN)', RC.hours, 9);
    devEq_(R, 'activity = J (STATUS)', RC.activity, 10);
    devEq_(R, 'mayHours = K (MAY HOURS)', RC.mayHours, 11);
    devEq_(R, 'junHours = L (JUN. HOURS)', RC.junHours, 12);
    devEq_(R, 'join = M (JOIN DATE)', RC.join, 13);
    devEq_(R, 'timeInRank = N (TIME IN RANK)', RC.timeInRank, 14);
    devEq_(R, 'promo = O (LAST PROMOTION)', RC.promo, 15);
  })();

  // Classic layout: core columns resolve; optional columns absent -> 0; legacy ACTIVITY label works.
  (() => {
    const cl = rosterCols_(devBuildRoster_([{ rank: 'Trooper', name: 'A', id: devId_(2), activity: 'Active', hours: 5 }]));
    devEq_(R, 'classic layout: activity still col 8', cl.activity, 8);
    devEq_(R, 'classic layout: discord still col 5', cl.discord, 5);
    devEq_(R, 'classic layout: legacy "ACTIVITY" label resolves as activity', cl.activity > 0, true);
    devEq_(R, 'optional OOC absent -> 0', cl.ooc, 0);
    devEq_(R, 'optional SHIFT absent -> 0', cl.shift, 0);
    devEq_(R, 'optional MAY HOURS absent -> 0', cl.mayHours, 0);
    devEq_(R, 'optional TIME IN RANK absent -> 0', cl.timeInRank, 0);
  })();

  // fillTimeInRank_ writes a live TODAY() formula on the member row (needs TIME IN RANK + LAST PROMOTION).
  (() => {
    const sh = buildNL('NLTir');
    const cnt = fillTimeInRank_(sh);
    devCheck_(R, 'fillTimeInRank_ reports >= 1 member filled', cnt >= 1);
    devCheck_(R, 'fillTimeInRank_ writes a live TODAY() formula', sh.getRange(CONFIG.rosterStartRow, 14).getFormula().indexOf('TODAY(') !== -1);
  })();

  // shiftArchiveColumns_ rolls the period columns LEFT; the rightmost takes the current HOURS under the new label.
  (() => {
    const sh = buildNL('NLArch');
    const shifted = shiftArchiveColumns_(sh, 'JUL HOURS');
    devEq_(R, 'shiftArchiveColumns_ reports 2 period columns', shifted, 2);
    devEq_(R, 'archive relabel: right header = new period label', sh.getRange(6, 12).getDisplayValue(), 'JUL HOURS');
    devEq_(R, 'archive relabel: left header = previous right header', sh.getRange(6, 11).getDisplayValue(), 'JUN. HOURS');
    devEq_(R, 'archive shift: right col took current HOURS (12)', sh.getRange(CONFIG.rosterStartRow, 12).getValue(), 12);
    devEq_(R, 'archive shift: left col took the next period (JUN=6)', sh.getRange(CONFIG.rosterStartRow, 11).getValue(), 6);
  })();

  return R;
}

/* ======================================================================
 * SECTION 21 — PATROL LOG TRACKER (sandbox): header resolution, member
 * auto-fill, TOTAL TIME, the four auto-flags (unknown ID / end≤start /
 * future / over-max), immediate + idempotent + delta-adjusting hours
 * crediting, reverse-on-flag / reverse-on-delete, and the status sort.
 * ====================================================================== */
function devPatrolLogTests_() {
  const R = devNewResults_('Patrol Log tracker (sandbox)');
  const PS = CONFIG.patrolStartRow;
  const HRS = CONFIG.roster.hours; // sandbox roster HOURS column (positional fallback = 9)
  const rosterHrs = (ro) => parseHours_(ro.getRange(CONFIG.rosterStartRow, HRS).getValue());

  // Header resolution on the user's exact layout (START DATE vs START TIME, NAME vs OOC NAME).
  (() => {
    const PC = patrolLogCols_(devBuildPatrolLog_([]));
    devEq_(R, 'patrolLogCols_ mark = A', PC.mark, 1);
    devEq_(R, 'patrolLogCols_ RANK = B', PC.rank, 2);
    devEq_(R, 'patrolLogCols_ OOC NAME = D', PC.ooc, 4);
    devEq_(R, 'patrolLogCols_ NAME = E (not OOC NAME)', PC.name, 5);
    devEq_(R, 'patrolLogCols_ UNIQUE ID = F', PC.discord, 6);
    devEq_(R, 'patrolLogCols_ START DATE = H (not START TIME)', PC.startDate, 8);
    devEq_(R, 'patrolLogCols_ END DATE = I', PC.endDate, 9);
    devEq_(R, 'patrolLogCols_ START TIME = J', PC.startTime, 10);
    devEq_(R, 'patrolLogCols_ END TIME = K', PC.endTime, 11);
    devEq_(R, 'patrolLogCols_ TOTAL = L', PC.total, 12);
    devEq_(R, 'patrolLogCols_ STATUS = M', PC.status, 13);
    devEq_(R, 'patrolLogCols_ NOTES = N', PC.notes, 14);
  })();

  // Valid log: auto-fills identity, computes TOTAL, credits hours immediately, marks the row — then idempotent + delta.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Sergeant', name: 'Pat Valid', id: devId_(70), unit: 'S-7', activity: 'Active', hours: 10 }]);
    const pl = devBuildPatrolLog_([{ id: devId_(70), startDate: devDay_(-1), startTime: devTime_(9, 0), endDate: devDay_(-1), endTime: devTime_(12, 0) }]);
    const PC = patrolLogCols_(pl);
    processPatrolLog_(pl, PS, PC, ro);
    devEq_(R, 'valid: auto-fills member NAME from roster', String(pl.getRange(PS, PC.name).getDisplayValue()).trim(), 'Pat Valid');
    devEq_(R, 'valid: auto-fills member RANK from roster', String(pl.getRange(PS, PC.rank).getDisplayValue()).trim(), 'Sergeant');
    devEq_(R, 'valid: status -> Processed (auto)', String(pl.getRange(PS, PC.status).getDisplayValue()).trim(), CONFIG.patrol.processedStatus);
    devCheck_(R, 'valid: TOTAL TIME is a live formula', pl.getRange(PS, PC.total).getFormula().indexOf('ISNUMBER(') !== -1);
    devEq_(R, 'valid: credits 3 hrs immediately (10 -> 13)', rosterHrs(ro), 13);
    devCheck_(R, 'valid: writes the "hours|id" credited marker', String(pl.getRange(PS, PC.mark).getDisplayValue()).indexOf('3|') === 0);
    processPatrolLog_(pl, PS, PC, ro);
    devEq_(R, 'idempotent: re-process does NOT double-credit (still 13)', rosterHrs(ro), 13);
    pl.getRange(PS, PC.endTime).setValue(devTime_(14, 0)); // 3h -> 5h
    processPatrolLog_(pl, PS, PC, ro);
    devEq_(R, 'edit: delta re-credits (5 hrs -> roster 15)', rosterHrs(ro), 15);
  })();

  // Each of the four flags: status -> Flagged, a reason in NOTES, nothing credited.
  const flagCase = (label, log, reasonPart) => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'FlagMe', id: devId_(71), activity: 'Active', hours: 8 }]);
    const pl = devBuildPatrolLog_([{ id: log.id === undefined ? devId_(71) : log.id, startDate: log.startDate, startTime: log.startTime, endDate: log.endDate, endTime: log.endTime }]);
    const PC = patrolLogCols_(pl);
    processPatrolLog_(pl, PS, PC, ro);
    devEq_(R, `flag(${label}): status -> Flagged`, String(pl.getRange(PS, PC.status).getDisplayValue()).trim(), CONFIG.patrol.flaggedStatus);
    devCheck_(R, `flag(${label}): NOTES reason mentions "${reasonPart}"`, String(pl.getRange(PS, PC.notes).getDisplayValue()).toLowerCase().indexOf(reasonPart) !== -1);
    devEq_(R, `flag(${label}): no hours credited (stays 8)`, rosterHrs(ro), 8);
  };
  flagCase('end<=start', { startDate: devDay_(-1), startTime: devTime_(12, 0), endDate: devDay_(-1), endTime: devTime_(9, 0) }, 'not after');
  flagCase('over-max', { startDate: devDay_(-1), startTime: devTime_(2, 0), endDate: devDay_(-1), endTime: devTime_(22, 0) }, 'max'); // 20h: advisory
  flagCase('over-a-day', { startDate: devDay_(-3), startTime: devTime_(0, 0), endDate: devDay_(-1), endTime: devTime_(0, 0) }, '24'); // 48h: blocking
  flagCase('future', { startDate: devDay_(1), startTime: devTime_(9, 0), endDate: devDay_(1), endTime: devTime_(12, 0) }, 'future');
  flagCase('unknown-id', { id: devId_(999), startDate: devDay_(-1), startTime: devTime_(9, 0), endDate: devDay_(-1), endTime: devTime_(12, 0) }, 'roster');

  // Admin override: an ADVISORY flag (over-max / future) is approved by moving STATUS to Processed → the hours credit.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Over', id: devId_(80), activity: 'Active', hours: 6 }]);
    const pl = devBuildPatrolLog_([{ id: devId_(80), startDate: devDay_(-1), startTime: devTime_(2, 0), endDate: devDay_(-1), endTime: devTime_(22, 0) }]); // 20h → over-max
    const PC = patrolLogCols_(pl);
    processPatrolLog_(pl, PS, PC, ro);
    devEq_(R, 'override: over-max starts Flagged', String(pl.getRange(PS, PC.status).getDisplayValue()).trim(), CONFIG.patrol.flaggedStatus);
    devEq_(R, 'override: nothing credited while Flagged (stays 6)', rosterHrs(ro), 6);
    pl.getRange(PS, PC.status).setValue(CONFIG.patrol.processedStatus); // admin reviews + approves by processing
    processPatrolLog_(pl, PS, PC, ro);
    devEq_(R, 'override: processing credits 20 hrs (6 -> 26)', rosterHrs(ro), 26);
    devEq_(R, 'override: status stays Processed', String(pl.getRange(PS, PC.status).getDisplayValue()).trim(), CONFIG.patrol.processedStatus);
    devCheck_(R, 'override: NOTES keeps an "Override" trace', String(pl.getRange(PS, PC.notes).getDisplayValue()).toLowerCase().indexOf('override') !== -1);
  })();

  // A BLOCKING flag (end<=start) can NOT be approved by processing — the data must be fixed first.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Block', id: devId_(81), activity: 'Active', hours: 3 }]);
    const pl = devBuildPatrolLog_([{ id: devId_(81), startDate: devDay_(-1), startTime: devTime_(12, 0), endDate: devDay_(-1), endTime: devTime_(9, 0) }]); // end < start
    const PC = patrolLogCols_(pl);
    processPatrolLog_(pl, PS, PC, ro);
    pl.getRange(PS, PC.status).setValue(CONFIG.patrol.processedStatus); // admin tries to process without fixing
    processPatrolLog_(pl, PS, PC, ro);
    devEq_(R, 'blocking: status snaps back to Flagged', String(pl.getRange(PS, PC.status).getDisplayValue()).trim(), CONFIG.patrol.flaggedStatus);
    devEq_(R, 'blocking: still not credited (stays 3)', rosterHrs(ro), 3);
    pl.getRange(PS, PC.endTime).setValue(devTime_(15, 0)); // fix: 12:00 -> 15:00 = 3h valid
    processPatrolLog_(pl, PS, PC, ro);
    devEq_(R, 'blocking: fixing the data auto-processes it', String(pl.getRange(PS, PC.status).getDisplayValue()).trim(), CONFIG.patrol.processedStatus);
    devEq_(R, 'blocking: and credits 3 hrs (3 -> 6)', rosterHrs(ro), 6);
  })();

  // A credited log edited to invalid REVERSES its credit and flags.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Rev', id: devId_(72), activity: 'Active', hours: 5 }]);
    const pl = devBuildPatrolLog_([{ id: devId_(72), startDate: devDay_(-1), startTime: devTime_(9, 0), endDate: devDay_(-1), endTime: devTime_(11, 0) }]);
    const PC = patrolLogCols_(pl);
    processPatrolLog_(pl, PS, PC, ro);
    devEq_(R, 'reverse: credited 2 (5 -> 7)', rosterHrs(ro), 7);
    pl.getRange(PS, PC.endTime).setValue(devTime_(8, 0)); // end < start now
    processPatrolLog_(pl, PS, PC, ro);
    devEq_(R, 'reverse: flag un-credits (back to 5)', rosterHrs(ro), 5);
    devCheck_(R, 'reverse: marker cleared', String(pl.getRange(PS, PC.mark).getDisplayValue()).trim() === '');
  })();

  // Deleting a credited log's CELLS (col A marker survives) reverses the credit.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Del', id: devId_(73), activity: 'Active', hours: 4 }]);
    const pl = devBuildPatrolLog_([{ id: devId_(73), startDate: devDay_(-1), startTime: devTime_(9, 0), endDate: devDay_(-1), endTime: devTime_(13, 0) }]);
    const PC = patrolLogCols_(pl);
    processPatrolLog_(pl, PS, PC, ro);
    devEq_(R, 'delete: credited 4 (4 -> 8)', rosterHrs(ro), 8);
    pl.getRange(PS, 2, 1, PC.width - 1).clearContent(); // clear B..N (visible cells); the col-A marker survives
    processPatrolLog_(pl, PS, PC, ro);
    devEq_(R, 'delete: cleared row reverses the credit (back to 4)', rosterHrs(ro), 4);
  })();

  // Status sort: Pending -> Flagged -> Processed.
  (() => {
    const pl = devBuildPatrolLog_([
      { id: devId_(74), name: 'Proc', status: CONFIG.patrol.processedStatus },
      { id: devId_(75), name: 'Flag', status: CONFIG.patrol.flaggedStatus },
      { id: devId_(76), name: 'Pend', status: CONFIG.patrol.pendingStatus },
    ]);
    sortPatrolLog_(pl);
    const PC = patrolLogCols_(pl);
    devEq_(R, 'sort: row0 = Pending', String(pl.getRange(PS, PC.status).getDisplayValue()).trim(), CONFIG.patrol.pendingStatus);
    devEq_(R, 'sort: row1 = Flagged', String(pl.getRange(PS + 1, PC.status).getDisplayValue()).trim(), CONFIG.patrol.flaggedStatus);
    devEq_(R, 'sort: row2 = Processed', String(pl.getRange(PS + 2, PC.status).getDisplayValue()).trim(), CONFIG.patrol.processedStatus);
  })();

  return R;
}

/* ======================================================================
 * SECTION 23 — ROSTER SIGNUPS (sandbox): header resolution, the Pending →
 * Approved → Processed sort, the review queue, and approveSignup_ — including
 * its refusals and the "Processed is stamped LAST" guarantee.
 * ====================================================================== */
function devSignupTests_() {
  const R = devNewResults_('Roster Signups (sandbox)');
  const S = { name: 2, ooc: 3, id: 4, email: 5, dob: 6, phone: 7, status: 12 };  // signup tab
  const g = (sh, r, c) => String(sh.getRange(r, c).getDisplayValue()).trim();

  // Header resolution — the form's real question titles, and free-text columns claim nothing.
  (() => {
    const SC = signupCols_(devBuildSignups_([]));
    devEq_(R, 'signupCols_ "Name (in-character)" = 2', SC.name, 2);
    devEq_(R, 'signupCols_ OOC Name = 3', SC.ooc, 3);
    devEq_(R, 'signupCols_ Unique ID = 4', SC.discord, 4);
    devEq_(R, 'signupCols_ Email = 5', SC.email, 5);
    devEq_(R, 'signupCols_ Date of Birth = 6', SC.dob, 6);
    devEq_(R, 'signupCols_ Phone = 7', SC.phone, 7);
    devEq_(R, 'signupCols_ Status = 12', SC.status, 12);
    const claimed = [SC.name, SC.ooc, SC.discord, SC.email, SC.dob, SC.phone, SC.status, SC.notes];
    devCheck_(R, 'signupCols_ leaves "Why do you want to join?" unclaimed', claimed.indexOf(11) === -1);
    devCheck_(R, 'signupCols_ leaves "Prior Experience" unclaimed', claimed.indexOf(8) === -1);
  })();

  // Sort: a blank status becomes Pending, then Pending → Approved → Processed.
  (() => {
    const sh = devBuildSignups_([
      { name: 'P3', id: devId_(91), status: 'Processed' },
      { name: 'A2', id: devId_(92), status: 'Approved' },
      { name: 'P1', id: devId_(93), status: '' }, // a fresh submission
    ]);
    devEq_(R, 'sort: all three rows kept', sortSignups_(sh), 3);
    devEq_(R, 'sort: row0 = Pending', g(sh, 2, S.status), 'Pending');
    devEq_(R, 'sort: row1 = Approved', g(sh, 3, S.status), 'Approved');
    devEq_(R, 'sort: row2 = Processed', g(sh, 4, S.status), 'Processed');
    devEq_(R, 'sort: the blank-status submission is the one stamped Pending', g(sh, 2, S.name), 'P1');
  })();

  // The review queue shows what still needs action and hides what's done.
  (() => {
    const q = signupQueue_(devBuildSignups_([
      { name: 'Q1', id: devId_(94), status: 'Pending' },
      { name: 'Q2', id: devId_(95), status: 'Processed' },
      { name: 'Q3', id: devId_(96), status: 'Approved' },
    ]), 50);
    devEq_(R, 'queue: 2 signups awaiting action', q.length, 2);
    devCheck_(R, 'queue: Processed is excluded', q.every((x) => x.name !== 'Q2'));
    devCheck_(R, 'queue: carries the private details through', q.some((x) => x.name === 'Q1'));
  })();

  // Approve: member lands in the slot, PII lands on the Internal Roster, signup flips to Processed.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Existing', id: devId_(97), activity: 'Active', hours: 5 }, { rank: 'Trooper', name: '', id: '' }]);
    ro.getRange(5, 10, 1, 3).setValues([['EMAIL', 'DATE OF BIRTH', 'PHONE']]); // private columns an INTERNAL roster carries
    const sh = devBuildSignups_([{ name: 'Recruit', ooc: 'Rec OOC', id: devId_(98), email: 'rec@dept.test', dob: '1995-03-03', phone: '555-0100', status: 'Approved' }]);
    const slot = CONFIG.rosterStartRow + 1;
    const res = approveSignup_(sh, 2, ro, slot);
    devEq_(R, 'approve: name written into the chosen slot', g(ro, slot, CONFIG.roster.name), 'Recruit');
    devEq_(R, 'approve: Unique ID written exactly', g(ro, slot, CONFIG.roster.discord), devId_(98));
    devEq_(R, 'approve: signup stamped Processed', g(sh, 2, S.status), 'Processed');
    devEq_(R, 'approve: email written onto the member roster row itself', g(ro, slot, 10), 'rec@dept.test');
    devEq_(R, 'approve: DOB written privately', g(ro, slot, 11), '1995-03-03');
    devEq_(R, 'approve: phone written privately', g(ro, slot, 12), '555-0100');
    devCheck_(R, 'approve: reports the private fields it copied', res.piiWritten >= 3);
    devEq_(R, 'approve: the already-filled row was not disturbed', g(ro, CONFIG.rosterStartRow, CONFIG.roster.name), 'Existing');
  })();

  // Someone already on the roster can't be added twice.
  (() => {
    const dup = devId_(99);
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Already', id: dup, activity: 'Active', hours: 5 }, { rank: 'Trooper', name: '', id: '' }]);
    const sh = devBuildSignups_([{ name: 'Dupe', id: dup, email: 'd@x.test', status: 'Approved' }]);
    let threw = false;
    try { approveSignup_(sh, 2, ro, CONFIG.rosterStartRow + 1); } catch (e) { threw = true; }
    devCheck_(R, 'duplicate ID: refused', threw);
    devEq_(R, 'duplicate ID: signup left actionable', g(sh, 2, S.status), 'Approved');
    devEq_(R, 'duplicate ID: the open slot stayed empty', g(ro, CONFIG.rosterStartRow + 1, CONFIG.roster.name), '');
  })();

  // A malformed Unique ID is refused before anything is written anywhere.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: '', id: '' }]);
    const sh = devBuildSignups_([{ name: 'NoId', id: devBadId_(), status: 'Approved' }]);
    let threw = false;
    try { approveSignup_(sh, 2, ro, CONFIG.rosterStartRow); } catch (e) { threw = true; }
    devCheck_(R, 'bad ID: refused', threw);
    devEq_(R, 'bad ID: signup left actionable', g(sh, 2, S.status), 'Approved');
    devEq_(R, 'bad ID: nothing written to the roster', g(ro, CONFIG.rosterStartRow, CONFIG.roster.name), '');
  })();

  // PROCESSED IS STAMPED LAST — a failed roster write must never mark the signup done.
  (() => {
    const ro = devBuildRoster_([{ rank: 'Trooper', name: 'Taken', id: devId_(100), activity: 'Active', hours: 5 }]);
    const sh = devBuildSignups_([{ name: 'Late', id: devId_(101), status: 'Approved' }]);
    let threw = false;
    try { approveSignup_(sh, 2, ro, CONFIG.rosterStartRow); } catch (e) { threw = true; } // that slot is filled
    devCheck_(R, 'stamped-last: a filled slot is refused', threw);
    devEq_(R, 'stamped-last: signup is still actionable, not Processed', g(sh, 2, S.status), 'Approved');
    devEq_(R, 'stamped-last: the occupant was not overwritten', g(ro, CONFIG.rosterStartRow, CONFIG.roster.name), 'Taken');
  })();

  return R;
}

/* ======================================================================
 * SECTION 23 — PUBLIC ROSTER PUBLISH (sandbox): the one-way export and,
 * above all, the allow-list guarantee — a private column must never appear
 * in the published copy no matter where it sits.
 * ====================================================================== */
function devPublishTests_() {
  const R = devNewResults_('Public roster publish (sandbox)');
  const g = (sh, r, c) => String(sh.getRange(r, c).getDisplayValue()).trim();

  // A public tab shaped like a COPY of the internal roster receives data matched BY HEADER.
  (() => {
    const src = devFreshSheet_('PubSrc');
    src.getRange(5, 1, 1, 6).setValues([['RANK', 'UNIT NUMBER', 'NAME', 'UNIQUE ID', 'HOURS', 'EMAIL']]);
    src.getRange(6, 4, 2, 1).setNumberFormat('@'); // IDs are text on the real roster ('@') — keep them exact here too
    src.getRange(6, 1, 2, 6).setValues([
      ['Sergeant', 'S-1', 'Pub One', devId_(60), 12, 'a@b.test'],
      ['Trooper', 'S-2', 'Pub Two', devId_(61), 4, 'c@d.test'],
    ]);
    // The public copy kept UNIQUE ID and EMAIL columns, and reordered the rest.
    const dest = devFreshSheet_('PubDest');
    if (dest.getMaxColumns() > 6) dest.deleteColumns(7, dest.getMaxColumns() - 6); // narrower GRID → header-matching
    dest.getRange(5, 1, 1, 6).setValues([['NAME', 'RANK', 'UNIQUE ID', 'HOURS', 'EMAIL', 'UNIT NUMBER']]);
    dest.getRange(6, 3, 2, 1).setNumberFormat('@'); // a real public copy inherits '@' on the ID column from the tab copy
    const n = publishMirrorTab_(src, dest);
    devEq_(R, 'mirror: both rows copied', n, 2);
    devEq_(R, 'mirror: NAME matched by header despite reorder', g(dest, 6, 1), 'Pub One');
    devEq_(R, 'mirror: RANK matched by header', g(dest, 6, 2), 'Sergeant');
    devEq_(R, 'mirror: HOURS matched by header', g(dest, 6, 4), '12');
    devEq_(R, 'mirror: UNIT NUMBER matched by header', g(dest, 7, 6), 'S-2');
    devEq_(R, 'design: Unique ID IS published, exactly (user choice — IDs are not PII here)', g(dest, 6, 3), devId_(60));
    devEq_(R, 'SENSITIVE: email never written', g(dest, 6, 5), '');
  })();

  // Stale SENSITIVE values a copy brought along are WIPED — but the Unique ID is not sensitive (user choice) and stays.
  (() => {
    const src = devFreshSheet_('PubSrc2');
    src.getRange(5, 1, 1, 3).setValues([['NAME', 'UNIQUE ID', 'EMAIL']]);
    src.getRange(6, 2).setNumberFormat('@');
    src.getRange(6, 1, 1, 3).setValues([['Scrub', devId_(62), 'live@dept.test']]);
    const dest = devFreshSheet_('PubDest2');
    if (dest.getMaxColumns() > 3) dest.deleteColumns(4, dest.getMaxColumns() - 3); // narrower GRID → header-matching
    dest.getRange(5, 1, 1, 3).setValues([['NAME', 'UNIQUE ID', 'EMAIL']]);
    dest.getRange(6, 2).setNumberFormat('@');
    dest.getRange(6, 1, 1, 3).setValues([['Scrub', devId_(62), 'stale@dept.test']]); // came across in the copy
    publishMirrorTab_(src, dest);
    devEq_(R, 'scrub: Unique ID kept (IDs publish by design)', g(dest, 6, 2), devId_(62));
    devEq_(R, 'scrub: copied email wiped', g(dest, 6, 3), '');
    devEq_(R, 'scrub: public data still updated', g(dest, 6, 1), 'Scrub');
  })();

  // A column the public tab does NOT have is simply not published (its tab list/headers are the spec).
  (() => {
    const src = devFreshSheet_('PubSrc3');
    src.getRange(5, 1, 1, 3).setValues([['NAME', 'HOURS', 'JOIN DATE']]);
    src.getRange(6, 1, 1, 3).setValues([['Keep', 9, '2020-01-01']]);
    const dest = devFreshSheet_('PubDest3');
    dest.getRange(5, 1, 1, 2).setValues([['NAME', 'HOURS']]); // JOIN DATE deleted from the public copy
    if (dest.getMaxColumns() > 2) dest.deleteColumns(3, dest.getMaxColumns() - 2); // narrower GRID → header-matching
    publishMirrorTab_(src, dest);
    devEq_(R, 'omitted column: name published', g(dest, 6, 1), 'Keep');
    devEq_(R, 'omitted column: hours published', g(dest, 6, 2), '9');
    const flat = dest.getRange(1, 1, Math.max(dest.getLastRow(), 1), Math.max(dest.getLastColumn(), 1))
      .getDisplayValues().reduce((a, r) => a.concat(r), []).join(' | ');
    devCheck_(R, 'omitted column: join date never appears', flat.indexOf('2020-01-01') === -1);
  })();

  // Shrinking the source clears the leftover rows (no ghost members).
  (() => {
    const src = devFreshSheet_('PubSrc4');
    src.getRange(5, 1, 1, 1).setValues([['NAME']]);
    src.getRange(6, 1, 2, 1).setValues([['Stay'], ['Leaver']]);
    const dest = devFreshSheet_('PubDest4');
    dest.getRange(5, 1, 1, 1).setValues([['NAME']]);
    publishMirrorTab_(src, dest);
    devEq_(R, 'shrink: both rows present first', g(dest, 7, 1), 'Leaver');
    src.getRange(7, 1).clearContent();
    publishMirrorTab_(src, dest);
    devEq_(R, 'shrink: departed row cleared', g(dest, 7, 1), '');
    devEq_(R, 'shrink: remaining row survives', g(dest, 6, 1), 'Stay');
  })();

  // Tab-level blocks: private tabs are never mirrored even if a same-named tab exists publicly.
  (() => {
    ['⚙️ Config', 'Webhooks', 'Disciplinary Log', 'Roster Signups', 'Edit Log', '_Snapshots', '_Hours History']
      .forEach((t) => devCheck_(R, 'blocked tab: ' + t, publishTabBlocked_(t) === true));
    ['Member Information', 'LOA Tracker', 'Day Shift', 'Police Academy', 'Welcome Page']
      .forEach((t) => devCheck_(R, 'publishable tab: ' + t, publishTabBlocked_(t) === false));
  })();

  // Sensitive-header detection. NEVER_PUBLISH defaults to EMAIL/DOB/PHONE/ADDRESS only — Unique/Discord/Community
  // IDs PUBLISH by explicit user choice (members find themselves by ID on the public roster). 'DOB' must match exactly.
  (() => {
    ['Email', 'Date of Birth', 'Phone', 'Home Address', 'DOB']
      .forEach((h) => devCheck_(R, 'sensitive: ' + h, publishSensitiveHeader_(h) === true));
    ['UNIQUE ID', 'Discord ID', 'Community ID', 'CID', 'NAME', 'OOC NAME', 'RANK', 'UNIT NUMBER', 'SHIFT', 'HOURS', 'STATUS', 'Accidents', 'Decided']
      .forEach((h) => devCheck_(R, 'not sensitive: ' + h, publishSensitiveHeader_(h) === false));
  })();

  // DASHBOARD LAYOUT: an untouched copy is mirrored WHOLESALE, so boxes at fixed cells (leadership names, promotions,
  // leaderboard hours) come across — column-matching alone would leave them blank.
  (() => {
    const src = devFreshSheet_('PubDash');
    src.getRange(2, 2).setValue('LEADERSHIP');
    src.getRange(3, 2, 2, 2).setValues([['Chief of Police', 'James Bennett'], ['Major', 'Aisha Nguyen']]);
    src.getRange(8, 2).setValue('PATROL LEADERBOARD');
    src.getRange(9, 2, 1, 3).setValues([['RANK', 'NAME', 'HOURS']]);
    src.getRange(10, 2, 2, 3).setValues([[1, 'Chen Reyes', 28.5], [2, 'Maria Nguyen', 24.25]]);
    const dest = devFreshSheet_('PubDashDest');
    // an untouched tab copy: SAME WIDTH as the source but the dynamic values blank (never published yet).
    dest.getRange(9, 2, 1, 3).setValues([['RANK', 'NAME', 'HOURS']]);
    const n = publishMirrorTab_(src, dest);
    devCheck_(R, 'dashboard: rows mirrored', n > 0);
    devEq_(R, 'dashboard: leadership NAME at a fixed cell copied', g(dest, 3, 3), 'James Bennett');
    devEq_(R, 'dashboard: second leadership row copied', g(dest, 4, 3), 'Aisha Nguyen');
    devEq_(R, 'dashboard: leaderboard HOURS copied', g(dest, 10, 4), '28.5');
    devEq_(R, 'dashboard: section title copied', g(dest, 2, 2), 'LEADERSHIP');
  })();

  // Wholesale mirroring: sensitive columns are blanked BEFORE the write; the Unique ID column is not sensitive and mirrors.
  (() => {
    const src = devFreshSheet_('PubDash2');
    src.getRange(1, 1, 1, 4).setValues([['NAME', 'UNIQUE ID', 'HOURS', 'EMAIL']]);
    src.getRange(2, 2).setNumberFormat('@');
    src.getRange(2, 1, 1, 4).setValues([['Whole', devId_(67), 5, 'w@d.test']]);
    const dest = devFreshSheet_('PubDash2D');
    dest.getRange(1, 1, 1, 4).setValues([['NAME', 'UNIQUE ID', 'HOURS', 'EMAIL']]);
    dest.getRange(2, 2).setNumberFormat('@');
    publishMirrorTab_(src, dest);
    devEq_(R, 'wholesale: name mirrored', g(dest, 2, 1), 'Whole');
    devEq_(R, 'wholesale: hours mirrored', g(dest, 2, 3), '5');
    devEq_(R, 'wholesale: Unique ID mirrored exactly (user choice)', g(dest, 2, 2), devId_(67));
    devEq_(R, 'wholesale: EMAIL never written (blanked pre-write)', g(dest, 2, 4), '');
  })();

  // PRESERVED CELLS: the public copy's own formulas and any configured keep-range are never overwritten.
  (() => {
    const src = devFreshSheet_('PubKeepSrc');
    src.getRange(1, 1, 1, 3).setValues([['TITLE', 'NAME', 'WHEN']]);
    src.getRange(2, 1, 1, 3).setValues([['INTERNAL DEPARTMENT ROSTER', 'Alice', 'internal-time']]);
    const dest = devFreshSheet_('PubKeepDest');
    dest.getRange(1, 1, 1, 3).setValues([['TITLE', 'NAME', 'WHEN']]);
    dest.getRange(2, 1).setValue('PUBLIC DEPARTMENT ROSTER'); // static text that must differ
    dest.getRange(2, 2).setValue('');
    dest.getRange(2, 3).setFormula('=UPPER("live")');          // the public copy computes this itself
    const keep = publishKeepMask_(dest, 1, 1, 2, 3);
    devCheck_(R, 'keep: a destination FORMULA cell is masked', keep[1][2] === true);
    devCheck_(R, 'keep: an ordinary destination cell is not masked', keep[1][1] === false);
    writeValuesSafe_(dest, 1, 1, src.getRange(1, 1, 2, 3).getValues(), keep);
    devEq_(R, 'keep: normal cell still published', g(dest, 2, 2), 'Alice');
    devEq_(R, 'keep: the public formula survived (not frozen to a copied value)', dest.getRange(2, 3).getFormula(), '=UPPER("live")');
  })();

  // A configured KEEP_RANGE protects static text that is meant to differ between the two files.
  (() => {
    // NB: the range's tab name must match the DESTINATION sheet's real name — which is the sandbox-prefixed one here.
    devWithConfig_({ PUBLISH: { kind: 'kv', kv: { KEEP_RANGES: SANDBOX_PREFIX + 'PubTitleDest!A2:B2' } } }, () => {
      const src = devFreshSheet_('PubTitleSrc');
      src.getRange(1, 1, 1, 2).setValues([['TITLE', 'SUB']]);
      src.getRange(2, 1, 1, 2).setValues([['INTERNAL ROSTER', 'internal sub']]);
      const dest = devFreshSheet_('PubTitleDest');
      dest.getRange(1, 1, 1, 2).setValues([['TITLE', 'SUB']]);
      dest.getRange(2, 1, 1, 2).setValues([['PUBLIC ROSTER', 'public sub']]);
      const keep = publishKeepMask_(dest, 1, 1, 2, 2);
      devCheck_(R, 'keep-range: A2 masked', keep[1][0] === true);
      devCheck_(R, 'keep-range: B2 masked', keep[1][1] === true);
      writeValuesSafe_(dest, 1, 1, src.getRange(1, 1, 2, 2).getValues(), keep);
      devEq_(R, 'keep-range: public title untouched', g(dest, 2, 1), 'PUBLIC ROSTER');
      devEq_(R, 'keep-range: public subtitle untouched', g(dest, 2, 2), 'public sub');
      devEq_(R, 'keep-range: the header row still published', g(dest, 1, 1), 'TITLE');
    });
  })();

  // A SOURCE formula is carried across as a formula, so live clocks/counters keep recalculating publicly.
  (() => {
    const src = devFreshSheet_('PubFxSrc');
    src.getRange(1, 1, 1, 2).setValues([['WHEN', 'WHO']]);
    src.getRange(2, 1).setFormula('=UPPER(TEXT(TODAY(),"dd mmmm yyyy"))');
    src.getRange(2, 2).setValue('Alice');
    const dest = devFreshSheet_('PubFxDest');
    dest.getRange(1, 1, 1, 2).setValues([['WHEN', 'WHO']]);
    dest.getRange(2, 1).setValue('19 JULY 2026');  // a previously-published FROZEN value, no formula left
    const keep = publishKeepMask_(dest, 1, 1, 2, 2);
    devCheck_(R, 'formula: a frozen destination value is NOT treated as protected', keep[1][0] === false);
    writeValuesSafe_(dest, 1, 1, publishReadCells_(src.getRange(1, 1, 2, 2)), keep);
    devCheck_(R, 'formula: source formula arrives as a LIVE formula', dest.getRange(2, 1).getFormula().indexOf('TODAY(') !== -1);
    devEq_(R, 'formula: ordinary values still published', g(dest, 2, 2), 'Alice');
  })();

  // DATES/TIMES must arrive on the public copy with their FORMAT, not as raw serials.
  (() => {
    const src = devFreshSheet_('PubFmtSrc');
    src.getRange(1, 1, 1, 3).setValues([['NAME', 'START DATE', 'START TIME']]);
    src.getRange(2, 1).setValue('Alice');
    src.getRange(2, 2).setNumberFormat('d mmm. yyyy').setValue(devDay_(-1));
    src.getRange(2, 3).setNumberFormat('h:mm am/pm').setValue(devTime_(9, 30));
    const dest = devFreshSheet_('PubFmtDest');
    dest.getRange(1, 1, 1, 3).setValues([['NAME', 'START DATE', 'START TIME']]);
    publishMirrorTab_(src, dest);
    devEq_(R, 'format: date format carried to the public copy', dest.getRange(2, 2).getNumberFormat(), 'd mmm. yyyy');
    devEq_(R, 'format: time format carried to the public copy', dest.getRange(2, 3).getNumberFormat(), 'h:mm am/pm');
    devCheck_(R, 'format: the date did not land as a raw serial', String(dest.getRange(2, 2).getDisplayValue()).indexOf('4') !== 0);
  })();

  // MERGE SAFETY: a merged cell in the data block must not break a write (this silently killed the sorts).
  (() => {
    const sh = devFreshSheet_('MergeWrite');
    sh.getRange(2, 2, 1, 3).merge();                       // a merge sitting inside the target block
    const vals = [['a1', 'b1', 'c1', 'd1'], ['a2', 'b2', 'c2', 'd2'], ['a3', 'b3', 'c3', 'd3']];
    let threw = false;
    try { writeValuesSafe_(sh, 1, 1, vals, null); } catch (e) { threw = true; }
    devCheck_(R, 'merge-safe: write did not throw', !threw);
    devEq_(R, 'merge-safe: clean row above written', g(sh, 1, 1), 'a1');
    devEq_(R, 'merge-safe: clean row below written', g(sh, 3, 4), 'd3');
    devEq_(R, 'merge-safe: cell left of the merge written', g(sh, 2, 1), 'a2');
    devEq_(R, 'merge-safe: the merge anchor got its value', g(sh, 2, 2), 'b2');
  })();

  // A plain cross-sheet lookup must NOT mark a tab self-computing (that would stop it publishing entirely).
  (() => {
    const plain = devFreshSheet_('SelfPlain');
    plain.getRange(1, 1).setValue('NAME');
    plain.getRange(2, 1).setFormula("='" + plain.getName() + "'!A1");
    devCheck_(R, 'self-computing: a plain cross-sheet lookup does NOT disable the tab', publishSelfComputing_(plain) === false);
    const spill = devFreshSheet_('SelfSpill');
    spill.getRange(1, 1).setValue('NAME');
    spill.getRange(2, 1).setFormula("=ARRAY_CONSTRAIN(FILTER('" + spill.getName() + "'!A1:A2,'" + spill.getName() + "'!A1:A2<>\"\"),1,1)");
    devCheck_(R, 'self-computing: a spilling cross-sheet formula DOES', publishSelfComputing_(spill) === true);
  })();

  // INCREMENTAL PUBLISH: naming a tab must mirror ONLY that tab (re-mirroring everything on each edit is the trap).
  (() => {
    const a = devFreshSheet_('IncA'), b = devFreshSheet_('IncB');
    a.getRange(1, 1, 2, 1).setValues([['NAME'], ['from A']]);
    b.getRange(1, 1, 2, 1).setValues([['NAME'], ['from B']]);
    const da = devFreshSheet_('IncADest'), db = devFreshSheet_('IncBDest');
    da.getRange(1, 1).setValue('NAME');
    db.getRange(1, 1).setValue('NAME');
    publishMirrorTab_(a, da);                       // only A is mirrored
    devEq_(R, 'incremental: named tab mirrored', g(da, 2, 1), 'from A');
    devEq_(R, 'incremental: other tab untouched', g(db, 2, 1), '');
  })();

  return R;
}

/* ======================================================================
 * PRESERVED HELPERS — snapshot builders, the live-config preflight, and the
 * synthetic-config harness (used by the sections above). Kept verbatim from
 * the prior harness; preflight's trackerStartRow default updated to 8.
 * ====================================================================== */

/**
 * PREFLIGHT — live-config guard (F-028). Runs FIRST in devRunAllTests(). The sandbox builders + many assertions
 * read the LIVE ⚙️ Config through the CONFIG bridge, so a customized LOAD-BEARING value silently skews default-
 * assuming tests. This surfaces that up front: hard FAIL only if the config won't load; INFO for customization.
 */
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
  flag('trackerStartRow', L.trackerStartRow, 8);
  flag('headerRow', L.headerRow, 5);
  flag('thresholds.active', L.thresholds.active, 10);
  flag('thresholds.semi', L.thresholds.semi, 5);
  flag('tier names', L.tierNames.join(','), 'Active,Semi-Active,Inactive');
  flag('leave types', L.leaveTypes.join(','), 'LOA,ROA');
  flag('approved status', L.approvedStatus, 'Approved');
  return R;
}

/**
 * Run fn() with a SYNTHETIC config injected into the CFG_ memo the bridge reads, then hard-restore the live config.
 * Lets stateful, cfg_()-backed functions be exercised under a white-label (renamed) config without touching the
 * operator's real ⚙️ Config tab. ALWAYS restores in finally — a throw can't leak a fake config into later sections.
 */
function devWithConfig_(rawBlocks, fn) {
  const val = validateConfig_(rawBlocks || {});
  const injected = materialize_(val.config, true);
  CFG_ = injected; CFG_ERROR_ = null;                 // bridge now returns the synthetic config
  try { return fn(injected, val); }
  finally { cfgInvalidate_(); if (typeof _rosterColCache === 'object' && _rosterColCache) { Object.keys(_rosterColCache).forEach((k) => delete _rosterColCache[k]); } }
}
