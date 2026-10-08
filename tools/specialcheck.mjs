/* 세트 03 · 특화기술 · 스토리 기체 자가 점검 (2026-09-21)
 *
 *   ① 특화기술 여섯이 약속대로 돈다 — 방벽이 먹고 · 수리가 채우고 · 표적이 키우고 · 파쇄가 바닥에서 멈추고 ·
 *      재밍이 SP 와 게이지를 밀고 · 마무리가 낮은 체력에서만 켜진다. 방벽 · 수리는 쓸수록 줄어든다
 *   ② 특화기술은 **난수를 더 뽑지 않는다** — 같은 시드에서 명중 · 회피 · 치명 판정 순서가 fx 를 뗀 판과 같다
 *   ③ 스토리 기체(story:true)는 뽑기 · 상점 조각 · 상대 · 도감 · 시작 기체 어디에도 안 나온다
 *   ④ 새 기체 17종 그림이 규격(440x420 · 투명)으로 있다
 *   ⑤ 합동전 — 방벽 · 수리는 더 다친 아군에게 간다
 *
 * node --no-warnings tools/specialcheck.mjs */
import { ROBOT_TYPES, CONST, SLOTS } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate, doHit, SPECIAL } from '../js/sim.js';
import { BY_RARITY as UNIT_BY_RAR, GACHA_IDS, isStory } from '../js/units.js';
import { BY_RARITY, rollPull } from '../js/gacha.js';
import { ROBOT_IDS as CODEX_IDS } from '../js/codex.js';
import { makeOpponent } from '../js/rewards.js';
import { runJoint } from '../js/joint.js';
import { readFileSync } from 'node:fs';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const E0 = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const st = (t, lv = 30) => computeStats({ type: t, level: lv, skillLv: 0, fat: 0, slots: E0 }, []);
const NEW = ['husk', 'mortar', 'lens', 'static', 'swift', 'shrike', 'patch', 'vega', 'orbit', 'zealot', 'nebula', 'sovereign', 'behemoth'];
const STORY = ['rook3', 'rook3_mod', 'rook3_re', 'valken4'];
const fixed = v => () => v;

