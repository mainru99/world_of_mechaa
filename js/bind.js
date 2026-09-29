/* 파츠 귀속 — 순수 규칙. DOM 없음. 서버와 화면이 같이 import 한다. (2026-09-28 사용자 결정)
 *
 *   · 파츠는 **처음 끼는 순간 그 기체에 귀속**된다. 떼어도 그 기체 것으로 남는다(part.bound = robot.id)
 *   · 다른 기체에 끼우려면 **귀속을 푼다** — 정제 코어 CONST.PART_BIND.unbind 개
 *   · 빌드 프리셋은 **기체마다**(robot.presets) — 그 기체에 귀속된 파츠 · 풀린 파츠로만 만든다
 *   · 합성 재료는 모두 풀렸거나 **같은 기체**에 귀속돼 있어야 한다. 결과는 그 귀속을 이어받는다
 *     (합성으로 귀속을 푸는 길을 막는다)
 *   · 분해는 귀속과 무관하다
 *
 * **스위치 `CONST.PART_BIND.on` 이 꺼져 있으면 아무것도 막지 않고 기록하지도 않는다**(예전과 똑같다).
 * 켤 때 `tools/bindnow.sql` 로 '지금 끼고 있는 파츠 = 그 기체에 귀속' 을 한 번 채운다(사용자 결정 — 인벤토리 것은 풀린 채).
 * 이유를 보여 줄 화면(귀속 표시 · 해제 단추)이 UI 개편에서 나온 뒤 켠다.
 */
import { CONST } from '../data/balance.js';

const B = () => CONST.PART_BIND || {};
export const bindOn = () => !!B().on;
export const unbindCost = () => Math.max(0, B().unbind ?? 1);

/* 이 파츠를 이 기체에 끼워도 되는가. bound — 파츠의 귀속 기체 id(없으면 null) · robotId — 끼울 기체 id.
   → null 이면 된다 · 아니면 오류 이름 */
export function equipCheck(bound, robotId) {
  if (!bindOn() || bound == null) return null;
  return bound === robotId ? null : 'part bound';
}

/* 합성 재료의 귀속. → { ok, bound } — bound 는 결과가 이어받을 기체 id(모두 풀렸으면 null) */
export function fuseBind(bounds) {
  if (!bindOn()) return { ok: true, bound: null };
  const set = new Set((bounds || []).filter(b => b != null));
  if (set.size > 1) return { ok: false, bound: null };
  return { ok: true, bound: set.size ? [...set][0] : null };
}

/* 프리셋 적용 — 칸마다 쓸 수 있는가. rows: [{ uid, bound }] · robotId 적용할 기체.
   → { use: Set(uid), blocked: [uid] } — blocked 는 다른 기체에 귀속돼 건너뛴 파츠 */
export function presetBindFilter(rows, robotId) {
  const use = new Set(), blocked = [];
  for (const r of rows || []) {
    if (!bindOn() || r.bound == null || r.bound === robotId) use.add(r.uid);
    else blocked.push(r.uid);
  }
  return { use, blocked };
}
