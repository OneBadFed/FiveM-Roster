/** Fresh QA specification shared by Apps Script and the local runner. No legacy test cases imported. */
function qaAssert_(condition,detail) { if(!condition)throw new Error(detail||'Assertion failed'); }
function qaEqual_(actual,expected) { qaAssert_(JSON.stringify(actual)===JSON.stringify(expected),'Expected '+JSON.stringify(expected)+'; received '+JSON.stringify(actual)); }
function qaCase_(id,area,run) { return {id,area,run}; }

/** Deterministic fixtures make every failed boundary reproducible. */
function qaCases_() {
  const cases=[],add=(id,area,run)=>cases.push(qaCase_(id,area,run));
  const engine={global:[{name:'High',min:10},{name:'Middle',min:5},{name:'Floor',min:0}],overrides:[],rules:[]};
  [-1,0,0.01,4.99,5,5.01,9.99,10,10.01,100000].forEach(hours=>add('status.threshold.'+hours,'Status',()=>qaEqual_(computeStatusCore_('Officer',hours,engine),hours>=10?'High':hours>=5?'Middle':'Floor')));
  for(let i=0;i<100;i++) {
    const hours=i*0.137;
    add('status.monotonic.'+i,'Status',()=>{
      const levels=['Floor','Middle','High'];
      qaAssert_(levels.indexOf(computeStatusCore_('Officer',hours,engine))<=levels.indexOf(computeStatusCore_('Officer',hours+0.137,engine)),'Increasing hours lowered the tier');
    });
  }
  add('status.rank.override','Status',()=>{
    const e={global:engine.global,rules:[],overrides:[{scope:'RANK',match:'Officer',ladder:[{name:'Special',min:0}]}]};
    qaEqual_(computeStatusCore_(' officer ',99,e),'Special');qaEqual_(computeStatusCore_('Officer II',99,e),'High');
  });
  ['<','<=','>','>=','==','*','invalid'].forEach(op=>[4,5,6].forEach(h=>add('status.operator.'+op+'.'+h,'Status',()=>{
    const expected={'<':h<5,'<=':h<=5,'>':h>5,'>=':h>=5,'==':h===5,'*':true,invalid:false};
    qaEqual_(statusOpMatch_(op,h,5),expected[op]);
  })));
  add('status.rules.fixed.point','Status',()=>{
    const rules=[{source:'FLOOR',op:'*',hours:0,target:'Middle'},{source:'MIDDLE',op:'>=',hours:10,target:'High'}];
    const status=applyStatusRules_('Floor',10,rules);qaEqual_(status,'High');qaEqual_(applyStatusRules_(status,10,rules),status);
  });
  add('status.rules.cycle','Status',()=>{
    const rules=[{source:'A',op:'*',target:'B'},{source:'B',op:'*',target:'A'}];
    qaEqual_(applyStatusRules_('A',0,rules),'A');
  });
  ['', 'High:-1, Low:0','High:abc, Low:0','High:5 Low:0'].forEach((value,i)=>add('config.ladder.malformed.'+i,'Config',()=>qaEqual_(parseLadder_(value),null)));
  add('config.ladder.sorted','Config',()=>qaEqual_(parseLadder_('Floor:0, High:10, Middle:5').map(x=>x.min),[10,5,0]));
  [[{name:'A',min:2}],[{name:'A',min:0},{name:'B',min:0}],[{name:'A',min:5},{name:'B',min:5},{name:'C',min:0}]].forEach((ladder,i)=>add('config.ladder.invalid.'+i,'Config',()=>{const problems=[];checkLadder_(ladder,'QA',problems);qaAssert_(problems.some(p=>p.sev==='ERROR'));}));
  add('config.defaults','Config',()=>qaAssert_(!validateConfig_({}).problems.some(p=>p.sev==='ERROR'),'Default configuration is invalid'));
  add('config.empty.statuses','Config',()=>{
    const result=validateConfig_({STATUSES:{kind:'table',rows:[]},STATUS_OVERRIDES:{kind:'table',rows:[]},STATUS_RULES:{kind:'table',rows:[]}});
    qaAssert_(!result.problems.some(p=>p.sev==='ERROR'),'Department reset cannot leave an invalid empty ladder');
  });
  ['NaN','0','-1','six'].forEach(value=>add('config.header.invalid.'+value,'Config',()=>qaAssert_(validateConfig_({ROSTER_LAYOUT:{kind:'kv',kv:{HEADER_ROW:value}}}).problems.some(p=>p.sev==='ERROR'))));
  [['2h 30m',2.5],['90m',1.5],['1.25h',1.25],['',0],[null,0],['nonsense',0],[0,0]].forEach((pair,i)=>add('hours.parse.'+i,'Intake',()=>qaEqual_(parseHours_(pair[0]),pair[1])));
  for(let i=0;i<30;i++)add('intake.identity.precision.'+i,'Intake',()=>{
    const id='1234567890123456'+('00'+i).slice(-3),date=new Date(1700000000000+i);
    qaEqual_(makeLeaveKey_(id,date),'KEY|'+id+'|'+date.getTime());
    qaAssert_(makeLeaveKey_(id,date)!==makeLeaveKey_(id,new Date(date.getTime()+1)),'Distinct submissions collided');
  });
  add('intake.blank.identity','Intake',()=>qaEqual_(makeLeaveKey_('',new Date()),''));
  add('groups.exact.boundary','Academy/groups',()=>{qaAssert_(!groupValueMatches_('Daylight','Day'));qaAssert_(groupValueMatches_(' Day Shift ','day'));});
  add('groups.duplicate.identity','Academy/groups',()=>qaAssert_(!!groupIdentityProblem_([['A','1'],['B','1']],2,1)));
  add('groups.missing.identity','Academy/groups',()=>qaAssert_(!!groupIdentityProblem_([['A','']],2,1)));
  add('groups.blank.slots','Academy/groups',()=>qaEqual_(groupIdentityProblem_([['',''],['A','1']],2,1),''));
  add('academy.header.priority','Academy/groups',()=>{const c=academyCols_(['OOC NAME','NAME','UNIQUE ID','RANK GROUP','RANK','EXAM']);qaEqual_(c.name,2);qaEqual_(c.id,3);qaEqual_(c.rank,5);});
  add('academy.rank.stems','Academy/groups',()=>qaEqual_(academyStems_('POLICE CADETS'),['CADET']));
  for(let i=1;i<=75;i++)add('groups.column.letters.'+i,'Academy/groups',()=>{
    const letters=groupColLetter_(i);let number=0;for(let n=0;n<letters.length;n++)number=number*26+letters.charCodeAt(n)-64;qaEqual_(number,i);
  });
  add('errors.webhook.redaction','Error handling',()=>{
    const secret='https://discord.com/api/webhooks/123456/QA_SECRET_TOKEN';const result=diagnosticText_(secret,500);
    qaAssert_(result.indexOf('QA_SECRET_TOKEN')===-1);qaAssert_(result.indexOf('[webhook redacted]')!==-1);
  });
  add('errors.circular.context','Error handling',()=>{const context={password:'QA_PASSWORD'};context.self=context;const text=diagnosticContext_(context);qaAssert_(text.indexOf('QA_PASSWORD')===-1);qaAssert_(text.indexOf('circular')!==-1);});
  add('errors.bounded.diagnostics','Error handling',()=>qaEqual_(diagnosticText_('X'.repeat(10000),100).length,100));
  add('config.preview.colours','Config',()=>{
    const plan=configSheetStylePlan_([['RE_CONFIG','Title','Help','',''],['[THEME]','','','',''],['ACCENT','#123456','Help','','']]);
    qaEqual_(plan[0].kind,'title');qaEqual_(plan[2].backgrounds[1],'#123456');
  });
  return cases;
}

