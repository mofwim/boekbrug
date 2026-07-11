// src/app/robots.ts
// [SEO] Robots policy: let crawlers index the public marketing + tool pages,
// keep them out of the authenticated app, API and auth flows. Points to the
// sitemap so search engines discover every tool.

import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard/', '/onboarding', '/api/', '/pay/', '/invite/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
