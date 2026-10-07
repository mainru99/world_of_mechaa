/* 성장 연출 시험대 — 강화 · 레벨 업 · 보상 · 버튼. (2026-10-07)
 * 규칙은 게임의 실제 값이다: 강화 확률 enhRate · 경험치 expNeed / battleExp · 능력치 computeStats.
 * '지금 게임' 은 숫자와 글자만 바뀌는 현재 화면을 흉내 낸다. '연출 켬' 은 그 위에 소리 · 입자 · 움직임을 얹는다. */
import { enhRate, expNeed, battleExp, computeStats } from '../../js/stats.js';
import { CONST } from '../../data/balance.js';
import { Sfx } from './sfx.js?v=1007h';

const $ = s => document.querySelector(s);
const sfx = new Sfx();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = { out: u => 1 - (1 - u) ** 3, in: u => u * u, inOut: u => u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2 };
const fmt = n => Math.round(n).toLocaleString('ko-KR');
let juice = true, latency = 1200;

/* ── 입자 무대 ── */
class Stage {
  constructor(el, canvas) {
    this.el = el; this.c = canvas; this.g = canvas.getContext('2d'); this.p = []; this.t = 0; this.fns = [];
    new ResizeObserver(() => this.fit()).observe(el); this.fit();
  }
  fit() { const r = this.el.getBoundingClientRect(); this.W = r.width; this.H = r.height; const d = Math.min(2, devicePixelRatio || 1);
    this.c.width = this.W * d; this.c.height = this.H * d; this.g.setTransform(d, 0, 0, d, 0, 0); this.S = Math.min(1.4, this.W / 400); }
  add(o) { o.age = o.age ?? 0; this.p.push(o); }
  spark(x, y, n, { col = ['#fff', '#ffe58a', '#ffb03a'], v = .5, life = 500, up = 0, spread = Math.PI * 2, dir = 0, g = .0008 } = {}) {
    for (let i = 0; i < n; i++) { const a = dir + rnd(-.5, .5) * spread, s = rnd(.3, 1) * v * this.S;
      this.add({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - up * this.S, life: rnd(life * .6, life), w: rnd(1.2, 2.6) * this.S, col: col[(Math.random() * col.length) | 0], g: g * this.S }); }
  }
  ring(x, y, r1, { col = '#ffe58a', life = 400, w = 4, r0 = 6 } = {}) { this.add({ k: 'ring', x, y, r0: r0 * this.S, r1: r1 * this.S, life, col, w: w * this.S }); }
  glow(x, y, r, { rgb = '255,220,140', life = 300 } = {}) { this.add({ k: 'glow', x, y, r: r * this.S, life, rgb }); }
  /* 재화 조각 — 시작점에서 도착점으로 곡선을 그리며 날아간다 */
  chip(x0, y0, x1, y1, { delay = 0, life = 650, col = '#ffd45a', onArrive } = {}) {
    this.add({ k: 'chip', x0, y0, x1, y1, bend: rnd(-60, 60) * this.S, life, age: -delay, col, onArrive });
  }
  beam(x, { life = 900, col = '255,230,150' } = {}) { this.add({ k: 'beam', x, life, rgb: col }); }
  crack(x, y, { life = 1400 } = {}) {
    const lines = []; for (let i = 0; i < 6; i++) { let a = rnd(0, 7), px = x, py = y; const seg = []; for (let j = 0; j < 4; j++) { a += rnd(-.7, .7); px += Math.cos(a) * rnd(10, 22) * this.S; py += Math.sin(a) * rnd(10, 22) * this.S; seg.push([px, py]); } lines.push(seg); }
    this.add({ k: 'crack', x, y, lines, life });
  }
  step(dt) {
    for (const p of this.p) {
      p.age += dt; if (p.age < 0) continue;
      if (p.k === 'spark') { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .997 ** dt; }
    }
    const done = this.p.filter(p => p.k === 'chip' && p.age >= p.life && !p.fired);
    for (const p of done) { p.fired = true; if (p.onArrive) p.onArrive(); }
    this.p = this.p.filter(p => p.age < p.life);
  }
  draw() {
    const g = this.g; g.clearRect(0, 0, this.W, this.H); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (const p of this.p) {
      if (p.age < 0) continue; const u = p.age / p.life;
      if (p.k === 'spark') { g.globalAlpha = 1 - u; g.strokeStyle = p.col; g.lineWidth = p.w; g.beginPath(); g.moveTo(p.x - p.vx * 12, p.y - p.vy * 12); g.lineTo(p.x, p.y); g.stroke(); }
      else if (p.k === 'ring') { const r = p.r0 + (p.r1 - p.r0) * ease.out(u); g.globalAlpha = 1 - u; g.strokeStyle = p.col; g.lineWidth = p.w * (1 - u); g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.stroke(); }
      else if (p.k === 'glow') { const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); gr.addColorStop(0, `rgba(${p.rgb},${.8 * (1 - u)})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); }
      else if (p.k === 'chip') { const q = ease.in(u), x = p.x0 + (p.x1 - p.x0) * q, y = p.y0 + (p.y1 - p.y0) * q + Math.sin(Math.PI * q) * p.bend;
        g.globalAlpha = Math.min(1, u * 8) * (u > .92 ? (1 - u) * 12 : 1); g.fillStyle = p.col; g.save(); g.translate(x, y); g.rotate(u * 9); g.fillRect(-4 * this.S, -2.5 * this.S, 8 * this.S, 5 * this.S); g.restore();
        g.globalAlpha *= .4; g.beginPath(); g.arc(x, y, 9 * this.S, 0, 7); g.fill(); }
      else if (p.k === 'beam') { const w = 70 * this.S * (1 - u * .5), a = u < .15 ? u / .15 : 1 - (u - .15) / .85, gr = g.createLinearGradient(p.x - w, 0, p.x + w, 0);
        gr.addColorStop(0, `rgba(${p.rgb},0)`); gr.addColorStop(.5, `rgba(${p.rgb},${.75 * a})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(p.x - w, 0, w * 2, this.H); }
    }
    g.globalCompositeOperation = 'source-over';
    for (const p of this.p) if (p.k === 'crack' && p.age >= 0) { const u = p.age / p.life, a = u < .7 ? 1 : 1 - (u - .7) / .3, show = clamp(p.age / 140, 0, 1);
      g.globalAlpha = a; g.strokeStyle = '#ffb36b'; g.lineWidth = 2 * this.S; g.shadowColor = '#ff7a2a'; g.shadowBlur = 8;
      for (const seg of p.lines) { g.beginPath(); g.moveTo(p.x, p.y); const n = Math.ceil(seg.length * show); for (let i = 0; i < n; i++) g.lineTo(seg[i][0], seg[i][1]); g.stroke(); } g.shadowBlur = 0; }
    g.globalAlpha = 1;
  }
}
const stages = {};
for (const k of ['enh', 'lv', 'rw']) stages[k] = new Stage($('#' + k + 'Stage'), $('#' + k + 'Fx'));
let last = performance.now(), lastRaf = 0;
function frame(now) { const dt = Math.min(50, now - last); last = now; for (const s of Object.values(stages)) { s.step(dt); s.draw(); } }
const loop = t => { lastRaf = performance.now(); frame(t); requestAnimationFrame(loop); };
requestAnimationFrame(loop);
setInterval(() => { if (performance.now() - lastRaf > 120) frame(performance.now()); }, 16);    // 창이 가려져 rAF 가 멈추면 타이머가 대신 돈다

