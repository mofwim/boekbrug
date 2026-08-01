// src/app/api/bank/gocardless/status/route.ts
// [GOCARDLESS] What the bank card on /dashboard/bank reads.
//
// GET /api/bank/gocardless/status
//   → { configured, connections: [{ …, daysUntilExpiry, canSyncNow }] }
//
// The two derived numbers are computed HERE rather than in the browser, so "your consent
// expires in 6 days" and "you can refresh again" mean the same thing on every screen and in
// every timezone — the server's clock is the one the sync itself runs on.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { isGoCardlessConfigured } from "@/lib/gocardless-client";
import { listBankConnections } from "@/lib/gocardless-connection";
import { isAccountDue } from "@/lib/gocardless-sync";

export const dynamic = "force-dynamic";

/** Whole days from today until `date` (YYYY-MM-DD); null when there is no date, negative when
 *  it has already passed. */
export function daysUntil(date: string | null, now = new Date()): number | null {
  if (!date) return null;
  const target = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(target)) return null;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((target - today) / 86_400_000);
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const configured = isGoCardlessConfigured();
  if (!configured) {
    // An unconfigured server hides the card entirely rather than showing a dead button.
    return NextResponse.json({ configured: false, connections: [] });
  }

  const now = new Date();
  const connections = (await listBankConnections(user.id)).map((c) => ({
    id: c.id,
    institutionName: c.institutionName ?? c.institutionId,
    institutionBic: c.institutionBic,
    status: c.status,
    connectedAt: c.connectedAt,
    lastSyncedAt: c.lastSyncedAt,
    lastError: c.lastError,
    accessValidUntil: c.accessValidUntil,
    daysUntilExpiry: daysUntil(c.accessValidUntil, now),
    // "Refresh" is only offered when at least one account is actually allowed to be read. The
    // bank's daily budget is small, and a button that spends it on a no-op is worse than a
    // button that is honestly disabled.
    canSyncNow: c.accounts.some((a) => isAccountDue(a.lastSyncedAt, now)),
    accounts: c.accounts.map((a) => ({
      id: a.id,
      iban: a.iban,
      ownerName: a.ownerName,
      currency: a.currency,
      status: a.status,
      lastSyncedAt: a.lastSyncedAt,
      lastSyncedThrough: a.lastSyncedThrough,
      lastError: a.lastError,
    })),
  }));

  return NextResponse.json({ configured: true, connections });
}
