// src/app/voor-boekhouders/page.tsx
// [SEGMENT] Audience page for accountants/boekhouders. Angle: the "bridge" —
// work with your ZZP clients in one place. Only real accountant features:
// clients invite you, you see their (betaalde) facturen + gedeelde documenten.

import type { Metadata } from 'next'
import SegmentLanding, { type SegmentContent } from '@/components/segment-landing'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Voor boekhouders — samenwerken met je ZZP-klanten | BoekBrug',
  description:
    'BoekBrug is de brug tussen jou en je klant. Je ZZP-klanten delen hun facturen en documenten met je — op één plek, geen mappen vol PDF’s meer mailen. Gratis account.',
  keywords: ['boekhoudsoftware voor accountants', 'samenwerken met zzp klanten', 'boekhouder software', 'administratie klanten'],
  alternates: { canonical: '/voor-boekhouders' },
  openGraph: {
    title: 'Voor boekhouders en accountants',
    description: 'Werk samen met je ZZP-klanten op één plek. De brug tussen jou en je klant.',
    type: 'website',
  },
}

const content: SegmentContent = {
  eyebrow: 'Voor boekhouders',
  h1: 'Werk samen met je ZZP-klanten',
  intro: 'BoekBrug is de brug tussen jou en je klant. Alles op één plek, zonder mappen vol PDF’s heen en weer te mailen.',
  showTools: false,
  blocks: [
    {
      h2: 'Eén plek voor jou en je klanten',
      paragraphs: [
        'Je ZZP-klanten maken hun facturen in BoekBrug en delen ze met jou. Jij ziet hun betaalde facturen en de documenten die ze met je delen — netjes bij elkaar, per klant.',
        'Geen losse mailtjes met bonnetjes meer. Minder heen en weer, meer overzicht.',
      ],
    },
    {
      h2: 'Hoe de samenwerking werkt',
      paragraphs: ['De klant houdt de controle en nodigt jou uit:'],
      bullets: [
        'Je klant nodigt je uit — de koppeling is altijd met toestemming',
        'Je ziet de betaalde facturen en de gedeelde documentenmap van je klant',
        'Persoonlijke notities en concept-facturen blijven privé voor je klant',
        'De klant kan de koppeling op elk moment stoppen',
      ],
    },
    {
      h2: 'Simpel voor je klant, overzicht voor jou',
      paragraphs: [
        'Veel klanten vinden boekhoudsoftware ingewikkeld. BoekBrug houdt het voor hen simpel, zodat jij nettere administratie terugkrijgt. Zij doen het voorwerk, jij houdt het overzicht.',
      ],
    },
  ],
  faq: [
    {
      q: 'Wat ziet een boekhouder wel en niet?',
      a: 'Je ziet de betaalde facturen en de documenten die je klant met je deelt. Concept-facturen, persoonlijke notities en privébestanden blijven privé voor de klant.',
    },
    {
      q: 'Hoe koppel ik een klant?',
      a: 'De klant nodigt je uit vanuit zijn eigen account. De koppeling is altijd vrijwillig en met toestemming, en kan op elk moment worden gestopt.',
    },
    {
      q: 'Wat kost het voor boekhouders?',
      a: 'Je maakt gratis een account aan als boekhouder en kunt je klanten koppelen. Zo ervaar je zelf hoe de samenwerking werkt.',
    },
  ],
  ctaHeading: 'Maak een boekhouder-account',
  ctaText: 'Gratis aanmaken en je eerste klant koppelen. Ontdek hoe de samenwerking werkt.',
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
        { '@type': 'ListItem', position: 2, name: 'Voor boekhouders', item: absoluteUrl('/voor-boekhouders') },
      ],
    },
  ],
}

export default function VoorBoekhoudersPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SegmentLanding content={content} />
    </>
  )
}
