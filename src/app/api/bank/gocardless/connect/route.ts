// src/app/api/bank/gocardless/connect/route.ts
// [GOCARDLESS] Start a bank link.
//
// POST /api/bank/gocardless/connect  { institutionId }
//   → { connectionId, link }   — the owner is sent to `link` to consent at his own bank.
//
// Three upstream objects are created, in this order, and the order matters:
//   1. an end-user agreement — the scope + how long the consent lasts;
//   2. a requisition against that agreement — the consent itself, carrying our nonce;
//   3. our own row, BEFORE the owner leaves for his bank.
//
// Step 3 must happen before the redirect. If we stored the row only on the way back, a consent
// that succeeded at the bank but whose callback never arrived (a closed tab, a phone that
// finished the flow) would leave a live requisition nobody can find, sync or revoke — an
// authorisation to read someone's bank account with no record on our side that it exists.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { logAuditAction, getClientIP } from "@/lib/audit";
import { appOrigin } from "@/lib/app-origin";
import {
  createGoCardlessClient,
  dutchGoCardlessError,
  DEFAULT_ACCESS_VALID_FOR_DAYS,
  GoCardlessError,
  isGoCardlessConfigured,
  MAX_HISTORICAL_DAYS_CAP,
} from "@/lib/gocardless-client";
import { createBankConnection, newConnectionReference } from "@/lib/gocardless-connection";

export const dynamic = "force-dynamic";

/** Institution ids look like "ING_INGBNL2A". Validated rather than trusted: the value is
 *  echoed into an upstream request body. */
function readInstitutionId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return /^[A-Z0-9_-]{3,80}$/i.test(id) ? id : null;
}

/** The day a consent granted today runs out, as YYYY-MM-DD. */
function validUntil(days: number, from = new Date()): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  if (!isGoCardlessConfigured()) {
    return NextResponse.json({ error: dutchGoCardlessError("NOT_CONFIGURED") }, { status: 503 });
  }

  const limit = await checkRateLimit({
    userId: user.id,
    endpoint: "/api/bank/gocardless/connect",
    ...RATE_LIMITS.BANK_CONNECT,
  });
  if (!limit.allowed) return rateLimitResponse(limit);

  let body: { institutionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  }

  const institutionId = readInstitutionId(body.institutionId);
  if (!institutionId) {
    return NextResponse.json({ error: "Kies eerst je bank." }, { status: 400 });
  }

  // The redirect target must be absolute and must match what the owner's browser can reach.
  const origin = appOrigin(process.env, req.nextUrl.origin);
  if (!origin) {
    console.error("[GOCARDLESS] no app origin — cannot build the redirect URL");
    return NextResponse.json({ error: "Koppelen mislukt" }, { status: 500 });
  }
  const redirect = `${origin}/api/bank/gocardless/callback`;

  const reference = newConnectionReference();

  try {
    const client = createGoCardlessClient();

    // How much history to ask for: what THIS bank offers, capped. Asking for more than the bank
    // allows makes the agreement call fail outright, so the institution's own number is used.
    const institutions = await client.getInstitutions("NL");
    const institution = institutions.find((i) => i.id === institutionId) ?? null;
    const maxHistoricalDays = Math.min(
      institution?.transactionTotalDays ?? 365,
      MAX_HISTORICAL_DAYS_CAP,
    );

    const agreement = await client.createAgreement({ institutionId, maxHistoricalDays });
    const requisition = await client.createRequisition({
      institutionId,
      redirect,
      reference,
      agreementId: agreement.id,
    });

    if (!requisition.link) {
      console.error("[GOCARDLESS] requisition without a consent link", { requisitionId: requisition.id });
      return NextResponse.json({ error: "De bank gaf geen koppelscherm terug." }, { status: 502 });
    }

    const connection = await createBankConnection({
      userId: user.id,
      requisitionId: requisition.id,
      agreementId: agreement.id,
      institutionId,
      institutionName: institution?.name ?? null,
      institutionBic: institution?.bic ?? null,
      reference,
      // The window the bank GRANTED, not the one we asked for.
      accessValidUntil: validUntil(agreement.accessValidForDays ?? DEFAULT_ACCESS_VALID_FOR_DAYS),
      maxHistoricalDays: agreement.maxHistoricalDays,
    });

    if (!connection) {
      // The requisition exists upstream but we could not record it. Withdrawing it is the honest
      // repair: an authorisation nobody can see is worse than a failed attempt.
      try {
        await client.deleteRequisition(requisition.id);
      } catch {
        console.error("[GOCARDLESS] could not withdraw the orphaned requisition", {
          requisitionId: requisition.id,
        });
      }
      return NextResponse.json({ error: "Koppeling opslaan mislukt" }, { status: 500 });
    }

    await logAuditAction({
      userId: user.id,
      action: "bank.connect_started",
      entityType: "bank_connection",
      entityId: connection.id,
      newValue: { institutionId, institutionName: institution?.name ?? null },
      ipAddress: getClientIP(req),
    });

    return NextResponse.json({ connectionId: connection.id, link: requisition.link });
  } catch (err) {
    if (err instanceof GoCardlessError) {
      console.warn("[GOCARDLESS] connect attempt refused", { userId: user.id, code: err.code });
      return NextResponse.json(
        { error: dutchGoCardlessError(err.code), code: err.code },
        { status: err.code === "NOT_CONFIGURED" ? 503 : 400 },
      );
    }
    console.error("[GOCARDLESS] unexpected error while connecting", err);
    return NextResponse.json({ error: "Koppelen mislukt" }, { status: 500 });
  }
}
