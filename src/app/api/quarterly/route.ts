// src/app/api/quarterly/route.ts
// [BOEK-013] Quarterly financial overview — May 2026
// [BOEK-FOUNDATION-TYPES] Null safety for DB-nullable fields — May 2026
// [BRIDGE-QUARTER] June 2026 — ZZP uitgaven fix: incoming invoices were never
//                  fetched (sender_id-only filter). Now fetch both directions.
// GET /api/quarterly?year=2026&quarter=1
// GET /api/quarterly?year=2026&quarter=1&mode=paid       ← ZZP betaald overzicht
// GET /api/quarterly?year=2026&quarter=1&mode=all        ← ZZP alles overzicht
// GET /api/quarterly?year=2026&quarter=1&clientId=xxx    ← accountant mode (unchanged)

import { NextRequest, NextResponse } from "next/server";
// [TZ-SERVER] De klok van de eigenaar, niet die van de server — zie format-nl.ts.
import { amsterdamYear, amsterdamMonth } from "@/lib/format-nl";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  buildQuarterlySummary,
  buildZzpSummary,
  quarterStartDate,
  quarterEndDate,
} from "@/lib/quarterly";
import type { InvoiceForQuarterly } from "@/lib/quarterly";
// [PAGINATION] pages past PostgREST's silent ~1000-row cap (same fix class as
// /api/result, /api/aangifte and the closing package).
import { fetchAllRows } from "@/lib/supabase-paginate";

