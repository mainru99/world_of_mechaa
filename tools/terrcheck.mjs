/* 점령전 자가 점검 — node tools/terrcheck.mjs
 *
 * 예전에 실제로 났던 사고를 그대로 겨눈다.
 *   · 서버가 판정한 전투와 클라가 재생한 전투가 갈려, 화면에는 이겼는데 결과는 졌다고 나왔다
 *   · 이름을 바꾸고 남은 참조가 예외를 던져 약속 사슬이 끊겼다 (전투가 아예 시작되지 않았다)
 *   · 데이터의 id 오타가 조용히 무시되어 방어선이 한 겹 사라졌다
 *
 * 여기서 가장 중요한 것은 **JSON 왕복**이다. 서버는 결과를 JSON 으로 내려보내고
 * 클라는 그것으로 같은 함수를 다시 돈다. 왕복에서 값이 한 자리라도 달라지면
 * 그때부터 두 쪽은 다른 전투를 본다.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { TERRITORY, TERRAIN, ROBOT_TYPES, MONSTER_TYPES, CONST, SLOTS } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { rollPart } from '../js/gacha.js';
import { mulberry32 } from '../js/sim.js';
import { applyTerrain, runBreach, maxRounds, regenLines, rarAllowed } from '../js/breach.js';
import { monsterLine } from '../server/territory.js';

let fail = 0;
const ok  = m => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = m => { fail++; console.log('  \x1b[31m✗ ' + m + '\x1b[0m'); };
const chk = (c, m) => c ? ok(m) : bad(m);

/* ── ① 데이터 ─────────────────────────────────────────── */
console.log('\n① 지도 데이터');
{
  const all = { ...ROBOT_TYPES, ...MONSTER_TYPES };
  const badMon = [], badTer = [], ids = new Set(), dup = [], grid = new Set();
  for (const n of TERRITORY) {
    for (const m of n.mon) if (!all[m]) badMon.push(n.id + ':' + m);
    if (!TERRAIN[n.terrain]) badTer.push(n.id + ':' + n.terrain);
    if (ids.has(n.id)) dup.push(n.id); else ids.add(n.id);
    grid.add(n.row + ',' + n.col);
    if (!n.mon.length) bad(`${n.id} 에 방어선이 없다`);
  }
  chk(!badMon.length, `방어선 몬스터 id ${TERRITORY.reduce((s, n) => s + n.mon.length, 0)}개 전부 실재` + (badMon.length ? ' — ' + badMon.join(' ') : ''));
  chk(!badTer.length, '지형 id 전부 실재' + (badTer.length ? ' — ' + badTer.join(' ') : ''));
  chk(!dup.length, '칸 id 중복 없음' + (dup.length ? ' — ' + dup.join(' ') : ''));
  chk(grid.size === TERRITORY.length, `격자 좌표 겹침 없음 (${grid.size}/${TERRITORY.length})`);
  /* 화면이 3열 4행을 가정하고 그린다. 빈 칸이 생기면 지도가 어긋난다. */
  chk(TERRITORY.length === 12, '칸 12개');
}

/* ── ② 서버가 만드는 방어선 ───────────────────────────── */
console.log('\n② 방어선 생성');
{
  let dropped = 0, unstable = 0;
  for (const n of TERRITORY) {
    const a = n.mon.map((_, i) => monsterLine(n, i));
    if (a.filter(Boolean).length !== n.mon.length) dropped++;
    /* 깎아 둔 체력이 다음 시도로 이어지므로 방어자는 매번 같아야 한다.
       시드를 칸·번호로 고정한 이유다 — 여기서 흔들리면 '어제 그 놈'이 아니게 된다. */
    const b = n.mon.map((_, i) => monsterLine(n, i));
    if (JSON.stringify(a) !== JSON.stringify(b)) unstable++;
  }
  chk(!dropped, '조용히 빠지는 방어선 없음 (id 오타가 있으면 여기서 걸린다)');
  chk(!unstable, '같은 칸을 두 번 만들면 방어자가 똑같다');
}

