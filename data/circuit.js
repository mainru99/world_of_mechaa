/* 코어 서킷 — 기체별 별자리 특성 (2026-09-23 · Claude 시안 · 사용자가 맡김)
 *
 * GPT 계획서(docs/balance/mech-traits-plan-2026-09-22.md)의 '기체마다 6노드' 를 사용자 지시로 바꿨다.
 *   - 판을 키운다 — 기체마다 **별자리 4갈래 × 작은 별 8 = 32** + 갈래 끝 **전문 별 4**(잠긴 채 보인다)
 *   - 별 하나 = 특성 포인트 1(js/stats.js traitPoints — Lv.60 에 20). 32 개 중 20 개만 찍는다
 *   - 별에는 **+ 와 - 가 섞인다**(갈래가 깊어질수록 뾰족해진다)
 *   - 갈래의 효과 종류는 **기체마다 다르다** — 그 기체의 능력치 · 스킬에서 고른다(js/circuit.js themesOf)
 *
 * 값은 **가격표**다 — 효과마다 '같은 기체 0점을 60% 로 이기는 크기' 를 실측해(tools/circuitfit.mjs)
 * 그 1/20 을 포인트 1 의 값(u)으로 삼았다. 그래서 어느 효과를 찍든 포인트 하나의 값어치가 같고,
 * 20 점을 다 찍으면 0점 상대로 대략 60%(레벨 한 칸이 64%)다. 크기를 바꾸려면 scale 하나만 만진다.
 *
 * 전투에는 아직 안 붙어 있다 — 저장 칸 · 화면이 없다(화면은 UI 개편 몫). 이 파일은 balanceVersion 에 들어가지 않는다.
 */
export const CIRCUIT = {
  branches: 4,
  stars: 8,
  scale: 1,
  /* 포인트 1 의 값 — 2026-09-23 실측(Lv.60 맨몸 · 뽑기 76종 · 60% 크기 ÷ 20).
     비율 효과는 곱(×(1+v)), 치명 · 회피 · 관통 · 재생은 더하기(절대값), accel 은 공격할 때마다 속도 +v(5번까지) */
  unit: {
    hp: .0020, atk: .0020, def: .00245, spd: .0018,
    crit: .0040, eva: .00214,
    skill: .0050, pen: .0035, regen: .00282, accel: .00044,
  },
  /* 0 밑으로 깎을 수 없는 효과 — 올리는 쪽에만 쓴다(기본값이 0 이라 깎으면 벌이 공짜가 된다) */
  upOnly: ['pen', 'regen', 'accel'],
  /* 별의 모양. main 은 주 효과, neg 는 깎는 효과, side 는 곁 효과 — 단위는 u 의 배수.
     어느 모양이든 값어치 합은 1u 다(3 - 2 = 1). 그래서 모양은 세기가 아니라 '얼마나 뾰족한가' 다 */
  kinds: {
    a: { main: 1 },
    b: { main: 2, neg: 1 },
    x: { main: .5, side: .5 },
    c: { main: 3, neg: 2 },
  },
  /* 갈래 안의 순서 — 안쪽은 무난하고 바깥으로 갈수록 뾰족하다 */
  pattern: ['a', 'a', 'b', 'x', 'b', 'c', 'b', 'c'],
};

/* 갈래의 종류. main 을 올리고 neg 를 깎고 side 를 곁들인다.
   notable 은 갈래 끝 전문 별 — **조건부 효과라 전투 엔진에 새로 넣어야 한다. 그때까지 잠겨 있다.** {skill} 은 그 기체의 스킬 이름 */
