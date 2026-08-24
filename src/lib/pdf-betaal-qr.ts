// src/lib/pdf-betaal-qr.ts
// [PDF-BETAAL-QR] The "Scan om te betalen" QR that rides ON the invoice PDF itself. Pure.
//
// The betaalverzoek modal and the /pay page already carry an EPC069-12 QR — but only for the
// owner to SHARE separately. The customer's most-handled artifact is the PDF: it travels in the
// e-mail, gets printed, gets forwarded to a purchasing department. Putting the same QR on the
// paper means any Dutch banking app scans it and the transfer stands prefilled: IBAN, name,
// amount, and the invoice number as kenmerk — the exact string bank-matching reads back to
// auto-reconcile the payment.
//
// ── WHAT THE PAPER ASKS IS WHAT THE QR ASKS ──
//
// buildBetaalverzoek deliberately requests the REMAINDER (openAmount) — its link is a living
// thing. A PDF is not: it is a snapshot whose payment sentence names the full printed total, so
// its QR must name the SAME figure or the document contradicts itself. The component re-derives
// the printed total from the lines (discounts included) and refuses to render a QR whose amount
// disagrees with it — a missing QR is yesterday's paper, a wrong QR is a wrong payment.
//
// ── WHEN THERE IS NO QR ──
//
// Refusals return null, never an error: the PDF must always deliver ([FACTUUR-A] — legal
// delivery outranks decoration). No QR on:
//   · anything that is not a factuur — an offerte must not demand payment, and a creditnota's
//     total is money the OWNER owes;
//   · a non-positive or non-finite total;
//   · a missing/invalid IBAN or an empty business name (buildEpcQrPayload refuses those).

import { buildEpcQrPayload } from './epc-qr'

export interface PdfBetaalQr {
  /** The EPC069-12 text to encode into the QR image. */
  payload: string
  /** The amount the payload asks for — the component matches this against the printed total. */
  amount: number
}

export function epcPayloadForInvoicePdf(
  invoice: {
    invoice_type?: string | null
    total_inc_btw?: number | null
    invoice_number?: string | null
    payment_reference?: string | null
  },
  profile: { iban?: string | null; company_name?: string | null; full_name?: string | null },
): PdfBetaalQr | null {
  if ((invoice.invoice_type ?? 'factuur') !== 'factuur') return null

  const amount = Number(invoice.total_inc_btw ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) return null

  // Same reference rule as buildBetaalverzoek: the INVOICE NUMBER first, because
  // bank-matching.referenceMatches() reads only that back from the incoming transaction.
  // On a preview before the number exists the kenmerk is simply empty — the SENT document,
  // rendered after numbering, always carries it.
  const reference = (invoice.invoice_number || invoice.payment_reference || '').trim()

  const qr = buildEpcQrPayload({
    iban: (profile.iban ?? '').trim(),
    name: (profile.company_name || profile.full_name || '').trim(),
    amount,
    reference,
  })
  if (!qr.ok || !qr.payload) return null
  return { payload: qr.payload, amount }
}
