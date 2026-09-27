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
  _dispatchUid:null,_dispatchPending:null,_dispatchTab:'',_dispatchFilter:'',_dispatchSelected:'',_rankEpoch:0,_rankTab:'',_rankPage:0,_codexRaw:null,_codexAt:0,_codexGroup:'',
  _battleRequest:0,_pendingOpp:null,_practiceOpp:null,_battleFindOpts:null,_duelTarget:null,_battleMode:'',hangarUid:null,hangarTab:'',hangarInventory:false,
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
 assert.deepEqual(t.events.find(x=>x[0]==='gate'),['gate',true]);
 t.c.net.pull=async()=>({state:{owner:'new'},band:{},items:{},presets:[]});
 const retried=await t.c.afterLogin({loginId:'new'});
 assert.notEqual(retried,false);
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
console.log('Login UI passed: failed account pull keeps gate up, blocks background writes, and retry adopts new account once.');
