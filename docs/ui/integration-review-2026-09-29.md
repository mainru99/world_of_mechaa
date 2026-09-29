# UI 통합 검수 — 2026-09-29

## 결론과 범위

`codex/ui-rebuild`의 전체 화면 이전과 **로컬 통합 검수**를 완료했다. 화면 이동에서 발견한 점령 결과/늦은 응답 문제, 토벌·주간 도전의 메뉴 선택과 복귀 경로, 첫 게스트 진입 안내를 수정했다. UI 검사 10종, 기존 관련 회귀 7종, 빌드가 통과했다. 별도 로컬 Worker/D1에 실제 HTTP 요청을 보내 인증·저장·소비·서버 판정도 확인했다.

이는 운영 main과의 호환 완료, 운영 배포 또는 마켓 출시 준비 완료를 뜻하지 않는다. 실제 모바일 터치/Safari, 컨트롤러, 성능 비교와 신규 사용자 관찰은 후속 출시 검수다. main의 별도 전투/파츠 계약 통합은 사용자 지시 후에 한다.

- 작업 폴더: `C:\Users\DESKTOP-896744\Documents\New project\rowar-ui-rebuild`.
- 시작 UI HEAD: `8b61f56`. 원격 확인 시 main: `ab45b4c`, UI: `8b61f56`.
- `AGENTS.md`, `CONTRACT.md`, 개편 계획과 11차 공통 UI 기록의 보존 조건을 재확인했다.
- PC/모바일 시안의 화면 언어를 유지하며 기존 점령 결과까지 같은 스타일로 이관했다. 새로운 기체/시스템/밸런스는 추가하지 않았다.
- 서버·DB 스키마·공유 규칙·`js/net.js`·기체 ID·`rowar.save.v2`·원본 에셋은 변경하지 않았다. 실제 merge/rebase/cherry-pick이나 운영 배포 없음.

## 수정 파일과 동작

| 파일 | 수정과 확인할 계약 |
|---|---|
| `js/game.js` | 점령 요청/재생/수령의 계정 및 화면 격리, 선택 거점과 정비 왕복 유지. `toBattle`의 출발 메뉴, 토벌 결과 복귀, 주간 도전 재생/결과 메뉴 표시. 첫 게스트의 서버 저장 안내 |
| `js/ui/territory.js` | `territoryResultView(r,node,rewards)` 표시 전용 함수. 기존 판정/보상 행을 받아 지형 배너·정지 기체·전과 보고·선택 거점/정비 버튼 표시 |
| `themes/territory-v2.css` | 결과 PC 패널과 700px 이하 세로 배치. 48px 행동 버튼 |
| `index.html` | 점령 CSS와 game 모듈 캐시 버전 갱신 |
| `tools/territory-ui-check.mjs` | 실제 game 함수의 늦은 응답·계정 변경·보상/수령·재생 취소·잠금 오류·결과 복귀 검증 |
| `tools/battle-ui-check.mjs` | 토벌 검색/결과의 출발 메뉴와 한도 전후 임무 복귀 검증 |
| `tools/local-api-ui-check.mjs` | 실제 net 어댑터를 통한 loopback HTTP 통합 검수. 실행할 때마다 별도 폐기용 계정 생성 |

### 점령 요청과 결과

`attackTerr()`는 상태 객체와 계정 ID, `_battleRequest`를 캡처한다. 서버에서 이미 성공한 행동은 같은 계정의 지갑/기체에 한 번 적용한다. 화면을 떠났다면 재생을 다시 열지 않는다. 새 계정이나 교체된 상태 객체에는 옛 응답을 적용하지 않는다. 같은 계정으로 지도로 돌아와 있다면 지도만 갱신한다.

`playBreach()`는 기존 `replayBreach()`의 취소 판정을 연결하고 마지막 대기 뒤에도 확인한다. 다른 화면/계정에서 점령 결과가 갑자기 나타나지 않는다. 실패 응답도 현재 요청일 때만 설명하고 선택 거점으로 복귀한다.

결과의 보상·출격비·경험치·피로는 기존 `renderBreachResult()` 계산/서버 응답을 그대로 사용한다. 승리 시 수입 안내, 패배 시 남은 방어선과 시간 회복 안내를 표시한다. `prepareTerritory()`/`returnTerritory()`로 정비 후 같은 거점에 돌아간다.