// [BOEK-FOUNDATION-TYPES] Helper: safely calculate btw_rate from nullable fields
// [CREDITNOTA-RATE] Guard on !== 0, not > 0: a creditnota stores NEGATIVE
// amounts, and the old `exBtw > 0` bucketed it under "0%" with a non-zero
// negative BTW — a nonsense row that made the accountant's on-screen
// btwBreakdown disagree with the closing-package CSV (export.ts calcBtwRate,
// which already handles negatives: -21/-100 → 21%). Same maths now.
function calculateBtwRate(
  totalExBtw: number | null,
  btwAmount: number | null
): number {
  const exBtw = totalExBtw ?? 0;
  const btw = btwAmount ?? 0;
  return exBtw !== 0 ? Math.round((btw / exBtw) * 100) : 0;
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // [TZ-SERVER] De eigenaar zijn kwartaal, niet dat van de server. Dit is het scherm waarop de
  // BTW van een kwartaal wordt afgelezen, en zonder ?quarter= besliste de serverklok welk kwartaal
  // dat is. De server staat in UTC en Amsterdam is UTC+1/+2, dus in het eerste uur van 1 april
  // staat de server nog op 31 maart: de ondernemer opent zijn kwartaaloverzicht op de eerste dag
  // van Q2 en leest de cijfers van Q1 — zonder dat iets op het scherm zegt welk kwartaal het toont
  // dan het kwartaal zelf, dat dus ook fout is.
  const year = Number(req.nextUrl.searchParams.get("year") ?? amsterdamYear());
  const quarter = Number(
    req.nextUrl.searchParams.get("quarter") ?? Math.ceil(amsterdamMonth() / 3)
  ) as 1 | 2 | 3 | 4;
  const clientId = req.nextUrl.searchParams.get("clientId");
  // [BOEK-013] ZZP mode: 'paid' | 'all' — only used when role = zzper
  const mode = (req.nextUrl.searchParams.get("mode") ?? "paid") as "paid" | "all";

  if (quarter < 1 || quarter > 4 || isNaN(year)) {
    return NextResponse.json({ error: "Ongeldige parameters" }, { status: 400 });
  }

  // ── Accountant mode ──────────────────────────────────────────
  // [BRIDGE-QUARTER-ACC] ROOT-CAUSE FIX for "accountant sees €0,00 / 0 facturen"
  // while the owner sees 22 invoices.
  //
  // Before: .eq("sender_id", clientId).eq("status","paid") fetched ONLY the
  // client's OUTGOING PAID invoices. But a client's quarter is mostly INCOMING
  // (Crediteuren — supplier invoices where the client is the RECEIVER, not the
  // sender) and includes non-paid verified states (sent/received/overdue). So
  // the accountant saw almost nothing — the closing package would be empty.
  //
  // After: mirror the (already-fixed) ZZP path — fetch BOTH directions for the
  // client, exclude unverified/draft, infer direction safely from ownership.
  // The accountant must see the client's FULL quarter to close it.
  if (profile?.role === "accountant") {
    if (!clientId) return NextResponse.json({ error: "Geen klant geselecteerd" }, { status: 400 });

    const { data: rel } = await supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .single();

    if (!rel) return NextResponse.json({ error: "Geen toegang" }, { status: 403 });

    const start = quarterStartDate(year, quarter);
    const end = quarterEndDate(year, quarter);

    // [PAGINATION] fetchAllRows pages past PostgREST's silent ~1000-row cap so
    // a busy quarter's summary/list can never truncate; stable id tiebreak.
    const data = await fetchAllRows((from, to) => supabase
      .from("invoices")
      .select("id, invoice_number, client_name, status, direction, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date, sender_id, receiver_id")
      .or(`sender_id.eq.${clientId},receiver_id.eq.${clientId}`)
      .gte("invoice_date", start)
      .lte("invoice_date", end)
      .order("invoice_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
    ).catch((e: unknown) => new Error(e instanceof Error ? e.message : "quarterly_failed"));
    if (data instanceof Error) {
      return NextResponse.json({ error: data.message }, { status: 500 });
    }

    // [BRIDGE-QUARTER-ACC] Verified only — exclude unconfirmed (processing) and
    // draft. Same boundary as the closing package: AI prepares, human confirms,
    // the accountant only ever sees verified evidence.
    const VERIFIED = new Set(["sent", "paid", "overdue", "received"]);

    const invoices: InvoiceForQuarterly[] = (data ?? [])
      .filter((inv) => VERIFIED.has(inv.status ?? ""))
      .map((inv) => {
        // [BRIDGE-QUARTER-ACC] Direction safety: with incoming rows in scope, a
        // NULL direction must not default to "outgoing" (would miscount an
        // expense as income). Infer from ownership relative to the CLIENT.
        let direction = inv.direction;
        if (!direction) {
          if (inv.receiver_id === clientId) direction = "incoming";
          else if (inv.sender_id === clientId) direction = "outgoing";
          else direction = "outgoing";
        }

        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          client_name: inv.client_name,
          status: inv.status,
          direction,
          total_ex_btw: inv.total_ex_btw,
          btw_amount: inv.btw_amount,
          total_inc_btw: inv.total_inc_btw,
          invoice_date: inv.invoice_date,
          due_date: inv.due_date ?? undefined,
          // [BOEK-FOUNDATION-TYPES] Null-safe btw_rate calculation
          btw_rate: calculateBtwRate(inv.total_ex_btw, inv.btw_amount),
        };
      });

    return NextResponse.json(buildQuarterlySummary(invoices, year, quarter));
  }

  // ── ZZP mode — simplified 4-number summary ───────────────────
  const start = quarterStartDate(year, quarter);
  const end = quarterEndDate(year, quarter);

  // [BRIDGE-QUARTER] ROOT-CAUSE FIX for "Uitgaven = €0,00".
  //
  // Before: .eq("sender_id", user.id) fetched ONLY outgoing invoices (where the
  // ZZP'er is the sender). Incoming invoices (CAN, OZ&ER) have the ZZP'er as the
  // RECEIVER (receiver_id = user.id, sender_id = the supplier), so they were
  // never fetched. buildZzpSummary then received zero incoming rows and totalOut
  // stayed 0 — wrong VAT 5b (voorbelasting).
  //
  // After: fetch BOTH directions for this ZZP'er. buildZzpSummary already filters
  // by direction + status correctly; it just needs the incoming rows to exist.
  //
  // Two axes preserved (Bridge model):
  //   outgoing → Inkomsten (totalIn)   incoming → Uitgaven (totalOut)
  // [PAGINATION] Same silent-cap fix as the accountant branch above.
  const data = await fetchAllRows((from, to) => supabase
    .from("invoices")
    .select("id, invoice_number, client_name, status, direction, total_ex_btw, btw_amount, total_inc_btw, invoice_date, due_date, sender_id, receiver_id")
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .not("status", "eq", "draft") // never include draft/concept
    .order("invoice_date", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to)
  ).catch((e: unknown) => new Error(e instanceof Error ? e.message : "quarterly_failed"));
  if (data instanceof Error) {
    return NextResponse.json({ error: data.message }, { status: 500 });
  }

  const invoices: InvoiceForQuarterly[] = (data ?? []).map((inv) => {
    // [BRIDGE-QUARTER] Direction safety: with incoming rows now in scope, a NULL
    // direction must NOT silently fall back to "outgoing" (that would miscount an
    // incoming invoice as Inkomsten). Infer from ownership instead:
    //   receiver_id = me  → incoming (I received it → expense)
    //   sender_id   = me  → outgoing (I sent it → income)
    // If neither/both resolve ambiguously, keep the stored direction when present.
    let direction = inv.direction;
    if (!direction) {
      if (inv.receiver_id === user.id) direction = "incoming";
      else if (inv.sender_id === user.id) direction = "outgoing";
      else direction = "outgoing"; // last-resort fallback (should not happen here)
    }

    return {
      id: inv.id,
      invoice_number: inv.invoice_number,
      client_name: inv.client_name,
      status: inv.status,
      direction,
      total_ex_btw: inv.total_ex_btw,
      btw_amount: inv.btw_amount,
      total_inc_btw: inv.total_inc_btw,
      invoice_date: inv.invoice_date,
      due_date: inv.due_date ?? undefined,
      // [BOEK-013] btw_rate does not exist in DB — always calculate
      // [BOEK-FOUNDATION-TYPES] Null-safe btw_rate calculation
      btw_rate: calculateBtwRate(inv.total_ex_btw, inv.btw_amount),
    };
  });

  return NextResponse.json(buildZzpSummary(invoices, year, quarter, mode));
}