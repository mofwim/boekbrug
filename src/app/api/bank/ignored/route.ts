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
  // [BANK-IGNORE-REDEN] ignore_reason komt mee zodat de Genegeerd-lijst kan zeggen WAAROM een
  // regel daar staat. [DEPLOY-SAFE] Draait bank_ignore_reason.sql nog niet, dan bestaat de kolom
  // niet en weigert PostgREST de hele select — dan zou het tabblad leeg zijn in plaats van
  // labelloos, en dat is precies het verschil tussen "geen reden" en "geen regels". Eén keer
  // opnieuw zonder de kolom.
  const COLS = "id, date, amount, description, counterpart_name, reference";
  // ignore_reason staat nog niet in de gegenereerde types (die worden uit een live database
  // afgeleid), dus dezelfde cast die match/route.ts voor auto_match_reason gebruikt.
  type IgnoredRow = {
    id: string; date: string | null; amount: number | null; description: string | null;
    counterpart_name: string | null; reference: string | null; ignore_reason?: string | null;
  };
  const query = (cols: string) =>
    pipeline
      .from("bank_transactions")
      .select(cols)
      .eq("user_id", user.id)
      .eq("status", "not_found")
      .order("date", { ascending: false });

  let { data, error } = await query(`${COLS}, ignore_reason`);
  if (error && /ignore_reason/i.test(error.message)) {
    ({ data, error } = await query(COLS));
  }
  const rows = data as unknown as IgnoredRow[] | null;

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
    // [BANK-IGNORE-REDEN] null voor een rij van vóór deze kolom — het scherm toont dan niets.
    ignoreReason: r.ignore_reason ?? null,
  }));

  return NextResponse.json({ ok: true, suggestions });
}