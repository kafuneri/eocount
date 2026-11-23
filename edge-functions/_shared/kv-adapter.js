/**
 * EdgeOne KV Storage Adapter
 * Reads the KV namespace bound globally in EdgeOne Pages (default: `my_kv`).
 */

export function getKvNamespace(env) {
  const bindingName = env?.KV_BINDING_NAME || 'my_kv';
  const kv = globalThis[bindingName];
  if (!kv) {
    throw new Error(`KV namespace "${bindingName}" is not bound in EdgeOne Pages.`);
  }
  return kv;
}

export async function getJson(kv, key) {
  const value = await kv.get(key, 'json');
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

export async function putJson(kv, key, data) {
  await kv.put(key, JSON.stringify(data));
}

export async function deleteKey(kv, key) {
  await kv.delete(key);
}

export async function listKeys(kv, { prefix = '', cursor, limit = 100 } = {}) {
  const options = { prefix, limit };
  if (cursor) {
    options.cursor = cursor;
  }
  const result = await kv.list(options);
  const rawKeys = result?.keys || [];
  const keys = rawKeys
    .map((item) => (typeof item === 'string' ? item : item?.name))
    .filter(Boolean);

  return {
    keys,
    cursor: result?.cursor || null,
    complete: Boolean(result?.complete ?? result?.list_complete ?? !result?.cursor),
  };
}
