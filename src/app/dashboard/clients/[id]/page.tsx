'use client'

// src/app/dashboard/clients/[id]/page.tsx
// [BOEK-028] Client detail — Section 1: klantgegevens, Section 2: Working Place Q1–Q4 — May 2026

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter, useParams } from 'next/navigation'
import { notFound } from 'next/navigation'
import { useSubPageHeader } from '@/components/nav/SubPageHeaderContext'
import type { ProfileRow } from '@/types/rows'

const LAST_CLIENT_KEY = 'last_client_id'

export default function ClientDetailPage() {
  const router = useRouter()
  const params = useParams()
  const clientId = params?.id as string
  const supabase = createClient()

  const [client, setClient] = useState<ProfileRow | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  // [SEARCH-LANDING] A stale/unlinked client id (deleted, or an accountant not
  // linked to it → RLS returns no row) must land on a real 404, not an empty
  // card full of "—" placeholders that looks like a broken page.
  const [missing, setMissing] = useState(false)

  const year = new Date().getFullYear()
  const currentQ = Math.ceil((new Date().getMonth() + 1) / 3)

  if (!clientId) notFound()

  useEffect(() => {
    localStorage.setItem(LAST_CLIENT_KEY, clientId)
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: clientData } = await supabase.from('profiles').select('*').eq('id', clientId).single()
      if (clientData) setClient(clientData)
      else setMissing(true)
      const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true })
        .eq('sender_id', clientId).eq('receiver_id', user.id).eq('read', false)
      setUnreadCount(count || 0)
      setLoading(false)
    }
    load()
  }, [clientId])

  async function removeClient() {
    const confirmed = window.confirm(`Weet je zeker dat je ${client?.company_name || client?.full_name} wilt ontkoppelen?`)
    if (!confirmed) return

    // Call API — handles email + audit + notification server-side
    const res = await fetch('/api/accountant/unlink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    })

    if (res.ok) {
      router.push('/dashboard')
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error || 'Ontkoppelen mislukt')
    }
  }

  // [SUBNAV] Push the client name + Ontkoppelen action into the shared header.
  // Called unconditionally (before the loading return) so hook order is stable;
  // title is undefined until the client loads (bar shows the "Klant" base label).
  useSubPageHeader(
    {
      title: client?.company_name || client?.full_name || undefined,
      actions: (
        <button
          onClick={removeClient}
          style={{ fontSize: 13, fontWeight: 500, color: '#EA4335', background: 'none', border: '1px solid #EA4335', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          Ontkoppelen
        </button>
      ),
    },
    [client?.company_name, client?.full_name]
  )

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FA' }}>
      <p style={{ fontSize: 14, color: '#5F6368' }}>Laden...</p>
    </div>
  )

  // Placed AFTER all hooks + the loading guard (never skips a hook): a stale/unlinked
  // client id resolves to a real 404 instead of a card full of "—" placeholders.
  if (missing) notFound()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: "'Roboto', sans-serif" }}>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Sectie 1: Klantgegevens ── */}
        {/* [BOEK-028] Design System — Workspace card — May 2026 */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E0E0E0' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#5F6368', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
              Klantgegevens
            </p>
          </div>

          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Naam */}
            <div>
              <p style={{ fontSize: 11, color: '#5F6368', marginBottom: 2 }}>Naam</p>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: 0 }}>
                {client?.company_name
                  ? `${client.company_name}${client?.full_name ? ` · ${client.full_name}` : ''}`
                  : client?.full_name || '—'}
              </p>
            </div>

            {/* Grid: KVK / BTW / IBAN / Email */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
              {[
                { label: 'KVK',    value: client?.kvk_number },
                { label: 'BTW',    value: client?.btw_number },
                { label: 'IBAN',   value: client?.iban },
                { label: 'E-mail', value: client?.email },
              ].map(f => (
                <div key={f.label}>
                  <p style={{ fontSize: 11, color: '#5F6368', marginBottom: 2 }}>{f.label}</p>
                  <p style={{ fontSize: 13, fontWeight: 500, color: '#202124', margin: 0, wordBreak: 'break-all' }}>
                    {f.value || '—'}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Action row */}
          <div style={{ borderTop: '1px solid #E0E0E0', display: 'flex' }}>
            <a
              href={`mailto:${client?.email || ''}`}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '12px', fontSize: 14, fontWeight: 500, color: '#1A73E8',
                borderRight: '1px solid #E0E0E0', textDecoration: 'none',
                transition: 'background 0.1s ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F9FA')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              ✉ Stuur e-mail
            </a>
            <button
              onClick={() => router.push(`/dashboard/messages/${clientId}`)}
              style={{
                flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '12px', fontSize: 14, fontWeight: 500, color: '#34A853',
                background: 'none', border: 'none', cursor: 'pointer',
                transition: 'background 0.1s ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F9FA')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              💬 Stuur bericht
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: 8, right: 12,
                  backgroundColor: '#EA4335', color: '#fff',
                  fontSize: 10, borderRadius: 9999, width: 16, height: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                }}>
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* ── Sectie 2: Working Place ── */}
        {/* [BOEK-028] Design System — Workspace card + Q buttons — May 2026 */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E0E0E0' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#202124', margin: 0 }}>Working Place</h2>
            <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0' }}>Selecteer een kwartaal</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: 16 }}>
            {[1, 2, 3, 4].map(q => {
              const isCurrent = q === currentQ
              return (
                <button
                  key={q}
                  onClick={() => router.push(`/dashboard/clients/${clientId}/kwartaal?q=${q}&year=${year}`)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '16px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    backgroundColor: isCurrent ? '#1A73E8' : '#F8F9FA',
                    color: isCurrent ? '#FFFFFF' : '#202124',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={e => { if (!isCurrent) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#E8F0FE' }}
                  onMouseLeave={e => { if (!isCurrent) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F8F9FA' }}
                >
                  <span style={{ fontSize: 11, fontWeight: 500, color: isCurrent ? 'rgba(255,255,255,0.7)' : '#5F6368' }}>
                    {year}
                  </span>
                  <span style={{ fontSize: 20, fontWeight: 700 }}>Q{q}</span>
                  {isCurrent && (
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>huidig</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Factuur opstellen */}
        <button
          onClick={() => router.push(`/dashboard/invoice/new?clientId=${clientId}`)}
          style={{
            width: '100%', padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            backgroundColor: '#1A73E8', color: '#FFFFFF', fontSize: 14, fontWeight: 500,
            transition: 'background 0.1s ease',
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1557B0')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1A73E8')}
        >
          + Factuur opstellen voor deze klant
        </button>

      </div>
    </div>
  )
}