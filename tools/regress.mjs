/* 시뮬을 고친 뒤, **예전 전투가 그대로 재현되는지** 확인한다.

   이 게임은 서버가 시드로 판정하고 클라가 같은 시드로 재생한다. 그래서 sim.js 가
   조금이라도 달라지면 아레나 방어 스냅샷·전투 기록·재생이 한꺼번에 어긋난다.
   기능을 더할 때는 '기본값에서는 한 글자도 달라지지 않는 것'이 조건이다.

   쓰는 법 — 비교할 옛 sim 을 js/ 아래에 두고(상대 import 가 풀려야 한다) 경로를 준다:

     git show <커밋>:js/sim.js > js/_sim_old.js
     node tools/regress.mjs ../js/_sim_old.js
     rm js/_sim_old.js

   판수는 두 번째 인자로: node tools/regress.mjs ../js/_sim_old.js 12 */
import { ROBOT_TYPES } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import * as NEW from '../js/sim.js';

const path = process.argv[2];
if (!path) { console.error('옛 sim 경로를 주세요. 예: node tools/regress.mjs ../js/_sim_old.js'); process.exit(1); }
const OLD = await import(path);
const SEEDS = Math.max(1, Number(process.argv[3]) || 6);

const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
const T=Object.keys(ROBOT_TYPES);
const ST={}; const st=t=>ST[t]||(ST[t]=computeStats(rb(t,30)));

let n=0, diff=0;
for(const a of T) for(const b of T){
  const sa=st(a), sb=st(b);
  for(let s=1;s<=SEEDS;s++){
    const seed=s*7919;
    const o=JSON.stringify(OLD.simulate(OLD.makeUnit('P',a,sa), OLD.makeUnit('E',b,sb), seed));
    const w=JSON.stringify(NEW.simulate(NEW.makeUnit('P',a,sa), NEW.makeUnit('E',b,sb), seed));
    n++;
    if(o!==w){ diff++; if(diff<=3) console.log(`다름 — ${a} vs ${b} · 시드 ${seed}`); }
  }
}
console.log(`전투 ${n}판 대조 · 이벤트가 다른 판 ${diff}건`);
console.log(diff ? '✗ 예전 전투가 재현되지 않는다. 스냅샷과 기록이 어긋난다.'
                 : '✓ 기본값에서는 예전과 완전히 같다.');
process.exit(diff ? 1 : 0);
