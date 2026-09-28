# 전선 UI 구현 — 2026-09-28

## 범위와 보존 계약

`codex/ui-rebuild` 전용 프론트 작업이다. ChatGPT가 주도하며 main은 Claude 주도권을 유지한다. main 파일을 복사하거나 merge/rebase/cherry-pick하지 않았고 운영 배포하지 않았다.

작업 전에 `AGENTS.md`, `CONTRACT.md`, `IMPLEMENTATION.md`, `rebuild-plan-2026-09-20.md` 및 기존 전선/이야기 코드를 확인했다. 전용 전선 시안은 9장에 없으므로 `detachment.png`의 임무 목록/출격 준비와 `mainlobby_2.png`의 작전 상세 구도를 적용했다. 새 시스템/삽화를 만들지 않았다.

- 기존 2장·11작전, 순차 개방, 콘텐츠 해금, 대사/화자/장면 전환, 삽화 원본을 유지한다.
- 온라인은 서버 판정과 선봉/예비 최대 2기의 순차 투입. 오프라인은 기존 선택 기체 1기 판정을 유지한다. 동시 2:1 전투를 가져오지 않는다.
- 첫 클리어 보상과 경험치/피로도 계산은 기존 규칙 그대로다. 다시 보기에서 campaign/재화/보상 수령 이력을 초기화하지 않는다.
- 이그니스 및 다른 기체/몬스터 카드는 원본 정지 PNG. 격납고 큰 이그니스만 승인된 10프레임 정책을 유지한다.
- `server/*`, `data/front.js`, `data/story.js`, `data/balance.js`, `js/front.js`, `js/breach.js`, `js/stats.js`는 수정하지 않았다.

## 구현 위치

| 파일 | 책임 |
|---|---|
| `js/ui/front.js` | 표시 전용 `frontCampaignView`, `frontStoryView`, `frontResultView`. 장 선택/진행, 작전 목록, 지형/적/첫 보상/편성, 삽화/대사/결과. 상태 변경이나 API 호출 없음 |
| `themes/front-v2.css` | `.fv-*` 전용 스타일. PC 장 목록/임무 목록/작전 상세 3열, 940px 이하 장 탭+2열, 700px 이하 세로 배치. PC 상세 본문 스크롤과 출격 버튼 고정. 대사 삽화 영역은 로딩과 무관하게 유지하며 `object-fit:contain` |
| `js/game.js` | 기존 terr 화면을 공유하며 선택 상세/출격/전투 재생/결과/정비에 연결. 이야기 중 이탈, 대사 완료 기록, 계정/요청 격리. 오프라인 저장 위치 티커 문구 수정 |
| `js/ui/icons.js` | 클리어 표시용 check SVG 추가 |
| `index.html` | 전선 스타일 로드와 game 캐시 버전 갱신 |
| `tools/ui-preview.mjs` | `--sample-front`, `--sample-front-new`, `--sample-front-chapter2`, `--sample-front-delay`, `--sample-front-offline`. 메모리 전용 진행/보상/정비 예시. 운영 프록시·DB 없음 |
| `tools/front-ui-check.mjs` | 실제 game 함수의 중단/비동기 응답/편성/보상 수신/다시 보기/정비 계정 격리를 VM에서 실행 |

기존 기체 PNG, 지형 `assets/terrain/*.webp`, 이야기 `assets/story/*.webp`만 사용했다. 새 생성 에셋/프롬프트 없음. 배너 CSS 변수의 URL은 stylesheet 기준으로 해석되므로 `../assets/story/`로 지정했다.

## 동작과 이탈 처리

1. 임무 행을 선택하면 상세만 바뀐다. 출격 버튼을 눌러야 기존 출격 흐름이 시작된다. 모바일은 선택한 상세로 이동하고 제목에 키보드 포커스를 둔다.
2. `frontTeam()`은 현재 서버의 편성 순서, 편성 안에 있는 선택 기체의 선봉 이동, 원정 기체 제외를 표시한다. 오프라인에서는 선택 기체 1기다.
3. `playScript()`는 원본 beats를 그대로 재생한다. 첫 클릭은 타자 표시 완료, 두 번째 클릭은 다음 대사. 마지막 줄은 다음 행동 이름으로 바뀐다. 다음 버튼은 Enter/Space로 조작 가능하며 모션 감소에서는 타자 효과를 즉시 완료한다. 화면 읽기 도구에는 완료된 한 문장을 안내한다.
4. `go()`/로그인/로그아웃에서 `stopScript()`가 대기 Promise와 타이머를 정리한다. 과거에는 숨겨진 storyView가 DOM에 남으면 클릭 대기가 해제되지 않았다.
5. 장 도입/전투 전후/장 마무리는 끝까지 보거나 명시적으로 건너뛴 뒤에만 seen을 기록한다. 자동 장 도입에서 나가면 해당 세션에서는 목록에 머물 수 있게 하고, 다시 보기로 도입을 재개할 수 있다. 미완료 도입을 영구 열람 완료로 저장하지 않는다. 기존 `rowar.seen.v1` 저장 형식은 유지한다.
6. 출격 전 로컬 잠금도 확인하지만 최종 판정은 서버다. 출격 시작 때 S 객체/계정 ID/요청 번호/온라인 여부를 캡처한다. 온라인 요청 실패를 오프라인 전투로 바꿔 판정하지 않는다.
7. 서버가 이미 처리한 응답은 같은 계정에 저장한다. 화면을 떠났으면 재생/결과를 다시 열지 않고, 전선으로 돌아와 있다면 목록만 갱신한다. 다른 계정/S 객체에는 반영하지 않는다. 방어선 사이의 대기와 보스 등장 뒤에도 재생 소유권을 확인한다.
8. 결과는 돌파/후퇴, 첫 보상/재도전 무보상, 경험치/피로도/해금, 전선 복귀/정비/격납고를 보여준다. 정비 응답도 계정이 바뀌면 적용하지 않고, 원래 결과 버튼에만 표시를 갱신한다. 오프라인/크레딧 부족/정비 완료를 버튼에서 구분한다.

