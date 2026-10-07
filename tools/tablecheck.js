/* Execute the real table growth/sort helpers against a Sheets model. */
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const system=fs.readFileSync('RosterSystem.gs','utf8').replace(/\r\n/g,'\n'), panel=fs.readFileSync('RosterControlPanel.gs','utf8').replace(/\r\n/g,'\n');
class Sheet {
 constructor(name,width){this.name=name;this.width=width;this.rows=Array.from({length:20},(_,i)=>({v:Array(width).fill(''),f:Array(width).fill(''),bg:Array(width).fill(i===10?'#111111':'#eeeeee'),style:'row'+i,height:25+i})); for(let r=7;r<11;r++){this.rows[r].bg[0]=this.rows[r].bg[width-1]='#111111';}this.rows[10].style='BORDER';}
 getName(){return this.name} getMaxColumns(){return this.width} getMaxRows(){return this.rows.length} getLastRow(){let n=0;this.rows.forEach((r,i)=>{if(r.v.some(x=>x!==''))n=i+1});return n} getRange(r,c,n=1,w=1){return new Range(this,r,c,n,w)} getRowHeight(r){return this.rows[r-1].height} setRowHeight(r,h){this.rows[r-1].height=h} setRowHeights(r,n,h){for(let i=0;i<n;i++)this.setRowHeight(r+i,h)}
 insertRowsBefore(r,n){const blanks=Array.from({length:n},()=>({v:Array(this.width).fill(''),f:Array(this.width).fill(''),bg:Array(this.width).fill('#ffffff'),style:'NEW',height:21}));this.rows.splice(r-1,0,...blanks)} insertRowsAfter(r,n){this.insertRowsBefore(r+1,n)} moveRows(g,target){const row=this.rows.splice(g.r-1,1)[0];this.rows.splice(target-1,0,row)}
}
class Range {
 constructor(s,r,c,n,w){Object.assign(this,{s,r,c,n,w})} read(k){return this.s.rows.slice(this.r-1,this.r-1+this.n).map(r=>r[k].slice(this.c-1,this.c-1+this.w))} getValues(){return this.read('v')} getDisplayValues(){return this.getValues().map(r=>r.map(String))} getBackgrounds(){return this.read('bg')} getFormulas(){return this.read('f')} setNumberFormat(){return this} setFormulas(a){a.forEach((r,i)=>r.forEach((v,j)=>{this.s.rows[this.r+i-1].f[this.c+j-1]=v}));return this} clearContent(){for(let i=0;i<this.n;i++){const row=this.s.rows[this.r+i-1];for(let c=this.c-1;c<this.c-1+this.w;c++){row.v[c]='';row.f[c]=''}}return this}
 copyTo(d,type){for(let i=0;i<d.n;i++){const src=this.s.rows[this.r-1],dst=d.s.rows[d.r+i-1];dst.bg=src.bg.slice();dst.style=src.style;dst.validation='copied';dst.conditional='copied'}}
}
const cols=s=>({width:s.width,labelRow:6,headerRow:6,dataStart:8,key:1,mark:1,name:2,discord:3,status:4,start:5,end:6,timestamp:5});
const ctx={Date,Math,Array,Object,String,Number,Set,CONFIG:{sheets:{tracker:'LOA',patrolLog:'Patrol',signups:'Signups',signupForm:''},trackerStartRow:8,patrolStartRow:8,limits:{}},SpreadsheetApp:{CopyPasteType:{PASTE_FORMAT:1,PASTE_DATA_VALIDATION:2,PASTE_CONDITIONAL_FORMATTING:3}},trackerCols_:cols,patrolLogCols_:cols,signupCols_:cols,norm_:x=>String(x).trim().toUpperCase(),healUnstyledRows_:()=>0,logWarn_:(where,e)=>{throw Error(where+': '+e)},log_:()=>{},SIGNUP_STATUSES_:['Pending','Approved','Processed','Flagged'],writeValuesSafe_:(s,r,c,rows)=>{rows.forEach((v,i)=>{v.forEach((x,j)=>{const row=s.rows[r+i-1];row.v[c+j-1]=x;row.f[c+j-1]=typeof x==='string'&&x.startsWith('=')?x:''})})},leaveFormulaStrings_:()=>({}),publishMarkDirty_:()=>{}};
vm.createContext(ctx);
ctx.isValidId_=id=>/^\d{17,19}$/.test(String(id));
vm.runInContext("const PATROL_CREDIT_TX_='RE_CREDIT_V1:';"+system.slice(system.indexOf('function patrolCreditTransaction_('),system.indexOf('/** Resume only',system.indexOf('function patrolCreditTransaction_('))),ctx);
vm.runInContext(system.slice(system.indexOf('function framedTable_('),system.indexOf('function tidyTailRows_(')),ctx);
vm.runInContext(system.slice(system.indexOf('function tidyTailRows_('),system.indexOf('/* ======================================================================',system.indexOf('function sortTracker_('))),ctx);
vm.runInContext(system.slice(system.indexOf('function sortPatrolLog_('),system.indexOf('/** Nightly/refresh',system.indexOf('function sortPatrolLog_('))),ctx);
vm.runInContext(panel.slice(panel.indexOf('function signupStatusOrder_('),panel.indexOf('/**\n * Read the signup tab',panel.indexOf('function sortSignups_('))),ctx);
function seat(s,row,name,status,ts){const r=s.rows[row-1];r.v[0]=s.name==='LOA'?'KEY|'+name+'|'+ts:s.name==='Signups'?'SIGNUP|'+name+'|'+ts:'1|'+name+'|'+ts;r.v[1]=name;r.v[2]='1234567890123456789';r.v[3]=status;r.v[4]=new Date(ts);r.f[6]='=CUSTOM()';r.style=name;r.height=ts%10+30;}
const repeated=new Sheet('Signups',19);seat(repeated,8,'new','Pending',1700000000003);seat(repeated,9,'old','Pending',1700000000001);repeated.rows[7].v[4]=new Date(1);repeated.rows[8].v[4]=new Date(9);let formReads=0;ctx.CONFIG.sheets.signupForm='Form';ctx.SpreadsheetApp.getActive=()=>{formReads++;throw Error('unnecessary form read')};ctx.sortSignups_(repeated);assert.equal(repeated.rows[7].v[1],'old');assert.equal(formReads,0,'key timestamps avoid rescanning the source form');ctx.CONFIG.sheets.signupForm='';
const unfinished=new Sheet('Patrol',19);unfinished.rows[7].v[0]='||1700000000001|IMPORT_PENDING:test';unfinished.rows[8].v[0]='RE_CREDIT_V1:'+JSON.stringify({version:1,book:'internal',sheet:10,final:'||1700000000002',changes:[{id:'111111111111111111',before:10,after:13}]});ctx.sortPatrolLog_(unfinished);assert(unfinished.rows.some(r=>String(r.v[0]).includes('IMPORT_PENDING:test')));assert(unfinished.rows.some(r=>String(r.v[0]).startsWith('RE_CREDIT_V1:')),'sorting retains pending journal even without visible member fields');
for(const [name,fn,first]of [['LOA','sortTracker_','Pending'],['Patrol','sortPatrolLog_','Flagged'],['Signups','sortSignups_','Flagged']]){
 const s=new Sheet(name,19);assert.equal(ctx.framedTable_(s,8).cap,11,'border detected before unused grid rows');
 seat(s,8,'new','Approved',1700000000003);seat(s,9,'middle',first,1700000000002);seat(s,10,'old',first,1700000000001);
 const sort=()=>name==='LOA'?ctx[fn](null,s):ctx[fn](s);sort();assert.deepEqual(s.rows.slice(7,10).map(r=>r.v[1]),['old','middle','new']);assert.deepEqual(s.rows.slice(7,10).map(r=>r.style),['old','middle','new']);assert.equal(s.rows[7].f[6],'=CUSTOM()');assert.equal(s.rows[10].style,'BORDER');sort();assert.equal(s.rows[10].style,'BORDER');
 ctx.ensureRoomAboveCap_(s,11);assert.equal(ctx.framedTable_(s,8).cap,12);assert.equal(s.rows[10].style,'new');assert.equal(s.rows[10].validation,'copied');assert.equal(s.rows[10].conditional,'copied');assert.equal(s.rows[10].height,s.rows[9].height);assert.equal(s.rows[11].style,'BORDER');seat(s,11,'extra',first,1700000000004);sort();assert.equal(s.rows[11].style,'BORDER');assert.equal(s.rows[10].v[1],'new');console.log(name+': border, added columns, growth, row styling, oldest-first grouping, formulas and repeat sort passed');
}

