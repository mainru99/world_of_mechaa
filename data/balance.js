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

/* 기체 30종 · 등급마다 6종 */
/* 성장(grow)은 등급이 낮을수록 '기본값 대비' 크게 잡아, 레벨을 올릴수록 등급 격차가 좁혀지도록 했다.
   Lv.1 에선 인접 등급이 14~20% 차이나지만 Lv.45 에선 5~6% 로 줄어 하위 등급도 끝까지 쓸 만하다. */
export const ROBOT_TYPES = {
  /* ---- 커먼 ---- */
  mule:{ id:'mule', name:'MULE', rarity:'C', role:'근접 방어형 · 워커',
    base:{hp:520,atk:70,def:60,spd:40,crit:.05,eva:.04}, grow:{hp:60,atk:8,def:8,spd:3},
    skill:{name:'해머 다운', desc:'1.6배 강타. 빗나가지 않음.', fx:{mult:1.6,noMiss:true}} },
  dune:{ id:'dune', name:'DUNE', rarity:'C', role:'원거리 견제형 · 트루퍼',
    base:{hp:420,atk:78,def:44,spd:58,crit:.10,eva:.08}, grow:{hp:44,atk:11,def:5,spd:6},
    skill:{name:'더블 탭', desc:'0.9배 사격을 2회. 각각 치명타·회피 판정.', fx:{mult:0.9,hits:2}} },
  /* ---- 언커먼 ---- */
  ranger:{ id:'ranger', name:'RANGER', rarity:'UC', role:'저격형 · 마크스맨',
    base:{hp:450,atk:92,def:46,spd:66,crit:.14,eva:.10}, grow:{hp:42,atk:11,def:6,spd:7},
    skill:{name:'관통 사격', desc:'적 방어력을 60% 관통하는 1.75배 저격.', fx:{mult:1.75,ignoreDef:true}} },
  vanguard:{ id:'vanguard', name:'VANGUARD', rarity:'UC', role:'중장 포격형 · 헤비',
    base:{hp:610,atk:88,def:66,spd:36,crit:.07,eva:.03}, grow:{hp:58,atk:8,def:9,spd:3},
    skill:{name:'풀 버스트', desc:'2.0배 대폭격. 회피 불가.', fx:{mult:2.0,noMiss:true}} },
  /* ---- 레어 ---- */
  azure:{ id:'azure', name:'AZURE', rarity:'R', role:'고기동 강습형 · 스트라이커',
    base:{hp:500,atk:104,def:58,spd:80,crit:.18,eva:.14}, grow:{hp:42,atk:11,def:6,spd:8},
    skill:{name:'트라이 슬래시', desc:'1.0배 연격을 3회. 각각 치명타·회피 판정.', fx:{mult:1.0,hits:3}} },
  glacier:{ id:'glacier', name:'GLACIER', rarity:'R', role:'근접 방어형 · 가디언',
    base:{hp:700,atk:98,def:84,spd:46,crit:.08,eva:.06}, grow:{hp:58,atk:9,def:9,spd:3},
    skill:{name:'가드 브레이커', desc:'적 방어력을 60% 관통하는 1.9배 강타. 빗나가지 않음.',
           fx:{mult:1.9,ignoreDef:true,noMiss:true}} },
  /* ---- 유니크 ---- */
  wraith:{ id:'wraith', name:'WRAITH', rarity:'UQ', role:'흡수형 · 리퍼',
    base:{hp:780,atk:118,def:78,spd:52,crit:.12,eva:.08}, grow:{hp:56,atk:10,def:9,spd:4},
    skill:{name:'소울 드레인', desc:'2.4배 강타. 준 피해의 35%만큼 체력을 흡수한다.',
           fx:{mult:2.4,drain:.35}} },
  oracle:{ id:'oracle', name:'ORACLE', rarity:'UQ', role:'정밀 저격형 · 시어',
    base:{hp:600,atk:126,def:62,spd:88,crit:.24,eva:.18}, grow:{hp:42,atk:12,def:6,spd:7},
    skill:{name:'프리딕션', desc:'0.7배 사격 3회. 모두 확정 치명타(회피는 가능).',
           fx:{mult:0.7,hits:3,alwaysCrit:true}} },
  /* ---- 에픽 ---- */
  seraph:{ id:'seraph', name:'SERAPH', rarity:'EP', role:'성역 강습형 · 아크엔젤',
    base:{hp:880,atk:140,def:96,spd:74,crit:.16,eva:.14}, grow:{hp:54,atk:10,def:9,spd:5},
    skill:{name:'세이크리드 랜스', desc:'방어력 60% 관통 2.2배. 빗나가지 않고 25%를 흡수한다.',
           fx:{mult:2.2,ignoreDef:true,noMiss:true,drain:.25}} },
  nemesis:{ id:'nemesis', name:'NEMESIS', rarity:'EP', role:'파멸 포격형 · 오버로드',
    base:{hp:820,atk:152,def:88,spd:82,crit:.22,eva:.12}, grow:{hp:44,atk:12,def:8,spd:5},
    skill:{name:'카오스 버스트', desc:'적 방어력을 60% 관통하는 1.15배 폭격을 3회.',
           fx:{mult:1.15,hits:3,ignoreDef:true}} },
  /* ---- 세트 02: 같은 등급의 기존 기체를 기준으로 무작위 생성한 고정 스펙 ---- */
  rust:{ id:'rust', name:'RUST', rarity:'C', role:'근접 방어형 · 센트리',
    base:{hp:491,atk:71,def:58,spd:43,crit:0.06,eva:0.05}, grow:{hp:58,atk:9,def:7,spd:3},
    skill:{name:'아이언 너클', desc:'1.65배 강타. 빗나가지 않음.',
           fx:{mult:1.65,noMiss:true}} },
  scarab:{ id:'scarab', name:'SCARAB', rarity:'C', role:'기동 타격형 · 스카우트',
    base:{hp:445,atk:80,def:47,spd:56,crit:0.09,eva:0.07}, grow:{hp:49,atk:11,def:5,spd:5},
    skill:{name:'트윈 임팩트', desc:'0.85배 타격을 2회. 각각 치명타·회피 판정.',
           fx:{mult:0.85,hits:2}} },
  bastion:{ id:'bastion', name:'BASTION', rarity:'UC', role:'지원 포격형 · 미사일러',
    base:{hp:590,atk:86,def:59,spd:40,crit:0.08,eva:0.04}, grow:{hp:55,atk:8,def:9,spd:4},
    skill:{name:'미사일 레인', desc:'0.95배 미사일을 2회 발사. 회피 불가.',
           fx:{mult:0.95,hits:2,noMiss:true}} },
  kestrel:{ id:'kestrel', name:'KESTREL', rarity:'UC', role:'관통 사격형 · 헌터',
    base:{hp:461,atk:90,def:48,spd:63,crit:0.13,eva:0.09}, grow:{hp:46,atk:10,def:6,spd:7},
    skill:{name:'피어싱 캐논', desc:'적 방어력을 60% 관통하는 1.8배 포격.',
           fx:{mult:1.8,ignoreDef:true}} },
  tempest:{ id:'tempest', name:'TEMPEST', rarity:'R', role:'고기동 사격형 · 인터셉터',
    base:{hp:525,atk:106,def:57,spd:81,crit:0.16,eva:0.13}, grow:{hp:44,atk:11,def:6,spd:7},
    skill:{name:'스톰 샷', desc:'0.95배 사격을 3회. 각각 치명타·회피 판정.',
           fx:{mult:0.95,hits:3}} },
  cobalt:{ id:'cobalt', name:'COBALT', rarity:'R', role:'중장 관통형 · 브레이커',
    base:{hp:671,atk:104,def:78,spd:51,crit:0.09,eva:0.08}, grow:{hp:54,atk:9,def:9,spd:4},
    skill:{name:'코발트 브레이크', desc:'적 방어력을 60% 관통하는 1.85배 포격. 빗나가지 않음.',
           fx:{mult:1.85,ignoreDef:true,noMiss:true}} },
  specter:{ id:'specter', name:'SPECTER', rarity:'UQ', role:'원격 제압형 · 비트 마스터',
    base:{hp:601,atk:125,def:62,spd:86,crit:0.23,eva:0.17}, grow:{hp:40,atk:12,def:6,spd:7},
    skill:{name:'팬텀 비트', desc:'0.65배 비트 사격 3회. 모두 확정 치명타(회피는 가능).',
           fx:{mult:0.65,hits:3,alwaysCrit:true}} },
  umbra:{ id:'umbra', name:'UMBRA', rarity:'UQ', role:'에너지 흡수형 · 블레이더',
    base:{hp:709,atk:123,def:74,spd:60,crit:0.14,eva:0.1}, grow:{hp:53,atk:10,def:9,spd:4},
    skill:{name:'보이드 엣지', desc:'2.35배 참격. 준 피해의 35%만큼 체력을 흡수한다.',
           fx:{mult:2.35,drain:0.35}} },
  tyrant:{ id:'tyrant', name:'TYRANT', rarity:'EP', role:'전면 포격형 · 디스트로이어',
    base:{hp:844,atk:146,def:87,spd:78,crit:0.21,eva:0.12}, grow:{hp:44,atk:12,def:8,spd:5},
    skill:{name:'헬파이어 살보', desc:'적 방어력을 60% 관통하는 1.1배 포격을 3회.',
           fx:{mult:1.1,hits:3,ignoreDef:true}} },
  atlas:{ id:'atlas', name:'ATLAS', rarity:'EP', role:'중장 돌파형 · 타이탄',
    base:{hp:914,atk:146,def:92,spd:70,crit:0.15,eva:0.13}, grow:{hp:54,atk:10,def:9,spd:5},
    skill:{name:'타이탄 크러시', desc:'방어력 60% 관통 2.15배 강타. 빗나가지 않고 25%를 흡수한다.',
           fx:{mult:2.15,ignoreDef:true,noMiss:true,drain:0.25}} },
  /* ---- 세트 03: 3rd.png의 등급별 기체, 기존 등급 기준 무작위 고정 스펙 ---- */
  grit:{ id:'grit', name:'GRIT', rarity:'C', role:'전선 방어형 · 가드',
    base:{hp:496,atk:71,def:57,spd:43,crit:0.05,eva:0.04}, grow:{hp:57,atk:9,def:8,spd:3},
    skill:{name:'브레이스 펀치', desc:'1.55배 강타. 빗나가지 않음.',
           fx:{mult:1.55,noMiss:true}} },
  chalk:{ id:'chalk', name:'CHALK', rarity:'C', role:'기동 타격형 · 러너',
    base:{hp:434,atk:74,def:44,spd:54,crit:0.09,eva:0.08}, grow:{hp:45,atk:11,def:5,spd:6},
    skill:{name:'화이트 러시', desc:'0.9배 타격을 2회. 각각 치명타·회피 판정.',
           fx:{mult:0.9,hits:2}} },
  tracer:{ id:'tracer', name:'TRACER', rarity:'UC', role:'표적 추적형 · 트래커',
    base:{hp:481,atk:93,def:46,spd:64,crit:0.13,eva:0.09}, grow:{hp:43,atk:10,def:7,spd:7},
    skill:{name:'트레이스 샷', desc:'적 방어력을 60% 관통하는 1.7배 사격.',
           fx:{mult:1.7,ignoreDef:true}} },
  mantis:{ id:'mantis', name:'MANTIS', rarity:'UC', role:'중장 압박형 · 인포서',
    base:{hp:590,atk:89,def:63,spd:43,crit:0.08,eva:0.04}, grow:{hp:52,atk:8,def:9,spd:4},
    skill:{name:'프레셔 버스트', desc:'2.0배 집중 포격. 회피 불가.',
           fx:{mult:2,noMiss:true}} },
  howitzer:{ id:'howitzer', name:'HOWITZER', rarity:'R', role:'중장 포격형 · 시즈',
    base:{hp:689,atk:98,def:76,spd:53,crit:0.09,eva:0.08}, grow:{hp:57,atk:9,def:9,spd:4},
    skill:{name:'시즈 캐논', desc:'적 방어력을 60% 관통하는 1.85배 포격. 빗나가지 않음.',
           fx:{mult:1.85,ignoreDef:true,noMiss:true}} },
  lancer:{ id:'lancer', name:'LANCER', rarity:'R', role:'고기동 돌파형 · 랜서',
    base:{hp:505,atk:106,def:62,spd:75,crit:0.16,eva:0.13}, grow:{hp:43,atk:11,def:7,spd:7},
    skill:{name:'트리플 피어스', desc:'0.95배 찌르기를 3회. 각각 치명타·회피 판정.',
           fx:{mult:0.95,hits:3}} },
  hex:{ id:'hex', name:'HEX', rarity:'UQ', role:'전격 흡수형 · 워록',
    base:{hp:775,atk:120,def:79,spd:53,crit:0.13,eva:0.09}, grow:{hp:54,atk:10,def:9,spd:4},
    skill:{name:'헥스 디스차지', desc:'2.3배 전격. 준 피해의 35%만큼 체력을 흡수한다.',
           fx:{mult:2.3,drain:0.35}} },
  halo:{ id:'halo', name:'HALO', rarity:'UQ', role:'정밀 제압형 · 컨덕터',
    base:{hp:621,atk:126,def:61,spd:81,crit:0.21,eva:0.16}, grow:{hp:47,atk:11,def:7,spd:7},
    skill:{name:'오비탈 포커스', desc:'0.7배 사격 3회. 모두 확정 치명타(회피는 가능).',
           fx:{mult:0.7,hits:3,alwaysCrit:true}} },
  auric:{ id:'auric', name:'AURIC', rarity:'EP', role:'중장 강습형 · 골드 가디언',
    base:{hp:894,atk:139,def:98,spd:77,crit:0.15,eva:0.15}, grow:{hp:51,atk:10,def:9,spd:5},
    skill:{name:'골든 임팩트', desc:'방어력 60% 관통 2.15배 강타. 빗나가지 않고 25%를 흡수한다.',
           fx:{mult:2.15,ignoreDef:true,noMiss:true,drain:0.25}} },
  ignis:{ id:'ignis', name:'IGNIS', rarity:'EP', role:'광익 포격형 · 피닉스',
    base:{hp:798,atk:151,def:86,spd:78,crit:0.21,eva:0.12}, grow:{hp:45,atk:12,def:8,spd:5},
    skill:{name:'이그니스 레인', desc:'적 방어력을 60% 관통하는 1.1배 광익 사격을 3회.',
           fx:{mult:1.1,hits:3,ignoreDef:true}} },
};

