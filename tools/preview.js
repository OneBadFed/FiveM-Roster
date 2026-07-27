/* ============================================================================
 * PANEL PREVIEW HARNESS — render SettingsPanel.html / ControlPanel.html in a
 * plain browser, with no Apps Script and no spreadsheet.
 *
 *   node tools/preview.js settings   ->  tools/.preview/SettingsPanel.preview.html
 *   node tools/preview.js control    ->  tools/.preview/ControlPanel.preview.html
 *   node tools/preview.js both
 *
 * Open the generated file in any browser. Everything renders: layout, theme,
 * every section, the dropdowns, the live previews. Server calls are answered by
 * a stub instead of google.script.run.
 *
 * WHY IT IS BUILT THIS WAY: the settings payload is generated from the REAL
 * BLOCK_SPECS_ in RosterConfig.gs (loaded here the same way tools/cfgcheck.js
 * loads it — GAS services stubbed), mirroring cpGetConfig_'s output shape. So
 * the preview always shows the panel's ACTUAL keys, defaults, help text and
 * enums, and a schema change appears here with no edit to this file. Hand-typed
 * fixtures would drift the moment a key was added.
 *
 * tools/** is clasp-ignored — none of this reaches the Apps Script project.
 * ==========================================================================*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, '.preview');

/* ---- 1 · load RosterConfig.gs for its schema (same stubbing as cfgcheck.js) ---- */
function loadSchema() {
  const props = {};
  global.PropertiesService = {
    getDocumentProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
      getProperties: () => ({ ...props }),
      setProperties: (o) => { Object.assign(props, o); },
    }),
    getScriptProperties: () => global.PropertiesService.getDocumentProperties(),
  };
  global.CacheService = { getDocumentCache: () => ({ get: () => null, put: () => {}, remove: () => {} }), getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) };
  global.SpreadsheetApp = { getActive: () => ({ getSheetByName: () => null, getSpreadsheetTimeZone: () => 'America/New_York', getSheets: () => [] }), flush: () => {} };
  global.Session = { getScriptTimeZone: () => 'America/New_York', getActiveUser: () => ({ getEmail: () => '' }) };
  global.Utilities = { formatDate: () => 'x', sleep: () => {} };
  global.Logger = { log: () => {} };
  global.UrlFetchApp = { fetch: () => { throw new Error('no network in the preview harness'); } };
  global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };

  const src = fs.readFileSync(path.join(ROOT, 'RosterConfig.gs'), 'utf8');
  const tail = '\n;globalThis.__X = { BLOCK_SPECS_, ENGINE_VERSION, validateConfig_, materialize_ };';
  new Function(src + tail)();
  return global.__X;
}

/* ---- 2 · the block lists the panel is served (mirrors CP_SETTINGS_* in RosterControlPanel.gs) ---- */
function cpSettingsLists() {
  const cp = fs.readFileSync(path.join(ROOT, 'RosterControlPanel.gs'), 'utf8');
  const grab = (name) => {
    const m = cp.match(new RegExp('const ' + name + " = Object\\.freeze\\(\\[([^\\]]*)\\]"));
    if (!m) throw new Error('could not find ' + name + ' in RosterControlPanel.gs');
    return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  };
  return { kv: grab('CP_SETTINGS_KV_'), tables: grab('CP_SETTINGS_TABLES_'), hidden: { 'SYSTEM.SCHEMA_VERSION': true } };
}

