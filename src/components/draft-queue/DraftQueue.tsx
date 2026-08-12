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
//   (#1A73E8, 8px radius, 36px buttons, Roboto, <=100ms background-only animation),
//   as in KlantenBeheer.tsx / AccountantWerkplek.tsx. NOT the ZZP Material You system.
// Responsive: floating card bottom-right on desktop; full-width bottom-sheet on mobile.
//
// Email flow (Tech Lead decisions):
//   - The Onderwerp/Bericht editor is ALWAYS available to write manually.
//   - "AI opstellen" fills it (skeleton while the AI call is in flight).
//   - "Versturen" is enabled once subject + body are non-empty (typed or AI). After a
//     confirmed send the server auto-clears the queue (mirrored locally).
//   - "Annuleren" discards the DRAFT only — it never deletes the queue. Items are
//     removed individually via the X on each row; the queue clears only after a send.
//
// All persistence + AI + send go through /api/draft-queue (server-side, RLS, Resend).
// This component holds UI state only.

import { useEffect, useState, type CSSProperties } from 'react'
// [SERVER-ZIN] Never a machine code in front of the owner — see server-message.ts.
import { failureText } from '@/lib/server-message'
import type { DraftItem } from '@/app/api/draft-queue/route'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

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
  const t = translator(useLocale())
  const [open, setOpen] = useState(false)
  const [queues, setQueues] = useState<Record<string, DraftItem[]>>({})
  const [selectedId, setSelectedId] = useState('')
  const [input, setInput] = useState('')

  const [composing, setComposing] = useState(false)
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')

  const [sending, setSending] = useState(false)
  const [sentOk, setSentOk] = useState(false)
  const [sentCleared, setSentCleared] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedItems = selectedId ? (queues[selectedId] ?? []) : []
  const totalCount = Object.values(queues).reduce((sum, items) => sum + items.length, 0)
  const canSend = subject.trim().length > 0 && bodyText.trim().length > 0

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

  function clientName(id: string): string {
    const c = clients.find(x => x.id === id)
    return c?.company_name || c?.full_name || 'Klant'
  }

  // Clears only the sent/feedback status — never a draft the user is writing.
  function clearStatus() {
    setSentOk(false)
    setSentCleared(false)
    setError(null)
  }

  // Full reset of the email draft + status (used on client switch and "Annuleren").
  function resetEmail() {
    setSubject('')
    setBodyText('')
    clearStatus()
  }

  function selectClient(id: string) {
    setSelectedId(id)
    resetEmail()
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
      if (!res.ok) { setError(failureText(res.status, json, 'Toevoegen mislukt')); return }
      setQueues(prev => ({ ...prev, [selectedId]: json.items }))
      setInput('')
      clearStatus()
    } catch {
      setError(t('dq.netwerkfout'))
    }
  }

  // ── Remove one item (X) ──
  async function removeItem(itemId: string) {
    if (!selectedId) return
    const next = selectedItems.filter(i => i.id !== itemId)
    setQueues(prev => ({ ...prev, [selectedId]: next }))  // optimistic
    clearStatus()
    try {
      await fetch('/api/draft-queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: selectedId, items: next }),
      })
    } catch { /* optimistic; reload on next mount */ }
  }

  // ── AI compose (server-side) — fills the editor ──
  async function compose() {
    if (!selectedId || selectedItems.length === 0) return
    setComposing(true)
    setError(null)
    setSentOk(false)
    setSentCleared(false)
    try {
      const res = await fetch('/api/draft-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'compose', client_id: selectedId }),
      })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, 'Opstellen mislukt')); return }
      setSubject(json.subject ?? '')
      setBodyText(json.body ?? '')
    } catch {
      setError(t('dq.netwerkfout'))
    } finally {
      setComposing(false)
    }
  }

  // ── Send via Resend (manual- or AI-written; human confirms) ──
  async function send() {
    if (!selectedId || !canSend) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/draft-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          client_id: selectedId,
          subject: subject.trim(),
          body: bodyText.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(failureText(res.status, json, 'Verzenden mislukt')); return }
      setSentOk(true)
      setSentCleared(!!json.cleared)
      if (json.cleared) {
        // Server auto-cleared the queue after a confirmed send — mirror it locally
        // and discard the now-sent draft.
        setQueues(prev => {
          const next = { ...prev }
          delete next[selectedId]
          return next
        })
        setSubject('')
        setBodyText('')
      }
    } catch {
      setError(t('dq.netwerkfout'))
    } finally {
      setSending(false)
    }
  }

  // ── Annuleren — discard the draft only; the queue is left untouched ──
  function discardDraft() {
    resetEmail()
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
  const editorBox: CSSProperties = {
    background: '#F8F9FA', border: '1px solid #E0E0E0', borderRadius: 8,
    padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
  }
  const labelStyle: CSSProperties = { fontSize: 11, fontWeight: 600, color: '#5F6368' }

  return (
    <>
      {/* Responsive + skeleton rules — SSR-stable, no client-only branching */}
      <style>{`
        .bq-dq-root { font-family: 'Roboto',sans-serif; }
        @keyframes bq-shimmer { 0% { background-position: -240px 0; } 100% { background-position: 240px 0; } }
        .bq-skel {
          background: #e0e0e0;
          background-image: linear-gradient(90deg, #e0e0e0 0px, #F5F7F8 90px, #e0e0e0 180px);
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
          .bq-dq-fab { insetInlineEnd: 12px; bottom: 12px; }
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
                aria-label={t('lijst.sluiten')}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
              >✕</button>
            </div>

            {/* Body */}
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>

              {/* Client dropdown */}
              <select
                value={selectedId}
                onChange={e => selectClient(e.target.value)}
                style={{
                  width: '100%', height: 36, fontSize: 14, padding: '0 10px',
                  border: '1px solid #dadce0', borderRadius: 8, background: '#F8F9FA',
                  color: '#202124', outline: 'none',
                }}
              >
                <option value="">{t('dq.kiesKlant')}</option>
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
              {selectedId && selectedItems.length > 0 && (
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
                            borderRadius: 4, padding: '1px 5px', marginInlineEnd: 6, textTransform: 'uppercase',
                          }}>{t('dq.nietGevonden')}</span>
                        )}
                        {item.description}
                      </span>
                      <button
                        onClick={() => removeItem(item.id)}
                        aria-label={t('lijst.verwijderen')}
                        style={{ background: 'none', border: 'none', color: '#5F6368', fontSize: 15, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}

              {selectedId && selectedItems.length === 0 && !sentOk && (
                <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>
                  {t('dq.geenPunten')}
                </p>
              )}

              {/* Manual add (always available to build the list) */}
              {selectedId && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addManual()}
                    placeholder={t('dq.puntToevoegen')}
                    style={{
                      flex: 1, height: 36, fontSize: 14, padding: '0 10px',
                      border: '1px solid #dadce0', borderRadius: 8, background: '#F8F9FA',
                      color: '#202124', outline: 'none',
                    }}
                  />
                  <button
                    onClick={addManual}
                    disabled={!input.trim()}
                    style={{ ...btnPrimary, opacity: input.trim() ? 1 : 0.4, whiteSpace: 'nowrap' }}
                  >{t('ink.toevoegen')}</button>
                </div>
              )}

              {/* Email editor — manual or AI-filled; skeleton only during the AI call */}
              {selectedId && selectedItems.length > 0 && (
                composing ? (
                  <div style={editorBox}>
                    <div className="bq-skel" style={{ height: 12, width: '40%' }} />
                    <div className="bq-skel" style={{ height: 34, width: '100%' }} />
                    <div className="bq-skel" style={{ height: 12, width: '30%' }} />
                    <div className="bq-skel" style={{ height: 90, width: '100%' }} />
                  </div>
                ) : (
                  <div style={editorBox}>
                    <label style={labelStyle}>{t('dq.onderwerp')}</label>
                    <input
                      value={subject}
                      onChange={e => { setSubject(e.target.value); clearStatus() }}
                      placeholder={t('dq.onderwerpPh')}
                      style={{
                        height: 34, fontSize: 13, padding: '0 8px',
                        border: '1px solid #dadce0', borderRadius: 6, background: '#FFFFFF', color: '#202124', outline: 'none',
                      }}
                    />
                    <label style={labelStyle}>{t('dq.bericht')}</label>
                    <textarea
                      value={bodyText}
                      onChange={e => { setBodyText(e.target.value); clearStatus() }}
                      rows={7}
                      placeholder={t('dq.berichtPh')}
                      style={{
                        fontSize: 13, padding: 8, lineHeight: 1.5, resize: 'vertical',
                        border: '1px solid #dadce0', borderRadius: 6, background: '#FFFFFF',
                        color: '#202124', outline: 'none', fontFamily: 'inherit',
                      }}
                    />
                  </div>
                )
              )}

              {/* Feedback */}
              {error && <p style={{ fontSize: 13, color: '#C5221F', margin: 0 }}>{error}</p>}
              {sentOk && (
                <p style={{ fontSize: 13, color: '#137333', fontWeight: 500, margin: 0 }}>
                  ✓ E-mail verstuurd naar {clientName(selectedId)}.{sentCleared ? ' De lijst is gewist.' : ''}
                </p>
              )}

              {/* Actions */}
              {selectedId && selectedItems.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    onClick={compose}
                    disabled={composing || sending}
                    style={{ ...btnSecondary, opacity: (composing || sending) ? 0.5 : 1 }}
                  >{composing ? 'Bezig…' : 'AI opstellen'}</button>

                  <button
                    onClick={send}
                    disabled={!canSend || sending || composing}
                    style={{ ...btnPrimary, opacity: (!canSend || sending || composing) ? 0.5 : 1 }}
                  >{sending ? 'Versturen…' : 'Versturen'}</button>

                  <button
                    onClick={discardDraft}
                    disabled={(!subject && !bodyText) || sending}
                    style={{
                      background: '#FFFFFF', color: '#5F6368', border: '1px solid #dadce0',
                      borderRadius: 8, padding: '0 16px', height: 36, fontSize: 14, fontWeight: 500,
                      cursor: 'pointer', opacity: ((!subject && !bodyText) || sending) ? 0.5 : 1, marginInlineStart: 'auto',
                    }}
                  >{t('lijst.annuleren')}</button>
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