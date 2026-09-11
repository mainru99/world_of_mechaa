/* 파츠 세트(CONST.PART_SET)를 재는 도구.

   성공 조건은 하나다 — **세트가 수치를 이기면 안 된다.**
   좋은 파츠를 버리고 세트를 맞추는 것이 늘 정답이면, 선택이 하나 생긴 것이 아니라
   정답이 하나 바뀐 것뿐이다. ③이 그것을 직접 판정한다.

   세트 효과만 떼어 보려면 '수치는 같고 계열만 다른 파츠' 가 필요하다.
   예전에는 같은 파츠를 굴려 **이름만 바꿔서** 만들었다. 6단계부터는 그게 불가능하다 —
   계열을 `PART_BASES[...].set` 이 정하고, 그 베이스가 스탯도 정하기 때문이다.
   베이스를 바꾸면 계열과 수치가 같이 바뀐다.

   그래서 방법을 바꿨다. **같은 파츠를 두 벌 쓰되 한쪽만 세트 효과를 켠다**
   (`CONST.PART_SET` 의 p2·p4 를 잠시 끈다). 파츠도 씨앗도 같으므로 승률 차이가
   정확히 세트 효과다 — 예전 방법보다 오히려 깨끗하다.

   판수는 명령줄에서: node tools/set.mjs 3000 */
import { ROBOT_TYPES, RARITY, SLOTS, PART_BASES, CONST } from '../data/balance.js';
import { computeStats, setCounts, setKeyOf, setKeyByName } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
import { rollPart } from '../js/gacha.js';
import { pct, pm, argN } from './stat.mjs';

const N=argN(1500);
const LV=30;
const KEYS=Object.keys(CONST.PART_SET||{});
if(!KEYS.length){ console.log('CONST.PART_SET 이 없습니다.'); process.exit(0); }

const T=Object.keys(ROBOT_TYPES);
let S=23; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const rnd=()=>{ let x=ns(); return x/4294967296; };
const rb=(t,slots)=>({uid:'x',type:t,level:LV,exp:0,fat:0,slots});

/* 계열별·슬롯별 베이스와, 어느 계열에도 안 들어간 베이스(대조군).
   PART_BASES 에서 유도하므로 베이스를 늘리거나 계열 배정을 바꿔도 여기는 안 고친다. */
const SET_BASE={}, PLAIN_BASE={};
for(const slot of SLOTS){
  for(const [id,b] of Object.entries(PART_BASES)){
    if(b.slot!==slot) continue;
    if(b.set){ (SET_BASE[b.set]=SET_BASE[b.set]||{})[slot]=id; }
    else if(!PLAIN_BASE[slot]) PLAIN_BASE[slot]=id;
  }
}

/* 세트 효과를 잠시 끄고 fn 을 부른다. setActive 는 p2·p4 가 없으면 그 단계를
   건너뛰므로 null 로 충분하다. 반드시 되돌린다 — 뒤의 측정이 전부 틀어진다. */
function withSetOff(fn){
  const saved={};
  for(const k of KEYS){ saved[k]=[CONST.PART_SET[k].p2, CONST.PART_SET[k].p4];
                        CONST.PART_SET[k].p2=null; CONST.PART_SET[k].p4=null; }
  try { return fn(); }
  finally { for(const k of KEYS){ CONST.PART_SET[k].p2=saved[k][0]; CONST.PART_SET[k].p4=saved[k][1]; } }
}

/* 네 칸을 같은 등급으로 채운다. setKey 를 주면 베이스를 그 계열의 것으로 바꾼다.
   pieces 를 주면 그 개수만큼만 계열로 하고 나머지는 무계열 베이스다.
   name 도 같이 맞춘다 — 옛 파츠 경로와 대조할 때 쓰이고, 화면에도 이 이름이 나간다. */
function loadout(rar, setKey, pieces){
  const parts=[], slots={};
  const n=pieces==null?4:pieces;
  SLOTS.forEach((slot,i)=>{
    const p=rollPart(LV, rnd, 's'+slot, rar, slot);
    const base=(setKey && i<n) ? SET_BASE[setKey][slot] : PLAIN_BASE[slot];
    p.base=base; p.name=PART_BASES[base].ko;
    parts.push(p); slots[slot]=p.uid;
  });
  return { parts, slots };
}

/* 거울 대결. 양쪽 다 같은 등급 파츠를 새로 굴린다 — 세트 말고는 기댓값이 같다 */
function duel(type, mine, theirs, n){
  let k=0;
  for(let i=0;i<n;i++){
    const A=loadout(mine.rar, mine.set, mine.pieces);
    const B=loadout(theirs.rar, theirs.set, theirs.pieces);
    const sa=computeStats(rb(type,A.slots), A.parts);
    const sb=computeStats(rb(type,B.slots), B.parts);
    const ev=simulate(makeUnit('P',type,sa), makeUnit('E',type,sb), ns());
    if(ev[ev.length-1].winner==='P') k++;
  }
  return k;
}
function all(mine, theirs){
  let k=0,n=0;
  for(const t of T){ k+=duel(t,mine,theirs,N); n+=N; }
  return {k,n};
}

console.log(`파츠 세트 측정 · Lv.${LV} 거울 대결 · 한 칸 ${N*T.length}판\n`);

/* ── ⓪ 두 판정이 같은 답을 내나 ──────────────────────────────────
   계열은 이제 base 가 정하지만(6단계), 옛 파츠는 아직 이름으로 찾는다.
   두 표가 어긋나면 같은 물건인데 옛 파츠와 새 파츠가 다른 계열이 된다.
   7단계 마이그레이션이 끝나 옛 파츠가 사라질 때까지 여기서 지킨다. */
