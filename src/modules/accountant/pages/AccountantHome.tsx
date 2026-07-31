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

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { rowMatchesQuery } from '@/lib/search'
import { DashboardHeader } from '@/app/dashboard/_shared'
// [DRAFT-QUEUE-HIDDEN] Draft Queue is hidden from the UI for now (decision deferred).
// Component + /api/draft-queue + the draft_queue table are intentionally kept intact;
// only the render below is disabled. Re-enable by restoring the import and the
// <DraftQueue /> mount at the bottom of this file.
// import DraftQueue from '@/components/draft-queue/DraftQueue'
import type { AccountantOverview, ClientSummary, TodoItem } from '../accountant.types'
import type { NotificationRow } from '@/types/rows'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { EL1, M3, R, COLUMN } from '@/lib/design/tokens'

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

// [BOEK-028] localStorage key — kept as-is (fragile by design, deferred to DB later)
const LAST_CLIENT_KEY = 'last_client_id'

// [READINESS-P4] The old klaar/bijna_klaar/wacht STATUS_COLOR/STATUS_LABEL maps
// were removed with the lie-capable computeClientStatus. TODO_ICON stays — the
// to-do feed is now rendered from honest getTodoFeed items.
const TODO_ICON: Record<string, string> = {
  invoices_to_process: '📄',
  missing_file:        '📁',
  client_question:     '❓',
}

