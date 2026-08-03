// src/lib/vat-exemption.ts
// [VRIJGESTELD] BTW-exempt turnover (art. 11 Wet OB) and the pro-rata right to deduct.
// Pure; no I/O. Run: npx tsx --test src/lib/vat-exemption.test.ts
//
// WHY THIS EXISTS
//
// Until now this app had exactly three BTW rates — {0, 9, 21} — and nothing else. That set
// cannot express EXEMPT, and the two are not the same thing at all:
//
//   0% (nultarief)   — you charge no BTW AND you keep the full right to deduct input BTW.
//   vrijgesteld      — you charge no BTW AND you lose the right to deduct it.
//
// So an exempt owner (a dentist, a teacher, an insurance broker, a care provider) who entered
// their turnover as "0%" got TWO wrong numbers at once, and neither was visible:
//
//   1. their exempt turnover landed in aangifte rubriek 1e ("belast met 0%") — a positive
//      figure on a form, in a box it does not belong in;
//   2. financial-result.ts reclaimed the input BTW on EVERY purchase invoice at 100%, because
//      nothing in the app knew the turnover it belongs to carries no deduction right.
//
// (2) is the expensive one. A practice with €132.000 exempt care turnover and €12.396 taxable
// turnover beside it may deduct roughly a tenth of its general input BTW; the app computed the
// whole amount. On one quarter of ordinary costs that is thousands of euros reclaimed that will
// be assessed back, with interest.
//
// factuur-handoff.ts:158 already names this trap from the other side ("een ontbrekend tarief dat
// als 0% doorgaat leest als vrijgesteld"), and closing-package.ts:700 + icp.ts:292 both note in
// passing that "bij KOR of vrijgestelde omzet vallen de twee niet tegen elkaar weg". The concept
// was understood in the comments. It was never in the data. This file puts it there.
//
// THE THREE RULES THIS ENCODES
//
//   A. Exempt turnover is REVENUE (profit is profit) but carries no BTW and belongs in NO
//      rubriek. It is surfaced as its own figure — the same treatment cashOmzetZonderBtw
//      already gets in aangifte.ts: named, never silently bucketed.
//   B. Input BTW is deductible per its ATTRIBUTION: wholly to taxed turnover (100%), wholly to
//      exempt turnover (0%), or to both (the pro-rata share). Dutch law wants direct
//      attribution first and the ratio only for what genuinely serves both.
//   C. When the ratio cannot be determined, NOTHING is deducted from the mixed bucket and the
//      amount is handed back as `unresolved`. Deducting it in full is what we are fixing;
//      guessing a ratio would be the same mistake wearing a different number.
//
// SHIPS DARK. Every owner is `vat_exempt_activity = false` until they declare otherwise, and on
// that path this module's output is byte-identical to the old arithmetic: one bucket, deducted
// at 100%. Nobody's filed quarter moves because this file exists.
//
// NOT TAX ADVICE, AND DELIBERATELY NOT CLEVER. This computes the ratio from the turnover the
// owner classified. It does not decide WHICH turnover is exempt (that is a legal judgement about
// the activity, not something a rate reveals), and it does not know about the alternative
// werkelijk-gebruik basis, a herzieningstermijn on capital goods, or a pre-pro-rata split per
// sector. Those stay with the accountant, and the notes say so.

// ─── The two classifications ──────────────────────────────────────────────────

/**
 * What a SALE is, for BTW. Stored per invoice line / turnover row / cash sale.
 *
 * `taxed` covers every rate including a genuine 0% — the deduction right survives, so as far
 * as this module is concerned they behave identically. Only `exempt` removes it.
 */
export type VatTreatment = "taxed" | "exempt";

/**
 * What a COST serves, for the right to deduct. Stored per incoming invoice.
 *
 *   direct_taxed  — bought wholly for taxed activity → deduct in full.
 *   direct_exempt — bought wholly for exempt activity → deduct nothing.
 *   mixed         — serves both (rent, energy, software, the accountant) → the pro-rata share.
 *
 * `mixed` is the DEFAULT for an unclassified cost, and that is a deliberate choice in the
 * owner's favour of being correct rather than generous: the legal default for algemene kosten
 * IS the ratio, and of the three possible errors, applying the ratio to a cost that was really
 * direct_taxed only under-claims (visible, correctable) — while the behaviour we are replacing
 * over-claims on every exempt cost in the book.
 */
