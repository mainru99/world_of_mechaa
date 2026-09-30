/* Real SQLite transactions with D1's result shape; synchronous batch execution
 * prevents another test request from interleaving within the transaction. */
export function sqliteD1(db,{beforeBatch,failAt}={}){
 const stmt=(sql,args=[])=>({sql,args,bind:(...a)=>stmt(sql,a),
  first:async()=>db.prepare(sql).get(...args)??null,
  all:async()=>({results:db.prepare(sql).all(...args)}),
  run:async()=>execute({sql,args})});
 const execute=s=>({meta:{changes:Number(db.prepare(s.sql).run(...s.args).changes)}});
 return {DB:{prepare:sql=>stmt(sql),batch:async list=>{
  await beforeBatch?.(list);
  db.exec('BEGIN');
  try{const results=list.map((s,i)=>{if(failAt?.(i))throw Error('injected batch failure');return execute(s);});db.exec('COMMIT');return results;}
  catch(e){db.exec('ROLLBACK');throw e;}
 }}};
}
