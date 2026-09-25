/* ==================================================================
 * ROWAR - 밸런스 데이터 (ChatGPT 담당 · CONTRACT.md 참조)
 *
 * 클라이언트와 Cloudflare Worker 가 **같은 파일을** import 한다.
 * 사본을 두면 반드시 어긋나고, 어긋나는 순간 서버가 정상 파츠를 위조로 판정한다.
 *
 * 그래서 이 파일은 다음을 지킨다.
 *   - window / document / DOM 을 참조하지 않는다 (Worker 에는 없다)
 *   - 최상위 부작용이 없다. const 선언과 export 만 — 함수도 두지 않는다
 *   - 기체 id 는 저장본(rowar.save.v2)의 robots[].type 이다. 추가는 안전,
 *     이름 변경·삭제는 남의 저장본을 날린다 (normalize 가 모르는 id 를 걸러낸다)
 *   - 스탯은 hp atk def spd crit eva 여섯 종류. crit/eva 는 비율(0~1)
 *   - skill.fx 키는 mult hits ignoreDef noMiss alwaysCrit drain 여섯 개.
 *     새 키는 시뮬이 조용히 무시하므로 CONTRACT.md 에 먼저 적을 것
 * ================================================================== */

/* 로봇 등급 (뽑기 가중치 w 합계 = 100) */
export const ROBOT_RARITY = [
  {k:'C',  ko:'커먼',   w:44},
  {k:'UC', ko:'언커먼', w:28},
  {k:'R',  ko:'레어',   w:17},
  {k:'UQ', ko:'유니크', w:8 },
  {k:'EP', ko:'에픽',   w:3 } ];

/* 뽑기 결과 확률(합 100). 파츠만 쏟아지지 않게 크레딧·코어·꽝을 섞었다 */
export const PULL_TABLE = [ {k:'robot',w:12}, {k:'core',w:1.5}, {k:'credit',w:22}, {k:'part',w:45}, {k:'bust',w:19.5} ];

/* 크레딧 뽑기 — 코어가 없어도 돌릴 수 있는 두 번째 창구.
   코어는 벌기 어려운 재화라 뽑기가 통째로 멈추는 때가 있다. 크레딧은 대전·점령지에서
   꾸준히 들어오므로, 확률을 낮추는 대신 '돌릴 수는 있는' 길을 하나 열어 둔다.
   크레딧으로 크레딧이 나오면 무의미하므로 그 칸은 빼고 꽝을 늘렸다. */
export const PULL_TABLE_CR = [ {k:'robot',w:7}, {k:'core',w:1}, {k:'part',w:58}, {k:'bust',w:34} ];

/* 크레딧 뽑기에서 기체가 나왔을 때의 등급 분포. 코어 쪽보다 훨씬 아래로 쏠린다.
   에픽은 7% × 0.8% = 뽑기 1회당 0.056% — 1,800회쯤에 한 번이다.
   0 으로 두지 않은 것은 '그래도 나올 수는 있다'가 있어야 돌릴 이유가 생기기 때문이다. */
export const ROBOT_RARITY_CR = [
  {k:'C',  ko:'커먼',   w:57.7},
  {k:'UC', ko:'언커먼', w:26  },
  {k:'R',  ko:'레어',   w:12  },
  {k:'UQ', ko:'유니크', w: 3.5},
  {k:'EP', ko:'에픽',   w: 0.8} ];

/* 정제 코어 뽑기(2026-09-25 사용자 지시) — 정제 코어 1개로 1회. **코어 뽑기보다 소폭 높다.**
   기체 칸 12 → 15 · 꽝 19.5 → 16. 기체 등급은 에픽 3 → 4.5 · 유니크 8 → 10 으로 조금 위로.
   파츠 등급은 모든 창구가 같은 RARITY 를 쓴다 — 여기서는 파츠가 나올 확률만 조금 올렸다. */
export const PULL_TABLE_RC = [ {k:'robot',w:15}, {k:'core',w:1.5}, {k:'credit',w:20}, {k:'part',w:47.5}, {k:'bust',w:16} ];
export const ROBOT_RARITY_RC = [
  {k:'C',  ko:'커먼',   w:40  },
  {k:'UC', ko:'언커먼', w:27.5},
  {k:'R',  ko:'레어',   w:18  },
  {k:'UQ', ko:'유니크', w:10  },
  {k:'EP', ko:'에픽',   w: 4.5} ];

/* 기체 30종 · 등급마다 6종 */
/* 2026-09-10 기체 고유 특성 조정.
   등급별 평균과 여섯 단계 속도 구조를 유지하되, 30종 모두 역할·능력치·스킬 수치 조합이
   다르다. 생존·일반 공격·스킬 화력·방어·공속·치명타·회피·정밀·관통·연격·흡혈 중
   주력을 하나씩 갈랐다. Lv.1/30/60 등급 내 승률은 36.0~64.3%, 기준 밖은 0기체다. */
/* 성장(grow)은 등급이 낮을수록 '기본값 대비' 크게 잡아, 레벨을 올릴수록 등급 격차가 좁혀지도록 했다.
   Lv.1 에선 인접 등급이 14~20% 차이나지만 Lv.45 에선 5~6% 로 줄어 하위 등급도 끝까지 쓸 만하다. */
