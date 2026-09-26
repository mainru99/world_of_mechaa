import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {battleView} from '../js/ui/battle.js';
import {computeStats,power} from '../js/stats.js';
import {MONSTER_TYPES} from '../data/balance.js';
const unit=type=>{const r={type,level:32,slots:{},fat:0};return {...r,stats:computeStats(r,[]),power:power(r,[])};};
const boss=Object.values(MONSTER_TYPES).find(t=>t.rarity==='BOSS').id;
for(const allies of [[unit('ignis')],[unit('ignis'),unit('ranger')]]){
 const html=battleView({allies,enemies:[unit(boss)],playerName:'<script>bad()</script>',playerMeta:'48승',enemyName:'A&B'});
 assert.equal((html.match(/data-unit=/g)||[]).length,allies.length+1);
 assert.ok(html.includes(`${allies.length}:1`));
 assert.ok(html.includes('A&amp;B'));assert.ok(!html.includes('<script>'));
 assert.ok(!html.includes('.webp'),'combat cards remain static PNG sprites');
 assert.ok(html.includes(Math.round(allies.reduce((n,u)=>n+u.power,0)).toLocaleString('ko-KR')));
}
const source=await readFile(new URL('../js/game.js',import.meta.url),'utf8');
function fn(name){const start=source.indexOf(`function ${name}(`),end=source.indexOf('\n}',start);return source.slice(source.slice(start-6,start)==='async '?start-6:start,end+2);}
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};}
function findSetup(){
 const result=deferred(),events=[],element={innerHTML:''};
 const c=vm.createContext({S:{},cur:'battle',_battleRequest:0,_battleMode:'arena',net:{state:{online:true,accountId:'a'},battleFind:async opts=>{events.push(['find',opts]);return result.promise;}},toBattle(){c.cur='battle';},$:()=>element,renderBattleHome:()=>events.push(['home']),sleep:async()=>{},toast:x=>events.push(['toast',x]),go:s=>events.push(['go',s]),setPending:(...a)=>{c._pendingOpp=a[0];events.push(['pending']);},showOpponent:()=>events.push(['show']),fmt:String,esc:String,HUNT_KO:{BOSS:'보스'},huntResetTxt:()=>''});
 vm.runInContext(fn('findMatch'),c);return {c,events,result};
}
for(const change of [c=>c.cur='hangar',c=>c._battleRequest++,c=>c.net.state.accountId='b',c=>c.S={}]){
 const t=findSetup(),run=t.c.findMatch();change(t.c);t.result.resolve({opponent:{type:'ignis'}});await run;
 assert.equal(t.events.filter(x=>x[0]==='show'||x[0]==='pending').length,0,'stale search ignored');
}
{
 const t=findSetup(),run=t.c.findMatch({mode:'duel',target:'TEST',pick:1});t.result.resolve({opponent:{type:'ignis'}});await run;
 assert.equal(t.c._battleMode,'duel');assert.equal(t.events.filter(x=>x[0]==='show').length,1);
}
{
 const t=findSetup(),run=t.c.findMatch({mode:'duel'});t.result.resolve({error:'target not found',target:'TEST'});await run;
 assert.ok(t.events.some(x=>x[0]==='toast'&&x[1].includes('TEST')));
 assert.equal(t.events.filter(x=>x[0]==='home').length,2,'failed match returns to editable form');
}
{
 const t=findSetup();t.c.net.state.online=false;await t.c.findMatch();assert.ok(!t.events.some(x=>x[0]==='find'));
}
for(const opp of [{mode:'duel',target:'TEST',pick:1},{mode:'hunt',tier:'BOSS'}]){
 let called;
 const c=vm.createContext({_pendingOpp:opp,findMatch:opts=>called=opts});vm.runInContext(fn('battleRetry'),c);c.battleRetry();
 assert.equal(called.mode,opp.mode);assert.equal(opp.mode==='duel'?called.target:called.tier,opp.mode==='duel'?'TEST':'BOSS');
}
function startSetup(){
 const result=deferred(),replay=deferred(),events=[];
 const c=vm.createContext({_pendingOpp:{mode:'duel'},_battleRequest:0,_battleFindOpts:{mode:'duel',target:'TEST'},_tactic:'none',S:{credits:1000},cur:'battle',net:{state:{online:true,accountId:'a'},battleStart:()=>result.promise},beginReplay(){},selRobot:()=>({type:'ignis'}),toast:x=>events.push(['toast',x]),findMatch:opts=>events.push(['find',opts]),setPending:()=>events.push(['pending']),applyServerBattle:()=>events.push(['reward']),renderAll:()=>events.push(['all']),renderWallet(){},makeUnit:(name,type)=>({name,type}),simulate:()=>[],renderArena:()=>events.push(['arena']),rarOf:()=> 'EP',playBattle:()=>replay.promise,renderResult:()=>events.push(['result']),_lastReward:{}});
 c.requestBattleStart=tactic=>c.net.battleStart(tactic);
 vm.runInContext(fn('playBattleForAccount'),c);
 vm.runInContext(fn('startBattle'),c);return {c,result,replay,events};
}
const response={nameP:'IGNIS',opponent:{type:'ranger',callsign:'TEST'},statP:{},statE:{},seed:1,cost:10,win:true};
for(const change of [c=>c.cur='hangar',c=>c._battleRequest++]){
 const t=startSetup(),run=t.c.startBattle();change(t.c);t.result.resolve(response);await run;
 assert.equal(t.events.filter(x=>x[0]==='reward').length,1);
 assert.ok(!t.events.some(x=>x[0]==='arena'||x[0]==='result'));
}
for(const phase of ['request','replay']){
 const t=startSetup(),run=t.c.startBattle();
 if(phase==='replay'){t.result.resolve(response);await Promise.resolve();await Promise.resolve();}
 t.c.net.state.accountId='b';t.result.resolve(response);t.replay.resolve('P');await run;
 assert.ok(!t.events.some(x=>x[0]==='reward'||x[0]==='result'),'old account response ignored');
}
{
 const t=startSetup(),run=t.c.startBattle();t.result.resolve(response);await Promise.resolve();await Promise.resolve();t.c.cur='hangar';t.replay.resolve(null);await run;
 assert.equal(t.events.filter(x=>x[0]==='reward').length,1);assert.ok(!t.events.some(x=>x[0]==='result'));
}
{
 const t=startSetup(),run=t.c.startBattle();t.result.resolve(response);t.replay.resolve('P');await run;
 assert.equal(t.events.filter(x=>x[0]==='reward').length,1);assert.equal(t.events.filter(x=>x[0]==='result').length,1);
}
{
 const t=startSetup(),run=t.c.startBattle();t.result.resolve({error:'expired'});await run;
 assert.equal(t.events.find(x=>x[0]==='find')[1].mode,'duel');assert.ok(!t.events.some(x=>x[0]==='reward'));
}
console.log('Battle UI passed: 1:1/2:1 rosters and power; static sprites; escaping; stale searches; failures/offline; mode-preserving retries; completed rewards; navigation and account isolation.');
{
 const result=deferred(),button={innerHTML:'전투 시작',isConnected:true,setAttribute(){},removeAttribute(){}};
 const c=vm.createContext({$:()=>button,net:{battleStart:()=>result.promise}});
 vm.runInContext(fn('requestBattleStart'),c);
 const run=c.requestBattleStart('none');assert.equal(button.disabled,true);assert.equal(button.textContent,'전투 준비 중…');
 result.resolve({error:'failed'});await run;assert.equal(button.disabled,false);assert.equal(button.innerHTML,'전투 시작');
 console.log('Battle request feedback passed: immediate loading; disabled launch; failure restores retry.');
}
