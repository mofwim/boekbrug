// src/app/api/turnover/day/route.ts
// [KASSA] One trading day, typed by hand. User-scoped via the RLS server client.
//
//   POST   { date, gross_0, gross_9, gross_21, pin, cash, other }  → book the day
//   DELETE ?date=YYYY-MM-DD                                        → remove a hand-typed day
//
// ── WHY THIS ROUTE EXISTS AT ALL ──
// daily_turnover.source has allowed 'manual' since the table was created, and until now nothing
// wrote it — every path passed 'z_report'. An owner without a till therefore had no way to put a
// rate split anywhere, and his PIN revenue arrives over the bank with no rate (bank_transactions
// has no btw_rate column). financial-result counts it as omzet-zonder-tarief, and /api/btw/file
// BLOCKS the filing on exactly that. This is the door that was designed and never hung.
//
// It is the sibling of /api/till/sale, not a competitor: that one totals a day from what was rung
// up, this one takes the total the owner already knows. Both write the SAME single row, and
// daySourceConflict keeps a day from being claimed by both.

import { NextRequest, NextResponse } from "next/server";
import { isMissingRelation } from "@/lib/pg-missing";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { validateManualDay, daySourceConflict, buildTurnoverRow, korTillRefusal } from "@/lib/till-day";
import { bookTurnoverRows } from "@/lib/turnover-book";
import { TILL_SOURCE } from "@/lib/till-book";
import { turnoverDateOutOfWindow, amsterdamToday } from "@/lib/turnover-import";
import { logAuditAction, getClientIP } from "@/lib/audit";
// [KAS-ZACHT] A removed cash movement is out of the books, so it must not claim a day either. One
// definition of "the movements that still count" — see cash-live.ts; every reader goes through it.
import { liveCashEntries } from "@/lib/cash-live";
import { requireOwner } from "@/lib/owner-only";

export const dynamic = "force-dynamic";

function resolveDate(raw: unknown): { date: string } | { error: string } {
  const today = amsterdamToday();
  const date = typeof raw === "string" && raw.trim() ? raw.trim() : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Ongeldige datum." };
  if (turnoverDateOutOfWindow(date, today)) {
    return { error: "Controleer de datum — een omzetdag ligt niet in de toekomst." };
  }
  return { date };
}

