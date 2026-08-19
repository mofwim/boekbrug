'use client'

// src/components/invoice/CreditEvidenceLine.tsx
// [CREDIT-BEWIJS] Under "Deels gecrediteerd · € 250", which credit notes that is.
//
// The chip states a conclusion; this states the documents it came from. Unlike a bank line, these
// are papers the OWNER sent, each with a number an accountant will ask about — so this is not
// evidence the app had to go and gather, only evidence it was already holding and never showed.
//
// The component holds no language and no direction of its own: both travel on the line object
// built by credit-evidence.ts.

import type React from 'react'

import { M3 } from '@/lib/design/tokens'
import type { CreditEvidenceLine as Line } from '@/lib/credit-evidence'

export default function CreditEvidenceLine({ line }: { line: Line | null | undefined }) {
  if (!line) return null
  const base: React.CSSProperties = {
    display: 'block', whiteSpace: 'normal', lineHeight: 1.4, fontSize: 11.5,
    textAlign: 'start', color: M3.neutral,
  }
  return (
    <span dir={line.dir} style={{ display: 'block', marginTop: 3 }}>
      <span style={base}>{line.lead}</span>
      {line.entries.map((entry, i) => (
        <span key={i} style={{ ...base, marginTop: 1, paddingInlineStart: 10 }}>· {entry}</span>
      ))}
    </span>
  )
}
