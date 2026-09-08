// src/app/api/werk/factuur/route.ts
// [WERK-VERZAMEL] One invoice for several pieces of finished work of one client.
//
// The courier's week: five afgeleverde ritten for one opdrachtgever become one verzamelfactuur,
// the way EasyTrans and NextUp bill and the way the opdrachtgever books — one invoice, one
// heading per rit, the lines under it. A builder with three klussen for one landlord, a cleaner
// with a few one-off opdrachten for one office: the same door.
//
// Every rule of the single-work door holds here, per piece of work, and one more: all rows must
// name the SAME client (canInvoiceTogether in werk.ts) — an invoice has one addressee. Repeating
// work is refused; its beurten are billed from its own row.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireOwner } from "@/lib/owner-only";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { amsterdamToday } from "@/lib/format-nl";
import { chunkIds } from "@/lib/supabase-paginate";
import { canInvoiceTogether } from "@/lib/werk";
import { loadWorkForInvoice, openDraftFor, stampHours } from "@/lib/werk-factuur";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOGETHER_MAX = 60;

const REASON_TEXT: Record<string, string> = {
  too_few: "Kies minstens twee stuks werk.",
  not_invoiceable: "Alleen werk dat klaar is en nog geen factuur heeft, gaat op de verzamelfactuur.",
  recurring: "Terugkerend werk factureer je vanuit het werk zelf, per beurt.",
  different_clients: "Een verzamelfactuur is voor één klant; dit werk is van verschillende klanten.",
  no_client: "Zet eerst een klant op dit werk.",
};

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een verzamelfactuur maken van werk");
  if (guard.response) return guard.response;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 }); }
  const ids = Array.isArray(body.ids) ? [...new Set((body.ids as unknown[]).filter((v): v is string => typeof v === "string" && UUID.test(v)))] : [];
  if (ids.length < 2 || ids.length > TOGETHER_MAX) return NextResponse.json({ error: REASON_TEXT.too_few, code: "too_few" }, { status: 400 });

  const loaded = await loadWorkForInvoice(db, user.id, ids, { heading: true });
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  if (loaded.works.length !== ids.length) return NextResponse.json({ error: "Niet al dit werk is gevonden." }, { status: 404 });
  const verdict = canInvoiceTogether(loaded.works.map((w) => w.row));
  if (!verdict.ok) return NextResponse.json({ error: REASON_TEXT[verdict.reason], code: verdict.reason }, { status: 409 });

  // Oldest first: the opdrachtgever reads the week in order.
  const works = [...loaded.works].sort((a, b) => (a.row.done_on ?? a.row.planned_on ?? "").localeCompare(b.row.done_on ?? b.row.planned_on ?? ""));
  const lines = works.flatMap((w) => w.lines);
  if (lines.filter((l) => l.unit_price > 0).length === 0) {
    return NextResponse.json({ error: "Zet eerst regels op het werk, of koppel uren met een tarief.", code: "no_lines" }, { status: 409 });
  }
  const first = works[0].row;
  const clientName = (first.client_name ?? "").trim();

  const opened = await openDraftFor(req, { client_id: first.client_id, client_name: clientName, lines });
  if (!opened.ok) return NextResponse.json({ error: opened.error, from: "draft" }, { status: opened.status });
  const invoiceId = opened.invoiceId;
  const today = amsterdamToday();

  await stampHours(db, user.id, works, invoiceId);
  for (const chunk of chunkIds(works.map((w) => w.row.id), 50)) {
    const { error: updErr } = await db
      .from("work_items")
      .update({ invoice_id: invoiceId, status: "gefactureerd" })
      .eq("user_id", user.id).in("id", chunk).is("invoice_id", null);
    if (updErr) console.error("[WERK-VERZAMEL] invoice made but work rows could not be closed", { chunk, invoiceId, error: updErr.message });
  }
  // done_on only where it was empty — an UPDATE cannot say "keep yours" per row in one statement.
  await db.from("work_items").update({ done_on: today }).eq("user_id", user.id).eq("invoice_id", invoiceId).is("done_on", null);

  const hoursBilled = works.reduce((n, w) => n + w.billedHourIds.length, 0);
  const hoursWithoutRate = works.reduce((n, w) => n + w.hoursWithoutRate, 0);
  for (const w of works) {
    await logAuditAction({
      userId: user.id, action: "work.invoiced", entityType: "work_item", entityId: w.row.id,
      newValue: { invoice_id: invoiceId, title: w.row.title, together: works.length, lines: w.lines.length, hours_billed: w.billedHourIds.length },
      ipAddress: getClientIP(req),
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, invoiceId, works: works.length, lines: lines.length, hoursBilled, hoursWithoutRate });
}
