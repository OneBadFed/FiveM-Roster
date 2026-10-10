// Demo acceptance model: real demo/status/leave/patrol code; no Google or network access.
process.env.TZ='America/Chicago';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const files=['RosterConfig.gs','RosterSystem.gs','RosterExtras.gs','RosterControlPanel.gs','RosterTrust.gs','RosterDevQA.gs'];
const deny=()=>{throw Error('Unexpected live service access');};
const blank=(n,w)=>Array.from({length:n},()=>Array(w).fill(''));
class Sheet {
 constructor(book,name,rows,cols){Object.assign(this,{book,name,rows,cols,id:book.tabs.length+1,values:blank(rows,cols),formulas:blank(rows,cols),notes:blank(rows,cols),formats:blank(rows,cols),merges:[],writes:0});book.tabs.push(this);}
 getName(){return this.name;} getParent(){return this.book;} getSheetId(){return this.id;}
 getMaxRows(){return this.rows;} getMaxColumns(){return this.cols;}
 getLastRow(){let n=this.rows;while(n&&!this.values[n-1].some(Boolean)&&!this.formulas[n-1].some(Boolean))n--;return n;}
 getLastColumn(){return this.cols;} hideSheet(){this.hidden=true;}
 clearContents(){this.values=blank(this.rows,this.cols);this.formulas=blank(this.rows,this.cols);this.writes++;}
 clear(){for(const key of ['values','formulas','notes','formats'])this[key]=blank(this.rows,this.cols);this.writes++;}
 insertRowsBefore(r,n){for(const key of ['values','formulas','notes','formats'])this[key].splice(r-1,0,...blank(n,this.cols));this.rows+=n;this.writes++;}
 insertRowsAfter(r,n){this.insertRowsBefore(r+1,n);}
 insertColumnsAfter(c,n){for(const key of ['values','formulas','notes','formats'])this[key].forEach(row=>row.splice(c,0,...Array(n).fill('')));this.cols+=n;this.writes++;}
 merge(r,c,n,w){this.merges.push({r,c,n,w});}
 getRange(r,c,n=1,w=1){
  assert(Number.isInteger(r)&&Number.isInteger(c)&&r>0&&c>0&&r+n-1<=this.rows&&c+w-1<=this.cols,`out of bounds ${this.name}: ${r},${c},${n},${w}`);
  const sh=this,read=k=>sh[k].slice(r-1,r+n-1).map(row=>row.slice(c-1,c+w-1)),write=(k,grid)=>{assert.equal(grid.length,n);grid.forEach((row,i)=>{assert.equal(row.length,w);row.forEach((v,j)=>{sh[k][r+i-1][c+j-1]=v;});});sh.writes++;};
  const rg={getRow:()=>r,getColumn:()=>c,getLastColumn:()=>c+w-1,getLastRow:()=>r+n-1,getNumRows:()=>n,getNumColumns:()=>w,
   getValues:()=>read('values'),getValue:()=>sh.values[r-1][c-1],getDisplayValues:()=>read('values').map(row=>row.map(v=>String(v??''))),getDisplayValue:()=>String(sh.values[r-1][c-1]??''),
   getFormulas:()=>read('formulas'),getFormula:()=>sh.formulas[r-1][c-1],getNotes:()=>read('notes'),
   getMergedRanges:()=>sh.merges.filter(m=>m.r<=r+n-1&&m.r+m.n-1>=r&&m.c<=c+w-1&&m.c+m.w-1>=c).map(m=>sh.getRange(m.r,m.c,m.n,m.w)),
   setValues(grid){write('values',grid);write('formulas',blank(n,w));return rg;},setValue(v){return rg.setValues(Array.from({length:n},()=>Array(w).fill(v)));},
   setFormulas(grid){write('formulas',grid);return rg;},setFormula(f){return rg.setFormulas([[f]]);},
   setNumberFormat(f){write('formats',Array.from({length:n},()=>Array(w).fill(f)));return rg;},setFontWeight(){return rg;},
   clearContent(){write('values',blank(n,w));write('formulas',blank(n,w));return rg;},clearNote(){write('notes',blank(n,w));return rg;},setNote(v){write('notes',Array.from({length:n},()=>Array(w).fill(v)));return rg;}
  };return rg;
 }
}
const RC={headerRow:1,rank:2,name:3,unit:4,discord:5,join:6,promo:7,hours:8,activity:9,shift:10,ooc:11,email:12,dob:13,timeInRank:14};
const TC={labelRow:1,width:19,key:1,rank:2,unit:3,ooc:4,name:5,discord:6,shift:7,start:8,end:9,length:10,untilStart:11,timeLeft:12,returnDate:13,status:14,approvedBy:15,notes:16,reason:17};
const PC={labelRow:1,width:13,mark:1,rank:2,unit:3,ooc:4,name:5,discord:6,shift:7,startDate:8,endDate:9,startTime:10,endTime:11,total:12,status:13};
const SC={headerRow:1,dataStart:2,width:11,timestamp:1,name:2,ooc:3,discord:4,email:5,dob:6,phone:7,join:8,status:9,notes:10};
function fixture(options={}){
 const clock=new Date(2026,10,3,12);function ClockDate(...args){return args.length?new Date(...args):new Date(clock);}ClockDate.prototype=Date.prototype;Object.setPrototypeOf(ClockDate,Date);ClockDate.now=()=>clock.getTime();
 const data={},props={getProperty:k=>data[k]??null,getProperties:()=>({...data}),setProperty(k,v){data[k]=String(v);return this;},deleteProperty(k){delete data[k];return this;}};
 let held=false,busy=false,releases=0,queued=0;const lock={hasLock:()=>held,tryLock(){if(busy)return false;held=true;return true;},releaseLock(){assert(held);held=false;releases++;}};
 const alerts=[],ui={Button:{OK:'OK',CANCEL:'CANCEL'},ButtonSet:{OK:'OK',OK_CANCEL:'OK_CANCEL'},prompt:()=>({getSelectedButton:()=> 'OK',getResponseText:()=> 'LOAD DEMO'}),alert(...args){assert(!held,'modal UI cannot hold writer lock');alerts.push(args);}};
 const book={tabs:[],getId:()=> 'demo-book',getSheetByName(n){return this.tabs.find(s=>s.name===n);},getSheets(){return this.tabs;},insertSheet(n){return new Sheet(this,n,10,26);}};
 const config={idType:'DISCORD',idMinDigits:17,idMaxDigits:19,rosterStartRow:2,trackerStartRow:2,patrolStartRow:2,headerRow:1,
  sheets:{roster:'Roster',tracker:'Tracker',patrolLog:'Patrol',signups:'Signups',hoursHistory:'History',welcome:'Welcome'},
  leaveTypes:['Medical','Returning'],protectedStatuses:['Medical','Returning'],returnStatus:'Returning',thresholds:{semi:5},approvedStatus:'Authorized',expiredStatus:'Ended',
  shiftValues:['East','West'],shiftAssignedBy:'MEMBER',patrol:{maxHours:16,futureGraceHours:0,processedStatus:'Credited',pendingStatus:'Awaiting',flaggedStatus:'Review',approvedStatus:'Allowed',deniedStatus:'Rejected'},...options.config};
 const engine={global:[{name:'Ready',min:10},{name:'Limited',min:5},{name:'Idle',min:0}],overrides:[],rules:[],...options.engine};
 const c={Date:ClockDate,Math,JSON,console:{log(){},warn(){},error(){}},SpreadsheetApp:{getActive:()=>book,getUi:()=>ui,flush(){},create:deny},
  PropertiesService:{getDocumentProperties:()=>props,getScriptProperties:()=>props},LockService:{getScriptLock:()=>lock,getDocumentLock:()=>lock},CacheService:{getDocumentCache:()=>({get:()=>null,put(){},remove(){}})},
  UrlFetchApp:{fetch:deny},FormApp:{create:deny},ScriptApp:{newTrigger:deny},Utilities:{getUuid:()=> 'demo-test'}};
 vm.createContext(c);files.forEach(file=>vm.runInContext(fs.readFileSync(file,'utf8'),c,{filename:file}));
 const actual={rosterCols:c.rosterCols_,registry:c.columnRegistry_,trackerCols:c.trackerCols_,patrolCols:c.patrolLogCols_,signupCols:c.signupCols_,coverage:c.buildCoverageCore_,statusEngine:c.statusEngine_};
 Object.defineProperty(c,'CONFIG',{value:config,configurable:true});c.statusEngine_=()=>engine;
 c.todayInSheetTz_=()=>new Date(clock.getFullYear(),clock.getMonth(),clock.getDate());c.publishMarkDirty_=()=>{queued++;};
 c.log_=c.logInfo_=c.logWarn_=()=>{};c.diagnosticText_=s=>String(s);
 // External derived-view builders and formatting are checked by their own suites.
 const stages=[];for(const fn of ['styleStartupSupportSheet_','sortSupportRows_','ensureSupportFilter_','sortTracker_','sortPatrolLog_','sortSignups_','buildCoverageCore_','buildGroupSheets_','buildAcademySheets_','refreshDashboard_','cpInvalidateHealth_','renderPromotions_'])c[fn]=(...args)=>{stages.push([fn,...args]);return {skipped:[]};};
 c.getSheetOrWarn_=(ss,n)=>ss.getSheetByName(n);c.dashboardSkip_=()=>false;
 c.rosterCols_=()=>({...RC});c.trackerCols_=()=>({...TC});c.patrolLogCols_=()=>({...PC});c.signupCols_=()=>({...SC});
 c.lastActivityCols_=()=>[15,16,17];c.columnRegistry_=()=>Array.from({length:19},(_,i)=>({col:i+1,klass:[1,2,4,19].includes(i+1)||(i+1===10&&config.shiftAssignedBy==='RANK')?'SLOT':'MEMBER'}));
 c.isMemberSlot_=rank=>!!rank&&!/^[A-Z ]+$/.test(rank);
 c.assertNoPendingActivityReset_=()=>{};const recoveryGuard=c.assertNoPendingRosterRecovery_;c.assertNoPendingRosterRecovery_=()=>{};
 c.framedTable_=sh=>({cap:sh.values.findIndex(row=>row[0]==='BOTTOM')+1||sh.rows+1,width:sh.cols});
 c.ensureRoomAboveCap_=(sh,last)=>{const cap=c.framedTable_(sh).cap;if(last>=cap)sh.insertRowsBefore(cap,last-cap+1);};
 const roster=new Sheet(book,'Roster',options.slots?options.slots+2:44,19),tracker=new Sheet(book,'Tracker',5,19),patrol=new Sheet(book,'Patrol',5,13),signups=new Sheet(book,'Signups',5,11),history=new Sheet(book,'History',2,3),welcome=new Sheet(book,'Welcome',10,8);
 roster.values[0]=['RANK GROUP','RANK','NAME','CALLSIGN','UNIQUE ID','JOIN DATE','LAST PROMOTION','HOURS','STATUS','SHIFT','OOC NAME','EMAIL','DOB','TIME IN RANK','LAST ACTIVITY 1','LAST ACTIVITY 2','LAST ACTIVITY 3','CUSTOM','SEAT'];
 for(const sh of [tracker,patrol,signups]){sh.values[0][0]='HEADER';sh.values[4][0]='BOTTOM';}
 const slots=options.slots||40,memberRows=[];let r=2;
 for(let i=0;i<slots;i++,r++){
  if(!options.slots&&i===10){roster.values[r-1][1]='PATROL SECTION';roster.values[r-1][2]='Divider text';roster.values[r-1][3]='HEADER CALL';r++;}
  roster.values[r-1][1]=i<4?'Sergeant':'Officer';roster.values[r-1][3]='S-'+String(i+1).padStart(2,'0');roster.values[r-1][9]='Slot '+i;
  roster.values[r-1][17]='Old private data';roster.notes[r-1][17]='Old private note';roster.notes[r-1][2]='Old name note';roster.values[r-1][18]='Seat '+i;
  memberRows.push({r,rank:roster.values[r-1][1]});
 }
 roster.formulas[memberRows[1].r-1][17]='=1+1';
 welcome.values[0][0]='TOTAL EMPLOYEES';welcome.values[1][0]='Custom label';welcome.values[1][7]='=COUNTIF(Roster!C:C,"*")';welcome.notes[1][7]='#members';
 const before=()=>JSON.stringify(book.tabs.map(sh=>[sh.name,sh.values,sh.formulas,sh.notes,sh.formats]));
 return {c,actual,config,engine,book,roster,tracker,patrol,signups,history,welcome,memberRows,stages,data,props,lock,ui,alerts,clock,before,recoveryGuard,get held(){return held;},get releases(){return releases;},get queued(){return queued;},set busy(v){busy=v;}};
}
let assertions=0;function check(name,fn){fn();assertions++;console.log('Demo: '+name);}
check('configured numeric IDs are exact and unique, including large rosters',()=>{
 for(const config of [{},{idType:'COMMUNITY',idMinDigits:1,idMaxDigits:8},{idType:'CUSTOM',idMinDigits:6,idMaxDigits:6}]){
  const f=fixture({config}),ids=Array.from({length:1600},(_,i)=>f.c.demoId_(i));assert.equal(new Set(ids).size,1600);ids.forEach(id=>assert(/^\d+$/.test(id)&&id.length>=f.config.idMinDigits&&id.length<=f.config.idMaxDigits));
 }
 const f=fixture({config:{idMinDigits:1,idMaxDigits:1}});assert.equal(f.c.demoId_(0),'1');assert.throws(()=>f.c.demoId_(9),/cannot fit/);
});
check('default, renamed, one/two-tier, rank overrides, rules and disabled leaves recompute consistently',()=>{
 for(const spec of [{},{engine:{global:[{name:'Available',min:0}]}},{engine:{global:[{name:'Full',min:80},{name:'Low',min:0}]}},{engine:{overrides:[{scope:'RANK',match:'Officer',ladder:[{name:'Ready',min:100},{name:'Idle',min:0}]}]}},{engine:{rules:[{source:'READY',op:'>=',hours:10,target:'Limited'}]}},{config:{leaveTypes:[],returnStatus:''}}]){
  const f=fixture(spec);for(let i=0;i<160;i++){
   const p=f.c.demoPerson_(i,160,'Officer'),next=f.c.resolveStatus_('Officer',p.act,p.hours);assert(next===null||next===p.act,`${i}: ${p.act} -> ${next}`);
   assert(p.join<=p.promo&&p.promo<f.clock);if(p.leave)assert.equal(p.leave.status,'Authorized');
   if(!f.config.leaveTypes.length){assert(!p.leave);assert.equal(p.pastLeaves.length,0);}
   p.checks.forEach((status,k)=>{const day=f.c.demoSunday_((3-k)*2),active=[p.leave,...p.pastLeaves].filter(Boolean).find(l=>day>=f.c.demoDay_(l.from)&&day<f.c.demoDay_(l.to));assert(status===f.c.computeStatusCore_('Officer',f.c.demoHours_(p.hours)[k],f.engine)||active&&status===active.type||status===f.config.returnStatus&&day>=f.c.demoDay_(p.pastLeaves[0].to));});
  }
 }
});
check('bounded sessions sum exactly, including fractional tiers and low patrol limits',()=>{
 for(const cap of [.01,.5,1,3,16,24]){const f=fixture({config:{patrol:{maxHours:cap}}});for(const hrs of [0,.01,.13,4.75,10,31.25,120]){
  const parts=Array.from(f.c.demoSplitHours_(hrs));assert.equal(Math.round(parts.reduce((a,b)=>a+b,0)*100),Math.round(hrs*100));parts.forEach(p=>assert(p>0&&p<=cap&&p<=12));
 }}assert.throws(()=>fixture({config:{patrol:{maxHours:0}}}).c.demoSplitHours_(1),/patrol limit/);
});
check('full demo seeds related tables, clears stale fields and preserves slots/templates/borders',()=>{
 const f=fixture(),rosterBefore=structuredClone(f.roster.values),welcomeBefore=JSON.stringify([f.welcome.values,f.welcome.notes]);
 const summary=f.c.seedDemoRosterCore_();assert(!summary.includes('⚠'),summary);assert(summary.includes('4 fortnightly'));assert(f.history.hidden&&f.history.cols>=6);
 const ids=new Set(),hoursById=new Map();let filled=0,opens=0;
 for(const [i,m] of f.memberRows.entries()){
  const row=f.roster.values[m.r-1];for(const col of [2,4,19])assert.equal(row[col-1],rosterBefore[m.r-1][col-1]);
  assert.equal(f.roster.notes[m.r-1][2],'');if(i===1)assert.equal(f.roster.formulas[m.r-1][17],'=1+1');else{assert.equal(row[17],'');assert.equal(f.roster.notes[m.r-1][17],'');}
  if(row[2]){filled++;ids.add(row[4]);hoursById.set(row[4],row[7]);assert(['East','West'].includes(row[9]));assert(row.slice(14,17).every(Boolean));assert.equal(f.roster.formats[m.r-1][4],'@');}
  else{opens++;for(const col of [3,5,6,7,8,9,10,11,12,13,15,16,17])assert.equal(row[col-1],'');}
 }
 assert(filled>4&&opens>0);assert.equal(f.roster.values[11][2],'Divider text');assert.equal(f.roster.values[11][3],'HEADER CALL');
 assert.equal(f.history.getLastRow(),1+filled*4);assert.equal(JSON.stringify([f.welcome.values,f.welcome.notes]),welcomeBefore);
 const signupRows=f.signups.values.slice(1,-1).filter(r=>r[3]);assert.equal(signupRows.length,filled+4);
 const pending=signupRows.filter(r=>r[8]==='Pending');assert.equal(pending.length,4);pending.forEach(row=>{assert(!ids.has(row[3]));assert(row[0]<f.clock);assert(/^\(202\) 555-01\d\d$/.test(row[6]));});
 const logged=new Map();for(const row of f.patrol.values.slice(1,-1).filter(r=>r[5]))logged.set(row[5],(logged.get(row[5])||0)+Number(row[0].split('|')[0]));
 for(const [id,hours] of hoursById)assert.equal(Math.round((logged.get(id)||0)*100),Math.round(hours*100));
 f.tracker.values.slice(1,-1).filter(r=>r[5]).forEach(row=>{assert(ids.has(row[5]));assert(['Authorized','Ended'].includes(row[13]));assert(row[7]<=row[8]);assert(f.tracker.formulas[f.tracker.values.indexOf(row)][9]);});
 for(const sh of [f.tracker,f.patrol,f.signups])assert.equal(sh.values.at(-1)[0],'BOTTOM');
 assert(f.stages.some(s=>s[0]==='refreshDashboard_'&&s[1]===true));assert(f.stages.some(s=>s[0]==='buildGroupSheets_'));assert(f.stages.some(s=>s[0]==='buildAcademySheets_'));assert(f.stages.some(s=>s[0]==='buildCoverageCore_'));
 const first=f.before();f.c.seedDemoRosterCore_();assert.equal(f.before(),first,'reloading must replace, not accumulate');
});
check('slot-owned shifts survive, member-owned shifts use configured choices only',()=>{
 const f=fixture({config:{shiftAssignedBy:'RANK'}}),before=f.roster.values.map(r=>r[9]);f.c.seedDemoRosterCore_();assert.deepEqual(f.roster.values.map(r=>r[9]),before);
 const empty=fixture({config:{shiftValues:[]}});empty.c.seedDemoRosterCore_();assert(empty.memberRows.every(m=>empty.roster.values[m.r-1][9]===''));
});
check('actual header resolvers and column ownership accept a normal template and narrow patrol tab',()=>{
 const f=fixture(),{c,actual}=f;
 f.config.roster={rank:2,name:3,unit:4,discord:5,activity:9,hours:8};f.config.tracker=TC;
 c.cfg_=()=>({legacy:f.config,kv:{ROSTER_LAYOUT:{SHIFT_HEADER:'SHIFT'}},fromTab:false});
 c.rosterCols_=actual.rosterCols;c.columnRegistry_=sh=>actual.registry(sh,{});c.trackerCols_=actual.trackerCols;c.patrolLogCols_=actual.patrolCols;c.signupCols_=actual.signupCols;
 f.tracker.values[0]=['KEY','RANK','CALLSIGN','OOC NAME','NAME','UNIQUE ID','SHIFT','START DATE','END DATE','LENGTH','UNTIL START','TIME LEFT','RETURN DATE','STATUS','APPROVED BY','NOTES','REASON','',''];
 f.patrol.values[0]=['MARK','RANK','CALLSIGN','OOC NAME','NAME','UNIQUE ID','SHIFT','START DATE','END DATE','START TIME','END TIME','TOTAL','STATUS'];
 f.signups.values[0]=['TIMESTAMP','NAME','OOC NAME','UNIQUE ID','EMAIL','DOB','PHONE','DEPARTMENT JOIN DATE','STATUS','NOTES',''];
 assert.equal(c.columnRegistry_(f.roster).find(col=>col.col===14).klass,'SLOT');
 const summary=c.seedDemoRosterCore_();assert(!summary.includes('⚠'),summary);assert(f.patrol.values.some(r=>r[12]==='Credited'));
});
check('real patrol processing/reconciliation is a no-op across DST and policy boundaries',()=>{
 for(const cap of [.5,3,16,24]){
  const f=fixture();f.config.patrol.maxHours=cap;f.c.seedDemoRosterCore_();
  const index={RC,byId:new Map()};f.memberRows.forEach(m=>{const id=f.roster.values[m.r-1][4];if(id)index.byId.set(id,m.r);});f.c.patrolFindRow_=(_,id)=>index.byId.get(id)??-1;
  f.c.patrolNotifyRow_=deny;const hoursBefore=f.roster.values.map(r=>r[7]),markerBefore=f.patrol.values.map(r=>r[0]);
  for(let r=2;r<f.patrol.rows;r++){
   const vals=f.patrol.values[r-1];if(!vals[5])continue;
   assert.equal(f.c.processPatrolLog_(f.patrol,r,PC,f.roster,index,{vals,disp:vals.map(String),mark:vals[0],sweep:true}),true);
   assert.equal(vals[12],'Credited');
  }
  assert.deepEqual(f.roster.values.map(r=>r[7]),hoursBefore);assert.deepEqual(f.patrol.values.map(r=>r[0]),markerBefore);assert(!f.held);
 }
});
check('actual leave scheduler and coverage retain the seeded lifecycle, including returned members',()=>{
 const f=fixture({slots:80});f.config.autoExpire=true;f.config.pendingStatus='Pending';f.config.sheets.coverage='Coverage';f.c.seedDemoRosterCore_();
 const before=f.roster.values.map(r=>r[8]);assert(before.includes('Returning'));
 f.c.processDailyLOAs_(f.roster,f.tracker,f.c.todayInSheetTz_(),{sendWebhooks:false});assert.deepEqual(f.roster.values.map(r=>r[8]),before);
 const leaves=f.c.activeLeaves_(f.tracker);assert(leaves.length);leaves.forEach(l=>assert.equal(l.type,'Medical'));assert.equal(leaves.length,before.filter(s=>s==='Medical').length);
 const coverage=new Sheet(f.book,'Coverage',2,3);coverage.values[1][0]='Old member';f.c.cfg_=()=>({legacy:f.config});f.c.fmtDate_=d=>d.toISOString().slice(0,10);
 const result=f.actual.coverage(f.book,f.tracker);assert.equal(result.total,leaves.length);assert.equal(result.outNow,leaves.length);assert.equal(coverage.cols,5);assert(!coverage.values.some(r=>r[0]==='Old member'));assert(coverage.values.slice(1,-1).filter(r=>r[0]).every(r=>r[1]==='Medical'));assert(!f.held);
});
check('large-roster pending applicants have disjoint IDs',()=>{
 const f=fixture({slots:850}),people=f.memberRows.map((m,i)=>f.c.demoPerson_(i,850,m.rank));
 f.c.seedDemoSignups_(f.book,f.memberRows,people);const ids=new Set(people.map(p=>p.id));const pending=f.signups.values.filter(r=>r[8]==='Pending');assert.equal(pending.length,4);pending.forEach(r=>assert(!ids.has(r[3])));
});
check('preflight rejects collisions, missing/header mappings, recovery and capacity before writes',()=>{
 const invalid=[f=>f.config.sheets.patrolLog='Roster',f=>f.config.sheets.tracker='Missing',f=>f.config.sheets.hoursHistory='SYS Log',f=>f.config.rosterStartRow=1,f=>f.roster.values[0][5]='Old notes',
  f=>f.c.rosterCols_=()=>({...RC,hours:3}),f=>f.c.trackerCols_=()=>({...TC,end:8}),f=>f.c.signupCols_=()=>({...SC,headerRow:2}),f=>f.c.patrolLogCols_=()=>({...PC,width:14}),
  f=>f.c.lastActivityCols_=()=>[5],f=>f.c.columnRegistry_=()=>[],f=>f.c.assertNoPendingActivityReset_=()=>{throw Error('reset pending');},
  f=>f.c.assertNoPendingRosterRecovery_=()=>{throw Error('move pending');},f=>{f.config.idMinDigits=1;f.config.idMaxDigits=1;}];
 for(const corrupt of invalid){const f=fixture();corrupt(f);const before=f.before();assert.throws(()=>f.c.seedDemoRosterCore_());assert.equal(f.before(),before);}
 for(const mark of ['RE_CREDIT_V1:{}','RE_IMPORT_V1:{}','1|123|IMPORT_PENDING:x']){
  const f=fixture();f.patrol.values[1][0]=mark;f.c.assertNoPendingRosterRecovery_=f.recoveryGuard;
  f.c.assertMemberEditMoveRows_=()=>{};f.c.memberMoveJournal_=()=>null;f.c.memberAssignmentRows_=()=>[];f.c.pendingSignupApprovals_=()=>[];
  const before=f.before();assert.throws(()=>f.c.seedDemoRosterCore_(),/unfinished patrol/i);assert.equal(f.before(),before);
 }
});
check('promotions match roster dates and stale feeds clear when there are no candidates',()=>{
 const f=fixture(),people=f.memberRows.map((m,i)=>f.c.demoPerson_(i,40,m.rank));f.c.seedDemoPromotions_(f.memberRows,people);
 const feed=Object.values(f.data).map(v=>{try{return JSON.parse(v);}catch{return null;}}).find(v=>Array.isArray(v)&&v[0]?.t);
 assert(feed&&feed.length);feed.forEach(item=>assert(people.some(p=>p.name===item.n&&p.promo.getTime()===item.t)));
 f.c.seedDemoPromotions_([],[]);assert(Object.values(f.data).includes('[]'));
});
check('leadership updates recognized boxes only and clears leftover leaders',()=>{
 const f=fixture(),sh=f.welcome;sh.merge(3,1,1,8);for(let r=4;r<=7;r++){sh.merge(r,2,1,2);sh.merge(r,4,1,5);sh.values[r-1][0]='Old rank';sh.values[r-1][1]='Old call';sh.values[r-1][3]='Old leader';}
 sh.values[2][0]='Unrelated banner';const before=f.before();assert.equal(f.c.fillExecBox_(sh,[{rank:'Chief',callsign:'C-01',name:'Maria Alvarez'}]),false);assert.equal(f.before(),before);
 sh.values[2][0]='EXECUTIVE COMMAND';assert(f.c.seedDemoStats_(f.book,[{rank:'Chief',callsign:'C-01',name:'Maria Alvarez'}]));assert.equal(sh.values[3][3],'M. Alvarez');assert.equal(sh.values[4][3],'');assert.equal(sh.values[1][0],'Custom label');assert.equal(sh.notes[1][7],'#members');
 const other=new Sheet(f.book,'Other dashboard',8,8);other.merge(1,1,1,8);other.values[0][0]='LEADERSHIP';const snapshot=JSON.stringify(other.values);f.c.seedDemoStats_(f.book,[{rank:'Chief',name:'Name'}]);assert.equal(JSON.stringify(other.values),snapshot);
});
check('confirmation, lock failures, partial failures and menu auditing restore suppression',()=>{
 for(const previous of [false,true])for(const fail of [false,true]){
  const f=fixture();vm.runInContext('DEV_WEBHOOKS_OFF_='+previous,f.c);let audited=false;
  f.c.runAction_=(_,fn)=>{try{fn();}finally{assert(vm.runInContext('DEV_WEBHOOKS_OFF_',f.c));audited=true;}};
  f.c.seedDemoRosterCore_=progress=>{assert(f.held);assert(vm.runInContext('DEV_WEBHOOKS_OFF_',f.c));progress.writesStarted=true;if(fail)throw Error('write failed');return 'Seeded';};
  if(fail)assert.throws(()=>f.c.seedDemoRoster(),/Some data may already/);else f.c.seedDemoRoster();
  assert(audited&&!f.held);assert.equal(f.releases,1);assert.equal(f.queued,1);assert.equal(vm.runInContext('DEV_WEBHOOKS_OFF_',f.c),previous);
 }
 for(const answer of ['','LOAD','LOAD DEMO extra']){const f=fixture();f.c.runAction_=(_,fn)=>fn();f.ui.prompt=()=>({getSelectedButton:()=> 'OK',getResponseText:()=>answer});const before=f.before();f.c.seedDemoRoster();assert.equal(f.before(),before);assert.equal(f.queued,0);}
 const busy=fixture();busy.c.runAction_=(_,fn)=>fn();busy.busy=true;assert.throws(()=>busy.c.seedDemoRoster(),/E-503|running/);assert.equal(busy.queued,0);assert.equal(vm.runInContext('DEV_WEBHOOKS_OFF_',busy.c),false);
 for(const fail of [false,true]){const f=fixture();f.c.runAction_=(_,fn)=>fn();f.c.seedDemoRosterCore_=progress=>{progress.writesStarted=true;if(fail)throw Error('write failure');return 'Seeded';};f.c.publishMarkDirty_=()=>{throw Error('queue failure');};assert.throws(()=>f.c.seedDemoRoster(),fail?/queue failure.*write failure/s:/queue failure/);assert(!f.held);assert.equal(vm.runInContext('DEV_WEBHOOKS_OFF_',f.c),false);}
});
check('tierless configurations load without invented statuses, including real config materialization',()=>{
 for(const spec of [{config:{leaveTypes:[],returnStatus:''}},{},{engine:{overrides:[{scope:'RANK',match:'Sergeant',ladder:[{name:'Ready',min:10},{name:'Idle',min:0}]}]}}]){
  const f=fixture({...spec,slots:80,engine:{global:[],...spec.engine}});
  for(let i=0;i<160;i++){
   const p=f.c.demoPerson_(i,160,'Officer');assert(['',...f.config.leaveTypes].includes(p.act));assert.equal(f.c.resolveStatus_('Officer',p.act,p.hours),null);
   p.checks.forEach((status,k)=>{const at=f.c.demoSunday_((3-k)*2),active=[p.leave,...p.pastLeaves].filter(Boolean).find(l=>at>=f.c.demoDay_(l.from)&&at<f.c.demoDay_(l.to));assert(status===''||active&&status===active.type||status===f.config.returnStatus&&at>=f.c.demoDay_(p.pastLeaves[0].to));});
  }
  const message=f.c.seedDemoRosterCore_();assert(message.includes('no activity ladder'));assert(f.memberRows.some(m=>f.roster.values[m.r-1][7]>0));
  assert(f.history.values.slice(1).some(row=>row[1]&&row[5]===''));
  if(!f.config.leaveTypes.length)assert(f.memberRows.every(m=>f.roster.values[m.r-1][8]===''));
  if(spec.engine)assert(f.memberRows.slice(0,4).every(m=>['Ready','Idle'].includes(f.roster.values[m.r-1][8])));
  const before=f.roster.values.map(r=>r[8]);f.c.processDailyLOAs_(f.roster,f.tracker,f.c.todayInSheetTz_(),{sendWebhooks:false});assert.deepEqual(f.roster.values.map(r=>r[8]),before);
 }
 const f=fixture(),v=f.c.validateConfig_({STATUSES:{kind:'table',header:['Status','Kind','MinHours','Color'],rows:[]},STATUS_OVERRIDES:{kind:'table',header:['Scope','Match','Ladder'],rows:[]}});
 assert(!v.problems.some(p=>p.sev==='ERROR'));const state=f.c.materialize_(v.config,true);assert.equal(state.tiers.length,0);
 f.c.cfg_=()=>state;f.c.statusEngine_=f.actual.statusEngine;f.config.leaveTypes=state.legacy.leaveTypes;f.config.returnStatus=state.legacy.returnStatus;
 assert(f.c.seedDemoRosterCore_().includes('no activity ladder'));assert(f.memberRows.every(m=>f.roster.values[m.r-1][8]===''));
});
check('menu preflight failures report no demo writes and do not queue publishing',()=>{
 const f=fixture();f.config.sheets.tracker='Missing';f.c.runAction_=(_,fn)=>fn();const before=f.before();
 assert.throws(()=>f.c.seedDemoRoster(),e=>/before changing demo data/.test(e.message)&&!/may already/.test(e.message));
 assert.equal(f.before(),before);assert.equal(f.queued,0);assert(!f.held);assert.equal(vm.runInContext('DEV_WEBHOOKS_OFF_',f.c),false);
 const partial=fixture();partial.c.runAction_=(_,fn)=>fn();partial.roster.getRange=()=>{throw Error('read failed');};
 assert.throws(()=>partial.c.seedDemoRoster(),/before changing demo data/);assert.equal(partial.queued,0);
});
check('derived-stage failures and skipped views appear in the result',()=>{
 for(const fn of ['seedDemoStats_','seedDemoPromotions_','seedDemoPatrolLog_','seedDemoSignups_','buildCoverageCore_','buildGroupSheets_','buildAcademySheets_','refreshDashboard_']){
  const f=fixture();f.c[fn]=()=>{throw Error('injected failure');};const result=f.c.seedDemoRosterCore_();assert(result.includes('⚠')&&result.includes('injected failure'),fn);
 }
 const f=fixture();f.c.buildGroupSheets_=()=>({skipped:[{name:'East',why:'invalid mapping'}]});assert(f.c.seedDemoRosterCore_().includes('East: invalid mapping'));
});
console.log(`${assertions} demo scenario groups passed; live services denied.`);
