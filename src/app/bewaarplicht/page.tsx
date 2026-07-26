// src/app/bewaarplicht/page.tsx
// [KLUIS] De voordeur voor mensen die geen boekhoudprogramma zoeken.
//
// ── WAAROM DEZE PAGINA BESTAAT, EN WAAROM HIJ ANDERS IS DAN /prijzen ──
// /prijzen praat tegen iemand die al weet dat hij software wil. Deze pagina praat tegen
// iemand die iets heel anders zoekt: "hoe lang moet ik mijn administratie bewaren", "oude
// boekhouding opslaan", "mijn zaak is gestopt, wat nu met mijn papieren". Dat is een
// zoekopdracht met een probleem erachter en géén productcategorie erbij — en dus een deur
// waar geen enkele boekhoudleverancier voor staat, want zij verkopen aan wie NU boekhoudt.
//
// De strategie erachter, kort: de bewaarplicht binnenhalen is goedkoop (een archief van een
// kleine zaak weegt ~2 GB en kost ons minder dan € 10 over de volle zeven jaar), levert een
// relatie op met iemand die anders nooit klant was geworden, en zet zijn stukken alvast in
// een systeem waar facturen maken en bonnen scannen al klaarstaan voor als hij ooit weer
// begint. Zie docs/BEWAARKLUIS_BUSINESS_CASE.md §4.
//
// ⚠️ Eerlijkheidsregel die hier extra streng geldt: deze pagina praat over een WETTELIJKE
// verplichting. Alles wat hier staat moet kloppen of het moet er niet staan. Wij nemen de
// bewaarplicht niet over, wij zijn geen fiscalist, en de termijn van tien jaar voor
// onroerende zaken wordt genoemd in plaats van weggelaten.

import type { Metadata } from 'next'
import Link from 'next/link'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import {
  BEWAARPLICHT_YEARS,
  KLUIS_GRACE_MONTHS,
  KLUIS_PREPAY_YEAR_PRICE_EUR,
  KLUIS_SHUTDOWN_NOTICE_DAYS,
  KLUIS_WEL,
  KLUIS_NOOIT,
  eur,
} from '@/lib/bewaarkluis'

export const metadata: Metadata = {
  title: `Administratie ${BEWAARPLICHT_YEARS} jaar bewaren — ook als je zaak gestopt is | BoekBrug`,
  description:
    `De fiscale bewaarplicht van ${BEWAARPLICHT_YEARS} jaar loopt door nadat je onderneming stopt. ` +
    `Zet je oude administratie online: geordend per jaar, doorzoekbaar, altijd te exporteren. ` +
    `${eur(KLUIS_PREPAY_YEAR_PRICE_EUR)} per resterend bewaarjaar, eenmalig.`,
  keywords: [
    'administratie bewaren 7 jaar',
    'fiscale bewaarplicht',
    'bewaarplicht belastingdienst ondernemer',
    'oude administratie opslaan',
    'boekhouding bewaren na stoppen onderneming',
    'artikel 52 awr',
  ],
  alternates: { canonical: '/bewaarplicht' },
  openGraph: {
    title: `Je zaak stopt. Je bewaarplicht niet.`,
    description: `${BEWAARPLICHT_YEARS} jaar administratie, veilig en doorzoekbaar bewaard. Vanaf ${eur(KLUIS_PREPAY_YEAR_PRICE_EUR)} per bewaarjaar.`,
    type: 'website',
  },
}

const wrap: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '0 16px' }
const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 16,
  padding: 24,
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
}

/** Voor wie dit is. Elk van deze vier is iemand die géén boekhoudprogramma zoekt. */
const VOOR_WIE = [
  {
    kop: 'Je onderneming is gestopt',
    tekst:
      `Uitgeschreven bij de KvK, maar de Belastingdienst kan je administratie nog jaren opvragen. ` +
      `Een doos op zolder en een externe schijf die niemand meer kan uitlezen is geen antwoord.`,
  },
  {
    kop: 'Je boekhoudpakket stopt of wordt te duur',
    tekst:
      `Opzeggen betekent meestal: exporteren en zelf maar zien. Die export is precies wat hier ` +
      `binnenkomt — geordend per jaar en kwartaal in plaats van als één map met duizend bestanden.`,
  },
  {
    kop: 'Je wikkelt een onderneming af',
    tekst:
      `Als erfgenaam of curator zit je met stukken die je jaren moet kunnen tonen, van een ` +
      `administratie die je zelf nooit hebt gevoerd.`,
  },
  {
    kop: 'Je bent boekhouder en de klantrelatie is voorbij',
    tekst:
      `Het dossier moet ergens heen, en jij wordt aangesproken als het onvindbaar blijkt. ` +
      `Eén archief per klant, met een export die je op elk moment kunt leveren.`,
  },
]

