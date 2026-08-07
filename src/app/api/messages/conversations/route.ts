// src/app/api/messages/conversations/route.ts
// [NAAM-TEGENPARTIJ] The conversation list, assembled on the server.
//
// WHY THIS ROUTE EXISTS
// The screen used to build this itself: read every message with the browser client, group by
// counterparty, then `profiles.select().in('id', otherIds)` for the names. That last query returns
// NOTHING for a zzp'er. RLS on profiles is `id = auth.uid()` plus one policy that lets an
// ACCOUNTANT read a linked client; there is no policy the other way round. So the accountant saw
// his clients' names and the owner saw a list of "Onbekend" with a "?" avatar — on the screen whose
// only job is to show who is talking to you.
//
// Names therefore come from the service-role client, and only for people the caller demonstrably
// has a conversation with: every id here was produced by the caller's OWN messages, which RLS
// already scoped to them (messages_select_participant). No id from the request is involved.
//
// The read is capped, and the cap is REPORTED. An owner cannot be shown "these are your
// conversations" over a truncated scan without being told — see [GEEN-STILLE-KAP] elsewhere.

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createPipelineClient } from '@/lib/supabase-pipeline'

/** Newest messages scanned to build the list. Generous — a bridge is two people, not a mailbox. */
const SCAN_LIMIT = 1000

export interface ConversationSummary {
  otherId: string
  name: string | null
  lastMessage: string
  lastAt: string | null
  unread: number
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: messages, error, count } = await supabase
      .from('messages')
      .select('id, sender_id, receiver_id, content, read, created_at', { count: 'exact' })
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(SCAN_LIMIT)

    if (error) {
      // [NO-SILENT-EMPTY] supabase-js does not throw, so `?? []` here would render the screen's
      // empty state: "Nog geen berichten". That sentence is a claim about the owner's inbox, and a
      // failed read knows nothing about it — least of all on the surface where an accountant's
      // question arrives.
      console.error('[BERICHTEN] gesprekken ophalen mislukt', { userId: user.id, error: error.message })
      return NextResponse.json(
        {
          error: 'We konden je berichten nu niet ophalen. Probeer het zo meteen opnieuw — ' +
            'dit zegt niets over of er berichten voor je zijn.',
          code: 'messages_unavailable',
        },
        { status: 503 },
      )
    }

    // One person = one conversation. The rows arrive newest-first, so the first row seen for a
    // counterparty is that conversation's last message.
    const byOther = new Map<string, ConversationSummary>()
    for (const msg of messages ?? []) {
      const otherId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id
      const existing = byOther.get(otherId)
      const isUnreadForMe = !msg.read && msg.receiver_id === user.id
      if (!existing) {
        byOther.set(otherId, {
          otherId,
          name: null,
          lastMessage: msg.content,
          lastAt: msg.created_at,
          unread: isUnreadForMe ? 1 : 0,
        })
      } else if (isUnreadForMe) {
        existing.unread++
      }
    }

    const conversations = Array.from(byOther.values())

    if (conversations.length > 0) {
      const pipeline = createPipelineClient()
      const { data: profiles, error: profileErr } = await pipeline
        .from('profiles')
        .select('id, full_name, company_name')
        .in('id', conversations.map(c => c.otherId))
      if (profileErr) {
        // A nameless list still beats no list: the conversations are real and open fine.
        console.error('[BERICHTEN] namen ophalen mislukt', { userId: user.id, error: profileErr.message })
      }
      const nameOf = new Map(
        (profiles ?? []).map(p => [p.id, p.company_name || p.full_name || null] as const),
      )
      for (const c of conversations) c.name = nameOf.get(c.otherId) ?? null
    }

    const scanned = (messages ?? []).length
    return NextResponse.json({
      conversations,
      // [GEEN-STILLE-KAP] Say it when the scan did not reach the bottom, so the screen can too.
      truncated: typeof count === 'number' ? count > scanned : false,
      scanned,
      total: count ?? scanned,
    })
  } catch (err) {
    console.error('[BERICHTEN] gesprekken ophalen wierp', err)
    return NextResponse.json({ error: 'Onbekende fout' }, { status: 500 })
  }
}