/* ---- 3 · build the cpGetConfig payload exactly as the server does ---- */
function buildConfigPayload(X, lists) {
  const blocks = [];
  const missing = [];
  lists.kv.forEach((name) => {
    const spec = X.BLOCK_SPECS_[name];
    if (!spec) { missing.push(name); return; }
    const keys = [];
    Object.keys(spec.keys).forEach((key) => {
      if (lists.hidden[name + '.' + key]) return;
      const k = spec.keys[key];
      const def = (k.t === 'bool') ? (k.d ? 'TRUE' : 'FALSE') : String(k.d);
      keys.push({
        key, t: k.t, def, req: !!k.req, help: k.help || '',
        min: (k.min != null ? k.min : null), max: (k.max != null ? k.max : null),
        options: k.enum ? k.enum.slice() : null,
        value: def, fromSheet: false,
      });
    });
    blocks.push({ name, type: 'kv', help: spec.help || '', keys });
  });
  lists.tables.forEach((name) => {
    const spec = X.BLOCK_SPECS_[name];
    if (!spec) { missing.push(name); return; }
    const width = spec.cols.length;
    const rows = (spec.seed || []).map((r) => {
      const o = r.slice(0, width).map((x) => String(x == null ? '' : x));
      while (o.length < width) o.push('');
      return o;
    });
    blocks.push({ name, type: 'table', help: spec.help || '', cols: spec.cols.slice(), rows, fromSheet: false });
  });

  // Every block in the schema that the panel is NOT served — the exact class of bug where a section renders
  // empty because its keys never reached the client. Reported loudly rather than silently previewed as fine.
  const served = {};
  lists.kv.concat(lists.tables).forEach((n) => { served[n] = true; });
  const unserved = Object.keys(X.BLOCK_SPECS_).filter((n) => !served[n]);

  return {
    payload: {
      fromTab: true,
      sheetName: '⚙️ Config',
      engine: X.ENGINE_VERSION,
      sheetNames: ['Member Information', 'LOA Tracker', 'Patrol Log', 'Roster Signups', 'Welcome Page',
        'Activity Panel', 'LOA/ROA Form Response', 'Patrol Form Response', 'Signup Form Response'],
      ranks: ['Chief of Police', 'Captain', 'Lieutenant', 'Sergeant', 'Corporal', 'Master Officer',
        'Police Officer II', 'Police Officer I', 'Probationary Officer', 'Cadet'],
      problems: [],
      webhooks: { AUDIT: true, LOA: true, PATROL: false, SIGNUP: false, ERRORS: false },
      adminLinked: true,
      blocks,
    },
    missing,
    unserved,
  };
}

/* ---- 3b · a roster for the Control Panel to draw ----
 * The settings payload comes from the real schema, but there is no equivalent source for MEMBERS — they live in
 * a spreadsheet. Without this the Control Panel preview shows an empty list, and every panel that loads on demand
 * (the profile chart, the activity checks, leave history) sits on "Loading…" forever, which reads as a bug in the
 * panel rather than a gap in the harness. Shaped exactly like cpSnapshot_ / cpGetProfile. */
const RANKS = ['Chief of Police', 'Captain', 'Lieutenant', 'Sergeant', 'Corporal', 'Master Officer',
  'Police Officer II', 'Police Officer I', 'Probationary Officer', 'Cadet'];
const FIRST = ['Liam', 'Aisha', 'Marcus', 'Elena', 'Devon', 'Priya', 'Noah', 'Camille', 'Theo', 'Rosa',
  'Silas', 'Nadia', 'Owen', 'Bea', 'Hugo', 'Imani', 'Jonas', 'Kira', 'Milo', 'Sana'];
const LAST = ['Kowalski', 'Nguyen', 'Okonkwo', 'Vasquez', 'Reed', 'Malhotra', 'Bergstrom', 'Duval', 'Petrakis',
  'Alvarez', 'Whitfield', 'Haddad', 'Lindqvist', 'Moreau', 'Castellanos', 'Boateng', 'Fenwick', 'Yamamoto'];
const STATUSES = ['Active', 'Semi-Active', 'Inactive', 'LOA', 'ROA', 'Reserve'];

