// src/lib/api-warnings.ts
// [WAARSCHUWING-GEHOORD] Every `warning` an API route can return, and who is supposed to hear it.
// Run: npx tsx --test src/lib/api-warnings.test.ts
//
// A route that answers 200 with a `warning` has done something PARTLY. It is the honest thing for
// it to do — the alternative is a 500 over work that mostly succeeded, or silence. But a warning is
// only honest if somebody is listening, and two of the six in this app had no listener at all:
//
//   · `discount_not_stored` — the draft was written without its discount columns, so the invoice
//     stands at the FULL price. The route says so in its own comment ("Gezegd, niet verzwegen. De
//     factuur staat er dan voor de volle prijs") and no screen read it. The owner gives a customer
//     ten percent off and the customer is billed the full amount, with nothing on screen.
//   · `storage_orphan` — a file left behind in storage after its row was deleted. Nothing an owner
//     can act on, and it belongs in the logs. That is a fine answer; it just has to be a DECISION.
//
// So the registry carries both facts, and a gate reads the `warning:` literals out of
// src/app/api/ and fails when one is missing here. A seventh warning cannot be added without
// someone answering "does this mean the customer got nothing?" and "who tells the owner?".

/** The ways a send can be legally complete and practically not delivered. */
export type DeliveryFailure = "pdf_failed" | "email_failed";

export interface WarningMeaning {
  /**
   * What this warning says about DELIVERY — whether a document the owner believes went out did
   * not. Null means the warning is about something else entirely.
   */
  delivery: DeliveryFailure | null;
  /**
   * "screen": an owner must be told, so at least one component reads it. The gate checks that.
   * "log": nothing an owner can act on. `why` then has to say why not.
   */
  gehoordDoor: "screen" | "log";
  why: string;
}

export const API_WARNINGS: Record<string, WarningMeaning> = {
  // ── /api/invoice/send ────────────────────────────────────────────────────────────────────────
  pdf_failed: {
    delivery: "pdf_failed",
    gehoordDoor: "screen",
    why: "The number is in the legal sequence and the document was never built. Only a resend fixes it.",
  },
  email_failed: {
    delivery: "email_failed",
    gehoordDoor: "screen",
    why: "Numbered, rendered, and never handed to the customer. An owner who is not told does not chase the payment.",
  },
  // ── /api/invoice/[id] (PUT) ──────────────────────────────────────────────────────────────────
  corrected_delivery_failed: {
    delivery: "email_failed",
    gehoordDoor: "screen",
    why: "The correction stands but the customer still holds the OLD version — the one thing they must not be left believing.",
  },
  // ── /api/invoice/draft ───────────────────────────────────────────────────────────────────────
  discount_not_stored: {
    delivery: null, // nothing was sent yet; this is about the AMOUNT, not the delivery
    gehoordDoor: "screen",
    why: "The draft holds no discount, so the invoice stands at the full price. The customer is billed more than was agreed.",
  },
  // ── /api/bank/confirm ────────────────────────────────────────────────────────────────────────
  payment_link_not_recorded: {
    delivery: null,
    gehoordDoor: "screen",
    why: "The payment was booked but not linked to its invoice, so the invoice still reads as open.",
  },
  // ── /api/bank/delete-statement ───────────────────────────────────────────────────────────────
  storage_orphan: {
    delivery: null,
    gehoordDoor: "log",
    why: "A file left behind in storage after its row was deleted. No money moved, no figure changed, and there is no action an owner could take — it is work for whoever cleans the bucket.",
  },
};
