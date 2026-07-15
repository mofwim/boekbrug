// src/app/api/bank/categorize/route.ts
// [BANK-IDENTITY] Give bank lines a financial identity, and learn from it.
//
// GET  → the transactions still needing a category (pending, not tied to an invoice,
//        not yet categorized), each with a suggestion (memory wins → AI classifier),
//        plus the TRUE remaining total so the UI never claims "done" while lines remain.
// POST → confirm a category for one transaction and TRAIN the per-counterpart memory,
//        OR (mode:"bulk") auto-apply ONLY the confident suggestions — memory matches and
//        specific pattern matches (tax/prive/transfer/pos_income/fee). The bare
//        kosten/omzet fallback (a guess by sign alone) is NEVER auto-applied, so a
//        transfer, tax payment or private withdrawal can't be silently booked as a
//        deductible cost. لا اختراعات: the machine only fills what it actually knows.
//
// User-scoped via the RLS server client (auth.uid()). No amount arithmetic here — a
// category is a task/identity, not a money claim.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { counterpartKey, suggestIdentity } from "@/lib/bank-identity";
import { ALLOWED_CATEGORIES, type BankCategory } from "@/lib/bank-categories";

// How many rows one GET page returns (the review list). The true remaining total is
// reported separately via an exact head-count, so a capped page never reads as "done".
const PAGE_SIZE = 200;
// Safety cap for the bulk sweep so a runaway account can't spin forever.
const BULK_MAX = 5000;

// ─── GET: the to-categorize list with suggestions + the honest remaining total ───
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // The TRUE remaining count — an exact head-count, independent of the page size.
  // This is what governs "alles gecategoriseerd": only 0 here means truly done.
  const { count: totalRemaining } = await supabase
    .from("bank_transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "pending")
    .is("invoice_id", null)
    .is("category", null);

  // Uncategorized, still-pending lines that aren't an invoice payment (one page).
  const { data: rows } = await supabase
    .from("bank_transactions")
    .select("id, date, amount, counterpart_name, description")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .is("invoice_id", null)
    .is("category", null)
    .order("date", { ascending: false })
    .limit(PAGE_SIZE);

  const txs = rows ?? [];

  // One read of the memory, turned into a key → category map for O(1) suggestions.
  const { data: mem } = await supabase
    .from("counterpart_memory")
    .select("counterpart_key, category")
    .eq("user_id", user.id);

  const memMap = new Map<string, string>();
  for (const m of mem ?? []) memMap.set(m.counterpart_key, m.category);

  let confidentAvailable = 0;
  const items = txs.map((t) => {
    const key = counterpartKey(t.counterpart_name);
    const memoryCategory = key ? memMap.get(key) ?? null : null;
    const suggestion = suggestIdentity(t.counterpart_name, t.description, t.amount ?? 0, memoryCategory);
    if (suggestion.confident) confidentAvailable++;
    return {
      id: t.id,
      date: t.date,
      amount: t.amount,
      counterpart_name: t.counterpart_name,
      description: t.description,
      suggested: suggestion.category,
      suggested_source: suggestion.source,
      // Only confident suggestions are eligible for the one-click bulk apply.
      suggested_confident: suggestion.confident,
    };
  });

  return NextResponse.json({
    ok: true,
    items,
    // items.length is only this page; totalRemaining is the honest DB-wide count.
    count: items.length,
    total_remaining: totalRemaining ?? items.length,
    // How many on THIS page could be auto-applied (a hint for the bulk button).
    confident_available: confidentAvailable,
    has_more: (totalRemaining ?? 0) > items.length,
  });
}

