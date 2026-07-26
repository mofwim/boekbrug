// src/app/prijzen/page.tsx
// [BILLING] De prijzenpagina. Publiek en indexeerbaar: een bezoeker moet kunnen zien wat
// BoekBrug kost zonder een account te maken.
//
// ⚠️ GEEN BEDRAG WORDT HIER INGETYPT. Alles komt uit src/lib/plan.ts, dat het op zijn beurt
// afleidt uit fair-use.ts (de grenzen die de voorwaarden §5 en /eerlijk-gebruik
// publiceren) en uit bewaarkluis.ts. Op de billing-tak stonden de bedragen in de <title>,
// in de OG-beschrijving én in de tekst afzonderlijk overgetypt, en waren ze al uit elkaar
// gelopen met de bindende voorwaarden. Eén bron, dus.
//
// Eerlijkheidsregels die hier het strengst gelden (docs/growth-plan-2026.md §8): alleen
// functies die BESTAAN mogen erop. Geen "binnenkort". Bank is het IMPORTEREN van een
// afschrift; BoekBrug EXPORTEERT UBL en BEREIDT de BTW-aangifte VOOR — het doet geen
// aangifte.
//
// Er is geen `?reden=`-melding meer op deze pagina. Die hoorde bij een betaalmuur die
// mensen hierheen stuurde als hun proefperiode afliep. Wij sturen niemand weg, dus er is
// niets uit te leggen.

import type { Metadata } from 'next'
import Link from 'next/link'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import { PLUS, KLUIS } from '@/lib/plan'
import { FAIR_USE_LIMITS, formatLimit, fairUseLimit } from '@/lib/fair-use'
import { BEWAARPLICHT_YEARS, KLUIS_GRACE_MONTHS, eur, KLUIS_PREPAY_YEAR_PRICE_EUR } from '@/lib/bewaarkluis'
import { BELOFTE_KOP, BELOFTE_KOP_2, BELOFTE_UITLEG } from '@/lib/belofte'
import SubscribeButton from './SubscribeButton'

export const metadata: Metadata = {
  title: 'Prijzen — gratis voor jou én je boekhouder | BoekBrug',
  description:
    `BoekBrug is gratis voor de ondernemer en gratis voor zijn boekhouder. ` +
    `Boven het eerlijk gebruik kost Plus ${PLUS.priceLabel} per maand ${PLUS.btwNote}. ` +
    `Geen proefperiode, geen automatische afschrijving, en nooit een slot op je eigen administratie.`,
  keywords: ['boekbrug prijzen', 'gratis boekhoudprogramma zzp', 'boekhouden zzp kosten', 'bewaarplicht 7 jaar'],
  alternates: { canonical: '/prijzen' },
  openGraph: {
    title: 'BoekBrug — gratis voor jou én je boekhouder',
    description: `Plus kost ${PLUS.priceLabel} per maand en is alleen nodig boven het eerlijk gebruik.`,
    type: 'website',
  },
}

const wrap: React.CSSProperties = { maxWidth: 880, margin: '0 auto', padding: '0 16px' }

// Alleen functies die vandaag in de app zitten. Houd deze lijst eerlijk.
const INCLUDED = [
  'Facturen maken, versturen en opvolgen (met betaalverzoek)',
  'Bonnetjes en inkoopfacturen scannen met AI',
  'Facturen automatisch ophalen uit je e-mail',
  'Bankafschrift importeren en automatisch matchen',
  'Kasboek en dagomzet',
  'BTW-aangifte voorbereiden (incl. KOR)',
  'De brug naar je boekhouder — één knop, alles compleet',
  'De compliance-kluis: je administratie per jaar geordend en exporteerbaar',
]

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 16,
  padding: 24,
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
}

