'use client'

// src/components/invoice/PaymentEvidenceLine.tsx
// [BETAALBEWIJS] Under every "Betaald", the line that says how we know — on both money screens.
//
// ── WHY THIS IS NOT JUST A LABEL ──
//
// "Betaald" is a conclusion. It is read off amount_paid, and until this feature existed no screen
// had ever looked at bank_tx_invoices — so the word carried no evidence, and an owner who wanted
// to check it had to open their bank in another tab and search. That is exactly the work the app
// was bought to remove, handed back at the moment trust is being asked for.
//
// ── AND WHY THE THREE STATES MAY NOT LOOK THE SAME ──
//
// A payment proven by a bank line is corroborated by a third party. A payment the owner ticked by
// hand is a memory — usually perfectly true, and simply not the same claim. Rendering them
// identically borrows the bank's authority for the tick, and when the tick was a mistake nothing
// on the screen ever says so.
//
// The third state is the one nobody thinks of and the only one worth interrupting for: an invoice
// standing as paid with NO link at all. On a purchase invoice that is a bill that may still be
// owed; on a SALES invoice it is money the owner believes came in and never chases again. It is
// amber, not grey, for that reason.
//
// The component holds no language and no direction of its own — both travel on the line object
// built by payment-evidence.ts.

import type React from 'react'

import { M3 } from '@/lib/design/tokens'
import type { PaymentEvidenceLine as EvidenceLine } from '@/lib/payment-evidence'

/** Bank green, the owner's own tick in grey, a failed read in red, and the empty claim in amber. */
const TONE: Record<EvidenceLine['tone'], string> = {
  bank: '#0B8043',
  hand: M3.neutral,
  onbekend: M3.error,
  geen: '#7C5800',
}

export default function PaymentEvidenceLine({ line }: { line: EvidenceLine | null | undefined }) {
  if (!line) return null
  const base: React.CSSProperties = {
    display: 'block', whiteSpace: 'normal', marginTop: 3, lineHeight: 1.4,
    fontSize: 11.5, textAlign: 'start',
  }
  return (
    <span dir={line.dir} style={{ display: 'block' }}>
      <span style={{ ...base, color: TONE[line.tone] }}>{line.text}</span>

      {/* [DEELBETALING-BEWIJS] The terms the lead is made of. On a partly settled invoice "nog
          € 460 open" is the hardest number in the app to check by hand — the owner would have to
          open their bank and add up, which is the work this product exists to remove. Each term
          carries its OWN evidence, so a bank-proven instalment and a hand-recorded one are never
          flattened into one claim about the whole invoice. */}
      {line.entries.map((entry, i) => (
        <span key={i} style={{ ...base, marginTop: 1, paddingInlineStart: 10, color: M3.neutral }}>
          · {entry}
        </span>
      ))}

      {/* [NO-SILENT-EMPTY] invoices.amount_paid is a cached sum of exactly those terms. When the
          two disagree the screen is showing a remainder no instalment supports, and it may not
          quietly believe one side — so it names both figures and leaves the judgement where it
          belongs. Red, because this is the one line here that asks for action. */}
      {line.warning && (
        <span style={{ ...base, marginTop: 2, color: M3.error, fontWeight: 600 }}>
          {line.warning}
        </span>
      )}
    </span>
  )
}
