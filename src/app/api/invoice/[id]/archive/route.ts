// src/app/api/invoice/[id]/archive/route.ts
// [INVOICE-REMOVE] Remove an invoice from the books without destroying it, and put it back.
//
//   POST   → archive  (status 'archived')
//   PATCH  → restore  (back to what the row itself proves it was)
//
// [ISSUED-STAYS] PURCHASE invoices only. A supplier invoice that isn't yours — wrong supplier, a
// duplicate the dedup missed, a scan of nothing — has to be removable, and it carries the
// SUPPLIER's number, so removing it breaks no sequence of ours. An issued SALES invoice is the
// opposite case: its number comes from our own doorlopende reeks (art. 35 Wet OB), and a hole in
// that sequence is precisely what an auditor looks for. Those are corrected with a creditnota,
// never removed — refused here as well as in the dialog. The existing DELETE on /api/invoice/[id]
// keeps its own job: physically removing a concept, which was never a bookkeeping record.
//
// Why archiving is enough to take an invoice out of the books: every financial surface in this
// app reads from an ALLOW-list, never a deny-list — omzet/kosten/BTW (financial-result:
// OUTGOING_OK / INCOMING_OK), the bank matcher (EXCLUDED_STATUSES), the reminder engine (only
// 'sent'/'overdue'), the public betaallink (REQUESTABLE_STATUSES), the closing package and the
// export (.neq archived). And `shared` is a GENERATED column (status IN sent/received/paid), so
// the invoice leaves the accountant's workspace by itself. One status change, every ledger.
//
// What this route will NOT do, and says so instead of doing it quietly:
//   · an issued sales invoice is never taken out of the numbering — refused;
//   · money that has moved (status 'paid' or a deelbetaling) is never hidden — refused;
//   · an invoice the accountant marked 'verwerkt' is never touched — refused;
//   · a bank line linked to the invoice means a booking happened — refused, even when the
//     amounts look empty (a pre-[PARTIAL-PAY] link carries no amount).
// The client asks the same questions first (invoice-removal.decideRemoval) — these are the
// server's own, because a client answer is never a permission.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { refuseArchive, restoreStatus, type RemovalInvoice } from "@/lib/invoice-removal";
import { quarterKeyOf } from "@/lib/quarter";
import { logAuditAction } from "@/lib/audit";

export const dynamic = "force-dynamic";

const SELECT =
  "id, status, direction, invoice_type, invoice_number, invoice_date, total_inc_btw, amount_paid, accountant_status, replaced_by_number, pay_token, sender_id, receiver_id";

/** Dutch, UI-ready reason per refusal — the dialog already said it, this is the server saying no. */
const REFUSAL_TEXT: Record<string, string> = {
  verwerkt: "Je boekhouder heeft deze factuur al verwerkt — vraag hem de verwerking eerst ongedaan te maken.",
  // [ISSUED-STAYS] A verkoopfactuur carries a number from the doorlopende reeks; a hole in that
  // sequence is what an auditor looks for. It is corrected with a creditnota, never removed.
  issued_sales_invoice: "Een verstuurde verkoopfactuur wordt niet verwijderd — corrigeer hem met een creditnota, zodat je factuurnummering doorloopt.",
  money_settled: "Er is al betaald op deze factuur — draai eerst de betaling terug.",
  bank_linked: "Er is een banktransactie aan deze factuur gekoppeld — ontkoppel die eerst op de Bank-pagina.",
  already_archived: "Deze factuur is al verwijderd.",
  not_archivable: "Deze factuur kan niet op deze manier verwijderd worden.",
};

async function loadOwned(id: string, userId: string) {
  const pipeline = createPipelineClient();
  const { data } = await pipeline
    .from("invoices")
    .select(SELECT)
    .eq("id", id)
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .maybeSingle();
  return { pipeline, invoice: data as (RemovalInvoice & { id: string; invoice_date?: string | null }) | null };
}