/* ── 도구 ── */
const snd = (name, o) => { if (!sfx.file(name, o)) return false; return true; };
const tween = (dur, fn) => new Promise(res => { const t0 = performance.now(); (function f() { const u = clamp((performance.now() - t0) / dur, 0, 1); fn(u); u < 1 ? setTimeout(f, 16) : res(); })(); });
const flash = (el, peak = .8, dur = 320) => { if (reduced) return; el.animate([{ opacity: peak }, { opacity: 0 }], { duration: dur, easing: 'ease-out' }); };
const shake = (el, amp = 8, dur = 360) => { if (reduced) return; const f = []; for (let i = 0; i < 9; i++) f.push({ transform: `translate(${rnd(-amp, amp)}px,${rnd(-amp, amp)}px)` }); f.push({ transform: 'none' }); el.animate(f, { duration: dur }); };
const pop = (el, k = 1.4, dur = 380) => { if (reduced) return; el.animate([{ transform: el.style.transform + ' scale(1)' }, { transform: el.style.transform + ` scale(${k})`, offset: .3 }, { transform: el.style.transform + ' scale(1)' }], { duration: dur, easing: 'cubic-bezier(.2,1.4,.4,1)' }); };
const countTo = (el, from, to, dur, fmtFn = fmt, onTick) => tween(dur, u => { el.textContent = fmtFn(from + (to - from) * ease.out(u)); if (onTick) onTick(u); });
const tagShow = (el, text, color) => { el.textContent = text; el.style.color = color; el.animate([{ opacity: 0, transform: 'translateX(-50%) scale(.6)' }, { opacity: 1, transform: 'translateX(-50%) scale(1.15)', offset: .25 }, { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: .75 }, { opacity: 0, transform: 'translateX(-50%) scale(1)' }], { duration: 1500, fill: 'forwards' }); };

