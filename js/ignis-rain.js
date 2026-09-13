/* IGNIS RAIN — visual playback only. Combat events and damage stay in sim.js.
 * One transparent atlas, copied on an integer pixel grid; the robot is untouched.
 */
export const IGNIS_RAIN_ATLAS = new URL('../assets/effects/ignis-rain-atlas.png?v=20260913-rain1', import.meta.url).href;
let atlasPromise;
export function loadIgnisRainAtlas() {
  if (!atlasPromise) atlasPromise = new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { atlasPromise = null; resolve(null); };
    img.src = IGNIS_RAIN_ATLAS;
  });
  return atlasPromise;
}

// The atlas is 2 × 2: lance, contact, expanding fire, embers.
function stamp(ctx, atlas, cell, x, y, size, mirror = false, opacity = 1) {
  if (!atlas || opacity <= 0) return;
  const sw = atlas.naturalWidth / 2, sh = atlas.naturalHeight / 2;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(Math.round(x), Math.round(y));
  if (mirror) ctx.scale(-1, 1);
  ctx.drawImage(atlas, (cell % 2) * sw, Math.floor(cell / 2) * sh, sw, sh,
    -Math.round(size / 2), -Math.round(size / 2), size, size);
  ctx.restore();
}

// Exported so the review page can scrub the exact renderer used by the game.
// Coordinates are logical pixels: one logical pixel = two CSS pixels.
export function drawIgnisVolley(ctx, atlas, {
  age, side = 'p', index = 0, miss = false, speed = 1, x, y,
  reduced = false, quiet = false,
}) {
  const dir = side === 'p' ? 1 : -1;
  const flight = 110 / speed, tail = 300 / Math.min(speed, 2);
  const targets = [[-9, -9], [5, 5], [-3, 12], [11, -5], [0, 1]];
  const [ox, oy] = targets[index % targets.length];
  const count = reduced || speed >= 4 ? 1 : 3;
  for (let j = 0; j < count; j++) {
    const delay = j * 28 / speed;
    const t = age - delay;
    if (t < 0 || t > flight + tail) continue;
    const tx = x + dir * (ox + (j - 1) * 13 + (miss ? 27 : 0));
    const ty = y + oy + (j === 1 ? 9 : j === 2 ? -12 : 0);
    if (reduced) {
      // A small persistent ember mark instead of traversing or flashing sprites.
      if (t >= flight) stamp(ctx, atlas, 3, tx, ty, 28, dir < 0, .48);
      continue;
    }
    if (t < flight) {
      const p = t / flight;
      const travel = 66;
      const size = j === 0 ? 61 : 48;
      // The lance tip is near the lower-right corner of its cell, not its center.
      const tip = size * .405;
      stamp(ctx, atlas, 0, tx - dir * (travel * (1 - p) + tip),
        ty - travel * (1 - p) - tip, size, dir < 0, j === 0 ? .96 : .7);
    } else if (miss) {
      // Misses continue beyond the target; no contact star is drawn on the robot.
      const p = Math.min(1, (t - flight) / (tail * .5));
      if (p < 1) stamp(ctx, atlas, 0, tx + dir * (28 * p - 20), ty + 34 * p - 20,
        48, dir < 0, .55 * (1 - p));
    } else {
      const p = (t - flight) / tail;
      const cell = p < .16 && !quiet && j === 0 ? 1 : p < .43 ? 2 : 3;
      const size = cell === 1 ? 30 : cell === 2 ? 42 : 50;
      stamp(ctx, atlas, cell, tx, ty, size, dir < 0,
        (j === 0 ? .92 : .58) * (p < .43 ? 1 : 1 - (p - .43) / .57));
    }
  }
}

