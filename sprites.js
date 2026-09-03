/* =============================================================
 * ROWAR - 로봇 스프라이트 (픽셀아트 PNG)
 *   - assets/<id>.png : 440x420 캔버스, 배경 투명, 바닥(발) 정렬
 *   - 캔버스가 같으므로 등급이 높을수록 화면에서도 실제로 더 크게 보인다
 *
 *   [방향 규칙] 원본 그림 10장은 전부 '왼쪽'을 보고 있다(장비·날개가 오른쪽으로 뻗음).
 *   SPRITES[id](faceRight) - faceRight=true 면 좌우 반전해서 오른쪽을 보게 한다.
 *   아레나는 내 기체가 왼쪽에 서므로 오른쪽(true), 상대는 오른쪽에 서므로 왼쪽(false)을
 *   보게 해야 서로 마주본다. 초상화(격납고/뽑기)는 원본 방향 그대로 쓴다.
 *   나중에 오른쪽을 보는 그림을 추가하면 FACE_RIGHT 에 id 를 넣으면 된다.
 * ============================================================= */
(function () {
  const IDS = ['mule', 'dune', 'ranger', 'vanguard', 'azure',
               'glacier', 'wraith', 'oracle', 'seraph', 'nemesis'];

  const FACE_RIGHT = {};                 // 원본이 이미 오른쪽을 보는 기체 id 를 여기에

  const S = {};
  for (const id of IDS) {
    S[id] = function (faceRight) {
      const native = !!FACE_RIGHT[id];   // 이 그림이 원래 보는 방향
      const flip = native !== !!faceRight;
      return '<img class="mecha' + (flip ? ' flip' : '') + '" src="assets/' + id +
             '.png" alt="' + id + '" draggable="false">';
    };
  }

  // 전투 중 첫 표시가 늦지 않도록 미리 받아둔다
  IDS.forEach(function (id) { const i = new Image(); i.src = 'assets/' + id + '.png'; });

  window.SPRITES = S;
  window.SPRITE_IDS = IDS;
})();
