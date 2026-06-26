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
  surface: '#FFFBFE', onSurface: '#1C1B1F',
  surfaceVariant: '#E7E0EC',
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
  const [dupModal, setDupModal] = useState<{ message: string; originalId?: string } | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  async function handleFile(file: File) {
    if (busy) return
    setBusy(true)
    setOpen(false)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/intake', { method: 'POST', body: fd })
      const data: IntakeResult = await res.json()

      if (!res.ok) {
        // [DUP-MODAL] A duplicate (409) is a decision point — show a persistent
        // modal with a link to the existing invoice, not a fleeting toast.
        // Other errors stay as a toast.
        if (res.status === 409 && data.duplicate) {
          setDupModal({ message: data.error || 'Deze factuur bestaat al', originalId: data.original_id })
        } else {
          showToast(data.error || 'Toevoegen mislukt')
        }
        setBusy(false)
        return
      }

      // Destination-aware feedback + navigation.
      showToast(data.message || 'Toegevoegd ✓')
      onDone?.(data)

      // Route the owner to where the item landed, so they can confirm/see it.
      if (data.destination === 'invoice' || data.destination === 'receipt') {
        setTimeout(() => router.push('/dashboard/incoming'), 600)
      } else if (data.destination === 'bank') {
        setTimeout(() => router.push('/dashboard/bank'), 600)
      } else if (data.destination === 'document') {
        setTimeout(() => router.push('/dashboard/bestanden'), 600)
      } else {
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
        <span className="material-symbols-outlined" style={{ color: '#79747E', fontSize: 20 }}>chevron_right</span>
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
            <button
              onClick={() => setDupModal(null)}
              style={{ width: '100%', background: 'transparent', color: M3.primary, borderRadius: R.full, padding: '12px', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 15, fontWeight: 600 }}
            >
              Begrepen
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: '#1C1B1F', color: '#fff', fontSize: 13, fontWeight: 500, padding: '12px 20px', borderRadius: R.md, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', maxWidth: '90%', textAlign: 'center', fontFamily: FONT }}>
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
  suggest_paid?: boolean
}