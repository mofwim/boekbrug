// src/app/api/closing-package/vers/route.ts
// [PAKKET-VERS] Which of my downloaded quarter packages have gone stale?
//
// GET /api/closing-package/vers?year=2026&quarter=2        ← accountant only
//   → { perClient: { [clientId]: { downloadedAt, total, sentence, unknown? } } }
//
// One call for the whole werkboard. A client appears in the answer ONLY when this accountant has
// actually downloaded that quarter's package (the accountant.package_downloaded audit row that
// /api/closing-package writes on the accountant path); for everyone else there is no copy on a
// disk to be stale, and the board already shows the download link.
//
// Accountant-only by design: the owner's own downloads are not audited (deliberately — his screen
// IS the administration, a stale copy is a problem only for the person working from the file),
// so an owner calling this would get an empty answer dressed up as "all fresh". Refusing is
// honest; the accountant module is the audience.
//
// ── Reads ──
// The download moments come from the accountant's OWN audit rows via the session client — the
// "Users see own logs" RLS policy covers exactly this. The per-client contents come from the
// pipeline client scoped per ownerId, because RLS shows an accountant none of his client's rows
// (the same reason /api/closing-package builds with the pipeline). The membership arithmetic
// itself lives in package-freshness.ts, which imports the package's own judgement functions.
//
// ── A failed read is "unknown", never "fresh" ──
// The dangerous wrong answer here is a false "niets bijgekomen": it talks the accountant OUT of
// re-downloading, which is the one thing this route must never do. So any failed source read
// turns that client's answer into an honest "we could not check", with the download date kept.

