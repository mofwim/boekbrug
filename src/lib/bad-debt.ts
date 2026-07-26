// src/lib/bad-debt.ts
// [BAD-DEBT] Oninbare vordering — reclaim the BTW you paid on a sales invoice the customer never
// paid. Pure detector; no I/O. Run: npx tsx src/lib/bad-debt.test.ts
//
// Dutch rule (Art. 29 Wet OB, sinds 2017): a receivable is presumed uncollectible ONE YEAR after
// its payment due date if still unpaid. The BTW you earlier declared + paid on that invoice may
// then be reclaimed (a reduction of de verschuldigde BTW). This module DETECTS eligible invoices
// and totals the reclaimable BTW — it never books it: whether a debt is truly uncollectible, and
// in which period to reclaim, is the owner's/accountant's call (and if the customer later pays,
// the BTW must be re-declared). So this is an honest FLAG, never an automatic figure.
//
// Applies ONLY to factuurstelsel: under kasstelsel BTW is due on payment, so an unpaid invoice
// never had its BTW declared — there is nothing to reclaim.

import type { VatScheme } from "./vat-scheme";

export interface BadDebtInput {
  id: string | null;            // row id — to spot an original that has since been credited
  invoiceNumber: string | null;
  clientName: string | null;
  direction: "incoming" | "outgoing" | null;
  status: string | null;
  invoiceType: string | null;   // 'creditnota' rows are reversals, never a receivable
  originalInvoiceId: string | null; // on a creditnota: the invoice it reverses
  invoiceDate: string | null;   // ISO
  dueDate: string | null;       // ISO
  totalExBtw: number | null;
  btwAmount: number | null;
  totalIncBtw: number | null;
  amountPaid: number | null;    // magnitude already settled
}

export interface BadDebtInvoice {
  invoiceNumber: string | null;
  clientName: string | null;
  dueDate: string;              // the (effective) due date that started the 1-year clock
  unpaidEx: number;             // ex-BTW of the still-unpaid portion
  reclaimableBtw: number;       // BTW on the unpaid portion — the amount you can reclaim
}

export interface BadDebtResult {
  eligible: BadDebtInvoice[];
  totalReclaimableBtw: number;  // Σ reclaimableBtw (unrounded)
  usedInvoiceDateFallback: boolean; // true if any invoice had no due_date (clock ran from invoice date)
}

// A verified outgoing sale whose BTW WAS declared (not a draft/processing/paid row).
const DECLARED_OUTGOING = new Set(["sent", "overdue"]);

