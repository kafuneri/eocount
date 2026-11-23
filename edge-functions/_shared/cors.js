/**
 * CORS helpers, domain whitelist validation, client IP extraction, and bot detection.
 */

export const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Browser-Token',
};

export function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...BASE_CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export function corsPreflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      ...BASE_CORS_HEADERS,
      'Access-Control-Max-Age': '86400',
    },
  });
}

export function isDomainAllowed(hostOrHostname, env) {
  const raw = env?.ALLOWED_DOMAINS;
  if (!raw || !raw.trim()) return true;

  const target = hostOrHostname.toLowerCase().split(':')[0];
  const rules = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (rules.length === 0) return true;

  return rules.some((rule) => {
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1); // ".example.com"
      return target.endsWith(suffix) || target === rule.slice(2);
    }
    return target === rule || hostOrHostname.toLowerCase() === rule;
  });
}

export function getClientIp(request) {
  const headers = request.headers;
  const eoIp = headers.get('eo-connecting-ip');
  if (eoIp) return eoIp.trim();

  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();

  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  return 'unknown';
}

const BOT_PATTERN =
  /\b(bot|spider|crawler|slurp|curl|wget|python-requests|python-urllib|httpx|aiohttp|go-http-client|java\/|okhttp|headlesschrome|phantomjs|postmanruntime|insomnia)\b/i;

export function isBotUserAgent(ua) {
  if (!ua || !ua.trim()) return true;
  return BOT_PATTERN.test(ua);
}