/* ═══ 파츠 강화 ═══ */
const ENH = { lv: 3, max: CONST.PART_ENH.max, busy: false };
const atkAt = lv => Math.round(100 + 11 * lv);
function enhPaint() {
  $('#enhLvl').textContent = '+' + ENH.lv;
  $('#enhAtk').textContent = atkAt(ENH.lv);
  const rate = ENH.lv >= ENH.max ? 0 : enhRate(ENH.lv);
  $('#enhRate').textContent = ENH.lv >= ENH.max ? '—' : Math.round(rate * 100) + '%';
  const b = $('#enhGo'); b.disabled = ENH.lv >= ENH.max; b.innerHTML = ENH.lv >= ENH.max ? '최대 강화' : `강화 (+${ENH.lv} → +${ENH.lv + 1})`;
}
$('#enhReset').onclick = () => { ENH.lv = 3; $('#enhUp').textContent = ''; $('#enhImg').style.filter = ''; enhPaint(); };
$('#enhGo').onclick = async () => {
  if (ENH.busy) return; ENH.busy = true; sfx.unlock();
  const S = stages.enh, img = $('#enhImg'), cam = $('#enhCam'), btn = $('#enhGo'), cx = S.W / 2, cy = S.H / 2;
  const ok = Math.random() < enhRate(ENH.lv);                        // 서버가 정한다 — 화면은 결과만 받는다
  const t0 = performance.now(); let answer = null;
  setTimeout(() => answer = ok, latency);                            // 서버 응답
  btn.disabled = true; btn.innerHTML = '<span class="wait"></span>강화 중…';
  if (!juice) {
    while (answer === null) await sleep(30);
    await finishEnh(ok, false); return;
  }
  /* 충전 — 응답을 기다리는 동안 흔들림이 점점 커지고 빛이 모인다. 응답이 일찍 와도 0.9초는 채운다 */
  snd('enh_charge', { gain: .8, max: 2 });
  const minWait = 900; let alive = true;
  (async () => { while (alive) { const u = clamp((performance.now() - t0) / Math.max(minWait, latency), 0, 1);
    const a = 1 + 5 * u; img.style.transform = `translate(${rnd(-a, a)}px,${rnd(-a, a)}px) scale(${1 + .06 * u})`;
    img.style.filter = `drop-shadow(0 0 ${6 + 22 * u}px rgba(255,190,80,${.4 + .6 * u})) brightness(${1 + .5 * u})`;
    if (Math.random() < .5 * u + .1) S.spark(cx + rnd(-90, 90), cy + rnd(-60, 60), 1, { v: .25, life: 300, g: 0 });
    await sleep(33); } })();
  while (answer === null || performance.now() - t0 < minWait) await sleep(30);
  alive = false; await sleep(40);
  img.style.transform = ''; img.style.filter = '';
  await finishEnh(ok, true);
};
async function finishEnh(ok, fx) {
  const S = stages.enh, img = $('#enhImg'), cam = $('#enhCam'), cx = S.W / 2, cy = S.H / 2, tag = $('#enhTag');
  if (fx) {                                                           // 내려치는 순간
    snd('anvil_hit', { gain: .9, max: 1 });
    flash($('#enhFlash'), .55, 200); shake(cam, 9, 300); S.glow(cx, cy, 160, { life: 220 }); S.ring(cx, cy, 90, { life: 260 });
    S.spark(cx, cy, 24, { v: .8, life: 500, up: .15 });
    await sleep(240);
  }
  if (ok) {
    const from = ENH.lv; ENH.lv++;
    if (fx) {
      snd('enh_success', { gain: 1, max: 2 });
      flash($('#enhFlash'), .9, 500); S.ring(cx, cy, 170, { life: 600, w: 6 }); S.ring(cx, cy, 120, { life: 450, col: '#fff' }); S.glow(cx, cy, 220, { life: 600 });
      S.spark(cx, cy, 50, { v: .9, life: 900, up: .2 });
      img.animate([{ transform: 'scale(1.25)', filter: 'brightness(2)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 500, easing: 'cubic-bezier(.2,1.4,.4,1)' });
      tagShow(tag, '강화 성공!', '#ffcf5a');
      $('#enhLvl').textContent = '+' + ENH.lv; pop($('#enhLvl'), 1.7, 520);
      const up = $('#enhUp'); up.textContent = `▲ +${atkAt(ENH.lv) - atkAt(from)}`;
      countTo($('#enhAtk'), atkAt(from), atkAt(ENH.lv), 600, v => Math.round(v));
    } else { $('#enhUp').textContent = `▲ +${atkAt(ENH.lv) - atkAt(from)}`; tagShow(tag, '강화 성공', '#ffcf5a'); }
  } else if (fx) {
    snd('enh_fail', { gain: 1, max: 2 });
    flash($('#enhFlash'), .25, 200); shake(cam, 14, 500); S.crack(cx, cy, { life: 1500 });
    for (let i = 0; i < 10; i++) S.add({ k: 'spark', x: cx + rnd(-30, 30), y: cy + rnd(-20, 20), vx: rnd(-.3, .3) * S.S, vy: rnd(-.4, .1) * S.S, life: rnd(500, 900), w: rnd(2, 4) * S.S, col: '#9aa4b5', g: .0016 * S.S });
    img.animate([{ filter: 'grayscale(1) brightness(.6)', transform: 'rotate(-4deg)' }, { filter: 'grayscale(1) brightness(.6)', transform: 'rotate(4deg)', offset: .15 }, { filter: 'grayscale(0) brightness(1)', transform: 'none' }], { duration: 1100 });
    tagShow(tag, '실패…', '#ff6a6a');
    $('#enhUp').textContent = '';
  } else { tagShow(tag, '강화 실패', '#ff6a6a'); }
  await sleep(fx ? 600 : 200);
  ENH.busy = false; enhPaint();
}

/* ═══ 레벨 업 ═══ */
const E0 = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const LV = { lv: 29, exp: 0, type: 'azure', busy: false };
const statsAt = lv => computeStats({ type: LV.type, level: lv, fat: 0, skillLv: 0, slots: E0 }, []);
const ROWS = [['hp', '내구'], ['atk', '공격'], ['def', '방어'], ['spd', '속도']];
function lvRows(lvl, delta) {
  const s = statsAt(lvl), d = delta;
  $('#lvRows').innerHTML = `<div style="color:var(--ink);font-weight:700">Lv.<b id="lvNum" class="num" style="min-width:0">${lvl}</b></div>` +
    ROWS.map(([k, n]) => `<div>${n} <b class="num" data-k="${k}">${fmt(s[k])}</b><span class="up" data-up="${k}">${d ? '▲ +' + fmt(d[k]) : ''}</span></div>`).join('');
}
lvRows(LV.lv);
$('#lvGo').onclick = async () => {
  if (LV.busy) return; LV.busy = true; sfx.unlock();
  const S = stages.lv, bar = $('#lvExp'), cam = $('#lvCam'), img = $('#lvImg');
  const need = expNeed(LV.lv), gain = Math.max(battleExp(LV.lv), need * .55);   // 시험용 — 실제 한 판(battleExp)은 이보다 작아 레벨 업이 드물다. 두 번 누르면 넘친다
  const from = LV.exp, total = from + gain, lv0 = LV.lv;
  const goes = total >= need;
  const toPct = Math.min(100, total / need * 100);
  const w = bar.parentElement;
  if (!juice) {
    bar.style.transition = 'width .35s'; bar.style.width = toPct + '%'; await sleep(450);
    if (goes) { LV.lv++; LV.exp = total - need; bar.style.transition = 'none'; bar.style.width = (LV.exp / expNeed(LV.lv) * 100) + '%'; lvRows(LV.lv); } else LV.exp = total;
    LV.busy = false; return;
  }
  bar.style.transition = 'none'; bar.className = ''; bar.style.width = (from / need * 100) + '%';
  /* 막대가 차오른다 — 구간마다 작은 소리 */
  let ticks = 0;
  await tween(900, u => { bar.style.width = (from / need * 100 + (toPct - from / need * 100) * ease.out(u)) + '%'; const k = Math.floor(u * 8); if (k > ticks) { ticks = k; snd('coin_tick', { gain: .35, rate: 1 + .05 * k, max: .15 }); } });
  if (!goes) { LV.exp = total; LV.busy = false; return; }
  /* 넘쳤다 — 금색 · 번쩍 · 빛기둥 · LEVEL UP */
  bar.className = 'full'; await sleep(120);
  LV.lv++; LV.exp = total - need;
  const cx = S.W / 2, cy = S.H / 2;
  snd('levelup', { gain: 1, max: 2.5 });
  flash($('#lvFlash'), .7, 500); S.beam(cx, { life: 1100 }); S.ring(cx, S.H * .7, 160, { life: 700, w: 6 }); S.ring(cx, S.H * .7, 100, { life: 500, col: '#fff' });
  S.spark(cx, S.H * .7, 60, { v: .9, life: 1100, up: .5, spread: Math.PI * .9, dir: -Math.PI / 2 });
  img.animate([{ transform: 'translate(-50%,-52%) scaleX(-1) scale(1)' }, { transform: 'translate(-50%,-62%) scaleX(-1) scale(1.12)', offset: .3 }, { transform: 'translate(-50%,-52%) scaleX(-1) scale(1)' }], { duration: 600, easing: 'cubic-bezier(.2,1.4,.4,1)' });
  const t = $('#lvText'); t.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.5)' }, { opacity: 1, transform: 'translate(-50%,-70%) scale(1.1)', offset: .25 }, { opacity: 1, transform: 'translate(-50%,-70%) scale(1)', offset: .7 }, { opacity: 0, transform: 'translate(-50%,-90%) scale(1)' }], { duration: 1500, fill: 'forwards' });
  const a = statsAt(lv0), b = statsAt(LV.lv), d = Object.fromEntries(ROWS.map(([k]) => [k, b[k] - a[k]]));
  lvRows(LV.lv, d);
  $('#lvNum').textContent = lv0; await sleep(200);
  tween(500, u => { $('#lvNum').textContent = Math.round(lv0 + (LV.lv - lv0) * ease.out(u)); }); pop($('#lvNum'), 1.8, 500);
  for (const [i, [k]] of ROWS.entries()) { setTimeout(() => {
    countTo($(`[data-k=${k}]`), a[k], b[k], 500); const u = $(`[data-up=${k}]`);
    u.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, fill: 'forwards' }); snd('coin_tick', { gain: .5, rate: 1.2 + i * .1, max: .15 }); }, 250 + i * 160); }
  await sleep(600);
  bar.className = ''; bar.style.width = (LV.exp / expNeed(LV.lv) * 100) + '%';
  await sleep(700); LV.busy = false;
};

