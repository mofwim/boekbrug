// src/lib/navigation.ts
// [NAVIGATION-CORE] Unified navigation parents — May 2026
// Every page has one declared parent. Change here, works everywhere.
//
// Two exports groups:
//   1. Pure functions  — usable in server + client components
//   2. React hooks     — 'use client' only (bottom of file, clearly marked)

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Role = 'zzper' | 'accountant'

type ParentRule = {
  match: RegExp
  parent: (
    pathname: string,
    role: Role,
    search?: URLSearchParams | null
  ) => string
}

// ─────────────────────────────────────────────────────────────────────────────
// Home path — root per role
// ─────────────────────────────────────────────────────────────────────────────

export function getHomePath(role: Role): string {
  return role === 'accountant' ? '/dashboard/accountant' : '/dashboard'
}

// ─────────────────────────────────────────────────────────────────────────────
// Parent rules — declarative, evaluated top-to-bottom, first match wins
// ─────────────────────────────────────────────────────────────────────────────

const PARENT_RULES: ParentRule[] = [
  // ── dagomzet (turnover import) → dashboard home ───────────────────────────
  {
    match: /^\/dashboard\/dagomzet$/,
    parent: () => '/dashboard',
  },

  // ── invoice/[id]/edit → invoice/[id] ──────────────────────────────────────
  {
    match: /^\/dashboard\/invoice\/([^/]+)\/edit$/,
    parent: (pathname) => pathname.replace(/\/edit$/, ''),
  },

  // ── invoice/new → depends on clientId query param + role ──────────────────
  {
    match: /^\/dashboard\/invoice\/new$/,
    parent: (_, role, search) => {
      const clientId = search?.get('clientId')
      if (clientId) return `/dashboard/clients/${clientId}`
      return role === 'accountant'
        ? '/dashboard/accountant'
        : '/dashboard/facturen'
    },
  },

  // ── invoice/[id] (any other) → facturen (zzp) or accountant home ──────────
  {
    match: /^\/dashboard\/invoice\/[^/]+$/,
    parent: (_, role) =>
      role === 'accountant' ? '/dashboard/accountant' : '/dashboard/facturen',
  },

  // ── clients/[id]/kwartaal → clients/[id] ─────────────────────────────────
  {
    match: /^\/dashboard\/clients\/([^/]+)\/kwartaal$/,
    parent: (pathname) => pathname.replace(/\/kwartaal$/, ''),
  },

  // ── clients/beheer → accountant home ─────────────────────────────────────
  {
    match: /^\/dashboard\/clients\/beheer$/,
    parent: () => '/dashboard/accountant',
  },

  // ── clients/[id] (any other) → accountant home ───────────────────────────
  {
    match: /^\/dashboard\/clients\/[^/]+$/,
    parent: () => '/dashboard/accountant',
  },

  // ── accountant/werkplek → accountant home ────────────────────────────────
  {
    match: /^\/dashboard\/accountant\/werkplek$/,
    parent: () => '/dashboard/accountant',
  },

  // ── /dashboard/accountant itself → home (no parent) ──────────────────────
  {
    match: /^\/dashboard\/accountant$/,
    parent: () => '/dashboard/accountant',
  },

  // ── /dashboard itself → home (no parent) ─────────────────────────────────
  {
    match: /^\/dashboard$/,
    parent: () => '/dashboard',
  },

  // ── incoming/manage → incoming ───────────────────────────────────────────
  // [CONTROL] without this it fell through to home, so the primary "Terug"
  // jumped past the verification list to the dashboard.
  {
    match: /^\/dashboard\/incoming\/manage$/,
    parent: () => '/dashboard/incoming',
  },

  // ── all other /dashboard/* → home per role ────────────────────────────────
  // covers: /facturen, /klanten, /bestanden, /incoming, /quarterly,
  //         /settings, /werkplek (zzp), etc.
  {
    match: /^\/dashboard\/.+/,
    parent: (_, role) => getHomePath(role),
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// getParentPath — pure function, works everywhere
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the canonical parent path for the given pathname + role.
 *
 * @param pathname  - e.g. '/dashboard/invoice/abc123/edit'
 * @param role      - 'zzper' | 'accountant'
 * @param search    - optional URLSearchParams (for query-param-aware rules)
 * @returns parent path string — safe to use in <Link href={...}>
 *
 * @example
 * getParentPath('/dashboard/invoice/abc/edit', 'zzper')
 * // → '/dashboard/invoice/abc'
 *
 * getParentPath('/dashboard/invoice/new', 'accountant',
 *   new URLSearchParams('clientId=xyz'))
 * // → '/dashboard/clients/xyz'
 *
 * getParentPath('/dashboard/facturen', 'zzper')
 * // → '/dashboard'
 *
 * getParentPath('/dashboard/facturen', 'accountant')
 * // → '/dashboard/accountant'
 */
export function getParentPath(
  pathname: string,
  role: Role,
  search?: URLSearchParams | null
): string {
  for (const rule of PARENT_RULES) {
    if (rule.match.test(pathname)) {
      return rule.parent(pathname, role, search)
    }
  }
  // Safe fallback — unknown path → home
  return getHomePath(role)
}

// ─────────────────────────────────────────────────────────────────────────────
// React hooks — 'use client' only
// These depend on next/navigation and cannot run in server components.
// Import from this same file — the directive is scoped to the exports below
// via a re-export pattern. In practice: put these in a separate file if your
// bundler complains about mixing server/client. The pure functions above
// remain importable in both environments either way.
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: If you encounter "useState/useEffect only in client components" errors,
// move the two functions below to: src/lib/navigation-hooks.ts
// and add 'use client' at the top of that file.
// The pure functions above (getHomePath, getParentPath) stay in this file.

