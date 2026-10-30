// Types for ./store.js (plain JS shared by the PWA and the test suite).
export const CASES_KEY: string;
export const SETTINGS_KEY: string;

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
  opts?: { now?: () => string; makeId?: () => string },
): CaseStore;