`claimTerr()`도 계정을 캡처한다. 성공한 수입은 상태/지갑에 반영하되 현재 점령 지도일 때만 지도를 갱신한다. 격납고나 전선 본문을 덮지 않는다. 현재 선택 거점도 유지한다.

잠금 오류에서 net 어댑터가 레벨 필드를 생략하는 경우는 거점 데이터의 `minLv`로 안내한다. 서버가 현재 레벨을 전달하지 않으면 해당 괄호를 표시하지 않는다. `Lv.undefined`는 나오지 않는다. API 필드 보존 개선 요청은 CONTRACT에 남겼으며 net 파일 자체는 수정하지 않았다.

### 출발 메뉴와 저장 안내

- 토벌의 검색→준비→재생→결과는 파견 메뉴를 유지한다. 주간 한도 전에도 `사냥터로` 버튼이 있다. 한도를 다 쓰면 기존대로 다음 판 대신 임무 복귀만 제공한다.
- 시련·레이드의 재생/결과는 시련 메뉴, 모바일에서는 더보기를 유지한다. 점령·전선은 기존 점령 메뉴를 유지한다.
- 대전 모드를 선택하면 공유 전투 화면의 메뉴를 대전으로 맞춘다.
- 최초 연결 후 아직 게스트를 만들지 않은 상태의 타이틀은 시작하면 게스트 계정을 만들고 서버에 저장한다는 실제 동작을 설명한다.

## 검수 환경을 구분할 것

### 메모리 예시 브라우저

`node tools/ui-preview.mjs 8830 --sample-pulls --sample-dispatch --sample-archive --sample-shop --sample-challenge --sample-front`

1440×900의 주 메뉴 8개, 360×780의 동일 메뉴와 모바일 작전 메뉴, 전선·상점·모집 결과, 시련/레이드 결과를 확인했다. 1280×800의 주간 도전·격납고·점령도 확인했다. 주요 화면에서 페이지 가로 넘침과 이미 로드된 이미지의 실패는 없었다. 전체 에셋/링크 검사나 물리 장치 인증을 대신하는 검사는 아니다.

- 모집 배너→캡슐→native 결과 팝업→확인→격납고, 지갑 반영 확인. 팝업이 열릴 때 AX 트리에서 배경 조작이 제외됐다.
- 원정 출발→예시 귀환→수령→기체 복귀·지갑 반영 확인. 이 미리보기는 원정을 3초로 단축하고 예시 보상을 사용한다. 실제 1시간 규칙이나 실제 귀환 수령을 이 검수로 주장하지 않는다.
- 시련 기록→시련 복귀, 순차 2기 레이드→피해/보상/잔여 횟수 결과→레이드 복귀 확인.
- 격납고 hero의 `currentSrc`는 승인된 `ignis-idle-10f.webp`, 작은 기체 카드/선봉/예비는 PNG였다. `img.src`만 보면 `<picture>`의 모션 선택을 확인할 수 없으므로 `currentSrc`로 검사했다.
- 마지막 브라우저 error 로그: PC 예시/모바일 예시/실제 로컬 Worker 탭 모두 없음.

### 실제 로컬 Worker + D1

잠금 파일의 Wrangler 4.129.0을 사용했다. 설치된 버전을 임의 갱신하지 않았다. schema21의 `server/schema.sql`을 **별도 `.wrangler/ui-integration-state`**에 적용했다. remote DB, 운영 계정/토큰/재화와 연결하지 않았다. 생성한 계정과 테스트 비밀번호는 로컬 전용이며 출력·커밋하지 않았다.

재현 절차(서로 다른 터미널에서 Worker와 검사 실행):

```powershell
npm ci --cache .tmp/npm-cache --no-audit --no-fund
npm run build
$env:WRANGLER_SEND_METRICS='false'
$env:WRANGLER_LOG_PATH='.tmp/wrangler-logs'
node node_modules/wrangler/bin/wrangler.js d1 execute rowar --local --persist-to .wrangler/ui-integration-state --file server/schema.sql
node node_modules/wrangler/bin/wrangler.js dev --local --persist-to .wrangler/ui-integration-state --ip 127.0.0.1 --port 8831
# 별도 터미널
node tools/local-api-ui-check.mjs http://127.0.0.1:8831
```

