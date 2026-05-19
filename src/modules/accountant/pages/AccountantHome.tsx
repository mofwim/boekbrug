'use client'

// src/modules/accountant/pages/AccountantHome.tsx
// [BOEK-028] Accountant Portal — Phase 2 — May 2026
//
// Replaces AccountantDashboard.tsx.
// All data arrives as props (fetched server-side via accountant.repository.ts).
// This component handles UI state only — no supabase.from() for read queries.
//
// Preserved from old dashboard:
//   - "Ga verder waar je gebleven bent" (localStorage)
//   - "Samen werken met AI" panel
//   - Draft Queue floating panel (writes to draft_queue table — client-side, intentional)
//   - DashboardHeader

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { DashboardHeader } from '@/app/dashboard/_shared'
import { composeDraftEmail } from '@/lib/ai'
import type { AccountantOverview, ClientSummary, TodoItem } from '../accountant.types'

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

// [BOEK-028] localStorage key — kept as-is (fragile by design, deferred to DB later)
const LAST_CLIENT_KEY = 'last_client_id'

const STATUS_COLOR: Record<string, string> = {
  klaar:       '#34A853',
  bijna_klaar: '#FBBC04',
  wacht:       '#EA4335',
}

const STATUS_LABEL: Record<string, string> = {
  klaar:       'Klaar',
  bijna_klaar: 'Bijna klaar',
  wacht:       'Wacht',
}

const TODO_ICON: Record<string, string> = {
  invoices_to_process: '📄',
  missing_file:        '📁',
  client_question:     '❓',
}

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface DraftQueueItem {
  clientId: string
  clientName: string
  text: string
  addedAt: string
}

