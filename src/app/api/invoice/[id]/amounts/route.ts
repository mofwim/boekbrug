// src/app/api/invoice/[id]/amounts/route.ts
// [AMOUNT-CORRECTION] Correct the amounts — and if needed the KIND — of a CONFIRMED incoming
// invoice.
//
// ── WHY THIS ROUTE EXISTS ──
// The verify queue has always let the reviewer fix a misread invoice before confirming it. After
// confirming there was nothing: /dashboard/incoming/manage had no edit path at all. So an invoice
// that made it into the books wrong stayed wrong, and the only ways out were archiving it (which
// hides a real purchase) or asking the accountant.
//
// That gap became visible with four real invoices: a credit note booked as a debt, and three
// wholesale invoices whose ex-btw amount lost a 0%-rated deposit or a second rate. The screen can
// now SEE those (creditnota-signal.ts, btw-reconcile.ts) — this route is what lets the owner
// actually fix them.
//
// ── FIVE GUARDS, ALL FAIL-CLOSED ──
// Correcting an amount on a CONFIRMED invoice moves money in the books, so every one of these
// refuses rather than guesses:
//
//   1. Ownership — receiver of an INCOMING invoice, and nothing else.
//   2. Status must be 'received'. A 'paid' invoice has money settled against a bank line, and
//      changing its total would break the invariant amount_paid = Σ bank_tx_invoices.amount_applied.
//      A 'processing' row belongs to the queue's own confirm route.
//   3. No settled money — the same predicate the archive and ignore routes use, so the three doors
//      to "this invoice holds money" cannot disagree.
//   4. The identity has to hold: ex + btw = incl. The screen guarantees it (amount-triplet.ts), but
//      a server that trusts the client's arithmetic is not a guard.
//   5. The write re-asserts status and ownership in its WHERE, so a stale tab loses the race
//      honestly instead of overwriting a newer state.
//
// The 'verwerkt' freeze is enforced by the database trigger prevent_verwerkt_invoice_changes; we
// recognise its message and translate it, rather than duplicating the rule here.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { logAuditAction, getClientIP } from "@/lib/audit";
// [NAMENS] Correcting a booked purchase amount is bookkeeping, not sales. A sales member has no
// business here — and saying so explicitly beats relying on the receiver_id check happening to
// exclude them. Same choice as the archive and ignore routes.
import { requireOwner } from "@/lib/owner-only";
// [AMOUNT-CORRECTION] One predicate for "this invoice already holds money" — shared with the
// archive and ignore routes.
import { hasSettledMoney } from "@/lib/invoice-removal";
// [AMOUNT-TRIPLET] The same tolerance the arithmetic gate uses, so screen and server agree.
import { SUM_TOLERANCE } from "@/lib/btw-reconcile";
// [READING-MEMORY] Which fields the human changed about the reader's answer.
import { correctedFields } from "@/lib/reading-memory";
// [CREDIT-SIGN] A credit note has to be STORED negative — nothing that counts money reads the type.
import { asCreditAmounts } from "@/lib/creditnota-signal";
import type { Database } from "@/types/database.types";

type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];

