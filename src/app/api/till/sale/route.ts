// src/app/api/till/sale/route.ts
// [KASSA] The counter of a shop that has no till. User-scoped via the RLS server client.
//
//   GET    ?date=YYYY-MM-DD  → that day's sales (newest first) + the day's totals
//   POST                     → ring up one ticket (one customer, one or more lines)
//   DELETE ?ticket=<uuid>    → void one whole ticket
//
// Every one of the three ends in rebuildTillDay, which rewrites the day's single daily_turnover row
// from the sales that remain. That row is the ONLY thing the financial engines see — see the header
// of supabase/migrations/till_sales.sql for why this table must never become a second money source.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { validateTicket, daySourceConflict, sumSales, saleGross, korTillRefusal } from "@/lib/till-day";
// [CENT] Rounding to cents is defined in exactly one place — see the gate of that name in
// lifecycle-gates.test.ts for the five copies that disagreed before it existed.
import { round2 } from "@/lib/invoice-totals";
import { rebuildTillDay, readDaySales, TILL_SOURCE } from "@/lib/till-book";
// [PAY-DATE-SANE] The same window the Z-report path uses for an omzetdag — a takings day is not in
// the future and not before the app's floor. amsterdamToday, never a UTC clock: a sale rung up at
// 23:30 local belongs to that evening, and UTC would move it (and its btw) to the next day.
import { turnoverDateOutOfWindow, amsterdamToday } from "@/lib/turnover-import";
import { logAuditAction, getClientIP } from "@/lib/audit";
// [KAS-ZACHT] A removed cash movement is out of the books, so it must not claim a day either. One
// definition of "the movements that still count" — see cash-live.ts; every reader goes through it.
import { liveCashEntries } from "@/lib/cash-live";
// [ACTING-FOR] Ringing up revenue is the owner's own act. An employee who invoices on the owner's
// behalf does not get to write the day's takings — that figure goes straight to rubriek 1a/1b.
import { requireOwner } from "@/lib/owner-only";

// [KAS-SALDO] Never a cached day. Same declaration every sibling money route carries.
export const dynamic = "force-dynamic";

/** The day a request is talking about: an explicit ?date=, else the owner's Amsterdam today. */
function resolveDate(raw: string | null): { date: string } | { error: string } {
  const today = amsterdamToday();
  const date = raw && raw.trim() ? raw.trim() : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Ongeldige datum." };
  if (turnoverDateOutOfWindow(date, today)) {
    return { error: "Controleer de datum — een omzetdag ligt niet in de toekomst." };
  }
  return { date };
}

/** What the screen shows above the ticket: the day's takings, split the two ways it is read. */
function dayTotals(sales: Awaited<ReturnType<typeof readDaySales>>) {
  const g = sumSales(sales);
  return {
    total: round2(g.gross_0 + g.gross_9 + g.gross_21),
    pin: g.pin, cash: g.cash, other: g.other,
    gross_0: g.gross_0, gross_9: g.gross_9, gross_21: g.gross_21,
  };
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const resolved = resolveDate(req.nextUrl.searchParams.get("date"));
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  try {
    const sales = await readDaySales(supabase, user.id, resolved.date);
    // [KOR-FACTUUR] The screen offers 0% and nothing else when the scheme is on — the same way the
    // invoice screen does. Preventing the mistake beats reporting it, and the write below refuses
    // anyway for the draft-made-before-the-switch case the screen cannot see.
    const korActive = await readKorActive(supabase, user.id);
    // The screen needs to know BEFORE the owner taps anything whether this day is already claimed —
    // a conflict discovered only on the first sale is a counter that refuses a customer.
    const claims = await readDayClaims(supabase, user.id, resolved.date);
    return NextResponse.json({
      ok: true,
      date: resolved.date,
      sales,
      totals: dayTotals(sales),
      conflict: daySourceConflict(claims),
      korActive,
    });
  } catch {
    return NextResponse.json({ error: "Kon de verkopen van vandaag niet laden." }, { status: 500 });
  }
}