export type VatDeduction = "direct_taxed" | "direct_exempt" | "mixed";

export function isVatTreatment(v: unknown): v is VatTreatment {
  return v === "taxed" || v === "exempt";
}

export function isVatDeduction(v: unknown): v is VatDeduction {
  return v === "direct_taxed" || v === "direct_exempt" || v === "mixed";
}

/** Normalize a raw DB value to a treatment. Anything unknown → `taxed`, the safe default:
 *  it keeps a row in the rubrieken it has always been in. NULL means "never classified",
 *  which for the 99% of owners with no exempt activity is exactly right. */
export function getVatTreatment(raw: unknown): VatTreatment {
  return raw === "exempt" ? "exempt" : "taxed";
}

/** Normalize a raw DB value to a cost attribution. Unknown/NULL → `mixed` — see the type. */
export function getVatDeduction(raw: unknown): VatDeduction {
  return isVatDeduction(raw) ? raw : "mixed";
}

// ─── The declaration, resolved per quarter ────────────────────────────────────

/**
 * Does the exempt regime apply to the quarter starting `quarterStart`?
 *
 * Deliberately the same shape as resolveSchemeForQuarter (vat-scheme.ts), and for the same
 * load-bearing reason: on a recompute-on-read truth layer a bare global boolean would rewrite
 * an ALREADY-FILED quarter the moment the owner flips it. A dentist who starts a taxable
 * whitening service on 1 July must not have Q1 and Q2 — filed, paid, closed — recomputed under
 * a regime that did not apply to them.
 *
 * `active=false` → false for every quarter, whatever `since` says (never declared, nothing to
 * protect). `since` absent → applies throughout (a fresh declaration with no history).
 * Dates are ISO 'YYYY-MM-DD'; a full timestamp is sliced to its date.
 */
export function resolveExemptionForQuarter(
  active: boolean,
  since: string | null | undefined,
  quarterStart: string,
): boolean {
  if (!active) return false;
  if (!since) return true;
  return quarterStart >= since.slice(0, 10);
}

// ─── The pro-rata ratio ───────────────────────────────────────────────────────

export interface ProRataInput {
  /** Turnover (ex-BTW) that carries a deduction right: every taxed rate, including genuine 0%. */
  taxedOmzet: number;
  /** Turnover (ex-BTW) that carries none: art. 11 exempt activity. */
  exemptOmzet: number;
}

export interface ProRata {
  /**
   * Deductible share as a WHOLE percent (0–100), or null when it cannot be determined.
   * Null is a real answer here and must not be read as zero — see `undecidable`.
   */
  percent: number | null;
  /** percent / 100, for arithmetic. Null exactly when `percent` is. */
  ratio: number | null;
  taxedOmzet: number;
  exemptOmzet: number;
  totalOmzet: number;
  /** TRUE when there is no turnover to compute a ratio from, or the total is negative. */
  undecidable: boolean;
  /** Dutch, UI-ready — why the ratio is null, or what is unusual about it. Empty when clean. */
  note: string;
}

/**
 * The deductible share of input BTW on costs serving BOTH activities: taxed turnover over
 * total turnover, ROUNDED UP to a whole percent.
 *
 * The rounding is up, not nearest — art. 11 Uitvoeringsbeschikking omzetbelasting 1968, the
 * omzetverhouding basis: the percentage is rounded UP to whole percents, in the taxpayer's favour.
 * The canonical example is 21,1% -> 22%, which is pinned as a test. It is also the only direction
 * that cannot quietly cost someone money.
 *
 * Checked against the rule rather than assumed, because it is the one line in this file where a
 * change by the legislator moves a number. Same article, lid 2: an owner whose ACTUAL use differs
 * demonstrably from the turnover ratio must use werkelijk gebruik instead — this app never makes
 * that judgement, and the aangifte note says so in as many words.
 *
 * Three guards, because each of them is a wrong number that would look completely normal:
 *
 *  · No turnover at all (a starting practice, a dead quarter) → null, NOT 0 and NOT 100. There
 *    is genuinely nothing to divide, and both constants are a claim we cannot support.
 *  · Negative total (a quarter dominated by creditnota's) → null. A ratio computed from it is
 *    arithmetic without meaning, and can land far outside 0–100.
 *  · A single negative side against a larger positive total → the raw share is clamped into
 *    0–100 rather than allowed to print a 130% deduction.
 */
