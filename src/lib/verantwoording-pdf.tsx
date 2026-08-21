// src/lib/verantwoording-pdf.tsx
// [VERANTWOORDING] The cover page of the quarter package, as a PDF.
//
// The reasoning for the document — what it is, what it must never look like, and why it carries
// the bad news too — is in verantwoording.ts. This file only renders it.
//
// SERVER ONLY. renderToBuffer is a Node export of @react-pdf/renderer; nothing client-side may
// import this module, exactly as with invoice-pdf-server.tsx. It is imported by
// closing-package.ts, which is itself server-only.

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

import { formatEuroNL } from './format-nl'
import { handoverSentence, type Verantwoording } from './verantwoording'

const styles = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 44, paddingHorizontal: 46, fontSize: 9.5, fontFamily: 'Helvetica', color: '#1a1a1a' },
  brand: { fontSize: 8, color: '#6b7280', marginBottom: 2 },
  title: { fontSize: 17, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { fontSize: 10, color: '#374151', marginBottom: 14 },
  meta: { fontSize: 8.5, color: '#6b7280', marginBottom: 18 },
  section: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginTop: 16, marginBottom: 6 },
  row: { flexDirection: 'row', marginBottom: 2.5 },
  label: { width: 210, color: '#4b5563' },
  value: { flex: 1 },
  amount: { width: 92, textAlign: 'right' },
  line: { borderBottomWidth: 0.7, borderBottomColor: '#e5e7eb', marginTop: 8, marginBottom: 2 },
  body: { lineHeight: 1.45, color: '#374151' },
  warn: { marginBottom: 3, lineHeight: 1.4 },
  footer: { marginTop: 20, paddingTop: 10, borderTopWidth: 0.7, borderTopColor: '#e5e7eb', fontSize: 8, color: '#6b7280', lineHeight: 1.5 },
})

const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value}</Text>
  </View>
)

/** DD-MM-YYYY from an ISO timestamp, without pulling a date library into a one-line need. */
function nlDate(iso: string): string {
  const d = iso.slice(0, 10).split('-')
  return d.length === 3 ? `${d[2]}-${d[1]}-${d[0]}` : iso
}

export function VerantwoordingPDF({ v }: { v: Verantwoording }) {
  const handover = handoverSentence(v.handover)
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>BoekBrug</Text>
        <Text style={styles.title}>Verantwoording kwartaalpakket</Text>
        <Text style={styles.sub}>{v.quarterLabel} — {v.clientName}</Text>
        <Text style={styles.meta}>
          {[
            v.kvkNumber ? `KvK ${v.kvkNumber}` : null,
            v.btwNumber ? `BTW ${v.btwNumber}` : null,
            `Samengesteld op ${nlDate(v.generatedAt)}`,
          ].filter(Boolean).join('   ·   ')}
        </Text>

        <Text style={styles.section}>Wat er is aangeleverd</Text>
        <Row label="Verkoopfacturen" value={String(v.outgoingCount)} />
        <Row label="Inkoopfacturen en bonnen" value={String(v.incomingCount)} />
        <Row label="Bestanden in het pakket" value={String(v.filesIncluded)} />
        <Row
          label="Waarvan met e-factuur (UBL)"
          value={v.eInvoiceCount === 0 ? 'geen' : `${v.eInvoiceCount} — machineleesbaar, naast de PDF`}
        />
        <Row label="Bankafschrift bijgevoegd" value={v.bankStatementIncluded ? 'ja' : 'nee'} />

        <Text style={styles.section}>Omzet en BTW (ruwe cijfers)</Text>
        {v.salesByRate.length === 0 ? (
          <Text style={styles.body}>Geen omzet in dit kwartaal.</Text>
        ) : (
          v.salesByRate.map((r) => (
            <View key={r.rate} style={styles.row}>
              <Text style={styles.label}>Omzet {r.rate}%</Text>
              <Text style={styles.amount}>{formatEuroNL(r.totalExcl)}</Text>
              <Text style={styles.amount}>BTW {formatEuroNL(r.totalBtw)}</Text>
            </View>
          ))
        )}
        <View style={styles.line} />
        <Row label="Totaal uitgaand (incl. BTW)" value={formatEuroNL(v.totalSalesIncl)} />
        <Row label="Totaal inkomend (incl. BTW)" value={formatEuroNL(v.totalPurchaseIncl)} />
        <Row label="BTW op verkopen" value={formatEuroNL(v.btwOnSales)} />
        <Row label="BTW op inkopen" value={formatEuroNL(v.btwOnPurchases)} />

        <Text style={styles.section}>Afletteren</Text>
        {/* [DEKKING] Above the numbers, because it changes what they mean: elke regel in een maand
            die nooit is ingelezen ontbreekt in plaats van gekoppeld te zijn. */}
        {v.coverage ? (
          <Text style={[styles.body, { fontFamily: 'Helvetica-Bold', marginBottom: 3 }]}>
            Let op — dit kwartaal is niet volledig ingelezen. {v.coverage} De cijfers hieronder gaan
            alleen over de dagen die er wel zijn.
          </Text>
        ) : null}
        {handover ? (
          <>
            <Text style={styles.body}>{handover}</Text>
            {v.handover && v.handover.unmatched > 0 && (
              <Text style={styles.body}>
                Nog te koppelen: {formatEuroNL(v.handover.unmatchedAmount)}. De open regels staan bovenaan
                in bankafletering.csv.
              </Text>
            )}
            {v.handover && v.handover.withDifference > 0 && (
              <Text style={styles.body}>
                Bij {v.handover.withDifference} gekoppelde {v.handover.withDifference === 1 ? 'regel' : 'regels'} wijkt
                het bedrag af van de factuur; het verschil staat er per regel bij.
              </Text>
            )}
          </>
        ) : (
          // Never "0 van 0 gekoppeld": on a quarter whose bank could not be read, that reads as a
          // finished job. Silence is the honest answer, and the warnings below say what happened.
          <Text style={styles.body}>Er is voor dit kwartaal geen afletering vastgelegd.</Text>
        )}

        <Text style={styles.section}>
          {v.warnings.length > 0 ? 'Wat we niet hebben kunnen vaststellen' : 'Bijzonderheden'}
        </Text>
        {v.warnings.length === 0 ? (
          <Text style={styles.body}>Bij het samenstellen zijn geen onvolkomenheden gevonden.</Text>
        ) : (
          v.warnings.map((w, i) => (
            <Text key={i} style={styles.warn}>· {w.message}</Text>
          ))
        )}

        {/* The line this document may not cross, in its own words and on the same page as the
            numbers. A verklaring is made by a person who answers for it; this is a hand-over made
            by software. */}
        <Text style={styles.footer}>
          Dit is een overzicht van wat BoekBrug heeft aangeleverd en vastgesteld. Het is geen
          accountantsverklaring en geen samenstellingsverklaring. De BTW-cijfers hierboven zijn ruwe
          bedragen uit de aangeleverde stukken; er is geen aangifte ingediend en er is niet geboekt.
          De beoordeling, de verwerking en de aangifte blijven het werk van de boekhouder.
        </Text>
      </Page>
    </Document>
  )
}

/** Render the cover page to a Buffer. Server only — see the header. */
export async function renderVerantwoordingPdf(v: Verantwoording): Promise<Buffer> {
  return renderToBuffer(<VerantwoordingPDF v={v} />) as unknown as Promise<Buffer>
}
