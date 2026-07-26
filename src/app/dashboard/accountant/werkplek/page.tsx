// src/app/dashboard/accountant/werkplek/page.tsx
// [ROLE-PARITY] The accountant werkplek tools (Beheren / Kwartaal / Brug /
// Facturen / Bestanden / Instellingen) are now surfaced directly as a tile grid
// on the accountant home, so this separate menu page is redundant. Kept as a
// permanent redirect so any saved/bookmarked link still lands on the live home
// instead of 404-ing.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function AccountantWerkplekRedirect() {
  redirect('/dashboard/accountant')
}
