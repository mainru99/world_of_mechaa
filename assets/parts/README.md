# 파츠 아이콘 — 규격과 그릴 것 (2026-09-18)

> **2026-09-19 — 25장 전부 들어왔고 게임에 걸었다.** 어디에 걸렸는지와 크기는 §9.
> 아래는 그리기 전에 쓴 규격이다. 다시 그릴 때 그대로 쓴다.

**(그리기 전) 파츠에는 그림이 하나도 없었다.** 상점 카드의 그림 자리에 "무장" 같은 글자가 들어가 있고,
도감의 파츠 칸은 ●○ 표였다. 기체·몬스터는 손그림인데 파츠만 글자라 한 화면 안에서 출처가 갈렸다.

**25장이다** — 파츠 21종 + 슬롯 4종.
등급(C · R · SR · SSR)은 **따로 그리지 않는다.** 게임이 아이콘 둘레에 등급 색 테두리를 친다.
그래서 84장이 아니라 21장이다.

---

## 1. 공통 규격

| | |
|---|---|
| 크기 | **128×128** PNG · **투명 배경**(RGBA) — 재화 아이콘(`assets/ui/coin-*.png`)과 같다 |
| 여백 | 물체가 가운데에서 **약 100px** 를 차지하고 둘레 **12~14px** 는 비운다 — 게임이 그 자리에 등급 테두리를 친다 |
| 시점 | **3/4 사선 시점**(비스듬히 내려다본 각도). 스크랩 코인 아이콘과 같은 각도 |
| 빛 | 왼쪽 위에서 |
| 화풍 | **픽셀아트 게임 아이콘.** 또렷한 어두운 외곽선(1~2px) · 금속 음영 · 적은 색 수. 기체 그림(`assets/*.png`)과 같은 세계의 물건으로 보여야 한다 |
| 바탕색 | **무채색 건메탈·강철**이 기본. 색은 빛나는 부분에만 작게 쓴다(아래 '색') |
| 넣지 말 것 | 글자 · 숫자 · 로고 · 배경 · 테두리 · 바닥 그림자 · 물체 밖으로 크게 번지는 빛 |

### 가장 중요한 것 — 32px 에서 알아볼 수 있어야 한다

도감 표와 상대 장착 칸에서는 **28~32px** 로 줄어든다. 줄였을 때 **실루엣만으로 서로 구별되어야** 한다.
특히 무장 6종은 모양(길이·굵기·끝 모양)이 확연히 달라야 한다. 세밀한 장식보다 **덩어리의 모양**이 먼저다.

### 색 — 등급 색과 겹치지 않게

게임이 등급을 테두리 색으로 칠한다 — C 회색 `#8a97b5` · R 파랑 `#4aa3ff` · SR 보라 `#c07bff` · SSR 주황금 `#ffb03a`.
**아이콘 전체를 파랑·보라·금색으로 칠하면 등급처럼 읽힌다.** 몸체는 무채색으로 두고, 빛나는 부분만 기능에 따라 —

| 빛 | 쓰는 곳 |
|---|---|
| **청록·흰빛** | 광선 · 전기 · 전자기 (빔 세이버 · 레일건 · 포톤 랜스 · 실드) |
| **주황빛** | 열 · 추진 불꽃 (부스터 분사구 · 리액터 노심) |
| **적주황** | 과부하 · 위험 (오버드라이브만) |

**피할 것 두 가지** —
- **붉은 점 세 개(삼각형) · 검은 결정** — 적 '나르' 의 표식이다. 플레이어 파츠에 쓰면 안 된다
- **청록색 결정 하나** — 재화 '코어' 의 아이콘이다(`coin-core.png`). 코어 슬롯 파츠가 그것처럼 보이면 안 된다

### 세트는 색이 아니라 모양으로

파츠 21종 중 12종이 세 세트에 나뉜다. 같은 세트끼리 **같은 모양 말투**를 쓰면 모아 끼울 때 한 벌로 보인다.

