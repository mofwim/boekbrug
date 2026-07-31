'use client'

// src/app/dashboard/zzp/ZzpDashboard.tsx
// [BOEK-029] Material You design — BoekBrug Design System v1.0 — May 2026
//
// ─────────────────────────────────────────────────────────────────────────────
// [DASH-SIMPLIFY] ZZP home information architecture (redesign, presentation-only)
// ─────────────────────────────────────────────────────────────────────────────
// WHY: the home used to be a flat list of 12 equal-weight ActionCards — a "wall of
// doors" the shop owner had to read top to bottom. Nothing was wrong functionally;
// it was just undifferentiated. This redesign REGROUPS the exact same destinations
// into four scannable sections and shrinks the six "record" screens into one compact
// grid. It is a pure presentation change:
//   · No route changed, no page removed, no data/fetch touched.
//   · Every destination that was reachable before is still reachable.
//   · The greeting, DailyTruth snapshot ("Waar je staat" + "Aandacht nodig"),
//     the "Ben ik klaar?" hero and the +Nieuwe factuur FAB are UNCHANGED.
//
// The four groups (see the render for the mapping):
//   1. Toevoegen         — the daily input actions (add bon/factuur, bulk upload)
//   2. Mijn administratie — the record screens as a 3-col tile grid
//                           (Facturen · Inkomend · Inkoopfacturen · Bank · Kas ·
//                            Dagomzet · Artikelen)
//   3. Cijfers & aangifte — "Je waarheid" (primary) + two compact MiniCards
//   4. Meer              — Mijn werkplek
//
// DELIBERATE DECISION — "Financieel overzicht" (/dashboard/resultaat) is kept as a
// de-emphasised MiniCard, NOT removed. It overlaps "Je waarheid", so the mockup
// showed only two number screens — but /dashboard/resultaat is reachable ONLY from
// this dashboard, so dropping the link would ORPHAN the page. Truly merging
// waarheid+resultaat is a separate product+page decision; do that at the page level
// (redirect resultaat → waarheid) before removing this link, never by orphaning.
//
// EXTENDING: add a record screen → add one <AdminTile> to the administratie grid
// (reuse the screen's existing icon + iconBg for visual continuity). Add a number
// screen → a MiniCard under "Je waarheid". Keep new top-level doors out of the flat
// list; put them in the group they belong to.
// ─────────────────────────────────────────────────────────────────────────────

import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase'
import { DashboardHeader } from '../_shared'
import { generateInvoiceFromPrompt } from '@/lib/ai'
import IntakeButton from '@/components/intake/IntakeButton'
// [HONEST-HOME] Re-enabled: the snapshot now shows only certain facts (exact stored
// invoice totals + a task count), each linking to the action that resolves it. The
// old version was disabled for showing inferred bank-derived numbers that were wrong.
import DailyTruth from './DailyTruth'
// [BRUG-RETOUR] De terugweg van de brug: een vraag van de boekhouder hoort op de home,
// niet alleen in een notificatie die je één keer ziet.
import { VRAAG_STATUS, vragenBannerTekst } from '@/lib/vragen'
import type { ProfileRow, NotificationRow } from '@/types/rows'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, R, COLUMN } from '@/lib/design/tokens'
// ─── Design tokens — BoekBrug Design System v1.0 ─────────────────────────────
const FONT = "'Roboto', -apple-system, sans-serif"
const EL1  = '0 1px 2px rgba(0,0,0,0.08)'
const EL2  = '0 2px 6px rgba(0,0,0,0.12)'

const NL_EUR = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }) // reserved for future use

