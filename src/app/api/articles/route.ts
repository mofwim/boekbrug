// src/app/api/articles/route.ts
// [ARTIKELEN] The line-item catalog — list + create. User-scoped (RLS server client).
//   GET  /api/articles?all=1   → the owner's articles (actives only unless all=1),
//                                 most-used first. The invoice picker ranks client-side
//                                 via matchArticles; the manage page lists them.
//   POST /api/articles         → create one (validated by normalizeArticleInput).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { normalizeArticleInput } from "@/lib/articles";
// [ACTING-FOR] De artikelencatalogus hoort bij het BEDRIJF, niet bij de mens achter het toetsenbord.
// Zonder dit zag een verkoopmedewerker een LEGE suggestielijst en typte hij elke regel met de
// hand — precies het probleem dat deze catalogus oplost, alleen dan voor de verkeerde persoon.
// Hij en zijn werkgever factureren uit dezelfde lijst; dat is de bedoeling.
import { getActingFor } from "@/lib/acting-for-server";
import { invoiceOwnerId } from "@/lib/acting-for";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { isActingForOther } from "@/lib/acting-for";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const acting = await getActingFor();
  if (!acting) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const ownerId = invoiceOwnerId(acting);
// [ACTING-FOR] Waarom service_role zodra er NAMENS iemand wordt gehandeld: articles heeft geen
// RLS-policy voor een medewerker (die zou een derde migratie kosten, en die staat nog niet op de
// database van de gebruiker). De scoping blijft expliciet en even strak: `.eq("user_id", ownerId)`,
// waarbij ownerId alleen een andere waarde krijgt bij een geldige, niet-ingetrokken koppeling —
// getActingFor() is daar de enige bron van. Een policy is op termijn netter; dit is nu correct.
const dbVoor = (namens: boolean) => (namens ? createPipelineClient() : supabase);

  const includeArchived = req.nextUrl.searchParams.get("all") === "1";
  let q = dbVoor(isActingForOther(acting))
    .from("articles")
    .select("id, code, description, unit_price, btw_rate, unit, active, usage_count")
    .eq("user_id", ownerId)
    .order("usage_count", { ascending: false })
    .order("description", { ascending: true });
  if (!includeArchived) q = q.eq("active", true);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: "Kon de catalogus niet laden." }, { status: 500 });
  return NextResponse.json({ ok: true, articles: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const acting = await getActingFor();
  if (!acting) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const ownerId = invoiceOwnerId(acting);
// [ACTING-FOR] Waarom service_role zodra er NAMENS iemand wordt gehandeld: articles heeft geen
// RLS-policy voor een medewerker (die zou een derde migratie kosten, en die staat nog niet op de
// database van de gebruiker). De scoping blijft expliciet en even strak: `.eq("user_id", ownerId)`,
// waarbij ownerId alleen een andere waarde krijgt bij een geldige, niet-ingetrokken koppeling —
// getActingFor() is daar de enige bron van. Een policy is op termijn netter; dit is nu correct.
const dbVoor = (namens: boolean) => (namens ? createPipelineClient() : supabase);

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Ongeldige gegevens." }, { status: 400 }); }

  const norm = normalizeArticleInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });

  const { data, error } = await dbVoor(isActingForOther(acting))
    .from("articles")
    .insert({ user_id: ownerId, ...norm.value })
    .select("id, code, description, unit_price, btw_rate, unit, active, usage_count")
    .single();

  if (error) {
    // 23505 = unique_violation on (user_id, code): the owner already uses this code.
    if (error.code === "23505") {
      return NextResponse.json({ error: `Code "${norm.value.code}" is al in gebruik.` }, { status: 409 });
    }
    return NextResponse.json({ error: "Kon het artikel niet opslaan." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, article: data });
}