| 세트 | 성향 | 모양 말투 | 파츠 |
|---|---|---|---|
| **강습** | 속도 · 치명 | **가늘고 날렵한 사선**, 뾰족한 끝, 가벼워 보임 | 빔 세이버 · 경량 골격 · 고기동 백 · 오버드라이브 |
| **요새** | 체력 · 방어 | **두껍고 네모난 판**, 굵은 볼트·리벳, 무거워 보임 | 브레이커 · 합금 장갑 · 스러스터 · 리액터 |
| **정밀** | 공격 · 안정 | **매끈한 곡면**, 가는 정밀선, 깔끔한 기계 | 레일건 · 나노 코팅 · AMBAC · 전술 코어 |

세트가 없는 9종은 표준 군용 장비의 모양이다.

---

## 2. 파일 이름 — 대소문자까지 그대로

파일 이름이 곧 게임 안 키다. **대문자가 섞여 있다**(`beamSaber` 의 `S`). 소문자로 바꾸면 운영 서버에서 못 찾는다
(윈도우에서는 같아 보여도 운영 서버는 대소문자를 가린다).

```
assets/parts/beamSaber.png      assets/parts/alloyArmor.png     assets/parts/thruster.png       assets/parts/reactor.png
assets/parts/vulcan.png         assets/parts/reactiveArmor.png  assets/parts/floatPack.png      assets/parts/generator.png
assets/parts/railgun.png        assets/parts/shieldFrame.png    assets/parts/boostUnit.png      assets/parts/tacticalCore.png
assets/parts/photonLance.png    assets/parts/lightFrame.png     assets/parts/highMobility.png   assets/parts/controlChip.png
assets/parts/chaffLauncher.png  assets/parts/nanoCoat.png       assets/parts/ambac.png          assets/parts/overdrive.png
assets/parts/breaker.png

assets/parts/slot-weapon.png    assets/parts/slot-frame.png     assets/parts/slot-booster.png   assets/parts/slot-core.png
```

---

## 3. 공통 프롬프트

아래를 **모든 아이콘 앞에** 붙이고, 뒤에 각 아이콘의 한 줄을 이어 붙인다.

```
Pixel-art game item icon, 128x128, transparent background, single object centered,
3/4 isometric-ish view from above, light from upper left, crisp dark outline,
metallic gunmetal and steel shading, limited palette, sci-fi mecha equipment part,
no text, no background, no frame, no ground shadow, readable silhouette at 32px.
```

---

## 4. 무장 (WEAPON) — 6종

무장은 **실루엣이 가장 중요하다.** 여섯이 줄였을 때 서로 헷갈리면 안 된다 —
짧은 칼 · 뭉툭한 다연장 · 긴 두 줄 레일 · 가장 긴 창 · 네모난 발사관 묶음 · 굵은 말뚝.

### `beamSaber` 빔 세이버 · 강습
- **게임 안** — 공격력이 높고 체력·방어를 조금 내준다. 치고 빠지는 근접 무기
- **모습** — 짧은 금속 **손잡이(발광기)** 에서 **청백색 광선 칼날**이 곧게 뻗은 광선검. 사선으로 기울여 놓는다
- **포인트** — 칼날은 가늘고 곧게. 손잡이는 강습 세트답게 날렵하고 각진 모양
- **피할 것** — 칼날을 굵게 그리면 포톤 랜스와 헷갈린다. 칼날이 **짧고 가늘어야** 한다

```
beam saber: a short angular metal hilt emitting a thin straight cyan-white energy blade, diagonal, sleek and light
```

### `vulcan` 발칸포
- **게임 안** — 공격력은 중간, 속도와 체력이 조금 오른다. 많이 쏘는 무기
- **모습** — **회전 다연장 총열(개틀링)** — 총열 여섯 개가 원통으로 묶이고 뒤에 탄창·탄띠
- **포인트** — 총구 쪽에서 봤을 때 **여러 개의 구멍**이 보이게. 뭉툭하고 짧다
- **피할 것** — 길게 그리면 레일건과 헷갈린다

```
vulcan cannon: a short chunky rotary gatling with six barrels bundled in a cylinder, ammo belt feeding from the back, muzzle holes visible
```

### `railgun` 레일건 · 정밀
- **게임 안** — 치명타가 높고 체력을 내준다. 먼 거리에서 정확하게 한 방
- **모습** — **길고 가는 평행 레일 두 줄**, 레일 사이에 **청록 전기 아크**, 뒤쪽에 코일 · 위에 작은 조준경
- **포인트** — 정밀 세트답게 매끈한 곡면과 가는 선. 무장 중 **가장 길고 가늘다**
- **피할 것** — 총열을 원통 하나로 그리면 평범한 소총이 된다. **두 줄 레일**이 이 무기의 얼굴이다

