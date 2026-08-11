'use client'

// src/lib/i18n/use-locale.ts
// [TAAL] Where the owner's language comes from, and where it is kept.
//
// A COOKIE, and deliberately not a profiles column. Three reasons, in order of weight:
//
//   1. It works before there is a session. The language a screen renders in cannot depend on a
//      database round-trip that has not happened yet, or the first paint is always Dutch and then
//      flips — which is worse than staying Dutch.
//   2. It is not business data. A column on profiles is something the accountant's view, the
//      exports and the RLS policies all have to have an opinion about. A display preference does
//      not belong in the ledger.
//   3. It costs no migration, and this app has 92 unnumbered migrations already.
//
// If the preference ever needs to follow an owner across devices, this file is the one place that
// changes — every screen asks it, nothing reads the cookie directly.
//
// WHY NOT navigator.language. An Arab shop owner's phone very often IS set to Arabic, so guessing
// from it would translate the app for exactly the right people with no effort at all. It is still
// wrong today: the translation is partial, and a screen that is half Arabic and half Dutch WITHOUT
// having been asked for is harder to use than one honest language. When the surface is covered,
// this is the file that decides to start guessing — and the guess belongs behind an explicit
// "we noticed your device is in Arabic" prompt, not behind silence.

import { useSyncExternalStore } from 'react'

import { DEFAULT_LOCALE, isLocale, LOCALE_META, type Locale } from './locale'

export const LOCALE_COOKIE = 'boekbrug_taal'

/** One year. A language choice is not a session. */
const MAX_AGE = 60 * 60 * 24 * 365

/** The stored choice, or the default. Safe to call on the server (there is no document there). */
export function readLocaleCookie(cookieHeader?: string | null): Locale {
  const raw = cookieHeader ?? (typeof document === 'undefined' ? '' : document.cookie)
  const hit = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${LOCALE_COOKIE}=`))
  const value = hit ? decodeURIComponent(hit.slice(LOCALE_COOKIE.length + 1)) : null
  return isLocale(value) ? value : DEFAULT_LOCALE
}

// The cookie is external mutable state, so React has an API for exactly this — see useLocale.
// Every reader subscribes here, and writeLocaleCookie is the only thing that fires it, so a switch
// in Instellingen updates every open screen without a reload and without a second source of truth.
const listeners = new Set<() => void>()

/** Store the choice and tell the document, so the browser lays out and announces it correctly. */
export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=${MAX_AGE}; SameSite=Lax`
  // The <html> attributes are what a screen reader announces in and what the browser lays out by.
  // Setting them here keeps the DOM honest without a full reload.
  document.documentElement.lang = locale
  document.documentElement.dir = LOCALE_META[locale].dir
  for (const notify of listeners) notify()
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

/**
 * The owner's language, in a client component.
 *
 * useSyncExternalStore and not useState-in-an-effect, and the difference is not style. A cookie IS
 * external mutable state, and this is the API React provides for reading it without tearing: the
 * server snapshot is Dutch (which is what the HTML says, so hydration matches), the client
 * snapshot is the cookie, and a write re-renders every subscriber at once.
 *
 * The effect version was written first and eslint refused it — "calling setState synchronously
 * within an effect can trigger cascading renders". That rule was right about more than renders:
 * with two screens open on the same preference, the state version would have had two copies of
 * the answer and no way to keep them in step.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => readLocaleCookie(), () => DEFAULT_LOCALE)
}
