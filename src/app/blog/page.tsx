// src/app/blog/page.tsx
// [BLOG] Dutch blog index (default locale — no /nl/ prefix). Statically
// generated: reads the published NL posts from disk at build time.

import type { Metadata } from 'next'
import BlogIndex from '@/components/blog/BlogIndex'
import { getPublishedPosts, indexPath, articlePath } from '@/lib/blog'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Blog — kennis en tips voor ZZP’ers | BoekBrug',
  description:
    'Praktische uitleg voor ZZP’ers: belasting, netto inkomen, facturen en administratie. In gewone taal, met gratis tools om het zelf te doen.',
  keywords: ['zzp blog', 'zzp belasting uitleg', 'zzp tips', 'freelancer administratie'],
  alternates: {
    canonical: indexPath('nl'),
    languages: { 'nl-NL': indexPath('nl'), 'en-GB': indexPath('en') },
  },
  openGraph: {
    title: 'BoekBrug Blog — kennis en tips voor ZZP’ers',
    description: 'Belasting, netto inkomen, facturen en administratie — uitgelegd voor ZZP’ers.',
    type: 'website',
    locale: 'nl_NL',
    url: absoluteUrl(indexPath('nl')),
  },
}

export default function BlogIndexPageNL() {
  const posts = getPublishedPosts('nl')

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'BoekBrug Blog',
    url: absoluteUrl(indexPath('nl')),
    inLanguage: 'nl-NL',
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.frontmatter.title,
      datePublished: p.frontmatter.publishedAt,
      url: absoluteUrl(articlePath('nl', p.frontmatter.slug)),
    })),
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <BlogIndex posts={posts} locale="nl" />
    </>
  )
}
