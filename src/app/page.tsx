// src/app/page.tsx
// [LANDING] Public homepage. Logged-in users go straight to the dashboard;
// everyone else gets the marketing landing — the destination we point ads and
// word-of-mouth at, with the free tools as the top-of-funnel hook.
//
// OAuth `?code=` never lands here: signInWithOAuth redirectTo is
// /api/auth/callback (see login/register), so the homepage is free to render.

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { TOOLS } from '@/lib/tools'
import PublicFooter from '@/components/public-footer'
import PublicHeader from '@/components/public-header'
import { SITE_URL, absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'BoekBrug — facturen, BTW en boekhouding voor ZZP’ers',
  description:
    'BoekBrug is de brug tussen jou en je boekhouder. Maak en scan facturen, houd je BTW bij en werk samen met je boekhouder. Plus gratis tools, zonder account.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'BoekBrug — de brug tussen jou en je boekhouder',
    description: 'Maak en scan facturen, houd je BTW bij en werk samen met je boekhouder. Gratis tools, zonder account.',
    type: 'website',
  },
}

const wrap: React.CSSProperties = { maxWidth: 980, margin: '0 auto', padding: '0 20px' }
const btnPrimary: React.CSSProperties = { backgroundColor: '#1a73e8', color: '#fff', fontSize: 15, fontWeight: 600, padding: '13px 24px', borderRadius: 9999, textDecoration: 'none', display: 'inline-block' }
const btnGhost: React.CSSProperties = { backgroundColor: '#fff', color: '#1a73e8', fontSize: 15, fontWeight: 600, padding: '13px 24px', borderRadius: 9999, border: '1.5px solid #1a73e8', textDecoration: 'none', display: 'inline-block' }

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'BoekBrug',
      url: SITE_URL,
      logo: absoluteUrl('/opengraph-image'),
    },
    {
      '@type': 'WebSite',
      name: 'BoekBrug',
      url: SITE_URL,
    },
  ],
}

const features = [
  { emoji: '🧾', title: 'Facturen die kloppen', body: 'Maak snel een factuur die klopt met de Nederlandse regels. Download hem als PDF.' },
  { emoji: '📄', title: 'Scan en klaar', body: 'Upload een foto of PDF. De AI leest de leverancier, het bedrag en de BTW voor je uit.' },
  { emoji: '📊', title: 'BTW altijd bij', body: 'Je omzet en BTW worden per kwartaal opgeteld. Zo is je aangifte zo klaar.' },
  { emoji: '🤝', title: 'Eén lijn met je boekhouder', body: 'Deel je facturen met je boekhouder. Geen mappen vol PDF’s meer mailen.' },
]

export default async function Home() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      {/* Hero */}
      <section style={{ ...wrap, textAlign: 'center', paddingTop: 72, paddingBottom: 48 }}>
        <div style={{ display: 'inline-block', background: '#eaf3ff', color: '#1a73e8', fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 9999, marginBottom: 20 }}>
          Voor ZZP’ers en hun boekhouder
        </div>
        <h1 style={{ fontSize: 46, fontWeight: 800, color: '#202124', letterSpacing: -1, lineHeight: 1.1, margin: '0 auto 18px', maxWidth: 680 }}>
          De brug tussen jou en je boekhouder
        </h1>
        <p style={{ fontSize: 19, color: '#5f6368', lineHeight: 1.6, margin: '0 auto 32px', maxWidth: 560 }}>
          Maak en scan facturen, houd je BTW makkelijk bij en werk samen met je boekhouder. Alles op één plek.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/register" style={btnPrimary}>Gratis account maken</Link>
          <Link href="/factuur-maken" style={btnGhost}>Direct een factuur maken</Link>
        </div>
        <div style={{ fontSize: 13, color: '#bdc1c6', marginTop: 16 }}>Geen creditcard nodig · AVG-proof · Nederlandse facturen</div>
      </section>

      {/* Features */}
      <section style={{ ...wrap, paddingBottom: 56 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {features.map((f) => (
            <div key={f.title} style={{ background: '#fff', border: '1px solid #ececf1', borderRadius: 18, padding: 24 }}>
              <div style={{ fontSize: 30, marginBottom: 12 }} aria-hidden>{f.emoji}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#202124', marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: '#5f6368' }}>{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Free tools */}
      <section style={{ ...wrap, paddingBottom: 56 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 28, fontWeight: 800, color: '#202124', letterSpacing: -0.5, margin: '0 0 8px' }}>Begin gratis — zonder account</h2>
          <p style={{ fontSize: 16, color: '#5f6368', margin: 0 }}>Handige tools voor elke ZZP’er. Direct te gebruiken.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {TOOLS.map((t) => (
            <Link key={t.slug} href={t.slug} style={{ display: 'block', background: '#fff', border: '1px solid #ececf1', borderRadius: 16, padding: 20, textDecoration: 'none' }}>
              <div style={{ fontSize: 26, marginBottom: 8 }} aria-hidden>{t.emoji}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#202124', marginBottom: 4 }}>{t.title}</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: '#5f6368' }}>{t.tagline}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section style={{ ...wrap, paddingBottom: 72 }}>
        <div style={{ background: 'linear-gradient(135deg, #1a73e8, #0056d6)', borderRadius: 24, padding: '48px 32px', textAlign: 'center', color: '#fff' }}>
          <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, margin: '0 0 10px' }}>Minder tijd kwijt aan je administratie?</h2>
          <p style={{ fontSize: 17, opacity: 0.92, margin: '0 auto 24px', maxWidth: 480 }}>
            Zet vandaag de eerste stap. Gratis account, in een minuut geregeld.
          </p>
          <Link href="/register" style={{ backgroundColor: '#fff', color: '#1a73e8', fontSize: 16, fontWeight: 700, padding: '14px 30px', borderRadius: 9999, textDecoration: 'none', display: 'inline-block' }}>
            Gratis account maken
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  )
}
