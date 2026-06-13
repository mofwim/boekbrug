// src/lib/invoice-pdf.tsx
// [FACTUUR-A] Legal rebuild — Art. 35a Wet OB 1968 compliant — June 2026
// =====================================================
// Changes vs previous version:
//   * All amounts via formatEuroNL (Dutch comma) — toFixed(2) eliminated.
//   * All dates via formatDateNL (DD-MM-YYYY) — raw ISO eliminated.
//   * Leverdatum (Art. 35a sub f) shown when invoice.delivery_date is set.
//   * BTW summary states the rate ("BTW 21%") and splits per rate when
//     multiple rates are present: Subtotaal 9% / BTW 9% / Subtotaal 21% / BTW 21%.
//   * Line column "Totaal" → "Totaal excl." — kills the ambiguity with
//     "Totaal incl. BTW".
//   * Document title follows invoice_type: FACTUUR / CREDITNOTA /
//     PRO FORMA / OFFERTE — a creditnota no longer masquerades as FACTUUR.
//   * Payment text computed from the actual due_date ("vóór 12-07-2026")
//     instead of the hardcoded lie "binnen 30 dagen".
//   * Payment block hidden for creditnota (mirrors the create page).
//
// Consumed by BOTH:
//   * client: dashboard/invoice/[id] via <PDFDownloadLink> (signature kept)
//   * server: lib/invoice-pdf-server.tsx → renderToBuffer (e-mail attachment)
// Keep this module free of server-only imports.
// =====================================================

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { formatDateNL, formatEuroNL, deriveBtwRate } from './format-nl'

// ─── Styles (visual language unchanged) ──────────────────────────────────────
const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 40,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 40,
  },
  companyName: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#1c1c1e',
  },
  invoiceTitle: {
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    color: '#1c1c1e',
    textAlign: 'right',
  },
  invoiceNumber: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'right',
    marginTop: 4,
  },
  partiesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  partyBlock: {
    width: '45%',
  },
  partyLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  partyName: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#1c1c1e',
    marginBottom: 3,
  },
  partyText: {
    fontSize: 10,
    color: '#6b7280',
    marginBottom: 2,
  },
  datesRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 30,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 6,
  },
  dateBlock: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 9,
    color: '#9ca3af',
    marginBottom: 3,
  },
  dateValue: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#1c1c1e',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    padding: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  colDescription: { flex: 3, color: '#1c1c1e' },
  colQty: { flex: 1, textAlign: 'center', color: '#1c1c1e' },
  colPrice: { flex: 1, textAlign: 'right', color: '#1c1c1e' },
  colBtw: { flex: 1, textAlign: 'center', color: '#1c1c1e' },
  colTotal: { flex: 1.2, textAlign: 'right', color: '#1c1c1e' },
  headerText: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
  },
  totalsBlock: {
    marginTop: 20,
    alignItems: 'flex-end',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 220,
    marginBottom: 4,
  },
  totalLabel: { fontSize: 10, color: '#6b7280' },
  totalValue: { fontSize: 10, color: '#1c1c1e' },
  totalFinalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 220,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  totalFinalLabel: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#1c1c1e' },
  totalFinalValue: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#1c1c1e' },
  paymentBlock: {
    marginTop: 30,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 6,
  },
  paymentLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  paymentText: {
    fontSize: 10,
    color: '#6b7280',
    lineHeight: 1.5,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 9,
    color: '#d1d5db',
  },
})

// ─── [FACTUUR-A] Document title per invoice_type ─────────────────────────────
// A creditnota carrying the title FACTUUR is legally misleading — fixed.
const DOC_TITLES: Record<string, string> = {
  factuur: 'FACTUUR',
  creditnota: 'CREDITNOTA',
  pro_forma: 'PRO FORMA',
  offerte: 'OFFERTE',
}

