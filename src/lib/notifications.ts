// src/lib/notifications.ts
// [CONTROL] Canonical notification writer. The `notifications` table has NO
// authenticated INSERT policy (verified via live pg_policies), so every write
// MUST go through service_role. This helper self-creates the pipeline client so a
// caller can no longer pass an anon client by mistake — the previous signature
// took a `supabase` param, which silently 42501'd when handed
// createServerSupabaseClient(). Server-only — never import in a client component.

import { createPipelineClient } from './supabase-pipeline'
import { sendPushToUser } from './push'

type NotifType = 'invoice' | 'payment' | 'message' | 'invite' | 'status'

interface CreateNotifOptions {
  userId: string
  title: string
  body?: string
  type: NotifType
  link?: string
}

/** كتابة إشعار واحد للمستخدم — عبر service_role دائماً */
export async function createNotification({
  userId,
  title,
  body,
  type,
  link,
}: CreateNotifOptions): Promise<boolean> {
  return notifyRows([{ user_id: userId, title, body: body ?? null, type, read: false, link: link ?? null }])
}

/**
 * A notification row exactly as the table holds it.
 *
 * [BEL-BEREIKT-NIEMAND] This shape exists so the thirty call sites that were writing the table
 * DIRECTLY could be moved here without touching a single field. That mattered: their bodies are
 * long Dutch template literals, and rewriting them into the named-argument form above is a
 * thirty-way opportunity to change a sentence by accident. The prefix changes, the object does not.
 */
export interface NotificationRow {
  user_id: string
  title: string
  body?: string | null
  type: string
  read?: boolean
  link?: string | null
}

/**
 * [BEL-BEREIKT-NIEMAND] Write notification rows — the ONE place that does.
 *
 * This file has called itself "the canonical notification writer" from the day it was made, and it
 * was not: 30 of the app's 39 notification writes went straight to the table. Measured, and the
 * split was not random — the direct ones are the urgent ones, because urgency is written where the
 * event happens: "Laatste aanmaning verstuurd", "Laatste aanmaning mogelijk NIET verstuurd",
 * "Controleer deze betaling", "Terugkerende factuur staat klaar".
 *
 * What bypassing cost, and neither half was visible:
 *
 *   · NO PUSH. Only this file calls sendPushToUser, so a row written directly appears in the app
 *     and never on the owner's phone. An owner who turned push on to be told when something needs
 *     them was, for 30 of 39 messages, told nothing until they next opened the app themselves.
 *   · NO ERROR. supabase-js does not throw, and every one of those sites discarded `{ error }` —
 *     several inside a `catch {}` that could not fire. A bell that was never written looked
 *     exactly like a bell that rang.
 *
 * Returns whether the ROW landed. The push is deliberately not part of that answer: it is a second
 * delivery of something already recorded, and a phone that is offline is not a failure to notify.
 */
export async function notifyRows(rows: NotificationRow[]): Promise<boolean> {
  if (rows.length === 0) return true
  const pipeline = createPipelineClient()
  const { error } = await pipeline.from('notifications').insert(rows)
  if (error) {
    // Never thrown: a caller is always mid-way through something that already succeeded, and the
    // bell is the report of it. But never swallowed either — see the header.
    console.error('[BEL-BEREIKT-NIEMAND] melding NIET opgeslagen', {
      count: rows.length, titles: rows.map((r) => r.title), message: error.message,
    })
    return false
  }

  // [PUSH] Also deliver to the user's devices. Strictly best-effort: sendPushToUser never throws
  // and no-ops when push is unconfigured or the user has no subscribed device — the row above is
  // the source of truth and must never be held hostage by a delivery.
  await Promise.allSettled(
    rows.map((r) => sendPushToUser(r.user_id, { title: r.title, body: r.body, type: r.type, link: r.link })),
  )
  return true
}

/** One row. The shape 29 call sites already had, so moving them changed only the call. */
export async function notifyRow(row: NotificationRow): Promise<boolean> {
  return notifyRows([row])
}
