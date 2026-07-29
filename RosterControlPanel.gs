/**
 * ============================================================================
 * ROSTER CONTROL PANEL — themed HtmlService sidebar for the roster system.
 * ----------------------------------------------------------------------------
 * Turns the sheet into an "application": a docked panel with live stats,
 * member search, one-click status changes, guided member onboarding (fills an
 * existing open slot — it does NOT append rows), and the maintenance actions.
 *
 * This file is the SERVER side. The UI lives in an HTML file named exactly
 * "ControlPanel" (File ▸ New ▸ HTML file). All functions here are global and
 * reuse CONFIG + helpers from RosterSystem.gs — paste this alongside it.
 *
 * WIRING (one line): add this item to the onOpen() menu in RosterSystem.gs:
 *     .addItem('🎛️ Open Control Panel', 'openControlPanel')
 *
 * Discord IDs are TEXT (17-19 digits) — every read here uses getDisplayValues()
 * and every write forces text format, so no precision is ever lost.
 * ============================================================================
 */

const CP_VERSION = 'v1.0.0'; // moves in lock-step with ENGINE_VERSION from the 1.0 release on
const CP_STATUSES = Object.freeze(['Active', 'Semi-Active', 'Inactive', 'LOA', 'ROA', 'Reserve']); // fallback when config is unavailable

/** Status names from [STATUSES] on ⚙️ Config (defaults identical to CP_STATUSES). */
function cpStatuses_() {
  try { const names = cfg_().statusNames; if (names && names.length) return names; } catch (e) { /* config broken — fallback */ }
  return CP_STATUSES.slice();
}

/** {status name: '#hex'} from the [STATUSES] Color column — only valid hex values ship (they land in inline styles). */
function cpStatusColors_() {
  const out = {};
  try {
    (cfg_().statuses || []).forEach((s) => {
      const c = String(s.color || '').trim();
      // {3,8} also admitted 5- and 7-digit values, which are not CSS colours at all — they reached the panel and
      // silently produced no pill. Same shapes the rest of the engine accepts.
      if (s.name && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) out[s.name] = c;
    });
  } catch (e) { /* config broken — pills fall back to the built-in palette */ }
  return out;
}

/* ----------------------------------------------------------------------------
 * D5 — WHITELISTED DISPATCH (Roster Engine, Phase 2)
 * The panel's google.script.run calls go through ONE endpoint: dispatch(name, args).
 * • Bound mode (this sheet): the dialog reaches this dispatch directly.
 * • Library mode (public template): the ~50-line shim's dispatch re-checks its own
 *   frozen whitelist, then forwards here (RE.dispatch) — the name string only ever
 *   selects within THIS map, so arbitrary-function invocation is impossible by
 *   construction. Unknown name → E-506.
 * Adding a panel endpoint = add it here + to the shim whitelist (one line each).
 * ------------------------------------------------------------------------- */

const DISPATCH_ENDPOINTS_ = Object.freeze({
  cpPing: () => cpPing(),
  cpBootstrap: () => cpBootstrap(),
  cpRefresh: () => cpRefresh(),
  cpGetProfile: (id) => cpGetProfile(id),
  cpSetStatus: (row, status, expectedId) => cpSetStatus(row, status, expectedId),
  cpSetStatusBulk: (rows, status, expectedIds) => cpSetStatusBulk(rows, status, expectedIds),
  cpScheduleLeave: (req) => cpScheduleLeave(req),
  cpAssignMember: (req) => cpAssignMember(req),
  cpMoveMember: (req) => cpMoveMember(req),
  cpRunAction: (act) => cpRunAction(act),
  cpRunLog: () => cpRunLog(),
  cpJumpTo: (row) => cpJumpTo(row),
  cpSystemInfo: () => cpSystemInfo(),
  cpColumnsInfo: () => cpColumnsInfo(),
  cpSetColumnClass: (header, klass) => cpSetColumnClass(header, klass),
  cpFixTriggers: () => cpFixTriggers(),
  cpTakeSnapshot: () => cpTakeSnapshot(),
  cpRestoreSnapshot: (id) => cpRestoreSnapshot(id),
  cpSetSnapshotAuto: (on) => cpSetSnapshotAuto(on),
  cpSetWebhook: (url, channel) => cpSetWebhook(url, channel),
  cpSetWebhookChannels: (url, channels) => cpSetWebhookChannels(url, channels),
  cpTestWebhook: (channel) => cpTestWebhook(channel),
  cpTestWebhookChannels: (channels) => cpTestWebhookChannels(channels),
  cpGetConfig: () => cpGetConfig(),
  cpApplyConfig: (p) => cpApplyConfig(p),
  cpOpenSettings: () => { openSettingsPanel(); return true; },
  cpRankIcons: () => cpRankIcons(),
  cpSetRankIcon: (rank, dataUri) => cpSetRankIcon(rank, dataUri),
  cpDeleteRankIcon: (rank) => cpDeleteRankIcon(rank),
  cpSignupList: () => cpSignupList(),
  cpSignupApprove: (p) => cpSignupApprove(p),
  cpSignupFlag: (p) => cpSignupFlag(p),
  cpSignupPostSeat: (p) => cpSignupPostSeat(p),
  cpPromoList: () => cpPromoList(),
  cpPromoRemove: (p) => cpPromoRemove(p),
  cpPromoRestore: (p) => cpPromoRestore(p),
});

/** The panel's single server entry point. @param {string} name @param {Array} args */
function dispatch(name, args) {
  try {
    const fn = DISPATCH_ENDPOINTS_[String(name)];
    if (!fn) raise_('E-506', { name: String(name) });
    return perf_(`dispatch:${name}`, () => fn.apply(null, Array.isArray(args) ? args : [])); // per-endpoint timing when [LOGGING].PERF_TIMING is on
  } catch (err) {
    // F-017: google.script.run strips custom props (code/hint) off a thrown AppError before it reaches the panel's
    // onError — fold them into the MESSAGE (the one field that survives) so the user sees the code + fix hint, not a bare string.
    if (err && err.code) {
      const hint = err.hint ? ` — Fix: ${err.hint}` : '';
      const docs = (typeof docsLink_ === 'function') ? docsLink_(err.code) : '';
      throw new Error(`[${err.code}] ${err.message}${hint}${docs}`);
    }
    throw err;
  }
}

/** Cheapest whitelisted endpoint — used by the shim/wizard to prove the engine is reachable. */
function cpPing() {
  return { ok: true, version: CP_VERSION, engine: ENGINE_VERSION, schema: ENGINE_SCHEMA };
}

/**
 * Panel write: store a Discord webhook URL in the ADMIN spreadsheet's Webhooks tab (never in the main file's
 * cells; never logged). Google's file ACL is the permission system — only accounts that can WRITE the admin
 * file can set or clear webhooks, and only accounts that can READ it can post through them.
 * @param {string} url - empty string clears the channel.
 * @param {string} [channel] - 'AUDIT' | 'LOA' | 'PATROL' | 'ERRORS'.
 */
function cpSetWebhook(url, channel) {
  const u = String(url || '').trim();
  const ch = webhookChannel_(channel);
  if (u !== '' && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(u)) {
    throw new Error('That does not look like a Discord webhook URL (expected https://discord.com/api/webhooks/…).');
  }
  const file = adminFile_();
  if (!file) throw new Error('Webhooks are stored in the admin roster — link one first (Tools ▸ Admin roster).');
  const sh = ensureWebhookTab_(file);
  const last = sh.getLastRow();
  let row = 0;
  if (last >= 2) {
    const chs = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
    for (let i = 0; i < chs.length; i++) { if (norm_(chs[i][0]) === ch) { row = i + 2; break; } }
  }
  let me = ''; try { me = Session.getActiveUser().getEmail() || ''; } catch (e) { /* consumer-account quirk */ }
  if (me && typeof auditWho_ === 'function') me = auditWho_(me); // member NAME when the email is on their roster row
  if (u === '') {
    if (row) sh.getRange(row, 2, 1, 3).setNumberFormat('@').setValues([['', me, fmtTs_(new Date())]]);
  } else {
    if (!row) { row = Math.max(2, last + 1); sh.getRange(row, 1).setNumberFormat('@').setValue(ch); }
    sh.getRange(row, 2, 1, 3).setNumberFormat('@').setValues([[u, me, fmtTs_(new Date())]]);
  }
  cpAudit_('action', '', `Discord ${ch} webhook ${u === '' ? 'cleared' : 'updated'}`, '', ''); // the URL itself is never audited
  try { if (typeof cpInvalidateHealth_ === 'function') cpInvalidateHealth_(); } catch (e) { /* Trust.gs may be absent */ }
  _webhookMemo_ = null; // this execution re-reads the tab
  return { set: u !== '', channel: ch, channels: cpWebhookStatus_() };
}

/** Only the recognized channel names from a list (deduped), so an invalid one can't silently fall back to LOA. */
function webhookChannelList_(channels) {
  const raw = Array.isArray(channels) ? channels : (channels == null || channels === '' ? [] : [channels]);
  const list = raw.map((c) => norm_(c)).filter((c) => WEBHOOK_CHANNELS_.indexOf(c) !== -1);
  return list.filter((c, i) => list.indexOf(c) === i);
}

/** Panel: apply ONE webhook URL to SEVERAL channels at once (empty url clears them). Lets one webhook serve many notifications. */
function cpSetWebhookChannels(url, channels) {
  const chans = webhookChannelList_(channels);
  if (!chans.length) throw new Error('Pick at least one channel to save the webhook to.');
  let res = null;
  chans.forEach((c) => { res = cpSetWebhook(url, c); }); // cpSetWebhook validates the URL + stores each channel row
  return { set: String(url || '').trim() !== '', applied: chans, channels: (res && res.channels) || cpWebhookStatus_() };
}

/** Ensure the admin file's Webhooks tab exists with its header row. Idempotent. */
function ensureWebhookTab_(file) {
  let sh = file.getSheetByName(WEBHOOK_TAB_);
  if (!sh) sh = file.insertSheet(WEBHOOK_TAB_);
  if (sh.getLastRow() === 0) sh.appendRow(['Channel', 'URL', 'Updated By', 'Updated At']);
  try {
    sh.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground(theme_('BANNER')).setFontColor(theme_('TEXT_STRONG'));
    sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat('@'); // URLs stay literal text
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  } catch (e) { /* cosmetic */ }
  return sh;
}

/** Which channels have a webhook — as seen by THIS user (no admin-file access = all false). */
function cpWebhookStatus_() {
  const out = {};
  WEBHOOK_CHANNELS_.forEach((c) => { out[c] = !!webhookFor_(c); });
  return out;
}

const WH_TEST_DESC_ = Object.freeze({
  AUDIT: 'Roster edits will post to this channel.',
  LOA: 'Leave submissions, approvals and expiries will post to this channel.',
  PATROL: 'Patrol log credits and flagged logs will post to this channel.',
  SIGNUP: 'New roster signups awaiting review will post to this channel.',
  ERRORS: 'Engine errors (coded, throttled) will post to this channel.',
});

/** Panel action: send a test message through the configured webhook for the given channel. */
function cpTestWebhook(channel) {
  const ch = webhookChannel_(channel);
  const url = webhookFor_(ch);
  if (!url) throw new Error(`No ${ch} webhook configured yet — save a webhook URL first.`);
  const payload = {
    username: `${CONFIG.systemName} — ${ch.toLowerCase()}`,
    embeds: [{
      title: '✅ Webhook test',
      description: WH_TEST_DESC_[ch] || 'The roster system can post to this channel.',
      footer: { text: `${CONFIG.systemName} • ${ENGINE_VERSION}` },
    }],
  };
  // Route BOTH channels through the same reporting helper so a green check means CONFIRMED 2xx, not just "no exception" (F-011).
  const res = postToWebhook_(url, payload);
  if (!res.ok) {
    throw new Error(`Discord did not accept the test (HTTP ${res.code}${res.error ? ` — ${res.error}` : ''}). Re-check the webhook URL.`);
  }
  return { ok: true, channel: ch, code: res.code };
}

/**
 * Panel: send a test to each listed channel. cpTestWebhook throws for TWO different reasons — no URL saved, and
 * Discord refusing the post — and folding both into one bucket reported a dead webhook as "not configured yet",
 * which sends the operator to the wrong fix. They are reported separately.
 * @return {{ok, tested:string[], missing:string[], failed:Array<{channel,why}>}}
 */
function cpTestWebhookChannels(channels) {
  const chans = webhookChannelList_(channels);
  if (!chans.length) throw new Error('Pick at least one channel to test.');
  const tested = [], missing = [], failed = [];
  chans.forEach((c) => {
    if (!webhookFor_(c)) { missing.push(c); return; }   // nothing saved — ask them to save one
    try { cpTestWebhook(c); tested.push(c); }
    catch (e) { failed.push({ channel: c, why: (e && e.message) ? e.message : String(e) }); } // saved, but Discord said no
  });
  if (!tested.length && !failed.length) throw new Error('None of the selected channels have a webhook yet — save one first.');
  return { ok: true, tested: tested, missing: missing, failed: failed };
}

/* ----------------------------------------------------------------------------
 * SETTINGS — the panel's guarded editing surface over the ⚙️ Config tab.
 * The SHEET stays the source of truth (copies carry it; it is the no-code
 * escape hatch); the panel is the recommended editor: typed inputs, and a
 * VALIDATE-BEFORE-WRITE contract — a change set that would produce config
 * ERRORs is refused wholesale, so the UI can never save a broken config.
 * ------------------------------------------------------------------------- */

/**
 * Blocks the Settings Studio exposes. v1.0: ALL kv blocks + nearly every table block are editable in the panel
 * (validate-before-write guards each save). [COLUMNS] is intentionally excluded — it has a richer dedicated editor
 * on the Control Panel's Columns tab (sample values, fill counts, header issues); a second editor here would conflict.
 */
// EVERY kv block the Settings Studio serves. A block missing here is invisible to the panel — its section
// renders empty because the client only knows the keys this payload carries. Add a block to BLOCK_SPECS_ and
// you must add it HERE too.
const CP_SETTINGS_KV_ = Object.freeze(['SYSTEM', 'SHEETS', 'ROSTER_LAYOUT', 'ACTIVITY', 'LEAVE', 'DISCORD', 'NOTIFICATIONS', 'PATROL', 'PUBLISH', 'FORMATS', 'SCHEDULE', 'LOGGING', 'LIMITS', 'THEME', 'DASHBOARD']);
const CP_SETTINGS_TABLES_ = Object.freeze(['STATUSES', 'STATUS_OVERRIDES', 'STATUS_RULES', 'RANKS', 'SECTION_TAGS', 'DASHBOARD_GROUPS', 'FORM_MAP', 'EMBEDS']);
const CP_SETTINGS_HIDDEN_ = Object.freeze({ 'SYSTEM.SCHEMA_VERSION': true }); // engine-managed — never editable from the UI

/** Distinct member-slot ranks from the live roster, in sheet order — feeds the Settings rank dropdowns. */
function cpRosterRanks_(ss) {
  try {
    const s = ss || SpreadsheetApp.getActive();
    const roster = s.getSheetByName(CONFIG.sheets.roster);
    if (!roster || roster.getLastRow() < CONFIG.rosterStartRow) return [];
    const n = roster.getLastRow() - CONFIG.rosterStartRow + 1;
    const vals = roster.getRange(CONFIG.rosterStartRow, rosterCols_(roster).rank, n, 1).getDisplayValues();
    const out = []; const seen = {};
    vals.forEach(([r]) => {
      const rank = String(r).trim();
      if (!rank || rank === 'Rank' || !isMemberSlot_(rank) || seen[norm_(rank)]) return;
      seen[norm_(rank)] = true; out.push(rank);
    });
    return out.slice(0, 60);
  } catch (e) { log_('cpRosterRanks_', e); return []; }
}

/** Menu target / panel action: open the Settings Studio (its own full-size dialog). */
function openSettingsPanel() {
  const html = HtmlService.createHtmlOutputFromFile('SettingsPanel')
    .setWidth(1180).setHeight(760);
  // MODELESS, like the Control Panel: the dialog is draggable and the sheet stays usable behind it —
  // change a value, glance at the live tab, save, without closing anything.
  SpreadsheetApp.getUi().showModelessDialog(html, '⚙️ Engine Settings');
}

/** Injectable read: everything the Settings UI needs, shaped from BLOCK_SPECS_ + the live sheet values. */
function cpGetConfig_(ss) {
  const s = ss || SpreadsheetApp.getActive();
  const sheet = findConfigSheet_(s);
  const raw = sheet ? parseBlocks_(sheet) : {};
  const v = validateConfig_(raw); // pure — collects problems without throwing
  const blocks = [];
  CP_SETTINGS_KV_.forEach((name) => {
    const spec = BLOCK_SPECS_[name];
    const have = (raw[name] && raw[name].kv) || {};
    const keys = [];
    Object.keys(spec.keys).forEach((key) => {
      if (CP_SETTINGS_HIDDEN_[`${name}.${key}`]) return;
      const k = spec.keys[key];
      const def = (k.t === 'bool') ? (k.d ? 'TRUE' : 'FALSE') : String(k.d);
      // A RENAMED key (spec `aka`): an un-migrated sheet still carries the old-name row — show ITS value as the
      // effective one (that's what validation resolves to), not the default. An explicit new-name row wins.
      // `aka` is either a plain key in THIS block, or "BLOCK.KEY" when the key MOVED between blocks. Only the
      // first form was handled here, so a moved key (ACTIVITY.RESET_CADENCE aka SCHEDULE.RESET_CADENCE) looked
      // up "SCHEDULE.RESET_CADENCE" as a literal key name inside [ACTIVITY], never found it, and showed the
      // default instead of what the sheet actually resolves to. materialize_ already splits on the dot.
      const direct = Object.prototype.hasOwnProperty.call(have, key);
      const akaDot = k.aka ? String(k.aka).indexOf('.') : -1;
      const akaHave = (akaDot === -1) ? have : ((raw[k.aka.slice(0, akaDot)] && raw[k.aka.slice(0, akaDot)].kv) || {});
      const akaKey = k.aka ? ((akaDot === -1) ? k.aka : k.aka.slice(akaDot + 1)) : '';
      const viaAka = !direct && k.aka && Object.prototype.hasOwnProperty.call(akaHave, akaKey);
      const fromSheet = direct || !!viaAka;
      keys.push({
        key, t: k.t, def, req: !!k.req, help: k.help || '',
        min: (k.min != null ? k.min : null), max: (k.max != null ? k.max : null),
        options: k.enum ? k.enum.slice() : null,
        value: direct ? String(have[key]) : (viaAka ? String(akaHave[akaKey]) : def),
        fromSheet,
      });
    });
    blocks.push({ name, type: 'kv', help: spec.help || '', keys });
  });
  CP_SETTINGS_TABLES_.forEach((name) => {
    const spec = BLOCK_SPECS_[name];
    const have = (raw[name] && raw[name].kind === 'table') ? raw[name].rows : null;
    const width = spec.cols.length;
    const rows = (have || spec.seed).map((r) => { const o = r.slice(0, width).map((x) => String(x == null ? '' : x)); while (o.length < width) o.push(''); return o; });
    blocks.push({ name, type: 'table', help: spec.help || '', cols: spec.cols.slice(), rows, fromSheet: !!have });
  });
  return {
    fromTab: !!sheet,
    sheetName: sheet ? sheet.getName() : '',
    engine: ENGINE_VERSION,
    // Every tab EXCEPT the ones no role may ever point at: the two reserved engine tabs (validateConfig_ rejects
    // them anyway) and the DevQA sandboxes. Hidden "_"-prefixed tabs stay IN — [SHEETS].HOURS_HISTORY and
    // SNAPSHOTS are supposed to point at them, and filtering them out left those two pickers unable to offer
    // the tab they were already set to.
    sheetNames: s.getSheets().map((x) => x.getName())
      .filter((n) => n.indexOf('🧪') !== 0 && norm_(n) !== norm_(CONFIG_SHEET_NAME) && norm_(n) !== norm_(SYS_LOG_SHEET)),
    ranks: cpRosterRanks_(s), // live roster ranks — the override editor offers these as a dropdown instead of free text
    problems: v.problems.map((p) => ({ sev: p.sev, code: p.code, key: p.key, value: String(p.value == null ? '' : p.value), expected: p.expected || '' })),
    webhooks: cpWebhookStatus_(), // per-channel booleans — read via THIS user's admin-file access
    adminLinked: true, // the private tabs are in THIS workbook now — nothing to link
    blocks,
  };
}

/**
 * Injectable apply: VALIDATE the prospective config first; refuse the whole change set on any ERROR
 * (nothing is written), otherwise write via the guarded primitives. The prospective raw is built from the
 * sheet's CURRENT state + the changes, so concurrent sheet edits are included in what gets validated.
 * @param {Sheet} configSheet
 * @param {{kv?:Array<{block,key,value}>, tables?:Object<string,Array<Array>>}} payload
 * @return {{ok:boolean, problems:Array, written?:{kv:number, tables:number}}}
 */
function cpApplyConfig_(configSheet, payload) {
  if (!configSheet) throw new Error(`No "${CONFIG_SHEET_NAME}" tab found — run 🚀 First-Run Setup first.`);
  const p = payload || {};
  const kvChanges = Array.isArray(p.kv) ? p.kv : [];
  const tableChanges = (p.tables && typeof p.tables === 'object') ? p.tables : {};

  // ---- sanitize: only exposed blocks/keys; engine-managed keys are never writable from the UI ----
  kvChanges.forEach((c) => {
    const block = String(c && c.block || ''); const key = String(c && c.key || '');
    if (CP_SETTINGS_KV_.indexOf(block) === -1) throw new Error(`Block [${block}] is not editable from the panel.`);
    if (!BLOCK_SPECS_[block].keys[key]) throw new Error(`Unknown key [${block}].${key}.`);
    if (CP_SETTINGS_HIDDEN_[`${block}.${key}`]) throw new Error(`[${block}].${key} is engine-managed.`);
  });
  Object.keys(tableChanges).forEach((name) => {
    if (CP_SETTINGS_TABLES_.indexOf(name) === -1) throw new Error(`Table [${name}] is not editable from the panel.`);
    // Refuse rows carrying non-empty data past the block's OWN width rather than letting setTableRows_ pad them
    // into the 5-wide grid. This used to compare against a literal 5 — right only while some block actually had 5
    // columns — so a stray 5th value on a 4-column block was written into column E instead of being refused.
    const W = BLOCK_SPECS_[name].cols.length;
    (tableChanges[name] || []).forEach((r) => {
      if (Array.isArray(r) && r.length > W && r.slice(W).some((x) => String(x == null ? '' : x).trim() !== '')) {
        throw new Error(`[${name}] rows are limited to ${BLOCK_SPECS_[name].cols.length} columns — extra data would be dropped.`);
      }
    });
  });

  // ---- validate the PROSPECTIVE config (current sheet + changes) before touching the sheet ----
  const raw = parseBlocks_(configSheet);
  kvChanges.forEach((c) => {
    if (!raw[c.block] || raw[c.block].kind !== 'kv') raw[c.block] = { kind: 'kv', kv: {} };
    raw[c.block].kv[String(c.key)] = String(c.value == null ? '' : c.value);
  });
  Object.keys(tableChanges).forEach((name) => {
    raw[name] = { kind: 'table', header: BLOCK_SPECS_[name].cols.slice(), rows: tableChanges[name].map((r) => r.map((x) => String(x == null ? '' : x))) };
  });
  const v = validateConfig_(raw);
  // ERRORs always block. On the PANEL SAVE path we also block the [STATUS_OVERRIDES] missing-status WARN —
  // an override ladder naming a status that doesn't exist silently computes wrong tiers at runtime. Load-time
  // validation keeps it a WARN on purpose (an already-broken sheet must stay functional enough to fix).
  const errors = v.problems.filter((x) => x.sev === 'ERROR'
    || (x.sev === 'WARN' && x.type === 'status' && String(x.key).indexOf('[STATUS_OVERRIDES]') === 0));
  if (errors.length) {
    return { ok: false, problems: errors.map((x) => ({ sev: x.sev, code: x.code, key: x.key, value: String(x.value == null ? '' : x.value), expected: x.expected || '' })) };
  }

  // ---- write through the guarded primitives ----
  // setKvValue_ returns FALSE when the block marker is missing from the tab — it writes nothing. That return
  // was discarded, so the panel reported a successful save, reloaded, and showed the old value again: the
  // "it says saved but reverts" symptom. Blocks are checked BEFORE anything is written, so a bad change set
  // cannot half-apply.
  const missingBlocks = [];
  kvChanges.forEach((c) => { if (missingBlocks.indexOf(c.block) === -1 && !cpBlockPresent_(configSheet, c.block)) missingBlocks.push(c.block); });
  if (missingBlocks.length) {
    throw new Error(`Nothing was saved — ${missingBlocks.map((b) => `[${b}]`).join(', ')} ${missingBlocks.length === 1 ? 'is' : 'are'} missing from the ${CONFIG_SHEET_NAME} tab. Run 🚀 First-Run Setup to rebuild it.`);
  }
  kvChanges.forEach((c) => {
    if (!setKvValue_(configSheet, c.block, c.key, String(c.value == null ? '' : c.value))) {
      throw new Error(`Could not write [${c.block}].${c.key} to the ${CONFIG_SHEET_NAME} tab.`);
    }
  });
  Object.keys(tableChanges).forEach((name) => { setTableRows_(configSheet, name, tableChanges[name]); });
  cfgInvalidate_();
  SpreadsheetApp.flush();
  return {
    ok: true,
    problems: v.problems.filter((x) => x.sev === 'WARN').map((x) => ({ sev: x.sev, code: x.code, key: x.key, value: String(x.value == null ? '' : x.value), expected: x.expected || '' })),
    written: { kv: kvChanges.length, tables: Object.keys(tableChanges).length },
  };
}

