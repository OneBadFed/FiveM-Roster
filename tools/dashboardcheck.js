// Execute the real rank/settings/statistics/render/queue code without touching Google data.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const system=fs.readFileSync('RosterSystem.gs','utf8'),panel=fs.readFileSync('RosterControlPanel.gs','utf8'),config=fs.readFileSync('RosterConfig.gs','utf8'),html=fs.readFileSync('SettingsPanel.html','utf8').replace(/\r\n/g,'\n');
function section(src,start,end){const a=src.indexOf(start),b=src.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return src.slice(a,b);}
function load(ctx,src,start,end){vm.runInContext(section(src,start,end),ctx);}
const ctx={Date,Math,console};vm.createContext(ctx);vm.runInContext(config,ctx);
const table=rows=>({kind:'table',rows});
function validate(raw){return ctx.validateConfig_(raw);}
const errors=raw=>validate(raw).problems.filter(p=>p.sev==='ERROR');
assert.equal(errors({RANKS:table([]),SECTION_TAGS:table([]),DASHBOARD_GROUPS:table([]),STATUSES:table([]),LEAVE:{kind:'kv',kv:{LEAVE_TYPES:'',RETURN_STATUS:''}}}).length,0);
for(const raw of [
 {RANKS:table([['Officer','RANK'],[' officer ','DIVIDER']])},
 {RANKS:table([['','RANK']])},
 {DASHBOARD_GROUPS:table([['Division 1','Officer'],['Division-1','Cadet']])},
 {DASHBOARD_GROUPS:table([['!!!','Officer']])},
 {SECTION_TAGS:table([['Patrol','','']])},
 {SECTION_TAGS:table([['Patrol','PATROL',''],['patrol','FIELD','']])}
])assert(errors(raw).length,'ambiguous/incomplete configuration must fail');
assert.equal(errors({DASHBOARD_GROUPS:table([['Division 1','Officer'],['Division 2','Cadet'],['Active','Officer'],['constructor','Cadet']])}).length,0);
const raw={ROSTER_LAYOUT:{kind:'kv',kv:{DIVIDER_MODE:'EXPLICIT_LIST'}},RANKS:table([['PATROL','DIVIDER'],['Officer','RANK'],['CADET','TRAINING'],['Reserve','RANK']]),SECTION_TAGS:table([['Patrol','PATROL','blue']]),DASHBOARD_GROUPS:table([['Section','Patrol'],['Division 1','Officer'],['Division 2','CADET'],['Active','Reserve'],['constructor','Reserve']]),STATUSES:table([['Ready','TIER','5',''],['Limited','TIER','2',''],['Inactive','TIER','0',''],['Medical','LEAVE','','']]),LEAVE:{kind:'kv',kv:{LEAVE_TYPES:'Medical',RETURN_STATUS:''}}};
const v=validate(raw);assert.equal(v.problems.filter(p=>p.sev==='ERROR').length,0,JSON.stringify(v.problems));ctx.CONFIG=ctx.materialize_(v.config,false).legacy;
ctx.ROSTER_HEADER_ROW=1;ctx.LEADER_MAX_=5;ctx.LEADER_TITLE_='PATROL LEADERBOARD';ctx.tabKey_=s=>String(s).replace(/^👋\s*/,'').toLowerCase();
ctx.rosterCols_=()=>({headerRow:3,rank:2,name:4,hours:1,activity:3});
load(ctx,system,'function isDividerValue_(','/**\n * Move a member');
load(ctx,system,'function parseHours_(','function isProtectedStatus_');
load(ctx,system,'function dashboardStats_(','/** True for tabs');
load(ctx,system,'function renderDashboardOnSheet_(','const LEADER_TITLE_');
load(ctx,system,'function renderLeaderboardOnSheet_(','/* ======================================================================\n * RECENT-PROMOTIONS');
class Sheet{
 constructor(name,rows=30,cols=16){this.name=name;this.values=Array.from({length:rows},()=>Array(cols).fill(''));this.notes=this.values.map(r=>r.map(()=>''));this.formulas=this.values.map(r=>r.map(()=>''));this.merges=[];this.writes=0;this.styles={font:'department font',borders:'gold',heights:[24,36],widths:[85,120],conditional:'custom',validation:'custom'};}
 getName(){return this.name;}getLastRow(){return this.values.length;}getLastColumn(){return this.values[0].length;}getMaxRows(){return this.values.length;}
 set(r,c,v){this.values[r-1][c-1]=v;return this;}
 merge(r,c,n,w){this.merges.push({r,c,n,w});return this;}
 getRange(r,c,n=1,w=1){
  const sh=this,read=key=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>sh[key][r+i-1][c+j-1]));
  return {getValues:()=>read('values'),getDisplayValues:()=>read('values').map(row=>row.map(String)),getNotes:()=>read('notes'),getDisplayValue:()=>String(sh.values[r-1][c-1]),getValue:()=>sh.values[r-1][c-1],getNote:()=>sh.notes[r-1][c-1],getFormula:()=>sh.formulas[r-1][c-1],
   getMergedRanges:()=>sh.merges.filter(m=>r>=m.r&&r<m.r+m.n&&c>=m.c&&c<m.c+m.w).map(m=>({getRow:()=>m.r,getColumn:()=>m.c,getLastRow:()=>m.r+m.n-1,getLastColumn:()=>m.c+m.w-1})),
   setValue(v){sh.set(r,c,v);sh.writes++;return this;},setNote(v){sh.notes[r-1][c-1]=v;sh.writes++;return this;},clearNote(){return this.setNote('');},
   setValues(data){data.forEach((row,i)=>row.forEach((val,j)=>{assert(!(typeof val==='string'&&val.startsWith('=')),'names must never enter formula-parsing setValues');sh.set(r+i,c+j,val);}));sh.writes++;return this;},
   setRichTextValues(data){data.forEach((row,i)=>row.forEach((val,j)=>sh.set(r+i,c+j,val.text)));sh.writes++;return this;}
  };
 }
}
const roster=new Sheet('Member Information',11,4);
roster.set(2,2,'Officer').set(2,4,'Header area is not a member');
[['','PATROL','',''],['5h 30m','Officer','Ready','Alex'],['Infinity','CADET','Medical','Blair'],['-9h 30m','Reserve','Limited','Casey'],['4','Officer','Inactive','=literal'],['','Officer','','   '],['','Reserve','',''],['99','','Ready','Stray name']].forEach((row,i)=>roster.values[i+3]=row);
let stats=ctx.dashboardStats_(roster);
assert.equal(stats.total,4);assert.equal(stats.openSlots,2);assert.equal(stats.totalHours,9.5);assert.equal(stats.leaves,1);assert.equal(stats.active,1);assert.equal(stats.semi,1);assert.equal(stats.inactive,1);
assert.equal(stats.groups.Section,0,'rank mapping outranks section mapping');assert.equal(stats.groups['Division 1'],2);assert.equal(stats.groups['Division 2'],1);assert.equal(stats.groups.Active,1);assert.equal(stats.groups.constructor,0,'first group match only, including prototype-like names');
assert.equal(ctx.statTagValue_(stats,'group:division1'),2);assert.equal(ctx.statTagValue_(stats,'group:division2'),1);assert.equal(ctx.statTagValue_(stats,'group:missing'),0);assert.equal(ctx.statTagValue_(stats,'group:active'),1);assert.equal(ctx.statTagValue_(stats,'ready'),1);assert.equal(ctx.statTagValue_(stats,'constructor'),0);
const configured=ctx.CONFIG;ctx.CONFIG={...configured,tiers:[],tierNames:[],leaveTypes:[],dashboard:{groups:{}}};const empty=ctx.dashboardStats_(roster);assert.equal(empty.active,0);assert.equal(empty.leaves,0);assert.equal(empty.total,4);ctx.CONFIG=configured;
const numericConfig=ctx.materialize_(validate({...raw,DASHBOARD_GROUPS:table([['10','Officer'],['2','Officer']])}).config,false).legacy;
assert.deepEqual(Array.from(numericConfig.dashboard.order),['10','2']);ctx.CONFIG=numericConfig;assert.equal(ctx.dashboardStats_(roster).groups['10'],2,'numeric group names keep explicit table priority');assert.equal(ctx.dashboardStats_(roster).groups['2'],0);
ctx.CONFIG=ctx.materialize_(validate({...raw,DASHBOARD_GROUPS:table([['2','Officer'],['10','Officer']])}).config,false).legacy;assert.equal(ctx.dashboardStats_(roster).groups['2'],2,'moving numeric groups changes the counted owner');ctx.CONFIG=configured;
let dirty=[];ctx.publishMarkDirty_=names=>dirty.push(names);ctx.logWarn_=()=>{throw Error('valid duplicate tags must not warn');};ctx.log_=()=>{};
ctx.SpreadsheetApp={newRichTextValue:()=>({setText(text){this.text=text;return this;},build(){return {text:this.text};}})};
function welcome(){const sh=new Sheet('Welcome Page');sh.set(2,2,'TOTAL EMPLOYEES').merge(2,2,1,4);
 ['Division 1','Division 2','Active','TOTAL'].forEach((label,i)=>sh.set(i+3,2,label).set(i+3,5,99).merge(i+3,2,1,3));
 sh.set(2,7,'TOTAL HOURS').merge(2,7,1,2).merge(3,7,2,2);
 sh.set(2,10,'ACTIVE MEMBERS').merge(2,10,1,2).merge(3,10,1,2);
 sh.set(2,13,'CURRENT LOAS/ROAS').merge(2,13,1,2).merge(3,13,1,2);
 sh.set(8,2,'#members').set(8,3,'#members').set(8,4,'#group:division1').set(8,5,'#group:constructor');
 sh.set(10,2,'PATROL LEADERBOARD').set(11,3,'NAME').set(11,7,'HOURS');
 sh.set(20,2,'TOTAL MEMBERS').merge(20,2,2,3).merge(22,2,2,3);
 return sh;
}
const sh=welcome(),visual=JSON.stringify({styles:sh.styles,merges:sh.merges});ctx.renderDashboardOnSheet_(sh,stats);
assert.deepEqual(sh.values.slice(2,6).map(row=>row[4]),[2,1,1,4]);assert.equal(sh.values[2][6],9.5);assert.equal(sh.values[2][9],1);assert.equal(sh.values[2][12],1);assert.equal(sh.values[21][1],4);
assert.equal(sh.values[7][1],4);assert.equal(sh.values[7][2],4);assert.equal(sh.values[7][3],2);assert.equal(sh.values[7][4],0);assert.equal(sh.values[11][2],'Alex');assert.equal(sh.values[12][2],'=literal');assert.equal(sh.formulas[12][2],'');
assert.equal(JSON.stringify({styles:sh.styles,merges:sh.merges}),visual,'all existing layout/formatting stays intact');assert.deepEqual(dirty,[['Welcome Page']]);
const writes=sh.writes;dirty=[];ctx.renderDashboardOnSheet_(sh,stats);assert.equal(sh.writes,writes,'unchanged counts do not write again');assert.equal(dirty.length,0,'unchanged dashboard does not requeue public publishing');
stats={...stats,total:1,active:0,leaves:0,totalHours:0,groups:{Active:0},top:[]};ctx.renderDashboardOnSheet_(sh,stats);assert.equal(sh.values[2][4],0,'removed configured group clears old headcount');assert.equal(sh.values[5][4],1);assert.equal(sh.values[2][6],0);assert.equal(sh.values[2][9],0);assert.equal(sh.values[2][12],0);assert.equal(sh.values[11][2],'');assert.equal(sh.values[12][2],'');assert.equal(sh.values[7][3],0);
sh.set(8,6,'#division1');ctx.renderDashboardOnSheet_(sh,ctx.dashboardStats_(roster));ctx.renderDashboardOnSheet_(sh,stats);assert.equal(sh.values[7][5],'#division1');assert.equal(sh.notes[7][5],'','removed legacy alias restores the editable tag instead of stale count');
sh.set(8,2,'');ctx.renderDashboardOnSheet_(sh,stats);assert.equal(sh.notes[7][1],'');assert.equal(sh.values[7][1],'','clearing an explicit tag releases it');
const protectedSheet=welcome();protectedSheet.formulas[2][6]='=CUSTOM()';protectedSheet.set(3,7,42);protectedSheet.notes[2][9]='operator note';protectedSheet.set(3,10,75);protectedSheet.set(3,13,'Leave information');
ctx.renderDashboardOnSheet_(protectedSheet,stats);assert.equal(protectedSheet.values[2][6],42);assert.equal(protectedSheet.formulas[2][6],'=CUSTOM()');assert.equal(protectedSheet.values[2][9],75);assert.equal(protectedSheet.notes[2][9],'operator note');assert.equal(protectedSheet.values[2][12],'Leave information');
const explicit=welcome();explicit.set(3,7,'#members');ctx.renderDashboardOnSheet_(explicit,stats);assert.equal(explicit.values[2][6],1,'explicit tag overrides automatic KPI choice');assert.equal(explicit.notes[2][6],'roster-stat:members');
const other=welcome();other.name='Department notes';ctx.renderDashboardOnSheet_(other,stats);assert.equal(other.values[2][4],99,'automatic boxes limited to configured Welcome');
const released=welcome();ctx.renderDashboardOnSheet_(released,stats);released.set(2,7,'Custom information');released.set(2,2,'Other breakdown');ctx.renderDashboardOnSheet_(released,{...stats,totalHours:12,total:6,groups:{'Division 1':5}});assert.equal(released.values[2][6],0,'renaming a box title releases its counter');assert.equal(released.values[2][4],0,'renaming employee title releases its group counters');
const concurrent=new Sheet('Department notes');concurrent.set(1,1,'#members');const getRange=concurrent.getRange.bind(concurrent);let reads=0;
concurrent.getRange=(...args)=>{const range=getRange(...args);if(args[0]===1&&args[1]===1)range.getDisplayValue=()=>{if(++reads===1)concurrent.set(1,1,'new user text');return String(concurrent.values[0][0]);};return range;};ctx.renderDashboardOnSheet_(concurrent,stats);assert.equal(concurrent.values[0][0],'new user text','snapshot cannot overwrite a newer edit');
// Cached discovery must include Welcome even if no explicit tags exist there.
ctx.dashTabsGet_=()=>['Deleted'];ctx.dashTabsSet_=()=>{};ctx.cfg_=()=>({dashboardEnabled:true});ctx.dashboardSkip_=()=>false;
let sheets=[roster,sh];ctx.SpreadsheetApp.getActive=()=>({getSheetByName:name=>sheets.find(s=>s.name===name),getSheets:()=>sheets});
load(ctx,system,'function refreshDashboard_(','/** Render the dashboard onto ONE');ctx.refreshDashboard_();assert.equal(sh.values[2][4],2);
ctx.cfg_=()=>({dashboardEnabled:false});const offWrites=sh.writes;assert.equal(ctx.refreshDashboard_(),0);assert.equal(sh.writes,offWrites);ctx.cfg_=()=>({dashboardEnabled:true});
const realRange=sh.getRange;sh.getRange=()=>{throw Error('protected destination');};assert.throws(()=>ctx.refreshDashboard_(),/incomplete.*Welcome Page/);sh.getRange=realRange;
// Run the actual onEdit branch: tags inside a multi-cell paste on an already-known tab must be discovered.
load(ctx,system,'function refreshDashboardOnOneSheet_(','/* ----------------------------------------------------------------------\n * DEFERRED WORK');
load(ctx,system,'function onEdit(e)','/** Installable trigger: syncs a new form');
const pasted=new Sheet('Department notes');pasted.set(2,2,'#group:division1');sheets.push(pasted);ctx.dashTabsGet_=()=>['Department notes'];
const pasteRange=pasted.getRange(1,1,2,2);Object.assign(pasteRange,{getSheet:()=>pasted,getRow:()=>1,getColumn:()=>1,getNumRows:()=>2,getNumColumns:()=>2});ctx.onEdit({range:pasteRange});assert.equal(pasted.values[1][1],2);
let configJobs=[],invalidations=0;ctx.cfgInvalidate_=()=>invalidations++;ctx.deferWork_=key=>configJobs.push(key);ctx.onEdit({range:{getSheet:()=>({getName:()=> '⚙️ Config'})}});assert.equal(invalidations,1);assert.deepEqual(configJobs,['statuses','academy','groups','dashboard']);
// Real rank endpoint: case variants collapse, configured but unseated ranks and old icons remain selectable.
ctx.cfg_=()=>({tables:{RANKS:[{Value:'Officer',Kind:'RANK'},{Value:'Captain',Kind:'RANK'},{Value:'Academy',Kind:'DIVIDER'},{Value:'CADET',Kind:'TRAINING'}]}});
ctx.rankIconsMap_=()=>({officer:'icon-data',Retired:'old-icon'});ctx.CONFIG.rosterStartRow=4;roster.set(8,2,' officer ');
load(ctx,panel,'function cpRankIcons()','/** Panel endpoint: store/replace');const ranks=ctx.cpRankIcons().ranks;
assert.equal(ranks.filter(r=>r.rank.toUpperCase()==='OFFICER').length,1);assert.equal(ranks.find(r=>r.rank==='Officer').members,2);assert.equal(ranks.find(r=>r.rank==='Officer').icon,'icon-data');assert.equal(ranks.find(r=>r.rank==='Captain').members,0);assert(!ranks.some(r=>r.rank==='Academy'));assert.equal(ranks.find(r=>r.rank==='Retired').icon,'old-icon');
// Actual Settings editor: labels change the same DASHBOARD_GROUPS table; refreshed requests beat old replies.
const elements={},client={TBL:{DASHBOARD_GROUPS:[['Division 1','Officer'],['Division 2','']]},RANKLIST:ranks,RANKLOAD_GEN:0,RANKLOAD_PENDING:false,esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),$:id=>elements[id]||(elements[id]={innerHTML:'',setAttribute(){}}),updateBar(){this.updates=(this.updates||0)+1;}};vm.createContext(client);
client.TBLBASE={};client.TABLE_DIRTY=null;client.RANK_QUERY='';client.RANK_UNASSIGNED=false;client.DASH_PREVIEW=null;client.DASH_GEN=0;client.refreshGroupEditor_=()=>{};client.refreshStudio_=()=>{client.renderRankLabels();client.updateBar();};
load(client,html,'function tblChanged(n)','function boolOn(');
load(client,html,'function listOf(v)','var SECTION_BY_KEY');load(client,html,'function rankLabelKey_(','function rankIconsShell()');load(client,html,'function rkInitials(r)','function renderRankIcons(');
client.enhanceControls_=()=>{};client.rlToggle(1,'Officer');assert.equal(client.TBL.DASHBOARD_GROUPS[1][1],'Officer');client.rlToggle(0,'officer');assert.equal(client.TBL.DASHBOARD_GROUPS[0][1],'');client.TBL.DASHBOARD_GROUPS[0][1]='Senior  Officer';client.rlToggle(0,' senior officer ');assert.equal(client.TBL.DASHBOARD_GROUPS[0][1],'','rank labels use the same whitespace normalization as the engine');
client.TBL.STATUSES=[['Ready','TIER'],['Limited','TIER']];load(client,html,'function tagCheatText()','function refreshTagCheat()');const cheat=client.tagCheatText();assert(cheat.includes('data-tagcopy="#group:division1"'));assert(cheat.includes('data-tagcopy="#ready"'));assert(!cheat.includes('#1limited'),'forEach index must not enter tag prefixes');
let requests=[];client.api=(success,failure)=>requests.push({success,failure});load(client,html,'function loadRanksList()','function renderRankLabels()');client.loadRanksList();client.loadRanksList();assert.equal(requests.length,1,'deduplicate in-flight rank loads');
client.RANKLOAD_GEN++;client.RANKLOAD_PENDING=false;client.loadRanksList();requests[1].success({ranks:[{rank:'Latest',members:2}]});requests[0].success({ranks:[{rank:'Stale',members:99}]});assert.equal(client.RANKLIST[0].rank,'Latest');assert(elements.ranklabelsHost.innerHTML.includes('2 members'));
client.renderNav=client.renderSection=client.flushBar=()=>{};load(client,html,'function fromData(d)','function kvChanged(');client.fromData({blocks:[]});assert.equal(client.RANKLIST,null);assert.equal(client.RANKLOAD_PENDING,false);
const events={};elements.content.addEventListener=(type,handler)=>events[type]=handler;
client.TBL={DASHBOARD_GROUPS:[['Division 1','Officer']]};client.TBLBASE={DASHBOARD_GROUPS:'[]'};
load(client,html,"$('content').addEventListener('click',function(e){\n    var u=","$('content').addEventListener('keydown',function(e){");
elements.rlNew= {value:'Division 2'};events.click({target:{closest:selector=>selector==='[data-rladd]'?{}:null}});assert.equal(client.TBL.DASHBOARD_GROUPS.length,2);
events.click({target:{closest:selector=>selector==='[data-rldel]'?{dataset:{rldel:'0'}}:null}});assert.equal(client.TBL.DASHBOARD_GROUPS[0][0],'Division 2');
client.rlToggle(0,'CADET');client.SAVE_PENDING=client.BOOT_PENDING=false;client.setSaving_=()=>{};client.TABLE_DIRTY=null;
load(client,html,'function tblChanged(n)','function boolOn(');elements.saveBtn={querySelector:()=>({outerHTML:''})};let savedPayload;
client.api=(success,failure,endpoint,payload)=>{assert.equal(endpoint,'cpApplyConfig');savedPayload=payload;};load(client,html,'function saveAll(){','/* ── rank icons');client.saveAll();assert.deepEqual(JSON.parse(JSON.stringify(savedPayload.tables.DASHBOARD_GROUPS)),[['Division 2','CADET']]);
ctx.SpreadsheetApp.flush=()=>{};ctx.parseBlocks_=()=>({...structuredClone(raw),STATUS_OVERRIDES:table([])});let savedRows;ctx.setTableRows_=(sheet,name,rows)=>{assert.equal(name,'DASHBOARD_GROUPS');savedRows=rows;};ctx.cfgInvalidate_=()=>{};
load(ctx,panel,'const CP_SETTINGS_KV_','/**');load(ctx,panel,'function cpApplyConfig_(','/** Is a [BLOCK] marker');const saved=ctx.cpApplyConfig_({},savedPayload);assert(saved.ok,JSON.stringify(saved));assert.equal(savedRows[0][0],'Division 2');
const beforeSave=savedRows;assert.equal(ctx.cpApplyConfig_({},{tables:{DASHBOARD_GROUPS:[['Division 1','Officer'],['Division-1','CADET']]}}).ok,false);assert.equal(savedRows,beforeSave,'ambiguous group save refuses before any write');
// Queue wiring: config/status changes and script-only panel writes must refresh live statistics.
const jobs=[];let dirtyAll=0;ctx.cpWithLock_=fn=>fn();ctx.findConfigSheet_=()=>({});ctx.cpApplyConfig_=()=>({ok:true,written:{kv:1,tables:1}});ctx.cpGetConfig_=()=>({});ctx.cpAudit_=()=>{};ctx.deferWork_=job=>jobs.push(job);ctx.publishMarkDirty_=()=>dirtyAll++;ctx.scheduleCatchup_=()=>{};
load(ctx,panel,'function cpApplyConfig(payload)','/** Menu target: open');ctx.cpApplyConfig({tables:{STATUSES:[]}});assert(jobs.includes('statuses')&&jobs.includes('dashboard'));jobs.length=0;ctx.cpApplyConfig({kv:[{block:'DASHBOARD',key:'ENABLE',value:'TRUE'}]});assert.deepEqual(jobs,['dashboard']);jobs.length=0;ctx.cpApplyConfig({kv:[{block:'DISCORD',key:'COLOR',value:'#ffffff'}]});assert.equal(jobs.length,0);
load(ctx,panel,'function cpAudit_(','/** Injectable core: validate + set');for(const type of ['status','bulk','add','move','leave']){jobs.length=0;ctx.cpAudit_(type);assert(jobs.includes('dashboard'),type);}jobs.length=0;ctx.cpAudit_('action');assert.equal(jobs.length,0);
// A failed/re-enqueued status calculation must retain every dependent job for retry.
const props={};ctx.PropertiesService={getDocumentProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v,deleteProperty:k=>delete props[k],getProperties:()=>({...props})})};const lock={hasLock:()=>true,tryLock:()=>true,releaseLock(){}};ctx.LockService={getScriptLock:()=>lock,getDocumentLock:()=>lock};ctx.processMemberEditMoves_=()=>{};ctx.pendingMemberEditMoves_=()=>[];ctx.flushMemberTransferNotifications_=()=>{};
ctx.DEFER_PROP_='DEFERRED_WORK';load(ctx,system,'const DEFER_JOBS_','const DERIVED_LAST_PROP_');let ran=[];ctx.recomputeStatuses_=()=>{ran.push('statuses');throw Error('transient read failed');};ctx.buildAcademySheets_=()=>ran.push('academy');ctx.buildGroupSheets_=()=>ran.push('groups');ctx.refreshDashboard_=()=>ran.push('dashboard');ctx.deferWork_('statuses');ctx.deferWork_('dashboard');ctx.deferWork_('academy');ctx.runDeferredWork_();assert.deepEqual(ran,['statuses']);assert(props['RE_DEFER_JOB:dashboard']);ran=[];ctx.runDeferredWork_();assert.equal(ran.length,0,'status retry backoff also holds dependent statistics');
const retry=JSON.parse(props['RE_DEFER_JOB:statuses']);retry.next=0;props['RE_DEFER_JOB:statuses']=JSON.stringify(retry);ctx.recomputeStatuses_=()=>ran.push('statuses');ctx.runDeferredWork_();assert.deepEqual(ran,['statuses','academy','dashboard']);assert(!props['RE_DEFER_JOB:statuses']&&!props['RE_DEFER_JOB:dashboard']);
const fast=fs.readFileSync('RosterPublishFast.gs','utf8');load(ctx,fast,'function publishAssertSettled_(','/** Optional Sheets REST');props['RE_DEFER_JOB:dashboard']='pending';assert.throws(()=>ctx.publishAssertSettled_(null),/awaiting refresh/);delete props['RE_DEFER_JOB:dashboard'];ctx.publishAssertSettled_(null);
console.log('Ranks/dashboard: real configuration validation, modular roster statistics, custom groups, empty tiers/leave, Welcome boxes/tags/leaderboard, preservation, unchanged-write suppression, concurrent edits, caching, rank endpoint/editor and durable refresh/publish dependencies passed.');