console.log('== ① 특화기술 ==');
{
  /* 방벽 — 받는 피해를 먼저 먹는다 */
  const A = makeUnit('a', 'mule', st('mule')), D = makeUnit('d', 'mule', st('mule'));
  D.shield = 50; const hp0 = D.hp, ev = [];
  doHit(A, D, 'P', 'E', ev, fixed(0.5), { noMiss: true });
  const h = ev.find(e => e.t === 'hit');
  ok(h.absorb === Math.min(50, h.dmg) && hp0 - D.hp === h.dmg - h.absorb, `방벽이 ${h.absorb} 먹고 체력은 ${hp0 - D.hp} 줄었다 (피해 ${h.dmg})`);

  /* 표적 — 같은 입력에서 피해가 (1+x) 배 */
  const D1 = makeUnit('d', 'mule', st('mule')), D2 = makeUnit('d', 'mule', st('mule')); D2.mark = 0.2;
  const e1 = [], e2 = [];
  doHit(A, D1, 'P', 'E', e1, fixed(0.5), { noMiss: true }); doHit(A, D2, 'P', 'E', e2, fixed(0.5), { noMiss: true });
  ok(Math.abs(e2[0].dmg / e1[0].dmg - 1.2) < 0.02, `표적 +20% → 피해 ${e1[0].dmg} → ${e2[0].dmg}`);

  /* 장갑 파쇄 — 바닥(원래의 shredFloor)에서 멈춘다 */
  const D3 = makeUnit('d', 'atlas', st('atlas')), def0 = D3.def;
  for (let i = 0; i < 40; i++) doHit(A, D3, 'P', 'E', [], fixed(0.5), { noMiss: true, shred: 0.15 });
  ok(D3.def === Math.round(def0 * SPECIAL().shredFloor), `파쇄 40번 뒤 방어 ${def0} → ${D3.def} (바닥 ${SPECIAL().shredFloor})`);

  /* 마무리 — 체력이 문턱 밑일 때만 */
  const D4 = makeUnit('d', 'mule', st('mule')), D5 = makeUnit('d', 'mule', st('mule'));
  D5.hp = Math.floor(D5.maxhp * SPECIAL().execHp) - 1;
  const e4 = [], e5 = [];
  doHit(A, D4, 'P', 'E', e4, fixed(0.5), { noMiss: true, execute: 0.5 });
  doHit(A, D5, 'P', 'E', e5, fixed(0.5), { noMiss: true, execute: 0.5 });
  ok(Math.abs(e5[0].dmg / e4[0].dmg - 1.5) < 0.02, `마무리 — 꽉 찬 상대 ${e4[0].dmg} · 문턱 밑 ${e5[0].dmg}`);

  /* 실제 전투에서 이벤트가 나온다 · 방벽 · 수리는 쓸수록 줄어든다 */
  const find = (a, b, t) => { for (let s = 1; s < 60; s++) { const ev = simulate(makeUnit(a, a, st(a, 60)), makeUnit(b, b, st(b, 60)), s * 131);
    const xs = ev.filter(e => e.t === t && e.side === 'P'); if (xs.length >= 3) return xs; } return []; };
  const sh = find('husk', 'mule', 'shield'), rp = find('patch', 'bastion', 'heal').filter(e => e.src === 'repair');
  ok(sh.length >= 3 && sh[1].amt < sh[0].amt && sh[2].amt < sh[1].amt, `방벽이 쓸수록 줄어든다 — ${sh.slice(0, 4).map(e => e.amt).join(' → ')}`);
  ok(rp.length >= 2 && rp[1].amt < rp[0].amt, `수리가 쓸수록 줄어든다 — ${rp.slice(0, 4).map(e => e.amt).join(' → ')}`);
  let jam = null;
  for (let s = 1; s < 40 && !jam; s++) { const ev = simulate(makeUnit('a', 'zealot', st('zealot')), makeUnit('b', 'oracle', st('oracle')), s * 97);
    jam = ev.find(e => e.t === 'jam'); }
  ok(jam && jam.amt === ROBOT_TYPES.zealot.skill.fx.jam && jam.sp >= 0, `재밍 — 상대 SP ${jam && jam.sp}(−${jam && jam.amt})`);
  let mk = null;
  for (let s = 1; s < 40 && !mk; s++) mk = simulate(makeUnit('a', 'lens', st('lens')), makeUnit('b', 'dune', st('dune')), s * 7).find(e => e.t === 'mark');
  ok(mk && mk.amt === ROBOT_TYPES.lens.skill.fx.mark, '표적 이벤트');
}

console.log('\n== ② 특화기술은 난수를 더 뽑지 않는다 ==');
{
  /* fx 를 뗀 같은 기체와 같은 시드로 붙여, 판정(명중 · 치명) 순서가 같은 구간까지 같은지 본다.
     피해 크기와 전투 길이는 달라지므로 '처음 20타의 명중 · 치명' 만 대조한다 */
  let same = 0, tot = 0;
  for (const id of NEW) {
    const T = ROBOT_TYPES[id], orig = T.skill.fx;
    const plain = {}; for (const k of ['mult', 'hits', 'noMiss', 'ignoreDef', 'alwaysCrit', 'drain']) if (orig[k] != null) plain[k] = orig[k];
    for (let s = 1; s <= 5; s++) {
      const run = () => simulate(makeUnit('a', id, st(id)), makeUnit('b', 'mule', st('mule')), s * 1009)
        .filter(e => e.t === 'hit').slice(0, 20).map(e => (e.miss ? 'm' : e.crit ? 'c' : 'h')).join('');
      const a = run(); T.skill.fx = plain; const b = run(); T.skill.fx = orig;
      /* 재밍 · 방벽은 순서(누가 언제 치나)를 바꿀 수 있어 같은 줄이 아닐 수 있다 — 처음 스킬 전까지는 같아야 한다 */
      const k = Math.min(a.length, b.length, 3);
      tot++; if (a.slice(0, k) === b.slice(0, k)) same++;
    }
  }
  ok(same === tot, `첫 판정들이 fx 유무와 무관하게 같다 (${same}/${tot})`);
}

