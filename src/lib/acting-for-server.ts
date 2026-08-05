// src/lib/acting-for-server.ts
// [ACTING-FOR] The server side: who is in this session, and on whose behalf are they acting?
//
// The pure rules live in acting-for.ts and are tested there. This file only does the lookup —
// one query, and the outcome goes through the same resolveActingFor() the test guards. That way
// there is no second place where someone accidentally forms their own opinion about who may
// touch what.
//
// The Next documentation calls this a Data Access Layer, and warns explicitly that a check in
// the proxy/middleware is OPTIMISTIC: good enough to hide a menu, never enough to draw a
// boundary. Every server route and every server component that touches money must call this
// function itself — never trust what happened earlier in the chain.

import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { resolveActingFor, type ActingFor, type MemberLink } from "@/lib/acting-for";
import { resolveAccountantActing, canConfirmForClient, type MandateRow } from "@/lib/accountant-mandate";

/**
 * Who is acting here, on whose behalf? Returns `null` when nobody is logged in.
 *
 * `cache()` memoises within one render/request: a page calling this three times does one query.
 * It is emphatically NOT a cache between requests — a revoked member must be locked out on their
 * next click, not after a minute.
 */
export const getActingFor = cache(async (): Promise<ActingFor | null> => {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let link: MemberLink | null = null;
  try {
    // [DEPLOY-SAFE] company_members only exists after the migration, so it is not in the
    // generated types yet. Same escape as elsewhere in this codebase (cron_runs).
    //
    // Read with service_role, with an explicit .eq() on the session user. That is safer here
    // than it looks: resolveActingFor() discards the row anyway when member_id does not match,
    // so even a mistake in this query cannot put anyone inside another person's administration.
    const pipeline = createPipelineClient();
    const { data, error } = await pipeline
      .from("company_members")
      .select("owner_id, member_id, role, revoked_at")
      .eq("member_id", user.id)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();
    // 42P01 = the migration has not been applied. Then the role simply does not exist and
    // everyone is owner of themselves — exactly the state from before this function.
    if (error && error.code !== "42P01") {
      console.error("[ACTING-FOR] reading the member link failed", { error });
    }
    link = (data as MemberLink | null) ?? null;
  } catch (e) {
    // If the lookup fails, the user is owner of themselves. That is the safe side: they see
    // their own (empty) administration instead of someone else's.
    console.error("[ACTING-FOR] reading the member link failed", { error: String(e) });
    link = null;
  }

  return resolveActingFor(user.id, link, Date.now());
});

/**
 * [MANDAAT] Who is acting for THIS client — the accountant door.
 *
 * WHY IT IS A SECOND FUNCTION AND NOT A PARAMETER ON getActingFor()
 * getActingFor() answers "who are you?" from an ambient link and is memoised per request. An
 * accountant's answer depends on WHICH client the request names, so it is not ambient and must not
 * be cached under one key. Keeping the doors separate also means the owner and sales paths are
 * untouched by this feature — they never reach a line of it.
 *
 * `clientId` empty/absent ⇒ falls through to getActingFor(): the ordinary owner or sales answer.
 * That is what makes this safe to wire into the existing invoice routes — for everyone who is not
 * an accountant naming a client, literally nothing changes.
 *
 * Returns null when the caller may not act for this client. Callers must answer 403 and stop; see
 * resolveAccountantActing() for why there is no "fall back to yourself" here.
 */
export async function getActingForClient(
  clientId: string | null | undefined,
): Promise<ActingFor | null> {
  if (!clientId) return getActingFor();

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Their own administration through the accountant door is not an accountant question at all —
  // hand it to the ordinary path, which gives them a proper owner ActingFor.
  if (user.id === clientId) return getActingFor();

  // Read with the SESSION client, not service_role. RLS on both tables already limits an
  // accountant to their own rows, so a wrong answer here needs two independent failures.
  const [{ data: profile }, { data: link }, { data: mandate }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .maybeSingle(),
    // [DEPLOY-SAFE] The table only exists after accountant_invoice_mandate.sql. Until then every
    // accountant simply has no mandate — the feature is off, and nothing else breaks.
    supabase
      .from("accountant_invoice_mandates")
      .select("zzper_id, accountant_id, revoked_at")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .is("revoked_at", null)
      .maybeSingle(),
  ]);

  return resolveAccountantActing(
    user.id,
    clientId,
    {
      callerRole: (profile as { role?: string } | null)?.role ?? null,
      linked: Boolean(link),
      mandate: (mandate as MandateRow | null) ?? null,
    },
    Date.now(),
  );
}

/**
 * [BEVESTIGEN] May this session confirm incoming invoices for this client?
 *
 * A boolean, not an ActingFor — see canConfirmForClient() for why the two permissions have
 * different shapes. Confirming does not move ownership of anything; it records a signature.
 *
 * The mandate row is fetched WITHOUT filtering on kind, and the pure function decides. That is
 * deliberate: filtering here would mean the kind rule lived in a query instead of in a tested
 * function, and the one place it must never be is "somewhere in a query".
 */
