// src/lib/werk-factuur.ts
// [WERK] What the two invoice doors share: loading a piece of work with its unbilled hours and
// building its lines, opening the draft through the ONE draft door, and stamping the hours that
// went on it. Server-only (it reads the database and calls a route handler); the arithmetic and
// the line order live in werk.ts and are tested there.
//
// Two doors, one helper, on purpose: /api/werk/[id]/factuur (one piece of work) and
// /api/werk/factuur (several, for one client) must put the same lines on an invoice for the same
// work, or an owner who bills a rit alone and a rit in a week's batch gets two different bills
// for the same job.

import { NextRequest } from "next/server";
import { POST as createDraft } from "@/app/api/invoice/draft/route";
import { linesFromEntries, verifyStamped, DEFAULT_HOUR_BTW_RATE, type TimeEntry } from "@/lib/uren";
import { displayKenteken } from "@/lib/vehicle";
import { amsterdamToday } from "@/lib/format-nl";
import { chunkIds } from "@/lib/supabase-paginate";
import { storedLines, storedVisits, storedPeriods, isRepeat, workSkin, workInvoiceLines, hourBtwFor, type BilledPeriod, type InvoiceLineDraft, type Visit, type WorkLine } from "@/lib/werk";

export interface WorkRowForInvoice {
  id: string;
  vak: string;
  title: string;
  client_id: string | null;
  client_name: string | null;
  vehicle_id: string | null;
  status: string;
  fields: Record<string, string | number>;
  lines: WorkLine[];
  repeat_every: string | null;
  visits: Visit[];
  billed_periods: BilledPeriod[];
  planned_on: string | null;
  done_on: string | null;
  invoice_id: string | null;
}

export interface WorkLoaded {
  row: WorkRowForInvoice;
  /** The lines this work puts on the invoice, in the order werk.ts prescribes. */
  lines: InvoiceLineDraft[];
  /** The time entries that went on those lines; stamped after the draft exists. */
  billedHourIds: string[];
  hoursWithoutRate: number;
}

type Loaded = { ok: true; works: WorkLoaded[] } | { ok: false; error: string; status: number };

const COLUMNS = "id, vak, title, client_id, client_name, vehicle_id, status, fields, lines, repeat_every, visits, billed_periods, planned_on, done_on, invoice_id";
const HOURS_PAGE = 200;
const HOURS_MAX = 2000;

/**
 * Load the owner's work rows by id with their unbilled hours, and build each one's lines. A row
 * that is not the owner's is simply absent (RLS + the user_id filter); the caller compares counts.
 * `heading` puts a € 0 line naming each piece of work first — the verzamelfactuur needs it, a
 * single invoice does not (its werkorder line already names the car).
 */
export async function loadWorkForInvoice(db: any, userId: string, ids: string[], opts: { heading?: boolean } = {}): Promise<Loaded> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows: Record<string, unknown>[] = [];
  for (const chunk of chunkIds(ids, 50)) {
    const { data, error } = await db.from("work_items").select(COLUMNS).eq("user_id", userId).in("id", chunk);
    if (error) return { ok: false, error: "Kon het werk niet laden.", status: 500 };
    rows.push(...((data ?? []) as Record<string, unknown>[]));
  }
  if (rows.length === 0) return { ok: false, error: "Dit werk is niet gevonden.", status: 404 };

  const vehicleIds = [...new Set(rows.map((r) => r.vehicle_id).filter((v): v is string => typeof v === "string"))];
  const plates = new Map<string, string>();
  for (const chunk of chunkIds(vehicleIds, 50)) {
    const { data } = await db.from("vehicles").select("id, kenteken").eq("user_id", userId).in("id", chunk);
    for (const v of (data ?? []) as Array<{ id: string; kenteken: string }>) plates.set(v.id, v.kenteken);
  }

  const works: WorkLoaded[] = [];
  for (const r of rows) {
    const row: WorkRowForInvoice = {
      id: String(r.id), vak: String(r.vak), title: String(r.title),
      client_id: (r.client_id as string | null) ?? null, client_name: (r.client_name as string | null) ?? null,
      vehicle_id: (r.vehicle_id as string | null) ?? null, status: String(r.status),
      fields: (r.fields && typeof r.fields === "object" ? r.fields : {}) as Record<string, string | number>,
      lines: storedLines(r.lines), repeat_every: isRepeat(r.repeat_every) ? r.repeat_every : null, visits: storedVisits(r.visits),
      billed_periods: storedPeriods(r.billed_periods),
      planned_on: (r.planned_on as string | null) ?? null, done_on: (r.done_on as string | null) ?? null,
      invoice_id: (r.invoice_id as string | null) ?? null,
    };
    // The hours attached and not yet billed, at their own rate — the same builder the hours
    // invoice uses, so an hour is worth the same on every door. Paged: a season of hours on one
    // klus is not a corner case, and a silent cap would leave the last of them off the invoice.
    const hourRows: TimeEntry[] = [];
    for (let from = 0; ; from += HOURS_PAGE) {
      const { data, error: hoursErr } = await db
        .from("time_entries")
        .select("id, client_id, worked_on, description, hours, hourly_rate, invoice_id")
        .eq("user_id", userId).eq("work_item_id", row.id).is("invoice_id", null)
        .order("worked_on", { ascending: true }).order("id", { ascending: true }).range(from, from + HOURS_PAGE - 1);
      if (hoursErr) return { ok: false, error: "De uren konden niet worden gelezen. Probeer het opnieuw.", status: 503 };
      hourRows.push(...((data ?? []) as TimeEntry[]));
      if ((data ?? []).length < HOURS_PAGE) break;
      if (hourRows.length >= HOURS_MAX) return { ok: false, error: "Te veel uren op één stuk werk voor één factuur.", status: 409 };
    }
    const skin = workSkin(row.vak);
    // A fietsenmaker's repair hour is 9%, like the arbeid line the skin starts on.
    const built = linesFromEntries(hourRows, hourBtwFor(skin, DEFAULT_HOUR_BTW_RATE));
    const plate = row.vehicle_id ? plates.get(row.vehicle_id) ?? null : null;
    const lines = workInvoiceLines({
      skin, row, kenteken: plate ? displayKenteken(plate) : null,
      hourLines: built.lines, heading: opts.heading === true,
    });
    works.push({ row, lines, billedHourIds: built.billedIds, hoursWithoutRate: built.skippedWithoutRate.length });
  }
  return { ok: true, works };
}