console.log('== ⓪ base 판정과 옛 이름 판정이 일치하나 ==');
{
  let bad=0;
  for(const [id,b] of Object.entries(PART_BASES)){
    const byBase=setKeyOf({ base:id, slot:b.slot, name:b.ko });
    const byName=setKeyByName(b.slot, b.ko);
    if(byBase!==byName){ console.log(`  ✗ ${id} (${b.ko}) base=${byBase} 이름=${byName}`); bad++; }
  }
  /* 이름 표에만 있고 베이스에 없는 것도 잡는다 — 한글 이름을 고치면 여기 걸린다 */
  for(const k of KEYS) for(const slot in CONST.PART_SET[k].names){
    const ko=CONST.PART_SET[k].names[slot];
    if(!Object.values(PART_BASES).some(b=>b.slot===slot&&b.ko===ko)){
      console.log(`  ✗ PART_SET.${k}.${slot} '${ko}' 에 맞는 베이스가 없다`); bad++; }
  }
  console.log(bad ? `  ✗ ${bad}건 어긋남` : `  ✓ 베이스 ${Object.keys(PART_BASES).length}종에서 두 판정이 같다`);
  if(bad) process.exitCode=1;
}

/* ── ① 세트가 얼마나 세나 (같은 파츠, 효과만 켜고 끄고) ─────────────
   양쪽이 **완전히 같은 파츠**다. 한쪽만 세트 효과를 켜므로 차이가 곧 효과다.

   예전처럼 '세트 vs 무계열' 로 재면 안 된다. 베이스가 계열과 수치를 같이 정하므로
   무계열 쪽은 다른 물건이 되고, 승률 차이에 베이스 차이가 섞인다.
   실제로 그렇게 재 보니 강습 2세트가 등급에 따라 54.9%~60.5% 로 흔들렸다 —
   spd ×1.012 짜리 효과가 낼 수 있는 폭이 아니다. */
console.log('\n== ① 같은 파츠에서 세트 효과만 켰을 때 ==');
console.log('등급\t' + KEYS.map(k=>CONST.PART_SET[k].ko+' 2세트').join('\t') + '\t' + KEYS.map(k=>CONST.PART_SET[k].ko+' 4세트').join('\t'));
function setGain(rar, key, pieces){
  let k=0,n=0;
  for(const t of T){
    for(let i=0;i<N;i++){
      const A=loadout(rar, key, pieces), seed=ns();
      const on  = computeStats(rb(t,A.slots), A.parts);
      const off = withSetOff(()=>computeStats(rb(t,A.slots), A.parts));
      const ev=simulate(makeUnit('P',t,on), makeUnit('E',t,off), seed);
      if(ev[ev.length-1].winner==='P') k++;
      n++;
    }
  }
  return {k,n};
}
for(const r of RARITY.map(x=>x.k)){
  const row=[];
  for(const k of KEYS) row.push(pm(...Object.values(setGain(r,k,2))));
  for(const k of KEYS) row.push(pm(...Object.values(setGain(r,k,4))));
  console.log(r+'\t'+row.join('\t'));
}

/* ── ② 우연히 걸릴 확률 ─────────────────────────────────────────
   이름은 균등하게 뽑힌다. 2세트가 저절로 걸리는 일이 흔하면 '모으는 재미'가 없고,
   너무 드물면 아무도 4세트를 못 본다. */
console.log('\n== ② 아무렇게나 낀 네 칸에 세트가 걸릴 확률 ==');
{
  const trials=200000; let two=0, four=0;
  for(let i=0;i<trials;i++){
    const parts=[], slots={};
    for(const slot of SLOTS){ const p=rollPart(LV,rnd,'r'+slot,'C',slot); parts.push(p); slots[slot]=p.uid; }
    const c=setCounts({slots}, parts), m=Math.max(0,...Object.values(c));
    if(m>=2) two++; if(m>=4) four++;
  }
  console.log(`  2세트 이상 ${(two/trials*100).toFixed(1)}% · 4세트 ${(four/trials*100).toFixed(3)}%`);
  console.log('  (4세트를 보려면 네 칸을 일부러 맞춰야 한다 — 그래서 만렙 뒤의 목표가 된다)');
}

/* ── ③ 세트가 수치를 이기나 ────────────────────────────────────
   **이 게임의 답이 바뀌는지**를 보는 자리다. 낮은 등급으로 세트를 맞춘 쪽이
   한 등급 위의 무계열을 이기면 안 된다 — 그러면 좋은 파츠를 줍는 의미가 없어진다. */
console.log('\n== ③ 세트가 수치를 이기나 (아래 등급 4세트 vs 위 등급 무계열) ==');
const order=RARITY.map(x=>x.k);
let broke=0;
for(let i=0;i<order.length-1;i++){
  const lo=order[i], hi=order[i+1];
  for(const k of KEYS){
    const r=all({rar:lo,set:k,pieces:4},{rar:hi,set:null});
    const w=r.k/r.n;
    const bad=w>0.5;
    if(bad) broke++;
    console.log(`  ${CONST.PART_SET[k].ko} ${lo} 4세트 vs ${hi} 무계열\t${pct(r.k,r.n)}${bad?'\t← 세트가 이겼다':''}`);
  }
}
console.log(broke ? `\n  ✗ ${broke}건에서 세트가 등급을 이겼다. 좋은 파츠를 주울 이유가 사라진다.`
                  : '\n  ✓ 세트로는 등급을 못 이긴다. 세트는 덤이지 지름길이 아니다.');
