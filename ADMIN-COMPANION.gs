/**
 * ============================================================================
 * ROSTER SIGNUPS — ADMIN-FILE COMPANION  (phase 2 / "B")
 * ============================================================================
 * PASTE THIS INTO THE ADMIN FILE'S OWN SCRIPT — not the main engine.
 *   Admin spreadsheet ▸ Extensions ▸ Apps Script ▸ paste this file
 *   + paste ADMIN-COMPANION.html as an HTML file named exactly "ADMIN-COMPANION"
 * .claspignore keeps this out of the main project on purpose: it defines its own
 * onEdit/onOpen, which would collide with the engine's if it were ever pushed there.
 *
 * WHY IT EXISTS
 * The engine is bound to the PUBLIC roster workbook, so it cannot open a dialog
 * inside this admin file. This companion does exactly two things:
 *   1. a SIMPLE onEdit notices a Signups STATUS going to "Approved" and opens the
 *      slot-picker dialog (simple triggers may touch the UI but not other files);
 *   2. the dialog's server calls — which run as YOU with full authorization — read
 *      the open slots from the public workbook, add the member, copy their private
 *      details onto the Internal Roster, and stamp the signup Processed.
 *
 * DELIBERATELY THIN: it writes the member's name + Unique ID (+ OOC, hours 0) and
 * leaves callsign numbering and activity recompute to the main engine, which
 * normalizes both on its next 🔄 Refresh & Update All / nightly run. That keeps the
 * duplicated logic here to a minimum instead of forking the engine's assign rules.
 *
 * SETUP: put the public workbook's ID in MAIN_WORKBOOK_ID below, then run
 * verifySetup() once from the editor (it reports exactly what it resolved).
 */

/** The PUBLIC roster workbook's ID — the long string in its URL between /d/ and /edit. */
const MAIN_WORKBOOK_ID = 'PASTE_THE_PUBLIC_WORKBOOK_ID_HERE';

const SIGNUP_TAB_NAME = 'Roster Signups';   // this file's signup response tab
const INTERNAL_TAB_NAME = 'Internal Roster'; // this file's internal roster tab
const APPROVED_STATUS = 'Approved';
const PROCESSED_STATUS = 'Processed';

/** Menu — the always-available path (works even if the onEdit popup is blocked). */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🧾 Signups')
    .addItem('✅ Approve selected signup…', 'approveSelectedSignup')
    .addSeparator()
    .addItem('🔍 Verify setup', 'verifySetup')
    .addToUi();
}

/** Simple onEdit: flipping STATUS to Approved on the Signups tab opens the slot picker. */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== SIGNUP_TAB_NAME) return;
    const row = e.range.getRow();
    if (row < 2) return;
    const SC = signupCols(sh);
    if (!SC.status || e.range.getColumn() !== SC.status) return;
    if (norm(String(e.value || '')) !== norm(APPROVED_STATUS)) return;
    openApprovalDialog(row);
  } catch (err) { /* never break the user's edit — the menu path still works */ }
}

/** Open the slot picker for a signup row. */
function openApprovalDialog(row) {
  const t = HtmlService.createTemplateFromFile('ADMIN-COMPANION');
  t.signupRow = row;
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(720).setHeight(560), 'Approve signup');
}

/** Menu action: approve whichever signup row the cursor is on. */
function approveSelectedSignup() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SIGNUP_TAB_NAME) { ui.alert(`Open the "${SIGNUP_TAB_NAME}" tab and click the signup's row first.`); return; }
  const row = sh.getActiveRange().getRow();
  if (row < 2) { ui.alert('Click a signup row (not the header).'); return; }
  openApprovalDialog(row);
}

/* ---------------------------------------------------------------- helpers */

function norm(s) { return String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim(); }

/** Resolve a header row by keyword, exact match winning over a substring (mirrors the engine's rule). */
function resolveCols(headerVals, spec) {
  const hdr = headerVals.map((h) => norm(h));
  const exact = (l) => { const k = norm(l); for (let c = 0; c < hdr.length; c++) { if (hdr[c] === k) return c + 1; } return 0; };
  const all = (toks) => { for (let c = 0; c < hdr.length; c++) { if (toks.every((t) => hdr[c].indexOf(norm(t)) !== -1)) return c + 1; } return 0; };
  const out = {};
  Object.keys(spec).forEach((role) => {
    let col = 0;
    const opts = spec[role];
    for (let i = 0; i < opts.length && !col; i++) col = exact(opts[i]);
    for (let i = 0; i < opts.length && !col; i++) col = all(opts[i].split(' '));
    out[role] = col;
  });
  return out;
}

/** Signup tab columns. */
function signupCols(sh) {
  const hdr = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
  const c = resolveCols(hdr, { ooc: ['OOC NAME', 'OOC'], discord: ['UNIQUE ID', 'DISCORD', 'COMMUNITY ID', 'CID'],
    email: ['EMAIL'], dob: ['DATE OF BIRTH', 'BIRTH', 'DOB'], phone: ['PHONE'], status: ['STATUS'], notes: ['NOTES'] });
  c.name = 0;
  const h = hdr.map((x) => norm(x));
  for (let i = 0; i < h.length; i++) { if (h[i] === 'NAME') { c.name = i + 1; break; } }
  if (!c.name) { for (let i = 0; i < h.length; i++) { if (h[i].indexOf('NAME') !== -1 && (i + 1) !== c.ooc) { c.name = i + 1; break; } } }
  return c;
}

