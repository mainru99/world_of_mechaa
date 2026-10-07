/* 난투 밸런스 도구 — 봇 런 수천 판으로 CONST.BRAWL 의 수치를 잰다 (2026-10-07 · 계획 ③)
 *
 * 운영과 같은 모양으로 돈다 — 런은 한 판씩 차례로 돌고, 라운드마다 **같은 라운드의 저장된 보드(유령)** 와 붙는다.
 * 처음 유령은 봇 보드로 채우고, 앞선 런의 보드가 쌓이면 그것과 붙는다. 앞의 warm 판은 세지 않는다.
 *
 * 플레이어 모양 — 수집(새 계정 C 만 · 중간 UC 이상 10~25종 · 고참 전부) × 전략(value · syn · econ · roll, js/brawl.js BOT_STYLES).
 * 대여는 그날의 6기 중 무작위 3장.
 *
 *   A 런 — 승수 분포 · 10승 비율 · 라운드 수(= 시간) · 목숨으로 끝난 비율
 *   B 공정 — 전략별 · 수집별 평균 승수 (한쪽이 독주하지 않는가 · 수집이 이기지만 압도하지 않는가)
 *   C 시너지 — 한쪽만 그 시너지를 켠 전투에서 켠 쪽의 승률
 *   D 기체 — 한쪽에만 있는 전투에서 그 기체 쪽 승률(등급별 위 · 아래)
 *   E 별 · 값 — ★2 vs ★1 · ★3 vs ★2(같은 기체) · 같은 골드끼리(C★2 넷 vs R★1 넷 등)
 *   F 보상 — 위 승수 분포로 '하루 첫 런' 의 기대 보상(아레나 승리 몇 판 몫인가)
 *
 * 목표 밖이면 ⚠ 를 붙인다. 판정은 하지 않는다(exit 0) — 수치를 고르는 도구다.
 * 목표는 **평등이 아니라 게임성**이다(2026-10-07 사용자) — 강한 순간 · 빌드 차이 · 수집 보람은 두고, 한 전략 독주 · 끝나지 않는 판만 막는다.
 *
 * node --no-warnings tools/brawlbal.mjs [--runs 2000] [--warm 300] [--seed 1] [--set 'deck=5' …] */
import { ROBOT_TYPES, CONST } from '../data/balance.js';
import { mulberry32 } from '../js/sim.js';
import { runBrawl } from '../js/brawl-sim.js';
import { newRun, settle, botTurn, botRun, teamOf, synergiesOf, dailyRentals, brawlTypes, h32, BOT_STYLES, rewardOf, arenaWinCr } from '../js/brawl.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const RUNS = arg('runs', 2000), WARM = arg('warm', 300), SEED = arg('seed', 1);
const B = CONST.BRAWL;
/* --set 'deck=5' --set 'syn.precise.v=[0.07,0.14]' — CONST.BRAWL 을 이 실행에서만 바꿔 본다(파일은 안 고친다) */
process.argv.forEach((a, i) => {
  if (a !== '--set') return;
  const [path, val] = process.argv[i + 1].split('=');
  const ks = path.split('.'); let o = B;
  for (const k of ks.slice(0, -1)) o = o[k];
  o[ks.at(-1)] = JSON.parse(val);
  console.log(`(바꿔 봄) BRAWL.${path} = ${val}`);
});
const rar = t => ROBOT_TYPES[t].rarity;
const nonC = brawlTypes().filter(t => rar(t) !== 'C').sort();
const pct = (a, b) => b ? (a / b * 100) : NaN;
const f1 = x => Number.isFinite(x) ? x.toFixed(1) : '—';
const warn = (x, lo, hi) => (x < lo || x > hi) ? ' ⚠' : '';
const t0 = Date.now();
const rnd = mulberry32(h32('bal', SEED));

/* ── 플레이어 모양 ───────────────────────────────────── */
const TIERS = [['새 계정', 0.4], ['중간', 0.4], ['고참', 0.2]];
const STYLES = Object.keys(BOT_STYLES);
function player(k) {
  let x = rnd(), tier = TIERS[TIERS.length - 1][0];
  for (const [name, w] of TIERS) { if ((x -= w) < 0) { tier = name; break; } }
  let owned = [];
  if (tier === '중간') { const n = 10 + Math.floor(rnd() * 16); owned = nonC.slice().sort(() => rnd() - 0.5).slice(0, n); }
  if (tier === '고참') owned = nonC.slice();
  /* 대여 · 출전 목록 — 사람처럼 높은 등급을 조금 더 고른다(등급 순위 + 무작위 0 ~ 2). 대여를 먼저 채우고 남은 칸을 보유로 */
  const RI = { UC: 1, R: 2, UQ: 3, EP: 4 };
  const prefer = L => L.map(t => ({ t, s: RI[rar(t)] + rnd() * 2 })).sort((a, b) => b.s - a.s).map(x => x.t);
  const rentals = prefer(dailyRentals('d' + (k % 30), owned)).slice(0, B.rent.daily);
  return { tier, style: STYLES[Math.floor(rnd() * STYLES.length)], owned, rentals, deck: prefer(owned) };
}

