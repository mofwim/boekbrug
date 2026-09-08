// src/app/api/werk/[id]/route.ts
// [WERK] One piece of work with what hangs off it, and the taps that attach or detach.
//
//   GET  → the row, the hours attached (time_entries.work_item_id), the purchase invoices attached
//          (invoices.work_item_id, incoming), the documents attached, the sales invoice it became,
//          and the margin arithmetic from werk.ts. With ?candidates=1 also what COULD be attached:
//          the client's unbilled hours and recent purchase invoices that belong to no work yet.
//   POST → { action, ids }: attach_hours / detach_hours / attach_cost / detach_cost /
//          attach_document / detach_document. Every write is scoped to the owner AND to this row,
//          so an id from another administration is a no-op, never a cross-link.
//
// Nothing here moves money. Attaching a purchase invoice to a werkorder changes which margin it
// counts in, not what it cost or what btw it carries.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireOwner } from "@/lib/owner-only";
import { chunkIds } from "@/lib/supabase-paginate";
import { workSkin, workMargin, storedLines, linesTotalEx, type WorkStatus } from "@/lib/werk";
import type { AttachedCost, AttachedDocument, AttachedHours, WorkInvoiceSummary, WorkRow } from "@/lib/werk-rows";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, vak, title, client_id, client_name, vehicle_id, status, planned_on, done_on, fields, lines, notes, invoice_id, created_at";
const HOURS = "id, worked_on, description, hours, hourly_rate, invoice_id";
const COSTS = "id, client_name, invoice_number, invoice_date, total_ex_btw, btw_amount, total_inc_btw, status";
const DOCS = "id, file_name, created_at";
const ATTACH_MAX = 50;

