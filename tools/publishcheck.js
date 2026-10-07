const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('RosterControlPanel.gs','utf8').replace(/\r\n/g,'\n');
const props=new Map([['PUBLIC_FILE','linked']]);let result={},scheduled=0,calls=0;
const p={getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)};
const ctx={Date,Number,String,CONFIG:{sheets:{tracker:'LOA',patrolLog:'Patrol',roster:'Roster'}},PropertiesService:{getDocumentProperties:()=>p},PUBLIC_FILE_PROP_:'PUBLIC_FILE',log_:()=>{},logInfo_:()=>{},publishPublicRoster_:()=>{calls++;if(result instanceof Error)throw result;return result}};
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
