// src/app/api/articles/[id]/route.ts
// [ARTIKELEN] Update / delete one catalog article. User-scoped (RLS: the WHERE user_id
// guard + own-row policy mean an owner can only touch their own). PATCH revalidates via
// normalizeArticleInput; a `usage_count` bump (when a line is billed) is a separate small
// path. DELETE hard-removes — invoices copied the values, so history is unaffected.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { normalizeArticleInput } from "@/lib/articles";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Ongeldige gegevens." }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;

  // Two supported PATCH shapes: (a) a full edit (validated), or (b) a lightweight
  // {bump:true} that just increments usage_count when the article is billed on a line.
  if (b.bump === true) {
    const { data: cur } = await supabase.from("articles").select("usage_count").eq("id", id).eq("user_id", user.id).single();
    if (!cur) return NextResponse.json({ error: "Artikel niet gevonden." }, { status: 404 });
    const { error } = await supabase.from("articles").update({ usage_count: (cur.usage_count ?? 0) + 1 }).eq("id", id).eq("user_id", user.id);
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

  const { data, error } = await supabase
    .from("articles")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
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

  const { error } = await supabase.from("articles").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Kon niet verwijderen." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