/* ═══ 보상 ═══ */
const RW = { cr: 12480, sc: 860, busy: false };
const LINES = [['전투 보상', '크레딧', 1240, 'cr'], ['회수 부품', '스크랩', 86, 'sc'], ['첫 승리 보너스', '크레딧', 300, 'cr']];
function rwBuild() { $('#rwLines').innerHTML = LINES.map(([n, u, v], i) => `<div id="rl${i}"><span>${n}</span><b class="num">+0 ${u}</b></div>`).join(''); }
rwBuild();
$('#rwGo').onclick = async () => {
  if (RW.busy) return; RW.busy = true; sfx.unlock();
  const S = stages.rw, st = $('#rwStage').getBoundingClientRect();
  const wallet = { cr: $('#rwCr'), sc: $('#rwSc') };
  rwBuild();
  const add = (k, v) => { RW[k] += v; wallet[k].textContent = fmt(RW[k]); };
  if (!juice) {
    for (const [i, l] of LINES.entries()) { const el = $('#rl' + i); el.style.opacity = 1; el.style.transform = 'none'; el.querySelector('b').textContent = `+${fmt(l[2])} ${l[1]}`; add(l[3], l[2]); }
    RW.busy = false; return;
  }
  for (const [i, l] of LINES.entries()) {
    const el = $('#rl' + i), b = el.querySelector('b');
    el.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 260, fill: 'forwards', easing: 'ease-out' });
    snd('ui_click', { gain: .5, max: .3 });
    let tk = 0;
    await countTo(b, 0, l[2], 520, v => `+${fmt(v)} ${l[1]}`, u => { const k = Math.floor(u * 6); if (k > tk) { tk = k; snd('coin_tick', { gain: .35, rate: .9 + .08 * k, max: .12 }); } });
    pop(b, 1.25, 300);
    /* 재화 조각이 줄에서 지갑으로 날아간다 */
    const r = el.getBoundingClientRect(), wr = wallet[l[3]].getBoundingClientRect();
    const x0 = r.right - st.left - 30, y0 = r.top - st.top + r.height / 2, x1 = wr.left - st.left + wr.width / 2, y1 = wr.top - st.top + wr.height / 2;
    const n = 6, each = Math.ceil(l[2] / n);
    for (let c = 0; c < n; c++) S.chip(x0, y0, x1, y1, { delay: c * 70, life: 600, col: l[3] === 'cr' ? '#ffd45a' : '#9fc4ff',
      onArrive: () => { add(l[3], c === n - 1 ? l[2] - each * (n - 1) : each); pop(wallet[l[3]], 1.18, 220); snd('coin_tick', { gain: .4, rate: 1 + c * .06, max: .12 }); S.spark(x1, y1, 4, { v: .25, life: 260, g: 0 }); } });
    await sleep(240);
  }
  await sleep(700); snd('reward_claim', { gain: .9, max: 2 });
  S.glow(S.W - 70, 40, 90, { life: 500 }); RW.busy = false;
};

