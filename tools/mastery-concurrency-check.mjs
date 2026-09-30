import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {sqliteD1} from './sqlite-d1.mjs';
import {loadState} from '../server/state.js';
import {shopRun} from '../server/shop.js';
import {goalOk} from '../js/mastery.js';
import {ROBOT_TYPES} from '../data/balance.js';
const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
const q=(sql,...a)=>db.prepare(sql).get(...a),run=(sql,...a)=>db.prepare(sql).run(...a);
let hook=null,fail=false,batches=0,maxBindings=0;
const env=sqliteD1(db,{beforeBatch:async list=>{batches++;maxBindings=Math.max(maxBindings,...list.map(s=>s.args.length));const f=hook;hook=null;await f?.();},failAt:i=>fail&&i===1});
function reset(level=5,mLv=4){
 db.exec('DELETE FROM account');
 for(const id of [1,2]){
  run('INSERT INTO account(id,device_key,created_at,last_seen) VALUES(?,?,0,0)',id,`test-${id}`);
  run("INSERT INTO player(account_id,nickname,credits,scrap,updated_at,items,m_goal) VALUES(?,?,100000,10000,0,'{}','mule')",id,`TEST${id}`);
  run("INSERT INTO robot(account_id,uid,type,level,m_lv,created_at) VALUES(?,?,'ignis',?,?,0)",id,`r${id}`,level,mLv);
 }
 hook=null;fail=false;batches=0;
}
const items=()=>JSON.parse(q('SELECT items FROM player WHERE account_id=1').items||'{}');
const goal=()=>q('SELECT m_goal FROM player WHERE account_id=1').m_goal;
const marker=()=>q('SELECT m_lv FROM robot WHERE account_id=1 ORDER BY id').m_lv;
const setLevel=n=>run('UPDATE robot SET level=? WHERE account_id=1',n);
const choose=type=>shopRun(env,1,1,{action:'goal',type});
assert.ok(goalOk('mule',['ignis'])&&goalOk('dune',['ignis']));
reset(4);assert.equal((await loadState(env,1)).mastery.got,0);setLevel(5);
let r=await choose('dune');assert.equal(r.ok,true);assert.equal(r.settled.goal,'mule');assert.equal(r.settled.got,1);assert.equal(r.mastery.goal,'dune');assert.equal(r.mastery.got,0);
assert.equal(items()['shard:mule'],1);assert.equal(items()['shard:dune'],undefined);assert.equal(marker(),5);
await choose('dune');assert.equal((await loadState(env,1)).mastery.got,0);setLevel(10);await loadState(env,1);assert.equal(items()['shard:dune'],1);

reset();const concurrent=await Promise.all([loadState(env,1),loadState(env,1)]);
assert.equal(concurrent.reduce((n,s)=>n+s.mastery.got,0),1);assert.equal(items()['shard:mule'],1);assert.equal(marker(),5);
reset();hook=()=>run('UPDATE player SET items=?,rev=rev+1 WHERE account_id=1',JSON.stringify({'shard:rust':7}));
await loadState(env,1);assert.deepEqual(items(),{'shard:rust':7,'shard:mule':1});assert.equal(batches,2);
reset();hook=()=>run("UPDATE player SET m_goal='dune',rev=rev+1 WHERE account_id=1");
await loadState(env,1);assert.equal(goal(),'dune');assert.equal(items()['shard:dune'],1);assert.equal(items()['shard:mule'],undefined);
reset();hook=()=>setLevel(10);r=await choose('dune');assert.equal(r.settled.got,2);assert.equal(items()['shard:mule'],2);assert.equal(marker(),10);
reset();hook=()=>run('UPDATE robot SET m_lv=5 WHERE account_id=1');await loadState(env,1);assert.deepEqual(items(),{});
reset();hook=()=>run("INSERT INTO robot(account_id,uid,type,level,m_lv,created_at) VALUES(1,'new','dune',1,1,0)");
r=await choose('dune');assert.equal(r.error,'bad goal');assert.equal(goal(),'mule');assert.equal(marker(),4);assert.deepEqual(items(),{});
reset();let conflicts=0;const conflict=()=>{conflicts++;run('UPDATE player SET rev=rev+1 WHERE account_id=1');hook=conflict;};hook=conflict;
r=await choose('dune');assert.equal(r.status,409);assert.equal(conflicts,3);assert.equal(marker(),4);assert.deepEqual(items(),{});
reset();hook=conflict;r=await loadState(env,1);assert.equal(r.status,409);assert.equal(marker(),4);assert.deepEqual(items(),{});
reset();fail=true;await assert.rejects(choose('dune'),/injected batch failure/);assert.equal(goal(),'mule');assert.equal(marker(),4);assert.deepEqual(items(),{});fail=false;
reset();run('UPDATE player SET items=? WHERE account_id=1',JSON.stringify({'shard:rust':6}));let synth;
hook=async()=>{synth=await shopRun(env,1,2,{action:'synth',mats:{rust:6}});assert.equal(synth.ok,true);};
await choose('dune');assert.equal(items()['shard:rust']||0,synth.items['shard:rust']||0);for(const [k,n]of Object.entries(synth.items))assert.equal(items()[k],n+(k==='shard:mule'?1:0));assert.equal(items()['shard:mule'],(synth.items['shard:mule']||0)+1);
reset();run('UPDATE player SET items=? WHERE account_id=1',JSON.stringify({'shard:rust':100}));let assembled;
hook=async()=>{assembled=await shopRun(env,1,2,{action:'assemble',type:'rust'});assert.equal(assembled.ok,true);};
await choose('dune');assert.equal(items()['shard:rust'],assembled.items['shard:rust']);assert.equal(items()['shard:mule'],1);assert.ok(q("SELECT id FROM robot WHERE account_id=1 AND type='rust'"));
reset(60,null);await loadState(env,1);assert.equal(items()['shard:mule'],14);assert.equal(marker(),60);assert.equal((await loadState(env,1)).mastery.got,0);
assert.deepEqual(JSON.parse(q('SELECT items FROM player WHERE account_id=2').items),{});assert.equal(q('SELECT m_lv FROM robot WHERE account_id=2').m_lv,null);
reset(60,60);await loadState(env,1);assert.deepEqual(items(),{});
reset(4,4);run("UPDATE player SET m_goal=NULL,rev=0 WHERE account_id=1");await loadState(env,1);assert.equal(q('SELECT rev FROM player WHERE account_id=1').rev,0,'first GET must not close legacy migration');
reset();for(const [i,type]of Object.keys(ROBOT_TYPES).filter(t=>!['ignis','mule','dune'].includes(t)).entries())run('INSERT INTO robot(account_id,uid,type,level,m_lv,created_at) VALUES(1,?,?,10,4,0)',`extra-${i}`,type);
const n=q('SELECT COUNT(*) n FROM robot WHERE account_id=1').n;r=await loadState(env,1);assert.equal(r.mastery.got,1+2*(n-1));assert.ok(maxBindings<=9);
console.log(`Mastery concurrency passed: old-goal window; parallel GET; inventory/goal/level/marker/ownership races; bounded 409; transaction rollback; null/max/migration/account isolation; ${n} robot snapshot with at most ${maxBindings} bindings.`);
