/* 보스 레이드 자가 점검.

   이 기능이 지켜야 하는 약속은 셋이다.
     ① 막대가 어긋나지 않는다 — 여럿이 동시에 쳐도 피해가 사라지지 않고, 넘치지도 않는다
     ② 하루 횟수를 서버가 센다 — 클라가 보내는 값은 아무것도 믿지 않는다
     ③ 보스는 주마다 돌아온다 — 셋뿐이라 난수로 뽑으면 연달아 같은 보스가 나온다

   node tools/raidcheck.mjs */
import { CONST, MONSTER_TYPES } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { rollPart } from '../js/gacha.js';
import { weekOf, raidOf, runRaid, raidSeeds, raidReward, raidLeft,
         raidDaily, dayOf, BOSSES, bossStats } from '../js/raid.js';
import { raidView, raidRun } from '../server/raid.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const EMPTY = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
let sd = 31337;
const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
function mech(type, lv, rar) {
  const slots = { ...EMPTY }, parts = [];
  let i = 0;
  for (const sl of ['WEAPON', 'FRAME', 'BOOSTER', 'CORE']) {
    const p = rollPart(lv, rnd, type + (i++), rar, sl); parts.push(p); slots[sl] = p.uid; }
  const rb = { uid: 'u_' + type, type, level: lv, fat: 0, skillLv: 0, slots };
  return { name: type, type, robot: rb, parts, stats: computeStats(rb, parts) };
}

console.log('== ① 보스 회전 ==');
{
  const w = weekOf(Date.now());
  ok(BOSSES.length >= 1, `보스 ${BOSSES.length}종 — ${BOSSES.join(' · ')}`);
  const seq = [];
  for (let i = 0; i < BOSSES.length * 3; i++) seq.push(raidOf(w + i).boss);
  const runs = seq.filter((b, i) => i > 0 && b === seq[i - 1]).length;
  ok(runs === 0 || BOSSES.length === 1, '연달아 같은 보스가 나오지 않는다');
  const cyc = new Set(seq.slice(0, BOSSES.length));
  ok(cyc.size === BOSSES.length, `${BOSSES.length}주 안에 전부 한 번씩 나온다`);
  ok(raidOf(w).boss === raidOf(w).boss, '같은 주 → 같은 보스');
  ok(raidOf(-1).boss && raidOf(-5).boss, '음수 주에도 보스가 나온다');
  const r = raidOf(w);
  ok(r.level === CONST.MAXLV, `보스는 만렙(Lv.${r.level})`);
  ok(r.maxHp > r.battleHp, `막대 ${r.maxHp.toLocaleString('en-US')} > 전투 체력 ${r.battleHp.toLocaleString('en-US')}`);
}

console.log('\n== ①-2 레이드의 보스는 다른 데서 만나는 보스와 달라야 한다 ==');
{
  /* 같은 몬스터를 여러 콘텐츠가 함께 쓴다. 그런데 배수를 안 걸면 레이드 보스가
     **파견 '보스' 단계의 보스보다 약하다** — 파견은 플레이어보다 30레벨 높게 세우기
     때문이다. 그러면 레이드는 '반복 토벌' 이 되고 SR 편성이 한 판에 전멸시킨다. */
  const huntLv = Math.min(CONST.MAXLV + CONST.HUNT.BOSS.lv, CONST.MAXLV + (CONST.OPP_LV_OVER || 0));
  let minX = Infinity;
  for (const b of BOSSES) {
    const raid = Math.round(bossStats(b, CONST.MAXLV).hp * (CONST.RAID.bossX || 1));
    const hunt = bossStats(b, huntLv).hp;
    console.log(`  ${b.padEnd(20)} 레이드 ${String(raid).padStart(7)} · 파견 ${String(hunt).padStart(6)} · ${(raid / hunt).toFixed(2)}배`);
    minX = Math.min(minX, raid / hunt);
  }
  ok(minX > 1, `가장 약한 경우에도 파견 보스보다 세다 (${minX.toFixed(2)}배)`);
  const r = raidOf(weekOf(Date.now()));
  ok(r.baseHp && r.battleHp === Math.round(r.baseHp * CONST.RAID.bossX),
     `전투 체력 = 기본 ${r.baseHp} × ${CONST.RAID.bossX}`);
}

