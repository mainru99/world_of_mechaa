import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CONST,ROBOT_TYPES} from '../data/balance.js';
import {newRun,teamOf,act,tagsOf} from '../js/brawl.js';
import {runBrawl} from '../js/brawl-sim.js';
import {createBrawlManager} from '../js/ui/brawl-manager.js';
import {brawlView,synergyText} from '../js/ui/brawl-view.js';
import {replayState,applyReplayEvent} from '../js/ui/brawl-replay.js';
import {createBrawlFixture} from './brawl-ui-fixture.mjs';
import {battleView} from '../js/ui/battle.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
assert.equal(CONST.BRAWL.on,false,'production switch remains off');
assert.equal(synergyText({key:'precise',v:.15}),'스킬 위력 +15%');

const base={credits:1000,cores:10,scrap:500,items:{},robots:['mule','ranger','azure'].map((type,i)=>({type,uid:'ui-'+i,level:30}))};
const fixture=createBrawlFixture(clone(base));
function setup(){
 let owner=clone(base),visible=true,html='',commits=0,paints=0;
 const calls=[],timers=new Map();let seq=0,override=null;
 const net={state:{online:true,accountId:1},brawl:async body=>{calls.push(body?clone(body):'GET');if(override)return override(body);return clone(await fixture.request('/api/brawl',body?'POST':'GET',body));},brawlRank:()=>fixture.request('/api/brawl/rank'),growthState:async()=>({ok:true,...clone(fixture.snapshot())})};
 const manager=createBrawlManager({state:()=>owner,net,document:{querySelector:q=>q.includes('.br-app')&&visible?{}:null},openModal:v=>{html=v;visible=true;},commit:()=>commits++,paint:()=>paints++,setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id)});
 return {manager,a:manager.actions,net,calls,timers,get html(){return html;},get visible(){return visible;},get owner(){return owner;},get commits(){return commits;},get paints(){return paints;},override:fn=>override=fn,close:()=>visible=false,changeAccount:()=>{owner=clone(base);net.state.accountId=2;visible=false;}};
}
try{
 const t=setup();await t.a.brawlHome();assert.match(t.html,/오늘의 대여/);assert.match(t.html,/보상 런 시작/);
 const view=await fixture.request('/api/brawl');
 for(const type of view.offers.slice(0,3))t.a.brawlChoose('rentals',type);
 t.a.brawlChoose('rentals',view.offers[3]);
 t.a.brawlChoose('deck','ranger');await t.a.brawlStart();
 const start=t.calls.find(x=>x.action==='start');assert.equal(start.rentals.length,3);assert.deepEqual(start.deck,['ranger']);
 assert.match(t.html,/승리 \/ 목표/);assert.match(t.html,/0 \/ 10/);assert.match(t.html,/보급 상점/);
 let record=(await fixture.request('/api/brawl')).run;
 const i=record.run.shop.findIndex(type=>type&&CONST.BRAWL.price[ROBOT_TYPES[type].rarity]<=record.run.gold);
 const expected=act(record.run,{t:'buy',i}).run;await t.a.brawlBuy(i);
 record=(await fixture.request('/api/brawl')).run;assert.deepEqual(record.run,expected,'server rule confirms purchase');
 const pos=record.run.bench.findIndex(Boolean);t.a.brawlSlot('bench',pos);assert.match(t.html,/aria-pressed="true"/);
 await t.a.brawlSlot('board',0);record=(await fixture.request('/api/brawl')).run;assert.ok(record.run.board[0]);
 t.a.brawlSlot('board',0);const before=t.calls.length;t.a.brawlSell();assert.equal(t.calls.length,before,'sale requires confirmation');
 t.a.brawlSlot('board',0); // cancel selected slot without selling
 await t.a.brawlFight();assert.match(t.html,/COMBAT REPLAY/);assert.equal(t.timers.size,1);
 t.a.brawlSpeed();assert.match(t.html,/속도 ×2/);t.a.brawlSkip();assert.equal(t.timers.size,0);assert.match(t.html,/라운드 (승리|패배)/);
 await t.a.brawlRank();assert.match(t.html,/주간 난투 순위/);t.a.brawlBack();assert.match(t.html,/ROUND 1 COMPLETE/);await t.a.brawlContinue();assert.match(t.html,/2라운드 출격/);
 // Another tab changes the revision. This UI must read, never resubmit.
 const stale=(await fixture.request('/api/brawl')).run;await fixture.request('/api/brawl','POST',{action:'act',rev:stale.rev,actions:[{t:'lock'}]});
 const callsBefore=t.calls.length;await t.a.brawlAct('lock');assert.equal(t.calls.slice(callsBefore).filter(x=>x.action).length,1);assert.equal(t.calls.at(-1),'GET');assert.match(t.html,/다른 창/);
 // Lost start/act response: the DB write succeeds, transport reports unknown.
 t.override(async body=>{if(body){await fixture.request('/api/brawl','POST',body);return {error:'timeout'};}return fixture.request('/api/brawl');});
 const unknownBefore=t.calls.length;await t.a.brawlAct('lock');assert.equal(t.calls.length-unknownBefore,2);assert.match(t.html,/반복하지 않았습니다/);t.override(null);
 // Failed reconciliation leaves all writes blocked until a successful GET.
 t.override(async()=>({error:'offline'}));await t.a.brawlAct('lock');const failedCount=t.calls.length;await t.a.brawlAct('lock');assert.equal(t.calls.length,failedCount);assert.match(t.html,/새로고침으로 기록/);t.override(null);await t.a.brawlRefresh();
 const quitBefore=t.calls.length;t.a.brawlQuit();assert.equal(t.calls.length,quitBefore);await t.a.brawlQuit();
 assert.match(t.html,/서버 지급 완료/);assert.ok(t.owner.credits>1000);assert.equal(t.commits,1);const paid=t.owner.credits;
 await t.a.brawlContinue();assert.match(t.html,/연습 런 시작/);await t.a.brawlStart();t.a.brawlQuit();await t.a.brawlQuit();assert.match(t.html,/연습 런 · 보상 없음/);assert.equal(t.owner.credits,paid);
 await t.a.brawlContinue();await t.a.brawlStart();t.close();await t.a.brawlHome();assert.match(t.html,/보급 상점/,'run resumes after modal close');
 // Double click, account switch, and closing mid-request.
 const d=deferred();t.override(async body=>body?d.promise:fixture.request('/api/brawl'));
 const count=t.calls.length,p=t.a.brawlAct('lock');await t.a.brawlAct('lock');assert.equal(t.calls.length,count+1);assert.equal(t.manager.busy(),true);
 t.close();d.resolve({ok:true,run:(await fixture.request('/api/brawl')).run});await p;assert.equal(t.manager.busy(),false);assert.equal(t.visible,false,'late write cannot reopen closed modal');
 const u=setup();await u.a.brawlHome();const delay=deferred();u.override(async()=>delay.promise);const late=u.a.brawlAct('lock');u.changeAccount();const oldHtml=u.html;delay.resolve({ok:true,run:(await fixture.request('/api/brawl')).run});await late;assert.equal(u.html,oldHtml);assert.equal(u.commits,0);assert.equal(u.owner.credits,1000);
 console.log('PASS · live SQLite UI flow, selection caps, purchase/move, replay/rank, stale/unknown/offline, reward once, resume, duplicate/late-account requests');
}finally{fixture.close();}
{
 const t=setup();t.override(async()=>({ok:true,on:false}));await t.a.brawlHome();assert.match(t.html,/난투 준비 중/);const count=t.calls.length;await t.a.brawlStart();assert.equal(t.calls.length,count,'off mode sends no POST');
 assert.ok(!battleView({allies:[],playerName:'QA',playerMeta:''}).includes('ROWAR.brawlHome()'),'production menu remains hidden');
 t.net.state.online=false;await t.a.brawlRefresh();assert.match(t.html,/서버에 연결되어 있지 않습니다/);
}

