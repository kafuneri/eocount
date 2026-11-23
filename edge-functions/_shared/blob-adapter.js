/**
 * EdgeOne Blob Storage Adapter (Strong Consistency Mode).
 */

import { getStore } from '@edgeone/pages-blob';

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

export async function getJson(store, key) {
  const value = await store.get(key, { type: 'json', consistency: 'strong' });
  if (value === null || value === undefined) return null;
  return value;
}

export async function putJson(store, key, data) {
  await store.setJSON(key, data);
}

export async function deleteKey(store, key) {
  await store.delete(key);
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
  const result = await store.list(options);
  const keys = (result?.blobs || [])
    .map((item) => item?.key)
    .filter(Boolean);

  return {
    keys,
    cursor: result?.cursor || null,
    complete: !result?.cursor,
  };
}
