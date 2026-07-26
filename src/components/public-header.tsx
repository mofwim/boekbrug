// src/components/public-header.tsx
// [LANDING] Shared public header: BoekBrug wordmark + the three public nav
// links (Gratis tools / Inloggen / Gratis account). Reuses the exact look of
// the original inline header on the landing page — sticky, blurred, #1a73e8
// primary button — so every public/tool page shares one consistent top bar.

import Link from 'next/link'

const wrap: React.CSSProperties = { maxWidth: 980, margin: '0 auto', padding: '0 20px' }
const btnPrimary: React.CSSProperties = { backgroundColor: '#1a73e8', color: '#fff', fontWeight: 600, borderRadius: 9999, textDecoration: 'none', display: 'inline-block', padding: '9px 18px', fontSize: 14 }

export default function PublicHeader() {
  return (
    <header style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)', borderBottom: '1px solid #e0e0e0', position: 'sticky', top: 0, zIndex: 10 }}>
      <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
        <Link href="/" style={{ fontSize: 20, fontWeight: 800, color: '#202124', textDecoration: 'none', letterSpacing: -0.5 }}>BoekBrug</Link>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link href="/tools" style={{ fontSize: 15, color: '#202124', textDecoration: 'none', padding: '8px 12px', fontWeight: 500 }}>Gratis tools</Link>
          <Link href="/blog" style={{ fontSize: 15, color: '#202124', textDecoration: 'none', padding: '8px 12px', fontWeight: 500 }}>Blog</Link>
          {/* [BILLING] "Wat kost het?" is the last question before someone buys.
              Without this link the price page was reachable only by typing the
              URL — hiding the price loses the visitors who were ready to pay. */}
          <Link href="/prijzen" style={{ fontSize: 15, color: '#202124', textDecoration: 'none', padding: '8px 12px', fontWeight: 500 }}>Prijzen</Link>
          {/* English-blog link — makes the /en/blog knowledge base reachable from
              every public page (home, tools, articles), not just the blog index. */}
          <Link href="/en/blog" aria-label="Read the blog in English" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 14, fontWeight: 600, color: '#1a73e8', background: '#e8f0fe', border: '1px solid #d3e3fd', borderRadius: 9999, textDecoration: 'none', padding: '6px 12px' }}>
            <span aria-hidden="true">🌐</span> EN
          </Link>
          <Link href="/login" style={{ fontSize: 15, color: '#202124', textDecoration: 'none', padding: '8px 12px', fontWeight: 500 }}>Inloggen</Link>
          <Link href="/register" style={btnPrimary}>Gratis account maken</Link>
        </nav>
      </div>
    </header>
  )
}