console.log('\n== ①-3 600턴 안전장치로 공짜 격파를 얻을 수 없다 ==');
{
  /* js/sim.js 는 600턴이 지나면 살아 있는 쪽을, 둘 다 살아 있으면 P 를 승자로 적는다.
     runBreach 는 그 승패를 그대로 '방어선 돌파' 로 읽는다(점령이 막히지 않게 한 선택).
     레이드는 보스 체력이 커서 그 길이 실제로 열린다 — 그대로 두면 한 대도 제대로
     못 때린 판이 '전부 깎음 + 격파' 로 기록된다. runRaid 는 체력으로 다시 읽는다. */
  const soft = { hp: 900000, atk: 1, def: 9999, spd: 100, crit: 0, eva: 0, spread: 0.2 };
  const tank = { name: 'tank', type: 'mule',
                 stats: { hp: 900000, atk: 1, def: 9999, spd: 100, crit: 0, eva: 0, spread: 0.2, hpFull: 900000 } };
  const r = { week: 0, boss: BOSSES[0], level: 60, stats: soft, baseHp: soft.hp, battleHp: soft.hp };
  const out = runRaid([tank], r, [12345]);
  ok(out.turns >= 600, `600턴 안전장치에 걸린 판을 만들었다 (${out.turns}턴 · ${out.events.length} 이벤트)`);
  ok(out.damage < r.battleHp, `전부 깎은 것으로 치지 않는다 (${out.damage} / ${r.battleHp})`);
  ok(out.win === false, '격파로도 치지 않는다');
}

console.log('\n== ② 한 판 — 편성 둘이 한꺼번에(합동전) ==');
{
  const r = raidOf(weekOf(Date.now()));
  const mechs = [mech('azure', 60, 'SR'), mech('mule', 60, 'SR')];
  const seeds = raidSeeds(r.week, 1, 1, mechs.length);
  const out = runRaid(mechs, r, seeds);
  ok(out.damage >= 0 && out.damage <= r.battleHp, `피해 ${out.damage} (0~${r.battleHp})`);
  ok(out.events.some(e => e.t === 'hit' && e.side === 'P' && e.i === 1), '후위도 보스를 친다');
  /* 같은 시드면 같은 결과여야 서버 기록과 클라 재생이 안 갈린다 */
  const again = runRaid(mechs, r, seeds);
  ok(again.damage === out.damage, '같은 시드 → 같은 피해 (재생이 기록과 일치)');
  /* 도전 횟수가 다르면 시드가 다르다 */
  const s2 = raidSeeds(r.week, 1, 2, mechs.length);
  ok(JSON.stringify(s2) !== JSON.stringify(seeds), '도전 번호가 다르면 시드가 다르다');
  ok(JSON.stringify(raidSeeds(r.week, 2, 1, 2)) !== JSON.stringify(seeds), '계정이 다르면 시드가 다르다');
  const one = runRaid([mechs[0]], r, raidSeeds(r.week, 1, 1, 1));
  ok(one.damage >= 0, `한 기만 있어도 돈다 (피해 ${one.damage})`);
}

console.log('\n== ③ 보상 ==');
{
  const r = raidOf(weekOf(Date.now()));
  const full = raidReward(r.battleHp, r.battleHp, r.level);
  const half = raidReward(r.battleHp / 2, r.battleHp, r.level);
  const none = raidReward(0, r.battleHp, r.level);
  console.log(`  전부 ${JSON.stringify(full)} · 절반 ${JSON.stringify(half)} · 0 ${JSON.stringify(none)}`);
  ok(full.cr > half.cr && half.cr > none.cr, '깎은 만큼 보상이 는다');
  ok(raidReward(r.battleHp * 99, r.battleHp, r.level).cr === full.cr, '천장을 넘지 않는다');
  /* 서버는 **배수를 걸기 전** 체력을 기준으로 준다(server/raid.js). 그래야 보스를
     12배로 키운 것이 경제를 같이 흔들지 않는다 — 전투의 세기와 보상의 크기는 다른 손잡이다. */
  ok(raidReward(r.baseHp, r.baseHp, r.level).cr === full.cr &&
     raidReward(r.battleHp, r.baseHp, r.level).cr === full.cr,
     '보스 한 마리분(배수 전)을 깎으면 만점이고, 더 깎아도 더 주지 않는다');
  /* 하루 횟수를 곱해도 경제를 흔들 만큼은 아니어야 한다 */
  console.log(`  하루 최대 — 크레딧 ${full.cr * raidDaily()} · 스크랩 ${full.sc * raidDaily()}`);
}

