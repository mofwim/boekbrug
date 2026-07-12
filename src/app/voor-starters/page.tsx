// src/app/voor-starters/page.tsx
// [SEGMENT] Audience page for people just starting as ZZP'er (beginners with
// no accountant yet). Angle: reassuring + simple — the segment the big
// packages overwhelm.

import type { Metadata } from 'next'
import SegmentLanding, { type SegmentContent } from '@/components/segment-landing'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Net begonnen als ZZP’er? Zo start je simpel | BoekBrug',
  description:
    'Net begonnen als ZZP’er? BoekBrug houdt je administratie simpel, ook zonder boekhoudkennis. Maak je eerste factuur, scan je bonnen en houd je BTW bij. Gratis beginnen.',
  keywords: ['beginnen als zzp', 'boekhouden starter', 'eerste factuur maken', 'administratie starter zzp'],
  alternates: { canonical: '/voor-starters' },
  openGraph: {
    title: 'Net begonnen als ZZP’er?',
    description: 'Start simpel met je administratie — ook zonder boekhoudkennis. Gratis beginnen.',
    type: 'website',
  },
}

const content: SegmentContent = {
  eyebrow: 'Voor starters',
  h1: 'Net begonnen als ZZP’er?',
  intro: 'Start simpel met je administratie. Ook als je nog niks van boekhouden weet.',
  showTools: true,
  blocks: [
    {
      h2: 'Geen boekhoudkennis nodig',
      paragraphs: [
        'Als starter wil je ondernemen, niet uren puzzelen met moeilijke software. BoekBrug houdt het klein en duidelijk: maak je eerste factuur, scan je bonnen en zie je BTW per kwartaal.',
        'Je begint gratis en zonder creditcard. Wil je eerst even proberen? De losse tools werken zelfs zonder account.',
      ],
    },
    {
      h2: 'Je eerste stappen',
      paragraphs: ['In een paar minuten sta je op de rails:'],
      bullets: [
        'Maak je eerste factuur die klopt met de Nederlandse regels',
        'Scan je bonnen — de AI leest de gegevens voor je uit',
        'Zie je omzet en BTW per kwartaal, klaar voor je aangifte',
        'Later makkelijk samenwerken met een boekhouder',
      ],
    },
    {
      h2: 'Meegroeien als je groeit',
      paragraphs: [
        'Je hoeft niet alles in één keer te snappen. Begin met facturen, en gebruik de rest wanneer je eraan toe bent. BoekBrug groeit met je mee.',
      ],
    },
  ],
  faq: [
    {
      q: 'Ik weet niks van boekhouden. Kan ik dit?',
      a: 'Ja. BoekBrug is juist gemaakt voor starters zonder boekhoudachtergrond. Simpele taal en één duidelijke volgende stap.',
    },
    {
      q: 'Wat kost het om te beginnen?',
      a: 'Niets. Je maakt gratis een account, zonder creditcard. De losse tools kun je zelfs zonder account gebruiken.',
    },
    {
      q: 'Heb ik al een boekhouder nodig?',
      a: 'Nee. Je kunt zelf beginnen. Werk je later met een boekhouder, dan deel je je administratie met één klik.',
    },
  ],
  ctaHeading: 'Zet je eerste stap',
  ctaText: 'Maak gratis je account en je eerste factuur. Geen creditcard nodig.',
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'FAQPage',
      mainEntity: content.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
        { '@type': 'ListItem', position: 2, name: 'Voor starters', item: absoluteUrl('/voor-starters') },
      ],
    },
  ],
}

export default function VoorStartersPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SegmentLanding content={content} />
    </>
  )
}
