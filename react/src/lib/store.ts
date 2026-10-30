// SnapClaim local store: cases and settings on this device only.
// Port of pwa/store.js. Plain localStorage (photos are downscaled JPEG data
// URLs); on quota a save retries without the photo rather than losing the
// case, and says so on the saved record (photoDropped: true).
export const CASES_KEY = "snapclaim.cases.v1";
export const SETTINGS_KEY = "snapclaim.settings.v1";
export const MAX_CASES = 100;
export const MAX_PHOTO_CHARS = 700_000;

export interface SnapCase {
  id: string;
  createdAt: string;
  updatedAt: string;
  name?: string;
  property?: string;
  notes?: string;
  transcript?: string;
  label?: string;
  percent?: number;
  severity?: string;
  crackLengthMm?: number | null;
  areaCm2?: number | null;
  mode?: string;
  photo?: string | null;
  photoDropped?: boolean;
  [key: string]: unknown;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function parse<T>(raw: string | null, fallback: T): T {
  try {
    const v = JSON.parse(raw ?? "") as T | null;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export interface CaseStore {
  list(): SnapCase[];
  get(id: string): SnapCase | null;
  save(input: Partial<SnapCase>): SnapCase;
  remove(id: string): void;
  clear(): void;
  exportAll(): string;
  bytesUsed(): number;
  getSettings(): Record<string, unknown>;
  setSettings(patch: Record<string, unknown>): Record<string, unknown>;
}

export function createCaseStore(
  storage: StorageLike,
  opts: { now?: () => string; makeId?: () => string } = {},
): CaseStore {
  const now = opts.now ?? (() => new Date().toISOString());
  const makeId = opts.makeId ?? (() =>
    (globalThis.crypto?.randomUUID?.() ?? `case-${Date.now()}-${Math.floor(Math.random() * 1e9)}`));

  function readCases(): SnapCase[] {
    const list = parse<unknown>(storage.getItem(CASES_KEY), []);
    return Array.isArray(list) ? (list as SnapCase[]) : [];
  }
  function writeCases(list: SnapCase[]) {
    storage.setItem(CASES_KEY, JSON.stringify(list));
  }

  const store: CaseStore = {
    list() {
      return readCases().slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    get(id) {
      return readCases().find((c) => c.id === id) ?? null;
    },
    save(input) {
      const list = readCases();
      const existing = input.id ? list.find((c) => c.id === input.id) : undefined;
      const record: SnapCase = {
        ...existing,
        ...input,
        id: existing?.id ?? input.id ?? makeId(),
        createdAt: existing?.createdAt ?? input.createdAt ?? now(),
        updatedAt: now(),
      };
      if (typeof record.photo === "string" && record.photo.length > MAX_PHOTO_CHARS) {
        record.photo = null;
        record.photoDropped = true;
      }
      if (typeof record.photo === "string" && !/^data:image\/(png|jpeg|webp);base64,/.test(record.photo)) {
        record.photo = null;
        record.photoDropped = true;
      }
      let next = list.filter((c) => c.id !== record.id);
      next.push(record);
      next = next.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))).slice(-MAX_CASES);
      try {
        writeCases(next);
      } catch {
        record.photo = null;
        record.photoDropped = true;
        writeCases(next.map((c) => (c.id === record.id ? record : c)));
      }
      return record;
    },
    remove(id) {
      writeCases(readCases().filter((c) => c.id !== id));
    },
    clear() {
      storage.removeItem(CASES_KEY);
    },
    exportAll() {
      return JSON.stringify({ app: "snapclaim", exportedAt: now(), cases: store.list() }, null, 2);
    },
    bytesUsed() {
      let n = 0;
      for (const k of [CASES_KEY, SETTINGS_KEY]) n += (storage.getItem(k) ?? "").length;
      return n;
    },
    getSettings() {
      const s = parse<unknown>(storage.getItem(SETTINGS_KEY), {});
      return s && typeof s === "object" ? (s as Record<string, unknown>) : {};
    },
    setSettings(patch) {
      const next = { ...store.getSettings(), ...patch };
      storage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    },
  };
  return store;
}

/** The app-wide store; falls back to a no-op backend if localStorage throws. */
export function appStore(): CaseStore {
  try {
    return createCaseStore(localStorage);
  } catch {
    return createCaseStore({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  }
}
