/* Experimental pose-only sequence. No combat, production manifest, or motion.js edits.
 * A canvas fighter intentionally contains no <img>, so motion.js cannot replace
 * these frames with its single-pose sprite. Sequence assets stay unapproved.
 */
const DEFAULT_EFFECT = 110;
const DEFAULT_IMPACT = 180;

function validateFrames(frames) {
  if (!Array.isArray(frames) || !frames.length) throw new TypeError('frames must be non-empty');
  return frames.map(frame => {
    if (!frame || typeof frame.src !== 'string' || !frame.src.trim()) throw new TypeError('frame.src must be non-empty');
    if (!Number.isFinite(frame.duration) || frame.duration <= 0) throw new TypeError('frame.duration must be positive');
    return { src: frame.src, duration: frame.duration };
  });
}
export function sequenceDuration(frames) {
  return validateFrames(frames).reduce((sum, frame) => sum + frame.duration, 0);
}
export function frameAt(frames, elapsed) {
  const checked = validateFrames(frames);
  if (!Number.isFinite(elapsed)) throw new TypeError('elapsed must be finite');
  let end = 0;
  for (let i = 0; i < checked.length; i++) {
    end += checked[i].duration;
    if (elapsed < end) return i;
  }
  return checked.length - 1;
}
function browserLoad(src) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/* ready(): Promise<boolean>; showFrame(index): boolean.
 * play(): { finished: Promise<{cancelled, reason, error?}>, cancel() }.
 * speed/reduced/flip are sampled for each play. Flip is also sampled on a manual
 * showFrame. onFrame gets the frame index, or -1 when returning to idle.
 * Crossing the impact boundary pins its contact frame for one RAF, even when
 * a throttled tab jumps past the whole animation. Completion then waits until
 * the following tick; onImpact never needs to show a frame itself.
 * Callers use effectAt=0, impactAt=70 for reduced-motion slash VFX; the pose stays idle.
 */
export function createPoseSequence(canvas, opts = {}) {
  const frames = validateFrames(opts.frames);
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) throw new TypeError('a 2D canvas is required');
  if (opts.idleSrc != null && (typeof opts.idleSrc !== 'string' || !opts.idleSrc.trim())) throw new TypeError('idleSrc must be non-empty');
  const idleSrc = opts.idleSrc || frames[0].src;
  const total = frames.reduce((sum, frame) => sum + frame.duration, 0);
  const raf = opts.raf || (callback => requestAnimationFrame(callback));
  const caf = opts.caf || (id => cancelAnimationFrame(id));
  const now = opts.now || (() => performance.now());
  const loadImage = opts.loadImage || browserLoad;
  let disposed = false, readyPromise = null, loaded = false, complete = false;
  let active = null, displayed = null;
  const images = new Map();
  const flip = () => !!(opts.flip && opts.flip());

  function draw(src, index, mirrored, force = false) {
    if (disposed || !loaded) return false;
    const image = images.get(src);
    if (!image) return false;
    const signature = src + ':' + index + ':' + mirrored;
    if (!force && displayed === signature) return true;
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      if (mirrored) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    } finally { ctx.restore(); }
    displayed = signature;
    if (canvas.dataset) canvas.dataset.frame = String(index);
    if (opts.onFrame) opts.onFrame(index);
    return true;
  }
  function idle(mirrored = flip()) {
    const src = images.get(idleSrc) ? idleSrc : frames[0].src;
    return draw(src, -1, mirrored);
  }
  function ready() {
    if (disposed) return Promise.resolve(false);
    if (!readyPromise) {
      readyPromise = Promise.all([...new Set([idleSrc, ...frames.map(frame => frame.src)])].map(async src => {
        let image = null;
        try { image = await loadImage(src); } catch { /* missing assets use idle */ }
        if (!disposed) images.set(src, image || null);
      })).then(() => {
        if (disposed) return false;
        loaded = true;
        complete = frames.every(frame => !!images.get(frame.src));
        idle();
        return complete;
      });
    }
    return readyPromise;
  }
  function showFrame(index) {
    if (disposed || !Number.isInteger(index) || index < 0 || index >= frames.length) return false;
    return draw(frames[index].src, index, flip());
  }
  function play(options = {}) {
    const effectAt = options.effectAt == null ? DEFAULT_EFFECT : options.effectAt;
    const impactAt = options.impactAt == null ? DEFAULT_IMPACT : options.impactAt;
    if (!Number.isFinite(effectAt) || !Number.isFinite(impactAt) || effectAt < 0 || effectAt > impactAt || impactAt > total) {
      throw new TypeError('require 0 <= effectAt <= impactAt <= sequence duration');
    }
    if (options.onEffect != null && typeof options.onEffect !== 'function') throw new TypeError('onEffect must be a function');
    if (options.onImpact != null && typeof options.onImpact !== 'function') throw new TypeError('onImpact must be a function');
    if (active) active.cancel('replaced');
    let resolve;
    const finished = new Promise(done => { resolve = done; });
    if (disposed) {
      resolve({ cancelled: true, reason: 'disposed' });
      return { finished, cancel() {} };
    }
    const requestedSpeed = opts.speed ? Number(opts.speed()) : 1;
    const speed = Number.isFinite(requestedSpeed) && requestedSpeed > 0 ? requestedSpeed : 1;
    const reduced = !!(opts.reduced && opts.reduced());
    const mirrored = flip();
    let ended = false, rafId = null, start = 0, effectDone = false, impactDone = false;
    function finish(cancelled, reason, error) {
      if (ended) return;
      ended = true;
      if (rafId != null) { caf(rafId); rafId = null; }
      if (active === run) active = null;
      try { if (!disposed) idle(mirrored); } catch (idleError) { error ||= idleError; }
      resolve({ cancelled, reason, ...(error ? { error } : {}) });
    }
    const run = { finished, cancel: reason => finish(true, reason || 'cancelled') };
    active = run;
    function invoke(callback) {
      try { if (callback) callback(); }
      catch (error) { finish(true, 'callback-error', error); }
    }
    function tick(timestamp) {
      rafId = null;
      if (ended || disposed) return;
      const elapsed = Math.max(0, (timestamp - start) * speed);
      try {
        const contactTick = !reduced && complete && !impactDone && elapsed >= impactAt;
        if (!reduced && complete) {
          // Do not paint a recovery frame before the first impact callback and
          // then rewind to contact. A skipped boundary still gets one paint.
          const index = frameAt(frames, contactTick ? impactAt : elapsed);
          draw(frames[index].src, index, mirrored);
        }
        // onFrame can cancel, replace, or dispose this run while drawing.
        if (ended || disposed) return;
        if (!effectDone && elapsed >= effectAt) { effectDone = true; invoke(options.onEffect); }
        if (ended || disposed) return;
        if (!impactDone && elapsed >= impactAt) { impactDone = true; invoke(options.onImpact); }
        if (ended || disposed) return;
        if (!contactTick && elapsed >= (reduced ? impactAt : total)) {
          finish(false, complete ? 'complete' : 'asset-fallback');
          return;
        }
        rafId = raf(tick);
      } catch (error) { finish(true, 'callback-error', error); }
    }
    ready().then(() => {
      if (ended || disposed) return;
      start = now();
      tick(start);
    }).catch(error => finish(true, 'load-error', error));
    return run;
  }
  function dispose() {
    if (disposed) return;
    // Set the flag before cancellation: disposing never redraws an idle frame.
    disposed = true;
    if (active) active.cancel('disposed');
    images.clear();
  }
  return { ready, showFrame, play, dispose };
}

