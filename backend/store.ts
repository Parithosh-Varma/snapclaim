/** Session store contract. Memory by default; D1 when a binding exists. No photo bytes. */
export interface SavedSession {
  id: string;
  at: string;
  findings: number;
  mode: string;
}

export interface Store {
  save(session: SavedSession): Promise<void>;
  list(): Promise<SavedSession[]>;
}

export const SESSION_LIST_LIMIT = 50;

export class MemoryStore implements Store {
  #items: SavedSession[] = [];
  async save(session: SavedSession): Promise<void> {
    this.#items.push({ ...session });
  }
  async list(): Promise<SavedSession[]> {
    return this.#items
      .map((s, i) => ({ s, i }))
      .sort((a, b) => (a.s.at < b.s.at ? 1 : a.s.at > b.s.at ? -1 : b.i - a.i))
      .slice(0, SESSION_LIST_LIMIT)
      .map(({ s }) => ({ ...s }));
  }
}

/** Minimal D1 surface (no @cloudflare/workers-types in this repo). */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

export class D1Store implements Store {
  #db: D1Database;
  constructor(db: D1Database) {
    this.#db = db;
  }
  async save(s: SavedSession): Promise<void> {
    await this.#db
      .prepare("INSERT INTO sessions (id, at, findings, mode) VALUES (?, ?, ?, ?)")
      .bind(s.id, s.at, s.findings, s.mode)
      .run();
  }
  async list(): Promise<SavedSession[]> {
    const { results } = await this.#db
      .prepare("SELECT id, at, findings, mode FROM sessions ORDER BY at DESC, rowid DESC LIMIT ?")
      .bind(SESSION_LIST_LIMIT)
      .all<SavedSession>();
    return results.map((r) => ({ id: r.id, at: r.at, findings: r.findings, mode: r.mode }));
  }
}
