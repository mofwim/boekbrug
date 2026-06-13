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
// Same separation pattern as lib/export-pdf.tsx (BOEK-014).
// =====================================================

import { renderToBuffer } from '@react-pdf/renderer'
import { InvoicePDF } from './invoice-pdf'

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
  return renderToBuffer(
    <InvoicePDF invoice={invoice} lines={lines} profile={profile} />
  ) as unknown as Promise<Buffer>
}