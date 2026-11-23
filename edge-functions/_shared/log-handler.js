/**
 * Shared handler for /api/v1/log and /api/v2/log.
 */

import { getStorage } from './blob-adapter.js';
import { normalizeUrl } from './hash.js';
import {
  corsPreflightResponse,
  getClientIp,
  isBotUserAgent,
  isDomainAllowed,
  jsonResponse,
} from './cors.js';
import { getCounts, recordVisit } from './counter-service.js';

function formatResponse(version, counts, message, status = 200) {
  if (version === 'v1') {
    return jsonResponse(counts, status);
  }
  return jsonResponse({ status: 'success', message, data: counts }, status);
}

export async function handleLogOptions() {
  return corsPreflightResponse();
}

export async function handleLogGet(context, version = 'v2') {
  const { request, env } = context;
  const reqUrl = new URL(request.url);
  const targetUrl = reqUrl.searchParams.get('url');

  if (!targetUrl) {
    return jsonResponse(
      { status: 'error', message: 'Missing url parameter' },
      400
    );
  }

  const normalized = normalizeUrl(targetUrl);
  if (!normalized.valid) {
    return formatResponse(
      version,
      { site_uv: 0, site_pv: 0, page_pv: 0 },
      normalized.reason,
      200
    );
  }

  if (!isDomainAllowed(normalized.host, env)) {
    return jsonResponse(
      { status: 'error', message: 'Domain not allowed' },
      403
    );
  }

  try {
    const kv = getStorage(env);
    const counts = await getCounts(kv, normalized.host, normalized.path);
    return formatResponse(version, counts, 'Data retrieved successfully', 200);
  } catch (err) {
    return jsonResponse(
      { status: 'error', message: err.message || 'Internal error' },
      500
    );
  }
}

export async function handleLogPost(context, version = 'v2') {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ status: 'error', message: 'Invalid JSON body' }, 400);
  }

  if (!body?.url) {
    return jsonResponse({ status: 'error', message: 'Missing url' }, 400);
  }

  const normalized = normalizeUrl(body.url);
  if (!normalized.valid) {
    return formatResponse(
      version,
      { site_uv: 0, site_pv: 0, page_pv: 0 },
      normalized.reason,
      200
    );
  }

  if (!isDomainAllowed(normalized.host, env)) {
    return jsonResponse(
      { status: 'error', message: 'Domain not allowed' },
      403
    );
  }

  try {
    const kv = getStorage(env);
    const ua = request.headers.get('user-agent') || '';
    const skipBot = env?.FILTER_BOTS !== 'false' && isBotUserAgent(ua);

    if (skipBot) {
      const counts = await getCounts(kv, normalized.host, normalized.path, 'strong');
      return formatResponse(version, counts, 'Bot request (read-only)', 200);
    }

    const ip = getClientIp(request);
    const counts = await recordVisit(
      kv,
      normalized.host,
      normalized.path,
      ip,
      ua,
      env
    );
    return formatResponse(version, counts, 'Data updated successfully', 200);
  } catch (err) {
    return jsonResponse(
      { status: 'error', message: err.message || 'Internal error' },
      500
    );
  }
}
