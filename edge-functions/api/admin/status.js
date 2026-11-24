import { requireAdmin } from '../../_shared/auth.js';
import { getJson, getStorage, listKeys, mapConcurrent } from '../../_shared/blob-adapter.js';
import { corsPreflightResponse, jsonResponse } from '../../_shared/cors.js';
import { isPageKey, isSiteKey } from '../../_shared/hash.js';

export function onRequestOptions() {
  return corsPreflightResponse();
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) {
    return jsonResponse({ status: 'error', message: auth.error }, auth.status);
  }

  const storeName = env?.BLOB_STORE_NAME || 'eocount-data';
  let blobConnected = false;
  let totalSites = 0;
  let totalPages = 0;
  let totalSitePv = 0;
  let totalSiteUv = 0;
  const pagesByHost = {};
  let blobError = null;

  try {
    const store = getStorage(env);

    const siteKeys = [];
    let cursor = undefined;
    do {
      const res = await listKeys(store, { prefix: 'sites/', cursor, limit: 100 });
      for (const k of res.keys) {
        if (isSiteKey(k)) {
          siteKeys.push(k);
        } else if (isPageKey(k)) {
          totalPages++;
          const parts = k.split('/');
          if (parts.length >= 4 && parts[1]) {
            pagesByHost[parts[1]] = (pagesByHost[parts[1]] || 0) + 1;
          }
        }
      }
      cursor = res.complete ? undefined : res.cursor;
    } while (cursor);

    blobConnected = true;
    totalSites = siteKeys.length;
    const siteObjects = await mapConcurrent(siteKeys, (k) => getJson(store, k), 8);
    for (const item of siteObjects) {
      if (item) {
        totalSitePv += Number(item.site_pv || 0);
        totalSiteUv += Number(item.site_uv || 0);
      }
    }
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
        pagesByHost,
      },
    },
  });
}
