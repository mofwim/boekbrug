// src/app/dashboard/settings/facturering/page.tsx
// [BILLING] Welk plan geldt er, en de deur naar Stripe's portaal.
//
// Dit is ook de pagina waar Stripe de klant naartoe terugstuurt na een gelukte betaling:
// de webhook die het account op 'active' zet kan een seconde later landen dan de browser,
// vandaar de melding bovenaan.
//
// Hier wordt geen enkele abonnementskolom geschreven. De pagina leest wat de webhook heeft
// gecachet en laat al het andere over aan Stripe's gehoste portaal — één scherm waar de
// klant zijn kaart wijzigt, btw-facturen ophaalt en opzegt, zonder het ons te hoeven vragen.
//
// Toon: deze pagina mag nooit lezen als een aanmaning. Verreweg de meeste accounts horen
// hier permanent "Gratis" te zien staan, en dat is de bedoelde eindtoestand — geen gebrek,
// geen tussenstap naar iets beters. De enige reden dat Plus bestaat is dat een handvol
// zware gebruikers ons echt geld kost.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { decidePlan, type PlanDecision } from '@/lib/subscription'
import { PLUS } from '@/lib/plan'
import { FAIR_USE_LIMITS, formatLimit } from '@/lib/fair-use'
import ManageSubscriptionButton from './ManageSubscriptionButton'

export const dynamic = 'force-dynamic'

type BillingProfile = {
  role?: string | null
  subscription_status?: string | null
  subscription_plan?: string | null
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

  // De abonnementskolommen komen uit billing_subscription.sql, met de hand toegepast →
  // ontspannen client, en ingepakt zodat een nog niet toegepaste migratie een eerlijk
  // paneel oplevert in plaats van een fout.
  let profile: BillingProfile | null = null
  let columnsPresent = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('profiles')
      .select('role, subscription_status, subscription_plan, current_period_end, stripe_customer_id')
      .eq('id', user.id)
      .single()
    if (error) columnsPresent = false
    else profile = data as BillingProfile
  } catch {
    columnsPresent = false
  }

  // Ontbreken de kolommen, dan is het antwoord niet "onbekend" maar gewoon "gratis": dat is
  // wat er dan geldt, en het is de waarheid voor bijna iedereen. Alleen de rol lezen we
  // alsnog, zodat een boekhouder ook zonder migratie het juiste ziet staan.
  const decision: PlanDecision = decidePlan({
    role: profile?.role ?? null,
    subscriptionStatus: columnsPresent ? profile?.subscription_status ?? null : null,
    currentPeriodEnd: columnsPresent ? profile?.current_period_end ?? null : null,
    nowMs: Date.now(),
  })

  const hasCustomer = Boolean(profile?.stripe_customer_id)
  const aiLimit = FAIR_USE_LIMITS.find((l) => l.key === 'aiDocuments')!

  return (
    <main style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px 64px', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#202124', margin: '0 0 6px' }}>Facturering</h1>
      <p style={{ fontSize: 15, color: '#5f6368', margin: '0 0 24px' }}>
        Welk plan er voor je geldt, en waar je je btw-facturen vindt.
      </p>

      {justPaid && (
        <div
          role="status"
          style={{ background: '#CEEAD6', border: '1px solid #137333', color: '#0d652d', borderRadius: 12, padding: '14px 16px', marginBottom: 20, fontSize: 15, lineHeight: 1.5 }}
        >
          <strong>Bedankt — je betaling is gelukt.</strong>
          <br />
          Het kan een paar seconden duren voordat je plan hieronder bijgewerkt is.
          Ververs deze pagina als je het nog niet ziet.
        </div>
      )}

      <section style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 14, padding: 22 }}>
        <Row label="Plan" value={planLabel(decision, profile)} />

        {decision.plan === 'free' && (
          <Row
            label="Eerlijk gebruik"
            value={`${formatLimit(aiLimit, 'free')} documenten door de AI gelezen`}
          />
        )}

        {profile?.current_period_end && decision.plan === 'plus' && (
          <Row
            label={decision.reason === 'grace_period' ? 'Plus loopt tot' : 'Volgende verlenging'}
            value={dateNL(profile.current_period_end) ?? '—'}
          />
        )}

        {decision.plan !== 'boekhouder' && (
          <Row label="Prijs van Plus" value={`${PLUS.priceLabel} ${PLUS.period} (${PLUS.btwNote}, ${PLUS.cancelNote})`} />
        )}

        {decision.plan !== 'boekhouder' && (
          <div style={{ marginTop: 20 }}>
            <ManageSubscriptionButton hasSubscription={hasCustomer} />
          </div>
        )}

        <p style={{ fontSize: 13.5, color: '#5f6368', margin: '18px 0 0', lineHeight: 1.6 }}>
          {decision.plan === 'boekhouder' ? (
            <>
              Het boekhoudersportaal is gratis, ook met honderd gekoppelde klanten. Er bestaat
              geen betaald boekhoudersplan en er komt er geen.
            </>
          ) : (
            <>
              Je wordt <strong>nooit automatisch afgeschreven</strong> en er is geen proefperiode
              die stilzwijgend overgaat in een abonnement. Kom je boven het eerlijk gebruik, dan
              pauzeert alleen de handeling die ons geld kost — inzien, doorzoeken en exporteren
              van je eigen administratie blijven altijd werken.{' '}
              <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>
                Lees het beleid eerlijk gebruik
              </Link>
              .
            </>
          )}
        </p>

        {!columnsPresent && (
          // Eerlijk over de eigen toestand: zonder de migratie kan hier geen abonnement
          // staan, ook niet als er wél voor betaald is. Beter dit te zeggen dan te doen
          // alsof "gratis" hier een meting is.
          <p style={{ fontSize: 13, color: '#7C5800', background: '#FEE8C4', borderRadius: 8, padding: '10px 12px', margin: '16px 0 0', lineHeight: 1.5 }}>
            De abonnementskolommen bestaan nog niet in de database
            (billing_subscription.sql is nog niet toegepast). Alles werkt, maar een lopend
            Plus-abonnement kan hier nog niet worden getoond.
          </p>
        )}
      </section>
    </main>
  )
}

function planLabel(decision: PlanDecision, profile: BillingProfile | null): string {
  switch (decision.reason) {
    case 'boekhouder':
      return 'Boekhouder — gratis, altijd'
    case 'active':
      return `${PLUS.name} — actief`
    case 'grace_period':
      return profile?.subscription_status === 'past_due'
        ? 'Betaling mislukt — we proberen het opnieuw, je houdt Plus'
        : 'Plus loopt af — je houdt hem tot het einde van de betaalde periode'
    case 'free':
    default:
      return 'Gratis'
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