// ─── [FACTUUR-A] BTW breakdown per rate, derived from lines ──────────────────
// Lines are the source of truth for the per-rate split (btw_rate exists on
// invoice_lines — NOT on invoices). For legacy invoices without lines we fall
// back to the derived single rate from the stored totals.
type LineLike = {
  description?: string | null
  quantity?: number | null
  unit_price?: number | null
  btw_rate?: number | null
  line_total?: number | null
}

function btwBreakdown(lines: LineLike[]): { rate: number; ex: number; btw: number }[] {
  const byRate = new Map<number, number>()
  for (const l of lines) {
    const rate = Number(l.btw_rate ?? 0)
    // line_total is stored ex BTW and already carries the creditnota sign
    const ex =
      l.line_total !== null && l.line_total !== undefined
        ? Number(l.line_total)
        : Number(l.quantity ?? 0) * Number(l.unit_price ?? 0)
    byRate.set(rate, (byRate.get(rate) ?? 0) + ex)
  }
  return Array.from(byRate.entries())
    .map(([rate, ex]) => ({ rate, ex, btw: (ex * rate) / 100 }))
    .filter((g) => g.ex !== 0)
    .sort((a, b) => a.rate - b.rate)
}

// ─── Component ────────────────────────────────────────────────────────────────
export function InvoicePDF({
  invoice,
  lines,
  profile,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lines: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any
}) {
  const docTitle = DOC_TITLES[invoice.invoice_type as string] ?? 'FACTUUR'
  const isCreditnota = invoice.invoice_type === 'creditnota'

  const groups = btwBreakdown(lines ?? [])
  const multiRate = groups.length > 1
  // Fallback for legacy invoices without lines: derive the single rate.
  const fallbackRate = deriveBtwRate(invoice.btw_amount, invoice.total_ex_btw)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>
              {profile.company_name || profile.full_name}
            </Text>
          </View>
          <View>
            <Text style={styles.invoiceTitle}>{docTitle}</Text>
            <Text style={styles.invoiceNumber}>{invoice.invoice_number}</Text>
          </View>
        </View>

        {/* Parties */}
        <View style={styles.partiesRow}>
          {/* Van — Art. 35a sub a/b: full name+address, KVK, BTW-id */}
          <View style={styles.partyBlock}>
            <Text style={styles.partyLabel}>Van</Text>
            <Text style={styles.partyName}>{profile.company_name || profile.full_name}</Text>
            <Text style={styles.partyText}>{profile.address}</Text>
            <Text style={styles.partyText}>{profile.postal_code} {profile.city}</Text>
            <Text style={styles.partyText}>KVK: {profile.kvk_number || '—'}</Text>
            <Text style={styles.partyText}>BTW: {profile.btw_number || '—'}</Text>
            <Text style={styles.partyText}>IBAN: {profile.iban || '—'}</Text>
          </View>

          {/* Aan — Art. 35a sub c: name AND address of the customer */}
          <View style={styles.partyBlock}>
            <Text style={styles.partyLabel}>Aan</Text>
            <Text style={styles.partyName}>{invoice.client_name || '—'}</Text>
            <Text style={styles.partyText}>{invoice.client_address || ''}</Text>
            <Text style={styles.partyText}>
              {invoice.client_postal_code || ''} {invoice.client_city || ''}
            </Text>
            {invoice.client_btw_number && (
              <Text style={styles.partyText}>BTW: {invoice.client_btw_number}</Text>
            )}
            <Text style={styles.partyText}>{invoice.client_email || ''}</Text>
          </View>
        </View>

        {/* Dates — [FACTUUR-A] DD-MM-YYYY everywhere; Leverdatum added (sub f) */}
        <View style={styles.datesRow}>
          <View style={styles.dateBlock}>
            <Text style={styles.dateLabel}>Factuurdatum</Text>
            <Text style={styles.dateValue}>{formatDateNL(invoice.invoice_date)}</Text>
          </View>
          {invoice.delivery_date && (
            <View style={styles.dateBlock}>
              <Text style={styles.dateLabel}>Leverdatum</Text>
              <Text style={styles.dateValue}>{formatDateNL(invoice.delivery_date)}</Text>
            </View>
          )}
          <View style={styles.dateBlock}>
            <Text style={styles.dateLabel}>Vervaldatum</Text>
            <Text style={styles.dateValue}>{formatDateNL(invoice.due_date)}</Text>
          </View>
        </View>

        {/* Line table — [FACTUUR-A] "Totaal" → "Totaal excl." */}
        <View style={styles.tableHeader}>
          <Text style={[styles.colDescription, styles.headerText]}>Omschrijving</Text>
          <Text style={[styles.colQty, styles.headerText]}>Aantal</Text>
          <Text style={[styles.colPrice, styles.headerText]}>Prijs</Text>
          <Text style={[styles.colBtw, styles.headerText]}>BTW</Text>
          <Text style={[styles.colTotal, styles.headerText]}>Totaal excl.</Text>
        </View>

        {(lines ?? []).map((line, index) => (
          <View key={index} style={styles.tableRow}>
            <Text style={styles.colDescription}>{line.description}</Text>
            <Text style={styles.colQty}>{line.quantity}</Text>
            <Text style={styles.colPrice}>{formatEuroNL(line.unit_price)}</Text>
            <Text style={styles.colBtw}>{line.btw_rate}%</Text>
            <Text style={styles.colTotal}>
              {formatEuroNL(
                line.line_total ?? Number(line.quantity ?? 0) * Number(line.unit_price ?? 0)
              )}
            </Text>
          </View>
        ))}

        {/* Totals — [FACTUUR-A] rate always stated; per-rate split when mixed */}
        <View style={styles.totalsBlock}>
          {multiRate ? (
            <>
              {groups.map((g) => (
                <View key={g.rate}>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Subtotaal {g.rate}%</Text>
                    <Text style={styles.totalValue}>{formatEuroNL(g.ex)}</Text>
                  </View>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>BTW {g.rate}%</Text>
                    <Text style={styles.totalValue}>{formatEuroNL(g.btw)}</Text>
                  </View>
                </View>
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotaal excl. BTW</Text>
                <Text style={styles.totalValue}>{formatEuroNL(invoice.total_ex_btw)}</Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotaal excl. BTW</Text>
                <Text style={styles.totalValue}>{formatEuroNL(invoice.total_ex_btw)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  BTW {groups[0]?.rate ?? fallbackRate}%
                </Text>
                <Text style={styles.totalValue}>{formatEuroNL(invoice.btw_amount)}</Text>
              </View>
            </>
          )}
          <View style={styles.totalFinalRow}>
            <Text style={styles.totalFinalLabel}>Totaal incl. BTW</Text>
            <Text style={styles.totalFinalValue}>{formatEuroNL(invoice.total_inc_btw)}</Text>
          </View>
        </View>

        {/* Payment — [FACTUUR-A] real due date, hidden for creditnota */}
        {profile.iban && !isCreditnota && (
          <View style={styles.paymentBlock}>
            <Text style={styles.paymentLabel}>Betalingsinformatie</Text>
            <Text style={styles.paymentText}>
              Gelieve te betalen vóór {formatDateNL(invoice.due_date)} op {profile.iban} o.v.v. {invoice.invoice_number}
            </Text>
          </View>
        )}
        {isCreditnota && (
          <View style={styles.paymentBlock}>
            <Text style={styles.paymentLabel}>Creditnota</Text>
            <Text style={styles.paymentText}>
              Deze creditnota crediteert het bovenstaande bedrag. Er is geen betaling vereist.
            </Text>
          </View>
        )}

        {/* Footer */}
        <Text style={styles.footer}>
          BoekBrug — De brug tussen jou en je boekhouder
        </Text>
      </Page>
    </Document>
  )
}