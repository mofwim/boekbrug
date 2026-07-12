// src/app/boekhouden-zzp/page.tsx
// [SEGMENT] Audience page for ZZP'ers who do their own bookkeeping.
// Angle: keep it simple (the thing the big packages make complicated).

import type { Metadata } from 'next'
import SegmentLanding, { type SegmentContent } from '@/components/segment-landing'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Boekhouden voor ZZP’ers — simpel gehouden | BoekBrug',
  description:
    'Boekhouden voor ZZP’ers zonder gedoe. Maak en scan facturen, houd je BTW per kwartaal bij en werk samen met je boekhouder. Plus gratis tools, zonder account.',
  keywords: ['boekhouden zzp', 'boekhoudprogramma zzp', 'administratie zzp', 'facturen en btw zzp'],
  alternates: { canonical: '/boekhouden-zzp' },
  openGraph: {
    title: 'Boekhouden voor ZZP’ers — simpel gehouden',
    description: 'Facturen, BTW en je administratie op één plek. Zonder ingewikkelde software.',
    type: 'website',
  },
}

const content: SegmentContent = {
  eyebrow: 'Voor ZZP’ers',
  h1: 'Boekhouden voor ZZP’ers, simpel gehouden',
  intro: 'Je facturen, je BTW en je administratie op één plek. Zonder ingewikkelde software.',
  showTools: true,
  blocks: [
    {
      h2: 'Boekhouden hoeft niet moeilijk te zijn',
      paragraphs: [
        'Veel boekhoudprogramma’s zijn gemaakt voor mensen die al verstand hebben van boekhouden. BoekBrug houdt het simpel, ook als je er niks van weet. Duidelijke taal, weinig knoppen.',
        'Je begint gratis. Je hebt geen creditcard nodig en je kunt de gratis tools zelfs zonder account gebruiken.',
      ],
    },
    {
      h2: 'Wat kun je met BoekBrug?',
      paragraphs: ['Alles voor je dagelijkse administratie, op één plek:'],
      bullets: [
        'Facturen maken, versturen en bewaren',
        'Bonnen en inkoopfacturen scannen — de AI leest de gegevens voor je uit, jij bevestigt',
        'Je omzet en BTW per kwartaal bij elkaar, klaar voor de aangifte',
        'Je documenten netjes bewaren',
        'Samenwerken met je boekhouder',
      ],
    },
    {
      h2: 'Zo werkt het',
      paragraphs: [
        'Maak of scan je factuur. Je omzet en BTW lopen per kwartaal mee. Deel alles met één klik met je boekhouder. Meer is het niet.',
      ],
    },
  ],
  faq: [
    {
      q: 'Heb ik boekhoudkennis nodig?',
      a: 'Nee. BoekBrug is gemaakt voor ZZP’ers zonder boekhoudachtergrond. De taal is simpel en je ziet steeds wat je moet doen.',
    },
    {
      q: 'Doet BoekBrug mijn belastingaangifte?',
      a: 'Nee. BoekBrug houdt je omzet en BTW per kwartaal bij, zodat je aangifte makkelijker wordt. De aangifte zelf doe je zelf of samen met je boekhouder.',
    },
    {
      q: 'Kan ik het gratis proberen?',
      a: 'Ja. Je maakt gratis een account, zonder creditcard. En de losse tools (factuur maken, BTW berekenen) werken zelfs zonder account.',
    },
  ],
  ctaHeading: 'Begin vandaag met je administratie',
  ctaText: 'Gratis account, in een minuut geregeld. Geen creditcard nodig.',
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
        { '@type': 'ListItem', position: 2, name: 'Boekhouden voor ZZP’ers', item: absoluteUrl('/boekhouden-zzp') },
      ],
    },
  ],
}

export default function BoekhoudenZzpPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SegmentLanding content={content} />
    </>
  )
}