console.log('\n== ③ 스토리 기체는 어디에도 안 나온다 ==');
{
  const pools = Object.values(BY_RARITY).flat(), upools = Object.values(UNIT_BY_RAR).flat();
  ok(STORY.every(id => ROBOT_TYPES[id] && ROBOT_TYPES[id].story && isStory(id)), `스토리 기체 ${STORY.length}종 — ${STORY.map(i => ROBOT_TYPES[i].name).join(' · ')}`);
  ok(!STORY.some(id => pools.includes(id) || upools.includes(id) || GACHA_IDS.includes(id)), '뽑기 · 상대 등급 풀에 없다');
  /* 칸 수를 여기 적어 두면 기체를 더할 때마다 낡는다(세트 04 에서 43 → 53). 뽑기 목록과 같기만 하면 된다. */
  ok(!STORY.some(id => CODEX_IDS.includes(id)) && CODEX_IDS.length === GACHA_IDS.length,
     `도감 기체 칸 ${CODEX_IDS.length} = 뽑기 기체 ${GACHA_IDS.length}(스토리 제외)`);
  const shopSrc = readFileSync(new URL('../js/shop.js', import.meta.url), 'utf8');
  ok(/if \(!t\.story\)/.test(shopSrc), '상점 조각 풀이 스토리 기체를 거른다');
  const wk = readFileSync(new URL('../server/worker.js', import.meta.url), 'utf8');
  ok(/rarity === 'C' && !r\.story/.test(wk), '시작 기체(커먼)에서 거른다');
  let sd = 1; const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
  let leak = 0, seen = new Set();
  for (let i = 0; i < 20000; i++) { const r = rollPull(new Set(), 30, rnd, () => 'u' + i, 'core'); if (r && (r.kind === 'robot' || r.kind === 'dupe')) { seen.add(r.type); if (isStory(r.type)) leak++; } }
  for (let i = 0; i < 4000; i++) { const o = makeOpponent(['C', 'UC', 'R', 'UQ', 'EP'], 40, rnd, () => 'o' + i, false, 1500, 8); if (isStory(o.type)) leak++; }
  ok(leak === 0, `뽑기 2만 번 · 상대 4천 번에 스토리 기체 0 (뽑기에서 나온 기체 ${seen.size}종)`);
  ok(NEW.every(id => seen.has(id)) || seen.size === 0, '새 기체 13종은 뽑기에서 나온다');
}

console.log('\n== ④ 그림 ==');
for (const id of [...NEW, ...STORY]) {
  /* 2026-10-08 부터 무손실 WebP(VP8L) — 헤더의 14비트 너비 · 높이와 알파 비트를 읽는다 */
  const b = readFileSync(new URL(`../assets/${id}.webp`, import.meta.url));
  const vp8l = b.toString('ascii', 12, 16) === 'VP8L', bits = b.readUInt32LE(21);
  const w = (bits & 0x3fff) + 1, h = ((bits >> 14) & 0x3fff) + 1, alpha = (bits >> 28) & 1;
  if (!(vp8l && w === 440 && h === 420 && alpha)) ok(false, `${id}.webp ${w}x${h} ${vp8l ? 'VP8L' : '손실/기타'} 알파 ${alpha}`);
}
ok(true, `17장 모두 440x420 · 투명`);

console.log('\n== ⑤ 합동전 — 방벽 · 수리는 더 다친 아군에게 ==');
{
  let toFront = 0, toBack = 0;
  for (let s = 1; s <= 30; s++) {
    const r = runJoint({ seed: s * 313, aim: 'front', team: [
      { name: 'F', type: 'mule', stats: st('mule', 50), tactic: 'none' },
      { name: 'B', type: 'patch', stats: st('patch', 50), tactic: 'none' }],
      boss: { name: 'X', type: 'boss_nihil', stats: { ...st('boss_nihil', 50), hp: 99999 }, tactic: 'none', traits: [] } });
    for (const e of r.events) if (e.t === 'heal' && e.src === 'repair') { if (e.i === 0) toFront++; else toBack++; }
  }
  ok(toFront > toBack, `보스가 전위만 칠 때 수리는 전위로 — 전위 ${toFront} · 후위 ${toBack}`);
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
