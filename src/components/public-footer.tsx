// src/components/public-footer.tsx
// [LANDING] Shared public footer: brand line, tool links and the legal links
// (privacy / voorwaarden / cookies) that AVG and the ad networks require to be
// reachable from every public page.

import Link from 'next/link'
import { TOOLS } from '@/lib/tools'

const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }
const head: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#1c1c1e', marginBottom: 4 }
const link: React.CSSProperties = { fontSize: 14, color: '#6b6b6e', textDecoration: 'none' }

export default function PublicFooter() {
  return (
    <footer style={{ background: '#fff', borderTop: '1px solid #ececf1', marginTop: 'auto' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '40px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 28 }}>
        <div style={col}>
          <Link href="/" style={{ fontSize: 17, fontWeight: 800, color: '#1c1c1e', textDecoration: 'none' }}>BoekBrug</Link>
          <div style={{ fontSize: 13, color: '#aeaeb2', lineHeight: 1.6 }}>
            De brug tussen jou en je boekhouder.
          </div>
        </div>

        <div style={col}>
          <div style={head}>Gratis tools</div>
          {TOOLS.slice(0, 5).map((t) => (
            <Link key={t.slug} href={t.slug} style={link}>{t.title}</Link>
          ))}
          <Link href="/tools" style={{ ...link, color: '#007aff' }}>Alle tools →</Link>
        </div>

        <div style={col}>
          <div style={head}>Voor wie</div>
          <Link href="/boekhouden-zzp" style={link}>Boekhouden ZZP</Link>
          <Link href="/voor-starters" style={link}>Voor starters</Link>
          <Link href="/voor-boekhouders" style={link}>Voor boekhouders</Link>
        </div>

        <div style={col}>
          <div style={head}>BoekBrug</div>
          <Link href="/register" style={link}>Gratis account</Link>
          <Link href="/login" style={link}>Inloggen</Link>
        </div>

        <div style={col}>
          <div style={head}>Juridisch</div>
          <Link href="/privacy" style={link}>Privacyverklaring</Link>
          <Link href="/voorwaarden" style={link}>Algemene Voorwaarden</Link>
          <Link href="/cookies" style={link}>Cookiebeleid</Link>
        </div>
      </div>
      <div style={{ borderTop: '1px solid #f0f0f4', padding: '16px 20px', textAlign: 'center', fontSize: 12, color: '#aeaeb2' }}>
        © {new Date().getFullYear()} BoekBrug — voor ZZP’ers en boekhouders in Nederland.
      </div>
    </footer>
  )
}
