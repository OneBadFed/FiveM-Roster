// Focused Settings regressions; does not access Google services.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('SettingsPanel.html','utf8');
const ctx={Date,KV:{'TEST.KEY':{key:'KEY',help:'schema help'}},LABELS:{'TEST.KEY':'Friendly label'},HELPS:{'TEST.KEY':'Displayed help'}};
vm.createContext(ctx);
function extract(start,end){return html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));}
vm.runInContext(extract('function fmtExample(pat)','function refreshFmtExamples'),ctx);
assert(ctx.fmtExample("'WEEK OF' d MMM").startsWith('WEEK OF '));
assert.equal(ctx.fmtExample("'Today''s date'"),"Today's date");
assert.equal(ctx.fmtExample('yyyyMMdd').length,8);
vm.runInContext(extract('function settingMatches_','function secHits'),ctx);
assert(ctx.settingMatches_('TEST.KEY','displayed help'));
assert(ctx.settingMatches_('TEST.KEY','friendly label'));
ctx.DC_DEFAULTS={event:{fields:[{n:'Name',v:'Value',inline:true}]}};
vm.runInContext(extract('function embIsDefault_','function dcCurMeta'),ctx);
assert(ctx.embIsDefault_('event',ctx.DC_DEFAULTS.event));
assert(!ctx.embIsDefault_('event',{fields:[{n:'Name',v:'Value',inline:true},{n:'',v:'',inline:true}]}),'empty draft field keeps its index');
console.log('Settings: displayed search text, quoted date patterns, and draft embed field indexes passed.');
