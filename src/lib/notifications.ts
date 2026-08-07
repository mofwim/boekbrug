// src/lib/notifications.ts
// [CONTROL] Canonical notification writer. The `notifications` table has NO
// authenticated INSERT policy (verified via live pg_policies), so every write
// MUST go through service_role. This helper self-creates the pipeline client so a
// caller can no longer pass an anon client by mistake — the previous signature
// took a `supabase` param, which silently 42501'd when handed
// createServerSupabaseClient(). Server-only — never import in a client component.

import { createPipelineClient } from './supabase-pipeline'
import { sendPushToUser } from './push'

/**
 * The five values the `type` CHECK constraint on public.notifications allows.
 * This is the ONE list. The routes that accept a type from the network validate
 * against it (see isNotificationType) — they used to keep their own literal copy,
 * which is how a sixth type gets accepted by a route and rejected by Postgres.
 */
export const NOTIFICATION_TYPES = ['invoice', 'payment', 'message', 'invite', 'status'] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

/** Narrow an untrusted value (request body) to a type the table will accept. */
export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(value)
}

interface CreateNotifOptions {
  userId: string
  title: string
  body?: string | null
  type: NotificationType
  link?: string | null
}

/**
 * The outcome of one write. Callers that branch on failure (the cron rounds count
 * what they sent; the bridge routes log which side was not reached) get a value
 * instead of an exception — this function never throws, so a notification can
 * never take down the operation that triggered it.
 */
export interface NotificationResult {
  ok: boolean
  error: string | null
}

/** Write one notification for a user — always via service_role — and push it. */
export async function createNotification({
  userId,
  title,
  body,
  type,
  link,
}: CreateNotifOptions): Promise<NotificationResult> {
  try {
    const pipeline = createPipelineClient()
    // [NO-SILENT-EMPTY] The error was not read here at all. supabase-js does not
    // throw on a rejected write, so an RLS refusal, a CHECK violation on `type` or
    // a dead connection all left this function returning normally — and the caller,
    // which had just done the work the notification is about, went on believing the
    // owner had been told. Every insert in the app now runs through this one line,
    // so this was the single blind spot that covered all of them.
    const { error } = await pipeline.from('notifications').insert({
      user_id: userId,
      title,
      body: body ?? null,
      type,
      read: false,
      link: link ?? null,
    })

    if (error) {
      console.error('[NOTIFY] notification insert failed', {
        userId,
        type,
        error: error.message,
      })
      // [PUSH] Deliberately NO push on a failed write. The push is a pointer to the
      // row: it repeats the title and, on tap, opens `link`. Sending it anyway
      // produces a phone notification for a notification that does not exist — the
      // owner taps it, lands on the screen, finds nothing, and the bell that is
      // supposed to be the record is empty. A missed push is a silence; a push
      // without its row is a claim the app cannot back up.
      return { ok: false, error: error.message }
    }

    // [PUSH] Also deliver to the user's devices as a system notification. Strictly
    // best-effort: sendPushToUser never throws and no-ops when push is unconfigured
    // or the user has no subscribed device — the in-app row above is the source of
    // truth and must never be held hostage by a push delivery.
    await sendPushToUser(userId, { title, body, type, link })
    return { ok: true, error: null }
  } catch (err) {
    // createPipelineClient() THROWS when the service-role env vars are missing, and
    // that throw used to land in the caller — in the middle of a route that had
    // already booked a payment or issued an invoice number. The notification is the
    // last step of every one of those; it reports, it does not decide.
    const message = err instanceof Error ? err.message : String(err)
    console.error('[NOTIFY] notification write threw', { userId, type, error: message })
    return { ok: false, error: message }
  }
}
