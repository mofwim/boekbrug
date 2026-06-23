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
import DraftQueue from '@/components/draft-queue/DraftQueue'
import type { AccountantOverview, ClientSummary, TodoItem } from '../accountant.types'

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

// [BOEK-028] localStorage key — kept as-is (fragile by design, deferred to DB later)
const LAST_CLIENT_KEY = 'last_client_id'

// [BRIDGE-NOTIF] STATUS_COLOR / STATUS_LABEL / TODO_ICON are retained but no
// longer referenced — the readiness chip + 'Vandaag te doen' display were removed
// (no honest backend yet). Kept intact so the UI returns cleanly later.
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

/**
 * Hydration-safe greeting.
 * Time-based salutation differs between server (UTC) and client (local timezone),
 * which causes React error #418. Return null initially, compute after mount.
 */
function timeSalutation(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Goedemorgen'
  if (hour < 18) return 'Goedemiddag'
  return 'Goedenavond'
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function AccountantHome({ profile, overview, clients, todos, notifications: initialNotifs, unreadMessages: initialUnread }: Props) {
  // [BRIDGE-NOTIF] overview + todos are intentionally retained but not rendered
  // (display removed until a readiness/to-do backend exists). Referenced here so
  // the kept props don't trip no-unused-vars. Remove these two lines when the
  // readiness UI returns.
  void overview
  void todos
  const router = useRouter()
  const supabase = createClient()

  // ── Notifications (client-side read for real-time badge) ──
  const [notifications, setNotifications] = useState(initialNotifs)
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadMessages] = useState(initialUnread)

  // ── Time-based greeting (computed after mount to avoid hydration mismatch) ──
  const [salutation, setSalutation] = useState<string | null>(null)

  // ── Last client shortcut (localStorage) ──
  const [lastClientId, setLastClientId] = useState<string | null>(null)
  const [lastClientName, setLastClientName] = useState<string | null>(null)

  // ── AI assistant panel ──
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<{ subject: string; body: string } | null>(null)

  // ── Init ──
  useEffect(() => {
    // Time-based greeting — set after mount to keep server/client HTML identical
    setSalutation(timeSalutation())

    // Resolve last_client_id from localStorage
    const storedId = localStorage.getItem(LAST_CLIENT_KEY)
    if (storedId) {
      setLastClientId(storedId)
      const found = clients.find(c => c.id === storedId)
      if (found) setLastClientName(found.company_name || found.full_name)
      else localStorage.removeItem(LAST_CLIENT_KEY) // stale
    }
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
  // Render
  // ─────────────────────────────────────────────────────────

  const unreadNotifCount = notifications.filter(n => !n.read).length

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
        }}
        onMarkAllRead={markAllRead}
        onMessagesClick={() => router.push('/dashboard/messages')}
        onLogout={handleLogout}
      />

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 120 }}>

        {/* ── 1. Greeting ── */}
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#202124', margin: 0 }}>
          {salutation
            ? `${salutation}${profile.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`
            : `Hallo${profile.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`} 👋
        </h1>

        {/* ── Quick navigation ── */}
        {/* [BRIDGE-NOTIF] 'Alle bestanden' card removed (flat file-pile contradicts
            the client-by-client workflow). Route/page untouched — reachable via
            werkplek. werkplek now full-width. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          <button
            onClick={() => router.push('/dashboard/accountant/werkplek')}
            style={{
              backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8,
              padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
              minHeight: 56,
            }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F9FA')}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
          >
            <span style={{ fontSize: 20 }}>🛠️</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>Mijn werkplek</p>
              <p style={{ fontSize: 12, color: '#5F6368', margin: 0 }}>Alle tools</p>
            </div>
            <span style={{ color: '#1A73E8', fontSize: 14, fontWeight: 600 }}>→</span>
          </button>
        </div>

        {/* [BRIDGE-NOTIF] Hidden until a readiness/to-do backend exists.
            The 3-number bar (Klanten totaal / Klaar voor KW / Wacht op stukken)
            and the 'Vandaag te doen' feed implied a system that had inspected
            every client and computed readiness/missing-docs — it had not. Showing
            placeholder counts is a lie in a financial-truth system, so the DISPLAY
            is removed. The `overview` and `todos` props/queries are left intact
            (page.tsx still fetches them) and this UI returns once the backend is
            real. Same pattern as the deferred UBL download / decorative pay field. */}

        {/* ── 4. Mijn klanten ── */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>Mijn klanten</h2>
            <button
              onClick={() => router.push('/dashboard/clients/beheer')}
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
                  {/* [BRIDGE-NOTIF] Status dot + chip removed — same readiness
                      signal that has no honest backend yet. Name + email + arrow
                      stay. client.status field is untouched (returns with the
                      readiness backend). */}

                  {/* Name + email */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.company_name ?? client.full_name ?? '—'}
                    </p>
                    <p style={{ fontSize: 12, color: '#5F6368', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.email}
                    </p>
                  </div>

                  {/* Arrow */}
                  <span style={{ fontSize: 13, color: '#1A73E8', fontWeight: 600, flexShrink: 0 }}>→</span>
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

      {/* ── Draft Queue (extracted to /components/draft-queue) ── */}
      <DraftQueue clients={clients} />

    </div>
  )
}