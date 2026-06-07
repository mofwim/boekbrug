'use client'

// src/components/draft-queue/DraftQueue.tsx
// [BOEK-030] Floating Draft Queue for accountants — Google Workspace design — June 2026
//
// Owns (BOEK-030): this file + src/app/api/draft-queue/route.ts
//
// Mounting (done by BOEK-028, see patch note): render once in the accountant layout
//   <DraftQueue clients={clients} />
// so it stays visible across all accountant pages.
//
// Design: matches the accountant module's Workspace inline-style convention
//   (#1A73E8, 8px radius, 36px buttons, Roboto, ≤100ms background-only animation),
//   as in KlantenBeheer.tsx / AccountantWerkplek.tsx. NOT the ZZP Material You system.
// Responsive: floating card bottom-right on desktop; full-width bottom-sheet on mobile.
//
// All persistence + AI + send go through /api/draft-queue (server-side, RLS, Resend).
// This component holds UI state only.

import { useEffect, useState, type CSSProperties } from 'react'
import type { DraftItem } from '@/app/api/draft-queue/route'

// ─────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────

interface DraftQueueClient {
  id: string
  full_name: string | null
  company_name: string | null
  email: string | null
}

interface Props {
  clients: DraftQueueClient[]
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function DraftQueue({ clients }: Props) {
  const [open, setOpen] = useState(false)
  const [queues, setQueues] = useState<Record<string, DraftItem[]>>({})
  const [selectedId, setSelectedId] = useState('')
  const [input, setInput] = useState('')

  const [composing, setComposing] = useState(false)
  const [composed, setComposed] = useState<{ subject: string; body: string } | null>(null)

  const [sending, setSending] = useState(false)
  const [sentOk, setSentOk] = useState(false)
  const [sentCleared, setSentCleared] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Load all queues on mount (persisted between sessions) ──
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/draft-queue')
        if (!res.ok) return
        const json = await res.json()
        if (!active) return
        const map: Record<string, DraftItem[]> = {}
        for (const q of json.queues ?? []) map[q.client_id] = q.items ?? []
        setQueues(map)
      } catch { /* silent — panel still usable */ }
    })()
    return () => { active = false }
  }, [])

  const selectedItems = selectedId ? (queues[selectedId] ?? []) : []
  const totalCount = Object.values(queues).reduce((sum, items) => sum + items.length, 0)

  function clientName(id: string): string {
    const c = clients.find(x => x.id === id)
    return c?.company_name || c?.full_name || 'Klant'
  }

  function resetEmailState() {
    setComposed(null)
    setSentOk(false)
    setSentCleared(false)
    setError(null)
  }

  // ── Add manual item ──
  async function addManual() {
    const description = input.trim()
    if (!description || !selectedId) return
    setError(null)
    try {
      const res = await fetch('/api/draft-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: selectedId, item: { description, source: 'manual' } }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Toevoegen mislukt'); return }
      setQueues(prev => ({ ...prev, [selectedId]: json.items }))
      setInput('')
      resetEmailState()
    } catch {
      setError('Netwerkfout. Probeer het opnieuw.')
    }
  }

  // ── Remove one item ──
  async function removeItem(itemId: string) {
    if (!selectedId) return
    const next = selectedItems.filter(i => i.id !== itemId)
    setQueues(prev => ({ ...prev, [selectedId]: next }))  // optimistic
    resetEmailState()
    try {
      await fetch('/api/draft-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: selectedId, items: next }),
      })
    } catch { /* optimistic; reload on next mount */ }
  }

  // ── AI compose (server-side) ──
  async function compose() {
    if (!selectedId || selectedItems.length === 0) return
    setComposing(true)
    setError(null)
    setSentOk(false)
    try {
      const res = await fetch('/api/draft-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'compose', client_id: selectedId }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Opstellen mislukt'); return }
      setComposed({ subject: json.subject ?? '', body: json.body ?? '' })
    } catch {
      setError('Netwerkfout. Probeer het opnieuw.')
    } finally {
      setComposing(false)
    }
  }

  // ── Send via Resend (after human review) ──
  async function send() {
    if (!selectedId || !composed) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/draft-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          client_id: selectedId,
          subject: composed.subject,
          body: composed.body,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Verzenden mislukt'); return }
      setSentOk(true)
      setSentCleared(!!json.cleared)
      if (json.cleared) {
        // Server auto-cleared the queue after a confirmed send — mirror it locally.
        setQueues(prev => {
          const next = { ...prev }
          delete next[selectedId]
          return next
        })
        setComposed(null)
      }
    } catch {
      setError('Netwerkfout. Probeer het opnieuw.')
    } finally {
      setSending(false)
    }
  }

  // ── Clear this client's queue ("Annuleren") ──
  async function clearQueue() {
    if (!selectedId) return
    setError(null)
    try {
      const res = await fetch(`/api/draft-queue?client_id=${encodeURIComponent(selectedId)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error ?? 'Verwijderen mislukt')
        return
      }
      setQueues(prev => {
        const next = { ...prev }
        delete next[selectedId]
        return next
      })
      resetEmailState()
    } catch {
      setError('Netwerkfout. Probeer het opnieuw.')
    }
  }

  // ─────────────────────────────────────────────────────────
  // Styles (Workspace tokens)
  // ─────────────────────────────────────────────────────────

  const btnPrimary: CSSProperties = {
    backgroundColor: '#1A73E8', color: '#FFFFFF', border: 'none', borderRadius: 8,
    padding: '0 16px', height: 36, fontSize: 14, fontWeight: 500, cursor: 'pointer',
  }
  const btnSecondary: CSSProperties = {
    background: '#FFFFFF', color: '#1A73E8', border: '1px solid #1A73E8', borderRadius: 8,
    padding: '0 16px', height: 36, fontSize: 14, fontWeight: 500, cursor: 'pointer',
  }

  return (
    <>
      {/* Responsive rules — SSR-stable, no client-only branching */}
      <style>{`
        .bq-dq-root { font-family: 'Google Sans','Roboto',sans-serif; }
        @keyframes bq-shimmer { 0% { background-position: -240px 0; } 100% { background-position: 240px 0; } }
        .bq-skel {
          background: #ECEFF1;
          background-image: linear-gradient(90deg, #ECEFF1 0px, #F5F7F8 90px, #ECEFF1 180px);
          background-size: 360px 100%;
          border-radius: 6px;
          animation: bq-shimmer 1.1s linear infinite;
        }
        .bq-dq-panel {
          position: fixed; bottom: 16px; right: 16px; z-index: 50;
          width: 360px; max-width: calc(100vw - 32px);
          background: #FFFFFF; border: 1px solid #E0E0E0; border-radius: 8px;
          box-shadow: 0 4px 16px rgba(60,64,67,0.15);
          display: flex; flex-direction: column; overflow: hidden;
        }
        .bq-dq-fab {
          position: fixed; bottom: 16px; right: 16px; z-index: 50;
          display: flex; align-items: center; gap: 8px;
          height: 44px; padding: 0 16px;
          background: #1A73E8; color: #FFFFFF; border: none; border-radius: 22px;
          font-size: 14px; font-weight: 500; cursor: pointer;
          box-shadow: 0 2px 8px rgba(60,64,67,0.25);
        }
        @media (max-width: 640px) {
          .bq-dq-panel {
            left: 0; right: 0; bottom: 0; width: 100%; max-width: 100%;
            border-radius: 12px 12px 0 0; max-height: 85vh;
          }
          .bq-dq-fab { right: 12px; bottom: 12px; }
        }
      `}</style>

      <div className="bq-dq-root">
        {open ? (
          <div className="bq-dq-panel" role="dialog" aria-label="Draft Queue">
            {/* Header */}
            <div style={{
              background: '#1A73E8', padding: '12px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF' }}>Draft Queue</span>
                {totalCount > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: '#1A73E8', background: '#FFFFFF',
                    borderRadius: 10, padding: '1px 7px', minWidth: 18, textAlign: 'center',
                  }}>{totalCount}</span>
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Sluiten"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
              >✕</button>
            </div>

            {/* Body */}
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>

              {/* Client dropdown */}
              <select
                value={selectedId}
                onChange={e => { setSelectedId(e.target.value); resetEmailState() }}
                style={{
                  width: '100%', height: 36, fontSize: 14, padding: '0 10px',
                  border: '1px solid #BDBDBD', borderRadius: 8, background: '#F8F9FA',
                  color: '#202124', outline: 'none',
                }}
              >
                <option value="">Kies een klant…</option>
                {clients.map(c => {
                  const n = (queues[c.id] ?? []).length
                  return (
                    <option key={c.id} value={c.id}>
                      {(c.company_name || c.full_name || 'Onbekend')}{n > 0 ? ` (${n})` : ''}
                    </option>
                  )
                })}
              </select>

              {/* Items list */}
              {selectedId && (
                selectedItems.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>
                    Nog geen openstaande punten voor deze klant.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedItems.map(item => (
                      <div key={item.id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        background: '#F8F9FA', border: '1px solid #E0E0E0', borderRadius: 8,
                        padding: '8px 10px',
                      }}>
                        <span style={{ flex: 1, fontSize: 13, color: '#202124', lineHeight: 1.4 }}>
                          {item.source === 'not_found' && (
                            <span style={{
                              fontSize: 10, fontWeight: 600, color: '#C5221F', background: '#FCE8E6',
                              borderRadius: 4, padding: '1px 5px', marginRight: 6, textTransform: 'uppercase',
                            }}>Niet gevonden</span>
                          )}
                          {item.description}
                        </span>
                        <button
                          onClick={() => removeItem(item.id)}
                          aria-label="Verwijderen"
                          style={{ background: 'none', border: 'none', color: '#5F6368', fontSize: 15, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Manual add */}
              {selectedId && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addManual()}
                    placeholder="Punt toevoegen…"
                    style={{
                      flex: 1, height: 36, fontSize: 14, padding: '0 10px',
                      border: '1px solid #BDBDBD', borderRadius: 8, background: '#F8F9FA',
                      color: '#202124', outline: 'none',
                    }}
                  />
                  <button
                    onClick={addManual}
                    disabled={!input.trim()}
                    style={{ ...btnPrimary, opacity: input.trim() ? 1 : 0.4, whiteSpace: 'nowrap' }}
                  >Toevoegen</button>
                </div>
              )}

              {/* Compose skeleton — perceived speed during the AI call */}
              {composing && !composed && (
                <div style={{
                  background: '#F8F9FA', border: '1px solid #E0E0E0', borderRadius: 8,
                  padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div className="bq-skel" style={{ height: 12, width: '40%' }} />
                  <div className="bq-skel" style={{ height: 34, width: '100%' }} />
                  <div className="bq-skel" style={{ height: 12, width: '30%' }} />
                  <div className="bq-skel" style={{ height: 90, width: '100%' }} />
                </div>
              )}

              {/* Composed preview — editable (Human confirms) */}
              {composed && (
                <div style={{
                  background: '#F8F9FA', border: '1px solid #E0E0E0', borderRadius: 8,
                  padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#5F6368' }}>Onderwerp</label>
                  <input
                    value={composed.subject}
                    onChange={e => setComposed({ ...composed, subject: e.target.value })}
                    style={{
                      height: 34, fontSize: 13, padding: '0 8px',
                      border: '1px solid #BDBDBD', borderRadius: 6, background: '#FFFFFF', color: '#202124', outline: 'none',
                    }}
                  />
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#5F6368' }}>Bericht</label>
                  <textarea
                    value={composed.body}
                    onChange={e => setComposed({ ...composed, body: e.target.value })}
                    rows={7}
                    style={{
                      fontSize: 13, padding: 8, lineHeight: 1.5, resize: 'vertical',
                      border: '1px solid #BDBDBD', borderRadius: 6, background: '#FFFFFF', color: '#202124', outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
              )}

              {/* Feedback */}
              {error && <p style={{ fontSize: 13, color: '#C5221F', margin: 0 }}>{error}</p>}
              {sentOk && (
                <p style={{ fontSize: 13, color: '#137333', fontWeight: 500, margin: 0 }}>
                  ✓ E-mail verstuurd naar {clientName(selectedId)}.{sentCleared ? ' De lijst is gewist.' : ''}
                </p>
              )}

              {/* Actions */}
              {selectedId && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    onClick={compose}
                    disabled={composing || sending || selectedItems.length === 0}
                    style={{ ...btnSecondary, opacity: (composing || sending || selectedItems.length === 0) ? 0.5 : 1 }}
                  >{composing ? 'Bezig…' : 'AI opstellen'}</button>

                  <button
                    onClick={send}
                    disabled={!composed || sending}
                    style={{ ...btnPrimary, opacity: (!composed || sending) ? 0.5 : 1 }}
                  >{sending ? 'Versturen…' : 'Versturen'}</button>

                  <button
                    onClick={clearQueue}
                    disabled={selectedItems.length === 0 || sending}
                    style={{
                      background: '#FFFFFF', color: '#C5221F', border: '1px solid #BDBDBD',
                      borderRadius: 8, padding: '0 16px', height: 36, fontSize: 14, fontWeight: 500,
                      cursor: 'pointer', opacity: (selectedItems.length === 0 || sending) ? 0.5 : 1, marginLeft: 'auto',
                    }}
                  >Annuleren</button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <button className="bq-dq-fab" onClick={() => setOpen(true)}>
            <span>📋</span>
            <span>Draft Queue</span>
            {totalCount > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 600, color: '#1A73E8', background: '#FFFFFF',
                borderRadius: 10, padding: '1px 7px', minWidth: 18, textAlign: 'center',
              }}>{totalCount}</span>
            )}
          </button>
        )}
      </div>
    </>
  )
}