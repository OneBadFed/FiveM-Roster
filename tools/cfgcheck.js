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
const tail = '\n;globalThis.__X = { BLOCK_SPECS_: typeof BLOCK_SPECS_!=="undefined"?BLOCK_SPECS_:null, BLOCK_ORDER_, RETIRED_, validateConfig_, materialize_, norm_, coerce_: typeof coerce_!=="undefined"?coerce_:null, parseBlocks_, LOG_ORDER_ };';
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
const leaveOff=X.validateConfig_({SHEETS:{kind:'kv',kv:{LEAVE_FORM_RESPONSES:''}}});
ok('explicit blank leave-form setting is valid', errsOf(leaveOff.problems).length===0);
const leaveOffLegacy=X.materialize_(leaveOff.config,true).legacy;
ok('blank leave-form setting stays off without default substitution',leaveOffLegacy.sheets.form==='');
ok('disabled leave intake retains tracker and schedule configuration',leaveOffLegacy.sheets.tracker===m0.legacy.sheets.tracker&&leaveOffLegacy.expiredStatus===m0.legacy.expiredStatus);

// ---- 2b · CROSS-BLOCK aka: the activity keys moved to [ACTIVITY]. A sheet written before the move still holds
// them under [SCHEDULE] / [ROSTER_LAYOUT] / [SHEETS]; those values must MIGRATE, not reset to defaults. ----
console.log('\n[2b] cross-block aka — a pre-move sheet keeps its settings');
const vMoved = X.validateConfig_({
  SCHEDULE: { kind: 'kv', kv: { AUTO_RESET: 'FALSE', RESET_CADENCE: 'BIWEEKLY', WEEKLY_HOURS_RESET: 'FRI', PERIOD_BUCKET: 'MONTH', PERIOD_LABEL_FORMAT: 'MMMM yyyy' } },
  ROSTER_LAYOUT: { kind: 'kv', kv: { LAST_ACTIVITY_COLS: 'AB, AC', LAST_ACTIVITY_STYLE: 'NEUTRAL' } },
  SHEETS: { kind: 'kv', kv: { ACTIVITY: 'My Activity Board' } },
});
ok('pre-move rows: zero ERRORs', errsOf(vMoved.problems).length === 0, JSON.stringify(errsOf(vMoved.problems).slice(0, 3)));
const kvM = vMoved.config.kv.ACTIVITY, mM = X.materialize_(vMoved.config, true);
ok('AUTO_RESET=FALSE survives the move', kvM.AUTO_RESET === false, String(kvM.AUTO_RESET));
ok('RESET_CADENCE=BIWEEKLY survives', kvM.RESET_CADENCE === 'BIWEEKLY', String(kvM.RESET_CADENCE));
ok('WEEKLY_HOURS_RESET=FRI survives', kvM.WEEKLY_HOURS_RESET === 'FRI', String(kvM.WEEKLY_HOURS_RESET));
ok('PERIOD_BUCKET=MONTH survives', kvM.PERIOD_BUCKET === 'MONTH', String(kvM.PERIOD_BUCKET));
ok('PERIOD_LABEL_FORMAT survives', kvM.PERIOD_LABEL_FORMAT === 'MMMM yyyy', String(kvM.PERIOD_LABEL_FORMAT));
ok('LAST_ACTIVITY_COLS survives (list)', JSON.stringify(kvM.LAST_ACTIVITY_COLS) === '["AB","AC"]', JSON.stringify(kvM.LAST_ACTIVITY_COLS));
ok('LAST_ACTIVITY_STYLE reaches the legacy bridge', mM.legacy.lastActivityStyle === 'NEUTRAL', String(mM.legacy.lastActivityStyle));
ok('SHEETS.ACTIVITY -> ACTIVITY.PANEL_TAB -> sheets.activity', mM.legacy.sheets.activity === 'My Activity Board', String(mM.legacy.sheets.activity));
const vWin = X.validateConfig_({
  SCHEDULE: { kind: 'kv', kv: { RESET_CADENCE: 'WEEKLY' } },
  ACTIVITY: { kind: 'kv', kv: { RESET_CADENCE: 'MONTHLY' } },
});
ok('an explicit [ACTIVITY] row beats the old block', vWin.config.kv.ACTIVITY.RESET_CADENCE === 'MONTHLY', String(vWin.config.kv.ACTIVITY.RESET_CADENCE));
ok('defaults still apply with no rows at all', v0.config.kv.ACTIVITY.PERIOD_BUCKET === 'RESET' && v0.config.kv.ACTIVITY.AUTO_RESET === true);

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
ok('BLOCK_ORDER_ covers BLOCK_SPECS_ exactly', Object.keys(X.BLOCK_SPECS_).every((b) => X.BLOCK_ORDER_.indexOf(b) !== -1) && X.BLOCK_ORDER_.every((b) => X.BLOCK_SPECS_[b]),
  'order=' + X.BLOCK_ORDER_.length + ' specs=' + Object.keys(X.BLOCK_SPECS_).length);