/** What else already claims this day — including the Kassa, which owns the same row. */
async function readDayClaims(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  date: string,
) {
  const cash = await liveCashEntries(supabase);
  const [{ data: turnoverRow, error: turnoverErr }, cashRes, tillRes] = await Promise.all([
    supabase.from("daily_turnover").select("source").eq("user_id", userId)
      .eq("turnover_date", date).maybeSingle(),
    // [KAS-ZACHT] Only the movements that still count — see the same note in /api/till/sale.
    cash.only(
      supabase.from("cash_entries").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("entry_date", date).eq("category", "omzet"),
    ),
    supabase.from("till_sales").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("sale_date", date),
  ]);
  return {
    hasImportedDay: Boolean(turnoverRow) && turnoverRow.source !== TILL_SOURCE,
    cashOmzetCount: cashRes.count ?? 0,
    // ── DEPLOY-SAFE, and this route is the half that must not wait ──
    // Code ships before a migration is applied by hand (the same reasoning as the column probe in
    // cash-live.ts). till_sales may therefore not exist yet — and this route is precisely the one an
    // owner needs on day one, because it is what unblocks an aangifte held shut by rate-less
    // revenue. A missing table means no Kassa has ever run, which means no sales can be claiming
    // this day, which is exactly what a count of zero says. The Kassa's own route makes no such
    // allowance: without the table it genuinely cannot work, and should say so rather than pretend.
    tillSaleCount: tillRes.error ? 0 : tillRes.count ?? 0,
    // [NO-SILENT-EMPTY] The two reads with no such allowance. A failed daily_turnover read gives a
    // null row and a failed cash count gives 0 — which are exactly the values that mean "nothing
    // claims this day", i.e. "no conflict". So a hiccup opened the guard, and what the guard
    // prevents is silent: the upsert on (user_id, turnover_date) switches the day's cash 'omzet'
    // entries off in every engine at once with nothing on any screen saying so.
    //
    // [KASSA-STIL] till_sales hoort hier WEL in, en de zin hierboven zei al waarom: "a missing
    // table is a known, reasoned zero; a failed read is not." Die twee stonden in het commentaar
    // uit elkaar en in de code op één hoop — `tillRes.error ? 0 : …` behandelt een ontbrekende
    // tabel en een time-out identiek, en alleen de eerste is een antwoord.
    //
    // Wat een verkeerde nul kost: daySourceConflict weigert een handmatig getypte dag zodra er
    // vandaag al op de Kassa is aangeslagen ("Je hebt vandaag al verkopen aangeslagen op de
    // Kassa"). Valt die telling stil op nul, dan komt die weigering niet, en de getypte dag wordt
    // over de aangeslagen dag heen geüpsert op (user_id, turnover_date). Een winkel die € 1.210
    // heeft aangeslagen en er € 500 bij typt, houdt € 500 over: € 586,78 omzet en € 123,22 BTW uit
    // rubriek 1a/1b weg, zonder dat enig scherm zegt dat er een getal is vervangen.
    //
    // De deploy-uitzondering blijft precies wat hij was: een ONTBREKENDE tabel telt nog steeds als
    // nul en houdt de route leesbaar, want dan heeft er nooit een Kassa gedraaid. till_sales
    // bestaat inmiddels in productie, dus dat venster is dicht en elke overgebleven fout is de
    // andere soort.
    readable: !turnoverErr && !cashRes.error && (!tillRes.error || isMissingRelation(tillRes.error.message)),
  };
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een dagomzet invoeren");
  if (guard.response) return guard.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 }); }

  const resolved = resolveDate(body.date);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  const day = validateManualDay(body);
  if (!day.ok) return NextResponse.json({ error: day.error }, { status: 400 });

  // [KOR-FACTUUR] A hand-typed day reaches rubriek 1a/1b exactly as directly as a rung-up one, so
  // it carries the same refusal. The rates are the buckets that actually hold money — a KOR owner
  // typing his whole day into the 0% box is doing precisely the right thing.
  const { data: profile } = await supabase
    .from("profiles").select("kor_active").eq("id", user.id).maybeSingle();
  const kor = korTillRefusal({
    korActive: Boolean(profile?.kor_active),
    rates: [day.gross.gross_9 > 0 ? 9 : 0, day.gross.gross_21 > 0 ? 21 : 0],
  });
  if (kor) return NextResponse.json({ error: kor }, { status: 400 });

  try {
    const claims = await readDayClaims(supabase, user.id, resolved.date);
    // [NO-SILENT-EMPTY] Refused rather than waved through — same reasoning as /api/till/sale, and
    // the same cost: one retry, against a day of turnover silently switched off.
    if (!claims.readable) {
      return NextResponse.json(
        { error: "We konden de omzet van deze dag niet controleren. Probeer het zo meteen opnieuw." },
        { status: 503 },
      );
    }
    const conflict = daySourceConflict(claims);
    if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });

    const row = buildTurnoverRow(resolved.date, day.gross);
    // The same gate the file path runs — daily_turnover feeds rubriek 1a/1b straight through, and a
    // server that trusts the client's arithmetic is not a guard. buildTurnoverRow derives btw as the
    // remainder precisely so an honest day always passes it (till-day.test.ts holds that line).
    const booked = await bookTurnoverRows(supabase, user.id, [row], TILL_SOURCE);
    if (!booked.ok) {
      return NextResponse.json(
        {
          error: booked.rejected.length
            ? `De bedragen van deze dag kunnen niet kloppen (${booked.rejected[0]}).`
            : "Kon de dagomzet niet opslaan.",
        },
        { status: booked.rejected.length ? 400 : 500 },
      );
    }

    await logAuditAction({
      userId: user.id,
      action: "turnover.day_entered",
      entityType: "turnover",
      entityId: user.id,
      newValue: { turnover_date: resolved.date, ...day.gross, total_incl: row.total_incl },
      ipAddress: getClientIP(req),
    });

    return NextResponse.json({ ok: true, date: resolved.date, total_incl: row.total_incl, row });
  } catch {
    return NextResponse.json({ error: "Kon de dagomzet niet opslaan." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een dagomzet verwijderen");
  if (guard.response) return guard.response;

  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Ongeldige datum." }, { status: 400 });
  }

  try {
    // Read before deleting: on a hard delete of a money row the audit trail is the only record it
    // existed, and this route may only remove what it wrote. A day that came from a Z-report is
    // removed on the import screen, where the file behind it is also shown.
    const { data: existing } = await supabase
      .from("daily_turnover")
      .select("turnover_date, total_incl, source, base_0, base_9, base_21, btw_9, btw_21, pin_amount, cash_amount, other_amount")
      .eq("user_id", user.id).eq("turnover_date", date).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Deze dag staat niet in je omzet." }, { status: 404 });
    if (existing.source !== TILL_SOURCE) {
      return NextResponse.json(
        { error: "Deze dag komt uit een ingelezen kassa-rapport — verwijder hem bij Dagomzet." },
        { status: 409 },
      );
    }

    // A day BUILT by the Kassa carries the same source as a hand-typed one, so source alone cannot
    // tell them apart — the sales behind it can. Deleting the row while its tickets remain would
    // leave those sales on the counter's screen, visible and counting toward nothing: no omzet, no
    // btw, no drawer. The tickets are the record here, so they are what gets voided.
    // Same deploy-safety as above: no table means no Kassa has ever run, so nothing can be
    // orphaned by removing this day.
    const { count: tillCount, error: tillError } = await supabase
      .from("till_sales").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("sale_date", date);
    if (!tillError && (tillCount ?? 0) > 0) {
      return NextResponse.json(
        { error: "Deze dag is op de Kassa aangeslagen. Draai daar de bonnen terug die eraf moeten — dan telt de dag vanzelf opnieuw." },
        { status: 409 },
      );
    }

    const { error } = await supabase
      .from("daily_turnover").delete()
      .eq("user_id", user.id).eq("turnover_date", date).eq("source", TILL_SOURCE);
    if (error) return NextResponse.json({ error: "Kon de dag niet verwijderen." }, { status: 500 });

    await logAuditAction({
      userId: user.id,
      action: "turnover.day_removed",
      entityType: "turnover",
      entityId: user.id,
      oldValue: existing,
      newValue: { via: "handmatige_dag" },
      ipAddress: getClientIP(req),
    });

    return NextResponse.json({ ok: true, date });
  } catch {
    return NextResponse.json({ error: "Kon de dag niet verwijderen." }, { status: 500 });
  }
}
