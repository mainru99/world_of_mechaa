/* Disposable accounts in an isolated loopback Worker/D1; never remote. */
import assert from 'node:assert/strict';
const base=new URL(process.argv[2]||'http://127.0.0.1:8843');assert.equal(base.hostname,'127.0.0.1');assert.equal(base.protocol,'http:');assert.ok(base.port&&base.pathname==='/');
const nativeFetch=globalThis.fetch,storage=new Map();let count=0;
globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
globalThis.fetch=(url,opts)=>{count++;return nativeFetch(new URL(url,base),opts);};
const net=await import('../js/net.js'),good=r=>{assert.ok(r&&!r.error&&r.ok!==false,r?.error||'missing response');return r;};
const users=[];
for(let i=0;i<2;i++){
 storage.clear();good(await net.connect({create:true}));const login=`prep${Date.now()}${i}`;good(await net.register(login,'LocalQA8843!'));good(await net.pull());
 const robots=['ignis','mule'].map((type,i)=>({uid:`prep-unit-${i}`,type,level:30,exp:0,fat:0,fatAt:Date.now(),skillLv:3,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}}));
 good(await net.push({v:2,credits:250000,cores:128,scrap:50000,robots,parts:[],sel:0,squad:robots.map(r=>r.uid),stat:{wins:0,losses:0,pulls:0}}));
 good(await net.hangar('squad',{robotUids:robots.map(r=>r.uid)}));
 for(const [j,r]of robots.entries())good(await net.circuit('take',r.uid,j?['B1','B2','B3']:['A1','A2','A3']));
 const s=good(await net.pull());users.push({login,nickname:s.nickname,storage:new Map(storage)});good(await net.logout());
}
storage.clear();await net.connect({create:false});assert.equal(net.state.needGuest,true);good(await net.login(users[0].login,'LocalQA8843!'));good(await net.pull());
for(const pick of [0,1]){
 const f=good(await net.battleFind({mode:'duel',target:users[1].nickname,pick}));assert.equal(f.opponent.circuit.length,3);assert.equal(f.opponent.bench.length,1);assert.equal(f.opponent.bench[0].circuit.length,3);
 const r=good(await net.battleStart('none'));assert.deepEqual(f.opponent.stats,r.statE);assert.deepEqual(f.opponent.bench[0].stats,r.relay.statE2);
 const next=good(await net.battleStart('none'));assert.deepEqual(r.next.opponent.stats,next.statE);if(next.relay)assert.deepEqual(r.next.opponent.bench[0].stats,next.relay.statE2);
}
const f=good(await net.battleFind({mode:'hunt',tier:'BOSS'})),r=good(await net.battleStart('none'));assert.deepEqual(f.opponent.stats,r.boss.stats);
good(await net.refine(1));good(await net.circuit('reset','prep-unit-1'));good(await net.logout());good(await net.login(users[1].login,'LocalQA8843!'));
const resetPrep=good(await net.battleFind({mode:'duel',target:users[0].nickname,pick:1}));assert.deepEqual(resetPrep.opponent.circuit,[]);
assert.deepEqual(resetPrep.opponent.stats,good(await net.battleStart('none')).statE);
good(await net.logout());good(await net.login(users[0].login,'LocalQA8843!'));good(await net.circuit('take','prep-unit-1',['B1','B2','B3']));
console.log(`Preparation API passed: 2 accounts, both defence picks with circuits, reserve, find/next/start equality, joint boss; ${count} loopback HTTP requests.`);
console.log(`Local browser QA: ${users[0].login} / LocalQA8843! · duel target ${users[1].nickname}`);
