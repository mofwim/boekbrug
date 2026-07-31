// src/app/factuur-maken/[vak]/page.tsx
// [VAK-PAGINAS] Eén pagina per beroep: /factuur-maken/loodgieter, /factuur-maken/automonteur, …
//
// Waarom dit meer waard is dan de keuzelijst op de hoofdpagina. Zoeken naar
// "boekhoudprogramma zzp" is een van de duurst bevochten termen van Nederland — daar staan
// partijen die er al jaren geld in stoppen. Zoeken naar "factuur maken loodgieter" of
// "factuur voorbeeld monteur" doet vrijwel niemand iets mee. Dat zijn precies de mensen die
// dit product nodig hebben, en ze zijn te bereiken zonder één euro advertentiebudget.
//
// Elke pagina is inhoudelijk ánders, niet dezelfde tekst met een ander woord erin: eigen
// titel, eigen omschrijving, de regels van dát vak, en — het belangrijkst — de BTW-valkuil van
// dat vak als zichtbare tekst. Dat laatste is geen SEO-truc maar het antwoord op de vraag
// waarmee de bezoeker binnenkomt: "welk tarief moet ik rekenen?". Een pagina die dat als
// eerste beantwoordt verdient de bezoeker die erop klikt.
//
// Statisch geprerenderd (generateStaticParams), dus ze kosten niets per bezoek.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import GratisFactuur from '../GratisFactuur'
import PublicHeader from '@/components/public-header'
import { absoluteUrl } from '@/lib/site'
import { VAKKEN, vakBySlug } from '@/lib/vak-sjablonen'

export function generateStaticParams() {
  return VAKKEN.map((v) => ({ vak: v.slug }))
}

/** Onbekende slug → 404. Nooit de generieke pagina serveren onder een verzonnen url: dan
 *  ontstaan er oneindig veel adressen met dezelfde inhoud, en dát is wél een SEO-probleem. */
export const dynamicParams = false

type Props = { params: Promise<{ vak: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { vak: slug } = await params
  const vak = vakBySlug(slug)
  if (!vak) return {}

  const titel = `Factuur maken voor ${vak.label.toLowerCase()} — gratis, met het juiste BTW-tarief`
  const omschrijving = `${vak.omschrijving}. Maak gratis een nette factuur met de gebruikelijke regels en het juiste BTW-tarief. Geen account nodig, direct als PDF.`

  return {
    title: `${titel} | BoekBrug`,
    description: omschrijving,
    keywords: [
      `factuur maken ${vak.label.toLowerCase()}`,
      `factuur voorbeeld ${vak.label.toLowerCase()}`,
      `btw tarief ${vak.label.toLowerCase()}`,
      'gratis factuur',
      'zzp factuur',
    ],
    alternates: { canonical: `/factuur-maken/${vak.slug}` },
    openGraph: { title: titel, description: omschrijving, type: 'website' },
  }
}

export default async function VakFactuurPagina({ params }: Props) {
  const { vak: slug } = await params
  const vak = vakBySlug(slug)
  if (!vak) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        name: `Factuur maken voor ${vak.label.toLowerCase()}`,
        applicationCategory: 'FinanceApplication',
        operatingSystem: 'Web',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
        description: vak.omschrijving,
      },
      // Alleen een FAQ als er ook echt een vraag beantwoord wordt. Een verzonnen vraag om een
      // rich result te scoren is precies het soort ruis waar dit product niet aan meedoet.
      ...(vak.let_op
        ? [{
            '@type': 'FAQPage',
            mainEntity: [{
              '@type': 'Question',
              name: `Welk BTW-tarief geldt voor ${vak.label.toLowerCase()}?`,
              acceptedAnswer: { '@type': 'Answer', text: vak.let_op },
            }],
          }]
        : []),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
          { '@type': 'ListItem', position: 2, name: 'Factuur maken', item: absoluteUrl('/factuur-maken') },
          { '@type': 'ListItem', position: 3, name: vak.label, item: absoluteUrl(`/factuur-maken/${vak.slug}`) },
        ],
      },
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      {/* De inhoudelijke kop staat in de server-component, niet in de client: zo staat hij in de
          HTML die de crawler krijgt, ook als het formulier eronder nog moet opstarten. */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 0' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px', color: '#202124' }}>
          Factuur maken voor {vak.label.toLowerCase()}
        </h1>
        <p style={{ fontSize: 15, color: '#5f6368', margin: '0 0 16px', lineHeight: 1.6 }}>
          {vak.omschrijving}. De gebruikelijke regels staan hieronder al klaar, met het BTW-tarief
          dat erbij hoort. Vul je bedragen in en download je factuur als PDF — gratis, zonder
          account. De bedragen zijn van jou: wij vullen nooit een prijs voor je in.
        </p>

        {vak.let_op && (
          <div
            style={{
              background: '#FEE8C4', border: '1px solid #7C5800', color: '#7C5800',
              borderRadius: 12, padding: '14px 16px', marginBottom: 20,
              fontSize: 14, lineHeight: 1.6,
            }}
          >
            <strong style={{ display: 'block', marginBottom: 4 }}>
              Welk BTW-tarief geldt voor {vak.label.toLowerCase()}?
            </strong>
            {vak.let_op}
          </div>
        )}
      </div>

      <GratisFactuur initialVak={vak.slug} />
    </>
  )
}
