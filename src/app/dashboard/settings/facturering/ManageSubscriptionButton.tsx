'use client'

// src/app/dashboard/settings/facturering/ManageSubscriptionButton.tsx
// [BILLING] Opens Stripe's hosted portal — or, for an account that never
// subscribed, sends them to the price page instead of showing a dead button.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ManageSubscriptionButton({ hasSubscription }: { hasSubscription: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        // The route tells us where to send someone with no subscription.
        if (body?.redirect) {
          router.push(body.redirect)
          return
        }
        setError(body?.error || 'Kon het abonnementenbeheer niet openen.')
        setBusy(false)
        return
      }

      window.location.href = body.url
    } catch {
      setError('Geen verbinding. Probeer het opnieuw.')
      setBusy(false)
    }
  }

  if (!hasSubscription) {
    return (
      <a
        href="/prijzen"
        style={{
          display: 'inline-block', padding: '12px 20px', fontSize: 15, fontWeight: 600,
          color: '#fff', background: '#1A73E8', borderRadius: 10, textDecoration: 'none',
        }}
      >
        Neem een abonnement
      </a>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        style={{
          padding: '12px 20px', fontSize: 15, fontWeight: 600,
          color: busy ? '#5f6368' : '#1A73E8', background: '#fff',
          border: '1px solid #1A73E8', borderRadius: 10,
          cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
        }}
      >
        {busy ? 'Bezig…' : 'Beheer abonnement'}
      </button>
      <p style={{ fontSize: 13, color: '#5f6368', margin: '8px 0 0', lineHeight: 1.5 }}>
        Betaalgegevens wijzigen, btw-facturen downloaden of opzeggen.
      </p>
      {error && (
        <p role="alert" style={{ color: '#B3261E', fontSize: 14, margin: '8px 0 0' }}>{error}</p>
      )}
    </div>
  )
}