export const ROBOT_TYPES = {
  /* ---- 커먼 ---- */
  mule:{ id:'mule', name:"MULE", rarity:'C', role:"초중량 생존형 · 워커",
    base:{hp:706,atk:67,def:67,spd:35,crit:.04,eva:.035}, grow:{hp:74,atk:8.8,def:7.7,spd:3.11}, spread:.22,
    skill:{name:"해머 다운", desc:"1.5배 강타. 빗나가지 않음.", fx:{mult:1.5,noMiss:true}} },
  dune:{ id:'dune', name:"DUNE", rarity:'C', role:"치명 정밀형 · 트루퍼",
    base:{hp:363,atk:73,def:40,spd:58,crit:.145,eva:.055}, grow:{hp:46.3,atk:9.6,def:5.5,spd:5.09}, spread:.1,
    skill:{name:"데드아이 샷", desc:"1.45배 확정 치명타 단발 사격.", fx:{mult:1.45,alwaysCrit:true}} },
  /* ---- 언커먼 ---- */
  ranger:{ id:'ranger', name:"RANGER", rarity:'UC', role:"치명 저격형 · 마크스맨",
    base:{hp:439,atk:71,def:50,spd:67,crit:.18,eva:.075}, grow:{hp:44.9,atk:8.3,def:5.6,spd:5.61}, spread:.11,
    skill:{name:"크리티컬 피어서", desc:"방어력 45%를 관통하는 1.35배 확정 치명타.", fx:{mult:1.35,ignoreDef:.45,alwaysCrit:true}} },
  vanguard:{ id:'vanguard', name:"VANGUARD", rarity:'UC', role:"대구경 화력형 · 헤비",
    base:{hp:529,atk:102,def:56,spd:44,crit:.075,eva:.04}, grow:{hp:54,atk:12,def:6.3,spd:3.68}, spread:.4,
    skill:{name:"풀 버스트", desc:"2.2배 대폭격. 회피 불가.", fx:{mult:2.2,noMiss:true}} },
  /* ---- 레어 ---- */
  azure:{ id:'azure', name:"AZURE", rarity:'R', role:"초고속 치명형 · 스트라이커",
    base:{hp:442,atk:78,def:50,spd:70,crit:.2,eva:.11}, grow:{hp:47,atk:8.1,def:5.8,spd:5.57}, spread:.22,
    skill:{name:"크리티컬 슬래시", desc:"0.9배 확정 치명타 참격을 3회.", fx:{mult:.9,hits:3,alwaysCrit:true}} },
  glacier:{ id:'glacier', name:"GLACIER", rarity:'R', role:"빙벽 생존형 · 가디언",
    base:{hp:848,atk:85,def:99,spd:39,crit:.08,eva:.06}, grow:{hp:65.8,atk:8.9,def:8.4,spd:3.13}, spread:.14,
    skill:{name:"프로스트 브레이커", desc:"방어력 45% 관통 1.65배 강타. 회피 불가, 피해 15% 흡수.", fx:{mult:1.65,ignoreDef:.45,noMiss:true,drain:.15}} },
  /* ---- 유니크 ---- */
  wraith:{ id:'wraith', name:"WRAITH", rarity:'UQ', role:"흡혈 생존형 · 리퍼",
    base:{hp:1042,atk:94,def:95,spd:42,crit:.14,eva:.1}, grow:{hp:75.8,atk:8.6,def:7.5,spd:3.13}, spread:.16,
    skill:{name:"소울 드레인", desc:"2.2배 강타. 준 피해의 50%를 흡수한다.", fx:{mult:2.2,drain:.5}} },
  oracle:{ id:'oracle', name:"ORACLE", rarity:'UQ', role:"예지 치명형 · 시어",
    base:{hp:658,atk:87,def:75,spd:75,crit:.25,eva:.09}, grow:{hp:54.3,atk:8,def:6.8,spd:5.57}, spread:.11,
    skill:{name:"프리딕션", desc:"1.55배 확정 치명타 단발. 빗나가지 않음.", fx:{mult:1.55,alwaysCrit:true,noMiss:true}} },
  /* ---- 에픽 ---- */
  /* EP도 다른 등급과 같은 여섯 단계 구조다. ATLAS→SERAPH→AURIC→NEMESIS→TYRANT→IGNIS
     순으로 빨라지며, base와 grow에 같은 방향을 주어 레벨이 올라가도 개성이 사라지지 않는다.
     등급 전체 성장량은 이전 합계와 같고 Lv.60 등급 내 승률은 35~65% 범위다. */
  seraph:{ id:'seraph', name:"SERAPH", rarity:'EP', role:"고화력 흡혈형 · 아크엔젤",
    base:{hp:872.6,atk:161.9,def:93.7,spd:58,crit:.16,eva:.11}, grow:{hp:54.06,atk:11.71,def:6.41,spd:3.61}, spread:.18,
    skill:{name:"세이크리드 랜스", desc:"방어력 50% 관통 2.0배. 회피 불가, 피해 35% 흡수.", fx:{mult:2,ignoreDef:.5,noMiss:true,drain:.35}} },
  nemesis:{ id:'nemesis', name:"NEMESIS", rarity:'EP', role:"불안정 관통포형 · 오버로드",
    base:{hp:704,atk:162,def:76,spd:72,crit:.17,eva:.12}, grow:{hp:42.4,atk:11.7,def:5,spd:4.47}, spread:.42,
    skill:{name:"카오스 버스트", desc:"방어력 50%를 관통하는 0.95배 폭격을 4회.", fx:{mult:.95,hits:4,ignoreDef:.5}} },
  /* ---- 세트 02: 같은 등급의 기존 기체를 기준으로 무작위 생성한 고정 스펙 ---- */
  rust:{ id:'rust', name:"RUST", rarity:'C', role:"저속 폭발형 · 브롤러",
    base:{hp:465,atk:90,def:51,spd:41,crit:.045,eva:.04}, grow:{hp:51.2,atk:12,def:6.2,spd:3.63}, spread:.38,
    skill:{name:"아이언 너클", desc:"2.05배의 묵직한 한 방. 빗나갈 수 있음.", fx:{mult:2.05}} },
  scarab:{ id:'scarab', name:"SCARAB", rarity:'C', role:"초고속 연격형 · 스카우트",
    base:{hp:403,atk:63,def:47,spd:63,crit:.09,eva:.065}, grow:{hp:46,atk:8.3,def:5.9,spd:5.53}, spread:.28,
    skill:{name:"스웜 임팩트", desc:"0.55배 타격을 4회. 각각 치명타·회피 판정.", fx:{mult:.55,hits:4}} },
  bastion:{ id:'bastion', name:"BASTION", rarity:'UC', role:"초중량 요새형 · 미사일러",
    base:{hp:795,atk:72,def:72,spd:37,crit:.07,eva:.035}, grow:{hp:76.4,atk:8.4,def:7.7,spd:3.16}, spread:.31,
    skill:{name:"미사일 레인", desc:"0.7배 미사일을 3회 발사. 모두 회피 불가.", fx:{mult:.7,hits:3,noMiss:true}} },
  kestrel:{ id:'kestrel', name:"KESTREL", rarity:'UC', role:"극관통 정밀형 · 헌터",
    base:{hp:437,atk:92,def:50,spd:54,crit:.1,eva:.055}, grow:{hp:38.8,atk:10.8,def:4.9,spd:4.56}, spread:.08,
    skill:{name:"피어싱 캐논", desc:"방어력 75%를 관통하는 2.0배 정밀 포격.", fx:{mult:2,ignoreDef:.75}} },
  tempest:{ id:'tempest', name:"TEMPEST", rarity:'R', role:"극회피 난사형 · 인터셉터",
    base:{hp:515,atk:85,def:57,spd:65,crit:.15,eva:.2}, grow:{hp:50.1,atk:8.9,def:6,spd:5.13}, spread:.3,
    skill:{name:"스톰 러시", desc:"0.65배 사격을 4회. 각각 치명타·회피 판정.", fx:{mult:.65,hits:4}} },
  cobalt:{ id:'cobalt', name:"COBALT", rarity:'R', role:"내구 돌파형 · 브레이커",
    base:{hp:606,atk:102,def:62,spd:52,crit:.11,eva:.08}, grow:{hp:48.9,atk:10.7,def:5.4,spd:4.09}, spread:.25,
    skill:{name:"코발트 브레이크", desc:"방어력 65% 관통 1.9배 포격. 빗나가지 않음.", fx:{mult:1.9,ignoreDef:.65,noMiss:true}} },
  specter:{ id:'specter', name:"SPECTER", rarity:'UQ', role:"극회피 비트형 · 비트 마스터",
    base:{hp:521,atk:98,def:60,spd:69,crit:.19,eva:.23}, grow:{hp:47.5,atk:9,def:6,spd:5.13}, spread:.2,
    skill:{name:"팬텀 비트", desc:"0.52배 확정 치명타 비트 사격을 4회.", fx:{mult:.52,hits:4,alwaysCrit:true}} },
  umbra:{ id:'umbra', name:"UMBRA", rarity:'UQ', role:"장갑 흡수형 · 블레이더",
    base:{hp:589,atk:115,def:83,spd:55,crit:.16,eva:.12}, grow:{hp:43.6,atk:10.6,def:6.7,spd:4.09}, spread:.23,
    skill:{name:"보이드 엣지", desc:"방어력 35% 관통 1.8배 참격. 피해의 45%를 흡수한다.", fx:{mult:1.8,ignoreDef:.35,drain:.45}} },
  tyrant:{ id:'tyrant', name:"TYRANT", rarity:'EP', role:"극회피 제압형 · 디스트로이어",
    base:{hp:685,atk:131,def:75,spd:82,crit:.19,eva:.24}, grow:{hp:51.1,atk:9.5,def:6.2,spd:5.07}, spread:.3,
    skill:{name:"헬파이어 살보", desc:"0.65배 포격을 5회. 모두 회피 불가.", fx:{mult:.65,hits:5,noMiss:true}} },
  atlas:{ id:'atlas', name:"ATLAS", rarity:'EP', role:"스킬 결전형 · 타이탄",
    base:{hp:1291.2,atk:106.2,def:137.5,spd:50,crit:.13,eva:.08}, grow:{hp:60.36,atk:7.68,def:7.08,spd:3.1}, spread:.12,
    skill:{name:"타이탄 크러시", desc:"방어력 70% 관통 2.8배 강타. 회피 불가, 피해 15% 흡수.", fx:{mult:2.8,ignoreDef:.7,noMiss:true,drain:.15}} },
  /* ---- 세트 03: 3rd.png의 등급별 기체, 기존 등급 기준 무작위 고정 스펙 ---- */
  grit:{ id:'grit', name:"GRIT", rarity:'C', role:"장갑 관통형 · 가드",
    base:{hp:456,atk:78,def:61,spd:46,crit:.055,eva:.045}, grow:{hp:47.1,atk:10.3,def:6.9,spd:4.06}, spread:.16,
    skill:{name:"브레이스 펀치", desc:"방어력 35% 관통 1.4배 강타. 빗나가지 않음.", fx:{mult:1.4,ignoreDef:.35,noMiss:true}} },
  chalk:{ id:'chalk', name:"CHALK", rarity:'C', role:"회피 기동형 · 러너",
    base:{hp:415,atk:74,def:45,spd:51,crit:.065,eva:.12}, grow:{hp:48.6,atk:9.8,def:5.8,spd:4.49}, spread:.25,
    skill:{name:"화이트 러시", desc:"0.72배 타격을 3회. 각각 치명타·회피 판정.", fx:{mult:.72,hits:3}} },
  tracer:{ id:'tracer', name:"TRACER", rarity:'UC', role:"회피 추적형 · 트래커",
    base:{hp:483,atk:77,def:54,spd:61,crit:.12,eva:.14}, grow:{hp:51.5,atk:9,def:6.4,spd:5.17}, spread:.16,
    skill:{name:"호밍 더블", desc:"0.85배 추적탄을 2회 발사. 모두 회피 불가.", fx:{mult:.85,hits:2,noMiss:true}} },
  mantis:{ id:'mantis', name:"MANTIS", rarity:'UC', role:"중장 파쇄형 · 인포서",
    base:{hp:509,atk:88,def:69,spd:49,crit:.085,eva:.045}, grow:{hp:49.4,atk:10.3,def:7.4,spd:4.12}, spread:.18,
    skill:{name:"프레셔 버스트", desc:"방어력 35% 관통 1.55배 포격. 회피 불가.", fx:{mult:1.55,ignoreDef:.35,noMiss:true}} },
  howitzer:{ id:'howitzer', name:"HOWITZER", rarity:'R', role:"초화력 포격형 · 시즈",
    base:{hp:604,atk:121,def:64,spd:46,crit:.09,eva:.07}, grow:{hp:51.1,atk:12.7,def:5.9,spd:3.65}, spread:.42,
    skill:{name:"시즈 캐논", desc:"방어력 40%를 관통하는 2.35배 포격. 빗나갈 수 있음.", fx:{mult:2.35,ignoreDef:.4}} },
  lancer:{ id:'lancer', name:"LANCER", rarity:'R', role:"균형 연속관통형 · 랜서",
    base:{hp:557,atk:97,def:61,spd:57,crit:.13,eva:.1}, grow:{hp:50.7,atk:10.1,def:6.1,spd:4.52}, spread:.18,
    skill:{name:"트리플 피어스", desc:"방어력 30%를 관통하는 0.8배 찌르기 3회.", fx:{mult:.8,hits:3,ignoreDef:.3}} },
  hex:{ id:'hex', name:"HEX", rarity:'UQ', role:"불안정 폭딜형 · 워록",
    base:{hp:646,atk:137,def:70,spd:49,crit:.15,eva:.11}, grow:{hp:51,atk:12.6,def:6.1,spd:3.65}, spread:.4,
    skill:{name:"헥스 디스차지", desc:"2.75배 전격. 준 피해의 20%를 흡수한다.", fx:{mult:2.75,drain:.2}} },
  halo:{ id:'halo', name:"HALO", rarity:'UQ', role:"초정밀 관통형 · 컨덕터",
    base:{hp:600,atk:109,def:67,spd:61,crit:.18,eva:.13}, grow:{hp:41.3,atk:10,def:5,spd:4.52}, spread:.08,
    skill:{name:"오비탈 포커스", desc:"방어력 75% 관통 1.8배 사격. 빗나가지 않음.", fx:{mult:1.8,ignoreDef:.75,noMiss:true}} },
  auric:{ id:'auric', name:"AURIC", rarity:'EP', role:"치명 장갑형 · 골드 가디언",
    base:{hp:889.8,atk:143.6,def:102.1,spd:65,crit:.2,eva:.1}, grow:{hp:61.38,atk:10.41,def:7.79,spd:4.04}, spread:.08,
    skill:{name:"골든 임팩트", desc:"1.8배 확정 치명타 강타. 빗나가지 않음.", fx:{mult:1.8,alwaysCrit:true,noMiss:true}} },
  ignis:{ id:'ignis', name:"IGNIS", rarity:'EP', role:"초고속 치명포형 · 피닉스",
    base:{hp:729,atk:111,def:83,spd:89,crit:.25,eva:.13}, grow:{hp:46.9,atk:8,def:5.9,spd:5.5}, spread:.24,
    skill:{name:"이그니스 레인", desc:"방어력 40%를 관통하는 0.5배 확정 치명타 사격을 5회.", fx:{mult:.5,hits:5,ignoreDef:.4,alwaysCrit:true}} },
  /* ---- 세트 03 (2026-09-21) · 특화기술 ────────────────────────────
     사용자가 그려 온 13기. 이름 · 역할 · 수치 · 스킬은 Claude 가 붙였다.
     지금까지의 30종은 스킬이 전부 '때리는 방식'의 조합이었다(배수 · 연타 · 관통 · 필중 · 확정 치명 · 흡혈).
     그래서 **지키고 · 받치고 · 흔드는** 기체가 없었다. 세트 03 은 그 빈자리를 특화기술로 채운다(js/sim.js).
       shield 방벽 · repair 수리 · mark 표적 · shred 장갑 파쇄 · jam 재밍 · execute 마무리
     합동전에서는 방벽 · 수리가 **더 다친 아군**에게 간다 — 후위 지원기라는 자리가 생긴다.
     보스 요구 조건의 답도 된다 — 중장갑 ← 장갑 파쇄 · 과충전 · 광폭화 ← 재밍 · 재생 ← 마무리. */
  husk:{ id:'husk', name:"HUSK", rarity:'C', role:"방벽 생존형 · 실더",
    base:{hp:520,atk:70,def:62,spd:42,crit:.05,eva:.04}, grow:{hp:53,atk:9.4,def:7.2,spd:3.6}, spread:.2,
    skill:{name:"셸 업", desc:"1.2배 타격 뒤 최대 내구의 13%만큼 방벽을 두른다. 쓸 때마다 방벽이 30%씩 얇아진다.", fx:{mult:1.2,shield:.13}} },
  mortar:{ id:'mortar', name:"MORTAR", rarity:'C', role:"장갑 파쇄 포격형 · 브레이커",
    base:{hp:470,atk:88,def:50,spd:43,crit:.06,eva:.04}, grow:{hp:50,atk:10.8,def:6.1,spd:3.8}, spread:.32,
    skill:{name:"크랙 셸", desc:"1.9배 포격. 맞으면 상대 방어력이 15% 깎인다(전투 끝까지 쌓이고 최대 30%).", fx:{mult:1.9,shred:.15}} },
  lens:{ id:'lens', name:"LENS", rarity:'C', role:"정찰 표적형 · 스포터",
    base:{hp:420,atk:70,def:46,spd:57,crit:.1,eva:.08}, grow:{hp:48,atk:9.3,def:5.8,spd:4.9}, spread:.15,
    skill:{name:"타깃 락", desc:"상대에게 표적을 새긴 뒤(받는 피해 +17%, 전투 끝까지) 빗나가지 않는 1.3배 사격.", fx:{mult:1.3,noMiss:true,mark:.17}} },
  static:{ id:'static', name:"STATIC", rarity:'C', role:"전파 교란형 · 재머",
    base:{hp:450,atk:69,def:52,spd:52,crit:.06,eva:.07}, grow:{hp:52,atk:9.5,def:6.3,spd:4.5}, spread:.24,
    skill:{name:"노이즈 버스트", desc:"1.35배 전파탄. 상대의 SP 를 30 깎고 행동을 늦춘다.", fx:{mult:1.35,jam:30}} },
  swift:{ id:'swift', name:"SWIFT", rarity:'UC', role:"고기동 마무리형 · 인터셉터",
    base:{hp:470,atk:80,def:52,spd:64,crit:.13,eva:.1}, grow:{hp:47,atk:10,def:5.8,spd:5.3}, spread:.2,
    skill:{name:"다이브 샷", desc:"0.85배 강하 사격 2회. 체력 35% 미만인 상대에게는 1.75배로 들어간다.", fx:{mult:.85,hits:2,execute:.75}} },
  shrike:{ id:'shrike', name:"SHRIKE", rarity:'UC', role:"참격 파쇄형 · 슬래셔",
    base:{hp:500,atk:84,def:55,spd:53,crit:.11,eva:.09}, grow:{hp:50,atk:9.8,def:6.1,spd:4.4}, spread:.22,
    skill:{name:"리퍼 컷", desc:"0.52배 참격 4회. 맞을 때마다 상대 방어력이 2.5% 깎인다(최대 30%).", fx:{mult:.52,hits:4,shred:.025}} },
  patch:{ id:'patch', name:"PATCH", rarity:'UC', role:"수리 지원형 · 메카닉",
    base:{hp:580,atk:84,def:56,spd:47,crit:.08,eva:.05}, grow:{hp:55,atk:9.2,def:6.8,spd:4}, spread:.18,
    skill:{name:"필드 리페어", desc:"1.3배 사격 뒤 최대 내구의 14%를 수리한다(쓸 때마다 30%씩 줄어든다). 합동전에서는 더 다친 아군을 고친다.", fx:{mult:1.3,repair:.14}} },
  vega:{ id:'vega', name:"VEGA", rarity:'R', role:"결전 저격형 · 헌트리스",
    base:{hp:520,atk:104,def:58,spd:60,crit:.15,eva:.1}, grow:{hp:51,atk:11,def:5.9,spd:4.7}, spread:.12,
    skill:{name:"엔드 오브 라인", desc:"빗나가지 않는 1.8배 저격. 체력 35% 미만인 상대에게는 2배로 들어간다.", fx:{mult:1.8,noMiss:true,execute:1}} },
  orbit:{ id:'orbit', name:"ORBIT", rarity:'R', role:"비트 표적형 · 프로젝터",
    base:{hp:560,atk:90,def:62,spd:58,crit:.13,eva:.12}, grow:{hp:50,atk:9.7,def:6.2,spd:4.5}, spread:.2,
    skill:{name:"사일런트 비트", desc:"표적을 새기고(받는 피해 +15%) 빗나가지 않는 0.6배 비트 사격 4회.", fx:{mult:.6,hits:4,noMiss:true,mark:.15}} },
  zealot:{ id:'zealot', name:"ZEALOT", rarity:'UQ', role:"교란 제압형 · 인퀴지터",
    base:{hp:720,atk:110,def:78,spd:55,crit:.16,eva:.11}, grow:{hp:55,atk:10,def:6.6,spd:4.1}, spread:.2,
    skill:{name:"침묵의 종", desc:"1.9배 철퇴. 상대의 SP 를 50 깎고 행동을 크게 늦춘다.", fx:{mult:1.9,jam:50}} },
  nebula:{ id:'nebula', name:"NEBULA", rarity:'UQ', role:"방벽 흡수형 · 오브 가디언",
    base:{hp:760,atk:112,def:82,spd:50,crit:.14,eva:.1}, grow:{hp:53,atk:10,def:6.9,spd:3.8}, spread:.18,
    skill:{name:"이벤트 셸", desc:"1.5배 오브 폭발로 피해 10% 흡수, 이어서 최대 내구 15%만큼 방벽. 방벽은 쓸 때마다 30%씩 얇아진다.", fx:{mult:1.5,drain:.1,shield:.15}} },
  sovereign:{ id:'sovereign', name:"SOVEREIGN", rarity:'EP', role:"파쇄 결전형 · 데몬로드",
    base:{hp:780,atk:150,def:85,spd:70,crit:.18,eva:.12}, grow:{hp:48,atk:10.8,def:6,spd:4.5}, spread:.3,
    skill:{name:"폴른 크라운", desc:"0.8배 마검 4연격. 맞을 때마다 방어 5% 파쇄(최대 30%), 체력 35% 미만인 상대에게는 1.5배.", fx:{mult:.8,hits:4,shred:.05,execute:.5}} },
  behemoth:{ id:'behemoth', name:"BEHEMOTH", rarity:'EP', role:"요새 수호형 · 시타델",
    base:{hp:1179.7,atk:121.1,def:123.1,spd:52,crit:.14,eva:.07}, grow:{hp:59.5,atk:8.62,def:7.39,spd:3.3}, spread:.2,
    skill:{name:"옵시디언 배리어", desc:"표적을 새기고(+12%) 방어 40% 관통 1.9배 포격, 이어서 최대 내구 22%만큼 방벽(쓸 때마다 30%씩 얇아진다).", fx:{mult:1.9,ignoreDef:.4,mark:.12,shield:.22}} },

  /* ---- 세트 04 (2026-09-23) · R 열 기체 · 성장 곡선 ──────────────────
     사용자가 그려 온 10기. 전부 R 이고 이름 · 역할 · 수치 · 스킬은 Claude 가 붙였다.
     R 은 8종 → 18종이 된다. 고른 자리는 **계보(개발 트리)가 비어 있던 칸**이다 —
     교란 · 수리 · 파쇄 · 방벽이 R 에 없어서 C·UC 에서 UQ 로 건너뛰는 연결이 억지였다
     (docs/balance/lineage-plan-2026-09-22.md 의 특화기술 표).

     **성장이 직선이 아닌 기체를 처음 넣는다(`curve`).** Lv.MAXLV 값은 grow + curve 만큼 오른 값이고,
     중간 레벨이 위(조숙형, curve 음수) 또는 아래(대기만성, curve 양수)로 휜다. 같은 등급 안에서도
     '지금 강한 기체' 와 '키우면 강한 기체' 가 갈린다. curve 가 없는 기존 기체는 한 자리도 바뀌지 않는다.
       조숙형   ZEPHYR · POLARIS      — Lv.20~35 에서 등급 위쪽, Lv.60 에서는 아래쪽
       대기만성 LONGBOW · VESPER      — 중반에는 등급 바닥, Lv.60 에서 등급 꼭대기 */
  pike:{ id:'pike', name:"PIKE", rarity:'R', role:"돌격 관통창형 · 랜스가드",
    base:{hp:576,atk:104.6,def:61.3,spd:58,crit:.12,eva:.08}, grow:{hp:50.8,atk:10.58,def:6.22,spd:4.3}, spread:.2,
    skill:{name:"게이볼그 차지", desc:"방어력 50%를 관통하는 0.95배 찌르기 2회.", fx:{mult:.95,hits:2,ignoreDef:.5}} },
  quake:{ id:'quake', name:"QUAKE", rarity:'R', role:"장갑 파쇄 포격형 · 시스모",
    base:{hp:696,atk:122.8,def:77.9,spd:45,crit:.1,eva:.06}, grow:{hp:55.36,atk:12.09,def:7.25,spd:3.7}, spread:.3,
    skill:{name:"그라운드 셰이크", desc:"1.75배 진동 포격. 상대 방어력을 10% 깎는다(원래 방어의 70%까지).", fx:{mult:1.75,shred:.1}} },
  cipher:{ id:'cipher', name:"CIPHER", rarity:'R', role:"전파 교란형 · 고스트",
    base:{hp:536,atk:90.5,def:59,spd:60,crit:.12,eva:.1}, grow:{hp:52.85,atk:10.54,def:6.81,spd:4.5}, spread:.18,
    skill:{name:"고스트 시그널", desc:"1.5배 전자 사격. 상대의 스킬 게이지를 40 깎는다.", fx:{mult:1.5,jam:40}} },
  aegis:{ id:'aegis', name:"AEGIS", rarity:'R', role:"방패 방벽형 · 벌워크",
    base:{hp:788,atk:96.3,def:96.3,spd:42,crit:.07,eva:.05}, grow:{hp:57.81,atk:10.04,def:7.85,spd:3.6}, spread:.16,
    skill:{name:"타워 슬램", desc:"1.3배 방패 가격 뒤 최대 내구 14%만큼 방벽(쓸 때마다 30%씩 얇아진다).", fx:{mult:1.3,shield:.14}} },
  zephyr:{ id:'zephyr', name:"ZEPHYR", rarity:'R', role:"조숙 고기동형 · 윈드러너",
    base:{hp:511,atk:89.9,def:55.1,spd:65,crit:.14,eva:.18},
    grow:{hp:48.93,atk:9.69,def:5.94,spd:5.66}, curve:{hp:-1.66,atk:-0.33,def:-0.2,spd:0}, spread:.26,
    skill:{name:"윈드 셰어", desc:"0.62배 베기를 4회. 각각 치명타·회피 판정.", fx:{mult:.62,hits:4}} },
  longbow:{ id:'longbow', name:"LONGBOW", rarity:'R', role:"대기만성 장사정포형 · 아처",
    base:{hp:555,atk:98.3,def:57.7,spd:46,crit:.1,eva:.06},
    grow:{hp:55.94,atk:12.79,def:6.89,spd:3.06}, curve:{hp:1.73,atk:0.4,def:0.21,spd:0}, spread:.35,
    skill:{name:"롱보우 스트라이크", desc:"방어력 30%를 관통하는 2.5배 장사정 포격.", fx:{mult:2.5,ignoreDef:.3}} },
  anvil:{ id:'anvil', name:"ANVIL", rarity:'R', role:"야전 정비형 · 리페어러",
    base:{hp:720,atk:101.3,def:74.3,spd:48,crit:.08,eva:.06}, grow:{hp:52.97,atk:10.22,def:6.88,spd:3.9}, spread:.18,
    skill:{name:"필드 웰딩", desc:"1.35배 타격 뒤 최대 내구 17%를 수리한다(쓸 때마다 30%씩 줄어든다).", fx:{mult:1.35,repair:.17}} },
  verdict:{ id:'verdict', name:"VERDICT", rarity:'R', role:"중장 마무리형 · 집행자",
    base:{hp:720,atk:106.9,def:78.5,spd:47,crit:.1,eva:.06}, grow:{hp:52.86,atk:11.01,def:7.2,spd:3.9}, spread:.22,
    skill:{name:"선고 집행", desc:"1.15배 포격 2회. 내구 35% 아래인 상대에게는 65% 더 아프다.", fx:{mult:1.15,hits:2,execute:.65}} },
  polaris:{ id:'polaris', name:"POLARIS", rarity:'R', role:"조숙 정밀저격형 · 노스스타",
    base:{hp:513,atk:101.6,def:55.9,spd:62,crit:.17,eva:.09},
    grow:{hp:50.25,atk:10.49,def:6.03,spd:5.03}, curve:{hp:-1.46,atk:-0.31,def:-0.18,spd:0}, spread:.1,
    skill:{name:"노스 스타", desc:"방어력 25% 관통 1.5배 확정 치명타 저격.", fx:{mult:1.5,ignoreDef:.25,alwaysCrit:true}} },
  vesper:{ id:'vesper', name:"VESPER", rarity:'R', role:"대기만성 흡혈참격형 · 이븐스타",
    base:{hp:619,atk:106.1,def:66.3,spd:54,crit:.14,eva:.1},
    grow:{hp:52.74,atk:12.09,def:6.79,spd:3.53}, curve:{hp:2.2,atk:0.5,def:0.28,spd:0}, spread:.24,
    skill:{name:"이브닝 사이드", desc:"1.7배 참격. 준 피해의 30%를 흡수한다.", fx:{mult:1.7,drain:.3}} },

  /* ---- 세트 05 (2026-09-23) · UQ 열 기체 · 아종 ─────────────────────
     사용자가 그려 온 18기. 전부 UQ 이고 이름 · 역할 · 수치 · 스킬은 Claude 가 붙였다. UQ 8 → 26종.
     UQ 에 없던 특화기술(수리 · 처형 · 표적 · 파쇄)을 채운다.

     **아종(`family`)** — 사용자가 x · y · z-twin 으로 묶어 온 기체는 같은 차체를 쓰는 형제다.
     한 집안은 **속도 · 치명 · 회피 · 구간이 같고**(차체) 무장 · 스킬 · 성장 모양이 다르다.
       NIMBUS  — 광륜 차체 2형: 캐논(관통 빔) · 피스트(흡혈 연타)
       GOLIATH — 중해머 차체 4형: 샌드(표준 파쇄) · 러스트(대기만성 중타) · 시엘(조숙 방벽) · 바이올렛(흡혈)
       HYDRA   — 미사일 백팩 차체 2형: 스나이퍼(관통 필중) · 개틀링(6연 표적)
     계보에서는 같은 등급 안에서 옆으로 갈라지는 '분화' 로 잇는다(docs/balance/lineage-plan-2026-09-22.md).
     family 는 지금 전투에 쓰이지 않는 표시값이다. */
  salvo:{ id:'salvo', name:"SALVO", rarity:'UQ', role:"중장 연사 파쇄형 · 브레이커",
    base:{hp:876.1,atk:119.9,def:96.8,spd:46,crit:.1,eva:.05}, grow:{hp:50.72,atk:11.28,def:7.14,spd:3.7}, spread:.3,
    skill:{name:"브레이크 스톰", desc:"0.5배 개틀링 5연사. 맞을 때마다 상대 방어력을 2% 깎는다(원래 방어의 70%까지).", fx:{mult:.5,hits:5,shred:.02}} },
  sentry:{ id:'sentry', name:"SENTRY", rarity:'UQ', role:"정찰 표적형 · 워처",
    base:{hp:669.7,atk:104.6,def:75.3,spd:60,crit:.14,eva:.11}, grow:{hp:49.13,atk:11.52,def:6.62,spd:4.4}, spread:.15,
    skill:{name:"락온 비컨", desc:"표적을 새기고(+18%) 빗나가지 않는 1.45배 사격.", fx:{mult:1.45,noMiss:true,mark:.18}} },
  osprey:{ id:'osprey', name:"OSPREY", rarity:'UQ', role:"초장거리 처형 저격형 · 헌터",
    base:{hp:640,atk:121.6,def:68.3,spd:62,crit:.17,eva:.1}, grow:{hp:43.73,atk:11.78,def:5.58,spd:4.5}, spread:.1,
    skill:{name:"탈론 샷", desc:"방어력 30% 관통 1.9배 저격. 빗나가지 않고, 내구 35% 아래인 상대에게 90% 더 아프다.", fx:{mult:1.9,noMiss:true,ignoreDef:.3,execute:.9}} },
  aquila:{ id:'aquila', name:"AQUILA", rarity:'UQ', role:"조숙 비익 기동형 · 스카이",
    base:{hp:612.9,atk:104.5,def:66.3,spd:72,crit:.16,eva:.17}, grow:{hp:47.22,atk:10.81,def:5.92,spd:4.6}, curve:{hp:-.7,atk:-.16,def:-.09,spd:0}, spread:.22,
    skill:{name:"윙 바라지", desc:"0.58배 사격 5회. 각각 치명타·회피 판정.", fx:{mult:.58,hits:5}} },
  paladin:{ id:'paladin', name:"PALADIN", rarity:'UQ', role:"성기사 수리형 · 가디언",
    base:{hp:917.3,atk:111.9,def:107.4,spd:46,crit:.1,eva:.06}, grow:{hp:50.85,atk:10.39,def:7.28,spd:3.6}, spread:.2,
    skill:{name:"생크추어리", desc:"1.5배 철퇴 뒤 최대 내구 18%를 수리한다(쓸 때마다 30%씩 줄어든다).", fx:{mult:1.5,repair:.18}} },
  auger:{ id:'auger', name:"AUGER", rarity:'UQ', role:"굴착 파쇄형 · 마이너",
    base:{hp:821.9,atk:138.5,def:86.9,spd:47,crit:.11,eva:.06}, grow:{hp:49.11,atk:12.15,def:6.66,spd:3.7}, spread:.32,
    skill:{name:"딥 드릴", desc:"방어력 30% 관통 1.9배 굴착. 상대 방어력을 12% 깎는다(원래 방어의 70%까지).", fx:{mult:1.9,ignoreDef:.3,shred:.12}} },
  halberd:{ id:'halberd', name:"HALBERD", rarity:'UQ', role:"미늘창 처형형 · 할버디어",
    base:{hp:739.1,atk:121.7,def:82.6,spd:52,crit:.13,eva:.08}, grow:{hp:44.31,atk:10.64,def:6.32,spd:4}, spread:.22,
    skill:{name:"헤즈맨 스윙", desc:"방어력 40% 관통 1.3배 베기 2회. 내구 35% 아래인 상대에게 70% 더 아프다.", fx:{mult:1.3,hits:2,ignoreDef:.4,execute:.7}} },
  quasar:{ id:'quasar', name:"QUASAR", rarity:'UQ', role:"대기만성 중력 교란형 · 그래비톤",
    base:{hp:670.9,atk:118.7,def:72.3,spd:52,crit:.14,eva:.1}, grow:{hp:49.56,atk:12.02,def:6.61,spd:4}, curve:{hp:1.53,atk:.37,def:.2,spd:0}, spread:.28,
    skill:{name:"이벤트 호라이즌", desc:"1.9배 중력 타격. 상대의 스킬 게이지를 35 깎는다.", fx:{mult:1.9,jam:35}} },
  gyre:{ id:'gyre', name:"GYRE", rarity:'UQ', role:"사슬 연격 흡혈형 · 플레일",
    base:{hp:697.9,atk:112.9,def:73.9,spd:54,crit:.13,eva:.09}, grow:{hp:49.41,atk:11.53,def:6.69,spd:4.1}, spread:.3,
    skill:{name:"체인 사이클론", desc:"0.62배 사슬 타격 4회. 준 피해의 20%를 흡수한다.", fx:{mult:.62,hits:4,drain:.2}} },
  ronin:{ id:'ronin', name:"RONIN", rarity:'UQ', role:"광검 결전형 · 사무라이",
    base:{hp:584.8,atk:117,def:62.4,spd:64,crit:.2,eva:.12}, grow:{hp:42.77,atk:11.86,def:5.44,spd:4.6}, spread:.18,
    skill:{name:"홍월 일섬", desc:"방어력 25% 관통 1.85배 확정 치명타 베기.", fx:{mult:1.85,alwaysCrit:true,ignoreDef:.25}} },
  nimbus_c:{ id:'nimbus_c', name:"NIMBUS CANNON", rarity:'UQ', family:'nimbus', role:"광륜 차체 · 빔 캐논형",
    base:{hp:714.5,atk:116,def:80.8,spd:56,crit:.14,eva:.1}, grow:{hp:44.55,atk:10.87,def:6.28,spd:4.2}, spread:.14,
    skill:{name:"헤일로 빔", desc:"방어력 55% 관통 1.7배 광선. 빗나가지 않음.", fx:{mult:1.7,ignoreDef:.55,noMiss:true}} },
  nimbus_f:{ id:'nimbus_f', name:"NIMBUS FIST", rarity:'UQ', family:'nimbus', role:"광륜 차체 · 권격형",
    base:{hp:662.6,atk:99.4,def:73.6,spd:56,crit:.14,eva:.1}, grow:{hp:50.44,atk:11.24,def:6.97,spd:4.2}, spread:.14,
    skill:{name:"헤일로 러시", desc:"0.78배 주먹 3연타. 준 피해의 15%를 흡수한다.", fx:{mult:.78,hits:3,drain:.15}} },
  goliath_s:{ id:'goliath_s', name:"GOLIATH SAND", rarity:'UQ', family:'goliath', role:"중해머 차체 · 표준형",
    base:{hp:932.4,atk:119.3,def:104.1,spd:42,crit:.09,eva:.05}, grow:{hp:54.74,atk:11.83,def:7.52,spd:3.5}, spread:.34,
    skill:{name:"어스 크러셔", desc:"2.2배 해머 강타. 상대 방어력을 8% 깎는다(원래 방어의 70%까지).", fx:{mult:2.2,shred:.08}} },
  goliath_r:{ id:'goliath_r', name:"GOLIATH RUST", rarity:'UQ', family:'goliath', role:"중해머 차체 · 대기만성 중타형",
    base:{hp:851.4,atk:108.9,def:95,spd:42,crit:.09,eva:.05}, grow:{hp:51.67,atk:11.33,def:7.15,spd:3.5}, curve:{hp:1.6,atk:.35,def:.22,spd:0}, spread:.34,
    skill:{name:"러스트 폴", desc:"방어력 30% 관통 2.6배 내려찍기.", fx:{mult:2.6,ignoreDef:.3}} },
  goliath_c:{ id:'goliath_c', name:"GOLIATH CIEL", rarity:'UQ', family:'goliath', role:"중해머 차체 · 조숙 방벽형",
    base:{hp:866.6,atk:110.8,def:96.7,spd:42,crit:.09,eva:.05}, grow:{hp:59.42,atk:12.3,def:8.07,spd:3.5}, curve:{hp:-4.91,atk:-1.02,def:-.67,spd:0}, spread:.34,
    skill:{name:"스카이 바스티온", desc:"1.4배 해머 뒤 최대 내구 16%만큼 방벽(쓸 때마다 30%씩 얇아진다).", fx:{mult:1.4,shield:.16}} },
  goliath_v:{ id:'goliath_v', name:"GOLIATH VIOLET", rarity:'UQ', family:'goliath', role:"중해머 차체 · 수정 흡혈형",
    base:{hp:897.7,atk:114.8,def:100.2,spd:42,crit:.09,eva:.05}, grow:{hp:56.54,atk:12.14,def:7.75,spd:3.5}, spread:.34,
    skill:{name:"아메시스트 블룸", desc:"1.9배 수정 해머. 준 피해의 30%를 흡수한다.", fx:{mult:1.9,drain:.3}} },
  hydra_s:{ id:'hydra_s', name:"HYDRA SNIPER", rarity:'UQ', family:'hydra', role:"미사일 백팩 차체 · 저격형",
    base:{hp:689.3,atk:117,def:73.1,spd:54,crit:.15,eva:.09}, grow:{hp:44.73,atk:11.33,def:6.05,spd:4.1}, spread:.12,
    skill:{name:"헤드 헌트", desc:"방어력 50% 관통 2.1배 저격. 빗나가지 않음.", fx:{mult:2.1,ignoreDef:.5,noMiss:true}} },
  hydra_g:{ id:'hydra_g', name:"HYDRA GATLING", rarity:'UQ', family:'hydra', role:"미사일 백팩 차체 · 제압 개틀링형",
    base:{hp:711.9,atk:107.8,def:75.3,spd:54,crit:.15,eva:.09}, grow:{hp:47.83,atk:11.18,def:6.48,spd:4.1}, spread:.12,
    skill:{name:"하이드라 헤즈", desc:"표적을 새기고(+10%) 0.45배 개틀링 6연사.", fx:{mult:.45,hits:6,mark:.1}} },

  /* ---- 세트 06 (2026-09-23) · EP 다섯 기체 ─────────────────────────
     사용자가 그려 온 5기. 전부 EP 이고 이름 · 역할 · 수치 · 스킬은 Claude 가 붙였다. EP 8 → 13종.
     **세기는 계보에서 열 때 필요한 앞 기체 수에 맞춘다**(2026-09-23 사용자 결정 ⑦) —
     MONARCH 4종 → 등급 안 53~55% · SOLARIS · LIONHEART 3종 → 46~53% · SHOGUN · REVENANT 2종 → 42~46%.
     EP 에 없던 자리를 채운다 — 수리(LIONHEART) · 6연격(SOLARIS) · 처형 결전(MONARCH · REVENANT). */
  solaris:{ id:'solaris', name:"SOLARIS", rarity:'EP', role:"광익 다중검형 · 선브링어",
    base:{hp:717.6,atk:122.7,def:79.3,spd:76,crit:.18,eva:.13}, grow:{hp:47.14,atk:10.21,def:6.01,spd:4.8}, spread:.16,
    skill:{name:"브릴리언트 윙즈", desc:"방어력 35%를 관통하는 0.62배 광익 참격을 6회.", fx:{mult:.62,hits:6,ignoreDef:.35}} },
  monarch:{ id:'monarch', name:"MONARCH", rarity:'EP', role:"대검 결전형 · 로드 나이트",
    base:{hp:960.6,atk:147,def:105.9,spd:54,crit:.15,eva:.08}, grow:{hp:54.78,atk:11,def:7,spd:3.6}, curve:{hp:.89,atk:.18,def:.11,spd:0}, spread:.26,
    skill:{name:"로열 디크리", desc:"방어력 55% 관통 2.6배 대검 강타. 내구 35% 아래인 상대에게 60% 더 아프다.", fx:{mult:2.6,ignoreDef:.55,execute:.6}} },
  lionheart:{ id:'lionheart', name:"LIONHEART", rarity:'EP', role:"사자 방패형 · 그랜드 팔라딘",
    base:{hp:1296.5,atk:133,def:144.3,spd:48,crit:.1,eva:.06}, grow:{hp:63.19,atk:9.39,def:8.07,spd:3.2}, spread:.18,
    skill:{name:"라이언 가드", desc:"1.45배 성검 강타 뒤 최대 내구 12%를 수리하고 20%만큼 방벽을 친다(둘 다 쓸 때마다 30%씩 줄어든다).", fx:{mult:1.45,repair:.12,shield:.2}} },
  shogun:{ id:'shogun', name:"SHOGUN", rarity:'EP', role:"발도 결전형 · 쇼군",
    base:{hp:686.2,atk:137.2,def:76.5,spd:80,crit:.24,eva:.14}, grow:{hp:43.47,atk:10.15,def:5.6,spd:5.2}, spread:.2,
    skill:{name:"만개 일섬", desc:"방어력 45% 관통 2.05배 확정 치명타 발도.", fx:{mult:2.05,ignoreDef:.45,alwaysCrit:true}} },
  revenant:{ id:'revenant', name:"REVENANT", rarity:'EP', role:"그림자 처형형 · 어쌔신",
    base:{hp:722.3,atk:138.2,def:77.5,spd:86,crit:.22,eva:.2}, grow:{hp:45.66,atk:10.38,def:5.8,spd:5.4}, curve:{hp:-.54,atk:-.12,def:-.07,spd:0}, spread:.24,
    skill:{name:"섀도우 리퍼", desc:"0.8배 쌍검 3연격. 준 피해의 25%를 흡수하고, 내구 35% 아래인 상대에게 70% 더 아프다.", fx:{mult:.8,hits:3,drain:.25,execute:.7}} },

  /* ---- 스토리 기체 (2026-09-21) — **뽑기 · 상점 · 상대 · 도감 · 시작 기체에 나오지 않는다(story:true)** ----
     2장 주인공 아렌의 ROOK-3 세 단계와 셀릭의 VALKEN-4. 얻는 길은 아직 없다 — 전선 보상 등으로 나중에 연다.
     걸러 내는 곳: js/units.js · js/gacha.js 의 BY_RARITY, js/shop.js, js/codex.js, server/worker.js 의 시작 기체 */
  rook3:{ id:'rook3', name:"ROOK-3", rarity:'C', story:true, role:"누더기 보급형 · 리퍼브",
    base:{hp:480,atk:72,def:50,spd:48,crit:.07,eva:.06}, grow:{hp:52,atk:9.6,def:6.2,spd:4.3}, spread:.26,
    skill:{name:"스크랩 펀치", desc:"1.35배 강타 뒤 최대 내구 7%만큼 방벽 — 덧댄 장갑이 버틴다. 쓸 때마다 30%씩 얇아진다.", fx:{mult:1.35,shield:.07}} },
  rook3_mod:{ id:'rook3_mod', name:"ROOK-3 MOD", rarity:'UC', story:true, role:"비대칭 개조형 · 블랙 암",
    base:{hp:500,atk:88,def:54,spd:55,crit:.11,eva:.07}, grow:{hp:50,atk:10.2,def:6,spd:4.6}, spread:.3,
    skill:{name:"블랙 암 라이플", desc:"빼앗은 검은 팔의 0.7배 사격 3회. 맞을 때마다 상대 방어 2% 파쇄(최대 30%).", fx:{mult:.7,hits:3,shred:.02}} },
  rook3_re:{ id:'rook3_re', name:"ROOK-3 RE", rarity:'R', story:true, role:"재정비 균형형 · 리빌트",
    base:{hp:582,atk:98.8,def:68.6,spd:56,crit:.12,eva:.1}, grow:{hp:48.3,atk:9.96,def:6.34,spd:4.4}, spread:.22,
    skill:{name:"리빌트 버스트", desc:"빗나가지 않는 1.05배 연사 2회 뒤 최대 내구 9%만큼 방벽. 쓸 때마다 30%씩 얇아진다.", fx:{mult:1.05,hits:2,noMiss:true,shield:.09}} },
  valken4:{ id:'valken4', name:"VALKEN-4", rarity:'R', story:true, role:"신형 정밀형 · 엘리트",
    base:{hp:505.6,atk:83.1,def:57.8,spd:62,crit:.16,eva:.11}, grow:{hp:50.78,atk:10.22,def:6.31,spd:4.8}, spread:.12,
    skill:{name:"트윈 아이", desc:"표적을 새기고(+6%) 빗나가지 않는 1.5배 확정 치명타.", fx:{mult:1.5,noMiss:true,alwaysCrit:true,mark:.06}} },
};

