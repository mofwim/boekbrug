// src/components/blog/ToolCTA.tsx
// [BLOG] The funnel. A visually distinct box at the end of every article that
// links to the article's related free tool (primary) and to signup (secondary).
// Reads relatedTool + relatedToolLabel from the article frontmatter. Matches the
// blue-accent CTA styling used on the landing page and tools hub (#007aff).

import Link from 'next/link'
import type { Locale } from '@/lib/blog'

const COPY: Record<Locale, { heading: string; body: string; register: string }> = {
  nl: {
    heading: 'Klaar om het zelf te doen?',
    body: 'Of maak een gratis BoekBrug-account en houd je hele administratie op één plek.',
    register: 'Gratis account maken',
  },
  en: {
    heading: 'Ready to do it yourself?',
    body: 'Or create a free BoekBrug account and keep your whole administration in one place.',
    register: 'Create a free account',
  },
}

export default function ToolCTA({
  locale,
  relatedTool,
  relatedToolLabel,
}: {
  locale: Locale
  relatedTool: string
  relatedToolLabel: string
}) {
  const t = COPY[locale]
  return (
    <aside
      style={{
        background: '#e8f1ff',
        border: '1px solid #cfe1ff',
        borderRadius: 18,
        padding: '26px 24px',
        margin: '36px 0 8px',
      }}
    >
      <div style={{ fontSize: 19, fontWeight: 700, color: '#1c1c1e', marginBottom: 14 }}>
        {t.heading}
      </div>

      {relatedTool && relatedToolLabel && (
        <Link
          href={relatedTool}
          style={{
            backgroundColor: '#007aff',
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            padding: '13px 24px',
            borderRadius: 9999,
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          {relatedToolLabel} →
        </Link>
      )}

      <p style={{ fontSize: 15, lineHeight: 1.6, color: '#3c3c43', margin: '18px 0 10px' }}>
        {t.body}
      </p>

      <Link
        href="/register"
        style={{ fontSize: 15, fontWeight: 600, color: '#007aff', textDecoration: 'none' }}
      >
        {t.register} →
      </Link>
    </aside>
  )
}
