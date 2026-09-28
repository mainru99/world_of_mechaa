import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {frontCampaignView,frontStoryView,frontResultView} from '../js/ui/front.js';
import {FRONT_CELLS,frontView,readProgress,cellOpen,cellIndex} from '../js/front.js';
import {SPEAKERS} from '../data/story.js';
const chapters=frontView(readProgress('11000000000'),32),chapter=chapters[0];
const team=[{uid:'a',type:'ignis',level:32,power:6000,fat:0},{uid:'b',type:'ranger',level:32,power:4000,fat:12}];
const html=frontCampaignView({chapters,chapter,selected:chapter.cells[2],team});
assert.match(html,/CH\. 02[^]*?disabled|disabled[^]*?CH\. 02/);
assert.match(html,/aria-pressed="true"[^]*?무너진 도로/);
assert.match(html,/2\/2기/);assert.match(html,/순서대로 돌파/);
assert.ok(!html.includes('ignis-idle'),'all campaign card sprites remain static');
assert.ok(!html.includes('themes/assets/'));
const offline=frontCampaignView({chapters,chapter,selected:chapter.cells[0],team:team.slice(0,1),online:false});
assert.match(offline,/1\/1기/);assert.match(offline,/보상 수령 완료/);
assert.ok(!offline.includes('첫 클리어 보상</h3>'),'cleared mission never promises first rewards');
const empty=frontCampaignView({chapters,chapter,selected:chapter.cells[2],team:[]});
assert.match(empty,/class="btn gold" disabled/);
const bad='<img src=x onerror=bad()>',story=frontStoryView(bad,bad),result=frontResultView({win:true,unlocked:{ko:bad}}, {...chapter.cells[0],outro:bad},{rewards:'',repair:''});
assert.ok(!story.includes('<img src=x'));assert.ok(!result.includes('<img src=x'));
assert.match(story,/id="storyNext"/);assert.match(story,/id="storyExit"/);

const source=await readFile(new URL('../js/game.js',import.meta.url),'utf8');
function fn(name){const start=source.indexOf(`function ${name}(`),end=source.indexOf('\n}',start);assert.ok(start>=0);return source.slice(source.slice(start-6,start)==='async '?start-6:start,end+2);}
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
const flush=()=>new Promise(r=>setImmediate(r));

/* Exercise the actual typewriter, two-click progression, skip and cancellation. */
function storySetup(){
 const nodes=new Map(),intervals=new Map();let timerId=0;
 for(const id of ['storyView','storyLine','storySpk','storyN','storyGo','storyNext','storyArt','storyArtImg','storyReading','storySkip','storyExit','sc-battle'])nodes.set('#'+id,{isConnected:true,hidden:false,textContent:'',events:{},addEventListener(k,f){this.events[k]=f;},focus(){},removeAttribute(){},fire(){this.events.click?.({target:{closest:()=>true}});}});
 const c=vm.createContext({cur:'battle',window:{matchMedia:()=>({matches:false})},document:{activeElement:null},SPEAKERS,frontStoryView,esc:String,Image:class{},artPath:k=>k,setTerrain(){},$:s=>nodes.get(s),toBattle(){c.cur='battle';},enterFront(){c.stopScript();c.cur='terr';},setInterval:f=>{intervals.set(++timerId,f);return timerId;},clearInterval:id=>intervals.delete(id)});
 vm.runInContext('let _scriptAbort=null,_storyArt=null;const SPEAK_MS=18;'+fn('speakerHtml')+fn('stopScript')+fn('playScript'),c);
 return {c,nodes,intervals};
}
for(const phase of ['typing','waiting']){
 const t=storySetup(),p=t.c.playScript([{t:'하나'},{t:'둘'}],'전선','출격');
 if(phase==='waiting'){t.nodes.get('#storyNext').fire();await flush();}
 t.c.stopScript();assert.equal(await p,false);assert.equal(t.intervals.size,0,'navigation cancels timer');
}
{
 const t=storySetup(),p=t.c.playScript([{t:'첫 줄'},{t:'둘째 줄'}],'전선','출격');
 t.nodes.get('#storyNext').fire();await flush();assert.equal(t.nodes.get('#storyLine').textContent,'첫 줄');assert.equal(t.nodes.get('#storyN').textContent,'1 / 2');
 t.nodes.get('#storyNext').fire();await flush();assert.equal(t.nodes.get('#storyN').textContent,'2 / 2');
 t.nodes.get('#storyNext').fire();await flush();assert.equal(t.nodes.get('#storyGo').hidden,false);
 t.nodes.get('#storyGo').fire();assert.equal(await p,true);
 const skipped=t.c.playScript([{t:'건너뛰는 줄'}],'전선','출격');t.nodes.get('#storySkip').fire();assert.equal(await skipped,true);
}