/** Is a [BLOCK] marker actually on the Config tab? setKvValue_ silently writes nothing when it is not. */
function cpBlockPresent_(configSheet, blockName) {
  const last = configSheet.getLastRow();
  if (last < 1) return false;
  const colA = configSheet.getRange(1, 1, last, 1).getDisplayValues();
  for (let i = 0; i < colA.length; i++) { if (String(colA[i][0]).trim() === `[${blockName}]`) return true; }
  return false;
}

/** Panel read: current config for the Settings tab. */
function cpGetConfig() {
  return cpGetConfig_();
}

/** Panel write: apply a Settings change set (locked; audited as a summary — values are config, not secrets). */
function cpApplyConfig(payload) {
  return cpWithLock_(() => {
    const res = cpApplyConfig_(findConfigSheet_(SpreadsheetApp.getActive()), payload);
    if (res.ok) {
      const kvN = res.written.kv; const tbN = res.written.tables;
      cpAudit_('action', '', `Settings updated (${kvN} value${kvN === 1 ? '' : 's'}${tbN ? `, ${tbN} table${tbN === 1 ? '' : 's'}` : ''})`, '', '');
      try { if (typeof cpInvalidateHealth_ === 'function') cpInvalidateHealth_(); } catch (e) { /* Trust.gs may be absent */ }
      res.state = cpGetConfig_(); // fresh state so the client can rebase without a second round-trip
    }
    return res;
  });
}

/** Menu target: open the Control Panel as a roomy, non-blocking dialog. */
function openControlPanel(initialTab) {
  runAction_('Open Control Panel', () => {
    // A sidebar is locked to 300px; a modeless dialog can be wider and still
    // stays open while you work in the sheet.
    // PERF: compute the bootstrap payload IN THIS execution and embed it in the served HTML — the dialog then
    // paints with data immediately instead of spending a second round trip (a fresh server execution, often a
    // cold start) on cpBootstrap. `</` is escaped so no member text can break out of the <script> context. Any
    // failure embeds null and the client falls back to the classic cpBootstrap RPC.
    let boot = 'null';
    try { boot = JSON.stringify(cpBootstrap()).replace(/</g, '\\u003c'); } catch (e) { log_('openControlPanel.boot', e); }
    const t = HtmlService.createTemplateFromFile('ControlPanel');
    t.bootJson = boot;
    t.initialTab = (typeof initialTab === 'string' && /^[a-z]+$/.test(initialTab)) ? initialTab : ''; // deep-link straight to a tab (e.g. 'signups')
    const html = t.evaluate()
      .setWidth(1180)   // matches the Settings Studio shell (sidebar + content)
      .setHeight(760)
      .setTitle('Roster Control');
    SpreadsheetApp.getUi().showModelessDialog(html, 'Roster Control');
  });
}

/** Menu: jump straight to the signup review. It lives IN the Control Panel (Signups tab) now, not a separate popup. */
function openSignupsDialog() {
  openControlPanel('signups');
}

/* ----------------------------------------------------------------------------
 * READ — bootstrap + snapshot
 * ------------------------------------------------------------------------- */

/** First payload the UI requests on load: meta + a full snapshot. */
function cpBootstrap() {
  if (typeof cpEnsureAuditTrigger === 'function') { try { cpEnsureAuditTrigger(); } catch (e) { log_('cpBootstrap', e); } } // audit always-on
  const snap = cpSnapshot_();
  const rosterSheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster);
  const RCadd = rosterSheet ? rosterCols_(rosterSheet) : {};
  return {
    version: CP_VERSION,
    systemName: CONFIG.systemName,
    webhooks: cpWebhookStatus_(), // per-channel booleans — read via THIS user's admin-file access
    statuses: cpStatuses_(),
    statusColors: cpStatusColors_(),                                             // {status: '#hex'} from the [STATUSES] Color column — custom statuses keep coloured pills
    protectedStatuses: (CONFIG.protectedStatuses || []).slice(),                 // PROTECTED kinds (e.g. Reserve) — the "On leave" filter includes them
    leaveTypes: CONFIG.leaveTypes.slice(),                                       // the [LEAVE].LEAVE_TYPES list — drives the schedule-leave dropdown
    addCols: { ooc: !!RCadd.ooc, shift: !!RCadd.shift },                         // which optional columns the Add-member form should offer
    // What THIS department calls its shift column, read from the sheet's own header rather than assumed. Drives
    // the member-list column heading and the Add-member field label; '' = no such column, and both disappear.
    shiftLabel: cpShiftLabel_(rosterSheet, RCadd),
    shiftAssignedBy: CONFIG.shiftAssignedBy || 'MEMBER',   // MEMBER = the person picks it; RANK = it comes with the slot
    shiftValues: (CONFIG.shiftValues || []).slice(),       // the department's own list ([] = free text)
    // The status the server WOULD write if none is chosen, so the form can mark its default honestly.
    defaultStatus: (CONFIG.tierNames && CONFIG.tierNames.length) ? CONFIG.tierNames[CONFIG.tierNames.length - 1] : 'Inactive',
    // The CONFIGURED Unique-ID length. The panel used to hardcode 17-19 (Discord) in both its validator and its
    // label, so a COMMUNITY department on 1-8 digit CIDs could not seat anyone — the form rejected every valid
    // ID before the request left the browser. Same numbers the server validates with.
    idDigits: { min: (CONFIG.idMinDigits || 17), max: (CONFIG.idMaxDigits || 19) },

    members: snap.members,
    stats: snap.stats,
    updatedAt: snap.updatedAt,
    rankIcons: {},                                                              // PERF: icons are heavy base64 — the panel lazy-loads them via cpRankIcons right after first paint (initials show for a beat)
    adminRoster: cpAdminStatus_(),                                              // { linked, access, url } — access is per-USER (Google ACL), so each opener sees their own answer
    health: (typeof cpHealthCheck_ === 'function') ? cpHealthCheck_() : null, // null if RosterTrust.gs not pasted
  };
}

/**
 * The roster's OWN header text for the shift / assignment / district column — "District", "Assignment",
 * "Patrol District", whatever they typed. Returned verbatim so the panel labels the column the way the
 * department already names it, rather than calling it "Shift" at a department that never uses that word.
 * @return {string} '' when the roster has no such column.
 */
function cpShiftLabel_(roster, RC) {
  try {
    if (!roster || !RC || !RC.shift) return '';
    const hr = RC.headerRow || ROSTER_HEADER_ROW;
    if (!hr) return '';
    return String(roster.getRange(hr, RC.shift).getDisplayValue()).trim();
  } catch (e) { log_('cpShiftLabel_', e); return ''; }
}

/** Re-pull members + stats (used by the refresh button and after writes). */
function cpRefresh() {
  return cpSnapshot_();
}

/**
 * Reads the roster (and tracker) once and returns the member list + headline
 * stats. Member SLOTS are real rank rows; `filled` distinguishes a seated
 * member from an open slot.
 */
function cpSnapshot_() {
  const ss = SpreadsheetApp.getActive();
  const members = [];
  const stats = { total: 0, active: 0, semi: 0, inactive: 0, onLeave: 0, openSlots: 0, pending: 0, expiringSoon: 0 };
  // Config-driven tier buckets (no hardcoded status names — a renamed tier still counts).
  const tierByNorm = {}; const tierCounts = {};
  CONFIG.tiers.forEach((t) => { tierByNorm[norm_(t.name)] = t.name; tierCounts[t.name] = 0; });
  const PENDING = CONFIG.pendingStatus;   // tracker "new" state
  const APPROVED = CONFIG.approvedStatus; // tracker "active leave" state
  // Hours REQUIREMENT per member: the MinHours of the top tier on whichever ladder applies to their rank, so an
  // [STATUS_OVERRIDES] rank (Auxiliary Trooper: Active:5) reports 5 while everyone else reports the global 10.
  // Without it the panel can only show a bare hours figure, with nothing to say whether it is good or bad.
  const SE = statusEngine_();
  const reqCache = {};
  const reqFor = (rank) => {
    if (reqCache[rank] == null) {
      const ladder = statusLadderFor_(rank, SE); // sorted high→low; [0] is the top tier
      reqCache[rank] = (ladder && ladder.length) ? (Number(ladder[0].min) || 0) : 0;
    }
    return reqCache[rank];
  };

  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  if (roster) {
    const last = roster.getLastRow();
    if (last >= CONFIG.rosterStartRow) {
      const n = last - CONFIG.rosterStartRow + 1;
      const RC = rosterCols_(roster);
      const block = roster.getRange(CONFIG.rosterStartRow, 1, n, roster.getLastColumn()).getDisplayValues(); // full width; index by RC (col-1)
      const rankBg = roster.getRange(CONFIG.rosterStartRow, RC.rank, n, 1).getBackgrounds(); // real rank colors
      // The band a row sits under, tracked as we walk. Free — the divider rows are already in this block, we were
      // just skipping them. NOTE: a divider ABOVE rosterStartRow is outside this read, so the rows before the
      // first in-range divider report ''. Consumers must treat '' as unknown, not as "no section".
      let section = '';
      for (let i = 0; i < n; i++) {
        const rank = String(block[i][RC.rank - 1]).trim();
        if (isDividerValue_(rank)) { section = rank; continue; }
        if (!isMemberSlot_(rank) || rank === '' || rank === 'Rank') continue;
        const name = String(block[i][RC.name - 1]).trim();
        const filled = name !== '';
        const status = String(block[i][RC.activity - 1]).trim();
        members.push({
          row: CONFIG.rosterStartRow + i,
          rank,
          name,
          callsign: String(block[i][RC.unit - 1]).trim(),
          discord: String(block[i][RC.discord - 1]).trim(),
          joinDate: String(block[i][RC.join - 1]).trim(),
          lastPromo: String(block[i][RC.promo - 1]).trim(),
          status,
          hours: String(block[i][RC.hours - 1]).trim(),
          req: reqFor(rank),                        // top-tier MinHours for THIS rank's ladder (0 = no requirement)
          section,                                  // the divider band this row sits under ('' = above the first one)
          shift: RC.shift ? String(block[i][RC.shift - 1]).trim() : '', // shift / assignment / district — '' when the roster has no such column
          color: String(rankBg[i][0] || '').trim(), // exact rank-cell color from the sheet
          filled,
        });
        if (!filled) { stats.openSlots++; continue; }
        stats.total++;
        const tname = tierByNorm[norm_(status)];
        if (tname) tierCounts[tname]++;
        if (isProtectedStatus_(status)) stats.onLeave++;
      }
    }
  }
  // Back-compat KPI aliases: active = highest tier, inactive = lowest, semi = every tier in between.
  const tn = CONFIG.tierNames;
  stats.active = tn.length ? tierCounts[tn[0]] : 0;
  stats.inactive = tn.length ? tierCounts[tn[tn.length - 1]] : 0;
  for (let ti = 1; ti < tn.length - 1; ti++) stats.semi += tierCounts[tn[ti]];
  stats.tierCounts = tierCounts;

  const tracker = ss.getSheetByName(CONFIG.sheets.tracker);
  if (tracker) {
    const last = tracker.getLastRow();
    if (last >= CONFIG.trackerStartRow) {
      const n = last - CONFIG.trackerStartRow + 1;
      const TC = trackerCols_(tracker);
      const tvals = tracker.getRange(CONFIG.trackerStartRow, 2, n, TC.width - 1).getValues(); // cols B..(width)
      const today = todayInSheetTz_().getTime();
      const weekMs = 7 * 86400000;
      for (let i = 0; i < n; i++) {
        const status = tvals[i][TC.status - 2];
        if (status === PENDING) stats.pending++;
        if (status === APPROVED) {
          const end = new Date(tvals[i][TC.end - 2]);
          if (!isNaN(end.getTime())) {
            const e = startOfDay_(end).getTime();
            if (e >= today && e - today <= weekMs) stats.expiringSoon++;
          }
        }
      }
    }
  }

  return { members, stats, updatedAt: fmtTs_(new Date()) }; // v1.0: configurable timestamp format
}

/* ----------------------------------------------------------------------------
 * RANK ICONS (v1.3.1) — a small avatar image per rank, shown in the Control
 * Panel in place of the member's initials. Admins upload one image per rank in
 * the Settings panel; the browser downscales it to a data: URI.
 *
 * Storage: DOCUMENT PROPERTIES (script storage), NOT a sheet. Base64 image blobs
 * in cells slow the whole spreadsheet's load — Sheets fetches every cell's full
 * content on open, even on hidden tabs. Properties are read only when the panel
 * loads, so the document opens fast. Each icon is chunked across properties to
 * stay under the 9 KB per-value limit. The v1.3.0 "_Rank Icons" tab is migrated
 * into properties and deleted on the first read (one-time, self-healing).
 * ------------------------------------------------------------------------- */
const RANK_ICON_SHEET_ = '_Rank Icons';   // legacy v1.3.0 store — migrated away then deleted
const RANK_ICON_PREFIX_ = 'REICON:';      // document-property key prefix (keys: REICON:<encoded rank>:<chunk#>)
const RANK_ICON_CHUNK_ = 9000;            // < the 9 KB per-property ceiling
const RANK_ICON_MAX_LEN_ = 16000;         // cap per icon (matches the panel's ICON_CAP) — a couple of chunks; keeps the 500 KB total-property budget safe across ~30 ranks

/** The per-document property store (never getScriptProperties — that would share icons across every template using the library). */
function rankIconProps_() { return PropertiesService.getDocumentProperties(); }

/** Store a rank's icon as chunked document properties, replacing any prior chunks. */
function setRankIconStore_(rank, dataUri) {
  deleteRankIconStore_(rank);
  const props = rankIconProps_(), toSet = {}, base = RANK_ICON_PREFIX_ + encodeURIComponent(rank) + ':';
  const n = Math.ceil(dataUri.length / RANK_ICON_CHUNK_);
  for (let i = 0; i < n; i++) toSet[base + i] = dataUri.substr(i * RANK_ICON_CHUNK_, RANK_ICON_CHUNK_);
  props.setProperties(toSet, false); // false = keep every OTHER property (webhooks, reset marker, …) intact
}

/** Remove every stored chunk for a rank. */
function deleteRankIconStore_(rank) {
  const props = rankIconProps_(), all = props.getProperties(), pfx = RANK_ICON_PREFIX_ + encodeURIComponent(rank) + ':';
  Object.keys(all).forEach((k) => { if (k.indexOf(pfx) === 0) props.deleteProperty(k); });
}

/** One-time: move any v1.3.0 sheet-stored icons into document properties, then drop the slow base64-in-cells tab. Idempotent (no-op once the tab is gone). */
function migrateRankIconSheet_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(RANK_ICON_SHEET_);
  if (!sh) return;
  try {
    const last = sh.getLastRow();
    if (last >= 2) {
      const vals = sh.getRange(2, 1, last - 1, 2).getValues();
      vals.forEach((r) => {
        const rank = String(r[0] || '').trim(), uri = String(r[1] || '').trim();
        if (rank && /^data:image\//i.test(uri)) { try { setRankIconStore_(rank, uri); } catch (e) { log_('migrateRankIcon', e); } } // skip an icon too big for the property budget
      });
    }
    ss.deleteSheet(sh); // remove the tab that was slowing the document load
  } catch (e) { log_('migrateRankIconSheet_', e); }
}

/** { rank: dataUri } for every stored icon (reassembled from chunks). Migrates the legacy tab on first call. */
function rankIconsMap_() {
  migrateRankIconSheet_();
  const all = rankIconProps_().getProperties();
  const parts = {};
  Object.keys(all).forEach((k) => {
    if (k.indexOf(RANK_ICON_PREFIX_) !== 0) return;
    const rest = k.slice(RANK_ICON_PREFIX_.length), at = rest.lastIndexOf(':'); // index is the numeric LAST segment — safe even if the rank had ':'
    if (at < 0) return;
    let rank; try { rank = decodeURIComponent(rest.slice(0, at)); } catch (e) { return; }
    const idx = parseInt(rest.slice(at + 1), 10);
    if (!rank || isNaN(idx)) return;
    (parts[rank] || (parts[rank] = []))[idx] = all[k];
  });
  const map = {};
  Object.keys(parts).forEach((rank) => { const uri = parts[rank].join(''); if (uri) map[rank] = uri; }); // chunks were stored by substr() with NO separator — rejoin them raw (a separator corrupts any icon > 1 chunk)
  return map;
}

/** Panel endpoint: the distinct roster ranks (+ filled-member counts) merged with any stored icons — feeds the Settings editor's auto-detected list. */
function cpRankIcons() {
  const ss = SpreadsheetApp.getActive();
  const counts = {}; const order = [];
  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  if (roster) {
    const last = roster.getLastRow();
    if (last >= CONFIG.rosterStartRow) {
      const n = last - CONFIG.rosterStartRow + 1;
      const RC = rosterCols_(roster);
      const ranks = roster.getRange(CONFIG.rosterStartRow, RC.rank, n, 1).getDisplayValues();
      const names = roster.getRange(CONFIG.rosterStartRow, RC.name, n, 1).getDisplayValues();
      for (let i = 0; i < n; i++) {
        const rank = String(ranks[i][0]).trim();
        if (rank === '' || rank === 'Rank' || !isMemberSlot_(rank)) continue;
        if (!(rank in counts)) { counts[rank] = 0; order.push(rank); }
        if (String(names[i][0]).trim() !== '') counts[rank]++;
      }
    }
  }
  const icons = rankIconsMap_();
  Object.keys(icons).forEach((r) => { if (!(r in counts)) { counts[r] = 0; order.push(r); } }); // keep icons for ranks no longer on the roster
  return { ranks: order.map((r) => ({ rank: r, members: counts[r], icon: icons[r] || '' })) };
}

/** Panel endpoint: store/replace a rank's icon. `dataUri` is a small data:image/…;base64 string (already downscaled in the browser). */
function cpSetRankIcon(rank, dataUri) {
  rank = String(rank == null ? '' : rank).trim();
  if (!rank) throw new Error('A rank is required.');
  dataUri = String(dataUri == null ? '' : dataUri).trim();
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(dataUri)) throw new Error('The icon must be a PNG, JPG, GIF or WEBP image.');
  if (dataUri.length > RANK_ICON_MAX_LEN_) throw new Error('That icon is too large to store even after resizing — try a simpler image.');
  setRankIconStore_(rank, dataUri);
  try { if (typeof logInfo_ === 'function') logInfo_('cpSetRankIcon', `icon set for rank "${rank}" (${dataUri.length} chars).`); } catch (e) { /* logging optional */ }
  return { ok: true, rank: rank };
}

/** Panel endpoint: remove a rank's icon (members with that rank fall back to initials). */
function cpDeleteRankIcon(rank) {
  rank = String(rank == null ? '' : rank).trim();
  if (rank) deleteRankIconStore_(rank);
  return { ok: true, rank: rank };
}

/** Profile data for one member: leave history (tracker) + weekly hours series (_Hours History). */
function cpGetProfile(discordId) {
  const id = String(discordId).trim();
  const leaves = [];
  const history = [];
  if (id === '') return { leaves, history };
  const ss = SpreadsheetApp.getActive();

  const tracker = ss.getSheetByName(CONFIG.sheets.tracker);
  if (tracker) {
    const last = tracker.getLastRow();
    if (last >= CONFIG.trackerStartRow) {
      const n = last - CONFIG.trackerStartRow + 1;
      const TC = trackerCols_(tracker);
      const disp = tracker.getRange(CONFIG.trackerStartRow, 2, n, TC.width - 1).getDisplayValues(); // B..(width)
      const ids = tracker.getRange(CONFIG.trackerStartRow, TC.discord, n, 1).getDisplayValues();
      for (let i = 0; i < n; i++) {
        if (String(ids[i][0]).trim() !== id) continue;
        leaves.push({
          type: trackerLeaveType_(),
          start: String(disp[i][TC.start - 2]).trim(),
          end: String(disp[i][TC.end - 2]).trim(),
          status: String(disp[i][TC.status - 2]).trim(),
        });
      }
    }
  }

  // Weekly hours series from the hidden history tab (schema: A WeekOf, B DiscordID, E Hours).
  const hist = ss.getSheetByName(CONFIG.sheets.hoursHistory); // v1.0: config-driven history tab name
  if (hist) {
    const last = hist.getLastRow();
    if (last >= 2) {
      const n = last - 1;
      const vals = hist.getRange(2, 1, n, 6).getValues();
      const hids = hist.getRange(2, 2, n, 1).getDisplayValues();
      const byWeek = {};
      for (let i = 0; i < n; i++) {
        if (String(hids[i][0]).trim() !== id) continue;
        const a = vals[i][0];
        const week = (a instanceof Date && !isNaN(a.getTime()))
          ? Utilities.formatDate(a, ssTz_(), 'yyyy-MM-dd')
          : String(a).trim();
        if (week === '') continue;
        byWeek[week] = { hours: Number(vals[i][4]) || 0, status: String(vals[i][5] || '').trim() }; // a later row for the same week wins; F col = Status (v1.0 activity checks)
      }
      Object.keys(byWeek).sort().slice(-12).forEach((w) => history.push({ week: w, hours: byWeek[w].hours, status: byWeek[w].status }));
    }
  }
  return { leaves, history };
}

/* ----------------------------------------------------------------------------
 * WRITE — status, onboarding, navigation
 * ------------------------------------------------------------------------- */

/** Safe semantic audit write (no-op if RosterTrust.gs isn't pasted). */
function cpAudit_(type, oldText, newText, cellA1, member) {
  publishMarkDirty_(); // panel actions are script writes -> no onEdit -> the sweep would otherwise never know
  if (typeof auditEvent_ === 'function') { try { auditEvent_(type, oldText, newText, cellA1, member); } catch (e) { log_('cpAudit_', e); } }
}

/** Injectable core: validate + set one member's status on the given roster sheet (testable). */
function cpSetStatus_(roster, row, status) {
  if (cpStatuses_().indexOf(status) === -1) throw new Error(`Invalid status: ${status}`);
  cpAssertSlotRow_(roster, row);
  roster.getRange(row, rosterCols_(roster).activity).setValue(status);
  return cpMemberAt_(roster, row);
}

/** Set one member's activity status. `expectedId` (optional) guards against a stale row. Returns the refreshed member. */
function cpSetStatus(row, status, expectedId) {
  return cpWithLock_(() => {
    const roster = cpRoster_();
    const vr = cpResolveMemberRow_(roster, row, expectedId); // verify identity before writing
    const before = cpMemberAt_(roster, vr);
    const m = cpSetStatus_(roster, vr, status);
    cpAudit_('status', before.status || 'empty', status, roster.getRange(vr, rosterCols_(roster).name).getA1Notation(), before.name);
    return m;
  });
}

/**
 * Injectable core: set the same status on many rows of the given roster (testable).
 * `ids` (optional) is a parallel array of the Discord IDs the client believed occupied each row; when present,
 * each write is identity-verified (relocating a shifted member, skipping a vanished one) — F-027.
 */
