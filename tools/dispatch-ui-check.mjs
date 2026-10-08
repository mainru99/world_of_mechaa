import assert from 'node:assert/strict';
import {createAudio} from '../js/audio.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {CONST} from '../data/balance.js';
import {dispatchMissions,dispatchView,expeditionEstimate,expeditionProgress} from '../js/ui/dispatch.js';
import {huntWeekView} from '../js/rewards.js';
// Display-only juice layers (js/ui/growth-fx.js · battle-fx.js) are not under test here — inert stand-ins.
const FX_STUBS={growthFx:{enhance:()=>({ready:Promise.resolve(),strike:async()=>{},result(){},cancel(){}}),levelUp(){},wallet(){},rewardLines(){}},enhAnchor:()=>null,centerOf:()=>null,walletNow:()=>({}),createBattleFx:()=>null,createMotion:()=>null};

const now=Date.now(),weekly=huntWeekView(null,now);
const input={expeditionLevel:24,huntLevel:32,sortieCost:100,credits:10000,weekly};
const missions=dispatchMissions(input);
assert.deepEqual(missions.map(m=>m.key),[
 'exped:SHORT','exped:LONG','exped:DEEP','hunt:C','hunt:UC','hunt:R','hunt:UQ','hunt:EP','hunt:BOSS']);
for(const [tier,t] of Object.entries(CONST.EXPED)){
 const got=expeditionEstimate(tier,24);
 assert.equal(got.cr,Math.round(t.crH*t.h*24));
 assert.equal(got.sc,Math.round(t.scH*t.h*24));
}
assert.equal(missions.find(m=>m.key==='hunt:BOSS').cost,1200);
assert.equal(missions.find(m=>m.key==='hunt:BOSS').level,Math.min(CONST.MAXLV+(CONST.OPP_LV_OVER||0),62));
const capped=dispatchMissions({...input,credits:0,weekly:{resetAt:weekly.resetAt,tiers:{...weekly.tiers,UQ:{used:21,cap:21}}}});
assert.equal(capped.find(m=>m.key==='hunt:UQ').blocked,'이번 주 한도 소진');
assert.equal(capped.find(m=>m.key==='hunt:EP').blocked,'크레딧 부족');
assert.equal(expeditionProgress({tier:'SHORT',endsAt:now+3600000},now).percent,0);
assert.equal(expeditionProgress({tier:'SHORT',endsAt:now},now).done,true);

const props={missions,selected:'exped:SHORT',robot:{type:'ignis',level:24},robotPower:2523,inSquad:false,
 expedition:null,expeditionRobot:null,online:true,canSend:true,weeklyReset:'일요일 0시',now};
const html=dispatchView(props);
assert.match(html,/파견 시작/);assert.match(html,/9<\/span>/);assert.match(html,/단기 정찰/);
assert.match(html,/assets\/ignis\.png/);assert.doesNotMatch(html,/\.webp[^"']*ignis/);
assert.match(dispatchView({...props,online:false}),/서버 연결 필요/);
assert.match(dispatchView({...props,canSend:false}),/남길 기체가 필요합니다/);
assert.match(dispatchView({...props,expedition:{tier:'SHORT',uid:'one',level:24,endsAt:now-1}}),/보상 받기/);

const source=await readFile(new URL('../js/game.js',import.meta.url),'utf8');
function fn(name){const start=source.indexOf(`function ${name}(`),end=source.indexOf('\n}',start);assert.ok(start>=0&&end>=0,name);return source.slice(source.slice(start-6,start)==='async '?start-6:start,end+2);}
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};}
function setup(){
 const answer=deferred(),events=[],state={robots:[{uid:'one',level:32},{uid:'two',level:24}],squad:['one','two'],sel:0,credits:100,cores:1,scrap:10,expd:null};
 const c=vm.createContext({...FX_STUBS,audio:createAudio(),S:state,cur:'hunt',net:{state:{online:true,accountId:'A'},expedition:async (...args)=>{events.push(['request',...args]);return answer.promise;}},
  CONST:{EXPED:{SHORT:{ko:'단기 정찰',h:1}}},_dispatchPending:null,renderHunt:()=>events.push(['render']),closeModal:()=>events.push(['close']),
  commitLocal:()=>events.push(['commit']),renderAll:()=>events.push(['all']),renderWallet:()=>events.push(['wallet']),toast:x=>events.push(['toast',x]),
  ERR_KO:{},fmt:String,addPart:()=>events.push(['part']),_pendingOpp:null});
 for(const name of ['dispatchRequest','sendExped','claimExped'])vm.runInContext(fn(name),c);
 return {c,answer,events,state};
}
{
 const t=setup(),run=t.c.sendExped('SHORT','one');
 await t.c.sendExped('SHORT','one');
 assert.equal(t.events.filter(x=>x[0]==='request').length,1,'pending send is single-flight');
 t.answer.resolve({ok:true,endsAt:now+3600000});await run;
 assert.equal(t.state.expd.uid,'one');assert.deepEqual([...t.state.squad],['two']);assert.equal(t.state.sel,1);
}
{
 const t=setup(),run=t.c.sendExped('SHORT','one');t.c.net.state.accountId='B';t.answer.resolve({ok:true,endsAt:now+3600000});await run;
 assert.equal(t.state.expd,null,'response from prior account is ignored');
}
{
 const t=setup();t.state.expd={tier:'SHORT',uid:'one',level:32,endsAt:now-10};
 const run=t.c.claimExped();await t.c.claimExped();assert.equal(t.events.filter(x=>x[0]==='request').length,1);
 t.answer.resolve({ok:true,player:{credits:300,cores:2,scrap:50},reward:{cr:200,sc:40,core:1,part:null}});await run;
 assert.equal(t.state.expd,null);assert.equal(t.state.credits,300);assert.equal(t.events.filter(x=>x[0]==='commit').length,1);
}
console.log('Dispatch UI passed: 9 real missions; server-matched estimates; cap/cost; timer; static unit; offline/one-unit; single-flight send/claim; account isolation and rewards.');
