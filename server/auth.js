/* 정식 계정 — 게스트를 아이디·비밀번호가 붙은 계정으로 승격한다.
 *
 * 승격은 '새 계정을 만드는 것'이 아니라 **지금 쓰던 계정에 로그인 수단을 붙이는 것**이다.
 * 그래서 진행상황이 그대로 이어진다. device_key 를 잃어도(브라우저 데이터 삭제,
 * 다른 기기) 아이디로 다시 들어올 수 있게 하는 것이 목적이다.
 *
 * 비밀번호는 PBKDF2-SHA256 으로 늘려서 저장한다. 평문은 어디에도 남기지 않고,
 * 로그에도 찍지 않는다. 저장 형식: pbkdf2$<반복>$<salt_b64>$<hash_b64>
 */

const ITER = 100000;            // Workers CPU 한도 안에서 도는지 실측하고 정한 값
const KEYLEN = 32;
const SALT_LEN = 16;

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function pbkdf2(password, salt, iter = ITER) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, KEYLEN * 8);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const bits = await pbkdf2(password, salt);
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(bits)}`;
}

/* 길이가 같아도 앞부분에서 갈리면 빨리 끝나는 비교는 쓰지 않는다.
   해시 비교라 위험이 크진 않지만 습관을 들여 둔다. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = parseInt(parts[1], 10);
  if (!Number.isFinite(iter) || iter < 1000 || iter > 1000000) return false;
  try {
    const bits = await pbkdf2(password, unb64(parts[2]), iter);
    return timingSafeEqual(new Uint8Array(bits), unb64(parts[3]));
  } catch { return false; }
}

/* 입력 검사 — 클라도 검사하지만 서버가 다시 본다. */
export const ID_RE = /^[a-zA-Z0-9_]{4,20}$/;
export function checkCredentials(loginId, password) {
  if (typeof loginId !== 'string' || !ID_RE.test(loginId))
    return '아이디는 영문·숫자·밑줄 4~20자여야 합니다';
  if (typeof password !== 'string' || password.length < 8)
    return '비밀번호는 8자 이상이어야 합니다';
  if (password.length > 200) return '비밀번호가 너무 깁니다';
  if (password.toLowerCase() === loginId.toLowerCase())
    return '비밀번호가 아이디와 같습니다';
  return null;
}

/* ── 로그인 시도 제한 ────────────────────────────────────
 * PBKDF2 가 180ms 걸려 자연스러운 제동은 되지만, 그것만으로는 무한 시도를 못 막는다.
 * 아이디별과 IP별로 따로 센다 — 아이디만 세면 IP 하나로 여러 아이디를 훑을 수 있고,
 * IP 만 세면 여러 IP 로 한 아이디를 노릴 수 있다.
 *
 * 쓰기는 '실패했을 때만' 일어난다. 성공하면 그 아이디 기록을 지운다.
 */
const WINDOW_MS = 10 * 60 * 1000;   // 이 시간 안의 실패를 센다
const BLOCK_MS  = 15 * 60 * 1000;   // 잠그는 시간

/* 아이디와 IP 의 기준을 다르게 둔다.
   학교 컴퓨터실처럼 여러 명이 같은 IP 를 쓰는 곳에서 IP 기준을 빡빡하게 잡으면
   한 사람이 비밀번호를 헷갈렸다고 교실 전체가 막힌다.
   실제 표적 공격은 '한 아이디를 계속 두드리는' 쪽이므로 아이디를 엄하게 본다. */
const MAX_FAILS = { id: 5, ip: 30 };

export const attemptKeys = (loginId, ip) =>
  [`id:${String(loginId || '').slice(0, 40)}`, ip ? `ip:${ip.slice(0, 45)}` : null].filter(Boolean);

/* 막혀 있으면 남은 초를 돌려준다. 아니면 0. */
export async function checkBlocked(env, keys, now) {
  if (!keys.length) return 0;
  const marks = keys.map((_, i) => `?${i + 1}`).join(',');
  const rows = (await env.DB.prepare(
    `SELECT k, blocked_until FROM login_attempt WHERE k IN (${marks})`).bind(...keys).all()).results || [];
  let until = 0;
  for (const r of rows) if (r.blocked_until > now && r.blocked_until > until) until = r.blocked_until;
  return until ? Math.ceil((until - now) / 1000) : 0;
}

export async function noteFailure(env, keys, now) {
  const stmts = [];
  for (const k of keys) {
    const max = k.startsWith('ip:') ? MAX_FAILS.ip : MAX_FAILS.id;
    /* 창이 지났으면 처음부터 다시 센다. 넘으면 blocked_until 을 세운다. */
    stmts.push(env.DB.prepare(
      `INSERT INTO login_attempt (k, fails, first_at, blocked_until) VALUES (?1, 1, ?2, 0)
       ON CONFLICT(k) DO UPDATE SET
         fails    = CASE WHEN ?2 - first_at > ${WINDOW_MS} THEN 1 ELSE fails + 1 END,
         first_at = CASE WHEN ?2 - first_at > ${WINDOW_MS} THEN ?2 ELSE first_at END,
         blocked_until = CASE
           WHEN ?2 - first_at <= ${WINDOW_MS} AND fails + 1 >= ${max} THEN ?2 + ${BLOCK_MS}
           ELSE blocked_until END`).bind(k, now));
  }
  await env.DB.batch(stmts);
}

/* 성공하면 '그 아이디'의 기록만 지운다.
   IP 기록까지 지우면 '아무 계정이나 한 번 성공시켜 카운터를 비우는' 우회가 생긴다. */
export async function clearAttempts(env, keys) {
  const idKey = keys.find(k => k.startsWith('id:'));
  if (!idKey) return;
  await env.DB.prepare('DELETE FROM login_attempt WHERE k = ?1').bind(idKey).run();
}