/* 대전 전용 몬스터. ROBOT_TYPES 와 표를 나눠 두어 뽑기·격납고·소유 목록에
   새어 들어갈 경로 자체를 없앤다. 두 표의 id 는 겹치면 안 된다(에셋 경로가 갈린다). */
export const MONSTER_TYPES = {
  enemy_razorwing:{ id:'enemy_razorwing', name:'레이저윙', rarity:'C', role:'고속 연격형 · 기계 맹금',
    base:{"hp":418,"atk":81,"def":44,"spd":60,"crit":0.1,"eva":0.08}, grow:{"hp":44,"atk":11,"def":5,"spd":6},
    skill:{"name":"레이저 탈론","desc":"0.9배 발톱 공격을 2회. 각각 치명타·회피 판정.","fx":{"mult":0.9,"hits":2}} },
  enemy_angler:{ id:'enemy_angler', name:'어비스 앵글러', rarity:'UC', role:'중장 압박형 · 심해 포식자',
    base:{"hp":601,"atk":85,"def":67,"spd":35,"crit":0.07,"eva":0.03}, grow:{"hp":57,"atk":8,"def":9,"spd":3},
    skill:{"name":"어비스 바이트","desc":"2.0배 강철 턱 공격. 빗나가지 않음.","fx":{"mult":2,"noMiss":true}} },
  enemy_jackal:{ id:'enemy_jackal', name:'더스트 자칼', rarity:'C', role:'근접 추적형 · 사막 사냥꾼',
    base:{"hp":505,"atk":72,"def":58,"spd":39,"crit":0.05,"eva":0.04}, grow:{"hp":61,"atk":8,"def":8,"spd":3},
    skill:{"name":"데저트 팽","desc":"1.65배 송곳니 공격. 빗나가지 않음.","fx":{"mult":1.65,"noMiss":true}} },
  enemy_reaper:{ id:'enemy_reaper', name:'베놈 리퍼', rarity:'R', role:'고기동 참격형 · 사마귀',
    base:{"hp":501,"atk":104,"def":59,"spd":83,"crit":0.18,"eva":0.14}, grow:{"hp":41,"atk":11,"def":6,"spd":8},
    skill:{"name":"크로스 사이드","desc":"0.95배 낫 공격을 3회. 각각 치명타·회피 판정.","fx":{"mult":0.95,"hits":3}} },
  enemy_lich:{ id:'enemy_lich', name:'보이드 리치', rarity:'UQ', role:'에너지 흡수형 · 기계 술사',
    base:{"hp":806,"atk":120,"def":79,"spd":52,"crit":0.12,"eva":0.08}, grow:{"hp":55,"atk":10,"def":9,"spd":4},
    skill:{"name":"소울 하베스트","desc":"2.35배 에너지 공격. 준 피해의 35%를 흡수한다.","fx":{"mult":2.35,"drain":0.35}} },
  enemy_goliath:{ id:'enemy_goliath', name:'아이언 골리앗', rarity:'EP', role:'중장 파괴형 · 기계 거수',
    base:{"hp":904,"atk":139,"def":93,"spd":74,"crit":0.15,"eva":0.14}, grow:{"hp":53,"atk":10,"def":9,"spd":5},
    skill:{"name":"코어 크러셔","desc":"방어력 60% 관통 2.15배 강타. 빗나가지 않고 25%를 흡수한다.","fx":{"mult":2.15,"ignoreDef":true,"noMiss":true,"drain":0.25}} },
  enemy_scorpio:{ id:'enemy_scorpio', name:'볼트 스콜피오', rarity:'R', role:'장갑 관통형 · 기계 전갈',
    base:{"hp":706,"atk":96,"def":81,"spd":45,"crit":0.08,"eva":0.06}, grow:{"hp":57,"atk":9,"def":9,"spd":3},
    skill:{"name":"스팅어 드릴","desc":"방어력 60%를 관통하는 1.85배 꼬리 공격. 빗나가지 않음.","fx":{"mult":1.85,"ignoreDef":true,"noMiss":true}} },
  enemy_strix:{ id:'enemy_strix', name:'나이트 스트릭스', rarity:'UC', role:'정밀 저격형 · 야행성 감시자',
    base:{"hp":446,"atk":89,"def":47,"spd":67,"crit":0.14,"eva":0.1}, grow:{"hp":42,"atk":11,"def":6,"spd":7},
    skill:{"name":"나이트 피어서","desc":"방어력 60%를 관통하는 1.8배 저격.","fx":{"mult":1.8,"ignoreDef":true}} },
  enemy_megalodon:{ id:'enemy_megalodon', name:'블러드 메갈로돈', rarity:'UQ', role:'급습 연격형 · 강철 상어',
    base:{"hp":616,"atk":123,"def":60,"spd":86,"crit":0.25,"eva":0.18}, grow:{"hp":43,"atk":12,"def":6,"spd":7},
    skill:{"name":"프레데터 러시","desc":"0.7배 급습을 3회. 모두 확정 치명타(회피는 가능).","fx":{"mult":0.7,"hits":3,"alwaysCrit":true}} },
  enemy_kabuto:{ id:'enemy_kabuto', name:'오닉스 카부토', rarity:'EP', role:'장갑 돌파형 · 갑충 군주',
    base:{"hp":831,"atk":153,"def":89,"spd":79,"crit":0.21,"eva":0.12}, grow:{"hp":44,"atk":12,"def":8,"spd":5},
    skill:{"name":"모나크 브레이크","desc":"방어력 60%를 관통하는 1.1배 돌진 공격을 3회.","fx":{"mult":1.1,"hits":3,"ignoreDef":true}} }
};

