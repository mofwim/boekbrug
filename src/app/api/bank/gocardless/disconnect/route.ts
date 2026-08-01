// src/app/api/bank/gocardless/disconnect/route.ts
// [GOCARDLESS] Stop the feed.
//
// POST /api/bank/gocardless/disconnect  { connectionId }
//   → { ok: true }
//
// Two things happen, and the ORDER is chosen so a half-failure lands on the safe side:
//   1. the requisition is withdrawn at GoCardless — the actual authorisation to read the
//      owner's bank account stops existing;
//   2. our rows are marked revoked and the accounts removed.
//
// Upstream first. If step 2 failed after step 1 we hold a dead row that syncs nothing (visible,
// harmless, repairable). The other order would leave a LIVE authorisation to read someone's
// bank account with no row on our side to revoke it from — the one outcome that is not
// recoverable through the UI.
//
// The imported transactions stay. They are the owner's bookkeeping, subject to the same
// retention obligation as an uploaded statement, and not the bank's to take back.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { logAuditAction, getClientIP } from "@/lib/audit";
import {
  createGoCardlessClient,
  GoCardlessError,
  isGoCardlessConfigured,
} from "@/lib/gocardless-client";
import { getBankConnection, revokeBankConnection } from "@/lib/gocardless-connection";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

  let connectionId: string | null = null;
  try {
    const body = (await req.json()) as { connectionId?: unknown };
    if (typeof body.connectionId === "string" && UUID.test(body.connectionId)) {
      connectionId = body.connectionId;
    }
  } catch {
    /* handled below */
  }
  if (!connectionId) return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });

  // Scoped to the session user: someone else's connection resolves to nothing.
  const connection = await getBankConnection(user.id, connectionId);
  if (!connection) return NextResponse.json({ error: "Koppeling niet gevonden" }, { status: 404 });

  if (isGoCardlessConfigured()) {
    try {
      await createGoCardlessClient().deleteRequisition(connection.requisitionId);
    } catch (err) {
      // A 404 means it is already gone upstream — that is success, not failure. Anything else is
      // logged and we continue: refusing to disconnect locally because the remote call failed
      // would trap the owner in a connection he has asked twice to be rid of, and the withdrawal
      // can still be completed from the GoCardless side.
      const code = err instanceof GoCardlessError ? err.code : "UNKNOWN";
      if (code !== "NOT_FOUND") {
        console.error("[GOCARDLESS] withdrawing the requisition failed — disconnecting locally anyway", {
          userId: user.id,
          connectionId,
          code,
        });
      }
    }
  }

  const ok = await revokeBankConnection(user.id, connectionId);
  if (!ok) return NextResponse.json({ error: "Ontkoppelen mislukt" }, { status: 500 });

  await logAuditAction({
    userId: user.id,
    action: "bank.disconnected",
    entityType: "bank_connection",
    entityId: connectionId,
    oldValue: { institutionName: connection.institutionName, accounts: connection.accounts.length },
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
