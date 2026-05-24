// [BOEK-SENTRY] sentry.edge.config.ts
// Edge runtime (middleware) Sentry initialization
// Note: Edge has limited APIs — keep this minimal

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_APP_VERSION ?? '1.2.0',

  // [BOEK-SENTRY] Edge: low sample rate — middleware runs on every request
  tracesSampleRate: 0.05,

  // [BOEK-SENTRY] Tag edge errors — useful to separate from server/client
  initialScope: {
    tags: {
      component: 'edge',
      app: 'boekbrug',
    },
  },
})