/** Platform checks receive only an explicit fixture sheet and run-owned helpers.
 * They never resolve a live roster/config tab as a test input. */
function qaPlatformCases_(book, sandbox, owned) {
  const cases=[],add=(id,area,run)=>cases.push(qaCase_(id,area,run));
  const fixture=name=>sandbox?qaResetSandbox_(sandbox):book.insertSheet(name);
  add('platform.config.roundtrip','Sheets platform',()=>{
    const sh=fixture('QA Config');
    sh.getRange(1,1,9,5).setValues([
      ['RE_CONFIG','','','',''],['[SYSTEM]','','','',''],['SYSTEM_NAME','QA system','help','',''],['','','','',''],
      ['[RANKS]','','','',''],['Value','Kind','','',''],['Cadet','TRAINING','','',''],['','','','',''],['','','','','']]);
    const raw=parseBlocks_(sh);qaEqual_(raw.SYSTEM.kv.SYSTEM_NAME,'QA system');
    setKvValue_(sh,'SYSTEM','SYSTEM_NAME','New QA');qaEqual_(parseBlocks_(sh).SYSTEM.kv.SYSTEM_NAME,'New QA');
    setTableRows_(sh,'RANKS',[['Cadet','TRAINING'],['Officer','RANK'],['Recruits','DIVIDER']]);
    qaEqual_(parseBlocks_(sh).RANKS.rows.length,3);
    setTableRows_(sh,'RANKS',[]);qaEqual_(parseBlocks_(sh).RANKS.rows.length,0);
    qaEqual_(parseBlocks_(sh).SYSTEM.kv.SYSTEM_NAME,'New QA');
  });
  add('platform.graduate.banner','Sheets platform',()=>{
    const sh=fixture('QA Academy');
    sh.getRange(1,1,7,3).setValues([['NAME','GRADUATED',''],['Alex','Graduated',''],['— GRADUATED —','',''],['GRADUATE LOG','',''],['','',''],['','',''],['','','']]);
    sh.getRange(4,1,2,3).merge();qaEqual_(academyGradSection_(sh,2,3),{headerRow:4,dataStart:6});
  });
  add('platform.publish.native.merged','Sheets platform',()=>{
    const src=fixture('QA Native Source'),dest=book.insertSheet(sandbox?sandbox.getName()+' copy':'QA Native Snapshot');
    if(owned)owned.push(dest); // register before any fixture write; cleanup uses IDs, never name scans
    try {
    [src,dest].forEach(sh=>sh.getRange(1,1,2,3).merge().setBackground('#223344'));
    src.getRange(1,1).setValue('Merged banner');src.getRange(1,4).setNumberFormat('@').setValue("'=literal");
    src.getRange(2,4).setFormula('=10+5');src.getRange(3,4).setNumberFormat('@').setValue('1234567890123456789');
    [src,dest].forEach(sh=>sh.getRange(3,1,1,2).merge());
    src.getRange(3,1).setNumberFormat('@').setValue("'=merged literal");
    src.getRange(1,5).setNumberFormat('@').setFontFamily('Arial').setValue("'=1+1");
    src.getRange(2,5).setFormula('="=literal result"');
    SpreadsheetApp.flush();
    publishFreezeSnapshot_(src,dest,3,5);
    qaEqual_(dest.getRange(1,1).getDisplayValue(),'Merged banner');
    qaEqual_(dest.getRange(1,4).getDisplayValue(),src.getRange(1,4).getDisplayValue());
    qaEqual_(dest.getRange(1,4).getFormulas()[0][0],'');
    qaEqual_(dest.getRange(3,1).getDisplayValue(),'=merged literal');
    qaEqual_(dest.getRange(1,5).getDisplayValue(),'=1+1');
    qaEqual_(dest.getRange(1,5).getFormulas()[0][0],'');
    qaEqual_(dest.getRange(1,5).getFontFamily(),'Arial');
    qaEqual_(dest.getRange(1,5).getNumberFormat(),'@');
    qaEqual_(dest.getRange(2,5).getDisplayValue(),'=literal result');
    qaEqual_(dest.getRange(2,5).getFormulas()[0][0],'');
    qaEqual_(dest.getRange(2,4).getDisplayValue(),'15');
    qaEqual_(dest.getRange(2,4).getFormulas()[0][0],'');
    qaEqual_(dest.getRange(3,4).getDisplayValue(),'1234567890123456789');
    qaEqual_(dest.getRange(1,1,2,3).getMergedRanges().length,1);
    qaEqual_(dest.getRange(1,1).getBackgrounds()[0][0],'#223344');
    } finally { book.deleteSheet(dest); }
  });
  [12,27,40].forEach(width=>add('platform.frame.growth.'+width,'Sheets platform',()=>{
    const sh=fixture('QA Frame '+width);
    if(sh.getMaxColumns()<width)sh.insertColumnsAfter(sh.getMaxColumns(),width-sh.getMaxColumns());
    sh.getRange(8,1,3,width).setBackground('#777777').setFontFamily('Arial').setFontSize(12).setFontColor('#eeeeee').setWrap(true);
    sh.getRange(8,1,3,1).setBackground('#111111');sh.getRange(8,width,3,1).setBackground('#111111');
    sh.getRange(11,1,1,width).setBackground('#111111');sh.setRowHeights(8,3,29);
    sh.getRange(8,3,3,1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    sh.getRange(8,4,3,1).setNumberFormat('0.00');
    const rule=SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(1).setBackground('#ff0000').setRanges([sh.getRange(8,4,3,1)]).build();
    sh.setConditionalFormatRules([rule]);
    qaEqual_(framedTable_(sh,8).cap,11);ensureRoomAboveCap_(sh,12,8);
    qaEqual_(framedTable_(sh,8).cap,13);qaEqual_(sh.getRowHeight(11),29);
    qaEqual_(sh.getRange(11,4).getNumberFormat(),'0.00');qaEqual_(sh.getRange(11,2).getFontFamily(),'Arial');
    qaAssert_(!!sh.getRange(11,3).getDataValidation(),'New checkbox missing');
    qaEqual_(sh.getRange(13,1,1,width).getBackgrounds()[0],new Array(width).fill('#111111'));
    const rules=sh.getConditionalFormatRules();qaAssert_(rules.some(r=>r.getRanges().some(g=>g.getRow()<=11&&g.getRow()+g.getNumRows()>11)),'New conditional formatting missing');
    sh.getRange(8,2).setNumberFormat('@').setValue('1234567890123456789');qaEqual_(sh.getRange(8,2).getDisplayValue(),'1234567890123456789');
  }));
  add('platform.support.filters.order','Sheets platform',()=>{
    const sh=fixture('QA Support');
    sh.getRange(1,1,4,3).setValues([['Timestamp','Name','Detail'],[new Date('2026-01-01'),'Old','old detail'],[new Date('2026-03-01'),'New','new detail'],[new Date('2026-02-01'),'Middle','middle detail']]);
    styleStartupSupportSheet_(sh,['Timestamp','Name','Detail']);
    sortSupportRows_(sh,1,3);trimSupportRows_(sh,2);
    qaEqual_(sh.getRange(2,2,2,2).getDisplayValues(),[['New','new detail'],['Middle','middle detail']]);
    qaEqual_(sh.getRange(1,1).getDisplayValue(),'Timestamp');
    ensureSupportFilter_(sh,3);
    sh.getFilter().setColumnFilterCriteria(2,SpreadsheetApp.newFilterCriteria().setHiddenValues(['Middle']).build());
    sh.insertRowsAfter(sh.getMaxRows(),1);ensureSupportFilter_(sh,3);
    qaEqual_(sh.getFilter().getRange().getNumRows(),sh.getMaxRows());
    qaEqual_(sh.getFilter().getColumnFilterCriteria(2).getHiddenValues(),['Middle']);
    sh.getFilter().remove();sh.clear();
    sh.getRange(1,1,4,3).setValues([['WeekOf','Name','Hours'],[new Date('2026-02-01'),'Date',2],['2026-03-01','Text',3],['2026-01-01','Old',1]]);
    const width=sh.getMaxColumns();sortSupportRows_(sh,1,3,'week');
    qaEqual_(sh.getRange(2,2,3,2).getDisplayValues(),[['Text','3'],['Date','2'],['Old','1']]);
    qaEqual_(sh.getMaxColumns(),width);
  });
  return cases;
}

/** The caller supplies only the run-owned sandbox. Start each fixture on a truly blank grid. */
function qaResetSandbox_(sheet, name) {
  const filter=sheet.getFilter();if(filter)filter.remove();
  sheet.getRange(1,1,sheet.getMaxRows(),sheet.getMaxColumns()).breakApart();
  sheet.clear();sheet.setConditionalFormatRules([]);
  sheet.getBandings().forEach(b=>b.remove());
  sheet.getCharts().forEach(chart=>sheet.removeChart(chart));
  sheet.getImages().forEach(image=>image.remove());
  sheet.setFrozenRows(0);sheet.setFrozenColumns(0);
  const rows=100,cols=40;
  if(sheet.getMaxRows()<rows)sheet.insertRowsAfter(sheet.getMaxRows(),rows-sheet.getMaxRows());
  if(sheet.getMaxRows()>rows)sheet.deleteRows(rows+1,sheet.getMaxRows()-rows);
  if(sheet.getMaxColumns()<cols)sheet.insertColumnsAfter(sheet.getMaxColumns(),cols-sheet.getMaxColumns());
  if(sheet.getMaxColumns()>cols)sheet.deleteColumns(cols+1,sheet.getMaxColumns()-cols);
  sheet.showRows(1,rows);sheet.showColumns(1,cols);
  sheet.getRange(1,1,rows,cols).clearDataValidations().clearNote();
  sheet.setRowHeights(1,rows,21);sheet.setColumnWidths(1,cols,100);
  if(name)sheet.setName(name);
  return sheet;
}

/** Each case has an independent result. Missing dependencies and exceptions are failures, never passes. */
function qaExecuteCases_(cases,now,deadline) {
  const results=[];
  cases.forEach(test=>{
    const started=now();
    if(started>=deadline){results.push([test.id,test.area,'NOT RUN',0,'Time budget reached']);return;}
    try{test.run();results.push([test.id,test.area,'PASS',now()-started,'']);}
    catch(e){results.push([test.id,test.area,'FAIL',now()-started,diagnosticText_(e&&e.message||e,1500)]);}
  });
  return results;
}

function qaRunAll() { return qaRun_('all'); }
function qaRunCore() { return qaRun_('core'); }
function qaRunPlatform() { return qaRun_('platform'); }
function qaRun_(mode) {
  const ui=SpreadsheetApp.getUi(),source=SpreadsheetApp.getActive(),lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)){ui.alert('QA cannot start while a roster action is running. Try again after it finishes.');return;}
  const previousSuppression=DEV_WEBHOOKS_OFF_,owned=[],existing=new Set();
  let sandbox=null,results=[],failure='',reportReady=false,reportUrl=null;
  const started=Date.now();let runId='',sandboxName='';
  // Keep older reports and any unrelated same-named tab intact.
  let reportName='🧪 QA Results',suffix=2;
  try {
    DEV_WEBHOOKS_OFF_=true;
    source.getSheets().forEach(sheet=>existing.add(sheet.getSheetId()));
    runId=Utilities.getUuid().slice(0,8);sandboxName='🧪SANDBOX_'+runId;
    while(source.getSheetByName(reportName))reportName='🧪 QA Results '+suffix++;
    // No active-roster writers, no form creation, no triggers, no production reset/publish endpoints.
    const candidate=source.insertSheet(sandboxName);
    qaAssert_(!existing.has(candidate.getSheetId()),'QA must use a newly created sandbox tab');
    sandbox=candidate;owned.push(sandbox);
    reportUrl=source.getUrl().replace(/#.*$/,'')+'#gid='+sandbox.getSheetId();
    qaResetSandbox_(sandbox,sandboxName);
    const deadline=started+180000;
    const cases=(mode==='platform'?[]:qaCases_()).concat(mode==='core'?[]:qaPlatformCases_(source,sandbox,owned));
    results=qaExecuteCases_(cases,()=>Date.now(),deadline);
  } catch(e){failure=diagnosticText_(e&&e.message||e,1500);results.push(['runner.failure','Runner','FAIL',0,failure]);}
  finally {
    DEV_WEBHOOKS_OFF_=previousSuppression;
    // Reporting failure must still restore suppression and release the lock.
    try {
      if(sandbox){
        // Only IDs registered during this run can be removed. Never delete a
        // roster tab, an older report or a sandbox left by an interrupted run.
        const remaining=new Set(source.getSheets().map(sheet=>sheet.getSheetId()));
        owned.forEach(sheet=>{
          const id=sheet.getSheetId();
          if(id===sandbox.getSheetId()||existing.has(id)||!remaining.has(id))return;
          try{source.deleteSheet(sheet);}catch(e){results.push(['runner.cleanup.'+id,'Runner','FAIL',0,diagnosticText_(e&&e.message||e,500)]);}
        });
        const report=qaResetSandbox_(sandbox,reportName);
        qaWriteReport_(report,results,{mode,started,finished:Date.now(),runId});
        reportReady=true;
        try{source.setActiveSheet(report);}catch(e){/* report remains accessible by its gid link */}
      }
    } catch(e){failure+=' Report failure: '+diagnosticText_(e&&e.message||e,500);results.push(['runner.report','Runner','FAIL',0,failure]);}
    finally {lock.releaseLock();}
  }
  const count=status=>results.filter(row=>row[2]===status).length;
  ui.alert('QA: '+count('PASS')+' passed; '+count('FAIL')+' failed; '+count('NOT RUN')+' not run.\n'
    +(sandbox?(reportReady?'Sandbox converted to results inside this roster:\n':'Sandbox created, but results could not be completed:\n')+reportUrl:'No sandbox tab could be created.')
    +(failure?'\n'+failure:'')+'\nLive roster data was not used as test input.');
  return {passed:count('PASS'),failed:count('FAIL'),notRun:count('NOT RUN'),reportReady,url:reportUrl};
}

