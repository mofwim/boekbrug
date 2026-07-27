// src/app/api/email/confirm/[id]/route.ts
// [BOEK-011] Incoming invoice actions  ([BRIDGE-B] verify/pay split)
// POST   → action 'verify' (processing→received, becomes a shared Crediteur) or
//          action 'pay' (→paid, requires payment_method bank|kas) — both TRAIL 2/3
// DELETE → ignore (archive — recoverable, never hard-deleted)
// PATCH  → restore an ignored invoice back to the verification queue (→processing)

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
// [BOEK-011 + BOEK-SECURITY Phase 2.5] notifications writes must use service_role
import { createPipelineClient } from "@/lib/supabase-pipeline";
// [CASH-SETTLE] keep the kasboek in sync when an invoice is paid/undone in cash
import { reconcileCashSettlements } from "@/lib/cash-settle";
import { runBankAutoConfirm } from "@/lib/bank-auto-confirm";
// [BRIDGE-B] legal trail for verify/pay state changes
import { logAuditAction, getClientIP } from "@/lib/audit";
// [MONEY-GUARD] The one predicate for "this invoice already holds money" — shared with the
// dedicated archive route so the two doors to the same act cannot disagree.
import { hasSettledMoney } from "@/lib/invoice-removal";
import type { Database } from "@/types/database.types";

