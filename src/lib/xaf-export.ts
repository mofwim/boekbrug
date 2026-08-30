// src/lib/xaf-export.ts
// [XAF] XML Auditfile Financieel 3.2 — the year as balanced journals, for the accountant's own
// software. Pure, no I/O. Run: npx tsx --test src/lib/xaf-export.test.ts
//
// WHAT THIS FILE IS, AND — MORE IMPORTANT — WHAT IT REFUSES TO BE
//
// Every administratiekantoor asks the same first question: "is er een auditfile?" Their software
// (Exact, SnelStart, Twinfield, Yuki, CaseWare) imports XAF to take an administration IN. This
// module projects BoekBrug's SOURCES — sales invoices, purchase invoices, bank lines, cash
// entries, till Z-reports — into that standard, one balanced journal entry per source document.
//
// It deliberately does NOT re-run the quarterly result engine (compute-result-range.ts): the
// triangle's commission attribution, the kas-scheme settlement timing and the exemption
// apportionment are CONCLUSIONS, and the accountant importing an auditfile wants the sources, not
// our conclusions — those they already receive through the closing package and the aangifte
// screen. What the two must NEVER do is disagree about attribution rules, so the rules here are
// imported from the same authorities the engine uses (isVerifiedForPackage / effectiveDirection
// decide which invoices book; toResultBankTx decides what a card payout is; liveCashEntries
// decides which cash rows exist; the Z-covered-day rule decides that a cash omzet entry on a
// covered day is a witness, not a second booking).
//
// Three iron rules, in the money-out-errors-are-unrecoverable direction:
//
//   1. EVERY entry balances in whole cents, by construction: the gross side is the SUM of the
//      parts, never the stored total. A document whose stored total disagrees with its parts by
//      more than a cent is REFUSED into `skipped` with a reason — the file never invents a cent
//      and never emits an entry that does not balance.
//   2. What the app cannot attribute goes to 2100 Vraagposten and is SAID. A wrong account is a
//      wrong administration; an open vraagpost is a question the accountant answers in one click.
//   3. Voorbelasting appears ONLY where the engine itself claims it: purchase invoices, and
//      documented cash costs. An undocumented cash cost books GROSS — a BTW claim without a
//      document is exactly the class of error that cannot be repaired after filing.
//
// The RGS references on the main accounts (leadReference) are the codes verified against the
// public RGS registry: BLimKasKas, BLimBanRba, BVorDebHad, BVorVbkTvo, BSchBepBtw, BSchCreHac,
// and the group-level WOmz / WBed where the leaf depends on facts the app does not hold. Accounts
// whose RGS leaf could not be verified carry NO reference — a missing code is a lookup, a wrong
// code is a misfiled administration.

import { round2 } from "./invoice-totals";

// ── The rekeningschema ───────────────────────────────────────────────────────────────────────────

export interface XafAccount {
  accID: string;
  accDesc: string;
  accTp: "B" | "P";
  /** Verified RGS referentiecode, or null when the leaf could not be verified. */
  rgs: string | null;
}

export const XAF_ACCOUNTS: readonly XafAccount[] = [
  { accID: "1000", accDesc: "Kas", accTp: "B", rgs: "BLimKasKas" },
  { accID: "1100", accDesc: "Bank", accTp: "B", rgs: "BLimBanRba" },
  { accID: "1300", accDesc: "Debiteuren", accTp: "B", rgs: "BVorDebHad" },
  { accID: "1350", accDesc: "Kruisposten (pin onderweg)", accTp: "B", rgs: null },
  { accID: "1400", accDesc: "Terug te vorderen omzetbelasting (voorbelasting)", accTp: "B", rgs: "BVorVbkTvo" },
  { accID: "1500", accDesc: "Te betalen omzetbelasting", accTp: "B", rgs: "BSchBepBtw" },
  { accID: "1600", accDesc: "Crediteuren", accTp: "B", rgs: "BSchCreHac" },
  { accID: "2100", accDesc: "Vraagposten", accTp: "B", rgs: null },
  { accID: "4000", accDesc: "Kosten", accTp: "P", rgs: "WBed" },
  { accID: "8000", accDesc: "Omzet 21%", accTp: "P", rgs: "WOmz" },
  { accID: "8010", accDesc: "Omzet 9%", accTp: "P", rgs: "WOmz" },
  { accID: "8020", accDesc: "Omzet 0% / vrijgesteld / zonder tarief", accTp: "P", rgs: "WOmz" },
] as const;

const ACC = {
  kas: "1000", bank: "1100", debiteuren: "1300", kruisposten: "1350",
  voorbelasting: "1400", btwTeBetalen: "1500", crediteuren: "1600",
  vraagposten: "2100", kosten: "4000",
} as const;

function omzetAccountFor(rate: number): string {
  if (rate === 21) return "8000";
  if (rate === 9) return "8010";
  return "8020";
}

// ── Input types (the route adapts database rows to these; this module never sees a table) ───────

export interface XafCompany {
  name: string;
  kvkNumber: string | null;
  btwNumber: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
}

