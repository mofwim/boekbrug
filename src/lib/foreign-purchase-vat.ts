// src/lib/foreign-purchase-vat.ts
// [BUITENLANDSE-INKOOP] Rubriek 4a and 4b — btw on purchases from abroad, shifted to this owner.
// Pure, no I/O. Run: npx tsx --test src/lib/foreign-purchase-vat.test.ts
//
// A zzp'er buys from Adobe (IE), AWS (LU), a UK designer, OpenAI (US). None of those invoices
// carries Dutch btw: the btw is shifted to the buyer, who declares it — rubriek 4b for a supplier
// in another member state, 4a for one outside the EU — and, with a right of deduction, takes the
// same amount back in 5b. For most owners the two cancel, which is exactly why leaving them out
// looked harmless: the return was wrong on two lines and did not reconcile with anything the
// Belastingdienst cross-checks, and under the KOR or a partial exemption the btw is genuinely owed.
//
// Before this module the app LISTED the EU suppliers it could see through the prefix of their
// btw-nummer and computed nothing; a supplier without an EU prefix — every UK, US or Swiss one —
// reached neither a rubriek nor a note.
//
// THE RULE, in the words of the aangifte
//   · an INCOMING invoice the ledger counts (received/paid);
//   · from a supplier whose country is known and is not the Netherlands — the country the owner
//     recorded on the supplier first, the prefix of an EU btw-nummer where nothing was recorded;
//   · carrying no btw (a foreign supplier that DID charge btw is listed for the owner to check,
//     never shifted: btw stated on an invoice is btw the supplier accounts for).
// The btw is the grondslag at the trade's standard rate, proposed the way 2a proposes it: the
// document names no rate, and the note says so. The deductible share follows the owner's regime,
// handed in per invoice by the caller like it is for 2a (aftrekDeel).
//
// ONE DOCUMENT, ONE RUBRIEK. A foreign supplier's invoice may well print "btw verlegd" — a Belgian
// subcontractor writes exactly that — and the reader then marks it the way it marks a domestic
// verlegging. The COUNTRY decides the box: a supplier abroad is 4a/4b, never 2a, whatever the
// document prints. So the caller keeps every invoice placed here out of its 2a set (`items[].id`).
//
// Sign travels with the invoice: a creditnota from a foreign supplier reduces 4a/4b the way it
// reduces 2a, so a refund is not declared as a second purchase.

import { round2 } from "./invoice-totals";
import { classifyVatNumber } from "./icp";
import { isEuMemberState, normalizeCountry } from "./client-country";
import { VERLEGD_DEFAULT_RATE, type VerlegdTotaal } from "./verlegde-btw";

/** Purchase statuses the ledger counts — the same allow-list as everywhere else. */
const DECLARED_INCOMING: ReadonlySet<string> = new Set(["received", "paid"]);

export interface ForeignPurchaseInput {
  id?: string | null;
  direction: "incoming" | "outgoing" | null | undefined;
  status: string | null | undefined;
  invoiceNumber?: string | null;
  supplierName?: string | null;
  totalExBtw: number | null | undefined;
  btwAmount: number | null | undefined;
  /** What the owner recorded on the supplier (suppliers.country), when anything. */
  supplierCountry?: string | null;
  /** The supplier's btw-nummer as printed: an EU prefix names the country when nothing else does. */
  supplierVatNumber?: string | null;
  /** The deductible share of the shifted btw (0..1) under the owner's regime. Absent = a full right. */
  aftrekDeel?: number | null;
}

/** One invoice placed in 4a or 4b — the per-invoice detail behind the two rubriek totals. */
export interface ForeignPurchaseItem {
  id: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  country: string;
  rubriek: "4a" | "4b";
  /** Signed, as the invoice states it. */
  grondslag: number;
  /** Rounded per invoice; signed. */
  btw: number;
  /** The share of `btw` that returns in 5b; rounded per invoice, signed. */
  aftrekbaar: number;
}

/** A foreign supplier that charged btw after all: not shifted, named so the owner checks it. */
export interface ChargedAbroad {
  id: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  country: string;
  btwAmount: number;
}

export interface ForeignPurchaseVat {
  /** Rubriek 4b — suppliers in other member states. Null when there is nothing to declare. */
  eu: VerlegdTotaal | null;
  /** Rubriek 4a — suppliers outside the EU. Null when there is nothing to declare. */
  nonEu: VerlegdTotaal | null;
  /** The rate the amounts were computed with — proposed, never read off a document. */
  rate: number;
  /** Every invoice behind `eu` and `nonEu`, largest first. */
  items: ForeignPurchaseItem[];
  chargedAbroad: ChargedAbroad[];
}

