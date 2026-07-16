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
import { nearestLegalRate } from "./btw-rate";

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
  // TRUE when settleDate is the REAL takings date parsed from the statement (DAT.),
  // FALSE/absent when it is only the booking date used as a fallback. When it is a
  // fallback, the true takings day is a day or two EARLIER (settlement lags takings),
  // so the covered-day check widens to a short backward window — never forward, so it
  // can never suppress (hide) revenue on a day that carries its own exact takings date.
  settleExact?: boolean;
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
  // Of cashOmzetZonderBtw, the portion from BANK revenue or an un-split till day (not plain
  // cash). > 0 → the rate split needs the Z-report → readiness points the fix at Dagomzet.
  omzetZonderBtwNonCash: number;
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

// The maximum settlement lag (days) we look BACKWARD when a pos_income line's takings
// date wasn't printed and we only have the booking date. Card settlements post to the
// bank the same day or a few days after the sale — never before — so looking back a few
// days (and never forward) reconciles a T+1/T+2 payout to its Z-report day without ever
// hiding revenue on a day that carries its own exact takings date.
const SETTLE_LAG_DAYS = 3;

// Is a pos_income line the settlement of a day the till Z-report already counted? Exact
// takings date (settleExact) → exact covered match. Fallback booking date → also accept a
// covered day up to SETTLE_LAG_DAYS earlier (the sale happened before the payout posted).
function posSettlesCoveredDay(t: ResultBankTx, covered: Set<string>): boolean {
  if (!t.settleDate) return false;
  if (covered.has(t.settleDate)) return true;
  if (t.settleExact) return false; // exact date: no widening — never hide real revenue
  for (let back = 1; back <= SETTLE_LAG_DAYS; back++) {
    if (covered.has(isoMinusDays(t.settleDate, back))) return true;
  }
  return false;
}

// Subtract whole days from a 'YYYY-MM-DD' string via UTC (no local-TZ drift). Returns
// '' for a malformed input so it simply won't match any covered date.
function isoMinusDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() - days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
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
  // [ZONDER-TARIEF-SOURCE] Of the omzet-zonder-tarief total, how much comes from BANK
  // revenue or an un-split till day (vs. plain cash). Bank/till revenue needs the Z-report
  // rate split to know 9%/21% — so the fix guidance points to Dagomzet, not Kas. Pure cash
  // omzet's rate is assigned at Kas. Lets readiness route the "fix" link to the right screen.
  let omzetZonderBtwNonCash = 0;
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
      // [HUNT-A] Snap the blend to a legal NL rate so a 9%+0%-statiegeld sale lands in
      // rubriek 1b, not 1c (a raw 8% blend would fall through to the 1c catch-all).
      addSale(ex !== 0 ? nearestLegalRate(Math.round((btw / ex) * 100)) : 0, ex, btw);
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
    // takings, not new revenue → witness only. Keyed on the takings date (settleDate).
    // When settleDate is the exact DAT. date, an exact covered-day match. When it is only
    // the booking-date fallback, the real takings day is 1–3 days earlier (settlement lag),
    // so widen to a short BACKWARD window — never forward, so a real takings day carrying
    // its own exact date can never be hidden. ONLY for pos_income — a manually-set 'omzet'
    // line still counts (the owner's stated intent), and if it lacks a rate it is surfaced
    // below as omzet-zonder-tarief rather than silently zero-rated.
    if (t.category === "pos_income" && posSettlesCoveredDay(t, covered)) continue;
    const amt = Math.abs(t.amount ?? 0);
    const role = pnlRole(t.category);
    if (role === "omzet") {
      omzet += amt;
      // A bank revenue line (pos_income takings on an un-covered day, or a manual 'omzet'
      // chip) carries NO BTW rate — it must NOT silently declare €0 BTW in 5a. Surface it
      // exactly like unrated cash: counted in omzet, flagged as omzet-zonder-tarief, which
      // blocks readiness and appears in the aangifte note so a rate is assigned before
      // filing. (Card takings reconciled to a Z-report were already excluded above.)
      cashOmzetZonderBtw += amt;
      omzetZonderBtwNonCash += amt; // bank-sourced → the rate split comes from the Z-report
    }
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
      // A correctly-imported day reconciles net+BTW to the CENT (both come from the same
      // Z-report), so a tight tolerance (10c + 0.1%) catches even a small un-imported bucket
      // on a large day without false-triggering on legitimate per-line rounding — the
      // owner's "no silent loss" rule over the looser 0.5% payment-reconciliation floor.
      if (unrated > Math.max(0.10, 0.001 * Math.abs(t.total_incl))) {
        omzet += unrated;
        cashOmzetZonderBtw += unrated;
        omzetZonderBtwNonCash += unrated; // till day with an un-imported rate → fix at Dagomzet
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
    omzetZonderBtwNonCash,
    turnoverBtw9,
    turnoverBtw21,
    salesByRate: [...salesRate.entries()]
      .map(([rate, v]) => ({ rate, omzet: v.omzet, btw: v.btw }))
      .sort((a, b) => b.rate - a.rate),
  };
}