/* 대전 전용 몬스터. ROBOT_TYPES 와 표를 나눠 두어 뽑기·격납고·소유 목록에
   새어 들어갈 경로 자체를 없앤다. 두 표의 id 는 겹치면 안 된다(에셋 경로가 갈린다). */
export const MONSTER_TYPES = {
  enemy_razorwing:{ id:'enemy_razorwing', name:'레이저윙', rarity:'C', role:'고속 연격형 · 기계 맹금',
    base:{"hp":412,"atk":80,"def":43,"spd":54,"crit":0.1,"eva":0.08}, grow:{"hp":43.3,"atk":10.8,"def":4.9,"spd":5.1}, spread:.2,
    skill:{"name":"레이저 탈론","desc":"0.9배 발톱 공격을 2회. 각각 치명타·회피 판정.","fx":{"mult":0.9,"hits":2}} },
  enemy_angler:{ id:'enemy_angler', name:'어비스 앵글러', rarity:'UC', role:'중장 압박형 · 심해 포식자',
    base:{"hp":640,"atk":84,"def":77,"spd":44,"crit":0.07,"eva":0.03}, grow:{"hp":64.4,"atk":9.2,"def":7.9,"spd":3.5}, spread:.32,
    skill:{"name":"어비스 바이트","desc":"2.0배 강철 턱 공격. 빗나가지 않음.","fx":{"mult":2,"noMiss":true}} },
  enemy_jackal:{ id:'enemy_jackal', name:'더스트 자칼', rarity:'C', role:'근접 추적형 · 사막 사냥꾼',
    base:{"hp":509,"atk":73,"def":59,"spd":45,"crit":0.05,"eva":0.04}, grow:{"hp":61.5,"atk":8.1,"def":8.1,"spd":3.7}, spread:.27,
    skill:{"name":"데저트 팽","desc":"1.65배 송곳니 공격. 빗나가지 않음.","fx":{"mult":1.65,"noMiss":true}} },
  enemy_reaper:{ id:'enemy_reaper', name:'베놈 리퍼', rarity:'R', role:'고기동 참격형 · 사마귀',
    base:{"hp":502,"atk":96,"def":56,"spd":62,"crit":0.18,"eva":0.14}, grow:{"hp":43.3,"atk":10.9,"def":5,"spd":5.2}, spread:.22,
    skill:{"name":"크로스 사이드","desc":"0.95배 낫 공격을 3회. 각각 치명타·회피 판정.","fx":{"mult":0.95,"hits":3}} },
  enemy_lich:{ id:'enemy_lich', name:'보이드 리치', rarity:'UQ', role:'에너지 흡수형 · 기계 술사',
    base:{"hp":808,"atk":105,"def":86,"spd":51,"crit":0.12,"eva":0.08}, grow:{"hp":59.7,"atk":9.2,"def":7.5,"spd":3.8}, spread:.24,
    skill:{"name":"소울 하베스트","desc":"2.35배 에너지 공격. 준 피해의 35%를 흡수한다.","fx":{"mult":2.35,"drain":0.35}} },
  enemy_goliath:{ id:'enemy_goliath', name:'아이언 골리앗', rarity:'EP', role:'중장 파괴형 · 기계 거수',
    base:{"hp":927,"atk":133,"def":99,"spd":68,"crit":0.15,"eva":0.14}, grow:{"hp":58.6,"atk":9.2,"def":6.9,"spd":4.3}, spread:.22,
    skill:{"name":"코어 크러셔","desc":"방어력 60% 관통 2.15배 강타. 빗나가지 않고 25%를 흡수한다.","fx":{"mult":2.15,"ignoreDef":true,"noMiss":true,"drain":0.25}} },
  enemy_scorpio:{ id:'enemy_scorpio', name:'볼트 스콜피오', rarity:'R', role:'장갑 관통형 · 기계 전갈',
    base:{"hp":713,"atk":89,"def":78,"spd":48,"crit":0.08,"eva":0.06}, grow:{"hp":60.6,"atk":9,"def":7.5,"spd":3.5}, spread:.3,
    skill:{"name":"스팅어 드릴","desc":"방어력 60%를 관통하는 1.85배 꼬리 공격. 빗나가지 않음.","fx":{"mult":1.85,"ignoreDef":true,"noMiss":true}} },
  enemy_strix:{ id:'enemy_strix', name:'나이트 스트릭스', rarity:'UC', role:'정밀 저격형 · 야행성 감시자',
    base:{"hp":413,"atk":77,"def":47,"spd":59,"crit":0.14,"eva":0.1}, grow:{"hp":41.3,"atk":11,"def":4.7,"spd":5}, spread:.14,
    skill:{"name":"나이트 피어서","desc":"방어력 60%를 관통하는 1.8배 저격.","fx":{"mult":1.8,"ignoreDef":true}} },
  enemy_megalodon:{ id:'enemy_megalodon', name:'블러드 메갈로돈', rarity:'UQ', role:'급습 연격형 · 강철 상어',
    base:{"hp":600,"atk":105,"def":64,"spd":64,"crit":0.25,"eva":0.18}, grow:{"hp":45.3,"atk":10.7,"def":4.9,"spd":4.9}, spread:.13,
    skill:{"name":"프레데터 러시","desc":"0.7배 급습을 3회. 모두 확정 치명타(회피는 가능).","fx":{"mult":0.7,"hits":3,"alwaysCrit":true}} },
  enemy_kabuto:{ id:'enemy_kabuto', name:'오닉스 카부토', rarity:'EP', role:'장갑 돌파형 · 갑충 군주',
    base:{"hp":791,"atk":136,"def":88,"spd":71,"crit":0.21,"eva":0.12}, grow:{"hp":45.1,"atk":10.2,"def":5.7,"spd":4.3}, spread:.28,
    skill:{"name":"모나크 브레이크","desc":"방어력 60%를 관통하는 1.1배 돌진 공격을 3회.","fx":{"mult":1.1,"hits":3,"ignoreDef":true}} },
  /* ---- 나르(NHAR) — 전선 1장 ----
     시나리오(docs/story/chapter1.txt)의 외계 기계문명. 다른 몬스터가 짐승 쪽 이름인 것과
     달리 이쪽은 **기계**다 — 사람을 안 쫓고 기계만 부순다는 것이 이들의 규칙이다.
     그림은 tools/build_nhar.py 가 만든다(난수 없음, 다시 돌려도 같다).

     1장은 이 게임에서 사람이 하는 **첫 다섯 판**이라 셋 다 '읽히는' 적으로 만들었다.
     관통·흡혈·다단히트를 여기서 쓰지 않는다 — 무엇에 맞았는지 모르는 채로 지면
     배우는 것 없이 나간다. 복잡한 판정은 2장부터다. */
  nhar_scout:{ id:'nhar_scout', name:'나르 척후체', rarity:'C', role:'고속 정찰형 · 결정 척후',
    base:{"hp":424,"atk":83,"def":45,"spd":58,"crit":0.1,"eva":0.09}, grow:{"hp":44,"atk":11.1,"def":5,"spd":5.2}, spread:.18,
    skill:{"name":"삼점 조준","desc":"0.48배 사격을 3회. 붉은 점 셋이 같은 곳을 본다.","fx":{"mult":0.48,"hits":3}} },
  nhar_lance:{ id:'nhar_lance', name:'나르 천공체', rarity:'C', role:'광선 사격형 · 푸른 천공',
    base:{"hp":446,"atk":78,"def":52,"spd":49,"crit":0.08,"eva":0.05}, grow:{"hp":47,"atk":10,"def":5.5,"spd":4.5}, spread:.23,
    /* 관통을 **일부만** 준다. 시나리오의 푸른 광선은 장갑을 뚫지만, 완전 관통을
       Lv.2 플레이어에게 걸면 방어를 올릴 이유가 사라진 채로 맞는다. */
    skill:{"name":"푸른 천공","desc":"방어력 35%를 관통하는 1.78배 광선.","fx":{"mult":1.78,"ignoreDef":0.35}} },
  nhar_warden:{ id:'nhar_warden', name:'나르 파수체', rarity:'UC', role:'중장 결정형 · 파수',
    base:{"hp":636,"atk":83,"def":78,"spd":43,"crit":0.07,"eva":0.03}, grow:{"hp":63.5,"atk":9.1,"def":7.9,"spd":3.4}, spread:.3,
    skill:{"name":"결정 증식","desc":"2.12배 결정 강타. 빗나가지 않음.","fx":{"mult":2.12,"noMiss":true}} },

  /* ---- 2장 '하이브 제로의 신참' (2026-09-18) ----
     원작 docs/story/chapter2.txt. 1장 나르와 **같은 체급**으로 둔다(mon.mjs 동급 50% 기준).
     세기는 전선 칸의 foe 가 누른다 — 몬스터 자체를 약하게 만들면 대전·파견 풀이 물러진다.

     그림은 assets/monsters/<id>.png — 2026-09-18 에 셋 다 들어와 빌려 쓰던 `sprite` 줄을 지웠다.
     다음에 그림 없이 몬스터를 먼저 낼 때는 `sprite:'<빌릴 id>'` 한 줄을 달면 된다(js/sprites.js 가 따른다) */
  choir_drone:{ id:'choir_drone', name:'성가대 무장 드론', rarity:'C', role:'자동포 제압형 · 식별 지워짐',
    base:{"hp":418,"atk":82,"def":43,"spd":61,"crit":0.09,"eva":0.1}, grow:{"hp":43.6,"atk":11.1,"def":4.8,"spd":5.4}, spread:.2,
    /* 원작 — 프레임 절반 크기에 군용 자동포. 훈련탄이 아니라 실탄이다 */
    skill:{"name":"실탄 난사","desc":"0.45배 자동포를 3회. 훈련탄이 아니다.","fx":{"mult":0.45,"hits":3}} },
  nhar_spider:{ id:'nhar_spider', name:'나르 거미', rarity:'C', role:'기계 포식형 · 결정 거미',
    base:{"hp":388,"atk":84,"def":40,"spd":64,"crit":0.11,"eva":0.12}, grow:{"hp":40,"atk":11.2,"def":4.4,"spd":5.6}, spread:.2,
    /* 원작 — 작은 칼날이 장갑 틈으로 들어온다. 사람보다 기계를 먼저 문다 */
    skill:{"name":"관절 절단","desc":"장갑 틈을 파고드는 1.55배 칼날. 빗나가지 않음.","fx":{"mult":1.55,"noMiss":true}} },
  choir_frame:{ id:'choir_frame', name:'백색 성가대 프레임', rarity:'UC', role:'융합 개조형 · 흑백 도장',
    base:{"hp":598,"atk":84,"def":70,"spd":46,"crit":0.075,"eva":0.045}, grow:{"hp":59.4,"atk":9.4,"def":7.2,"spd":3.7}, spread:.27,
    /* 원작 — 인간 기체에 나르 결정을 심었다. 움직임이 너무 부드럽다 */
    skill:{"name":"검은 결정 칼날","desc":"방어력 30%를 관통하는 1.8배 결정 칼날.","fx":{"mult":1.8,"ignoreDef":0.3}} },

  /* ---- 미래 보스 콘텐츠 ----
     전용 위험도 BOSS는 ROBOT_RARITY(C~EP)에 없으므로 현재 일반 매칭 풀에서 선택되지 않는다.
     향후 보스 진입/보상 UI가 직접 id를 선택할 때만 등장시킨다.
     Lv.60 성능은 기존과 같지만 이후 성장률을 1.5배로 올렸다. 토벌에서는 +30레벨로
     등장하므로 중간 장비로는 벽이고, 최종 장비도 조합에 따라 공략 성공률이 갈린다. */
  boss_bael_fortress:{ id:'boss_bael_fortress', name:'철혈성채 바알', rarity:'BOSS', role:'초중장 섬멸형 · 마왕성채',
    base:{hp:473.5,atk:33.75,def:37.7,spd:32.05,crit:.22,eva:.06}, grow:{hp:112.5,atk:11.25,def:8.1,spd:3.15}, spread:.26,
    skill:{name:'종말의 일제사격', desc:'1.0배 포격을 3회. 방어력 60%를 관통하며 회피할 수 없다.',
           fx:{mult:1.0,hits:3,ignoreDef:true,noMiss:true}},
    /* 합동전 — 광역 일제사격. 두 기 모두 버텨야 하고, 장갑을 뚫어야 한다 */
    joint:{ aim:'all', traits:['armor','overcharge'], hp:1.0, atk:0.95 } },
  boss_astraea:{ id:'boss_astraea', name:'성극천사 아스트라이아', rarity:'BOSS', role:'초고기동 심판형 · 성역병기',
    base:{hp:535.95,atk:19.6,def:71.8,spd:19.45,crit:.30,eva:.20}, grow:{hp:68.85,atk:10.8,def:5.4,spd:4.35}, spread:.15,
    skill:{name:'세라픽 저지먼트', desc:'0.91배 심판광을 3회. 방어력 60%를 관통하고 회피 불가·확정 치명타, 피해의 10%를 흡수한다.',
           fx:{mult:.91,hits:3,ignoreDef:true,noMiss:true,alwaysCrit:true,drain:.1}},
    /* 합동전 — 후위 저격. 치명형 후위는 안 통하고, 빗나가지 않아야 맞힌다 */
    joint:{ aim:'back', traits:['critnull','phase'] } },
  boss_nihil:{ id:'boss_nihil', name:'공허군주 니힐', rarity:'BOSS', role:'공간침식 연격형 · 공허핵',
    base:{hp:590.65,atk:47.75,def:47.65,spd:16.5,crit:.38,eva:.32}, grow:{hp:55.95,atk:11.25,def:4.95,spd:4.5}, spread:.24,
    skill:{name:'이벤트 호라이즌', desc:'방어력 60%를 관통하는 0.98배 침식을 4회. 피해의 25%를 흡수한다.',
           fx:{mult:.98,hits:4,ignoreDef:true,drain:.25}},
    /* 합동전 — 전위 침식. 연타가 막히고 재생으로 버틴다. 한 방이 큰 기체가 답이다 */
    joint:{ aim:'front', traits:['field','regen'], hp:0.8 } }
};

