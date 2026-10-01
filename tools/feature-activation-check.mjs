// Actual server + SQLite: approved switches, existing-data conversion and gated assembly.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sqliteD1} from './sqlite-d1.mjs';
import {CONST,ROBOT_TYPES} from '../data/balance.js';
import {rollPart} from '../js/gacha.js';
import {shardNeed,bagView} from '../js/shop.js';
import {insertPart} from '../server/parts.js';
import {hangarAction} from '../server/hangar.js';
import {shopRun} from '../server/shop.js';
import {loadState} from '../server/state.js';
assert.equal(CONST.PART_BIND.on,true);assert.equal(CONST.LINEAGE.gate,true);
const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
const env=sqliteD1(db),now=Date.now(),run=(sql,...a)=>db.prepare(sql).run(...a),q=(sql,...a)=>db.prepare(sql).get(...a);
run('INSERT INTO account(id,device_key,created_at,last_seen) VALUES(1,?,?,?)','activation-local',now,now);
run('INSERT INTO player(account_id,nickname,credits,rcores,updated_at) VALUES(1,?,100000,3,?)','ACTIVATION',now);
for(const [id,type] of [[1,'mule'],[2,'rust']])run('INSERT INTO robot(id,account_id,uid,type,level,created_at) VALUES(?,1,?,?,20,?)',id,`r${id}`,type,now);
for(const uid of ['legacy-W','loose-W'])await insertPart(env.DB,1,rollPart(20,()=>0.5,uid,'R','WEAPON'),now,0).run();
const equipped=q("SELECT id FROM part WHERE uid='legacy-W'").id;
const oldPresets=JSON.stringify([{n:'existing preset',s:{WEAPON:'legacy-W',FRAME:null,BOOSTER:null,CORE:null}},null,null,null,null]);
run('UPDATE robot SET s_weapon=? WHERE id=1',equipped);
run('UPDATE player SET sel_robot=1,presets=? WHERE account_id=1',oldPresets);
const migrate=readFileSync(new URL('./bindnow.sql',import.meta.url),'utf8');db.exec(migrate);
assert.equal(q('SELECT bound FROM part WHERE id=?',equipped).bound,1);
assert.equal(q("SELECT bound FROM part WHERE uid='loose-W'").bound,null);
assert.equal(q('SELECT presets FROM robot WHERE id=1').presets,oldPresets);
assert.equal(q('SELECT presets FROM robot WHERE id=2').presets,null);
assert.equal(q('SELECT presets FROM player WHERE account_id=1').presets,oldPresets,'account preset source retained');
db.exec(migrate);assert.equal(q('SELECT presets FROM robot WHERE id=1').presets,oldPresets,'repeat conversion preserves presets');
let state=await loadState(env,1);assert.equal(state.bind.on,true);assert.equal(state.bind.parts['legacy-W'],'r1');
assert.equal(state.bind.presets.r1[0].n,'existing preset');
const currencies=()=>q('SELECT credits,cores,scrap,rcores FROM player WHERE account_id=1');
const before=currencies();
const blocked=await hangarAction(env,1,{action:'equip',robotUid:'r2',partUid:'legacy-W',slot:'WEAPON'},now);
assert.equal(blocked.error,'part bound');assert.deepEqual(currencies(),before);
const saved=await hangarAction(env,1,{action:'presetSave',robotUid:'r2',i:0,name:'second robot'},now);
assert.equal(saved.ok,true);assert.equal(q('SELECT presets FROM robot WHERE id=1').presets,oldPresets);
const taken=await hangarAction(env,1,{action:'equip',robotUid:'r2',partUid:'loose-W',slot:'WEAPON'},now);
assert.equal(taken.ok,true);assert.equal(q("SELECT bound FROM part WHERE uid='loose-W'").bound,2);
// Enough shards cannot bypass missing parents; rejection spends nothing and creates no robot.
const need=shardNeed('glacier');run('UPDATE player SET items=? WHERE account_id=1',JSON.stringify({'shard:glacier':need}));
const preview=bagView({'shard:glacier':need,'shard:bastion':shardNeed('bastion')},['mule','rust']);
assert.equal(preview.find(x=>x.type==='glacier').ready,false);assert.equal(preview.find(x=>x.type==='glacier').lineageLocked,true);
assert.equal(preview.find(x=>x.type==='bastion').ready,true);
const items=q('SELECT items FROM player WHERE account_id=1').items;
const denied=await shopRun(env,1,now,{action:'assemble',type:'glacier'});
assert.equal(denied.error,'lineage locked');assert.ok(denied.need.length);
assert.equal(q('SELECT items FROM player WHERE account_id=1').items,items);
assert.equal(q("SELECT COUNT(*) n FROM robot WHERE type='glacier'").n,0);assert.deepEqual(currencies(),before);
// Root and unlocked next steps remain usable.
run('UPDATE player SET items=? WHERE account_id=1',JSON.stringify({'shard:bastion':shardNeed('bastion')}));
const assembled=await shopRun(env,1,now,{action:'assemble',type:'bastion'});
assert.equal(assembled.ok,true);assert.equal(assembled.assembled.dupe,false);
assert.equal(q("SELECT COUNT(*) n FROM robot WHERE type='bastion'").n,1);
assert.deepEqual(currencies(),before);
// Execute the real renderer and handler: full shard counts must not look usable when gated.
const source=readFileSync(new URL('../js/game.js',import.meta.url),'utf8'),el={innerHTML:''};let posts=0;
const context=vm.createContext({S:{robots:[{type:'mule'},{type:'rust'}],items:{'shard:glacier':need}},CONST,ROBOT_TYPES,bagView,
 net:{state:{online:true,accountId:1},shop:async()=>{posts++;}},_shopPending:false,cur:'gacha',
 $:()=>el,shopTabs:()=>'',fmt:String,esc:String,sprite:()=>'',robRarTag:()=>'',icon:()=>'',toast(){}});
for(const name of ['renderBag','shopAssemble']){
 const start=source.indexOf(`async function ${name}(`),end=source.indexOf('\n}',start)+2;
 assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),context);
}
await context.renderBag();assert.match(el.innerHTML,/disabled[^>]*onclick="ROWAR.shopAssemble\('glacier'\)">계보 조건 필요/);
assert.ok(el.innerHTML.includes('조립 가능 <b>0기</b>'));assert.ok(el.innerHTML.includes('개발 계보 보기'));
assert.ok(el.innerHTML.includes('조각은 보관됩니다.'));await context.shopAssemble('glacier');assert.equal(posts,0);
db.close();
console.log('Activation passed: switches on; equipped-only binding; source/other-robot presets retained; repeat conversion; real state; bound equip rejection without charge; per-robot save; first-equip binding; locked assembly retains shards/currency; eligible assembly succeeds.');
