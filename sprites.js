/* =============================================================
 * ROWAR - 기체/몬스터 스프라이트 (픽셀아트 PNG)
 *   - assets/<id>.png : 30기 모두 440x420 투명 캔버스, 바닥 그림자 제거, 발끝 y=408 정렬
 *   - assets/monsters/<id>.png : 대전 전용 10종, 동일한 투명 캔버스/발끝 기준
 *   - 기체 내부 음영과 검은 외곽선을 보존하고, 등급에 맞는 크기로 비율을 유지한다
 *
 *   [방향 규칙] 기체 30장과 몬스터 10장은 전부 '왼쪽'을 보고 있다(장비·날개가 오른쪽으로 뻗음).
 *   SPRITES[id](faceRight) - faceRight=true 면 좌우 반전해서 오른쪽을 보게 한다.
 *   아레나는 내 기체가 왼쪽에 서므로 오른쪽(true), 상대는 오른쪽에 서므로 왼쪽(false)을
 *   보게 해야 서로 마주본다. 초상화(격납고/뽑기)는 원본 방향 그대로 쓴다.
 *   나중에 오른쪽을 보는 그림을 추가하면 FACE_RIGHT 에 id 를 넣으면 된다.
 * ============================================================= */
(function () {
  const IDS = ['mule', 'dune', 'ranger', 'vanguard', 'azure',
               'glacier', 'wraith', 'oracle', 'seraph', 'nemesis',
               'rust', 'scarab', 'bastion', 'kestrel', 'tempest',
               'cobalt', 'specter', 'umbra', 'tyrant', 'atlas',
               'grit', 'chalk', 'tracer', 'mantis', 'howitzer',
               'lancer', 'hex', 'halo', 'auric', 'ignis'];

  const MONSTER_IDS = ["enemy_razorwing","enemy_angler","enemy_jackal","enemy_reaper","enemy_lich","enemy_goliath","enemy_scorpio","enemy_strix","enemy_megalodon","enemy_kabuto"];
  const ALL_IDS = [...IDS,...MONSTER_IDS];
  const FACE_RIGHT = {};                 // 원본이 이미 오른쪽을 보는 기체 id 를 여기에

  const assetPath = id => 'assets/' + (MONSTER_IDS.includes(id)?'monsters/':'') + id + '.png?v=20260903-monsters1';
  const S = {};
  for (const id of ALL_IDS) {
    S[id] = function (faceRight) {
      const native = !!FACE_RIGHT[id];   // 이 그림이 원래 보는 방향
      const flip = native !== !!faceRight;
      return '<img class="mecha' + (flip ? ' flip' : '') + '" src="' + assetPath(id) + '" alt="' + id + '" draggable="false">';
    };
  }

  // 전투 중 첫 표시가 늦지 않도록 미리 받아둔다
  ALL_IDS.forEach(function (id) { const i = new Image(); i.src = assetPath(id); });

  window.SPRITES = S;
  window.SPRITE_IDS = IDS;
  window.MONSTER_SPRITE_IDS = MONSTER_IDS;
})();
