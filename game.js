/* ==================================================================
 * ROWAR - 프로토타입 게임 로직 (표준 웹, 외부 라이브러리 없음)
 *   루프: 뽑기 -> 로봇 육성(레벨/파츠) -> 상대 매칭 -> 자동 대전 -> 파밍
 *   저장: localStorage
 *   대전: 시드 기반 결정적 시뮬레이션 -> 이벤트 재생(추후 네트워크 동기화 대비)
 * ================================================================== */
(function () {
"use strict";

/* ------------------------------- 데이터 ------------------------------- */
/* 로봇 등급 (뽑기 가중치 w 합계 = 100) */
const ROBOT_RARITY = [
  {k:'C',  ko:'커먼',   w:44},
  {k:'UC', ko:'언커먼', w:28},
  {k:'R',  ko:'레어',   w:17},
  {k:'UQ', ko:'유니크', w:8 },
  {k:'EP', ko:'에픽',   w:3 } ];
const RR = {}; ROBOT_RARITY.forEach(r=>RR[r.k]=r);
const RIDX = {C:0,UC:1,R:2,UQ:3,EP:4};
/* 뽑기 결과 확률(합 100). 파츠만 쏟아지지 않게 크레딧·코어·꽝을 섞었다 */
const PULL_TABLE = [ {k:'robot',w:12}, {k:'core',w:1.5}, {k:'credit',w:22}, {k:'part',w:45}, {k:'bust',w:19.5} ];
const PULL_KO = { robot:'로봇', core:'코어', credit:'크레딧', part:'파츠', bust:'꽝' };
const ROBOT_APPEAR = PULL_TABLE.find(t=>t.k==='robot').w/100;   // 화면 표기는 위 표에서 파생
const DUPE_GAIN = { C:{cr:200,sc:30,co:0},  UC:{cr:320,sc:45,co:0}, R:{cr:520,sc:70,co:1},
                    UQ:{cr:900,sc:120,co:2}, EP:{cr:1600,sc:200,co:4} };

/* 기체 30종 · 등급마다 6종 */
/* 성장(grow)은 등급이 낮을수록 '기본값 대비' 크게 잡아, 레벨을 올릴수록 등급 격차가 좁혀지도록 했다.
   Lv.1 에선 인접 등급이 14~20% 차이나지만 Lv.45 에선 5~6% 로 줄어 하위 등급도 끝까지 쓸 만하다. */
const ROBOT_TYPES = {
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
/* 대전 전용 몬스터: 소유/뽑기/시작 기체 목록에는 넣지 않는다. */
const MONSTER_TYPES = {
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
const MONSTER_ENCOUNTER_RATE = 0.4;
const MONSTER_BY_RARITY = {};
for(const monster of Object.values(MONSTER_TYPES)) (MONSTER_BY_RARITY[monster.rarity] ||= []).push(monster.id);
const COMBAT_TYPES = {...ROBOT_TYPES,...MONSTER_TYPES};
const TYPE_KEYS = Object.keys(ROBOT_TYPES);
const BY_RARITY = {}; for(const k in ROBOT_TYPES){ const r=ROBOT_TYPES[k].rarity; (BY_RARITY[r]=BY_RARITY[r]||[]).push(k); }

const SLOTS = ['WEAPON','FRAME','BOOSTER','CORE'];
const SLOT_KO = {WEAPON:'무장',FRAME:'프레임',BOOSTER:'부스터',CORE:'코어'};
const SLOT_STATS = { WEAPON:['atk','atk','crit','spd'], FRAME:['hp','def','def','hp'],
                     BOOSTER:['spd','eva','spd','crit'], CORE:['hp','atk','def','crit'] };
const PART_NAMES = {
  WEAPON:['빔 세이버','발칸포','레일건','포톤 랜스','채프 런처','브레이커'],
  FRAME:['합금 장갑','리액티브 아머','실드 프레임','경량 골격','나노 코팅'],
  BOOSTER:['스러스터','플로트 팩','부스트 유닛','고기동 백','AMBAC'],
  CORE:['리액터','제너레이터','전술 코어','컨트롤 칩','오버드라이브'] };
const RARITY = [
  {k:'C', ko:'일반', w:52, n:1, mul:1.0},
  {k:'R', ko:'정밀', w:30, n:2, mul:1.5},
  {k:'SR',ko:'시제', w:14, n:3, mul:2.2},
  {k:'SSR',ko:'초월',w:4,  n:3, mul:3.4} ];
const STAT_ROLL = { hp:[24,60], atk:[6,16], def:[5,13], spd:[3,9], crit:[.02,.05], eva:[.02,.05] };
const STAT_LABEL = { hp:'내구', atk:'공격', def:'방어', spd:'속도', crit:'치명', eva:'회피' };
const STAT_MAX   = { hp:1500, atk:68, def:280, spd:140, crit:.75, eva:.6 };  // atk 는 ATK_SCALE 적용 후 기준
const isPct = s => s==='crit'||s==='eva';
const MAXLV = 60;
const PULL_COST = 1;

/* 공격력 전역 배율 — 낮출수록 한 판이 길어진다. 0.2 = 예전의 1/5 */
const ATK_SCALE = 0.2;

/* 전투 배수 (한 방 폭발력 조절: 여기만 만지면 됨) */
const CRIT_MULT = 1.6;   // 치명타 배수. 예전 2.0 → 1.6
const DEF_PEN   = 0.6;   // '방어 무시' 스킬이 실제로 깎는 방어력 비율. 예전엔 100% 무시였다

/* 경험치 */
const expNeed   = lv => Math.round(60 + lv*lv*1.6 + lv*22);  // lv → lv+1 에 필요한 경험치
const battleExp = enemyLv => 26 + enemyLv*9;                 // 승리 시 획득(패배는 35%)

/* ------------------------------- 유틸 ------------------------------- */
const R = Math.random;
const ri = (a,b)=>Math.floor(R()*(b-a+1))+a;
const rf = (a,b)=>R()*(b-a)+a;
const pick = a => a[Math.floor(R()*a.length)];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const fmt = n => Math.round(n).toLocaleString();
let _uid = Math.floor(R()*1e6);
const uid = () => (_uid++).toString(36);
function weighted(list){ let t=list.reduce((s,x)=>s+x.w,0), r=R()*t; for(const x of list){ if((r-=x.w)<=0) return x; } return list[list.length-1]; }
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const $ = (s,r=document)=>r.querySelector(s);
const sprite = (type,flip)=> (window.SPRITES[type]||window.SPRITES.mule)(!!flip);
const rarOf = type => (COMBAT_TYPES[type]||ROBOT_TYPES.mule).rarity;
function robRarTag(type){ const r=RR[rarOf(type)]; return `<span class="tag rr-${r.k}">${r.ko}</span>`; }

/* 피로도 : 대전할수록 쌓이고, 쌓인 만큼 최대 체력이 줄어든다. 크레딧으로 정비해서 푼다 */
const FAT_MAX = 45;                                      // 최대 피로도 = 최대 체력이 45% 까지만 줄어든다
const SERVICE_RATE = { C:3, UC:5, R:8, UQ:11, EP:15 };   // 피로도 1당 크레딧 — 등급이 높을수록 단가가 비싸다
const fatOf = rb => clamp(rb.fat|0, 0, FAT_MAX);
const serviceCost = rb => Math.ceil(fatOf(rb) * SERVICE_RATE[rarOf(rb.type)] * (1+rb.level*0.03));

/* ------------------------------- 상태/저장 ------------------------------- */
const SAVE_KEY = 'rowar.save.v2';   // v1(로봇 3기 체제)은 로스터가 완전히 달라 호환되지 않는다
let S = null;
function emptySlots(){ return {WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}; }
function freshState(){         // 시작: 커먼 1기, Lv.1 — 나머지 기체는 뽑기로만 얻는다
  return { v:2, credits:600, cores:12, scrap:30,
    robots:[{uid:uid(),type:pick(BY_RARITY.C),level:1,exp:0,fat:0,slots:emptySlots()}],
    parts:[], sel:0, stat:{wins:0,losses:0,pulls:0} };
}
function normalize(j){         // 저장본에 빠진 필드 보정
  j.robots = j.robots.filter(rb=>ROBOT_TYPES[rb.type]);
  if(!j.robots.length) return freshState();
  for(const rb of j.robots){ rb.level=clamp(rb.level|0,1,MAXLV); rb.exp=Math.max(0,rb.exp|0);
    if(rb.fat==null && rb.dur!=null) rb.fat = clamp(100-rb.dur, 0, FAT_MAX);   // 예전 '내구도' 저장본 이관
    delete rb.dur; rb.fat = fatOf(rb); }
  j.sel = clamp(j.sel|0, 0, j.robots.length-1); j.v = 2; return j;
}
function load(){
  try{ localStorage.removeItem('rowar.save.v1'); }catch(e){}      // 옛 저장본 정리
  try{ const j=JSON.parse(localStorage.getItem(SAVE_KEY)); if(j&&j.robots&&j.robots.length) return normalize(j); }catch(e){}
  return freshState();
}
function save(){ try{ localStorage.setItem(SAVE_KEY,JSON.stringify(S)); }catch(e){} }

/* ------------------------------- 스탯 계산 ------------------------------- */
const findPart = (u,parts)=> parts.find(p=>p.uid===u);
function partStat(p){ const o={}; const e=p.enh||0; for(const k in p.stats){ o[k]= isPct(k) ? p.stats[k]*(1+e*0.08) : p.stats[k]*(1+e*0.12); }
  if(o.atk) o.atk *= ATK_SCALE;                      // 파츠 공격력도 같은 배율로 (표시값 = 실제 기여)
  return o; }
function computeStats(robot, parts){
  parts = parts || S.parts;
  const T=COMBAT_TYPES[robot.type], lv=robot.level, s={};
  for(const k of ['hp','atk','def','spd']) s[k]=T.base[k]+(T.grow[k]||0)*(lv-1);
  s.atk *= ATK_SCALE;                                // 기체 공격력 배율
  s.crit=T.base.crit; s.eva=T.base.eva;
  for(const slot of SLOTS){ const u=robot.slots[slot]; if(!u) continue; const p=findPart(u,parts); if(!p) continue;
    const ps=partStat(p); for(const k in ps) s[k]=(s[k]||0)+ps[k]; }
  for(const k of ['hp','atk','def','spd']) s[k]=Math.round(s[k]);
  s.hpFull = s.hp;                                                 // 피로도 0 일 때의 최대 체력
  s.hp = Math.max(1, Math.round(s.hp * (100-fatOf(robot))/100));   // 피로도만큼 최대 체력이 줄어든다
  s.crit=clamp(s.crit,0,.75); s.eva=clamp(s.eva,0,.6);
  return s;
}
function power(robot,parts){ const s=computeStats(robot,parts); return Math.round(s.hp*0.5+s.atk*(3/ATK_SCALE)+s.def*2.6+s.spd*2.2+s.crit*320+s.eva*280); }
const lvCost = lv => Math.round(80+lv*lv*4+lv*40);
const enhCost = e => (e+1)*18;
const overallLevel = ()=> Math.max(1, ...S.robots.map(r=>r.level));

/* ------------------------------- 파츠/뽑기 ------------------------------- */
function genPart(level){
  const slot=pick(SLOTS), rar=weighted(RARITY), lvScale=1+(level||1)*0.03, stats={};
  for(let i=0;i<rar.n;i++){ const st=pick(SLOT_STATS[slot]); const [a,b]=STAT_ROLL[st];
    let v=rf(a,b)*rar.mul; if(!isPct(st)) v=Math.round(v*lvScale);
    stats[st]=(stats[st]||0)+v; }
  for(const k in stats) if(isPct(k)) stats[k]=Math.round(stats[k]*1000)/1000;
  return { uid:uid(), slot, name:pick(PART_NAMES[slot]), rarity:rar.k, ko:rar.ko, stats, enh:0 };
}
function pull(){
  if(S.cores<PULL_COST){ toast('코어가 부족합니다'); return null; }
  S.cores-=PULL_COST; S.stat.pulls++;
  const kind=weighted(PULL_TABLE).k; let res;
  if(kind==='robot'){ const type=pick(BY_RARITY[weighted(ROBOT_RARITY).k]);
    if(S.robots.some(r=>r.type===type)){ const g=DUPE_GAIN[rarOf(type)];
      S.credits+=g.cr; S.scrap+=g.sc; S.cores+=g.co; res={kind:'dupe',type,gain:g}; }
    else { const rb={uid:uid(),type,level:1,exp:0,fat:0,slots:emptySlots()}; S.robots.push(rb); res={kind:'robot',type}; }
  }
  else if(kind==='core'){ S.cores+=1; res={kind:'core',n:1}; }
  else if(kind==='credit'){ const cr=140+overallLevel()*12+ri(0,90); S.credits+=cr; res={kind:'credit',cr}; }
  else if(kind==='part'){ const p=genPart(overallLevel()); S.parts.push(p); res={kind:'part',part:p}; }
  else { res={kind:'bust'}; }
  save(); return res;
}

/* ------------------------------- 장착/육성 ------------------------------- */
function selRobot(){ return S.robots[S.sel]; }
function equip(slot,partUid){ for(const rb of S.robots) for(const sl of SLOTS) if(rb.slots[sl]===partUid) rb.slots[sl]=null; selRobot().slots[slot]=partUid; save(); renderAll(); closeModal(); }
function unequip(slot){ selRobot().slots[slot]=null; save(); renderAll(); closeModal(); }
function enhancePart(u){ const p=findPart(u,S.parts); if(!p) return; if((p.enh||0)>=10){toast('최대 강화입니다');return;} const c=enhCost(p.enh||0); if(S.scrap<c){toast('스크랩이 부족합니다');return;} S.scrap-=c; p.enh=(p.enh||0)+1; save(); renderAll(); toast(p.name+' +'+p.enh); }
function gainExp(rb,amt){          // 대전으로 경험치를 얻고, 차면 자동으로 레벨업
  const from=rb.level;
  if(rb.level>=MAXLV){ rb.exp=0; return {amt:0,from,to:from}; }
  rb.exp=(rb.exp||0)+amt;
  while(rb.level<MAXLV && rb.exp>=expNeed(rb.level)){ rb.exp-=expNeed(rb.level); rb.level++; }
  if(rb.level>=MAXLV) rb.exp=0;
  return {amt,from,to:rb.level};
}
function addFat(rb,amt){          // 대전 결과에 따라 피로도가 쌓인다
  const before=fatOf(rb); rb.fat=clamp(before+amt, 0, FAT_MAX); return rb.fat-before; }
function service(){               // 크레딧으로 피로도 0 복구
  const rb=selRobot(), c=serviceCost(rb);
  if(c<=0){ toast('이미 정비된 상태입니다'); return; }
  if(S.credits<c){ toast('크레딧이 부족합니다'); return; }
  S.credits-=c; rb.fat=0; save(); renderAll(); toast(ROBOT_TYPES[rb.type].name+' 정비 완료'); }
function levelUp(){               // 크레딧으로 즉시 1레벨(진행 중인 경험치는 소모된다)
  const rb=selRobot(); if(rb.level>=MAXLV){toast('최대 레벨입니다');return;}
  const c=lvCost(rb.level); if(S.credits<c){toast('크레딧이 부족합니다');return;}
  S.credits-=c; rb.level++; rb.exp=0; save(); renderAll(); toast(ROBOT_TYPES[rb.type].name+' Lv.'+rb.level); }

/* ------------------------------- UI 기본 ------------------------------- */
let cur='hangar', toastT;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'),1600); }
function go(scr){ cur=scr; document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id==='sc-'+scr));
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.s===scr));
  renderAll(); }
