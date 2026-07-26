'use client'

// src/app/dashboard/messages/[id]/page.tsx
// BOEK-007: صفحة المحادثة — مع skeleton + optimistic UI + realtime

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
import type { ProfileRow, MessageRow } from '@/types/rows'

// Alleen de kolommen die deze pagina ophaalt — een volledige ProfileRow beloven terwijl er
// vier velden geselecteerd zijn, is een leugen die pas bij gebruik stukgaat.
type ChatProfile = Pick<ProfileRow, 'id' | 'full_name' | 'company_name' | 'email'>

// Skeleton للرسائل أثناء التحميل
function MessageSkeleton({ isMe }: { isMe: boolean }) {
  return (
    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} animate-pulse`}>
      <div className={`h-9 rounded-2xl bg-gray-100 ${isMe ? 'w-48' : 'w-64'}`} />
    </div>
  )
}

export default function ConversationPage() {
  const router = useRouter()
  const params = useParams()
  const otherId = params.id as string
  const supabase = createClient()
  const bottomRef = useRef<HTMLDivElement>(null)

  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [otherProfile, setOtherProfile] = useState<ChatProfile | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function fetchMessages() {
    const res = await fetch(`/api/messages?with=${otherId}`)
    const data = await res.json()
    if (data.messages) setMessages(data.messages)
  }

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setCurrentUserId(user.id)

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, company_name, email')
        .eq('id', otherId)
        .single()

      if (profile) setOtherProfile(profile)

      await fetchMessages()
      setLoading(false)
    }
    load()
  }, [otherId])

  // Scroll للأسفل عند كل رسالة جديدة
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Realtime — رسائل جديدة تصل تلقائياً
  useEffect(() => {
    if (!currentUserId) return

    const channel = supabase
      .channel(`messages-${currentUserId}-${otherId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages'
      }, (payload) => {
        const msg = payload.new as MessageRow
        const isRelevant =
          (msg.sender_id === currentUserId && msg.receiver_id === otherId) ||
          (msg.sender_id === otherId && msg.receiver_id === currentUserId)
        if (isRelevant) fetchMessages()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [currentUserId, otherId])

  async function handleSend() {
    if (!input.trim() || sending) return

    setSending(true)
    setError('')
    const content = input.trim()
    setInput('')

    // Optimistic UI — الرسالة تظهر فوراً
    const optimistic = {
      id: `temp-${Date.now()}`,
      sender_id: currentUserId,
      receiver_id: otherId,
      content,
      read: false,
      created_at: new Date().toISOString()
    }
    setMessages(prev => [...prev, optimistic])

    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiver_id: otherId, content })
    })

    if (!res.ok) {
      // إلغاء الـ optimistic عند الفشل
      setMessages(prev => prev.filter(m => m.id !== optimistic.id))
      setInput(content)
      setError('Verzenden mislukt — probeer opnieuw')
    } else {
      await fetchMessages()
    }

    setSending(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const otherName = otherProfile?.company_name || otherProfile?.full_name || '...'

  // [SUBNAV] Conversation partner's name as the shared sub-page header title
  // (back is provided there too). The chat fills exactly the space below the
  // shared bar (height below), so the composer stays pinned on-screen.
  useSubPageHeader({ title: otherName }, [otherName])

  return (
    <div
      className="bg-[#f8f9fa] flex flex-col"
      style={{ height: 'calc(100dvh - 56px - env(safe-area-inset-top))' }}
    >

      {/* Berichten */}
      <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-4 space-y-3 overflow-y-auto">

        {loading ? (
          <>
            <MessageSkeleton isMe={false} />
            <MessageSkeleton isMe={true} />
            <MessageSkeleton isMe={false} />
            <MessageSkeleton isMe={true} />
          </>
        ) : messages.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-2xl mb-2">👋</p>
            <p className="text-gray-400 text-sm">
              Stuur een bericht aan {otherName}
            </p>
          </div>
        ) : (
          messages.map(msg => {
            const isMe = msg.sender_id === currentUserId
            const isOptimistic = msg.id.startsWith('temp-')
            return (
              <div
                key={msg.id}
                className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm transition-opacity ${
                    isOptimistic ? 'opacity-60' : 'opacity-100'
                  } ${
                    isMe
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-white text-gray-900 shadow-sm rounded-bl-md'
                  }`}
                >
                  <p className="leading-relaxed">{msg.content}</p>
                  <p className={`text-xs mt-1 ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                    {msg.created_at
                      ? new Date(msg.created_at).toLocaleTimeString('nl-NL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}
                  </p>
                </div>
              </div>
            )
          })
        )}

        <div ref={bottomRef} />
      </div>

      {/* Foutmelding */}
      {error && (
        <div className="max-w-3xl mx-auto w-full px-6">
          <p className="text-xs text-red-500 text-center py-1">{error}</p>
        </div>
      )}

      {/* Input */}
      <div className="bg-white border-t border-gray-200 px-6 py-4 sticky bottom-0">
        <div className="max-w-3xl mx-auto flex items-end gap-3">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Bericht aan ${otherName}... (Enter om te verzenden)`}
            rows={1}
            className="flex-1 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-blue-400 transition-colors"
            style={{ minHeight: '42px', maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="bg-blue-600 text-white px-4 py-2.5 rounded-2xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors flex-shrink-0"
          >
            {sending ? '...' : 'Stuur'}
          </button>
        </div>
      </div>

    </div>
  )
}
