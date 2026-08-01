// src/app/api/invoice/schedules/route.ts
// [HERHAAL] Terugkerende facturen — the owner's side: start a repeat, see them, pause, stop.
//
//   GET    → this owner's schedules (+ the invoice each one repeats)
//   POST   → start repeating an invoice   { invoiceId, cadence, endsOn? }
//   PATCH  → pause / resume / change end  { id, active?, endsOn? }
//   DELETE → stop repeating               ?id=…
//
// Nothing here mints an invoice number, sends anything, or touches money. A schedule is an
// intention; /api/cron/recurring turns it into CONCEPTS, and only the owner turns a concept into
// a sent invoice. See lib/recurring.ts for why that line sits exactly there.
//
// [DEPLOY-SAFE] The table arrives with invoice_schedules.sql. Until it is applied every verb
// answers a clean, honest "not available yet" instead of a 500 — code ships before migrations,
// and a feature that is merely absent is fine; one that throws is not.

import { NextRequest, NextResponse } from "next/server";
import { amsterdamToday } from "@/lib/format-nl";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { anchorDayOf, firstRunAfter, isCadence, type Cadence } from "@/lib/recurring";
import { requireOwner } from '@/lib/owner-only'

export const dynamic = "force-dynamic";

const NOT_READY = { error: "schedules_unavailable", detail: "Terugkerende facturen zijn nog niet ingeschakeld." };

/** A missing table/column reads as a PostgREST schema error, never as a row-level failure. */
function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" || // undefined_table
    error.code === "PGRST205" || // unknown relation in the schema cache
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

// ── GET ───────────────────────────────────────────────────────────────────────────────────────

export async function GET() {
  // [ACTING-FOR] Alleen de eigenaar — zie src/lib/owner-only.ts. Een medewerker hier
  // doorlaten zou een tweede nummerreeks onder hetzelfde BTW-nummer openen.
  { const w = await requireOwner('Terugkerende facturen instellen'); if (w.response) return w.response }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("invoice_schedules")
    .select("id, source_invoice_id, cadence, anchor_day, next_run_date, ends_on, active, last_run_at, runs_count")
    .eq("user_id", user.id)
    .order("next_run_date", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ ok: true, schedules: [], available: false });
    return NextResponse.json({ error: "lookup_failed", detail: error.message }, { status: 500 });
  }

  // The invoice each schedule repeats — the owner recognises a schedule by its customer, not by
  // a uuid. One extra read, scoped to the schedules that exist.
  const ids = (data ?? []).map((s: { source_invoice_id: string }) => s.source_invoice_id).filter(Boolean);
  const byId = new Map<string, { invoice_number: string | null; client_name: string | null; total_inc_btw: number | null }>();
  if (ids.length > 0) {
    const { data: invs } = await supabase
      .from("invoices")
      .select("id, invoice_number, client_name, total_inc_btw")
      .in("id", ids);
    for (const i of invs ?? []) byId.set(i.id, i);
  }

  return NextResponse.json({
    ok: true,
    available: true,
    schedules: (data ?? []).map((s: { id: string; source_invoice_id: string }) => ({
      ...s,
      source: byId.get(s.source_invoice_id) ?? null,
    })),
  });
}

// ── POST — start repeating an invoice ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // [ACTING-FOR] Alleen de eigenaar — zie src/lib/owner-only.ts. Een medewerker hier
  // doorlaten zou een tweede nummerreeks onder hetzelfde BTW-nummer openen.
  { const w = await requireOwner('Terugkerende facturen instellen'); if (w.response) return w.response }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { invoiceId?: string; cadence?: string; endsOn?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const invoiceId = body.invoiceId;
  const cadence = body.cadence;
  if (!invoiceId || !isCadence(cadence)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const endsOn = typeof body.endsOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.endsOn) ? body.endsOn : null;

  // The source must be the owner's own OUTGOING factuur. A creditnota, an offerte or a purchase
  // invoice is not something you bill again every month — repeating one would be a mistake the
  // app helped make.
  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select("id, sender_id, direction, invoice_type, status, invoice_date, client_name")
    .eq("id", invoiceId)
    .eq("sender_id", user.id)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: "invoice_lookup_failed", detail: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  if ((inv.direction ?? "outgoing") !== "outgoing" || (inv.invoice_type ?? "factuur") !== "factuur") {
    return NextResponse.json(
      { error: "not_repeatable", detail: "Alleen een gewone verkoopfactuur kan herhaald worden." },
      { status: 409 },
    );
  }
  // A concept has never been sent, so there is nothing yet to repeat — and its own send would
  // start the series anyway.
  if ((inv.status ?? "") === "draft") {
    return NextResponse.json(
      { error: "not_sent_yet", detail: "Verstuur deze factuur eerst; daarna kun je hem laten herhalen." },
      { status: 409 },
    );
  }

  const sourceDate = (inv.invoice_date as string | null) ?? amsterdamToday();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: created, error } = await db
    .from("invoice_schedules")
    .insert({
      user_id: user.id,
      source_invoice_id: invoiceId,
      cadence: cadence as Cadence,
      anchor_day: anchorDayOf(sourceDate),
      // The first repeat is the next occurrence AFTER the invoice being repeated — that one is
      // already sent, and billing it again on day one is exactly the surprise to avoid.
      next_run_date: firstRunAfter(sourceDate, cadence),
      ends_on: endsOn,
      active: true,
    })
    .select("id, cadence, next_run_date, ends_on, active")
    .single();

  if (error) {
    if (isMissingTable(error)) return NextResponse.json(NOT_READY, { status: 503 });
    // The one-per-source unique index: this invoice is already being repeated.
    if (/duplicate key|unique/i.test(error.message ?? "")) {
      return NextResponse.json(
        { error: "already_scheduled", detail: "Deze factuur wordt al herhaald." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "create_failed", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, schedule: created });
}

// ── PATCH — pause / resume / change the end date ───────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  // [ACTING-FOR] Alleen de eigenaar — zie src/lib/owner-only.ts. Een medewerker hier
  // doorlaten zou een tweede nummerreeks onder hetzelfde BTW-nummer openen.
  { const w = await requireOwner('Terugkerende facturen instellen'); if (w.response) return w.response }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { id?: string; active?: boolean; endsOn?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.active === "boolean") patch.active = body.active;
  if (body.endsOn === null || (typeof body.endsOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.endsOn))) {
    patch.ends_on = body.endsOn;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("invoice_schedules")
    .update(patch)
    .eq("id", body.id)
    .eq("user_id", user.id)
    .select("id, active, ends_on");
  if (error) {
    if (isMissingTable(error)) return NextResponse.json(NOT_READY, { status: 503 });
    return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, schedule: data[0] });
}

// ── DELETE — stop repeating ───────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  // [ACTING-FOR] Alleen de eigenaar — zie src/lib/owner-only.ts. Een medewerker hier
  // doorlaten zou een tweede nummerreeks onder hetzelfde BTW-nummer openen.
  { const w = await requireOwner('Terugkerende facturen instellen'); if (w.response) return w.response }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  // Only the schedule goes. Every concept it already produced is an ordinary invoice and stays —
  // the FK is ON DELETE SET NULL precisely so stopping a repeat can never remove invoices.
  const { error } = await db.from("invoice_schedules").delete().eq("id", id).eq("user_id", user.id);
  if (error) {
    if (isMissingTable(error)) return NextResponse.json(NOT_READY, { status: 503 });
    return NextResponse.json({ error: "delete_failed", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