/**
 * Where a supplier sits: the owner's recorded country first, the btw-nummer's prefix second, and
 * nothing where there is nothing — a supplier with neither reads as Dutch, which is what every
 * supplier was before either existed.
 */
export function supplierCountryOf(args: {
  supplierCountry?: string | null;
  supplierVatNumber?: string | null;
}): string | null {
  const recorded = normalizeCountry(args.supplierCountry);
  if (recorded) return recorded;
  const shape = classifyVatNumber(args.supplierVatNumber);
  if (shape.kind === "eu" || shape.kind === "eu_suspect") return normalizeCountry(shape.country);
  if (shape.kind === "domestic") return "NL";
  return null;
}

interface Acc { grondslag: number; btw: number; aantal: number; aftrekbaar: number }

function fold(acc: Acc | null): VerlegdTotaal | null {
  if (!acc || acc.aantal === 0) return null;
  return {
    grondslag: round2(acc.grondslag),
    btw: round2(acc.btw),
    aantal: acc.aantal,
    aftrekbaar: round2(acc.aftrekbaar),
  };
}

/** The 4a and 4b totals for a set of invoices, with the invoices behind them. */
export function foreignPurchaseVat(
  invoices: readonly ForeignPurchaseInput[],
  rate: number = VERLEGD_DEFAULT_RATE,
): ForeignPurchaseVat {
  let eu: Acc | null = null;
  let nonEu: Acc | null = null;
  const items: ForeignPurchaseItem[] = [];
  const chargedAbroad: ChargedAbroad[] = [];
  const tarief = Number.isFinite(rate) && rate > 0 ? rate : VERLEGD_DEFAULT_RATE;

  for (const i of invoices) {
    if (i.direction !== "incoming") continue;
    if (!DECLARED_INCOMING.has(i.status ?? "")) continue;
    const country = supplierCountryOf(i);
    if (!country || country === "NL") continue;
    const ex = typeof i.totalExBtw === "number" && Number.isFinite(i.totalExBtw) ? i.totalExBtw : 0;
    if (ex === 0) continue;
    const btwOnInvoice = typeof i.btwAmount === "number" && Number.isFinite(i.btwAmount) ? i.btwAmount : 0;
    if (Math.abs(btwOnInvoice) >= 0.005) {
      chargedAbroad.push({
        id: i.id ?? null,
        invoiceNumber: i.invoiceNumber ?? null,
        supplierName: i.supplierName ?? null,
        country,
        btwAmount: round2(btwOnInvoice),
      });
      continue;
    }
    // Rounded per invoice, as 2a is: the rubriek is a sum of cents that exist, not a percentage
    // of a sum — two readers of the same invoices must land on the same euro, and the per-invoice
    // list adds up to the total it is printed under.
    const bedrag = round2(Math.abs(ex) * (tarief / 100)) * Math.sign(ex);
    const deel = typeof i.aftrekDeel === "number" && Number.isFinite(i.aftrekDeel)
      ? Math.min(1, Math.max(0, i.aftrekDeel))
      : 1;
    const aftrek = round2(bedrag * deel);
    const rubriek: "4a" | "4b" = isEuMemberState(country) ? "4b" : "4a";
    const acc: Acc = (rubriek === "4b" ? eu : nonEu) ?? { grondslag: 0, btw: 0, aantal: 0, aftrekbaar: 0 };
    acc.grondslag += ex;
    acc.btw += bedrag;
    acc.aantal += 1;
    acc.aftrekbaar += aftrek;
    if (rubriek === "4b") eu = acc; else nonEu = acc;
    items.push({
      id: i.id ?? null,
      invoiceNumber: i.invoiceNumber ?? null,
      supplierName: i.supplierName ?? null,
      country,
      rubriek,
      grondslag: ex,
      btw: bedrag,
      aftrekbaar: aftrek,
    });
  }

  items.sort((a, b) => Math.abs(b.grondslag) - Math.abs(a.grondslag));
  return { eu: fold(eu), nonEu: fold(nonEu), rate: tarief, items, chargedAbroad };
}

