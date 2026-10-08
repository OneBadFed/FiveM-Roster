// Fault injection against the real server and panel error boundaries. No Google calls.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const config=fs.readFileSync('RosterConfig.gs','utf8'),system=fs.readFileSync('RosterSystem.gs','utf8'),panel=fs.readFileSync('RosterControlPanel.gs','utf8');
let props={},logs=[],flushed=0,released=0,published=0,held=false,flushError=null,releaseError=null,publishError=null;
const property={getProperty:k=>props[k]??null,setProperty(k,v){props[k]=String(v);return this},deleteProperty(k){delete props[k];return this},getProperties:()=>({...props})};
const lock={hasLock:()=>held,tryLock:()=>{held=true;return true},releaseLock(){released++;held=false;if(releaseError)throw releaseError}};
const documentLock={hasLock:()=>true}; // this suite models diagnostic I/O inside a caller-owned document lock; supportcheck verifies independent ownership
const ctx={console:{error:v=>logs.push(v),warn:v=>logs.push(v),info:v=>logs.push(v),log:v=>logs.push(v)},PropertiesService:{getDocumentProperties:()=>property},LockService:{getScriptLock:()=>lock,getDocumentLock:()=>documentLock},SpreadsheetApp:{flush(){flushed++;if(flushError)throw flushError},getActive:()=>({getId:()=> 'sheet',getSheetByName:()=>null})},CacheService:{getScriptCache:()=>({get:()=>null,put(){}})},Utilities:{sleep(){}},Date,Math};
vm.createContext(ctx);vm.runInContext(config,ctx);vm.runInContext(system,ctx);vm.runInContext(panel,ctx);
ctx.publishAfterWrite_=()=>{published++;if(publishError)throw publishError};ctx.perf_=(label,fn)=>fn();ctx.maybeErrorWebhook_=()=>{};
// Invalid config is memoized before notifications read it again; malformed cache shapes use the sheet path.
const actualCfg=ctx.cfg_, actualFindConfig=ctx.findConfigSheet_;let notices=0;
ctx.CacheService.getDocumentCache=()=>({get:()=>JSON.stringify({ROSTER_LAYOUT:{kind:'kv',kv:{HEADER_ROW:'abc'}}})});
ctx.maybeErrorWebhook_=()=>{notices++;assert.throws(()=>actualCfg(),/E-102|Config invalid/)};
assert.throws(()=>actualCfg(),/E-102|Config invalid/);assert.equal(notices,1);
vm.runInContext('CFG_=null; CFG_ERROR_=null;',ctx);ctx.findConfigSheet_=()=>null;
ctx.CacheService.getDocumentCache=()=>({get:()=>'[]'});assert.equal(actualCfg().fromTab,false);
vm.runInContext('CFG_=null; CFG_ERROR_=null; _sysLogUnavailable_=false; _sysLogSeen_.clear();',ctx);ctx.findConfigSheet_=actualFindConfig;ctx.maybeErrorWebhook_=()=>{};
// Secret safety, hostile/circular contexts, text-cell formula protection, filtering and repeated-error I/O.
const secret='https://discord.com/api/webhooks/123/PRIVATE_TOKEN';assert(!ctx.diagnosticText_(secret).includes('PRIVATE_TOKEN'));assert(!ctx.diagnosticText_('Bearer ABCSECRET').includes('ABCSECRET'));
const circular={refresh_token:'PRIVATE_TOKEN'};circular.self=circular;assert(ctx.diagnosticContext_(circular).includes('[circular]'));assert(!ctx.diagnosticContext_(circular).includes('PRIVATE_TOKEN'));
let rows=[],reads=0;const sheet={getParent:()=>({getId:()=> 'sheet'}),appendRow:r=>rows.push(r),getLastRow:()=>rows.length+1,getLastColumn:()=>8,getMaxRows:()=>1000,getFilter:()=>null,getRange:()=>({sort(){},createFilter(){},setNumberFormat(){}}),deleteRows(){}};
ctx.SpreadsheetApp.getActive=()=>({getId:()=> 'sheet',getSheetByName:()=>{reads++;return sheet}});
ctx.slog_('ERROR','E-601','test','=IMPORTDATA(secret)',circular);ctx.slog_('ERROR','E-601','test','=IMPORTDATA(secret)',circular);assert.equal(rows.length,1);assert.equal(reads,1);assert(rows[0][5].startsWith("'="));
ctx.slog_('ERROR','E-601','redaction',secret);assert(!JSON.stringify(rows).includes('PRIVATE_TOKEN'));
const hostile={get message(){throw Error('getter failed')}};assert.doesNotThrow(()=>ctx.reportError_('hostile',hostile,false));
// Dispatcher denies inherited Object methods and malformed argument lists; normal results retain their contract.
assert.throws(()=>ctx.dispatch('toString',[]),/E-506/);assert.throws(()=>ctx.dispatch('cpPing',{}),/E-507/);assert.equal(ctx.dispatch('cpPing',[]).ok,true);
ctx.cpPing=()=>{throw Error('service failed '+secret)};assert.throws(()=>ctx.dispatch('cpPing',[]),e=>/E-601/.test(e.message)&&/Reference:/.test(e.message)&&!e.message.includes('PRIVATE_TOKEN'));
// Cleanup cannot mask primary errors; failed optional publishing cannot turn a saved action into a failed one.
publishError=Error('publisher unavailable');assert.equal(ctx.cpWithLock_(()=>42),42);assert.equal(flushed,1);assert.equal(released,1);const original=Error('primary write error');assert.throws(()=>ctx.cpWithLock_(()=>{throw original}),e=>e===original);
flushError=Error('flush failed');assert.throws(()=>ctx.cpWithLock_(()=>7),e=>e===flushError);flushError=null;
releaseError=Error('release failed');const publishedBefore=published;assert.throws(()=>ctx.cpWithLock_(()=>7),e=>e===releaseError);assert.equal(published,publishedBefore);releaseError=null;
held=true;const before=released;assert.equal(ctx.cpWithLock_(()=>19),19);assert.equal(released,before);held=false;publishError=null;
// New edits during rebuild survive completion of an older generation; failed jobs back off independently.
ctx.buildGroupSheets_=()=>{ctx.deferWork_('groups');return {skipped:[]}};ctx.buildAcademySheets_=()=>{throw Error('academy offline')};ctx.refreshDashboard_=()=>{};ctx.buildActivityPanel_=()=>{};
ctx.deferWork_('groups');const old=props['RE_DEFER_JOB:groups'];ctx.runDeferredWork_();assert(props['RE_DEFER_JOB:groups']&&props['RE_DEFER_JOB:groups']!==old);
ctx.buildGroupSheets_=()=>({skipped:[]});ctx.runDeferredWork_();assert(!props['RE_DEFER_JOB:groups']);ctx.deferWork_('academy');ctx.runDeferredWork_();let state=JSON.parse(props['RE_DEFER_JOB:academy']);assert.equal(state.attempts,1);assert(state.next>Date.now());ctx.runDeferredWork_();assert.equal(JSON.parse(props['RE_DEFER_JOB:academy']).attempts,1);
props.DEFERRED_WORK='|groups|';ctx.runDeferredWork_();assert(!props.DEFERRED_WORK);assert(!props['RE_DEFER_JOB:groups'],'legacy queue migrated and completed');
// Competing writers leave a pending generation and its retry counter untouched.
ctx.deferWork_('groups');const busyJob=props['RE_DEFER_JOB:groups'],busyLogs=logs.length;
const actualTryLock=lock.tryLock;lock.tryLock=()=>false;
ctx.runDeferredWork_();ctx.syncDerivedNow_();assert.equal(props['RE_DEFER_JOB:groups'],busyJob);assert.equal(logs.length,busyLogs);assert(!props.DERIVED_LAST_SYNC);
lock.tryLock=actualTryLock;
// Successful nested builders reuse the worker's lock and release it only once.
const workerReleases=released;ctx.buildGroupSheets_=()=>{assert(held);return {skipped:[]}};ctx.runDeferredWork_();assert.equal(released,workerReleases+1);assert(!props['RE_DEFER_JOB:groups']);
// The top-level failure contains the actionable sheet/cell reason itself.
ctx.deferWork_('groups');ctx.buildGroupSheets_=()=>({skipped:[{name:'Day Shift',why:'missing ID at D9'}]});ctx.runDeferredWork_();assert(logs.some(line=>/Day Shift: missing ID at D9/.test(line)));assert.equal(JSON.parse(props['RE_DEFER_JOB:groups']).attempts,1);
// Bad payloads never escape the never-throw webhook boundary. Respect a long Retry-After without retrying early.
let calls=0,sleeps=[];ctx.UrlFetchApp={fetch:()=>{calls++;return {getResponseCode:()=>429,getHeaders:()=>({'Retry-After':'10'}),getContentText:()=> '{}'}}};ctx.Utilities.sleep=ms=>sleeps.push(ms);
let payload={};payload.self=payload;assert.equal(ctx.postToWebhook_(secret,payload).ok,false);assert.equal(calls,0);let result=ctx.postToWebhook_(secret,{});assert.equal(result.code,429);assert.equal(calls,1);assert.equal(sleeps.length,0);
ctx.UrlFetchApp.fetch=()=>{calls++;return {getResponseCode:()=>calls===2?429:204,getHeaders:()=>({'Retry-After':'0.1'}),getContentText:()=> '{}'}};result=ctx.postToWebhook_(secret,{});assert(result.ok);assert.equal(sleeps[0],100);
ctx.UrlFetchApp.fetch=()=>{throw Error('network '+secret)};result=ctx.postToWebhook_(secret,{});assert(!result.ok);assert(!result.error.includes('PRIVATE_TOKEN'));

