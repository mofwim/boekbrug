// src/lib/i18n/server.ts
// [TAAL] The server half of the translator: for async server components.
//
// The client half (use-locale.ts) reads document.cookie; a server component has no document, it
// has the request. cookies() from next/headers opts the route into dynamic rendering — which is
// exactly why the ROOT LAYOUT must never use this file (it would drag all 53 static Arabic blog
// pages with it; see locale-boot.ts). A dashboard page is different: it is behind auth and
// fetches per-request data, so it is dynamic already and this costs nothing new.
//
// Server-only: importing next/headers from a client component is a build error, which is the
// guardrail — the two halves cannot be mixed up silently.

import { cookies } from 'next/headers'

import { resolveLocale, type Locale } from './locale'
import { LOCALE_COOKIE } from './use-locale'
import { translator, type Translator } from './t'

/** The owner's language, read from the request. Dutch when they never chose one. */
export async function getServerLocale(): Promise<Locale> {
  const jar = await cookies()
  return resolveLocale(jar.get(LOCALE_COOKIE)?.value)
}

/** A bound translator for an async server component. Same cache, same fallback rules. */
export async function serverTranslator(): Promise<Translator> {
  return translator(await getServerLocale())
}