// ─── Main ─────────────────────────────────────────────────────────────────────
export function ZzpDashboard({ profile }: { profile: ProfileRow }) {
  const router   = useRouter()
  const supabase = createClient()

  const [notifications, setNotifications]         = useState<NotificationRow[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreadMessages, setUnreadMessages]       = useState(0)
  const [accountantId, setAccountantId]           = useState<string | null>(null)
  const [showAiPanel, setShowAiPanel]             = useState(false)
  const [aiPrompt, setAiPrompt]                   = useState('')
  const [aiLoading, setAiLoading]                 = useState(false)
  const [aiError, setAiError]                     = useState<string | null>(null)
  // [BOEK-029] BOEK-011 integration — pending incoming invoices count
  const [pendingCount, setPendingCount]           = useState<number>(0)
  // [BRUG-RETOUR] Openstaande vragen van de boekhouder over eigen documenten.
  const [vragenCount, setVragenCount]             = useState<number>(0)

  async function loadGlobal() {
    const [{ data: link }, { data: notifData }, { count }, { count: vragen }] = await Promise.all([
      supabase.from('accountant_clients').select('accountant_id').eq('zzper_id', profile.id).maybeSingle(),
      supabase.from('notifications').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('receiver_id', profile.id).eq('read', false),
      // [BRUG-RETOUR] RLS (acc_status_client_read_document) beperkt dit al tot documenten
      // van deze gebruiker; er is hier geen eigenaarskolom om op te filteren.
      supabase.from('accountant_subject_status').select('subject_id', { count: 'exact', head: true })
        .eq('subject_type', 'document').eq('status', VRAAG_STATUS),
    ])
    if (link?.accountant_id) setAccountantId(link.accountant_id)
    if (notifData) setNotifications(notifData)
    setUnreadMessages(count || 0)
    setVragenCount(vragen || 0)

    // [BOEK-029] BOEK-011: fetch pending incoming invoices count
    try {
      const res = await fetch('/api/email/sync')
      if (res.ok) {
        const json = await res.json()
        setPendingCount(json.pending_count ?? 0)
      }
    } catch {
      // silent — badge blijft 0
    }
  }

  // Eén ophaalronde bij het openen. Staat bewust ná loadGlobal: een effect dat een functie
  // aanroept die pas verderop gedeclareerd wordt, werkt door hoisting wel maar is voor de
  // React-compiler niet te volgen (en breekt zodra iemand er een closure-waarde in gebruikt).
  useEffect(() => { void (async () => { await loadGlobal() })() }, [])

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('user_id', profile.id).eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return
    setAiLoading(true); setAiError(null)
    try {
      const result = await generateInvoiceFromPrompt(aiPrompt)
      const params = new URLSearchParams()
      if (result.client_name) params.set('client_name', result.client_name)
      if (result.description)  params.set('description', result.description)
      if (result.amount)       params.set('amount', String(result.amount))
      if (result.btw_rate)     params.set('btw_rate', String(result.btw_rate))
      router.push(`/dashboard/invoice/new?${params.toString()}`)
    } catch {
      setAiError('Er ging iets mis. Probeer het opnieuw.')
    } finally { setAiLoading(false) }
  }

  const unreadNotifCount = notifications.filter(n => !n.read).length
  const firstName = profile.full_name?.split(' ')[0] ?? 'daar'

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>
      <DashboardHeader
        profile={profile} notifications={notifications}
        showNotifications={showNotifications} unreadNotifCount={unreadNotifCount}
        unreadMessages={unreadMessages}
        onToggleNotifications={() => { setShowNotifications(p => !p) }}
        onMarkAllRead={markAllRead}
        onMessagesClick={() => accountantId ? router.push(`/dashboard/messages/${accountantId}`) : router.push('/dashboard/messages')}
        onLogout={async () => { await supabase.auth.signOut(); router.push('/login') }}
      />

      <main style={{ maxWidth: COLUMN.hub, margin: '0 auto', padding: '32px 16px 100px' }}>

        {/* Greeting */}
        <p style={{ fontSize: 12, color: '#5F6368', marginBottom: 2, fontWeight: 500, letterSpacing: 0.2 }}>GOEDENDAG</p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: M3.onSurface, marginBottom: 28, letterSpacing: -0.5 }}>
          {firstName} 👋
        </h1>
        {/* [BRUG-RETOUR] Een mens wacht op je. Dit staat bewust bóven de cijfers: een vraag
            van je boekhouder is het enige op deze pagina waar iemand anders op zit te
            wachten. Verschijnt alleen als er echt iets openstaat — nooit als lege balk. */}
        {vragenCount > 0 && (
          <button
            onClick={() => router.push('/dashboard/vragen')}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
              padding: '15px 16px', borderRadius: R.lg, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid #F0C36D', background: M3.warningContainer,
              boxShadow: EL1, marginBottom: 18,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#7a4f00' }}>help</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15.5, fontWeight: 700, color: '#5a3e00' }}>
                {vragenBannerTekst(vragenCount)}
              </span>
              <span style={{ display: 'block', fontSize: 12.5, color: '#7a4f00', marginTop: 2 }}>
                Bekijk de vraag en antwoord hier
              </span>
            </span>
            <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#7a4f00' }}>chevron_right</span>
          </button>
        )}

        {/* [HONEST-HOME] Snapshot: "waar sta ik?" answered with certain facts only,
            each a button to the action that resolves it. */}
        <DailyTruth />

        {/* [READINESS] The connective layer — one tap to "ben ik klaar voor de
            boekhouder?": a single verdict over everything imported (facturen, bank,
            dagomzet, BTW) with the few things that still need attention and one-click
            handover. Deliberately prominent (not a menu row) — it's the answer the
            store owner actually comes for. */}
        <button
          onClick={() => router.push('/dashboard/klaar')}
          style={{
            display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
            padding: '18px 18px', borderRadius: R.lg, cursor: 'pointer', fontFamily: 'inherit',
            border: 'none', background: 'linear-gradient(135deg, #1A73E8, #1557B0)',
            boxShadow: EL1, margin: '20px 0 8px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 30, color: '#fff' }}>fact_check</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: -0.2 }}>Ben ik klaar?</span>
            <span style={{ display: 'block', fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>Status van je kwartaal — en klaar voor de boekhouder</span>
          </span>
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'rgba(255,255,255,0.9)' }}>chevron_right</span>
        </button>

        {/* [DASH-SIMPLIFY] Grouped home — same destinations as before, now in four
            labelled sections instead of one flat list of 12 equal cards. See the
            file-header note for the full rationale and the group→route mapping.
            Order: what you DO (Toevoegen) → what you MANAGE (administratie) →
            what you GET (cijfers) → the rest (werkplek). Bigger gap BETWEEN groups
            (22) than WITHIN a group (12) so the sections read as distinct blocks. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

          {/* ── 1. TOEVOEGEN — the daily input actions ─────────────────────────── */}
          <section>
            <SectionLabel>Toevoegen</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Bon/factuur toevoegen — foto of bestand → AI sorteert. Own modal
                  (camera/upload); kept full-width as the primary daily action. */}
              <IntakeButton variant="card" />
              {/* [UPLOAD-HUB] Alles uploaden — many files at once; the app sorts them. */}
              <ActionCard
                icon="upload_file" iconBg="#1A73E8" iconColor="#fff"
                label="Alles uploaden" sub="Meerdere bestanden tegelijk — de app sorteert"
                onClick={() => router.push('/dashboard/upload')}
              />
            </div>
          </section>

          {/* ── 2. MIJN ADMINISTRATIE — the record screens as a compact grid ────── */}
          {/* Each tile reuses its screen's original icon + colour so nothing feels
              relocated, only regrouped. The two purchase surfaces sit adjacent:
              "Inkomend" is the verify QUEUE (/incoming, carries the pending-verify
              badge); "Inkoopfacturen" is the CONFIRMED crediteuren-management
              (/incoming/manage — mark paid, betaalstatus), which titles itself
              "Inkoopfacturen" and was previously only reachable from inside the
              queue. Surfaced here so the owner reaches their te-betalen bills
              straight from home. */}
          <section>
            <SectionLabel>Mijn administratie</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <AdminTile icon="description" tint="#00897B" label="Facturen"
                onClick={() => router.push('/dashboard/facturen')} />
              <AdminTile icon="mark_email_unread" tint="#0288D1" label="Inkomend" badge={pendingCount}
                onClick={() => router.push('/dashboard/incoming')} />
              {/* [NAV-FROM] ?from=home so Terug on Inkoopfacturen returns HERE. Without it the
                  canonical parent is /dashboard/incoming — a verification list this visitor never
                  passed through, since this tile jumps straight to the manage surface. */}
              <AdminTile icon="request_quote" tint="#E37400" label="Inkoopfacturen"
                onClick={() => router.push('/dashboard/incoming/manage?from=home')} />
              <AdminTile icon="account_balance" tint="#1A73E8" label="Bank"
                onClick={() => router.push('/dashboard/bank')} />
              <AdminTile icon="payments" tint="#00897B" label="Kas"
                onClick={() => router.push('/dashboard/kas')} />
              <AdminTile icon="point_of_sale" tint="#7B1FA2" label="Dagomzet"
                onClick={() => router.push('/dashboard/dagomzet')} />
              <AdminTile icon="inventory_2" tint="#5F6368" label="Artikelen"
                onClick={() => router.push('/dashboard/artikelen')} />
            </div>
          </section>

          {/* ── 3. CIJFERS & AANGIFTE — the numbers the owner comes for ─────────── */}
          {/* "Je waarheid" is the primary live view (full card). "Financieel
              overzicht" and "Concept BTW-aangifte" are compact MiniCards beneath it —
              kept reachable (never orphaned) but de-emphasised because they overlap
              the live view. See the file-header decision note before touching this. */}
          <section>
            <SectionLabel>Cijfers &amp; aangifte</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* [TRUTH-LENS] Je financiële waarheid — één live beeld (omzet, kosten,
                  winst, BTW) met tijd-lens. Zelfde reconcile-pijplijn als de aangifte. */}
              <ActionCard
                icon="monitoring" iconBg="#0B8043" iconColor="#fff"
                label="Je waarheid" sub="Omzet, winst en BTW — live, elke periode"
                onClick={() => router.push('/dashboard/waarheid')}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* [RESULT] Combined cross-channel result (invoices + bank + kas). */}
                <MiniCard icon="bar_chart" tint={M3.warning}
                  label="Financieel overzicht" sub="Resultaat & BTW"
                  onClick={() => router.push('/dashboard/resultaat')} />
                {/* [AANGIFTE] Concept rubrieken (1a/1b/5a/5b) — a draft, never a filing. */}
                <MiniCard icon="receipt_long" tint="#455A64"
                  label="Concept BTW-aangifte" sub="1a/1b/5a/5b"
                  onClick={() => router.push('/dashboard/aangifte')} />
              </div>
            </div>
          </section>

          {/* ── 4. MEER — secondary workspace ──────────────────────────────────── */}
          <section>
            <SectionLabel>Meer</SectionLabel>
            <ActionCard
              icon="work" iconBg={M3.success} iconColor="#fff"
              label="Mijn werkplek" sub="Klanten, bestanden en gegevens"
              onClick={() => router.push('/dashboard/werkplek')}
            />
          </section>

          {/* 4. Werken met AI
          <ActionCard
            icon="star" iconBg={M3.tertiary} iconColor="#fff"
            label="Werken met AI" sub="Beschrijf je factuur, AI regelt de rest"
            onClick={() => setShowAiPanel(p => !p)}
            active={showAiPanel}
            activeColor={M3.tertiary}
            activeBg={M3.tertiaryContainer}
          /> */}

          {/* AI Panel */}
          {showAiPanel && (
            <div style={{
              background: '#fff', borderRadius: R.lg, padding: '20px 16px',
              boxShadow: EL1, marginTop: -4,
              border: `1px solid ${M3.tertiaryContainer}`,
            }}>
              <p style={{ fontSize: 12, color: M3.tertiary, fontWeight: 600, marginBottom: 10, letterSpacing: 0.3 }}>
                SCHRIJF IN JOUW TAAL
              </p>
              <textarea
                value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={3}
                placeholder='"factuur voor Mohammed voor dakdekken, 3 uur à 85 euro"'
                style={{
                  width: '100%', borderRadius: R.md,
                  border: `2px solid ${aiPrompt ? M3.tertiary : '#80868b'}`,
                  padding: '14px 16px', fontSize: 16, resize: 'none',
                  fontFamily: FONT, outline: 'none', boxSizing: 'border-box',
                  background: M3.surface, color: M3.onSurface,
                  transition: 'border-color 0.15s',
                }}
              />
              {aiError && <p style={{ fontSize: 12, color: M3.error, marginTop: 6 }}>{aiError}</p>}
              <button
                onClick={handleAiGenerate} disabled={aiLoading || !aiPrompt.trim()}
                style={{
                  marginTop: 12, width: '100%', padding: '14px',
                  borderRadius: R.full, border: 'none',
                  cursor: aiLoading || !aiPrompt.trim() ? 'default' : 'pointer',
                  background: aiLoading || !aiPrompt.trim() ? '#f1f3f4' : M3.tertiary,
                  color: aiLoading || !aiPrompt.trim() ? '#80868b' : '#fff',
                  fontSize: 15, fontWeight: 600, transition: 'all 0.15s',
                }}
              >
                {aiLoading ? 'AI denkt na...' : 'Factuur aanmaken →'}
              </button>
            </div>
          )}

        </div>
      </main>

      {/* [BOEK-029] FAB — + Nieuwe factuur — the single primary create action.
          (The second, Intake FAB was removed — "Bon toevoegen" is the first card.) */}
      <Fab onClick={() => router.push('/dashboard/invoice/new')} />
    </div>
  )
}