function cpSetStatusBulk_(roster, rows, status, ids) {
  if (cpStatuses_().indexOf(status) === -1) throw new Error(`Invalid status: ${status}`);
  if (!Array.isArray(rows) || !rows.length) throw new Error('No members selected.');
  const RC = rosterCols_(roster);
  const idArr = Array.isArray(ids) ? ids : [];
  // One read per column + ONE write for the whole selection, instead of ~5 round-trips per member — a bulk action
  // holds the script lock, so every saved call shortens the window in which other panel writes time out on it.
  // The per-row semantics are unchanged: identity-verified when the client sent IDs (relocate a shifted member,
  // skip a vanished one — F-027), slot-validated always, failures logged and skipped.
  const start = CONFIG.rosterStartRow, last = roster.getLastRow();
  const n = Math.max(0, last - start + 1);
  const idCol = n ? roster.getRange(start, RC.discord, n, 1).getDisplayValues() : [];
  const rankCol = n ? roster.getRange(start, RC.rank, n, 1).getDisplayValues() : [];
  const nameCol = n ? roster.getRange(start, RC.name, n, 1).getDisplayValues() : [];
  const at = (col, r) => (r >= start && r < start + n) ? String(col[r - start][0]).trim() : '';
  const isSlot = (r) => { const k = at(rankCol, r); return isMemberSlot_(k) && k !== '' && k !== 'Rank'; };
  const colA1 = (c) => { let s = ''; while (c > 0) { s = String.fromCharCode(65 + ((c - 1) % 26)) + s; c = Math.floor((c - 1) / 26); } return s; };
  const changed = [], cells = [];
  rows.forEach((r, i) => {
    try {
      const want = String(idArr[i] == null ? '' : idArr[i]).trim();
      let vr = Number(r);
      if (want !== '' && at(idCol, vr) !== want) { // identity moved → relocate by ID (the sheet is the source of truth)
        vr = -1;
        for (let k = 0; k < n; k++) { if (String(idCol[k][0]).trim() === want) { vr = start + k; break; } }
        if (vr === -1) throw new Error('That member has moved or been removed since the panel loaded.');
      }
      if (!isSlot(vr)) throw new Error(`Row ${vr} is not a member slot.`);
      cells.push(colA1(RC.activity) + vr);
      changed.push(at(nameCol, vr) || `row ${vr}`);
    } catch (e) { log_('cpSetStatusBulk_', e); }
  });
  if (cells.length) roster.getRangeList(cells).setValue(status);
  return { count: changed.length, status, members: changed };
}

/** Set the same status on many members at once. `expectedIds` (optional) mirrors `rows` for identity checks. */
function cpSetStatusBulk(rows, status, expectedIds) {
  return cpWithLock_(() => {
    const res = cpSetStatusBulk_(cpRoster_(), rows, status, expectedIds);
    const who = (res.members && res.members.length) ? res.members.join(', ') : '(none)';
    cpAudit_('bulk', '', `${res.status} → ${who}`, '', `${res.count} member${res.count === 1 ? '' : 's'}`); // identities logged (F-027)
    return res;
  });
}

/** Parses a yyyy-MM-dd string to a LOCAL-midnight Date (avoids the UTC day-shift). */
function cpParseYMD_(s) {
  const p = String(s || '').split('-');
  if (p.length !== 3) return new Date(NaN);
  const y = Number(p[0]); const m = Number(p[1]); const d = Number(p[2]);
  const dt = new Date(y, m - 1, d);
  // reject non-numeric / out-of-range parts (month 13, day 40) — JS would silently roll them into a valid Date
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return new Date(NaN);
  return dt;
}

