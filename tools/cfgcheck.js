/* Node harness: EXECUTES the RosterConfig pipeline (validate -> materialize) with GAS services stubbed.
 * The config layer is pure JS apart from cache/props/sheet reads, so defaults, coercion, key aliases and the
 * legacy CONFIG bridge can be verified for real — no Apps Script runtime needed. */
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'RosterConfig.gs', 'utf8');

// ---- GAS service stubs (only what top-level code + validate/materialize touch) ----
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
global.SpreadsheetApp = { getActive: () => ({ getSheetByName: () => null, getSpreadsheetTimeZone: () => 'America/Chicago', getSheets: () => [] }), flush: () => {} };
global.Session = { getScriptTimeZone: () => 'America/Chicago', getActiveUser: () => ({ getEmail: () => '' }) };
global.Utilities = { formatDate: () => 'x', sleep: () => {} };
global.Logger = { log: () => {} };
global.UrlFetchApp = { fetch: () => { throw new Error('no network in harness'); } };
global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };

// ---- evaluate RosterConfig.gs and export its internals ----
const tail = '\n;globalThis.__X = { BLOCK_SPECS_: typeof BLOCK_SPECS_!=="undefined"?BLOCK_SPECS_:null, validateConfig_, materialize_, norm_, coerce_: typeof coerce_!=="undefined"?coerce_:null };';
try { new Function(src + tail)(); } catch (e) { console.log('LOAD FAIL:', e.message); process.exit(1); }
const X = global.__X;

let pass = 0, fail = 0;
const ok = (label, cond, detail) => { if (cond) { pass++; console.log('  PASS  ' + label); } else { fail++; console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : '')); } };
const errsOf = (problems) => problems.filter((p) => p.sev === 'ERROR');

// ---- 1 · empty config: zero ERRORs, defaults reproduce shipped behaviour ----
console.log('\n[1] validateConfig_({}) — shipped defaults');
const v0 = X.validateConfig_({});
ok('zero ERRORs on an empty config', errsOf(v0.problems).length === 0, JSON.stringify(errsOf(v0.problems).slice(0, 3)));
const m0 = X.materialize_(v0.config, false);
ok('legacy sheets.form = leave-form default', m0.legacy.sheets.form === 'LOA/ROA Form Response', String(m0.legacy.sheets.form));
ok('legacy sheets.patrol = "" (patrol form OFF)', m0.legacy.sheets.patrol === '', JSON.stringify(m0.legacy.sheets.patrol));
ok('legacy sheets.signupForm = "" (signup sync OFF)', m0.legacy.sheets.signupForm === '', JSON.stringify(m0.legacy.sheets.signupForm));
ok('legacy sheets.patrolLog default', m0.legacy.sheets.patrolLog === 'Patrol Log', String(m0.legacy.sheets.patrolLog));
ok('legacy sheets.signups default', m0.legacy.sheets.signups === 'Roster Signups', String(m0.legacy.sheets.signups));
ok('fixed form fallback map intact (timestamp..end = 1..8)', m0.legacy.form && m0.legacy.form.timestamp === 1 && m0.legacy.form.end === 8, JSON.stringify(m0.legacy.form));
ok('NEVER_PUBLISH default has 5 entries incl. PHONE', Array.isArray(m0.kv.PUBLISH.NEVER_PUBLISH) && m0.kv.PUBLISH.NEVER_PUBLISH.length === 5 && m0.kv.PUBLISH.NEVER_PUBLISH.indexOf('PHONE') !== -1, JSON.stringify(m0.kv.PUBLISH.NEVER_PUBLISH));
ok('FORM_MAP rows are {Role, Header} objects', Array.isArray(v0.config.tables.FORM_MAP) && v0.config.tables.FORM_MAP.length === 8 && v0.config.tables.FORM_MAP[0].Role === 'TIMESTAMP' && 'Header' in v0.config.tables.FORM_MAP[0], JSON.stringify(v0.config.tables.FORM_MAP[0]));
ok('statusFlow default', JSON.stringify(m0.legacy.statusFlow) === JSON.stringify(['Pending', 'Approved', 'Denied', 'Expired']), JSON.stringify(m0.legacy.statusFlow));
ok('expiredStatus default', m0.legacy.expiredStatus === 'Expired', String(m0.legacy.expiredStatus));
ok('patrol statusFlow default', JSON.stringify(m0.legacy.patrol.statusFlow) === JSON.stringify(['Pending', 'Flagged', 'Approved', 'Denied', 'Processed']), JSON.stringify(m0.legacy.patrol.statusFlow));
ok('patrol approved/denied statuses default', m0.legacy.patrol.approvedStatus === 'Approved' && m0.legacy.patrol.deniedStatus === 'Denied', JSON.stringify([m0.legacy.patrol.approvedStatus, m0.legacy.patrol.deniedStatus]));

