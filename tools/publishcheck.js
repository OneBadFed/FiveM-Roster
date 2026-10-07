const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('RosterControlPanel.gs','utf8').replace(/\r\n/g,'\n');
const props=new Map([['PUBLIC_FILE','linked']]);let result={},scheduled=0,calls=0;
const p={getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)};
const ctx={Date,Number,String,LockService:{getDocumentLock:()=>({tryLock:()=>true,releaseLock(){}})},CONFIG:{sheets:{tracker:'LOA',patrolLog:'Patrol',roster:'Roster'}},PropertiesService:{getDocumentProperties:()=>p},PUBLIC_FILE_PROP_:'PUBLIC_FILE',log_:()=>{},logInfo_:()=>{},publishPublicRoster_:()=>{calls++;if(result instanceof Error)throw result;return result}};
vm.createContext(ctx);vm.runInContext(s.slice(s.indexOf('const PUBLISH_MIN_GAP_MS_'),s.indexOf('/** Menu: publish now and report.')),ctx);
ctx.scheduleCatchup_=()=>scheduled++;
for(const outcome of [{failed:true},{aborted:true},new Error('temporary failure')]){result=outcome;p.setProperty('PUBLIC_DIRTY','1');ctx.publishPublicRosterQuiet_();assert.equal(p.getProperty('PUBLIC_DIRTY'),'1','failed passes stay queued');}
result={linked:true,tabs:[],rows:0,failed:true};ctx.publishPublicRoster();assert.equal(p.getProperty('PUBLIC_DIRTY'),'1');
result=new Error('temporary failure');assert.throws(()=>ctx.publishPublicRoster());assert.equal(p.getProperty('PUBLIC_DIRTY'),'1');
result={linked:true};ctx.publishPublicRosterQuiet_();assert.equal(p.getProperty('PUBLIC_DIRTY'),undefined,'successful full pass clears queue');
const before=calls;ctx.publishOnChange({changeType:'FORMAT'});assert.equal(scheduled,1);assert.equal(calls,before);
ctx.publishOnChange({range:{getSheet:()=>({getName:()=> 'LOA'})}});assert.equal(scheduled,2);assert.equal(calls,before,'table edits wait for sorting');
assert(s.includes('indexOf(name) === -1 && publishSelfComputing_(dest)'),'framed mirrors bypass spill-sheet skip');
console.log('Publishing: retry flags, successful clearing, format catch-up and settled table edits passed');

let flushes=0;ctx.SpreadsheetApp={flush:()=>flushes++};
result={linked:true};p.setProperty('PUBLISH_BACKOFF_UNTIL',String(Date.now()+45000));
ctx.publishTableSettled_('LOA');const settledBefore=calls;ctx.publishAfterWrite_();
assert.equal(calls,settledBefore+1,'completed table publishes immediately');
assert.equal(flushes,1,'flush completed writes before mirroring');
assert.equal(p.getProperty('PUBLISH_BACKOFF_UNTIL'),undefined,'completed writes release backoff');
result=new Error('mirror failed');ctx.publishAfterWrite_(['Patrol']);
assert.equal(p.getProperty('PUBLIC_DIRTY'),'1','immediate mirror failure remains queued');
console.log('Immediate publishing: settled table queue, flush, backoff release and retry passed');

// Atomic pass claims and ownership-safe cleanup.
p.deleteProperty('PUBLIC_CATCHUP_AT');assert(ctx.publishPassClaim_());
const owned=p.getProperty('PUBLISH_PASS_UNTIL');assert(!ctx.publishPassClaim_(),'active lease cannot be claimed twice');
p.setProperty('PUBLISH_PASS_UNTIL',String(Date.now()+600000)+'|another-owner');ctx.publishPassRelease_();
assert(p.getProperty('PUBLISH_PASS_UNTIL').endsWith('|another-owner'),'old owner cannot release a different pass');
p.deleteProperty('PUBLISH_PASS_UNTIL');ctx.LockService.getDocumentLock=()=>({tryLock:()=>false});assert(!ctx.publishPassClaim_(),'lock contention fails closed');
ctx.LockService.getDocumentLock=()=>({tryLock:()=>true,releaseLock(){}});
assert(ctx.publishPassClaim_());ctx.publishPassRelease_();assert.equal(p.getProperty('PUBLISH_PASS_UNTIL'),undefined);