/** Config-style report: summary first, then every case with readable diagnostics.
 * Values are static observations, never formulas or links to live roster data. */
function qaWriteReport_(sheet,results,meta) {
  const count=status=>results.filter(row=>row[2]===status).length;
  const mode={all:'All scenarios',core:'Core logic',platform:'Sheets platform'}[meta.mode]||meta.mode;
  const elapsed=Math.max(0,meta.finished-meta.started),height=Math.max(12,results.length+10);
  if(sheet.getMaxRows()<height)sheet.insertRowsAfter(sheet.getMaxRows(),height-sheet.getMaxRows());
  if(sheet.getMaxRows()>height)sheet.deleteRows(height+1,sheet.getMaxRows()-height);
  const safe=value=>typeof value==='string'&&/^\s*=/.test(value)?"'"+value:value;
  const rows=[['Dev / QA — Test results','','','',''],
    [mode+' · Run '+meta.runId+' · '+new Date(meta.finished).toISOString()+' (UTC)','','','',''],
    ['','','','',''],['PASSED','FAILED','NOT RUN','TOTAL TESTS','ELAPSED'],
    [count('PASS'),count('FAIL'),count('NOT RUN'),results.length,elapsed/1000],
    ['','','','',''],['Scenario results','','','',''],
    ['Case','Area','Result','Time (ms)','Detail']].concat(results.map(row=>row.map(safe)));
  sheet.getRange(1,1,height,5).setBackground('#191d23').setFontColor('#e4e9f0')
    .setFontFamily('Arial').setFontSize(11).setFontWeight('normal')
    .setVerticalAlignment('middle').setHorizontalAlignment('left').setWrap(true);
  sheet.getRange(1,1,rows.length,5).setNumberFormat('@').setValues(rows);
  sheet.setHiddenGridlines(true);sheet.setFrozenRows(8);sheet.setFrozenColumns(0);
  sheet.setTabColor(count('FAIL')?'#ff8a85':count('NOT RUN')?'#ffc970':'#76dda3');
  [320,190,115,115,600].forEach((width,i)=>sheet.setColumnWidth(i+1,width));
  sheet.showColumns(1,5);if(sheet.getMaxColumns()>5)sheet.hideColumns(6,sheet.getMaxColumns()-5);
  sheet.setRowHeights(1,height,32);sheet.setRowHeight(1,58);sheet.setRowHeight(2,38);
  [3,6].forEach(row=>sheet.setRowHeight(row,12));
  sheet.getRange(1,1,1,5).merge().setBackground('#202c3b').setFontColor('#eaf1fa').setFontSize(18).setFontWeight('bold');
  sheet.getRange(2,1,1,5).merge().setFontColor('#b6c7da').setFontSize(10);
  sheet.getRange(4,1,1,5).setBackground('#303c4b').setFontColor('#c3d7ee').setFontSize(10).setFontWeight('bold');
  sheet.getRange(5,1,1,5).setBackground('#24374a').setFontSize(18).setFontWeight('bold').setNumberFormat('0');
  sheet.getRange(5,1).setFontColor('#76dda3');sheet.getRange(5,2).setFontColor('#ff8a85');sheet.getRange(5,3).setFontColor('#ffc970');
  sheet.getRange(5,5).setNumberFormat('0.0" s"');sheet.setRowHeight(5,42);
  sheet.getRange(7,1,1,5).merge().setBackground('#2c3542').setFontColor('#79b8ff').setFontWeight('bold');
  sheet.getRange(8,1,1,5).setBackground('#303c4b').setFontColor('#c3d7ee').setFontWeight('bold');
  if(results.length){
    const banded=results.map((row,i)=>Array(5).fill(i%2?'#24282f':'#20242a'));
    const palette={PASS:['#203e30','#76dda3'],FAIL:['#492b31','#ff8a85'],'NOT RUN':['#453a25','#ffc970']};
    const colors=results.map(row=>{const values=Array(5).fill('#e4e9f0');values[2]=(palette[row[2]]||['','#e4e9f0'])[1];values[4]='#aeb9c8';return values;});
    results.forEach((row,i)=>{banded[i][2]=(palette[row[2]]||['#24374a'])[0];});
    sheet.getRange(9,1,results.length,5).setBackgrounds(banded).setFontColors(colors);
    sheet.getRange(9,1,results.length,1).setFontFamily('Roboto Mono').setFontSize(10);
    sheet.getRange(9,3,results.length,1).setFontWeight('bold');
    sheet.getRange(9,4,results.length,1).setNumberFormat('0').setHorizontalAlignment('right');
    sheet.autoResizeRows(9,results.length);
    sheet.getRange(8,1,results.length+1,5).createFilter();
  }
}
