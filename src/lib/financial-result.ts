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
import { turnoverNetOmzet, turnoverBtw, parsePosSettlement, type DailyTurnover } from "./turnover";
import { nearestLegalRate } from "./btw-rate";
import { isPosPayoutDescription } from "./bank-identity";

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
  // [TURNOVER] For a card/PSP settlement line: the takings day it settled (parsed DAT date,
  // or the booking date as a fallback). Used to exclude it on days the till already counted.
  settleDate?: string | null;
  // TRUE when this revenue credit is a card-acquirer / PSP SETTLEMENT — either an explicit
  // pos_income category, or a credit whose text matches a known acquirer even though the
  // owner (mis)categorised it as plain 'omzet'. Such a line's takings were already booked
  // once by the till on the settled day, so on a covered day it is a witness, never a second
  // helping of revenue. Set by toResultBankTx so all four surfaces de-dup identically.
  posSettlement?: boolean;
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

/** The raw bank_transactions columns the result engine needs. */
export interface RawBankRow {
  amount: number | null;
  category: string | null;
  invoice_id: string | null;
  date: string | null;
  description: string | null;
  counterpart_name?: string | null; // banks often put the acquirer/PSP name here, not in description
}

/**
 * Map one raw bank_transactions row to a ResultBankTx, deciding whether it is a card/PSP
 * SETTLEMENT and, if so, the takings day it settled. THE single place that decision is made,
 * so all four money surfaces (result / aangifte / readiness / closing-package) de-dup card
 * takings identically and cannot drift.
 *
 * A line is a settlement when it is explicitly categorised pos_income, OR it is a CREDIT
 * whose text matches a known acquirer/PSP (isPosPayoutDescription) even though the owner
 * (mis)categorised it as plain 'omzet' — either way its takings were already booked once by
 * the till on the settled day. settleDate is the printed DAT. takings date when present, else
 * the booking date (settleExact=false → computeResult widens a short backward window only).
 */