// [ROLE-PARITY] Shape/elevation tokens mirrored from the ZZP home (ZzpDashboard)
// so the two role dashboards share one visual system.

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface Props {
  profile: {
    id: string
    full_name: string | null
    company_name: string | null
    email: string | null
    role: string | null
  }
  overview: AccountantOverview
  clients: ClientSummary[]
  todos: TodoItem[]
  notifications: NotificationRow[]
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
  // [READINESS-P4] overview + todos are now RENDERED (below) — they are backed by
  // honest facts: overview = provable counts (open questions / missing bank), todos
  // = concrete actionable items from getTodoFeed. No "ready" verdict is shown, so
  // the BRIDGE-NOTIF "placeholder counts are a lie" concern no longer applies.
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

  // [SMART-FILTER] Client-roster search (bedrijfsnaam / naam / e-mail). Memoized —
  // the roster is unbounded (grows with the accountant's client count).
  const [clientSearch, setClientSearch] = useState('')
  const shownClients = useMemo(() => {
    const q = clientSearch.trim()
    return q ? clients.filter((c) => rowMatchesQuery(q, [c.company_name, c.full_name, c.email])) : clients
  }, [clients, clientSearch])

  // ── AI assistant panel ──
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<{ subject: string; body: string } | null>(null)

  // ── Init ──
  useEffect(() => {
    // Beide standen komen uit de browser (klok + localStorage) en bestaan op de server niet.
    // In één wikkel: zelfde tick, geen synchrone setState in de effect-body.
    void (async () => {
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
    })()
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
      // [AI-SERVERKANT] Via onze eigen route. Hier stond een RECHTSTREEKSE aanroep van
      // composeDraftEmail — een functie die intern fetch('https://api.anthropic.com') doet met
      // process.env.ANTHROPIC_API_KEY. In een browser bestaat die variabele niet (Next vervangt
      // alleen NEXT_PUBLIC_*), dus ging het verzoek de deur uit met een LEGE sleutel — en zelfs
      // met sleutel zou het stranden, want Anthropic staat geen browser-origin toe.
      //
      // Deze assistent kón dus nooit werken. De boekhouder typte zijn vraag, klikte, en las
      // "AI niet beschikbaar — Probeer het opnieuw." Dat advies was onjuist: opnieuw proberen
      // veranderde niets, want er was niets tijdelijks aan.
      const res = await fetch('/api/ai/draft-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        // Zeg wat er aan de hand is. 429 is het enige geval waarin wachten wél helpt.
        setAiResult({
          subject: res.status === 429 ? 'Even te veel aanvragen' : 'Het lukte niet',
          body: json?.error ?? 'Probeer het zo opnieuw.',
        })
        return
      }
      setAiResult(json)
    } catch {
      setAiResult({ subject: 'Geen verbinding', body: 'Controleer je internet en probeer opnieuw.' })
    } finally {
      setAiLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  const unreadNotifCount = notifications.filter(n => !n.read).length

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: "'Roboto', sans-serif" }}>

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

      {/* [ROLE-PARITY] Same design system as the ZZP home (ZzpDashboard): a
          greeting, a snapshot, a gradient hero for the daily driver, and grouped
          sections — applied to the ACCOUNTANT's own content (portfolio of clients,
          cross-client to-dos, office tools). Not a literal clone: the two roles
          share the system, the content is tailored per role. See docs (multi-role
          portals lead with what matters to that role). */}
      <main style={{ maxWidth: COLUMN.hub, margin: '0 auto', padding: '32px 16px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Greeting (eyebrow + first name — same shape as the ZZP home) ── */}
        <div>
          <p style={{ fontSize: 12, color: '#5F6368', marginBottom: 2, fontWeight: 500, letterSpacing: 0.2, textTransform: 'uppercase' }}>
            {salutation ?? 'Hallo'}
          </p>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#202124', margin: 0, letterSpacing: -0.5 }}>
            {profile.full_name ? profile.full_name.split(' ')[0] : 'daar'} 👋
          </h1>
        </div>

        {/* ── Daily-driver hero — the accountant's "lead with what matters":
            the Aangifte & status board (deadline + client readiness + reminders).
            Same gradient hero treatment as the ZZP "Ben ik klaar?". ── */}
        <button
          onClick={() => router.push('/dashboard/accountant/agenda')}
          style={{
            display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
            padding: '18px', borderRadius: R.lg, cursor: 'pointer', fontFamily: 'inherit',
            border: 'none', background: 'linear-gradient(135deg, #1A73E8, #1557B0)', boxShadow: EL1,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 30, color: '#fff' }}>checklist</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: -0.2 }}>Aangifte &amp; status</span>
            <span style={{ display: 'block', fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>BTW-deadline, klaar-status en herinneren per klant</span>
          </span>
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'rgba(255,255,255,0.9)' }}>chevron_right</span>
        </button>

        {/* ── Overzicht — honest counts (the accountant's "where do I stand").
            Same 3-tile snapshot pattern as the ZZP home. ── */}
        {clients.length > 0 && (
          <div>
            <SectionLabel>Overzicht</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { n: overview.total_clients, label: 'Klanten', color: '#202124' },
                { n: overview.clients_with_open_questions, label: 'Open vraag', color: overview.clients_with_open_questions > 0 ? '#C5221F' : '#5F6368' },
                { n: overview.clients_missing_bank, label: 'Zonder bank', color: overview.clients_missing_bank > 0 ? '#EA8600' : '#5F6368' },
              ].map(s => (
                <div key={s.label} style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: '12px 8px', textAlign: 'center' }}>
                  <p style={{ fontSize: 22, fontWeight: 700, color: s.color, margin: 0 }}>{s.n}</p>
                  <p style={{ fontSize: 11, color: '#5F6368', margin: '2px 0 0' }}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* [READINESS-P4] To-do — concrete actionable items (open questions,
            unprocessed invoices, missing bank data). Every item is a real gap the
            accountant can act on; clicking opens the client. */}
        {todos.length > 0 && (
          <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>Te doen</h2>
            </div>
            {todos.map((t, idx) => (
              <button
                key={`${t.client_id}-${t.type}`}
                onClick={() => router.push(`/dashboard/clients/${t.client_id}`)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', background: 'none', border: 'none',
                  borderBottom: idx < todos.length - 1 ? '1px solid #F1F3F4' : 'none',
                  cursor: 'pointer', textAlign: 'left', minHeight: 48,
                }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{TODO_ICON[t.type] ?? '•'}</span>
                <span style={{ flex: 1, fontSize: 13, color: '#202124' }}>{t.description}</span>
                <span style={{ color: '#1A73E8', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>→</span>
              </button>
            ))}
          </div>
        )}

        {/* ── 4. Mijn klanten ── */}
        <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, overflow: 'hidden' }}>
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

          {clients.length > 0 && (
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #E0E0E0', position: 'relative' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ position: 'absolute', left: 27, top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
              <input
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Zoek klant op naam of e-mail…"
                aria-label="Klanten zoeken"
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 32px', borderRadius: 8, border: '1px solid #E0E0E0', fontSize: 13.5, outline: 'none', color: '#202124' }}
              />
              {clientSearch && (
                <button onClick={() => setClientSearch('')} aria-label="Wissen" className="tap-44" style={{ position: 'absolute', right: 23, top: '50%', transform: 'translateY(-50%)', width: 19, height: 19, borderRadius: '50%', border: 'none', background: '#E0E0E0', color: '#5F6368', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>×</button>
              )}
            </div>
          )}

          {clients.length === 0 ? (
            /* [ONBOARDING] First-run empty state — a clear, tappable first action
               for a brand-new accountant instead of a dead line of text. */
            <button
              onClick={() => router.push('/dashboard/clients/beheer')}
              style={{
                width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                padding: '32px 16px', background: 'none', border: 'none', cursor: 'pointer',
              }}
            >
              <span style={{
                width: 44, height: 44, borderRadius: '50%', backgroundColor: '#E8F0FE',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-outlined" style={{ color: '#1A73E8', fontSize: 24 }}>person_add</span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#202124' }}>Voeg je eerste klant toe</span>
              <span style={{ fontSize: 12.5, color: '#5F6368' }}>Nodig een klant uit of koppel een bestaande</span>
            </button>
          ) : shownClients.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>
              Geen klanten gevonden voor &ldquo;{clientSearch.trim()}&rdquo;
            </p>
          ) : (
            <div>
              {shownClients.map((client, idx) => (
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
                    borderBottom: idx < shownClients.length - 1 ? '1px solid #F1F3F4' : 'none',
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

        {/* ── Werkplek — office tools as a compact tile grid (same pattern as the
            ZZP home's "Mijn administratie"). Surfaces the tools directly instead of
            routing through a separate werkplek menu. ── */}
        <div>
          <SectionLabel>Werkplek</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <ToolTile icon="people" tint="#34A853" label="Beheren" onClick={() => router.push('/dashboard/clients/beheer')} />
            <ToolTile icon="bar_chart" tint="#E37400" label="Kwartaal" onClick={() => router.push('/dashboard/quarterly')} />
            <ToolTile icon="account_tree" tint="#1967D2" label="Brug" onClick={() => router.push('/dashboard/brug')} />
            <ToolTile icon="description" tint="#00897B" label="Facturen" onClick={() => router.push('/dashboard/facturen')} />
            <ToolTile icon="folder_open" tint="#5F6368" label="Bestanden" onClick={() => router.push('/dashboard/bestanden')} />
            <ToolTile icon="settings" tint="#7B1FA2" label="Instellingen" onClick={() => router.push('/dashboard/settings')} />
          </div>
        </div>

        {/* ── Last client shortcut (preserved) ── */}
        {lastClientId && lastClientName && (
          <button
            onClick={() => openClient(lastClientId)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
              backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1,
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
          <div style={{ backgroundColor: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: '#5F6368', margin: 0 }}>
              Schrijf wat je wilt doen — de AI stelt het voor je op.
            </p>
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              rows={3}
              placeholder="bijv. bereid BTW aangifte voor klant Jansen BV..."
              style={{ width: '100%', fontSize: 14, padding: '8px 12px', border: '1px solid #dadce0', borderRadius: 8, backgroundColor: '#F8F9FA', color: '#202124', resize: 'none', boxSizing: 'border-box' }}
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
                    style={{ backgroundColor: '#F8F9FA', color: '#202124', border: '1px solid #dadce0', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                    Opnieuw
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* ── Draft Queue (extracted to /components/draft-queue) ── */}
      {/* [DRAFT-QUEUE-HIDDEN] Temporarily hidden from the UI — see import note above.
          Kept in the codebase (component + API + table) for a future decision.
          Restore this mount to bring it back:
          <DraftQueue clients={clients} /> */}

    </div>
  )
}

// ─────────────────────────────────────────────────────────
// [ROLE-PARITY] Shared home patterns, mirrored from the ZZP home so both role
// dashboards read as one product. SectionLabel = the uppercase group header;
// ToolTile = the compact 3-per-row tile used for the office-tools grid (the
// accountant equivalent of the ZZP "Mijn administratie" grid).
// ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p style={{
      fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
      color: '#8a929c', margin: '0 2px 10px',
    }}>
      {children}
    </p>
  )
}

function ToolTile({ icon, tint, label, onClick }: {
  icon: string; tint: string; label: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        background: '#fff', borderRadius: R.lg, padding: '14px 6px 12px',
        border: 'none', boxShadow: EL1, cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div style={{
        width: 46, height: 46, borderRadius: R.md,
        background: tint, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 24 }}>{icon}</span>
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#202124', textAlign: 'center' }}>{label}</span>
    </button>
  )
}