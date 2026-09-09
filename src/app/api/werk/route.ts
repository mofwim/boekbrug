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
import { amsterdamToday, amsterdamClock } from "@/lib/format-nl";
import {
  workSkin, vaksForSkin, readFields, readLines, storedLines, storedVisits, storedPeriods, isRepeat, isWorkStatus, isCalendarDay, HAND_STATUSES, canDelete,
  contractStat, contractGroups, periodOf, type WorkStatus,
} from "@/lib/werk";
import type { WorkRow } from "@/lib/werk-rows";
// [WERK-STAND] The money position the screen opens on.
import { loadWorkStand } from "@/lib/werk-stand";

export const dynamic = "force-dynamic";

const COLUMNS = "id, vak, title, client_id, client_name, vehicle_id, status, planned_on, done_on, fields, lines, repeat_every, visits, billed_periods, notes, invoice_id, created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    billed_periods: storedPeriods(r.billed_periods),
    notes: (r.notes as string | null) ?? null,
    invoice_id: (r.invoice_id as string | null) ?? null,
    created_at: String(r.created_at),
  }));
}

/**
 * [WERK-3] The client row behind a typed name, so the invoice made from this work lands on the
 * one client card the owner already has instead of a new card per werkorder, and so the hours
 * picker can be scoped to that client. Exact match on the trimmed name, case-insensitive; a name
 * the owner has never invoiced simply stays a name — the draft door makes the card then.
 */
