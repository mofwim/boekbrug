// src/lib/invoice-pdf-server.tsx
// [FACTUUR-A] Server-side invoice PDF rendering — June 2026
// =====================================================
// Separate module ON PURPOSE:
//   * invoice-pdf.tsx (the component) is imported CLIENT-side by
//     dashboard/invoice/[id] via <PDFDownloadLink>.
//   * renderToBuffer is a Node-only export of @react-pdf/renderer —
//     pulling it into invoice-pdf.tsx would drag it into the client
//     bundle and risk a build break.
// API routes import THIS file; client components never do.
// Same separation pattern the removed lib/export-pdf.tsx used (BOEK-014).
// =====================================================

import { renderToBuffer } from '@react-pdf/renderer'
import QRCode from 'qrcode'
import { InvoicePDF } from './invoice-pdf'
// [PDF-BETAAL-QR] The scan-to-pay QR on the paper itself — see pdf-betaal-qr.ts.
import { epcPayloadForInvoicePdf } from './pdf-betaal-qr'

/**
 * Render the official invoice PDF to a Buffer.
 * Call from API routes only — never from a client component.
 *
 * @example
 * const buf = await renderInvoicePdf(invoice, lines, profile)
 * // → attach to Resend e-mail / upload to Storage
 */
export async function renderInvoicePdf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lines: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any
): Promise<Buffer> {
  // [PDF-BETAAL-QR] Built HERE so every server-rendered copy — the one the customer actually
  // receives — carries it without each caller having to remember. Best-effort on purpose: a QR
  // that cannot be built (no IBAN, creditnota, offerte, a QR-encoder hiccup) yields null and the
  // document renders exactly as before — legal delivery outranks decoration ([FACTUUR-A]).
  let betaalQr: { dataUrl: string; amount: number } | null = null
  try {
    const epc = epcPayloadForInvoicePdf(invoice, profile)
    if (epc) {
      betaalQr = {
        dataUrl: await QRCode.toDataURL(epc.payload, { margin: 0, width: 240 }),
        amount: epc.amount,
      }
    }
  } catch {
    betaalQr = null
  }
  return renderToBuffer(
    <InvoicePDF invoice={invoice} lines={lines} profile={profile} betaalQr={betaalQr} />
  ) as unknown as Promise<Buffer>
}