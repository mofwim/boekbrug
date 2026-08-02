// src/app/api/readiness/route.ts
// [READINESS] The owner's "ben ik klaar voor de boekhouder?" verdict for a quarter.
// A pure PROJECTION over the truth layer: it gathers the SAME signals the other surfaces
// already compute — invoice evidence (summarizeClosingPackage), bank reconciliation
// (bank-identity), till reconciliation (buildTurnoverClosing), and BTW completeness
// (computeResult + buildAangifte) — and hands them to buildReadiness for one score + the
// short missing/risks lists. No new financial logic; every figure traces to imported data.
// Owner-scoped (self). Read-only.

import { fetchAllRows } from "@/lib/supabase-paginate";
// [STATEMENT-CONTINUITY] gaten TUSSEN de ingelezen bankafschriften (pure vergelijking).
import { findStatementGaps } from "@/lib/bank-statement-continuity";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { summarizeClosingPackage } from "@/lib/closing-package";
import { computeResult, toResultBankTx, cardBudgetBound, type ResultInvoice, type ResultBankTx, type ResultCashEntry } from "@/lib/financial-result";
import { turnoverNetOmzet, type DailyTurnover } from "@/lib/turnover";
import { buildTurnoverClosing } from "@/lib/turnover-closing";
import { buildAangifte, type AangifteCompleteness } from "@/lib/aangifte";
// [RUBRIEK-SPLIT] One helper, three surfaces — see the call site for why readiness needs it too.
import { fetchRateShares } from "@/lib/btw-rate-split-fetch";
import { collectVatExemption } from "@/lib/vat-exemption-collect";
import { exemptShareOf } from "@/lib/vat-exemption";
import { needsDocument } from "@/lib/bank-identity";
import { pnlRole } from "@/lib/bank-categories";
import { reconcileTriangle, bankNetByDay } from "@/lib/triangle";
import type { EftSettlement } from "@/lib/eft-parser";
import { buildReadiness, type ReadinessSignals } from "@/lib/readiness";
import { loadDrawerWitness } from "@/lib/drawer-witness";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { quarterFromParams } from "@/lib/quarter";
import { collectRegimeFlags, type RegimeInvoiceRef } from "@/lib/regime-collect";
import { resolveSchemeSettlements } from "@/lib/kas-payment-events-fetch";
import { collectBadDebt, collectVatClawback } from "@/lib/bad-debt-collect";
// [ICP] Sales to EU businesses: only the PROBLEMS reach readiness — see the call site.
import { buildIcp, type IcpInvoice } from "@/lib/icp";

export const dynamic = "force-dynamic";
// [RUNTIME] Deze route doet ~22 databaseronden per klant en wordt door het werkbord één
// keer per rij afgevuurd (MAX_PARALLEL = 4). Zonder plafond eindigt een trage rij als een
// stille timeout die het bord als "onbekend" toont.
export const maxDuration = 120;

