const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('RosterExtras.gs','utf8');
class Sheet{
 constructor(name,rows){this.name=name;this.rows=rows;this.clears=0;this.formulas={};}
 getName(){return this.name}getSheetId(){return this.name}getMaxRows(){return this.rows.length}getLastRow(){return this.rows.length}getLastColumn(){return this.rows[0].length}getMaxColumns(){return this.getLastColumn()}
 insertRowsAfter(at,n){this.rows.splice(at,0,...Array.from({length:n},()=>Array(this.getLastColumn()).fill('')))}
 getRange(r,c,n=1,w=1){const s=this;return{getDisplayValues:()=>s.rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w).map(String)),getValues:()=>s.rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w)),getFormulasR1C1:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>s.formulas[(r+i)+','+(c+j)]||'')),getDataValidations:()=>Array.from({length:n},()=>Array(w).fill(null)),getMergedRanges:()=>[],breakApart(){return this},clearContent(){s.clears++;for(let i=0;i<n;i++)for(let j=0;j<w;j++)s.rows[r+i-1][c+j-1]='';return this},setNumberFormat(){return this},setValues(rows){rows.forEach((row,i)=>row.forEach((v,j)=>s.rows[r+i-1][c+j-1]=v));return this},setFormulaR1C1(f){s.formulas[r+','+c]=f;return this},copyTo(){}}}
}
const roster=new Sheet('Roster',[['GROUP','RANK','NAME','UNIQUE ID','ASSIGNMENT','HOURS'],['','','','','',''],['','Officer','Alex','1','Day',0],['','Officer','Blair','2','Daylight',5]]);
const tab=new Sheet('Day Shift',[['GROUP','RANK','NAME','UNIQUE ID','ASSIGNMENT','HOURS','NOTES'],['','','','','','',''],['','Officer','Alex','1','Day',2,'memo'],['','','','','','','']]);
let sheets=[roster,tab],held=false,release=0;
const ctx={CONFIG:{sheets:{roster:'Roster'},rosterStartRow:3,rankList:{trainingRanks:[]},trainingDividers:[]},SpreadsheetApp:{getActive:()=>({getSheetByName:()=>roster,getSheets:()=>sheets}),DataValidationCriteria:{CHECKBOX:'checkbox'},CopyPasteType:{PASTE_DATA_VALIDATION:1}},LockService:{getScriptLock:()=>({hasLock:()=>held,tryLock:()=>{held=true;return true},releaseLock:()=>{held=false;release++}})},rosterCols_:()=>({headerRow:1,rank:2,name:3,discord:4,shift:5}),norm_:v=>String(v).trim().toUpperCase()};
vm.createContext(ctx);vm.runInContext(source,ctx);
const system=fs.readFileSync('RosterSystem.gs','utf8');
for(const name of ['isDividerValue_','isValidMemberValues_']){const start=system.indexOf('function '+name+'('),end=system.indexOf('\nfunction ',start+1);vm.runInContext(system.slice(start,end<0?undefined:end),ctx)}
ctx.groupMarker_=()=>null;ctx.isAcademyTab_=()=>false;ctx.groupHeaderRow_=s=>({row:1,rankCol:2,headers:s.rows[0]});ctx.rosterBandRanges_=()=>({});ctx.tabBandRanges_=()=>[];
assert.equal(ctx.groupValueMatches_('Daylight','Day'),false);assert.equal(ctx.groupValueMatches_(' DAY shift ','day'),true);
let result=ctx.buildGroupSheets_();assert.equal(result.built,1);assert.equal(tab.rows[2][2],'Alex');assert.equal(tab.rows[2][5],'0');assert.equal(tab.rows[2][6],'memo');assert.equal(tab.rows[3][2],'');assert.equal(release,1);
tab.formulas['3,7']='=RC[-1]*2';ctx.buildGroupSheets_();assert.equal(tab.formulas['3,7'],'=RC[-1]*2');
roster.rows[2][4]='Night';ctx.buildGroupSheets_();assert.equal(tab.rows[2][2],'','last member leaving empties group even without assignment value in roster');
roster.rows[2][4]='Day';roster.rows[3][3]='1';const clears=tab.clears;result=ctx.buildGroupSheets_();assert.equal(result.built,0);assert.equal(tab.clears,clears,'duplicate identity rejected before clearing');roster.rows[3][3]='2';
ctx.tabBandRanges_=()=>[{label:'Officers',top:3,height:1}];result=ctx.buildGroupSheets_();assert.equal(result.built,0);assert.equal(tab.clears,clears,'missing source bands rejected before clearing');
const releasedBefore=release;held=true;ctx.withDerivedLock_(()=>42);assert.equal(release,releasedBefore,'nested lock does not release parent ownership');held=false;
console.log('Group refresh: matching, zero hours, custom fields/formulas, empty groups, identity guards, missing bands and lock ownership passed');

