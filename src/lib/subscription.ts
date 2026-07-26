// src/lib/subscription.ts
// [BILLING] The access decision — pure, no I/O, no Stripe, no Supabase.
//
// This is the ONLY place that decides whether an account may use the app. The
// middleware, the trial banner and the billing settings screen all ask this one
// function, so the paywall can never mean two different things in two places.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE GOVERNING RULE: FAIL OPEN.
//
// The two failure modes are wildly asymmetric:
//   · a FALSE LOCKOUT shuts a paying customer out of their own bookkeeping —
//     during a BTW deadline that is the kind of thing you lose a customer over,
//     and it is caused by OUR bug (a missing column, a NULL, a clock skew);
//   · a FALSE PASS gives somebody a few more days of an app they were using
//     anyway, and costs us nothing we can measure.
// So every ambiguity — unknown status, NULL trial, unparseable date, migration
// not applied yet — resolves to ALLOWED. A lockout requires positive proof that
// the account has no claim to access. Never invert this.
// ─────────────────────────────────────────────────────────────────────────────

/** Normalised lifecycle state — mirrors the DB CHECK in billing_subscription.sql. */
export type SubscriptionStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "paused"
  | "incomplete"
  | "canceled";

/**
 * Everything the decision needs. Deliberately primitives: the caller reads the
 * profile row (or fails to), and hands over what it got — including nulls.
 */
export type AccessInput = {
  /** profiles.role — 'zzper' | 'accountant' | 'client' | null */
  role: string | null;
  /** profiles.subscription_status — may be null when the migration is not applied. */
  subscriptionStatus: string | null;
  /** profiles.trial_ends_at as an ISO string, or null. */
  trialEndsAt: string | null;
  /** profiles.current_period_end as an ISO string, or null. */
  currentPeriodEnd: string | null;
  /**
   * Does this account have at least one CONSENTED accountant_clients link?
   *
   * The accountant exemption used to rest on `role` alone — but `role` is a
   * SELF-DECLARATION: src/app/register/page.tsx has a role picker whose value
   * flows through signup metadata into handle_new_user(). Anyone could tick
   * "Accountant" at signup and never pay. No database trigger can fix that,
   * because the declaration happens at INSERT and is legitimate for real
   * accountants.
   *
   * So the exemption now needs evidence. Self-linking is already blocked by
   * accountant_clients_insert_consent.sql, which makes a link something only
   * another human can grant you.
   *
   * Optional, and `undefined` is treated as "we did not check" — callers that
   * do not care about the accountant path (or could not afford the query) still
   * get a correct answer for everyone else.
   */
  hasAccountantClients?: boolean;
  /** Now, in epoch ms. Injected so tests are deterministic (no real clock). */
  nowMs: number;
};

/** Why access was granted or refused — surfaced in the UI and in logs. */
export type AccessReason =
  | "accountant" // accountants are not billed in v1 — they are the channel
  | "active" // paying
  | "trialing" // inside the free trial
  | "grace_period" // payment retrying, or cancelled but the paid period runs on
  | "unknown_state" // we could not tell → fail open (see governing rule)
  | "trial_expired" // trial is over and nothing was ever paid
  | "subscription_ended"; // was paying, the paid period has now run out

export type AccessDecision = {
  /** The answer. `false` is the ONLY value that may gate anything. */
  allowed: boolean;
  reason: AccessReason;
  /**
   * Whole days left in the trial (ceil), or null when not trialing. 0 means it
   * expires later today. Drives the "Nog X dagen" banner.
   */
  trialDaysLeft: number | null;
};

const MS_PER_DAY = 86_400_000;

/**
 * THE DARK SWITCH — is the paywall actually allowed to turn anyone away?
 *
 * The paywall ships INERT: unless BILLING_ENFORCED is exactly "true", the
 * middleware still computes the decision (so it can be logged and the trial
 * banner still works) but redirects nobody. Same discipline as the reminders
 * cron, which ships with reminders_enabled defaulting to false.
 *
 * This is what makes deploying billing a zero-risk event: the code can sit in
 * production for days before the migration is applied and before a single
 * Stripe key exists, and not one user notices.
 *
 * Flip to "true" only when all four are true:
 *   1. billing_subscription.sql applied   2. live Stripe keys set
 *   3. a webhook has been seen to arrive  4. you have paid yourself once
 *
 * Lives in this pure module rather than in billing.ts because the middleware
 * calls it on the Edge runtime, where importing the Stripe SDK is not an option.
 */
export function isBillingEnforced(): boolean {
  return (process.env.BILLING_ENFORCED || "").trim() === "true";
}

/**
 * Parse an ISO timestamp to epoch ms. Returns null for null/empty/garbage —
 * an unparseable date must never read as "expired" (that would be a lockout on
 * bad data, which the governing rule forbids).
 */
export function parseTimestamp(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whole days from `nowMs` until `endMs`, rounded UP, floored at 0.
 * Rounded up so a trial with 6 hours left still reads "1 day" rather than the
 * dispiriting (and wrong) "0 days".
 */
export function daysUntil(endMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((endMs - nowMs) / MS_PER_DAY));
}

/**
 * THE decision. Pure: same input → same output, always.
 *
 * Order matters — the first matching rule wins, and the fail-open rules are
 * deliberately placed BEFORE the two deny rules at the bottom.
 */
