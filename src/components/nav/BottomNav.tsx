// src/components/nav/BottomNav.tsx
// [MOBILE] The phone-only navigation bar.
//
// Until now a phone had no global navigation at all. The top bar's text links
// are hidden below 640px (globals.css, .dash-nav-links) because they collided
// with the search box — a sensible fix on its own, but nothing took their place.
// So on the device most of these users actually hold, the only ways to move
// around the app were the logo, the browser's back button, and whatever tiles
// the home screen happened to show. Every journey had to start by going home.
//
// This is the Material 3 navigation bar: four destinations per role, an active
// pill behind the current one, icon plus label. Four and not six on purpose —
// M3 allows up to five, and past that the labels stop fitting on a 320px screen
// and the bar stops being scannable. Everything else stays reachable from the
// home tiles, which is what they are for.
//
// It appears ONLY below 640px (see .bottom-nav in globals.css) — exactly the
// width at which the top-bar links disappear, so the two never both hide or
// both show. --bottom-nav-h carries its height to everything anchored to the
// bottom edge (FABs, action bars, the snackbar) so nothing ends up underneath
// it; that variable is 0px on a wide screen, which makes those offsets correct
// on both without a second rule.

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import type { MessageKey } from '@/lib/i18n/messages'
import { M3, FONT } from '@/lib/design/tokens'
import type { Role } from '@/lib/navigation'

type Destination = {
  href: string
  label: MessageKey
  icon: string
  /** Extra paths that should light this tab up (children of the destination). */
  also?: string[]
  /**
   * Match this destination on the exact path only, never on its descendants.
   * Set on the home tab: `/dashboard` is a prefix of EVERY dashboard route, so
   * without this it claimed all of them — standing on Kas, Waarheid, Berichten
   * or Instellingen lit up "Start", which tells the user they are somewhere they
   * are not. A tab bar that misreports your position is worse than one that
   * admits it does not cover this screen.
   */
  exact?: boolean
}

// Chosen from what each role's home screen puts first, so the bar shortcuts the
// journeys people already take rather than inventing a new hierarchy.
// [TAAL] `label` is a catalogue KEY, not a word. The bar is on every screen, so it is the first
// thing an owner reads in their own language — and the sentence in the send confirmation fills
// itself from nav.invoices, so the two can never name the tab differently.
const OWNER: Destination[] = [
  { href: '/dashboard', label: 'nav.start', icon: 'home', exact: true },
  { href: '/dashboard/facturen', label: 'nav.invoices', icon: 'receipt_long', also: ['/dashboard/invoice'] },
  { href: '/dashboard/incoming', label: 'nav.incoming', icon: 'inbox', also: ['/dashboard/upload'] },
  { href: '/dashboard/bestanden', label: 'nav.files', icon: 'folder_open' },
]

const ACCOUNTANT: Destination[] = [
  { href: '/dashboard/accountant', label: 'nav.start', icon: 'home', exact: true },
  { href: '/dashboard/clients/beheer', label: 'nav.clients', icon: 'people', also: ['/dashboard/clients'] },
  { href: '/dashboard/quarterly', label: 'nav.quarter', icon: 'bar_chart' },
  { href: '/dashboard/bestanden', label: 'nav.files', icon: 'folder_open' },
]

/**
 * Which tab owns this path. Longest match wins, so /dashboard/facturen beats a
 * shorter prefix instead of both lighting up.
 *
 * Returns null when the current screen belongs to no destination — Kas, Brug,
 * Waarheid, Instellingen and the rest are reached from the home tiles, not from
 * this bar. Nothing lit is the honest answer there; see `exact` above for the
 * bug that made "Start" claim them all.
 */
function activeHref(pathname: string, items: Destination[]): string | null {
  let best: { href: string; len: number } | null = null
  for (const item of items) {
    for (const prefix of [item.href, ...(item.also ?? [])]) {
      const hit = item.exact
        ? pathname === prefix
        : pathname === prefix || pathname.startsWith(prefix + '/')
      if (hit && (!best || prefix.length > best.len)) best = { href: item.href, len: prefix.length }
    }
  }
  return best?.href ?? null
}

export function BottomNav({ role }: { role: Role | null }) {
  const pathname = usePathname()
  // Before the early return: a hook may not sit behind a condition.
  const taal = useLocale()
  if (!pathname) return null

  const t = translator(taal)
  const items = role === 'accountant' ? ACCOUNTANT : OWNER
  const active = activeHref(pathname, items)

  return (
    <nav
      className="bottom-nav"
      aria-label={t('nav.aria')}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        // Sits above page content and FABs, below the snackbar and dialogs so a
        // confirmation is never hidden by the bar that caused it.
        zIndex: 2000,
        background: M3.surface,
        borderTop: `1px solid ${M3.outlineVariant}`,
        // The bar keeps its own 64px and adds the home-indicator inset below it,
        // so the row of icons never slides into the gesture area.
        height: 'calc(64px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
        // NB: `display` is NOT set here. It lives on .bottom-nav in globals.css,
        // which is what hides the bar above 640px — and an inline declaration
        // outranks a class rule, so setting it here made the bar visible on
        // desktop no matter what the media query said. (Verified: the bar showed
        // at 1280px while --bottom-nav-h had correctly collapsed to 0.)
        alignItems: 'stretch',
        fontFamily: FONT,
      }}
    >
      {items.map((item) => {
        const isActive = active === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className="bottom-nav-item pressable"
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              textDecoration: 'none',
              // The whole 64px column is the target, which is well past the
              // 44px minimum — a nav bar is not a place to aim carefully.
              padding: '6px 2px',
            }}
          >
            {/* The M3 active indicator: a pill behind the icon, not a colour
                change alone. Colour on its own is not a reliable signal — it is
                invisible to a red-green colourblind user and washes out in
                sunlight, which is where a phone usually is. */}
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 56,
                height: 30,
                borderRadius: 999,
                background: isActive ? M3.primaryContainer : 'transparent',
                transition: 'background var(--dur-fast) var(--ease-standard)',
              }}
            >
              <span
                className="material-symbols-outlined"
                aria-hidden
                style={{
                  fontSize: 22,
                  color: isActive ? M3.onPrimaryContainer : M3.onSurfaceVariant,
                  fontVariationSettings: isActive
                    ? "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24"
                    : undefined,
                }}
              >
                {item.icon}
              </span>
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? M3.onPrimaryContainer : M3.onSurfaceVariant,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
              }}
            >
              {t(item.label)}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
