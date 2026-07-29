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
import { useToast } from '@/components/ui/Toast'

const M3 = {
  primary: '#1A73E8', onPrimary: '#FFFFFF',
  primaryContainer: '#D3E3FD', onPrimaryContainer: '#041E49',
  surface: '#ffffff', onSurface: '#202124',
  surfaceVariant: '#f1f3f4',
  success: '#34A853', error: '#B3261E',
}
const FONT = "'Roboto', -apple-system, sans-serif"
const R = { md: 12, lg: 16, full: 9999 }

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
    { message: string; originalId?: string; canForce?: boolean; archived?: { invoice_id: string; invoice_number: string | null; client_name: string | null }; file?: File } | null
  >(null)
  const [restoring, setRestoring] = useState(false)
  // [INTAKE-DEST-MODAL] When a file is NOT an invoice (destination 'document'),
  // the owner needs to KNOW where it landed — a persistent modal (iOS-styled,
  // matching /incoming) with the destination folder + a deep-link that
  // highlights the file in Mijn bestanden. A fleeting toast is not enough: the
  // owner uploads and wonders "where did that go?".
  const [destModal, setDestModal] = useState<
    { fileName: string; message: string; folderName: string | null; folderId: string | null; documentId: string | null; isDuplicate?: boolean } | null
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
    const imgs = Array.from(fl).filter(
      (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name),
    )
    if (imgs.length === 0) { showToast('Kies foto’s van de pagina’s'); return }
    setMpPages((prev) => {
      const merged = [...prev, ...imgs]
      if (merged.length > MAX_PAGES) { showToast(`Maximaal ${MAX_PAGES} pagina’s per factuur`); return merged.slice(0, MAX_PAGES) }
      return merged
    })
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
      // Combine failure names the failing page; keep the other pages for a quick redo.
      showToast(e instanceof Error && /Pagina/.test(e.message) ? e.message : 'Combineren mislukt — voeg de pagina’s los toe')
    } finally {
      setCombining(false)
    }
  }

  // Returns the outcome so the multi-page flow knows whether to KEEP the collected pages
  // (a transient 'error') or clear them ('ok' | 'duplicate' — no point retrying the same pages).
  async function handleFile(file: File, force = false): Promise<'ok' | 'duplicate' | 'error'> {
    if (busy) return 'error'
    setBusy(true)
    setOpen(false)
    try {
      // [INTAKE-IMG-NORMALIZE] Convert an unreadable/oversized image to a bounded JPEG first; a
      // PDF/normal JPG/PNG is returned untouched. Never throws (worst case the original goes).
      const uploadFile = await normalizeImageForUpload(file, MAX_INTAKE_UPLOAD_BYTES)
      const fd = new FormData()
      fd.append('file', uploadFile)
      // [INTAKE-FORCE] "toch toevoegen" — override a false-positive SEMANTIC duplicate.
      if (force) fd.append('force', 'true')
      const res = await fetch('/api/intake', { method: 'POST', body: fd })
      const data: IntakeResult = await res.json()

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
          setDupModal({ message: data.error || 'Deze factuur bestaat al', originalId: data.original_id, canForce: !!data.canForce, archived: data.archived, file })
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
          setDupModal({ message: data.error || 'Deze factuur bestaat al', originalId: data.original_id, canForce: !!data.canForce, archived: data.archived, file })
          outcome = 'duplicate'
        } else {
          showToast(data.error || 'Toevoegen mislukt')
          outcome = 'error'
        }
        return outcome
      }

      // Destination-aware feedback + navigation.
      onDone?.(data)

      // Route the owner to where the item landed, so they can confirm/see it.
      if (data.destination === 'invoice' || data.destination === 'receipt') {
        showToast(data.message || 'Toegevoegd ✓')
        setTimeout(() => router.push('/dashboard/incoming'), 600)
      } else if (data.destination === 'bank') {
        showToast(data.message || 'Toegevoegd ✓')
        setTimeout(() => router.push('/dashboard/bank'), 600)
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
        })
      } else {
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
          bottom: 'calc(88px + env(safe-area-inset-bottom))',
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
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.currentTarget.value = '' }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,.pdf,.xml,.mt940,.sta,.camt,.053,.txt"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.currentTarget.value = '' }}
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
          onClick={() => { if (!combining) { setOpen(false); closeMultiPage() } }}
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
                          style={{ border: 'none', background: 'transparent', color: '#9aa0a6', fontSize: 18, cursor: combining ? 'default' : 'pointer', lineHeight: 1 }}>×</button>
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
                onClick={() => { const f = dupModal.file!; setDupModal(null); handleFile(f, true) }}
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
              paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
              width: '100%', maxWidth: 430,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 19, color: '#202124', marginBottom: 4 }}>
              {destModal.isDuplicate ? 'Dit bestand bestaat al' : 'Bestand toegevoegd'}
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>
              {destModal.isDuplicate ? 'Je hebt dit bestand al eerder toegevoegd:' : 'Dit is er met je bestand gebeurd:'}
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 12, background: '#f8f9fa', marginBottom: 20 }}>
              <span style={{ fontSize: 16, lineHeight: '20px' }}>{destModal.isDuplicate ? 'ℹ️' : '📁'}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {destModal.fileName}
                </p>
                <p style={{ fontSize: 12, color: '#1a73e8', margin: 0 }}>
                  {destModal.folderName ? `Dit bestand staat in: ${destModal.folderName}` : destModal.message}
                </p>
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
  destination?: 'invoice' | 'receipt' | 'bank' | 'document'
  message?: string
  error?: string
  duplicate?: boolean
  invoice_id?: string
  original_id?: string  // [DUP-MODAL] the existing invoice this duplicates → deep-link
  canForce?: boolean    // [INTAKE-FORCE] a semantic dup that may be overridden ("toch toevoegen")
  // [DUP-ARCHIVED] present ⇒ the invoice this upload collides with sits in Genegeerd. The block
  // itself is unchanged; this only lets the client name the situation and offer "Terugzetten".
  archived?: { invoice_id: string; invoice_number: string | null; client_name: string | null }
  suggest_paid?: boolean
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