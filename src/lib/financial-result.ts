// src/lib/financial-result.ts
// [RESULT] Phase 3 — the true quarterly result across ALL channels: sales invoices,
// purchase invoices/receipts, owner-categorized bank lines, and the cash book. Pure,
// fully testable (run: npx tsx src/lib/financial-result.test.ts).
//
// The whole point is HONESTY, so double-counting is the enemy. The de-dup rules:
//   - A bank line with invoice_id set is the PAYMENT of an invoice already counted →
//     excluded. (Reconciliation, not a second cost/revenue.)
//   - A bank line with no confirmed category is NOT guessed into a money total.
//   - Transfers / prive / tax / fee never touch revenue or cost.
//
// BTW stays documented: verschuldigde BTW from sales invoices + cash sales where the
// owner set a rate; voorbelasting ONLY from purchase invoices/receipts (a bare bank or
// cash line has no valid BTW document, so none is claimed). Cash sales recorded without
// a rate are surfaced separately (cashOmzetZonderBtw) rather than silently guessed.

export interface ResultInvoice {
  direction: "outgoing" | "incoming" | null;
  status: string | null;
  total_ex_btw: number | null;
  btw_amount: number | null;
}
export interface ResultBankTx {
  amount: number | null;       // signed: + credit, − debit
  category: string | null;      // null = uncategorized (not counted)
  invoice_id: string | null;    // set = payment of an already-counted invoice
}
export interface ResultCashEntry {
  direction: "in" | "out";
  amount: number | null;        // always positive
  category: string | null;
  btw_rate: number | null;      // only set for a cash sale the owner rated
}

export interface FinancialResult {
  omzet: number;              // revenue, ex-BTW (net)
  kosten: number;             // costs, ex-BTW (net)
  resultaat: number;          // omzet − kosten
  btwVerschuldigd: number;    // BTW you owe (sales)
  btwVoorbelasting: number;   // BTW you reclaim (documented purchases)
  btwSaldo: number;           // verschuldigd − voorbelasting (what you pay/receive)
  cashOmzetZonderBtw: number; // cash sales recorded without a BTW rate — a nudge, not counted in BTW
}

// Verified statuses that count (mirrors buildZzpSummary 'all' mode): outgoing that
// has left the door, incoming the owner has confirmed. Unverified ('processing',
// 'draft') never counts.
const OUTGOING_OK = new Set(["paid", "sent", "overdue"]);
const INCOMING_OK = new Set(["paid", "received"]);

export function computeResult(
  invoices: ResultInvoice[],
  bankTx: ResultBankTx[],
  cashEntries: ResultCashEntry[],
): FinancialResult {
  let omzet = 0;
  let kosten = 0;
  let btwVerschuldigd = 0;
  let btwVoorbelasting = 0;
  let cashOmzetZonderBtw = 0;

  // 1) Invoices — the BTW-exact core.
  for (const inv of invoices) {
    const ex = inv.total_ex_btw ?? 0;
    const btw = inv.btw_amount ?? 0;
    const st = inv.status ?? "";
    if (inv.direction === "outgoing" && OUTGOING_OK.has(st)) {
      omzet += ex;
      btwVerschuldigd += btw;
    } else if (inv.direction === "incoming" && INCOMING_OK.has(st)) {
      kosten += ex;
      btwVoorbelasting += btw;
    }
  }

  // 2) Owner-categorized bank lines that are NOT invoice payments. A bare bank line
  //    carries no valid BTW document, so it moves net revenue/cost only — no BTW.
  for (const t of bankTx) {
    if (t.invoice_id) continue;   // payment of an already-counted invoice
    if (!t.category) continue;     // uncategorized → never guessed into a total
    const amt = Math.abs(t.amount ?? 0);
    if (t.category === "omzet") omzet += amt;
    else if (t.category === "kosten") kosten += amt;
    // transfer / prive / tax / fee → excluded
  }

  // 3) Cash book.
  for (const c of cashEntries) {
    const amt = c.amount ?? 0;
    if (c.category === "omzet") {
      if (c.btw_rate && c.btw_rate > 0) {
        const net = amt / (1 + c.btw_rate / 100);
        omzet += net;
        btwVerschuldigd += amt - net;
      } else {
        omzet += amt;
        cashOmzetZonderBtw += amt; // no rate → counted as revenue, flagged for BTW
      }
    } else if (c.category === "kosten") {
      kosten += amt; // cash expense; no voorbelasting without a bon rate
    }
    // transfer / prive → excluded
  }

  return {
    omzet,
    kosten,
    resultaat: omzet - kosten,
    btwVerschuldigd,
    btwVoorbelasting,
    btwSaldo: btwVerschuldigd - btwVoorbelasting,
    cashOmzetZonderBtw,
  };
}