function renderWallet(){ $('#w-credit').textContent=fmt(S.credits); $('#w-core').textContent=fmt(S.cores); $('#w-scrap').textContent=fmt(S.scrap); }
function renderAll(){ renderWallet(); if(cur==='hangar')renderHangar(); else if(cur==='gacha')renderGacha(); else if(cur==='battle')renderBattleHome(); }
function openModal(html){ const m=$('#modal'); m.innerHTML=`<div class="modal-card">${html}</div>`; m.classList.add('on'); m.onclick=e=>{ if(e.target===m) closeModal(); }; }
function closeModal(){ $('#modal').classList.remove('on'); $('#modal').innerHTML=''; }

function rarTag(p){ return `<span class="tag rar-${p.rarity}">${p.rarity}${p.enh?` +${p.enh}`:''}</span>`; }
function partStatLine(p){ const ps=partStat(p); return Object.keys(ps).map(k=> `${STAT_LABEL[k]} +${isPct(k)?(ps[k]*100).toFixed(1)+'%':Math.round(ps[k])}`).join(' · '); }
function statBar(k,v,full){       // full 을 주면 깎여나간 만큼을 붉게 겹쳐 보여준다
  const pct=clamp(v/STAT_MAX[k]*100,0,100), val=isPct(k)?(v*100).toFixed(0)+'%':fmt(v);
  const dmg = full!=null && full>v;
  const ghost = dmg? `<u style="width:${clamp(full/STAT_MAX[k]*100,0,100)}%"></u>` : '';
  const lost  = dmg? ` <s>-${fmt(full-v)}</s>` : '';
  return `<div class="stat"><div class="row"><b>${STAT_LABEL[k]}</b><span>${val}${lost}</span></div><div class="bar">${ghost}<i style="width:${pct}%"></i></div></div>`; }

