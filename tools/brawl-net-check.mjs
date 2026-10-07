import assert from 'node:assert/strict';
const storage=new Map([['rowar.session','brawl-test-token'],['rowar.rev','1000']]);
globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
const calls=[];let response={ok:true,run:{rev:1,run:{gold:8}}},status=200,delay=null;
globalThis.fetch=async(path,opts)=>{calls.push({path,method:opts.method,body:opts.body&&JSON.parse(opts.body)});if(delay)await delay;return {ok:status>=200&&status<300,status,json:async()=>response};};
const net=await import('../js/net.js');net.state.online=true;net.state.accountId='test-a';
assert.equal((await net.brawl({action:'act',rev:0,actions:[{t:'lock'}]})).run.rev,1);assert.equal(storage.get('rowar.rev'),'1000');
assert.equal(calls[0].path,'/api/brawl');assert.equal(calls[0].method,'POST');assert.equal(calls[0].body.rev,0);
response={ok:true,on:true,run:null};await net.brawl();assert.equal(calls.at(-1).method,'GET');
await net.brawlRank();assert.equal(calls.at(-1).path,'/api/brawl/rank');
response={ok:false,error:'stale rev',rev:5,at:2};status=409;const stale=await net.brawl({action:'fight',rev:0});assert.equal(stale.status,409);assert.equal(stale.rev,5);assert.equal(stale.at,2);assert.equal(storage.get('rowar.rev'),'1000');
status=200;response={ok:true,run:{rev:999}};
for(const mutate of [()=>net.state.accountId='test-b',()=>storage.set('rowar.session','other-session')]){
 net.state.accountId='test-a';storage.set('rowar.session','brawl-test-token');let release;delay=new Promise(r=>release=r);const p=net.brawl({action:'fight',rev:4});mutate();release();assert.equal((await p).error,'account changed');delay=null;
}
net.state.online=false;const count=calls.length;assert.equal((await net.brawl({action:'start'})).error,'offline');assert.equal(calls.length,count);
assert.equal(storage.get('rowar.rev'),'1000');console.log('PASS · brawl transport GET/POST/rank, nested run rev, stale metadata, offline, late account/session isolation; player revision never changes');
