'use client'

// src/components/ui/BackLink.tsx
// [NAVIGATION] The one and only back button.
//
// It ALWAYS renders a <Link> to the current page's canonical parent, resolved
// from the single source of truth in src/lib/navigation.ts. It NEVER calls
// router.back() / history.back(), so it is structurally impossible for it to
// loop: every parent is an explicit ancestor, and following parents always
// terminates at the role home.
//
// Usage:
//   <BackLink />                          // parent via getParentPath (zzp default)
//   <BackLink role={profile.role} />      // role-aware pages (facturen, bestanden…)
//   <BackLink href="/dashboard/bank" />   // explicit override when a page needs it
//   <BackLink label="Terug naar dashboard" style={{ color: M3.primary }} />

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { getParentPath, type Role } from '@/lib/navigation'
import type { CSSProperties } from 'react'

export interface BackLinkProps {
  /** Role used to resolve role-dependent parents. Defaults to 'zzper'. */
  role?: Role | 'client' | null
  /** Explicit destination — overrides getParentPath when the page needs it. */
  href?: string
  /** Visible label after the arrow. Defaults to "Terug". */
  label?: string
  className?: string
  style?: CSSProperties
}

export function BackLink({
  role = 'zzper',
  href,
  label = 'Terug',
  className,
  style,
}: BackLinkProps) {
  const pathname = usePathname()
  const search = useSearchParams()

  // 'client' has no navigation tree of its own — treat it as zzper for parents.
  const navRole: Role = role === 'accountant' ? 'accountant' : 'zzper'
  const target = href ?? getParentPath(pathname ?? '/dashboard', navRole, search)

  return (
    <Link
      href={target}
      aria-label={label}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 14,
        fontWeight: 500,
        color: '#1A73E8',
        textDecoration: 'none',
        transition: 'opacity 0.15s',
        ...style,
      }}
    >
      <span aria-hidden>←</span>
      {label}
    </Link>
  )
}
