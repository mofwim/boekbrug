// src/components/nav/PageTransition.tsx
// [INSTANT] Wraps the dashboard's page content so the browser animates BETWEEN
// two screens instead of cutting from one to the other.
//
// Before this, every navigation in the app was a hard swap: the old screen
// disappeared and the new one appeared, with nothing to say where it came from.
// Combined with force-dynamic routes (the old page just sat there, frozen,
// until the server answered) that is most of why the app read as abrupt.
//
// How the direction is decided:
//   · A link tagged transitionTypes={['nav-back']} slides the content right —
//     you are returning. The shared back button (components/nav/SubPageHeader)
//     and the shared BackLink both set it, which covers every "Terug" in the
//     app, since those are the single source of truth for going back.
//   · Everything else slides left: in a hierarchy, an untagged navigation is
//     almost always a step deeper.
//   · `default="none"` keeps the very first page load still. Without it the
//     whole app would slide in on arrival, which reads as a glitch rather than
//     as motion with meaning.
//
// The CSS for .nav-forward / .nav-back lives in src/app/globals.css under
// "View transitions", together with the reduced-motion reset. Enabled by
// experimental.viewTransition in next.config.ts. Where the browser lacks the
// View Transitions API this component is inert and navigation just happens.

// The component and its prop types ship in React's canary type surface, which
// this project does not reference globally; the directive below pulls them in
// for this file only, so nothing else in the codebase gains canary typings.
/// <reference types="react/canary" />

'use client'

import { ViewTransition } from 'react'
import type { ReactNode } from 'react'

const DIRECTION = {
  'nav-back': 'nav-back',
  default: 'nav-forward',
} as const

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter={DIRECTION} exit={DIRECTION} default="none">
      {children}
    </ViewTransition>
  )
}