/** Runs fn while holding the script lock so two concurrent panel writes can't race (TOCTOU → dup IDs / double-seat). */
function cpWithLock_(fn) {
  const lock = LockService.getScriptLock();
  // INTERACTIVE-FIRST: stamp the publisher's backoff BEFORE waiting, so no NEW publish pass starts while this
  // write queues — the in-flight pass finishes inside our 30s wait and the lock falls to us. Not cleared on
  // release (admin sessions come in bursts); it simply expires, and the sweep then carries any pending publish.
  try { PropertiesService.getDocumentProperties().setProperty(PUBLISH_BACKOFF_PROP_, String(Date.now() + PUBLISH_BACKOFF_MS_)); } catch (e) { /* best-effort priority hint */ }
  // 30s, not 10s: a colliding save should ride out the publisher's current pass ("Saving…" a little longer), not hard-fail.
  if (!lock.tryLock(30000)) throw new Error('Another roster operation is holding the lock (usually the background publisher) — wait a few seconds and try again.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/**
 * Schedules an LOA/ROA for a member straight from the panel — mirrors the form-sync
 * append (same columns, formulas, dedup key) so it behaves identically to a form submission.
 * @param {{row:number, type:string, start:string, end:string, status?:string, notes?:string}} p
 * @return {Object} { status, applied, member }
 */
function cpScheduleLeave(p) {
  return cpWithLock_(() => {
    const ss = SpreadsheetApp.getActive();
    const roster = cpRoster_();
    const tracker = ss.getSheetByName(CONFIG.sheets.tracker);
    if (!tracker) throw new Error(`Tracker tab "${CONFIG.sheets.tracker}" not found.`);
    const res = cpScheduleLeave_(roster, tracker, p, { sendWebhooks: true });
    cpAudit_('leave', '', `${res.type} ${fmtDisplay_(res.start)}–${fmtDisplay_(res.end)} (${res.status})`, // v1.0: configurable date format (matches the webhook + form-path audit)
      roster.getRange(res.row, rosterCols_(roster).name).getA1Notation(), res.member.name);
    return { status: res.status, applied: res.applied, member: res.member };
  });
}

/**
 * Injectable core: append an LOA/ROA to the given tracker and apply it to the roster.
 * No audit; `opts.sendWebhooks` gates the Discord post (tests pass false). Testable.
 */
function cpScheduleLeave_(roster, tracker, p, opts) {
  opts = opts || {};
  const type = trackerLeaveType_(); // LOA-only tracker: no per-row TYPE column (any p.type from the panel is ignored)
  const status = String((p && p.status) || CONFIG.pendingStatus).trim();
  const notes = String((p && p.notes) || '').trim();
  if (norm_(status) !== norm_(CONFIG.pendingStatus) && norm_(status) !== norm_(CONFIG.approvedStatus)) throw new Error(`Status must be ${CONFIG.pendingStatus} or ${CONFIG.approvedStatus}.`);

  const start = cpParseYMD_(p && p.start);
  const end = cpParseYMD_(p && p.end);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new Error('Start and end dates are required.');
  if (end.getTime() < start.getTime()) throw new Error('End date is before the start date.');
  if (!tracker) throw new Error(`Tracker tab "${CONFIG.sheets.tracker}" not found.`);

  const row = cpResolveMemberRow_(roster, Number(p && p.row), p && p.expectedId); // identity-verified target (F-002)
  const m = cpMemberAt_(roster, row);
  if (!m.filled) throw new Error('That slot has no member yet.');
  if (!isValidId_(m.discord)) throw new Error('This member needs a valid ' + idDigitsLabel_() + '-digit Unique ID first.');

  // Dedup by LEAVE identity (member + dates + type), NOT click time, so two staffers scheduling the same leave
  // seconds apart can't create two rows (F-039). This is the OPPOSITE trade from the form path (syncFormToTracker_,
  // timestamp key): the panel intentionally blocks re-scheduling the same dates (admin controls the tracker directly),
  // whereas the form allows a member to re-request after a denial. Cross-path duplicates are processed idempotently by
  // processDailyLOAs_ — so unifying the two key formats is unnecessary and would break the form re-request path.
  const dedupKey = makeLeaveKey_(m.discord, `${startOfDay_(start).getTime()}-${startOfDay_(end).getTime()}-${norm_(type)}`);
  if (dedupKey && buildSyncedKeySet_(tracker)[dedupKey]) throw new Error('That exact leave (same member, dates, and type) is already on the tracker.');

  // Append exactly like syncFormToTracker_ (real Date objects + the same countdown formulas).
  const oi = rosterOocShift_(m.discord); // auto-fill OOC name + shift from the roster (by Unique ID)
  const TC = trackerCols_(tracker);
  // Prepend the new leave at the TOP and re-group by status — fields placed by their resolved header column (any layout).
  sortTracker_(buildTrackerRow_(TC, TC.width, { key: dedupKey, rank: m.rank, unit: m.callsign, ooc: oi.ooc, name: m.name, discord: m.discord, shift: oi.shift, start: start, end: end, status: status, notes: notes }), tracker);

  // Script writes don't fire onEdit, so apply an already-active approved leave to the roster now.
  let applied = false;
  if (norm_(status) === norm_(CONFIG.approvedStatus)) {
    const today = todayInSheetTz_().getTime();
    const active = today < startOfDay_(new Date(end)).getTime() && today >= startOfDay_(new Date(start)).getTime();
    // Don't silently overwrite a DIFFERENT existing protected status (e.g. Reserve→LOA would be lost on expiry) — matches processDailyLOAs_.
    const protectOk = !isProtectedStatus_(m.status) || m.status === type;
    if (active && protectOk) {
      updateRosterStatus(roster, m.discord, type);
      applied = true;
    }
  }

  if (opts.sendWebhooks !== false) {
    try {
      const diff = Math.round(Math.abs(end - start) / 86400000);
      sendDiscordWebhook(m.name, m.rank, m.callsign, type,
        fmtDisplay_(start), fmtDisplay_(end),
        `${diff} ${diff === 1 ? 'Day' : 'Days'}`, m.discord); // v1.0: configurable date format
    } catch (e) { log_('cpScheduleLeave_', e); }
  }

  return { status, applied, member: cpMemberAt_(roster, row), row, type, start, end };
}

/**
 * Seats a new member into an existing OPEN slot (does not insert rows).
 * @param {{row:number, name:string, discord:string, joinDate?:string}} payload
 * @return {Object} the refreshed member.
 */
function cpAssignMember(payload) {
  const seated = cpWithLock_(() => {
    const roster = cpRoster_();
    const s = cpAssignMember_(roster, payload);
    cpAudit_('add', '', `${s.rank} · ${s.callsign}`, roster.getRange(Number(payload.row), rosterCols_(roster).name).getA1Notation(), s.name);
    return s;
  });
  // A member seated into a training-rank slot should show on the Police Academy (and group bands) right away.
  try { if (typeof buildAcademySheets_ === 'function') buildAcademySheets_(); } catch (e2) { log_('cpAssignMember.academy', e2); }
  try { if (typeof buildGroupSheets_ === 'function') buildGroupSheets_(); } catch (e2) { log_('cpAssignMember.groups', e2); }
  notifyCh_('AUDIT', CONFIG.notify.memberAdded, { // roster-change traffic → AUDIT channel; after the lock releases
    description: clamp_(`# ${fill_(CONFIG.notify.memberAddedTitle, { name: seated.name })}\nThis member has been added to the roster.`, 4000),
    color: hexToInt_(CONFIG.notify.memberAddedColor, 5749594),
    fields: [
      { name: '`👮` Name', value: clamp_(dash_(seated.name), 1000), inline: true },
      { name: '`🛡️` Rank', value: clamp_(dash_(withIcon_(seated.rank)), 1000), inline: true },
      { name: '`🎙️` Callsign', value: clamp_(dash_(seated.callsign), 1000), inline: true },
    ],
  }, mention_(seated.discord));
  return seated;
}

/** Injectable core: seat a member into an open slot of the given roster (no audit; testable). */
function cpAssignMember_(roster, payload) {
  const row = Number(payload && payload.row);
  const name = String((payload && payload.name) || '').trim();
  const discord = String((payload && payload.discord) || '').trim();
  const joinRaw = String((payload && payload.joinDate) || '').trim();
  const ooc = String((payload && payload.ooc) || '').trim();     // optional OOC name (written only if the roster has that column)
  const shift = String((payload && payload.shift) || '').trim(); // optional shift (written only if the roster has that column)
  // Optional starting status. Whitelisted against the CONFIGURED vocabulary — this value is written straight
  // into the activity column, so an unrecognised one would poison every count that groups by status.
  const statusReq = String((payload && payload.status) || '').trim();
  let startStatus = '';
  if (statusReq) {
    // cpStatuses_(), not CONFIG.statusNames: CONFIG is a getter for cfg_().LEGACY, and the legacy view has
    // no statusNames key — so this read undefined, the list was always [], and EVERY status was rejected.
    const known = cpStatuses_().filter((s) => norm_(s) === norm_(statusReq));
    if (!known.length) throw new Error(`"${statusReq}" is not one of this department's statuses.`);
    startStatus = known[0]; // the configured spelling, not whatever case the client sent
  }

  if (!name) throw new Error('Name is required.');
  if (!isValidId_(discord)) throw new Error('Unique ID must be ' + idDigitsLabel_() + ' digits.');

  cpAssertSlotRow_(roster, row);
  const RC = rosterCols_(roster);
  const existing = String(roster.getRange(row, RC.name).getDisplayValue()).trim();
  if (existing !== '') throw new Error(`That slot already holds ${existing}. Pick an open slot.`);
  cpAssertUniqueId_(roster, discord, row);

  let joinDate = joinRaw ? cpParseYMD_(joinRaw) : todayInSheetTz_(); // local-midnight — new Date('yyyy-MM-dd') is UTC and shifts the day in western zones
  if (isNaN(joinDate.getTime())) joinDate = todayInSheetTz_();

  roster.getRange(row, RC.name).setValue(name);
  const idCell = roster.getRange(row, RC.discord);
  idCell.setNumberFormat('@'); // keep the 17-19 digit ID as exact text
  idCell.setValue(discord);
  if (RC.ooc && ooc) roster.getRange(row, RC.ooc).setValue(ooc);       // optional display columns — only when the roster has them
  if (RC.shift && shift) roster.getRange(row, RC.shift).setValue(shift);
  roster.getRange(row, RC.join).setValue(joinDate);   // Join Date
  // Seat at the lowest tier unless a starting status was chosen. NOTE for anyone reading a surprising roster:
  // a TIER status here is advisory — the next activity check recomputes it from hours, so "Active" with 0 hours
  // reverts. A LEAVE/PROTECTED status (LOA, Reserve) is preserved by resolveStatus_ and does stick.
  roster.getRange(row, RC.activity).setValue(startStatus
    || (CONFIG.tierNames.length ? CONFIG.tierNames[CONFIG.tierNames.length - 1] : 'Inactive'));
  roster.getRange(row, RC.hours).setValue(0);
  return cpMemberAt_(roster, row);
}

/**
 * Injectable core: move the member at fromRow into the OPEN slot at toRow (transfer / promotion). MEMBER columns
 * (name, ID, hours, dates…) follow the person; SLOT columns (Rank/Callsign) belong to the destination, so the
 * member takes on that slot's rank and callsign. No audit / notify — the endpoint layers those on. Testable.
 */
function cpMoveMember_(roster, fromRow, toRow) {
  fromRow = Number(fromRow); toRow = Number(toRow);
  if (fromRow === toRow) throw new Error('Pick a different slot to move into.');
  cpAssertSlotRow_(roster, fromRow);
  cpAssertSlotRow_(roster, toRow);
  const RC = rosterCols_(roster);
  const name = String(roster.getRange(fromRow, RC.name).getDisplayValue()).trim();
  if (name === '') throw new Error('That member row is empty — there is nothing to move.');
  const destName = String(roster.getRange(toRow, RC.name).getDisplayValue()).trim();
  if (destName !== '') throw new Error(`That slot already holds ${destName}. Pick an open slot.`);
  const fromRank = String(roster.getRange(fromRow, RC.rank).getDisplayValue()).trim() || 'Unknown';
  const toRank = String(roster.getRange(toRow, RC.rank).getDisplayValue()).trim() || 'Unknown';
  const discord = String(roster.getRange(fromRow, RC.discord).getDisplayValue()).trim();
  moveMemberColumns_(roster, fromRow, toRow);
  return { name: name, discord: discord, fromRank: fromRank, toRank: toRank, member: cpMemberAt_(roster, toRow) };
}

/** Panel endpoint: move a member into an open slot, audit it, and fire the optional transfer embed. */
function cpMoveMember(payload) {
  const expectedId = String((payload && payload.expectedId) || '').trim();
  const res = cpWithLock_(() => {
    const roster = cpRoster_();
    const fromRow = Number(payload && payload.fromRow);
    if (expectedId) { // F-002: the row the panel showed must still hold the same member (guard against a shifted row)
      const idAt = String(roster.getRange(fromRow, rosterCols_(roster).discord).getDisplayValue()).trim();
      if (idAt !== expectedId) throw new Error('The roster changed since this panel loaded — refresh and try again.');
    }
    const r = cpMoveMember_(roster, fromRow, payload && payload.toRow);
    cpAudit_('move', r.fromRank, r.toRank, roster.getRange(Number(payload.toRow), rosterCols_(roster).name).getA1Notation(), r.name);
    return r;
  });
  // A move changes the member's rank (SLOT rank belongs to the destination) → re-sync the Police Academy + group bands.
  try { if (typeof buildAcademySheets_ === 'function') buildAcademySheets_(); } catch (e2) { log_('cpMoveMember.academy', e2); }
  try { if (typeof buildGroupSheets_ === 'function') buildGroupSheets_(); } catch (e2) { log_('cpMoveMember.groups', e2); }
  promoRecord_(Number(payload && payload.fromRow), Number(payload && payload.toRow), res.name, res.fromRank, res.toRank); // RECENT PROMOTIONS feed (no-op unless it was a promotion)
  notifyCh_('AUDIT', CONFIG.notify.transfer, { // roster-change traffic → AUDIT channel; after the lock releases, only on a successful move
    description: clamp_(`# ${fill_(CONFIG.notify.transferTitle, { name: res.name, from: res.fromRank, to: res.toRank })}\nThis member has been transferred. Their roster row has been updated.`, 4000),
    color: hexToInt_(CONFIG.notify.transferColor, 5793266),
    fields: [
      { name: '`👮` Name', value: clamp_(dash_(res.name), 1000), inline: true },
      { name: '`↗️` From', value: clamp_(dash_(withIcon_(res.fromRank)), 1000), inline: true },
      { name: '`🛡️` To', value: clamp_(dash_(withIcon_(res.toRank)), 1000), inline: true },
    ],
  }, mention_(res.discord));
  return { moved: true, name: res.name, fromRank: res.fromRank, toRank: res.toRank, toRow: res.member.row, member: res.member };
}

/** Activate the roster tab and select a member's row (jump-to). Starts at the RANK column so a merged RANK GROUP band to its left never pulls the whole section into the selection. */
function cpJumpTo(row) {
  const ss = SpreadsheetApp.getActive();
  const roster = cpRoster_();
  ss.setActiveSheet(roster);
  const startCol = rosterCols_(roster).rank || 3;                 // never column B — that band is merged across the section's rows
  const width = Math.min(8, Math.max(1, roster.getMaxColumns() - startCol + 1));
  roster.getRange(row, startCol, 1, width).activate();
  return true;
}

/* ----------------------------------------------------------------------------
 * ACTIONS — call the existing cores directly, return a status string
 * ------------------------------------------------------------------------- */

/* ── RUN LOG ──────────────────────────────────────────────────────────────────────────────────────────────
 * Every maintenance action reports what it changed, and until now that report went to a toast and vanished.
 * A toast is not a place. These entries give the results a permanent home so you can see what the engine has
 * been doing without reading the audit sheet. Same shape as the promotions store: a capped JSON list in a
 * document property, newest first. */
const RUNLOG_PROP_ = 'RE_RUNLOG';
const RUNLOG_MAX_ = 42;

/** Classify a result line so the panel can colour it: found something / failed / nothing notable. */
function runLogLevel_(msg, failed) {
  if (failed) return 'err';
  const m = String(msg || '');
  // "2 duplicates", "3 responses", "1 leave started" — a number greater than zero means it DID something.
  if (/\b(cancel|skipp?ed|locked)\b/i.test(m)) return 'warn';
  if (/\b(0|no)\b\s+(new|change|duplicate|response|member|leave)/i.test(m)) return 'ok';
  return /\d/.test(m) ? 'warn' : 'ok';
}

/** Record one run. Never throws into the action — a log that can break the thing it logs is worse than none. */
function runLogAdd_(name, label, msg, failed) {
  try {
    const P = PropertiesService.getDocumentProperties();
    let list; try { list = JSON.parse(P.getProperty(RUNLOG_PROP_) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    list.unshift({ t: Date.now(), a: String(name || ''), l: String(label || name || ''),
      r: clamp_(String(msg || ''), 300), lv: runLogLevel_(msg, failed) });
    if (list.length > RUNLOG_MAX_) list.length = RUNLOG_MAX_;
    P.setProperty(RUNLOG_PROP_, JSON.stringify(list));
  } catch (e) { log_('runLogAdd_', e); }
}

/** Panel: the run log, newest first. */
function cpRunLog() {
  try {
    const raw = PropertiesService.getDocumentProperties().getProperty(RUNLOG_PROP_) || '[]';
    const list = JSON.parse(raw);
    return { runs: Array.isArray(list) ? list : [], total: Array.isArray(list) ? list.length : 0 };
  } catch (e) { return { runs: [], total: 0 }; }
}

function cpRunAction(name) {
  let msg;
  try {
    msg = cpRunActionCore_(name);
  } catch (e) {
    runLogAdd_(name, CP_ACTION_LABELS_[name], (e && e.message) || String(e), true);
    throw e;
  }
  cpAudit_('action', '', msg, '', '');
  runLogAdd_(name, CP_ACTION_LABELS_[name], msg, false);
  return msg;
}

/** The human name for each action, so the log reads as a sentence and not as a function name. */
const CP_ACTION_LABELS_ = Object.freeze({
  updateStatuses: 'Update all statuses',
  processLeaves: 'Run schedule check',
  syncForms: 'Sync leave forms',
  syncSignups: 'Sync signup forms',
  syncPatrol: 'Sync patrol logs',
  buildGroups: 'Build / refresh group sheets',
  buildAcademy: 'Build / refresh police academy',
  buildActivity: 'Build / refresh activity panel',
  scanIntegrity: 'Run integrity scan',
  checkDuplicates: 'Check duplicate IDs',
  publishRoster: 'Publish public roster',
  fixUnits: 'Fix callsign numbers',        // no longer a panel action; the label stays so old run-log rows still read
  purgeWebhooks: 'Remove all webhooks',
});
/* Every one of these has a MENU twin (buildGroupSheets, scanIntegrity, publishPublicRosterNow …) that wraps the
 * same work in runAction_ + SpreadsheetApp.getUi().alert. None of those can be called from here: a modeless
 * dialog has no UI to alert into, and the wrapper returns nothing to report. So each case calls the CORE and
 * builds the sentence itself — which is also why the messages read like the alerts they replace.
 *
 * RosterExtras.gs is an optional file in a library-mode install, so anything living there is feature-detected
 * rather than assumed; a missing file must say so, not throw a ReferenceError at the panel. */
function cpRunActionCore_(name) {
  switch (name) {
    case 'purgeWebhooks': {
      // Kill switch for webhook abuse: wipes every channel (admin-file Webhooks tab + the legacy Script Properties).
      // Google's ACL gates it — clearing the tab needs WRITE access to the admin file.
      const file = adminFile_();
      if (!file) throw new Error('No admin roster linked — there are no webhooks to remove.');
      const sh = file.getSheetByName(WEBHOOK_TAB_);
      if (sh && sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(2, sh.getLastColumn())).clearContent();
      try { const p = PropertiesService.getScriptProperties(); p.deleteProperty(CONFIG.webhookProp); p.deleteProperty(ERRORS_WEBHOOK_PROP); } catch (e) { /* legacy props may be gone */ }
      _webhookMemo_ = null;
      try { if (typeof cpInvalidateHealth_ === 'function') cpInvalidateHealth_(); } catch (e) { /* Trust.gs may be absent */ }
      return 'All Discord webhooks removed — every channel is silent until new URLs are saved.';
    }
    case 'updateStatuses': {
      const r = recomputeStatuses_(cpRoster_(), false);
      return `Recomputed ${r.total} member(s) from hours — ${r.changed.length} changed${r.protectedSkipped ? `, ${r.protectedSkipped} on leave left alone` : ''}.`;
    }
    case 'processLeaves': {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(5000)) return 'Another schedule run is in progress — try again shortly.';
      try {
        const ss = SpreadsheetApp.getActive();
        const tracker = ss.getSheetByName(CONFIG.sheets.tracker);
        const roster = ss.getSheetByName(CONFIG.sheets.roster);
        if (!tracker || !roster) throw new Error('Roster or tracker tab is missing.');
        const s = processDailyLOAs_(roster, tracker, todayInSheetTz_(), { sendWebhooks: true });
        return `Schedule check done — scanned ${s.scanned}, started ${s.started.length}, expired ${s.expired.length}.`;
      } finally {
        lock.releaseLock();
      }
    }
    case 'syncForms': {
      const res = syncFormToTracker();
      return res === false ? 'Another sync is already running.'
        : res > 0 ? `Synced ${res} new leave form${res === 1 ? '' : 's'} to the tracker.`
          : 'No new leave forms to sync.';
    }
    case 'checkDuplicates':
      return cpDuplicateReport_();
    case 'scanIntegrity': {
      if (typeof scanIntegrityCore_ !== 'function') throw new Error('Integrity scan needs RosterExtras.gs, which is not installed.');
      const issues = scanIntegrityCore_();
      if (!issues.length) return 'No integrity issues found — the roster and tracker look clean.';
      const where = (typeof EXTRAS === 'object' && EXTRAS && EXTRAS.integritySheet) ? ` Full list on the "${EXTRAS.integritySheet}" tab.` : '';
      return `${issues.length} integrity issue${issues.length === 1 ? '' : 's'} found — first: ${issues[0]}.${where}`;
    }
    case 'syncSignups': {
      if (!CONFIG.sheets.signupForm) return 'Signup sync is off — no signup form response tab is set in the config.';
      const ss = SpreadsheetApp.getActive();
      if (!ss.getSheetByName(CONFIG.sheets.signupForm)) throw new Error(`The form response tab "${CONFIG.sheets.signupForm}" was not found.`);
      const review = ss.getSheetByName(CONFIG.sheets.signups);
      if (!review) throw new Error(`The review tab "${CONFIG.sheets.signups}" was not found.`);
      const added = syncSignupForm();
      // Re-group/compact the review tab even when nothing new arrived — it clears leftover blank scaffolding rows.
      let cleaned = 0;
      try { cleaned = sortSignups_(review); } catch (e) { log_('cpRunAction.syncSignups.sort', e); }
      return added ? `Added ${added} new signup${added === 1 ? '' : 's'} to "${CONFIG.sheets.signups}" (Pending).`
        : (cleaned ? `No new signups — tidied ${cleaned} row(s) on the review tab.` : 'No new signups to sync.');
    }
    case 'syncPatrol': {
      const r = syncPatrolFormNow_();
      if (r.off) return 'Patrol sync is off — no patrol form response tab is set in the config.';
      if (r.missing) throw new Error(`The form response tab "${CONFIG.sheets.patrol}" was not found.`);
      if (r.locked) return 'Sync skipped — another roster operation is running.';
      if (r.mode === 'credit') {
        const res = r.res;
        if (res === false) return 'Sync skipped — another roster operation is running.';
        if (!res || res.off || res.missing) return 'Nothing to sync — the patrol form or roster tab is missing.';
        const why = r.logless ? ' (no patrol log tab, so hours were credited straight from the form)'
          : ' (DURATION mode carries no start/end times to place on the log)';
        return `Credited ${res.hoursAdded} hour(s) to ${res.credited.length} member(s) from ${res.scanned} submission(s)`
          + (res.errored ? `, ${res.errored} errored` : '') + why + '.';
      }
      const res = r.res || { added: 0, skipped: [] };
      const skipped = (res.skipped || []).length;
      return `Placed ${res.added} patrol${res.added === 1 ? '' : 's'} on the log`
        + (skipped ? `, ${skipped} skipped` : '') + '.';
    }
    case 'buildGroups': {
      if (typeof buildGroupSheets_ !== 'function') throw new Error('Group sheets need RosterExtras.gs, which is not installed.');
      return cpBuildReport_(buildGroupSheets_(), 'group');
    }
    case 'buildAcademy': {
      if (typeof buildAcademySheets_ !== 'function') throw new Error('The police academy needs RosterExtras.gs, which is not installed.');
      return cpBuildReport_(buildAcademySheets_(), 'academy');
    }
    case 'buildActivity': {
      if (typeof buildActivityPanel_ !== 'function') throw new Error('The activity panel needs RosterExtras.gs, which is not installed.');
      const r = buildActivityPanel_();
      if (!r) return 'The activity panel is off — it needs [SHEETS].ACTIVITY and a patrol form to read.';
      return `"${r.name}" rebuilt — ${r.rows} patrol${r.rows === 1 ? '' : 's'} listed.`;
    }
    case 'publishRoster': {
      const res = publishPublicRoster();
      if (res === false) return 'Publish skipped — another roster operation is running.';
      if (!res || !res.linked) return 'No public roster is linked yet — set one up before publishing.';
      return `Published ${res.rows} row(s) across ${res.tabs.length} tab(s).`;
    }
    default:
      throw new Error(`Unknown action: ${name}`);
  }
}

/** Both sheet builders return {built, sheets[], skipped[{name, why}]} — one sentence covering either. */
function cpBuildReport_(res, kind) {
  const parts = [];
  if (res.built) parts.push(`Filled ${res.built} ${kind} tab${res.built === 1 ? '' : 's'}: ${res.sheets.join(', ')}`);
  const skipped = res.skipped || [];
  if (skipped.length) parts.push(`skipped ${skipped.length} (${skipped.map((x) => `${x.name} — ${x.why}`).join('; ')})`);
  if (!parts.length) return `No ${kind} tabs found to fill.`;
  return parts.join(', ') + '.';
}

/** Read-only duplicate / malformed Discord ID report (string, for the panel). */
function cpDuplicateReport_() {
  const roster = cpRoster_();
  const last = roster.getLastRow();
  if (last < CONFIG.rosterStartRow) return 'Roster is empty.';
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
  if (!dup.length && !malformed.length) return 'No duplicate or malformed Unique IDs found.';
  const parts = [];
  if (dup.length) parts.push(`Duplicates (${dup.length}): ${dup.join(' | ')}`);
  if (malformed.length) parts.push(`Not ${idDigitsLabel_()} digits (${malformed.length}): ${malformed.join(' | ')}`);
  return parts.join('  ·  ');
}

/* ----------------------------------------------------------------------------
 * COLUMNS — view + classify roster columns (MEMBER follows the person / SLOT stays with the position)
 * ------------------------------------------------------------------------- */

/** Injectable core: per-column info for the panel. @return {Array<{col,letter,header,klass,sample,filled,total}>} */
function cpColumnsInfo_(roster, overrides) {
  const RC = rosterCols_(roster);
  const reg = columnRegistry_(roster, overrides);
  const n = Math.max(0, roster.getLastRow() - CONFIG.rosterStartRow + 1);
  const block = n ? roster.getRange(CONFIG.rosterStartRow, 1, n, roster.getLastColumn()).getDisplayValues() : [];
  const validRows = [];
  for (let i = 0; i < n; i++) { if (isValidMemberValues_(block[i][RC.rank - 1], block[i][RC.name - 1])) validRows.push(i); }
  const total = validRows.length;
  const letterOf = (c) => (typeof cpColLetter_ === 'function') ? cpColLetter_(c) : String(c);
  return reg.map((c) => {
    let sample = '';
    let filled = 0;
    validRows.forEach((i) => {
      const val = String(block[i][c.col - 1]).trim();
      if (val !== '') { filled++; if (sample === '') sample = val; }
    });
    return { col: c.col, letter: letterOf(c.col), header: c.header, klass: c.klass, sample: clamp_(sample, 48), filled, total };
  });
}

/** Panel read: every roster column with its class, a sample value, fill counts, and any header issues. */
function cpColumnsInfo() {
  const roster = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster);
  if (!roster) return { columns: [], total: 0, issues: [`Roster tab "${CONFIG.sheets.roster}" not found.`], configSheet: CONFIG_SHEET_NAME };
  const columns = cpColumnsInfo_(roster);
  const issues = (typeof cpRosterHeaderIssues_ === 'function') ? cpRosterHeaderIssues_(roster) : [];
  return { columns, total: columns.length ? columns[0].total : 0, issues, configSheet: CONFIG_SHEET_NAME };
}

/**
 * Injectable core: set/insert a header's class row in the [COLUMNS] block of the given ⚙️ Config sheet
 * (testable — Phase 1 fold: delegates to setColumnClassRow_ in RosterConfig.gs). @return {string} class.
 */
function cpSetColumnClass_(configSheet, header, klass) {
  return setColumnClassRow_(configSheet, header, klass);
}

/** Panel write: classify a column SLOT/MEMBER in the [COLUMNS] block on ⚙️ Config, then return the refreshed list. */
function cpSetColumnClass(header, klass) {
  const ss = SpreadsheetApp.getActive();
  let sh = findConfigSheet_(ss);
  if (!sh) { seedConfigTab_(ss); sh = findConfigSheet_(ss); }
  if (!sh) throw new Error(`Could not access "${CONFIG_SHEET_NAME}".`);
  const k = cpSetColumnClass_(sh, header, klass);
  cfgInvalidate_();
  SpreadsheetApp.flush();
  cpAudit_('action', '', `Column "${String(header).trim()}" → ${k}`, '', String(header).trim());
  return cpColumnsInfo();
}

/* ----------------------------------------------------------------------------
 * PROTECTED FILE — there is no separate admin spreadsheet any more: THIS workbook
 * is the protected one, and the member-facing roster is a one-way published copy
 * (🌐 Set Up Public Roster). The private tabs — Webhooks, the signup review — live
 * right here, and Google's file-level ACL on this file is the gate: a panel dialog
 * executes AS the person who opened it, so someone without access to this workbook
 * cannot reach them, whatever the panel does or doesn't render.
 * ------------------------------------------------------------------------- */

/** The linked admin spreadsheet, opened AS THE CURRENT USER — throws Google's permission error for non-admins (that's the gate). @return {Spreadsheet|null} null when no file is linked. */
function adminFile_() {
  // THIS workbook is the protected file: the public roster is a separate, one-way published copy, so members never
  // open this one. Private tabs (Webhooks, Disciplinary Log, Roster Signups) live right here — nothing to link.
  return SpreadsheetApp.getActive();
}

/** Cheap bootstrap probe: is an admin file linked, and can THIS user open it? Never throws. */
function cpAdminStatus_() {
  // Always available: the private tabs live in THIS workbook, and anyone who can open the Control Panel can open it.
  let url = '';
  try { url = SpreadsheetApp.getActive().getUrl(); } catch (e) { /* cosmetic */ }
  return { linked: true, access: true, url: url }; // linkedBy/linkedAt/selfHosted described the old separate-file era and had no reader
}

/* -------------------------------------------------------------------------
 * INTERNAL ROSTER — a flat, UNIQUE-ID-KEYED mirror of the public roster living
 * in the ACL-protected admin file, plus private PII columns the public roster
 * must never carry (DOB, email, discipline summary, …).
 *
 * WHY ID-KEYED: nothing is matched by row position, so promoting, re-sorting or
 * moving someone on the public roster can never orphan their PII — their record
 * is found by Unique ID and follows them.
 *
 * PII lives directly on this workbook's roster — no mirroring, no merge, nothing to reconcile.
 * Columns the engine does not recognize are private and never touched.
 * ------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
 * ROSTER SIGNUPS — a Google Form whose responses land INSIDE the protected
 * admin file (they carry email/DOB, so they must never touch the public
 * workbook). The engine appends a STATUS column to that response tab:
 *   Pending (new / blank) → Approved (an admin's decision) → Processed (added)
 * Approving is a real action, not just a label: it assigns the member to an
 * open roster slot, writes their private details onto the Internal Roster, and
 * only then stamps the row Processed. Rows sort Pending → Approved → Processed.
 * ------------------------------------------------------------------------- */

// Pending → Approved → Processed is the happy path. FLAGGED is "held for review" — the same meaning the leave
// tracker's FLAGGED_STATUS carries — so it is NOT terminal: a flagged signup stays in the queue, it just says
// out loud that somebody parked it. Only Processed leaves the queue.
const SIGNUP_STATUSES_ = Object.freeze(['Pending', 'Approved', 'Processed', 'Flagged']);
const SIGNUP_FLAGGED_ = 'Flagged';
/** True for a signup that no longer needs an admin's attention. Flagged still does — that is the point of it. */
function signupIsDone_(status) { return norm_(status) === norm_(SIGNUP_STATUSES_[2]); }

/**
 * Header-resolve a signup tab (exact header wins, so a free-text application column can't hijack a role). Works on BOTH
 * shapes: a plain Google-Form responses tab (header on row 1, data row 2) AND a themed REVIEW tab laid out like the
 * roster (banner up top, header lower, data below a divider gap). The header row is auto-detected, so `headerRow` /
 * `dataStart` tell callers where the real data begins.
 */
function signupCols_(sheet) {
  const out = { timestamp: 0, name: 0, ooc: 0, discord: 0, email: 0, dob: 0, phone: 0, join: 0, status: 0, notes: 0, width: 0, headerRow: 1, dataStart: 2 };
  try {
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const lastRow = Math.max(sheet.getLastRow(), 1);
    const readRow = (r) => sheet.getRange(r, 1, 1, lastCol).getDisplayValues()[0].map((h) => norm_(h));
    // A header row carries a NAME column AND a STATUS or UNIQUE-ID column. Scan the top rows so a banner above it is skipped.
    const looksHdr = (row) => !!row && row.some((h) => h.indexOf('NAME') !== -1) && row.some((h) => h.indexOf('STATUS') !== -1 || h.indexOf('UNIQUE') !== -1);
    let hRow = 0, hdr = null;
    for (let r = 1; r <= Math.min(15, lastRow); r++) { const row = readRow(r); if (looksHdr(row)) { hRow = r; hdr = row; break; } }
    if (!hRow) { hRow = 1; hdr = readRow(1); } // nothing matched → treat row 1 as the header (plain Forms tab)
    const exact = (l) => { const k = norm_(l); for (let c = 0; c < hdr.length; c++) { if (hdr[c] === k) return c + 1; } return 0; };
    const all = (...toks) => { for (let c = 0; c < hdr.length; c++) { if (toks.every((t) => hdr[c].indexOf(norm_(t)) !== -1)) return c + 1; } return 0; };
    out.timestamp = exact('TIMESTAMP') || all('TIMESTAMP') || (hRow === 1 ? 1 : 0);
    out.ooc = exact('OOC NAME') || all('OOC');
    out.name = exact('NAME') || exact('NAME (IN-CHARACTER)') || 0;
    if (!out.name) { for (let c = 0; c < hdr.length; c++) { if (hdr[c].indexOf('NAME') !== -1 && (c + 1) !== out.ooc) { out.name = c + 1; break; } } }
    out.discord = exact('UNIQUE ID') || all('UNIQUE', 'ID') || all('DISCORD') || all('COMMUNITY', 'ID') || all('CID');
    out.email = exact('EMAIL') || all('EMAIL');
    out.dob = exact('DATE OF BIRTH') || all('BIRTH') || all('DOB');
    out.phone = exact('PHONE') || all('PHONE');
    out.join = exact('DEPARTMENT JOIN DATE') || all('JOIN', 'DATE'); // needs BOTH tokens so a "Why do you want to join?" question can't hijack it
    out.status = exact('STATUS') || all('STATUS');
    out.notes = exact('NOTES') || all('NOTES');
    out.width = lastCol;
    out.headerRow = hRow;
    // Data begins below the header. A plain Forms tab (header row 1) → row 2; a themed tab → skip the same header-to-data
    // gap the roster leaves (e.g. header row 6 → data row 8), mirroring the roster's layout convention.
    out.dataStart = (hRow === 1) ? 2 : hRow + Math.max(1, CONFIG.rosterStartRow - (CONFIG.headerRow || 6));
  } catch (e) { log_('signupCols_', e); }
  return out;
}

/** First data row with no applicant IDENTITY (NAME + UNIQUE ID both empty), or the row past the end. NB: a stray STATUS
 *  value (a leftover dropdown pick / template) does NOT count as occupied — only real name/ID data does. */
function signupFirstFreeRow_(sheet, SC) {
  const last = sheet.getLastRow();
  if (last < SC.dataStart) return SC.dataStart;
  const n = last - SC.dataStart + 1;
  const block = sheet.getRange(SC.dataStart, 1, n, SC.width).getDisplayValues();
  for (let i = 0; i < n; i++) {
    const row = block[i];
    const has = (SC.name && String(row[SC.name - 1] || '').trim()) || (SC.discord && String(row[SC.discord - 1] || '').trim());
    if (!has) return SC.dataStart + i;
  }
  return last + 1;
}

/**
 * Sync new signup-form submissions into the SIGNUPS review tab, matched by ROLE (name/ooc/id/email/dob/phone). Mirrors
 * syncFormToTracker_: a synced form row is marked "done" (background) so re-scans never double-add. STATUS is stamped
 * Pending; NOTES and any admin-only columns are left untouched. Never throws. @return rows added.
 */
function syncSignupForm_(formSheet, signupSheet) {
  let added = 0;
  const newcomers = []; // {name, id} per NEW signup this pass — feeds the opt-in Discord embed below
  try {
    const formLast = formSheet.getLastRow();
    if (formLast < 2) return 0;
    const fSC = signupCols_(formSheet), sSC = signupCols_(signupSheet);
    if (!sSC.status || !sSC.discord) return 0;               // the review tab needs at least STATUS + UNIQUE ID columns
    const width = formSheet.getLastColumn();
    const range = formSheet.getRange(2, 1, formLast - 1, width);
    const values = range.getValues();
    const backgrounds = range.getBackgrounds();
    const doneBg = String(CONFIG.bg.done).toLowerCase();
    const roles = ['timestamp', 'name', 'ooc', 'discord', 'email', 'dob', 'phone', 'join']; // timestamp: the review tab's sort keys "newest first" off it (copied only when the tab HAS a TIMESTAMP column)
    // Free rows are computed ONCE. Calling signupFirstFreeRow_ inside the loop re-read the whole review tab per
    // added submission (O(n²) on a backfill). Same rule it applies: identity-free rows first, then append past the end.
    const freeRows = [];
    let nextAppend = Math.max(signupSheet.getLastRow() + 1, sSC.dataStart);
    if (signupSheet.getLastRow() >= sSC.dataStart) {
      const blk = signupSheet.getRange(sSC.dataStart, 1, signupSheet.getLastRow() - sSC.dataStart + 1, sSC.width).getDisplayValues();
      for (let r = 0; r < blk.length; r++) {
        const occupied = (sSC.name && String(blk[r][sSC.name - 1] || '').trim()) || (sSC.discord && String(blk[r][sSC.discord - 1] || '').trim());
        if (!occupied) freeRows.push(sSC.dataStart + r);
      }
    }
    for (let i = 0; i < values.length; i++) {
      const frow = values[i];
      // Skip rows with no applicant identity — an empty row read past the real submissions (formatting/validation can
      // push getLastRow down) must NEVER become a blank Pending row on the review tab.
      const fid = fSC.discord ? String(frow[fSC.discord - 1] || '').trim() : '';
      const fname = fSC.name ? String(frow[fSC.name - 1] || '').trim() : '';
      if (!fid && !fname) continue;
      const bg = String(backgrounds[i][0] || '').toLowerCase();
      if (bg === doneBg || bg === '#00ff00') continue;       // already synced
      const rowVals = new Array(sSC.width).fill('');
      roles.forEach((role) => { if (fSC[role] && sSC[role]) rowVals[sSC[role] - 1] = frow[fSC[role] - 1]; });
      rowVals[sSC.status - 1] = SIGNUP_STATUSES_[0];         // new submission → Pending
      const at = freeRows.length ? freeRows.shift() : nextAppend++;
      if (typeof ensureRoomAboveCap_ === 'function') ensureRoomAboveCap_(signupSheet, at); // grow inside the band, never onto the closing bar
      else if (at > signupSheet.getMaxRows()) signupSheet.insertRowsAfter(signupSheet.getMaxRows(), at - signupSheet.getMaxRows());
      writeValuesSafe_(signupSheet, at, 1, [rowVals], null); // merge-safe row write
      signupSheet.getRange(at, sSC.discord).setNumberFormat('@'); // keep the Unique ID exact
      formSheet.getRange(i + 2, 1, 1, width).setBackground(CONFIG.bg.done); // mark this form row synced
      newcomers.push({ name: fname, id: fid });
      added++;
    }
    if (added) { try { sortSignups_(signupSheet); } catch (e) { log_('syncSignupForm_.sort', e); } }
    // Opt-in Discord embed per NEW signup ([NOTIFICATIONS].SIGNUP_SUBMITTED) — after all writes, so a webhook hiccup
    // can never block the sync. Name + Unique ID only: an applicant's DOB/email/phone NEVER reach Discord. Posts to
    // the SIGNUP channel when its webhook is set; falls back to AUDIT so pre-SIGNUP-channel setups keep working.
    if (newcomers.length && CONFIG.notify && CONFIG.notify.signupSubmitted && typeof notifyEvent_ === 'function') {
      const signupCh = (typeof webhookFor_ === 'function' && webhookFor_('SIGNUP')) ? 'SIGNUP' : 'AUDIT';
      newcomers.forEach((s) => {
        try {
          notifyEvent_(signupCh, true, 'signupSubmitted', { name: s.name, id: s.id }, {
            description: clamp_(`# ${fill_(CONFIG.notify.signupSubmittedTitle, { name: s.name, id: s.id })}\nA new signup is awaiting review — seat or deny it under Control Panel ▸ Signups.`, 4000),
            color: hexToInt_(CONFIG.notify.signupSubmittedColor, 14721324),
            fields: [
              { name: '`👮` Name', value: clamp_(dash_(s.name), 1000), inline: true },
              { name: '`🆔` Unique ID', value: clamp_(dash_(s.id), 1000), inline: true },
            ],
          }, '');
          Utilities.sleep(200); // stay under Discord's webhook rate limit on a backfill batch
        } catch (e) { log_('syncSignupForm_.notify', e); }
      });
    }
  } catch (e) { log_('syncSignupForm_', e); }
  return added;
}

/** Entry point: sync the linked signup form into the review tab. No-op when the feature is off (no form tab set). */
function syncSignupForm() {
  try {
    if (!CONFIG.sheets.signupForm) return 0;
    const ss = SpreadsheetApp.getActive();
    const form = ss.getSheetByName(CONFIG.sheets.signupForm);
    const review = ss.getSheetByName(CONFIG.sheets.signups);
    if (!form || !review) return 0;
    return syncSignupForm_(form, review);
  } catch (e) { log_('syncSignupForm', e); return 0; }
}

/** Menu action: manually pull the signup form into the review tab (backfill / on-demand; the same sync runs on submit). */
function manualSyncSignups() {
  runAction_('Sync Signup Form', () => {
    const ui = SpreadsheetApp.getUi();
    if (!CONFIG.sheets.signupForm) {
      ui.alert('🧾 Sync Signup Form', 'Signup sync is OFF.\n\nSet [SHEETS].SIGNUP_FORM_RESPONSES to your signup form\'s response tab (⚙️ Engine Settings ▸ Sheets & layout), then run this again.', ui.ButtonSet.OK);
      return;
    }
    const ss = SpreadsheetApp.getActive();
    if (!ss.getSheetByName(CONFIG.sheets.signupForm)) { ui.alert('🧾 Sync Signup Form', `The form response tab "${CONFIG.sheets.signupForm}" was not found.`, ui.ButtonSet.OK); return; }
    if (!ss.getSheetByName(CONFIG.sheets.signups)) { ui.alert('🧾 Sync Signup Form', `The review tab "${CONFIG.sheets.signups}" was not found.`, ui.ButtonSet.OK); return; }
    const added = syncSignupForm();
    // Always re-group/compact the review tab — tidies away any leftover blank "Pending" scaffolding rows even when
    // there was nothing new to add.
    let cleaned = 0;
    try { const rev = ss.getSheetByName(CONFIG.sheets.signups); if (rev) cleaned = sortSignups_(rev); } catch (e) { log_('manualSyncSignups.sort', e); }
    ui.alert('🧾 Sync Signup Form', added ? `✅ Added ${added} new signup${added === 1 ? '' : 's'} to "${CONFIG.sheets.signups}" (Pending).` : (cleaned ? `No new signups — tidied the review tab (${cleaned} row${cleaned === 1 ? '' : 's'} kept).` : 'No new signups to add — everything on the form is already synced.'), ui.ButtonSet.OK);
  });
}

/** The signup review tab, with the STATUS dropdown + Unique-ID format ensured on its data rows. null when it doesn't exist yet. */
function ensureSignupTab_(file) {
  const sh = file.getSheetByName(CONFIG.sheets.signups);
  if (!sh) return null;
  let SC = signupCols_(sh);
  if (!SC.status && SC.headerRow === 1) { // a plain Forms-shaped tab with no STATUS yet → append STATUS (+ NOTES) on row 1
    const c = sh.getLastColumn() + 1;
    sh.getRange(1, c).setValue('Status');
    sh.getRange(1, c + 1).setValue('Notes');
    sh.getRange(1, c, 1, 2).setFontWeight('bold').setBackground(theme_('BANNER')).setFontColor(theme_('TEXT_STRONG'));
    SC = signupCols_(sh);
  }
  try {
    if (SC.status && sh.getMaxRows() >= SC.dataStart) { // dropdown on the STATUS data rows (themed tab: never touch the banner/header)
      const n = sh.getMaxRows() - SC.dataStart + 1;
      const rg = sh.getRange(SC.dataStart, SC.status, n, 1);
      // PRESERVE an existing dropdown + its chip colours (Apps Script can't read/set them → a rebuild wipes them).
      // Only create one when the STATUS column has none.
      let has = false;
      try { const dv = rg.getCell(1, 1).getDataValidation(); has = !!(dv && dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST); } catch (ig) {}
      if (!has) {
        rg.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(SIGNUP_STATUSES_.slice(), true).setAllowInvalid(true).setHelpText('Pending → Approved → Processed').build());
      }
      if (SC.discord) sh.getRange(SC.dataStart, SC.discord, n, 1).setNumberFormat('@'); // keep the Unique ID exact
    }
  } catch (e) { log_('ensureSignupTab_.validation', e); }
  return sh;
}

/** The signup STATUS grouping order = the tab's OWN dropdown list when one exists (the operator may have customized it,
 *  e.g. Pending → Approve → Flagged → Processed — the sort must mirror THEIR order, same layout-ownership rule as the
 *  chip colours). Fallback: the engine's built-in flow. */
function signupStatusOrder_(sheet, SC) {
  try {
    const dd = (typeof statusDropdownOrder_ === 'function') ? statusDropdownOrder_(sheet, SC.dataStart, SC.status) : null; // shared helper (RosterSystem) — same rule as the tracker + Patrol Log sorts
    if (dd) return dd;
  } catch (e) { /* no/unreadable dropdown → built-in order */ }
  return SIGNUP_STATUSES_.slice();
}

/** Stamp blank statuses as Pending, then re-group by the STATUS dropdown's own order (value rewrite; keeps formatting). */
function sortSignups_(sheet) {
  try {
    const SC = signupCols_(sheet), W = SC.width, ds = SC.dataStart;
    if (!SC.status || !W) return 0;
    const last = sheet.getLastRow();
    if (last < ds) return 0;
    const n = last - ds + 1;
    const vals = sheet.getRange(ds, 1, n, W).getValues();
    const ids = SC.discord ? sheet.getRange(ds, SC.discord, n, 1).getDisplayValues() : null;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const r = vals[i].slice(0, W);
      if (ids) r[SC.discord - 1] = String(ids[i][0]).trim();
      const identity = (SC.name && String(r[SC.name - 1] || '').trim()) || (SC.discord && String(r[SC.discord - 1] || '').trim());
      if (!identity) continue; // no NAME / UNIQUE ID → a blank scaffolding or stray STATUS-only row → drop it (compacted away)
      if (String(r[SC.status - 1] || '').trim() === '') r[SC.status - 1] = SIGNUP_STATUSES_[0]; // new submission → Pending
      rows.push(r);
    }
    if (!rows.length) return 0;
    const flow = signupStatusOrder_(sheet, SC); // the dropdown's order, e.g. Pending → Approve → Flagged → Processed
    const rank = {}; flow.forEach((s, i) => { if (!(norm_(s) in rank)) rank[norm_(s)] = i; });
    // Within a status group: NEWEST submission first. Recency source, in order: (1) the form's own Timestamp, looked
    // up LIVE from the signup form tab by Unique ID — covers every row, including ones synced before recency existed
    // and review tabs with no TIMESTAMP column (no backfill needed); (2) the review tab's own TIMESTAMP column, when
    // it has one; (3) 0 — hand-added applicants keep their prior order.
    let formTs = null; // Unique ID -> submission ms (a re-submission keeps the LATEST)
    try {
      const fsh = CONFIG.sheets.signupForm ? SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.signupForm) : null;
      if (fsh && fsh.getLastRow() >= 2) {
        const FSC = signupCols_(fsh);
        if (FSC.discord && FSC.timestamp) {
          const nF = fsh.getLastRow() - 1;
          const fids = fsh.getRange(2, FSC.discord, nF, 1).getDisplayValues();
          const ftss = fsh.getRange(2, FSC.timestamp, nF, 1).getValues();
          formTs = {};
          for (let k = 0; k < nF; k++) {
            const fid = String(fids[k][0] || '').trim();
            const tv = ftss[k][0];
            if (fid && tv instanceof Date && !isNaN(tv.getTime()) && (!(fid in formTs) || tv.getTime() > formTs[fid])) formTs[fid] = tv.getTime();
          }
        }
      }
    } catch (e) { formTs = null; /* form unreadable → the column/stable fallbacks below */ }
    const rec = (r) => {
      const idv = SC.discord ? String(r[SC.discord - 1] || '').trim() : '';
      if (formTs && idv && formTs[idv]) return formTs[idv];
      const v = SC.timestamp ? r[SC.timestamp - 1] : '';
      return (v instanceof Date && !isNaN(v.getTime())) ? v.getTime() : 0;
    };
    const dec = rows.map((r, i) => ({ r: r, i: i, p: (norm_(String(r[SC.status - 1] || '').trim()) in rank) ? rank[norm_(String(r[SC.status - 1]).trim())] : flow.length, t: rec(r) }));
    dec.sort((a, b) => (a.p - b.p) || (b.t - a.t) || (a.i - b.i)); // stable
    const sorted = dec.map((d) => d.r);
    if (SC.discord) sheet.getRange(ds, SC.discord, sorted.length, 1).setNumberFormat('@');
    writeValuesSafe_(sheet, ds, 1, sorted, null); // merge-safe (see sortTracker_)
    if (last > ds + sorted.length - 1) { // survivors slid up → blank the rows they vacated so nothing is duplicated at the bottom
      const blanks = []; for (let k = ds + sorted.length; k <= last; k++) blanks.push(new Array(W).fill(''));
      writeValuesSafe_(sheet, ds + sorted.length, 1, blanks, null);
    }
    if (typeof tidyTailRows_ === 'function') tidyTailRows_(sheet, ds, SC.status); // auto-rows: re-pad the blank tail / trim surplus blanks
    return sorted.length;
  } catch (e) { logWarn_('sortSignups_', 'signup sort failed: ' + ((e && e.message) ? e.message : e)); return 0; }
}

