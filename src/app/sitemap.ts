// src/app/sitemap.ts
// [SEO] Programmatic sitemap covering the public, indexable pages: the tools
// hub, every lead-gen tool, and the marketing entry points. Dashboard, API,
// auth and onboarding are intentionally excluded (they're gated / non-indexable).

import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'
import { TOOLS } from '@/lib/tools'
import { LOCALES, getPublishedPosts, articlePath } from '@/lib/blog'
import { donationConfig } from '@/lib/donation'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/tools`, lastModified, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/blog`, lastModified, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/en/blog`, lastModified, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${SITE_URL}/ar/blog`, lastModified, changeFrequency: 'weekly', priority: 0.4 },
    { url: `${SITE_URL}/tr/blog`, lastModified, changeFrequency: 'weekly', priority: 0.4 },
    { url: `${SITE_URL}/register`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/prijzen`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/en/prijzen`, lastModified, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/ar/prijzen`, lastModified, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/tr/prijzen`, lastModified, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/bewaarplicht`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/eerlijk-gebruik`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/voorwaarden`, lastModified, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/cookies`, lastModified, changeFrequency: 'yearly', priority: 0.2 },
  ]

  // /steun bestaat alleen met een geconfigureerde rechtspersoon én betaallink; anders geeft
  // de route een 404 en hoort hij niet in de sitemap.
  if (donationConfig().enabled) {
    staticPages.push({
      url: `${SITE_URL}/steun`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.3,
    })
  }

  const toolPages: MetadataRoute.Sitemap = TOOLS.map((t) => ({
    url: `${SITE_URL}${t.slug}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: t.priority,
  }))

  // [EN-TOOLS] English versions of the calculators (listed here as they ship),
  // targeting expat / English search demand. Priority 0.6 — below the primary
  // Dutch tools but indexable.
  const EN_TOOL_PATHS = [
    '/en/btw-berekenen',
    '/en/netto-inkomen-zzp',
    '/en/uurtarief-berekenen',
    '/en/kilometervergoeding',
    '/en/btw-aangifte-berekenen',
  ]
  const enToolPages: MetadataRoute.Sitemap = EN_TOOL_PATHS.map((slug) => ({
    url: `${SITE_URL}${slug}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.6,
  }))

  // [BLOG] Every published article, in both locales. NL is primary (0.7); EN
  // serves expats (0.5). Uses the article's updatedAt/publishedAt as lastmod so
  // crawlers see genuine freshness.
  const blogPages: MetadataRoute.Sitemap = LOCALES.flatMap((locale) =>
    getPublishedPosts(locale).map((post) => ({
      url: `${SITE_URL}${articlePath(locale, post.frontmatter.slug)}`,
      lastModified: new Date(post.frontmatter.updatedAt || post.frontmatter.publishedAt || lastModified),
      changeFrequency: 'monthly' as const,
      priority: locale === 'nl' ? 0.7 : 0.5,
    })),
  )

  return [...staticPages, ...toolPages, ...enToolPages, ...blogPages]
}
