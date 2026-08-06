// src/lib/books-audit.ts
// [NAREKENEN] Re-check what is ALREADY in the books against the documents they came from. Pure.
//
// ── WHY THIS EXISTS ──
// [GEGROND] gave every amount an independent witness — but only from the moment it was built. Every
// invoice imported before that has no verdict, and nothing in the app could produce one. Which
// leaves the owner exactly where they started: the doubt they have is about the invoices that are
// ALREADY booked, and the new check does nothing for those.
//
// This is the pass over the existing books. It re-reads each stored document's own text and asks the
// same mechanical question of the amounts that were saved: is this number really printed there?
//
// ── WHAT IT MAY AND MAY NOT DO ──
// It writes evidence and NEVER a figure. Not one amount, date, status or BTW field is touched. That
// is not caution for its own sake: an audit that can also "fix" what it finds is an audit whose
// results you cannot check, and on a booked invoice a silent correction would move a figure that is
// already in a filed aangifte. The owner is told what was found; deciding what to do about it is
// theirs, through the correction paths that already exist.
//
// ── TEXT LAYERS ONLY, AND SAYING SO ──
// The mechanical witness needs characters. For a photographed receipt there are none, and the OCR
// witness costs an API call per document — running that over a whole administration would be a bill
// nobody asked for. So the audit checks what can be checked for free, and reports the rest as
// UNCHECKED rather than as fine. "We could not look at 40 of these" is the honest sentence, and it
// is the one that keeps the other numbers worth reading.

import type { GroundingVerdict } from './amount-grounding'

/** One invoice's outcome. */
export interface AuditedInvoice {
  id: string
  invoiceNumber: string | null
  clientName: string | null
  totalIncBtw: number | null
  verdict: GroundingVerdict
}

export interface BooksAuditSummary {
  /** Invoices whose stored total was found, verbatim, in their own document. */
  confirmed: number
  /** Invoices whose stored total is NOT in the document text. These need a human. */
  mismatched: AuditedInvoice[]
  /** No text layer to search — a photo or a scan. Not an outcome, an absence of one. */
  unchecked: number
  /** How many invoices the pass looked at in total. */
  examined: number
}

/** Fold the per-invoice verdicts into the summary the owner reads. */
export function summarizeAudit(rows: readonly AuditedInvoice[]): BooksAuditSummary {
  const mismatched = rows.filter((r) => r.verdict === 'absent')
  return {
    confirmed: rows.filter((r) => r.verdict === 'found').length,
    mismatched,
    unchecked: rows.filter((r) => r.verdict === 'unreadable').length,
    examined: rows.length,
  }
}

/** € 1.234,56 — the notation the rest of the app uses. */
function eur(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n)
}

/**
 * The headline. Dutch, per AGENTS.md.
 *
 * The confirmed count leads when there is nothing wrong, because that is the whole point of running
 * this: an owner who has been checking invoices by hand wants to know how many they no longer have
 * to. When something IS wrong, that leads instead — a reassuring number above a problem is how a
 * report gets skimmed.
 */
export function auditTitle(s: BooksAuditSummary): string {
  if (s.examined === 0) return 'Er waren geen facturen om na te rekenen.'
  if (s.mismatched.length > 0) {
    return s.mismatched.length === 1
      ? '1 factuur klopt niet met het document'
      : `${s.mismatched.length} facturen kloppen niet met het document`
  }
  return s.confirmed === 1
    ? '1 factuur nagerekend — het bedrag staat zo op het document'
    : `${s.confirmed} facturen nagerekend — de bedragen staan zo op de documenten`
}

/**
 * The sentences under it, in the order they matter.
 *
 * The unchecked count is never omitted when it is non-zero, and never dressed up. A report that says
 * "everything checks out" while silently skipping the photographs is worse than no report: it is a
 * claim about invoices nobody looked at.
 */
export function auditLines(s: BooksAuditSummary): string[] {
  const out: string[] = []
  if (s.examined === 0) return out

  if (s.mismatched.length > 0) {
    for (const m of s.mismatched.slice(0, 10)) {
      out.push(
        `${m.clientName?.trim() || 'Onbekende leverancier'}` +
        `${m.invoiceNumber ? ` · factuur ${m.invoiceNumber}` : ''} · ${eur(m.totalIncBtw)} — ` +
        'dit bedrag staat niet in de tekst van het document.',
      )
    }
    if (s.mismatched.length > 10) {
      out.push(`… en nog ${s.mismatched.length - 10} andere.`)
    }
    out.push(
      'Bekijk het document zelf en corrigeer het bedrag als het inderdaad anders is. Wij hebben ' +
      'niets aangepast — nagerekend is niet hetzelfde als veranderd.',
    )
  }

  if (s.confirmed > 0 && s.mismatched.length > 0) {
    out.push(`Van de rest staat het bedrag wél zo op het document (${s.confirmed}).`)
  }

  if (s.unchecked > 0) {
    out.push(
      `${s.unchecked === 1 ? '1 factuur is' : `${s.unchecked} facturen zijn`} een foto of scan zonder ` +
      'leesbare tekst. Die konden wij niet naast het document leggen — daar zeggen deze cijfers dus niets over.',
    )
  }
  return out
}
