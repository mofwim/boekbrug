'use client'

// src/app/dashboard/werkplek/page.tsx  (or WerkplekPage.tsx used as default export)
// [BOEK-029] Mijn werkplek — 4 navigation buttons — May 2026

import { useRouter } from 'next/navigation'

const ITEMS = [
  { icon: '📄', label: 'Mijn facturen',  sub: 'Verstuur en beheer',      href: '/dashboard/facturen', color: '#007aff' },
  { icon: '📁', label: 'Mijn bestanden', sub: 'Bonnen en documenten',     href: '/dashboard/bestanden', color: '#ff9500' },
  { icon: '👥', label: 'Mijn klanten',   sub: 'Klantgegevens en history', href: '/dashboard/klanten',  color: '#34c759' },
  { icon: '⚙️', label: 'Mijn gegevens', sub: 'Bedrijf en account',       href: '/dashboard/settings', color: '#5856d6' },
]

export default function WerkplekPage() {
  const router = useRouter()

  return (
    <div style={{
      minHeight: '100vh', backgroundColor: 'var(--color-bg, #f2f2f7)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
      WebkitFontSmoothing: 'antialiased',
    }}>
      {/* Back header */}
      <div style={{
        background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)',
        borderBottom: '0.5px solid rgba(0,0,0,0.1)', padding: '12px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#007aff', fontWeight: 600, padding: 0 }}>
          ← Terug
        </button>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: '#1c1c1e', flex: 1, textAlign: 'center', marginRight: 56 }}>
          Mijn werkplek
        </h1>
      </div>

      <main style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 60px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {ITEMS.map(item => (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                background: '#fff', borderRadius: 18, padding: '20px',
                border: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.07)',
                cursor: 'pointer', textAlign: 'left', width: '100%',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{
                width: 50, height: 50, borderRadius: 14, background: item.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24, flexShrink: 0,
              }}>
                {item.icon}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 16, fontWeight: 700, color: '#1c1c1e', marginBottom: 2 }}>{item.label}</p>
                <p style={{ fontSize: 12, color: '#8e8e93' }}>{item.sub}</p>
              </div>
              <span style={{ fontSize: 18, color: '#c7c7cc' }}>›</span>
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}