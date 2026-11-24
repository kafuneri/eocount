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
  const url = new URL(request.url);
  const includeSiteStats = url.searchParams.get('includeSiteStats') !== 'false';
  const initialCursor = url.searchParams.get('cursor') || undefined;

  let blobConnected = false;
  let totalSites = 0;
  let totalPages = 0;
  let totalSitePv = 0;
  let totalSiteUv = 0;
  const pagesByHost = {};
  let blobError = null;
  let truncated = false;
  let siteStatsTruncated = false;
  let nextCursor = null;

  try {
    const store = getStorage(env);
    const MAX_OPS = 20;
    const maxListCalls = includeSiteStats ? 10 : 20;

    const siteKeys = [];
    let cursor = initialCursor;
    let listCalls = 0;

    do {
      const res = await listKeys(store, { prefix: 'sites/', cursor, retries: 1 });
      listCalls++;
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
      cursor = !res.complete && res.cursor ? res.cursor : undefined;
    } while (cursor && listCalls < maxListCalls);

    truncated = Boolean(cursor);
    nextCursor = truncated ? cursor : null;
    blobConnected = true;
    totalSites = siteKeys.length;

    if (includeSiteStats && siteKeys.length > 0) {
      const remainingBudget = Math.max(0, MAX_OPS - listCalls);
      const keysToFetch = siteKeys.slice(0, remainingBudget);
      siteStatsTruncated = siteKeys.length > keysToFetch.length;

      const siteObjects = await mapConcurrent(
        keysToFetch,
        (k) => getJson(store, k, 'strong', 1),
        5
      );
      for (const item of siteObjects) {
        if (item) {
          totalSitePv += Number(item.site_pv || 0);
          totalSiteUv += Number(item.site_uv || 0);
        }
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
        nextCursor,
        truncated,
        siteStatsTruncated,
      },
    },
  });
}
