// src/components/blog/BlogIndex.tsx
// [BLOG] Shared index body for /blog and /en/blog: heading, one-line intro, and
// a responsive grid of ArticleCards (newest first — the caller passes already
// sorted, draft-free posts). Reuses the tools-hub page shell for consistency.

import Link from 'next/link'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import ArticleCard from '@/components/blog/ArticleCard'
import type { Locale, Post } from '@/lib/blog'

const COPY: Record<Locale, { heading: string; intro: string; empty: string; tools: string }> = {
  nl: {
    heading: 'Blog',
    intro: 'Kennis en tips voor ZZP’ers — belasting, facturen en je administratie, in gewone taal.',
    empty: 'Er zijn nog geen artikelen. Kom snel terug.',
    tools: 'Bekijk onze gratis tools →',
  },
  en: {
    heading: 'Blog',
    intro: 'Knowledge and tips for freelancers in the Netherlands — tax, invoices and admin, in plain language.',
    empty: 'No articles yet. Check back soon.',
    tools: 'Explore our free tools →',
  },
}

export default function BlogIndex({ posts, locale }: { posts: Post[]; locale: Locale }) {
  const t = COPY[locale]
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f2f2f7', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 16px' }}>
        <div style={{ paddingTop: 48, textAlign: 'center' }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: '#1c1c1e', margin: '0 0 10px', letterSpacing: -0.5 }}>
            {t.heading}
          </h1>
          <p style={{ fontSize: 17, color: '#6b6b6e', margin: '0 auto 36px', maxWidth: 560 }}>{t.intro}</p>
        </div>

        <div style={{ paddingBottom: 48 }}>
          {posts.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#8a8a8e', fontSize: 15 }}>{t.empty}</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
              {posts.map((post) => (
                <ArticleCard key={post.frontmatter.slug} post={post} locale={locale} />
              ))}
            </div>
          )}

          <p style={{ textAlign: 'center', marginTop: 40 }}>
            <Link href="/tools" style={{ fontSize: 15, fontWeight: 600, color: '#007aff', textDecoration: 'none' }}>
              {t.tools}
            </Link>
          </p>
        </div>
      </div>

      <PublicFooter />
    </div>
  )
}