/** Internal Roster columns (this file). */
function internalColsC(sh) {
  const hdr = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
  const c = resolveCols(hdr, { ooc: ['OOC NAME', 'OOC'], discord: ['UNIQUE ID', 'DISCORD', 'COMMUNITY ID', 'CID'],
    email: ['EMAIL'], dob: ['DATE OF BIRTH', 'BIRTH', 'DOB'], phone: ['PHONE'] });
  c.name = 0;
  const h = hdr.map((x) => norm(x));
  for (let i = 0; i < h.length; i++) { if (h[i] === 'NAME') { c.name = i + 1; break; } }
  return c;
}

/**
 * Find the roster tab in the public workbook by its HEADER (rank + name + unique id), the same way the engine
 * resolves columns — so renaming the tab or moving columns doesn't break this. @return {Object|null}
 */
function findRoster(main) {
  const sheets = main.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    const rows = Math.min(10, sh.getLastRow());
    if (rows < 1) continue;
    const grid = sh.getRange(1, 1, rows, Math.max(sh.getLastColumn(), 1)).getDisplayValues();
    for (let r = 0; r < grid.length; r++) {
      const line = grid[r].map((h) => norm(h));
      const has = (kw) => line.some((h) => h.indexOf(kw) !== -1);
      if (!(has('RANK') && has('NAME') && (has('UNIQUE ID') || has('DISCORD')))) continue;
      const cols = resolveCols(grid[r], { rank: ['RANK'], unit: ['UNIT NUMBER', 'UNIT', 'CALLSIGN'], ooc: ['OOC NAME', 'OOC'],
        discord: ['UNIQUE ID', 'DISCORD', 'COMMUNITY ID', 'CID'], hours: ['HOURS'], activity: ['STATUS', 'ACTIVITY'] });
      cols.name = 0;
      for (let c2 = 0; c2 < line.length; c2++) { if (line[c2] === 'NAME') { cols.name = c2 + 1; break; } }
      if (!cols.name) { for (let c2 = 0; c2 < line.length; c2++) { if (line[c2].indexOf('NAME') !== -1 && (c2 + 1) !== cols.ooc) { cols.name = c2 + 1; break; } } }
      if (!cols.rank || !cols.name || !cols.discord) continue;
      return { sheet: sh, headerRow: r + 1, start: r + 3, cols: cols }; // banner / labels / divider → data
    }
  }
  return null;
}

/** A rank cell that names a real member slot (not a section divider, which the engine writes in ALL CAPS). */
function isSlotRank(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '' || norm(s) === 'RANK') return false;
  return !(s === s.toUpperCase() && /[A-Z]/.test(s)); // ALL-CAPS ⇒ divider
}

/* ------------------------------------------------- dialog server endpoints */

/** Dialog data: this signup's details + every OPEN slot on the public roster. */
function companionLoad(signupRow) {
  if (!MAIN_WORKBOOK_ID || MAIN_WORKBOOK_ID.indexOf('PASTE') === 0) throw new Error('Set MAIN_WORKBOOK_ID at the top of the companion script first.');
  const sh = SpreadsheetApp.getActive().getSheetByName(SIGNUP_TAB_NAME);
  if (!sh) throw new Error(`"${SIGNUP_TAB_NAME}" not found in this file.`);
  const SC = signupCols(sh);
  const g = (c) => c ? String(sh.getRange(signupRow, c).getDisplayValue()).trim() : '';
  const main = SpreadsheetApp.openById(MAIN_WORKBOOK_ID);
  const R = findRoster(main);
  if (!R) throw new Error('Could not find the roster tab in the public workbook (needs RANK + NAME + UNIQUE ID headers).');
  const last = R.sheet.getLastRow(), slots = [];
  if (last >= R.start) {
    const n = last - R.start + 1;
    const ranks = R.sheet.getRange(R.start, R.cols.rank, n, 1).getDisplayValues();
    const names = R.sheet.getRange(R.start, R.cols.name, n, 1).getDisplayValues();
    const units = R.cols.unit ? R.sheet.getRange(R.start, R.cols.unit, n, 1).getDisplayValues() : null;
    for (let i = 0; i < n; i++) {
      if (!isSlotRank(ranks[i][0])) continue;
      if (String(names[i][0]).trim() !== '') continue;
      slots.push({ row: R.start + i, rank: String(ranks[i][0]).trim(), unit: units ? String(units[i][0]).trim() : '' });
    }
  }
  return { signup: { row: signupRow, name: g(SC.name), ooc: g(SC.ooc), discord: g(SC.discord), email: g(SC.email), dob: g(SC.dob), phone: g(SC.phone), status: g(SC.status) }, slots: slots };
}