export interface XafSalesInvoice {
  id: string;
  invoiceNumber: string | null;
  /** ISO date. A dateless invoice cannot be placed in a period and is refused with a reason. */
  invoiceDate: string | null;
  clientName: string | null;
  totalExBtw: number;
  btwAmount: number;
  /** 'creditnota' flips every side. */
  invoiceType: string | null;
  /** From fetchRateShares — present only on genuinely mixed-rate invoices. */
  rateLines: Array<{ rate: number; ex: number; btw: number }> | null;
}

export interface XafPurchaseInvoice {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  vendorName: string | null;
  totalExBtw: number;
  btwAmount: number;
}

export interface XafBankLine {
  id: string;
  date: string | null;
  amount: number;
  description: string | null;
  category: string | null;
  /** Direction of the linked invoice, resolved by the route via effectiveDirection. */
  linkedInvoiceDirection: "incoming" | "outgoing" | null;
  /** toResultBankTx's decision — THE one card-payout predicate ([ONE-BANK-READ]). */
  posSettlement: boolean;
}

export interface XafCashLine {
  id: string;
  date: string | null;
  direction: "in" | "out";
  amount: number;
  category: string | null;
  btwRate: number | null;
  /** Linked bon/receipt DOCUMENT id, when the cost is documented ([CASH-COST-VAT]). */
  documentId: string | null;
  /** [XAF-KAS] The INVOICE this cash row settles (cash-settle writes it, category 'betaling').
   *  The old guard compared documentId against invoice ids — two id spaces that never meet, so
   *  the settle branch was dead and every cash payment of an invoice booked a second gross cost. */
  invoiceId: string | null;
  /** entry_date falls on a Z-covered day — the till already booked these takings. */
  coveredByTurnover: boolean;
}

export interface XafTurnoverDay {
  date: string;
  base0: number; base9: number; base21: number;
  btw9: number; btw21: number;
  pinAmount: number; cashAmount: number; otherAmount: number;
  /** [FIN-5] The printed day total. A Z-day whose per-rate split did not import (bases 0, total
   *  set) is still REVENUE — the engine recovers the remainder; so does this file now. */
  totalIncl: number | null;
}

export interface XafInput {
  year: number;
  /** ISO date the file is generated (passed in — this module holds no clock). */
  dateCreated: string;
  /** [XAF-PERIODE] Last day the file may claim. The header used to declare 01-01..12-31
   *  unconditionally, so a May download told the importer "periods 6-12 are empty" as a fact
   *  about the administration. Clamped to today by the route. */
  endDate: string;
  /** [XAF-REGIME] Honest limits of this projection (KOR, verlegd/vrijgesteld not split out) —
   *  emitted as LET OP comments; a wrong account is worse than a stated caveat. */
  regimeNotes: string[];
  company: XafCompany;
  sales: XafSalesInvoice[];
  purchases: XafPurchaseInvoice[];
  bank: XafBankLine[];
  cash: XafCashLine[];
  turnover: XafTurnoverDay[];
}

export interface XafSkipped {
  source: "verkoop" | "inkoop" | "bank" | "kas" | "dagomzet";
  id: string;
  reason: string;
}

export interface XafBuildResult {
  xml: string;
  entryCount: number;
  lineCount: number;
  totalDebit: number;
  totalCredit: number;
  /** Documents refused (unbalanced, dateless, unattributable rate) — SAID, never silently fixed. */
  skipped: XafSkipped[];
  /** Cash omzet rows on Z-covered days: witnesses of takings the till already booked. */
  turnoverWitnessCount: number;
}

// ── Cents. Every balance decision happens in integers ([CENT]: round2 is the one rounding) ──────

function cents(x: number): number {
  return Math.round(round2(x) * 100);
}

