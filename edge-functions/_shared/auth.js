/**
 * Single-admin stateless authentication using Web Crypto HMAC-SHA256 cookies.
 */

const COOKIE_NAME = 'eocount_session';
const LEGACY_COOKIE_NAME = 'eo_vc_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const bufA = enc.encode(String(a));
  const bufB = enc.encode(String(b));
  const len = Math.max(bufA.length, bufB.length);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < len; i++) {
    diff |= (bufA[i] || 0) ^ (bufB[i] || 0);
  }
  return diff === 0;
}

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(env) {
  const secret = env?.ADMIN_SESSION_SECRET || env?.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error('ADMIN_PASSWORD is not configured');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export function verifyAdminPassword(password, env) {
  const configured = env?.ADMIN_PASSWORD;
  if (!configured) {
    return { ok: false, error: 'ADMIN_PASSWORD environment variable is not set' };
  }
  if (!password || typeof password !== 'string') {
    return { ok: false, error: 'Password is required' };
  }
  if (!timingSafeEqual(password, configured)) {
    return { ok: false, error: 'Invalid password' };
  }
  return { ok: true };
}

export async function createSessionCookie(request, env) {
  const payload = {
    role: 'admin',
    exp: Date.now() + SESSION_TTL_MS,
  };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getHmacKey(env);
  const sigBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadB64)
  );
  const sigB64 = toBase64Url(new Uint8Array(sigBuffer));
  const token = `${payloadB64}.${sigB64}`;

  const isHttps = new URL(request.url).protocol === 'https:';
  const secureAttr = isHttps ? ' Secure;' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${secureAttr} SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookie(request) {
  const isHttps = new URL(request.url).protocol === 'https:';
  const secureAttr = isHttps ? ' Secure;' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly;${secureAttr} SameSite=Strict; Max-Age=0`;
}

function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      map[k] = v;
    }
  }
  return map;
}

export async function requireAdmin(request, env) {
  if (!env?.ADMIN_PASSWORD) {
    return { ok: false, status: 500, error: 'ADMIN_PASSWORD environment variable is not configured' };
  }

  // Optional Bearer token support for CLI/backup scripts
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (timingSafeEqual(bearer, env.ADMIN_PASSWORD)) {
      return { ok: true };
    }
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  const token = cookies[COOKIE_NAME] || cookies[LEGACY_COOKIE_NAME];
  if (!token || !token.includes('.')) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const [payloadB64, sigB64] = token.split('.');
  try {
    const key = await getHmacKey(env);
    const sigBytes = fromBase64Url(sigB64);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) {
      return { ok: false, status: 401, error: 'Invalid session signature' };
    }
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
    if (payload?.role !== 'admin' || !payload?.exp || Date.now() > payload.exp) {
      return { ok: false, status: 401, error: 'Session expired' };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 401, error: 'Invalid session' };
  }
}
