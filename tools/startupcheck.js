// Real startup trigger functions, with in-memory services and creation failures.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
let held=false,triggers=[],created=0,failAt=0,linked=false,audit=true;
let triggerBusy=false,scriptLockReads=0;
const config={kv:{SCHEDULE:{NIGHTLY_HOUR:21},ACTIVITY:{AUTO_RESET:true,RESET_CADENCE:'MONTHLY',WEEKLY_HOURS_RESET:'OFF',RESET_DOM:8,WEEKLY_RESET_HOUR:4}}};
const ctx={cfg_:()=>config,PropertiesService:{getDocumentProperties:()=>({getProperty:()=>linked?'public':null})},SpreadsheetApp:{getActive:()=>({})},LockService:{getScriptLock:()=>({hasLock:()=>held,tryLock(){held=true;return true},releaseLock(){held=false}})},log_(){},logInfo_(){},cpEnsureAuditTrigger:()=>audit,cpInvalidateHealth_(){},publishOnChange(){},AppError:class extends Error{constructor(code,detail){super(detail.reason)}},ScriptApp:{WeekDay:{SUNDAY:1},getProjectTriggers:()=>triggers.slice(),deleteTrigger:t=>{triggers=triggers.filter(x=>x!==t)},newTrigger(name){const schedule={};const builder=new Proxy({}, {get:(target,key)=>key==='create'?()=>{created++;if(created===failAt)throw Error('creation quota');const trigger={name,schedule,getHandlerFunction:()=>name};triggers.push(trigger);return trigger}:(...args)=>{schedule[key]=args;return builder}});return builder}}};
vm.createContext(ctx);
// Roster publishing/mutations occupy the script lock; trigger setup has its own
// current-user lock. The installer must not even request the busy writer lock.
ctx.LockService.getScriptLock=()=>{scriptLockReads++;throw Error('writer lock occupied by publishing');};
ctx.LockService.getUserLock=()=>({hasLock:()=>held,tryLock(){if(triggerBusy)return false;held=true;return true;},releaseLock(){held=false;}});
ctx.SpreadsheetApp.getActive=()=>({getId:()=> 'bound',getName:()=> 'Internal'});
ctx.ScriptApp.EventType={ON_EDIT:'EDIT',ON_CHANGE:'CHANGE',CLOCK:'CLOCK'};
ctx.ScriptApp.getProjectTriggers=()=>{
 triggers.forEach(t=>{
  if(!t.getEventType)t.getEventType=()=>t.schedule?.onEdit?ctx.ScriptApp.EventType.ON_EDIT:t.schedule?.onChange?ctx.ScriptApp.EventType.ON_CHANGE:ctx.ScriptApp.EventType.CLOCK;
  if(!t.getTriggerSourceId)t.getTriggerSourceId=()=>t.schedule?.forSpreadsheet?.[0]?.getId()||null;
 });return triggers.slice();
};
function load(file,name){const code=fs.readFileSync(file,'utf8'),start=code.indexOf('function '+name+'('),end=code.indexOf('\nfunction ',start+1);vm.runInContext(code.slice(start,end<0?undefined:end),ctx)}
for(const name of ['replaceManagedTriggers_','ensurePublicPublishingTriggers_','installConfiguredTriggers_'])load('RosterSystem.gs',name);
load('RosterExtras.gs','installExtrasTriggers_');
const old=name=>({name,getHandlerFunction:()=>name});
triggers=[old('customJob'),old('onFormSubmit'),old('onFormSubmit'),old('processDailyLOAs'),old('publishSweep')];
ctx.installConfiguredTriggers_();
assert.equal(triggers.filter(t=>t.name==='onFormSubmit').length,1);
assert.equal(triggers.filter(t=>t.name==='memberTransferEdited').length,1);
assert.equal(triggers.find(t=>t.name==='memberTransferSweep').schedule.everyMinutes[0],1,'internal transfer retries do not depend on a public link');
assert.equal(triggers.find(t=>t.name==='processDailyLOAs').schedule.atHour[0],21);
assert(triggers.some(t=>t.name==='customJob'));
assert(!triggers.some(t=>t.name==='publishSweep'),'unlinked public publishing has no minute trigger');
assert.equal(triggers.find(t=>t.name==='weeklyResetScheduled').schedule.onMonthDay[0],8,'monthly cadence ignores weekly OFF');
assert.equal(scriptLockReads,0,'core/extras setup must succeed while the roster writer lock is busy');
const busyBefore=triggers.slice(),busyCreated=created;triggerBusy=true;
assert.throws(()=>ctx.installConfiguredTriggers_(),/Another trigger installation/);
assert.deepEqual(triggers,busyBefore);assert.equal(created,busyCreated,'competing trigger setup fails before any mutation');triggerBusy=false;
// Startup before linking, then link: install just public triggers without rerunning core/extras.
linked=true;const core=triggers.find(t=>t.name==='onFormSubmit');assert(ctx.ensurePublicPublishingTriggers_(false).installed);
assert(triggers.includes(core));assert.equal(triggers.filter(t=>t.name==='publishOnChange').length,2);
const stable=created;assert(!ctx.ensurePublicPublishingTriggers_(false).installed);assert.equal(created,stable,'healthy sets are not recreated');
const edit=triggers.find(t=>t.name==='publishOnChange'&&t.getEventType()==='EDIT');edit.getTriggerSourceId=()=> 'wrong-workbook';
assert(ctx.ensurePublicPublishingTriggers_(false).installed,'same handler on wrong source is repaired');
const valid=triggers.slice();failAt=created+2;
assert.throws(()=>ctx.ensurePublicPublishingTriggers_(true),/creation quota/);assert.deepEqual(triggers,valid,'public trigger creation failure retains previous set');assert(!held);
failAt=0;linked=false;ctx.ensurePublicPublishingTriggers_(false);assert(!triggers.some(t=>t.name==='publishOnChange'));
const before=triggers.slice();created=0;failAt=2;
assert.throws(()=>ctx.installConfiguredTriggers_(),/creation quota/);
assert.deepEqual(triggers,before,'failed core replacement retains original triggers and removes staged trigger');assert(!held);
failAt=0;created=0;linked=true;ctx.installConfiguredTriggers_();ctx.installConfiguredTriggers_();
assert.equal(triggers.filter(t=>t.name==='publishOnChange').length,2);
assert.equal(triggers.filter(t=>t.name==='publishSweep').length,1);
config.kv.ACTIVITY.AUTO_RESET=false;ctx.installConfiguredTriggers_();assert(!triggers.some(t=>t.name==='weeklyResetScheduled'));
audit=false;assert.throws(()=>ctx.installConfiguredTriggers_(),/audit trigger/,'busy audit verification cannot report success');
const wizard=fs.readFileSync('RosterSystem.gs','utf8').split('function setupWizard()')[1].split('function installDataValidation_')[0];
assert(wizard.includes('installConfiguredTriggers_()'));assert(!wizard.includes('styleFormResponses_(sheet)'));assert(!wizard.includes('CONFIG.form.discord,'));
assert(!/FormApp\.create\s*\(/.test(fs.readdirSync('.').filter(f=>f.endsWith('.gs')).map(f=>fs.readFileSync(f,'utf8')).join('\n')));
console.log('Startup: configured schedules, duplicate cleanup, custom trigger preservation, creation rollback, monthly/OFF semantics, public-link gating, audit failure and department-owned forms passed');
// Real link/menu callers invoke the same verifier before publishing.
load('RosterControlPanel.gs','setupPublicRoster');load('RosterControlPanel.gs','publishPublicRosterNow');
ctx.PUBLIC_FILE_PROP_='PUBLIC_ROSTER_ID';ctx.runAction_=(label,fn)=>fn();
const publicFile={getId:()=> 'public',getName:()=> 'Public',getUrl:()=> 'https://example.test/public'};
const ui={Button:{OK:'OK'},ButtonSet:{OK_CANCEL:'OK_CANCEL',OK:'OK'},prompt:()=>({getSelectedButton:()=> 'OK',getResponseText:()=> 'p'.repeat(30)}),alert(){}};
ctx.SpreadsheetApp.getUi=()=>ui;ctx.SpreadsheetApp.openById=()=>publicFile;
ctx.PropertiesService.getDocumentProperties=()=>({getProperty:()=>linked?'public':null,setProperty:()=>{linked=true;}});
let publishes=0;ctx.publishPublicRoster=()=>{publishes++;assert.equal(triggers.filter(t=>t.name==='publishOnChange').length,2,'edit trigger must exist before first publish');return {linked:true,tabs:[],rows:0,url:'test'};};
linked=false;ctx.ensurePublicPublishingTriggers_(false);ctx.setupPublicRoster();assert.equal(publishes,1);
triggers=triggers.filter(t=>t.name!=='publishOnChange');ctx.publishPublicRosterNow();assert.equal(publishes,2);assert.equal(triggers.filter(t=>t.name==='publishOnChange').length,2,'manual publishing repairs existing departments');
console.log('Public auto-update: startup-before-link, idempotent repair, event/source checks, rollback and real link/menu wiring passed.');
// Real audit setup shares the trigger lock, including reentrant callers, quota
// failures and simultaneous panel opens. It also ignores the busy writer lock.
load('RosterTrust.gs','cpEnsureAuditTrigger');
const cached=new Map();ctx.CacheService={getUserCache:()=>({get:k=>cached.get(k),put:(k,v)=>cached.set(k,v)})};
triggers.push({name:'recordEdit',getHandlerFunction:()=> 'recordEdit',getEventType:()=> 'ON_EDIT'});
ctx.ScriptApp.EventType.ON_EDIT='ON_EDIT';ctx.ScriptApp.EventType.ON_CHANGE='ON_CHANGE';
assert(ctx.cpEnsureAuditTrigger(true));assert(!held);assert.equal(scriptLockReads,0);
const auditCreated=created;assert(ctx.cpEnsureAuditTrigger());assert.equal(created,auditCreated,'cached panel opens do not create triggers');
triggers.push({name:'auditEdit',getHandlerFunction:()=> 'auditEdit',getEventType:()=> 'ON_EDIT'});
assert(ctx.cpEnsureAuditTrigger(true));assert.equal(triggers.filter(t=>t.name==='auditEdit').length,1,'audit setup removes duplicates');
assert(!triggers.some(t=>t.name==='recordEdit'),'legacy audit trigger removed');
held=true;assert(ctx.cpEnsureAuditTrigger(true));assert(held,'nested audit setup does not release caller lock');held=false;
triggerBusy=true;const auditBefore=triggers.slice();assert.equal(ctx.cpEnsureAuditTrigger(true),false);assert.deepEqual(triggers,auditBefore);triggerBusy=false;
triggers=triggers.filter(t=>t.name!=='auditEdit');failAt=created+1;assert.throws(()=>ctx.cpEnsureAuditTrigger(true),/creation quota/);assert(!held,'audit creation failure releases trigger lock');failAt=0;
ctx.installConfiguredTriggers_();assert.equal(scriptLockReads,0,'complete installer including audit is independent of writer activity');assert(!held);
console.log('Trigger lock isolation: busy writer, competing setup, no premature changes, nested ownership, real audit installation/duplicates/cache and quota cleanup passed.');
// Support initialization uses runtime names and never touches existing tabs or adds sample records.
ctx.SYS_LOG_SHEET='SYS Log';
ctx.TRUST={snapshotSheet:'Custom snapshots',auditSheet:'Edit Log'};
ctx.EXTRAS={integritySheet:'Custom integrity',coverageSheet:'Custom coverage',historySheet:'Custom history'};
ctx.theme_=()=> '#222222';
load('RosterSystem.gs','ensureStartupSupportSheets_');
load('RosterSystem.gs','styleStartupSupportSheet_');
load('RosterSystem.gs','sortSupportRows_');load('RosterSystem.gs','ensureSupportFilter_');load('RosterSystem.gs','supportCoverageEnd_');
const support=new Map(),events=[];
const supportBook={getSheetByName:name=>support.get(name),insertSheet(name){
  const range=new Proxy({}, {get:(o,k)=>(...args)=>{events.push([name,k,args]);return range}});
  const sh=new Proxy({getRange:()=>range,getFilter:()=>null,getLastRow:()=>1,getLastColumn:()=>8,getMaxRows:()=>1000,getMaxColumns:()=>26}, {get:(o,k)=>k in o?o[k]:(...args)=>{events.push([name,k,args]);return sh}});
  support.set(name,sh);return sh;
}};
assert.equal(ctx.ensureStartupSupportSheets_(supportBook).length,6);
assert.equal(events.filter(e=>e[1]==='hideSheet').length,3);
assert(events.filter(e=>e[1]==='setValues').every(e=>e[2][0].length===1),'only headers written');
const eventCount=events.length;
assert.equal(ctx.ensureStartupSupportSheets_(supportBook).length,0);
assert.equal(events.slice(eventCount).filter(e=>e[1]==='setValues').length,0,'repeat setup preserves existing data');
assert(events.some(e=>e[1]==='setBackground'&&e[2][0]==='#20242a'),'support sheets use a dark foundation');
assert(wizard.includes('ensureStartupSupportSheets_(ss)'));
// Real seeding twice: populated defaults only on the first pass; no clear/write on the verified pass.
let grid=[],writes=0,clears=0,lastColumn=5;const layoutEvents=[];
const paintedTail=[];
const sheet=new Proxy({getSheetId:()=>99,getLastRow:()=>grid.length,getLastColumn:()=>lastColumn,getMaxColumns:()=>26,getMaxRows:()=>2000,showColumns:(...a)=>layoutEvents.push(['showColumns',...a]),hideColumns:(...a)=>layoutEvents.push(['hideColumns',...a]),showRows:(...a)=>layoutEvents.push(['showRows',...a]),hideRows:(...a)=>layoutEvents.push(['hideRows',...a]),getName:()=> 'Config',getProtections:()=>[],getRange(r,c,n=1,w=1){return new Proxy({}, {get:(target,key)=>key==='setBackground'?color=>{paintedTail.push({r,c,n,w,color});return sheet.getRange(r,c,n,w)}:key==='getDisplayValues'?()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>String(grid[r+i-1]?.[c+j-1]??''))):key==='setValues'?values=>{grid=values.map(row=>Array.from(row));writes++;return target}:key==='getDisplayValue'?()=>String(grid[r-1]?.[c-1]??''):key.startsWith('clear')?()=>{clears++;return sheet.getRange(r,c,n,w)}:()=>sheet.getRange(r,c,n,w)})}}, {get:(target,key)=>key in target?target[key]:()=>sheet});
const seedCtx={SpreadsheetApp:{ProtectionType:{SHEET:1},flush(){}},console};vm.createContext(seedCtx);vm.runInContext(fs.readFileSync('RosterConfig.gs','utf8'),seedCtx);
seedCtx.findConfigSheet_=()=>sheet;seedCtx.cfgInvalidate_=()=>{};seedCtx.theme_=()=> '#222222';
seedCtx.seedConfigTab_({});const initialWrites=writes,initialClears=clears;
assert(initialWrites>0);seedCtx.seedConfigTab_({});assert.equal(writes,initialWrites);assert.equal(clears,initialClears,'unchanged config preserves notes, formatting and validation');
console.log('Config seeding: verified tables and settings cause no repeated grid writes or clearing.');
assert(layoutEvents.some(e=>e[0]==='hideColumns'&&e[1]===5),'empty columns after the four-column configuration are hidden');
assert(paintedTail.some(e=>e.r===grid.length+1&&e.n===2000-grid.length&&e.w===5&&e.color==='#191d23'),'all allocated trailing rows are dark, including hidden rows');
assert(layoutEvents.some(e=>e[0]==='hideRows'&&e[1]===grid.length+3),'trailing rows are hidden after two dark padding rows');
lastColumn=8;layoutEvents.length=0;seedCtx.ensureConfigSheetStyle_(sheet,grid,true);
assert(layoutEvents.some(e=>e[0]==='showColumns'&&e[2]===8),'populated custom columns stay visible');
assert(layoutEvents.some(e=>e[0]==='hideColumns'&&e[1]===9),'only columns beyond custom data are hidden');lastColumn=5;
const styled=seedCtx.configSheetStylePlan_(grid),beforeValues=JSON.stringify(grid);
assert.equal(styled[0].kind,'title');assert(styled.some(row=>row.kind==='columns'));assert(styled.some(row=>row.kind==='data'&&row.backgrounds[1]==='#24374a'));
seedCtx.ensureConfigSheetStyle_(sheet,grid,true);assert.equal(JSON.stringify(grid),beforeValues,'restyling does not rewrite settings or table values');
if(process.argv.includes('--preview')){
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html='<!doctype html><meta charset="utf-8"><title>Config design preview</title><style>body{margin:0;background:#191d23;color:#e4e9f0;font:11px Arial}header{padding:14px 20px;background:#14181e;color:#aeb9c8}table{border-collapse:collapse;table-layout:fixed;width:1390px}td{padding:8px 10px;white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:middle;box-sizing:border-box}td:first-child{font:10px ui-monospace,Consolas,monospace}.title td{height:58px}.title td:nth-child(2){font-size:18px;font-weight:bold}.section td{height:44px;font-weight:bold}.columns td{height:30px;font-weight:bold}.space td{height:12px;padding:0}.data td{min-height:32px}</style><header>Config sheet design preview · example defaults · actual spreadsheet formatting may vary slightly</header><table><colgroup>'+[270,280,540,160,140].map(w=>'<col style="width:'+w+'px">').join('')+'</colgroup>'+grid.map((row,i)=>'<tr class="'+styled[i].kind+'">'+row.map((v,c)=>'<td style="background:'+styled[i].backgrounds[c]+';color:'+styled[i].colors[c]+'">'+escape(v)+'</td>').join('')+'</tr>').join('')+'</table>';
  fs.mkdirSync('tools/.preview',{recursive:true});fs.writeFileSync('tools/.preview/Config.preview.html',html.replace('font:11px Arial','font:11pt Arial').replace('font:10px ui-monospace','font:10pt ui-monospace').replace('font-size:18px','font-size:18pt'));
  fs.writeFileSync('tools/.preview/Config.preview.json',JSON.stringify({grid,styled}));console.log('Wrote tools/.preview/Config.preview.html');
}
