'use client'

// src/modules/accountant/pages/AangifteAgenda.tsx
// [AANGIFTE-AGENDA] The accountant's daily driver: one screen with the current
// BTW-aangifte deadline (Belastingdienst = the month after the quarter) and every
// client's honest readiness for that quarter, sorted needs-attention first. All
// data arrives as props (fetched server-side via accountant.repository.ts). This
// component handles UI only — no supabase.from(). Visual language is identical to
// AccountantWerkplek / AccountantHome (Google Workspace design, Roboto, #F8F9FA).

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useParentPath } from '@/lib/navigation-hooks'
import type { AangifteAgenda, ClientReadiness } from '../accountant.types'

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

const NL_MONTHS = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
]

/** '2026-07-31' → '31 juli 2026' */
function formatDutchDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${NL_MONTHS[m - 1]} ${y}`
}

/**
 * Honest, fact-derived display status for one client — the same ranking the
 * repository sorts on, expressed as a chip. Never asserts a "klaar" verdict: the
 * green state means "every shared invoice processed + bank present", stated as a
 * fact the accountant can verify, not a guess about un-uploaded receipts.
 */
function statusOf(r: ClientReadiness): { label: string; color: string; bg: string; sub: string } {
  const unprocessed = r.sharedInvoices - r.processedInvoices
  const facts = `${r.processedInvoices}/${r.sharedInvoices} verwerkt · ${r.hasBankData ? 'bank ✓' : 'geen bank'}`

  if (r.sharedInvoices === 0 && !r.hasBankData) {
    return { label: 'Niets ontvangen', color: '#5F6368', bg: '#F1F3F4', sub: 'Nog geen facturen of bankgegevens' }
  }
  if (r.openQuestions > 0) {
    return {
      label: r.openQuestions > 1 ? `Vraag open (${r.openQuestions})` : 'Vraag open',
      color: '#C5221F', bg: '#FCE8E6', sub: facts,
    }
  }
  if (unprocessed > 0 || !r.hasBankData) {
    return { label: 'In behandeling', color: '#B26A00', bg: '#FEEFC3', sub: facts }
  }
  return { label: 'Alles verwerkt', color: '#137333', bg: '#CEEAD6', sub: facts }
}

/** Deadline urgency → colour for the hero countdown. */
function deadlineColor(days: number): string {
  if (days < 0) return '#C5221F'   // overdue
  if (days <= 7) return '#C5221F'  // this week
  if (days <= 14) return '#B26A00' // amber
  return '#1A73E8'                 // comfortable
}

function countdownLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'dag' : 'dagen'} verlopen`
  if (days === 0) return 'Vandaag'
  return `Nog ${days} ${days === 1 ? 'dag' : 'dagen'}`
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function AangifteAgendaPage({ agenda }: { agenda: AangifteAgenda }) {
  const router = useRouter()
  const parentHref = useParentPath('accountant')

  const { year, quarter, deadline, daysUntilDeadline, items } = agenda
  const heroColor = deadlineColor(daysUntilDeadline)

  // Honest headline counts — "actie nodig" = anything not fully processed.
  const done = items.filter(
    i => i.readiness.processedInvoices >= i.readiness.sharedInvoices
      && i.readiness.sharedInvoices > 0
      && i.readiness.hasBankData
      && i.readiness.openQuestions === 0,
  ).length
  const actionNeeded = items.length - done

  function openClient(clientId: string) {
    router.push(`/dashboard/clients/${clientId}/kwartaal?q=${quarter}&year=${year}`)
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: "'Roboto', sans-serif" }}>

      {/* Header — identical to AccountantWerkplek */}
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
          Aangifte-agenda
        </h1>
      </div>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Hero: the deadline countdown ── */}
        <div style={{
          backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8,
          padding: '20px', display: 'flex', alignItems: 'center', gap: 16,
          borderLeft: `4px solid ${heroColor}`,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#5F6368', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              BTW-aangifte Q{quarter} {year}
            </p>
            <p style={{ fontSize: 28, fontWeight: 700, color: heroColor, margin: '0 0 4px', lineHeight: 1.1 }}>
              {countdownLabel(daysUntilDeadline)}
            </p>
            <p style={{ fontSize: 13, color: '#5F6368', margin: 0 }}>
              Uiterlijk {formatDutchDate(deadline)}
            </p>
          </div>
          <span style={{ fontSize: 40, flexShrink: 0 }}>🗓️</span>
        </div>

        {/* ── Honest headline counts (same 3-tile style as AccountantHome) ── */}
        {items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { n: items.length, label: 'Klanten', color: '#202124' },
              { n: actionNeeded, label: 'Actie nodig', color: actionNeeded > 0 ? '#C5221F' : '#5F6368' },
              { n: done, label: 'Alles verwerkt', color: done > 0 ? '#137333' : '#5F6368' },
            ].map(s => (
              <div key={s.label} style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, padding: '12px 8px', textAlign: 'center' }}>
                <p style={{ fontSize: 22, fontWeight: 700, color: s.color, margin: 0 }}>{s.n}</p>
                <p style={{ fontSize: 11, color: '#5F6368', margin: '2px 0 0' }}>{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Client list — needs-attention first ── */}
        <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>
              Per klant
            </h2>
          </div>

          {items.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', padding: '32px 16px', textAlign: 'center', margin: 0 }}>
              Nog geen klanten gekoppeld
            </p>
          ) : (
            items.map((item, idx) => {
              const s = statusOf(item.readiness)
              return (
                <button
                  key={item.client_id}
                  onClick={() => openClient(item.client_id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px', background: 'none', border: 'none',
                    borderBottom: idx < items.length - 1 ? '1px solid #F1F3F4' : 'none',
                    cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
                    minHeight: 60,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F8F9FA')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  {/* Name + facts */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#202124', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.client_name}
                    </p>
                    <p style={{ fontSize: 12, color: '#5F6368', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.sub}
                    </p>
                  </div>

                  {/* Status chip */}
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: s.color, backgroundColor: s.bg,
                    padding: '3px 8px', borderRadius: 6, flexShrink: 0, whiteSpace: 'nowrap',
                  }}>
                    {s.label}
                  </span>

                  {/* Arrow */}
                  <span style={{ color: '#1A73E8', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>→</span>
                </button>
              )
            })
          )}
        </div>

        {/* Honest footnote — the app never fakes "klaar" (see readiness.ts) */}
        <p style={{ fontSize: 11, color: '#80868b', margin: '0 4px', lineHeight: 1.5 }}>
          Status is gebaseerd op wat is aangeleverd en verwerkt — geen automatisch
          &ldquo;klaar&rdquo;-oordeel. Tik op een klant om het kwartaal te openen.
        </p>

      </main>
    </div>
  )
}
