// src/app/api/werk/route.ts
// [WERK] The trade's own work: list, create, update, delete.
//
// Owner-only, on the session client (RLS), the same shape as /api/vehicles. The trade skin comes
// from the profile's vak and decides the noun, the statuses and the fields; werk.ts validates,
// this file only reads and writes. Money never enters here — see work_items.sql.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireOwner } from "@/lib/owner-only";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { normalizeKenteken, isKentekenShape } from "@/lib/vehicle";
import { amsterdamToday } from "@/lib/format-nl";
import {
  workSkin, readFields, readLines, storedLines, storedVisits, isRepeat, isWorkStatus, HAND_STATUSES, canDelete, type WorkStatus,
} from "@/lib/werk";
import type { WorkRow } from "@/lib/werk-rows";

export const dynamic = "force-dynamic";

const COLUMNS = "id, vak, title, client_id, client_name, vehicle_id, status, planned_on, done_on, fields, lines, repeat_every, visits, notes, invoice_id, created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LIST_MAX = 300;

function text(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function missingTable(message: string | undefined): boolean {
  return /relation .* does not exist|schema cache|column .* does not exist/i.test(message ?? "");
}

/** The owner's trade skin, or a 404-shaped answer when the trade has no work layer. */
async function skinFor(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, userId: string) {
  const { data } = await supabase.from("profiles").select("vak").eq("id", userId).maybeSingle();
  const vak = (data as { vak?: string | null } | null)?.vak ?? null;
  const skin = workSkin(vak);
  return { vak, skin };
}

async function withPlates(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, userId: string, rows: Array<Record<string, unknown>>): Promise<WorkRow[]> {
  const vehicleIds = [...new Set(rows.map((r) => r.vehicle_id).filter((v): v is string => typeof v === "string"))];
  const plates = new Map<string, string>();
  if (vehicleIds.length > 0) {
    const vehicles = await fetchAllRowsForIds<{ id: string; kenteken: string }, string>(
      vehicleIds,
      (chunk, from, to) => supabase.from("vehicles").select("id, kenteken").eq("user_id", userId).in("id", chunk).order("id", { ascending: true }).range(from, to),
    ).catch(() => [] as { id: string; kenteken: string }[]);
    for (const v of vehicles) plates.set(v.id, v.kenteken);
  }
  return rows.map((r) => ({
    id: String(r.id),
    vak: String(r.vak),
    title: String(r.title),
    client_id: (r.client_id as string | null) ?? null,
    client_name: (r.client_name as string | null) ?? null,
    vehicle_id: (r.vehicle_id as string | null) ?? null,
    kenteken: typeof r.vehicle_id === "string" ? plates.get(r.vehicle_id) ?? null : null,
    status: r.status as WorkStatus,
    planned_on: (r.planned_on as string | null) ?? null,
    done_on: (r.done_on as string | null) ?? null,
    fields: (r.fields && typeof r.fields === "object" ? r.fields : {}) as WorkRow["fields"],
    lines: storedLines(r.lines),
    repeat_every: isRepeat(r.repeat_every) ? r.repeat_every : null,
    visits: storedVisits(r.visits),
    notes: (r.notes as string | null) ?? null,
    invoice_id: (r.invoice_id as string | null) ?? null,
    created_at: String(r.created_at),
  }));
}

/**
 * [WERK-BEURT] The rhythm, read from an untrusted body. Only a skin that repeats may carry one;
 * an empty value clears it. Anything else is refused rather than stored as text.
 */
function readRepeat(skin: { recurring: boolean }, raw: unknown): { ok: true; repeat: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === "" || raw === "none") return { ok: true, repeat: null };
  if (!skin.recurring || !isRepeat(raw)) return { ok: false };
  return { ok: true, repeat: raw };
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const { vak, skin } = await skinFor(supabase, user.id);
  if (!skin) return NextResponse.json({ ok: true, vak, skin: null, rows: [] });

  const status = req.nextUrl.searchParams.get("status");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any).from("work_items").select(COLUMNS).eq("user_id", user.id);
  if (status && isWorkStatus(status)) q = q.eq("status", status);
  else if (status !== "all") q = q.not("status", "in", "(gefactureerd,geannuleerd)");
  const { data, error } = await q
    .order("planned_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(LIST_MAX);
  if (error) {
    return NextResponse.json(
      { error: missingTable(error.message) ? "Werk staat nog niet aan op deze omgeving." : "Kon het werk niet laden." },
      { status: missingTable(error.message) ? 503 : 500 },
    );
  }
  const rows = await withPlates(supabase, user.id, (data ?? []) as Array<Record<string, unknown>>);
  return NextResponse.json({ ok: true, vak, skin: skin.skin, rows, capped: rows.length >= LIST_MAX });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Werk vastleggen");
  if (guard.response) return guard.response;
  const { vak, skin } = await skinFor(supabase, user.id);
  if (!skin || !vak) return NextResponse.json({ error: "Voor dit vak is er geen werkscherm." }, { status: 409 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 }); }

  const title = text(body.title, 200);
  if (!title) return NextResponse.json({ error: "Geef het werk een naam.", code: "no_title" }, { status: 400 });
  const fields = readFields(skin, body.fields);
  if (!fields.ok) return NextResponse.json({ error: "Controleer de invoer.", code: "bad_field", field: fields.key, reason: fields.reason }, { status: 400 });
  const lines = readLines(skin, body.lines);
  if (!lines.ok) return NextResponse.json({ error: "Controleer de regels.", code: "bad_line", index: lines.index, reason: lines.reason }, { status: 400 });
  const plannedOn = text(body.planned_on, 10);
  if (plannedOn && !ISO.test(plannedOn)) return NextResponse.json({ error: "Controleer de datum.", code: "bad_date" }, { status: 400 });
  const repeat = readRepeat(skin, body.repeat_every);
  if (!repeat.ok) return NextResponse.json({ error: "Die herhaling bestaat niet voor dit werk.", code: "bad_repeat" }, { status: 400 });

  // A garage types a plate; the vehicle register is the same one /dashboard/voertuigen keeps.
  let vehicleId: string | null = typeof body.vehicle_id === "string" && UUID.test(body.vehicle_id) ? body.vehicle_id : null;
  const plate = skin.vehicle ? normalizeKenteken(typeof body.kenteken === "string" ? body.kenteken : "") : "";
  if (!vehicleId && plate) {
    if (!isKentekenShape(plate)) return NextResponse.json({ error: "Dit lijkt geen Nederlands kenteken. Controleer de tekens.", code: "bad_plate" }, { status: 400 });
    const { data: v, error: vErr } = await supabase
      .from("vehicles")
      .upsert({ user_id: user.id, kenteken: plate, customer_name: text(body.client_name), updated_at: new Date().toISOString() }, { onConflict: "user_id,kenteken" })
      .select("id").single();
    if (vErr || !v) return NextResponse.json({ error: "Kon het voertuig niet vastleggen." }, { status: 500 });
    vehicleId = v.id;
  }

  let clientId: string | null = typeof body.client_id === "string" && UUID.test(body.client_id) ? body.client_id : null;
  if (clientId) {
    const { data: c } = await supabase.from("clients").select("id, name").eq("id", clientId).eq("user_id", user.id).maybeSingle();
    if (!c) clientId = null;
    else if (!text(body.client_name)) body.client_name = c.name;
  }

  const record = {
    user_id: user.id,
    vak,
    title,
    client_id: clientId,
    client_name: text(body.client_name),
    vehicle_id: vehicleId,
    status: "open",
    planned_on: plannedOn,
    fields: fields.fields,
    lines: lines.lines,
    repeat_every: repeat.repeat,
    notes: text(body.notes, 2000),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from("work_items").insert(record).select(COLUMNS).single();
  if (error || !data) {
    return NextResponse.json(
      { error: missingTable(error?.message) ? "Werk staat nog niet aan op deze omgeving." : "Kon het werk niet opslaan." },
      { status: missingTable(error?.message) ? 503 : 500 },
    );
  }
  const [row] = await withPlates(supabase, user.id, [data as Record<string, unknown>]);
  await logAuditAction({
    userId: user.id, action: "work.created", entityType: "work_item", entityId: row.id,
    newValue: { skin: skin.skin, title: row.title, client_name: row.client_name, kenteken: row.kenteken, planned_on: row.planned_on, repeat_every: row.repeat_every },
    ipAddress: getClientIP(req),
  }).catch(() => {});
  return NextResponse.json({ ok: true, row });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Werk bijwerken");
  if (guard.response) return guard.response;
  const { skin } = await skinFor(supabase, user.id);
  if (!skin) return NextResponse.json({ error: "Voor dit vak is er geen werkscherm." }, { status: 409 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 }); }
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: current, error: curErr } = await (supabase as any).from("work_items").select(COLUMNS).eq("id", id).eq("user_id", user.id).maybeSingle();
  if (curErr) return NextResponse.json({ error: "Kon het werk niet laden." }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Dit werk is niet gevonden." }, { status: 404 });
  if (current.status === "gefactureerd" && body.status !== undefined) {
    return NextResponse.json({ error: "Gefactureerd werk verandert niet meer van status.", code: "invoiced" }, { status: 409 });
  }

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const title = text(body.title, 200);
    if (!title) return NextResponse.json({ error: "Geef het werk een naam.", code: "no_title" }, { status: 400 });
    patch.title = title;
  }
  if (body.fields !== undefined) {
    const fields = readFields(skin, body.fields);
    if (!fields.ok) return NextResponse.json({ error: "Controleer de invoer.", code: "bad_field", field: fields.key, reason: fields.reason }, { status: 400 });
    patch.fields = fields.fields;
  }
  if (body.lines !== undefined) {
    if (current.status === "gefactureerd") return NextResponse.json({ error: "Gefactureerd werk verandert niet meer van regels.", code: "invoiced" }, { status: 409 });
    const lines = readLines(skin, body.lines);
    if (!lines.ok) return NextResponse.json({ error: "Controleer de regels.", code: "bad_line", index: lines.index, reason: lines.reason }, { status: 400 });
    patch.lines = lines.lines;
  }
  if (body.notes !== undefined) patch.notes = text(body.notes, 2000);
  if (body.client_name !== undefined) patch.client_name = text(body.client_name);
  if (body.repeat_every !== undefined) {
    // Repeating work with billed beurten cannot become one-off work: the beurten would lose the
    // rows that explain their invoices.
    const repeat = readRepeat(skin, body.repeat_every);
    if (!repeat.ok) return NextResponse.json({ error: "Die herhaling bestaat niet voor dit werk.", code: "bad_repeat" }, { status: 400 });
    if (!repeat.repeat && storedVisits(current.visits).some((v) => v.invoice_id)) {
      return NextResponse.json({ error: "Er zijn al beurten gefactureerd; dit werk blijft terugkerend.", code: "billed_visits" }, { status: 409 });
    }
    patch.repeat_every = repeat.repeat;
  }
  for (const k of ["planned_on", "done_on"] as const) {
    if (body[k] === undefined) continue;
    const v = text(body[k], 10);
    if (v && !ISO.test(v)) return NextResponse.json({ error: "Controleer de datum.", code: "bad_date" }, { status: 400 });
    patch[k] = v;
  }
  let statusChanged: { from: string; to: WorkStatus } | null = null;
  if (body.status !== undefined) {
    const next = body.status;
    if (!isWorkStatus(next) || !HAND_STATUSES.includes(next) || !skin.statuses.includes(next)) {
      return NextResponse.json({ error: "Die status bestaat niet voor dit werk.", code: "bad_status" }, { status: 400 });
    }
    if (next !== current.status) {
      patch.status = next;
      statusChanged = { from: current.status, to: next };
      if (next === "klaar" && !current.done_on && patch.done_on === undefined) patch.done_on = amsterdamToday();
    }
  }
  if (Object.keys(patch).length === 0) {
    const [row] = await withPlates(supabase, user.id, [current as Record<string, unknown>]);
    return NextResponse.json({ ok: true, row });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from("work_items").update(patch).eq("id", id).eq("user_id", user.id).select(COLUMNS).single();
  if (error || !data) return NextResponse.json({ error: "Kon het werk niet bijwerken." }, { status: 500 });
  const [row] = await withPlates(supabase, user.id, [data as Record<string, unknown>]);
  if (statusChanged) {
    await logAuditAction({
      userId: user.id, action: "work.status_changed", entityType: "work_item", entityId: id,
      oldValue: { status: statusChanged.from }, newValue: { status: statusChanged.to, title: row.title },
      ipAddress: getClientIP(req),
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, row });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Werk verwijderen");
  if (guard.response) return guard.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: current } = await db.from("work_items").select("id, title, invoice_id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Dit werk is niet gevonden." }, { status: 404 });
  const [costsRes, hoursRes] = await Promise.all([
    db.from("invoices").select("id", { count: "exact", head: true }).eq("work_item_id", id),
    db.from("time_entries").select("id", { count: "exact", head: true }).eq("work_item_id", id),
  ]);
  // A count that could not be read is not zero: deleting on "nothing attached" when the read
  // failed would orphan a cost that IS attached.
  if (costsRes.error || hoursRes.error) return NextResponse.json({ error: "Kon niet nagaan wat er aan dit werk hangt. Probeer het opnieuw." }, { status: 503 });
  const costs: number = costsRes.count ?? 0;
  const hours: number = hoursRes.count ?? 0;
  if (!canDelete({ invoice_id: current.invoice_id ?? null, attachedCosts: costs, attachedHours: hours })) {
    return NextResponse.json({ error: "Er hangt al geld of tijd aan dit werk; maak het los of annuleer het.", code: "attached" }, { status: 409 });
  }
  const { error } = await db.from("work_items").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Kon het werk niet verwijderen." }, { status: 500 });
  await logAuditAction({
    userId: user.id, action: "work.deleted", entityType: "work_item", entityId: id,
    oldValue: { title: current.title }, ipAddress: getClientIP(req),
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
