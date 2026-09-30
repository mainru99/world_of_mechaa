import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../js/game.js',import.meta.url),'utf8');
function fn(name){
 const start=source.indexOf(`function ${name}(`),end=source.indexOf('\n}',start);
 assert.ok(start>=0&&end>=0,name);
 return source.slice(source.slice(start-6,start)==='async '?start-6:start,end+2);
}
function setup(pull){
 const old={owner:'old'},events=[];
 const c=vm.createContext({S:old,cur:'home',net:{state:{loginId:'new',accountId:'new',online:true,guest:false},pull,cancelSync:()=>events.push(['cancel'])},
  frontAfterState:()=>events.push(['frontState']),stopScript:()=>events.push(['stopStory']),_frontIntroAttempted:new Set(['old:intro']),
  _frontReady:true,_jform:{order:['old-unit'],tac:{}},_jctx:()=>{},_fight:{old:true},
  _dispatchUid:null,_dispatchPending:null,_dispatchTab:'',_dispatchFilter:'',_dispatchSelected:'',_rankEpoch:0,_rankTab:'',_rankPage:0,_codexRaw:null,_codexAt:0,_codexGroup:'',
  _battleRequest:0,_pendingOpp:null,_practiceOpp:null,_battleFindOpts:null,_duelTarget:null,_battleMode:'',hangarUid:null,hangarTab:'',hangarInventory:false,
  invF:{slot:'WEAPON',rar:'SSR',fresh:'1',sort:'enh',page:9,query:'old account'},
  _terrRequest:0,_territorySelected:'',_territoryFilter:'',_returnToTerritory:false,_territoryViewport:{},_gateNeedsPull:false,
  dropTerrCache:()=>events.push(['terr']),dropRankCache:()=>events.push(['rank']),normalize:x=>x,takeBand:()=>{},parsePresets:x=>x,save:()=>events.push(['save']),
  renderAcct:()=>events.push(['acct']),renderGate:()=>events.push(['renderGate']),renderAll:()=>events.push(['all']),toast:x=>events.push(['toast',x]),
  setGateVisible:open=>events.push(['gate',open])});
 vm.runInContext(fn('afterLogin'),c);
 return {c,events,old};
}
{
 const t=setup(async()=>null),ok=await t.c.afterLogin({loginId:'new'});
 assert.equal(ok,false);
 assert.equal(t.c.S,t.old,'failed download must not adopt or save old account as new');
 assert.equal(t.events.some(x=>x[0]==='save'),false);
 assert.equal(t.events.some(x=>x[0]==='all'),false);
 assert.equal(t.c._gateNeedsPull,true);
 assert.equal(t.events[0][0],'stopStory','account changes stop the previous account story');
 assert.equal(t.c._frontIntroAttempted.size,0);
 assert.equal(t.c._frontReady,false);assert.equal(t.c._jctx,null);assert.equal(t.c._fight,null);assert.equal(t.c._jform.order.length,0);
 assert.equal(t.c.invF.query,'');assert.equal(t.c.invF.page,0);assert.equal(t.c.invF.slot,'');assert.equal(t.c.invF.rar,'');assert.equal(t.c.invF.sort,'new','account change resets inventory browsing');
 assert.deepEqual(t.events.find(x=>x[0]==='gate'),['gate',true]);
 t.c.net.pull=async()=>({state:{owner:'new'},band:{},items:{},presets:[]});
 const retried=await t.c.afterLogin({loginId:'new'});
 assert.equal(retried,true,'successful account adoption must open the gate');
 assert.equal(t.c.S.owner,'new');
 assert.equal(t.c._gateNeedsPull,false);
 assert.equal(t.events.filter(x=>x[0]==='save').length,1);
 assert.equal(t.events.filter(x=>x[0]==='all').length,1);
}
{
 const writes=[],c=vm.createContext({S:{owner:'old'},_gateNeedsPull:true,SAVE_KEY:'save',localStorage:{setItem:(...x)=>writes.push(x)},net:{scheduleSync:()=>writes.push('sync')}});
 vm.runInContext(fn('save'),c);
 c.save();assert.equal(writes.length,0,'background saves must be blocked while the new account is not loaded');
 c._gateNeedsPull=false;c.save();assert.equal(writes.length,2);
}
for(const downloaded of [true,false]){
 const t=setup(async()=>downloaded?{state:{owner:'new'},items:{},presets:[]}:null),nodes=new Map();
 t.c.$=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='#gate-id'?'new':id==='#gate-pw'?'test-only-password':'',hidden:true,addEventListener(k,h){this[k]=h;},setAttribute(){},focus(){}});return nodes.get(id);};
 t.c._gateAuthPending=false;t.c.openGate=()=>{};t.c.accountScreen=()=>{};t.c.net.login=async()=>({loginId:'new'});
 vm.runInContext(fn('initGate'),t.c);t.c.initGate();t.events.length=0;
 await nodes.get('#gate-login').submit({preventDefault(){}});
 assert.equal(t.events.some(x=>x[0]==='gate'&&x[1]===false),downloaded,'real submit only opens after successful state adoption');
 assert.equal(nodes.get('#gate-in').disabled,false);assert.equal(t.c._gateAuthPending,false);
}
console.log('Login UI passed: direct form opens after successful adoption; failed pull keeps gate up, blocks writes, and allows retry.');
