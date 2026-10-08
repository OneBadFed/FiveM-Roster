const fs=require('fs'),vm=require('vm'),assert=require('assert');
const fast=fs.readFileSync('RosterPublishFast.gs','utf8'),panel=fs.readFileSync('RosterControlPanel.gs','utf8');
function harness(){
 const data=new Map([['PUBLIC_FILE','linked']]),log=[],calls=[];
 let reads=0,now=1000000,held=false,busy=false;
 const props={getProperty:k=>data.get(k),setProperty:(k,v)=>data.set(k,v),deleteProperty:k=>data.delete(k),getProperties:()=>{reads++;return Object.fromEntries(data);}};
 const lock={hasLock:()=>held,tryLock:()=>{if(busy)return false;held=true;return true;},releaseLock:()=>{held=false;}};
 const ctx={Date:{now:()=>now},CONFIG:{sheets:{welcome:'Welcome Page',tracker:'LOA',patrolLog:'Patrol',roster:'Roster'}},CONFIG_SHEET_NAME:'Config',PUBLIC_FILE_PROP_:'PUBLIC_FILE',
  LockService:{getDocumentLock:()=>lock,getScriptLock:()=>lock},PropertiesService:{getDocumentProperties:()=>props},
  norm_:v=>String(v||'').trim().toUpperCase(),tabKey_:v=>String(v||'').replace(/^[^a-z]+/i,'').trim().toUpperCase(),
  log_:(...x)=>log.push(x),logInfo_:(...x)=>log.push(x),logWarn_:(...x)=>log.push(x),reportError_:(...x)=>log.push(x),diagnosticText_:s=>String(s),
  publishTabBlocked_:n=>n==='Signups',SpreadsheetApp:{flush(){}},
  publishPublicRoster_:selection=>{calls.push(selection);return {linked:true,tabs:[],rows:0};}};
 vm.createContext(ctx);vm.runInContext(fast,ctx);
 vm.runInContext(panel.slice(panel.indexOf('const PUBLISH_MIN_GAP_MS_'),panel.indexOf('/** Menu: publish now and report.')),ctx);
 return {ctx,data,props,log,calls,reads:()=>reads,time:n=>now=n,busy:v=>busy=v,held:()=>held};
}
const copy=v=>JSON.parse(JSON.stringify(v));
const h=harness(),c=h.ctx;
c.publishQueueChange_(['LOA','Patrol','LOA']);assert.deepEqual(copy(c.publishQueueTake_('LOA')),['LOA']);
assert.deepEqual(copy(c.publishQueueTake_()),['Patrol']);assert(!h.data.has('PUBLIC_DIRTY'));
h.props.setProperty('PUBLIC_DIRTY','1');assert.deepEqual(copy(c.publishQueueTake_()),{except:[]},'legacy flag means full work');
h.props.setProperty('PUBLIC_DIRTY','1');h.props.setProperty('PUBLIC_PENDING_SCOPE_V1','broken');assert.deepEqual(copy(c.publishQueueTake_()),{except:[]},'unreadable scopes cannot drop work');
h.props.setProperty('PUBLIC_DIRTY','1');h.props.setProperty('PUBLIC_PENDING_SCOPE_V1','{"all":false,"tabs":[null,""]}');assert.deepEqual(copy(c.publishQueueTake_()),{except:[]},'unusable tab scopes must fail open to full work');
c.publishQueueChange_();c.publishQueueTake_(['LOA','Patrol']);const rest=c.publishQueueTake_();
assert(!c.publishSelected_('LOA',rest));assert(c.publishSelected_('Roster',rest));
c.publishQueueChange_(['Patrol']);c.publishQueueRetry_(rest);const retry=c.publishQueueTake_();
assert(c.publishSelected_('Patrol',retry),'concurrent edit overrides previous exclusion');assert(!c.publishSelected_('LOA',retry));
c.publishQueueChange_();c.publishQueueTake_('LOA');c.publishQueueChange_('LOA');assert(c.publishSelected_('LOA',c.publishQueueTake_()),'new edits requeue covered tabs');
c.publishQueueChange_('LOA');const work=c.publishQueueTake_();c.publishQueueChange_('Patrol');c.publishQueueRetry_(work);assert.deepEqual(copy(c.publishQueueTake_()).sort(),['LOA','Patrol']);
c.publishQueueChange_();c.publishQueueTake_('LOA');const fullRest=c.publishQueueTake_();c.publishQueueChange_();c.publishQueueTake_('Patrol');c.publishQueueRetry_(fullRest);
assert.deepEqual(copy(c.publishQueueTake_()),{except:[]},'merging full work keeps only common exclusions');
assert(c.publishSelected_('👋 Welcome Page',['Welcome Page']));assert(!c.publishSelected_('Patrol',['Welcome Page']));
c.publishQueueChange_();c.publishQueueTake_('👋 Welcome Page');c.publishQueueChange_('Welcome Page');assert(c.publishSelected_('👋 Welcome Page',c.publishQueueTake_()),'emoji aliases cannot lose a new Welcome edit');
c.publishQueueRetry_(undefined,['LOA']);assert(!c.publishSelected_('LOA',c.publishQueueTake_()),'successful tabs are excluded from a failed full pass retry');
c.publishQueueRetry_(['LOA','Patrol'],['LOA']);assert.deepEqual(copy(c.publishQueueTake_()),['Patrol']);
c.publishQueueChange_(['😀'.repeat(2100)]);assert.deepEqual(copy(c.publishQueueTake_()),{except:[]},'oversized UTF-8 property data falls back to full work');
h.busy(true);assert.throws(()=>c.publishQueueChange_('LOA'),/queue is busy/);h.busy(false);assert(!h.held());
// Actual wrapper integration: one settled-table pass, scoped retries and late edits survive.
c.publishQueueChange_();c.publishAfterWrite_(['LOA','Patrol','LOA']);assert.deepEqual(copy(h.calls.pop()),['LOA','Patrol']);
c.publishPublicRosterQuiet_();assert.deepEqual(copy(h.calls.pop()),{except:['LOA','Patrol']});assert(!h.data.has('PUBLIC_DIRTY'));
c.publishPublicRoster_=selection=>{h.calls.push(selection);c.publishQueueChange_('Patrol');return {failed:true};};
c.publishQueueChange_('LOA');c.publishPublicRosterQuiet_();assert.deepEqual(copy(c.publishQueueTake_()).sort(),['LOA','Patrol']);
c.publishPublicRoster_=selection=>{h.calls.push(selection);c.publishQueueChange_('Patrol');return {linked:true};};
c.publishQueueChange_('LOA');c.publishPublicRosterQuiet_();assert.deepEqual(copy(c.publishQueueTake_()),['Patrol'],'success never clears a mid-pass edit');
let scheduled=0;c.scheduleCatchup_=()=>scheduled++;h.time(2000000);h.props.setProperty('PUBLIC_LAST_PUBLISH','2000000');
c.publishOnChange({range:{getSheet:()=>({getName:()=> 'Day Shift'})}});assert.equal(scheduled,1);assert.deepEqual(copy(c.publishQueueTake_()),['Day Shift']);
c.publishOnChange({changeType:'EDIT'});assert(!h.data.has('PUBLIC_DIRTY'),'paired EDIT change cannot duplicate installed onEdit');
c.publishOnChange({range:{getSheet:()=>({getName:()=> 'Signups'})}});assert(!h.data.has('PUBLIC_DIRTY'),'internal tab edits never queue a public copy');
c.publishOnChange({changeType:'FORMAT'});assert.deepEqual(copy(c.publishQueueTake_()),{except:[]},'unscoped formatting events still publish every eligible tab');
console.log('Fast publish queue: scoped work, legacy fallback, exclusions, retries, lock contention, concurrent writes and real wrappers passed.');

