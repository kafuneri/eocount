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
  mapConcurrent,
  putJson,
} from '../../_shared/blob-adapter.js';

function matchesStatsType(key, type) {
  if (type === 'site') return isSiteKey(key);
  if (type === 'page') return isPageKey(key);
  return isSiteKey(key) || isPageKey(key);
}

function collectSortedItems(keys, values, { hostFilter = '', search = '' } = {}) {
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

  return items;
}

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
    const MAX_OPS = 20;
    const MAX_LIMIT = 19;
    const MAX_LIST_CALLS = 8;
    const MAX_LEGACY_LIST_CALLS = 6;
    const MAX_DIR_LIST_CALLS = 5;

    const type = url.searchParams.get('type') || 'all'; // 'site' | 'page' | 'all'
    const hostFilter = (url.searchParams.get('host') || '').trim().toLowerCase();
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(url.searchParams.get('limit') || String(MAX_LIMIT), 10) || MAX_LIMIT)
    );
    const useCursor = url.searchParams.get('paginate') === 'cursor' || url.searchParams.has('cursor');
    const reqCursor = url.searchParams.get('cursor') || undefined;

    // Fast path 1: single site lookup
    if (type === 'site' && hostFilter) {
      const siteKey = buildSiteKey(hostFilter);
      const val = await getJson(store, siteKey, 'strong', 1);
      const items = collectSortedItems([siteKey], [val], { hostFilter, search });
      return jsonResponse({
        status: 'success',
        data: { items, total: items.length, offset: 0, nextOffset: null, nextCursor: null },
      });
    }

    // Fast path 2: all sites via directory listing
    if (type === 'site' && !hostFilter) {
      const allKeys = [];
      let dirCursor = undefined;
      let listCalls = 0;

      while (listCalls < MAX_DIR_LIST_CALLS) {
        const res = await listKeys(store, {
          prefix: 'sites/',
          directories: true,
          cursor: dirCursor,
          retries: 1,
        });
        listCalls++;
        for (const dir of res.directories) {
          const cleanDir = dir.endsWith('/') ? dir : `${dir}/`;
          const candidate = `${cleanDir}summary.json`;
          if (isSiteKey(candidate)) {
            allKeys.push(candidate);
          }
        }
        if (res.complete || !res.cursor) {
          dirCursor = undefined;
          break;
        }
        dirCursor = res.cursor;
      }

      const truncated = Boolean(dirCursor);
      const effectiveLimit = Math.min(limit, Math.max(1, MAX_OPS - listCalls));
      const pagedKeys = allKeys.slice(offset, offset + effectiveLimit);
      const nextOffset = offset + pagedKeys.length < allKeys.length ? offset + pagedKeys.length : null;
      const values = await mapConcurrent(pagedKeys, (k) => getJson(store, k, 'strong', 1), 5);
      const items = collectSortedItems(pagedKeys, values, { search });

      return jsonResponse({
        status: 'success',
        data: { items, total: allKeys.length, offset, nextOffset, nextCursor: null, truncated },
      });
    }

    let prefix = 'sites/';
    if (hostFilter) {
      const safeHost = sanitizeHostForKey(hostFilter);
      prefix = type === 'page' ? `sites/${safeHost}/pages/` : `sites/${safeHost}/`;
    }

    // Path 3: cursor pagination with dynamic op budget
    if (useCursor) {
      const matchedKeys = [];
      let cursor = reqCursor;
      let listCalls = 0;
      let done = false;

      while (listCalls < MAX_LIST_CALLS) {
        const targetCount = Math.min(limit, MAX_OPS - (listCalls + 1));
        const need = targetCount - matchedKeys.length;
        if (need <= 0) break;

        const res = await listKeys(store, { prefix, cursor, limit: need, retries: 1 });
        listCalls++;
        for (const k of res.keys) {
          if (matchesStatsType(k, type)) {
            matchedKeys.push(k);
          }
        }
        if (res.complete || !res.cursor) {
          cursor = null;
          done = true;
          break;
        }
        cursor = res.cursor;
      }

      const values = await mapConcurrent(matchedKeys, (k) => getJson(store, k, 'strong', 1), 5);
      const items = collectSortedItems(matchedKeys, values, { hostFilter, search });

      return jsonResponse({
        status: 'success',
        data: {
          items,
          total: null,
          offset: 0,
          nextOffset: null,
          nextCursor: done ? null : cursor,
        },
      });
    }

    // Path 4: bounded legacy offset pagination
    const allKeys = [];
    let cursor = undefined;
    let listCalls = 0;

    while (listCalls < MAX_LEGACY_LIST_CALLS) {
      const res = await listKeys(store, { prefix, cursor, retries: 1 });
      listCalls++;
      for (const k of res.keys) {
        if (matchesStatsType(k, type)) {
          allKeys.push(k);
        }
      }
      if (res.complete || !res.cursor) {
        cursor = undefined;
        break;
      }
      cursor = res.cursor;
    }

    const truncated = Boolean(cursor);
    const effectiveLimit = Math.min(limit, Math.max(1, MAX_OPS - listCalls));
    const pagedKeys = allKeys.slice(offset, offset + effectiveLimit);
    const nextOffset = offset + pagedKeys.length < allKeys.length ? offset + pagedKeys.length : null;
    const values = await mapConcurrent(pagedKeys, (k) => getJson(store, k, 'strong', 1), 5);
    const items = collectSortedItems(pagedKeys, values, { hostFilter, search });

    return jsonResponse({
      status: 'success',
      data: { items, total: allKeys.length, offset, nextOffset, nextCursor: null, truncated },
    });
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

    // Batch domain save: { domain | domainName, skipSiteUpdate?, site_pv, site_uv, pageViews: [{ path, page_pv | views, key }] }
    const rawDomain = body.domain || body.domainName;
    if (rawDomain && typeof rawDomain === 'string') {
      const norm = normalizeUrl(rawDomain.includes('://') ? rawDomain : `https://${rawDomain}/`);
      if (!norm.valid) {
        return jsonResponse({ status: 'error', message: norm.reason }, 400);
      }

      const pageViews = Array.isArray(body.pageViews) ? body.pageViews : [];
      const MAX_PUT_PAGES = 16;
      if (pageViews.length > MAX_PUT_PAGES) {
        return jsonResponse(
          { status: 'error', message: `Too many pageViews in a single request (max ${MAX_PUT_PAGES})` },
          400
        );
      }

      if (!body.skipSiteUpdate) {
        const siteKey = buildSiteKey(norm.host);
        const existingSite = (await getJson(store, siteKey, 'strong', 1)) || {};
        const siteData = {
          host: norm.host,
          site_pv: Number(body.site_pv ?? existingSite.site_pv ?? 0),
          site_uv: Number(body.site_uv ?? existingSite.site_uv ?? 0),
          ...(existingSite.daily ? { daily: existingSite.daily } : {}),
          updatedAt: now,
        };
        await putJson(store, siteKey, siteData, 1);
      }

      await mapConcurrent(
        pageViews,
        async (pvItem) => {
          if (!pvItem?.path) return;
          const pageNorm = normalizeUrl(
            `https://${norm.host}${pvItem.path.startsWith('/') ? pvItem.path : '/' + pvItem.path}`
          );
          const cleanPath = pageNorm.valid ? pageNorm.path : pvItem.path;
          const pKey = isPageKey(pvItem.key)
            ? pvItem.key
            : buildPageKey(norm.host, await getPathHash16(cleanPath));
          const pageData = {
            host: norm.host,
            path: cleanPath,
            page_pv: Number(pvItem.page_pv ?? pvItem.views ?? 0),
            updatedAt: now,
          };
          await putJson(store, pKey, pageData, 1);
        },
        5
      );

      return jsonResponse({
        status: 'success',
        data: { host: norm.host, updatedPages: pageViews.length },
      });
    }

    if (body.url) {
      const norm = normalizeUrl(body.url);
      if (!norm.valid) {
        return jsonResponse({ status: 'error', message: norm.reason }, 400);
      }
      if (body.kind === 'site') {
        const key = buildSiteKey(norm.host);
        const existing = (await getJson(store, key, 'strong', 1)) || {};
        const data = {
          host: norm.host,
          site_pv: Number(body.site_pv ?? existing.site_pv ?? 0),
          site_uv: Number(body.site_uv ?? existing.site_uv ?? 0),
          ...(existing.daily ? { daily: existing.daily } : {}),
          updatedAt: now,
        };
        await putJson(store, key, data, 1);
        return jsonResponse({ status: 'success', data: { key, kind: 'site', ...data } });
      }
      const pathHash16 = await getPathHash16(norm.path);
      const key = buildPageKey(norm.host, pathHash16);
      const existing = (await getJson(store, key, 'strong', 1)) || {};
      const data = {
        host: norm.host,
        path: norm.path,
        page_pv: Number(body.page_pv ?? existing.page_pv ?? 0),
        updatedAt: now,
      };
      await putJson(store, key, data, 1);
      return jsonResponse({ status: 'success', data: { key, kind: 'page', ...data } });
    }

    const key = body.key;
    if (!key || (!isSiteKey(key) && !isPageKey(key))) {
      return jsonResponse({ status: 'error', message: 'Invalid key or url' }, 400);
    }

    const existing = await getJson(store, key, 'strong', 1);
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
      await putJson(store, key, updated, 1);
      return jsonResponse({ status: 'success', data: { key, kind: 'site', ...updated } });
    }

    const updated = {
      ...existing,
      page_pv: Number(body.page_pv ?? existing.page_pv ?? 0),
      updatedAt: now,
    };
    await putJson(store, key, updated, 1);
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

  try {
    const store = getStorage(env);

    // Whole-domain delete: { domain }
    if (body?.domain && typeof body.domain === 'string') {
      const safeHost = sanitizeHostForKey(body.domain.trim());
      const prefix = `sites/${safeHost}/`;
      const res = await listKeys(store, { prefix, retries: 1 });

      const DELETE_BATCH = 19;
      const batch = res.keys.slice(0, DELETE_BATCH);
      await mapConcurrent(batch, (k) => deleteKey(store, k, 1), 5);

      const remaining = !res.complete
        ? Math.max(1, res.keys.length - batch.length)
        : Math.max(0, res.keys.length - batch.length);

      return jsonResponse({
        status: 'success',
        message: 'Domain deleted',
        data: {
          domain: body.domain,
          deleted: batch.length,
          remaining,
        },
      });
    }

    // Batch page delete: { keys: string[] }
    if (Array.isArray(body?.keys)) {
      const uniqueKeys = Array.from(
        new Set(body.keys.filter((k) => typeof k === 'string' && isPageKey(k)))
      );
      if (uniqueKeys.length === 0) {
        return jsonResponse({ status: 'error', message: 'No valid page keys provided' }, 400);
      }
      const MAX_DELETE_KEYS = 18;
      if (uniqueKeys.length > MAX_DELETE_KEYS) {
        return jsonResponse(
          { status: 'error', message: `Too many keys in a single delete batch (max ${MAX_DELETE_KEYS})` },
          400
        );
      }
      await mapConcurrent(uniqueKeys, (k) => deleteKey(store, k, 1), 5);
      return jsonResponse({
        status: 'success',
        message: 'Deleted',
        data: { deleted: uniqueKeys.length, keys: uniqueKeys },
      });
    }

    const key = body?.key;
    if (!key || typeof key !== 'string') {
      return jsonResponse({ status: 'error', message: 'Missing key or domain' }, 400);
    }

    await deleteKey(store, key, 1);
    return jsonResponse({ status: 'success', message: 'Deleted', data: { key } });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message }, 500);
  }
}