/* ── 유령 보드 ───────────────────────────────────────── */
const GHOST_CAP = 400, ghosts = {};
const pushGhost = (round, g) => { const a = ghosts[round] = ghosts[round] || []; a.push(g); if (a.length > GHOST_CAP) a.splice(0, a.length - GHOST_CAP); };
for (let round = 1; round <= 20; round++)
  for (let k = 0; k < 40; k++) {
    const r = botRun({ seed: h32('ghost', SEED, round, k), round, style: STYLES[k % STYLES.length] });
    if (!r.done) pushGhost(round, { board: r.board, bot: true });
  }

/* ── 리그 ────────────────────────────────────────────── */
const runs = [], battles = [];
for (let k = 0; k < WARM + RUNS; k++) {
  const P = player(k), seed = h32('run', SEED, k);
  const prnd = mulberry32(seed ^ 0x9e3779b9);
  let run = newRun({ seed, owned: P.owned, rentals: P.rentals, deck: P.deck });
  const count = k >= WARM;
  while (!run.done) {
    run = botTurn(run, prnd, P.style);
    const pool = ghosts[run.round] || ghosts[Object.keys(ghosts).map(Number).filter(r => r < run.round).pop()];
    const opp = pool[Math.floor(prnd() * pool.length)];
    const res = runBrawl({ p: teamOf(run.board), e: teamOf(opp.board), seed: h32('b', seed, run.round) });
    if (count) battles.push({ round: run.round, p: run.board, e: opp.board, win: res.win });
    pushGhost(run.round, { board: run.board });
    run = settle(run, res.win).run;
  }
  if (count) runs.push({ ...P, wins: run.wins, rounds: run.round, lives: run.lives });
}

/* ── A 런 ────────────────────────────────────────────── */
console.log(`== A 런 (${RUNS}판 · 앞 ${WARM}판 제외) ==`);
{
  const dist = Array(B.winGoal + 1).fill(0);
  for (const r of runs) dist[r.wins]++;
  console.log('  승수 분포  ' + dist.map((n, w) => `${w}:${f1(pct(n, runs.length))}`).join(' '));
  const ten = pct(dist[B.winGoal], runs.length), avgR = runs.reduce((s, r) => s + r.rounds, 0) / runs.length;
  const avgW = runs.reduce((s, r) => s + r.wins, 0) / runs.length;
  console.log(`  ${B.winGoal}승 ${f1(ten)}%${warn(ten, 3, 15)} (목표 3 ~ 15) · 평균 ${avgW.toFixed(2)}승`);
  console.log(`  라운드 평균 ${avgR.toFixed(1)}${warn(avgR, 9, 14)} (목표 9 ~ 14 — 라운드당 상점 60초 + 전투 25초면 ${Math.round(avgR * 85 / 60)}분)`);
  const R = runs.map(r => r.rounds).sort((a, b) => a - b);
  console.log(`  라운드 중앙 ${R[R.length >> 1]} · 90% ${R[Math.floor(R.length * 0.9)]} · 최장 ${R.at(-1)}`);
}

/* ── B 공정 ──────────────────────────────────────────── */
console.log('\n== B 공정 — 평균 승수 ==');
{
  const by = key => {
    const m = {};
    for (const r of runs) { const x = m[r[key]] = m[r[key]] || { n: 0, w: 0, ten: 0 }; x.n++; x.w += r.wins; if (r.wins >= B.winGoal) x.ten++; }
    return m;
  };
  const S = by('style'), T = by('tier'), all = runs.reduce((s, r) => s + r.wins, 0) / runs.length;
  console.log('  전략  ' + STYLES.map(s => `${s} ${(S[s].w / S[s].n).toFixed(2)}${warn(S[s].w / S[s].n - all, -1.5, 1.2)}`).join(' · ') + '  (차이는 좋다 — 평균보다 1.2승 넘게 앞서는 독주만 막는다)');
  const tw = name => T[name] ? T[name].w / T[name].n : NaN;
  const gap = tw('고참') - tw('새 계정');
  console.log('  수집  ' + TIERS.map(([n]) => `${n} ${f1(tw(n))}승 · 10승 ${f1(pct(T[n] && T[n].ten, T[n] && T[n].n))}%`).join(' · '));
  console.log(`  고참 − 새 계정 ${gap.toFixed(2)}승${warn(gap, 0.5, 2.5)} (목표 0.5 ~ 2.5 — 수집한 보람은 있되 새 계정도 이길 수 있다)`);
}

