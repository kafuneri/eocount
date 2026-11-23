import { requireAdmin } from '../../_shared/auth.js';
import { getJson, getStorage, listKeys } from '../../_shared/blob-adapter.js';
import { corsPreflightResponse, jsonResponse } from '../../_shared/cors.js';

export function onRequestOptions() {
  return corsPreflightResponse();
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) {
    return jsonResponse({ status: 'error', message: auth.error }, auth.status);
  }

  const storeName = env?.BLOB_STORE_NAME || 'vercount-data';
  let blobConnected = false;
  let totalSites = 0;
  let totalPages = 0;
  let totalSitePv = 0;
  let totalSiteUv = 0;
  let blobError = null;

  try {
    const store = getStorage(env);

    const siteKeys = [];
    let cursor = undefined;
    do {
      const res = await listKeys(store, { prefix: 'site_', cursor, limit: 100 });
      siteKeys.push(...res.keys);
      cursor = res.complete ? undefined : res.cursor;
    } while (cursor);

    blobConnected = true;
    totalSites = siteKeys.length;
    const siteObjects = await Promise.all(siteKeys.map((k) => getJson(store, k)));
    for (const item of siteObjects) {
      if (item) {
        totalSitePv += Number(item.site_pv || 0);
        totalSiteUv += Number(item.site_uv || 0);
      }
    }

    let pageCursor = undefined;
    do {
      const res = await listKeys(store, { prefix: 'page_', cursor: pageCursor, limit: 100 });
      totalPages += res.keys.length;
      pageCursor = res.complete ? undefined : res.cursor;
    } while (pageCursor);
  } catch (err) {
    blobError = err.message;
  }

  return jsonResponse({
    status: 'success',
    data: {
      storageBackend: 'blob',
      blobStoreName: storeName,
      consistency: 'strong',
      blobConnected,
      blobError,
      allowedDomains: env?.ALLOWED_DOMAINS || '',
      filterBots: env?.FILTER_BOTS !== 'false',
      autoMigrateBusuanzi: env?.AUTO_MIGRATE_BUSUANZI === 'true',
      summary: {
        totalSites,
        totalPages,
        totalSitePv,
        totalSiteUv,
      },
    },
  });
}
