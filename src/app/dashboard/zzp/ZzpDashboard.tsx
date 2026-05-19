'use client'

// src/app/dashboard/zzp/ZzpDashboard.tsx
// [BOEK-029] Material You design — BoekBrug Design System v1.0 — May 2026

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { DashboardHeader } from '../_shared'
import { generateInvoiceFromPrompt } from '@/lib/ai'

// ─── Design tokens — BoekBrug Design System v1.0 ─────────────────────────────
const M3 = {
  primary:           '#1A73E8',
  onPrimary:         '#FFFFFF',
  primaryContainer:  '#D3E3FD',
  onPrimaryContainer:'#041E49',
  tertiary:          '#7B1FA2',
  tertiaryContainer: '#E1BEE7',
  surface:           '#FFFBFE',
  onSurface:         '#1C1B1F',
  success:           '#34A853',
  successContainer:  '#CEEAD6',
  warning:           '#E37400',
  warningContainer:  '#FEE8C4',
  outline:           '#79747E',
  error:             '#B3261E',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
const EL1  = '0 1px 2px rgba(0,0,0,0.08)'
const EL2  = '0 2px 6px rgba(0,0,0,0.12)'

const NL_EUR = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }) // reserved for future use

// ─── Main ─────────────────────────────────────────────────────────────────────
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
  // [BOEK-029] BOEK-011 integration — pending incoming invoices count
  const [pendingCount, setPendingCount]           = useState<number>(0)

  useEffect(() => { loadGlobal() }, [])

  async function loadGlobal() {
    const [{ data: link }, { data: notifData }, { count }] = await Promise.all([
      supabase.from('accountant_clients').select('accountant_id').eq('zzper_id', profile.id).maybeSingle(),
      supabase.from('notifications').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('receiver_id', profile.id).eq('read', false),
    ])
    if (link?.accountant_id) setAccountantId(link.accountant_id)
    if (notifData) setNotifications(notifData)
    setUnreadMessages(count || 0)

    // [BOEK-029] BOEK-011: fetch pending incoming invoices count
    try {
      const res = await fetch('/api/email/sync')
      if (res.ok) {
        const json = await res.json()
        setPendingCount(json.pending_count ?? 0)
      }
    } catch {
      // silent — badge blijft 0
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
    } catch {
      setAiError('Er ging iets mis. Probeer het opnieuw.')
    } finally { setAiLoading(false) }
  }

  const unreadNotifCount = notifications.filter(n => !n.read).length
  const firstName = profile.full_name?.split(' ')[0] ?? 'daar'

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>
      <DashboardHeader
        profile={profile} notifications={notifications}
        showNotifications={showNotifications} unreadNotifCount={unreadNotifCount}
        unreadMessages={unreadMessages}
        onToggleNotifications={() => { setShowNotifications(p => !p); if (!showNotifications && unreadNotifCount > 0) markAllRead() }}
        onMessagesClick={() => accountantId ? router.push(`/dashboard/messages/${accountantId}`) : router.push('/dashboard/messages')}
        onLogout={async () => { await supabase.auth.signOut(); router.push('/login') }}
      />

      <main style={{ maxWidth: 480, margin: '0 auto', padding: '32px 16px 100px' }}>

        {/* Greeting */}
        <p style={{ fontSize: 12, color: '#5F6368', marginBottom: 2, fontWeight: 500, letterSpacing: 0.2 }}>GOEDENDAG</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: M3.onSurface, marginBottom: 28, letterSpacing: -0.5 }}>
          {firstName} 👋
        </h1>

        {/* ── 4 action cards — [BOEK-029] new order — May 2026 ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* 1. Nieuwe factuur */}
          <ActionCard
            icon="receipt_long" iconBg={M3.primary} iconColor={M3.onPrimary}
            label="Nieuwe factuur" sub="Maak en verstuur direct"
            onClick={() => router.push('/dashboard/invoice/new')}
          />

          {/* 2. Mijn facturen */}
          <ActionCard
            icon="description" iconBg="#00897B" iconColor="#fff"
            label="Mijn facturen" sub="Bekijk en beheer je facturen"
            onClick={() => router.push('/dashboard/facturen')}
          />

          {/* 3. Inkomend — [BOEK-029] BOEK-011 integration */}
          <ActionCardBadge
            icon="mark_email_unread" iconBg="#0288D1" iconColor="#fff"
            label="Inkomend" sub="Facturen van leveranciers"
            badge={pendingCount}
            onClick={() => router.push('/dashboard/incoming')}
          />

          {/* 3. Mijn werkplek */}
          <ActionCard
            icon="work" iconBg={M3.success} iconColor="#fff"
            label="Mijn werkplek" sub="Klanten, bestanden en gegevens"
            onClick={() => router.push('/dashboard/werkplek')}
          />

          {/* 4. Werken met AI */}
          <ActionCard
            icon="star" iconBg={M3.tertiary} iconColor="#fff"
            label="Werken met AI" sub="Beschrijf je factuur, AI regelt de rest"
            onClick={() => setShowAiPanel(p => !p)}
            active={showAiPanel}
            activeColor={M3.tertiary}
            activeBg={M3.tertiaryContainer}
          />

          {/* AI Panel */}
          {showAiPanel && (
            <div style={{
              background: '#fff', borderRadius: R.lg, padding: '20px 16px',
              boxShadow: EL1, marginTop: -4,
              border: `1px solid ${M3.tertiaryContainer}`,
            }}>
              <p style={{ fontSize: 12, color: M3.tertiary, fontWeight: 600, marginBottom: 10, letterSpacing: 0.3 }}>
                SCHRIJF IN JOUW TAAL
              </p>
              <textarea
                value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={3}
                placeholder='"factuur voor Mohammed voor dakdekken, 3 uur à 85 euro"'
                style={{
                  width: '100%', borderRadius: R.md,
                  border: `2px solid ${aiPrompt ? M3.tertiary : '#79747E'}`,
                  padding: '14px 16px', fontSize: 16, resize: 'none',
                  fontFamily: FONT, outline: 'none', boxSizing: 'border-box',
                  background: M3.surface, color: M3.onSurface,
                  transition: 'border-color 0.15s',
                }}
              />
              {aiError && <p style={{ fontSize: 12, color: M3.error, marginTop: 6 }}>{aiError}</p>}
              <button
                onClick={handleAiGenerate} disabled={aiLoading || !aiPrompt.trim()}
                style={{
                  marginTop: 12, width: '100%', padding: '14px',
                  borderRadius: R.full, border: 'none',
                  cursor: aiLoading || !aiPrompt.trim() ? 'default' : 'pointer',
                  background: aiLoading || !aiPrompt.trim() ? '#E7E0EC' : M3.tertiary,
                  color: aiLoading || !aiPrompt.trim() ? '#79747E' : '#fff',
                  fontSize: 15, fontWeight: 600, transition: 'all 0.15s',
                }}
                onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
                onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
              >
                {aiLoading ? 'AI denkt na...' : 'Factuur aanmaken →'}
              </button>
            </div>
          )}

          {/* [BOEK-029] Financieel overzicht — replaces stats cards */}
          <ActionCard
            icon="bar_chart" iconBg={M3.warning} iconColor="#fff"
            label="Financieel overzicht" sub="BTW, omzet en cashflow"
            onClick={() => router.push('/dashboard/quarterly')}
          />

        </div>
      </main>

      {/* [BOEK-029] FAB — + Nieuwe factuur — Material You */}
      <Fab onClick={() => router.push('/dashboard/invoice/new')} />
    </div>
  )
}