/* ═══ 버튼 ═══ */
for (const b of document.querySelectorAll('.fxbtn')) b.addEventListener('pointerdown', e => {
  sfx.unlock(); if (!juice) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2, s = document.createElement('span');
  s.className = 'rp'; s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.appendChild(s); setTimeout(() => s.remove(), 520);
  if (!snd(b.dataset.snd, { gain: .8, max: .8 })) sfx.blip(b.dataset.snd === 'ui_click' ? 500 : 700);
});

/* ═══ 조작판 ═══ */
const style = document.createElement('style');
style.textContent = 'body.now .press:active{transform:none!important;filter:none!important}body.now .pulse{animation:none!important}';
document.head.appendChild(style);
function setMode(j) { juice = j; $('#mJuice').classList.toggle('on', j); $('#mNow').classList.toggle('on', !j); document.body.classList.toggle('now', !j); }
$('#mNow').onclick = () => setMode(false); $('#mJuice').onclick = () => setMode(true);
$('#lat').oninput = e => { latency = +e.target.value; $('#latOut').textContent = (latency / 1000).toFixed(1) + '초'; };
$('#vol').oninput = e => { sfx.setVol(+e.target.value / 100); $('#volOut').textContent = e.target.value + '%'; };
$('#sfxsrc').onchange = e => { sfx.useFiles = e.target.value === 'files'; };
$('#rateNote').textContent = '+3→+4 ' + Math.round(enhRate(3) * 100) + '% … +9→+10 ' + Math.round(enhRate(9) * 100) + '%';
enhPaint();
window.__growth = { ENH, LV, RW, stages };