검사 도구는 HTTP의 `127.0.0.1`과 명시적 포트만 허용한다. 한 번의 이전 저장 이관으로 폐기용 고레벨 계정을 준비한 뒤 일반 상태 PUT을 다시 거절하는 것도 확인한다. 실제 `js/net.js`를 사용하고 브라우저 자동화는 하지 않는다.

완료한 실행: **HTTP 51회, 검사 묶음 17개 통과**. 보호 거점이면 강행 요청을 추가하므로 재실행 요청 수는 달라질 수 있다.

1. 최초 게스트 생성과 초기 상태.
2. 유효한 구 저장본의 1회 이관, 두 번째 이관 거절.
3. 정상 장착과 부적합 슬롯 거절.
4. 프리셋 저장/다른 기체로 파츠 이동/삭제.
5. 실제 파츠 3개 합성과 상태 반영.
6. 코어·크레딧 뽑기 각 1회, GET state의 지갑/횟수 일치.
7. 상점 구매와 같은 상품 재구매 거절.
8. 전선 첫 승 보상과 반복 승 무보상.
9. 같은 빌드 시련의 결정론적 점수.
10. 순차 2기 레이드와 반영 피해.
11. 일반 대전의 실제 서버 응답/시드 재생 승패 일치와 지갑 일치.
12. C 토벌 요청/결과.
13. 점령 공격/판정/보상/상태 일치, 아직 수입이 없는 수령 거절.
14. 원정 출발/미완료 수령 거절/기체 UID 저장.
15. 랭킹·도감 조회.
16. 게스트→정식 전환, 로그아웃, 틀린 로그인 거절, 다시 로그인.
17. 재로그인 후 지갑/전선/기체/파츠/원정 저장 복구.

별도 실제 브라우저에서 새 Lv.1 계정의 도입→전선 첫 작전→서버 승리→대사 건너뛰기→첫 보상→새로고침 복구를 확인했다. 점령은 Lv.5 제한으로 공격 버튼이 없었다. 그 뒤 **해당 로컬 검수 계정만** Lv.32/테스트 재화로 준비해 n02 점령 성공→결과→정비→같은 침수 부두 복귀를 확인했다. 실제 결과 캡처는 PC 기본 뷰포트와 390×844다.

수입 수령은 이 로컬 DB의 해당 거점 `claimed_at`만 2시간 이전으로 준비했다. 지도에서 +10크레딧/+2스크랩을 실제 POST로 받고, 지갑 19,779→19,789 / 스크랩 5,006→5,008, 수입 0/버튼 비활성, n02 선택 유지까지 확인했다. 서버 시간·수입 규칙을 바꾸지 않았다. 자연 경과 2시간이나 cron 동작을 검증했다는 뜻은 아니다.

Wrangler 실행 중 Windows에서 `dist` 폴더가 잠길 수 있으므로 재빌드 전에 해당 로컬 Worker를 종료한다. 검수 종료 시 실제 Worker는 종료했고 메모리 UI 미리보기만 남겼다. 로컬 DB/캐시/로그/빌드 산출물은 ignore 대상이며 커밋하지 않는다.

## 자동 검사와 캡처

- UI 10종: `common`, `login`, `hangar`, `recruitment`, `battle`, `territory`, `dispatch`, `ranking`, `challenge`, `front`의 `tools/*-ui-check.mjs` 모두 통과.
- 기존 관련 회귀: `terrcheck`, `battlecheck`, `frontcheck`, `presetcheck`, `codexcheck`, `raidcheck`, `arenacheck` 모두 통과. 가짜 DB/SQLite 검사와 실제 HTTP 검수를 구별한다. 점령 288가지 재생 일치, 전선 종당 67판, 대전 50판·토벌 한도 경계를 포함한다.
- `node --check`(game/territory/신규 HTTP 도구), `npm run build`, `git diff --check` 통과. 빌드는 배포가 아니다.

