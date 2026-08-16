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
// [REGEL-KOPIE] One definition of "the content of an invoice line" — see invoice-line-copy.ts.
import { copiedLinesFor } from "@/lib/invoice-line-copy";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { createNotification } from "@/lib/notifications";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { planOccurrence, termDaysOf, addDays, CADENCE_LABEL, type Cadence } from "@/lib/recurring";
// [TZ] One definition of "today in Amsterdam", shared with the screens — a cron and a form that
// disagree about the date would put an invoice and its concept in different quarters.
import { amsterdamToday } from "@/lib/format-nl";
// [CRON-HARTSLAG] Vastleggen DAT deze cron draaide — zie src/lib/cron-heartbeat.ts.
import { beginCronRun, finishCronRun } from "@/lib/cron-heartbeat";
// [KLANT-EXTRA] De vrije klantregels onder de klantnaam — zie de kop van dat bestand.
import { CLIENT_EXTRA_LINE_COLUMNS } from "@/lib/client-extra-lines";
import { copyExtraLinesOnto } from "@/lib/client-extra-lines-write";

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
  // De startregel wordt pas geopend NA de auth-poort hieronder — zie daar.
  let cronRunId: string | null = null;
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret) {
    console.error("[CRON-RECURRING] CRON_SECRET is not configured — recurring invoices are DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // [CRON-HARTSLAG] Pas NA de poort: een onbevoegde probe hoort geen regel te schrijven.
  cronRunId = await beginCronRun(createPipelineClient(), "recurring", cronStartedAt);

  // [CRON-HARTSLAG-EIND] Zie de uitleg in api/cron/reminders. Twee vroege uitgangen, en ze horen
  // NIET hetzelfde te melden: "de tabel bestaat nog niet" is een geslaagde no-op die zichzelf al zo
  // noemt, een mislukte lookup is een storing. Vóór dit sloten ze allebei niets af en waren ze van
  // buiten identiek — allebei een regel op ok = NULL.
  const klaar = async (body: Record<string, unknown>, ok: boolean, status?: number) => {
    await finishCronRun(createPipelineClient(), cronRunId, { ok, result: body });
    return NextResponse.json(body, status ? { status } : undefined);
  };

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
      return klaar({ ok: true, available: false, generated: 0 }, true);
    }
    return klaar({ ok: false, error: "lookup_failed", detail: dueErr.message }, false, 500);
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
        .select("id, sender_id, client_id, client_name, client_email, client_address, client_postal_code, client_city, client_btw_number, invoice_date, due_date, discount_type, discount_value, total_ex_btw, btw_amount, total_inc_btw")
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
          // [KORTING-KOPIE] De korting reist mee met de bedragen. Deze route kopieert de TOTALEN van
          // het origineel maar bouwt de REGELS opnieuw op — en zonder de korting spraken die twee
          // elkaar tegen: de kop droeg het verlaagde bedrag, de regels het volle. Elke afgeleide
          // (de PDF en de UBL-export rekenen uit de regels) drukte dan een ander bedrag dan er in de
          // boeken staat. Gemeten op een factuur van EUR 1.000 met 10%: EUR 121 verschil.
          discount_type: src.discount_type ?? null,
          discount_value: src.discount_value ?? null,
        })
        .select("id")
        .single();
      // [KLANT-EXTRA] De drie vrije klantregels reizen mee naar de nieuwe factuur.
      //
      // In een EIGEN leesbeurt en een EIGEN schrijfbeurt, allebei mislukbaar. De hoofdselect van
      // deze cron noemt zijn kolommen expliciet; er twee aan toevoegen die een database nog niet
      // kent laat PostgREST die select weigeren — en dan draait er voor NIEMAND meer een
      // terugkerende factuur. Een adresregel mag dat niet kunnen veroorzaken.
      //
      // Waarom het er hoort: een terugkerende factuur gaat naar dezelfde klant, elke maand, en
      // juist daar is "t.a.v. mevrouw Jansen" of een inkoopordernummer geen sier maar de reden
      // dat hij betaald wordt. Hem stil laten vallen bij elke herhaling is het soort verlies dat
      // niemand aan de app toeschrijft.
      if (!insErr && draft) {
        const { data: bron } = await db
          .from("invoices")
          .select(CLIENT_EXTRA_LINE_COLUMNS.join(", "))
          .eq("id", s.source_invoice_id)
          .maybeSingle();
        if (bron) {
          await copyExtraLinesOnto(
            (fields) => db.from("invoices").update(fields as never).eq("id", draft.id),
            bron as Record<string, unknown>,
            { schedule: s.id, from: s.source_invoice_id, to: draft.id },
          );
        }
      }

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
      //
      // [LINES-READ-HONEST] The error is read, and a failed read rolls the draft back — the same
      // treatment the INSERT failure already got, for the same reason the comment above gives.
      // supabase-js does not throw, so `const { data: lines }` answered a database problem with
      // null, `lines && lines.length > 0` was false, and the code walked straight past the copy
      // into the schedule update: next_run_date advanced, runs_count incremented, "Terugkerende
      // factuur staat klaar" sent to the owner — over precisely the half-copy the comment says is
      // worse than none. And because the schedule had moved on, nothing retried it until the next
      // cadence, so the owner's bill for this month simply had no lines on it.
      const { data: lines, error: linesErr } = await pipeline
        .from("invoice_lines")
        // [UNIT] '*' zodat de eenheid meekomt; de INSERT typt hieronder expliciet over.
        .select("*")
        .eq("invoice_id", s.source_invoice_id);
      if (linesErr) {
        await pipeline.from("invoices").delete().eq("id", draft.id as string);
        failed += 1;
        console.error("[CRON-RECURRING] line read failed — draft rolled back", { schedule: s.id, error: linesErr.message });
        continue;
      }
      if (lines && lines.length > 0) {
        // [REGEL-KOPIE] Same module as /duplicate and the creditnota mirror. This list was typed
        // by hand, and [REGEL-KORTING] never reached it: a recurring invoice with a line discount
        // kept its discounted line_total beside an undiscounted price, and the first save put the
        // full amount back — € 121,00 where the schedule was set up to bill € 108,90, every month,
        // on a document nobody re-reads. See invoice-line-copy.ts.
        const { error: lineErr } = await pipeline.from("invoice_lines").insert(
          copiedLinesFor(lines as never, draft.id as string) as never,
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
      await createNotification({
        userId: s.user_id,
        title: "Terugkerende factuur staat klaar",
        body: `Het concept voor ${src.client_name ?? "je klant"} (${CADENCE_LABEL[s.cadence]}) staat klaar. Controleer en verstuur wanneer je wilt.`,
        type: "invoice",
        link: `/dashboard/invoice/${draft.id}`,
      });
    } catch (e) {
      failed += 1;
      console.error("[CRON-RECURRING] schedule threw (non-fatal)", { schedule: s.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // [CRON-HARTSLAG] De uitkomst vastleggen. Best effort: dit mag de cron nooit laten vallen.
  await finishCronRun(createPipelineClient(), cronRunId, { ok: failed === 0, result: { ok: failed === 0, available: true, due: schedules.length, generated, skipped, finished, failed } });

  return NextResponse.json({ ok: true, available: true, due: schedules.length, generated, skipped, finished, failed });
}
