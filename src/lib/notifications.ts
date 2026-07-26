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
}: CreateNotifOptions): Promise<void> {
  const pipeline = createPipelineClient()
  await pipeline.from('notifications').insert({
    user_id: userId,
    title,
    body: body ?? null,
    type,
    read: false,
    link: link ?? null,
  })

  // [PUSH] Also deliver to the user's devices as a system notification. Strictly
  // best-effort: sendPushToUser never throws and no-ops when push is unconfigured
  // or the user has no subscribed device — the in-app row above is the source of
  // truth and must never be held hostage by a push delivery.
  await sendPushToUser(userId, { title, body, type, link })
}
