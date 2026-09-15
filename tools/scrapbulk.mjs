/* 등급별 일괄 분해가 **무엇을 지우는가** — 되돌릴 수 없으므로 따로 검사한다.
 *
 * 화면(js/game.js)이 "27개 분해 +1,176" 이라고 적어 주고 서버가 다른 것을 지우면
 * 플레이어는 무엇이 사라졌는지 영영 모른다. 그래서 보는 것 넷.
 *
 *   ① 끼고 있는 파츠는 **절대** 대상에 안 든다
 *   ② keepEnhanced 면 강화한 파츠도 안 든다 (기본값이다)
 *   ③ 받는 스크랩이 화면이 센 값과 같다 — 둘 다 js/gacha.js 의 scrapGain 을 쓴다
 *   ④ 등급을 섞어 놓아도 고른 등급만 건드린다
 *
 * node tools/scrapbulk.mjs
 */
import { RARITY, SLOTS } from '../data/balance.js';
import { scrapGain } from '../js/gacha.js';
import { bulkTargets, wornIds } from '../server/hangar.js';

const G = s => '\x1b[32m' + s + '\x1b[0m', R = s => '\x1b[31m' + s + '\x1b[0m';
let fail = 0;
const is = (c, m) => { console.log('  ' + (c ? G('✓') : R('✗')) + ' ' + m); if (!c) fail++; };

/* 표를 흉내 낸다 — id 는 정수(서버가 읽은 값), enh 는 0 이상 */
let nid = 1;
const part = (rarity, enh = 0) => ({ id: nid++, uid: 'u' + nid, rarity, enh, slot: SLOTS[nid % 4] });

console.log('== 일괄 분해 대상 고르기 ==');

/* ① 장착 중인 것은 안 지운다 */
{
  const ps = [part('C'), part('C'), part('C'), part('C')];
  const worn = wornIds([{ s_weapon: ps[0].id, s_frame: ps[2].id, s_booster: null, s_core: null }]);
  const { hit } = bulkTargets(ps, worn, false);
  is(hit.length === 2, `장착 2개를 뺀 2개만 대상 (실제 ${hit.length}개)`);
  is(!hit.some(x => worn.has(x.id)), '대상에 장착 중인 파츠가 하나도 없다');
}

/* ② 강화한 것 남기기 */
{
  const ps = [part('R', 0), part('R', 3), part('R', 0), part('R', 10)];
  const keep = bulkTargets(ps, new Set(), true), all = bulkTargets(ps, new Set(), false);
  is(keep.hit.length === 2, `남기기 켜면 강화 안 한 2개만 (실제 ${keep.hit.length}개)`);
  is(!keep.hit.some(x => x.enh > 0), '남기기 켜면 강화한 파츠가 대상에 없다');
  is(all.hit.length === 4, `남기기 끄면 4개 전부 (실제 ${all.hit.length}개)`);
  is(all.gain > keep.gain, '남기기를 끄면 받는 스크랩이 더 많다');
}

/* ③ 화면이 세는 값과 같은가 — 같은 함수를 쓰므로 같아야 한다 */
{
  const ps = [part('SSR', 0), part('SSR', 5), part('SR', 2), part('C', 0)];
  const { hit, gain } = bulkTargets(ps, new Set(), false);
  const byHand = hit.reduce((t, p) => t + scrapGain(p.rarity, p.enh), 0);
  is(gain === byHand, `합계가 scrapGain 의 합과 같다 (${gain})`);
  is(scrapGain('SSR', 4) > scrapGain('SSR', 0), '강화한 파츠를 더 쳐 준다');
}

/* ④ 고른 등급만 — 핸들러가 rarity 로 먼저 거르므로 그 입력을 그대로 흉내 낸다 */
{
  const mixed = [part('C'), part('R'), part('C'), part('SSR'), part('C')];
  const onlyC = mixed.filter(p => p.rarity === 'C');
  const { hit } = bulkTargets(onlyC, new Set(), false);
  is(hit.length === 3 && hit.every(x => x.rarity === 'C'), 'C 만 골랐을 때 C 3개');
}

/* ⑤ 빈 경우에 터지지 않는다 */
{
  const { hit, gain } = bulkTargets([], new Set(), true);
  is(hit.length === 0 && gain === 0, '대상이 없으면 0개 · 0 스크랩');
}

/* ⑥ 모든 등급이 분해값을 갖는다 — 0 이면 일괄 분해가 헛돈다 */
for (const r of RARITY) is(scrapGain(r.k, 0) > 0, `${r.k} 의 분해값이 0 이 아니다 (${scrapGain(r.k, 0)})`);

console.log(fail ? R(`\n${fail}개 실패`) : G('\n전부 통과'));
process.exitCode = fail ? 1 : 0;
