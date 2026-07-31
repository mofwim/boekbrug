'use client'

// src/components/intake/IntakeButton.tsx
// [SMART-INTAKE-B] Shared "+ Toevoegen" entry — one tap to add a document by
// CAMERA or FILE, routed to /api/intake (the unified router decides the
// destination: invoice / receipt / bank / document). Material You styling
// (ZZP/owner surfaces). The /incoming surface (iOS-styled) has its own inline
// variant; this component is for the Dashboard + werkplek.
//
// Two inputs, one direction (incoming intake): a photo (camera) or a file
// (gallery/PDF/bank statement). Both POST the same way; the server classifies.
// No money write here — the server routes; receipts enter the verify queue as a
// suggestion, never auto-paid.

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { combineImagesToPdf } from '@/lib/combine-images-pdf'
// [INTAKE-IMG-NORMALIZE] A lone HEIC/HEIF/WebP/BMP/TIFF (an iPhone photo) reaches the reader as an
// "unsupported type" and is filed as unreadable — losing the invoice. Normalize to a bounded JPEG
// before upload. A PDF (incl. the multi-page combine's output) passes through untouched.
import { normalizeImageForUpload, MAX_INTAKE_UPLOAD_BYTES } from '@/lib/image-normalize-client'
// [UPLOAD-ERRORS] Eén vertaler van HTTP-status → wat de eigenaar leest, gedeeld met
// /dashboard/upload. Puur en getest; zonder dit las een 402 of 413 hier als "Toevoegen mislukt".
import { describeUploadFailure } from '@/lib/upload-failure'
import { useToast } from '@/components/ui/Toast'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, R } from '@/lib/design/tokens'

const FONT = "'Roboto', -apple-system, sans-serif"

type Variant = 'card' | 'fab' | 'compact'

