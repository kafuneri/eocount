import { requireAdmin } from '../../_shared/auth.js';
import { corsPreflightResponse, jsonResponse } from '../../_shared/cors.js';
import {
  buildPageKey,
  buildSiteKey,
  getHostHash12,
  getPathHash16,
  normalizeUrl,
} from '../../_shared/hash.js';
import {
  getJson,
  getKvNamespace,
  listKeys,
  putJson,
} from '../../_shared/kv-adapter.js';

export function onRequestOptions() {
  return corsPreflightResponse();
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) {
    return jsonResponse({ status: 'error', message: auth.error }, auth.status);
  }

  try {
    const kv = getKvNamespace(env);
    const url = new URL(request.url);
    const includeUv = url.searchParams.get('includeUv') === 'true';

    const keys = [];
    let cursor = undefined;
    do {
      const res = await listKeys(kv, { prefix: '', cursor, limit: 100 });
      for (const k of res.keys) {
        if (k.startsWith('site_') || k.startsWith('page_') || (includeUv && k.startsWith('uv_'))) {
          keys.push(k);
        }
      }
      cursor = res.complete ? undefined : res.cursor;
    } while (cursor);

    const values = await Promise.all(keys.map((k) => getJson(kv, k)));
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
        version: 1,
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

  // Also support simplified array format: [{ url, site_pv, site_uv, page_pv }]
  const simpleList = Array.isArray(body?.items) ? body.items : null;

  if (!rawEntries && !simpleList) {
    return jsonResponse(
      { status: 'error', message: 'Missing entries object or items array' },
      400
    );
  }

  try {
    const kv = getKvNamespace(env);
    const now = Date.now();
    let imported = 0;
    let skipped = 0;

    const entriesToWrite = {};

    if (rawEntries && typeof rawEntries === 'object') {
      for (const [k, v] of Object.entries(rawEntries)) {
        if (k.startsWith('site_') || k.startsWith('page_') || k.startsWith('uv_')) {
          entriesToWrite[k] = v;
        }
      }
    }

    if (simpleList) {
      for (const item of simpleList) {
        if (!item?.url) continue;
        const norm = normalizeUrl(item.url);
        if (!norm.valid) continue;
        const hostHash12 = await getHostHash12(norm.host);
        if (item.site_pv !== undefined || item.site_uv !== undefined) {
          const sKey = buildSiteKey(hostHash12);
          entriesToWrite[sKey] = {
            host: norm.host,
            site_pv: Number(item.site_pv || 0),
            site_uv: Number(item.site_uv || 0),
            updatedAt: now,
          };
        }
        if (item.page_pv !== undefined) {
          const pathHash16 = await getPathHash16(norm.path);
          const pKey = buildPageKey(hostHash12, pathHash16);
          entriesToWrite[pKey] = {
            host: norm.host,
            path: norm.path,
            page_pv: Number(item.page_pv || 0),
            updatedAt: now,
          };
        }
      }
    }

    for (const [key, incoming] of Object.entries(entriesToWrite)) {
      if (!incoming || typeof incoming !== 'object') {
        skipped++;
        continue;
      }

      if (mode === 'overwrite') {
        await putJson(kv, key, { ...incoming, updatedAt: now });
        imported++;
        continue;
      }

      const existing = await getJson(kv, key);
      if (!existing) {
        await putJson(kv, key, { ...incoming, updatedAt: now });
        imported++;
        continue;
      }

      if (key.startsWith('site_')) {
        const mergedPv = Math.max(Number(existing.site_pv || 0), Number(incoming.site_pv || 0));
        const mergedUv = Math.max(Number(existing.site_uv || 0), Number(incoming.site_uv || 0));
        if (mergedPv > Number(existing.site_pv || 0) || mergedUv > Number(existing.site_uv || 0)) {
          await putJson(kv, key, {
            ...existing,
            host: incoming.host || existing.host,
            site_pv: mergedPv,
            site_uv: mergedUv,
            updatedAt: now,
          });
          imported++;
        } else {
          skipped++;
        }
      } else if (key.startsWith('page_')) {
        const mergedPv = Math.max(Number(existing.page_pv || 0), Number(incoming.page_pv || 0));
        if (mergedPv > Number(existing.page_pv || 0)) {
          await putJson(kv, key, {
            ...existing,
            host: incoming.host || existing.host,
            path: incoming.path || existing.path,
            page_pv: mergedPv,
            updatedAt: now,
          });
          imported++;
        } else {
          skipped++;
        }
      } else if (key.startsWith('uv_')) {
        const prevHashes = Array.isArray(existing.hashes) ? existing.hashes : [];
        const nextHashes = Array.isArray(incoming.hashes) ? incoming.hashes : [];
        const merged = Array.from(new Set([...prevHashes, ...nextHashes]));
        if (merged.length > prevHashes.length) {
          await putJson(kv, key, {
            ...existing,
            host: incoming.host || existing.host,
            hashes: merged,
            updatedAt: now,
          });
          imported++;
        } else {
          skipped++;
        }
      }
    }

    return jsonResponse({
      status: 'success',
      data: { mode, imported, skipped },
    });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message }, 500);
  }
}
