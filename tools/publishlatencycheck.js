// Execute the optimized publishing paths with service counters and fault injection.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const panel=fs.readFileSync('RosterControlPanel.gs','utf8'),fast=fs.readFileSync('RosterPublishFast.gs','utf8'),config=fs.readFileSync('RosterConfig.gs','utf8');
const manifest=JSON.parse(fs.readFileSync('appsscript.json','utf8'));
assert(manifest.dependencies.enabledAdvancedServices.some(s=>s.serviceId==='sheets'&&s.version==='v4'&&s.userSymbol==='Sheets'));
const evaluate=(ctx,source)=>{vm.createContext(ctx);vm.runInContext(source,ctx);return ctx;};

// Native writer: three writes for a 138-row grid beside a vertical group label
// and a public-owned column, rather than one write for each row/column.
const writer=evaluate({},panel.slice(panel.indexOf('function writeValuesSafe_('),panel.indexOf('/**',panel.indexOf('function writeValuesSafe_('))));
function gridCase(rows,cols,merges,keep){
 const values=Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>r*cols+c));
 const stored=Array.from({length:rows},()=>new Array(cols).fill('kept')),writes=[];
 const blocked=(r,c)=>merges.some(m=>r>=m.r&&r<m.r+m.n&&c>=m.c&&c<m.c+m.w&&(r!==m.r||c!==m.c));
 const dest={getRange:(row,col,n=1,w=1)=>({
  getMergedRanges:()=>merges.map(m=>({getRow:()=>m.r+1,getColumn:()=>m.c+1,getNumRows:()=>m.n,getNumColumns:()=>m.w})),
  setValues:block=>{writes.push({row,col,n,w});block.forEach((line,i)=>line.forEach((value,j)=>{const r=row+i-1,c=col+j-1;assert(!keep[r][c]&&!blocked(r,c),'kept/merged interior must never be written');stored[r][c]=value;}));},
  setValue:value=>{const r=row-1,c=col-1;assert(!keep[r][c]&&!blocked(r,c));writes.push({row,col,n:1,w:1});stored[r][c]=value;}
 })};
 assert.equal(writer.writeValuesSafe_(dest,1,1,values,keep),0);
 for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)assert.equal(stored[r][c],keep[r][c]||blocked(r,c)?'kept':values[r][c]);
 return writes;
}
const mask=Array.from({length:138},()=>Array.from({length:24},(_,c)=>c===3));
assert.equal(gridCase(138,24,[{r:0,c:0,n:138,w:1}],mask).length,3);
let seed=42;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let trial=0;trial<80;trial++){
 const rows=10,cols=8,keep=Array.from({length:rows},()=>Array.from({length:cols},()=>random()<.15));
 gridCase(rows,cols,[{r:1,c:0,n:4,w:1},{r:5,c:2,n:2,w:3}],keep);
}
let cells=0;const fallback={getRange:(r,c,n=1,w=1)=>({getMergedRanges:()=>[],setValues(){throw Error('array result');},setValue(){cells++;}})};
assert.equal(writer.writeValuesSafe_(fallback,1,1,[[1,2],[3,4]],[[true,false],[true,false]]),0);assert.equal(cells,2);
assert.throws(()=>writer.writeValuesSafe_({getRange:()=>({getMergedRanges:()=>[],setValues(){throw Error('permission denied');}})},1,1,[[1]],null),/permission denied/);
assert.equal(writer.writeValuesSafe_({getRange:()=>({getMergedRanges:()=>[{getRow:()=>1,getColumn:()=>1,getNumRows:()=>3,getNumColumns:()=>1}],setValue(){throw Error('unwritable');}})},2,1,[[1],[2]],null),0,'partial merged interior with anchor outside range stays untouched');
console.log('Safe writer: 138 rows -> 3 writes, randomized masks/merges, partial overlaps, spill fallback and permission failures passed.');

