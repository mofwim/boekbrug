'use client'

// src/components/settings/MollieCard.tsx
// [MOLLIE] Instellingenkaart: eigen Mollie-account koppelen voor iDEAL-betaallinks.
//
// De kaart kent het geheim nooit: de sleutel gaat één kant op (POST /api/mollie/connect),
// wordt daar LIVE bij Mollie gecontroleerd en in Vault gelegd; terug komt alleen de status.
// [TAAL] Alle tekst via messages.ts — een component houdt geen taal van zichzelf.

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { failureText } from '@/lib/server-message'

interface Status {
  connected: boolean
  status?: string
  connectedAt?: string
  lastError?: string | null
}

export function MollieCard() {
  const t = translator(useLocale())
  const [status, setStatus] = useState<Status | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/mollie/connect')
        const json = await res.json().catch(() => ({}))
        if (!cancelled && res.ok) setStatus(json as Status)
        if (!cancelled && !res.ok) setStatus({ connected: false })
      } catch {
        if (!cancelled) setStatus({ connected: false })
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function connect() {
    if (busy || !apiKey.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/mollie/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(failureText(res.status, json, t('mollie.mislukt')))
      } else {
        setStatus(json as Status)
        setApiKey('')
      }
    } catch {
      setError(t('mollie.mislukt'))
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/mollie/connect', { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setStatus({ connected: false })
      else setError(failureText(res.status, json, t('mollie.mislukt')))
    } catch {
      setError(t('mollie.mislukt'))
    } finally {
      setBusy(false)
    }
  }

  const connectedSince = status?.connectedAt
    ? new Date(status.connectedAt).toLocaleDateString('nl-NL', { day: '2-digit', month: 'long', year: 'numeric' })
    : ''

  return (
    <div style={{ background: '#fff', border: '1px solid #E0E0E0', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{t('mollie.titel')}</h2>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13, color: '#5F6368', margin: 0, lineHeight: 1.6 }}>{t('mollie.uitleg')}</p>

        {status?.connected ? (
          <>
            <p style={{ fontSize: 13.5, color: '#137333', fontWeight: 600, margin: 0 }}>
              ✓ {t('mollie.gekoppeld').replace('{date}', connectedSince)}
            </p>
            {status.lastError && (
              <p style={{ fontSize: 12.5, color: '#B3261E', margin: 0, lineHeight: 1.5 }}>{status.lastError}</p>
            )}
            <div>
              <button
                onClick={disconnect}
                disabled={busy}
                style={{ background: 'none', border: '1px solid #DADCE0', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, color: '#B3261E', cursor: 'pointer', opacity: busy ? 0.5 : 1, fontFamily: 'inherit' }}
              >
                {busy ? t('mollie.bezig') : t('mollie.ontkoppel')}
              </button>
            </div>
          </>
        ) : status ? (
          <>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: '#202124' }}>
              {t('mollie.sleutel')}
              <input
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setError('') }}
                placeholder="live_..."
                autoComplete="off"
                style={{ display: 'block', width: '100%', marginTop: 6, fontSize: 14, padding: '8px 12px', border: `1px solid ${error ? '#EA4335' : '#DADCE0'}`, borderRadius: 8, background: '#F8F9FA', color: '#202124', outline: 'none', boxSizing: 'border-box' }}
              />
            </label>
            <p style={{ fontSize: 12, color: '#5F6368', margin: 0 }}>{t('mollie.sleutelHint')}</p>
            <div>
              <button
                onClick={connect}
                disabled={busy || !apiKey.trim()}
                style={{ background: '#1A73E8', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: (busy || !apiKey.trim()) ? 0.5 : 1, fontFamily: 'inherit' }}
              >
                {busy ? t('mollie.bezig') : t('mollie.koppel')}
              </button>
            </div>
          </>
        ) : null}

        {error && <p style={{ fontSize: 13, color: '#B3261E', margin: 0, lineHeight: 1.5 }}>{error}</p>}
      </div>
    </div>
  )
}
