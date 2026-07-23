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
  cpJumpTo: (row) => cpJumpTo(row),
  cpSystemInfo: () => cpSystemInfo(),
  cpColumnsInfo: () => cpColumnsInfo(),
  cpSetColumnClass: (header, klass) => cpSetColumnClass(header, klass),
  cpDividersInfo: () => cpDividersInfo(),
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
  cpSetDividerStyle: (label, style) => cpSetDividerStyle(label, style),
  cpDeleteDividerStyle: (label) => cpDeleteDividerStyle(label),
  cpAdminSetup: (p) => cpAdminSetup(p),
  cpAdminInfo: (id) => cpAdminInfo(id),
  cpAddDiscipline: (p) => cpAddDiscipline(p),
  cpSignupList: () => cpSignupList(),
  cpSignupApprove: (p) => cpSignupApprove(p),
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

/** Panel: send a test to each listed channel that has a webhook. @return {ok, tested:[], missing:[]}. */
function cpTestWebhookChannels(channels) {
  const chans = webhookChannelList_(channels);
  if (!chans.length) throw new Error('Pick at least one channel to test.');
  const tested = [], missing = [];
  chans.forEach((c) => { try { cpTestWebhook(c); tested.push(c); } catch (e) { missing.push(c); } }); // cpTestWebhook throws when a channel has no URL
  if (!tested.length) throw new Error('None of the selected channels have a webhook yet — save one first.');
  return { ok: true, tested: tested, missing: missing };
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
const CP_SETTINGS_KV_ = Object.freeze(['SYSTEM', 'SHEETS', 'ROSTER_LAYOUT', 'LEAVE', 'DISCORD', 'NOTIFICATIONS', 'PATROL', 'FORMATS', 'SCHEDULE', 'LOGGING', 'LIMITS', 'THEME', 'DASHBOARD']);
const CP_SETTINGS_TABLES_ = Object.freeze(['STATUSES', 'STATUS_OVERRIDES', 'STATUS_RULES', 'RANKS', 'SECTION_TAGS', 'DASHBOARD_GROUPS', 'DASHBOARD_CELLS', 'FORM_MAP', 'SECTIONS', 'EMBEDS']);
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
  SpreadsheetApp.getUi().showModalDialog(html, '⚙️ Engine Settings');
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
      const fromSheet = Object.prototype.hasOwnProperty.call(have, key);
      keys.push({
        key, t: k.t, def, req: !!k.req, help: k.help || '',
        min: (k.min != null ? k.min : null), max: (k.max != null ? k.max : null),
        options: k.enum ? k.enum.slice() : null,
        value: fromSheet ? String(have[key]) : def,
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
    sheetNames: s.getSheets().map((x) => x.getName()).filter((n) => n.indexOf('🧪') !== 0 && n.indexOf('_') !== 0),
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
    // setTableRows_ pads/truncates to the 5-column grid — refuse rows carrying non-empty data beyond it rather than silently dropping it.
    (tableChanges[name] || []).forEach((r) => {
      if (Array.isArray(r) && r.length > 5 && r.slice(5).some((x) => String(x == null ? '' : x).trim() !== '')) {
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
  kvChanges.forEach((c) => { setKvValue_(configSheet, c.block, c.key, String(c.value == null ? '' : c.value)); });
  Object.keys(tableChanges).forEach((name) => { setTableRows_(configSheet, name, tableChanges[name]); });
  cfgInvalidate_();
  SpreadsheetApp.flush();
  return {
    ok: true,
    problems: v.problems.filter((x) => x.sev === 'WARN').map((x) => ({ sev: x.sev, code: x.code, key: x.key, value: String(x.value == null ? '' : x.value), expected: x.expected || '' })),
    written: { kv: kvChanges.length, tables: Object.keys(tableChanges).length },
  };
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
    leaveTypes: CONFIG.leaveTypes.slice(),                                       // the [LEAVE].LEAVE_TYPES list — drives the schedule-leave dropdown
    addCols: { ooc: !!RCadd.ooc, shift: !!RCadd.shift },                         // which optional columns the Add-member form should offer

    members: snap.members,
    stats: snap.stats,
    updatedAt: snap.updatedAt,
    rankIcons: {},                                                              // PERF: icons are heavy base64 — the panel lazy-loads them via cpRankIcons right after first paint (initials show for a beat)
    adminRoster: cpAdminStatus_(),                                              // { linked, access, url } — access is per-USER (Google ACL), so each opener sees their own answer
    health: (typeof cpHealthCheck_ === 'function') ? cpHealthCheck_() : null, // null if RosterTrust.gs not pasted
  };
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

  const roster = ss.getSheetByName(CONFIG.sheets.roster);
  if (roster) {
    const last = roster.getLastRow();
    if (last >= CONFIG.rosterStartRow) {
      const n = last - CONFIG.rosterStartRow + 1;
      const RC = rosterCols_(roster);
      const block = roster.getRange(CONFIG.rosterStartRow, 1, n, roster.getLastColumn()).getDisplayValues(); // full width; index by RC (col-1)
      const rankBg = roster.getRange(CONFIG.rosterStartRow, RC.rank, n, 1).getBackgrounds(); // real rank colors
      for (let i = 0; i < n; i++) {
        const rank = String(block[i][RC.rank - 1]).trim();
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
  if (!lock.tryLock(10000)) throw new Error('Another roster change is in progress — try again in a moment.');
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
    title: fill_(CONFIG.notify.memberAddedTitle, { name: seated.name }),
    color: hexToInt_(CONFIG.notify.memberAddedColor, 5749594),
    fields: [
      { name: '👤 Name', value: clamp_(dash_(seated.name), 1000), inline: true },
      { name: '🛡️ Rank', value: clamp_(dash_(withIcon_(seated.rank)), 1000), inline: true },
      { name: '🎙️ Callsign', value: clamp_(dash_(seated.callsign), 1000), inline: true },
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
  roster.getRange(row, RC.activity).setValue(CONFIG.tierNames.length ? CONFIG.tierNames[CONFIG.tierNames.length - 1] : 'Inactive'); // seat at the lowest tier
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
  const wiped = moveMemberColumns_(roster, fromRow, toRow);
  return { name: name, discord: discord, fromRank: fromRank, toRank: toRank, wiped: wiped, member: cpMemberAt_(roster, toRow) };
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
    title: fill_(CONFIG.notify.transferTitle, { name: res.name, from: res.fromRank, to: res.toRank }),
    color: hexToInt_(CONFIG.notify.transferColor, 5793266),
    fields: [
      { name: '👤 Name', value: clamp_(dash_(res.name), 1000), inline: true },
      { name: '↗️ From', value: clamp_(dash_(withIcon_(res.fromRank)), 1000), inline: true },
      { name: '🛡️ To', value: clamp_(dash_(withIcon_(res.toRank)), 1000), inline: true },
    ],
  }, mention_(res.discord));
  return { moved: true, name: res.name, fromRank: res.fromRank, toRank: res.toRank, wiped: res.wiped, toRow: res.member.row, member: res.member };
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

function cpRunAction(name) {
  const msg = cpRunActionCore_(name);
  cpAudit_('action', '', msg, '', '');
  return msg;
}
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
    case 'fixUnits': {
      updateUnitNumbers_();
      return 'Callsign / unit numbers renumbered.';
    }
    case 'checkDuplicates':
      return cpDuplicateReport_();
    default:
      throw new Error(`Unknown action: ${name}`);
  }
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

/**
 * Injectable core: every SECTION DIVIDER the roster contains, the member/slot counts of the section each one
 * heads, AND the roster of members in it (for the panel's expandable rows). Read-only / informational —
 * auto-discovers dividers the same way isValidMemberValues_ does (an all-caps rank label > 3 chars, via
 * isDividerValue_), and flags training sections via isTrainingDividerLabel_. Scans from the row right under the
 * header (ROSTER_HEADER_ROW + 1) so a divider in the gap above rosterStartRow (e.g. one merged into row 6) is
 * still caught. "members" = filled member rows under the divider (until the next divider or the end); "slots" =
 * numberable slots in that span (filled + open); "people" = those filled members; "category" = the informational
 * section type ({label,tone}) for the colored tag, or null if the label matches no CONFIG.sectionCategories entry.
 * @return {Array<{row,cell,label,training,category,members,slots,people:Array<{rank,name,status,row}>}>}
 */
function cpDividersInfo_(roster) {
  const RC = rosterCols_(roster);
  const scanStart = ROSTER_HEADER_ROW + 1; // dividers can sit in the row directly under the header, above rosterStartRow
  const n = Math.max(0, roster.getLastRow() - scanStart + 1);
  if (!n) return [];
  const block = roster.getRange(scanStart, 1, n, roster.getLastColumn()).getDisplayValues();
  const letterOf = (c) => (typeof cpColLetter_ === 'function') ? cpColLetter_(c) : String(c);
  const found = [];
  for (let i = 0; i < n; i++) {
    const rank = String(block[i][RC.rank - 1]).trim();
    if (!isDividerValue_(rank)) continue;
    const row = scanStart + i;
    found.push({ idx: i, row, cell: letterOf(RC.rank) + row, label: rank, training: isTrainingDividerLabel_(rank), category: sectionCategory_(rank) });
  }
  // Walk the members/slots under each divider (its rows run until the next divider, or the sheet end).
  return found.map((d, k) => {
    const endI = (k + 1 < found.length) ? found[k + 1].idx : n;
    const people = [];
    let slots = 0;
    for (let i = d.idx + 1; i < endI; i++) {
      const rank = String(block[i][RC.rank - 1]).trim();
      const name = String(block[i][RC.name - 1]).trim();
      if (isMemberSlot_(rank)) slots++;
      if (isValidMemberValues_(rank, name)) {
        people.push({ rank, name, status: String(block[i][RC.activity - 1]).trim(), row: scanStart + i });
      }
    }
    return { row: d.row, cell: d.cell, label: d.label, training: d.training, category: d.category, members: people.length, slots, people };
  });
}

/** Panel read: every section divider in the roster with the member/slot counts of the section it heads, plus any per-divider pill/icon overrides. */
function cpDividersInfo() {
  const roster = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.roster);
  if (!roster) return { dividers: [], total: 0, error: `Roster tab "${CONFIG.sheets.roster}" not found.`, styles: {} };
  const dividers = cpDividersInfo_(roster);
  return { dividers, total: dividers.length, styles: divStyleMap_() };
}

/* ----------------------------------------------------------------------------
 * DIVIDER STYLES (v1.3.4) — per-divider pill (label + colour tone) + icon overrides,
 * edited on the Control Panel's Dividers page. Stored in DOCUMENT PROPERTIES keyed by
 * the divider label (never the sheet), so they persist without slowing the document.
 * Purely cosmetic — the panel's Dividers view uses them; keyword auto-detection is the
 * fallback for anything not customised.
 * ------------------------------------------------------------------------- */
const DIVSTYLE_PREFIX_ = 'DIVSTYLE:';

/** { dividerLabel: {pill, tone, icon} } for every stored override. */
function divStyleMap_() {
  const all = PropertiesService.getDocumentProperties().getProperties();
  const map = {};
  Object.keys(all).forEach((k) => {
    if (k.indexOf(DIVSTYLE_PREFIX_) !== 0) return;
    let label; try { label = decodeURIComponent(k.slice(DIVSTYLE_PREFIX_.length)); } catch (e) { return; }
    let v; try { v = JSON.parse(all[k]); } catch (e) { return; }
    if (label && v && typeof v === 'object') map[label] = { pill: String(v.pill || ''), tone: String(v.tone || ''), icon: String(v.icon || '') };
  });
  return map;
}

/** Panel endpoint: set a divider's pill (label + colour tone) + icon. Tone/icon are restricted to safe key charsets (the panel maps them to CSS vars / icon lookups). */
function cpSetDividerStyle(label, style) {
  label = String(label == null ? '' : label).trim();
  if (!label) throw new Error('A divider label is required.');
  style = style || {};
  const clean = {
    pill: clamp_(String(style.pill == null ? '' : style.pill).trim(), 40),
    tone: /^[a-z]{2,12}$/.test(String(style.tone || '')) ? String(style.tone) : 'aux',   // must be a bare token — becomes a CSS var name in the panel
    icon: /^[a-z0-9]{2,16}$/.test(String(style.icon || '')) ? String(style.icon) : 'person',
  };
  PropertiesService.getDocumentProperties().setProperty(DIVSTYLE_PREFIX_ + encodeURIComponent(label), JSON.stringify(clean));
  return { ok: true, label: label, style: clean };
}

/** Panel endpoint: clear a divider's override (revert to keyword auto-detection). */
function cpDeleteDividerStyle(label) {
  label = String(label == null ? '' : label).trim();
  if (label) PropertiesService.getDocumentProperties().deleteProperty(DIVSTYLE_PREFIX_ + encodeURIComponent(label));
  return { ok: true, label: label };
}

/* ----------------------------------------------------------------------------
 * ADMIN ROSTER (v1.0) — a SEPARATE, admin-only spreadsheet for sensitive
 * member data (email, DOB, private notes, disciplinary history), linked to the
 * roster by Discord ID.
 *
 * SECURITY MODEL: panel dialogs execute AS the person who opened them, so every
 * admin read/write goes through SpreadsheetApp.openById(...) under THAT user's
 * Google permissions — Google's file-level ACL is the gate, not UI hiding. A
 * non-admin invoking these endpoints (even directly via dispatch) gets Google's
 * permission error, never data. The file ID lives in Document Properties (not a
 * secret — access is enforced by Google — but kept out of viewer-readable cells).
 * HARD RULE: admin data NEVER touches the main spreadsheet — no cells, no Edit
 * Log entries (cpAudit_ is deliberately not called here), no property caching.
 * ------------------------------------------------------------------------- */

const ADMIN_SHEET_PROP_ = 'ADMIN_ROSTER_ID';
const ADMIN_LOG_TAB_ = 'Disciplinary Log';

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
  return { linked: true, access: true, url: url, linkedBy: '', linkedAt: '', selfHosted: true };
}

/**
 * Ensure the two admin tabs exist with headers, '@' ID columns and the console theme. Idempotent.
 * SCALABLE FIELDS: on Member Details only the first TWO columns are fixed (Discord ID = the key, Name = auto-filled);
 * every column an admin adds after them becomes a private field that the panel discovers from this header row and
 * renders automatically — the field schema lives IN the admin file (so even the field NAMES stay non-public).
 * A hand-made tab whose fixed prefix doesn't match is refused (reads/writes would misread or clobber it).
 */
function seedAdminSheet_(file) {
  const mk = (name, headers, idCol, fixedPrefix) => {
    let sh = file.getSheetByName(name);
    if (!sh) sh = file.insertSheet(name);
    if (sh.getLastRow() === 0) sh.appendRow(headers);
    else {
      const need = headers.slice(0, fixedPrefix || headers.length);
      const have = sh.getRange(1, 1, 1, need.length).getDisplayValues()[0].map((h) => norm_(h));
      const ok = need.every((h, i) => have[i] === norm_(h));
      if (!ok) throw new Error(`The "${name}" tab exists but its ${fixedPrefix ? 'first ' + fixedPrefix + ' columns' : 'columns'} don't match (expected: ${need.join(' | ')}${fixedPrefix ? ' | …your own field columns' : ''}). Fix its header row, rename that tab, or link a different file.`);
    }
    const width = Math.max(sh.getLastColumn(), headers.length);
    sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground(theme_('BANNER')).setFontColor(theme_('TEXT_STRONG'));
    sh.getRange(1, idCol, sh.getMaxRows(), 1).setNumberFormat('@'); // 17-19 digit IDs stay exact text
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  };
  mk(ADMIN_LOG_TAB_, ['Date', 'Discord ID', 'Name', 'Action', 'Reason', 'Issued By', 'Status'], 2);
  ensureWebhookTab_(file);        // per-channel Discord webhooks live here too — the file's ACL gates them
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

const SIGNUP_STATUSES_ = Object.freeze(['Pending', 'Approved', 'Processed']);

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
    const roles = ['name', 'ooc', 'discord', 'email', 'dob', 'phone', 'join'];
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
      if (at > signupSheet.getMaxRows()) signupSheet.insertRowsAfter(signupSheet.getMaxRows(), at - signupSheet.getMaxRows());
      writeValuesSafe_(signupSheet, at, 1, [rowVals], null); // merge-safe row write
      signupSheet.getRange(at, sSC.discord).setNumberFormat('@'); // keep the Unique ID exact
      formSheet.getRange(i + 2, 1, 1, width).setBackground(CONFIG.bg.done); // mark this form row synced
      added++;
    }
    if (added) { try { sortSignups_(signupSheet); } catch (e) { log_('syncSignupForm_.sort', e); } }
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
      sh.getRange(SC.dataStart, SC.status, n, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(SIGNUP_STATUSES_.slice(), true).setAllowInvalid(true).setHelpText('Pending → Approved → Processed').build());
      if (SC.discord) sh.getRange(SC.dataStart, SC.discord, n, 1).setNumberFormat('@'); // keep the Unique ID exact
    }
  } catch (e) { log_('ensureSignupTab_.validation', e); }
  return sh;
}

/** Stamp blank statuses as Pending, then re-group Pending → Approved → Processed (value rewrite; keeps formatting). */
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
    const rank = {}; SIGNUP_STATUSES_.forEach((s, i) => { rank[norm_(s)] = i; });
    const dec = rows.map((r, i) => ({ r: r, i: i, p: (norm_(String(r[SC.status - 1] || '').trim()) in rank) ? rank[norm_(String(r[SC.status - 1]).trim())] : SIGNUP_STATUSES_.length }));
    dec.sort((a, b) => (a.p - b.p) || (a.i - b.i)); // stable
    const sorted = dec.map((d) => d.r);
    if (SC.discord) sheet.getRange(ds, SC.discord, sorted.length, 1).setNumberFormat('@');
    writeValuesSafe_(sheet, ds, 1, sorted, null); // merge-safe (see sortTracker_)
    if (last > ds + sorted.length - 1) { // survivors slid up → blank the rows they vacated so nothing is duplicated at the bottom
      const blanks = []; for (let k = ds + sorted.length; k <= last; k++) blanks.push(new Array(W).fill(''));
      writeValuesSafe_(sheet, ds + sorted.length, 1, blanks, null);
    }
    return sorted.length;
  } catch (e) { logWarn_('sortSignups_', 'signup sort failed: ' + ((e && e.message) ? e.message : e)); return 0; }
}