export const CIRCUIT_THEMES = {
  armor:     { ko: '적층 장갑',   main: 'hp',    neg: 'spd',  side: 'def',   notable: '내구 50% 이하일 때 받는 피해 감소' },
  fortress:  { ko: '요새화',      main: 'def',   neg: 'spd',  side: 'hp',    notable: '받는 스킬 피해 감소' },
  absorb:    { ko: '충격 흡수',   main: 'def',   neg: 'eva',  side: 'hp',    notable: '치명타로 받는 추가 피해 감소' },
  overdrive: { ko: '과출력',      main: 'atk',   neg: 'def',  side: 'crit',  notable: '평타 피해 증가' },
  heavy:     { ko: '중량 타격',   main: 'atk',   neg: 'spd',  side: 'hp',    notable: '전투 첫 공격 피해 증가' },
  light:     { ko: '경량 프레임', main: 'spd',   neg: 'hp',   side: 'eva',   notable: '전투 시작 게이지 선충전' },
  accel:     { ko: '가속 회로',   main: 'accel', neg: 'hp',   side: 'spd',   notable: '가속이 다 차면 치명 확률 증가' },
  aim:       { ko: '조준 보정',   main: 'crit',  neg: 'eva',  side: 'atk',   notable: '치명타의 추가 피해 증가' },
  target:    { ko: '표적 연산',   main: 'crit',  neg: 'def',  side: 'pen',   notable: '같은 상대를 연속으로 치면 피해 증가' },
  evade:     { ko: '회피 기동',   main: 'eva',   neg: 'def',  side: 'spd',   notable: '회피한 직후 반격 사격' },
  regen:     { ko: '재생 장갑',   main: 'regen', neg: 'atk',  side: 'eva',   notable: '재생량이 내구가 낮을수록 커진다' },
  amp:       { ko: '스킬 증폭',   main: 'skill', neg: 'atk',  side: 'spd',   notable: '{skill} — 첫 타에 방어 관통' },
  cool:      { ko: '냉각 코어',   main: 'skill', neg: 'hp',   side: 'def',   notable: '{skill} 사용 뒤 받는 피해 감소' },
  pierce:    { ko: '관통탄',      main: 'pen',   neg: 'crit', side: 'atk',   notable: '관통한 타격이 방어를 잠시 깎는다' },
};

/* 기체별로 손으로 고정한 갈래(없으면 js/circuit.js 가 능력치 · 스킬로 고른다). 순서가 A B C D 다 */
export const CIRCUIT_PICK = {};

/* 기체마다 갈래 14종의 값어치 배수 { 갈래: 배수 } — tools/circuitfit.mjs --write 가 쓴다. 손으로 고치지 않는다.
   가격표(unit)는 76종 평균이라 같은 갈래도 기체마다 값어치가 다르다(재생 장갑은 회피가 높은 기체에게만 쓸모 있다).
   배수는 **그 기체의 14종 중앙값으로 나눈 값**이다 — 기체 사이의 크기는 가격표 하나로 같고, 기체 안의 갈래끼리만 맞춘다.
   (같은 기체끼리 붙이는 측정은 탱커일수록 판이 길어 작은 차이가 크게 번진다. 그걸 기체 사이 비교에 쓰면 탱커가 특성을 못 받는다)
   배수가 js/circuit.js FIT_BAND(0.5 ~ 2.0) 밖인 갈래는 그 기체에게 고르지 않는다. 없으면 1 이다 */
