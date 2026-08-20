// src/app/api/articles/from-vak/route.ts
// [VAK-BRUG] Fill an empty price list with the lines of the owner's trade.
//
//   GET  → the trade we know for this owner, its lines, and its situational BTW warning
//   POST → create the lines the owner priced (and remember the trade on the profile)
//
// ── WHY THE PRICES COME FROM THE REQUEST AND NOT FROM THE TEMPLATE ──
// Rule 1 of vak-sjablonen.ts, and moving into the app does not soften it: "an hourly rate of € 65
// is wrong for everyone except coincidentally one person, and a wrongly prefilled amount that
// slips through is worse than an empty field." So the template supplies the description, the unit
// and the RATE — the three things it can be right about — and the owner supplies the amount. A
// line he leaves blank is simply not created; he is pricing his shop, not filling in a form.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { parseVak, vakArticleSeeds, vakLetOp, vakLabel } from "@/lib/vak-profile";
import { normalizeArticleInput } from "@/lib/articles";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { requireOwner } from "@/lib/owner-only";

export const dynamic = "force-dynamic";

/** Read the owner's stored trade. Tolerant: the column ships before the migration is applied. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readVak(supabase: any, userId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from("profiles").select("vak").eq("id", userId).maybeSingle();
    return parseVak(data?.vak);
  } catch {
    return null; // no column yet → trade unknown, which is the normal state
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  // An explicit ?vak= wins: it is the owner picking a trade in the dropdown, which is a stronger
  // statement than whatever he told the front door months ago. Without it we fall back to the
  // trade he arrived with. Either way the LINES come from here rather than from the client bundle,
  // so the screen and the write below cannot disagree about what a trade contains.
  const asked = parseVak(req.nextUrl.searchParams.get("vak"));
  const vak = asked ?? (await readVak(supabase, user.id));
  return NextResponse.json({
    ok: true,
    vak,
    label: vakLabel(vak),
    // [VAK-SJABLONEN] The most valuable field in that file, by its own account: it exists precisely
    // for the trades where the entrepreneur most often gets the rate wrong. It was shown once, on
    // the public generator, before he had a business here — and never again at the moment he is
    // actually pricing his work. This is that moment.
    letOp: vakLetOp(vak),
    seeds: vakArticleSeeds(vak),
  });
}

interface PricedLine {
  description?: unknown;
  unit?: unknown;
  btw_rate?: unknown;
  unit_price?: unknown;
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  const guard = await requireOwner("Een prijslijst invullen");
  if (guard.response) return guard.response;

  let body: { vak?: unknown; lines?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 }); }

  const vak = parseVak(typeof body.vak === "string" ? body.vak : null);
  if (!vak) return NextResponse.json({ error: "Kies eerst je vak." }, { status: 400 });
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "Vul minstens één prijs in." }, { status: 400 });
  }

  // The template is the authority on description/unit/rate — never the request. A client that sent
  // its own descriptions could quietly write a 9% rate onto work that is taxed at 21%, which is the
  // exact mistake this catalogue exists to prevent. So the request contributes ONE thing per line:
  // the price. Everything else is looked up here, from the same module the screen rendered.
  const seeds = vakArticleSeeds(vak);
  const byDescription = new Map(seeds.map((s) => [s.description, s]));

  const rows: Array<{ user_id: string; code: string | null; description: string; unit_price: number; btw_rate: number; unit: string | null }> = [];
  for (const raw of body.lines as PricedLine[]) {
    const description = typeof raw?.description === "string" ? raw.description : "";
    const seed = byDescription.get(description);
    if (!seed) continue; // a line this trade does not have — ignored, never invented

    const price = Number(raw?.unit_price);
    // An unpriced line is not an error and not a €0 article: it is a line the owner chose not to
    // offer. Creating it would put a button on his counter that rings up nothing.
    if (!Number.isFinite(price) || price <= 0) continue;

    const normalized = normalizeArticleInput({
      code: null,
      description: seed.description,
      unit_price: price,
      btw_rate: seed.btw_rate,
      unit: seed.unit,
    });
    if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });
    // normalizeArticleInput already trimmed `code` to null (a seeded line carries no shortcut —
    // the owner assigns those himself once he knows which lines he reaches for).
    rows.push({ user_id: user.id, ...normalized.value });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "Vul minstens één prijs in." }, { status: 400 });
  }

  const { data, error } = await supabase.from("articles").insert(rows).select("id");
  if (error) return NextResponse.json({ error: "Kon de prijslijst niet opslaan." }, { status: 500 });

  // Remember the trade. Tolerant, and non-blocking on purpose: the price list is the thing the
  // owner asked for and it now exists — failing the whole request because a column is missing on a
  // deployment where profile_vak.sql has not been applied would take away what worked.
  try {
    await supabase.from("profiles").update({ vak }).eq("id", user.id);
  } catch {
    /* no column yet → the catalogue still stands; the trade is simply not remembered */
  }

  await logAuditAction({
    userId: user.id,
    action: "article.seeded_from_vak",
    entityType: "article",
    entityId: user.id,
    newValue: { via: "vak_sjabloon", vak, count: rows.length, descriptions: rows.map((r) => r.description) },
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, created: data?.length ?? rows.length, vak });
}
