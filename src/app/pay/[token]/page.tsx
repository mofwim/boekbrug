// src/app/pay/[token]/page.tsx
// [BETAALVERZOEK] Public, login-free payment page. A per-token page must NOT be
// indexed (it references one customer's invoice), so robots: noindex. The data +
// QR are loaded client-side from /api/pay/[token] (the allowlisted projection).
// This path is in middleware PUBLIC_PATHS via the "/pay" prefix.

import type { Metadata } from 'next'
import PayClient from './PayClient'

export const metadata: Metadata = {
  title: 'Betaalverzoek | BoekBrug',
  description: 'Betaal deze factuur veilig vanuit je eigen bankapp.',
  robots: { index: false, follow: false },
}

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <PayClient token={token} />
}
