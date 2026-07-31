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
import { fetchAllRows } from "@/lib/supabase-paginate";

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
  // [PAGINATE] Paged past the silent ~1000-row cap. This list is not just a tab: BankClient sums
  // it into the "N genegeerde regels van samen €X — loop ze nog even na voordat je het kwartaal
  // afsluit" banner, which exists precisely because ignored money appears in NO other figure.
  // A truncated read makes that total quietly too low, and the newest-first order drops the
  // OLDEST rows first — the very ones the banner is warning about. Ordered by id underneath so
  // the paging window is stable (date is not unique); the UI sorts for display anyway.
  const query = (cols: string, from: number, to: number) =>
    pipeline
      .from("bank_transactions")
      .select(cols)
      .eq("user_id", user.id)
      .eq("status", "not_found")
      .order("id", { ascending: true })
      .range(from, to);

  // [DEPLOY-SAFE] Probe the optional column ONCE before paging, so a missing ignore_reason
  // costs one short request instead of re-detecting it on every page.
  let cols = `${COLS}, ignore_reason`;
  const { error: probeErr } = await query(cols, 0, 0);
  if (probeErr && /ignore_reason/i.test(probeErr.message)) cols = COLS;

  let rows: IgnoredRow[];
  try {
    rows = (await fetchAllRows((from, to) => query(cols, from, to))) as unknown as IgnoredRow[];
  } catch (e) {
    return NextResponse.json(
      { error: "ignored_lookup_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  // Newest first, as this list has always been shown. The paging above must order by a stable
  // UNIQUE column (id) or a row can repeat or vanish between windows — and unlike the other
  // tabs, BankClient renders this one WITHOUT its own sort, so the order has to be restored
  // here. Now that every row is in hand, sorting in memory is exact.
  rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

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