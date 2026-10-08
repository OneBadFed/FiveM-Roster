// A new cell-oriented service double for the shared platform scenarios; live behavior remains a separate run.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
class Grid {
 constructor(name){this.name=name;this.id=name;this.width=26;this.rows=Array.from({length:100},()=>Array.from({length:26},()=>({value:'',bg:'#ffffff',height:21})));this.rules=[];this.merges=[];}
 getName(){return this.name}setName(v){this.name=v;return this}getSheetId(){return this.id}
 clear(){this.rows.forEach(row=>row.forEach(cell=>{const h=cell.height,v=cell.validation;Object.keys(cell).forEach(key=>delete cell[key]);Object.assign(cell,{value:'',bg:'#ffffff',height:h,validation:v})}));return this}
 getFilter(){return this.filter||null}getBandings(){return []}getCharts(){return []}getImages(){return []}
 appendRow(row){const at=this.getLastRow()+1;if(at>this.getMaxRows())this.insertRowsAfter(this.getMaxRows(),1);this.getRange(at,1,1,row.length).setValues([row]);return this}
 getParent(){return this.book}hideSheet(){return this}clearContents(){this.rows.forEach(row=>row.forEach(cell=>{cell.value='';cell.formula=''}));return this}
 setFrozenColumns(){}showRows(){}deleteColumns(c,n){this.rows.forEach(row=>row.splice(c-1,n));this.width-=n}
 getMaxRows(){return this.rows.length}getMaxColumns(){return this.width}
 getLastRow(){let end=0;this.rows.forEach((r,i)=>{if(r.some(c=>c.value!==''))end=i+1});return end}
 getLastColumn(){let end=0;this.rows.forEach(r=>r.forEach((c,i)=>{if(c.value!=='')end=Math.max(end,i+1)}));return end}
 getRange(r,c,n=1,w=1){return new Cells(this,r,c,n,w)}
 insertRowsBefore(r,n){this.rows.splice(r-1,0,...Array.from({length:n},()=>Array.from({length:this.width},()=>({value:'',bg:'#ffffff',height:21}))));}
 insertRowsAfter(r,n){this.insertRowsBefore(r+1,n)}deleteRows(r,n){this.rows.splice(r-1,n)}
 insertRowAfter(r){this.insertRowsAfter(r,1)}insertColumnsAfter(c,n){this.width+=n;this.rows.forEach(r=>r.splice(c,0,...Array.from({length:n},()=>({value:'',bg:'#ffffff',height:21}))));}
 setRowHeights(r,n,height){for(let i=0;i<n;i++)this.rows[r+i-1].forEach(c=>c.height=height)}setRowHeight(r,h){this.setRowHeights(r,1,h)}getRowHeight(r){return this.rows[r-1][0].height}
 setConditionalFormatRules(r){this.rules=r}getConditionalFormatRules(){return this.rules}
 autoResizeRows(){}setFrozenRows(n){this.frozenRows=n}setHiddenGridlines(v){this.hiddenGridlines=v}
 setColumnWidths(){}setColumnWidth(c,w){this.columnWidths=this.columnWidths||{};this.columnWidths[c]=w}
 showColumns(){}hideColumns(c,n){this.hiddenColumns=[c,n]}setTabColor(c){this.tabColor=c}
}
class Cells {
 constructor(s,r,c,n,w){Object.assign(this,{s,r,c,n,w})}
 each(fn){for(let i=0;i<this.n;i++)for(let j=0;j<this.w;j++)fn(this.s.rows[this.r+i-1][this.c+j-1],i,j);return this}
 matrix(key,convert=v=>v){return Array.from({length:this.n},(_,i)=>Array.from({length:this.w},(_,j)=>convert(this.s.rows[this.r+i-1][this.c+j-1][key])))}
 getValues(){return this.matrix('value')}getDisplayValues(){return this.matrix('value',String)}getDisplayValue(){return this.getDisplayValues()[0][0]}
 getRichTextValues(){return this.matrix('rich',v=>v||null)}
 getFormulas(){return this.matrix('formula',v=>v||'')}
 setFormula(v){assert(['=10+5','="=literal result"'].includes(v),'model only supports fixture formulas');return this.each(cell=>{cell.value=v==='=10+5'?15:'=literal result';cell.formula=v})}
 getBackgrounds(){return this.matrix('bg')}setValues(rows){return this.each((cell,i,j)=>cell.value=rows[i][j])}
 setValue(v){return this.each(cell=>{cell.value=typeof v==='string'&&v.startsWith("'")?v.slice(1):v;cell.formula='';delete cell.rich})}
 setRichTextValues(values){return this.each((cell,i,j)=>{const text=values[i][j].getText();cell.value=text.startsWith('=')?'#NAME?':text;cell.formula=text.startsWith('=')?text:'';cell.rich=values[i][j]})}
 setRichTextValue(value){return this.setRichTextValues([[value]])}
 setBackground(v){return this.each(cell=>cell.bg=v)}setBackgrounds(rows){return this.each((cell,i,j)=>cell.bg=rows[i][j])}
 setFontColor(v){return this.each(cell=>cell.color=v)}setFontColors(rows){return this.each((cell,i,j)=>cell.color=rows[i][j])}
 setFontFamily(v){return this.each(cell=>cell.font=v)}getFontFamily(){return this.s.rows[this.r-1][this.c-1].font}
 setFontSize(v){return this.each(cell=>cell.size=v)}setFontWeight(v){return this.each(cell=>cell.weight=v)}setWrap(v){return this.each(cell=>cell.wrap=v)}setVerticalAlignment(v){return this.each(cell=>cell.align=v)}
 setHorizontalAlignment(v){return this.each(cell=>cell.horizontal=v)}
 setNumberFormat(v){return this.each(cell=>cell.format=v)}getNumberFormat(){return this.s.rows[this.r-1][this.c-1].format}
 setDataValidation(v){return this.each(cell=>cell.validation=v)}getDataValidation(){return this.s.rows[this.r-1][this.c-1].validation}
 getRow(){return this.r}getNumRows(){return this.n}getMergedRanges(){return this.s.merges.filter(m=>m.r<this.r+this.n&&m.r+m.n>this.r&&m.c<this.c+this.w&&m.c+m.w>this.c)}
 getColumn(){return this.c}getNumColumns(){return this.w}
 breakApart(){this.s.merges=[];return this}
 clearDataValidations(){return this.each(cell=>delete cell.validation)}clearNote(){return this.each(cell=>delete cell.note)}
 merge(){this.s.merges.push(this);return this}
 createFilter(){assert(!this.s.filter,'only one filter per sheet');const sh=this.s;this.s.filter={range:this,criteria:{},getRange(){return this.range},getColumnFilterCriteria(c){return this.criteria[c]||null},setColumnFilterCriteria(c,v){this.criteria[c]=v;return this},remove(){sh.filter=null}};return this.s.filter}
 sort({column,ascending}){const cells=Array.from({length:this.n},(_,i)=>this.s.rows[this.r+i-1].slice(this.c-1,this.c-1+this.w));cells.sort((a,b)=>{const x=a[column-this.c].value,y=b[column-this.c].value;return (x<y?-1:x>y?1:0)*(ascending?1:-1)});cells.forEach((row,i)=>row.forEach((cell,j)=>this.s.rows[this.r+i-1][this.c+j-1]=cell));return this}
 copyTo(dest,type){
  if(type==='values'){const values=this.getValues();dest.each((cell,i,j)=>{const v=values[i][j];cell.value=typeof v==='string'&&v.startsWith('=')?'#NAME?':v;cell.formula=typeof v==='string'&&v.startsWith('=')?v:'';delete cell.rich});return;}
  if(type==='normal'){const cells=Array.from({length:this.n},(_,i)=>this.s.rows[this.r+i-1].slice(this.c-1,this.c-1+this.w).map(cell=>({...cell})));dest.each((cell,i,j)=>{Object.keys(cell).forEach(k=>delete cell[k]);Object.assign(cell,cells[i][j])});return;}
  const from=this.s.rows[this.r-1].slice(this.c-1,this.c-1+this.w).map(c=>({...c}));
  dest.each((cell,i,j)=>{if(type==='format')for(const key of ['bg','font','color','size','weight','wrap','align','format'])cell[key]=from[j][key];
    if(type==='validation')cell.validation=from[j].validation;});
  if(type==='conditional')this.s.rules.push({getRanges:()=>[dest]});
 }
}
function newBook(id){let serial=0;return{id,sheets:[],getId(){return id},getUrl(){return 'https://example.invalid/'+id},getSheets(){return this.sheets.slice()},getSheetByName(name){return this.sheets.find(s=>s.getName()===name)||null},setActiveSheet(s){this.active=s},insertSheet(name){assert(!this.getSheetByName(name),'duplicate name');const sh=new Grid(name);sh.book=this;sh.id=id+'-'+serial++;this.sheets.push(sh);return sh},deleteSheet(sh){assert(this.sheets.includes(sh));assert(this.sheets.length>1,'cannot delete last sheet');this.sheets.splice(this.sheets.indexOf(sh),1)}}}
const book=newBook('local-platform');
const props={getProperty:()=>null,setProperty(){},deleteProperty(){},getProperties:()=>({})};
const ctx={console,Date,Math,JSON,PropertiesService:{getDocumentProperties:()=>props,getScriptProperties:()=>props},CacheService:{getDocumentCache:()=>({remove(){},get:()=>null,put(){}})},Utilities:{getUuid:()=> 'qa-platform'},
 SpreadsheetApp:{flush(){},CopyPasteType:{PASTE_NORMAL:'normal',PASTE_VALUES:'values',PASTE_FORMAT:'format',PASTE_DATA_VALIDATION:'validation',PASTE_CONDITIONAL_FORMATTING:'conditional'},
 newDataValidation:()=>({requireCheckbox(){return this},build(){return {checkbox:true}}}),
 newFilterCriteria:()=>({setHiddenValues(v){this.hidden=v;return this},build(){return{getHiddenValues:()=>this.hidden}}}),
 newConditionalFormatRule:()=>({whenNumberGreaterThan(){return this},setBackground(){return this},setRanges(r){this.ranges=r;return this},build(){return{getRanges:()=>this.ranges}}})}};
