// src/components/nav/DashboardRail.tsx
// [ZIJBALK] The desktop navigation rail — the counterpart to BottomNav, at the other end of the
// width range.
//
// ── WHY THIS EXISTS ──
//
// The phone has real navigation: four role-aware destinations, translated labels, an active pill.
// The desktop had ONE text link — "Vandaag" for an owner, "Klanten" for an accountant — and
// nothing else. Every other journey on a wide screen started by going home and reading the tiles.
// So the device with the most room had the least navigation, which is backwards.
//
// It renders the SAME destinations as the phone bar, from the same module. Two bars reading two
// lists is how they drift: one gains a destination the other never hears about, and the app
// quietly means different things depending on the width of the screen.
//
// ── WHY THE COLUMN DOES NOT GET WIDER ──
//
// The rail eats the empty margin; it does not widen the content. tokens.ts measured why, and the
// reason is about money rather than taste: "in a money list the label sits left and the amount
// right; the wider the row, the further the eye travels between them and the easier it is to read
// the amount off the wrong line". COLUMN.work stays 680. The rail takes space that was empty.
//
// ── WHAT IT DELIBERATELY DOES NOT COVER ──
//
// Between 641px and 1023px there is still only the header's one text link: the phone bar is gone
// (it hides above 640px) and the rail has not appeared. A 240px rail plus a 680px column needs
// 920px before any breathing room, so showing it earlier would push the money column off-centre or
// squeeze it below the width its own densest row was measured at. That band is unchanged from
// today, and saying so here is cheaper than someone rediscovering it as a bug.

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { M3, FONT } from '@/lib/design/tokens'
import type { Role } from '@/lib/navigation'
import { destinationsFor, activeHref } from '@/lib/nav-destinations'

export function DashboardRail({ role, counter = false }: { role: Role | null; counter?: boolean }) {
  const pathname = usePathname()
  // Before the early return: a hook may not sit behind a condition.
  const taal = useLocale()
  if (!pathname) return null

  const t = translator(taal)
  const items = destinationsFor(role, counter)
  const active = activeHref(pathname, items)

  return (
    <nav
      className="dash-rail"
      aria-label={t('nav.aria')}
      style={{
        position: 'fixed',
        // [RTL] Logical, not `left`. In Arabic the rail belongs on the right, and a physical side
        // is wrong in exactly one language — the one nobody checks.
        insetInlineStart: 0,
        top: 0,
        bottom: 0,
        width: 'var(--rail-w)',
        boxSizing: 'border-box',
        // Under the sub-page header's sticky bar (z 50) would hide the rail behind it; above the
        // bottom bar's 2000 would put it over dialogs. It sits between: visible on its own screen,
        // never over a confirmation.
        zIndex: 100,
        background: M3.surface,
        borderInlineEnd: `1px solid ${M3.outlineVariant}`,
        paddingTop: 'calc(12px + env(safe-area-inset-top))',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
        // NB: `display` is NOT set here. It lives on .dash-rail in globals.css, which is what hides
        // the rail below 1024px — and an inline declaration outranks a class rule. BottomNav
        // carries the same note for the same reason, after the bar once showed at 1280px.
        flexDirection: 'column',
        gap: 4,
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
            className="dash-rail-item pressable"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              // Logical padding: in Arabic the icon leads from the right.
              padding: '10px 14px',
              marginInline: 8,
              borderRadius: 999,
              textDecoration: 'none',
              // The M3 active indicator is the pill itself here, not a colour change alone:
              // colour on its own is invisible to a red-green colourblind reader.
              background: isActive ? M3.primaryContainer : 'transparent',
              transition: 'background var(--dur-fast) var(--ease-standard)',
              // Well past the 44px minimum — a nav rail is not a place to aim carefully.
              minHeight: 44,
            }}
          >
            <span
              className="material-symbols-outlined"
              aria-hidden
              style={{
                fontSize: 22,
                flexShrink: 0,
                color: isActive ? M3.onPrimaryContainer : M3.onSurfaceVariant,
                fontVariationSettings: isActive
                  ? "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24"
                  : undefined,
              }}
            >
              {item.icon}
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? M3.onPrimaryContainer : M3.onSurfaceVariant,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                // [RTL] The words run from the start of the writing direction, whichever that is.
                textAlign: 'start',
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