ok('nothing is both retired AND live', X.RETIRED_.blocks.every((b) => !X.BLOCK_SPECS_[b]) &&
  Object.keys(X.RETIRED_.keys).every((b) => !X.BLOCK_SPECS_[b] || X.RETIRED_.keys[b].every((k) => !X.BLOCK_SPECS_[b].keys[k])));

// ---- 5 · parseBlocks_ boundaries. A table block used to have no next-marker guard, so ONE hand-deleted
// separator row let it swallow the following block whole — the swallowed block then vanished from the parse
// and silently fell back to its seed defaults. The kv reader always stopped correctly; both now do. ----
console.log('\n[5] block boundaries survive a hand-deleted separator row');
const fakeSheet = (rows) => {
  const W = Math.max(...rows.map((r) => r.length), 1);
  const g = rows.map((r) => { const o = r.slice(); while (o.length < W) o.push(''); return o; });
  return { getLastRow: () => g.length, getLastColumn: () => W,
    getRange: (r, c, nr, nc) => ({ getDisplayValues: () => g.slice(r - 1, r - 1 + nr).map((x) => x.slice(c - 1, c - 1 + nc)) }) };
};
const rawT = X.parseBlocks_(fakeSheet([
  ['RE_CONFIG', 'header'], [],
  ['[STATUSES]', '', 'help'],
  ['Status', 'Kind', 'MinHours', 'Color'],
  ['Active', 'TIER', '10', '#57b85a'],
  ['Inactive', 'TIER', '0', '#e0574f'],
  /* the blank separator seedConfigTab_ writes has been deleted by hand */
  ['[SECTION_TAGS]', '', 'help'],
  ['Label', 'Keywords', 'Tone'],
  ['Patrol', 'PATROL', 'patrol'], [],
]));
ok('TABLE block stops at the next [MARKER]', rawT.STATUSES.rows.length === 2, JSON.stringify(rawT.STATUSES.rows));
ok('the following block still parses', !!rawT.SECTION_TAGS && rawT.SECTION_TAGS.rows.length === 1, Object.keys(rawT).join(','));
const rawK = X.parseBlocks_(fakeSheet([
  ['RE_CONFIG', 'h'], [], ['[DASHBOARD]', '', 'help'], ['ENABLE', 'TRUE', 'help'],
  ['[LOGGING]', '', 'help'], ['LOG_LEVEL', 'DEBUG', 'help'], [],
]));
ok('KV block stops at the next [MARKER]', Object.keys(rawK.DASHBOARD.kv).length === 1 && !!rawK.LOGGING, Object.keys(rawK).join(','));

// ---- 6 · every [SHEETS] role must resolve to its OWN tab. WELCOME was the one role outside the check,
// and the publish force-mirrors that tab's header cells from the internal copy. ----
console.log('\n[6] tab-role collisions');
const sheetErrs = (block, key, val) => {
  const r = { SHEETS: { kind: 'kv', kv: { ROSTER: 'Member Information' } } };
  r[block] = r[block] || { kind: 'kv', kv: {} };
  r[block].kv[key] = val;
  return errsOf(X.validateConfig_(r).problems).filter((p) => p.type === 'sheet').length;
};
['COVERAGE', 'SIGNUPS', 'INTEGRITY', 'WELCOME'].forEach((role) => {
  ok('[SHEETS].' + role + ' colliding with the roster -> ERROR', sheetErrs('SHEETS', role, 'Member Information') > 0);
});
ok('[ACTIVITY].PANEL_TAB colliding with the roster -> ERROR', sheetErrs('ACTIVITY', 'PANEL_TAB', 'Member Information') > 0);
ok('a role named after the reserved SYS Log -> ERROR', sheetErrs('SHEETS', 'WELCOME', 'SYS Log') > 0);

