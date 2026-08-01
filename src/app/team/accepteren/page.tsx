// src/app/team/accepteren/page.tsx
// [NAMENS] De genodigde landt hier vanuit zijn mail.
//
// Bewust GEEN automatische acceptatie bij het laden van de pagina. Wat hier wordt aangenomen is
// het recht om facturen uit te geven onder het BTW-nummer van iemand anders — dat hoort een
// bewuste tik te zijn, niet iets wat gebeurt omdat een mailprogramma een link vooruit opende.

import { Suspense } from 'react'
import AccepterenClient from './AccepterenClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Toegang accepteren — BoekBrug' }

export default function AccepterenPage() {
  return (
    <Suspense fallback={null}>
      <AccepterenClient />
    </Suspense>
  )
}
