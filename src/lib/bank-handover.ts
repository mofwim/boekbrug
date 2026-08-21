// src/lib/bank-handover.ts
// [AFLETTEREN] The bank statement, with each line's invoice already beside it.
// Run: npx tsx --test src/lib/bank-handover.test.ts
//
// ── WHY THIS IS THE FILE THAT CONVINCES AN ACCOUNTANT ──
//
// The quarter package hands over the documents and the statement. Both are things the accountant
// could have collected himself; handing them over neatly saves him an errand, not an afternoon.
//
// His afternoon goes to AFLETTEREN: walking down a bank statement and deciding, per line, which
// invoice it pays. It is slow because it needs BOTH sides at once — the statement and the whole
// invoice ledger — and it is the one job in the quarter that a pile of PDFs cannot help with.
//
// BoekBrug already does it. Every payment matched to an invoice is stored on the bank line
// (bank_transactions.invoice_id), by a matcher whose confident matches were auto-confirmed and
// whose doubtful ones the owner answered by hand. And until now none of that left the app: the
// accountant received the raw statement and redid, line by line, work that was already finished.
//
// So this file is not a summary of what BoekBrug thinks. It is the finished part of his job.
//
// ── AND WHY IT LEADS WITH WHAT IS *NOT* DONE ──
//
// A reconciliation that only shows its successes is worthless to a professional: he cannot tell
// whether the twelve lines he sees are all there were. So the unmatched lines come FIRST, they
// are counted in euros as well as in rows, and every matched line carries the DIFFERENCE between
// what the bank moved and what the invoice says. A difference is not always an error — a partial
// payment is legitimate — but it is always something he must look at, and hiding it would turn
// this file from a head start into a thing he has to re-check from scratch, which is worse than
// not receiving it.
//
// Dutch, like every other document in the package: the reader is a Dutch boekhouder.

import { csvCell } from "./csv-safe";
import { formatEuroNL } from "./format-nl";
// [CENT] Rounding to cents is defined in exactly ONE place in this codebase, and the gate that
// says so caught this file for writing its own. Which is the right catch: a difference between a
// bank line and an invoice is a money figure, and a second rounding rule is how two files that
// describe the same payment come to disagree by a cent.
import { round2 } from "./invoice-totals";

/** One bank line, as much of it as the hand-over needs. */
export type HandoverTx = {
  date?: string | null;
  amount?: number | null;
  counterpart_name?: string | null;
  description?: string | null;
  reference?: string | null;
  /** 'matched' once a payment is tied to an invoice; anything else is still open. */
  status?: string | null;
  invoice_id?: string | null;
};

/** The invoice a line may point at. */
export type HandoverInvoice = {
  invoice_number?: string | null;
  client_name?: string | null;
  total_inc_btw?: number | null;
  direction?: string | null;
};

export type HandoverTotals = {
  lines: number;
  matched: number;
  unmatched: number;
  /** Money on lines with an invoice, and money on lines without — both absolute. */
  matchedAmount: number;
  unmatchedAmount: number;
  /** Matched lines whose amount does not equal the invoice's. Never folded into `matched`. */
  withDifference: number;
};

const eur = (n: number) => formatEuroNL(n);
const esc = (v: string | number) => csvCell(v);

/**
 * What the reconciliation adds up to.
 *
 * Separate from the CSV because the numbers belong in overzicht.json and in the LEESMIJ too, and
 * a total that is computed twice is a total that will one day disagree with itself.
 */
export function bankHandoverTotals(
  transactions: readonly HandoverTx[],
  invoiceById: ReadonlyMap<string, HandoverInvoice>,
): HandoverTotals {
  let matched = 0, unmatched = 0, matchedAmount = 0, unmatchedAmount = 0, withDifference = 0;
  for (const tx of transactions) {
    const amount = Math.abs(Number(tx.amount ?? 0));
    if (tx.invoice_id) {
      matched += 1;
      matchedAmount += amount;
      const inv = invoiceById.get(tx.invoice_id);
      // An invoice we do not hold (paid this quarter, issued in an earlier one) is matched, and
      // its difference is unknowable here — which is not the same as zero, so it is not counted.
      if (inv && round2(Math.abs(Number(inv.total_inc_btw ?? 0)) - amount) !== 0) withDifference += 1;
    } else {
      unmatched += 1;
      unmatchedAmount += amount;
    }
  }
  return {
    lines: transactions.length,
    matched,
    unmatched,
    matchedAmount: round2(matchedAmount),
    unmatchedAmount: round2(unmatchedAmount),
    withDifference,
  };
}