function buildRoster() {
  const members = [];
  const stats = { total: 0, active: 0, semi: 0, inactive: 0, onLeave: 0, openSlots: 0, pending: 2, expiringSoon: 1 };
  for (let i = 0; i < 26; i++) {
    const rank = RANKS[Math.min(RANKS.length - 1, Math.floor(i / 3))];
    const filled = i % 9 !== 7; // a scattering of open slots, as a real roster has
    const status = STATUSES[i % STATUSES.length];
    const hours = filled ? ((i * 3.7) % 23).toFixed(1) : '';
    const req = rank === 'Cadet' ? 5 : 10; // mirrors a [STATUS_OVERRIDES] rank ladder vs. the global tiers
    members.push({
      row: 6 + i, rank,
      name: filled ? `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}` : '',
      callsign: `S-${String(i + 4).padStart(2, '0')}`,
      discord: filled ? String(770000000000000000 + i * 7) : '',
      joinDate: `${(i % 27) + 1} Apr 202${i % 5}`, lastPromo: `${(i % 26) + 2} Jan 2026`,
      status: filled ? status : '', hours, req, color: '', filled,
      section: ['Alpha Watch','Bravo Watch','Charlie Watch'][Math.floor(i/9)%3],
      // open slots carry one too — under SHIFT_ASSIGNED_BY=RANK the value belongs to the SLOT, so an
      // unfilled row still has one and the picker must be able to show it.
      shift: ['1st District','2nd District','3rd District'][i%3],
    });
    if (!filled) { stats.openSlots++; continue; }
    stats.total++;
    if (status === 'Active') stats.active++;
    else if (status === 'Semi-Active') stats.semi++;
    else if (status === 'Inactive') stats.inactive++;
    else stats.onLeave++;
  }
  return { members, stats, updatedAt: '9:23 AM' };
}

function bootstrapPayload(X) {
  const snap = buildRoster();
  return {
    version: 'preview', systemName: 'Roster System',
    webhooks: { AUDIT: true, LOA: true, PATROL: false, SIGNUP: false, ERRORS: false },
    statuses: STATUSES.slice(), statusColors: {}, protectedStatuses: ['Reserve'], leaveTypes: ['LOA', 'ROA'],
    addCols: { ooc: true, shift: true },
    idDigits: { min: 17, max: 19 },
    shiftLabel: 'PATROL DISTRICT',
    shiftAssignedBy: 'MEMBER',
    shiftValues: ['Days', 'Swings', 'Mids'],
    defaultStatus: 'Inactive', // shouted, as a real sheet header usually is — the panel title-cases it // same shape cpBootstrap sends; the Add form validates against THIS
    members: snap.members, stats: snap.stats, updatedAt: snap.updatedAt,
    rankIcons: {}, adminRoster: { linked: true, access: true, url: '#' },
    health: { ok: false, problems: [{ sev: 'WARN', msg: 'preview' }, { sev: 'WARN', msg: 'preview' }] },
    engine: X.ENGINE_VERSION,
  };
}

