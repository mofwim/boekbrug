// src/app/tools/page.tsx
// [SEO] Public hub linking every free lead-gen tool. Gives the tools a shared
// home, an indexable index page, and internal links out to each one.

import type { Metadata } from 'next'
import Link from 'next/link'
import { TOOLS } from '@/lib/tools'
import PublicFooter from '@/components/public-footer'

export const metadata: Metadata = {
  title: 'Gratis tools voor ZZP’ers — facturen, BTW en inkomen | BoekBrug',
  description:
    'Alle gratis BoekBrug-tools op één plek: factuur maken, factuur scannen met AI, BTW berekenen, BTW-aangifte, netto inkomen ZZP, uurtarief en kilometervergoeding. Geen account nodig.',
  keywords: ['zzp tools', 'gratis factuur tools', 'btw berekenen', 'factuur maken', 'zzp calculator'],
  alternates: { canonical: '/tools' },
  openGraph: {
    title: 'Gratis tools voor ZZP’ers',
    description: 'Factuur maken, factuur scannen, BTW en inkomen berekenen — gratis, geen account nodig.',
    type: 'website',
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Gratis ZZP-tools van BoekBrug',
  itemListElement: TOOLS.map((t, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: t.title,
    url: t.slug,
  })),
}

const wrap: React.CSSProperties = { maxWidth: 820, margin: '0 auto', padding: '0 16px' }

export default function ToolsHubPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f2f2f7', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div style={{ ...wrap, paddingTop: 48, textAlign: 'center' }}>
        <h1 style={{ fontSize: 34, fontWeight: 800, color: '#1c1c1e', margin: '0 0 10px', letterSpacing: -0.5 }}>
          Gratis tools voor ZZP’ers
        </h1>
        <p style={{ fontSize: 17, color: '#6b6b6e', margin: '0 auto 36px', maxWidth: 560 }}>
          Facturen maken en scannen, BTW en inkomen berekenen — allemaal gratis en zonder account.
        </p>
      </div>

      <div style={{ ...wrap, paddingBottom: 40 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          {TOOLS.map((t) => (
            <Link
              key={t.slug}
              href={t.slug}
              style={{
                display: 'block', background: '#fff', border: '1px solid #ececf1', borderRadius: 18,
                padding: 22, textDecoration: 'none', boxShadow: '0 2px 14px rgba(0,0,0,0.04)',
              }}
            >
              <div style={{ fontSize: 30, marginBottom: 10 }} aria-hidden>{t.emoji}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}>{t.title}</div>
              <div style={{ fontSize: 14, lineHeight: 1.55, color: '#6b6b6e' }}>{t.tagline}</div>
            </Link>
          ))}
        </div>

        <section style={{ marginTop: 40, background: '#ffffff', border: '1px solid #ececf1', borderRadius: 18, padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1c1c1e', marginBottom: 8 }}>Alles automatisch met BoekBrug</div>
          <div style={{ fontSize: 15, color: '#6b6b6e', marginBottom: 18, maxWidth: 520, margin: '0 auto 18px' }}>
            Deze tools zijn een voorproefje. In BoekBrug lopen je facturen, BTW en boekhouding vanzelf door —
            klaar voor de aangifte en voor je boekhouder.
          </div>
          <Link href="/register" style={{ backgroundColor: '#007aff', color: '#fff', fontSize: 15, fontWeight: 600, padding: '13px 26px', borderRadius: 9999, textDecoration: 'none', display: 'inline-block' }}>
            Gratis account maken
          </Link>
        </section>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#aeaeb2', marginTop: 40 }}>
          BoekBrug — de brug tussen jou en je boekhouder.
        </p>
      </div>
      <PublicFooter />
    </div>
  )
}
