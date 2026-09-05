// src/lib/autonomy-scope.ts
// [MANDAAT-SOORT] Per-category autonomy: WHICH reads may book themselves, not just whether any may.
// Pure — no I/O, no clock. Run: npx tsx src/lib/autonomy-scope.test.ts
//
// ── WHY ONE BOOLEAN IS NOT ENOUGH ────────────────────────────────────────────────────────────
//
// auto-boeken.ts asks one question: may the app book a read without the owner's tap? It is a good
// switch and its fail matrix is argued. But it is all-or-nothing, and the two answers an office
// actually wants are both in between:
//
//   "Book the weekly wholesaler I have thirty invoices from. Never book a supplier I have never
//    seen, never book one whose IBAN changed, and never book anything over € 2.500 —
//    ask me for those."
//
// An owner who can only choose between "check everything myself" and "let it run" chooses the
// first, and then the autopilot is worth nothing. This is the missing middle.
//
// ── WHY THIS FILE CAN ONLY EVER REFUSE ───────────────────────────────────────────────────────
//
// It narrows; it never widens. `decide` returns "no opinion" when the owner has stated no scope,
// and the caller then keeps exactly the decision it makes today. So adding this module to a call
// site cannot cause a single document to be booked that would not have been booked before — the
// worst it can do is hold one back. That asymmetry is deliberate and it is the same one
// auto-boeken.ts states: wrongly waiting costs the owner a tap on a clean invoice; wrongly booking
// overrides a choice they made about their own money.
//
// A test asserts the property directly, over every combination of scope and facts.
//
// ── AND WHY THE SCOPE IS AN ALLOWLIST ────────────────────────────────────────────────────────
//
// The tempting shape is "book everything EXCEPT these". That is how a new risk class gets booked
// automatically: someone adds a kind of document, nobody adds it to the exception list, and the
// silence reads as permission. Every field here is a positive grant, so a fact nobody has thought
// about yet is refused by construction — and the refusal says so instead of happening quietly.

/** What the owner has granted. Absent fields grant nothing. */
export interface AutonomyScope {
  /**
   * Book a supplier the administration already holds at least this many CONFIRMED invoices from.
   * 0 or absent → a known supplier is no reason on its own.
   *
   * The count is the point: "known" cannot mean "seen once", because the first invoice from a
   * fraudulent look-alike is also the first invoice from a real new supplier.
   */
  knownSupplierMinInvoices?: number;
  /**
   * The most one document may be worth and still book itself, in euros incl. BTW.
   * Absent → no amount is granted, so nothing books itself on this rule alone.
   */
  maxAmount?: number;
}

/** What the app knows about the one document in front of it. */
export interface DocumentFacts {
  /** Confirmed invoices already held from this supplier. 0 for one nobody has seen before. */
  supplierInvoiceCount: number;
  /** Total incl. BTW, as read. Negative or absent is treated as unknown — see decide(). */
  amountIncBtw: number | null;
  /** True when this document tripped ANY health flag — see import-health.ts. */
  needsReview: boolean;
  /** True when the supplier's IBAN differs from the one the administration holds. */
  ibanChanged: boolean;
}

export type AutonomyVerdict =
  /** The owner stated a scope and this document is inside it. */
  | { decision: "allow"; reason: null }
  /** The owner stated a scope and this document falls outside it. `reason` says which rule. */
  | { decision: "hold"; reason: string }
  /**
   * No scope stated. This module has NOTHING to say, and the caller must keep the decision it
   * makes today. This is not "allow" — a surface that treats it as one has widened the autopilot,
   * which is the one thing this file may never do.
   */
  | { decision: "no-opinion"; reason: null };

/** No scope at all — the value every caller starts from. */
export const NO_SCOPE: AutonomyScope = {};

/** Has the owner granted anything? An empty object is not a scope, it is the absence of one. */
export function hasScope(scope: AutonomyScope | null | undefined): boolean {
  if (!scope) return false;
  return (
    (typeof scope.knownSupplierMinInvoices === "number" && scope.knownSupplierMinInvoices > 0) ||
    (typeof scope.maxAmount === "number" && scope.maxAmount > 0)
  );
}

/**
 * May this document book itself under the owner's stated scope?
 *
 * Order matters: the refusals that are about SAFETY are checked before the ones that are about
 * size, so an owner reading the reason is told the most serious thing first. A changed IBAN on a
 * € 40 invoice is a worse fact than a € 3.000 invoice from a supplier of ten years.
 */
export function decide(
  scope: AutonomyScope | null | undefined,
  facts: DocumentFacts,
): AutonomyVerdict {
  if (!hasScope(scope)) return { decision: "no-opinion", reason: null };
  const s = scope!;

  // ── The three refusals no grant can override ──
  //
  // These are not thresholds the owner tuned; they are the cases where the app itself does not
  // trust the read. Letting a scope override them would let "book my wholesaler automatically"
  // mean "book a document I have flagged as wrong", which is not what anyone granted.
  if (facts.ibanChanged) {
    return {
      decision: "hold",
      reason: "het rekeningnummer van deze leverancier is veranderd — dat controleer je zelf, altijd",
    };
  }
  if (facts.needsReview) {
    return {
      decision: "hold",
      reason: "er staat een waarschuwing op dit document — die hoort een mens te lezen",
    };
  }
  if (facts.amountIncBtw === null || !Number.isFinite(facts.amountIncBtw)) {
    return {
      decision: "hold",
      reason: "het bedrag is niet gelezen — zonder bedrag is er niets om een grens langs te leggen",
    };
  }

  // ── The grants ──
  const bedrag = Math.abs(facts.amountIncBtw);
  const grens = typeof s.maxAmount === "number" && s.maxAmount > 0 ? s.maxAmount : 0;
  if (grens > 0 && bedrag > grens) {
    return {
      decision: "hold",
      reason: `dit bedrag ligt boven de grens die je hebt ingesteld (${formatEuro(grens)})`,
    };
  }

  const nodig = typeof s.knownSupplierMinInvoices === "number" ? s.knownSupplierMinInvoices : 0;
  if (nodig > 0 && facts.supplierInvoiceCount < nodig) {
    return {
      decision: "hold",
      reason:
        facts.supplierInvoiceCount === 0
          ? "deze leverancier staat nog niet in je administratie — de eerste factuur bekijk je zelf"
          : `je hebt nog te weinig facturen van deze leverancier (${facts.supplierInvoiceCount}) om ze automatisch te boeken`,
    };
  }

  // Nothing granted applies? Then nothing was granted FOR this document, and silence is not
  // permission — see the header.
  if (grens === 0 && nodig === 0) {
    return { decision: "no-opinion", reason: null };
  }
  return { decision: "allow", reason: null };
}

/** € 2.500,00 — Dutch, for a sentence the owner reads. */
function formatEuro(n: number): string {
  return `€ ${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
