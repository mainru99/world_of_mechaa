// Disposable SQLite fixture for local UI QA. Never opens a file DB or remote API.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {CONST} from '../data/balance.js';
import {brawlView,brawlRank,brawlRun} from '../server/brawl.js';
export function createBrawlFixture(state){
 const original=CONST.BRAWL.on;CONST.BRAWL.on=true;
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
 const now=Date.now();db.prepare('INSERT INTO account(id,device_key,created_at,last_seen) VALUES(1,?,?,?)').run('brawl-ui-only',now,now);
 db.prepare('INSERT INTO player(account_id,nickname,credits,scrap,cores,level,updated_at) VALUES(1,?,?,?,?,?,?)').run('난투_검수',state.credits,state.scrap,state.cores,30,now);
 for(const [i,r] of state.robots.entries())db.prepare('INSERT INTO robot(id,account_id,type,level,uid,created_at) VALUES(?,1,?,?,?,?)').run(i+1,r.type,r.level,r.uid,now);
 const stmt=(sql,args=[])=>({bind:(...a)=>stmt(sql,a),first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}})});
 let chain=Promise.resolve();
 const env={DB:{prepare:sql=>stmt(sql),batch:list=>{const task=chain.catch(()=>{}).then(async()=>{db.exec('BEGIN');try{const out=[];for(const s of list)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}});chain=task;return task;}}};
 function snapshot(){const p=db.prepare('SELECT credits,cores,scrap,items,rcores,rev FROM player WHERE account_id=1').get();Object.assign(state,{credits:p.credits,cores:p.cores,scrap:p.scrap,items:JSON.parse(p.items||'{}')});return {state,items:state.items,rcores:p.rcores,rev:p.rev};}
 return {db,env,snapshot,close:()=>{db.close();CONST.BRAWL.on=original;},request:async(path,method='GET',body={})=>{const now=Date.now();if(path==='/api/brawl/rank')return brawlRank(env,1,now);if(method==='GET')return brawlView(env,1,now);const r=await brawlRun(env,1,now,body);snapshot();return r;}};
}
