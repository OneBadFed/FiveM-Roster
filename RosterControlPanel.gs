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

const CP_VERSION = 'v1.4.0';
const CP_STATUSES = Object.freeze(['Active', 'Semi-Active', 'Inactive', 'LOA', 'ROA', 'Reserve']); // fallback when config is unavailable

/** Status names from [STATUSES] on ⚙️ Config (defaults identical to CP_STATUSES). */
function cpStatuses_() {
  try { const names = cfg_().statusNames; if (names && names.length) return names; } catch (e) { /* config broken — fallback */ }
  return CP_STATUSES.slice();
}

/* ----------------------------------------------------------------------------
 * D5 — WHITELISTED DISPATCH (Roster Engine v2, Phase 2)
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
  cpSetWebhook: (url) => cpSetWebhook(url),
  cpTestWebhook: () => cpTestWebhook(),
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
  cpAdminSave: (p) => cpAdminSave(p),
  cpAddDiscipline: (p) => cpAddDiscipline(p),
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

/* ----------------------------------------------------------------------------
 * SETTINGS — the panel's guarded editing surface over the ⚙️ Config tab.
 * The SHEET stays the source of truth (copies carry it; it is the no-code
 * escape hatch); the panel is the recommended editor: typed inputs, and a
 * VALIDATE-BEFORE-WRITE contract — a change set that would produce config
 * ERRORs is refused wholesale, so the UI can never save a broken config.
 * ------------------------------------------------------------------------- */

/**
 * Blocks the Settings Studio exposes. v2.5.0: ALL kv blocks + nearly every table block are editable in the panel
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
    adminLinked: !!String(PropertiesService.getDocumentProperties().getProperty(ADMIN_SHEET_PROP_) || '').trim(),
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
function openControlPanel() {
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

  return { members, stats, updatedAt: fmtTs_(new Date()) }; // v2.5.0: configurable timestamp format
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
  Object.keys(parts).forEach((rank) => { const uri = parts[rank].join(''); if (uri) map[rank] = uri; });
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
  const hist = ss.getSheetByName(CONFIG.sheets.hoursHistory); // v2.5.0: config-driven history tab name
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
        byWeek[week] = { hours: Number(vals[i][4]) || 0, status: String(vals[i][5] || '').trim() }; // a later row for the same week wins; F col = Status (v2.5.0 activity checks)
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
  const changed = [];
  rows.forEach((r, i) => {
    try {
      const vr = cpResolveMemberRow_(roster, Number(r), idArr[i]); // identity-verified when the client supplies IDs
      const before = String(roster.getRange(vr, RC.name).getDisplayValue()).trim();
      roster.getRange(vr, RC.activity).setValue(status);
      changed.push(before || `row ${vr}`);
    } catch (e) { log_('cpSetStatusBulk_', e); }
  });
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
    cpAudit_('leave', '', `${res.type} ${fmtDisplay_(res.start)}–${fmtDisplay_(res.end)} (${res.status})`, // v2.5.0: configurable date format (matches the webhook + form-path audit)
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
  if (!DISCORD_ID_RE.test(m.discord)) throw new Error('This member needs a valid 17-19 digit Discord ID first.');

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
        `${diff} ${diff === 1 ? 'Day' : 'Days'}`, m.discord); // v2.5.0: configurable date format
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
  if (!DISCORD_ID_RE.test(discord)) throw new Error('Unique ID must be 17-19 digits.');

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
    if (!DISCORD_ID_RE.test(id)) malformed.push(`${who}: "${id}"`);
    (seen[id] = seen[id] || []).push(who);
  }
  const dup = Object.keys(seen).filter((k) => seen[k].length > 1).map((k) => `ID ${k} → ${seen[k].join(', ')}`);
  if (!dup.length && !malformed.length) return 'No duplicate or malformed Discord IDs found.';
  const parts = [];
  if (dup.length) parts.push(`Duplicates (${dup.length}): ${dup.join(' | ')}`);
  if (malformed.length) parts.push(`Not 17-19 digits (${malformed.length}): ${malformed.join(' | ')}`);
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
 * ADMIN ROSTER (v1.4.0) — a SEPARATE, admin-only spreadsheet for sensitive
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
const ADMIN_DETAILS_TAB_ = 'Member Details';
const ADMIN_LOG_TAB_ = 'Disciplinary Log';

/** The linked admin spreadsheet, opened AS THE CURRENT USER — throws Google's permission error for non-admins (that's the gate). @return {Spreadsheet|null} null when no file is linked. */
function adminFile_() {
  const id = String(PropertiesService.getDocumentProperties().getProperty(ADMIN_SHEET_PROP_) || '').trim();
  if (!id) return null;
  return SpreadsheetApp.openById(id);
}

