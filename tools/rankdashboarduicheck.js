// Exercise the real guided editor handlers and lazy read endpoint, without writing Google data.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('SettingsPanel.html','utf8').replace(/\r\n/g,'\n'),panel=fs.readFileSync('RosterControlPanel.gs','utf8');
function load(ctx,src,start,end){const a=src.indexOf(start),b=src.indexOf(end,a+start.length);assert(a>=0&&b>a,start);vm.runInContext(src.slice(a,b),ctx);}
const elements={},events={},requests=[];
const element=()=>({innerHTML:'',dataset:{},setAttribute(){},contains(){return false;},querySelectorAll(){return [];}});
const c={Date,console,Math,DATA:{ranks:['Officer','Cadet']},KV:{},TBL:{DASHBOARD_GROUPS:[['Supervisors','Officer'],['Patrol','Cadet']],SECTION_TAGS:[['Training','CADET','training']],RANKS:[],STATUSES:[]},TBLBASE:{},TABLE_DIRTY:null,
  $:id=>elements[id]||null,esc:v=>String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
  ICONS:{table:'',dashboard:'',chev:''},DD:{},DDSEQ:0,DDOPEN:null,enhanceControls_(){},updateBar(){},toast(msg){c.lastToast=msg;},renderNav(){},renderSection(){},sectionEntered(){},
  api:(success,failure,name,...args)=>requests.push({success,failure,name,args}),document:{visibilityState:'visible',querySelectorAll:()=>[],querySelector:selector=>elements[selector]||null}};
vm.createContext(c);
for(const id of ['content','ranklabelsHost','headcountEditor','dashPreview','tagCheat','sectionEditor','groupWarnings'])elements[id]=element();
elements.content.addEventListener=(name,handler)=>(events[name]||(events[name]=[])).push(handler);
load(c,html,'function kvChanged(bk)','function statusFlow()');load(c,html,'function statusFlow()','var SECTION_BY_KEY');
load(c,html,'function tagCheatText()','/* Automation narrates');
load(c,html,'function dd(attrs,','function openDD(btn)');load(c,html,'function routeDD(attrs,','/* ── controls ── */');
load(c,html,'var RANKLIST=null','function rankIconsShell()');load(c,html,'function rkInitials(r)','function renderRankIcons(');
c.RANKLIST=[{rank:'Officer',members:3,icon:''},{rank:'Cadet',members:1,icon:''},{rank:'<Captain>',members:0,icon:''}];
c.TBLBASE.DASHBOARD_GROUPS=JSON.stringify(c.TBL.DASHBOARD_GROUPS);
load(c,html,"$('content').addEventListener('input',function(e){\n    var t=e.target;\n    if(t.id==='rankSearch')","$('content').addEventListener('change',function(e){\n    var t=e.target;\n    if(t.type==='checkbox'");
load(c,html,"$('content').addEventListener('click',function(e){\n    var u=","$('content').addEventListener('keydown',function(e){\n    if(e.key==='Enter'||");
function emit(name,target){(events[name]||[]).forEach(f=>f({target,key:target.key,preventDefault(){}}));}
function click(data){const b={dataset:data,hasAttribute(name){return Object.keys(data).some(k=>'data-'+k.replace(/[A-Z]/g,l=>'-'+l.toLowerCase())===name);},setAttribute(){}};
  b.closest=selector=>selector.split(',').some(s=>b.hasAttribute(s.slice(1,-1)))?b:null;emit('click',{closest:b.closest});}
