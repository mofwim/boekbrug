'use client'

// src/components/invoice/PdfPreviewButton.tsx
// [PDF-VOORBEELD] "Bekijk als PDF" — het document zien vóór het onomkeerbaar is.
//
// ── WAAROM ──
//
// Het verstuurscherm vraagt om een bevestiging met vier regels tekst: nummer, e-mailadres, bedrag.
// Wat het NIET liet zien is het document zelf. En dat is precies wat de klant krijgt — met het
// adresblok, de regels, de btw-uitsplitsing en de betaalgegevens erop. Een ondernemer die een
// typefout in zijn eigen adres of een verkeerde regel wil zien, moest de factuur eerst versturen.
//
// Na verzending ligt het NUMMER vast (art. 35 Wet OB). De factuur zelf is nog te corrigeren zolang
// er niets aan hangt — maar de klant heeft dan al een document gezien. Vooraf kijken is een paar
// seconden; een tweede versie naar dezelfde klant sturen is iets anders.
//
// ── WAAROM DIT EEN APART BESTAND IS ── [PDF-LAZY]
//
// Precies dezelfde reden als PdfDownloadButton.tsx, en die kop beschrijft de val: `@react-pdf/
// renderer` is ~1,4 MB, en `invoice-pdf.tsx` importeert hem STATISCH. Eén gewone import van
// InvoicePDF ergens in de keten haalt die bundel dus alsnog binnen, hoeveel `dynamic()` er ook
// omheen staat.
//
// Daarom staan ze hier ALLEBEI, in één brok, en laadt het factuurscherm dit bestand pas wanneer de
// ondernemer echt op "bekijk" drukt. Zolang de renderer en zijn document in hetzelfde lazy-bestand
// zitten, kan een latere import de deferral niet ongemerkt ongedaan maken.
//
// ── WAAROM EEN NIEUW TABBLAD EN GEEN INGEBOUWDE VIEWER ──
//
// Een <iframe> met een PDF is zijn eigen scroller: hij slikt het scrollgebaar zodra je vinger erop
// staat, wat op /dashboard/incoming een gemelde klacht was ([BLAD-GEBAAR]). De browser zijn eigen
// viewer laten openen kost niets, werkt op elke telefoon, en geeft zoomen en delen gratis.

import { useEffect, useState } from 'react'
import { BlobProvider } from '@react-pdf/renderer'
import { InvoicePDF } from '@/lib/invoice-pdf'
// [PDF-BETAAL-QR] The preview must show the SAME paper the customer receives — including the
// scan-to-pay QR the server render adds. Same pure decider, same encoder; the qrcode import is
// dynamic so it stays inside this lazy brick with the renderer.
import { epcPayloadForInvoicePdf } from '@/lib/pdf-betaal-qr'

// De vormen die InvoicePDF verwacht. Bewust los getypt: dit bestand mag niets weten van het
// formulier eromheen, anders hangt de lazy grens weer aan de pagina vast — dezelfde afweging als
// in PdfDownloadButton.tsx.
/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfInvoice = any
type PdfLine = any
type PdfProfile = any
/* eslint-enable @typescript-eslint/no-explicit-any */

export default function PdfPreviewButton({
  invoice,
  lines,
  profile,
  style,
  download,
  label,
  busyLabel,
  failedLabel,
}: {
  invoice: PdfInvoice
  lines: PdfLine[]
  profile: PdfProfile
  style: React.CSSProperties
  /** [TAAL] Every word comes in as a prop — this component holds no language of its own. */
  label: string
  busyLabel: string
  failedLabel: string
  /**
   * A filename turns this into a DOWNLOAD instead of a view.
   *
   * Both live here rather than in two files for the reason the header gives: the lazy boundary
   * only holds while the renderer and the document stay in ONE brick. A second brick beside this
   * one is a second place for a stray static import to undo it.
   */
  download?: string
}) {
  // [PDF-BETAAL-QR] Async QR generation next to a sync document component: build the data URI in
  // an effect, render the document without the QR until it lands (one quick re-render — the same
  // progression the server render goes through, just visible). A failed build leaves it null and
  // the preview matches the fallback the server would produce.
  //
  // The effect keys on the PAYLOAD STRING, not on the invoice/profile objects: the parent form
  // rebuilds those on every keystroke, and an object dependency would regenerate the QR each
  // render. The payload only changes when a figure that is IN the QR changes.
  const epc = epcPayloadForInvoicePdf(invoice, profile)
  const payload = epc?.payload ?? null
  const amount = epc?.amount ?? 0
  // State remembers WHICH payload the data URI was built for; the value handed to the document is
  // DERIVED from that match. No synchronous setState in the effect (the lint is right — it
  // cascades), and a stale image can never ride along: the moment the payload changes, the
  // derived value is null until the fresh build lands.
  const [built, setBuilt] = useState<{ payload: string; dataUrl: string; amount: number } | null>(null)
  useEffect(() => {
    if (!payload) return
    let stale = false
    import('qrcode')
      .then((QR) => QR.toDataURL(payload, { margin: 0, width: 240 }))
      .then((dataUrl) => { if (!stale) setBuilt({ payload, dataUrl, amount }) })
      .catch(() => { /* no QR is yesterday's paper — the derived value below stays null */ })
    return () => { stale = true }
  }, [payload, amount])
  const betaalQr = built && built.payload === payload ? { dataUrl: built.dataUrl, amount: built.amount } : null

  return (
    <BlobProvider document={<InvoicePDF invoice={invoice} lines={lines} profile={profile} betaalQr={betaalQr} />}>
      {({ url, loading, error }) => {
        // [NO-SILENT-EMPTY] A PDF that could not be built says so. A button that silently does
        // nothing on tap is the worst of the three states: the owner taps again, and again, and
        // concludes the app is broken without ever learning what happened.
        if (error) {
          return (
            <span role="status" style={{ ...style, cursor: 'default', opacity: 0.75 }}>{failedLabel}</span>
          )
        }
        if (loading || !url) {
          return <span role="status" style={{ ...style, cursor: 'progress', opacity: 0.75 }}>{busyLabel}</span>
        }
        if (download) return <a href={url} download={download} style={style}>{label}</a>
        return (
          // rel="noopener": a blob URL opened with window.opener attached would give the new
          // document a handle back onto this one.
          <a href={url} target="_blank" rel="noopener noreferrer" style={style}>{label}</a>
        )
      }}
    </BlobProvider>
  )
}
