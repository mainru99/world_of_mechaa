import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sqliteD1} from './sqlite-d1.mjs';
import {findMatch,startBattle} from '../server/battle.js';
import {registerArena} from '../server/arena.js';
import {computeStats,powerOf} from '../js/stats.js';
import {preparedStats} from '../js/ui/battle-stats.js';
import {CONST,ROBOT_TYPES,MONSTER_TYPES} from '../data/balance.js';
const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));const env=sqliteD1(db),now=Date.now();
const run=(sql,...a)=>db.prepare(sql).run(...a);
for(const id of [1,2]){
 run('INSERT INTO account(id,device_key,created_at,last_seen) VALUES(?,?,?,?)',id,`prep${id}`,now,now);
 run('INSERT INTO player(account_id,nickname,credits,rating,updated_at) VALUES(?,?,1000000,1000,?)',id,`PREP${id}`,now);
 for(const [i,type]of ['ignis','mule'].entries())run('INSERT INTO robot(id,account_id,uid,type,level,skill_lv,circuit,created_at) VALUES(?,?,?,?,30,3,?,?)',id*10+i,id,`u${id}${i}`,type,JSON.stringify(i?['B1','B2']:['A1','A2']),now);
 run('UPDATE player SET sel_robot=?,squad1=?,squad2=? WHERE account_id=?',id*10,id*10,id*10+1,id);
 await registerArena(env,id,now);
}
const equal=(a,b)=>assert.deepEqual(a,b,'preparation stats must equal actual start stats');
for(const stale of [false,true])for(const pick of [0,1]){
 if(stale)run("UPDATE arena_entry SET balance_ver='old' WHERE account_id=2");
 const f=await findMatch(env,1,now,{mode:'duel',target:'PREP2',pick});assert.ok(f.opponent.stats);assert.equal(f.opponent.bench.length,1);assert.equal(f.opponent.circuit.length,2);
 assert.ok(!['seed','tactic','accountId','dbId'].some(k=>k in f.opponent));
 // Re-register the defence after finding it: the pending battle retains its snapshot.
 run('UPDATE robot SET level=level+1 WHERE account_id=2');await registerArena(env,2,now);
 const r=await startBattle(env,1,now+1,{tactic:'none'});assert.equal(r.ok,true);equal(f.opponent.stats,r.statE);equal(f.opponent.bench[0].stats,r.relay.statE2);
 equal(r.next.opponent.stats,(await startBattle(env,1,now+2,{tactic:'none'})).statE);
}
for(const tier of ['C','BOSS']){
 const f=await findMatch(env,1,now,{mode:'hunt',tier});const r=await startBattle(env,1,now+1,{tactic:'none'});assert.equal(r.ok,true);equal(f.opponent.stats,r.joint?r.boss.stats:r.statE);
}
for(const rescue of [false,true]){
 run('UPDATE player SET credits=? WHERE account_id=1',rescue?0:1000000);
 const f=await findMatch(env,1,now,null),r=await startBattle(env,1,now+1,{tactic:'none'});assert.equal(r.ok,true);equal(f.opponent.stats,r.statE);if(r.relay)equal(f.opponent.bench[0].stats,r.relay.statE2);
}
const source=readFileSync(new URL('../js/game.js',import.meta.url),'utf8'),fn=name=>{const p=source.indexOf(`function ${name}(`);return source.slice(p,source.indexOf('\n}',p)+2);};
const robot={type:'ignis',level:30,slots:{}},stats={...computeStats(robot,[]),hp:12345,atk:6789};
const c=vm.createContext({preparedStats,computeStats,powerOf});vm.runInContext(fn('battleUnit'),c);equal(c.battleUnit(robot,[],stats).stats,stats);assert.equal(c.battleUnit(robot,[],stats).power,powerOf(stats));
for(const invalid of [null,{}, {...stats,hp:NaN},{...stats,eva:1},{...stats,atk:0}])assert.equal(preparedStats(invalid),null);
let view;Object.assign(c,{shield(){},COMBAT_TYPES:{...ROBOT_TYPES,...MONSTER_TYPES},MONSTER_TYPES,selRobot:()=>robot,isPct:k=>['crit','eva'].includes(k),fmt:String,STAT_LABEL:{},power:()=>100,CONST,esc:String,oppGear:()=>'',fxTags:()=>'',bandLine:()=>'',battleIdentity:()=>({}),icon:()=>'',relayPreview:()=>'',_tactic:'none',battleView:v=>{view=v;return '';},$:()=>({innerHTML:''})});
vm.runInContext(fn('showOpponent'),c);c.showOpponent({kind:'player',robot,parts:[],stats,callsign:'PREP2',mode:'duel'});equal(view.enemies[0].stats,stats);assert.equal(view.powerKnown,true);
c.showOpponent({kind:'player',robot,parts:[],callsign:'OLD',mode:'duel'});assert.equal(view.powerKnown,false);assert.equal(view.enemies[0].statsKnown,false);
assert.equal(CONST.PART_BIND.on,true);assert.equal(CONST.LINEAGE.gate,true);
console.log('Preparation passed: player circuit, both picks, stale balance, stable pending snapshot, next/start, reserve stats, generated/rescue/hunt/joint boss; UI uses confirmed stats, old/invalid responses remain unknown; switches preserved.');