/* ---- 4 · the google.script.run stub the page runs against ---- */
function runtimeStub(configPayload, boot) {
  const snap = { members: boot.members, stats: boot.stats, updatedAt: boot.updatedAt };
  const RESPONSES = {
    cpBootstrap: boot,
    cpRefresh: snap,
    // Four fortnightly checks + two closed leaves — enough for the chart, the check cells and the history list.
    cpGetProfile: {
      leaves: [
        { type: 'LOA', start: '8 Jun 2026', end: '14 Jun 2026', status: 'Expired' },
        { type: 'ROA', start: '2 Feb 2026', end: '9 Feb 2026', status: 'Expired' },
      ],
      history: [
        { week: '2026-06-21', hours: 21.5, status: 'Active' },
        { week: '2026-07-05', hours: 23.0, status: 'Active' },
        { week: '2026-07-19', hours: 24.2, status: 'Active' },
        { week: '2026-07-25', hours: 16.5, status: 'Active' },
      ],
    },
    cpSignupList: {
      linked: true, ready: true, rankIcons: {},
      signups: [1, 2, 3, 4].map((n) => ({ row: 100 + n, name: `${FIRST[n + 9]} ${LAST[n + 5]}`, status: 'Pending', discord: String(880000000000000000 + n) })),
      slots: [{ row: 13, rank: 'Cadet', unit: 'S-11' }, { row: 22, rank: 'Police Officer I', unit: 'S-20' }],
    },
    cpGetConfig: configPayload,
    cpApplyConfig: { ok: true, written: { kv: 1, tables: 0 }, state: configPayload },
    cpRankIcons: {
      ranks: [
        { rank: 'Sergeant', members: 3, icon: '', color: '#c9a227' },
        { rank: 'Corporal', members: 2, icon: '', color: '' },
        { rank: 'Police Officer I', members: 7, icon: '', color: '#4f8ee8' },
        { rank: 'Cadet', members: 1, icon: '', color: '' },
      ],
    },
    cpPing: { ok: true, version: 'preview', engine: 'preview', schema: 2 },
    cpSetWebhook: { channel: 'AUDIT', channels: { AUDIT: true, LOA: true, PATROL: false, SIGNUP: false, ERRORS: false } },
    cpTestWebhook: true,
    cpRunAction: 'Preview: no server behind this button.',
  };
  return `
<script>
/* ===== PREVIEW HARNESS — not shipped. Stands in for Apps Script's HtmlService runtime. ===== */
(function () {
  var RESPONSES = ${JSON.stringify(RESPONSES)};
  function chain() {
    var ok = null, fail = null;
    var api = {
      withSuccessHandler: function (f) { ok = f; return api; },
      withFailureHandler: function (f) { fail = f; return api; },
      withUserObject: function () { return api; },
      dispatch: function (name) {
        var args = Array.prototype.slice.call(arguments, 1);
        console.log('[preview] dispatch(' + name + ')', args);
        setTimeout(function () {
          if (Object.prototype.hasOwnProperty.call(RESPONSES, name)) { if (ok) ok(RESPONSES[name]); }
          else if (fail) fail(new Error('[preview] no stub for endpoint "' + name + '" — add one in tools/preview.js'));
          else console.warn('[preview] unhandled endpoint', name);
        }, 60); // a beat of latency, so spinners and disabled states are visible
        return api;
      },
    };
    return api;
  }
  window.google = { script: { run: chain(), host: { close: function () {}, setHeight: function () {}, setWidth: function () {} }, url: { getLocation: function (cb) { cb({ parameter: {} }); } } } };
  window.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('div');
    b.textContent = 'PREVIEW — stubbed server';
    b.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;font:600 10px/1 Inter,Arial,sans-serif;'
      + 'letter-spacing:.08em;text-transform:uppercase;color:#0d1016;background:#d9ab52;padding:6px 10px;'
      + 'border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.45);pointer-events:none;opacity:.85';
    document.body.appendChild(b);
  });
})();
</script>
`;
}

/* ---- 5 · turn a GAS template into a plain page ---- */
function renderPanel(file, configPayload, bootJson, boot) {
  let html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const scriptlets = (html.match(/<\?!?=?[\s\S]*?\?>/g) || []).length;
  // GAS scriptlets (<?!= bootJson ?>) are resolved server-side by HtmlService; substitute their values here.
  html = html.replace(/<\?!?=\s*bootJson\s*\?>/g, bootJson)
    .replace(/<\?!?=\s*initialTab\s*\?>/g, '')
    .replace(/<\?!?=[\s\S]*?\?>/g, 'null'); // any other template var -> null, so the page still parses
  // The stub must exist BEFORE the panel's own script runs.
  const stub = runtimeStub(configPayload, boot);
  html = html.includes('</head>') ? html.replace('</head>', stub + '</head>') : (stub + html);
  return { html, scriptlets };
}

/* ---- 6 · every key the panel's UI references must actually be SERVED ----
 * The Settings Studio renders from a hand-maintained SECTIONS list while the server sends a hand-maintained
 * CP_SETTINGS_KV_ list. Nothing ties the two together, so a key can be listed in a card and simply never arrive
 * — the control renders blank and saving it does nothing, with no error anywhere. (Exactly what happened when
 * the ACTIVITY block was added to the schema and the panel but not to CP_SETTINGS_KV_.) This compares them. */
