/**
 * Core PV/UV counter business logic backed by EdgeOne KV.
 */

import { getJson, putJson } from './blob-adapter.js';
import {
  buildPageKey,
  buildSiteKey,
  buildUvKey,
  getBucketHex,
  getHostHash12,
  getPathHash16,
  getVisitorHash16,
} from './hash.js';

async function fetchBusuanziBaseline(host, path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const targetUrl = `https://${host}${path}`;
    const res = await fetch(
      `https://busuanzi.ibruce.info/busuanzi?jsonpCallback=BusuanziCallback_0`,
      {
        headers: {
          Referer: targetUrl,
          'User-Agent': 'Mozilla/5.0 (compatible; EO-Vercount/1.0)',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/BusuanziCallback_0\((.*)\)/);
    if (!match) return null;
    const data = JSON.parse(match[1]);
    return {
      site_pv: Number(data?.site_pv || 0),
      site_uv: Number(data?.site_uv || 0),
      page_pv: Number(data?.page_pv || 0),
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

export async function getCounts(kv, host, path) {
  const [hostHash12, pathHash16] = await Promise.all([
    getHostHash12(host),
    getPathHash16(path),
  ]);

  const sKey = buildSiteKey(hostHash12);
  const pKey = buildPageKey(hostHash12, pathHash16);

  const [siteData, pageData] = await Promise.all([
    getJson(kv, sKey),
    getJson(kv, pKey),
  ]);

  return {
    site_uv: Number(siteData?.site_uv || 0),
    site_pv: Number(siteData?.site_pv || 0),
    page_pv: Number(pageData?.page_pv || 0),
  };
}

export async function recordVisit(kv, host, path, ip, ua, env) {
  const [hostHash12, pathHash16, visitorHash16] = await Promise.all([
    getHostHash12(host),
    getPathHash16(path),
    getVisitorHash16(host, ip, ua),
  ]);

  const bucketHex = getBucketHex(visitorHash16);
  const sKey = buildSiteKey(hostHash12);
  const pKey = buildPageKey(hostHash12, pathHash16);
  const uKey = buildUvKey(hostHash12, bucketHex);

  const [existingSite, existingPage, existingUv] = await Promise.all([
    getJson(kv, sKey),
    getJson(kv, pKey),
    getJson(kv, uKey),
  ]);

  let bszBaseline = null;
  if (
    env?.AUTO_MIGRATE_BUSUANZI === 'true' &&
    (!existingSite || !existingPage)
  ) {
    bszBaseline = await fetchBusuanziBaseline(host, path);
  }

  const now = Date.now();
  const uvHashes = Array.isArray(existingUv?.hashes) ? existingUv.hashes : [];
  const isNewVisitor = !uvHashes.includes(visitorHash16);

  const baseSitePv = existingSite
    ? Number(existingSite.site_pv || 0)
    : Number(bszBaseline?.site_pv || 0);
  const baseSiteUv = existingSite
    ? Number(existingSite.site_uv || 0)
    : Number(bszBaseline?.site_uv || 0);
  const basePagePv = existingPage
    ? Number(existingPage.page_pv || 0)
    : Number(bszBaseline?.page_pv || 0);

  const nextSitePv = baseSitePv + 1;
  const nextSiteUv = baseSiteUv + (isNewVisitor ? 1 : 0);
  const nextPagePv = basePagePv + 1;

  const writes = [
    putJson(kv, sKey, {
      host,
      site_pv: nextSitePv,
      site_uv: nextSiteUv,
      updatedAt: now,
    }),
    putJson(kv, pKey, {
      host,
      path,
      page_pv: nextPagePv,
      updatedAt: now,
    }),
  ];

  if (isNewVisitor) {
    writes.push(
      putJson(kv, uKey, {
        host,
        bucket: bucketHex,
        hashes: [...uvHashes, visitorHash16],
        updatedAt: now,
      })
    );
  }

  await Promise.all(writes);

  return {
    site_uv: nextSiteUv,
    site_pv: nextSitePv,
    page_pv: nextPagePv,
  };
}
