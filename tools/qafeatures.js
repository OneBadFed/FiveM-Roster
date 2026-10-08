// Additional feature-boundary and service-failure scenarios. No production or network access.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const files=['RosterConfig.gs','RosterSystem.gs','RosterExtras.gs','RosterControlPanel.gs','RosterTrust.gs'];
const forbidden=()=>{throw Error('Unexpected live service access')};
function runtime(){
 const data={},props={getProperty:k=>data[k]??null,getProperties:()=>({...data}),setProperty(k,v){data[k]=String(v)},deleteProperty(k){delete data[k]}};
 const ctx={console:{log(){},warn(){},error(){}},Date,Math,JSON,PropertiesService:{getDocumentProperties:()=>props,getScriptProperties:()=>props},
  SpreadsheetApp:{getActive:forbidden,create:forbidden,flush(){}},UrlFetchApp:{fetch:forbidden},FormApp:{create:forbidden},ScriptApp:{newTrigger:forbidden},
  CacheService:{getDocumentCache:()=>({get:()=>null,put(){},remove(){}})},Utilities:{getUuid:()=> 'qa-features'}};
 vm.createContext(ctx);for(const file of files)vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
 ctx.log_=ctx.logWarn_=ctx.logInfo_=()=>{};ctx.perf_=(label,fn)=>fn();ctx.maybeErrorWebhook_=()=>{};
 return ctx;
}
const results=[];
function check(id,fn){try{fn();results.push({id,status:'PASS'})}catch(e){results.push({id,status:'FAIL',detail:e.stack});console.error(id+': '+e.message)}}
const json=x=>JSON.parse(JSON.stringify(x));
// Check every whitelisted route's argument order/return value, invalid containers and error boundary.
// Endpoint implementations are covered by the feature tests below and complementary regression suites.
const routing=runtime(),routes=vm.runInContext('Object.keys(DISPATCH_ENDPOINTS_)',routing);
const routeSource=fs.readFileSync('RosterControlPanel.gs','utf8').match(/const DISPATCH_ENDPOINTS_[\s\S]*?\n\}\);/)[0];
for(const name of routes){
 const line=routeSource.split('\n').find(l=>l.trim().startsWith(name+':'));
 const target=name==='cpOpenSettings'?'openSettingsPanel':name;
 const params=line.match(/:\s*\(([^)]*)\)/)[1].split(',').map(x=>x.trim()).filter(Boolean);
 const args=params.map((p,i)=>({argument:i,name:p}));let received;
 routing[target]=(...a)=>{received=a;return {route:name}};
 check('dispatch.route.'+name,()=>{const r=routing.dispatch(name,args);assert.deepEqual(json(received),args);assert.deepEqual(json(r),name==='cpOpenSettings'?true:{route:name})});
 check('dispatch.shape.'+name,()=>{for(const bad of [{},'arguments',42,Array(21).fill(null)])assert.throws(()=>routing.dispatch(name,bad),/E-507/)});
 routing[target]=()=>{throw Error('injected endpoint failure')};
 check('dispatch.failure.'+name,()=>assert.throws(()=>routing.dispatch(name,args),/E-601/));
}
for(const name of [null,42,{},'__proto__','constructor','toString','qaRunAll','devResetForNewDepartment','setupWizard'])check('dispatch.refuse.'+String(name),()=>assert.throws(()=>routing.dispatch(name,[]),/E-50[67]/));