/** Read the signup rows an admin still has to act on (Pending + Approved), newest submission first. */
function signupQueue_(sheet, cap) {
  const out = [];
  const SC = signupCols_(sheet);
  const last = sheet.getLastRow();
  if (!SC.status || last < SC.dataStart) return out;
  const n = last - SC.dataStart + 1;
  const vals = sheet.getRange(SC.dataStart, 1, n, SC.width).getDisplayValues();
  for (let i = 0; i < n && out.length < (cap || 100); i++) {
    const g = (c) => c ? String(vals[i][c - 1] || '').trim() : '';
    if (!g(SC.name) && !g(SC.discord)) continue; // blank scaffolding row on a themed tab → not a submission
    const st = g(SC.status) || SIGNUP_STATUSES_[0];
    if (norm_(st) === norm_(SIGNUP_STATUSES_[2])) continue; // Processed → done
    out.push({ row: SC.dataStart + i, status: st, name: g(SC.name), ooc: g(SC.ooc), discord: g(SC.discord),
      email: g(SC.email), dob: g(SC.dob), phone: g(SC.phone), join: g(SC.join), submitted: g(SC.timestamp) });
  }
  return out;
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
function approveSignup_(signups, row, roster, slotRow) {
  const SC = signupCols_(signups);
  if (!SC.discord || !SC.name) throw new Error('The signup tab has no Unique ID / Name column.');
  const g = (c) => c ? String(signups.getRange(row, c).getDisplayValue()).trim() : '';
  const id = g(SC.discord), name = g(SC.name);
  if (!isValidId_(id)) throw new Error(`Signup row ${row} has no valid Unique ID (${idDigitsLabel_()} digits).`);
  if (!name) throw new Error(`Signup row ${row} has no name.`);
  if (cpFindRowById_(roster, id) !== -1) throw new Error(`${name} is already on the roster — mark this signup Processed instead.`);

  cpAssignMember_(roster, { row: slotRow, name: name, discord: id }); // reuses the panel's slot guard + validation
  const RC = rosterCols_(roster);
  if (RC.ooc && g(SC.ooc)) roster.getRange(slotRow, RC.ooc).setValue(g(SC.ooc));
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
    try { if (typeof deferWork_ === 'function') { deferWork_('academy'); deferWork_('groups'); } } catch (ig) {} // rebuild derived tabs on the sweep
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

/** Tabs that are NEVER mirrored, even if a same-named tab somehow exists in the public file. */
function publishTabBlocked_(name) {
  const n = norm_(name);
  if (!n) return true;
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
 * Injectable core: mirror ONE tab into the public copy. Columns are matched BY HEADER, so the public tab keeps its own
 * layout and only receives the columns it actually has — delete a column there and it simply stops being populated.
 * Sensitive headers are never written and are wiped if present. Values only, so formatting survives. @return rows copied.
 */

/**
 * Write a 2D block into `dest` at (top,left) WITHOUT spanning merged cells. A plain setValues over a range containing
 * merges fails with Sheets' generic "Service error: Spreadsheets", and these layouts are full of merged banners/boxes.
 * Merge-free row spans are written in ONE call (so the bulk stays fast); rows containing merges are written as runs,
 * skipping every cell that is inside a merge but is not its top-left (the only writable cell of a merge).
 */
/** [PUBLISH].KEEP_RANGES parsed into { normalisedTabName: ['F6:W7', ...] }. '*' applies to every tab. */
/**
 * Read a range as values but with FORMULAS PRESERVED: a source cell holding a formula yields the formula text, which
 * setValues re-creates as a live formula on the public copy. Without this a "=TEXT(NOW(),...)" clock publishes as the
 * frozen string it happened to evaluate to. Self-referential formulas (the tracker's LENGTH / TIME LEFT) therefore keep
 * recalculating publicly instead of going stale between publishes.
 */
function publishReadCells_(range) {
  const v = range.getValues(), f = range.getFormulas();
  for (let r = 0; r < v.length; r++) {
    for (let c = 0; c < v[r].length; c++) {
      const fx = String(f[r][c] == null ? '' : f[r][c]);
      if (fx !== '') v[r][c] = fx;
    }
  }
  return v;
}

/**
 * True when the destination tab COMPUTES ITSELF from other tabs — i.e. it holds a formula referencing another sheet
 * (the shift tabs and Police Academy are FILTER/ARRAY_CONSTRAIN views over 'Member Information').
 *
 * Such tabs must not be published into. Their array formulas SPILL, and writing the source's spilled values into that
 * spill range blocks it, which Sheets reports as #REF!. Left alone they rebuild themselves from the public copy of the
 * tab they reference, which the publish does populate — so they stay correct with no work at all.
 */
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

function publishKeepRanges_() {
  const out = {};
  const add = (spec) => {
    const t = String(spec).trim(); if (!t) return;
    const i = t.lastIndexOf('!'); if (i < 1) return;
    const tab = norm_(t.slice(0, i).replace(/^'|'$/g, '')), a1 = t.slice(i + 1).trim();
    if (!a1) return;
    const list = (out[tab] = out[tab] || []);
    if (list.indexOf(a1) === -1) list.push(a1);
  };
  // BUILT-IN: the title blocks that are meant to read differently in the two files. These are applied even when the
  // operator's Config tab already carries a KEEP_RANGES row (a stored row overrides the schema default, so relying on
  // the default alone silently did nothing). Config entries ADD to these rather than replacing them.
  ['Welcome Page!F6:W7', (CONFIG.sheets.roster || 'Member Information') + '!D3:H3'].forEach(add); // roster tab name follows the [SHEETS] rename
  try { (cfg_().kv.PUBLISH.KEEP_RANGES || []).forEach(add); } catch (e) { /* config absent -> built-ins only */ }
  return out;
}

/**
 * Cells on the PUBLIC copy that publishing must leave alone:
 *   1. any cell holding a FORMULA — the public sheet's own live date/time/counters must keep recalculating, and
 *      copying the internal sheet's computed value would freeze them as plain text;
 *   2. anything listed in [PUBLISH].KEEP_RANGES for this tab (static text that is meant to differ, e.g. the title).
 */
function publishKeepMask_(dest, top, left, rows, cols) {
  const mask = [];
  for (let r = 0; r < rows; r++) mask.push(new Array(cols).fill(false));
  try {
    const f = dest.getRange(top, left, rows, cols).getFormulas();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (String(f[r][c] || '').trim() !== '') mask[r][c] = true;
  } catch (e) { /* best-effort */ }
  const all = publishKeepRanges_();
  (all[norm_(dest.getName())] || []).concat(all['*'] || []).forEach((a1) => {
    try {
      const rg = dest.getRange(a1);
      const r0 = rg.getRow() - top, c0 = rg.getColumn() - left;
      for (let r = Math.max(0, r0); r < Math.min(rows, r0 + rg.getNumRows()); r++) {
        for (let c = Math.max(0, c0); c < Math.min(cols, c0 + rg.getNumColumns()); c++) mask[r][c] = true;
      }
    } catch (e) { logWarn_('publishKeepMask_', dest.getName() + ': cannot resolve keep-range "' + a1 + '"'); }
  });
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

function publishMirrorTab_(src, dest) {
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
    if (sRows > dest.getMaxRows()) step('insertRows ' + (sRows - dest.getMaxRows()), () => dest.insertRowsAfter(dest.getMaxRows(), sRows - dest.getMaxRows()));
    const vals = step('read src ' + sRows + 'x' + sCols, () => publishReadCells_(src.getRange(1, 1, sRows, sCols)));
    // NEVER transmit a sensitive column: blank it in the outgoing block BEFORE the write. Writing first and wiping
    // after left every member's Email/DOB/Phone live on the public file between the two calls — and permanently so
    // if the execution died in that window.
    const sens = [];
    if (sh) {
      src.getRange(sh, 1, 1, sCols).getDisplayValues()[0].forEach((h, i) => { if (publishSensitiveHeader_(h)) sens.push(i); });
      sens.forEach((i) => { for (let r = sh; r < vals.length; r++) vals[r][i] = ''; });
    }
    const keep = publishKeepMask_(dest, 1, 1, sRows, sCols);
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
    return sRows;
  }

  // EDITED COPY (columns deleted/reordered) → match by header, so only the columns the public tab still has get filled.
  if (!sh || !dh) return 0;
  const sHdr = src.getRange(sh, 1, 1, Math.max(src.getLastColumn(), 1)).getDisplayValues()[0];
  const dHdr = dest.getRange(dh, 1, 1, Math.max(dest.getLastColumn(), 1)).getDisplayValues()[0];
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
  if (need > dest.getMaxRows()) dest.insertRowsAfter(dest.getMaxRows(), need - dest.getMaxRows());
  if (n) {
    pairs.forEach((p) => {
      writeValuesSafe_(dest, destStart, p.dc, publishReadCells_(src.getRange(srcStart, p.sc, n, 1)),
        publishKeepMask_(dest, destStart, p.dc, n, 1));
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
  return n;
}

/**
 * Publish: every tab in the PUBLIC file that has a same-named tab here is mirrored. The public file's OWN tab list is
 * therefore the allow-list — copy a tab across to publish it, delete it to stop. Blocked tabs are never mirrored.
 */
function publishPublicRoster_(onlyTab) {
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
  file.getSheets().forEach((dest) => {
    const name = dest.getName();
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
    const sg = src.getMaxColumns(), dg = dest.getMaxColumns();
    const mode = (sg === dg) ? 'FULL' : 'match';
    try {
      const n = publishMirrorTab_(src, dest);
      out.tabs.push(name); out.rows += n;
      out.detail.push(`${name}: ${mode} · ${n} row(s) · grid ${sg}/${dg} · src rows ${src.getLastRow()}`);
    } catch (e) {
      log_('publishMirrorTab_.' + name, e);
      out.skipped.push(name);
      out.detail.push(`${name}: ERROR ${e && e.message ? e.message : e} | grid ${sg}/${dg} | src ${src.getLastRow()}x${src.getLastColumn()} | dest grid ${dest.getMaxRows()}x${dest.getMaxColumns()}`);
    }
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

/** Publish under the lock, clearing the dirty flag FIRST so an edit landing mid-publish re-marks itself. */
function publishPublicRosterQuiet_(onlyTab) {
  const props = PropertiesService.getDocumentProperties();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // another publish is already running — it will carry this change
  try {
    if (!onlyTab) {                              // only a FULL pass may clear the GLOBAL flag. Script writes (patrol
      props.deleteProperty(PUBLISH_DIRTY_PROP_); // credit, panel actions) rely on the sweep's full publish, and a
      _pubDirtyMemo_ = false;                    // single-tab publish doesn't carry them — clearing here dropped them.
    }                                            // Cleared BEFORE publishing so a concurrent edit re-marks itself.
    publishPublicRoster_(onlyTab);
    props.setProperty(PUBLISH_LAST_PROP_, String(Date.now()));
  } catch (e) { log_('publishPublicRosterQuiet_', e); }
  finally { lock.releaseLock(); }
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
    publishPublicRosterQuiet_(only || undefined);
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

/** Time-driven + menu entry point for the publish. */
function publishPublicRoster() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return false;
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
  } finally { lock.releaseLock(); }
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
      const s1 = file.getSheets()[0];
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
  if (roster) {
    const RC = rosterCols_(roster), start = CONFIG.rosterStartRow, last = roster.getLastRow();
    if (last >= start) {
      const n = last - start + 1;
      const ranks = roster.getRange(start, RC.rank, n, 1).getDisplayValues();
      const names = roster.getRange(start, RC.name, n, 1).getDisplayValues();
      const units = RC.unit ? roster.getRange(start, RC.unit, n, 1).getDisplayValues() : null;
      for (let i = 0; i < n; i++) {
        const rank = String(ranks[i][0]).trim();
        if (!isMemberSlot_(rank) || rank === '' || rank === 'Rank') continue;
        if (String(names[i][0]).trim() !== '') continue; // filled → not an open slot
        slots.push({ row: start + i, rank: rank, unit: units ? String(units[i][0]).trim() : '' });
      }
    }
  }
  let rankIcons = {}; try { if (typeof rankIconsMap_ === 'function') rankIcons = rankIconsMap_(); } catch (e) { /* icons optional */ }
  if (!file) return { linked: false, ready: false, signups: [], slots: slots, rankIcons: rankIcons };
  const sh = file.getSheetByName(CONFIG.sheets.signups);
  if (!sh) return { linked: true, ready: false, signups: [], slots: slots, rankIcons: rankIcons };
  return { linked: true, ready: true, signups: signupQueue_(sh, 100), slots: slots, rankIcons: rankIcons };
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
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Another roster operation is running — try again in a moment.');
  try {
    const vr = signupResolveRow_(sh, row, String((payload && payload.id) || '')); // the queue re-sorts under an open panel — verify identity first
    const res = approveSignup_(sh, vr, roster, slotRow);
    try { sortSignups_(sh); } catch (e) { log_('cpSignupApprove.sort', e); }
    try { cpAudit_('signup-approved', '', res.name, `row ${slotRow}`, res.name); } catch (e) { /* audit is best-effort */ }
    return res;
  } finally { lock.releaseLock(); }
}

/** Grow the grid when a write would land past the last row (a full 1000-row grid would otherwise throw). */
function adminEnsureRow_(sheet, r) {
  if (r > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
}

/** The admin tabs, seeding them if missing. PII lives on the Internal Roster tab; this resolves the Disciplinary Log. */
function adminTabs_(file) {
  let l = file.getSheetByName(ADMIN_LOG_TAB_);
  if (!l) { seedAdminSheet_(file); l = file.getSheetByName(ADMIN_LOG_TAB_); }
  return { log: l };
}

/** Injectable core: one member's disciplinary history (newest first, capped — default 50). Testable. */
function cpAdminRead_(logSheet, discordId, cap) {
  cap = (typeof cap === 'number' && cap > 0) ? cap : 50;
  const out = { discipline: [] }; // PII fields now live on the Internal Roster tab (edited there, synced by Unique ID)
  const last = logSheet.getLastRow();
  if (last >= 2) {
    const id = String(discordId == null ? '' : discordId).trim();
    const rows = logSheet.getRange(2, 1, last - 1, 7).getDisplayValues();
    for (let i = rows.length - 1; i >= 0 && out.discipline.length < cap; i--) {
      if (String(rows[i][1]).trim() !== id) continue;
      out.discipline.push({ date: String(rows[i][0]), action: String(rows[i][3]), reason: String(rows[i][4]), issuedBy: String(rows[i][5]), status: String(rows[i][6]) });
    }
  }
  return out;
}

/** Injectable core: append a disciplinary entry (append-only — history is never edited from the panel). Text columns are '@'-formatted before the write (formula-injection guard); the Date column stays a real date. Testable. */
function cpAppendDiscipline_(logSheet, entry) {
  const id = String((entry && entry.discordId) || '').trim();
  if (!isValidId_(id)) throw new Error('Unique ID must be ' + idDigitsLabel_() + ' digits.');
  const action = clamp_(String((entry && entry.action) || '').trim(), 60);
  if (action === '') throw new Error('Action is required.');
  const reason = clamp_(String((entry && entry.reason) || '').trim(), 1000);
  const name = clamp_(String((entry && entry.name) || '').trim(), 120);
  const issuedBy = clamp_(String((entry && entry.issuedBy) || '').trim(), 200);
  const status = clamp_(String((entry && entry.status) || 'Active').trim(), 40) || 'Active';
  const r = Math.max(logSheet.getLastRow(), 1) + 1;
  adminEnsureRow_(logSheet, r);
  logSheet.getRange(r, 2, 1, 6).setNumberFormat('@'); // ID exact + no formula execution from reason/notes text — BEFORE the write
  logSheet.getRange(r, 1, 1, 7).setValues([[new Date(), id, name, action, reason, issuedBy, status]]);
  return { row: r };
}

/** Panel endpoint: create a new admin spreadsheet (owned by the acting admin) or link an existing one by URL/ID. Gated + logged. */
function cpAdminSetup(payload) {
  // RETIRED: there is no separate admin file any more. This workbook is the protected one and the PUBLIC roster is a
  // one-way published copy (🌐 Set Up Public Roster). Refused outright so nobody can repoint a now-unread property.
  throw new Error('The separate admin file has been retired — this workbook IS the internal roster. Use 👥 Roster ▸ 🌐 Set Up Public Roster to publish the member-facing copy.');
}

/**
 * Panel endpoint: one member's discipline history + a link to the admin file (Google's ACL gates this — see the
 * section header). PII fields are NOT returned here any more: they live on the Internal Roster tab and are edited
 * there, so the panel links to the file instead of round-tripping DOB/email through the page.
 */
function cpAdminInfo(discordId) {
  const file = adminFile_();
  if (!file) return { linked: false, url: '', discipline: [] };
  const out = cpAdminRead_(adminTabs_(file).log, discordId);
  out.linked = true;
  try { out.url = file.getUrl(); } catch (e) { out.url = ''; }
  return out;
}

/** Panel endpoint: record a disciplinary action (append-only) and return the member's refreshed admin info. */
function cpAddDiscipline(payload) {
  const file = adminFile_();
  if (!file) throw new Error('No admin roster is linked yet — set one up on the Tools tab.');
  const t = adminTabs_(file);
  let issuedBy = '';
  try { issuedBy = Session.getActiveUser().getEmail() || ''; } catch (e) { /* consumer-Gmail may hide it */ }
  if (issuedBy && typeof auditWho_ === 'function') issuedBy = auditWho_(issuedBy); // member NAME when the email is on their roster row
  const lock = LockService.getScriptLock(); // two panels appending concurrently compute the same last-row and silently overwrite each other
  if (!lock.tryLock(10000)) throw new Error('Another roster operation is running — try again in a moment.');
  try {
    cpAppendDiscipline_(t.log, Object.assign({}, payload, { issuedBy: issuedBy }));
  } finally { lock.releaseLock(); }
  return cpAdminInfo(String((payload && payload.discordId) || ''));
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
