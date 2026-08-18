// src/app/api/beveiliging/route.ts
// [BEVEILIGING] Who can reach this administration, and what has been recorded about it.
//
// The screen behind this route is the app's answer to the one question a zzp'er cannot verify for
// himself: is anybody else reading my books. So the rule this file holds to is stricter than
// elsewhere — a read that failed is reported as a read that failed, never as a source with nothing
// in it. src/lib/security-overview.ts explains why at length; the short version is that on this
// screen an empty list is not a smaller truth, it is the opposite one, delivered in the tone of
// voice the owner came here to trust.
//
// ── WHY THE OWNER'S OWN LINKS ARE READ WITH THE SESSION CLIENT ──
//
// accountant_clients is readable by the client it names (the same policy /api/logboek leans on), so
// RLS itself decides which rows come back and this route never has to filter by hand. The service-
// role client appears exactly twice below, and both times only to put NAMES on ids the session
// client already established: company_members is owner-scoped inside loadCompanyMembers, and the
// profiles read is restricted to accountant ids that came out of the owner's own links.

import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/session-user";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { loadCompanyMembers } from "@/lib/acting-for-server";
import {
  buildSecurityOverview,
  type BookkeeperLinkRow,
  type MemberRow,
  type ProfileRow,
  type ReadState,
} from "@/lib/security-overview";

export const dynamic = "force-dynamic";

/** One bookkeeper link plus the profile that names them. */
type LinkedBookkeeper = { link: BookkeeperLinkRow; profile: ProfileRow | null };

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServerSupabaseClient();

  // [WATERVAL] Three independent questions, asked together. Postgrest builders are lazy, so
  // nothing has left for the network until this line — and the screen the owner opens to check
  // something must not be the slowest one in the app.
  //
  // allSettled and not all: each read below has its own honest failure, and Promise.all would let
  // one of them drag down two answers that arrived perfectly well.
  const [linksResult, membersResult, trailResult] = await Promise.allSettled([
    supabase
      .from("accountant_clients")
      .select("id, accountant_id, created_at")
      .eq("zzper_id", user.id),
    loadCompanyMembers(user.id),
    // How much has been written down about this administration. head:true so the rows themselves
    // stay where they are — this is a number under a link, not a second copy of the logbook.
    supabase.from("audit_logs").select("id", { count: "exact", head: true }),
  ]);

  // ── The bookkeepers ────────────────────────────────────────────────────────────────
  let bookkeepers: ReadState<LinkedBookkeeper[]> = { state: "unreadable" };
  if (linksResult.status === "fulfilled" && !linksResult.value.error && linksResult.value.data) {
    const links = linksResult.value.data as BookkeeperLinkRow[];
    const ids = links.map((l) => l.accountant_id).filter((id): id is string => !!id);

    // The names. A list of uuids is not a list of people — but a name we could not read is a
    // missing NAME, not a missing person, so a failure here leaves the link on the list with a null
    // name and the screen says "we could not read who this is". Dropping the row instead would hide
    // a bookkeeper because we could not spell his company.
    const profiles = new Map<string, ProfileRow>();
    if (ids.length > 0) {
      try {
        const pipeline = createPipelineClient();
        const { data } = await pipeline
          .from("profiles")
          .select("id, full_name, company_name, email")
          .in("id", ids);
        for (const p of (data ?? []) as ProfileRow[]) if (p.id) profiles.set(p.id, p);
      } catch (error) {
        console.error("[BEVEILIGING] Could not name the bookkeepers — showing the links unnamed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    bookkeepers = {
      state: "ok",
      value: links.map((link) => ({
        link,
        profile: link.accountant_id ? profiles.get(link.accountant_id) ?? null : null,
      })),
    };
  } else {
    const reason =
      linksResult.status === "rejected"
        ? String(linksResult.reason)
        : linksResult.value.error?.message;
    console.error("[BEVEILIGING] Could not read the bookkeeper links — saying so, not showing none", {
      error: reason,
    });
  }

  // ── The team ───────────────────────────────────────────────────────────────────────
  //
  // `available: false` is NOT a failure: it means the company_members migration has not run, so
  // this administration genuinely has no team surface at all. That is a complete answer and counts
  // as a successful read of zero members. `unreadable` is the other thing entirely.
  let members: ReadState<MemberRow[]> = { state: "unreadable" };
  if (membersResult.status === "fulfilled" && !membersResult.value.unreadable) {
    const rows = membersResult.value.members;
    const ids = rows.map((r) => r.member_id).filter((id): id is string => !!id);
    const named = new Map<string, ProfileRow>();
    if (ids.length > 0) {
      try {
        const pipeline = createPipelineClient();
        const { data } = await pipeline
          .from("profiles")
          .select("id, full_name, company_name, email")
          .in("id", ids);
        for (const p of (data ?? []) as ProfileRow[]) if (p.id) named.set(p.id, p);
      } catch (error) {
        console.error("[BEVEILIGING] Could not name the team members — showing them unnamed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    members = {
      state: "ok",
      value: rows.map((r) => {
        const profile = r.member_id ? named.get(r.member_id) : null;
        return {
          id: r.id,
          member_id: r.member_id,
          naam: (profile?.company_name || profile?.full_name || "").trim() || null,
          email: profile?.email ?? null,
          sinds: r.created_at,
          ingetrokken: r.revoked_at,
        };
      }),
    };
  } else {
    console.error("[BEVEILIGING] Could not read the team — saying so, not showing none");
  }

  // ── The owner's own name ───────────────────────────────────────────────────────────
  //
  // From the session's profile. A missing name is not a missing owner: the e-mail is a session fact
  // and always there, so the row is complete enough to render either way.
  let ownerName: string | null = null;
  try {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, company_name")
      .eq("id", user.id)
      .maybeSingle();
    ownerName = ((data?.company_name || data?.full_name || "") as string).trim() || null;
  } catch {
    // Deliberately quiet: the owner is on the list regardless, under his own e-mail address.
  }

  const overview = buildSecurityOverview({
    ownerEmail: user.email ?? null,
    ownerName,
    bookkeepers,
    members,
  });

  // ── The trail ──────────────────────────────────────────────────────────────────────
  //
  // null and not 0 when the count could not be read. "0 handelingen vastgelegd" about an
  // administration whose logbook is full would be this screen telling the owner that nothing is
  // being recorded — the precise opposite of what the logbook is for.
  const trailCount =
    trailResult.status === "fulfilled" && !trailResult.value.error
      ? trailResult.value.count ?? null
      : null;
  if (trailCount === null) {
    console.error("[BEVEILIGING] Could not count the trail — showing no number rather than a zero");
  }

  return NextResponse.json({
    ok: true,
    holders: overview.holders,
    complete: overview.complete,
    count: overview.count,
    trailCount,
  });
}
