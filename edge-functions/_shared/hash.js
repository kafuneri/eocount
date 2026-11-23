/**
 * URL normalization, Web Crypto SHA-256 hashing, and Blob directory key builders.
 * Layout:
 *   sites/<host>/summary.json
 *   sites/<host>/pages/<pathHash16>.json
 *   sites/<host>/uv/<bucketHex>.json
 */

export async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'Missing url' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTP and HTTPS protocols are supported' };
  }

  const host = parsed.host.toLowerCase();
  if (!host) {
    return { valid: false, reason: 'Invalid URL host' };
  }

  let path = parsed.pathname || '/';
  path = path.replace(/\/{2,}/g, '/');

  if (/^\/(index|index\.html|index\.htm)$/i.test(path)) {
    path = '/';
  } else if (/\/index(\.html|\.htm)?$/i.test(path)) {
    path = path.replace(/\/index(\.html|\.htm)?$/i, '') || '/';
  }

  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  if (path.length > 200) {
    path = path.slice(0, 200);
  }

  return {
    valid: true,
    host,
    hostname: parsed.hostname.toLowerCase(),
    path,
  };
}

export function sanitizeHostForKey(host) {
  return String(host).toLowerCase().replace(/:/g, '_');
}

export async function getPathHash16(path) {
  return (await sha256Hex(path)).slice(0, 16);
}

export async function getVisitorHash16(host, ip, ua) {
  return (await sha256Hex(`${host}|${ip}|${ua}`)).slice(0, 16);
}

export function getBucketHex(visitorHash16) {
  const bucketIndex = parseInt(visitorHash16.slice(0, 2), 16) % 64;
  return bucketIndex.toString(16).padStart(2, '0');
}

export function buildSiteKey(host) {
  return `sites/${sanitizeHostForKey(host)}/summary.json`;
}

export function buildPageKey(host, pathHash16) {
  return `sites/${sanitizeHostForKey(host)}/pages/${pathHash16}.json`;
}

export function buildUvKey(host, bucketHex) {
  return `sites/${sanitizeHostForKey(host)}/uv/${bucketHex}.json`;
}

export function isSiteKey(key) {
  return typeof key === 'string' && key.startsWith('sites/') && key.endsWith('/summary.json');
}

export function isPageKey(key) {
  return typeof key === 'string' && key.startsWith('sites/') && key.includes('/pages/') && key.endsWith('.json');
}

export function isUvKey(key) {
  return typeof key === 'string' && key.startsWith('sites/') && key.includes('/uv/') && key.endsWith('.json');
}
