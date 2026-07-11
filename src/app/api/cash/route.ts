// src/app/api/cash/route.ts
// [CASH-LEDGER] The cash book (kasadministratie). User-scoped via the RLS server client.
//
// GET    → all cash entries (newest first) + the running kas balance.
// POST   → add one entry (a cash sale, a cash expense, a deposit/withdrawal, …).
// DELETE → remove one entry (?id=).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { computeCashBalance, isCashCategory } from "@/lib/cash";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: rows } = await supabase
    .from("cash_entries")
    .select("id, entry_date, direction, amount, category, description")
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const entries = rows ?? [];
  const balance = computeCashBalance(
    entries.map((e) => ({ direction: e.direction === "in" ? "in" : "out", amount: e.amount })),
  );

  return NextResponse.json({ ok: true, entries, balance, count: entries.length });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    entry_date?: string; direction?: string; amount?: number; category?: string; description?: string;
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

  const { data, error } = await supabase
    .from("cash_entries")
    .insert({
      user_id: user.id,
      direction,
      amount,
      category,
      description: body.description?.trim() || null,
      ...(entryDate ? { entry_date: entryDate } : {}),
    })
    .select("id, entry_date, direction, amount, category, description")
    .single();

  if (error) {
    return NextResponse.json({ error: "kon kasboeking niet opslaan" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, entry: data });
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