/* ------------------------------- 격납고 화면 ------------------------------- */
function renderHangar(){
  const rb=selRobot(), T=ROBOT_TYPES[rb.type], st=computeStats(rb);
  const roster = S.robots.map((r,i)=>{ const t=ROBOT_TYPES[r.type];
    return `<div class="rcard ${i===S.sel?'sel':''}" data-t="${t.rarity}" onclick="ROWAR.selectRobot(${i})">
      <span class="badge">Lv.${r.level}</span>
      <span class="badge rt rr-${t.rarity}">${RR[t.rarity].ko}</span>
      <div class="sprite" data-t="${t.rarity}">${sprite(r.type,false)}</div>
      <div class="rn">${t.name}</div><div class="rl">전투력 ${fmt(power(r))}</div>
      ${fatOf(r)?`<div class="rd">피로 ${fatOf(r)}</div>`:''}</div>`; }).join('');
  const slotsHtml = SLOTS.map(slot=>{ const u=rb.slots[slot]; const p=u&&findPart(u,S.parts);
    return `<div class="slot ${p?'filled':''}" onclick="ROWAR.openSlot('${slot}')">
      <div class="sl">${SLOT_KO[slot]}</div>
      ${p?`<div class="pn">${p.name}</div><div class="pp">${rarTag(p)}</div>`:`<div class="pn" style="color:var(--dim)">+ 장착</div>`}</div>`; }).join('');
  const invParts = S.parts.filter(p=> !S.robots.some(r=>Object.values(r.slots).includes(p.uid)));
  const inv = invParts.length? invParts.map(p=>`<div class="pchip" onclick="ROWAR.enhance('${p.uid}')" title="클릭: 강화(스크랩 ${enhCost(p.enh||0)})">
      <div class="pn">${p.name} ${rarTag(p)}</div><div class="ps">${SLOT_KO[p.slot]} · ${partStatLine(p)}</div>
      <div class="ps" style="color:var(--gold)">클릭 → 강화 (스크랩 ${enhCost(p.enh||0)})</div></div>`).join('')
    : `<div class="empty">보유한 여분 파츠가 없습니다. 뽑기나 대전으로 획득하세요.</div>`;
  const cost=lvCost(rb.level), fat=fatOf(rb), scost=serviceCost(rb);
  $('#sc-hangar').innerHTML = `
    <h2 class="title">격납고 · 보유 로봇 ${S.robots.length}기</h2>
    <div class="panel"><div class="roster">${roster}</div></div>
    <div class="panel">
      <div class="detail">
        <div><div class="sprite" data-t="${T.rarity}">${sprite(rb.type,false)}</div></div>
        <div>
          <div class="rname">${T.name} ${robRarTag(rb.type)} <span class="lv">Lv.${rb.level}</span></div>
          <div class="rrole">${T.role} · 전투력 ${fmt(power(rb))}</div>
          <div class="stat exp"><div class="row"><b>EXP</b><span>${
            rb.level>=MAXLV?'MAX':`${fmt(rb.exp||0)} / ${fmt(expNeed(rb.level))}`}</span></div>
            <div class="bar"><i style="width:${rb.level>=MAXLV?100:clamp((rb.exp||0)/expNeed(rb.level)*100,0,100)}%"></i></div></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px;margin-top:6px">
            ${['hp','atk','def','spd','crit','eva'].map(k=>statBar(k,st[k], k==='hp'?st.hpFull:null)).join('')}
          </div>
          <div class="stat fat"><div class="row"><b>피로도</b>
              <span class="${fat?'worn':''}">${fat} / ${FAT_MAX}${fat?` <s>최대 내구 −${fat}%</s>`:''}</span></div>
            <div class="bar"><i style="width:${fat/FAT_MAX*100}%"></i></div></div>
          <div class="skill"><b>스킬 · ${T.skill.name}</b><p>${T.skill.desc}</p></div>
          <div class="row-btns" style="margin-top:10px">
            <button class="btn big" ${rb.level>=MAXLV?'disabled':''} onclick="ROWAR.levelUp()">
              ${rb.level>=MAXLV?'최대 레벨':`즉시 레벨업 (크레딧 ${fmt(cost)})`}</button>
            <button class="btn big ${scost>0?'gold':''}" ${scost>0?'':'disabled'} onclick="ROWAR.service()">
              ${scost>0?`정비 (크레딧 ${fmt(scost)})`:'정비 완료'}</button>
          </div>
          <div class="hint" style="margin-top:6px">대전에 출전하면 경험치를 얻어 자동으로 레벨업합니다.
            대신 피로도가 쌓여 최대 내구(체력)가 줄어듭니다. 등급별 단가로 정비하세요.</div>
        </div>
      </div>
      <div class="slots">${slotsHtml}</div>
    </div>
    <div class="panel">
      <h2 class="title" style="margin-top:0">파츠 인벤토리</h2>
      <div class="hint">파츠를 클릭하면 <b>강화</b>됩니다(스크랩 소모). 장착은 위의 슬롯을 눌러 선택하세요.</div>
      <div class="inv">${inv}</div>
    </div>`;
}
function openSlot(slot){
  const rb=selRobot(); const equippedHere=rb.slots[slot];
  const list=S.parts.filter(p=>p.slot===slot);
  const rows = list.length? list.map(p=>{ const equipped = S.robots.some(r=>Object.values(r.slots).includes(p.uid));
    const onMe = equippedHere===p.uid;
    return `<div class="pchip" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div><div class="pn">${p.name} ${rarTag(p)}</div><div class="ps">${partStatLine(p)}</div>
      ${equipped&&!onMe?`<div class="ps" style="color:var(--bad)">다른 기체 장착중</div>`:''}</div>
      <button class="btn ${onMe?'danger':''}" style="padding:8px 12px;font-size:13px"
        onclick="ROWAR.${onMe?`unequip('${slot}')`:`equip('${slot}','${p.uid}')`}">${onMe?'해제':'장착'}</button>
    </div>`; }).join('') : `<div class="empty">이 슬롯(${SLOT_KO[slot]})에 맞는 파츠가 없습니다.</div>`;
  openModal(`<div class="mhead">${SLOT_KO[slot]} 슬롯 · 파츠 선택 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>${rows}`);
}

