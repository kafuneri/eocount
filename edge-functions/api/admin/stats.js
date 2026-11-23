import { requireAdmin } from '../../_shared/auth.js';
import { corsPreflightResponse, jsonResponse } from '../../_shared/cors.js';
import {
  buildPageKey,
  buildSiteKey,
  getPathHash16,
  isPageKey,
  isSiteKey,
  normalizeUrl,
  sanitizeHostForKey,
} from '../../_shared/hash.js';
import {
  deleteKey,
  getJson,
  getStorage,
  listKeys,
  putJson,
} from '../../_shared/blob-adapter.js';

export function onRequestOptions() {
  return corsPreflightResponse();
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) {
    return jsonResponse({ status: 'error', message: auth.error }, auth.status);
  }

  try {
    const store = getStorage(env);
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'all'; // 'site' | 'page' | 'all'
    const hostFilter = (url.searchParams.get('host') || '').trim().toLowerCase();
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();

    let prefix = 'sites/';
    if (hostFilter) {
      const safeHost = sanitizeHostForKey(hostFilter);
      prefix = type === 'page' ? `sites/${safeHost}/pages/` : `sites/${safeHost}/`;
    }

    const keys = [];
    let cursor = undefined;
    do {
      const res = await listKeys(store, { prefix, cursor, limit: 100 });
      for (const k of res.keys) {
        if (type === 'site' && !isSiteKey(k)) continue;
        if (type === 'page' && !isPageKey(k)) continue;
        if (type === 'all' && !isSiteKey(k) && !isPageKey(k)) continue;
        keys.push(k);
      }
      cursor = res.complete ? undefined : res.cursor;
    } while (cursor);

    const values = await Promise.all(keys.map((k) => getJson(store, k)));
    const items = [];
    for (let i = 0; i < keys.length; i++) {
      const val = values[i];
      if (!val) continue;
      if (hostFilter && val.host?.toLowerCase() !== hostFilter) continue;
      if (search) {
        const hay = `${val.host || ''} ${val.path || ''}`.toLowerCase();
        if (!hay.includes(search)) continue;
      }
      items.push({
        key: keys[i],
        kind: isSiteKey(keys[i]) ? 'site' : 'page',
        ...val,
      });
    }

    items.sort((a, b) => {
      const pvA = a.kind === 'site' ? Number(a.site_pv || 0) : Number(a.page_pv || 0);
      const pvB = b.kind === 'site' ? Number(b.site_pv || 0) : Number(b.page_pv || 0);
      return pvB - pvA;
    });

    return jsonResponse({ status: 'success', data: { items, total: items.length } });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) {
    return jsonResponse({ status: 'error', message: auth.error }, auth.status);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ status: 'error', message: 'Invalid JSON body' }, 400);
  }

  try {
    const store = getStorage(env);
    const now = Date.now();

    if (body.url) {
      const norm = normalizeUrl(body.url);
      if (!norm.valid) {
        return jsonResponse({ status: 'error', message: norm.reason }, 400);
      }
      if (body.kind === 'site') {
        const key = buildSiteKey(norm.host);
        const existing = (await getJson(store, key)) || {};
        const data = {
          host: norm.host,
          site_pv: Number(body.site_pv ?? existing.site_pv ?? 0),
          site_uv: Number(body.site_uv ?? existing.site_uv ?? 0),
          updatedAt: now,
        };
        await putJson(store, key, data);
        return jsonResponse({ status: 'success', data: { key, kind: 'site', ...data } });
      }
      const pathHash16 = await getPathHash16(norm.path);
      const key = buildPageKey(norm.host, pathHash16);
      const existing = (await getJson(store, key)) || {};
      const data = {
        host: norm.host,
        path: norm.path,
        page_pv: Number(body.page_pv ?? existing.page_pv ?? 0),
        updatedAt: now,
      };
      await putJson(store, key, data);
      return jsonResponse({ status: 'success', data: { key, kind: 'page', ...data } });
    }

    const key = body.key;
    if (!key || (!isSiteKey(key) && !isPageKey(key))) {
      return jsonResponse({ status: 'error', message: 'Invalid key or url' }, 400);
    }

    const existing = await getJson(store, key);
    if (!existing) {
      return jsonResponse({ status: 'error', message: 'Key not found' }, 404);
    }

    if (isSiteKey(key)) {
      const updated = {
        ...existing,
        site_pv: Number(body.site_pv ?? existing.site_pv ?? 0),
        site_uv: Number(body.site_uv ?? existing.site_uv ?? 0),
        updatedAt: now,
      };
      await putJson(store, key, updated);
      return jsonResponse({ status: 'success', data: { key, kind: 'site', ...updated } });
    }

    const updated = {
      ...existing,
      page_pv: Number(body.page_pv ?? existing.page_pv ?? 0),
      updatedAt: now,
    };
    await putJson(store, key, updated);
    return jsonResponse({ status: 'success', data: { key, kind: 'page', ...updated } });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) {
    return jsonResponse({ status: 'error', message: auth.error }, auth.status);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ status: 'error', message: 'Invalid JSON body' }, 400);
  }

  const key = body?.key;
  if (!key || typeof key !== 'string') {
    return jsonResponse({ status: 'error', message: 'Missing key' }, 400);
  }

  try {
    const store = getStorage(env);
    await deleteKey(store, key);
    return jsonResponse({ status: 'success', message: 'Deleted', data: { key } });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message }, 500);
  }
}
