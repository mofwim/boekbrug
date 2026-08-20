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

import { useCallback, useState } from 'react'

import { M3, R } from '@/lib/design/tokens'
import type { OpenInvoiceProofPanel as ProofPanel } from '@/lib/open-invoice-proof-text'

const FONT = "'Roboto', -apple-system, sans-serif"

/**
 * [BEWIJS-BEANTWOORDEN] What a row's cross does.
 *
 * The panel used to ask "Klopt het dat deze factuur nog openstaat?" and give the owner nothing to
 * answer with — so someone who checked it once saw the same question every time they opened the
 * screen. A question with no answer teaches people to read past the panel, and this panel is the
 * one place in the app that shows its working.
 *
 * The handler is passed IN rather than reached for here, because storage is not this component's
 * business and a component that touches localStorage cannot be rendered by the render gate.
 */
export interface ProofPanelActions {
  /** The owner answered this question: stop asking about this invoice-and-payment pair. */
  onAnswer: (ackKey: string) => void
  /** Bring every put-away question back. */
  onShowAgain: () => void
}

export default function OpenInvoiceProofPanel({
  panel, actions,
}: {
  panel: ProofPanel | null | undefined
  /** Absent on a surface that has nowhere to keep an answer — the panel then simply has no cross. */
  actions?: ProofPanelActions
}) {
  // Called before the early return: a hook may not be skipped, and `panel` is null on most renders
  // of most screens, so this is the one order that is legal in both.
  const [busy, setBusy] = useState<string | null>(null)
  const answer = useCallback((key: string) => {
    setBusy(key)
    actions?.onAnswer(key)
  }, [actions])

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
          <div key={row.ackKey} style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${M3.outlineVariant}` }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: M3.onSurface, margin: 0, lineHeight: 1.4 }}>
              {row.title}
            </p>
            <p style={{ fontSize: 12.5, color: '#7C5800', margin: '2px 0 0', lineHeight: 1.45 }}>
              {row.question}
            </p>
            {/* The answer. It says what the owner ESTABLISHED — "Ja, staat nog open" — rather than
                what the button does to the screen: "sluiten" leaves it open which of the two
                things was found, and this row is a question about money.

                It never books anything and never marks anything paid. The opposite answer is not
                a button here on purpose: if the invoice IS already paid, that is a payment to
                link on the invoice itself, and a one-tap "mark as paid" built on a LIKENESS is
                exactly the overconfidence the rest of this panel refuses. */}
            {actions && (
              <button
                type="button"
                onClick={() => answer(row.ackKey)}
                disabled={busy === row.ackKey}
                aria-label={panel.answerAria}
                style={{
                  marginTop: 6, padding: '5px 11px', borderRadius: R.full, cursor: 'pointer',
                  border: `1px solid ${M3.outlineVariant}`, background: M3.surface,
                  color: M3.neutral, fontFamily: FONT, fontSize: 12, fontWeight: 600,
                }}
              >
                {panel.answerLabel}
              </button>
            )}
          </div>
        ))}

        {/* What the answer button means, said once under the rows rather than on every one of
            them. An answered question that silently returned would be indistinguishable from a
            bug; this is the sentence that makes its return make sense. */}
        {actions && panel.rows.length > 0 && (
          <p style={{ fontSize: 11.5, color: M3.neutral, margin: '6px 0 0', lineHeight: 1.45 }}>
            {panel.answerNote}
          </p>
        )}

        {/* [BINNENGEKOMEN-BEWIJS] The same search, said from the money's side: what came in, how
            much of it looks like a known invoice, and what the rest add up to. That last figure is
            the one this app never showed — readiness counts unexplained receipts, and a count
            cannot tell three payments of € 5 from three of € 5.000. Only the second is turnover
            that was never invoiced.

            Never an accusation: a payment with no invoice can be a deposit, a private transfer or
            a refund, and the owner is the only one who knows which. */}
        {panel.incoming.map((zin, i) => (
          <p key={i} style={{
            fontSize: 12.5, margin: i === 0 ? '8px 0 0' : '2px 0 0', lineHeight: 1.5,
            paddingTop: i === 0 ? 8 : 0,
            borderTop: i === 0 ? `1px solid ${M3.outlineVariant}` : undefined,
            color: M3.neutral,
          }}>
            {zin}
          </p>
        ))}

        {/* [NO-SILENT-EMPTY] A bounded check presented as a complete one is exactly the false
            reassurance this panel exists to remove. */}
        {panel.bounded && (
          <p style={{ fontSize: 11.5, color: M3.neutral, margin: '6px 0 0', lineHeight: 1.45 }}>
            {panel.bounded}
          </p>
        )}

        {/* [BEWIJS-BEANTWOORDEN] What has been put away, and the way back to it.
            Putting a row away is the owner's decision; hiding the FACT that a row was put away
            would be ours, and this is the panel whose entire job is to be checkable. */}
        {panel.hidden && (
          <p style={{ fontSize: 11.5, color: M3.neutral, margin: '6px 0 0', lineHeight: 1.45 }}>
            {panel.hidden}{' '}
            {actions && (
              <button
                type="button"
                onClick={actions.onShowAgain}
                style={{
                  border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                  color: M3.primary, fontFamily: FONT, fontSize: 11.5, fontWeight: 600,
                  textDecoration: 'underline',
                }}
              >
                {panel.hiddenAction}
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
