// Fresh cross-runtime QA catalog. Unsafe services fail closed in the local runner.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const forbidden=name=>(...args)=>{throw Error('Forbidden service: '+name)};
const properties={};
const property={getProperty:k=>properties[k]??null,setProperty(k,v){properties[k]=String(v)},deleteProperty:k=>delete properties[k],getProperties:()=>({...properties})};
const ctx={console,Date,Math,JSON,PropertiesService:{getDocumentProperties:()=>property,getScriptProperties:()=>property},
 CacheService:{getDocumentCache:()=>({get:()=>null,remove(){},put(){}})},
 SpreadsheetApp:{getActive:forbidden('active workbook'),create:forbidden('create workbook')},
 UrlFetchApp:{fetch:forbidden('network')},ScriptApp:{newTrigger:forbidden('trigger')},Utilities:{getUuid:()=> 'qa-local-execution'}};
vm.createContext(ctx);
for(const file of ['RosterConfig.gs','RosterSystem.gs','RosterExtras.gs','RosterControlPanel.gs','RosterTrust.gs','RosterQA.gs'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
const results=ctx.qaExecuteCases_(ctx.qaCases_(),()=>0,1000);
const failures=results.filter(row=>row[2]!=='PASS');
if(failures.length){for(const row of failures)console.error(row.join(' | '));process.exitCode=1;}
else console.log('Fresh QA core: '+results.length+' cases passed without workbook, network or trigger access.');
// Runner semantics are separate from feature correctness: exceptions cannot be converted into PASS.
let calls=0;
const deliberate=ctx.qaExecuteCases_([
 {id:'failure',area:'Runner',run(){calls++;throw Error('injected quota failure')}},
 {id:'next',area:'Runner',run(){calls++}}
],()=>0,1000);
assert.equal(deliberate[0][2],'FAIL');assert.equal(deliberate[1][2],'PASS');assert.equal(calls,2);
const expired=ctx.qaExecuteCases_([{id:'deadline',area:'Runner',run(){throw Error('must not run')}}],()=>1001,1000);
assert.equal(expired[0][2],'NOT RUN');
const duplicate=ctx.qaCases_().map(test=>test.id);assert.equal(new Set(duplicate).size,duplicate.length,'case identifiers are unique');
assert.throws(()=>ctx.qaEqual_(new Date(NaN),null),'an invalid Date cannot masquerade as null');
assert.throws(()=>ctx.qaEqual_(NaN,null),'a non-finite number cannot masquerade as null');
assert.throws(()=>ctx.qaEqual_({a:undefined},{}),'missing keys and explicit undefined are distinct');
assert.throws(()=>ctx.qaEqual_([1,undefined],[1,null]),'undefined array elements and null are distinct');
assert.throws(()=>ctx.qaEqual_(Array(1),[]),'sparse arrays retain their length');
ctx.qaEqual_({a:1,b:2},{b:2,a:1});
console.log('Fresh QA runner: failure isolation, continued execution, deadline reporting and unique IDs passed.');