/** Open the draft through the ordinary door, as the invoice screen would. */
export async function openDraftFor(req: NextRequest, args: { client_id: string | null; client_name: string; lines: InvoiceLineDraft[] }): Promise<{ ok: true; invoiceId: string } | { ok: false; error: string; status: number }> {
  const door = new NextRequest(new URL("/api/invoice/draft", req.url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "", "x-real-ip": req.headers.get("x-real-ip") ?? "" },
    body: JSON.stringify({
      invoiceType: "factuur",
      client_id: args.client_id ?? undefined,
      client_name: args.client_name,
      invoice_date: amsterdamToday(),
      lines: args.lines,
    }),
  });
  const res = await createDraft(door);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.invoiceId) {
    return { ok: false, error: typeof json?.error === "string" ? json.error : "De factuur kon niet worden gemaakt.", status: res.ok ? 500 : res.status };
  }
  return { ok: true, invoiceId: String(json.invoiceId) };
}

/**
 * The hours are on the invoice now; stamp them so they can never be billed twice — and PROVE it.
 *
 * The same invariant the draft door keeps for an hours invoice ([UREN-EENMALIG] there): the stamp
 * is `UPDATE … WHERE invoice_id IS NULL`, so an hour comes back only if it was still unbilled. One
 * that does not come back went on another invoice meanwhile (two tabs, or /dashboard/uren), and
 * the draft now carries a line for work that is still in the billable pool. There is no safe way
 * to continue from that: the caller rolls the draft back and says so.
 */
export async function stampHours(db: any, userId: string, works: readonly WorkLoaded[], invoiceId: string): Promise<{ ok: true } | { ok: false; missing: number }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const wanted: string[] = [];
  const stamped: string[] = [];
  for (const w of works) {
    wanted.push(...w.billedHourIds);
    for (const chunk of chunkIds(w.billedHourIds, 100)) {
      const { data, error } = await db.from("time_entries").update({ invoice_id: invoiceId }).eq("user_id", userId).eq("work_item_id", w.row.id).is("invoice_id", null).in("id", chunk).select("id");
      if (error) return { ok: false, missing: wanted.length };
      stamped.push(...((data ?? []) as Array<{ id: string }>).map((r) => r.id));
    }
  }
  const verdict = verifyStamped(wanted, stamped);
  return verdict.ok ? { ok: true } : { ok: false, missing: verdict.missing.length };
}

/**
 * Undo a draft this door just made: free the hours it stamped, drop its lines, drop the draft.
 * Only a draft — the delete is guarded on status, and RLS lets an owner delete only drafts.
 * Used when the stamp or the close did not prove itself; a draft whose lines are not backed by
 * what they name is worse than no draft.
 */
export async function rollbackDraft(db: any, userId: string, invoiceId: string): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  await db.from("time_entries").update({ invoice_id: null }).eq("user_id", userId).eq("invoice_id", invoiceId);
  await db.from("invoice_lines").delete().eq("invoice_id", invoiceId);
  const { error } = await db.from("invoices").delete().eq("id", invoiceId).eq("sender_id", userId).eq("status", "draft");
  if (error) console.error("[WERK] draft rollback failed — a draft without stamped hours remains", { invoiceId, error: error.message });
}

/**
 * Close one-off work on its invoice, once. `.is("invoice_id", null)` is the race guard: two tabs
 * that both passed canInvoice both open a draft, and only the first closes the row. The count is
 * the answer; the caller rolls its own draft back when it is short.
 */
