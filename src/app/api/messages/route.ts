// src/app/api/messages/route.ts
// BOEK-007: GET + POST

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { sendMessageNotification } from '@/lib/email'

// ── GET: جلب رسائل المحادثة ───────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const otherId = searchParams.get('with')
    if (!otherId) return NextResponse.json({ error: 'Gesprekspartner ontbreekt' }, { status: 400 })

    // [SEC-MESSAGE] otherId is interpolated into the PostgREST .or() filter below. Constrain it to a
    // UUID so a crafted value can't inject extra filter syntax and widen the match beyond this pair.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(otherId)) {
      return NextResponse.json({ error: 'Ongeldige gesprekspartner' }, { status: 400 })
    }

    const { data: messages, error } = await supabase
      .from('messages')
      .select('id, sender_id, receiver_id, content, read, created_at')
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${user.id})`)
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: 'Ophalen mislukt' }, { status: 500 })

    // تحديد الرسائل المستلمة كمقروءة
    const unreadIds = messages
      ?.filter(m => m.receiver_id === user.id && !m.read)
      .map(m => m.id) || []

    if (unreadIds.length > 0) {
      await supabase.from('messages').update({ read: true }).in('id', unreadIds)
    }

    return NextResponse.json({ messages: messages || [] })

  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}

// ── POST: إرسال رسالة ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { receiver_id, content } = body

    if (!receiver_id || !content?.trim()) {
      return NextResponse.json({ error: 'Ongeldig bericht' }, { status: 400 })
    }

    // [SEC-MESSAGE] You may only message someone you are LINKED to (accountant ↔ client).
    // Without this, any authenticated user could POST an arbitrary receiver_id and push an
    // in-app notification + e-mail (via service_role) to ANY user — a spam/abuse vector.
    // Fetch this user's own links (bounded) and check the pair IN CODE (receiver_id is never
    // interpolated into a SQL filter → no PostgREST filter injection).
    const { data: myLinks } = await supabase
      .from('accountant_clients')
      .select('accountant_id, zzper_id')
      .or(`accountant_id.eq.${user.id},zzper_id.eq.${user.id}`)
    const linked = (myLinks ?? []).some(
      (l) =>
        (l.accountant_id === user.id && l.zzper_id === receiver_id) ||
        (l.zzper_id === user.id && l.accountant_id === receiver_id),
    )
    if (!linked) {
      return NextResponse.json(
        { error: 'Je kunt alleen berichten sturen naar een gekoppelde klant of boekhouder' },
        { status: 403 },
      )
    }

    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        sender_id: user.id,
        receiver_id,
        content: content.trim(),
        read: false
      })
      .select()
      .single()

    if (error || !message) {
      return NextResponse.json({ error: 'Verzenden mislukt' }, { status: 500 })
    }

    // إشعار في قاعدة البيانات
    // [CONTROL] notifications has NO authenticated INSERT policy (verified via
    // live pg_policies) → an anon insert 42501s silently and the recipient never
    // gets the in-app notification. Write it via service_role.
    const pipeline = createPipelineClient()
    await pipeline.from('notifications').insert({
      user_id: receiver_id,
      title: 'Nieuw bericht',
      body: content.trim().slice(0, 80),
      type: 'message',
      read: false,
      link: `/dashboard/messages/${user.id}`
    })

    // إيميل إشعار — لا يوقف العملية عند الفشل
    const [{ data: senderProfile }, { data: receiverProfile }] = await Promise.all([
      supabase.from('profiles').select('full_name, company_name, email').eq('id', user.id).single(),
      supabase.from('profiles').select('email, full_name').eq('id', receiver_id).single()
    ])

// [BOEK-FOUNDATION-TYPES] Only send notification if recipient has email
    if (senderProfile && receiverProfile?.email) {
      const senderName = senderProfile.company_name || senderProfile.full_name || 'BoekBrug gebruiker'
      sendMessageNotification({
        toEmail: receiverProfile.email,
        receiverName: receiverProfile.full_name || 'Gebruiker',
        senderName,
        messagePreview: content.trim().slice(0, 120),
        conversationUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/messages/${user.id}`
      }).catch(() => null)
    }
    return NextResponse.json({ success: true, message })

  } catch {
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}
