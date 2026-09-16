/* 보스 레이드 — 순수 규칙.
 *
 * 주간 시련이 '내 빌드가 어디쯤인가' 를 혼자 재는 자리라면, 레이드는 **서버 전체가
 * 하나의 체력 막대를 같이 깎는 자리**다. 혼자 하는 게임에 다른 사람이 처음 보이는 곳이
 * 여기다 — 순위표의 이름이 아니라, 내가 깎은 만큼 남들의 막대가 줄어든다.
 *
 * 설계에서 가장 중요한 결정 하나 — **전투는 매번 보스를 꽉 찬 체력으로 만난다.**
 *   레이드 막대와 전투 체력을 같은 값으로 두면, 두 사람이 동시에 치면 둘 다 '70%' 를
 *   읽고 각자 결과를 써서 한쪽 피해가 사라진다(읽고-고치고-쓰기 경합).
 *   그래서 전투는 언제나 100% 에서 시작하고, 레이드 막대는 `dealt = dealt + 피해` 라는
 *   **한 문장**으로만 는다. SQLite 에서 그 문장은 원자적이라 경합이 없다.
 *
 * 브라우저와 Worker 가 같이 import 한다. DOM 을 참조하지 않는다.
 */
import { CONST, MONSTER_TYPES } from '../data/balance.js';
import { computeStats } from './stats.js';
import { mulberry32 } from './sim.js';
import { runBreach, maxRounds } from './breach.js';
import { weekOf, weekStart, weekEnd } from './trial.js';

export { weekOf, weekStart, weekEnd };

const EMPTY = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const RAID = () => CONST.RAID || {};

/* 보스 셋을 주마다 돌린다. 데이터에서 뽑으므로 보스를 더하면 자동으로 끼어든다. */
export const BOSSES = Object.keys(MONSTER_TYPES)
  .filter(k => MONSTER_TYPES[k].rarity === 'BOSS').sort();

/* 이번 주 레이드. 주 번호만 있으면 누구나 같은 값을 얻는다.

   보스는 **난수가 아니라 주기**로 돌린다. 처음에 주간 시련처럼 해시로 뽑았더니
   36~39주가 네 번 내리 같은 보스였다 — 몬스터 열 종에서 뽑는 시련과 달리 여기는
   후보가 셋뿐이라, 같은 값이 연달아 나올 확률이 그만큼 높다.
   나머지 연산이면 셋이 반드시 세 주에 한 번씩 돌아온다. */
export function raidOf(week) {
  const w = week | 0;
  const i = ((w % BOSSES.length) + BOSSES.length) % BOSSES.length;   // 음수 주도 안전하게
  const boss = BOSSES[i] || BOSSES[0];
  const level = CONST.MAXLV;                      // 보스는 언제나 만렙이다. 끝 콘텐츠다
  /* **레이드의 보스는 같은 보스가 아니다.** 만렙 보스를 그대로 쓰면 파견 '보스'
     단계에서 만나는 보스(플레이어 +30레벨)보다 오히려 약하다. 그래서 체력에만
     배수를 건다 — 공격력까지 키우면 약한 편성이 아무것도 못 깎는다.
     같은 몬스터라도 시련·파견·점령·레이드가 각각 제 몫으로 키워 쓴다. */
  const raw = bossStats(boss, level);
  const stats = { ...raw, hp: Math.max(1, Math.round(raw.hp * (RAID().bossX || 1))) };
  return { week, boss, level, stats, baseHp: raw.hp, battleHp: stats.hp,
           maxHp: Math.max(1, Math.round(stats.hp * (RAID().hpX || 60))) };
}
export const bossStats = (type, level) =>
  computeStats({ type, level, skillLv: 0, fat: 0, slots: EMPTY }, []);

/* 한 사람의 한 번. 편성 기체들이 차례로 들어가 보스를 얼마나 깎았는지만 돌려준다.
   막대를 줄이거나 재화를 주는 것은 부르는 쪽(서버)의 일이다. */
