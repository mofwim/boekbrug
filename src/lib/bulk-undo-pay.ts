// src/lib/bulk-undo-pay.ts
// [BULK-UNDO] Undoing a payment in bulk — what it touches, said before it happens. Pure.
//
// ── WHY THIS NEEDS ITS OWN MODULE ──
// Marking invoices paid in bulk already exists. The reverse does not, and the reverse is the
// harder direction: paying is additive and the money is real either way, while un-paying REMOVES
// a settlement that other things have already been derived from.
//
// Undoing one payment cascades further than the row it is on. The single route
// (/api/invoice/pay-toggle, action 'undo') handles every one of these correctly, and this module
// exists so the owner is TOLD about them before twenty of them happen at once:
//
//   · the bank_tx_invoices links go, so recompute_invoice_amount_paid drops amount_paid to zero
//     and the bank line returns to 'pending' — it will offer itself for matching again;
//   · a cash-settled invoice's kasboek entry is removed, so the drawer balance changes on the day
//     the payment was booked;
//   · and under the KASSTELSEL the payment date is what put the BTW in a quarter. Undoing a
//     payment that sits in a quarter whose aangifte has been FILED changes a figure that has
//     already been declared to the Belastingdienst. That is not a reason to refuse — a wrong
//     booking must be correctable — but it is a reason to say so out loud, because the correction
//     belongs on a suppletie and the owner is the only one who can decide that.
//
// An accountant-locked invoice ('verwerkt') is refused by the route itself, per row. Naming it
// here as well means the owner sees it in the confirm rather than as a failure afterwards.
//
// Pure: no I/O, no clock. The caller passes the rows and which quarters are filed.

/** The row fields this reads. A structural subset of the pay screen's list. */
export interface UndoCandidateRow {
  id: string
  invoice_number: string | null
  client_name: string | null
  total_inc_btw: number | null
  amount_paid?: number | null
  status: string | null
  accountant_status?: string | null
  payment_method?: string | null
  payment_date?: string | null
}

export type UndoRefusal = 'not_paid' | 'accountant_locked'

export interface UndoPlan {
  /** Rows that will actually be un-paid. */
  eligible: UndoCandidateRow[]
  /** Rows that cannot be, with the reason — shown, never silently dropped. */
  refused: { row: UndoCandidateRow; reason: UndoRefusal }[]
  /** Total money whose settlement is being withdrawn. */
  total: number
  /** True when any eligible row was settled in cash — the kasboek moves too. */
  touchesCash: boolean
  /** Quarters ("2026-Q1") among the eligible rows whose aangifte has already been filed. */
  filedQuarters: string[]
}

const CENT = 0.005

/** "2026-Q2" from an ISO date, or null. */
export function quarterOf(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec((iso ?? '').trim())
  if (!m) return null
  return `${m[1]}-Q${Math.floor((Number(m[2]) - 1) / 3) + 1}`
}

/**
 * What would a bulk undo of these rows do?
 *
 * `filed` are the quarters whose aangifte has been submitted — the screen already loads them.
 */
export function planBulkUndo(
  rows: readonly UndoCandidateRow[],
  filed: readonly string[],
): UndoPlan {
  const filedSet = new Set(filed)
  const eligible: UndoCandidateRow[] = []
  const refused: { row: UndoCandidateRow; reason: UndoRefusal }[] = []

  for (const r of rows) {
    // The accountant's lock outranks everything: their work is not ours to undo, and the route
    // refuses it anyway. Naming it here puts it in the confirm instead of in the failures.
    if ((r.accountant_status ?? '') === 'verwerkt') {
      refused.push({ row: r, reason: 'accountant_locked' })
      continue
    }
    // Nothing to undo on a row that carries no settlement.
    const settled = (r.status ?? '') === 'paid' || Math.max(0, Number(r.amount_paid ?? 0)) > CENT
    if (!settled) {
      refused.push({ row: r, reason: 'not_paid' })
      continue
    }
    eligible.push(r)
  }

  // The money being withdrawn is what was APPLIED, not the invoice total: a partly-paid invoice
  // gives back only its instalments, and saying the full total would overstate what changes.
  const total = eligible.reduce((sum, r) => {
    const applied = Math.max(0, Number(r.amount_paid ?? 0))
    return sum + (applied > CENT ? applied : Math.abs(Number(r.total_inc_btw ?? 0)))
  }, 0)

  const quarters = new Set<string>()
  for (const r of eligible) {
    // The PAYMENT date decides the quarter under the kasstelsel — that is the whole point of the
    // warning, so it is the date read here, not the invoice date.
    const q = quarterOf(r.payment_date)
    if (q && filedSet.has(q)) quarters.add(q)
  }

  return {
    eligible,
    refused,
    total: Math.round(total * 100) / 100,
    touchesCash: eligible.some((r) => (r.payment_method ?? '') === 'kas'),
    filedQuarters: [...quarters].sort(),
  }
}

/** € 1.234,56 — the notation the rest of the screen uses. */
function eur(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n)
}

/**
 * The sentences the confirm shows, in the order they matter. Dutch, per AGENTS.md.
 *
 * The filed-quarter line comes first when there is one: it is the only consequence that reaches
 * outside the app.
 */
export function bulkUndoWarnings(plan: UndoPlan): string[] {
  const out: string[] = []
  if (plan.filedQuarters.length > 0) {
    const qs = plan.filedQuarters.join(' en ')
    out.push(
      `Let op: ${plan.filedQuarters.length === 1 ? 'de betaling valt' : 'betalingen vallen'} in ` +
      `${qs}, en die aangifte is al ingediend. Je btw over ${plan.filedQuarters.length === 1 ? 'dat kwartaal' : 'die kwartalen'} verandert hierdoor — corrigeren doe je met een suppletie.`,
    )
  }
  out.push(
    'De koppeling met je bankafschrift wordt losgemaakt. Die banktransacties staan daarna weer open om te matchen.',
  )
  if (plan.touchesCash) {
    out.push('Contant betaalde facturen worden ook uit je kasboek gehaald, op de dag waarop ze geboekt stonden.')
  }
  if (plan.refused.length > 0) {
    const locked = plan.refused.filter((r) => r.reason === 'accountant_locked')
    if (locked.length > 0) {
      const nums = locked.map((r) => r.row.invoice_number ?? '—').join(', ')
      out.push(`${nums}: al verwerkt door je boekhouder — die blijven staan. Vraag hem eerst om de verwerking terug te draaien.`)
    }
  }
  return out
}

/** The confirm's one-line summary. Dutch. */
export function bulkUndoTitle(plan: UndoPlan): string {
  const n = plan.eligible.length
  return n === 1
    ? `1 betaling ongedaan maken (${eur(plan.total)})?`
    : `${n} betalingen ongedaan maken (${eur(plan.total)})?`
}
