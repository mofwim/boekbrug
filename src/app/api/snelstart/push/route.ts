// app/api/snelstart/push/route.ts
// [SNELSTART] Facturen als boeking naar SnelStart sturen — juli 2026
//
// POST /api/snelstart/push
//   body: { invoiceIds?: string[] }            → precies deze facturen
//         { year: 2026, quarter: 2 }           → alles uit dat kwartaal
//         {}                                   → alles wat klaarstaat (tot MAX_PER_RUN)
//   → { pushed, failed, remaining, results[] }
//
// Drie regels die deze route boekhoudkundig veilig maken:
//
//  1. IDEMPOTENT. Een factuur die al een geslaagde boeking heeft, gaat nooit nog een keer.
//     Het slot ligt in de database (partiële unique index op snelstart_exports), niet in
//     deze code — dan houdt het ook bij twee gelijktijdige verzoeken stand.
//  2. PER FACTUUR AFREKENEN. Elke factuur krijgt een eigen rij in het duw-logboek: gelukt
//     met het SnelStart-id, of mislukt met de reden. Een halve batch laat dus geen
//     schemerzone achter over "wat is er nu eigenlijk geboekt?".
//  3. STOPPEN BIJ EEN SLEUTELFOUT. Wordt de maatwerksleutel afgewezen, dan heeft
//     doorgaan geen zin: de koppeling gaat op needs_reauth en de rest blijft gewoon
//     klaarstaan voor later.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { logAuditAction, getClientIP } from "@/lib/audit";
import {
  createSnelStartClient,
  dutchSnelStartError,
  SnelStartError,
  type SnelStartBtwTarief,
} from "@/lib/snelstart-client";
import {
  getSnelStartConnection,
  markSnelStartNeedsReauth,
  recordSnelStartPushResult,
} from "@/lib/snelstart-connection";
import {
  loadInvoiceLines,
  loadPushCandidates,
  loadPushedInvoiceIds,
  quarterRange,
} from "@/lib/snelstart-queue";
import {
  dutchMappingError,
  mapInvoiceToBoeking,
  relatieSoortFor,
  SnelStartMappingError,
  type SnelStartInvoice,
} from "@/lib/snelstart-mapping";
// [SNELSTART-CLAIM] De regel die beslist of een mislukking de claim vrijgeeft of laat staan.
import { claimStatusAfterFailure, unknownOutcomeMessage } from "@/lib/snelstart-claim";

// Elke factuur is minstens één (soms twee) HTTP-ronde naar SnelStart. 100 per aanroep
// past ruim binnen maxDuration en houdt een kwartaal in één of twee klikken haalbaar.
const MAX_PER_RUN = 100;

export const maxDuration = 300;

interface PushResult {
  invoiceId: string;
  invoiceNumber: string | null;
  status: "pushed" | "failed";
  snelstartId?: string | null;
  error?: string;
  code?: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/snelstart/push",
    ...RATE_LIMITS.SNELSTART_PUSH,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  let body: { invoiceIds?: unknown; year?: unknown; quarter?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {}; // lege body = "stuur alles wat klaarstaat"
  }

  const invoiceIds = Array.isArray(body.invoiceIds)
    ? body.invoiceIds.filter((v): v is string => typeof v === "string").slice(0, MAX_PER_RUN)
    : undefined;

  let window: { from?: string; to?: string } = {};
  if (typeof body.year === "number" && typeof body.quarter === "number") {
    if (body.quarter < 1 || body.quarter > 4 || body.year < 2000 || body.year > 2100) {
      return NextResponse.json({ error: "Ongeldig kwartaal" }, { status: 400 });
    }
    window = quarterRange(body.year, body.quarter);
  }

  const conn = await getSnelStartConnection(user.id);
  if (!conn) {
    return NextResponse.json(
      { error: "Koppel eerst je SnelStart-administratie." },
      { status: 404 },
    );
  }
  if (conn.meta.status === "needs_reauth") {
    return NextResponse.json(
      {
        error:
          "SnelStart accepteert je maatwerksleutel niet meer. Maak een nieuwe sleutel aan en koppel opnieuw.",
        code: "INVALID_KEY",
      },
      { status: 409 },
    );
  }
  if (!conn.meta.inkoopGrootboekId || !conn.meta.verkoopGrootboekId) {
    return NextResponse.json(
      {
        error:
          "Kies eerst op welke grootboekrekeningen inkoop en verkoop geboekt moeten worden.",
        code: "NO_GROOTBOEK",
      },
      { status: 409 },
    );
  }

  // ── Wat gaat er mee ──────────────────────────────────────────────────────────
  const [candidates, pushedIds] = await Promise.all([
    loadPushCandidates(supabase, user.id, { invoiceIds, ...window }),
    loadPushedInvoiceIds(supabase, user.id),
  ]);