// Public style transfer must cross workbooks only after all private cell content is removed.
Range.prototype.breakApart=function(){return this};Range.prototype.clearNote=function(){return this};Range.prototype.getMergedRanges=()=>[];
Range.prototype.getA1Notation=function(){return 'A1'};
const originalCopy=Range.prototype.copyTo;
Range.prototype.copyTo=function(d,type){for(let i=0;i<d.n;i++){const from=new Range(this.s,this.r+Math.min(i,this.n-1),this.c,1,this.w);originalCopy.call(from,new Range(d.s,d.r+i,d.c,1,d.w),type)}};
Sheet.prototype.getParent=function(){return this.parent};Sheet.prototype.setName=function(n){this.name=n};Sheet.prototype.clearContents=function(){this.rows.forEach(r=>{r.v.fill('');r.f.fill('')})};Sheet.prototype.getDeveloperMetadata=()=>[];Sheet.prototype.getConditionalFormatRules=()=>[];Sheet.prototype.setConditionalFormatRules=function(){};Sheet.prototype.getColumnWidth=()=>90;Sheet.prototype.setColumnWidth=function(){};
Sheet.prototype.insertColumnsAfter=function(at,n){this.width+=n;this.rows.forEach(r=>{for(const k of ['v','f','bg'])r[k].push(...Array(n).fill(''))})};Sheet.prototype.deleteColumns=function(at,n){this.width-=n;this.rows.forEach(r=>{for(const k of ['v','f','bg'])r[k].splice(at-1,n)})};Sheet.prototype.deleteRows=function(at,n){this.rows.splice(at-1,n)};
const owner={removed:[],deleteSheet(s){this.removed.push(s)}},publicBook={removed:[],deleteSheet(s){this.removed.push(s)}};
Sheet.prototype.copyTo=function(book){if(book===publicBook)assert(this.rows.every(r=>r.v.every(v=>v==='')),'cross-file carrier has no private values');const s=new Sheet(this.name,this.width);s.rows=this.rows.map(r=>({...r,v:r.v.slice(),f:r.f.slice(),bg:r.bg.slice()}));s.parent=book;return s};
ctx.SpreadsheetApp.flush=()=>{};ctx.publishReadCells_=g=>g.getValues();ctx.publishHeaderRow_=()=>6;ctx.publishSensitiveHeader_=h=>h==='PRIVATE';
vm.runInContext(panel.slice(panel.indexOf('function publishFramedTable_('),panel.indexOf('function publishMirrorTab_(')),ctx);
const src=new Sheet('LOA',19),dest=new Sheet('LOA',16);src.parent=owner;dest.parent=publicBook;src.rows[5].v[6]='PRIVATE';seat(src,8,'old','Pending',1700000000001);src.rows[7].v[6]='secret';ctx.publishFramedTable_(src,dest);assert.equal(dest.width,19);assert.equal(dest.rows.length,11);assert.equal(dest.rows[7].v[1],'old');assert.equal(dest.rows[7].v[6],'');assert.equal(dest.rows[7].v[0],'');assert.equal(dest.rows[7].style,'old');assert.equal(dest.rows[10].style,'BORDER');assert.equal(dest.rows[7].height,src.rows[7].height);assert.equal(owner.removed.length,1);assert.equal(publicBook.removed.length,1);console.log('Public mirror: dimensions, styles, height, privacy filtering and carrier cleanup passed');

