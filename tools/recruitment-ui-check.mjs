import assert from 'node:assert/strict';
import {recruitmentPool,percentText} from '../js/ui/recruitment.js';
import {MONSTER_TYPES,ROBOT_TYPES} from '../data/balance.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
for(const currency of ['core','credit','rcore']){
  const pool=recruitmentPool(currency);
  near(pool.outcomes.reduce((n,x)=>n+x.percent,0),100);
  near(pool.robots.reduce((n,x)=>n+x.percent,0),pool.robotPercent);
  near(pool.parts.reduce((n,x)=>n+x.percent,0),pool.partPercent);
  for(const rarity of pool.rarities){
    near(pool.robots.filter(x=>x.rarity===rarity.k).reduce((n,x)=>n+x.percent,0),rarity.percent);
  }
  assert.ok(pool.robots.every(x=>!MONSTER_TYPES[x.id]));
}
near(recruitmentPool('core').rarities.find(x=>x.k==='EP').percent,.36);
near(recruitmentPool('credit').rarities.find(x=>x.k==='EP').percent,.056);
near(recruitmentPool('core').parts.find(x=>x.k==='SSR').percent,1.8);
near(recruitmentPool('credit').parts.find(x=>x.k==='SSR').percent,2.32);
// Future data may contain story-only units. A preview must not dilute per-unit rates.
const originalRates=recruitmentPool('core').robots.map(r=>[r.id,r.percent]);
ROBOT_TYPES.ui_story_fixture={...ROBOT_TYPES.ignis,id:'ui_story_fixture',story:true};
try{assert.deepEqual(recruitmentPool('core').robots.map(r=>[r.id,r.percent]),originalRates);}
finally{delete ROBOT_TYPES.ui_story_fixture;}
assert.equal(percentText(0),'0%');assert.equal(percentText(.056),'0.056%');
console.log('Recruitment probabilities passed: normalized pools; per-unit totals; unconditional part rates; monsters excluded.');

