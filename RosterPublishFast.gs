/** Scoped publish work. An absent/invalid scope with PUBLIC_DIRTY=1 means a full
 * pass, for backwards compatibility. A covered tab is excluded only until a new
 * change queues it again. Short document locks make taking work atomic. */
const PUBLISH_SCOPE_PROP_='PUBLIC_PENDING_SCOPE_V1';
const PUBLISH_INFLIGHT_PROP_='PUBLIC_INFLIGHT_SCOPE_V1';
const PUBLISH_HINT_PREFIX_='RE_PUBLIC_HINT_V1:';
const PUBLISH_FINISHED_PREFIX_='RE_PUBLIC_FINISHED_V1:';
function publishScopeNames_(names) {
  return Array.from(new Set((Array.isArray(names)?names:[names]).filter(n=>typeof n==='string'&&n.trim()).map(n=>n.trim())));
}
function publishSelected_(name, selection) {
  const same=n=>norm_(name)===norm_(n)||(tabKey_(name)===tabKey_(CONFIG.sheets.welcome||'Welcome Page')&&tabKey_(name)===tabKey_(n));
  if(!selection)return true;
  if(selection.except)return !selection.except.some(same);
  return publishScopeNames_(selection).some(same);
}
function publishScopeLock_(fn) {
  const lock=LockService.getDocumentLock(),held=lock&&lock.hasLock&&lock.hasLock();
  if(!lock||(!held&&!lock.tryLock(1000))){const e=new Error('Public update queue is busy.');e.publishQueueBusy=true;throw e;}
  try{const p=PropertiesService.getDocumentProperties();publishQueueDrainHints_(p);return fn(p);}finally{if(!held)lock.releaseLock();}
}
/** A busy document lock must not erase scoped work or race the current queue owner.
 * Each event writes its own durable record; only a lock owner merges/deletes records.
 * A write arriving after the owner's snapshot stays pending for the next sweep. */