/* 파츠 */
export const SLOTS = ['WEAPON','FRAME','BOOSTER','CORE'];
export const SLOT_STATS = { WEAPON:['atk','atk','atk','crit'], FRAME:['hp','def','def','hp'],
                     BOOSTER:['spd','eva','spd','crit'], CORE:['hp','atk','def','crit'] };

/* 파츠의 **대가**. 슬롯마다 하나씩, 반드시 깎인다.
   예전에는 파츠 스탯이 전부 양수라 '좋은 걸 끼면 끝'이었다 — 고를 것이 없었다.
   대가가 붙으면 빌드가 갈리고, 상대를 보고 바꿔 낄 이유가 생긴다.
     무장  → 속도  (크고 무거운 화기를 달았다)
     프레임 → 회피  (장갑이 두꺼워 못 피한다)
     부스터 → 방어  (가볍게 깎아 낸 기동부라 얇다)
     코어  → 속도  (출력을 끌어올린 만큼 무겁다)
   대가 스탯은 그 슬롯의 상승 목록(SLOT_STATS)에 들어 있지 않다. 한 파츠가 같은 값을
   올리고 동시에 깎으면 상쇄돼 아무 의미가 없어진다. */
export const SLOT_COST = { WEAPON:'spd', FRAME:'eva', BOOSTER:'def', CORE:'spd' };
/* 대가의 크기 — 상승 한 번(STAT_ROLL)과 같은 폭이다. 파츠는 상승을 n번, 대가를 한 번
   굴리므로 합쳐서는 여전히 이득이지만, 그 이득이 한쪽으로 뾰족해진다. */
export const COST_ROLL = { spd:[3,9], def:[5,13], eva:[.020,.045], hp:[24,55], atk:[6,15], crit:[.020,.045] };

/* 공격력 구간(spread)을 움직이는 파츠.
   구간은 좋고 나쁨이 없다 — **약자는 넓혀야 하고 강자는 좁혀야 한다.**
   (실측: 크게 불리한 판에서 ±10%→±50% 로 넓히면 승률 +5.8%p,
    크게 유리한 판에서는 같은 변경이 −5.1%p)
   그래서 대가가 아니라 '성향'이다. 상대 전투력을 보고 고르는 축이 된다.
     무장·코어   → 넓힌다 (화력계 — 크고 거친 출력)
     프레임·부스터 → 좁힌다 (안정계 — 자세 제어와 단단한 발판)
   네 슬롯이 모두 성향을 가지므로 **모아서 쌓인다.** 화력계로 채우면 크게 흔들리고
   안정계로 채우면 거의 같은 수로 맞힌다. 둘을 섞으면 상쇄돼 기체 본래 폭에 가깝다.
   (두 슬롯만 건드리게 했더니 ±17~30% 밖에 안 움직여 승률로는 1~2%p 뿐이었다) */
export const SLOT_SPREAD = { WEAPON: +1, CORE: +1, FRAME: -1, BOOSTER: -1 };
export const SPREAD_ROLL = [.025, .07];
export const PART_NAMES = {
  WEAPON:['빔 세이버','발칸포','레일건','포톤 랜스','채프 런처','브레이커'],
  FRAME:['합금 장갑','리액티브 아머','실드 프레임','경량 골격','나노 코팅'],
  BOOSTER:['스러스터','플로트 팩','부스트 유닛','고기동 백','AMBAC'],
  CORE:['리액터','제너레이터','전술 코어','컨트롤 칩','오버드라이브'] };
/* costMul — 대가(SLOT_COST)에만 걸리는 배수.
   일반(C)은 상승을 한 번만 굴리는데 대가는 다른 등급과 같은 폭으로 물었다.
   그래서 실측 전투력이 **맨몸보다 2.4% 낮았다** — 끼면 손해라 존재 이유가 없었다.
   대가를 절반 아래로 낮춰 '없는 것보단 나은' 정도(+3% 안팎)로 맞춘다.
   위 등급은 그대로다. 뾰족해지는 대가를 무르게 하면 파츠를 고르는 재미가 사라진다. */
/* pos/neg/affixes/tiers 는 개편용으로 **더한 열**이다. 지금 읽는 곳은 없다
   (server/state.js 의 위조 상한이 아직 k·w·n·mul·costMul 을 본다 — 7단계에서 갈아끼운다).
   등급이 올라도 단점까지 같은 비율로 키우지 않는다 — pos 는 크게, neg 는 조금.
   기존 mul(최대 3.4배)보다 pos 를 낮춘 것은 인챈트가 2개까지 더 붙기 때문이다. */
export const RARITY = [
  {k:'C', ko:'일반', w:52, n:1, mul:1.0, costMul:0.45,
   pos:1, neg:1, affixes:[1,1], tiers:{ I:85, II:15 }},
  {k:'R', ko:'정밀', w:30, n:2, mul:1.5,
   pos:1.45, neg:1.15, affixes:[1,2], tiers:{ I:35, II:55, III:10 }},
  {k:'SR',ko:'시제', w:14, n:3, mul:2.2,
   pos:2.05, neg:1.25, affixes:[2,2], tiers:{ II:35, III:55, IV:10 }},
  {k:'SSR',ko:'초월',w:4,  n:3, mul:3.4,
   pos:2.6, neg:1.4, affixes:[2,2], tiers:{ II:10, III:55, IV:35 }} ];
export const STAT_ROLL = { hp:[24,60], atk:[6,16], def:[5,13], spd:[3,9], crit:[.02,.05], eva:[.02,.05] };

/* ══ 파츠 개편 (2026-09-11) — 베이스 · 인챈트 ═══════════════════════════
   **4단계부터 이것이 생성 경로다.** js/gacha.js 의 rollPart 가 여기서 베이스와
   인챈트를 고르고, js/stats.js 의 partStat 이 값을 만든다.
   위의 SLOT_STATS/STAT_ROLL/SLOT_COST/SLOT_SPREAD 는 **옛 파츠를 읽을 때만** 쓰인다
   (마이그레이션은 7단계라 그때까지 두 모양이 섞여 있다).
   개편 계획과 각 단계의 통과 기준은 DESIGN.md 에 있다.

   왜 바꾸나 — 지금은 **이름이 마지막에, 성능과 무관하게 붙는다.** 그래서 같은
   슬롯·같은 등급이면 빔 세이버와 발칸포가 통계적으로 같은 물건이고, 이름은 세트
   판정에만 쓰인다. 실질 16종(4슬롯 × 4등급)짜리 파밍이다.
   앞으로는 **이름이 곧 성능**이고, 그 위에 인챈트가 성격을 얹는다. */

/* ── 베이스 21종 ──────────────────────────────────────────
   stats 는 Lv.40 · C등급 기준값이다(레벨 배율은 생성 때 곱한다).
   range 는 공격 구간 **배수**다 — 지금의 spread 처럼 더하지 않고 곱한다.
     더하기였을 때의 문제: 기체 고유 구간이 ±8% 부터 ±42% 까지인데 파츠가 절대값으로
     얹히니, 같은 파츠가 좁은 기체에겐 바닥을 뚫고 넓은 기체에겐 거의 안 보였다.
     곱하면 기체 성격이 보존된다.
   fx 는 수치가 아니라 **전투 규칙**이다. sim.js 가 읽는다(5단계).

   ※ 각 베이스는 '한 파츠만 끼웠을 때 맨몸 대비 승률 58~64%' 예산 안에 있어야 한다.
     node tools/budget.mjs 가 21개를 전부 재서 구간 밖을 지목한다. */
export const PART_BASES = {
  /* 무장 — 공격. 이 슬롯이 기본적으로 지불하는 축은 속도다(SLOT_COST). */
  beamSaber:     { ko:'빔 세이버',    slot:'WEAPON', set:'assault',
                   stats:{ atk:33, hp:-10, def:-1.7, crit:0.005, eva:0.004 },                          range:0.78 },
  vulcan:        { ko:'발칸포',       slot:'WEAPON', set:null,
                   stats:{ atk:20, spd:2.1, crit:-0.007, hp:25, def:-3.1, eva:0.004 },               range:1.25 },
  railgun:       { ko:'레일건',       slot:'WEAPON', set:'precision',
                   stats:{ atk:24, spd:1.4, crit:0.027, hp:-36, def:-0.8, eva:0.004 },                range:0.80 },
  photonLance:   { ko:'포톤 랜스',    slot:'WEAPON', set:null,
                   stats:{ atk:37, spd:0.2, hp:-3, def:-7.4, crit:0.007, eva:0.001 },                           range:0.90 },
  /* 채프 런처 — 쏠수록 느려진다. **초기화가 없다.**
     원안은 '2초 미공격 시 초기화' 였는데 1:1 에서는 자기 턴마다 반드시 공격하므로
     그 조건이 영원히 성립하지 않는다(단위를 초로 잡든 턴으로 잡든 같다).
     초기화를 빼면 오히려 원래 컨셉대로다 — 처음엔 가장 빠른 중화기, 끝엔 가장 느린. */
  chaffLauncher: { ko:'채프 런처',    slot:'WEAPON', set:null,
                   stats:{ atk:18, spd:2.3, crit:0.028, hp:44, def:0.1 },                           range:1.30,
                   fx:{ stackSpd:-0.0068, stackMax:5 } },

  breaker:       { ko:'브레이커',     slot:'WEAPON', set:'fortress',
                   stats:{ atk:28, spd:-4.5, hp:16, crit:0.007, eva:0.003 },                          range:1.25,
                   fx:{ pierce:{ C:.06, R:.07, SR:.08, SSR:.09 }, pierceAmt:0.5 } },

  /* 프레임 — 생존. 기본 지불 축은 회피다. */
  alloyArmor:    { ko:'합금 장갑',    slot:'FRAME', set:'fortress',
                   stats:{ hp:75, def:5.4, eva:-0.015, crit:-0.006, atk:1, spd:0.8 },   range:1.12 },
  reactiveArmor: { ko:'리액티브 아머', slot:'FRAME', set:null,
                   stats:{ hp:69, def:4.1, crit:0.014, eva:-0.004, atk:4, spd:0.2 },     range:1.12 },
  shieldFrame:   { ko:'실드 프레임',  slot:'FRAME', set:null,
                   stats:{ def:12.9, eva:0.018, spd:0.7, hp:-12, atk:3, crit:-0.018 },                range:1.12 },
  lightFrame:    { ko:'경량 골격',    slot:'FRAME', set:'assault',
                   stats:{ hp:29, def:-0.5, eva:0.035, spd:1.9, atk:-9, crit:0.004 },         range:0.86 },
  nanoCoat:      { ko:'나노 코팅',    slot:'FRAME', set:'precision',
                   stats:{ hp:60, def:4.8, eva:0.01, atk:-4, spd:1.1 },                  range:0.90 },

  /* 부스터 — 기동. 기본 지불 축은 방어다. */
  thruster:      { ko:'스러스터',     slot:'BOOSTER', set:'fortress',
                   stats:{ spd:5.6, hp:-10, def:10.6, atk:-9 },                   range:1.18 },
  floatPack:     { ko:'플로트 팩',    slot:'BOOSTER', set:null,
                   stats:{ spd:7.3, eva:0.029, def:-10.3, hp:-12, crit:-0.002 },                 range:0.84 },
  boostUnit:     { ko:'부스트 유닛',  slot:'BOOSTER', set:null,
                   stats:{ spd:5.5, eva:0.034, hp:3, def:-4.8, atk:-8, crit:0.005 }, range:1.00 },
  highMobility:  { ko:'고기동 백',    slot:'BOOSTER', set:'assault',
                   stats:{ spd:5.1, eva:0.038, crit:0.027, hp:-54, def:-8.4, atk:-1 }, range:0.82 },
  ambac:         { ko:'AMBAC',        slot:'BOOSTER', set:'precision',
                   stats:{ spd:3.8, eva:0.041, crit:0.027, atk:-13, hp:-24, def:-1.6 }, range:0.84 },

  /* 코어 — 빌드 보조. 기본 지불 축은 속도다. */
  reactor:       { ko:'리액터',       slot:'CORE', set:'fortress',
                   stats:{ hp:73, def:7.5, crit:-0.007, eva:-0.014, spd:1.1, atk:-1 } },
  generator:     { ko:'제너레이터',   slot:'CORE', set:null,
                   stats:{ hp:86, crit:0.031, spd:-2.5, def:4 },       range:1.15 },
  tacticalCore:  { ko:'전술 코어',    slot:'CORE', set:'precision',
                   stats:{ hp:21, def:12.2, crit:0.017, spd:0.1, eva:-0.021, atk:6 },   range:1.12 },
  controlChip:   { ko:'컨트롤 칩',    slot:'CORE', set:null,
                   stats:{ hp:76, def:6.6, spd:0.6, crit:0.009, atk:-5 } },
  overdrive:     { ko:'오버드라이브', slot:'CORE', set:'assault',
                   stats:{ atk:36, crit:0.013, spd:0.5, hp:-38, def:-12.2, eva:0.016 } },
};