export const CIRCUIT_FIT = {
  mule: { armor: 0.73, fortress: 0.35, absorb: 0.72, overdrive: 1.28, heavy: 1.12, light: 1.54, accel: 0.88, aim: 0.75, target: 0.68, evade: 2.74, regen: 14.07, amp: 1.54, cool: 1.39, pierce: 0.55 },
  dune: { armor: 1.01, fortress: 1.73, absorb: 0.72, overdrive: 1.06, heavy: 0.66, light: 0.85, accel: 1.12, aim: 1.59, target: 5.28, evade: 0.89, regen: 5.28, amp: 0.99, cool: 0.99, pierce: 0.32 },
  ranger: { armor: 1.55, fortress: 2.39, absorb: 0.95, overdrive: 0.67, heavy: 0.68, light: 0.45, accel: 4.16, aim: 1.62, target: 4.16, evade: 1.05, regen: 4.16, amp: 0.56, cool: 0.65, pierce: 0.65 },
  vanguard: { armor: 0.8, fortress: 1.04, absorb: 0.81, overdrive: 1.21, heavy: 1.29, light: 0.85, accel: 0.77, aim: 0.68, target: 0.96, evade: 2.8, regen: 4.81, amp: 1.21, cool: 1.21, pierce: 0.6 },
  azure: { armor: 2.22, fortress: 2.1, absorb: 0.71, overdrive: 0.73, heavy: 1.04, light: 4.81, accel: 4.81, aim: 3.01, target: 4.81, evade: 0.7, regen: 0.96, amp: 0.5, cool: 0.48, pierce: 0.3 },
  glacier: { armor: 0.99, fortress: 0.87, absorb: 0.63, overdrive: 1.62, heavy: 0.95, light: 0.8, accel: 1.15, aim: 1.08, target: 1.01, evade: 6.28, regen: 1.27, amp: 0.79, cool: 0.84, pierce: 2.72 },
  wraith: { armor: 4.41, fortress: 1.21, absorb: 1.21, overdrive: 1.24, heavy: 0.99, light: 1.19, accel: 0.88, aim: 1.63, target: 1.01, evade: 0.76, regen: 0.24, amp: 0.68, cool: 0.66, pierce: 0.96 },
  oracle: { armor: 0.98, fortress: 0.53, absorb: 0.68, overdrive: 0.95, heavy: 0.79, light: 1.34, accel: 1.13, aim: 1.34, target: 8.56, evade: 2.36, regen: 0.8, amp: 1.36, cool: 1.02, pierce: 0.72 },
  seraph: { armor: 1.06, fortress: 0.74, absorb: 0.62, overdrive: 1.21, heavy: 1.95, light: 0.62, accel: 0.63, aim: 0.94, target: 1.25, evade: 4.94, regen: 4.94, amp: 0.4, cool: 0.4, pierce: 3.14 },
  nemesis: { armor: 1.53, fortress: 1.53, absorb: 0.61, overdrive: 0.61, heavy: 0.35, light: 1.53, accel: 1.53, aim: 0.38, target: 1.53, evade: 0.31, regen: 1.53, amp: 0.35, cool: 0.27, pierce: 1.39 },
  rust: { armor: 0.96, fortress: 1.09, absorb: 1.01, overdrive: 1.01, heavy: 1.04, light: 0.61, accel: 0.76, aim: 0.99, target: 0.81, evade: 0.79, regen: 4.91, amp: 2.03, cool: 1.21, pierce: 0.68 },
  scarab: { armor: 0.66, fortress: 0.92, absorb: 1.03, overdrive: 0.96, heavy: 1.09, light: 2.03, accel: 1.07, aim: 0.97, target: 1.09, evade: 0.85, regen: 6.84, amp: 0.89, cool: 0.56, pierce: 1.09 },
  bastion: { armor: 1.03, fortress: 0.82, absorb: 0.88, overdrive: 0.83, heavy: 1.26, light: 1.5, accel: 0.9, aim: 0.76, target: 1.12, evade: 3.03, regen: 13.28, amp: 1.04, cool: 0.97, pierce: 0.74 },
  kestrel: { armor: 3.26, fortress: 3.26, absorb: 0.77, overdrive: 0.49, heavy: 0.57, light: 3.26, accel: 3.26, aim: 0.57, target: 0.57, evade: 1.23, regen: 3.26, amp: 0.38, cool: 0.51, pierce: 1.47 },
  tempest: { armor: 1.11, fortress: 1.14, absorb: 1.3, overdrive: 1.09, heavy: 1.35, light: 1, accel: 0.97, aim: 1, target: 0.73, evade: 0.69, regen: 0.27, amp: 1.06, cool: 0.82, pierce: 0.73 },
  cobalt: { armor: 0.38, fortress: 0.63, absorb: 0.34, overdrive: 1.31, heavy: 2.75, light: 0.69, accel: 0.9, aim: 0.59, target: 1.1, evade: 1.75, regen: 2.75, amp: 0.26, cool: 1.39, pierce: 1.37 },
  specter: { armor: 1.08, fortress: 1.13, absorb: 1.79, overdrive: 0.92, heavy: 0.74, light: 1.18, accel: 1.25, aim: 4.21, target: 4.21, evade: 0.37, regen: 0.19, amp: 0.65, cool: 0.73, pierce: 0.6 },
  umbra: { armor: 5.3, fortress: 0.91, absorb: 0.83, overdrive: 1.32, heavy: 1.14, light: 0.83, accel: 0.83, aim: 1.5, target: 5.3, evade: 0.92, regen: 1.08, amp: 0.92, cool: 0.66, pierce: 2.09 },
  tyrant: { armor: 1.1, fortress: 0.99, absorb: 0.92, overdrive: 1.53, heavy: 3.1, light: 0.47, accel: 0.76, aim: 1.01, target: 1.27, evade: 5.97, regen: 0.32, amp: 0.66, cool: 1.51, pierce: 0.84 },
  atlas: { armor: 1.14, fortress: 1.29, absorb: 0.56, overdrive: 1.15, heavy: 2.17, light: 0.31, accel: 0.26, aim: 0.77, target: 0.86, evade: 4.83, regen: 4.83, amp: 0.54, cool: 0.5, pierce: 3.5 },
  grit: { armor: 0.77, fortress: 0.8, absorb: 0.64, overdrive: 0.92, heavy: 0.91, light: 2.36, accel: 1.2, aim: 0.77, target: 0.99, evade: 2.32, regen: 7.63, amp: 1.01, cool: 1.29, pierce: 1.08 },
  chalk: { armor: 0.88, fortress: 0.84, absorb: 1.08, overdrive: 1.23, heavy: 0.74, light: 1.62, accel: 1.36, aim: 0.92, target: 1.08, evade: 0.7, regen: 0.39, amp: 1.23, cool: 1.11, pierce: 0.72 },
  tracer: { armor: 0.67, fortress: 0.96, absorb: 0.88, overdrive: 1.18, heavy: 0.82, light: 1.04, accel: 1.38, aim: 0.63, target: 1.21, evade: 1.6, regen: 0.38, amp: 1.2, cool: 1.72, pierce: 0.81 },
  mantis: { armor: 1.29, fortress: 1.04, absorb: 0.54, overdrive: 0.84, heavy: 0.68, light: 1.78, accel: 0.96, aim: 0.69, target: 0.74, evade: 2.3, regen: 6.84, amp: 1.09, cool: 0.93, pierce: 1.04 },
  howitzer: { armor: 0.98, fortress: 1.01, absorb: 0.99, overdrive: 1.05, heavy: 2.8, light: 0.74, accel: 0.86, aim: 0.99, target: 0.94, evade: 0.8, regen: 3.08, amp: 1.23, cool: 1.25, pierce: 1.29 },
  lancer: { armor: 1.12, fortress: 1.19, absorb: 1.66, overdrive: 1.04, heavy: 1.01, light: 0.41, accel: 0.39, aim: 0.52, target: 0.59, evade: 0.49, regen: 0.99, amp: 1.04, cool: 0.83, pierce: 1.01 },
  hex: { armor: 1.49, fortress: 0.99, absorb: 1.27, overdrive: 0.5, heavy: 1.05, light: 0.91, accel: 0.39, aim: 0.5, target: 3.17, evade: 0.62, regen: 3.17, amp: 1.04, cool: 0.77, pierce: 1.01 },
  halo: { armor: 1.59, fortress: 2.36, absorb: 1.16, overdrive: 0.61, heavy: 1.66, light: 0.19, accel: 0.27, aim: 0.46, target: 0.52, evade: 1.48, regen: 2.36, amp: 0.84, cool: 0.52, pierce: 1.84 },
  auric: { armor: 0.95, fortress: 0.92, absorb: 0.68, overdrive: 1.67, heavy: 1.05, light: 1.44, accel: 1.13, aim: 2.84, target: 9.19, evade: 3.79, regen: 0.92, amp: 0.88, cool: 0.81, pierce: 0.56 },
  ignis: { armor: 2.75, fortress: 3.41, absorb: 1.19, overdrive: 0.74, heavy: 0.71, light: 4.55, accel: 4.72, aim: 4.72, target: 4.72, evade: 0.75, regen: 0.81, amp: 0.55, cool: 0.6, pierce: 0.74 },
  husk: { armor: 0.86, fortress: 0.65, absorb: 1.01, overdrive: 1.11, heavy: 0.99, light: 1.21, accel: 1.05, aim: 0.6, target: 0.69, evade: 0.58, regen: 1.98, amp: 1.95, cool: 9.89, pierce: 0.62 },
  mortar: { armor: 2.06, fortress: 1.68, absorb: 1.01, overdrive: 0.9, heavy: 1.31, light: 0.65, accel: 0.75, aim: 0.75, target: 0.99, evade: 0.7, regen: 4.91, amp: 2.09, cool: 1.22, pierce: 0.99 },
  lens: { armor: 0.89, fortress: 0.49, absorb: 0.77, overdrive: 1.11, heavy: 0.54, light: 1.18, accel: 0.87, aim: 0.46, target: 1.11, evade: 1.98, regen: 5.56, amp: 1.55, cool: 5.56, pierce: 0.85 },
  static: { armor: 1.44, fortress: 1.74, absorb: 1.29, overdrive: 0.98, heavy: 1.6, light: 0.99, accel: 0.92, aim: 0.82, target: 0.9, evade: 0.82, regen: 0.7, amp: 7.96, cool: 7.96, pierce: 1.01 },
  swift: { armor: 0.82, fortress: 1.07, absorb: 1.4, overdrive: 1.05, heavy: 1.74, light: 0.95, accel: 0.68, aim: 0.86, target: 1.23, evade: 0.66, regen: 0.92, amp: 0.68, cool: 2.16, pierce: 1.16 },
  shrike: { armor: 0.89, fortress: 0.74, absorb: 1.47, overdrive: 1.11, heavy: 2.26, light: 0.82, accel: 0.86, aim: 1.22, target: 0.82, evade: 0.62, regen: 0.79, amp: 1.42, cool: 1.51, pierce: 1.42 },
  patch: { armor: 0.77, fortress: 0.94, absorb: 0.88, overdrive: 1.33, heavy: 0.63, light: 1.31, accel: 1.09, aim: 0.75, target: 0.64, evade: 0.78, regen: 1.68, amp: 2.66, cool: 2.05, pierce: 1.06 },
  vega: { armor: 0.93, fortress: 0.97, absorb: 0.34, overdrive: 0.45, heavy: 1.07, light: 2.19, accel: 2.19, aim: 0.35, target: 0.47, evade: 1.14, regen: 2.19, amp: 1.03, cool: 2.19, pierce: 0.56 },
  orbit: { armor: 0.99, fortress: 1.1, absorb: 0.73, overdrive: 1.16, heavy: 1.98, light: 0.42, accel: 0.5, aim: 0.48, target: 0.64, evade: 2.43, regen: 5.1, amp: 0.8, cool: 1.01, pierce: 1.02 },
  zealot: { armor: 2.06, fortress: 2.15, absorb: 1.19, overdrive: 0.92, heavy: 1.81, light: 0.58, accel: 0.63, aim: 1.08, target: 0.69, evade: 0.58, regen: 0.47, amp: 1.89, cool: 5.87, pierce: 0.81 },
  nebula: { armor: 0.96, fortress: 0.9, absorb: 0.99, overdrive: 1.15, heavy: 0.91, light: 1.32, accel: 1.05, aim: 1.31, target: 0.79, evade: 1.01, regen: 0.3, amp: 1.18, cool: 1.64, pierce: 0.59 },
  sovereign: { armor: 0.78, fortress: 0.82, absorb: 0.98, overdrive: 1.2, heavy: 3.03, light: 0.86, accel: 0.95, aim: 3.03, target: 3.03, evade: 0.48, regen: 3.03, amp: 0.48, cool: 1.02, pierce: 1.21 },
  behemoth: { armor: 0.51, fortress: 0.77, absorb: 0.96, overdrive: 1.06, heavy: 1.04, light: 1.86, accel: 1.68, aim: 1.04, target: 0.82, evade: 1.04, regen: 0.32, amp: 0.68, cool: 0.74, pierce: 2.21 },
  pike: { armor: 1.53, fortress: 2.5, absorb: 1.01, overdrive: 0.69, heavy: 0.95, light: 0.68, accel: 4.95, aim: 0.76, target: 0.8, evade: 0.78, regen: 4.95, amp: 1.04, cool: 0.99, pierce: 1.98 },
  quake: { armor: 0.8, fortress: 1.08, absorb: 1.07, overdrive: 0.95, heavy: 0.81, light: 1.11, accel: 1.02, aim: 0.98, target: 0.86, evade: 0.52, regen: 5.24, amp: 1.72, cool: 1.77, pierce: 0.8 },
  cipher: { armor: 1.37, fortress: 1.06, absorb: 1.04, overdrive: 1.06, heavy: 0.85, light: 0.88, accel: 0.55, aim: 1.04, target: 0.67, evade: 0.69, regen: 0.34, amp: 5.51, cool: 5.51, pierce: 0.96 },
  aegis: { armor: 0.73, fortress: 0.95, absorb: 1.02, overdrive: 1.02, heavy: 1.36, light: 1.46, accel: 1.67, aim: 0.75, target: 0.96, evade: 0.95, regen: 0.78, amp: 2.61, cool: 2.1, pierce: 0.98 },
  zephyr: { armor: 1.01, fortress: 0.9, absorb: 1.41, overdrive: 1.11, heavy: 0.57, light: 1.39, accel: 1.5, aim: 1.11, target: 0.99, evade: 0.65, regen: 0.34, amp: 0.81, cool: 1.15, pierce: 0.93 },
  longbow: { armor: 1.34, fortress: 1.51, absorb: 1.29, overdrive: 0.63, heavy: 0.8, light: 1.02, accel: 4.05, aim: 0.77, target: 0.98, evade: 0.68, regen: 4.05, amp: 0.68, cool: 0.61, pierce: 1.2 },
  anvil: { armor: 0.64, fortress: 1.03, absorb: 0.96, overdrive: 0.64, heavy: 1.06, light: 1.83, accel: 1.09, aim: 0.89, target: 0.92, evade: 0.97, regen: 10.24, amp: 2.31, cool: 1.52, pierce: 0.59 },
  verdict: { armor: 0.57, fortress: 0.6, absorb: 1.11, overdrive: 0.96, heavy: 0.68, light: 2.59, accel: 1.97, aim: 1.09, target: 1.11, evade: 1.03, regen: 6.46, amp: 0.6, cool: 0.92, pierce: 0.97 },
  polaris: { armor: 1.02, fortress: 1.98, absorb: 0.83, overdrive: 0.98, heavy: 0.57, light: 1.34, accel: 4.1, aim: 1.79, target: 4.1, evade: 0.79, regen: 4.1, amp: 0.69, cool: 0.7, pierce: 0.64 },
  vesper: { armor: 1.43, fortress: 1.15, absorb: 1.29, overdrive: 1.29, heavy: 1.29, light: 0.83, accel: 0.83, aim: 0.91, target: 1.09, evade: 0.88, regen: 0.57, amp: 1.27, cool: 0.78, pierce: 0.89 },
  salvo: { armor: 0.67, fortress: 0.72, absorb: 1.07, overdrive: 1.41, heavy: 3.3, light: 1.04, accel: 0.92, aim: 1.35, target: 1.17, evade: 0.93, regen: 5.84, amp: 0.93, cool: 0.82, pierce: 0.96 },
  sentry: { armor: 0.59, fortress: 0.86, absorb: 0.78, overdrive: 1.1, heavy: 1.34, light: 1.13, accel: 0.83, aim: 0.63, target: 0.79, evade: 1.53, regen: 5.31, amp: 1.05, cool: 1.79, pierce: 0.95 },
  osprey: { armor: 0.52, fortress: 0.65, absorb: 0.48, overdrive: 1.14, heavy: 1.77, light: 0.21, accel: 0.32, aim: 1.01, target: 1.77, evade: 0.73, regen: 1.77, amp: 1.77, cool: 1.77, pierce: 0.99 },
  aquila: { armor: 1.44, fortress: 1.67, absorb: 1.3, overdrive: 1.49, heavy: 1.23, light: 0.62, accel: 4.95, aim: 0.94, target: 1.04, evade: 0.71, regen: 0.5, amp: 0.96, cool: 0.78, pierce: 0.92 },
  paladin: { armor: 0.77, fortress: 0.68, absorb: 1.11, overdrive: 0.91, heavy: 1.11, light: 2.46, accel: 1.25, aim: 0.99, target: 1.01, evade: 0.77, regen: 0.59, amp: 2.19, cool: 1.44, pierce: 0.68 },
  auger: { armor: 1.95, fortress: 2.39, absorb: 1.07, overdrive: 0.77, heavy: 1.05, light: 0.73, accel: 1.05, aim: 0.52, target: 0.52, evade: 0.68, regen: 3.71, amp: 0.79, cool: 0.96, pierce: 1.04 },
  halberd: { armor: 0.42, fortress: 0.69, absorb: 0.67, overdrive: 1.08, heavy: 2.73, light: 0.62, accel: 0.92, aim: 2.73, target: 2.73, evade: 0.49, regen: 2.73, amp: 0.52, cool: 2.73, pierce: 1.46 },
  quasar: { armor: 1.94, fortress: 2.03, absorb: 1.01, overdrive: 0.76, heavy: 1.45, light: 0.52, accel: 0.55, aim: 0.93, target: 4.91, evade: 0.99, regen: 0.78, amp: 4.91, cool: 4.91, pierce: 0.76 },
  gyre: { armor: 1.19, fortress: 0.94, absorb: 1.07, overdrive: 0.96, heavy: 0.99, light: 1.01, accel: 1.73, aim: 0.85, target: 1.04, evade: 0.76, regen: 6.85, amp: 0.85, cool: 0.74, pierce: 1.03 },
  ronin: { armor: 1.04, fortress: 1.1, absorb: 1.1, overdrive: 0.61, heavy: 1.08, light: 0.18, accel: 0.29, aim: 0.96, target: 1.83, evade: 0.4, regen: 1.83, amp: 1.1, cool: 0.66, pierce: 0.45 },
  nimbus_c: { armor: 2.47, fortress: 3.11, absorb: 0.91, overdrive: 0.85, heavy: 0.53, light: 0.85, accel: 5.42, aim: 0.7, target: 1.09, evade: 2.98, regen: 5.42, amp: 0.66, cool: 0.64, pierce: 2.33 },
  nimbus_f: { armor: 1.36, fortress: 1.01, absorb: 0.91, overdrive: 0.91, heavy: 0.77, light: 1.15, accel: 2.07, aim: 0.71, target: 1.07, evade: 1.04, regen: 0.95, amp: 0.99, cool: 1.31, pierce: 0.86 },
  goliath_s: { armor: 1.63, fortress: 2.27, absorb: 1.3, overdrive: 0.96, heavy: 0.99, light: 0.89, accel: 0.92, aim: 0.83, target: 1.01, evade: 0.56, regen: 5.68, amp: 1.22, cool: 1.3, pierce: 0.63 },
  goliath_r: { armor: 0.75, fortress: 0.98, absorb: 0.82, overdrive: 1.49, heavy: 2.13, light: 0.86, accel: 1.02, aim: 1.16, target: 1.11, evade: 0.86, regen: 4.81, amp: 0.73, cool: 0.95, pierce: 1.44 },
  goliath_c: { armor: 0.89, fortress: 0.66, absorb: 0.94, overdrive: 1.35, heavy: 0.53, light: 1.29, accel: 1.06, aim: 1.35, target: 0.74, evade: 0.84, regen: 8.48, amp: 2.7, cool: 2.27, pierce: 0.9 },
  goliath_v: { armor: 2.07, fortress: 0.71, absorb: 0.75, overdrive: 0.94, heavy: 0.98, light: 1.08, accel: 1.29, aim: 1.02, target: 1.05, evade: 0.88, regen: 6.41, amp: 1.02, cool: 0.91, pierce: 0.5 },
  hydra_s: { armor: 0.73, fortress: 0.57, absorb: 0.65, overdrive: 0.77, heavy: 4.91, light: 1.28, accel: 1.73, aim: 0.61, target: 1.21, evade: 3.21, regen: 4.91, amp: 0.59, cool: 0.79, pierce: 2.48 },
  hydra_g: { armor: 2.51, fortress: 1.86, absorb: 1.03, overdrive: 1.28, heavy: 0.99, light: 1, accel: 1, aim: 0.62, target: 1, evade: 1, regen: 1.56, amp: 0.99, cool: 0.93, pierce: 0.9 },
  solaris: { armor: 0.62, fortress: 0.62, absorb: 0.95, overdrive: 2.46, heavy: 3.87, light: 0.9, accel: 1.05, aim: 3.87, target: 3.87, evade: 0.47, regen: 3.87, amp: 0.63, cool: 0.6, pierce: 2.25 },
  monarch: { armor: 1.94, fortress: 2.23, absorb: 1.41, overdrive: 0.63, heavy: 0.74, light: 2.23, accel: 2.23, aim: 0.44, target: 0.45, evade: 0.73, regen: 2.23, amp: 0.32, cool: 0.35, pierce: 1.26 },
  lionheart: { armor: 0.9, fortress: 1.13, absorb: 0.83, overdrive: 1.05, heavy: 0.47, light: 14.16, accel: 2.39, aim: 1.15, target: 0.95, evade: 0.35, regen: 0.57, amp: 1.82, cool: 2.49, pierce: 0.63 },
  shogun: { armor: 0.83, fortress: 1.01, absorb: 1.03, overdrive: 0.58, heavy: 1.43, light: 0.22, accel: 0.19, aim: 1.55, target: 1.55, evade: 0.33, regen: 1.55, amp: 1, cool: 0.49, pierce: 1 },
  revenant: { armor: 1.63, fortress: 1.22, absorb: 1.13, overdrive: 1.09, heavy: 2.08, light: 0.38, accel: 0.5, aim: 3.62, target: 3.62, evade: 0.42, regen: 0.21, amp: 0.76, cool: 0.68, pierce: 0.91 },
};
