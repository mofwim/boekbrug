// src/lib/xaf-ledger.ts
// [XAF] Double-entry ledger derivation — the format-independent half of the
// auditfile export. Pure: data in, balanced journal entries out. No I/O, no XML.
//
// WHY THIS LAYER EXISTS
// The app stores one-sided facts: an invoice, a bank line, a cash entry. Every
// auditfile standard (XAF 3.2, XAF 4.0.x, and the accountant's own import) wants
// the opposite: a chart of accounts plus transactions whose lines balance to the
// cent. That translation is the hard, app-specific part and it does NOT depend on
// which XAF version we end up serialising — so it lives here, on its own, fully
// tested. The XML envelope is a thin layer on top once the official XSD is at hand.
//
// RULES INHERITED FROM src/lib/snelstart-mapping.ts (one accounting truth, not two):
//   1. Only REAL bookings. An offerte / pro forma / concept is not a fact; booking
//      one makes the BTW return untrue. Same BOOKABLE_* status sets.
//   2. The BTW is never recomputed for an invoice — we book the STORED btw_amount.
//      Re-deriving it from a rate would silently disagree with the invoice itself.
//   3. The sum must add up. A cent of rounding noise is corrected on the largest
//      line; a real difference is an error and blocks the booking.
//   4. A creditnota is the same entry with every side reversed — not a separate kind.
//
// All money is handled in INTEGER CENTS. Floats cannot represent 0.1 exactly, and
// "the debits equal the credits" is the one property this file must never fumble.

// ─── Chart of accounts ────────────────────────────────────────────────────────
// A minimal Dutch scheme. Deliberately small: every account below is one the app
// can actually justify from its own data. Numbers follow the conventional Dutch
// layout so an accountant recognises them on sight.
// ⚠️ These are the numbers an accountant may want to align with their own scheme
//    (or RGS). They are declared ONCE here so that is a one-line change.

export type AccountType = "B" | "P"; // Balance sheet | Profit & loss

export interface LedgerAccount {
  id: string;
  description: string;
  type: AccountType;
}

export const LEDGER_ACCOUNTS: readonly LedgerAccount[] = [
  { id: "0900", description: "Privé", type: "B" },
  { id: "1000", description: "Kas", type: "B" },
  { id: "1100", description: "Bank", type: "B" },
  { id: "1300", description: "Debiteuren", type: "B" },
  { id: "1500", description: "Te betalen btw", type: "B" },
  { id: "1520", description: "Te vorderen btw", type: "B" },
  { id: "1600", description: "Crediteuren", type: "B" },
  { id: "1800", description: "Belastingen", type: "B" },
  { id: "4000", description: "Kosten", type: "P" },
  { id: "4700", description: "Bankkosten", type: "P" },
  { id: "8000", description: "Omzet", type: "P" },
] as const;

export const ACC = {
  prive: "0900",
  cash: "1000",
  bank: "1100",
  debtors: "1300",
  btwPayable: "1500",
  btwReclaimable: "1520",
  creditors: "1600",
  tax: "1800",
  costs: "4000",
  bankFees: "4700",
  revenue: "8000",
} as const;

// ─── Journals ─────────────────────────────────────────────────────────────────

export type JournalId = "V" | "I" | "B" | "K";

export interface Journal {
  id: JournalId;
  description: string;
}

export const JOURNALS: readonly Journal[] = [
  { id: "V", description: "Verkoop" },
  { id: "I", description: "Inkoop" },
  { id: "B", description: "Bank" },
  { id: "K", description: "Kas" },
] as const;

// ─── Entry model ──────────────────────────────────────────────────────────────

export type Side = "D" | "C";

export interface LedgerLine {
  accountId: string;
  /** Always POSITIVE, in cents. The direction lives in `side`, never in the sign. */
  amountCents: number;
  side: Side;
  description: string;
}

export interface LedgerEntry {
  journal: JournalId;
  /** Source row id — lets a reader trace an entry back to the record it came from. */
  sourceId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  description: string;
  /** Invoice number / payment reference, when the source has one. */
  docRef?: string;
  /** Counterparty, when known — feeds customersSuppliers in the auditfile. */
  relation?: string;
  lines: LedgerLine[];
}

/** A source row that could NOT be booked, and why. Never silently dropped. */
export interface LedgerSkip {
  sourceId: string;
  kind: "invoice" | "bank" | "cash";
  /** Dutch, shown to the owner — this is the "what do I fix?" text. */
  reason: string;
}

// ─── Money helpers ────────────────────────────────────────────────────────────

/** Euro (float, as stored) → integer cents. Rounds half away from zero. */
export function toCents(amount: number | null | undefined): number {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.abs(n) * 100) * (n < 0 ? -1 : 1);
}

