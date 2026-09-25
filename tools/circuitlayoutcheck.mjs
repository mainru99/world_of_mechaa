/* 코어 서킷 별자리 좌표 검사 — docs/art/circuit-constellations-2026-09-24.md §3-1.
 *
 *   node tools/circuitlayoutcheck.mjs [--all]
 *
 * 규칙은 js/circuitlayout.js 에 있다 — 편집기(tools/circuit-editor.html)와 같은 코드다. 편집기에서 통과하면 여기서도 통과한다.
 * 점 수 37 · 판 안(가장자리 24) · 별 간격(다른 갈래 22 · 같은 갈래 이웃 14) · 선 교차 없음 · ★ 둘레 이름 칸(90 x 20) · 기체끼리 서로 다름.
 * 안으로 휜 갈래는 경고만. --all 이면 통과한 기체도 적는다. 손으로 고친 기체(hand)는 '손' 으로 표시. 실패가 있으면 종료 코드 1.
 */
import { ROBOT_TYPES } from '../data/balance.js';
import { CIRCUIT_LAYOUT, CIRCUIT_LABEL_BOXES } from '../data/circuit_layout.js';
import { checkLayout, normShape, shapeDist, SAME_SHAPE } from '../js/circuitlayout.js';

const ALL = process.argv.includes('--all');
const ids = Object.keys(ROBOT_TYPES).filter(i => !ROBOT_TYPES[i].story && !ROBOT_TYPES[i].monster);

let fail = 0;
const missing = [], rows = [];
for (const t of ids) {
  const L = CIRCUIT_LAYOUT[t];
  if (!L) { missing.push(t); continue; }
  const r = checkLayout(L, (CIRCUIT_LABEL_BOXES || {})[t]);
  rows.push({ t, r, hand: !!L.hand, shape: normShape(L) });
}
let closest = [1e9];
for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
  const v = shapeDist(rows[i].shape, rows[j].shape); if (v < closest[0]) closest = [v, rows[i].t, rows[j].t];
}
for (const { t, r, hand } of rows) {
  const tag = `  ${t.padEnd(10)}${hand ? ' 손' : '   '}`;
  if (!r.ok) { fail++; console.log(`${tag} ${r.bad.join(' · ')}`); }
  else if (ALL) console.log(`${tag} 통과${r.warn.length ? ' · 경고 ' + r.warn.join(' · ') : ''}`);
}
const bad = rows.filter(x => !x.r.ok).length, warns = rows.filter(x => x.r.warn.length).length, hands = rows.filter(x => x.hand).length;
if (rows.length > 1 && closest[0] < SAME_SHAPE) { fail++; console.log(`  같은 모양 — ${closest[1]} · ${closest[2]}`); }
console.log(`\n기체 ${ids.length} · 좌표 있음 ${rows.length} · 통과 ${rows.length - bad} · 실패 ${bad}` +
            (hands ? ` · 손으로 고침 ${hands}` : '') + (warns ? ` · 경고 ${warns}(안으로 휜 갈래)` : '') +
            (missing.length ? ` · 좌표 없음 ${missing.length}(${missing.join(' ')})` : ''));
if (rows.length > 1) console.log(`가장 닮은 두 기체 — ${closest[1]} · ${closest[2]} (겹쳤을 때 점마다 평균 ${closest[0].toFixed(2)} 어긋남 · 크기 1 기준 · 0 이면 같은 모양)`);
process.exitCode = fail ? 1 : 0;
