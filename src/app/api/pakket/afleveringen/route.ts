// src/app/api/pakket/afleveringen/route.ts
// [PAKKET-AFDRUK] Welke versies van dit kwartaalpakket je boekhouder heeft opgehaald, en wat er
// tussen twee ophalingen veranderde.
//
// package_deliveries legt elke download vast; dit is de kant waar de eigenaar hem leest. Zonder
// deze route bestond de select-policy voor een lezer die er niet was: de afdruk werd bewaard, de
// eigenaar kreeg één melding op het moment zelf, en de vraag die een boekhouder acht maanden later
// stelt — "welke versie had ik toen?" — kon alleen in de database worden beantwoord.
//
// Sessieclient, dus RLS is de grens: package_deliveries_select_own laat een eigenaar precies zijn
// eigen afdrukken zien en verder niets. Geen service_role, geen eigenaarsresolutie, geen tweede
// plek die kan afwijken van de policy.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { driftBetween, driftSentence, type PackageContent } from "@/lib/package-fingerprint";
import { isMissingRelation } from "@/lib/pg-missing";

export const dynamic = "force-dynamic";

interface Rij {
  id: string;
  delivered_at: string;
  fingerprint: string;
  outgoing_count: number;
  incoming_count: number;
  files_included: number;
  invoices_with_pdf: number;
  bank_statement_included: boolean;
  missing_evidence: string[] | null;
  warning_codes: string[] | null;
}

const inhoudVan = (r: Rij): PackageContent => ({
  outgoingCount: r.outgoing_count,
  incomingCount: r.incoming_count,
  filesIncluded: r.files_included,
  invoicesWithPdf: r.invoices_with_pdf,
  bankStatementIncluded: r.bank_statement_included,
  missingEvidence: r.missing_evidence ?? [],
  warningCodes: r.warning_codes ?? [],
});

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const year = Number(req.nextUrl.searchParams.get("year"));
  const quarter = Number(req.nextUrl.searchParams.get("quarter"));
  if (!Number.isInteger(year) || ![1, 2, 3, 4].includes(quarter)) {
    return NextResponse.json({ error: "Ongeldige periode" }, { status: 400 });
  }

  let rijen: Rij[];
  try {
    // [VOL-GELEZEN] Gepagineerd met een totale ordening: delivered_at is niet uniek (twee
    // downloads binnen één seconde is ongewoon maar niet onmogelijk), en id erachter maakt de
    // volgorde totaal. Oudste eerst, want de vergelijking loopt vooruit in de tijd.
    rijen = await fetchAllRows<Rij>((from, to) =>
      // package_deliveries staat niet in de gegenereerde types (handmatig toegepaste migratie) —
      // dezelfde versoepelde cast die cron_runs, btw_filings en push_subscriptions gebruiken.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
      .from("package_deliveries")
      .select("id, delivered_at, fingerprint, outgoing_count, incoming_count, files_included, invoices_with_pdf, bank_statement_included, missing_evidence, warning_codes")
      .eq("user_id", user.id).eq("year", year).eq("quarter", quarter)
      .order("delivered_at", { ascending: true }).order("id", { ascending: true })
      .range(from, to));
  } catch (e) {
    const bericht = e instanceof Error ? e.message : String(e);
    // [DEPLOY-SAFE] De tabel kan er nog niet zijn. Dat is "er zijn nog geen afleveringen", en dat
    // is precies waar dit scherm dan ook uitkomt — geen storing.
    if (isMissingRelation(bericht)) return NextResponse.json({ afleveringen: [] });
    // [NO-SILENT-EMPTY] Anders NIET als een lege lijst doorgeven: "je boekhouder heeft dit pakket
    // nooit opgehaald" is een bewering, en die mag nooit uit een mislukte lezing komen — juist op
    // het scherm waar de eigenaar controleert of de overdracht is aangekomen.
    console.error("[PAKKET-AFDRUK] afleveringen lezen mislukt", { userId: user.id, year, quarter, error: bericht });
    return NextResponse.json({ error: "We konden de ophaalgeschiedenis nu niet lezen." }, { status: 500 });
  }

  const kwartaal = `Q${quarter} ${year}`;
  const afleveringen = rijen.map((r, i) => {
    // Het verschil met de VORIGE aflevering. De eerste heeft er geen, en dat is geen verandering
    // maar een begin — de eerste download als "veranderd" tonen zou de lijst betekenisloos maken.
    const vorige = i > 0 ? rijen[i - 1] : null;
    const drift = vorige ? driftBetween(inhoudVan(vorige), inhoudVan(r)) : null;
    return {
      id: r.id,
      opgehaaldOp: r.delivered_at,
      afdruk: r.fingerprint,
      verkoopfacturen: r.outgoing_count,
      inkoopfacturen: r.incoming_count,
      bestanden: r.files_included,
      metBon: r.invoices_with_pdf,
      bankafschrift: r.bank_statement_included,
      zonderBon: r.missing_evidence ?? [],
      waarschuwingen: r.warning_codes ?? [],
      veranderd: drift?.changed ?? false,
      soort: drift?.kind ?? null,
      vraagtActie: drift?.needsAction ?? false,
      uitleg: vorige && drift ? driftSentence(kwartaal, vorige.delivered_at, drift) : null,
    };
  });

  // Nieuwste eerst op het scherm; de vergelijking is hierboven al gelegd, dus omdraaien kan geen
  // betekenis meer verschuiven.
  afleveringen.reverse();
  return NextResponse.json({ kwartaal, afleveringen });
}