// ─── POST: confirm one category (+train memory)  OR  bulk-apply confident ones ───
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { transaction_id?: string; category?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (body.mode === "bulk") return bulkApply(supabase, user.id);

  const transactionId = body.transaction_id;
  const category = body.category as BankCategory | undefined;
  if (!transactionId || !category || !ALLOWED_CATEGORIES.has(category)) {
    return NextResponse.json({ error: "transaction_id and a valid category are required" }, { status: 400 });
  }

  // Load the transaction (RLS pins it to this user) to get its counterpart for memory.
  const { data: tx, error: txErr } = await supabase
    .from("bank_transactions")
    .select("id, counterpart_name")
    .eq("id", transactionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (txErr || !tx) {
    return NextResponse.json({ error: "transaction not found" }, { status: 404 });
  }

  // 1) Set the identity on the transaction.
  const { error: updErr } = await supabase
    .from("bank_transactions")
    .update({ category, category_source: "user", category_confirmed: true })
    .eq("id", transactionId)
    .eq("user_id", user.id);

  if (updErr) {
    return NextResponse.json({ error: "kon categorie niet opslaan" }, { status: 500 });
  }

  // 2) Train the memory for this counterpart (so it auto-applies next time).
  await trainMemory(supabase, user.id, tx.counterpart_name, category);

  return NextResponse.json({ ok: true });
}

// ─── Bulk apply: fill ONLY the confident suggestions, leave the rest for the owner ──
// Confident = memory match or a specific pattern (tax/prive/transfer/pos_income/fee).
// The kosten/omzet fallback is deliberately skipped: guessing "cost" for an unlabeled
// transfer/tax/private line would put money into the P&L that doesn't belong there.
async function bulkApply(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
) {
  // Memory map once.
  const { data: mem } = await supabase
    .from("counterpart_memory")
    .select("counterpart_key, category")
    .eq("user_id", userId);
  const memMap = new Map<string, string>();
  for (const m of mem ?? []) memMap.set(m.counterpart_key, m.category);

  // Pull the uncategorized lines (capped) and decide per line.
  const { data: rows } = await supabase
    .from("bank_transactions")
    .select("id, amount, counterpart_name, description")
    .eq("user_id", userId)
    .eq("status", "pending")
    .is("invoice_id", null)
    .is("category", null)
    .order("date", { ascending: false })
    .limit(BULK_MAX);

  const txs = rows ?? [];
  let applied = 0;
  let skipped = 0;

  for (const t of txs) {
    const key = counterpartKey(t.counterpart_name);
    const memoryCategory = key ? memMap.get(key) ?? null : null;
    const s = suggestIdentity(t.counterpart_name, t.description, t.amount ?? 0, memoryCategory);
    if (!s.confident) { skipped++; continue; }

    // Auto-applied, NOT individually confirmed by the owner → category_confirmed:false
    // so it stays reviewable. category_source records who suggested it (memory/ai).
    const { error } = await supabase
      .from("bank_transactions")
      .update({ category: s.category, category_source: s.source, category_confirmed: false })
      .eq("id", t.id)
      .eq("user_id", userId)
      .is("category", null); // guard: don't clobber a category set meanwhile

    if (error) { skipped++; continue; }
    applied++;
  }

  // The honest remaining total after the sweep.
  const { count: remaining } = await supabase
    .from("bank_transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending")
    .is("invoice_id", null)
    .is("category", null);

  return NextResponse.json({
    ok: true,
    applied,
    skipped,          // left untouched because the suggestion was only a sign-guess
    remaining: remaining ?? 0,
  });
}

// Train per-counterpart memory from an explicit user confirmation.
async function trainMemory(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  counterpartName: string | null,
  category: BankCategory,
) {
  const key = counterpartKey(counterpartName);
  if (!key) return;
  const { data: existing } = await supabase
    .from("counterpart_memory")
    .select("id, times_seen")
    .eq("user_id", userId)
    .eq("counterpart_key", key)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("counterpart_memory")
      .update({ category, times_seen: (existing.times_seen ?? 1) + 1, last_used_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("counterpart_memory")
      .insert({ user_id: userId, counterpart_key: key, category });
  }
}