export function toResultBankTx(b: RawBankRow): ResultBankTx {
  const amt = b.amount ?? 0;
  const posSettlement = b.category === "pos_income" || (amt >= 0 && isPosPayoutDescription(b.description, b.counterpart_name ?? null));
  const parsedTakings = posSettlement ? parsePosSettlement(b.description).date : null;
  return {
    amount: b.amount,
    category: b.category,
    invoice_id: b.invoice_id,
    posSettlement,
    settleDate: posSettlement ? (parsedTakings ?? b.date) : null,
    settleExact: posSettlement ? parsedTakings != null : false,
  };
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

// The maximum settlement lag (days) we look BACKWARD when a settlement line's takings
// date wasn't printed and we only have the booking date. Card settlements post to the
// bank the same day or a few days after the sale — never before — so looking back a few
// days (and never forward) reconciles a T+1/T+2 payout to its Z-report day without ever
// hiding revenue on a day that carries its own exact takings date. Kept EQUAL to the
// −5-day covered buffer the callers fetch (result/readiness/closing): a DAT-less payout
// over a long weekend + holiday can post 4–5 days after the sale and cross a quarter
// boundary, so a shorter window here would miss its covered takings day and let the till's
// already-counted revenue be booked a SECOND time in the next quarter.
const SETTLE_LAG_DAYS = 5;

// Excess below this many euro is a per-line rounding artifact, not real off-till revenue —
// treated as a witness so a €0.01 gap can't fabricate a phantom omzet-zonder-tarief nudge.
const EXCESS_EPS = 0.02;

// WHICH covered takings day does this settlement line reconcile to (or null)? Exact takings
// date (settleExact) → exact covered match. Fallback booking date (no printed DAT.) → accept a
// covered day up to SETTLE_LAG_DAYS earlier (the sale happened before the payout posted). In
// that fuzzy window we PREFER the nearest covered day that still has card-takings budget left,
// so two DAT-less payouts on consecutive trading days don't both collapse onto ONE day's budget
// (which would strand the other day's budget and leak the second payout as fake "excess" omzet —
// a systematic double-count). When every in-window covered day is exhausted we return the
// nearest, so the genuinely-excess amount correctly counts.
function matchedCoveredDay(t: ResultBankTx, covered: Set<string>, remaining: Map<string, number>): string | null {
  if (!t.settleDate) return null;
  if (covered.has(t.settleDate)) return t.settleDate; // exact/known takings date — consume its own day
  if (t.settleExact) return null; // exact date not covered → real revenue, never widen (never hide)
  let firstCovered: string | null = null;
  for (let back = 1; back <= SETTLE_LAG_DAYS; back++) {
    const d = isoMinusDays(t.settleDate, back);
    if (!covered.has(d)) continue;
    if (firstCovered === null) firstCovered = d;
    const rem = remaining.get(d);
    if (rem === undefined || rem > 0.005) return d; // still has budget (undefined = prior-quarter day)
  }
  return firstCovered;
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

/**
 * The card-takings budget for one covered day: the MOST bank revenue that day may suppress as
 * "already counted by the till". Best is pin_amount (the Z-report's CARD total). When it is
 * missing we use the NON-CASH takings (total_incl − cash − other) — never plain gross, because
 * gross includes the cash portion and a card/PSP settlement can never be the cash takings, so
 * bounding by gross would wrongly absorb a same-day webshop payout up to the cash amount. Only
 * when the cash split is also unknown do we fall back to gross (documented residual). Exported so
 * the route can build a buffer-inclusive budget map identical to this rule.
 */
export function cardBudgetBound(t: DailyTurnover): number {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (t.pin_amount != null && t.pin_amount > 0) return r2(t.pin_amount);
  const gross = t.total_incl ?? 0;
  if (gross > 0) {
    if (t.cash_amount != null) {
      const nonCash = gross - t.cash_amount - (t.other_amount ?? 0);
      return r2(Math.max(0, nonCash));
    }
    return r2(gross); // cash split unknown → gross bound (best available)
  }
  return r2(turnoverNetOmzet(t) + turnoverBtw(t).total);
}

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
  // [CARD-BUDGET] Per covered day, the MAX bank revenue that day may suppress as "already
  // counted by the till" = its card takings (see cardBudgetBound). The caller SHOULD build this
  // from the SAME buffer-inclusive turnover as coveredDates, so a prior-quarter (buffer) covered
  // day also gets a budget: its terminal settlement (≤ pin) is suppressed as prior-quarter money
  // while a same-day webshop payout's EXCESS is still counted in THIS quarter — never hidden in
  // both. When omitted, the budget is derived from the in-quarter `turnover` only (buffer days
  // then suppress in full — correct when there is no off-till excess, e.g. in unit tests).
  coveredBudget?: Map<string, number>,
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

  // [CARD-BUDGET] How much bank revenue a covered day may SUPPRESS as "already counted by the
  // till". The physical till's CARD takings for the day = pin_amount (from the Z-report); a
  // card/PSP settlement reconciles the till only UP TO that amount. Anything beyond it is money
  // the till never saw — a same-day webshop payout via the same PSP, or a terminal paying out
  // more than the till rang — and MUST count as revenue (flagged omzet-zonder-tarief), never be
  // hidden. So suppression is BUDGET-BOUNDED, not all-or-nothing: for each covered day we
  // suppress settlement credits only until pin_amount is exhausted, then count the rest.
  //
  // Prefer the caller's buffer-inclusive budget (so prior-quarter days are bounded too, not
  // suppressed in full — see coveredBudget). Otherwise derive from the in-quarter turnover.
  const cardRemaining = coveredBudget
    ? new Map(coveredBudget)
    : (() => {
        const m = new Map<string, number>();
        for (const t of turnover) {
          const net = turnoverNetOmzet(t);
          if (!(net > 0 || (t.total_incl ?? 0) > 0)) continue; // not a revenue (covered) day
          m.set(t.turnover_date, cardBudgetBound(t));
        }
        return m;
      })();

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
    // [SIGN] Keep the SIGN of the bank amount — do NOT Math.abs it. A card refund/chargeback
    // settles as a NEGATIVE pos_income and a supplier refund as a POSITIVE kosten credit;
    // abs would book money leaving the business as money arriving (and vice-versa). The stored
    // convention is credit(+)/debit(−), so a normal cost (debit, negative) becomes a positive
    // kosten via -raw, while a refund correctly reduces it. (sumPosSettlements keeps the sign
    // for the same reason.)
    const raw = t.amount ?? 0;
    const role = pnlRole(t.category);

    // [TURNOVER · CARD-BUDGET] A card/PSP settlement that reconciles a day the till already
    // counted is that day's takings, not new revenue. But it is a witness only UP TO the day's
    // physical card takings (pin_amount) — see cardRemaining. A settlement keyed on an explicit
    // pos_income category OR an acquirer-named credit the owner mis-tapped as 'omzet' is checked
    // against that budget: the part within budget is suppressed (already counted by the till),
    // any EXCESS is off-till revenue (e.g. a same-day webshop payout via the same PSP) and is
    // COUNTED + flagged, never hidden. A NON-acquirer 'omzet' line (a webshop transfer with no
    // acquirer name) is not a settlement → it always counts.
    const isSettlement = role === "omzet" && (t.posSettlement || t.category === "pos_income");
    if (isSettlement) {
      if (raw <= 0) {
        // A refund/chargeback is a witness of the till's ALREADY-NET figure ONLY when it exactly
        // matches the takings day (the reversal was rung at the till that day). A later,
        // bank-initiated reversal only WINDOW-matched to a nearby covered day is NOT in that
        // Z-report net → it must reduce omzet, not silently vanish (which would overstate omzet).
        if (t.settleExact && t.settleDate && covered.has(t.settleDate)) continue;
        // else fall through → the negative reduces omzet below.
      } else {
        const day = matchedCoveredDay(t, covered, cardRemaining);
        if (day) {
          if (!cardRemaining.has(day)) continue; // prior-quarter buffer day w/o budget → belongs there
          const rem = Math.max(0, cardRemaining.get(day) ?? 0);
          const suppressed = Math.min(raw, rem);
          cardRemaining.set(day, Math.round((rem - suppressed) * 100) / 100);
          const excess = Math.round((raw - suppressed) * 100) / 100;
          if (excess <= EXCESS_EPS) continue; // within the till's card takings (+rounding) → witness
          // The part beyond the till's card takings is real off-till revenue with no BTW rate.
          omzet += excess;
          cashOmzetZonderBtw += excess;
          omzetZonderBtwNonCash += excess;
          continue;
        }
      }
    }

    if (role === "omzet") {
      omzet += raw;
      // A bank revenue line (pos_income takings on an un-covered day, or a manual 'omzet'
      // chip) carries NO BTW rate — it must NOT silently declare €0 BTW in 5a. Surface it
      // exactly like unrated cash: counted in omzet, flagged as omzet-zonder-tarief, which
      // blocks readiness and appears in the aangifte note so a rate is assigned before
      // filing. Only a POSITIVE unrated line adds to the nudge — a refund reduces omzet but
      // must not inflate the zonder-tarief warning or block readiness.
      if (raw > 0) {
        cashOmzetZonderBtw += raw;
        omzetZonderBtwNonCash += raw; // bank-sourced → the rate split comes from the Z-report
      }
    }
    else if (role === "kosten") kosten += -raw; // debit(−) → positive cost; refund(+) reduces it
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