export default function IntakeButton({
  variant = 'card',
  onDone,
}: {
  variant?: Variant
  onDone?: (result: IntakeResult) => void
}) {
  const router = useRouter()
  // [MOTION] The app-wide snackbar (components/ui/Toast), bound to the name the
  // call sites already used. The local one it replaces could not stack, was
  // never announced to a screen reader, and vanished with the page.
  const showToast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // [DUP-MODAL] a duplicate is a decision, not a passing notice — show a modal
  // (stays until dismissed) with a link to the existing invoice, not a toast.
  // [DUP-ARCHIVED] `archived` = de bestaande factuur staat in Genegeerd. Dan is "bestaat al" waar
  // maar onbruikbaar (hij staat in geen enkele gewone lijst), en bij een identiek bestand is
  // terugzetten de enige weg vooruit — de byte-hash-poort is met opzet niet te forceren.
  const [dupModal, setDupModal] = useState<
    // `source` rides along so "Toch toevoegen" re-submits with the SAME provenance it was
    // first sent with — a forced retry of a picked PDF must not turn into a "camera" row.
    { message: string; originalId?: string; canForce?: boolean; archived?: { invoice_id: string; invoice_number: string | null; client_name: string | null }; file?: File; source?: 'camera' | 'upload' } | null
  >(null)
  const [restoring, setRestoring] = useState(false)
  // [INTAKE-DEST-MODAL] When a file is NOT an invoice (destination 'document'),
  // the owner needs to KNOW where it landed — a persistent modal (iOS-styled,
  // matching /incoming) with the destination folder + a deep-link that
  // highlights the file in Mijn bestanden. A fleeting toast is not enough: the
  // owner uploads and wonders "where did that go?".
  const [destModal, setDestModal] = useState<
    // [UNREAD-HONESTY] couldNotRead: het bestand is bewaard maar NIET gelezen (onscherpe foto,
    // mislukte AI-lezing). /api/intake zegt dat met could_not_read, en dit scherm negeerde het —
    // kop "Bestand toegevoegd", mapje-icoon, en de eerlijke zin van de server werd hieronder zelfs
    // WEGGEGOOID zodra er een mapnaam was. Zie de modal onderaan.
    { fileName: string; message: string; folderName: string | null; folderId: string | null; documentId: string | null; isDuplicate?: boolean; couldNotRead?: boolean } | null
  >(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // [MULTI-PAGE] "Meerdere pagina's = één factuur" — gather the pages of ONE invoice, combine
  // them into a single multi-page PDF, then send it as ONE file (same /api/intake). The owner
  // opts in, so we never guess whether separate photos are one invoice or several.
  const [mpMode, setMpMode] = useState(false)
  const [mpPages, setMpPages] = useState<File[]>([])
  const [combining, setCombining] = useState(false)
  const mpCameraRef = useRef<HTMLInputElement>(null)
  const mpFileRef = useRef<HTMLInputElement>(null)
  const MAX_PAGES = 20


  // [DUP-ARCHIVED] "Terugzetten" — de upload botste op een factuur die de eigenaar zelf genegeerd
  // heeft. Opnieuw uploaden lost dat niet op (bij identieke bytes kán het niet eens); de bestaande
  // factuur terugzetten wél. Daarna staat hij weer in de controlewachtrij op Inkomend.
  async function restoreIgnored(invoiceId: string) {
    if (restoring) return
    setRestoring(true)
    try {
      const res = await fetch(`/api/email/confirm/${invoiceId}`, { method: 'PATCH' })
      if (res.ok) {
        setDupModal(null)
        showToast('Teruggezet — staat weer in je controlewachtrij ✓')
        setTimeout(() => router.push('/dashboard/incoming'), 600)
      } else {
        // [UI-HONESTY] 409 = hij staat niet (meer) in Genegeerd. Nooit een succes tonen dat er niet was.
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Terugzetten mislukt — ververs de pagina')
      }
    } catch {
      showToast('Terugzetten mislukt — controleer je verbinding')
    } finally {
      setRestoring(false)
    }
  }

  function addMpPages(fl: FileList | null) {
    if (!fl || fl.length === 0) return
    // [MP-FILTER] Same set the upload page accepts — bmp/tiff belong here too: a flatbed scan
    // often arrives as .bmp/.tif with an EMPTY mime, and this filter silently dropped it while
    // /dashboard/upload took it. Two surfaces, one answer to "is this a page?".
    const imgs = Array.from(fl).filter(
      (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(f.name),
    )
    if (imgs.length === 0) { showToast('Kies foto’s van de pagina’s'); return }
    // [MP-PURE-UPDATER] Decide BEFORE updating state. showToast used to fire from inside the
    // setMpPages updater — a reducer must be pure, and React may run it twice (StrictMode /
    // concurrent rendering), which showed the cap warning twice for one pick.
    const merged = [...mpPages, ...imgs]
    const capped = merged.length > MAX_PAGES
    setMpPages(capped ? merged.slice(0, MAX_PAGES) : merged)
    if (capped) showToast(`Maximaal ${MAX_PAGES} pagina’s per factuur`)
  }
  function closeMultiPage() { setMpMode(false); setMpPages([]) }
  async function combineAndUpload() {
    if (mpPages.length === 0 || combining || busy) return
    setCombining(true)
    try {
      const pdf = await combineImagesToPdf(mpPages)
      const outcome = await handleFile(pdf) // same single-file path: dedup, extract → one invoice
      if (outcome === 'error') {
        // [MP-RETRY] Transient upload failure — KEEP the pages and reopen the sheet so the owner
        // can retry without re-photographing. (handleFile closed the sheet on entry.)
        setOpen(true)
      } else {
        // 'ok' or 'duplicate' — the invoice landed (or already exists); the pages are done.
        setMpMode(false); setMpPages([])
      }
    } catch (e) {
      // Combine failure names either the failing page ("Pagina 2 kon niet…") or the reason the
      // set cannot fit one upload ("Deze 20 pagina's passen samen niet…"). Both are actionable
      // and specific, so surface them as-is; only a truly unknown error gets the generic line.
      showToast(e instanceof Error && /^(Pagina|Deze \d+ pagina)/.test(e.message) ? e.message : 'Combineren mislukt — voeg de pagina’s los toe')
    } finally {
      setCombining(false)
    }
  }

  // Returns the outcome so the multi-page flow knows whether to KEEP the collected pages
  // (a transient 'error') or clear them ('ok' | 'duplicate' — no point retrying the same pages).
  async function handleFile(file: File, force = false, source: 'camera' | 'upload' = 'camera'): Promise<'ok' | 'duplicate' | 'error'> {
    if (busy) return 'error'
    setBusy(true)
    setOpen(false)
    try {
      // [INTAKE-IMG-NORMALIZE] Convert an unreadable/oversized image to a bounded JPEG first; a
      // PDF/normal JPG/PNG is returned untouched. Never throws (worst case the original goes).
      const uploadFile = await normalizeImageForUpload(file, MAX_INTAKE_UPLOAD_BYTES)
      // [SIZE-GUARD] The server refuses anything over the same shared cap. Say so HERE, before
      // pushing megabytes over a mobile link only to be rejected — and say WHY, which the
      // generic failure toast could not. Images were already shrunk above, so in practice this
      // is a very large PDF; naming that is what makes the message actionable.
      // /dashboard/upload has enforced this from the start; this surface never did.
      if (uploadFile.size > MAX_INTAKE_UPLOAD_BYTES) {
        showToast(`Bestand te groot (${(uploadFile.size / 1024 / 1024).toFixed(1)} MB) — max 10 MB. Splits een grote PDF of maak een foto.`)
        return 'error'
      }
      const fd = new FormData()
      fd.append('file', uploadFile)
      // [INTAKE-FORCE] "toch toevoegen" — override a false-positive SEMANTIC duplicate.
      if (force) fd.append('force', 'true')
      // [INTAKE-SOURCE] Where this file actually came from. Every intake used to be recorded as
      // 'camera', so a PDF picked from Files — or a combined multi-page scan — claimed to be a
      // photo in Mijn bestanden and in the audit trail. Both values are in the documents.source
      // CHECK constraint; the server validates and falls back to 'camera'.
      fd.append('source', source)
      const res = await fetch('/api/intake', { method: 'POST', body: fd })
      // [JSON-GUARD] A non-JSON error body (a platform 413, a proxy 502, an HTML error page)
      // made res.json() THROW, which fell through to the generic catch below and replaced the
      // real reason with "probeer opnieuw". Degrade to an empty object instead, exactly as
      // /dashboard/upload does, so the status-code branches below still run.
      const data: IntakeResult = await res.json().catch(() => ({} as IntakeResult))

      if (!res.ok) {
        // A duplicate (409) is a decision point — show a persistent modal, not a
        // fleeting toast. There are TWO kinds of duplicate:
        //   - a file already in Mijn bestanden (data.existing) → reuse the
        //     destination modal so the owner gets a link to WHERE it already is
        //     (highlighted), consistent with a fresh non-invoice upload.
        //   - an invoice duplicate (data.original_id) → link to the invoice in
        //     the incoming manage view.
        let outcome: 'duplicate' | 'error' = 'error'
        // [DUP-ARCHIVED] `data.archived` telt hier mee als reden voor de FACTUUR-modal: een
        // byte-hash-duplicaat van een genegeerde factuur draagt geen original_id/canForce en zou
        // anders in de bestandslocatie-modal belanden ("staat in map X") — precies de melding die
        // de eigenaar niet verder helpt, en zónder de knop die dat wél doet.
        if (res.status === 409 && data.duplicate && (data.original_id || data.canForce || data.archived)) {
          // SEMANTIC invoice duplicate (same invoice, DIFFERENT file — possibly a false
          // positive). Must be checked BEFORE data.existing: the semantic 409 usually ALSO
          // carries `existing` (the original's document), and routing on that first sent it
          // to the file-location modal — hiding the "Toch toevoegen" override and
          // mislabelling a genuinely different file as "al toegevoegd".
          setDupModal({ message: data.error || 'Deze factuur bestaat al', originalId: data.original_id, canForce: !!data.canForce, archived: data.archived, file, source })
          outcome = 'duplicate'
        } else if (res.status === 409 && data.duplicate && data.existing?.id) {
          // BYTE-HASH duplicate of a file (exact same bytes) → show where it already is.
          setDestModal({
            fileName: file.name,
            message: data.error || 'Dit bestand is al toegevoegd',
            folderName: data.existing.folder_name ?? null,
            folderId: data.existing.folder_id ?? null,
            documentId: data.existing.id,
            isDuplicate: true,
          })
          outcome = 'duplicate'
        } else if (res.status === 409 && data.duplicate) {
          setDupModal({ message: data.error || 'Deze factuur bestaat al', originalId: data.original_id, canForce: !!data.canForce, archived: data.archived, file, source })
          outcome = 'duplicate'
        } else {
          // [UPLOAD-ERRORS] Dezelfde vertaler als /dashboard/upload. `data.error || 'Toevoegen
          // mislukt'` klopte precies één keer: bij onze eigen 5xx. Een 402 (maandtegoed op) las als
          // een storing terwijl de server de reden én de uitweg meestuurt, en een 413/504 komt van
          // het platform met een HTML-body — dus data.error bestond daar niet eens en de eigenaar
          // kreeg "Toevoegen mislukt" over een bestand waar niets mis mee was.
          showToast(describeUploadFailure(res.status, data.error).message)
          outcome = 'error'
        }
        return outcome
      }

      // Destination-aware feedback + navigation.
      onDone?.(data)

      // Route the owner to where the item landed, so they can confirm/see it.
      if (data.destination === 'invoice' || data.destination === 'receipt') {
        showToast(data.message || 'Toegevoegd ✓')
        // [AUTO-ADVANCE-HONESTY] An auto-verified invoice is booked ('received') and so
        // is NOT in the verify queue. Sending the owner to /dashboard/incoming — as this
        // did for every invoice — landed them on a queue that does not contain the file
        // they just photographed, right after a toast saying it was processed. Route to
        // the surface that actually holds it, focused on the row.
        const target = data.auto_verified && data.invoice_id
          ? `/dashboard/incoming/manage?focus=${data.invoice_id}`
          : '/dashboard/incoming'
        setTimeout(() => router.push(target), 600)
      } else if (data.destination === 'bank') {
        showToast(data.message || 'Toegevoegd ✓')
        setTimeout(() => router.push('/dashboard/bank'), 600)
      } else if (data.destination === 'statement') {
        // [STATEMENT-RECONCILE] Een leveranciersoverzicht wordt niet geboekt maar vergeleken:
        // de uitkomst ("2 van de 9 facturen heb je niet") is het hele punt en mag niet in een
        // toast van drie seconden verdwijnen. Zelfde blijvende modal als een gewoon bestand —
        // die toont de boodschap én de link naar het bestand in Mijn bestanden.
        setDestModal({
          fileName: file.name,
          message: data.message || 'Rekeningoverzicht gecontroleerd',
          folderName: data.folder_name ?? null,
          folderId: data.folder_id ?? null,
          documentId: data.document_id ?? null,
        })
      } else if (data.destination === 'turnover') {
        // [INTAKE-DEST-OMZET] Een kassabestand is GEBOEKTE OMZET — /api/intake schrijft de dagen
        // meteen in daily_turnover en zegt in zijn eigen boodschap "Controleer in Dagomzet".
        // Dat is de zwaarste uitkomst die deze knop kan hebben: er staat geld in de boeken.
        // Toch viel hij hier tot nu toe in de restbak — een toast van drie seconden en
        // router.refresh(), dus de eigenaar bleef staan waar hij stond, zonder weg naar de
        // pagina die hij net gevraagd werd te controleren. Elke andere bestemming brengt hem
        // wél naar waar zijn bestand landde; deze hoort dat als eerste te doen.
        showToast(data.message || 'Dagomzet geboekt ✓')
        setTimeout(() => router.push('/dashboard/dagomzet'), 600)
      } else if (data.destination === 'ledger') {
        // [INTAKE-DEST-CHECK] Een grootboek-/controlebestand is NADRUKKELIJK GEEN geld: het telt
        // niet mee in de omzet en heeft daarom geen eigen scherm — het werkt door in de
        // reconciliatie en op het klaar-scherm. De uitkomst is dus een ZIN ("14 dagen als
        // controle-check"), geen plaats. Precies zoals bij een leveranciersoverzicht mag die zin
        // niet in een toast verdwijnen: dezelfde blijvende modal, met de link naar het bestand.
        setDestModal({
          fileName: file.name,
          message: data.message || 'Ingelezen als controle-check',
          folderName: data.folder_name ?? null,
          folderId: data.folder_id ?? null,
          documentId: data.document_id ?? null,
        })
      } else if (data.destination === 'document') {
        // [INTAKE-DEST-MODAL] Not an invoice → the owner can't guess where it
        // went. Show a persistent modal with the destination + a deep-link that
        // highlights the file in Mijn bestanden. No auto-redirect: the owner
        // decides whether to open it (tap the link) or stay (tap "Klaar").
        setDestModal({
          fileName: file.name,
          message: data.message || 'Opgeslagen in je bestanden',
          folderName: data.folder_name ?? null,
          folderId: data.folder_id ?? null,
          documentId: data.document_id ?? null,
          // [UNREAD-HONESTY] "Geen factuur herkend" en "we konden het niet lezen" zijn twee heel
          // verschillende uitkomsten, en alleen de tweede vraagt om een handeling. De route zegt
          // welke van de twee het is; dit scherm las dat veld niet.
          couldNotRead: data.could_not_read === true,
        })
      } else {
        // Restbak. Sinds hierboven alle zeven bestemmingen van /api/intake een eigen tak hebben,
        // komt hier alleen nog een antwoord ZONDER destination — een oudere of onvolledige
        // response. Dan is de boodschap van de server het enige eerlijke dat we hebben.
        showToast(data.message || 'Toegevoegd ✓')
        router.refresh()
      }
      return 'ok'
    } catch {
      showToast('Toevoegen mislukt — probeer opnieuw')
      return 'error'
    } finally {
      setBusy(false)
    }
  }

  // ─── Trigger button (varies by placement) ───────────────────────────────────
  const trigger =
    variant === 'fab' ? (
      <button
        onClick={() => setOpen(true)}
        disabled={busy}
        aria-label="Toevoegen"
        style={{
          position: 'fixed',
          bottom: 'calc(88px + var(--bottom-nav-h) + env(safe-area-inset-bottom))',
          right: 20,
          background: M3.primary, color: M3.onPrimary,
          borderRadius: 16, padding: '16px 20px',
          fontSize: 15, fontWeight: 600, border: 'none',
          cursor: busy ? 'not-allowed' : 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: FONT, zIndex: 49,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
          {busy ? 'hourglass_empty' : 'add_a_photo'}
        </span>
        Bon/factuur
      </button>
    ) : variant === 'compact' ? (
      <button
        onClick={() => setOpen(true)}
        disabled={busy}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: M3.primaryContainer, color: M3.onPrimaryContainer,
          borderRadius: R.full, padding: '10px 18px',
          border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
          fontFamily: FONT, fontSize: 14, fontWeight: 600,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          {busy ? 'hourglass_empty' : 'add_a_photo'}
        </span>
        Toevoegen
      </button>
    ) : (
      // 'card' — matches the Dashboard ActionCard look
      <button
        onClick={() => setOpen(true)}
        disabled={busy}
        style={{
          display: 'flex', alignItems: 'center', gap: 16,
          background: '#fff', borderRadius: R.lg, padding: '18px 16px',
          border: 'none', boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
          cursor: busy ? 'not-allowed' : 'pointer', textAlign: 'left', width: '100%',
          fontFamily: FONT,
        }}
      >
        <div style={{ width: 50, height: 50, borderRadius: R.md, background: M3.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 26 }}>
            {busy ? 'hourglass_empty' : 'add_a_photo'}
          </span>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 16, fontWeight: 600, color: M3.onSurface, marginBottom: 2 }}>Bon of factuur toevoegen</p>
          <p style={{ fontSize: 13, color: '#5F6368' }}>Maak een foto of upload — AI sorteert het</p>
        </div>
        <span className="material-symbols-outlined" style={{ color: '#80868b', fontSize: 20 }}>chevron_right</span>
      </button>
    )

  return (
    <>
      {trigger}

      {/* Hidden inputs: camera (environment) + file (gallery/PDF/bank) */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, false, 'camera'); e.currentTarget.value = '' }}
      />
      {/* [INTAKE-ACCEPT] The same set /dashboard/upload offers, because /api/intake handles the
          same set: a kassa Z-report / grootboek export (.xls/.xlsx/.csv → handleSpreadsheet) and
          a bank CSV export (ING/Rabo/bunq → the bank pipeline). Those were missing here, so this
          sheet promised "PDF, afbeelding of bankafschrift" while the most common bankafschrift —
          a CSV export — could not even be selected, and a shop could not add its monthly till
          file from the button it is told to use. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,.pdf,.xml,.mt940,.sta,.camt,.053,.txt,.940,.xls,.xlsx,.csv"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, false, 'upload'); e.currentTarget.value = '' }}
      />
      {/* [MULTI-PAGE] pages of ONE invoice — camera adds one at a time, file picker several. */}
      <input
        ref={mpCameraRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { addMpPages(e.target.files); e.currentTarget.value = '' }}
      />
      <input
        ref={mpFileRef} type="file" accept="image/*" multiple
        style={{ display: 'none' }}
        onChange={(e) => { addMpPages(e.target.files); e.currentTarget.value = '' }}
      />

      {/* Choice sheet */}
      {open && (
        <div
          // [MP-KEEP-PAGES] A tap on the backdrop closes the sheet, but it must NOT throw away
          // pages the owner already photographed: closeMultiPage() empties mpPages, so one stray
          // tap next to the sheet silently destroyed up to 20 photos of a paper invoice, with no
          // warning and no undo. With pages in the tray the backdrop is inert — the explicit
          // "Terug" button inside the sheet is the way out, and it is right there.
          onClick={() => { if (!combining && mpPages.length === 0) { setOpen(false); closeMultiPage() } }}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: M3.surface, borderRadius: '28px 28px 0 0', padding: '24px 20px 32px', width: '100%', maxWidth: 480, boxShadow: '0 -8px 32px rgba(0,0,0,0.18)', fontFamily: FONT }}>
            <div style={{ width: 32, height: 4, background: '#DADCE0', borderRadius: 2, margin: '0 auto 20px' }} />

            {!mpMode ? (
              <>
                <p style={{ fontSize: 20, fontWeight: 700, color: M3.onSurface, marginBottom: 4, textAlign: 'center' }}>Toevoegen</p>
                <p style={{ fontSize: 13, color: '#5F6368', textAlign: 'center', marginBottom: 20 }}>
                  Maak een foto of kies een bestand. De AI herkent en sorteert het automatisch.
                </p>

                <button
                  onClick={() => cameraRef.current?.click()}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', background: M3.primary, color: '#fff', borderRadius: R.lg, padding: '18px 16px', border: 'none', cursor: 'pointer', fontFamily: FONT, marginBottom: 12 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 28 }}>photo_camera</span>
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>Foto maken</p>
                    <p style={{ fontSize: 13, opacity: 0.9 }}>Bon of factuur fotograferen</p>
                  </div>
                </button>

                <button
                  onClick={() => fileRef.current?.click()}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', background: M3.primaryContainer, color: M3.onPrimaryContainer, borderRadius: R.lg, padding: '18px 16px', border: 'none', cursor: 'pointer', fontFamily: FONT, marginBottom: 12 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 28 }}>upload_file</span>
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>Bestand uploaden</p>
                    <p style={{ fontSize: 13, opacity: 0.85 }}>PDF, afbeelding of bankafschrift</p>
                  </div>
                </button>

                {/* [MULTI-PAGE] A paper invoice of 2+ pages, photographed page by page. */}
                <button
                  onClick={() => setMpMode(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', background: '#fff', color: M3.onSurface, borderRadius: R.lg, padding: '16px', border: '1.5px solid #DADCE0', cursor: 'pointer', fontFamily: FONT }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 26, color: M3.primary }}>description</span>
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>Factuur met meerdere pagina&apos;s</p>
                    <p style={{ fontSize: 12.5, color: '#5F6368' }}>Meerdere pagina&apos;s → samen één factuur</p>
                  </div>
                </button>

                <p style={{ fontSize: 11.5, color: '#8e8e93', textAlign: 'center', margin: '12px 4px 0', lineHeight: 1.45 }}>
                  Eén PDF = één factuur. Meerdere verschillende facturen? Voeg ze los toe.
                </p>

                <button onClick={() => { setOpen(false); closeMultiPage() }} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: M3.primary, fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT, marginTop: 8 }}>
                  Annuleren
                </button>
              </>
            ) : (
              // [MULTI-PAGE] Collector — like a scanner's "add page": snap/pick each page, then combine.
              <>
                <p style={{ fontSize: 20, fontWeight: 700, color: M3.onSurface, marginBottom: 4, textAlign: 'center' }}>Eén factuur, meerdere pagina&apos;s</p>
                <p style={{ fontSize: 13, color: '#5F6368', textAlign: 'center', marginBottom: 16 }}>
                  Fotografeer of kies elke pagina van dezelfde factuur. We voegen ze samen tot één factuur.
                </p>

                {mpPages.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14, maxHeight: '32vh', overflowY: 'auto' }}>
                    {mpPages.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: '#F1F3F4', borderRadius: 10 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: M3.primary, minWidth: 62 }}>Pagina {i + 1}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#5F6368', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <button onClick={() => setMpPages((prev) => prev.filter((_, j) => j !== i))} disabled={combining} aria-label="Verwijder pagina"
                          style={{ border: 'none', background: 'transparent', color: '#70757a', fontSize: 18, cursor: combining ? 'default' : 'pointer', lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button onClick={() => !combining && mpCameraRef.current?.click()} disabled={combining}
                    style={{ flex: 1, padding: '12px', borderRadius: 12, border: `1px solid ${M3.surfaceVariant}`, background: '#fff', color: M3.primary, fontWeight: 600, fontSize: 13.5, cursor: combining ? 'default' : 'pointer', fontFamily: FONT }}>
                    📷 Pagina fotograferen
                  </button>
                  <button onClick={() => !combining && mpFileRef.current?.click()} disabled={combining}
                    style={{ flex: 1, padding: '12px', borderRadius: 12, border: `1px solid ${M3.surfaceVariant}`, background: '#fff', color: M3.primary, fontWeight: 600, fontSize: 13.5, cursor: combining ? 'default' : 'pointer', fontFamily: FONT }}>
                    🖼️ Pagina&apos;s kiezen
                  </button>
                </div>

                <button onClick={combineAndUpload} disabled={combining || mpPages.length === 0}
                  style={{ width: '100%', padding: '15px', borderRadius: R.lg, border: 'none', fontWeight: 700, fontSize: 15, fontFamily: FONT,
                    background: combining || mpPages.length === 0 ? '#C7C7CC' : M3.primary, color: '#fff',
                    cursor: combining || mpPages.length === 0 ? 'default' : 'pointer' }}>
                  {combining ? 'Bezig…' : mpPages.length > 0 ? `Combineer ${mpPages.length} pagina${mpPages.length === 1 ? '' : "'s"} → één factuur` : "Voeg eerst pagina's toe"}
                </button>

                <button onClick={closeMultiPage} disabled={combining}
                  style={{ width: '100%', padding: '13px', borderRadius: R.full, background: 'transparent', color: M3.primary, fontSize: 15, fontWeight: 600, border: 'none', cursor: combining ? 'default' : 'pointer', fontFamily: FONT, marginTop: 8 }}>
                  Terug
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* [DUP-MODAL] Persistent duplicate dialog — stays until dismissed, with
          a link to the existing invoice (same deep-link as notifications). */}
      {dupModal && (
        <div
          onClick={() => setDupModal(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 24, padding: '28px 24px', width: '100%', maxWidth: 380, boxShadow: '0 12px 40px rgba(0,0,0,0.24)', fontFamily: FONT, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: R.full, background: '#FEE8C4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 30, color: '#7C5800' }}>content_copy</span>
            </div>
            <p style={{ fontSize: 18, fontWeight: 700, color: M3.onSurface, marginBottom: 8 }}>
              {/* [DUP-ARCHIVED] Genegeerd is een ándere situatie dan "bestaat al" — de kop zegt welke. */}
              {dupModal.archived ? 'Deze factuur staat in Genegeerd' : 'Deze factuur bestaat al'}
            </p>
            <p style={{ fontSize: 14, color: '#5F6368', marginBottom: 24, lineHeight: 1.5 }}>{dupModal.message}</p>

            {/* [DUP-ARCHIVED] De handeling die hier werkt, als eerste knop. Bij een identiek bestand
                is dit de enige — de byte-hash-poort kent geen "toch toevoegen". */}
            {dupModal.archived && (
              <button
                onClick={() => restoreIgnored(dupModal.archived!.invoice_id)}
                disabled={restoring}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', background: M3.primary, color: '#fff', borderRadius: R.full, padding: '14px', border: 'none', cursor: restoring ? 'default' : 'pointer', fontFamily: FONT, fontSize: 15, fontWeight: 600, marginBottom: 10, opacity: restoring ? 0.6 : 1 }}
              >
                {restoring ? 'Bezig…' : 'Terugzetten uit Genegeerd'}
                {!restoring && <span className="material-symbols-outlined" style={{ fontSize: 18 }}>undo</span>}
              </button>
            )}

            {dupModal.originalId && !dupModal.archived && (
              <button
                onClick={() => { const id = dupModal.originalId; setDupModal(null); router.push(`/dashboard/incoming/manage?focus=${id}`) }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', background: M3.primary, color: '#fff', borderRadius: R.full, padding: '14px', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 15, fontWeight: 600, marginBottom: 10 }}
              >
                Bekijk de bestaande factuur
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
              </button>
            )}
            {/* [INTAKE-FORCE] A semantic match can be a false positive (two distinct
                same-day receipts, same vendor/amount, no number). Let the owner add it
                anyway — re-submits with force=true; the exact-same-file gate still holds. */}
            {dupModal.canForce && dupModal.file && (
              <button
                onClick={() => { const f = dupModal.file!; const src = dupModal.source ?? 'camera'; setDupModal(null); handleFile(f, true, src) }}
                style={{ width: '100%', background: 'transparent', color: '#7C5800', borderRadius: R.full, padding: '13px', border: '1px solid #E0C48A', cursor: 'pointer', fontFamily: FONT, fontSize: 14.5, fontWeight: 600, marginBottom: 10 }}
              >
                Toch toevoegen — dit is een andere factuur
              </button>
            )}
            <button
              onClick={() => setDupModal(null)}
              style={{ width: '100%', background: 'transparent', color: M3.primary, borderRadius: R.full, padding: '12px', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 15, fontWeight: 600 }}
            >
              Begrepen
            </button>
          </div>
        </div>
      )}

      {/* [INTAKE-DEST-MODAL] Non-invoice file → persistent modal telling the
          owner WHERE it landed, with a deep-link that highlights it in Mijn
          bestanden. iOS-styled to match the /incoming results modal. */}
      {destModal && (
        <div
          onClick={() => setDestModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 400 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 20px',
              paddingBottom: 'calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))',
              width: '100%', maxWidth: 430,
            }}
          >
            {/* [UNREAD-HONESTY] "Bestand toegevoegd" is waar én misleidend als we het niet konden
                lezen: er is niets van geboekt, en dit is juist het bestand waar de eigenaar nog iets
                mee moet. De kop zegt dat nu. */}
            <div style={{ fontWeight: 700, fontSize: 19, color: '#202124', marginBottom: 4 }}>
              {destModal.isDuplicate ? 'Dit bestand bestaat al'
                : destModal.couldNotRead ? 'Bewaard, maar niet gelezen'
                : 'Bestand toegevoegd'}
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>
              {destModal.isDuplicate ? 'Je hebt dit bestand al eerder toegevoegd:'
                : destModal.couldNotRead ? 'Het bestand is veilig opgeslagen, maar we konden er niets uit lezen:'
                : 'Dit is er met je bestand gebeurd:'}
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 12, background: destModal.couldNotRead ? '#FEF7E0' : '#f8f9fa', marginBottom: 20 }}>
              <span style={{ fontSize: 16, lineHeight: '20px' }}>
                {destModal.isDuplicate ? 'ℹ️' : destModal.couldNotRead ? '⚠️' : '📁'}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {destModal.fileName}
                </p>
                {/* De mapnaam WON hier van de boodschap, ook wanneer die boodschap "we konden dit
                    document niet lezen — controleer het" was. Precies de zin die de eigenaar moet
                    lezen verdween dus zodra het bestand netjes was opgeborgen. Nu wint de reden, en
                    de plaats staat eronder. */}
                {destModal.couldNotRead ? (
                  <>
                    <p style={{ fontSize: 12, color: '#8A5A00', margin: 0, lineHeight: 1.45 }}>{destModal.message}</p>
                    {destModal.folderName && (
                      <p style={{ fontSize: 12, color: '#1a73e8', margin: '4px 0 0' }}>Het staat in: {destModal.folderName}</p>
                    )}
                  </>
                ) : (
                  <p style={{ fontSize: 12, color: '#1a73e8', margin: 0 }}>
                    {destModal.folderName ? `Dit bestand staat in: ${destModal.folderName}` : destModal.message}
                  </p>
                )}
                {destModal.documentId && (
                  <button
                    type="button"
                    onClick={() => {
                      // [BESTANDEN-FOCUS] Root must be the ABSENCE of ?folder=, not an
                      // empty string. BestandenPage inits currentFolderId directly from
                      // params.get("folder"), so ?folder= (empty) becomes "" and breaks
                      // navigation. Omit folder entirely when the file sits at the root.
                      const focus = destModal.documentId
                      const url = destModal.folderId
                        ? `/dashboard/bestanden?folder=${destModal.folderId}&focus=${focus}`
                        : `/dashboard/bestanden?focus=${focus}`
                      setDestModal(null)
                      router.push(url)
                    }}
                    style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#1a73e8', fontSize: 12, fontWeight: 600, textDecoration: 'underline' }}
                  >
                    Bekijk in bestanden →
                  </button>
                )}
              </div>
            </div>

            <button
              onClick={() => setDestModal(null)}
              style={{
                width: '100%', padding: '16px', borderRadius: 14,
                background: '#34a853', color: '#fff', border: 'none',
                fontWeight: 700, fontSize: 16, cursor: 'pointer', fontFamily: FONT,
              }}
            >
              Klaar
            </button>
          </div>
        </div>
      )}

    </>
  )
}

// Result shape from /api/intake
export interface IntakeResult {
  ok?: boolean
  // Alle zeven bestemmingen die /api/intake kan teruggeven. Deze lijst was er vijf, en de twee
  // die ontbraken waren geen randgevallen: 'turnover' is GEBOEKTE OMZET.
  // [STATEMENT-RECONCILE] 'statement' = een leveranciersoverzicht: niet geboekt, maar vergeleken
  // met wat we van die leverancier hebben (welke factuur mis ik?).
  // 'turnover' = kassa-omzet, meteen geboekt in daily_turnover → te zien in Dagomzet.
  // 'ledger'   = grootboek/controle-check, nadrukkelijk GEEN geld → werkt door in de reconciliatie.
  destination?: 'invoice' | 'receipt' | 'bank' | 'document' | 'statement' | 'turnover' | 'ledger'
  message?: string
  // [UNREAD-HONESTY] true wanneer het bestand wél is opgeslagen maar NIET gelezen kon worden. Dat is
  // iets anders dan "geen factuur herkend": er is niets van geboekt en er moet nog iets gebeuren.
  // De route stuurt dit al sinds [TRUST-INTAKE]; dit scherm las het niet.
  could_not_read?: boolean
  error?: string
  duplicate?: boolean
  invoice_id?: string
  // [AUTO-ADVANCE-HONESTY] true when the app verified AND booked this invoice itself
  // ([AUTO-ADVANCE] in /api/intake): status 'received', so it is NOT in the verify
  // queue but on Inkoopfacturen. Drives where we send the owner afterwards.
  auto_verified?: boolean
  original_id?: string  // [DUP-MODAL] the existing invoice this duplicates → deep-link
  canForce?: boolean    // [INTAKE-FORCE] a semantic dup that may be overridden ("toch toevoegen")
  // [DUP-ARCHIVED] present ⇒ the invoice this upload collides with sits in Genegeerd. The block
  // itself is unchanged; this only lets the client name the situation and offer "Terugzetten".
  archived?: { invoice_id: string; invoice_number: string | null; client_name: string | null }
  suggest_paid?: boolean
  // [MULTI-INVOICE] Present when ONE uploaded file appeared to hold several different invoices.
  // Only one of them was read; `numbers` names what is still missing. Never a block — the
  // invoice imports, held out of auto-booking, and `message` already says what to do.
  multipleInvoices?: { numbers: string[] }
  // [INTAKE-DEST-MODAL] present for destination 'document' → deep-link + highlight
  document_id?: string
  folder_id?: string | null
  folder_name?: string | null
  // [INTAKE-DEST-MODAL] present on a 409 duplicate of a general file → deep-link
  // to where the file already lives in Mijn bestanden (highlighted).
  existing?: {
    id: string
    folder_id?: string | null
    folder_name?: string | null
  }
}