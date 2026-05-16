'use client'

// src/app/dashboard/zzp/ZzpDashboard.tsx
// [BOEK-029] Complete rebuild — Home screen: 3 buttons only — May 2026

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { DashboardHeader } from '../_shared'
import { createNotification } from '@/lib/notifications'
import { generateInvoiceFromPrompt } from '@/lib/ai'

const NL_EUR = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

export function ZzpDashboard({ profile }: { profile: any }) {
  const router   = useRouter()
  const supabase = createClient()

  const [notifications, setNotifications]         = useState<any[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadMessages, setUnreadMessages]       = useState(0)
  const [accountantId, setAccountantId]           = useState<string | null>(null)
  const [showAiPanel, setShowAiPanel]             = useState(false)
  const [aiPrompt, setAiPrompt]                   = useState('')
  const [aiLoading, setAiLoading]                 = useState(false)
  const [aiError, setAiError]                     = useState<string | null>(null)
  const [stats, setStats]                         = useState({ open: 0, openAmount: 0, paid: 0 })

  useEffect(() => { loadGlobal() }, [])

  async function loadGlobal() {
    const [{ data: link }, { data: notifData }, { count }, { data: invData }] = await Promise.all([
      supabase.from('accountant_clients').select('accountant_id').eq('zzper_id', profile.id).maybeSingle(),
      supabase.from('notifications').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('receiver_id', profile.id).eq('read', false),
      supabase.from('invoices').select('status, total_inc_btw').eq('sender_id', profile.id),
    ])
    if (link?.accountant_id) setAccountantId(link.accountant_id)
    if (notifData) setNotifications(notifData)
    setUnreadMessages(count || 0)
    if (invData) {
      let open = 0, openAmount = 0, paid = 0
      for (const inv of invData) {
        if (inv.status === 'sent' || inv.status === 'overdue') { open++; openAmount += inv.total_inc_btw ?? 0 }
        if (inv.status === 'paid') paid++
      }
      setStats({ open, openAmount, paid })
    }
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('user_id', profile.id).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return
    setAiLoading(true); setAiError(null)
    try {
      const result = await generateInvoiceFromPrompt(aiPrompt)
      const params = new URLSearchParams()
      if (result.client_name) params.set('client_name', result.client_name)
      if (result.description)  params.set('description', result.description)
      if (result.amount)       params.set('amount', String(result.amount))
      if (result.btw_rate)     params.set('btw_rate', String(result.btw_rate))
      router.push(`/dashboard/invoice/new?${params.toString()}`)
    } catch { setAiError('Er ging iets mis. Probeer het opnieuw.') }
    finally { setAiLoading(false) }
  }

  const unreadNotifCount = notifications.filter(n => !n.read).length
  const firstName = profile.full_name?.split(' ')[0] ?? 'daar'

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: 'var(--color-bg, #f2f2f7)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
      WebkitFontSmoothing: 'antialiased',
    }}>
      <DashboardHeader
        profile={profile} notifications={notifications}
        showNotifications={showNotifications} unreadNotifCount={unreadNotifCount}
        unreadMessages={unreadMessages}
        onToggleNotifications={() => { setShowNotifications(p => !p); if (!showNotifications && unreadNotifCount > 0) markAllRead() }}
        onMessagesClick={() => accountantId ? router.push(`/dashboard/messages/${accountantId}`) : router.push('/dashboard/messages')}
        onLogout={async () => { await supabase.auth.signOut(); router.push('/login') }}
      />

      <main style={{ maxWidth: 480, margin: '0 auto', padding: '32px 20px 60px' }}>
        <p style={{ fontSize: 13, color: '#8e8e93', marginBottom: 4 }}>Goedendag,</p>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1c1c1e', marginBottom: 32, letterSpacing: -0.5 }}>
          {firstName} 👋
        </h1>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* [BOEK-029] Button 1: Nieuwe factuur */}
          <HomeButton icon="+" iconBg="#007aff" label="Nieuwe factuur" sub="Maak en verstuur direct"
            onClick={() => router.push('/dashboard/invoice/new')} />

          {/* [BOEK-029] Button 2: Werken met AI */}
          <HomeButton icon="🤝" iconBg="#5856d6" label="Werken met AI" sub="Beschrijf je factuur, AI regelt de rest"
            onClick={() => setShowAiPanel(p => !p)} active={showAiPanel} />

          {showAiPanel && (
            <div style={{ background: '#fff', borderRadius: 16, padding: '18px 16px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', marginTop: -6 }}>
              <p style={{ fontSize: 12, color: '#8e8e93', marginBottom: 10 }}>Schrijf in jouw taal — AI vertaalt en vult in</p>
              <textarea
                value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={3}
                placeholder='"factuur voor Mohammed voor dakdekken, 3 uur à 85 euro"'
                style={{ width: '100%', borderRadius: 10, border: '1px solid #e5e5ea', padding: '10px 12px', fontSize: 14, resize: 'none', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
              />
              {aiError && <p style={{ fontSize: 12, color: '#ff3b30', marginTop: 6 }}>{aiError}</p>}
              <button onClick={handleAiGenerate} disabled={aiLoading || !aiPrompt.trim()}
                style={{ marginTop: 10, width: '100%', padding: '12px', borderRadius: 12, border: 'none', cursor: aiLoading ? 'default' : 'pointer', background: aiLoading || !aiPrompt.trim() ? '#e5e5ea' : '#5856d6', color: aiLoading || !aiPrompt.trim() ? '#8e8e93' : '#fff', fontSize: 15, fontWeight: 700 }}>
                {aiLoading ? 'AI denkt na...' : 'Factuur aanmaken →'}
              </button>
            </div>
          )}

          {/* [BOEK-029] Button 3: Mijn werkplek */}
          <HomeButton icon="→" iconBg="#34c759" label="Mijn werkplek" sub="Facturen, klanten en bestanden"
            onClick={() => router.push('/dashboard/werkplek')} />
        </div>

        {/* Quick stats strip */}
        {(stats.open > 0 || stats.paid > 0) && (
          <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: '#fff', borderRadius: 14, padding: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: 11, color: '#8e8e93', fontWeight: 500, marginBottom: 4 }}>Openstaand</p>
              <p style={{ fontSize: 17, fontWeight: 700, color: '#ff9500', letterSpacing: -0.3 }}>{NL_EUR.format(stats.openAmount)}</p>
              <p style={{ fontSize: 10, color: '#c7c7cc', marginTop: 2 }}>{stats.open} factuur{stats.open !== 1 ? 'en' : ''}</p>
            </div>
            <div style={{ background: '#fff', borderRadius: 14, padding: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: 11, color: '#8e8e93', fontWeight: 500, marginBottom: 4 }}>Betaald</p>
              <p style={{ fontSize: 17, fontWeight: 700, color: '#34c759', letterSpacing: -0.3 }}>{stats.paid}</p>
              <p style={{ fontSize: 10, color: '#c7c7cc', marginTop: 2 }}>factuur{stats.paid !== 1 ? 'en' : ''}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function HomeButton({ icon, iconBg, label, sub, onClick, active }: {
  icon: string; iconBg: string; label: string; sub: string; onClick: () => void; active?: boolean
}) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 16, background: '#fff', borderRadius: 18, padding: '18px 20px',
      border: `2px solid ${active ? iconBg : 'transparent'}`,
      boxShadow: '0 2px 10px rgba(0,0,0,0.07)', cursor: 'pointer', textAlign: 'left', width: '100%',
      transition: 'all 0.15s', WebkitTapHighlightColor: 'transparent',
    }}>
      <div style={{ width: 46, height: 46, borderRadius: 14, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#fff', fontWeight: 700, flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#1c1c1e', marginBottom: 2 }}>{label}</p>
        <p style={{ fontSize: 12, color: '#8e8e93' }}>{sub}</p>
      </div>
      <span style={{ fontSize: 18, color: '#c7c7cc' }}>›</span>
    </button>
  )
}