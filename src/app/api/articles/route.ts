// src/app/api/articles/route.ts
// [ARTIKELEN] The line-item catalog — list + create. User-scoped (RLS server client).
//   GET  /api/articles?all=1   → the owner's articles (actives only unless all=1),
//                                 most-used first. The invoice picker ranks client-side
//                                 via matchArticles; the manage page lists them.
//   POST /api/articles         → create one (validated by normalizeArticleInput).

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { normalizeArticleInput } from "@/lib/articles";

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const includeArchived = req.nextUrl.searchParams.get("all") === "1";
  let q = supabase
    .from("articles")
    .select("id, code, description, unit_price, btw_rate, unit, active, usage_count")
    .eq("user_id", user.id)
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

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Ongeldige gegevens." }, { status: 400 }); }

  const norm = normalizeArticleInput(body);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });

  const { data, error } = await supabase
    .from("articles")
    .insert({ user_id: user.id, ...norm.value })
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
