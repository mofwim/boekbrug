// src/lib/auto-advance.ts
// [AUTO-ADVANCE] "Snap and throw" for real: a CONFIDENT, clean invoice moves itself from the
// verify queue (status 'processing') to 'received' — booked, unpaid, shared with the accountant —
// WITHOUT a manual tap. Only the ambiguous ones wait for the human. This is the single decision
// that turns the post-upload flow from ~70% automatic to hands-off.
//
// The safety contract (why this is safe to auto-book):
//   - 'received' is UNPAID — no money moves, no payment_method, no cash/bank write. It only
//     enters the accrual picture (accrual = invoice date), and it is FULLY REVERSIBLE
//     (received → processing, or → archived) and AUDITED.
//   - We NEVER auto-PAY. The pen-mark/"probably paid" signal stays a suggestion; a human always
//     confirms Bank/Contant. Money movement is never automatic.
//   - We advance ONLY when the SAME classifier the UI badge uses says 'clean' (arithmetic OK,
//     total present + non-zero, real date, real non-placeholder number, vendor/amount/date
//     confident, not a reminder) AND the case is an ORDINARY invoice — never a statement, a
//     reminder, or a credit note (those always need human eyes).
//   - For auto-BOOKING (no human in the loop) we raise the per-field confidence floor ABOVE the
//     0.7 review line to HIGH_CONF, so a merely-"not-flagged" read is not enough.
//
// The double-check is preserved but becomes OPT-IN, not mandatory-per-invoice: every auto-
// advanced invoice is tagged _auto_verified so the owner can review "wat is automatisch verwerkt"
// and undo any one. Pure + testable (run: npx tsx src/lib/auto-advance.test.ts).

import { classifyImportHealth, type HealthInput } from "./import-health";

// Auto-booking bar — stricter than import-health's 0.7 review line. A present per-field score
// below this keeps the invoice in the queue for a human, even if it isn't otherwise "flagged".
export const HIGH_CONF = 0.8;
// Overall AI confidence floor. FAIL-CLOSED: auto-booking REQUIRES a confidence that clears this;
// a null/absent overall confidence is never enough (it would book on presence checks alone).
const MIN_OVERALL = 0.7;
// When the model gave NO amount-specific confidence, we lean on the overall score — but demand a
// much higher one, because the money field is the one that must never be wrong.
const VERY_HIGH_OVERALL = 0.9;

export interface AutoAdvanceSignals {
  is_invoice?: boolean | null;
  is_statement?: boolean | null;
  is_reminder?: boolean | null;
  is_credit_note?: boolean | null;
  document_kind?: string | null;
  invoice_type?: string | null;
  confidence?: number | null; // overall AI confidence
  // [AUTO-ADVANCE] The RAW stored gross (total_inc_btw) — NOT the amount-fallback. Auto-booking
  // requires a real, finite, non-zero gross; an invoice priced only via a fallback 'amount' (so
  // the dedup gate that keys on total_inc_btw never ran) must stay in the queue.
  totalIncBtw?: number | null;
  // [AUTO-ADVANCE] The owner overrode a duplicate warning ("toch toevoegen"). Adding-anyway is
  // consent to ADD, never to skip verification — such a row must never auto-book.
  forcedDuplicate?: boolean;
  // [BTW-GATE] The read BTW rate (0 | 9 | 21 | null). Auto-booking a materially-priced invoice whose
  // btw_amount is 0 silently zeroes the voorbelasting; we only allow a zero BTW to auto-book when the
  // read EXPLICITLY says 0% (a genuine vrijgesteld / 0-rate invoice), never on a null/absent rate.
  btwRate?: number | null;
  // [GEGROND] What the DOCUMENT'S OWN TEXT says about the total the reader reported: was that exact
  // number found in it, is it demonstrably not in it, or was there no text to search (a photo).
  // Every other signal in this interface is the reader's opinion of the reader; this is the only
  // one from outside it. Optional — absent means the check did not run, which is treated exactly
  // like 'unreadable' and blocks nothing.
  totalGrounding?: "found" | "absent" | "unreadable" | null;
  // [DOCCHECK] WHERE that total sits on the document: labelled as the total ('anchored'), the
  // largest amount on the page ('largest'), or merely printed somewhere ('present') — which is the
  // subtotal-read-as-total shape. Optional; absent means the check did not run and blocks nothing.
  totalPlacement?: "anchored" | "largest" | "present" | "absent" | "unreadable" | null;
  health: HealthInput; // the same input classifyImportHealth reads
}

export interface AutoAdvanceDecision {
  advance: boolean;
  reason: string; // machine tag for audit/telemetry
}

/**
 * Decide whether a freshly-extracted incoming invoice may skip the manual verify tap. Conservative
 * by construction and FAIL-CLOSED: any doubt, any missing signal → false (stays in the queue for
 * the human). Auto-booking sends a number into the P&L / BTW / accountant package with no human
 * in the loop, so the bar is deliberately high. Pure.
 */
