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

import { useEffect, useId, useState } from 'react'
import { M3, R, FONT, EL2, COLUMN, columnInner, sheetPaddingBottom } from '@/lib/design/tokens'
import { formatEuroNL } from '@/lib/format-nl'
import { invoiceChecks, checksSummary, type CheckInput, type InvoiceCheck } from '@/lib/invoice-checks'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [BLAD-ACHTERGROND] Terwijl dit blad open staat, beweegt de pagina erachter niet. `overscroll-
// behavior: contain` dekt alleen een gebaar dat IN de scroller begon; een veeg op de vaste kop, op
// de twee knoppen eronder of op de rand naast het paneel ging er gewoon langs — en dan schuift de
// factuurkaart onder het blad door dat je net had geopend. Zie de kop van dat bestand.
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
// [BLAD-PORTAAL] Het blad verlaat de kaartboom — zie de kop van de return hieronder.
import { createPortal } from 'react-dom'
// [DOC-GEEN-BLADZIJDE] Welke bestanden een bladzijde hébben, en wat je zegt over de rest.
import { previewKind, noPageNotice, fileOpenHref, type PreviewKind } from '@/lib/document-preview'
// [TAAL] A component holds no language of its own.
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
// [LEVERANCIER-VASTLEGGEN] Eén keer opschrijven wie deze leverancier is — zie SupplierPinModal.
import SupplierPinModal from '@/components/invoice/SupplierPinModal'
import type { SupplierChoice } from '@/components/invoice/SupplierNameInput'
import { failureText } from '@/lib/server-message'


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
  onReplaceFile,
  suppliers = [],
  suppliersUnavailable = false,
}: {
  invoice: DocumentSheetInvoice
  onClose: () => void
  /**
   * [LEVERANCIER-KIEZEN] The owner's suppliers, passed straight through to the supplier form at
   * the foot of this sheet. Optional: a screen that does not have them opens the form with the
   * plain name field it has always had.
   */
  suppliers?: SupplierChoice[]
  /** [NO-SILENT-EMPTY] The list could not be READ — said so, never rendered as "you have none". */
  suppliersUnavailable?: boolean
  /** "Klopt niet?" — hands the owner straight to the correction they just decided they need. */
  onCorrect: (() => void) | null
  /**
   * [BETER-EXEMPLAAR] "Vervang bestand" — a BETTER COPY of the same paper, when there is one.
   *
   * Null hides it, and the pay screen passes null for an invoice whose document slot is still
   * empty: there the existing "voeg toe" flow applies and offering a replacement would name an
   * act that does not exist yet.
   */
  onReplaceFile: (() => void) | null
}) {
  const t = translator(useLocale())
  const [doc, setDoc] = useState<DocState>({ phase: 'loading' })
  // [BLAD-GEBAAR] Does the DOCUMENT own the scroll gesture, or the sheet? False by default, so the
  // sheet always scrolls when it opens — the state the owner is in for the first, and usually only,
  // gesture they make here. Paging is the deliberate second act, and it is reversible: without a
  // way back the fix would trade one trap for another, and on a phone there is no pointer-leave to
  // fall back on.
  const [paging, setPaging] = useState(false)
  // [LEVERANCIER-VASTLEGGEN] Het leveranciersformulier, geopend vanuit de voet van dit blad — de
  // plek waar de eigenaar het papier vóór zich heeft en dus kan zien hoe het bedrijf zichzelf
  // noemt. Beide incoming-schermen tonen dit blad, dus de deur bestaat maar één keer.
  const [pinning, setPinning] = useState(false)
  const [pinned, setPinned] = useState<string | null>(null)

  // [SPLIT-ALSNOG] Het document nálezen voor ALLEEN zijn btw-specificatie. De route schrijft één
  // sleutel en raakt geen bedrag, geen totaal en geen status aan — daarom mag deze knop ook op een
  // betaalde of verwerkte factuur staan, en juist daar is een niet-nagerekende aftrek het meeste
  // waard om alsnog na te kijken.
  const leesBtwSpecificatie = async () => {
    setNaLezen('bezig')
    try {
      const res = await fetch(`/api/email/reimport/${invoice.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onlyBtwRows: true }),
      })
      const json = await res.json().catch(() => null)
      // Alleen een geslaagde SCHRIJVING telt als antwoord. Een 503 ("we konden dit document nu niet
      // lezen") is geen bevinding over het papier, en hem als lege specificatie opslaan zou de
      // controle voorgoed op "er staat er geen" zetten op grond van een storing.
      if (!res.ok || !json?.ok || json.written !== true || !Array.isArray(json.rows)) {
        setNaLezen('mislukt')
        return
      }
      setNaGelezen(json.rows as { rate: number; base: number; btw: number }[])
      setNaLezen('idle')
    } catch {
      setNaLezen('mislukt')
    }
  }

  useEffect(() => {
    // Cancel-guarded: the sheet can be closed and reopened on another row before this resolves,
    // and a late answer writing into the new render would show the previous invoice's document.
    let cancelled = false
    fetch(`/api/email/file/${invoice.id}`)
      // [SERVER-ZIN] De status reist mee, zodat failureText een 5xx-`detail` (een rauwe
      // databasestring) kan onderdrukken in plaats van hem aan de eigenaar te tonen.
      .then((r) => r.json().then((d) => ({ status: r.status, d })))
      .then(({ status, d }: { status: number; d: { url?: string; kind?: string; name?: string; error?: string } }) => {
        if (cancelled) return
        if (!d.url) { setDoc({ phase: 'failed', message: failureText(status, d, t('dsh.nietOpenen')) }); return }
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
  // [BLAD-ACHTERGROND] This component only exists while the sheet is open, so the lock is
  // unconditional — it is taken on mount and released on unmount, which is exactly the sheet's
  // life. Nothing else has to remember to switch it off.
  useBodyScrollLock(true)


  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  // [SPLIT-ALSNOG] De btw-specificatie die dit blad zojuist heeft laten nalezen. Lokaal, zodat de
  // controleregel meteen zijn nieuwe uitkomst toont; het scherm eronder haalt zijn eigen kopie op
  // wanneer het toch ververst. Null = nog niet gevraagd, [] = gevraagd en er stond er geen.
  const [naGelezen, setNaGelezen] = useState<{ rate: number; base: number; btw: number }[] | null>(null)
  const [naLezen, setNaLezen] = useState<'idle' | 'bezig' | 'mislukt'>('idle')
  // De controles lezen de specificatie uit field_confidence, dus een verse lezing komt daar binnen —
  // niet via een tweede pad dat hetzelfde antwoord anders zou kunnen wegen.
  const teControleren = naGelezen === null
    ? invoice
    : { ...invoice, field_confidence: { ...(invoice.field_confidence ?? {}), _btw_rows: naGelezen } }
  const checks = invoiceChecks(teControleren)
  const summary = checksSummary(checks)
  const hasFlag = checks.some((c) => c.outcome === 'flagged')
  // [CHECKLIST] The colour is read before the sentence is. Green over "1 konden we niet nagaan"
  // says stop-looking while the words say keep-looking, and on a glance the colour wins — which is
  // the same overstatement in a different medium. Three states in the text, three on screen: red
  // for something to fix, GREY for something we could not check (information, not a verdict), and
  // green reserved for the only case that earns it.
  const hasUnknown = !hasFlag && checks.some((c) => c.outcome === 'not-checked')

  // ── [CONTROLES-INKLAPPEN] Nine green ticks is a wall, and a wall is not read ──────────────
  //
  // Every check the app runs was printed in full on every invoice, which turns the one row that
  // matters into the fifth of nine identical green lines. The panel exists to answer "why should I
  // not look myself?", and it answered by making the owner look at everything.
  //
  // Collapsed it shows what is NOT settled, which is the same rule in both directions: nothing to
  // report leaves the heading alone, and something to report leaves exactly that something. The
  // arrow opens the full list for the owner who wants to see the work — the reassurance is still
  // there, it is one tap away instead of nine lines deep.
  //
  // 'not-checked' counts as unsettled, deliberately. It is the [EERSTE-KEER] row — "this is the
  // first account number we have seen for this supplier, take it from the invoice before you pay"
  // — and folding that away behind an arrow would undo the reason it was written.
  const [checksOpen, setChecksOpen] = useState(false)
  const checksListId = useId()
  const openChecks = checks.filter((c) => c.outcome !== 'passed')
  const shownChecks = checksOpen ? checks : openChecks
  const hiddenChecks = checks.length - shownChecks.length

  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0' }}>
      <span style={{ fontSize: 12.5, color: M3.onSurfaceVariant, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: M3.onSurface, textAlign: 'end', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )

  // [BLAD-PORTAAL] Dit blad rendert via een PORTAL op document.body, en dat is geen stijlkeuze
  // maar de derde — en echte — helft van de scroll-klacht.
  //
  // Op /dashboard/incoming staat dit blad IN de kaart (InvoiceCard, className="inv-card"), en
  // .inv-card draagt `content-visibility: auto` ([LIST-PAINT]). Die eigenschap forceert PAINT
  // CONTAINMENT, en paint containment doet twee dingen met een position:fixed-afstammeling:
  // de KAART wordt zijn containing block (inset: 0 = de kaartdoos, niet het scherm), en alles
  // buiten de kaartranden wordt WEGGEKNIPT — de kaart heeft bovendien zelf overflow:hidden.
  //
  // Het gevolg, precies zoals gemeld: een paneel van 88dvh uitgelijnd op de onderrand van een
  // kaart van een paar honderd pixels, de kop mét sluitknop boven de knip — onbereikbaar — en
  // sinds [BLAD-ACHTERGROND] de pagina erachter óók bevroren. De eigenaar zat aan twee kanten
  // vast: de pagina scrolt niet (het slot doet zijn werk) en ín het blad kan hij nooit hoog
  // genoeg om het te sluiten (de kop bestaat, maar is weggeknipt). Het slot was nooit de fout;
  // het maakte de val alleen af.
  //
  // De portal lost het bij de WORTEL op: op document.body is er geen voorouder met containment,
  // dus fixed betekent weer het scherm — vanaf elke aanroepplek, ook een toekomstige die dit
  // blad opnieuw in een kaart zet.
  //
  // De terugval zonder `document` is voor tests/render: die draaien react-dom/server in kaal
  // node, waar createPortal gooit en geen body bestaat. Daar rendert het blad gewoon ter plekke
  // — de markup die de gates lezen is identiek, alleen de plaats in de DOM verschilt.
  const sheet = (
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
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#5F6368' }} aria-hidden>close</span>
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
            {/* [CONTROLES-INKLAPPEN] The heading IS the button: it is the widest thing in the panel
                and the owner is already reading it, so a 15-pixel chevron beside it would be the
                only way in on a phone. */}
            <button
              type="button"
              onClick={() => setChecksOpen((o) => !o)}
              aria-expanded={checksOpen}
              aria-controls={checksListId}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                border: 'none', background: 'none', padding: 0, margin: 0,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start',
              }}
            >
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: hasFlag ? '#B3261E' : hasUnknown ? M3.onSurfaceVariant : '#137333' }}>
                {summary}
              </span>
              {/* What the arrow will reveal, so it is not a mystery button. */}
              {!checksOpen && hiddenChecks > 0 && (
                <span style={{ fontSize: 11.5, color: M3.onSurfaceVariant, flexShrink: 0 }}>
                  {/* The TOTAL, not the folded remainder. "toon alle 8" beside a heading that
                      says nine checks were done is a smaller promise than the panel keeps, and the
                      word is "alle". */}
                  {t('dsh.controlesTonen', { n: String(checks.length) })}
                </span>
              )}
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: M3.onSurfaceVariant, flexShrink: 0 }} aria-hidden>
                {checksOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            <div id={checksListId} style={{ marginTop: shownChecks.length > 0 ? 6 : 0 }}>
            {shownChecks.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '3px 0' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 15, color: TICK[c.outcome].color, flexShrink: 0, marginTop: 1 }} aria-hidden>
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
                  {/* [SPLIT-ALSNOG] De enige controleregel met een handeling eronder, en alleen in de
                      ene toestand waarin die handeling bestaat: een gemengd btw-tarief zonder
                      gedrukte specificatie. Daar is de specificatie het ENIGE wat het btw-bedrag kan
                      tegenspreken — de somidentiteit en de tariefcontrole vallen daar allebei stil
                      (btw-split.ts) — en zonder deze knop eindigde de regel in "vergelijk het zelf".
                      Wat de knop doet is het document nálezen en ALLEEN die specificatie opslaan:
                      geen bedrag, geen totaal, geen status. Zie de smalle tak in de reimport-route. */}
                  {c.id === 'btw-split' && c.outcome === 'not-checked' && naGelezen === null && (
                    <span style={{ display: 'block', marginTop: 4 }}>
                      <button
                        type="button"
                        onClick={leesBtwSpecificatie}
                        disabled={naLezen === 'bezig'}
                        style={{
                          background: 'none', border: 'none', padding: 0, font: 'inherit',
                          fontSize: 11.5, fontWeight: 600, color: M3.primary,
                          cursor: naLezen === 'bezig' ? 'default' : 'pointer',
                        }}
                      >
                        {naLezen === 'bezig' ? t('dsh.btwSpec.bezig') : t('dsh.btwSpec.lees')}
                      </button>
                      {/* [NO-SILENT-EMPTY] Een mislukte poging mag niet als "niets aan de hand"
                          verdwijnen: de controle is dan nog steeds niet gelopen. */}
                      {naLezen === 'mislukt' && (
                        <span style={{ display: 'block', fontSize: 11.5, color: M3.error, lineHeight: 1.4, marginTop: 2 }}>
                          {t('dsh.btwSpec.mislukt')}
                        </span>
                      )}
                    </span>
                  )}
                  {/* Gevraagd, en het papier drukt er geen af. Dat is een BEVINDING, geen storing —
                      en zonder deze zin zou de regel er na de tik uitzien alsof er niets gebeurde. */}
                  {c.id === 'btw-split' && naGelezen !== null && naGelezen.length === 0 && (
                    <span style={{ display: 'block', fontSize: 11.5, color: M3.onSurfaceVariant, lineHeight: 1.4, marginTop: 3 }}>
                      {t('dsh.btwSpec.geen')}
                    </span>
                  )}
                </span>
              </div>
            ))}
            </div>
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
            <button
              onClick={() => setPinning(true)}
              style={{ flex: 1, padding: '11px 14px', borderRadius: R.full, border: `1px solid ${M3.surfaceVariant}`, background: '#fff', color: M3.primary, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
            >
              {t('lev.knop')}
            </button>
            {onCorrect && (
              <button
                onClick={() => { onClose(); onCorrect() }}
                style={{ flex: 1, padding: '11px 14px', borderRadius: R.full, border: `1px solid ${M3.surfaceVariant}`, background: '#fff', color: M3.primary, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
              >
                {t('dsh.kloptNiet')}
              </button>
            )}
            {/* [BETER-EXEMPLAAR] Een BETER exemplaar van hetzelfde papier — de haastige foto vervangen
                door de echte pdf. Nadrukkelijk niet voor een leverancier die de factuur opnieuw
                uitgeeft met andere bedragen: dat zijn twee documenten en daar heeft de app
                "Deze vervangt factuur X" voor. Het oude bestand wordt niet weggegooid; het blijft in
                Mijn bestanden staan en het spoor noemt allebei. */}
            {onReplaceFile && (
              <button
                onClick={() => { onClose(); onReplaceFile() }}
                style={{ flex: 1, padding: '11px 14px', borderRadius: R.full, border: `1px solid ${M3.surfaceVariant}`, background: '#fff', color: M3.primary, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
              >
                {t('dsh.vervangBestand')}
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
        {/* [LEVERANCIER-VASTLEGGEN] Wat de server erover te zeggen had, blijft staan: het gaat over
            wat er VOLGENDE maand gebeurt, en dat is precies de zin die een verdwijnende toast
            opeet. */}
        {pinned && (
          <p style={{ fontSize: 12.5, color: '#137333', margin: '8px 16px 0', lineHeight: 1.45 }}>{pinned}</p>
        )}
      </div>
      {pinning && (
        <SupplierPinModal
          invoice={{ id: invoice.id, client_name: invoice.client_name, vendor_iban: invoice.vendor_iban ?? null }}
          suppliers={suppliers}
          suppliersUnavailable={suppliersUnavailable}
          onClose={() => setPinning(false)}
          onSaved={(r) => {
            setPinning(false)
            setPinned(r.message ?? `${t('lev.opgeslagen')}: ${r.name}`)
          }}
        />
      )}
    </div>
  )
  if (typeof document === 'undefined') return sheet
  return createPortal(sheet, document.body)
}