// Notifications: all template events, toggles, fallback failures, message-only and mention placement.
const notify=runtime(),cfg={embedTpl:{}};Object.defineProperty(notify,'CONFIG',{value:cfg,configurable:true});
const fallback={description:'Built-in QA'};let posts=[];notify.sendWebhookPayload_=(payload,channel)=>posts.push({payload,channel});notify.embedChrome_=()=>({footer:{text:'Shared footer'}});
const events=['audit','signupSubmitted','loaSubmitted','loaApproved','loaStarted','loaExpired','patrolLogged','patrolFlagged','error'];
for(const event of events)for(const mode of ['missing','custom','message-only','disabled','empty'])check('notification.'+event+'.'+mode,()=>{
 posts=[];cfg.embedTpl={};
 if(mode==='custom')cfg.embedTpl[event]={desc:'{name} has {hours} hours',content:'Hello {user}'};
 if(mode==='message-only')cfg.embedTpl[event]={sendEmbed:false,content:'Hello {name}'};
 if(mode==='empty')cfg.embedTpl[event]={sendEmbed:false};
 notify.notifyEvent_('LOA',mode!=='disabled',event,{name:'QA',hours:0},fallback,mode==='empty'?'':'<@1234567890123456789>');
 if(mode==='disabled'||mode==='empty'){assert.equal(posts.length,0);return;}
 assert.equal(posts.length,1);assert.equal(posts[0].channel,'LOA');const p=posts[0].payload;
 assert.equal((p.content.match(/<@1234567890123456789>/g)||[]).length,1,'mention appears once');
 if(mode==='message-only')assert(!p.embeds);else{assert.equal(p.embeds.length,1);assert(p.embeds[0].timestamp);assert.equal(p.embeds[0].description,mode==='custom'?'QA has 0 hours':'Built-in QA');assert.equal(!!p.embeds[0].footer,mode==='missing')}
});
check('notification.limits',()=>{
 cfg.embedTpl={qa:{title:'A'.repeat(1000),desc:'B'.repeat(9000),author:'C'.repeat(1000),footer:'D'.repeat(4000),image:'javascript:bad',fields:Array.from({length:30},()=>({n:'E'.repeat(1000),v:'F'.repeat(3000)}))}};
 const e=notify.embedFromTemplate_('qa',{},fallback);assert.equal(e.title.length,256);assert.equal(e.description.length,4000);assert.equal(e.author.name.length,256);assert.equal(e.footer.text.length,2048);assert.equal(e.fields.length,25);assert(e.fields.every(f=>f.name.length===256&&f.value.length===1024));assert(!e.image);
});
check('notification.template.failure',()=>{cfg.embedTpl={qa:{get desc(){throw Error('unreadable template')}}};assert.strictEqual(notify.embedFromTemplate_('qa',{},fallback),fallback)});
check('notification.transport.failure',()=>{cfg.embedTpl={};notify.sendWebhookPayload_=()=>{throw Error('outage')};assert.doesNotThrow(()=>notify.notifyEvent_('ERRORS',true,'error',{},fallback,''));assert.doesNotThrow(()=>notify.notifyCh_('AUDIT',true,fallback,''))});

// The real ID resolver must relocate an exact member and refuse missing/ambiguous IDs.
const identity=runtime();Object.defineProperty(identity,'CONFIG',{value:{rosterStartRow:8},configurable:true});identity.rosterCols_=()=>({discord:2});identity.cpAssertSlotRow_=(_,row)=>{if(!Number.isInteger(row)||row<8||row>10)throw Error('Invalid slot')};
const id='1234567890123456789',other='2234567890123456789';let ids=[];
const roster={getLastRow:()=>7+ids.length,getRange:()=>({getDisplayValues:()=>ids.map(x=>[x])})};
for(const row of [8,9,999,0])check('identity.relocated.'+row,()=>{ids=[other,id,''];assert.equal(identity.cpResolveMemberRow_(roster,row,id),9)});
for(const list of [[],[other,'',''],[id,other,id]])check('identity.refused.'+JSON.stringify(list),()=>{ids=list;assert.throws(()=>identity.cpResolveMemberRow_(roster,8,id))});
for(const row of [-1,7,8.5,Infinity,NaN])check('identity.legacy.slot.'+String(row),()=>assert.throws(()=>identity.cpResolveMemberRow_(roster,row,'')));