// Actual header-match orchestration: reordered columns, privacy, unmatched cells,
// public-owned cells, literal text and formats with bounded service counts.
let sourceReads=0,formatReads=0,maskReads=0,formatWrites=0;
const srcValues=Array.from({length:138},(_,r)=>['Member '+r,'PRIVATE_EMAIL',r/2,'PRIVATE_DOB','Officer']);srcValues[0][0]='=literal';
const srcFormats=srcValues.map(()=>['@','@','0.0','yyyy-mm-dd','@']);
const destination=srcValues.map(()=>['old rank','old name','LOCAL','PRIVATE_RESIDUE',0]),formats=srcValues.map(()=>new Array(5).fill('original'));
const dest={name:'Roster',headers:['RANK','NAME','PUBLIC NOTE','EMAIL','HOURS'],getName:()=> 'Roster',getLastRow:()=>139,getLastColumn:()=>5,getMaxColumns:()=>5,
 getRange:(r,c,n=1,w=1)=>({getMergedRanges:()=>[],getDisplayValues:()=>[dest.headers],
  setValues:rows=>rows.forEach((line,i)=>line.forEach((value,j)=>destination[r+i-2][c+j-1]=value)),
  setNumberFormats:rows=>{formatWrites++;rows.forEach((line,i)=>line.forEach((value,j)=>formats[r+i-2][c+j-1]=value));},
  clearContent:()=>{for(let i=0;i<n;i++)for(let j=0;j<w;j++)destination[r+i-2][c+j-1]='';}
 })};
const src={getName:()=> 'Roster',getLastRow:()=>139,getLastColumn:()=>5,getMaxColumns:()=>7,
 getRange:(r,c,n,w)=>({getDisplayValues:()=>[['NAME','EMAIL','HOURS','DOB','RANK']],getValues:()=>{sourceReads++;return srcValues.map(row=>row.slice(c-1,c-1+w));},getNumberFormats:()=>{formatReads++;return srcFormats;}})};
const mapping=evaluate({Date,CONFIG:{sheets:{welcome:'Welcome',tracker:'LOA',patrolLog:'Patrol'}},tabKey_:s=>s,norm_:s=>s,
 publishHeaderRow_:()=>1,publishSensitiveHeader_:h=>['EMAIL','DOB'].includes(h),publishFitRows_:()=>{},publishSyncPeriodHeaders_:()=>{},publishStyleableTab_:()=>false,publishMirrorHeights_:()=>{},
 publishKeepMask_:(d,r,c,n,w)=>{maskReads++;const keep=Array.from({length:n},()=>new Array(w).fill(false));keep[5][1]=true;return keep;},log_:()=>{}
},panel.slice(panel.indexOf('function publishReadCells_('),panel.indexOf('/**',panel.indexOf('function publishReadCells_(')))+panel.slice(panel.indexOf('function writeValuesSafe_('),panel.indexOf('/**',panel.indexOf('function writeValuesSafe_(')))+panel.slice(panel.indexOf('function publishMirrorTab_('),panel.indexOf('function publishPublicRoster_(')));
assert.equal(mapping.publishMirrorTab_(src,dest,false),138);
assert.equal(sourceReads,1);assert.equal(formatReads,1);assert.equal(maskReads,1);assert.equal(formatWrites,2);
assert.equal(destination[0][1],"'=literal");assert.equal(destination[5][1],'old name');
destination.forEach((row,r)=>{assert.equal(row[0],'Officer');assert.equal(row[2],'LOCAL');assert.equal(row[3],'');assert.equal(row[4],r/2);});
formats.forEach(row=>{assert.equal(row[0],'@');assert.equal(row[1],'@');assert.equal(row[2],'original');assert.equal(row[4],'0.0');});
assert(!JSON.stringify(destination).includes('PRIVATE'));
console.log('Header matching: one source/mask/format read, reordered columns, private data scrubbing, kept cells and formats passed.');

// Advanced Sheets adapter never needs manually constructed OAuth tokens; a
// service failure or incomplete metadata still uses exact native dimensions.
let gets=0,posts=[],warnings=[];
const api=evaluate({SpreadsheetApp:{flush(){}},Sheets:{Spreadsheets:{
 get:(id,options)=>{gets++;assert.equal(id,'source');assert(!options.fields.includes('rowData'));return {sheets:[{properties:{sheetId:7},data:[{rowMetadata:Array.from({length:100},()=>({pixelSize:24})),columnMetadata:Array.from({length:40},()=>({pixelSize:120}))}]}]};},
 batchUpdate:(body,id)=>{assert.equal(id,'public');posts.push(body);}
}},ScriptApp:{getOAuthToken(){throw Error('must not construct OAuth token');}},groupColLetter_:()=> 'AN',diagnosticText_:s=>s,logWarn_:(...args)=>warnings.push(args)},fast);
const dimensionSource={getName:()=> 'Roster',getSheetId:()=>7,getParent:()=>({getId:()=> 'source'})};
const dimensionDest={getSheetId:()=>9,getParent:()=>({getId:()=> 'public'})};
assert(api.publishDimensionsFast_(dimensionSource,dimensionDest,100,40));assert.equal(gets,1);assert.equal(posts.length,1);assert.equal(posts[0].requests.length,2);
api.Sheets.Spreadsheets.batchUpdate=()=>{throw Error('API disabled');};assert.equal(api.publishDimensionsFast_(dimensionSource,dimensionDest,100,40),false);assert.equal(warnings.length,1);assert(warnings[0][1].includes('Cloud project'));
assert.equal(api.publishDimensionsFast_(dimensionSource,dimensionDest,100,40),false);assert.equal(gets,2,'failed service not retried for every tab');
console.log('Advanced dimensions: enabled manifest, no manual OAuth, exact sizes, grouped requests and rejected-service fallback passed.');

