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
//
// ── [TRUTH-SEAM] THIS FILE IS NOW ONLY THE READS ─────────────────────────────────────────────
//
// Everything that DECIDES money moved to result-range-assemble.ts, which takes rows and returns
// the answer with no I/O at all. MONEY_PATH_AUDIT_2026-08.md called this module the single largest
// untested money surface in the repo and named the fix in §6.2: extract the windowing and
// aggregation from the fetching, the way truth-lens.ts was extracted in July. That is what the
// split is — the decision layer is now node-testable with fixtures instead of needing a live
// database, which is the only reason it had no behavioural test.
//
// What stays here, and must: the eleven reads, in their original order, with their original error
// handling. Two of them are deliberately not uniform and the reasons are load-bearing:
//
//   · the TURNOVER read THROWS (via fetchAllRows). It used to discard its error, and a failed read
//     left a till shop's kassa-omzet silently out of the result, the waarheid screen and the
//     concept aangifte at once — each answering 200 with a smaller number. Missing data must never
//     render as less revenue.
//   · the PIN-LEDGER read is SOFT (ledger_daily may not exist on every deployment) but no longer
//     silent: losing that witness can only REMOVE gross-mismatch detections, i.e. make the
//     reconciliation look cleaner than it is, so the flag travels out in the response.

import { fetchAllRows } from "./supabase-paginate";
// [KAS-ZACHT] A removed cash movement counts in no total — one definition, see cash-live.ts.
import { liveCashEntries } from "./cash-live";
import type { PipelineClient } from "./supabase-pipeline";
import { fetchSettlementEvents, resolveOwnerSchemeSpan } from "./kas-payment-events-fetch";
import type { VatScheme } from "./vat-scheme";
// [RUBRIEK-SPLIT] Omzet per BTW rate, read from the invoice's own lines.
import { fetchRateShares } from "./btw-rate-split-fetch";
import { readExcludedBankIds } from "./bank-ignored-excluded";
import { collectVatExemption, fetchVatDeductions } from "./vat-exemption-collect";
import {
  assembleRangeResult, effDirOf, isoShiftDays, SETTLEMENT_BUFFER_DAYS,
  type RangeEftRow, type RangeInvoiceRow, type RangeKasInputs, type RangeLedgerRow,
  type RangeTurnoverRow,
} from "./result-range-assemble";

