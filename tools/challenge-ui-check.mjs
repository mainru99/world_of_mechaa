import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {trialChallengeView,raidChallengeView,challengeMessage} from '../js/ui/challenge.js';
import {trialOf,weekOf,weekEnd,TRIAL_WIN_BASE} from '../js/trial.js';
import {raidOf} from '../js/raid.js';
import {MONSTER_TYPES} from '../data/balance.js';
const week=weekOf(Date.now()),rules=raidOf(week);
const trial={week,trial:trialOf(week),endsAt:weekEnd(week),winBase:TRIAL_WIN_BASE,top:[],total:0,me:null};
const raid={...rules,name:MONSTER_TYPES[rules.boss].name,endsAt:weekEnd(week),left:rules.maxHp,daily:3,triesLeft:3,top:[],joined:0};
const robot={uid:'a',type:'ignis',level:32};
assert.ok(trialChallengeView(trial,{robot,power:6000}).includes('기록 없음'));
for(const html of [trialChallengeView({...trial,top:[{rank:1,nickname:'<img src=x onerror=bad()>',score:50}]},{robot,power:6000}),raidChallengeView({...raid,killed:true,killer:'<script>bad()</script>',triesLeft:0},{team:[{...robot,power:6000}]})]){
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));
 assert.ok(!html.includes('ignis-idle'),'challenge sprites remain still PNGs');
}
for(const r of [{...raid,triesLeft:0},{...raid,killed:true}])assert.match(raidChallengeView(r,{team:[robot]}),/class="btn gold" disabled/);
assert.match(trialChallengeView(trial,{robot,power:0,pending:true}),/disabled[^>]*>기록 처리 중/);
assert.ok(challengeMessage('raid','연결 오류','<error>',{retry:true}).includes('&lt;error&gt;'));