export default function BewaarplichtPage() {
  const volleTermijn = BEWAARPLICHT_YEARS * KLUIS_PREPAY_YEAR_PRICE_EUR

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      <main style={{ ...wrap, paddingTop: 40, paddingBottom: 64 }}>
        <h1 style={{ fontSize: 34, fontWeight: 700, color: '#202124', margin: '0 0 12px', lineHeight: 1.2 }}>
          Je zaak stopt. Je bewaarplicht niet.
        </h1>
        <p style={{ fontSize: 17.5, color: '#3c4043', margin: '0 0 12px', lineHeight: 1.65 }}>
          De Belastingdienst vraagt ondernemers hun administratie <strong>{BEWAARPLICHT_YEARS} jaar</strong>{' '}
          te bewaren en op verzoek te tonen (artikel 52 AWR). Die termijn loopt gewoon door als je
          onderneming stopt — en ook als je stopt met de software waar alles in stond.
        </p>
        <p style={{ fontSize: 16.5, color: '#5f6368', margin: '0 0 28px', lineHeight: 1.65 }}>
          Het is het enige dat je nog moet kunnen nadat je overal mee bent opgehouden. En precies
          daarvoor staat meestal niets klaar.
        </p>

        {/* ── Het aanbod ─────────────────────────────────────────── */}
        <section style={{ ...card, background: '#FFFBF2', borderColor: '#E8C89A' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7C5800', letterSpacing: 0.4, textTransform: 'uppercase' }}>
            BoekBrug Bewaarkluis
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '10px 0 4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>{eur(KLUIS_PREPAY_YEAR_PRICE_EUR)}</span>
            <span style={{ fontSize: 16, color: '#5f6368' }}>per resterend bewaarjaar, eenmalig</span>
          </div>
          <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 18 }}>
            incl. btw · sluit je vandaag je zaak, dan is dat {eur(volleTermijn)} voor de volle termijn
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', display: 'grid', gap: 10 }}>
            {KLUIS_WEL.map((punt) => (
              <li key={punt} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 15, color: '#202124', lineHeight: 1.55 }}>
                <span aria-hidden style={{ color: '#137333', fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span>{punt}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/register?doel=archief"
            style={{
              display: 'inline-block', padding: '13px 24px', background: '#7C5800', color: '#fff',
              borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 15.5,
            }}
          >
            Begin met je archief →
          </Link>
          <p style={{ fontSize: 13.5, color: '#5f6368', margin: '14px 0 0', lineHeight: 1.6 }}>
            Je maakt eerst een account en zet je stukken erin. Pas als je ziet wat er staat, en wat het
            voor jouw jaren kost, reken je af. Er wordt niets afgeschreven zolang je daar zelf niet op
            klikt.
          </p>
        </section>

        {/* ── Voor wie ───────────────────────────────────────────── */}
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#202124', margin: '0 0 16px' }}>
            Voor wie dit bedoeld is
          </h2>
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            {VOOR_WIE.map((v) => (
              <div key={v.kop} style={{ ...card, padding: 18 }}>
                <div style={{ fontSize: 15.5, fontWeight: 600, color: '#202124', marginBottom: 6 }}>{v.kop}</div>
                <div style={{ fontSize: 14.5, color: '#5f6368', lineHeight: 1.6 }}>{v.tekst}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Wat wij niet doen — bewust vóór de FAQ ─────────────── */}
        <section style={{ ...card, marginTop: 32, borderColor: '#c9d5e8', background: '#F7FAFF' }}>
          <h2 style={{ fontSize: 19, fontWeight: 700, color: '#202124', margin: '0 0 6px' }}>
            Wat wij nadrukkelijk níét doen
          </h2>
          <p style={{ fontSize: 14.5, color: '#5f6368', margin: '0 0 14px', lineHeight: 1.6 }}>
            Dit staat hier boven de veelgestelde vragen en niet in de kleine lettertjes, omdat het de
            belangrijkste zin van de hele pagina bevat.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 9 }}>
            {KLUIS_NOOIT.map((punt) => (
              <li key={punt} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14.5, color: '#202124', lineHeight: 1.55 }}>
                <span aria-hidden style={{ color: '#1A73E8', fontWeight: 700, flexShrink: 0 }}>•</span>
                <span>{punt}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── FAQ ────────────────────────────────────────────────── */}
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#202124', margin: '0 0 16px' }}>
            Veelgestelde vragen
          </h2>
          <div style={{ display: 'grid', gap: 14 }}>
            <Faq q={`Hoe lang moet ik mijn administratie precies bewaren?`}>
              De hoofdregel is <strong>{BEWAARPLICHT_YEARS} jaar</strong>, gerekend vanaf het einde van
              het boekjaar waar de stukken bij horen. Stukken uit 2026 moeten dus tot en met 2033 mee.
              Voor gegevens over <strong>onroerende zaken geldt 10 jaar</strong> — daar rekent de
              Bewaarkluis níét mee, dus heb je vastgoed in je administratie, houd dan zelf die langere
              termijn aan. Wij zijn geen fiscalist; twijfel je, vraag het je boekhouder of de
              Belastingdienst.
            </Faq>

            <Faq q="Mag digitaal bewaren, of moet het op papier?">
              Digitaal mag, mits de stukken binnen redelijke tijd leesbaar en controleerbaar zijn. Dat
              laatste is precies waar het in de praktijk misgaat: een schijf in een la voldoet op papier
              wél, maar niet meer op het moment dat niemand hem nog kan uitlezen.
            </Faq>

            <Faq q="Nemen jullie mijn bewaarplicht over?">
              Nee, en dat kan ook niet. De bewaarplicht is en blijft een verplichting van jou als
              ondernemer. Wij leveren de bewaring en de toegankelijkheid — een hulpmiddel om eraan te
              voldoen, geen partij die haar overneemt. Bewaar daarom altijd ook je eigen kopie:{' '}
              <strong>wij zijn je tweede exemplaar, nooit je enige.</strong>
            </Faq>

            <Faq q="Wat als BoekBrug ophoudt te bestaan?">
              Dan hoor je dat <strong>{KLUIS_SHUTDOWN_NOTICE_DAYS} dagen van tevoren</strong>, krijgt
              iedere klant automatisch zijn volledige archief toegestuurd, en betalen wij het
              niet-verbruikte deel van je vooruitbetaling naar rato terug. Dat staat zo in de{' '}
              <Link href="/voorwaarden" style={{ color: '#1A73E8' }}>voorwaarden §5.7</Link> — een
              belofte van zeven jaar is alleen eerlijk met een uitgang die vooraf vaststaat.
            </Faq>

            <Faq q="Waarom in één keer vooruit betalen?">
              Twee redenen, en de tweede is de echte. Je wilt het geregeld hebben in plaats van een
              incasso te onderhouden voor een onderneming die je net hebt afgesloten. En: zolang er
              vooruit is betaald, kunnen wij nooit in de positie komen dat wij opslag leveren die niet
              gedekt is. Liever per jaar? Dat kan ook, tegen een iets hoger jaartarief.
            </Faq>

            <Faq q="Ik gebruik BoekBrug al. Moet ik dit ook?">
              Nee. Zolang je account loopt staat alles er gewoon, gratis, binnen het{' '}
              <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>eerlijk gebruik</Link>. En zeg
              je op, dan bewaren wij je administratie eerst nog <strong>{KLUIS_GRACE_MONTHS} maanden
              kosteloos</strong>, met minstens 30 dagen waarschuwing per e-mail voordat er ooit iets
              weggaat. De Bewaarkluis is voor wie het daarna nog online wil hebben staan.
            </Faq>

            <Faq q="Kan mijn boekhouder erbij?">
              Ja, zolang je hem gekoppeld laat. Het boekhoudersportaal is gratis, ook met honderd
              klanten — daar verandert de Bewaarkluis niets aan.
            </Faq>
          </div>
        </section>

        <p style={{ fontSize: 13.5, color: '#5f6368', margin: '28px 0 0', lineHeight: 1.65 }}>
          BoekBrug is geen accountant en geeft geen fiscaal advies. Deze pagina beschrijft de
          hoofdregel van de fiscale bewaarplicht; jouw situatie kan afwijken. Zie de{' '}
          <Link href="/voorwaarden" style={{ color: '#1A73E8' }}>Algemene Voorwaarden</Link> en de{' '}
          <Link href="/privacy" style={{ color: '#1A73E8' }}>Privacyverklaring</Link>.
        </p>
      </main>

      <PublicFooter />
    </div>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 15.5, fontWeight: 600, color: '#202124', marginBottom: 6 }}>{q}</div>
      <div style={{ fontSize: 15, color: '#5f6368', lineHeight: 1.65 }}>{children}</div>
    </div>
  )
}
