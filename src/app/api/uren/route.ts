// src/app/api/uren/route.ts
// [UREN] De uren van de ondernemer — lezen, opschrijven, bijstellen, weggooien.
//
//   GET    /api/uren?all=1   → de uren (standaard alleen de nog niet gefactureerde), nieuwste eerst
//   POST   /api/uren         → één uur opschrijven
//   PATCH  /api/uren         → één uur bijstellen — alleen zolang het NIET op een factuur staat
//   DELETE /api/uren?id=…    → één uur weggooien — zelfde voorwaarde
//
// DE REGEL DIE OVERAL TERUGKOMT
//
// Een uur dat op een factuur staat is geen invoerveld meer. De klant heeft dat document, en de
// regel erop is een bewering over wat er gedaan is. Wie het uur eronder achteraf verandert, maakt
// een factuur die niet meer klopt met zijn eigen onderbouwing — en art. 52 AWR verwacht dat die
// onderbouwing er nog is. Vandaar `.is('invoice_id', null)` bij ELKE schrijfactie: niet als
// beleefdheid, maar omdat de database dan het antwoord geeft in plaats van wij.
//
// Wil de ondernemer zo'n uur toch veranderen, dan gooit hij het concept weg: dan geeft
// ON DELETE SET NULL het uur terug (tests/sql/time_entries.test.sql bewijst dat), en staat het
// weer gewoon in de lijst.
//
// WIENS UREN
//
// Van de ADMINISTRATIE (ownerId), net als facturen, klanten en de artikelencatalogus. Dat is geen
// detail: factureert de eigenaar zijn uren, dan zoekt /api/invoice/draft ze op onder ownerId, en
// uren die onder een medewerker-id staan zouden daar onvindbaar zijn — opgeschreven, en nooit
// gefactureerd. Precies het lek dat deze functie dicht.
//
// [TAAL] Every sentence this route answers with comes from messages.ts, in the language of the
// person typing (their cookie — an accountant acting for an owner reads their own language). The
// sentences used to be Dutch literals here, and the screen shows a server sentence as it is, so an
// Arabic owner read Dutch in a toast the moment they left a field blank. The `code` travels with
// the sentence for anything that wants to decide rather than display.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { getActingFor } from "@/lib/acting-for-server";
import { invoiceOwnerId, isActingForOther } from "@/lib/acting-for";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { normalizeTimeEntryInput, MAX_HOURS_PER_ENTRY, type TimeEntryRefusal } from "@/lib/uren";
import { UREN_REFUSAL_KEY } from "@/lib/uren-refusal";
import { serverTranslator } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/t";

export const dynamic = "force-dynamic";

/** What the owner reads when an hour could not be saved. Each sentence names one field. */
function refusalSentence(t: Translator, code: TimeEntryRefusal): string {
  return t(UREN_REFUSAL_KEY[code], { max: MAX_HOURS_PER_ENTRY });
}

// [DECLARABEL] `billable` travels with every row: the screen shows own time apart, and a client
// that cannot see the column would show acquisition hours as billable work waiting for an invoice.
const COLUMNS = "id, client_id, worked_on, description, hours, hourly_rate, invoice_id, created_at, billable";

/** De ingelogde ondernemer, de administratie waar dit onder valt, en de juiste client. */
async function context() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const acting = await getActingFor();
  if (!acting) return null;
  const t = await serverTranslator();
  const ownerId = invoiceOwnerId(acting);
  // Zelfde afweging als in /api/articles: time_entries heeft één RLS-policy (user_id = auth.uid())
  // en die kent geen medewerker. Handelt iemand NAMENS de administratie, dan is de RLS-client de
  // verkeerde deur en wordt de afscherming expliciet: `.eq('user_id', ownerId)`, waarbij ownerId
  // alleen verschuift bij een geldige, niet-ingetrokken koppeling ([RLS-UIT]).
  const db = isActingForOther(acting) ? createPipelineClient() : supabase;
  return { db, ownerId, actorId: acting.actorId, t };
}