function publishQueueHint_(names) {
  const tabs=names?publishScopeNames_(names):[];
  const key=PUBLISH_HINT_PREFIX_+Date.now()+':'+Math.random().toString(36).slice(2);
  const raw=JSON.stringify(tabs);
  PropertiesService.getDocumentProperties().setProperty(key,raw.length<1800?raw:'[]');
}
function publishQueueDrainHints_(p) {
  const all=p.getProperties(),keys=Object.keys(all).filter(k=>k.indexOf(PUBLISH_HINT_PREFIX_)===0);
  if(!keys.length)return;
  const s=publishScopeRead_(p);
  keys.forEach(k=>{
    let tabs;try{const value=JSON.parse(all[k]);tabs=Array.isArray(value)?publishScopeNames_(value):[];}catch(e){tabs=[];}
    if(!tabs.length){s.all=true;s.except=[];delete s.tabs;}
    else if(s.all)s.except=s.except.filter(n=>!publishSelected_(n,tabs));
    else s.tabs=publishScopeNames_(s.tabs.concat(tabs));
  });
  publishScopeStore_(p,s); // commit merged work BEFORE removing the durable records
  keys.forEach(k=>p.deleteProperty(k));
}
function publishHasPending_(p) {
  p=p||PropertiesService.getDocumentProperties();
  return p.getProperty('PUBLIC_DIRTY')==='1'||Object.keys(p.getProperties()).some(k=>k.indexOf(PUBLISH_HINT_PREFIX_)===0);
}
function publishScopeRead_(p) {
  if(p.getProperty('PUBLIC_DIRTY')!=='1')return {all:false,tabs:[]};
  try{const s=JSON.parse(p.getProperty(PUBLISH_SCOPE_PROP_)||'null');
    if(s&&s.all===true&&Array.isArray(s.except))return {all:true,except:publishScopeNames_(s.except)};
    if(s&&s.all===false&&Array.isArray(s.tabs)){
      const tabs=publishScopeNames_(s.tabs);if(tabs.length)return {all:false,tabs};
    }
  }catch(e){/* unknown work is never discarded */}
  return {all:true,except:[]};
}
function publishScopeStore_(p,s) {
  if(!s.all&&!s.tabs.length){p.deleteProperty(PUBLISH_SCOPE_PROP_);p.deleteProperty('PUBLIC_DIRTY');return;}
  const raw=JSON.stringify(s);
  const bytes=Array.from(raw).reduce((n,c)=>{const cp=c.codePointAt(0);return n+(cp>65535?4:cp>2047?3:cp>127?2:1);},0);
  p.setProperty(PUBLISH_SCOPE_PROP_,bytes<8000?raw:JSON.stringify({all:true,except:[]}));
  p.setProperty('PUBLIC_DIRTY','1');
}
function publishQueueChange_(names) {
  try{publishScopeLock_(p=>{
    const s=publishScopeRead_(p),tabs=names?publishScopeNames_(names):[];
    if(!tabs.length){publishScopeStore_(p,{all:true,except:[]});return;}
    if(s.all)s.except=s.except.filter(n=>!publishSelected_(n,tabs));
    else s.tabs=publishScopeNames_(s.tabs.concat(tabs));
    publishScopeStore_(p,s);
  });}catch(e){if(!e||!e.publishQueueBusy)throw e;publishQueueHint_(names);}
}
function publishQueueTake_(selection) {
  return publishScopeLock_(p=>{
    const s=publishScopeRead_(p);
    if(!selection){
      const work=s.all?{except:s.except}:s.tabs.length?s.tabs:undefined;
      publishScopeStore_(p,{all:false,tabs:[]});return work;
    }
    const tabs=publishScopeNames_(selection);
    if(s.all)s.except=publishScopeNames_(s.except.concat(tabs));
    else s.tabs=s.tabs.filter(n=>!publishSelected_(n,tabs));
    publishScopeStore_(p,s);return tabs;
  });
}
function publishQueueRetry_(selection,completed) {
  const done=publishScopeNames_(completed||[]);
  if(done.length){
    if(selection&&!selection.except){selection=publishScopeNames_(selection).filter(n=>!publishSelected_(n,done));if(!selection.length)return;}
    else selection={except:publishScopeNames_((selection&&selection.except||[]).concat(done))};
  }
  if(!selection||!selection.except){publishQueueChange_(selection);return;}
  publishScopeLock_(p=>{
    const s=publishScopeRead_(p),except=selection.except;
    // Merge failed work with changes enqueued during the pass; neither overwrites the other.
    const remaining=except.filter(n=>s.all?publishSelected_(n,s.except):!publishSelected_(n,s.tabs));
    publishScopeStore_(p,{all:true,except:remaining});
  });
}

/** Durable work capture BEFORE draining the queue: a terminated execution cannot
 * strand its update. The pass lease serializes owners; queue writes use the same
 * document lock as pass claiming. */
function publishQueueBegin_(selection,manual) {
  return publishScopeLock_(p=>{
    const state=publishScopeRead_(p);
    const work=manual?{except:[]}:selection|| (state.all?{except:state.except}:state.tabs.length?state.tabs:undefined);
    p.setProperty(PUBLISH_INFLIGHT_PROP_,JSON.stringify({token:_publishPassToken_,selection:work||{except:[]}}));
    const taken=publishQueueTake_(selection);
    return manual?undefined:taken;
  });
}
function publishQueueFinish_() {
  const token=_publishPassToken_;if(!token)return;
  // This checkpoint is complete only AFTER unfinished tabs have been requeued.
  // Persist completion before contending for the queue lock: cleanup contention
  // must not turn an already completed mirror into another full publish.
  const p=PropertiesService.getDocumentProperties(),key=PUBLISH_FINISHED_PREFIX_+token;
  p.setProperty(key,'1');
  try{return publishScopeLock_(props=>{
    const raw=props.getProperty(PUBLISH_INFLIGHT_PROP_);
    const record=raw?JSON.parse(raw):null;
    if(record&&record.token===token)props.deleteProperty(PUBLISH_INFLIGHT_PROP_);
    props.deleteProperty(key);
    return true;
  });}catch(e){if(!e||!e.publishQueueBusy)throw e;return false;}
}
/** Only called after the old pass lease expires (or was released), under its claim
 * lock. Merge leftover work with new edits before allowing another publisher. */
