// src/app/api/readiness/route.ts
// [READINESS] The owner's "ben ik klaar voor de boekhouder?" verdict for a quarter.
// A pure PROJECTION over the truth layer: it gathers the SAME signals the other surfaces
// already compute — invoice evidence (summarizeClosingPackage), bank reconciliation
// (bank-identity), till reconciliation (buildTurnoverClosing), and BTW completeness
// (computeResult + buildAangifte) — and hands them to buildReadiness for one score + the
// short missing/risks lists. No new financial logic; every figure traces to imported data.
// Owner-scoped (self). Read-only.

import { fetchAllRows } from "@/lib/supabase-paginate";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { summarizeClosingPackage } from "@/lib/closing-package";
import { computeResult, toResultBankTx, cardBudgetBound, type ResultInvoice, type ResultBankTx, type ResultCashEntry } from "@/lib/financial-result";
import { turnoverNetOmzet, type DailyTurnover } from "@/lib/turnover";
import { buildTurnoverClosing } from "@/lib/turnover-closing";
import { buildAangifte, type AangifteCompleteness } from "@/lib/aangifte";
import { needsDocument } from "@/lib/bank-identity";
import { reconcileTriangle, bankNetByDay } from "@/lib/triangle";
import type { EftSettlement } from "@/lib/eft-parser";
import { buildReadiness, type ReadinessSignals } from "@/lib/readiness";
import { buildKasboek, openingBalanceForQuarter, lowestDrawerPoint, type KasTurnoverDay, type KasEntry, type Quarter } from "@/lib/kasboek";
import { resolveQuarterOwner } from "@/lib/accountant-access";
import { quarterFromParams } from "@/lib/quarter";

export const dynamic = "force-dynamic";

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
    .select("amount, category, invoice_id, date, status, description, counterpart_name")
    .eq("user_id", ownerId).gte("date", start).lte("date", end)
    .order("id", { ascending: true }).range(from, to));
  let undocumentedCount = 0;
  // [TRUST-READY] Count received payments (credits) we can't yet explain: pending,
  // no linked invoice, and no category at all. Card takings are auto-categorised
  // 'pos_income' on import and are reconciled via the till triangle, so they carry a
  // category and are correctly excluded here — this counts only genuinely unresolved
  // income, the "money in with no invoice" that readiness never used to see.
  let unmatchedIncomeCount = 0;
  for (const t of bank) {
    const credit = (t.amount ?? 0) > 0;
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

  // ── 3) Invoices + cash for the VAT engine (same inputs as /api/aangifte) ──
  const invRaw = await fetchAllRows((from, to) => pipeline
    .from("invoices")
    .select("direction, status, total_ex_btw, btw_amount, client_btw_number, sender_id, receiver_id, field_confidence")
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
  const invoices: ResultInvoice[] = invRaw.map((i) => ({
    direction: effDir(i),
    status: i.status, total_ex_btw: i.total_ex_btw, btw_amount: i.btw_amount,
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
  const { data: turnoverRows } = await pipeline
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", ownerId).gte("turnover_date", startBuffer).lte("turnover_date", end);
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
  const result = computeResult(invoices, bankTx, cashEntries, turnover, coveredDates, 0, coveredBudget);

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

  const OUT_OK = new Set(["paid", "sent", "overdue"]);
  const IN_OK = new Set(["paid", "received"]);
  const completeness: AangifteCompleteness = {
    turnoverDays: turnover.length,
    quarterDays,
    incomingInvoiceCount: invRaw.filter((i) => effDir(i) === "incoming" && IN_OK.has(i.status ?? "")).length,
    outgoingInvoiceCount: invRaw.filter((i) => effDir(i) === "outgoing" && OUT_OK.has(i.status ?? "")).length,
    hasEuPurchase: invRaw.some((i) => effDir(i) === "incoming" && IN_OK.has(i.status ?? "") && typeof i.client_btw_number === "string" && EU_VAT.test(i.client_btw_number.trim())),
  };
  const aangifte = buildAangifte(result, completeness, quarterLabel);
  const hasUndecidableRate = aangifte.rows.some((r) => r.code === "1c");

  // ── 5b) [KAS-NEGATIEF] The running cash drawer — did it ever go below zero this quarter? ──
  // Recomputed EXACTLY like /api/kasboek (same inputs + same opening seed) so the readiness verdict
  // and the accountant's kasboek agree on the drawer figure. Needs FULL HISTORY (everything up to
  // quarter end, not just in-quarter) to carry the correct opening balance, and MUST paginate
  // (fetchAllRows) — a truncated opening balance would be a wrong number (the task-#36 bug class).
  const kasTurnoverRows = await fetchAllRows((from, to) => pipeline
    .from("daily_turnover").select("turnover_date, cash_amount")
    .eq("user_id", ownerId).lte("turnover_date", end)
    .order("turnover_date", { ascending: true }).range(from, to));
  const kasEntryRows = await fetchAllRows((from, to) => pipeline
    .from("cash_entries").select("entry_date, direction, amount, category, description")
    .eq("user_id", ownerId).lte("entry_date", end)
    .order("entry_date", { ascending: true }).range(from, to));
  const { data: kasProfile } = await pipeline
    .from("profiles").select("kas_opening_balance").eq("id", ownerId).maybeSingle();
  const kasTurnover = (kasTurnoverRows ?? []) as KasTurnoverDay[];
  const kasEntries = (kasEntryRows ?? []) as unknown as KasEntry[];
  const kasStarting = Number((kasProfile as { kas_opening_balance?: number | null } | null)?.kas_opening_balance) || 0;
  const kasOpening = openingBalanceForQuarter({ turnover: kasTurnover, entries: kasEntries, year, quarter: quarter as Quarter, startingBalance: kasStarting });
  const kasboek = buildKasboek({ turnover: kasTurnover, entries: kasEntries, year, quarter: quarter as Quarter, openingBalance: kasOpening });
  const negativeCashDay = lowestDrawerPoint(kasboek);

  // ── 6) Assemble the signals → the verdict ──
  const signals: ReadinessSignals = {
    quarterLabel,
    verifiedInvoiceCount,
    invoicesWithEvidence,
    unverifiedInvoiceCount,
    autoVerifiedCount,
    missingEvidence: [], // exact COUNT drives the score; specific numbers aren't surfaced here
    bankTxCount: bank.length,
    undocumentedCount,
    unmatchedIncomeCount,
    probablePaymentAsOmzetCount,
    usesTurnover: turnover.length > 0,
    turnoverDays: turnover.length,
    reconExceptions,
    hasSales: result.salesByRate.length > 0 || result.cashOmzetZonderBtw > 0,
    cashOmzetZonderBtw: result.cashOmzetZonderBtw,
    omzetZonderBtwNonCash: result.omzetZonderBtwNonCash,
    quarterDays,
    hasUndecidableRate,
    hasEuPurchase: completeness.hasEuPurchase,
    negativeCashDay, // [KAS-NEGATIEF] a below-zero drawer blocks "klaar"
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
