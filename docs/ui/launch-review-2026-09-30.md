# 출시 전 검수 1차 — 2026-09-30

작업 브랜치 `codex/ui-integration`, 시작점 `f549b98`. 원격 main `ab45b4c`와 UI 원본 `codex/ui-rebuild`를 보존한다. 이번 작업은 후속 UI 4묶음 이후의 신규 사용자/대규모 파츠 검수다. 참고 문서는 AGENTS, CONTRACT, IMPLEMENTATION, rebuild-plan과 loadout/development 구현 기록이다. 기존 시안의 격납고·팝업·파츠 카드를 유지하며 검색/목록 탐색만 보강했다. 서버, DB 스키마, 공유 수치, 기체 그림은 변경하지 않았다. PART_BIND.on=false, LINEAGE.gate=false 유지. 운영 반영·배포 없음.

## 발견과 수정

1. 대문에서 직접 로그인하면 인증·상태 채택은 성공하지만 문이 닫히지 않았다. `initGate`는 `afterLogin`이 true일 때 문을 여는데 성공 경로에 반환값이 없었다. 성공 시 true를 반환한다. 실패 시 false/닫힌 대문/저장 차단은 유지한다. 기존의 `retried !== false` 검사는 undefined도 통과시켰으므로 true를 요구하고 실제 submit 핸들러의 성공/실패 분기를 검사한다. 수정 전 명확히 실패하는 것을 확인했다.
2. 장착·합성 창은 파츠를 전부 HTML로 만들었다. 1,000개 테스트에서는 각각 최대24개 카드로 제한했다. 검색은 표시된 페이지가 아니라 전체 후보를 대상으로 이름/등급/슬롯/강화 수치를 AND 부분 일치로 찾는다. 검색 버튼 또는 Enter로 제출하면 첫 페이지로 돌아간다. 페이지는 결과 개수에 맞춰 보정한다.
3. 장착 후보의 사용 가능 → 다른 기체 귀속 순서를 유지한다. 장착 요청은 기존 관리자에서 선택한 파츠 UID와 팝업의 기체 UID를 보내며 조회/계정/중복 요청 차단을 유지한다. 장착 페이지는 위·아래 모두 이동할 수 있다.
4. 합성은 장착 파츠를 제외하고 칸/등급/강화 순서를 유지한다. 큰 보관함은 첫 재료의 칸·등급·귀속 조건으로 후보 전체를 좁힌 뒤 페이지를 만든다. 소량(24개 이하)은 기존 필터 퇴장 연출을 유지한다. 페이지 밖/검색 밖에서 선택한 재료도 상단 선택 목록에서 해제할 수 있다. 선택을 바꾸면 기존 합성 예고/비용/서버 판정을 그대로 사용한다. 이번 브라우저 검수에서 실제 재료를 소비하는 합성은 하지 않았다.

| 파일 | 역할 |
|---|---|
| `js/game.js` | 로그인 성공 반환, 합성 검색/페이지/선택 재료 표시·ROWAR 연결 |
| `js/ui/part-window.js` | 공통24개 창, 전체 후보 검색, 페이지 보정 |
| `js/ui/loadout-manager.js` | 계정·창에 속하는 검색어/페이지, 기존 UID 쓰기 경로 유지 |
| `js/ui/loadout-view.js`, `themes/loadout-v2.css` | 장착 검색·이전/다음·개수, 합성 선택 목록과 모바일 배치 |
| `tools/login-ui-check.mjs` | 실패를 재현한 로그인 반환/실제 submit 회귀 |
| `tools/launch-ui-check.mjs` | 1,000개 카드 상한·최종 파츠 검색·귀속 순서·UID 장착·계정 격리·합성 선택 유지 |
| `tools/launch-api-check.mjs` | loopback 신규 계정 진행과 서버 미완료 계약 재현, 선택적 테스트 SQL 생성 |

## 검수 증거