/** ISO 'YYYY-MM-DD' + 1 calendar year (Feb 29 → Mar 1, acceptable). Returns "" on bad input. */
export function oneYearLater(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  const dt = new Date(Date.UTC(Number(m[1]) + 1, Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
}

/**
 * Detect sales invoices whose BTW is reclaimable as a bad debt as of `asOf` (ISO date — a period
 * end or today). Pure. Under kasstelsel returns nothing. An invoice qualifies when it is an
 * outgoing sale that was declared (status sent/overdue), is not fully paid, and its due date (or,
 * if absent, its invoice date) is more than one year before `asOf`. The reclaimable amount is the
 * BTW on the UNPAID portion only (a partly-paid invoice reclaims only the remainder's BTW).
 */
export function detectBadDebt(args: {
  scheme: VatScheme;
  asOf: string;
  invoices: BadDebtInput[];
}): BadDebtResult {
  if (args.scheme === "kas") {
    return { eligible: [], totalReclaimableBtw: 0, usedInvoiceDateFallback: false };
  }
  const asOf = args.asOf.slice(0, 10);
  const eligible: BadDebtInvoice[] = [];
  let usedInvoiceDateFallback = false;

  // A creditnota fully reverses its original: the BTW you'd otherwise reclaim was already put back.
  // So an original that has since been credited is NOT a bad debt (reclaiming it = a refund you're
  // not owed), and the creditnota row itself is a reversal, never a receivable. Build the set of
  // credited originals up front so we can drop both.
  const creditedOriginalIds = new Set<string>();
  for (const i of args.invoices) {
    if (i.invoiceType === "creditnota" && i.originalInvoiceId != null) {
      creditedOriginalIds.add(String(i.originalInvoiceId));
    }
  }

  for (const i of args.invoices) {
    if (i.direction !== "outgoing") continue;
    if (i.invoiceType === "creditnota") continue;      // a creditnota is a reversal, not a receivable
    if (i.id != null && creditedOriginalIds.has(String(i.id))) continue; // already reversed by a creditnota
    if (!DECLARED_OUTGOING.has(i.status ?? "")) continue; // draft/processing = not declared; paid = collected

    const inc = i.totalIncBtw != null ? Number(i.totalIncBtw) : (Number(i.totalExBtw) || 0) + (Number(i.btwAmount) || 0);
    if (!(inc > 0)) continue;                          // a €0 / negative (credit) line is not a bad debt
    const grossAbs = inc;
    const paid = Math.max(0, Number(i.amountPaid) || 0);
    const unpaidFraction = Math.max(0, Math.min(1, (grossAbs - paid) / grossAbs));
    if (unpaidFraction <= 0) continue;                 // fully paid → nothing to reclaim

    const clockStart = i.dueDate ?? i.invoiceDate;     // rule runs from the due date; fall back to invoice date
    if (!clockStart) continue;                          // no date at all → can't age it
    if (!i.dueDate) usedInvoiceDateFallback = true;
    const oneYear = oneYearLater(clockStart);
    if (!oneYear || oneYear > asOf) continue;           // not yet 1 year past due → not eligible

    const reclaimableBtw = (Number(i.btwAmount) || 0) * unpaidFraction;
    if (reclaimableBtw < 0.005) continue;               // no positive BTW to reclaim (0%-sale / sign glitch)
    eligible.push({
      invoiceNumber: i.invoiceNumber,
      clientName: i.clientName,
      dueDate: clockStart.slice(0, 10),
      unpaidEx: (Number(i.totalExBtw) || 0) * unpaidFraction,
      reclaimableBtw,
    });
  }

  const totalReclaimableBtw = eligible.reduce((s, e) => s + e.reclaimableBtw, 0);
  return { eligible, totalReclaimableBtw, usedInvoiceDateFallback };
}

// Below this the reclaimable BTW rounds to €0 on every surface — flagging "1 factuur, €0 terugvraagbaar"
// reads as noise/contradiction, so we don't surface an immaterial sub-euro reclaim as a bad debt.
export const BAD_DEBT_MIN_EUR = 0.5;

/** An honest Dutch note for the concept aangifte / accountant, or null when nothing (material) is eligible. */
export function badDebtNote(r: BadDebtResult): string | null {
  if (r.eligible.length === 0 || r.totalReclaimableBtw < BAD_DEBT_MIN_EUR) return null;
  const n = r.eligible.length;
  const eur = `€${Math.round(r.totalReclaimableBtw).toLocaleString("nl-NL")}`;
  const labels = r.eligible.slice(0, 5).map((e) => e.invoiceNumber ?? "?").filter(Boolean).join(", ");
  const more = n > 5 ? ` (+${n - 5} meer)` : "";
  return (
    `Oninbare vordering: ${n === 1 ? "1 verkoopfactuur is" : `${n} verkoopfacturen zijn`} meer dan een jaar ` +
    `na de vervaldatum nog onbetaald. Je hebt hierover ${eur} BTW afgedragen die je kunt terugvragen ` +
    `(art. 29 Wet OB)${labels ? ` — bijv. ${labels}${more}` : ""}. Dit wordt NIET automatisch verrekend; ` +
    "bespreek met je boekhouder in welk tijdvak je het terugvraagt (en dien te corrigeren als de klant alsnog betaalt)."
  );
}
