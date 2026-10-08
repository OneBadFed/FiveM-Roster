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
  try { const names = cfg_().statusNames; if (Array.isArray(names)) return names; } catch (e) { /* config broken — fallback */ }
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
  cpStartupInfo: () => cpStartupInfo(),
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
  cpSignupUpdate: (p) => cpSignupUpdate(p),
  cpSignupPostSeat: (p) => cpSignupPostSeat(p),
  cpPromoList: () => cpPromoList(),
  cpPromoRemove: (p) => cpPromoRemove(p),
  cpPromoRestore: (p) => cpPromoRestore(p),
});

/** The panel's single server entry point. @param {string} name @param {Array} args */
function dispatch(name, args) {
  const endpoint=typeof name==='string'?name:'[invalid endpoint]';
  try {
    if(typeof name!=='string')raise_('E-507',{reason:'endpoint must be a string'});
    if(!Object.prototype.hasOwnProperty.call(DISPATCH_ENDPOINTS_,endpoint))raise_('E-506',{name:endpoint});
    if(args!=null&&!Array.isArray(args))raise_('E-507',{reason:'arguments must be an array'});
    if(Array.isArray(args)&&args.length>20)raise_('E-507',{reason:'too many arguments'});
    return perf_('dispatch:'+endpoint,()=>DISPATCH_ENDPOINTS_[endpoint].apply(null,args||[]));
  } catch(err) {
    const ae=reportError_('dispatch:'+endpoint,err,true);
    const hint=ae.hint?' — Fix: '+diagnosticText_(ae.hint):'';
    throw new Error('['+ae.code+'] '+diagnosticText_(ae.message)+hint+' — Reference: '+EXEC_ID_+docsLink_(ae.code));
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
  if(channel!=null&&String(channel).trim()!==''&&WEBHOOK_CHANNELS_.indexOf(norm_(channel))===-1)raise_('E-507',{reason:'unknown webhook channel'});
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
  const template = HtmlService.createTemplateFromFile('SettingsPanel');
  // Show the shell before any sheet reads. The client loads fresh config via cpGetConfig.
  template.settingsBootJson = 'null';
  const html = template.evaluate()
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
      // Training membership can change without a roster edit (rank flags, labels or keywords).
      // Queue the same derived rebuilds used by member changes so the academy cannot stay stale.
      const trainingChanged=payload && (Object.keys(payload.tables||{}).some(name=>['RANKS','DASHBOARD_GROUPS','SECTION_TAGS','COLUMNS'].indexOf(name)!==-1)
        || (payload.kv||[]).some(item=>item.block==='ROSTER_LAYOUT' || item.block==='SHEETS'));
      if(trainingChanged) {
        try { if(typeof deferWork_==='function') ['academy','groups','dashboard'].forEach(deferWork_); }
        catch(e){ log_('cpApplyConfig.derived',e); }
        try { if(typeof publishMarkDirty_==='function') publishMarkDirty_(); }
        catch(e){ log_('cpApplyConfig.publish',e); }
      }
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
    // Opening latency matters separately from data readiness: render the shell immediately,
    // then let the client fetch cpBootstrap without holding the window behind roster/config reads.
    const t = HtmlService.createTemplateFromFile('ControlPanel');
    t.bootJson = 'null';
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
    health: null, // structural diagnostics load after the first paint
  };
}

