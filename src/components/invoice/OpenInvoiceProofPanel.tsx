'use client'

// src/components/invoice/OpenInvoiceProofPanel.tsx
// [OPENSTAAND-BEWIJS] The quiet line that does the actual work, on both money screens.
//
// ── WHY ONE COMPONENT AND NOT TWO ──
//
// The purchase list and the sales list ask the same question of opposite money: is anything we
// call OPEN already settled? Two copies of this panel would be two copies of a promise about the
// owner's books, and the copies drift — that is not a hypothetical in this repo, it is how eleven
// versions of a status chip came to disagree about four statuses. One component, one sentence
// structure, one set of states.
//
// ── WHAT IT PAINTS, AND WHY IT IS DELIBERATELY CALM ──
//
// Everything else on those screens is a CONCLUSION. This is the only thing that states the SEARCH
// — how many invoices were held against how many bank lines, and up to which day the bank data
// reaches. Every number in it is checkable against the owner's own bank in seconds, which is the
// whole difference between an assertion and a proof.
//
// It finds nothing nearly always, and that is the state it is designed for. A green badge shouting
// "ALLES GECONTROLEERD" is decoration; a grey sentence with three real numbers in it is evidence,
// and the evidence is what people come to rely on.
//
// The component holds NO language and NO direction of its own — both travel on the panel object
// built by open-invoice-proof-text.ts. One hard-coded string here is how a translation stays
// permanently half-finished: the screen still looks right in Dutch, so nothing points at the gap.

import { M3, R } from '@/lib/design/tokens'
import type { OpenInvoiceProofPanel as ProofPanel } from '@/lib/open-invoice-proof-text'

const FONT = "'Roboto', -apple-system, sans-serif"

export default function OpenInvoiceProofPanel({ panel }: { panel: ProofPanel | null | undefined }) {
  if (!panel) return null
  const { alarm, failed } = panel
  return (
    <div
      role="status"
      dir={panel.dir}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10,
        padding: '11px 13px', borderRadius: R.md, fontFamily: FONT,
        border: `1px solid ${alarm ? '#F7DFA5' : M3.outlineVariant}`,
        background: alarm ? M3.warningContainer : M3.surface,
        textAlign: 'start',
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 18, flexShrink: 0, marginTop: 1, color: alarm ? '#7C5800' : M3.neutral }}
      >
        {alarm ? 'price_check' : 'fact_check'}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        {/* [NO-SILENT-EMPTY] A proof that could not run may never read as one that found nothing —
            over a list of what is owed, that is the most convincing lie the app could tell. The
            colour is the second half of that: the failure sentence is never grey like a result. */}
        <p style={{
          fontSize: 12.5, margin: 0, lineHeight: 1.5,
          color: failed ? M3.error : alarm ? '#7C5800' : M3.neutral,
        }}>
          {panel.lead}
        </p>

        {/* Each row names BOTH numbers — what we call open, and the payment that looks like it —
            and ends in a question. Never applied: both come from a reading, and picking a winner
            is the overconfidence that produces the wrong number in the first place. */}
        {panel.rows.map((row) => (
          <div key={row.invoiceId} style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${M3.outlineVariant}` }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: M3.onSurface, margin: 0, lineHeight: 1.4 }}>
              {row.title}
            </p>
            <p style={{ fontSize: 12.5, color: '#7C5800', margin: '2px 0 0', lineHeight: 1.45 }}>
              {row.question}
            </p>
          </div>
        ))}

        {/* [NO-SILENT-EMPTY] A bounded check presented as a complete one is exactly the false
            reassurance this panel exists to remove. */}
        {panel.bounded && (
          <p style={{ fontSize: 11.5, color: M3.neutral, margin: '6px 0 0', lineHeight: 1.45 }}>
            {panel.bounded}
          </p>
        )}
      </div>
    </div>
  )
}