/* ------------------------------- 뽑기 화면 ------------------------------- */
function renderGacha(){
  const wsum=ROBOT_RARITY.reduce((s,r)=>s+r.w,0);
  const tipCol={bust:'var(--dim)',core:'var(--acc2)',credit:'var(--gold)',robot:'var(--acc2)',part:'var(--sub)'};
  const rate=`<div class="rates">
    ${PULL_TABLE.map(t=>`<span class="tag" style="color:${tipCol[t.k]}">${PULL_KO[t.k]} ${t.w}%</span>`).join('')}</div>
    <div class="rates" style="margin-top:6px">
    <span class="tag" style="color:var(--sub)">로봇 등급</span>
    ${ROBOT_RARITY.map(r=>`<span class="tag rr-${r.k}">${r.ko} ${(ROBOT_APPEAR*r.w/wsum*100).toFixed(2)}%</span>`).join('')}</div>
    <div class="rates" style="margin-top:6px">
    <span class="tag" style="color:var(--sub)">파츠 등급</span>
    <span class="tag rar-C">일반 52%</span><span class="tag rar-R">정밀 30%</span>
    <span class="tag rar-SR">시제 14%</span><span class="tag rar-SSR">초월 4%</span></div>`;
  $('#sc-gacha').innerHTML = `
    <h2 class="title">뽑기 · 코어 캡슐</h2>
    <div class="panel">
      <div class="gacha-stage" id="stage"><div class="ray" style="opacity:.35"></div><div class="capsule"></div></div>
      ${rate}
      <div class="row-btns" style="margin-top:12px">
        <button class="btn gold big" onclick="ROWAR.pull1()" ${S.cores<1?'disabled':''}>1회 뽑기 (코어 1)</button>
        <button class="btn big" onclick="ROWAR.pull10()" ${S.cores<10?'disabled':''}>10회 뽑기 (코어 10)</button>
      </div>
      <div class="hint" style="margin-top:8px">코어는 대전 승리로 조금씩 얻습니다.
        로봇은 ${ROBOT_RARITY.length}등급 ${TYPE_KEYS.length}종이며, 이미 가진 기체가 나오면 등급에 맞춰 자원으로 분해됩니다.</div>
    </div>`;
}
async function pull1(){
  if(S.cores<1){toast('코어가 부족합니다');return;}
  const stage=$('#stage'); stage.classList.add('rolling');
  const res=pull(); renderWallet();
  await sleep(650); stage.classList.remove('rolling');
  showReveal([res]);
}
async function pull10(){
  if(S.cores<10){toast('코어가 부족합니다');return;}
  const stage=$('#stage'); stage.classList.add('rolling');
  const results=[]; for(let i=0;i<10;i++){ const r=pull(); if(r) results.push(r); }
  renderWallet(); await sleep(650); stage.classList.remove('rolling');
  showReveal(results);
}
function revealCardHtml(res){
  if(res.kind==='robot') return `<div class="pchip" style="border-color:var(--acc)"><div class="pn" style="color:var(--acc2)">신규 로봇! ${ROBOT_TYPES[res.type].name} ${robRarTag(res.type)}</div><div class="ps">${ROBOT_TYPES[res.type].role}</div></div>`;
  if(res.kind==='dupe'){ const g=res.gain||DUPE_GAIN[rarOf(res.type)];
    return `<div class="pchip"><div class="pn">${ROBOT_TYPES[res.type].name} ${robRarTag(res.type)} (중복)</div><div class="ps" style="color:var(--gold)">분해 → 크레딧 +${g.cr}, 스크랩 +${g.sc}${g.co?`, 코어 +${g.co}`:''}</div></div>`; }
  if(res.kind==='core') return `<div class="pchip" style="border-color:var(--acc2)"><div class="pn" style="color:var(--acc2)">코어 +${res.n}</div><div class="ps">뽑기를 한 번 더 돌릴 수 있습니다</div></div>`;
  if(res.kind==='credit') return `<div class="pchip"><div class="pn" style="color:var(--gold)">크레딧 +${fmt(res.cr)}</div><div class="ps">레벨업·정비에 쓰세요</div></div>`;
  if(res.kind==='bust') return `<div class="pchip" style="opacity:.6"><div class="pn" style="color:var(--dim)">꽝</div><div class="ps">아무것도 나오지 않았습니다</div></div>`;
  const p=res.part; return `<div class="pchip"><div class="pn">${p.name} ${rarTag(p)}</div><div class="ps">${SLOT_KO[p.slot]} · ${partStatLine(p)}</div></div>`;
}
function showReveal(results){
  const best=results.reduce((a,b)=> rankOf(b)>rankOf(a)?b:a, results[0]);
  const heroType = (best.kind==='robot'||best.kind==='dupe')? best.type : null;
  const hero = heroType ? `<div class="sprite" data-t="${rarOf(heroType)}">${sprite(heroType,false)}</div>`
             : best.kind==='part'   ? bigPartArt(best.part)
             : best.kind==='core'   ? bigIconArt('◆','var(--acc2)')
             : best.kind==='credit' ? bigIconArt('₡','var(--gold)')
                                    : bigIconArt('✕','var(--dim)');
  const list = results.length>1? `<div class="inv" style="max-height:150px;overflow:auto;width:100%">${results.map(revealCardHtml).join('')}</div>` : revealCardHtml(results[0]);
  openModal(`<div class="mhead">뽑기 결과 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="reveal-hero">${hero}</div>${list}
    <button class="btn big" style="margin-top:12px" onclick="ROWAR.closeModal()">확인</button>`);
  renderGacha();
}
function rankOf(res){ if(res.kind==='robot')return 200+RIDX[rarOf(res.type)];
  if(res.kind==='dupe')return 100+RIDX[rarOf(res.type)];
  if(res.kind==='core')return 60;
  if(res.kind==='credit')return 20;
  if(res.kind==='bust')return -1;
  return {C:1,R:2,SR:3,SSR:4}[res.part.rarity]||0; }
