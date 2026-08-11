'use client'

// src/components/ui/FairUseModal.tsx
// [EERLIJK-GEBRUIK-UITLEG] The monthly allowance, explained where it cannot be missed.
//
// This replaces a toast. Reaching the limit is the most consequential thing this app tells an
// owner — from that moment documents are stored but not read, and every screen they open
// afterwards is missing invoices they believe were processed. It faded away in a few seconds,
// over the dashboard, saying only what pauses and never that a LIMIT had been reached.
//
// A modal is the right shape for exactly one reason: it has to be dismissed. Not because it is
// urgent — nothing is broken and nothing is lost — but because the owner must have SEEN it. The
// order of the content follows the order of their questions: is something broken (no), what still
// works, what pauses, when does it come back, and only then the two ways out.
//
// The copy is not written here. fair-use-notice.ts builds it from FAIR_USE_LIMITS, the same table
// /eerlijk-gebruik and Instellingen › Facturering read, so the three can never quote different
// numbers — and the numbers are a published promise.

import Link from 'next/link'
import { sheetPaddingBottom } from '@/lib/design/tokens'
import type { FairUseNotice } from '@/lib/fair-use-notice'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'

export default function FairUseModal({
  notice,
  onClose,
}: {
  notice: FairUseNotice
  onClose: () => void
}) {
  useCloseOnBack(true, onClose)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fairuse-title"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: 0,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: 'white',
          width: '100%', maxWidth: 480,
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          // [SHEET-BOTTOM] Count the bottom bar too, not only the device's safe
          // area: this panel sticks to the bottom of the screen, and on mobile
          // BottomNav paints on top of it.
          padding: '24px 20px 0', paddingBottom: sheetPaddingBottom(20),
          maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
        }}
      >
        <h2 id="fairuse-title" style={{ fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 6px' }}>
          {notice.title}
        </h2>

        {/* The number first, because "how far am I over?" is the question the toast never answered. */}
        {notice.count && (
          <p style={{ fontSize: 15, color: '#3c4043', margin: '0 0 16px' }}>{notice.count}</p>
        )}

        {/* Reassurance BEFORE the restriction. An owner who reads only the first block must walk
            away knowing nothing was lost — that is the fact that decides whether they panic. */}
        <div style={{ backgroundColor: '#E6F4EA', borderRadius: 12, padding: '12px 14px', margin: '0 0 12px' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#0B8043', margin: '0 0 4px' }}>
            Er is niets kwijt
          </p>
          <p style={{ fontSize: 14, color: '#202124', margin: 0, lineHeight: 1.5 }}>{notice.stillWorks}</p>
        </div>

        <div style={{ backgroundColor: '#F8F9FA', borderRadius: 12, padding: '12px 14px', margin: '0 0 12px' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#5f6368', margin: '0 0 4px' }}>
            Wat er pauzeert
          </p>
          <p style={{ fontSize: 14, color: '#202124', margin: 0, lineHeight: 1.5 }}>{notice.pauses}</p>
        </div>

        <p style={{ fontSize: 14, color: '#3c4043', margin: '0 0 20px', lineHeight: 1.5 }}>
          {notice.resets}
        </p>

        {/* Two ways out, and the free one is not hidden. Waiting costs nothing and is a real
            answer; presenting only the paid one would make the limit read as a trap. */}
        <Link
          href={notice.upgradeUrl}
          style={{
            display: 'block', textAlign: 'center', backgroundColor: '#1a73e8', color: 'white',
            fontSize: 16, fontWeight: 600, padding: '14px 16px', borderRadius: 12,
            textDecoration: 'none', marginBottom: 10,
          }}
        >
          Bekijk Plus
        </Link>
        <button
          type="button"
          onClick={onClose}
          style={{
            display: 'block', width: '100%', textAlign: 'center', backgroundColor: 'white',
            color: '#3c4043', fontSize: 16, fontWeight: 600, padding: '13px 16px',
            border: '1px solid #dadce0', borderRadius: 12, cursor: 'pointer', marginBottom: 14,
          }}
        >
          Ik wacht tot volgende maand
        </button>

        <Link
          href={notice.beleidUrl}
          style={{ display: 'block', textAlign: 'center', fontSize: 13, color: '#5f6368' }}
        >
          Lees het beleid eerlijk gebruik
        </Link>
      </div>
    </div>
  )
}