/* Online request isolation, navigation, one-time stories and offline fallback. */
function runSetup(){
 const post=deferred(),script=deferred(),replay=deferred(),events=[];
 const c=vm.createContext({S:{credits:10,scrap:0,campaign:'',robots:team,squad:['a','b'],sel:0},cur:'terr',_battleRequest:0,_frontCh:null,_frontCell:null,net:{state:{online:true,accountId:'A'},front:()=>{events.push('post');return post.promise;}},FRONT_CELLS,cellIndex,cellOpen,frontProg:()=>readProgress(c.S.campaign),frontTeam:()=>team,closeModal(){},setTerrain(){},scriptOf:(id,when)=>when==='before'?[{t:'대사'}]:null,cellSeen:()=>false,playScript(){c.cur='battle';return script.promise;},markSeen:(id,when)=>events.push('seen:'+when),chapterOfCell:()=>null,closingOf:()=>null,toBattle(){c.cur='battle';},$:()=>({innerHTML:''}),esc:String,ERR_KO:{},toast:t=>events.push('toast:'+t),go(){c._battleRequest++;c.cur='terr';},runCellLocal(){events.push('local');return {win:false,credits:11};},applyFront:r=>{c.S.credits=r.credits;events.push('saved');},replayBreach:()=>{events.push('replay');return replay.promise;},renderFrontResult:()=>events.push('result')});
 vm.runInContext(fn('runCell'),c);return {c,post,script,replay,events};
}
for(const change of [t=>{t.c.cur='hangar';t.c._battleRequest++;},t=>{t.c.net.state.accountId='B';},t=>{t.c.S={...t.c.S};}]){
 const t=runSetup(),p=t.c.runCell('c1-1');change(t);t.script.resolve(false);await p;assert.ok(!t.events.includes('seen:before'));assert.ok(!t.events.includes('post'));
}
for(const phase of ['post','replay'])for(const change of ['navigation','account','state']){
 const t=runSetup(),p=t.c.runCell('c1-1');t.script.resolve(true);await flush();
 if(phase==='replay'){t.post.resolve({credits:77,win:false});await flush();}
 if(change==='navigation'){t.c.cur='hangar';t.c._battleRequest++;}else if(change==='account')t.c.net.state.accountId='B';else t.c.S={...t.c.S};
 t.post.resolve({credits:77,win:false});t.replay.resolve(true);await p;
 assert.ok(!t.events.includes('result'));
 if(phase==='post'&&change!=='navigation')assert.ok(!t.events.includes('saved'),'old owner cannot receive results');
 if(phase==='post'&&change==='navigation'){assert.equal(t.c.S.credits,77);assert.ok(!t.events.includes('replay'),'completed server result is saved without reopening screen');}
}
{
 const t=runSetup(),p=t.c.runCell('c1-1');t.script.resolve(true);await flush();t.post.resolve(null);await p;assert.ok(!t.events.includes('local'),'online failure cannot simulate an offline win');
 const success=runSetup(),q=success.c.runCell('c1-1');success.script.resolve(true);success.post.resolve({credits:77,win:false});success.replay.resolve(true);await q;assert.ok(success.events.includes('result'));
 const off=runSetup();off.c.net.state.online=false;const o=off.c.runCell('c1-1');off.script.resolve(true);off.replay.resolve(true);await o;assert.ok(off.events.includes('local'));assert.ok(!off.events.includes('post'));
 const locked=runSetup();await locked.c.runCell('c2-1');assert.ok(!locked.events.includes('post'));
}