```
railgun: a long slender weapon made of two parallel rails with cyan electric arcs between them, coils at the rear, small scope on top, sleek precise design
```

### `photonLance` 포톤 랜스
- **게임 안** — 공격력이 무장 중 **가장 높고** 방어를 가장 많이 내준다. 모든 것을 한 번에 거는 무기
- **모습** — 긴 자루 끝에 **원뿔형 광자 창날** — 창날이 청백색으로 빛난다. 기병의 돌격창(랜스) 모양
- **포인트** — 창날은 **넓은 원뿔**, 손잡이 쪽에 손보호대(원반). 빔 세이버와 **모양이 달라야** 한다
- **피할 것** — 광선 칼날처럼 가늘게 그리지 말 것

```
photon lance: a long jousting lance with a wide conical glowing cyan-white energy tip and a round hand guard, heavy and aggressive
```

### `chaffLauncher` 채프 런처
- **게임 안** — 공격은 무장 중 가장 약하지만 속도·치명·**체력**이 오른다. 대신 **쏠수록 내 속도가 조금씩 떨어진다**(한 번에 −0.68%, 최대 5겹 −3.4%)
- **모습** — 네모난 상자에 **발사관 4~6개**가 격자로 뚫린 다연장 발사기. 발사관 하나에서 **은박 조각(채프)** 이 반짝이며 흩날린다
- **포인트** — 채프(전파 교란용 은박)는 원래 **몸을 지키는** 장비다 — 무장인데 체력이 오르는 이유다. 흩날리는 은색 조각이 그걸 보여 준다
- **피할 것** — 미사일 탄두를 크게 그리면 공격 무기처럼 보인다. 이건 **몸을 지키는** 무장이다

```
chaff launcher: a boxy multi-tube launcher with a 2x3 grid of tubes, a burst of glittering silver foil flakes drifting out of one tube
```

### `breaker` 브레이커 · 요새
- **게임 안** — 느려지는 대신 **상대의 방어를 뚫는다** — 타격마다 6~9%(등급이 높을수록) 확률로 상대 방어의 절반을 무시한다. 무겁고 확실한 한 방
- **모습** — **유압식 말뚝 박는 장치(파일 벙커)** — 굵은 피스톤 원통 끝에 쐐기형 강철 말뚝. 옆에 유압 호스
- **포인트** — 요새 세트답게 두껍고 네모나며 볼트가 굵다. **장갑을 부수는** 느낌
- **피할 것** — 망치 머리처럼 그리면 둔기로 읽힌다. **뾰족한 말뚝**이 앞을 향한다

```
breaker pile bunker: a heavy hydraulic piston cylinder driving a thick wedge-shaped steel spike forward, hydraulic hoses, bulky square plates with large bolts
```

---

## 5. 프레임 (FRAME) — 5종

프레임은 몸을 감싸는 장갑이다. **장갑판 하나** 또는 **흉갑 한 조각**을 그린다 — 기체 전체를 그리지 않는다.

### `alloyArmor` 합금 장갑 · 요새
- **게임 안** — 체력이 크게 오르고 방어도 오른다. 회피는 내준다
- **모습** — **두꺼운 겹판 흉갑** — 강판 세 겹이 겹쳐지고 가장자리에 굵은 리벳
- **포인트** — 가장 **무겁고 두꺼워** 보여야 한다

```
alloy armor: a thick layered chest armor plate, three overlapping steel plates, heavy rivets along the edges, very sturdy
```

### `reactiveArmor` 리액티브 아머
- **게임 안** — 체력이 크게 오르고 치명도 조금 오른다
- **모습** — 장갑판 위에 **작은 네모 블록(폭발반응장갑)** 이 격자로 촘촘히 붙어 있다. 블록 몇 개에 노랑·검정 경고 줄무늬
- **포인트** — **블록 격자**가 이 장갑의 얼굴이다

```
reactive armor: an armor plate covered in a grid of small square explosive reactive blocks, a few blocks with yellow-black hazard stripes
```

