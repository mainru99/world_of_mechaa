# 리빌드 화면 기준 main 통합 — 2026-09-29

## 상태와 분리

- 사용자 승인: “리빌드 된 것들로 맞춰서 합치면 되지 않나?”
- 작업 브랜치 `codex/ui-integration`, 별도 폴더 `C:\Users\DESKTOP-896744\Documents\New project\rowar-ui-integration`.
- 출발 UI `29733c9`, 통합 main `ab45b4c3353386a33ef16e67657f71ab3e235adf`. 원본 `codex/ui-rebuild`와 `main`은 수정하지 않았다.
- 범위 승인 기록 `29cdc80` 후 main을 정식 병합한다. main의 서버/공유 규칙/DB/기체·그림과 리빌드 프론트를 함께 보관한다.
- 원격 대상도 `origin/codex/ui-integration`만 사용한다. 운영 main 반영·원격 DB 이관·배포는 하지 않는다. 이 통합은 운영 반영 또는 신규 기능 UI 전체 완성을 뜻하지 않는다.
- 병합 커밋 **`c3870dd`**(부모 `29cdc80`, `ab45b4c`)을 생성하고 `git push -u origin codex/ui-integration` 성공. 충돌/병합 진행 상태 없음, 작업 트리 깨끗함을 확인했다. 회사에서는 기존 UI 폴더에 덮어쓰지 말고 이 통합 브랜치의 별도 폴더로 이어받는다. 원본 UI 29733c9, 운영 main ab45b4c 및 main 폴더의 미추적 아트 자료를 보존했다.

## 충돌 8곳의 해결

| 충돌 구간 | 유지한 화면 | 연결한 main 동작 |
|---|---|---|
| drawRaid | 리빌드 주간 레이드 현황/편성 카드 | 동시 합동전 안내, 실제 서버 HP/횟수 |
| raidRunGo | 계정·이동·중복 요청 보호 | 서버 확정 자리/기체별 전술, runRaid → playJoint |
| renderRaidResult | 피해·보상·복귀 리포트 | 전투 분석/딜표 |
| startBattle | 준비/재생/결과와 출발 메뉴 | relay 입력, swap, 두 기 UID 정산 |
| setFrontCh / frontAfterState | 리빌드 장/작전·이야기 흐름 | 서버가 준 진행으로 진입, 이미 깬 장의 로그인 도입 생략 |
| renderFront | 리빌드 장/칸 카드 | 상태 다운로드 전 도입 차단, 완료된 서버 진행 보존 |
| renderFrontResult | 리빌드 전선 결과/정비 | fightBreach 분석 |
| renderBreachResult | 리빌드 점령 결과/선택 지도 복귀 | fightBreach 분석 |

파일 전체를 ours/theirs로 덮어쓰지 않았다. 충돌 밖 main의 실시간 재생, swap 시 HP 최대치, 초기 상태로 건너뛰기, 합동전/분석 함수도 점검해 보존했다.

## 표시 어댑터와 추가 수정

- `js/game.js`: setPending이 상대 bench를 보존. 준비 화면에 양쪽 예비 기체의 정지 PNG/레벨/이름을 표시하고 전력 비교는 첫 기체 기준임을 밝힌다. 예비 기체 전술은 첫 기체 전술을 따른다.
- `js/ui/battle.js`, `themes/battle-v2.css`: 토벌/레이드 2:1 준비 화면과 실제 자리/전술 양식. PVP 모드 선택 대신 해당 작전의 제목/복귀를 보여 준다. 레이드 전투력은 별도 배율이라 숫자로 유리함을 단정하지 않는다.
- `js/ui/challenge.js`: 보스 공격은 먼저 편성 화면으로 이동. 레이드는 전위/후위 동시 출격으로 안내한다.
- `js/ui/dispatch.js`: 보스 레벨·비용은 편성 최고 레벨 기체 기준. 상대 상한은 MAXLV + OPP_LV_OVER. 원정은 기존대로 한 기/한 건.
- `js/ui/common.js`: 일반/친선 교대, 토벌 보스/레이드 동시 합동, 전선/점령 순차 전투 안내를 현행 규칙과 일치시킨다.
- `js/game.js`: 합동전 늦은 응답은 동일 계정에 서버 보상만 반영하고 화면을 강제로 되돌리지 않는다. 다른 계정의 응답은 무시한다. 계정 전환은 편성/전술/분석 캐시를 초기화한다. 지연 분석은 예약 당시 결과 DOM·계정·상태·요청과 동일할 때만 채운다.
- `index.html`: 통합 빌드 캐시 키 갱신. 카드/전투/홈 PNG, 격납고 큰 IGNIS만 승인된 기존 10프레임을 유지한다. main의 새 IGNIS 정지 그림과 대기 그림의 차이는 사용자가 재제작할 예정인 기존 인계 사항이다.
- `tools/codexcheck.mjs`: 패배에도 첫 몬스터를 격추하고 둘째에 질 수 있는 교대 규칙을 반영. 최종 승패만으로 처치 수를 기대하던 검사를 실제 swap/end 사건별 만남·격추 수와 DB 대조로 수정했다. 서버 구현은 바꾸지 않았다.

## 검수 결과