export function createIgnisRain(arena) {
  let disposed = false, canvas, ctx, atlas = null, raf = 0, observer;
  let waves = [], charge = null, lastBright = -Infinity;
  const pending = new Set();
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const live = () => !disposed && !!arena?.isConnected;
  loadIgnisRainAtlas().then(img => { if (!disposed) atlas = img; });

  function resize() {
    if (!canvas || !ctx) return;
    const w = Math.max(1, Math.ceil(arena.clientWidth / 2));
    const h = Math.max(1, Math.ceil(arena.clientHeight / 2));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      canvas.style.width = `${w * 2}px`; canvas.style.height = `${h * 2}px`;
      ctx.imageSmoothingEnabled = false;
    }
  }
  function ensureCanvas() {
    if (!live()) return false;
    if (canvas) return !!ctx;
    canvas = document.createElement('canvas');
    canvas.className = 'ignis-rain-fx';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {position:'absolute', left:'0', top:'0', pointerEvents:'none', imageRendering:'pixelated'});
    // Above robots but below the existing flash/banner. The HP area is clipped out.
    arena.insertBefore(canvas, arena.querySelector('#flash'));
    ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return false; }
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resize); observer.observe(arena);
    }
    return true;
  }
  function anchor(side) {
    const el = arena.querySelector(`#fighter-${side}`);
    // Use layout coordinates: hit-shake transforms must not drag the rain with them.
    return el ? {x:(el.offsetLeft + el.offsetWidth * .5) / 2,
      y:(el.offsetTop + el.offsetHeight * .57) / 2}
      : {x:canvas.width * (side === 'p' ? .22 : .78), y:canvas.height * .64};
  }
  function render(now) {
    raf = 0;
    if (!live()) { dispose(); return; }
    resize(); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const hpBottom = Math.max(0, ...Array.from(arena.querySelectorAll('.hpwrap'), el => el.offsetTop + el.offsetHeight));
    ctx.save(); ctx.beginPath();
    ctx.rect(0, Math.ceil((hpBottom + 4) / 2), canvas.width, canvas.height);
    ctx.clip();
    if (charge) {
      const age = now - charge.start;
      if (age > 520 || preference.matches) charge = null;
      else if (atlas) {
        const a = anchor(charge.side), p = age / 520;
        // Small embers gather by the wings. No full-body filter or scaling.
        stamp(ctx, atlas, 3, a.x, a.y - 16 - Math.round(p * 5), 65, charge.side === 'p', Math.sin(p * Math.PI) * .55);
      }
    }
    waves = waves.filter(w => now - w.start < w.life);
    for (const w of waves) drawIgnisVolley(ctx, atlas,
      {...w, ...anchor(w.side === 'p' ? 'e' : 'p'), age:now-w.start, reduced:preference.matches});
    ctx.restore();
    if (waves.length || charge) raf = requestAnimationFrame(render);
  }
  function start() { if (!raf && ensureCanvas()) raf = requestAnimationFrame(render); }
  function cast(side) {
    if (!live()) return;
    charge = {side, start:performance.now()}; start();
  }
  function strike(side, {miss = false, index = 0, speed = 1} = {}) {
    speed = Number.isFinite(speed) ? Math.min(8, Math.max(1, speed)) : 1;
    if (!live()) return Promise.resolve();
    const now = performance.now();
    const quiet = speed >= 4 || now - lastBright < 340;
    if (!quiet && !miss) lastBright = now;
    charge = null;
    waves.push({side, miss, index, speed, quiet, start:now, life:166/speed+300/Math.min(speed,2)});
    waves = waves.slice(-5); start();
    // Never wait for image download; visual failures cannot hold up combat playback.
    return new Promise(resolve => {
      const token = {resolve, timer:0};
      token.timer = setTimeout(() => { pending.delete(token); resolve(); }, 110 / speed);
      pending.add(token);
    });
  }
  function dispose() {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(raf); observer?.disconnect();
    for (const p of pending) { clearTimeout(p.timer); p.resolve(); }
    pending.clear(); waves = []; charge = null; canvas?.remove();
  }
  return {cast, strike, dispose};
}
