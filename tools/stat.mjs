/* 측정 도구가 함께 쓰는 통계 자.

   시뮬 승률은 표본에서 나온 값이라 늘 흔들린다. 흔들리는 폭을 함께 적지 않으면
   잡음을 실력 차로 읽는다 — 실제로 표본이 작아 정상 기체가 이상치로 보고된 적이 있다.

   구간은 윌슨(Wilson)으로 낸다. 흔히 쓰는 정규 근사(p ± z√(p(1-p)/n))는 승률이
   0% 나 100% 에 가까우면 구간이 0 으로 줄어 '오차가 없다'고 거짓말을 한다.
   보스 승률처럼 0% 가 실제로 나오는 칸이 있으므로 그 근사를 쓰면 안 된다. */

const Z = 1.96;                                    // 95%

export function wilson(k, n, z = Z) {
  if (!n) return { lo: 0, hi: 1 };
  const p = k / n, z2 = z * z, d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d;
  const s = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / d;
  return { lo: Math.max(0, c - s), hi: Math.min(1, c + s) };
}

/* '48.9% [47.2~50.6]' — 넉넉한 칸에서 쓴다 */
export const pct = (k, n, d = 1) => {
  const w = wilson(k, n);
  return `${(k / n * 100).toFixed(d)}% [${(w.lo * 100).toFixed(d)}~${(w.hi * 100).toFixed(d)}]`;
};

/* '48.9%±1.7' — 좁은 표에서 쓴다. 구간의 반폭이다 */
export const pm = (k, n, d = 1) => {
  const w = wilson(k, n);
  return `${(k / n * 100).toFixed(d)}%±${((w.hi - w.lo) / 2 * 100).toFixed(d)}`;
};

/* 구간이 통째로 밖에 있을 때만 '기준을 벗어났다'고 말할 수 있다.
   값 하나가 기준 밖이라는 것만으로는 손댈 근거가 되지 않는다. */
export const outside = (k, n, lo, hi) => {
  const w = wilson(k, n);
  return w.hi < lo || w.lo > hi;
};

/* 구간이 기준선을 물면 우열을 말할 수 없다 (기본 50%) */
export const ties = (k, n, at = 0.5) => {
  const w = wilson(k, n);
  return w.lo <= at && at <= w.hi;
};

/* 판수는 명령줄에서 바꾼다: node tools/intra.mjs 8000 */
export const argN = def => {
  const v = Number(process.argv[2]);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : def;
};
