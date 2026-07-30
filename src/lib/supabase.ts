import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// [BUILD-NO-SECRETS] The browser client, built on FIRST USE and never during render.
//
// createBrowserClient THROWS when the two NEXT_PUBLIC_ keys are absent. That is correct — a
// missing key is a real misconfiguration and must not be swallowed. What was wrong is WHERE it
// threw: several `'use client'` pages called createClient() straight in the component body, and
// Next still prerenders those pages during `next build`. So the build itself constructed a
// Supabase client, and without the keys the whole export died on a password page that needs
// Supabase only in a browser, after a click.
//
// The cost of that was not cosmetic: `next build` could not run in CI or on a clean checkout, and
// one missing variable turned a config mistake into a deploy that never shipped — with a stack
// trace pointing at a page unrelated to the actual problem.
//
// Call this inside an effect, a handler, or any other browser-only path. The instance is cached
// per tab, so calling it on every click costs nothing. A missing key now surfaces at RUNTIME,
// where /api/health already names it and says what breaks.
//
// RULE for new pages: never `const supabase = createClient()` in the body of a client component.
let browserClient: ReturnType<typeof createClient> | null = null
export function getBrowserClient() {
  if (!browserClient) browserClient = createClient()
  return browserClient
}
