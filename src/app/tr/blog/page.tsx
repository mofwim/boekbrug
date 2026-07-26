// src/app/tr/blog/page.tsx
// [BLOG] Turkish blog index (/tr/blog). SSG from published TR posts. Serves the
// large Turkish-speaking freelancer community in the Netherlands.

import type { Metadata } from 'next'
import BlogIndex from '@/components/blog/BlogIndex'
import { getPublishedPosts, indexPath, articlePath } from '@/lib/blog'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Blog — serbest çalışanlar için bilgi ve ipuçları | BoekBrug',
  description:
    'Hollanda’daki serbest çalışanlar (ZZP) için sade dilde rehberler: vergi, net gelir, faturalar ve idari işler — kendiniz yapmanız için ücretsiz araçlarla.',
  keywords: ['zzp türkçe', 'hollanda serbest meslek vergi', 'hollanda fatura', 'hollanda serbest çalışan'],
  alternates: {
    canonical: indexPath('tr'),
    languages: {
      'nl-NL': indexPath('nl'),
      'en-GB': indexPath('en'),
      ar: indexPath('ar'),
      'tr-TR': indexPath('tr'),
    },
  },
  openGraph: {
    title: 'BoekBrug Blog — serbest çalışanlar için bilgi ve ipuçları',
    description: 'Vergi, net gelir, faturalar ve idari işler — Hollanda’daki serbest çalışanlar için açıklandı.',
    type: 'website',
    locale: 'tr_TR',
    url: absoluteUrl(indexPath('tr')),
  },
}

export default function BlogIndexPageTR() {
  const posts = getPublishedPosts('tr')

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'BoekBrug Blog',
    url: absoluteUrl(indexPath('tr')),
    inLanguage: 'tr-TR',
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.frontmatter.title,
      datePublished: p.frontmatter.publishedAt,
      url: absoluteUrl(articlePath('tr', p.frontmatter.slug)),
    })),
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <BlogIndex posts={posts} locale="tr" />
    </>
  )
}
