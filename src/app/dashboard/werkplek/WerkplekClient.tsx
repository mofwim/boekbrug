'use client'

// src/app/dashboard/werkplek/WerkplekClient.tsx
// [BOEK-029] Material You design — BoekBrug Design System v1.0 — May 2026
// [CONTROL] UI extracted from page.tsx so page.tsx can server-guard the role.

import { useRouter } from 'next/navigation'

const M3 = {
  primary:  '#1A73E8', primaryContainer: '#D3E3FD', onPrimaryContainer: '#041E49',
  surface:  '#FFFBFE', onSurface: '#1C1B1F',
  success:  '#34A853', warning: '#E37400', tertiary: '#7B1FA2',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
const R    = { md: 12, lg: 16, xl: 24 }
const EL1  = '0 1px 2px rgba(0,0,0,0.08)'

const ITEMS = [
  { icon: 'receipt_long', label: 'Mijn facturen',  sub: 'Verstuur en beheer',      href: '/dashboard/facturen', bg: M3.primary,   color: '#fff' },
  { icon: 'folder_open',  label: 'Mijn bestanden', sub: 'Bonnen en documenten',     href: '/dashboard/bestanden', bg: M3.warning,   color: '#fff' },
  { icon: 'people',       label: 'Mijn klanten',   sub: 'Klantgegevens en history', href: '/dashboard/klanten',  bg: M3.success,   color: '#fff' },
  { icon: 'shield',       label: 'Compliance-kluis', sub: '7 jaar bewaren, klaar voor je boekhouder', href: '/dashboard/kluis', bg: '#455A64', color: '#fff' },
  { icon: 'settings',     label: 'Mijn gegevens',  sub: 'Bedrijf en account',       href: '/dashboard/settings', bg: M3.tertiary,  color: '#fff' },
]

export default function WerkplekClient() {
  const router = useRouter()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>

      {/* Sticky header — Material You top app bar */}
      <div style={{
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        {/* [CONTROL] deterministic parent (/dashboard) via replace — the old
            router.back() was history-dependent and could loop (nav contract). */}
        <button onClick={() => router.replace('/dashboard')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, color: M3.primary, fontWeight: 600, fontSize: 14, padding: 0, fontFamily: FONT }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>arrow_back</span>
          Terug
        </button>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: M3.onSurface, flex: 1, textAlign: 'center', marginRight: 64 }}>
          Mijn werkplek
        </h1>
      </div>

      <main style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 80px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ITEMS.map(item => (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                background: '#fff', borderRadius: R.lg, padding: '18px 16px',
                border: 'none', boxShadow: EL1,
                cursor: 'pointer', textAlign: 'left', width: '100%',
                transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
                WebkitTapHighlightColor: 'transparent',
              }}
              onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
              onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <div style={{
                width: 50, height: 50, borderRadius: R.md,
                background: item.bg, display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: 0,
              }}>
                <span className="material-symbols-outlined" style={{ color: item.color, fontSize: 26 }}>{item.icon}</span>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 16, fontWeight: 600, color: M3.onSurface, marginBottom: 2 }}>{item.label}</p>
                <p style={{ fontSize: 13, color: '#5F6368' }}>{item.sub}</p>
              </div>
              <span className="material-symbols-outlined" style={{ color: '#79747E', fontSize: 20 }}>chevron_right</span>
            </button>
          ))}
        </div>
      </main>

      {/* [BOEK-029] FAB — + Nieuwe factuur — Material You */}
      <button
        onClick={() => router.push('/dashboard/invoice/new')}
        style={{
          position: 'fixed',
          bottom: 'calc(24px + env(safe-area-inset-bottom))',
          right: 20,
          background: '#D3E3FD', color: '#041E49',
          borderRadius: 16, padding: '16px 20px',
          fontSize: 15, fontWeight: 600,
          border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: "'Google Sans', 'Roboto', sans-serif", zIndex: 50,
          transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        }}
        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.95)')}
        onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span>
        Nieuwe factuur
      </button>
    </div>
  )
}
