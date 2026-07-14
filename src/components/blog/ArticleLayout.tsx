// src/components/blog/ArticleLayout.tsx
// [BLOG] Article wrapper: breadcrumb → h1 → meta line → cover → Markdown body →
// ToolCTA → "back to blog". Server component. Renders the Markdown body with
// react-markdown + remark-gfm (tables/strikethrough) + rehype-slug (auto heading
// ids for anchor links) — the same rendering stack the legal pages use, so the
// blog matches the rest of the product. Reuses PublicHeader/PublicFooter and the
// #f2f2f7 page shell from the tools pages for one consistent design system.

import Link from 'next/link'
import Image from 'next/image'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import ToolCTA from '@/components/blog/ToolCTA'
import { indexPath, articlePath, getClusterSiblings, type Locale, type Post } from '@/lib/blog'

// react-markdown injects an internal `node` prop into every custom component;
// strip it so it never leaks onto the DOM.
function omitNode<P extends { node?: unknown }>(props: P): Omit<P, 'node'> {
  const rest = { ...props }
  delete (rest as { node?: unknown }).node
  return rest
}

const bodyText: React.CSSProperties = { color: '#3c3c43', fontSize: 16, lineHeight: 1.75 }

const components: Components = {
  // h1 is rendered by the layout itself (from frontmatter), so in-body H1s are
  // downgraded visually to keep a single page <h1>.
  h1: (p) => <h2 style={{ fontSize: 24, fontWeight: 700, color: '#1c1c1e', margin: '34px 0 12px' }} {...omitNode(p)} />,
  h2: (p) => <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1c1c1e', margin: '34px 0 12px', scrollMarginTop: 76 }} {...omitNode(p)} />,
  h3: (p) => <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1c1c1e', margin: '24px 0 8px', scrollMarginTop: 76 }} {...omitNode(p)} />,
  p: (p) => <p style={{ ...bodyText, margin: '0 0 16px' }} {...omitNode(p)} />,
  ul: (p) => <ul style={{ ...bodyText, margin: '0 0 16px', paddingLeft: 22 }} {...omitNode(p)} />,
  ol: (p) => <ol style={{ ...bodyText, margin: '0 0 16px', paddingLeft: 22 }} {...omitNode(p)} />,
  li: (p) => <li style={{ margin: '5px 0' }} {...omitNode(p)} />,
  strong: (p) => <strong style={{ color: '#1c1c1e', fontWeight: 700 }} {...omitNode(p)} />,
  em: (p) => <em {...omitNode(p)} />,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #ececf1', margin: '30px 0' }} />,
  a: (p) => <a style={{ color: '#007aff', textDecoration: 'underline' }} {...omitNode(p)} />,
  code: (p) => (
    <code style={{ background: '#f2f2f7', borderRadius: 5, padding: '1px 6px', fontSize: 14, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#1c1c1e' }} {...omitNode(p)} />
  ),
  table: (p) => (
    <div style={{ overflowX: 'auto', margin: '0 0 18px', border: '1px solid #ececf1', borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }} {...omitNode(p)} />
    </div>
  ),
  th: (p) => (
    <th style={{ textAlign: 'left', padding: '9px 12px', background: '#f9f9fb', borderBottom: '1px solid #ececf1', fontWeight: 700, color: '#1c1c1e', whiteSpace: 'nowrap' }} {...omitNode(p)} />
  ),
  td: (p) => (
    <td style={{ padding: '9px 12px', borderBottom: '1px solid #f0f0f4', color: '#3c3c43', verticalAlign: 'top' }} {...omitNode(p)} />
  ),
  blockquote: (p) => (
    <blockquote style={{ borderLeft: '3px solid #d1d1d6', margin: '0 0 16px', padding: '4px 0 4px 16px', color: '#6b6b6e' }} {...omitNode(p)} />
  ),
}

const COPY: Record<Locale, { blog: string; by: string; readTime: string; back: string; switchTo: string; partOf: string; more: string }> = {
  nl: { blog: 'Blog', by: 'door', readTime: 'min leestijd', back: '← Terug naar blog', switchTo: 'Read in English', partOf: 'Onderdeel van de gids', more: 'Lees ook in deze gids' },
  en: { blog: 'Blog', by: 'by', readTime: 'min read', back: '← Back to blog', switchTo: 'Lees in het Nederlands', partOf: 'Part of the guide', more: 'More in this guide' },
}

function formatDate(iso: string, locale: Locale): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d)
}