export function shouldAutoAdvanceInvoice(s: AutoAdvanceSignals): AutoAdvanceDecision {
  // A duplicate the owner forced past the warning is never auto-booked.
  if (s.forcedDuplicate === true) return { advance: false, reason: "forced_duplicate" };

  // Ordinary invoice only — a statement/reminder/creditnota always needs human eyes.
  if (s.is_invoice === false) return { advance: false, reason: "not_invoice" };
  if (s.is_statement === true) return { advance: false, reason: "statement" };
  if (s.is_reminder === true) return { advance: false, reason: "reminder" };
  if (s.is_credit_note === true || s.invoice_type === "creditnota") return { advance: false, reason: "creditnota" };
  const kind = (s.document_kind ?? "").toLowerCase();
  if (kind === "statement" || kind === "reminder" || kind === "credit_note" || kind === "creditnota") {
    return { advance: false, reason: `kind_${kind}` };
  }

  // A REAL gross must exist — never auto-book a total derived only from the 'amount' fallback
  // (that path bypasses the total_inc_btw-keyed dedup gate).
  if (!(typeof s.totalIncBtw === "number" && Number.isFinite(s.totalIncBtw) && Math.abs(s.totalIncBtw) >= 0.005)) {
    return { advance: false, reason: "no_reliable_total" };
  }

  // [BTW-GATE] Never auto-book a materially-priced invoice with ZERO btw unless it is EXPLICITLY a
  // 0%-rate invoice. A 9%/21% invoice misread as ex==incl (btw 0) passes the arithmetic gate
  // (ex + 0 = incl) and the health "clean" check — and would auto-book with its voorbelasting
  // silently zeroed, the one number this app exists to protect, behind an "automatisch geverifieerd"
  // tag that reduces scrutiny. Fail-closed to human review; a genuine 0%/vrijgesteld invoice
  // (btwRate === 0) still auto-advances. Strictly stricter — this can only HOLD, never wrongly book.
  const btw = s.health?.btw_amount;
  if (typeof btw === "number" && Math.abs(btw) < 0.005 && s.btwRate !== 0) {
    return { advance: false, reason: "zero_btw_not_explicit_zero_rate" };
  }

  // [GEGROND] The reader reported a total that is NOT printed anywhere in the document's own text.
  // That is not low confidence and it is not bad arithmetic — the other gates cannot see it at all,
  // because they only ever compare the read against itself. It is a figure the paper does not
  // contain, and booking it without a human is how a wrong number becomes a cost, a voorbelasting
  // claim and a line in an aangifte.
  //
  // Only 'absent' holds. 'unreadable' is a photographed receipt — the ordinary case this app exists
  // for — and refusing to automate those would take the product away in the name of protecting it.
  // The check adds a way to be CERTAIN; it never adds a way to be stuck.
  if (s.totalGrounding === "absent") {
    return { advance: false, reason: "total_not_in_document_text" };
  }

  // [DOCCHECK] And the sharper form of the same question. 'present' means the figure IS printed on
  // the document but neither carries a total-label nor is the largest amount on the page — which is
  // exactly what a SUBTOTAL, a LINE ITEM and the BTW look like. Measured on a real layout, all three
  // of those wrong reads came back 'found' to the grounding check above and were booked.
  //
  // Only 'present' is added here; 'absent' is already held one line up, and 'unreadable' still holds
  // nothing.
  if (s.totalPlacement === "present") {
    return { advance: false, reason: "total_not_where_a_total_is_printed" };
  }

  // Overall confidence — FAIL-CLOSED: must be present AND clear the floor.
  if (!(typeof s.confidence === "number" && s.confidence >= MIN_OVERALL)) {
    return { advance: false, reason: "overall_confidence_missing_or_low" };
  }

  // Must be fully clean by the SAME classifier the queue badge uses (arithmetic, total present,
  // real date, real number, confident vendor/amount/date, not a reminder).
  const health = classifyImportHealth(s.health);
  if (health.level !== "clean") return { advance: false, reason: "needs_review" };

  const fc = s.health.field_confidence;
  // The MONEY field's own confidence is the one that must never be wrong. If the model reported
  // it, it must clear HIGH_CONF. If it did NOT report it, we don't skip the check — we demand a
  // VERY_HIGH overall confidence instead (fail-closed, never fail-open on a missing money score).
  //
  // [FIND-GAP] Take the MINIMUM across EVERY present money score, not the first present one. A
  // `.find` returned the first defined of [amount, total, total_inc_btw] — so a high `amount` score
  // masked a LOW `total_inc_btw` score (and total_inc_btw is the value that actually becomes the
  // booked gross). That auto-booked an invoice whose gross the model was NOT confident about. Any
  // present money score below the bar must block (fail-closed) — mirrors the Math.min over the other
  // per-field scores below.
  const moneyScores = fc
    ? [fc.amount, fc.total, fc.total_inc_btw].filter((n): n is number => typeof n === "number")
    : [];
  if (moneyScores.length > 0) {
    if (Math.min(...moneyScores) < HIGH_CONF) return { advance: false, reason: "amount_confidence_below_high_bar" };
  } else if (!(typeof s.confidence === "number" && s.confidence >= VERY_HIGH_OVERALL)) {
    return { advance: false, reason: "no_amount_confidence_and_overall_not_very_high" };
  }

  // Every OTHER present per-field score must also clear the HIGH bar.
  if (fc) {
    const scores = [fc.vendor, fc.invoice_number, fc.invoice_date].filter((n): n is number => typeof n === "number");
    if (scores.length > 0 && Math.min(...scores) < HIGH_CONF) {
      return { advance: false, reason: "field_confidence_below_high_bar" };
    }
  }

  return { advance: true, reason: "clean_high_confidence" };
}
