# P5 로컬 성능·입력 검수 / Galaxy S26 Ultra 이어받기

2026-09-30, codex/ui-integration. 기준 bdef239. 원본 UI 29733c9 / 운영 main ab45b4c 유지. 서버/DB/공유 수치/기체 에셋/기능 스위치 변경 없음. 운영 배포 없음.

## 이번에 완료한 것

- 부팅 시 모든 기체·몬스터 99장의 PNG를 받던 preload를 저장된 출전 편성 기체만 요청하도록 변경했다. 다른 그림은 해당 화면의 img가 표시될 때 요청된다. 격납고 큰 이그니스만 기존 10프레임 WebP, 카드/대전은 원본 PNG 규칙을 유지한다.
- 격납고 보관함의 누적 ‘더 보기’를 최대60개 페이지로 바꿨다. 전체 여분 파츠에서 이름/등급/슬롯/강화 수치의 AND 검색을 하고 장착 중인 UID를 제외한다. 검색/필터 변경은 첫 페이지, 분해 등 서버 결과로 파츠가 줄면 유효 페이지로 보정한다. 장착·합성의 기존24개 페이지는 유지한다.
- 파츠 그림·설명은 네이티브 강화 버튼으로 묶고 분해는 별도 버튼으로 유지한다. 강화는 기존처럼 즉시 서버 요청이며 확인창을 새로 추가하지 않았다. 키보드 Enter/Space의 기본 버튼 동작, 검색 제출/페이지 이동/필터 변경 뒤 포커스를 유지한다. 계정 변경 시 검색·필터·페이지를 초기화한다. 모바일 검색/필터/페이지/분해 영역 최소44px.
- 보유 기체 전투력을 렌더당 한 번씩 계산해 정렬과 표시에서 공유한다. 장착 UID 집합도 한 번 구성해 전체 파츠에서 제외한다. 영속 캐시나 판정 수치 변경은 없다.
- tools/ui-preview.mjs --sample-performance에서만 가상80기/파츠1,000개의 측정 패널을 제공한다. tools/ui-performance-probe.js는 tools에 있으며 production dist에는 들어가지 않는다. 계정/DB/외부 API 연결 없이 loopback에서만 실행한다.

## 측정 조건과 결과

같은 Windows PC / Codex 인앱 브라우저 / localhost:8844, PC 실제 viewport1174×661(client1161), 네트워크·CPU 감속 없음. 미리보기 서버는 cache-control:no-store이므로 운영 캐시 성능을 대표하지 않는다. 단일 전후 측정이며 반복 표본 통계가 아니다. 파츠1,000개 중8개 장착으로 보관함992개. 가상 계정은 서버 규칙/저장 검수의 대체가 아니다.

| 지표 | 변경 전 | 변경 후 | 해석 |
|---|---:|---:|---|
| 초기 완료된 기체/몬스터 PNG 요청 | 99장 | 2장 | 전체 선요청 제거 |
| 해당 PNG encodedBodySize 합계 | 17,078,399B | 339,744B | 약98% 감소, 총 자산 크기는 유지 |
| 초기 Resource Timing transferSize 합계 | 19,305,658B | 2,539,469B | API/모듈/CSS/그림 등 완료된 resource 합계, navigation HTML 제외 |
| 보관함 끝까지 탐색한 카드 | 992개 | 32개(마지막 페이지) | 중간 페이지도 최대60개 |
| 같은 단계 전체 DOM 요소 | 28,550개 | 2,343개 | 전체 페이지 요소, 파츠 카드만의 수가 아님 |
| 기록된 가장 긴 longtask | 1,085ms | 159ms | 전후 전체 세션의 최댓값. 변경 후 최댓값은 초기 부팅이며 보관함17페이지 탐색 구간에는 기록된50ms 이상 작업이 없었음 |