// ─── Design system constants ──────────────────────────────────────────────────

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActionCard({ icon, iconBg, iconColor, label, sub, onClick, active, activeColor, activeBg }: {
  icon: string; iconBg: string; iconColor: string
  label: string; sub: string; onClick: () => void
  active?: boolean; activeColor?: string; activeBg?: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        background: active && activeBg ? activeBg : '#fff',
        borderRadius: R.lg, padding: '18px 16px',
        border: active && activeColor ? `2px solid ${activeColor}` : '2px solid transparent',
        boxShadow: EL1, cursor: 'pointer', textAlign: 'left', width: '100%',
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: R.md,
        background: iconBg, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0,
      }}>
        <span className="material-symbols-outlined" style={{ color: iconColor, fontSize: 24 }}>{icon}</span>
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 16, fontWeight: 600, color: '#202124', marginBottom: 2 }}>{label}</p>
        <p style={{ fontSize: 13, color: '#5F6368' }}>{sub}</p>
      </div>
      <span className="material-symbols-outlined" style={{ color: '#80868b', fontSize: 20 }}>chevron_right</span>
    </button>
  )
}

// [BOEK-029] StatCard removed — replaced by Financieel overzicht ActionCard
// [DASH-SIMPLIFY] ActionCardBadge removed — the only user (Inkomende facturen) is
// now an <AdminTile> in the administratie grid, which carries the badge itself.

