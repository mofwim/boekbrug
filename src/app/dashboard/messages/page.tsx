'use client'

// src/app/dashboard/messages/page.tsx
// BOEK-007: قائمة المحادثات — مع skeleton loading

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

// Eén gesprek in de lijst: samengesteld uit berichten + de naam van de tegenpartij.
interface Conversation {
  otherId: string
  lastMessage: string
  lastAt: string | null
  unread: number
  name?: string | null
}

// Skeleton لصف محادثة واحدة
function ConversationSkeleton() {
  return (
    <div className="flex items-center justify-between px-5 py-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-gray-100 flex-shrink-0" />
        <div className="space-y-2">
          <div className="h-3 w-28 bg-gray-100 rounded-full" />
          <div className="h-2.5 w-44 bg-gray-100 rounded-full" />
        </div>
      </div>
      <div className="h-2.5 w-12 bg-gray-100 rounded-full" />
    </div>
  )
}

export default function MessagesPage() {
  const router = useRouter()
  const supabase = createClient()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: messages } = await supabase
        .from('messages')
        .select('id, sender_id, receiver_id, content, read, created_at')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false })

      if (!messages) { setLoading(false); return }

      // تجميع المحادثات — شخص واحد = محادثة واحدة
      const seen = new Set<string>()
      const convMap: Record<string, Conversation> = {}

      for (const msg of messages) {
        const otherId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id
        if (!seen.has(otherId)) {
          seen.add(otherId)
          convMap[otherId] = {
            otherId,
            lastMessage: msg.content,
            lastAt: msg.created_at,
            unread: !msg.read && msg.receiver_id === user.id ? 1 : 0
          }
        } else if (!msg.read && msg.receiver_id === user.id) {
          convMap[otherId].unread++
        }
      }

      // جلب أسماء الأشخاص
      const otherIds = Object.keys(convMap)
      if (otherIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, company_name')
          .in('id', otherIds)

        profiles?.forEach(p => {
          if (convMap[p.id]) convMap[p.id].name = p.company_name || p.full_name
        })
      }

      setConversations(Object.values(convMap))
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="min-h-screen bg-[#f8f9fa]">

      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">

          {loading ? (
            <div className="divide-y divide-gray-50">
              <ConversationSkeleton />
              <ConversationSkeleton />
              <ConversationSkeleton />
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-2xl mb-2">💬</p>
              <p className="text-gray-500 text-sm font-medium">Nog geen berichten</p>
              <p className="text-gray-300 text-xs mt-1">
                Stuur een bericht via de pagina van een klant of boekhouder
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {conversations.map(conv => (
                <div
                  key={conv.otherId}
                  onClick={() => router.push(`/dashboard/messages/${conv.otherId}`)}
                  className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm flex-shrink-0">
                      {conv.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className={`text-sm ${conv.unread > 0 ? 'font-bold text-gray-900' : 'font-medium text-gray-900'}`}>
                        {conv.name || 'Onbekend'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">
                        {conv.lastMessage}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <p className="text-xs text-gray-300">
                      {conv.lastAt ? new Date(conv.lastAt).toLocaleDateString('nl-NL') : ''}
                    </p>
                    {conv.unread > 0 && (
                      <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                        {conv.unread}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