// ── POST — archive ────────────────────────────────────────────────────────────────────────────

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { pipeline, invoice } = await loadOwned(id, user.id);
  if (!invoice) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });

  const refusal = refuseArchive(invoice);
  if (refusal) {
    return NextResponse.json({ error: refusal, detail: REFUSAL_TEXT[refusal] }, { status: 409 });
  }

  // A booked payment always leaves a join row. Refusing on its mere existence covers the rows
  // written before amount_applied existed, whose amounts we cannot read.
  const { data: links } = await pipeline
    .from("bank_tx_invoices")
    .select("transaction_id")
    .eq("user_id", user.id)
    .eq("invoice_id", id)
    .limit(1);
  if ((links ?? []).length > 0) {
    return NextResponse.json({ error: "bank_linked", detail: REFUSAL_TEXT.bank_linked }, { status: 409 });
  }

  // The write re-asserts every gate in the WHERE clause: this runs on the service-role client
  // (no auth.uid(), so no verwerkt trigger), and the read above can be seconds stale.
  const { data: updated, error } = await pipeline
    .from("invoices")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .in("status", ["sent", "overdue", "processing", "received"])
    .or("accountant_status.is.null,accountant_status.neq.verwerkt")
    .select("id");
  if (error) return NextResponse.json({ error: "archive_failed", detail: error.message }, { status: 500 });
  if (!updated || updated.length === 0) {
    // Someone paid it / the accountant locked it in the window between our read and this write.
    return NextResponse.json({ error: "not_archivable", detail: REFUSAL_TEXT.not_archivable }, { status: 409 });
  }

  // ── Two consequences the owner cannot see from the row, reported instead of hidden ─────────
  const notices: string[] = [];

  // 1. The invoice sat in a BTW quarter that has already been filed. Nothing is blocked (the
  //    figures move, that is the point), but a filed aangifte does not — and the BTW page's
  //    divergence check will now show a difference. Better to hear it here than to find it.
  const qKey = quarterKeyOf(invoice.invoice_date ?? null);
  if (qKey) {
    const [yearStr, qStr] = qKey.split("-Q");
    // btw_filings is not in the generated types yet — same cast the /api/btw/file route uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: filed } = await (pipeline as any)
      .from("btw_filings")
      .select("year")
      .eq("user_id", user.id)
      .eq("year", Number(yearStr))
      .eq("quarter", Number(qStr))
      .maybeSingle();
    if (filed) {
      notices.push(
        `Deze factuur viel in ${qKey.replace("-", " ")}, een kwartaal dat je al hebt ingediend. Je aangifte klopt nu niet meer met je cijfers — bekijk het verschil op de BTW-pagina.`,
      );
    }
  }

  // 2. It was part of a gebundeld betaalverzoek. That link asks one summed amount for a fixed
  //    set of invoices, so it stops working the moment one of them is gone (fail-closed, by
  //    design) — the customer must get a new link.
  const { data: bundled } = await pipeline
    .from("pay_bundle_invoices")
    .select("bundle_id")
    .eq("invoice_id", id)
    .limit(1);
  if ((bundled ?? []).length > 0) {
    notices.push(
      "Deze factuur zat in een gebundeld betaalverzoek. Die betaallink werkt niet meer — maak zo nodig een nieuw verzoek voor de overgebleven facturen.",
    );
  } else if ((invoice as { pay_token?: string | null }).pay_token) {
    // 3. A pay_token exists only because the owner made a betaalverzoek and shared the link. It
    //    now 404s (the public view reads the same allow-list) — which is right, but the customer
    //    holding that link deserves to be told by their supplier, not by a dead page.
    notices.push(
      "Je had voor deze factuur een betaallink gedeeld. Die werkt niet meer — laat je klant weten dat de factuur vervalt.",
    );
  }

  await logAuditAction({
    userId: user.id,
    action: "invoice.archived",
    entityType: "invoice",
    entityId: id,
    oldValue: { status: invoice.status },
    newValue: {
      status: "archived",
      invoice_number: invoice.invoice_number,
      direction: invoice.direction,
      total_inc_btw: invoice.total_inc_btw,
      notices,
    },
  });

  if (notices.length > 0) {
    try {
      await pipeline.from("notifications").insert({
        user_id: user.id,
        title: "Factuur verwijderd — let op",
        body: notices.join(" "),
        type: "invoice",
        link: "/dashboard/btw",
      });
    } catch {
      /* non-blocking */
    }
  }

  return NextResponse.json({ ok: true, ...(notices.length ? { notices } : {}) });
}

// ── PATCH — restore ───────────────────────────────────────────────────────────────────────────

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { pipeline, invoice } = await loadOwned(id, user.id);
  if (!invoice) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  if ((invoice.status ?? "") !== "archived") {
    return NextResponse.json({ error: "not_archived" }, { status: 409 });
  }
  // [BOEK-031] A creditnota already corrected this invoice. Bringing it back would put the +omzet
  // in a second time while the creditnota's −omzet stays: a double count, silently.
  // [ISSUED-STAYS] Restore mirrors archive: only the purchase side ever archives now, so only
  // the purchase side comes back. An outgoing row in 'archived' is either a creditnota-replaced
  // invoice (blocked right below) or one archived before this rule existed — either way its
  // return has to be a considered, per-case decision, not a tap.
  if ((invoice.direction ?? "") !== "incoming") {
    return NextResponse.json(
      { error: "issued_sales_invoice", detail: REFUSAL_TEXT.issued_sales_invoice },
      { status: 409 },
    );
  }
  if (invoice.replaced_by_number) {
    return NextResponse.json(
      { error: "replaced", detail: `Deze factuur is vervangen door creditnota ${invoice.replaced_by_number}.` },
      { status: 409 },
    );
  }

  const status = restoreStatus(invoice);
  const { data: updated, error } = await pipeline
    .from("invoices")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .eq("status", "archived")
    .select("id");
  if (error) return NextResponse.json({ error: "restore_failed", detail: error.message }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "not_archived" }, { status: 409 });
  }

  await logAuditAction({
    userId: user.id,
    action: "invoice.restored",
    entityType: "invoice",
    entityId: id,
    oldValue: { status: "archived" },
    newValue: { status, invoice_number: invoice.invoice_number, direction: invoice.direction },
  });

  return NextResponse.json({ ok: true, status });
}
