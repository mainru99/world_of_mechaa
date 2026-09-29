/* 코어 서킷 별자리 좌표 검사 — 명령줄(tools/circuitlayoutcheck.mjs)과 편집기(tools/circuit-editor.html)가 같이 쓴다. DOM 없음.
 *
 * 좌표계 520 x 430(왼쪽 위 0,0). 한 기체 = core + 갈래 A ~ D 마다 9 점(별 1 ~ 8 · 전문 별 ★).
 * 기준 — docs/art/circuit-constellations-2026-09-24.md §3-1, 2026-09-25 에 간격만 둘로 나눴다:
 *   다른 갈래 별끼리 22 · 같은 갈래 이웃(코어 → 1 포함) 14 · 가장자리 24 · 선 교차 없음 · ★ 둘레 이름 칸(90 x 20, 칸끼리 안 겹침)
 *   · 안으로 휜 갈래는 경고만(말린 꼬리처럼 그림이 휘어 있으면 그렇다)
 */
export const W = 520, H = 430, EDGE = 24, GAP = 22, NEIGHBOR = 14, LBL = [90, 20];
export const BR = ['A', 'B', 'C', 'D'];

const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* 점 목록 — [{ id:'core' | 'A1'..'A8' | 'A*', b, k, p }] */
export function points(L) {
  const out = [{ id: 'core', b: null, k: -1, p: L.core }];
  for (const b of BR) (L[b] || []).forEach((p, k) => out.push({ id: b + (k === 8 ? '*' : k + 1), b, k, p }));
  return out;
}
const neighbors = (x, y) => (x.b && x.b === y.b && Math.abs(x.k - y.k) === 1) || (x.id === 'core' && y.k === 0) || (y.id === 'core' && x.k === 0);

/* 선분 목록 — 갈래마다 코어 → 1 → … → ★ */
export function segments(L) {
  const out = [];
  for (const b of BR) { let prev = L.core; (L[b] || []).forEach((p, k) => { out.push({ b, k, a: prev, c: p }); prev = p; }); }
  return out;
}
function crosses(p, q, r, s) {                         // 끝점이 아닌 곳에서 만나나
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if ([p, q].some(a => [r, s].some(b => d(a, b) < 1e-6))) return false;
  return o(p, q, r) * o(p, q, s) < 0 && o(r, s, p) * o(r, s, q) < 0;
}

/* 이름 칸이 쓸 만한가 — 판 안이고, 별을 덮지 않고, 다른 이름 칸(taken)과 겹치지 않는다 */
const overlap = (a, b) => a[0] < b[0] + b[2] + 2 && b[0] < a[0] + a[2] + 2 && a[1] < b[1] + b[3] + 2 && b[1] < a[1] + a[3] + 2;
export function labelFits(L, box, taken = []) {
  const [x0, y0, w, h] = box;
  if (x0 < 2 || x0 + w > W - 2 || y0 < 2 || y0 + h > H - 2) return false;
  if (taken.some(t => t && overlap(box, t))) return false;
  return !points(L).some(({ p }) => p[0] > x0 - 6 && p[0] < x0 + w + 6 && p[1] > y0 - 6 && p[1] < y0 + h + 6);
}
/* ★ 둘레에서 이름 칸을 놓을 첫 자리 — 바깥쪽부터 열두 방향 · 거리 세 단계. 없으면 null */
export function labelSpot(L, b, taken = []) {
  const st = L[b][8], s8 = L[b][7], out = Math.atan2(st[1] - s8[1], st[0] - s8[0]);
  for (const r of [16, 28, 40]) for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
    const a = out + k * Math.PI / 6, cx = st[0] + Math.cos(a) * r, cy = st[1] + Math.sin(a) * r;
    const x0 = Math.cos(a) > .3 ? cx : Math.cos(a) < -.3 ? cx - LBL[0] : cx - LBL[0] / 2;
    const y0 = Math.sin(a) > .3 ? cy : Math.sin(a) < -.3 ? cy - LBL[1] : cy - LBL[1] / 2;
    const box = [x0, y0, LBL[0], LBL[1]];
    if (labelFits(L, box, taken)) return box;
  }
  return null;
}

/* 한 기체 검사. labels 가 있으면(CIRCUIT_LABEL_BOXES[id]) 정해 둔 칸을 보고, 없으면 자리를 찾는다.
   돌려주는 것 — { ok, bad:[문장], warn:[문장], near:[[점,점,거리,이웃?]], cross:[[선분,선분]], out:[점], label:{b: 칸|null} } */