/* ── C 시너지 ────────────────────────────────────────── */
console.log('\n== C 시너지 — 한쪽만 켠 전투에서 켠 쪽 승률 ==');
{
  const keyOf = s => s.key === 'family' ? 'family:' + s.fam : s.key;
  const m = {};
  for (const b of battles) {
    const P = new Set(synergiesOf(b.p).map(keyOf)), E = new Set(synergiesOf(b.e).map(keyOf));
    for (const k of new Set([...P, ...E])) {
      if (P.has(k) === E.has(k)) continue;
      const x = m[k] = m[k] || { n: 0, w: 0 };
      x.n++; if (P.has(k) === b.win) x.w++;
    }
  }
  const act = {};
  for (const b of battles) for (const s of synergiesOf(b.p)) act[keyOf(s)] = (act[keyOf(s)] || 0) + 1;
  for (const k of Object.keys(m).sort((a, b) => m[b].w / m[b].n - m[a].w / m[a].n)) {
    const w = pct(m[k].w, m[k].n), ko = k.startsWith('family') ? '공명 ' + k.slice(7) : B.syn[k].ko;
    console.log(`  ${ko.padEnd(8)} ${f1(w)}%${m[k].n >= 200 ? warn(w, 48, 62) : ' (표본 적음)'} · 표본 ${m[k].n} · 켜진 보드 ${f1(pct(act[k] || 0, battles.length))}%`);
  }
  console.log('  (참고 — 시너지가 켜진 보드는 대개 더 다양하고 비싸서 위 값은 부풀려진다)');

  /* 반사실 — 그 시너지를 켠 쪽의 전투를 **그 시너지만 끄고** 같은 시드로 다시 싸운다. 승률이 얼마나 빠지나가 시너지의 값이다 */
  console.log('  ─ 그 시너지만 끄고 다시 싸우면(같은 보드 · 같은 시드) 켠 쪽 승률이 얼마나 빠지나');
  const keys = Object.keys(B.syn).filter(k => k !== 'family');
  for (const k of keys) {
    const L = battles.filter(b => synergiesOf(b.p).some(s => s.key === k)).slice(0, 600);
    if (L.length < 60) { console.log(`  ${B.syn[k].ko.padEnd(4)} 표본 ${L.length} — 적음`); continue; }
    let on = 0, offW = 0;
    for (const b of L) {
      const seed = h32('cf', b.round, JSON.stringify(b.p).length, JSON.stringify(b.e).length);
      if (runBrawl({ p: teamOf(b.p), e: teamOf(b.e), seed }).win) on++;
      if (runBrawl({ p: teamOf(b.p, { off: [k] }), e: teamOf(b.e), seed }).win) offW++;
    }
    const d = pct(on - offW, L.length);
    console.log(`  ${B.syn[k].ko.padEnd(4)} +${f1(d)}%p${warn(d, 5, 25)} (켬 ${f1(pct(on, L.length))} · 끔 ${f1(pct(offW, L.length))} · 표본 ${L.length})`);
  }
  console.log('  (목표 +5 ~ +25%p — 맞추면 확실히 세다. 혼자 판을 정할 만큼은 아니다)');
}

/* ── D 기체 ──────────────────────────────────────────── */
console.log('\n== D 기체 — 한쪽에만 있는 전투에서 그 기체 쪽 승률 ==');
{
  const m = {};
  for (const b of battles) {
    const P = new Set(b.p.filter(Boolean).map(u => u.type)), E = new Set(b.e.filter(Boolean).map(u => u.type));
    for (const t of new Set([...P, ...E])) { if (P.has(t) === E.has(t)) continue; const x = m[t] = m[t] || { n: 0, w: 0 }; x.n++; if (P.has(t) === b.win) x.w++; }
  }
  for (const R of ['C', 'UC', 'R', 'UQ', 'EP']) {
    const L = Object.keys(m).filter(t => rar(t) === R && m[t].n >= 150).map(t => ({ t, w: pct(m[t].w, m[t].n) })).sort((a, b) => b.w - a.w);
    if (!L.length) continue;
    const lo = L.at(-1), hi = L[0], spread = hi.w - lo.w;
    console.log(`  ${R.padEnd(2)} ${L.length}종 — 위 ${L.slice(0, 3).map(x => `${x.t} ${f1(x.w)}`).join(' · ')} | 아래 ${L.slice(-3).map(x => `${x.t} ${f1(x.w)}`).join(' · ')} | 폭 ${f1(spread)}%p${warn(spread, 0, 25)}`);
  }
  console.log('  (같은 등급 안 폭 25%p 이하 — 기체 개별 수치는 1 : 1 밸런스의 몫이라 여기서는 지켜보기만)');
}

