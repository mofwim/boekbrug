// src/app/api/kasboek/vergelijk/route.ts
// [KASBOEK-NAAST-KAS] Het kasboek van de boekhouder naast de kas van de app — en, dag voor dag en
// met de hand, het gat dichten.
//
//   1. VERGELIJK — POST multipart/form-data met `file` (het .xlsx/.xls kasboek).
//                  Leest het blad (kasboek-import.ts), telt de kas van dezelfde periode op, en
//                  geeft per dag terug wat er verschilt. Er wordt NIETS geschreven.
//   2. BOEK      — POST application/json { days: [{date, amount, category, description}] }
//                  Schrijft alleen de dagen die de eigenaar heeft aangevinkt, als kasuitgave.
//
// ── WAAROM DIT TWEE STAPPEN IS, EN NOOIT ÉÉN ──
//
// Een echte klant leverde een kwartaalkasboek aan: € 22.377,02 aan contante uitgaven, waarvan de
// app er € 1.402,87 kende. Verleidelijk om het verschil in één druk op de knop te boeken — en
// precies dat mag niet, want de boekhouder schrijft drie betalingen op één regel van € 1.754,35 en
// één daarvan staat er al in via de factuur waarmee ze is voldaan. Klakkeloos overnemen boekt die
// dubbel, een dubbele uitgave VERLAAGT het kassaldo, en niemand vindt het terug omdat allebei de
// regels er correct uitzien.
//
// Dus: de app rekent het verschil uit (dat is aftrekken, geen gok), en de MENS zegt welke dagen
// erin mogen en onder welke categorie. Dat laatste kan de app niet weten: "prive", "salaris" en
// "kosten" komen alle drie voorbij in dezelfde kolom.
//
// ── DE CATEGORIE, EN WAAROM 'betaling' HIER NIET BESTAAT ──
//
// cash.ts houdt drie van de acht categorieën gesloten voor de eigenaar, elk om een eigen reden.
// 'betaling' is de scherpste: die hoort bij een factuur die contant is voldaan en wordt automatisch
// geboekt. Een handmatige 'betaling' heeft geen invoice_id, dus geen reconcile ziet hem, niets
// maakt hem opnieuw en de verwijderknop weigert hem op zijn etiket — een onverwijderbare regel in
// een kasadministratie. Deze deur laat dus exact toe wat /api/cash toelaat, via dezelfde functies.

