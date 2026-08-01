// src/app/api/articles/[id]/route.ts
// [ARTIKELEN] Update / delete one catalog article. User-scoped (RLS: the WHERE user_id
// guard + own-row policy mean an owner can only touch their own). PATCH revalidates via
// normalizeArticleInput; a `usage_count` bump (when a line is billed) is a separate small
// path. DELETE hard-removes — invoices copied the values, so history is unaffected.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { normalizeArticleInput } from "@/lib/articles";
// [NAMENS] Zie /api/articles: de catalogus is van het bedrijf. Een medewerker die een artikel
// gebruikt bumpt de teller van datzelfde artikel — anders leert de suggestielijst niets van wat
// hij factureert, terwijl hij wél uit die lijst kiest.
import { getActingFor } from "@/lib/acting-for-server";
import { factuurEigenaar } from "@/lib/acting-for";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { isNamens } from "@/lib/acting-for";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const acting = await getActingFor();
  if (!acting) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const ownerId = factuurEigenaar(acting);
// [NAMENS] Waarom service_role zodra er NAMENS iemand wordt gehandeld: articles heeft geen
// RLS-policy voor een medewerker (die zou een derde migratie kosten, en die staat nog niet op de
// database van de gebruiker). De scoping blijft expliciet en even strak: `.eq("user_id", ownerId)`,
// waarbij ownerId alleen een andere waarde krijgt bij een geldige, niet-ingetrokken koppeling —
// getActingFor() is daar de enige bron van. Een policy is op termijn netter; dit is nu correct.
const dbVoor = (namens: boolean) => (namens ? createPipelineClient() : supabase);

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Ongeldige gegevens." }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;

  // Two supported PATCH shapes: (a) a full edit (validated), or (b) a lightweight
  // {bump:true} that just increments usage_count when the article is billed on a line.
  if (b.bump === true) {
    const { data: cur } = await dbVoor(isNamens(acting)).from("articles").select("usage_count").eq("id", id).eq("user_id", ownerId).single();
    if (!cur) return NextResponse.json({ error: "Artikel niet gevonden." }, { status: 404 });
    const { error } = await dbVoor(isNamens(acting)).from("articles").update({ usage_count: (cur.usage_count ?? 0) + 1 }).eq("id", id).eq("user_id", ownerId);
    if (error) return NextResponse.json({ error: "Kon niet bijwerken." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Full edit — allow toggling `active` alongside the validated fields.
  const norm = normalizeArticleInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
  const patch = {
    ...norm.value,
    updated_at: new Date().toISOString(),
    ...(typeof b.active === "boolean" ? { active: b.active } : {}),
  };

  const { data, error } = await dbVoor(isNamens(acting))
    .from("articles")
    .update(patch)
    .eq("id", id)
    .eq("user_id", ownerId)
    .select("id, code, description, unit_price, btw_rate, unit, active, usage_count")
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: `Code "${norm.value.code}" is al in gebruik.` }, { status: 409 });
    return NextResponse.json({ error: "Kon niet bijwerken." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Artikel niet gevonden." }, { status: 404 });
  return NextResponse.json({ ok: true, article: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const acting = await getActingFor();
  if (!acting) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const ownerId = factuurEigenaar(acting);
// [NAMENS] Waarom service_role zodra er NAMENS iemand wordt gehandeld: articles heeft geen
// RLS-policy voor een medewerker (die zou een derde migratie kosten, en die staat nog niet op de
// database van de gebruiker). De scoping blijft expliciet en even strak: `.eq("user_id", ownerId)`,
// waarbij ownerId alleen een andere waarde krijgt bij een geldige, niet-ingetrokken koppeling —
// getActingFor() is daar de enige bron van. Een policy is op termijn netter; dit is nu correct.
const dbVoor = (namens: boolean) => (namens ? createPipelineClient() : supabase);

  const { error } = await dbVoor(isNamens(acting)).from("articles").delete().eq("id", id).eq("user_id", ownerId);
  if (error) return NextResponse.json({ error: "Kon niet verwijderen." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
