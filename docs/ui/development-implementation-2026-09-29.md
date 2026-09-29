# 후속 UI 2차 — 개발 목표 · 계보 · 숙련 조각

## 브랜치와 범위

사용자 “다음 작업도 시작하자”, 도중 “다시시작”에 따라 이어서 완성했다. 위치는 `C:\Users\DESKTOP-896744\Documents\New project\rowar-ui-integration`, 브랜치는 `codex/ui-integration`이다. 출발 체크포인트는 `2fd1f61`, 통합 기준 main은 `ab45b4c`다. GPT가 프론트를 담당하고 Claude의 서버 판정/DB/공유 규칙을 그대로 사용한다. 운영 main, 원래 UI 브랜치, 원격 DB, 운영 배포는 변경하지 않았다. 완성 소스·검수·기록을 이 통합 브랜치에만 커밋/푸시한다.

참고: `AGENTS.md`, `CONTRACT.md`, `IMPLEMENTATION.md`, UI 개편 계획, `Downloads/rowar_ui_rebuild/hangar.png`, 계보 승인 초안 `docs/balance/lineage-draft-2026-09-23.html`, handoff23·25·28, 실제 `data/lineage.js`/`js/lineage.js`/`js/mastery.js`/`server/state.js`/`server/shop.js`. 초안의 등급별 배치 순서를 사용하지만 연결/보유 판정/조각 수는 현행 공용 모듈이 결정한다. 초안의 과거 연결 수·잠정 보상 문구·NEW 표시는 가져오지 않았다. 현행 76기, 96개 선행 연결, 5개 표준형 분화다.

이 묶음은 개발 UI의 완료 기록이다. 조각 합성·일일 회수·귀속·운영 반영까지 완료한 것은 아니다. `CONST.LINEAGE.gate=false`, `CONST.PART_BIND.on=false` 유지. 서버/DB/밸런스/공유 판정/기체 아트 변경 없음.

## 실제 사용자 흐름

- 격납고의 기체 관리 영역과 뽑기 → 조각 보관함에 현재 개발 목표·등급·조각 진행률을 표시한다. **개발 계보**로 상세를 연다. 선봉이나 편성을 바꾸지 않는다.
- PC 기본은 다섯 등급 열의 계보도, 모바일 기본은 기체 목록이다. 모두 기체 검색, 목표 선택 가능/보유/선행 조건/뽑기 입구 필터, 두 표시 방식 전환을 지원한다. 지도 필터는 해당 노드를 강조하고 목록 필터는 결과만 보여 준다.
- 지도는 내부에서 상하좌우로 이동한다. 선택한 기체의 조상·자손·관련 분화 연결을 강조한다. 열 제목은 세로 이동 중 고정된다. 목표와 가까운 선행 기체가 한 화면에 들어가면 함께 배치하며, 팝업 전체를 임의로 아래로 뛰게 하지 않는다. 큰 계보가 화면 밖으로 나갈 경우 지도 내부로만 스크롤한다.
- 상세에는 원본 정지 PNG, 역할/스킬, 조각 수, 필요한 선행 기체와 연결 이유/표준형 분화/다음 개발 경로를 표시한다. 여러 부모는 **모두** 필요하다. 아종은 표준형이 필요하다. 미보유 C 기체도 목표로 선택할 수 있다. 보유 기체·스토리 기체·뽑기 입구(ORBIT/SWIFT)는 목표로 선택하지 않는다.
- 목표는 계정당 하나이며 선택 버튼을 눌러 저장한다. 이전 목표의 조각은 남는다. 조립은 기존 보관함에서 진행한다. 현재 계보 제한이 꺼져 있다는 점과 **개발 목표 선택의 선행 조건**을 별도로 설명해 기존 조립을 잘못 막지 않는다.
- 격납고에서는 살펴보는 UID의 다음 조각 레벨을 표시한다. 계보에는 보유 UID별 성장 목록을 제공한다. 현재 규칙은 5레벨마다 1개, Lv.60에 보너스 2개(59→60은 +3)다. 누적 `shardsAt(level)`을 이번에 지급한 보상으로 오해해 표시하지 않는다.
- 즉시 레벨업/온라인 일반·교대·합동 전투/전선/점령에서 실제 레벨이 오른 뒤 서버 상태로 정산한다. 신규 기체 획득/조립 뒤에도 서버의 유효한 목표를 확인한다. 전투 결과에는 GET이 돌려준 실제 `got/grants`를 붙이고, 확인 실패 시 재조회 안내를 표시한다. 로컬 전선에는 서버 보상 조회를 붙이지 않는다.