// ---- 2 · key aliases (renamed keys keep working) ----
console.log('\n[2] aka aliases — legacy rows are honoured');
const vOld = X.validateConfig_({ SHEETS: { kind: 'kv', kv: { FORM_RESPONSES: 'My Leave Tab', PATROL_RESPONSES: 'My Patrol Tab' } } });
ok('old-name rows: zero ERRORs', errsOf(vOld.problems).length === 0, JSON.stringify(errsOf(vOld.problems).slice(0, 3)));
const mOld = X.materialize_(vOld.config, true);
ok('FORM_RESPONSES value lands on sheets.form', mOld.legacy.sheets.form === 'My Leave Tab', String(mOld.legacy.sheets.form));
ok('PATROL_RESPONSES value lands on sheets.patrol', mOld.legacy.sheets.patrol === 'My Patrol Tab', String(mOld.legacy.sheets.patrol));
const vBoth = X.validateConfig_({ SHEETS: { kind: 'kv', kv: { FORM_RESPONSES: 'Old Name', LEAVE_FORM_RESPONSES: 'New Name' } } });
const mBoth = X.materialize_(vBoth.config, true);
ok('when BOTH rows exist the NEW name wins', mBoth.legacy.sheets.form === 'New Name', String(mBoth.legacy.sheets.form));
const vNew = X.validateConfig_({ SHEETS: { kind: 'kv', kv: { LEAVE_FORM_RESPONSES: 'Direct New' } } });
ok('new-name row alone works', X.materialize_(vNew.config, true).legacy.sheets.form === 'Direct New');

// ---- 3 · coercion & validation still catch real mistakes ----
console.log('\n[3] validation catches bad values');
const vBad = X.validateConfig_({ ROSTER_LAYOUT: { kind: 'kv', kv: { HEADER_ROW: 'abc' } } });
ok('non-numeric int -> ERROR', errsOf(vBad.problems).some((p) => String(p.key).indexOf('HEADER_ROW') !== -1), JSON.stringify(vBad.problems.slice(0, 2)));
const vEnum = X.validateConfig_({ ROSTER_LAYOUT: { kind: 'kv', kv: { DIVIDER_MODE: 'NONSENSE' } } });
ok('bad enum -> ERROR', errsOf(vEnum.problems).some((p) => String(p.key).indexOf('DIVIDER_MODE') !== -1), JSON.stringify(vEnum.problems.slice(0, 2)));
const vList = X.validateConfig_({ PUBLISH: { kind: 'kv', kv: { NEVER_PUBLISH: 'EMAIL, DOB' } } });
ok('custom NEVER_PUBLISH list coerces to 2 entries', JSON.stringify(X.materialize_(vList.config, true).kv.PUBLISH.NEVER_PUBLISH) === JSON.stringify(['EMAIL', 'DOB']), JSON.stringify(X.materialize_(vList.config, true).kv.PUBLISH.NEVER_PUBLISH));
const vUnknown = X.validateConfig_({ SHEETS: { kind: 'kv', kv: { TOTALLY_UNKNOWN_KEY: 'x' } } });
ok('unknown key never ERRORs (preserved/ignored)', errsOf(vUnknown.problems).length === 0, JSON.stringify(errsOf(vUnknown.problems).slice(0, 2)));
const vTz = X.validateConfig_({ SCHEDULE: { kind: 'kv', kv: { NIGHTLY_HOUR: '25' } } });
ok('out-of-range int -> ERROR', errsOf(vTz.problems).some((p) => String(p.key).indexOf('NIGHTLY_HOUR') !== -1), JSON.stringify(vTz.problems.slice(0, 2)));

// ---- 4 · every schema key has coherent spec fields; aka names never collide with real keys ----
console.log('\n[4] schema self-consistency');
let specIssues = [];
Object.keys(X.BLOCK_SPECS_).forEach((b) => {
  const spec = X.BLOCK_SPECS_[b];
  if (spec.type !== 'kv') return;
  Object.keys(spec.keys).forEach((k) => {
    const s = spec.keys[k];
    if (!s.t) specIssues.push(b + '.' + k + ': no type');
    if (s.aka && spec.keys[s.aka]) specIssues.push(b + '.' + k + ': aka "' + s.aka + '" collides with a real key');
    if (s.t === 'enum' && (!s.enum || !s.enum.length)) specIssues.push(b + '.' + k + ': enum without values');
    if (s.req && s.d === undefined) specIssues.push(b + '.' + k + ': required without default');
  });
});
ok('all kv specs coherent (type/enum/default/aka)', specIssues.length === 0, specIssues.slice(0, 4).join(' | '));

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
