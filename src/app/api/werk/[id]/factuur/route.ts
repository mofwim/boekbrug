// src/app/api/werk/[id]/factuur/route.ts
// [WERK] "Maak factuur": one tap on finished work, and the invoice exists as a draft.
//
// Through the ordinary draft door (/api/invoice/draft), never beside it: numbering, the client
// row, the line arithmetic and the audit trail of an invoice all live there and are not repeated
// here. This route only decides WHAT goes on the lines — workInvoiceLines in werk.ts, the same
// builder the verzamelfactuur uses — and what is stamped afterwards:
//
//   · one-off work: the hours attached and not yet billed are stamped with the invoice, the row
//     gets invoice_id and moves to 'gefactureerd', once;
//   · [WERK-BEURT] repeating work: the beurten that were not on an invoice yet are stamped with
//     it and the row STAYS OPEN — next week's beurt starts clean, and the invoice can be found
//     from every beurt it covers.
//
// Nothing is invented: an hour without a rate is left unbilled and NAMED in the answer, and work
// with no lines and no billable hours is refused rather than turned into an empty invoice. The
// draft is editable; the owner reads it before it is sent, as with every invoice in this app.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireOwner } from "@/lib/owner-only";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { amsterdamToday } from "@/lib/format-nl";
import { canInvoice, storedVisits, unbilledVisits } from "@/lib/werk";
import { loadWorkForInvoice, openDraftFor, stampHours, type WorkLoaded } from "@/lib/werk-factuur";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een factuur maken van werk");
  if (guard.response) return guard.response;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const loaded = await loadWorkForInvoice(db, user.id, [id]);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const work: WorkLoaded = loaded.works[0];
  const row = work.row;
  if (!canInvoice({ status: row.status, invoice_id: row.invoice_id ?? null, repeat_every: row.repeat_every, visits: row.visits })) {
    return NextResponse.json({ error: "Alleen werk dat klaar is en nog geen factuur heeft, wordt een factuur.", code: "not_invoiceable" }, { status: 409 });
  }
  const clientName = (row.client_name ?? "").trim();
  if (!clientName) return NextResponse.json({ error: "Zet eerst een klant op dit werk.", code: "no_client" }, { status: 409 });

  // The beurten this invoice will cover — fixed BEFORE the draft is made, so a beurt ticked off
  // while the invoice was being written is not stamped as billed by it.
  const billedVisits = row.repeat_every ? unbilledVisits(row.visits) : [];
  const lines = work.lines;
  if (lines.filter((l) => l.unit_price > 0).length === 0) {
    return NextResponse.json({ error: "Zet eerst regels op het werk, of koppel uren met een tarief.", code: "no_lines" }, { status: 409 });
  }

  const opened = await openDraftFor(req, { client_id: row.client_id, client_name: clientName, lines });
  if (!opened.ok) return NextResponse.json({ error: opened.error, from: "draft" }, { status: opened.status });
  const invoiceId = opened.invoiceId;
  const today = amsterdamToday();

  await stampHours(db, user.id, [work], invoiceId);
  if (row.repeat_every) {
    // Re-read the beurten at the moment of stamping: one added meanwhile must stay unbilled.
    const { data: fresh } = await db.from("work_items").select("visits").eq("id", id).eq("user_id", user.id).maybeSingle();
    const current = storedVisits(fresh?.visits);
    const covered = new Set(billedVisits.map((v) => v.on));
    let stamped = 0;
    const next = current.map((v) => {
      if (!v.invoice_id && covered.has(v.on) && stamped < billedVisits.length) { stamped += 1; return { ...v, invoice_id: invoiceId }; }
      return v;
    });
    const { error: updErr } = await db.from("work_items").update({ visits: next }).eq("id", id).eq("user_id", user.id);
    if (updErr) console.error("[WERK-BEURT] invoice made but the beurten could not be stamped", { id, invoiceId, error: updErr.message });
  } else {
    const { error: updErr } = await db
      .from("work_items")
      .update({ invoice_id: invoiceId, status: "gefactureerd", done_on: row.done_on ?? today })
      .eq("id", id).eq("user_id", user.id).is("invoice_id", null);
    if (updErr) console.error("[WERK] invoice made but the work row could not be closed", { id, invoiceId, error: updErr.message });
  }

  await logAuditAction({
    userId: user.id, action: "work.invoiced", entityType: "work_item", entityId: id,
    newValue: { invoice_id: invoiceId, title: row.title, lines: lines.length, hours_billed: work.billedHourIds.length, hours_without_rate: work.hoursWithoutRate, visits_billed: billedVisits.length },
    ipAddress: getClientIP(req),
  }).catch(() => {});

  return NextResponse.json({
    ok: true, invoiceId, lines: lines.length,
    hoursBilled: work.billedHourIds.length,
    hoursWithoutRate: work.hoursWithoutRate,
    visitsBilled: billedVisits.length,
  });
}