/* ── 인챈트 18종 ──────────────────────────────────────────
   하나가 하나의 플레이 스타일을 만들어야 한다. '공격 +10' 짜리는 넣지 않는다.
   slots 가 '*' 면 전체, 아니면 그 슬롯에만 붙는다.
   group 이 같은 둘은 한 파츠에 같이 못 붙는다(AFFIX_GROUPS).
   w 는 뽑기 가중치 — 균형만 낮다(패널티가 없으므로 희귀도로 값을 치른다). */
export const AFFIXES = {
  highSpeed:  { ko:'고속',     slots:'*',                 group:null,      w:100, stats:{ spd:1.7, def:-3.4 } },
  ragged:     { ko:'누더기',   slots:'*',                 group:'weight',  w:100, stats:{ spd:0.85, eva:0.0085, hp:-38.25, def:-3.4 } },
  overcharged:{ ko:'과충전',   slots:['WEAPON','CORE'],   group:'output',  w:100, stats:{ atk:10.2, crit:0.0085, hp:-29.75 } },
  precise:    { ko:'정밀',     slots:'*',                 group:'range',   w:100, stats:{ crit:0.0127, atk:-3.4 }, range:0.88 },
  unstable:   { ko:'불안정',   slots:'*',                 group:'range',   w:100, stats:{ atk:12.75 },            range:1.18 },
  heavy:      { ko:'중장',     slots:'*',                 group:'weight',  w:100, stats:{ hp:40.8, def:5.52, spd:-1.7, eva:-0.0085 } },
  light:      { ko:'경량',     slots:'*',                 group:'weight',  w:100, stats:{ spd:1.7, eva:0.0127, hp:-38.25, def:-4.25 } },
  reinforced: { ko:'강화',     slots:'*',                 group:'defense', w:100, stats:{ hp:42.5, def:5.1, crit:-0.0068 } },
  reactive:   { ko:'반응형',   slots:['FRAME','BOOSTER'], group:null,      w:100, stats:{ eva:0.0153, spd:0.85, def:-3.4 } },
  keen:       { ko:'예리한',   slots:['WEAPON','CORE'],   group:null,      w:100, stats:{ crit:0.0213, atk:4.25, spd:-0.85 } },
  piercing:   { ko:'관통',     slots:['WEAPON'],          group:null,      w:100, stats:{ atk:-4.25 }, fx:{ pierce:.08 } },
  stabilized: { ko:'안정화',   slots:'*',                 group:'range',   w:100, stats:{ def:3.4, atk:-3.4 },     range:0.86 },
  berserk:    { ko:'광폭',     slots:['WEAPON','CORE'],   group:'output',  w:100, stats:{ atk:13.6, spd:1.7, hp:-29.75, def:-6.8 } },
  fortified:  { ko:'요새화',   slots:['FRAME','CORE'],    group:'defense', w:100, stats:{ hp:68, def:8.5, spd:-2.55, eva:-0.0127 } },
  /* 재생 — 원안은 '5초간 무피해 시 초당 회복' 이었다. 1:1 에서 15연속 회피는
     사실상 안 나온다(20% 회피 기준 10의 -11승). **직전 공격을 피했으면** 으로
     바꾸면 회피 빌드에서만 살아나는 옵션이 된다 — 그 편이 정체성도 분명하다. */
  regen:      { ko:'재생',     slots:['FRAME','CORE'],    group:null,      w:100, stats:{ def:-3.4 }, fx:{ regen:0.003 } },
  /* 균형 — 패널티가 없다. 원칙 4('단점이 없으면 최대 성능을 낮춘다')를
     수치가 아니라 **등장 빈도**로 지킨다. */
  balanced:   { ko:'균형',     slots:'*',                 group:null,      w:14,  stats:{ atk:4.25, hp:21.25, def:2.55, spd:0.85 } },
  /* 아래 둘은 부스터를 위해 새로 넣는다. 원안 16종에서는 부스터만 전용 인챈트가
     없어 쓸 수 있는 것이 10종(조합 39가지)뿐이었다 — 코어 14종/83가지의 절반도
     안 된다. 게다가 부스터 베이스 5종 중 4종이 이미 속도·회피로 몰려 있어
     '먹어도 비슷비슷한 슬롯' 이 된다. */
  inertial:   { ko:'관성 제어', slots:['BOOSTER','FRAME'], group:'range',  w:100, stats:{ spd:0.85, hp:-25.5 }, range:0.88 },
  retro:      { ko:'역추진',    slots:['BOOSTER','FRAME'], group:null,     w:100, stats:{ eva:0.0255, def:5.1, spd:-1.7 } },
};

/* 같은 그룹은 한 파츠에 하나만. 뜻이 충돌하거나(무게를 동시에 늘리고 줄임)
   과하게 겹치는(구간을 두 번 좁힘) 조합을 구조로 막는다. */
export const AFFIX_GROUPS = {
  weight:  ['heavy', 'light', 'ragged'],
  range:   ['precise', 'unstable', 'stabilized', 'inertial'],
  output:  ['overcharged', 'berserk'],
  defense: ['reinforced', 'fortified'],
};

/* 인챈트 티어 I~IV. 데이터를 복제하지 않고 배수로 적용한다.
   높은 티어일수록 **좋은 효과는 커지고 나쁜 효과는 조금 줄어든다.**
   AFFIX_ROLL 은 티어 안에서 다시 굴리는 폭이다 — 이게 있어야 같은 [고속 IV]도
   서로 다르고, 나중에 붙일 인챈트 재설정·잠금·합성이 뜻을 갖는다.
   파츠에 seed 를 같이 저장하므로 값은 언제든 그대로 재현된다(서버가 재계산한다). */
export const AFFIX_TIER = {
  I:   { pos:0.75, neg:1.00 },
  II:  { pos:0.90, neg:1.00 },
  III: { pos:1.05, neg:0.95 },
  IV:  { pos:1.20, neg:0.90 },
};
export const AFFIX_ROLL = 0.12;      // 티어 안에서 +-12%

/* 흩어져 있던 조정 수치를 한곳에 모은다. 서버도 이 값을 읽으므로
   여기를 바꾸면 서버 재배포가 필요하다. */
