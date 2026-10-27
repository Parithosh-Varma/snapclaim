/** Shared store contract. Stateless by default; D1 plugs in later. */
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

export class MemoryStore implements Store {
  #items: SavedSession[] = [];
  async save(session: SavedSession): Promise<void> {
    this.#items.push(session);
  }
  async list(): Promise<SavedSession[]> {
    return [...this.#items];
  }
}

/** D1 stub: throws until a real binding is wired. Keeps math untouched. */
export class D1StoreStub implements Store {
  async save(_session: SavedSession): Promise<void> {
    throw new Error("D1 not configured: set CLOUDFLARE_D1_BINDING and replace D1StoreStub");
  }
  async list(): Promise<SavedSession[]> {
    throw new Error("D1 not configured: set CLOUDFLARE_D1_BINDING and replace D1StoreStub");
  }
}
