'use client'

// src/components/grootboek/GrootboekPanel.tsx
// [GROOTBOEK] The purchase invoices that still need a cost account, each with a suggestion and the
// reason for it. One tap confirms; the dropdown overrules.
//
// It sits beside the auditfile link on the Jaar screen because that is what it is FOR: every
// invoice answered here is one line the boekhouder does not have to re-code by hand.
//
// [NO-SILENT-EMPTY] Nothing is rendered until the read answers. "Everything has an account" and
// "we could not look" are opposite answers, and the first is the dangerous one — it tells the
// owner their administratie is finished.
//
// [TAAL] The component holds no language of its own; suggestionReason decides which words.

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { formatEuroNL } from '@/lib/format-nl'
import { suggestionReason, openCountPhrase } from '@/lib/grootboek-lines'
import type { LedgerAccount, LedgerSuggestion } from '@/lib/grootboek'

interface OpenInvoice {
  id: string
  invoiceNumber: string | null
  invoiceDate: string | null
  vendor: string | null
  totalIncBtw: number | null
  suggestion: LedgerSuggestion
}

interface Payload {
  ok: true
  accounts: LedgerAccount[]
  open: OpenInvoice[]
  decided: number
  total: number
}

// The list is answered a few at a time, on a phone, between other things. Showing all 608 at once
// is a wall; showing a handful with a count above it is a task.
const PAGE = 8

export default function GrootboekPanel() {
  const t = translator(useLocale())
  const [data, setData] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState(false)
  const [shown, setShown] = useState(PAGE)

  // Same shape as the sibling panels: the fetch is started inside the effect and its answer is
  // dropped if the screen moved on, so a slow read can never write over a newer one.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/grootboek')
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !json?.ok) { setFailed(true); setData(null); return }
        setData(json as Payload); setFailed(false)
      } catch {
        if (!cancelled) { setFailed(true); setData(null) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const assign = async (id: string, account: string) => {
    setSaving(id); setSaveError(false)
    try {
      const res = await fetch('/api/grootboek', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, account }),
      })
      if (!res.ok) { setSaveError(true); return }
      // Drop the answered row locally rather than re-reading the whole list: the owner is working
      // through it and a re-fetch would move the ground under the next tap.
      setData((d) => (d ? { ...d, open: d.open.filter((o) => o.id !== id), decided: d.decided + 1 } : d))
    } catch { setSaveError(true) } finally { setSaving(null) }
  }

  if (!failed && !data) return null

  const count = openCountPhrase(data?.open.length ?? 0)

  return (
    <section data-testid="grootboek" style={{ background: '#fff', borderRadius: 14, border: '1px solid #E0E0E0', padding: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px', color: '#202124' }}>{t('gb.kop')}</h2>
      {failed || !data ? (
        <p style={{ fontSize: 13.5, color: '#B26A00', margin: 0 }}>{t('gb.leesfout')}</p>
      ) : (
        <>
          <p style={{ fontSize: 13.5, color: '#5F6368', margin: '0 0 10px' }}>{t(count.key, count.params)}</p>
          {data.open.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {data.open.slice(0, shown).map((inv) => {
                const why = suggestionReason(inv.suggestion)
                return (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid #F1F3F4' }}>
                    <span style={{ flex: '1 1 160px', minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inv.vendor || '—'}
                      </span>
                      <span style={{ display: 'block', fontSize: 12, color: '#80868B', marginTop: 1 }}>
                        {[inv.invoiceDate, inv.invoiceNumber].filter(Boolean).join(' · ')} — {t(why.key, why.params)}
                      </span>
                    </span>
                    {inv.totalIncBtw !== null && (
                      <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 13.5, color: '#202124', minWidth: 88, textAlign: 'end' }}>
                        {formatEuroNL(inv.totalIncBtw)}
                      </span>
                    )}
                    {/* The suggestion is PRE-SELECTED, never pre-saved. Changing it here is the
                        answer; there is no separate confirm, because a two-tap answer on a list of
                        hundreds is a list nobody finishes. */}
                    <select
                      aria-label={t('gb.kop')}
                      defaultValue={inv.suggestion.accountId}
                      disabled={saving === inv.id}
                      onChange={(e) => void assign(inv.id, e.target.value)}
                      style={{ fontSize: 13, padding: '6px 8px', borderRadius: 8, border: '1px solid #DADCE0', background: '#fff', color: '#202124', maxWidth: 220 }}
                    >
                      {data.accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.id} · {a.name}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          )}
          {saveError && <p style={{ fontSize: 13, color: '#B3261E', margin: '10px 0 0' }}>{t('gb.opslaanFout')}</p>}
          {data.open.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, color: '#1A73E8', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {t('gb.meer')}
            </button>
          )}
          <p style={{ fontSize: 12, color: '#5F6368', margin: '10px 0 0', lineHeight: 1.55 }}>{t('gb.uitleg')}</p>
        </>
      )}
    </section>
  )
}