export type { RangeResult } from "./result-range-assemble";

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
}) {
  const { pipeline, ownerId, start, end } = args;
  // [SCHEME-SPAN] One profile read gives both the basis this window is computed under (resolved at
  // `start`, unchanged) and whether the window straddles a scheme switch — see resolveOwnerSchemeSpan
  // for why a multi-quarter lens needs to say so rather than silently pick one basis.
  const span = args.scheme ? null : await resolveOwnerSchemeSpan(pipeline, ownerId, start, end);
  const scheme: VatScheme = args.scheme ?? span!.scheme;

  // Invoices for this owner (outgoing = sender, incoming = receiver) in the window.
  const invRows = await fetchAllRows<RangeInvoiceRow>((from, to) => pipeline
    .from("invoices")
    .select("id, direction, status, invoice_type, total_ex_btw, btw_amount, invoice_date, sender_id, receiver_id, client_name")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .order("id", { ascending: true }).range(from, to) as never);

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
  const exemption = await collectVatExemption({
    client: pipeline,
    ownerId,
    periodStart: start,
    incomingInvoiceIds: invRows.filter((i) => effDirOf(i, ownerId) === "incoming").map((i) => i.id).filter((id): id is string => !!id),
  });
  const { rateShares: rateSharesByInvoice, exemptExByInvoice } = await fetchRateShares(
    pipeline,
    invRows.filter((i) => effDirOf(i, ownerId) === "outgoing"),
    { exemptRegime: exemption.active },
  );

  // [TURNOVER] Daily till Z-report, with a −5-day buffer: a sale on the last days BEFORE the
  // window settles into it, and its pos_income line must be suppressed (covered set) without its
  // revenue being re-added (revenue rows are the in-window ones only). Closes the cross-boundary
  // double-count.
  // [CROSS-QUARTER] Symmetric ±5-day settlement-lag buffer. −5 covers a sale just before the window
  // whose payout settles into it (omzet suppression), and +5 lets a boundary takings day at the
  // END of the window ANCHOR a DAT-less card payout that posts a few days into the NEXT quarter, so
  // the acquirer commission is booked in the quarter that owns the sale.
  const startBuffer = isoShiftDays(start, -SETTLEMENT_BUFFER_DAYS);
  const endBuffer = isoShiftDays(end, SETTLEMENT_BUFFER_DAYS);

  // Bank lines (the assembler excludes invoice payments + uncategorized).
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
    // [GENEGEERD-TELT] id en status rijden mee. De REDEN staat niet in deze select maar in een eigen,
    // wegvallende lezing (readExcludedBankIds) — ignore_reason komt uit een met de hand toegepaste
    // migratie, en een kolom die PostgREST niet kent weigert de hele select. Dat zou van een
    // achterlopende migratie een resultaatscherm zonder bankregels maken.
    .select("id, amount, category, invoice_id, date, description, counterpart_name, status")
    .eq("user_id", ownerId)
    .gte("date", startBuffer)
    .lte("date", endBuffer)
    .order("id", { ascending: true }).range(from, to));

  // Cash entries in the window. [KAS-ZACHT] Live ones only — a removed movement is not a cost,
  // not turnover and not voorbelasting.
  const liveCash = await liveCashEntries(pipeline);
  const cashRows = await fetchAllRows((from, to) => liveCash.only(pipeline
    .from("cash_entries")
    .select("direction, amount, category, btw_rate, entry_date, document_id")
    .eq("user_id", ownerId)
    .gte("entry_date", start)
    .lte("entry_date", end))
    .order("id", { ascending: true }).range(from, to));

  // [TURNOVER] Daily till Z-report, over the SAME ±5-day settlement-lag buffer declared above.
  // [TURNOVER-READ-ERROR] The error was discarded here, and this is the engine BEHIND
  // /api/result, /api/truth and the closing package. A failed read left turnoverRows null and
  // allTurnover empty, so a till shop's kassa-omzet silently disappeared from the result, the
  // waarheid screen and the concept aangifte at once — every one of them answering 200 with a
  // smaller number and no warning. Missing data must never render as less revenue. fetchAllRows
  // throws, so the caller fails loudly and the screen says it could not load.
  const turnoverRows = await fetchAllRows<RangeTurnoverRow>((from, to) => pipeline
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", ownerId)
    .gte("turnover_date", startBuffer)
    .lte("turnover_date", endBuffer)
    .order("turnover_date", { ascending: true })
    .range(from, to));

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
  const eftRows = await fetchAllRows<RangeEftRow>((from, to) => pipeline
    .from("eft_settlements")
    .select("settlement_date, terminal_id, period_nr, shift_nr, period_start, period_end, first_trx, last_trx, gross_total, tx_count, by_scheme")
    .eq("user_id", ownerId)
    // [CROSS-QUARTER] ±5 buffer so a boundary takings day's EFT gross is present as an anchor when
    // its DAT-less payout re-attributes across the quarter edge.
    .gte("settlement_date", startBuffer)
    .lte("settlement_date", endBuffer)
    .order("id", { ascending: true }).range(from, to) as never);

  // [LEDGER · Leg-A witness] The bookkeeper's PIN grootboek — an independent GROSS cross-check of
  // the till's PIN takings; fed to the triangle ONLY as pinLedgerByDay (never a revenue source).
  // [LEDGER-READ] The read stays soft — ledger_daily may not exist on every deployment yet, and the
  // ledger is a cross-check witness, never a money source, so a missing table must not fail the
  // whole result. But the failure can no longer be SILENT: losing this witness can only REMOVE
  // gross-mismatch detections, i.e. it makes the reconciliation look cleaner than it is. The flag
  // travels out in `reconciliation.pinLedgerAvailable` so a surface can say "this check did not
  // run" instead of presenting a weakened all-clear as a real one.
  let pinLedgerAvailable = true;
  const pinLedgerRows = await fetchAllRows<RangeLedgerRow>((from, to) => pipeline
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
    .order("ledger_date", { ascending: true }).order("id", { ascending: true }).range(from, to) as never)
    .catch(() => { pinLedgerAvailable = false; return []; });

  // [KASSTELSEL] The settlement-shaped inputs, fetched only on the cash-basis path.
  let kas: RangeKasInputs | null = null;
  if (scheme === "kas") {
    const qs = await fetchSettlementEvents(pipeline, ownerId, start, end);
    // [RUBRIEK-SPLIT] The rate mix travels into the cash-basis path too, so a payment on a
    // mixed-rate invoice books a proportional share of each rubriek instead of one blended rate —
    // otherwise the two VAT schemes would file the same sale under different rubrieken.
    // The window map alone is not enough here: fetchSettlementEvents has NO invoice_date filter
    // (an older invoice paid this quarter must be reachable), so a mixed-rate invoice dated last
    // quarter has no entry in a map built from THIS quarter's dates. Fetch the mix for the
    // invoices the settlements actually reference and merge the two.
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
    // [VRIJGESTELD · KASSTELSEL] The PURCHASE side of the same argument: the costs a cash-basis
    // window books are the ones SETTLED in it, and those routinely belong to invoices dated
    // earlier — invoices this window's own attribution map knows nothing about.
    const { deductionByInvoice: settledDeductionByInvoice } = await fetchVatDeductions(
      pipeline,
      ownerId,
      exemption.active
        ? [...new Set(qs.events.filter((e) => e.direction === "incoming").map((e) => e.invoiceId))]
        : [],
    );
    kas = { ...qs, settledSales, settledShares, settledExempt, settledDeductionByInvoice };
  }

  // [DATELESS] Under FACTUUR: verified invoices with NO invoice_date are dropped by the date-range
  // fetch above, so they are absent from the figures. Read them so the assembler can count them
  // (same rule as /api/aangifte) and the surface can warn. Under KAS the invoice_date is
  // irrelevant — invoices enter by payment date — so the read is skipped entirely.
  const datelessRows = scheme === "kas" ? [] : await fetchAllRows<RangeInvoiceRow>((from, to) => pipeline
    .from("invoices")
    .select("status, direction, receiver_id")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .is("invoice_date", null)
    .order("id", { ascending: true }).range(from, to) as never);

  return assembleRangeResult({
    ownerId, start, end, scheme, span,
    invRows,
    exemption,
    rateSharesByInvoice,
    exemptExByInvoice,
    bankBufRows,
    // [GENEGEERD-TELT] De reden waarom een regel is genegeerd, apart gelezen omdat ignore_reason
    // uit een met de hand toegepaste migratie komt (zie bank-ignored-excluded). Valt weg naar leeg,
    // wat daar het ware antwoord is: zonder die kolom kan geen regel een reden dragen.
    excludedBankIds: await readExcludedBankIds({ client: pipeline, userId: ownerId, start: startBuffer, end: endBuffer }),
    cashRows,
    turnoverRows,
    eftRows,
    pinLedgerRows,
    pinLedgerAvailable,
    kas,
    datelessRows,
  });
}
