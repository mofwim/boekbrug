'use client'

// src/modules/accountant/pages/AccountantWerkplek.tsx
// [BOEK-028] Accountant werkplek — 4 tools — Google Workspace design — May 2026

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useParentPath } from '@/lib/navigation-hooks'

// ─────────────────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    icon: '👥',
    label: 'Klanten beheren',
    sub: 'Toevoegen, koppelen, verwijderen',
    href: '/dashboard/clients/beheer',
    isNew: true,
  },
  {
    // [BRIDGE-ACC-SURFACE] ACC-2: the Bridge is the accountant's lens on the
    // client's financial truth — the single channel for client documents.
    icon: '🌉',
    label: 'Brug',
    sub: 'Documenten van je klanten',
    href: '/brug',
    isNew: true,
  },
  {
    icon: '📄',
    label: 'Mijn facturen',
    sub: 'Facturen die jij aan klanten stuurt',
    href: '/dashboard/facturen',
    isNew: false,
  },
  {
    // [BRIDGE-ACC-SURFACE] ACC-3: was labelled "Alle bestanden — van al je
    // klanten", which was untrue: /dashboard/bestanden is scoped to user_id
    // (the accountant's OWN storage — templates, internal docs), not client
    // data. Relabelled honestly; client documents live in the Bridge above.
    // Route unchanged — separation already exists at the data layer.
    icon: '📁',
    label: 'Mijn eigen bestanden',
    sub: 'Sjablonen en eigen documenten',
    href: '/dashboard/bestanden',
    isNew: false,
  },
  {
    icon: '⚙️',
    label: 'Mijn gegevens',
    sub: 'Kantoorgegevens en account',
    href: '/dashboard/settings',
    isNew: false,
  },
]

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function AccountantWerkplek() {
  const router = useRouter()
  const parentHref = useParentPath('accountant')

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: "'Google Sans', 'Roboto', sans-serif" }}>

      {/* Header */}
      <div style={{
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #E0E0E0',
        padding: '0 24px',
        height: 64,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}>
        <Link
          href={parentHref}
          style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, color: '#1A73E8', fontSize: 14, fontWeight: 500 }}
        >
          ← Terug
        </Link>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#202124', margin: 0 }}>
          Mijn werkplek
        </h1>
      </div>

      {/* Tool list */}
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, overflow: 'hidden' }}>
          {TOOLS.map((tool, idx) => (
            <button
              key={tool.href}
              onClick={() => router.push(tool.href)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '16px 20px',
                background: 'none',
                border: 'none',
                borderBottom: idx < TOOLS.length - 1 ? '1px solid #E0E0E0' : 'none',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.1s',
                minHeight: 72,
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F9FA')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              {/* Icon */}
              <span style={{ fontSize: 24, flexShrink: 0, width: 36, textAlign: 'center' }}>
                {tool.icon}
              </span>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: '#202124', margin: 0 }}>
                    {tool.label}
                  </p>
                  {tool.isNew && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: '#1967D2',
                      backgroundColor: '#D3E3FD', padding: '1px 6px',
                      borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>
                      Nieuw
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>
                  {tool.sub}
                </p>
              </div>

              {/* Arrow */}
              <span style={{ color: '#1A73E8', fontSize: 18, fontWeight: 600, flexShrink: 0 }}>→</span>
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}