function bigIconArt(ch,col){
  return `<div style="width:120px;height:120px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:46px;color:${col};background:radial-gradient(circle at 40% 30%,#233a63,#0c1220);border:2px solid ${col}">${ch}</div>`; }
function bigPartArt(p){ const c={C:'#8a97b5',R:'#4aa3ff',SR:'#c07bff',SSR:'#ffb03a'}[p.rarity];
  return `<div style="width:120px;height:120px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:34px;color:${c};background:radial-gradient(circle at 40% 30%,#233a63,#0c1220);border:2px solid ${c}">${SLOT_KO[p.slot][0]}</div>`; }

/* ------------------------------- 대전 ------------------------------- */
let _pendingOpp=null, _battleRobot=null, battleSpeed=2;   // 공격력 너프로 턴이 길어져 기본 x2
function renderBattleHome(){
  const rb=selRobot(), T=ROBOT_TYPES[rb.type];
  $('#sc-battle').innerHTML = `
    <h2 class="title">대전 · 상대 찾기</h2>
    <div class="panel">
      <div class="oppcard">
        <div class="sprite" data-t="${T.rarity}" style="height:120px">${sprite(rb.type,false)}</div>
        <div>
          <div class="rname">${T.name} ${robRarTag(rb.type)} <span class="lv">Lv.${rb.level}</span></div>
          <div class="rrole">${T.role}</div>
          <div style="margin-top:6px;font-weight:800;color:var(--gold)">전투력 ${fmt(power(rb))}</div>
          <div class="hint">출전 기체는 격납고에서 선택한 로봇입니다.</div>
        </div>
      </div>
      <div class="hint" style="margin-top:10px">상대 로봇 또는 야생 몬스터와 대전합니다. 몬스터는 대전에서만 출현합니다.</div>
      <button class="btn big" style="margin-top:12px" onclick="ROWAR.findMatch()">상대 찾기</button>
      <div class="hint" style="margin-top:8px">전적 · ${S.stat.wins}승 ${S.stat.losses}패
        <span style="color:var(--dim)"> · (지금은 서버 대신 로컬에서 상대를 생성하는 임시 매칭입니다)</span></div>
    </div>`;
}
function findMatch(){
  $('#sc-battle').innerHTML = `<h2 class="title">대전</h2><div class="panel"><div class="mm">
    <div class="spinner"></div><div style="font-weight:800">상대를 검색하는 중...</div>
    <div class="hint">상대 로봇과 야생 몬스터의 신호를 탐색합니다.</div></div></div>`;
  setTimeout(()=>{ _pendingOpp=makeOpponent(); showOpponent(_pendingOpp); }, 1200);
}
function oppType(byRarity=BY_RARITY){                       // 내가 가진 최고 등급보다 한 단계 위까지만 만난다
  const best=Math.max(...S.robots.map(r=>RIDX[rarOf(r.type)]));
  const pool=ROBOT_RARITY.filter(r=>RIDX[r.k]<=Math.min(4,best+1));
  return pick(byRarity[weighted(pool).k]);
}
function makeOpponent(){
  const monster=R()<MONSTER_ENCOUNTER_RATE;
  const myLv=selRobot().level, type=oppType(monster?MONSTER_BY_RARITY:BY_RARITY), lv=clamp(myLv+ri(-2,2),1,MAXLV);
  const rb={uid:'E'+uid(),type,level:lv,slots:emptySlots()}, parts=[];
  // 몬스터는 고유 스탯/성장률로 싸우며 소유 기체나 파츠를 생성하지 않는다.
  if(monster) return {kind:'monster',robot:rb,parts,callsign:MONSTER_TYPES[type].name};
  const np=ri(0,2);
  for(let i=0;i<np;i++){ const p=genPart(lv); parts.push(p); rb.slots[p.slot]=p.uid; }
  const callsign=pick(['NOVA','RAZE','ORCA','KITE','VULT','ZERO','ONYX','HELM','SABLE','ARC','GEIST','ROOK'])+'-'+ri(10,99);
  return {kind:'robot',robot:rb,parts,callsign};
}
function showOpponent(opp){
  const T=COMBAT_TYPES[opp.robot.type], monster=!!MONSTER_TYPES[opp.robot.type];
  $('#sc-battle').innerHTML = `
    <h2 class="title">${monster?'몬스터 출현':'상대 발견'}</h2>
    <div class="panel">
      <div class="oppcard">
        <div class="sprite" data-t="${T.rarity}" style="height:120px">${sprite(opp.robot.type,false)}</div>
        <div>
          <div class="rname">${opp.callsign} ${monster?'<span class="tag monster-tag">몬스터</span>':robRarTag(opp.robot.type)}</div>
          <div class="rrole">${monster?'위험도 '+T.rarity:T.name} · ${T.role} · Lv.${opp.robot.level}</div>
          <div style="margin-top:6px;font-weight:800;color:var(--bad)">전투력 ${fmt(power(opp.robot,opp.parts))}</div>
        </div>
      </div>
      ${monster?`<div class="monster-skill"><strong>${T.skill.name}</strong><span>${T.skill.desc}</span></div>`:''}
      <div class="row-btns" style="margin-top:12px">
        <button class="btn big gold" onclick="ROWAR.startBattle()">전투 시작</button>
        <button class="btn ghost" onclick="ROWAR.findMatch()">다시 찾기</button>
      </div>
    </div>`;
}

