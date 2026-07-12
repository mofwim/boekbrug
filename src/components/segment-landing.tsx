// src/components/segment-landing.tsx
// [SEGMENT] Shared layout for audience landing pages (/boekhouden-zzp,
// /voor-starters, /voor-boekhouders). Server component: header, hero, content
// blocks, optional free-tools grid, FAQ, a CTA band, and the footer — so every
// segment page looks and funnels the same. Content comes in as props.
//
// Truthfulness: pages only describe real features (invoices, AI scan that
// suggests, quarterly BTW/omzet overview, document storage, accountant bridge).
// No profit tracking, auto-booking, tax filing, or pricing claims.

import Link from 'next/link'
import { TOOLS } from '@/lib/tools'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'

export interface SegmentBlock {
  h2: string
  paragraphs: string[]
  bullets?: string[]
}
export interface SegmentFaq {
  q: string
  a: string
}
export interface SegmentContent {
  eyebrow: string
  h1: string
  intro: string
  blocks: SegmentBlock[]
  faq: SegmentFaq[]
  ctaHeading: string
  ctaText: string
  ctaHref?: string // default /register
  ctaLabel?: string // default "Gratis account maken"
  showTools?: boolean
}

const wrap: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '0 20px' }
const h2s: React.CSSProperties = { fontSize: 22, fontWeight: 700, color: '#1c1c1e', margin: '0 0 12px', letterSpacing: -0.3 }
const ps: React.CSSProperties = { fontSize: 16, lineHeight: 1.7, color: '#3c3c43', margin: '0 0 14px' }

export default function SegmentLanding({ content }: { content: SegmentContent }) {
  const ctaHref = content.ctaHref ?? '/register'
  const ctaLabel = content.ctaLabel ?? 'Gratis account maken'

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f2f2f7', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      {/* Hero */}
      <section style={{ ...wrap, textAlign: 'center', paddingTop: 56, paddingBottom: 36 }}>
        <div style={{ display: 'inline-block', background: '#eaf3ff', color: '#007aff', fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 9999, marginBottom: 18 }}>
          {content.eyebrow}
        </div>
        <h1 style={{ fontSize: 38, fontWeight: 800, color: '#1c1c1e', letterSpacing: -0.8, lineHeight: 1.12, margin: '0 auto 16px', maxWidth: 620 }}>
          {content.h1}
        </h1>
        <p style={{ fontSize: 18, color: '#6b6b6e', lineHeight: 1.6, margin: '0 auto 26px', maxWidth: 520 }}>
          {content.intro}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href={ctaHref} style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 15, fontWeight: 600, padding: '13px 24px', borderRadius: 9999, textDecoration: 'none' }}>{ctaLabel}</Link>
          <Link href="/tools" style={{ backgroundColor: '#fff', color: '#007aff', fontSize: 15, fontWeight: 600, padding: '13px 24px', borderRadius: 9999, border: '1.5px solid #007aff', textDecoration: 'none' }}>Gratis tools</Link>
        </div>
        <div style={{ fontSize: 13, color: '#8a8a8e', marginTop: 14 }}>Geen creditcard nodig · AVG-proof</div>
      </section>

      {/* Content blocks */}
      <div style={{ ...wrap, paddingBottom: 8 }}>
        {content.blocks.map((b) => (
          <section key={b.h2} style={{ marginTop: 28 }}>
            <h2 style={h2s}>{b.h2}</h2>
            {b.paragraphs.map((p, i) => (
              <p key={i} style={ps}>{p}</p>
            ))}
            {b.bullets && (
              <ul style={{ ...ps, margin: '0 0 14px', paddingLeft: 22 }}>
                {b.bullets.map((li, i) => (
                  <li key={i} style={{ margin: '6px 0' }}>{li}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {/* Free tools */}
      {content.showTools && (
        <div style={{ ...wrap, paddingTop: 24 }}>
          <h2 style={h2s}>Begin gratis — zonder account</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 6 }}>
            {TOOLS.map((t) => (
              <Link key={t.slug} href={t.slug} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #ececf1', borderRadius: 14, padding: '12px 14px', textDecoration: 'none' }}>
                <span style={{ fontSize: 22 }} aria-hidden>{t.emoji}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#1c1c1e' }}>{t.title}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* FAQ */}
      {content.faq.length > 0 && (
        <div style={{ ...wrap, paddingTop: 36 }}>
          <h2 style={h2s}>Veelgestelde vragen</h2>
          {content.faq.map((f) => (
            <div key={f.q} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1c1e', marginBottom: 4 }}>{f.q}</div>
              <div style={{ fontSize: 15, lineHeight: 1.6, color: '#3c3c43' }}>{f.a}</div>
            </div>
          ))}
        </div>
      )}

      {/* CTA band */}
      <div style={{ ...wrap, paddingTop: 40, paddingBottom: 64 }}>
        <div style={{ background: 'linear-gradient(135deg, #007aff, #0056d6)', borderRadius: 22, padding: '40px 28px', textAlign: 'center', color: '#fff' }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.4, margin: '0 0 8px' }}>{content.ctaHeading}</h2>
          <p style={{ fontSize: 16, opacity: 0.92, margin: '0 auto 20px', maxWidth: 440 }}>{content.ctaText}</p>
          <Link href={ctaHref} style={{ backgroundColor: '#fff', color: '#007aff', fontSize: 15, fontWeight: 700, padding: '13px 26px', borderRadius: 9999, textDecoration: 'none', display: 'inline-block' }}>{ctaLabel}</Link>
        </div>
      </div>

      <PublicFooter />
    </div>
  )
}
