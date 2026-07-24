// src/app/dashboard/accountant/status/page.tsx
// [WERKBOARD] The readiness board was merged into the unified Aangifte & status
// board. This route is kept as a permanent redirect so any saved/bookmarked link
// still lands on the live board instead of 404-ing.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function StatusRedirectPage() {
  redirect('/dashboard/accountant/agenda')
}