async function resolveClientId(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, userId: string, name: string | null): Promise<string | null> {
  if (!name) return null;
  const { data } = await supabase.from("clients").select("id, name").eq("user_id", userId).ilike("name", name).limit(2);
  const rows = (data ?? []) as Array<{ id: string; name: string }>;
  const exact = rows.filter((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());
  return exact.length === 1 ? exact[0].id : null;
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

  // [WERK-3] "Regels van vorige keer": the lines of the newest invoiced (or finished) piece of work
  // for this client, so a courier's fixed tariff for an opdrachtgever is one tap, not a retype.
  const vorige = (req.nextUrl.searchParams.get("vorige") ?? "").trim();
  if (vorige) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).from("work_items").select("lines, title, client_name").eq("user_id", user.id)
      .in("vak", vaksForSkin(skin.skin)).ilike("client_name", vorige).in("status", ["gefactureerd", "klaar"])
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return NextResponse.json({ error: "Kon het vorige werk niet lezen." }, { status: 500 });
    return NextResponse.json({ ok: true, lines: storedLines(data?.lines), title: data?.title ?? null });
  }

  // [WERK-STAND] "Wat laat jij liggen?" — the counts and the signals, the same as Vandaag's.
  if (req.nextUrl.searchParams.get("stand") === "1") {
    const stand = await loadWorkStand(supabase, user.id, skin, amsterdamToday());
    if (!stand) return NextResponse.json({ error: "Kon de stand niet lezen." }, { status: 500 });
    return NextResponse.json({ ok: true, ...stand });
  }

  // [CONTRACT] The overview: every repeating row of this skin with this period's hours and costs,
  // grouped per client. Two reads beside the rows; a read that fails leaves its figure at zero
  // AND says so (readFailed), never a healthy-looking contract on a missing number.
  if (req.nextUrl.searchParams.get("contracten") === "1") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data: raw, error: rowsErr } = await db.from("work_items").select(COLUMNS).eq("user_id", user.id).in("vak", vaksForSkin(skin.skin))
      .not("repeat_every", "is", null).not("status", "in", "(gefactureerd,geannuleerd)").order("client_name", { ascending: true }).limit(LIST_MAX);
    if (rowsErr) return NextResponse.json({ error: "Kon de contracten niet laden." }, { status: 500 });
    const rows = await withPlates(supabase, user.id, (raw ?? []) as Array<Record<string, unknown>>);
    const today = amsterdamToday();
    const monthStart = `${periodOf(today)}-01`;
    const ids = rows.map((r) => r.id);
    const hours = new Map<string, number>();
    const costs = new Map<string, number>();
    let readFailed = false;
    if (ids.length > 0) {
      const { data: h, error: hErr } = await db.from("time_entries").select("work_item_id, hours").eq("user_id", user.id).in("work_item_id", ids.slice(0, 200)).gte("worked_on", monthStart).limit(2000);
      if (hErr) readFailed = true;
      for (const e of (h ?? []) as Array<{ work_item_id: string; hours: number | null }>) hours.set(e.work_item_id, (hours.get(e.work_item_id) ?? 0) + Number(e.hours ?? 0));
      const { data: c, error: cErr } = await db.from("invoices").select("work_item_id, total_ex_btw").eq("receiver_id", user.id).eq("direction", "incoming").in("work_item_id", ids.slice(0, 200)).gte("invoice_date", monthStart).limit(2000);
      if (cErr) readFailed = true;
      for (const e of (c ?? []) as Array<{ work_item_id: string; total_ex_btw: number | null }>) costs.set(e.work_item_id, (costs.get(e.work_item_id) ?? 0) + Math.abs(Number(e.total_ex_btw ?? 0)));
    }
    const stats = rows.map((r) => contractStat({ row: r, hoursMonth: hours.get(r.id) ?? 0, costsMonth: costs.get(r.id) ?? 0, today }));
    return NextResponse.json({ ok: true, period: periodOf(today), groups: contractGroups(stats), readFailed });
  }

  const status = req.nextUrl.searchParams.get("status");
  // Only rows of the skin the owner works in now: a werkorder is never drawn as an opdracht with
  // statuses the new skin has no words for. Rows of an earlier trade come back with that trade.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any).from("work_items").select(COLUMNS).eq("user_id", user.id).in("vak", vaksForSkin(skin.skin));
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
  if (plannedOn && !isCalendarDay(plannedOn)) return NextResponse.json({ error: "Controleer de datum.", code: "bad_date" }, { status: 400 });
  const repeat = readRepeat(skin, body.repeat_every);
  if (!repeat.ok) return NextResponse.json({ error: "Die herhaling bestaat niet voor dit werk.", code: "bad_repeat" }, { status: 400 });

  let clientId: string | null = typeof body.client_id === "string" && UUID.test(body.client_id) ? body.client_id : null;
  if (clientId) {
    const { data: c } = await supabase.from("clients").select("id, name").eq("id", clientId).eq("user_id", user.id).maybeSingle();
    if (!c) clientId = null;
    else if (!text(body.client_name)) body.client_name = c.name;
  }
  const clientName = text(body.client_name);
  // Work without a client cannot become an invoice, and the form says so; refuse it here too.
  if (!clientName) return NextResponse.json({ error: "Zet een klant op dit werk.", code: "no_client" }, { status: 400 });
  if (!clientId) clientId = await resolveClientId(supabase, user.id, clientName);

  // A garage types a plate; the vehicle register is the same one /dashboard/voertuigen keeps.
  // Found → reuse, and fill in a customer name or phone the register did not have yet; never
  // overwrite what another screen wrote. New → insert with what this form knows.
  let vehicleId: string | null = typeof body.vehicle_id === "string" && UUID.test(body.vehicle_id) ? body.vehicle_id : null;
  const plate = skin.vehicle ? normalizeKenteken(typeof body.kenteken === "string" ? body.kenteken : "") : "";
  const phone = typeof fields.fields.telefoon === "string" ? fields.fields.telefoon : null;
  if (!vehicleId && plate) {
    if (!isKentekenShape(plate)) return NextResponse.json({ error: "Dit lijkt geen Nederlands kenteken. Controleer de tekens.", code: "bad_plate" }, { status: 400 });
    const { data: known, error: knownErr } = await supabase.from("vehicles").select("id, customer_name, customer_phone").eq("user_id", user.id).eq("kenteken", plate).maybeSingle();
    if (knownErr) return NextResponse.json({ error: "Kon het voertuig niet vastleggen." }, { status: 500 });
    if (known) {
      vehicleId = known.id;
      const fill: Record<string, string> = {};
      if (!known.customer_name) fill.customer_name = clientName;
      if (!known.customer_phone && phone) fill.customer_phone = phone;
      if (Object.keys(fill).length > 0) await supabase.from("vehicles").update({ ...fill, updated_at: new Date().toISOString() }).eq("id", known.id).eq("user_id", user.id);
    } else {
      const { data: v, error: vErr } = await supabase
        .from("vehicles")
        .insert({ user_id: user.id, kenteken: plate, customer_name: clientName, ...(phone ? { customer_phone: phone } : {}) })
        .select("id").single();
      if (vErr || !v) return NextResponse.json({ error: "Kon het voertuig niet vastleggen." }, { status: 500 });
      vehicleId = v.id;
    }
  }

  const record = {
    user_id: user.id,
    vak,
    title,
    client_id: clientId,
    client_name: clientName,
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
  // Invoiced work keeps its status — unless its draft was deleted (invoice_id is null then, the
  // FK did that): such a row is stranded, and the owner may move it again.
  const stranded = current.status === "gefactureerd" && !current.invoice_id;
  if (current.status === "gefactureerd" && !stranded && body.status !== undefined) {
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
    if (current.status === "gefactureerd" && !stranded) return NextResponse.json({ error: "Gefactureerd werk verandert niet meer van regels.", code: "invoiced" }, { status: 409 });
    const lines = readLines(skin, body.lines);
    if (!lines.ok) return NextResponse.json({ error: "Controleer de regels.", code: "bad_line", index: lines.index, reason: lines.reason }, { status: 400 });
    patch.lines = lines.lines;
  }
  if (body.notes !== undefined) patch.notes = text(body.notes, 2000);
  if (body.client_name !== undefined) {
    const name = text(body.client_name);
    if (!name) return NextResponse.json({ error: "Zet een klant op dit werk.", code: "no_client" }, { status: 400 });
    patch.client_name = name;
    if (name.trim().toLowerCase() !== String(current.client_name ?? "").trim().toLowerCase()) patch.client_id = await resolveClientId(supabase, user.id, name);
  }
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
    if (v && !isCalendarDay(v)) return NextResponse.json({ error: "Controleer de datum.", code: "bad_date" }, { status: 400 });
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
      // [WERK-3] The courier's clock: 'afgeleverd' stamps the Amsterdam time on the rit, once; it
      // is printed on the invoice heading beside the ontvanger (deliveryText in werk.ts).
      if (next === "klaar" && skin.skin === "rit") {
        const f = (patch.fields ?? (current.fields && typeof current.fields === "object" ? current.fields : {})) as Record<string, unknown>;
        if (typeof f.afgeleverd_om !== "string" || !f.afgeleverd_om) patch.fields = { ...f, afgeleverd_om: amsterdamClock() };
      }
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
  const { data: current } = await db.from("work_items").select("id, title, invoice_id, visits").eq("id", id).eq("user_id", user.id).maybeSingle();
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
  if (!canDelete({ invoice_id: current.invoice_id ?? null, attachedCosts: costs, attachedHours: hours, visits: storedVisits(current.visits) })) {
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
