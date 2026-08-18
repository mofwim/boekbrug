// src/lib/open-invoice-proof-types.ts
// [OPENSTAAND-BEWIJS] The shapes, alone. Both the engine-backed module and the text module need
// them, and neither may drag the other into a bundle it does not belong in — the same split
// bestanden-shared.ts exists for.

/** One open invoice for which a payment was found anyway. */
export interface OpenInvoiceHit {
  invoiceId: string
  invoiceNumber: string | null
  clientName: string | null
  /** What is still open on the invoice — never the full total when instalments were paid. */
  openAmount: number
  transaction: {
    date: string
    /** Negative: money out. Reported as the magnitude the owner reads on their statement. */
    amount: number
    description: string
    counterpartName: string | null
  }
  confidence: number
  /** The engine's own short Dutch explanation of WHY these two look like a pair. */
  reason: string
}

export interface OpenInvoiceProof {
  /** How many open purchase invoices were compared. */
  checkedInvoices: number
  /** How many bank lines they were compared against. */
  checkedTransactions: number
  /**
   * The payments that look like they already settled one of those invoices. Empty is the normal
   * answer and the reassuring one — but only BESIDE the two counts above, which is why they are
   * not optional.
   */
  hits: OpenInvoiceHit[]
}