/** Non-PII link metadata (who linked it, when) — makes a rogue pre-link visible to every panel user. */
function adminLinkMeta_() {
  try { const m = JSON.parse(PropertiesService.getDocumentProperties().getProperty(ADMIN_SHEET_PROP_ + '_META') || '{}'); return { by: String(m.by || ''), at: String(m.at || '') }; }
  catch (e) { return { by: '', at: '' }; }
}

/** Cheap bootstrap probe: is an admin file linked, and can THIS user open it? Never throws. */
function cpAdminStatus_() {
  const id = String(PropertiesService.getDocumentProperties().getProperty(ADMIN_SHEET_PROP_) || '').trim();
  const meta = adminLinkMeta_();
  if (!id) return { linked: false, access: false, url: '', linkedBy: '', linkedAt: '' };
  try { const f = SpreadsheetApp.openById(id); return { linked: true, access: true, url: f.getUrl(), linkedBy: meta.by, linkedAt: meta.at }; }
  catch (e) { return { linked: true, access: false, url: '', linkedBy: meta.by, linkedAt: meta.at }; }
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
  mk(ADMIN_DETAILS_TAB_, ['Discord ID', 'Name', 'Email', 'Date of Birth', 'Notes'], 1, 2); // cols 3+ are free-form fields
  mk(ADMIN_LOG_TAB_, ['Date', 'Discord ID', 'Name', 'Action', 'Reason', 'Issued By', 'Status'], 2);
  ensureWebhookTab_(file); // per-channel Discord webhooks live here too — the file's ACL gates them
  const s1 = file.getSheetByName('Sheet1'); // drop the empty default tab on a freshly created file
  if (s1 && file.getSheets().length > 2 && s1.getLastRow() === 0) { try { file.deleteSheet(s1); } catch (e) { /* cosmetic */ } }
}

/** The Member Details FIELD columns — everything after Discord ID + Name with a non-empty header, in sheet order (capped). The header row IS the schema: add a column in the admin file → a new private field everywhere. */
const ADMIN_MAX_FIELDS_ = 30;
function adminFieldCols_(details) {
  const lastCol = details.getLastColumn();
  if (lastCol < 3) return [];
  const hdr = details.getRange(1, 3, 1, lastCol - 2).getDisplayValues()[0];
  const out = [];
  const seen = {}; // DUPLICATE labels: keep the FIRST column only — labels key the read/render/save round-trip, so a
  for (let c = 0; c < hdr.length && out.length < ADMIN_MAX_FIELDS_; c++) { // second same-named column would get silently clobbered by every save
    const label = String(hdr[c] || '').trim();
    if (label === '' || seen[norm_(label)]) continue;
    seen[norm_(label)] = true;
    out.push({ col: 3 + c, label: label });
  }
  return out;
}

/** Is this header label an actual email-address field? Whole-label match only — 'Voicemail' or 'Email Preferences' are free text. */
function adminIsEmailLabel_(label) {
  return /^E[- ]?MAIL( ADDRESS)?$/.test(norm_(label));
}

/** Grow the grid when a write would land past the last row (a full 1000-row grid would otherwise throw). */
function adminEnsureRow_(sheet, r) {
  if (r > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
}

/** The admin tabs, seeding them if missing. */
function adminTabs_(file) {
  let d = file.getSheetByName(ADMIN_DETAILS_TAB_), l = file.getSheetByName(ADMIN_LOG_TAB_);
  if (!d || !l) { seedAdminSheet_(file); d = file.getSheetByName(ADMIN_DETAILS_TAB_); l = file.getSheetByName(ADMIN_LOG_TAB_); }
  return { details: d, log: l };
}

/** Injectable core: the details row holding this exact Discord ID, or -1. */
function adminDetailsRow_(details, discordId) {
  const id = String(discordId == null ? '' : discordId).trim();
  const last = details.getLastRow();
  if (!id || last < 2) return -1;
  const ids = details.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) { if (String(ids[i][0]).trim() === id) return 2 + i; }
  return -1;
}

