'use client'

// src/app/factuur-maken/PdfDownloadButton.tsx
// [PDF-LAZY] De downloadknop van de gratis factuurgenerator, mét alles wat @react-pdf nodig heeft.
//
// ── WAAROM DIT EEN APART BESTAND IS ──
// GratisFactuur laadde PDFDownloadLink al met next/dynamic, en de comment erboven zei precies wat
// de bedoeling was: de PDF-renderer hoort niet in de eerste download te zitten. Twaalf regels
// hoger stond echter een gewone import:
//
//     import { InvoicePDF } from '@/lib/invoice-pdf'      // en die doet:
//     import { Document, Page, … } from '@react-pdf/renderer'
//
// Eén statische import verderop in dezelfde keten haalt de hele bundel alsnog binnen, dus de
// dynamic() eromheen stelde niets voor. De pagina woog 2,5 MB waarvan 1,4 MB die renderer — op
// een telefoon op 4G seconden voordat er iets te doen valt, en dat op de twaalf publieke pagina's
// waarvan het hele doel is een vreemde te overtuigen.
//
// De oplossing is niet nóg een dynamic() ernaast, maar één brok: beide imports staan HIER, en
// GratisFactuur laadt dit bestand als geheel pas wanneer er echt gedownload wordt. Zolang de
// renderer en zijn document in hetzelfde lazy-bestand zitten, kan een latere import de deferral
// niet opnieuw ongedaan maken zonder dat het opvalt.

import { PDFDownloadLink } from '@react-pdf/renderer'
import { InvoicePDF } from '@/lib/invoice-pdf'

// De vormen die InvoicePDF verwacht. Bewust los getypt: dit bestand mag niets weten van het
// formulier eromheen, anders hangt de lazy grens weer aan de pagina vast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfInvoice = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfLine = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfProfile = any

export default function PdfDownloadButton({
  invoice,
  lines,
  profile,
  fileName,
  style,
  onClick,
  onLoadingChange,
}: {
  invoice: PdfInvoice
  lines: PdfLine[]
  profile: PdfProfile
  fileName: string
  style: React.CSSProperties
  onClick: () => void
  /** De ouder houdt bij of de PDF nog wordt gebouwd — zelfde signaal als voorheen. */
  onLoadingChange: (loading: boolean) => void
}) {
  return (
    <PDFDownloadLink
      document={<InvoicePDF invoice={invoice} lines={lines} profile={profile} />}
      fileName={fileName}
      style={style}
      onClick={onClick}
    >
      {({ loading }: { loading: boolean }) => {
        onLoadingChange(loading)
        return loading ? 'PDF wordt gemaakt…' : '↓ Download PDF'
      }}
    </PDFDownloadLink>
  )
}