### `shieldFrame` 실드 프레임
- **게임 안** — 방어가 **가장 많이** 오르고 회피도 조금. 체력은 조금 내준다
- **모습** — **방패형 장갑판**, 가장자리를 따라 **청록 에너지 막**이 얇게 떠 있다(반투명 육각 무늬)
- **포인트** — 방패 실루엣이 한눈에 보여야 한다

```
shield frame: a shield-shaped armor plate with a thin translucent cyan hexagonal energy barrier hovering along its edge
```

### `lightFrame` 경량 골격 · 강습
- **게임 안** — 회피와 속도가 오르고 공격을 내준다. 가볍게 피하는 몸
- **모습** — 장갑판이 아니라 **골조** — 삼각 트러스 뼈대, 구멍이 숭숭 뚫린 경량 합금. 속이 비쳐 보인다
- **포인트** — 다른 프레임과 반대로 **텅 비고 가벼워** 보여야 한다

```
light frame: a skeletal lightweight chassis frame of triangular trusses and perforated alloy struts, mostly hollow, sleek and angular
```

### `nanoCoat` 나노 코팅 · 정밀
- **게임 안** — 체력·방어·회피가 고루 오른다. 무난하고 안정적
- **모습** — 장갑판 한 장인데 **절반은 거친 금속, 절반은 은빛으로 매끈하게 코팅된** 상태. 코팅된 쪽에 가는 육각 무늬가 은은하게 반짝인다
- **포인트** — **'덮여 가는 중'** 이 보여야 코팅으로 읽힌다

```
nano coating: an armor plate half rough raw metal and half covered in a smooth mirror-like silver coating with a faint fine hexagonal shimmer, the coating edge visible
```

---

## 6. 부스터 (BOOSTER) — 5종

부스터는 등이나 다리에 다는 추진·기동 장치다. 불꽃은 **주황색으로 짧게** — 길게 그리면 아이콘이 불꽃이 된다.

### `thruster` 스러스터 · 요새
- **게임 안** — 속도가 오르고 **방어가 크게** 오른다. 무거운 몸을 밀어 주는 큰 엔진
- **모습** — 두꺼운 장갑으로 감싼 **커다란 분사구 하나**, 끝에서 짧은 주황 불꽃
- **포인트** — 요새 세트답게 뭉툭하고 튼튼하다

```
thruster: one large armored rocket nozzle wrapped in thick square plating, a short orange exhaust flame, heavy and sturdy
```

### `floatPack` 플로트 팩
- **게임 안** — 속도가 부스터 중 **가장 많이** 오르고, 방어는 가장 많이 내준다
- **모습** — 둥근 **원반형 부유 장치** — 아래로 **푸른 부유장**(불꽃이 아니라 빛의 원반)이 떠 있다
- **포인트** — 불꽃 없이 **떠 있는** 느낌. 얇고 가볍다

```
float pack: a flat round disc-shaped hover device with a soft glowing cyan levitation field beneath it instead of flames, thin and light
```

### `boostUnit` 부스트 유닛
- **게임 안** — 속도와 회피가 고루 오른다. 표준형
- **모습** — **나란한 소형 분사구 두 개**가 한 틀에 묶인 모듈, 옆에 작은 안정익
- **포인트** — 가장 **평범한 부스터**. 다른 부스터의 기준이 된다

```
boost unit: a compact module with two small side-by-side thruster nozzles and small stabilizer fins, short orange flames, standard military design
```

### `highMobility` 고기동 백 · 강습
- **게임 안** — 속도·회피·치명이 오르고 **체력을 가장 많이** 내준다. 빠르지만 약하다
- **모습** — 등에 매는 **배낭형** 장치 — **사방으로 달린 작은 분사구(버니어)** 여러 개와 접이식 날개 한 쌍
- **포인트** — 여러 방향 분사구가 '급선회' 를 보여 준다. 날렵한 사선

```
high-mobility backpack: a sleek angular backpack booster with many small vernier nozzles pointing in different directions and a pair of folding wing fins
```

### `ambac` AMBAC · 정밀
- **게임 안** — 회피가 부스터 중 **가장 많이** 오르고 치명도 오른다
- **모습** — **분사구가 없다.** 관절로 이어진 **가동 팔 끝에 무게추**가 달린 자세 제어 장치 — 추를 움직여 몸의 균형을 바꾼다(능동 질량 균형 제어). 가운데에 자이로 고리
- **포인트** — 다른 부스터와 달리 **불꽃이 없다.** 정밀 세트답게 매끈하고 기계적
- **피할 것** — 분사구를 그리면 다른 부스터와 같아진다

