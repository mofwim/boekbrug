// src/app/api/kluis/offerte/route.ts
// [KLUIS] De offerte voor de Bewaarkluis, en de knop die hem afrekent.
//
// GET  → wat het voor DEZE gebruiker kost, berekend uit zijn eigen jongste boekjaar.
// POST → een Stripe-checkout voor precies dat bedrag.
//
// ── WAAROM DE OFFERTE OP DE SERVER WORDT BEREKEND EN NIET MEEGESTUURD ──
// De POST accepteert GEEN bedrag en geen aantal jaren uit de body. Zou hij dat wel doen,
// dan bepaalt de browser wat er wordt afgerekend, en dan koopt iemand zeven bewaarjaren
// voor één. Het aantal jaren wordt hier opnieuw vastgesteld uit de administratie zelf,
// precies zoals de GET het toont — dus wat de klant ziet en wat hij betaalt komen uit
// dezelfde berekening, en die berekening staat op de server.
//
// ── EN WAAROM NUL JAREN EEN 409 IS EN GEEN CHECKOUT VAN NUL EURO ──
// Is de bewaarplicht al verstreken, dan valt er niets te verkopen. Dat is geen randgeval
// om weg te programmeren maar de belofte uit KLUIS_NOOIT: wij vragen nooit geld voor een
// termijn die voorbij is.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { kluisQuote, estimateArchiveMb, formatArchiveSize, KLUIS_GRACE_MONTHS } from "@/lib/bewaarkluis";
import { createKluisCheckoutSession, isKluisBillingConfigured, resolveCustomerId } from "@/lib/billing";

export const dynamic = "force-dynamic";

type Snapshot = {
  /** Het jongste boekjaar waarvan wij stukken hebben; null als er niets is. */
  lastFiscalYear: number | null;
  documentCount: number;
};

/**
 * Wat er in de administratie zit, in twee getallen. Kijkt naar facturen ÉN documenten:
 * een winkel die alleen bonnen uploadt heeft geen enkele factuurregel maar wel degelijk
 * een bewaarplicht.
 */
async function readSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<Snapshot> {
  const [invoices, documents] = await Promise.all([
    fetchAllRows<{ invoice_date: string | null }>((from, to) =>
      supabase
        .from("invoices")
        .select("invoice_date")
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<{ year: number | null; trashed: boolean | null }>((from, to) =>
      supabase
        .from("documents")
        .select("year, trashed")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const levend = documents.filter((d) => !d.trashed);
  const jaren: number[] = [];
  for (const i of invoices) {
    const y = Number(i.invoice_date?.slice(0, 4));
    if (Number.isInteger(y) && y > 1990 && y < 2200) jaren.push(y);
  }
  for (const d of levend) {
    if (Number.isInteger(d.year) && (d.year as number) > 1990) jaren.push(d.year as number);
  }

  return {
    lastFiscalYear: jaren.length > 0 ? Math.max(...jaren) : null,
    documentCount: levend.length,
  };
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const snap = await readSnapshot(supabase, user.id);
  const currentYear = new Date().getUTCFullYear();

  // Nog geen enkel stuk: geen bewaarplicht om over te praten, en dus geen offerte. Eerlijker
  // dan een prijs tonen voor een leeg archief.
  if (snap.lastFiscalYear === null) {
    return NextResponse.json({
      leeg: true,
      gratisMaanden: KLUIS_GRACE_MONTHS,
      uitleg:
        "Er staan nog geen stukken in je administratie, dus er is nog geen bewaarplicht om af te dekken.",
    });
  }

  const quote = kluisQuote(snap.lastFiscalYear, currentYear);
  const mb = estimateArchiveMb(snap.documentCount);

  return NextResponse.json({
    leeg: false,
    lastFiscalYear: snap.lastFiscalYear,
    documentCount: snap.documentCount,
    archiefOmvang: formatArchiveSize(mb),
    gratisMaanden: KLUIS_GRACE_MONTHS,
    ...quote,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  if (!isKluisBillingConfigured()) {
    // Nette 503 in plaats van een fout in het gezicht van de gebruiker: zonder Stripe-sleutel
    // is dit een uitgeschakelde knop, geen storing.
    return NextResponse.json(
      { error: "De Bewaarkluis is nog niet te bestellen. Neem gerust contact op." },
      { status: 503 },
    );
  }

  const snap = await readSnapshot(supabase, user.id);
  if (snap.lastFiscalYear === null) {
    return NextResponse.json(
      { error: "Er staan nog geen stukken in je administratie om te bewaren." },
      { status: 409 },
    );
  }

  const quote = kluisQuote(snap.lastFiscalYear, new Date().getUTCFullYear());
  if (quote.years < 1) {
    return NextResponse.json(
      {
        error:
          "Je bewaarplicht voor deze administratie is al verstreken — je hoeft hier niets voor te betalen.",
      },
      { status: 409 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (supabase as any)
    .from("profiles")
    .select("email, full_name, stripe_customer_id")
    .eq("id", user.id)
    .single();

  const origin = req.nextUrl.origin;
  try {
    const customerId = await resolveCustomerId({
      existingId: profile?.stripe_customer_id ?? null,
      profileId: user.id,
      email: profile?.email ?? user.email ?? null,
      name: profile?.full_name ?? null,
    });

    const session = await createKluisCheckoutSession({
      customerId,
      profileId: user.id,
      years: quote.years,
      successUrl: `${origin}/dashboard/kluis?bewaard=1`,
      cancelUrl: `${origin}/dashboard/kluis?geannuleerd=1`,
    });

    return NextResponse.json({ url: session.url, years: quote.years, totaal: quote.prepayTotalEur });
  } catch (err) {
    console.error("[KLUIS] checkout mislukt:", err);
    return NextResponse.json({ error: "Afrekenen lukte nu niet. Probeer het zo meteen opnieuw." }, { status: 502 });
  }
}
