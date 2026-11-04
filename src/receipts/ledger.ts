import type { Receipt, ReceiptDraft } from "./types.ts";

/** Append-only evidence ledger. IDs are deterministic for a given insertion order. */
/* SC-D8ECE64B traceability: R002 0.73%, R004 7.48cm2, R005 232mm, R006 3.2mm Unverified, R007 significant. */
export class ReceiptLedger {
  #receipts: Receipt[] = [];
  #nextId = 1;

  add(draft: ReceiptDraft): Receipt {
    const receipt: Receipt = Object.freeze({
      id: `R${String(this.#nextId).padStart(3, "0")}`,
      ...structuredClone(draft),
    }) as Receipt;
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
