// Real sheet-edit transfer, queued retries, journal recovery and writer boundaries.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const id='111111111111111111',other='222222222222222222';
let data={},held=false,busy=false,book,waits=[],messages=[],logs=[],builds=[],notices=0,fault=null,lockHook=null;
function point(kind,fn){const hit=fault&&fault.kind===kind;if(hit&&!fault.after){fault=null;throw Error('interrupted '+kind);}fn();if(hit&&fault.after){fault=null;throw Error('interrupted after '+kind);}}
const props={getProperty:k=>data[k]??null,getProperties:()=>({...data}),setProperty(k,v){point(k.startsWith('RE_EDIT_MOVE:')?'request:'+JSON.parse(v).phase:'property:'+k,()=>data[k]=String(v));return this;},deleteProperty(k){point(k.startsWith('RE_EDIT_MOVE:')?'request:delete':'delete:'+k,()=>delete data[k]);return this;}};
const lock={hasLock:()=>held,tryLock(ms){waits.push(ms);if(lockHook){const hook=lockHook;lockHook=null;hook();}if(busy)return false;held=true;return true;},releaseLock(){held=false;}};
class Sheet{
 constructor(){this.rows=[['Border','Rank','Name','ID','Hours','Unit','Notes'],['','Trooper','First',id,10,'S1','custom'],['','Sergeant','',id,'','S2',''],['','Officer','','','','S3','']];}
 getName(){return 'Roster';}getSheetId(){return 10;}getParent(){return book;}getLastColumn(){return this.rows[0].length;}getLastRow(){return this.rows.length;}getMaxRows(){return this.rows.length;}
 getRange(r,c,n=1,w=1){const sh=this;return {getRow:()=>r,getColumn:()=>c,getLastColumn:()=>c+w-1,getNumRows:()=>n,getNumColumns:()=>w,getSheet:()=>sh,
  getValue:()=>sh.rows[r-1][c-1],getDisplayValue:()=>String(sh.rows[r-1][c-1]??''),
  getValues:()=>sh.rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w)),getDisplayValues:()=>sh.rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w).map(v=>String(v??''))),getFormulasR1C1:()=>Array.from({length:n},()=>Array(w).fill('')),
  setValue(v){sh.rows[r-1][c-1]=v;return this;},setNumberFormat(){return this;},
  write(i,j,v){sh.rows[r+i-1][c+j-1]=v;},copyTo(dest){point('copy:'+c,()=>{const values=this.getValues();values.forEach((row,i)=>row.forEach((v,j)=>dest.write(i,j,v)));});},
  clearContent(){point('clear:'+c,()=>{for(let i=0;i<n;i++)for(let j=0;j<w;j++)sh.rows[r+i-1][c+j-1]='';});return this;}};
 }
}
const ctx={Date,Math,console,PropertiesService:{getDocumentProperties:()=>props},LockService:{getScriptLock:()=>lock,getDocumentLock:()=>lock},SpreadsheetApp:{getActive:()=>book,getUi:()=>({}),CopyPasteType:{PASTE_NO_BORDERS:1},flush(){}},Utilities:{getUuid:()=> 'test'}};
vm.createContext(ctx);for(const f of ['RosterConfig.gs','RosterSystem.gs','RosterControlPanel.gs','RosterPublishFast.gs'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const columns={rank:2,name:3,discord:4,hours:5,unit:6,headerRow:1};
Object.defineProperty(ctx,'CONFIG',{configurable:true,value:{sheets:{roster:'Roster'},rosterStartRow:2,notify:{transfer:true}}});
ctx.rosterCols_=()=>({...columns});ctx.slotColumnSet_=()=>({1:true,2:true,6:true});ctx.isMemberSlot_=rank=>!!rank&&rank!=='DIVIDER';ctx.isValidMemberValues_=(rank,name)=>!!name&&ctx.isMemberSlot_(rank);
ctx.log_=(fn,e)=>logs.push([fn,String(e)]);ctx.diagnosticNotice_=(...args)=>logs.push(args);
const actualPromoRecord=ctx.promoRecord_;
ctx.promoRecord_=()=>{};ctx.auditEvent_=()=>{};ctx.publishMarkDirty_=()=>{data.PUBLIC_DIRTY='1';};ctx.scheduleCatchup_=()=>notices++;
ctx.notifyCh_=()=>{assert(!held,'HTTP notification outside writer lock');notices++;};ctx.fill_=()=> 'Transfer';ctx.clamp_=v=>v;ctx.dash_=ctx.withIcon_=v=>v;ctx.hexToInt_=()=>1;ctx.mention_=v=>v;
ctx.buildAcademySheets_=()=>builds.push('academy');ctx.buildGroupSheets_=()=>builds.push('groups');ctx.refreshDashboard_=()=>builds.push('dashboard');
function fixture(){data={};held=busy=false;waits=[];messages=[];logs=[];builds=[];notices=0;fault=null;lockHook=null;columns.discord=4;const sh=new Sheet();book={getId:()=> 'internal',getSheets:()=>[sh]};return sh;}
function move(sh,confirm=()=>true,old){ctx.checkForMemberMove(sh,sh.getRange(3,4),id,msg=>{assert(!held,'consent outside writer lock');return confirm(msg);},msg=>{assert(!held,'UI outside writer lock');messages.push(msg);},old);}
function request(){const p=ctx.pendingMemberEditMoves_();assert.equal(p.length,1);return {key:p[0].key,r:JSON.parse(p[0].raw)};}
function checkMoved(sh){assert.deepEqual(sh.rows[1],['','Trooper','','','','S1','']);assert.deepEqual(sh.rows[2],['','Sergeant','First',id,10,'S2','custom']);}
// Busy publishers do not cancel a confirmed move or run maintenance inline.
let sh=fixture();busy=true;move(sh);assert.deepEqual(waits,[250]);assert.equal(sh.rows[1][3],id);assert.equal(sh.rows[2][2],'');assert.equal(request().r.phase,'queued');assert(messages[0].includes('queued'));assert.equal(builds.length,0);
assert.throws(()=>ctx.publishAssertSettled_(sh),/confirmed member transfer/);
assert.throws(()=>ctx.cpAssertSlotRow_(sh,2),/confirmed transfer/);
assert.throws(()=>ctx.assertNoPendingRosterRecovery_(sh,'reset'),/confirmed transfer/);
busy=false;ctx.memberTransferSweep();checkMoved(sh);assert.equal(ctx.pendingMemberEditMoves_().length,0);assert.equal(data.PUBLIC_DIRTY,'1');assert.deepEqual(builds,['academy','groups','dashboard']);assert.equal(notices,1);assert(!held);
ctx.memberTransferSweep();checkMoved(sh);assert.equal(notices,1,'completed transfer does not replay');
// Available lock: finish the row now, defer audit/promotion/HTTP and expensive views.
sh=fixture();move(sh);checkMoved(sh);assert.equal(builds.length,0);assert.equal(notices,0);assert.equal(request().r.phase,'moved');assert(messages[0].includes('complete'));ctx.memberTransferSweep();assert.equal(notices,1);
sh=fixture();move(sh);sh.rows[2][2]='Edited after completed move';sh.rows[0][6]='New notes heading';ctx.memberTransferSweep();assert.equal(ctx.pendingMemberEditMoves_().length,0);assert.equal(sh.rows[2][2],'Edited after completed move','terminal checkpoint never recopies over later edits');
sh=fixture();lockHook=()=>{held=true;ctx.processMemberEditMoves_();held=false;};move(sh);checkMoved(sh);assert.equal(ctx.pendingMemberEditMoves_().length,0);assert(messages[0].includes('complete'),'worker winning the brief lock race is success, not a stale replay');ctx.flushMemberTransferNotifications_();
// A cancelled dialog restores the prior ID without overwriting a newer edit.
sh=fixture();move(sh,()=>false,other);assert.equal(sh.rows[2][3],other);assert.equal(ctx.pendingMemberEditMoves_().length,0);
sh=fixture();move(sh,()=>{sh.rows[2][3]='newer';return false;});assert.equal(sh.rows[2][3],'newer');
// Exact consent snapshots reject destination edits, rank/identity and layout changes.
for(const change of [s=>s.rows[2][6]='new notes',s=>s.rows[1][2]='Renamed',s=>s.rows[1][1]='Chief',s=>s.rows[2][1]='Chief',s=>s.rows[0][6]='Changed header',s=>{columns.discord=5;},s=>s.rows[3][3]=id]){
 sh=fixture();busy=true;move(sh);change(sh);busy=false;ctx.memberTransferSweep();assert.equal(sh.rows[1][2],sh.rows[1][2]==='Renamed'?'Renamed':'First');assert.equal(sh.rows[2][2],'');assert.equal(ctx.pendingMemberEditMoves_().length,1);assert(logs.length);assert.equal(builds.length,0);
}
sh=fixture();assert.throws(()=>move(sh,()=>{sh.rows[2][6]='edited during consent';return true;}),/Destination fields changed/);assert.equal(sh.rows[2][6],'edited during consent');assert.equal(sh.rows[1][2],'First');
sh=fixture();assert.throws(()=>move(sh,()=>{sh.rows[1][2]='Renamed during consent';return true;}),/source or destination changed/);assert.equal(sh.rows[1][2],'Renamed during consent');
// Clearing or replacing an unstarted paste cancels only its request, even after header edits.
for(const replacement of ['',other]){sh=fixture();busy=true;move(sh);sh.rows[2][3]=replacement;sh.rows[0][6]='New label';busy=false;ctx.memberTransferSweep();assert.equal(sh.rows[1][2],'First');assert.equal(sh.rows[2][3],replacement);assert.equal(ctx.pendingMemberEditMoves_().length,0);}
// Failed durable consent write/oversized destination cannot copy or clear a source.
sh=fixture();fault={kind:'request:queued',after:false};assert.throws(()=>move(sh),/interrupted/);assert.equal(sh.rows[1][2],'First');assert.equal(ctx.pendingMemberEditMoves_().length,0);
sh=fixture();sh.rows[2][6]='x'.repeat(9000);assert.throws(()=>move(sh),/too large/);assert.equal(sh.rows[1][2],'First');assert.equal(ctx.pendingMemberEditMoves_().length,0);
// Crash boundaries: request phases, underlying journal copies/clears and final acknowledgement.
for(const kind of ['request:queued','request:started','copy:3','copy:7','clear:3','clear:7','request:moved'])for(const after of [false,true]){
 sh=fixture();fault={kind,after};assert.throws(()=>move(sh),/interrupted/);if(!ctx.pendingMemberEditMoves_().length)move(sh);ctx.memberTransferSweep();checkMoved(sh);assert.equal(ctx.pendingMemberEditMoves_().length,0);assert.equal(ctx.memberMoveJournal_(sh),null);assert(!held);
}
for(const after of [false,true]){sh=fixture();move(sh);fault={kind:'request:delete',after};ctx.memberTransferSweep();ctx.memberTransferSweep();checkMoved(sh);assert.equal(ctx.pendingMemberEditMoves_().length,0);}
sh=fixture();move(sh);ctx.promoRecord_=actualPromoRecord;ctx.promoIsPromotion_=()=>true;ctx.renderPromotions_=()=>{};ctx.logWarn_=()=>{};fault={kind:'request:delete',after:false};ctx.memberTransferSweep();ctx.memberTransferSweep();const promotionLists=Object.values(data).filter(v=>String(v).startsWith('[{')).map(v=>JSON.parse(v));assert.equal(promotionLists.length,1);assert.equal(promotionLists[0].length,1,'acknowledgement failure cannot double-record promotion');ctx.promoRecord_=()=>{};
// Unrelated interrupted assignments and signup approvals cannot be overwritten.
for(const type of ['assignment','signup']){sh=fixture();busy=true;move(sh);busy=false;const assign=ctx.memberAssignmentJournal_,signup=ctx.pendingSignupApprovals_;if(type==='assignment')ctx.memberAssignmentJournal_=()=>({});else ctx.pendingSignupApprovals_=()=>[{journal:{book:'internal',rosterSheet:10,slotRow:3}}];ctx.memberTransferSweep();assert.equal(sh.rows[2][2],'');assert.equal(ctx.pendingMemberEditMoves_().length,1);ctx.memberAssignmentJournal_=assign;ctx.pendingSignupApprovals_=signup;}
// Later overlapping requests cannot deadlock an older confirmed request.
sh=fixture();const older=ctx.prepareMemberEditMove_(sh,2,3,id);data['RE_EDIT_MOVE:001']=JSON.stringify(older);sh.rows[3][3]=id;const later=ctx.prepareMemberEditMove_(sh,2,4,id);data['RE_EDIT_MOVE:002']=JSON.stringify(later);sh.rows[3][3]='';held=true;assert.equal(ctx.applyMemberEditMove_(sh,'RE_EDIT_MOVE:001',older),true);held=false;checkMoved(sh);
// Worker yields before the next maintenance job when a transfer arrives mid-build.
sh=fixture();ctx.deferWork_('academy');ctx.deferWork_('groups');const build=ctx.buildAcademySheets_;ctx.buildAcademySheets_=()=>{builds.push('academy');ctx.queueMemberEditMove_(ctx.prepareMemberEditMove_(sh,2,3,id));};ctx.memberTransferSweep();assert.deepEqual(builds,['academy']);assert(data['RE_DEFER_JOB:groups']);ctx.buildAcademySheets_=build;
// Installed edit scheduling carries internal-only transfers; never moves before consent.
sh=fixture();ctx.memberTransferEdited({range:sh.getRange(3,4)});assert.equal(notices,1);assert.equal(sh.rows[1][2],'First');ctx.memberTransferEdited({range:sh.getRange(3,3)});assert.equal(notices,1);
sh=fixture();ctx.checkForMemberMove(sh,sh.getRange(3,4,2,1),id,()=>{throw Error('bulk edit prompted');},()=>{});assert.equal(ctx.pendingMemberEditMoves_().length,0);
console.log('Transfers: brief busy-lock wait, exact consent, auto retry, internal-only workers, background views, SLOT preservation, conflicts, cancellation, recovery faults and UI/network lock boundaries passed');
