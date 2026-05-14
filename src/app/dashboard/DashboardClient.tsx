'use client'

// src/app/dashboard/DashboardClient.tsx
// Wrapper فقط — يختار ZZP أو Accountant بناءً على role

import { ZzpDashboard } from './zzp/ZzpDashboard'
import { AccountantDashboard } from './accountant/AccountantDashboard'

export default function DashboardClient({ profile }: { profile: any }) {
  if (profile.role === 'accountant') {
    return <AccountantDashboard profile={profile} />
  }
  return <ZzpDashboard profile={profile} />
}