1. UI 11종 통과: login, hangar, recruitment, battle, dispatch, challenge, front, territory, ranking, common, combat-integration. 모드/자리 전달, 예비 기체 재생 입력, 실제 UID 정산, 이동/계정 변경, 지연 분석, 정지 그림, 안내와 확률 검사를 포함한다.
2. 관련 회귀 11종 통과: terrcheck, battlecheck, frontcheck, presetcheck, codexcheck, raidcheck, arenacheck, relaycheck, jointcheck, insightcheck, bindcheck. 서버와 클라이언트 재생, 교대, 합동전, 딜표, 꺼진 귀속의 기존 동작을 확인한다.
3. `node --check js/game.js`, UI 모듈 문법 및 `npm run build` 통과. 충돌 마커와 diff 공백 오류 없음.
4. **실제 로컬 Worker/D1** schema24, HTTP 52회 통과. 게스트/1회 이관/장착·거절/프리셋/합성/코어·크레딧 뽑기/상점/전선/시련/레이드/일반 대전/토벌/점령/원정/랭킹·도감/인증·저장 복원을 확인했다. 레이드 피해와 토벌 합동전 승패는 서버가 보낸 입력으로 다시 계산해 실제 응답과 대조했다.
5. 브라우저: 실제 별도 로컬 게스트 #0002의 2기 편성으로 자리 교체·전위 방어 선택 → 레이드 요청 → 재생 → 결과·분석 → 시련 복귀 확인. 결과에서 피해 615, 크레딧 +97, 스크랩 +17, 남은 횟수 2/3 표시. 새로고침 후 잔액과 진행이 유지되며 이미 깬 장 도입이 반복되지 않는다.
6. PC 1440×900, 모바일 360×780의 준비/결과에 문서 가로 넘침과 깨진 그림 없음. 브라우저 오류/경고 없음. 이전 UI 브랜치 전체 화면 검수 기록은 `integration-review-2026-09-29.md`에 따로 보존한다. 이번 전투 검수와 이전 schema21 검수를 혼동하지 않는다.

캡처: `previews/merged-raid-prep-1440.jpg`, `previews/merged-raid-prep-360.jpg`, `previews/merged-raid-result-1440.jpg`, `previews/merged-raid-result-360.jpg`.

## 재현과 환경

`npm run build` 후 `node node_modules/wrangler/bin/wrangler.js dev --local --persist-to .wrangler/merged-ui-state --ip 127.0.0.1 --port 8841`.
새 로컬 DB에는 `server/schema.sql`을 **--local**로 적용한다. `.wrangler/merged-ui-state`는 다른 UI 검수 DB와 구별한다. `node tools/local-api-ui-check.mjs http://127.0.0.1:8841`은 오직 loopback의 폐기 가능한 검수 계정을 생성한다. 토큰/비밀번호/DB/로그는 커밋하지 않는다.
Windows에서는 실행 중 Worker가 dist 폴더를 사용하므로 다시 빌드하기 전에 이 로컬 프로세스를 종료한다. npm 설치는 기존 동일 lockfile의 UI node_modules를 junction으로 재사용했으며 작업 소스/DB는 분리했다.

## 후속 UI 작업 — 아직 끝나지 않은 것

main 인계 `docs/handoff/2026-09-23-main-to-ui.md`, `2026-09-25-main-to-ui.md`, `2026-09-28-main-to-ui.md`를 따른다. 기능별로 화면·실제 API·계정 격리·시각 검수를 마친 뒤 기록한다.

1. **격납고 코어 서킷 저장/비우기**: main의 승인된 `core-circuit-preview.html`은 계정 저장 없는 별도 미리보기다. 게임 안 uid별 저장/리셋 UI는 아직 연결하지 않았다. 좌표의 `hand:true`와 76기 별자리 자산을 유지한다.
2. **정제 코어 지갑·정제·세 번째 모집 창구**: 서버는 준비됐고 현재 게임 UI는 코어/크레딧 두 창구를 유지한다. `rcores`는 state 밖의 서버 필드이므로 상태 다운로드/정산 어댑터도 함께 연결해야 한다.
3. **개발 목표/계보도·숙련 조각·조각 합성·회수 작전**: 서버의 자동 목표와 기존 조립/보관함은 보존한다. 새 목표 선택/진행/합성/일일 회수 진입 UI를 제작한다.
4. **귀속 표시·해제·기체별 프리셋**: 아직 `CONST.PART_BIND.on=false`; 계보 제한도 `CONST.LINEAGE.gate=false`. 화면 제작만으로 스위치를 켜거나 원격 이관하지 않는다. 활성화는 사용자가 지시할 때 main 담당과 조율한다.
5. **서킷이 적용된 플레이어의 상대 준비 카드 계약**: 현재 `/api/battle/find`는 parts/slots/level을 주고 상대 서킷/확정 stats는 주지 않는다. 현행 모든 서킷은 비어 있어 현재 준비 표시는 일치하지만, 저장 화면을 붙이기 전에 Claude에게 확정 스탯을 준비 응답에 포함하도록 요청한다. 실제 전투 재생은 이미 start 응답의 서버 스탯을 쓴다.
6. 출시 전 별도 검수: 실제 휴대폰/저사양 성능, 신규 사용자 관찰, 운영 저장/DB 이관·배포 검수. 이번 로컬 통합 검수로 완료라고 표시하지 않는다.
