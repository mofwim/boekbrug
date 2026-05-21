'use client'

// src/modules/accountant/pages/KlantenBeheer.tsx
// [BOEK-028] Klanten beheren — Google Workspace design — May 2026
//
// Receives clients as props (fetched server-side via repository).
// Writes (unlink / invite) go through API routes.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useParentPath } from '@/lib/navigation-hooks'
import type { ClientSummary } from '../accountant.types'

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface Props {
  initialClients: ClientSummary[]
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function KlantenBeheer({ initialClients }: Props) {
  const router = useRouter()
  const parentHref = useParentPath('accountant')

  const [clients, setClients] = useState<ClientSummary[]>(initialClients)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)

  // Confirm unlink dialog state
  const [unlinkTarget, setUnlinkTarget] = useState<ClientSummary | null>(null)
  const [unlinkLoading, setUnlinkLoading] = useState(false)
  const [unlinkError, setUnlinkError] = useState<string | null>(null)

  // ─── Invite ─────────────────────────────────────────────

  async function handleInvite() {
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return
    setInviteLoading(true)
    setInviteError(null)
    setInviteSuccess(false)

    try {
      const res = await fetch('/api/accountant/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const json = await res.json()
      if (!res.ok) {
        setInviteError(json.error ?? 'Versturen mislukt.')
      } else {
        setInviteSuccess(true)
        setInviteEmail('')
      }
    } catch {
      setInviteError('Netwerkfout. Probeer het opnieuw.')
    } finally {
      setInviteLoading(false)
    }
  }

  // ─── Unlink ─────────────────────────────────────────────

  async function handleUnlink() {
    if (!unlinkTarget) return
    setUnlinkLoading(true)
    setUnlinkError(null)

    try {
      const res = await fetch('/api/accountant/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: unlinkTarget.id }),
      })
      const json = await res.json()
      if (!res.ok) {
        setUnlinkError(json.error ?? 'Verwijderen mislukt.')
      } else {
        setClients(prev => prev.filter(c => c.id !== unlinkTarget.id))
        setUnlinkTarget(null)
      }
    } catch {
      setUnlinkError('Netwerkfout. Probeer het opnieuw.')
    } finally {
      setUnlinkLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: "'Google Sans', 'Roboto', sans-serif" }}>

      {/* Header */}
      <div style={{
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #E0E0E0',
        padding: '0 24px',
        height: 64,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}>
        <Link
          href={parentHref}
          style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, color: '#1A73E8', fontSize: 14, fontWeight: 500 }}
        >
          ← Terug
        </Link>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#202124', margin: 0 }}>
          Klanten beheren
        </h1>
        <span style={{ fontSize: 13, color: '#5F6368', backgroundColor: '#F1F3F4', padding: '2px 10px', borderRadius: 12, marginLeft: 4 }}>
          {clients.length}
        </span>
      </div>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Invite block ── */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>Klant uitnodigen</h2>
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>
              Vul het e-mailadres van je klant in. Ze ontvangen een uitnodiging om BoekBrug te gebruiken.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setInviteError(null); setInviteSuccess(false) }}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
                placeholder="klant@bedrijf.nl"
                style={{
                  flex: 1,
                  fontSize: 14,
                  padding: '8px 12px',
                  border: `1px solid ${inviteError ? '#EA4335' : '#BDBDBD'}`,
                  borderRadius: 8,
                  backgroundColor: '#F8F9FA',
                  color: '#202124',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleInvite}
                disabled={inviteLoading || !inviteEmail.trim()}
                style={{
                  backgroundColor: '#1A73E8',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 18px',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  opacity: (inviteLoading || !inviteEmail.trim()) ? 0.5 : 1,
                  whiteSpace: 'nowrap',
                  minHeight: 36,
                }}
              >
                {inviteLoading ? 'Versturen...' : 'Nodig uit'}
              </button>
            </div>

            {inviteError && (
              <p style={{ fontSize: 13, color: '#EA4335', margin: 0 }}>{inviteError}</p>
            )}
            {inviteSuccess && (
              <p style={{ fontSize: 13, color: '#34A853', margin: 0, fontWeight: 500 }}>
                ✓ Uitnodiging verstuurd.
              </p>
            )}
          </div>
        </div>

        {/* ── Client list ── */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>Gekoppelde klanten</h2>
          </div>

          {clients.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>
              Nog geen klanten gekoppeld
            </p>
          ) : (
            <div>
              {clients.map((client, idx) => (
                <div
                  key={client.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    borderBottom: idx < clients.length - 1 ? '1px solid #F1F3F4' : 'none',
                    minHeight: 60,
                  }}
                >
                  {/* Status dot */}
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    backgroundColor: STATUS_COLOR[client.status] ?? '#E0E0E0',
                  }} />

                  {/* Name + email — clickable to client page */}
                  <button
                    onClick={() => router.push(`/dashboard/clients/${client.id}`)}
                    style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                  >
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.company_name ?? client.full_name ?? '—'}
                    </p>
                    <p style={{ fontSize: 12, color: '#5F6368', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.email}
                    </p>
                  </button>

                  {/* Status chip */}
                  <span style={{
                    fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4, flexShrink: 0,
                    backgroundColor: client.status === 'klaar' ? '#CEEAD6' : client.status === 'bijna_klaar' ? '#FEF7E0' : '#FCE8E6',
                    color: client.status === 'klaar' ? '#137333' : client.status === 'bijna_klaar' ? '#EA8600' : '#C5221F',
                  }}>
                    {STATUS_LABEL[client.status]}
                  </span>

                  {/* Unlink button */}
                  <button
                    onClick={() => { setUnlinkTarget(client); setUnlinkError(null) }}
                    style={{
                      background: 'none',
                      border: '1px solid #BDBDBD',
                      borderRadius: 8,
                      padding: '5px 12px',
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#EA4335',
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#FCE8E6')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    Ontkoppelen
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </main>

      {/* ── Confirm unlink dialog ── */}
      {unlinkTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !unlinkLoading && setUnlinkTarget(null)}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF', borderRadius: 12,
              padding: 24, maxWidth: 400, width: '100%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.24)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#202124', margin: '0 0 8px' }}>
              Klant ontkoppelen
            </h3>
            <p style={{ fontSize: 14, color: '#5F6368', margin: '0 0 20px', lineHeight: 1.5 }}>
              Weet je zeker dat je <strong>{unlinkTarget.company_name ?? unlinkTarget.full_name}</strong> wilt ontkoppelen?
              Je verliest toegang tot hun gegevens.
            </p>

            {unlinkError && (
              <p style={{ fontSize: 13, color: '#EA4335', margin: '0 0 12px' }}>{unlinkError}</p>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setUnlinkTarget(null)}
                disabled={unlinkLoading}
                style={{
                  background: '#FFFFFF', color: '#202124',
                  border: '1px solid #BDBDBD', borderRadius: 8,
                  padding: '8px 18px', fontSize: 14, fontWeight: 500,
                  cursor: 'pointer', minHeight: 36,
                }}
              >
                Annuleren
              </button>
              <button
                onClick={handleUnlink}
                disabled={unlinkLoading}
                style={{
                  backgroundColor: '#EA4335', color: '#FFFFFF',
                  border: 'none', borderRadius: 8,
                  padding: '8px 18px', fontSize: 14, fontWeight: 500,
                  cursor: 'pointer', opacity: unlinkLoading ? 0.6 : 1, minHeight: 36,
                }}
              >
                {unlinkLoading ? 'Verwijderen...' : 'Ontkoppelen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}