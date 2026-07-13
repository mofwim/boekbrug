'use client'

// src/app/dashboard/DashboardClient.tsx
// [CONTROL] ZZP-only. dashboard/page.tsx:26 redirects accountants to
// /dashboard/accountant BEFORE this renders, so the old AccountantDashboard
// branch was unreachable dead code and has been removed (AccountantHome is the
// live accountant home).

import { ZzpDashboard } from './zzp/ZzpDashboard'

export default function DashboardClient({ profile }: { profile: any }) {
  return <ZzpDashboard profile={profile} />
}