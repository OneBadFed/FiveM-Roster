// Focused Settings regressions; does not access Google services.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('SettingsPanel.html','utf8').replace(/\r\n/g,'\n');
const ctx={Date,KV:{'TEST.KEY':{key:'KEY',help:'schema help'}},LABELS:{'TEST.KEY':'Friendly label'},HELPS:{'TEST.KEY':'Displayed help'}};
vm.createContext(ctx);
function extract(start,end){return html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));}
vm.runInContext(extract('function fmtExample(pat)','function refreshFmtExamples'),ctx);
assert(ctx.fmtExample("'WEEK OF' d MMM").startsWith('WEEK OF '));
assert.equal(ctx.fmtExample("'Today''s date'"),"Today's date");
assert.equal(ctx.fmtExample('yyyyMMdd').length,8);
vm.runInContext(extract('function settingMatches_','function secHits'),ctx);
assert(ctx.settingMatches_('TEST.KEY','displayed help'));
assert(ctx.settingMatches_('TEST.KEY','friendly label'));
ctx.DC_DEFAULTS={event:{fields:[{n:'Name',v:'Value',inline:true}]}};
vm.runInContext(extract('function embIsDefault_','function dcCurMeta'),ctx);
assert(ctx.embIsDefault_('event',ctx.DC_DEFAULTS.event));
assert(!ctx.embIsDefault_('event',{fields:[{n:'Name',v:'Value',inline:true},{n:'',v:'',inline:true}]}),'empty draft field keeps its index');
console.log('Settings: displayed search text, quoted date patterns, and draft embed field indexes passed.');

// Execute the real Add status -> edit color -> Save handlers against the current
// server schema/apply validator. The retired Announce field must never reappear.
const handlers={},elements={};let payload,writes=[],invalidated=0;
ctx.TBL={STATUSES:[]};ctx.KV={};ctx.SAVE_PENDING=false;ctx.BOOT_PENDING=false;
ctx.$=id=>elements[id]||(elements[id]={addEventListener:(type,fn)=>handlers[type]=fn,classList:{},querySelector:()=>({outerHTML:''})});
ctx.renderSection=ctx.refreshDerived=ctx.updateBar=ctx.setSaving_=()=>{};
ctx.tblChanged=()=>true;ctx.kvChanged=()=>false;
ctx.api=(success,failure,name,body)=>{assert.equal(name,'cpApplyConfig');payload=body;};
vm.runInContext(extract("$('content').addEventListener('click',function(e){\n    var u=", "$('content').addEventListener('keydown',function(e){"),ctx);
handlers.click({target:{closest:selector=>selector==='[data-stadd]'?{}:null}});
assert.deepEqual(JSON.parse(JSON.stringify(ctx.TBL.STATUSES)),[['New Status','LEAVE','','']]);
vm.runInContext(extract("$('content').addEventListener('change',function(e){\n    var t=", "$('content').addEventListener('click',function(e){\n    var u="),ctx);
handlers.change({target:{type:'color',dataset:{scol:'1'},value:'#123456',closest:selector=>selector==='[data-sti]'?{dataset:{sti:'0'},closest:()=>null}:null}});
vm.runInContext(extract('function saveAll(){','/* ── rank icons'),ctx);ctx.saveAll();
assert.equal(payload.tables.STATUSES[0][3],'#123456');assert.equal(payload.tables.STATUSES[0].length,4);
ctx.ICONS={statuses:'',x:'',plus:''};ctx.esc=String;ctx.numIn=()=>'';
vm.runInContext(extract('function statusesCard(){','function overridesCard(){'),ctx);
assert(!ctx.statusesCard().includes('Announce'));assert(!ctx.statusesCard().includes('data-sann'));
const config=fs.readFileSync('RosterConfig.gs','utf8'),panel=fs.readFileSync('RosterControlPanel.gs','utf8');
const server={SpreadsheetApp:{flush(){}},parseBlocks_:()=>({}),setTableRows_:(sheet,name,rows)=>writes.push({name,rows}),cfgInvalidate_:()=>invalidated++};
vm.createContext(server);vm.runInContext(config,server);
vm.runInContext(panel.slice(panel.indexOf('const CP_SETTINGS_KV_'),panel.indexOf('/**',panel.indexOf('const CP_SETTINGS_HIDDEN_'))),server);
vm.runInContext(panel.slice(panel.indexOf('function cpApplyConfig_('),panel.indexOf('/** Is a [BLOCK] marker')),server);
server.parseBlocks_=()=>({STATUS_OVERRIDES:{kind:'table',header:['Scope','Match','Ladder'],rows:[]},LEAVE:{kind:'kv',kv:{LEAVE_TYPES:'',RETURN_STATUS:''}}});server.cfgInvalidate_=()=>invalidated++;server.setTableRows_=(sheet,name,rows)=>writes.push({name,rows});
assert(server.cpApplyConfig_({},payload).ok);assert.equal(writes.length,1);assert.equal(invalidated,1);
for(const kind of ['TIER','LEAVE','PROTECTED']){
 assert(server.cpApplyConfig_({},{tables:{STATUSES:[[kind+' example',kind,kind==='TIER'?'0':'','#654321']]}}).ok,kind);
}
const before=writes.length;
assert.throws(()=>server.cpApplyConfig_({},{tables:{STATUSES:[['Extra','LEAVE','','','FALSE']]}}),/limited to 4 columns/);
assert.equal(writes.length,before,'nonempty extra columns still fail before writing');
assert(server.cpApplyConfig_({},{tables:{STATUSES:[]}}).ok,'empty status configuration remains valid');
console.log('Settings status save: actual add/color/save handlers, four-column server validation, all status kinds, empty table and extra-data protection passed.');
