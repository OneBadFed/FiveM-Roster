// Exercise the real outbound audit boundary without Google services.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
let headers=['HOURS'],readFailure=false,missing=false,sent=[];
const ctx={CONFIG:{sheets:{roster:'Roster',signups:'Review',signupForm:'Applicants',form:'Leave answers',patrol:'Patrol answers'},systemName:'Demo'},CONFIG_SHEET_NAME:'Config',norm_:v=>String(v||'').trim().toUpperCase(),rosterCols_:()=>({headerRow:7}),publishHeaderRow_:()=>7,diagnosticText_:v=>String(v??'').replace(/credential-secret/g,'[redacted]'),webhookFor_:()=>true,clamp_:(v,n)=>v.slice(0,n),dash_:v=>v,auditTypeLabel_:v=>v,notifyEvent_:(...args)=>sent.push(args),SpreadsheetApp:{getActive:()=>({getSheetByName:()=>missing?null:{getRange:(...args)=>{if(readFailure)throw Error('permission');return typeof args[0]==='string'?{getColumn:()=>2,getNumColumns:()=>headers.length}:{getDisplayValues:()=>[headers]}}}})}};
vm.createContext(ctx);
const source=fs.readFileSync('RosterTrust.gs','utf8');
vm.runInContext(source.slice(source.indexOf('function auditPublicValues_('),source.indexOf('/** @return {boolean} whether an installable onEdit audit trigger')),ctx);
function check(sheet,type,privateValue){sent=[];ctx.auditNotify_('Editor',sheet,'B8','private-before','private-after',type,'Member');assert.equal(sent.length,1);const serialized=JSON.stringify(sent[0]);assert.equal(serialized.includes('private-before'),!privateValue);assert.equal(serialized.includes('private-after'),!privateValue);if(privateValue){assert.equal(sent[0][3].old,'[private value withheld]');assert(sent[0][4].fields.some(f=>f.value==='[private value withheld]'))}}
for(const sheet of ['Review','Applicants','Leave answers','Patrol answers','Config','Webhook URLs'])check(sheet,'edit',true);
check('Roster','signup',true);
for(const header of ['Email','DOB','Date of birth','Phone','Address','OOC Name','SSN','API Key']){headers=[header];check('Roster','edit',true)}
headers=['HOURS','EMAIL'];check('Roster','edit',true);
headers=['HOURS'];check('Roster','edit',false);
readFailure=true;check('Roster','edit',true);readFailure=false;
missing=true;check('Roster','edit',true);missing=false;
sent=[];ctx.auditNotify_('Editor','Roster','B8','credential-secret','safe','edit','Member');assert(!JSON.stringify(sent).includes('credential-secret'));
console.log('Audit privacy: renamed private tabs, signup edits, sensitive headers, multi-column edits, failed reads, default/custom payloads and credential redaction passed');