/* Preview order must match the current server's sequential squad rules. */
{
 const c=vm.createContext({S:{robots:team,sel:1,squad:['a','b']},net:{state:{online:true}},selRobot:()=>c.S.robots[c.S.sel]});vm.runInContext(fn('frontTeam'),c);
 assert.equal(c.frontTeam()[0].uid,'b');c.S.expd={uid:'b'};assert.equal(c.frontTeam().length,1);assert.equal(c.frontTeam()[0].uid,'a');
 c.S.expd=null;c.S.squad=[];assert.equal(c.frontTeam()[0].uid,'b');c.net.state.online=false;assert.equal(c.frontTeam().length,1);
}
/* Never resurrect the next defense line after navigation during its gap. */
{
 const gap=deferred(),events=[];
 const c=vm.createContext({cur:'battle',battleSpeed:1,runBreach:()=>({rounds:[{mi:0,li:0,events:[]},{mi:0,li:1,events:[]}]}),beginReplay(){},makeUnit:()=>({}),renderArena:()=>events.push('arena'),arenaGone:()=>c.cur!=='battle',rarOf:()=> 'C',playBattle:async()=>true,sleep:()=>gap.promise,blog(){},bossEntrance:async()=>{}});
 vm.runInContext(fn('replayBreach'),c);const p=c.replayBreach({mechs:[{stats:{}}],lines:[{stats:{}},{stats:{}}]},'전선');await flush();c.cur='hangar';gap.resolve();assert.equal(await p,false);assert.equal(events.length,1);
}
/* Exiting an automatic opening must neither mark it seen nor force it open again. */
for(const completed of [true,false]){
 const script=deferred(),events=[],el={innerHTML:''};
 const c=vm.createContext({S:{robots:team},cur:'terr',_battleRequest:0,net:{state:{online:true,accountId:'A'}},frontProg:()=>readProgress('11000000000'),myMaxLv:()=>32,frontView,cellSeen:()=>false,openingOf:()=>[{t:'도입'}],playScript:()=>{events.push('story');return script.promise;},markSeen:()=>events.push('seen'),go:()=>events.push('redirect'),$:()=>el,frontCampaignView:()=> 'mission-list',frontTeam:()=>team,power:()=>5000,fatOf:()=>0,lockedGates:()=>[]});
 vm.runInContext('let _frontCh=null,_frontCell=null;const _frontIntroAttempted=new Set();'+fn('currentChapter')+fn('renderFront'),c);
 c.renderFront();script.resolve(completed);await flush();assert.equal(events.includes('seen'),completed);assert.equal(events.includes('redirect'),completed);
 c.renderFront();assert.equal(events.filter(e=>e==='story').length,1);assert.equal(el.innerHTML,'mission-list');
}
/* Rewind only story keys, never campaign progress or another chapter's memory. */
{
 let seen=JSON.stringify({'ch1:open':1,'c1-1:before':1,'ch2:open':1}),rendered=0;
 const c=vm.createContext({S:{campaign:'11111000000'},FRONT_CHAPTERS:(await import('../js/front.js')).FRONT_CHAPTERS,seenKey:'rowar.seen.v1',localStorage:{getItem:()=>seen,setItem:(k,v)=>seen=v},closeModal(){},renderFront:()=>rendered++});
 vm.runInContext("let _storyArt='old',_frontCh=null;const _frontIntroAttempted=new Set(['ch1','ch2']);"+fn('restartChGo'),c);c.restartChGo('ch1');assert.equal(c.S.campaign,'11111000000');assert.equal(JSON.parse(seen)['ch2:open'],1);assert.ok(!JSON.parse(seen)['ch1:open']);assert.equal(rendered,1);
}
/* A repair response from the old account cannot spend the new account's wallet. */
{
 const pending=deferred(),events=[],rb={uid:'a',fat:4},button={};
 const c=vm.createContext({S:{credits:100,robots:[rb]},net:{state:{accountId:'A'}},$:()=>button,srvHangar:()=>pending.promise,serviceCost:r=>r.fat?10:0,commitLocal:()=>events.push('save'),toast:()=>events.push('toast'),fmt:String,frontFixHtml:()=> 'repaired'});
 vm.runInContext(fn('frontFix'),c);const p=c.frontFix('a');c.net.state.accountId='B';c.S={credits:999,robots:[rb]};pending.resolve({credits:90,cost:10});await p;assert.equal(c.S.credits,999);assert.equal(rb.fat,4);assert.equal(events.length,0);
}
console.log('Front UI passed: locked/cleared/offline/static views; typewriter/skip/exit; seen only on completion; server results retained across navigation; account isolation; no online fallback; squad order; replay boundary cancellation.');
