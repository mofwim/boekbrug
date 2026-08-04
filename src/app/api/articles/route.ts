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
import { requireOwner } from "@/lib/owner-only";
import { logAuditAction, getClientIP } from "@/lib/audit";

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

/**
 * [ARTIKELEN-WIPE] DELETE /api/articles — empty the catalogue.
 *
 * Deleting thirty articles one tap at a time is not a safety feature, it is a missing one: the
 * owner ends up doing the same destructive thing anyway, thirty times, with thirty chances to hit
 * the wrong row. One deliberate action with one clear confirmation is both faster AND safer.
 *
 * ── WHAT THIS CANNOT BREAK, AND WHY THAT IS WORTH STATING ──
 * Nothing references articles. invoice_lines stores its own description, price and btw-rate — a
 * catalogue entry is a TEMPLATE that was copied at the moment a line was made, never a pointer the
 * invoice reads later. So an invoice sent two years ago keeps every word of what it said, and no
 * aangifte, no total and no accountant's export moves by a cent. That is the one thing an owner
 * emptying a list would rightly worry about, so the client says it in the confirmation.
 *
 * What IS lost is the catalogue itself, including usage_count — the "most used first" ordering
 * starts again from nothing. Real, permanent, and not undoable: there is no soft-delete here
 * (archiving already exists for that, and this route is for the owner who does not want them
 * archived either).
 *
 * ── OWNER ONLY ──
 * The per-article DELETE lets a verkoopmedewerker remove one line, and that is right — they work
 * from this catalogue. Emptying it is a different act: it is a decision about the COMPANY's list,
 * taken once, affecting everyone who invoices from it.
 *
 * Body: { confirm: "ALLES" } — deliberately not a bare DELETE. A route that empties a table on an
 * empty body is one mis-fired fetch away from doing it by accident.
 */
export async function DELETE(req: NextRequest) {
  { const w = await requireOwner('De hele artikelenlijst leegmaken'); if (w.response) return w.response }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== "ALLES") {
    return NextResponse.json({ error: "Bevestiging ontbreekt." }, { status: 400 });
  }

  // Count first, from the same scope the delete uses. It is what the answer reports and what the
  // audit row records — and reading it AFTER the delete would always be zero.
  const { count, error: countErr } = await supabase
    .from("articles")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  // [NO-SILENT-EMPTY] A failed count must not let this proceed reporting "0 verwijderd" over a
  // delete that removed thirty rows. Refuse instead: nothing has happened yet at this point.
  if (countErr) return NextResponse.json({ error: "Kon de lijst niet lezen. Probeer het opnieuw." }, { status: 503 });

  const { error } = await supabase.from("articles").delete().eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Kon de lijst niet leegmaken." }, { status: 500 });

  await logAuditAction({
    userId: user.id,
    action: "article.bulk_deleted",
    entityType: "article",
    entityId: user.id,
    oldValue: { count: count ?? 0 },
    newValue: { count: 0 },
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
