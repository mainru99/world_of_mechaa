import assert from 'node:assert/strict';
import {ROBOT_TYPES,CONST} from '../data/balance.js';
import {LINEAGE,LINEAGE_SIBS,lineageView} from '../js/lineage.js';
import {goalOk} from '../js/mastery.js';
import {graphLayout,graphView} from '../js/ui/development-graph.js';
import {developmentView,nextMastery,masteryReward} from '../js/ui/development-view.js';
import {developmentVisibility} from '../js/ui/development-visibility.js';
import {createDevelopmentManager} from '../js/ui/development-manager.js';
const snapshot=JSON.stringify([LINEAGE,LINEAGE_SIBS,ROBOT_TYPES]);
const L=graphLayout(),states=lineageView(['mule']);
assert.equal(Object.keys(L.pos).length,76);
assert.equal(new Set(L.cols.flat()).size,76);
const graph=graphView({states,selected:'atlas',goal:'bastion',need:r=>CONST.SHARD_NEED[r],match:()=>true});
assert.equal((graph.match(/class="dg-edge /g)||[]).length,LINEAGE.length+LINEAGE_SIBS.length);
for(const [a,b] of [...LINEAGE,...LINEAGE_SIBS])assert.ok(graph.includes(`data-from="${a}" data-to="${b}"`));
const robot={uid:'m',type:'mule',level:4,slots:{}};
assert.equal(nextMastery(robot),'다음 조각 Lv.5 · +1');
assert.equal(nextMastery({...robot,level:59}),'다음 조각 Lv.60 · +3');
assert.equal(nextMastery({...robot,level:60}),'숙련 성장 완료');
function view(type){return developmentView({state:{robots:[robot],items:{}},goal:'bastion',known:true,selected:type,online:true});}
assert.ok(view('rust').includes('id="dg-goal-submit" onclick="ROWAR.developmentGoal()" >'),'unowned C roots are eligible');
for(const type of ['mule','atlas','orbit','swift'])assert.match(view(type),/id="dg-goal-submit"[^>]*disabled/);
assert.ok(!view('atlas').includes(ROBOT_TYPES.atlas.name));
const publicView=view('mule');
for(const id of ['atlas','ignis','orbit']){assert.ok(!publicView.includes(`src="assets/${id}.png"`));assert.ok(!publicView.includes(ROBOT_TYPES[id].name));}
const revealed=developmentVisibility(['mule'],'mule','bastion');
assert.ok(revealed('mule')&&revealed('bastion'));assert.ok(!revealed('rust')&&!revealed('atlas'));
assert.ok(!developmentVisibility(['mule','dune'],'dune','bastion')('wraith'));
assert.ok(!developmentView({state:{robots:[robot],items:{}},goal:'bastion',selected:'mule',known:true,mode:'list',query:'ATLAS',online:true}).includes('dg-candidate'));
assert.ok(view('atlas').includes('기체 조립에도 위 계보의 보유 조건이 적용됩니다.'),'active lineage gate is explained');
assert.ok(!view('atlas').includes('현재 기체 조립은 조각 수량 기준'));
assert.equal(masteryReward({got:0}),'');
assert.ok(masteryReward({goal:'bastion',got:1,grants:[{type:'mule',from:4,to:5,n:1}]}).includes('조각 +1'));
assert.equal(JSON.stringify([LINEAGE,LINEAGE_SIBS,ROBOT_TYPES]),snapshot);
const defer=()=>{let resolve;return {p:new Promise(r=>resolve=r),resolve};};
function setup(){
 let state={robots:[{...robot}],items:{'shard:rust':3},credits:987},html='',calls=[],n=0;
 const doc={activeElement:{id:''},getElementById:()=>null,querySelectorAll:()=>[],querySelector:s=>s==='#modal[open] .dg-app'&&html.includes('dg-app')?{}:null};
 const net={state:{accountId:'A',online:true},growthState:async()=>{calls.push('GET');return {items:{...state.items},mastery:{goal:n?'bastion':'rust',got:0,grants:[]}};},setDevelopmentGoal:async type=>{calls.push(['POST',type]);n++;return {goal:type};}};
 const mgr=createDevelopmentManager({document:doc,state:()=>state,net,openModal:h=>html=h,commit:()=>calls.push('commit'),toast:m=>calls.push(['toast',m])});
 mgr.adopt({mastery:{goal:'rust'}});
 return {mgr,A:mgr.actions,net,calls,get state(){return state;},get html(){return html;},close:()=>html='',changeOwner:()=>state={robots:[],items:{},credits:0}};
}
for(const change of [null,'close','selection','account','owner']){
 const t=setup();await t.A.openDevelopment('mule');t.A.developmentSelect('bastion');t.calls.length=0;
 const post=defer();t.net.setDevelopmentGoal=async type=>{t.calls.push(['POST',type]);return post.p;};
 const task=t.A.developmentGoal();await Promise.resolve();await Promise.resolve();await Promise.resolve();
 await t.A.developmentGoal();assert.equal(t.calls.filter(c=>Array.isArray(c)&&c[0]==='POST').length,1);
 assert.equal(t.calls[0],'GET','old goal is settled BEFORE goal POST');
 if(change==='close')t.close();if(change==='selection')t.A.developmentSelect('rust');
 if(change==='account')t.net.state.accountId='B';if(change==='owner')t.changeOwner();
 post.resolve({goal:'bastion'});await task;
 assert.equal(t.state.credits,['owner'].includes(change)?0:987,'partial state read cannot rewind currency');
 if(change==='close')assert.equal(t.html,'','completion must not reopen a closed modal');
 if(['account','owner'].includes(change))assert.equal(t.calls.filter(c=>c==='GET').length,1,'old POST completion cannot pull/adopt new account');
 else assert.equal(t.calls.filter(c=>c==='GET').length,2,'POST is reconciled by authoritative state read');
 assert.equal(t.mgr.busy(),false);
}
{
 const t=setup();await t.A.openDevelopment('mule');t.A.developmentSelect('bastion');t.calls.length=0;t.net.growthState=async()=>null;
 await t.A.developmentGoal();assert.ok(!t.calls.some(c=>Array.isArray(c)&&c[0]==='POST'));assert.ok(t.html.includes('목표를 변경하지 않았습니다'));
}
{
 const t=setup();await t.A.openDevelopment('mule');t.A.developmentSelect('atlas');t.calls.length=0;await t.A.developmentGoal();assert.equal(t.calls.length,0,'locked target is read-only');
}
{
 const t=setup();await t.A.openDevelopment('mule');t.A.developmentSelect('bastion');const pre=defer();t.net.growthState=()=>pre.p;
 const p=t.A.developmentGoal();t.state.items['shard:rust']=99;
 pre.resolve({items:{},mastery:{goal:'rust',got:0}});await p;
 assert.equal(t.state.items['shard:rust'],99,'stale read cannot overwrite newer items');assert.ok(!t.calls.some(c=>Array.isArray(c)&&c[0]==='POST'));
}
{
 const t=setup();await t.A.openDevelopment('mule');t.A.developmentSelect('bastion');let reads=0;
 t.net.growthState=async()=>{reads++;return reads===1?{items:{'shard:rust':4},mastery:{goal:'rust',got:1}}:null;};
 t.net.setDevelopmentGoal=async()=>({goal:'bastion'});await t.A.developmentGoal();
 assert.ok(t.mgr.card().includes(ROBOT_TYPES.bastion.name),'confirmed goal persists when follow-up GET fails');
 assert.equal(t.state.items['shard:rust'],4,'previous target shards are retained');
}
{
 const t=setup(),p=defer(),target={};t.net.growthState=()=>p.p;
 const task=t.mgr.settleFor(target);t.net.state.accountId='B';p.resolve({items:{'shard:bastion':99},mastery:{goal:'bastion',got:99}});await task;
 assert.equal(t.state.items['shard:bastion'],undefined,'reward response cannot leak across accounts');
}
{
 const t=setup();await t.A.openDevelopment('mule');t.A.developmentSelect('bastion');let reads=0;
 t.net.growthState=async()=>++reads===1?{items:{'shard:rust':3},mastery:{goal:'rust',got:0}}:null;
 t.net.setDevelopmentGoal=async()=>({goal:'bastion',items:{'shard:rust':4},mastery:{goal:'bastion',got:0},settled:{goal:'rust',got:1}});
 await t.A.developmentGoal();assert.equal(t.state.items['shard:rust'],4,'atomic POST earnings survive a failed follow-up read');
 assert.equal(t.state.credits,987);assert.ok(t.html.includes(`${ROBOT_TYPES.rust.name} 조각 +1`));
}
{
 const t=setup();await t.A.openDevelopment('mule');t.A.developmentSelect('bastion');let reads=0;const post=defer();
 t.net.growthState=async()=>++reads===1?{items:{'shard:rust':3},mastery:{goal:'rust',got:0}}:null;t.net.setDevelopmentGoal=()=>post.p;
 const work=t.A.developmentGoal();await Promise.resolve();await Promise.resolve();await Promise.resolve();
 t.state.items['shard:rust']=99;post.resolve({goal:'bastion',items:{'shard:rust':4},mastery:{goal:'bastion'},settled:{goal:'rust',got:1}});await work;
 assert.equal(t.state.items['shard:rust'],99,'late goal response cannot rewind newer local inventory');
}
assert.equal(goalOk('rust',['mule']),true);
console.log(`Development UI passed: ${Object.keys(L.pos).length} units, ${LINEAGE.length} lineage + ${LINEAGE_SIBS.length} variant edges; shared rules immutable; C roots/all-parent/entry eligibility; mastery next/max; old-goal-first settlement; duplicate guards; closed modal/selection/account isolation; failed/stale reads; currency retained.`);