/**
 * Read the signup tab in ONE pass and split it: `queue` = rows an admin still has to act on (Pending, Approved
 * and Flagged, newest first), `recent` = the most recently RESOLVED ones (Processed) so the panel can show what
 * was just decided without a second read.
 * @return {{queue:Array<Object>, recent:Array<Object>}}
 */
function signupSplit_(sheet, cap, recentCap) {
  const queue = [], recent = [];
  let waiting = 0; // every row still needing action, including any past the cap — so the panel can say "N of M"
  const SC = signupCols_(sheet);
  const last = sheet.getLastRow();
  if (!SC.status || last < SC.dataStart) return { queue, recent };
  const n = last - SC.dataStart + 1;
  const vals = sheet.getRange(SC.dataStart, 1, n, SC.width).getDisplayValues();
  for (let i = 0; i < n; i++) {
    const g = (c) => c ? String(vals[i][c - 1] || '').trim() : '';
    if (!g(SC.name) && !g(SC.discord)) continue; // blank scaffolding row on a themed tab → not a submission
    const st = g(SC.status) || SIGNUP_STATUSES_[0];
    const rec = { row: SC.dataStart + i, status: st, name: g(SC.name), ooc: g(SC.ooc), discord: g(SC.discord),
      email: g(SC.email), dob: g(SC.dob), phone: g(SC.phone), join: g(SC.join), submitted: g(SC.timestamp) };
    if (signupIsDone_(st)) { if (recent.length < (recentCap || 12)) recent.push(rec); continue; }
    waiting++;
    if (queue.length < (cap || 100)) queue.push(rec);
  }
  return { queue, recent, waiting };
}

/** Resolve the roster's PRIVATE columns (only present on an internal roster). 0 = absent → that detail simply isn't stored. */
function rosterPiiCols_(roster) {
  const out = { email: 0, dob: 0, phone: 0 };
  try {
    const RC = rosterCols_(roster);
    const hr = RC.headerRow || CONFIG.headerRow;
    const hdr = roster.getRange(hr, 1, 1, Math.max(roster.getLastColumn(), 1)).getDisplayValues()[0].map((h) => norm_(h));
    const exact = (l) => { const k = norm_(l); for (let c = 0; c < hdr.length; c++) { if (hdr[c] === k) return c + 1; } return 0; };
    const all = (t) => { for (let c = 0; c < hdr.length; c++) { if (hdr[c].indexOf(norm_(t)) !== -1) return c + 1; } return 0; };
    out.email = exact('EMAIL') || all('EMAIL');
    out.dob = exact('DATE OF BIRTH') || all('BIRTH') || all('DOB');
    out.phone = exact('PHONE') || all('PHONE');
  } catch (e) { log_('rosterPiiCols_', e); }
  return out;
}

/**
 * Injectable core: approve ONE signup — assign the member to an open roster slot, write their private details onto that
 * same roster row, then stamp the signup Processed. Throws with a clear message on any bad input, and only stamps
 * Processed after the roster write succeeds, so a failure leaves the signup actionable. Testable.
 */
function approveSignup_(signups, row, roster, slotRow, edits) {
  const SC = signupCols_(signups);
  const ed = edits || {};   // panel overrides — what the reviewer actually typed wins over the raw form answer
  if (!SC.discord || !SC.name) throw new Error('The signup tab has no Unique ID / Name column.');
  const g = (c) => c ? String(signups.getRange(row, c).getDisplayValue()).trim() : '';
  const id = g(SC.discord);
  const name = String(ed.name != null && String(ed.name).trim() !== '' ? ed.name : g(SC.name)).trim();
  if (!isValidId_(id)) throw new Error(`Signup row ${row} has no valid Unique ID (${idDigitsLabel_()} digits).`);
  if (!name) throw new Error(`Signup row ${row} has no name.`);
  if (cpFindRowById_(roster, id) !== -1) throw new Error(`${name} is already on the roster — mark this signup Processed instead.`);

  cpAssignMember_(roster, { row: slotRow, name: name, discord: id, status: String(ed.status || '').trim(), shift: String(ed.shift || '').trim() }); // reuses the panel's slot guard + validation (and its status whitelist)
  const RC = rosterCols_(roster);
  const oocV = String(ed.ooc != null ? ed.ooc : g(SC.ooc)).trim();
  if (RC.ooc && oocV) roster.getRange(slotRow, RC.ooc).setValue(oocV);
  if (RC.join && SC.join) { const jr = signups.getRange(row, SC.join).getValue(); if (jr !== '' && jr != null) roster.getRange(slotRow, RC.join).setValue(jr); } // department join date carries onto the roster

  // Private details go straight onto the member's own roster row — this workbook IS the internal roster.
  let piiWritten = 0;
  try {
    const P = rosterPiiCols_(roster);
    const put = (c, v) => { if (c && v) { roster.getRange(slotRow, c).setNumberFormat('@').setValue(v); piiWritten++; } };
    put(P.email, g(SC.email)); put(P.dob, g(SC.dob)); put(P.phone, g(SC.phone));
  } catch (e) { log_('approveSignup_.pii', e); } // the roster write already succeeded — never fail an approval over the PII copy
  signups.getRange(row, SC.status).setValue(SIGNUP_STATUSES_[2]); // Processed — LAST, so a failure above leaves it actionable
  return { ok: true, name: name, discord: id, slotRow: slotRow, piiWritten: piiWritten };
}

/** Open member slots on the roster (a member-rank row with no NAME yet), in sheet order. */
function rosterOpenSlots_(roster) {
  const out = [];
  try {
    const RC = rosterCols_(roster), start = CONFIG.rosterStartRow, last = roster.getLastRow();
    if (last < start) return out;
    const n = last - start + 1;
    const ranks = roster.getRange(start, RC.rank, n, 1).getDisplayValues();
    const names = roster.getRange(start, RC.name, n, 1).getDisplayValues();
    const units = RC.unit ? roster.getRange(start, RC.unit, n, 1).getDisplayValues() : null;
    for (let i = 0; i < n; i++) {
      const rank = String(ranks[i][0]).trim();
      if (!isMemberSlot_(rank) || rank === '' || rank === 'Rank') continue;
      if (String(names[i][0]).trim() !== '') continue; // filled → not open
      out.push({ row: start + i, rank: rank, unit: units ? String(units[i][0]).trim() : '' });
    }
  } catch (e) { log_('rosterOpenSlots_', e); }
  return out;
}

/**
 * Sheet-driven approval: setting a signup row's STATUS to Approved pops a slot picker, places the applicant on the
 * roster, copies their private details, and stamps the signup Processed. Cancelling or any failure resets STATUS to
 * Pending so it can be retried. Runs from the SIMPLE onEdit (AuthMode.LIMITED) — every write is in THIS workbook, so
 * it's allowed; a rich picker isn't (no HTML dialog from a simple trigger), hence the prompt.
 */
function approveSignupFromSheet_(signups, row, col, newVal, oldVal) {
  const SC = signupCols_(signups);
  if (!SC.status || col !== SC.status || row < SC.dataStart) return;
  if (!/^APPROV/.test(norm_(String(newVal || '')))) return;   // only a change TO Approve/Approved triggers
  if (/^APPROV/.test(norm_(String(oldVal || '')))) return;    // already approved → don't re-fire
  const ui = SpreadsheetApp.getUi();
  let idSeen = ''; // set once the row is read — lets the reset follow the applicant if the tab re-sorted meanwhile
  const toPending = () => {
    try {
      let rr = row; try { rr = signupResolveRow_(signups, row, idSeen); } catch (e2) { rr = row; }
      signups.getRange(rr, SC.status).setValue(SIGNUP_STATUSES_[0]);
    } catch (ig) {}
  };
  try {
    const g = (c) => c ? String(signups.getRange(row, c).getDisplayValue()).trim() : '';
    const name = g(SC.name), id = g(SC.discord);
    idSeen = id;
    if (!name && !id) { toPending(); return; } // blank/scaffolding row
    const roster = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster);
    if (!roster) { ui.alert('🧾 Approve Signup', `Roster tab "${CONFIG.sheets.roster}" not found.`, ui.ButtonSet.OK); toPending(); return; }
    if (id && cpFindRowById_(roster, id) !== -1) { ui.alert('🧾 Approve Signup', `${name || id} is already on the roster — nothing to place.`, ui.ButtonSet.OK); toPending(); return; }
    const slots = rosterOpenSlots_(roster);
    if (!slots.length) { ui.alert('🧾 Approve Signup', 'No open roster slots to place them in. Free up a slot, then set STATUS to Approved again.', ui.ButtonSet.OK); toPending(); return; }
    const listed = slots.slice(0, 30);
    const lines = listed.map((s, i) => `${i + 1}.  ${s.unit ? s.unit + ' — ' : ''}${s.rank}`).join('\n');
    const res = ui.prompt(`🧾 Approve ${name || id}`,
      `Place them in which OPEN slot? Enter the number, a callsign, or a rank:\n\n${lines}${slots.length > listed.length ? `\n…and ${slots.length - listed.length} more (type its callsign)` : ''}`,
      ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) { toPending(); return; }
    const answer = String(res.getResponseText() || '').trim();
    let slot = null;
    const num = parseInt(answer, 10);
    if (String(num) === answer && num >= 1 && num <= listed.length) slot = listed[num - 1];        // list number
    if (!slot) slot = slots.find((s) => s.unit && norm_(s.unit) === norm_(answer));                // exact callsign
    if (!slot) slot = slots.find((s) => norm_(s.rank) === norm_(answer));                          // exact rank
    if (!slot && norm_(answer)) slot = slots.find((s) => norm_(s.rank).indexOf(norm_(answer)) !== -1); // rank contains
    if (!slot) { ui.alert('🧾 Approve Signup', `Couldn't match "${answer}" to an open slot — nothing changed.`, ui.ButtonSet.OK); toPending(); return; }
    const rowNow = signupResolveRow_(signups, row, id); // the prompt can sit open for minutes while a form sync re-sorts the tab
    const result = approveSignup_(signups, rowNow, roster, slot.row); // assigns + copies PII + stamps Processed
    try { if (typeof publishMarkDirty_ === 'function') publishMarkDirty_(); } catch (ig) {}
    // Seating a new member changes who sits in each assignment/group band (and the Academy for a cadet rank), and bumps
    // the welcome-page counts (TOTAL MEMBERS, per-rank totals). Queue all three AND run them now, so the derived tabs +
    // dashboard reflect the new member immediately — the queue is the backstop if this is cut short by the simple-
    // trigger budget (the sweep finishes it). Same pattern as a member move.
    try { if (typeof deferWork_ === 'function') { deferWork_('academy'); deferWork_('groups'); deferWork_('dashboard'); } } catch (ig) {}
    try { if (typeof runDeferredWork_ === 'function') runDeferredWork_(); } catch (ig) {}
    ui.alert('✅ Signup Approved', `${result.name} placed at ${slot.rank}${slot.unit ? ' (' + slot.unit + ')' : ''}.\nPrivate details copied to the roster. Signup marked Processed.`, ui.ButtonSet.OK);
  } catch (e) {
    log_('approveSignupFromSheet_', e);
    try { ui.alert('🧾 Approve Signup', 'Could not approve: ' + ((e && e.message) || e) + '\n\nSTATUS reset to Pending — fix the issue and try again.', ui.ButtonSet.OK); } catch (ig) {}
    toPending();
  }
}

/* -------------------------------------------------------------------------
 * PUBLIC ROSTER — a ONE-WAY export of this (internal) workbook into a separate
 * spreadsheet that members can read. Nothing ever flows back, so there is no
 * merge, no conflict and no way for a public edit to reach real data.
 *
 * ALLOW-LIST, NOT DENY-LIST: only the columns named below are ever read. Add a
 * private column here (address, medical note, anything) and it simply never
 * appears — a forgotten column fails CLOSED instead of leaking.
 *
 * Publishing writes VALUES ONLY, so any formatting you apply to the public file
 * survives every refresh — the same layout-ownership rule the rest of the engine
 * follows. See [[layout-ownership]].
 * ------------------------------------------------------------------------- */

const PUBLIC_FILE_PROP_ = 'PUBLIC_ROSTER_ID';

/** The linked public spreadsheet, or null when none is set up yet. */
let _publicFileMemo_ = undefined; // per-execution: openById is a round trip and this is hit several times per publish
function publicFile_() {
  if (_publicFileMemo_ !== undefined) return _publicFileMemo_;
  const id = String(PropertiesService.getDocumentProperties().getProperty(PUBLIC_FILE_PROP_) || '').trim();
  _publicFileMemo_ = id ? SpreadsheetApp.openById(id) : null;
  return _publicFileMemo_;
}

/**
 * Tabs that are NEVER mirrored, even if a same-named tab somehow exists in the public file.
 *
 * Two layers, because the keyword list alone FAILED OPEN on a rename: [SHEETS].AUDIT, INTEGRITY, SNAPSHOTS,
 * HOURS_HISTORY and SIGNUPS are all operator-editable, so an Edit Log renamed to "Change History" matched none of
 * these words and stopped being blocked. The configured names are checked first (exact, like dashboardSkip_ does),
 * and the keyword list stays as the catch-all for the shipped defaults and for hand-made lookalikes.
 */
function publishTabBlocked_(name) {
  const n = norm_(name);
  if (!n) return true;
  try {
    const C = cfg_().legacy.sheets;
    if ([C.audit, C.integrity, C.snapshots, C.hoursHistory, C.signups, C.signupForm].some((t) => t && norm_(t) === n)) return true;
  } catch (e) { /* config unreadable → the keyword list below still covers the defaults */ }
  if (norm_(CONFIG_SHEET_NAME) === n || norm_(SYS_LOG_SHEET) === n) return true;
  return ['CONFIG', 'WEBHOOK', 'DISCIPLIN', 'SIGNUP', 'EDIT LOG', 'AUDIT', 'SNAPSHOT', 'HOURS HISTORY',
    'SYS LOG', 'INTEGRITY', 'SYNC STATE'].some((b) => n.indexOf(b) !== -1);
}

/** Header labels whose column is NEVER written to the public copy — and is wiped there if a copy brought it along. */
function publishSensitiveHeader_(h) {
  const n = norm_(h);
  if (!n) return false;
  let list = ['EMAIL', 'DATE OF BIRTH', 'DOB', 'PHONE', 'ADDRESS'];
  try { const c = cfg_().kv.PUBLISH.NEVER_PUBLISH; if (c && c.length) list = c; } catch (e) { /* config absent -> shipped default */ }
  return list.some((raw) => {
    const k = norm_(raw); if (!k) return false;
    return (k === 'CID' || k === 'DOB') ? (n === k) : (n.indexOf(k) !== -1); // short tokens must match exactly
  });
}

/** Best-guess header row: the row in the first 15 with the most filled cells. 0 when the sheet has no header. */
function publishHeaderRow_(sh) {
  const rows = Math.min(15, sh.getLastRow());
  if (rows < 1) return 0;
  const grid = sh.getRange(1, 1, rows, Math.max(sh.getLastColumn(), 1)).getDisplayValues();
  let best = 0, bestN = 1;
  for (let r = 0; r < grid.length; r++) {
    const n = grid[r].filter((v) => String(v).trim() !== '').length;
    if (n > bestN) { bestN = n; best = r + 1; }
  }
  return best;
}

/**
 * Read a range as values but with FORMULAS PRESERVED: a source cell holding a formula yields the formula text, which
 * setValues re-creates as a live formula on the public copy. Without this a "=TEXT(NOW(),...)" clock publishes as the
 * frozen string it happened to evaluate to. Self-referential formulas (the tracker's LENGTH / TIME LEFT) therefore keep
 * recalculating publicly instead of going stale between publishes.
 */
function publishReadCells_(range, valuesOnly, force) {
  const v = range.getValues();
  // valuesOnly: the destination tab has a DIFFERENT column layout (header-matched publish onto a narrower public copy).
  // A copied formula keeps its relative references — e.g. TIME IN RANK's =IF(Q38="",…,TODAY()-INT(Q38)) points at
  // LAST PROMOTION (col Q) on the internal roster, but col Q is a different column on the public sheet (the deleted
  // EMAIL/DOB shift everything left), so the formula computes garbage ("46226 days"). Publish the COMPUTED VALUE
  // instead, which is layout-independent and correct. (Same-width FULL publishes keep formulas — their refs still line
  // up — so dashboards and any live cells survive.)
  if (valuesOnly) return v;
  const f = range.getFormulas();
  for (let r = 0; r < v.length; r++) {
    for (let c = 0; c < v[r].length; c++) {
      const fx = String(f[r][c] == null ? '' : f[r][c]);
      if (fx === '') continue;
      // FORCE-mirror cell whose internal formula references ANOTHER sheet → publish its computed VALUE (the public file
      // can't resolve that ref, so the formula would break). A self-contained formula (e.g. a NOW() clock) still copies
      // as-is below, so it keeps ticking on the public copy.
      if (force && force[r] && force[r][c] && /'[^']+'!|[A-Za-z0-9_]+![A-Z$]/.test(fx)) continue; // keep v[r][c] (the value)
      v[r][c] = fx;
    }
  }
  return v;
}

/**
 * Repair a self-computing tab: earlier publishes wrote literal values into the ranges its array formulas need to SPILL
 * into, which blocks them (#REF!). Clear only that residue — for each formula anchor, the cells to its RIGHT and BELOW
 * within its block (the block ends at the next anchor in the same column). Never touches the anchor itself, anything to
 * its LEFT (the rank-group labels), the header rows above it, or any other formula. @return cells cleared.
 */