- 새 DB `.wrangler/launch-review-state`에 `server/schema.sql`을 **로컬로만** 실행했다. schema24. Worker `127.0.0.1:8843`. 기존8841 검수 DB와 운영 데이터는 분리했다.
- 실제 브라우저 신규 게스트 #0001: 시작 전 게스트 생성 없음 → 시작 → 1장 도입 → 첫 작전의 전/후 이야기 → 방어선 돌파. 600→800크레딧, 30→50스크랩, 첫 작전1/5 완료, 둘째 작전 개방, 나머지 잠금. 새로고침·시작·전선 이어하기 후 둘째 작전과 첫 보상 수령 완료 유지. 도입 이야기가 자동으로 다시 나오지 않았다. 시작 기체는 LENS였으며 육성/마이그레이션 없이 진행했다.
- 최종 `launch-api-check` **HTTP22회**: 별도의 새 게스트, 이관 없이 첫 작전 승리/반복 보상 없음, 레벨업 두 번으로Lv.3, 별도 검수 계정에서 아래 서버 계약을 재현했다. 마지막 HTTP 검사 성공은 서버 미완료 사항 해결을 의미하지 않는다.
- 대규모 계정은 테스트 계정을 별도로 만든 뒤, 출력된 `.tmp/launch-large.sql`의1,000행을 같은 **격리 로컬 DB**에만 실행했다. 브라우저 내부 상태/스토리 진행/운영 저장값을 주입하지 않았다. 테스트 SQL과 DB는 Git 제외다. 로그인 화면의 테스트 ID/비밀번호로 정상 인증을 거쳐 확인했다.
- 브라우저: 로그인 성공 후 대문 닫힘; 보관함1000개; 장착24개/42페이지 → 다음2/42 → 전체 검색 ‘최종’으로1000번째 파츠1개 → 실제 장착 성공. 장착한 파츠를 제외한 합성999개/42페이지 → 첫SR 선택499개/21페이지 → 페이지2에서도 선택 유지 → 상단에서 해제 →999개로 복귀. 장착한 ‘최종’ 파츠 검색은 합성 후보0개.
- PC요청1440×1000, 모바일요청360×800. 실제 CSS뷰포트는1321×917/330×734. 장착·합성 창의 `scrollWidth === clientWidth`로 가로 넘침 없음. 모바일 장착 카드·검색·페이지·선택 목록을 캡처로 확인했다. **실제 휴대전화/CPU·GPU·배터리 측정은 아니다.**
- 관련 검사12종 통과: launch, login, loadout, hangar, common, front, development, shard, battle, combat-integration, circuit, recruitment UI. Node1,000개 템플릿 렌더는 관측12~17ms였으나 브라우저 프레임 속도나 실기기 성능 수치로 해석하지 않는다. DOM 카드 상한이 핵심 검증이다.
- 최종 빌드와 diff 공백 검사 통과. 브라우저 콘솔 오류 없음. 기존 보관함 초기60개/더 보기 동작은 유지한다. 장착·합성의 상한과 전체 보관함의 점진 추가 방식을 혼동하지 않는다.

캡처: `previews/launch-search-pc-2026-09-30.jpg`, `launch-search-mobile-2026-09-30.jpg`, `launch-fuse-mobile-2026-09-30.jpg`. 도구가 반환한 원본 JPEG를 그대로 저장했다.

## 서버 담당에게 이어줄 두 항목 — 미완료

**1. 준비 화면의 확정 상대 수치.** `server/arena.js`의 `rowToOpponent`는 주력/예비의 스냅샷 stats를 가지고 있으나 `server/battle.js`의 duel/arena `preparePending` 공개 투영에서 제거한다. bench는type/level/name뿐이다. 실제 HTTP 지목 대전의 player상대에서 `circuitPresent:false, statsPresent:false`를 확인했다. 현재 UI는 circuit 없는 player상대의 전력/능력치를 미확인으로 표시한다. 전투 start/replay의 확정 stats는 사용 중이다.

요청: find와 전투 후 next를 같은 준비 응답 계약으로 정리한다. player 주력/예비에 **서버가 판정할 스냅샷 stats**를 추가하고, 서킷 표시/재계산이 필요하다면 정규화된circuit배열(없음=[])과skillLv/parts/slots도 제공한다. accountId·DBid·seed·상대 전술 등 비공개 정보는 추가하지 않는다. 기존 필드/소비·시드·난수 흐름을 보존한다. stats만 제공하는 안은 현행 프론트의circuit확인 분기도 함께 바꾸는 후속 GPT 작업이 필요하다.