export function runRaid(mechs, r, seeds) {
  const lines = [{ name: MONSTER_TYPES[r.boss].name, type: r.boss, stats: r.stats }];
  const out = runBreach({ mechs, lines, seeds, hpLeft: [1] });

  /* 깎은 양은 **보스에게 실제로 남은 체력**으로 잰다. `out.win` 으로 재면 안 된다 —
     600턴 안전장치(js/sim.js)에 걸리면 양쪽이 살아 있는 채로 P 승이 되고,
     runBreach 는 그걸 '방어선 돌파' 로 적는다(점령이 막히지 않게 한 선택이다).
     레이드는 보스 체력이 커서 그 길이 열려 있다 — 그대로 두면 못 이긴 판이
     '전부 깎음 + 격파' 로 기록된다. 그래서 여기서만 체력으로 다시 읽는다. */
  const last = out.rounds.length ? out.rounds[out.rounds.length - 1] : null;
  const leftFrac = last && last.eMax
    ? Math.max(0, Math.min(1, last.eEnd / last.eMax))
    : (out.win ? 0 : Math.max(0, Math.min(1, out.hpLeft[0])));
  const damage = Math.max(0, Math.round(r.battleHp * (1 - leftFrac)));
  return { ...out, win: leftFrac <= 0, damage, leftFrac };
}

/* 시드는 (주 · 계정 · 몇 번째 도전) 에서 나온다.
   같은 도전은 언제나 같게 재생되고(서버와 클라가 어긋나지 않는다),
   클라가 고를 수는 없다(마음에 드는 결과가 나올 때까지 돌리는 길을 막는다). */
export function raidSeeds(week, accountId, tries, nMechs) {
  let h = 2166136261;
  for (const v of [week | 0, accountId | 0, tries | 0]) {
    h = Math.imul(h ^ v, 16777619);
    h = Math.imul(h ^ (h >>> 13), 2246822519);
  }
  const rnd = mulberry32(h >>> 0);
  const n = maxRounds(1, Math.max(1, nMechs));
  return Array.from({ length: n }, () => Math.floor(rnd() * 4294967296) >>> 0);
}

/* 보상 — 깎은 비율에 비례한다.
   **기준은 배수를 걸기 전 보스 체력(`baseHp`)이다.** 레이드 배수로 잰 비율을 쓰면
   보스를 12배로 키운 순간 같은 활약의 보상이 1/12 이 된다 — 전투를 손보려다 경제까지
   같이 바꾸게 된다. 둘은 갈라 둔다: 전투의 세기는 `RAID.bossX`, 보상의 크기는 여기.
   그래서 '보스 한 마리분을 깎았다' 가 만점이고, 그 뜻은 배수를 바꿔도 변하지 않는다.

   레이드는 하루 횟수가 정해져 있으므로 이 값이 경제의 수도꼭지가 된다.
   수치는 CONST.RAID 에 있고, 0 으로 두면 보상 없이 막대만 깎는 콘텐츠가 된다. */
export function raidReward(damage, rewardHp, level) {
  const R = RAID();
  const ratio = Math.max(0, Math.min(1, damage / Math.max(1, rewardHp)));
  const lv = Math.max(1, level | 0);
  return {
    cr: Math.round((R.crBase || 0) + (R.crLv || 0) * lv * ratio),
    sc: Math.round((R.scBase || 0) + (R.scLv || 0) * lv * ratio),
  };
}

/* 하루 도전 횟수. UTC 하루로 센다 — 주 번호와 같은 기준이라 경계가 어긋나지 않는다. */
export const dayOf = now => Math.floor(now / 86400000);
export const raidDaily = () => RAID().daily || 3;
export const raidLeft = (row, now) =>
  Math.max(0, raidDaily() - ((row && row.day === dayOf(now)) ? (row.today | 0) : 0));