const source=await readFile(new URL('../js/game.js',import.meta.url),'utf8');
const start=source.indexOf('async function doPull(count){');
const handler=source.slice(start,source.indexOf('\nconst pull1',start));
function setup(){
  const events=[],classes=new Set(),animation={hidden:true};
  const stage={classList:{add:(...ks)=>ks.forEach(k=>classes.add(k)),remove:(...ks)=>ks.forEach(k=>classes.delete(k))},scrollIntoView(){}};
  let resolve;
  const pending=new Promise(r=>{resolve=r;});
  const ctx=vm.createContext({
    S:{credits:10000,cores:20,scrap:500,stat:{pulls:0}},gCur:'core',_gTab:'pull',cur:'gacha',_pullPending:null,
    PULL_CUR:{core:{cost:1,ko:'코어'},credit:{cost:500,ko:'크레딧'}},
    net:{state:{online:true,accountId:'sample'},pullServer:async(count,currency)=>{events.push(['request',count,currency]);return await pending;},cancelSync:()=>events.push(['sync'])},
    $:s=>s==='#stage'?stage:s==='.gv-animation'?animation:null,window:{matchMedia:()=>({matches:true})},performance:{now:()=>0},sleep:async()=>{},
    localStorage:{setItem:()=>events.push(['save'])},SAVE_KEY:'sample',
    applyPull:r=>events.push(['reward',r]),bestPrize:()=> 'SSR',
    renderWallet:()=>events.push(['wallet']),renderGacha:()=>events.push(['render']),renderAll:()=>events.push(['renderAll']),
    showReveal:r=>events.push(['reveal',r]),toast:x=>events.push(['toast',x]),
  });
  vm.runInContext(handler,ctx);
  return {ctx,events,classes,animation,resolve};
}
const response={results:[{kind:'part',part:{uid:'sample'}}],credits:10000,cores:19,scrap:500};
{
  const t=setup(),run=t.ctx.doPull(1);
  assert.equal(t.animation.hidden,false);assert.ok(t.classes.has('charging'));
  await t.ctx.doPull(10);assert.equal(t.events.filter(e=>e[0]==='request').length,1,'no second spend during animation');
  t.ctx.gCur='credit';t.resolve(response);await run;
  assert.deepEqual(t.events.find(e=>e[0]==='request'),['request',1,'core']);
  assert.equal(t.ctx.S.cores,19);assert.equal(t.ctx.S.stat.pulls,1);
  assert.equal(t.animation.hidden,true);assert.equal(t.ctx._pullPending,null);
  assert.equal(t.events.filter(e=>e[0]==='reveal').length,1);
}
{
  const t=setup(),run=t.ctx.doPull(10);t.ctx.cur='hangar';t.resolve(response);await run;
  assert.equal(t.events.filter(e=>e[0]==='reward').length,1,'retain completed reward after leaving');
  assert.equal(t.events.filter(e=>e[0]==='reveal').length,0,'no modal on another screen');
}
{
  const t=setup(),run=t.ctx.doPull(1);t.ctx.net.state.accountId='different';t.resolve(response);await run;
  assert.equal(t.events.filter(e=>e[0]==='reward').length,0,'old-account reward cannot alter new account');
  assert.equal(t.ctx.S.cores,20);assert.equal(t.animation.hidden,true);
}
for(const result of [null,{error:'not enough cores'}]){
  const t=setup(),run=t.ctx.doPull(1);t.resolve(result);await run;
  assert.equal(t.ctx.S.cores,20);assert.equal(t.ctx._pullPending,null);assert.equal(t.animation.hidden,true);
  assert.equal(t.classes.size,0);assert.equal(t.events.filter(e=>e[0]==='reward').length,0);
}
{
  const t=setup();t.ctx.S.cores=0;await t.ctx.doPull(1);assert.equal(t.events.filter(e=>e[0]==='request').length,0);
  t.ctx.S.cores=20;t.ctx.net.state.online=false;await t.ctx.doPull(1);assert.equal(t.events.filter(e=>e[0]==='request').length,0);
}
{
  const t=setup();t.ctx.net.pullServer=async()=>{throw Error('test disconnect');};
  await assert.rejects(t.ctx.doPull(1),/test disconnect/);assert.equal(t.animation.hidden,true);assert.equal(t.ctx._pullPending,null);
}
console.log('Recruitment actions passed: single request; currency capture; navigation rewards; account isolation; failure cleanup; insufficient funds/offline; thrown error cleanup.');

// Refined pulls capture their own balance/channel and retain authoritative rewards.
{
 const t=setup();let balance=3;
 t.ctx.development={balance:()=>balance,setBalance:v=>balance=v,busy:()=>false};
 t.ctx.PULL_CUR.rcore={cost:1,ko:'정제 코어'};t.ctx.gCur='rcore';
 const p=t.ctx.doPull(1);t.ctx.gCur='core';t.resolve({...response,rcores:2});await p;
 assert.equal(t.events.find(e=>e[0]==='request')[2],'rcore');assert.equal(balance,2);
}
{
 const t=setup();t.ctx.development={busy:()=>true};await t.ctx.doPull(1);
 assert.ok(!t.events.some(e=>e[0]==='request'),'refining and pulls cannot overlap');
}
for(const name of ['shopBuy','shopRefresh','shopAssemble']){
 const s=source.indexOf(`async function ${name}(`),end=source.indexOf('\n}',s)+2;let calls=0;
 const c=vm.createContext({_shopPending:false,_shop:{stock:[{i:0,price:1}],refresh:1},_shopOwner:'A',S:{credits:100,items:{},robots:[]},development:{busy:()=>true},net:{state:{online:true,accountId:'A'},shop:async()=>{calls++;return {error:'blocked'};}},bagView:()=>[{type:'ignis',ready:true}],$:()=>({querySelectorAll:()=>[]}),cur:'home',toast(){}});
 vm.runInContext(source.slice(s,end),c);await c[name](name==='shopAssemble'?'ignis':0);
 assert.equal(calls,0,'shop spending cannot overlap circuit/refining settlement');
}