export async function canConfirmForClientServer(clientId: string | null | undefined): Promise<boolean> {
  if (!clientId) return false;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id === clientId) return false;

  const [{ data: profile }, { data: link }, { data: mandate }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase
      .from("accountant_clients")
      .select("id")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .maybeSingle(),
    // [DEPLOY-SAFE] `kind` only exists after accountant_confirm_mandate.sql. Until then every row
    // reads as 'facturen' (mandateKindOf) and nobody can confirm — the feature is simply off.
    supabase
      .from("accountant_invoice_mandates")
      .select("zzper_id, accountant_id, kind, revoked_at")
      .eq("accountant_id", user.id)
      .eq("zzper_id", clientId)
      .eq("kind", "bevestigen")
      .is("revoked_at", null)
      .maybeSingle(),
  ]);

  return canConfirmForClient(
    user.id,
    clientId,
    {
      callerRole: (profile as { role?: string } | null)?.role ?? null,
      linked: Boolean(link),
      mandate: (mandate as MandateRow | null) ?? null,
    },
    Date.now(),
  );
}

/**
 * Who, within this company, created something — and what is that person called?
 *
 * WHY THIS EXISTS
 * created_by was written and read by NOBODY. A trail nobody can read is not a trail: the owner
 * hands out the right to issue invoices under their name and VAT number, and could then see
 * nowhere who made which one.
 *
 * WHY IT IS THIS NARROW
 * An arbitrary uuid is NEVER translated to a name here. Only people who are (or were) members of
 * THIS company are included — the link is the proof that the owner may see their name. Revoked
 * members belong here too: their invoices still exist, and an invoice by "Unknown" is exactly
 * the question this was meant to answer.
 *
 * Empty map = no team, or the migration is still open. Both mean: nothing to show.
 */
export async function loadTeamNames(ownerId: string): Promise<Record<string, string>> {
  const { available, members } = await loadCompanyMembers(ownerId);
  if (!available || members.length === 0) return {};
  try {
    const pipeline = createPipelineClient();
    const { data } = await pipeline
      .from("profiles")
      .select("id, full_name, company_name")
      .in("id", members.map((m) => m.member_id));
    const out: Record<string, string> = {};
    for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; company_name: string | null }>) {
      out[p.id] = p.full_name || p.company_name || "Teamlid";
    }
    // A member without a profile row (deleted account) stays nameable: "Teamlid" is truer than
    // nothing, because the invoice WAS made by someone else.
    for (const m of members) if (!out[m.member_id]) out[m.member_id] = "Teamlid";
    return out;
  } catch {
    return {};
  }
}

/**
 * Was this user ever a member of a company, and has that been revoked?
 *
 * Only so it can be EXPLAINED. A member whose access is revoked used to fall back to their own
 * empty invoice list without a single word — they would think the app was broken or that their
 * invoices had been deleted. They are not deleted: they sit with their employer, where they
 * belong.
 */
export async function loadRevokedMembership(
  userId: string,
): Promise<{ ownerId: string; revokedAt: string } | null> {
  try {
    const pipeline = createPipelineClient();
    const { data } = await pipeline
      .from("company_members")
      .select("owner_id, revoked_at")
      .eq("member_id", userId)
      .not("revoked_at", "is", null)
      .order("revoked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as { owner_id?: string; revoked_at?: string } | null;
    return row?.owner_id && row.revoked_at
      ? { ownerId: row.owner_id, revokedAt: row.revoked_at }
      : null;
  } catch {
    return null;
  }
}

export interface CompanyMemberRow {
  id: string;
  member_id: string;
  role: string;
  created_at: string;
  revoked_at: string | null;
}

/**
 * The members of this company — only meaningful for an owner. Active AND revoked.
 *
 * `available: false` means company_members does not exist yet: the migration has not been
 * applied. That is something ELSE than "you have no team", and those two must not look alike on
 * any screen — otherwise it says "Nobody" to someone who just invited three people, or they get
 * an invitation form that cannot possibly work.
 */
export async function loadCompanyMembers(
  ownerId: string,
): Promise<{ available: boolean; members: CompanyMemberRow[] }> {
  try {
    const pipeline = createPipelineClient();
    const { data, error } = await pipeline
      .from("company_members")
      .select("id, member_id, role, created_at, revoked_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true });
    // 42P01 = the table does not exist yet. PGRST205 is the same state via the schema cache.
    if (error) {
      const code = String((error as { code?: string }).code ?? "");
      if (code === "42P01" || code === "PGRST205") return { available: false, members: [] };
      return { available: true, members: [] };
    }
    return { available: true, members: data ?? [] };
  } catch {
    return { available: false, members: [] };
  }
}
