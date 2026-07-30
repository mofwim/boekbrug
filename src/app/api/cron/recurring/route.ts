// src/app/api/cron/recurring/route.ts
// [HERHAAL] The heartbeat that turns a schedule into a ready-to-send CONCEPT.
//
// For every active schedule whose date has come, it copies the invoice being repeated — client
// details, every line, the payment term — into a fresh draft dated on that occurrence, and tells
// the owner it is ready. The owner sends it with one tap, which is where the invoice number is
// minted (art. 35, forward-only) and where a document first goes to a third party. The app does
// the typing; the human does the act.
//
// SECURITY: iterates across users → never publicly callable. Bearer CRON_SECRET, constant-time
// compare, fail-closed — the identical guard the reminders and reconcile crons use.
//
// TRUTH discipline:
//   · it writes NOTHING that counts as money: a 'draft' is excluded from omzet, BTW, debiteuren,
//     the accountant's workspace and every export, by the same allow-lists as everywhere else;
//   · no invoice NUMBER is ever minted here;
//   · one occurrence per schedule per run — a cron that was down for months heals a day at a
//     time instead of billing a customer six times in one morning (see planOccurrence);
//   · the (schedule_id, invoice_date) unique index makes a double run physically unable to bill
//     the same period twice, and the pre-check makes it quiet rather than noisy;
//   · best-effort per schedule: one failure never stops the rest.

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { planOccurrence, termDaysOf, addDays, CADENCE_LABEL, type Cadence } from "@/lib/recurring";
// [TZ] One definition of "today in Amsterdam", shared with the screens — a cron and a form that
// disagree about the date would put an invoice and its concept in different quarters.
import { amsterdamToday } from "@/lib/format-nl";
// [CRON-HARTSLAG] Vastleggen DAT deze cron draaide — zie src/lib/cron-heartbeat.ts.
import { recordCronRun } from "@/lib/cron-heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ScheduleRow = {
  id: string;
  user_id: string;
  source_invoice_id: string;
  cadence: Cadence;
  anchor_day: number;
  next_run_date: string;
  ends_on: string | null;
  active: boolean;
  runs_count: number | null;
};

