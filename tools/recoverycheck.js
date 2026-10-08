// Fault injection through the real financial recovery code. No live Google calls.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
let fault=null,held=false,events=[];
function point(kind,write){events.push(kind);if(fault&&fault.kind===kind&&!fault.after){fault=null;throw Error('interrupted '+kind)}write();if(fault&&fault.kind===kind&&fault.after){fault=null;throw Error('interrupted after '+kind)}}
class Sheet {
 constructor(rows,name){this.rows=rows;this.name=name||'Roster'} getLastRow(){return this.rows.length} getName(){return this.name} getSheetId(){return this.name==='Log'?20:10} getParent(){return {getId:()=> 'internal'}}
 getRange(r,c,n=1,w=1){const s=this;return {getValue:()=>s.rows[r-1][c-1],getDisplayValue:()=>String(s.rows[r-1][c-1]??''),getValues:()=>s.rows.slice(r-1,r-1+n).map(x=>x.slice(c-1,c-1+w)),getDisplayValues:()=>s.rows.slice(r-1,r-1+n).map(x=>x.slice(c-1,c-1+w).map(String)),getFormula:()=>'',setNumberFormat(){return this},setValue(v){point(s.name==='Source'?(String(v).startsWith('RE_CREDIT_V1:')?'prepare':'final'):s.name==='Log'?'log:'+c:'hours:'+r,()=>{s.rows[r-1][c-1]=v});return this}}}
}
const lock={hasLock:()=>held,tryLock(){held=true;return true},releaseLock(){held=false}};
const ctx={console:{error(){},warn(){},info(){},log(){}},Date,Math,Utilities:{getUuid:()=> 'test'},PropertiesService:{getDocumentProperties:()=>({getProperty:()=>null})},CacheService:{},LockService:{getScriptLock:()=>lock,getDocumentLock:()=>lock},SpreadsheetApp:{flush(){point('flush',()=>{})}}};
vm.createContext(ctx);for(const f of ['RosterConfig.gs','RosterSystem.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
Object.defineProperty(ctx,'CONFIG',{configurable:true,value:{rosterStartRow:2,patrol:{recompute:false}}});ctx.rosterCols_=()=>({rank:1,name:2,discord:3,hours:4,unit:5});ctx.isValidMemberValues_=(r,n)=>!!n;ctx.isValidId_=id=>/^\d{17,19}$/.test(String(id));ctx.publishMarkDirty_=()=>{};ctx.log_=()=>{};ctx.reportError_=()=>{};
const id='111111111111111111',other='222222222222222222';
function setup(prior='||1700000000000'){held=false;fault=null;events=[];return {roster:new Sheet([['Rank','Name','ID','Hours','Unit'],['Trooper','First',id,10,'S1'],['Trooper','Second',other,20,'S2']]),source:new Sheet([[prior]],'Source')}}
function reconcile(f,desired){return ctx.reconcilePatrolCredit_(f.source,1,{mark:1},f.roster,ctx.rosterCols_(),desired)}
// Before/after each ambiguous write: retry reaches exactly 13, and further retries are no-ops.
for(const kind of ['prepare','hours:2','final'])for(const after of [false,true]){
 const f=setup();fault={kind,after};assert.throws(()=>reconcile(f,{hours:3,mid:id}),/interrupted/);assert.equal(held,false);reconcile(f,{hours:3,mid:id});assert.equal(f.roster.rows[1][3],13,kind+' recovery');reconcile(f,{hours:3,mid:id});assert.equal(f.roster.rows[1][3],13);assert.equal(f.source.rows[0][0],'3|'+id+'|1700000000000');
}
for(const occurrence of [1,2,3]){
 const f=setup();let calls=0;const flush=ctx.SpreadsheetApp.flush;ctx.SpreadsheetApp.flush=()=>{if(++calls===occurrence)throw Error('flush interrupted')};assert.throws(()=>reconcile(f,{hours:3,mid:id}),/flush interrupted/);ctx.SpreadsheetApp.flush=flush;reconcile(f,{hours:3,mid:id});assert.equal(f.roster.rows[1][3],13);
}
// Same-member delta and two-member reversal/re-credit use one recovery record, never double reverse.
let f=setup('3|'+id+'|1700000000000');f.roster.rows[1][3]=13;reconcile(f,{hours:5,mid:id});assert.equal(f.roster.rows[1][3],15);
for(const after of [false,true]){f=setup('3|'+id+'|1700000000000');f.roster.rows[1][3]=13;fault={kind:'hours:3',after};assert.throws(()=>reconcile(f,{hours:5,mid:other}),/interrupted/);reconcile(f,{hours:5,mid:other});assert.equal(f.roster.rows[1][3],10);assert.equal(f.roster.rows[2][3],25)}
f=setup('3|'+id);f.roster.rows[1][3]=13;fault={kind:'final',after:false};assert.throws(()=>reconcile(f,null));reconcile(f,null);assert.equal(f.roster.rows[1][3],10);assert.equal(f.source.rows[0][0],'');
// Manual edits after failure are conflicts. Preflight all members prevents a partial replay into a changed total.
f=setup();fault={kind:'hours:2',after:false};assert.throws(()=>reconcile(f,{hours:3,mid:id}));f.roster.rows[1][3]=99;assert.throws(()=>reconcile(f,{hours:3,mid:id}),/conflict/);assert.equal(f.roster.rows[1][3],99);assert(f.source.rows[0][0].startsWith('RE_CREDIT_V1:'));
f=setup();f.roster.rows[2][2]=id;assert.equal(ctx.patrolFindRow_(f.roster,id,''),-1);assert.throws(()=>reconcile(f,{hours:3,mid:id}),/duplicate ID/);assert.equal(f.roster.rows[1][3],10);
assert.throws(()=>ctx.patrolCreditTransaction_('RE_CREDIT_V1:not-json'),/malformed/);assert.throws(()=>ctx.patrolCreditTransaction_('RE_CREDIT_V1:'+JSON.stringify({version:1,book:'internal',sheet:10,final:'done',changes:[{id,before:10,after:null}]})),/invalid member/);
console.log('Recovery: interrupted prepare/hour/final writes and flushes, delta/reversal retries, cross-member recovery, conflicting edits, duplicate IDs and malformed records passed');
// Import fields resume by destination token, even when sorting moves the incomplete row.
ctx.CONFIG.patrolStartRow=2;ctx.framedTable_=s=>({cap:s.rows.length+1});ctx.ensureRoomAboveCap_=()=>{};
const PC={mark:1,width:4,discord:2,startDate:3,name:4},layout={};for(const k of ['mark','discord','name','unit','notes','startDate','startTime','endDate','endTime'])layout[k]=PC[k]||0;
const tx={version:1,book:'internal',sheet:20,row:2,mark:1,layout,token:'import-1',timestamp:1700000000000,fields:[[2,id],[3,{date:1700000000000}],[4,'First']]};
function importFixture(){fault=null;events=[];return {source:new Sheet([['RE_IMPORT_V1:'+JSON.stringify(tx)]],'Source'),log:new Sheet([['Marker','ID','Date','Name'],['','','',''],['','','','']],'Log')}}
function resume(g){return ctx.applyPatrolImportTransaction_(g.source.getRange(1,1),g.log,PC,ctx.patrolImportTransaction_(g.source.rows[0][0]))}
for(const kind of ['log:1','log:2','log:3','log:4','final'])for(const after of [false,true]){
 const g=importFixture();fault={kind,after};assert.throws(()=>resume(g),/interrupted/);
 if(g.source.rows[0][0].startsWith('RE_IMPORT_V1:'))resume(g);
 assert.equal(g.log.rows[1][1],id);assert.equal(g.log.rows[1][2].getTime(),1700000000000);assert.equal(g.log.rows[1][3],'First');assert(g.log.rows[1][0].endsWith('|IMPORT:import-1'));assert(g.source.rows[0][0].startsWith('✓ Imported'));
}
let g=importFixture();fault={kind:'log:3',after:false};assert.throws(()=>resume(g));[g.log.rows[1],g.log.rows[2]]=[g.log.rows[2],g.log.rows[1]];assert.equal(resume(g),3);assert.equal(g.log.rows[1][1],'');assert.equal(g.log.rows[2][3],'First');
g=importFixture();fault={kind:'log:3',after:false};assert.throws(()=>resume(g));g.log.rows[1][1]=other;assert.throws(()=>resume(g),/conflict/);assert.equal(g.log.rows[1][1],other);assert(g.source.rows[0][0].startsWith('RE_IMPORT_V1:'));
g=importFixture();g.log.rows[1][0]='||1700000000000|IMPORT:import-1';g.log.rows[2][0]=g.log.rows[1][0];assert.throws(()=>resume(g),/duplicated/);
g=importFixture();g.log.rows[1]=['3|'+id+'|1700000000000|IMPORT:import-1',id,new Date(1700000000000),'First'];resume(g);assert(g.log.rows[1][0].startsWith('3|'),'acknowledgement does not erase a completed credit');
f=setup('||1700000000000|IMPORT:import-1');reconcile(f,{hours:3,mid:id});assert(f.source.rows[0][0].endsWith('|IMPORT:import-1'));reconcile(f,null);assert(f.source.rows[0][0].endsWith('|IMPORT:import-1'));
console.log('Imports: partial fields, acknowledgement failures, sorted pending rows, conflicting edits, duplicate tokens and preserved credit/import markers passed');
// Transfers stage all MEMBER runs before clearing any source cells, preserving SLOT columns.
let properties={};ctx.PropertiesService={getDocumentProperties:()=>({getProperty:k=>properties[k]||null,setProperty(k,v){point('journal:'+JSON.parse(v).phase,()=>{properties[k]=v});return this},deleteProperty(k){point('journal:delete',()=>{delete properties[k]});return this}})};
const originalRange=Sheet.prototype.getRange;
Sheet.prototype.getLastColumn=function(){return this.rows[0].length};Sheet.prototype.getMaxRows=function(){return this.rows.length};
Sheet.prototype.getRange=function(r,c,n=1,w=1){const range=originalRange.call(this,r,c,n,w),sheet=this;range.getFormulasR1C1=()=>Array.from({length:n},()=>Array(w).fill(''));range.clearContent=()=>{point('clear:'+c,()=>{for(let i=0;i<n;i++)for(let j=0;j<w;j++)sheet.rows[r+i-1][c+j-1]=''});return range};range.copyTo=(dest)=>{point('copy:'+c,()=>{const values=range.getValues();for(let i=0;i<n;i++)for(let j=0;j<w;j++)dest.write(i,j,values[i][j])});return range};range.write=(i,j,v)=>{sheet.rows[r+i-1][c+j-1]=v};return range};
ctx.SpreadsheetApp.CopyPasteType={PASTE_NO_BORDERS:1};ctx.slotColumnSet_=()=>({1:true,5:true});
function transferFixture(){properties={};fault=null;events=[];return new Sheet([['Rank','Name','ID','Hours','Unit','Extra'],['Trooper','First',id,10,'S1','custom'],['Sergeant','','','','S2','']])}
for(const kind of ['journal:prepared','copy:2','copy:6','journal:clearing','clear:2','clear:6','journal:delete'])for(const after of [false,true]){
 const ro=transferFixture();fault={kind,after};assert.throws(()=>ctx.moveMemberColumns_(ro,2,3),/interrupted/);
 const pending=ctx.memberMoveJournal_(ro);
 if(pending)ctx.resumeMemberMove_(ro,pending);else if(ro.rows[1][1])ctx.moveMemberColumns_(ro,2,3);
 assert.deepEqual(ro.rows[1],['Trooper','','','','S1','']);assert.deepEqual(ro.rows[2],['Sergeant','First',id,10,'S2','custom']);assert.equal(ctx.memberMoveJournal_(ro),null);
 const firstClear=events.findIndex(x=>x.startsWith('clear:'));assert(firstClear>events.indexOf('copy:6'),'every MEMBER run copied before clearing');
}
let ro=transferFixture();fault={kind:'copy:6',after:false};assert.throws(()=>ctx.moveMemberColumns_(ro,2,3));ro.rows[1][5]='manual edit';assert.throws(()=>ctx.resumeMemberMove_(ro,ctx.memberMoveJournal_(ro)),/source member fields/);assert.equal(ro.rows[1][5],'manual edit');
ro=transferFixture();fault={kind:'clear:6',after:false};assert.throws(()=>ctx.moveMemberColumns_(ro,2,3));ro.rows[2][3]=99;assert.throws(()=>ctx.resumeMemberMove_(ro,ctx.memberMoveJournal_(ro)),/destination member fields/);assert.equal(ro.rows[2][3],99);
ro=transferFixture();ro.rows[1][5]='x'.repeat(9000);assert.throws(()=>ctx.moveMemberColumns_(ro,2,3),/storage limit/);assert.equal(ro.rows[1][1],'First');assert.equal(ro.rows[2][1],'');assert.equal(Object.keys(properties).length,0);
ro=transferFixture();fault={kind:'copy:6',after:false};assert.throws(()=>ctx.moveMemberColumns_(ro,2,3));assert.throws(()=>ctx.moveMemberColumns_(ro,3,2),/interrupted transfer is pending/);
console.log('Transfers: interrupted journal/copy/clear/acknowledgement writes, staged copying, SLOT preservation, conflicting edits, oversized journals and pending-move isolation passed');
// Execute the full direct-form credit path, including a service error after Google accepted the hour write.
properties={};const richerRange=Sheet.prototype.getRange;Sheet.prototype.getRange=function(r,c,n=1,w=1){const rg=richerRange.call(this,r,c,n,w);rg.getBackgrounds=()=>Array.from({length:n},()=>Array(w).fill('#fff'));rg.setBackground=()=>rg;rg.setFormula=()=>rg;return rg};
ctx.CONFIG.bg={done:'#done',error:'#err'};ctx.CONFIG.notify={};ctx.CONFIG.patrol={mode:'DURATION',maxHours:100,recompute:false,pendingStatus:'Pending',flaggedStatus:'Flagged',processedStatus:'Processed',approvedStatus:'Approved',deniedStatus:'Denied'};
ctx.CONFIG.sheets={};ctx.patrolCols_=()=>({discord:2,callsign:0,duration:3,start:0,end:0,timestamp:1});ctx.patrolMarkerCol_=()=>4;ctx.ssTz_=()=> 'UTC';ctx.Utilities.formatDate=()=> 'test';
for(const after of [false,true]){
 f=setup();f.source.rows=[['Timestamp','ID','Hours','_Credited'],[new Date(1700000000000),id,3,'']];fault={kind:'hours:2',after};assert.throws(()=>ctx.syncPatrolHours_(f.source,f.roster,{sendWebhooks:false}),/credit could not finish/);const result=ctx.syncPatrolHours_(f.source,f.roster,{sendWebhooks:false});assert.equal(result.recovered,1);assert.equal(f.roster.rows[1][3],13);assert.equal(ctx.syncPatrolHours_(f.source,f.roster,{sendWebhooks:false}).credited.length,0);
}
// The real log processor cannot stamp Processed or notify before its financial writes complete.
ctx.evaluatePatrolLog_=()=>({blocking:false,reason:''});let notifications=0;ctx.patrolNotifyRow_=()=>notifications++;
const pc={mark:1,discord:2,startDate:3,startTime:4,endDate:5,endTime:6,status:7,notes:8,name:9,rank:10,unit:11,total:14};
f=setup();f.source.rows=[['||1700000000000',id,new Date(2026,9,6),new Date(2020,0,1,9),new Date(2026,9,6),new Date(2020,0,1,12),'Pending','','First','Trooper','S1','','','']];fault={kind:'hours:2',after:true};assert.equal(ctx.processPatrolLog_(f.source,1,pc,f.roster),false);assert.equal(f.source.rows[0][6],'Pending');assert.equal(notifications,0);assert.equal(ctx.processPatrolLog_(f.source,1,pc,f.roster),true);assert.equal(f.source.rows[0][6],'Processed');assert.equal(f.roster.rows[1][3],13);assert.equal(notifications,1);
// Resets/restores see recovery records before destructive writes.
properties={};f=setup();const patrol=new Sheet([['Marker'],['RE_CREDIT_V1:pending']],'Log');ctx.CONFIG.sheets={patrolLog:'Log',patrol:''};ctx.patrolLogCols_=()=>({mark:1});f.roster.getParent=()=>({getSheetByName:()=>patrol});assert.throws(()=>ctx.assertNoPendingRosterRecovery_(f.roster,'Activity reset'),/unfinished patrol/);
console.log('Integration: real direct-form credit retries, delayed Processed/notification updates and destructive reset/restore recovery guards passed');
// A leave row whose durable key survived a partial batch write fills only missing fields on retry.
const loaCols={width:7,discord:1,start:2,end:3,status:4,name:5,notes:6,key:7};
const planned=[id,new Date(2026,9,6),new Date(2026,9,8),'Pending','First','reason','KEY|test'];
let leave=new Sheet([[id,planned[1],'','','','admin note','KEY|test']],'Log');
fault={kind:'log:3',after:true};assert.throws(()=>ctx.repairIncompleteLeaveRow_(leave,1,loaCols,planned),/interrupted/);
ctx.repairIncompleteLeaveRow_(leave,1,loaCols,planned);assert.equal(leave.rows[0][3],'Pending');assert.equal(leave.rows[0][5],'admin note');assert.equal(ctx.repairIncompleteLeaveRow_(leave,1,loaCols,planned),0);
leave=new Sheet([[other,planned[1],'','','','','KEY|test']],'Log');assert.throws(()=>ctx.repairIncompleteLeaveRow_(leave,1,loaCols,planned),/conflicts/);assert.equal(leave.rows[0][2],'');
patrol.rows[1][0]='||1700000000000|IMPORT_PENDING:test';assert.throws(()=>ctx.assertNoPendingRosterRecovery_(f.roster,'Activity reset'),/unfinished patrol/);
console.log('Leave recovery: partial accepted writes resume, manual notes survive, conflicting identities stop, and orphaned pending imports block destructive resets passed');
// Actual reset boundary: failed archives never zero hours; completed resets acknowledge without rolling again.
vm.runInContext(fs.readFileSync('RosterExtras.gs','utf8'),ctx);
let resetState={},archives=0,zeroes=0,archiveError=false,clockError=false;
ctx.PropertiesService.getDocumentProperties=()=>({getProperty:k=>resetState[k]??null,setProperty(k,v){if(k==='RE_LAST_HOURS_RESET_MS'&&clockError){clockError=false;throw Error('clock interrupted')}resetState[k]=String(v);return this},deleteProperty(k){delete resetState[k];return this}});
ctx.SpreadsheetApp.getActive=()=>({getId:()=> 'internal'});ctx.getSheetOrWarn_=()=>new Sheet([['header']]);ctx.assertNoPendingRosterRecovery_=()=>{};ctx.captureHoursSnapshot_=()=>1;
ctx.readMembers_=()=>[{id,name:'First',activity:zeroes?'Inactive':'Active',hours:zeroes?0:10}];ctx.cfg_=()=>({kv:{ACTIVITY:{PERIOD_BUCKET:'RESET'}}});ctx.periodLabel_=()=> 'OCT HOURS';ctx.shiftArchiveColumns_=()=>{archives++;if(archiveError)throw Error('archive interrupted');return 1};ctx.captureLastActivityCore_=()=>1;ctx.lastActivityCols_=()=>[];ctx.recomputeStatuses_=()=>{zeroes++};ctx.logInfo_=()=>{};ctx.postSummary_=()=>{};ctx.CONFIG.tierNames=['Active','Inactive'];ctx.CONFIG.notify={};
held=false;archiveError=true;assert.throws(()=>ctx.doWeeklyReset_(),/archive interrupted/);assert.equal(zeroes,0);assert.equal(held,false);archiveError=false;assert.throws(()=>ctx.doWeeklyReset_(),/reset stopped during archive/);assert.equal(archives,1,'pending archive is never rolled twice');
resetState={};archives=zeroes=0;clockError=true;assert.throws(()=>ctx.doWeeklyReset_(),/clock interrupted/);assert.equal(zeroes,1);assert.equal(JSON.parse(resetState.RE_ACTIVITY_RESET_PENDING).phase,'committed');const acknowledged=ctx.doWeeklyReset_();assert.equal(acknowledged.recovered,true);assert.equal(archives,1);assert.equal(zeroes,1);assert.equal(resetState.RE_ACTIVITY_RESET_PENDING,undefined);assert(resetState.RE_LAST_HOURS_RESET_MS);
console.log('Activity resets: failed archives preserve hours, checkpoints block ambiguous replay, and completed financial resets acknowledge once after clock failure passed');
// Seat the real panel core with failures before/after every member field and journal acknowledgement.
vm.runInContext(fs.readFileSync('RosterControlPanel.gs','utf8'),ctx);
const seatCols={rank:1,name:2,discord:3,hours:4,unit:5,join:6,activity:7,ooc:8,shift:9};ctx.rosterCols_=()=>seatCols;ctx.isMemberSlot_=()=>true;ctx.todayInSheetTz_=()=>new Date(2026,9,6);
const seatRange=Sheet.prototype.getRange;Sheet.prototype.getRange=function(r,c,n=1,w=1){const cell=seatRange.call(this,r,c,n,w),set=cell.setValue;cell.getBackground=()=> '#fff';cell.setValue=function(v){point('seat:'+c,()=>set.call(cell,v));return cell};return cell};
ctx.PropertiesService.getDocumentProperties=()=>({getProperty:k=>properties[k]??null,getProperties:()=>({...properties}),setProperty(k,v){point('seat:journal',()=>properties[k]=String(v));return this},deleteProperty(k){point('seat:ack',()=>delete properties[k]);return this}});
const seatPayload={row:2,name:'New member',discord:id,ooc:'Display',shift:'Day'};
function seatingFixture(){properties={};held=false;fault=null;return new Sheet([['Rank','Name','ID','Hours','Unit','Join','Activity','OOC','Shift'],['Trooper','','','','S1','','','','']])}
for(const kind of ['seat:journal','seat:2','seat:3','seat:4','seat:6','seat:7','seat:8','seat:9','seat:ack'])for(const after of [false,true]){
 const seated=seatingFixture();fault={kind,after};assert.throws(()=>ctx.cpAssignMember_(seated,seatPayload),/interrupted/);const pending=ctx.memberAssignmentJournal_(seated,2);
 if(pending||!seated.rows[1][1])ctx.cpAssignMember_(seated,seatPayload);
 assert.equal(seated.rows[1][1],'New member');assert.equal(seated.rows[1][2],id);assert.equal(seated.rows[1][3],0);assert.equal(seated.rows[1][4],'S1');assert.equal(seated.rows[1][6],'Inactive');assert.equal(ctx.memberAssignmentJournal_(seated,2),null);
}
let seated=seatingFixture();fault={kind:'seat:6',after:false};assert.throws(()=>ctx.cpAssignMember_(seated,seatPayload));seated.rows[1][3]=99;assert.throws(()=>ctx.cpAssignMember_(seated,seatPayload),/conflict/);assert.equal(seated.rows[1][3],99);assert.throws(()=>ctx.cpAssertSlotRow_(seated,2),/interrupted member assignment/);assert.throws(()=>ctx.cpAssignMember_(seated,{...seatPayload,name:'Different'}),/original assignment/);
seated=seatingFixture();seated.rows[1][2]=other;assert.throws(()=>ctx.cpAssignMember_(seated,seatPayload),/still holds a Unique ID/);assert.equal(seated.rows[1][2],other);
console.log('Member seating: ambiguous journal/field/acknowledgement failures recover, SLOT values survive, reservations block other edits, and conflicting values/requests stop safely passed');
seated=seatingFixture();properties.RE_ACTIVITY_RESET_PENDING=JSON.stringify({book:'internal',sheet:10,phase:'archive'});assert.throws(()=>ctx.cpAssignMember_(seated,seatPayload),/reset needs review/);assert.equal(seated.rows[1][1],'');assert.equal(ctx.memberAssignmentJournal_(seated,2),null);
// Replacement history must land before the previous snapshot is deleted; retain the entire new roster batch.
const extrasSource=fs.readFileSync('RosterExtras.gs','utf8');vm.runInContext(extrasSource.slice(extrasSource.indexOf('function captureHoursSnapshot_('),extrasSource.indexOf('/**\n * Period label',extrasSource.indexOf('function captureHoursSnapshot_('))),ctx);
class History {
 constructor(){this.rows=[['WeekOf','DiscordID','Name','Rank','Hours','Status'],['week',id,'Original','Trooper',10,'Active']];this.removed=0}
 getLastRow(){let last=0;this.rows.forEach((r,i)=>{if(r.some(v=>v!==''))last=i+1});return last}getMaxRows(){return this.rows.length}insertRowsAfter(at,n){this.rows.splice(at,0,...Array.from({length:n},()=>Array(6).fill('')))}
 deleteRows(at,n){this.removed++;this.rows.splice(at-1,n)}
 getLastColumn(){return 6}getFilter(){return null}
 getRange(r,c,n=1,w=1){const sheet=this;return {sort(){},createFilter(){},setNumberFormat(){return this},setBackground(){return this},setFontColor(){return this},setFontFamily(){return this},setFontSize(){return this},setFontWeight(){return this},setVerticalAlignment(){return this},setWrap(){return this},getValues:()=>sheet.rows.slice(r-1,r-1+n).map(x=>x.slice(c-1,c-1+w)),getDisplayValues:()=>sheet.rows.slice(r-1,r-1+n).map(x=>x.slice(c-1,c-1+w).map(String)),setValues(values){point('history:append',()=>values.forEach((row,i)=>row.forEach((v,j)=>sheet.rows[r+i-1][c+j-1]=v)));return this}}}
}
let history;ctx.cfgSheetName_=()=> 'History';ctx.SpreadsheetApp.getActive=()=>({getSheetByName:()=>history});ctx.readMembers_=()=>[{id,name:'=literal',rank:'Trooper',hours:12,activity:'Active'},{id:other,name:'Second',rank:'Trooper',hours:20,activity:'Active'}];ctx.logRowCap_=()=>1;
for(const after of [false,true]){history=new History();fault={kind:'history:append',after};assert.throws(()=>ctx.captureHoursSnapshot_('week'),/interrupted/);assert.equal(history.rows[1][2],'Original');assert.equal(history.removed,0,'failed append preserves prior snapshot');ctx.captureHoursSnapshot_('week');assert.equal(history.getLastRow(),3,'full roster retained beyond a small cap');assert.equal(history.rows[1][2],"'=literal");assert.equal(history.rows[2][1],other)}
console.log('Hours history: replacement append failures preserve prior snapshots, retries replace safely, literal text cannot become formulas, and small caps retain the complete current roster passed');
// Approval owns the original assignment and source key through private-field and Processed acknowledgement failures.
const signupCols={width:8,dataStart:2,name:3,discord:2,status:4,email:5,dob:6,phone:7,ooc:8,join:0};ctx.signupCols_=()=>signupCols;ctx.rosterPiiCols_=()=>({email:10,dob:11,phone:12});
ctx.PropertiesService.getDocumentProperties=()=>({getProperty:k=>properties[k]??null,getProperties:()=>({...properties}),setProperty(k,v){point(k.startsWith('RE_SIGNUP_APPROVAL:')?'approval:journal':'seat:journal',()=>properties[k]=String(v));return this},deleteProperty(k){point(k.startsWith('RE_SIGNUP_APPROVAL:')?'approval:ack':'seat:ack',()=>delete properties[k]);return this}});
const approvalRange=Sheet.prototype.getRange;Sheet.prototype.getRange=function(r,c,n=1,w=1){const cell=approvalRange.call(this,r,c,n,w),set=cell.setValue,sheet=this;cell.getA1Notation=()=>String.fromCharCode(64+c)+r;cell.setValue=function(v){const kind=sheet.name==='Signups'?(c===4?'approval:status':'approval:sourceKey'):(c>=10?'approval:private'+c:'other');point(kind,()=>set.call(cell,v));return cell};return cell};
function approvalFixture(){properties={};fault=null;const roster=seatingFixture();roster.rows.forEach(r=>r.push('','',''));const source=new Sheet([['Key','ID','Name','Status','Email','DOB','Phone','OOC'],['SIGNUP|'+id+'|1700000000000',id,'Applicant','Pending','private@example.com','2000-01-01','555-0100','Display']],'Signups');source.getSheetId=()=>30;return {roster,source}}
for(const kind of ['approval:sourceKey','approval:journal','seat:6','seat:2','approval:private10','approval:private11','approval:private12','approval:status','approval:ack'])for(const after of [false,true]){
 const trial=approvalFixture();fault={kind,after};assert.throws(()=>ctx.approveSignup_(trial.source,2,trial.roster,2,{}),/interrupted/);
 const key='RE_SIGNUP_APPROVAL:30:'+id,pending=properties[key];if(pending)ctx.resumeSignupApproval_(trial.source,trial.roster,JSON.parse(pending),key);else if(trial.source.rows[1][3]!=='Processed')ctx.approveSignup_(trial.source,2,trial.roster,2,{});
 assert.equal(trial.roster.rows[1][1],'Applicant');assert.equal(trial.roster.rows[1][2],id);assert.equal(trial.roster.rows[1][9],'private@example.com');assert.equal(trial.source.rows[1][3],'Processed');assert.equal(properties[key],undefined);assert.equal(ctx.memberAssignmentJournal_(trial.roster,2),null);
}
let trial=approvalFixture();fault={kind:'approval:private11',after:false};assert.throws(()=>ctx.approveSignup_(trial.source,2,trial.roster,2,{}));const approvalKey='RE_SIGNUP_APPROVAL:30:'+id;trial.source.rows.push(['',other,'Other','Pending','','','','']);[trial.source.rows[1],trial.source.rows[2]]=[trial.source.rows[2],trial.source.rows[1]];ctx.resumeSignupApproval_(trial.source,trial.roster,JSON.parse(properties[approvalKey]),approvalKey);assert.equal(trial.source.rows[2][3],'Processed');assert.equal(trial.source.rows[1][3],'Pending','sorted acknowledgement follows source key');
trial=approvalFixture();fault={kind:'approval:private11',after:false};assert.throws(()=>ctx.approveSignup_(trial.source,2,trial.roster,2,{}));trial.roster.rows[1][9]='manual@example.com';assert.throws(()=>ctx.resumeSignupApproval_(trial.source,trial.roster,JSON.parse(properties[approvalKey]),approvalKey),/private details changed/);assert.equal(trial.roster.rows[1][9],'manual@example.com');assert.equal(trial.source.rows[1][3],'Pending');
trial=approvalFixture();fault={kind:'approval:status',after:false};assert.throws(()=>ctx.approveSignup_(trial.source,2,trial.roster,2,{}));trial.source.rows[1][3]='Denied';assert.throws(()=>ctx.resumeSignupApproval_(trial.source,trial.roster,JSON.parse(properties[approvalKey]),approvalKey),/identity\/status/);assert.equal(trial.source.rows[1][3],'Denied');
console.log('Signup approval: source-key/journal/seating/private-field/Processed/acknowledgement failures recover without duplicate seating; sorting follows keys and conflicting PII/status edits stop passed');
const duplicateQueue=new Sheet([['Key','ID','Name','Status','','','',''],['SIGNUP|'+id+'|1',id,'First','Pending','','','',''],['SIGNUP|'+id+'|2',id,'Again','Pending','','','','']],'Signups');duplicateQueue.getSheetId=()=>30;
assert.equal(ctx.signupResolveRow_(duplicateQueue,2,id,'SIGNUP|'+id+'|2'),3);assert.throws(()=>ctx.signupResolveRow_(duplicateQueue,2,id),/ambiguous/);assert.throws(()=>ctx.signupResolveRow_(duplicateQueue,2.5,''),/Invalid signup row/);
duplicateQueue.rows[2][0]=duplicateQueue.rows[1][0];assert.throws(()=>ctx.signupResolveRow_(duplicateQueue,2,id,duplicateQueue.rows[1][0]),/ambiguous/);
trial=approvalFixture();fault={kind:'approval:private11',after:false};assert.throws(()=>ctx.approveSignup_(trial.source,2,trial.roster,2,{}));trial.source.rows[1][4]='changed@example.com';assert.throws(()=>ctx.resumeSignupApproval_(trial.source,trial.roster,JSON.parse(properties[approvalKey]),approvalKey),/answers changed/);
trial=approvalFixture();ctx.CONFIG.sheets.signups='Signups';ctx.adminFile_=()=>({getSheetByName:()=>trial.source});ctx.cpWithLock_=fn=>{assert(!held);held=true;try{return fn()}finally{held=false}};let flagAudits=0;ctx.cpAudit_=()=>{assert(held);flagAudits++};ctx.sortSignups_=()=>assert(held);
const flagRequest={row:2,id,key:trial.source.rows[1][0],flagged:true};ctx.cpSignupFlag(flagRequest);ctx.cpSignupFlag(flagRequest);assert.equal(trial.source.rows[1][3],'Flagged');assert.equal(flagAudits,1,'an acknowledged flag retry does not toggle back or duplicate its audit');assert(!held);
console.log('Signup identities: keyed duplicate submissions relocate exactly, ambiguous ID-only/fractional requests stop, edited answers block recovery, and flag retries remain idempotent under the writer lock passed');
