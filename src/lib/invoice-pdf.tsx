// src/lib/invoice-pdf.tsx
// [FACTUUR-LAYOUT] Reference-matched layout — July 2026
// =====================================================
// Layout now mirrors the Belastingdienst "12 factuureisen" reference invoice
// (InformerOnline standard) exactly:
//   * Klant top-LEFT, afzender top-RIGHT with an auto-generated logo monogram
//     above it (initials derived from the company name — no upload).
//   * "Factuur" heading + Factuurnummer / Factuurdatum / Vervaldatum
//     (+ Leverdatum — eis #6, printed whenever a delivery date is present).
//   * Table columns: Aantal · Omschrijving · Prijs · Totaal (no separate BTW
//     column — the rate is stated in the totals, as on the reference).
//   * Totals read "21,00% BTW over € 100,00 → € 21,00" per rate.
//   * Full payment sentence instead of a boxed note.
//
// LEGAL LOGIC PRESERVED verbatim from the previous (Art. 35a Wet OB 1968)
// build: per-rate BTW breakdown from the lines, single-rate fallback for
// legacy invoices, creditnota title + sign + no-payment text, all amounts via
// formatEuroNL (Dutch comma) and all dates via formatDateNL (DD-MM-YYYY).
//
// Consumed by BOTH (signature unchanged — no call-site edits):
//   * client: dashboard/invoice/[id] + factuur-maken via <PDFDownloadLink>
//   * server: lib/invoice-pdf-server.tsx → renderToBuffer (e-mail attachment)
// Keep this module free of server-only imports.
// =====================================================

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { formatDateNL, formatEuroNL, deriveBtwRate } from './format-nl'

// ─── Styles ──────────────────────────────────────────────────────────────────
const NAVY = '#16324f'
const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 44,
    color: '#1c1c1e',
    backgroundColor: '#ffffff',
    lineHeight: 1.4,
  },

  // Top: klant (left) · afzender + logo (right)
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 36,
  },
  klantBlock: { width: '48%' },
  // Afzender sits in the right half of the page, but its text reads
  // LEFT-aligned like the reference — only the logo hugs the right edge.
  afzenderBlock: { width: '48%' },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    alignSelf: 'flex-end',
  },
  logoText: {
    color: '#ffffff',
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1,
  },
  partyName: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  partyText: { fontSize: 10, color: '#3c3c43', marginBottom: 1 },

  // Heading + meta
  heading: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 10 },
  metaRow: { flexDirection: 'row', marginBottom: 2 },
  metaLabel: { width: 96, fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#1c1c1e' },
  metaValue: { fontSize: 10, color: '#3c3c43' },

  // Table
  table: { marginTop: 26 },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#c8c8cd',
    paddingBottom: 6,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeef',
  },
  colAantal: { width: 44, fontSize: 10 },
  colOmschrijving: { flex: 1, fontSize: 10, paddingRight: 8 },
  colPrijs: { width: 78, fontSize: 10, textAlign: 'right' },
  colTotaal: { width: 84, fontSize: 10, textAlign: 'right' },
  headerText: { fontFamily: 'Helvetica-Bold', color: '#1c1c1e' },

  // Totals
  totalsWrap: { alignItems: 'flex-end', marginTop: 14 },
  totalsBlock: { width: 300 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  totalLabel: { fontSize: 10, color: '#3c3c43', flexShrink: 1, paddingRight: 12 },
  totalValue: { fontSize: 10, color: '#1c1c1e' },
  totalFinalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#c8c8cd',
  },
  totalFinalLabel: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  totalFinalValue: { fontSize: 12, fontFamily: 'Helvetica-Bold' },

  // Payment
  payment: { marginTop: 34, fontSize: 10, color: '#3c3c43', lineHeight: 1.5 },

  footer: {
    position: 'absolute',
    bottom: 28,
    left: 44,
    right: 44,
    textAlign: 'center',
    fontSize: 8,
    color: '#c8c8cd',
  },
})

// ─── Document title per invoice_type (title-case, matches the reference) ─────
const DOC_TITLES: Record<string, string> = {
  factuur: 'Factuur',
  creditnota: 'Creditnota',
  pro_forma: 'Pro forma',
  offerte: 'Offerte',
}