// Exercise the actual game adapter, including responses that finish after leaving.
const source=await readFile(new URL('../js/game.js',import.meta.url),'utf8');
const section=source.slice(source.indexOf('let _trial=null, _trialAt=0,'),source.indexOf('/* 랭킹 화면은 두 갈래다'));
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function setup(){
 const get=deferred(),post=deferred(),replay=deferred(),events=[],el={innerHTML:''};
 const c=vm.createContext({Date,_battleRequest:0,S:{robots:[robot,{uid:'b',type:'ranger',level:30}],squad:['a','b'],sel:0,credits:10,scrap:20},cur:'trial',net:{state:{online:true,accountId:'A'},trial:run=>{events.push(run?'trial-post':'trial-get');return run?post.promise:get.promise;},raid:run=>{events.push(run?'raid-post':'raid-get');return run?post.promise:get.promise;}},$:()=>el,setTerrain(){},challengeMessage:(m,t)=>`${m}:${t}`,trialChallengeView:(r,o)=>`trial:${o.robot.type}:${o.pending}`,raidChallengeView:(r,o)=>`raid:${o.team.length}:${o.pending}`,power:()=>6000,selRobot(){return c.S.robots[c.S.sel];},toast:t=>events.push(['toast',t]),commitLocal:()=>events.push('wallet'),renderWallet(){},weekEnd,TRIAL_WIN_BASE,runTrial:()=>({mine:{},foe:{},ev:[]}),MONSTER_TYPES,ROBOT_TYPES:{ignis:{name:'IGNIS'},ranger:{name:'RANGER'}},TERRAIN:{},renderArena(){c.cur='battle';events.push('arena');},arenaGone:()=>c.cur!=='battle',makeUnit:()=>({}),beginReplay(){},playBattle:()=>replay.promise,runRaid:()=>({rounds:[{mi:0,events:[]},{mi:1,events:[]}]}),bossEntrance:async()=>{},sleep:async()=>{},battleSpeed:1,blog(){},shield(){},toBattle(){c.cur='battle';},esc:String,fmt:String});
 vm.runInContext(section,c);
 c.renderTrialResult=()=>events.push('trial-result');c.renderRaidResult=()=>events.push('raid-result');
 return {c,get,post,replay,events,el,eval:s=>vm.runInContext(s,c)};
}
for(const mode of ['trial','raid'])for(const change of [t=>t.c.cur='hangar',t=>t.eval('++_challengeEpoch'),t=>t.c.net.state.accountId='B',t=>t.c.S={...t.c.S},t=>t.eval(`_trialTab='${mode==='raid'?'trial':'raid'}'`)]){
 const t=setup();t.eval(`_trialTab='${mode}'`);const p=t.c.renderTrial(),loading=t.el.innerHTML;change(t);t.get.resolve(mode==='raid'?raid:trial);await p;assert.equal(t.el.innerHTML,loading,'late GET cannot replace screen');
}
{
 const t=setup();const p=t.c.renderTrial();t.get.resolve(trial);await p;assert.equal(t.el.innerHTML,'trial:ignis:false');
 t.c.S.sel=1;t.c.S.squad=['a'];t.c.drawTrial(trial);assert.equal(t.el.innerHTML,'trial:ignis:false','preview matches server squad fallback');
 t.eval("_trialTab='raid'");t.c.S.squad=['a','b'];assert.equal(t.c.raidTeam()[0].type,'ranger','selected squad unit leads');
 t.c.net.state.accountId='B';t.c.renderTrial();assert.ok(t.events.filter(x=>x==='raid-get').length);
}
const trialPost={...trial,score:100,win:false,robot,stats:{},me:{score:100,rank:9}};
const raidPost={...raid,damage:100,raw:100,credits:45,scrap:50,reward:{cr:35,sc:30},me:{damage:100},mechs:[{type:'ignis',stats:{}},{type:'ranger',stats:{}}],foe:{type:rules.boss,stats:{}},seeds:[]};
for(const mode of ['trial','raid']){
 const t=setup();t.eval(`_trialTab='${mode}'`);
 const p=t.c[`${mode}RunGo`]();await t.c[`${mode}RunGo`]();assert.equal(t.events.filter(x=>x===`${mode}-post`).length,1,'pending POST blocks repeats');
 t.c.cur='hangar';t.post.resolve(mode==='raid'?raidPost:trialPost);await p;
 assert.ok(!t.events.includes('arena'),'completed action cannot reopen playback after navigation');
 if(mode==='raid'){assert.equal(t.c.S.credits,45);assert.ok(t.events.includes('wallet'),'server reward survives navigation');}
 assert.equal(t.eval('challengePending()'),false);
}
for(const mode of ['trial','raid'])for(const phase of ['post','replay']){
 const t=setup();t.eval(`_trialTab='${mode}'`);const p=t.c[`${mode}RunGo`]();
 if(phase==='replay'){t.post.resolve(mode==='raid'?raidPost:trialPost);await new Promise(r=>setImmediate(r));}
 t.c.net.state.accountId='B';t.c.S={...t.c.S,credits:999};t.post.resolve(mode==='raid'?raidPost:trialPost);t.replay.resolve('E');await p;
 assert.equal(t.c.S.credits,999);assert.ok(!t.events.includes(`${mode}-result`),'old account cannot show results');
 if(phase==='post')assert.ok(!t.events.includes('wallet'));
}
for(const mode of ['trial','raid']){
 const n=setup();n.eval(`_trialTab='${mode}'`);const stale=n.c[`${mode}RunGo`]();n.post.resolve(mode==='raid'?raidPost:trialPost);await new Promise(r=>setImmediate(r));n.c._battleRequest++;n.replay.resolve('E');await stale;assert.ok(!n.events.includes(`${mode}-result`),'navigation away and back invalidates old replay');
 const t=setup();t.eval(`_trialTab='${mode}'`);const p=t.c[`${mode}RunGo`]();t.post.resolve(mode==='raid'?raidPost:trialPost);t.replay.resolve('E');await p;
 assert.ok(t.events.includes(`${mode}-result`),'completed playback reaches report');
 const f=setup();f.eval(`_trialTab='${mode}'`);const run=f.c[`${mode}RunGo`]();f.post.resolve({error:'no tries left'});await run;assert.equal(f.eval('challengePending()'),false);assert.ok(f.events.some(x=>Array.isArray(x)&&x[0]==='toast'));
}
console.log('Challenge UI passed: static/escaped views; exhausted/down/pending states; squad order; stale GET isolation; duplicate POST guard; completed rewards; account changes during request/replay; reports and failure recovery.');