import { NextRequest, NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { sheetBytesToMatrix } from "@/lib/xlsx-adapter";
import { parseKasboekSheet } from "@/lib/kasboek-import";
import { matchKasboekDays, matchHeadline } from "@/lib/kasboek-match";
import { isCashCategory, closedCashCategoryReason } from "@/lib/cash";
import { round2 } from "@/lib/invoice-totals";
import { logAuditAction } from "@/lib/audit";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";

  // ── 2) BOEK — alleen wat de eigenaar heeft aangevinkt ──────────────────────────────
  if (contentType.includes("application/json")) {
    let body: { days?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
    const days = Array.isArray(body.days) ? body.days : null;
    if (!days || days.length === 0) return NextResponse.json({ error: "geen dagen om te boeken" }, { status: 400 });
    if (days.length > 400) return NextResponse.json({ error: "te veel dagen in één keer (max 400)" }, { status: 400 });

    const records: { user_id: string; entry_date: string; direction: "out"; amount: number; category: string; description: string }[] = [];
    for (const d of days as Array<{ date?: unknown; amount?: unknown; category?: unknown; description?: unknown }>) {
      if (typeof d?.date !== "string" || !ISO_DATE.test(d.date)) {
        return NextResponse.json({ error: `ongeldige datum: ${String(d?.date)}` }, { status: 400 });
      }
      const raw = typeof d.amount === "number" ? d.amount : Number(d.amount);
      // [KAS-CENTEN] Dezelfde behandeling als aan de handmatige deur: een lade wordt in munten
      // geteld, en een sub-cent bedrag wordt geweigerd in plaats van stil € 0,00 te worden.
      if (!Number.isFinite(raw) || raw <= 0) {
        return NextResponse.json({ error: `bedrag moet groter dan 0 zijn (${d.date})` }, { status: 400 });
      }
      const category = d.category;
      if (!isCashCategory(category)) return NextResponse.json({ error: `ongeldige categorie (${d.date})` }, { status: 400 });
      // Dezelfde lijst als /api/cash, via dezelfde functie: twee deuren die hun eigen kopie van
      // deze regel bijhouden, lopen vroeg of laat uiteen — en dan is er één deur waar wél een
      // onverwijderbare regel doorheen komt.
      const closed = closedCashCategoryReason(category);
      if (closed) {
        return NextResponse.json(
          { error: "categorie_gesloten", detail: `De categorie '${String(category)}' kun je niet zelf boeken (${d.date}). Kies Kost, Salaris, Privé of Overboeking.` },
          { status: 400 },
        );
      }
      const description = String(d.description ?? "").trim().slice(0, 300) || "Uit kasboek boekhouder";
      records.push({ user_id: user.id, entry_date: d.date, direction: "out", amount: round2(raw), category, description });
    }

    const { error } = await supabase.from("cash_entries").insert(records);
    if (error) {
      console.error("[KASBOEK-NAAST-KAS] boeken mislukt", { error: error.message });
      return NextResponse.json({ error: "Boeken mislukt. Probeer het opnieuw." }, { status: 500 });
    }

    const totaal = round2(records.reduce((s, r) => s + r.amount, 0));
    await logAuditAction({
      userId: user.id,
      action: "kasboek.gap_booked",
      entityType: "cash_entry",
      entityId: user.id,
      newValue: { days: records.length, total: totaal, from: records[0].entry_date, to: records[records.length - 1].entry_date },
    }).catch(() => {});

    return NextResponse.json({ ok: true, booked: records.length, total: totaal });
  }

  // ── 1) VERGELIJK — lezen en naast elkaar leggen, zonder iets te schrijven ───────────
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "geen bestand ontvangen" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "bestand is te groot" }, { status: 400 });

  let kasboek;
  try {
    kasboek = parseKasboekSheet(sheetBytesToMatrix(new Uint8Array(await file.arrayBuffer())));
  } catch {
    return NextResponse.json({ error: "Dit bestand konden we niet openen als spreadsheet." }, { status: 400 });
  }
  if (!kasboek || kasboek.rows.length === 0) {
    return NextResponse.json(
      {
        error: "geen_kasboek",
        detail:
          "Dit blad herkennen we niet als kasboek. We zoeken een tabel met per dag een beginsaldo, " +
          "uitgaven, ontvangsten en een eindsaldo — de vorm die je boekhouder gebruikt.",
      },
      { status: 400 },
    );
  }

  const from = kasboek.rows[0].date;
  const to = kasboek.rows[kasboek.rows.length - 1].date;

  // De kas van dezelfde periode. [PAGINATION] Pagineren: een kwartaal van een winkel loopt langs
  // de ~1000-rijengrens, en een afgekapte lezing zou uitgaven als "ontbrekend" melden die er wél
  // staan — waarna de eigenaar ze een tweede keer boekt. Precies de fout die dit scherm voorkomt.
  const cashRows = await fetchAllRows<{ entry_date: string | null; direction: string | null; amount: number | null }>(
    (lo, hi) =>
      supabase
        .from("cash_entries")
        .select("entry_date, direction, amount")
        .eq("user_id", user.id)
        .gte("entry_date", from)
        .lte("entry_date", to)
        .order("id", { ascending: true })
        .range(lo, hi),
  ).catch(() => null);

  if (cashRows === null) {
    // Zonder de kas is er niets om naast te leggen, en "alles ontbreekt" over een mislukte lezing
    // zou de eigenaar zijn hele kasboek dubbel laten boeken. Weigeren is hier het enige juiste.
    return NextResponse.json({ error: "kas_onleesbaar", detail: "We konden je kasboekingen nu niet lezen. Probeer het zo opnieuw." }, { status: 503 });
  }

  const turnoverRows = await fetchAllRows<{ turnover_date: string | null; cash_amount: number | null }>(
    (lo, hi) =>
      supabase
        .from("daily_turnover")
        .select("turnover_date, cash_amount")
        .eq("user_id", user.id)
        .gte("turnover_date", from)
        .lte("turnover_date", to)
        .order("turnover_date", { ascending: true })
        .range(lo, hi),
  ).catch(() => []);

  const spent = new Map<string, number>();
  for (const r of cashRows) {
    if (!r.entry_date || r.direction !== "out") continue;
    const d = r.entry_date.slice(0, 10);
    spent.set(d, round2((spent.get(d) ?? 0) + Math.abs(Number(r.amount) || 0)));
  }
  const received = new Map<string, number>();
  for (const r of turnoverRows) {
    if (!r.turnover_date) continue;
    const d = r.turnover_date.slice(0, 10);
    received.set(d, round2((received.get(d) ?? 0) + (Number(r.cash_amount) || 0)));
  }

  const { days, summary } = matchKasboekDays(kasboek.rows, { spent, received });

  return NextResponse.json({
    ok: true,
    period: { from, to },
    openingBalance: kasboek.openingBalance,
    closingBalance: kasboek.closingBalance,
    totals: { fileReceived: kasboek.totalReceived, fileSpent: kasboek.totalSpent },
    headline: matchHeadline(summary),
    summary,
    // Alleen de dagen die iets te zeggen hebben. De gelijke staan in `summary.equalDays` — het
    // getal dat vertrouwen geeft in de rest, zonder een lijst van 91 regels waar niemand doorheen komt.
    days: days.filter((d) => d.verdict !== "gelijk"),
    // De waarschuwingen van het blad zelf: een regel die niet optelt, of een keten die breekt.
    warnings: kasboek.warnings.map((w) => w.message),
  });
}