interface Props {
  profile: {
    id: string
    full_name: string | null
    company_name: string | null
    email: string | null
  }
  overview: AccountantOverview
  clients: ClientSummary[]
  todos: TodoItem[]
  notifications: any[]
  unreadMessages: number
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function greeting(fullName: string | null): string {
  const hour = new Date().getHours()
  const salut = hour < 12 ? 'Goedemorgen' : hour < 18 ? 'Goedemiddag' : 'Goedenavond'
  const first = fullName?.split(' ')[0] ?? ''
  return `${salut}${first ? `, ${first}` : ''}`
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export function AccountantHome({ profile, overview, clients, todos, notifications: initialNotifs, unreadMessages: initialUnread }: Props) {
  const router = useRouter()
  const supabase = createClient()

  // ── Notifications (client-side read for real-time badge) ──
  const [notifications, setNotifications] = useState(initialNotifs)
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadMessages] = useState(initialUnread)

  // ── Last client shortcut (localStorage) ──
  const [lastClientId, setLastClientId] = useState<string | null>(null)
  const [lastClientName, setLastClientName] = useState<string | null>(null)

  // ── AI assistant panel ──
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<{ subject: string; body: string } | null>(null)

  // ── Draft Queue ──
  const [draftQueue, setDraftQueue] = useState<DraftQueueItem[]>([])
  const [showDraftQueue, setShowDraftQueue] = useState(false)
  const [draftQueueClientId, setDraftQueueClientId] = useState('')
  const [draftInput, setDraftInput] = useState('')
  const [composing, setComposing] = useState(false)
  const [composedEmail, setComposedEmail] = useState<{ subject: string; body: string } | null>(null)

  // ── Init ──
  useEffect(() => {
    // Resolve last_client_id from localStorage
    const storedId = localStorage.getItem(LAST_CLIENT_KEY)
    if (storedId) {
      setLastClientId(storedId)
      const found = clients.find(c => c.id === storedId)
      if (found) setLastClientName(found.company_name || found.full_name)
      else localStorage.removeItem(LAST_CLIENT_KEY) // stale
    }

    // Load draft queue from DB
    async function loadDraftQueue() {
      const { data } = await supabase
        .from('draft_queue')
        .select('items')
        .eq('accountant_id', profile.id)
        .order('updated_at', { ascending: false })
        .limit(1)
      if (data?.[0]?.items) {
        try {
          const items = Array.isArray(data[0].items)
            ? data[0].items
            : JSON.parse(data[0].items)
          setDraftQueue(items)
        } catch { /* ignore */ }
      }
    }
    loadDraftQueue()
  }, [])

  // ─────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────

  function openClient(clientId: string) {
    localStorage.setItem(LAST_CLIENT_KEY, clientId)
    router.push(`/dashboard/clients/${clientId}`)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function markAllRead() {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', profile.id)
      .eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  // ─────────────────────────────────────────────────────────
  // AI assistant
  // ─────────────────────────────────────────────────────────

  async function handleAiPrompt() {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setAiResult(null)
    try {
      const result = await composeDraftEmail(
        profile.full_name || profile.company_name || 'Boekhouder',
        aiPrompt,
        [aiPrompt]
      )
      setAiResult(result)
    } catch {
      setAiResult({ subject: 'AI niet beschikbaar', body: 'Probeer het opnieuw.' })
    } finally {
      setAiLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────
  // Draft Queue
  // ─────────────────────────────────────────────────────────

  async function saveDraftQueue(updated: DraftQueueItem[]) {
    const { data: existing } = await supabase
      .from('draft_queue').select('id').eq('accountant_id', profile.id).limit(1)
    if (existing?.[0]) {
      await supabase.from('draft_queue')
        .update({ items: updated, updated_at: new Date().toISOString() })
        .eq('id', existing[0].id)
    } else {
      await supabase.from('draft_queue').insert({
        accountant_id: profile.id,
        client_id: draftQueueClientId || null,
        items: updated,
      })
    }
  }

  async function addManualItem() {
    if (!draftInput.trim() || !draftQueueClientId) return
    const client = clients.find(c => c.id === draftQueueClientId)
    const newItem: DraftQueueItem = {
      clientId: draftQueueClientId,
      clientName: client?.company_name || client?.full_name || 'Onbekend',
      text: draftInput.trim(),
      addedAt: new Date().toISOString(),
    }
    const updated = [...draftQueue, newItem]
    setDraftQueue(updated)
    setDraftInput('')
    await saveDraftQueue(updated)
  }

  async function composeEmail() {
    const clientForQueue = clients.find(c => c.id === draftQueueClientId)
    const clientName = clientForQueue?.company_name || clientForQueue?.full_name || 'Klant'
    const items = draftQueue
      .filter(i => !draftQueueClientId || i.clientId === draftQueueClientId)
      .map(i => i.text)
    if (items.length === 0) return
    setComposing(true)
    try {
      const result = await composeDraftEmail(
        profile.full_name || profile.company_name || 'Uw boekhouder',
        clientName,
        items
      )
      setComposedEmail(result)
    } catch {
      setComposedEmail({
        subject: `Ontbrekende stukken — ${clientName}`,
        body: `Beste ${clientName},\n\nKunnen jullie de volgende stukken aanleveren?\n\n${items.map(i => `• ${i}`).join('\n')}\n\nMet vriendelijke groet,\n${profile.full_name || 'Uw boekhouder'}`,
      })
    } finally {
      setComposing(false)
    }
  }

  async function clearDraftQueue() {
    setDraftQueue([])
    setComposedEmail(null)
    await supabase.from('draft_queue').update({ items: [] }).eq('accountant_id', profile.id)
  }

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  const unreadNotifCount = notifications.filter(n => !n.read).length
  const visibleQueueItems = draftQueue.filter(i => !draftQueueClientId || i.clientId === draftQueueClientId)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: "'Google Sans', 'Roboto', sans-serif" }}>

      {/* Header — unchanged */}
      <DashboardHeader
        profile={profile}
        notifications={notifications}
        showNotifications={showNotifications}
        unreadNotifCount={unreadNotifCount}
        unreadMessages={unreadMessages}
        onToggleNotifications={() => {
          setShowNotifications(prev => !prev)
          if (!showNotifications && unreadNotifCount > 0) markAllRead()
        }}
        onMessagesClick={() => router.push('/dashboard/messages')}
        onLogout={handleLogout}
      />

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 120 }}>

        {/* ── 1. Greeting ── */}
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#202124', margin: 0 }}>
          {greeting(profile.full_name)} 👋
        </h1>

        {/* ── 2. Three numbers ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            { value: overview.total_clients,     label: 'Klanten totaal' },
            { value: overview.ready_for_quarter,  label: 'Klaar voor KW' },
            { value: overview.waiting,            label: 'Wacht op stukken' },
          ].map(({ value, label }) => (
            <div
              key={label}
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E0E0E0',
                borderRadius: 8,
                padding: '16px 12px',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: 28, fontWeight: 700, color: '#202124', margin: '0 0 4px' }}>{value}</p>
              <p style={{ fontSize: 12, color: '#5F6368', margin: 0, lineHeight: 1.3 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* ── 3. Vandaag te doen ── */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>⚡</span>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>Vandaag te doen</h2>
          </div>

          {todos.length === 0 ? (
            <p style={{ fontSize: 14, color: '#34A853', padding: '16px', margin: 0, fontWeight: 500 }}>
              Alles bijgewerkt ✓
            </p>
          ) : (
            <div>
              {todos.map((todo, idx) => (
                <button
                  key={`${todo.client_id}-${todo.type}-${idx}`}
                  onClick={() => openClient(todo.client_id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    background: 'none',
                    border: 'none',
                    borderBottom: idx < todos.length - 1 ? '1px solid #F1F3F4' : 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F9FA')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{TODO_ICON[todo.type]}</span>
                  <span style={{ fontSize: 14, color: '#202124', flex: 1 }}>{todo.description}</span>
                  <span style={{ fontSize: 12, color: '#1A73E8', flexShrink: 0, fontWeight: 600 }}>→</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── 4. Mijn klanten ── */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>Mijn klanten</h2>
            <button
              onClick={() => router.push('/dashboard/clients/invite')}
              style={{
                backgroundColor: '#1A73E8', color: '#FFFFFF',
                border: 'none', borderRadius: 8,
                padding: '6px 14px', fontSize: 13, fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              + Klant
            </button>
          </div>

          {clients.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>
              Nog geen klanten — voeg je eerste klant toe
            </p>
          ) : (
            <div>
              {clients.map((client, idx) => (
                <button
                  key={client.id}
                  onClick={() => openClient(client.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    background: 'none',
                    border: 'none',
                    borderBottom: idx < clients.length - 1 ? '1px solid #F1F3F4' : 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s',
                    minHeight: 56,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F9FA')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  {/* Status dot */}
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    backgroundColor: STATUS_COLOR[client.status] ?? '#E0E0E0',
                  }} />

                  {/* Name + email */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.company_name ?? client.full_name ?? '—'}
                    </p>
                    <p style={{ fontSize: 12, color: '#5F6368', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.email}
                    </p>
                  </div>

                  {/* Status chip + arrow */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 500,
                      padding: '2px 8px', borderRadius: 4,
                      backgroundColor: client.status === 'klaar' ? '#CEEAD6' : client.status === 'bijna_klaar' ? '#FEF7E0' : '#FCE8E6',
                      color: client.status === 'klaar' ? '#137333' : client.status === 'bijna_klaar' ? '#EA8600' : '#C5221F',
                    }}>
                      {STATUS_LABEL[client.status]}
                    </span>
                    <span style={{ fontSize: 13, color: '#1A73E8', fontWeight: 600 }}>→</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Last client shortcut (preserved) ── */}
        {lastClientId && lastClientName && (
          <button
            onClick={() => openClient(lastClientId)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
              backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8,
              background: 'none',
            }}
          >
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#5F6368', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>
                Ga verder waar je gebleven bent
              </p>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{lastClientName}</p>
            </div>
            <span style={{ fontSize: 16, color: '#1A73E8' }}>→</span>
          </button>
        )}

        {/* ── AI assistant panel (preserved) ── */}
        <button
          onClick={() => { setShowAiPanel(p => !p); setAiResult(null); setAiPrompt('') }}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
            backgroundColor: '#202124', color: '#FFFFFF', border: 'none', borderRadius: 8,
          }}
        >
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 2px' }}>
              AI Assistent
            </p>
            <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Samen werken met AI ✨</p>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>{showAiPanel ? '▲' : '▼'}</span>
        </button>

        {showAiPanel && (
          <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: '#5F6368', margin: 0 }}>
              Schrijf wat je wilt doen — de AI stelt het voor je op.
            </p>
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              rows={3}
              placeholder="bijv. bereid BTW aangifte voor klant Jansen BV..."
              style={{ width: '100%', fontSize: 14, padding: '8px 12px', border: '1px solid #BDBDBD', borderRadius: 8, backgroundColor: '#F8F9FA', color: '#202124', resize: 'none', boxSizing: 'border-box' }}
            />
            <button
              onClick={handleAiPrompt}
              disabled={aiLoading || !aiPrompt.trim()}
              style={{ backgroundColor: '#202124', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: (aiLoading || !aiPrompt.trim()) ? 0.4 : 1 }}
            >
              {aiLoading ? 'AI werkt...' : 'Genereer ✨'}
            </button>
            {aiResult && (
              <div style={{ backgroundColor: '#F8F9FA', border: '1px solid #E0E0E0', borderRadius: 8, padding: 12, fontSize: 13, color: '#202124' }}>
                <p style={{ fontWeight: 600, margin: '0 0 8px' }}>Onderwerp: {aiResult.subject}</p>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: '0 0 12px' }}>{aiResult.body}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => navigator.clipboard?.writeText(aiResult.body)}
                    style={{ backgroundColor: '#1A73E8', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                    Kopiëren
                  </button>
                  <button onClick={() => { setAiResult(null); setAiPrompt('') }}
                    style={{ backgroundColor: '#F8F9FA', color: '#202124', border: '1px solid #BDBDBD', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                    Opnieuw
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* ── Draft Queue floating (preserved exactly) ── */}
      <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 50, maxWidth: showDraftQueue ? 340 : 'auto' }}>
        {showDraftQueue ? (
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.18)', width: 340, overflow: 'hidden' }}>

            {/* Queue header */}
            <div style={{ backgroundColor: '#202124', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📋</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF' }}>Draft Queue</span>
                {draftQueue.length > 0 && (
                  <span style={{ backgroundColor: '#EA4335', color: '#FFFFFF', fontSize: 11, fontWeight: 700, borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {draftQueue.length}
                  </span>
                )}
              </div>
              <button onClick={() => setShowDraftQueue(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>

            {/* Client selector */}
            <div style={{ padding: '12px 16px 8px' }}>
              <select
                value={draftQueueClientId}
                onChange={e => setDraftQueueClientId(e.target.value)}
                style={{ width: '100%', fontSize: 14, padding: '8px 12px', border: '1px solid #BDBDBD', borderRadius: 8, backgroundColor: '#F8F9FA', color: '#202124' }}
              >
                <option value="">Selecteer klant</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.company_name ?? c.full_name}</option>
                ))}
              </select>
            </div>

            {/* Items */}
            <div style={{ padding: '0 16px 8px', maxHeight: 160, overflowY: 'auto' }}>
              {visibleQueueItems.length === 0 ? (
                <p style={{ fontSize: 12, color: '#5F6368', textAlign: 'center', padding: '8px 0' }}>Geen items</p>
              ) : visibleQueueItems.map((item, idx) => (
                <div key={idx} style={{ fontSize: 12, color: '#202124', padding: '6px 0', borderBottom: '1px solid #F1F3F4', display: 'flex', gap: 8 }}>
                  <span style={{ color: '#9AA0A6', flexShrink: 0 }}>•</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>

            {/* Add item */}
            <div style={{ padding: '8px 16px', display: 'flex', gap: 8 }}>
              <input
                value={draftInput}
                onChange={e => setDraftInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addManualItem()}
                placeholder="Item toevoegen..."
                style={{ flex: 1, fontSize: 13, padding: '6px 10px', border: '1px solid #BDBDBD', borderRadius: 8, backgroundColor: '#F8F9FA', color: '#202124' }}
              />
              <button
                onClick={addManualItem}
                disabled={!draftInput.trim() || !draftQueueClientId}
                style={{ backgroundColor: '#1A73E8', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: (!draftInput.trim() || !draftQueueClientId) ? 0.4 : 1 }}
              >+</button>
            </div>

            {/* Composed email preview */}
            {composedEmail && (
              <div style={{ margin: '0 16px 8px', padding: 12, backgroundColor: '#F8F9FA', border: '1px solid #E0E0E0', borderRadius: 8, fontSize: 12, color: '#202124' }}>
                <p style={{ fontWeight: 600, margin: '0 0 4px' }}>Onderwerp: {composedEmail.subject}</p>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, margin: 0 }}>{composedEmail.body}</p>
              </div>
            )}

            {/* Actions */}
            <div style={{ padding: '8px 16px 16px', display: 'flex', gap: 8 }}>
              <button
                onClick={composeEmail}
                disabled={composing || visibleQueueItems.length === 0}
                style={{ flex: 1, backgroundColor: '#34A853', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '8px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: (composing || visibleQueueItems.length === 0) ? 0.4 : 1 }}
              >
                {composing ? 'AI stelt op...' : 'AI opstellen'}
              </button>
              {composedEmail && (
                <button
                  onClick={() => {
                    const client = clients.find(c => c.id === draftQueueClientId)
                    if (client?.email)
                      window.location.href = `mailto:${client.email}?subject=${encodeURIComponent(composedEmail.subject)}&body=${encodeURIComponent(composedEmail.body)}`
                  }}
                  style={{ backgroundColor: '#1A73E8', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '8px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                >Versturen</button>
              )}
              <button
                onClick={clearDraftQueue}
                style={{ backgroundColor: '#EA4335', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '8px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
              >Wissen</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowDraftQueue(true)}
            style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', backgroundColor: '#202124', color: '#FFFFFF', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
          >
            📋 Draft Queue
            {draftQueue.length > 0 && (
              <span style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#EA4335', color: '#FFFFFF', fontSize: 11, fontWeight: 700, borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {draftQueue.length}
              </span>
            )}
          </button>
        )}
      </div>

    </div>
  )
}