// Submission keys disambiguate repeated IDs. A stale key can never edit a different applicant.
identity.signupCols_=()=>({dataStart:8,discord:2});let submissions=[];
const signup={getLastRow:()=>7+submissions.length,getRange:(r,c,n=1)=>({getDisplayValues:()=>submissions.slice(r-8,r-8+n).map(x=>[x[c-1]]),getDisplayValue:()=>submissions[r-8][c-1]})};
check('signup.exact.key',()=>{submissions=[['K1',id],['K2',id]];assert.equal(identity.signupResolveRow_(signup,8,id,'K2'),9);assert.throws(()=>identity.signupResolveRow_(signup,8,id,''),/ambiguous/)});
for(const list of [[],[['K1',id]],[['K2',other]],[['K2',id],['K2',id]]])check('signup.stale.key.'+JSON.stringify(list),()=>{submissions=list;assert.throws(()=>identity.signupResolveRow_(signup,8,id,'K2'))});
for(const row of [7,8.5,11,NaN])check('signup.invalid.row.'+row,()=>{submissions=[['K1',id]];assert.throws(()=>identity.signupResolveRow_(signup,row,'',''))});

// Scheduling uses the real scheduling core; sheet-facing reads/writes are observable synthetic services.
const leave=runtime(),leaveCfg={leaveTypes:['LOA'],pendingStatus:'Pending',approvedStatus:'Approved',sheets:{tracker:'LOA'},idMinDigits:17,idMaxDigits:19};Object.defineProperty(leave,'CONFIG',{value:leaveCfg,configurable:true});
let writes=0,applied=0,dedup={},member={filled:true,discord:id,name:'QA',rank:'Cadet',callsign:'C-01',status:'Active'};
leave.trackerLeaveType_=()=> 'LOA';leave.cpResolveMemberRow_=()=>8;leave.cpMemberAt_=()=>member;leave.buildSyncedKeySet_=()=>dedup;leave.rosterOocShift_=()=>({ooc:'QA',shift:'Day'});leave.trackerCols_=()=>({width:10});
let built;leave.buildTrackerRow_=(_,width,values)=>{built=values;return []};leave.sortTracker_=()=>writes++;leave.updateRosterStatus=()=>applied++;leave.todayInSheetTz_=()=>new Date(2026,9,8);leave.isProtectedStatus_=s=>s==='Reserve';leave.sendDiscordWebhook=forbidden;
const request={row:8,expectedId:id,start:'2026-10-07',end:'2026-10-09',status:'Pending'};
for(const [field,value] of [['start',''],['end','bad'],['start','2026-02-30'],['end','2026-10-01'],['status','Processed']])check('leave.invalid.'+field+'.'+value,()=>{writes=0;assert.throws(()=>leave.cpScheduleLeave_({}, {},{...request,[field]:value},{sendWebhooks:false}));assert.equal(writes,0)});
for(const [status,current,start,end,expected] of [['Pending','Active','2026-10-07','2026-10-09',false],['Approved','Active','2026-10-07','2026-10-09',true],['Approved','Reserve','2026-10-07','2026-10-09',false],['Approved','LOA','2026-10-07','2026-10-09',true],['Approved','Active','2026-10-09','2026-10-10',false],['Approved','Active','2026-10-07','2026-10-08',false]])check('leave.lifecycle.'+[status,current,start,end].join('.'),()=>{
 writes=0;applied=0;member.status=current;const r=leave.cpScheduleLeave_({}, {},{...request,status,start,end},{sendWebhooks:false});assert.equal(r.applied,expected);assert.equal(applied,expected?1:0);assert.equal(writes,1);assert.equal(built.discord,id);
});
check('leave.duplicate',()=>{dedup={[leave.makeLeaveKey_(id,`${new Date(2026,9,7).getTime()}-${new Date(2026,9,9).getTime()}-LOA`)]:true};writes=0;assert.throws(()=>leave.cpScheduleLeave_({}, {},request,{sendWebhooks:false}),/already/);assert.equal(writes,0);dedup={}});
check('leave.empty.settings',()=>{leaveCfg.leaveTypes=[];writes=0;assert.throws(()=>leave.cpScheduleLeave_({}, {},request,{sendWebhooks:false}),/Configure/);assert.equal(writes,0);leaveCfg.leaveTypes=['LOA']});
check('leave.missing.tracker',()=>assert.throws(()=>leave.cpScheduleLeave_({},null,request,{sendWebhooks:false}),/not found/));
for(const change of [{filled:false},{discord:'bad'}])check('leave.member.invalid.'+JSON.stringify(change),()=>{const saved=member;member={...member,...change};writes=0;assert.throws(()=>leave.cpScheduleLeave_({}, {},request,{sendWebhooks:false}));assert.equal(writes,0);member=saved});