export async function closeWork(db: any, userId: string, ids: readonly string[], invoiceId: string, today: string): Promise<{ closed: number; error: string | null }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  let closed = 0;
  for (const chunk of chunkIds([...ids], 50)) {
    const { data, error } = await db
      .from("work_items")
      .update({ invoice_id: invoiceId, status: "gefactureerd" })
      .eq("user_id", userId).in("id", chunk).is("invoice_id", null).select("id");
    if (error) return { closed, error: error.message };
    closed += (data ?? []).length;
  }
  // done_on only where it was empty — an UPDATE cannot say "keep yours" per row in one statement.
  await db.from("work_items").update({ done_on: today }).eq("user_id", userId).eq("invoice_id", invoiceId).is("done_on", null);
  return { closed, error: null };
}

/**
 * [WERK-BEURT] Stamp the beurten an invoice covers on repeating work, under an optimistic lock.
 * The row's visits are re-read with updated_at; the write is `WHERE updated_at = <read>`, so a
 * beurt ticked off in between is never overwritten — the write misses, and we read again. Every
 * covered beurt must be found unbilled, or the invoice would name a beurt that is already on
 * another one; then the caller rolls back.
 */
export async function stampVisits(db: any, userId: string, workId: string, covered: readonly Visit[], invoiceId: string): Promise<{ ok: true } | { ok: false; reason: "already_billed" | "write_failed" }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: fresh, error: readErr } = await db.from("work_items").select("visits, updated_at").eq("id", workId).eq("user_id", userId).maybeSingle();
    if (readErr || !fresh) return { ok: false, reason: "write_failed" };
    const current = storedVisits(fresh.visits);
    // Match by day, one per covered beurt, unbilled only.
    const wanted = new Map<string, number>();
    for (const v of covered) wanted.set(v.on, (wanted.get(v.on) ?? 0) + 1);
    let stamped = 0;
    const next = current.map((v) => {
      const left = wanted.get(v.on) ?? 0;
      if (!v.invoice_id && left > 0) { wanted.set(v.on, left - 1); stamped += 1; return { ...v, invoice_id: invoiceId }; }
      return v;
    });
    if (stamped !== covered.length) return { ok: false, reason: "already_billed" };
    const { data: written, error: writeErr } = await db.from("work_items").update({ visits: next })
      .eq("id", workId).eq("user_id", userId).eq("updated_at", fresh.updated_at).select("id");
    if (writeErr) return { ok: false, reason: "write_failed" };
    if ((written ?? []).length === 1) return { ok: true };
    // Someone wrote in between; read again with their beurt included.
  }
  return { ok: false, reason: "write_failed" };
}

/**
 * [CONTRACT] Stamp a period on a fee contract, under the same optimistic lock as the beurten:
 * the row is re-read with updated_at, the write is `WHERE updated_at = <read>`. A period found
 * billed meanwhile (a second tab) refuses, and the caller rolls the draft back. The beurten of
 * that period are stamped with the same invoice — the fee covered them — so they never show as
 * "nog te factureren".
 */
/**
 * [STRIPPENKAART] Bill the bundle ONCE, and leave the row open.
 *
 * The difference with closeWork is the whole feature: the row keeps its status, so the hours that
 * draw the bundle down can still be written on it for months. `.is("invoice_id", null)` is the
 * race guard - two tabs that both passed canInvoiceBundle both open a draft, and only the first
 * one lands. The count is the answer; the caller rolls its own draft back when it is short.
 */
export async function stampBundle(db: any, userId: string, workId: string, invoiceId: string): Promise<{ ok: true } | { ok: false; reason: "already_billed" | "write_failed" }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data, error } = await db
    .from("work_items")
    .update({ invoice_id: invoiceId })
    .eq("id", workId).eq("user_id", userId).is("invoice_id", null).select("id");
  if (error) return { ok: false, reason: "write_failed" };
  return (data ?? []).length === 1 ? { ok: true } : { ok: false, reason: "already_billed" };
}

export async function stampPeriod(db: any, userId: string, workId: string, period: string, invoiceId: string): Promise<{ ok: true } | { ok: false; reason: "already_billed" | "write_failed" }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: fresh, error: readErr } = await db.from("work_items").select("visits, billed_periods, updated_at").eq("id", workId).eq("user_id", userId).maybeSingle();
    if (readErr || !fresh) return { ok: false, reason: "write_failed" };
    const periods = storedPeriods(fresh.billed_periods);
    if (periods.some((p) => p.period === period)) return { ok: false, reason: "already_billed" };
    const visits = storedVisits(fresh.visits).map((v) => (!v.invoice_id && v.on.startsWith(period) ? { ...v, invoice_id: invoiceId } : v));
    const { data: written, error: writeErr } = await db.from("work_items").update({ billed_periods: [...periods, { period, invoice_id: invoiceId }], visits })
      .eq("id", workId).eq("user_id", userId).eq("updated_at", fresh.updated_at).select("id");
    if (writeErr) return { ok: false, reason: "write_failed" };
    if ((written ?? []).length === 1) return { ok: true };
  }
  return { ok: false, reason: "write_failed" };
}
