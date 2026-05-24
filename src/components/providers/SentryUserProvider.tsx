'use client'
// [BOEK-SENTRY] src/components/providers/SentryUserProvider.tsx
// Client component — sets Sentry user context after auth resolves
// Renders nothing — side effects only

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { setSentryUser, clearSentryUser } from '@/lib/sentry-user'

interface Props {
  userId: string
  email?: string | null
  role?: string | null
}

export default function SentryUserProvider({ userId, email, role }: Props) {
  useEffect(() => {
    setSentryUser({ id: userId, email, role })
    return () => clearSentryUser()
  }, [userId, email, role])

  return null
}