function publishFreeSpills_(dest) {
  const rows = dest.getLastRow(), cols = dest.getLastColumn();
  if (rows < 1 || cols < 1) return 0;
  let f;
  try { f = dest.getRange(1, 1, rows, cols).getFormulas(); } catch (e) { return 0; }
  // Only a CROSS-SHEET ARRAY formula is a spill anchor (the same test publishSelfComputing_ uses to flag the tab).
  // Anchoring on EVERY formula made a plain =TODAY() clock claim the rest of its block and wipe the operator's
  // static text beside/below it on every publish.
  const isSpillAnchor = (fx) => (/'[^']+'!|[A-Za-z0-9_]+![A-Z$]/.test(fx)) && /ARRAYFORMULA|ARRAY_CONSTRAIN|FILTER\s*\(|QUERY\s*\(|SORTN?\s*\(|IMPORTRANGE|SEQUENCE\s*\(/i.test(fx);
  const anchors = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (isSpillAnchor(String(f[r][c] == null ? '' : f[r][c]))) anchors.push({ r: r, c: c });
  if (!anchors.length) return 0;

  const drop = []; // 0-based cells that are residue: inside an anchor's block, not a formula themselves
  anchors.forEach((a) => {
    let end = rows - 1; // the block still ends at the next formula of ANY kind in the same column (as before)
    for (let r = a.r + 1; r <= end; r++) { if (String(f[r][a.c] == null ? '' : f[r][a.c]).trim() !== '') { end = r - 1; break; } }
    for (let r = a.r; r <= end; r++) {
      for (let c = a.c; c < cols; c++) {
        if (r === a.r && c === a.c) continue;                                   // the anchor stays
        if (String(f[r][c] == null ? '' : f[r][c]).trim() !== '') continue;      // never clear another formula
        drop.push({ r: r, c: c });
      }
    }
  });
  if (!drop.length) return 0;

  const seen = {}; let cleared = 0;                                             // clear in row runs
  drop.forEach((d) => { (seen[d.r] = seen[d.r] || {})[d.c] = true; });
  Object.keys(seen).forEach((rk) => {
    const r = Number(rk), colsIn = Object.keys(seen[r]).map(Number).sort((x, y) => x - y);
    let i = 0;
    while (i < colsIn.length) {
      let j = i; while (j + 1 < colsIn.length && colsIn[j + 1] === colsIn[j] + 1) j++;
      try { dest.getRange(r + 1, colsIn[i] + 1, 1, colsIn[j] - colsIn[i] + 1).clearContent(); cleared += colsIn[j] - colsIn[i] + 1; } catch (e) { /* skip */ }
      i = j + 1;
    }
  });
  return cleared;
}

/**
 * True when the destination tab COMPUTES ITSELF from other tabs — i.e. it holds a formula referencing another sheet
 * (the shift tabs and Police Academy are FILTER/ARRAY_CONSTRAIN views over 'Member Information').
 *
 * Such tabs must not be published into. Their array formulas SPILL, and writing the source's spilled values into that
 * spill range blocks it, which Sheets reports as #REF!. Left alone they rebuild themselves from the public copy of the
 * tab they reference, which the publish does populate — so they stay correct with no work at all.
 */
function publishSelfComputing_(dest) {
  try {
    const rows = Math.min(dest.getLastRow(), 300), cols = Math.min(dest.getLastColumn(), 60);
    if (rows < 1 || cols < 1) return false;
    const f = dest.getRange(1, 1, rows, cols).getFormulas();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const fx = String(f[r][c] == null ? '' : f[r][c]);
        // Cross-sheet AND spilling. A plain lookup like ='Member Information'!A1 must NOT disable the whole tab;
        // only an array formula whose spill range we would block makes a tab genuinely self-computing.
        if (!fx || !/'[^']+'!|[A-Za-z0-9_]+![A-Z$]/.test(fx)) continue;
        if (/ARRAYFORMULA|ARRAY_CONSTRAIN|FILTER\s*\(|QUERY\s*\(|SORTN?\s*\(|IMPORTRANGE|SEQUENCE\s*\(/i.test(fx)) return true;
      }
    }
  } catch (e) { /* unreadable -> treat as ordinary */ }
  return false;
}

/** Tolerant tab-name key: uppercased + whitespace-collapsed (via norm_), with a LEADING emoji/symbol run stripped so a
 *  keep/force range written for "Welcome Page" ALSO matches a tab named "👋 Welcome Page". The '*' (all-tabs) key passes
 *  through unchanged. Exact after the strip — never a substring — so "Roster" can't match "Roster Signups". */
function tabKey_(name) {
  if (String(name == null ? '' : name).trim() === '*') return '*';
  return norm_(name).replace(/^[^A-Z0-9]+/, '');
}

function publishKeepRanges_() {
  const out = {};
  const add = (spec) => {
    const t = String(spec).trim(); if (!t) return;
    const i = t.lastIndexOf('!'); if (i < 1) return;
    const key = tabKey_(t.slice(0, i).replace(/^'|'$/g, '')), a1 = t.slice(i + 1).trim();
    if (!a1) return;
    const list = (out[key] = out[key] || []);
    if (list.indexOf(a1) === -1) list.push(a1);
  };
  // BUILT-IN: the title blocks that are meant to read differently in the two files. These are applied even when the
  // operator's Config tab already carries a KEEP_RANGES row (a stored row overrides the schema default, so relying on
  // the default alone silently did nothing). Config entries ADD to these rather than replacing them.
  [(CONFIG.sheets.welcome || 'Welcome Page') + '!F6:W7', (CONFIG.sheets.roster || 'Member Information') + '!D3:H3'].forEach(add); // tab names follow the [SHEETS] renames
  try { (cfg_().kv.PUBLISH.KEEP_RANGES || []).forEach(add); } catch (e) { /* config absent -> built-ins only */ }
  return out;
}

/**
 * The INVERSE of publishKeepRanges_: cells the publish must ALWAYS mirror from the internal, even when the public copy
 * holds a formula there (which the formula-keep rule would otherwise preserve). Built-ins cover the Welcome Page header
 * cells that read from the internal; [PUBLISH].FORCE_RANGES adds to them. Same Tab!Range grammar as the keep list.
 */
function publishForceRanges_() {
  const out = {};
  const add = (spec) => {
    const t = String(spec).trim(); if (!t) return;
    const i = t.lastIndexOf('!'); if (i < 1) return;
    const key = tabKey_(t.slice(0, i).replace(/^'|'$/g, '')), a1 = t.slice(i + 1).trim();
    if (!a1) return;
    const list = (out[key] = out[key] || []);
    if (list.indexOf(a1) === -1) list.push(a1);
  };
  const W = CONFIG.sheets.welcome || 'Welcome Page';
  [W + '!F40:H40', W + '!F41:H41', W + '!AE6'].forEach(add); // built-in: mirror these Welcome Page header cells from the internal
  try { (cfg_().kv.PUBLISH.FORCE_RANGES || []).forEach(add); } catch (e) { /* config absent -> built-ins only */ }
  return out;
}

/** Cells to FORCE-mirror from the internal on THIS tab (a boolean grid over the block), or null if none apply here. */
function publishForceMask_(dest, top, left, rows, cols) {
  let any = false;
  const mask = [];
  for (let r = 0; r < rows; r++) mask.push(new Array(cols).fill(false));
  const all = publishForceRanges_();
  (all[tabKey_(dest.getName())] || []).concat(all['*'] || []).forEach((a1) => {
    try {
      const rg = dest.getRange(a1);
      const r0 = rg.getRow() - top, c0 = rg.getColumn() - left;
      for (let r = Math.max(0, r0); r < Math.min(rows, r0 + rg.getNumRows()); r++) {
        for (let c = Math.max(0, c0); c < Math.min(cols, c0 + rg.getNumColumns()); c++) { mask[r][c] = true; any = true; }
      }
    } catch (e) { logWarn_('publishForceMask_', dest.getName() + ': cannot resolve force-range "' + a1 + '"'); }
  });
  return any ? mask : null;
}

/**
 * Cells on the PUBLIC copy that publishing must leave alone:
 *   1. any cell holding a FORMULA — the public sheet's own live date/time/counters must keep recalculating, and
 *      copying the internal sheet's computed value would freeze them as plain text. EXCEPTION (`mirrorWins`): on a
 *      HEADER-MATCHED tab, a mirrored column is the internal's data by definition — a formula found there is residue
 *      from the era when the match-mode publish copied formulas (whose relative refs point at the wrong public column,
 *      the "46227 days" ghosts on empty rows). With mirrorWins the internal value overwrites it, healing the residue
 *      and keeping the column clean; a DELIBERATE public formula there can still be protected via KEEP_RANGES.
 *   2. anything listed in [PUBLISH].KEEP_RANGES for this tab (static text that is meant to differ, e.g. the title).
 */
function publishKeepMask_(dest, top, left, rows, cols, force, mirrorWins) {
  const mask = [];
  for (let r = 0; r < rows; r++) mask.push(new Array(cols).fill(false));
  let img = null; // in-cell IMAGE / smart-chip cells: the API can't setValues over them, so they must always be kept —
                  // these are exactly what produced the "N cell(s) could not be written (in-cell image or chip)" warning
                  // on every publish (the badge/logo + stat-card icons). Kept here, the write skips them silently.
  try {
    const rg0 = dest.getRange(top, left, rows, cols);
    const f = rg0.getFormulas(), vv = rg0.getValues();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!mirrorWins && String(f[r][c] || '').trim() !== '') mask[r][c] = true;                     // a live formula (own clock/counter)
      const x = vv[r][c];
      if (x && typeof x === 'object' && !(x instanceof Date)) { (img = img || []).push(r * cols + c); mask[r][c] = true; } // CellImage/chip object (never a primitive/Date)
    }
  } catch (e) { /* best-effort */ }
  const all = publishKeepRanges_();
  (all[tabKey_(dest.getName())] || []).concat(all['*'] || []).forEach((a1) => {
    try {
      const rg = dest.getRange(a1);
      const r0 = rg.getRow() - top, c0 = rg.getColumn() - left;
      for (let r = Math.max(0, r0); r < Math.min(rows, r0 + rg.getNumRows()); r++) {
        for (let c = Math.max(0, c0); c < Math.min(cols, c0 + rg.getNumColumns()); c++) mask[r][c] = true;
      }
    } catch (e) { logWarn_('publishKeepMask_', dest.getName() + ': cannot resolve keep-range "' + a1 + '"'); }
  });
  // FORCE-mirror WINS over keep: un-keep every force cell so the internal's content is written even over a public
  // formula. (Caller may pass a pre-computed mask; otherwise resolve it here so a per-column match-mode call is covered.)
  const fm = force || publishForceMask_(dest, top, left, rows, cols);
  if (fm) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (fm[r][c]) mask[r][c] = false;
  if (img) img.forEach((k) => { mask[(k / cols) | 0][k % cols] = true; }); // an in-cell image can NEVER be written — it wins even over a force range
  return mask;
}

function writeValuesSafe_(dest, top, left, values, keep) {
  const rows = values.length; if (!rows) return 0;
  const cols = values[0].length; if (!cols) return 0;
  let merges = [];
  try { merges = dest.getRange(top, left, rows, cols).getMergedRanges(); } catch (e) { merges = []; }
  const kept = (r, c) => !!(keep && keep[r] && keep[r][c]);
  let anyKept = false;
  if (keep) { for (let r = 0; r < rows && !anyKept; r++) for (let c = 0; c < cols; c++) if (keep[r][c]) { anyKept = true; break; } }
  if (!merges.length && !anyKept) {
    try { dest.getRange(top, left, rows, cols).setValues(values); return 0; } catch (e) { /* fall through */ }
  }

  // A merge's ONLY writable cell is its top-left, and a write may not PARTIALLY overlap a merge — so every merged cell
  // is unwritable for run purposes and each anchor is set individually afterwards.
  const blocked = [], anchors = [], rowDirty = [];
  for (let r = 0; r < rows; r++) { blocked.push(new Array(cols).fill(false)); rowDirty.push(false); }
  merges.forEach((m) => {
    const r0 = m.getRow() - top, c0 = m.getColumn() - left, nr = m.getNumRows(), nc = m.getNumColumns();
    for (let r = Math.max(0, r0); r < Math.min(rows, r0 + nr); r++) {
      rowDirty[r] = true;
      for (let c = Math.max(0, c0); c < Math.min(cols, c0 + nc); c++) blocked[r][c] = true;
    }
    if (r0 >= 0 && r0 < rows && c0 >= 0 && c0 < cols) anchors.push({ r: r0, c: c0 });
  });
  for (let r = 0; r < rows; r++) { for (let c = 0; c < cols; c++) if (kept(r, c)) { rowDirty[r] = true; break; } }

  let failed = 0;
  const writeBlock = (r0, r1) => { // one call for a span of completely clean rows - keeps big sheets fast
    try { dest.getRange(top + r0, left, r1 - r0 + 1, cols).setValues(values.slice(r0, r1 + 1)); }
    catch (e) { for (let r = r0; r <= r1; r++) writeRuns(r); }
  };
  const writeRuns = (r) => {
    let c = 0;
    while (c < cols) {
      if (blocked[r][c] || kept(r, c)) { c++; continue; }
      let e = c; while (e + 1 < cols && !blocked[r][e + 1] && !kept(r, e + 1)) e++;
      const block = [values[r].slice(c, e + 1)];
      try { dest.getRange(top + r, left + c, 1, block[0].length).setValues(block); }
      catch (err) {
        for (let j = 0; j < block[0].length; j++) {
          try { dest.getRange(top + r, left + c + j).setValue(block[0][j]); } catch (e2) { failed++; }
        }
      }
      c = e + 1;
    }
  };

  let r = 0;
  while (r < rows) {
    if (!rowDirty[r]) { let e = r; while (e + 1 < rows && !rowDirty[e + 1]) e++; writeBlock(r, e); r = e + 1; continue; }
    writeRuns(r); r++;
  }
  anchors.forEach((a) => {
    if (kept(a.r, a.c)) return;
    try { dest.getRange(top + a.r, left + a.c).setValue(values[a.r][a.c]); } catch (e) { failed++; }
  });
  return failed;
}

/**
 * Size a public tab's GRID to mirror this tab's, so rows added here show up there. Two things the old
 * grow-if-content-overflows check got wrong: it only fired when the internal's CONTENT passed the public's whole
 * grid (a public copy sitting on 1000 default rows never grew, so nothing visibly tracked), and when it did fire
 * it appended at the very bottom — past the operator's closing bar, unstyled.
 * Growth now inserts ABOVE the public tab's final row, so new rows inherit that tab's own banding, formatting and
 * row height; the final row (its end-bar) always stays last. Surplus rows are removed only when everything from
 * `target` down is empty — one getLastRow check, no block read — and never the final row. The tail mirrored is
 * this tab's own (spare rows + closing bar), so the public copy ends as neatly as the internal.
 * @param {number} dataEnd last row the write occupies on the destination  @param {boolean} allowTrim shrink too (call after the write)
 */
function publishFitRows_(src, dest, dataEnd, allowTrim) {
  try {
    if (!(dataEnd > 0)) return;
    // The public copy needs ONE row below its data — its own closing bar. It never receives submissions, so
    // mirroring this tab's SPARE row too just left an extra blank row down there.
    const target = dataEnd + 1;
    const srcTail = src.getMaxRows() - src.getLastRow();
    const M = dest.getMaxRows();
    if (M < target) {
      const need = target - M;
      if (M > dataEnd) {                                   // a closing row exists → grow inside the band, above it
        dest.insertRowsBefore(M, need);
        try { dest.setRowHeights(M, need, dest.getRowHeight(Math.max(1, M - 1))); } catch (e) { /* default height */ }
      } else {                                             // grid ends at the data → nothing to protect, append
        dest.insertRowsAfter(M, need);
        try { dest.setRowHeights(M + 1, need, dest.getRowHeight(M)); } catch (e) { /* default height */ }
      }
    } else if (allowTrim && srcTail <= 3 && M > target && dest.getLastRow() < target) {
      // Trim ONLY when this tab is itself tight (auto-rows keeps a spare + a bar). A tab that deliberately holds a
      // buffer here — the roster's validation rows, a dashboard's canvas — keeps that same room on the public copy.
      dest.deleteRows(target, M - target);                 // rows target..M-1; the old final row survives as the last
    }
  } catch (e) { logWarn_('publishFitRows_', 'row fit skipped for ' + dest.getName() + ': ' + ((e && e.message) ? e.message : e)); }
}

/**
 * Keep the PERIOD (archive) hours headers in step on the public copy — header-matched path only.
 * 📸 Capture & Reset rolls those columns left here and REWRITES their labels (MAY HOURS → JUN HOURS, the
 * rightmost taking the period just closed). The header-matched publish never writes the public header row, so
 * after a capture the two files drift apart: the public's oldest month stops matching anything and freezes at
 * whatever it last held, and the newest period has no column to publish into — one month further out of step
 * every capture. Mirroring the labels positionally makes name-matching realign, so every month lands correctly.
 *
 * Deliberately conservative — it acts only when BOTH tabs expose the SAME NUMBER of period columns. A public
 * copy that intentionally shows fewer months is left alone: stale labels are recoverable, labels shuffled onto
 * the wrong data are not. The live HOURS column is excluded (its header never moves, so it always matched).
 * @param {Array<string>} dHdr the destination header row — updated IN PLACE so the caller pairs off the new names.
 * @return {number} labels rewritten.
 */
function publishSyncPeriodHeaders_(src, dest, dh, sHdr, dHdr, deep) {
  try {
    let liveHours = '';
    try { const RC = rosterCols_(src); if (RC.hours && sHdr[RC.hours - 1]) liveHours = norm_(sHdr[RC.hours - 1]); } catch (e) { /* not a roster-shaped tab */ }
    const periodsOf = (hdr) => {
      const out = [];
      hdr.forEach((h, i) => { const k = norm_(h); if (k && k.indexOf('HOURS') !== -1 && k !== liveHours) out.push(i); });
      return out;
    };
    const sp = periodsOf(sHdr), dp = periodsOf(dHdr);
    if (!sp.length || !dp.length) return 0;              // one side keeps no month columns → nothing to keep in step
    if (sp.length !== dp.length) {
      // Only on an explicit publish: the background pass runs every few seconds and would flood the SYS Log.
      if (deep) logWarn_('publishSyncPeriodHeaders_', `${dest.getName()}: ${sp.length} period column(s) here vs ${dp.length} on the public copy — month labels left alone. Match the counts and they will track each capture.`);
      return 0;
    }
    let changed = 0;
    for (let i = 0; i < sp.length; i++) {
      const want = String(sHdr[sp[i]] == null ? '' : sHdr[sp[i]]);
      if (String(dHdr[dp[i]] == null ? '' : dHdr[dp[i]]) === want) continue;
      dest.getRange(dh, dp[i] + 1).setValue(want);
      dHdr[dp[i]] = want;                                 // in place: the caller's pairing reads this array
      changed++;
    }
    return changed;
  } catch (e) { logWarn_('publishSyncPeriodHeaders_', 'period header sync skipped: ' + ((e && e.message) ? e.message : e)); return 0; }
}

/**
 * May the publish propagate row STYLING on this tab? Only the banded data tabs — the roster, the LOA Tracker and
 * the Patrol Log — where every row is a peer of the one above it, so copying a neighbour's look onto a freshly
 * published row is right. Deliberately excludes dashboards and any other tab: a Welcome Page's rows are bespoke
 * (KPI boxes, promotion tables), and pushing row N-2's format onto row N there would wreck the design.
 */
function publishStyleableTab_(name) {
  try {
    const n = norm_(name), C = cfg_().legacy.sheets;
    return [C.roster, C.tracker, C.patrolLog].some((t) => t && norm_(t) === n);
  } catch (e) { return false; }
}

/**
 * The destination's first real DATA row: its own header row plus the header→data gap THIS tab's role uses (these
 * layouts put a divider between the two). Styling must start below that divider — dressing it like a data row
 * would repaint the operator's section separator.
 */
function publishDataStart_(destName, dh) {
  try {
    const C = cfg_().legacy, n = norm_(destName), hdr = C.headerRow || 6;
    let start = C.rosterStartRow;
    if (C.sheets.tracker && norm_(C.sheets.tracker) === n) start = C.trackerStartRow;
    else if (C.sheets.patrolLog && norm_(C.sheets.patrolLog) === n) start = C.patrolStartRow;
    return dh + Math.max(1, (Number(start) || 0) - hdr);
  } catch (e) { return dh + 1; }
}

/**
 * The dropdown-bearing column on a styleable tab, read from the DESTINATION's own header row — STATUS on the
 * tracker and Patrol Log, ACTIVITY on the roster. healUnstyledRows_ uses it to tell a dressed row from an
 * undressed one; 0 (not found) makes it a no-op.
 */
function publishStatusCol_(dest, dh, width) {
  try {
    const hdr = dest.getRange(dh, 1, 1, Math.max(width, 1)).getDisplayValues()[0].map((h) => norm_(h));
    // EXACT first. The roster carries both ACTIVITY and LAST ACTIVITY, and only the former holds the dropdown —
    // a plain contains-scan hands back whichever sits left, so a roster with LAST ACTIVITY first would have had
    // its history column treated as the status column and every data row judged undressed.
    const exact = (want) => { for (let c = 0; c < hdr.length; c++) { if (hdr[c] === want) return c + 1; } return 0; };
    const hit = exact('STATUS') || exact('ACTIVITY');
    if (hit) return hit;
    for (let c = 0; c < hdr.length; c++) { if (hdr[c].indexOf('STATUS') !== -1) return c + 1; }
    // LAST ACTIVITY / 2 PERIODS AGO … are the history chain, never the live status.
    for (let c = 0; c < hdr.length; c++) { if (hdr[c].indexOf('ACTIVITY') !== -1 && hdr[c].indexOf('LAST') === -1) return c + 1; }
  } catch (e) { /* unreadable header → no-op */ }
  return 0;
}

/**
 * Dress the rows this publish just landed on the public copy.
 *
 * BOTH repairs, in the order tidyTailRows_ uses them on the internal tabs — the publish ran only the second one,
 * which is why a freshly published row stayed black. styleTailRows_ compares BACKGROUNDS, and a row published into
 * never-styled space looks exactly like the blank tail below it, so its "already consistent" check reads as
 * nothing-to-do and returns. healUnstyledRows_ keys off the STATUS DROPDOWN instead, which every dressed row on
 * these tabs carries and no raw row does, so it catches precisely the case the background test is blind to.
 */
function publishDressRows_(dest, dh, lastData, width) {
  if (!(dh > 0)) return;
  // `lastData` arrives from the SOURCE (the FULL path passes src.getLastRow()), and the two sheets do not have to
  // end on the same row. Clamp it to the DESTINATION before either repair runs:
  //   • getMaxRows() - 1 — the public tab's final row is its closing bar, and dressing it as a data row would
  //     repaint the operator's end-of-sheet marker. styleTailRows_ guards its own final row; healUnstyledRows_
  //     trusts its caller, so the guard has to live here or a source tab whose bar carries text takes the public
  //     bar with it.
  //   • getLastRow() — never claim rows the destination does not actually hold.
  const last = Math.min(Number(lastData) || 0, dest.getLastRow(), dest.getMaxRows() - 1);
  const ds = publishDataStart_(dest.getName(), dh);
  if (!(last > ds)) return; // need at least one row above to copy the look from
  try { if (typeof healUnstyledRows_ === 'function') healUnstyledRows_(dest, ds, last, publishStatusCol_(dest, dh, width), width); }
  catch (e) { log_('publishDressRows_.heal', e); }
  try { if (typeof styleTailRows_ === 'function') styleTailRows_(dest, ds, last, Math.max(0, dest.getMaxRows() - 1 - last), width); }
  catch (e) { log_('publishDressRows_.tail', e); }
}

/**
 * Mirror ROW HEIGHTS from this tab onto the public copy for the block just published. Height is a SHEET property:
 * no value write, no format paste and no row insert carries it, so a published row could sit at the wrong height
 * even wearing the right skin. Apps Script has no bulk height API (getRowHeight is one call per row), so the cost
 * is bounded by scope: `deep` (an explicit menu/setup publish) re-syncs the whole block, while the frequent
 * background catch-ups only check the last few rows — which is exactly where a new submission lands.
 * Only rows whose height actually differs are written.
 */
