'use client'

// src/components/invoice/InvoiceDocumentSheet.tsx
// [DOC-INLINE] The paper and our reading of it, on one screen, without leaving the app.
//
// ── WHAT THIS REPLACES ──
// "Bekijk PDF" fetched a signed url and called window.open(url, '_blank'). On a phone that hands
// the file to the operating system: the app goes to the background, a viewer or a download takes
// over, and coming back means finding your place in a list of hundreds again. Checking one invoice
// cost half a minute and a lost scroll position — so checking every invoice, which is what a
// careful owner does, cost their whole afternoon.
//
// ── AND WHY THAT IS THE TRUST PROBLEM, NOT A SEPARATE ONE ──
// "The import is always right, and I still want to check every invoice." That habit is correct —
// the owner is the one answerable for these books — and it is not removed by being more accurate,
// because accuracy is invisible. Two things make it cheap instead:
//
//   · the document next to OUR NUMBERS, so verifying is a glance rather than a task. Not the
//     document alone: what has to be compared is the paper against what we stored, and putting
//     them in two places is what made it work;
//   · the CHECKS said out loud (invoice-checks.ts). The app runs seven of them on every invoice
//     and, when they pass, says nothing — and silence is indistinguishable from not having looked.
//     Stating them turns an absence of warnings into something the owner can judge, including the
//     ones that could not run, which are shown as exactly that and never as a tick.
//
// ── THE PDF FRAME, HONESTLY ──
// An <iframe> renders a pdf inside the page on every desktop browser and on Android. On iOS it is
// unreliable — Safari has shipped versions that render only the first page, and versions that
// render nothing. So the frame is the default and "Openen in nieuw tabblad" stays, one tap away,
// as the escape hatch rather than as the only way in. An image (a photographed bon, the common
// case for a camera intake) needs none of that: <img> works everywhere.

import { useEffect, useState } from 'react'
import { M3, R, FONT, EL2, COLUMN, columnInner, sheetPaddingBottom } from '@/lib/design/tokens'
import { formatEuroNL } from '@/lib/format-nl'
import { invoiceChecks, checksSummary, type CheckInput, type InvoiceCheck } from '@/lib/invoice-checks'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [DOC-GEEN-BLADZIJDE] Welke bestanden een bladzijde hébben, en wat je zegt over de rest.
import { previewKind, noPageNotice, fileOpenHref, type PreviewKind } from '@/lib/document-preview'
// [TAAL] A component holds no language of its own.
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

/** What the sheet needs about the invoice. A structural subset of the row. */
export interface DocumentSheetInvoice extends CheckInput {
  id: string
  client_name: string | null
}

type DocState =
  | { phase: 'loading' }
  | { phase: 'ready'; url: string; kind: PreviewKind; name: string }
  | { phase: 'failed'; message: string }

const TICK: Record<InvoiceCheck['outcome'], { icon: string; color: string }> = {
  passed: { icon: 'check_circle', color: '#137333' },
  flagged: { icon: 'error', color: M3.error },
  // Grey and its own icon on purpose: a check that could not run must not look like a smaller
  // version of a pass. It is a different answer, not a weaker one.
  'not-checked': { icon: 'help', color: '#9AA0A6' },
}