export default async function PrijzenPage({
  searchParams,
}: {
  searchParams: Promise<{ geannuleerd?: string }>
}) {
  const params = await searchParams
  const cancelled = params.geannuleerd === '1'
  const ai = fairUseLimit('aiDocuments')

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      <main style={{ ...wrap, paddingTop: 40, paddingBottom: 64 }}>
        {/* [BELOFTE] Ook de prijspagina begint bij wat je NIET hoeft, niet bij wat het kost.
            Iemand die hier landt weet nog niet waarom hij zou betalen als hij niet weet
            waarvoor. Bron: src/lib/belofte.ts. */}
        <h1 style={{ fontSize: 32, fontWeight: 700, color: '#202124', margin: '0 0 8px', lineHeight: 1.25 }}>
          {BELOFTE_KOP} <span style={{ color: '#1a73e8' }}>{BELOFTE_KOP_2}</span>
        </h1>
        <p style={{ fontSize: 17, color: '#5f6368', margin: '0 0 16px', lineHeight: 1.6, maxWidth: 640 }}>
          {BELOFTE_UITLEG}
        </p>
        <p style={{ fontSize: 17, color: '#5f6368', margin: '0 0 28px', lineHeight: 1.6, maxWidth: 620 }}>
          En dat is <strong>gratis</strong> — voor jou én voor je boekhouder. Geen proefperiode die
          stilletjes afloopt, geen creditcard vooraf, en geen slot op je eigen administratie.
        </p>

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

        {/* ── De drie plannen ────────────────────────────────────── */}
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {/* Gratis — het hoofdplan, niet de instapvariant */}
          <section style={{ ...card, borderColor: '#137333', borderWidth: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#137333', letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Ondernemer
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>€ 0</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>
              alle functies, binnen het eerlijk gebruik
            </div>
            <Link
              href="/register"
              style={{
                display: 'block', textAlign: 'center', padding: '12px 20px', background: '#137333',
                color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 15,
              }}
            >
              Gratis beginnen
            </Link>
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
              Dit is niet de instapvariant — dit is het plan waar dit product voor gemaakt is en
              waar de meeste gebruikers permanent op horen te blijven.
            </p>
          </section>

          {/* Plus */}
          <section style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1A73E8', letterSpacing: 0.4, textTransform: 'uppercase' }}>
              {PLUS.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>{PLUS.priceLabel}</span>
              <span style={{ fontSize: 15, color: '#5f6368' }}>{PLUS.period}</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>
              {PLUS.btwNote} · {PLUS.cancelNote}
            </div>
            <SubscribeButton />
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
              Alleen nodig als je structureel boven het eerlijk gebruik uitkomt — meer dan{' '}
              {formatLimit(ai, 'free')} documenten per maand door de AI laten lezen, bijvoorbeeld.
              Plus verruimt elke grens naar {formatLimit(ai, 'plus')}.
            </p>
          </section>

          {/* Boekhouder */}
          <section style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#5f6368', letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Boekhouder
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>€ 0</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>altijd, ongeacht het aantal klanten</div>
            <Link
              href="/register"
              style={{
                display: 'block', textAlign: 'center', padding: '12px 20px', background: '#fff',
                color: '#1A73E8', border: '1.5px solid #1A73E8', borderRadius: 8,
                textDecoration: 'none', fontWeight: 600, fontSize: 15,
              }}
            >
              Portaal openen
            </Link>
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
              Het volledige portaal, het werkbord en het per klant ophalen van een afgesloten
              kwartaal. Er bestaat geen betaald boekhoudersplan en er komt er geen.
            </p>
          </section>
        </div>

        {/* ── Wat er in alles zit ────────────────────────────────── */}
        <section style={{ ...card, marginTop: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#202124', margin: '0 0 14px' }}>
            Dit zit in álle plannen — ook in het gratis plan
          </h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {INCLUDED.map((feature) => (
              <li key={feature} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14.5, color: '#202124', lineHeight: 1.5 }}>
                <span aria-hidden style={{ color: '#137333', fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
            De grenzen van het gratis plan staan tot op het getal op{' '}
            <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>/eerlijk-gebruik</Link>.
            Kom je erboven, dan pauzeert alleen de handeling die ons geld kost. Inzien, doorzoeken
            en exporteren van je eigen administratie blijven altijd werken — ook boven de grens,
            ook nadat je stopt.
          </p>
        </section>

        {/* ── De Bewaarkluis ─────────────────────────────────────── */}
        <section style={{ ...card, marginTop: 16, background: '#FFFBF2', borderColor: '#E8C89A' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7C5800', letterSpacing: 0.4, textTransform: 'uppercase' }}>
            {KLUIS.name}
          </div>
          <h2 style={{ fontSize: 21, fontWeight: 700, color: '#202124', margin: '8px 0 10px' }}>
            Je stopt met je zaak. Je bewaarplicht stopt niet.
          </h2>
          <p style={{ fontSize: 15.5, color: '#3c4043', margin: '0 0 14px', lineHeight: 1.65, maxWidth: 660 }}>
            De Belastingdienst vraagt je administratie <strong>{BEWAARPLICHT_YEARS} jaar</strong> te
            kunnen tonen (art. 52 AWR). Die termijn loopt door als je onderneming stopt, en ook als
            je software stopt. Het is het enige dat een ondernemer nog moet kunnen nadat hij overal
            mee is opgehouden — en precies daar staat meestal niets voor klaar.
          </p>
          <p style={{ fontSize: 15.5, color: '#3c4043', margin: '0 0 14px', lineHeight: 1.65, maxWidth: 660 }}>
            Wij houden je archief online: per jaar en kwartaal geordend, doorzoekbaar, en met één
            knop per jaar te exporteren als ZIP met index. Dat kost{' '}
            <strong>{eur(KLUIS_PREPAY_YEAR_PRICE_EUR)} per resterend bewaarjaar</strong>, in één keer
            vooruit. Sluit je vandaag je zaak, dan is dat {eur(BEWAARPLICHT_YEARS * KLUIS_PREPAY_YEAR_PRICE_EUR)}{' '}
            voor de hele termijn.
          </p>
          <p style={{ fontSize: 14, color: '#5f6368', margin: 0, lineHeight: 1.65, maxWidth: 660 }}>
            <strong>Wat wij niet verkopen:</strong> wij nemen je bewaarplicht niet over — die blijft
            wettelijk van jou. Wij zijn je tweede exemplaar, nooit je enige; download je eigen kopie
            ook. En de eerste <strong>{KLUIS_GRACE_MONTHS} maanden na je opzegging bewaren wij alles
            gratis</strong>, met een waarschuwing per e-mail ruim vóór er ooit iets weggaat.{' '}
            <Link href="/voorwaarden" style={{ color: '#1A73E8' }}>Voorwaarden §5.7</Link>.
          </p>
        </section>

        {/* ── De vragen die mensen echt stellen ──────────────────── */}
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 16px' }}>
            Veelgestelde vragen
          </h2>

          <div style={{ display: 'grid', gap: 14 }}>
            <Faq q="Is het echt gratis, of is dit een proefperiode?">
              Echt gratis. Er is <strong>geen proefperiode</strong> en er loopt geen klok. Je laat
              geen betaalgegevens achter, dus er kan ook nooit iets worden afgeschreven. Wat er is,
              is een eerlijk gebruik: {formatLimit(ai, 'free')} documenten per maand door de AI laten
              lezen, en {FAIR_USE_LIMITS.length - 1} andere grenzen die op{' '}
              <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>één pagina</Link> staan.
            </Faq>

            <Faq q="Wat gebeurt er als ik boven het eerlijk gebruik kom?">
              Je krijgt een melding bij 80% van een grens, met het exacte aantal — dus vóórdat er
              iets gebeurt. Kom je erboven, dan pauzeert <em>alleen</em> de handeling die ons geld
              kost: een nieuw document automatisch laten uitlezen, een nieuwe factuur versturen.
              Alles wat er al staat blijft leesbaar en exporteerbaar. Daarna kies je zelf: wachten
              tot de volgende maand, of Plus nemen.
            </Faq>

            <Faq q="Betaalt mijn boekhouder ook?">
              Nee, en dat verandert niet. Het boekhoudersportaal is gratis, ook met honderd
              gekoppelde klanten. Er bestaat geen betaald boekhoudersplan.
            </Faq>

            <Faq q="Kan ik maandelijks opzeggen?">
              Ja. Je zegt Plus zelf op in je eigen instellingen — geen mailtje, geen telefoontje. Je
              houdt Plus tot het einde van de periode die je al hebt betaald, en valt daarna terug
              op het gratis plan. Je verliest geen enkel gegeven.
            </Faq>

            <Faq q="Krijg ik een factuur met btw?">
              Ja. Elke betaling levert automatisch een btw-factuur op je naam op, die je zelf kunt
              downloaden. Heb je een btw-nummer, dan zet je dat bij het afrekenen op de factuur.
            </Faq>

            <Faq q="Hoe kan ik betalen?">
              Met iDEAL of creditcard. De betaling loopt via Stripe — je kaartgegevens komen nooit
              bij BoekBrug binnen.
            </Faq>

            <Faq q="Wat als ik helemaal stop met BoekBrug?">
              Je exporteert alles (dat blijft altijd werken, ook op het gratis plan). Daarna bewaren
              wij je administratie nog {KLUIS_GRACE_MONTHS} maanden gratis. Wil je dat het langer
              blijft staan omdat je bewaarplicht doorloopt, dan is daar de Bewaarkluis voor. Wij
              verwijderen nooit iets zonder minstens 30 dagen aankondiging per e-mail.
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