/**
 * Approve: write the member into the chosen public-roster slot, copy their private details onto this file's
 * Internal Roster, then stamp the signup Processed LAST (so a failure leaves the row still actionable).
 */
function companionApprove(signupRow, slotRow) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SIGNUP_TAB_NAME);
  if (!sh) throw new Error(`"${SIGNUP_TAB_NAME}" not found.`);
  const SC = signupCols(sh);
  const g = (c) => c ? String(sh.getRange(signupRow, c).getDisplayValue()).trim() : '';
  const id = g(SC.discord), name = g(SC.name);
  if (!/^\d+$/.test(id)) throw new Error('This signup has no valid numeric Unique ID.');
  if (!name) throw new Error('This signup has no name.');

  const main = SpreadsheetApp.openById(MAIN_WORKBOOK_ID);
  const R = findRoster(main);
  if (!R) throw new Error('Could not find the roster tab in the public workbook.');
  const rs = R.sheet, C = R.cols;

  // Guard: the slot must still be an empty member slot, and the ID must not already be on the roster.
  if (!isSlotRank(rs.getRange(slotRow, C.rank).getDisplayValue())) throw new Error(`Row ${slotRow} is not a member slot.`);
  if (String(rs.getRange(slotRow, C.name).getDisplayValue()).trim() !== '') throw new Error(`Row ${slotRow} is already filled — reload and pick another slot.`);
  const last = rs.getLastRow();
  if (last >= R.start) {
    const ids = rs.getRange(R.start, C.discord, last - R.start + 1, 1).getDisplayValues();
    for (let i = 0; i < ids.length; i++) { if (String(ids[i][0]).trim() === id) throw new Error(`${name} is already on the roster at row ${R.start + i}.`); }
  }

  rs.getRange(slotRow, C.name).setValue(name);
  rs.getRange(slotRow, C.discord).setNumberFormat('@').setValue(id); // exact text — never a rounded number
  if (C.ooc && g(SC.ooc)) rs.getRange(slotRow, C.ooc).setValue(g(SC.ooc));
  if (C.hours) rs.getRange(slotRow, C.hours).setValue(0);

  let pii = 0; // private details → this file's Internal Roster (upsert by Unique ID)
  try {
    const inn = SpreadsheetApp.getActive().getSheetByName(INTERNAL_TAB_NAME);
    if (inn) {
      const IC = internalColsC(inn);
      if (IC.discord) {
        let r = -1, ilast = inn.getLastRow();
        if (ilast >= 2) {
          const iids = inn.getRange(2, IC.discord, ilast - 1, 1).getDisplayValues();
          for (let i = 0; i < iids.length; i++) { if (String(iids[i][0]).trim() === id) { r = 2 + i; break; } }
        }
        if (r === -1) { r = Math.max(ilast + 1, 2); if (r > inn.getMaxRows()) inn.insertRowsAfter(inn.getMaxRows(), 50); inn.getRange(r, IC.discord).setNumberFormat('@').setValue(id); }
        const put = (c, v) => { if (c && v) { inn.getRange(r, c).setNumberFormat('@').setValue(v); pii++; } };
        put(IC.email, g(SC.email)); put(IC.dob, g(SC.dob)); put(IC.phone, g(SC.phone));
        if (IC.name) inn.getRange(r, IC.name).setValue(name);
      }
    }
  } catch (err) { /* the roster write already succeeded — never fail approval over the PII copy */ }

  if (SC.status) sh.getRange(signupRow, SC.status).setValue(PROCESSED_STATUS);
  return { ok: true, name: name, slotRow: slotRow, pii: pii };
}

/** Run once from the editor: confirms the ID, the tabs, and what it resolved in the public workbook. */
function verifySetup() {
  const ui = SpreadsheetApp.getUi();
  const out = [];
  try {
    if (!MAIN_WORKBOOK_ID || MAIN_WORKBOOK_ID.indexOf('PASTE') === 0) throw new Error('MAIN_WORKBOOK_ID is not set.');
    const here = SpreadsheetApp.getActive();
    out.push(`This file: ${here.getName()}`);
    out.push(`  • ${SIGNUP_TAB_NAME}: ${here.getSheetByName(SIGNUP_TAB_NAME) ? '✅ found' : '❌ missing'}`);
    out.push(`  • ${INTERNAL_TAB_NAME}: ${here.getSheetByName(INTERNAL_TAB_NAME) ? '✅ found' : '❌ missing'}`);
    const main = SpreadsheetApp.openById(MAIN_WORKBOOK_ID);
    out.push(`Public workbook: ${main.getName()}`);
    const R = findRoster(main);
    if (!R) out.push('  • roster tab: ❌ not found (needs RANK + NAME + UNIQUE ID headers)');
    else out.push(`  • roster tab: ✅ "${R.sheet.getName()}" — headers row ${R.headerRow}, data from row ${R.start}`);
    ui.alert('🔍 Companion setup', out.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('🔍 Companion setup', out.concat(['', '❌ ' + e.message]).join('\n'), ui.ButtonSet.OK);
  }
}
