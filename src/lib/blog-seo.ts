// src/lib/blog-seo.ts
// [BLOG][SEO] Builds the per-article Metadata (title, description, canonical,
// hreflang, Open Graph, Twitter card) and the JSON-LD Article graph. Shared by
// the NL and EN article pages so the two never drift. All of this is required
// for the blog to actually rank — it's the whole point of the feature.

import type { Metadata } from 'next'
import {
  articlePath,
  indexPath,
  getAlternate,
  type Locale,
  type Post,
} from '@/lib/blog'
import { absoluteUrl } from '@/lib/site'

// Default social image = the site-wide next/og card. Individual articles can
// override with their own coverImage in frontmatter.
const DEFAULT_OG_IMAGE = '/opengraph-image'

function ogLocale(locale: Locale): string {
  return locale === 'nl' ? 'nl_NL' : 'en_GB'
}

function hreflang(locale: Locale): string {
  return locale === 'nl' ? 'nl-NL' : 'en-GB'
}

export function buildArticleMetadata(post: Post, locale: Locale): Metadata {
  const { frontmatter } = post
  const canonical = articlePath(locale, frontmatter.slug)
  const image = frontmatter.coverImage ?? DEFAULT_OG_IMAGE

  // hreflang: always self-reference; add the alternate language when a published
  // counterpart exists.
  const languages: Record<string, string> = { [hreflang(locale)]: canonical }
  const alt = getAlternate(post)
  if (alt) languages[hreflang(alt.locale)] = alt.path

  return {
    title: `${frontmatter.title} | BoekBrug`,
    description: frontmatter.description,
    keywords: frontmatter.keywords,
    authors: [{ name: frontmatter.author }],
    alternates: { canonical, languages },
    openGraph: {
      title: frontmatter.title,
      description: frontmatter.description,
      type: 'article',
      locale: ogLocale(locale),
      url: absoluteUrl(canonical),
      publishedTime: frontmatter.publishedAt || undefined,
      modifiedTime: frontmatter.updatedAt || frontmatter.publishedAt || undefined,
      authors: [frontmatter.author],
      images: [{ url: image }],
    },
    twitter: {
      card: 'summary_large_image',
      title: frontmatter.title,
      description: frontmatter.description,
      images: [image],
    },
  }
}

export function buildArticleJsonLd(post: Post, locale: Locale): Record<string, unknown> {
  const { frontmatter } = post
  const url = absoluteUrl(articlePath(locale, frontmatter.slug))
  const image = absoluteUrl(frontmatter.coverImage ?? DEFAULT_OG_IMAGE)

  // A @graph pairs the post (BlogPosting — the correct type for a blog article,
  // more specific than Article) with a BreadcrumbList that mirrors the visual
  // "Blog › [title]" trail, so search engines can render breadcrumb rich results.
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        headline: frontmatter.title,
        description: frontmatter.description,
        inLanguage: hreflang(locale),
        datePublished: frontmatter.publishedAt || undefined,
        dateModified: frontmatter.updatedAt || frontmatter.publishedAt || undefined,
        image: [image],
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        author: { '@type': 'Organization', name: frontmatter.author, url: absoluteUrl('/') },
        publisher: {
          '@type': 'Organization',
          name: 'BoekBrug',
          url: absoluteUrl('/'),
          logo: { '@type': 'ImageObject', url: absoluteUrl(DEFAULT_OG_IMAGE) },
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Blog', item: absoluteUrl(indexPath(locale)) },
          { '@type': 'ListItem', position: 2, name: frontmatter.title, item: url },
        ],
      },
    ],
  }
}