수용 기준: 구/신 아레나 스냅샷, 서킷 없는/있는 player, 주력선택 변경, 예비, 생성 상대/몬스터, duel/arena/find/next를 검사. 준비stats와 같은 pending을 start한statE 및relay.statE2가 같아야 한다. 백엔드 구현 전까지 ‘미확인’을 추정 숫자로 바꾸지 않는다.

**2. 목표 변경/숙련 정산 원자성.** 실제 HTTP 순서: 기존 목표mule → 상태GET(기기A의 변경 전 정산) →Lv.4→5 성장(기기B를 모사한 별도 요청) →goal=dune POST →상태GET. 결과는mule조각0/dune조각1이었다. 목표를 바꾸기 전에 발생한 성장이 새 목표로 정산되는 창이다. 프론트의GET→POST→GET 잠금은 단일 화면만 보호한다.

원인: `server/shop.js` goal은m_goal만 조건 없이UPDATE한다. `server/state.js`의 숙련 batch는items/m_goal/m_lv를 읽은 값 기준으로 조건 없이 쓴다. 서로 겹치면 목표/보관함의 새 변경을 덮어쓸 가능성도 있다. 후자는 소스 확인에 따른 위험이며 실제 동시 손실 재현을 이번 완료 증거로 주장하지 않는다.

요청: goal요청 안에서 **현재 레벨의 미정산 보상을 기존 목표로 지급하고 새 목표를 설정하는 작업**을 하나의 원자적 변경으로 처리한다. 상태GET의 정산도 동일한 충돌 정책/조건부 쓰기와 제한된 재조회로 보호한다. 클라이언트가 성공하면 기존 조각/새 목표/items/mastery를 확정 응답 또는 확인GET으로 채택할 계약을 기록한다. 프론트가 임의 보상/재요청을 생성하지 않게 한다.

수용 기준: 위HTTP창에서mule+1/dune+0, 다음Lv.10은dune+1; 동시GET 두 번은1회 지급; goal과합성/조립/회수/뽑기·성장이 겹쳐도items·목표·m_lv 유실 없음; stale충돌 응답/재조회; 계정 격리; 두 기체 동시 성장/만렙 보너스/목표 무효화도검사. 실제SQLite/D1 인터리빙 검사와 한 기기 UI 회귀가 모두 필요하다. 서버 담당 변경은 이번 커밋에 포함하지 않았다.

## 재개 순서

1. 위 서버 계약 두 항목을 Claude 담당 범위에서 구현/검수하고 통합 브랜치로 승인된 반입 절차를 기록한다. 이어서 GPT가 준비 stats 소비와 목표 응답을 연결해 검수한다.
2. 실제 Android/iOS/저사양PC의 터치·스크롤·키보드·장시간 재생과 프레임/메모리를 측정한다. 모바일viewport와 실기기를 구별한다. 필요하면 보관함의 누적 ‘더 보기’도 측정 결과에 맞춰 보강한다.
3. 출시 전 최종 검수 후 사용자 지시에 따라main 반영/운영 배포/스위치 활성화를 각각 결정한다. 이번 결과로 출시 준비 전체 완료라고 표시하지 않는다.

로컬 재개: `npm run build` 후 `node node_modules/wrangler/bin/wrangler.js dev --local --persist-to .wrangler/launch-review-state --ip 127.0.0.1 --port 8843`. 신생계정API 재검사: `node tools/launch-api-check.mjs http://127.0.0.1:8843`. 대규모GUI자료가 필요할 때만 마지막 인자`.tmp/launch-large.sql`로 새 테스트 계정/SQL을 만들고, 정확히 같은격리 DB에 `d1 execute rowar --local --persist-to .wrangler/launch-review-state --file .tmp/launch-large.sql`로 실행한다. 출력된1회용 로컬 계정으로 UI에 로그인한다. 원격DB/배포 명령은 사용하지 않는다. 빌드 전에 파일 잠금이 있는 기존 로컬Worker를 종료한다.
