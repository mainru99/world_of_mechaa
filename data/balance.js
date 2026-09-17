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
    base:{hp:857,atk:159,def:92,spd:58,crit:.16,eva:.11}, grow:{hp:53.1,atk:11.5,def:6.3,spd:3.61}, spread:.18,
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
    base:{hp:1277,atk:105,def:136,spd:50,crit:.13,eva:.08}, grow:{hp:59.7,atk:7.6,def:7,spd:3.1}, spread:.12,
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
    base:{hp:880,atk:142,def:101,spd:65,crit:.2,eva:.1}, grow:{hp:60.7,atk:10.3,def:7.7,spd:4.04}, spread:.08,
    skill:{name:"골든 임팩트", desc:"1.8배 확정 치명타 강타. 빗나가지 않음.", fx:{mult:1.8,alwaysCrit:true,noMiss:true}} },
  ignis:{ id:'ignis', name:"IGNIS", rarity:'EP', role:"초고속 치명포형 · 피닉스",
    base:{hp:729,atk:111,def:83,spd:89,crit:.25,eva:.13}, grow:{hp:46.9,atk:8,def:5.9,spd:5.5}, spread:.24,
    skill:{name:"이그니스 레인", desc:"방어력 40%를 관통하는 0.5배 확정 치명타 사격을 5회.", fx:{mult:.5,hits:5,ignoreDef:.4,alwaysCrit:true}} },
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

  /* ---- 미래 보스 콘텐츠 ----
     전용 위험도 BOSS는 ROBOT_RARITY(C~EP)에 없으므로 현재 일반 매칭 풀에서 선택되지 않는다.
     향후 보스 진입/보상 UI가 직접 id를 선택할 때만 등장시킨다.
     Lv.60 성능은 기존과 같지만 이후 성장률을 1.5배로 올렸다. 토벌에서는 +30레벨로
     등장하므로 중간 장비로는 벽이고, 최종 장비도 조합에 따라 공략 성공률이 갈린다. */
  boss_bael_fortress:{ id:'boss_bael_fortress', name:'철혈성채 바알', rarity:'BOSS', role:'초중장 섬멸형 · 마왕성채',
    base:{hp:473.5,atk:33.75,def:37.7,spd:32.05,crit:.22,eva:.06}, grow:{hp:112.5,atk:11.25,def:8.1,spd:3.15}, spread:.26,
    skill:{name:'종말의 일제사격', desc:'1.0배 포격을 3회. 방어력 60%를 관통하며 회피할 수 없다.',
           fx:{mult:1.0,hits:3,ignoreDef:true,noMiss:true}} },
  boss_astraea:{ id:'boss_astraea', name:'성극천사 아스트라이아', rarity:'BOSS', role:'초고기동 심판형 · 성역병기',
    base:{hp:535.95,atk:19.6,def:71.8,spd:19.45,crit:.30,eva:.20}, grow:{hp:68.85,atk:10.8,def:5.4,spd:4.35}, spread:.15,
    skill:{name:'세라픽 저지먼트', desc:'0.91배 심판광을 3회. 방어력 60%를 관통하고 회피 불가·확정 치명타, 피해의 10%를 흡수한다.',
           fx:{mult:.91,hits:3,ignoreDef:true,noMiss:true,alwaysCrit:true,drain:.1}} },
  boss_nihil:{ id:'boss_nihil', name:'공허군주 니힐', rarity:'BOSS', role:'공간침식 연격형 · 공허핵',
    base:{hp:590.65,atk:47.75,def:47.65,spd:16.5,crit:.38,eva:.32}, grow:{hp:55.95,atk:11.25,def:4.95,spd:4.5}, spread:.24,
    skill:{name:'이벤트 호라이즌', desc:'방어력 60%를 관통하는 0.98배 침식을 4회. 피해의 25%를 흡수한다.',
           fx:{mult:.98,hits:4,ignoreDef:true,drain:.25}} }
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
    UQ:   { costX: 3.0, lv:   0, crX: 0.70, scX: 3.6, partP: 0.22, coreP: 0.10 },
    EP:   { costX: 4.5, lv:   0, crX: 1.10, scX: 4.6, partP: 0.28, coreP: 0.18 },
    /* 보스는 최종 벽이다. 플레이어보다 30레벨 높게 등장하고 위의 보스 전용 성장 곡선을 쓴다.
       실측: EP Lv.60 + SR 4개 +3강은 0%, SSR 4개 +10강은 평균 23% 승리한다. */
    BOSS: { costX: 8.0, lv:  30, crX: 2.25, scX: 7.0, partP: 0.45, coreP: 0.35 },
  },
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
     예전 9단계 표는 R 4개 +3강에서 SR 4개 +3강으로 한 번에 뛰어 승률이 20.8%→3.0%로
     꺾였고, 고강화 SSR의 큰 대가 때문에 이후 난이도가 역행했다. 파츠 수와 강화를 나눠
     올리는 15단계로 바꿔 절벽을 잘게 쪼갰다. 최고 구간은 SSR을 0/3/6/10강 순으로 올린다.
      ※ 값 조정은 ChatGPT 담당. */
  /* ── 대전 몬스터 구간표 (2026-09-18 사용자 지시) ───────────
     사용자 지적: "내 기체가 강해질 때마다 상대도 같이 세져서 일정 구간에 역전이 난다."
     그리고 "티어나 계단별로 증가할 수 있도록 구간 안에서 스펙이 조절되게 하자."

     **구간 안에서 몬스터는 완전히 고정이다.** 예전에는 `내 레벨 + 보정` 이라
     내가 자라면 상대도 같이 자라 제자리걸음이었다(레이팅 2400 에서 승률 33% 골짜기).
     이제 레이팅이 구간을 정하고, 구간 안에서 내 성장은 **온전히 남는다.**

     ── 왜 레이팅으로 나누나 ──
     레벨로 나누면 전선·파견으로 레벨만 오른 사람이 강제로 어려운 구간에 던져진다
     ("파밍 안 하면 뒤로 간다"). 레이팅은 이겨야 오르므로 **지면 구간도 안 오른다** —
     파밍을 안 하는 사람은 그 구간에 머물며 계속 이긴다. 벌이 아니라 정체다.

     ── 몬스터도 파츠를 낀다 ──
     예전에는 못 껴서 그 몫을 전부 레벨로 갚았고, 끝판에서 상대 레벨이 90
     (MAXLV+OPP_LV_OVER)에 부딪혀 더 세울 자리가 없었다. 파츠로 갚으니 상대 레벨이
     4~55 로 내 근처에 머문다. 그리고 **플레이어가 그 파츠를 눈으로 본다** —
     "저런 것도 있구나" 가 다음 목표가 된다.

     ── 표를 읽는 법 ──
       at    이 구간이 시작되는 레이팅
       lv    몬스터 고정 레벨. 구간 안에서 **안 움직인다**
       rars  나오는 몬스터 등급
       gear  몬스터가 끼는 파츠 — 개수 n · 등급 rar · 강화 enh

     실측(tools/bandplan.mjs) — 진입 평균 44% · 졸업 평균 90% · 막히는 구간 0개.
     구간에 45% 로 들어가 80~100% 로 졸업한다. 뒷부분이 싱거운 것은 의도다 —
     뚫고 들어가 고생하다 압도하며 거두는 자리가 파밍의 리듬이다.
     ※ 값 조정은 ChatGPT 담당. `node tools/bandplan.mjs 12` 로 다시 잰다. */
  MON_BAND: [
    { at:    0, lv:  4, rars: ['C'],          gear: { n: 0, rar: 'C',   enh:  0 } },
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

  RATING_GEAR: [
    { at:    0, n: 0, rar: 'C',   enh:  0, skillLv:  0 },
    { at: 1060, n: 2, rar: 'C',   enh:  0, skillLv:  0 },
    { at: 1160, n: 2, rar: 'R',   enh:  0, skillLv:  0 },
    { at: 1280, n: 3, rar: 'R',   enh:  0, skillLv:  0 },
    { at: 1400, n: 4, rar: 'R',   enh:  0, skillLv:  0 },
    { at: 1500, n: 4, rar: 'R',   enh:  4, skillLv:  1 },
    { at: 1620, n: 2, rar: 'SR',  enh:  0, skillLv:  2 },
    { at: 1740, n: 2, rar: 'SR',  enh:  3, skillLv:  3 },
    { at: 1880, n: 3, rar: 'SR',  enh:  0, skillLv:  4 },
    { at: 2020, n: 4, rar: 'SR',  enh:  0, skillLv:  5 },
    { at: 2200, n: 4, rar: 'SR',  enh:  3, skillLv:  6 },
    { at: 2400, n: 4, rar: 'SSR', enh:  0, skillLv:  7 },
    { at: 2550, n: 4, rar: 'SSR', enh:  3, skillLv:  8 },
    { at: 2700, n: 4, rar: 'SSR', enh:  6, skillLv:  9 },
    { at: 2850, n: 4, rar: 'SSR', enh: 10, skillLv: 10 },
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
  RAID: {
    bossX: 12,
    hpX: 50,
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