function eur(c: number): string {
  const abs = Math.abs(c);
  return `${c < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

interface Line {
  accID: string;
  /** Signed cents on the DEBIT side: positive books debit, negative books credit. */
  debitC: number;
  desc: string;
  docRef: string;
  custSupID?: string;
  vat?: { rate: number; amountDebitC: number };
}

interface Entry {
  nr: number;
  desc: string;
  date: string; // ISO
  journal: "VRK" | "INK" | "BNK" | "KAS" | "OMZ";
  lines: Line[];
}

/**
 * [XAF-NIET-STIL] Tekst die veilig binnen een XML-commentaar past.
 *
 * `--` is binnen een commentaar verboden en `-->` sluit het af: één reden met een dubbel
 * koppelteken zou het hele auditbestand breken op de dag dat die reden voor het eerst voorkomt.
 * Geen enkele reden in dit bestand bevat er vandaag een — en dat is precies waarom dit een functie
 * is en geen aanname: de volgende reden hoeft dit niet te weten om veilig te zijn.
 */
export function xmlCommentSafe(text: string): string {
  return text.replace(/-{2,}/g, "-");
}

/** Snap a header-derived rate to the Dutch set, or null when it is not one of them. */
export function snapRate(ex: number, btw: number): number | null {
  if (cents(btw) === 0) return 0;
  if (cents(ex) === 0) return null; // BTW over nothing — not derivable
  const pct = (btw / ex) * 100;
  for (const rate of [21, 9]) if (Math.abs(pct - rate) <= 0.5) return rate;
  return null;
}

// ── Journal builders ─────────────────────────────────────────────────────────────────────────────

function balanced(lines: Line[]): boolean {
  return lines.reduce((s, l) => s + l.debitC, 0) === 0;
}

function buildSales(inv: XafSalesInvoice, custSupID: string): { lines: Line[] } | { reason: string } {
  if (!inv.invoiceDate) return { reason: "geen factuurdatum — niet in een periode te plaatsen" };
  const docRef = inv.invoiceNumber ?? inv.id;
  // The rate mix: the invoice's own lines when they say more than the header can, else the
  // header-derived single rate — the same preference order the result engine uses.
  let shares: Array<{ rate: number; ex: number; btw: number }>;
  if (inv.rateLines && inv.rateLines.length > 0) {
    shares = inv.rateLines;
  } else {
    const rate = snapRate(inv.totalExBtw, inv.btwAmount);
    if (rate === null) return { reason: "btw-tarief niet herleidbaar uit het totaal" };
    shares = [{ rate, ex: inv.totalExBtw, btw: inv.btwAmount }];
  }
  // Parts first, gross as their SUM (iron rule 1) — then the stored total must agree.
  const partsC = shares.map((s) => ({ rate: s.rate, exC: cents(s.ex), btwC: cents(s.btw) }));
  const grossC = partsC.reduce((s, p) => s + p.exC + p.btwC, 0);
  const storedC = cents(inv.totalExBtw) + cents(inv.btwAmount);
  if (Math.abs(grossC - storedC) > 1) return { reason: "totaal telt niet op uit de delen" };
  const lines: Line[] = [
    { accID: ACC.debiteuren, debitC: grossC, desc: inv.clientName ?? "Debiteur", docRef, custSupID },
  ];
  for (const p of partsC) {
    if (p.exC !== 0) {
      lines.push({
        accID: omzetAccountFor(p.rate), debitC: -p.exC, desc: `Omzet ${p.rate}%`, docRef,
        vat: { rate: p.rate, amountDebitC: -p.btwC },
      });
    }
  }
  const btwC = partsC.reduce((s, p) => s + p.btwC, 0);
  if (btwC !== 0) lines.push({ accID: ACC.btwTeBetalen, debitC: -btwC, desc: "BTW over omzet", docRef });
  return { lines };
}

function buildPurchase(inv: XafPurchaseInvoice, custSupID: string): { lines: Line[] } | { reason: string } {
  if (!inv.invoiceDate) return { reason: "geen factuurdatum — niet in een periode te plaatsen" };
  const docRef = inv.invoiceNumber ?? inv.id;
  const exC = cents(inv.totalExBtw);
  const btwC = cents(inv.btwAmount);
  const lines: Line[] = [{ accID: ACC.kosten, debitC: exC, desc: inv.vendorName ?? "Kosten", docRef }];
  if (btwC !== 0) lines.push({ accID: ACC.voorbelasting, debitC: btwC, desc: "Voorbelasting", docRef });
  lines.push({ accID: ACC.crediteuren, debitC: -(exC + btwC), desc: inv.vendorName ?? "Crediteur", docRef, custSupID });
  return { lines };
}

function buildBank(tx: XafBankLine): { lines: Line[] } | { reason: string } {
  if (!tx.date) return { reason: "geen datum" };
  const amtC = cents(tx.amount);
  if (amtC === 0) return { reason: "bedrag nul" };
  const docRef = tx.id;
  // The counter-account, in order of how much the app actually KNOWS:
  //   linked to an invoice → the sub-administration it settles;
  //   a card payout (toResultBankTx's predicate) → kruisposten, where its Z-takings wait;
  //   anything else → vraagposten, with the owner's category as a hint (iron rule 2 — the
  //   category alone must not book omzet/kosten here: those takings and costs enter through
  //   the till and the invoices, and a second entry from the bank side is the double count).
  const counter = tx.linkedInvoiceDirection === "outgoing" ? ACC.debiteuren
    : tx.linkedInvoiceDirection === "incoming" ? ACC.crediteuren
    : tx.posSettlement ? ACC.kruisposten
    : ACC.vraagposten;
  const hint = counter === ACC.vraagposten && tx.category ? ` [${tx.category}]` : "";
  const desc = (tx.description ?? "Bankmutatie").slice(0, 200);
  return {
    lines: [
      { accID: ACC.bank, debitC: amtC, desc, docRef },
      { accID: counter, debitC: -amtC, desc: `${desc}${hint}`, docRef },
    ],
  };
}

function buildCash(
  row: XafCashLine,
  purchaseIds: ReadonlySet<string>,
  salesIds: ReadonlySet<string>,
): { lines: Line[] } | { reason: string } | { witness: true } {
  if (!row.date) return { reason: "geen datum" };
  const amtC = cents(row.amount);
  if (amtC === 0) return { reason: "bedrag nul" };
  const docRef = row.id;

  // [XAF-KAS · BETALING] A cash settlement of an invoice clears the SUB-ADMINISTRATION — the
  // cost/omzet and its BTW already booked through the invoice journal, and a second entry here
  // was the audit's biggest find: €221 of kosten for one €121 bill, crediteuren never clearing.
  // cash-settle writes these rows with invoice_id set (category 'betaling'); the guard is on
  // that id, in the INVOICE id space — the old documentId check compared against a space it
  // could never match and was dead code certified by a lying fixture.
  if (row.invoiceId && purchaseIds.has(row.invoiceId)) {
    // outgoing money settles a purchase: D 1600, C 1000. direction 'out' ⇒ amtC>0 by data shape,
    // but the SIGN carries the truth either way.
    return {
      lines: [
        { accID: ACC.crediteuren, debitC: row.direction === "out" ? amtC : -amtC, desc: "Contante betaling inkoopfactuur", docRef },
        { accID: ACC.kas, debitC: row.direction === "out" ? -amtC : amtC, desc: "Contante betaling inkoopfactuur", docRef },
      ],
    };
  }
  if (row.invoiceId && salesIds.has(row.invoiceId)) {
    // incoming money settles a sale: D 1000, C 1300 — debiteuren clears.
    return {
      lines: [
        { accID: ACC.kas, debitC: row.direction === "in" ? amtC : -amtC, desc: "Contante ontvangst verkoopfactuur", docRef },
        { accID: ACC.debiteuren, debitC: row.direction === "in" ? -amtC : amtC, desc: "Contante ontvangst verkoopfactuur", docRef },
      ],
    };
  }
  if (row.category === "betaling") {
    // A settlement whose invoice is outside this year (or unknown): still a sub-administration
    // movement, never a cost — route it by direction to 1600/1300 so the ledger's story stays
    // "money settled a bill", with the open counterpart visible instead of a phantom cost.
    return row.direction === "out"
      ? { lines: [
          { accID: ACC.crediteuren, debitC: amtC, desc: "Contante betaling (factuur buiten dit jaar)", docRef },
          { accID: ACC.kas, debitC: -amtC, desc: "Contante betaling (factuur buiten dit jaar)", docRef },
        ] }
      : { lines: [
          { accID: ACC.kas, debitC: amtC, desc: "Contante ontvangst (factuur buiten dit jaar)", docRef },
          { accID: ACC.debiteuren, debitC: -amtC, desc: "Contante ontvangst (factuur buiten dit jaar)", docRef },
        ] };
  }

  // [XAF-KAS · GETUIGE] The covered-day rule is DIRECTION-AGNOSTIC, as in the engine: a till
  // refund rung on a Z-day is inside that day's net figure too.
  if (row.category === "omzet" && row.coveredByTurnover) return { witness: true };

  if (row.category === "omzet") {
    // sign follows direction: 'in' books omzet, 'out' is a REFUND — negative omzet and negative
    // BTW, exactly as the engine books it. Booking a refund as kosten overstated result by the
    // gross twice over.
    const sign = row.direction === "in" ? 1 : -1;
    if (row.btwRate === 21 || row.btwRate === 9) {
      const exC = Math.round(amtC / (1 + row.btwRate / 100));
      const btwC = amtC - exC;
      return {
        lines: [
          { accID: ACC.kas, debitC: sign * amtC, desc: sign > 0 ? "Contante verkoop" : "Contante terugbetaling verkoop", docRef },
          { accID: omzetAccountFor(row.btwRate), debitC: sign * -exC, desc: `Omzet ${row.btwRate}%${sign < 0 ? " (terugbetaling)" : ""}`, docRef, vat: { rate: row.btwRate, amountDebitC: sign * -btwC } },
          { accID: ACC.btwTeBetalen, debitC: sign * -btwC, desc: "BTW over contante omzet", docRef },
        ],
      };
    }
    return {
      lines: [
        { accID: ACC.kas, debitC: sign * amtC, desc: sign > 0 ? "Contante verkoop" : "Contante terugbetaling verkoop", docRef },
        { accID: omzetAccountFor(0), debitC: sign * -amtC, desc: row.btwRate === 0 ? "Omzet 0%" : "Omzet zonder btw-tarief — tarief alsnog vastleggen", docRef },
      ],
    };
  }

  // [XAF-KAS · SOORTEN] The category vocabulary is cash.ts's CASH_CATEGORIES, and the engine
  // books exactly kosten/salaris as cost and EXCLUDES prive/transfer/tax/fee. "Any category is a
  // cost" turned a privé-opname into a deductible expense and a bank deposit into €500 of lost
  // profit. Mirror the engine: an allow-list, transfer to the bank counterpart, the rest a NAMED
  // question.
  if (row.category === "kosten" || row.category === "salaris") {
    if (row.direction === "in") {
      // a supplier refunding in cash: negative cost, mirroring the engine's sign.
      return {
        lines: [
          { accID: ACC.kas, debitC: amtC, desc: "Contante terugontvangst kosten", docRef },
          { accID: ACC.kosten, debitC: -amtC, desc: `${row.category} (terugontvangst)`, docRef },
        ],
      };
    }
    if (row.documentId && (row.btwRate === 21 || row.btwRate === 9)) {
      // Documented cash cost ([CASH-COST-VAT]): the bon carries the BTW, so voorbelasting may book.
      const exC = Math.round(amtC / (1 + row.btwRate / 100));
      const btwC = amtC - exC;
      return {
        lines: [
          { accID: ACC.kosten, debitC: exC, desc: row.category, docRef },
          { accID: ACC.voorbelasting, debitC: btwC, desc: "Voorbelasting (bon)", docRef },
          { accID: ACC.kas, debitC: -amtC, desc: row.category, docRef },
        ],
      };
    }
    // Undocumented: GROSS, no voorbelasting (iron rule 3).
    return {
      lines: [
        { accID: ACC.kosten, debitC: amtC, desc: row.category, docRef },
        { accID: ACC.kas, debitC: -amtC, desc: row.category, docRef },
      ],
    };
  }
  if (row.category === "transfer") {
    // Drawer ↔ bank, via 2100 (kruis-/vraagposten) — NOT via 1100 directly. The bank journal
    // books the SAME movement's statement line as 1100 against 2100 (an unlinked, non-POS line),
    // so booking 1100 here too counted the deposit on the bank account twice and left a phantom
    // residual on 2100. Through 2100 on this side, the two 2100 legs cancel and 1100 moves
    // exactly once — the classic kruisposten shape. (Day-end audit: the old comment CLAIMED the
    // cancel while booking the account that made it impossible.)
    return row.direction === "out"
      ? { lines: [
          { accID: ACC.vraagposten, debitC: amtC, desc: "Kasstorting naar bank (kruispost)", docRef },
          { accID: ACC.kas, debitC: -amtC, desc: "Kasstorting naar bank", docRef },
        ] }
      : { lines: [
          { accID: ACC.kas, debitC: amtC, desc: "Kasopname van bank", docRef },
          { accID: ACC.vraagposten, debitC: -amtC, desc: "Kasopname van bank (kruispost)", docRef },
        ] };
  }
  // prive / tax / fee / unknown: a movement the P&L must NOT absorb. Named on vraagposten.
  const sign = row.direction === "in" ? 1 : -1;
  return {
    lines: [
      { accID: ACC.kas, debitC: sign * amtC, desc: row.category ?? (sign > 0 ? "Kasstorting" : "Kas uit — onbenoemd"), docRef },
      { accID: ACC.vraagposten, debitC: sign * -amtC, desc: `Kas ${row.direction}${row.category ? ` [${row.category}]` : ""}`, docRef },
    ],
  };
}

function buildTurnoverDay(t: XafTurnoverDay): { lines: Line[] } | { reason: string } {
  const docRef = `Z-${t.date}`;
  const base0C = cents(t.base0), base9C = cents(t.base9), base21C = cents(t.base21);
  const btw9C = cents(t.btw9), btw21C = cents(t.btw21);
  let salesC = base0C + base9C + base21C + btw9C + btw21C;
  // [FIN-5] A Z-day whose per-rate split did not import (bases empty, printed total set) is
  // still REVENUE — the engine recovers exactly this remainder, and a day the file silently
  // dropped left turnover in neither journal, visible only inside an XML comment.
  const totalC = cents(t.totalIncl ?? 0);
  const restC = totalC - salesC;
  if (salesC === 0 && totalC === 0) return { reason: "lege dag" };
  const lines: Line[] = [];
  if (restC > Math.max(10, Math.round(Math.abs(totalC) * 0.001))) {
    lines.push({ accID: omzetAccountFor(0), debitC: -restC, desc: "Dagomzet zonder geimporteerd tarief — tarief alsnog vastleggen", docRef });
    salesC += restC;
  }
  if (base21C !== 0) lines.push({ accID: omzetAccountFor(21), debitC: -base21C, desc: "Dagomzet 21%", docRef, vat: { rate: 21, amountDebitC: -btw21C } });
  if (base9C !== 0) lines.push({ accID: omzetAccountFor(9), debitC: -base9C, desc: "Dagomzet 9%", docRef, vat: { rate: 9, amountDebitC: -btw9C } });
  if (base0C !== 0) lines.push({ accID: omzetAccountFor(0), debitC: -base0C, desc: "Dagomzet 0%", docRef });
  const btwC = btw9C + btw21C;
  if (btwC !== 0) lines.push({ accID: ACC.btwTeBetalen, debitC: -btwC, desc: "BTW over dagomzet", docRef });
  const cashC = cents(t.cashAmount), pinC = cents(t.pinAmount), otherC = cents(t.otherAmount);
  if (cashC !== 0) lines.push({ accID: ACC.kas, debitC: cashC, desc: "Kasontvangst dagomzet", docRef });
  if (pinC !== 0) lines.push({ accID: ACC.kruisposten, debitC: pinC, desc: "Pin onderweg", docRef });
  if (otherC !== 0) lines.push({ accID: ACC.vraagposten, debitC: otherC, desc: "Overige ontvangst dagomzet", docRef });
  // The takings side rarely counts to the cent of the sales side (kasverschil). The difference is
  // a QUESTION, so it goes where questions go — visible, named, never smoothed into omzet.
  const diffC = salesC - (cashC + pinC + otherC);
  if (diffC !== 0) lines.push({ accID: ACC.vraagposten, debitC: diffC, desc: "Kasverschil Z-rapport", docRef });
  return { lines };
}

// ── XML ──────────────────────────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  // C0-stuurtekens eerst: een 0x1F uit een MT940-omschrijving maakt het bestand ONparseerbaar,
  // niet slechts ongeldig.
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function el(name: string, content: string): string {
  return `<${name}>${content}</${name}>`;
}

function monthOf(iso: string): number {
  const m = /^\d{4}-(\d{2})/.exec(iso);
  return m ? Number(m[1]) : 1;
}

const JOURNALS: Record<Entry["journal"], { desc: string; jrnTp: string }> = {
  VRK: { desc: "Verkoopboek", jrnTp: "S" },
  INK: { desc: "Inkoopboek", jrnTp: "P" },
  BNK: { desc: "Bankboek", jrnTp: "B" },
  KAS: { desc: "Kasboek", jrnTp: "C" },
  OMZ: { desc: "Dagomzet (Z-rapporten)", jrnTp: "M" },
};

/**
 * Build the complete auditfile. Sequencing, journal membership and the customer/supplier
 * sub-administration all happen here so the route stays a fetch-adapt-refuse pipeline.
 */
export function buildXafFile(input: XafInput): XafBuildResult {
  const skipped: XafSkipped[] = [];
  let turnoverWitnessCount = 0;

  // Sub-administration ids: sequential, sorted by name, ≤35 chars by construction (XAF's
  // IdentificationString35 — a raw uuid is 36 and would not validate).
  const customerNames = [...new Set(input.sales.map((s) => s.clientName ?? "Onbekende debiteur"))].sort();
  const supplierNames = [...new Set(input.purchases.map((p) => p.vendorName ?? "Onbekende crediteur"))].sort();
  const custId = new Map(customerNames.map((n, i) => [n, `D${String(i + 1).padStart(5, "0")}`]));
  const supId = new Map(supplierNames.map((n, i) => [n, `C${String(i + 1).padStart(5, "0")}`]));

  const entries: Entry[] = [];
  let nr = 0;
  const push = (journal: Entry["journal"], date: string, desc: string, built: { lines: Line[] } | { reason: string }, source: XafSkipped["source"], id: string) => {
    if ("reason" in built) { skipped.push({ source, id, reason: built.reason }); return; }
    if (!balanced(built.lines)) { skipped.push({ source, id, reason: "boeking balanceert niet — geweigerd" }); return; }
    entries.push({ nr: ++nr, journal, date, desc, lines: built.lines });
  };

  for (const inv of input.sales) {
    const name = inv.clientName ?? "Onbekende debiteur";
    const desc = inv.invoiceType === "creditnota" ? `Creditnota ${inv.invoiceNumber ?? inv.id}` : `Verkoopfactuur ${inv.invoiceNumber ?? inv.id}`;
    push("VRK", inv.invoiceDate ?? "", desc, buildSales(inv, custId.get(name)!), "verkoop", inv.id);
  }
  for (const inv of input.purchases) {
    const name = inv.vendorName ?? "Onbekende crediteur";
    push("INK", inv.invoiceDate ?? "", `Inkoopfactuur ${inv.invoiceNumber ?? inv.id}`, buildPurchase(inv, supId.get(name)!), "inkoop", inv.id);
  }
  const purchaseIds: ReadonlySet<string> = new Set(input.purchases.map((p) => p.id));
  const salesIds: ReadonlySet<string> = new Set(input.sales.map((p) => p.id));
  for (const tx of input.bank) {
    push("BNK", tx.date ?? "", (tx.description ?? "Bankmutatie").slice(0, 100), buildBank(tx), "bank", tx.id);
  }
  for (const row of input.cash) {
    const built = buildCash(row, purchaseIds, salesIds);
    if ("witness" in built) { turnoverWitnessCount++; continue; }
    push("KAS", row.date ?? "", row.direction === "in" ? "Kas in" : "Kas uit", built, "kas", row.id);
  }
  for (const t of input.turnover) {
    push("OMZ", t.date, `Dagomzet ${t.date}`, buildTurnoverDay(t), "dagomzet", t.date);
  }

  // File totals, in cents, from the lines actually emitted — and the file-level balance assertion.
  let totalDebitC = 0, totalCreditC = 0, lineCount = 0;
  for (const e of entries) for (const l of e.lines) {
    lineCount++;
    if (l.debitC >= 0) totalDebitC += l.debitC; else totalCreditC += -l.debitC;
  }
  if (totalDebitC !== totalCreditC) {
    // Unreachable while `balanced` guards every entry — but if it ever trips, the file must not
    // leave the building pretending to be an administration.
    throw new Error(`auditfile out of balance: D ${totalDebitC} C ${totalCreditC}`);
  }

  // ── Serialize, element order per the XSD ──
  const year = input.year;
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="utf-8"?>`);
  // [XAF-NIET-STIL] Wat NIET in dit bestand staat, staat erin.
  //
  // Elke weigering hierboven — geen datum, tarief niet herleidbaar, boeking balanceert niet —
  // haalt een post uit het auditbestand. Het bestand komt dan korter binnen en zegt niets, en dat
  // is precies het gevaarlijke geval: een auditbestand dat ONVOLLEDIG is ziet er exact zo uit als
  // een dat compleet is. De boekhouder importeert het, de aansluiting met de aangifte klopt niet,
  // en niemand weet waarom.
  //
  // Het aantal reisde al mee in een HTTP-header (X-Xaf-Skipped) — en beide plekken die dit bestand
  // ophalen zijn een gewone <a href>-downloadlink. Een browser die een bestand downloadt toont
  // geen responsheaders. Die kop bereikte dus niemand, en kon dat ook niet.
  //
  // Een XML-commentaar hoort niet tot de XAF-grammatica en wordt door elke importeur genegeerd,
  // dus het bestand blijft geldig — maar iedere mens die het openslaat ziet het meteen, boven aan
  // regel twee. Het is het enige kanaal dat zowel de machine als de mens overleeft.
  if (skipped.length > 0) {
    const perReden = new Map<string, number>();
    for (const s of skipped) perReden.set(s.reason, (perReden.get(s.reason) ?? 0) + 1);
    out.push(`<!--`);
    out.push(`  LET OP: ${skipped.length} post(en) staan NIET in dit auditbestand.`);
    for (const [reden, aantal] of [...perReden].sort((a, b) => b[1] - a[1])) {
      out.push(`    ${aantal}x  ${xmlCommentSafe(reden)}`);
    }
    out.push(`  Dit bestand sluit daardoor niet aan op de aangifte over dezelfde periode.`);
    out.push(`-->`);
  }
  out.push(`<auditfile xmlns="http://www.auditfiles.nl/XAF/3.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`);
  out.push("<header>");
  out.push(el("fiscalYear", String(year)));
  out.push(el("startDate", `${year}-01-01`));
  // [XAF-PERIODE] Never declare days that have not happened: "periods 6-12 empty" read as a fact
  // about the administration. The route clamps endDate to today.
  out.push(el("endDate", input.endDate));
  out.push(el("curCode", "EUR"));
  out.push(el("dateCreated", input.dateCreated));
  out.push(el("softwareDesc", "BoekBrug"));
  out.push(el("softwareVersion", "1.0"));
  out.push("</header>");
  out.push("<company>");
  // companyIdent is een VERPLICHT kind van company in XAF 3.2 — leeg element als de KvK ontbreekt,
  // nooit weggelaten (dan valideert het bestand niet en strandt de import als geheel).
  out.push(input.company.kvkNumber ? el("companyIdent", esc(input.company.kvkNumber)) : "<companyIdent/>");
  out.push(el("companyName", esc(input.company.name)));
  out.push(el("taxRegistrationCountry", "NL"));
  // taxRegIdent heeft GEEN minOccurs="0" in het 3.2-schema — een onderneming zonder BTW-nummer
  // (KOR-starter) kreeg een bestand dat als geheel niet valideerde. Leeg element, nooit weggelaten
  // — dezelfde regel als companyIdent hierboven, en per xmllint tegen het officiële XSD bevestigd.
  out.push(input.company.btwNumber ? el("taxRegIdent", esc(input.company.btwNumber)) : "<taxRegIdent/>");
  if (input.company.address || input.company.city) {
    out.push("<streetAddress>");
    if (input.company.address) out.push(el("streetname", esc(input.company.address)));
    // [XAF-LENGTE] Ook een String50 in het schema, en ook door de ondernemer zelf ingetypt.
    if (input.company.city) out.push(el("city", esc(input.company.city.slice(0, 50))));
    if (input.company.postalCode) out.push(el("postalCode", esc(input.company.postalCode)));
    out.push(el("country", "NL"));
    out.push("</streetAddress>");
  }
  out.push("<customersSuppliers>");
  for (const [name, id] of [...custId, ...supId]) {
    out.push("<customerSupplier>");
    out.push(el("custSupID", esc(id)));
    // [XAF-LENGTE] Geknipt op 50 tekens, en op de RUWE waarde — precies zoals docRef hieronder.
    //
    // custSupName is in XAF 3.2 een String50. Eén klant met een lange statutaire naam (een VvE, een
    // stichting: boven de vijftig tekens is doodgewoon) liet het HELE bestand afketsen bij elke
    // importeur die tegen het XSD valideert. De boekhouder krijgt dan niets — geen kleinere
    // administratie, maar geen administratie — en de ondernemer betaalt een middag handwerk.
    //
    // Knippen VOOR het escapen, niet erna: "&amp;" is één teken op papier en vijf in de string, en
    // een knip op de vijftigste STRING-positie hakt zo'n entiteit doormidden. Dat levert geen te
    // lange naam meer op maar wel ongeldige XML — dezelfde fout, luidruchtiger.
    out.push(el("custSupName", esc(name.slice(0, 50))));
    out.push(el("custSupTp", id.startsWith("D") ? "C" : "S"));
    out.push("</customerSupplier>");
  }
  out.push("</customersSuppliers>");
  out.push("<generalLedger>");
  for (const a of XAF_ACCOUNTS) {
    out.push("<ledgerAccount>");
    out.push(el("accID", a.accID));
    out.push(el("accDesc", esc(a.accDesc)));
    out.push(el("accTp", a.accTp));
    if (a.rgs) out.push(el("leadReference", a.rgs));
    out.push("</ledgerAccount>");
  }
  out.push("</generalLedger>");
  out.push("<vatCodes>");
  for (const v of [{ id: "V21", desc: "Leveringen/diensten 21%" }, { id: "V9", desc: "Leveringen/diensten 9%" }, { id: "V0", desc: "Leveringen/diensten 0%" }]) {
    out.push("<vatCode>");
    out.push(el("vatID", v.id));
    out.push(el("vatDesc", v.desc));
    out.push(el("vatToPayAccID", ACC.btwTeBetalen));
    out.push(el("vatToClaimAccID", ACC.voorbelasting));
    out.push("</vatCode>");
  }
  out.push("</vatCodes>");
  out.push("<periods>");
  // [XAF-PERIODE] Through today's month — AND through the latest month any entry actually names.
  // invoice_date is owner-entered, so a post-dated September invoice exists in an August file;
  // its periodNumber must be a DECLARED period or the file contradicts itself (schema-silently:
  // the XSD does not cross-check, so only an importer would trip over it).
  const lastEntryMonth = entries.reduce((mx, e) => Math.max(mx, monthOf(e.date) || 0), 0);
  const lastMonth = Math.max(monthOf(input.endDate) || 12, lastEntryMonth) || 12;
  for (let m = 1; m <= lastMonth; m++) {
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    out.push("<period>");
    out.push(el("periodNumber", String(m)));
    out.push(el("startDatePeriod", `${year}-${String(m).padStart(2, "0")}-01`));
    out.push(el("endDatePeriod", `${year}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`));
    out.push("</period>");
  }
  out.push("</periods>");
  out.push("<transactions>");
  out.push(el("linesCount", String(lineCount)));
  out.push(el("totalDebit", eur(totalDebitC)));
  out.push(el("totalCredit", eur(totalCreditC)));
  for (const j of Object.keys(JOURNALS) as Array<Entry["journal"]>) {
    const own = entries.filter((e) => e.journal === j);
    if (own.length === 0) continue;
    out.push("<journal>");
    out.push(el("jrnID", j));
    out.push(el("desc", JOURNALS[j].desc));
    out.push(el("jrnTp", JOURNALS[j].jrnTp));
    for (const e of own) {
      out.push("<transaction>");
      out.push(el("nr", String(e.nr)));
      out.push(el("desc", esc(e.desc)));
      out.push(el("periodNumber", String(monthOf(e.date))));
      out.push(el("trDt", e.date));
      let lineNr = 0;
      for (const l of e.lines) {
        out.push("<trLine>");
        out.push(el("nr", String(++lineNr)));
        out.push(el("accID", l.accID));
        out.push(el("docRef", esc(l.docRef.slice(0, 200))));
        out.push(el("effDate", e.date));
        out.push(el("desc", esc(l.desc)));
        out.push(el("amnt", eur(Math.abs(l.debitC))));
        out.push(el("amntTp", l.debitC >= 0 ? "D" : "C"));
        if (l.custSupID) out.push(el("custSupID", esc(l.custSupID)));
        if (l.vat) {
          out.push("<vat>");
          out.push(el("vatID", l.vat.rate === 21 ? "V21" : l.vat.rate === 9 ? "V9" : "V0"));
          out.push(el("vatPerc", `${l.vat.rate}.00`));
          out.push(el("vatAmnt", eur(Math.abs(l.vat.amountDebitC))));
          // Een 0%-regel draagt vatAmnt 0.00 met amountDebitC = -0, en -0 >= 0 is true — dan
          // stond er D tussen louter C-zusters. Nul volgt de kant van de REGEL.
          out.push(el("vatAmntTp", (l.vat.amountDebitC === 0 ? l.debitC : l.vat.amountDebitC) >= 0 ? "D" : "C"));
          out.push("</vat>");
        }
        out.push("</trLine>");
      }
      out.push("</transaction>");
    }
    out.push("</journal>");
  }
  out.push("</transactions>");
  out.push("</company>");
  for (const note of input.regimeNotes) {
    out.push(`<!-- BoekBrug LET OP: ${esc(note)} -->`);
  }
  if (skipped.length > 0) {
    const listed = skipped.slice(0, 50).map((s) => `${s.source}:${s.id} (${s.reason})`).join("; ");
    out.push(`<!-- BoekBrug: ${skipped.length} regel(s) niet opgenomen - ${esc(listed)}${skipped.length > 50 ? "; ..." : ""} -->`);
  }
  if (turnoverWitnessCount > 0) {
    out.push(`<!-- BoekBrug: ${turnoverWitnessCount} kasregel(s) overgeslagen als getuige van Z-dagomzet (zelfde regel als het resultaat: de kassa boekte die ontvangst al) -->`);
  }
  out.push("</auditfile>");

  return {
    xml: out.join("\n"),
    entryCount: entries.length,
    lineCount,
    totalDebit: totalDebitC / 100,
    totalCredit: totalCreditC / 100,
    skipped,
    turnoverWitnessCount,
  };
}
