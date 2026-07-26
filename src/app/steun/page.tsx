// src/app/steun/page.tsx
// [STEUN] Donatiepagina — juli 2026
//
// Bestaat alleen als er een échte rechtspersoon (KVK) én een échte betaallink geconfigureerd
// zijn; anders 404 (zie src/lib/donation.ts). Er staat dus nooit een halfwerkende
// betaalpagina online.
//
// De tekst is bewust streng op drie punten, omdat een donatiepagina die dat niet is
// juridisch en fiscaal fout gaat:
//   1. GEEN TEGENPRESTATIE. Een donateur krijgt niets extra's — geen functies, geen
//      voorrang, geen invloed. Zodra er wél iets tegenover staat is het geen gift meer maar
//      een verkoop, met btw en alle plichten van dien.
//   2. GEEN GOEDDOELSUGGESTIE. BoekBrug is geen ANBI en geen stichting; een donatie is
//      daarom niet aftrekbaar. Dat staat er letterlijk, niet in een voetnoot.
//   3. GEEN VERWARRING MET HET ABONNEMENT. Doneren is geen manier om Plus te krijgen, en
//      niet doneren kost je niets.

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PublicFooter from '@/components/public-footer'
import { company } from '@/content/legal/company'
import { donationConfig } from '@/lib/donation'
import { PLUS_PRICE_EUR } from '@/lib/fair-use'

export const metadata: Metadata = {
  title: 'Steun BoekBrug',
  description:
    'BoekBrug is gratis voor ondernemers en gratis voor boekhouders. Wie wil, kan de ontwikkeling steunen met een vrijwillige bijdrage — zonder er iets voor terug te krijgen.',
  alternates: { canonical: '/steun' },
}

const text: React.CSSProperties = { color: '#3c4043', fontSize: 15, lineHeight: 1.7 }
const h2: React.CSSProperties = { fontSize: 21, fontWeight: 700, color: '#202124', margin: '32px 0 12px' }

export default function SteunPage() {
  const donation = donationConfig()
  if (!donation.enabled) notFound()

  const prijs = PLUS_PRICE_EUR.toFixed(2).replace('.', ',')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#fff' }}>
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '56px 20px 24px', flex: 1 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, color: '#202124', letterSpacing: -0.5, margin: '0 0 16px' }}>
          Steun BoekBrug
        </h1>

        <p style={{ ...text, fontSize: 17 }}>
          BoekBrug is gratis voor de ondernemer en gratis voor zijn boekhouder. Dat is een
          keuze, geen tijdelijke actie. Wie wil dat het zo blijft, kan de ontwikkeling
          vrijwillig steunen.
        </p>

        <h2 style={h2}>Waar het geld heen gaat</h2>
        <p style={text}>
          Twee dingen kosten per stuk geld: een document door de AI laten lezen, en je
          bestanden jarenlang bewaren. Daarnaast lopen de servers, de database en de
          e-mailverzending door. Een bijdrage gaat daarheen — niet naar advertenties.
        </p>

        <h2 style={h2}>Wat je er níét voor terugkrijgt</h2>
        <p style={text}>
          Niets. En dat is met opzet: een donatie is een gift, geen aankoop. Concreet
          betekent dat:
        </p>
        <ul style={{ ...text, paddingLeft: 22 }}>
          <li style={{ margin: '4px 0' }}>geen extra functies, geen hogere grenzen, geen voorrang bij support;</li>
          <li style={{ margin: '4px 0' }}>geen invloed op wat er gebouwd wordt;</li>
          <li style={{ margin: '4px 0' }}>geen vermelding, tenzij je daar zelf om vraagt;</li>
          <li style={{ margin: '4px 0' }}>
            geen abonnement — doneren is géén manier om Plus (€ {prijs} per maand) te krijgen, en
            niet doneren kost je niets.
          </li>
        </ul>
        <p style={text}>
          Heb je meer nodig dan het gratis plan biedt, neem dan gewoon{' '}
          <Link href="/eerlijk-gebruik" style={{ color: '#1a73e8' }}>Plus</Link>. Dat is
          eerlijker voor ons allebei dan een donatie.
        </p>

        <h2 style={h2}>Het fiscale eerlijke verhaal</h2>
        <ul style={{ ...text, paddingLeft: 22 }}>
          <li style={{ margin: '4px 0' }}>
            <strong>BoekBrug is geen goed doel en geen ANBI.</strong> Je bijdrage is dus{' '}
            <strong>niet aftrekbaar</strong> van je inkomsten- of vennootschapsbelasting.
          </li>
          <li style={{ margin: '4px 0' }}>
            Omdat er geen tegenprestatie tegenover staat, brengen wij geen btw in rekening en
            ontvang je geen btw-factuur. Wil je een factuur voor je eigen boekhouding, neem dan
            Plus in plaats van te doneren.
          </li>
          <li style={{ margin: '4px 0' }}>
            Wij verantwoorden bijdragen in onze eigen administratie en dragen daarover af wat
            de wet voorschrijft.
          </li>
          <li style={{ margin: '4px 0' }}>
            Een bijdrage is eenmalig tenzij je zelf een herhaling instelt, en je kunt die op
            elk moment stopzetten.
          </li>
        </ul>

        <h2 style={h2}>Aan wie je geeft</h2>
        <p style={text}>
          {company.legalName}, gevestigd te {company.city}
          {company.address !== '(adres volgt)' ? `, ${company.address}` : ''} — KVK {company.kvk}
          {company.btw !== '(volgt)' ? `, btw-id ${company.btw}` : ''}. Vragen:{' '}
          <a href="mailto:support@boekbrug.nl" style={{ color: '#1a73e8' }}>support@boekbrug.nl</a>.
        </p>

        <div style={{ margin: '36px 0 8px' }}>
          <a
            href={donation.url ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              background: '#1a73e8',
              color: '#fff',
              padding: '14px 28px',
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Een bijdrage doen
          </a>
        </div>
        <p style={{ ...text, fontSize: 13, color: '#80868b' }}>
          Je gaat naar onze betaaldienstverlener. Wij zien alleen dát er betaald is en door
          wie, niet je betaalgegevens.
        </p>

        <h2 style={h2}>Liever anders helpen?</h2>
        <p style={text}>
          Dat is minstens zo waardevol en kost je niets: vertel je boekhouder erover, meld een
          fout die je tegenkomt, of stuur ons een voorbeeld van een dagstaat of
          terminalafrekening die BoekBrug nog niet goed leest. Daar wordt het product
          aantoonbaar beter van.
        </p>
      </main>
      <PublicFooter />
    </div>
  )
}