export async function GET(req: NextRequest) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: (await serverTranslator())("uren.fout.nietIngelogd"), code: "unauthorized" }, { status: 401 });

  const all = req.nextUrl.searchParams.get("all") === "1";
  let q = ctx.db
    .from("time_entries")
    .select(COLUMNS)
    .eq("user_id", ctx.ownerId)
    .order("worked_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (!all) q = q.is("invoice_id", null);

  const { data, error } = await q;
  // [NO-SILENT-EMPTY] Een leesfout is GEEN lege urenlijst. Zou dit stil `[]` teruggeven, dan ziet
  // de ondernemer "je hebt niets openstaan" op het moment dat de database eruit ligt — en dat is
  // het ene bericht waarop hij nooit had moeten vertrouwen.
  if (error) {
    console.error("[UREN] uren lezen mislukt", { error });
    return NextResponse.json({ error: ctx.t("uren.fout.laden"), code: "load_failed" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, entries: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: (await serverTranslator())("uren.fout.nietIngelogd"), code: "unauthorized" }, { status: 401 });

  const limit = await checkRateLimit({
    userId: ctx.actorId, endpoint: "/api/uren", ...RATE_LIMITS.UREN_WRITE,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  const body = await req.json().catch(() => null);
  const parsed = normalizeTimeEntryInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: refusalSentence(ctx.t, parsed.code), code: parsed.code }, { status: 400 });
  }

  // [WERK-3] work_item_id is newer than the generated types; an hour written from the work screen
  // carries it, and the column is nullable so every other caller is unchanged.
  const { work_item_id, ...entry } = parsed.entry;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db as any)
    .from("time_entries")
    .insert({ ...entry, user_id: ctx.ownerId, ...(work_item_id ? { work_item_id } : {}) })
    .select(COLUMNS)
    .single();

  if (error || !data) {
    // De klant-verwijzing is het enige veld dat de database kan afkeuren terwijl deze route hem
    // goedkeurde: een client_id van iemand anders bestaat wel, maar niet hier.
    console.error("[UREN] uur opslaan mislukt", { error });
    return NextResponse.json({ error: ctx.t("uren.fout.opslaan"), code: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, entry: data });
}

export async function PATCH(req: NextRequest) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: (await serverTranslator())("uren.fout.nietIngelogd"), code: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = body && typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: ctx.t("uren.fout.welkUur"), code: "missing_id" }, { status: 400 });

  const parsed = normalizeTimeEntryInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: refusalSentence(ctx.t, parsed.code), code: parsed.code }, { status: 400 });
  }

  // The work an hour belongs to is set from the work screen, never changed from here.
  const { work_item_id: _ignored, ...entry } = parsed.entry; // eslint-disable-line @typescript-eslint/no-unused-vars
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.db as any)
    .from("time_entries")
    .update({ ...entry, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", ctx.ownerId)
    // Zie de kop: een gefactureerd uur is geen invoerveld meer.
    .is("invoice_id", null)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[UREN] uur bijwerken mislukt", { error });
    return NextResponse.json({ error: ctx.t("uren.fout.aanpassen"), code: "update_failed" }, { status: 500 });
  }
  // Nul rijen betekent hier iets specifieks, en de ondernemer hoort WELKE van de twee het is —
  // "er ging iets mis" laat iemand achter die zijn wijziging kwijt is en niet weet waarom.
  if (!data) {
    return NextResponse.json(
      { error: ctx.t("uren.fout.alGefactureerdAanpassen"), code: "already_billed" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, entry: data });
}

export async function DELETE(req: NextRequest) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: (await serverTranslator())("uren.fout.nietIngelogd"), code: "unauthorized" }, { status: 401 });

  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: ctx.t("uren.fout.welkUur"), code: "missing_id" }, { status: 400 });

  const { data, error } = await ctx.db
    .from("time_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.ownerId)
    .is("invoice_id", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[UREN] uur verwijderen mislukt", { error });
    return NextResponse.json({ error: ctx.t("uren.fout.verwijderenMislukt"), code: "delete_failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: ctx.t("uren.fout.alGefactureerdVerwijderen"), code: "already_billed" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, id: data.id });
}
