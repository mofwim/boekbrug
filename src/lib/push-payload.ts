// src/lib/push-payload.ts
// [PUSH] Pure helpers for Web Push — no I/O, fully testable
// (run: npx tsx src/lib/push-payload.test.ts).
//
// Kept separate from push.ts (which does the web-push network send) so the
// decision logic — what payload a notification becomes, and which send-errors
// mean "this subscription is dead, delete it" — is a pure arithmetic core the
// sender can't get subtly wrong.

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
  const link = (n.link ?? "").trim();
  const url = link.startsWith("/") ? link : "/dashboard";
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

/** VAPID config is complete only when BOTH keys AND a contact subject are set. */
export function isVapidConfigured(env: {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
}): boolean {
  return Boolean(env.publicKey?.trim() && env.privateKey?.trim() && env.subject?.trim());
}