export function decideAccess(input: AccessInput): AccessDecision {
  const { role, subscriptionStatus, nowMs } = input;
  const trialEnd = parseTimestamp(input.trialEndsAt);
  const periodEnd = parseTimestamp(input.currentPeriodEnd);

  // 1. Accountants are never billed. They are not the customer — they have their
  //    own software (Exact/Twinfield) and use BoekBrug only as the RECIPIENT of
  //    a client's bookkeeping, so their side of the bridge must never sit behind
  //    the ZZP paywall.
  //
  //    But the exemption needs EVIDENCE, not a claim. `role` is self-declared at
  //    signup (see AccessInput.hasAccountantClients), so on its own it is a
  //    free-forever button anyone can press. Requiring a consented client link
  //    makes it something only another person can grant.
  //
  //    A genuine accountant with no client linked YET is not stranded: they are
  //    still inside their trial (rule 3), which is ample time to accept or send
  //    an invitation. A ZZP'er who ticked "accountant" to dodge the paywall
  //    gains nothing beyond the trial they already had.
  //
  //    `undefined` means the caller did not check. Per the governing rule that
  //    ambiguity favours the user, an unchecked accountant is still exempt —
  //    every caller that CAN check does.
  if (role === "accountant" && input.hasAccountantClients !== false) {
    return { allowed: true, reason: "accountant", trialDaysLeft: null };
  }

  // 2. Paying. The common case.
  if (subscriptionStatus === "active") {
    return { allowed: true, reason: "active", trialDaysLeft: null };
  }

  // 3. Inside the trial — judged by the CLOCK, not by the status string.
  //    Deliberately independent of subscriptionStatus: a user who starts
  //    checkout on day 3 and whose card fails gets status 'incomplete', and if
  //    this rule required status === 'trialing' those 11 remaining trial days
  //    would vanish because they *tried* to pay us. The trial clock is set by a
  //    database DEFAULT and has no app write path, so it is the trustworthy
  //    signal here; while it runs, the account is in trial whatever Stripe says.
  if (trialEnd !== null && trialEnd > nowMs) {
    return {
      allowed: true,
      reason: "trialing",
      trialDaysLeft: daysUntil(trialEnd, nowMs),
    };
  }

  // 4. Payment is failing but Stripe is still retrying (past_due), or collection
  //    is paused. The card expired; the customer has not left. Locking them out
  //    mid-retry is how you turn a recoverable card problem into a cancellation.
  if (subscriptionStatus === "past_due" || subscriptionStatus === "paused") {
    return { allowed: true, reason: "grace_period", trialDaysLeft: null };
  }

  // 5. Cancelled / unpaid, but Stripe has already collected for a period that
  //    has not run out yet. They paid for these days; they get these days.
  if (periodEnd !== null && periodEnd > nowMs) {
    return { allowed: true, reason: "grace_period", trialDaysLeft: null };
  }

  // ── From here down we may only DENY on positive proof. ──────────────
  // Everything that is not proven expired falls through to rule 8 and is let in.

  // 6. Proof of a spent trial: the account never became a customer, and we hold
  //    a real trial-end timestamp that is in the past (rule 3 already admitted
  //    every trial still running).
  if (
    (subscriptionStatus === "trialing" ||
      subscriptionStatus === "none" ||
      subscriptionStatus === "incomplete") &&
    trialEnd !== null &&
    trialEnd <= nowMs
  ) {
    return { allowed: false, reason: "trial_expired", trialDaysLeft: 0 };
  }

  // 7. Proof of an ended subscription: a terminal Stripe state, and no paid
  //    period left (rule 5 already admitted every paid period still running).
  if (subscriptionStatus === "canceled" || subscriptionStatus === "unpaid") {
    return { allowed: false, reason: "subscription_ended", trialDaysLeft: null };
  }

  // 8. FAIL OPEN — the governing rule. We could not establish a state: the
  //    column is missing (migration not applied yet), the row could not be
  //    read, the trial timestamp was NULL or unparseable, or Stripe sent a
  //    status we do not model. None of those are the user's fault, so none of
  //    them may cost the user access.
  return { allowed: true, reason: "unknown_state", trialDaysLeft: null };
}

const KNOWN_STATUSES: readonly string[] = [
  "none",
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
  "canceled",
];

/** Is this one of the states we model? Anything else → fail open (rule 6). */
export function isKnownStatus(status: string): status is SubscriptionStatus {
  return KNOWN_STATUSES.includes(status);
}

/**
 * Should the "your trial ends in X days" banner be shown, and with what
 * urgency? Returns null when there is nothing worth interrupting the user for
 * — a banner that is always on is a banner nobody reads.
 */
export function trialBanner(
  decision: AccessDecision,
  warnFromDays = 7
): { daysLeft: number; urgent: boolean } | null {
  if (decision.reason !== "trialing") return null;
  if (decision.trialDaysLeft === null) return null;
  if (decision.trialDaysLeft > warnFromDays) return null;
  return { daysLeft: decision.trialDaysLeft, urgent: decision.trialDaysLeft <= 3 };
}

/**
 * Map a raw Stripe subscription status onto our normalised set.
 * Unrecognised input becomes 'none' — which rule 6 then treats as fail-open at
 * decision time, so an unexpected Stripe value can never lock anyone out.
 */
export function normalizeStripeStatus(raw: string | null | undefined): SubscriptionStatus {
  switch (raw) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "unpaid":
      return "unpaid";
    case "paused":
      return "paused";
    case "incomplete":
      return "incomplete";
    case "incomplete_expired":
    case "canceled":
      return "canceled";
    default:
      return "none";
  }
}
