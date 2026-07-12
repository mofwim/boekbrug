// src/app/api/bank/categorize/route.ts
// [BANK-IDENTITY] Give bank lines a financial identity, and learn from it.
//
// GET  → the transactions still needing a category (pending, not tied to an invoice,
//        not yet categorized), each with a suggestion (memory wins → AI classifier).
// POST → confirm a category for one transaction and TRAIN the per-counterpart memory,
//        so the same counterpart is auto-categorized next time.
//
// User-scoped via the RLS server client (auth.uid()). No amount arithmetic here — a
// category is a task/identity, not a money claim.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { counterpartKey, suggestIdentity, type Category } from "@/lib/bank-identity";

const ALLOWED: ReadonlySet<Category> = new Set<Category>([
  "kosten", "omzet", "prive", "transfer", "tax", "fee", "pos_income",
]);

// ─── GET: the to-categorize list with suggestions ────────────────────────────
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Uncategorized, still-pending lines that aren't an invoice payment.
  const { data: rows } = await supabase
    .from("bank_transactions")
    .select("id, date, amount, counterpart_name, description")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .is("invoice_id", null)
    .is("category", null)
    .order("date", { ascending: false })
    .limit(100);

  const txs = rows ?? [];

  // One read of the memory, turned into a key → category map for O(1) suggestions.
  const { data: mem } = await supabase
    .from("counterpart_memory")
    .select("counterpart_key, category")
    .eq("user_id", user.id);

  const memMap = new Map<string, string>();
  for (const m of mem ?? []) memMap.set(m.counterpart_key, m.category);

  const items = txs.map((t) => {
    const key = counterpartKey(t.counterpart_name);
    const memoryCategory = key ? memMap.get(key) ?? null : null;
    const suggestion = suggestIdentity(t.counterpart_name, t.description, t.amount ?? 0, memoryCategory);
    return {
      id: t.id,
      date: t.date,
      amount: t.amount,
      counterpart_name: t.counterpart_name,
      description: t.description,
      suggested: suggestion.category,
      suggested_source: suggestion.source,
    };
  });

  return NextResponse.json({ ok: true, items, count: items.length });
}

// ─── POST: confirm a category + train memory ─────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { transaction_id?: string; category?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const transactionId = body.transaction_id;
  const category = body.category as Category | undefined;
  if (!transactionId || !category || !ALLOWED.has(category)) {
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
  const key = counterpartKey(tx.counterpart_name);
  if (key) {
    const { data: existing } = await supabase
      .from("counterpart_memory")
      .select("id, times_seen")
      .eq("user_id", user.id)
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
        .insert({ user_id: user.id, counterpart_key: key, category });
    }
  }

  return NextResponse.json({ ok: true });
}
