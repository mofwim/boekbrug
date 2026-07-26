// src/lib/push.ts
// [PUSH] Server-only Web Push sender. Fans one in-app notification out to every
// device the user has subscribed. Best-effort by contract: it NEVER throws — a
// push failure must never break the in-app notification write that triggered it
// (that row is the source of truth; the push is a courtesy delivery).
//
// Robustness rules (the "no errors" contract):
//   - No VAPID env  → the feature is OFF: return silently, no throw, no log spam.
//   - Send error    → logged, not thrown. A 404/410 (gone) prunes that dead row
//                     so we never keep pushing to an uninstalled browser.
//   - One dead device never blocks the others (each send is independent).
//
// push_subscriptions is not yet in the generated Database types, so the pipeline
// client is cast (same relaxed-client pattern as btw_filings in /api/truth).

import webpush from "web-push";
import { createPipelineClient } from "./supabase-pipeline";
import { buildPushPayload, isGoneStatus, isVapidConfigured } from "./push-payload";

const VAPID = {
  publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
  // A mailto: (or https:) contact the push service can reach — required by VAPID.
  subject: process.env.VAPID_SUBJECT,
};

let vapidReady: boolean | null = null;
/** Configure web-push once. Returns false (and stays quiet) when unconfigured. */
function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  if (!isVapidConfigured(VAPID)) {
    vapidReady = false;
    return false;
  }
  try {
    webpush.setVapidDetails(VAPID.subject!, VAPID.publicKey!, VAPID.privateKey!);
    vapidReady = true;
  } catch (err) {
    console.error("[push] invalid VAPID config — push disabled:", err);
    vapidReady = false;
  }
  return vapidReady;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Deliver one notification to all of a user's devices. Safe to `await` from any
 * caller — resolves to the number of devices reached and swallows every error.
 */
export async function sendPushToUser(
  userId: string,
  notification: { title: string; body?: string | null; link?: string | null; type?: string | null },
): Promise<number> {
  try {
    if (!userId) return 0;
    if (!ensureVapid()) return 0; // feature off — silent no-op

    const pipeline = createPipelineClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (pipeline as any)
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (error) {
      console.error("[push] could not load subscriptions:", error.message ?? error);
      return 0;
    }
    const subs = (data ?? []) as SubRow[];
    if (subs.length === 0) return 0;

    const payload = JSON.stringify(buildPushPayload(notification));
    const dead: string[] = [];

    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 24 }, // hold up to 24h if the device is offline
        ),
      ),
    );

    let delivered = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        delivered++;
      } else {
        const status = (r.reason as { statusCode?: number })?.statusCode;
        if (isGoneStatus(status)) {
          dead.push(subs[i].id); // uninstalled/expired → prune
        } else {
          console.error("[push] send failed:", status ?? "", (r.reason as Error)?.message ?? r.reason);
        }
      }
    });

    if (dead.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (pipeline as any).from("push_subscriptions").delete().in("id", dead)
        .then(() => {}, (e: unknown) => console.error("[push] prune failed:", e));
    }

    return delivered;
  } catch (err) {
    // Absolute backstop — nothing about a push may ever surface to the caller.
    console.error("[push] unexpected error (swallowed):", err);
    return 0;
  }
}