// [DASH-SIMPLIFY] SectionLabel — the small uppercase header that turns the flat
// menu into scannable groups. Purely a grouping affordance; carries no state.
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p style={{
      fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
      color: '#8a929c', margin: '0 2px 10px',
    }}>
      {children}
    </p>
  )
}

// [DASH-SIMPLIFY] AdminTile — compact 3-per-row tile for the "Mijn administratie"
// record screens. Same icon-tile visual language as ActionCard, but centered and
// label-only so six sources read as ONE group instead of six full-width cards.
// `tint` is the screen's own accent colour (reused for continuity); `badge` is an
// optional count (used by Inkomend for the pending-verify queue).
function AdminTile({ icon, tint, label, badge, onClick }: {
  icon: string; tint: string; label: string; badge?: number; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        background: '#fff', borderRadius: R.lg, padding: '14px 6px 12px',
        border: 'none', boxShadow: EL1, cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div style={{
        position: 'relative', width: 46, height: 46, borderRadius: R.md,
        background: tint, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 24 }}>{icon}</span>
        {badge != null && badge > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5, background: '#B3261E', color: '#fff',
            borderRadius: 9999, minWidth: 18, height: 18, fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
            border: '2px solid #fff', fontFamily: FONT,
          }}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#202124', textAlign: 'center' }}>{label}</span>
    </button>
  )
}