vm.createContext(ctx);
for(const file of ['RosterConfig.gs','RosterSystem.gs','RosterExtras.gs','RosterControlPanel.gs','RosterTrust.gs','RosterQA.gs'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
// The old native/rich-text path must reproduce the user's live failure in this model.
const nativeFreeze=ctx.publishFreezeSnapshot_,regressionBook=newBook('literal-regression'),regressionSheet=regressionBook.insertSheet('Sandbox');
ctx.publishFreezeSnapshot_=(src,dest,n,w)=>{const range=src.getRange(1,1,n,w),texts=range.getRichTextValues();range.copyTo(dest.getRange(1,1,n,w),'values');ctx.publishRestoreRichText_(range,dest,texts)};
const oldRun=ctx.qaExecuteCases_(ctx.qaPlatformCases_(regressionBook,regressionSheet).filter(c=>c.id==='platform.publish.native.merged'),()=>0,1000);
assert.equal(oldRun[0][2],'FAIL');assert(oldRun[0][4].includes('#NAME?'),'model reproduces the reported conversion, rather than accepting a false pass');
ctx.publishFreezeSnapshot_=nativeFreeze;
// Native literal restoration retains original rich runs/links; a formula result is frozen.
const literalDest=regressionBook.insertSheet('Literal target'),literalCell=regressionSheet.rows[0][3];
literalCell.rich={getText:()=>'=literal',runs:[{start:0,bold:true,link:'https://example.test'}]};
ctx.publishFreezeSnapshot_(regressionSheet,literalDest,3,5);
assert.equal(literalDest.rows[0][3].value,'=literal');assert.equal(literalDest.rows[0][3].formula||'','');assert.strictEqual(literalDest.rows[0][3].rich,literalCell.rich,'native copy carries rich styling and links without parsing text');
assert.equal(literalDest.rows[1][4].value,'=literal result');assert.equal(literalDest.rows[1][4].formula,'');
// Adjacent literal cells batch together even when rich text is unavailable.
const denseSource=new Grid('Dense text'),denseDest=new Grid('Dense target');denseSource.getRange(1,1,20,10).setValues(Array.from({length:20},()=>Array(10).fill('=literal')));
const copy=Cells.prototype.copyTo;let normalPastes=0;
Cells.prototype.copyTo=function(dest,type){if(type==='normal')normalPastes++;return copy.call(this,dest,type)};
try{ctx.publishFreezeSnapshot_(denseSource,denseDest,20,10)}finally{Cells.prototype.copyTo=copy}
assert.equal(normalPastes,20,'200 adjacent literals require 20 row pastes, not 200 cell writes');assert(denseDest.getRange(1,1,20,10).getValues().every(row=>row.every(v=>v==='=literal')));
console.log('Literal snapshot: old failure reproduced; safe native text/merge/style/link copies, static formula results and row batching passed.');
const result=ctx.qaExecuteCases_(ctx.qaPlatformCases_(book),()=>0,1000),fail=result.filter(r=>r[2]!=='PASS');
for(const row of fail)console.error(row.join(' | '));assert.equal(fail.length,0);
console.log('Fresh platform model: '+result.length+' config, merged banner and multi-width framed growth scenarios passed.');
assert(ctx.publishTabBlocked_('🧪SANDBOX_12345678'));assert(ctx.publishTabBlocked_('🧪 QA Results 2'),'reports cannot be mirrored even if public has a matching tab');
ctx.SpreadsheetApp.getActive=()=>{throw Error('QA edit audit must not read live tabs')};
ctx.auditEdit({range:{getSheet:()=>({getName:()=> '🧪 QA Results'})}});
const fakeConfig=new Grid('🧪SANDBOX_config'),realConfig=new Grid('Department config');
fakeConfig.getRange(1,1).setValue('RE_CONFIG');realConfig.getRange(1,1).setValue('RE_CONFIG');
assert.strictEqual(ctx.findConfigSheet_({getSheetByName:()=>null,getSheets:()=>[fakeConfig,realConfig]}),realConfig,'config rescue scan cannot select the test fixture');
// Exercise the actual Apps Script runner's lifecycle, including report/service failures.
let released=0,creates=0,createFails=false,reportFails=false,allowed=true,alerts=[],returnSource=false;
ctx.LockService={getScriptLock:()=>({tryLock:()=>allowed,releaseLock(){released++}})};
ctx.SpreadsheetApp.getUi=()=>({alert:text=>alerts.push(text)});
const source=newBook('production-source'),original=source.insertSheet('Member Information'),config=source.insertSheet('Config'),unrelated=source.insertSheet('QA Native Snapshot');
original.getRange(1,1).setValue('live member sentinel');config.getRange(1,1).setValue('live config sentinel');unrelated.getRange(1,1).setValue('unrelated sentinel');
const originalState=JSON.stringify([original.rows,config.rows,unrelated.rows]);
const realInsert=source.insertSheet.bind(source);let lastSandbox;
source.insertSheet=name=>{creates++;if(createFails)throw Error('injected sheet quota');if(returnSource)return original;const s=realInsert(name);if(name==='🧪SANDBOX_qa-platf')lastSandbox=s;return s};
ctx.SpreadsheetApp.getActive=()=>source;
ctx.SpreadsheetApp.create=()=>{throw Error('QA cannot create another workbook')};
const realReport=ctx.qaWriteReport_;ctx.qaWriteReport_=(...args)=>{realReport(...args);if(reportFails)throw Error('injected formatting failure')};
ctx.qaCases_=()=>[{id:'runner.synthetic',area:'Runner',run(){}}];const realPlatformCases=ctx.qaPlatformCases_;
vm.runInContext('DEV_WEBHOOKS_OFF_=false',ctx);
const expectedCount=1+realPlatformCases(source).length;
let summary=ctx.qaRun_('all');assert.equal(summary.passed,expectedCount);assert(summary.reportReady);assert.equal(released,1);assert.equal(vm.runInContext('DEV_WEBHOOKS_OFF_',ctx),false);
assert.equal(source.sheets.length,4,'only the three pre-existing tabs and one results tab remain');const report=lastSandbox;
assert.equal(report.name,'🧪 QA Results');assert(summary.url.endsWith('#gid='+report.id),'same sandbox ID becomes the results link');assert.equal(source.active,report);
assert.equal(report.rows[0][0].value,'Dev / QA — Test results');assert.equal(report.rows[7][0].value,'Case');assert.equal(report.rows[8][0].value,'runner.synthetic');assert.equal(report.rules.length,0);
assert(report.rows.every(row=>row.every(cell=>!cell.validation&&!cell.formula)),'report has no stale fixtures');
assert.equal(report.rows[4][0].value,expectedCount);assert.equal(report.rows[4][1].value,0);assert.equal(report.rows[4][3].value,expectedCount);
assert.equal(report.rows[0][0].bg,'#202c3b');assert.equal(report.rows[8][2].bg,'#203e30');assert.equal(report.rows[8][2].color,'#76dda3');
assert.equal(report.rows[8][0].font,'Roboto Mono');assert.equal(report.frozenRows,8);assert(report.hiddenGridlines);assert.deepEqual(report.hiddenColumns,[6,35]);assert.equal(report.columnWidths[5],600);assert.equal(report.filter.range.r,8);
assert(report.rows.at(-1).slice(0,5).every(c=>c.bg==='#191d23'),'bottom padding is dark, not white');
assert.equal(JSON.stringify([original.rows,config.rows,unrelated.rows]),originalState,'live tab values/style never changed');
ctx.qaPlatformCases_=(b,s,owned)=>[{id:'fixture.failure',area:'Runner',run(){s.getRange(1,1,2,2).merge();s.getRange(1,1).setValue('fixture secret');const helper=b.insertSheet('🧪SANDBOX_leftover');owned.push(helper);throw Error('injected scenario failure')}}];
summary=ctx.qaRun_('platform');assert.equal(summary.failed,1);assert.equal(source.sheets.length,5);assert.equal(lastSandbox.name,'🧪 QA Results 2');assert(source.sheets.includes(report),'previous results retained');assert.equal(lastSandbox.rows[8][2].value,'FAIL');assert.equal(lastSandbox.rows[8][2].bg,'#492b31');assert.equal(lastSandbox.rows[4][1].value,1);assert(!JSON.stringify(lastSandbox.rows).includes('fixture secret'));ctx.qaPlatformCases_=realPlatformCases;
const lockBefore=released;
createFails=true;summary=ctx.qaRun_('core');assert.equal(summary.failed,1);assert.equal(released,lockBefore+1);assert.equal(vm.runInContext('DEV_WEBHOOKS_OFF_',ctx),false);
createFails=false;reportFails=true;summary=ctx.qaRun_('core');assert.equal(summary.failed,1);assert(!summary.reportReady);assert.equal(released,lockBefore+2);assert(alerts.at(-1).includes('Report failure'));assert(alerts.at(-1).includes('results could not be completed'));
reportFails=false;returnSource=true;summary=ctx.qaRun_('core');assert.equal(summary.failed,1);assert.equal(summary.url,null);assert.equal(JSON.stringify([original.rows,config.rows,unrelated.rows]),originalState,'reject pre-existing sheet ID before any reset/report writes');returnSource=false;
// No timeout/not-run status or diagnostic text can be disguised as a passing result/formula.
const detailReport=source.insertSheet('QA report model');ctx.qaResetSandbox_(detailReport);
ctx.qaWriteReport_(detailReport,[['timeout','Runner','NOT RUN',0,'Time budget reached'],['bad','Runner','FAIL',12,'=IMPORTDATA("https://example.invalid")']],{mode:'all',started:0,finished:1500,runId:'fake-run'});
assert.equal(detailReport.rows[4][2].value,1);assert.equal(detailReport.rows[4][1].value,1);assert.equal(detailReport.rows[8][2].bg,'#453a25');assert(detailReport.rows[9][4].value.startsWith("'="),'diagnostics cannot create formulas');source.deleteSheet(detailReport);
// Failed helpers are reported, but unrelated roster sheets/previous reports survive cleanup.
const realDelete=source.deleteSheet.bind(source);let leaked;
source.deleteSheet=s=>{if(s===leaked)throw Error('injected helper delete failure');realDelete(s)};
ctx.qaPlatformCases_=(b,s,owned)=>[{id:'helper',area:'Runner',run(){leaked=b.insertSheet('🧪SANDBOX_cleanup');owned.push(leaked)}}];
summary=ctx.qaRun_('platform');assert.equal(summary.failed,1);assert(lastSandbox.rows.some(r=>String(r[0].value).startsWith('runner.cleanup.')));assert(source.sheets.includes(leaked));source.deleteSheet=realDelete;source.deleteSheet(leaked);ctx.qaPlatformCases_=realPlatformCases;
const realSheets=source.getSheets.bind(source);source.getSheets=()=>{throw Error('inventory unavailable')};const releaseBefore=released;summary=ctx.qaRun_('core');assert.equal(summary.failed,1);assert.equal(released,releaseBefore+1);assert.equal(vm.runInContext('DEV_WEBHOOKS_OFF_',ctx),false);source.getSheets=realSheets;
const orphan=source.insertSheet('🧪SANDBOX_qa-platf');orphan.getRange(1,1).setValue('unfinished earlier run');
summary=ctx.qaRun_('core');assert.equal(summary.failed,1);assert.equal(orphan.rows[0][0].value,'unfinished earlier run','sandbox-name collision cannot erase interrupted work');source.deleteSheet(orphan);
allowed=false;const prior=creates;ctx.qaRun_('core');assert.equal(creates,prior,'busy roster prevents sandbox creation');
assert.equal(JSON.stringify([original.rows,config.rows,unrelated.rows]),originalState);
console.log('Fresh platform runner: in-roster sandbox ID reuse, owned-only cleanup, preserved live tabs/older reports, Config-style report, summary/filter, safe diagnostics, suppression restoration and quota/report/inventory/busy failures passed.');

// Exercise the actual support writers and readers, not only the sort/filter helpers.
const supportBook=newBook('support-writers');ctx.SpreadsheetApp.getActive=()=>supportBook;
let documentHeld=false,documentBusy=false,documentReleases=0;
ctx.LockService.getDocumentLock=()=>({hasLock:()=>documentHeld,tryLock(){if(documentBusy)return false;documentHeld=true;return true},releaseLock(){documentHeld=false;documentReleases++}});
ctx.supportSheetLock_(()=>ctx.supportSheetLock_(()=>{}));assert.equal(documentReleases,1);assert(!documentHeld);
documentHeld=true;ctx.supportSheetLock_(()=>{});assert(documentHeld);assert.equal(documentReleases,1);documentHeld=false;
assert.throws(()=>ctx.supportSheetLock_(()=>{throw Error('write failed')}),/write failed/);assert(!documentHeld);
documentBusy=true;let attempted=false;assert.throws(()=>ctx.supportSheetLock_(()=>{attempted=true}),/busy/);assert(!attempted);documentBusy=false;
Object.defineProperty(ctx,'CONFIG',{configurable:true,value:{sheets:{roster:'Roster',audit:'Edit Log',hoursHistory:'_Hours History',coverage:'Leave Coverage',integrity:'Integrity Log',snapshots:'_Snapshots'},roster:{},rosterStartRow:2}});
ctx.cfgSheetName_=(kind,fallback)=>ctx.CONFIG.sheets[kind]||fallback;
ctx.cfg_=()=>({kv:{LIMITS:{SNAPSHOT_KEEP:2}}});ctx.logRowCap_=()=>4;
ctx.Session={getActiveUser:()=>({getEmail:()=> 'qa@example.invalid'})};ctx.auditWho_=()=> 'QA Admin';ctx.auditNotify_=()=>{};
ctx.logInfo_=()=>{};ctx.postSummary_=()=>{};ctx.runAction_=(label,fn)=>fn();ctx.cpWithLock_=fn=>fn();
const audit=supportBook.insertSheet('Edit Log');audit.getRange(1,1,4,9).setValues([['Time','Editor','Sheet','Cell','Old','New','Type','Member','Department'],[new Date('2026-01-01'),'Old','Other','','','','','Old member','Old extra'],[new Date('2026-03-01'),'New','Other','','','','','New member','New extra'],[new Date('2026-02-01'),'Middle','Other','','','','','Middle member','Middle extra']]);
ctx.auditEvent_('action','','Newest','','Newest member');
assert.equal(audit.rows[1][7].value,'Newest member');assert.equal(audit.getLastRow(),4);assert.equal(audit.rows[2][8].value,'New extra','custom fields move with their records');assert.equal(audit.filter.range.w,9);
assert.equal(ctx.cpAuditTail(1)[0].member,'Newest member','panel reads latest top record');
ctx.auditEdit({range:{getSheet:()=>({getName:()=> 'Other'}),getColumn:()=>1,getRow:()=>2,getNumRows:()=>1,getNumColumns:()=>1,getA1Notation:()=> 'A2'},value:'=literal',oldValue:'before'});
assert.equal(audit.getLastRow(),4);assert(audit.rows.slice(1,4).some(row=>row[5].value==="'=literal"),'audit text is escaped before writing');
const sys=supportBook.insertSheet('SYS Log');sys.getRange(1,1,30,8).setValues([['Timestamp','Ver','Sev','Code','Function','Message','Context','Exec'],...Array.from({length:29},(_,i)=>[new Date(2020,0,i+1),'v','INFO','','fixture','Old '+i,'',''])]);
vm.runInContext('CFG_={logging:{maxRows:25,level:"INFO"}}; _sysLogSheet=null; _sysLogUnavailable_=false; _sysLogSeen_.clear();',ctx);
for(let i=0;i<23;i++)ctx.slog_('INFO','','support fixture','Fresh '+i);
assert(sys.getLastRow()<=51);assert(String(sys.rows[1][5].value).startsWith('Fresh'),'SYS latest additions precede all legacy dates');assert(sys.filter);assert.equal(sys.rows[0][0].value,'Timestamp');
const integrity=supportBook.insertSheet('Integrity Log');integrity.getRange(1,1,4,3).setValues([['Time','# Issues','Detail'],[new Date('2020-01-01'),0,'Old'],[new Date('2020-02-01'),1,'Middle'],[new Date('2020-03-01'),2,'Latest prior']]);
ctx.runIntegritySummary_=()=>['Newest issue'];ctx.scanIntegrityCore_();assert.equal(integrity.rows[1][2].value,'Newest issue');assert.equal(integrity.getLastRow(),4);assert(integrity.filter);
const history=supportBook.insertSheet('_Hours History'),longId='1234567890123456789';history.getRange(1,1,4,6).setValues([['WeekOf','DiscordID','Name','Rank','Hours','Status'],[new Date('2026-02-01'),longId,'Legacy date','Officer',2,'Active'],['2026-03-01',longId,'Old March','Officer',3,'Active'],['2026-01-01',longId,'Old January','Officer',1,'Active']]);
ctx.getSheetOrWarn_=()=>({});ctx.readMembers_=()=>[{id:longId,name:'Newest March',rank:'Officer',hours:30,activity:'Active'}];ctx.fmtDate_=v=>v instanceof Date?v.toISOString().slice(0,10):String(v);ctx.captureHoursSnapshot_('2026-03-01');
assert.equal(history.rows[1][2].value,'Newest March');assert.equal(history.getLastRow(),4);assert.equal(history.rows[1][1].value,longId);assert.equal(history.getMaxColumns(),26);assert(history.filter);
ctx.captureHoursSnapshot_('2026-02-01');assert.equal(history.rows[1][2].value,'Newest March','backfilled earlier week stays below the newest period');assert(!history.rows.some(row=>row[2].value==='Legacy date'),'legacy Date week is replaced by matching ISO week');
const snaps=supportBook.insertSheet('_Snapshots');snaps.getRange(1,1,7,9).setValues([['SnapshotId','When','Row','Name','Discord','Status','Hours','Rank','Extra'],...['1700000000000','1600000000000','1750000000000'].flatMap(sid=>[2,3].map(row=>[sid,'custom display',row,'Member '+row,longId,'Active',10,'Officer',JSON.stringify({Custom:row})]))]);
ctx.cpPruneSnapshots_(snaps);assert.equal(snaps.getLastRow(),5);assert(!snaps.rows.some(row=>row[0].value==='1600000000000'),'snapshot prune uses IDs, independent of prior row order');
assert.deepEqual(Array.from(ctx.cpListSnapshots(),s=>s.id),['1750000000000','1700000000000']);
supportBook.insertSheet('Roster');ctx.cpSnapshotRows_=(roster,sid,when)=>[2,3].map(row=>[sid,when,row,'Current '+row,longId,'Active','10','Officer',JSON.stringify({Custom:row})]);ctx.fmtTs_=()=> 'unparseable department timestamp';
const taken=ctx.cpTakeSnapshot();assert.equal(snaps.getLastRow(),5);assert.equal(String(snaps.rows[1][0].value),taken.id);assert(snaps.filter);assert.deepEqual(Array.from(ctx.cpListSnapshots(),s=>s.id),[taken.id,'1750000000000']);assert.equal(snaps.rows[1][8].value,'{"Custom":2}','restore payload survives sorting and complete-batch retention');
let restoredRows;ctx.cpApplyRestore_=(roster,rows)=>{restoredRows=rows;return rows.length};ctx.publishMarkDirty_=()=>{};ctx.publishTableSettled_=()=>{};ctx.deferWork_=()=>{};
assert.equal(ctx.cpRestoreSnapshot(taken.id).restored,2);assert(restoredRows.every(r=>r[0]===taken.id));
const coverage=supportBook.insertSheet('Leave Coverage');ctx.activeLeaves_=()=>[{name:'Earlier request',type:'LOA',submitted:10,start:new Date('2026-10-20'),end:new Date('2026-10-22'),started:false},{name:'Latest request',type:'LOA',submitted:20,start:new Date('2026-10-10'),end:new Date('2026-10-15'),started:true}];
ctx.buildCoverage();assert.equal(coverage.rows[1][0].value,'Latest request');assert.equal(coverage.filter.range.n,3,'coverage summary is outside filter');assert.equal(ctx.supportCoverageEnd_(coverage),3);
coverage.filter.setColumnFilterCriteria(5,{status:'OUT NOW'});ctx.activeLeaves_=()=>[];ctx.buildCoverage();assert.equal(coverage.filter.range.n,2);assert.equal(coverage.rows[2][0].value,'0 member(s) currently out (0 active/upcoming).');assert.equal(coverage.filter.criteria[5].status,'OUT NOW');
const grow=new Grid('Growth');grow.rows=grow.rows.slice(0,2);ctx.ensureSupportRoom_(grow,5,6);assert.equal(grow.getMaxRows(),5);assert.equal(grow.rows[4][0].bg,'#20242a');assert.equal(grow.rows[4][0].font,'Arial');
console.log('Support sheets: real SYS/Edit/Integrity/Hours/Snapshot/Coverage writers, bottom retention, latest panel records, mixed dates, complete restore payloads, custom columns, filter criteria/footer/empty cases, growth style and nested/busy/failure locks passed.');
