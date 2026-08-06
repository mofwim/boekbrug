// src/lib/kas-auto-book.ts
// [KAS-AUTO-BOOK] May an amount-only bank match book itself when the owner is on the kasstelsel?
// Pure — no I/O, no clock. The caller supplies the scheme, the payment date and what it KNOWS
// about that quarter's aangifte.
//
// ── WHAT THIS REPLACES ──
// One line in bank-auto-confirm: `if (tier === "amount_only" && ownerScheme === "kas") continue`.
// Its reasoning is sound and stays intact — under the kasstelsel the payment date is VAT-timing
// truth, so a wrong same-amount pick moves a BTW figure — but its CONCLUSION is broader than its
// premise, and the gap between the two is where the owner's manual work lives.
//
// The blanket refusal costs a kasstelsel owner every single amount-only booking, forever. That is
// not a small tier: a manual SEPA overboeking prints the supplier's name and no invoice number, so
// "exact amount + strong supplier name + single clear winner" is the ordinary shape of a Dutch bank
// statement. Under factuurstelsel those book themselves; under kas they pile up as one-taps that
// nobody ever taps, and the pile is what makes the quarter feel like work.
//
// ── THE ACTUAL RISK, AND WHEN IT EXISTS ──
// The damage from a wrong amount-only pick is that an invoice is marked paid by money that paid
// something else, so its voorbelasting lands in a quarter it does not belong to. That is a real
// error. But it is an error INSIDE the administration until the moment the quarter is declared —
// and once declared it becomes an error at the Belastingdienst, correctable only by a suppletie.
//
// Those two are not the same risk, and the code should not price them the same way:
//
//   · quarter still OPEN   — the owner reviews before filing, the booking is stamped
//                            auto_match_reason='amount_only' so it shows as "controleer", readiness
//                            counts it as a risk on the quarter it lands in, and one tap unlinks
//                            it. The cost of being wrong is a tap.
//   · quarter already FILED — the correction leaves the app. Never automate into that.
//   · quarter UNKNOWN      — the btw_filings read failed. Not "open": that is the exact state in
//                            which acting destroys something. Refuse. [NO-SILENT-EMPTY]
//
// So the rule is not "never under kas", it is "never into a period that has been declared". That
// keeps every external consequence behind a human, and hands the owner back the automation that
// the blanket rule was taking as collateral.
//
// ── WHAT IS DELIBERATELY NOT CHANGED ──
// 'certain' (a printed invoice number, or the supplier's IBAN, plus the amount to the cent) books
// under either scheme exactly as before. Every OTHER guard in bank-auto-confirm still runs first —
// the hidden-competitor check, the confidence veto, the eligibility re-check. This decides one
// question and only after those have been asked.

import { resolveSchemeForQuarter, type VatScheme } from "./vat-scheme";
import { quarterKeyOf } from "./quarter";

/** What we know about one quarter's aangifte. Three states on purpose — see the header. */
export type QuarterFilingState = "open" | "filed" | "unknown";

export interface KasAutoBookInput {
  /** The tier the matcher reached. Only 'amount_only' is in question here. */
  tier: "certain" | "amount_only";
  /** The owner's current election, from profiles.vat_scheme. */
  profileScheme: VatScheme;
  /** profiles.vat_scheme_since — the election does not reach back over earlier quarters. */
  schemeSince: string | null | undefined;
  /**
   * The date the booking will WRITE: the bank line's date, never "today". Under kas this is the
   * date that decides the quarter, which is the whole reason this function exists.
   */
  paymentDate: string | null | undefined;
  /** What the caller found in btw_filings for the quarter that date falls in. */
  filingState: QuarterFilingState;
}

export type KasAutoBookRefusal =
  | "filed_quarter"   // declaring it made the mistake external — a human decides
  | "unknown_filing"  // the read failed; "not filed" is not something we may assume
  | "no_payment_date"; // no date → no quarter → nothing can be reasoned about

export type KasAutoBookVerdict =
  | { book: true }
  | { book: false; refusal: KasAutoBookRefusal };

/**
 * Decide whether this booking may proceed unattended.
 *
 * Note the order: the scheme is resolved FOR THE QUARTER THE PAYMENT LANDS IN, not globally. An
 * owner who elected kas from 1 July is on factuurstelsel for everything before it, and under
 * factuur the payment date is not VAT timing at all — so those quarters were never the concern and
 * blocking them was pure loss.
 */
export function decideKasAutoBook(input: KasAutoBookInput): KasAutoBookVerdict {
  // A printed number or the supplier's own account is document identity; it was never gated on the
  // scheme and is not gated here.
  if (input.tier === "certain") return { book: true };

  const key = quarterKeyOf(input.paymentDate);
  if (!key) {
    // An amount-only booking with no date cannot be placed in a period. Under factuur that is
    // survivable (the invoice date carries the timing); under kas it is the timing itself missing.
    // Refusing regardless keeps this function's answer independent of a lookup it cannot make.
    return input.profileScheme === "kas"
      ? { book: false, refusal: "no_payment_date" }
      : { book: true };
  }

  const quarterStart = quarterStartOf(key);
  const scheme = resolveSchemeForQuarter(input.profileScheme, input.schemeSince, quarterStart);
  if (scheme !== "kas") return { book: true }; // factuur: the pay date is not VAT timing

  if (input.filingState === "filed") return { book: false, refusal: "filed_quarter" };
  if (input.filingState === "unknown") return { book: false, refusal: "unknown_filing" };
  return { book: true };
}

/** "2026-Q3" → "2026-07-01". The form resolveSchemeForQuarter compares against. */
export function quarterStartOf(key: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return key;
  const month = (Number(m[2]) - 1) * 3 + 1;
  return `${m[1]}-${String(month).padStart(2, "0")}-01`;
}

/**
 * Fold a btw_filings read into the three-state answer for ONE quarter.
 *
 * `filedKeys` is what the read RETURNED; `readOk` is whether it returned at all. Splitting them is
 * the point: an empty set from a successful read means nothing is filed, and an empty set from a
 * failed read means we do not know — and those two must never collapse into the same value, which
 * is precisely what `const { data } = await …` does when it drops `error`.
 */
export function filingStateOf(
  quarterKey: string | null,
  filedKeys: ReadonlySet<string>,
  readOk: boolean,
): QuarterFilingState {
  if (!readOk) return "unknown";
  if (!quarterKey) return "unknown";
  return filedKeys.has(quarterKey) ? "filed" : "open";
}

/** "2026-Q2" from a btw_filings row. Kept here so the caller never hand-builds the key. */
export function filingKey(year: number, quarter: number): string {
  return `${year}-Q${quarter}`;
}