/** Sum of one side of an entry, in cents. */
export function sideTotal(entry: LedgerEntry, side: Side): number {
  return entry.lines.reduce((s, l) => s + (l.side === side ? l.amountCents : 0), 0);
}

/** The invariant this whole file exists to guarantee. */
export function isBalanced(entry: LedgerEntry): boolean {
  return sideTotal(entry, "D") === sideTotal(entry, "C");
}

/**
 * Absorb a rounding cent on the LARGEST line of the given side, so an entry that
 * is off by ≤ `tolerance` cents balances exactly. Same rule the SnelStart mapping
 * uses. Returns false when the gap is bigger than the tolerance — that is a real
 * difference and the caller must refuse to book it.
 */
function absorbRounding(entry: LedgerEntry, tolerance = 1): boolean {
  const diff = sideTotal(entry, "D") - sideTotal(entry, "C");
  if (diff === 0) return true;
  if (Math.abs(diff) > tolerance) return false;
  // Too much debit → shave the biggest debit line, and vice versa.
  const side: Side = diff > 0 ? "D" : "C";
  const candidates = entry.lines.filter((l) => l.side === side);
  if (candidates.length === 0) return false;
  const biggest = candidates.reduce((a, b) => (b.amountCents > a.amountCents ? b : a));
  biggest.amountCents -= Math.abs(diff);
  return isBalanced(entry);
}

// ─── Source shapes ────────────────────────────────────────────────────────────
// Decoupled from database.types on purpose (same reason snelstart-mapping.ts is):
// this file stays testable without a database and without generated types.

export interface LedgerInvoice {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_type: string | null; // 'factuur' | 'creditnota' | 'pro_forma'
  direction: string | null; // 'outgoing' | 'incoming'
  status: string | null;
  client_name: string | null;
  total_ex_btw: number | null;
  btw_amount: number | null;
  total_inc_btw: number | null;
}

export interface LedgerBankTx {
  id: string;
  date: string | null;
  amount: number | null; // SIGNED: negative = money out
  description: string | null;
  counterpart_name: string | null;
  reference: string | null;
  category: string | null;
  invoice_id: string | null;
}

export interface LedgerCashEntry {
  id: string;
  entry_date: string | null;
  direction: string | null; // 'in' | 'out'
  amount: number | null; // positive
  category: string | null;
  description: string | null;
  btw_rate: number | null;
}

// Same status gates as the SnelStart push — see rule 1.
const BOOKABLE_OUTGOING = new Set(["sent", "paid", "overdue"]);
const BOOKABLE_INCOMING = new Set(["received", "processed", "paid"]);

// ─── Invoices ─────────────────────────────────────────────────────────────────

/**
 * Outgoing (Verkoop, journal V):   D Debiteuren / C Omzet + C Te betalen btw
 * Incoming (Inkoop,  journal I):   D Kosten + D Te vorderen btw / C Crediteuren
 * A creditnota is the same entry with every side flipped (rule 4).
 *
 * Returns a skip — never a guess — when the row is not a real booking, has no
 * date, or when ex + btw does not add up to the invoice total (rule 3).
 */
