// src/app/api/werk/[id]/factuur/route.ts
// [WERK] "Maak factuur": one tap on finished work, and the invoice exists as a draft.
//
// Through the ordinary draft door (/api/invoice/draft), never beside it: numbering, the client
// row, the line arithmetic and the audit trail of an invoice all live there and are not repeated
// here. This route only decides WHAT goes on the lines, in the order every small tool uses:
//
//   1. for a werkorder, the kenteken and kilometerstand as a first line at € 0 — the garage's
//      customer reads which car this bill is for;
//   2. the hours attached to the work that are not yet on any invoice, at their own rate
//      (linesFromEntries — the same builder /api/invoice/draft uses for an hours invoice);
//   3. the lines written on the work: arbeid, onderdelen, materiaal, meerwerk, ritprijs …
//
// Nothing is invented: an hour without a rate is left unbilled and NAMED in the answer, and work
// with no lines and no billable hours is refused rather than turned into an empty invoice. The
// draft is editable; the owner reads it before it is sent, as with every invoice in this app.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireOwner } from "@/lib/owner-only";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { POST as createDraft } from "@/app/api/invoice/draft/route";
import { linesFromEntries, DEFAULT_HOUR_BTW_RATE, type TimeEntry } from "@/lib/uren";
import { displayKenteken } from "@/lib/vehicle";
import { amsterdamToday } from "@/lib/format-nl";
import { chunkIds } from "@/lib/supabase-paginate";
import { canInvoice, storedLines, workSkin, DEFAULT_LINE_BTW } from "@/lib/werk";

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

  const { data: row, error: rowErr } = await db
    .from("work_items")
    .select("id, vak, title, client_id, client_name, vehicle_id, status, fields, lines, invoice_id, done_on")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (rowErr) return NextResponse.json({ error: "Kon het werk niet laden." }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Dit werk is niet gevonden." }, { status: 404 });
  if (!canInvoice({ status: row.status, invoice_id: row.invoice_id ?? null })) {
    return NextResponse.json({ error: "Alleen werk dat klaar is en nog geen factuur heeft, wordt een factuur.", code: "not_invoiceable" }, { status: 409 });
  }
  const skin = workSkin(row.vak);
  const clientName = typeof row.client_name === "string" ? row.client_name.trim() : "";
  if (!clientName) return NextResponse.json({ error: "Zet eerst een klant op dit werk.", code: "no_client" }, { status: 409 });

  // 1. The car, for a werkorder.
  const lines: Array<{ description: string; quantity: number; unit?: string; unit_price: number; btw_rate: number }> = [];
  if (skin?.vehicle && row.vehicle_id) {
    const { data: v } = await db.from("vehicles").select("kenteken").eq("id", row.vehicle_id).eq("user_id", user.id).maybeSingle();
    if (v?.kenteken) {
      const km = row.fields && typeof row.fields === "object" ? (row.fields as Record<string, unknown>).km_stand : undefined;
      const kmText = typeof km === "number" && Number.isFinite(km) ? ` · km-stand ${Math.round(km)}` : "";
      lines.push({ description: `Kenteken ${displayKenteken(v.kenteken)}${kmText}`, quantity: 1, unit: "stuk", unit_price: 0, btw_rate: DEFAULT_LINE_BTW });
    }
  }

  // 2. The hours attached and not yet billed, at their own rate.
  const { data: hourRows, error: hoursErr } = await db
    .from("time_entries")
    .select("id, client_id, worked_on, description, hours, hourly_rate, invoice_id")
    .eq("user_id", user.id).eq("work_item_id", id).is("invoice_id", null)
    .order("worked_on", { ascending: true }).limit(200);
  if (hoursErr) return NextResponse.json({ error: "De uren konden niet worden gelezen. Probeer het opnieuw." }, { status: 503 });
  const built = linesFromEntries((hourRows ?? []) as TimeEntry[], DEFAULT_HOUR_BTW_RATE);
  for (const l of built.lines) lines.push(l);

  // 3. The work's own lines.
  for (const l of storedLines(row.lines)) {
    lines.push({ description: l.description, quantity: l.quantity, unit: l.unit, unit_price: l.unit_price, btw_rate: l.btw_rate });
  }
  if (lines.filter((l) => l.unit_price > 0).length === 0) {
    return NextResponse.json({ error: "Zet eerst regels op het werk, of koppel uren met een tarief.", code: "no_lines" }, { status: 409 });
  }

  // Through the draft door, as the invoice screen would.
  const today = amsterdamToday();
  const door = new NextRequest(new URL("/api/invoice/draft", req.url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "", "x-real-ip": req.headers.get("x-real-ip") ?? "" },
    body: JSON.stringify({
      invoiceType: "factuur",
      client_id: row.client_id ?? undefined,
      client_name: clientName,
      invoice_date: today,
      lines,
    }),
  });
  const res = await createDraft(door);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.invoiceId) {
    return NextResponse.json({ error: typeof json?.error === "string" ? json.error : "De factuur kon niet worden gemaakt.", from: "draft" }, { status: res.ok ? 500 : res.status });
  }
  const invoiceId = String(json.invoiceId);

  // The hours are on the invoice now; stamp them so they can never be billed twice.
  for (const chunk of chunkIds(built.billedIds, 100)) {
    await db.from("time_entries").update({ invoice_id: invoiceId }).eq("user_id", user.id).eq("work_item_id", id).is("invoice_id", null).in("id", chunk);
  }
  const { error: updErr } = await db
    .from("work_items")
    .update({ invoice_id: invoiceId, status: "gefactureerd", done_on: row.done_on ?? today })
    .eq("id", id).eq("user_id", user.id).is("invoice_id", null);
  if (updErr) console.error("[WERK] invoice made but the work row could not be closed", { id, invoiceId, error: updErr.message });

  await logAuditAction({
    userId: user.id, action: "work.invoiced", entityType: "work_item", entityId: id,
    newValue: { invoice_id: invoiceId, title: row.title, lines: lines.length, hours_billed: built.billedIds.length, hours_without_rate: built.skippedWithoutRate.length },
    ipAddress: getClientIP(req),
  }).catch(() => {});

  return NextResponse.json({
    ok: true, invoiceId, lines: lines.length,
    hoursBilled: built.billedIds.length,
    hoursWithoutRate: built.skippedWithoutRate.length,
  });
}
