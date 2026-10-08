/* Deterministic checks for the isolated, unapproved pose sequence prototype.
 * No DOM/network/assets required; fake Image, canvas, monotonic clock and RAF.
 */
import assert from 'node:assert/strict';
import { createPoseSequence, frameAt, sequenceDuration } from '../js/pose-sequence.js';

const durations = [70, 70, 40, 50, 80, 90];
const frames = durations.map((duration, index) => ({ src: 'frame-' + index + '.png', duration }));
const image = src => ({ src, naturalWidth: 440, naturalHeight: 420 });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let checks = 0;
function check(condition, description) { assert.ok(condition, description); checks++; }
function harness(extra = {}) {
  let time = 0, next = 0;
  const pending = new Map(), draws = [], operations = [], frameEvents = [], loaded = [];
  const ctx = Object.fromEntries(['save', 'restore', 'setTransform', 'clearRect', 'translate', 'scale'].map(name =>
    [name, (...args) => operations.push([name, ...args])]));
  ctx.drawImage = (img, ...args) => { draws.push(img.src); operations.push(['drawImage', img.src, ...args]); };
  const canvas = { width: 440, height: 420, dataset: {}, getContext: () => ctx };
  const opts = {
    frames, idleSrc: 'idle.png', now: () => time,
    raf: callback => { const id = ++next; pending.set(id, callback); return id; },
    caf: id => pending.delete(id),
    loadImage: async src => { loaded.push(src); return image(src); },
    onFrame: index => frameEvents.push(index), ...extra,
  };
  const sequence = createPoseSequence(canvas, opts);
  function tick(at) {
    assert.ok(at >= time, 'clock is monotonic');
    time = at;
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(time);
  }
  return { sequence, canvas, ctx, draws, operations, frameEvents, loaded, pending, tick };
}

check(sequenceDuration(frames) === 400, 'six-frame total is 400ms');
for (const [elapsed, expected] of [[-1, 0], [0, 0], [69.9, 0], [70, 1], [139, 1], [140, 2], [180, 3], [230, 4], [310, 5], [400, 5], [900, 5]]) {
  check(frameAt(frames, elapsed) === expected, 'frame boundary ' + elapsed);
}
for (const badFrames of [[], null, [{ src: '', duration: 1 }], [{ src: 'a', duration: 0 }], [{ src: 'a', duration: -1 }], [{ src: 'a', duration: Infinity }]]) {
  assert.throws(() => sequenceDuration(badFrames), TypeError); checks++;
}
assert.throws(() => frameAt(frames, NaN), TypeError); checks++;
assert.throws(() => createPoseSequence(null, { frames }), TypeError); checks++;
assert.throws(() => harness({ idleSrc: '' }), TypeError); checks++;

for (const speed of [0.5, 1, 2, 4]) {
  const h = harness({ speed: () => speed }), callbacks = [];
  check(h.sequence.showFrame(2) === false, 'manual frame waits for load');
  check(await h.sequence.ready() === true, 'preload complete at ' + speed);
  check(h.loaded.length === 7, 'unique sources preload once');
  check(h.draws.at(-1) === 'idle.png', 'ready shows idle');
  const running = h.sequence.play({
    onEffect: () => callbacks.push(['effect', h.canvas.dataset.frame]),
    onImpact: () => callbacks.push(['impact', h.canvas.dataset.frame]),
  });
  await flush();
  check(h.canvas.dataset.frame === '0', 'play begins at first frame');
  for (const [elapsed, expected] of [[70, 1], [110, 1], [140, 2], [180, 3], [230, 4], [310, 5]]) {
    h.tick(elapsed / speed);
    check(h.canvas.dataset.frame === String(expected), 'frame at speed ' + speed + ', elapsed ' + elapsed);
  }
  assert.deepEqual(callbacks, [['effect', '1'], ['impact', '3']]); checks++;
  h.tick(400 / speed);
  assert.deepEqual(await running.finished, { cancelled: false, reason: 'complete' }); checks++;
  check(h.canvas.dataset.frame === '-1', 'complete restores idle at ' + speed);
  check(h.pending.size === 0, 'complete clears RAF');
  h.tick(500 / speed);
  check(callbacks.length === 2, 'callbacks exactly once');
  check(h.ctx.imageSmoothingEnabled === false, 'nearest-neighbor drawing');
  h.sequence.dispose();
}

