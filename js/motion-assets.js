/* 공격 모션 그림 목록 — **tools/spritecheck.py all --write 가 만든다. 손으로 고치지 않는다.**
 * 검사를 통과한 그림만 오른다. 없는 종류 · 기체는 js/motion.js 가 코드로 그린 대체 연출을 쓴다.
 *   atlas  { 종류 | 'status-a' | 'status-b': 경로 }      assets/effects/motion-<이름>.png
 *   pose   { 기체 id: { src, dx, dy } }                  assets/motions/attack/<id>.png · dx · dy = 원본(440×420)에 맞추는 이동(px)
 */
export const MOTION_ASSETS = {
  atlas: {"cannon": "assets/effects/motion-cannon.png?v=1791355392", "slash": "assets/effects/motion-slash.png?v=1791355392", "status-a": "assets/effects/motion-status-a.png?v=1791355559"},
  pose: {"azure": {"src": "assets/motions/attack/azure.png?v=1791415679", "dx": 0, "dy": 0}, "kestrel": {"src": "assets/motions/attack/kestrel.png?v=1791354785", "dx": 0, "dy": 0}},
};
