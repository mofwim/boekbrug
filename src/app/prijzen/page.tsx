// src/app/prijzen/page.tsx
// [BILLING] The price page. Two jobs in one screen:
//   1. a public, indexable marketing page — a visitor must be able to see what
//      BoekBrug costs without making an account (hiding the price is how you
//      lose the people who were ready to buy);
//   2. the landing spot for a logged-in account whose trial has run out, which
//      is why it sits in PUBLIC_PATHS: gating it would be a redirect loop.
//
// Honesty rules that apply here and nowhere more strictly (see the content
// guardrails in docs/growth-plan-2026.md §8): only SHIPPED features may be
// listed. No "coming soon", no roadmap items dressed as features. Bank is
// statement *upload*; BoekBrug *exports* UBL and *prepares* the BTW return —
// it does not file it.

import type { Metadata } from 'next'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import { PLAN } from '@/lib/billing'
import SubscribeButton from './SubscribeButton'

export const metadata: Metadata = {
  title: 'Prijzen — één abonnement, alles inbegrepen | BoekBrug',
  description:
    'BoekBrug Pro: € 12 per maand, incl. btw. Facturen, bonnetjes scannen met AI, bank, BTW-aangifte voorbereiden en de brug naar je boekhouder. 14 dagen gratis proberen, zonder creditcard.',
  keywords: ['boekbrug prijzen', 'boekhoudprogramma zzp prijs', 'boekhouden zzp kosten'],
  alternates: { canonical: '/prijzen' },
  openGraph: {
    title: 'BoekBrug — € 12 per maand, alles inbegrepen',
    description: '14 dagen gratis proberen, zonder creditcard. Maandelijks opzegbaar.',
    type: 'website',
  },
}

const wrap: React.CSSProperties = { maxWidth: 820, margin: '0 auto', padding: '0 16px' }

// Only features that exist in the app today. Keep this list honest.
const INCLUDED = [
  'Facturen maken, versturen en opvolgen (met betaalverzoek)',
  'Bonnetjes en inkoopfacturen scannen met AI',
  'Facturen automatisch ophalen uit je e-mail',
  'Bankafschrift importeren en automatisch matchen',
  'Kasboek en dagomzet',
  'BTW-aangifte voorbereiden (incl. KOR)',
  'De brug naar je boekhouder — één knop, alles compleet',
  'Bewaarplicht: je administratie 7 jaar veilig bewaard',
]

/**
 * Why the trial has ended, in plain Dutch. The middleware appends ?reden=…
 * so the page can say something true instead of a generic wall. Anything
 * unrecognised falls through to no message at all — a wrong explanation is
 * worse than none.
 */
const REASONS: Record<string, string> = {
  trial_expired: 'Je gratis proefperiode is afgelopen. Neem een abonnement om verder te gaan waar je gebleven was.',
  subscription_ended: 'Je abonnement is gestopt. Start het opnieuw en je administratie staat er nog precies zo bij.',
}

export default async function PrijzenPage({
  searchParams,
}: {
  searchParams: Promise<{ reden?: string; geannuleerd?: string }>
}) {
  const params = await searchParams
  const notice = params.reden ? REASONS[params.reden] : undefined
  const cancelled = params.geannuleerd === '1'

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      <main style={{ ...wrap, paddingTop: 40, paddingBottom: 64 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: '#202124', margin: '0 0 8px' }}>
          Eén abonnement. Alles inbegrepen.
        </h1>
        <p style={{ fontSize: 17, color: '#5f6368', margin: '0 0 28px', lineHeight: 1.6 }}>
          Geen pakketten, geen meerprijs per factuur, geen verrassingen. Je probeert
          BoekBrug {PLAN.trialDays} dagen gratis — zonder creditcard.
        </p>

        {notice && (
          <div
            role="status"
            style={{
              background: '#FEE8C4', border: '1px solid #7C5800', color: '#7C5800',
              borderRadius: 12, padding: '14px 16px', marginBottom: 24, fontSize: 15, lineHeight: 1.5,
            }}
          >
            {notice}
          </div>
        )}

        {cancelled && (
          <div
            role="status"
            style={{
              background: '#f1f3f4', border: '1px solid #e0e0e0', color: '#5f6368',
              borderRadius: 12, padding: '14px 16px', marginBottom: 24, fontSize: 15,
            }}
          >
            Je betaling is afgebroken — er is niets in rekening gebracht.
          </div>
        )}

        {/* ── The single plan ────────────────────────────────────── */}
        <section
          style={{
            background: '#fff', border: '1px solid #e0e0e0', borderRadius: 16,
            padding: 28, boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1A73E8', letterSpacing: 0.4, textTransform: 'uppercase' }}>
            {PLAN.name}
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '10px 0 4px' }}>
            <span style={{ fontSize: 44, fontWeight: 700, color: '#202124' }}>{PLAN.priceLabel}</span>
            <span style={{ fontSize: 16, color: '#5f6368' }}>{PLAN.period}</span>
          </div>
          <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 22 }}>
            {PLAN.btwNote} · maandelijks opzegbaar
          </div>

          <SubscribeButton />

          <ul style={{ listStyle: 'none', padding: 0, margin: '26px 0 0', display: 'grid', gap: 12 }}>
            {INCLUDED.map((feature) => (
              <li key={feature} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 15, color: '#202124', lineHeight: 1.5 }}>
                <span aria-hidden style={{ color: '#137333', fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── The questions people actually ask before paying ────── */}
        <section style={{ marginTop: 36 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 16px' }}>
            Veelgestelde vragen
          </h2>

          <div style={{ display: 'grid', gap: 18 }}>
            <Faq q={`Wat gebeurt er na ${PLAN.trialDays} dagen?`}>
              Je krijgt een seintje voordat de proefperiode afloopt. Neem je geen
              abonnement, dan stopt de toegang — je gegevens blijven staan en komen
              terug zodra je alsnog een abonnement neemt. Er wordt nooit stilzwijgend
              iets afgeschreven: zonder creditcard geen afschrijving.
            </Faq>

            <Faq q="Kan ik maandelijks opzeggen?">
              Ja. Je zegt zelf op in je eigen instellingen — geen mailtje, geen
              telefoontje. Je houdt toegang tot het einde van de periode die je al
              betaald hebt.
            </Faq>

            <Faq q="Krijg ik een factuur met btw?">
              Ja. Elke betaling levert automatisch een btw-factuur op je naam op, die
              je zelf kunt downloaden. Heb je een btw-nummer, dan zet je dat bij het
              afrekenen op de factuur.
            </Faq>

            <Faq q="Hoe kan ik betalen?">
              Met iDEAL of creditcard. De betaling loopt via Stripe — je
              kaartgegevens komen nooit bij BoekBrug binnen.
            </Faq>

            <Faq q="Betaalt mijn boekhouder ook?">
              Nee. Een boekhouder die met jou meekijkt via de brug gebruikt BoekBrug
              gratis.
            </Faq>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#202124', marginBottom: 6 }}>{q}</div>
      <div style={{ fontSize: 15, color: '#5f6368', lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}