// ---- 7 · a status the engine WRITES must be offered by the dropdown it writes into ----
console.log('\n[7] status-name membership');
const vPat = X.validateConfig_({ PATROL: { kind: 'kv', kv: { STATUS_FLOW: 'New, Credited', PROCESSED_STATUS: 'Processed', FLAGGED_STATUS: 'Flagged' } } });
// all four: APPROVED_STATUS/DENIED_STATUS keep their 'Approved'/'Denied' defaults, which this flow omits too
ok('[PATROL] statuses outside STATUS_FLOW -> WARN', vPat.problems.filter((p) => String(p.key).indexOf('[PATROL]') === 0).length === 4,
  JSON.stringify(vPat.problems.map((p) => p.key)));
ok('[PATROL] mismatch is never fatal', errsOf(vPat.problems).length === 0);
const vFlag = X.validateConfig_({ LEAVE: { kind: 'kv', kv: { FLAGGED_STATUS: 'Needs Review' } } });
ok('[LEAVE].FLAGGED_STATUS outside STATUS_FLOW -> WARN', vFlag.problems.some((p) => p.key === '[LEAVE].FLAGGED_STATUS'));
const vAppr = X.validateConfig_({ LEAVE: { kind: 'kv', kv: { APPROVED_STATUS: 'Signed Off' } } });
ok('[LEAVE].APPROVED_STATUS outside STATUS_FLOW is still ERROR', errsOf(vAppr.problems).some((p) => p.key === '[LEAVE].APPROVED_STATUS'));

// ---- 8 · no silent truncation / no silently-ignored colour ----
console.log('\n[8] silent-failure guards');
const vCols = X.validateConfig_({ ACTIVITY: { kind: 'kv', kv: { LAST_ACTIVITY_COLS: 'AB, AC, AD, AE' } } });
ok('a 4th LAST_ACTIVITY column WARNs instead of vanishing', vCols.problems.some((p) => p.key === '[ACTIVITY].LAST_ACTIVITY_COLS'));
ok('3 columns stay silent', X.validateConfig_({ ACTIVITY: { kind: 'kv', kv: { LAST_ACTIVITY_COLS: 'AB, AC, AD' } } }).problems.length === 0);
// LOA/ROA rows included: [LEAVE].LEAVE_TYPES and RETURN_STATUS legitimately ERROR without them, which would
// mask what this case is actually asserting.
const vColor = X.validateConfig_({ STATUSES: { kind: 'table', header: ['Status', 'Kind', 'MinHours', 'Color'],
  rows: [['Active', 'TIER', '10', 'greenish'], ['Inactive', 'TIER', '0', '#e0574f'], ['LOA', 'LEAVE', '', '#4ea7d6'], ['ROA', 'LEAVE', '', '#e0a52c']] } });
ok('an unreadable [STATUSES] Color WARNs', vColor.problems.some((p) => p.type === 'color'));
ok('a bad colour is never fatal', errsOf(vColor.problems).length === 0);

// ---- 9 · retired blocks/keys leave quietly: no WARN on a sheet that still carries the row ----
console.log('\n[9] retirement is silent');
const vRet = X.validateConfig_({
  SECTIONS: { kind: 'table', header: ['Section'], rows: [['Patrol']] },
  SYSTEM: { kind: 'kv', kv: { DEV_MODE: 'TRUE', MAINTENANCE_MODE: 'FALSE' } },
  LOGGING: { kind: 'kv', kv: { EMAIL_ON_ERROR: 'TRUE' } },
});
ok('a retired BLOCK raises nothing', !vRet.problems.some((p) => p.key === '[SECTIONS]'), JSON.stringify(vRet.problems.map((p) => p.key)));
ok('retired KEYS raise nothing', !vRet.problems.some((p) => /DEV_MODE|MAINTENANCE_MODE|EMAIL_ON_ERROR/.test(String(p.key))));
ok('a genuinely unknown key still WARNs', X.validateConfig_({ SYSTEM: { kind: 'kv', kv: { WHO_KNOWS: 'x' } } }).problems.some((p) => p.key === '[SYSTEM].WHO_KNOWS'));

