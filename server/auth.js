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
