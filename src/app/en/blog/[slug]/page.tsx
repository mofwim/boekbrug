// src/app/en/blog/[slug]/page.tsx
// [BLOG] English article page (/en/blog/[slug]). Statically generated (SSG) via
// generateStaticParams over the published EN slugs. Same SEO stack as the NL
// article page, driven by the shared blog-seo helpers.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import ArticleLayout from '@/components/blog/ArticleLayout'
import { getPost, getPublishedSlugs, getAlternate } from '@/lib/blog'
import { buildArticleMetadata, buildArticleJsonLd } from '@/lib/blog-seo'

const LOCALE = 'en' as const

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

export default async function BlogArticlePageEN({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = getPost(LOCALE, slug)
  if (!post) notFound()

  const alternate = getAlternate(post)
  const jsonLd = buildArticleJsonLd(post, LOCALE)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ArticleLayout post={post} locale={LOCALE} alternatePath={alternate?.path} />
    </>
  )
}