/**
 * The reconciliation as the accountant's CSV.
 *
 * `read: false` is the bank read having FAILED, and it produces a file that says so and carries no
 * table at all. An empty table here would read as "every line is accounted for" on a quarter where
 * we could not look — the one lie this package must never tell.
 */
export function buildBankHandoverCsv(args: {
  quarterLabel: string;
  transactions: readonly HandoverTx[];
  invoiceById: ReadonlyMap<string, HandoverInvoice>;
  read: boolean;
}): string {
  const { quarterLabel, transactions, invoiceById, read } = args;
  const lines: string[] = [];

  lines.push(esc(`BoekBrug — Bankafletering ${quarterLabel}`));
  lines.push("");

  if (!read) {
    lines.push(esc("De bankregels konden niet worden gelezen. Er staat hieronder dus GEEN overzicht —"));
    lines.push(esc("niet omdat alles gekoppeld is, maar omdat we het niet hebben kunnen nakijken."));
    return lines.join("\r\n");
  }

  const t = bankHandoverTotals(transactions, invoiceById);
  lines.push(esc("Wat er al gekoppeld is"));
  lines.push([esc("Bankregels in dit kwartaal"), esc(t.lines)].join(";"));
  lines.push([esc("Gekoppeld aan een factuur"), esc(t.matched), esc(eur(t.matchedAmount))].join(";"));
  lines.push([esc("Nog te koppelen"), esc(t.unmatched), esc(eur(t.unmatchedAmount))].join(";"));
  lines.push([esc("Gekoppeld, maar bedrag wijkt af"), esc(t.withDifference)].join(";"));
  lines.push("");
  lines.push(esc("De regels die nog te koppelen zijn, staan bovenaan. Een afwijkend bedrag is niet per se"));
  lines.push(esc("fout — een deelbetaling hoort er ook zo uit te zien — maar het is wel iets om na te kijken."));
  lines.push("");

  lines.push(
    ["Status", "Datum", "Bedrag", "Tegenpartij", "Omschrijving", "Kenmerk", "Factuurnummer", "Op naam van", "Factuurbedrag", "Verschil"]
      .map(esc)
      .join(";"),
  );

  // Open lines first: that is the work that is left, and a professional needs to see its size
  // before he is shown what is done. Within each group, oldest first — the order he walks the
  // statement in anyway.
  const byDate = (a: HandoverTx, b: HandoverTx) => (a.date ?? "").localeCompare(b.date ?? "");
  const open = transactions.filter((tx) => !tx.invoice_id).sort(byDate);
  const done = transactions.filter((tx) => !!tx.invoice_id).sort(byDate);

  for (const tx of [...open, ...done]) {
    const amount = Number(tx.amount ?? 0);
    const inv = tx.invoice_id ? invoiceById.get(tx.invoice_id) : undefined;

    let status: string;
    let invNumber = "—", invName = "—", invAmount = "—", verschil = "—";
    if (!tx.invoice_id) {
      status = "Nog te koppelen";
    } else if (!inv) {
      // Linked to an invoice outside this quarter — a January invoice paid in April. Saying so is
      // more useful than an empty cell, which reads like a broken link.
      status = "Gekoppeld (factuur buiten dit kwartaal)";
    } else {
      const invTotal = Math.abs(Number(inv.total_inc_btw ?? 0));
      const diff = round2(invTotal - Math.abs(amount));
      status = diff === 0 ? "Gekoppeld" : "Gekoppeld — bedrag wijkt af";
      invNumber = inv.invoice_number ?? "—";
      invName = inv.client_name ?? "—";
      invAmount = eur(invTotal);
      verschil = diff === 0 ? "—" : eur(diff);
    }

    lines.push(
      [
        status,
        tx.date ?? "—",
        eur(amount),
        tx.counterpart_name ?? "—",
        tx.description ?? "—",
        tx.reference ?? "—",
        invNumber,
        invName,
        invAmount,
        verschil,
      ]
        .map(esc)
        .join(";"),
    );
  }

  return lines.join("\r\n");
}