type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];
// ── POST — verify or pay an incoming invoice ──────────────────────────────────
// [BRIDGE-B] Two actions, driven by body.action (default 'verify'):
//   'verify' → status 'processing' → 'received'  (becomes a SHARED Crediteur;
//              NOT marked paid — payment is a separate, later step)
//   'pay'    → status → 'paid'  (REQUIRES payment_method: 'bank' | 'kas' — DB
//              constraint invoices_paid_requires_method; used when already paid)
// Both run TRAIL 2/3 on the reviewed amounts (arithmetic + legal BTW rate).
// TRAIL is a FLAG, not a hard block — the human is the authority (Pillar ⑤).
// Update runs in USER context: RLS invoices_receiver_update + B.4 Exception 3
// both allow the receiver of an incoming invoice to change status/amounts.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // Verify ownership + load current amounts (TRAIL needs unchanged fields too)
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, receiver_id, direction, status, total_ex_btw, btw_amount, total_inc_btw, invoice_number, client_name, invoice_date, invoice_type")
    .eq("id", id)
    .single();

  if (!invoice || invoice.receiver_id !== user.id) {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }

  if (invoice.direction !== "incoming") {
    return NextResponse.json(
      { error: "Alleen inkomende facturen kunnen hier bevestigd worden" },
      { status: 400 }
    );
  }

  // [BRIDGE-B] body: action + user-reviewed/edited amounts (+ payment_method for pay)
  // [BRIDGE-EXTRACT] also accepts reviewed client_name / invoice_number / invoice_date
  let body: {
    action?: string;
    total_ex_btw?: number;
    btw_amount?: number;
    total_inc_btw?: number;
    payment_method?: string;
    client_name?: string;
    invoice_number?: string;
    invoice_date?: string;
    // [BRIDGE-QUARTER] real payment date (Axis 2 / cash). Distinct from
    // marked_paid_at (in-system confirmation timestamp).
    payment_date?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    // No body — default action, keep amounts already in DB
  }

  // Default 'verify' protects the legacy modal (no action sent) from the 500:
  // verify never sets status='paid', so the payment_method constraint can't fire.
  const action = body.action ?? "verify";
  if (action !== "verify" && action !== "pay") {
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  }

  // [BRIDGE-CREDITNOTA-SIGN] A normal invoice's amounts are ≥ 0. A creditnota follows the safecore
  // rule (evaluateCreditnotaArithmetic): only the NET total is negative — the ex/BTW signs are NOT
  // constrained (real Altena case: ex −123, BTW +13,42, totaal −109,58). So validNum only enforces
  // ≥ 0 for a normal invoice; for a creditnota it accepts any finite value, so a correctly-read
  // negative excl / positive BTW persists instead of being dropped back to the stored amount. The
  // old blanket `v >= 0` (with the client's Math.max(0)) turned every edited creditnota positive.
  const isCredit = invoice.invoice_type === "creditnota";
  const validNum = (v: unknown): v is number =>
    typeof v === "number" && isFinite(v) && (isCredit ? true : v >= 0);

  // Effective amounts = reviewed values where valid, else what's already stored
  const exBtw  = validNum(body.total_ex_btw)  ? body.total_ex_btw  : (invoice.total_ex_btw  ?? 0);
  const btw    = validNum(body.btw_amount)    ? body.btw_amount    : (invoice.btw_amount    ?? 0);
  const incBtw = validNum(body.total_inc_btw) ? body.total_inc_btw : (invoice.total_inc_btw ?? 0);

  // [BRIDGE-B] Verification trails — FLAG, never hard-block (Pillar ⑤: the eye
  // confirms, it doesn't enter). Returned as `warnings` for the UI to surface.
  const warnings: string[] = [];
  // TRAIL 2 — arithmetic: excl + btw must equal incl (catches Excl/Incl mix-ups)
  if (Math.abs(exBtw + btw - incBtw) > 0.02) warnings.push("trail2_amounts");
  // TRAIL 3 — legal BTW rate. Uses the magnitude ratio |BTW / excl| (mirrors safecore and the
  // client), so a blended 0–21% rate is accepted and only an impossible >21% is flagged. The abs
  // also lets a creditnota (negative base, possibly positive goods-BTW) be checked correctly
  // instead of being skipped by the old `exBtw > 0` guard or false-flagged by a signed ratio.
  if (Math.abs(exBtw) > 0.005) {
    const rate = Math.round(Math.abs(btw / exBtw) * 100);
    if (rate > 21) warnings.push("trail3_btw_rate");
  }

  // ── Status patch per action ──
  const updatePatch: InvoiceUpdate = { updated_at: new Date().toISOString() };

  // Persist reviewed amounts when the user actually sent valid numbers
  if (validNum(body.total_ex_btw)) updatePatch.total_ex_btw = body.total_ex_btw;
  if (validNum(body.btw_amount)) updatePatch.btw_amount = body.btw_amount;
  if (validNum(body.total_inc_btw)) updatePatch.total_inc_btw = body.total_inc_btw;

  // [BRIDGE-EXTRACT] Persist reviewed metadata when the user edited it inline.
  // Only write non-empty strings; ignore blanks so a cleared field can't wipe data.
  if (typeof body.client_name === "string" && body.client_name.trim()) {
    updatePatch.client_name = body.client_name.trim();
  }
  if (typeof body.invoice_number === "string" && body.invoice_number.trim()) {
    updatePatch.invoice_number = body.invoice_number.trim();
  }
  // invoice_date: accept only a valid YYYY-MM-DD (the <input type="date"> format)
  if (typeof body.invoice_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.invoice_date)) {
    updatePatch.invoice_date = body.invoice_date;
  }

  // [DATE-GATE] An incoming invoice may not be confirmed (verified or paid)
  // without a real invoice date. The date sets the tax period (factuurstelsel),
  // so confirming a dateless invoice would silently book it in the wrong
  // quarter. Ingestion now stores null when the AI could not read the date; the
  // reviewer enters it in the modal, which sends it here. Block when neither the
  // reviewed value nor the stored value is a real date.
  const effectiveDate =
    typeof body.invoice_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.invoice_date)
      ? body.invoice_date
      : invoice.invoice_date;
  if (!effectiveDate) {
    return NextResponse.json(
      { error: "Factuurdatum ontbreekt — voer eerst de factuurdatum in voordat je de factuur bevestigt." },
      { status: 400 }
    );
  }

  if (action === "pay") {
    // DB constraint invoices_paid_requires_method: paid REQUIRES a method.
    if (body.payment_method !== "bank" && body.payment_method !== "kas") {
      return NextResponse.json(
        { error: "Betaalmethode vereist (bank of kas)" },
        { status: 400 }
      );
    }
    updatePatch.status = "paid";
    updatePatch.payment_method = body.payment_method;
    updatePatch.marked_paid_at = new Date().toISOString();
    // [BRIDGE-QUARTER] Real payment date (Axis 2 / cash). Prefer an explicit YYYY-MM-DD; else the
    // invoice's OWN date (a receipt uploaded weeks later is a far better accounting-day proxy than
    // "today", which would misattribute a cross-quarter payment to the wrong quarter); "today" is
    // only the last resort so a paid invoice never lacks a payment_date. marked_paid_at stays the
    // precise confirmation timestamp; payment_date is the accounting day. (Accrual BTW is on the
    // invoice date regardless, so this only fixes the settlement-quarter display.)
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    const reviewedDate = typeof body.invoice_date === "string" && isoRe.test(body.invoice_date) ? body.invoice_date : null;
    const invDate = typeof invoice.invoice_date === "string" && isoRe.test(invoice.invoice_date) ? invoice.invoice_date : null;
    updatePatch.payment_date =
      typeof body.payment_date === "string" && isoRe.test(body.payment_date)
        ? body.payment_date
        : reviewedDate ?? invDate ?? new Date().toISOString().slice(0, 10);
  } else {
    // verify → enters the accountant's world as a Crediteur (unpaid, shared)
    updatePatch.status = "received";
  }

  // [CONFIRM-GUARD] Only a QUEUE row ('processing') can be confirmed here. Without
  // this precondition a stale tab / double-submit could act on an already-handled
  // invoice: 'verify' on a PAID row rewrote status back to 'received' while its
  // payment fields stayed populated (inconsistent state), and 'pay' could re-pay.
  // Race-proof: the WHERE re-checks at write time; zero rows → honest conflict.
  if (invoice.status !== "processing") {
    return NextResponse.json(
      { error: "Deze factuur is al bevestigd — ververs de pagina." },
      { status: 409 }
    );
  }
  const { data: confirmData, error } = await supabase
    .from("invoices")
    .update(updatePatch)
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("status", "processing")
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!confirmData || confirmData.length === 0) {
    return NextResponse.json(
      { error: "Deze factuur is al bevestigd — ververs de pagina." },
      { status: 409 }
    );
  }

  // [BRIDGE-B] Audit the state change (legal trail: who confirmed what, when).
  // Non-fatal — never throws, never blocks the response.
  await logAuditAction({
    userId: user.id,
    action: "invoice.status_changed",
    entityType: "invoice",
    entityId: id,
    oldValue: { status: invoice.status },
    newValue: {
      status: updatePatch.status,
      action,
      ...(action === "pay" ? { payment_method: body.payment_method } : {}),
      ...(action === "pay" && updatePatch.payment_date
        ? { payment_date: updatePatch.payment_date }
        : {}),
      ...(warnings.length ? { warnings } : {}),
      ...(updatePatch.client_name ? { client_name: updatePatch.client_name } : {}),
      ...(updatePatch.invoice_number ? { invoice_number: updatePatch.invoice_number } : {}),
      ...(updatePatch.invoice_date ? { invoice_date: updatePatch.invoice_date } : {}),
    },
    ipAddress: getClientIP(req),
  });

  // [CASH-SETTLE] If this pay was in cash (or an earlier cash payment was just undone),
  // keep the kasboek in sync immediately — create the linked 'betaling' entry (balance-only,
  // never a cost) or remove an orphan. Self-healing + best-effort; the kasboek load also
  // reconciles, so this only makes it instant.
  if (action === "pay" || action === "verify") {
    await reconcileCashSettlements(supabase, user.id);
    // [BANK-LINK] A just-verified invoice may already have its payment sitting in an imported bank
    // statement — including as part of a multi-invoice batch. Run the SAME safe engine the cron runs
    // (only books provably-exact reference+amount / iban+amount / exact-batch matches), inline, so
    // the invoice flips to 'betaald · gekoppeld' IMMEDIATELY instead of waiting up to a day for the
    // daily cron. This is exactly the gap where an already-paid invoice showed "24 dagen te laat".
    // Best-effort: a failure just defers the link to the cron / the /bank page, never blocks verify.
    try {
      await runBankAutoConfirm({ payClient: supabase, pipeline: createPipelineClient(), userId: user.id });
    } catch { /* non-fatal — cron / bank page still catches it */ }
  }

  // ── Notify (service_role — notifications has no authenticated INSERT policy) ──
  const { data: link } = await supabase
    .from("accountant_clients")
    .select("accountant_id")
    .eq("zzper_id", user.id)
    .limit(1)
    .single();

  const pipeline = createPipelineClient();

  // ── [BRIDGE-NOTIF] Notification enrichment ──────────────────────────────────
  // A senior accountant wants WHO + WHAT + amount + a click that lands on the row.
  // All values are best-effort; every piece degrades gracefully if missing.

  // Effective incl amount for display (reviewed value where the user edited it).
  const fmtEur = (n: number) =>
    new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
  const amountLabel = incBtw > 0 ? ` · ${fmtEur(incBtw)}` : "";

  // Invoice number + vendor (client_name on an INCOMING invoice = the supplier).
  const invNr = invoice.invoice_number ? `factuur ${invoice.invoice_number}` : "een factuur";
  const vendor =
    typeof invoice.client_name === "string" && invoice.client_name.trim()
      ? ` (${invoice.client_name.trim()})`
      : "";

  // Client (the ZZP'er) display name — for the ACCOUNTANT's notification only.
  let clientName = "Een klant";
  {
    const { data: me } = await supabase
      .from("profiles")
      .select("full_name, company_name")
      .eq("id", user.id)
      .maybeSingle();
    if (me?.company_name?.trim()) clientName = me.company_name.trim();
    else if (me?.full_name?.trim()) clientName = me.full_name.trim();
  }

  // Quarter for the accountant deep-link, derived from invoice_date (fallback: today).
  // The row lives in /dashboard/clients/{zzper}/kwartaal?q=&year=&focus={id}.
  const baseDate =
    typeof invoice.invoice_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(invoice.invoice_date)
      ? new Date(invoice.invoice_date)
      : new Date();
  const dlYear = baseDate.getFullYear();
  const dlQuarter = Math.ceil((baseDate.getMonth() + 1) / 3);
  const accountantLink = `/dashboard/clients/${user.id}/kwartaal?q=${dlQuarter}&year=${dlYear}&focus=${id}`;

  // Client deep-link — always the management surface, focused on this row.
  const clientLink = `/dashboard/incoming/manage?focus=${id}`;

  if (link?.accountant_id) {
    const { error: accNotifErr } = await pipeline.from("notifications").insert({
      user_id: link.accountant_id,
      title: action === "pay" ? "Factuur betaald gemarkeerd" : "Nieuwe crediteur ter inzage",
      body:
        action === "pay"
          ? `${clientName} markeerde ${invNr}${vendor}${amountLabel} als betaald.`
          : `${clientName} verifieerde ${invNr}${vendor}${amountLabel} — nieuwe crediteur.`,
      type: "invoice",
      read: false,
      // [BRIDGE-NOTIF] deep-link: lands on the client's quarter and focuses the row.
      link: accountantLink,
    });
    if (accNotifErr) {
      console.error("[BRIDGE-B] accountant notification failed", accNotifErr);
      // Non-fatal — the confirmation already succeeded.
    }
  }

  // Notify the user themselves — confirmation
  const { error: userNotifErr } = await pipeline.from("notifications").insert({
    user_id: user.id,
    title: action === "pay" ? "Factuur betaald" : "Factuur geverifieerd",
    body:
      action === "pay"
        ? `${invNr.charAt(0).toUpperCase() + invNr.slice(1)}${vendor}${amountLabel} — betaald en doorgezet naar je boekhouder.`
        : `${invNr.charAt(0).toUpperCase() + invNr.slice(1)}${vendor}${amountLabel} — geverifieerd en doorgezet naar je boekhouder.`,
    type: action === "pay" ? "payment" : "invoice",
    read: false,
    // [BRIDGE-NOTIF] deep-link: management surface, focused on this row.
    link: clientLink,
  });
  if (userNotifErr) {
    console.error("[BRIDGE-B] user notification failed", userNotifErr);
  }

  return NextResponse.json({ ok: true, ...(warnings.length ? { warnings } : {}) });
}

