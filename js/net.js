/* 서버 통신 계층.
 *
 * 규칙 하나: **여기서 실패해도 게임은 계속 돌아야 한다.**
 * 서버가 죽어 있든, 파일로 직접 열었든, 회사 방화벽에 막혔든
 * 게임은 localStorage 만으로 지금까지처럼 동작한다. 그래서 모든 함수는
 * 예외를 밖으로 던지지 않고 null 을 돌려준다.
 *
 * 지금 단계: 게스트(익명) 계정 발급까지. 진행상황 동기화는 아직 하지 않는다.
 */

const DEV_KEY = 'rowar.device';   // 이 브라우저를 가리키는 열쇠. 계정의 신분증이다
const TOK_KEY = 'rowar.session';  // 발급받은 세션 토큰

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 시크릿 모드 등 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
};

/* 이 브라우저의 device_key. 없으면 만들어 저장한다.
   이걸 잃으면 게스트 계정도 잃는다 — 그래서 나중에 정식 계정 승격이 필요하다. */
export function deviceKey() {
  let k = ls.get(DEV_KEY);
  if (!k) {
    k = (crypto.randomUUID && crypto.randomUUID()) ||
        ([...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join(''));
    ls.set(DEV_KEY, k);
  }
  return k;
}

export const token = () => ls.get(TOK_KEY);
export const clearSession = () => ls.del(TOK_KEY);

/* 서버 상태. online 이 아니면 화면에 '오프라인'을 표시하고 게임은 그대로 돈다. */
export const state = { online: false, accountId: null, guest: true, checkedAt: 0, error: null };

async function call(path, { method = 'GET', body, auth = true, timeout = 8000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (auth && token()) headers['authorization'] = 'Bearer ' + token();
    const res = await fetch(path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, data };
    return { ok: true, status: res.status, data };
  } catch (e) {
    // 네트워크 없음 · 타임아웃 · file:// 로 연 경우 전부 여기로 온다
    return { ok: false, status: 0, data: null, error: String(e && e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/* 게스트로 접속한다. 이미 토큰이 있으면 그걸로 확인만 하고,
   없거나 만료됐으면 device_key 로 새로 발급받는다. */
export async function connect() {
  state.checkedAt = Date.now();

  if (token()) {
    const r = await call('/api/me');
    if (r.ok && r.data && r.data.ok) {
      Object.assign(state, { online: true, accountId: r.data.account_id, guest: !!r.data.guest, error: null });
      return r.data;
    }
    if (r.status === 401) clearSession();      // 만료·폐기된 토큰이면 버리고 새로 받는다
    else if (r.status === 0) {                 // 서버에 닿지 못함 — 토큰은 그대로 둔다
      Object.assign(state, { online: false, error: r.error });
      return null;
    }
  }

  const g = await call('/api/auth/guest', { method: 'POST', body: { device_key: deviceKey() }, auth: false });
  if (!(g.ok && g.data && g.data.ok)) {
    Object.assign(state, { online: false, error: (g.data && g.data.error) || g.error || 'connect failed' });
    return null;
  }
  ls.set(TOK_KEY, g.data.token);

  const r = await call('/api/me');
  if (r.ok && r.data && r.data.ok) {
    Object.assign(state, { online: true, accountId: r.data.account_id, guest: !!r.data.guest, error: null });
    return r.data;
  }
  Object.assign(state, { online: false, error: 'me failed' });
  return null;
}

export async function health() {
  const r = await call('/api/health', { auth: false });
  return r.ok ? r.data : null;
}

/* ── 진행상황 동기화 ─────────────────────────────────────
 *
 * 누가 진실인가 — 지금은 이렇게 정한다.
 *   · 서버 rev 가 0 이면 (한 번도 올린 적 없음) → 이 브라우저 저장본을 올린다 (이관)
 *   · 서버 rev 가 내가 아는 rev 보다 크면 → 다른 곳에서 저장한 것이니 내려받는다
 *   · 그 밖에는 → 내가 바뀐 게 있으면 올린다
 *
 * 아직 게임 판정은 클라가 한다. 그래서 이 동기화는 '보관과 기기 간 이어하기'까지고,
 * 조작을 막지는 못한다. 그건 서버가 뽑기·전투를 직접 판정하는 다음 단계의 일이다.
 */
const REV_KEY = 'rowar.rev';

export const syncedRev = () => { const v = parseInt(ls.get(REV_KEY), 10); return Number.isFinite(v) ? v : -1; };
const setSyncedRev = r => ls.set(REV_KEY, String(r));

export async function pull() {
  const r = await call('/api/state');
  if (!(r.ok && r.data && r.data.ok)) return null;
  setSyncedRev(r.data.rev);
  return r.data;                      // { rev, nickname, rating, state, server_now }
}

export async function push(state) {
  const r = await call('/api/state', { method: 'PUT', body: { state, rev: syncedRev() } });
  if (r.ok && r.data && r.data.ok) { setSyncedRev(r.data.rev); return { ok: true, rev: r.data.rev, wrote: r.data.wrote }; }
  if (r.status === 409 && r.data && r.data.state) {   // 다른 곳이 먼저 저장했다
    setSyncedRev(r.data.rev);
    return { ok: false, conflict: true, remote: r.data };
  }
  return { ok: false, error: (r.data && r.data.error) || r.error || 'push failed' };
}

/* save() 가 불릴 때마다 부르되, 실제 전송은 묶어서 한 번만 한다.
   D1 은 쓴 행으로 과금하므로 조작 하나마다 보내면 안 된다. */
let timer = null, pending = null;
export function scheduleSync(getState, delay = 4000) {
  if (!state.online) return;
  pending = getState;
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    const get = pending; pending = null;
    if (!get) return;
    try { await push(get()); } catch { /* 실패해도 게임은 계속 */ }
  }, delay);
}

/* 서버에서 상태를 내려받은 직후처럼, 예약된 전송을 없애야 할 때 쓴다 */
export function cancelSync() { if (timer) { clearTimeout(timer); timer = null; } pending = null; }

/* 페이지를 닫기 전에 남은 변경을 한 번 밀어 넣는다 */
export async function flush(getState) {
  if (timer) { clearTimeout(timer); timer = null; }
  pending = null;
  if (!state.online) return null;
  return push(getState());
}

/* 서버 판정 뽑기. 온라인일 때만 쓴다 — 오프라인이면 null 을 돌려주고,
   부르는 쪽이 '연결이 필요하다'고 알린다. 오프라인에서 로컬로 굴리게 두면
   서버 판정을 넣은 의미가 사라진다(끊고 굴린 뒤 올리면 그만이므로). */
export async function pullServer(count) {
  if (!state.online) return null;
  const r = await call('/api/pull', { method: 'POST', body: { count } });
  if (r.ok && r.data && r.data.ok) { setSyncedRev(r.data.rev); return r.data; }
  return { error: (r.data && r.data.error) || r.error || 'pull failed', cores: r.data && r.data.cores };
}

/* 전투 — 서버 판정. find 로 상대를 받고, start 로 결과를 받는다. */
export async function battleFind() {
  if (!state.online) return null;
  const r = await call('/api/battle/find', { method: 'POST', body: {} });
  return (r.ok && r.data && r.data.ok) ? r.data : { error: (r.data && r.data.error) || r.error || 'find failed' };
}
export async function battleStart() {
  if (!state.online) return null;
  const r = await call('/api/battle/start', { method: 'POST', body: {} });
  if (r.ok && r.data && r.data.ok) { setSyncedRev(r.data.rev); return r.data; }
  return { error: (r.data && r.data.error) || r.error || 'start failed' };
}
