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
//          [WERK-BEURT] { action: "visit", on?, note? } ticks a beurt off on repeating work;
//          { action: "unvisit", on } removes one that is not on an invoice yet.
//
// Nothing here moves money. Attaching a purchase invoice to a werkorder changes which margin it
// counts in, not what it cost or what btw it carries.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireOwner } from "@/lib/owner-only";
import { chunkIds } from "@/lib/supabase-paginate";
import { workSkin, workMargin, storedLines, storedVisits, isRepeat, readVisit, linesTotalEx, unbilledVisits, type WorkStatus } from "@/lib/werk";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { amsterdamToday } from "@/lib/format-nl";
import type { AttachedCost, AttachedDocument, AttachedHours, WorkHistory, WorkInvoiceSummary, WorkRow } from "@/lib/werk-rows";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, vak, title, client_id, client_name, vehicle_id, status, planned_on, done_on, fields, lines, repeat_every, visits, notes, invoice_id, created_at";
const HOURS = "id, client_id, worked_on, description, hours, hourly_rate, invoice_id";
const COSTS = "id, client_name, invoice_number, invoice_date, total_ex_btw, btw_amount, total_inc_btw, status";
const DOCS = "id, file_name, created_at";
const ATTACH_MAX = 50;

type Ctx = { params: Promise<{ id: string }> };
type Action = "attach_hours" | "detach_hours" | "attach_cost" | "detach_cost" | "attach_document" | "detach_document" | "visit" | "unvisit";
const ACTIONS: readonly Action[] = ["attach_hours", "detach_hours", "attach_cost", "detach_cost", "attach_document", "detach_document", "visit", "unvisit"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

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
    lines: storedLines(data.lines), repeat_every: isRepeat(data.repeat_every) ? data.repeat_every : null, visits: storedVisits(data.visits),
    notes: data.notes ?? null, invoice_id: data.invoice_id ?? null, created_at: data.created_at,
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

  const [hoursRes, costsRes, docsRes, invoiceRes, historyRes] = await Promise.all([
    db.from("time_entries").select(HOURS).eq("user_id", user.id).eq("work_item_id", id).order("worked_on", { ascending: true }).limit(200),
    db.from("invoices").select(COSTS).eq("receiver_id", user.id).eq("direction", "incoming").eq("work_item_id", id).order("invoice_date", { ascending: true }).limit(200),
    db.from("documents").select(DOCS).eq("user_id", user.id).eq("work_item_id", id).eq("trashed", false).order("created_at", { ascending: true }).limit(100),
    row.invoice_id
      ? db.from("invoices").select("id, invoice_number, status, total_ex_btw, total_inc_btw").eq("id", row.invoice_id).eq("sender_id", user.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // [WERK-3] The car's earlier visits: a returning Golf is the garage's daily case.
    row.vehicle_id
      ? db.from("work_items").select("id, title, status, planned_on, done_on, invoice_id, lines").eq("user_id", user.id).eq("vehicle_id", row.vehicle_id).neq("id", id).order("created_at", { ascending: false }).limit(10)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const readFailed = !!(hoursRes.error || costsRes.error || docsRes.error || invoiceRes.error || historyRes.error);
  const history: WorkHistory[] = ((historyRes.data ?? []) as Array<Record<string, unknown>>).map((h) => ({
    id: String(h.id), title: String(h.title), status: String(h.status) as WorkStatus,
    on: (h.done_on as string | null) ?? (h.planned_on as string | null) ?? null, invoice_id: (h.invoice_id as string | null) ?? null,
    total_ex_btw: linesTotalEx(storedLines(h.lines)),
  }));

  const hours: AttachedHours[] = ((hoursRes.data ?? []) as Array<Record<string, unknown>>).map((h) => ({
    id: String(h.id), worked_on: String(h.worked_on), description: String(h.description ?? ""),
    hours: num(h.hours) ?? 0, hourly_rate: num(h.hourly_rate), invoice_id: (h.invoice_id as string | null) ?? null, client_name: null,
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
    invoiced: !!invoice,
    costCount: costs.length,
  });

  let candidates: { hours: AttachedHours[]; costs: AttachedCost[] } | null = null;
  if (req.nextUrl.searchParams.get("candidates") === "1") {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    // Hours of THIS client, or hours written to no client at all; never another client's. When the
    // work has no client card (a name the owner never invoiced), only clientless hours are offered
    // — and every candidate names its client, so the owner sees whose hour he is about to bill.
    let hq = db.from("time_entries").select(HOURS).eq("user_id", user.id).is("work_item_id", null).is("invoice_id", null).order("worked_on", { ascending: false }).limit(50);
    hq = row.client_id ? hq.or(`client_id.is.null,client_id.eq.${row.client_id}`) : hq.is("client_id", null);
    const [ch, cc] = await Promise.all([
      hq,
      db.from("invoices").select(COSTS).eq("receiver_id", user.id).eq("direction", "incoming").is("work_item_id", null)
        .in("status", ["processing", "received", "paid"]).gte("invoice_date", sixtyDaysAgo).order("invoice_date", { ascending: false }).limit(50),
    ]);
    const clientIds = [...new Set(((ch.data ?? []) as Array<Record<string, unknown>>).map((h) => h.client_id).filter((v): v is string => typeof v === "string"))];
    const clientNames = new Map<string, string>();
    if (clientIds.length > 0) {
      const { data: cs } = await db.from("clients").select("id, name").eq("user_id", user.id).in("id", clientIds.slice(0, 50));
      for (const c of (cs ?? []) as Array<{ id: string; name: string }>) clientNames.set(c.id, c.name);
    }
    candidates = {
      hours: ((ch.data ?? []) as Array<Record<string, unknown>>).map((h) => ({
        id: String(h.id), worked_on: String(h.worked_on), description: String(h.description ?? ""),
        hours: num(h.hours) ?? 0, hourly_rate: num(h.hourly_rate), invoice_id: null,
        client_name: typeof h.client_id === "string" ? clientNames.get(h.client_id) ?? null : null,
      })),
      costs: ((cc.data ?? []) as Array<Record<string, unknown>>).map((c) => ({
        id: String(c.id), client_name: (c.client_name as string | null) ?? null, invoice_number: (c.invoice_number as string | null) ?? null,
        invoice_date: (c.invoice_date as string | null) ?? null, total_ex_btw: num(c.total_ex_btw), total_inc_btw: num(c.total_inc_btw),
        status: (c.status as string | null) ?? null,
      })),
    };
  }

  return NextResponse.json({ ok: true, row, skin: skin?.skin ?? null, hours, hoursTotal, linesTotal, costs, documents, invoice, margin, history, readFailed, candidates });
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
  if (action === "visit" || action === "unvisit") return visitAction(req, db, user.id, row, action, body);

  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((v): v is string => typeof v === "string" && UUID.test(v)) : [];
  if (ids.length === 0 || ids.length > ATTACH_MAX) return NextResponse.json({ error: "Kies iets om te koppelen.", code: "no_ids" }, { status: 400 });

  const attach = action.startsWith("attach");
  // Closed work takes nothing new: an hour attached after the invoice could never be billed from it.
  if (attach && (row.status === "gefactureerd" || row.status === "geannuleerd")) {
    return NextResponse.json({ error: "Dit werk is gesloten; er kan niets meer aan gekoppeld worden.", code: "closed" }, { status: 409 });
  }
  const value = attach ? id : null;
  let touched = 0;
  for (const chunk of chunkIds(ids, 50)) {
    let q;
    if (action.endsWith("_hours")) {
      q = db.from("time_entries").update({ work_item_id: value }).eq("user_id", user.id).in("id", chunk);
      // An hour already on another piece of work is not silently stolen; another client's hour is
      // never this work's; an invoiced hour keeps its link.
      if (attach) {
        q = q.is("work_item_id", null);
        q = row.client_id ? q.or(`client_id.is.null,client_id.eq.${row.client_id}`) : q.is("client_id", null);
      } else {
        q = q.eq("work_item_id", id).is("invoice_id", null);
      }
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

/**
 * [WERK-BEURT] Tick a beurt off, or take an unbilled one back. Only on work that repeats: a
 * werkorder has no beurten. The list is rewritten as a whole under the owner's own row, and a
 * beurt that is on an invoice is never removed — the invoice still names it.
 */
async function visitAction(req: NextRequest, db: any, userId: string, row: WorkRow, action: "visit" | "unvisit", body: Record<string, unknown>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!row.repeat_every) return NextResponse.json({ error: "Dit werk herhaalt niet; het heeft geen beurten.", code: "not_recurring" }, { status: 409 });
  if (row.status === "geannuleerd" || row.status === "gefactureerd") return NextResponse.json({ error: "Dit werk is gesloten.", code: "closed" }, { status: 409 });
  let visits = row.visits;
  let recorded: string | null = null;
  if (action === "visit") {
    const v = readVisit(body, visits, amsterdamToday());
    if (!v.ok) return NextResponse.json({ error: v.reason === "too_many" ? "Te veel beurten op één werk." : "Controleer de datum.", code: v.reason }, { status: 400 });
    visits = [...visits, v.visit];
    recorded = v.visit.on;
  } else {
    const on = typeof body.on === "string" && ISO.test(body.on) ? body.on : null;
    if (!on) return NextResponse.json({ error: "Controleer de datum.", code: "not_a_date" }, { status: 400 });
    const idx = visits.findIndex((v) => v.on === on && !v.invoice_id);
    if (idx < 0) return NextResponse.json({ error: "Die beurt staat al op een factuur of bestaat niet.", code: "not_removable" }, { status: 409 });
    visits = visits.filter((_, i) => i !== idx);
  }
  // A first beurt on planned work means the work has started.
  const patch: Record<string, unknown> = { visits };
  if (action === "visit" && row.status === "open") patch.status = "bezig";
  const { error } = await db.from("work_items").update(patch).eq("id", row.id).eq("user_id", userId);
  if (error) return NextResponse.json({ error: "De beurt kon niet worden opgeslagen." }, { status: 500 });
  if (recorded) {
    await logAuditAction({
      userId, action: "work.visit_recorded", entityType: "work_item", entityId: row.id,
      newValue: { on: recorded, title: row.title, unbilled: unbilledVisits(visits).length },
      ipAddress: getClientIP(req),
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, visits, unbilled: unbilledVisits(visits).length });
}