const wide=new Sheet('LOA',25);for(const r of wide.rows){for(let c=19;c<25;c++)r.bg[c]='#ffffff';r.bg[18]=r.bg[0]}assert.equal(ctx.framedTable_(wide,8).width,19);console.log('Right border detected before unused grid columns: passed');
// Graduate log framing uses its own start row, unrelated to tracker/signup settings.
const gradFrame=new Sheet('Police Academy',23);
gradFrame.rows=Array.from({length:50},(_,i)=>({v:Array(23).fill(''),f:Array(23).fill(''),bg:Array(23).fill(i===43?'#111111':'#eeeeee'),style:i===43?'GRAD_BORDER':'GRAD_TEMPLATE',height:27}));
for(let i=40;i<44;i++){gradFrame.rows[i].bg[0]=gradFrame.rows[i].bg[22]='#111111';}
assert.equal(ctx.framedTable_(gradFrame,41).cap,44);
ctx.ensureRoomAboveCap_(gradFrame,43,41);assert.equal(gradFrame.rows.length,50,'three empty graduate slots need no growth');
ctx.ensureRoomAboveCap_(gradFrame,45,41);
assert.equal(ctx.framedTable_(gradFrame,41).cap,46,'two extra graduates move the closing bar down');
assert.equal(gradFrame.rows[45].style,'GRAD_BORDER');
for(let r=43;r<45;r++){assert.equal(gradFrame.rows[r].style,'GRAD_TEMPLATE');assert.equal(gradFrame.rows[r].height,27);assert.equal(gradFrame.rows[r].validation,'copied');assert.equal(gradFrame.rows[r].conditional,'copied');}
console.log('Graduate log: three initial rows, independent frame, dynamic width, growth and border/format preservation passed');
