// Welcome snapshot regression: no Google services or live roster changes.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('RosterControlPanel.gs','utf8');
let id=1;
class Book {
  constructor(){this.sheets=[];this.deleted=[];}
  getSheets(){return this.sheets.slice();}
  deleteSheet(sheet){this.deleted.push(sheet.name);this.sheets.splice(this.sheets.indexOf(sheet),1);}
  setActiveSheet(sheet){this.active=sheet;}
  moveActiveSheet(index){this.sheets.splice(this.sheets.indexOf(this.active),1);this.sheets.splice(index-1,0,this.active);}
}
class Sheet {
  constructor(book,name,rows=4,cols=3){this.book=book;this.name=name;this.id=id++;this.rows=rows;this.cols=cols;this.values=[['Internal title','',12],['',5,'']];this.formulas=[['','',''],['','=Private!A1','']];this.heights=Array.from({length:rows},(_,i)=>25+i);this.widths=Array.from({length:cols},(_,i)=>80+i);this.visual={merges:['A1:B1'],fonts:'custom',borders:'custom',validation:'custom',conditional:'custom',images:['logo'],charts:['leaderboard'],hiddenRows:[4],frozenRows:1};book.sheets.push(this);}
  getParent(){return this.book;} getName(){return this.name;} setName(n){this.name=n;return this;}
  getIndex(){return this.book.sheets.indexOf(this)+1;} getSheetId(){return this.id;}
  getMaxRows(){return this.rows;} getMaxColumns(){return this.cols;} getLastRow(){return this.values.length;} getLastColumn(){return this.values[0].length;}
  getRowHeight(r){return this.heights[r-1];} setRowHeight(r,v){this.heights[r-1]=v;}
  setRowHeightsForced(r,n,v){for(let i=0;i<n;i++)this.heights[r+i-1]=v;}
  getColumnWidth(c){return this.widths[c-1];} setColumnWidth(c,v){this.widths[c-1]=v;}
  getDataRange(){return {getFormulas:()=>this.formulas};}
  getRange(r,c,n=1,w=1){const sheet=this,read=key=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>sheet[key][r+i-1]?.[c+j-1]||''));return {sheet,r,c,getValues:()=>read('values'),getRichTextValues:()=>[],getMergedRanges:()=>[],getFormulas:()=>read('formulas'),getNumRows:()=>n,getNumColumns:()=>w,breakApart(){return this;},clear(){sheet.titleBlock=null;},copyTo(range,type){if(type==='VALUES'){if(sheet.failFreeze)throw Error('native snapshot paste failed');range.sheet.values=structuredClone(sheet.values).map(row=>row.map(v=>typeof v==='string'&&v.startsWith('=')?'#NAME?':v));range.sheet.formulas=sheet.values.map(row=>row.map(v=>typeof v==='string'&&v.startsWith('=')?v:''));}else if(type==='NORMAL'){const values=read('values'),formulas=read('formulas');values.forEach((row,i)=>row.forEach((v,j)=>{range.sheet.values[range.r+i-1][range.c+j-1]=v;range.sheet.formulas[range.r+i-1][range.c+j-1]=formulas[i][j]}));}else range.sheet.titleBlock=structuredClone(sheet.titleBlock);},setValues(){throw Error('object/merged cells cannot be serialized in this fixture');},setValue:v=>{sheet.values[r-1][c-1]=v.startsWith("'")?v.slice(1):v;sheet.formulas[r-1][c-1]='';},setFormula:f=>{this.formulas[r-1][c-1]=f;}};}
  isSheetHidden(){return false;} showSheet(){} hideSheet(){}
  clearContents(){this.values=[];this.formulas=[];}
  copyTo(book){const copy=new Sheet(book,'Copy of '+this.name,this.rows,this.cols);for(const key of ['values','formulas','heights','widths','visual'])copy[key]=structuredClone(this[key]);return copy;}
}
const ctx={Date,SpreadsheetApp:{flush(){},CopyPasteType:{PASTE_NORMAL:'NORMAL',PASTE_VALUES:'VALUES'}},writeValuesSafe_:()=>{throw Error('Welcome must not serialize native cells');}};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function publishFreezeSnapshot_('),source.indexOf('/** Prepare a redacted')),ctx);vm.runInContext(source.slice(source.indexOf('function publishWelcomePage_('),source.indexOf('function publishMirrorTab_(')),ctx);
const internal=new Book(),publicBook=new Book(),src=new Sheet(internal,'👋 Welcome Page'),old=new Sheet(publicBook,'Welcome Page',2,2),other=new Sheet(publicBook,'Other');
other.formulas=[["='Welcome Page'!C1"]];src.values[1][0]='=literal text';src.values[0][1]={valueType:'IMAGE',logo:'department badge'};
src.values[1][2]='=formula result';src.formulas[1][2]='="=formula result"';
assert.equal(ctx.publishWelcomePage_(src,old),4);
const mirrored=publicBook.sheets[0];assert.equal(mirrored.name,'Welcome Page');assert.equal(mirrored.rows,4);assert.equal(mirrored.cols,3);
assert.deepEqual(mirrored.visual,src.visual);assert.deepEqual(mirrored.heights,src.heights);assert.deepEqual(mirrored.widths,src.widths);
assert.equal(mirrored.values[0][0],'Internal title','public title override no longer survives');assert.equal(mirrored.values[1][1],5,'cross-sheet formula uses internal computed value');assert.equal(mirrored.values[1][0],'=literal text');assert.deepEqual(mirrored.values[0][1],src.values[0][1],'native in-cell logo survives');assert(mirrored.formulas.every(row=>row.every(f=>!f)),'cross-sheet formulas are frozen');
assert.equal(mirrored.values[1][2],'=formula result','formula result remains literal text without an executable formula');
assert.equal(other.formulas[0][0],"='Welcome Page'!C1");assert.equal(internal.sheets.length,1,'temporary internal sheet cleaned');assert.equal(publicBook.sheets.length,2);
const failedOld=mirrored;src.failFreeze=true;assert.throws(()=>ctx.publishWelcomePage_(src,failedOld),/native snapshot paste failed/);assert(publicBook.sheets.includes(failedOld));assert.equal(internal.sheets.length,1);src.failFreeze=false;
const move=publicBook.moveActiveSheet;publicBook.moveActiveSheet=()=>{throw new Error('swap failed');};
assert.throws(()=>ctx.publishWelcomePage_(src,failedOld),/swap failed/);assert(publicBook.sheets.includes(failedOld));assert.equal(failedOld.name,'Welcome Page');assert.equal(publicBook.sheets.length,2);assert.equal(other.formulas[0][0],"='Welcome Page'!C1");publicBook.moveActiveSheet=move;
assert(source.includes('if (!isWelcome &&'),'Welcome cannot be skipped as self-computing');
const titleInternal=new Book(),titlePublic=new Book(),titleSource=new Sheet(titleInternal,'Welcome Page',30,30),titleDest=new Sheet(titlePublic,'Welcome Page',30,30);
titleSource.titleBlock={text:'Internal title',style:'internal'};titleDest.titleBlock={text:'Public title',style:'public',merges:['F6:W7']};
titleSource.values=Array.from({length:7},()=>Array(30).fill(''));titleSource.formulas=titleSource.values.map(row=>row.map(()=>''));titleSource.values[4][26]='Applications open';
ctx.publishWelcomePage_(titleSource,titleDest);
assert.deepEqual(titlePublic.sheets[0].titleBlock,{text:'Public title',style:'public',merges:['F6:W7']},'F6:W7 public content and style survive');
assert.deepEqual(titlePublic.sheets[0].heights,titleSource.heights,'title row heights still match internal');
assert.equal(titlePublic.sheets[0].values[4][26],'Applications open','AA5 is outside F6:W7 and must be mirrored');
titleSource.values[4][26]='Applications closed';ctx.publishWelcomePage_(titleSource,titlePublic.sheets[0]);assert.equal(titlePublic.sheets[0].values[4][26],'Applications closed','subsequent status change is mirrored');
console.log('Welcome: full grid/style snapshot, all dimensions, source title, computed values, public references and failure preservation passed.');

const system=fs.readFileSync('RosterSystem.gs','utf8'),extras=fs.readFileSync('RosterExtras.gs','utf8');
const statsContext={ROSTER_HEADER_ROW:1,LEADER_MAX_:5,CONFIG:{dashboard:{groups:{First:['Patrol'],Second:['Patrol']}},sectionCategories:[{label:'Patrol'}],tiers:[{name:'Active'},{name:'Inactive'}],tierNames:['Active','Inactive'],leaveTypes:['LOA']},rosterCols_:()=>({rank:1,name:2,hours:3,activity:4}),norm_:s=>String(s).toUpperCase(),isDividerValue_:s=>s==='PATROL SECTION',sectionCategory_:()=>({label:'Patrol'}),isMemberSlot_:s=>s==='Officer',isValidMemberValues_:(r,n)=>r==='Officer'&&!!n,parseHours_:s=>Number(s)};
vm.createContext(statsContext);vm.runInContext(system.slice(system.indexOf('function dashboardStats_('),system.indexOf('function statTagValue_(')),statsContext);
const roster={getLastRow:()=>5,getLastColumn:()=>4,getRange:()=>({getDisplayValues:()=>[['PATROL SECTION','','',''],['Officer','First','6.5','Active'],['Officer','Second','Infinity','LOA'],['Officer','','','']]})};
const stats=statsContext.dashboardStats_(roster);assert.equal(stats.total,2);assert.equal(stats.groups.First,2);assert.equal(stats.groups.Second,0);assert.equal(stats.totalHours,6.5);assert.equal(stats.leaves,1);assert.equal(stats.openSlots,1);
let employees=0,leadership=0;
const demoContext={CONFIG:{sheets:{}},dashboardSkip_:()=>false,fillEmployeeBox_:()=>{employees++;return true;},fillExecBox_:()=>{leadership++;return true;},log_:()=>{}};
vm.createContext(demoContext);vm.runInContext(extras.slice(extras.indexOf('function seedDemoStats_('),extras.indexOf('/** Scan the top',extras.indexOf('function seedDemoStats_('))),demoContext);
demoContext.seedDemoStats_({getSheets:()=>[{getName:()=> 'Welcome Page'}]}, {}, {});assert.equal(employees,1);assert.equal(leadership,1);
console.log('Welcome dashboard: section priority, finite hours, member/leave/open-slot counts and both demo boxes passed.');
