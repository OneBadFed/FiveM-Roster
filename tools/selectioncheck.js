const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync('ControlPanel.html','utf8');
const members=[{row:8,filled:true,discord:'111'},{row:9,filled:true,discord:'222'},{row:10,filled:false}];
const boxes=[8,8,9].map(row=>({dataset:{sel:String(row)},checked:false}));
const bar={hidden:true,innerHTML:''}, handlers={};
const list={addEventListener:(event,fn)=>handlers[event]=fn};
let subtitles=0;
const ctx={STATE:{members,selected:{},statuses:['Active','Inactive'],openRow:8},
  memberByRow:r=>members.find(m=>m.row===Number(r)),document:{querySelectorAll:()=>boxes},
  $:id=>id==='bulkbar'?bar:list,tbSub:()=>subtitles++,esc:x=>x};
vm.createContext(ctx);
vm.runInContext(html.slice(html.indexOf('  function renderBulk(){'),html.indexOf('  function filtered(){')),ctx);
const start=html.indexOf("  $('mlist').addEventListener('click',function(e){");
const end=html.indexOf("  document.querySelectorAll('.runbtn[data-act]')",start);
vm.runInContext(html.slice(start,end),ctx);
const event=box=>({target:Object.assign(box,{matches:()=>true,closest:selector=>selector==='[data-sel]'?box:null})});
boxes[0].checked=true;handlers.click(event(boxes[0]));handlers.change(event(boxes[0]));
assert.equal(ctx.STATE.selected[8],true);assert.equal(boxes[1].checked,true,'profile checkbox synchronized');assert(bar.innerHTML.includes('1 selected'));
boxes[2].checked=true;handlers.change(event(boxes[2]));assert(bar.innerHTML.includes('2 selected'));
boxes[1].checked=false;handlers.change(event(boxes[1]));assert.equal(boxes[0].checked,false);assert.equal(ctx.STATE.selected[8],undefined);assert(bar.innerHTML.includes('1 selected'));
boxes[2].checked=false;handlers.change(event(boxes[2]));assert.equal(bar.hidden,true);assert.equal(bar.innerHTML,'');
ctx.setMemberSelected(10,true);ctx.setMemberSelected(999,true);assert.equal(Object.keys(ctx.STATE.selected).length,0,'empty/stale rows ignored');
assert.equal(ctx.STATE.openRow,8,'checkbox clicks do not change profile expansion');assert(subtitles>=4);
assert(/\.mcheck:checked\{background:#0a84ff url\(/.test(html),'valid blue background + tick image');
console.log('Member selection: list/profile synchronization, multi-select, unchecking, counts, empty rows and profile isolation passed.');
