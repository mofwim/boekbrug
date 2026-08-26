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
import { vakContentBySlug } from '@/lib/vak-content'

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

  // [VAK-CONTENT] Een uitgewerkte pagina schrijft haar eigen titel en omschrijving: die gaan over
  // wat er op DEZE pagina te lezen valt (arbeid en materiaal splitsen, BTW verlegd), niet over de
  // generator die op elke vakpagina hetzelfde is. De acht andere houden de generieke opzet.
  const content = vakContentBySlug(vak.slug)
  if (content) {
    return {
      title: content.title,
      description: content.description,
      keywords: [
        `factuur maken ${vak.label.toLowerCase()}`,
        `factuur voorbeeld ${vak.label.toLowerCase()}`,
        `btw tarief ${vak.label.toLowerCase()}`,
        'gratis factuur',
        'zzp factuur',
      ],
      alternates: { canonical: `/factuur-maken/${vak.slug}` },
      openGraph: { title: content.h1, description: content.description, type: 'website' },
    }
  }

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

  const content = vakContentBySlug(vak.slug)

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
      // rich result te scoren is precies het soort ruis waar dit product niet aan meedoet — en
      // Google is in mei 2026 gestopt met FAQ rich results, dus die ruil bestaat sowieso niet
      // meer. Wat overblijft is de enige reden die er altijd al toe deed: de vragen staan
      // ZICHTBAAR op de pagina omdat een bezoeker ze stelt, en de markup beschrijft wat er staat.
      //
      // Vandaar dat de bron hier de gerenderde tekst is en nooit een tweede literal: een
      // uitgewerkt vak stuurt zijn eigen vragenlijst mee, de andere acht beschrijven het
      // let_op-blok dat boven de generator staat.
      ...(content
        ? [{
            '@type': 'FAQPage',
            mainEntity: content.faq.map((f) => ({
              '@type': 'Question',
              name: f.q,
              acceptedAnswer: { '@type': 'Answer', text: f.a },
            })),
          }]
        : vak.let_op
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
          {content ? content.h1 : `Factuur maken voor ${vak.label.toLowerCase()}`}
        </h1>

        {/* [VAK-CONTENT] Een uitgewerkt vak schrijft zijn eigen inleiding, want de generieke zin
            beschrijft de generator en niet het vak. De acht andere houden hem. */}
        {content ? (
          content.intro.map((alinea) => (
            <p key={alinea.slice(0, 24)} style={{ fontSize: 15, color: '#5f6368', margin: '0 0 12px', lineHeight: 1.6 }}>
              {alinea}
            </p>
          ))
        ) : (
          <p style={{ fontSize: 15, color: '#5f6368', margin: '0 0 16px', lineHeight: 1.6 }}>
            {vak.omschrijving}. De gebruikelijke regels staan hieronder al klaar, met het BTW-tarief
            dat erbij hoort. Vul je bedragen in en download je factuur als PDF — gratis, zonder
            account. De bedragen zijn van jou: wij vullen nooit een prijs voor je in.
          </p>
        )}

        {/* Het let_op-blok blijft bovenaan staan voor de acht die geen uitgewerkte pagina hebben:
            daar is het het enige antwoord dat de bezoeker komt halen. Voor de drie uitgewerkte
            vakken staat diezelfde regel — uitgebreider — ONDER de generator, zodat wie kwam
            factureren eerst kan factureren. Twee keer dezelfde waarschuwing zou de pagina alleen
            langer maken. */}
        {!content && vak.let_op && (
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

      <GratisFactuur
        initialVak={vak.slug}
        belowTool={content ? <VakUitleg content={content} /> : undefined}
      />
    </>
  )
}

/**
 * [VAK-CONTENT] De uitleg onder de generator: de regel van dit vak, een voorbeeldfactuur en de
 * vragen. Onder, niet boven — wie kwam factureren is dan klaar, en wie via Google binnenkomt
 * leest hier het antwoord op de vraag waarmee hij zocht.
 *
 * De kaartstijl is met opzet dezelfde als die van de generator erboven (witte kaart, 12px radius,
 * #E0E0E0-rand): dit is één pagina, niet een tool met een artikel eronder geplakt.
 */
function VakUitleg({ content }: { content: NonNullable<ReturnType<typeof vakContentBySlug>> }) {
  const kaart: React.CSSProperties = {
    background: '#fff', border: '1px solid #E0E0E0', borderRadius: 12,
    padding: '20px 22px', marginTop: 24,
  }
  const kop: React.CSSProperties = { fontSize: 18, fontWeight: 700, color: '#202124', margin: '0 0 10px' }
  const alinea: React.CSSProperties = { fontSize: 14, color: '#5f6368', margin: '0 0 10px', lineHeight: 1.65 }

  return (
    <>
      <div style={kaart}>
        <h2 style={kop}>{content.main.heading}</h2>
        {content.main.paragraphs.map((p) => (
          <p key={p.slice(0, 24)} style={alinea}>{p}</p>
        ))}
        {/* De disclaimer draagt dezelfde kleuren als het let_op-blok op de andere vakpagina's,
            want het is hetzelfde soort mededeling: dit is de hoofdregel, niet jouw situatie. */}
        <p
          style={{
            background: '#FEE8C4', border: '1px solid #7C5800', color: '#7C5800',
            borderRadius: 10, padding: '12px 14px', margin: '14px 0 0',
            fontSize: 13.5, lineHeight: 1.6,
          }}
        >
          {content.main.disclaimer}
        </p>
      </div>

      <div style={kaart}>
        <h2 style={kop}>{content.example.heading}</h2>
        <p style={alinea}>{content.example.intro}</p>
        <ul style={{ margin: '0 0 12px', paddingInlineStart: 0, listStyle: 'none' }}>
          {content.example.lines.map((r) => (
            <li
              key={r.description}
              style={{
                display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline',
                borderBottom: '1px solid #f1f3f4', padding: '9px 0', fontSize: 14,
              }}
            >
              <span style={{ color: '#202124', fontWeight: 600 }}>{r.description}</span>
              <span style={{ color: '#70757a', fontSize: 13 }}>{r.note}</span>
            </li>
          ))}
        </ul>
        <p style={{ ...alinea, margin: 0 }}>{content.example.note}</p>
      </div>

      {/* [VAK-CONTENT] Zichtbaar, en exact wat de FAQPage-markup bovenaan de pagina beschrijft —
          één bron in vak-content.ts. Google honoreert alleen markup waarvan de vraag op de pagina
          staat, en sinds de FAQ rich results weg zijn is dat ook het enige dat dit blok nog moet
          doen: de vraag beantwoorden die de bezoeker had. */}
      <div style={kaart}>
        <h2 style={kop}>Veelgestelde vragen</h2>
        {content.faq.map((f) => (
          <div key={f.q} style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: '0 0 4px' }}>{f.q}</h3>
            <p style={{ ...alinea, margin: 0 }}>{f.a}</p>
          </div>
        ))}
      </div>
    </>
  )
}