/** Optional diagnostics and queue badge, requested only after the panel paints. */
function cpStartupInfo() {
  if (typeof cpEnsureAuditTrigger === 'function') { try { cpEnsureAuditTrigger(); } catch (e) { log_('cpStartupInfo', e); } }
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.signups);
  let waiting = 0;
  if (sh) {
    const SC = signupCols_(sh);
    const n = sh.getLastRow() - SC.dataStart + 1;
    if (n > 0 && SC.status) sh.getRange(SC.dataStart, 1, n, SC.width).getDisplayValues().forEach((r) => {
      if ((SC.name && String(r[SC.name - 1]).trim() || SC.discord && String(r[SC.discord - 1]).trim()) && !signupIsDone_(r[SC.status - 1])) waiting++;
    });
  }
  return { health: typeof cpHealthCheckCached_ === 'function' ? cpHealthCheckCached_() : null, waiting };
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
      const rows = roster.getRange(CONFIG.rosterStartRow, 1, n, Math.max(RC.rank, RC.name)).getDisplayValues();
      for (let i = 0; i < n; i++) {
        const rank = String(rows[i][RC.rank - 1]).trim();
        if (rank === '' || rank === 'Rank' || !isMemberSlot_(rank)) continue;
        if (!(rank in counts)) { counts[rank] = 0; order.push(rank); }
        if (String(rows[i][RC.name - 1]).trim() !== '') counts[rank]++;
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
      const disp = tracker.getRange(CONFIG.trackerStartRow, 1, n, TC.width).getDisplayValues();
      for (let i = 0; i < n; i++) {
        if (String(disp[i][TC.discord - 1]).trim() !== id) continue;
        leaves.push({
          type: trackerLeaveType_(),
          start: String(disp[i][TC.start - 1]).trim(),
          end: String(disp[i][TC.end - 1]).trim(),
          status: String(disp[i][TC.status - 1]).trim(),
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
        if(!byWeek[week])byWeek[week] = { hours: Number(vals[i][4]) || 0, status: String(vals[i][5] || '').trim() }; // newest-first history: the first record wins
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
  if (ids != null && (!Array.isArray(ids) || ids.length !== rows.length)) throw new Error('Selection identities are incomplete — refresh and select the members again.');
  // One read per column + ONE write for the whole selection, instead of ~5 round-trips per member — a bulk action
  // holds the script lock, so every saved call shortens the window in which other panel writes time out on it.
  // The per-row semantics are unchanged: identity-verified when the client sent IDs (relocate a shifted member,
  // skip a vanished one — F-027), slot-validated always, failures logged and skipped.
  const start = CONFIG.rosterStartRow, last = roster.getLastRow();
  const n = Math.max(0, last - start + 1);
  const idCol = n ? roster.getRange(start, RC.discord, n, 1).getDisplayValues() : [];
  const rankCol = n ? roster.getRange(start, RC.rank, n, 1).getDisplayValues() : [];
  const nameCol = n ? roster.getRange(start, RC.name, n, 1).getDisplayValues() : [];
  const idRows = Object.create(null);
  idCol.forEach((entry, i) => { const id = String(entry[0]).trim(); if (id) (idRows[id] || (idRows[id] = [])).push(start + i); });
  const at = (col, r) => (r >= start && r < start + n) ? String(col[r - start][0]).trim() : '';
  const isSlot = (r) => { const k = at(rankCol, r); return isMemberSlot_(k) && k !== '' && k !== 'Rank'; };
  const colA1 = (c) => { let s = ''; while (c > 0) { s = String.fromCharCode(65 + ((c - 1) % 26)) + s; c = Math.floor((c - 1) / 26); } return s; };
  const changed = [], cells = [], skipped = [], seen = {};
  rows.forEach((r, i) => {
    try {
      const want = String(idArr[i] == null ? '' : idArr[i]).trim();
      let vr = Number(r);
      if (!Number.isInteger(vr)) throw new Error('Invalid selected row.');
      if (want && idRows[want] && idRows[want].length > 1) throw new Error('That member ID occurs more than once — fix the duplicate IDs before updating.');
      if (want !== '' && at(idCol, vr) !== want) { // identity moved → relocate by ID (the sheet is the source of truth)
        vr = idRows[want] ? idRows[want][0] : -1;
        if (vr === -1) throw new Error('That member has moved or been removed since the panel loaded.');
      }
      if (!isSlot(vr)) throw new Error(`Row ${vr} is not a member slot.`);
      if (!at(nameCol, vr)) throw new Error(`Row ${vr} is an empty slot — skipped.`);
      if (seen[vr]) return;
      seen[vr] = true;
      cells.push(colA1(RC.activity) + vr);
      changed.push(at(nameCol, vr) || `row ${vr}`);
    } catch (e) { skipped.push({ row: Number(r), reason: String(e && e.message || e) }); log_('cpSetStatusBulk_', e); }
  });
  if (cells.length) roster.getRangeList(cells).setValue(status);
  return { count: changed.length, status, members: changed, skipped };
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
  const lock=LockService.getScriptLock();
  if(lock.hasLock())return fn(); // the parent owns release and post-write publishing
  try { PropertiesService.getDocumentProperties().setProperty(PUBLISH_BACKOFF_PROP_,String(Date.now()+PUBLISH_BACKOFF_MS_)); }catch(e){/* priority hint is optional */}
  if(!lock.tryLock(30000))raise_('E-503');
  let result,primary,failed=false,released=false;
  try { result=fn(); }catch(e){primary=e;failed=true;}
  // Commit pending sheet writes while still serialized. A cleanup failure must not replace the primary error.
  try { SpreadsheetApp.flush(); }catch(e){if(!failed){primary=e;failed=true;}else log_('cpWithLock_.flush',e);}
  try { lock.releaseLock();released=true; }catch(e){if(!failed){primary=e;failed=true;}else log_('cpWithLock_.release',e);}
  try { if(released)publishAfterWrite_(); }catch(e){log_('cpWithLock_.publish',e); /* committed writes must not look like failed writes */}
  if(failed)throw primary;
  return result;
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
  if (!CONFIG.leaveTypes || !CONFIG.leaveTypes.length) throw new Error('Configure at least one LEAVE-kind status and select it under Leave engine before scheduling leave.');
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
function cpAssignMember_(roster, payload, approvalKey) {
  assertNoPendingActivityReset_(roster);
  const row = Number(payload && payload.row);
  const name = String((payload && payload.name) || '').trim();
  const discord = String((payload && payload.discord) || '').trim();
  const joinRaw = String((payload && payload.joinDate) || '').trim();
  const ooc = String((payload && payload.ooc) || '').trim();     // optional OOC name (written only if the roster has that column)
  const shift = String((payload && payload.shift) || '').trim(); // optional shift (written only if the roster has that column)
  // Optional starting status. Whitelisted against the CONFIGURED vocabulary — this value is written straight
  // into the activity column, so an unrecognised one would poison every count that groups by status.
  const statusReq = String((payload && payload.status) || '').trim();
  const request = JSON.stringify({row,name,discord,joinRaw,ooc,shift,statusReq});
  const pending = memberAssignmentJournal_(roster,row);
  if (pending) {
    if (pending.request !== request) throw new Error('An interrupted member assignment reserves this slot. Retry the original assignment or use Recover Interrupted Transfer to finish it.');
    resumeMemberAssignment_(roster,pending);
    return cpMemberAt_(roster,row);
  }
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

  cpAssertSlotRow_(roster, row,approvalKey);
  const RC = rosterCols_(roster);
  const existing = String(roster.getRange(row, RC.name).getDisplayValue()).trim();
  if (existing !== '') throw new Error(`That slot already holds ${existing}. Pick an open slot.`);
  const existingId = String(roster.getRange(row,RC.discord).getDisplayValue()).trim();
  if (existingId) throw new Error('This unnamed slot still holds a Unique ID. Inspect its member fields before seating someone new.');
  cpAssertUniqueId_(roster, discord, row);

  let joinDate = joinRaw ? cpParseYMD_(joinRaw) : todayInSheetTz_(); // local-midnight — new Date('yyyy-MM-dd') is UTC and shifts the day in western zones
  if (isNaN(joinDate.getTime())) joinDate = todayInSheetTz_();

  const writes = [[RC.discord,discord],[RC.join,joinDate],[RC.activity,startStatus
    || (CONFIG.tierNames.length ? CONFIG.tierNames[CONFIG.tierNames.length - 1] : 'Inactive')],[RC.hours,0]];
  if (RC.ooc && ooc) writes.push([RC.ooc,ooc]);
  if (RC.shift && shift) writes.push([RC.shift,shift]);
  writes.push([RC.name,name]); // NAME last: the slot becomes visible only after its other required fields
  if (writes.some(w=>!Number.isInteger(w[0]) || w[0]<1) || new Set(writes.map(w=>w[0])).size!==writes.length) throw new Error('Required member columns are missing or overlap. No assignment was written.');
  const journal = {version:1,book:roster.getParent().getId(),sheet:roster.getSheetId(),row,request,rank:String(roster.getRange(row,RC.rank).getDisplayValue()),layout:JSON.stringify(RC),
    fields:writes.map(w=>({col:w[0],before:memberMoveSnapshot_(roster.getRange(row,w[0]))[0],after:{content:memberMoveCellValue_(w[1]),formula:''}}))};
  const serialized=JSON.stringify(journal);
  if (encodeURIComponent(serialized).replace(/%[A-F\d]{2}/gi,'x').length>8000) throw new Error('Member assignment exceeds the recovery storage limit. No member fields were written.');
  PropertiesService.getDocumentProperties().setProperty(memberAssignmentKey_(roster,row),serialized);
  resumeMemberAssignment_(roster,journal);
  // Seat at the lowest tier unless a starting status was chosen. NOTE for anyone reading a surprising roster:
  // a TIER status here is advisory — the next activity check recomputes it from hours, so "Active" with 0 hours
  // reverts. A LEAVE/PROTECTED status (LOA, Reserve) is preserved by resolveStatus_ and does stick.
  return cpMemberAt_(roster, row);
}

function memberAssignmentKey_(roster,row) { return 'RE_ASSIGN:'+roster.getSheetId()+':'+row; }
function memberAssignmentRows_(roster) {
  const prefix='RE_ASSIGN:'+roster.getSheetId()+':';
  return Object.keys(PropertiesService.getDocumentProperties().getProperties()).filter(k=>k.indexOf(prefix)===0).map(k=>Number(k.slice(prefix.length)));
}
function memberAssignmentJournal_(roster,row) {
  const raw=PropertiesService.getDocumentProperties().getProperty(memberAssignmentKey_(roster,row));
  if (!raw) return null;
  let j; try { j=JSON.parse(raw); } catch (e) { throw new Error('Member-assignment recovery record is unreadable. Inspect this reserved slot before changing it.'); }
  if (!j || j.version!==1 || j.book!==roster.getParent().getId() || j.sheet!==roster.getSheetId() || j.row!==row || !Array.isArray(j.fields) || !j.fields.length || typeof j.request!=='string') throw new Error('Member-assignment recovery record does not match this roster/slot.');
  return j;
}
function resumeMemberAssignment_(roster,j) {
  assertNoPendingActivityReset_(roster);
  const RC=rosterCols_(roster), seen=new Set();
  const allowed=new Set([RC.name,RC.discord,RC.join,RC.activity,RC.hours,RC.ooc,RC.shift].filter(c=>c>0));
  if (j.book!==roster.getParent().getId() || j.sheet!==roster.getSheetId() || j.layout!==JSON.stringify(RC) || !Number.isInteger(j.row) || j.row<CONFIG.rosterStartRow || j.row>roster.getMaxRows() || String(roster.getRange(j.row,RC.rank).getDisplayValue())!==j.rank) throw new Error('Member-assignment layout or slot changed. Restore the original layout before recovery.');
  const planned=j.fields.map(f=>{
    if (!f || !Number.isInteger(f.col) || !allowed.has(f.col) || f.col>roster.getLastColumn() || seen.has(f.col) || !f.before || !f.after || !f.after.content || f.after.formula) throw new Error('Member-assignment recovery fields are invalid.');
    const content=f.after.content;
    if (content.date!=null ? typeof content.date!=='number' || !Number.isFinite(content.date) : typeof content.value!=='string' && (typeof content.value!=='number' || !Number.isFinite(content.value))) throw new Error('Member-assignment recovery values are invalid.');
    seen.add(f.col);
    const cell=roster.getRange(j.row,f.col), live=memberMoveSnapshot_(cell)[0];
    if (!memberMoveCellMatches_(live,f.before) && !memberMoveCellMatches_(live,f.after)) throw new Error('Member-assignment conflict: this slot was manually changed after an interrupted write. No conflicting field was overwritten.');
    return {cell,after:f.after,done:memberMoveCellMatches_(live,f.after)};
  });
  if ([RC.name,RC.discord,RC.join,RC.activity,RC.hours].some(c=>!seen.has(c))) throw new Error('Member-assignment recovery is missing required fields.');
  // Validate identity uniqueness before resuming any partial assignment.
  const identity=j.fields.find(f=>f.col===RC.discord);
  if (!identity || !isValidId_(String(identity.after.content.value || ''))) throw new Error('Member-assignment recovery identity is invalid.');
  cpAssertUniqueId_(roster,String(identity.after.content.value),j.row);
  planned.forEach(p=>{
    if (p.done) return;
    const c=p.after.content, value=c.date!=null ? new Date(c.date) : c.value;
    if (value instanceof Date && !Number.isFinite(value.getTime())) throw new Error('Member-assignment date is invalid.');
    if (typeof value==='string') p.cell.setNumberFormat('@');
    p.cell.setValue(typeof value==='string' && value.startsWith('=') ? "'"+value : value);
  });
  SpreadsheetApp.flush();
  PropertiesService.getDocumentProperties().deleteProperty(memberAssignmentKey_(roster,j.row));
}

/**
 * Injectable core: move the member at fromRow into the OPEN slot at toRow (transfer / promotion). MEMBER columns
 * (name, ID, hours, dates…) follow the person; SLOT columns (Rank/Callsign) belong to the destination, so the
 * member takes on that slot's rank and callsign. No audit / notify — the endpoint layers those on. Testable.
 */
function cpMoveMember_(roster, fromRow, toRow) {
  fromRow = Number(fromRow); toRow = Number(toRow);
  const pending = memberMoveJournal_(roster);
  if (pending) {
    if (pending.source !== fromRow || pending.target !== toRow) throw new Error('An interrupted transfer is pending. Use Recover Interrupted Transfer before starting another move.');
    resumeMemberMove_(roster,pending);
    return {name:pending.name,discord:pending.id,fromRank:pending.fromRank,toRank:pending.toRank,member:cpMemberAt_(roster,toRow),recovered:true};
  }
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
  cpAssertUniqueId_(roster,discord,fromRow);
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
      const pending = memberMoveJournal_(roster);
      const resuming = pending && pending.id === expectedId && pending.source === fromRow && pending.target === Number(payload && payload.toRow);
      if (idAt !== expectedId && !resuming) throw new Error('The roster changed since this panel loaded — refresh and try again.');
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
      r: diagnosticText_(msg,300), lv: runLogLevel_(msg, failed) });
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
      if (PropertiesService.getDocumentProperties().getProperty('RE_RUNTIME_MODE') === 'BOUND') {
        try { const p = PropertiesService.getScriptProperties(); p.deleteProperty(CONFIG.webhookProp); p.deleteProperty(ERRORS_WEBHOOK_PROP); } catch (e) { reportError_('purgeWebhooks.legacy',e,false); }
      }
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
      if (!lock.tryLock(5000)) raise_('E-503');
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
      if(res===false)raise_('E-503');
      return res > 0 ? `Synced ${res} new leave form${res === 1 ? '' : 's'} to the tracker.`
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
      cleaned = sortSignups_(review);
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
      if(typeof ensurePublicPublishingTriggers_==='function')ensurePublicPublishingTriggers_(false);
      const res = publishPublicRoster();
      if (res === false) raise_('E-503');
      if (!res || !res.linked) return 'No public roster is linked yet — set one up before publishing.';
      if(res.failed||res.aborted||(res.skipped&&res.skipped.length))throw new AppError('E-504',{operation:'Public publish',completed:res.tabs.length,reason:(res.detail||['Some tabs could not be mirrored.']).join('; ')});
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
    // A signup form can ask for BOTH a Community ID and a Discord ID. Which of them IS the unique key is
    // [ROSTER_LAYOUT].ID_TYPE's call, not keyword order's — resolving by order alone handed a COMMUNITY department's
    // review tab the Discord ID and dropped the real key entirely. An explicit "Unique ID" header still outranks both.
    let idType = 'DISCORD'; try { idType = norm_(CONFIG.idType || 'DISCORD'); } catch (e2) { /* config broken → Discord, the default */ }
    const byType = (idType === 'COMMUNITY') ? (all('COMMUNITY', 'ID') || all('CID')) : all('DISCORD');
    out.discord = exact('UNIQUE ID') || all('UNIQUE', 'ID') || byType || all('DISCORD') || all('COMMUNITY', 'ID') || all('CID');
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
    if (hRow > 1) out.width = Math.max(lastCol, framedTable_(sheet, out.dataStart).width);
  } catch (e) { log_('signupCols_', e); }
  return out;
}

/** First data row with no applicant IDENTITY (NAME + UNIQUE ID both empty), or the row past the end. NB: a stray STATUS
 *  value (a leftover dropdown pick / template) does NOT count as occupied — only real name/ID data does. */
function signupFirstFreeRow_(sheet, SC) {
  const last = Math.min(sheet.getLastRow(), framedTable_(sheet, SC.dataStart).cap - 1);
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

/** Roles the sync understands on both tabs. timestamp: the review tab sorts "newest first" off it when it has one. */
const SIGNUP_SYNC_ROLES_ = Object.freeze(['timestamp', 'name', 'ooc', 'discord', 'email', 'dob', 'phone', 'join']);

/** Roles that must keep their RAW value — real dates, because the engine reads them back as dates. */
const SIGNUP_RAW_ROLES_ = Object.freeze({ timestamp: 1, dob: 1, join: 1 });

/**
 * The column pairs the ROLE map cannot express: a review-tab column whose HEADER also exists on the form tab.
 *
 * Roles only cover fields whose MEANING the engine knows — that is what lets a form ask "Community ID" while the
 * review tab calls the same thing UNIQUE ID. Every other question on a signup form is the operator's own: a Discord
 * ID sitting alongside a Community ID, Date of Hire, a full legal name, Address. None of those carried across —
 * the sync wrote a blank and the applicant's answer stayed stranded on the responses tab.
 *
 * Matched on a punctuation-insensitive header key, so "Phone Number (REQUIRED)" and "PHONE NUMBER" are one column
 * and a form question can be re-worded without breaking. A ROLE mapping always wins: these pairs fill only columns
 * no role claimed, so a coincidental header match can never redirect a field the engine already understands.
 * STATUS and NOTES are excluded outright — they are admin-owned and a form submission must never write them.
 * @return {Array<{from:number, to:number}>} 1-based form column → review column.
 */
function signupHeaderPairs_(formSheet, fSC, signupSheet, sSC) {
  const pairs = [];
  try {
    const key = (h) => norm_(String(h == null ? '' : h).replace(/\([^)]*\)/g, ' ')).replace(/[^A-Z0-9]+/g, ' ').trim();
    const fHdr = formSheet.getRange(fSC.headerRow, 1, 1, Math.max(formSheet.getLastColumn(), 1)).getDisplayValues()[0];
    const sHdr = signupSheet.getRange(sSC.headerRow, 1, 1, Math.max(sSC.width, 1)).getDisplayValues()[0];
    const fBy = {};                                          // header key → form column; FIRST wins, so a duplicated question can't shadow the original
    fHdr.forEach((h, c) => { const k = key(h); if (k && !(k in fBy)) fBy[k] = c + 1; });
    const taken = {};
    SIGNUP_SYNC_ROLES_.concat(['status', 'notes']).forEach((r) => { if (sSC[r]) taken[sSC[r]] = 1; });
    sHdr.forEach((h, c) => {
      const col = c + 1, k = key(h);
      if (k && !taken[col] && fBy[k]) pairs.push({ from: fBy[k], to: col });
    });
  } catch (e) { log_('signupHeaderPairs_', e); }
  return pairs;
}

/**
 * Sync new signup-form submissions into the SIGNUPS review tab, matched by ROLE (name/ooc/id/email/dob/phone) and
 * then by HEADER for every column a role doesn't cover (signupHeaderPairs_). Mirrors syncFormToTracker_: a synced
 * form row is marked "done" (background) so re-scans never double-add. STATUS is stamped Pending; NOTES and any
 * admin-only columns are left untouched. Throws E-504 on partial failure. @return rows added.
 */
function syncSignupForm_(formSheet, signupSheet) {
  let added = 0;
  const newcomers = []; // {name, id} per NEW signup this pass — feeds the opt-in Discord embed below
  try {
    const formLast = formSheet.getLastRow();
    if (formLast < 2) return 0;
    const fSC = signupCols_(formSheet), sSC = signupCols_(signupSheet);
    if (!sSC.status || !sSC.discord) throw new Error('Signup review needs STATUS and UNIQUE ID headers.');               // the review tab needs at least STATUS + UNIQUE ID columns
    const width = formSheet.getLastColumn();
    const range = formSheet.getRange(2, 1, formLast - 1, width);
    const values = range.getValues();
    // DISPLAY text alongside the raw values. A 17-19 digit Unique ID read as a NUMBER loses precision the moment it
    // leaves the sheet — that is where "9.40457E+17" in the review tab's UNIQUE ID column comes from — and a
    // date-formatted blank in a text question (phone, address) arrives as the epoch, "31 Dec 1969". Only genuine
    // date roles keep their raw value; every text field copies exactly what the applicant typed.
    const disp = range.getDisplayValues();
    const backgrounds = range.getBackgrounds();
    const doneBg = String(CONFIG.bg.done).toLowerCase();
    const roles = SIGNUP_SYNC_ROLES_;
    const extra = signupHeaderPairs_(formSheet, fSC, signupSheet, sSC); // resolved ONCE — the headers can't change mid-pass
    // Free rows are computed ONCE. Calling signupFirstFreeRow_ inside the loop re-read the whole review tab per
    // added submission (O(n²) on a backfill). Same rule it applies: identity-free rows first, then append past the end.
    const freeRows = [];
    const reviewLast = Math.min(signupSheet.getLastRow(), framedTable_(signupSheet, sSC.dataStart).cap - 1);
    let nextAppend = Math.max(reviewLast + 1, sSC.dataStart);
    const existingKeys=new Set();
    if (reviewLast >= sSC.dataStart) {
      const blk = signupSheet.getRange(sSC.dataStart, 1, reviewLast - sSC.dataStart + 1, sSC.width).getDisplayValues();
      for (let r = 0; r < blk.length; r++) {
        if(String(blk[r][0]||'').indexOf('SIGNUP|')===0)existingKeys.add(String(blk[r][0]));
        const occupied = (sSC.name && String(blk[r][sSC.name - 1] || '').trim()) || (sSC.discord && String(blk[r][sSC.discord - 1] || '').trim());
        if (!occupied) freeRows.push(sSC.dataStart + r);
      }
    }
    for (let i = 0; i < values.length; i++) {
      const frow = values[i];
      // Skip rows with no applicant identity — an empty row read past the real submissions (formatting/validation can
      // push getLastRow down) must NEVER become a blank Pending row on the review tab.
      const fid = fSC.discord ? String(disp[i][fSC.discord - 1] || '').trim() : '';
      const fname = fSC.name ? String(disp[i][fSC.name - 1] || '').trim() : '';
      if (!fid && !fname) continue;
      const bg = String(backgrounds[i][0] || '').toLowerCase();
      if (bg === doneBg || bg === '#00ff00') continue;       // already synced
      const rowVals = new Array(sSC.width).fill('');
      roles.forEach((role) => {
        if (!fSC[role] || !sSC[role]) return;
        rowVals[sSC[role] - 1] = SIGNUP_RAW_ROLES_[role] ? frow[fSC[role] - 1] : disp[i][fSC[role] - 1];
      });
      extra.forEach((p) => { rowVals[p.to - 1] = disp[i][p.from - 1]; }); // the operator's own questions, matched by header
      if (sSC.headerRow > 1 && fSC.timestamp) {
        const submitted = frow[fSC.timestamp - 1];
        if (submitted instanceof Date && !isNaN(submitted.getTime())) rowVals[0] = 'SIGNUP|' + fid + '|' + submitted.getTime();
      }
      const submissionKey=String(rowVals[0]||'');
      if(submissionKey.indexOf('SIGNUP|')===0&&existingKeys.has(submissionKey)){formSheet.getRange(i+2,1,1,width).setBackground(CONFIG.bg.done);continue;}
      rowVals[sSC.status - 1] = SIGNUP_STATUSES_[0];         // new submission → Pending
      const at = freeRows.length ? freeRows.shift() : nextAppend++;
      if (typeof ensureRoomAboveCap_ === 'function') ensureRoomAboveCap_(signupSheet, at); // grow inside the band, never onto the closing bar
      else if (at > signupSheet.getMaxRows()) signupSheet.insertRowsAfter(signupSheet.getMaxRows(), at - signupSheet.getMaxRows());
      if(writeValuesSafe_(signupSheet, at, 1, [rowVals], null))throw new Error('Signup row contains unwritable cells.'); // merge-safe row write
      if (sSC.headerRow > 1) signupSheet.getRange(at, 1).setNumberFormat(';;;');
      signupSheet.getRange(at, sSC.discord).setNumberFormat('@'); // keep the Unique ID exact
      if(submissionKey.indexOf('SIGNUP|')===0)existingKeys.add(submissionKey);
      formSheet.getRange(i + 2, 1, 1, width).setBackground(CONFIG.bg.done); // mark this form row synced
      newcomers.push({ name: fname, id: fid });
      added++;
    }
    if (added) sortSignups_(signupSheet);
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
  } catch (e) { throw new AppError('E-504',{operation:'Signup sync',completed:added,reason:diagnosticText_((e&&e.message)||e)}); }
  return added;
}

/** Entry point: sync the linked signup form into the review tab. No-op when the feature is off (no form tab set). */
function syncSignupForm() {
  return cpWithLock_(()=>{
    if (!CONFIG.sheets.signupForm) return 0;
    const ss = SpreadsheetApp.getActive();
    const form = ss.getSheetByName(CONFIG.sheets.signupForm);
    const review = ss.getSheetByName(CONFIG.sheets.signups);
    if (!form || !review) throw new Error('The configured signup form or review tab is missing.');
    return syncSignupForm_(form, review);
  });
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
    // Import and sort are one serialized operation, including when there are no new submissions.
    const result=cpWithLock_(()=>{
      const form=ss.getSheetByName(CONFIG.sheets.signupForm),rev=ss.getSheetByName(CONFIG.sheets.signups);
      const added=syncSignupForm_(form,rev),cleaned=sortSignups_(rev);
      return {added,cleaned};
    });
    const added=result.added,cleaned=result.cleaned;
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
function signupStatusOrder_(sheet, SC) { return ['Flagged', 'Pending', 'Approved', 'Processed']; }

/** Stamp blank statuses as Pending, then re-group by the STATUS dropdown's own order (value rewrite; keeps formatting). */
function sortSignups_(sheet) {
  try {
    const SC = signupCols_(sheet), W = SC.width, ds = SC.dataStart;
    if (!SC.status || !W) return 0;
    const last = Math.min(sheet.getLastRow(), framedTable_(sheet, ds).cap - 1);
    if (last < ds) return 0;
    const n = last - ds + 1;
    const vals = sheet.getRange(ds, 1, n, W).getValues();
    const ids = SC.discord ? sheet.getRange(ds, SC.discord, n, 1).getDisplayValues() : null;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const r = vals[i].slice(0, W);
      if (ids) r[SC.discord - 1] = String(ids[i][0]).trim();
      const identity = (SC.name && String(r[SC.name - 1] || '').trim()) || (SC.discord && String(r[SC.discord - 1] || '').trim());
      if (!identity && String(r[0] || '').indexOf('SIGNUP|')!==0) continue; // retain submission/recovery evidence even if its visible identity was cleared
      if (String(r[SC.status - 1] || '').trim() === '') r[SC.status - 1] = SIGNUP_STATUSES_[0]; // new submission → Pending
      r._sourceRow = ds + i; rows.push(r);
    }
    if (!rows.length) return 0;
    const flow = signupStatusOrder_(sheet, SC); // the dropdown's order, e.g. Pending → Approve → Flagged → Processed
    const rank = {}; flow.forEach((s, i) => { if (!(norm_(s) in rank)) rank[norm_(s)] = i; });
    // Within a status group: Oldest submission first. Recency source, in order: (1) the form's own Timestamp, looked
    // up LIVE from the signup form tab by Unique ID — covers every row, including ones synced before recency existed
    // and review tabs with no TIMESTAMP column (no backfill needed); (2) the review tab's own TIMESTAMP column, when
    // it has one; (3) 0 — hand-added applicants keep their prior order.
    let formTs = null; // Unique ID -> submission ms (a re-submission keeps the LATEST)
    const needsFormTs=rows.some(r=>{const key=String(r[0] || '').split('|'),ts=key[0]==='SIGNUP' && key.length===3?Number(key[2]):0;const value=SC.timestamp?r[SC.timestamp-1]:'';return !(Number.isFinite(ts)&&ts>0) && !(value instanceof Date && Number.isFinite(value.getTime()))});
    try {
      const fsh = needsFormTs && CONFIG.sheets.signupForm ? SpreadsheetApp.getActive().getSheetByName(CONFIG.sheets.signupForm) : null;
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
      const key=String(r[0] || '').split('|'),submitted=key[0]==='SIGNUP' && key.length===3 ? Number(key[2]) : 0;
      if(Number.isFinite(submitted) && submitted>0)return submitted; // each submission owns its timestamp, even after the same member submits again
      const idv = SC.discord ? String(r[SC.discord - 1] || '').trim() : '';
      const v = SC.timestamp ? r[SC.timestamp - 1] : '';
      if(v instanceof Date && !isNaN(v.getTime()))return v.getTime();
      return formTs && idv && formTs[idv] ? formTs[idv] : 0;
    };
    const dec = rows.map((r, i) => ({ r: r, i: i, p: (norm_(String(r[SC.status - 1] || '').trim()) in rank) ? rank[norm_(String(r[SC.status - 1]).trim())] : flow.length, t: rec(r) }));
    dec.sort((a, b) => (a.p - b.p) || (a.t - b.t) || (a.i - b.i)); // stable
    const sorted = dec.map((d) => d.r);
    moveTableRecords_(sheet, ds, sorted, W);
    if (SC.discord) sheet.getRange(ds, SC.discord, sorted.length, 1).setNumberFormat('@');
    if(writeValuesSafe_(sheet, ds, 1, sorted, null))throw new Error('Signup sort contains unwritable cells.'); // merge-safe (see sortTracker_)
    if (last > ds + sorted.length - 1) { // survivors slid up → blank the rows they vacated so nothing is duplicated at the bottom
      const blanks = []; for (let k = ds + sorted.length; k <= last; k++) blanks.push(new Array(W).fill(''));
      if(writeValuesSafe_(sheet, ds + sorted.length, 1, blanks, null))throw new Error('Signup cleanup contains unwritable cells.');
    }
    if (typeof tidyTailRows_ === 'function') tidyTailRows_(sheet, ds, SC.status); // auto-rows: re-pad the blank tail / trim surplus blanks
    return sorted.length;
  } catch (e) { throw e; }
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
  if (!SC.status || last < SC.dataStart) return { queue, recent, waiting: 0 }; // `waiting` on EVERY path — the panel's badge reads it
  const n = last - SC.dataStart + 1;
  const vals = sheet.getRange(SC.dataStart, 1, n, SC.width).getDisplayValues();
  // The read-only card is driven ENTIRELY by this tab's own header row — one field per column, in sheet order.
  // It used to render a fixed five (Unique ID / Email / Date of birth / Phone / Dept. join date), which was wrong in
  // both directions: columns the department actually asks for were dropped, while roles it does NOT have a column
  // for still rendered as "Not provided". Worse, an engine label and a sheet header could describe the same thing
  // twice — "Dept. join date" next to the tab's own DATE OF HIRE. The headers are the single source of truth now.
  // Resolved ONCE per call, not per row. NAME and OOC are excluded because the editable half below already owns
  // them, STATUS because the chip beside the applicant's name is it, NOTES because it is admin-owned, not submitted.
  const fieldCols = [];
  try {
    const skip = {};
    // Only the two the panel genuinely owns. NAME and OOC used to be excluded because the editable half rendered
    // them separately; they live on the card now, keeping the ids the approve path reads, so they belong here with
    // the rest of the applicant's answers — and an edit to either saves to the tracker like every other field.
    ['status', 'notes'].forEach((r) => { if (SC[r]) skip[SC[r]] = 1; });
    sheet.getRange(SC.headerRow, 1, 1, SC.width).getDisplayValues()[0].forEach((h, c) => {
      const label = String(h || '').trim();
      if (!label || skip[c + 1]) return;
      const col = c + 1;
      fieldCols.push({ label: label, col: col, id: col === SC.discord, copy: col === SC.discord || col === SC.email,
        nm: col === SC.name, oc: col === SC.ooc }); // nm/oc: the panel gives these the ids approval reads
    });
  } catch (e) { log_('signupSplit_.fieldCols', e); }
  for (let i = 0; i < n; i++) {
    const g = (c) => c ? String(vals[i][c - 1] || '').trim() : '';
    if (!g(SC.name) && !g(SC.discord)) continue; // blank scaffolding row on a themed tab → not a submission
    const st = g(SC.status) || SIGNUP_STATUSES_[0];
    const rec = { row: SC.dataStart + i, key:String(vals[i][0] || '').indexOf('SIGNUP|')===0?String(vals[i][0]):'', status: st, name: g(SC.name), ooc: g(SC.ooc), discord: g(SC.discord),
      email: g(SC.email), dob: g(SC.dob), phone: g(SC.phone), join: g(SC.join), submitted: g(SC.timestamp),
      fields: fieldCols.map((x) => ({ k: x.label, v: g(x.col), id: x.id, copy: x.copy, nm: x.nm, oc: x.oc })) }; // the card, in sheet order
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
  assertNoPendingActivityReset_(roster);
  const SC = signupCols_(signups);
  const ed = edits || {};   // panel overrides — what the reviewer actually typed wins over the raw form answer
  if (!SC.discord || !SC.name || !SC.status) throw new Error('The signup tab needs Unique ID, Name and Status columns.');
  if([SC.name,SC.discord,SC.status,SC.email,SC.dob,SC.phone,SC.ooc,SC.join].indexOf(1)!==-1)throw new Error('The signup review table needs its first column reserved for the border/submission key. It cannot also hold an applicant field.');
  if (!Number.isInteger(row) || row<SC.dataStart || row>signups.getLastRow()) throw new Error('Invalid signup row.');
  const g = (c) => c ? String(signups.getRange(row, c).getDisplayValue()).trim() : '';
  const id = g(SC.discord);
  const name = String(ed.name != null && String(ed.name).trim() !== '' ? ed.name : g(SC.name)).trim();
  if (!isValidId_(id)) throw new Error(`Signup row ${row} has no valid Unique ID (${idDigitsLabel_()} digits).`);
  if (!name) throw new Error(`Signup row ${row} has no name.`);
  const approvalKey='RE_SIGNUP_APPROVAL:'+signups.getSheetId()+':'+id;
  const props=PropertiesService.getDocumentProperties(), pending=props.getProperty(approvalKey);
  if (pending) {
    let journal; try { journal=JSON.parse(pending); } catch(e) { throw new Error('Signup approval recovery record is unreadable. Inspect it before approving again.'); }
    if (!journal || !journal.payload || journal.slotRow!==Number(slotRow) || journal.payload.name!==name || journal.payload.ooc!==String(ed.ooc != null?ed.ooc:g(SC.ooc)).trim() || journal.payload.status!==String(ed.status || '').trim() || journal.payload.shift!==String(ed.shift || '').trim()) throw new Error('An interrupted signup approval reserves its original member/slot and edits. Use Recover Interrupted Transfer to finish it.');
    return resumeSignupApproval_(signups,roster,journal,approvalKey);
  }
  if (cpFindRowById_(roster, id) !== -1) throw new Error(`${name} is already on the roster — mark this signup Processed instead.`);
  const RC = rosterCols_(roster);
  const oocV = String(ed.ooc != null ? ed.ooc : g(SC.ooc)).trim();
  const payload={row:Number(slotRow),name,discord:id,ooc:oocV,status:String(ed.status || '').trim(),shift:String(ed.shift || '').trim()};
  if (RC.join && SC.join) {
    const value=signups.getRange(row,SC.join).getValue();
    if (value!=='' && value!=null) {
      const date=value instanceof Date ? value : cpParseYMD_(String(value));
      if (!Number.isFinite(date.getTime())) throw new Error('Signup join date is invalid. Correct it before seating this applicant.');
      payload.joinDate=Utilities.formatDate(date,ssTz_(),'yyyy-MM-dd');
    }
  }
  cpAssertSlotRow_(roster,Number(slotRow));
  if (String(roster.getRange(slotRow,RC.name).getDisplayValue()).trim() || String(roster.getRange(slotRow,RC.discord).getDisplayValue()).trim()) throw new Error('The selected slot is no longer empty.');
  const P=rosterPiiCols_(roster), fields=[], seen=new Set(), protectedCols=new Set([RC.rank,RC.name,RC.discord,RC.unit,RC.hours,RC.activity,RC.join,RC.ooc,RC.shift].filter(c=>c>0));
  [[P.email,g(SC.email)],[P.dob,g(SC.dob)],[P.phone,g(SC.phone)]].forEach(([col,value])=>{
    if (!col || !value) return;
    if (!Number.isInteger(col) || col<1 || col>roster.getLastColumn() || seen.has(col) || protectedCols.has(col)) throw new Error('Private signup fields overlap another roster column. Correct the column mappings before approving.');
    seen.add(col);fields.push({col,before:memberMoveSnapshot_(roster.getRange(slotRow,col))[0],after:{content:{value},formula:''}});
  });
  let sourceKey=String(signups.getRange(row,1).getDisplayValue()).trim();
  if (sourceKey.indexOf('SIGNUP|')!==0) sourceKey='SIGNUP|'+id+'|'+Utilities.getUuid();
  const sourceValues=JSON.stringify([SC.name,SC.discord,SC.email,SC.dob,SC.phone,SC.ooc,SC.join].map(g));
  const journal={version:1,book:roster.getParent().getId(),rosterSheet:roster.getSheetId(),sourceBook:signups.getParent().getId(),sourceSheet:signups.getSheetId(),sourceKey,sourceName:g(SC.name),sourceStatus:g(SC.status),sourceValues,sourceLayout:JSON.stringify(SC),rosterLayout:JSON.stringify(RC),slotRow:Number(slotRow),payload,fields};
  const encoded=JSON.stringify(journal);
  if (encodeURIComponent(encoded).replace(/%[A-F\d]{2}/gi,'x').length>8000) throw new Error('Signup approval exceeds the safe recovery storage limit. No applicant was seated.');
  signups.getRange(row,1).setNumberFormat('@').setValue(sourceKey);
  SpreadsheetApp.flush();
  props.setProperty(approvalKey,encoded); // link seating and source acknowledgement BEFORE either happens
  return resumeSignupApproval_(signups,roster,journal,approvalKey);
}

function resumeSignupApproval_(signups,roster,j,key) {
  assertNoPendingActivityReset_(roster);
  const SC=signupCols_(signups),RC=rosterCols_(roster);
  if (!j || j.version!==1 || !j.payload || !isValidId_(j.payload.discord) || !Number.isInteger(j.slotRow) || j.slotRow<CONFIG.rosterStartRow || j.slotRow>roster.getMaxRows() || j.payload.row!==j.slotRow || !j.payload.name || j.book!==roster.getParent().getId() || j.rosterSheet!==roster.getSheetId() || j.sourceBook!==signups.getParent().getId() || j.sourceSheet!==signups.getSheetId() || j.sourceLayout!==JSON.stringify(SC) || j.rosterLayout!==JSON.stringify(RC) || !Array.isArray(j.fields)) throw new Error('Signup approval recovery does not match the original workbook/sheet layout.');
  const n=signups.getLastRow()-SC.dataStart+1;
  const matches=[];if(n>0)signups.getRange(SC.dataStart,1,n,1).getDisplayValues().forEach((r,i)=>{if(String(r[0]).trim()===j.sourceKey)matches.push(SC.dataStart+i)});
  if(matches.length!==1)throw new Error('Signup approval source key is missing or duplicated. Inspect the review queue before recovery.');
  const row=matches[0],status=String(signups.getRange(row,SC.status).getDisplayValue()).trim();
  const sourceValues=JSON.stringify([SC.name,SC.discord,SC.email,SC.dob,SC.phone,SC.ooc,SC.join].map(c=>c?String(signups.getRange(row,c).getDisplayValue()).trim():''));
  if(j.sourceValues!==sourceValues)throw new Error('Signup answers changed after an interrupted approval. Inspect the source and recorded plan before recovery.');
  if(String(signups.getRange(row,SC.discord).getDisplayValue()).trim()!==j.payload.discord || String(signups.getRange(row,SC.name).getDisplayValue()).trim()!==j.sourceName || (status!==j.sourceStatus && status!==SIGNUP_STATUSES_[2]))throw new Error('Signup was edited after an interrupted approval. Inspect its identity/status before recovery.');
  const allowed=new Set(Object.values(rosterPiiCols_(roster)).filter(c=>Number.isInteger(c)&&c>0)),seen=new Set();
  const protectedCols=new Set([RC.rank,RC.name,RC.discord,RC.unit,RC.hours,RC.activity,RC.join,RC.ooc,RC.shift].filter(c=>c>0));
  const details=j.fields.map(f=>{
    if(!f || !allowed.has(f.col) || protectedCols.has(f.col) || seen.has(f.col) || !f.after || !f.after.content || typeof f.after.content.value!=='string' || !f.before)throw new Error('Signup private-field recovery plan is invalid.');
    seen.add(f.col);const cell=roster.getRange(j.slotRow,f.col),live=memberMoveSnapshot_(cell)[0];
    if(!memberMoveCellMatches_(live,f.before)&&!memberMoveCellMatches_(live,f.after))throw new Error('Signup private details changed after an interrupted approval. No conflicting values were overwritten.');
    return {cell,value:f.after.content.value,done:memberMoveCellMatches_(live,f.after)};
  });
  const assigned=cpFindRowById_(roster,j.payload.discord),assignment=memberAssignmentJournal_(roster,j.slotRow);
  if(assignment || assigned===-1)cpAssignMember_(roster,j.payload,key);
  else if(assigned!==j.slotRow || String(roster.getRange(assigned,RC.name).getDisplayValue()).trim()!==j.payload.name)throw new Error('The approved member moved or changed identity before acknowledgement. Inspect the roster before recovery.');
  details.forEach(d=>{if(!d.done)d.cell.setNumberFormat('@').setValue(d.value.startsWith('=')?"'"+d.value:d.value)});
  SpreadsheetApp.flush();
  signups.getRange(row,SC.status).setValue(SIGNUP_STATUSES_[2]);
  SpreadsheetApp.flush();
  PropertiesService.getDocumentProperties().deleteProperty(key);
  return {ok:true,name:j.payload.name,discord:j.payload.discord,slotRow:j.slotRow,piiWritten:j.fields.length};
}

function pendingSignupApprovals_() {
  const props=PropertiesService.getDocumentProperties().getProperties();
  return Object.keys(props).filter(k=>k.indexOf('RE_SIGNUP_APPROVAL:')===0).map(key=>{
    let journal;try{journal=JSON.parse(props[key])}catch(e){throw new Error('Signup approval recovery record is unreadable.')}
    if(!journal || journal.version!==1 || !journal.payload)throw new Error('Signup approval recovery record has an invalid shape.');
    return {key,journal};
  });
}

function recoverSignupApprovals_() {
  const ss=SpreadsheetApp.getActive(),roster=ss.getSheetByName(CONFIG.sheets.roster),records=pendingSignupApprovals_();
  if(!records.length)return [];
  const file=adminFile_();
  return records.map(({key,journal:j})=>{
    const source=j.sourceBook===ss.getId()?ss:(file&&file.getId()===j.sourceBook?file:null);
    if(!source || !roster)throw new Error('The original signup review workbook is not linked. Restore its link before recovering approvals.');
    const sheet=source.getSheets().find(s=>s.getSheetId()===j.sourceSheet);
    if(!sheet)throw new Error('The original signup review sheet is missing.');
    const result=resumeSignupApproval_(sheet,roster,j,key);
    publishMarkDirty_();deferWork_('academy');deferWork_('groups');deferWork_('dashboard');
    try{sortSignups_(sheet);}catch(e){deferWork_('signupOrder');log_('WARN','Recovered signup approval; review sorting will retry: '+String(e));}
    return {name:result.name,fromRank:'',toRank:'',assignment:true};
  });
}

/** Retry queue organization under the same writer lock; the deferred job retains failures with backoff. */
function sortSignupQueues_() {
  const lock=LockService.getScriptLock(),held=lock.hasLock();
  if(!held && !lock.tryLock(1000))throw new Error('Signup sorting is waiting for another roster operation.');
  let primary;
  try {
    const ss=SpreadsheetApp.getActive(),file=adminFile_(),books=[ss],seen=new Set();
    if(file && file.getId()!==ss.getId())books.push(file);
    let count=0;
    books.forEach(book=>{const sheet=book.getSheetByName(CONFIG.sheets.signups);if(sheet && !seen.has(book.getId()+':'+sheet.getSheetId())){sortSignups_(sheet);seen.add(book.getId()+':'+sheet.getSheetId());count++}});
    if(!count)throw new Error('No linked signup review table could be sorted. Restore the original review link.');
    return {sorted:count};
  }catch(e){primary=e;throw e}finally{if(!held){try{lock.releaseLock()}catch(e){if(primary)log_('sortSignupQueues_.release',e);else throw e}}}
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
    const ids=roster.getRange(start,RC.discord,n,1).getDisplayValues();
    const reserved=new Set(memberAssignmentRows_(roster));
    pendingSignupApprovals_().forEach(({journal:j})=>{if(j.book===roster.getParent().getId() && j.rosterSheet===roster.getSheetId())reserved.add(j.slotRow)});
    const units = RC.unit ? roster.getRange(start, RC.unit, n, 1).getDisplayValues() : null;
    for (let i = 0; i < n; i++) {
      const rank = String(ranks[i][0]).trim();
      if (!isMemberSlot_(rank) || rank === '' || rank === 'Rank') continue;
      if (String(names[i][0]).trim() !== '') continue; // filled → not open
      if (String(ids[i][0]).trim() || reserved.has(start+i)) continue; // incomplete/unnamed member fields are not a free slot
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
  let keySeen='';
  const toPending = () => {
    const recoveryLock = LockService.getScriptLock();
    if (!recoveryLock.tryLock(1000)) return false; // leave the row alone if another writer is active
    try {
      if(idSeen && PropertiesService.getDocumentProperties().getProperty('RE_SIGNUP_APPROVAL:'+signups.getSheetId()+':'+idSeen))return false; // preserve acknowledgement evidence
      // Never reset a different applicant merely because the original row disappeared.
      const rr = signupResolveRow_(signups, row, idSeen,keySeen);
      signups.getRange(rr, SC.status).setValue(SIGNUP_STATUSES_[0]);
      return true;
    } catch (ig) { return false; } finally { try{recoveryLock.releaseLock()}catch(e){log_('approveSignupFromSheet_.recoveryRelease',e)} }
  };
  try {
    const g = (c) => c ? String(signups.getRange(row, c).getDisplayValue()).trim() : '';
    const name = g(SC.name), id = g(SC.discord);
    idSeen = id;
    const sourceKey=g(1);keySeen=sourceKey.indexOf('SIGNUP|')===0?sourceKey:'';
    if(id && PropertiesService.getDocumentProperties().getProperty('RE_SIGNUP_APPROVAL:'+signups.getSheetId()+':'+id))throw new Error('An interrupted approval is pending. Use Roster → Recover Interrupted Transfer before changing this signup again.');
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
    // Acquire after the prompt: Apps Script suspends prompts and does not retain locks across them.
    const approvalLock = LockService.getScriptLock();
    if (!approvalLock.tryLock(3000)) throw new Error('Another roster write is in progress — retry this approval.');
    let result;
    let primary;
    try {
      const rowNow = signupResolveRow_(signups, row, id,keySeen); // follow the exact submission after the prompt
      result = approveSignup_(signups, rowNow, roster, slot.row); // re-checks the selected slot before assigning
    } catch(e){primary=e;throw e}finally { try{approvalLock.releaseLock()}catch(e){if(primary)log_('approveSignupFromSheet_.release',e);else throw e} }
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
    const recovered = toPending();
    try { ui.alert('🧾 Approve Signup', 'Could not approve: ' + ((e && e.message) || e)
      + (recovered ? '\n\nSTATUS reset to Pending — fix the issue and try again.' : '\n\nCould not safely reset this applicant’s status. Refresh the signup list and review it before retrying.'), ui.ButtonSet.OK); } catch (ig) {}
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
  if(String(name).indexOf('🧪')===0)return true; // local QA fixtures/reports are internal only
  const sheets = CONFIG.sheets || {};
  if ([sheets.audit,sheets.integrity,sheets.snapshots,sheets.hoursHistory,sheets.signups,sheets.signupForm,sheets.form,sheets.patrol].some((tab) => tab && norm_(tab) === n)) return true;
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
    const filled = grid[r].filter((v) => String(v).trim() !== '').length;
    const labels = grid[r].filter((v) => /^(NAME|MEMBER NAME|RANK|STATUS|ACTIVITY|HOURS|EMAIL|EMAIL ADDRESS|DATE OF BIRTH|DOB|PHONE|ADDRESS|UNIQUE ID|DISCORD ID|START DATE|END DATE|TIMESTAMP|CALLSIGN)$/.test(norm_(v))).length;
    const score = filled + (labels >= 2 ? labels * 100 : 0);
    if (score > bestN) { bestN = score; best = r + 1; }
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
  // A text value starting with '=' is not a formula; do not execute it on the public file.
  v.forEach((row) => row.forEach((value,c) => { if (typeof value === 'string' && value.charAt(0) === '=') row[c] = "'" + value; }));
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
    try { dest.getRange(top, left, rows, cols).setValues(values); return 0; } catch (e) { if(!/merge|spill|array result/i.test(String((e&&e.message)||e)))throw e; }
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
    catch (e) { if(!/merge|spill|array result/i.test(String((e&&e.message)||e)))throw e;for (let r = r0; r <= r1; r++) writeRuns(r); }
  };
  const writeRuns = (r) => {
    let c = 0;
    while (c < cols) {
      if (blocked[r][c] || kept(r, c)) { c++; continue; }
      let e = c; while (e + 1 < cols && !blocked[r][e + 1] && !kept(r, e + 1)) e++;
      const block = [values[r].slice(c, e + 1)];
      try { dest.getRange(top + r, left + c, 1, block[0].length).setValues(block); }
      catch (err) {
        if(!/merge|spill|array result/i.test(String((err&&err.message)||err)))throw err;
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
 * Re-dress any data row that doesn't look like the tab's OWN styled rows.
 *
 * This is the case neither existing repair can see. publishFitRows_ grows the public tab with
 * insertRowsBefore, and an inserted row inherits its neighbour's DATA VALIDATION — so a row can arrive
 * carrying the STATUS dropdown while wearing none of the banding. healUnstyledRows_ keys off that dropdown
 * and reads the row as already dressed; styleTailRows_ compares the blank tail against the last data row and,
 * with both of them raw, concludes there is nothing to do. Between them the row is invisible, which is exactly
 * how a published Patrol Log row stays black.
 *
 * The reference is the TOP of the data block — one row per parity, so alternating banding stays alternating.
 * Deliberately not the most COMMON look: raw rows arrive at the bottom as the roster grows, and a mode would
 * flip to the raw look the moment the unstyled run outnumbered the styled one, repainting the whole tab wrong.
 * The two reference rows must themselves carry the dropdown, or there is nothing trustworthy to copy and this
 * does nothing at all.
 *
 * Only the CONTIGUOUS TRAILING RUN is repaired — the scan walks up from the last data row and stops at the first
 * row that already matches its parity reference. That bound is what makes this safe on the roster, whose data
 * block has the operator's SECTION DIVIDERS interleaved in it: a divider's look differs from a data row's by
 * design, and a whole-block sweep would repaint every one of them. healUnstyledRows_ is safe there for free
 * (a divider has no STATUS dropdown, so it is never a candidate); working off backgrounds, this one has to be
 * bounded explicitly. Merged rows — how these layouts build a divider — end the scan for the same reason.
 * @return {number} rows re-dressed.
 */
function publishMatchRowLook_(sheet, dataStart, lastData, statusCol, width) {
  try {
    const n = lastData - dataStart + 1;
    if (n < 3) return 0;                                   // need two reference rows plus something below them
    if (statusCol) {
      const dv = sheet.getRange(dataStart, statusCol, 2, 1).getDataValidations();
      if (!dv[0][0] || !dv[1][0]) return 0;                // the top rows aren't dressed either → copy nothing
    }
    const block = sheet.getRange(dataStart, 1, n, width);
    const bgs = block.getBackgrounds();
    const sig = (r) => bgs[r - dataStart].join('|');
    const refOf = {};                                      // row parity → the row to copy that parity's look from
    refOf[dataStart % 2] = dataStart;
    refOf[(dataStart + 1) % 2] = dataStart + 1;
    if (sig(dataStart) === sig(dataStart + 1)) refOf[(dataStart + 1) % 2] = dataStart; // no band → one look for all
    const merged = {};                                     // section dividers: the operator's, never a data row's peer
    try {
      block.getMergedRanges().forEach((m) => {
        const a = m.getRow(), b = a + m.getNumRows() - 1;
        for (let r = a; r <= b; r++) merged[r] = 1;
      });
    } catch (e2) { /* merge lookup is best-effort; the contiguity bound still holds */ }
    let first = lastData + 1;
    for (let r = lastData; r >= dataStart + 2; r--) {
      if (merged[r] || sig(r) === sig(refOf[r % 2])) break; // a divider, or a row already wearing the right look
      first = r;
    }
    if (first > lastData) return 0;
    const CAP = 200;
    const last = Math.min(lastData, first + CAP - 1);
    if (last < lastData) logWarn_('publishMatchRowLook_', `${sheet.getName()}: ${lastData - first + 1} rows differ from the tab's own look — re-dressed ${CAP} this pass; the next publish continues.`);
    for (let r = first; r <= last; r++) {
      const src = sheet.getRange(refOf[r % 2], 1, 1, width), dst = sheet.getRange(r, 1, 1, width);
      src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
      try { const h = sheet.getRowHeight(refOf[r % 2]); if (sheet.getRowHeight(r) !== h) sheet.setRowHeight(r, h); } catch (e3) { /* height is best-effort */ }
    }
    logInfo_('publishMatchRowLook_', `${sheet.getName()}: re-dressed ${last - first + 1} row(s) that carried the dropdown but none of the banding (rows ${first}-${last}).`);
    return last - first + 1;
  } catch (e) { logWarn_('publishMatchRowLook_', 'row look-match skipped: ' + ((e && e.message) ? e.message : e)); return 0; }
}

/** Per-tab note from the last publishDressRows_ call — surfaced in the publish report so a miss is diagnosable. */
let _dressNote_ = '';

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
  _dressNote_ = '';
  if (!(dh > 0)) { _dressNote_ = 'dress: no header row found'; return; }
  // `lastData` arrives from the SOURCE (the FULL path passes src.getLastRow()), and the two sheets do not have to
  // end on the same row. Clamp it to the DESTINATION before either repair runs:
  //   • getMaxRows() - 1 — the public tab's final row is its closing bar, and dressing it as a data row would
  //     repaint the operator's end-of-sheet marker. styleTailRows_ guards its own final row; healUnstyledRows_
  //     trusts its caller, so the guard has to live here or a source tab whose bar carries text takes the public
  //     bar with it.
  //   • getLastRow() — never claim rows the destination does not actually hold.
  const last = Math.min(Number(lastData) || 0, dest.getLastRow(), dest.getMaxRows() - 1);
  const ds = publishDataStart_(dest.getName(), dh);
  if (!(last > ds)) { _dressNote_ = `dress: no rows in range (${ds}-${last})`; return; } // need a row above to copy from
  const col = publishStatusCol_(dest, dh, width);
  let healed = 0, matched = 0;
  // 1) rows carrying no dropdown at all — they were never dressed, whatever colour they happen to be.
  try { if (typeof healUnstyledRows_ === 'function') healed = healUnstyledRows_(dest, ds, last, col, width) || 0; }
  catch (e) { log_('publishDressRows_.heal', e); }
  // 2) rows that INHERITED the dropdown from an insert but none of the banding — invisible to both of the others.
  try { matched = publishMatchRowLook_(dest, ds, last, col, width) || 0; }
  catch (e) { log_('publishDressRows_.look', e); }
  // 3) the blank tail, so the next published row lands on a dressed one.
  try { if (typeof styleTailRows_ === 'function') styleTailRows_(dest, ds, last, Math.max(0, dest.getMaxRows() - 1 - last), width); }
  catch (e) { log_('publishDressRows_.tail', e); }
  _dressNote_ = `dress ${ds}-${last} col ${col || 'none'} · healed ${healed} · matched ${matched}`;
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
    if(deep&&typeof publishDimensionsFast_==='function'&&publishDimensionsFast_(src,dest,n,0,{srcStart,destStart}))return;
    const from = deep ? 0 : Math.max(0, n - 5); // shallow: just the tail, where published rows are added
    for (let i = from; i < n; i++) {
      const sr = srcStart + i, dr = destStart + i;
      if (sr > src.getMaxRows() || dr > dest.getMaxRows()) break;
      const h = src.getRowHeight(sr);
      if (dest.getRowHeight(dr) !== h) dest.setRowHeight(dr, h);
    }
  } catch (e) { logWarn_('publishMirrorHeights_', 'row heights skipped for ' + dest.getName() + ': ' + ((e && e.message) ? e.message : e)); }
}

/** Freeze a native sheet copy using Sheets' own value paste, rather than rebuilding
 * merged anchors / CellImage values through setValue. Keeps text literals literal.
 * Both ranges are in the internal workbook; redaction happens before any public copy.
 */
function publishFreezeSnapshot_(src, snapshot, rows, cols) {
  if (!rows || !cols) return;
  const source = src.getRange(1,1,rows,cols);
  const richText = source.getRichTextValues();
  const literals=[];
  source.getValues().forEach((row,r)=>row.forEach((value,c)=>{
    if(typeof value==='string'&&/^\s*=/.test(value))literals.push({r,c,value});
  }));
  // Capture before writing: a value paste or rich-text write can reinterpret an
  // '=' string as a formula. Never send these strings through the rich-text writer.
  const formulas=literals.length?source.getFormulas():null;
  literals.forEach(({r,c})=>{if(richText[r])richText[r][c]=null;});
  source.copyTo(snapshot.getRange(1,1,rows,cols), SpreadsheetApp.CopyPasteType.PASTE_VALUES, false);
  // A value paste can discard mixed typography / links. Static rich text is safe to
  // restore, including the displayed text of ordinary HYPERLINK formulas.
  publishRestoreRichText_(source,snapshot,richText);
  if(!literals.length)return;
  const anchors=new Map(source.getMergedRanges().map(m=>[m.getRow()+':'+m.getColumn(),m]));
  for(let i=0;i<literals.length;i++){
    const {r,c,value}=literals[i];
    if(formulas[r][c]){
      // Freeze a formula whose computed result starts with '=' as escaped text.
      // Cell formatting remains on the native snapshot; no live formula is copied.
      snapshot.getRange(r+1,c+1).setValue("'"+value);
    }else{
      // Normal native paste preserves the original string type, rich runs and links.
      // For a merged anchor, copy its complete merge rather than one partial cell.
      const merge=anchors.get((r+1)+':'+(c+1));
      const height=merge?merge.getNumRows():1;let width=merge?merge.getNumColumns():1;
      // Adjacent unmerged literals share one native paste instead of one per cell.
      while(!merge&&i+1<literals.length){
        const next=literals[i+1];
        if(next.r!==r||next.c!==c+width||formulas[r][next.c]||anchors.has((r+1)+':'+(next.c+1)))break;
        width++;i++;
      }
      src.getRange(r+1,c+1,height,width).copyTo(snapshot.getRange(r+1,c+1,height,width),SpreadsheetApp.CopyPasteType.PASTE_NORMAL,false);
    }
  }
}

/** Batch text rectangles. Never include numeric/image cells or partially overlap
 * a merge; each merged anchor is restored once. */
function publishRestoreRichText_(source,snapshot,texts) {
  const blocked=new Set(),anchors=[];
  source.getMergedRanges().forEach(m=>{
    const r=m.getRow()-1,c=m.getColumn()-1;
    for(let i=r;i<r+m.getNumRows();i++)for(let j=c;j<c+m.getNumColumns();j++)blocked.add(i+':'+j);
    anchors.push([r,c]);
  });
  const has=text=>text&&text.getText()!=='';
  const active=new Map();
  const flush=run=>snapshot.getRange(run.row+1,run.start+1,run.rows,run.end-run.start).setRichTextValues(texts.slice(run.row,run.row+run.rows).map(row=>row.slice(run.start,run.end)));
  texts.forEach((row,r)=>{
    const current=new Map();let c=0;
    while(c<row.length){
      if(!has(row[c])||blocked.has(r+':'+c)){c++;continue;}
      const start=c;while(c<row.length&&has(row[c])&&!blocked.has(r+':'+c))c++;
      const key=start+':'+c,previous=active.get(key);
      if(previous){previous.rows++;current.set(key,previous);}
      else current.set(key,{row:r,start,end:c,rows:1});
    }
    active.forEach((run,key)=>{if(!current.has(key))flush(run);});
    active.clear();current.forEach((run,key)=>active.set(key,run));
  });
  active.forEach(flush);
  anchors.forEach(([r,c])=>{if(texts[r]&&has(texts[r][c]))snapshot.getRange(r+1,c+1).setRichTextValue(texts[r][c]);});
}

/** Prepare a redacted native snapshot internally; private data never enters the public carrier. */
function publishFramedTable_(src, dest) {
  const start = src.getName() === CONFIG.sheets.tracker ? CONFIG.trackerStartRow : CONFIG.patrolStartRow;
  const table = framedTable_(src, start), rows = Math.min(table.cap, src.getMaxRows()), width = table.width;
  const target = dest.getParent(), owner = src.getParent();
  let local = null, carrier = null;
  try {
    local = src.copyTo(owner);
    local.setName('_table_snapshot_' + Date.now());
    publishFreezeSnapshot_(src,local,rows,width);
    const header = publishHeaderRow_(src);
    if (header) src.getRange(header,1,1,width).getDisplayValues()[0].forEach((h,c) => {
      if (publishSensitiveHeader_(h) && rows > header) local.getRange(header+1,c+1,rows-header,1).clearContent();
    });
    // Hidden key/credit markers are engine-only bookkeeping in the left border.
    local.getRange(start,1,rows-start+1,1).clearContent();
    // Remove all unused cells before copying across workbooks, including private
    // content outside the detected frame. The public carrier contains only this table.
    if (local.getMaxRows() > rows) local.deleteRows(rows+1,local.getMaxRows()-rows);
    if (local.getMaxColumns() > width) local.deleteColumns(width+1,local.getMaxColumns()-width);
    local.getRange(1, 1, local.getMaxRows(), local.getMaxColumns()).clearNote();
    local.getDeveloperMetadata().forEach((m) => m.remove());
    SpreadsheetApp.flush();
    carrier = local.copyTo(target);
    if (dest.getMaxColumns() < width) dest.insertColumnsAfter(dest.getMaxColumns(), width - dest.getMaxColumns());
    if (dest.getMaxColumns() > width) dest.deleteColumns(width + 1, dest.getMaxColumns() - width);
    if (dest.getMaxRows() < rows) dest.insertRowsAfter(dest.getMaxRows(), rows - dest.getMaxRows());
    if (dest.getMaxRows() > rows) dest.deleteRows(rows + 1, dest.getMaxRows() - rows);
    const source = carrier.getRange(1, 1, rows, width), range = dest.getRange(1, 1, rows, width);
    range.breakApart();
    range.clearContent();
    source.copyTo(range, SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
    const rules = [];
    src.getConditionalFormatRules().forEach((rule) => {
      const ranges = rule.getRanges().filter((g) => g.getRow() <= rows && g.getColumn() <= width).map((g) =>
        dest.getRange(g.getRow(), g.getColumn(), Math.min(g.getNumRows(), rows - g.getRow() + 1), Math.min(g.getNumColumns(), width - g.getColumn() + 1)));
      if (ranges.length) rules.push(rule.copy().setRanges(ranges).build());
    });
    dest.setConditionalFormatRules(rules);
    publishCopyDimensions_(src,dest,rows,width);
    return rows;
  } finally {
    if (carrier) target.deleteSheet(carrier);
    if (local) owner.deleteSheet(local);
  }
}

/** The Welcome Page is an exact sheet snapshot, not a header-matched data export.
 * Native sheet copies retain the entire canvas, merges, dimensions and sheet objects.
 * Prepare in the internal workbook first; cross-sheet formulas become their displayed values.
 * Keep the previous public sheet until preparation succeeds. Public formulas referencing it
 * are restored after the swap, because Sheets otherwise rewrites their references to the backup.
 */
function publishWelcomePage_(src, dest) {
  const owner = src.getParent(), target = dest.getParent(), name = dest.getName();
  const index = dest.getIndex(), rows = src.getMaxRows(), cols = src.getMaxColumns();
  const refs = [];
  const quoted = "'" + name.replace(/'/g, "''") + "'!";
  target.getSheets().forEach((sheet) => {
    if (sheet.getSheetId() === dest.getSheetId()) return;
    const formulas = sheet.getDataRange().getFormulas();
    formulas.forEach((row, r) => row.forEach((formula, c) => {
      if (formula && (formula.indexOf(quoted) !== -1 || formula.indexOf(name + '!') !== -1)) refs.push({ sheet, row:r+1, col:c+1, formula });
    }));
  });
  let local = null, replacement = null, renamed = false;
  let titleFormulas = [];
  const backup = '_welcome_previous_' + Date.now();
  try {
    SpreadsheetApp.flush();
    local = src.copyTo(owner);
    local.setName('_welcome_snapshot_' + Date.now());
    const usedRows = src.getLastRow(), usedCols = src.getLastColumn();
    const sourceRange = usedRows && usedCols ? src.getRange(1,1,usedRows,usedCols) : null;
    if (sourceRange) publishFreezeSnapshot_(src,local,usedRows,usedCols);
    SpreadsheetApp.flush();
    replacement = local.copyTo(target);
    if (replacement.getMaxRows() !== rows || replacement.getMaxColumns() !== cols) throw new Error('Welcome Page grid dimensions did not copy.');
    // Copy every dimension explicitly, including blank canvas outside the used cells.
    publishCopyDimensions_(src,replacement,rows,cols);
    // The public title block is the sole exception. Copy it within the public workbook
    // so its content, rich text, formatting, validation and merges remain public-owned.
    if (rows >= 6 && cols >= 6) {
      const titleRows = Math.min(2,rows-5), titleCols = Math.min(18,cols-5);
      const title = replacement.getRange(6,6,titleRows,titleCols);
      title.breakApart(); title.clear();
      if (dest.getMaxRows() >= 6 && dest.getMaxColumns() >= 6) {
        const saved = dest.getRange(6,6,Math.min(titleRows,dest.getMaxRows()-5),Math.min(titleCols,dest.getMaxColumns()-5));
        titleFormulas = saved.getFormulas();
        saved.copyTo(replacement.getRange(6,6,saved.getNumRows(),saved.getNumColumns()));
      }
    }
    dest.setName(backup); renamed = true;
    replacement.setName(name);
    const hidden = src.isSheetHidden();
    replacement.showSheet();
    target.setActiveSheet(replacement); target.moveActiveSheet(index);
    refs.forEach((ref) => ref.sheet.getRange(ref.row,ref.col).setFormula(ref.formula));
    titleFormulas.forEach((row,r) => row.forEach((formula,c) => { if (formula) replacement.getRange(6+r,6+c).setFormula(formula); }));
    SpreadsheetApp.flush();
    if (hidden) replacement.hideSheet();
    target.deleteSheet(dest);
    replacement = null; // committed: do not delete the published snapshot during cleanup
    return rows;
  } catch (e) {
    if(replacement){try{target.deleteSheet(replacement);replacement=null;}catch(cleanupError){log_('publishWelcomePage_.rollbackDelete',cleanupError);}}
    if(renamed){try{dest.setName(name);}catch(cleanupError){log_('publishWelcomePage_.rollbackName',cleanupError);}}
    refs.forEach(ref=>{try{ref.sheet.getRange(ref.row,ref.col).setFormula(ref.formula);}catch(cleanupError){log_('publishWelcomePage_.rollbackReference',cleanupError);}});
    throw e;
  } finally {
    if (local) { try { owner.deleteSheet(local); } catch (e) { logWarn_('publishWelcomePage_.cleanup',String(e)); } }
  }
}

/** Batch adjacent equal dimensions: one write per run rather than one per row/column. */
function publishCopyDimensions_(src,dest,rows,cols) {
  if(typeof publishDimensionsFast_==='function'&&publishDimensionsFast_(src,dest,rows,cols))return;
  const copyRuns = (count,read,write) => {
    if (!count) return;
    let start=1, value=read(1);
    for (let i=2;i<=count+1;i++) {
      const next=i<=count?read(i):null;
      if (next!==value) { write(start,i-start,value); start=i; value=next; }
    }
  };
  copyRuns(rows,(r)=>src.getRowHeight(r),(r,n,h)=>{
    if (dest.setRowHeightsForced) dest.setRowHeightsForced(r,n,h);
    else for (let i=0;i<n;i++) dest.setRowHeight(r+i,h);
  });
  copyRuns(cols,(c)=>src.getColumnWidth(c),(c,n,w)=>{
    if (dest.setColumnWidths) dest.setColumnWidths(c,n,w);
    else for (let i=0;i<n;i++) dest.setColumnWidth(c+i,w);
  });
}

function publishMirrorTab_(src, dest, deep) {
  if (tabKey_(src.getName()) === tabKey_(CONFIG.sheets.welcome || 'Welcome Page')) return publishWelcomePage_(src,dest);
  if ([CONFIG.sheets.tracker, CONFIG.sheets.patrolLog].indexOf(src.getName()) !== -1) return publishFramedTable_(src, dest);
  const sh = publishHeaderRow_(src), dh = publishHeaderRow_(dest);
  const sRows = src.getLastRow(), sCols = src.getLastColumn();
  if (sRows < 1 || sCols < 1) {
    const oldRows=dest.getLastRow(), oldCols=dest.getLastColumn();
    if (oldRows && oldCols) {
      const empty=Array.from({length:oldRows},()=>new Array(oldCols).fill(''));
      const failed=writeValuesSafe_(dest,1,1,empty,publishKeepMask_(dest,1,1,oldRows,oldCols,null,true));
      if (failed) throw new Error(dest.getName()+': empty-source cleanup failed for '+failed+' cell(s).');
    }
    return 0;
  }

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
    if (bad) throw new Error(dest.getName() + ': ' + bad + ' cell(s) could not be written; publish remains queued.');
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
      const failed = writeValuesSafe_(dest, destStart, p.dc, publishReadCells_(src.getRange(srcStart, p.sc, n, 1), true),
        publishKeepMask_(dest, destStart, p.dc, n, 1, null, true));
      if (failed) throw new Error(dest.getName() + ': ' + failed + ' cell(s) could not be written; publish remains queued.');
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
  const started=Date.now();
  const selected=name=>typeof publishSelected_==='function'?publishSelected_(name,onlyTab):!onlyTab||norm_(name)===norm_(onlyTab)||(tabKey_(name)===tabKey_(CONFIG.sheets.welcome||'Welcome Page')&&tabKey_(name)===tabKey_(onlyTab));
  cfg_(); // never publish using fallback privacy rules when configuration is invalid
  const file = publicFile_();
  if (!file) return { linked: false, tabs: [], rows: 0, skipped: [] };
  const ss = SpreadsheetApp.getActive();
  // A public target pointing at THIS workbook would mirror the sheet onto itself and scrub its own Unique ID column.
  if (file.getId() === ss.getId()) {
    logWarn_('publishPublicRoster_', 'the linked public file IS this workbook — refusing to publish onto itself.');
    return { linked: true, failed: true, selfTarget: true, tabs: [], rows: 0, skipped: [], detail: ['Refused: the linked public roster is THIS workbook. Re-link it to a separate spreadsheet.'] };
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
  const sourceSheets=ss.getSheets(),publicSheets=file.getSheets();
  const sourceByName=new Map(sourceSheets.map(sheet=>[sheet.getName(),sheet]));
  [CONFIG.sheets.tracker, CONFIG.sheets.patrolLog, CONFIG.sheets.welcome || 'Welcome Page'].filter(Boolean).forEach((configuredName) => {
    const welcome = tabKey_(configuredName) === tabKey_(CONFIG.sheets.welcome || 'Welcome Page');
    const source = welcome ? sourceSheets.filter((sheet) => tabKey_(sheet.getName()) === tabKey_(configuredName))[0] : sourceByName.get(configuredName);
    const name = source ? source.getName() : configuredName;
    if (selected(name) && !publishTabBlocked_(name)
      && source && !publicSheets.some(sheet=>welcome?tabKey_(sheet.getName())===tabKey_(name):sheet.getName()===name))publicSheets.push(file.insertSheet(name));
  });
  publicSheets.forEach((dest) => {
    const name = dest.getName();
    if (aborted) { out.skipped.push(name); return; }
    if (!selected(name)) return;
    // Leave time for retry bookkeeping before Google's execution limit. A single
    // slow native call cannot be preempted; the durable checkpoint covers that case.
    if(Date.now()-started>=270000){aborted=true;out.aborted=true;out.skipped.push(name);out.detail.push(`${name}: time budget reached — unfinished tabs remain queued`);return;}
    if (publishTabBlocked_(name)) { out.skipped.push(name); out.detail.push(`${name}: BLOCKED (never published)`); return; }
    const isWelcome = tabKey_(name) === tabKey_(CONFIG.sheets.welcome || 'Welcome Page');
    const src = sourceByName.get(name) || (isWelcome ? sourceSheets.filter((sheet) => tabKey_(sheet.getName()) === tabKey_(name))[0] : null);
    if (!src) { out.skipped.push(name); out.detail.push(`${name}: no tab of that name here`); return; }
    if (!isWelcome && [CONFIG.sheets.tracker, CONFIG.sheets.patrolLog].indexOf(name) === -1 && publishSelfComputing_(dest)) { // Welcome always mirrors its internal source
      out.skipped.push(name);
      out.detail.push(`${name}: self-computing - left alone (no automatic clearing of neighboring content)`);
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
      out.failed = true;
      out.skipped.push(name); out.detail.push(`${name}: lock busy${yieldOn ? ' — yielded' : ''}`);
      if (yieldOn) { aborted = true; out.aborted = true; }
      return;
    }
    try {
      const tabStarted=Date.now();
      const sg = src.getMaxColumns(), dg = dest.getMaxColumns();
      const mode = (sg === dg) ? 'FULL' : 'match';
      try {
        if(typeof publishAssertSettled_==='function')publishAssertSettled_(sourceByName.get(CONFIG.sheets.roster));
        else {
          if (typeof memberMoveJournal_ === 'function') {
            const roster = ss.getSheetByName(CONFIG.sheets.roster);
            if (roster && memberMoveJournal_(roster)) throw new Error('Public publishing paused: an interrupted member transfer needs recovery. Use Roster → Recover Interrupted Transfer.');
            if (roster && typeof memberAssignmentRows_==='function' && memberAssignmentRows_(roster).length) throw new Error('Public publishing paused: an interrupted member assignment needs recovery. Use Roster → Recover Interrupted Transfer.');
            if (typeof pendingSignupApprovals_==='function' && pendingSignupApprovals_().length) throw new Error('Public publishing paused: an interrupted signup approval needs recovery. Use Roster → Recover Interrupted Transfer.');
          }
          const resetCheckpoint = PropertiesService.getDocumentProperties().getProperty('RE_ACTIVITY_RESET_PENDING');
          if (resetCheckpoint) {
            const pending = JSON.parse(resetCheckpoint);
            if (!pending || pending.phase !== 'committed') throw new Error('Public publishing paused: an interrupted activity reset needs review. Inspect its history snapshot and RE_ACTIVITY_RESET_PENDING checkpoint.');
          }
        }
        _dressNote_ = '';
        const n = publishMirrorTab_(src, dest, !yieldOn); // explicit publish → re-sync every row height; background → tail only
        out.tabs.push(name); out.rows += n;
        out.detail.push(`${name}: ${mode} · ${n} row(s) · ${Date.now()-tabStarted} ms · grid ${sg}/${dg} · src rows ${src.getLastRow()}${_dressNote_ ? ' · ' + _dressNote_ : ''}`);
      } catch (e) {
        out.failed = true;
        if(e&&e.publishRecovery){aborted=true;out.aborted=true;}
        log_('publishMirrorTab_.' + name, e);
        out.skipped.push(name);
        out.detail.push(`${name}: ERROR ${e && e.message ? e.message : e} | grid ${sg}/${dg} | src ${src.getLastRow()}x${src.getLastColumn()} | dest grid ${dest.getMaxRows()}x${dest.getMaxColumns()}`);
      }
    } finally { lock.releaseLock(); }
  });
  out.durationMs=Date.now()-started;
  return out;
}

/* Near-live publishing. A SIMPLE onEdit can't open another file, but an INSTALLABLE one runs authorized and can —
 * so 🔌 Install Triggers registers publishOnChange for both onEdit (cell edits) and onChange (row insert/DELETE,
 * which onEdit never sees). Bursts are rate-limited and a 1-minute sweep publishes anything that was skipped. */
const PUBLISH_MIN_GAP_MS_ = 3000; // burst guard only - small enough that a normal edit publishes straight away
const PUBLISH_DIRTY_PROP_ = 'PUBLIC_DIRTY';
const PUBLISH_LAST_PROP_ = 'PUBLIC_LAST_PUBLISH';
const PUBLISH_CATCHUP_PROP_ = 'PUBLIC_CATCHUP_AT';
const PUBLISH_CATCHUP_MS_ = 3000; // minimum delay; Google may deliver the clock trigger later
const PUBLISH_CATCHUP_LEASE_MS_ = 120000; // dedupe a delayed trigger instead of continually replacing it after 3s
const PUBLISH_CATCHUP_ID_PROP_ = 'PUBLIC_CATCHUP_ID';
const PUBLISH_BACKOFF_PROP_ = 'PUBLISH_BACKOFF_UNTIL'; // interactive-first: a pending panel write / transfer stamps now+45s here and NEW publish passes stand down until it expires
const PUBLISH_BACKOFF_MS_ = 45000;
const PUBLISH_PASS_PROP_ = 'PUBLISH_PASS_UNTIL'; // pass mutex: per-tab locking replaced the whole-pass script lock, so this keeps two passes from interleaving (owner-tagged 10-minute lease — a dead pass cannot wedge publishing)
let _publishPassToken_ = null;

/** Claim the one-publish-at-a-time slot. @return {boolean} false when another pass is already running. */
function publishPassClaim_() {
  const lock = LockService.getDocumentLock();
  if (!lock || !lock.tryLock(1000)) return false;
  try {
    const p = PropertiesService.getDocumentProperties();
    const stored = String(p.getProperty(PUBLISH_PASS_PROP_) || '0');
    if (Date.now() < Number(stored.split('|')[0])) return false;
    if(typeof publishQueueRecover_==='function')publishQueueRecover_();
    _publishPassToken_ = String(Date.now() + 600000) + '|' + Math.random().toString(36).slice(2);
    p.setProperty(PUBLISH_PASS_PROP_, _publishPassToken_);
    return true;
  } catch (e) { _publishPassToken_ = null; reportError_('publishPassClaim_',e,false); throw e; }
  finally { try { lock.releaseLock(); } catch (e) { reportError_('publishPassClaim_.release',e,false); } }
}
function publishPassRelease_() {
  const token = _publishPassToken_; _publishPassToken_ = null;
  if (!token) return;
  const lock = LockService.getDocumentLock();
  if (!lock || !lock.tryLock(1000)) return;
  try {
    const p = PropertiesService.getDocumentProperties();
    if (p.getProperty(PUBLISH_PASS_PROP_) === token) p.deleteProperty(PUBLISH_PASS_PROP_);
  } catch (e) { reportError_('publishPassRelease_',e,false); /* lease expires if cleanup fails */ }
  finally { try { lock.releaseLock(); } catch (e) { reportError_('publishPassRelease_.release',e,false); } }
}

/** Flag the public copy as stale WITHOUT publishing. Script writes (panel actions, the schedulers, patrol crediting)
 *  never fire onEdit, so they mark it here and the catch-up/sweep carries them.
 *
 *  An unscoped mark already covers every tab, so writing it twice in one execution is pure waste — callers are LOOPS
 *  (refreshPatrolLog_ processes every row, each row reconciling credit), which turned one of the slowest calls in
 *  Apps Script into a per-row cost. Memoised per execution; globals reset on every run, so the next execution marks
 *  again. The memo is cleared wherever the property is, so a mark landing after a mid-execution publish still counts. */
let _pubDirtyMemo_ = false;
function publishMarkDirty_(names) {
  if (_pubDirtyMemo_&&!names) return;
  try {
    if(typeof publishQueueChange_==='function')publishQueueChange_(names);
    else PropertiesService.getDocumentProperties().setProperty(PUBLISH_DIRTY_PROP_, '1');
    if(!names)_pubDirtyMemo_=true;
  }catch(e){
    try{const p=PropertiesService.getDocumentProperties();p.deleteProperty('PUBLIC_PENDING_SCOPE_V1');p.setProperty(PUBLISH_DIRTY_PROP_,'1');}catch(ignored){/* original storage/lock failure is logged below */}
    log_('publishMarkDirty_',e);
  }
}

// Execution-local queue: sorting may run under a writer lock, so publish only after its caller releases it.
let _publishSettledTabs_ = {};
function publishTableSettled_(name) {
  if (name) _publishSettledTabs_[name] = true;
}
function publishAfterWrite_(names) {
  try {
    const props = PropertiesService.getDocumentProperties();
    const tabs = names || Object.keys(_publishSettledTabs_);
    props.deleteProperty(PUBLISH_BACKOFF_PROP_);
    if (!String(props.getProperty(PUBLIC_FILE_PROP_) || '').trim()) return;
    // Sync Sheets' pending writes before reading the sorted rows for the public copy.
    SpreadsheetApp.flush();
    const settled=tabs.filter((name,i,all)=>name&&all.indexOf(name)===i);
    if(settled.length){
      if(typeof publishSelected_==='function')publishPublicRosterQuiet_(settled,false);
      else settled.forEach(name=>publishPublicRosterQuiet_(name,false));
    }
    _publishSettledTabs_ = {};
    if (props.getProperty(PUBLISH_DIRTY_PROP_) === '1') scheduleCatchup_();
  } catch (e) {
    _pubDirtyMemo_ = false; publishMarkDirty_();
    log_('publishAfterWrite_', e); // a mirror failure must never fail the completed internal write
  }
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
  let selection=onlyTab;
  try {
    // Take only this pass's work under a short queue lock. Later writes queue
    // independently; settled tabs are excluded from the remaining catch-up.
    // Older installations without the scope helper retain the boolean fallback.
    if(typeof publishQueueBegin_==='function'){
      selection=publishQueueBegin_(onlyTab,false);_pubDirtyMemo_=false;
    }else if (!onlyTab || mayClear) {
      props.deleteProperty(PUBLISH_DIRTY_PROP_); // BEFORE publishing, so a concurrent edit re-marks itself
      _pubDirtyMemo_ = false;
    }
    const res = publishPublicRoster_(selection, { yieldToBackoff: true });
    if (res && (res.aborted || res.failed)) {
      if(typeof publishQueueRetry_==='function')publishQueueRetry_(selection,res.tabs);
      else props.setProperty(PUBLISH_DIRTY_PROP_, '1');
      _pubDirtyMemo_=false;
    }
    if(typeof publishQueueFinish_==='function')publishQueueFinish_();
    props.setProperty(PUBLISH_LAST_PROP_, String(Date.now()));
    if(res&&res.durationMs>=10000)logInfo_('publishPublicRosterQuiet_',`Slow publish: ${res.durationMs} ms. ${(res.detail||[]).join(' | ')}`);
    return res;
  } catch (e) {
    _pubDirtyMemo_ = false; publishMarkDirty_();
    log_('publishPublicRosterQuiet_', e);
  }
  finally { publishPassRelease_(); }
}

/** Installable onEdit + onChange handler: republish the public copy promptly, rate-limited against edit bursts. */
function publishOnChange(e) {
  try {
    if (!String(PropertiesService.getDocumentProperties().getProperty(PUBLIC_FILE_PROP_) || '').trim()) return; // not linked → nothing to do (a property read, NOT openById — this fires on every keystroke, twice)
    // Known tab edits can be scoped. Core roster edits also queue dependent views;
    // structural changes without a range keep a conservative full pass.
    let only = '';
    try { only = (e && e.range) ? e.range.getSheet().getName() : ''; } catch (ig) { only = ''; }
    const props = PropertiesService.getDocumentProperties();
    // Installed onEdit already handles the value edit. Its paired onChange EDIT
    // must not enqueue another full-workbook rebuild for the very same keystroke.
    if(e&&!e.range&&String(e.changeType||'').toUpperCase()==='EDIT')return;
    const wasDirty = props.getProperty(PUBLISH_DIRTY_PROP_) === '1'; // script writes already pending? then a partial pass must NOT clear the flag
    // Core roster/table edits can update dependent views; unknown/structural work
    // stays full. Ordinary public tabs can be queued precisely.
    const full=!only||[CONFIG.sheets.roster,CONFIG.sheets.tracker,CONFIG.sheets.patrolLog].indexOf(only)!==-1||norm_(only)===norm_(CONFIG_SHEET_NAME);
    if(only&&!full&&publishTabBlocked_(only))return;
    if(typeof publishQueueChange_==='function')publishMarkDirty_(full?undefined:[only]);
    else{props.setProperty(PUBLISH_DIRTY_PROP_,'1');_pubDirtyMemo_=true;}
    // No range = an onChange firing (a paste/edit, a row/column insert-delete, or a format change). A full synchronous
    // publish here grabs the script lock and would race — and cancel — an in-flight member transfer that is about to
    // rewrite rows under that same lock (the transfer's ID paste ALSO reaches here as an onChange). VALUE/format changes
    // are already republished immediately by the matching onEdit firing, so defer those to the sweep (dirty is set).
    // STRUCTURAL changes (INSERT_ROW/REMOVE_ROW/…) don't fire onEdit at all, so let those publish now to stay immediate.
    if (!e || !e.range) {
      const ct = String((e && e.changeType) || '').toUpperCase();
      if (ct === 'EDIT' || ct === 'OTHER' || ct === 'FORMAT' || ct === '') { scheduleCatchup_(); return; } // value/format/unknown → onEdit + sweep cover it
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
        if (RC.discord && c <= RC.discord && cL >= RC.discord) { scheduleCatchup_(); return; } // move/ID edit → publish via the ~3s catch-up (checkForMemberMove can't, it's AuthMode.LIMITED)
      } catch (ig) { /* fall through to a normal publish */ }
    }
    // The edit handler sorts these tables independently; publish their settled order after it finishes.
    if ([CONFIG.sheets.tracker, CONFIG.sheets.patrolLog].indexOf(only) !== -1) { scheduleCatchup_(); return; }
    const last = Number(props.getProperty(PUBLISH_LAST_PROP_) || 0);
    if (Date.now() - last < PUBLISH_MIN_GAP_MS_) { scheduleCatchup_(); return; } // too soon → a trailing catch-up publishes the tail in ~3s (not the 1-minute sweep)
    publishPublicRosterQuiet_(only || undefined, !wasDirty); // nothing else was pending → this partial pass covers it all and may clear the flag
    // A backoff, busy pass or failed mirror can decline an immediate edit. Always
    // schedule its pending tail instead of silently relying only on the minute sweep.
    if(props.getProperty(PUBLISH_DIRTY_PROP_)==='1')scheduleCatchup_();
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
 * Request ONE one-off catch-up after a minimum PUBLISH_CATCHUP_MS_ delay. Actual Google delivery can be later;
 * a longer pending lease keeps edits from repeatedly replacing a delayed trigger.
 * Deduped under a short document lock, with ownership-safe cleanup when it fires. Best-effort: if
 * trigger creation is unavailable or quota-limited, the 1-minute sweep is still the backstop. Requires the installable
 * (authorized) context — publishOnChange runs installed, so ScriptApp is available here.
 */
function scheduleCatchup_() {
  let lock=null,owned=false;
  try {
    const p = PropertiesService.getDocumentProperties();
    const now = Date.now();
    if (Number(p.getProperty(PUBLISH_CATCHUP_PROP_) || 0) > now) return; // one is already pending → don't touch ScriptApp again
    lock=LockService.getDocumentLock();
    const held=lock&&lock.hasLock&&lock.hasLock();
    if(!lock||(!held&&!lock.tryLock(1000)))return; // sweep remains the backstop
    owned=!held;
    if(Number(p.getProperty(PUBLISH_CATCHUP_PROP_)||0)>Date.now())return; // another event won the short claim
    ScriptApp.getProjectTriggers().forEach((t) => { if (t.getHandlerFunction() === 'publishCatchup') ScriptApp.deleteTrigger(t); }); // clear spent/orphaned ones → stay at ≤1, far under the trigger quota
    const trigger=ScriptApp.newTrigger('publishCatchup').timeBased().after(PUBLISH_CATCHUP_MS_).create();
    if(trigger&&trigger.getUniqueId)p.setProperty(PUBLISH_CATCHUP_ID_PROP_,String(trigger.getUniqueId()));
    p.setProperty(PUBLISH_CATCHUP_PROP_, String(Date.now() + PUBLISH_CATCHUP_LEASE_MS_));
  } catch (e) { /* best-effort: the 1-minute sweep still carries it */ }
  finally{if(owned)try{lock.releaseLock();}catch(e){/* lease still dedupes */}}
}

/** One-off trailing publish (scheduled by scheduleCatchup_): clear its own marker + self-delete the trigger, then run
 *  the sweep (flush deferred rebuilds + publish if dirty). */
function publishCatchup(e) {
  let lock=null,owned=false;
  try {
    lock=LockService.getDocumentLock();
    const held=lock&&lock.hasLock&&lock.hasLock();
    if(lock&&(held||lock.tryLock(1000))){
      owned=!held;
      const p=PropertiesService.getDocumentProperties(),current=p.getProperty(PUBLISH_CATCHUP_ID_PROP_);
      // An old delayed event must never clear a newer event's marker or trigger.
      const owner=e&&e.triggerUid?String(e.triggerUid):current;
      if(!current||owner===current){p.deleteProperty(PUBLISH_CATCHUP_PROP_);p.deleteProperty(PUBLISH_CATCHUP_ID_PROP_);}
      ScriptApp.getProjectTriggers().forEach(t=>{if(t.getHandlerFunction()==='publishCatchup'&&(!owner||String(t.getUniqueId())===owner))ScriptApp.deleteTrigger(t);});
    }
  } catch (e) { /* ignore — a stale trigger is cleared by the next scheduleCatchup_ */ }
  finally{if(owned)try{lock.releaseLock();}catch(e){/* expires */}}
  try { publishSweep(); } catch (e) { log_('publishCatchup', e); }
}

/** Time-driven + menu entry point for the publish. Chunked like the background pass (per-tab locks, so it never
 *  starves interactive actions) but NEVER yields — the operator asked for a full publish, so it runs every tab. */
function publishPublicRoster() {
  if (!publishPassClaim_()) return false; // a background pass is mid-flight — rare and brief now; try again in a moment
  try {
    const props = PropertiesService.getDocumentProperties();
    const linked = !!String(props.getProperty(PUBLIC_FILE_PROP_) || '').trim();
    if (linked) {
      if(typeof publishQueueBegin_==='function')publishQueueBegin_(undefined,true);
      else props.deleteProperty(PUBLISH_DIRTY_PROP_);
      _pubDirtyMemo_ = false;
    } // explicit full pass; concurrent changes queue independently
    const res = publishPublicRoster_();
    if (res.failed || res.aborted) {
      _pubDirtyMemo_ = false;
      if(typeof publishQueueRetry_==='function')publishQueueRetry_(undefined,res.tabs);
      else publishMarkDirty_();
    }
    if(typeof publishQueueFinish_==='function')publishQueueFinish_();
    if (res.linked) {
      props.setProperty(PUBLISH_LAST_PROP_, String(Date.now())); // the sweep + burst guard see this pass, no redundant follow-up
      logInfo_('publishPublicRoster', `published ${res.rows} row(s) across ${res.tabs.length} tab(s) in ${res.durationMs||0} ms. ${(res.detail||[]).join(' | ')}`);
    }
    return res;
  } catch (e) {
    _pubDirtyMemo_ = false; publishMarkDirty_();
    throw e;
  } finally { publishPassRelease_(); }
}

/** Menu: publish now and report. */
function publishPublicRosterNow() {
  runAction_('Publish Public Roster', () => {
    const ui = SpreadsheetApp.getUi();
    // Repairs departments linked after their original startup, which installed no
    // public triggers. A valid set is left intact; installation failures are visible.
    if(typeof ensurePublicPublishingTriggers_==='function')ensurePublicPublishingTriggers_(false);
    const res = publishPublicRoster();
    if (res === false) { ui.alert('Publish skipped — another roster operation is running.'); return; }
    if (!res.linked) { ui.alert('🌐 Public Roster', 'No public roster is linked yet.\n\nRun 👥 Roster ▸ 🌐 Set Up Public Roster first.', ui.ButtonSet.OK); return; }
    ui.alert(res.failed || res.aborted ? '🌐 Publish incomplete — queued for retry' : '🌐 Published',
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
    if (file.getId() === SpreadsheetApp.getActive().getId()) { ui.alert('Choose a separate public spreadsheet. The internal roster cannot publish onto itself.'); return; }
    PropertiesService.getDocumentProperties().setProperty(PUBLIC_FILE_PROP_, file.getId());
    _publicFileMemo_ = file; // a link change must invalidate any earlier per-execution lookup
    _pubDirtyMemo_=false;
    if(typeof publishMarkDirty_==='function')publishMarkDirty_(); // retain a full retry if an older-file pass is still busy
    if(typeof ensurePublicPublishingTriggers_==='function')ensurePublicPublishingTriggers_(false);
    const sum = publishPublicRoster();
    const publishNote=sum===false?'First publish is busy; the automatic sweep will retry.'
      :sum.failed||sum.aborted?'First publish is incomplete; inspect SYS Log. Updates are queued for retry.'
      :'First publish completed: '+sum.rows+' row(s) across '+sum.tabs.length+' tab(s).';
    logInfo_('setupPublicRoster', `public roster linked: ${file.getId()}`);
    ui.alert('🌐 Public roster linked',
      file.getName() + '\n' + file.getUrl() + '\n\n' +
      'Automatic updates are installed: cell edits, structural changes and a one-minute retry sweep.\n\n' +
      publishNote+'\n\n'+
      'NEXT — copy the tabs you want members to see into that file (right-click a tab ▸ Copy to ▸ that spreadsheet), ' +
      'then rename each copy to EXACTLY match its name here. Publishing mirrors every public tab whose name matches a ' +
      'tab here, matching columns by header — so delete a column there and it simply stops being filled.\n\n' +
      'Columns listed in PUBLISH.NEVER_PUBLISH are masked and scrubbed from the public copy. Config, ' +
      'Webhooks, Disciplinary Log and Signups are never published at all.\n\n' +
      'Then share THAT file with members and restrict this one — in that order.', ui.ButtonSet.OK);
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
function cpSignupFlag(payload) { return cpWithLock_(()=>cpSignupFlagCore_(payload)); }
function cpSignupFlagCore_(payload) {
  const file = adminFile_();
  if (!file) throw new Error('No admin file is linked yet.');
  const sh = file.getSheetByName(CONFIG.sheets.signups);
  if (!sh) throw new Error(`"${CONFIG.sheets.signups}" was not found in the admin file.`);
  const row = signupResolveRow_(sh, Number((payload && payload.row) || 0), String((payload && payload.id) || ''),String((payload && payload.key) || ''));
  const SC = signupCols_(sh);
  assertSignupNotReserved_(sh,row,SC);
  if (!SC.status) throw new Error('That signup tab has no Status column.');
  const cur = String(sh.getRange(row, SC.status).getDisplayValue()).trim();
  if (signupIsDone_(cur)) throw new Error('That signup is already processed.');
  const on = payload && typeof payload.flagged==='boolean' ? payload.flagged : norm_(cur) !== norm_(SIGNUP_FLAGGED_);
  const desired=on?SIGNUP_FLAGGED_:SIGNUP_STATUSES_[0];
  if(cur===desired){sortSignups_(sh);return {row:signupResolveRow_(sh,row,String((payload && payload.id) || ''),String((payload && payload.key) || '')),status:desired,flagged:on};}
  sh.getRange(row, SC.status).setValue(on ? SIGNUP_FLAGGED_ : SIGNUP_STATUSES_[0]); // toggle: flag ⇄ back to Pending
  const who = String(sh.getRange(row, SC.name || 1).getDisplayValue()).trim();
  cpAudit_('signup', cur, on ? SIGNUP_FLAGGED_ : SIGNUP_STATUSES_[0], sh.getRange(row, SC.status).getA1Notation(), who);
  sortSignups_(sh);
  return { row: signupResolveRow_(sh, row, String((payload && payload.id) || ''),String((payload && payload.key) || '')), status: on ? SIGNUP_FLAGGED_ : SIGNUP_STATUSES_[0], flagged: on };
}

/**
 * Panel: correct ONE field on a signup, in place on the review tab.
 *
 * The card used to be read-only, so fixing a mistyped phone number meant leaving the panel, finding the row, editing
 * it, and coming back. The edit lands on the SHEET, not in panel memory — which is also what makes it reach the
 * roster: cpSignupApprove reads the row at approval time, so a correction saved here is the value that gets seated.
 * An applicant who is skipped or flagged keeps the correction too.
 *
 * Addressed by HEADER TEXT, not column number: the panel's payload was built when it loaded, and a column inserted
 * on the sheet since then would silently redirect the write. STATUS is refused outright — Flag and Approve own it,
 * and a free-text status would break the queue's grouping. A processed signup is refused for the same reason it
 * cannot be flagged: its roster row already exists and this would not follow it.
 * @param {{row:number, id:string, k:string, v:string}} payload
 */
function cpSignupUpdate(payload) { return cpWithLock_(()=>cpSignupUpdateCore_(payload)); }
function cpSignupUpdateCore_(payload) {
  const file = adminFile_();
  if (!file) throw new Error('No admin file is linked yet.');
  const sh = file.getSheetByName(CONFIG.sheets.signups);
  if (!sh) throw new Error(`"${CONFIG.sheets.signups}" was not found in the admin file.`);
  const label = String((payload && payload.k) || '').trim();
  if (!label) throw new Error('No field was named.');
  const row = signupResolveRow_(sh, Number((payload && payload.row) || 0), String((payload && payload.id) || ''),String((payload && payload.key) || ''));
  const SC = signupCols_(sh);
  assertSignupNotReserved_(sh,row,SC);
  if (SC.status) {
    const cur = String(sh.getRange(row, SC.status).getDisplayValue()).trim();
    if (signupIsDone_(cur)) throw new Error('That signup is already processed — edit the member on the Members tab instead.');
  }
  const hdr = sh.getRange(SC.headerRow, 1, 1, SC.width).getDisplayValues()[0];
  let col = 0;
  for (let c = 0; c < hdr.length; c++) { if (String(hdr[c] || '').trim() === label) { if(col)throw new Error('That field header appears more than once. Give the columns distinct headers before editing.');col = c + 1; } }
  if (!col) throw new Error(`"${label}" is no longer a column on ${CONFIG.sheets.signups} — reopen the panel.`);
  if (SC.status && col === SC.status) throw new Error('Status is set with Flag or Approve, not by typing.');
  const before = String(sh.getRange(row, col).getDisplayValue()).trim();
  const value = String((payload && payload.v) != null ? payload.v : '').trim();
  const cell = sh.getRange(row, col);
  if (col === SC.discord) cell.setNumberFormat('@'); // a 17-19 digit ID must never be stored as a number
  cell.setValue(value.startsWith('=')?"'"+value:value);
  const who = String(sh.getRange(row, SC.name || 1).getDisplayValue()).trim();
  cpAudit_('signup', before, value, cell.getA1Notation(), who);
  // The Unique ID is what every later call re-finds this row by, so hand the panel the new one to carry forward.
  return { row: row, k: label, value: value, id: SC.discord ? String(sh.getRange(row, SC.discord).getDisplayValue()).trim() : '' };
}

/**
 * Resolve the signup row an approval must target. Signup rows SHIFT under an open panel: a form submission's
 * installable sync re-sorts the review tab (Pending → Approved → Processed), so the row number the client saw can
 * hold a DIFFERENT applicant by the time the admin clicks. Same TOCTOU defence as cpResolveMemberRow_ (F-002/F-027):
 * Submission key takes priority; an ID-only fallback must be unique. Legacy row-only requests require valid bounds.
 * Must be called INSIDE the script lock so the resolved row can't shift again before the write.
 */
function assertSignupNotReserved_(sheet,row,SC) {
  const id=String(sheet.getRange(row,SC.discord).getDisplayValue()).trim();
  if(PropertiesService.getDocumentProperties().getProperty('RE_SIGNUP_APPROVAL:'+sheet.getSheetId()+':'+id))throw new Error('This signup belongs to an interrupted approval. Use Recover Interrupted Transfer before editing it.');
}
function signupResolveRow_(signups, row, expectedId, expectedKey) {
  const want = String(expectedId == null ? '' : expectedId).trim();
  const key=String(expectedKey || '').trim(),r=Number(row),SC=signupCols_(signups),last=signups.getLastRow();
  if(!want&&!key){if(!Number.isInteger(r)||r<SC.dataStart||r>last)throw new Error('Invalid signup row.');return r;}
  if(last<SC.dataStart)throw new Error('That signup no longer exists. Refresh the queue.');
  const col=key?1:SC.discord;if(!col)throw new Error('The signup identity column is missing.');
  const values=signups.getRange(SC.dataStart,col,last-SC.dataStart+1,1).getDisplayValues(),matches=[];
  values.forEach((v,i)=>{if(String(v[0]).trim()===(key||want))matches.push(SC.dataStart+i)});
  if(matches.length!==1)throw new Error('That signup is missing or ambiguous. Refresh the queue; duplicate submissions require their own submission keys.');
  const found=matches[0];
  if(want && (!SC.discord || String(signups.getRange(found,SC.discord).getDisplayValue()).trim()!==want))throw new Error('That signup identity changed since the panel loaded. Refresh the queue.');
  return found;
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
  let res, primary;
  try {
    const vr = signupResolveRow_(sh, row, String((payload && payload.id) || ''),String((payload && payload.key) || '')); // relocate the exact submission, including repeated IDs
    res = approveSignup_(sh, vr, roster, slotRow, (payload && payload.edits) || null);
    try { sortSignups_(sh); } catch (e) { log_('cpSignupApprove.sort', e); res.sortWarning=true;deferWork_('signupOrder'); }
  } catch(e){primary=e;throw e}finally { try{lock.releaseLock()}catch(e){if(primary)log_('cpSignupApprove.release',e);else throw e} }
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
function cpSignupPostSeat(payload) { return cpWithLock_(()=>cpSignupPostSeatCore_(payload)); }
function cpSignupPostSeatCore_(payload) {
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

function cpAssertSlotRow_(roster, row, approvalKey) {
  if (!Number.isInteger(row) || row < CONFIG.rosterStartRow || row > roster.getMaxRows()) throw new Error('Invalid row.');
  if (memberAssignmentJournal_(roster,row)) throw new Error('This slot belongs to an interrupted member assignment. Retry that assignment or use Recover Interrupted Transfer before editing it.');
  if(pendingSignupApprovals_().some(({key,journal:j})=>key!==approvalKey && j.book===roster.getParent().getId() && j.rosterSheet===roster.getSheetId() && j.slotRow===row))throw new Error('This slot belongs to an interrupted signup approval. Use Recover Interrupted Transfer before editing it.');
  assertNoPendingActivityReset_(roster);
  if (typeof memberMoveJournal_ === 'function') {
    const pending = memberMoveJournal_(roster);
    if (pending && (pending.source === row || pending.target === row)) throw new Error('This row belongs to an interrupted transfer. Use Recover Interrupted Transfer before editing it.');
  }
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
  let found = -1;
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() !== want) continue;
    if (found !== -1) throw new Error('That member ID is duplicated on the roster. Resolve the duplicate before editing the member.');
    found = CONFIG.rosterStartRow+i;
  }
  return found;
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
