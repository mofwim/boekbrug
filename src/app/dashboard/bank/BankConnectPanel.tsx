'use client'

// src/app/dashboard/bank/BankConnectPanel.tsx
// [ENABLEBANKING] "Koppel je bank" — the panel above the upload card on /dashboard/bank.
//
// Three things the owner has to be able to see here, and each one is a decision, not decoration:
//
//   1. WHEN THE CONSENT DIES. A PSD2 consent lasts at most 90 days and then the feed simply goes
//      quiet — no error, no gap on screen, just a month that never arrives. The expiry date is
//      therefore shown from the moment the connection is made, and turns into a warning as it
//      approaches. This is the panel's most important job.
//   2. WHETHER "VERVERS" WILL ACTUALLY DO ANYTHING. The bank allows a handful of reads per day
//      per account, so the button is disabled once they are spent, with the reason spelled out.
//      A button that silently no-ops teaches the owner that the app is broken.
//   3. THAT UPLOADING STILL WORKS. A bank link does not replace the upload card — it sits above
//      it. Banks refuse, consents lapse, and some accounts are simply not offered over PSD2.
//
// The component owns its own fetching but accepts `initialState`, so the render gate can hand it
// rows and call it (effects never run under renderToStaticMarkup).

import { useCallback, useEffect, useState } from 'react'
import { M3, R, EL1 } from '@/lib/design/tokens'
// [TAAL] A component holds no language of its own.
import { useLocale } from '@/lib/i18n/use-locale'
import { translator, type Translator } from '@/lib/i18n/t'

const FONT = "'Roboto', -apple-system, sans-serif"

export interface ConnectedAccount {
  id: string
  iban: string | null
  ownerName: string | null
  currency: string | null
  status: string | null
  lastSyncedAt: string | null
  lastSyncedThrough: string | null
  lastError: string | null
}

export interface BankConnectionView {
  id: string
  institutionName: string
  institutionBic: string | null
  status: 'pending' | 'linked' | 'expired' | 'error' | 'revoked'
  connectedAt: string | null
  lastSyncedAt: string | null
  lastError: string | null
  accessValidUntil: string | null
  daysUntilExpiry: number | null
  canSyncNow: boolean
  accounts: ConnectedAccount[]
}

/** A bank as Enable Banking lists it. There is no id: the {name, country} PAIR identifies it,
 *  which is why both halves travel together into the connect call. */
export interface Institution {
  name: string
  country: string
  logo: string | null
}

export interface BankConnectState {
  configured: boolean
  connections: BankConnectionView[]
}

interface Props {
  /** Supplied by the render gate; in the app the panel fetches its own state. */
  initialState?: BankConnectState | null
  /** Called after a sync imported new transactions, so the page can reload its lists. */
  onImported?: (inserted: number) => void
  /** Dutch one-liners the page shows as a toast. */
  onMessage?: (text: string) => void
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(iso: string | null, t: Translator): string {
  if (!iso) return t('bkc.nogNiet')
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return t('bkc.nogNiet')
  return d.toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * How the expiry reads to the owner, and how loud it is.
 *
 * Exported and pure so the wording is testable without a browser: "verloopt over 0 dagen" is the
 * kind of sentence that only looks wrong once a real person reads it on the day it matters.
 */
export function expiryNotice(days: number | null, t: Translator = translator('nl')): { text: string; tone: 'quiet' | 'warn' | 'dead' } | null {
  if (days === null) return null
  if (days < 0) return { text: t('bkc.verlopen'), tone: 'dead' }
  if (days === 0) return { text: t('bkc.verlooptVandaag'), tone: 'warn' }
  if (days === 1) return { text: t('bkc.verlooptMorgen'), tone: 'warn' }
  if (days <= 10) return { text: t('bkc.verlooptOver', { days }), tone: 'warn' }
  return { text: t('bkc.geldigDagen', { days }), tone: 'quiet' }
}

/** The status line under a connected bank. */
export function statusLabel(c: BankConnectionView, t: Translator = translator('nl')): string {
  switch (c.status) {
    case 'linked':
      return t('bkc.laatstOpgehaald', { time: fmtDateTime(c.lastSyncedAt, t) })
    case 'pending':
      return t('bkc.pending')
    case 'expired':
      return t('bkc.expired')
    case 'error':
      return c.lastError ?? t('bkc.error')
    case 'revoked':
      return t('bkc.revoked')
  }
}

export default function BankConnectPanel({ initialState = null, onImported, onMessage }: Props) {
  const t = translator(useLocale())
  const [state, setState] = useState<BankConnectState | null>(initialState)
  const [institutions, setInstitutions] = useState<Institution[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/bank/enablebanking/status')
      if (!res.ok) return
      setState((await res.json()) as BankConnectState)
    } catch {
      /* the panel simply stays as it was — never a blocking failure on the bank page */
    }
  }, [])