변경 후 초기 loadEventEnd1,425.8ms / FCP716ms, 변경 전2,282.7ms /672ms. 로딩 완료 시간이 줄었지만 FCP는 좋아지지 않았다. 단일 localhost 표본으로 사용자 체감 속도나 성능 목표 전체 달성을 단정하지 않는다. 초기 총 resource 약2.54MB이므로 계획의 ‘첫 화면 장식1MB 내외’ 목표는 아직 달성으로 판정하지 않았다. 큰 배경 전송량 최적화는 별도 후속이다.

변경 후 페이지 버튼 click Event Timing은 저장된16회에서56–72ms. 이는 해당 클릭의 브라우저 관측값이며 전체 사이트 INP가 아니다. 변경 전에는 제한된 event ring에 hover가 들어가 후반 click 기록 일부가 밀렸다. 전후 click 통계 비교에는 쓰지 않는다.

검색 결과1개를 표시한 보관함 상태의5초 requestAnimationFrame 콜백 간격:300개, 중앙16.7ms /p9516.8ms /최대33.2ms /50ms 초과0, 측정 중 hidden=false. **실제 GPU 프레임률이나 휴대전화 FPS가 아니다.** 홈↔격납고10회 뒤 DOM3119개/카드60개가 동일했다. DOM 누적은 관찰되지 않았지만 JS heap/리스너 누수 검증 완료를 뜻하지 않는다.

측정 방식: [MDN PerformanceObserver.observe](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver/observe)의 supportedEntryTypes/type/buffered 및 event durationThreshold16ms를 사용한다. 미지원 항목은 null이다. [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)의 콜백 간격만 측정하며 숨겨진 탭의 지연은 분리한다. 로그는 메모리 내 최대200건/샘플30개로 제한된다. 보관한 JSON은 가독성을 위해 event 중 click/keydown만 남겼으며 누적 로그다.

원자료: previews/performance-before-2026-09-30.json, performance-after-pc-2026-09-30.json, performance-navigation-pc-2026-09-30.json, performance-mobile-2026-09-30.json.

## UI/회귀 확인

- PC:17페이지 끝까지 전환, 최종 UID 검색, 원래 순서/등급/강화 정렬, 페이지 상한, 같은 페이지에서 강화 버튼 Enter 입력. 가상 API는 소비를403으로 거절하므로 서버 성공을 주장하지 않는다. 기존 저장/정산/API 검수는 server-contracts 기록을 따른다.
- 작은 모바일: 요청360×800, 브라우저 실제330×734(client316). 검색·필터·이전/다음44px, scrollWidth316으로 가로 넘침 없음. Enter로2페이지 이동 후 inv-next 포커스 유지, ‘최종 SSR +0’ 전체 검색→preview-part-1000 한 개→inv-query 포커스 유지. 실물 키보드/터치 검수는 아니다.
- 캡처: previews/performance-inventory-pc-2026-09-30.jpg / performance-inventory-mobile-2026-09-30.jpg. 기존 격납고 배치·파츠 그림·등급 표현 유지.
- 검사: inventory-performance-check, login-ui-check, launch-ui-check, hangar-ui-check(+loadout-ui-check 실제 SQLite 양 모드), common-ui-check, battle-ui-check, preparation-check, check_ignis_rain_integration. 빌드와 git diff --check 통과. dist/tools와 dist/CONTRACT.md 없음 확인.
- 신규 검사는 실제 renderHangar 보관함 부분/핸들러를 VM에서 실행해1,000개 중 장착 제외998UID가17페이지에서 모두 접근되는지,60개 상한/검색+필터/서버 삭제 후 페이지 보정/정확한UID/계정 초기화/선별 preload를 확인한다. 계산을 그대로 복제한 검사로 대체하지 않았다.

## 재현 / 회사에서 이어받기

통합 전용 checkout 및 origin/codex/ui-integration을 확인한다. 원래 codex/ui-rebuild와 운영 main에 섞지 않는다.

마지막 확인에서 원본 UI는29733c9/clean, 운영 main은ab45b4c이며 core-circuit-draft HTML 미커밋 변경과 기존 docs/art·proto 자료가 있었다. 다른 담당 작업으로 보존했고 이번 커밋에 넣지 않았다.

