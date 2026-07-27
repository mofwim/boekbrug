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

      const created = await client.postBoeking(mapped.type, mapped.payload);

      await recordAttempt(pipeline, {
        userId: user.id,
        invoice,
        boekingType: mapped.type,
        status: "pushed",
        snelstartId: created.id,
        relatieId,
        amount: mapped.amount,
      });

      results.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        status: "pushed",
        snelstartId: created.id,
      });
    } catch (err) {
      const { code, message } = describeFailure(err);

      await recordAttempt(pipeline, {
        userId: user.id,
        invoice,
        boekingType: invoice.direction === "incoming" ? "inkoopboeking" : "verkoopboeking",
        status: "failed",
        errorCode: code,
        errorMessage: err instanceof Error ? err.message : String(err),
      });

      results.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        status: "failed",
        error: message,
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

/** Eén poging vastleggen. Het logboek is de enige plek waar staat wat er écht met
 *  SnelStart gebeurd is — daarom schrijven we óók mislukkingen weg. */
async function recordAttempt(
  pipeline: ReturnType<typeof createPipelineClient>,
  params: {
    userId: string;
    invoice: SnelStartInvoice;
    boekingType: "inkoopboeking" | "verkoopboeking";
    status: "pushed" | "failed";
    snelstartId?: string | null;
    relatieId?: string | null;
    amount?: number;
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<void> {
  // Oude mislukte pogingen voor dezelfde factuur opruimen: anders groeit het logboek bij
  // elke herhaling en wordt "2 mislukt" een verhaal over het verleden in plaats van over nu.
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
    snelstart_id: params.snelstartId ?? null,
    snelstart_relatie_id: params.relatieId ?? null,
    status: params.status,
    error_code: params.errorCode ?? null,
    error_message: params.errorMessage ? params.errorMessage.slice(0, 500) : null,
    amount: params.amount ?? null,
  });

  if (error) {
    // 23505 = de partiële unique index sloeg toe: de factuur was al geboekt (race met een
    // tweede verzoek). Dat is precies wat we wilden — geen fout, wél vermelden.
    if (error.code === "23505") {
      console.warn("[SNELSTART] boeking al vastgelegd", { invoiceId: params.invoice.id });
      return;
    }
    console.error("[SNELSTART] duw-logboek schrijven mislukt", { error });
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