export const CONST = {
  /* 출격비 — 대전 한 판에 드는 크레딧. 출전 기체 레벨에 비례한다.
     레벨이 오르면 보상도 커지므로, 고정값으로 두면 후반에 있으나 마나 해진다.
     Lv.1 = 21 / Lv.30 = 108 / Lv.60 = 198.  (승리 보상이 Lv.30 기준 약 560)
     ※ 값 조정은 ChatGPT 담당. 계산식은 js/stats.js 의 sortieCost 에 있다. */
  SORTIE: { base: 18, perLv: 3 },
  /* 토벌 — 몬스터를 골라 사냥하는 파밍 모드.
     아레나는 크레딧과 레이팅을, 토벌은 스크랩과 파츠를 준다. 둘이 겹치지 않아야
     양쪽 다 할 이유가 생긴다. 레이팅은 움직이지 않는다.
       costX  출격비 배수      lv     내 레벨 대비 상대 레벨
       crX/scX 크레딧·스크랩 배수   partP  파츠가 나올 확률   coreP 코어 확률
      BOSS 는 레벨을 크게 얹어 '아직 못 잡는 벽'으로 둔다. 잡히면 파밍 효율이 가장 좋다.
      ※ 값 조정은 ChatGPT 담당. */
  /* lv 는 예전에 -6 ~ +12 였다. 그때는 레벨 1이 거의 의미가 없어 그만큼 벌려야 했지만,
     지금은 레벨 1 차이가 승률 80% 다. 그대로 두면 EP·BOSS 가 영원히 잠긴 문이 된다.
     난이도는 이제 몬스터의 '등급'이 만든다 — 내 등급과 같으면 반반, 한 단계 아래는 사냥터,
     한 단계 위는 벽이다. lv 은 낮은 등급을 확실한 farm 으로 만드는 데만 쓴다.
     (실측 Lv.30: 자기 등급 43~55% / 한 단계 아래 93~100% / 한 단계 위 5~17%) */
  /* 30일 플레이 실측에서 전 등급 crX 0.45는 고등급 토벌을 많이 돌수록 가난해져
     집중형의 전투가 막혔다. 승률과 출격비가 다른 만큼 등급별로 보정하되, 30일 누적
     토벌 수지는 약 -8%로 남겨 크레딧 벌이는 아레나의 역할로 유지한다. */
  HUNT: {
    C:    { costX: 1.0, lv:  -2, crX: 0.65, scX: 1.6, partP: 0.10, coreP: 0    },
    UC:   { costX: 1.4, lv:  -1, crX: 0.70, scX: 2.1, partP: 0.13, coreP: 0    },
    R:    { costX: 2.0, lv:   0, crX: 0.60, scX: 2.8, partP: 0.17, coreP: 0.05 },
    /* UQ · EP · BOSS 는 입장료를 1.5배로 올리고 **주간 입장 한도**(아래 HUNT_WEEK)를 걸었다
       (2026-09-19 사용자 지시 — "도감작을 위해 빈번하게 들어갈 수 있으니"). 전: 3.0 · 4.5 · 8.0 */
    UQ:   { costX: 4.5, lv:   0, crX: 0.70, scX: 3.6, partP: 0.22, coreP: 0.10 },
    EP:   { costX: 7.0, lv:   0, crX: 1.10, scX: 4.6, partP: 0.28, coreP: 0.18 },
    /* 보스는 최종 벽이다. 플레이어보다 30레벨 높게 등장하고 위의 보스 전용 성장 곡선을 쓴다.
       실측: EP Lv.60 + SR 4개 +3강은 0%, SSR 4개 +10강은 평균 23% 승리한다. */
    BOSS: { costX: 12.0, lv: 30, crX: 2.25, scX: 7.0, partP: 0.45, coreP: 0.35 },
  },
  /* 토벌 주간 입장 한도 — 여기 적힌 등급만 센다. **일요일 00:00(한국 시각)** 에 풀린다.
     하루 3 · 2 · 1 번꼴이다. 입장료를 낸 순간(전투 시작) 한 번으로 센다 — 져도 센다.
     값은 사용자가 "일단 만들어 봐" 라고 맡긴 첫 값이다. 도감 단계(CODEX.mon)의 문턱이 이 속도를 전제로 잡혀 있다.
     HUNT 안에 두지 않는다: 화면이 Object.keys(CONST.HUNT) 로 사냥터 줄을 그린다. */
  HUNT_WEEK: { UQ: 21, EP: 14, BOSS: 7 },
  /* 토벌 경험치 — 대전이 주는 값의 이 배수(사용자 지시 2026-09-18: 대전의 1%).
     토벌은 **파밍 자리**다. 대전과 같은 경험치를 주면 레벨을 올리러 사냥터를 돌게 되고,
     그러면 '돈과 순위는 대전, 재료는 토벌' 로 갈라 둔 것이 무너진다.
     이긴 판은 최소 1 을 준다 — 0 이면 결과창의 '경험치 +0' 이 고장처럼 보인다.
     HUNT 안에 두지 않는다: 화면이 Object.keys(CONST.HUNT) 로 사냥터 줄을 그린다. */
  HUNT_EXP_X: 0.01,
  /* 원정 — 기체를 얼마간 내보내 두고 재화를 받아 온다. 방치형 파밍이다.
     보상은 **서버 시각으로만** 계산한다. 클라 시계를 믿으면 시간을 앞당길 수 있다.
     보낸 기체는 그동안 출격할 수 없다 — 그게 이 기능이 치르는 대가다.
     편성이 두 기뿐이라(SQUAD_MAX) 주력을 보내면 대전이 눈에 띄게 불편해진다.
     보상이 기체 레벨에 비례하므로 '약한 기체를 싸게 보낼까, 주력을 비싸게 보낼까'가 판단이 된다.
       h      시간
       crH/scH 시간·레벨당 크레딧·스크랩   coreP/partP  코어·파츠가 나올 확률
     길수록 시간당 효율이 조금 낫다. 기다린 값은 해야 한다.
     ※ 값 조정은 ChatGPT 담당. */
  EXPED: {
    SHORT: { ko: '단기 정찰', h: 1, crH: 10, scH: 2.0, coreP: 0.04, partP: 0    },
    LONG:  { ko: '장기 수색', h: 4, crH: 11, scH: 2.3, coreP: 0.20, partP: 0.10 },
    DEEP:  { ko: '심층 원정', h: 8, crH: 12, scH: 2.6, coreP: 0.42, partP: 0.22 },
  },


  /* ── 점령전 ────────────────────────────────────────────
     세계 지도는 서버에 하나뿐이다. 칸 12개를 몬스터나 사람이 지키고, 뚫으면 내 것이 된다.
     전투 규칙은 '돌파' 하나다 — 자세한 규칙과 그 근거는 js/breach.js 머리말에 적었다.
       · 한 칸 = 방어선 여러 겹. 편성 두 기로 연속으로 뚫는다
       · 체력과 스킬 게이지가 다음 방어선으로 이어진다. 중간 회복이 없다
       · 실패해도 깎아 둔 방어선은 남는다. 시간이 지나면 스스로 회복한다
     ※ 값 조정은 ChatGPT 담당. */
  TERR: {
    LINE_REGEN: 0.10,   // 깎아 둔 방어선이 시간당 되돌아오는 비율 (0.10 = 10시간이면 원상복구)
    INCOME_CAP_H: 12,   // 수입은 12시간치까지만 쌓인다 — 하루 한 번은 들어와야 한다
    CAPTURE_H: 6,       // 점령 보너스 = 몇 시간치 수입인가
    FAT_DOWN: 11,       // 쓰러진 기체에 붙는 피로도 (대전 1패가 7~10)
    FAT_LIVE: 4,        // 살아남았지만 싸운 기체에 붙는 피로도
    COST_X: 2.2,        // 출격비 배수 — 아레나 한 판 기준
    EXP_LINE: 0.55,     // 방어선 하나를 뚫을 때마다 받는 경험치 (대전 1승 기준)
    RETAKE_MIN: 6,      // 내 칸이 이 수를 넘을 때만 몬스터가 하루 한 칸을 되찾는다

    /* 점령 직후 보호. 뺏은 자리에서 숨 돌릴 틈은 있어야 한다 —
       없으면 먼저 친 사람이 손해고, 같은 칸을 초 단위로 주고받는 핑퐁이 된다. */
    PROTECT_MIN: 10,    // 점령한 뒤 이 시간(분) 동안은 보통 공격을 받지 않는다

    /* 강행 — 코어를 내면 보호 중인 칸도 칠 수 있다. 대신 그 칸을 지키는 것이
       몬스터만이 아니게 된다. 점령자의 **편성 두 기가 방어선 뒤에 그대로 붙는다.**
       (보통 공격에서는 아레나 스냅샷 한 겹만 붙는다)
       코어는 뽑기 재화라, 이걸 쓴다는 것은 '뽑기 한 번을 포기하고 저 칸을 갖겠다'는 뜻이다. */
    RAID_CORE: 1,       // 강행에 드는 코어

    /* 세계 난이도 — 칸의 레벨에 전체 플레이어 평균 전투력만큼을 얹는다.
       지도는 절대 난이도라 내 사정과 무관해야 하지만, 세계가 세지면 지도도 세져야
       '어려운 콘텐츠'로 남는다. 안 그러면 어느 시점부터 전부 눌러서 이기는 버튼이 된다.

       지수는 **1보다 작게** 잡았다(0.6). 평균이 두 배가 되어도 보정은 1.5배만 는다 —
       지수가 1을 넘으면 상위 플레이어가 세질수록 지도가 폭주해 새로 온 사람이 아무 칸도
       못 들어간다. 처음(평균 300)에는 거의 안 걸리고, 성숙한 세계(평균 6000)에서 크게 걸린다.
         보정 = LV_K × (평균전투력 / LV_REF) ^ LV_EXP × 등급배수, 최대 LV_CAP
       등급배수를 둔 것은 지도의 모양(입구는 쉽고 안쪽은 어렵다)을 지키기 위해서다. */
    LV_REF: 3000,       // 기준 전투력 — Lv.30 맨몸이 대략 이 값이다
    LV_K: 8,            // 기준 전투력에서 몇 레벨을 얹을 것인가
    LV_EXP: 0.6,        // 곡선의 지수. 1 보다 작아야 위로 갈수록 완만해진다
    /* 상한이 왜 둘인가 —
       레벨 상한이 60 이라 보정에도 천장이 있어야 한다. 특히 **편성 제한이 걸린 칸**은
       데려갈 수 있는 것 자체가 낮은 등급이라, 같은 폭으로 올리면 그 등급의 만렙으로도
       못 뚫는 잠긴 문이 된다(실측: 관제 첨탑이 평균 9000 에서 UQ Lv.60 승률 0%).
       그래서 제한이 있는 칸은 더 일찍 멈춘다. */
    LV_CAP: 12,         // 아무리 세계가 세져도 이 이상은 얹지 않는다
    LV_CAP_MAXRAR: 8,   // 편성 제한이 걸린 칸의 상한
    LV_TIER: { C:0.4, UC:0.6, R:0.8, UQ:1.0, EP:1.15, BOSS:1.3 },
  },

  /* 비상 출격 — 크레딧이 출격비보다 적을 때만 열린다.
     비용 0, 상대는 몬스터 고정, 보상은 크레딧만(파츠·코어·경험치 없음), 레이팅 변동 없음.
     패배해도 다음 정상 출격 1회, 승리하면 2회를 살 수 있게 현재 출격비에 연동한다.
     고정 400/200이면 만렙은 같아도 Lv.1에서 19회/9회분을 줘 무료 파밍이 된다. */
  RESCUE: { winX: 2, loseX: 1 },
  /* 공격력 구간의 기본 폭. 기체별 spread 가 없을 때만 쓰인다.
     0.20 이면 표시 공격력 100 이 실제로는 80~120 사이에서 나온다. */
  SPREAD: 0.20,
  /* 등급 하나가 레벨 몇 개 값인가 — 커먼을 0 으로 둔 누적표.
     실측에서 커먼이 각 등급 Lv.30 과 대등해지는 지점은 +3 / +6 / +7 / +15 였다.
     갚아 주는 방향은 대칭이 아니다. 나보다 위 등급을 만나면 이 값을 다 깎아 주고,
     아래 등급을 만날 때는 7할만 얹는다. 양쪽 다 꽉 채우면 좋은 기체를 가진 보람이 사라지고
     (에픽 보유자 승률 31%), 양쪽 다 덜 주면 커먼만 가진 새 플레이어가 계속 진다(33%).
     (아레나의 사람 상대는 전투력 ±15% 로 고르므로 이 표를 쓰지 않는다) */
  TIER_LV: { C: 0, UC: 3, R: 6, UQ: 7, EP: 15 },

  /* 파츠 한 세트(4슬롯)가 레벨 몇 개 값인가 — 실측이다.
     파츠는 이 게임에서 가장 무거운 변수다. SR 네 개면 +14레벨로, 커먼→에픽 격차(+15)와 맞먹는다.
     강화는 여기에 곱으로 붙는다(SR 4개 +5 강화 = 실측 +21 ≈ 14 × 1.5).
     몬스터는 파츠를 낄 수 없으므로 이 값만큼 레벨을 얹어 준다 — 안 그러면 장비를 갖출수록
     상대의 40%(MONSTER_RATE)가 공짜 승리가 된다. */
  /* 2026-09-08 실측으로 3/6/14/22 → 1/3/7/11 로 내렸다. 예전 값은 **실측의 2배**였다.
     그 값을 정한 tools/partlv.mjs 가 대가(SLOT_COST)가 생기기 전 코드로 파츠를 만들어
     상승분만 굴리고 있었기 때문이다. 두 배로 얹어 주니 장비를 갖출수록 상대만 세져서,
     실제로는 **파츠를 낄수록 지고 있었다**(커먼 Lv.15 맨몸 54% → R 4개 33%).
     지금 값은 Lv.30 실측(C 1.2 · R 2.5 · SR 7.3 · SSR 10.5)에 맞춘 것이다. */
  PART_LV: { C: 1, R: 3, SR: 7, SSR: 11 },
  PART_ENH_LV: 0.10,      // 강화 1당 파츠 가치 배수 증가분

  /* ── 스킬 강화 ────────────────────────────────────────
     기체의 스킬 위력을 크레딧+스크랩으로 올린다. **첫 강화부터 실패한다.**
     쉽게 세지면 안 되기 때문이다 — 실패해도 재화는 나간다.

     파츠 강화(스크랩만)와 재화를 다르게 둔 것은, 둘이 같은 자원을 두고 다투게 하면
     한쪽이 늘 밀리기 때문이다. 스킬은 크레딧까지 함께 든다.

     mult   강화 1당 스킬 배수에 더해지는 값. 곱으로 붙는다
            (0.03 · 10강이면 스킬 위력 1.30배. 최종 장비에서 +10 대 +0 승률이
             평균 74.6%라, 성장 보상은 남기되 일방전은 피한다)
     rate   성공 확률. 배열의 i 번째가 'i강 → i+1강' 확률이다. 첫 칸부터 1 이 아니다
     ※ 값 조정은 ChatGPT 담당. */
  /* ── 파츠 강화 ────────────────────────────────────────
     **2026-09-17 사용자 지시로 확률이 생겼다.** 그 전에는 스크랩만 내면 무조건 올라서
     강화가 아니라 '값을 내면 오르는 슬라이더' 였다 — 파츠 한 벌을 +10 까지 990 스크랩,
     분해 환급(50%)을 빼면 실질 495 였다. SR 파츠 일곱 개 값이다.

     rate   단계별 성공 확률. **앞 세 단계는 확실히 오른다** — 전선 1장을 도는
            사람에게 첫 강화부터 실패를 보이면 배우는 것 없이 재화만 잃는다
     cost   스크랩 = base + 단계 × step
     실패해도 단계는 안 내려가고 파츠도 안 깨진다. 재화만 나간다(스킬 강화와 같은 규칙).

     기대값 — +10 까지 15.8회 · 스크랩 1,902 (전 990 · 1.9배).
     분해 환급은 **명목 비용의 합**만 돌려주므로(js/gacha.js) 확률이 붙을수록
     환급 비율이 낮아진다 — 강화→분해 펌프는 여전히 불가능하다. */
  PART_ENH: {
    max: 10,
    rate: [1.00, 1.00, 1.00, 0.92, 0.85, 0.78, 0.70, 0.62, 0.54, 0.46],
    base: 24, step: 22,
  },

  SKILL_UP: {
    max: 10,
    mult: 0.03,
    /* 2026-09-17 사용자 지시로 확률을 낮추고 비용을 올렸다.
       전: rate .90~.30 · 900+580×단계 → 기대 18.9회 · 77,523 크레딧
       후: rate .88~.22 · 1000+700×단계 → 기대 23.0회 · 116,104 크레딧 (1.5배) */
    rate: [0.88, 0.80, 0.72, 0.64, 0.56, 0.48, 0.40, 0.33, 0.27, 0.22],
    crBase: 1000, crLv: 700,     // 크레딧 = crBase + 단계 × crLv  (기체 레벨 배수 없음)
    scBase:  50, scLv:  36,      // 스크랩 = scBase + 단계 × scLv
    /* 기체 레벨 배수를 뺀 자리다(2026-09-09). 예전에는 크레딧에 (1 + 기체레벨 × 0.02)를
       곱해서 같은 +10 이 Lv.1 45,130 · Lv.60 97,338 이었다 — 먼저 강화하고 나중에 키우면
       54% 싸다. 육성 순서가 정답이 되어 버린다. 배수를 빼고 단계 값으로 옮겼다.
       기대 +10 은 18.85회 · 77,523 크레딧 · 3,981 스크랩이고,
       마지막 단계 10연속 실패 확률은 10.7% → 2.8% 로 내려간다. */
  },

  /* 표시 전투력에서 스킬이 차지하는 공격 몫.
     한 스킬은 평균 평타 2.69회의 가치이고 4턴 주기(평타 3 + 스킬 1)이므로
     공격 스킬 비중은 2.69 / (3 + 2.69) ≈ 0.47이다. 공격 구간에만 적용한 뒤
     기존 생존 기하평균을 타므로, +10(스킬 ×1.30)의 표시 전투력은 약 6.8% 오른다. */
  SKILL_POWER_SHARE: 0.47,

  /* ── 아레나 상대의 장비를 무엇에 맞출 것인가 ────────────
     예전에는 **내가 낀 파츠를 그대로 따라갔다**(거울 대치). 그러면 좋은 파츠를 껴도
     상대가 같이 세져서 이득이 즉시 상쇄된다 — 실제로 파츠를 낄수록 승률이 떨어졌다.
     장비를 갖추는 것이 이 게임의 보상인데, 그 보상이 아레나에서만 사라지는 셈이었다.

     그래서 기준을 **내 장비가 아니라 내 성적(레이팅)** 으로 옮긴다.
       · 좋은 파츠를 끼면 → 한동안 이긴다(진짜 보상) → 레이팅이 오른다
       · 레이팅이 오르면 → 상대 장비가 따라 올라와 다시 팽팽해진다
      상쇄가 '즉시'에서 '이긴 다음'으로 바뀐다. 그 사이가 곧 성장의 체감이다.

      at 은 그 줄이 적용되기 시작하는 레이팅이다(시작 레이팅 1000).
      skillLv 는 생성 상대의 스킬 강화다. 플레이어의 강화를 즉시 복사하지 않고
      레이팅 문턱을 따라 올려 성장 보상은 남기면서 고레이팅의 +0 고정을 막는다.
     ── 2026-09-18 다시 짰다: **어느 줄도 앞 줄보다 약하지 않다** ──
     예전 15단계 표는 등급을 올리는 줄에서 개수를 줄이고 강화를 0 으로 되돌렸다
     (1500 4xR+4 → 1620 2xSR+0 처럼). 강화 +0→+10 이 레벨 7.1 어치로 가장 큰 축이라,
     그 줄마다 상대가 **약해졌다.** 실측(tools/bandwalk.mjs --robot) — 레이팅 1620~2400 에서
     로봇 판 승률이 90~100% 로 치솟고 레이팅이 끝없이 올랐다(434판에 2960).
     지금 표는 개수 → 등급 → 강화 순으로 채우고, 등급을 올릴 때 강화를 **그대로 둔다**.
     한 줄의 오름폭은 레벨 0.7~1.3 어치다(개수 하나 ≈0.85 · 등급 하나 ≈1.3 · 강화 하나 ≈0.7).
     같은 측정에서 로봇 판 승률이 63~80% 로 고르게 가고 끝 레이팅은 2480 이다.
     tools/bandcheck.mjs 가 '뒤로 가는 줄이 없다' 를 지킨다. */
  /* ── 대전 몬스터 구간표 (2026-09-18 사용자 지시) ───────────
     사용자 지적: "내 기체가 강해질 때마다 상대도 같이 세져서 일정 구간에 역전이 난다."
     그리고 "티어나 계단별로 증가할 수 있도록 구간 안에서 스펙이 조절되게 하자."

     **구간 안에서 몬스터는 완전히 고정이다.** 예전에는 `내 레벨 + 보정` 이라
     내가 자라면 상대도 같이 자라 제자리걸음이었다(레이팅 2400 에서 승률 33% 골짜기).
     이제 레이팅이 구간을 정하고, 구간 안에서 내 성장은 **온전히 남는다.**

     ── 무엇이 구간을 움직이나 — **몬스터 판의 승패** (MON_BAND_STEP) ──
     그 구간 몬스터를 이기면 +1, 지면 −1. +5 에 닿으면 승급, −3 에 닿으면 강등.
     처음에는 레이팅으로 골랐는데, 레이팅은 몬스터 판에서 **움직이지 않는다**(로봇·사람
     상대만 움직인다). 그래서 구간이 몬스터 성적과 무관하게 로봇 판으로만 올라갔고,
     실측하니 앞 구간 94~100% · 뒤 구간 4~42% 였다. 지금은 **구간을 올린 것 = 그 구간
     몬스터를 이긴 것**이다. 이겨야 오른다는 약속도 그대로다 — 지면 구간이 안 오른다.
     `at` 은 이제 **처음 자리를 잡을 때만** 쓴다(이 기능 전의 계정이 어제 보던 구간에서 시작).

     ── 파밍은 강제인가 가속인가 — 실측 (tools/bandwalk.mjs) ──
     대전만 하는 사람(밖에서 받는 경험치 ×1)도 12구간에 닿는다 — 몬스터 174판.
     구간마다 처음 6판은 17~67%, 승급 직전 6판은 50~100% 다. 밖에서 경험치를 더 받으면
     ×2 에서 88판, ×4 에서는 구간을 거의 전승으로 넘는다. **강제가 아니라 가속**이다.

     ── 몬스터도 파츠를 낀다 ──
     예전에는 못 껴서 그 몫을 전부 레벨로 갚았고, 끝판에서 상대 레벨이 90
     (MAXLV+OPP_LV_OVER)에 부딪혀 더 세울 자리가 없었다. 파츠로 갚으니 상대 레벨이
     4~55 로 내 근처에 머문다. 그리고 **플레이어가 그 파츠를 눈으로 본다** —
     "저런 것도 있구나" 가 다음 목표가 된다.

     ── 표를 읽는 법 ──
       at    처음 자리를 잡을 때의 레이팅 문턱(그 뒤로는 승패가 움직인다)
       lv    몬스터 고정 레벨. 구간 안에서 **안 움직인다**
       rars  나오는 몬스터 등급
       gear  몬스터가 끼는 파츠 — 개수 n · 등급 rar · 강화 enh

     ── 앞 두 줄(Lv.1 · Lv.6 · Lv.11) — 2026-09-18 덧붙였다 ──
     처음 표는 1구간이 Lv.4 였고 2구간이 Lv.16 이었다. 그런데 **새 계정의 첫 기체는 grit(C)**
     인데 표를 azure(R) 로만 쟀다. 운영에서 새 계정이 1구간에 10판 2승을 했다(Lv.1~3 grit
     승률 0~4%). 1구간을 Lv.1 로 내리고, 5승이면 Lv.5 쯤에 오르므로 Lv.16 까지 사이에 두 칸을
     끼웠다. grit·azure·mule 로 시드 4개씩 걸어 전부 끝 구간에 닿는다(tools/bandwalk.mjs --my).

     실측(tools/bandplan.mjs, 끼우기 전 12구간) — 진입 평균 44% · 졸업 평균 90% · 막히는 구간 0개.
     구간에 45% 로 들어가 80~100% 로 졸업한다. 뒷부분이 싱거운 것은 의도다 —
     뚫고 들어가 고생하다 압도하며 거두는 자리가 파밍의 리듬이다.
     ※ 값 조정은 ChatGPT 담당(2026-09-18 부터 당분간 Claude 가 대신한다).
       구간 하나의 난이도는 `node tools/bandplan.mjs 12`, 구간을 오가는 흐름은
       `node tools/bandwalk.mjs` 로 잰다. */
  MON_BAND: [
    { at:    0, lv:  1, rars: ['C'],          gear: { n: 0, rar: 'C',   enh:  0 } },
    { at: 1030, lv:  6, rars: ['C'],          gear: { n: 0, rar: 'C',   enh:  0 } },
    { at: 1055, lv: 11, rars: ['C'],          gear: { n: 1, rar: 'C',   enh:  0 } },
    { at: 1080, lv: 16, rars: ['C'],          gear: { n: 1, rar: 'C',   enh:  0 } },
    { at: 1160, lv: 23, rars: ['C', 'UC'],    gear: { n: 2, rar: 'C',   enh:  1 } },
    { at: 1250, lv: 30, rars: ['C', 'UC'],    gear: { n: 2, rar: 'R',   enh:  1 } },
    { at: 1350, lv: 32, rars: ['UC', 'R'],    gear: { n: 3, rar: 'R',   enh:  2 } },
    { at: 1460, lv: 38, rars: ['UC', 'R'],    gear: { n: 4, rar: 'R',   enh:  3 } },
    { at: 1580, lv: 40, rars: ['R'],          gear: { n: 4, rar: 'SR',  enh:  4 } },
    { at: 1710, lv: 45, rars: ['R'],          gear: { n: 4, rar: 'SR',  enh:  5 } },
    { at: 1850, lv: 48, rars: ['R', 'UQ'],    gear: { n: 4, rar: 'SR',  enh:  6 } },
    { at: 2000, lv: 52, rars: ['R', 'UQ'],    gear: { n: 4, rar: 'SSR', enh:  7 } },
    { at: 2170, lv: 55, rars: ['UQ'],         gear: { n: 4, rar: 'SSR', enh:  8 } },
    { at: 2350, lv: 54, rars: ['UQ', 'EP'],   gear: { n: 4, rar: 'SSR', enh:  9 } },
  ],

  /* 구간 승급·강등 문턱 — 몬스터 판 승패의 누적. 위 MON_BAND 주석 참조.
     up 을 올리면 구간마다 오래 머물고(수확기가 길어진다), down 을 줄이면 강등이 잦아진다.
     `node tools/bandwalk.mjs` 로 다시 잰다. */
  MON_BAND_STEP: { up: 5, down: 3 },

  /* ── 상점 (2026-09-18 사용자 지시) ─────────────────────────
     크레딧을 쓰는 곳. 뽑기는 그대로 두고, 옆에 **주기마다 바뀌는 진열**을 둔다.
     진열 칸마다 무엇이 나올지를 확률로 굴린다 — 좋은 것일수록 드물고 비싸다.
     "코어는 낮은 확률로 비싸게" (사용자).

     periodH  진열이 저절로 바뀌는 주기(시간). 그 사이에는 크레딧을 내고 새로 굴릴 수 있다
     slots    진열 칸 수
     kind     칸 하나가 무엇이 될지 — 가중치
     part     파츠 등급 — 가중치 w · 값 cr (파츠 레벨은 내 레벨)
     shard    기체 조각 등급 — 가중치 w · 조각 하나의 값 cr · 한 칸에 qty 개
     scrap    스크랩 묶음 — qty 범위 · 하나의 값 cr
     core     코어 — qty · 값 cr
     lv       값 배율 = base + per × 내 레벨. 수입이 레벨을 따라 오르므로 값도 따라 오른다
              (Lv.1 ×0.64 · Lv.30 ×1.8 · Lv.60 ×3.0)
     refresh  새로 굴리는 값. 같은 주기 안에서 굴릴수록 오른다(× 굴린 횟수 + 1)

     크레딧 대비 — Lv.30 에서 대전 1승이 약 540 크레딧 · 스크랩 25 · 코어 0.2 다.
       스크랩 1개 ≈ 40 크레딧(×1.8)  → 대전보다 약 3배 비싸다(급할 때 사는 값)
       코어 1개   ≈ 14,400 크레딧    → 대전 27승 어치. 대전으로는 5승이면 나온다 — 비싸다
       SSR 파츠   ≈ 16,200 크레딧    → 약 30승
     ※ 값 조정은 ChatGPT 담당(2026-09-18 부터 당분간 Claude 가 대신한다). */
  SHOP: {
    periodH: 6,
    slots: 6,
    kind:  { part: 58, shard: 27, scrap: 12, core: 3 },
    part:  { C: { w: 55, cr: 400 }, R: { w: 30, cr: 1200 }, SR: { w: 12, cr: 3500 }, SSR: { w: 3, cr: 9000 } },
    shard: { qty: [3, 6],
             C: { w: 45, cr: 150 }, UC: { w: 28, cr: 250 }, R: { w: 16, cr: 400 },
             UQ: { w: 8, cr: 700 }, EP: { w: 3, cr: 1200 } },
    scrap: { qty: [40, 80], cr: 22 },
    core:  { qty: 1, cr: 8000 },
    lv:    { base: 0.6, per: 0.04 },
    refresh: { cr: 300 },
  },
  /* 기체 조각 — 이만큼 모으면 그 기체를 조립한다. 이미 가진 기체면 뽑기와 같이
     DUPE_GAIN 으로 바뀐다. 에픽 40개 ≈ 조각값만 4.8만 × 배율이라 뽑기 대신 고르는 값이다. */
  SHARD_NEED: { C: 10, UC: 15, R: 20, UQ: 30, EP: 40 },

  /* ── 도감 (2026-09-18 사용자 지시 · 같은 날 활성화 방식으로 고쳤다) ──────
     몬스터 16 · 기체 71(뽑을 수 있는 것) · 파츠 84칸(21종 × 4등급).

     **모은 칸은 재화를 내고 '활성화' 해야 센다.** 이정표(steps)는 활성화한 칸 수로 넘는다.
     이정표에 닿으면 **그때까지 활성화에 쓴 재화를 돌려준다** — 크레딧은 +2% 얹어서,
     코어는 −10% 깎아서(refund). 그리고 이정표에 붙은 칭호가 열린다.
       · 크레딧: 쓴 만큼 묶였다가 1.02 배로 돌아온다 — 평생 합이 +3,300 정도라 인플레가 없다
       · 코어:   쓴 것의 90% 만 돌아온다 — 도감 전체로 코어 약 5개가 빠져나가는 소모처다
     (사용자 판단: "1.02 추가된 보상에 칭호까지 주니 경제에 끼치는 영향은 매우 작다")

     act — 칸 하나를 활성화하는 값. 등급이 높을수록 비싸다.
     총액 — 크레딧 165,800 · 코어 54. 스킬 +10 한 번(기대 11.6만)과 비슷한 규모다.
     ※ 값 조정은 ChatGPT 담당(2026-09-18 부터 당분간 Claude 가 대신한다). */
  CODEX: {
    act: {
      monster: { C: { cr: 400 }, UC: { cr: 800 }, R: { cr: 1500 }, UQ: { cr: 3000, co: 1 },
                 EP: { cr: 5000, co: 2 }, BOSS: { cr: 8000, co: 3 } },
      robot:   { C: { cr: 300 }, UC: { cr: 600 }, R: { cr: 1200 }, UQ: { cr: 2500, co: 1 }, EP: { cr: 4000, co: 2 } },
      part:    { C: { cr: 100 }, R: { cr: 300 }, SR: { cr: 800 }, SSR: { cr: 2000, co: 1 } },
    },
    refund: { cr: 1.02, co: 0.9 },
    /* 몬스터 도감 단계 (2026-09-19 사용자 지시). 처치 수로 오른다 — 저장값을 따로 두지 않는다.
         t  [1단계, 2단계, 3단계, 4단계] 에 필요한 처치 수
            1단계 = '모음' — 여기 닿아야 활성화할 수 있다(전에는 처치 1번). 활성화 값은 위 act 그대로
         p  [3단계, 4단계] — 문턱을 넘은 **다음부터 처치할 때마다** 이 확률로 오른다
            기대 처치 수 = 문턱 + 1/p. 4단계는 3단계에 오른 **뒤의** 처치로만 굴린다
       단계가 오르면 도감 카드 테두리 색이 바뀐다(2 동 · 3 은 · 4 금). 다른 보상은 없다.
       보스는 토벌(주 7번 · 승률 0~23%)에서만 잡히므로 문턱이 훨씬 낮다.
       기대값 — C 3단계 250 · 4단계 600 / BOSS 3단계 약 19 · 4단계 약 37 처치 */
    mon: {
      C:    { t: [5, 50, 200, 500], p: [0.02,  0.01]  },
      UC:   { t: [5, 40, 150, 400], p: [0.025, 0.0125] },
      R:    { t: [5, 30, 100, 250], p: [0.03,  0.015] },
      UQ:   { t: [5, 20,  60, 150], p: [0.05,  0.025] },
      EP:   { t: [3, 12,  40, 100], p: [0.08,  0.04]  },
      BOSS: { t: [2,  5,  12,  25], p: [0.15,  0.08]  },
    },
    steps: {
      monster: [ { n: 4 }, { n: 8, title: 'hunter' }, { n: 16, title: 'tracker' },   // 보스 셋을 빼면 16종이다(2장 셋 포함)
                 { n: 19, title: 'giantslayer' } ],
      /* 2026-09-21 세트 03 으로 뽑을 수 있는 기체가 43종 — 36 · 43 이정표를 더했다(스토리 기체는 세지 않는다) */
      /* 2026-09-23 세트 04(R 10기) · 세트 05(UQ 18기)로 뽑을 수 있는 기체가 71종 — 53 · 62 · 71 이정표를 더했다 */
      /* 2026-09-23 세트 06(EP 5기)으로 76종 — 76 이정표를 더했다 */
      robot:   [ { n: 6 }, { n: 12, title: 'mechanic' }, { n: 18 }, { n: 24 }, { n: 30, title: 'hangarlord' }, { n: 36 }, { n: 43 }, { n: 53 }, { n: 62 }, { n: 71 }, { n: 76 } ],
      part:    [ { n: 10 }, { n: 21, title: 'scavenger' }, { n: 42 }, { n: 63, title: 'artificer' },
                 { n: 84, title: 'forgemaster' } ],
    },
    all: { title: 'legend' },
    /* 칭호 이름. 키는 저장값이라 **바꾸거나 지우지 않는다** — 이름만 고친다. */
    titles: {
      hunter:      '사냥꾼',
      tracker:     '전장의 추적자',
      giantslayer: '거신 살해자',
      mechanic:    '정비사',
      hangarlord:  '격납고의 주인',
      scavenger:   '고철 줍는 자',
      artificer:   '부품 장인',
      forgemaster: '공방장',
      legend:      '잿빛 성단의 전설',
    },
  },

  /* 숙련 = 그 기체의 특성 포인트(js/stats.js traitPoints). [n레벨마다, 몇 점] 을 전부 더하고 최고 레벨에 maxBonus.
     2026-09-23 사용자 결정 — 5레벨마다 1 · 10레벨마다 1 더 · 최고 레벨에 2 더(Lv.60 = 20점) */
  /* 숙련 — every 는 특성 포인트(js/stats.js traitPoints · Lv.60 에 20),
     shard 는 개발 목표로 쌓이는 조각(js/mastery.js · Lv.60 에 **14**).
     **조각을 레벨에 붙인 것은 잠정이다** — 원래 의도는 '숙련은 특성 포인트만' 이었는데(2026-09-23 밤),
     조각 수급처가 아직 정해지지 않아 레벨에 얹었다. 수급처가 정해지면 이 표를 0 으로 두거나 다른 축으로 옮긴다.
     조각 값은 2026-09-23 사용자 결정 '중간' — 원하는 EP 한 기를 계보로 얻는 데 약 110일.
     뽑기로 아무 EP 나 얻는 기대 기간(약 75일)의 1.5배다. 90일 경제로 쟀다(tools/play.mjs). */
  MASTERY: { every: [[5, 1], [10, 1]], maxBonus: 2, shard: { every: [[5, 1]], maxBonus: 2 } },
  /* 개발 계보(data/lineage.js · js/lineage.js). gate — 조각 조립에 계보 조건을 거는가.
     **지금은 끈다.** 켜면 앞 기체가 없는 기체의 조각은 조립하지 못하고 쌓인다. 이유를 보여 줄 계보도 화면이
     UI 개편에서 나온 뒤 켠다(CONTRACT '개발 계보'). */
  LINEAGE: { gate: false },

  /* 정제 코어(2026-09-25 사용자 지시) — 코어 need 개를 합쳐 1개. **지금은 합치기 말고는 얻을 길이 없다.**
     pull — 정제 코어 뽑기 1회 값 · circuitReset — 코어 서킷을 비울 때 드는 값(추가 비용은 사용자가 나중에 정한다) */
  REFINE: { need: 10, pull: 1, circuitReset: 1 },
  /* 조각 회수 작전(2026-09-25 사용자 지시) — 하루 daily 번. 개발 목표의 조각이 들어온다(숙련 조각과 같은 목표).
     난이도를 골라 **내 기체와 같은 레벨**의 몬스터 하나와 싸운다. mul — 상대 체력 · 공격 배수 · shard — 이기면 받는 조각.
     지면 횟수만 쓴다. 파츠 없는 기체 기준 이길 확률 정찰 ~88% · 회수 46~57% · 강습 5~25%(레벨이 높을수록 어렵다 · 몬스터 16종 평균).
     하루는 UTC 기준(레이드와 같다 · 한국 09:00 에 바뀐다) */
  /* rar — 작전 조각이 갈 수 있는 기체 등급(2026-09-25 사용자 결정 'C ~ R 한정'). 유니크 · 에픽 조각은 앞으로 조각 합성으로 만든다.
     레벨(숙련) 조각에는 걸지 않는다 — 그쪽은 개발 목표가 무엇이든 그리로 간다 */
  SALVAGE: { daily: 2, rar: ['C', 'UC', 'R'], tiers: [ { ko: '정찰', mul: 0.7, shard: 1 }, { ko: '회수', mul: 1.0, shard: 2 }, { ko: '강습', mul: 1.3, shard: 3 } ] },

  RATING_GEAR: [
    { at:    0, n: 0, rar: 'C',   enh:  0, skillLv:  0 },
    { at: 1060, n: 1, rar: 'C',   enh:  0, skillLv:  0 },
    { at: 1120, n: 2, rar: 'C',   enh:  0, skillLv:  0 },
    { at: 1180, n: 3, rar: 'C',   enh:  0, skillLv:  0 },
    { at: 1240, n: 4, rar: 'C',   enh:  0, skillLv:  0 },
    { at: 1320, n: 4, rar: 'R',   enh:  0, skillLv:  0 },
    { at: 1400, n: 4, rar: 'R',   enh:  1, skillLv:  1 },
    { at: 1480, n: 4, rar: 'R',   enh:  2, skillLv:  1 },
    { at: 1560, n: 4, rar: 'R',   enh:  3, skillLv:  2 },
    { at: 1640, n: 4, rar: 'SR',  enh:  3, skillLv:  2 },
    { at: 1720, n: 4, rar: 'SR',  enh:  4, skillLv:  3 },
    { at: 1800, n: 4, rar: 'SR',  enh:  5, skillLv:  4 },
    { at: 1900, n: 4, rar: 'SR',  enh:  6, skillLv:  5 },
    { at: 2000, n: 4, rar: 'SSR', enh:  6, skillLv:  5 },
    { at: 2120, n: 4, rar: 'SSR', enh:  7, skillLv:  6 },
    { at: 2250, n: 4, rar: 'SSR', enh:  8, skillLv:  7 },
    { at: 2400, n: 4, rar: 'SSR', enh:  9, skillLv:  8 },
    { at: 2550, n: 4, rar: 'SSR', enh: 10, skillLv:  9 },
    { at: 2700, n: 4, rar: 'SSR', enh: 10, skillLv: 10 },
  ],
  /* 레이팅이 움직이는 폭. 사람 상대가 더 크다 — 그쪽이 진짜 겨루기다.
     몬스터전과 비상 출격은 움직이지 않는다(구제 장치가 벌이 되면 안 된다). */
  RATING_K: { pvp: 24, pve: 20 },

  /* 생성 상대는 최대 레벨을 넘길 수 있다.
     레벨 상한에서는 등급도 파츠도 레벨로 갚아 줄 자리가 없어진다 — Lv.60 에서 전부
     60 으로 잘리는 바람에 에픽·풀강 플레이어가 생성 상대를 승률 97% 로 두들기고 있었다.
     상대 기체는 플레이어의 소유물이 아니므로 이 상한에 묶일 이유가 없다. */
  OPP_LV_OVER: 30,
  /* 한 번에 데려갈 수 있는 기체 수.
     레벨이 파일럿 것이 되면서 보유한 기체가 전부 싸울 수 있게 됐다. 그대로 두면
     기체를 많이 가질수록 '모든 답을 다 가진' 상태가 되어 상대를 보는 의미가 없어진다.
     둘로 묶어 두면 '어떤 둘을 데려갈까'가 판단이 되고, 상대를 본 뒤에는 그 둘 중에서 고른다. */
  SQUAD_MAX: 2,
  /* 파츠로 움직인 공격력 구간이 갈 수 있는 범위. 0 이면 난수가 사라지고,
     너무 넓으면 한 방에 끝나 전투가 동전 던지기가 된다. */
  SPREAD_MIN: 0.06, SPREAD_MAX: 0.55,
  MAXLV: 60,          // 최대 레벨
  PULL_COST: 1,
  ENH_SCALE: 0.44, // 새 파츠 일반 스탯 강화 계수; 구형 저장 장비에는 소급하지 않는다
  ENH_PCT: 0.094, // 새 파츠 회피·치명 강화 계수
  /* 공격력 전역 배율 — 한 판의 길이를 정하는 손잡이다. 낮출수록 길어진다.
     0.33 일 때 한 판이 약 147타(재생만 45초)였다. 그렇게 길면 큰 수의 법칙 때문에
     치명타·회피·공격력 구간이 전부 평균으로 뭉개져, 스탯이 5% 앞서면 승률이 96% 가 됐다.
     1.65(약 22타)로 줄여 한 방 한 방이 결과를 바꾸게 했다. 재생도 7초쯤으로 짧아진다. */
  ATK_SCALE: 1.65,
  CRIT_MULT: 1.6,     // 치명타 배수
  DEF_PEN: 0.6,       // 'ignoreDef' 스킬이 실제로 깎는 방어력 비율 (완전 무시가 아니다)
  FAT_MAX: 45,        // 최대 피로도 = 최대 체력이 45% 까지만 줄어든다

  /* 피로도 자연 회복 — 피로도 1이 빠지는 데 걸리는 시간(분).
     레벨이 높을수록 느리게 잡았다. 크레딧 정비를 '빠른 길'로 남겨 두고,
     주력을 쉬게 하는 동안 저레벨 기체를 굴릴 이유를 만들기 위해서다.
       Lv.1  → 1.05분/1  → 45(만땅)이 약 47분에 회복
       Lv.60 → 4.0분/1   → 약 3시간 */
  FAT_RECOVER_MIN: 1.0,   // 기본 분/피로도 1
  FAT_RECOVER_LV: 0.05,   // 레벨당 추가되는 분
  MONSTER_RATE: 0.4,  // 대전 상대가 몬스터일 확률 — 서버도 이 값을 쓴다

  /* 중복 기체 분해 보상 */
  DUPE_GAIN: { C:{cr:200,sc:30,co:0},  UC:{cr:320,sc:45,co:0}, R:{cr:520,sc:70,co:1},
                    UQ:{cr:900,sc:120,co:2}, EP:{cr:1600,sc:200,co:4} },

  /* 정비 단가: 피로도 1당 크레딧 — 등급이 높을수록 비싸다 */
  SERVICE_RATE: { C:3, UC:5, R:8, UQ:11, EP:15 },

  /* 자동 분해 — 여기 적힌 '파츠 등급'은 인벤토리에 넣지 않고 바로 스크랩으로 바꾼다.
     **대전·토벌 드랍에만 적용된다.** 뽑기는 더 이상 여기를 보지 않는다 —
     뽑아 놓고 못 써 보는 것이 아깝다는 지적을 받아, 뽑기 결과는 인벤토리에 넣고
     분해할지를 플레이어가 고른다(아래 SCRAP_VALUE).
     전투 드랍까지 남기면 파츠 행이 계속 쌓여 D1 쓰기 예산이 그쪽으로 샌다.
     (기체 등급 C/UC/… 가 아니라 파츠 등급 C/R/SR/SSR 이다) */
  AUTO_SCRAP: { C: 14 },

  /* 손으로 분해했을 때 받는 스크랩. 등급이 높을수록 많지만, 강화 비용에 견주면
     '쓰지 않을 것을 치우는' 값이지 '분해가 이득'인 값은 아니다. */
  SCRAP_VALUE: { C: 14, R: 30, SR: 70, SSR: 150 },

  /* 강화한 파츠를 분해할 때 **들인 스크랩 중 얼마를 돌려주는가.**
     잘못 강화한 파츠를 버리는 값이 너무 적으면 실수 한 번이 손실로 굳으므로 일부를 돌려준다.
     **반드시 1 미만이어야 한다.** 1 이상이면 강화 → 분해가 스크랩을 찍어내는 기계가 된다.
     예전에는 이 자리가 '등급값 × (1 + 강화 × 0.25)' 였는데, 강화 비용은 등급과 무관한데
     환급만 등급에 비례해서 SSR 이 실제로 돈을 찍고 있었다. `tools/econ.mjs` 가 지킨다. */
  ENH_REFUND: 0.5,

  /* 크레딧 뽑기 1회 값. 대전 1승(Lv.30 기준 약 560)의 두 판 조금 넘는다.
     새 계정의 시작 크레딧이 600 이라 '언젠가 한 번은 돌릴 수 있다'가 보인다. */
  PULL_CR_COST: 1200,

  /* ── 전술 지시 ──────────────────────────────────────────
     상대를 본 뒤 하나를 고른다. 이 게임에서 플레이어가 전투에 개입하는 **유일한 순간**이다.

     전투 규칙은 건드리지 않는다 — 턴 순서·피해 공식·스킬 판정은 그대로고, 전술은
     그 위에 곱해지는 얇은 한 겹이다. 그래서 값을 아래 none 처럼 두면(sp 1 · taken 1 ·
     eva 0 · atk 1) 전술을 골라도 아무 일이 없어진다.
     **라이브에서 문제가 생기면 코드를 되돌리지 말고 값으로 끌 것.**

     sp     턴마다 차는 SP 배수. SP 는 턴당 +30 이라 지금은 4턴에 한 번 스킬이 나온다.
            1.5 면 3턴, 0.67 이면 5턴이 된다 — 전술은 결국 '스킬을 몇 번 쓰나'다
     taken  받는 피해 배수. 방어력이 아니라 **최종 피해**에 건다. 그래야 관통 스킬에도 듣는다
     eva    회피에 더하는 값(%p). 기존 상한 60% 는 그대로다
     atk    공격력 배수

     ※ 값 조정은 ChatGPT 담당. 성공 조건은 하나뿐이다 —
       **어느 하나가 늘 낫지 않을 것.** 상대의 스킬 틀에 따라 최선이 바뀌어야 한다.
       확인은 node tools/tactic.mjs */
  TACTIC: {
    none:   { ko:'균형', sp:1.00, taken:1.00, eva:0,    atk:1.00, desc:'전술 없이 그대로 싸웁니다' },
    rush:   { ko:'돌격', sp:1.50, taken:1.10, eva:0,    atk:1.00, desc:'스킬이 더 자주 · 받는 피해 증가' },
    harass: { ko:'견제', sp:1.00, taken:1.00, eva:0.08, atk:0.92, desc:'회피 증가 · 공격력 감소' },
    guard:  { ko:'방어', sp:1.00, taken:1.00, eva:0,    atk:0.82, takenSkill:0.64, desc:'적 스킬 피해 감소 · 공격력 감소' },
  },
  /* 값을 이렇게 잡은 근거 — 두 번 틀리고 재서 맞췄다. 고칠 때 같은 데를 밟지 말 것.

     ① 거울 대결에서 **공격 1% 와 방어 1% 는 값이 거의 같다**(둘 다 승률 약 2.1%p).
        node tools/trade.mjs 로 다시 잴 수 있다
     ② SP 손잡이는 생각보다 두 배 세다. 스킬 한 방을 평타 1.8대로 어림했는데
        다단히트·관통까지 넣으면 실제로는 **평타 2.7대**다. 그래서 주기가 4턴→3턴이면
        화력이 +10%(6% 가 아니라), 4턴→5턴이면 −6% 다

     이 둘을 모르고 잡았더니 처음에는 방어가 모든 상황에서 1등(균형 대비 +24%p),
     고치자 이번에는 돌격이 1등(+8%p)이었다. +0만 맞춘 뒤에도 문제가 있었다.
     스킬 +10끼리 붙이면 방어가 모든 상대 틀에서 다시 1등이 됐다.

     그래서 방어를 atk 0.82 · takenSkill 0.64로 다시 맞췄다. +0 구간에서는 상대 틀에 따라
     최선이 셋으로 갈리고, +10 구간에서는 돌격과 방어가 맞선다.
     총량이 비면 남는 것은 상성뿐이다 — 그것이 이 기능의 전부다. */

  /* ── 보스 레이드 ────────────────────────────────────────
     서버 전체가 하나의 체력 막대를 같이 깎는다. 보스는 MONSTER_TYPES 의
     rarity:'BOSS' 셋을 주마다 돌려 쓴다 — 보스를 더하면 자동으로 끼어든다.

     bossX  **레이드의 보스는 같은 보스가 아니다.** 전투 체력에 이 배수를 건다.
            없을 때는 만렙 보스를 그대로 썼는데, 그건 파견 '보스' 단계에서 만나는
            보스(플레이어 +30레벨)보다 오히려 약했다 — 체력이 1/1.45 였다.
            그래서 SR 편성이 한 판에 전멸시켰고 레이드가 '반복 토벌' 이 됐다.
            ×12 에서는 최상급 편성(SSR +10)도 격파 확률이 9% 다.
            **체력만 키운다** — 레벨을 올리면 공격력도 같이 올라 약한 편성이
            아무것도 못 깎게 된다
     hpX    막대 크기 = 보스 전투 체력 × 이 값. 한 주 안에 끝나야 뜻이 있으므로
            사람이 늘면 올리고 줄면 내린다.
            bossX 를 올리면 여기를 같은 비율로 내려야 막대 크기가 유지된다
     daily  하루 도전 횟수. 이것이 유일한 제동 장치다 — 없으면 한 사람이
            하루 만에 막대를 다 깎는다
     보상   깎은 비율에 비례한다. 하루 횟수가 정해져 있으므로 이 값이 경제의
            새 수도꼭지가 된다. 전부 0 으로 두면 보상 없는 콘텐츠가 된다.
            만렙 기준 한 번 격파 = 크레딧 약 (crBase + crLv×60). */
  /* ── 합동전 (2026-09-21 · 사용자 결정) ──────────────────
     토벌 보스와 레이드는 편성 **두 기가 한꺼번에** 싸운다(js/joint.js).
     backAtk  후위 공격력 배수. 보스 평타를 안 맞는 대신이다 — 화력형의 자리
     aoe      광역 스킬이 한 기에 주는 배수. 둘 다 맞으므로 합은 1 을 넘는다
     boss     합동전 보스 배수. 두 기가 동시에 치므로 1:1 보스 그대로면 너무 약하다.
              값은 tools/jointcheck.mjs 로 잰다 */
  JOINT: {
    backAtk: 1.15,
    aoe: 0.6,
    boss: { hp: 0.5, atk: 0.5 },
    /* 공명(2026-09-23 사용자 결정) — 같은 집안(ROBOT_TYPES[].family) 아종 두 기를 전위 · 후위로 함께 내면
       둘 다 공격력이 이만큼 오른다. 아종을 모을 이유를 전투에도 둔다. 합동전 토벌 · 레이드에 똑같이 걸린다 */
    resonance: 0.05,
  },

  /* ── 흘려내기 (2026-09-21 · 사용자 결정) ──────────────────
     평타가 동시에 오갈 때(짧은 한 턴의 win 비율 안) 맞는 쪽이 확률로 흘려낸다. 판정은 js/sim.js tryParry.
     p      기본 확률 — 속도 비의 제곱근을 곱하고 pMin ~ pMax 로 자른다(빠를수록 잘 흘린다)
     delay  흘려내기를 당한 쪽 게이지가 밀리는 양(한 턴이 100)
     목표는 **평타의 5~10%** 가 흘려지는 것 — 더 잦으면 운 게임이 된다. 값은 tools/parrycheck.mjs 로 잰다
     spdK   속도 보정의 지수. 0.5(제곱근)로 두었더니 느린 중장갑이 크게 손해를 봤다(GLACIER −13%p) — 0.25 로 눌렀다
     실측(Lv.30 · 등급 안): 평타의 6.0% · 거울 대결 편향 없음 · 가장 많이 움직인 기체 GLACIER −7%p · ATLAS +6%p
     (스킬 한 방에 기대는 기체가 이득, 평타에 기대는 기체가 손해 — 흘려낼 수 없는 것이 스킬뿐이라서다) */
  PARRY: { win: 0.14, p: 0.2, pMin: 0.12, pMax: 0.28, delay: 20, spdK: 0.25 },

  /* ── 특화기술 기준값 (2026-09-21) ─────────────────────────
     기체 스킬 fx 의 shield · repair · mark · shred · jam · execute 가 쓰는 공통값. 판정은 js/sim.js.
     execHp      마무리가 켜지는 상대 체력 비율
     shredFloor  장갑 파쇄로 내려갈 수 있는 바닥 — 원래 방어력의 이 비율(0.4 로 두었더니 긴 판에서 파쇄 기체가 83~86%)
     decay       방벽 · 수리가 쓸 때마다 약해지는 비율. 버티는 기체끼리 끝없이 버티던 것(0% 짝)을 막는다 */
  SPECIAL: { execHp: 0.35, shredFloor: 0.7, decay: 0.3 },

  /* ── 요구 조건 특성 (2026-09-21) ────────────────────────
     보스에 붙어 **이기는 조합**을 바꾼다. 몬스터 표의 joint.traits 로 건다.
     answer 는 화면이 딱지 옆에 붙이는 '통하는 답' 이다. 판정은 js/joint.js.
     스탯으로 끝나는 것(def · eva)은 전투 전에 반영하고, 나머지는 판정 중에 건다.
     **특성은 난수를 더 뽑지 않는다** — 치명 무효도 치명은 굴린 뒤 배수만 지운다. */
  TRAIT: {
    armor:      { ko:'중장갑',    def: 1.8,  answer:'관통',        desc:'방어력이 매우 높습니다' },
    field:      { ko:'역장',      flat: 0.4, answer:'한 방이 큰 공격', desc:'타격마다 일정량을 깎습니다 — 연타가 약해집니다' },
    phase:      { ko:'위상 회피', eva: 0.3,  answer:'필중',        desc:'회피율이 매우 높습니다' },
    critnull:   { ko:'치명 무효',            answer:'치명 아닌 화력', desc:'치명타 추가 피해를 받지 않습니다' },
    regen:      { ko:'재생',      pct: 0.025, answer:'순간 화력',   desc:'턴마다 최대 내구를 회복합니다' },
    antiheal:   { ko:'흡수 차단',            answer:'흡혈 없는 기체', desc:'공격으로 회복할 수 없습니다' },
    overcharge: { ko:'과충전',    sp: 1.6,   answer:'방어 전술',   desc:'스킬이 자주 옵니다' },
    enrage:     { ko:'광폭화',    turn: 10, atk: 1.6, answer:'빠른 격파', desc:'10턴 뒤 공격력이 크게 오릅니다' },
  },

  RAID: {
    bossX: 12,
    hpX: 130,                 // 2026-09-21 합동전으로 한 판 피해가 약 2.6배 — 막대를 같은 비율로 키웠다(50 → 130)
    daily: 3,
    crBase: 40, crLv: 6,      // Lv.60 전부 깎으면 크레딧 400
    scBase: 6,  scLv: 1.2,    // 같은 조건에서 스크랩 78
  },

  /* ── 파츠 합성 ──────────────────────────────────────────
     같은 슬롯·같은 등급 파츠 셋을 하나로 합친다.

     **결과 베이스를 재료가 정한다** — 셋이 모두 같은 베이스면 그 베이스가 확정으로
     나오고, 섞여 있으면 셋 중 하나가 무작위로 나온다. 이것이 이 기능의 요지다.
     세트는 슬롯마다 정해진 베이스 하나씩을 맞춰야 하는데(강습이면 빔 세이버·경량
     골격·고기동 백·오버드라이브), 그냥 주워서 맞추려면 슬롯당 1/5~1/6 이라 아주 멀다.
     '같은 것 셋을 모으면 원하는 것이 확정' 이 그 길을 열어 준다.

     등급 상승은 도박이고, 인챈트는 새로 굴린다. SSR 은 더 오를 곳이 없지만
     **베이스를 바꾸고 인챈트를 다시 굴리는** 자리로 여전히 뜻이 있다.

     up 을 0 으로 두면 등급 상승이 꺼지고 합성은 '베이스 바꾸기' 만 남는다.
     cost 를 0 으로 두면 스크랩을 안 받는다. 코드를 되돌리지 않고 수치로 끌 수 있다. */
  FUSE: {
    need: 3,
    up:   { C:0.30, R:0.22, SR:0.15, SSR:0 },     // 등급이 한 칸 오를 확률
    cost: { C:60,   R:140,  SR:330,  SSR:700 },   // 스크랩
  },

  /* ── 파츠 세트 ──────────────────────────────────────────
     슬롯 4개가 서로 독립이라 '수치 높은 것 끼우기' 가 전부였다. 답이 정해진 선택은
     선택이 아니다. 세트를 넣으면 **"이 파츠는 수치가 낮지만 세트를 채운다"** 는
     계산이 생긴다. 파츠에는 이미 대가(SLOT_COST)가 있으므로
     '세트를 맞추려면 나쁜 옵션도 감수한다' 가 자연스럽게 따라온다.

     **계열은 파츠 이름에서 나온다.** part.name 은 이미 DB 에 있고 PART_NAMES 안의
     것으로 제한되므로(server/state.js 흰 목록), 이 표만 두면 **이미 가진 파츠가
     그대로 계열을 얻는다.** 컬럼도 마이그레이션도 데이터 이전도 없다.

     슬롯마다 계열이 정확히 하나씩이라 4세트는 네 칸을 다 맞춰야 한다.
     이름은 균등하게 뽑히므로 슬롯당 1/5~1/6 — 4세트는 **오래 걸리는 목표**이고
     그것이 만렙 뒤에 남는 일이다(BALANCE.md §3 ①).

     mul 은 곱, add 는 더하기다. 4세트를 채우면 2세트도 함께 걸린다.
     ※ 값 조정은 ChatGPT 담당. 확인은 node tools/set.mjs
       **세트가 수치를 이기면 안 된다** — 좋은 파츠를 버리고 세트를 맞추는 것이
       늘 정답이면, 선택이 아니라 새로운 정답이 하나 생겼을 뿐이다. */
  PART_SET: {
    assault: { ko:'강습', hint:'속도·치명',
      names: { WEAPON:'빔 세이버', FRAME:'경량 골격', BOOSTER:'고기동 백', CORE:'오버드라이브' },
      p2: { mul:{ spd:1.012 } }, p4: { add:{ crit:0.025 } } },
    fortress:{ ko:'요새', hint:'체력·방어',
      names: { WEAPON:'브레이커', FRAME:'합금 장갑', BOOSTER:'스러스터', CORE:'리액터' },
      p2: { mul:{ hp:1.015 } },  p4: { mul:{ def:1.05 } } },
    precision:{ko:'정밀', hint:'공격·안정',
      names: { WEAPON:'레일건', FRAME:'나노 코팅', BOOSTER:'AMBAC', CORE:'전술 코어' },
      p2: { mul:{ atk:1.012 } }, p4: { mul:{ atk:1.03, spread:0.92 } } },
  },
  /* 값이 작아 보이는 이유 — 처음에 spd 6% · hp 8% · def 12% 로 잡았더니
     요새 4세트가 무계열 상대 **77.6%** 였고, 커먼 4세트가 한 등급 위 무계열을
     61% 로 이겼다. 좋은 파츠를 주울 이유가 사라진다.
     거울 대결에서 **스탯 1% 는 승률 약 2.1%p** 다(node tools/trade.mjs).
     그래서 2세트는 스탯 1.2% 안팎(승률 +2~3%p), 4세트는 합쳐서 +8%p 를 넘지 않게 잡았다.
     등급 한 칸(커먼→정밀)이 약 +19%p 이므로, 세트로는 등급을 못 넘는다.

     ※ spread(공격 구간)는 거울 대결에서 값이 0 으로 나온다 — 서로 같으면 폭이 좁든
       넓든 반반이기 때문이다. 우세할 때만 값이 있는 축이라 정밀 4세트에 atk 을 함께 넣었다. */

  /* 생성 상대가 전술을 고르는 기울기. 자기 스킬이 살아나는 쪽을 자주 고른다 —
     회피 불가를 가진 상대는 상대 회피를 무시하므로 돌격이 어울리고,
     다단히트는 타격마다 회피를 굴리므로 견제와도 어울린다.
     **상대의 전술은 화면에 미리 보이지 않는다.** 대신 이렇게 기울여 두면
     플레이어가 상대의 스킬 딱지를 보고 짐작할 수 있다 — 그것이 이 기능의 재미다. */
  TACTIC_BIAS: {
    noMiss:    { rush:5, harass:1, guard:2 },
    multiHit:  { rush:3, harass:3, guard:2 },
    ignoreDef: { rush:4, harass:2, guard:2 },
    plain:     { rush:2, harass:3, guard:3 },
  },
};

