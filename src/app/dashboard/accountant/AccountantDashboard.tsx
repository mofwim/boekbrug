'use client'

// src/app/dashboard/accountant/AccountantDashboard.tsx
// [BOEK-028] Accountant Dashboard — Cleanup — May 2026
// Removed: stats cards, progress bar, invoice table
// Added: last-client shortcut, AI assistant panel

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { DashboardHeader } from '../_shared'
import { composeDraftEmail } from '@/lib/ai'

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface ClientProfile {
  id: string
  full_name: string | null
  company_name: string | null
  email: string | null
  kvk_number: string | null
  onboarding_done: boolean
}

interface DraftQueueItem {
  clientId: string
  clientName: string
  text: string
  addedAt: string
}

type ClientStatus = 'complete' | 'partial' | 'missing'

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function deriveClientStatus(invoiceCount: number): ClientStatus {
  if (invoiceCount === 0) return 'missing'
  if (invoiceCount < 3) return 'partial'
  return 'complete'
}

const STATUS_DOT: Record<ClientStatus, string> = {
  complete: '#34c759',
  partial: '#ff9500',
  missing: '#ff3b30',
}

// [BOEK-028] localStorage key for last visited client
const LAST_CLIENT_KEY = 'last_client_id'

// ─────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────

export function AccountantDashboard({ profile }: { profile: any }) {
  const router = useRouter()
  const supabase = createClient()

  const [clients, setClients] = useState<ClientProfile[]>([])
  const [clientInvoiceCounts, setClientInvoiceCounts] = useState<Record<string, number>>({})
  const [notifications, setNotifications] = useState<any[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)

  // [BOEK-028] Draft Queue state
  const [draftQueue, setDraftQueue] = useState<DraftQueueItem[]>([])
  const [showDraftQueue, setShowDraftQueue] = useState(false)
  const [draftQueueClientId, setDraftQueueClientId] = useState<string>('')
  const [composing, setComposing] = useState(false)
  const [composedEmail, setComposedEmail] = useState<{ subject: string; body: string } | null>(null)
  const [draftInput, setDraftInput] = useState('')

  // [BOEK-028] Last visited client — from localStorage
  const [lastClientId, setLastClientId] = useState<string | null>(null)
  const [lastClientName, setLastClientName] = useState<string | null>(null)

  // [BOEK-028] AI assistant panel
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<{ subject: string; body: string } | null>(null)

  useEffect(() => {
    // [BOEK-028] Read last_client_id from localStorage on mount
    const storedId = localStorage.getItem(LAST_CLIENT_KEY)
    if (storedId) setLastClientId(storedId)

    async function loadData() {
      const { data: clientLinks } = await supabase
        .from('accountant_clients')
        .select('zzper_id, profiles!zzper_id(id, full_name, company_name, email, kvk_number, onboarding_done)')
        .eq('accountant_id', profile.id)

      if (clientLinks) {
        const profiles = clientLinks.map((c: any) => c.profiles as ClientProfile)
        setClients(profiles)

        // Resolve last client name from loaded profiles
        if (storedId) {
          const found = profiles.find(p => p.id === storedId)
          if (found) setLastClientName(found.company_name || found.full_name)
          else setLastClientId(null) // stale — client no longer linked
        }

        const counts: Record<string, number> = {}
        await Promise.all(
          profiles.map(async (cl) => {
            const { count } = await supabase
              .from('invoices')
              .select('id', { count: 'exact', head: true })
              .eq('sender_id', cl.id)
              .eq('status', 'paid')
            counts[cl.id] = count || 0
          })
        )
        setClientInvoiceCounts(counts)
      }

      const { data: notifData } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(20)
      if (notifData) setNotifications(notifData)

      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', profile.id)
        .eq('read', false)
      setUnreadMessages(count || 0)

      const { data: queueData } = await supabase
        .from('draft_queue')
        .select('*')
        .eq('accountant_id', profile.id)
        .order('updated_at', { ascending: false })
        .limit(1)

      if (queueData && queueData.length > 0 && queueData[0].items) {
        try {
          const items = Array.isArray(queueData[0].items)
            ? queueData[0].items
            : JSON.parse(queueData[0].items)
          setDraftQueue(items)
        } catch { /* ignore */ }
      }
    }
    loadData()
  }, [])

  // [BOEK-028] Navigate to client + save to localStorage
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

  // ─── Draft Queue helpers ───────────────────────────────

  async function addToDraftQueue(item: DraftQueueItem) {
    const updated = [...draftQueue, item]
    setDraftQueue(updated)
    const { data: existing } = await supabase
      .from('draft_queue').select('id').eq('accountant_id', profile.id).limit(1)
    if (existing && existing.length > 0) {
      await supabase.from('draft_queue')
        .update({ items: updated, updated_at: new Date().toISOString() })
        .eq('id', existing[0].id)
    } else {
      await supabase.from('draft_queue').insert({
        accountant_id: profile.id, client_id: item.clientId, items: updated,
      })
    }
  }

  async function addManualItem() {
    if (!draftInput.trim() || !draftQueueClientId) return
    const client = clients.find(c => c.id === draftQueueClientId)
    await addToDraftQueue({
      clientId: draftQueueClientId,
      clientName: client?.company_name || client?.full_name || 'Onbekend',
      text: draftInput.trim(),
      addedAt: new Date().toISOString(),
    })
    setDraftInput('')
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
        clientName, items
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

  // [BOEK-028] AI assistant — free-form prompt
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

  const unreadNotifCount = notifications.filter(n => !n.read).length

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>

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

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4 pb-32">

        {/* [BOEK-028] Ga verder — last visited client shortcut, hidden if none */}
        {lastClientId && lastClientName && (
          <button
            onClick={() => openClient(lastClientId)}
            className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-left active:opacity-80 transition-opacity"
            style={{
              backgroundColor: 'var(--color-card, #fff)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            }}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-0.5"
                style={{ color: '#8e8e93' }}>
                Ga verder waar je gebleven bent
              </p>
              <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary, #1c1c1e)' }}>
                {lastClientName}
              </p>
            </div>
            <span className="text-lg" style={{ color: '#007aff' }}>→</span>
          </button>
        )}

        {/* [BOEK-028] Samen werken met AI button */}
        <button
          onClick={() => { setShowAiPanel(p => !p); setAiResult(null); setAiPrompt('') }}
          className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-left active:opacity-80 transition-opacity"
          style={{ backgroundColor: '#1c1c1e', color: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-0.5"
              style={{ color: 'rgba(255,255,255,0.45)' }}>
              AI Assistent
            </p>
            <p className="text-sm font-bold">Samen werken met AI ✨</p>
          </div>
          <span className="text-base" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {showAiPanel ? '▲' : '▼'}
          </span>
        </button>

        {/* [BOEK-028] AI assistant panel — inline below button */}
        {showAiPanel && (
          <div
            className="rounded-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--color-card, #fff)', boxShadow: '0 2px 12px rgba(0,0,0,0.1)' }}
          >
            <div className="p-4 space-y-3">
              <p className="text-xs" style={{ color: '#8e8e93' }}>
                Schrijf wat je wilt doen — de AI stelt het voor je op.
              </p>
              <textarea
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                rows={3}
                placeholder="bijv. bereid BTW aangifte voor klant Jansen BV..."
                className="w-full text-sm rounded-xl px-3 py-2.5 border resize-none"
                style={{ borderColor: '#e5e5ea', backgroundColor: '#f2f2f7', color: '#1c1c1e' }}
              />
              <button
                onClick={handleAiPrompt}
                disabled={aiLoading || !aiPrompt.trim()}
                className="w-full text-sm font-semibold py-2.5 rounded-xl disabled:opacity-40"
                style={{ backgroundColor: '#1c1c1e', color: '#fff' }}
              >
                {aiLoading ? 'AI werkt...' : 'Genereer ✨'}
              </button>

              {aiResult && (
                <div className="rounded-xl p-3 text-xs space-y-2"
                  style={{ backgroundColor: '#f2f2f7', color: '#3a3a3c' }}>
                  <p className="font-semibold">Onderwerp: {aiResult.subject}</p>
                  <p className="whitespace-pre-wrap leading-relaxed">{aiResult.body}</p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => navigator.clipboard?.writeText(aiResult.body)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                      style={{ backgroundColor: '#007aff', color: '#fff' }}
                    >
                      Kopiëren
                    </button>
                    <button
                      onClick={() => { setAiResult(null); setAiPrompt('') }}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                      style={{ backgroundColor: '#e5e5ea', color: '#3a3a3c' }}
                    >
                      Opnieuw
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* [BOEK-028] Mijn klanten list */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ backgroundColor: 'var(--color-card, #fff)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
        >
          <div
            className="flex items-center justify-between px-4 py-4 border-b"
            style={{ borderColor: 'var(--color-separator, #e5e5ea)' }}
          >
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary, #1c1c1e)' }}>
              Mijn klanten
            </h2>
            <button
              onClick={() => router.push('/dashboard/clients/invite')}
              className="text-sm font-semibold px-3 py-1.5 rounded-xl"
              style={{ backgroundColor: '#af52de', color: '#fff' }}
            >
              + Klant
            </button>
          </div>

          {clients.length === 0 ? (
            <p className="text-sm text-center py-10"
              style={{ color: 'var(--color-text-tertiary, #8e8e93)' }}>
              Nog geen klanten — voeg je eerste klant toe
            </p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--color-separator, #e5e5ea)' }}>
              {clients.map(client => {
                const status = deriveClientStatus(clientInvoiceCounts[client.id] ?? 0)
                return (
                  <div
                    key={client.id}
                    onClick={() => openClient(client.id)}
                    className="flex items-center gap-3 px-4 py-4 active:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: STATUS_DOT[status] }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate"
                        style={{ color: 'var(--color-text-primary, #1c1c1e)' }}>
                        {client.company_name || client.full_name}
                      </p>
                      <p className="text-xs truncate mt-0.5"
                        style={{ color: 'var(--color-text-secondary, #636366)' }}>
                        {client.email}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          backgroundColor: status === 'complete' ? '#d1fae5' : status === 'partial' ? '#fef3c7' : '#fee2e2',
                          color: status === 'complete' ? '#065f46' : status === 'partial' ? '#92400e' : '#991b1b',
                        }}>
                        {status === 'complete' ? 'Klaar' : status === 'partial' ? 'Gedeeltelijk' : 'Ontbreekt'}
                      </span>
                      <span className="text-xs font-semibold" style={{ color: '#007aff' }}>→</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </main>

      {/* [BOEK-028] Draft Queue — floating panel (unchanged) */}
      <div className="fixed bottom-4 right-4 z-50"
        style={{ maxWidth: showDraftQueue ? 340 : 'auto' }}>
        {showDraftQueue ? (
          <div className="rounded-2xl shadow-xl overflow-hidden"
            style={{ backgroundColor: '#fff', width: 340 }}>
            <div className="flex items-center justify-between px-4 py-3"
              style={{ backgroundColor: '#1c1c1e' }}>
              <div className="flex items-center gap-2">
                <span className="text-base">📋</span>
                <span className="text-sm font-semibold text-white">Draft Queue</span>
                {draftQueue.length > 0 && (
                  <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                    {draftQueue.length}
                  </span>
                )}
              </div>
              <button onClick={() => setShowDraftQueue(false)}
                className="text-gray-400 hover:text-white text-lg leading-none">✕</button>
            </div>

            <div className="px-4 pt-3 pb-2">
              <select value={draftQueueClientId} onChange={e => setDraftQueueClientId(e.target.value)}
                className="w-full text-sm rounded-xl px-3 py-2 border"
                style={{ borderColor: '#e5e5ea', backgroundColor: '#f2f2f7', color: '#1c1c1e' }}>
                <option value="">Selecteer klant</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>
                ))}
              </select>
            </div>

            <div className="px-4 pb-2 space-y-1 max-h-40 overflow-y-auto">
              {draftQueue.filter(i => !draftQueueClientId || i.clientId === draftQueueClientId)
                .map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs py-1.5 border-b"
                    style={{ borderColor: '#f2f2f7', color: '#3a3a3c' }}>
                    <span className="text-gray-400 mt-0.5">•</span>
                    <span>{item.text}</span>
                  </div>
                ))}
              {draftQueue.filter(i => !draftQueueClientId || i.clientId === draftQueueClientId).length === 0 && (
                <p className="text-xs text-gray-400 py-2 text-center">Geen items</p>
              )}
            </div>

            <div className="px-4 pb-3 flex gap-2">
              <input value={draftInput} onChange={e => setDraftInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addManualItem()}
                placeholder="Item toevoegen..."
                className="flex-1 text-xs rounded-xl px-3 py-2 border"
                style={{ borderColor: '#e5e5ea', backgroundColor: '#f2f2f7' }} />
              <button onClick={addManualItem} disabled={!draftInput.trim() || !draftQueueClientId}
                className="text-xs font-semibold px-3 py-2 rounded-xl disabled:opacity-40"
                style={{ backgroundColor: '#007aff', color: '#fff' }}>+</button>
            </div>

            {composedEmail && (
              <div className="mx-4 mb-3 p-3 rounded-xl text-xs"
                style={{ backgroundColor: '#f2f2f7', color: '#3a3a3c' }}>
                <p className="font-semibold mb-1">Onderwerp: {composedEmail.subject}</p>
                <p className="whitespace-pre-wrap leading-relaxed">{composedEmail.body}</p>
              </div>
            )}

            <div className="px-4 pb-4 flex gap-2">
              <button onClick={composeEmail} disabled={composing || draftQueue.length === 0}
                className="flex-1 text-xs font-semibold py-2.5 rounded-xl disabled:opacity-40"
                style={{ backgroundColor: '#34c759', color: '#fff' }}>
                {composing ? 'AI stelt op...' : 'AI opstellen'}
              </button>
              {composedEmail && (
                <button
                  onClick={() => {
                    const client = clients.find(c => c.id === draftQueueClientId)
                    if (client?.email)
                      window.location.href = `mailto:${client.email}?subject=${encodeURIComponent(composedEmail.subject)}&body=${encodeURIComponent(composedEmail.body)}`
                  }}
                  className="text-xs font-semibold px-3 py-2.5 rounded-xl"
                  style={{ backgroundColor: '#007aff', color: '#fff' }}>Versturen</button>
              )}
              <button onClick={clearDraftQueue}
                className="text-xs font-semibold px-3 py-2.5 rounded-xl"
                style={{ backgroundColor: '#ff3b30', color: '#fff' }}>Wissen</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowDraftQueue(true)}
            className="relative flex items-center gap-2 px-4 py-3 rounded-2xl shadow-lg text-sm font-semibold"
            style={{ backgroundColor: '#1c1c1e', color: '#fff' }}>
            📋 Draft Queue
            {draftQueue.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {draftQueue.length}
              </span>
            )}
          </button>
        )}
      </div>

    </div>
  )
}