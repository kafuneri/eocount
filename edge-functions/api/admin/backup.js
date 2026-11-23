import { requireAdmin } from '../../_shared/auth.js';
import { corsPreflightResponse, jsonResponse } from '../../_shared/cors.js';
import {
  buildPageKey,
  buildSiteKey,
  getPathHash16,
  isPageKey,
  isSiteKey,
  isUvKey,
  normalizeUrl,
} from '../../_shared/hash.js';
import {
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
    const includeUv = url.searchParams.get('includeUv') === 'true';

    const keys = [];
    let cursor = undefined;
    do {
      const res = await listKeys(store, { prefix: 'sites/', cursor, limit: 100 });
      for (const k of res.keys) {
        if (isSiteKey(k) || isPageKey(k) || (includeUv && isUvKey(k))) {
          keys.push(k);
        }
      }
      cursor = res.complete ? undefined : res.cursor;
    } while (cursor);

    const values = await Promise.all(keys.map((k) => getJson(store, k)));
    const entries = {};
    for (let i = 0; i < keys.length; i++) {
      if (values[i] !== null) {
        entries[keys[i]] = values[i];
      }
    }

    return jsonResponse({
      status: 'success',
      data: {
        exportedAt: new Date().toISOString(),
        version: 2,
        count: Object.keys(entries).length,
        entries,
      },
    });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
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

  const mode = body?.mode === 'overwrite' ? 'overwrite' : 'max';
  const rawEntries = body?.entries || body?.data?.entries;
  const simpleList = Array.isArray(body?.items) ? body.items : null;

  if (!rawEntries && !simpleList) {
    return jsonResponse(
      { status: 'error', message: 'Missing entries object or items array' },
      400
    );
  }

  try {
    const store = getStorage(env);
    const now = Date.now();
    let imported = 0;
    let skipped = 0;

    const entriesToWrite = {};

    if (rawEntries && typeof rawEntries === 'object') {
      for (const [k, v] of Object.entries(rawEntries)) {
        if (isSiteKey(k) || isPageKey(k) || isUvKey(k)) {
          entriesToWrite[k] = v;
        }
      }
    }

    if (simpleList) {
      for (const item of simpleList) {
        if (!item?.url) continue;
        const norm = normalizeUrl(item.url);
        if (!norm.valid) continue;
        if (item.site_pv !== undefined || item.site_uv !== undefined) {
          const sKey = buildSiteKey(norm.host);
          entriesToWrite[sKey] = {
            host: norm.host,
            site_pv: Number(item.site_pv || 0),
            site_uv: Number(item.site_uv || 0),
            updatedAt: now,
          };
        }
        if (item.page_pv !== undefined) {
          const pathHash16 = await getPathHash16(norm.path);
          const pKey = buildPageKey(norm.host, pathHash16);
          entriesToWrite[pKey] = {
            host: norm.host,
            path: norm.path,
            page_pv: Number(item.page_pv || 0),
            updatedAt: now,
          };
        }
      }
    }

    const entriesList = Object.entries(entriesToWrite);
    const BATCH_SIZE = 5;

    async function withRetry(fn, retries = 2) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await fn();
        } catch (err) {
          if (attempt === retries) throw err;
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
    }

    async function processEntry([key, incoming]) {
      if (!incoming || typeof incoming !== 'object') {
        skipped++;
        return;
      }

      if (mode === 'overwrite') {
        await withRetry(() => putJson(store, key, { ...incoming, updatedAt: now }));
        imported++;
        return;
      }

      const existing = await withRetry(() => getJson(store, key));
      if (!existing) {
        await withRetry(() => putJson(store, key, { ...incoming, updatedAt: now }));
        imported++;
        return;
      }

      if (isSiteKey(key)) {
        const mergedPv = Math.max(Number(existing.site_pv || 0), Number(incoming.site_pv || 0));
        const mergedUv = Math.max(Number(existing.site_uv || 0), Number(incoming.site_uv || 0));
        if (mergedPv > Number(existing.site_pv || 0) || mergedUv > Number(existing.site_uv || 0)) {
          await withRetry(() => putJson(store, key, {
            ...existing,
            host: incoming.host || existing.host,
            site_pv: mergedPv,
            site_uv: mergedUv,
            updatedAt: now,
          }));
          imported++;
        } else {
          skipped++;
        }
      } else if (isPageKey(key)) {
        const mergedPv = Math.max(Number(existing.page_pv || 0), Number(incoming.page_pv || 0));
        if (mergedPv > Number(existing.page_pv || 0)) {
          await withRetry(() => putJson(store, key, {
            ...existing,
            host: incoming.host || existing.host,
            path: incoming.path || existing.path,
            page_pv: mergedPv,
            updatedAt: now,
          }));
          imported++;
        } else {
          skipped++;
        }
      } else if (isUvKey(key)) {
        const prevHashes = Array.isArray(existing.hashes) ? existing.hashes : [];
        const nextHashes = Array.isArray(incoming.hashes) ? incoming.hashes : [];
        const merged = Array.from(new Set([...prevHashes, ...nextHashes]));
        if (merged.length > prevHashes.length) {
          await withRetry(() => putJson(store, key, {
            ...existing,
            host: incoming.host || existing.host,
            hashes: merged,
            updatedAt: now,
          }));
          imported++;
        } else {
          skipped++;
        }
      }
    }

    for (let i = 0; i < entriesList.length; i += BATCH_SIZE) {
      await Promise.all(entriesList.slice(i, i + BATCH_SIZE).map(processEntry));
    }

    return jsonResponse({
      status: 'success',
      data: { mode, imported, skipped },
    });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message }, 500);
  }
}
