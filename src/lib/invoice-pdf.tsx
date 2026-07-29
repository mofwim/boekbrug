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
// [ICP] Art. 226 punt 11a: when the customer owes the BTW, the invoice must SAY so. Same rule
// the ICP-opgaaf runs on, so the document and the aangifte can never disagree about this sale.
import { reverseChargeNotice } from './icp'

// ─── Styles ──────────────────────────────────────────────────────────────────
const NAVY = '#1a73e8'
const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 44,
    color: '#202124',
    backgroundColor: '#ffffff',
    lineHeight: 1.4,
  },

  // Logo sits in its own top-right row, so the two party blocks below it start
  // on the SAME line (klant and afzender aligned, like the reference).
  logoRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 14,
  },
  // Top: klant (left) · afzender (right) — aligned, below the logo row.
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 36,
  },
  klantBlock: { width: '48%' },
  // Afzender sits in the right half of the page, but its text reads
  // LEFT-aligned like the reference.
  afzenderBlock: { width: '48%' },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: '#ffffff',
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1,
  },
  partyName: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  partyText: { fontSize: 10, color: '#3c4043', marginBottom: 1 },

  // Heading + meta
  heading: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 10 },
  metaRow: { flexDirection: 'row', marginBottom: 2 },
  metaLabel: { width: 96, fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#202124' },
  metaValue: { fontSize: 10, color: '#3c4043' },

  // Table
  table: { marginTop: 26 },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
    paddingBottom: 6,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f4',
  },
  colAantal: { width: 44, fontSize: 10 },
  colOmschrijving: { flex: 1, fontSize: 10, paddingRight: 8 },
  colPrijs: { width: 78, fontSize: 10, textAlign: 'right' },
  colTotaal: { width: 84, fontSize: 10, textAlign: 'right' },
  headerText: { fontFamily: 'Helvetica-Bold', color: '#202124' },

  // Totals
  totalsWrap: { alignItems: 'flex-end', marginTop: 14 },
  totalsBlock: { width: 300 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  totalLabel: { fontSize: 10, color: '#3c4043', flexShrink: 1, paddingRight: 12 },
  totalValue: { fontSize: 10, color: '#202124' },
  totalFinalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#dadce0',
  },
  totalFinalLabel: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  totalFinalValue: { fontSize: 12, fontFamily: 'Helvetica-Bold' },

  // Payment
  payment: { marginTop: 34, fontSize: 10, color: '#3c4043', lineHeight: 1.5 },

  footer: {
    position: 'absolute',
    bottom: 28,
    left: 44,
    right: 44,
    textAlign: 'center',
    fontSize: 8,
    color: '#dadce0',
  },
})

// ─── Document title per invoice_type (title-case, matches the reference) ─────
const DOC_TITLES: Record<string, string> = {
  factuur: 'Factuur',
  creditnota: 'Creditnota',
  pro_forma: 'Pro forma',
  offerte: 'Offerte',
}

// Symmetric round-to-cents (magnitude-based, so a creditnota's -2.105 mirrors a
// factuur's 2.105 exactly). Used for on-document total reconciliation.
function round2(n: number): number {
  const v = Number(n) || 0
  return (v < 0 ? -1 : 1) * (Math.round(Math.abs(v) * 100 + 1e-9) / 100)
}

// Quantity for display: Dutch decimal comma, integers stay bare (2 → "2").
function formatQtyNL(q: number | null | undefined): string {
  const v = Number(q)
  if (!isFinite(v)) return String(q ?? '')
  return (Number.isInteger(v) ? String(v) : String(v)).replace('.', ',')
}

