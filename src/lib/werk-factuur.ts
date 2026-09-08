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
import { linesFromEntries, DEFAULT_HOUR_BTW_RATE, type TimeEntry } from "@/lib/uren";
import { displayKenteken } from "@/lib/vehicle";
import { amsterdamToday } from "@/lib/format-nl";
import { chunkIds } from "@/lib/supabase-paginate";
import { storedLines, storedVisits, isRepeat, workSkin, workInvoiceLines, type InvoiceLineDraft, type Visit, type WorkLine } from "@/lib/werk";

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

const COLUMNS = "id, vak, title, client_id, client_name, vehicle_id, status, fields, lines, repeat_every, visits, planned_on, done_on, invoice_id";

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
      planned_on: (r.planned_on as string | null) ?? null, done_on: (r.done_on as string | null) ?? null,
      invoice_id: (r.invoice_id as string | null) ?? null,
    };
    // The hours attached and not yet billed, at their own rate — the same builder the hours
    // invoice uses, so an hour is worth the same on every door.
    const { data: hourRows, error: hoursErr } = await db
      .from("time_entries")
      .select("id, client_id, worked_on, description, hours, hourly_rate, invoice_id")
      .eq("user_id", userId).eq("work_item_id", row.id).is("invoice_id", null)
      .order("worked_on", { ascending: true }).limit(200);
    if (hoursErr) return { ok: false, error: "De uren konden niet worden gelezen. Probeer het opnieuw.", status: 503 };
    const built = linesFromEntries((hourRows ?? []) as TimeEntry[], DEFAULT_HOUR_BTW_RATE);
    const plate = row.vehicle_id ? plates.get(row.vehicle_id) ?? null : null;
    const lines = workInvoiceLines({
      skin: workSkin(row.vak), row, kenteken: plate ? displayKenteken(plate) : null,
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

/** The hours are on the invoice now; stamp them so they can never be billed twice. */
export async function stampHours(db: any, userId: string, works: readonly WorkLoaded[], invoiceId: string): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const w of works) {
    for (const chunk of chunkIds(w.billedHourIds, 100)) {
      await db.from("time_entries").update({ invoice_id: invoiceId }).eq("user_id", userId).eq("work_item_id", w.row.id).is("invoice_id", null).in("id", chunk);
    }
  }
}