/* ── 지형 ────────────────────────────────────────────────
   보정은 **양쪽 모두에** 걸린다. 한쪽에만 걸면 그냥 난이도 조절이 되어,
   칸이 달라도 하는 일이 같아진다. 양쪽에 걸어야 '이 칸엔 누구를 데려갈까'가 판단이 된다.
   협곡에서는 회피형이 무의미해지고, 폐허에서는 치명 편중이 크게 이기거나 크게 진다.

   워게임의 지형 보정(산 +3, 도시 +2 …)에서 가져왔다. 같은 부대도 서 있는 곳에 따라
   다르게 싸운다는 것 하나만 빌려 왔고, 이동·점유 같은 나머지는 가져오지 않았다. */
export const TERRAIN = {
  plain:    { ko: '평원',     desc: '보정 없음' },
  canyon:   { ko: '협곡',     desc: '회피 −45%',             eva: 0.55 },
  highland: { ko: '고지',     desc: '방어 +25% · 속도 −12%', def: 1.25, spd: 0.88 },
  ruins:    { ko: '폐허',     desc: '치명 +60%',             crit: 1.60 },
  storm:    { ko: '자기폭풍', desc: '공격 구간 +0.12',        spreadAdd: 0.12 },
  furnace:  { ko: '용광로',   desc: '공격 +25% · 내구 −15%',  atk: 1.25, hp: 0.85 },
};

