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
  mapConcurrent,
  putJson,
} from '../../_shared/blob-adapter.js';

function matchesBackupKey(key, includeUv) {
  return isSiteKey(key) || isPageKey(key) || (includeUv && isUvKey(key));
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

    const includeUv = url.searchParams.get('includeUv') === 'true';
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(url.searchParams.get('limit') || String(MAX_LIMIT), 10) || MAX_LIMIT)
    );
    const useCursor = url.searchParams.get('paginate') === 'cursor' || url.searchParams.has('cursor');
    const reqCursor = url.searchParams.get('cursor') || undefined;

    if (useCursor) {
      const matchedKeys = [];
      let cursor = reqCursor;
      let listCalls = 0;
      let done = false;

      while (listCalls < MAX_LIST_CALLS) {
        const targetCount = Math.min(limit, MAX_OPS - (listCalls + 1));
        const need = targetCount - matchedKeys.length;
        if (need <= 0) break;

        const res = await listKeys(store, { prefix: 'sites/', cursor, limit: need, retries: 1 });
        listCalls++;
        for (const k of res.keys) {
          if (matchesBackupKey(k, includeUv)) {
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
      const entries = {};
      for (let i = 0; i < matchedKeys.length; i++) {
        if (values[i] !== null) {
          entries[matchedKeys[i]] = values[i];
        }
      }

      return jsonResponse({
        status: 'success',
        data: {
          exportedAt: new Date().toISOString(),
          version: 2,
          total: null,
          nextOffset: null,
          nextCursor: done ? null : cursor,
          count: Object.keys(entries).length,
          entries,
        },
      });
    }

    const allKeys = [];
    let cursor = undefined;
    let listCalls = 0;

    while (listCalls < MAX_LEGACY_LIST_CALLS) {
      const res = await listKeys(store, { prefix: 'sites/', cursor, retries: 1 });
      listCalls++;
      for (const k of res.keys) {
        if (matchesBackupKey(k, includeUv)) {
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
    const entries = {};
    for (let i = 0; i < pagedKeys.length; i++) {
      if (values[i] !== null) {
        entries[pagedKeys[i]] = values[i];
      }
    }

    return jsonResponse({
      status: 'success',
      data: {
        exportedAt: new Date().toISOString(),
        version: 2,
        total: allKeys.length,
        nextOffset,
        nextCursor: null,
        truncated,
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
    const MAX_ENTRIES = mode === 'overwrite' ? 18 : 9;
    if (entriesList.length > MAX_ENTRIES) {
      return jsonResponse(
        {
          status: 'error',
          message: `Too many entries in a single import batch (${entriesList.length} > max ${MAX_ENTRIES} for mode "${mode}")`,
        },
        400
      );
    }

    async function processEntry([key, incoming]) {
      if (!incoming || typeof incoming !== 'object') {
        skipped++;
        return;
      }

      if (mode === 'overwrite') {
        await putJson(store, key, { ...incoming, updatedAt: now }, 1);
        imported++;
        return;
      }

      const existing = await getJson(store, key, 'strong', 1);
      if (!existing) {
        await putJson(store, key, { ...incoming, updatedAt: now }, 1);
        imported++;
        return;
      }

      if (isSiteKey(key)) {
        const mergedPv = Math.max(Number(existing.site_pv || 0), Number(incoming.site_pv || 0));
        const mergedUv = Math.max(Number(existing.site_uv || 0), Number(incoming.site_uv || 0));
        if (mergedPv > Number(existing.site_pv || 0) || mergedUv > Number(existing.site_uv || 0)) {
          await putJson(
            store,
            key,
            {
              ...existing,
              host: incoming.host || existing.host,
              site_pv: mergedPv,
              site_uv: mergedUv,
              updatedAt: now,
            },
            1
          );
          imported++;
        } else {
          skipped++;
        }
      } else if (isPageKey(key)) {
        const mergedPv = Math.max(Number(existing.page_pv || 0), Number(incoming.page_pv || 0));
        if (mergedPv > Number(existing.page_pv || 0)) {
          await putJson(
            store,
            key,
            {
              ...existing,
              host: incoming.host || existing.host,
              path: incoming.path || existing.path,
              page_pv: mergedPv,
              updatedAt: now,
            },
            1
          );
          imported++;
        } else {
          skipped++;
        }
      } else if (isUvKey(key)) {
        const prevHashes = Array.isArray(existing.hashes) ? existing.hashes : [];
        const nextHashes = Array.isArray(incoming.hashes) ? incoming.hashes : [];
        const merged = Array.from(new Set([...prevHashes, ...nextHashes]));
        if (merged.length > prevHashes.length) {
          await putJson(
            store,
            key,
            {
              ...existing,
              host: incoming.host || existing.host,
              hashes: merged,
              updatedAt: now,
            },
            1
          );
          imported++;
        } else {
          skipped++;
        }
      }
    }

    await mapConcurrent(entriesList, processEntry, 5);

    return jsonResponse({
      status: 'success',
      data: { mode, imported, skipped },
    });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message }, 500);
  }
}