/** A finite number, whatever the sign — a credit note's amounts are legitimately negative. */
function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  { const w = await requireOwner('De bedragen van een geboekte inkoopfactuur corrigeren'); if (w.response) return w.response }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const exBtw = body.total_ex_btw;
  const btw = body.btw_amount;
  const incBtw = body.total_inc_btw;
  const declaredCredit = body.is_credit_note === true;

  if (!finite(exBtw) || !finite(btw) || !finite(incBtw)) {
    return NextResponse.json(
      { error: "Vul alle drie de bedragen in — bedrag excl. BTW, BTW en totaal." },
      { status: 400 },
    );
  }

  // GUARD 4 — the identity. The screen cannot break it, but a hand-made request can, and a stored
  // set of amounts that contradicts itself is exactly what this whole round is about removing.
  if (Math.abs(exBtw + btw - incBtw) > SUM_TOLERANCE) {
    return NextResponse.json(
      { error: "Bedrag excl. BTW plus BTW moet gelijk zijn aan het totaal.", code: "sum_mismatch" },
      { status: 400 },
    );
  }

  // [NO-SILENT-EMPTY] Read the row BEFORE deciding anything, and treat a failed read as a refusal.
  // supabase-js answers a failed read with { data: null, error }, so without checking `error` a
  // database problem would read as "invoice not found" and the owner would be told their invoice
  // does not exist while it sits right there on the screen.
  const { data: invoice, error: readErr } = await supabase
    .from("invoices")
    // client_name is read for the audit trail only — [READING-MEMORY] keys a correction to the
    // supplier it happened at, and without the name the correction cannot be remembered anywhere.
    .select("id, receiver_id, direction, status, invoice_type, invoice_number, client_name, total_ex_btw, btw_amount, total_inc_btw, amount_paid")
    .eq("id", id)
    .maybeSingle();

  if (readErr) {
    console.error("[AMOUNT-CORRECTION] read failed — refusing to write", { invoiceId: id, userId: user.id, error: readErr.message });
    return NextResponse.json(
      { error: "We konden deze factuur nu niet ophalen. Er is niets gewijzigd — probeer het zo meteen opnieuw." },
      { status: 503 },
    );
  }

  // GUARD 1 — ownership. Same answer for "not yours" and "does not exist": a probe learns nothing.
  if (!invoice || invoice.receiver_id !== user.id || invoice.direction !== "incoming") {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }

  // GUARD 2 — only a confirmed, unpaid invoice.
  if (invoice.status !== "received") {
    return NextResponse.json(
      {
        error:
          invoice.status === "paid"
            ? "Deze factuur staat op betaald. Draai eerst de betaling terug; daarna kun je de bedragen corrigeren."
            : "Deze factuur staat nog in de controlewachtrij — corrigeer hem daar.",
        code: "wrong_status",
      },
      { status: 409 },
    );
  }

  // GUARD 3 — no money booked against it. A partly paid invoice sits in 'received' too, so the
  // status check above does not cover this.
  if (hasSettledMoney({ status: invoice.status, amount_paid: invoice.amount_paid })) {
    return NextResponse.json(
      { error: "Er is al een bedrag afgeboekt op deze factuur — ontkoppel die betaling eerst op de Bank-pagina.", code: "money_settled" },
      { status: 409 },
    );
  }

  // [CREDIT-SIGN] A credit note is stored NEGATIVE, or it is not a credit note in any way that
  // counts. openAmountSigned reads `total_inc_btw < 0`, and /api/aangifte sums btw_amount without
  // ever selecting invoice_type — so a row typed +51,80 and marked 'creditnota' keeps standing as a
  // debt and keeps ADDING input tax that belongs subtracted. Same rule, same helper as the queue's
  // confirm route, so the two doors cannot store the same document two different ways.
  const signed = (declaredCredit || invoice.invoice_type === "creditnota")
    ? asCreditAmounts({ totalExBtw: exBtw, btwAmount: btw, totalIncBtw: incBtw })
    : { totalExBtw: exBtw, btwAmount: btw, totalIncBtw: incBtw, flipped: false };

  const patch: InvoiceUpdate = {
    total_ex_btw: signed.totalExBtw,
    btw_amount: signed.btwAmount,
    total_inc_btw: signed.totalIncBtw,
    updated_at: new Date().toISOString(),
  };
  // [KIND-CORRECTION] Same one-way rule as the queue's confirm route: 'factuur' → 'creditnota'
  // only. That is the direction the reader structurally under-sees (a positively printed credit
  // note is never recognised, see HUNT-F2 in ai.ts) and the direction that takes money OFF the
  // outstanding balance. The reverse would quietly turn a credit into a debt.
  if (declaredCredit && invoice.invoice_type !== "creditnota") patch.invoice_type = "creditnota";

  // GUARD 5 — the WHERE re-asserts every precondition, so a stale tab cannot overwrite a newer
  // state. .select() so zero rows is distinguishable from success — without it a WHERE that matched
  // nothing would return ok and the screen would show a correction that never happened.
  const { data: written, error: writeErr } = await supabase
    .from("invoices")
    .update(patch)
    .eq("id", id)
    .eq("receiver_id", user.id)
    .eq("direction", "incoming")
    .eq("status", "received")
    .select("id");

  if (writeErr) {
    // The B.4 trigger freezes an invoice the accountant marked 'verwerkt'. Its message deliberately
    // contains that word — the pay-toggle and confirm routes detect it the same way.
    if (/verwerkt/i.test(writeErr.message)) {
      return NextResponse.json(
        { error: "Je boekhouder heeft deze factuur al verwerkt — vraag hem eerst de verwerking ongedaan te maken.", code: "verwerkt" },
        { status: 409 },
      );
    }
    console.error("[AMOUNT-CORRECTION] write failed", { invoiceId: id, userId: user.id, error: writeErr.message });
    return NextResponse.json({ error: "Opslaan mislukt — er is niets gewijzigd." }, { status: 500 });
  }

  if (!written || written.length === 0) {
    return NextResponse.json(
      { error: "Deze factuur is intussen veranderd — ververs de pagina en probeer het opnieuw.", code: "stale" },
      { status: 409 },
    );
  }

  // [READING-MEMORY] Which of the reader's fields the owner actually moved. Computed against the
  // row as it was read, not against what the form posted — the modal sends all three amounts every
  // time, and recording those would teach the memory that everything is always wrong.
  const correctedNow = correctedFields(
    {
      total_ex_btw: invoice.total_ex_btw,
      btw_amount: invoice.btw_amount,
      total_inc_btw: invoice.total_inc_btw,
      invoice_type: invoice.invoice_type,
    },
    { total_ex_btw: signed.totalExBtw, btw_amount: signed.btwAmount, total_inc_btw: signed.totalIncBtw, invoice_type: patch.invoice_type },
  );

  // The trail carries BOTH sides. Correcting a booked amount is exactly the kind of change an
  // accountant must be able to reconstruct a year later: what it was, what it became, and when.
  await logAuditAction({
    userId: user.id,
    action: "invoice.updated",
    entityType: "invoice",
    entityId: id,
    oldValue: {
      total_ex_btw: invoice.total_ex_btw,
      btw_amount: invoice.btw_amount,
      total_inc_btw: invoice.total_inc_btw,
      invoice_type: invoice.invoice_type,
      invoice_number: invoice.invoice_number,
    },
    newValue: {
      total_ex_btw: signed.totalExBtw,
      btw_amount: signed.btwAmount,
      total_inc_btw: signed.totalIncBtw,
      invoice_type: patch.invoice_type ?? invoice.invoice_type,
      via: "manage_amount_correction",
      // [CREDIT-SIGN] Recorded when the server turned the posted amounts negative, so a year later
      // the trail explains a minus the owner never typed.
      ...(signed.flipped ? { credit_sign_applied: true } : {}),
      // [READING-MEMORY] Same block, same shape as the queue's confirm route. There are two doors
      // through which a human disagrees with the reader — correcting before booking, and correcting
      // after — and a memory fed by only one of them would tell the owner a supplier is read fine
      // while they fix its invoices on the other screen every month.
      ...(correctedNow.length
        ? { reading_correction: { vendor: invoice.client_name, fields: correctedNow } }
        : {}),
    },
    ipAddress: getClientIP(req),
  });

  // The screen replaces its row with THIS, so it must be what was stored — otherwise a flipped
  // credit note would show positive until the next reload and the owner would correct it again.
  return NextResponse.json({
    ok: true,
    total_ex_btw: signed.totalExBtw,
    btw_amount: signed.btwAmount,
    total_inc_btw: signed.totalIncBtw,
    invoice_type: patch.invoice_type ?? invoice.invoice_type,
  });
}
