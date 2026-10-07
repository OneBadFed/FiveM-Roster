// Regression checks for stale identities, restores and Settings save races. No Google access.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const panel=fs.readFileSync('RosterControlPanel.gs','utf8'),trust=fs.readFileSync('RosterTrust.gs','utf8'),settings=fs.readFileSync('SettingsPanel.html','utf8');
class Sheet {
  constructor(){this.rows=[['Rank','Name','ID','Status','Hours','Shift','Extra'],['Trooper','First','111','Active','1','DAY','old'],['Trooper','ID-less','','Inactive','2','NIGHT',''],['Trooper','','','','','DAY','']]}
  getLastRow(){return this.rows.length} getMaxRows(){return this.rows.length}
  getRange(r,c,n=1,w=1){assert(Number.isInteger(r)&&r>=1&&r+n-1<=this.rows.length);const sh=this;return {
    getDisplayValues:()=>sh.rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w).map(String)),getDisplayValue:()=>String(sh.rows[r-1][c-1]),
    setValue(v){sh.rows[r-1][c-1]=v;return this},setNumberFormat(){return this}
  }}
  getRangeList(cells){return {setValue:v=>cells.forEach(a=>{const m=a.match(/^([A-Z])(\d+)$/);this.rows[+m[2]-1][m[1].charCodeAt(0)-65]=v})}}
}
const ctx={CONFIG:{rosterStartRow:2},rosterCols_:()=>({rank:1,name:2,discord:3,activity:4,hours:5}),
  columnRegistry_:()=>[{col:6,header:'Shift',klass:'SLOT'},{col:7,header:'Extra',klass:'MEMBER'}],
  cpStatuses_:()=>['Active','Inactive'],isMemberSlot_:r=>r==='Trooper',log_:()=>{}};
vm.createContext(ctx);
vm.runInContext(panel.slice(panel.indexOf('function cpSetStatusBulk_('),panel.indexOf('/** Set the same status on many',panel.indexOf('function cpSetStatusBulk_('))),ctx);
vm.runInContext(trust.slice(trust.indexOf('function cpApplyRestore_('),trust.indexOf('\nfunction ',trust.indexOf('function cpApplyRestore_(')+10)),ctx);
let sh=new Sheet();
let result=ctx.cpSetStatusBulk_(sh,[4,2,2,3,2.5],'Inactive',['gone','111','111','','']);
assert.equal(result.count,2);assert.equal(result.skipped.length,2);assert.equal(sh.rows[3][3],'','empty slot not updated');
assert.throws(()=>ctx.cpSetStatusBulk_(sh,[2,3],'Active',['111']),/identities are incomplete/);
const snap=(row,name,id,extra)=>['snapshot','date',row,name,id,'Active','8','Trooper',JSON.stringify(extra||{})];
sh=new Sheet();sh.rows[2][2]='111';assert.equal(ctx.cpSetStatusBulk_(sh,[2],'Inactive',['111']).count,0,'ambiguous duplicate IDs skipped');
assert.equal(ctx.cpApplyRestore_(sh,[snap(2,'Wrong','111')]),0,'duplicate IDs cannot pick an arbitrary restore target');
sh=new Sheet();
assert.equal(ctx.cpApplyRestore_(sh,[snap(3,'Old member','999'),snap(99,'Gone','888'),snap(2.5,'Bad','777')]),0,'occupied ID-less and invalid rows skipped');
assert.equal(sh.rows[2][1],'ID-less');
assert.equal(ctx.cpApplyRestore_(sh,[snap(4,'First restored','111',{SHIFT:'WRONG',EXTRA:'restored'})]),1,'identity relocates to current row');
assert.equal(sh.rows[1][1],'First restored');assert.equal(sh.rows[1][5],'DAY','SLOT fields stay intact');assert.equal(sh.rows[1][6],'restored');
assert.equal(ctx.cpApplyRestore_(sh,[snap(4,'New','999'),snap(3,'New again','999')]),2);
assert.equal(sh.rows[3][1],'New again','newly restored ID tracked for remaining rows');assert.equal(sh.rows[2][1],'ID-less');
// Settings editor is frozen only during the request, including refusal/failure paths.
const classes=new Set(['show']);const classList={contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k)};
const nodes={};for(const id of ['savepill','content','nav','q','reloadBtn','discardBtn','saveBtn','sptxt','savetxt'])nodes[id]={classList,disabled:false,setAttribute(){},querySelector:()=>({outerHTML:''})};
const requests=[],timers=[];
const ui={$:id=>nodes[id],KV:{'SYSTEM.NAME':{block:'SYSTEM',key:'NAME',value:'demo'}},TBL:{},kvChanged:()=>true,tblChanged:()=>false,
  BOOT_PENDING:false,closeDD:()=>{},api:(ok,fail)=>requests.push({ok,fail}),setTimeout:f=>timers.push(f),renderIssues:()=>{},toast:()=>{},updateBar:()=>{},onError:()=>{},fromData:()=>{},Date};
