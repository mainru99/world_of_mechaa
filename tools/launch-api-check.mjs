/* Disposable launch QA on a separate loopback Worker only. No production DB.
 * Optional fixture SQL is generated, never executed here; use ONLY the same
 * --local --persist-to .wrangler/launch-review-state test DB. */
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {rollPart} from '../js/gacha.js';
import {mulberry32} from '../js/sim.js';
import {insertPart} from '../server/parts.js';
import {goalOk} from '../js/mastery.js';
import {ROBOT_TYPES} from '../data/balance.js';
const base=new URL(process.argv[2]||'http://127.0.0.1:8843');
assert.equal(base.hostname,'127.0.0.1');assert.equal(base.protocol,'http:');assert.ok(base.port&&base.pathname==='/');
const nativeFetch=globalThis.fetch,storage=new Map();let count=0;
globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
globalThis.fetch=(url,options)=>{count++;return nativeFetch(new URL(url,base),options);};
const net=await import('../js/net.js'),good=r=>{assert.ok(r&&!r.error&&r.ok!==false,r?.error||'missing response');return r;};
assert.equal(Number(good(await net.health()).schema_version),24);
await net.connect({create:false});assert.equal(net.state.needGuest,true);
good(await net.connect({create:true}));let remote=good(await net.pull());
assert.equal(remote.state.robots.length,1);assert.equal(remote.state.robots[0].level,1);
let first;for(let attempt=0;attempt<10;attempt++){
 first=good(await net.front('c1-1'));if(first.win)break;
 assert.equal(first.first,false);assert.equal(first.gain,null,'a legitimate defeat must not award first-clear rewards');
}
assert.equal(first.win,true);assert.equal(first.first,true);
remote=good(await net.pull());assert.equal(remote.state.credits,800);assert.equal(remote.state.scrap,50);
const repeat=good(await net.front('c1-1'));assert.equal(repeat.first,false);assert.equal(repeat.gain,null);
const u=remote.state.robots[0].uid;
for(let i=remote.state.robots[0].level;i<3;i++)good(await net.hangar('levelup',{robotUid:u}));
const progression=good(await net.pull());assert.equal(progression.state.robots[0].level,3);
good(await net.logout());storage.clear();good(await net.connect({create:true}));
const loginId=`qa${Date.now()}`;good(await net.register(loginId,'LocalQA8843!'));
good(await net.pull());
const robot={uid:'launch-unit',type:'ignis',level:4,exp:0,fat:0,fatAt:Date.now(),skillLv:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}};
good(await net.push({v:2,credits:100000,cores:12,scrap:50000,robots:[robot],parts:[],sel:0,squad:[robot.uid],stat:{wins:0,losses:0,pulls:0}}));
const candidates=Object.keys(ROBOT_TYPES).filter(t=>goalOk(t,[robot.type])),old=candidates[0],next=candidates[1];assert.ok(old&&next);
good(await net.setDevelopmentGoal(old));good(await net.growthState()); // device A preflight
good(await net.hangar('levelup',{robotUid:robot.uid})); // device B crosses Lv.5
const changed=good(await net.setDevelopmentGoal(next)); // device A goal write after level event
const settled=good(await net.growthState());
assert.equal(changed.settled.goal,old);assert.equal(changed.settled.got,1);assert.equal(settled.mastery.got,0);assert.equal(settled.items[`shard:${old}`],1);assert.equal(settled.items[`shard:${next}`]||0,0);
console.log(JSON.stringify({goalWindow:{old,next,grant:changed.settled.got,creditedTo:changed.settled.goal,oldShards:settled.items[`shard:${old}`]||0,newShards:settled.items[`shard:${next}`]||0}}));
const prep=good(await net.battleFind({mode:'duel',target:progression.nickname}));assert.equal(prep.opponent.kind,'player');
assert.ok(Array.isArray(prep.opponent.circuit));assert.ok(prep.opponent.stats?.hp>0);
const battle=good(await net.battleStart('none'));assert.deepEqual(prep.opponent.stats,battle.statE);
for(let i=0;i<5;i++)good(await net.hangar('levelup',{robotUid:robot.uid}));
const reads=(await Promise.all([net.growthState(),net.growthState()])).map(good);
assert.equal(reads.reduce((n,r)=>n+r.mastery.got,0),1);const final=good(await net.growthState());
assert.equal(final.items[`shard:${old}`],1);assert.equal(final.items[`shard:${next}`],1);
if(process.argv[3]){
 assert.equal(process.argv[3],'.tmp/launch-large.sql','fixture output is restricted to a known local QA file');
 const rng=mulberry32(20260930),sql=[],quote=v=>v===null?'NULL':typeof v==='number'?String(v):`'${String(v).replaceAll("'","''")}'`;
 const D={prepare:text=>({bind:(...values)=>{sql.push(text.replace(/\?(\d+)/g,(_,i)=>quote(values[Number(i)-1]))+';');}})};
 for(let i=0;i<1000;i++){const p=rollPart(20,rng,`launch-part-${i}`,i%2?'SR':'R','WEAPON');if(i===999)p.name='최종 검수 무장';insertPart(D,net.state.accountId,p,Date.now());}
 await mkdir('.tmp',{recursive:true});await writeFile(process.argv[3],sql.join('\n'));
 console.log(`Fixture generated: ${loginId} / LocalQA8843! · 1,000 parts; execute only against the isolated local launch-review-state DB.`);
}
console.log(`Launch API passed: fresh guest without migration, first/repeat rewards, Lv.3 progression, separate QA account, old-goal atomic settlement and preparation/start stats; ${count} loopback HTTP requests.`);