function makeUnit(name,type,st){ return {name,type,maxhp:st.hp,hp:st.hp,atk:st.atk,def:st.def,spd:st.spd,crit:st.crit,eva:st.eva,sp:0}; }
function dmgCalc(atk,def,rnd,mult){ let b=atk*100/(100+Math.max(0,def)); b*=mult; b*=0.9+rnd()*0.2; return Math.max(1,Math.round(b)); }
function doHit(A,D,side,dside,ev,rnd,o){ o=o||{};
  if(!o.noMiss && rnd()<D.eva){ ev.push({t:'hit',side,dside,miss:true,dmg:0,crit:false,thp:D.hp}); return; }
  const crit = o.alwaysCrit || (!o.noCrit && rnd()<A.crit);
  const pen = o.ignoreDef ? (o.ignoreDef===true ? DEF_PEN : o.ignoreDef) : 0;   // 완전 무시가 아니라 부분 관통
  const m=(o.mult||1)*(crit?CRIT_MULT:1), def=Math.max(0,D.def)*(1-pen);
  const dmg=dmgCalc(A.atk,def,rnd,m); D.hp=Math.max(0,D.hp-dmg);
  ev.push({t:'hit',side,dside,miss:false,dmg,crit,thp:D.hp});
  if(o.drain){ const hl=Math.max(1,Math.round(dmg*o.drain)); A.hp=Math.min(A.maxhp,A.hp+hl);
    ev.push({t:'heal',side,hp:A.hp,amt:hl}); }
}
function doSkill(A,D,side,dside,ev,rnd){          // 기체와 몬스터의 고유 스킬을 같은 전투 규칙으로 실행한다
  const sk=(COMBAT_TYPES[A.type]||ROBOT_TYPES.mule).skill, fx=sk.fx||{mult:1.8};
  ev.push({t:'skill',side,name:sk.name});
  const hits=fx.hits||1;
  for(let i=0;i<hits;i++){ if(D.hp<=0) break; doHit(A,D,side,dside,ev,rnd,fx); }
}
function simulate(P,E,seed){
  const rnd=mulberry32(seed>>>0), ev=[{t:'start'}], g={P:0,E:0}; let guard=0;
  while(P.hp>0&&E.hp>0&&guard<600){ guard++;
    const tP=(100-g.P)/P.spd, tE=(100-g.E)/E.spd, dt=Math.min(tP,tE);
    g.P+=P.spd*dt; g.E+=E.spd*dt;
    const actors=[]; if(g.P>=99.999)actors.push('P'); if(g.E>=99.999)actors.push('E');
    actors.sort((a,b)=>(b==='P'?P.spd:E.spd)-(a==='P'?P.spd:E.spd));
    for(const side of actors){ if(P.hp<=0||E.hp<=0)break; g[side]-=100;
      const A=side==='P'?P:E, D=side==='P'?E:P, dside=side==='P'?'E':'P';
      A.sp=Math.min(100,A.sp+30); ev.push({t:'turn',side,sp:A.sp});
      if(A.sp>=100){ A.sp=0; doSkill(A,D,side,dside,ev,rnd); } else doHit(A,D,side,dside,ev,rnd,{}); }
  }
  ev.push({t:'end',winner: P.hp>0?'P':(E.hp>0?'E':'P')});
  return ev;
}

