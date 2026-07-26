// src/app/api/cron/trial-reminder/route.ts
// [BILLING] "Your trial ends in N days" — the one nudge before the paywall.
//
// A trial that ends with no warning does not read as "my trial ended"; it reads
// as "the app took my bookkeeping away". One honest mail, a couple of days out,
// is the difference between a conversion and a complaint.
//
// SECURITY: iterates across users → never publicly callable. Bearer CRON_SECRET,
// constant-time compare, fail-closed (identical guard to /api/cron/reminders).
//
// DISCIPLINE (why this cron is safe):
//   * It NEVER writes a financial or entitlement field. It writes exactly one
//     column, trial_reminder_sent_at — a send log. It cannot grant, extend or
//     revoke access; the paywall reads trial_ends_at, which this never touches.
//   * CLAIM-THEN-SEND: trial_reminder_sent_at is stamped BEFORE the mail, with
//     the update itself scoped `.is('trial_reminder_sent_at', null)`. An empty
//     update result means another run already claimed this owner → we do NOT
//     send. Two overlapping runs therefore cannot both mail the same person.
//   * The window decision is the pure trialBanner()/decideAccess() pair that
//     the middleware and the banner already use, so the mail can never disagree
//     with what the app shows on screen.
//   * Best-effort per owner: one failure never stops the rest.
//   * Ships DARK in effect — with billing_subscription.sql unapplied the query
//     errors and returns a clean no-op, and with no trials running it finds
//     nobody. It cannot mail anyone before there is anyone to mail.

import { NextRequest, NextResponse } from "next/server";
import { createPipelineClient } from "@/lib/supabase-pipeline";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { timingSafeEqualStr } from "@/lib/timing-safe";
import { decideAccess, trialBanner } from "@/lib/subscription";
import { PLAN } from "@/lib/plan";
import { sendTrialEndingEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Mail when this many days (or fewer) remain. 3 is late enough that the trial
 * has been genuinely used and the mail lands as useful rather than as a sales
 * push on day two, and early enough to act on before access stops.
 */
const WARN_AT_DAYS = 3;

type TrialProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  company_name: string | null;
  role: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
};

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret) {
    console.error("[CRON-TRIAL] CRON_SECRET is not configured — trial reminders are DISABLED.");
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 401 });
  }
  if (!auth || !timingSafeEqualStr(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pipeline = createPipelineClient();
  const nowMs = Date.now();
  const horizon = new Date(nowMs + WARN_AT_DAYS * 86_400_000).toISOString();

  // Owners still inside a trial that ends within the window and who have not
  // been mailed yet. SQL narrows; the pure decision below is the authority.
  //
  // The billing columns come from billing_subscription.sql + the marker from
  // billing_trial_reminder.sql, both applied by hand — a column-missing error
  // is caught and returned as a clean no-op, never a 500.
  let owners: TrialProfile[];
  try {
    owners = await fetchAllRows<TrialProfile>((from, to) =>
      // Billing columns are not in the generated types → relaxed client.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pipeline as any)
        .from("profiles")
        .select(
          "id, email, full_name, company_name, role, subscription_status, trial_ends_at, current_period_end"
        )
        .is("trial_reminder_sent_at", null)
        .not("trial_ends_at", "is", null)
        .lte("trial_ends_at", horizon)
        .gte("trial_ends_at", new Date(nowMs).toISOString())
        // fetchAllRows pages with .range(), and that is only correct on a STABLE
        // order. Without this the page boundary can shift between requests and
        // an owner is skipped — their trial then ends with no warning at all,
        // which is the exact failure this cron exists to prevent.
        .order("id", { ascending: true })
        .range(from, to)
    );
  } catch (err) {
    console.error("[CRON-TRIAL] candidate query failed (migrations applied?):", err);
    return NextResponse.json({ ok: true, scanned: 0, sent: 0, note: "migration_pending" });
  }

  let sent = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const owner of owners) {
    // The same decision the middleware and the on-screen banner use, so the
    // mail can never claim something the app contradicts.
    const banner = trialBanner(
      decideAccess({
        role: owner.role ?? null,
        subscriptionStatus: owner.subscription_status ?? null,
        trialEndsAt: owner.trial_ends_at ?? null,
        currentPeriodEnd: owner.current_period_end ?? null,
        nowMs,
      }),
      WARN_AT_DAYS
    );

    // Not actually in a warnable trial (already subscribed, an accountant, or
    // the window moved) → say nothing.
    if (!banner) {
      skipped++;
      continue;
    }

    if (!owner.email) {
      skipped++;
      continue;
    }

    try {
      // ── CLAIM ──────────────────────────────────────────────────────
      // Scoped to rows still unclaimed. If another run got here first this
      // updates nothing and we must not send.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: claimed, error: claimErr } = await (pipeline as any)
        .from("profiles")
        .update({ trial_reminder_sent_at: new Date().toISOString() })
        .eq("id", owner.id)
        .is("trial_reminder_sent_at", null)
        .select("id");

      if (claimErr) throw new Error(`claim failed: ${claimErr.message}`);
      if (!claimed || claimed.length === 0) {
        skipped++; // another run already claimed this owner
        continue;
      }

      // ── SEND ───────────────────────────────────────────────────────
      await sendTrialEndingEmail({
        toEmail: owner.email,
        name: owner.company_name || owner.full_name || "ondernemer",
        daysLeft: banner.daysLeft,
        priceLabel: PLAN.priceLabel,
      });

      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`[CRON-TRIAL] reminder failed for ${owner.id}:`, msg);
      failures.push(`${owner.id}: ${msg}`);
    }
  }

  return NextResponse.json({ ok: true, scanned: owners.length, sent, skipped, failures });
}
