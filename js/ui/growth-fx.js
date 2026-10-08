/* 성장 연출 — 강화 · 레벨 업 · 보상 · 버튼. 표시 전용(proto/juice/growth.js 를 게임 화면에 맞춰 옮김 · 2026-10-08).
 * 판정은 서버가 이미 끝냈다 — 여기서는 결과를 받아 보여 주기만 한다.
 * 핵심: 서버를 기다리는 시간을 충전 연출로 가린다(최소 0.9초). 소리 중 결과음은 game.js 가 낸다(audio-check 가 그 자리를 검사한다). */
import { fx, sleep, rnd, clamp, centerOf, animate, pop, shake, floatText, countText, screenFlash, reducedMotion } from './fx-layer.js';

const fmt = n => Math.round(n).toLocaleString('ko-KR');
const STAT_ROWS = [['hp', '내구'], ['atk', '공격'], ['def', '방어'], ['spd', '속도']];
const WALLET = { credit: ['#w-credit', '#ffd45a'], scrap: ['#w-scrap', '#9fc4ff'], core: ['#w-core', '#7ff0ff'] };

export function createGrowthFx({ sound = () => {}, doc = globalThis.document } = {}) {
  /* ── 파츠 · 스킬 강화 ── */
  function enhance(anchor, { minWait = 900 } = {}) {
    const t0 = performance.now(), target = anchor?.querySelector?.('.pico') || anchor;
    let alive = true;
    if (target && !reducedMotion()) (async () => {
      while (alive && target.isConnected) {
        const u = clamp((performance.now() - t0) / Math.max(minWait, 1200), 0, 1), a = 1 + 4 * u, c = centerOf(target);
        target.style.transform = `translate(${rnd(-a, a)}px,${rnd(-a, a)}px) scale(${1 + .06 * u})`;
        target.style.filter = `drop-shadow(0 0 ${6 + 18 * u}px rgba(255,190,80,${.4 + .6 * u})) brightness(${1 + .4 * u})`;
        if (c && Math.random() < .5 * u + .15) fx.spark(c.x + rnd(-1, 1) * c.w * .7, c.y + rnd(-1, 1) * c.h * .7, 1, { v: .22, life: 300, g: 0 });
        await sleep(33);
      }
      target.style.transform = ''; target.style.filter = '';
    })();
    const stop = () => { alive = false; if (target) { target.style.transform = ''; target.style.filter = ''; } };
    let at = null;
    return {
      ready: (async () => { await sleep(Math.max(0, minWait - (performance.now() - t0))); at = centerOf(target) || centerOf(anchor); stop(); })(),
      /* 모루가 내려친다 — 결과 직전 0.24초 */
      async strike() {
        at = at || centerOf(target) || centerOf(anchor);
        if (at) { fx.glow(at.x, at.y, 120, { life: 220 }); fx.ring(at.x, at.y, 70, { life: 260 }); fx.spark(at.x, at.y, 22, { v: .7, life: 480, up: .12 }); }
        shake(anchor, 6, 300);
        await sleep(reducedMotion() ? 60 : 240);
      },
      /* 결과 — 다시 그린 화면에서 같은 자리를 찾아 터뜨린다 */
      result(ok, { text, sub, find } = {}) {
        const fresh = find?.() || null, p = centerOf(fresh) || at;
        if (!p) return;
        if (ok) {
          screenFlash(.18, 300, '#fff3c4');
          fx.ring(p.x, p.y, 130, { life: 600, w: 6 }); fx.ring(p.x, p.y, 90, { life: 450, col: '#fff' }); fx.glow(p.x, p.y, 170, { life: 600 });
          fx.spark(p.x, p.y, 46, { v: .85, life: 900, up: .2 });
          floatText({ x: p.x, y: p.y - 20 }, text || '강화 성공!', { color: '#ffcf5a', size: 24 });
          if (sub) setTimeout(() => floatText({ x: p.x, y: p.y + 10 }, sub, { color: '#9ff0c0', size: 16, dur: 1200 }), 160);
          if (fresh) { pop(fresh, 1.12, 520); animate(fresh, [{ filter: 'brightness(1.9)' }, { filter: 'brightness(1)' }], { duration: 600 }); }
        } else {
          shake(fresh || doc.body, 10, 480);
          fx.crack(p.x, p.y, { life: 1400, size: .8 }); fx.debris(p.x, p.y, 10);
          floatText({ x: p.x, y: p.y - 20 }, text || '실패…', { color: '#ff6a6a', size: 22 });
          if (fresh) animate(fresh, [{ filter: 'grayscale(1) brightness(.6)', transform: 'rotate(-3deg)' }, { filter: 'grayscale(1) brightness(.6)', transform: 'rotate(3deg)', offset: .15 }, { filter: 'none', transform: 'none' }], { duration: 1000 });
        }
      },
      cancel: stop,
    };
  }

  /* ── 레벨 업 — 빛기둥 · 기체 튐 · LEVEL UP · 능력치가 하나씩 세어 올라감 ── */
  function levelUp({ hero, bar, from, to, before, after }) {
    const h = centerOf(hero); if (!h || !(to > from)) return;
    const foot = h.r.bottom - h.h * .12;
    screenFlash(.22, 420, '#fff3c4');
    fx.beam(h.x, h.r.top - 40, h.r.bottom + 10, { life: 1100, w: Math.max(50, h.w * .22) });
    fx.ring(h.x, foot, Math.min(160, h.w * .5), { life: 700, w: 6 }); fx.ring(h.x, foot, Math.min(100, h.w * .32), { life: 500, col: '#fff' });
    fx.spark(h.x, foot, 56, { v: .85, life: 1100, up: .45, spread: Math.PI * .9, dir: -Math.PI / 2 });
    const img = hero.querySelector('img') || hero;
    animate(img, [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-8%) scale(1.08)', offset: .3 }, { transform: 'translateY(0) scale(1)' }], { duration: 620, easing: 'cubic-bezier(.2,1.4,.4,1)' });
    floatText({ x: h.x, y: h.r.top + h.h * .3 }, 'LEVEL UP', { color: '#ffe27a', size: 34, dy: -40, dur: 1500, cls: 'fx-lvtext' });
    if (bar?.isConnected) {
      bar.classList.add('fx-full'); bar.style.width = '100%';
      setTimeout(() => { bar.classList.remove('fx-full'); bar.style.width = ''; }, 900);
    }
    if (!before || !after) return;
    const card = doc.createElement('div'); card.className = 'fx-lvcard';
    card.innerHTML = `<b>Lv.${from} → Lv.<span>${to}</span></b>` + STAT_ROWS.map(([k, n]) => `<div><span>${n}</span><em data-k="${k}">${fmt(before[k])}</em><i>▲ +${fmt(after[k] - before[k])}</i></div>`).join('');
    card.style.left = h.x + 'px'; card.style.top = (h.r.bottom - 8) + 'px';
    (doc.querySelector('dialog[open]') || doc.body).appendChild(card);
    animate(card, [{ opacity: 0, transform: 'translate(-50%,-80%) scale(.9)' }, { opacity: 1, transform: 'translate(-50%,-100%) scale(1)' }], { duration: 260, fill: 'forwards' });
    const lv = card.querySelector('b span');
    setTimeout(() => pop(lv, 1.8, 500), 220);
    STAT_ROWS.forEach(([k], i) => setTimeout(() => {
      const em = card.querySelector(`[data-k=${k}]`); if (!em) return;
      em.textContent = fmt(before[k]); countText(em, before[k], after[k], 500).then(() => { em.textContent = fmt(after[k]); });
      animate(em.nextElementSibling, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 280, fill: 'forwards' });
      sound('coin_tick', { gain: .45, rate: 1.2 + i * .1, max: .15 });
    }, 300 + i * 160));
    setTimeout(() => { animate(card, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }); setTimeout(() => card.remove(), 420); }, 2300);
  }

  /* ── 재화가 지갑으로 날아간다 — 도착할 때마다 지갑 숫자가 오른다 ── */
  function wallet(from, before, after) {
    const src = centerOf(from) || { x: innerWidth / 2, y: innerHeight / 2 };
    let delay = 0;
    for (const [key, [sel, col]] of Object.entries(WALLET)) {
      const a = Math.max(0, Number(before?.[key]) || 0), b = Math.max(0, Number(after?.[key]) || 0), el = doc.querySelector(sel), dst = centerOf(el);
      if (!(b > a) || !el) continue;
      if (!dst || reducedMotion()) { el.textContent = fmt(b); continue; }
      const n = Math.min(7, 3 + Math.floor(Math.log10(b - a + 1))), each = (b - a) / n;
      let shown = a, mine = fmt(a); el.textContent = mine;
      for (let c = 0; c < n; c++) fx.chip(src.x + rnd(-14, 14), src.y + rnd(-8, 8), dst.x, dst.y, { delay: delay + c * 70, life: 600, col,
        onArrive: () => {
          if (el.textContent !== mine) return;                       // 그사이 화면이 새 값으로 다시 그렸다 — 그대로 둔다
          shown = c === n - 1 ? b : shown + each; mine = fmt(shown); el.textContent = mine;
          pop(el, 1.18, 220); sound('coin_tick', { gain: .35, rate: 1 + c * .06, max: .12 }); fx.spark(dst.x, dst.y, 4, { v: .22, life: 260, g: 0 });
        } });
      delay += 160;
    }
  }

  /* ── 보상 줄 — 하나씩 들어오며 숫자가 세어 올라간다(대전 · 전선 · 점령 결과) ── */
  function rewardLines(box) {
    if (!box?.isConnected || reducedMotion()) return;
    const rows = [...box.children].filter(x => x.classList?.contains('r'));
    rows.forEach((row, i) => {
      row.style.opacity = 0;
      setTimeout(() => {
        if (!row.isConnected) return;
        row.style.opacity = '';
        animate(row, [{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
        /* 글자 안의 첫 '+숫자' 만 0 에서 세어 올린다 — 단위 · 이름은 그대로 */
        const walk = doc.createTreeWalker(row, 4); let node = null;
        while (walk.nextNode()) if (/\+[\d,]+/.test(walk.currentNode.nodeValue)) { node = walk.currentNode; break; }
        if (node) { const src = node.nodeValue, to = +src.match(/\+([\d,]+)/)[1].replace(/,/g, ''), t0 = performance.now();
          (function f() { const u = Math.min(1, (performance.now() - t0) / 420); node.nodeValue = src.replace(/\+[\d,]+/, '+' + fmt(to * (1 - (1 - u) ** 3))); if (u < 1 && node.isConnected) setTimeout(f, 16); else node.nodeValue = src; })(); }
        const m = node;
        if (/레벨 업|승급/.test(row.textContent)) { const c = centerOf(row); if (c) { fx.spark(c.x, c.y, 18, { v: .45, life: 600, col: ['#9ff0c0', '#fff', '#ffe58a'] }); fx.ring(c.x, c.y, c.w * .4, { life: 500, col: '#9ff0c0', w: 3 }); } }
        sound(m ? 'coin_tick' : 'ui_click', { gain: .35, rate: .9 + i * .05, max: .15 });
      }, 260 + i * 120);
    });
  }

  /* ── 버튼 — 누르는 자리에서 물결(캔버스) · 눌림은 CSS(:active) ── */
  function bindButtons() {
    doc.addEventListener('pointerdown', e => {
      if (!e.isTrusted || reducedMotion()) return;
      const b = e.target?.closest?.('.btn,.hv-enhance,.inv-enhance,.gv-actions button');
      if (!b || b.disabled) return;
      fx.ring(e.clientX, e.clientY, 34, { col: 'rgba(190,235,255,.9)', life: 340, w: 2.5, r0: 4 });
      fx.glow(e.clientX, e.clientY, 30, { rgb: '170,225,255', life: 220 });
    }, true);
  }

  return { enhance, levelUp, wallet, rewardLines, bindButtons };
}