export function computeProRata(input: ProRataInput): ProRata {
  const taxedOmzet = Number.isFinite(input.taxedOmzet) ? input.taxedOmzet : 0;
  const exemptOmzet = Number.isFinite(input.exemptOmzet) ? input.exemptOmzet : 0;
  const totalOmzet = taxedOmzet + exemptOmzet;

  const base = {
    taxedOmzet,
    exemptOmzet,
    totalOmzet,
  };

  if (totalOmzet === 0) {
    return {
      ...base,
      percent: null,
      ratio: null,
      undecidable: true,
      note:
        "Er is in dit tijdvak geen omzet, dus het pro-rata aftrekpercentage is niet te bepalen. " +
        "De BTW op kosten die zowel je belaste als je vrijgestelde werk dienen is daarom NIET " +
        "meegeteld in de voorbelasting — je boekhouder bepaalt het percentage.",
    };
  }

  if (totalOmzet < 0) {
    return {
      ...base,
      percent: null,
      ratio: null,
      undecidable: true,
      note:
        "De totale omzet in dit tijdvak is negatief (per saldo meer creditnota's dan omzet). " +
        "Daar is geen zinnig aftrekpercentage uit te rekenen; de BTW op gemengde kosten is NIET " +
        "meegeteld. Je boekhouder beoordeelt dit tijdvak apart.",
    };
  }

  const rawPercent = (taxedOmzet / totalOmzet) * 100;
  // Clamp BEFORE rounding: a negative taxed side (net credit on the taxable activity) gives a
  // negative share, and a negative exempt side gives one above 100. Neither is a deduction
  // right; both are clamped to the nearest end of the legal range and named in the note.
  const clamped = Math.min(100, Math.max(0, rawPercent));
  const ceiled = Math.ceil(clamped - 1e-9); // up to a whole percent; epsilon absorbs FP dust
  // Math.ceil(0 - 1e-9) is NEGATIVE zero, which is not a curiosity here: it survives into
  // `ratio`, compares unequal to 0 under Object.is, and a Dutch number formatter prints it
  // as "-0%" on the screen of an owner who deducts nothing. Normalized to a plain zero.
  const percent = Object.is(ceiled, -0) ? 0 : ceiled;
  const outOfRange = rawPercent < 0 || rawPercent > 100;

  return {
    ...base,
    percent,
    ratio: percent / 100,
    undecidable: false,
    note: outOfRange
      ? "Let op: een van de twee omzetsoorten is per saldo negatief (creditnota's), waardoor het " +
        `berekende aandeel buiten 0–100% viel. Het is begrensd op ${percent}%; laat je boekhouder ` +
        "dit tijdvak nakijken."
      : "",
  };
}

// ─── Applying it to the input BTW ─────────────────────────────────────────────

export interface VoorbelastingBuckets {
  /** Input BTW on costs attributed wholly to TAXED activity — deductible in full. */
  direct: number;
  /** Input BTW on costs serving BOTH — deductible for the pro-rata share only. */
  mixed: number;
  /**
   * Input BTW on costs attributed wholly to EXEMPT activity. Carried for transparency only:
   * it is never deducted, and a screen that shows the owner what they gave up needs the figure.
   */
  blocked: number;
}

export interface DeductionResult {
  /** The voorbelasting actually claimable — what rubriek 5b should carry. */
  amount: number;
  /** Of `mixed`, the part left out because the ratio was undecidable. > 0 ⇒ 5b is understated. */
  unresolved: number;
  /** The share applied to `mixed`, or null when it was undecidable. */
  percent: number | null;
}

/**
 * Deductible input BTW from the three buckets and a ratio.
 *
 * The neutral path matters as much as the exempt one: a NON-exempt owner puts everything in
 * `direct` and gets `direct` back, unrounded and untouched — that is the guarantee that adding
 * this file changes no existing owner's 5b by a single cent.
 *
 * When the ratio is undecidable the mixed bucket contributes NOTHING and is reported in
 * `unresolved`. That understates 5b on purpose, and visibly: an understated deduction the notes
 * point at is a correction, while the overstated one it replaces is an assessment with interest.
 */
