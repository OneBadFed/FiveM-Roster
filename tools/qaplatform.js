// A new cell-oriented service double for the shared platform scenarios; live behavior remains a separate run.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
class Grid {
 constructor(name){this.name=name;this.id=name;this.width=26;this.rows=Array.from({length:100},()=>Array.from({length:26},()=>({value:'',bg:'#ffffff',height:21})));this.rules=[];this.merges=[];}
 getName(){return this.name}setName(v){this.name=v;return this}getSheetId(){return this.id}
 getMaxRows(){return this.rows.length}getMaxColumns(){return this.width}
 getLastRow(){let end=0;this.rows.forEach((r,i)=>{if(r.some(c=>c.value!==''))end=i+1});return end}
 getLastColumn(){let end=0;this.rows.forEach(r=>r.forEach((c,i)=>{if(c.value!=='')end=Math.max(end,i+1)}));return end}
 getRange(r,c,n=1,w=1){return new Cells(this,r,c,n,w)}
 insertRowsBefore(r,n){this.rows.splice(r-1,0,...Array.from({length:n},()=>Array.from({length:this.width},()=>({value:'',bg:'#ffffff',height:21}))));}
 insertRowsAfter(r,n){this.insertRowsBefore(r+1,n)}deleteRows(r,n){this.rows.splice(r-1,n)}
 insertRowAfter(r){this.insertRowsAfter(r,1)}insertColumnsAfter(c,n){this.width+=n;this.rows.forEach(r=>r.splice(c,0,...Array.from({length:n},()=>({value:'',bg:'#ffffff',height:21}))));}
 setRowHeights(r,n,height){for(let i=0;i<n;i++)this.rows[r+i-1].forEach(c=>c.height=height)}setRowHeight(r,h){this.setRowHeights(r,1,h)}getRowHeight(r){return this.rows[r-1][0].height}
 setConditionalFormatRules(r){this.rules=r}getConditionalFormatRules(){return this.rules}
 autoResizeRows(){}setFrozenRows(){}setHiddenGridlines(){}setColumnWidths(){}setColumnWidth(){}showColumns(){}hideColumns(){}
}
class Cells {
 constructor(s,r,c,n,w){Object.assign(this,{s,r,c,n,w})}
 each(fn){for(let i=0;i<this.n;i++)for(let j=0;j<this.w;j++)fn(this.s.rows[this.r+i-1][this.c+j-1],i,j);return this}
 matrix(key,convert=v=>v){return Array.from({length:this.n},(_,i)=>Array.from({length:this.w},(_,j)=>convert(this.s.rows[this.r+i-1][this.c+j-1][key])))}
 getValues(){return this.matrix('value')}getDisplayValues(){return this.matrix('value',String)}getDisplayValue(){return this.getDisplayValues()[0][0]}
 getBackgrounds(){return this.matrix('bg')}setValues(rows){return this.each((cell,i,j)=>cell.value=rows[i][j])}setValue(v){return this.setValues([[v]])}
 setBackground(v){return this.each(cell=>cell.bg=v)}setBackgrounds(rows){return this.each((cell,i,j)=>cell.bg=rows[i][j])}
 setFontColor(v){return this.each(cell=>cell.color=v)}setFontColors(rows){return this.each((cell,i,j)=>cell.color=rows[i][j])}
 setFontFamily(v){return this.each(cell=>cell.font=v)}getFontFamily(){return this.s.rows[this.r-1][this.c-1].font}
 setFontSize(v){return this.each(cell=>cell.size=v)}setFontWeight(v){return this.each(cell=>cell.weight=v)}setWrap(v){return this.each(cell=>cell.wrap=v)}setVerticalAlignment(v){return this.each(cell=>cell.align=v)}
 setNumberFormat(v){return this.each(cell=>cell.format=v)}getNumberFormat(){return this.s.rows[this.r-1][this.c-1].format}
 setDataValidation(v){return this.each(cell=>cell.validation=v)}getDataValidation(){return this.s.rows[this.r-1][this.c-1].validation}
 getRow(){return this.r}getNumRows(){return this.n}getMergedRanges(){return this.s.merges.filter(m=>m.r<this.r+this.n&&m.r+m.n>this.r)}
 merge(){this.s.merges.push(this);return this}
 copyTo(dest,type){
  const from=this.s.rows[this.r-1].slice(this.c-1,this.c-1+this.w).map(c=>({...c}));
  dest.each((cell,i,j)=>{if(type==='format')for(const key of ['bg','font','color','size','weight','wrap','align','format'])cell[key]=from[j][key];
    if(type==='validation')cell.validation=from[j].validation;});
  if(type==='conditional')this.s.rules.push({getRanges:()=>[dest]});
 }
}
const book={sheets:[],insertSheet(name){const sh=new Grid(name);this.sheets.push(sh);return sh}};
const props={getProperty:()=>null,setProperty(){},deleteProperty(){},getProperties:()=>({})};
const ctx={console,Date,Math,JSON,PropertiesService:{getDocumentProperties:()=>props,getScriptProperties:()=>props},CacheService:{getDocumentCache:()=>({remove(){},get:()=>null,put(){}})},Utilities:{getUuid:()=> 'qa-platform'},
 SpreadsheetApp:{flush(){},CopyPasteType:{PASTE_FORMAT:'format',PASTE_DATA_VALIDATION:'validation',PASTE_CONDITIONAL_FORMATTING:'conditional'},
 newDataValidation:()=>({requireCheckbox(){return this},build(){return {checkbox:true}}}),
 newConditionalFormatRule:()=>({whenNumberGreaterThan(){return this},setBackground(){return this},setRanges(r){this.ranges=r;return this},build(){return{getRanges:()=>this.ranges}}})}};
