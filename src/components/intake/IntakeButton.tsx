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

const M3 = {
  primary: '#1A73E8', onPrimary: '#FFFFFF',
  primaryContainer: '#D3E3FD', onPrimaryContainer: '#041E49',
  surface: '#ffffff', onSurface: '#202124',
  surfaceVariant: '#f1f3f4',
  success: '#34A853', error: '#B3261E',
}
const FONT = "'Google Sans', 'Roboto', -apple-system, sans-serif"
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
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // [DUP-MODAL] a duplicate is a decision, not a passing notice — show a modal
  // (stays until dismissed) with a link to the existing invoice, not a toast.
  const [dupModal, setDupModal] = useState<{ message: string; originalId?: string; canForce?: boolean; file?: File } | null>(null)
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

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  async function handleFile(file: File, force = false) {
    if (busy) return
    setBusy(true)
    setOpen(false)
    try {
      const fd = new FormData()
      fd.append('file', file)
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
        if (res.status === 409 && data.duplicate && (data.original_id || data.canForce)) {
          // SEMANTIC invoice duplicate (same invoice, DIFFERENT file — possibly a false
          // positive). Must be checked BEFORE data.existing: the semantic 409 usually ALSO
          // carries `existing` (the original's document), and routing on that first sent it
          // to the file-location modal — hiding the "Toch toevoegen" override and
          // mislabelling a genuinely different file as "al toegevoegd".
          setDupModal({ message: data.error || 'Deze factuur bestaat al', originalId: data.original_id, canForce: !!data.canForce, file })
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
        } else if (res.status === 409 && data.duplicate) {
          setDupModal({ message: data.error || 'Deze factuur bestaat al', originalId: data.original_id, canForce: !!data.canForce, file })
        } else {
          showToast(data.error || 'Toevoegen mislukt')
        }
        setBusy(false)
        return
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
    } catch {
      showToast('Toevoegen mislukt — probeer opnieuw')
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

      {/* Choice sheet */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: M3.surface, borderRadius: '28px 28px 0 0', padding: '24px 20px 32px', width: '100%', maxWidth: 480, boxShadow: '0 -8px 32px rgba(0,0,0,0.18)', fontFamily: FONT }}>
            <div style={{ width: 32, height: 4, background: '#DADCE0', borderRadius: 2, margin: '0 auto 20px' }} />
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
              style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', background: M3.primaryContainer, color: M3.onPrimaryContainer, borderRadius: R.lg, padding: '18px 16px', border: 'none', cursor: 'pointer', fontFamily: FONT, marginBottom: 8 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 28 }}>upload_file</span>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>Bestand uploaden</p>
                <p style={{ fontSize: 13, opacity: 0.85 }}>PDF, afbeelding of bankafschrift</p>
              </div>
            </button>

            <button onClick={() => setOpen(false)} style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: M3.primary, fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT, marginTop: 8 }}>
              Annuleren
            </button>
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
            <p style={{ fontSize: 18, fontWeight: 700, color: M3.onSurface, marginBottom: 8 }}>Deze factuur bestaat al</p>
            <p style={{ fontSize: 14, color: '#5F6368', marginBottom: 24, lineHeight: 1.5 }}>{dupModal.message}</p>

            {dupModal.originalId && (
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

            <div style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 12, background: '#f7f7f9', marginBottom: 20 }}>
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

      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: '#202124', color: '#fff', fontSize: 13, fontWeight: 500, padding: '12px 20px', borderRadius: R.md, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', maxWidth: '90%', textAlign: 'center', fontFamily: FONT }}>
          {toast}
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