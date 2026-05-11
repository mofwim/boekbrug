import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

// تعريف الأنماط
const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 40,
    backgroundColor: '#ffffff',
  },
  // Header
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
  // بيانات الطرفين
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
  // التواريخ
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
  // جدول البنود
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
  colTotal: { flex: 1, textAlign: 'right', color: '#1c1c1e' },
  headerText: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
  },
  // المجاميع
  totalsBlock: {
    marginTop: 20,
    alignItems: 'flex-end',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 200,
    marginBottom: 4,
  },
  totalLabel: { fontSize: 10, color: '#6b7280' },
  totalValue: { fontSize: 10, color: '#1c1c1e' },
  totalFinalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 200,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  totalFinalLabel: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#1c1c1e' },
  totalFinalValue: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#1c1c1e' },
  // معلومات الدفع
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
  // Footer
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

// مكون PDF الفاتورة
export function InvoicePDF({
  invoice,
  lines,
  profile,
}: {
  invoice: any
  lines: any[]
  profile: any
}) {
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
            <Text style={styles.invoiceTitle}>FACTUUR</Text>
            <Text style={styles.invoiceNumber}>{invoice.invoice_number}</Text>
          </View>
        </View>

        {/* بيانات الطرفين */}
        <View style={styles.partiesRow}>
            {/* Van */}
            <View style={styles.partyBlock}>
                <Text style={styles.partyLabel}>Van</Text>
                <Text style={styles.partyName}>{profile.company_name || profile.full_name}</Text>
                <Text style={styles.partyText}>{profile.address}</Text>
                <Text style={styles.partyText}>{profile.postal_code} {profile.city}</Text>
                <Text style={styles.partyText}>KVK: {profile.kvk_number || '—'}</Text>
                <Text style={styles.partyText}>BTW: {profile.btw_number || '—'}</Text>
                <Text style={styles.partyText}>IBAN: {profile.iban || '—'}</Text>
            </View>

            {/* Aan */}
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
        {/* التواريخ */}
        <View style={styles.datesRow}>
          <View style={styles.dateBlock}>
            <Text style={styles.dateLabel}>Factuurdatum</Text>
            <Text style={styles.dateValue}>{invoice.invoice_date}</Text>
          </View>
          <View style={styles.dateBlock}>
            <Text style={styles.dateLabel}>Vervaldatum</Text>
            <Text style={styles.dateValue}>{invoice.due_date}</Text>
          </View>
        </View>

        {/* رؤوس جدول البنود */}
        <View style={styles.tableHeader}>
          <Text style={[styles.colDescription, styles.headerText]}>Omschrijving</Text>
          <Text style={[styles.colQty, styles.headerText]}>Aantal</Text>
          <Text style={[styles.colPrice, styles.headerText]}>Prijs</Text>
          <Text style={[styles.colBtw, styles.headerText]}>BTW</Text>
          <Text style={[styles.colTotal, styles.headerText]}>Totaal</Text>
        </View>

        {/* بنود الفاتورة */}
        {lines.map((line, index) => (
          <View key={index} style={styles.tableRow}>
            <Text style={styles.colDescription}>{line.description}</Text>
            <Text style={styles.colQty}>{line.quantity}</Text>
            <Text style={styles.colPrice}>€{line.unit_price?.toFixed(2)}</Text>
            <Text style={styles.colBtw}>{line.btw_rate}%</Text>
            <Text style={styles.colTotal}>€{line.line_total?.toFixed(2)}</Text>
          </View>
        ))}

        {/* المجاميع */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotaal excl. BTW</Text>
            <Text style={styles.totalValue}>€{invoice.total_ex_btw?.toFixed(2)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>BTW</Text>
            <Text style={styles.totalValue}>€{invoice.btw_amount?.toFixed(2)}</Text>
          </View>
          <View style={styles.totalFinalRow}>
            <Text style={styles.totalFinalLabel}>Totaal incl. BTW</Text>
            <Text style={styles.totalFinalValue}>€{invoice.total_inc_btw?.toFixed(2)}</Text>
          </View>
        </View>

        {/* معلومات الدفع */}
        {profile.iban && (
          <View style={styles.paymentBlock}>
            <Text style={styles.paymentLabel}>Betalingsinformatie</Text>
            <Text style={styles.paymentText}>
              Gelieve te betalen binnen 30 dagen op {profile.iban} o.v.v. {invoice.invoice_number}
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