/* 파츠 */
export const SLOTS = ['WEAPON','FRAME','BOOSTER','CORE'];
export const SLOT_STATS = { WEAPON:['atk','atk','crit','spd'], FRAME:['hp','def','def','hp'],
                     BOOSTER:['spd','eva','spd','crit'], CORE:['hp','atk','def','crit'] };
export const PART_NAMES = {
  WEAPON:['빔 세이버','발칸포','레일건','포톤 랜스','채프 런처','브레이커'],
  FRAME:['합금 장갑','리액티브 아머','실드 프레임','경량 골격','나노 코팅'],
  BOOSTER:['스러스터','플로트 팩','부스트 유닛','고기동 백','AMBAC'],
  CORE:['리액터','제너레이터','전술 코어','컨트롤 칩','오버드라이브'] };
export const RARITY = [
  {k:'C', ko:'일반', w:52, n:1, mul:1.0},
  {k:'R', ko:'정밀', w:30, n:2, mul:1.5},
  {k:'SR',ko:'시제', w:14, n:3, mul:2.2},
  {k:'SSR',ko:'초월',w:4,  n:3, mul:3.4} ];
export const STAT_ROLL = { hp:[24,60], atk:[6,16], def:[5,13], spd:[3,9], crit:[.02,.05], eva:[.02,.05] };

