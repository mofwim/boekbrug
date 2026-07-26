// src/app/api/cash/route.ts
// [CASH-LEDGER] The cash book (kasadministratie). User-scoped via the RLS server client.
//
// GET    → all cash entries (newest first) + the running kas balance.
// POST   → add one entry (a cash sale, a cash expense, a deposit/withdrawal, …).
// DELETE → remove one entry (?id=).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { computeDrawerBalance, isCashCategory } from "@/lib/cash";
import { reconcileCashSettlements } from "@/lib/cash-settle";
import { fetchAllRows } from "@/lib/supabase-paginate";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // [CASH-SETTLE] Before reading, make the kasboek reflect every invoice paid in cash — no
  // matter which pay path booked it. Self-healing + best-effort (never blocks the read).
  await reconcileCashSettlements(supabase, user.id);

  // [SEARCH-FULL-LEDGER] Return the WHOLE cash book, not the newest 500. The in-page zoekbalk filters
  // this array client-side (op omschrijving / categorie / bedrag), so a 500-row slice made every entry
  // older than the newest 500 UNFINDABLE — a silent "geen resultaten" that reads as "bestaat niet".
  // Page past the ~1000-row PostgREST cap with a stable id order, then sort newest-first for display.
  // This same full read also feeds the saldo below, so it replaces the separate movements fetch (one
  // scan instead of two).
  const allEntries = await fetchAllRows<{
    id: string; entry_date: string; created_at: string | null; direction: string;
    amount: number | null; category: string; description: string | null; document_id: string | null; btw_rate: number | null;
  }>((from, to) =>
    supabase
      .from("cash_entries")
      .select("id, entry_date, created_at, direction, amount, category, description, document_id, btw_rate")
      .eq("user_id", user.id)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const entries = [...allEntries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? 1 : -1; // newest date first
    const ac = a.created_at ?? "", bc = b.created_at ?? "";
    return ac < bc ? 1 : ac > bc ? -1 : 0; // then newest created_at first
  });

  // [KAS-SALDO] The headline "SALDO IN KASSA" must match the Kasboek panel's definition on the same
  // screen: the till's daily CASH takings (daily_turnover.cash_amount) are cash that entered the
  // drawer and are counted as ontvangsten in buildKasboek — but they live in daily_turnover, NOT in
  // cash_entries, so summing cash_entries alone understates the drawer (and shows a false negative
  // "meer uitgaven dan ontvangsten" alarm for every till shop). Sum BOTH sources over the FULL
  // history (allEntries above) — a truncated balance is itself a wrong number.
  const allMoves = allEntries;
  const tillRows = await fetchAllRows((from, to) =>
    supabase.from("daily_turnover").select("cash_amount").eq("user_id", user.id).order("turnover_date", { ascending: true }).range(from, to),
  );
  // [KAS-OPENING] Add the drawer's starting float (beginsaldo) so the saldo matches reality from
  // day one — a shop that began with cash in the till isn't understated by that amount.
  const { data: prof } = await supabase
    .from("profiles")
    .select("kas_opening_balance")
    .eq("id", user.id)
    .maybeSingle();
  const opening = Number((prof as { kas_opening_balance?: number | null } | null)?.kas_opening_balance ?? 0) || 0;

  // [KAS-SALDO] One shared definition (computeDrawerBalance) so this page and the home snapshot
  // can never diverge: opening float + cash_entries net + till daily-cash takings.
  const balance = computeDrawerBalance({
    openingBalance: opening,
    entries: (allMoves as { direction: string; amount: number | null }[]).map((e) => ({ direction: e.direction === "in" ? "in" : "out", amount: e.amount })),
    tillCashAmounts: (tillRows as { cash_amount: number | null }[]).map((t) => t.cash_amount),
  });

  return NextResponse.json({ ok: true, entries, balance, openingBalance: opening, count: entries.length });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    entry_date?: string; direction?: string; amount?: number; category?: string; description?: string; btw_rate?: number; document_id?: string;
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

  // [CASH-COST-VAT] Verify the linked bon is a document THIS user owns before trusting it — an
  // unowned/forged document_id must never unlock a voorbelasting deduction (a real, wrong number
  // on the aangifte). Null it (and, below, the rate) when it isn't the owner's.
  let documentId: string | null = null;
  if (typeof body.document_id === "string" && body.document_id.length > 0) {
    const { data: doc } = await supabase
      .from("documents").select("id").eq("id", body.document_id).eq("user_id", user.id).maybeSingle();
    if (doc) documentId = body.document_id;
  }

  // [CASH-COST-VAT] A BTW rate is accepted on a cash SALE (omzet), OR on a cash COST (kosten) ONLY
  // when it carries an owned bon — the universal "no voorbelasting without a document" rule. On any
  // other category (salaris, prive, transfer, tax, fee) the rate is forced null (wages/transfers
  // carry no reclaimable BTW). Without a document a cost's rate is dropped → it books at full gross.
  const rateAllowed = category === "omzet" || (category === "kosten" && documentId !== null);
  const btwRate = rateAllowed && [0, 9, 21].includes(Number(body.btw_rate))
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
      ...(documentId ? { document_id: documentId } : {}),
      ...(entryDate ? { entry_date: entryDate } : {}),
    })
    .select("id, entry_date, direction, amount, category, description, document_id")
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