function publishMirrorHeights_(src, dest, srcStart, destStart, n, deep) {
  try {
    if (!(n > 0) || srcStart < 1 || destStart < 1) return;
    const from = deep ? 0 : Math.max(0, n - 5); // shallow: just the tail, where published rows are added
    for (let i = from; i < n; i++) {
      const sr = srcStart + i, dr = destStart + i;
      if (sr > src.getMaxRows() || dr > dest.getMaxRows()) break;
      const h = src.getRowHeight(sr);
      if (dest.getRowHeight(dr) !== h) dest.setRowHeight(dr, h);
    }
  } catch (e) { logWarn_('publishMirrorHeights_', 'row heights skipped for ' + dest.getName() + ': ' + ((e && e.message) ? e.message : e)); }
}

function publishMirrorTab_(src, dest, deep) {
  const sh = publishHeaderRow_(src), dh = publishHeaderRow_(dest);
  const sRows = src.getLastRow(), sCols = src.getLastColumn();
  if (sRows < 1 || sCols < 1) return 0;

  // MODE IS CHOSEN BY WIDTH, never by content. A tab copied across and left alone has the SAME number of columns, so
  // it is mirrored WHOLESALE by position — which is the only thing that reproduces a dashboard, where the Welcome
  // Page's leadership / promotions / leaderboard boxes sit at fixed cells under no header at all. Delete a column from
  // a public tab and it becomes narrower, which switches that tab to header-matching below.
  // (Content-based detection was tried and failed: the "header row" a dashboard exposes is really a row of KPI VALUES,
  //  which differ between the two files by design, so the two sheets never compared equal.)
  // getMaxColumns is the GRID width — unlike getLastColumn it does not depend on which cells happen to be filled, so a
  // public copy whose dynamic cells are still blank is correctly recognised as an untouched copy of the same shape.
  const step = (label, fn) => { try { return fn(); } catch (e) { throw new Error(label + ' -> ' + ((e && e.message) ? e.message : e)); } };
  if (src.getMaxColumns() === dest.getMaxColumns()) {
    step('fit rows ' + sRows, () => publishFitRows_(src, dest, sRows, false)); // make room BEFORE the write (grow only)
    // FORCE-mirror cells (e.g. Welcome Page headers reading from the internal): computed once, it both (a) tells the
    // read to publish a cross-sheet formula as its VALUE, and (b) un-keeps those cells so the write isn't skipped.
    const force = publishForceMask_(dest, 1, 1, sRows, sCols);
    const vals = step('read src ' + sRows + 'x' + sCols, () => publishReadCells_(src.getRange(1, 1, sRows, sCols), false, force));
    // NEVER transmit a sensitive column: blank it in the outgoing block BEFORE the write. Writing first and wiping
    // after left every member's Email/DOB/Phone live on the public file between the two calls — and permanently so
    // if the execution died in that window.
    const sens = [];
    if (sh) {
      src.getRange(sh, 1, 1, sCols).getDisplayValues()[0].forEach((h, i) => { if (publishSensitiveHeader_(h)) sens.push(i); });
      sens.forEach((i) => { for (let r = sh; r < vals.length; r++) vals[r][i] = ''; });
    }
    const keep = publishKeepMask_(dest, 1, 1, sRows, sCols, force);
    const bad = step('write dest ' + sRows + 'x' + sCols, () => writeValuesSafe_(dest, 1, 1, vals, keep));
    if (bad) logWarn_('publishMirrorTab_', dest.getName() + ': ' + bad + ' cell(s) could not be written (in-cell image or chip).');
    if (sh && sRows > sh) { // and scrub any residue the original manual tab copy brought along (cells the masked write skipped)
      sens.forEach((i) => dest.getRange(sh + 1, i + 1, sRows - sh, 1).clearContent());
    }
    // Carry NUMBER FORMATS too. Values alone are not enough: a date/time written onto a public row past whatever the
    // tab copy happened to be formatted down to renders as a raw serial (46212) instead of "19 Jul. 2026".
    try { dest.getRange(1, 1, sRows, sCols).setNumberFormats(src.getRange(1, 1, sRows, sCols).getNumberFormats()); }
    catch (e) { log_('publishMirrorTab_.formats', e); }
    const dLast = dest.getLastRow();
    if (dLast > sRows) step('clear trailing ' + (dLast - sRows), () => dest.getRange(sRows + 1, 1, dLast - sRows, sCols).clearContent());
    publishFitRows_(src, dest, sRows, true); // now the trailing rows are empty, shrink to data + the closing bar
    // A published row landing where the public tab was never styled came out raw (reported: the newest patrol row
    // was black on the public copy). Propagate the PUBLIC tab's own look onto it, banded data tabs only.
    if (publishStyleableTab_(dest.getName())) publishDressRows_(dest, dh, sRows, sCols);
    // Heights last, so they win over anything the styling pass normalised to the PUBLIC tab's own rows: the
    // internal is the source of truth for how tall a row is. Data rows only — the banner keeps its own sizing.
    if (sh > 0 && dh > 0) publishMirrorHeights_(src, dest, sh + 1, dh + 1, sRows - sh, deep);
    return sRows;
  }

  // EDITED COPY (columns deleted/reordered) → match by header, so only the columns the public tab still has get filled.
  if (!sh || !dh) return 0;
  const sHdr = src.getRange(sh, 1, 1, Math.max(src.getLastColumn(), 1)).getDisplayValues()[0];
  const dHdr = dest.getRange(dh, 1, 1, Math.max(dest.getLastColumn(), 1)).getDisplayValues()[0];
  // A capture renamed the month columns here (MAY HOURS → JUN HOURS…). Re-label the public's period columns to
  // match BEFORE pairing, or the newest month has nowhere to land and the oldest one freezes. Updates dHdr in place.
  publishSyncPeriodHeaders_(src, dest, dh, sHdr, dHdr, deep);
  const byName = {};
  sHdr.forEach((h, i) => { const k = norm_(h); if (k && !(k in byName)) byName[k] = i + 1; }); // first wins on duplicates
  const pairs = [], scrub = [];
  dHdr.forEach((h, i) => {
    const k = norm_(h); if (!k) return;
    if (publishSensitiveHeader_(h)) { scrub.push(i + 1); return; }
    if (byName[k]) pairs.push({ sc: byName[k], dc: i + 1 });
  });
  if (!pairs.length && !scrub.length) return 0;

  const srcStart = sh + 1, destStart = dh + 1;
  const n = Math.max(0, src.getLastRow() - srcStart + 1);
  const need = destStart + n - 1;
  publishFitRows_(src, dest, need, false); // room BEFORE the write; the shrink runs once the trailing rows are cleared
  if (n) {
    pairs.forEach((p) => {
      // valuesOnly=true: this is the header-matched path (public layout differs), so publish computed VALUES — a copied
      // formula's relative refs would point at the wrong public column (e.g. TIME IN RANK reading a checkbox column).
      // mirrorWins=true: and the value WINS over any formula already sitting in this mirrored public column — that's
      // residue from the old formula-copying publishes (the "46227 days" ghosts on empty rows), healed on this write.
      writeValuesSafe_(dest, destStart, p.dc, publishReadCells_(src.getRange(srcStart, p.sc, n, 1), true),
        publishKeepMask_(dest, destStart, p.dc, n, 1, null, true));
      try { dest.getRange(destStart, p.dc, n, 1).setNumberFormats(src.getRange(srcStart, p.sc, n, 1).getNumberFormats()); }
      catch (e) { log_('publishMirrorTab_.formats', e); }
    });
    scrub.forEach((c) => dest.getRange(destStart, c, n, 1).clearContent());
  }
  const dLast = dest.getLastRow(); // drop rows left over from a previous, longer publish
  if (dLast >= destStart + n) {
    const widest = Math.max.apply(null, pairs.map((p) => p.dc).concat(scrub).concat([1]));
    dest.getRange(destStart + n, 1, dLast - (destStart + n) + 1, widest).clearContent();
  }
  publishFitRows_(src, dest, need, true); // shrink to data + the closing bar now the leftovers are cleared
  if (publishStyleableTab_(dest.getName())) publishDressRows_(dest, dh, need, Math.max(1, dest.getLastColumn())); // see the same-width path
  publishMirrorHeights_(src, dest, srcStart, destStart, n, deep); // the internal decides how tall a row is
  return n;
}

/**
 * Publish: every tab in the PUBLIC file that has a same-named tab here is mirrored. The public file's OWN tab list is
 * therefore the allow-list — copy a tab across to publish it, delete it to stop. Blocked tabs are never mirrored.
 */
function publishPublicRoster_(onlyTab, opts) {
  const file = publicFile_();
  if (!file) return { linked: false, tabs: [], rows: 0, skipped: [] };
  const ss = SpreadsheetApp.getActive();
  // A public target pointing at THIS workbook would mirror the sheet onto itself and scrub its own Unique ID column.
  if (file.getId() === ss.getId()) {
    logWarn_('publishPublicRoster_', 'the linked public file IS this workbook — refusing to publish onto itself.');
    return { linked: true, selfTarget: true, tabs: [], rows: 0, skipped: [], detail: ['Refused: the linked public roster is THIS workbook. Re-link it to a separate spreadsheet.'] };
  }
  const out = { linked: true, tabs: [], rows: 0, skipped: [], url: '' };
  try { out.url = file.getUrl(); } catch (e) { /* cosmetic */ }
  out.detail = [];
  // PREEMPTIBLE, CHUNKED PASS: the script lock is taken PER TAB (seconds), never for the whole pass (tens of seconds
  // on a many-tab workbook) — that whole-pass hold was why interactive actions kept hitting "Another roster operation
  // is running". With yieldToBackoff, the pass also STOPS between tabs the moment an interactive actor stamps the
  // backoff (or wins a tab's lock): the caller re-marks dirty and the sweep finishes the leftover tabs within a minute.
  const yieldOn = !!(opts && opts.yieldToBackoff);
  const lock = LockService.getScriptLock();
  let aborted = false;
  file.getSheets().forEach((dest) => {
    const name = dest.getName();
    if (aborted) { out.skipped.push(name); return; }
    if (onlyTab && norm_(name) !== norm_(onlyTab)) return; // incremental: only the tab that actually changed
    if (publishTabBlocked_(name)) { out.skipped.push(name); out.detail.push(`${name}: BLOCKED (never published)`); return; }
    const src = ss.getSheetByName(name);
    if (!src) { out.skipped.push(name); out.detail.push(`${name}: no tab of that name here`); return; }
    if (publishSelfComputing_(dest)) { // rebuilds itself from the tabs we DO publish; writing into it blocks its spills
      let freed = 0;
      try { freed = publishFreeSpills_(dest); } catch (e) { log_('publishFreeSpills_.' + name, e); }
      out.skipped.push(name);
      out.detail.push(`${name}: self-computing - left alone` + (freed ? ` (freed ${freed} blocked spill cell(s))` : ''));
      return;
    }
    if (yieldOn) { // an interactive actor stamped the backoff mid-pass → get out of their way NOW
      try {
        if (Date.now() < Number(PropertiesService.getDocumentProperties().getProperty(PUBLISH_BACKOFF_PROP_) || 0)) {
          aborted = true; out.aborted = true; out.skipped.push(name);
          out.detail.push(`${name}: yielded to an interactive operation (the sweep finishes the rest)`);
          return;
        }
      } catch (e) { /* unreadable → keep publishing */ }
    }
    if (!lock.tryLock(yieldOn ? 4000 : 20000)) { // an interactive writer holds the lock → background passes yield
      out.skipped.push(name); out.detail.push(`${name}: lock busy${yieldOn ? ' — yielded' : ''}`);
      if (yieldOn) { aborted = true; out.aborted = true; }
      return;
    }
    try {
      const sg = src.getMaxColumns(), dg = dest.getMaxColumns();
      const mode = (sg === dg) ? 'FULL' : 'match';
      try {
        const n = publishMirrorTab_(src, dest, !yieldOn); // explicit publish → re-sync every row height; background → tail only
        out.tabs.push(name); out.rows += n;
        out.detail.push(`${name}: ${mode} · ${n} row(s) · grid ${sg}/${dg} · src rows ${src.getLastRow()}`);
      } catch (e) {
        log_('publishMirrorTab_.' + name, e);
        out.skipped.push(name);
        out.detail.push(`${name}: ERROR ${e && e.message ? e.message : e} | grid ${sg}/${dg} | src ${src.getLastRow()}x${src.getLastColumn()} | dest grid ${dest.getMaxRows()}x${dest.getMaxColumns()}`);
      }
    } finally { lock.releaseLock(); }
  });
  return out;
}

/* Near-live publishing. A SIMPLE onEdit can't open another file, but an INSTALLABLE one runs authorized and can —
 * so 🔌 Install Triggers registers publishOnChange for both onEdit (cell edits) and onChange (row insert/DELETE,
 * which onEdit never sees). Bursts are rate-limited and a 1-minute sweep publishes anything that was skipped. */
const PUBLISH_MIN_GAP_MS_ = 3000; // burst guard only - small enough that a normal edit publishes straight away
const PUBLISH_DIRTY_PROP_ = 'PUBLIC_DIRTY';
const PUBLISH_LAST_PROP_ = 'PUBLIC_LAST_PUBLISH';
const PUBLISH_CATCHUP_PROP_ = 'PUBLIC_CATCHUP_AT';
const PUBLISH_CATCHUP_MS_ = 8000; // trailing publish ~8s after a burst's last deferred edit — so the tail shows in seconds, not on the 1-minute sweep
const PUBLISH_BACKOFF_PROP_ = 'PUBLISH_BACKOFF_UNTIL'; // interactive-first: a pending panel write / transfer stamps now+45s here and NEW publish passes stand down until it expires
const PUBLISH_BACKOFF_MS_ = 45000;
const PUBLISH_PASS_PROP_ = 'PUBLISH_PASS_UNTIL'; // pass mutex: per-tab locking replaced the whole-pass script lock, so this keeps two passes from interleaving (stale after 5 min — a dead pass can never wedge publishing)

/** Claim the one-publish-at-a-time slot. @return {boolean} false when another pass is already running. */
function publishPassClaim_() {
  try {
    const p = PropertiesService.getDocumentProperties();
    if (Date.now() < Number(p.getProperty(PUBLISH_PASS_PROP_) || 0)) return false;
    p.setProperty(PUBLISH_PASS_PROP_, String(Date.now() + 300000));
    return true;
  } catch (e) { return true; } // properties unreadable → publish anyway; the per-tab locks still serialize the writes
}
function publishPassRelease_() { try { PropertiesService.getDocumentProperties().deleteProperty(PUBLISH_PASS_PROP_); } catch (e) { /* expires on its own */ } }

/** Flag the public copy as stale WITHOUT publishing. Script writes (panel actions, the schedulers, patrol crediting)
 *  never fire onEdit, so they mark it here and the 1-minute sweep carries them. Cheap: one property write.
 *
 *  The flag is a boolean, so writing it twice in one execution is pure waste — and the callers are LOOPS
 *  (refreshPatrolLog_ processes every row, each row reconciling credit), which turned one of the slowest calls in
 *  Apps Script into a per-row cost. Memoised per execution; globals reset on every run, so the next execution marks
 *  again. The memo is cleared wherever the property is, so a mark landing after a mid-execution publish still counts. */
let _pubDirtyMemo_ = false;
function publishMarkDirty_() {
  if (_pubDirtyMemo_) return;
  try { PropertiesService.getDocumentProperties().setProperty(PUBLISH_DIRTY_PROP_, '1'); _pubDirtyMemo_ = true; } catch (e) { /* best-effort */ }
}

/** Background publish: chunked + preemptible (per-tab locks, yields to interactive stamps mid-pass). Clears the dirty
 *  flag FIRST so an edit landing mid-publish re-marks itself; an aborted pass re-marks it so the sweep resumes. */
function publishPublicRosterQuiet_(onlyTab, mayClear) {
  const props = PropertiesService.getDocumentProperties();
  // INTERACTIVE-FIRST: a panel write or member transfer waiting on the shared lock has stamped a backoff — don't
  // START a new publish pass against it. The dirty flag stays set, so the sweep carries the publish the moment the
  // interactive burst is over.
  try { if (Date.now() < Number(props.getProperty(PUBLISH_BACKOFF_PROP_) || 0)) return; } catch (e) { /* best-effort */ }
  if (!publishPassClaim_()) return; // another pass is already running — it (or the sweep) carries this change
  try {
    // The GLOBAL flag: a FULL pass always clears it. A PARTIAL (single-tab) pass may clear it ONLY when its
    // caller saw the flag clean before marking its own edit (mayClear) — then this pass covers everything
    // pending. If script-write changes were already queued (patrol credit, panel actions), the flag stays so
    // the sweep's full pass carries them — but an ordinary edit no longer leaves a full publish behind it
    // (that made the sweep republish EVERY tab every minute and hog the lock against the menu publish).
    if (!onlyTab || mayClear) {
      props.deleteProperty(PUBLISH_DIRTY_PROP_); // BEFORE publishing, so a concurrent edit re-marks itself
      _pubDirtyMemo_ = false;
    }
    const res = publishPublicRoster_(onlyTab, { yieldToBackoff: true });
    if (res && res.aborted) { props.setProperty(PUBLISH_DIRTY_PROP_, '1'); _pubDirtyMemo_ = true; } // yielded mid-pass → the sweep finishes the leftover tabs
    props.setProperty(PUBLISH_LAST_PROP_, String(Date.now()));
  } catch (e) { log_('publishPublicRosterQuiet_', e); }
  finally { publishPassRelease_(); }
}

/** Installable onEdit + onChange handler: republish the public copy promptly, rate-limited against edit bursts. */
function publishOnChange(e) {
  try {
    if (!String(PropertiesService.getDocumentProperties().getProperty(PUBLIC_FILE_PROP_) || '').trim()) return; // not linked → nothing to do (a property read, NOT openById — this fires on every keystroke, twice)
    // ANY edit anywhere counts (every public tab is mirrored), but only the EDITED tab is republished — re-mirroring
    // all four tabs on every keystroke is the "rebuild everything" trap and would blow the onEdit budget. Structural
    // changes (onChange, no range) and script writes fall back to the full pass via the sweep.
    let only = '';
    try { only = (e && e.range) ? e.range.getSheet().getName() : ''; } catch (ig) { only = ''; }
    const props = PropertiesService.getDocumentProperties();
    const wasDirty = props.getProperty(PUBLISH_DIRTY_PROP_) === '1'; // script writes already pending? then a partial pass must NOT clear the flag
    props.setProperty(PUBLISH_DIRTY_PROP_, '1');
    _pubDirtyMemo_ = true;
    // No range = an onChange firing (a paste/edit, a row/column insert-delete, or a format change). A full synchronous
    // publish here grabs the script lock and would race — and cancel — an in-flight member transfer that is about to
    // rewrite rows under that same lock (the transfer's ID paste ALSO reaches here as an onChange). VALUE/format changes
    // are already republished immediately by the matching onEdit firing, so defer those to the sweep (dirty is set).
    // STRUCTURAL changes (INSERT_ROW/REMOVE_ROW/…) don't fire onEdit at all, so let those publish now to stay immediate.
    if (!e || !e.range) {
      const ct = String((e && e.changeType) || '').toUpperCase();
      if (ct === 'EDIT' || ct === 'OTHER' || ct === 'FORMAT' || ct === '') return; // value/format/unknown → onEdit + sweep cover it
      // else fall through: a structural change onEdit can't see → publish it (only === '' → full publish)
    }
    // A Unique-ID edit on the roster starts a member TRANSFER (or a roster/tracker autofill) that briefly takes the
    // script lock to rewrite rows. Publishing synchronously here would race that mutation for the SAME lock and cancel
    // the transfer ("Another roster change is in progress"). So for ID-column edits we only mark dirty (done above) and
    // let the transfer's own end-of-move publish — or the 1-minute sweep — carry the settled result.
    if (only === CONFIG.sheets.roster) {
      try {
        const RC = rosterCols_(e.range.getSheet());
        const c = e.range.getColumn(), cL = e.range.getLastColumn ? e.range.getLastColumn() : c;
        if (RC.discord && c <= RC.discord && cL >= RC.discord) { scheduleCatchup_(); return; } // move/ID edit → publish via the ~8s catch-up (checkForMemberMove can't, it's AuthMode.LIMITED)
      } catch (ig) { /* fall through to a normal publish */ }
    }
    const last = Number(props.getProperty(PUBLISH_LAST_PROP_) || 0);
    if (Date.now() - last < PUBLISH_MIN_GAP_MS_) { scheduleCatchup_(); return; } // too soon → a trailing catch-up publishes the tail in ~8s (not the 1-minute sweep)
    publishPublicRosterQuiet_(only || undefined, !wasDirty); // nothing else was pending → this partial pass covers it all and may clear the flag
  } catch (err) { log_('publishOnChange', err); }
}

/** 1-minute safety net: publishes only when something actually changed, so an idle sheet costs nothing. */
function publishSweep() {
  try {
    // Also the general maintenance tick: flush queued whole-tab rebuilds (Academy / groups / dashboard) so a burst of
    // edits costs ONE rebuild rather than one per keystroke.
    try { if (typeof runDeferredWork_ === 'function') runDeferredWork_(); } catch (e) { log_('publishSweep.deferred', e); }
    if (PropertiesService.getDocumentProperties().getProperty(PUBLISH_DIRTY_PROP_) !== '1') return;
    if (!String(PropertiesService.getDocumentProperties().getProperty(PUBLIC_FILE_PROP_) || '').trim()) return; // linkage check without openById — the publish itself opens the file
    publishPublicRosterQuiet_();
  } catch (e) { log_('publishSweep', e); }
}

/**
 * Ensure ONE one-off "catch-up" publish is scheduled ~PUBLISH_CATCHUP_MS_ out. When a burst of edits keeps deferring on
 * the 3s burst-guard, the FINAL state would otherwise wait for the 1-minute sweep; this trailing trigger publishes it in
 * seconds instead. Deduped via a document property so a flurry schedules at most one pending trigger (ScriptApp is
 * touched ~once per window, never per keystroke), and publishCatchup deletes the trigger when it fires. Best-effort: if
 * trigger creation is unavailable or quota-limited, the 1-minute sweep is still the backstop. Requires the installable
 * (authorized) context — publishOnChange runs installed, so ScriptApp is available here.
 */
function scheduleCatchup_() {
  try {
    const p = PropertiesService.getDocumentProperties();
    const now = Date.now();
    if (Number(p.getProperty(PUBLISH_CATCHUP_PROP_) || 0) > now) return; // one is already pending → don't touch ScriptApp again
    ScriptApp.getProjectTriggers().forEach((t) => { if (t.getHandlerFunction() === 'publishCatchup') ScriptApp.deleteTrigger(t); }); // clear spent/orphaned ones → stay at ≤1, far under the trigger quota
    ScriptApp.newTrigger('publishCatchup').timeBased().after(PUBLISH_CATCHUP_MS_).create();
    p.setProperty(PUBLISH_CATCHUP_PROP_, String(now + PUBLISH_CATCHUP_MS_));
  } catch (e) { /* best-effort: the 1-minute sweep still carries it */ }
}

/** One-off trailing publish (scheduled by scheduleCatchup_): clear its own marker + self-delete the trigger, then run
 *  the sweep (flush deferred rebuilds + publish if dirty). */
function publishCatchup() {
  try {
    PropertiesService.getDocumentProperties().deleteProperty(PUBLISH_CATCHUP_PROP_);
    ScriptApp.getProjectTriggers().forEach((t) => { if (t.getHandlerFunction() === 'publishCatchup') ScriptApp.deleteTrigger(t); });
  } catch (e) { /* ignore — a stale trigger is cleared by the next scheduleCatchup_ */ }
  try { publishSweep(); } catch (e) { log_('publishCatchup', e); }
}

/** Time-driven + menu entry point for the publish. Chunked like the background pass (per-tab locks, so it never
 *  starves interactive actions) but NEVER yields — the operator asked for a full publish, so it runs every tab. */
function publishPublicRoster() {
  if (!publishPassClaim_()) return false; // a background pass is mid-flight — rare and brief now; try again in a moment
  try {
    const props = PropertiesService.getDocumentProperties();
    const linked = !!String(props.getProperty(PUBLIC_FILE_PROP_) || '').trim();
    if (linked) { props.deleteProperty(PUBLISH_DIRTY_PROP_); _pubDirtyMemo_ = false; } // this IS the full pass — clear first so an edit mid-publish re-marks
    const res = publishPublicRoster_();
    if (res.linked) {
      props.setProperty(PUBLISH_LAST_PROP_, String(Date.now())); // the sweep + burst guard see this pass, no redundant follow-up
      logInfo_('publishPublicRoster', `published ${res.rows} row(s) across ${res.tabs.length} tab(s).`);
    }
    return res;
  } finally { publishPassRelease_(); }
}

