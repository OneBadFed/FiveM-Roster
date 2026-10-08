// A new cell-oriented service double for the shared platform scenarios; live behavior remains a separate run.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
class Grid {
 constructor(name){this.name=name;this.id=name;this.width=26;this.rows=Array.from({length:100},()=>Array.from({length:26},()=>({value:'',bg:'#ffffff',height:21})));this.rules=[];this.merges=[];}
 getName(){return this.name}setName(v){this.name=v;return this}getSheetId(){return this.id}
 clear(){this.rows.forEach(row=>row.forEach(cell=>{const h=cell.height,v=cell.validation;Object.keys(cell).forEach(key=>delete cell[key]);Object.assign(cell,{value:'',bg:'#ffffff',height:h,validation:v})}));return this}
 getFilter(){return this.filter||null}getBandings(){return []}getCharts(){return []}getImages(){return []}
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
 getRichTextValues(){return Array.from({length:this.n},()=>Array(this.w).fill(null))}
 getFormulas(){return this.matrix('formula',v=>v||'')}
 setFormula(v){assert.equal(v,'=10+5','model only supports the fixture arithmetic formula');return this.each(cell=>{cell.value=15;cell.formula=v})}
 getBackgrounds(){return this.matrix('bg')}setValues(rows){return this.each((cell,i,j)=>cell.value=rows[i][j])}setValue(v){return this.setValues([[v]])}
 setBackground(v){return this.each(cell=>cell.bg=v)}setBackgrounds(rows){return this.each((cell,i,j)=>cell.bg=rows[i][j])}
 setFontColor(v){return this.each(cell=>cell.color=v)}setFontColors(rows){return this.each((cell,i,j)=>cell.color=rows[i][j])}
 setFontFamily(v){return this.each(cell=>cell.font=v)}getFontFamily(){return this.s.rows[this.r-1][this.c-1].font}
 setFontSize(v){return this.each(cell=>cell.size=v)}setFontWeight(v){return this.each(cell=>cell.weight=v)}setWrap(v){return this.each(cell=>cell.wrap=v)}setVerticalAlignment(v){return this.each(cell=>cell.align=v)}
 setHorizontalAlignment(v){return this.each(cell=>cell.horizontal=v)}
 setNumberFormat(v){return this.each(cell=>cell.format=v)}getNumberFormat(){return this.s.rows[this.r-1][this.c-1].format}
 setDataValidation(v){return this.each(cell=>cell.validation=v)}getDataValidation(){return this.s.rows[this.r-1][this.c-1].validation}
 getRow(){return this.r}getNumRows(){return this.n}getMergedRanges(){return this.s.merges.filter(m=>m.r<this.r+this.n&&m.r+m.n>this.r)}
 getColumn(){return this.c}getNumColumns(){return this.w}
 breakApart(){this.s.merges=[];return this}
 clearDataValidations(){return this.each(cell=>delete cell.validation)}clearNote(){return this.each(cell=>delete cell.note)}
 merge(){this.s.merges.push(this);return this}
 createFilter(){assert(!this.s.filter,'only one filter per sheet');const sh=this.s;this.s.filter={range:this,remove(){sh.filter=null}};return this.s.filter}
 copyTo(dest,type){
  if(type==='values'){const values=this.getValues();dest.each((cell,i,j)=>{cell.value=values[i][j];cell.formula=''});return;}
  const from=this.s.rows[this.r-1].slice(this.c-1,this.c-1+this.w).map(c=>({...c}));
  dest.each((cell,i,j)=>{if(type==='format')for(const key of ['bg','font','color','size','weight','wrap','align','format'])cell[key]=from[j][key];
    if(type==='validation')cell.validation=from[j].validation;});
  if(type==='conditional')this.s.rules.push({getRanges:()=>[dest]});
 }
}
function newBook(id){let serial=0;return{id,sheets:[],getId(){return id},getUrl(){return 'https://example.invalid/'+id},getSheets(){return this.sheets.slice()},getSheetByName(name){return this.sheets.find(s=>s.getName()===name)||null},setActiveSheet(s){this.active=s},insertSheet(name){assert(!this.getSheetByName(name),'duplicate name');const sh=new Grid(name);sh.id=id+'-'+serial++;this.sheets.push(sh);return sh},deleteSheet(sh){assert(this.sheets.includes(sh));assert(this.sheets.length>1,'cannot delete last sheet');this.sheets.splice(this.sheets.indexOf(sh),1)}}}
const book=newBook('local-platform');
const props={getProperty:()=>null,setProperty(){},deleteProperty(){},getProperties:()=>({})};
const ctx={console,Date,Math,JSON,PropertiesService:{getDocumentProperties:()=>props,getScriptProperties:()=>props},CacheService:{getDocumentCache:()=>({remove(){},get:()=>null,put(){}})},Utilities:{getUuid:()=> 'qa-platform'},
 SpreadsheetApp:{flush(){},CopyPasteType:{PASTE_VALUES:'values',PASTE_FORMAT:'format',PASTE_DATA_VALIDATION:'validation',PASTE_CONDITIONAL_FORMATTING:'conditional'},
 newDataValidation:()=>({requireCheckbox(){return this},build(){return {checkbox:true}}}),
 newConditionalFormatRule:()=>({whenNumberGreaterThan(){return this},setBackground(){return this},setRanges(r){this.ranges=r;return this},build(){return{getRanges:()=>this.ranges}}})}};
vm.createContext(ctx);
for(const file of ['RosterConfig.gs','RosterSystem.gs','RosterExtras.gs','RosterControlPanel.gs','RosterTrust.gs','RosterQA.gs'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
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
let summary=ctx.qaRun_('all');assert.equal(summary.passed,7);assert(summary.reportReady);assert.equal(released,1);assert.equal(vm.runInContext('DEV_WEBHOOKS_OFF_',ctx),false);
assert.equal(source.sheets.length,4,'only the three pre-existing tabs and one results tab remain');const report=lastSandbox;
assert.equal(report.name,'🧪 QA Results');assert(summary.url.endsWith('#gid='+report.id),'same sandbox ID becomes the results link');assert.equal(source.active,report);
assert.equal(report.rows[0][0].value,'Dev / QA — Test results');assert.equal(report.rows[7][0].value,'Case');assert.equal(report.rows[8][0].value,'runner.synthetic');assert.equal(report.rules.length,0);
assert(report.rows.every(row=>row.every(cell=>!cell.validation&&!cell.formula)),'report has no stale fixtures');
assert.equal(report.rows[4][0].value,7);assert.equal(report.rows[4][1].value,0);assert.equal(report.rows[4][3].value,7);
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
