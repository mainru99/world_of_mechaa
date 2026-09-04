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