// Welcome application status is edited in AA5:AA6 (often a merged dropdown).
const status=harness();let statusSchedules=0;status.ctx.scheduleCatchup_=()=>statusSchedules++;
const welcomeEdit={value:'Applications open',range:{getSheet:()=>({getName:()=> '👋 Welcome Page'}),getRow:()=>5,getColumn:()=>27,getNumRows:()=>2,getNumColumns:()=>1}};
status.ctx.publishOnChange(welcomeEdit);assert.deepEqual(copy(status.calls.pop()),['👋 Welcome Page']);assert(!status.data.has('PUBLIC_DIRTY'),'AA5:AA6 publishes without forcing the roster');
status.time(1001000);status.ctx.publishOnChange(welcomeEdit);assert.equal(statusSchedules,1);assert.deepEqual(copy(status.ctx.publishQueueTake_()),['👋 Welcome Page'],'rapid dropdown changes retain the latest Welcome update');
status.time(1010000);status.data.set('PUBLISH_BACKOFF_UNTIL','1045000');status.ctx.publishOnChange(welcomeEdit);assert.equal(statusSchedules,2,'backoff-declined Welcome update gets a catch-up');
status.data.delete('PUBLISH_BACKOFF_UNTIL');status.data.set('PUBLISH_PASS_UNTIL','1500000|another-pass');status.ctx.publishOnChange(welcomeEdit);assert.equal(statusSchedules,3,'busy publish-declined Welcome update gets a catch-up');
status.data.delete('PUBLISH_PASS_UNTIL');status.ctx.publishPublicRosterQuiet_();assert.deepEqual(copy(status.calls.pop()),['👋 Welcome Page']);assert(!status.data.has('PUBLIC_DIRTY'));
console.log('Welcome status: AA5:AA6 edit, merged dropdown, rapid changes, backoff, busy publisher and automatic catch-up passed.');