/* 흩어져 있던 조정 수치를 한곳에 모은다. 서버도 이 값을 읽으므로
   여기를 바꾸면 서버 재배포가 필요하다. */
export const CONST = {
  MAXLV: 60,          // 최대 레벨
  PULL_COST: 1,       // 뽑기 1회에 드는 코어
  ATK_SCALE: 0.33,    // 공격력 전역 배율 — 낮출수록 한 판이 길어진다
  CRIT_MULT: 1.6,     // 치명타 배수
  DEF_PEN: 0.6,       // 'ignoreDef' 스킬이 실제로 깎는 방어력 비율 (완전 무시가 아니다)
  FAT_MAX: 45,        // 최대 피로도 = 최대 체력이 45% 까지만 줄어든다
  MONSTER_RATE: 0.4,  // 대전 상대가 몬스터일 확률 — 서버도 이 값을 쓴다

  /* 중복 기체 분해 보상 */
  DUPE_GAIN: { C:{cr:200,sc:30,co:0},  UC:{cr:320,sc:45,co:0}, R:{cr:520,sc:70,co:1},
                    UQ:{cr:900,sc:120,co:2}, EP:{cr:1600,sc:200,co:4} },

  /* 정비 단가: 피로도 1당 크레딧 — 등급이 높을수록 비싸다 */
  SERVICE_RATE: { C:3, UC:5, R:8, UQ:11, EP:15 },
};
