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

import { pnlRole } from "./bank-categories";
import { turnoverNetOmzet, turnoverBtw, type DailyTurnover } from "./turnover";

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
  // [TURNOVER] For a pos_income line: the takings day it settled (parsed DAT date, or the
  // booking date as a fallback). Used to exclude it on days the till already counted.
  settleDate?: string | null;
}
export interface ResultCashEntry {
  direction: "in" | "out";
  amount: number | null;        // always positive
  category: string | null;
  btw_rate: number | null;      // only set for a cash sale the owner rated
  date?: string | null;         // [TURNOVER] entry_date — for the covered-day check
}

export interface FinancialResult {
  omzet: number;              // revenue, ex-BTW (net)
  kosten: number;             // costs, ex-BTW (net)
  resultaat: number;          // omzet − kosten
  btwVerschuldigd: number;    // BTW you owe (sales)
  btwVoorbelasting: number;   // BTW you reclaim (documented purchases)
  btwSaldo: number;           // verschuldigd − voorbelasting (what you pay/receive)
  cashOmzetZonderBtw: number; // cash sales recorded without a BTW rate — a nudge, not counted in BTW
  // [TURNOVER] BTW verschuldigd from the till Z-report, split per rate for aangifte
  // rubriek 1a (21%) / 1b (9%). Turnover-only: invoice/cash BTW is NOT yet rate-split
  // here, so these do NOT sum to btwVerschuldigd — that scalar stays the authoritative
  // grand total across all sources.
  turnoverBtw9: number;
  turnoverBtw21: number;
  // [AANGIFTE] Verschuldigde BTW + omzet split per rate across ALL sales sources
  // (turnover + outgoing invoices + rated cash). Its BTW sums EXACTLY to btwVerschuldigd
  // (unrounded), so it is the single source for aangifte rubriek 1a (21%) / 1b (9%) /
  // 1e (0%) / 1c (other). Unrated cash sales are NOT bucketed here — see
  // cashOmzetZonderBtw — because we never guess a rate.
  salesByRate: SalesRateBucket[];
}

export interface SalesRateBucket { rate: number; omzet: number; btw: number }

// Verified statuses that count (mirrors buildZzpSummary 'all' mode): outgoing that
// has left the door, incoming the owner has confirmed. Unverified ('processing',
// 'draft') never counts.
const OUTGOING_OK = new Set(["paid", "sent", "overdue"]);
const INCOMING_OK = new Set(["paid", "received"]);