// Simulate a hard stop after taking work: no catch/finally/retry from that run.
const stopped=harness();stopped.ctx.publishQueueChange_('LOA');assert(stopped.ctx.publishPassClaim_());stopped.ctx.publishQueueBegin_();
assert(!stopped.data.has('PUBLIC_DIRTY'));assert(stopped.data.has('PUBLIC_INFLIGHT_SCOPE_V1'));
stopped.ctx.publishQueueChange_('Patrol');assert(!stopped.ctx.publishPassClaim_(),'live publisher lease still owns work');
stopped.time(1700000);assert(stopped.ctx.publishPassClaim_(),'expired execution can be recovered');
assert.deepEqual(copy(stopped.ctx.publishQueueTake_()).sort(),['LOA','Patrol'],'orphaned work merges with concurrent edits');stopped.ctx.publishPassRelease_();
stopped.data.set('PUBLIC_INFLIGHT_SCOPE_V1','broken');assert(stopped.ctx.publishPassClaim_());assert.deepEqual(copy(stopped.ctx.publishQueueTake_()),{except:[]});stopped.ctx.publishPassRelease_();
stopped.ctx.publishQueueChange_('LOA');stopped.ctx.publishPublicRosterQuiet_();assert(!stopped.data.has('PUBLIC_INFLIGHT_SCOPE_V1'),'normal completed work releases durable record');
stopped.data.set('PUBLIC_INFLIGHT_SCOPE_V1','{"token":"new-owner","selection":["LOA"]}');stopped.ctx.publishQueueFinish_();assert(stopped.data.has('PUBLIC_INFLIGHT_SCOPE_V1'),'old owner cannot delete a newer checkpoint');
console.log('Hard-stop recovery: expired leases, durable work, concurrent edits, malformed records and owner-safe cleanup passed.');

// One fresh recovery read per tab, all interrupted writer kinds fail closed.
const r=harness(),roster={getSheetId:()=>7};r.ctx.publishAssertSettled_(roster);assert.equal(r.reads(),1);
for(const [key,value] of [['RE_MEMBER_MOVE:7','malformed'],['RE_ASSIGN:7:42',''],['RE_SIGNUP_APPROVAL:8:123','malformed'],['RE_ACTIVITY_RESET_PENDING','malformed'],['RE_ACTIVITY_RESET_PENDING','{"phase":"history"}']]){
 r.data.set(key,value);assert.throws(()=>r.ctx.publishAssertSettled_(roster),e=>e.publishRecovery===true);r.data.delete(key);
}
r.data.set('RE_ACTIVITY_RESET_PENDING','{"phase":"committed"}');r.ctx.publishAssertSettled_(roster);
r.data.set('RE_MEMBER_MOVE:77','foreign-sheet');r.ctx.publishAssertSettled_(roster);
console.log('Recovery guard: one service read, late checkpoints, malformed records and committed resets passed.');

