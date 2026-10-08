// Menu wiring and interactive workflow fault injection. No Google or network access.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const files=['RosterConfig.gs','RosterSystem.gs','RosterExtras.gs','RosterControlPanel.gs','RosterTrust.gs','RosterDevQA.gs','RosterQA.gs'];
const deny=()=>{throw Error('Unexpected live service access')};
function runtime(){
 const data={},menus=[],alerts=[],props={getProperty:k=>data[k]??null,setProperty(k,v){data[k]=String(v)},deleteProperty(k){delete data[k]},getProperties:()=>({...data})};
 let held=false,busy=false,releases=0;
 const lock={hasLock:()=>held,tryLock(){if(busy)return false;held=true;return true},releaseLock(){assert(held);held=false;releases++}};
 const ui={Button:{OK:'OK',CANCEL:'CANCEL',YES:'YES',NO:'NO'},ButtonSet:{OK:'OK',OK_CANCEL:'OK_CANCEL',YES_NO:'YES_NO'},
  prompt:()=>({getSelectedButton:()=> 'CANCEL',getResponseText:()=> ''}),alert(...args){assert(!held,'modal UI must run after releasing the writer lock');alerts.push(args);return 'YES'},
  createMenu(title){return {title,items:[],addItem(label,handler){this.items.push({label,handler});return this},addSubMenu(child){this.items.push(child);return this},addToUi(){menus.push(this);return this}}}};
 const ctx={console:{log(){},error(){},warn(){}},Date,Math,JSON,
  SpreadsheetApp:{getUi:()=>ui,getActive:deny,create:deny,flush(){},CopyPasteType:{PASTE_FORMAT:'format',PASTE_DATA_VALIDATION:'validation',PASTE_CONDITIONAL_FORMATTING:'conditional'}},
  LockService:{getScriptLock:()=>lock},PropertiesService:{getDocumentProperties:()=>props,getScriptProperties:()=>props},
  UrlFetchApp:{fetch:deny},FormApp:{create:deny},ScriptApp:{newTrigger:deny},Utilities:{getUuid:()=> 'qa-menu'},
  CacheService:{getDocumentCache:()=>({get:()=>null,put(){},remove(){}})}};
 vm.createContext(ctx);for(const file of files)vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
 ctx.log_=ctx.logWarn_=ctx.logInfo_=ctx.reportError_=()=>{};ctx.runAction_=(label,fn)=>fn();
 return {ctx,menus,alerts,ui,lock,data,get held(){return held},get releases(){return releases},set busy(v){busy=v}};
}
const callbacks=menu=>menu.items.flatMap(item=>item.handler?[item.handler]:callbacks(item));
const expected=['openControlPanel','openSettingsPanel','refreshDashboard','manualSyncLOA','manualSyncSignups','openSignupsDialog','manualSyncPatrol','weeklyResetWithHistory','scanIntegrity','recoverMemberMove','publishPublicRosterNow','addMemberRow','updateUnitNumbers','buildGroupSheets','buildAcademySheets','buildActivityPanel','setupPublicRoster','idTypeDiscord','idTypeCommunity','syncColumnConfig','setupWizard','restyleConfigSheet','installTriggers'];
for(const prefix of ['', 'RE.']){
 const r=runtime();r.ctx.buildMenus_(prefix);
 assert.equal(r.menus[0].items.length,8);assert.equal(r.menus[1].items.length,3);
 assert.deepEqual(callbacks(r.menus[0]).sort(),expected.map(n=>prefix+n).sort());
 for(const menu of r.menus){const names=callbacks(menu);assert.equal(new Set(names).size,names.length);for(const n of names)assert.equal(typeof r.ctx[n.slice(prefix.length)],'function',n+' must be callable');}
}
const optional=runtime();
for(const name of ['openControlPanel','openSettingsPanel','openSignupsDialog','manualSyncSignups','publishPublicRosterNow','setupPublicRoster','weeklyResetWithHistory','scanIntegrity','buildGroupSheets','buildAcademySheets','buildActivityPanel','restyleConfigSheet','seedDemoRoster','qaRunAll','qaRunCore','qaRunPlatform'])optional.ctx[name]=undefined;
optional.ctx.buildMenus_('');
assert(!optional.menus[0].items.some(m=>m.title==='🌐 Public roster'));
for(const menu of optional.menus)for(const n of callbacks(menu))assert.equal(typeof optional.ctx[n],'function');
// The bound library shim must cover every literal trigger target and preserve catch-up ownership events.
const shim=fs.readFileSync('TEMPLATE-SHIM.gs','utf8'),names=[...new Set(files.flatMap(file=>[...fs.readFileSync(file,'utf8').matchAll(/ScriptApp\.newTrigger\('([^']+)'\)/g)].map(m=>m[1])))];
const forwarded=[];const shimCtx={RE:new Proxy({}, {get:(_,name)=>(...args)=>{forwarded.push({name,args});return name}})};vm.createContext(shimCtx);vm.runInContext(shim,shimCtx);
for(const name of names){assert.equal(typeof shimCtx[name],'function','missing shim trigger '+name);const e={triggerUid:'current'};shimCtx[name](e);assert.equal(forwarded.at(-1).name,name);if(['onFormSubmit','memberTransferEdited','auditEdit','publishOnChange','publishCatchup'].includes(name))assert.strictEqual(forwarded.at(-1).args[0],e);}
assert.equal(shimCtx.publishPublicRoster(),'publishPublicRoster');
const counts=runtime();for(const bad of ['',null,'0','101','-1','3cats','1.5','2e1','Infinity','+2'])assert.strictEqual(counts.ctx.memberRowCount_(bad),null);
for(const n of [1,2,99,100])assert.equal(counts.ctx.memberRowCount_(' '+n+' '),n);
// All-stage refresh: form intakes, credits/statuses, derived views, flush and final publish are ordered.
function refreshFixture(){
 const r=runtime(),c=r.ctx,events=[],tabs={Roster:{},Tracker:{},LeaveForm:{},SignupForm:{},Signups:{},PatrolForm:{},Patrol:{}};
 const actual={syncPatrolHours:c.syncPatrolHours,syncPatrolFormNow_:c.syncPatrolFormNow_};
 Object.defineProperty(c,'CONFIG',{value:{sheets:{roster:'Roster',tracker:'Tracker',form:'LeaveForm',signupForm:'SignupForm',signups:'Signups',patrol:'PatrolForm',patrolLog:'Patrol'},patrol:{mode:'START_END'},trackerStartRow:8},configurable:true});
 c.trackerCols_=()=>({status:9,labelRow:6});
 c.SpreadsheetApp.getActive=()=>({getSheetByName:n=>tabs[n]});
 c.syncFormToTracker_=()=>{assert(r.held);events.push('leave');return []};c.syncSignupForm_=()=>{assert(r.held);events.push('signup');return 2};
 c.syncPatrolFormNow_=()=>{assert(r.held);events.push('patrolForms');return {mode:'log',res:{added:3,skipped:[]}}};
 c.refreshPatrolLog_=()=>events.push('credits');c.todayInSheetTz_=()=>new Date();c.processDailyLOAs_=()=>({started:[],expired:[]});c.sortTracker_=()=>events.push('trackerSort');
 c.recomputeStatuses_=()=>{events.push('statuses');return {changed:[],total:3}};c.fillTimeInRank_=()=>3;c.sortSignups_=()=>events.push('signupSort');
 for(const [fn,name] of [['refreshDashboard_','dashboard'],['renderPromotions_','promotions'],['buildGroupSheets_','groups'],['buildAcademySheets_','academy'],['buildActivityPanel_','activity']])c[fn]=()=>{assert(r.held);events.push(name);return {skipped:[]}};
 c.scanIntegrityCore_=()=>[];c.SpreadsheetApp.flush=()=>events.push('flush');
 c.publishPublicRoster=()=>{assert(!r.held);events.push('publish');return {linked:true,rows:3,tabs:['Roster']}};
 return Object.assign(r,{events,tabs,actual});
}
const normal=refreshFixture();normal.ctx.refreshDashboard();assert(normal.alerts.at(-1)[0].includes('complete'));
for(const before of ['leave','signup','patrolForms','credits','statuses','dashboard','promotions','groups','academy','activity','flush'])assert(normal.events.indexOf(before)<normal.events.indexOf('publish'),before+' must precede publishing');
assert(normal.events.indexOf('credits')<normal.events.indexOf('statuses'));assert.equal(normal.releases,1);
for(const target of ['syncFormToTracker_','syncSignupForm_','syncPatrolFormNow_','refreshPatrolLog_','processDailyLOAs_','sortTracker_','recomputeStatuses_','fillTimeInRank_','sortSignups_','refreshDashboard_','renderPromotions_','buildGroupSheets_','buildAcademySheets_','buildActivityPanel_','scanIntegrityCore_','publishPublicRoster']){
 const r=refreshFixture();r.ctx[target]=()=>{throw Error('injected failure')};r.ctx.refreshDashboard();assert(r.alerts.at(-1)[0].includes('issue'),target+' must not yield a success headline');assert(!r.held);assert(r.alerts.at(-1)[1].includes('injected failure'));
}
for(const publish of [false,{linked:true,failed:true,detail:['Welcome failed']},{linked:true,aborted:true,detail:[] }]){const r=refreshFixture();r.ctx.publishPublicRoster=()=>publish;r.ctx.refreshDashboard();assert(r.alerts.at(-1)[0].includes('issue'));}
const skipped=refreshFixture();skipped.ctx.buildGroupSheets_=()=>({skipped:[{name:'Day Shift',why:'missing ID at D8'}]});skipped.ctx.refreshDashboard();assert(skipped.alerts.at(-1)[1].includes('Day Shift: missing ID at D8'));
for(const cols of [{status:0,labelRow:6},{status:9,labelRow:8}]){const r=refreshFixture();r.ctx.trackerCols_=()=>cols;r.ctx.refreshDashboard();assert(r.alerts.at(-1)[0].includes('issue'));assert(!r.events.includes('trackerSort'));}
const noTabs=refreshFixture();for(const name of ['LeaveForm','Tracker','SignupForm','PatrolForm'])delete noTabs.tabs[name];noTabs.ctx.syncPatrolFormNow_=()=>({missing:true});noTabs.ctx.refreshDashboard();assert(noTabs.alerts.at(-1)[0].includes('issue'));assert(noTabs.alerts.at(-1)[1].includes('skipped'));
const busy=refreshFixture();busy.busy=true;busy.ctx.refreshDashboard();assert.equal(busy.events.length,0);assert.equal(busy.releases,0);assert(busy.alerts[0][0].includes('did not start'));
const flushFailed=refreshFixture();flushFailed.ctx.SpreadsheetApp.flush=()=>{throw Error('flush failed')};flushFailed.ctx.refreshDashboard();assert(!flushFailed.events.includes('publish'));assert(flushFailed.alerts.at(-1)[0].includes('issue'));assert(!flushFailed.held);
// Patrol entry points reuse an outer writer lock without releasing it.
for(const fn of ['syncPatrolHours','syncPatrolFormNow_']){
 const r=refreshFixture();r.ctx.syncPatrolHours_=()=>({credited:[]});r.ctx.syncPatrolFormToLog_=()=>({added:0});
 r.lock.tryLock();r.actual[fn]();assert(r.held);assert.equal(r.releases,0);r.lock.releaseLock();
}
const signup=refreshFixture();signup.ctx.cpWithLock_=fn=>signup.ctx.withPatrolCreditLock_(fn);signup.ctx.manualSyncSignups();assert(!signup.held);assert(signup.events.includes('signupSort'));
// Cleanup targets only reviewed IDs, recognizes old/current reports, and waits for QA's lock.
function cleanupFixture(){
 const r=runtime(),sheets=['Roster','🧪SANDBOX_old','🧪 QA Results','🧪 QA Results 2','🧪 Test Results','🧪 QA Results notes','🧪SANDBOX_'].map((name,id)=>({getName:()=>name,getSheetId:()=>id}));
 const removed=[];r.ctx.SpreadsheetApp.getActive=()=>({getSheets:()=>sheets,getSheetByName:name=>sheets.find(s=>s.getName()===name),deleteSheet(sh){assert(r.held);removed.push(sh.getName());sheets.splice(sheets.indexOf(sh),1)}});
 return Object.assign(r,{sheets,removed});
}
const cleanup=cleanupFixture();cleanup.ctx.devCleanup();assert.equal(cleanup.removed.length,4);assert(cleanup.sheets.some(s=>s.getName()==='Roster'));assert(cleanup.sheets.some(s=>s.getName()==='🧪 QA Results notes'));
const cancel=cleanupFixture();cancel.ui.alert=()=> 'NO';cancel.ctx.devCleanup();assert.equal(cancel.removed.length,0);
const cleanupBusy=cleanupFixture();cleanupBusy.busy=true;assert.throws(()=>cleanupBusy.ctx.devCleanup(),/E-503|running/);assert.equal(cleanupBusy.removed.length,0);
const failedCleanup=cleanupFixture(),originalBook=failedCleanup.ctx.SpreadsheetApp.getActive();let deletes=0;failedCleanup.ctx.SpreadsheetApp.getActive=()=>({...originalBook,deleteSheet(sh){if(++deletes===2)throw Error('delete unavailable');originalBook.deleteSheet(sh)}});assert.throws(()=>failedCleanup.ctx.devCleanup(),/Removed 1 QA tab.*could not delete/);assert(!failedCleanup.held);assert(failedCleanup.sheets.some(s=>s.getName()==='Roster'));
const allQa=cleanupFixture();allQa.sheets.splice(0,allQa.sheets.length,{getName:()=> '🧪 QA Results',getSheetId:()=>1});assert.throws(()=>allQa.ctx.devCleanup(),/at least one/);assert.equal(allQa.removed.length,0);
// Demo confirmation always happens before writes; lock and notification suppression survive exceptions.
for(const answer of ['', 'LOAD', 'LOAD DEMO']){
 const r=runtime();let writes=0;r.ui.prompt=()=>({getSelectedButton:()=> 'OK',getResponseText:()=>answer});r.ctx.seedDemoRosterCore_=()=>{assert(r.held);assert(vm.runInContext('DEV_WEBHOOKS_OFF_',r.ctx));writes++;return 'Demo summary'};r.ctx.publishMarkDirty_=()=>{};
 r.ctx.seedDemoRoster();assert.equal(writes,answer==='LOAD DEMO'?1:0);assert(!r.held);assert.equal(vm.runInContext('DEV_WEBHOOKS_OFF_',r.ctx),false);
 if(writes)assert.equal(r.alerts.at(-1)[1],'Demo summary');
}
const demoError=runtime();demoError.ui.prompt=()=>({getSelectedButton:()=> 'OK',getResponseText:()=> 'LOAD DEMO'});demoError.ctx.seedDemoRosterCore_=()=>{throw Error('demo failed')};assert.throws(()=>demoError.ctx.seedDemoRoster(),/demo failed/);assert(!demoError.held);assert.equal(vm.runInContext('DEV_WEBHOOKS_OFF_',demoError.ctx),false);
const startup=runtime();startup.ctx.setupWizardCore_=()=>{assert(startup.held);return 'Startup summary'};startup.ctx.setupWizard();assert.equal(startup.alerts.at(-1)[1],'Startup summary');assert(!startup.held);
for(const outcome of [false,{linked:true,failed:true,tabs:[],rows:0},{linked:true,tabs:['Roster'],rows:2}]){
 const r=runtime(),file={getId:()=> 'public',getName:()=> 'Public',getUrl:()=> 'https://example.test/public'};let dirty=0;
 r.ui.prompt=()=>({getSelectedButton:()=> 'OK',getResponseText:()=> 'p'.repeat(30)});r.ctx.SpreadsheetApp.openById=()=>file;r.ctx.SpreadsheetApp.getActive=()=>({getId:()=> 'internal'});
 r.ctx.publishMarkDirty_=()=>dirty++;r.ctx.ensurePublicPublishingTriggers_=()=>{};r.ctx.publishPublicRoster=()=>outcome;
 r.ctx.setupPublicRoster();assert.equal(dirty,1,'link changes queue a full publish even when first publish is busy');const message=r.alerts.at(-1)[1];
 assert(message.includes(outcome===false?'busy':outcome.failed?'incomplete':'completed: 2'));
}
// Exercise actual demo builders and multi-row insertion against bounded, framed sheet doubles.
function tab(name,rows=11,width=30){
 const sh={name,rows,width,grid:Array.from({length:rows},()=>Array(width).fill('')),events:[],band:null,
  getName:()=>name,getLastRow:()=>sh.rows,getMaxRows:()=>sh.rows,getLastColumn:()=>width,getRowHeight:()=>27,getActiveCell:()=>({getRow:()=>8}),
  insertRowsAfter(row,count){sh.grid.splice(row,0,...Array.from({length:count},()=>Array(width).fill('')));sh.rows+=count;sh.events.push(['insertAfter',row,count]);},
  insertRowsBefore(row,count){sh.grid.splice(row-1,0,...Array.from({length:count},()=>Array(width).fill('')));sh.rows+=count;sh.events.push(['insertBefore',row,count]);},
  setRowHeights(...args){sh.events.push(['height',...args]);},hideSheet(){},
  getRange(row,col,n=1,w=1){assert(row>0&&col>0&&row+n-1<=sh.rows&&col+w-1<=width,'out of bounds '+name);let proxy;const range={
   getDisplayValues:()=>sh.grid.slice(row-1,row-1+n).map(r=>r.slice(col-1,col-1+w).map(String)),
   getDisplayValue:()=>String(sh.grid[row-1][col-1]),getMergedRanges:()=>sh.band?[sh.band]:[],
   setValue(value){for(let i=0;i<n;i++)sh.grid[row+i-1][col-1]=value;return proxy},
   setValues(values){assert.equal(values.length,n);values.forEach((r,i)=>{assert.equal(r.length,w);for(let j=0;j<w;j++)sh.grid[row+i-1][col+j-1]=r[j]});return proxy},
   clearContent(){for(let i=0;i<n;i++)for(let j=0;j<w;j++)sh.grid[row+i-1][col+j-1]='';sh.events.push(['clear',row,col,n,w]);return proxy},
   copyTo(dst,type){sh.events.push(['copy',dst.row,dst.col,dst.w,type]);return range},
   breakApart(){sh.events.push(['unmerge',row,col,n,w]);return range},merge(){sh.events.push(['merge',row,col,n,w]);return range},row,col,w};
   proxy=new Proxy(range,{get:(o,k)=>k in o?o[k]:()=>proxy});return proxy;
  },clear(){sh.grid.forEach(r=>r.fill(''));}};
 sh.grid[10]&&(sh.grid[10][0]='BOTTOM');return sh;
}
const seeded=runtime(),c=seeded.ctx,roster=tab('Roster',8),tracker=tab('Tracker'),patrol=tab('Patrol'),signups=tab('Signups'),history=tab('History',3,6);
roster.grid[7][1]='Cadet';roster.grid[7][3]='S-01';
const book={getSheetByName:n=>({Roster:roster,Tracker:tracker,Patrol:patrol,Signups:signups,History:history}[n])};
c.SpreadsheetApp.getActive=()=>book;
Object.defineProperty(c,'CONFIG',{value:{sheets:{roster:'Roster',tracker:'Tracker',patrolLog:'Patrol',signups:'Signups',hoursHistory:'History'},rosterStartRow:8,trackerStartRow:8,patrolStartRow:8,patrol:{processedStatus:'Processed'}},configurable:true});
c.getSheetOrWarn_=(ss,n)=>ss.getSheetByName(n);c.rosterCols_=()=>({rank:2,name:3,unit:4,discord:5,join:6,promo:7,hours:8,activity:9,shift:10});c.lastActivityCol_=()=>-1;
const day=new Date(2026,9,8);c.demoIsOpen_=()=>false;c.demoPerson_=()=>({name:'QA Person',id:'111',join:day,promo:day,hours:20,act:'Active',checks:[],leave:{type:'LOA',from:-1,to:1},pastLeaves:Array.from({length:3},()=>({type:'LOA',from:-10,to:-5}))});
c.demoSunday_=()=>day;c.demoDay_=()=>day;c.todayInSheetTz_=()=>day;
c.framedTable_=sh=>({cap:sh.rows,width:sh.width});c.ensureRoomAboveCap_=(sh,row)=>{if(row>=sh.rows)sh.insertRowsBefore(sh.rows,row-sh.rows+1)};
c.demoWriteLeave_=(sh,m,L,row)=>sh.getRange(row,3).setValue(m.name);
c.patrolLogCols_=()=>({width:30,labelRow:6,mark:1,rank:2,unit:3,ooc:4,name:5,discord:6,shift:7,startDate:8,endDate:9,startTime:10,endTime:11,total:12,status:13});
c.signupCols_=()=>({width:30,dataStart:8,status:7,name:2,discord:3,timestamp:4,email:5,dob:6});
c.seedDemoStats_=()=>false;c.seedDemoPromotions_=()=>0;c.styleStartupSupportSheet_=c.sortSupportRows_=c.ensureSupportFilter_=c.refreshDashboard_=c.cpInvalidateHealth_=()=>{};
c.sortTracker_=c.sortPatrolLog_=c.sortSignups_=()=>{};
const summary=c.seedDemoRosterCore_();assert.equal(typeof summary,'string','actual demo must return its summary, not undefined');
for(const sh of [tracker,patrol,signups]){
 assert(sh.events.some(e=>e[0]==='insertBefore'),'demo must grow above the bottom border: '+sh.name);
 assert.equal(sh.grid.at(-1)[0],'BOTTOM');assert(sh.events.filter(e=>e[0]==='clear').every(e=>e[1]+e[3]-1<=10),'demo wipe excludes the border: '+sh.name);
}
// Multi-row copying covers each row while preserving the merged RANK GROUP label.
for(const band of [false,true]){
 const r=runtime(),sh=tab('Roster',10);sh.grid[7][1]='RANK GROUP';sh.grid[7][2]='Trooper';
 if(band)sh.band={getNumRows:()=>3,getRow:()=>8,getLastRow:()=>10,getColumn:()=>2,getNumColumns:()=>1};
 Object.defineProperty(r.ctx,'CONFIG',{value:{sheets:{roster:'Roster'},rosterStartRow:8},configurable:true});
 r.ctx.SpreadsheetApp.getActive=()=>({getActiveSheet:()=>sh});r.ui.prompt=()=>({getSelectedButton:()=> 'OK',getResponseText:()=> '3'});
 r.ctx.rosterCols_=()=>({rank:3});r.ctx.isDividerValue_=()=>false;r.ctx.updateUnitNumbers_=r.ctx.fillTimeInRank_=()=>{};r.ctx.publishAfterWrite_=()=>{};
 const queued=[];r.ctx.deferWork_=name=>queued.push(name);
 r.ctx.addMemberRow();
 const copies=sh.events.filter(e=>e[0]==='copy');for(const row of [9,10,11])for(const type of ['format','validation','conditional'])assert(copies.some(e=>e[1]===row&&e[4]===type),'each new row gets '+type);
 if(band){assert.equal(sh.grid[7][1],'RANK GROUP');assert(sh.events.filter(e=>e[0]==='clear').every(e=>e[2]>2||e[2]+e[4]-1<2),'new-row clearing never reaches the band label');assert(sh.events.some(e=>e[0]==='merge'&&e[3]===6));}
 assert(!r.held);
 assert.deepEqual(queued,['groups','academy','dashboard']);
}
console.log('Menu audit: all 23 Roster callbacks + 6 QA callbacks, bound/library prefixes, optional modules, shim trigger events, strict row input, all-stage refresh ordering/faults, nested patrol locks, serialized signup sorting, cleanup protection, demo confirmation/suppression and startup UI passed.');
