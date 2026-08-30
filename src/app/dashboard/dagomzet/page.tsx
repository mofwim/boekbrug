// src/app/dashboard/dagomzet/page.tsx
// [TURNOVER-IMPORT] Server wrapper — auth guard, then the self-contained import client.

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session-user";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import DagomzetImportClient from "./DagomzetImportClient";
import { fetchAllRows } from "@/lib/supabase-paginate";
import type { CardPayoutLine } from "@/lib/day-card-takings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dagomzet — BoekBrug" };

export default async function DagomzetPage() {
  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // [KOR-FACTUUR] Read here, the same way /dashboard/invoice/new reads it: under the KOR the owner
  // charges no btw, so the hand-typed day must offer the 0% box and nothing else. Read fail-open —
  // false is what every owner outside the scheme gets, and the write refuses regardless.
  // Read apart and tolerantly so this screen still works where the kor column has not landed.
  let korActive = false;
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase
      .from("profiles").select("kor_active").eq("id", user.id).maybeSingle();
    korActive = Boolean(data?.kor_active);
  } catch {
    /* no kor column yet → the ordinary three-rate day, exactly as before */
  }
  // [DAG-UIT-DE-BANK] The card payouts of the recent past, so the hand-typed day can offer what
  // the bank already says its card takings were instead of asking the owner to retype them.
  // Measured live: one shop has 142 days with card payouts and no Z-report.
  //
  // Bounded to 120 days deliberately. This is the window in which a missing day is actually filled
  // in; loading a year would send thousands of rows to a browser to answer one question about one
  // date. Read fail-open — the suggestion is a convenience, and a screen that will not open
  // because a nicety could not load is a worse screen than one that simply does not suggest.
  let cardPayouts: CardPayoutLine[] = [];
  try {
    const supabase = await createServerSupabaseClient();
    const since = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    cardPayouts = await fetchAllRows<CardPayoutLine>((from, to) =>
      supabase
        .from("bank_transactions")
        .select("date, amount, description")
        .eq("user_id", user.id)
        .eq("category", "pos_income")
        .gte("date", since)
        .order("id", { ascending: true })
        .range(from, to));
  } catch {
    /* no suggestion this time — the form works exactly as it did before */
  }

  // [COHERENCE-DAGOMZET] TurnoverInsights is rendered ONCE, inside DagomzetImportClient
  // (at the top, above the import panel), so it lives in the same 640px centered
  // container and remounts after a commit via refreshTick. It used to also render here
  // at page level — a second, full-bleed, non-refreshing copy that read as a rendering
  // bug and could drift out of sync after an import. Removed.
  return <DagomzetImportClient korActive={korActive} cardPayouts={cardPayouts} />;
}
