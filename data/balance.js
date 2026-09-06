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
    base:{hp:530,atk:71,def:61,spd:45,crit:.05,eva:.04}, grow:{hp:61.2,atk:8.2,def:8.2,spd:3.7}, spread:.28,
    skill:{name:'해머 다운', desc:'1.6배 강타. 빗나가지 않음.', fx:{mult:1.6,noMiss:true}} },
  dune:{ id:'dune', name:'DUNE', rarity:'C', role:'원거리 견제형 · 트루퍼',
    base:{hp:415,atk:77,def:43,spd:53,crit:.10,eva:.08}, grow:{hp:43.5,atk:10.9,def:4.9,spd:5.1}, spread:.2,
    skill:{name:'더블 탭', desc:'0.9배 사격을 2회. 각각 치명타·회피 판정.', fx:{mult:0.9,hits:2}} },
  /* ---- 언커먼 ---- */
  ranger:{ id:'ranger', name:'RANGER', rarity:'UC', role:'저격형 · 마크스맨',
    base:{hp:425,atk:82,def:46,spd:58,crit:.14,eva:.10}, grow:{hp:42.1,atk:11.2,def:4.7,spd:5}, spread:.14,
    skill:{name:'관통 사격', desc:'적 방어력을 60% 관통하는 1.75배 저격.', fx:{mult:1.75,ignoreDef:true}} },
  vanguard:{ id:'vanguard', name:'VANGUARD', rarity:'UC', role:'중장 포격형 · 헤비',
    base:{hp:643,atk:87,def:74,spd:45,crit:.07,eva:.03}, grow:{hp:64.8,atk:9.1,def:7.8,spd:3.5}, spread:.34,
    skill:{name:'풀 버스트', desc:'2.0배 대폭격. 회피 불가.', fx:{mult:2.0,noMiss:true}} },
  /* ---- 레어 ---- */
  azure:{ id:'azure', name:'AZURE', rarity:'R', role:'고기동 강습형 · 스트라이커',
    base:{hp:502,atk:97,def:55,spd:61,crit:.18,eva:.14}, grow:{hp:44.4,atk:10.9,def:5,spd:5.2}, spread:.22,
    skill:{name:'트라이 슬래시', desc:'1.0배 연격을 3회. 각각 치명타·회피 판정.', fx:{mult:1.0,hits:3}} },
  glacier:{ id:'glacier', name:'GLACIER', rarity:'R', role:'근접 방어형 · 가디언',
    base:{hp:695,atk:90,def:80,spd:48,crit:.08,eva:.06}, grow:{hp:60.6,atk:8.9,def:7.4,spd:3.5}, spread:.25,
    skill:{name:'가드 브레이커', desc:'적 방어력을 60% 관통하는 1.9배 강타. 빗나가지 않음.',
           fx:{mult:1.9,ignoreDef:true,noMiss:true}} },
  /* ---- 유니크 ---- */
  wraith:{ id:'wraith', name:'WRAITH', rarity:'UQ', role:'흡수형 · 리퍼',
    base:{hp:785,atk:104,def:85,spd:51,crit:.12,eva:.08}, grow:{hp:60.9,atk:9.2,def:7.5,spd:3.8}, spread:.24,
    skill:{name:'소울 드레인', desc:'2.4배 강타. 준 피해의 35%만큼 체력을 흡수한다.',
           fx:{mult:2.4,drain:.35}} },
  oracle:{ id:'oracle', name:'ORACLE', rarity:'UQ', role:'정밀 저격형 · 시어',
    base:{hp:578,atk:106,def:65,spd:65,crit:.24,eva:.18}, grow:{hp:43.7,atk:10.6,def:4.9,spd:4.9}, spread:.12,
    skill:{name:'프리딕션', desc:'0.7배 사격 3회. 모두 확정 치명타(회피는 가능).',
           fx:{mult:0.7,hits:3,alwaysCrit:true}} },
  /* ---- 에픽 ---- */
  seraph:{ id:'seraph', name:'SERAPH', rarity:'EP', role:'성역 강습형 · 아크엔젤',
    base:{hp:897,atk:133,def:101,spd:68,crit:.16,eva:.14}, grow:{hp:59.3,atk:9.1,def:6.9,spd:4.3}, spread:.18,
    skill:{name:'세이크리드 랜스', desc:'방어력 60% 관통 2.2배. 빗나가지 않고 25%를 흡수한다.',
           fx:{mult:2.2,ignoreDef:true,noMiss:true,drain:.25}} },
  nemesis:{ id:'nemesis', name:'NEMESIS', rarity:'EP', role:'파멸 포격형 · 오버로드',
    base:{hp:772,atk:133,def:86,spd:71,crit:.22,eva:.12}, grow:{hp:44.6,atk:10.1,def:5.7,spd:4.3}, spread:.28,
    skill:{name:'카오스 버스트', desc:'적 방어력을 60% 관통하는 1.15배 폭격을 3회.',
           fx:{mult:1.15,hits:3,ignoreDef:true}} },
  /* ---- 세트 02: 같은 등급의 기존 기체를 기준으로 무작위 생성한 고정 스펙 ---- */
  rust:{ id:'rust', name:'RUST', rarity:'C', role:'근접 방어형 · 센트리',
    base:{hp:495,atk:72,def:58,spd:46,crit:0.06,eva:0.05}, grow:{hp:58.4,atk:9.1,def:7.1,spd:3.7}, spread:.27,
    skill:{name:'아이언 너클', desc:'1.65배 강타. 빗나가지 않음.',
           fx:{mult:1.65,noMiss:true}} },
  scarab:{ id:'scarab', name:'SCARAB', rarity:'C', role:'기동 타격형 · 스카우트',
    base:{hp:439,atk:79,def:46,spd:52,crit:0.09,eva:0.07}, grow:{hp:48.3,atk:10.8,def:4.9,spd:4.6}, spread:.2,
    skill:{name:'트윈 임팩트', desc:'0.85배 타격을 2회. 각각 치명타·회피 판정.',
           fx:{mult:0.85,hits:2}} },
  bastion:{ id:'bastion', name:'BASTION', rarity:'UC', role:'지원 포격형 · 미사일러',
    base:{hp:613,atk:83,def:66,spd:47,crit:0.08,eva:0.04}, grow:{hp:60.7,atk:9,def:7.7,spd:3.9}, spread:.3,
    skill:{name:'미사일 레인', desc:'0.95배 미사일을 2회 발사. 회피 불가.',
           fx:{mult:0.95,hits:2,noMiss:true}} },
  kestrel:{ id:'kestrel', name:'KESTREL', rarity:'UC', role:'관통 사격형 · 헌터',
    base:{hp:442,atk:81,def:49,spd:57,crit:0.13,eva:0.09}, grow:{hp:46.8,atk:10.3,def:4.8,spd:5}, spread:.16,
    skill:{name:'피어싱 캐논', desc:'적 방어력을 60% 관통하는 1.8배 포격.',
           fx:{mult:1.8,ignoreDef:true}} },
  tempest:{ id:'tempest', name:'TEMPEST', rarity:'R', role:'고기동 사격형 · 인터셉터',
    base:{hp:538,atk:101,def:55,spd:61,crit:0.16,eva:0.13}, grow:{hp:47.4,atk:11.1,def:5.1,spd:4.9}, spread:.21,
    skill:{name:'스톰 샷', desc:'0.95배 사격을 3회. 각각 치명타·회피 판정.',
           fx:{mult:0.95,hits:3}} },
  cobalt:{ id:'cobalt', name:'COBALT', rarity:'R', role:'중장 관통형 · 브레이커',
    base:{hp:658,atk:94,def:73,spd:50,crit:0.09,eva:0.08}, grow:{hp:55.7,atk:8.7,def:7.3,spd:3.8}, spread:.3,
    skill:{name:'코발트 브레이크', desc:'적 방어력을 60% 관통하는 1.85배 포격. 빗나가지 않음.',
           fx:{mult:1.85,ignoreDef:true,noMiss:true}} },
  specter:{ id:'specter', name:'SPECTER', rarity:'UQ', role:'원격 제압형 · 비트 마스터',
    base:{hp:603,atk:110,def:68,spd:64,crit:0.23,eva:0.17}, grow:{hp:43.4,atk:11,def:5.1,spd:4.9}, spread:.13,
    skill:{name:'팬텀 비트', desc:'0.65배 비트 사격 3회. 모두 확정 치명타(회피는 가능).',
           fx:{mult:0.65,hits:3,alwaysCrit:true}} },
  umbra:{ id:'umbra', name:'UMBRA', rarity:'UQ', role:'에너지 흡수형 · 블레이더',
    base:{hp:712,atk:108,def:81,spd:55,crit:0.14,eva:0.1}, grow:{hp:57.5,atk:9.2,def:7.5,spd:3.8}, spread:.23,
    skill:{name:'보이드 엣지', desc:'2.35배 참격. 준 피해의 35%만큼 체력을 흡수한다.',
           fx:{mult:2.35,drain:0.35}} },
  tyrant:{ id:'tyrant', name:'TYRANT', rarity:'EP', role:'전면 포격형 · 디스트로이어',
    base:{hp:831,atk:134,def:89,spd:70,crit:0.21,eva:0.12}, grow:{hp:46.7,atk:10.6,def:5.9,spd:4.3}, spread:.3,
    skill:{name:'헬파이어 살보', desc:'적 방어력을 60% 관통하는 1.1배 포격을 3회.',
           fx:{mult:1.1,hits:3,ignoreDef:true}} },
  atlas:{ id:'atlas', name:'ATLAS', rarity:'EP', role:'중장 돌파형 · 타이탄',
    base:{hp:950,atk:141,def:99,spd:66,crit:0.15,eva:0.13}, grow:{hp:60.5,atk:9.3,def:7,spd:4.3}, spread:.22,
    skill:{name:'타이탄 크러시', desc:'방어력 60% 관통 2.15배 강타. 빗나가지 않고 25%를 흡수한다.',
           fx:{mult:2.15,ignoreDef:true,noMiss:true,drain:0.25}} },
  /* ---- 세트 03: 3rd.png의 등급별 기체, 기존 등급 기준 무작위 고정 스펙 ---- */
  grit:{ id:'grit', name:'GRIT', rarity:'C', role:'전선 방어형 · 가드',
    base:{hp:497,atk:71,def:57,spd:46,crit:0.05,eva:0.04}, grow:{hp:57.1,atk:9,def:8,spd:3.7}, spread:.26,
    skill:{name:'브레이스 펀치', desc:'1.55배 강타. 빗나가지 않음.',
           fx:{mult:1.55,noMiss:true}} },
  chalk:{ id:'chalk', name:'CHALK', rarity:'C', role:'기동 타격형 · 러너',
    base:{hp:433,atk:74,def:44,spd:51,crit:0.09,eva:0.08}, grow:{hp:44.9,atk:11,def:5,spd:5.1}, spread:.21,
    skill:{name:'화이트 러시', desc:'0.9배 타격을 2회. 각각 치명타·회피 판정.',
           fx:{mult:0.9,hits:2}} },
  tracer:{ id:'tracer', name:'TRACER', rarity:'UC', role:'표적 추적형 · 트래커',
    base:{hp:461,atk:84,def:47,spd:57,crit:0.13,eva:0.09}, grow:{hp:43.7,atk:10.3,def:5.6,spd:5}, spread:.15,
    skill:{name:'트레이스 샷', desc:'적 방어력을 60% 관통하는 1.7배 사격.',
           fx:{mult:1.7,ignoreDef:true}} },
  mantis:{ id:'mantis', name:'MANTIS', rarity:'UC', role:'중장 압박형 · 인포서',
    base:{hp:608,atk:86,def:69,spd:48,crit:0.08,eva:0.04}, grow:{hp:56.9,atk:8.9,def:7.7,spd:3.9}, spread:.32,
    skill:{name:'프레셔 버스트', desc:'2.0배 집중 포격. 회피 불가.',
           fx:{mult:2,noMiss:true}} },
  howitzer:{ id:'howitzer', name:'HOWITZER', rarity:'R', role:'중장 포격형 · 시즈',
    base:{hp:671,atk:88,def:70,spd:50,crit:0.09,eva:0.08}, grow:{hp:58.4,atk:8.7,def:7.2,spd:3.8}, spread:.34,
    skill:{name:'시즈 캐논', desc:'적 방어력을 60% 관통하는 1.85배 포격. 빗나가지 않음.',
           fx:{mult:1.85,ignoreDef:true,noMiss:true}} },
  lancer:{ id:'lancer', name:'LANCER', rarity:'R', role:'고기동 돌파형 · 랜서',
    base:{hp:511,atk:99,def:60,spd:59,crit:0.16,eva:0.13}, grow:{hp:45.9,atk:11,def:5.9,spd:4.9}, spread:.22,
    skill:{name:'트리플 피어스', desc:'0.95배 찌르기를 3회. 각각 치명타·회피 판정.',
           fx:{mult:0.95,hits:3}} },
  hex:{ id:'hex', name:'HEX', rarity:'UQ', role:'전격 흡수형 · 워록',
    base:{hp:782,atk:106,def:87,spd:52,crit:0.13,eva:0.09}, grow:{hp:59,atk:9.3,def:7.5,spd:3.8}, spread:.26,
    skill:{name:'헥스 디스차지', desc:'2.3배 전격. 준 피해의 35%만큼 체력을 흡수한다.',
           fx:{mult:2.3,drain:0.35}} },
  halo:{ id:'halo', name:'HALO', rarity:'UQ', role:'정밀 제압형 · 컨덕터',
    base:{hp:597,atk:106,def:64,spd:63,crit:0.21,eva:0.16}, grow:{hp:48.9,atk:9.7,def:5.6,spd:4.9}, spread:.13,
    skill:{name:'오비탈 포커스', desc:'0.7배 사격 3회. 모두 확정 치명타(회피는 가능).',
           fx:{mult:0.7,hits:3,alwaysCrit:true}} },
  auric:{ id:'auric', name:'AURIC', rarity:'EP', role:'중장 강습형 · 골드 가디언',
    base:{hp:894,atk:130,def:101,spd:70,crit:0.15,eva:0.15}, grow:{hp:55,atk:8.9,def:6.7,spd:4.3}, spread:.2,
    skill:{name:'골든 임팩트', desc:'방어력 60% 관통 2.15배 강타. 빗나가지 않고 25%를 흡수한다.',
           fx:{mult:2.15,ignoreDef:true,noMiss:true,drain:0.25}} },
  ignis:{ id:'ignis', name:'IGNIS', rarity:'EP', role:'광익 포격형 · 피닉스',
    base:{hp:789,atk:139,def:88,spd:70,crit:0.21,eva:0.12}, grow:{hp:47.9,atk:10.6,def:6,spd:4.3}, spread:.29,
    skill:{name:'이그니스 레인', desc:'적 방어력을 60% 관통하는 1.1배 광익 사격을 3회.',
           fx:{mult:1.1,hits:3,ignoreDef:true}} },
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
  /* ---- 미래 보스 콘텐츠 ----
     전용 위험도 BOSS는 ROBOT_RARITY(C~EP)에 없으므로 현재 일반 매칭 풀에서 선택되지 않는다.
     향후 보스 진입/보상 UI가 직접 id를 선택할 때만 등장시킨다. */
  boss_bael_fortress:{ id:'boss_bael_fortress', name:'철혈성채 바알', rarity:'BOSS', role:'초중장 섬멸형 · 마왕성채',
    base:{hp:2686,atk:255,def:197,spd:94,crit:.22,eva:.06}, grow:{hp:75,atk:7.5,def:5.4,spd:2.1}, spread:.26,
    skill:{name:'종말의 일제사격', desc:'1.0배 포격을 3회. 방어력 60%를 관통하며 회피할 수 없다.',
           fx:{mult:1.0,hits:3,ignoreDef:true,noMiss:true}} },
  boss_astraea:{ id:'boss_astraea', name:'성극천사 아스트라이아', rarity:'BOSS', role:'초고기동 심판형 · 성역병기',
    base:{hp:1890,atk:232,def:178,spd:105,crit:.30,eva:.20}, grow:{hp:45.9,atk:7.2,def:3.6,spd:2.9}, spread:.15,
    skill:{name:'세라픽 저지먼트', desc:'0.65배 심판광을 3회. 방어력 60%를 관통하고 회피 불가·확정 치명타, 피해의 10%를 흡수한다.',
           fx:{mult:.65,hits:3,ignoreDef:true,noMiss:true,alwaysCrit:true,drain:.1}} },
  boss_nihil:{ id:'boss_nihil', name:'공허군주 니힐', rarity:'BOSS', role:'공간침식 연격형 · 공허핵',
    base:{hp:1691,atk:269,def:145,spd:105,crit:.38,eva:.32}, grow:{hp:37.3,atk:7.5,def:3.3,spd:3}, spread:.24,
    skill:{name:'이벤트 호라이즌', desc:'방어력 60%를 관통하는 0.85배 침식을 4회. 피해의 25%를 흡수한다.',
           fx:{mult:.85,hits:4,ignoreDef:true,drain:.25}} }
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
export const COST_ROLL = { spd:[2,6], def:[3,9], eva:[.012,.030], hp:[16,40], atk:[4,11], crit:[.012,.030] };
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
  HUNT: {
    C:    { costX: 1.0, lv:  -2, crX: 0.45, scX: 1.6, partP: 0.10, coreP: 0    },
    UC:   { costX: 1.4, lv:  -1, crX: 0.45, scX: 2.1, partP: 0.13, coreP: 0    },
    R:    { costX: 2.0, lv:   0, crX: 0.45, scX: 2.8, partP: 0.17, coreP: 0.05 },
    UQ:   { costX: 3.0, lv:   0, crX: 0.45, scX: 3.6, partP: 0.22, coreP: 0.10 },
    EP:   { costX: 4.5, lv:   0, crX: 0.45, scX: 4.6, partP: 0.28, coreP: 0.18 },
    /* 보스는 최종 벽이다. 성장치를 0.40 배로 낮춰 '언젠가는 잡히게' 만들어 두었다 —
       예전 값으로는 어떤 레벨에서도 승률 0% 라 잠긴 문이었다.
       실측: 에픽 Lv.60 42% · 에픽 Lv.45 24% · 유니크 Lv.60 0%. 에픽을 끝까지 키워야 열린다. */
    BOSS: { costX: 8.0, lv:   0, crX: 0.45, scX: 7.0, partP: 0.45, coreP: 0.35 },
  },
  /* 비상 출격 — 크레딧이 출격비보다 적을 때만 열린다.
     비용 0, 상대는 몬스터 고정, 보상은 크레딧만(파츠·코어·경험치 없음), 레이팅 변동 없음.
     막힌 판을 만들지 않기 위한 구제 장치라 일부러 맛이 없다. 피로도는 정상으로 쌓인다. */
  RESCUE: { crWin: 90, crLose: 45 },
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
  PART_LV: { C: 3, R: 6, SR: 14, SSR: 22 },
  PART_ENH_LV: 0.10,      // 강화 1당 파츠 가치 배수 증가분

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
  MAXLV: 60,          // 최대 레벨
  PULL_COST: 1,       // 뽑기 1회에 드는 코어
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
     파츠의 52%가 일반 등급이라 잡템이 금방 쌓인다. 값을 {} 로 비우면 기능이 꺼진다.
     (기체 등급 C/UC/… 가 아니라 파츠 등급 C/R/SR/SSR 이다) */
  AUTO_SCRAP: { C: 14 },
};
