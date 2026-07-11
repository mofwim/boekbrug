// src/lib/site.ts
// [SEO] Canonical absolute site URL, used by metadataBase, sitemap and robots.
// Falls back to the production domain when NEXT_PUBLIC_BASE_URL is unset (e.g.
// during a placeholder build). No trailing slash.

export const SITE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://boekbrug.nl').replace(/\/+$/, '')

export const absoluteUrl = (path: string): string =>
  `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