vm.createContext(ui);
vm.runInContext(settings.slice(settings.indexOf('  var SAVE_PENDING='),settings.indexOf('  /* ── rank icons (custom section:')),ui);
ui.saveAll();ui.saveAll();assert.equal(requests.length,1);assert(nodes.content.inert&&nodes.nav.inert&&nodes.discardBtn.disabled);
requests[0].ok({ok:false,problems:[]});assert(!nodes.content.inert&&!nodes.saveBtn.disabled);
ui.saveAll();requests[1].fail(new Error('offline'));assert(!ui.SAVE_PENDING&&!nodes.reloadBtn.disabled);
ui.saveAll();requests[2].ok({ok:true,state:{}});assert(!ui.SAVE_PENDING);
classes.delete('saved');classes.add('show');timers[0]();assert(classes.has('show'),'saved timer must not hide newer unsaved edits');
const embeds={TBL:{EMBEDS:[['bad','{"fields":"wrong"}'],['nulls','{"fields":[null,"wrong",{"n":"ok"}]}']]}};
vm.createContext(embeds);
vm.runInContext(settings.slice(settings.indexOf('  function embGet_('),settings.indexOf('  /* The [EMBEDS] table')),embeds);
assert.equal(embeds.embGet_('bad').fields.length,0);assert.equal(embeds.embGet_('nulls').fields.length,1);
const dev=fs.readFileSync('RosterDevQA.gs','utf8');assert(dev.slice(dev.indexOf('function devResetForNewDepartment'),dev.indexOf('function devDepartmentResetPlan_')).includes('getScriptLock()'));
const recover=panel.slice(panel.indexOf('const toPending ='),panel.indexOf('  try {\n    const g =',panel.indexOf('const toPending =')));
assert(!recover.includes('rr = row'),'signup recovery cannot fall back to a stale row');
// Exercise a prompt that stays open while its applicant disappears; no replacement row may be reset.
let vanished=false,held=false,assigned=0,resetWrites=0;
const signupCtx={CONFIG:{sheets:{roster:'Roster'}},SIGNUP_STATUSES_:['Pending'],
  PropertiesService:{getDocumentProperties:()=>({getProperty:()=>null})},
  signupCols_:()=>({status:3,dataStart:2,name:1,discord:2}),norm_:x=>String(x).toUpperCase(),
  cpFindRowById_:()=>-1,rosterOpenSlots_:()=>[{row:4,rank:'Trooper',unit:'S-04'}],
  signupResolveRow_:()=>{if(vanished)throw new Error('applicant gone');return 2},
  approveSignup_:()=>{assert(held,'approval holds writer lock');assigned++;return {name:'Applicant'}},
  LockService:{getScriptLock:()=>({tryLock(){assert(!held);held=true;return true},releaseLock(){held=false}})},
  log_:()=>{},SpreadsheetApp:{getActive:()=>({getSheetByName:()=>({})}),getUi:()=>({ButtonSet:{OK_CANCEL:1,OK:2},Button:{OK:'OK'},
    prompt(){assert(!held,'prompt cannot hold lock');return {getSelectedButton:()=>{vanished=true;return 'CANCEL'},getResponseText:()=>''}},alert(){}})}};
vm.createContext(signupCtx);
const signupStart=panel.indexOf('function approveSignupFromSheet_(');
vm.runInContext(panel.slice(signupStart,panel.indexOf('/* -------------------------------------------------------------------------',signupStart)),signupCtx);
signupCtx.approveSignupFromSheet_({getSheetId:()=>20,getRange:(r,c)=>({getDisplayValue:()=>c===1?'Applicant':'123',setValue:()=>resetWrites++})},2,3,'Approved','Pending');
assert.equal(resetWrites,0);assert(!held);
vanished=false;
signupCtx.SpreadsheetApp.getUi=()=>({ButtonSet:{OK_CANCEL:1,OK:2},Button:{OK:'OK'},prompt(){assert(!held);return {getSelectedButton:()=>'OK',getResponseText:()=>'1'}},alert(){}});
signupCtx.approveSignupFromSheet_({getSheetId:()=>20,getRange:(r,c)=>({getDisplayValue:()=>c===1?'Applicant':'123',setValue:()=>resetWrites++})},2,3,'Approved','Pending');
assert.equal(assigned,1);assert(!held);
const dirty={DC_EVENTS:{LOA:[{id:'a'},{id:'b'}]},SECTION_BY_ID:{loa:{custom:'discord',channel:'LOA'}},
  DC_NOTIFY_TOGGLES:{LOA:[['NOTIFY.APPROVED']]},DC_RESET_KEYS:{LOA:[]},embChanged_:()=>false,kvChanged_:()=>false,kvChanged:k=>k==='NOTIFY.APPROVED'};
vm.createContext(dirty);
vm.runInContext(settings.slice(settings.indexOf('  function embRowsFor_('),settings.indexOf('  function embChanged_(')),dirty);
assert.equal(dirty.embRowsFor_('LOA',[['a','one'],['b','two']]),dirty.embRowsFor_('LOA',[['b','two'],['a','one']]),'embed dirty comparison ignores row order');
vm.runInContext(settings.slice(settings.indexOf('  function secDirty('),settings.indexOf('  function secHits(')),dirty);
assert.equal(dirty.secDirty('loa'),true,'notification toggle edits light their channel dirty dot');
console.log('Hardening: bulk identities/partial results, safe restores, SLOT preservation, save races, malformed embeds and reset lock passed.');
