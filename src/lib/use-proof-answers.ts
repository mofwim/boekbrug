'use client'

// src/lib/use-proof-answers.ts
// [BEWIJS-BEANTWOORDEN] The proof panel's answers, held for a screen.
//
// Two screens show that panel — the sales list and the purchase list — and they ask the same
// question of opposite money. One hook, so the two cannot drift into different ideas of what
// "answered" means. The rules and the storage format live in open-invoice-proof-ack.ts; this is
// only the React shape around them.
//
// ── useSyncExternalStore, NOT useState-in-an-effect ──
//
// The same choice use-locale.ts makes, for the same reason and after the same refusal from eslint
// ("calling setState synchronously within an effect can trigger cascading renders"). localStorage
// IS external mutable state, and this is the API React provides for reading it without tearing:
//
//   · the SERVER snapshot is an empty set — which matches the HTML the server sent, so hydration
//     does not mismatch, and the first paint shows every question. That is the safe direction: the
//     failure mode is a question asked once more rather than a warning about money never shown.
//   · the CLIENT snapshot is what storage says, cached so the reference is stable — an unstable
//     snapshot makes useSyncExternalStore re-render forever.
//   · a write re-renders every subscriber at once, so the two panels a screen can hold agree
//     without either of them owning the answer.

import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { acknowledge, forgetAcks, readAcks } from './open-invoice-proof-ack'

/** The browser's storage, or null where there is none (the server, a locked-down browser). */
function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

/**
 * The cached snapshot.
 *
 * Not an optimisation: useSyncExternalStore compares snapshots by IDENTITY, so returning a freshly
 * built Set on every call is an infinite render loop. The cache is invalidated by the two writers
 * below and by nothing else.
 */
let cached: ReadonlySet<string> | null = null
const listeners = new Set<() => void>()

/** What the server renders with. One shared instance, for the identity reason above. */
const EMPTY: ReadonlySet<string> = new Set<string>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

function snapshot(): ReadonlySet<string> {
  if (cached === null) cached = readAcks(storage())
  return cached
}

function publish(next: ReadonlySet<string>): void {
  cached = next
  for (const notify of listeners) notify()
}

export interface ProofAnswers {
  /** The questions already answered. Pass to buildProofPanel; it filters before it writes a word. */
  answered: ReadonlySet<string>
  actions: { onAnswer: (ackKey: string) => void; onShowAgain: () => void }
}

export function useProofAnswers(): ProofAnswers {
  const answered = useSyncExternalStore(subscribe, snapshot, () => EMPTY)

  const onAnswer = useCallback((ackKey: string) => {
    if (!ackKey) return
    publish(acknowledge(storage(), ackKey))
  }, [])

  const onShowAgain = useCallback(() => {
    publish(forgetAcks(storage()))
  }, [])

  // Stable across renders: this goes into a prop on a component that would otherwise re-render for
  // no reason on every keystroke in the search box above it.
  const actions = useMemo(() => ({ onAnswer, onShowAgain }), [onAnswer, onShowAgain])
  return { answered, actions }
}

/** Test seam: forget the cached snapshot, the way a fresh page load would. */
export function __resetProofAnswersCache(): void {
  cached = null
}
