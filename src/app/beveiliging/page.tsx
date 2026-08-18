// src/app/beveiliging/page.tsx
// [BELOFTE-BEWIJS] De publieke beveiligingspagina.
//
// ── WAAROM DEZE PAGINA ANDERS IS DAN ELKE ANDERE ──
//
// Iemand die overweegt zijn boekhouding aan een onbekende leverancier te geven, kan precies één
// ding niet zelf controleren: of er verder iemand meekijkt. Elke concurrent beantwoordt dat met een
// alinea over zichzelf — een uitspraak over het BEDRIJF, die je alleen kunt geloven. Deze pagina
// doet het andersom: hij noemt de zeven dingen die het programma doet, en elk van die zeven is in
// src/lib/security-claims.ts vastgeknoopt aan de code die hem waar maakt. Verdwijnt die code, dan
// valt de build om — niet de zin van de pagina.
//
// ⚠️ De eerlijkheidsregel die hier het strengst geldt, en die harder is dan op /bewaarplicht:
// ALLES OP DEZE PAGINA MOET NA TE LOPEN ZIJN. Geen keurmerk dat we niet hebben, geen datacenter dat
// we niet kunnen aanwijzen, geen versleuteling waar wij zelf wél doorheen kunnen. De vier zinnen
// onder "Wat wij niet beloven" zijn dáárom geen smet op de pagina maar de reden dat de rest ervan
// iets waard is — en ze staan in dezelfde registerfile, met een test die weigert ze te laten
// verdwijnen terwijl de vleiende helft blijft staan.

import type { Metadata } from 'next'
import Link from 'next/link'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import { SECURITY_CLAIMS, SECURITY_LIMITS } from '@/lib/security-claims'

export const metadata: Metadata = {
  title: 'Beveiliging — wie kan er bij jouw administratie? | BoekBrug',
  description:
    'Verificatie in twee stappen, een logboek dat je zelf leest, zien wie er toegang heeft, en je ' +
    'hele administratie er in één zip weer uit. Inclusief wat wij niet beloven.',
  keywords: [
    'boekhoudprogramma beveiliging',
    'tweestapsverificatie boekhouding',
    'wie kan bij mijn administratie',
    'boekhouding gegevens veilig',
    'administratie exporteren boekhoudprogramma',
  ],
  alternates: { canonical: '/beveiliging' },
  openGraph: {
    title: 'Wie kan er bij jouw administratie?',
    description:
      'Zeven dingen die BoekBrug doet, en vier die het niet doet. Allemaal na te lopen.',
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

export default function BeveiligingPage() {
  return (
    <>
      <PublicHeader />

      <main style={{ background: '#F8F9FA', padding: '48px 0 72px', fontFamily: 'Roboto, system-ui, sans-serif' }}>
        <section style={{ ...wrap, marginBottom: 40 }}>
          <h1 style={{ fontSize: 34, fontWeight: 700, color: '#1F1F1F', margin: '0 0 14px', lineHeight: 1.2 }}>
            Wie kan er bij jouw administratie?
          </h1>
          <p style={{ fontSize: 17, color: '#5F6368', margin: 0, lineHeight: 1.6 }}>
            Dat is de enige vraag die je niet zelf kunt nakijken voordat je je boekhouding ergens
            neerzet. Hieronder staat wat BoekBrug doet — en onderaan wat het níét doet, want een
            pagina met alleen goed nieuws lees je terecht als reclame.
          </p>
        </section>

        {/* De claims komen uit het register, niet uit deze pagina. Een met de hand overgeschreven
            lijst is precies de plek waar de tekst en het bewijs uit elkaar gaan lopen — zie de kop
            van src/lib/security-claims.ts. */}
        <section style={{ ...wrap, display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 40 }}>
          {SECURITY_CLAIMS.map((claim) => (
            <article key={claim.id} style={card}>
              <h2 style={{ fontSize: 19, fontWeight: 600, color: '#1F1F1F', margin: '0 0 8px', lineHeight: 1.35 }}>
                {claim.title}
              </h2>
              <p style={{ fontSize: 15.5, color: '#3C4043', margin: 0, lineHeight: 1.65 }}>{claim.body}</p>
            </article>
          ))}
        </section>

        <section style={{ ...wrap, marginBottom: 40 }}>
          <div style={{ ...card, background: '#FFF8E1', border: '1px solid #F0D9A0' }}>
            <h2 style={{ fontSize: 21, fontWeight: 700, color: '#1F1F1F', margin: '0 0 6px' }}>
              Wat wij niet beloven
            </h2>
            <p style={{ fontSize: 15, color: '#5F4B1F', margin: '0 0 18px', lineHeight: 1.6 }}>
              Dit stuk staat er omdat het de rest geloofwaardig maakt. Als je het ergens anders niet
              tegenkomt, betekent dat niet dat het daar niet geldt.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {SECURITY_LIMITS.map((limit) => (
                <p key={limit.id} style={{ fontSize: 15, color: '#3C4043', margin: 0, lineHeight: 1.65 }}>
                  {limit.body}
                </p>
              ))}
            </div>
          </div>
        </section>

        <section style={wrap}>
          <div style={card}>
            <h2 style={{ fontSize: 19, fontWeight: 600, color: '#1F1F1F', margin: '0 0 8px' }}>
              Verder lezen
            </h2>
            <p style={{ fontSize: 15.5, color: '#3C4043', margin: '0 0 14px', lineHeight: 1.65 }}>
              De privacyverklaring noemt elke subverwerker met naam, land en grondslag. De
              voorwaarden bevatten de afspraak over wat er gebeurt als BoekBrug stopt.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <Link
                href="/privacy"
                style={{
                  display: 'inline-block', padding: '10px 18px', borderRadius: 12,
                  border: '1px solid #d0d0d0', color: '#3C4043', fontSize: 14.5,
                  fontWeight: 600, textDecoration: 'none',
                }}
              >
                Privacyverklaring
              </Link>
              <Link
                href="/voorwaarden"
                style={{
                  display: 'inline-block', padding: '10px 18px', borderRadius: 12,
                  border: '1px solid #d0d0d0', color: '#3C4043', fontSize: 14.5,
                  fontWeight: 600, textDecoration: 'none',
                }}
              >
                Algemene voorwaarden
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </>
  )
}