/* ── E 별 · 값 ───────────────────────────────────────── */
console.log('\n== E 별 · 값 ==');
{
  const ids = brawlTypes(), by = r => ids.filter(t => rar(t) === r);
  const duel = (a, b, n) => { let w = 0; for (let s = 0; s < n; s++) if (runBrawl({ p: teamOf(a(s)), e: teamOf(b(s)), seed: h32('e', s) }).win) w++; return pct(w, n); };
  const one = (t, star) => [{ type: t, star }, null, null, null];
  let s21 = 0, s32 = 0;
  for (const t of ids) { s21 += duel(() => one(t, 2), () => one(t, 1), 20); s32 += duel(() => one(t, 3), () => one(t, 2), 20); }
  s21 /= ids.length; s32 /= ids.length;
  console.log(`  같은 기체 1 : 1 — ★2 vs ★1 ${f1(s21)}%${warn(s21, 85, 100)} · ★3 vs ★2 ${f1(s32)}%${warn(s32, 85, 100)} (목표 85 이상)`);
  const er = mulberry32(77), pickOf = r => { const L = by(r); return () => L[Math.floor(er() * L.length)]; };
  const team = (r, star) => { const p = pickOf(r); return () => [0, 1, 2, 3].map(() => ({ type: p(), star })); };
  const pairs = [
    ...[['C', 2, 'R', 1], ['UC', 2, 'EP', 1], ['R', 2, 'UQ', 2], ['UQ', 2, 'EP', 1], ['C', 3, 'R', 2], ['C', 3, 'EP', 1]].map(([a, sa, b, sb]) => {
      const g = (r, s) => B.price[r] * Math.pow(3, s - 1) * 4;
      return [`${a}★${sa} 넷 (${g(a, sa)}골드)`, team(a, sa), `${b}★${sb} 넷 (${g(b, sb)}골드)`, team(b, sb)];
    }),
    ['C★1 넷', team('C', 1), 'UC★1 넷', team('UC', 1)],
    ['UC★1 넷', team('UC', 1), 'R★1 넷', team('R', 1)],
    ['R★1 넷', team('R', 1), 'UQ★1 넷', team('UQ', 1)],
    ['UQ★1 넷', team('UQ', 1), 'EP★1 넷', team('EP', 1)],
  ];
  for (const [an, a, bn, b] of pairs) { const w = duel(a, b, 400); console.log(`  ${an} vs ${bn} — 앞쪽 ${f1(w)}%`); }
  console.log('  (판정 없음 — ★3 · EP 는 터지는 순간이라 같은 골드보다 세도 된다)');
}

/* ── F 보상 ──────────────────────────────────────────── */
console.log('\n== F 보상 — 하루 첫 런 ==');
{
  for (const lv of [10, 30, 60]) {
    const arena = arenaWinCr(lv);
    let cr = 0, sc = 0, shard = 0, refined = 0;
    for (const r of runs) { const g = rewardOf(r.wins, lv); cr += g.cr; sc += g.sc; shard += g.shard; refined += g.refined; }
    const n = runs.length;
    console.log(`  Lv.${lv} — 평균 크레딧 ${Math.round(cr / n)}(아레나 승리 ${(cr / n / arena).toFixed(2)}판 몫) · 스크랩 ${Math.round(sc / n)} · 목표 조각 ${(shard / n).toFixed(2)} · 정제 코어 ${(refined / n).toFixed(3)}`);
  }
  console.log('  승수별 Lv.30 — ' + [0, 3, 4, 6, 7, 9, 10].map(w => { const g = rewardOf(w, 30); return `${w}승 ${g.cr}cr${g.sc ? '+' + g.sc + 'sc' : ''}${g.shard ? '+조각' + g.shard : ''}${g.refined ? '+정제' + g.refined : ''}`; }).join(' · '));
}

console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)}초 · 전투 ${battles.length}판)`);
