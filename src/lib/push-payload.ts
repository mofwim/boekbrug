// src/lib/push-payload.ts
// [PUSH] Pure helpers for Web Push — no I/O, fully testable
// (run: npx tsx src/lib/push-payload.test.ts).
//
// Kept separate from push.ts (which does the web-push network send) so the
// decision logic — what payload a notification becomes, and which send-errors
// mean "this subscription is dead, delete it" — is a pure arithmetic core the
// sender can't get subtly wrong.

import { safeNotificationLink } from "./notification-link";

/** The JSON the service worker's `push` handler receives and renders. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** A notification row (or the createNotification input) → the device payload. */
export function buildPushPayload(n: {
  title: string;
  body?: string | null;
  link?: string | null;
  type?: string | null;
}): PushPayload {
  const title = (n.title ?? "").trim() || "BoekBrug";
  const body = (n.body ?? "").trim();
  // A relative in-app link is safe to open; anything else falls back to the
  // dashboard so a bad/absolute link can never send the user off-app.
  //
  // [MELDING-TIK] The check used to be `link.startsWith("/")`, written here and nowhere else.
  // It has two problems that safeNotificationLink fixes: "//evil.example/x" starts with a slash
  // and is a complete off-site URL, and the bell — which opens the same value — never checked at
  // all. One function now answers the question for the device and for the screen.
  const url = safeNotificationLink(n.link) ?? "/dashboard";
  // The service worker shows notifications with the same tag ON TOP OF each other: a second one
  // REPLACES the first. That is right for a repeat about the SAME thing and wrong for two different
  // ones, so the tag is the kind PLUS where it points.
  //
  // It used to be the kind alone, and that quietly threw away news. Two clients messaging one
  // accountant both tagged "message", so the second wiped the first off the device — the accountant
  // never saw that the first client had written at all. Same shape on the bank side: "Factuur
  // betaald" and "Nog een deel van deze betaling open" are both type `payment` and say different
  // things about the same money. Notifications that point at the same screen still collapse, which
  // is the case the original rule was after.
  const kind = (n.type ?? "").trim() || "boekbrug";
  const tag = url === "/dashboard" ? kind : `${kind}:${url}`;
  return { title, body, url, tag };
}

/**
 * A Web Push endpoint is GONE (unsubscribed / expired) when the push service
 * answers 404 or 410. Those — and only those — mean the row must be pruned; any
 * other status (429 rate-limit, 5xx outage) is transient and the row is kept.
 */
export function isGoneStatus(status: number | undefined | null): boolean {
  return status === 404 || status === 410;
}

/**
 * The VAPID contact, in the shape the push services actually accept — or null when there is
 * nothing usable.
 *
 * ── WHY THIS EXISTS: PUSH WAS OFF IN PRODUCTION FOR THREE WEEKS ──
 * VAPID_SUBJECT was set to a bare e-mail address. web-push requires a URI: it runs
 * `new URL(subject)` and then demands protocol `https:` or `mailto:`
 * (node_modules/web-push/src/vapid-helper.js:68). A bare address parses as nothing at all, so
 * every single send threw "Vapid subject is not a valid URL" — 30 failures across 23 users
 * between 31 July and 19 August, on the cron routes, the intake and every notification write.
 *
 * The feature failed in the quietest way available: push.ts catches, logs and disables, exactly
 * as its no-throw contract requires, so nothing broke and nobody was told. An operator who fills
 * a field labelled "contact" with a contact address is not making a mistake worth losing a
 * feature over — so the address is completed here instead of rejected.
 *
 * What is NOT done: an `http:` URL is not upgraded to `https:`, and nothing is invented. Those
 * would change WHO the push service reaches, which is the one thing this value is for.
 */
export function normalizeVapidSubject(raw: string | undefined | null): string | null {
  const subject = raw?.trim();
  if (!subject) return null;

  // Already a URI? Then it is accepted or rejected exactly as web-push would.
  const asUri = parseAllowedSubject(subject);
  if (asUri) return asUri;

  // A bare e-mail address is the one thing worth completing: it is what someone types into a
  // field asking for a contact, and `mailto:` is the only URI it could have meant.
  if (looksLikeBareEmail(subject)) return parseAllowedSubject(`mailto:${subject}`);

  return null;
}

/** The subject if web-push would take it: parseable, and https: or mailto:. */
function parseAllowedSubject(candidate: string): string | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "mailto:" ? candidate : null;
}

/**
 * Deliberately strict, because the cost of being wrong is asymmetric: a false positive turns a
 * typo into a `mailto:` the push service cannot reach, while a false negative just leaves the
 * feature off — which is where it already was. One @, something either side, no whitespace, and
 * no scheme of its own.
 */
function looksLikeBareEmail(value: string): boolean {
  return /^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(value);
}

/**
 * VAPID config is complete only when BOTH keys are set AND the contact subject is one the push
 * services will accept. It checked only that the subject was non-empty, which is precisely how a
 * value that is present and unusable got all the way to web-push and disabled the feature there.
 */
export function isVapidConfigured(env: {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
}): boolean {
  return Boolean(
    env.publicKey?.trim() && env.privateKey?.trim() && normalizeVapidSubject(env.subject),
  );
}
