/**
 * EdgeOne Blob Storage Adapter (Strong Consistency Mode).
 */

import { getStore } from '@edgeone/pages-blob';

export async function withRetry(fn, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}

export async function mapConcurrent(items, fn, concurrency = 8) {
  const results = new Array(items.length);
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkRes = await Promise.all(chunk.map((item, idx) => fn(item, i + idx)));
    for (let j = 0; j < chunkRes.length; j++) {
      results[i + j] = chunkRes[j];
    }
  }
  return results;
}

export function getStorage(env) {
  const storeName = env?.BLOB_STORE_NAME || 'eocount-dat';
  const options = {
    name: storeName,
    consistency: 'strong',
  };
  if (env?.PAGES_PROJECT_ID && env?.PAGES_BLOB_DEPLOY_CREDENTIAL) {
    options.projectId = env.PAGES_PROJECT_ID;
    options.token = env.PAGES_BLOB_DEPLOY_CREDENTIAL;
  }
  return getStore(options);
}

export async function getJson(store, key, consistency = 'strong') {
  const value = await withRetry(() => store.get(key, { type: 'json', consistency }));
  if (value === null || value === undefined) return null;
  return value;
}

export async function putJson(store, key, data) {
  await withRetry(() => store.setJSON(key, data));
}

export async function deleteKey(store, key) {
  await withRetry(() => store.delete(key));
}

export async function listKeys(store, { prefix = '', cursor, limit = 100 } = {}) {
  const options = {
    prefix,
    limit,
    paginate: false,
    consistency: 'strong',
  };
  if (cursor) {
    options.cursor = cursor;
  }
  const result = await withRetry(() => store.list(options));
  const keys = (result?.blobs || [])
    .map((item) => item?.key)
    .filter(Boolean);

  return {
    keys,
    cursor: result?.cursor || null,
    complete: !result?.cursor,
  };
}
