// Opening a panel must not wait for spreadsheet/config/bootstrap reads.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const source = fs.readFileSync('RosterControlPanel.gs','utf8');
const templates=[], dialogs=[];
const forbidden=()=>{throw new Error('Data read before dialog opened')};
const ctx={HtmlService:{createTemplateFromFile(file){const t={file,evaluate(){return {setWidth(){return this},setHeight(){return this},setTitle(){return this}}}};templates.push(t);return t}},
  SpreadsheetApp:{getActive:forbidden,getUi:()=>({showModelessDialog:(html,title)=>dialogs.push(title)})},
  cpGetConfig_:forbidden,cpBootstrap:forbidden,runAction_:(label,fn)=>fn()};
vm.createContext(ctx);
for(const [name,next] of [['openSettingsPanel','/** Injectable read:'],['openControlPanel','/** Menu: jump']]){
  const start=source.indexOf('function '+name+'(');vm.runInContext(source.slice(start,source.indexOf(next,start)),ctx);
}
ctx.openSettingsPanel();ctx.openControlPanel('signups');ctx.openControlPanel('</script>');
assert.equal(dialogs.length,3);
assert.equal(templates[0].settingsBootJson,'null');assert.equal(templates[1].bootJson,'null');
assert.equal(templates[1].initialTab,'signups');assert.equal(templates[2].initialTab,'');
const html=fs.readFileSync('ControlPanel.html','utf8'), settings=fs.readFileSync('SettingsPanel.html','utf8');
assert(html.includes('api(applyBoot, onError, "cpBootstrap")'));
assert(settings.includes('if(SETTINGS_BOOT) fromData(SETTINGS_BOOT); else boot()'));
const content={innerHTML:'',attrs:{},setAttribute(k,v){this.attrs[k]=v}};
const calls=[];
const loading={DATA:null,CUR:'sheets',SECTION_BY_ID:{sheets:{title:'Sheets & layout',desc:'Your tabs'}},
  $:()=>content,esc:s=>String(s).replace(/&/g,'&amp;'),api:(ok,fail,name)=>calls.push({ok,fail,name}),fromData:()=>{}};
vm.createContext(loading);
vm.runInContext(settings.slice(settings.indexOf('  var BOOT_PENDING='),settings.indexOf('  function fromData(')),loading);
vm.runInContext(settings.slice(settings.indexOf('  function renderSection(){'),settings.indexOf('  /* Patrol card:')),loading);
loading.renderSection();assert(content.innerHTML.includes('Sheets &amp; layout'));assert(content.innerHTML.includes('Loading settings'));
loading.boot();loading.boot();assert.equal(calls.length,1,'overlapping initial loads share one request');
assert.equal(content.attrs['aria-busy'],'true');calls[0].fail({message:'Unavailable'});
assert.equal(content.attrs['aria-busy'],'false');assert(content.innerHTML.includes('Reload from sheet'));
loading.boot();assert.equal(calls.length,2,'failed load can retry');
console.log('Panel opening: shell shown without data reads, fresh-data RPC paths retained, deep links preserved.');