// ─── Auto logo: initials from the company (or personal) name ─────────────────
// Fills the "Jouw eigen logo" slot without an upload — up to two initials.
// Helvetica has no non-Latin/emoji glyphs, so we keep only A–Z/0–9 and fall
// back to a dot rather than render a blank or a lone surrogate.
function deriveInitials(name: string | null | undefined): string {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const raw =
    words.length === 0
      ? ''
      : words.length === 1
        ? words[0].slice(0, 2)
        : words[0][0] + words[words.length - 1][0]
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '') || '•'
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
  const type = (invoice.invoice_type as string) || 'factuur'
  const docTitle = DOC_TITLES[type] ?? 'Factuur'
  const isCreditnota = type === 'creditnota'
  const isOfferte = type === 'offerte'
  const isProForma = type === 'pro_forma'
  // Only a factuur (or a creditnota, which reverses one) is a legal payment
  // document. Offerte/pro forma must NOT demand payment or call their number a
  // "factuurnummer".
  const isLegalInvoice = type === 'factuur' || isCreditnota

  // Per-type meta labels.
  const numberLabel = isOfferte ? 'Offertenummer:' : isCreditnota ? 'Creditnotanummer:' : 'Factuurnummer:'
  const dateLabel = isOfferte ? 'Offertedatum:' : 'Factuurdatum:'
  // Leverdatum only makes sense for something actually delivered (factuur /
  // creditnota); a quote delivers nothing.
  const showLeverdatum = isLegalInvoice && !!invoice.delivery_date

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

  // Reconcile the totals FROM the rate rows so the printed document always adds
  // up: Subtotaal + Σ(per-rate BTW) === Totaal, to the cent, for single- and
  // mixed-rate alike. (Previously Subtotaal/Totaal came from stored fields while
  // the BTW rows were re-derived, which could disagree by a cent.)
  const displaySubtotal = round2(rateLines.reduce((a, g) => a + g.ex, 0))
  const displayBtwTotal = round2(rateLines.reduce((a, g) => a + round2(g.btw), 0))
  const displayTotal = round2(displaySubtotal + displayBtwTotal)

  const paymentText = `Wij verzoeken u vriendelijk het bovenstaande bedrag van ${formatEuroNL(
    displayTotal
  )} voor ${formatDateNL(invoice.due_date)} ${
    profile.iban ? `op onze bankrekening ${profile.iban} ` : ''
  }te voldoen, onder vermelding van het factuurnummer ${invoice.invoice_number}.`

  // [ICP] The mandatory reverse-charge line. Without it an intra-EU invoice is formally
  // deficient — that is the ground on which the 0% gets challenged and the customer's own
  // deduction gets refused. It is derived, never typed: the customer's EU BTW-number plus a
  // zero BTW amount IS the condition. Suppressed when the owner already wrote it in a line.
  const reverseCharge = reverseChargeNotice({
    clientVatNumber: invoice.client_btw_number,
    btwAmount: invoice.btw_amount,
    invoiceType: type,
    korActive: !!profile.kor_active,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lineTexts: (lines ?? []).map((l: any) => l?.description as string | null),
  })

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Auto logo — its own top-right row, so klant and afzender below it
            start on the same line (aligned, like the reference). */}
        <View style={styles.logoRow}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>{initials}</Text>
          </View>
        </View>

        {/* Parties — klant (left) · afzender (right), aligned */}
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

          {/* Afzender — Art. 35a sub a/b: name+address, BTW-id, KVK */}
          <View style={styles.afzenderBlock}>
            <Text style={styles.partyName}>{afzenderName || '—'}</Text>
            <Text style={styles.partyText}>{profile.address || '—'}</Text>
            <Text style={styles.partyText}>
              {(profile.postal_code || profile.city) ? `${profile.postal_code || ''} ${profile.city || ''}`.trim() : '—'}
            </Text>
            <Text style={styles.partyText}>BTW nr.: {senderBtw}</Text>
            <Text style={styles.partyText}>KvK nr.: {profile.kvk_number || '—'}</Text>
            <Text style={styles.partyText}>IBAN: {profile.iban || '—'}</Text>
          </View>
        </View>

        {/* Heading + meta */}
        <Text style={styles.heading}>{docTitle}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{numberLabel}</Text>
          <Text style={styles.metaValue}>{invoice.invoice_number}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{dateLabel}</Text>
          <Text style={styles.metaValue}>{formatDateNL(invoice.invoice_date)}</Text>
        </View>
        {showLeverdatum && (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Leverdatum:</Text>
            <Text style={styles.metaValue}>{formatDateNL(invoice.delivery_date)}</Text>
          </View>
        )}
        {/* Vervaldatum only on a real factuur; an offerte shows "Geldig tot". */}
        {type === 'factuur' && (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Vervaldatum:</Text>
            <Text style={styles.metaValue}>{formatDateNL(invoice.due_date)}</Text>
          </View>
        )}
        {isOfferte && invoice.due_date && (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Geldig tot:</Text>
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
                <Text style={styles.colAantal}>{formatQtyNL(line.quantity)}</Text>
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
              <Text style={styles.totalValue}>{formatEuroNL(displaySubtotal)}</Text>
            </View>
            {rateLines.map((g, i) => (
              <View key={i} style={styles.totalRow}>
                <Text style={styles.totalLabel}>{rateLabel(g.rate, g.ex)}</Text>
                <Text style={styles.totalValue}>{formatEuroNL(round2(g.btw))}</Text>
              </View>
            ))}
            <View style={styles.totalFinalRow}>
              <Text style={styles.totalFinalLabel}>Totaal</Text>
              <Text style={styles.totalFinalValue}>{formatEuroNL(displayTotal)}</Text>
            </View>
          </View>
        </View>

        {/* [ICP] Above the closing note, because it is part of the INVOICE, not a courtesy:
            art. 226 punt 11a requires the words "Btw verlegd" on a document whose BTW was
            shifted to the customer. */}
        {reverseCharge && <Text style={styles.payment}>{reverseCharge}</Text>}

        {/* Closing note — depends on the document type. A quote / pro forma
            must NOT demand payment or reference a "factuurnummer". */}
        {type === 'factuur' && <Text style={styles.payment}>{paymentText}</Text>}
        {isCreditnota && (
          <Text style={styles.payment}>
            Deze creditnota crediteert het bovenstaande bedrag. Er is geen betaling vereist.
          </Text>
        )}
        {isOfferte && (
          <Text style={styles.payment}>
            Deze offerte is vrijblijvend{invoice.due_date ? ` en geldig tot ${formatDateNL(invoice.due_date)}` : ''}.
          </Text>
        )}
        {isProForma && (
          <Text style={styles.payment}>
            Dit is een pro-formafactuur en geen geldige btw-factuur; er kunnen geen rechten aan
            worden ontleend.
          </Text>
        )}

        <Text style={styles.footer} fixed>
          BoekBrug — De brug tussen jou en je boekhouder
        </Text>
      </Page>
    </Document>
  )
}
