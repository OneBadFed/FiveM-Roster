/**
 * ============================================================================
 * ROSTER ENGINE — TEMPLATE SHIM  (Phase 2, brief D1 + D5)
 * ============================================================================
 * ⚠️ THIS FILE IS THE PUBLIC TEMPLATE'S BOUND SCRIPT — DO **NOT** PASTE IT INTO
 *    A SPREADSHEET THAT HAS THE ENGINE FILES PASTED DIRECTLY (bound mode).
 *    It is only used when the engine is attached AS A LIBRARY.
 *
 * SETUP (see ROSTER-ENGINE-V2-RUNBOOK.md for the full walkthrough):
 *   1. The engine lives in a standalone Apps Script project, deployed as a
 *      versioned LIBRARY.
 *   2. In the template spreadsheet's bound project: paste ONLY this file, then
 *      Editor ▸ Libraries ▸ + ▸ paste the engine's Script ID ▸ pick the newest
 *      version ▸ identifier MUST be:  RE
 *   3. Reload the sheet → 📋 Roster menu appears → 🚀 First-Run Setup.
 *
 * WHY THIS EXISTS:
 *   • Simple triggers (onOpen/onEdit) and installable-trigger HANDLER NAMES must
 *     live in the bound script — these forwarders hand them straight to the
 *     library. Menu items need no forwarders (they call RE.* directly).
 *   • google.script.run from the Control Panel dialog can only reach BOUND
 *     globals — dispatch() below is that single entry point.
 *
 * D5 — SECURITY: dispatch() WHITELISTS endpoint names (frozen literal list) and
 * never resolves the name in its own scope, so dialog HTML — an exposed surface —
 * cannot invoke arbitrary functions. The engine re-validates against its own map
 * (defense in depth) and raises coded E-506 for anything unknown.
 *
 * UPDATES: a bug fix = new library version → Libraries ▸ RE ▸ bump version. A new
 * panel endpoint additionally needs its name added to RE_ENDPOINTS below.
 * ============================================================================
 */

/** Every Control-Panel endpoint this template permits. Must mirror the engine's DISPATCH_ENDPOINTS_. */
const RE_ENDPOINTS = Object.freeze([
  'cpPing', 'cpBootstrap', 'cpRefresh', 'cpGetProfile',
  'cpSetStatus', 'cpSetStatusBulk', 'cpScheduleLeave', 'cpAssignMember', 'cpMoveMember',
  'cpRunAction', 'cpJumpTo', 'cpSystemInfo',
  'cpColumnsInfo', 'cpSetColumnClass', 'cpDividersInfo',
  'cpFixTriggers', 'cpTakeSnapshot', 'cpRestoreSnapshot', 'cpSetSnapshotAuto',
  'cpSetWebhook', 'cpTestWebhook',
  'cpGetConfig', 'cpApplyConfig', 'cpOpenSettings',
  'cpRankIcons', 'cpSetRankIcon', 'cpDeleteRankIcon',
  'cpSetDividerStyle', 'cpDeleteDividerStyle',
  'cpAdminSetup', 'cpAdminInfo', 'cpAddDiscipline', 'cpSignupList', 'cpSignupApprove',
]);

/** The Control Panel's single server entry point (google.script.run.dispatch). */
function dispatch(name, args) {
  if (RE_ENDPOINTS.indexOf(String(name)) === -1) {
    throw new Error(`E-506: Unknown panel endpoint "${name}". Only whitelisted endpoints may be dispatched.`);
  }
  return RE.dispatch(name, args); // the engine re-validates + applies args
}

/* ---- Simple triggers (must live in the bound script) ---- */
function onOpen() { RE.onOpenLib('RE'); }
function onEdit(e) { RE.onEdit(e); }

/* ---- Installable-trigger handlers (trigger handler names resolve here) ----
 * This list must cover EVERY name the engine passes to ScriptApp.newTrigger():
 * onFormSubmit · processDailyLOAs · weeklyResetScheduled · scanIntegrity ·
 * buildCoverage · auditEdit · weeklySnapshotScheduled (panel Auto-weekly toggle). */
function onFormSubmit(e) { RE.onFormSubmit(e); }
function processDailyLOAs() { RE.processDailyLOAs(); }
function weeklyResetScheduled() { RE.weeklyResetScheduled(); }
function scanIntegrity() { RE.scanIntegrity(); }
function buildCoverage() { RE.buildCoverage(); }
function auditEdit(e) { RE.auditEdit(e); }
function weeklySnapshotScheduled() { RE.weeklySnapshotScheduled(); }
function publishCatchup() { RE.publishCatchup(); }