// Full orchestration with the real selection/recovery code and tab list caching.
const o=harness();let sourceLists=0,targetLists=0,mirrors=[];
const sheet=(name,id)=>({getName:()=>name,getSheetId:()=>id,getMaxColumns:()=>40,getMaxRows:()=>100,getLastRow:()=>70,getLastColumn:()=>40});
const sources=['Roster','LOA','Patrol','👋 Welcome Page','Day Shift','Signups'].map((name,i)=>sheet(name,7+i));
const targets=['Roster','LOA','Patrol','Welcome Page','Day Shift','Signups'].map((name,i)=>sheet(name,100+i));
o.ctx.cfg_=()=>({});o.ctx.publicFile_=()=>({getId:()=> 'public',getUrl:()=> 'test',getSheets:()=>{targetLists++;return targets;},insertSheet:n=>sheet(n,200)});
o.ctx.SpreadsheetApp.getActive=()=>({getId:()=> 'internal',getSheets:()=>{sourceLists++;return sources;}});
o.ctx.publishSelfComputing_=()=>false;o.ctx._dressNote_='';o.ctx.publishMirrorTab_=(src,dest)=>{mirrors.push(dest.getName());return 70;};
vm.runInContext(panel.slice(panel.indexOf('function publishPublicRoster_('),panel.indexOf('/* Near-live publishing.')),o.ctx);
let outcome=o.ctx.publishPublicRoster_(['LOA','Patrol'],{yieldToBackoff:true});assert.deepEqual(mirrors,['LOA','Patrol']);assert.equal(o.reads(),2);assert.equal(sourceLists,1);assert.equal(targetLists,1);assert.equal(outcome.rows,140);assert.equal(outcome.durationMs,0);
mirrors=[];o.ctx.publishPublicRoster_({except:['LOA','Patrol']});assert.deepEqual(mirrors,['Roster','Welcome Page','Day Shift']);
mirrors=[];o.ctx.publishMirrorTab_=(src,dest)=>{mirrors.push(dest.getName());o.data.set('RE_MEMBER_MOVE:7','new checkpoint');return 70;};
outcome=o.ctx.publishPublicRoster_();assert.deepEqual(mirrors,['Roster']);assert(outcome.aborted&&outcome.failed,'a late recovery record stops subsequent tabs');assert(!o.held());
o.data.delete('RE_MEMBER_MOVE:7');mirrors=[];o.ctx.publishMirrorTab_=(src,dest)=>{mirrors.push(dest.getName());o.time(1270001);return 70;};
outcome=o.ctx.publishPublicRoster_();assert.deepEqual(mirrors,['Roster']);assert(outcome.aborted);assert(outcome.detail.some(d=>d.includes('time budget')));assert(!o.held());
console.log('Orchestration: real tab selection, cached inventories, emoji Welcome mapping, privacy blocking and mid-pass recovery passed.');

// Optional API path: exact complete metadata and no cell contents / guessed sizes.
function dimensions({rows=1000,cols=40,metaCode=200,postCode=200,sparse=false,vary=false,wrongId=false}={}){
 const d=harness(),requests=[],warnings=[];let rowReads=0,colReads=0,flushes=0;
 d.ctx.groupColLetter_=n=>{let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;};
 d.ctx.ScriptApp={getOAuthToken:()=> 'test-token'};d.ctx.SpreadsheetApp.flush=()=>flushes++;
 d.ctx.UrlFetchApp={fetch:(url,opts)=>{requests.push({url,opts});return {getResponseCode:()=>opts.method==='post'?postCode:metaCode,getContentText:()=>JSON.stringify({sheets:[{properties:{sheetId:wrongId?99:0},data:[{rowMetadata:Array.from({length:sparse?rows-1:rows},(_,i)=>({pixelSize:vary?21+i%2:i<500?24:32})),columnMetadata:Array.from({length:cols},()=>({pixelSize:100}))}]}]})};}};
 d.ctx.logWarn_=(...args)=>warnings.push(args);
 const src={getName:()=>"Department's Page",getSheetId:()=>0,getParent:()=>({getId:()=> 'internal'}),getRowHeight:i=>{rowReads++;return i<=500?24:32;},getColumnWidth:()=>{colReads++;return 100;}};
 const dest={getSheetId:()=>2,getParent:()=>({getId:()=> 'public'}),setRowHeightsForced(){},setColumnWidths(){}};
 vm.runInContext(panel.slice(panel.indexOf('function publishCopyDimensions_('),panel.indexOf('function publishMirrorTab_(')),d.ctx);
 d.ctx.publishCopyDimensions_(src,dest,rows,cols);
 return {d,requests,warnings,src,dest,rowReads:()=>rowReads,colReads:()=>colReads,flushes:()=>flushes};
}
const exact=dimensions();assert.equal(exact.requests.length,2);assert.equal(exact.rowReads()+exact.colReads(),0,'1040 source reads replaced by one metadata read');assert.equal(exact.flushes(),1);
const req=JSON.parse(exact.requests[1].opts.payload).requests;assert.equal(req.length,3);assert.equal(req[1].updateDimensionProperties.range.startIndex,500);assert.equal(req[1].updateDimensionProperties.properties.pixelSize,32);
assert(decodeURIComponent(exact.requests[0].url).includes("'Department''s Page'!A1:AN1000"));
assert(!decodeURIComponent(exact.requests[0].url).includes('rowData'),'request never retrieves private cell data');assert(!exact.requests[1].opts.payload.includes('test-token'));
for(const options of [{metaCode:403},{postCode:429},{sparse:true},{wrongId:true}]){
 const fallback=dimensions(options);assert.equal(fallback.rowReads(),1000);assert.equal(fallback.colReads(),40);assert.equal(fallback.warnings.length,1);assert(!JSON.stringify(fallback.warnings).includes('test-token'));
 const before=fallback.requests.length;fallback.d.ctx.publishCopyDimensions_(fallback.src,fallback.dest,1000,40);assert.equal(fallback.requests.length,before,'rejected API is not retried for every tab');
}
const chunked=dimensions({rows:1001,vary:true});assert.equal(chunked.requests.length,4);assert(chunked.requests.slice(1).every(r=>JSON.parse(r.opts.payload).requests.length<=500));
exact.requests.length=0;exact.d.ctx.UrlFetchApp.fetch=(url,opts)=>{exact.requests.push({url,opts});return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({sheets:[{properties:{sheetId:0},data:[{startRow:7,rowMetadata:Array.from({length:10},()=>({pixelSize:27}))}]}]})};};
assert(exact.d.ctx.publishDimensionsFast_(exact.src,exact.dest,10,0,{srcStart:8,destStart:12}));
const shifted=JSON.parse(exact.requests[1].opts.payload).requests;assert.equal(shifted.length,1);assert.equal(shifted[0].updateDimensionProperties.range.startIndex,11);assert.equal(shifted[0].updateDimensionProperties.range.endIndex,21);
assert(decodeURIComponent(exact.requests[0].url).includes('!A8:A17'));
console.log('Dimension API: 1040-to-zero individual reads, exact metadata, sparse/rejected fallback, bounded retries and chunking passed.');

