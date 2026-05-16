'use client'

// src/app/dashboard/clients/[id]/page.tsx
// [BOEK-028] Client detail — Section 1: klantgegevens, Section 2: Working Place Q1–Q4 — May 2026

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { notFound } from 'next/navigation'

const LAST_CLIENT_KEY = 'last_client_id'

export default function ClientDetailPage() {
  const router = useRouter()
  const params = useParams()
  const clientId = params?.id as string
  const supabase = createClient()

  const [client, setClient] = useState<any>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const year = new Date().getFullYear()
  const currentQ = Math.ceil((new Date().getMonth() + 1) / 3)

  if (!clientId) notFound()

  useEffect(() => {
    // [BOEK-028] Persist last visited client — May 2026
    localStorage.setItem(LAST_CLIENT_KEY, clientId)

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: clientData } = await supabase
        .from('profiles').select('*').eq('id', clientId).single()
      if (clientData) setClient(clientData)

      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender_id', clientId)
        .eq('receiver_id', user.id)
        .eq('read', false)
      setUnreadCount(count || 0)

      setLoading(false)
    }
    load()
  }, [clientId])

  async function removeClient() {
    const confirmed = window.confirm(
      `Weet je zeker dat je ${client?.company_name || client?.full_name} wilt ontkoppelen?`
    )
    if (!confirmed) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase
      .from('accountant_clients')
      .delete()
      .eq('accountant_id', user.id)
      .eq('zzper_id', clientId)
    router.push('/dashboard')
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-bg, #f2f2f7)' }}>
      <p className="text-sm" style={{ color: '#8e8e93' }}>Laden...</p>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg, #f2f2f7)' }}>

      {/* Sticky header */}
      <div className="sticky top-0 z-20 px-4 py-3 border-b"
        style={{ backgroundColor: 'var(--color-card, #fff)', borderColor: 'var(--color-separator, #e5e5ea)' }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => router.push('/dashboard')}
              className="text-sm font-medium flex-shrink-0" style={{ color: '#007aff' }}>
              ← Terug
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-bold truncate"
                style={{ color: 'var(--color-text-primary, #1c1c1e)' }}>
                {client?.company_name || client?.full_name}
              </h1>
              <p className="text-xs truncate" style={{ color: '#636366' }}>
                {client?.email}
              </p>
            </div>
          </div>
          <button onClick={removeClient}
            className="text-xs font-medium px-2.5 py-1.5 rounded-xl flex-shrink-0"
            style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
            Ontkoppelen
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* ── Sectie 1: Klantgegevens ─────────────────────── */}
        {/* [BOEK-028] client info + email/message buttons — May 2026 */}
        <div className="rounded-2xl overflow-hidden"
          style={{ backgroundColor: 'var(--color-card, #fff)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>

          <div className="px-4 pt-4 pb-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: '#8e8e93' }}>Klantgegevens</p>

            {/* Naam */}
            <div>
              <p className="text-xs mb-0.5" style={{ color: '#8e8e93' }}>Naam</p>
              <p className="text-sm font-semibold" style={{ color: '#1c1c1e' }}>
                {client?.company_name
                  ? `${client.company_name}${client?.full_name ? ` · ${client.full_name}` : ''}`
                  : client?.full_name || '—'}
              </p>
            </div>

            {/* Grid: KVK / BTW / IBAN / Email */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {[
                { label: 'KVK',    value: client?.kvk_number },
                { label: 'BTW',    value: client?.btw_number },
                { label: 'IBAN',   value: client?.iban },
                { label: 'E-mail', value: client?.email },
              ].map(f => (
                <div key={f.label}>
                  <p className="text-xs mb-0.5" style={{ color: '#8e8e93' }}>{f.label}</p>
                  <p className="text-xs font-semibold break-all" style={{ color: '#1c1c1e' }}>
                    {f.value || '—'}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Action row — Stuur e-mail + Stuur bericht */}
          <div className="flex border-t" style={{ borderColor: 'var(--color-separator, #e5e5ea)' }}>
            <a href={`mailto:${client?.email || ''}`}
              className="flex-1 flex items-center justify-center gap-1.5 py-3.5 text-sm font-semibold border-r active:opacity-70 transition-opacity"
              style={{ color: '#007aff', borderColor: 'var(--color-separator, #e5e5ea)', textDecoration: 'none' }}>
              ✉ Stuur e-mail
            </a>
            <button
              onClick={() => router.push(`/dashboard/messages/${clientId}`)}
              className="flex-1 relative flex items-center justify-center gap-1.5 py-3.5 text-sm font-semibold active:opacity-70 transition-opacity"
              style={{ color: '#34c759' }}>
              💬 Stuur bericht
              {unreadCount > 0 && (
                <span className="absolute top-2 right-3 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* ── Sectie 2: Working Place ──────────────────────── */}
        {/* [BOEK-028] Q1–Q4 buttons scoped to client + year — May 2026 */}
        <div className="rounded-2xl overflow-hidden"
          style={{ backgroundColor: 'var(--color-card, #fff)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>

          <div className="px-4 py-4 border-b"
            style={{ borderColor: 'var(--color-separator, #e5e5ea)' }}>
            <h2 className="text-base font-semibold" style={{ color: '#1c1c1e' }}>
              Working Place
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#8e8e93' }}>
              Selecteer een kwartaal
            </p>
          </div>

          <div className="grid grid-cols-4 gap-3 p-4">
            {[1, 2, 3, 4].map(q => {
              const isCurrent = q === currentQ
              return (
                <button
                  key={q}
                  onClick={() =>
                    router.push(`/dashboard/clients/${clientId}/kwartaal?q=${q}&year=${year}`)
                  }
                  className="flex flex-col items-center gap-1 py-4 rounded-2xl transition-all active:scale-95"
                  style={{
                    backgroundColor: isCurrent ? '#1c1c1e' : '#f2f2f7',
                    color: isCurrent ? '#fff' : '#1c1c1e',
                    boxShadow: isCurrent ? '0 2px 8px rgba(0,0,0,0.18)' : 'none',
                  }}
                >
                  <span className="text-xs font-semibold"
                    style={{ color: isCurrent ? 'rgba(255,255,255,0.5)' : '#8e8e93' }}>
                    {year}
                  </span>
                  <span className="text-xl font-black">Q{q}</span>
                  {isCurrent && (
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      huidig
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Factuur opstellen */}
        <button
          onClick={() => router.push(`/dashboard/invoice/new?clientId=${clientId}`)}
          className="w-full py-3 rounded-2xl text-sm font-semibold"
          style={{ backgroundColor: '#af52de', color: '#fff' }}>
          + Factuur opstellen voor deze klant
        </button>

      </div>
    </div>
  )
}