function checkPanelKeys(payload) {
  const html = fs.readFileSync(path.join(ROOT, 'SettingsPanel.html'), 'utf8');
  const m = html.match(/var SECTIONS\s*=\s*\[([\s\S]*?)\n  \];/);
  if (!m) return { checked: 0, orphans: [] };
  const referenced = [];
  const seen = {};
  (m[1].match(/'[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*'/g) || []).forEach((raw) => {
    const bk = raw.replace(/'/g, '');
    if (!seen[bk]) { seen[bk] = true; referenced.push(bk); }
  });
  const have = {};
  payload.blocks.forEach((b) => { if (b.type === 'kv') b.keys.forEach((k) => { have[b.name + '.' + k.key] = true; }); });
  return { checked: referenced.length, orphans: referenced.filter((bk) => !have[bk]) };
}

/* ---- main ---- */
const which = (process.argv[2] || 'both').toLowerCase();
const X = loadSchema();
const lists = cpSettingsLists();
const built = buildConfigPayload(X, lists);
const boot = bootstrapPayload(X);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = [];
if (which === 'settings' || which === 'both') targets.push(['SettingsPanel.html', 'SettingsPanel.preview.html']);
if (which === 'control' || which === 'both') targets.push(['ControlPanel.html', 'ControlPanel.preview.html']);
if (!targets.length) { console.error('usage: node tools/preview.js [settings|control|both]'); process.exit(2); }

targets.forEach(([src, out]) => {
  const { html, scriptlets } = renderPanel(src, built.payload, 'null', boot);
  fs.writeFileSync(path.join(OUT_DIR, out), html);
  console.log(`  ${src.padEnd(20)} -> tools/.preview/${out}   (${(html.length / 1024).toFixed(0)} KB, ${scriptlets} GAS scriptlet(s) resolved)`);
});

console.log(`\n  engine ${built.payload.engine} · ${built.payload.blocks.length} blocks served ` +
  `(${built.payload.blocks.filter((b) => b.type === 'kv').length} kv, ${built.payload.blocks.filter((b) => b.type === 'table').length} tables)`);

if (built.missing.length) {
  console.log(`\n  ✗ SERVED BUT NOT IN THE SCHEMA: ${built.missing.join(', ')}`);
  console.log('    CP_SETTINGS_* names a block BLOCK_SPECS_ does not define — the panel would break on it.');
}
if (built.unserved.length) {
  console.log(`\n  ⚠ IN THE SCHEMA BUT NOT SERVED: ${built.unserved.join(', ')}`);
  console.log('    These blocks exist in RosterConfig.gs but are absent from CP_SETTINGS_KV_ / CP_SETTINGS_TABLES_,');
  console.log('    so the Settings Studio never receives their keys. A section built on them renders EMPTY.');
  console.log('    (COLUMNS is deliberate — SLOT/MEMBER classes are edited on Control Panel ▸ Columns.)');
}

const keyCheck = checkPanelKeys(built.payload);
if (keyCheck.orphans.length) {
  console.log(`\n  ✗ PANEL REFERENCES ${keyCheck.orphans.length} KEY(S) THE SERVER NEVER SENDS:`);
  keyCheck.orphans.forEach((bk) => console.log('      ' + bk));
  console.log('    Each renders as a blank control that silently saves nothing. Fix the block name in the');
  console.log('    SECTIONS list, or add its block to CP_SETTINGS_KV_ in RosterControlPanel.gs.');
  process.exitCode = 1;
} else {
  console.log(`\n  ✓ all ${keyCheck.checked} keys referenced by the panel's SECTIONS are served`);
}
console.log('\n  Open the file above in a browser. Server calls are stubbed; see the console for dispatch logs.');
