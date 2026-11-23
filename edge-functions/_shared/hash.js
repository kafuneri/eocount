/**
 * URL normalization, Web Crypto SHA-256 hashing, and KV-safe key builders.
 * EdgeOne KV keys allow only [A-Za-z0-9_] and max 512 bytes.
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
  // Collapse duplicate slashes
  path = path.replace(/\/{2,}/g, '/');

  // Normalize index files
  if (/^\/(index|index\.html|index\.htm)$/i.test(path)) {
    path = '/';
  } else if (/\/index(\.html|\.htm)?$/i.test(path)) {
    path = path.replace(/\/index(\.html|\.htm)?$/i, '') || '/';
  }

  // Remove trailing slash except root
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

export async function getHostHash12(host) {
  return (await sha256Hex(host)).slice(0, 12);
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

export function buildSiteKey(hostHash12) {
  return `site_${hostHash12}`;
}

export function buildPageKey(hostHash12, pathHash16) {
  return `page_${hostHash12}_${pathHash16}`;
}

export function buildUvKey(hostHash12, bucketHex) {
  return `uv_${hostHash12}_${bucketHex}`;
}
