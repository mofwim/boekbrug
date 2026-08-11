// src/lib/compute-result-range.ts
// [TRUTH-RANGE] The ONE reconciled financial result for an arbitrary [start, end] date window.
//
// This is the exact fetch + triangle-reconcile + computeResult pipeline that /api/result ran for
// a single quarter, lifted out verbatim so it can run over ANY window — a quarter, a year, all of
// time, a custom range. That is the whole point of the "living truth + time lens": there is only
// ONE truth, computed live from the raw tables; a period is just which [start, end] you feed it.
// Both /api/result (quarter) and /api/truth (lens) call this, so the two can never drift.
//
// Read-only. The caller resolves ownerId (own vs accountant-linked client) and passes the
// service-role pipeline already scoped to that owner.

import { computeResult, toResultBankTx, cardBudgetBound, type ResultInvoice, type ResultBankTx, type ResultCashEntry, type FinancialResult } from "./financial-result";
import { turnoverNetOmzet, type DailyTurnover } from "./turnover";
import { fetchAllRows } from "./supabase-paginate";
import { reconcileTriangle, bankNetByDay } from "./triangle";
import { netCommissionToBook, ACQUIRER_VENDOR_RE } from "./card-reconcile";
import type { EftSettlement } from "./eft-parser";
import type { PipelineClient } from "./supabase-pipeline";
import { fetchSettlementEvents, resolveOwnerSchemeSpan } from "./kas-payment-events-fetch";
import type { VatScheme } from "./vat-scheme";
// [RUBRIEK-SPLIT] Omzet per BTW rate, read from the invoice's own lines.
import { fetchRateShares } from "./btw-rate-split-fetch";
import { collectVatExemption, fetchVatDeductions } from "./vat-exemption-collect";
import { exemptShareOf } from "./vat-exemption";
import { round2 } from "./invoice-totals";

