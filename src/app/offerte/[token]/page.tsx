// src/app/offerte/[token]/page.tsx
// [OFFERTE-AKKOORD] Publieke, loginvrije pagina waarop de klant ja of nee zegt.
//
// Per-token, dus hij verwijst naar de offerte van één klant: robots noindex, net als /pay. Dit pad
// staat in public-paths.ts onder het prefix "/offerte".

import type { Metadata } from 'next'
import OfferteClient from './OfferteClient'

export const metadata: Metadata = {
  title: 'Offerte | BoekBrug',
  description: 'Bekijk deze offerte en laat weten of je akkoord gaat.',
  robots: { index: false, follow: false },
}

export default async function OffertePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <OfferteClient token={token} />
}
