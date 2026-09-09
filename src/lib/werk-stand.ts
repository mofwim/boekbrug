// src/lib/werk-stand.ts
// [WERK-STAND] "Wat laat jij liggen?" — the work layer's money position, read once for a screen.
//
// Vandaag computed this inline; the Werk screen now opens on the same numbers, so the reads live
// here and both call it. Server-side: it reads work_items, time_entries and invoices under the
// caller's own client (RLS), never the pipeline. Each side read may fail on its own and then its
// signal is simply absent — never a zero dressed up as an answer. A failed rows read is null.

import { workCounts, workSignals, storedLines, bundleHours, UNBILLED_HOURS_DAYS, type WorkCounts, type WorkSignal, type WorkSkin } from "./werk";

/** A calendar day, N days back. String surgery through UTC, never the server's local clock. */
function isoMinusDays(iso: string, days: number): string {
  const ms = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export interface WorkStand {
  pluralKey: string;
  counts: WorkCounts;
  signals: WorkSignal[];
}

export async function loadWorkStand(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  skin: WorkSkin,
  today: string,
): Promise<WorkStand | null> {
  const { data: rows, error: werkErr } = await db
    .from("work_items").select("id, status, invoice_id, repeat_every, visits, lines, fields, billed_periods").eq("user_id", userId)
    .not("status", "in", "(gefactureerd,geannuleerd)").limit(300);
  if (werkErr) return null;
  const open = ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), status: String(r.status), invoice_id: (r.invoice_id as string | null) ?? null,
    repeat_every: (r.repeat_every as string | null) ?? null, visits: r.visits, lines: r.lines,
    billed_periods: r.billed_periods,
    fields: (r.fields && typeof r.fields === "object" ? r.fields : {}) as Record<string, string | number>,
  }));
  const monthStart = `${today.slice(0, 7)}-01`;
  // [WERK-4] "BoekBrug ziet wat jij vergeet": the hours on open work without a rate, the hours per
  // piece of work against the agreed ones, and the purchases of suppliers the owner attached to
  // work before that are attached to nothing now.
  const ids = open.map((r) => r.id);
  const hoursByWork = new Map<string, number>();
  let hoursWithoutRate = 0;
  if (ids.length > 0) {
    const { data: hourRows, error: hoursErr } = await db.from("time_entries").select("work_item_id, hours, hourly_rate, worked_on, billable")
      .eq("user_id", userId).is("invoice_id", null).in("work_item_id", ids.slice(0, 200)).limit(2000);
    if (!hoursErr) {
      // [CONTRACT] A contract's agreed hours are per period, so its hours count this month only;
      // one-off work counts every unbilled hour on it.
      const recurring = new Set(open.filter((r) => r.repeat_every).map((r) => r.id));
      for (const h of (hourRows ?? []) as Array<{ work_item_id: string; hours: number | null; hourly_rate: number | null; worked_on: string | null; billable?: boolean | null }>) {
        // [DECLARABEL] Own time carries no rate BY DESIGN. Counting it as "an hour that will fall
        // off the invoice" is a warning about work that must never be on one.
        if (h.billable === false) continue;
        if (h.hourly_rate === null) hoursWithoutRate += 1;
        if (recurring.has(h.work_item_id) && (h.worked_on ?? "") < monthStart) continue;
        hoursByWork.set(h.work_item_id, (hoursByWork.get(h.work_item_id) ?? 0) + Number(h.hours ?? 0));
      }
    }
  }
  let unlinkedCosts = { n: 0, amount: 0 };
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const { data: known, error: knownErr } = await db.from("invoices").select("client_name").eq("receiver_id", userId).eq("direction", "incoming")
    .not("work_item_id", "is", null).not("client_name", "is", null).limit(200);
  const suppliers = [...new Set(((known ?? []) as Array<{ client_name: string }>).map((k) => k.client_name))];
  if (!knownErr && suppliers.length > 0) {
    const { data: loose, error: looseErr } = await db.from("invoices").select("total_ex_btw").eq("receiver_id", userId).eq("direction", "incoming")
      .is("work_item_id", null).in("client_name", suppliers.slice(0, 100)).gte("invoice_date", sixtyDaysAgo).in("status", ["processing", "received", "paid"]).limit(200);
    if (!looseErr) {
      const list = (loose ?? []) as Array<{ total_ex_btw: number | null }>;
      unlinkedCosts = { n: list.length, amount: list.reduce((s, c) => s + Math.abs(Number(c.total_ex_btw ?? 0)), 0) };
    }
  }
  // [UREN-OUD] Hours worked, priced, on no invoice, older than a month — the dienstverlener's
  // largest leak, in euros. Read apart from the per-work hours above because most of these hours
  // hang on no work at all: a consultant writes them on the client, not on an opdracht.
  //
  // Prepaid hours are NOT in it: an hour on a strippenkaart is the delivery of an invoice that is
  // already paid, and calling it "still to be invoiced" would ask the owner to bill it twice.
  let oldUnbilledHours: { n: number; amount: number } | undefined;
  {
    const cutoff = isoMinusDays(today, UNBILLED_HOURS_DAYS);
    const bundleIds = new Set(open.filter((r) => bundleHours(r) !== null).map((r) => r.id));
    const { data: oldRows, error: oldErr } = await db.from("time_entries").select("hours, hourly_rate, work_item_id, billable")
      .eq("user_id", userId).is("invoice_id", null).not("hourly_rate", "is", null).lte("worked_on", cutoff).limit(2000);
    if (!oldErr) {
      let n = 0, amount = 0;
      for (const h of (oldRows ?? []) as Array<{ hours: number | null; hourly_rate: number | null; work_item_id: string | null; billable?: boolean | null }>) {
        if (h.billable === false) continue;
        if (h.work_item_id && bundleIds.has(h.work_item_id)) continue;
        const value = Number(h.hours ?? 0) * Number(h.hourly_rate ?? 0);
        if (!Number.isFinite(value) || value <= 0) continue;
        n += 1;
        amount += value;
      }
      oldUnbilledHours = { n, amount };
    }
  }

  return {
    pluralKey: skin.pluralKey,
    counts: workCounts(open, today),
    signals: workSignals({ rows: open.map((r) => ({ id: r.id, status: r.status, fields: r.fields, lines: storedLines(r.lines), repeat_every: r.repeat_every })), hoursWithoutRate, hoursByWork, unlinkedCosts, oldUnbilledHours, today }),
  };
}
