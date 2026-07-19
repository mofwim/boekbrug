// [SHABSHAB] Online transport over Supabase Realtime broadcast channels.
//
// No dedicated game server: two players join the same channel `shabshab-<CODE>`.
// One is the authoritative host (simulates the fight and broadcasts snapshots),
// the other is the guest (streams its input up and renders snapshots down).
// Presence is used purely to detect when the peer connects / disconnects.
//
// This reuses the app's existing anon Supabase client, so it works on Vercel
// with the same env the rest of BoekBrug already needs. If those env vars are
// missing, `onlineAvailable()` returns false and the UI hides the online modes.

import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase'

export type Role = 'host' | 'guest'
export type ConnStatus = 'connecting' | 'connected' | 'error' | 'closed'

export interface RoomHandlers {
  // A game message from the peer: (event name, payload).
  onData: (event: string, payload: unknown) => void
  onPeerJoin: () => void
  onPeerLeave: () => void
  onStatus?: (status: ConnStatus, detail?: string) => void
}

export interface Room {
  send: (event: string, payload?: unknown) => void
  close: () => void
}

export function onlineAvailable(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

// A short, human-friendly, unambiguous room code (no 0/O/1/I).
export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

export function joinRoom(code: string, role: Role, handlers: RoomHandlers): Room {
  const supabase = createClient()
  const channel: RealtimeChannel = supabase.channel(`shabshab-${code.toUpperCase()}`, {
    config: { broadcast: { self: false, ack: false }, presence: { key: role } },
  })

  let peerSeen = false
  const other: Role = role === 'host' ? 'guest' : 'host'

  const checkPeer = () => {
    const state = channel.presenceState<{ role: Role }>()
    const present = Array.isArray(state[other]) && state[other].length > 0
    if (present && !peerSeen) {
      peerSeen = true
      handlers.onPeerJoin()
    } else if (!present && peerSeen) {
      peerSeen = false
      handlers.onPeerLeave()
    }
  }

  channel
    .on('broadcast', { event: 'm' }, ({ payload }) => {
      const p = payload as { e: string; p: unknown }
      handlers.onData(p.e, p.p)
    })
    .on('presence', { event: 'sync' }, checkPeer)
    .on('presence', { event: 'join' }, checkPeer)
    .on('presence', { event: 'leave' }, checkPeer)
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        handlers.onStatus?.('connected')
        void channel.track({ role })
      } else if (status === 'CHANNEL_ERROR') {
        handlers.onStatus?.('error', err?.message ?? 'channel error')
      } else if (status === 'TIMED_OUT') {
        handlers.onStatus?.('error', 'timed out')
      } else if (status === 'CLOSED') {
        handlers.onStatus?.('closed')
      } else {
        handlers.onStatus?.('connecting')
      }
    })

  return {
    send: (event, payload) => {
      void channel.send({ type: 'broadcast', event: 'm', payload: { e: event, p: payload ?? null } })
    },
    close: () => {
      void supabase.removeChannel(channel)
    },
  }
}