// [FIN-4] Infer a NULL direction from ownership (the owner is the receiver of an incoming
// invoice) — the SAME rule effectiveDirection / aangifte / readiness use — so a null-direction
// row is never dropped and the result never diverges from the concept.
function effDirOf(i: { direction: string | null; receiver_id: string | null }, ownerId: string): "incoming" | "outgoing" {
  return i.direction === "incoming" || i.direction === "outgoing"
    ? i.direction
    : i.receiver_id === ownerId ? "incoming" : "outgoing";
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

/** Shift an ISO 'YYYY-MM-DD' by whole days via UTC (no local-TZ drift). */
function isoShiftDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export interface RangeResult {
  result: FinancialResult;
  datelessVerifiedCount: number;
  // [KASSTELSEL] Under cash basis: paid money we could NOT date (undatedPaidCount) MUST block
  // klaar/aangifte — it would otherwise silently under-declare. estimatedPortionCount counts
  // invoices whose paid-date is only an estimate (marked_paid_at). Both 0 under factuur.
  undatedPaidCount: number;
  estimatedPortionCount: number;
  // [COMPLETENESS] Purchase invoices dated in this window that are still in the verify queue
  // ('processing'). Their amount and BTW are NOT in the figures, so the window is knowingly too
  // low. Computed here — from the SAME rows and the SAME effective-direction rule the figures use
  // — so the filing gate and every screen count it identically and cannot drift apart.
  unconfirmedIncomingCount: number;
  scheme: VatScheme;
  // [SCHEME-SPAN] TRUE when [start, end] straddles the owner's factuur→kas switch, so no single
  // basis is right for it: the figures use `scheme` (resolved at `start`, which never rewrites an
  // already-filed period) and the surface must say the window crosses the switch rather than
  // present a one-basis number for a two-basis period. Always false for a single-quarter window
  // and for every factuur owner. `schemeSince` is the owner's kas effective date, for the copy.
  spansSchemeChange: boolean;
  schemeSince: string | null;
  reconciliation: {
    totalCommission: number;
    commissionBooked: number;
    acquirerFeeInvoices: number;
    grossMismatchDays: number;
    incompleteDays: number;
    // [EXCEPTION-COUNT] Days whose payout/commission is suspect and therefore books NO commission.
    // Counted in neither of the two above (a day carries exactly one status), so the three are
    // safe to sum.
    commissionIssueDays: number;
    eftSettlements: number;
    // [LEDGER-READ] FALSE when the bookkeeper's PIN ledger could not be read (the table may not
    // exist on every deployment yet). The ledger only ever ADDS gross-mismatch detections, so a
    // failed read makes the reconciliation look CLEANER than it is — the caller must be able to say
    // "this cross-check did not run" instead of showing a silently weaker all-clear.
    pinLedgerAvailable: boolean;
  };
}

/**
 * Compute the reconciled result for one owner over [start, end] (inclusive ISO dates).
 * IDENTICAL logic to the old /api/result body — only the period bounds are now a parameter.
 */
export async function computeResultForRange(args: {
  pipeline: PipelineClient;
  ownerId: string;
  start: string; // 'YYYY-MM-DD'
  end: string;   // 'YYYY-MM-DD'
  // [KASSTELSEL] The VAT basis in force for this window. Omitted → resolved from the owner's
  // profile for the window START (per-quarter, so a pre-switch quarter stays factuur), which makes
  // /api/result and the truth lens kas-aware with no route change. Pass explicitly only to override
  // (e.g. tests). Default resolution degrades to factuur if the migration lags — never a wrong number.
  scheme?: VatScheme;
}): Promise<RangeResult> {
  const { pipeline, ownerId, start, end } = args;
  // [SCHEME-SPAN] One profile read gives both the basis this window is computed under (resolved at
  // `start`, unchanged) and whether the window straddles a scheme switch — see resolveOwnerSchemeSpan
  // for why a multi-quarter lens needs to say so rather than silently pick one basis.
  const span = args.scheme ? null : await resolveOwnerSchemeSpan(pipeline, ownerId, start, end);
  const scheme: VatScheme = args.scheme ?? span!.scheme;

  // Invoices for this owner (outgoing = sender, incoming = receiver) in the window.
  const invRows = await fetchAllRows((from, to) => pipeline
    .from("invoices")
    .select("id, direction, status, total_ex_btw, btw_amount, invoice_date, sender_id, receiver_id, client_name")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .order("id", { ascending: true }).range(from, to));

  // [RUBRIEK-SPLIT] The rate mix of the SALES invoices in this window, read from their own lines.
  // The aangifte splits omzet across rubriek 1a/1b/1c, and an invoice header carries no rate — it
  // is derived as btw ÷ ex, exact for the single-rate invoices that are almost all of them and
  // wrong for the rest: €1.000 @ 21% + €1.000 @ 9% blends to 15%, snaps to 21%, and declares the
  // whole €2.000 in 1a. Same helper /api/aangifte uses, so the two can never disagree.
  // [VRIJGESTELD] The exempt regime for this window, from the one shared collector — the same
  // one /api/aangifte, /api/readiness and the closing package use, so the result screen, the
  // truth lens and the concept can never show different money. `start` is the window's first day:
  // a declaration that begins mid-window leaves the window on the old regime rather than
  // retroactively re-apportioning a quarter inside it that was already filed.
  const typedInvRows = invRows as Array<{ id?: string; direction: string | null; receiver_id: string | null; total_ex_btw: number | null; btw_amount: number | null }>;
  const exemption = await collectVatExemption({
    client: pipeline,
    ownerId,
    periodStart: start,
    incomingInvoiceIds: typedInvRows.filter((i) => effDirOf(i, ownerId) === "incoming").map((i) => i.id).filter((id): id is string => !!id),
  });
  const { rateShares: rateSharesByInvoice, exemptExByInvoice } = await fetchRateShares(
    pipeline,
    typedInvRows.filter((i) => effDirOf(i, ownerId) === "outgoing"),
    { exemptRegime: exemption.active },
  );

  const invoices: ResultInvoice[] = invRows.map((i) => ({
    direction: effDirOf(i, ownerId),
    status: i.status,
    total_ex_btw: i.total_ex_btw,
    btw_amount: i.btw_amount,
    // [RUBRIEK-SPLIT] Present only on a mixed-rate sales invoice; everything else keeps the
    // header-derived rate exactly as before.
    rate_lines: (i as { id?: string }).id ? rateSharesByInvoice.get((i as { id: string }).id) ?? null : null,
    exempt_ex: (i as { id?: string }).id ? exemptExByInvoice.get((i as { id: string }).id) ?? null : null,
    vat_deduction: (i as { id?: string }).id ? exemption.deductionByInvoice.get((i as { id: string }).id) ?? null : null,
  }));

  // [TURNOVER] Daily till Z-report, with a −5-day buffer: a sale on the last days BEFORE the
  // window settles into it, and its pos_income line must be suppressed (covered set) without its
  // revenue being re-added (revenue rows are the in-window ones only). Closes the cross-boundary
  // double-count.
  // [CROSS-QUARTER] Symmetric ±5-day settlement-lag buffer. −5 covers a sale just before the window
  // whose payout settles into it (omzet suppression, below). +5 lets a boundary takings day at the
  // END of the window ANCHOR a DAT-less card payout that posts a few days into the NEXT quarter, so
  // the acquirer commission is booked in the quarter that owns the sale (see the triangle call).
  const startBuffer = isoShiftDays(start, -5);
  const endBuffer = isoShiftDays(end, 5);

  // Bank lines (computeResult excludes invoice payments + uncategorized).
  //
  // [ONE-BANK-READ] Read the ±5-day BUFFER window ONCE and derive both consumers from it. There
  // used to be two reads with two DIFFERENT definitions of "card payout": the result leg asked
  // toResultBankTx (explicit pos_income OR a credit whose text names a known acquirer, even when
  // the owner tapped plain 'omzet'), while the triangle leg asked the database for
  // `category = 'pos_income'` and nothing else. A mis-categorised acquirer payout therefore had its
  // omzet suppressed as "already counted by the till" while the triangle never saw a bankNet for
  // that day — so Leg B booked NO commission (a real, deductible cost silently dropped, resultaat
  // overstated) and the day was additionally reported as "incomplete". Deriving both from the one
  // predicate makes the two legs agree by construction; it also costs one query fewer.
  const bankBufRows = await fetchAllRows((from, to) => pipeline
    .from("bank_transactions")
    .select("amount, category, invoice_id, date, description, counterpart_name")
    .eq("user_id", ownerId)
    .gte("date", startBuffer)
    .lte("date", endBuffer)
    .order("id", { ascending: true }).range(from, to));
  // The RESULT leg stays strictly in-window: the buffer days exist only to key the triangle, and
  // booking their money here would move revenue/cost into a period that does not own it. A NULL
  // date cannot be placed in any window, exactly as the old date-bounded query implied.
  const bankTx: ResultBankTx[] = bankBufRows
    .filter((b) => b.date != null && b.date >= start && b.date <= end)
    .map(toResultBankTx);

  // Cash entries in the window.
  const cashRows = await fetchAllRows((from, to) => pipeline
    .from("cash_entries")
    .select("direction, amount, category, btw_rate, entry_date, document_id")
    .eq("user_id", ownerId)
    .gte("entry_date", start)
    .lte("entry_date", end)
    .order("id", { ascending: true }).range(from, to));
  const cashEntries: ResultCashEntry[] = cashRows.map((c) => ({
    direction: c.direction === "in" ? "in" : "out",
    amount: c.amount, category: c.category, btw_rate: c.btw_rate,
    date: c.entry_date,
    document_id: (c as { document_id?: string | null }).document_id ?? null, // [CASH-COST-VAT]
  }));

  // [TURNOVER] Daily till Z-report, over the SAME ±5-day settlement-lag buffer declared above.
  // [TURNOVER-READ-ERROR] The error was discarded here, and this is the engine BEHIND
  // /api/result, /api/truth and the closing package. A failed read left turnoverRows null and
  // allTurnover empty, so a till shop's kassa-omzet silently disappeared from the result, the
  // waarheid screen and the concept aangifte at once — every one of them answering 200 with a
  // smaller number and no warning. Missing data must never render as less revenue. fetchAllRows
  // throws, so the caller fails loudly and the screen says it could not load.
  const turnoverRows = await fetchAllRows<{
    turnover_date: string; base_0: number | null; base_9: number | null; base_21: number | null;
    btw_9: number | null; btw_21: number | null; total_incl: number | null;
    pin_amount: number | null; cash_amount: number | null; other_amount: number | null;
  }>((from, to) => pipeline
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", ownerId)
    .gte("turnover_date", startBuffer)
    .lte("turnover_date", endBuffer)
    .order("turnover_date", { ascending: true })
    .range(from, to));

  const allTurnover: DailyTurnover[] = (turnoverRows ?? []).map((t) => ({
    turnover_date: t.turnover_date,
    base_0: t.base_0 ?? 0, base_9: t.base_9 ?? 0, base_21: t.base_21 ?? 0,
    btw_9: t.btw_9 ?? 0, btw_21: t.btw_21 ?? 0,
    total_incl: t.total_incl, pin_amount: t.pin_amount, cash_amount: t.cash_amount, other_amount: t.other_amount,
  }));

  // Revenue rows: strictly in-window [start, end]. The +5 buffer days exist ONLY to anchor the
  // triangle's cross-boundary re-attribution — they must NEVER enter omzet (that would book a
  // next-quarter sale here). Covered set: revenue rows in [start−5, end] (a payout settling into the
  // window from a pre-window sale is suppressed; a +5 next-quarter day must NOT suppress anything).
  const turnover = allTurnover.filter((t) => t.turnover_date >= start && t.turnover_date <= end);
  const coveredDates = new Set(
    allTurnover
      .filter((t) => t.turnover_date <= end && (turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0))
      .map((t) => t.turnover_date),
  );

  // [TRIANGLE] Card-takings reconciliation (till counts GROSS, bank pays NET → acquirer
  // commission is a cost). In-window EFT terminal settlements.
  // [EFT-READ-ERROR] This was the one read in this file that still used a bare `const { data } =`:
  // it DISCARDED the error and, worse, it was unpaginated and unordered. PostgREST caps a response
  // at ~1000 rows and truncates SILENTLY (see supabase-paginate.ts), and with no .order() the
  // surviving 1000 were an arbitrary subset. A till shop with several terminals settling per shift
  // passes that cap inside a single quarter and blows straight past it on the "Dit jaar"/"Alles"
  // lenses — where the missing gross makes Leg B under-report the acquirer commission, so kosten
  // land too LOW and resultaat too HIGH, with a 200 and no warning anywhere. Read it the way every
  // other source here is read: paged, ordered, and throwing on error so the screen says it could
  // not load rather than quietly showing a bigger profit.
  // The row shape mirrors EftSettlement's own field types (eft-parser.ts) — period/shift numbers are
  // stored as text there, so keep them text here rather than re-typing them at the mapper.
  const eftRows = await fetchAllRows<{
    settlement_date: string | null; terminal_id: string | null; period_nr: string | null;
    shift_nr: string | null; period_start: string | null; period_end: string | null;
    first_trx: string | null; last_trx: string | null; gross_total: number | null;
    tx_count: number | null; by_scheme: unknown;
  }>((from, to) => pipeline
    .from("eft_settlements")
    .select("settlement_date, terminal_id, period_nr, shift_nr, period_start, period_end, first_trx, last_trx, gross_total, tx_count, by_scheme")
    .eq("user_id", ownerId)
    // [CROSS-QUARTER] ±5 buffer so a boundary takings day's EFT gross is present as an anchor when
    // its DAT-less payout re-attributes across the quarter edge (see the triangle call + windowStart/End).
    .gte("settlement_date", startBuffer)
    .lte("settlement_date", endBuffer)
    .order("id", { ascending: true }).range(from, to) as never);
  const eftSettlements: EftSettlement[] = (eftRows ?? []).map((e) => ({
    terminalId: e.terminal_id, periodNr: e.period_nr, shiftNr: e.shift_nr,
    periodStart: e.period_start, periodEnd: e.period_end, firstTrx: e.first_trx, lastTrx: e.last_trx,
    settlementDate: e.settlement_date, grossTotal: e.gross_total ?? 0, txCount: e.tx_count ?? 0,
    byScheme: (Array.isArray(e.by_scheme) ? e.by_scheme : []) as unknown as EftSettlement["byScheme"],
  }));

  // Bank NET card settlement per takings day, with a ±5-day settlement-lag buffer. We DO NOT pre-drop
  // out-of-window keys any more: a DAT-less payout keyed to a booking date just past the window edge
  // must survive so the triangle can re-attribute it back to its in-window takings day. The triangle's
  // windowStart/windowEnd predicate then decides which days actually book commission — so a payout is
  // counted in exactly the one quarter that owns its takings day, never dropped and never doubled.
  // [ONE-BANK-READ] Sliced out of the single buffered bank read above, using toResultBankTx — the
  // SAME "is this a card payout?" decision the omzet-suppression leg makes. See the read for why
  // asking the database for `category = 'pos_income'` instead silently dropped the commission on
  // every acquirer payout the owner had tapped as plain 'omzet'.
  const posBufRows = bankBufRows.filter((b) => toResultBankTx(b).posSettlement);
  const netByDay = bankNetByDay(posBufRows.map((b) => ({ description: b.description, amount: b.amount, date: b.date })));

  // [LEDGER · Leg-A witness] The bookkeeper's PIN grootboek — an independent GROSS cross-check of
  // the till's PIN takings; fed to the triangle ONLY as pinLedgerByDay (never a revenue source).
  // [LEDGER-READ] The read stays soft — ledger_daily may not exist on every deployment yet, and the
  // ledger is a cross-check witness, never a money source, so a missing table must not fail the
  // whole result. But the failure can no longer be SILENT: losing this witness can only REMOVE
  // gross-mismatch detections, i.e. it makes the reconciliation look cleaner than it is. The flag
  // travels out in `reconciliation.pinLedgerAvailable` so a surface can say "this check did not
  // run" instead of presenting a weakened all-clear as a real one.
  let pinLedgerAvailable = true;
  const pinLedgerRows = await fetchAllRows<{ ledger_date: string; received: number | null; spent: number | null }>((from, to) => pipeline
    .from("ledger_daily")
    .select("ledger_date, received, spent")
    .eq("user_id", ownerId)
    .eq("kind", "pin")
    // In-window only, deliberately: a ledger-only buffer day carries no till/EFT/bank figure, so
    // widening it here would add phantom rows to the accountant's reconciliation CSV without
    // changing a single counter (buffer days are excluded by the triangle's window predicate).
    .gte("ledger_date", start)
    .lte("ledger_date", end)
    // [PAGE-KEY] ledger_date is unique per (user, date, KIND) — up to four rows a day — so a
    // .range() page boundary is not stable over it alone: ties may come back in a different
    // order per query, repeating some days and dropping others. The id makes the order total.
    .order("ledger_date", { ascending: true }).order("id", { ascending: true }).range(from, to)).catch(() => { pinLedgerAvailable = false; return []; });
  const pinLedgerByDay = new Map<string, number>();
  for (const r of pinLedgerRows) if (r.ledger_date) pinLedgerByDay.set(r.ledger_date, (Number(r.received) || 0) - (Number(r.spent) || 0));

  // [CROSS-QUARTER] Feed the BUFFERED turnover (allTurnover, [start−5, end+5]) as anchors so a
  // boundary takings day can catch its cross-edge payout; windowStart/windowEnd then restrict which
  // days actually book commission to [start, end], so the fee lands in exactly the owning quarter.
  const triangle = reconcileTriangle({
    turnover: allTurnover,
    eftSettlements,
    bankNetByDay: netByDay,
    pinLedgerByDay,
    windowStart: start,
    windowEnd: end,
  });

  // Acquirer-fee invoices already booked as kosten — subtract so the commission delta isn't
  // double-counted. Gated to the SAME statuses computeResult books as kosten (paid/received).
  const INCOMING_OK = new Set(["paid", "received"]);
  const acquirerFeesBooked = (invRows ?? [])
    .filter((i) =>
      effDirOf(i, ownerId) === "incoming" &&
      INCOMING_OK.has(i.status ?? "") &&
      ACQUIRER_VENDOR_RE.test(i.client_name ?? ""))
    .reduce((s, i) => s + (i.total_ex_btw ?? 0) + (i.btw_amount ?? 0), 0);
  const commissionToBook = netCommissionToBook(triangle.totalCommission, acquirerFeesBooked);

  // [CARD-BUDGET] Per covered day, the max bank revenue it may suppress as till card takings.
  const coveredBudget = new Map(
    allTurnover
      // [CROSS-QUARTER] Same [start−5, end] bound as coveredDates — the +5 anchor days must not add
      // a next-quarter suppression budget (they exist only to anchor the triangle).
      .filter((t) => t.turnover_date <= end && (turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0))
      .map((t) => [t.turnover_date, cardBudgetBound(t)] as const),
  );

  // [KASSTELSEL] Under cash basis, the invoice leg is driven by SETTLEMENTS (BTW on the paid
  // date), not the invoice_date. Only the invoice leg changes: the bank/cash/turnover legs are
  // already payment-dated (a till sale, a bank credit, a cash entry all happen when money moves),
  // so they stay identical. The acquirer-commission auto-book is disabled under kas (its cost is
  // deductible when the acquirer's invoice is PAID, booked via that invoice's own settlement — so
  // auto-booking the triangle delta here would place it in the wrong period / double-count).
  let undatedPaidCount = 0;
  let estimatedPortionCount = 0;
  // [VRIJGESTELD] The regime and the cost attributions belong to BOTH bases — the kas branch
  // below only adds the settlement-shaped inputs on top. Seeding them here is what stops the
  // accrual path (the default, and almost every owner) from silently skipping the apportionment
  // because the exempt inputs happened to live in a variable named after the other scheme.
  let kasOpts: Parameters<typeof computeResult>[7] = {
    exemptRegime: exemption.active,
    deductionByInvoice: exemption.deductionByInvoice,
    exemptShareByInvoice: exemptShareOf(typedInvRows, exemptExByInvoice),
  };
  if (scheme === "kas") {
    const qs = await fetchSettlementEvents(pipeline, ownerId, start, end);
    undatedPaidCount = qs.undatedPaidCount;
    estimatedPortionCount = qs.estimatedCount;
    // [RUBRIEK-SPLIT] The rate mix travels into the cash-basis path too, so a payment on a
    // mixed-rate invoice books a proportional share of each rubriek instead of one blended rate —
    // otherwise the two VAT schemes would file the same sale under different rubrieken.
    // [RUBRIEK-SPLIT] The window map alone is not enough here: fetchSettlementEvents has NO
    // invoice_date filter (an older invoice paid this quarter must be reachable), so a mixed-rate
    // invoice dated last quarter has no entry in a map built from THIS quarter's dates. Fetch the
    // mix for the invoices the settlements actually reference and merge the two.
    const settledSales = [
      ...new Map(
        qs.events
          .filter((e) => e.direction === "outgoing")
          .map((e) => [e.invoiceId, { id: e.invoiceId, total_ex_btw: e.headerEx, btw_amount: e.headerBtw }]),
      ).values(),
    ];
    const { rateShares: settledShares, exemptExByInvoice: settledExempt } = await fetchRateShares(
      pipeline, settledSales, { exemptRegime: exemption.active },
    );
    kasOpts = {
      // Spread, never replace: exemptRegime and deductionByInvoice were seeded above and belong
      // to both bases. Assigning a fresh object here is how they would silently disappear for
      // every kasstelsel owner — the accrual path apportioning correctly while the cash-basis
      // one deducted everything, which is the harder bug to ever notice.
      ...kasOpts,
      scheme: "kas",
      settlements: qs.events,
      priorByInvoice: qs.priorByInvoice,
      // [VRIJGESTELD] Merged the same way the rate mix is: the settlements reach invoices from
      // earlier windows that this window's own map knows nothing about.
      exemptShareByInvoice: new Map([
        ...exemptShareOf(settledSales, settledExempt),
        ...exemptShareOf(typedInvRows, exemptExByInvoice),
      ]),
      rateSharesByInvoice: new Map([...settledShares, ...rateSharesByInvoice]),
      // [VRIJGESTELD · KASSTELSEL] And the PURCHASE side of the same argument, which was the one
      // still missing here. kasOpts was seeded with the attributions of the invoices DATED in this
      // window; the costs a cash-basis window actually books are the ones SETTLED in it, and those
      // routinely belong to invoices dated earlier. A settled cost with no attribution falls to
      // the pro-rata bucket, so an owner who marked a cost 'direct_taxed' loses part of a
      // deduction they were fully entitled to. fetchSettlementEvents has no invoice_date filter,
      // which is precisely why the two sets differ.
      deductionByInvoice: new Map([
        ...(await fetchVatDeductions(
          pipeline,
          ownerId,
          exemption.active
            ? [...new Set(qs.events.filter((e) => e.direction === "incoming").map((e) => e.invoiceId))]
            : [],
        )).deductionByInvoice,
        ...exemption.deductionByInvoice,
      ]),
    };
  }
  // [KASSTELSEL] Under cash basis the triangle delta is NOT auto-booked (see the note above), so
  // the honest figure for "commission actually booked as a cost" is zero. Reporting
  // commissionToBook regardless made the response claim a cost the result never contained.
  const commissionActuallyBooked = scheme === "kas" ? 0 : commissionToBook;
  const result = computeResult(
    invoices, bankTx, cashEntries, turnover, coveredDates,
    commissionActuallyBooked, coveredBudget, kasOpts,
  );

  // [COMPLETENESS] Purchase invoices in this window still sitting in the verify queue. Their money
  // is NOT in the figures above, so the window is knowingly too low — the filing gate blocks on
  // this, and until now the truth screen never mentioned it, which is how an owner reached
  // "Markeer als ingediend" and met a 409 about a problem no screen had shown.
  // The effective-direction rule is effDirOf, NOT a `direction = 'incoming'` filter: a purchase
  // invoice whose direction column is NULL is inferred from ownership everywhere else in this
  // engine ([FIN-4]), and a gate that filtered on the column alone simply did not see those rows.
  const unconfirmedIncomingCount = invRows.filter(
    (i) => effDirOf(i, ownerId) === "incoming" && i.status === "processing",
  ).length;

  // [DATELESS] Under FACTUUR: verified invoices with NO invoice_date are dropped by the date-range
  // fetch, so they are absent from the figures — count them (same rule as /api/aangifte) so the
  // surface can warn. Under KAS the invoice_date is irrelevant (invoices enter by payment date);
  // the analogous "money we can't place" signal is undatedPaidCount, computed above.
  const OUTGOING_OK = new Set(["paid", "sent", "overdue"]);
  let datelessVerifiedCount = 0;
  if (scheme !== "kas") {
    const datelessRows = await fetchAllRows((from, to) => pipeline
      .from("invoices")
      .select("status, direction, receiver_id")
      .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
      .is("invoice_date", null)
      .order("id", { ascending: true }).range(from, to));
    datelessVerifiedCount = datelessRows.filter((i) => {
      const dir = effDirOf(i, ownerId);
      return dir === "incoming" ? INCOMING_OK.has(i.status ?? "") : OUTGOING_OK.has(i.status ?? "");
    }).length;
  }

  return {
    result,
    datelessVerifiedCount,
    undatedPaidCount,
    estimatedPortionCount,
    unconfirmedIncomingCount,
    scheme,
    // An explicit `args.scheme` (tests, or a caller that already resolved it) means no profile was
    // read, so there is nothing to report a straddle against.
    spansSchemeChange: span?.spansSchemeChange ?? false,
    schemeSince: span?.schemeSince ?? null,
    reconciliation: {
      totalCommission: triangle.totalCommission,
      commissionBooked: commissionActuallyBooked,
      acquirerFeeInvoices: round2(acquirerFeesBooked),
      grossMismatchDays: triangle.grossMismatchDays,
      incompleteDays: triangle.incompleteDays,
      commissionIssueDays: triangle.commissionIssueDays,
      eftSettlements: eftSettlements.length,
      pinLedgerAvailable,
    },
  };
}