// Batch Welcome formula-reference capture honors quoting and offsets. Invalid
// metadata returns null so the caller scans natively before performing a swap.
const targetSheets=[7,8,9].map(id=>({getSheetId:()=>id}));
const target={getId:()=> 'public',getSheets:()=>targetSheets},old=targetSheets[0];
let formulaMeta={sheets:targetSheets.map(sheet=>({properties:{sheetId:sheet.getSheetId()}}))};
formulaMeta.sheets[1].data=[{startRow:3,startColumn:2,rowData:[{values:[{userEnteredValue:{formulaValue:"='Department''s Welcome'!AA5"}},{userEnteredValue:{formulaValue:'=SUM(A1:A3)'}}]}]}];
const refs=evaluate({Sheets:{Spreadsheets:{get:(id,args)=>{assert.equal(id,'public');assert(args.fields.includes('formulaValue'));return formulaMeta;}}}},fast);
let incoming=refs.publishWelcomeReferencesFast_(target,old,"Department's Welcome");assert.equal(incoming.length,1);assert.equal(incoming[0].row,4);assert.equal(incoming[0].col,3);assert.equal(incoming[0].sheet,targetSheets[1]);
formulaMeta={sheets:[{properties:{sheetId:7}}]};assert.equal(refs.publishWelcomeReferencesFast_(target,old,'Welcome'),null);
formulaMeta={sheets:[{properties:{sheetId:7}},{properties:{sheetId:7}},{properties:{sheetId:9}}]};assert.equal(refs.publishWelcomeReferencesFast_(target,old,'Welcome'),null,'duplicate IDs cannot masquerade as a complete scan');
refs.Sheets.Spreadsheets.get=()=>{throw Error('permission denied');};assert.equal(refs.publishWelcomeReferencesFast_(target,old,'Welcome'),null);
console.log('Welcome references: single metadata scan, quoted names, offsets and native fallback passed.');

// Repeat notices are cache-limited, changed notices log immediately, unavailable
// cache never blocks diagnostics. Actual cfg_ uses this after memoizing config.
const cache=new Map(),notices=[];
const cacheService={get:k=>cache.get(k),put:(k,v,ttl)=>{assert(ttl<=21600);cache.set(k,v);}};
const noticesCtx=evaluate({CacheService:{getDocumentCache:()=>cacheService},slog_:(...args)=>notices.push(args)},config.slice(config.indexOf('function diagnosticNotice_('),config.indexOf('/* ======================================================================',config.indexOf('function diagnosticNotice_('))));
for(let i=0;i<20;i++)noticesCtx.diagnosticNotice_('INFO','E-110','cfg_','tiers disabled',21600);
assert.equal(notices.length,1);noticesCtx.diagnosticNotice_('WARN','E-103','cfg_','new warning',21600);assert.equal(notices.length,2);
cache.clear();noticesCtx.diagnosticNotice_('INFO','E-110','cfg_','tiers disabled',21600);assert.equal(notices.length,3);
noticesCtx.CacheService.getDocumentCache=()=>{throw Error('cache unavailable');};assert.doesNotThrow(()=>noticesCtx.diagnosticNotice_('WARN','','API','fallback',3600));assert.equal(notices.length,4);
assert(config.includes("if (!tiers.length) problems.push({ sev: 'INFO'"));
assert(config.indexOf('CFG_ = materialize_(config, hasTab);')<config.indexOf('problems.forEach((p) => diagnosticNotice_'));
console.log('Diagnostics: repeated/changed notices, cache expiry/outage, optional empty tiers and config memo ordering passed.');