import { NextRequest, NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { liveCashEntries } from "@/lib/cash-live";
import { quarterRange, type Quarter } from "@/lib/kasboek";
import {
  packageFreshness,
  lastDownloadPerOwner,
  type FreshInvoiceRow,
  type FreshDocRow,
} from "@/lib/package-freshness";

export const dynamic = "force-dynamic";

interface ClientFreshness {
  downloadedAt: string;
  total: number;
  sentence: string;
  unknown?: boolean;
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const year = Number(req.nextUrl.searchParams.get("year"));
  const quarterRaw = Number(req.nextUrl.searchParams.get("quarter"));
  if (!Number.isInteger(year) || year < 2020 || year > 2030) {
    return NextResponse.json({ error: "Ongeldig jaar" }, { status: 400 });
  }
  if (![1, 2, 3, 4].includes(quarterRaw)) {
    return NextResponse.json({ error: "Ongeldig kwartaal" }, { status: 400 });
  }
  const quarter = quarterRaw as Quarter;

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "accountant") {
    return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  }

  // The clients this accountant is linked to TODAY. A download for a since-unlinked client is
  // deliberately dropped: the board does not show that client, and answering about an
  // administration the accountant can no longer open would itself be a leak.
  const { data: links, error: linkErr } = await supabase
    .from("accountant_clients")
    .select("zzper_id")
    .eq("accountant_id", user.id);
  if (linkErr) {
    return NextResponse.json({ error: "Koppelingen niet leesbaar" }, { status: 503 });
  }
  const linked = new Set((links ?? []).map((l) => (l as { zzper_id: string }).zzper_id));

  // My own download trail for this quarter. [PAGINATION] Paged like every other list read: an
  // accountant who pulls packages for thirty clients over years walks straight past a plain
  // select's silent ~1000-row cap, and a truncated trail here reports a REAL download as absent.
  const auditRows = await fetchAllRows<{ entity_id: string | null; created_at: string | null }>(
    (lo, hi) =>
      supabase
        .from("audit_logs")
        .select("entity_id, created_at")
        .eq("user_id", user.id)
        .eq("action", "accountant.package_downloaded")
        .like("entity_id", `%:${year}-Q${quarter}`)
        .order("id", { ascending: true })
        .range(lo, hi),
  ).catch(() => null);
  if (auditRows === null) {
    // Without the trail there is nothing true to say about any client. Refuse rather than answer
    // "no downloads" about a read that failed — the board then simply shows no freshness lines.
    return NextResponse.json({ error: "Logboek niet leesbaar" }, { status: 503 });
  }

  const downloads = lastDownloadPerOwner(auditRows, year, quarter);
  const { start, end } = quarterRange(year, quarter);
  const pipeline = createPipelineClient();

  const perClient: Record<string, ClientFreshness> = {};

  await Promise.all(
    [...downloads.entries()]
      .filter(([ownerId]) => linked.has(ownerId))
      .map(async ([ownerId, downloadedAt]) => {
        try {
          // The quarter's invoices are fetched WHOLE, not prefiltered on created_at: the
          // verify-after-download case moves updated_at only, and PostgREST cannot express
          // "greatest(created_at, updated_at) > X". The other four sources can prefilter
          // server-side — membership is still decided in the pure module.
          const liveCash = await liveCashEntries(pipeline);
          const [invoices, documents, bank, cash, turnover] = await Promise.all([
            fetchAllRows<FreshInvoiceRow>((lo, hi) =>
              pipeline
                .from("invoices")
                .select("direction, status, sender_id, receiver_id, invoice_date, created_at, updated_at")
                .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
                .or(`and(invoice_date.gte.${start},invoice_date.lte.${end}),invoice_date.is.null`)
                .neq("status", "archived")
                .order("id", { ascending: true })
                .range(lo, hi),
            ),
            fetchAllRows<FreshDocRow>((lo, hi) =>
              pipeline
                .from("documents")
                .select("doc_type, period, shared, trashed, invoice_id, created_at")
                .eq("user_id", ownerId)
                .gt("created_at", downloadedAt)
                .order("id", { ascending: true })
                .range(lo, hi),
            ),
            fetchAllRows<{ date: string | null; created_at: string | null }>((lo, hi) =>
              pipeline
                .from("bank_transactions")
                .select("date, created_at")
                .eq("user_id", ownerId)
                .gte("date", start)
                .lte("date", end)
                .gt("created_at", downloadedAt)
                .order("id", { ascending: true })
                .range(lo, hi),
            ),
            fetchAllRows<{ entry_date: string | null; created_at: string | null }>((lo, hi) =>
              liveCash.only(
                pipeline
                  .from("cash_entries")
                  .select("entry_date, created_at")
                  .eq("user_id", ownerId)
                  .gte("entry_date", start)
                  .lte("entry_date", end)
                  .gt("created_at", downloadedAt),
              )
                .order("id", { ascending: true })
                .range(lo, hi),
            ),
            fetchAllRows<{ turnover_date: string | null; created_at: string | null }>((lo, hi) =>
              pipeline
                .from("daily_turnover")
                .select("turnover_date, created_at")
                .eq("user_id", ownerId)
                .gte("turnover_date", start)
                .lte("turnover_date", end)
                .gt("created_at", downloadedAt)
                .order("id", { ascending: true })
                .range(lo, hi),
            ),
          ]);

          const fresh = packageFreshness({
            downloadedAt,
            ownerId,
            year,
            quarter,
            invoices,
            documents,
            bank: bank.map((r) => ({ docDate: r.date, createdAt: r.created_at })),
            cash: cash.map((r) => ({ docDate: r.entry_date, createdAt: r.created_at })),
            turnover: turnover.map((r) => ({ docDate: r.turnover_date, createdAt: r.created_at })),
          });
          perClient[ownerId] = { downloadedAt, total: fresh.total, sentence: fresh.sentence };
        } catch (err) {
          console.error("[PAKKET-VERS] freshness read failed — answering 'could not check', never 'fresh'", {
            ownerId, year, quarter, error: err instanceof Error ? err.message : String(err),
          });
          perClient[ownerId] = {
            downloadedAt,
            total: 0,
            unknown: true,
            sentence: "Of er sinds je download iets bijkwam, konden we nu niet controleren.",
          };
        }
      }),
  );

  return NextResponse.json({ ok: true, year, quarter, perClient });
}