const actualPublish=ctx.publishPublicRoster_;
// Publish failures cannot be returned as successful Control Panel actions.
let triggerChecks=0;ctx.ensurePublicPublishingTriggers_=()=>{triggerChecks++;}; // platform verifier is exercised by startupcheck
ctx.publishPublicRoster=()=>({linked:true,failed:true,tabs:['Roster'],rows:1,skipped:['Welcome'],detail:['Welcome unavailable']});assert.throws(()=>ctx.cpRunActionCore_('publishRoster'),/Public publish stopped/);
assert.equal(triggerChecks,1,'panel force-publish repairs auto-update triggers before publishing');
// Logger storage outages fall back once per execution without hiding the action's error.
sheet.appendRow=()=>{throw Error('storage '+secret)};const logCount=logs.length;assert.doesNotThrow(()=>ctx.slog_('ERROR','E-601','logger outage','problem'));assert.doesNotThrow(()=>ctx.slog_('ERROR','E-601','logger outage again','problem'));assert(logs.length>logCount);assert(!logs.join(' ').includes('PRIVATE_TOKEN'));
// Signup source acknowledgement failure cannot duplicate a deterministic submission on manual retry.
const actualWriteValuesSafe=ctx.writeValuesSafe_;
class SignupSheet{
 constructor(rows,source){this.rows=rows;this.source=source;this.failMark=false;this.marked=false;}
 getLastRow(){let last=0;this.rows.forEach((r,i)=>{if(r.some(v=>v!==''))last=i+1});return last}getLastColumn(){return 4}getMaxRows(){return this.rows.length}
 getRange(r,c,n=1,w=1){const s=this;return{getValues:()=>s.rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w)),getDisplayValues:()=>s.rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w).map(String)),getBackgrounds:()=>Array.from({length:n},()=>Array(w).fill(s.marked?'done':'white')),setNumberFormat(){return this},setBackground(){if(s.failMark){s.failMark=false;throw Error('source marker failed')}s.marked=true;return this}}}
}
const submitted=new Date(1700000000000),form=new SignupSheet([['TIMESTAMP','NAME','ID',''],[submitted,'Applicant','1234567890123456789','']],true),review=new SignupSheet([['title','','',''],['KEY','NAME','ID','STATUS'],['','','',''],['','','','']],false);
Object.defineProperty(ctx,'CONFIG',{configurable:true,value:{bg:{done:'done'},notify:{signupSubmitted:false},sheets:{signupForm:'Form',signups:'Review'}}});ctx.signupCols_=s=>({headerRow:s.source?1:2,dataStart:s.source?2:3,name:2,discord:3,status:s.source?0:4,timestamp:s.source?1:0,width:4});ctx.signupHeaderPairs_=()=>[];ctx.framedTable_=()=>({cap:5});ctx.ensureRoomAboveCap_=()=>{};ctx.writeValuesSafe_=(s,r,c,rows)=>rows.forEach((row,i)=>row.forEach((v,j)=>s.rows[r+i-1][c+j-1]=v));ctx.sortSignups_=()=>{};
form.failMark=true;assert.throws(()=>ctx.syncSignupForm_(form,review),/E-504|Signup sync stopped/);assert.equal(review.rows[2][2],'1234567890123456789');assert.equal(ctx.syncSignupForm_(form,review),0);assert.equal(review.rows.filter(row=>row[1]==='Applicant').length,1);assert(form.marked);ctx.writeValuesSafe_=actualWriteValuesSafe;

