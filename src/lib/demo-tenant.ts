// src/lib/demo-tenant.ts
// [DEMO-DICHT] What the public demo account is not allowed to do. Pure, no I/O.
// Run: npx tsx --test src/lib/demo-tenant.test.ts
//
// ── WHY THIS EXISTS ──
// scripts/seed-demo-account.sql creates a real, e-mail-confirmed account on the production
// project and commits its password as a literal. That is deliberate and it is not a mistake:
// docs/PLAY_STORE_LISTING.md §3 has to hand Google's reviewers a working login, and the store
// screenshots are shot against a tenant of its own so no real business's suppliers and IBANs end
// up on a public page. Both are good reasons.
//
// The part that does not follow is what the credential may DO. This repository is public, and the
// password has been in its history since 26 August — a second copy went into docs/SOCIAL_CLIPS.md
// in plaintext on 2 September, next to a doc that had been careful to write `SHOT_PASSWORD=…`.
// Rotating it is worth doing and does not fix this: git history does not forget, so the next
// password is one `git log -p` away from being just as public. The same reasoning the session
// applied to a burned CRON_SECRET applies here, with the difference that this credential is
// MEANT to be handed out.
//
// So the protection cannot be secrecy. It has to be capability.
//
// ── WHERE THE LINE IS ──
// Not "read-only". A Play Console reviewer who cannot create anything reports a broken app, and
// the whole point of the tenant is that someone can look around in it. A demo account may type,
// edit, navigate and delete its own invented rows all day; none of that reaches anyone.
//
// Two things are different in kind, and they are the two this module refuses:
//
//   1. MAIL THAT LEAVES THE BUILDING. invoice_schedules.sql already names the distinction for a
//      different feature — "sending is an outward act toward a third party". An invoice mail goes
//      to an address the sender chose, from this product's own domain. INVOICE_SEND allows 100 an
//      hour, so a published password is 2,400 messages a day aimed wherever the finder likes, on
//      a young sending domain that task [BEZORGING] has only just got out of the spam folder.
//
//   2. READS THAT COST MONEY. AI_OCR's own comment says it is "a per-user ceiling so one account
//      can't drive unbounded ANTHROPIC spend" — 240 an hour. That ceiling is sized for a real
//      shop's month of receipts in one sitting. It is not sized for the internet.
//
// Both are already bounded, and that matters: this is a leak, not a flood. It is worth closing
// while nobody has walked through it (auth.users.last_sign_in_at was still null when this was
// written), not because the ceiling is missing.
//
// ── WHY THE SET IS DERIVED AND NOT LISTED ──
// The list of routes below is checked against the source by [DEMO-DICHT] in lifecycle-gates: any
// API route importing @/lib/email or @/lib/ai must be refused here. Twice today a hand-kept list
// standing beside an automatic rule went quietly out of date — the icon subset, and PUBLIC_PATHS
// against three landing pages that 307'd to /login. A third repeat was avoidable.

/**
 * The demo tenant, as seeded by scripts/seed-demo-account.sql.
 *
 * Hard-coded on purpose. An env var would mean the guard is off wherever the variable is missing,
 * and "off" here is silent — nothing on any screen changes and no test notices. The id is not a
 * secret: it is in a public seed script, and knowing it grants nothing.
 */
export const DEMO_TENANT_ID = "d3d3d3d3-0000-4000-8000-000000000001";

/** Is this the account whose password is published? Anything else is a normal owner. */
export function isDemoTenant(userId: string | null | undefined): boolean {
  return typeof userId === "string" && userId === DEMO_TENANT_ID;
}

/** Why the demo tenant was refused. One per kind, so the message can say something true. */
export type DemoRefusal = "outbound_mail" | "paid_read";

/**
 * Requests that are NOT the demo user acting — a third party calling us. They carry no session, so
 * the guard never sees them anyway; they are named here so the gate's carve-out is a decision on
 * the page rather than an omission.
 */
const THIRD_PARTY_WEBHOOKS: readonly string[] = ["/api/email/webhook", "/api/billing/webhook"];

/**
 * Path prefixes whose mutating verbs send mail to a third party.
 *
 * Prefixes, matched on SEGMENT boundaries, so /api/invoice-export can never be swallowed by the
 * /api/invoice prefix.
 */
const OUTBOUND_MAIL: readonly string[] = [
  "/api/invoice/send",
  "/api/invoice/creditnota",
  "/api/draft-queue",
  "/api/feedback",
  "/api/messages",
  "/api/invite",
  "/api/company/members",
  "/api/account/export",
  "/api/accountant/vraag-stukken",
  "/api/accountant/vraag-machtiging",
  "/api/accountant/unlink",
  "/api/accountant/unlink-by-client",
  "/api/closing-package/share",
];

/** …and the two behind a dynamic id, matched on shape rather than on a literal path. */
const OUTBOUND_MAIL_PATTERNS: readonly RegExp[] = [
  /^\/api\/invoice\/[^/]+\/send-offerte$/,
  /^\/api\/invoice\/[^/]+\/reminder$/,
];

/**
 * Path prefixes whose mutating verbs spend money with the model.
 *
 * FAMILIES, not leaves, and that is the correction the gate forced. The first version of this list
 * named the routes I could think of; the derived check found FIFTEEN more — every door into the
 * mailbox (/api/email/sync, connect, backfill, upload, reimport, the two OAuth callbacks), the
 * file classifier, the terminal-receipt import, the bank attachment, and "reken mijn boeken na".
 * Each of those reads a document with the model. Naming families instead of leaves is what makes
 * the next one covered before it is written.
 */
const PAID_READ: readonly string[] = [
  "/api/intake",
  "/api/ai",
  "/api/email",
  "/api/documents",
  "/api/bestanden/classify",
  "/api/tools/scan-invoice",
  "/api/bank/attach-invoice",
  "/api/eft/import",
  "/api/invoice/audit",
];

/** Does this path start with this prefix on a SEGMENT boundary? */
function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * What the demo tenant must be refused for this request, or null when it may proceed.
 *
 * Only mutating methods are refused. A GET on /api/messages is reading one's own inbox and sends
 * nothing; refusing it would blank screens the reviewer is meant to look at, which is the failure
 * this guard is supposed to prevent rather than cause.
 */
export function demoRefusalFor(pathname: string, method: string): DemoRefusal | null {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return null;

  // A webhook is the provider calling us; it carries no session and is not the demo user acting.
  if (THIRD_PARTY_WEBHOOKS.some((p) => underPrefix(pathname, p))) return null;

  if (PAID_READ.some((p) => underPrefix(pathname, p))) return "paid_read";
  if (OUTBOUND_MAIL.some((p) => underPrefix(pathname, p))) return "outbound_mail";
  if (OUTBOUND_MAIL_PATTERNS.some((re) => re.test(pathname))) return "outbound_mail";
  return null;
}

/**
 * What the demo user is told. Dutch: it is on screen, and a reviewer reading it should understand
 * that the app works and this account is fenced — not that the feature is broken.
 */
export function demoRefusalMessage(reason: DemoRefusal): string {
  return reason === "outbound_mail"
    ? "Dit is het demoaccount. Alles op deze schermen werkt, maar er gaat vanaf hier geen e-mail naar buiten — het wachtwoord van dit account is openbaar."
    : "Dit is het demoaccount. Documenten worden hier niet ingelezen, omdat het wachtwoord van dit account openbaar is.";
}

/** Every path the guard covers, for the gate that checks the set against the source. */
export function demoGuardedPaths(): readonly string[] {
  return [...OUTBOUND_MAIL, ...PAID_READ];
}
