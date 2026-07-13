// src/lib/accountant-access.ts
// [ACCOUNTANT-TRUTH] Dual-path owner resolution for the quarter views (result / aangifte /
// readiness), mirroring the authorization /api/closing-package already uses. It answers ONE
// question: "whose quarter am I allowed to compute?"
//   - no clientId (or clientId === self)      → the caller's OWN data.
//   - clientId of a linked client + accountant → that client's data.
//   - anything else                            → 403.
//
// IMPORTANT: the auth check runs on the RLS session client (passed in). The DATA queries
// that follow MUST use the service-role pipeline client scoped explicitly to the returned
// ownerId — an accountant cannot read a client's rows through RLS. This is exactly the
// pattern /api/closing-package uses; centralizing it here keeps the three quarter routes
// from drifting apart on authorization.

import type { createServerSupabaseClient } from "./supabase-server";

type ServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type OwnerResolution =
  | { ok: true; ownerId: string }
  | { ok: false; error: string; status: number };

export async function resolveQuarterOwner(
  supabase: ServerClient,
  userId: string,
  clientId: string | null | undefined,
): Promise<OwnerResolution> {
  // Own data — the common case (owner viewing their own quarter).
  if (!clientId || clientId === userId) return { ok: true, ownerId: userId };

  // Accountant path: must BE an accountant AND be linked to this client.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.role !== "accountant") {
    return { ok: false, error: "Geen toegang", status: 403 };
  }

  const { data: link } = await supabase
    .from("accountant_clients")
    .select("id")
    .eq("accountant_id", userId)
    .eq("zzper_id", clientId)
    .maybeSingle();
  if (!link) {
    return { ok: false, error: "Geen toegang tot deze klant", status: 403 };
  }

  return { ok: true, ownerId: clientId };
}