/** Menu: publish now and report. */
function publishPublicRosterNow() {
  runAction_('Publish Public Roster', () => {
    const ui = SpreadsheetApp.getUi();
    const res = publishPublicRoster();
    if (res === false) { ui.alert('Publish skipped — another roster operation is running.'); return; }
    if (!res.linked) { ui.alert('🌐 Public Roster', 'No public roster is linked yet.\n\nRun 👥 Roster ▸ 🌐 Set Up Public Roster first.', ui.ButtonSet.OK); return; }
    ui.alert('🌐 Published',
      res.rows + ' row(s) across ' + res.tabs.length + ' tab(s).\n\n' +
      (res.detail || []).join('\n') +
      '\n\nFULL = mirrored wholesale (grids match). match = header-matched (public tab is narrower).\n' +
      res.url, ui.ButtonSet.OK);
  });
}

/** Menu: create or link the public spreadsheet, then do a first publish. */
function setupPublicRoster() {
  runAction_('Set Up Public Roster', () => {
    const ui = SpreadsheetApp.getUi();
    const existing = String(PropertiesService.getDocumentProperties().getProperty(PUBLIC_FILE_PROP_) || '').trim();
    const res = ui.prompt('🌐 Set Up Public Roster',
      (existing ? 'A public roster is already linked — pasting a different one REPLACES it.\n\n' : '') +
      'Paste the PUBLIC spreadsheet\'s URL or ID to link it,\nor leave this blank and press OK to create a new one.', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    const raw = String(res.getResponseText() || '').trim();
    let file;
    if (raw) {
      const m = raw.match(/[-\w]{25,}/);
      if (!m) { ui.alert('That doesn\'t look like a spreadsheet URL or ID.'); return; }
      file = SpreadsheetApp.openById(m[0]); // throws Google's own permission error if they can't open it
    } else {
      file = SpreadsheetApp.create(`${SpreadsheetApp.getActive().getName()} — Public Roster`);
    }
    PropertiesService.getDocumentProperties().setProperty(PUBLIC_FILE_PROP_, file.getId());
    const sum = publishPublicRoster_();
    logInfo_('setupPublicRoster', `public roster linked: ${file.getId()}`);
    ui.alert('🌐 Public roster linked',
      file.getName() + '\n' + file.getUrl() + '\n\n' +
      'NEXT — copy the tabs you want members to see into that file (right-click a tab ▸ Copy to ▸ that spreadsheet), ' +
      'then rename each copy to EXACTLY match its name here. Publishing mirrors every public tab whose name matches a ' +
      'tab here, matching columns by header — so delete a column there and it simply stops being filled.\n\n' +
      'Unique ID / email / DOB / phone are never published and are wiped if a copy brought them along. Config, ' +
      'Webhooks, Disciplinary Log and Signups are never published at all.\n\n' +
      'Then share THAT file with members and restrict this one — in that order.', ui.ButtonSet.OK);
  });
}

/** Create the Roster Signup form and point its responses INSIDE the protected admin file.
 *  (No menu entry any more — run from the script editor if ever needed; the signup REVIEW lives in Control Panel ▸ Signups.) */
function createSignupForm() {
  runAction_('Create Roster Signup Form', () => {
    const ui = SpreadsheetApp.getUi();
    const file = adminFile_();
    if (!file) { ui.alert('🧾 Roster Signup', 'Link the protected admin file first (🎛️ Control Panel ▸ Tools ▸ admin roster).', ui.ButtonSet.OK); return; }
    if (file.getSheetByName(CONFIG.sheets.signups)) { ui.alert('🧾 Roster Signup', `"${CONFIG.sheets.signups}" already exists in the admin file — the signup form is already set up.`, ui.ButtonSet.OK); return; }
    const before = {}; file.getSheets().forEach((s) => { before[s.getSheetId()] = true; });
    const form = FormApp.create('Roster Signup');
    form.setDescription('Apply to join. Your answers go to a private file that only command staff can open.');
    form.addTextItem().setTitle('Name (in-character)').setRequired(true);
    form.addTextItem().setTitle('OOC Name').setRequired(true);
    form.addTextItem().setTitle('Unique ID').setRequired(true)
      .setValidation(FormApp.createTextValidation().setHelpText(idDigitsLabel_() + ' digits — copy-paste it, never retype it.').requireTextMatchesPattern(idRegexSource_()).build());
    form.addTextItem().setTitle('Email').setRequired(true)
      .setValidation(FormApp.createTextValidation().setHelpText('A valid email address.').requireTextIsEmail().build());
    form.addDateItem().setTitle('Date of Birth').setRequired(true);
    form.addTextItem().setTitle('Phone').setRequired(false);
    form.addParagraphTextItem().setTitle('Prior Experience').setRequired(false);
    form.addTextItem().setTitle('Timezone').setRequired(false);
    form.addMultipleChoiceItem().setTitle('Age Confirmation').setChoiceValues(['I confirm I meet the minimum age requirement']).setRequired(true);
    form.addParagraphTextItem().setTitle('Why do you want to join?').setRequired(false);
    form.setDestination(FormApp.DestinationType.SPREADSHEET, file.getId());
    SpreadsheetApp.flush();
    let created = null; // Google adds a brand-new response tab — find it, rename it, then add the STATUS column
    file.getSheets().forEach((s) => { if (!before[s.getSheetId()]) created = s; });
    let renamed = false;
    if (created) { try { created.setName(CONFIG.sheets.signups); renamed = true; } catch (e) { log_('createSignupForm.rename', e); } }
    ensureSignupTab_(file);
    logInfo_('createSignupForm', `signup form created; responses → ${file.getId()} / ${CONFIG.sheets.signups}.`);
    ui.alert('🧾 Roster Signup form created',
      `Share with applicants:\n${form.getPublishedUrl()}\n\nEdit the form:\n${form.getEditUrl()}\n\nResponses land on "${CONFIG.sheets.signups}" inside the ADMIN file — never the public workbook.` +
      (renamed ? '' : `\n\n⚠️ Couldn't auto-rename the new response tab — rename it to "${CONFIG.sheets.signups}" in the admin file, then run 🔒 Sync Internal Roster.`), ui.ButtonSet.OK);
  });
}

/** Panel endpoint: signups still needing action, plus the OPEN roster slots one can be placed into. */
function cpSignupList() {
  const file = adminFile_();
  const roster = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster);
  const slots = [];
  const RCall = roster ? rosterCols_(roster) : null;
  if (roster) {
    const RC = RCall, start = CONFIG.rosterStartRow, last = roster.getLastRow();
    if (last >= start) {
      const n = last - start + 1;
      // One full-width read instead of three column reads — the shift column is optional, and asking for it
      // separately meant a fourth round trip on a sheet that can be hundreds of rows.
      const block = roster.getRange(start, 1, n, roster.getLastColumn()).getDisplayValues();
      const SE = statusEngine_();
      const reqCache = {};
      const reqFor = (rank) => {
        if (reqCache[rank] == null) {
          const ladder = statusLadderFor_(rank, SE);
          reqCache[rank] = (ladder && ladder.length) ? (Number(ladder[0].min) || 0) : 0;
        }
        return reqCache[rank];
      };
      for (let i = 0; i < n; i++) {
        const rank = String(block[i][RC.rank - 1]).trim();
        if (!isMemberSlot_(rank) || rank === '' || rank === 'Rank') continue;
        if (String(block[i][RC.name - 1]).trim() !== '') continue; // filled → not an open slot
        slots.push({
          row: start + i, rank: rank,
          unit: RC.unit ? String(block[i][RC.unit - 1]).trim() : '',
          shift: RC.shift ? String(block[i][RC.shift - 1]).trim() : '', // what this slot carries, if anything
          req: reqFor(rank),                                           // top-tier MinHours for this rank
        });
      }
    }
  }
  let rankIcons = {}; try { if (typeof rankIconsMap_ === 'function') rankIcons = rankIconsMap_(); } catch (e) { /* icons optional */ }
  const shiftLabel = cpShiftLabel_(roster, RCall || {});
  const base = { slots: slots, rankIcons: rankIcons, shiftLabel: shiftLabel, statuses: cpStatuses_(),
    oocCol: !!(RCall && RCall.ooc), flaggedStatus: SIGNUP_FLAGGED_ };
  if (!file) return Object.assign({ linked: false, ready: false, signups: [], recent: [] }, base);
  const sh = file.getSheetByName(CONFIG.sheets.signups);
  if (!sh) return Object.assign({ linked: true, ready: false, signups: [], recent: [] }, base);
  const split = signupSplit_(sh, 100, 12);
  return Object.assign({ linked: true, ready: true, signups: split.queue, recent: split.recent, waiting: split.waiting }, base);
}

/**
 * Panel: FLAG a signup for review — "I am not ready to seat this one." Not a rejection and not terminal; the row
 * stays in the queue wearing the flag so the next admin sees it was parked deliberately rather than missed.
 * Uses the same row-resolution defence as approval: signup rows shift under an open panel, so the row number the
 * client saw may hold a different applicant by now.
 */
function cpSignupFlag(payload) {
  const file = adminFile_();
  if (!file) throw new Error('No admin file is linked yet.');
  const sh = file.getSheetByName(CONFIG.sheets.signups);
  if (!sh) throw new Error(`"${CONFIG.sheets.signups}" was not found in the admin file.`);
  const row = signupResolveRow_(sh, Number((payload && payload.row) || 0), String((payload && payload.id) || ''));
  const SC = signupCols_(sh);
  if (!SC.status) throw new Error('That signup tab has no Status column.');
  const cur = String(sh.getRange(row, SC.status).getDisplayValue()).trim();
  if (signupIsDone_(cur)) throw new Error('That signup is already processed.');
  const on = norm_(cur) !== norm_(SIGNUP_FLAGGED_);
  sh.getRange(row, SC.status).setValue(on ? SIGNUP_FLAGGED_ : SIGNUP_STATUSES_[0]); // toggle: flag ⇄ back to Pending
  const who = String(sh.getRange(row, SC.name || 1).getDisplayValue()).trim();
  cpAudit_('signup', cur, on ? SIGNUP_FLAGGED_ : SIGNUP_STATUSES_[0], sh.getRange(row, SC.status).getA1Notation(), who);
  return { row: row, status: on ? SIGNUP_FLAGGED_ : SIGNUP_STATUSES_[0], flagged: on };
}

/**
 * Resolve the signup row an approval must target. Signup rows SHIFT under an open panel: a form submission's
 * installable sync re-sorts the review tab (Pending → Approved → Processed), so the row number the client saw can
 * hold a DIFFERENT applicant by the time the admin clicks. Same TOCTOU defence as cpResolveMemberRow_ (F-002/F-027):
 *   • ID still at that row → use it  • ID moved → relocate by ID  • ID gone → throw  • no ID (legacy) → row as-is.
 * Must be called INSIDE the script lock so the resolved row can't shift again before the write.
 */
function signupResolveRow_(signups, row, expectedId) {
  const want = String(expectedId == null ? '' : expectedId).trim();
  const r = Number(row);
  if (want === '') return r; // legacy payload — no identity to verify
  const SC = signupCols_(signups);
  if (SC.discord) {
    const last = signups.getLastRow();
    if (r >= SC.dataStart && r <= last) {
      const here = String(signups.getRange(r, SC.discord).getDisplayValue()).trim();
      if (here === want) return r;
    }
    if (last >= SC.dataStart) {
      const ids = signups.getRange(SC.dataStart, SC.discord, last - SC.dataStart + 1, 1).getDisplayValues();
      for (let i = 0; i < ids.length; i++) { if (String(ids[i][0]).trim() === want) return SC.dataStart + i; }
    }
  }
  throw new Error('That signup has moved or changed since the panel loaded — refresh and try again.');
}

/** Panel endpoint: approve a signup into a chosen open slot (adds the member, copies PII, stamps Processed). */
function cpSignupApprove(payload) {
  const file = adminFile_();
  if (!file) throw new Error('No admin file is linked yet.');
  const sh = file.getSheetByName(CONFIG.sheets.signups);
  if (!sh) throw new Error(`"${CONFIG.sheets.signups}" was not found in the admin file — create/link your signups review tab first (⚙️ Engine Settings ▸ Sheets & layout).`);
  const roster = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster);
  if (!roster) throw new Error(`The roster tab "${CONFIG.sheets.roster}" was not found.`);
  const row = Number((payload && payload.row) || 0), slotRow = Number((payload && payload.slotRow) || 0);
  if (!(row >= 2)) throw new Error('Pick a signup to approve.');
  if (!(slotRow >= CONFIG.rosterStartRow)) throw new Error('Pick an open slot to place them in.');
  // INTERACTIVE-FIRST: stamp the publisher's backoff BEFORE waiting, so no NEW publish pass starts while this seat
  // queues — a full pass can hold the shared lock for tens of seconds, which is exactly the "Another roster operation
  // is running" collision. The in-flight pass finishes inside the 30s wait and the lock falls to us (same pattern as
  // cpWithLock_ / runAction_ / transfers — this endpoint was the one interactive writer missing the stamp).
  try { PropertiesService.getDocumentProperties().setProperty(PUBLISH_BACKOFF_PROP_, String(Date.now() + PUBLISH_BACKOFF_MS_)); } catch (e) { /* best-effort priority hint */ }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another roster operation is running — try again in a moment.');
  let res;
  try {
    const vr = signupResolveRow_(sh, row, String((payload && payload.id) || '')); // the queue re-sorts under an open panel — verify identity first
    res = approveSignup_(sh, vr, roster, slotRow, (payload && payload.edits) || null);
    try { sortSignups_(sh); } catch (e) { log_('cpSignupApprove.sort', e); }
  } finally { lock.releaseLock(); }
  // AFTER the lock: the audit mirror can fire a Discord webhook (a network call) — holding the shared lock through it
  // slowed every seat and starved concurrent operations for no reason.
  try { cpAudit_('signup-approved', '', res.name, `row ${slotRow}`, res.name); } catch (e) { /* audit is best-effort */ } // also marks the public copy dirty
  // Seating changes the assignment/group bands, the Academy (cadet ranks) and the welcome-page counts — but rebuilding
  // ALL of that here kept the admin staring at "Seating…" for the whole pass. QUEUE the work and return NOW: the panel
  // immediately fires cpSignupPostSeat in the background (targeted refresh, no spinner), and the 1-minute sweep's full
  // drain remains the guaranteed backstop if that background call is ever cut short.
  try { if (typeof deferWork_ === 'function') { deferWork_('academy'); deferWork_('groups'); deferWork_('dashboard'); } } catch (ig) { /* queue is best-effort */ }
  return res;
}

/**
 * Panel endpoint, fired in the BACKGROUND right after a successful seat: refresh the derived tabs for the just-seated
 * member without making the admin wait. buildGroupSheets_ gets a HINT (the seated roster row) so only the assignment
 * tab(s) they actually joined rebuild — not all of them; Academy + dashboard are single passes. The deferred queue is
 * left SET on purpose: the sweep's full drain backstops any miss, and the upserts are idempotent so the overlap is
 * harmless.
 */
function cpSignupPostSeat(payload) {
  const slotRow = Number((payload && payload.slotRow) || 0);
  const roster = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster);
  let hint = null;
  try {
    if (roster && slotRow >= CONFIG.rosterStartRow) {
      hint = { rowVals: roster.getRange(slotRow, 1, 1, roster.getLastColumn()).getDisplayValues()[0], editedCol: 0, oldVal: '' }; // editedCol 0 → membership judged purely on the row's CURRENT values
    }
  } catch (e) { hint = null; /* unreadable row → full rebuild below */ }
  try { if (typeof buildAcademySheets_ === 'function') buildAcademySheets_(); } catch (e) { log_('cpSignupPostSeat.academy', e); }
  try { if (typeof buildGroupSheets_ === 'function') buildGroupSheets_(hint); } catch (e) { log_('cpSignupPostSeat.groups', e); }
  try { if (typeof refreshDashboard_ === 'function') refreshDashboard_(); } catch (e) { log_('cpSignupPostSeat.dashboard', e); }
  return { ok: true };
}

/**
 * Panel: put removed entries BACK. Newest-first order is restored by timestamp, so an undone removal lands
 * where it was rather than at the top.
 */
function cpPromoRestore(payload) {
  const entries = (payload && Array.isArray(payload.entries)) ? payload.entries : [];
  if (!entries.length) return { ok: true, restored: 0 };
  const P = PropertiesService.getDocumentProperties();
  let list; try { list = JSON.parse(P.getProperty(PROMO_STORE_PROP_) || '[]'); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  const have = {};
  list.forEach((x) => { have[String(x.t) + '|' + String(x.n || '')] = true; });
  let added = 0;
  entries.forEach((e) => {
    const key = String(e.t) + '|' + String(e.name || '');
    if (have[key]) return;                                   // already back — undo pressed twice
    list.push({ t: Number(e.t) || 0, n: String(e.name || ''), r: String(e.rank || '') });
    have[key] = true; added++;
  });
  list.sort((a, b) => Number(b.t) - Number(a.t));
  if (list.length > PROMO_MAX_) list.length = PROMO_MAX_;
  P.setProperty(PROMO_STORE_PROP_, JSON.stringify(list));
  try { renderPromotions_(true); } catch (e) { log_('cpPromoRestore.render', e); }
  try { if (typeof publishMarkDirty_ === 'function') publishMarkDirty_(); } catch (ig) {}
  try { cpAudit_('action', '', 'Restored ' + added + ' promotions-feed entr' + (added === 1 ? 'y' : 'ies'), '', ''); } catch (e) { /* best-effort */ }
  return { ok: true, restored: added, left: list.length };
}

/** Panel: the RECENT PROMOTIONS feed entries (the RE_PROMOS document-property store, newest first). */
function cpPromoList() {
  let list; try { list = JSON.parse(PropertiesService.getDocumentProperties().getProperty(PROMO_STORE_PROP_) || '[]'); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  return list.map((p, i) => ({ i: i, t: Number(p.t) || 0, when: p.t ? fmtDisplay_(new Date(Number(p.t))) : '', name: String(p.n || ''), rank: String(p.r || '') }));
}

/** Panel: remove ONE promotions-feed entry — matched by index + timestamp + name so a promotion recorded while the
 *  panel sat open can't shift the wrong row out — then repaint every RECENT PROMOTIONS table (the removed row blanks). */
function cpPromoRemove(payload) {
  const P = PropertiesService.getDocumentProperties();
  let list; try { list = JSON.parse(P.getProperty(PROMO_STORE_PROP_) || '[]'); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];

  // Batch form: {entries:[{t,name}, …]} — matched on identity, because indices shift as soon as one is spliced.
  const batch = (payload && Array.isArray(payload.entries)) ? payload.entries : null;
  if (batch) {
    const want = {};
    batch.forEach((e) => { want[String(e.t) + '|' + String(e.name || '')] = true; });
    const kept = list.filter((x) => !want[String(x.t) + '|' + String(x.n || '')]);
    const gone = list.length - kept.length;
    if (!gone) throw new Error('Those entries are no longer in the feed — it will reload.');
    P.setProperty(PROMO_STORE_PROP_, JSON.stringify(kept));
    try { renderPromotions_(true); } catch (e) { log_('cpPromoRemove.render', e); }
    try { if (typeof publishMarkDirty_ === 'function') publishMarkDirty_(); } catch (ig) {}
    try { cpAudit_('action', '', 'Removed ' + gone + ' promotions-feed entr' + (gone === 1 ? 'y' : 'ies'), '', ''); } catch (e) { /* best-effort */ }
    return { ok: true, removed: gone, left: kept.length };
  }

  const idx = Number(payload && payload.index);
  const p = list[idx];
  if (!p || String(p.t) !== String(payload && payload.t) || String(p.n || '') !== String((payload && payload.name) || '')) {
    throw new Error('The promotions feed changed since the panel loaded — it will reload; try again.');
  }
  list.splice(idx, 1);
  P.setProperty(PROMO_STORE_PROP_, JSON.stringify(list));
  try { renderPromotions_(true); } catch (e) { log_('cpPromoRemove.render', e); }         // repaint every feed table now
  try { if (typeof publishMarkDirty_ === 'function') publishMarkDirty_(); } catch (ig) {} // the public Welcome Page mirrors it
  try { cpAudit_('action', '', `Removed promotions-feed entry: ${p.n} → ${p.r}`, '', p.n); } catch (e) { /* best-effort */ }
  return { ok: true, removed: p.n, left: list.length };
}

/* ----------------------------------------------------------------------------
 * Small server helpers
 * ------------------------------------------------------------------------- */

function cpRoster_() {
  const r = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster);
  if (!r) throw new Error(`Roster tab "${CONFIG.sheets.roster}" not found.`);
  return r;
}

function cpAssertSlotRow_(roster, row) {
  if (!(row >= CONFIG.rosterStartRow)) throw new Error('Invalid row.');
  const rank = String(roster.getRange(row, rosterCols_(roster).rank).getDisplayValue()).trim();
  if (!isMemberSlot_(rank) || rank === '' || rank === 'Rank') throw new Error(`Row ${row} is not a member slot.`);
}

/** First roster row (1-based) whose Discord ID matches, or -1. Uses display values (exact 17-19 digit text). */
function cpFindRowById_(roster, id) {
  const want = String(id == null ? '' : id).trim();
  if (want === '') return -1;
  const last = roster.getLastRow();
  if (last < CONFIG.rosterStartRow) return -1;
  const ids = roster.getRange(CONFIG.rosterStartRow, rosterCols_(roster).discord, last - CONFIG.rosterStartRow + 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) { if (String(ids[i][0]).trim() === want) return CONFIG.rosterStartRow + i; }
  return -1;
}

/**
 * Resolve the row a panel write must target, defending against the TOCTOU class where a concurrent row
 * insert/delete shifts members between the client's snapshot and the write, landing it on the WRONG member
 * (F-002/F-027). The client sends BOTH the displayed row AND the Discord ID it belonged to:
 *   • ID still at that row  → use it (fast path).
 *   • ID moved             → relocate by ID (authoritative) — the sheet is the source of truth.
 *   • ID gone              → throw; the caller must refresh.
 *   • no ID (older client) → slot-validate only (legacy behavior, unchanged).
 * Must be called INSIDE cpWithLock_ so the resolved row can't shift again before the write.
 * @return {number} the verified 1-based row that currently holds expectedId.
 */
function cpResolveMemberRow_(roster, row, expectedId) {
  const want = String(expectedId == null ? '' : expectedId).trim();
  const r = Number(row);
  if (want === '') { cpAssertSlotRow_(roster, r); return r; } // legacy client — no identity to verify
  if (r >= CONFIG.rosterStartRow && r <= roster.getLastRow()) {
    const here = String(roster.getRange(r, rosterCols_(roster).discord).getDisplayValue()).trim();
    if (here === want) { cpAssertSlotRow_(roster, r); return r; }
  }
  const found = cpFindRowById_(roster, want);
  if (found === -1) throw new Error('That member has moved or been removed since the panel loaded — refresh and try again.');
  cpAssertSlotRow_(roster, found);
  return found;
}

function cpAssertUniqueId_(roster, discord, exceptRow) {
  const last = roster.getLastRow();
  if (last < CONFIG.rosterStartRow) return;
  const n = last - CONFIG.rosterStartRow + 1;
  const ids = roster.getRange(CONFIG.rosterStartRow, rosterCols_(roster).discord, n, 1).getDisplayValues();
  for (let i = 0; i < n; i++) {
    if (CONFIG.rosterStartRow + i === exceptRow) continue;
    if (String(ids[i][0]).trim() === discord) {
      throw new Error(`That Discord ID already exists on row ${CONFIG.rosterStartRow + i}.`);
    }
  }
}

function cpMemberAt_(roster, row) {
  const RC = rosterCols_(roster);
  const b = roster.getRange(row, 1, 1, roster.getLastColumn()).getDisplayValues()[0];
  const at = (c) => String(b[c - 1] || '').trim();
  const name = at(RC.name);
  return {
    row,
    rank: at(RC.rank),
    name,
    callsign: at(RC.unit),
    discord: at(RC.discord),
    joinDate: at(RC.join),
    lastPromo: at(RC.promo),
    status: at(RC.activity),
    hours: at(RC.hours),
    color: String(roster.getRange(row, RC.rank).getBackground() || '').trim(),
    filled: name !== '',
  };
}
