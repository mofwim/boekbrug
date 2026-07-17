// src/components/blog/ArticleCard.tsx
// [BLOG] One item in the blog index list. Reuses the white rounded-card look of
// the tools hub (#fff, 1px #e0e0e0 border, 18px radius, soft shadow). Shows an
// optional cover image, title, description and the published date.

import Link from 'next/link'
import Image from 'next/image'
import { articlePath, type Locale, type Post } from '@/lib/blog'

// Locale-aware, stable date formatting. Intl with an explicit locale keeps the
// server-rendered output deterministic (no hydration mismatch).
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

export default function ArticleCard({ post, locale }: { post: Post; locale: Locale }) {
  const { frontmatter } = post
  return (
    <Link
      href={articlePath(locale, frontmatter.slug)}
      style={{
        display: 'block',
        background: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: 18,
        overflow: 'hidden',
        textDecoration: 'none',
        boxShadow: '0 2px 14px rgba(0,0,0,0.04)',
      }}
    >
      {frontmatter.coverImage && (
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#f8f9fa' }}>
          <Image
            src={frontmatter.coverImage}
            alt=""
            fill
            sizes="(max-width: 700px) 100vw, 700px"
            style={{ objectFit: 'cover' }}
          />
        </div>
      )}
      <div style={{ padding: 22 }}>
        <div style={{ fontSize: 12, color: '#9aa0a6', marginBottom: 8 }}>
          {formatDate(frontmatter.publishedAt, locale)}
        </div>
        <div style={{ fontSize: 19, fontWeight: 700, color: '#202124', marginBottom: 8, lineHeight: 1.3 }}>
          {frontmatter.title}
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.55, color: '#5f6368' }}>
          {frontmatter.description}
        </div>
      </div>
    </Link>
  )
}
