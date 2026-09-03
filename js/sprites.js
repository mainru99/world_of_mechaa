/* 스프라이트 — id 목록을 밸런스 데이터에서 파생한다.
 * 기체/몬스터를 추가할 때 이 파일을 고칠 필요가 없다(예전엔 목록이 여기 박혀 있었다).
 *
 *   기체   assets/<id>.png
 *   몬스터 assets/monsters/<id>.png
 * 모두 440x420 투명 캔버스, 바닥 그림자 제거, 발끝 y=408 정렬.
 *
 * [방향 규칙] 원본 그림은 전부 '왼쪽'을 본다(장비·날개가 오른쪽으로 뻗음).
 * sprite(id, faceRight) — faceRight=true 면 좌우 반전해 오른쪽을 보게 한다.
 * 아레나는 내 기체가 왼쪽에 서므로 true, 상대는 오른쪽에 서므로 false 를 줘야 마주본다.
 * 초상화(격납고/뽑기)는 원본 방향 그대로 쓴다.
 * 오른쪽을 보는 그림을 추가하면 FACE_RIGHT 에 id 를 넣으면 된다. */
import { ROBOT_IDS, MONSTER_IDS, isMonster } from './units.js';

const FACE_RIGHT = {};                  // 원본이 이미 오른쪽을 보는 id
const CACHE_BUST = '?v=20260904-split';

export const assetPath = id => 'assets/' + (isMonster(id) ? 'monsters/' : '') + id + '.png' + CACHE_BUST;

export function sprite(id, faceRight) {
  const known = ROBOT_IDS.includes(id) || MONSTER_IDS.includes(id);
  const useId = known ? id : ROBOT_IDS[0];
  const flip = !!FACE_RIGHT[useId] !== !!faceRight;
  return '<img class="mecha' + (flip ? ' flip' : '') + '" src="' + assetPath(useId) +
         '" alt="' + useId + '" draggable="false">';
}

/* 전투 중 첫 표시가 늦지 않도록 미리 받아둔다 */
export function preloadSprites() {
  for (const id of [...ROBOT_IDS, ...MONSTER_IDS]) { const i = new Image(); i.src = assetPath(id); }
}