export function deductibleVoorbelasting(
  buckets: VoorbelastingBuckets,
  proRata: ProRata,
): DeductionResult {
  const direct = Number.isFinite(buckets.direct) ? buckets.direct : 0;
  const mixed = Number.isFinite(buckets.mixed) ? buckets.mixed : 0;

  if (proRata.ratio == null) {
    return { amount: direct, unresolved: mixed, percent: null };
  }
  return {
    amount: direct + mixed * proRata.ratio,
    unresolved: 0,
    percent: proRata.percent,
  };
}

// ─── Splitting one invoice into its exempt and taxed halves ───────────────────

/**
 * The exempt part of an invoice's ex-BTW total, bounded by that total.
 *
 * The caller sums it from the invoice's own lines, and the two can legitimately disagree: lines
 * are edited, an invoice imported from a scan has no lines at all, and a line total need not
 * add up to a header written by hand. An unbounded exempt part is the dangerous direction — it
 * would withhold MORE from the rubrieken than the invoice contains and pull rubriek 1a negative
 * on an owner who is not owed anything.
 *
 * So the portion is clamped into the invoice's own range, which for a creditnota is negative:
 * ex ≥ 0 → [0, ex]; ex < 0 → [ex, 0]. A mixed sign is not a smaller exempt part, it is a
 * disagreement about direction, and it clamps to zero — the invoice then behaves exactly as it
 * did before this feature existed.
 *
 * The complement is computed by the CALLER as `ex − exempt`, never as a second rounded figure,
 * so the two halves re-sum to the header to the cent no matter what the lines said.
 */
export function clampExemptPortion(exemptEx: number, headerEx: number): number {
  if (!Number.isFinite(exemptEx) || !Number.isFinite(headerEx)) return 0;
  if (headerEx >= 0) return Math.min(Math.max(exemptEx, 0), headerEx);
  return Math.max(Math.min(exemptEx, 0), headerEx);
}

/**
 * Turn absolute exempt amounts into FRACTIONS of each invoice's ex-BTW total.
 *
 * The cash-basis branch of the result engine books settlements, and a settlement knows only which
 * invoice it belongs to — not that invoice's columns. A fraction survives that: whatever part of
 * the invoice a payment settles carries the same proportion of exempt turnover.
 *
 * An invoice with a zero ex-BTW total is skipped rather than divided by; the share is clamped to
 * 0–1 so a lines-vs-header disagreement can never make a slice more than wholly exempt.
 */
export function exemptShareOf(
  invoices: readonly { id?: string | null; total_ex_btw?: number | null }[],
  exemptExByInvoice: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.id) continue;
    const exemptEx = exemptExByInvoice.get(inv.id);
    if (exemptEx == null || exemptEx === 0) continue;
    const ex = inv.total_ex_btw ?? 0;
    if (ex === 0 || !Number.isFinite(ex)) continue;
    const share = clampExemptPortion(exemptEx, ex) / ex; // same sign top and bottom ⇒ 0–1
    if (share > 0) out.set(inv.id, Math.min(1, share));
  }
  return out;
}

// ─── Contradiction guard ──────────────────────────────────────────────────────

/**
 * An exempt sale carrying BTW is a contradiction: exempt means no BTW was charged. It happens
 * for real — a line classified exempt after the invoice was written with 21% on it — and the
 * dangerous handling is to trust the label and drop the BTW, because that BTW was invoiced to a
 * customer and is owed to the Belastingdienst under art. 37 Wet OB whether it should have been
 * charged or not.
 *
 * So the label loses: a row that says "exempt" but carries BTW is treated as TAXED and named,
 * exactly like aangifte.ts refuses to zero a rate-0 bucket that carries BTW into 1e.
 *
 * `tolerance` absorbs rounding dust on a per-line split, not a real amount.
 */
export function resolveSaleTreatment(
  treatment: VatTreatment,
  btw: number,
  tolerance = 0.005,
): { treatment: VatTreatment; contradicted: boolean } {
  if (treatment === "exempt" && Math.abs(btw) > tolerance) {
    return { treatment: "taxed", contradicted: true };
  }
  return { treatment, contradicted: false };
}