## 파일과 계약

| 파일 | 책임 |
|---|---|
| `js/ui/development-graph.js` | 승인된 열 순서, 현행 기체·연결을 사용하는 지도 배치/강조/내부 스크롤 UI |
| `js/ui/development-view.js` | 목표 카드, 상세/목록/보유 조건, 순수 다음 조각 안내, 서버 보상 표시 |
| `js/ui/development-manager.js` | 계정/상태 소유자별 metadata, 목표 변경과 조회 잠금, 늦은 응답/팝업 이동 격리 |
| `themes/development-v2.css` | 시안 계열의 남색 강철 프레임/적색 버튼, PC 지도·모바일 목록/상세, 44px 이상 주요 조작 |
| `js/game.js` | 격납고/보관함/결과 진입, UID/실제 레벨 변동 시 정산, 다른 쓰기와 상호 잠금 |
| `js/net.js` | 기존 API의 `growthState()` GET, `setDevelopmentGoal(type)` POST. 새 서버 경로 없음 |
| `js/ui/modal.js`, `index.html`, `js/ui/common.js` | 넓은 native 모달, theme 로드, 개발 목표/계보 안내 |
| `js/ui/circuit-manager.js` | 기존 실패 후 전체 state 재조회 시 개발 metadata도 전달하는 optional 콜백 |
| `tools/development-ui-check.mjs` | 지도/판정·요청 순서·중복·계정/늦은 응답·실패/부분 상태 검수 |
| `tools/development-api-check.mjs` | 새 임시 게스트만 쓰는 loopback 실제 API 검수 |

### 목표 저장의 중요한 순서

1. 현재 계정/상태 객체와 선택한 type을 캡처하고 잠근다. 다른 목표 저장, 재화 쓰기, 격납고 쓰기가 겹치지 않게 한다.
2. GET `/api/state`의 숙련 정산을 먼저 받는다. 이미 오른 레벨의 조각을 **이전 목표**에 정산하기 위해 필요하다. 실패하거나 조회 중 로컬 items/UID/레벨이 달라지면 목표 POST를 실행하지 않는다.
3. 기존 POST `/api/shop` `{action:'goal',type}`을 보낸다. 서버가 `goalOk`를 최종 판정한다. 별도의 새로운 개발 API는 없다.
4. GET으로 저장 기록을 확인한다. 모호한 POST 실패도 재조회하고, 성공 응답이 확정된 경우 후속 GET 실패만으로 저장 성공을 지우지 않는다. 조회 실패를 명시한다.

조회는 state 밖 `mastery`와 `items`만 채택한다. 전체 S/재화/선봉/슬롯/전투를 갈아 끼우지 않는다. `growthState`는 부분 채택이라 sync rev를 올리지 않는다. goal POST는 기존 개발 전송 함수의 계정 확인을 사용한다. 계정이나 상태 객체가 달라진 응답은 채택하지 않는다. 닫힌 팝업은 다시 열지 않으며 선택을 바꾸어도 요청 대상 type은 바뀌지 않는다. 실패/조회 후 잠금을 해제한 뒤 현재 화면을 다시 표시한다.

숙련 지급은 서버의 `m_lv`와 `m_goal`이 담당한다. UI에서 `settleMastery`를 호출하거나 items에 보상을 더하지 않는다. `got/grants`는 해당 조회에서 새로 정산된 값이며, 이전에 미정산된 여러 UID의 성장도 포함할 수 있다. 이를 “이번 공격만의 보상”으로 단정하지 않는다. 외부 기기의 편성/재화 변경까지 부분 조회에서 동기화하는 기능은 아니며 전체 상태는 기존 접속/로그인 동기화가 담당한다.

기기 하나의 UI 요청 순서는 잠그지만 GET 정산 + goal POST는 서버의 한 트랜잭션이 아니다. 같은 계정을 다른 기기에서도 동시에 성장시키면 두 요청 사이에 새 레벨이 생길 수 있다. 이 상황까지 이전 목표 정산을 보장하려면 Claude 담당 goal 서버 동작에서 정산/목표 변경을 원자화할 후속 계약이 필요하다. 이번에는 기존 서버 계약을 변경하지 않았다.