```
AMBAC unit: an attitude control device with no nozzles, articulated jointed arms ending in counterweights around a central gyroscope ring, sleek precise mechanism, no flames
```

---

## 7. 코어 (CORE) — 5종

코어는 기체 속의 동력·연산 장치다. **재화 '코어'(청록 결정)처럼 보이면 안 된다** — 결정 하나를 그리지 말 것.

### `reactor` 리액터 · 요새
- **게임 안** — 체력과 방어가 크게 오른다. 튼튼한 심장
- **모습** — 두꺼운 **원통형 차폐 케이스**, 작은 창으로 **주황 노심**이 빛난다. 둘레에 방열핀
- **포인트** — 두껍고 무겁다. 빛은 창 안에만

```
reactor: a thick cylindrical shielded casing with a small window showing a glowing orange core inside, cooling fins around it, heavy bolted plates
```

### `generator` 제너레이터
- **게임 안** — 체력이 코어 중 **가장 많이** 오르고 치명도 오른다. 대신 느려진다
- **모습** — **구리 코일이 감긴 원통**과 터빈 — 코일 사이로 작은 청백 전기 불꽃
- **포인트** — 구리색 코일이 다른 코어와 구별되는 점이다

```
generator: a turbine cylinder wrapped in copper coils with small cyan-white electric sparks between the windings
```

### `tacticalCore` 전술 코어 · 정밀
- **게임 안** — 방어가 크게 오르고 치명도 오른다. 싸움을 읽는 두뇌
- **모습** — **육각형 연산 모듈** 위에 **작은 홀로그램 전술판**(격자와 조준선)이 떠 있다
- **포인트** — 결정이 아니라 **기계 모듈 + 홀로그램**. 정밀 세트답게 매끈한 곡면
- **피할 것** — 청록 결정 하나로 그리면 재화 코어와 같아진다

```
tactical core: a sleek hexagonal computing module with a small holographic tactical display of grid lines and targeting reticle floating above it
```

### `controlChip` 컨트롤 칩
- **게임 안** — 체력과 방어가 고루 오른다. 안정적인 제어 장치
- **모습** — 납작한 **네모 반도체 칩** — 가장자리에 금속 핀 다리가 줄지어 있고 표면에 회로 문양
- **포인트** — 전술 코어(육각 + 홀로그램)와 **모양으로** 구별된다. 이건 **납작한 네모**

```
control chip: a flat square microchip with rows of metal pins along its edges and circuit patterns on its surface
```

### `overdrive` 오버드라이브 · 강습
- **게임 안** — 공격이 크게 오르고 **체력·방어를 가장 많이** 내준다. 스스로를 태우는 힘
- **모습** — 금이 간 **구형 동력 장치**, 균열 사이로 **적주황 빛**이 새고 증기가 뿜어진다. 경고등
- **포인트** — **위험해 보여야** 한다. 이 파츠만 적주황을 쓴다
- **피할 것** — 붉은 점 세 개(나르 표식)를 넣지 말 것

```
overdrive: a cracked spherical power unit leaking intense red-orange light through its fractures, venting steam, a small warning light, dangerous and unstable
```

---

## 8. 슬롯 아이콘 4종

파츠가 아니라 **칸의 종류**를 나타낸다. 두 곳에 쓴다 —
**비어 있는 장착 칸**(그리기 전에는 "무장" 글자였다), 그리고 **파츠 그림이 아직 없을 때의 대신 그림**.

위의 21종과 **다르게 그린다** — 사물이 아니라 **기호**다.

| | |
|---|---|
| 크기 | 128×128 · 투명 배경 |
| 모양 | **단색 실루엣** — 밝은 회청색 `#c9d4ec` 한 가지 + 안쪽의 가는 선 몇 개. 음영·그러데이션 없음 |
| 굵기 | 20px 로 줄여도 읽히게 **굵고 단순하게** |