export default function InvoiceDocumentSheet({
  invoice,
  onClose,
  onCorrect,
}: {
  invoice: DocumentSheetInvoice
  onClose: () => void
  /** "Klopt niet?" — hands the owner straight to the correction they just decided they need. */
  onCorrect: (() => void) | null
}) {
  const t = translator(useLocale())
  const [doc, setDoc] = useState<DocState>({ phase: 'loading' })
  // [BLAD-GEBAAR] Does the DOCUMENT own the scroll gesture, or the sheet? False by default, so the
  // sheet always scrolls when it opens — the state the owner is in for the first, and usually only,
  // gesture they make here. Paging is the deliberate second act, and it is reversible: without a
  // way back the fix would trade one trap for another, and on a phone there is no pointer-leave to
  // fall back on.
  const [paging, setPaging] = useState(false)

  useEffect(() => {
    // Cancel-guarded: the sheet can be closed and reopened on another row before this resolves,
    // and a late answer writing into the new render would show the previous invoice's document.
    let cancelled = false
    fetch(`/api/email/file/${invoice.id}`)
      .then((r) => r.json())
      .then((d: { url?: string; kind?: string; name?: string; error?: string }) => {
        if (cancelled) return
        if (!d.url) { setDoc({ phase: 'failed', message: d.error || t('dsh.nietOpenen') }); return }
        // The route sends the kind; previewKind() re-derives it from the name as a fallback, so a
        // still-deployed older route (which only knew image/pdf/other) also gets the new answer.
        const sent = d.kind
        const kind: PreviewKind = sent === 'image' || sent === 'pdf' || sent === 'structured'
          ? sent
          : previewKind(d.name)
        setDoc({ phase: 'ready', url: d.url, kind, name: d.name ?? 'factuur' })
      })
      .catch(() => { if (!cancelled) setDoc({ phase: 'failed', message: t('dsh.nietOpenenVerbinding') }) })
    return () => { cancelled = true }
  }, [invoice.id])
  // [BACK-CLOSES] The system back button closes this, instead of leaving the page behind it.
  useCloseOnBack(true, onClose)


  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const checks = invoiceChecks(invoice)
  const summary = checksSummary(checks)
  const hasFlag = checks.some((c) => c.outcome === 'flagged')
  // [CHECKLIST] The colour is read before the sentence is. Green over "1 konden we niet nagaan"
  // says stop-looking while the words say keep-looking, and on a glance the colour wins — which is
  // the same overstatement in a different medium. Three states in the text, three on screen: red
  // for something to fix, GREY for something we could not check (information, not a verdict), and
  // green reserved for the only case that earns it.
  const hasUnknown = !hasFlag && checks.some((c) => c.outcome === 'not-checked')

  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0' }}>
      <span style={{ fontSize: 12.5, color: M3.onSurfaceVariant, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: M3.onSurface, textAlign: 'end', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )

  return (
    <div
      role="dialog" aria-modal="true" aria-label={t('dsh.aria')}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 320, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      {/* [BLAD-SCROLL] `sheet-frame`, niet `sheet-scroll`. Dit blad heeft een VASTE kop (naam +
          sluitknop) en daaronder een schuivend deel. Met `sheet-scroll` was het paneel zelf óók een
          scroller, dus stonden er twee om dezelfde inhoud: de kop schoof mee weg, en op de bodem
          van de binnenste nam de buitenste het over. Dat is wat er als "scrolt niet goed" uitziet.

          En de inline `maxHeight: '92dvh'` die hier stond, overschreef stilzwijgend de 88dvh uit de
          klasse — een grens die daar met een meting bij staat (Chromium 393×852: een paneel van
          862px in een scherm van 852px, bovenkant afgesneden). Twee getallen voor dezelfde grens,
          waarvan het gemeten getal verloor. Nu staat de grens op één plek. */}
      <div className="sheet-frame"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', width: '100%', maxWidth: columnInner(COLUMN.work),
          borderRadius: `${R.lg}px ${R.lg}px 0 0`, boxShadow: EL2, fontFamily: FONT,
          // [BLAD-EEN-SCROLLER] No inline maxHeight and no inline overflow: both live in the
          // .sheet-frame class above. Two sessions fixed the same two-scroller bug in the same
          // hour — this branch inline, main in the class — and the class is the right half: an
          // inline 92dvh silently outranks the MEASURED 88dvh the class carries (Chromium
          // 393x852: an 862px panel in an 852px screen, top ten pixels cut off). One limit, one
          // place, and the measured number is the one that survives.
          display: 'flex', flexDirection: 'column',
          // [SHEET-BOTTOM] On the PANEL, not on the scroll area inside it. The panel is what the
          // bottom navigation overlaps, and putting the clearance one level in leaves the last
          // control tappable only while the content happens to scroll.
          paddingBottom: sheetPaddingBottom(16),
        }}
      >
        {/* Handle + close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px 8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: M3.onSurface, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {invoice.client_name || t('dsh.onbekendeLeverancier')}
            </p>
            <p style={{ fontSize: 12, color: M3.onSurfaceVariant, margin: '1px 0 0' }}>
              {invoice.invoice_number || t('dsh.zonderNummer')}
            </p>
          </div>
          <button
            onClick={onClose} aria-label={t('dsh.sluiten')}
            style={{ width: 34, height: 34, border: 'none', background: M3.surfaceVariant, borderRadius: R.full, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#5F6368' }}>close</span>
          </button>
        </div>

        {/* [BLAD-EEN-SCROLLER] The ONLY scroller in this sheet. flex:1 claims what the fixed head
            leaves over, and minHeight:0 is not optional: a flex item defaults to min-height:auto
            and therefore refuses to shrink below its content, so `overflowY: auto` alone never
            engages and the panel silently grows past the frame's own limit. overscrollBehavior
            keeps the gesture from chaining to the page behind. */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '0 16px' }}>
          {/* ── What we read ── the half that makes looking at the paper WORTH something ── */}
          <div style={{ background: M3.surfaceVariant, borderRadius: R.md, padding: '10px 12px', marginBottom: 10 }}>
            <p style={{ fontSize: 11.5, fontWeight: 700, color: M3.onSurfaceVariant, margin: '0 0 4px', letterSpacing: 0.3, textTransform: 'uppercase' }}>
              {t('dsh.watGelezen')}
            </p>
            {row(t('dsh.factuurdatum'), invoice.invoice_date || '—')}
            {row(t('dsh.totaalIncl'), invoice.total_inc_btw != null ? formatEuroNL(invoice.total_inc_btw) : '—')}
            {row(t('dsh.btw'), invoice.btw_amount != null ? formatEuroNL(invoice.btw_amount) : '—')}
            {row(t('dsh.exclBtw'), invoice.total_ex_btw != null ? formatEuroNL(invoice.total_ex_btw) : '—')}
          </div>

          {/* ── What we checked ── the answer to "why should I not look myself?" ── */}
          <div style={{ border: `1px solid ${hasFlag ? '#F5C6C0' : '#DADCE0'}`, borderRadius: R.md, padding: '10px 12px', marginBottom: 10 }}>
            <p style={{ fontSize: 12.5, fontWeight: 700, color: hasFlag ? '#B3261E' : hasUnknown ? M3.onSurfaceVariant : '#137333', margin: '0 0 6px' }}>
              {summary}
            </p>
            {checks.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '3px 0' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 15, color: TICK[c.outcome].color, flexShrink: 0, marginTop: 1 }}>
                  {TICK[c.outcome].icon}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, color: c.outcome === 'not-checked' ? M3.onSurfaceVariant : M3.onSurface, lineHeight: 1.35 }}>
                    {c.label}
                  </span>
                  {c.detail && (
                    <span style={{ display: 'block', fontSize: 11.5, color: c.outcome === 'flagged' ? M3.error : M3.onSurfaceVariant, lineHeight: 1.4, marginTop: 1 }}>
                      {c.detail}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* ── The paper itself ── */}
          <div style={{ borderRadius: R.md, overflow: 'hidden', background: '#F1F3F4', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {doc.phase === 'loading' && (
              <p style={{ fontSize: 13, color: M3.onSurfaceVariant, padding: 32 }}>{t('dsh.laden')}</p>
            )}
            {doc.phase === 'failed' && (
              <p style={{ fontSize: 13, color: M3.error, padding: 32, textAlign: 'center' }}>{doc.message}</p>
            )}
            {doc.phase === 'ready' && doc.kind === 'image' && (
              // A photographed bon. Always renders, everywhere — no frame needed.
              <img src={doc.url} alt={t('dsh.factuurAlt', { number: invoice.invoice_number ?? '' })} style={{ width: '100%', height: 'auto', display: 'block' }} />
            )}
            {doc.phase === 'ready' && doc.kind === 'structured' && (
              // [DOC-GEEN-BLADZIJDE] No frame. A machine-readable file has no page, and framing one
              // shows the owner raw XML under a panel of tidy amounts — see document-preview.ts.
              // The reading of it is directly above this block, and the source is one tap below.
              <p style={{
                fontSize: 13, color: M3.onSurfaceVariant, lineHeight: 1.6, padding: '28px 20px',
                textAlign: 'center', margin: 0, fontFamily: FONT,
              }}>
                {noPageNotice(doc.name)}
              </p>
            )}
            {doc.phase === 'ready' && doc.kind !== 'image' && doc.kind !== 'structured' && (
              /* [BLAD-GEBAAR] The document does not take the scroll gesture until it is asked to.
                 An <iframe> is its own scroll container, so an embedded PDF viewer swallows the
                 gesture the moment the finger is over it — and at 58dvh it is most of the sheet.
                 [BLAD-EEN-SCROLLER] moved the two exits OUT of the scroller so this wall could not
                 hide them, which was right and was not the whole defect: the wall is still there,
                 and it appears the instant the document finishes loading. Reported exactly that
                 way — "the scroll breaks after the pdf opens".
                 The <img> branch above needs none of this: an image carries no scroller. */
              <div style={{ position: 'relative', width: '100%' }}>
                <iframe
                  src={doc.url}
                  title={t('dsh.factuurAlt', { number: invoice.invoice_number ?? '' })}
                  style={{ width: '100%', height: '58dvh', border: 'none', background: '#fff', display: 'block' }}
                />
                {!paging && (
                  /* A plain element over the frame. It has no scroller of its own, so the gesture
                     travels to the sheet's one scroller exactly as it does over the checks above.
                     It is a BUTTON, not a bare div: this is reachable by keyboard and announced,
                     and it says why a tap is needed instead of leaving a preview that quietly
                     ignores one. */
                  <button
                    type="button"
                    onClick={() => setPaging(true)}
                    style={{
                      position: 'absolute', inset: 0, width: '100%', border: 'none', cursor: 'pointer',
                      background: 'transparent', display: 'flex', alignItems: 'flex-end',
                      justifyContent: 'center', padding: '0 0 12px', fontFamily: FONT,
                    }}
                  >
                    <span style={{
                      background: 'rgba(32,33,36,0.78)', color: '#fff', fontSize: 12.5, fontWeight: 600,
                      padding: '7px 14px', borderRadius: R.full,
                    }}>{t('dsh.gebaar.ontgrendel')}</span>
                  </button>
                )}
                {paging && (
                  /* The way back. Without it this would trade one trap for another: on a phone
                     there is no pointer-leave to fall back on, so an owner who tapped once would
                     own the document's scroller for the rest of the sheet's life. Placed over the
                     frame's corner rather than under it, because "under the document" is precisely
                     where a control cannot be reached. */
                  <button
                    type="button"
                    onClick={() => setPaging(false)}
                    style={{
                      position: 'absolute', insetInlineEnd: 10, bottom: 10, border: 'none', cursor: 'pointer',
                      background: 'rgba(32,33,36,0.78)', color: '#fff', fontSize: 12.5, fontWeight: 600,
                      padding: '7px 14px', borderRadius: R.full, fontFamily: FONT,
                    }}
                  >
                    {t('dsh.gebaar.vergrendel')}
                  </button>
                )}
              </div>
            )}
          </div>

        </div>

        {/* ── The two ways out ──
            OUTSIDE the scroller, pinned to the sheet.

            They used to sit under the document frame, at the bottom of the scrolling body. On a
            phone that made them unreachable: the frame is 58vh of embedded PDF viewer, and an
            embedded viewer consumes the scroll gesture the moment the finger is over it. So the
            owner scrolled through what we read, through the checks, arrived at the paper — and
            stopped there, with "Klopt niet" and "Nieuw tabblad" below a wall they could not scroll
            past. The two ways out of a sheet are chrome, not content; their reachability may not
            depend on how tall the document happens to be. */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 16px 0', borderTop: `1px solid ${M3.outlineVariant}` }}>
            {onCorrect && (
              <button
                onClick={() => { onClose(); onCorrect() }}
                style={{ flex: 1, padding: '11px 14px', borderRadius: R.full, border: `1px solid ${M3.surfaceVariant}`, background: '#fff', color: M3.primary, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
              >
                {t('dsh.kloptNiet')}
              </button>
            )}
            {doc.phase === 'ready' && (
              // [DOC-INLINE] The escape hatch, not the entrance. iOS Safari has shipped versions
              // that render only the first page of a pdf in a frame, so there has to be a way to
              // hand it to the operating system — one tap away, and never the only route.
              <a
                href={fileOpenHref(invoice.id)} target="_blank" rel="noopener noreferrer"
                style={{ flex: 1, padding: '11px 14px', borderRadius: R.full, background: M3.primaryContainer, color: M3.onPrimaryContainer, fontSize: 13.5, fontWeight: 600, textAlign: 'center', textDecoration: 'none', fontFamily: FONT }}
              >
                {t('dsh.nieuwTabblad')}
              </a>
            )}
        </div>
      </div>
    </div>
  )
}