function publishQueueRecover_() {
  publishScopeLock_(p=>{
    const raw=p.getProperty(PUBLISH_INFLIGHT_PROP_);if(!raw)return;
    let record;try{record=JSON.parse(raw);}catch(e){/* malformed means full work */}
    const finished=record&&record.token&&PUBLISH_FINISHED_PREFIX_+record.token;
    if(finished&&p.getProperty(finished)==='1'){
      p.deleteProperty(PUBLISH_INFLIGHT_PROP_);
      p.deleteProperty(finished);
      return;
    }
    const selection=record&&record.selection;
    const valid=Array.isArray(selection)?publishScopeNames_(selection).length>0:selection&&Array.isArray(selection.except);
    publishQueueRetry_(valid?selection:undefined);
    p.deleteProperty(PUBLISH_INFLIGHT_PROP_);
  });
}

/** Called under the writer lock for EACH tab: one property snapshot instead of
 * four service reads, without caching away a recovery record from a later writer. */
function publishAssertSettled_(roster) {
  const props=PropertiesService.getDocumentProperties().getProperties(),keys=Object.keys(props);
  const id=roster&&roster.getSheetId();
  const pause=message=>{const error=new Error('Public publishing paused: '+message);error.publishRecovery=true;throw error;};
  if(props['RE_DEFER_JOB:statuses']||props['RE_DEFER_JOB:dashboard'])pause('activity or dashboard statistics are awaiting refresh. The queued refresh and publish will retry automatically.');
  if(keys.some(k=>k.indexOf('RE_EDIT_MOVE:')===0))pause('a confirmed member transfer is queued. It will retry automatically; keep its pasted ID in place.');
  if(roster&&props['RE_MEMBER_MOVE:'+id])pause('an interrupted member transfer needs recovery. Use Roster → Recover Interrupted Transfer.');
  if(roster&&keys.some(k=>k.indexOf('RE_ASSIGN:'+id+':')===0))pause('an interrupted member assignment needs recovery. Use Roster → Recover Interrupted Transfer.');
  if(keys.some(k=>k.indexOf('RE_SIGNUP_APPROVAL:')===0))pause('an interrupted signup approval needs recovery. Use Roster → Recover Interrupted Transfer.');
  if(props.RE_ACTIVITY_RESET_PENDING){
    let pending;try{pending=JSON.parse(props.RE_ACTIVITY_RESET_PENDING);}catch(e){pause('an activity-reset checkpoint is unreadable. Inspect its history snapshot before publishing.');}
    if(!pending||pending.phase!=='committed')pause('an interrupted activity reset needs review. Inspect its history snapshot and RE_ACTIVITY_RESET_PENDING checkpoint.');
  }
}

/** Optional Sheets REST fast path. Only dimension metadata is read. If unavailable,
 * malformed, sparse, or rejected, callers retain the complete Apps Script fallback.
 * No guessed default heights/widths and no authorization token in diagnostics. */
let _publishDimensionsApiOff_=false;
/** Welcome replacement needs to restore incoming public formulas after rename.
 * Read formula metadata for all public tabs in one request instead of one full
 * data-range read per tab. A rejected service leaves the existing scan intact. */
