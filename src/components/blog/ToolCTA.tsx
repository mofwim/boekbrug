// src/components/blog/ToolCTA.tsx
// [BLOG] The funnel. A visually distinct box at the end of every article that
// links to the article's related free tool (primary) and to signup (secondary).
// Reads relatedTool + relatedToolLabel from the article frontmatter. Matches the
// blue-accent CTA styling used on the landing page and tools hub (#007aff).

import Link from 'next/link'
import type { Locale } from '@/lib/blog'

// Tools that have a published English version at /en/<slug>. For EN articles we
// route the CTA to the English tool so the reader stays in English; tools not
// listed here (factuur-maken, factuur-scannen, tools hub) have no EN page yet
// and keep their Dutch path.
const EN_TOOLS = new Set([
  '/btw-berekenen',
  '/netto-inkomen-zzp',
  '/uurtarief-berekenen',
  '/kilometervergoeding',
  '/btw-aangifte-berekenen',
])

const COPY: Record<Locale, { heading: string; body: string; register: string; reassure: string }> = {
  nl: {
    heading: 'Doe het meteen goed — gratis',
    body: 'Of houd je facturen, bonnetjes en btw bij op één plek in BoekBrug. Automatisch per kwartaal opgeteld en klaar voor je aangifte en je boekhouder.',
    register: 'Gratis account maken',
    reassure: 'Gratis account, in een minuut geregeld. Je data blijft van jou.',
  },
  en: {
    heading: 'Get it right from the start — free',
    body: 'Or keep your invoices, receipts and VAT in one place in BoekBrug. Added up per quarter automatically and ready for your tax return and your accountant.',
    register: 'Create a free account',
    reassure: 'Free account, set up in a minute. Your data stays yours.',
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
  const toolHref = locale === 'en' && EN_TOOLS.has(relatedTool) ? `/en${relatedTool}` : relatedTool
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

      <p style={{ fontSize: 15, lineHeight: 1.6, color: '#3c3c43', margin: '0 0 18px' }}>
        {t.body}
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {relatedTool && relatedToolLabel && (
          <Link
            href={toolHref}
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

        <Link
          href="/register"
          style={{
            backgroundColor: '#fff',
            color: '#007aff',
            fontSize: 15,
            fontWeight: 600,
            padding: '13px 24px',
            borderRadius: 9999,
            border: '1.5px solid #007aff',
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          {t.register} →
        </Link>
      </div>

      <p style={{ fontSize: 13, color: '#6b6b6e', margin: '14px 0 0' }}>{t.reassure}</p>
    </aside>
  )
}