```powershell
node tools/ui-preview.mjs 8844 --sample-performance
node tools/inventory-performance-check.mjs
node tools/login-ui-check.mjs
node tools/launch-ui-check.mjs
npm run build
```

PC에서 http://127.0.0.1:8844/ → 측정 기록 → 시작하기 → 격납고 → 보관함 → 측정 기록 →17페이지→측정 기록. 검색 ‘최종 SSR +0’와 이름/슬롯/등급 조합도 확인한다. 5초 프레임 간격은 탭이 표시되는 조건에서 실행한다. 변경 전 재측정은 원본 checkout을 되돌리지 말고 bdef239의 별도 격리 checkout에 같은 검수 도구를 적용한다. fixture는 서버 시작마다 초기화된다. 실제 Worker 기능 검수가 필요하면 기존 격리 D1 기록을 따라 별도로 실행한다.

## Galaxy S26 Ultra 실기기 체크리스트 — 아직 미실시

사용자에게 Galaxy S26 Ultra가 있으나 현재 연결할 수 없다는 답변을 받았다. OS/브라우저/버전은 미확인이다. PC viewport를 해당 기기의 성능으로 보고하지 않는다. iPhone/iOS와 저사양 PC도 미실시다.

통합 커밋의 승인된 검수 URL이 준비된 뒤 실기기 검수를 시작한다. 현재127.0.0.1:8844는 PC loopback이라 휴대전화에서 접속할 수 없다. 이번 작업에서 LAN 공개/원격 디버깅 권한/운영 배포를 새로 열지 않았다.

| 확인 | 절차 / 기록 | 통과 기준 | 상태 |
|---|---|---|---|
| 환경 | Android/One UI 버전, Chrome 또는 Samsung Internet 버전, 표시 배율, Wi-Fi/모바일망, 절전 여부, 세로/가로 기록 | 같은 조건에서 비교 가능 | 대기 |
| 첫 실행·재방문 | 임시 검수 계정으로 첫 진입/브라우저 닫았다 재진입, 시간·영상 기록 | 대문/재화/선봉/진행 정상, 무한 로딩 없음 | 대기 |
| 보관함 | 많은 파츠 계정에서 검색/한글 입력·취소/17페이지/슬롯/강화 정렬, 소프트 키보드 열고 닫기 | 누락·겹침·가로 넘침 없고 검색/페이지/하단 메뉴를 누를 수 있음 | 대기 |
| 격납고 | 기체 전환/로스터 스크롤/큰 이그니스/장비/프리셋/서킷/계보 | 카드와 대전은 정지 그림, 큰 기체는 모션, 동일 UID에 적용 | 대기 |
| 지도·대전 | 점령 지도 드래그/핀/선택→준비→결과,1:1·교대·합동 보스 및 건너뛰기 | 터치가 닿고 화면 복귀·정산 정상, 재생 중 입력 멎음 없음 | 대기 |
| 복귀·실패 | 홈으로 나가기→복귀, 화면 잠금→복귀, 네트워크 끊기→복구 | 완료된 보상/소비 보존, 실패 원인·재시도 표시 | 대기 |
| 반복·발열 | 메뉴20회, 전투 재생10회,30분 플레이. 버벅임 발생 시각/동작/기기 상태 기록 | 겹친 효과/남은 소리/중복 정산/점진적 조작 악화 없음 | 대기 |
| 접근성 | 확대 글꼴/화면 회전/모션 감소 설정에서 같은 흐름 | 필수 비용/버튼/기체 정보 읽고 누를 수 있음 | 대기 |

실기기 연결 시 이 표에 실제 결과/영상/문제 재현을 채우고 수정한다. 관측하지 않은 배터리/발열/FPS/메모리 수치를 만들지 않는다. 신규 사용자5명 탐색 관찰·대상 마켓/계정 복구 정책·최종 출시 점검도 별도로 남았다. main 반영/운영 배포/귀속·계보 제한 활성화는 사용자 별도 지시 후다.
