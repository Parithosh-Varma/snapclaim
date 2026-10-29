'use strict';
/* CaseStore — tiny IndexedDB wrapper for local-first cases. No dependencies.
 * Photos are downscaled JPEG dataURLs (set by the app, never full-res originals
 * beyond 1024px). All timestamps are device-clock labels, not verified evidence.
 * Quota failures reject so the app can show an honest message. */
(function () {
  const DB = 'snapclaim', STORE = 'cases';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!('indexedDB' in globalThis)) { reject(new Error('no-indexeddb')); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('idb-open-failed'));
      req.onblocked = () => reject(new Error('idb-blocked'));
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      let out;
      try {
        const t = db.transaction(STORE, mode);
        const st = t.objectStore(STORE);
        out = fn(st);
        t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
        t.onerror = () => reject(t.error || new Error('idb-txn-failed'));
        t.onabort = () => reject(t.error || new Error('idb-aborted'));
      } catch (e) { reject(e); }
    }));
  }

  function reqToResult(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('idb-request-failed'));
    });
  }

  function mem() {
    // Private in-memory fallback when IndexedDB is unavailable (private mode).
    const m = new Map();
    return {
      async list() { return [...m.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); },
      async get(id) { return m.get(id) || null; },
      async put(c) { m.set(c.id, c); return c; },
      async remove(id) { m.delete(id); },
      async clear() { m.clear(); },
      fallback: true,
    };
  }
  let fallback = null;

  async function guard(fn, fb) {
    try { return await fn(); }
    catch (e) {
      if (e && (e.message === 'no-indexeddb' || e.message === 'idb-open-failed' || e.message === 'idb-blocked')) {
        fallback = fallback || mem();
        return fb();
      }
      throw e;
    }
  }

  function nowId() {
    const b = new Uint8Array(8);
    (globalThis.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => (b[i] = (Math.random() * 256) | 0));
    return 'c_' + Date.now().toString(36) + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('').slice(0, 8);
  }

  globalThis.CaseStore = {
    newId: nowId,
    async list() {
      return guard(
        async () => {
          const db = await open();
          return reqToResult(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
        },
        async () => (fallback || (fallback = mem())).list(),
      ).then((rows) => (rows || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    },
    async get(id) {
      return guard(
        async () => {
          const db = await open();
          return reqToResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(id));
        },
        async () => (fallback || (fallback = mem())).get(id),
      );
    },
    async put(c) {
      const rec = { ...c, updatedAt: Date.now() };
      return guard(
        async () => { await tx('readwrite', (st) => st.put(rec)); return rec; },
        async () => (fallback || (fallback = mem())).put(rec),
      );
    },
    async remove(id) {
      return guard(
        async () => { await tx('readwrite', (st) => st.delete(id)); },
        async () => (fallback || (fallback = mem())).remove(id),
      );
    },
    async clear() {
      return guard(
        async () => { await tx('readwrite', (st) => st.clear()); },
        async () => (fallback || (fallback = mem())).clear(),
      );
    },
  };
})();
