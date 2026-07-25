// src/components/billing/TrialBanner.tsx
// [BILLING] "Nog X dagen" — the only nudge before the trial runs out.
//
// A server component with its OWN defensive read, deliberately not folded into
// the profile query in src/app/dashboard/layout.tsx: that query feeds Sentry
// context and the nav for every dashboard page, and adding columns to it that
// do not exist until a hand-applied migration lands would break both. An extra
// cached read is a very cheap price for not putting the whole dashboard chrome
// at risk.
//
// It renders NOTHING at all unless there is something worth interrupting for:
//   · not in a trial (paying, accountant, or already expired) → nothing;
//   · more than 7 days left → nothing. A banner that is always on is wallpaper,
//     and by the time it matters nobody sees it any more.

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { decideAccess, trialBanner } from '@/lib/subscription'

export default async function TrialBanner() {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  let row: {
    role?: string | null
    subscription_status?: string | null
    trial_ends_at?: string | null
    current_period_end?: string | null
  } | null = null

  try {
    // Billing columns are not in the generated types (billing_subscription.sql)
    // → relaxed client. A missing column must render nothing, never throw:
    // a banner is not worth a broken dashboard.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('profiles')
      .select('role, subscription_status, trial_ends_at, current_period_end')
      .eq('id', user.id)
      .single()
    if (error) return null
    row = data
  } catch {
    return null
  }

  if (!row) return null

  const banner = trialBanner(
    decideAccess({
      role: row.role ?? null,
      subscriptionStatus: row.subscription_status ?? null,
      trialEndsAt: row.trial_ends_at ?? null,
      currentPeriodEnd: row.current_period_end ?? null,
      nowMs: Date.now(),
    })
  )

  if (!banner) return null

  const { daysLeft, urgent } = banner

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 10,
        padding: '10px 16px',
        fontSize: 14,
        lineHeight: 1.4,
        fontFamily: 'var(--font-sans), system-ui, sans-serif',
        background: urgent ? '#F9DEDC' : '#FEE8C4',
        color: urgent ? '#B3261E' : '#7C5800',
        borderBottom: `1px solid ${urgent ? '#B3261E' : '#7C5800'}22`,
      }}
    >
      <span>
        {daysLeft === 0
          ? 'Je proefperiode loopt vandaag af.'
          : `Nog ${daysLeft} ${daysLeft === 1 ? 'dag' : 'dagen'} in je gratis proefperiode.`}
      </span>
      <a
        href="/prijzen"
        style={{
          color: 'inherit',
          fontWeight: 600,
          textDecoration: 'underline',
          textUnderlineOffset: 2,
        }}
      >
        Neem een abonnement
      </a>
    </div>
  )
}
