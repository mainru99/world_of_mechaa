/* 타격감 시험 페이지 — 효과음. 파일 없이 WebAudio 로 합성한다.
 * 느낌을 고르는 용도다. 정해지면 실제 효과음 파일로 바꾼다.
 * 모든 소리는 세기 I(0.25 ~ 1.4)를 받아 크기와 높낮이를 바꾼다 — 작은 타격은 가볍게, 큰 타격은 묵직하게. */

export class Sfx {
  constructor() { this.ctx = null; this.vol = 0.7; this.useFiles = true; this.bufs = {}; this.loading = null; }

  /* ── 파일 소리(Stable Audio 로 만든 것 · sfx/*.wav) ──
     없는 파일은 조용히 건너뛰고 합성음이 대신 난다. 같은 이름_a · _b 가 있으면 번갈아 쓴다 */
  async loadFiles() {
    if (this.loading) return this.loading;
    const names = ['hit_light_a','hit_light_b','hit_heavy_a','hit_heavy_b','crit','miss','parry','windup','shot_sniper','shot_shell','shot_missile','shot_gatling',
                   'beam_charge','beam_fire','skill_charge','explosion','land','heal','shield','win','lose'];
    this.loading = Promise.all(names.map(async n => {
      try { const r = await fetch(`sfx/${n}.wav`); if (!r.ok) return; this.bufs[n] = await this.ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { /* 없으면 합성음 */ }
    }));
    return this.loading;
  }
  /* 파일을 튼다 — 성공하면 true. gain 은 크기, rate 는 높낮이(변주), trim 은 앞 잡음을 건너뛴 초 */
  file(name, { gain = 1, rate = 1, max = 0 } = {}) {
    if (!this.useFiles || !this.ok) return false;
    const list = Object.keys(this.bufs).filter(k => k === name || k.startsWith(name + '_'));
    if (!list.length) return false;
    const key = list[(this._rr = (this._rr || 0) + 1) % list.length], b = this.bufs[key];
    const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * .04);
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g); g.connect(this.master);
    const dur = max ? Math.min(b.duration, max) : b.duration;
    if (max) { const t = this.ctx.currentTime; g.gain.setValueAtTime(gain, t + Math.max(0, dur - .08)); g.gain.linearRampToValueAtTime(0, t + dur); }
    s.start(); if (max) s.stop(this.ctx.currentTime + dur + .02);
    return true;
  }

  /* 브라우저는 사용자가 누르기 전에는 소리를 못 낸다 — 재생 단추에서 부른다 */
  unlock() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      this.ctx = new C();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.vol;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.loadFiles();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setVol(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  get ok() { return !!this.ctx && this.ctx.state === 'running'; }

  /* ── 부품 ── */
  _env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  _noise(t, dur, { type = 'bandpass', f0 = 1200, f1 = f0, q = 1, peak = 0.5, a = 0.002 } = {}) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = this.ctx.createGain(); this._env(g, t, a, peak, dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + a + dur + 0.05);
  }
  _tone(t, dur, { type = 'sine', f0 = 440, f1 = f0, peak = 0.4, a = 0.003 } = {}) {
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain(); this._env(g, t, a, peak, dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + a + dur + 0.05);
  }
  get t() { return this.ctx.currentTime + 0.005; }
  _j(x, p = 0.08) { return x * (1 + (Math.random() * 2 - 1) * p); }   // 매번 조금씩 달라야 기계음처럼 안 들린다

  /* ── 게임 소리 ── */
  hit(I) {
    if (this.file(I > .85 ? 'hit_heavy' : 'hit_light', { gain: .55 + .5 * Math.min(1, I), rate: 1.12 - .22 * Math.min(1.2, I), max: 1.1 })) return;
    if (!this.ok) return; const t = this.t;
    this._noise(t, 0.05 + 0.07 * I, { f0: this._j(1800), f1: 500, q: 0.8, peak: 0.35 + 0.35 * I });
    this._tone(t, 0.09 + 0.1 * I, { f0: this._j(150 + 40 * I), f1: 45, peak: 0.45 + 0.45 * I });
    if (I > 0.7) this._noise(t + 0.01, 0.25, { type: 'lowpass', f0: 900, f1: 120, peak: 0.25 * I });
  }
  crit(I) {
    if (this.file('crit', { gain: 1, max: 1.4 })) return;
    if (!this.ok) return; const t = this.t;
    this.hit(Math.max(I, 0.9));
    this._tone(t, 0.32, { type: 'triangle', f0: this._j(1760), f1: 1500, peak: 0.16 });
    this._tone(t, 0.26, { type: 'square', f0: this._j(2390), f1: 2100, peak: 0.05 });
    this._noise(t, 0.12, { type: 'highpass', f0: 5000, f1: 3000, peak: 0.25 });
  }
  miss() {
    if (this.file('miss', { gain: .8, max: .8 })) return;
    if (!this.ok) return; const t = this.t;
    this._noise(t, 0.17, { f0: 500, f1: 2800, q: 2.2, peak: 0.22, a: 0.04 });
  }
  windup() {
    if (this.file('windup', { gain: .5, max: .35 })) return;
    if (!this.ok) return; const t = this.t;
    this._tone(t, 0.08, { type: 'square', f0: this._j(90), f1: 60, peak: 0.06 });
    this._noise(t, 0.07, { type: 'highpass', f0: 3500, f1: 6000, peak: 0.05, a: 0.02 });
  }
  charge(dur = 0.4) {
    if (this.file(dur > .3 ? 'beam_charge' : 'skill_charge', { gain: .8, max: Math.max(.3, dur + .1) })) return;
    if (!this.ok) return; const t = this.t;
    this._tone(t, dur, { type: 'sawtooth', f0: 160, f1: 900, peak: 0.07, a: dur * 0.8 });
    this._tone(t, dur, { type: 'sine', f0: 320, f1: 1800, peak: 0.08, a: dur * 0.8 });
    this._noise(t, dur, { f0: 600, f1: 4000, q: 4, peak: 0.08, a: dur * 0.8 });
  }
  fire() {
    if (this.file('beam_fire', { gain: .8, max: .9 })) return;
    if (!this.ok) return; const t = this.t;
    this._noise(t, 0.3, { type: 'lowpass', f0: 5000, f1: 300, peak: 0.45 });
    this._tone(t, 0.25, { type: 'sine', f0: 220, f1: 50, peak: 0.5 });
  }
  parry() {
    if (this.file('parry', { gain: .9, max: .9 })) return;
    if (!this.ok) return; const t = this.t;
    this._tone(t, 0.4, { type: 'triangle', f0: this._j(980, 0.03), f1: 940, peak: 0.28 });
    this._tone(t, 0.3, { type: 'triangle', f0: this._j(1470, 0.03), f1: 1400, peak: 0.16 });
    this._tone(t, 0.22, { type: 'square', f0: 3120, f1: 2900, peak: 0.03 });
    this._noise(t, 0.05, { type: 'highpass', f0: 4000, peak: 0.4 });
  }
  heal() {
    if (this.file('heal', { gain: .6, max: 1 })) return;
    if (!this.ok) return; const t = this.t;
    this._tone(t, 0.18, { f0: 880, peak: 0.1, a: 0.01 });
    this._tone(t + 0.07, 0.25, { f0: 1320, peak: 0.08, a: 0.01 });
  }
  shot(kind) {
    const f = { sniper: 'shot_sniper', shell: 'shot_shell', missile: 'shot_missile', gatling: 'shot_gatling', beam: 'beam_fire' }[kind];
    if (f && this.file(f, { gain: .85, max: kind === 'gatling' ? .25 : 1.2 })) return;
    if (!this.ok) return; const t = this.t;
    if (kind === 'shell') { this._noise(t, .4, { type: 'lowpass', f0: 2600, f1: 140, peak: .75 }); this._tone(t, .32, { f0: 120, f1: 38, peak: .6 }); }
    else if (kind === 'beam') { this._tone(t, .26, { type: 'sawtooth', f0: 1500, f1: 480, peak: .08 }); this._noise(t, .22, { type: 'highpass', f0: 3000, peak: .12 }); }
    else if (kind === 'missile') this._noise(t, .42, { f0: 700, f1: 2600, q: .8, peak: .28, a: .03 });
    else { this._noise(t, kind === 'gatling' ? .05 : .09, { type: 'highpass', f0: 2600, f1: 1200, peak: kind === 'gatling' ? .3 : .5 });
           this._tone(t, .1, { f0: kind === 'gatling' ? 220 : 320, f1: 80, peak: kind === 'gatling' ? .2 : .38 }); }
  }
  blip(f = 660) {
    if (!this.ok) return; const t = this.t;
    this._tone(t, 0.08, { type: 'square', f0: f, f1: f * 0.8, peak: 0.05 });
  }
  boom() {
    if (this.file('explosion', { gain: 1 })) return;
    if (!this.ok) return; const t = this.t;
    this._noise(t, 1.2, { type: 'lowpass', f0: 3200, f1: 90, q: 0.7, peak: 0.9, a: 0.004 });
    this._tone(t, 0.7, { type: 'sine', f0: 90, f1: 26, peak: 0.9 });
    for (let i = 0; i < 6; i++) this._noise(t + 0.08 + i * (0.05 + Math.random() * 0.06), 0.05, { f0: this._j(2400, 0.3), f1: 800, peak: 0.18 });
  }
  land() {
    if (this.file('land', { gain: .9, max: 1.2 })) return;
    if (!this.ok) return; const t = this.t;
    this._tone(t, 0.3, { type: 'sine', f0: 110, f1: 35, peak: 0.8 });
    this._noise(t, 0.25, { type: 'lowpass', f0: 1400, f1: 150, peak: 0.45 });
    this._tone(t + 0.02, 0.12, { type: 'square', f0: 70, f1: 50, peak: 0.08 });
  }
  drop() {
    if (!this.ok) return; const t = this.t;
    this._noise(t, 0.28, { f0: 3000, f1: 700, q: 1.5, peak: 0.14, a: 0.2 });
  }
  win() {
    if (this.file('win', { gain: .8 })) return;
    if (!this.ok) return; const t = this.t;
    [523, 659, 784, 1047].forEach((f, i) => this._tone(t + i * 0.09, 0.35, { type: 'triangle', f0: f, peak: 0.16, a: 0.01 }));
  }
  lose() {
    if (this.file('lose', { gain: .8 })) return;
    if (!this.ok) return; const t = this.t;
    [392, 330, 262].forEach((f, i) => this._tone(t + i * 0.14, 0.4, { type: 'triangle', f0: f, f1: f * 0.97, peak: 0.14, a: 0.01 }));
  }
}