type Ctx = { params: Promise<{ id: string }> };
type Action = "attach_hours" | "detach_hours" | "attach_cost" | "detach_cost" | "attach_document" | "detach_document";
const ACTIONS: readonly Action[] = ["attach_hours", "detach_hours", "attach_cost", "detach_cost", "attach_document", "detach_document"];

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function loadRow(db: any, userId: string, id: string): Promise<WorkRow | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data } = await db.from("work_items").select(COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) return null;
  let kenteken: string | null = null;
  if (data.vehicle_id) {
    const { data: v } = await db.from("vehicles").select("kenteken").eq("id", data.vehicle_id).eq("user_id", userId).maybeSingle();
    kenteken = v?.kenteken ?? null;
  }
  return {
    id: data.id, vak: data.vak, title: data.title, client_id: data.client_id ?? null, client_name: data.client_name ?? null,
    vehicle_id: data.vehicle_id ?? null, kenteken, status: data.status as WorkStatus, planned_on: data.planned_on ?? null,
    done_on: data.done_on ?? null, fields: data.fields && typeof data.fields === "object" ? data.fields : {},
    lines: storedLines(data.lines), notes: data.notes ?? null, invoice_id: data.invoice_id ?? null, created_at: data.created_at,
  };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const row = await loadRow(db, user.id, id);
  if (!row) return NextResponse.json({ error: "Dit werk is niet gevonden." }, { status: 404 });
  const skin = workSkin(row.vak);

  const [hoursRes, costsRes, docsRes, invoiceRes] = await Promise.all([
    db.from("time_entries").select(HOURS).eq("user_id", user.id).eq("work_item_id", id).order("worked_on", { ascending: true }).limit(200),
    db.from("invoices").select(COSTS).eq("receiver_id", user.id).eq("direction", "incoming").eq("work_item_id", id).order("invoice_date", { ascending: true }).limit(200),
    db.from("documents").select(DOCS).eq("user_id", user.id).eq("work_item_id", id).eq("trashed", false).order("created_at", { ascending: true }).limit(100),
    row.invoice_id
      ? db.from("invoices").select("id, invoice_number, status, total_ex_btw, total_inc_btw").eq("id", row.invoice_id).eq("sender_id", user.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const readFailed = !!(hoursRes.error || costsRes.error || docsRes.error || invoiceRes.error);

  const hours: AttachedHours[] = ((hoursRes.data ?? []) as Array<Record<string, unknown>>).map((h) => ({
    id: String(h.id), worked_on: String(h.worked_on), description: String(h.description ?? ""),
    hours: num(h.hours) ?? 0, hourly_rate: num(h.hourly_rate), invoice_id: (h.invoice_id as string | null) ?? null,
  }));
  const costs: AttachedCost[] = ((costsRes.data ?? []) as Array<Record<string, unknown>>).map((c) => ({
    id: String(c.id), client_name: (c.client_name as string | null) ?? null, invoice_number: (c.invoice_number as string | null) ?? null,
    invoice_date: (c.invoice_date as string | null) ?? null, total_ex_btw: num(c.total_ex_btw), total_inc_btw: num(c.total_inc_btw),
    status: (c.status as string | null) ?? null,
  }));
  const documents: AttachedDocument[] = ((docsRes.data ?? []) as Array<Record<string, unknown>>).map((d) => ({
    id: String(d.id), file_name: (d.file_name as string | null) ?? null, created_at: (d.created_at as string | null) ?? null,
  }));
  const inv = invoiceRes.data as Record<string, unknown> | null;
  const invoice: WorkInvoiceSummary | null = inv
    ? { id: String(inv.id), invoice_number: (inv.invoice_number as string | null) ?? null, status: (inv.status as string | null) ?? null,
        total_ex_btw: num(inv.total_ex_btw), total_inc_btw: num(inv.total_inc_btw) }
    : null;

  // Margin: revenue is the invoice when there is one, else what the lines add up to; costs are
  // the purchase invoices attached to this work, ex btw. Hours stand beside it (werk.ts).
  const hoursTotal = hours.reduce((s, h) => s + h.hours, 0);
  const costsExBtw = costs.reduce((s, c) => s + Math.abs(c.total_ex_btw ?? 0), 0);
  const linesTotal = linesTotalEx(row.lines);
  const margin = workMargin({
    revenueExBtw: invoice?.total_ex_btw ?? (row.lines.length > 0 ? linesTotal : null),
    costsExBtw,
  });

  let candidates: { hours: AttachedHours[]; costs: AttachedCost[] } | null = null;
  if (req.nextUrl.searchParams.get("candidates") === "1") {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    let hq = db.from("time_entries").select(HOURS).eq("user_id", user.id).is("work_item_id", null).is("invoice_id", null).order("worked_on", { ascending: false }).limit(50);
    if (row.client_id) hq = hq.eq("client_id", row.client_id);
    const [ch, cc] = await Promise.all([
      hq,
      db.from("invoices").select(COSTS).eq("receiver_id", user.id).eq("direction", "incoming").is("work_item_id", null)
        .in("status", ["processing", "received", "paid"]).gte("invoice_date", sixtyDaysAgo).order("invoice_date", { ascending: false }).limit(50),
    ]);
    candidates = {
      hours: ((ch.data ?? []) as Array<Record<string, unknown>>).map((h) => ({
        id: String(h.id), worked_on: String(h.worked_on), description: String(h.description ?? ""),
        hours: num(h.hours) ?? 0, hourly_rate: num(h.hourly_rate), invoice_id: null,
      })),
      costs: ((cc.data ?? []) as Array<Record<string, unknown>>).map((c) => ({
        id: String(c.id), client_name: (c.client_name as string | null) ?? null, invoice_number: (c.invoice_number as string | null) ?? null,
        invoice_date: (c.invoice_date as string | null) ?? null, total_ex_btw: num(c.total_ex_btw), total_inc_btw: num(c.total_inc_btw),
        status: (c.status as string | null) ?? null,
      })),
    };
  }

  return NextResponse.json({ ok: true, row, skin: skin?.skin ?? null, hours, hoursTotal, linesTotal, costs, documents, invoice, margin, readFailed, candidates });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Iets aan werk koppelen");
  if (guard.response) return guard.response;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const row = await loadRow(db, user.id, id);
  if (!row) return NextResponse.json({ error: "Dit werk is niet gevonden." }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 }); }
  const action = body.action;
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((v): v is string => typeof v === "string" && UUID.test(v)) : [];
  if (ids.length === 0 || ids.length > ATTACH_MAX) return NextResponse.json({ error: "Kies iets om te koppelen.", code: "no_ids" }, { status: 400 });

  const attach = action.startsWith("attach");
  const value = attach ? id : null;
  let touched = 0;
  for (const chunk of chunkIds(ids, 50)) {
    let q;
    if (action.endsWith("_hours")) {
      q = db.from("time_entries").update({ work_item_id: value }).eq("user_id", user.id).in("id", chunk);
      // An hour already on another piece of work is not silently stolen; an invoiced hour keeps its link.
      q = attach ? q.is("work_item_id", null) : q.eq("work_item_id", id);
    } else if (action.endsWith("_cost")) {
      q = db.from("invoices").update({ work_item_id: value }).eq("receiver_id", user.id).eq("direction", "incoming").in("id", chunk);
      q = attach ? q.is("work_item_id", null) : q.eq("work_item_id", id);
    } else {
      q = db.from("documents").update({ work_item_id: value }).eq("user_id", user.id).in("id", chunk);
      q = attach ? q.is("work_item_id", null) : q.eq("work_item_id", id);
    }
    const { data, error } = await q.select("id");
    if (error) return NextResponse.json({ error: "Koppelen is niet gelukt." }, { status: 500 });
    touched += (data ?? []).length;
  }
  return NextResponse.json({ ok: true, touched });
}
