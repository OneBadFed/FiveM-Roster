// Fresh service-failure matrices; no Google or network access.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
let requests=0,sleeps=[],status=204,retry=0,fetchError=null,writes=0;
const props={getProperty:()=>null,getProperties:()=>({}),setProperty(){},deleteProperty(){}};
const ctx={console,Date,Math,JSON,PropertiesService:{getDocumentProperties:()=>props,getScriptProperties:()=>props},
 Utilities:{getUuid:()=> 'qa-faults',sleep:n=>sleeps.push(n)},SpreadsheetApp:{getActive(){throw Error('Live workbook forbidden')},flush(){}},
 CacheService:{getDocumentCache:()=>({get:()=>null,put(){},remove(){}})},
 UrlFetchApp:{fetch(){requests++;if(fetchError)throw fetchError;return{getResponseCode:()=>status,getHeaders:()=>({'Retry-After':retry}),getContentText:()=>JSON.stringify({retry_after:retry})}}}};
vm.createContext(ctx);
for(const file of ['RosterConfig.gs','RosterSystem.gs','RosterExtras.gs','RosterControlPanel.gs'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
ctx.log_=ctx.logWarn_=ctx.logInfo_=()=>{};
let count=0;const check=(id,fn)=>{try{fn();count++}catch(e){console.error('FAIL '+id+': '+e.message);throw e}};
let schedule={},marker='';ctx.cfg_=()=>({kv:{ACTIVITY:schedule}});ctx.lastResetMarker_=()=>marker;
for(const enabled of [false,true])for(const cadence of ['MANUAL','WEEKLY','BIWEEKLY','MONTHLY'])for(const day of ['OFF','SUN']){
 schedule={AUTO_RESET:enabled,RESET_CADENCE:cadence,WEEKLY_HOURS_RESET:day};marker='';
 check('schedule.'+[enabled,cadence,day].join('.'),()=>assert.equal(ctx.resetDue_(),enabled&&cadence!=='MANUAL'&&(cadence==='MONTHLY'||day!=='OFF')));
}
for(const value of ['broken','-1',String(Date.now()+86400000)]){
 schedule={AUTO_RESET:true,RESET_CADENCE:'BIWEEKLY',WEEKLY_HOURS_RESET:'SUN'};marker=value;
 check('schedule.invalid-marker',()=>assert.equal(ctx.resetDue_(),false));
}
for(const code of [200,204,400,401,403,404,429,500,503]){
 status=code;retry=1;requests=0;sleeps=[];fetchError=null;
 check('webhook.status.'+code,()=>{const r=ctx.postToWebhook_('https://example.invalid/webhook',{content:'QA'});assert.equal(r.ok,code>=200&&code<300);assert.equal(requests,code===429?2:1)});
}
status=429;retry=6;requests=0;sleeps=[];
check('webhook.long-delay',()=>{assert.equal(ctx.postToWebhook_('https://example.invalid/webhook',{}).ok,false);assert.equal(requests,1);assert.equal(sleeps.length,0)});
fetchError=Error('injected transport');check('webhook.transport',()=>assert.equal(ctx.postToWebhook_('https://example.invalid/webhook',{}).ok,false));fetchError=null;
requests=0;check('webhook.no-url',()=>{assert.equal(ctx.postToWebhook_('',{}).ok,false);assert.equal(requests,0)});
ctx.parseBlocks_=()=>({});ctx.cpBlockPresent_=()=>true;ctx.setKvValue_=()=>{writes++;return true};ctx.setTableRows_=()=>writes++;ctx.cfgInvalidate_=()=>{};
for(const payload of [
 {kv:[{block:'ROSTER_LAYOUT',key:'HEADER_ROW',value:'abc'}]},
 {kv:[{block:'SYSTEM',key:'SYSTEM_NAME',value:'valid'},{block:'ROSTER_LAYOUT',key:'HEADER_ROW',value:'abc'}]},
 {tables:{STATUS_OVERRIDES:[['RANK','Officer','Missing:0']]}},
 {tables:{STATUSES:[['High','TIER','5',''],['Low','TIER','5','']]}},
])check('settings.invalid',()=>{writes=0;const res=ctx.cpApplyConfig_({},payload);assert.equal(res.ok,false);assert.equal(writes,0)});
for(const payload of [{kv:[{block:'SYSTEM',key:'SCHEMA_VERSION',value:'99'}]},{kv:[{block:'UNKNOWN',key:'X',value:'Y'}]},{tables:{RANKS:[['Cadet','TRAINING','DROP ME']]}}]){
 check('settings.rejected',()=>{writes=0;assert.throws(()=>ctx.cpApplyConfig_({},payload));assert.equal(writes,0)});
}
for(const endpoint of ['__proto__','constructor','setupWizard','devResetForNewDepartment','qaRunAll','SpreadsheetApp'])check('dispatch.denied.'+endpoint,()=>assert.throws(()=>ctx.dispatch(endpoint,[])));
console.log('Fresh what-if matrices: '+count+' scheduling, webhook, prospective-save and dispatch scenarios passed.');