function publishWelcomeReferencesFast_(target,dest,name) {
  if(_publishDimensionsApiOff_||typeof Sheets==='undefined'||!Sheets.Spreadsheets)return null;
  try{
    const sheets=target.getSheets(),byId=new Map(sheets.map(s=>[s.getSheetId(),s]));
    const fields='sheets(properties(sheetId),data(startRow,startColumn,rowData(values(userEnteredValue(formulaValue)))))';
    const metadata=Sheets.Spreadsheets.get(target.getId(),{fields});
    if(!metadata||!Array.isArray(metadata.sheets)||metadata.sheets.length!==sheets.length)return null;
    const refs=[],seen=new Set(),quoted="'"+name.replace(/'/g,"''")+"'!";
    for(const tab of metadata.sheets){
      const id=tab.properties&&tab.properties.sheetId,sheet=byId.get(id);
      if(!sheet||seen.has(id))return null;
      seen.add(id);
      if(id===dest.getSheetId())continue;
      (tab.data||[]).forEach(grid=>(grid.rowData||[]).forEach((row,r)=>(row.values||[]).forEach((cell,c)=>{
        const formula=cell.userEnteredValue&&cell.userEnteredValue.formulaValue;
        if(formula&&(formula.indexOf(quoted)!==-1||formula.indexOf(name+'!')!==-1))refs.push({sheet,row:(grid.startRow||0)+r+1,col:(grid.startColumn||0)+c+1,formula});
      })));
    }
    return refs;
  }catch(e){return null;}
}
function publishDimensionsFast_(src,dest,rows,cols,offset) {
  const advanced=typeof Sheets!=='undefined'&&Sheets.Spreadsheets;
  if(_publishDimensionsApiOff_||!rows||(!advanced&&(typeof UrlFetchApp==='undefined'||typeof ScriptApp==='undefined'||typeof ScriptApp.getOAuthToken!=='function')))return false;
  try{
    const headers=advanced?null:{Authorization:'Bearer '+ScriptApp.getOAuthToken()};
    SpreadsheetApp.flush(); // make pending source/grid changes visible to the REST read
    const sourceStart=offset&&offset.srcStart||1,destStart=offset&&offset.destStart||1;
    const a1="'"+src.getName().replace(/'/g,"''")+"'!A"+sourceStart+":"+groupColLetter_(Math.max(1,cols))+(sourceStart+rows-1);
    const fields='sheets(properties(sheetId),data(startRow,startColumn,rowMetadata(pixelSize),columnMetadata(pixelSize)))';
    let metadata;
    if(advanced)metadata=Sheets.Spreadsheets.get(src.getParent().getId(),{ranges:[a1],fields});
    else{
      const response=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(src.getParent().getId())+'?ranges='+encodeURIComponent(a1)+'&fields='+encodeURIComponent(fields),{headers,muteHttpExceptions:true});
      if(response.getResponseCode()!==200)throw new Error('Dimension metadata HTTP '+response.getResponseCode());
      metadata=JSON.parse(response.getContentText());
    }
    const sheet=(metadata.sheets||[]).find(s=>s.properties&&s.properties.sheetId===src.getSheetId());
    const grid=sheet&&(sheet.data||[]).find(g=>(g.startRow||0)===sourceStart-1&&!g.startColumn);
    const heights=grid&&grid.rowMetadata,widths=grid&&grid.columnMetadata;
    if(!heights||heights.length<rows||(cols&&(!widths||widths.length<cols)))throw new Error('Incomplete dimension metadata');
    const valid=(v,n)=>v.slice(0,n).every(d=>d&&Number.isInteger(d.pixelSize)&&d.pixelSize>0);
    if(!valid(heights,rows)||(cols&&!valid(widths,cols)))throw new Error('Invalid dimension metadata');
    const requests=[],id=dest.getSheetId();
    const runs=(values,n,dimension,start=0)=>{let at=0;while(at<n){let end=at+1;while(end<n&&values[end].pixelSize===values[at].pixelSize)end++;
      requests.push({updateDimensionProperties:{range:{sheetId:id,dimension,startIndex:start+at,endIndex:start+end},properties:{pixelSize:values[at].pixelSize},fields:'pixelSize'}});at=end;}};
    runs(heights,rows,'ROWS',destStart-1);if(cols)runs(widths,cols,'COLUMNS');
    for(let at=0;at<requests.length;at+=500){
      if(advanced){Sheets.Spreadsheets.batchUpdate({requests:requests.slice(at,at+500)},dest.getParent().getId());continue;}
      const result=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(dest.getParent().getId())+':batchUpdate',{method:'post',headers,contentType:'application/json',payload:JSON.stringify({requests:requests.slice(at,at+500)}),muteHttpExceptions:true});
      if(result.getResponseCode()!==200)throw new Error('Dimension update HTTP '+result.getResponseCode());
    }
    return true;
  }catch(e){
    _publishDimensionsApiOff_=true;
    const message='Using complete Apps Script dimension fallback: '+diagnosticText_(e&&e.message||e,200)+'. Check that the Google Sheets API is enabled in the script\'s Cloud project.';
    if(typeof diagnosticNotice_==='function')diagnosticNotice_('WARN','','publishDimensionsFast_',message,3600);
    else logWarn_('publishDimensionsFast_',message);
    return false;
  }
}
