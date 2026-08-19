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

/** Which side of the books is being proved. */
export type ProofDirection = 'incoming' | 'outgoing'

export interface OpenInvoiceProof {
  /**
   * Whose money is being looked for. It changes nothing about the search — the engine already
   * reads the sign — and everything about the SENTENCE: on a purchase invoice the owner is looking
   * for money that left, on a sales invoice for money that arrived, and "afgeschreven naar" under
   * a customer's payment is a wrong word on the screen that has to be trusted most.
   */
  direction: ProofDirection
  /** How many open invoices — of whichever direction — were compared. */
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

/**
 * A proof as it comes off the server: the finding, plus everything needed to say how far the
 * search actually reached.
 *
 * It lives HERE rather than beside the reads, because the sentences are built from it and the
 * text module may not import a module that talks to the database. The collector re-exports it, so
 * every existing caller keeps its import.
 */
export interface OpenInvoiceProofResult extends OpenInvoiceProof {
  /** The most recent bank line this owner has, whatever its status. Null when there are none. */
  bankThrough: string | null
  /**
   * [NO-SILENT-EMPTY] A read did not answer. The screen must then say it could not look, never
   * "geen betaling gevonden" — an absence over a failed read is the most convincing lie this
   * feature could tell.
   */
  readFailed: boolean
  /** What the ceilings dropped, so the screen can say the check was bounded. */
  capped: { invoices: number; transactions: number }
  /**
   * [BINNENGEKOMEN-BEWIJS] The same two sets, grouped the other way — present only on the sales
   * side, where an unattached CREDIT is a customer payment. Null on the purchase side, where an
   * unattached debit is a cost without a receipt and has its own answer elsewhere.
   */
  incoming: IncomingPaymentProof | null
}

/** One received payment that is attached to nothing yet. */
export interface IncomingPaymentHit {
  transactionId: string
  date: string
  /** The magnitude the owner reads on their statement. */
  amount: number
  description: string
  counterpartName: string | null
  /** The open invoice it looks like — present only when the evidence rule accepted the pairing. */
  invoiceId: string
  invoiceNumber: string | null
  clientName: string | null
  openAmount: number
  confidence: number
  reason: string
}

/**
 * [BINNENGEKOMEN-BEWIJS] The other side of the same question, asked of the MONEY.
 *
 * proveOpenInvoices asks, per invoice: is this thing I call open perhaps already paid?
 * This asks, per payment: which invoice is this — and if none, is it revenue with no invoice?
 *
 * The second half is the number the app never showed. Readiness counts unexplained receipts, and
 * a count cannot tell three payments of € 5 from three of € 5.000: the first is tidiness, the
 * second is unbilled turnover and an administratieplicht problem (art. 52 AWR).
 */
export interface IncomingPaymentProof {
  /** How many unattached received payments were examined. */
  checkedPayments: number
  /** How many open invoices they were held against — the scope, again. */
  checkedInvoices: number
  /** Payments that DO look like a known invoice. Money already in, still being chased. */
  matched: IncomingPaymentHit[]
  /** Payments that look like nothing on the books. */
  unexplained: {
    count: number
    /** Their sum. This is the figure a count cannot carry. */
    total: number
    /** The most recent of them, so the owner knows whether this is old or happening now. */
    newest: string | null
  }
}