// Recovery decoder: reject corrupt records before any roster write is possible.
const recover=runtime();const tx={version:1,book:'QA',sheet:7,final:'1|'+id,changes:[{id,before:0,after:1}]};
check('patrol.recovery.valid',()=>assert.deepEqual(json(recover.patrolCreditTransaction_('RE_CREDIT_V1:'+JSON.stringify(tx))),tx));
for(const [field,value] of [['version',2],['book',''],['sheet',1.5],['final','RE_CREDIT_V1:again'],['changes',[]],['changes',[...tx.changes,...tx.changes]],['changes',[{id:'bad',before:0,after:1}]],['changes',[{id,before:'0',after:1}]],['changes',[{id,before:0,after:null}]]])check('patrol.recovery.invalid.'+field+'.'+JSON.stringify(value),()=>assert.throws(()=>recover.patrolCreditTransaction_('RE_CREDIT_V1:'+JSON.stringify({...tx,[field]:value}))));
check('patrol.recovery.nonfinite',()=>assert.throws(()=>recover.patrolCreditTransaction_('RE_CREDIT_V1:{"version":1,"book":"QA","sheet":7,"final":"done","changes":[{"id":"'+id+'","before":0,"after":1e999}]}')));
check('patrol.recovery.malformed',()=>assert.throws(()=>recover.patrolCreditTransaction_('RE_CREDIT_V1:not JSON')));
check('patrol.recovery.ordinary.marker',()=>assert.equal(recover.patrolCreditTransaction_('2|'+id),null));

// Upload types and storage limit reject before the store is invoked; all supported image MIME types work.
const icons=runtime();let stored=0;icons.setRankIconStore_=()=>stored++;
for(const mime of ['png','jpeg','webp','gif'])check('icons.mime.'+mime,()=>{stored=0;assert.equal(icons.cpSetRankIcon('Cadet','data:image/'+mime+';base64,QUJD').ok,true);assert.equal(stored,1)});
for(const uri of ['',null,'https://example.invalid/icon.png','data:image/svg+xml;base64,QUJD','data:image/png;base64,***','data:image/png;base64,'+'A'.repeat(16001)])check('icons.reject.'+String(uri).slice(0,45),()=>{stored=0;assert.throws(()=>icons.cpSetRankIcon('Cadet',uri));assert.equal(stored,0)});
check('icons.rank.required',()=>{stored=0;assert.throws(()=>icons.cpSetRankIcon('','data:image/png;base64,QUJD'));assert.equal(stored,0)});

const delivery=runtime();let deliveries=0;delivery.webhookFor_=()=> 'https://example.invalid/webhook';delivery.postToWebhook_=(url,payload)=>{deliveries++;assert.equal(payload.content.length,2000);assert(payload.embeds[0].description.length<=4096);return{ok:true,code:204}};
check('notification.delivery.bounded',()=>{assert.equal(delivery.sendWebhookPayload_({content:'X'.repeat(3000),embeds:[{description:'Y'.repeat(9000)}]},'AUDIT').ok,true);assert.equal(deliveries,1)});
check('notification.delivery.invalid',()=>{const before=deliveries;const r=delivery.sendWebhookPayload_({embeds:{}},'AUDIT');assert.equal(r.ok,false);assert.equal(deliveries,before)});
check('notification.delivery.sandbox',()=>{const before=deliveries;vm.runInContext('DEV_WEBHOOKS_OFF_=true',delivery);delivery.webhookFor_=forbidden;assert.equal(delivery.sendWebhookPayload_({embeds:{}},'AUDIT').suppressed,true);assert.equal(deliveries,before)});
assert.equal(new Set(results.map(r=>r.id)).size,results.length,'feature/fault case IDs must be unique');

fs.mkdirSync('tools/.qa',{recursive:true});fs.writeFileSync('tools/.qa/features.json',JSON.stringify({when:new Date().toISOString(),results},null,2));
const failed=results.filter(r=>r.status==='FAIL');console.log('Fresh feature/fault scenarios: '+results.length+' tested; '+failed.length+' failed.');if(failed.length)process.exitCode=1;
