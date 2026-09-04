// src/lib/verlegde-btw.ts
// [VERLEGD-NAAR-MIJ] Rubriek 2a: BTW that a supplier shifted to YOU. Pure, no I/O.
// Run: npx tsx --test src/lib/verlegde-btw.test.ts
//
// ── WHY THIS HAD TO BE BUILT ──
//
// This app has a front door at /voor-bouw. Construction and subcontracting is precisely the trade
// that lives under the verleggingsregeling — and behind that door there was no rubriek 2a at all.
// Not a computation, not even a note. aangifte.ts documents 1d, 3a/3c and 4b as deliberately not
// computed, which is honest; 2a was simply absent, so an owner who falls under it got silence.
//
// ── WHAT THE RULE IS ──
//
// A subcontractor invoices the main contractor WITHOUT BTW and prints "btw verlegd" (art. 12 lid 5
// Wet OB; art. 24b Uitvoeringsbesluit OB 1968). The recipient then does two things in the same
// aangifte:
//
//   · declares that BTW as OWED, in rubriek 2a;
//   · deducts the same amount as voorbelasting, in rubriek 5b.
//
// When the recipient may deduct in full, the two cancel and nothing is paid. That is exactly why
// leaving both out looks harmless and is not: the return is then wrong on two lines, the aangifte
// does not reconcile against the supplier's own filing, and the Belastingdienst cross-checks these.
// An owner who is partly exempt is worse off still — for them the two do NOT cancel, and omitting
// 2a means declaring too little BTW.
//
// ── THE HARD PART: THE RATE IS NOT ON THE DOCUMENT ──
//
// A reverse-charged invoice carries no BTW, so it carries no rate either. The rate follows from
// what was supplied, and that is a judgement about the work — not something to read off paper.
//
// So this module NEVER infers a rate from the document. It reports what it found and offers the
// standard rate for the trade the regulation covers (construction and staff hire are 21 %), and the
// owner confirms. The same rule as everywhere else here: the machine may point, the human books.
// Guessing wrong is expensive in both directions — too little declared in 2a is an assessment, too
// much is money paid that was never owed.
//
// ── AND WHY THIS IS DARK UNTIL A REAL INVOICE ARRIVES ──
//
// There is not one reverse-charged purchase in the administration this was built against, and that
// is stated rather than hidden. It follows the [MOLLIE] pattern: built, tested, and inert until the
// first document that needs it. The alternative — waiting until a bouw client arrives and then
// discovering the aangifte has no 2a — is how a filing goes out wrong once and is never trusted again.

// [CENT] round2 komt uit invoice-totals — één centafronding voor de hele app. Juist hier telt dat:
// het 2a-bedrag en het 5b-bedrag moeten HETZELFDE getal zijn, en twee afrondingen die net iets
// anders doen is precies hoe twee bedragen die tegen elkaar weg horen te vallen dat niet meer doen.
import { round2 } from "./invoice-totals";

/** The rate the reverse-charge regulation actually carries in the trades it covers. */
export const VERLEGD_DEFAULT_RATE = 21;

/**
 * Markers a Dutch supplier prints when shifting the BTW.
 *
 * Anchored on the phrases the Belastingdienst's own guidance names, plus the two article
 * references that appear on real subcontractor invoices. Kept deliberately narrow: this must not
 * fire on an invoice that merely mentions the word "verlegging" in a delivery note.
 */
const VERLEGD_MARKERS: readonly RegExp[] = [
  /\bbtw[\s-]*verlegd\b/i,
  /\bverleggingsregeling\b/i,
  /\bbtw\s+verlegd\s+naar\b/i,
  /\bomzetbelasting\s+verlegd\b/i,
  /\bverlegd\s+naar\s+(?:de\s+)?(?:aannemer|afnemer|ontvanger|opdrachtgever)\b/i,
  /\bartikel\s*24b\b/i,
  /\bart\.?\s*12\s*lid\s*5\b/i,
  /\breverse[\s-]*charge\b/i,
];

/** What was found on an incoming invoice, and what it means for the aangifte. */
export interface VerlegdeVondst {
  /** The phrase that was recognised, so the screen can quote the document rather than assert. */
  marker: string;
  /** The ex-BTW amount the shifted VAT is computed over. */
  grondslag: number;
  /** The rate this PROPOSES. Never read from the document — the document has none. */
  voorgesteldTarief: number;
  /** What would land in 2a, and identically in 5b when fully deductible. */
  bedrag: number;
}

/**
 * Does this incoming invoice shift the BTW to the owner?
 *
 * Answers null unless the document says so AND carries no BTW of its own. Both conditions:
 * an invoice that states a marker and still charges 21 % is a contradiction the owner must look
 * at, not something to reinterpret — and reading the marker alone would turn any invoice quoting
 * the regulation in its terms and conditions into a 2a entry.
 */
export function verlegdeBtwOpInkoop(input: {
  text: string | null | undefined;
  totalExBtw: number | null | undefined;
  btwAmount: number | null | undefined;
  /** The rate to use when the owner has already answered. Falls back to the trade's standard. */
  bevestigdTarief?: number | null;
}): VerlegdeVondst | null {
  const tekst = input.text ?? "";
  if (!tekst) return null;

  const btw = typeof input.btwAmount === "number" && Number.isFinite(input.btwAmount) ? input.btwAmount : 0;
  // Carrying BTW means the supplier did NOT shift it, whatever the small print says.
  if (Math.abs(btw) >= 0.005) return null;

  const ex = typeof input.totalExBtw === "number" && Number.isFinite(input.totalExBtw) ? input.totalExBtw : 0;
  if (!(Math.abs(ex) > 0)) return null;

  const treffer = VERLEGD_MARKERS.map((re) => re.exec(tekst)?.[0]).find((m): m is string => !!m);
  if (!treffer) return null;

  const tarief = typeof input.bevestigdTarief === "number" && Number.isFinite(input.bevestigdTarief)
    ? input.bevestigdTarief
    : VERLEGD_DEFAULT_RATE;

  return {
    marker: treffer,
    grondslag: ex,
    voorgesteldTarief: tarief,
    // Rounded to the cent here so 2a and its matching 5b are the SAME number. Rounding them
    // separately downstream is how two figures that must cancel stop cancelling.
    bedrag: round2(Math.abs(ex) * (tarief / 100)) * Math.sign(ex || 1),
  };
}

/** The totals rubriek 2a needs, folded from the invoices found above. */
export interface VerlegdTotaal {
  /** Ex-BTW turnover the shift was applied to — the omzet column of rubriek 2a. */
  grondslag: number;
  /** The BTW owed in 2a. Identical to what may be deducted in 5b when deduction is full. */
  btw: number;
  /** How many invoices it rests on, so a note can say so instead of stating a bare figure. */
  aantal: number;
}

/** Fold the found invoices into one 2a line. Returns null when there is nothing to declare. */
export function totaalVerlegd(vondsten: readonly VerlegdeVondst[]): VerlegdTotaal | null {
  if (vondsten.length === 0) return null;
  let grondslag = 0;
  let btw = 0;
  for (const v of vondsten) {
    grondslag += v.grondslag;
    btw += v.bedrag;
  }
  return {
    grondslag: round2(grondslag),
    btw: round2(btw),
    aantal: vondsten.length,
  };
}