| 파일 | 칸 | 그릴 것 |
|---|---|---|
| `slot-weapon.png` | 무장 | 옆에서 본 **총신 하나**의 단순한 실루엣 |
| `slot-frame.png` | 프레임 | 앞에서 본 **흉갑(가슴 장갑)** 실루엣 |
| `slot-booster.png` | 부스터 | **분사구 하나 + 짧은 불꽃 세 줄** |
| `slot-core.png` | 코어 | **동심원 둘**(원 안의 원) — 노심 |

```
Simple flat monochrome icon glyph, 128x128, transparent background, single light grey-blue color (#c9d4ec),
bold thick silhouette with a few thin inner lines, no shading, no gradient, no text, readable at 20px.
```
뒤에 이어 붙일 한 줄 —
- `slot-weapon`: `side view silhouette of a single gun barrel`
- `slot-frame`: `front view silhouette of a chest armor plate`
- `slot-booster`: `a rocket nozzle with three short flame lines`
- `slot-core`: `two concentric circles, a reactor core symbol`

---

## 9. 넣는 법과 확인

1. 원화를 위 이름 그대로 `assets/parts/` 에 넣는다(128×128 투명 PNG).
   크기가 다르게 나왔으면 그대로 줘도 된다 — 옮기면서 맞춘다
2. 넣을 때 알파만 정리한다 — 8 미만은 0, 240 이상은 255(가장자리 반투명 먼지 제거).
   2026-09-19 에 들어온 25장은 크기·이름이 전부 맞아 이것만 했다(합계 263KB)
3. 그림은 `js/game.js` 의 `partIco(파츠, 크기)` 하나로 건다. 크기는 네 가지 —

   | 크기 | px | 쓰는 곳 |
   |---|---|---|
   | `xs` | 22 | 로봇 상세의 장착 칸 · 상대 장착 칸 · 전투 결과 줄 · 도감 파츠 표 |
   | `sm` | 38 | 인벤토리 · 격납고 장착 칸 · 장착 창 · 합성 목록/결과 · 분해 확인 · 뽑기 결과 목록 |
   | `md` | 52~56 | 상점 카드(다른 칸과 줄을 맞추려 52) |
   | `lg` | 120 | 뽑기 결과의 큰 그림(가장 좋은 것이 파츠일 때) |

   테두리는 **등급 색**(`--rC` · `--rR` · `--rSR` · `--rSSR`)이다. 그림에는 등급을 그리지 않는다
4. **빈 장착 칸**은 슬롯 아이콘을 흐리게(점선 테두리 · 불투명 50%) 띄운다.
   도감에서 **못 모은 줄**도 슬롯 아이콘이다 — 진짜 그림을 먼저 보이면 이름을 `???` 로 가린 뜻이 없다
5. **대신 그림** — 파츠 그림 파일이 없으면(예: 새 파츠를 추가했는데 그림이 아직) 그 칸의 슬롯 아이콘으로 바뀐다.
   **한 장씩 넣어도 된다.** 슬롯 아이콘까지 없으면 깨진 그림이 뜬다 — 슬롯 4장은 지우지 않는다
6. 그림을 **다시 그려 바꿀 때**는 `js/game.js` 의 `PART_ICON_V`(`?v=`)를 올린다.
   이 폴더에는 no-cache 헤더가 없어서, 올리지 않으면 이미 받아 간 브라우저는 옛 그림을 계속 쓴다

빠진 이름이 없는지 확인 —
```bash
node -e "import('./data/balance.js').then(m=>{const fs=require('fs');const k=[...Object.keys(m.PART_BASES),'slot-weapon','slot-frame','slot-booster','slot-core'];const miss=k.filter(x=>!fs.existsSync('assets/parts/'+x+'.png'));console.log('파츠 아이콘',k.length-miss.length,'/',k.length,'· 없는 것:',miss.join(', ')||'없음')})"
```

## 10. 이 문서의 근거

모습은 `data/balance.js` 의 `PART_BASES`(능력치가 무엇을 올리고 내리는가)와 `CONST.PART_SET`(세트)에서 뽑았다.
'게임 안' 줄이 곧 그 근거다 — 예를 들어 포톤 랜스는 공격이 무장 중 가장 높고 방어를 가장 많이 내줘서
'모든 것을 거는 돌격창' 이 됐다. 파츠 수치가 크게 바뀌면 이 설명도 다시 본다.
