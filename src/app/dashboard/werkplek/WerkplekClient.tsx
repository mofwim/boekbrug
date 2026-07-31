'use client'

// src/app/dashboard/werkplek/WerkplekClient.tsx
// [BOEK-029] Material You design — BoekBrug Design System v1.0 — May 2026
// [CONTROL] UI extracted from page.tsx so page.tsx can server-guard the role.

import { useRouter } from 'next/navigation'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, COLUMN } from '@/lib/design/tokens'

const FONT = "'Roboto', -apple-system, sans-serif"
const R    = { md: 12, lg: 16, xl: 24 }
const EL1  = '0 1px 2px rgba(0,0,0,0.08)'

const ITEMS = [
  { icon: 'receipt_long', label: 'Mijn facturen',  sub: 'Verstuur en beheer',      href: '/dashboard/facturen', bg: M3.primary,   color: '#fff' },
  { icon: 'folder_open',  label: 'Mijn bestanden', sub: 'Bonnen en documenten',     href: '/dashboard/bestanden', bg: M3.warning,   color: '#fff' },
  // [COHERENCE-ORPHAN] De Brug — the app's namesake invoice↔document tree — had no ZZP
  // entry point (only accountant surfaces linked to it), so the owner could never open it.
  { icon: 'account_tree', label: 'De Brug',        sub: 'Zie hoe je facturen en documenten verbonden zijn', href: '/dashboard/brug', bg: '#1967D2', color: '#fff' },
  { icon: 'people',       label: 'Mijn klanten',   sub: 'Klantgegevens en history', href: '/dashboard/klanten',  bg: M3.success,   color: '#fff' },
  { icon: 'shield',       label: 'Compliance-kluis', sub: '7 jaar bewaren, klaar voor je boekhouder', href: '/dashboard/kluis', bg: '#455A64', color: '#fff' },
  { icon: 'settings',     label: 'Mijn gegevens',  sub: 'Bedrijf en account',       href: '/dashboard/settings', bg: M3.tertiary,  color: '#fff' },
]

export default function WerkplekClient() {
  const router = useRouter()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>

      <main style={{ maxWidth: COLUMN.hub, margin: '0 auto', padding: '20px 16px 80px' }}>
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
              <span className="material-symbols-outlined" style={{ color: '#80868b', fontSize: 20 }}>chevron_right</span>
            </button>
          ))}
        </div>
      </main>

      {/* [BOEK-029] FAB — + Nieuwe factuur — Material You */}
      <button
        onClick={() => router.push('/dashboard/invoice/new')}
        style={{
          position: 'fixed',
          bottom: 'calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))',
          right: 20,
          background: '#D3E3FD', color: '#041E49',
          borderRadius: 16, padding: '16px 20px',
          fontSize: 15, fontWeight: 600,
          border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: "'Roboto', sans-serif", zIndex: 50,
          transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span>
        Nieuwe factuur
      </button>
    </div>
  )
}
