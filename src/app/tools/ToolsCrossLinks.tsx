// src/app/tools/ToolsCrossLinks.tsx
// [SEO] "Meer gratis tools" footer, dropped at the bottom of each tool page.
// Server component — pure internal links (no JS) so crawlers follow them and
// link-equity flows between all the lead-gen pages. Each page shows a rotating
// subset via otherTools(), spreading links across the set.

import Link from 'next/link'
import { otherTools } from '@/lib/tools'

const wrap: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '0 16px' }

export default function ToolsCrossLinks({ currentSlug }: { currentSlug: string }) {
  const tools = otherTools(currentSlug, 3)
  if (tools.length === 0) return null

  return (
    <section style={{ ...wrap, marginTop: 8, paddingBottom: 56 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#5f6368', margin: '0 0 12px' }}>
        Meer gratis tools
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {tools.map((t) => (
          <Link
            key={t.slug}
            href={t.slug}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, background: '#fff',
              border: '1px solid #e0e0e0', borderRadius: 14, padding: '12px 14px',
              textDecoration: 'none',
            }}
          >
            <span style={{ fontSize: 22 }} aria-hidden>{t.emoji}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#202124' }}>{t.title}</span>
          </Link>
        ))}
        <Link
          href="/tools"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 14,
            padding: '12px 14px', textDecoration: 'none', fontSize: 14, fontWeight: 600, color: '#1a73e8',
          }}
        >
          Alle tools →
        </Link>
      </div>
    </section>
  )
}
