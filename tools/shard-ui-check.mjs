import assert from 'node:assert/strict';
import {CONST,ROBOT_TYPES,MONSTER_TYPES} from '../data/balance.js';
import {salvView,runSalvage} from '../js/salvage.js';
import {computeStats} from '../js/stats.js';
import {synthOutcomes,synthView,salvageView,salvageResultView} from '../js/ui/shard-view.js';
import {createShardManager} from '../js/ui/shard-manager.js';
const robot={uid:'first',type:'mule',level:60,fat:0,slots:{},circuit:['A1']};
const state=()=>({robots:[{...robot},{...robot,uid:'second',type:'ignis',level:12}],parts:[],items:{'shard:mule':4,'shard:dune':6,'shard:ignis':2},scrap:1000,credits:22,cores:11});
const original=JSON.stringify([CONST,ROBOT_TYPES,MONSTER_TYPES]);
for(const n of [6,10]){
 const o=synthOutcomes('UQ',n,'ignis');assert.equal(o[1].rarity,'EP');assert.equal(o[2].rarity,'EP');assert.equal(o[2].prob,.01);assert.ok(o[1].target==='ignis'&&o[2].target==='ignis');
 assert.ok(Math.abs(o.reduce((n,x)=>n+x.prob,0)-1)<1e-9);assert.equal(o[1].qty,Math.round(n/3));assert.equal(o[2].qty,Math.round(n/5));
}
assert.equal(synthOutcomes('C',6,'bastion')[1].prob,.25);assert.equal(synthOutcomes('C',10,'bastion')[1].prob,.53);
assert.ok(!synthView({state:state(),rar:'C',online:true}).includes('sr-rar-EP'));
const record={...salvView(null,Date.now(),60),goal:{type:'bastion',have:4,need:15}};
assert.ok(salvageView({state:state(),record,uid:'second',masteryGoal:'seraph',known:true,online:true}).includes('숙련 개발 목표는 SERAPH'));
assert.ok(salvageView({state:state(),record,uid:'second',known:true,online:true}).includes('Lv.12 · 내구 / 공격'));
assert.match(salvageView({state:state(),record:{...record,left:0},uid:'first',known:true,online:true}),/id="sr-salvage-review"[^>]*disabled/);
const defer=()=>{let resolve;return {p:new Promise(r=>resolve=r),resolve};};
function setup(){
 let owner=state(),html='',goal='bastion',count=0;
 const calls=[],doc={activeElement:{id:''},getElementById:()=>null,querySelector:s=>s==='#modal[open] .sr-app'&&html.includes('sr-app')?{}:null};
 const net={state:{online:true,accountId:'A'},growthState:async()=>{calls.push('STATE');return {state:{...owner},items:{...owner.items},mastery:{goal},rcores:0};},salvage:async body=>{calls.push(body?['SALVAGE',body]:'RECORD');if(!body)return record;return {ok:true,robot:owner.robots[0],stats:computeStats(owner.robots[0],[]),parts:[],foe:record.tiers[body.tier],seed:45,win:false,got:0,left:1,goal:record.goal};},synthesize:async mats=>{calls.push(['SYNTH',mats]);count++;return {items:{'shard:ignis':9},credits:25,cores:13,scrap:880,synth:{type:'ignis',qty:9,grade:'master',rarity:'EP',goal:false,from:'C',used:6,spent:120}};}};
 const mgr=createShardManager({document:doc,state:()=>owner,robot:()=>owner.robots[0],net,goal:()=>({goal}),onRemote:r=>goal=r.mastery.goal,openModal:h=>html=h,closeModal:()=>html='',commit:()=>calls.push('commit'),paint(){},toast:m=>calls.push(['toast',m]),returnTo:()=> 'hunt',applyShop:r=>Object.assign(owner,{items:r.items,credits:r.credits,cores:r.cores,scrap:r.scrap}),replay:async(...args)=>calls.push(['REPLAY',...args])});
 return {A:mgr.actions,mgr,net,calls,get state(){return owner;},get html(){return html;},close:()=>html='',ownerChange:()=>owner=state()};
}
async function prepareSynth(t){await t.A.openShardSynth();t.A.shardCount('mule',4);t.A.shardCount('dune',2);t.A.shardReview();}
{
 const t=setup();await t.A.openShardSynth();t.A.shardCount('mule','1.5');t.A.shardCount('mule','');assert.ok(t.html.includes('정수로 선택'));
 t.A.shardCount('mule',4);t.A.shardCount('dune',6);t.A.shardCount('dune',7);assert.ok(t.html.includes('10 / 10'));t.A.shardReview();assert.ok(t.html.includes('되돌릴 수 없습니다'));await t.A.shardSubmit();
 assert.deepEqual(t.state.items,{'shard:ignis':9},'server items and quantity, not a local roll');assert.equal(t.state.scrap,880);assert.ok(t.html.includes('조각 ×9'));assert.equal(t.mgr.busy(),false);
}
for(const change of [null,'close','account','owner']){
 const t=setup();await prepareSynth(t);const d=defer();t.net.synthesize=mats=>{t.calls.push(['SYNTH',mats]);return d.p;};const p=t.A.shardSubmit();await t.A.shardSubmit();assert.equal(t.calls.filter(c=>Array.isArray(c)&&c[0]==='SYNTH').length,1);
 if(change==='close')t.close();if(change==='account')t.net.state.accountId='B';if(change==='owner')t.ownerChange();
 d.resolve({items:{'shard:ignis':9},credits:25,cores:13,scrap:880,synth:{type:'ignis',qty:9,grade:'master',rarity:'EP',from:'C',used:6,spent:120}});await p;
 if(['account','owner'].includes(change))assert.equal(t.state.scrap,1000);else assert.equal(t.state.scrap,880);
 if(change==='close')assert.equal(t.html,'');assert.equal(t.mgr.busy(),false);
}
{
 const t=setup();await prepareSynth(t);t.net.synthesize=async()=>null;t.net.growthState=async()=>null;await t.A.shardSubmit();assert.equal(t.state.scrap,1000);assert.ok(t.html.includes('확인하지 못했습니다'));t.A.shardReview();assert.ok(!t.html.includes('sr-synth-submit'));
}
for(const change of [null,'close','account','owner']){
 const t=setup();await t.A.openSalvage();t.A.salvageTier(2);t.A.salvageReview();const d=defer();let posts=0;
 t.net.salvage=async body=>{if(!body)return record;posts++;return d.p;};
 const p=t.A.salvageSubmit();await Promise.resolve();await Promise.resolve();await t.A.salvageSubmit();assert.equal(posts,1);
 if(change==='close')t.close();if(change==='account')t.net.state.accountId='B';if(change==='owner')t.ownerChange();
 const stats=computeStats(t.state.robots[0],[]),out=runSalvage(stats,record.tiers[2],45);
 d.resolve({ok:true,robot:t.state.robots[0],stats,parts:[],foe:record.tiers[2],seed:45,win:out.win,got:3,left:1,goal:{type:'bastion',have:7,need:15}});await p;
 assert.equal(t.calls.filter(c=>Array.isArray(c)&&c[0]==='REPLAY').length,change?0:1);assert.equal(t.state.credits,22);assert.equal(t.state.items['shard:bastion'],undefined,'POST goal count is never copied into inventory');assert.equal(t.mgr.busy(),false);
}
{
 const t=setup();await t.A.openSalvage();t.A.salvageReview();t.net.salvage=async()=>({...record,goal:{type:'dune',have:6,need:10}});await t.A.salvageSubmit();assert.ok(t.html.includes('출격 조건이 바뀌었거나'));assert.equal(t.calls.filter(c=>Array.isArray(c)&&c[0]==='SALVAGE').length,0);
}
{
 const t=setup();await t.A.openSalvage();t.A.salvageReview();const d=defer();t.net.salvage=body=>body?d.p:Promise.resolve(record);
 const p=t.A.salvageSubmit();await Promise.resolve();await Promise.resolve();t.net.growthState=async()=>null;
 d.resolve({ok:true,robot:robot,stats:computeStats(robot,[]),parts:[],foe:record.tiers[0],seed:45,win:false,got:0,left:1,goal:record.goal});await p;
 const replay=t.calls.find(c=>Array.isArray(c)&&c[0]==='REPLAY');assert.equal(replay.at(-1),false,'failed inventory read is disclosed without losing confirmed battle result');
}
assert.ok(salvageResultView({win:false,got:0,left:0,goal:record.goal,foe:record.tiers[0]},'gacha',false).includes('보관함으로 돌아가기'));
assert.equal(JSON.stringify([CONST,ROBOT_TYPES,MONSTER_TYPES]),original);
const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))};
const net=await import('../js/net.js');net.state.online=true;net.state.accountId='A';
for(const method of ['synthesize','salvage']){
 const d=defer();globalThis.fetch=()=>d.p;net.state.accountId='A';const p=net[method]({});net.state.accountId='B';d.resolve({ok:true,status:200,json:async()=>({ok:true,rev:999})});assert.equal((await p).error,'account changed');assert.equal(store.get('rowar.rev'),undefined);
}
console.log('Shard UI passed: odds/quantities including UQ clamp; mixed material caps and integer validation; irreversible review; server-only rewards; duplicate/account/owner/closed-dialog guards; no guessed inventory; salvage preflight/failed read/replay isolation; account-safe transports.');