## 검증

운영 계정의 재화를 사용하지 않았다. 아래 브라우저 검수는 localhost의 가상 계정/메모리 진행으로 실행했다.

- `node --check js/game.js`, `js/ui/front.js`, `tools/ui-preview.mjs`: 통과.
- `node tools/front-ui-check.mjs`: 잠금/클리어/편성 없음/정지 스프라이트/HTML escaping, 타자 효과/다음/스킵/중단, 도입 이탈 후 강제 재진입 방지, 완료 후 열람 기록, 온라인 실패의 로컬 판정 차단, 화면 이탈 후 서버 결과 보존, 계정 교체 격리, 순차 편성, 방어선 사이 이탈, 이야기 되감기 진행 보존, 정비 응답 계정 격리 통과.
- `node tools/frontcheck.mjs` 기본 400판: 기존 1장/2장 난이도·진행·해금·서버 응답 재생 검사 통과. 밸런스를 수정하지 않았다.
- `node tools/battle-ui-check.mjs`, `node tools/challenge-ui-check.mjs`: 기존 대전/시련/레이드 회귀 검사 통과.
- `npm run build`, `git diff --check`: 통과.
- 1440×1080/1024×900/390×844/360×800: 목록·선택 상세·대사·결과 검수. 가로 넘침과 깨진 활성 화면 이미지 없음. 2장은 별도 메모리 진행 예시에서 PC/360px 확인.
- 브라우저 행동: 대사 중 나가기→목록, 재진입→전 대사, 첫 클리어 +400크레딧/+50스크랩, 경험치/피로도, 정비 −118크레딧/피로도 0, 재도전 첫 보상 없음, 다음 작전 개방, 장 다시 보기 후 3/5 진행 보존, 오프라인 1기/보상/연결 필요 정비 비활성 확인. 숫자는 가상 Lv.32 편성의 해당 시점 예시다.

캡처는 `docs/ui/previews/front-*.jpg`. 브라우저 캡처 원본 JPEG를 재인코딩하지 않고 저장했다. 파일의 viewport 표기는 DOM viewport 기준이며 실제 캡처는 스크롤바 영역을 제외할 수 있다. 2장 PC 캡처는 기본 1280×720이다.

재현: `node tools/ui-preview.mjs 8817 --sample-front --sample-front-delay` → 시작하기 → 지휘실의 전선 이어하기. 2장은 `8820 --sample-front --sample-front-chapter2`, 첫 도입/오프라인은 `8818 --sample-front --sample-front-new --sample-front-offline`. 미리보기 페이지를 새로 읽으면 열람 표가 초기 예시 값으로 돌아간다. 이 옵션은 실제 서버의 인증/DB/원자성 검증을 대체하지 않는다.

## main과 남은 작업

2026-09-28 `git fetch origin main codex/ui-rebuild` 후 main은 `ab45b4c` 그대로다. 09-28 인계 사항과 기존 레이드 합동전 충돌은 이전 주간 도전 기록을 이어받는다. 본 변경의 가상 병합 결과와 커밋/푸시 상태는 아래 완료 기록에 추가한다.

- 전체 UI 개편 완료가 아니다. 다음은 **공통 모달/작전 안내/빈·오류 상태 정리와 레거시 스타일 충돌 점검**이다.
- 이후 실제 API 통합 검수. 현 UI 브랜치 서버 계약과 운영 main의 교대/동시 합동전, 분석, 서킷/정제 코어/기체별 프리셋/귀속을 구별해 통합할 필요가 있다.
- main 병합과 운영 배포는 UI 전체 완성 후 사용자의 별도 지시를 따른다.

## 완료 기록과 가상 병합

- 구현 커밋: `1530407 feat(ui): rebuild story campaign and operation reports`.
- 가상 검사: `git merge-tree --write-tree --name-only origin/main HEAD` (`1530407` 대 `ab45b4c`) → exit 1. 반환 tree `c3b3f55654860c0c3f840d1d30ec895821b69092`. 실제 checkout/브랜치/merge 상태는 바꾸지 않았다.
- 충돌 파일은 `js/game.js` 하나, 충돌 블록은 6곳이다. 기존 레이드 `drawRaid`/`raidRunGo`/`renderRaidResult` 3곳은 순차 UI와 main 합동전/분석 계약 차이다.
- 새 3곳: `_frontCh`/`setFrontCh` 인접 main의 `frontAfterState()` 블록(서버 기록 수신 후 장/초기 화면 정리), `renderFront()`(장 선택·이미 진행한 계정의 도입·서버 준비 상태), `renderFrontResult()`(main 전투 분석과 새 작전 보고 표시).
- UI는 home에서 시작하므로 main의 과거 '대문 뒤에서 신규 전선 재생' 진입 구조와 다르다. **새 브라우저에서 이미 진행한 계정의 도입 처리, 상태 수신 이후 장/선택 재설정은 main 통합 때 양쪽 계약을 대조해야 한다.** 이 작업에서 main의 준비 플래그/진입 함수나 분석 코드를 복사하지 않았다. Git 자동 병합 구간까지 의미상 호환된다고 주장하지 않는다.
- 위 검사는 충돌 위치 기록이며 즉시 main 병합/배포 가능 판정이 아니다. 전선 표시/이탈 검수는 UI 브랜치 자체에서 통과했다.
- 후속 기록 커밋과 구현 커밋은 `origin/codex/ui-rebuild`로만 푸시한다. main 병합/운영 배포 없음.
