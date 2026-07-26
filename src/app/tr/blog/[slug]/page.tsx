// src/app/tr/blog/[slug]/page.tsx
// [BLOG] Turkish article page (/tr/blog/[slug]). SSG over published TR slugs.
// Same SEO stack as the other locales.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import ArticleLayout from '@/components/blog/ArticleLayout'
import { getPost, getPublishedSlugs, getAlternates } from '@/lib/blog'
import { buildArticleMetadata, buildArticleJsonLd } from '@/lib/blog-seo'

const LOCALE = 'tr' as const

export function generateStaticParams() {
  return getPublishedSlugs(LOCALE).map((slug) => ({ slug }))
}

export const dynamicParams = false

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = getPost(LOCALE, slug)
  if (!post) return {}
  return buildArticleMetadata(post, LOCALE)
}

export default async function BlogArticlePageTR({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = getPost(LOCALE, slug)
  if (!post) notFound()

  const alternates = getAlternates(post)
  const jsonLd = buildArticleJsonLd(post, LOCALE)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ArticleLayout post={post} locale={LOCALE} alternates={alternates} />
    </>
  )
}
