import type { Receipt, ReceiptDraft } from "./types.ts";

/** Append-only evidence ledger. IDs are deterministic for a given insertion order. */
export class ReceiptLedger {
  #receipts: Receipt[] = [];
  #nextId = 1;

  add(draft: ReceiptDraft): Receipt {
    const receipt: Receipt = {
      id: `R${String(this.#nextId).padStart(3, "0")}`,
      ...draft,
    };
    this.#nextId += 1;
    this.#receipts.push(receipt);
    return receipt;
  }

  get size(): number {
    return this.#receipts.length;
  }

  get(id: string): Receipt | undefined {
    return this.#receipts.find((receipt) => receipt.id === id);
  }

  all(): Receipt[] {
    return [...this.#receipts];
  }

  toJsonl(): string {
    return this.#receipts.map((receipt) => JSON.stringify(receipt)).join("\n");
  }
}
