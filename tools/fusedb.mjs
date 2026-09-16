/* 서버 합성 액션을 가짜 env.DB 로 돌려 본다 — arenacheck 과 같은 방식.
   되돌릴 수 없는 작업이라 '무엇이 지워지고 무엇이 남는가' 를 직접 본다. */
import { hangarAction } from '../server/hangar.js';

function makeDB(state){
  const stmts=[];
  const run = (sql, args) => {
    if(/SELECT \* FROM part/.test(sql)) return state.parts.find(p=>p.account_id===args[0] && p.uid===args[1]) || null;
    if(/SELECT credits, cores, scrap/.test(sql)) return state.player;
    if(/SELECT s_weapon/.test(sql)) return { results: state.robots };
    if(/DELETE FROM part/.test(sql)) { state.parts = state.parts.filter(p=>p.id!==args[0]); return {}; }
    if(/INSERT INTO part/.test(sql)) { state.inserted.push(args); return {}; }
    if(/UPDATE player SET scrap/.test(sql)) { state.player.scrap = args[0]; state.player.rev = args[1]; return {}; }
    return null;
  };
  const D = {
    prepare(sql){ return { bind(...args){ return {
      first: async()=>run(sql,args), all: async()=>run(sql,args)||{results:[]}, run: async()=>run(sql,args), _sql:sql, _args:args }; } }; },
    batch: async list => { for(const st of list) await st.run(); return []; },
  };
  return D;
}
const P = (id,uid,slot,rar,base) => ({ id, uid, account_id:1, slot, rarity:rar, base, name:base,
  affixes:'[]', seed:1, lv:40, enh:0, stats:'{}' });

let fail=0;
const ok=(c,m)=>{ console.log((c?'  ✓ ':'  ✗ ')+m); if(!c) fail++; };

async function fuse(parts, robots, scrap, uids){
  const state={ parts:[...parts], robots, player:{credits:0,cores:0,scrap,rev:1}, inserted:[] };
  const env={DB:makeDB(state)};
  const r=await hangarAction(env,1,{action:'fuse',uids},Date.now());
  return {r,state};
}
const three=[P(1,'a','WEAPON','R','railgun'),P(2,'b','WEAPON','R','railgun'),P(3,'c','WEAPON','R','railgun')];
const none=[{s_weapon:null,s_frame:null,s_booster:null,s_core:null}];

console.log('== 서버 합성 ==');
{
  const {r,state}=await fuse(three,none,500,['a','b','c']);
  ok(r.ok===true, '성공');
  ok(state.parts.length===0, '재료 3개가 지워졌다');
  ok(state.inserted.length===1, '결과 1개가 들어갔다');
  ok(r.scrap===500-140, `스크랩 500 → ${r.scrap} (비용 140)`);
  ok(r.part && r.part.base==='railgun', '같은 베이스 셋 → 확정: '+r.part.base);
  ok(r.guaranteed===true, 'guaranteed 표시');
}
{
  const {r,state}=await fuse(three,none,100,['a','b','c']);
  ok(r.ok===false && r.error==='not enough scrap', '스크랩 부족이면 거절');
  ok(state.parts.length===3, '거절되면 아무것도 안 지운다');
}
{
  const worn=[{s_weapon:2,s_frame:null,s_booster:null,s_core:null}];
  const {r,state}=await fuse(three,worn,500,['a','b','c']);
  ok(r.ok===false && r.error==='part equipped', '끼고 있는 파츠는 거절');
  ok(state.parts.length===3, '거절되면 아무것도 안 지운다');
}
{
  const {r}=await fuse(three,none,500,['a','b','zzz']);
  ok(r.ok===false && r.error==='part not found', '없는 uid 는 거절');
}
{
  const {r}=await fuse(three,none,500,['a','b']);
  ok(r.ok===false, '개수가 모자라면 거절: '+r.error);
}
{
  const {r}=await fuse(three,none,500,['a','a','b']);
  ok(r.ok===false, '같은 파츠 중복이면 거절: '+r.error);
}
{
  const mixed=[P(1,'a','WEAPON','R','railgun'),P(2,'b','CORE','R','reactor'),P(3,'c','WEAPON','R','vulcan')];
  const {r}=await fuse(mixed,none,500,['a','b','c']);
  ok(r.ok===false, '칸이 섞이면 거절: '+r.error);
}
console.log(fail?`\n✗ ${fail}건 실패`:'\n전부 통과');
process.exitCode=fail?1:0;
