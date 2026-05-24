// [BOEK-SENTRY] src/lib/sentry-user.ts
// Call this once after auth resolves — sets user context for all future errors
// ⚠️ Only id + email — never tokens, KvK, BTW, IBAN

import * as Sentry from '@sentry/nextjs'

interface SentryUserProfile {
  id: string
  email?: string | null
  role?: string | null
}

export function setSentryUser(profile: SentryUserProfile | null) {
  if (!profile) {
    Sentry.setUser(null)
    return
  }

  Sentry.setUser({
    id: profile.id,
    email: profile.email ?? undefined,
  })

  // Role tag helps filter: ZZP bugs vs accountant bugs
  Sentry.setTag('user_role', profile.role ?? 'unknown')
}

export function clearSentryUser() {
  Sentry.setUser(null)
  Sentry.setTag('user_role', null)
}

// [BOEK-SENTRY] Wrap AI pipeline calls with Sentry context
export function withSentryPipelineContext<T>(
  stage: string,
  documentId: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  return Sentry.withScope(async (scope) => {
    scope.setTag('pipeline_stage', stage)
    if (documentId) scope.setTag('document_id', documentId)
    return fn()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// USAGE IN layout.tsx (client component or context provider):
// ─────────────────────────────────────────────────────────────────────────────
//
// import { setSentryUser } from '@/lib/sentry-user'
//
// useEffect(() => {
//   if (profile) {
//     setSentryUser({ id: profile.id, email: profile.email, role: profile.role })
//   }
//   return () => clearSentryUser()
// }, [profile])
//
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// next.config.ts PATCH — add withSentryConfig wrapper:
// ─────────────────────────────────────────────────────────────────────────────
//
// import { withSentryConfig } from '@sentry/nextjs'
//
// const nextConfig: NextConfig = {
//   // ... your existing config
// }
//
// export default withSentryConfig(nextConfig, {
//   org: 'boekbrug',            // ← your Sentry org slug
//   project: 'boekbrug',        // ← your Sentry project name
//
//   // Upload source maps — errors show original TS lines, not compiled JS
//   silent: !process.env.CI,
//   widenClientFileUpload: true,
//   hideSourceMaps: true,        // don't expose source maps in production bundle
//
//   disableLogger: true,         // remove Sentry SDK logging from bundle
//   automaticVercelMonitors: true,
// })
//
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// .env.local additions (copy to Vercel → Settings → Environment Variables):
// ─────────────────────────────────────────────────────────────────────────────
//
// NEXT_PUBLIC_SENTRY_DSN=https://xxxx@oXXX.ingest.sentry.io/XXXXXX
// SENTRY_ORG=boekbrug
// SENTRY_PROJECT=boekbrug
// SENTRY_AUTH_TOKEN=sntrys_...   ← from Sentry → Settings → Auth Tokens
// NEXT_PUBLIC_APP_VERSION=1.2.0
//
// ─────────────────────────────────────────────────────────────────────────────