function pad(n: number): string { return String(n).padStart(2, "0"); }
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// EU VAT prefixes (excl. NL) — the same honest rubriek-4b signal /api/aangifte uses.
const EU_VAT = /^(AT|BE|BG|CY|CZ|DE|DK|EE|ES|FI|FR|GR|EL|HR|HU|IE|IT|LT|LU|LV|MT|PL|PT|RO|SE|SI|SK)/i;

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  // [QUARTER] Honour ?year&quarter (bounded), else default to the LAST COMPLETED quarter —
  // the app-wide default (quarter.ts). Absent/absurd input can never yield the open quarter
  // or a nonsense year; a bare hit returns the same quarter the UI shows.
  const { year, quarter } = quarterFromParams((k) => sp.get(k));

  const startMonth = (quarter - 1) * 3;
  const start = `${year}-${pad(startMonth + 1)}-01`;
  const endD = new Date(Date.UTC(year, startMonth + 3, 0));
  const end = `${endD.getUTCFullYear()}-${pad(endD.getUTCMonth() + 1)}-${pad(endD.getUTCDate())}`;
  const quarterDays = Math.round((endD.getTime() - Date.UTC(year, startMonth, 1)) / 86400000) + 1;
  const quarterLabel = `Q${quarter} ${year}`;

  // [ACCOUNTANT-TRUTH] Dual-path: own quarter, OR a linked client's quarter for an
  // accountant (same authorization as /api/closing-package). Every data query below is
  // service_role and scoped to the resolved ownerId — never widened beyond it.
  const owner = await resolveQuarterOwner(supabase, user.id, sp.get("clientId"));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });
  const ownerId = owner.ownerId;

  // service_role, every query scoped to ownerId (mirrors /api/closing-package/summary).
  const pipeline = createPipelineClient();

  // ── 1) Invoice evidence — REUSE summarizeClosingPackage (single source of truth) ──
  let summary;
  try {
    summary = await summarizeClosingPackage({ ownerId: ownerId, year, quarter, supabase: pipeline });
  } catch (e) {
    const message = e instanceof Error ? e.message : "readiness summary failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const verifiedInvoiceCount = summary.outgoingCount + summary.incomingCount;
  // [READINESS-EVIDENCE] Use the invoices-with-PDF count, NOT filesIncluded — the latter also
  // counts bank-statement + shared files, which let the invoice-evidence dimension hit a false 100%
  // (dropping the "X facturen missen het originele document" gap) while verified invoices had no PDF.
  const invoicesWithEvidence = summary.invoicesWithPdf;

  // ── 2) Bank — transactions DATED in the quarter, and how many still need a bon ──
  const bank = await fetchAllRows((from, to) => pipeline
    .from("bank_transactions")
    .select("amount, category, category_confirmed, invoice_id, date, status, description, counterpart_name")
    .eq("user_id", ownerId).gte("date", start).lte("date", end)
    .order("id", { ascending: true }).range(from, to));
  let undocumentedCount = 0;
  // [AUTO-EXCLUDE-REVIEW] Lines the app auto-coded (category_confirmed !== true) into an EXCLUDED
  // identity — privé / overboeking / belasting (pnlRole 'excluded') — that the owner never reviewed.
  // An excluded line is dropped from omzet, kosten AND BTW, and is invisible to undocumentedCount
  // (skips non-'kosten') and unmatchedIncomeCount (needs a null category). So a MISlabelled one hides
  // a real cost/receipt with no trace. Surfaced as a review RISK (never a block); self-clearing on
  // confirm. Scoped to status='pending' AND no invoice_id so it MATCHES the review list the
  // "Controleer" deep-link opens (categorize ?scope=review) — every counted line is reachable there.
  let unreviewedExcludedCount = 0;
  // [TRUST-READY] Count received payments (credits) we can't yet explain: pending,
  // no linked invoice, and no category at all. Card takings are auto-categorised
  // 'pos_income' on import and are reconciled via the till triangle, so they carry a
  // category and are correctly excluded here — this counts only genuinely unresolved
  // income, the "money in with no invoice" that readiness never used to see.
  let unmatchedIncomeCount = 0;
  for (const t of bank) {
    const credit = (t.amount ?? 0) > 0;
    // [AUTO-EXCLUDE-REVIEW] An auto-coded, unconfirmed EXCLUDED line (transfer/prive/tax) — money the
    // app kept out of the books without the owner's review. Catches BOTH a hidden receipt (credit)
    // and a hidden cost (debit); category_confirmed !== true = never eyeballed. Scoped to
    // status='pending' AND no invoice_id to MATCH the review list the "Controleer" link opens
    // (categorize ?scope=review) — so every counted line is reachable and the risk is self-clearing;
    // a line that got matched/linked has been resolved by another flow and needs no re-review.
    if (
      t.status === "pending" &&
      !t.invoice_id &&
      t.category != null &&
      (t as { category_confirmed?: boolean | null }).category_confirmed !== true &&
      pnlRole(t.category) === "excluded"
    ) {
      unreviewedExcludedCount++;
    }
    // [TRUST-READY] Unexplained INCOME is a gap REGARDLESS of status: a credit with no
    // linked invoice and no category is money-in we can't place. Restricting to 'pending'
    // let a credit that was touched (status advanced by some other flow) but never
    // categorised or linked slip through → a false "klaar" with unbooked revenue. Card
    // takings are auto-categorised 'pos_income', so they carry a category and are excluded.
    if (credit && !t.invoice_id && t.category == null) {
      unmatchedIncomeCount++;
      continue;
    }
    // Cost side stays pending-scoped: a categorised/confirmed debit is already resolved.
    if (t.status === "pending" && !t.invoice_id && !credit) {
      const stillOpen =
        t.category == null
          ? needsDocument(t.counterpart_name, t.description, t.amount ?? 0)
          : t.category === "kosten";
      if (stillOpen) undocumentedCount++;
    }
  }

  // ── 2b) [STATEMENT-CONTINUITY] Ontbreekt er een STUK bankgeschiedenis in dit kwartaal? ──
  // De controle hierboven kijkt naar de transacties die er ZIJN. Deze kijkt naar het afschrift dat
  // er NIET is: januari en maart geüpload, februari vergeten — beide bestanden kloppen intern, er
  // zijn transacties genoeg, en toch mist er een maand aan betalingen. We halen de periodes op met
  // een marge van een maand rond het kwartaal (het gat zit vaak op de grens) en melden alleen de
  // gaten die het kwartaal zelf raken. Fail-soft: bestaat de tabel nog niet (migratie niet
  // gedraaid) of gaat de query mis, dan vervalt alleen deze extra controle.
  let bankGapMessages: string[] = [];
  try {
    const marginStart = new Date(Date.parse(`${start}T00:00:00Z`) - 45 * 86_400_000).toISOString().slice(0, 10);
    const marginEnd = new Date(Date.parse(`${end}T00:00:00Z`) + 45 * 86_400_000).toISOString().slice(0, 10);
    const { data: periods } = await pipeline
      .from("bank_statement_periods")
      .select("document_id, iban, period_start, period_end, opening_balance, closing_balance")
      .eq("user_id", ownerId)
      .gte("period_start", marginStart)
      .lte("period_start", marginEnd)
      .order("period_start", { ascending: true });

    const rows = (periods ?? []).filter((p) => p.period_start && p.period_end);
    if (rows.length >= 2) {
      const { issues } = findStatementGaps(
        rows.map((p) => ({
          documentId: p.document_id,
          iban: p.iban,
          from: p.period_start as string,
          to: p.period_end as string,
          opening: p.opening_balance,
          closing: p.closing_balance,
        })),
      );
      // Alleen gaten die dit kwartaal raken — een gat in een ander kwartaal is daar een gat,
      // niet hier. (Een overlap is geen ontbrekend stuk; die hoort op het bankscherm thuis,
      // niet als blokkade van de afsluiting.)
      bankGapMessages = issues
        .filter((i) => i.kind !== "overlap")
        .filter((i) => i.before.to <= end && i.after.from >= start)
        .map((i) => i.message)
        .slice(0, 5);
    }
  } catch {
    /* fail-soft — zonder deze controle blijft de rest van de readiness precies zoals hij was */
  }

  // ── 3) Invoices + cash for the VAT engine (same inputs as /api/aangifte) ──
  const invRaw = await fetchAllRows((from, to) => pipeline
    .from("invoices")
    .select("id, invoice_number, direction, status, total_ex_btw, btw_amount, client_btw_number, sender_id, receiver_id, field_confidence")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start).lte("invoice_date", end)
    .order("id", { ascending: true }).range(from, to));
  // [FIN-4] Infer a NULL direction from ownership — the SAME rule effectiveDirection uses
  // in the closing package — so a null-direction verified invoice is counted here too and
  // the readiness/aangifte screen never diverges from the ZIP.
  const effDir = (i: { direction: string | null; receiver_id: string | null }): "incoming" | "outgoing" =>
    i.direction === "incoming" || i.direction === "outgoing"
      ? i.direction
      : i.receiver_id === ownerId ? "incoming" : "outgoing";
  // [RUBRIEK-SPLIT] The same per-line rate shares /api/aangifte and the closing package feed in.
  // Leaving them out here was not neutral: 5a is the SUM OF THE ROUNDED rubrieken, so moving a
  // mixed-rate invoice's omzet between 1a and 1b changes the rounding of each bucket and can move
  // the total by a euro. This route publishes `concept.verschuldigd`, so without the split the
  // readiness card and the aangifte screen could quote different figures for the same quarter —
  // the screen-vs-ZIP divergence this file's own comments call out as a bug class.
  // The declared-status allow-lists, hoisted: the dateless check below needs them too.
  const OUT_OK = new Set(["paid", "sent", "overdue"]);
  const IN_OK = new Set(["paid", "received"]);

  // [VRIJGESTELD] Same shared collector as /api/aangifte and the closing package — readiness
  // judges whether the quarter can be filed, so it has to judge the SAME numbers the filing will
  // contain. Off-regime this costs one profile read and changes nothing.
  const exemption = await collectVatExemption({
    client: pipeline,
    ownerId,
    periodStart: start,
    incomingInvoiceIds: invRaw.filter((i) => effDir(i) === "incoming").map((i) => i.id).filter((id): id is string => !!id),
  });
  const { rateShares: rateSharesByInvoice, exemptExByInvoice } = await fetchRateShares(
    pipeline,
    invRaw.filter((i) => effDir(i) === "outgoing"),
    { exemptRegime: exemption.active },
  );
  const invoices: ResultInvoice[] = invRaw.map((i) => ({
    direction: effDir(i),
    status: i.status, total_ex_btw: i.total_ex_btw, btw_amount: i.btw_amount,
    rate_lines: i.id ? rateSharesByInvoice.get(i.id as string) ?? null : null,
    exempt_ex: i.id ? exemptExByInvoice.get(i.id as string) ?? null : null,
    vat_deduction: i.id ? exemption.deductionByInvoice.get(i.id as string) ?? null : null,
  }));
  // [PACKAGE-READINESS] Imported bills dated in the quarter still in the verify queue
  // (status 'processing') must block "klaar" — they'd otherwise reach the accountant nowhere.
  // Only 'processing' (the verify queue); a 'draft' is an unsent outgoing sales invoice, a
  // separate concern that must not falsely block the close.
  const unverifiedInvoiceCount = invRaw.filter((i) => i.status === "processing").length;
  // [AUTO-ADVANCE] Invoices the app auto-verified (booked, but the owner should eyeball them
  // at quarter close). field_confidence is jsonb; the _auto_verified marker is set by the
  // intake/email auto-advance path.
  const autoVerifiedCount = invRaw.filter((i) => {
    const fc = i.field_confidence as Record<string, unknown> | null;
    return !!(fc && typeof fc === "object" && fc._auto_verified);
  }).length;

  const cashRows = await fetchAllRows((from, to) => pipeline
    .from("cash_entries")
    .select("direction, amount, category, btw_rate, entry_date, document_id")
    .eq("user_id", ownerId).gte("entry_date", start).lte("entry_date", end)
    .order("id", { ascending: true }).range(from, to));
  const cashEntries: ResultCashEntry[] = cashRows.map((c) => ({
    direction: c.direction === "in" ? "in" : "out",
    amount: c.amount, category: c.category, btw_rate: c.btw_rate, date: c.entry_date,
    document_id: (c as { document_id?: string | null }).document_id ?? null, // [CASH-COST-VAT]
  }));

  // ── 4) Turnover (+ buffered covered set for cross-quarter settlement lag) ──
  const startBuffer = shiftDays(start, -5);
  // [TURNOVER-READ-ERROR] Not a discarded error — this route decides whether the owner is READY
  // to hand the quarter over. A failed read left turnoverRows null and the till's omzet absent,
  // so readiness judged a quarter it could not see and could answer "klaar" on data that never
  // arrived. fetchAllRows throws instead, which is the only honest outcome here.
  const turnoverRows = await fetchAllRows<{
    turnover_date: string; base_0: number | null; base_9: number | null; base_21: number | null;
    btw_9: number | null; btw_21: number | null; total_incl: number | null;
    pin_amount: number | null; cash_amount: number | null; other_amount: number | null;
  }>((from, to) => pipeline
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", ownerId).gte("turnover_date", startBuffer).lte("turnover_date", end)
    .order("turnover_date", { ascending: true }).range(from, to));
  const allTurnover: DailyTurnover[] = (turnoverRows ?? []).map((t) => ({
    turnover_date: t.turnover_date,
    base_0: t.base_0 ?? 0, base_9: t.base_9 ?? 0, base_21: t.base_21 ?? 0,
    btw_9: t.btw_9 ?? 0, btw_21: t.btw_21 ?? 0,
    total_incl: t.total_incl, pin_amount: t.pin_amount, cash_amount: t.cash_amount, other_amount: t.other_amount,
  }));
  const turnover = allTurnover.filter((t) => t.turnover_date >= start);
  const coveredDates = new Set(
    allTurnover.filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0).map((t) => t.turnover_date),
  );

  // Till reconciliation exceptions (the retail triangle) — only when a till is used.
  let reconExceptions: ReadinessSignals["reconExceptions"] = [];
  if (turnover.length > 0) {
    const [posRows, cashOmzetRows] = await Promise.all([
      fetchAllRows((from, to) => pipeline.from("bank_transactions").select("description, amount")
        .eq("user_id", ownerId).eq("category", "pos_income")
        .gte("date", shiftDays(start, -5)).lte("date", shiftDays(end, 5))
        .order("id", { ascending: true }).range(from, to)),
      fetchAllRows((from, to) => pipeline.from("cash_entries").select("entry_date, amount")
        .eq("user_id", ownerId).eq("category", "omzet")
        .gte("entry_date", start).lte("entry_date", end)
        .order("id", { ascending: true }).range(from, to)),
    ]);
    const posLines = posRows.map((p) => ({ description: p.description, amount: p.amount }));
    const cashOmzet = cashOmzetRows.map((c) => ({ date: c.entry_date, amount: c.amount }));
    const tc = buildTurnoverClosing(turnover, posLines, cashOmzet);
    reconExceptions = tc.exceptions.map((e) => ({ date: e.date, kind: e.kind, note: e.note, diff: e.diff }));
  }

  // ── 5) The VAT engine + concept aangifte ──
  // Bank lines DO enter the engine: a bank line categorized 'omzet'/'pos_income' with no
  // linked invoice or Z-report is revenue with NO BTW rate. If readiness ignored it (the
  // old bank=[]), a quarter whose only VAT gap is undeclared bank revenue could still score
  // "klaar" — while /api/result and /api/aangifte counted it. computeResult surfaces it as
  // omzet-zonder-tarief (cashOmzetZonderBtw), which blocks readiness, so all three agree.
  // Card takings reconciled to a Z-report are excluded via the shared toResultBankTx mapper
  // (settleDate + coveredDates), which also catches an acquirer payout the owner mis-tapped
  // as 'omzet' so readiness agrees exactly with /api/result and /api/aangifte.
  const bankTx: ResultBankTx[] = bank.map(toResultBankTx);
  const coveredBudget = new Map(
    allTurnover
      .filter((t) => turnoverNetOmzet(t) > 0 || (t.total_incl ?? 0) > 0)
      .map((t) => [t.turnover_date, cardBudgetBound(t)] as const),
  );
  // [KASSTELSEL] Resolve the VAT basis for THIS quarter and, under kas, the settlement inputs.
  // Default factuur → the accrual path is byte-identical. Under kas the readiness figures + the
  // klaar-gate reflect BTW on the paid date, and undated paid money blocks "klaar" (below).
  // [VRIJGESTELD] The regime travels in: under kas the settled invoices are a different set
  // from the dated ones, so their exempt parts have to be read there too.
  const sr = await resolveSchemeSettlements(pipeline, ownerId, start, start, end, exemption.active);

  // [DATE-GAP] A verified invoice with NO invoice_date is dropped by the range filter above, so
  // it is in none of the figures — and readiness never said so, while /api/aangifte warns about
  // exactly this ("telt NIET mee in dit kwartaal"). "Klaar, 100%" beside that warning is two
  // surfaces disagreeing about whether the quarter is complete. Under KAS the invoice_date is
  // irrelevant (invoices enter by payment date), so the check is factuurstelsel-only — the
  // analogous cash-basis signal is undatedPaidCount, which already blocks below.
  let datelessVerifiedCount = 0;
  if (sr.scheme !== "kas") {
    const datelessRaw = await fetchAllRows((from, to) => pipeline
      .from("invoices")
      .select("status, receiver_id, direction")
      .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
      .is("invoice_date", null)
      .order("id", { ascending: true }).range(from, to));
    datelessVerifiedCount = datelessRaw.filter((i) => {
      const dir = i.direction === "incoming" || i.direction === "outgoing"
        ? i.direction : (i.receiver_id === ownerId ? "incoming" : "outgoing");
      return dir === "incoming" ? IN_OK.has(i.status ?? "") : OUT_OK.has(i.status ?? "");
    }).length;
  }

  // [TRIANGLE-ZERO] Acquirer commission = 0 on purpose — same reasoning as the closing package.
  // Readiness reads only the BTW/omzet fields off this result (hasSales, cashOmzetZonderBtw,
  // omzetZonderBtwNonCash, and the KOR turnover check); the commission is a cost with no BTW and
  // cannot move any of them. /api/result, which reports profit, books it. The triangle IS run
  // below — for the card-mismatch risk, not for a money figure.
  const result = computeResult(invoices, bankTx, cashEntries, turnover, coveredDates, 0, coveredBudget, {
    ...sr.opts,
    exemptRegime: exemption.active,
    deductionByInvoice: exemption.deductionByInvoice,
    exemptShareByInvoice: exemptShareOf(invRaw, exemptExByInvoice),
  });

  // [S3 · TRIANGLE-READY] The till-vs-terminal (EFT) leg of the card triangle — a day where the
  // terminal afrekening ≠ the till's PIN takings (a missing bon, a skim, a terminal fault) — is
  // flagged on /api/result and in the ZIP but was INVISIBLE to readiness, so a real card
  // discrepancy the accountant would catch could still pass "klaar". Reconcile it here too (same
  // pure reconcileTriangle) and add the disagreeing days as RISKS, so the readiness verdict never
  // hides a card mismatch. Only gross-mismatch days (a genuine discrepancy) are surfaced — an
  // 'incomplete' day is just a payout not yet settled (normal near quarter-end), not an error.
  // Witness-only + best-effort: a fetch hiccup must never fail the readiness verdict.
  if (turnover.length > 0) {
    try {
      const endBuffer = shiftDays(end, 5);
      const { data: eftRows } = await pipeline
        .from("eft_settlements")
        .select("settlement_date, terminal_id, period_nr, shift_nr, period_start, period_end, first_trx, last_trx, gross_total, tx_count, by_scheme")
        .eq("user_id", ownerId).gte("settlement_date", start).lte("settlement_date", end);
      const eftSettlements: EftSettlement[] = (eftRows ?? []).map((e) => ({
        terminalId: e.terminal_id, periodNr: e.period_nr, shiftNr: e.shift_nr,
        periodStart: e.period_start, periodEnd: e.period_end, firstTrx: e.first_trx, lastTrx: e.last_trx,
        settlementDate: e.settlement_date, grossTotal: e.gross_total ?? 0, txCount: e.tx_count ?? 0,
        byScheme: (Array.isArray(e.by_scheme) ? e.by_scheme : []) as unknown as EftSettlement["byScheme"],
      }));
      const posBufRows = await fetchAllRows((from, to) => pipeline
        .from("bank_transactions").select("description, amount, date")
        .eq("user_id", ownerId).eq("category", "pos_income")
        .gte("date", startBuffer).lte("date", endBuffer)
        .order("id", { ascending: true }).range(from, to));
      const netByDay = bankNetByDay(posBufRows.map((b) => ({ description: b.description, amount: b.amount, date: b.date })));
      for (const k of [...netByDay.keys()]) if (k < start || k > end) netByDay.delete(k);
      const pinLedgerRows = await fetchAllRows<{ ledger_date: string; received: number | null; spent: number | null }>((from, to) => pipeline
        .from("ledger_daily").select("ledger_date, received, spent")
        .eq("user_id", ownerId).eq("kind", "pin")
        .gte("ledger_date", start).lte("ledger_date", end)
        .order("ledger_date", { ascending: true }).range(from, to)).catch(() => []);
      const pinLedgerByDay = new Map<string, number>();
      for (const r of pinLedgerRows) if (r.ledger_date) pinLedgerByDay.set(r.ledger_date, (Number(r.received) || 0) - (Number(r.spent) || 0));
      const triangle = reconcileTriangle({ turnover, eftSettlements, bankNetByDay: netByDay, pinLedgerByDay });
      const seen = new Set(reconExceptions.map((e) => e.date + "|" + e.kind));
      for (const d of triangle.days) {
        if (d.status !== "gross_mismatch") continue;
        const key = d.date + "|terminal";
        if (seen.has(key)) continue;
        seen.add(key);
        reconExceptions.push({
          date: d.date,
          kind: "terminal",
          note: `Kassa-PIN (${d.tillPin ?? "?"}) wijkt af van terminal-afrekening (${d.eftGross ?? "?"})`,
          diff: d.grossDiff ?? 0,
        });
      }
      // [S3-COMMISSION] A day with a card PAYOUT (net into the bank) + till PIN takings but NO
      // terminal settlement (eftGross) → the acquirer fee (gross − net) can't be booked as a cost,
      // so quarterly profit is silently OVERSTATED and readiness would still say 'klaar'. Surface it
      // as a risk with the fix (upload that day's terminal-afrekening) so fees are never silently
      // unbooked. Only when a real positive fee exists (net < gross), never on a refund/partial day.
      for (const d of triangle.days) {
        if (d.eftGross != null) continue;                    // has a terminal receipt → fee is booked
        if (!(typeof d.tillPin === "number" && d.tillPin > 0)) continue;
        if (!(typeof d.bankNet === "number" && d.bankNet > 0)) continue;
        const feeApprox = Math.round((d.tillPin - d.bankNet) * 100) / 100;
        if (feeApprox <= 0.01) continue;                     // net ≥ gross → no fee to book
        const key = d.date + "|commission";
        if (seen.has(key)) continue;
        seen.add(key);
        reconExceptions.push({
          date: d.date,
          kind: "terminal",
          note: `Betaalkosten (~€${feeApprox.toFixed(2)}) nog niet geboekt — upload de terminal-afrekening van deze dag zodat de commissie als kosten meetelt`,
          diff: feeApprox,
        });
      }
    } catch {
      /* triangle is a witness; never let it fail the readiness verdict */
    }
  }

  // [RD6] Spot a bank credit booked as 'omzet' whose amount equals an existing outgoing invoice —
  // probably that invoice's PAYMENT mis-tapped as new revenue, which double-counts the sale (the
  // invoice already booked it accrual, possibly in a prior quarter). Exact-cent + outgoing only.
  const outgoingGrossCents = new Set<number>();
  for (const i of invRaw) {
    if (effDir(i) !== "outgoing") continue;
    const cents = Math.round(((i.total_ex_btw ?? 0) + (i.btw_amount ?? 0)) * 100);
    if (cents > 0) outgoingGrossCents.add(cents);
  }
  let probablePaymentAsOmzetCount = 0;
  for (const t of bank) {
    if ((t.amount ?? 0) > 0 && !t.invoice_id && t.category === "omzet") {
      if (outgoingGrossCents.has(Math.round((t.amount ?? 0) * 100))) probablePaymentAsOmzetCount++;
    }
  }

  const completeness: AangifteCompleteness = {
    turnoverDays: turnover.length,
    quarterDays,
    incomingInvoiceCount: invRaw.filter((i) => effDir(i) === "incoming" && IN_OK.has(i.status ?? "")).length,
    outgoingInvoiceCount: invRaw.filter((i) => effDir(i) === "outgoing" && OUT_OK.has(i.status ?? "")).length,
    hasEuPurchase: invRaw.some((i) => effDir(i) === "incoming" && IN_OK.has(i.status ?? "") && typeof i.client_btw_number === "string" && EU_VAT.test(i.client_btw_number.trim())),
  };
  // [ICP] Deliberately built WITHOUT intraEuOmzet, unlike /api/aangifte. Moving turnover from 1e
  // to 3b cannot change 5a, 5b or 5g (both rubrieken carry €0 BTW), and those three are the only
  // figures this route exposes — so the two concepts are identical here, and rebuilding the ICP
  // just to reach the same numbers would be work that proves nothing.
  const aangifte = buildAangifte(result, completeness, quarterLabel);
  const hasUndecidableRate = aangifte.rows.some((r) => r.code === "1c");

  // ── 5b) [KAS-NEGATIEF] The running cash drawer — did it ever go below zero this quarter? ──
  // Recomputed EXACTLY like /api/kasboek (same inputs + same opening seed) so the readiness verdict
  // and the accountant's kasboek agree on the drawer figure. Needs FULL HISTORY (everything up to
  // quarter end, not just in-quarter) to carry the correct opening balance, and MUST paginate
  // (fetchAllRows) — a truncated opening balance would be a wrong number (the task-#36 bug class).
  // [KAS-NEGATIEF] Via the shared witness, so this verdict and the filing gate that now refuses
  // on it read the exact same number from the exact same rows. It also closes the one read here
  // that swallowed its error: `const { data: kasProfile }` made a failed profile read look like a
  // €0 starting float, which drags the whole running balance down and can INVENT a negative day
  // on a drawer that was never negative — a fabricated blocker on the screen whose job is to say
  // whether the owner may hand the quarter over. The helper throws instead; fetchAllRows already
  // did, so the route's failure behaviour is unchanged for the two ledgers.
  const { lowestPoint: negativeCashDay } = await loadDrawerWitness({
    client: pipeline, ownerId, year, quarter,
  });

  // ── 5c) [REGIME-FLAGS] Special BTW regimes the concept can't auto-compute (KOR / verlegd /
  // marge). Owner declares KOR (profiles.kor_active); verlegd/marge are phrase-gated on the
  // owner's own invoice-line texts (fetched by invoice_id, tenant-safe). Surfaced as RISKS.
  // [DEPLOY-SAFE] kor_active is fetched in its OWN query — never folded into the kas_opening_balance
  // select above — so if the regime_kor.sql migration lags this deploy, a missing column only nulls
  // korActive (→ no flags), and can NEVER collaterally drop the opening balance (a wrong number). ──
  const { data: korProfile } = await pipeline
    .from("profiles").select("kor_active").eq("id", ownerId).maybeSingle();
  const korActive = !!(korProfile as { kor_active?: boolean | null } | null)?.kor_active;
  const regimeInvoices: RegimeInvoiceRef[] = invRaw.map((i) => ({
    id: String(i.id),
    direction: effDir(i),
    label: (i.invoice_number as string | null) ?? null,
  }));
  // [VRIJGESTELD] Exempt turnover is added back for this yardstick, so the KOR check sees exactly
  // the total it always saw. It is no longer in salesByRate (it belongs in no rubriek), and
  // dropping it here would silently make the KOR-limit flag fire LATER for an exempt owner —
  // a change to an unrelated regime, caused by a feature that has no business touching it.
  // Whether art. 11 turnover counts toward the EUR 20.000 limit is a legal question this app does
  // not decide; the flag only ever says "let your accountant check".
  const omzetForKorCheck =
    result.salesByRate.reduce((sum, r) => sum + (r.omzet ?? 0), 0)
    + (result.cashOmzetZonderBtw ?? 0)
    + (result.vrijgesteldeOmzet ?? 0);
  const regimeFlags = await collectRegimeFlags({
    client: pipeline,
    korActive,
    omzetForKorCheck,
    invoices: regimeInvoices,
  }).catch(() => []);

  // [BAD-DEBT] Reclaimable BTW on sales invoices >1 year past due (factuur only; kas → none).
  const badDebt = await collectBadDebt(pipeline, ownerId, sr.scheme, end);
  // [BAD-DEBT] Art. 29 lid 7 — the mirror: voorbelasting on purchase invoices >1 year unpaid
  // becomes payable again. korActive short-circuits it (nothing was deducted, so nothing goes
  // back), which is why it is read after the KOR profile above.
  const vatClawback = await collectVatClawback(pipeline, ownerId, sr.scheme, end, korActive);

  // [ICP] The ICP-opgaaf itself belongs on the aangifte screen and in the accountant's ZIP, not
  // in a readiness score. What DOES belong here is the part that cannot be filed as it stands: an
  // opgaaf the Belastingdienst rejects counts as not done, and the owner is the only one who can
  // fix the invoice behind it. Names are not needed to count, so they are not fetched.
  const icpProblems = buildIcp({
    korActive,
    invoices: invRaw.map((i): IcpInvoice => ({
      invoiceNumber: (i.invoice_number as string | null) ?? null,
      clientName: null,
      clientVatNumber: (i.client_btw_number as string | null) ?? null,
      direction: effDir(i),
      status: (i.status as string | null) ?? null,
      totalExBtw: i.total_ex_btw as number | null,
      btwAmount: i.btw_amount as number | null,
    })),
  }).problems.length;

  // ── 6) Assemble the signals → the verdict ──
  const signals: ReadinessSignals = {
    quarterLabel,
    year,
    quarter, // [AUTO-EXCLUDE-REVIEW] scope the review deep-link to this quarter (counted ⟺ shown)
    verifiedInvoiceCount,
    invoicesWithEvidence,
    unverifiedInvoiceCount,
    autoVerifiedCount,
    // [EVIDENCE] De exacte factuurnummers zonder PDF. summarizeClosingPackage bouwt deze
    // lijst al (closing-package.ts:935) en gooide hem weg; readiness.ts:201-204 had de tak
    // die hem afdrukt al geschreven, maar die was onbereikbaar achter een lege array.
    // Gevolg: de eigenaar las "4 facturen missen het originele document" en kon alleen nog
    // álle facturen openen om te vinden welke vier. Nu is het een zin die hij doorstuurt.
    missingEvidence: summary.missingEvidence ?? [],
    bankTxCount: bank.length,
    undocumentedCount,
    unmatchedIncomeCount,
    probablePaymentAsOmzetCount,
    unreviewedExcludedCount, // [AUTO-EXCLUDE-REVIEW] auto-coded privé/overboeking/belasting, unreviewed
    // [STATEMENT-CONTINUITY] ontbrekende periode / saldobreuk tussen de ingelezen afschriften
    bankGapMessages,

    usesTurnover: turnover.length > 0,
    turnoverDays: turnover.length,
    reconExceptions,
    // [VRIJGESTELD] Exempt turnover IS a sales side. Without it a fully exempt owner reports
    // hasSales:false, and readiness then skips its entire sales block as "not applicable" —
    // the gate quietly stops checking the one thing that owner's quarter is made of.
    hasSales: result.salesByRate.length > 0 || result.cashOmzetZonderBtw > 0 || result.vrijgesteldeOmzet > 0,
    cashOmzetZonderBtw: result.cashOmzetZonderBtw,
    omzetZonderBtwNonCash: result.omzetZonderBtwNonCash,
    quarterDays,
    hasUndecidableRate,
    hasEuPurchase: completeness.hasEuPurchase,
    negativeCashDay, // [KAS-NEGATIEF] a below-zero drawer blocks "klaar"
    regimeFlags,     // [REGIME-FLAGS] KOR / verlegd / marge → risks, never a block
    undatedPaidCount: sr.undatedPaidCount,       // [KASSTELSEL] undated paid money blocks "klaar"
    estimatedPaidCount: sr.estimatedPortionCount, // [KASSTELSEL] estimated pay-date → risk
    // [DATE-GAP] De samenvatting berekent dit al (datelessVerifiedInvoices → warning
    // 'invoice_no_date'); dit scherm las het alleen niet. Geen extra query, geen nieuw veld —
    // we lezen de waarschuwing die er toch al is, en tellen het aantal uit haar tekst niet mee
    // maar uit de aanwezigheid: één risico volstaat om "stil 100% klaar" onmogelijk te maken.
    datelessInvoiceCount: summary.warnings.some((w) => w.code === "invoice_no_date") ? 1 : 0,
    badDebt: badDebt.eligible.length > 0
      ? { count: badDebt.eligible.length, reclaimableBtw: badDebt.totalReclaimableBtw }
      : undefined, // [BAD-DEBT] reclaimable BTW on >1yr-unpaid sales → risk, never a block
    vatClawback: vatClawback.eligible.length > 0
      ? { count: vatClawback.eligible.length, repayableBtw: vatClawback.totalRepayableBtw }
      : undefined, // [BAD-DEBT] repayable voorbelasting on >1yr-unpaid purchases → risk, never a block
    icpProblems, // [ICP] EU sales that cannot go on the opgaaf as they stand → risk
    datelessVerifiedCount, // [DATE-GAP] verified invoices with no date → they count nowhere
  };
  const report = buildReadiness(signals);

  return NextResponse.json({
    ok: true,
    year,
    quarter,
    report,
    // The concept BTW figures the owner can hand over (same as /api/aangifte).
    concept: {
      verschuldigd: aangifte.verschuldigd,
      voorbelasting: aangifte.voorbelasting,
      saldo: aangifte.saldo,
    },
  });
}