/**
 * Is the owner in the kleineondernemersregeling? Read fail-OPEN (false on an error), and that is the
 * safe direction here rather than the reckless one: false is what every owner who is not in the
 * scheme gets, so a failed read leaves the counter behaving exactly as it does for the large
 * majority. Failing closed would refuse every sale in the shop over a profile hiccup.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readKorActive(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("profiles").select("kor_active").eq("id", userId).maybeSingle();
  return Boolean(data?.kor_active);
}

/** What else already claims this day's revenue — the inputs to daySourceConflict. */
async function readDayClaims(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  date: string,
): Promise<{ hasImportedDay: boolean; cashOmzetCount: number; hasTypedDay: boolean; readable: boolean }> {
  const cash = await liveCashEntries(supabase);
  const [{ data: turnoverRow, error: turnoverErr }, { count, error: cashErr }, tillRes] = await Promise.all([
    supabase.from("daily_turnover").select("source").eq("user_id", userId)
      .eq("turnover_date", date).maybeSingle(),
    // [KAS-ZACHT] Only the movements that still count. A cash sale the owner has REMOVED must not
    // go on blocking his counter — that would be a day he can record in no way at all, refused on
    // the strength of a line that is out of the books everywhere else.
    cash.only(
      supabase.from("cash_entries").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("entry_date", date).eq("category", "omzet"),
    ),
    supabase.from("till_sales").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("sale_date", date),
  ]);
  return {
    hasImportedDay: Boolean(turnoverRow) && turnoverRow.source !== TILL_SOURCE,
    cashOmzetCount: count ?? 0,
    // A manual row with NO sales behind it was typed by hand on the Dagomzet screen. With sales
    // behind it, it is simply this counter's own day — which is not a conflict, it is the point.
    hasTypedDay:
      Boolean(turnoverRow) && turnoverRow.source === TILL_SOURCE && (tillRes.count ?? 0) === 0,
    // [NO-SILENT-EMPTY] Every one of these three answers a failed read with the SAME value it uses
    // for "nothing is there" — null row, count 0 — and all three of those mean "no conflict". So a
    // hiccup on any of them opened the guard, and the guard is the whole point of this function:
    // what it prevents is silent. supabase-js does not throw, so nothing else would have noticed.
    readable: !turnoverErr && !cashErr && !tillRes.error,
  };
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een verkoop aanslaan");
  if (guard.response) return guard.response;

  let body: { date?: string; lines?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 }); }

  const resolved = resolveDate(typeof body.date === "string" ? body.date : null);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 400 });

  const ticket = validateTicket(body.lines);
  if (!ticket.ok) return NextResponse.json({ error: ticket.error }, { status: 400 });

  // [KOR-FACTUUR] Enforced at the write as well as on the screen, for the case the screen cannot
  // see: a counter left open in a browser tab from before the owner switched the scheme on. It
  // REFUSES rather than correcting — silently changing what was just rung up for a customer who has
  // already paid is not a fix. See korTillRefusal for what the btw would cost under art. 37.
  const kor = korTillRefusal({
    korActive: await readKorActive(supabase, user.id),
    rates: ticket.lines.map((l) => l.btw_rate),
  });
  if (kor) return NextResponse.json({ error: kor }, { status: 400 });

  try {
    // ── ONE DAY, ONE SOURCE ──
    // Checked BEFORE the insert, because the damage this prevents is silent: writing a turnover day
    // on top of existing cash 'omzet' entries does not corrupt anything, it switches those entries
    // off in every engine at once, with nothing on any screen saying so. See daySourceConflict.
    const claims = await readDayClaims(supabase, user.id, resolved.date);
    // [NO-SILENT-EMPTY] Refused, not waved through. Booking a turnover day on top of existing cash
    // 'omzet' entries switches those entries off in every engine at once and says so nowhere; a
    // guard that cannot see is not permission to do it. Failing closed costs the shop one retry.
    if (!claims.readable) {
      return NextResponse.json(
        { error: "We konden de omzet van deze dag niet controleren. Probeer het zo meteen opnieuw." },
        { status: 503 },
      );
    }
    const conflict = daySourceConflict(claims);
    if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });

    // One ticket = one customer at the counter. The shared id is what lets a mistake be voided as
    // the whole transaction it was.
    const ticketId = randomUUID();
    const { error: insertError } = await supabase.from("till_sales").insert(
      ticket.lines.map((l) => ({
        user_id: user.id,
        sale_date: resolved.date,
        ticket_id: ticketId,
        description: l.description,
        quantity: l.quantity,
        unit_price_incl: l.unit_price_incl,
        btw_rate: l.btw_rate,
        method: l.method,
        article_id: l.article_id,
      })),
    );
    if (insertError) return NextResponse.json({ error: "Kon de verkoop niet opslaan." }, { status: 500 });

    const rebuilt = await rebuildTillDay(supabase, user.id, resolved.date);
    if (!rebuilt.ok) {
      // The day could not be booked, so the lines that caused it must not stay behind: leaving them
      // would show the owner a ticket on his screen that reaches no total anywhere, and the next
      // rebuild would fail on the same rows forever.
      await supabase.from("till_sales").delete().eq("user_id", user.id).eq("ticket_id", ticketId);
      return NextResponse.json({ error: rebuilt.error ?? "Kon de dag niet bijwerken." }, { status: 500 });
    }

    // [KASSA] The only trail. No Z-report, no bank line, no document behind this money.
    await logAuditAction({
      userId: user.id,
      action: "till.ticket_rung",
      entityType: "till_ticket",
      entityId: ticketId,
      newValue: {
        sale_date: resolved.date,
        lines: ticket.lines.map((l) => ({
          description: l.description, quantity: l.quantity,
          unit_price_incl: l.unit_price_incl, btw_rate: l.btw_rate, method: l.method,
          gross: saleGross(l),
        })),
        day_total_incl: rebuilt.total_incl,
      },
      ipAddress: getClientIP(req),
    });

    return NextResponse.json({
      ok: true,
      ticket_id: ticketId,
      date: resolved.date,
      sales: rebuilt.sales,
      totals: dayTotals(rebuilt.sales),
    });
  } catch {
    return NextResponse.json({ error: "Kon de verkoop niet opslaan." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een verkoop terugdraaien");
  if (guard.response) return guard.response;

  const ticketId = req.nextUrl.searchParams.get("ticket");
  if (!ticketId) return NextResponse.json({ error: "Geen bon opgegeven." }, { status: 400 });

  try {
    // Read the lines BEFORE deleting them: on a hard delete the audit trail is the only record that
    // this money was ever rung up, and "there was a ticket" without what was on it answers nothing.
    // The read is also what tells us WHICH day to rebuild — never trust a date from the query string
    // for that, or a caller could rebuild a day the ticket does not belong to.
    const { data: existing, error: readError } = await supabase
      .from("till_sales")
      .select("id, sale_date, description, quantity, unit_price_incl, btw_rate, method")
      .eq("user_id", user.id)
      .eq("ticket_id", ticketId);
    if (readError) return NextResponse.json({ error: "Kon de bon niet terugdraaien." }, { status: 500 });
    if (!existing || existing.length === 0) {
      return NextResponse.json({ error: "Deze bon bestaat niet (meer)." }, { status: 404 });
    }
    const date = existing[0].sale_date as string;

    const { error: deleteError } = await supabase
      .from("till_sales").delete().eq("user_id", user.id).eq("ticket_id", ticketId);
    if (deleteError) return NextResponse.json({ error: "Kon de bon niet terugdraaien." }, { status: 500 });

    const rebuilt = await rebuildTillDay(supabase, user.id, date);
    if (!rebuilt.ok) {
      return NextResponse.json({ error: rebuilt.error ?? "Kon de dag niet bijwerken." }, { status: 500 });
    }

    await logAuditAction({
      userId: user.id,
      action: "till.ticket_voided",
      entityType: "till_ticket",
      entityId: ticketId,
      oldValue: { sale_date: date, lines: existing },
      newValue: { day_total_incl: rebuilt.total_incl },
      ipAddress: getClientIP(req),
    });

    return NextResponse.json({
      ok: true, date, sales: rebuilt.sales, totals: dayTotals(rebuilt.sales),
    });
  } catch {
    return NextResponse.json({ error: "Kon de bon niet terugdraaien." }, { status: 500 });
  }
}