/** The ids of every invoice placed in 4a/4b — what the caller keeps out of rubriek 2a. */
export function foreignPurchaseIds(r: ForeignPurchaseVat): Set<string> {
  const ids = new Set<string>();
  for (const x of r.items) if (x.id) ids.add(x.id);
  for (const x of r.chargedAbroad) if (x.id) ids.add(x.id);
  return ids;
}

const label = (x: { invoiceNumber: string | null; supplierName: string | null }): string =>
  x.invoiceNumber ?? x.supplierName ?? "?";

/**
 * The note beside the rubrieken: WHICH invoices stand in 4a/4b, and which foreign invoices were
 * left out because they charge btw. The amounts themselves are said by the aangifte's own note
 * per rubriek (aangifte.ts), so this one does not repeat them. Dutch: it is part of the concept
 * the accountant reads, like every other note on it.
 */
export function foreignPurchaseNote(r: ForeignPurchaseVat): string | null {
  const parts: string[] = [];
  if (r.items.length > 0) {
    const n = r.items.length;
    const named = r.items.slice(0, 5).map((x) => `${label(x)} (${x.country} → ${x.rubriek})`).join(", ");
    const more = n > 5 ? ` (+${n - 5} meer)` : "";
    parts.push(
      `In rubriek 4a/4b ${n === 1 ? "staat 1 inkoopfactuur" : `staan ${n} inkoopfacturen`} van een leverancier buiten ` +
      `Nederland: ${named}${more}. Het land komt van de leverancierskaart, of anders van het btw-nummer van de ` +
      "leverancier; een leverancier zonder land wordt als Nederlands gelezen.",
    );
  }
  if (r.chargedAbroad.length > 0) {
    const k = r.chargedAbroad.length;
    const named = r.chargedAbroad.slice(0, 5).map((x) => `${label(x)} (${x.country})`).join(", ");
    const more = k > 5 ? ` (+${k - 5} meer)` : "";
    parts.push(
      `Let op: op ${k === 1 ? "1 inkoopfactuur" : `${k} inkoopfacturen`} van een buitenlandse leverancier is wél btw ` +
      `berekend (${named}${more}). Die btw is niet verlegd en staat niet in 4a/4b. Is het buitenlandse btw, dan hoort ` +
      "die ook niet in 5b — controleer het met je boekhouder.",
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/** [BUITENLANDSE-INKOOP] The per-invoice detail behind 4a/4b, as a CSV for the accountant's package. */
export function buildForeignPurchaseCsv(r: ForeignPurchaseVat, periodLabel: string): string {
  const EUR = (n: number) => n.toFixed(2).replace(".", ",");
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const L: string[] = [];
  L.push(`BoekBrug — Inkopen uit het buitenland ${periodLabel} (rubriek 4a/4b)`);
  L.push(
    `CONCEPT. De verlegde btw is berekend tegen het voorgestelde tarief van ${r.rate}% — het tarief staat niet op ` +
    "zo'n factuur. Het aftrekbare deel volgt het recht op aftrek van de eigenaar (KOR: niets). De boekhouder controleert.",
  );
  L.push("");
  L.push(["Rubriek", "Land", "Leverancier", "Factuur", "Grondslag (excl. btw)", "Verlegde btw", "Aftrekbaar in 5b"].map(esc).join(";"));
  for (const x of r.items) {
    L.push([x.rubriek, x.country, x.supplierName ?? "", x.invoiceNumber ?? "", EUR(x.grondslag), EUR(x.btw), EUR(x.aftrekbaar)].map(esc).join(";"));
  }
  L.push("");
  if (r.nonEu) L.push(["4a", "", "", "Totaal buiten de EU", EUR(r.nonEu.grondslag), EUR(r.nonEu.btw), EUR(r.nonEu.aftrekbaar)].map(esc).join(";"));
  if (r.eu) L.push(["4b", "", "", "Totaal binnen de EU", EUR(r.eu.grondslag), EUR(r.eu.btw), EUR(r.eu.aftrekbaar)].map(esc).join(";"));
  if (r.chargedAbroad.length > 0) {
    L.push("");
    L.push("Niet verlegd — op deze facturen van een buitenlandse leverancier is btw berekend (controleren):");
    L.push(["Land", "Leverancier", "Factuur", "Btw op factuur"].map(esc).join(";"));
    for (const x of r.chargedAbroad) {
      L.push([x.country, x.supplierName ?? "", x.invoiceNumber ?? "", EUR(x.btwAmount)].map(esc).join(";"));
    }
  }
  return L.join("\r\n");
}
