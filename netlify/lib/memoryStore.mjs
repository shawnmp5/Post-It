/*
 * A stand-in for Netlify Blobs for local development (npm run dev) and tests:
 * same calls, same conditional writes, kept in memory until the dev server stops.
 */
const stores = new Map();

export function memoryStore(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  let tag = 0;
  return {
    async get(key, opts = {}) {
      if (!m.has(key)) return null;
      const v = m.get(key).value;
      return opts.type === 'json' ? JSON.parse(v) : v;
    },
    async getWithMetadata(key, opts = {}) {
      if (!m.has(key)) return null;
      const e = m.get(key);
      return { data: opts.type === 'json' ? JSON.parse(e.value) : e.value, etag: e.etag, metadata: {} };
    },
    async setJSON(key, value, opts = {}) {
      const cur = m.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = `"${name}-${++tag}-${Date.now()}"`;
      m.set(key, { value: JSON.stringify(value), etag });
      return { modified: true, etag };
    },
    async delete(key) {
      m.delete(key);
    },
  };
}
