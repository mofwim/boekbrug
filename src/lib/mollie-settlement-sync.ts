// src/lib/mollie-settlement-sync.ts
// [MOLLIE-AFREKENING] Read the owner's Mollie settlements and book what they prove. Server only.
//
// The decisions live in mollie-settlement.ts (pure, tested). This module is the pipeline around
// them: read the connection, page the API, keep one row per settlement, write the fee invoice
// through the one locked door (apply_manual_payment), and code the payout bank line as a transfer
// when — and only when — every payment in it settled a BoekBrug invoice.
//
// ── WHAT MAY DEGRADE, AND WHAT MAY NOT ──
// A settlement that does not reconcile, a link whose payments cannot be listed, a bank line that
// is not found: each is recorded on the settlement's row (status 'held' or 'refused', with the
// reason) and books nothing. Nothing here ever guesses a category or an amount. The cron survives
// every one of them and reports counts; the owner's Mollie card shows the last error.
//
// [ZELF-EERST] Under "ik kijk zelf naar alles" the fee invoice enters the queue as 'processing'
// and is NOT marked paid — the owner confirms it, then marks it paid like any other. Otherwise it
// books as 'received' and is settled at once on the settlement date: the fee was deducted at
// source, there is no bank line for it and there never will be.

import { amsterdamToday } from "@/lib/format-nl";
import { getMollieConnection, setMollieConnectionError } from "@/lib/mollie-connection";
import { listMollieSettlements, listMollieSettlementPayments, listMolliePaymentLinkPayments } from "@/lib/mollie";
import {
  feeInvoiceFrom, isPayoutOf, payoutLineVerdict, splitPayments, summarizeSettlement, MOLLIE_SUPPLIER_NAME,
  type SettlementSummary,
} from "@/lib/mollie-settlement";
import { resolveSupplierForImport } from "@/lib/supplier-registry";
import { autoBoekenAllowed } from "@/lib/auto-boeken";
import { createNotification } from "@/lib/notifications";
import { reportHandledFailure } from "@/lib/report-handled";
import { readDoubleBookingGuard } from "@/lib/bank-double-booking";

// mollie_settlements and mollie_payment_links are not in the generated types (mollie.sql is
// applied by hand) — the same relaxed client the webhook uses, for the same reason.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipeline = any;

export interface SettlementSyncResult {
  connected: boolean;
  seen: number;
  booked: number;
  held: number;
  refused: number;
  errors: string[];
}

/** How many settlements back one run looks. Mollie pays out daily at most; a month is plenty. */
const SETTLEMENTS_PER_RUN = 40;

type SettlementRow = { id: string; settlement_id: string; status: string; fee_invoice_id: string | null; payout_tx_id: string | null };