  useEffect(() => {
    // Wrapped in an async IIFE rather than called directly: the state update happens after the
    // await, not synchronously in the effect body — the same shape the rest of this page uses
    // for its on-mount loads.
    if (!initialState) void (async () => { await loadStatus() })()
  }, [initialState, loadStatus])

  const openPicker = useCallback(async () => {
    setPicking(true)
    if (institutions) return
    try {
      const res = await fetch('/api/bank/enablebanking/banks?country=NL')
      const json = await res.json()
      setInstitutions(Array.isArray(json.banks) ? json.banks : [])
      if (json.error) onMessage?.(String(json.error))
    } catch {
      setInstitutions([])
      onMessage?.(t('bkc.banklijstFout'))
    }
  }, [institutions, onMessage])

  const connect = useCallback(async (bank: Institution) => {
    setBusy(bank.name)
    try {
      const res = await fetch('/api/bank/enablebanking/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankName: bank.name, bankCountry: bank.country }),
      })
      const json = await res.json()
      if (!res.ok || !json.link) {
        onMessage?.(json?.error ?? t('bkc.koppelenMislukt'))
        setBusy(null)
        return
      }
      // The owner leaves for his own bank. Everything after this happens in the callback route.
      window.location.href = json.link as string
    } catch {
      onMessage?.(t('bkc.koppelenMislukt'))
      setBusy(null)
    }
  }, [onMessage])

  const sync = useCallback(async (connectionId: string) => {
    setBusy(connectionId)
    try {
      const res = await fetch('/api/bank/enablebanking/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      })
      const json = await res.json()
      if (!res.ok) {
        onMessage?.(json?.error ?? t('bkc.ophalenMislukt'))
        return
      }
      const inserted = Number(json.inserted ?? 0)
      const warnings: string[] = Array.isArray(json.warnings) ? json.warnings : []
      const tooSoon = Array.isArray(json.connections) && json.connections.every((c: { skippedTooSoon?: boolean }) => c.skippedTooSoon)

      if (warnings.length > 0) {
        // Never silently short a transaction — the same rule the upload path follows.
        onMessage?.(
          warnings.length === 1
            ? t('bkc.metWaarschuwingenEen', { inserted })
            : t('bkc.metWaarschuwingen', { inserted, warnings: warnings.length }),
        )
      } else if (tooSoon) {
        onMessage?.(t('bkc.teSnel'))
      } else {
        onMessage?.(inserted > 0 ? t('bkc.opgehaald', { inserted }) : t('bkc.geenNieuwe'))
      }
      if (inserted > 0) onImported?.(inserted)
      await loadStatus()
    } catch {
      onMessage?.(t('bkc.ophalenMislukt'))
    } finally {
      setBusy(null)
    }
  }, [loadStatus, onImported, onMessage])

  const disconnect = useCallback(async (connectionId: string) => {
    setBusy(connectionId)
    try {
      const res = await fetch('/api/bank/enablebanking/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      })
      if (!res.ok) {
        onMessage?.(t('bkc.ontkoppelenMislukt'))
        return
      }
      onMessage?.(t('bkc.ontkoppeld'))
      await loadStatus()
    } catch {
      onMessage?.(t('bkc.ontkoppelenMislukt'))
    } finally {
      setBusy(null)
    }
  }, [loadStatus, onMessage])

  // A server without Enable Banking credentials has no bank link to offer. Hiding the card entirely
  // beats showing a button that can only fail.
  if (!state?.configured) return null

  const connections = state.connections.filter((c) => c.status !== 'revoked')

  return (
    <section style={{ marginBottom: 16 }}>
      {connections.length === 0 && !picking && (
        <button
          type="button"
          onClick={() => void openPicker()}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'start',
            padding: '14px 16px', borderRadius: R.lg, background: M3.surface, boxShadow: EL1,
            border: `1px solid ${M3.outline}`, cursor: 'pointer', fontFamily: FONT,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 24, color: M3.primary }} aria-hidden>account_balance</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: M3.onSurface }}>
              {t('bkc.koppelKop')}
            </span>
            <span style={{ display: 'block', fontSize: 12, color: M3.onSurfaceVariant, marginTop: 2 }}>
              {t('bkc.koppelSub')}
            </span>
          </span>
          <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20, color: M3.onSurfaceVariant }} aria-hidden>chevron_right</span>
        </button>
      )}

      {picking && (
        <div style={{ padding: '14px 16px', borderRadius: R.lg, background: M3.surface, boxShadow: EL1, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <strong style={{ fontSize: 14, color: M3.onSurface }}>{t('bkc.kiesBank')}</strong>
            <button
              type="button"
              onClick={() => setPicking(false)}
              style={{ background: 'none', border: 'none', color: M3.primary, fontSize: 13, cursor: 'pointer', fontFamily: FONT }}
            >
              {t('bkc.annuleren')}
            </button>
          </div>
          <p style={{ fontSize: 12, color: M3.onSurfaceVariant, margin: '0 0 10px', lineHeight: 1.5 }}>
            {t('bkc.leesrechten')}
          </p>
          {institutions === null && (
            <p style={{ fontSize: 13, color: M3.onSurfaceVariant, margin: 0 }}>{t('bkc.bankenLaden')}</p>
          )}
          {institutions?.length === 0 && (
            <p style={{ fontSize: 13, color: M3.onSurfaceVariant, margin: 0 }}>
              {t('bkc.geenBanken')}
            </p>
          )}
          {institutions && institutions.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
              {institutions.map((inst) => (
                <li key={`${inst.country}:${inst.name}`}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void connect(inst)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'start',
                      padding: '10px 12px', borderRadius: R.md, border: `1px solid ${M3.surfaceVariant}`,
                      background: busy === inst.name ? M3.primaryContainer : M3.surface,
                      cursor: busy ? 'default' : 'pointer', fontFamily: FONT, fontSize: 13.5, color: M3.onSurface,
                    }}
                  >
                    {/* No "N dagen historie" badge here. Enable Banking's bank list does not say
                        how far back a bank goes, and a number invented for the screen would be a
                        promise the feed cannot keep. */}
                    <span style={{ flex: 1, minWidth: 0 }}>{inst.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {connections.map((c) => {
        const notice = expiryNotice(c.daysUntilExpiry, t)
        const dead = c.status === 'expired' || (c.daysUntilExpiry !== null && c.daysUntilExpiry < 0)
        return (
          <div
            key={c.id}
            style={{
              padding: '14px 16px', borderRadius: R.lg, background: M3.surface, boxShadow: EL1,
              marginBottom: 10, fontFamily: FONT,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: dead ? '#B3261E' : M3.primary }} aria-hidden>
                account_balance
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: M3.onSurface }}>
                  {c.institutionName}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: M3.onSurfaceVariant, marginTop: 1 }}>
                  {statusLabel(c, t)}
                </span>
              </span>
            </div>

            {c.accounts.length > 0 && (
              <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {c.accounts.map((a) => (
                  <li key={a.id} style={{ fontSize: 12.5, color: M3.onSurfaceVariant }}>
                    {a.iban ?? t('bkc.rekening')}
                    {a.ownerName ? ` · ${a.ownerName}` : ''}
                    {a.lastSyncedThrough ? t('bkc.bijgewerktTm', { date: fmtDate(a.lastSyncedThrough) }) : ''}
                  </li>
                ))}
              </ul>
            )}

            {notice && (
              <div
                style={{
                  marginTop: 10, padding: '8px 10px', borderRadius: R.sm, fontSize: 12.5,
                  fontWeight: notice.tone === 'quiet' ? 400 : 600,
                  background: notice.tone === 'dead' ? '#FCE8E6' : notice.tone === 'warn' ? '#FEF7E0' : M3.surfaceVariant,
                  color: notice.tone === 'dead' ? '#8C1D18' : notice.tone === 'warn' ? '#7A4F00' : M3.onSurfaceVariant,
                }}
              >
                {notice.tone === 'quiet'
                  ? t('bkc.geldigTot', { date: fmtDate(c.accessValidUntil) })
                  : notice.text}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {dead ? (
                <button
                  type="button"
                  onClick={() => void openPicker()}
                  style={{
                    padding: '8px 14px', borderRadius: R.full, border: 'none', background: M3.primary,
                    color: M3.onPrimary, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                  }}
                >
                  {t('bkc.opnieuwKoppelen')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy === c.id || !c.canSyncNow}
                  onClick={() => void sync(c.id)}
                  title={c.canSyncNow ? undefined : t('bkc.dagLimiet')}
                  style={{
                    padding: '8px 14px', borderRadius: R.full, border: `1px solid ${M3.primary}`,
                    background: 'transparent', color: M3.primary, fontSize: 13, fontWeight: 600,
                    cursor: busy === c.id || !c.canSyncNow ? 'default' : 'pointer',
                    opacity: busy === c.id || !c.canSyncNow ? 0.5 : 1, fontFamily: FONT,
                  }}
                >
                  {busy === c.id ? t('bkc.bezig') : t('bkc.ververs')}
                </button>
              )}
              <button
                type="button"
                disabled={busy === c.id}
                onClick={() => void disconnect(c.id)}
                style={{
                  padding: '8px 14px', borderRadius: R.full, border: 'none', background: 'transparent',
                  color: M3.onSurfaceVariant, fontSize: 13, cursor: 'pointer', fontFamily: FONT,
                }}
              >
                {t('bkc.ontkoppelen')}
              </button>
            </div>

            {/* A connected bank does not replace the statement file. The accountant's package
                still wants one, and the closing package says so for a quarter that has only
                bank-fed transactions — better to say it here, before the quarter closes. */}
            {c.status === 'linked' && (
              <p style={{ fontSize: 11.5, color: M3.onSurfaceVariant, margin: '10px 0 0', lineHeight: 1.5 }}>
                {t('bkc.afschriftNodig')}
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}