// A slow/hidden browser can skip frames, but must not lose/reorder callbacks.
{
  const h = harness(), calls = [];
  await h.sequence.ready();
  const r = h.sequence.play({ onEffect: () => calls.push('effect'), onImpact: () => calls.push('impact') });
  await flush(); h.tick(450);
  assert.deepEqual(calls, ['effect', 'impact']); checks++;
  check(h.canvas.dataset.frame === '3' && h.pending.size === 1, 'late tick holds contact for one RAF');
  h.tick(466);
  check((await r.finished).cancelled === false, 'late tick completes');
  check(h.pending.size === 0, 'late tick releases RAF');
}
{
  let speed = 1;
  const h = harness({ speed: () => speed }), calls = [];
  await h.sequence.ready();
  const r = h.sequence.play({ onEffect: () => calls.push('effect'), onImpact: () => calls.push('impact') });
  await flush(); speed = 4;
  h.tick(70);
  check(h.canvas.dataset.frame === '1' && calls.length === 0, 'speed frozen within attack');
  h.tick(180);
  assert.deepEqual(calls, ['effect', 'impact']); checks++;
  h.tick(400); await r.finished;
}
{
  const h = harness(), calls = [];
  await h.sequence.ready();
  const first = h.sequence.play({ onEffect: () => calls.push('old-effect'), onImpact: () => calls.push('old-impact') });
  await flush(); h.tick(50);
  first.cancel();
  assert.deepEqual(await first.finished, { cancelled: true, reason: 'cancelled' }); checks++;
  check(h.pending.size === 0 && h.draws.at(-1) === 'idle.png', 'cancel clears RAF and restores idle');
  h.tick(450);
  check(calls.length === 0, 'cancel suppresses delayed callbacks');
  const second = h.sequence.play({ onImpact: () => calls.push('new-impact') });
  await flush(); h.tick(850);
  h.tick(866);
  check((await second.finished).cancelled === false, 'restart after cancel');
  assert.deepEqual(calls, ['new-impact']); checks++;
}
{
  const h = harness();
  await h.sequence.ready();
  const first = h.sequence.play();
  await flush(); h.tick(70);
  const second = h.sequence.play();
  assert.deepEqual(await first.finished, { cancelled: true, reason: 'replaced' }); checks++;
  await flush(); h.tick(470);
  h.tick(486);
  check((await second.finished).cancelled === false, 'replacement completes');
  check(h.pending.size === 0, 'replacement leaves no old RAF');
}
{
  const h = harness(), calls = [];
  await h.sequence.ready();
  const r = h.sequence.play({ onImpact: () => calls.push('impact') });
  await flush(); h.tick(70);
  const before = h.operations.length;
  h.sequence.dispose();
  assert.deepEqual(await r.finished, { cancelled: true, reason: 'disposed' }); checks++;
  check(h.operations.length === before, 'dispose does not redraw');
  h.tick(500);
  check(h.pending.size === 0 && h.operations.length === before && calls.length === 0, 'dispose blocks subsequent mutation/callbacks');
  check(h.sequence.showFrame(1) === false && await h.sequence.ready() === false, 'disposed controls inert');
  assert.deepEqual(await h.sequence.play().finished, { cancelled: true, reason: 'disposed' }); checks++;
}
{
  const resolvers = [];
  const h = harness({ loadImage: src => new Promise(resolve => resolvers.push(() => resolve(image(src)))) });
  const r = h.sequence.play();
  h.sequence.dispose();
  check((await r.finished).reason === 'disposed', 'dispose during preload resolves playback');
  for (const resolve of resolvers) resolve();
  await flush();
  check(h.draws.length === 0 && h.pending.size === 0, 'late image loads cannot mutate disposed canvas');
}
for (const rejection of [false, true]) {
  const h = harness({
    loadImage: async src => {
      if (src === 'frame-2.png') { if (rejection) throw new Error('missing'); return null; }
      return image(src);
    },
  }), calls = [];
  check(await h.sequence.ready() === false, 'missing frame marks incomplete');
  check(h.draws.at(-1) === 'idle.png', 'missing frame retains idle');
  const r = h.sequence.play({ onEffect: () => calls.push('effect'), onImpact: () => calls.push('impact') });
  await flush(); h.tick(400);
  assert.deepEqual(await r.finished, { cancelled: false, reason: 'asset-fallback' }); checks++;
  check(h.draws.every(src => src === 'idle.png'), 'incomplete sequence never animates partial assets');
  assert.deepEqual(calls, ['effect', 'impact']); checks++;
}
{
  const h = harness({ loadImage: async src => src === 'idle.png' ? null : image(src) });
  check(await h.sequence.ready() === true, 'missing idle does not invalidate complete frames');
  check(h.draws.at(-1) === 'frame-0.png', 'missing idle uses frame zero');
}
{
  const h = harness({ idleSrc: undefined });
  await h.sequence.ready();
  check(h.loaded.length === 6 && h.draws.at(-1) === 'frame-0.png', 'optional idle uses frame zero without duplicate load');
}
for (const speed of [0.5, 1, 2, 4]) {
  const h = harness({ reduced: () => true, speed: () => speed }), calls = [];
  await h.sequence.ready();
  const r = h.sequence.play({ effectAt: 0, impactAt: 70, onEffect: () => calls.push('effect'), onImpact: () => calls.push('impact') });
  await flush();
  assert.deepEqual(calls, ['effect']); checks++;
  h.tick(69 / speed);
  check(calls.length === 1, 'reduced impact not early');
  h.tick(70 / speed);
  assert.deepEqual(calls, ['effect', 'impact']); checks++;
  check((await r.finished).cancelled === false, 'reduced playback completes at impact');
  check(h.frameEvents.every(index => index === -1), 'reduced keeps idle only');
}
{
  let mirrored = true;
  const h = harness({ flip: () => mirrored });
  await h.sequence.ready(); h.sequence.showFrame(3);
  check(h.operations.some(op => op[0] === 'translate' && op[1] === 440 && op[2] === 0), 'mirrored canvas uses full-width translation');
  check(h.operations.some(op => op[0] === 'scale' && op[1] === -1 && op[2] === 1), 'mirrored canvas uses horizontal flip');
  mirrored = false;
  const before = h.operations.length; h.sequence.showFrame(3);
  check(h.operations.length > before, 'manual same frame redraws when direction changes');
  const count = h.operations.length;
  for (const invalid of [-1, 6, 1.5, NaN, '2']) check(h.sequence.showFrame(invalid) === false, 'manual rejects invalid frame');
  check(h.operations.length === count, 'invalid frame does not mutate canvas');
}
{
  const h = harness();
  await h.sequence.ready();
  for (const options of [{ effectAt: -1 }, { effectAt: 200, impactAt: 180 }, { impactAt: 401 }, { effectAt: Infinity }, { onEffect: true }, { onImpact: 'x' }]) {
    assert.throws(() => h.sequence.play(options), TypeError); checks++;
  }
  const error = new Error('callback failure');
  const r = h.sequence.play({ onEffect: () => { throw error; } });
  await flush(); h.tick(110);
  const result = await r.finished;
  check(result.cancelled && result.reason === 'callback-error' && result.error === error, 'callback error resolves rather than hangs');
  check(h.pending.size === 0 && h.draws.at(-1) === 'idle.png', 'callback error restores idle and clears RAF');
}
{
  const h = harness(), calls = [];
  await h.sequence.ready();
  const r = h.sequence.play({ effectAt: 70, impactAt: 70, onEffect: () => calls.push('effect'), onImpact: () => calls.push('impact') });
  await flush(); h.tick(70);
  assert.deepEqual(calls, ['effect', 'impact']); checks++;
  r.cancel(); await r.finished;
}
{
  const calls = [];
  let sequence;
  const h = harness({ onFrame: index => { if (index === 3) sequence.dispose(); } });
  sequence = h.sequence;
  await sequence.ready();
  const r = sequence.play({ onEffect: () => calls.push('effect'), onImpact: () => calls.push('impact') });
  await flush(); h.tick(180);
  check((await r.finished).reason === 'disposed', 'onFrame can dispose during boundary render');
  check(calls.length === 0 && h.pending.size === 0, 'no boundary callbacks after onFrame disposal');
}
// Throttled tabs and high speeds must not paint recovery before contact or
// erase contact in the same RAF. A boundary callback must see the contact frame.
for (const speed of [0.5, 1, 2, 4]) {
  const h = harness({ speed: () => speed }), calls = [];
  await h.sequence.ready();
  let settled = false;
  const r = h.sequence.play({
    onEffect: () => calls.push(['effect', h.canvas.dataset.frame]),
    onImpact: () => calls.push(['impact', h.canvas.dataset.frame]),
  });
  r.finished.then(() => { settled = true; });
  await flush(); h.tick(450 / speed); await flush();
  assert.deepEqual(calls, [['effect', '3'], ['impact', '3']]); checks++;
  check(h.canvas.dataset.frame === '3' && !settled, 'late contact stays visible at ' + speed);
  assert.deepEqual(h.frameEvents, [-1, 0, 3]); checks++;
  h.tick(450 / speed + 16);
  check((await r.finished).cancelled === false, 'late contact completes on following RAF at ' + speed);
  assert.deepEqual(h.frameEvents, [-1, 0, 3, 5, -1]); checks++;
  check(h.pending.size === 0 && calls.length === 2, 'late callbacks exactly once and RAF cleared');
}
{
  const h = harness(), calls = [];
  await h.sequence.ready();
  const r = h.sequence.play({ onImpact: () => calls.push(h.canvas.dataset.frame) });
  await flush(); h.tick(110); h.tick(300);
  check(h.canvas.dataset.frame === '3', 'fast skip pins contact rather than recovery frame');
  assert.deepEqual(calls, ['3']); checks++;
  h.tick(340);
  check(h.canvas.dataset.frame === '5', 'following RAF progresses after pinned contact');
  const visible = h.frameEvents.filter(index => index >= 0);
  check(visible.every((index, n) => n === 0 || index >= visible[n - 1]), 'fast skip display is monotonic');
  h.tick(400); await r.finished;
  check(calls.length === 1, 'fast skip impact callback exactly once');
}
{
  const h = harness(), calls = [];
  await h.sequence.ready();
  const r = h.sequence.play({ effectAt: 70, impactAt: 140, onImpact: () => calls.push(h.canvas.dataset.frame) });
  await flush(); h.tick(300);
  check(h.canvas.dataset.frame === '2', 'contact frame follows custom impactAt');
  assert.deepEqual(calls, ['2']); checks++;
  h.tick(400); await r.finished;
}
for (const cancelKind of ['cancel', 'dispose']) {
  const h = harness(), calls = [];
  await h.sequence.ready();
  const r = h.sequence.play({ onEffect: () => calls.push('effect'), onImpact: () => calls.push('impact') });
  await flush(); h.tick(450);
  check(h.canvas.dataset.frame === '3', 'contact visible before ' + cancelKind);
  const count = h.operations.length;
  if (cancelKind === 'dispose') h.sequence.dispose();
  else r.cancel();
  check((await r.finished).cancelled, 'held contact can ' + cancelKind);
  check(h.pending.size === 0, 'held contact ' + cancelKind + ' clears pending RAF');
  h.tick(1000);
  check(calls.length === 2, 'held contact ' + cancelKind + ' does not duplicate callbacks');
  if (cancelKind === 'dispose') check(h.operations.length === count, 'held contact dispose never redraws');
  else check(h.draws.at(-1) === 'idle.png', 'held contact cancel restores idle');
}
console.log('pose-sequence-check: ' + checks + ' checks passed');
