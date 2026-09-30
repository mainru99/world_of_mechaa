import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {CONST} from '../data/balance.js';
import {createLoadoutManager} from '../js/ui/loadout-manager.js';
import {bindingState,fuseBinding,loadoutSlots} from '../js/ui/loadout-model.js';
import {rollPart} from '../js/gacha.js';
import {insertPart} from '../server/parts.js';
import {hangarAction} from '../server/hangar.js';
import {loadState} from '../server/state.js';
import {guideSections} from '../js/ui/common.js';
const clone=x=>structuredClone(x),defer=()=>{let resolve;return {p:new Promise(r=>resolve=r),resolve};};
const slots=()=>({WEAPON:null,FRAME:null,BOOSTER:null,CORE:null});
const start=()=>({robots:[{uid:'A',type:'azure',level:20,slots:slots()},{uid:'B',type:'grit',level:20,slots:slots()}],parts:[{uid:'W',name:'무장',slot:'WEAPON',rarity:'R'}],presets:[],credits:123,cores:7,scrap:5000,sel:0,squad:['A']});
function harness(){
 let owner=start(),html='',robotUid='B',rcores=3;const calls=[];
 const doc={querySelector:s=>s==='#modal[open] .lu-app'&&html.includes('lu-app')?{}:null,getElementById:()=>null};
 const remote=()=>({state:clone(owner),presets:clone(owner.presets),bind:{on:false,unbind:1,parts:{}},rcores});
 const net={state:{accountId:1,online:true},growthState:async()=>remote(),hangar:async(a,b)=>{calls.push([a,b]);return {ok:true,applied:{WEAPON:'W'},emptied:['FRAME'],missing:[]};}};
 const manager=createLoadoutManager({document:doc,state:()=>owner,robot:()=>owner.robots.find(r=>r.uid===robotUid),net,openModal:h=>html=h,commit(){},toast:m=>calls.push(['toast',m]),balance:()=>rcores,setBalance:v=>rcores=v,onRemote:r=>rcores=r.rcores,partMarkup:p=>`<b>${p.name}</b>`});
 return {manager,A:manager.actions,net,calls,remote,get owner(){return owner;},get html(){return html;},get rcores(){return rcores;},robot:v=>robotUid=v,close:()=>html='',changeOwner:()=>owner=start()};
}
{
 const t=harness();await t.A.openSlot('WEAPON');assert.ok(t.html.includes('계정 공용'));
 t.robot('A');await t.A.equip('WEAPON','W');assert.equal(t.calls[0][1].robotUid,'B','modal captures inspected UID');assert.equal(t.owner.sel,0);
 await t.A.openPresets();t.net.hangar=async(a,b)=>{t.calls.push([a,b]);return {ok:true,presets:[{n:'saved',s:slots()}]};};
 t.A.loadoutName(0,'build');await t.A.savePreset(0);assert.equal(t.owner.presets[0].n,'saved');assert.ok(!t.html.includes('기체별 프리셋'));
 const before=t.calls.length;t.A.deletePreset(0);assert.equal(t.calls.length,before,'delete requires explicit confirmation');await t.A.confirmPreset();assert.equal(t.calls.at(-1)[1].robotUid,'A','delete always sends UID');
}
for(const change of ['close','account','owner','inspection']){
 const t=harness();await t.A.openSlot('WEAPON');const d=defer();t.net.hangar=(a,b)=>{t.calls.push([a,b]);return d.p;};
 const p=t.A.equip('WEAPON','W');await Promise.resolve();await Promise.resolve();await Promise.resolve();await t.A.equip('WEAPON','W');assert.equal(t.calls.length,1,'duplicate write blocked');
 if(change==='close')t.close();if(change==='account')t.net.state.accountId=2;if(change==='owner')t.changeOwner();if(change==='inspection')t.robot('A');
 d.resolve({ok:true});await p;
 assert.equal(t.owner.robots[1].slots.WEAPON,['account','owner'].includes(change)?null:'W');
 if(change==='close')assert.equal(t.html,'','completed write does not reopen a closed modal');
 if(change==='account'){await t.A.equip('WEAPON','W');assert.equal(t.calls.filter(c=>c[0]==='equip').length,1,'old session cannot mutate new account');}
 assert.equal(t.manager.busy(),false);
}
{
 const t=harness();await t.A.openSlot('WEAPON');t.net.growthState=async()=>({...t.remote(),bind:{on:true,unbind:1,parts:{W:'A'},presets:{}}});
 await t.A.equip('WEAPON','W');assert.equal(t.calls.length,0);assert.ok(t.html.includes('条件')||t.html.includes('조건이 바뀌'));
 await t.A.equip('WEAPON','W');assert.equal(t.calls.length,0);assert.ok(t.html.includes('귀속을 먼저'));
}
{
 const t=harness();await t.A.openSlot('WEAPON');t.net.growthState=async()=>null;await t.A.equip('WEAPON','W');assert.equal(t.calls.length,0);assert.ok(t.html.includes('요청하지 않았'));
}
{
 const t=harness();await t.A.openPresets();t.net.growthState=async()=>({...t.remote(),presets:[{n:'another device',s:slots()}]});
 await t.A.savePreset(0);assert.equal(t.calls.length,0,'preflight cannot overwrite an unseen changed preset');assert.ok(t.html.includes('조건이 바뀌'));
}
{
 const t=harness();t.net.growthState=async()=>({state:start()});await t.A.openPresets();await t.A.savePreset(0);assert.equal(t.calls.length,0,'unknown mode is not assumed to be account mode');
}
{
 const t=harness();t.manager.adopt({...t.remote(),bind:{on:true,unbind:1,parts:{W:'B',F:'A'},presets:{}}});
 assert.equal(t.manager.fuse(['W','F']).ok,false);t.manager.inherit({used:['W'],part:{uid:'result'}},['W']);assert.equal(t.manager.bound('result'),null,'POST does not confirm result binding');assert.equal(t.manager.bound('W'),null);
 t.net.growthState=async()=>({...t.remote(),bind:{on:true,unbind:1,parts:{result:'B'},presets:{}}});assert.equal(await t.manager.refreshBinding(),true);assert.equal(t.manager.bound('result'),'B');
 assert.deepEqual(bindingState({...t.remote(),bind:{on:false,parts:{W:'B'}}}).parts,{},'off mode ignores dormant binding rows');
 const help=guideSections({on:true,unbind:2}).find(x=>x.id==='parts').body;assert.ok(help.includes('기체마다 프리셋'));assert.ok(help.includes('정제 코어 <b>2개'));assert.ok(!help.includes('계정 공용'));
}
{
 const t=harness();await t.A.openSlot('WEAPON');let posts=0;t.net.hangar=async()=>{posts++;return null;};await t.A.equip('WEAPON','W');assert.equal(posts,1);assert.equal(t.owner.robots[1].slots.WEAPON,null);assert.ok(t.html.includes('확정 응답'));
}
{
 const t=harness(),d=defer();t.net.growthState=()=>d.p;const p=t.A.openSlot('WEAPON');t.owner.robots[1].slots.CORE='new-local';d.resolve(t.remote());await p;assert.equal(t.owner.robots[1].slots.CORE,'new-local');assert.ok(t.html.includes('확인하지 못'));
}
const old=CONST.PART_BIND.on;
// Run the UI controller against actual server actions and in-memory SQLite.
// Only this Node process toggles the constant; source/Worker/production stay off.
try{for(const on of [false,true]){
 CONST.PART_BIND.on=on;const db=new DatabaseSync(':memory:');db.exec(readFileSync('server/schema.sql','utf8'));
 const stmt=(sql,args=[])=>({bind:(...a)=>stmt(sql,a),first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}})});
 const env={DB:{prepare:s=>stmt(s),batch:async ss=>{db.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const now=Date.now();db.prepare('INSERT INTO account(id,device_key,created_at,last_seen) VALUES(1,?,?,?)').run('loadout-test',now,now);
 db.prepare('INSERT INTO player(account_id,nickname,updated_at,scrap,rcores) VALUES(1,?,?,5000,3)').run('TEST',now);
 for(const [i,uid,type] of [[1,'A','azure'],[2,'B','grit']])db.prepare('INSERT INTO robot(id,account_id,type,level,uid,created_at) VALUES(?,1,?,20,?,?)').run(i,type,uid,now);
 db.exec('UPDATE player SET sel_robot=1 WHERE account_id=1');
 for(const [uid,slot] of [['W','WEAPON'],['W2','WEAPON'],['F','FRAME']])await insertPart(env.DB,1,rollPart(20,()=>.5,uid,'R',slot),now,0).run();
 const t=harness();const read=()=>loadState(env,1);t.net.growthState=read;t.net.hangar=(action,args)=>{t.calls.push([action,args]);return hangarAction(env,1,{action,...args},Date.now());};
 await t.A.openSlot('WEAPON');await t.A.equip('WEAPON','W');assert.equal(t.owner.robots[1].slots.WEAPON,'W');assert.equal(t.manager.bound('W'),on?'B':null);
 await t.A.openPresets();t.A.loadoutName(0,'front build');await t.A.savePreset(0);
 const saved=await read();assert.equal(on?saved.bind.presets.B[0].n:saved.presets[0].n,'front build');assert.equal(t.owner.credits,123,'equipment read does not rewind wallet');assert.equal(t.owner.robots[1].level,20);
 t.robot('A');await t.A.openSlot('WEAPON');
 if(on){
  assert.ok(t.html.includes('GRIT 전용'));assert.ok(t.html.includes('lu-other'));
  const count=t.calls.length;await t.A.equip('WEAPON','W');assert.equal(t.calls.length,count,'blocked equip never sends POST');
  t.A.openUnbind('W');assert.ok(t.html.includes('현재 장착은 유지'));
  await t.A.confirmUnbind();assert.equal(t.rcores,2);assert.equal(t.manager.bound('W'),null);assert.equal(t.owner.robots[1].slots.WEAPON,'W');
  await t.A.confirmUnbind();assert.equal(t.rcores,2,'already unbound cannot be charged again');
  await t.A.openSlot('WEAPON');await t.A.equip('WEAPON','W');assert.equal(t.manager.bound('W'),'A');
  t.robot('B');await t.A.openSlot('WEAPON');await t.A.equip('WEAPON','W2');await t.A.openPresets();
  await t.A.applyPreset(0);assert.equal(t.owner.robots[1].slots.WEAPON,'W2','bound preset slot keeps currently equipped part');assert.ok(t.html.includes('다른 기체 전용: 무장 건너뜀'));assert.ok(!t.html.includes('없는 파츠: 무장'));
  assert.equal(fuseBinding(bindingState(await read()),['W','W2']).ok,false);
  assert.equal(loadoutSlots(t.manager.list('B')[0],t.owner,bindingState(await read()),'B')[0].status,'bound');
 }else{
  await t.A.equip('WEAPON','W');assert.equal(t.owner.robots[1].slots.WEAPON,null);assert.equal(t.owner.robots[0].slots.WEAPON,'W');
  await t.A.openPresets();assert.equal(t.manager.list('A')[0].n,'front build');await t.A.applyPreset(0);
 }
 db.close();
}}finally{CONST.PART_BIND.on=old;}
assert.equal(CONST.PART_BIND.on,false);assert.equal(CONST.LINEAGE.gate,false);
console.log('Loadout UI passed: actual SQLite off/on equip, unbind wallet/idempotency, per-UID/account presets, bound skip keeps gear, fuse conflict; preflight/mode changes, captured inspection, late account/state/close isolation, duplicate/failure safety; switches restored.');
