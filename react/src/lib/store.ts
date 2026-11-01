// SnapClaim local store: cases and settings on this device only.
// Port of pwa/store.js. Plain localStorage (photos are downscaled JPEG data
// URLs); on quota a save retries without the photo rather than losing the
// case, and says so on the saved record (photoDropped: true).
export const CASES_KEY = "snapclaim.cases.v1";
export const SETTINGS_KEY = "snapclaim.settings.v1";
export const MAX_CASES = 100;
export const MAX_PHOTO_CHARS = 700_000;

/** CSPRNG case id. randomUUID needs a secure context; getRandomValues works
 * everywhere, so use it as the fallback instead of guessable Date+Math.random. */
export function secureId(): string {
  try {
    const c = globalThis.crypto as Crypto | undefined;
    if (c?.randomUUID) return c.randomUUID();
    if (c?.getRandomValues) {
      const b = new Uint8Array(16);
      c.getRandomValues(b);
      b[6] = (b[6]! & 0x0f) | 0x40;
      b[8] = (b[8]! & 0x3f) | 0x80;
      const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    /* fall through to last-resort below */
  }
  return `case-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

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
  /** Optional wide context shot; same quota rules as the close-up photo. */
  locationPhoto?: string | null;
  locationDropped?: boolean;
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
  const makeId = opts.makeId ?? secureId;

  function readCases(): SnapCase[] {
    const list = parse<unknown>(storage.getItem(CASES_KEY), []);
    if (!Array.isArray(list)) return [];
    // 90-day TTL: drop stale device-only cases automatically.
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    const fresh = (list as SnapCase[]).filter((c) => {
      const t = Date.parse(String((c as SnapCase).updatedAt ?? (c as SnapCase).createdAt ?? ""));
      return Number.isNaN(t) || t >= cutoff;
    });
    if (fresh.length !== (list as SnapCase[]).length) {
      try { writeCases(fresh); } catch { /* ignore */ }
    }
    return fresh;
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
      for (const key of ["locationPhoto"] as const) {
        if (typeof record[key] === "string" && (record[key] as string).length > MAX_PHOTO_CHARS) {
          record[key] = null;
          record.locationDropped = true;
        }
        if (typeof record[key] === "string" && !/^data:image\/(png|jpeg|webp);base64,/.test(record[key] as string)) {
          record[key] = null;
          record.locationDropped = true;
        }
      }
      let next = list.filter((c) => c.id !== record.id);
      next.push(record);
      next = next.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))).slice(-MAX_CASES);
      try {
        writeCases(next);
      } catch {
        record.photo = null;
        record.photoDropped = true;
        record.locationPhoto = null;
        record.locationDropped = true;
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
