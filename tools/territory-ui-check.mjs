import assert from 'node:assert/strict';
import {createAudio} from '../js/audio.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {territoryResultView} from '../js/ui/territory.js';
import {commonMessage} from '../js/ui/common.js';
// Display-only juice layers (js/ui/growth-fx.js · battle-fx.js) are not under test here — inert stand-ins.
const FX_STUBS={growthFx:{enhance:()=>({ready:Promise.resolve(),strike:async()=>{},result(){},cancel(){}}),levelUp(){},wallet(){},rewardLines(){}},enhAnchor:()=>null,centerOf:()=>null,walletNow:()=>({}),createBattleFx:()=>null,createMotion:()=>null};
const source=await readFile(new URL('../js/game.js',import.meta.url),'utf8');
function fn(name){const start=source.indexOf(`function ${name}(`),end=source.indexOf('\n}',start);assert.ok(start>=0&&end>=0,name);return source.slice(source.slice(start-6,start)==='async '?start-6:start,end+2);}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
const response={ok:true,node:'n01',win:true,reward:{},player:{credits:101,cores:3,scrap:8}};
function setup(name){
 const d=deferred(),events=[],el={innerHTML:''};
 const c=vm.createContext({...FX_STUBS,audio:createAudio(),S:{credits:100},cur:'terr',_frontTab:'terr',_battleRequest:0,_territorySelected:'n01',
  net:{state:{online:true,accountId:'a'},territory:()=>d.promise},NODE_BY:{n01:{ko:'거점',terrain:'plain',minLv:5}},commonMessage,
  closeModal(){},setTerrain(){},toBattle:()=>{c.cur='battle';},$:()=>el,sleep:async()=>{},
  toast:x=>events.push(['toast',x]),ERR_KO:{},dur:String,fmt:String,commitLocal:()=>events.push(['save']),
  dropTerrCache:()=>events.push(['drop']),enterTerritory:()=>events.push(['map']),
  applyTerrAttack:()=>events.push(['reward']),renderWallet:()=>events.push(['wallet']),renderTerr:()=>events.push(['refresh']),
  playBreach:()=>events.push(['replay'])});
 vm.runInContext(fn(name),c);return {c,d,events,el};
}
for(const change of ['screen','return','account','state']){
 const t=setup('attackTerr'),run=t.c.attackTerr('n01');
 assert.ok(t.el.innerHTML.includes('role="status"'));
 if(change==='screen')t.c.cur='hangar';
 if(change==='return'){t.c._battleRequest++;t.c.cur='battle';}
 if(change==='account')t.c.net.state.accountId='b';
 if(change==='state')t.c.S={};
 t.d.resolve(response);await run;
 assert.equal(t.events.filter(x=>x[0]==='reward').length,['screen','return'].includes(change)?1:0);
 assert.ok(!t.events.some(x=>x[0]==='replay'),'an abandoned sortie never reopens replay');
}
{
 const t=setup('attackTerr'),run=t.c.attackTerr('n01');t.c.cur='hangar';t.d.resolve({error:'locked'});await run;
 assert.ok(!t.events.some(x=>x[0]==='map'||x[0]==='toast'),'late failure must not navigate away');
}
{
 const t=setup('attackTerr'),run=t.c.attackTerr('n01');t.d.resolve(response);await run;
 assert.equal(t.events.filter(x=>x[0]==='reward').length,1);assert.equal(t.events.filter(x=>x[0]==='replay').length,1);
}
{
 const t=setup('attackTerr'),run=t.c.attackTerr('n01');t.d.resolve({error:'locked'});await run;
 assert.equal(t.events.find(x=>x[0]==='toast')[1],'Lv.5 이상이어야 들어갈 수 있습니다');
 assert.ok(t.events.some(x=>x[0]==='map'),'active failures return to the selected map');
}
for(const change of ['screen','tab','account','state']){
 const t=setup('claimTerr'),run=t.c.claimTerr();
 if(change==='screen')t.c.cur='hangar';if(change==='tab')t.c._frontTab='front';
 if(change==='account')t.c.net.state.accountId='b';if(change==='state')t.c.S={credits:17};
 t.d.resolve({...response,nodes:1,cr:1,sc:0});await run;
 assert.equal(t.c.S.credits,change==='account'?100:change==='state'?17:101);
 assert.ok(!t.events.some(x=>x[0]==='refresh'),'income must not replace a different view');
}
{
 let live=true,rendered=0;const d=deferred();
 const c=vm.createContext({NODE_BY:{},replayBreach:()=>d.promise,renderBreachResult:()=>rendered++});
 vm.runInContext(fn('playBreach'),c);const run=c.playBreach(response,()=>live);live=false;d.resolve(true);await run;
 assert.equal(rendered,0,'an old account cannot show a result after the final replay wait');
}
for(const win of [true,false]){
 const html=territoryResultView({...response,win,mechs:[{type:'ignis',name:'<bad>',level:32}]},{ko:'A&B',terrain:'plain'},'<div>reward</div>');
 assert.ok(html.includes('A&amp;B')&&html.includes('&lt;bad&gt;'));
 assert.ok(html.includes("ROWAR.enterTerritory()")&&html.includes("ROWAR.prepareTerritory()"));
 assert.ok(html.includes('assets/ignis.png')&&!html.includes('ignis-idle'),'result sprites stay static');
}
console.log('Territory UI passed: authoritative rewards after navigation; account isolation; late failure/income guards; replay boundary cancellation; selected-map return and static result sprites.');