// Real read/header/dimension helpers, including formatting-only canvas dimensions.
ctx.norm_=v=>String(v).trim().toUpperCase();
vm.runInContext(s.slice(s.indexOf('function publishReadCells_('),s.indexOf('/**',s.indexOf('function publishReadCells_('))),ctx);
let values=ctx.publishReadCells_({getValues:()=>[['=literal',12]],getFormulas:()=>[['','=SUM(A1)']]},true);
assert.equal(values[0][0],"'=literal");assert.equal(values[0][1],12);
values=ctx.publishReadCells_({getValues:()=>[['=literal',12]],getFormulas:()=>[['','=SUM(A1)']]},false);assert.equal(values[0][1],'=SUM(A1)');
vm.runInContext(s.slice(s.indexOf('function publishHeaderRow_('),s.indexOf('/**',s.indexOf('function publishHeaderRow_('))),ctx);
assert.equal(ctx.publishHeaderRow_({getLastRow:()=>3,getLastColumn:()=>5,getRange:()=>({getDisplayValues:()=>[['Title','','','',''],['NAME','RANK','EMAIL','',''],['Member','Officer','private','filled','filled']]})}),2,'dense data cannot beat real headers');
vm.runInContext(s.slice(s.indexOf('function publishCopyDimensions_('),s.indexOf('function publishMirrorTab_(')),ctx);
const dimensionCalls=[];
ctx.publishCopyDimensions_({getRowHeight:r=>r<=500?24:32,getColumnWidth:()=>100},{setRowHeightsForced:(...args)=>dimensionCalls.push(['rows',...args]),setColumnWidths:(...args)=>dimensionCalls.push(['cols',...args])},1000,40);
assert.equal(dimensionCalls.length,3,'1040 individual writes reduced to 3 grouped writes');assert.deepEqual(dimensionCalls[1],['rows',501,500,32]);
assert(s.includes("if (failed) throw new Error(dest.getName()"),'partial writes must propagate failure');
console.log('Publishing audit: atomic leases, owner-safe release, text safety, header detection and 1040-to-3 dimension writes passed.');

ctx.tabKey_=ctx.norm_;
vm.runInContext(s.slice(s.indexOf('function publishMirrorTab_('),s.indexOf('function publishPublicRoster_(')),ctx);
ctx.publishKeepMask_=()=>[[false,false],[false,false]];
let emptied=null;ctx.writeValuesSafe_=(dest,r,c,values)=>{emptied=values;return 0;};
ctx.publishMirrorTab_({getName:()=> 'Empty',getLastRow:()=>0,getLastColumn:()=>0},{getName:()=> 'Empty',getLastRow:()=>2,getLastColumn:()=>2,getRange:()=>({getDisplayValues:()=>[['old','data']]})},false);
assert.equal(emptied.length,2);assert(emptied.every(row=>row.every(cell=>cell==='')),'empty source clears stale public content');
ctx.writeValuesSafe_=()=>1;
assert.throws(()=>ctx.publishMirrorTab_({getName:()=> 'Empty',getLastRow:()=>0,getLastColumn:()=>0},{getName:()=> 'Empty',getLastRow:()=>2,getLastColumn:()=>2,getRange:()=>({getDisplayValues:()=>[['old','data']]})},false),/cleanup failed/);
console.log('Publishing audit: empty-source cleanup and cleanup failures passed.');
ctx.CONFIG.sheets.signups='Applications';ctx.CONFIG.sheets.form='Leave intake';ctx.CONFIG_SHEET_NAME='Config';ctx.SYS_LOG_SHEET='SYS Log';ctx.cfg_=()=>{throw new Error('unreadable config');};
vm.runInContext(s.slice(s.indexOf('function publishTabBlocked_('),s.indexOf('/** Header labels',s.indexOf('function publishTabBlocked_('))),ctx);
assert(ctx.publishTabBlocked_('Applications'),'renamed signups stay private even if cfg read fails');
assert(ctx.publishTabBlocked_('Leave intake'),'raw form response tab stays private');assert(!ctx.publishTabBlocked_('Roster'));