// Text rectangles skip native numeric/image cells and merged interiors.
const textCtx={};vm.createContext(textCtx);vm.runInContext(panel.slice(panel.indexOf('function publishRestoreRichText_('),panel.indexOf('/** Prepare a redacted')),textCtx);
let writes=[];const snapshot={getRange:(row,col,n=1,m=1)=>({setRichTextValues:values=>writes.push({row,col,n,m,values}),setRichTextValue:value=>writes.push({row,col,n,m,values:[[value]]})})};
const rich=value=>({getText:()=>value,link:'https://example.test'}),grid=Array.from({length:100},()=>Array.from({length:40},()=>rich('=literal')));
textCtx.publishRestoreRichText_({getMergedRanges:()=>[]},snapshot,grid);assert.equal(writes.length,1,'4000 text restores become one rectangle');assert.equal(writes[0].n,100);assert.equal(writes[0].m,40);
writes=[];const merged={getRow:()=>1,getColumn:()=>1,getNumRows:()=>2,getNumColumns:()=>2},mixed=[[rich('Title'),null,rich('Link')],[null,null,rich('Other')],[rich('Text'),null,rich('Last')]];
textCtx.publishRestoreRichText_({getMergedRanges:()=>[merged]},snapshot,mixed);
assert.equal(writes.length,3);assert(writes.some(w=>w.row===1&&w.col===1&&w.n===1&&w.m===1));
assert(writes.every(w=>w.values.every(row=>row.every(t=>t&&t.getText()))));assert.equal(writes.find(w=>w.col===3).n,3);
console.log('Rich text: rectangle batching, links/literals, mixed native cells and merged anchors passed.');

// Real catch-up scheduling functions keep a delayed trigger and never delete a newer owner.
const t=harness();let triggers=[],creates=0,sweeps=0;
t.ctx.ScriptApp={getProjectTriggers:()=>triggers.slice(),deleteTrigger:tr=>triggers=triggers.filter(x=>x!==tr),newTrigger:name=>({timeBased(){return this;},after(ms){assert.equal(ms,3000);return this;},create(){creates++;const tr={getHandlerFunction:()=>name,getUniqueId:()=>String(creates)};triggers.push(tr);return tr;}})};
t.ctx.publishSweep=()=>sweeps++;
t.ctx.scheduleCatchup_();t.time(1010000);t.ctx.scheduleCatchup_();assert.equal(creates,1,'10 seconds of delivery delay does not replace the pending trigger');
t.time(1130000);t.ctx.scheduleCatchup_();assert.equal(creates,2);assert.equal(triggers.length,1,'expired orphan replaced once');
t.ctx.publishCatchup({triggerUid:'1'});assert.equal(triggers.length,1);assert(t.data.has('PUBLIC_CATCHUP_AT'),'old event cannot remove new pending marker');
t.ctx.publishCatchup({triggerUid:'2'});assert.equal(triggers.length,0);assert(!t.data.has('PUBLIC_CATCHUP_AT'));assert.equal(sweeps,2);assert(!t.held());
t.busy(true);t.ctx.scheduleCatchup_();assert.equal(creates,2);t.busy(false);
console.log('Catch-up: delayed delivery, orphan expiry, trigger ownership and lock contention passed.');