export function deriveInvoiceEntry(inv: LedgerInvoice): LedgerEntry | LedgerSkip {
  const skip = (reason: string): LedgerSkip => ({ sourceId: inv.id, kind: "invoice", reason });

  const type = inv.invoice_type ?? "factuur";
  if (type !== "factuur" && type !== "creditnota") {
    return skip("Geen echte boeking (offerte of pro forma) — die hoort niet in de administratie.");
  }

  const status = inv.status ?? "";
  const direction = inv.direction;
  if (direction === "outgoing") {
    if (!BOOKABLE_OUTGOING.has(status)) return skip(`Status "${status || "onbekend"}" is nog geen boeking.`);
  } else if (direction === "incoming") {
    if (!BOOKABLE_INCOMING.has(status)) return skip(`Status "${status || "onbekend"}" is nog geen boeking.`);
  } else {
    // Without a direction we cannot tell revenue from cost — the one distinction
    // the BTW return is made of. Refusing is the only honest answer.
    return skip("Geen richting bekend — we weten niet of dit omzet of kosten is.");
  }

  const date = (inv.invoice_date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return skip("Geen geldige factuurdatum.");

  // Rule 2: book the STORED btw, never a recomputed one.
  const ex = Math.abs(toCents(inv.total_ex_btw));
  const btw = Math.abs(toCents(inv.btw_amount));
  const inc = Math.abs(toCents(inv.total_inc_btw));
  if (inc === 0 && ex === 0) return skip("Bedrag is nul — niets te boeken.");

  const isCredit = type === "creditnota";
  const flip = (s: Side): Side => (isCredit ? (s === "D" ? "C" : "D") : s);
  const label = `${inv.invoice_number ?? "zonder nummer"} · ${inv.client_name ?? "onbekende relatie"}`;

  const entry: LedgerEntry = {
    journal: direction === "outgoing" ? "V" : "I",
    sourceId: inv.id,
    date,
    description: label,
    docRef: inv.invoice_number ?? undefined,
    relation: inv.client_name ?? undefined,
    lines:
      direction === "outgoing"
        ? [
            { accountId: ACC.debtors, amountCents: inc, side: flip("D"), description: label },
            { accountId: ACC.revenue, amountCents: ex, side: flip("C"), description: label },
            ...(btw > 0
              ? [{ accountId: ACC.btwPayable, amountCents: btw, side: flip("C"), description: `Btw ${label}` }]
              : []),
          ]
        : [
            { accountId: ACC.costs, amountCents: ex, side: flip("D"), description: label },
            ...(btw > 0
              ? [{ accountId: ACC.btwReclaimable, amountCents: btw, side: flip("D"), description: `Btw ${label}` }]
              : []),
            { accountId: ACC.creditors, amountCents: inc, side: flip("C"), description: label },
          ],
  };

  if (!absorbRounding(entry)) {
    return skip(
      `De bedragen kloppen niet: excl. btw + btw is niet gelijk aan het totaal (${(ex / 100).toFixed(2)} + ${(btw / 100).toFixed(2)} ≠ ${(inc / 100).toFixed(2)}).`
    );
  }
  return entry;
}

// ─── Bank ─────────────────────────────────────────────────────────────────────

// Which account sits opposite the bank for each category the app knows.
// `null` = the app has no honest answer, so the line is skipped, never guessed.
const BANK_COUNTER_ACCOUNT: Record<string, string | null> = {
  omzet: ACC.revenue,
  pos_income: ACC.revenue,
  kosten: ACC.costs,
  fee: ACC.bankFees,
  prive: ACC.prive,
  transfer: ACC.cash, // moving money between the drawer and the bank
  tax: ACC.tax,
};

/**
 * Bank line (journal B). Money in → D Bank / C counter; money out → the reverse.
 *
 * When the line is matched to an invoice, the counter account is the receivable
 * or payable it settles — booking it as revenue/cost again would count the same
 * euro twice. Unmatched and uncategorised lines are skipped with a reason.
 */
export function deriveBankEntry(tx: LedgerBankTx): LedgerEntry | LedgerSkip {
  const skip = (reason: string): LedgerSkip => ({ sourceId: tx.id, kind: "bank", reason });

  const date = (tx.date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return skip("Geen geldige datum.");

  const signed = toCents(tx.amount);
  if (signed === 0) return skip("Bedrag is nul — niets te boeken.");
  const amount = Math.abs(signed);
  const incoming = signed > 0;

  // A matched line settles a receivable/payable; it is not new revenue or cost.
  let counter: string | null;
  if (tx.invoice_id) {
    counter = incoming ? ACC.debtors : ACC.creditors;
  } else {
    const cat = tx.category ?? "";
    counter = cat in BANK_COUNTER_ACCOUNT ? BANK_COUNTER_ACCOUNT[cat] : null;
  }
  if (!counter) {
    return skip("Nog geen categorie — we weten niet waar deze transactie tegenover staat.");
  }

  const label = tx.counterpart_name?.trim() || tx.description?.trim() || "Banktransactie";
  return {
    journal: "B",
    sourceId: tx.id,
    date,
    description: label,
    docRef: tx.reference ?? undefined,
    relation: tx.counterpart_name ?? undefined,
    lines: [
      { accountId: ACC.bank, amountCents: amount, side: incoming ? "D" : "C", description: label },
      { accountId: counter, amountCents: amount, side: incoming ? "C" : "D", description: label },
    ],
  };
}

// ─── Cash ─────────────────────────────────────────────────────────────────────

const CASH_COUNTER_ACCOUNT: Record<string, string | null> = {
  omzet: ACC.revenue,
  kosten: ACC.costs,
  prive: ACC.prive,
  transfer: ACC.bank, // the other side of a deposit/withdrawal
};

/**
 * Cash entry (journal K). Unlike an invoice, a cash row stores a RATE, not a btw
 * amount — so here the split is computed from the gross amount, and the rounding
 * cent is absorbed so the entry still balances exactly.
 * Privé and transfer never carry btw.
 */
export function deriveCashEntry(e: LedgerCashEntry): LedgerEntry | LedgerSkip {
  const skip = (reason: string): LedgerSkip => ({ sourceId: e.id, kind: "cash", reason });

  const date = (e.entry_date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return skip("Geen geldige datum.");

  const gross = Math.abs(toCents(e.amount));
  if (gross === 0) return skip("Bedrag is nul — niets te boeken.");

  const dir = e.direction;
  if (dir !== "in" && dir !== "out") return skip("Geen richting bekend (in of uit de kas).");

  const cat = e.category ?? "";
  const counter = cat in CASH_COUNTER_ACCOUNT ? CASH_COUNTER_ACCOUNT[cat] : null;
  if (!counter) return skip("Nog geen categorie — we weten niet waar deze kasboeking tegenover staat.");

  const label = e.description?.trim() || "Kasboeking";
  const cashSide: Side = dir === "in" ? "D" : "C";
  const counterSide: Side = dir === "in" ? "C" : "D";

  // Btw only applies to revenue and costs — never to privé or a transfer.
  const rate = Number(e.btw_rate ?? 0);
  const withBtw = (counter === ACC.revenue || counter === ACC.costs) && Number.isFinite(rate) && rate > 0;
  const net = withBtw ? Math.round(gross / (1 + rate / 100)) : gross;
  const btw = gross - net;

  const entry: LedgerEntry = {
    journal: "K",
    sourceId: e.id,
    date,
    description: label,
    lines: [
      { accountId: ACC.cash, amountCents: gross, side: cashSide, description: label },
      { accountId: counter, amountCents: net, side: counterSide, description: label },
      ...(withBtw && btw > 0
        ? [
            {
              accountId: counter === ACC.revenue ? ACC.btwPayable : ACC.btwReclaimable,
              amountCents: btw,
              side: counterSide,
              description: `Btw ${label}`,
            },
          ]
        : []),
    ],
  };

  if (!absorbRounding(entry)) return skip("De btw-splitsing komt niet uit op het kasbedrag.");
  return entry;
}

// ─── Assembling the ledger ────────────────────────────────────────────────────

export interface Ledger {
  accounts: LedgerAccount[];
  journals: Journal[];
  entries: LedgerEntry[];
  skipped: LedgerSkip[];
  /** Control totals — the auditfile header carries these, and they must match. */
  totals: { lineCount: number; debitCents: number; creditCents: number };
}

export interface LedgerSources {
  invoices?: LedgerInvoice[];
  bank?: LedgerBankTx[];
  cash?: LedgerCashEntry[];
}

function isSkip(x: LedgerEntry | LedgerSkip): x is LedgerSkip {
  return (x as LedgerSkip).reason !== undefined;
}

/**
 * Derive the whole ledger for a period. Only the accounts that are actually USED
 * are returned: an auditfile listing a Kas account for someone who never touches
 * cash invites a question that has no answer.
 *
 * Entries are ordered by date (then journal, then source id) so two exports of the
 * same data are byte-identical — a diffable file is a checkable file.
 */
export function buildLedger(sources: LedgerSources): Ledger {
  const entries: LedgerEntry[] = [];
  const skipped: LedgerSkip[] = [];

  const collect = (r: LedgerEntry | LedgerSkip) => (isSkip(r) ? skipped.push(r) : entries.push(r));
  for (const inv of sources.invoices ?? []) collect(deriveInvoiceEntry(inv));
  for (const tx of sources.bank ?? []) collect(deriveBankEntry(tx));
  for (const c of sources.cash ?? []) collect(deriveCashEntry(c));

  entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.journal.localeCompare(b.journal) || a.sourceId.localeCompare(b.sourceId)
  );

  const used = new Set<string>();
  let debitCents = 0;
  let creditCents = 0;
  let lineCount = 0;
  for (const e of entries) {
    for (const l of e.lines) {
      used.add(l.accountId);
      lineCount += 1;
      if (l.side === "D") debitCents += l.amountCents;
      else creditCents += l.amountCents;
    }
  }

  return {
    accounts: LEDGER_ACCOUNTS.filter((a) => used.has(a.id)),
    journals: JOURNALS.filter((j) => entries.some((e) => e.journal === j.id)),
    entries,
    skipped,
    totals: { lineCount, debitCents, creditCents },
  };
}

/**
 * The whole-ledger invariant: every single entry balances AND the control totals
 * agree. A caller must refuse to write an auditfile when this is false — a file
 * whose debits and credits disagree is rejected by every reader that matters.
 */
export function ledgerIsBalanced(ledger: Ledger): boolean {
  return ledger.totals.debitCents === ledger.totals.creditCents && ledger.entries.every(isBalanced);
}