// ---- 10 · SYS Log severity ranks. DEBUG is 0, so any `|| default` fallback silently promotes it. ----
console.log('\n[10] log-level ordering');
ok('DEBUG ranks below INFO', X.LOG_ORDER_.DEBUG < X.LOG_ORDER_.INFO, JSON.stringify(X.LOG_ORDER_));
ok('slog_ compares with == null, not ||', /LOG_ORDER_\[sev\] == null/.test(src) && !/LOG_ORDER_\[sev\] \|\|/.test(src));

// ---- 11 · the two leave-expiry switches reach a consumer (they used to reach none) ----
console.log('\n[11] leave-expiry switches are published + consumed');
ok('autoExpire defaults ON', m0.legacy.autoExpire === true, String(m0.legacy.autoExpire));
ok('expireNeverApproved defaults OFF', m0.legacy.expireNeverApproved === false, String(m0.legacy.expireNeverApproved));
const vOff = X.materialize_(X.validateConfig_({ LEAVE: { kind: 'kv', kv: { AUTO_EXPIRE: 'FALSE', EXPIRE_NEVER_APPROVED: 'TRUE' } } }).config, true);
ok('AUTO_EXPIRE=FALSE reaches the bridge', vOff.legacy.autoExpire === false);
ok('EXPIRE_NEVER_APPROVED=TRUE reaches the bridge', vOff.legacy.expireNeverApproved === true);
const sysSrc = fs.readFileSync('RosterSystem.gs', 'utf8');
ok('processDailyLOAs_ actually reads CONFIG.autoExpire', /if \(!CONFIG\.autoExpire\) continue;/.test(sysSrc));
ok('processDailyLOAs_ actually reads CONFIG.expireNeverApproved', /CONFIG\.expireNeverApproved && st === PENDING/.test(sysSrc));

console.log('\n[12] malformed embed templates');
for (const json of ['not json','[]','null','{"fields":"wrong"}','{"fields":[null]}']) {
  const bad=X.validateConfig_({EMBEDS:{kind:'table',header:['Event','Json'],rows:[['audit',json]]}});
  ok('reject malformed embed '+json, bad.problems.some(p=>p.sev==='ERROR'&&p.key==='[EMBEDS].audit'));
}
const good=X.validateConfig_({EMBEDS:{kind:'table',header:['Event','Json'],rows:[['audit','{"fields":[{"n":"Name","v":"{name}"}]}']]}});
ok('valid embed templates accepted',!good.problems.some(p=>p.sev==='ERROR'&&p.key==='[EMBEDS].audit'));
const emptyStatuses=X.validateConfig_({STATUSES:{kind:'table',header:['Status','Kind','MinHours','Color'],rows:[]},STATUS_OVERRIDES:{kind:'table',header:['Scope','Match','Ladder'],rows:[]}});
ok('empty statuses do not block department setup',errsOf(emptyStatuses.problems).length===0);
const emptyRuntime=X.materialize_(emptyStatuses.config,false).legacy;
ok('empty statuses disable leave vocabulary and returning status',emptyRuntime.leaveTypes.length===0&&emptyRuntime.returnStatus==='');
const disabledLeave=X.validateConfig_({LEAVE:{kind:'kv',kv:{LEAVE_TYPES:'',RETURN_STATUS:''}}});
ok('explicit empty leave types are valid',errsOf(disabledLeave.problems).length===0&&disabledLeave.config.kv.LEAVE.LEAVE_TYPES.length===0);
ok('startup preserves deliberately empty table blocks',fs.readFileSync('RosterConfig.gs','utf8').includes('const dataRows = have !== null ? have : spec.seed;'));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
