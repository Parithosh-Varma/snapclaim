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

/** Hard cap on the in-memory session log: unauthenticated POST /v1/sessions
 * could otherwise grow the array forever (memory-DoS). Oldest evicted first. */
export const SESSION_STORE_CAP = 1000;

export class MemoryStore implements Store {
  #items: SavedSession[] = [];
  async save(session: SavedSession): Promise<void> {
    this.#items.push({ ...session });
    while (this.#items.length > SESSION_STORE_CAP) this.#items.shift();
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
    // Same 1000-cap as MemoryStore: prune oldest to bound D1 growth/billing.
    // Never swallow: a failing prune would grow the table forever.
    try {
      await this.#db
        .prepare("DELETE FROM sessions WHERE rowid NOT IN (SELECT rowid FROM sessions ORDER BY at DESC, rowid DESC LIMIT 1000)")
        .run();
    } catch (e) {
      console.error("[sessions] D1 prune failed", e);
    }
  }
  async list(): Promise<SavedSession[]> {
    const { results } = await this.#db
      .prepare("SELECT id, at, findings, mode FROM sessions ORDER BY at DESC, rowid DESC LIMIT ?")
      .bind(SESSION_LIST_LIMIT)
      .all<SavedSession>();
    return results.map((r) => ({ id: r.id, at: r.at, findings: r.findings, mode: r.mode }));
  }
}
