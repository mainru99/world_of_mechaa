/* Actual UI adapters: integration must keep authoritative rewards and cancellation. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {ROBOT_TYPES,MONSTER_TYPES,CONST} from '../data/balance.js';
import {frontView,readProgress} from '../js/front.js';
const source=await readFile(new URL('../js/game.js',import.meta.url),'utf8');
function fn(name){const start=source.indexOf(`function ${name}(`),end=source.indexOf('\n}',start);assert.ok(start>=0&&end>=0,name);return source.slice(source.slice(start-6,start)==='async '?start-6:start,end+2);}
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
const flush=()=>new Promise(r=>setImmediate(r));
const response={ok:true,cost:10,team:[],boss:{type:'boss_nihil',callsign:'BOSS',stats:{},traits:[]},seed:1,win:false};
function setup(){
 const post=deferred(),replay=deferred(),events=[];
 const c=vm.createContext({S:{credits:100},cur:'battle',_battleRequest:0,_lastReward:{},net:{state:{accountId:'A'}},
  requestBattleStart:(t,opts)=>{events.push(['request',opts]);return post.promise;},jointReq:()=>({order:['b','a'],tactics:{b:'atk',a:'def'}}),
  setPending(){},renderWallet(){},applyJointBattle:()=>events.push(['settle']),renderAll:()=>events.push(['refresh']),
  runJoint:()=>({events:[],team:[],boss:{}}),renderJointArena:()=>events.push(['arena']),bossEntrance:async()=>{},
  playJoint:()=>replay.promise,fightJoint:()=>({}),renderResult:()=>events.push(['result']),
  toast:()=>events.push(['toast']),hunt:()=>events.push(['retry'])});
 vm.runInContext(fn('startJointBattle'),c);return {c,post,replay,events};
}
for(const phase of ['post','replay'])for(const change of ['screen','return','account','state']){
 const t=setup(),p=t.c.startJointBattle({tier:'BOSS'});
 if(phase==='replay'){t.post.resolve(response);await flush();}
 if(change==='screen')t.c.cur='hangar';
 if(change==='return')t.c._battleRequest++;
 if(change==='account')t.c.net.state.accountId='B';
 if(change==='state')t.c.S={credits:999};
 t.post.resolve(response);t.replay.resolve('E');await p;
 assert.equal(t.events.filter(e=>e[0]==='settle').length,['screen','return'].includes(change)?1:0);
 assert.ok(!t.events.some(e=>e[0]==='result'),'abandoned replay cannot open a result');
 if(phase==='post')assert.ok(!t.events.some(e=>e[0]==='arena'));
}
{
 const t=setup(),p=t.c.startJointBattle({tier:'BOSS'});t.post.resolve(response);t.replay.resolve('E');await p;
 assert.equal(t.events.filter(e=>e[0]==='settle').length,1);assert.equal(t.events.filter(e=>e[0]==='result').length,1);
 assert.deepEqual(t.events[0][1].order,['b','a'],'selected joint order reaches the server');
}
{
 const t=setup(),p=t.c.startJointBattle({tier:'BOSS'});t.c.cur='hangar';t.post.resolve({error:'expired'});await p;
 assert.ok(!t.events.some(e=>e[0]==='retry'||e[0]==='toast'),'late rejection does not navigate or toast');
}
{
 const arena={isConnected:true},c=vm.createContext({document:{getElementById:()=>arena},cur:'battle'});
 vm.runInContext(fn('playJoint'),c);assert.equal(await c.playJoint([],[],{},()=>false),null,'joint playback checks cancellation before drawing');
}
// Relay rewards update by UID, independently of the selected/inspected unit.
{
 const a={uid:'a',type:'ignis'},b={uid:'b',type:'ranger'};
 const c=vm.createContext({S:{credits:0,stat:{},robots:[b,a]},ROBOT_TYPES,localStorage:{setItem(){}},SAVE_KEY:'qa',net:{cancelSync(){}},renderWallet(){},dropRankCache(){},takeBand(){},addPart(){}});
 vm.runInContext('let _lastReward=null;'+fn('applyServerBattle'),c);
 c.applyServerBattle({player:{credits:90,cores:2,scrap:3,wins:1,losses:1},robot:{level:32,exp:5,fat:4,fatAt:1},reward:{lv:{amt:6},fat:{add:4}},relay:{robot2:{uid:'b',level:31,exp:7,fat:5,fatAt:1,lv:{amt:4},fatGain:{add:5}}}},a);
 assert.equal(b.exp,7);assert.equal(a.exp,5);assert.equal(vm.runInContext('_lastReward.robots.length',c),2);
}
// Completed server progress suppresses login opening; explicit story replay remains available.
{
 const seen=new Set(),events=[],c=vm.createContext({S:{stat:{wins:0,losses:0}},cur:'terr',frontProg:()=>readProgress('10000000000'),myMaxLv:()=>1,frontView,
  markSeen:(id,when)=>seen.add(id+':'+when),document:{body:{classList:{contains:()=>true}}},go:s=>events.push(s),renderTerrHome(){}});
 vm.runInContext('let _frontReady=false,_frontCh="old",_frontCell="old";const playedAccount=()=>frontProg().some(v=>v>0);'+fn('frontAfterState'),c);
 c.frontAfterState();assert.ok(seen.has('ch1:open'));assert.deepEqual(events,['home']);assert.equal(vm.runInContext('_frontCell',c),null);
}
// Match preparation retains the server's bench without fabricating its stats.
{
 const c=vm.createContext({});vm.runInContext('let _pendingOpp=null;'+fn('setPending'),c);
 c.setPending({type:'mule',bench:[{type:'dune',level:40,name:'DUNE'}]},1,false,null,'arena');
 assert.equal(vm.runInContext('_pendingOpp.bench[0].type',c),'dune');
}
assert.equal(CONST.PART_BIND.on,true,'approved release enables binding');
assert.ok(Object.values(ROBOT_TYPES).filter(t=>!t.story).length>=76);
assert.ok(MONSTER_TYPES.boss_nihil);
// Delayed analysis belongs to the exact result element and account that scheduled it.
for(const stale of ['element','account','state','request',null]){
 let timer,drawn=0;
 const old={isConnected:true,remove(){},set outerHTML(v){drawn++;}};let current=old;
 const c=vm.createContext({_fight:{kind:'1v1',spec:{}},S:{},net:{state:{accountId:'a'}},_battleRequest:1,$:()=>current,setTimeout:cb=>timer=cb,insight1:()=>({lines:[]}),esc:String});
 vm.runInContext(fn('fillAnalysis'),c);c.fillAnalysis();
 if(stale==='element')current={isConnected:true};if(stale==='account')c.net.state.accountId='b';if(stale==='state')c.S={};if(stale==='request')c._battleRequest++;
 timer();assert.equal(drawn,stale?0:1);
}
console.log('Merged combat UI passed: joint order; navigation/account cancellation; exactly-once rewards; UID relay settlement; server-progress entry; retained opponent bench; approved binding policy retained.');
