// src/lib/package-attribution.ts
// [PAKKET-TOEREKENING] The two rules that decide which invoices reach an accountant, and on which
// side of the books they land. Pure, tiny, and in their own module for one structural reason.
//
// They were written inside closing-package.ts, which is where they are used most. Then the
// auditfile's reads moved into xaf-fetch.ts ([XAF-BRON]) so that the quarterly package and the
// /api/xaf download could not drift apart — and xaf-fetch needs exactly these two rules, while
// closing-package needs xaf-fetch. That is a cycle, and a cycle between two modules that both run
// at import time is the kind of thing that works until a bundler orders them differently.
//
// So the rules move to where neither side owns them. closing-package.ts re-exports them, because
// twenty callers already import them from there and moving an import is not a change worth making
// a diff about.

// Verified status sets (Phase A confirmed against the enum). 'processing'
// excluded — unverified must not reach the accountant.
const OUTGOING_VERIFIED = new Set(["sent", "paid", "overdue"]);
const INCOMING_VERIFIED = new Set(["received", "paid"]);

export function isVerifiedForPackage(inv: { direction: string; status: string | null }): boolean {
  const s = inv.status ?? "";
  if (inv.direction === "outgoing") return OUTGOING_VERIFIED.has(s);
  if (inv.direction === "incoming") return INCOMING_VERIFIED.has(s);
  return false;
}

/**
 * [FIN-4] Effective direction: the stored value, or — when it is null — inferred
 * from ownership (the owner is the receiver of an incoming invoice, the sender of
 * an outgoing one). Ensures a verified row with a null direction is attributed to
 * a bucket instead of being silently dropped from the package.
 */
export function effectiveDirection(
  inv: { direction: string | null; receiver_id: string | null },
  ownerId: string
): "incoming" | "outgoing" {
  if (inv.direction === "incoming" || inv.direction === "outgoing") return inv.direction;
  return inv.receiver_id === ownerId ? "incoming" : "outgoing";
}