c.renderRankLabels();assert(elements.ranklabelsHost.innerHTML.includes('Counted under Supervisors'));assert(elements.ranklabelsHost.innerHTML.includes('&lt;Captain>'));assert(!elements.ranklabelsHost.innerHTML.includes('data-rldel='));
emit('input',{id:'rankSearch',value:'CADET',dataset:{}});assert(!elements.ranklabelsHost.innerHTML.includes('3 members'));assert(elements.ranklabelsHost.innerHTML.includes('1 member'));
emit('input',{id:'rankSearch',value:'',dataset:{}});click({rankfilter:'1'});assert(elements.ranklabelsHost.innerHTML.includes('&lt;Captain>'));assert(!elements.ranklabelsHost.innerHTML.includes('1 member'));click({rankfilter:'1'});
click({groupmove:'1',direction:'-1'});assert.equal(c.TBL.DASHBOARD_GROUPS[0][0],'Patrol');
click({groupmove:'0',direction:'-1'});assert.equal(c.TBL.DASHBOARD_GROUPS[0][0],'Patrol','bounds cannot wrap priority');
click({groupdelete:'0'});assert.equal(c.TBL.DASHBOARD_GROUPS.length,1);assert(elements.headcountEditor.innerHTML.includes('Undo deletion'));
click({groupundo:'1'});assert.equal(c.TBL.DASHBOARD_GROUPS[0][0],'Patrol');assert.equal(c.GROUP_UNDO,null);
emit('change',{dataset:{groupchoice:'0'},value:'Officer'});assert(c.groupWarnings_().some(w=>w.includes('first matching group')));
click({groupremove:'0',category:'Officer'});assert.equal(c.TBL.DASHBOARD_GROUPS[0][1],'Cadet');
elements['[data-groupcustom="0"]']={value:'Specialist'};click({groupcustomadd:'0'});assert(c.TBL.DASHBOARD_GROUPS[0][1].includes('Specialist'));click({groupcustomadd:'0'});assert.equal(c.listOf(c.TBL.DASHBOARD_GROUPS[0][1]).length,2,'deduplicate custom selection');
elements['[data-groupcustom="0"]'].value='Officer, Cadet';click({groupcustomadd:'0'});assert(c.lastToast.includes('one rank'));
emit('input',{dataset:{groupname:'0'},value:'Super-visors'});assert(c.groupWarnings_().some(w=>w.includes('counter name')));
elements.rlNew={value:'SUPER VISORS'};click({rladd:'1'});assert.equal(c.TBL.DASHBOARD_GROUPS.length,2,'reject counter collision before creating a group');
elements.rlNew.value='Division 2';click({rladd:'1'});assert.equal(c.TBL.DASHBOARD_GROUPS.length,3);
click({sectionadd:'1'});assert.equal(c.TBL.SECTION_TAGS.length,2);assert(c.sectionEditor_().includes('data-sectionedit="1"'));click({sectiondelete:'1'});assert.equal(c.TBL.SECTION_TAGS.length,1);
const unchanged=elements.headcountEditor.innerHTML;emit('input',{dataset:{groupname:'0'},value:'Division 1'});emit('change',{dataset:{groupname:'0'},value:'Division 1'});assert.equal(elements.headcountEditor.innerHTML,unchanged,'renaming does not destroy focused inputs or swallow the next button click');
c.TBL.DASHBOARD_GROUPS.push(['<script>','Officer']);assert(!c.headcountEditor_().includes('<script>'));assert(c.headcountEditor_().includes('&lt;script>'));
const stats={total:4,active:2,leaves:1,openSlots:3,totalHours:10.5,groups:{Supervisors:2}};
c.loadDashboardPreview_();c.loadDashboardPreview_();assert.equal(requests.length,1);assert.equal(requests[0].name,'cpDashboardPreview');
requests[0].success({stats,counters:[{tag:'members',value:4}],readAt:Date.now(),enabled:true,refreshPending:true,publicLinked:true,publicPending:true});assert(elements.dashPreview.innerHTML.includes('Statistics refresh queued'));assert(elements.dashPreview.innerHTML.includes('Unsaved edits'));assert(elements.dashPreview.innerHTML.includes('Public update queued'));
c.loadDashboardPreview_();c.DASH_GEN++;c.DASH_PENDING=false;c.loadDashboardPreview_();requests[2].success({stats:{...stats,total:9},counters:[],readAt:Date.now()});requests[1].success({stats,counters:[],readAt:Date.now()});assert.equal(c.DASH_PREVIEW.stats.total,9,'old RPC cannot replace newer statistics');
c.loadDashboardPreview_();requests[3].failure(Error('<permission denied>'));assert.equal(c.DASH_PREVIEW,null);assert(elements.dashPreview.innerHTML.includes('&lt;permission denied>'));c.loadDashboardPreview_();assert.equal(requests.length,5,'retry remains available');
// Saved preview uses the shared engine statistic/tag calculation and reads queue metadata only.
const endpoint={Date,CONFIG:{sheets:{roster:'Roster'},sectionCategories:[{label:'Training'}],dashboard:{}},cfg_:()=>({dashboardEnabled:false}),statTagKey_:n=>String(n).replace(/[^A-Za-z0-9]/g,'').toLowerCase(),statTagValue_:(s,tag)=>tag==='active'?s.active:tag==='members'?s.total:0,
 dashboardStats_:r=>{assert.equal(r.name,'Roster');return {...stats,tierCounts:{Active:2},top:[{n:'Private name',h:10}]};},
 SpreadsheetApp:{getActive:()=>({getSheetByName:()=>({name:'Roster'})})},PropertiesService:{getDocumentProperties:()=>({getProperties:()=>({'RE_DEFER_JOB:dashboard':'pending',PUBLIC_ROSTER_ID:'linked',PUBLIC_DIRTY:'1'})})}};
