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
// Overall AI confidence floor (matches the 'accept' band; below this it wouldn't be enqueued as
// a normal invoice anyway).
const MIN_OVERALL = 0.7;

export interface AutoAdvanceSignals {
  is_invoice?: boolean | null;
  is_statement?: boolean | null;
  is_reminder?: boolean | null;
  is_credit_note?: boolean | null;
  document_kind?: string | null;
  invoice_type?: string | null;
  confidence?: number | null; // overall AI confidence
  health: HealthInput; // the same input classifyImportHealth reads
}

export interface AutoAdvanceDecision {
  advance: boolean;
  reason: string; // machine tag for audit/telemetry
}

/**
 * Decide whether a freshly-extracted incoming invoice may skip the manual verify tap. Conservative
 * by construction: any doubt → false (stays in the queue for the human). Pure.
 */
export function shouldAutoAdvanceInvoice(s: AutoAdvanceSignals): AutoAdvanceDecision {
  // Ordinary invoice only — a statement/reminder/creditnota always needs human eyes.
  if (s.is_invoice === false) return { advance: false, reason: "not_invoice" };
  if (s.is_statement === true) return { advance: false, reason: "statement" };
  if (s.is_reminder === true) return { advance: false, reason: "reminder" };
  if (s.is_credit_note === true || s.invoice_type === "creditnota") return { advance: false, reason: "creditnota" };
  const kind = (s.document_kind ?? "").toLowerCase();
  if (kind === "statement" || kind === "reminder" || kind === "credit_note" || kind === "creditnota") {
    return { advance: false, reason: `kind_${kind}` };
  }

  // Overall confidence floor.
  if (typeof s.confidence === "number" && s.confidence < MIN_OVERALL) {
    return { advance: false, reason: "low_overall_confidence" };
  }

  // Must be fully clean by the SAME classifier the queue badge uses (arithmetic, total present,
  // real date, real number, confident vendor/amount/date, not a reminder).
  const health = classifyImportHealth(s.health);
  if (health.level !== "clean") return { advance: false, reason: "needs_review" };

  // Extra caution for auto-booking: any PRESENT money-field score must clear the HIGH bar.
  const fc = s.health.field_confidence;
  if (fc) {
    const scores = [fc.vendor, fc.invoice_number, fc.invoice_date, fc.amount, fc.total, fc.total_inc_btw].filter(
      (n): n is number => typeof n === "number",
    );
    if (scores.length > 0 && Math.min(...scores) < HIGH_CONF) {
      return { advance: false, reason: "confidence_below_high_bar" };
    }
  }

  return { advance: true, reason: "clean_high_confidence" };
}