function startBattle(){
  const opp=_pendingOpp; if(!opp) return;
  const my=selRobot(); _battleRobot=my;          // 전투 중 기체를 바꿔도 보상은 출전 기체에게
  const P=makeUnit(ROBOT_TYPES[my.type].name,my.type,computeStats(my));
  const E=makeUnit(opp.callsign,opp.robot.type,computeStats(opp.robot,opp.parts));
  const seed=(Date.now()^Math.floor(R()*1e9))>>>0;
  const events=simulate(P,E,seed);   // P,E 의 hp/sp 는 여기서 소진됨(재생은 maxhp/name 만 사용)
  renderArena(my.type,opp.robot.type,P.name,E.name);
  playBattle(events,P,E).then(winner=>{
    if(!winner) return;                          // 중간에 나갔으면 결과/보상 없이 조용히 종료
    const rw=battleRewards(winner==='P',opp.robot.level);
    renderResult(winner==='P',rw,P,E,opp);
  });
}
function battleRewards(win,enemyLv){
  const rb=_battleRobot||selRobot(), rname=ROBOT_TYPES[rb.type].name;
  const lv=gainExp(rb, win? battleExp(enemyLv) : Math.round(battleExp(enemyLv)*0.35));
  const fat={add:addFat(rb, win? 3+ri(0,2) : 7+ri(0,3)), now:fatOf(rb)};
  if(win){ const cr=120+enemyLv*14+ri(0,40), sc=18+ri(0,14); S.credits+=cr; S.scrap+=sc;
    let core=0,part=null; if(R()<0.20){core=1;S.cores++;} if(R()<0.09){part=genPart(enemyLv);S.parts.push(part);}   // 예전 0.35 의 약 1/4
    S.stat.wins++; save(); return {win,cr,sc,core,part,lv,fat,rname}; }
  const cr=40+ri(0,20), sc=6; S.credits+=cr; S.scrap+=sc; S.stat.losses++; save();
  return {win,cr,sc,core:0,part:null,lv,fat,rname};
}

/* ---- 대전 아레나 & 재생 ---- */
function renderArena(pType,eType,pName,eName){
  $('#sc-battle').innerHTML = `
    <h2 class="title">${MONSTER_TYPES[eType]?'몬스터 대전':'자동 대전'}</h2>
    <div class="arena" id="arena">
      <div class="grid"></div><div class="vs">VS</div>
      <div class="hpwrap p"><div class="nm"><span>${pName}</span><small id="hpn-p"></small></div>
        <div class="hpbar" id="hp-p"><i></i></div><div class="spbar" id="sp-p"><i></i></div></div>
      <div class="hpwrap e"><div class="nm"><small id="hpn-e"></small><span>${eName}</span></div>
        <div class="hpbar" id="hp-e"><i></i></div><div class="spbar" id="sp-e"><i></i></div></div>
      <div class="fighter left" id="fighter-p">${sprite(pType,true)}</div>
      <div class="fighter right" id="fighter-e">${sprite(eType,false)}</div>
      <div class="flash" id="flash"></div>
      <div class="skillbanner" id="skillbanner"></div>
    </div>
    <div class="blog" id="blog"></div>
    <div class="row-btns" style="margin-top:10px">
      <button class="btn ghost" id="spdbtn" onclick="ROWAR.toggleSpeed()">속도 x${battleSpeed}</button>
    </div>`;
}
/* 재생 도중 사용자가 다른 화면으로 가면 아레나가 사라진다 → 모든 헬퍼는 없으면 조용히 무시 */
const AR = s => document.querySelector('#arena '+s);
const arenaGone = () => !document.getElementById('arena');
function setHP(side,hp,max){ const bar=AR('#hp-'+side); if(!bar) return; const pct=clamp(hp/max*100,0,100);
  bar.querySelector('i').style.width=pct+'%'; bar.classList.toggle('low',pct<30);
  const n=AR('#hpn-'+side); if(n) n.textContent=Math.max(0,Math.round(hp))+'/'+Math.round(max); }
