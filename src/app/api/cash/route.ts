// src/app/api/cash/route.ts
// [CASH-LEDGER] The cash book (kasadministratie). User-scoped via the RLS server client.
//
// GET    → all cash entries (newest first) + the running kas balance.
// POST   → add one entry (a cash sale, a cash expense, a deposit/withdrawal, …).
// DELETE → remove one entry (?id=).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { computeCashBalance, isCashCategory } from "@/lib/cash";
import { reconcileCashSettlements } from "@/lib/cash-settle";
import { fetchAllRows } from "@/lib/supabase-paginate";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // [CASH-SETTLE] Before reading, make the kasboek reflect every invoice paid in cash — no
  // matter which pay path booked it. Self-healing + best-effort (never blocks the read).
  await reconcileCashSettlements(supabase, user.id);

  const { data: rows } = await supabase
    .from("cash_entries")
    .select("id, entry_date, direction, amount, category, description")
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const entries = rows ?? [];

  // [KAS-SALDO] The headline "SALDO IN KASSA" must match the Kasboek panel's definition on the same
  // screen: the till's daily CASH takings (daily_turnover.cash_amount) are cash that entered the
  // drawer and are counted as ontvangsten in buildKasboek — but they live in daily_turnover, NOT in
  // cash_entries, so summing cash_entries alone understates the drawer (and shows a false negative
  // "meer uitgaven dan ontvangsten" alarm for every till shop). Sum BOTH sources. And sum the FULL
  // history, not the 500-row display slice — a truncated balance is itself a wrong number.
  const allMoves = await fetchAllRows((from, to) =>
    supabase.from("cash_entries").select("direction, amount").eq("user_id", user.id).order("id", { ascending: true }).range(from, to),
  );
  const tillRows = await fetchAllRows((from, to) =>
    supabase.from("daily_turnover").select("cash_amount").eq("user_id", user.id).order("turnover_date", { ascending: true }).range(from, to),
  );
  const entriesBalance = computeCashBalance(
    (allMoves as { direction: string; amount: number | null }[]).map((e) => ({ direction: e.direction === "in" ? "in" : "out", amount: e.amount })),
  );
  const tillCashIn = (tillRows as { cash_amount: number | null }[]).reduce((s, t) => s + (Number(t.cash_amount) || 0), 0);

  // [KAS-OPENING] Add the drawer's starting float (beginsaldo) so the saldo matches reality from
  // day one — a shop that began with cash in the till isn't understated by that amount.
  const { data: prof } = await supabase
    .from("profiles")
    .select("kas_opening_balance")
    .eq("id", user.id)
    .maybeSingle();
  const opening = Number((prof as { kas_opening_balance?: number | null } | null)?.kas_opening_balance ?? 0) || 0;

  const balance = Math.round((opening + entriesBalance + tillCashIn) * 100) / 100;

  return NextResponse.json({ ok: true, entries, balance, openingBalance: opening, count: entries.length });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    entry_date?: string; direction?: string; amount?: number; category?: string; description?: string; btw_rate?: number;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }

  const direction = body.direction;
  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const category = body.category;

  if (direction !== "in" && direction !== "out") {
    return NextResponse.json({ error: "direction moet 'in' of 'out' zijn" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount moet groter dan 0 zijn" }, { status: 400 });
  }
  if (!isCashCategory(category)) {
    return NextResponse.json({ error: "ongeldige categorie" }, { status: 400 });
  }

  // entry_date: accept a valid YYYY-MM-DD, else let the DB default to today.
  const entryDate = typeof body.entry_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.entry_date)
    ? body.entry_date
    : undefined;

  // BTW rate only makes sense on a cash sale (omzet); accept a valid Dutch rate.
  const btwRate = category === "omzet" && [0, 9, 21].includes(Number(body.btw_rate))
    ? Number(body.btw_rate)
    : null;

  const { data, error } = await supabase
    .from("cash_entries")
    .insert({
      user_id: user.id,
      direction,
      amount,
      category,
      description: body.description?.trim() || null,
      btw_rate: btwRate,
      ...(entryDate ? { entry_date: entryDate } : {}),
    })
    .select("id, entry_date, direction, amount, category, description")
    .single();

  if (error) {
    return NextResponse.json({ error: "kon kasboeking niet opslaan" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, entry: data });
}

// [KAS-OPENING] Set the drawer's opening balance (beginsaldo). A config value, not a movement —
// it is added to the saldo, never counted as omzet/BTW. Audited via the standard invoice/status
// trail is overkill for a config; a simple owner-scoped update on their own profile suffices (RLS).
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { kas_opening_balance?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const val = typeof body.kas_opening_balance === "number" ? body.kas_opening_balance : Number(body.kas_opening_balance);
  if (!Number.isFinite(val) || val < 0) {
    return NextResponse.json({ error: "beginsaldo moet 0 of hoger zijn" }, { status: 400 });
  }
  const opening = Math.round(val * 100) / 100;

  const { error } = await supabase
    .from("profiles")
    .update({ kas_opening_balance: opening } as never)
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: "kon beginsaldo niet opslaan" }, { status: 500 });
  return NextResponse.json({ ok: true, openingBalance: opening });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase
    .from("cash_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "kon boeking niet verwijderen" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