/* ── ③ 서버 ↔ 클라 재생 일치 (JSON 왕복) ─────────────── */
console.log('\n③ 서버 판정 = 클라 재생  (JSON 왕복 포함)');
{
  const BY = {};
  for (const k in ROBOT_TYPES) (BY[ROBOT_TYPES[k].rarity] ||= []).push(k);
  const mech = (type, lv, seed) => {
    const rnd = mulberry32(seed), slots = {}, parts = [];
    for (const sl of SLOTS) {
      const p = rollPart(lv, rnd, `c-${sl}-${seed}`, 'SR', sl);
      slots[sl] = p.uid; parts.push(p);
    }
    return { name: ROBOT_TYPES[type].name, type, stats: computeStats({ type, level: lv, fat: 0, slots }, parts) };
  };

  let diff = 0, seedShort = 0, lenBad = 0, cases = 0;
  for (const n of TERRITORY) {
    for (const [rar, lv] of [['C', 12], ['R', 26], ['UQ', 40], ['EP', 55]]) {
      const list = BY[rar];
      const lines = n.mon.map((_, i) => monsterLine(n, i)).filter(Boolean);
      for (let t = 0; t < 6; t++) {
        cases++;
        const mechs = [mech(list[t % list.length], lv, 900 + t), mech(list[(t + 1) % list.length], lv, 5000 + t)]
          .map(m => ({ ...m, stats: applyTerrain(m.stats, n.terrain) }));
        /* 이미 깎여 있는 상태에서도 확인한다 — 실전에서 대부분이 이 상태다 */
        const hpLeft = lines.map((_, i) => (i === 0 ? 0.37 : i === 1 ? 0 : 1));
        const seeds = Array.from({ length: maxRounds(lines.length, mechs.length) },
                                 (_, i) => (Math.random() * 0xffffffff) >>> 0);

        /* 서버가 도는 것 */
        const srv = runBreach({ mechs, lines, seeds, hpLeft });

        /* 클라가 받는 것 — 응답에 실리는 필드만, JSON 을 실제로 통과시킨다 */
        const wire = JSON.parse(JSON.stringify({ mechs, lines, seeds, hpLeft0: hpLeft }));
        const cli = runBreach({ mechs: wire.mechs, lines: wire.lines, seeds: wire.seeds, hpLeft: wire.hpLeft0 });

        const key = r => JSON.stringify({
          win: r.win, cleared: r.cleared, downed: r.downed, hpLeft: r.hpLeft,
          rounds: r.rounds.map(x => ({ mi: x.mi, li: x.li, seed: x.seed, win: x.win,
                                       pHp: x.pHp, pSp: x.pSp, eHp: x.eHp, eSp: x.eSp,
                                       ev: x.events.length })),
        });
        if (key(srv) !== key(cli)) diff++;
        if (srv.rounds.length > seeds.length) seedShort++;
        if (srv.hpLeft.length !== lines.length) lenBad++;
      }
    }
  }
  chk(!diff, `${cases}가지 돌파에서 서버와 클라의 판정이 전부 일치`);
  chk(!seedShort, '시드가 모자라 중간에 끊긴 경우 없음 (maxRounds 가 충분하다)');
  chk(!lenBad, '남은 방어선 배열 길이가 항상 방어선 수와 같다');
}

/* ── ④ 경계값 ─────────────────────────────────────────── */
console.log('\n④ 경계값');
{
  const n = TERRITORY[0];
  const lines = n.mon.map((_, i) => monsterLine(n, i));
  const one = { name: 'X', type: Object.keys(ROBOT_TYPES)[0],
                stats: computeStats({ type: Object.keys(ROBOT_TYPES)[0], level: 30, fat: 0, slots: {} }, []) };

  const empty = runBreach({ mechs: [], lines, seeds: [1, 2, 3], hpLeft: null });
  chk(empty.win === false && empty.rounds.length === 0, '편성이 비면 조용히 실패한다 (예외를 던지지 않는다)');

  const noLine = runBreach({ mechs: [one], lines: [], seeds: [1], hpLeft: null });
  chk(noLine.win === false, '방어선이 없으면 이겼다고 하지 않는다');

  const allDead = runBreach({ mechs: [one], lines, seeds: [], hpLeft: lines.map(() => 0) });
  chk(allDead.win === true && allDead.rounds.length === 0,
      '이미 다 무너진 방어선은 싸우지 않고 통과한다 (시드가 0개여도 된다)');

  const noSeed = runBreach({ mechs: [one], lines, seeds: [], hpLeft: null });
  chk(noSeed.win === false && noSeed.rounds.length === 0, '시드가 없으면 멈춘다 (무한 루프가 아니다)');

  chk(JSON.stringify(regenLines([0, 0.5, 1], 5)) === JSON.stringify([0.5, 1, 1]), '방어선 회복 계산');
  chk(JSON.stringify(regenLines([0.2], 1e6)) === JSON.stringify([1]), '오래 두면 1을 넘지 않는다');
  chk(rarAllowed('C', 'UC') && !rarAllowed('EP', 'UQ') && rarAllowed('EP', null), '편성 제한 판정');
}

/* ── ⑤ 출격비 규칙이 서버와 같은가 ───────────────────── */
console.log('\n⑤ 출격비 — 클라가 보여 주는 값과 서버가 걷는 값');
{
  /* 서버(server/territory.js)는 '편성 제한을 통과한 첫 기체' 로 계산한다.
     클라가 다른 기준(예: 지금 선택된 기체)으로 보여 주면, 화면의 금액과 실제로
     빠지는 금액이 다르고 '크레딧 부족' 판정도 어긋난다. */
  const rd = f => require('node:fs').readFileSync(f, 'utf8').replace(/\s+/g, '');
  const cli = rd('js/game.js'), srv = rd('server/territory.js');
  const R = 'sortieCost(ok[0])*CONST.TERR.COST_X';
  const S = 'sortieCost(eligible[0].robot)*T.COST_X';
  chk(srv.includes(S), "서버가 '편성 제한을 통과한 첫 기체'로 출격비를 걷는다");
  chk(cli.includes(R), '클라가 같은 기준으로 보여 준다 (선택된 기체가 아니라)');
  chk(!cli.includes('sortieCost(rb)*CONST.TERR.COST_X'), "클라에 옛 기준(selRobot)이 남아 있지 않다");

  /* 선봉을 누가 맡는가. 대전(server/battle.js)은 sel_robot 이 나가는데 점령전만
     편성 순서로 골랐더니, 격납고에 'B 출격'이라고 떠 있는데 A 가 싸우고 피로도를 먹었다.
     양쪽 다 선봉을 sel_robot 으로 맞춰 두었는지 본다. */
  chk(srv.includes('picked.findIndex(r=>r.id===p.sel_robot)'),
      "서버가 선봉을 '출격'으로 고른 기체(sel_robot)로 맞춘다");
  chk(cli.includes('squad.findIndex(x=>x.uid===sel.uid)'),
      '클라도 같은 순서로 선봉을 정한다');
}

console.log(fail ? `\n\x1b[31m${fail}건 실패\x1b[0m\n` : '\n\x1b[32m전부 통과\x1b[0m\n');
process.exit(fail ? 1 : 0);
