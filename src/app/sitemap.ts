// src/app/sitemap.ts
// [SEO] Programmatic sitemap covering the public, indexable pages: the tools
// hub, every lead-gen tool, and the marketing entry points. Dashboard, API,
// auth and onboarding are intentionally excluded (they're gated / non-indexable).

import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'
import { TOOLS } from '@/lib/tools'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/tools`, lastModified, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/register`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/login`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ]

  const toolPages: MetadataRoute.Sitemap = TOOLS.map((t) => ({
    url: `${SITE_URL}${t.slug}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: t.priority,
  }))

  return [...staticPages, ...toolPages]
}