/** Injectable core: one member's details (every discovered field, in sheet order) + disciplinary history (newest first, capped — default 50). Testable. */
function cpAdminRead_(details, logSheet, discordId, cap) {
  cap = (typeof cap === 'number' && cap > 0) ? cap : 50;
  const fields = adminFieldCols_(details);
  const out = { fields: fields.map((f) => ({ label: f.label, value: '' })), discipline: [] };
  const r = adminDetailsRow_(details, discordId);
  if (r !== -1 && fields.length) {
    const width = fields[fields.length - 1].col;
    const v = details.getRange(r, 1, 1, width).getDisplayValues()[0];
    out.fields = fields.map((f) => ({ label: f.label, value: String(v[f.col - 1] == null ? '' : v[f.col - 1]).trim() }));
  }
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

/**
 * Injectable core: upsert a member's private fields. `payload.fields` = { <header label>: value } — only labels that
 * exist in the header row are written (unknown labels are ignored, never create columns), and ONLY provided fields are
 * touched (other columns keep their values). An EMAIL-named field is validated BEFORE truncation (overlong/invalid is
 * rejected, never mangled). Every written cell is '@'-formatted FIRST so a value starting '=' stays literal text
 * (an unformatted setValue would execute it as a live formula — an injection into the admin file).
 */
function cpAdminUpsert_(details, payload) {
  const id = String((payload && payload.discordId) || '').trim();
  if (!DISCORD_ID_RE.test(id)) throw new Error('Discord ID must be 17-19 digits.');
  const name = clamp_(String((payload && payload.name) || '').trim(), 120);
  const given = (payload && payload.fields && typeof payload.fields === 'object') ? payload.fields : {};
  const cols = adminFieldCols_(details);
  const writes = []; // {col, value} — validated BEFORE any cell is touched (reject = nothing written)
  const matched = {}; // labels we found a column for — anything else provided is IGNORED and must be reported, not silently dropped
  cols.forEach((f) => {
    if (!Object.prototype.hasOwnProperty.call(given, f.label)) return; // untouched field — keep its current value
    matched[f.label] = true;
    let v = String(given[f.label] == null ? '' : given[f.label]).trim();
    if (adminIsEmailLabel_(f.label)) { // strict whole-label match — 'Voicemail'/'Email Preferences' are free text
      if (v.length > 200) throw new Error(`${f.label} is too long.`);
      if (v !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error(`${f.label} does not look like a valid email.`);
    } else {
      v = clamp_(v, 2000);
    }
    writes.push({ col: f.col, value: v });
  });
  const ignored = Object.keys(given).filter((k) => !matched[k]); // header renamed/removed since the panel loaded
  let r = adminDetailsRow_(details, id);
  if (r === -1) r = Math.max(details.getLastRow(), 1) + 1;
  adminEnsureRow_(details, r);
  const idName = details.getRange(r, 1, 1, 2);
  idName.setNumberFormat('@'); // ID precision + literal text — BEFORE the write
  idName.setValues([[id, name]]);
  writes.forEach((w) => {
    const cell = details.getRange(r, w.col);
    cell.setNumberFormat('@'); // formula-injection guard on every field cell
    cell.setValue(w.value);
  });
  return { row: r, written: writes.length, ignored: ignored };
}

/** Injectable core: append a disciplinary entry (append-only — history is never edited from the panel). Text columns are '@'-formatted before the write (formula-injection guard); the Date column stays a real date. Testable. */
function cpAppendDiscipline_(logSheet, entry) {
  const id = String((entry && entry.discordId) || '').trim();
  if (!DISCORD_ID_RE.test(id)) throw new Error('Discord ID must be 17-19 digits.');
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

/**
 * POINTER-INTEGRITY GATE: once an admin file is linked, only an ESTABLISHED ADMIN (someone who can open the
 * currently-linked file) or the SPREADSHEET OWNER may change the link. Without this, any main-sheet editor could
 * silently re-point ADMIN_ROSTER_ID at a file THEY own and capture every future email/DOB/discipline write (or
 * blank it as a DoS) — the read-time ACL protects the legitimate file, but the pointer selects the WRITE SINK.
 * Throws (blocking the change) when the caller is neither; first-time linking (no pointer yet) is open.
 * DOCUMENTED TRADEOFFS: (1) "can open the admin file" includes VIEW access — a view-only share grants relink
 * authority, consistent with the can-open=admin model; (2) on a Shared Drive getOwner() is null, so the owner
 * escape hatch is unavailable — recovery from a dead link there = the script editor (Project Settings ▸ Document
 * properties, delete ADMIN_ROSTER_ID); (3) the who/when of every link is stored in ADMIN_ROSTER_ID_META and
 * shown on the Tools tab, so a rogue first-link is visible to everyone even when the SYS-Log actor is blank.
 */
function assertMayRelink_() {
  const existing = String(PropertiesService.getDocumentProperties().getProperty(ADMIN_SHEET_PROP_) || '').trim();
  if (!existing) return; // bootstrap — nothing to protect yet
  try { SpreadsheetApp.openById(existing).getName(); return; } catch (e) { /* caller can't open the current admin file */ }
  try { // owner escape hatch — covers a permanently-deleted admin file locking everyone out
    const ownerEmail = String((SpreadsheetApp.getActive().getOwner() || { getEmail: () => '' }).getEmail() || '');
    const me = String(Session.getActiveUser().getEmail() || '');
    if (ownerEmail && me && ownerEmail === me) return;
  } catch (e) { /* fall through to the refusal */ }
  throw new Error('An admin roster is already linked, and only a current admin (or the sheet owner) can change it. Ask an admin to relink, or to share the existing admin file with you.');
}

/** Extract a Sheets file ID from a URL or bare ID — prefers the /d/<id> segment so query params can't false-match. */
function adminIdFromUrl_(url) {
  if (/\/d\/e\//.test(url)) throw new Error('That is a published-to-web link — paste the EDIT link (…/spreadsheets/d/<id>/edit) or the bare file ID instead.');
  const m = url.match(/\/d\/([-\w]{25,})/) || url.match(/^([-\w]{25,})$/);
  if (!m) throw new Error('That does not look like a Google Sheets link or ID.');
  return m[1];
}

/** Panel endpoint: create a new admin spreadsheet (owned by the acting admin) or link an existing one by URL/ID. Gated + logged. */
function cpAdminSetup(payload) {
  payload = payload || {};
  assertMayRelink_(); // hostile editors cannot redirect or blank an established link
  const prior = String(PropertiesService.getDocumentProperties().getProperty(ADMIN_SHEET_PROP_) || '').trim();
  let file;
  const url = String(payload.url || '').trim();
  if (url !== '') {
    const id = adminIdFromUrl_(url);
    try { file = SpreadsheetApp.openById(id); } // must be openable by the acting admin
    catch (e) { throw new Error('Could not open that spreadsheet — check the link and that YOUR Google account has access to it.'); }
    const mainId = SpreadsheetApp.getActive().getId();
    if (file.getId() === mainId) throw new Error('The admin roster must be a SEPARATE spreadsheet — anyone who can view this sheet can read every tab in it.');
  } else {
    file = SpreadsheetApp.create(`${CONFIG.systemName} — Admin Roster`); // owned by the acting admin — they control sharing
  }
  seedAdminSheet_(file); // throws with a clear message if a hand-made file's tab headers don't match
  // Detectability (file IDs + actor are NOT member PII — the no-PII-in-the-main-file rule holds): every link change
  // leaves a SYS Log trail AND a who/when stamp that the Tools tab shows to every panel user.
  let actor = ''; try { actor = Session.getActiveUser().getEmail() || ''; } catch (e) { /* consumer-Gmail may hide it */ }
  const props = PropertiesService.getDocumentProperties();
  props.setProperty(ADMIN_SHEET_PROP_, file.getId());
  props.setProperty(ADMIN_SHEET_PROP_ + '_META', JSON.stringify({ by: actor || 'unknown', at: Utilities.formatDate(new Date(), ssTz_(), 'd MMM yyyy, HH:mm') }));
  logInfo_('cpAdminSetup', `admin roster ${prior ? 'RE-LINKED' : 'linked'}: ${prior ? prior + ' → ' : ''}${file.getId()} by ${actor || 'unknown'}.`);
  // Warn about pre-existing rows whose ID column was hand-typed as a NUMBER (precision already lost at entry — flag, can't repair).
  let badIds = 0;
  try {
    const d = file.getSheetByName(ADMIN_DETAILS_TAB_);
    if (d && d.getLastRow() >= 2) {
      d.getRange(2, 1, d.getLastRow() - 1, 1).getDisplayValues().forEach((r) => {
        const v = String(r[0]).trim();
        if (v !== '' && !DISCORD_ID_RE.test(v)) badIds++;
      });
    }
  } catch (e) { /* advisory only */ }
  return { ok: true, url: file.getUrl(), name: file.getName(), created: url === '', relinked: !!prior, badIds: badIds };
}

/** Panel endpoint: one member's admin details + discipline history (Google's ACL gates this — see the section header). */
function cpAdminInfo(discordId) {
  const file = adminFile_();
  if (!file) return { linked: false, email: '', dob: '', notes: '', discipline: [] };
  const t = adminTabs_(file);
  const out = cpAdminRead_(t.details, t.log, discordId);
  out.linked = true;
  return out;
}

/** Panel endpoint: save a member's private fields to the admin roster. Reports labels that no longer exist (renamed/removed columns) so edits are never silently dropped. */
function cpAdminSave(payload) {
  const file = adminFile_();
  if (!file) throw new Error('No admin roster is linked yet — set one up on the Tools tab.');
  const t = adminTabs_(file);
  const res = cpAdminUpsert_(t.details, payload);
  return { ok: true, written: res.written, ignored: res.ignored };
}

/** Panel endpoint: record a disciplinary action (append-only) and return the member's refreshed admin info. */
function cpAddDiscipline(payload) {
  const file = adminFile_();
  if (!file) throw new Error('No admin roster is linked yet — set one up on the Tools tab.');
  const t = adminTabs_(file);
  let issuedBy = '';
  try { issuedBy = Session.getActiveUser().getEmail() || ''; } catch (e) { /* consumer-Gmail may hide it */ }
  cpAppendDiscipline_(t.log, Object.assign({}, payload, { issuedBy: issuedBy }));
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
