// src/components/blog/BlogIndex.tsx
// [BLOG] Shared index body for /blog and /en/blog: heading, one-line intro, and
// a responsive grid of ArticleCards (newest first — the caller passes already
// sorted, draft-free posts). Reuses the tools-hub page shell for consistency.

import Link from 'next/link'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import ArticleCard from '@/components/blog/ArticleCard'
import { indexPath, LOCALE_META, LOCALES, type Locale, type Post } from '@/lib/blog'

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
  ar: {
    heading: 'المدوّنة',
    intro: 'معرفة ونصائح لأصحاب العمل الحر في هولندا — الضرائب والفواتير وإدارتك، بلغة بسيطة.',
    empty: 'لا توجد مقالات بعد. عد قريباً.',
    tools: 'استكشف أدواتنا المجانية →',
  },
  tr: {
    heading: 'Blog',
    intro: 'Hollanda’daki serbest çalışanlar için bilgi ve ipuçları — vergi, faturalar ve idari işler, sade bir dille.',
    empty: 'Henüz makale yok. Yakında tekrar uğrayın.',
    tools: 'Ücretsiz araçlarımıza göz atın →',
  },
}

export default function BlogIndex({ posts, locale }: { posts: Post[]; locale: Locale }) {
  const t = COPY[locale]
  const others = LOCALES.filter((l) => l !== locale)
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      <div dir={LOCALE_META[locale].dir} style={{ maxWidth: 820, margin: '0 auto', padding: '0 16px', fontFamily: locale === 'ar' ? 'var(--font-arabic), var(--font-sans), system-ui, sans-serif' : undefined }}>
        <div style={{ paddingTop: 48, textAlign: 'center' }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: '#202124', margin: '0 0 10px', letterSpacing: -0.5 }}>
            {t.heading}
          </h1>
          <p style={{ fontSize: 17, color: '#5f6368', margin: '0 auto 18px', maxWidth: 560 }}>{t.intro}</p>
          {/* Language switches — every other language's blog, each in its own name. */}
          <div style={{ marginBottom: 32, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {others.map((loc) => (
              <Link
                key={loc}
                href={indexPath(loc)}
                hrefLang={LOCALE_META[loc].hreflang}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 700, color: '#fff', background: '#1a73e8', borderRadius: 9999, padding: '10px 20px', textDecoration: 'none', boxShadow: '0 4px 14px rgba(26,115,232,0.28)' }}
              >
                <span aria-hidden="true" style={{ fontSize: 17 }}>🌐</span>
                {LOCALE_META[loc].label}
              </Link>
            ))}
          </div>
        </div>

        <div style={{ paddingBottom: 48 }}>
          {posts.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#70757a', fontSize: 15 }}>{t.empty}</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
              {posts.map((post) => (
                <ArticleCard key={post.frontmatter.slug} post={post} locale={locale} />
              ))}
            </div>
          )}

          <p style={{ textAlign: 'center', marginTop: 40 }}>
            <Link href="/tools" style={{ fontSize: 15, fontWeight: 600, color: '#1a73e8', textDecoration: 'none' }}>
              {t.tools}
            </Link>
          </p>
        </div>
      </div>

      <PublicFooter />
    </div>
  )
}
