// src/app/api/bank/ignored/route.ts
// [BANK-IGNORE] List the owner's ignored transactions (status='not_found') for
// the "Genegeerd" tab. Separate from /api/bank/match on purpose: ignored rows
// need no matching (the owner deliberately set them aside), so we just read and
// return them in the SAME suggestion shape the UI already renders, with
// outcome='none' and empty candidates. The "restore" button flips them back to
// pending via /api/bank/ignore.
//
// service_role is safe: every query is pinned to the authenticated user's rows.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();
  const { data: rows, error } = await pipeline
    .from("bank_transactions")
    .select("id, date, amount, description, counterpart_name, reference")
    .eq("user_id", user.id)
    .eq("status", "not_found")
    .order("date", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "ignored_lookup_failed", detail: error.message },
      { status: 500 }
    );
  }

  // Same lean DTO as /api/bank/match (outcome 'none', no candidates) so the UI
  // can reuse its row renderer. transactionId === bank_transactions.id.
  const suggestions = (rows ?? []).map((r) => ({
    transactionId: r.id,
    date: r.date,
    amount: r.amount ?? 0,
    description: r.description,
    counterpart: r.counterpart_name,
    outcome: "none" as const,
    best: null,
    candidates: [] as never[],
  }));

  return NextResponse.json({ ok: true, suggestions });
}