// Destructive resets fail closed, and bad config cannot delete existing schedule triggers.
vm.runInContext(fs.readFileSync('RosterExtras.gs','utf8'),ctx);ctx.cfg_=()=>{throw Error('config unreadable')};assert.equal(ctx.resetDue_(),false);let deletions=0;ctx.ScriptApp={getProjectTriggers:()=>[{getHandlerFunction:()=> 'weeklyResetScheduled'}],deleteTrigger:()=>deletions++};assert.throws(()=>ctx.installExtrasTriggers_(),/config unreadable/);assert.equal(deletions,0);assert.throws(()=>actualPublish(),/config unreadable/);
ctx.cfg_=()=>({kv:{ACTIVITY:{AUTO_RESET:true,WEEKLY_HOURS_RESET:'SUN',RESET_CADENCE:'BIWEEKLY'}}});props.RE_RUNTIME_MODE='BOUND';ctx.PropertiesService.getScriptProperties=()=>({getProperty:()=> 'corrupt'});assert.equal(ctx.resetDue_(),false);
props.RE_RUNTIME_MODE='LIBRARY';assert.equal(ctx.lastResetMarker_(),null,'library never inherits shared legacy clock');delete props.RE_RUNTIME_MODE;assert.equal(ctx.lastResetMarker_(),null,'unknown deployment never inherits shared legacy clock');props.RE_RUNTIME_MODE='BOUND';ctx.PropertiesService.getScriptProperties=()=>({getProperty:()=> '123'});assert.equal(ctx.lastResetMarker_(),'123');assert.equal(props.RE_LAST_HOURS_RESET_MS,'123');
// A quota failure should make one bulk-write attempt, not thousands of cell calls.
let writeCalls=0;const quotaSheet={getRange:()=>({getMergedRanges:()=>[],setValues(){writeCalls++;throw Error('Service invoked too many times')},setValue(){writeCalls++}})};assert.throws(()=>ctx.writeValuesSafe_(quotaSheet,1,1,Array.from({length:100},()=>Array(20).fill('value')),null),/too many times/);assert.equal(writeCalls,1);
vm.runInContext(fs.readFileSync('RosterTrust.gs','utf8'),ctx);assert.throws(()=>ctx.cpApplyRestore_({getRange(){throw Error('unexpected write')}},[['snapshot','time',3,'member','id','Active',1,'Cadet','not-json']]),/Snapshot extra fields are malformed/);
// Missing menu/install and patrol boundaries: invalid config cannot delete triggers; post-import failure is partial.
ctx.runAction_=(label,fn)=>fn();ctx.cfg_=()=>{throw Error('invalid setup config')};
assert.throws(()=>ctx.installTriggers(),/invalid setup config/);assert.equal(deletions,0);
Object.defineProperty(ctx,'CONFIG',{configurable:true,value:{sheets:{patrol:'Form',patrolLog:'Log',roster:'Roster'},patrol:{mode:'START_END'}}});
ctx.SpreadsheetApp.getActive=()=>({getSheetByName:()=>({})});ctx.syncPatrolFormToLog_=()=>({added:3});ctx.refreshPatrolLog_=()=>{throw Error('sort failed')};
assert.throws(()=>ctx.syncPatrolFormNow_(),/3 completed item|Submissions were transferred/);
ctx.LockService.getDocumentLock=()=>lock;
const actualProps=ctx.PropertiesService.getDocumentProperties;ctx.PropertiesService.getDocumentProperties=()=>{throw Error('property storage offline')};
assert.throws(()=>ctx.publishPassClaim_(),/property storage offline/);assert.equal(held,false);ctx.PropertiesService.getDocumentProperties=actualProps;
ctx.buildMenus_=()=>{throw Error('menu unavailable')};assert.doesNotThrow(()=>ctx.onOpen());
const importFailure=Error('leave import failed');ctx.getSheetOrWarn_=()=>({});ctx.syncFormToTracker_=()=>{throw importFailure};releaseError=Error('release also failed');
assert.throws(()=>ctx.syncFormToTracker(),e=>e===importFailure);releaseError=null;ctx.getSheetOrWarn_=()=>null;
assert.throws(()=>ctx.syncFormToTracker(),/sheet is missing/);
// Client transport throws, callback errors and duplicate completion do not strand the operation or replay it.
for(const file of ['ControlPanel.html','SettingsPanel.html']){
 const html=fs.readFileSync(file,'utf8'),a=html.indexOf('  function api(success,'),b=html.indexOf('\n  function ',a+10);let handlers={},errors=[],completed=0;
 const client={Error,onError:e=>errors.push(e.message),google:{script:{run:{withSuccessHandler(fn){handlers.success=fn;return this},withFailureHandler(fn){handlers.failure=fn;return this},dispatch(){}}}}};vm.createContext(client);vm.runInContext(html.slice(a,b),client);
 client.api(()=>{completed++;throw Error('render error')},null,'save');handlers.success({});handlers.success({});assert.equal(completed,1);assert(errors[0].includes('server completed'));assert(errors[0].includes('before repeating'));
 client.google.script.run.dispatch=()=>{throw Error('transport unavailable')};client.api(()=>{},null,'read');assert.equal(errors[1],'transport unavailable');
}
console.log('Error boundaries: fail-closed resets, partial signup recovery, public publish failures, bulk quota limits, redaction, circular contexts, log deduplication, dispatcher validation, cleanup precedence, nested locks, queue generations/backoff, webhook failure budgets and both panel callbacks passed');
