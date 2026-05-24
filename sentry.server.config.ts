// [BOEK-SENTRY] sentry.server.config.ts
// Node.js server-side Sentry initialization

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_APP_VERSION ?? '1.2.0',

  // [BOEK-SENTRY] Server: capture all traces — no user cost
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  // [BOEK-SENTRY] Strip sensitive data from server errors
  beforeSend(event) {
    // Remove Supabase service role key if it ever leaks into an error
    if (event.extra) {
      const extra = event.extra as Record<string, unknown>
      delete extra.supabaseKey
      delete extra.serviceRoleKey
      delete extra.SUPABASE_SERVICE_ROLE_KEY
    }

    // Strip Authorization headers
    if (event.request?.headers) {
      const headers = event.request.headers as Record<string, string>
      delete headers['authorization']
      delete headers['Authorization']
      delete headers['cookie']
    }

    return event
  },

  // [BOEK-SENTRY] Tag every server error with pipeline stage if available
  initialScope: {
    tags: {
      component: 'server',
      app: 'boekbrug',
    },
  },
})