const academy=new Sheet('Academy',[['GROUP','RANK','NAME','UNIQUE ID','HOURS','EXAM'],['','','','','',''],['','Cadet','Alex','1',0,'passed'],['','','','','','']]);sheets=[roster,academy];roster.rows[2][1]='Officer';roster.rows[3][1]='Cadet Supervisor';
ctx.isAcademyTab_=s=>s===academy;ctx.academyMarker_=()=>({ranks:['Cadet']});ctx.academyTrainingRanksFromLabels_=()=>[];ctx.academyHeaderRow_=s=>({row:1,headers:s.rows[0]});ctx.academyGradSection_=()=>null;ctx.tabBandRanges_=()=>[];
result=ctx.buildAcademySheets_();assert.equal(result.built,1);assert.equal(academy.rows[2][2],'— GRADUATED —');assert.equal(academy.rows[3][1],'Officer');assert.equal(academy.rows[3][2],'Alex');assert.equal(academy.rows[3][5],'passed');assert(!academy.rows.some(r=>r[2]==='Blair'),'explicit Cadet excludes Cadet Supervisor');
roster.rows[2][1]='Cadet';roster.rows[3][1]='Cadet';ctx.tabBandRanges_=()=>[{label:'Cadet',top:3,height:1}];const academyClears=academy.clears;result=ctx.buildAcademySheets_();assert.equal(result.built,0);assert.equal(academy.clears,academyClears,'academy overflow cannot clear training records or graduate active trainees');
console.log('Academy: exact training ranks, refreshed graduate identity, preserved exam records and overflow protection passed');

sheets=[roster,tab];ctx.isAcademyTab_=()=>false;ctx.rosterBandRanges_=()=>({Officers:{ranges:[{top:3,bottom:4}]}});ctx.tabBandRanges_=()=>[{label:'Officers',top:3,height:1}];roster.rows[3][4]='Day';const groupClears=tab.clears;result=ctx.buildGroupSheets_();assert.equal(result.built,0);assert.equal(tab.clears,groupClears,'full group band cannot silently omit matching members');
ctx.tabBandRanges_=()=>[];ctx.rosterBandRanges_=()=>({});roster.rows[3][4]='Night';ctx.buildGroupSheets_();tab.formulas['3,7']='=RC[-1]*2';roster.rows[3][4]='Day';const first=roster.rows[2];roster.rows[2]=roster.rows[3];roster.rows[3]=first;ctx.buildGroupSheets_();assert.equal(tab.rows[3][2],'Alex');assert.equal(tab.formulas['4,7'],'=RC[-1]*2','custom formula follows member and retains relative references');
console.log('Fixed-band overflow and formula relocation passed');
// Exercise the actual graduate-banner detector, rather than the builder fixture's stub.
function realFunction(name){const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);vm.runInContext(source.slice(start,end<0?undefined:end),ctx)}
realFunction('academyGradSection_');
const graduateFixture=new Sheet('Academy',[
 ['NAME','GRADUATED'],['Alex','Graduated'],['— GRADUATED —',''],['Graduate log','',''],['','','']
]);
assert.equal(ctx.academyGradSection_(graduateFixture,2,2).headerRow,4,'member status and generated divider are not fixed banners');

