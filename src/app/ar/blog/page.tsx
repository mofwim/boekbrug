// src/app/ar/blog/page.tsx
// [BLOG] Arabic blog index (/ar/blog). SSG from published AR posts. Serves the
// large Arabic-speaking freelancer community in the Netherlands.

import type { Metadata } from 'next'
import BlogIndex from '@/components/blog/BlogIndex'
import { getPublishedPosts, indexPath, articlePath } from '@/lib/blog'
import { absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'المدوّنة — معرفة ونصائح لأصحاب العمل الحر | BoekBrug',
  description:
    'أدلّة بلغة بسيطة لأصحاب العمل الحر (ZZP) في هولندا: الضرائب وصافي الدخل والفواتير والإدارة — مع أدوات مجانية لتفعلها بنفسك.',
  keywords: ['zzp بالعربية', 'ضرائب هولندا العمل الحر', 'فاتورة هولندا', 'المستقل في هولندا'],
  alternates: {
    canonical: indexPath('ar'),
    languages: {
      'nl-NL': indexPath('nl'),
      'en-GB': indexPath('en'),
      ar: indexPath('ar'),
      'tr-TR': indexPath('tr'),
    },
  },
  openGraph: {
    title: 'مدوّنة BoekBrug — معرفة ونصائح لأصحاب العمل الحر',
    description: 'الضرائب وصافي الدخل والفواتير والإدارة — مشروحة لأصحاب العمل الحر في هولندا.',
    type: 'website',
    locale: 'ar_AR',
    url: absoluteUrl(indexPath('ar')),
  },
}

export default function BlogIndexPageAR() {
  const posts = getPublishedPosts('ar')

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'BoekBrug Blog',
    url: absoluteUrl(indexPath('ar')),
    inLanguage: 'ar',
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.frontmatter.title,
      datePublished: p.frontmatter.publishedAt,
      url: absoluteUrl(articlePath('ar', p.frontmatter.slug)),
    })),
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <BlogIndex posts={posts} locale="ar" />
    </>
  )
}
