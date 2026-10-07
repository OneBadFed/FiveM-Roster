// Real startup trigger functions, with in-memory services and creation failures.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
let held=false,triggers=[],created=0,failAt=0,linked=false,audit=true;
const config={kv:{SCHEDULE:{NIGHTLY_HOUR:21},ACTIVITY:{AUTO_RESET:true,RESET_CADENCE:'MONTHLY',WEEKLY_HOURS_RESET:'OFF',RESET_DOM:8,WEEKLY_RESET_HOUR:4}}};
const ctx={cfg_:()=>config,PropertiesService:{getDocumentProperties:()=>({getProperty:()=>linked?'public':null})},SpreadsheetApp:{getActive:()=>({})},LockService:{getScriptLock:()=>({hasLock:()=>held,tryLock(){held=true;return true},releaseLock(){held=false}})},log_(){},logInfo_(){},cpEnsureAuditTrigger:()=>audit,cpInvalidateHealth_(){},publishOnChange(){},AppError:class extends Error{constructor(code,detail){super(detail.reason)}},ScriptApp:{WeekDay:{SUNDAY:1},getProjectTriggers:()=>triggers.slice(),deleteTrigger:t=>{triggers=triggers.filter(x=>x!==t)},newTrigger(name){const schedule={};const builder=new Proxy({}, {get:(target,key)=>key==='create'?()=>{created++;if(created===failAt)throw Error('creation quota');const trigger={name,schedule,getHandlerFunction:()=>name};triggers.push(trigger);return trigger}:(...args)=>{schedule[key]=args;return builder}});return builder}}};
vm.createContext(ctx);
function load(file,name){const code=fs.readFileSync(file,'utf8'),start=code.indexOf('function '+name+'('),end=code.indexOf('\nfunction ',start+1);vm.runInContext(code.slice(start,end<0?undefined:end),ctx)}
for(const name of ['replaceManagedTriggers_','installConfiguredTriggers_'])load('RosterSystem.gs',name);
load('RosterExtras.gs','installExtrasTriggers_');
const old=name=>({name,getHandlerFunction:()=>name});
triggers=[old('customJob'),old('onFormSubmit'),old('onFormSubmit'),old('processDailyLOAs'),old('publishSweep')];
ctx.installConfiguredTriggers_();
assert.equal(triggers.filter(t=>t.name==='onFormSubmit').length,1);
assert.equal(triggers.find(t=>t.name==='processDailyLOAs').schedule.atHour[0],21);
assert(triggers.some(t=>t.name==='customJob'));
assert(!triggers.some(t=>t.name==='publishSweep'),'unlinked public publishing has no minute trigger');
assert.equal(triggers.find(t=>t.name==='weeklyResetScheduled').schedule.onMonthDay[0],8,'monthly cadence ignores weekly OFF');
const before=triggers.slice();created=0;failAt=2;
assert.throws(()=>ctx.installConfiguredTriggers_(),/creation quota/);
assert.deepEqual(triggers,before,'failed core replacement retains original triggers and removes staged trigger');assert(!held);
failAt=0;created=0;linked=true;ctx.installConfiguredTriggers_();ctx.installConfiguredTriggers_();
assert.equal(triggers.filter(t=>t.name==='publishOnChange').length,2);
assert.equal(triggers.filter(t=>t.name==='publishSweep').length,1);
config.kv.ACTIVITY.AUTO_RESET=false;ctx.installConfiguredTriggers_();assert(!triggers.some(t=>t.name==='weeklyResetScheduled'));
audit=false;assert.throws(()=>ctx.installConfiguredTriggers_(),/audit trigger/,'busy audit verification cannot report success');
const wizard=fs.readFileSync('RosterSystem.gs','utf8').split('function setupWizard()')[1].split('function installDataValidation_')[0];
assert(wizard.includes('installConfiguredTriggers_()'));assert(!wizard.includes('styleFormResponses_(sheet)'));assert(!wizard.includes('CONFIG.form.discord,'));
assert(!/FormApp\.create\s*\(/.test(fs.readdirSync('.').filter(f=>f.endsWith('.gs')).map(f=>fs.readFileSync(f,'utf8')).join('\n')));
console.log('Startup: configured schedules, duplicate cleanup, custom trigger preservation, creation rollback, monthly/OFF semantics, public-link gating, audit failure and department-owned forms passed');
// Real seeding twice: populated defaults only on the first pass; no clear/write on the verified pass.
let grid=[],writes=0,clears=0;
const sheet=new Proxy({getSheetId:()=>99,getLastRow:()=>grid.length,getLastColumn:()=>5,getMaxRows:()=>2000,getName:()=> 'Config',getProtections:()=>[],getRange(r,c,n=1,w=1){return new Proxy({}, {get:(target,key)=>key==='getDisplayValues'?()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>String(grid[r+i-1]?.[c+j-1]??''))):key==='setValues'?values=>{grid=values.map(row=>Array.from(row));writes++;return target}:key==='getDisplayValue'?()=>String(grid[r-1]?.[c-1]??''):key.startsWith('clear')?()=>{clears++;return sheet.getRange(r,c,n,w)}:()=>sheet.getRange(r,c,n,w)})}}, {get:(target,key)=>key in target?target[key]:()=>sheet});
const seedCtx={SpreadsheetApp:{ProtectionType:{SHEET:1},flush(){}},console};vm.createContext(seedCtx);vm.runInContext(fs.readFileSync('RosterConfig.gs','utf8'),seedCtx);
seedCtx.findConfigSheet_=()=>sheet;seedCtx.cfgInvalidate_=()=>{};seedCtx.theme_=()=> '#222222';
seedCtx.seedConfigTab_({});const initialWrites=writes,initialClears=clears;
assert(initialWrites>0);seedCtx.seedConfigTab_({});assert.equal(writes,initialWrites);assert.equal(clears,initialClears,'unchanged config preserves notes, formatting and validation');
console.log('Config seeding: verified tables and settings cause no repeated grid writes or clearing.');
const styled=seedCtx.configSheetStylePlan_(grid),beforeValues=JSON.stringify(grid);
assert.equal(styled[0].kind,'title');assert(styled.some(row=>row.kind==='columns'));assert(styled.some(row=>row.kind==='data'&&row.backgrounds[1]==='#24374a'));
seedCtx.ensureConfigSheetStyle_(sheet,grid,true);assert.equal(JSON.stringify(grid),beforeValues,'restyling does not rewrite settings or table values');
if(process.argv.includes('--preview')){
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html='<!doctype html><meta charset="utf-8"><title>Config design preview</title><style>body{margin:0;background:#191d23;color:#e4e9f0;font:11px Arial}header{padding:14px 20px;background:#14181e;color:#aeb9c8}table{border-collapse:collapse;table-layout:fixed;width:1390px}td{padding:8px 10px;white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:middle;box-sizing:border-box}td:first-child{font:10px ui-monospace,Consolas,monospace}.title td{height:58px}.title td:nth-child(2){font-size:18px;font-weight:bold}.section td{height:44px;font-weight:bold}.columns td{height:30px;font-weight:bold}.space td{height:12px;padding:0}.data td{min-height:32px}</style><header>Config sheet design preview · example defaults · actual spreadsheet formatting may vary slightly</header><table><colgroup>'+[270,280,540,160,140].map(w=>'<col style="width:'+w+'px">').join('')+'</colgroup>'+grid.map((row,i)=>'<tr class="'+styled[i].kind+'">'+row.map((v,c)=>'<td style="background:'+styled[i].backgrounds[c]+';color:'+styled[i].colors[c]+'">'+escape(v)+'</td>').join('')+'</tr>').join('')+'</table>';
  fs.mkdirSync('tools/.preview',{recursive:true});fs.writeFileSync('tools/.preview/Config.preview.html',html.replace('font:11px Arial','font:11pt Arial').replace('font:10px ui-monospace','font:10pt ui-monospace').replace('font-size:18px','font-size:18pt'));
  fs.writeFileSync('tools/.preview/Config.preview.json',JSON.stringify({grid,styled}));console.log('Wrote tools/.preview/Config.preview.html');
}