export function computeResult(
  invoices: ResultInvoice[],
  bankTx: ResultBankTx[],
  cashEntries: ResultCashEntry[],
  turnover: DailyTurnover[] = [],
  coveredDates?: Set<string>,
  // [TRIANGLE] Acquirer commission booked as a cost. The till counts card takings GROSS
  // (in `turnover`) while the bank pays out NET, so the acquirer's fee is otherwise never
  // a cost and profit is overstated. reconcileTriangle derives this from EFT gross − bank
  // net. IMPORTANT: pass it NET of any acquirer fee INVOICE already in `invoices` — else
  // the same fee is counted twice. The caller (route) owns that de-dup; here it is a plain
  // cost with no BTW (the reclaimable BTW comes from the acquirer's invoice, not invented).
  acquirerCommission = 0,
): FinancialResult {
  let omzet = 0;
  let kosten = 0;
  let btwVerschuldigd = 0;
  let btwVoorbelasting = 0;
  let cashOmzetZonderBtw = 0;
  let turnoverBtw9 = 0;
  let turnoverBtw21 = 0;

  // [AANGIFTE] Sales BTW per rate, accumulated across every sales source. Kept unrounded
  // so the per-rate BTW sums back to btwVerschuldigd with no drift.
  const salesRate = new Map<number, { omzet: number; btw: number }>();
  const addSale = (rate: number, omzetEx: number, btw: number) => {
    const cur = salesRate.get(rate) ?? { omzet: 0, btw: 0 };
    cur.omzet += omzetEx;
    cur.btw += btw;
    salesRate.set(rate, cur);
  };

  // [TURNOVER] Days for which the till Z-report IS the authoritative revenue. On such a
  // day the bank's pos_income settlement and the cash-book omzet are the SAME money,
  // already counted once via turnover — so they become reconciliation witnesses, not
  // extra revenue (mirrors the invoice_id → payment rule). Only days with real revenue
  // suppress: a zero/empty turnover row must never hide a real settlement. The caller MAY
  // pass a WIDER covered set than `turnover` (dates from the prior quarter whose card
  // takings settle into this one) so cross-quarter settlements are not double-counted.
  const covered =
    coveredDates ??
    new Set(
      turnover
        .filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0)
        .map((t) => t.turnover_date),
    );

  // 1) Invoices — the BTW-exact core.
  for (const inv of invoices) {
    const ex = inv.total_ex_btw ?? 0;
    const btw = inv.btw_amount ?? 0;
    const st = inv.status ?? "";
    if (inv.direction === "outgoing" && OUTGOING_OK.has(st)) {
      omzet += ex;
      btwVerschuldigd += btw;
      // Rate derived exactly like calcBtwRate (export.ts) — the header stores no rate.
      // Guard is `ex !== 0` (not `> 0`): a creditnota has NEGATIVE ex+btw, and
      // round(-249/-1185*100)=21 buckets it to the same rate so it NETS the rubriek
      // instead of falling to rate-0 and over-declaring BTW.
      addSale(ex !== 0 ? Math.round((btw / ex) * 100) : 0, ex, btw);
    } else if (inv.direction === "incoming" && INCOMING_OK.has(st)) {
      kosten += ex;
      btwVoorbelasting += btw;
    }
  }

  // 2) Owner-categorized bank lines that are NOT invoice payments. A bare bank line
  //    carries no valid BTW document, so it moves net revenue/cost only — no BTW.
  //    The category → P&L role comes from the single source of truth (bank-categories),
  //    so pos_income (card-terminal / PSP takings) lands on revenue like omzet.
  for (const t of bankTx) {
    if (t.invoice_id) continue;   // payment of an already-counted invoice
    if (!t.category) continue;     // uncategorized → never guessed into a total
    // [TURNOVER] pos_income that settled a day the Z-report already counted is that day's
    // takings, not new revenue → witness only. Keyed strictly on the takings date
    // (settleDate), and ONLY for pos_income — a manually-set 'omzet' line still counts.
    if (t.category === "pos_income" && t.settleDate && covered.has(t.settleDate)) continue;
    const amt = Math.abs(t.amount ?? 0);
    const role = pnlRole(t.category);
    if (role === "omzet") omzet += amt;
    else if (role === "kosten") kosten += amt;
    // transfer / prive / tax / fee → excluded
  }

  // 3) Cash book.
  for (const c of cashEntries) {
    const amt = c.amount ?? 0;
    if (c.category === "omzet") {
      // [TURNOVER] cash omzet on a covered day is part of the till turnover already
      // counted — exclude it from omzet, BTW, AND the no-rate nudge (all three).
      // Fail-SAFE on a missing date: a store that USES turnover (covered non-empty) has
      // its cash sales inside the Z-report, so a dateless cash omzet is treated as covered
      // rather than double-counted; a ZZP (no turnover → covered empty) still counts it.
      if (c.date ? covered.has(c.date) : covered.size > 0) continue;
      if (c.btw_rate && c.btw_rate > 0) {
        const net = amt / (1 + c.btw_rate / 100);
        omzet += net;
        btwVerschuldigd += amt - net;
        addSale(c.btw_rate, net, amt - net);
      } else {
        omzet += amt;
        cashOmzetZonderBtw += amt; // no rate → counted as revenue, flagged for BTW
      }
    } else if (c.category === "kosten") {
      kosten += amt; // cash expense; no voorbelasting without a bon rate
    }
    // transfer / prive → excluded
  }

  // 4) Till Z-report — the retail store's authoritative revenue, per BTW rate. Its
  //    matching bank pos_income + cash omzet were already excluded above (covered days).
  for (const t of turnover) {
    const net = turnoverNetOmzet(t);
    const b = turnoverBtw(t);
    omzet += net;
    btwVerschuldigd += b.total;
    turnoverBtw9 += b.r9;
    turnoverBtw21 += b.r21;
    addSale(21, t.base_21 ?? 0, b.r21);
    addSale(9, t.base_9 ?? 0, b.r9);
    addSale(0, t.base_0 ?? 0, 0);

    // [FIN-5] A day whose printed gross (total_incl) exceeds its rated net+BTW is turnover
    // whose BTW rate did NOT import (e.g. a Z-report the normalizer couldn't split per
    // tarief). Left as-is it would vanish: the day counts as "covered" (total_incl>0) so
    // the bank/cash witnesses are suppressed, yet it adds 0 to 5a — silently understating
    // the aangifte to zero and slipping past the readiness gate. Instead, recover the
    // unaccounted gross as revenue AND flag it as omzet-zonder-tarief (exactly like unrated
    // cash: counted in omzet, surfaced in cashOmzetZonderBtw, which BLOCKS readiness) so a
    // rate must be assigned before this can be filed. Tolerant of per-day rounding.
    if (t.total_incl != null) {
      const unrated = t.total_incl - (net + b.total);
      if (unrated > Math.max(0.05, 0.005 * Math.abs(t.total_incl))) {
        omzet += unrated;
        cashOmzetZonderBtw += unrated;
      }
    }
  }

  // 5) [TRIANGLE] Acquirer commission — a real cost that closes the gross-till vs net-bank
  //    gap. No BTW is claimed here (see the parameter note); a negative value is ignored.
  if (acquirerCommission > 0) kosten += acquirerCommission;

  return {
    omzet,
    kosten,
    resultaat: omzet - kosten,
    btwVerschuldigd,
    btwVoorbelasting,
    btwSaldo: btwVerschuldigd - btwVoorbelasting,
    cashOmzetZonderBtw,
    turnoverBtw9,
    turnoverBtw21,
    salesByRate: [...salesRate.entries()]
      .map(([rate, v]) => ({ rate, omzet: v.omzet, btw: v.btw }))
      .sort((a, b) => b.rate - a.rate),
  };
}