export async function syncMollieSettlementsForOwner(pipeline: Pipeline, userId: string): Promise<SettlementSyncResult> {
  const out: SettlementSyncResult = { connected: false, seen: 0, booked: 0, held: 0, refused: 0, errors: [] };
  const conn = await getMollieConnection(userId);
  if (!conn) return out;
  out.connected = true;

  const listed = await listMollieSettlements(conn.apiKey, SETTLEMENTS_PER_RUN);
  if ("error" in listed) {
    out.errors.push(listed.error);
    await setMollieConnectionError(userId, `Afrekeningen lezen mislukt: ${listed.error}`.slice(0, 500));
    return out;
  }

  const { data: knownRows, error: knownErr } = await pipeline
    .from("mollie_settlements")
    .select("id, settlement_id, status, fee_invoice_id, payout_tx_id")
    .eq("user_id", userId);
  if (knownErr) {
    out.errors.push(`mollie_settlements lezen mislukt: ${knownErr.message}`);
    return out;
  }
  const known = new Map<string, SettlementRow>((knownRows ?? []).map((r: SettlementRow) => [r.settlement_id, r]));

  const autoBoeken = await autoBoekenAllowed(pipeline, userId);

  for (const s of listed) {
    if (s.status !== "paidout") continue;
    const existing = known.get(s.id);
    // Done is done; a held row gets another look (the bank line may have arrived since).
    if (existing && existing.status === "booked") continue;
    out.seen++;
    try {
      const verdict = summarizeSettlement(s);
      if (!verdict.ok) {
        out.refused++;
        await upsertRow(pipeline, userId, s.id, { reference: s.reference ?? null, status: "refused", last_error: verdict.reason });
        continue;
      }
      const summary = verdict.summary;

      // ── The payments: ours or not ──
      const payments = await listMollieSettlementPayments(conn.apiKey, s.id);
      if ("error" in payments) {
        out.held++;
        await upsertRow(pipeline, userId, s.id, { ...figures(summary), status: "held", last_error: payments.error });
        continue;
      }
      const ourIds = await ourPaymentIds(pipeline, userId, conn.apiKey, payments.map((p) => p.id));
      const split = splitPayments(payments, ourIds);

      // ── The fee: a purchase from Mollie, paid by deduction ──
      let feeInvoiceId: string | null = existing?.fee_invoice_id ?? null;
      const fee = feeInvoiceFrom(summary);
      if (fee && !feeInvoiceId) {
        const rowId = existing?.id ?? (await upsertRow(pipeline, userId, s.id, { ...figures(summary), status: "held" }));
        feeInvoiceId = await bookFeeInvoice(pipeline, userId, rowId, fee, summary, autoBoeken);
      }

      // ── The payout bank line ──
      let payoutTxId: string | null = existing?.payout_tx_id ?? null;
      const lineVerdict = payoutLineVerdict(split);
      if (!payoutTxId) payoutTxId = await codePayoutLine(pipeline, userId, summary, lineVerdict);

      const complete = (fee === null || feeInvoiceId !== null) && payoutTxId !== null && lineVerdict === "transfer";
      const reason = lineVerdict === "hold"
        ? `€ ${split.unlinkedGross.toFixed(2)} van de betalingen hoort niet bij een BoekBrug-factuur (${split.unlinkedCount} betalingen${split.unreadable.length ? `, ${split.unreadable.length} onleesbaar` : ""}) — die omzet boek je zelf; de bankregel blijft open`
        : payoutTxId === null ? "bankregel van de uitbetaling nog niet gevonden" : null;
      await upsertRow(pipeline, userId, s.id, {
        ...figures(summary),
        linked_gross: split.linkedGross,
        unlinked_gross: split.unlinkedGross,
        unlinked_count: split.unlinkedCount,
        fee_invoice_id: feeInvoiceId,
        payout_tx_id: payoutTxId,
        status: complete ? "booked" : "held",
        last_error: reason,
      });
      if (complete) out.booked++; else out.held++;

      // Say it once: revenue the app never saw is the owner's to book, and silence would leave a
      // bank credit that never explains itself.
      if (lineVerdict === "hold" && !existing) {
        await createNotification({
          userId,
          type: "payment",
          title: "Mollie-uitbetaling met omzet buiten BoekBrug",
          body: `Afrekening ${summary.reference ?? s.id}: € ${split.unlinkedGross.toFixed(2)} aan betalingen die niet bij een factuur uit BoekBrug horen. Boek die omzet zelf; de bankregel van € ${summary.payout.toFixed(2)} wacht op jou.`,
          link: "/dashboard/bank",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.errors.push(`${s.id}: ${msg}`);
      await upsertRow(pipeline, userId, s.id, { reference: s.reference ?? null, status: "held", last_error: msg.slice(0, 500) }).catch(() => undefined);
    }
  }
  return out;
}

function figures(summary: SettlementSummary) {
  return {
    reference: summary.reference,
    settled_on: summary.settledOn,
    revenue_gross: summary.revenueGross,
    costs_net: summary.costsNet,
    costs_vat: summary.costsVat,
    costs_gross: summary.costsGross,
    payout: summary.payout,
  };
}

/** Upsert the settlement's row; returns its id. */
async function upsertRow(pipeline: Pipeline, userId: string, settlementId: string, patch: Record<string, unknown>): Promise<string> {
  const { data, error } = await pipeline
    .from("mollie_settlements")
    .upsert({ user_id: userId, settlement_id: settlementId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id,settlement_id" })
    .select("id")
    .single();
  if (error) throw new Error(`mollie_settlements schrijven mislukt: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Which of these payment ids belong to a BoekBrug payment link. Learned once per link from the
 * Payment Links API and stored on the link row, so the next settlement costs no calls.
 */
async function ourPaymentIds(pipeline: Pipeline, userId: string, apiKey: string, candidateIds: readonly string[]): Promise<Set<string>> {
  const { data: links, error } = await pipeline
    .from("mollie_payment_links")
    .select("id, link_id, payment_id, status")
    .eq("user_id", userId)
    .in("status", ["paid", "superseded", "open"]);
  if (error) throw new Error(`mollie_payment_links lezen mislukt: ${error.message}`);
  const ours = new Set<string>();
  const wanted = new Set(candidateIds);
  const unknown: { id: string; link_id: string }[] = [];
  for (const l of (links ?? []) as { id: string; link_id: string; payment_id: string | null; status: string }[]) {
    if (l.payment_id) ours.add(l.payment_id);
    else if (l.status === "paid") unknown.push({ id: l.id, link_id: l.link_id });
  }
  // Only links whose payment could be in THIS settlement are looked up; bounded per run.
  for (const l of unknown.slice(0, 50)) {
    const payments = await listMolliePaymentLinkPayments(apiKey, l.link_id);
    if ("error" in payments) throw new Error(`betalingen van link ${l.link_id} lezen mislukt: ${payments.error}`);
    const paid = payments.find((p) => p.status === "paid") ?? payments[0];
    if (!paid) continue;
    ours.add(paid.id);
    if (wanted.has(paid.id)) {
      await pipeline.from("mollie_payment_links").update({ payment_id: paid.id }).eq("id", l.id).eq("user_id", userId);
    }
  }
  return ours;
}

/** The fee invoice, through the same doors every purchase invoice takes. Returns the invoice id. */
async function bookFeeInvoice(
  pipeline: Pipeline, userId: string, settlementRowId: string,
  fee: NonNullable<ReturnType<typeof feeInvoiceFrom>>, summary: SettlementSummary, autoBoeken: boolean,
): Promise<string | null> {
  // The same number twice is the same fee twice: never insert a second row for one settlement.
  const { data: dup } = await pipeline
    .from("invoices").select("id").eq("receiver_id", userId).eq("direction", "incoming")
    .eq("invoice_number", fee.invoiceNumber).limit(1).maybeSingle();
  if (dup?.id) return dup.id as string;

  const supplier = await resolveSupplierForImport(pipeline, userId, { name: MOLLIE_SUPPLIER_NAME });
  const { data: inserted, error } = await pipeline
    .from("invoices")
    .insert({
      sender_id: null, receiver_id: userId, direction: "incoming",
      status: autoBoeken ? "received" : "processing",
      source: "created",
      supplier_id: supplier?.id ?? null,
      client_name: supplier?.name ?? MOLLIE_SUPPLIER_NAME,
      invoice_date: fee.invoiceDate, due_date: fee.invoiceDate,
      invoice_number: fee.invoiceNumber, invoice_type: "factuur",
      total_ex_btw: fee.totalExBtw, btw_amount: fee.btwAmount, total_inc_btw: fee.totalIncBtw,
      field_confidence: {
        // The trail: which settlement, which Mollie invoices, and that the amounts came from the
        // API and not from a read — so no grounding gate looks for a document that does not exist.
        _mollie_settlement: summary.settlementId,
        _mollie_invoice_ids: fee.mollieInvoiceIds,
        _source_note: "Kosten uit de Mollie Settlements API — bedragen exact zoals Mollie ze meldde.",
        amount: 1, vendor: 1, date: 1,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(`kostenfactuur Mollie schrijven mislukt: ${error.message}`);
  const invoiceId = (inserted as { id: string }).id;

  if (autoBoeken) {
    // Paid by deduction on the settlement date — the one locked door, keyed on the settlement
    // row so a second run cannot book the fee twice.
    const { error: payErr } = await pipeline.rpc("apply_manual_payment", {
      p_user_id: userId,
      p_invoice_id: invoiceId,
      p_amount: fee.totalIncBtw,
      p_pay_date: amsterdamToday(new Date(`${fee.invoiceDate}T12:00:00Z`)),
      p_method: "bank",
      p_payable_statuses: ["received"],
      p_client_key: settlementRowId,
    });
    if (payErr && !/duplicate|already/i.test(payErr.message ?? "")) {
      reportHandledFailure({
        tag: "MOLLIE-AFREKENING", severity: "data-integrity",
        message: "Mollie-kostenfactuur aangemaakt maar niet op betaald gezet",
        context: { userId, invoiceId, settlement: summary.settlementId, error: payErr.message },
      });
    }
  }
  return invoiceId;
}

/**
 * Find the payout bank line and, when every payment in it is ours, code it as a transfer. Returns
 * the line's id when found (coded or not), null when no line matched yet.
 */
async function codePayoutLine(pipeline: Pipeline, userId: string, summary: SettlementSummary, verdict: "transfer" | "hold"): Promise<string | null> {
  if (!summary.settledOn) return null;
  const from = shiftDays(summary.settledOn, -6), to = shiftDays(summary.settledOn, 6);
  const { data: lines, error } = await pipeline
    .from("bank_transactions")
    .select("id, amount, date, description, counterpart_name, category, invoice_id")
    .eq("user_id", userId)
    .gte("date", from).lte("date", to)
    .eq("amount", summary.payout);
  if (error) throw new Error(`bankregels lezen mislukt: ${error.message}`);
  const line = ((lines ?? []) as { id: string; amount: number | null; date: string | null; description: string | null; counterpart_name: string | null; category: string | null; invoice_id: string | null }[])
    .find((l) => isPayoutOf(l, summary));
  if (!line) return null;
  if (verdict === "transfer" && line.category === null && line.invoice_id === null) {
    // [DUBBEL-GEDEKT] Ask what is already booked before writing any category, like every other
    // machine writer. The "mollie-payout" hold is EXPECTED here — it is the hold this sync exists
    // to resolve, with the settlement as proof. A "paid-invoice" answer is not: it says a paid
    // invoice of exactly this amount sits near this date, so the line may be that invoice's own
    // payment rather than the payout, and the honest move is to code nothing.
    const guard = await readDoubleBookingGuard({ invoiceClient: pipeline, molliePipeline: pipeline, userId, lines: [line] });
    if (guard.hold("omzet", line) === "paid-invoice") return line.id;
    // 'transfer' never touches revenue or cost ([BANK-IDENTITY]); source 'rule', unconfirmed, so
    // the owner still sees it and can overrule — the app coded it, the app says so.
    await pipeline
      .from("bank_transactions")
      .update({ category: "transfer", category_source: "rule", category_confirmed: false })
      .eq("id", line.id).eq("user_id", userId).is("category", null);
  }
  return line.id;
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