// ─── Design system constants ──────────────────────────────────────────────────
const R = { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 }

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActionCard({ icon, iconBg, iconColor, label, sub, onClick, active, activeColor, activeBg }: {
  icon: string; iconBg: string; iconColor: string
  label: string; sub: string; onClick: () => void
  active?: boolean; activeColor?: string; activeBg?: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        background: active && activeBg ? activeBg : '#fff',
        borderRadius: R.lg, padding: '18px 16px',
        border: active && activeColor ? `2px solid ${activeColor}` : '2px solid transparent',
        boxShadow: EL1, cursor: 'pointer', textAlign: 'left', width: '100%',
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        WebkitTapHighlightColor: 'transparent',
      }}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      <div style={{
        width: 48, height: 48, borderRadius: R.md,
        background: iconBg, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0,
      }}>
        <span className="material-symbols-outlined" style={{ color: iconColor, fontSize: 24 }}>{icon}</span>
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1B1F', marginBottom: 2 }}>{label}</p>
        <p style={{ fontSize: 13, color: '#5F6368' }}>{sub}</p>
      </div>
      <span className="material-symbols-outlined" style={{ color: '#79747E', fontSize: 20 }}>chevron_right</span>
    </button>
  )
}

// [BOEK-029] StatCard removed — replaced by Financieel overzicht ActionCard

// [BOEK-029] ActionCardBadge — like ActionCard but with a numeric badge
function ActionCardBadge({ icon, iconBg, iconColor, label, sub, badge, onClick }: {
  icon: string; iconBg: string; iconColor: string
  label: string; sub: string; badge: number; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        background: '#fff', borderRadius: R.lg, padding: '18px 16px',
        border: '2px solid transparent',
        boxShadow: EL1, cursor: 'pointer', textAlign: 'left', width: '100%',
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        WebkitTapHighlightColor: 'transparent',
      }}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{
          width: 48, height: 48, borderRadius: R.md,
          background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-outlined" style={{ color: iconColor, fontSize: 24 }}>{icon}</span>
        </div>
        {/* Badge */}
        {badge > 0 && (
          <div style={{
            position: 'absolute', top: -4, right: -4,
            background: '#B3261E', color: '#fff',
            borderRadius: 9999, minWidth: 18, height: 18,
            fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px', fontFamily: FONT,
            border: '2px solid #F8F9FA',
          }}>
            {badge > 99 ? '99+' : badge}
          </div>
        )}
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1B1F', marginBottom: 2 }}>{label}</p>
        <p style={{ fontSize: 13, color: '#5F6368' }}>{sub}</p>
      </div>
      <span className="material-symbols-outlined" style={{ color: '#79747E', fontSize: 20 }}>chevron_right</span>
    </button>
  )
}

// [BOEK-029] Shared FAB — + Nieuwe factuur — all ZZP pages
function Fab({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'fixed',
        bottom: 'calc(24px + env(safe-area-inset-bottom))',
        right: 20,
        background: '#D3E3FD',
        color: '#041E49',
        borderRadius: 16,
        padding: '16px 20px',
        fontSize: 15, fontWeight: 600,
        border: 'none', cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: "'Google Sans', 'Roboto', sans-serif",
        zIndex: 50,
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
      }}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.95)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span>
      Nieuwe factuur
    </button>
  )
}