// ─── Auto logo: initials from the company (or personal) name ─────────────────
// Fills the "Jouw eigen logo" slot without an upload — up to two initials.
function deriveInitials(name: string | null | undefined): string {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '•'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

// ─── BTW breakdown per rate, derived from lines ──────────────────────────────
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

// "21,00% BTW over € 100,00" — rate with two decimals and a Dutch comma.
function rateLabel(rate: number, ex: number): string {
  const r = rate.toFixed(2).replace('.', ',')
  return `${r}% BTW over ${formatEuroNL(ex)}`
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
  const docTitle = DOC_TITLES[invoice.invoice_type as string] ?? 'Factuur'
  const isCreditnota = invoice.invoice_type === 'creditnota'

  const afzenderName = profile.company_name || profile.full_name || ''
  const initials = deriveInitials(profile.company_name || profile.full_name)

  // [FACTUUR-A] Normalize BTW-id casing on a legal document.
  const senderBtw = profile.btw_number ? String(profile.btw_number).toUpperCase() : '—'
  const clientBtw = invoice.client_btw_number ? String(invoice.client_btw_number).toUpperCase() : ''

  const groups = btwBreakdown(lines ?? [])
  // Fallback for legacy invoices without lines: one derived rate from totals.
  const rateLines =
    groups.length > 0
      ? groups
      : [
          {
            rate: deriveBtwRate(invoice.btw_amount, invoice.total_ex_btw),
            ex: Number(invoice.total_ex_btw ?? 0),
            btw: Number(invoice.btw_amount ?? 0),
          },
        ]

  const paymentText = `Wij verzoeken u vriendelijk het bovenstaande bedrag van ${formatEuroNL(
    invoice.total_inc_btw
  )} voor ${formatDateNL(invoice.due_date)} ${
    profile.iban ? `op onze bankrekening ${profile.iban} ` : ''
  }te voldoen, onder vermelding van het factuurnummer ${invoice.invoice_number}.`

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Top — klant (left) · afzender + logo (right) */}
        <View style={styles.topRow}>
          {/* Klant — Art. 35a sub c: name AND address of the customer */}
          <View style={styles.klantBlock}>
            <Text style={styles.partyName}>{invoice.client_name || '—'}</Text>
            <Text style={styles.partyText}>{invoice.client_address || ''}</Text>
            <Text style={styles.partyText}>
              {invoice.client_postal_code || ''} {invoice.client_city || ''}
            </Text>
            {clientBtw !== '' && <Text style={styles.partyText}>BTW nr.: {clientBtw}</Text>}
            {invoice.client_email ? (
              <Text style={styles.partyText}>{invoice.client_email}</Text>
            ) : null}
          </View>

          {/* Afzender — Art. 35a sub a/b: name+address, BTW-id, KVK + auto logo */}
          <View style={styles.afzenderBlock}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>{initials}</Text>
            </View>
            <Text style={styles.partyName}>{afzenderName}</Text>
            <Text style={styles.partyText}>{profile.address}</Text>
            <Text style={styles.partyText}>
              {profile.postal_code} {profile.city}
            </Text>
            <Text style={styles.partyText}>BTW nr.: {senderBtw}</Text>
            <Text style={styles.partyText}>KvK nr.: {profile.kvk_number || '—'}</Text>
            <Text style={styles.partyText}>IBAN: {profile.iban || '—'}</Text>
          </View>
        </View>

        {/* Heading + meta */}
        <Text style={styles.heading}>{docTitle}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Factuurnummer:</Text>
          <Text style={styles.metaValue}>{invoice.invoice_number}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Factuurdatum:</Text>
          <Text style={styles.metaValue}>{formatDateNL(invoice.invoice_date)}</Text>
        </View>
        {invoice.delivery_date && (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Leverdatum:</Text>
            <Text style={styles.metaValue}>{formatDateNL(invoice.delivery_date)}</Text>
          </View>
        )}
        {!isCreditnota && (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Vervaldatum:</Text>
            <Text style={styles.metaValue}>{formatDateNL(invoice.due_date)}</Text>
          </View>
        )}

        {/* Line table — Aantal · Omschrijving · Prijs · Totaal */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.colAantal, styles.headerText]}>Aantal</Text>
            <Text style={[styles.colOmschrijving, styles.headerText]}>Omschrijving</Text>
            <Text style={[styles.colPrijs, styles.headerText]}>Prijs</Text>
            <Text style={[styles.colTotaal, styles.headerText]}>Totaal</Text>
          </View>
          {(lines ?? []).map((line, index) => {
            const lineTotal =
              line.line_total ?? Number(line.quantity ?? 0) * Number(line.unit_price ?? 0)
            return (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.colAantal}>{line.quantity}</Text>
                <Text style={styles.colOmschrijving}>{line.description}</Text>
                <Text style={styles.colPrijs}>{formatEuroNL(line.unit_price)}</Text>
                <Text style={styles.colTotaal}>{formatEuroNL(lineTotal)}</Text>
              </View>
            )
          })}
        </View>

        {/* Totals — Subtotaal / per-rate BTW / Totaal */}
        <View style={styles.totalsWrap}>
          <View style={styles.totalsBlock}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotaal</Text>
              <Text style={styles.totalValue}>{formatEuroNL(invoice.total_ex_btw)}</Text>
            </View>
            {rateLines.map((g, i) => (
              <View key={i} style={styles.totalRow}>
                <Text style={styles.totalLabel}>{rateLabel(g.rate, g.ex)}</Text>
                <Text style={styles.totalValue}>{formatEuroNL(g.btw)}</Text>
              </View>
            ))}
            <View style={styles.totalFinalRow}>
              <Text style={styles.totalFinalLabel}>Totaal</Text>
              <Text style={styles.totalFinalValue}>{formatEuroNL(invoice.total_inc_btw)}</Text>
            </View>
          </View>
        </View>

        {/* Payment — full sentence (hidden for creditnota) */}
        {!isCreditnota ? (
          <Text style={styles.payment}>{paymentText}</Text>
        ) : (
          <Text style={styles.payment}>
            Deze creditnota crediteert het bovenstaande bedrag. Er is geen betaling vereist.
          </Text>
        )}

        <Text style={styles.footer}>BoekBrug — De brug tussen jou en je boekhouder</Text>
      </Page>
    </Document>
  )
}
