// Exercise the live reset cores with in-memory sheets; never connects to Google.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const source = fs.readFileSync('RosterDevQA.gs', 'utf8');
class Sheet {
  constructor(name, id, values) { Object.assign(this, {name, id, values}); this.style = 'original'; }
  getName(){return this.name} getSheetId(){return this.id} getLastRow(){return this.values.length}
  getMaxRows(){return this.values.length} getLastColumn(){return this.values[0].length}
  getDataRange(){return this.getRange(1,1,this.getLastRow(),this.getLastColumn())}
  getRange(r,c,n=1,w=1){ const sh=this; return {
    getDisplayValues:()=>sh.values.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w)),
    clearContent(){for(let i=r-1;i<r-1+n;i++)for(let j=c-1;j<c-1+w;j++)sh.values[i][j]='';return this}, clearNote(){return this}
  }; }
  getRangeList(addresses){ const sh=this; return {clearContent(){addresses.forEach(a=>{const m=a.match(/^([A-Z]+)(\d+)$/);let c=0;for(const ch of m[1])c=c*26+ch.charCodeAt(0)-64;sh.values[+m[2]-1][c-1]=''});return this},clearNote(){return this}}; }
}
const blank = (n,w)=>Array.from({length:n},()=>Array(w).fill(''));
const roster=new Sheet('Custom roster',1,blank(5,30));
roster.values[0][1]='RANK';roster.values[0][2]='NAME';roster.values[0][3]='CALLSIGN';
roster.values[1][1]='Sergeant';roster.values[1][2]='Demo Person';roster.values[1][3]='S-01';roster.values[1][4]='123';roster.values[1][29]='private custom field';
roster.values[2][1]='TROOPERS';roster.values[2][2]='Divider text';
roster.values[3][1]='Trooper';roster.values[3][3]='S-02';
const tracker=new Sheet('Custom LOAs',2,blank(6,19));tracker.values[0][0]='HEADER';tracker.values[1][18]='BORDER';tracker.values[2][0]='key';tracker.values[2][17]='private note';tracker.values[5][0]='BOTTOM';
const forms=new Sheet('Old responses',3,[['Timestamp','Name'],['date','Demo Person']]);
const config=new Sheet('Config',4,[['old','department']]);
const dashboard=new Sheet('Board',5,[['Leadership','Demo Person'],['TEMPLATE LABEL','untouched']]);
const sheets=[roster,tracker,forms,config,dashboard], ss={getSheetByName:n=>sheets.find(s=>s.name===n),getSheets:()=>sheets};
const doc={PUBLIC_ROSTER_ID:'external',RE_PROMOS:'private', 'REICON:rank:0':'image',RE_RUNTIME_MODE:'LIBRARY',RE_LIBRARY_MODE:'1',unrelated:'keep'};
const script={DISCORD_WEBHOOK_URL:'secret',RE_LAST_HOURS_RESET_MS:'old',unrelated:'keep'};
const props=o=>({getProperties:()=>({...o}),deleteProperty:k=>{delete o[k]}});
const settings={ROSTER:'Custom roster',TRACKER:'Custom LOAs',PATROL_LOG:'',SIGNUPS:'',AUDIT:'',HOURS_HISTORY:'',COVERAGE:'',INTEGRITY:'',SNAPSHOTS:'',WELCOME:'Board'};
const writes=[], removed=[];
const ctx={CONFIG:{sheets:{roster:'Custom roster',tracker:'Custom LOAs',form:'Old responses'},rosterStartRow:2,headerRow:1,trackerStartRow:3},
  SYS_LOG_SHEET:'SYS Log',SANDBOX_PREFIX:'sandbox',RESULTS_TAB:'results',
  cfg_:()=>({kv:{SHEETS:settings,ROSTER_LAYOUT:{HEADER_ROW:1,DATA_START_ROW:2}},tables:{COLUMNS:[{Role:'',Match:'EXTRA',Class:'MEMBER'}],RANKS:[]}}),
  BLOCK_SPECS_:{COLUMNS:{cols:['Role','Match','Class']},RANKS:{cols:['Value','Kind']}},
  rosterCols_:()=>({name:3,rank:2,unit:4,discord:5,headerRow:1}),
  isMemberSlot_:v=>['Sergeant','Trooper'].includes(v),columnRegistry_:()=>[{col:3,klass:'MEMBER'},{col:4,klass:'SLOT'},{col:5,klass:'MEMBER'},{col:30,klass:'MEMBER'}],
  framedTable_:()=>({cap:6,width:19}),findConfigSheet_:()=>config,
  PropertiesService:{getDocumentProperties:()=>props(doc),getScriptProperties:()=>props(script)},
  ScriptApp:{getProjectTriggers:()=>['onFormSubmit','RE.publishSweep','recordEdit','unrelatedHandler'].map(name=>({getHandlerFunction:()=>name})),deleteTrigger:t=>removed.push(t.getHandlerFunction())},
  cfgInvalidate_:()=>{},seedConfigTab_:()=>{},setKvValue_:(sh,b,k,v)=>writes.push([b,k,v]),setTableRows_:(sh,n,r)=>writes.push([n,r]),devDeleteSandbox_:()=>{},SpreadsheetApp:{flush:()=>{}},
};
vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('function devDepartmentResetPlan_('),source.indexOf('function devDeleteSandbox_(')),ctx);
const plan=ctx.devDepartmentResetPlan_(ss);
assert.deepEqual(Array.from(plan.rows),[2,4],'only member slots selected; dividers excluded');
assert.equal(plan.tables[0].end,5,'bottom border excluded');
ctx.devApplyDepartmentReset_(ss,plan);
assert.equal(roster.values[1][2],'');assert.equal(roster.values[1][4],'');assert.equal(roster.values[1][29],'','added member columns cleared');
assert.equal(roster.values[1][3],'S-01');assert.equal(roster.values[1][1],'Sergeant');assert.equal(roster.values[2][2],'Divider text');
assert.equal(tracker.values[0][0],'HEADER');assert.equal(tracker.values[5][0],'BOTTOM');assert.equal(tracker.values[2][17],'');
assert.equal(forms.values[0][0],'Timestamp');assert.equal(forms.values[1][0],'');assert.equal(dashboard.values[0][1],'');assert.equal(dashboard.values[1][1],'untouched');
assert.equal(doc.PUBLIC_ROSTER_ID,undefined);assert.equal(doc.RE_PROMOS,undefined);assert.equal(doc['REICON:rank:0'],undefined);assert.equal(doc.unrelated,'keep');assert.equal(script.unrelated,'keep');
assert.equal(doc.RE_RUNTIME_MODE,'LIBRARY');assert.equal(doc.RE_LIBRARY_MODE,'1');assert.equal(script.DISCORD_WEBHOOK_URL,'secret');assert.equal(script.RE_LAST_HOURS_RESET_MS,'old','library reset cannot wipe shared script properties');
assert.deepEqual(removed,['onFormSubmit','RE.publishSweep','recordEdit']);
assert(writes.some(w=>w[0]==='SHEETS'&&w[1]==='ROSTER'&&w[2]==='Custom roster'));assert(writes.some(w=>w[0]==='COLUMNS'&&w[1][0][1]==='EXTRA'));
for(const name of ['STATUSES','STATUS_OVERRIDES','STATUS_RULES','RANKS','SECTION_TAGS','DASHBOARD_GROUPS','EMBEDS'])assert(writes.some(w=>w[0]===name&&Array.isArray(w[1])&&w[1].length===0),name+' must be explicitly empty');
assert.equal(plan.structural.length,1,'only column mappings survive, never ranks');
for(const key of ['LEAVE_TYPES','RETURN_STATUS'])assert(writes.some(w=>w[0]==='LEAVE'&&w[1]===key&&w[2]===''));
assert(sheets.every(s=>s.style==='original'),'reset uses content-only clearing');
ctx.CONFIG.sheets.form='Custom roster';assert.throws(()=>ctx.devDepartmentResetPlan_(ss),/mapped to the roster/,'unsafe aliases rejected before mutations');
assert(source.includes("getResponseText().trim() !== 'RESET DEPARTMENT'"),'typed confirmation required');
console.log('Department reset: custom layouts, member fields, dividers, borders, response headers, credentials, properties and trigger isolation passed.');
// Disabled leave/activity paths must return before touching sheets, including old incoming submissions.
function loadFunction(file,name){const code=fs.readFileSync(file,'utf8'),start=code.indexOf('function '+name+'('),end=code.indexOf('\nfunction ',start+1);vm.runInContext(code.slice(start,end<0?undefined:end),ctx)}
ctx.CONFIG.leaveTypes=[];ctx.statusEngine_=()=>({global:[],overrides:[]});ctx.statusLadderFor_=()=>[];
ctx.computeStatusCore_=()=>{throw Error('unconfigured tiers must not compute a fabricated status')};
for(const name of ['computeStatus_','processDailyLOAs_','checkImmediateLOAStart','syncFormToTracker_'])loadFunction('RosterSystem.gs',name);
loadFunction('RosterControlPanel.gs','cpScheduleLeave_');
assert.equal(ctx.computeStatus_('Trooper',12),null);
assert.equal(ctx.processDailyLOAs_(null,null,null).scanned,0);
assert.equal(ctx.syncFormToTracker_(null,null).length,0);
ctx.checkImmediateLOAStart(null,1);
assert.throws(()=>ctx.cpScheduleLeave_(null,null,{},{}),/Configure at least one LEAVE/);
console.log('Empty configuration: activity stays unchanged; leave import/daily/immediate paths touch no sheets; panel scheduling explains setup requirements.');