## 검수 결과

- `node tools/development-ui-check.mjs` 통과: 76기·96+5 연결, 원본 데이터 불변, C 뿌리/모든 부모/뽑기 입구/보유 조건, 59→60 보상, GET→POST→GET 순서, 중복 클릭, 모달 닫기/선택 변경/계정·상태 교체, 실패·stale 조회, 재화 유지.
- `node tools/development-api-check.mjs http://127.0.0.1:8841` 통과, 검수 실행당 **실 HTTP22회**. 독립 새 임시 게스트에만 쓰고 `127.0.0.1` 이외 URL은 거부한다. 이관 소급 없음, 잘못된/보유/뽑기 목표 거절, Lv.5 보상을 이전 BASTION 목표로 먼저 지급, DUNE 변경 후 Lv.10 보상은 DUNE에 지급, UID grants, 반복 조회 중복 없음, 재접속 기록, 크레딧 보존을 확인했다. 초기 테스트 준비의 rev/자동 목표 가정을 실제 접속 계약에 맞게 수정한 뒤 최종 실행을 통과했다.
- `node --no-warnings tools/masterycheck.mjs` 통과: 실제 SQLite/D1 어댑터로 items/m_goal/m_lv 저장과 중복 정산 방지, 목표 변경, 조립/다음 목표 확인.
- 관련 회귀 통과: `circuit-ui-check`, `common-ui-check`, `combat-integration-ui-check`, `hangar-ui-check`, `recruitment-ui-check`, `lineagecheck`, `front-ui-check`, `territory-ui-check`, `battle-ui-check`, `dispatch-ui-check`, `ranking-ui-check`.
- 순수 정적 빌드 `npm run build`와 문법/diff 검사를 통과했다. 서버/DB/data/공용 판정은 변경하지 않았다.
- 별도 schema24 로컬 Worker/D1 `.wrangler/merged-ui-state`, 포트8841에서 실제 UI 조작: AZURE→MULE→AZURE 저장/이전12개 조각 유지/새로고침 보존, 검색 ATLAS/부모5기/목표 버튼 잠김, 격납고 RANGER UID Lv.32→35에서 AZURE **12→13개**, 다음 조각 **Lv.35→40**, 보관함 진행률 연결을 확인했다. 운영 계정/원격 DB에 쓰지 않았다.
- PC1440×1000, 모바일360×800에서 실제 PNG 누락 0, 문서/팝업 가로 넘침 0, PC 지도·모바일 목록/검색/선택 시 상세 이동/목표 저장을 확인했다. 브라우저 검수에서 발견한 빈 id 포커스 복원 오류를 수정하고 회귀 사례에 추가했다. 지도 포커스의 팝업 전체 스크롤 문제와 모바일 상세가 목록 밖에 남는 문제도 수정했다.

검수 캡처: [PC](previews/development-pc-1440.png), [모바일 선행 조건](previews/development-mobile-360.png). 실기기/출시 성능 검수 완료라는 뜻은 아니다.

## 다음 재개 순서

1. 이 브랜치와 원격/main 차이를 먼저 확인한다. 원본 main/UI 브랜치나 운영 DB를 검수 폴더로 사용하지 않는다. 작업 계약을 새 묶음으로 기록한다.
2. **조각 합성 + 일일 회수 UI**: handoff25, `js/shardsynth.js`, `js/salvage.js`, `server/shop.js` action synth, `server/salvage.js` GET/POST부터 읽는다. 합성 재료/확률/비용/서버 결과, 회수 일일 남은 횟수/출격 UID/실제 표시 목표를 연결한다. EP 개발 목표의 회수 fallback(C~R)을 같은 목표라고 잘못 표기하지 않는다.
3. 귀속/해제·기체별 프리셋 UI: handoff28, 기존 비용/UID 계약을 확인하되 off 스위치는 유지한다. 활성화는 사용자 결정이다.
4. 운영 반영 전 Claude 담당 상대 준비 API에 circuit 또는 서버 확정 stats를 포함할 계약을 해결한다. 현재 준비 화면의 누락 수치는 “미확인”이고, start/replay는 서버 확정 stats를 사용한다.
5. 전체 후속 통합/실기기/성능/신규 사용자/운영 배포 검수를 따로 진행한다. 현재 작업을 전체 출시 준비 완료로 보고하지 않는다.
