/* 점령전 난이도 실측 — node tools/terr.mjs [시행횟수]
 *
 * 칸마다 '어느 정도 기체 둘이면 뚫리는가'를 잰다. 지도는 절대 난이도라
 * (내 레벨에 맞춰 오지 않는다) 숫자를 눈으로 보지 않으면 잠긴 문을 만들기 쉽다.
 * 실제로 토벌 BOSS 가 한동안 승률 0% 짜리 잠긴 문이었다.
 *
 * 편성은 '그 등급의 대표 기체 둘 + 그 레벨대의 파츠'로 만든다. 사람이 실제로
 * 그 시점에 들고 있을 법한 것에 맞춘다.
 */
import { ROBOT_TYPES, TERRITORY, TERRAIN, CONST, SLOTS } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { genPart } from '../js/gacha.js';
import { mulberry32 } from '../js/sim.js';
import { applyTerrain, runBreach, maxRounds, rarAllowed } from '../js/breach.js';
import { monsterLine } from '../server/territory.js';

const N = parseInt(process.argv[2] || '400', 10);
const BY_RAR = {};
for (const k in ROBOT_TYPES) (BY_RAR[ROBOT_TYPES[k].rarity] ||= []).push(k);

/* 파츠 등급은 그 시점에 실제로 끼고 있을 법한 것으로. 초반엔 C, 후반엔 SR. */
const partRar = lv => lv < 12 ? 'C' : lv < 25 ? 'R' : lv < 40 ? 'SR' : 'SSR';

function mech(type, lv, seed) {
  const rnd = mulberry32(seed);
  const slots = {}, parts = [];
  for (const sl of SLOTS) {
    const p = genPart(lv, rnd, `t-${sl}-${seed}`, partRar(lv), sl);
    slots[sl] = p.uid; parts.push(p);
  }
  return { name: ROBOT_TYPES[type].name, type,
           stats: computeStats({ type, level: lv, fat: 0, slots }, parts) };
}

/* 한 칸에 '이 조합'으로 몇 %나 한 번에 뚫는가 (깎아 둔 것 없이 맨 처음부터) */
function rate(node, rar, lv, n) {
  const list = BY_RAR[rar] || BY_RAR.C;
  if (!rarAllowed(rar, node.maxRar)) return null;      // 편성 제한에 걸리는 조합
  const lines = node.mon.map((_, i) => monsterLine(node, i)).filter(Boolean);
  let win = 0, cleared = 0;
  for (let t = 0; t < n; t++) {
    const mechs = [mech(list[t % list.length], lv, 1e6 + t * 7),
                   mech(list[(t + 1) % list.length], lv, 2e6 + t * 13)]
      .map(m => ({ ...m, stats: applyTerrain(m.stats, node.terrain) }));
    const seeds = Array.from({ length: maxRounds(lines.length, 2) },
                             () => (Math.random() * 0xffffffff) >>> 0);
    const r = runBreach({ mechs, lines, seeds });
    if (r.win) win++;
    cleared += r.cleared;
  }
  return { win: win / n, cleared: cleared / n };
}

/* 칸마다 '이 정도 전력이면' 을 몇 단계로 훑는다 */
const STEPS = [
  ['C',  10], ['UC', 15], ['R',  22], ['R',  30],
  ['UQ', 34], ['UQ', 45], ['UQ', 60], ['EP', 45], ['EP', 60],
];

const pc = v => (v * 100).toFixed(0).padStart(3) + '%';
console.log(`시행 ${N}회 · 편성 2기 · 점령 확률 / 평균 돌파 겹수 (깎아 둔 것 없이 한 번에)\n`);
process.stdout.write('칸               등급 Lv  지형     선  ');
console.log(STEPS.map(([r, l]) => `${r}${l}`.padStart(9)).join(''));
console.log('-'.repeat(46 + STEPS.length * 9));

for (const node of [...TERRITORY].sort((a, b) => b.row - a.row || a.col - b.col)) {
  const cells = STEPS.map(([r, l]) => {
    const x = rate(node, r, l, N);
    return (x === null ? '   --' : (pc(x.win) + '/' + x.cleared.toFixed(1))).padStart(9);
  }).join('');
  console.log(
    (node.ko + ' '.repeat(14)).slice(0, 14) +
    (node.rar === 'BOSS' ? '보스' : node.rar).padEnd(5) +
    String(node.lv).padStart(3) + '  ' +
    (TERRAIN[node.terrain].ko + '    ').slice(0, 5) + '  ' +
    String(node.mon.length).padStart(2) + '  ' + cells);
}

console.log(`\n지형 보정은 양쪽 모두에 걸린다 · 편성 제한(--)은 그 등급으로 못 가는 칸`);
console.log(`전 칸 점령 시 수입: 시간당 크레딧 ${TERRITORY.reduce((s, n) => s + n.crH, 0)} · ` +
            `스크랩 ${TERRITORY.reduce((s, n) => s + n.scH, 0)} (${CONST.TERR.INCOME_CAP_H}시간 상한)`);