vm.createContext(endpoint);load(endpoint,panel,'function cpDashboardPreview()','function cpRankIcons()');
const preview=endpoint.cpDashboardPreview();assert(preview.refreshPending&&preview.publicPending&&preview.publicLinked);assert.equal(preview.enabled,false);assert.equal(preview.stats.total,4);assert(!JSON.stringify(preview).includes('Private name'));assert.equal(preview.counters.find(x=>x.tag==='group:supervisors').value,2);
endpoint.SpreadsheetApp.getActive=()=>({getSheetByName:()=>null});assert.throws(()=>endpoint.cpDashboardPreview(),/Choose an existing roster tab/);
const editor=elements.headcountEditor,typing={dataset:{groupcustom:'0'},value:'typing draft',selectionStart:3,selectionEnd:8};c.document.activeElement=typing;editor.contains=el=>el===typing;
const beforeTyping=editor.innerHTML;c.refreshGroupEditor_();assert.equal(editor.innerHTML,beforeTyping,'lazy rank reads do not replace an active editor');
let focused=false,selection;const replacement={dataset:{groupcustom:'0'},value:'',focus(){focused=true;},setSelectionRange(a,b){selection=[a,b];}};
editor.querySelectorAll=selector=>selector==='[data-groupchoice],[data-groupname],[data-groupcustom]'?[replacement]:[];c.refreshGroupEditor_(true);assert(focused);assert.equal(replacement.value,'typing draft');assert.deepEqual(selection,[3,8],'explicit editor refresh preserves the custom entry and caret');
// Appearance uses the same dark popup, labels and route as every other settings dropdown.
c.DD={};c.DDSEQ=0;
const sectionMarkup=c.sectionEditor_(),appearance=c.DD.dd1;
assert(sectionMarkup.includes('class="ddbtn"'));assert(!sectionMarkup.includes('<select'));assert(!sectionMarkup.includes('<option'));
assert(sectionMarkup.includes('aria-label="Section 1 appearance"'));assert(sectionMarkup.includes('data-sectiontone="0"'));assert(sectionMarkup.includes('Training</span>'));
assert.deepEqual(Array.from(appearance.options,o=>o.v),['exec','admin','super','cadet','training','patrol','aux']);
const swatch={style:{}},toneButton={parentNode:{querySelector:selector=>selector==='.tone-preview'?swatch:null}};
const sectionIdentity=c.TBL.SECTION_TAGS[0].slice(0,2);c.TBLBASE.SECTION_TAGS=JSON.stringify(c.TBL.SECTION_TAGS);
c.routeDD(appearance.attrs,'admin',toneButton);
assert.equal(c.TBL.SECTION_TAGS[0][2],'admin');assert.equal(swatch.style.background,'var(--section-admin)');assert(c.tblChanged('SECTION_TAGS'));
assert.deepEqual(c.TBL.SECTION_TAGS[0].slice(0,2),sectionIdentity,'appearance changes preserve labels and keywords');
assert.doesNotThrow(()=>c.routeDD({sectiontone:'99'},'patrol',toneButton),'a removed row cannot be overwritten');
c.TBL.SECTION_TAGS[0][2]='custom <tone>';assert(c.sectionEditor_().includes('custom &lt;tone> (current)'));
assert.equal(c.TBL.SECTION_TAGS[0][2],'custom <tone>','viewing an unfamiliar tone preserves it until a preset is selected');
c.routeDD({sectiontone:'0'},'patrol',toneButton);assert.equal(swatch.style.background,'var(--section-patrol)');
// Exercise the actual popup keyboard and click handlers with browser geometry/focus fixtures.
load(c,html,'function openDD(btn)','function routeDD(attrs,');
c.window={innerWidth:1000,innerHeight:700};c.document.body={appendChild(){},contains:()=>true};
let popup,options;const label={textContent:'Patrol',classList:{toggle(){}}};
const popupButton={...toneButton,dataset:{ddkey:'dd1'},classList:{add(){},remove(){}},getAttribute:()=> 'Section 1 appearance',setAttribute(){},getBoundingClientRect:()=>({left:700,top:200,bottom:224,width:135}),querySelector:()=>label,focus(){c.document.activeElement=this;}};
appearance.value='patrol';
c.document.createElement=()=>{
  const handlers={};popup={style:{},offsetHeight:180,offsetWidth:190,setAttribute(){},remove(){this.removed=true;},addEventListener:(name,fn)=>handlers[name]=fn};
  options=appearance.options.map(o=>({dataset:{v:o.v},focus(){c.document.activeElement=this;},scrollIntoView(){},click(){handlers.click({target:{closest:()=>this}});}}));
  popup.querySelector=selector=>selector==='.ddopt.sel'?options.find(o=>o.dataset.v===appearance.value):selector==='.ddopt'?options[0]:null;
  popup.querySelectorAll=()=>options;popup.key=key=>handlers.keydown({key,preventDefault(){},stopPropagation(){}});return popup;
};
c.openDD(popupButton);assert.equal(c.document.activeElement.dataset.v,'patrol');
assert(popup.innerHTML.includes('Administration'));assert(!popup.innerHTML.includes('<option'));
popup.key('Home');popup.key('ArrowDown');popup.key('Enter');
assert.equal(c.TBL.SECTION_TAGS[0][2],'admin');assert.equal(label.textContent,'Administration');assert(popup.removed);assert.equal(c.document.activeElement,popupButton);
c.openDD(popupButton);popup.key('Escape');assert.equal(c.TBL.SECTION_TAGS[0][2],'admin');assert(popup.removed);assert.equal(c.document.activeElement,popupButton);
c.openDD(popupButton);options.find(o=>o.dataset.v==='patrol').click();assert.equal(c.TBL.SECTION_TAGS[0][2],'patrol');assert.equal(label.textContent,'Patrol');
// Rebuilding the editor closes its popup and retires only that editor's old dropdown IDs.
let menuRemoved=false;
c.DD.oldTone=appearance;c.DD.other={};
elements.sectionEditor.contains=()=>true;elements.sectionEditor.querySelectorAll=()=>[{dataset:{ddkey:'oldTone'}}];
c.DDOPEN={btn:{classList:{remove(){}},setAttribute(){}},menu:{remove(){menuRemoved=true;}}};
c.refreshStudio_();assert(menuRemoved);assert.equal(c.DDOPEN,null);assert(!c.DD.oldTone);assert(c.DD.other);
// The selected preset travels in the real Save payload, rather than saving a display label.
c.SAVE_PENDING=false;c.BOOT_PENDING=false;c.BASE={};c.setSaving_=()=>{};c.setTimeout=()=>{};
elements.savepill={classList:{add(){}}};elements.sptxt=element();elements.saveBtn={querySelector:()=>({outerHTML:''})};
load(c,html,'function saveAll()','/* ── rank icons');c.saveAll();
const save=requests[requests.length-1];assert.equal(save.name,'cpApplyConfig');assert.equal(save.args[0].tables.SECTION_TAGS[0][2],'patrol');
console.log('Guided Ranks/Dashboard: filters, priority, selection, rename/counter collisions, escaping, deletion/undo, custom categories, shared appearance dropdown, tone swatches, custom tone preservation, popup cleanup, save payload, saved preview, queues, stale requests, retry, privacy and read-only endpoint passed.');