| `docs/ui/previews/` 파일 | 근거 |
|---|---|
| `integration-territory-result-pc.jpg` | 실제 로컬 API의 점령 성공 결과, PC 기본 뷰포트 |
| `integration-territory-result-390.jpg` | 같은 결과의 390px 배치 |
| `integration-territory-map-360.jpg` | 메모리 예시 360px 지도/내비게이션 |
| `integration-pull-result-360.jpg` | 메모리 예시 모집 결과 native 팝업 |
| `integration-raid-result-360.jpg` | 메모리 예시 레이드 피해/보상/복귀 메뉴 |
| `integration-hangar-1280.jpg` | 작은 PC 격납고, 큰 이그니스와 정지 목록 |
| `integration-layout-check.json` | 관찰한 화면의 폭/가로 넘침/메뉴/로드된 이미지 검사. PC에서 숨겨진 모바일 더보기는 목록에서 제외 |

캡처는 브라우저 원본 JPEG다. 상태 전환 직후 로딩/페이드가 찍힌 지도 캡처는 최종 지도가 보이는 캡처로 교체했다. DOM 뷰포트와 캡처 픽셀은 브라우저 스크롤바/출력 크기에 따라 다를 수 있다.

## 다음 작업과 통합 경계

1. 사용자가 main 통합을 지시하면 main 담당 Claude와 전투 계약부터 조율한다. 현재 UI의 순차 재생과 main의 교대/동시 레이드·분석을 같은 데이터/표시 계약으로 연결한다. main의 서킷·정제 코어·기체별 프리셋·귀속(현재 main 스위치 꺼짐)도 별도 대응한다. 안내/도감/로그인도 최종 계약에 맞게 다시 확인한다.
2. 기존 가상 병합은 레이드 3곳과 전선 3곳, 총 game.js 6블록 충돌이었다. 이번에도 실제 파일을 합치지 않는다. 최신 가상 검사 결과는 아래 완료 기록에 남긴다. 텍스트 충돌이 없는 영역도 의미상 호환을 보장하지 않는다.
3. 실제 모바일 키보드/터치·Safari·앱 복귀, 연결 단절/불명확한 소비 결과 재조회, 성능 전후 비교와 신규 사용자 탐색 관찰은 후속 출시 검수다. 실제 1시간 원정 귀환/수령, 자연 보호 만료·주간 초기화/cron·remote 인증은 이번 localhost HTTP 검수 범위 밖이다. 관련 규칙의 자동 검사는 통과했다.
4. `js/net.js` 점령 오류의 `minLv`/`myLv` 보존 요청은 Claude 담당으로 CONTRACT에 기록한다. 프론트는 누락된 필드에도 정상 안내한다.

UI 브랜치의 현행 기능을 로컬에서 검수한 단계는 완료다. 다음 작업을 새로운 화면 제작으로 다시 시작하지 않는다. 운영에 반영하려면 사용자 지시와 main 계약 통합이 필요하다.

## 완료 기록

- 구현 커밋: `6e346d0 fix(ui): complete integration review and preserve operation routing`.
- 최종 fetch: main `ab45b4c` 그대로, 작업 시작 UI 원격과 로컬은 `8b61f56`로 일치했다. UI의 변경만 커밋했다.
- `git merge-tree --write-tree 6e346d0 origin/main`: exit 1, 가상 tree `445f9888afeca098b0aa06670806da401073c65b`. 실제 작업 폴더/index/브랜치를 합치지 않았다.
- `js/game.js` 충돌은 **8블록**이다. 기존 레이드 3곳(`drawRaid`/`raidRunGo`/`renderRaidResult`), 전선 3곳(초기 진입/`renderFront`/`renderFrontResult`)에 더해 `startBattle`의 교대 시뮬/출발 메뉴, `renderBreachResult`의 점령 결과/분석 슬롯이 겹친다.
- 가상 파일의 marker 시작 줄은 1551/1615/1683/2438/3316/3357/3552/3890이다. 실제 소스 줄과 혼동하지 않는다. 위 tree는 충돌 자료이며 실행 가능한 앱이나 통합 완료본이 아니다.
- 새 충돌 2곳은 main의 교대 기체 배열을 유지하며 토벌의 `navAs`를 전달하고, 새 점령 결과에 main의 분석 표시 계약을 연결해야 하는 지점이다. 해결을 위해 main 엔진·분석 코드를 지금 반입하지 않는다. 같은 계약 조율 후 재생/보상/분석·복귀를 함께 검증한다.
- 후속 검수 기록과 구현을 `origin/codex/ui-rebuild`에만 푸시한다. main 통합·운영 배포 없음.