export function checkLayout(L, labels) {
  const bad = [], warn = [];
  const P = points(L);
  if (P.length !== 37 || BR.some(b => !L[b] || L[b].length !== 9)) bad.push(`점 수 ${P.length}(37 이어야 한다)`);
  const out = P.filter(({ p }) => p[0] < EDGE || p[0] > W - EDGE || p[1] < EDGE || p[1] > H - EDGE);
  if (out.length) bad.push(`가장자리 ${EDGE} 밖 ${out.length}점`);
  const near = [];
  let nOther = 0, nNb = 0, minO = 1e9, minN = 1e9;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const g = d(P[i].p, P[j].p), nb = neighbors(P[i], P[j]);
    if (nb) { minN = Math.min(minN, g); if (g < NEIGHBOR) { nNb++; near.push([P[i], P[j], g, true]); } }
    else { minO = Math.min(minO, g); if (g < GAP) { nOther++; near.push([P[i], P[j], g, false]); } }
  }
  if (nOther) bad.push(`다른 별과 ${GAP} 미만 ${nOther}쌍(최소 ${minO.toFixed(1)})`);
  if (nNb) bad.push(`이웃 별 ${NEIGHBOR} 미만 ${nNb}쌍(최소 ${minN.toFixed(1)})`);
  const S = segments(L), cross = [];
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) if (crosses(S[i].a, S[i].c, S[j].a, S[j].c)) cross.push([S[i], S[j]]);
  if (cross.length) bad.push(`선 교차 ${cross.length}`);
  /* 이름 칸 — 정해 둔 칸이 있으면 그 칸만 본다(앞서 놓인 칸과도 겹치면 안 된다). 없으면 앞 칸들을 피해 자리를 찾는다 */
  const label = {}, taken = [];
  for (const b of BR) {
    const given = labels && labels[b];
    label[b] = given ? (labelFits(L, given, taken) ? given : null) : labelSpot(L, b, taken);
    if (label[b]) taken.push(label[b]);
  }
  const noLbl = BR.filter(b => !label[b]);
  if (noLbl.length) bad.push(`이름 자리 없음 ${noLbl.join(' · ')}`);
  let inward = 0;
  for (const b of BR) { const r = L[b].map(p => d(p, L.core)); for (let k = 1; k < r.length; k++) if (r[k] < r[k - 1] - 8) inward++; }
  if (inward) warn.push(`안쪽으로 돌아감 ${inward}`);
  return { ok: !bad.length, bad, warn, near, cross, out, label, minOther: minO, minNeighbor: minN };
}

/* 모양 비교 — 코어를 맞추고 크기를 1 로 한 뒤, 갈래 순서 24 × 좌우 뒤집기 2 중 가장 잘 맞는 회전에서 남는 점마다 평균 어긋남.
   같은 모양을 옮기거나 돌리거나 뒤집은 것이면 0 */
export function normShape(L) {
  const P = [L.core, ...BR.flatMap(b => L[b])].map(p => [p[0] - L.core[0], p[1] - L.core[1]]);
  const s = Math.sqrt(P.reduce((a, p) => a + p[0] ** 2 + p[1] ** 2, 0) / P.length) || 1;
  return BR.map((_, bi) => P.slice(1 + bi * 9, 10 + bi * 9).map(p => [p[0] / s, p[1] / s]));
}
const PERM = (() => { const out = []; const go = (a, r) => r.length ? r.forEach((x, i) => go([...a, x], r.filter((_, j) => j !== i))) : out.push(a); go([], [0, 1, 2, 3]); return out; })();
export function shapeDist(A, B) {
  let best = 1e9;
  for (const flip of [1, -1]) for (const pm of PERM) {
    let sxx = 0, sxy = 0; const pa = [], pb = [];
    for (let i = 0; i < 4; i++) for (let k = 0; k < 9; k++) {
      const a = A[i][k], b = B[pm[i]][k], bx = b[0] * flip, by = b[1];
      pa.push(a); pb.push([bx, by]); sxx += a[0] * bx + a[1] * by; sxy += a[0] * by - a[1] * bx;
    }
    const th = Math.atan2(sxy, sxx), c = Math.cos(th), si = Math.sin(th);
    let e = 0;
    for (let q = 0; q < pa.length; q++) { const [bx, by] = pb[q]; e += Math.hypot(pa[q][0] - (c * bx - si * by), pa[q][1] - (si * bx + c * by)); }
    best = Math.min(best, e / pa.length);
  }
  return best;
}
export const SAME_SHAPE = 0.05;                        // 이보다 작으면 같은 모양으로 본다
