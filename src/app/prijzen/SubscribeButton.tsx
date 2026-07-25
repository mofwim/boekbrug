'use client'

// src/app/prijzen/SubscribeButton.tsx
// [BILLING] The one button that takes money.
//
// Client component so the price page itself can stay a static, indexable server
// component. It posts to /api/billing/checkout and follows the Stripe URL that
// comes back.
//
// Three states matter and all three are handled, because a payment button that
// fails silently is worse than no button:
//   · logged out (401) → send to /register, not an error nobody can act on;
//   · billing not configured yet (503) → say so plainly;
//   · anything else → show the message and re-enable the button so the user can
//     retry. It never stays stuck on "Bezig…".

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SubscribeButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST' })

      // Not logged in — you cannot subscribe to an account you do not have.
      // Bounce to registration and come straight back here afterwards.
      if (res.status === 401) {
        router.push('/register?next=/prijzen')
        return
      }

      const body = await res.json().catch(() => ({}))

      if (!res.ok || !body?.url) {
        setError(body?.error || 'Er ging iets mis. Probeer het opnieuw.')
        setBusy(false)
        return
      }

      // Full navigation, not router.push — Stripe Checkout is a different origin.
      window.location.href = body.url
    } catch {
      setError('Geen verbinding. Controleer je internet en probeer opnieuw.')
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        style={{
          width: '100%',
          padding: '14px 20px',
          fontSize: 16,
          fontWeight: 600,
          color: '#fff',
          background: busy ? '#8ab4f8' : '#1A73E8',
          border: 'none',
          borderRadius: 10,
          cursor: busy ? 'default' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {busy ? 'Bezig…' : 'Start je abonnement'}
      </button>

      {error && (
        <p role="alert" style={{ color: '#B3261E', fontSize: 14, margin: '10px 0 0', lineHeight: 1.5 }}>
          {error}
        </p>
      )}
    </div>
  )
}