// Replay all authoritative events and compare all eight final HP values,
// including boards with holes, shields, healing and escalating heat.
const ids=['bastion','mule','ranger','azure'];
for(const holes of [false,true])for(let seed=1;seed<=40;seed++){
 const board=ids.map((type,i)=>holes&&i===1?null:{type,star:i%2+1}),enemy=ids.slice().reverse().map(type=>({type,star:2}));
 const p=teamOf(board),e=teamOf(enemy),out=runBrawl({p,e,seed}),fight={me:{board,team:p},opponent:{board:enemy,team:e}};
 const state=replayState(fight);for(const ev of out.events)applyReplayEvent(state,ev);
 for(const [key,team] of [['P',out.P],['E',out.E]])for(const u of team)assert.equal(state.units[key][u.i].hp,u.hp,`${key}${u.i} final HP, seed=${seed}`);
}
const run=newRun({seed:4,day:null,owned:[],deck:[]});const session={record:{on:true,run:{run,rev:0,first:true,syn:[],odds:{C:100},income:{base:5,interest:2,streak:0,total:7}}},phase:'workshop',known:true,online:true};
{
 const select=tag=>Object.keys(ROBOT_TYPES).filter(t=>!ROBOT_TYPES[t].story&&tagsOf(t).includes(tag)).slice(0,2);
 const support=[...new Set([...select('shield'),...select('repair')])].slice(0,4).map(type=>({type,star:3}));
 const counts={shield:0,heal:0,heat:0};
 for(let seed=1;seed<=10;seed++){
  const p=teamOf(support),e=teamOf(support),out=runBrawl({p,e,seed,opts:{heat:{at:4,step:.1,every:1}}});
  const state=replayState({me:{team:p},opponent:{team:e}});
  for(const ev of out.events){applyReplayEvent(state,ev);if(ev.t in counts)counts[ev.t]++;}
  for(const [key,team] of [['P',out.P],['E',out.E]])for(const u of team){assert.equal(state.units[key][u.i].hp,u.hp);assert.equal(state.units[key][u.i].shield,u.shield);}
 }
 for(const [key,count] of Object.entries(counts))assert.ok(count>0,`real engine ${key} events are covered`);
 console.log('PASS · 10 support-team replays: shield/heal/heat events and final shield match engine');
}
assert.match(brawlView({...session,notice:'<script>bad()</script>'}),/&lt;script&gt;/);
assert.ok(!brawlView({...session,notice:'<script>bad()</script>'}).includes('<script>'));
const rank=brawlView({...session,phase:'rank',rank:{top:[{rank:1,nickname:'<img onerror=bad()>',best:10,lives:5,runs:1}]}});assert.ok(!rank.includes('<img onerror='));
const netSource=await readFile(new URL('../js/net.js',import.meta.url),'utf8');
const request=netSource.slice(netSource.indexOf('async function brawlRequest'),netSource.indexOf('export const brawl='));assert.ok(!request.includes('setSyncedRev'),'run revision cannot advance player sync revision');
assert.equal(CONST.BRAWL.on,false);console.log('PASS · 90 full event replays, sparse slot IDs, HTML escaping, production switch, separate revision contract');
