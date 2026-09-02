// src/components/SegmentVoordeur.tsx
// [SEGMENT-VOORDEUR] One renderer for every segment front door.
//
// Three near-identical marketing pages is exactly the shape this codebase already paid for once:
// tokens.ts opens by describing thirteen dashboard screens that each declared their own palette.
// So the copy lives in segment-pages.ts and this file holds no words of its own beyond the labels
// that are the same on every door.
//
// The layout deliberately mirrors /voor-boekhouders: same wrapper, same card, same buttons. A
// reader who lands on two of these should not feel they left the product.

import Link from 'next/link'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import type { SegmentPage } from '@/lib/segment-pages'
import { VAK_PARAM } from '@/lib/vak-profile'

const wrap: React.CSSProperties = { maxWidth: 880, margin: '0 auto', padding: '0 16px' }

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 16,
  padding: 24,
  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
}

const body: React.CSSProperties = {
  fontSize: 16,
  color: '#5f6368',
  lineHeight: 1.7,
  margin: '0 0 14px',
  maxWidth: 660,
}

const btnPrimary: React.CSSProperties = {
  display: 'inline-block',
  background: '#1a73e8',
  color: '#fff',
  fontSize: 16,
  fontWeight: 600,
  padding: '12px 22px',
  borderRadius: 9999,
  textDecoration: 'none',
}

const btnGhost: React.CSSProperties = {
  display: 'inline-block',
  background: '#fff',
  color: '#1a73e8',
  fontSize: 16,
  fontWeight: 600,
  padding: '12px 22px',
  borderRadius: 9999,
  border: '1px solid #d3e3fd',
  textDecoration: 'none',
}

export default function SegmentVoordeur({ pagina }: { pagina: SegmentPage }) {
  // [SEGMENT-VAK] Het vak reist mee in de aanmeldlink, via dezelfde parameter die
  // /factuur-maken/<vak> al gebruikt — één patroon voor één idee, zoals vak-profile.ts vraagt.
  // Zonder vak is dit letterlijk de oude link: geen lege parameter, want parseVak leest die als
  // "onbekend" en dat is hetzelfde resultaat langs een omweg die niets zegt.
  const aanmeldHref = pagina.vak
    ? `/register?${VAK_PARAM}=${encodeURIComponent(pagina.vak)}`
    : '/register'

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      <main style={{ ...wrap, paddingTop: 40, paddingBottom: 64 }}>

        {/* ── Het probleem, in zijn eigen woorden ───────────────────────────────
            Niet "complete online boekhouding". Niemand wordt wakker met de wens om te boekhouden;
            ze worden wakker met een stapel. De kop noemt de stapel. */}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a73e8', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 10 }}>
          Voor {pagina.naam}
        </div>
        <h1 style={{ fontSize: 38, fontWeight: 800, color: '#202124', margin: '0 0 14px', lineHeight: 1.15, letterSpacing: -0.5, maxWidth: 700 }}>
          {pagina.belofte}
        </h1>
        <p style={{ ...body, fontSize: 18, marginBottom: 24 }}>{pagina.probleem}</p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <Link href={aanmeldHref} style={btnPrimary}>Gratis beginnen</Link>
          <Link href="/prijzen" style={btnGhost}>Wat het kost</Link>
        </div>
        <p style={{ fontSize: 13, color: '#80868b', margin: '0 0 40px' }}>
          Geen creditcard. Je eigen administratie blijft van jou — je haalt hem er op elk moment
          weer uit.
        </p>

        {/* ── Zo werkt het ─────────────────────────────────────────────────────
            Elke stap noemt een scherm dat bestaat. De poort [SEGMENT-VOORDEUR] controleert dat,
            zodat een belofte niet kan blijven staan nadat het scherm verdwijnt. */}
        <h2 style={{ fontSize: 24, fontWeight: 700, color: '#202124', margin: '0 0 16px', lineHeight: 1.3 }}>
          Zo werkt het
        </h2>
        <div style={{ display: 'grid', gap: 14, marginBottom: 40 }}>
          {pagina.stappen.map((s, i) => (
            <div key={s.route} style={card}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div
                  aria-hidden
                  style={{
                    flexShrink: 0, width: 30, height: 30, borderRadius: 9999,
                    background: '#d3e3fd', color: '#041e49',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700,
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: '0 0 6px' }}>{s.title}</h3>
                  <p style={{ ...body, margin: 0 }}>{s.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Wat het NIET doet ────────────────────────────────────────────────
            Staat op de pagina om dezelfde reden als op /voor-boekhouders: één belofte die niet
            waargemaakt wordt kost het hele kanaal. Wie hier leest dat er geen voorraad is, is
            niet teleurgesteld — hij weet het vóór hij begint. */}
        <div style={{ ...card, background: '#fff8e1', borderColor: '#ffe0a3', marginBottom: 40 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 10px' }}>
            Wat BoekBrug voor jou niet doet
          </h2>
          <ul style={{ ...body, margin: 0, paddingInlineStart: 20 }}>
            {pagina.nietDit.map((n) => (
              <li key={n} style={{ marginBottom: 6 }}>{n}</li>
            ))}
          </ul>
        </div>

        {/* ── En de uitweg ─────────────────────────────────────────────────── */}
        <div style={{ ...card, textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#202124', margin: '0 0 8px' }}>
            Probeer het met de stapel die er nu ligt
          </h2>
          <p style={{ ...body, margin: '0 auto 16px' }}>
            Stuur er tien documenten in en kijk wat er overblijft. Dat is een eerlijker antwoord dan
            welke pagina dan ook.
          </p>
          <Link href={aanmeldHref} style={btnPrimary}>Gratis beginnen</Link>
        </div>

      </main>

      <PublicFooter />
    </div>
  )
}
