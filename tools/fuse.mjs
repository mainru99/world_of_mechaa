/* 합성 규칙 자가 점검.

   합성은 **되돌릴 수 없다** — 파츠 셋이 사라지고 하나가 남는다. 그래서 규칙이
   조용히 어긋나면 플레이어의 물건이 사라진다. 여기서 규칙만 따로 돌려 본다.

   node tools/fuse.mjs */
import { CONST, RARITY, PART_BASES } from '../data/balance.js';
import { fuseCheck, fusePart, fuseCost, fuseUpRate, nextRarity, BASES_BY_SLOT } from '../js/gacha.js';

const F = CONST.FUSE || {};
const NEED = F.need || 3;
let bad = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) bad++; };

const mk = (uid, slot, rarity, base, lv = 40) => ({ uid, slot, rarity, base, lv, affixes: [], seed: 1, enh: 0 });
let sd = 12345;
const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };

console.log('== ① 수치 ==');
{
  ok(NEED >= 2, `재료 ${NEED}개`);
  for (const r of RARITY) {
    const up = fuseUpRate(r.k), c = fuseCost(r.k);
    console.log(`  ${r.k.padEnd(3)} 등급상승 ${(up * 100).toFixed(0)}% · 스크랩 ${c}`);
    ok(up >= 0 && up <= 1, `${r.k} 상승 확률이 0~1`);
    ok(c >= 0, `${r.k} 비용이 음수가 아니다`);
  }
  /* 마지막 등급은 더 오를 곳이 없다. 확률을 남겨 두면 '올랐다' 는 결과가 나오는데
     등급은 그대로라 플레이어에게 거짓말이 된다. */
  const last = RARITY[RARITY.length - 1].k;
  ok(fuseUpRate(last) === 0, `${last} 는 상승 확률이 0 (더 오를 등급이 없다)`);
  ok(nextRarity(last) === last, `${last} 의 다음 등급은 자기 자신`);
}

console.log('\n== ② 재료 검사 — 안 되는 것은 안 돼야 한다 ==');
{
  const three = [mk('a', 'WEAPON', 'R', 'railgun'), mk('b', 'WEAPON', 'R', 'vulcan'), mk('c', 'WEAPON', 'R', 'breaker')];
  ok(fuseCheck(three) === null, '같은 칸·같은 등급 셋 → 통과');
  ok(fuseCheck(three.slice(0, 2)) !== null, `${NEED}개가 아니면 거절`);
  ok(fuseCheck([three[0], three[0], three[1]]) !== null, '같은 파츠를 두 번 고르면 거절');
  ok(fuseCheck([three[0], three[1], mk('d', 'CORE', 'R', 'reactor')]) !== null, '칸이 다르면 거절');
  ok(fuseCheck([three[0], three[1], mk('d', 'WEAPON', 'SR', 'breaker')]) !== null, '등급이 다르면 거절');
}

console.log('\n== ③ 같은 베이스 셋이면 그 베이스가 확정으로 나온다 ==');
{
  const same = ['a', 'b', 'c'].map(u => mk(u, 'WEAPON', 'R', 'railgun'));
  let allRailgun = true, n = 0;
  for (let i = 0; i < 400; i++) {
    const o = fusePart(same, rnd, 'x' + i);
    if (o.error) { allRailgun = false; break; }
    if (o.part.base !== 'railgun') allRailgun = false;
    if (!o.guaranteed) allRailgun = false;
    n++;
  }
  ok(allRailgun && n === 400, `레일건 셋 → 400/400 레일건 (guaranteed 표시도 함께)`);
}

console.log('\n== ④ 섞여 있으면 재료 셋 중에서만 나온다 ==');
{
  const mats = [mk('a', 'WEAPON', 'R', 'railgun'), mk('b', 'WEAPON', 'R', 'vulcan'), mk('c', 'WEAPON', 'R', 'breaker')];
  const want = new Set(['railgun', 'vulcan', 'breaker']);
  const seen = {}; let outside = 0;
  for (let i = 0; i < 3000; i++) {
    const o = fusePart(mats, rnd, 'x' + i);
    if (!want.has(o.part.base)) outside++;
    seen[o.part.base] = (seen[o.part.base] || 0) + 1;
    if (o.guaranteed) outside++;                 // 섞였는데 확정이라고 하면 안 된다
  }
  ok(outside === 0, '재료 밖의 베이스가 나오지 않는다');
  ok(Object.keys(seen).length === 3, `셋 다 나온다 — ${Object.entries(seen).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
}

console.log('\n== ⑤ 등급 상승 실측 ==');
{
  for (const r of ['C', 'R', 'SR', 'SSR']) {
    const mats = ['a', 'b', 'c'].map(u => mk(u, 'WEAPON', r, 'railgun'));
    let up = 0, wrong = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const o = fusePart(mats, rnd, 'x' + i);
      if (o.up) up++;
      /* up 이라고 했으면 등급이 실제로 올라 있어야 한다 */
      const expect = o.up ? nextRarity(r) : r;
      if (o.part.rarity !== expect) wrong++;
    }
    const got = up / N, want = fuseUpRate(r);
    const near = Math.abs(got - want) < 0.015;
    console.log(`  ${r.padEnd(3)} 실측 ${(got * 100).toFixed(1)}% (설정 ${(want * 100).toFixed(0)}%)`);
    ok(near, `${r} 확률이 설정과 맞는다`);
    ok(wrong === 0, `${r} up 표시와 실제 등급이 일치`);
  }
}

console.log('\n== ⑥ 결과가 온전한 파츠인가 ==');
{
  const mats = ['a', 'b', 'c'].map((u, i) => mk(u, 'BOOSTER', 'SR', BASES_BY_SLOT.BOOSTER[i]));
  let bad2 = 0;
  for (let i = 0; i < 2000; i++) {
    const p = fusePart(mats, rnd, 'x' + i).part;
    if (p.slot !== 'BOOSTER') bad2++;
    if (!PART_BASES[p.base] || PART_BASES[p.base].slot !== 'BOOSTER') bad2++;
    if (!Array.isArray(p.affixes)) bad2++;
    if (!(p.seed >= 0)) bad2++;
    if (p.enh !== 0) bad2++;
    if (p.lv !== 40) bad2++;
  }
  ok(bad2 === 0, '칸·베이스·인챈트·씨앗·강화·레벨이 전부 온전하다');
  /* 재료 레벨이 섞이면 가장 높은 것을 따라간다 — 낮은 것을 따라가면 합성이 손해가 된다 */
  const mixed = [mk('a', 'CORE', 'R', 'reactor', 12), mk('b', 'CORE', 'R', 'reactor', 55), mk('c', 'CORE', 'R', 'reactor', 30)];
  ok(fusePart(mixed, rnd, 'z').part.lv === 55, '레벨은 재료 중 가장 높은 것을 따른다');
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
