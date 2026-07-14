// src/app/en/blog/page.tsx
// [BLOG] English blog index (/en/blog). Statically generated from the published
// EN posts. English serves expats; Dutch remains the primary market.

import type { Metadata } from 'next'
import BlogIndex from '@/components/blog/BlogIndex'
import { getPublishedPosts, indexPath, articlePath } from '@/lib/blog'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Blog — knowledge and tips for freelancers | BoekBrug',
  description:
    'Plain-language guides for freelancers (ZZP) in the Netherlands: tax, net income, invoices and admin — with free tools to do it yourself.',
  keywords: ['zzp blog english', 'freelancer netherlands tax', 'zzp tips', 'dutch freelance admin'],
  alternates: {
    canonical: indexPath('en'),
    languages: { 'nl-NL': indexPath('nl'), 'en-GB': indexPath('en') },
  },
  openGraph: {
    title: 'BoekBrug Blog — knowledge and tips for freelancers',
    description: 'Tax, net income, invoices and admin — explained for freelancers in the Netherlands.',
    type: 'website',
    locale: 'en_GB',
    url: absoluteUrl(indexPath('en')),
  },
}

export default function BlogIndexPageEN() {
  const posts = getPublishedPosts('en')

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'BoekBrug Blog',
    url: absoluteUrl(indexPath('en')),
    inLanguage: 'en-GB',
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.frontmatter.title,
      datePublished: p.frontmatter.publishedAt,
      url: absoluteUrl(articlePath('en', p.frontmatter.slug)),
    })),
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <BlogIndex posts={posts} locale="en" />
    </>
  )
}