graduateFixture.rows[3][0]='';assert.equal(ctx.academyGradSection_(graduateFixture,2,2),null,'generated graduate divider is movable, not a permanent header');
// Repeated graduation and re-entry must preserve the training record and relative formula.
sheets=[roster,academy];ctx.isAcademyTab_=s=>s===academy;ctx.tabBandRanges_=()=>[];
roster.rows[2]=['','Officer','Alex','1','Day',0];roster.rows[3]=['','Officer','Blair','2','Night',5];
academy.rows=[['GROUP','RANK','NAME','UNIQUE ID','HOURS','EXAM'],['','','','','',''],['','Cadet','Alex','1',0,'passed'],['','','','','','']];academy.formulas={};
ctx.buildAcademySheets_();ctx.buildAcademySheets_();
assert.equal(academy.rows.filter(r=>r[2]==='— GRADUATED —').length,1,'repeat refresh has one graduate divider');
assert.equal(academy.rows.filter(r=>r[2]==='Alex').length,1);assert.equal(academy.rows.find(r=>r[2]==='Alex')[5],'passed');
roster.rows[2][1]='Cadet';ctx.buildAcademySheets_();assert.equal(academy.rows[2][2],'Alex');assert.equal(academy.rows[2][5],'passed','returning trainee retains exam');
roster.rows[2][2]='';ctx.buildAcademySheets_();assert(!academy.rows.some(r=>r[2]==='Alex'),'removed roster member leaves academy');
console.log('Academy graduate detection, repeated refresh, trainee re-entry and removal passed');
const panel=fs.readFileSync('RosterControlPanel.gs','utf8');assert(panel.includes("if(trainingChanged)"));assert(panel.includes("['academy','groups','dashboard'].forEach(deferWork_)"),'settings changes queue derived views');
// Builder integration: a fixed graduate area retains three slots and bounds clearing before its bar.
let roomArgs=[],gradCap=7;ctx.ensureRoomAboveCap_=(s,need,start)=>{roomArgs.push([need,start]);gradCap=Math.max(gradCap,need+1)};ctx.framedTable_=()=>({cap:gradCap});
const bounded=new Sheet('Academy',[['GROUP','RANK','NAME','UNIQUE ID','HOURS','EXAM'],['','','','','',''],['','','','','',''],['GRADUATE LOG','','','','',''],['','','','','',''],['','','','','',''],['','','','','',''],['BOTTOM','','','','','']]);
sheets=[roster,bounded];ctx.isAcademyTab_=s=>s===bounded;ctx.academyGradSection_=()=>({headerRow:4,dataStart:5});roster.rows[2][2]='Alex';roster.rows[2][1]='Officer';
ctx.buildAcademySheets_();assert.deepEqual(roomArgs[0],[7,5]);assert.equal(bounded.rows[7][0],'BOTTOM','graduate border remains intact');
console.log('Graduate builder initializes three slots and clears only inside its frame');
// Layout labels below the main header must not poison every derived identity scan.
const cleanRoster=new Sheet('Roster',[
 ['GROUP','RANK','NAME','UNIQUE ID','ASSIGNMENT','HOURS'],['','','','','',''],
 ['','Cadet','Avery','1234567890123456789','Day',0],
 ['','COMMAND STAFF','Department title','','Day',''],
 ['','','Footer title','','',''],
 ['','Officer','Bailey','1234567890123456790','Night',4]
]);
const cleanGroup=new Sheet('Day Shift',[['GROUP','RANK','NAME','UNIQUE ID','ASSIGNMENT','HOURS','NOTES'],['','','','','','',''],['','Cadet','Avery','1234567890123456789','Day',0,'keep'],['','','','','','','']]);
const cleanAcademy=new Sheet('Academy',[['GROUP','RANK','NAME','UNIQUE ID','HOURS','EXAM'],['','','','','',''],['','Cadet','Avery','1234567890123456789',0,'passed'],['','','','','','']]);
ctx.SpreadsheetApp.getActive=()=>({getSheetByName:()=>cleanRoster,getSheets:()=>[cleanRoster,cleanGroup,cleanAcademy]});
ctx.isAcademyTab_=s=>s===cleanAcademy;ctx.academyGradSection_=()=>null;ctx.tabBandRanges_=()=>[];
result=ctx.buildGroupSheets_();assert.equal(result.built,1);assert.equal(result.skipped.length,0);assert.equal(cleanGroup.rows[2][6],'keep');
result=ctx.buildAcademySheets_();assert.equal(result.built,1);assert.equal(result.skipped.length,0);assert.equal(cleanAcademy.rows[2][5],'passed');
assert(!cleanAcademy.rows.some(r=>r[2]==='Footer title'||r[2]==='Department title'));
cleanRoster.rows[5][3]='';const saved=cleanGroup.clears;
result=ctx.buildGroupSheets_();assert.equal(result.built,0);assert.equal(cleanGroup.clears,saved);assert.match(result.skipped[0].why,/Roster.*row 6.*D6/);
result=ctx.buildAcademySheets_();assert.equal(result.built,0);assert.match(result.skipped[0].why,/Roster.*row 6.*D6/);
cleanRoster.rows[5][3]='1234567890123456789';result=ctx.buildGroupSheets_();assert.match(result.skipped[0].why,/duplicate.*D6.*first found.*D3/);
// Distinct exact displayed IDs can share one rounded numeric getValues() result.
cleanRoster.rows[5][3]='1234567890123456790';cleanRoster.rows[5][4]='Day';
cleanGroup.rows[3]=['','Officer','Bailey','1234567890123456790','Day',4,'second'];
const getRange=cleanGroup.getRange.bind(cleanGroup);cleanGroup.getRange=(...args)=>{const range=getRange(...args),original=range.getValues;range.getValues=()=>{const rows=original();if(args[0]===3&&args[1]===2)rows.forEach(r=>{if(r[2])r[2]=Number(r[2])});return rows};return range};
result=ctx.buildGroupSheets_();assert.equal(result.built,1);assert.equal(result.skipped.length,0);assert.equal(cleanGroup.rows[3][6],'second');
ctx.rosterBandRanges_=()=>({cadets:{ranges:[{top:3,bottom:3}]},officers:{ranges:[{top:6,bottom:6}]}});ctx.tabBandRanges_=()=>[{label:'cadets',top:3,height:1},{label:'officers',top:4,height:1}];
result=ctx.buildGroupSheets_();assert.equal(result.built,1);assert.equal(cleanGroup.rows[2][2],'Avery');assert.equal(cleanGroup.rows[3][2],'Bailey','layout exclusions preserve physical source row offsets for rank bands');
console.log('Real member predicate excludes source dividers/footer labels, retains physical band offsets, diagnoses genuine missing/duplicate IDs by cell, and preserves exact destination IDs');