// [DASH-SIMPLIFY] MiniCard — compact 2-per-row card for the secondary number
// screens (Financieel overzicht, Concept BTW-aangifte) that sit under the primary
// "Je waarheid". Left-aligned icon + label + short sub; no chevron (kept light).
function MiniCard({ icon, tint, label, sub, onClick }: {
  icon: string; tint: string; label: string; sub: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 11,
        background: '#fff', borderRadius: R.lg, padding: '13px 12px',
        border: 'none', boxShadow: EL1, cursor: 'pointer', textAlign: 'left', width: '100%',
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: R.sm, background: tint,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 20 }}>{icon}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', margin: 0, lineHeight: 1.2 }}>{label}</p>
        <p style={{ fontSize: 11, color: '#5F6368', margin: '2px 0 0' }}>{sub}</p>
      </div>
    </button>
  )
}

// [BOEK-029] Shared FAB — + Nieuwe factuur — all ZZP pages
function Fab({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'fixed',
        bottom: 'calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))',
        right: 20,
        background: '#D3E3FD',
        color: '#041E49',
        borderRadius: 16,
        padding: '16px 20px',
        fontSize: 15, fontWeight: 600,
        border: 'none', cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: "'Roboto', sans-serif",
        zIndex: 50,
        transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span>
      Nieuwe factuur
    </button>
  )
}