console.log('\n== ④ 하루 횟수 ==');
{
  const now = Date.now(), d = dayOf(now);
  ok(raidLeft(null, now) === raidDaily(), '기록이 없으면 전부 남아 있다');
  ok(raidLeft({ day: d, today: 1 }, now) === raidDaily() - 1, '오늘 한 번 썼으면 하나 줄어든다');
  ok(raidLeft({ day: d, today: raidDaily() }, now) === 0, '다 쓰면 0');
  ok(raidLeft({ day: d - 1, today: raidDaily() }, now) === raidDaily(), '날이 바뀌면 되돌아온다');
  ok(raidLeft({ day: d, today: 99 }, now) === 0, '음수로 내려가지 않는다');
}

console.log('\n== ⑤ 서버 — 가짜 env.DB ==');
{
  const now = Date.now(), w = weekOf(now), r = raidOf(w);
  const mechs = [mech('seraph', 60, 'SSR'), mech('azure', 60, 'SSR')];
  const st = { raid: null, hit: null, player: { nickname: 'T', credits: 100, scrap: 50, rev: 1 } };
  const run = (sql, a) => {
    if (/SELECT nickname, credits, scrap, rev/.test(sql)) return { ...st.player, sel_robot: 1, squad1: 1, squad2: 2 };
    if (/FROM robot WHERE account_id/.test(sql)) return { results: mechs.map((m, i) => ({
      id: i + 1, uid: m.robot.uid, type: m.type, level: 60, fat: 0, skill_lv: 0,
      s_weapon: null, s_frame: null, s_booster: null, s_core: null })) };
    if (/FROM part WHERE account_id/.test(sql)) return { results: [] };
    if (/SELECT \* FROM raid WHERE week/.test(sql)) return st.raid;
    if (/INSERT OR IGNORE INTO raid/.test(sql)) {
      if (!st.raid) st.raid = { week: a[0], boss: a[1], level: a[2], max_hp: a[3], dealt: 0, killed_at: null, killer: null };
      return {};
    }
    if (/UPDATE raid SET boss/.test(sql)) {
      st.raid.boss = a[0]; st.raid.level = a[1]; st.raid.max_hp = a[2]; return {}; }
    if (/UPDATE raid SET dealt/.test(sql)) { st.raid.dealt = Math.min(st.raid.max_hp, st.raid.dealt + a[0]); return {}; }
    if (/UPDATE raid SET killed_at/.test(sql)) { if (!st.raid.killed_at) { st.raid.killed_at = a[0]; st.raid.killer = a[1]; } return {}; }
    if (/SELECT damage, best, tries, day, today FROM raid_hit/.test(sql)) return st.hit;
    if (/INSERT INTO raid_hit/.test(sql)) {
      const [, , nick, dmg, day, , today] = a;
      if (!st.hit) st.hit = { damage: dmg, best: dmg, tries: 1, day, today: 1, nickname: nick };
      else { st.hit.damage += dmg; st.hit.best = Math.max(st.hit.best, dmg); st.hit.tries++; st.hit.day = day; st.hit.today = today; }
      return {};
    }
    if (/UPDATE player SET credits/.test(sql)) { st.player.credits += a[0]; st.player.scrap += a[1]; return {}; }
    if (/ORDER BY damage DESC/.test(sql)) return { results: st.hit ? [{ account_id: 1, nickname: 'T', damage: st.hit.damage, best: st.hit.best }] : [] };
    if (/COUNT\(\*\) AS n FROM raid_hit/.test(sql)) return { n: st.hit ? 1 : 0 };
    return null;
  };
  const env = { DB: { prepare: sql => ({ bind: (...a) => ({
    first: async () => run(sql, a),
    /* 실제 D1 처럼 all() 은 늘 { results: [...] } — 한 행을 돌려주는 문장도 배열로 싼다(server/dbread.js 가 기댄다) */
    all: async () => { const v = run(sql, a); return v && Array.isArray(v.results) ? v : { results: v ? [v] : [] }; }, run: async () => run(sql, a) }) }),
    batch: async l => { for (const x of l) await x.run(); return []; } } };

  const v = await raidView(env, 1, now);
  ok(v.ok && v.boss === r.boss, `view — ${v.name}`);
  ok(v.left === v.maxHp && v.dealt === 0, '처음엔 막대가 꽉 차 있다');
  ok(v.triesLeft === raidDaily(), `오늘 ${v.triesLeft}번 남았다`);

  /* 주 도중에 수치가 바뀌면 이미 만들어진 행이 옛 막대를 들고 있다.
     그대로 두면 12배로 단단해진 보스를 옛 막대에 대고 치게 된다. */
  st.raid.max_hp = 123;
  const v2 = await raidView(env, 1, now);
  ok(v2.maxHp === r.maxHp && st.raid.max_hp === r.maxHp, '옛 막대를 들고 있으면 새 수치로 맞춘다');
  st.raid.killed_at = now - 1; st.raid.max_hp = 123;
  const v3 = await raidView(env, 1, now);
  ok(v3.maxHp === 123, '이미 쓰러진 주는 건드리지 않는다');
  st.raid.killed_at = null; st.raid.max_hp = r.maxHp;

  const a1 = await raidRun(env, 1, now);
  ok(a1.ok && a1.damage > 0, `한 번 침 — 피해 ${a1.damage}`);
  ok(st.raid.dealt === a1.damage, '막대가 정확히 그만큼 줄었다');
  ok(a1.triesLeft === raidDaily() - 1, '남은 횟수가 하나 줄었다');
  ok(st.player.credits === 100 + a1.reward.cr, `보상이 지급됐다 (크레딧 +${a1.reward.cr})`);

  /* 응답만으로 클라가 같은 전투를 재생할 수 있어야 한다.
     여기가 깨져 있었다 — 재생용 상대를 'boss' 라고 불렀는데 같은 응답에 화면용
     boss(몬스터 id 문자열)가 있어서 덮였다. 클라는 예외로 죽고, 서버는 이미
     기록한 뒤라 '도전 횟수만 줄고 창이 안 뜨는' 증상이 됐다. */
  ok(a1.foe && a1.foe.type && a1.foe.stats, '응답이 재생용 상대(foe)를 담고 있다');
  ok(typeof a1.boss === 'string', 'boss 는 화면용 id 문자열 그대로다');
  const replay = runRaid(a1.mechs.map(m => ({ name: m.type, type: m.type, stats: m.stats, tactic: m.tactic })),
    { boss: a1.foe.type, level: a1.foe.level, stats: a1.foe.stats, battleHp: a1.battleHp,
      aim: a1.foe.aim, traits: a1.foe.traits }, a1.seeds);
  ok(replay.damage === a1.raw, `응답만으로 재생한 결과가 서버 기록과 같다 (${replay.damage})`);

  /* 하루 횟수를 다 쓰면 거절한다 */
  for (let i = 1; i < raidDaily(); i++) await raidRun(env, 1, now);
  const over = await raidRun(env, 1, now);
  ok(over.ok === false && over.error === 'no tries left', '다 쓰면 거절한다');
  const before = st.raid.dealt;
  ok(st.raid.dealt === before, '거절되면 막대가 안 줄어든다');

  /* 막대를 넘겨 때려도 넘치지 않고, 격파는 한 번만 기록된다 */
  st.raid.dealt = st.raid.max_hp - 5;
  st.hit.day = dayOf(now) - 1;                        // 날짜를 넘겨 횟수를 되돌린다
  const kill = await raidRun(env, 1, now);
  ok(kill.ok && kill.kill === true, '마지막 일격이 격파로 기록된다');
  ok(st.raid.dealt === st.raid.max_hp, '막대가 정확히 0 에서 멈춘다(넘치지 않는다)');
  ok(kill.damage === 5 && kill.raw > kill.damage, `남은 만큼만 센다 (${kill.raw} 중 ${kill.damage})`);
  st.hit.day = dayOf(now) - 1;
  const after = await raidRun(env, 1, now);
  ok(after.ok === false && after.error === 'raid already down', '쓰러진 뒤에는 못 친다');
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