export default function ArticleLayout({
  post,
  locale,
  alternatePath,
}: {
  post: Post
  locale: Locale
  alternatePath?: string | null
}) {
  const { frontmatter, content, readingMinutes } = post
  const t = COPY[locale]
  const siblings = getClusterSiblings(post)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f2f2f7', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px 72px' }}>
        {/* 1. Breadcrumb: Blog › [article title] */}
        <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: '#8a8a8e', marginBottom: 20 }}>
          <Link href={indexPath(locale)} style={{ color: '#007aff', textDecoration: 'none' }}>{t.blog}</Link>
          <span style={{ margin: '0 8px' }}>›</span>
          <span>{frontmatter.title}</span>
        </nav>

        <article style={{ background: '#fff', border: '1px solid #ececf1', borderRadius: 18, padding: '32px 28px', boxShadow: '0 2px 14px rgba(0,0,0,0.04)' }}>
          {/* 2. Title */}
          <h1 style={{ fontSize: 32, fontWeight: 800, color: '#1c1c1e', letterSpacing: -0.5, lineHeight: 1.2, margin: '0 0 14px' }}>
            {frontmatter.title}
          </h1>

          {/* 3. Meta line: date · reading time · author */}
          <div style={{ fontSize: 13, color: '#8a8a8e', marginBottom: alternatePath ? 12 : 24 }}>
            {formatDate(frontmatter.publishedAt, locale)}
            {' · '}{readingMinutes} {t.readTime}
            {' · '}{t.by} {frontmatter.author}
          </div>

          {/* Topic-cluster up-link: "part of the guide: [pillar]" */}
          {frontmatter.pillarSlug && frontmatter.pillarTitle && (
            <div style={{ marginBottom: 16 }}>
              <Link
                href={articlePath(locale, frontmatter.pillarSlug)}
                style={{ display: 'inline-block', fontSize: 12, fontWeight: 600, color: '#007aff', background: '#e8f1ff', border: '1px solid #cfe1ff', borderRadius: 9999, padding: '5px 12px', textDecoration: 'none' }}
              >
                {t.partOf}: {frontmatter.pillarTitle} →
              </Link>
            </div>
          )}

          {/* Language switch (also emitted as hreflang in <head>) */}
          {alternatePath && (
            <div style={{ marginBottom: 24 }}>
              <Link href={alternatePath} style={{ fontSize: 13, fontWeight: 600, color: '#007aff', textDecoration: 'none' }}>
                {t.switchTo} →
              </Link>
            </div>
          )}

          {/* 4. Optional cover image */}
          {frontmatter.coverImage && (
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden', margin: '0 0 24px', background: '#f2f2f7' }}>
              <Image
                src={frontmatter.coverImage}
                alt={frontmatter.title}
                fill
                priority
                sizes="(max-width: 720px) 100vw, 720px"
                style={{ objectFit: 'cover' }}
              />
            </div>
          )}

          {/* 5. Rendered Markdown content */}
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={components}>
            {content}
          </ReactMarkdown>

          {/* 6. ToolCTA — the funnel */}
          <ToolCTA
            locale={locale}
            relatedTool={frontmatter.relatedTool}
            relatedToolLabel={frontmatter.relatedToolLabel}
          />
        </article>

        {/* Related articles in the same guide/cluster — keeps readers in the
            topic mesh and spreads internal-link equity to sibling articles. */}
        {siblings.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#8a8a8e', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
              {t.more}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {siblings.map((s) => (
                <Link
                  key={s.frontmatter.slug}
                  href={articlePath(locale, s.frontmatter.slug)}
                  style={{ display: 'block', background: '#fff', border: '1px solid #ececf1', borderRadius: 12, padding: '14px 16px', textDecoration: 'none', boxShadow: '0 1px 8px rgba(0,0,0,0.03)' }}
                >
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#1c1c1e', lineHeight: 1.35 }}>{s.frontmatter.title}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 7. Back to blog */}
        <div style={{ marginTop: 28 }}>
          <Link href={indexPath(locale)} style={{ fontSize: 14, color: '#007aff', textDecoration: 'none' }}>
            {t.back}
          </Link>
        </div>
      </div>

      <PublicFooter />
    </div>
  )
}
