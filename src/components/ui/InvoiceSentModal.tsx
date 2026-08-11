'use client'

// src/components/ui/InvoiceSentModal.tsx
// [VERSTUURD] The confirmation after "✉ Opslaan en versturen".
//
// The button did the most consequential thing in the app — minted a permanent invoice number,
// rendered the PDF, mailed it to a customer — and then the screen simply replaced itself with the
// invoice detail page. Nothing said "gelukt", nothing named the number, nothing said what could no
// longer be changed. An owner sending their first invoice had no way to tell a success from a
// silent failure except by going to look.
//
// WHY A MODAL AND NOT A TOAST. Same reason as FairUseModal: it has to be dismissed. A toast that
// fades in three seconds is the wrong shape for "this number is now permanent" — and this screen
// used to navigate away by itself, which is the fastest-fading notification there is. The owner
// decides when to leave, and leaves by choosing where to go.
//
// The words come from invoice-sent-notice.ts, tested there. This file is layout only.

import { sheetPaddingBottom } from '@/lib/design/tokens'
import type { InvoiceSentNotice } from '@/lib/invoice-sent-notice'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'

export default function InvoiceSentModal({
  notice,
  onView,
  onNew,
}: {
  notice: InvoiceSentNotice
  /** Go to the invoice that was just sent. Also what the backdrop and the back button do. */
  onView: () => void
  /** Start another one without a detour through the detail page. */
  onNew: () => void
}) {
  // Closing this panel may never leave the owner on a form that has already been submitted — the
  // invoice exists and is numbered. Every exit therefore navigates; the backdrop takes the same
  // route as the primary button.
  useCloseOnBack(true, onView)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="verstuurd-title"
      onClick={onView}
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
          // [SHEET-BOTTOM] Count the bottom bar too, not only the device's safe area.
          padding: '24px 20px 0', paddingBottom: sheetPaddingBottom(20),
          maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span
            aria-hidden
            style={{
              width: 28, height: 28, borderRadius: '50%', backgroundColor: '#E6F4EA',
              color: '#137333', fontSize: 15, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            ✓
          </span>
          <h2 id="verstuurd-title" style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: 0 }}>
            {notice.title}
          </h2>
        </div>

        <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.6, margin: '0 0 16px' }}>
          {notice.lead}
        </p>

        {/* The irreversible part comes FIRST, before the reassurance. An owner who reads only the
            top of this panel must still have read the thing they cannot undo. */}
        <div
          style={{
            backgroundColor: '#FEF7E0', border: '1px solid #F9AB00', borderRadius: 12,
            padding: 12, marginBottom: 16,
          }}
        >
          <p style={{ fontSize: 13, color: '#5F4200', lineHeight: 1.6, margin: 0 }}>
            {notice.definitief}
          </p>
        </div>

        <div
          style={{
            backgroundColor: '#F8F9FA', borderRadius: 12, padding: 12,
            display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16,
          }}
        >
          {notice.rows.map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: '#5F6368' }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#202124', textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* "How do I know it arrived correctly?" — the question this panel exists to answer, so it
            is on the screen rather than in a help page nobody opens at this moment. */}
        <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', margin: '0 0 6px' }}>
          Zo controleer je het zelf
        </p>
        <ul style={{ margin: '0 0 20px', padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {notice.controle.map((regel) => (
            <li key={regel} style={{ fontSize: 13, color: '#5F6368', lineHeight: 1.6 }}>{regel}</li>
          ))}
        </ul>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={onView}
            style={{
              minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: '#1A73E8',
              color: 'white', fontSize: 16, fontWeight: 600, cursor: 'pointer', width: '100%',
            }}
          >
            Bekijk de factuur
          </button>
          <button
            onClick={onNew}
            style={{
              minHeight: 48, borderRadius: 9999, border: 'none', backgroundColor: '#F1F3F4',
              color: '#5F6368', fontSize: 14, fontWeight: 500, cursor: 'pointer', width: '100%',
            }}
          >
            Nog een factuur maken
          </button>
        </div>
      </div>
    </div>
  )
}