  // Oudste eerst: een administratie loopt chronologisch, en bij een halve batch is
  // "alles t/m datum X is geboekt" een begrijpelijker toestand dan een willekeurig gat.
  const todo = candidates
    .filter((c) => !pushedIds.has(c.id))
    .sort((a, b) => (a.invoice_date ?? "").localeCompare(b.invoice_date ?? ""));

  const batch = todo.slice(0, MAX_PER_RUN);
  const remainingAfter = todo.length - batch.length;

  if (batch.length === 0) {
    return NextResponse.json({ pushed: 0, failed: 0, remaining: 0, results: [] });
  }

  const linesByInvoice = await loadInvoiceLines(
    supabase,
    batch.map((i) => i.id),
  );

  const client = createSnelStartClient({ clientKey: conn.clientKey });
  const pipeline = createPipelineClient();

  // BTW-tarieven één keer per batch: ze zijn per administratie gelijk voor alle facturen.
  let tarieven: SnelStartBtwTarief[];
  try {
    tarieven = await client.getBtwTarieven();
  } catch (err) {
    return await abortWithSnelStartError(err, user.id);
  }

  const relatieCache = new Map<string, string>();
  const results: PushResult[] = [];
  let stopped: { error: string; code: string } | null = null;

  for (const invoice of batch) {
    // [DEPLOY-SAFE] Buiten de try, zodat de catch weet of er een claim-regel bestaat om af te ronden.
    let claimSupported = true;
    try {
      const soort = relatieSoortFor(invoice.direction);
      const naam = (invoice.client_name ?? "").trim();
      const cacheKey = `${soort}:${naam.toLowerCase()}`;

      let relatieId = relatieCache.get(cacheKey);
      if (!relatieId) {
        // Bestaat de relatie al in SnelStart, dan gebruiken we die — nieuwe aanmaken zou
        // dezelfde leverancier dubbel in het relatiebestand zetten.
        const found = await client.findRelatie(naam, soort);
        relatieId = found?.id ?? (await client.createRelatie(naam, soort)).id;
        relatieCache.set(cacheKey, relatieId);
      }

      const grootboekId =
        invoice.direction === "incoming"
          ? (conn.meta.inkoopGrootboekId as string)
          : (conn.meta.verkoopGrootboekId as string);

      const mapped = mapInvoiceToBoeking({
        invoice,
        lines: linesByInvoice.get(invoice.id) ?? [],
        tarieven,
        grootboekId,
        relatieId,
      });

      // [SNELSTART-CLAIM] Eerst het slot, dan pas de deur.
      //
      // De POST hieronder is ONOMKEERBAAR — hij landt in het wettelijke inkoop-/verkoopboek van
      // de boekhouder. Het slot stond hier vroeger ERNA, en in dat gat past een tweede verzoek
      // (tweede tabblad, dubbelklik, herhaling na time-out): beide lezen de wachtrij vóórdat de
      // ander zijn regel schreef, beide posten dezelfde factuur, en dezelfde inkoopfactuur staat
      // twee keer in de boekhouding van de klant — zonder dat iemand reden heeft dat te vermoeden.
      //
      // We claimen daarom vooraf met status 'unknown'. Krijgt deze insert 23505, dan houdt een
      // ander verzoek deze factuur al onder handen en posten wij niet.
      const claimed = await claimExport(pipeline, {
        userId: user.id,
        invoice,
        boekingType: mapped.type,
        relatieId,
        amount: mapped.amount,
      });
      claimSupported = claimed !== "unsupported";
      if (claimed === "taken") {
        console.warn("[SNELSTART] factuur al geclaimd door een ander verzoek — niet nogmaals geboekt", {
          invoiceId: invoice.id,
        });
        continue;
      }

      const created = await client.postBoeking(mapped.type, mapped.payload);

      if (claimed === "claimed") {
        // Gelukt: dezelfde claim-regel wordt de definitieve boekingsregel. Geen tweede rij, dus
        // het slot blijft de hele tijd dicht.
        await settleClaim(pipeline, user.id, invoice.id, {
          status: "pushed",
          snelstartId: created.id,
        });
      } else {
        // [DEPLOY-SAFE] Migratie nog niet toegepast → het oude pad: de regel wordt nu pas
        // geschreven. Zie claimExport voor waarom dit de minst slechte tussenstand is.
        await pipeline.from("snelstart_exports").insert({
          user_id: user.id,
          invoice_id: invoice.id,
          direction: invoice.direction === "incoming" ? "incoming" : "outgoing",
          boeking_type: mapped.type,
          snelstart_id: created.id,
          snelstart_relatie_id: relatieId ?? null,
          status: "pushed",
          amount: mapped.amount ?? null,
        });
      }

      results.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        status: "pushed",
        snelstartId: created.id,
      });
    } catch (err) {
      const { code, message } = describeFailure(err);

      // [SNELSTART-CLAIM] Weten we ZEKER dat er niets is geboekt, of weten we het niet?
      // Bij 'failed' gaat de claim vrij en mag de factuur opnieuw mee. Bij 'unknown' blijft hij
      // staan: de POST kán zijn aangekomen en alleen het antwoord verloren zijn gegaan, en dan
      // zou opnieuw boeken een tweede regel in andermans grootboek zetten. Welke code welke kant
      // op gaat, staat in snelstart-claim.ts en is daar getest — met 'unknown' als faalrichting.
      const outcome = claimStatusAfterFailure(code);
      // [DEPLOY-SAFE] Zonder de migratie bestaat er geen claim-regel om af te ronden (en zou
      // 'unknown' de CHECK schenden). Dan blijft het oude gedrag staan: de mislukking wordt
      // gewoon als 'failed' vastgelegd, precies zoals voorheen.
      if (claimSupported) {
        await settleClaim(pipeline, user.id, invoice.id, {
          status: outcome,
          errorCode: code,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      } else {
        await pipeline.from("snelstart_exports").insert({
          user_id: user.id,
          invoice_id: invoice.id,
          direction: invoice.direction === "incoming" ? "incoming" : "outgoing",
          boeking_type: invoice.direction === "incoming" ? "inkoopboeking" : "verkoopboeking",
          status: "failed",
          error_code: code,
          error_message: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        });
      }

      results.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        status: "failed",
        // Bij een onbekende afloop mag er niet "mislukt" staan — dat is een bewering die we niet
        // kunnen doen. De gebruiker krijgt de zin die wél waar is: controleer het in SnelStart.
        error: outcome === "unknown" ? unknownOutcomeMessage(invoice.invoice_number) : message,
        code,
      });

      // Sleutel- of snelheidsfouten gelden voor de hele batch: doorgaan levert alleen
      // maar meer identieke mislukkingen op.
      if (err instanceof SnelStartError) {
        if (err.code === "INVALID_KEY" || err.code === "FORBIDDEN") {
          await markSnelStartNeedsReauth(user.id, err.message);
          stopped = { error: message, code: err.code };
          break;
        }
        if (err.code === "RATE_LIMITED" || err.code === "SERVER" || err.code === "NETWORK") {
          stopped = { error: message, code: err.code };
          break;
        }
      }
    }
  }

  const pushed = results.filter((r) => r.status === "pushed").length;
  const failed = results.length - pushed;
  const notAttempted = batch.length - results.length;

  await recordSnelStartPushResult(user.id, stopped?.error ?? (failed > 0 ? "Niet alles kon geboekt worden" : null));

  await logAuditAction({
    userId: user.id,
    action: "snelstart.pushed",
    entityType: "snelstart_connection",
    entityId: conn.meta.id,
    newValue: { pushed, failed, batch: batch.length },
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({
    pushed,
    failed,
    remaining: remainingAfter + notAttempted,
    stopped: stopped ?? undefined,
    results,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────

/**
 * [SNELSTART-CLAIM] De factuur claimen VÓÓR de onomkeerbare POST.
 *
 * Schrijft één regel met status 'unknown' — "wij hebben deze factuur onder handen, en of hij
 * geboekt is weten we nog niet". De partiële unique index (pushed | unknown) maakt dat een slot:
 * een tweede verzoek krijgt 23505 en post dus niet.
 *
 * Retourneert false wanneer een ander verzoek de claim al heeft. Bij een échte schrijffout ook
 * false: kunnen we het slot niet dichtdoen, dan posten we niet — de faalrichting is hier niet
 * boeken, want een gemiste boeking is te herstellen en een dubbele niet.
 */
async function claimExport(
  pipeline: ReturnType<typeof createPipelineClient>,
  params: {
    userId: string;
    invoice: SnelStartInvoice;
    boekingType: "inkoopboeking" | "verkoopboeking";
    relatieId?: string | null;
    amount?: number;
  },
): Promise<"claimed" | "taken" | "unsupported"> {
  // Een oude MISLUKTE poging voor dezelfde factuur eerst opruimen — die claimt niets (hij valt
  // buiten de index), maar zonder dit groeit het logboek bij elke herhaling en wordt "2 mislukt"
  // een verhaal over het verleden in plaats van over nu. Bewust vóór de claim: een 'unknown' of
  // 'pushed' regel blijft staan en zorgt hieronder voor de 23505.
  await pipeline
    .from("snelstart_exports")
    .delete()
    .eq("user_id", params.userId)
    .eq("invoice_id", params.invoice.id)
    .eq("status", "failed");

  const { error } = await pipeline.from("snelstart_exports").insert({
    user_id: params.userId,
    invoice_id: params.invoice.id,
    direction: params.invoice.direction === "incoming" ? "incoming" : "outgoing",
    boeking_type: params.boekingType,
    snelstart_relatie_id: params.relatieId ?? null,
    status: "unknown",
    amount: params.amount ?? null,
  });

  if (!error) return "claimed";

  if (error.code === "23505") {
    // Het slot deed precies zijn werk: een ander verzoek is hier al mee bezig, of de factuur
    // is al geboekt. Geen fout — wél vermelden.
    console.warn("[SNELSTART] claim bestaat al", { invoiceId: params.invoice.id });
    return "taken";
  }
  if (error.code === "23514") {
    // [DEPLOY-SAFE] De CHECK kent 'unknown' nog niet: de code staat live, de migratie
    // (snelstart_claim_before_push.sql) is nog niet gedraaid. Zonder deze tak zou de hele
    // SnelStart-koppeling stilvallen tot iemand die SQL uitvoert — een luid kapotte functie in
    // ruil voor een race die er vandaag óók al is. Dus vallen we terug op precies het oude
    // gedrag: eerst boeken, daarna vastleggen. Niet beter dan gisteren, maar ook niet slechter,
    // en de logregel zegt onomwonden wat eraan ontbreekt.
    console.error(
      "[SNELSTART] MIGRATIE ONTBREEKT: snelstart_claim_before_push.sql is niet toegepast. " +
      "De boeking loopt zolang via het oude pad (claim ná de POST), inclusief het risico op een " +
      "dubbele boeking bij twee gelijktijdige verzoeken.",
      { invoiceId: params.invoice.id },
    );
    return "unsupported";
  }
  console.error("[SNELSTART] claim schrijven mislukt — niet geboekt", { error });
  return "taken";
}

/**
 * [SNELSTART-CLAIM] De claim afronden met wat we ná de poging weten.
 *
 * 'pushed'  → gelukt; dezelfde regel wordt de definitieve boekingsregel (het slot ging nooit open)
 * 'failed'  → bewezen niets geboekt; de regel valt uit de index en de factuur mag opnieuw mee
 * 'unknown' → afloop onbekend; de regel blijft claimen en een mens controleert het in SnelStart
 */
async function settleClaim(
  pipeline: ReturnType<typeof createPipelineClient>,
  userId: string,
  invoiceId: string,
  outcome: {
    status: "pushed" | "failed" | "unknown";
    snelstartId?: string | null;
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<void> {
  const { error } = await pipeline
    .from("snelstart_exports")
    .update({
      status: outcome.status,
      snelstart_id: outcome.snelstartId ?? null,
      error_code: outcome.errorCode ?? null,
      error_message: outcome.errorMessage ? outcome.errorMessage.slice(0, 500) : null,
    })
    .eq("user_id", userId)
    .eq("invoice_id", invoiceId)
    .eq("status", "unknown");

  if (error) {
    // De claim blijft dan op 'unknown' staan. Dat is de veilige kant — er wordt niet vanzelf
    // opnieuw geboekt — maar het moet wel vindbaar zijn, want bij een geslaagde boeking is dit
    // het verschil tussen "geboekt" en "mogelijk geboekt" op het scherm van de gebruiker.
    console.error("[SNELSTART] claim afronden mislukt — blijft op 'unknown'", {
      invoiceId,
      bedoeldeStatus: outcome.status,
      error,
    });
  }
}

function describeFailure(err: unknown): { code: string; message: string } {
  if (err instanceof SnelStartMappingError) {
    return { code: err.code, message: dutchMappingError(err.code) };
  }
  if (err instanceof SnelStartError) {
    return { code: err.code, message: dutchSnelStartError(err.code) };
  }
  console.error("[SNELSTART] onverwachte fout tijdens push", err);
  return { code: "UNKNOWN", message: "Onbekende fout bij het boeken in SnelStart." };
}

/** Faalt de batch al vóór de eerste factuur (bv. tarieven ophalen), dan is er niets
 *  geboekt en hoort de gebruiker één duidelijke fout te zien. */
async function abortWithSnelStartError(err: unknown, userId: string): Promise<NextResponse> {
  if (err instanceof SnelStartError) {
    if (err.code === "INVALID_KEY" || err.code === "FORBIDDEN") {
      await markSnelStartNeedsReauth(userId, err.message);
    }
    return NextResponse.json(
      { error: dutchSnelStartError(err.code), code: err.code, pushed: 0, failed: 0 },
      { status: err.code === "NOT_CONFIGURED" ? 503 : 502 },
    );
  }
  console.error("[SNELSTART] push kon niet starten", err);
  return NextResponse.json({ error: "Doorsturen mislukt" }, { status: 500 });
}
