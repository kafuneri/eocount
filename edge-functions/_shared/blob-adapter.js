/**
 * EdgeOne Blob Storage Adapter (Strong Consistency Mode).
 */

import { getStore } from '@edgeone/pages-blob';

export const DEFAULT_CONCURRENCY = 5;

const NON_RETRYABLE_CODES = new Set([
  'QUOTA_EXCEEDED',
  'INVALID_KEY',
  'INVALID_STORE_NAME',
  'MISSING_PROJECT_ID',
  'MISSING_ENVIRONMENT',
  'PRECONDITION_FAILED',
]);

export function isRetryableError(err) {
  if (!err) return false;
  if (NON_RETRYABLE_CODES.has(err.code)) return false;
  if (err.code === 'RATE_LIMITED') return true;
  if (typeof err.statusCode === 'number') {
    // statusCode === 0 means SDK fetch() already exhausted its internal retries on network errors
    return err.statusCode === 429 || err.statusCode >= 500;
  }
  return true;
}

export async function withRetry(fn, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableError(err) || attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}

export async function mapConcurrent(items, fn, concurrency = DEFAULT_CONCURRENCY) {
  const effectiveConcurrency = Math.min(
    5,
    Math.max(1, Number(concurrency) || DEFAULT_CONCURRENCY)
  );
  const results = new Array(items.length);
  for (let i = 0; i < items.length; i += effectiveConcurrency) {
    const chunk = items.slice(i, i + effectiveConcurrency);
    const chunkRes = await Promise.all(
      chunk.map((item, idx) => fn(item, i + idx))
    );
    for (let j = 0; j < chunkRes.length; j++) {
      results[i + j] = chunkRes[j];
    }
  }
  return results;
}

const storeCache = new Map();

export function getStorage(env) {
  const storeName = env?.BLOB_STORE_NAME || 'eocount-data';
  const cacheKey = `${storeName}|${env?.PAGES_PROJECT_ID || ''}|${env?.PAGES_BLOB_DEPLOY_CREDENTIAL || ''}`;
  if (storeCache.has(cacheKey)) {
    return storeCache.get(cacheKey);
  }

  const options = {
    name: storeName,
    consistency: 'strong',
  };
  if (env?.PAGES_PROJECT_ID && env?.PAGES_BLOB_DEPLOY_CREDENTIAL) {
    options.projectId = env.PAGES_PROJECT_ID;
    options.token = env.PAGES_BLOB_DEPLOY_CREDENTIAL;
  }
  const store = getStore(options);
  if (storeCache.size >= 16) {
    storeCache.clear();
  }
  storeCache.set(cacheKey, store);
  return store;
}

export async function getJson(store, key, consistency = 'strong', retries = 2) {
  const value = await withRetry(
    () => store.get(key, { type: 'json', consistency }),
    retries
  );
  if (value === null || value === undefined) return null;
  return value;
}

export async function putJson(store, key, data, retries = 2) {
  await withRetry(() => store.setJSON(key, data), retries);
}

export async function deleteKey(store, key, retries = 2) {
  await withRetry(() => store.delete(key), retries);
}

export async function listKeys(
  store,
  {
    prefix = '',
    cursor,
    limit,
    directories = false,
    consistency = 'strong',
    retries = 1,
  } = {}
) {
  const options = {
    prefix,
    paginate: false,
    consistency,
  };
  if (directories) {
    // Never pass limit alongside directories: true (SDK paginate:false bug when blobs.length < limit)
    options.directories = true;
  } else if (typeof limit === 'number' && limit > 0) {
    options.limit = Math.min(1000, limit);
  }
  if (cursor) {
    options.cursor = cursor;
  }

  const result = await withRetry(() => store.list(options), retries);
  const keys = (result?.blobs || []).map((item) => item?.key).filter(Boolean);
  const dirs = (result?.directories || []).filter(Boolean);

  return {
    keys,
    directories: dirs,
    cursor: result?.cursor || null,
    complete: !result?.cursor,
  };
}
