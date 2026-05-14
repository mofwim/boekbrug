// src/lib/notifications.ts
// Helper لكتابة notifications في DB — يُستخدم من أي API route

import { SupabaseClient } from '@supabase/supabase-js'

type NotifType = 'invoice' | 'payment' | 'message' | 'invite' | 'status'

interface CreateNotifOptions {
  supabase: SupabaseClient
  userId: string
  title: string
  body?: string
  type: NotifType
  link?: string
}

/** كتابة إشعار واحد للمستخدم */
export async function createNotification({
  supabase,
  userId,
  title,
  body,
  type,
  link,
}: CreateNotifOptions): Promise<void> {
  await supabase.from('notifications').insert({
    user_id: userId,
    title,
    body: body ?? null,
    type,
    read: false,
    link: link ?? null,
  })
}