// [BOEK-SENTRY] sentry.client.config.ts
// Browser-side Sentry initialization
// ⚠️ Never send: tokens, passwords, KvK/BTW numbers

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment tagging
  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_APP_VERSION ?? '1.2.0',

  // [BOEK-SENTRY] Capture rate — start low, raise after stable
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Replay — record session on error (5% normal, 100% on error)
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      // [BOEK-SENTRY] Mask all inputs — GDPR / AVG compliance
      maskAllInputs: true,
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],

  // [BOEK-SENTRY] Filter noise before sending to Sentry
  beforeSend(event, hint) {
    const errorMessage =
      event.exception?.values?.[0]?.value ?? ''

    // ResizeObserver — browser quirk, not a real error
    if (errorMessage.includes('ResizeObserver loop')) return null

    // Ad blocker / network errors — not actionable
    if (errorMessage.includes('NetworkError')) return null
    if (errorMessage.includes('Failed to fetch')) return null
    if (errorMessage.includes('Load failed')) return null

    // Hydration warnings — known Next.js noise
    if (errorMessage.includes('Hydration failed')) return null

    // [BOEK-SENTRY] Strip any accidentally-captured sensitive fields
    if (event.request?.data) {
      const data = event.request.data as Record<string, unknown>
      delete data.password
      delete data.access_token
      delete data.refresh_token
      delete data.kvk_number
      delete data.btw_number
      delete data.iban
    }

    return event
  },

  // [BOEK-SENTRY] Ignore common non-issues
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'Non-Error promise rejection captured',
    /^No error$/,
    /Loading chunk \d+ failed/,
    /Loading CSS chunk \d+ failed/,
  ],
})