# 효과음 실전 연결 — 2026-10-08

## 상태

사용자 “효과음은 만들어져 있으니 연결해보자”에 따라 로컬 main(b411dfa 기준)에 구현·검수. 이번 변경은 **미커밋·미푸시·미배포**다. 운영은 이전 공격 모션 시범 배포(6856fbc, Worker10089967-a809-443b-b2e1-a4deaec5f568) 그대로이며 운영에서 새 소리가 들린다고 보고하지 않는다.

## 연결

- `assets/sfx/`: Claude의 proto/juice/sfx에서 trimmed WAV31종 그대로 복사. 5,241,424 bytes. raw/시험대 불변, 게임은 proto를 import하지 않음, 합성음/외부 서비스 없음.
- `js/audio.js`: 첫 trusted pointerdown/keydown 후 활성화, 기본45%, `rowar.audio.v1` 저장(플레이어 저장과 분리). UI클릭 2종 먼저 준비, 나머지 사용 시 준비. 파일당 로딩/디코딩 재사용, 동시 다운로드4/발음8, 짧은 이름별 재생 간격, 종료 감쇠/압축.
- `js/audio-events.js`: 판정 결과를 표시할 때만 재생. 역할별 저격/포격/미사일/빔/개틀링, 일반 타격은 피해/최대내구로 경·중타 및 a/b 변형. 치명/회피/흘려내기/충전/방벽/회복/교대/격파/승패. hit→down 동일 격파 중복 제거. HYDRA는 백팩 문구보다 실제 개틀링/저격 역할을 우선.
- `js/game.js`: 기존 1:1/교대·합동전 재생(시련/레이드/전선/점령/회수도 같은 재생 경로), 스킬/파츠 강화·정비·수동 및 전투 보상 레벨업, 기존 뽑기 충전/결과 공개, 원정/점령/도감 보상 수령. 확정 서버 결과 뒤 성공/실패/수령음. 연결 오류나 요청 의도를 강화 실패 결과로 취급하지 않음.
- `js/ui/brawl-manager.js`: 기존 서버 사건의 표시 단계에만 선택적 audio 주입. 스위치/schema 불변. 현재 운영 난투 off이므로 난투음 추가가 기능 개방은 아님.
- `index.html`, `themes/audio-v2.css`, `js/ui/audio-settings.js`: 상단 **소리** → 음소거/0~100%음량/시험 재생. 기본 재생 정책은 배경 음악 없는 효과음만이다.

## 안전·변경하지 않은 것

소리를 기다리느라 요청/재생/보상 시간을 늘리지 않는다. 강화 충전은 응답 시 중지(최대2.5초), 이후 실제 결과음. 뽑기 시각 연출은 기존 그대로(캡슐/유성 신규 시안 선택·통합 안 함). 전투 TL/배속/스킵/판정·API·서버·DB·경제/밸런스·motion.js 및 원본 기체 그림 불변.

화면 이동·새 재생·스킵·관련 팝업 닫기/교체·계정 교체·로그아웃·음소거/음량0·탭 숨김/pagehide에서 소리 정리. 준비가 늦어 220ms를 넘긴 사건음이나 취소된 세대의 음은 재생하지 않는다. 보상이 확정된 늦은 응답은 기존 규칙대로 반영하면서 이탈 전 소리만 억제한다. 전투 중 음소거 해제 후 이후 사건음은 재개한다. 실패 파일은 현재 페이지에서 반복 요청하지 않고 설정에 안내한다.

## 검사

- `node tools/audio-check.mjs`: 31종/중복/원본 SHA256/WAV 헤더/환경 설정, 사용자 입력 전 무생성·무다운로드, 캐시/다운로드4/발음8, 404/디코딩/활성화 실패, 음소거·0음량·숨김·pagehide·취소·dispose·지연 로딩 격리, 재활성화/역할/격파 중복, 실제 강화/레벨업 함수 및 실제 playBattle/playJoint 함수의 정상/스킵/이탈. 통과.
- UI17종: battle, combat-integration, hangar(내부 loadout 포함), recruitment, common, brawl, dispatch, login, front, challenge, territory, ranking, launch, inventory-performance, development, shard, circuit 체크. 전부 통과. 기존 검사 조건은 유지하고 새 오디오 의존성을 VM에 주입했다. 난투 검사는 실제 SQLite 사건/재생 callback의 소리와 스킵 후 무음도 검사한다.
- `npm run build`, `node --check js/game.js`, audio.js/audio-events.js, `git diff --check` 통과. dist의 WAV31종과 신규 모듈/스타일 포함. release-check 목록에 audio-check를 추가했으며 전체 도메인37종을 이번에 다시 완료한 것은 아니다(도메인 변경 없음).
- 로컬 검수 서버: `node tools/ui-preview.mjs 8808 --sample-pulls --sample-dispatch --sample-shop --sample-challenge --sample-front --sample-brawl`. `.wav` MIME만 검수 서버에 추가. 운영 API/DB를 사용하지 않는 가상 계정/재화·메모리 난투다.
- 실제 브라우저: 시험 재생, 음량45→65, 음소거, 새로고침 후65/음소거 보존, 45/해제 복구. 시련 끝까지 재생/결과(46,269점), 1회 뽑기 결과 크레딧+185, 콘솔 오류/경고0, 설정의 파일 로딩 실패 안내 없음. 390px viewport에서 모달 폭354.67px/가로 넘침 없음. 실제 휴대폰 검수가 아님.
- 청각 출력 녹음/청감 평가를 한 것은 아니다. 최종 겹침·음량·느낌은 사용자가 로컬에서 직접 들어보고 판단한다.

## 이어서

로컬 미리보기 http://127.0.0.1:8808/ 상단 **소리**에서 들을 수 있다. 출시는 사용자 지시 뒤 최신 main/다른 담당 변경 재확인 → 관련 파일만 명시적 커밋 → push origin main → 깨끗한 해당 커밋 checkout에서 빌드·배포 → 운영 WAV31종/JS/CSS/health/브라우저 확인. 원래 미추적 기체 PNG 복사본5개와 tools/__pycache__는 이번 변경과 무관하므로 커밋하지 않는다. 현재 main에서 만든 dist에는 미추적 자료도 복사될 수 있어 이 dist를 그대로 운영에 올리지 않는다.

시각적 Juice/공격 모션 엔진 통합·뽑기 방식 선택·판 길이 조정은 별도 후속이다. 기존 원본/반려 아트/효과음 raw를 삭제하거나 섞지 않는다.
