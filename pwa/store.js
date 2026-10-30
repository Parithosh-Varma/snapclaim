// SnapClaim local store: cases and settings on this device only.
// Plain localStorage (photos are downscaled JPEG data URLs, ~100-300 KB each);
// if a save hits the storage quota it retries without the photo rather than
// losing the case, and says so on the saved record (photoDropped: true).
// Capped so one origin cannot grow localStorage without bound.
export const CASES_KEY = "snapclaim.cases.v1";
export const SETTINGS_KEY = "snapclaim.settings.v1";
export const MAX_CASES = 100;
export const MAX_PHOTO_CHARS = 700_000;

function parse(raw, fallback) {
  try { const v = JSON.parse(raw ?? ""); return v ?? fallback; } catch { return fallback; }
}

export function createCaseStore(storage, opts = {}) {
  const now = opts.now ?? (() => new Date().toISOString());
  const makeId = opts.makeId ?? (() =>
    (globalThis.crypto?.randomUUID?.() ?? `case-${Date.now()}-${Math.floor(Math.random() * 1e9)}`));

  function readCases() {
    const list = parse(storage.getItem(CASES_KEY), []);
    return Array.isArray(list) ? list : [];
  }
  function writeCases(list) { storage.setItem(CASES_KEY, JSON.stringify(list)); }

  return {
    list() {
      return readCases().slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    get(id) { return readCases().find((c) => c.id === id) ?? null; },
    save(input) {
      const list = readCases();
      const existing = input.id ? list.find((c) => c.id === input.id) : null;
      const record = {
        ...existing, ...input,
        id: existing?.id ?? input.id ?? makeId(),
        createdAt: existing?.createdAt ?? input.createdAt ?? now(),
        updatedAt: now(),
      };
      // Drop oversized photo blobs up front: one 700KB+ data URL would crowd
      // out every other case in the ~5MB localStorage quota.
      if (typeof record.photo === "string" && record.photo.length > MAX_PHOTO_CHARS) {
        record.photo = null;
        record.photoDropped = true;
      }
      // Only our own downscaled data URLs are stored; anything else is dropped.
      if (typeof record.photo === "string" && !/^data:image\/(png|jpeg|webp);base64,/.test(record.photo)) {
        record.photo = null;
        record.photoDropped = true;
      }
      let next = list.filter((c) => c.id !== record.id);
      next.push(record);
      // Evict oldest-first so the store cannot grow without bound.
      next = next.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))).slice(-MAX_CASES);
      try {
        writeCases(next);
      } catch {
        // Quota: keep the measurements, drop the photo bytes.
        record.photo = null;
        record.photoDropped = true;
        writeCases(next.map((c) => (c.id === record.id ? record : c)));
      }
      return record;
    },
    remove(id) { writeCases(readCases().filter((c) => c.id !== id)); },
    clear() { storage.removeItem(CASES_KEY); },
    exportAll() { return JSON.stringify({ app: "snapclaim", exportedAt: now(), cases: this.list() }, null, 2); },
    bytesUsed() {
      let n = 0;
      for (const k of [CASES_KEY, SETTINGS_KEY]) n += (storage.getItem(k) ?? "").length;
      return n;
    },
    getSettings() {
      const s = parse(storage.getItem(SETTINGS_KEY), {});
      return s && typeof s === "object" ? s : {};
    },
    setSettings(patch) {
      const next = { ...this.getSettings(), ...patch };
      storage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    },
  };
}