// ── DELETE — ignore (archive) ─────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // [BOEK-011] Archive — never hard-delete. Recoverable via PATCH.
  // [CONFIRM-GUARD] Only from 'processing' (skip from the verify queue) or
  // 'received' (the manage page's archive-a-duplicate flow). Never from 'paid':
  // archiving a paid invoice would hide booked money from every ledger surface.
  //
  // [MONEY-GUARD] 'paid' is not the only state that holds money. An invoice PARTLY paid sits in
  // 'received' with amount_paid > 0, and a bank-linked one can too — both slipped straight
  // through the status filter. Archiving them is exactly the harm the comment above describes:
  // 'archived' is outside INCOMING_OK, so the invoice stops counting, while the bank line that
  // paid it is skipped by `if (t.invoice_id) continue` as "payment of an already-counted invoice"
  // — the debit is then counted NOWHERE, and the quarter's kosten and voorbelasting are quietly
  // too low. The dedicated archive route refuses both cases; this one is the same act by another
  // door, so it applies the same two gates.
  const { data: money } = await supabase
    .from("invoices")
    .select("status, amount_paid")
    .eq("id", id)
    .eq("receiver_id", user.id)
    .maybeSingle();
  if (money && hasSettledMoney(money)) {
    return NextResponse.json(
      { error: "money_settled", detail: "Er is al betaald op deze factuur — draai eerst de betaling terug." },
      { status: 409 },
    );
  }
  // A booked payment always leaves a join row. Refusing on its mere existence also covers rows
  // written before amount_applied existed, whose amounts cannot be read back.
  const { data: bankLinks } = await supabase
    .from("bank_tx_invoices")
    .select("transaction_id")
    .eq("user_id", user.id)
    .eq("invoice_id", id)
    .limit(1);
  if ((bankLinks ?? []).length > 0) {
    return NextResponse.json(
      { error: "bank_linked", detail: "Er is een banktransactie aan deze factuur gekoppeld — ontkoppel die eerst op de Bank-pagina." },
      { status: 409 },
    );
  }

  const { data: archData, error } = await supabase
    .from("invoices")
    .update({
      status: "archived",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .in("status", ["processing", "received"])
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!archData || archData.length === 0) {
    return NextResponse.json(
      { error: "Deze factuur kan niet worden verwijderd (al betaald of al verwerkt) — ververs de pagina." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}

// ── PATCH — restore an ignored invoice ────────────────────────────────────────

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  // [BRIDGE-B] Restore: archived → processing (re-enters the verification queue).
  // Must NOT go to 'received' — that would push an unverified invoice straight to
  // the accountant via the restore path (shared=true). The queue is 'processing'.
  const { error } = await supabase
    .from("invoices")
    .update({
      status: "processing",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "archived");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}