function setSP(side,sp){ const i=AR('#sp-'+side+' i'); if(i) i.style.width=sp+'%'; }
function flash(){ const f=AR('#flash'); if(!f) return; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
function shakeF(side){ const el=AR('#fighter-'+side); if(!el) return; el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
async function lunge(side){ const el=AR('#fighter-'+side); if(!el) return; el.classList.add(side==='p'?'lungeL':'lungeR'); await sleep(110/battleSpeed); el.classList.remove('lungeL','lungeR'); }
function floatDmg(side,text,cls){ const host=AR('#fighter-'+side); if(!host) return; const d=document.createElement('div'); d.className='dmg '+cls; d.textContent=text; d.style.left=(side==='p'?'30px':'70px'); d.style.top='24px'; host.appendChild(d); setTimeout(()=>d.remove(),1000); }
function banner(txt){ const b=AR('#skillbanner'); if(!b) return; b.textContent=txt; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
function blog(html){ const l=document.getElementById('blog'); if(!l) return; const d=document.createElement('div'); d.innerHTML=html; l.appendChild(d); l.scrollTop=l.scrollHeight; }
async function playBattle(events,P,E){
  const nameOf=s=> s==='P'?`<span class="k">${P.name}</span>`:`<span style="color:var(--bad);font-weight:700">${E.name}</span>`;
  setHP('p',P.maxhp,P.maxhp); setHP('e',E.maxhp,E.maxhp); setSP('p',0); setSP('e',0);
  blog(`전투 개시! <b>${P.name}</b> vs <b>${E.name}</b>`);
  const sl=ms=>sleep(ms/battleSpeed);
  await sl(400);
  for(const e of events){
    if(arenaGone()) return null;                 // 화면을 떠났으면 재생 중단(보상 없음)
    if(e.t==='turn'){ setSP(e.side==='P'?'p':'e', e.sp); continue; }
    if(e.t==='skill'){ banner(e.name); blog(`${nameOf(e.side)} 스킬 <b>${e.name}</b>!`); await sl(520); continue; }
    if(e.t==='heal'){ const hS=e.side==='P'?'p':'e';
      setHP(hS, e.hp, hS==='p'?P.maxhp:E.maxhp); floatDmg(hS,'+'+e.amt,'heal');
      blog(`${nameOf(e.side)} 체력 <span class="h">+${e.amt}</span> 흡수`); await sl(260); continue; }
    if(e.t==='hit'){
      const aS=e.side==='P'?'p':'e', dS=e.dside==='P'?'p':'e';
      await lunge(aS);
      if(e.miss){ floatDmg(dS,'MISS','miss'); blog(`${nameOf(e.side)} 의 공격을 ${nameOf(e.dside)} 이(가) <span class="m">회피!</span>`); }
      else{ flash(); shakeF(dS); floatDmg(dS,(e.crit?'CRIT ':'')+e.dmg,e.crit?'crit':'norm');
        setHP(dS,e.thp, dS==='p'?P.maxhp:E.maxhp);
        blog(`${nameOf(e.side)} → ${nameOf(e.dside)} ${e.crit?'<span class="c">치명타 </span>':''}<b>${e.dmg}</b> 피해`); }
      await sl(300); continue;
    }
    if(e.t==='end'){ await sl(300); return e.winner; }
  }
  return 'P';
}
function renderResult(win,rw,P,E,opp){
  const rewards = [ `<div class="r">경험치 +${rw.lv.amt}</div>` ];
  if(rw.lv.to>rw.lv.from) rewards.push(`<div class="r" style="color:var(--good)">레벨 업!  ${rw.rname}  Lv.${rw.lv.from} → Lv.${rw.lv.to}</div>`);
  rewards.push(`<div class="r">크레딧 +${rw.cr}</div>`, `<div class="r">스크랩 +${rw.sc}</div>`);
  if(rw.fat.add) rewards.push(`<div class="r" style="color:var(--bad)">피로도 +${rw.fat.add}  (누적 ${rw.fat.now} / ${FAT_MAX})</div>`);
  if(rw.core) rewards.push(`<div class="r" style="color:var(--acc2)">코어 +${rw.core}</div>`);
  if(rw.part) rewards.push(`<div class="r">파츠: ${rw.part.name} <span class="tag rar-${rw.part.rarity}">${rw.part.rarity}</span></div>`);
  $('#sc-battle').innerHTML = `
    <div class="panel result">
      <div class="big ${win?'win':'lose'}">${win?'VICTORY':'DEFEAT'}</div>
      <div class="hint">${P.name} vs ${E.name}</div>
      <div class="reward">${rewards.join('')}</div>
      <div class="row-btns">
        <button class="btn big gold" onclick="ROWAR.findMatch()">한 판 더</button>
        <button class="btn big ghost" onclick="ROWAR.go('hangar')">격납고</button>
      </div>
    </div>`;
  renderWallet();
}
function toggleSpeed(){ battleSpeed = battleSpeed>=8?1:battleSpeed*2; const b=$('#spdbtn'); if(b)b.textContent='속도 x'+battleSpeed; }

/* ------------------------------- 초기화/공개 ------------------------------- */
function resetSave(){ if(confirm('정말 초기화할까요? 모든 진행이 삭제됩니다.')){ S=freshState(); save(); go('hangar'); toast('초기화 완료'); } }
window.ROWAR = {
  go, selectRobot:(i)=>{ S.sel=i; save(); renderHangar(); }, levelUp, service, openSlot, equip, unequip, enhance:enhancePart, closeModal,
  pull1, pull10, findMatch, startBattle, toggleSpeed, reset:resetSave
};
document.addEventListener('DOMContentLoaded', ()=>{
  S=load(); save();          // 첫 실행이면 시작 기체를 바로 확정해 저장한다
  document.querySelectorAll('.nav button').forEach(b=> b.addEventListener('click',()=>go(b.dataset.s)));
  go('hangar');
});
})();