/* ── 세계 지도 ───────────────────────────────────────────
   칸 12개. 서버에 딱 하나 있는 공용 지도다 — 사람이 늘면 같은 칸을 두고 다투게 된다.
   지금은 혼자라 빈 칸을 몬스터가 지킨다. 사람이 점령하면 그 사람의 방어 스냅샷이
   방어선 맨 뒤에 한 겹 더 붙는다(사람에게서 뺏는 쪽이 더 어렵다).

     col/row   3열 4행. row 4 가 입구, row 1 이 안쪽이다
     rar/lv    칸의 난이도. 내 레벨과 무관한 절대값이다 — 지도는 세계지 내 사정이 아니다
     mon       기본 방어선. 순서대로 뚫는다. 배열 길이가 곧 방어선 수다
     minLv     해금 레벨. 출격 편성의 가장 높은 레벨이 이 값을 넘어야 칠 수 있다.
               지도가 절대 난이도라, 새 플레이어가 첫날에 안쪽 칸을 눌러 보고 전멸하는 것을
               막는다. 눌러 볼 수는 있어야 하므로 칸의 레벨보다 조금 낮게 잡았다.
               (나중에 '특정 아이템이 있어야 열린다'를 여기에 item 필드로 더할 예정)
     maxRar    편성 제한. 이 등급을 넘는 기체는 못 데려간다
               (서머너즈워 점령전의 '4성 이하 거점'에서 가져왔다 — 주력 하나로 지도를
                다 먹지 못하게 막는 장치이자, 뽑은 기체를 키울 이유다)
     crH/scH/coreH
               점령해 두면 들어오는 시간당 수입. TERR.INCOME_CAP_H 시간까지만 쌓인다.
               **칸마다 나오는 재화가 다르다.** 크레딧만 나오는 칸, 스크랩이 두꺼운 칸,
                안쪽의 두 칸에서만 조금씩 나오는 코어. 한 칸만 붙들고 있으면 한 재화만
                모이므로, 무엇이 모자란지에 따라 어느 칸을 지킬지가 갈린다.
                코어는 뽑기 재화라 아주 인색하게 잡았다 — 12시간을 꽉 채워도 n11 이 3개다
               2026-09-08 30일 플레이 실측에서 기존 수입은 아레나 순익의 2.5배, 스크랩은
               수만 개가 남아 점령전이 사실상 필수였다. 크레딧은 기존의 약 25%, 스크랩은
               약 10%로 낮췄다. 점령지는 여전히 큰 보너스지만 주력 콘텐츠를 대신하지 않는다.
   ※ 값 조정은 ChatGPT 담당. */
export const TERRITORY = [
  /* ── row 4 · 입구 ── */
  { id:'n01', ko:'폐공장 지구', col:1, row:4, rar:'C',  lv: 8, terrain:'plain',
    mon:['enemy_razorwing','enemy_jackal'],                          crH: 14, scH:  1, coreH:0, minLv: 5, maxRar:null },
  { id:'n02', ko:'침수 부두',   col:2, row:4, rar:'C',  lv: 9, terrain:'storm',
    mon:['enemy_jackal','enemy_razorwing'],                          crH:  5, scH:  1, coreH:0, minLv: 5, maxRar:null },
  { id:'n03', ko:'관측소 능선', col:3, row:4, rar:'UC', lv:14, terrain:'highland',
    mon:['enemy_strix','enemy_angler'],                              crH: 18, scH:  1, coreH:0, minLv:10, maxRar:'UC' },

  /* ── row 3 ── */
  { id:'n04', ko:'붉은 협곡',   col:1, row:3, rar:'R',  lv:20, terrain:'canyon',
    mon:['enemy_reaper','enemy_scorpio','enemy_reaper'],             crH: 15, scH:  4, coreH:0, minLv:16, maxRar:null },
  { id:'n05', ko:'구시가 폐허', col:2, row:3, rar:'R',  lv:22, terrain:'ruins',
    mon:['enemy_scorpio','enemy_reaper','enemy_scorpio'],            crH: 44, scH:  1, coreH:0, minLv:16, maxRar:'R' },
  { id:'n06', ko:'송전 철탑',   col:3, row:3, rar:'UC', lv:15, terrain:'plain',
    mon:['enemy_angler','enemy_strix'],                              crH: 24, scH:  1, coreH:0, minLv:10, maxRar:null },

  /* ── row 2 ── */
  { id:'n07', ko:'지하 격납고', col:1, row:2, rar:'UQ', lv:28, terrain:'plain',
    mon:['enemy_lich','enemy_megalodon','enemy_lich'],               crH: 28, scH:  7, coreH:0,    minLv:24, maxRar:null },
  { id:'n08', ko:'용광로 심부', col:2, row:2, rar:'UQ', lv:30, terrain:'furnace',
    mon:['enemy_megalodon','enemy_lich','enemy_megalodon'],          crH: 73, scH:  2, coreH:0,    minLv:24, maxRar:'UQ' },
  { id:'n09', ko:'검은 호수',   col:3, row:2, rar:'UQ', lv:29, terrain:'canyon',
    mon:['enemy_lich','enemy_megalodon','enemy_lich'],               crH: 38, scH:  3, coreH:0,    minLv:24, maxRar:null },

  /* ── row 1 · 안쪽 ── */
  { id:'n10', ko:'강철 성문',   col:1, row:1, rar:'EP', lv:38, terrain:'highland',
    mon:['enemy_goliath','enemy_kabuto','enemy_goliath','enemy_kabuto'],
                                                                     crH:130, scH:  3, coreH:0,    minLv:34, maxRar:null },
  { id:'n11', ko:'왕좌의 방',   col:2, row:1, rar:'BOSS', lv:48, terrain:'ruins',
    mon:['enemy_kabuto','enemy_goliath','boss_astraea','boss_bael_fortress'],
                                                                     crH:155, scH:  9, coreH:0.25, minLv:45, maxRar:null },
  { id:'n12', ko:'관제 첨탑',   col:3, row:1, rar:'EP', lv:40, terrain:'storm',
    mon:['enemy_kabuto','enemy_goliath','enemy_kabuto','enemy_goliath'],
                                                                     crH: 55, scH: 12, coreH:0.12, minLv:34, maxRar:'UQ' },
];