vm.createContext(ctx);
for(const file of ['RosterConfig.gs','RosterSystem.gs','RosterExtras.gs','RosterControlPanel.gs','RosterQA.gs'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
const result=ctx.qaExecuteCases_(ctx.qaPlatformCases_(book),()=>0,1000),fail=result.filter(r=>r[2]!=='PASS');
for(const row of fail)console.error(row.join(' | '));assert.equal(fail.length,0);
console.log('Fresh platform model: '+result.length+' config, merged banner and multi-width framed growth scenarios passed.');
// Exercise the actual Apps Script runner's lifecycle, including report/service failures.
let released=0,creates=0,createFails=false,reportFails=false,allowed=true,alerts=[];
ctx.LockService={getScriptLock:()=>({tryLock:()=>allowed,releaseLock(){released++}})};
ctx.SpreadsheetApp.getUi=()=>({alert:text=>alerts.push(text)});
ctx.SpreadsheetApp.getActive=()=>({getId:()=> 'production-source'});
ctx.SpreadsheetApp.create=()=>{creates++;if(createFails)throw Error('injected Drive quota');return{getId:()=> 'QA-only',getUrl:()=> 'https://example.invalid/QA',getSheets:()=>[new Grid('Results')]}};
ctx.styleStartupSupportSheet_=()=>{if(reportFails)throw Error('injected formatting failure')};
ctx.qaCases_=()=>[{id:'runner.synthetic',area:'Runner',run(){}}];ctx.qaPlatformCases_=()=>[];
vm.runInContext('DEV_WEBHOOKS_OFF_=false',ctx);
let summary=ctx.qaRun_('core');assert.equal(summary.passed,1);assert.equal(released,1);assert.equal(vm.runInContext('DEV_WEBHOOKS_OFF_',ctx),false);
createFails=true;summary=ctx.qaRun_('core');assert.equal(summary.failed,1);assert.equal(released,2);assert.equal(vm.runInContext('DEV_WEBHOOKS_OFF_',ctx),false);
createFails=false;reportFails=true;summary=ctx.qaRun_('core');assert.equal(summary.failed,1);assert.equal(released,3);assert(alerts.at(-1).includes('Report failure'));
allowed=false;const prior=creates;ctx.qaRun_('core');assert.equal(creates,prior,'busy roster prevents QA workbook creation');
console.log('Fresh platform runner: separate destination, suppression restoration, quota/report failure and busy-lock handling passed.');