export async function GET(req: NextRequest) {
  // [CRON-HARTSLAG] Het startmoment, zodat een afgebroken run herkenbaar blijft.
  const cronStartedAt = new Date().toISOString();
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret) {
    console.error("[CRON-RECURRING] CRON_SECRET is not configured — recurring invoices are DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();
  const today = amsterdamToday();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = pipeline as any;
  const { data: dueRows, error: dueErr } = await db
    .from("invoice_schedules")
    .select("id, user_id, source_invoice_id, cadence, anchor_day, next_run_date, ends_on, active, runs_count")
    .eq("active", true)
    .lte("next_run_date", today)
    .order("next_run_date", { ascending: true })
    .limit(500);

  if (dueErr) {
    // [DEPLOY-SAFE] The table arrives with invoice_schedules.sql. Until then this cron is a no-op
    // that says so, instead of a red run every night.
    const msg = (dueErr.message ?? "").toLowerCase();
    if (msg.includes("does not exist") || msg.includes("schema cache") || dueErr.code === "42P01") {
      return NextResponse.json({ ok: true, available: false, generated: 0 });
    }
    return NextResponse.json({ error: "lookup_failed", detail: dueErr.message }, { status: 500 });
  }

  const schedules = (dueRows ?? []) as ScheduleRow[];
  let generated = 0;
  let skipped = 0;
  let finished = 0;
  let failed = 0;

  for (const s of schedules) {
    const action = planOccurrence(
      { next_run_date: s.next_run_date, cadence: s.cadence, anchor_day: s.anchor_day, active: s.active, ends_on: s.ends_on },
      today,
    );

    if (action.kind === "wait") continue;

    if (action.kind === "done") {
      // Past its end date: switch it off rather than leave it due forever.
      await db.from("invoice_schedules").update({ active: false, updated_at: new Date().toISOString() }).eq("id", s.id);
      finished += 1;
      continue;
    }

    if (action.kind === "skip") {
      await db.from("invoice_schedules")
        .update({ next_run_date: action.nextRunDate, updated_at: new Date().toISOString() })
        .eq("id", s.id);
      skipped += 1;
      continue;
    }

    try {
      // Already produced for this date? The unique index guarantees it cannot happen twice; this
      // check makes a retry silent instead of an error.
      const { data: existing } = await db
        .from("invoices")
        .select("id")
        .eq("schedule_id", s.id)
        .eq("invoice_date", action.date)
        .limit(1);
      if (existing && existing.length > 0) {
        await db.from("invoice_schedules")
          .update({ next_run_date: action.nextRunDate, updated_at: new Date().toISOString() })
          .eq("id", s.id);
        continue;
      }

      const { data: src, error: srcErr } = await pipeline
        .from("invoices")
        .select("id, sender_id, client_id, client_name, client_email, client_address, client_postal_code, client_city, client_btw_number, invoice_date, due_date, total_ex_btw, btw_amount, total_inc_btw")
        .eq("id", s.source_invoice_id)
        .maybeSingle();
      if (srcErr || !src) { failed += 1; continue; }

      const termDays = termDaysOf(src.invoice_date, src.due_date);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: draft, error: insErr } = await (pipeline as any)
        .from("invoices")
        .insert({
          sender_id: s.user_id,
          // [FACTUUR-A] Never a number here — it is minted on send, and only there.
          invoice_number: null,
          status: "draft",
          invoice_type: "factuur",
          direction: "outgoing",
          source: "created",
          schedule_id: s.id,
          invoice_date: action.date,
          delivery_date: action.date,
          due_date: addDays(action.date, termDays),
          client_id: src.client_id,
          client_name: src.client_name,
          client_email: src.client_email,
          client_address: src.client_address,
          client_postal_code: src.client_postal_code,
          client_city: src.client_city,
          client_btw_number: src.client_btw_number,
          total_ex_btw: src.total_ex_btw,
          btw_amount: src.btw_amount,
          total_inc_btw: src.total_inc_btw,
        })
        .select("id")
        .single();
      if (insErr || !draft) {
        // The unique index caught a concurrent run — benign, and the schedule still advances.
        if (insErr && /duplicate key|unique/i.test(insErr.message ?? "")) {
          await db.from("invoice_schedules")
            .update({ next_run_date: action.nextRunDate, updated_at: new Date().toISOString() })
            .eq("id", s.id);
          continue;
        }
        failed += 1;
        console.error("[CRON-RECURRING] draft insert failed", { schedule: s.id, error: insErr?.message });
        continue;
      }

      // The lines are what is actually billed. A concept without them would be a €0 invoice with
      // the right totals in the header — the kind of half-copy that is worse than none, so a
      // failure here removes the draft again rather than leaving it behind.
      const { data: lines } = await pipeline
        .from("invoice_lines")
        .select("description, quantity, unit_price, btw_rate, line_total")
        .eq("invoice_id", s.source_invoice_id);
      if (lines && lines.length > 0) {
        const { error: lineErr } = await pipeline.from("invoice_lines").insert(
          lines.map((l) => ({
            invoice_id: draft.id as string,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            btw_rate: l.btw_rate,
            line_total: l.line_total,
          })),
        );
        if (lineErr) {
          await pipeline.from("invoices").delete().eq("id", draft.id as string);
          failed += 1;
          console.error("[CRON-RECURRING] line copy failed — draft rolled back", { schedule: s.id, error: lineErr.message });
          continue;
        }
      }

      await db.from("invoice_schedules").update({
        next_run_date: action.nextRunDate,
        last_run_at: new Date().toISOString(),
        last_invoice_id: draft.id,
        runs_count: (s.runs_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", s.id);
      generated += 1;

      // The whole point is that the owner finds it waiting, so say so — with the customer's name,
      // which is how they recognise it, and a link straight to the concept.
      try {
        await pipeline.from("notifications").insert({
          user_id: s.user_id,
          title: "Terugkerende factuur staat klaar",
          body: `Het concept voor ${src.client_name ?? "je klant"} (${CADENCE_LABEL[s.cadence]}) staat klaar. Controleer en verstuur wanneer je wilt.`,
          type: "invoice",
          read: false,
          link: `/dashboard/invoice/${draft.id}`,
        });
      } catch {
        /* the concept exists; the bell is a courtesy */
      }
    } catch (e) {
      failed += 1;
      console.error("[CRON-RECURRING] schedule threw (non-fatal)", { schedule: s.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // [CRON-HARTSLAG] De uitkomst vastleggen. Best effort: dit mag de cron nooit laten vallen.
  await recordCronRun(createPipelineClient(), "recurring", { startedAt: cronStartedAt, ok: true, result: { ok: true, available: true, due: schedules.length, generated, skipped, finished, failed } });

  return NextResponse.json({ ok: true, available: true, due: schedules.length, generated, skipped, finished, failed });
}
