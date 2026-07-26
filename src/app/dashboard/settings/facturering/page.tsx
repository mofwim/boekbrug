// src/app/dashboard/settings/facturering/page.tsx
// [BILLING] Subscription status + the door to Stripe's portal.
//
// This is also the page Stripe returns a customer to after a successful
// checkout, which is why the middleware exempts it from the paywall: the
// webhook that flips the account to 'active' can land a second or two after the
// browser gets back, and bouncing a customer who has just paid to the price
// page reads as "my payment failed".
//
// Nothing here writes billing state. It reads what the webhook cached and hands
// everything else to Stripe's hosted portal — one screen where the customer
// changes their card, downloads btw-invoices and cancels, without asking us.

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { decideAccess, isBillingEnforced, type AccessDecision } from '@/lib/subscription'
import { PLAN } from '@/lib/plan'
import ManageSubscriptionButton from './ManageSubscriptionButton'

export const dynamic = 'force-dynamic'

type BillingProfile = {
  role?: string | null
  subscription_status?: string | null
  subscription_plan?: string | null
  trial_ends_at?: string | null
  current_period_end?: string | null
  stripe_customer_id?: string | null
}

const dateNL = (iso: string | null | undefined) => {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms))
}

export default async function FactureringPage({
  searchParams,
}: {
  searchParams: Promise<{ betaald?: string }>
}) {
  const params = await searchParams
  const justPaid = params.betaald === '1'

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // The billing columns come from billing_subscription.sql, applied by hand →
  // relaxed client, and wrapped so a not-yet-applied migration renders an
  // honest "nog niet ingesteld" panel instead of throwing.
  let profile: BillingProfile | null = null
  let columnsPresent = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('profiles')
      .select('role, subscription_status, subscription_plan, trial_ends_at, current_period_end, stripe_customer_id')
      .eq('id', user.id)
      .single()
    if (error) columnsPresent = false
    else profile = data as BillingProfile
  } catch {
    columnsPresent = false
  }

  const decision: AccessDecision | null = profile
    ? decideAccess({
        role: profile.role ?? null,
        subscriptionStatus: profile.subscription_status ?? null,
        trialEndsAt: profile.trial_ends_at ?? null,
        currentPeriodEnd: profile.current_period_end ?? null,
        nowMs: Date.now(),
      })
    : null

  const hasCustomer = Boolean(profile?.stripe_customer_id)

  return (
    <main style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px 64px', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#202124', margin: '0 0 6px' }}>Facturering</h1>
      <p style={{ fontSize: 15, color: '#5f6368', margin: '0 0 24px' }}>
        Je abonnement, je betaalgegevens en je btw-facturen.
      </p>

      {justPaid && (
        <div
          role="status"
          style={{ background: '#CEEAD6', border: '1px solid #137333', color: '#0d652d', borderRadius: 12, padding: '14px 16px', marginBottom: 20, fontSize: 15, lineHeight: 1.5 }}
        >
          <strong>Bedankt — je betaling is gelukt.</strong>
          <br />
          Het kan een paar seconden duren voordat je abonnement hieronder bijgewerkt is.
          Ververs deze pagina als je het nog niet ziet.
        </div>
      )}

      <section style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 14, padding: 22 }}>
        {!columnsPresent ? (
          // The honest state when the migration has not been applied yet.
          <p style={{ fontSize: 15, color: '#5f6368', margin: 0, lineHeight: 1.6 }}>
            Facturering is nog niet ingesteld voor dit account.
          </p>
        ) : (
          <>
            <Row label="Abonnement" value={statusLabel(decision, profile)} />
            {decision?.reason === 'trialing' && decision.trialDaysLeft !== null && (
              <Row
                label="Proefperiode"
                value={`Nog ${decision.trialDaysLeft} ${decision.trialDaysLeft === 1 ? 'dag' : 'dagen'}${
                  dateNL(profile?.trial_ends_at) ? ` — tot ${dateNL(profile?.trial_ends_at)}` : ''
                }`}
              />
            )}
            {profile?.current_period_end && (
              <Row
                label={decision?.reason === 'grace_period' ? 'Toegang tot' : 'Volgende verlenging'}
                value={dateNL(profile.current_period_end) ?? '—'}
              />
            )}
            <Row label="Prijs" value={`${PLAN.priceLabel} ${PLAN.period} (${PLAN.btwNote})`} />

            <div style={{ marginTop: 20 }}>
              <ManageSubscriptionButton hasSubscription={hasCustomer} />
            </div>

            {!isBillingEnforced() && (
              // Visible only while the paywall ships dark — so the owner can
              // never mistake "nobody is being charged yet" for "it works".
              <p style={{ fontSize: 13, color: '#7C5800', background: '#FEE8C4', borderRadius: 8, padding: '10px 12px', margin: '16px 0 0', lineHeight: 1.5 }}>
                Facturering staat uit (BILLING_ENFORCED). Niemand wordt buitengesloten
                en er wordt niets afgeschreven.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  )
}

function statusLabel(decision: AccessDecision | null, profile: BillingProfile | null): string {
  if (!decision) return 'Onbekend'
  switch (decision.reason) {
    case 'accountant':
      return 'Boekhouder — gratis'
    case 'active':
      return `${PLAN.name} — actief`
    case 'trialing':
      return 'Gratis proefperiode'
    case 'grace_period':
      return profile?.subscription_status === 'past_due'
        ? 'Betaling mislukt — we proberen het opnieuw'
        : 'Loopt af — je houdt toegang tot het einde van de periode'
    case 'trial_expired':
      return 'Proefperiode afgelopen'
    case 'subscription_ended':
      return 'Gestopt'
    default:
      return 'Geen actief abonnement'
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px solid #f1f3f4', fontSize: 15 }}>
      <span style={{ color: '#5f6368' }}>{label}</span>
      <span style={{ color: '#202124', fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  )
}
