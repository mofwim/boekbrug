'use client'

// src/app/dashboard/upload/UploadClient.tsx
// [UPLOAD-HUB] The single upload surface. Pick or drop MANY files at once (photos, PDFs, bank
// statements); each is POSTed to /api/intake — the same router the whole app uses — which decides
// the destination (factuur / bon / bankafschrift / bestand). We show a live result PER file, so the
// owner sees exactly what happened to each, and never has to hunt across screens to upload.
//
// Money-truth is unchanged: nothing is auto-paid here. An invoice/receipt lands in the verify queue
// (a suggestion the human confirms); a bank statement is imported + auto-matches the near-certain
// payments (reversible); everything else is filed in bestanden. Duplicates are blocked (with a
// "toch toevoegen" escape only for an uncertain semantic match).

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
// [INTAKE-IMG-NORMALIZE] Convert a picked HEIC/HEIF/WebP/BMP/TIFF (or an oversized JPG/PNG)
// to a bounded JPEG in the browser BEFORE upload — otherwise an iPhone invoice reaches the
// reader as an "unsupported type" and is silently filed away as unreadable. Same shared
// converter the multi-page combine uses, so both paths agree on the bytes that reach the reader.
import { normalizeImageForUpload, MAX_INTAKE_UPLOAD_BYTES } from '@/lib/image-normalize-client'
// [MULTI-PAGE] "Eén factuur, meerdere pagina's" — combine the photos of ONE paper invoice into a
// single PDF in the browser, then send it as ONE file (same /api/intake → one invoice), instead of
// N separate invoices. Same combiner the ZZP intake button uses.
import { combineImagesToPdf } from '@/lib/combine-images-pdf'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3 } from '@/lib/design/tokens'

const FONT = "'Roboto', -apple-system, sans-serif"
// Same accept set as the app's intake button: images + PDF + bank-statement formats + the
// spreadsheet exports a shop uploads monthly (kassa Z-report, PIN/kas grootboek).
const ACCEPT = 'image/*,application/pdf,.pdf,.xml,.mt940,.sta,.camt,.053,.txt,.940,.xls,.xlsx,.csv'
// [SIZE-GUARD] The server rejects anything over 10 MB (/api/intake MAX_BYTES). We enforce the SAME
// shared cap (MAX_INTAKE_UPLOAD_BYTES) in the browser so a too-big file fails instantly with a clear
// reason — instead of the owner waiting through a full upload over a slow mobile link only to be
// refused. Images are shrunk under this cap by normalizeImageForUpload; a too-big PDF is the one
// case we simply can't send.
// [MULTI-PAGE] Cap the pages of one paper invoice, mirroring the intake button.
const MAX_PAGES = 20

type Status = 'queued' | 'busy' | 'done' | 'duplicate' | 'error'
interface Item {
  id: string
  file: File
  status: Status
  destination?: 'invoice' | 'receipt' | 'bank' | 'document' | 'turnover' | 'ledger' | 'statement'
  // [AUTO-ADVANCE-HONESTY] The app verified AND booked this invoice itself
  // ([AUTO-ADVANCE] in /api/intake) — status 'received'. It is therefore NOT in the
  // verify queue this page links to, but on Inkoopfacturen. Kept separate from
  // `destination` because the destination IS still an invoice; only the place it
  // waits differs — and that is exactly what the owner needs to be told.
  autoVerified?: boolean
  message?: string
  canForce?: boolean
  force?: boolean   // set on a "toch toevoegen" retry → sends force=true to override a semantic dup
  // [DUP-ARCHIVED] De upload botste op een factuur die de eigenaar zelf genegeerd heeft. Die staat
  // in Genegeerd en is dus in geen enkele gewone lijst te vinden — bied terugzetten aan, want bij
  // een byte-hash-duplicaat (identiek bestand) is dat de ENIGE weg vooruit: die poort is met opzet
  // niet te forceren, dus zonder deze knop zit de eigenaar klem.
  archived?: { invoice_id: string; invoice_number: string | null; client_name: string | null }
  restoring?: boolean
  preview?: string  // objectURL for an image → inline thumbnail so the owner verifies without opening
  vendor?: string | null      // extracted — shown inline so you see WHAT the file is at a glance
  total?: number | null
  number?: string | null
  rateLimited?: boolean       // a 429 (too many at once) → retry after a short wait, not a real error
}

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

// Destination → how the owner reads it (label + emoji + colour).
const DEST: Record<string, { label: string; icon: string; color: string }> = {
  invoice:  { label: 'Factuur',       icon: '🧾', color: M3.primary },
  receipt:  { label: 'Bon',           icon: '🧾', color: M3.primary },
  bank:     { label: 'Bankafschrift', icon: '🏦', color: '#0B8043' },
  turnover: { label: 'Kassa-omzet',   icon: '🛒', color: '#0B8043' },
  ledger:   { label: 'Controle-check', icon: '🔗', color: '#7B1FA2' },
  document: { label: 'Bestand',       icon: '📁', color: M3.neutral },
  // [STATEMENT-RECONCILE] Een leveranciersoverzicht wordt niet geboekt (dat zou de losse
  // facturen dubbel tellen) maar gebruikt als volledigheidscontrole: welke factuur mis ik?
  statement: { label: 'Overzicht gecontroleerd', icon: '🔎', color: M3.warn },
}

let idc = 0
const nextId = () => `f${++idc}-${Date.now()}`

interface ReprocSummary { scanned: number; considered: number; booked: number; turnoverDays: number; ledgerDays: number; review: number; skipped: number; failed: number; capped: boolean }
interface ReprocResult { file: string; status: 'booked' | 'review' | 'skip' | 'error'; type?: string; message: string }

export default function UploadClient() {
  const [items, setItems] = useState<Item[]>([])
  const [dragActive, setDragActive] = useState(false)
  const pending = useRef<Item[]>([])   // FIFO queue (source of truth for the runner)
  const running = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  // [BLOB-CLEANUP] Every preview is an objectURL; without revoking them a big batch leaks blobs in
  // memory until the tab closes (heavy on a phone). We keep the URLs alive while their result row is
  // on screen (the thumbnail + "Bekijk bestand" link use them) and revoke ALL of them on unmount.
  const objectUrls = useRef<string[]>([])
  useEffect(() => () => { for (const u of objectUrls.current) URL.revokeObjectURL(u) }, [])

  // [MULTI-PAGE] Collect the photos of ONE paper invoice, combine → one PDF → one invoice.
  const [mpMode, setMpMode] = useState(false)
  const [mpPages, setMpPages] = useState<File[]>([])
  const [combining, setCombining] = useState(false)
  const [mpError, setMpError] = useState<string | null>(null)
  const mpFileRef = useRef<HTMLInputElement>(null)
  const mpCameraRef = useRef<HTMLInputElement>(null)
  // [REPROCESS] Book the kassa/grootboek/dagomzet files already sitting in bestanden — no re-upload.
  const [reproc, setReproc] = useState<{ busy: boolean; done: boolean; summary?: ReprocSummary; results?: ReprocResult[]; error?: string }>({ busy: false, done: false })
  const runReprocess = useCallback(async () => {
    setReproc({ busy: true, done: false })
    try {
      const res = await fetch('/api/documents/reprocess', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      // [UI-HONESTY] A rejected run (401/429/500) returns no summary, and the result
      // block only renders WITH a summary — so the button used to go quiet and the
      // owner was left believing nothing needed booking. Say what happened instead.
      if (!res.ok || !data?.summary) {
        setReproc({ busy: false, done: true, error: data?.error || 'Boeken is niet gelukt — probeer het zo opnieuw.' })
        return
      }
      setReproc({ busy: false, done: true, summary: data.summary, results: data.results })
    } catch {
      setReproc({ busy: false, done: true, error: 'Boeken is niet gelukt — controleer je verbinding en probeer het opnieuw.' })
    }
  }, [])

  const patch = useCallback((id: string, changes: Partial<Item>) => {
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, ...changes } : f)))
  }, [])

  // Process the FIFO queue ONE file at a time — each intake does an AI read, so sequential keeps us
  // within the rate limit and gives an honest, ordered progress. New drops append and are picked up
  // by the already-running loop (guarded so only one loop ever runs).
  const kick = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      while (pending.current.length > 0) {
        const item = pending.current.shift()!
        patch(item.id, { status: 'busy' })
        try {
          // [INTAKE-IMG-NORMALIZE] Make an unreadable/oversized photo readable BEFORE upload. A
          // HEIC/HEIF/WebP/BMP/TIFF (or a huge JPG/PNG) becomes a bounded JPEG the reader accepts;
          // a normal JPG/PNG/PDF is returned untouched. Never throws — worst case the original goes.
          const uploadFile = await normalizeImageForUpload(item.file, MAX_INTAKE_UPLOAD_BYTES)
          // [SIZE-GUARD] After shrinking images, anything still over the server cap can't be sent.
          // In practice this is only a very large PDF (we can't safely shrink a PDF here). Fail with
          // an honest reason instead of a wasted full upload that the server would refuse anyway.
          if (uploadFile.size > MAX_INTAKE_UPLOAD_BYTES) {
            patch(item.id, {
              status: 'error',
              message: `Bestand te groot (${(uploadFile.size / 1024 / 1024).toFixed(1)} MB) — max 10 MB. Splits een grote PDF of maak een foto.`,
            })
            continue
          }
          const fd = new FormData()
          fd.append('file', uploadFile)
          if (item.force) fd.append('force', 'true') // "toch toevoegen" override for a semantic dup
          const res = await fetch('/api/intake', { method: 'POST', body: fd })
          const data = await res.json().catch(() => ({}))
          if (res.ok) {
            patch(item.id, {
              status: 'done', destination: data.destination, message: data.message,
              autoVerified: data.auto_verified === true,
              vendor: data.vendor ?? null, total: data.total_inc_btw ?? null, number: data.invoice_number ?? null,
            })
          } else if (res.status === 409 && data.duplicate) {
            patch(item.id, {
              status: 'duplicate', message: data.error || 'Al toegevoegd', canForce: !!data.canForce,
              // [DUP-ARCHIVED] alleen gezet als de bestaande factuur écht in Genegeerd staat
              archived: data.archived ?? undefined,
            })
          } else if (res.status === 429) {
            // Rate limit (240 documenten/uur, RATE_LIMITS.AI_OCR) — NOT a broken file. Say so honestly + offer a retry.
            patch(item.id, { status: 'error', rateLimited: true, message: data.error || 'Te veel tegelijk — probeer dit bestand zo opnieuw.' })
          } else {
            patch(item.id, { status: 'error', message: data.error || 'Lezen mislukt — probeer dit bestand opnieuw.' })
          }
        } catch {
          patch(item.id, { status: 'error', message: 'Lezen mislukt — probeer dit bestand opnieuw.' })
        }
        // Gentle spacing between AI reads — smooths bursts so fewer files trip an error.
        await new Promise((r) => setTimeout(r, 250))
      }
    } finally {
      running.current = false
    }
  }, [patch])

  const addFiles = useCallback((files: FileList | File[] | null) => {
    const arr = files ? Array.from(files) : []
    if (arr.length === 0) return
    const newItems: Item[] = arr.map((file) => {
      // An objectURL for every file: shown as an inline thumbnail for images, and opened by the
      // "bekijk" link for any file — so the owner recognises/checks each one without leaving the page.
      const preview = URL.createObjectURL(file)
      objectUrls.current.push(preview) // [BLOB-CLEANUP] revoked on unmount
      return { id: nextId(), file, status: 'queued' as Status, preview }
    })
    setItems((prev) => [...prev, ...newItems])
    pending.current.push(...newItems)
    void kick()
  }, [kick])

  // [MULTI-PAGE] Add photos to the "one invoice, many pages" tray. Only images belong here
  // (a paper invoice is photographed); a picked non-image is ignored so the tray stays clean.
  const addMpPages = useCallback((fl: FileList | null) => {
    if (!fl || fl.length === 0) return
    const imgs = Array.from(fl).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(f.name))
    if (imgs.length === 0) { setMpError('Kies foto’s van de pagina’s.'); return }
    setMpError(null)
    setMpPages((prev) => {
      const merged = [...prev, ...imgs]
      if (merged.length > MAX_PAGES) { setMpError(`Maximaal ${MAX_PAGES} pagina’s per factuur.`); return merged.slice(0, MAX_PAGES) }
      return merged
    })
  }, [])

  const removeMpPage = useCallback((idx: number) => {
    setMpPages((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  // Combine the collected pages into ONE PDF in the browser, then hand that single PDF to the
  // normal upload queue → /api/intake extracts ONE invoice from all pages (the multi-page path).
  const combineAndUpload = useCallback(async () => {
    if (mpPages.length === 0 || combining) return
    setCombining(true); setMpError(null)
    try {
      const pdf = await combineImagesToPdf(mpPages)
      addFiles([pdf])
      setMpMode(false); setMpPages([])
    } catch (e) {
      // combineImagesToPdf names the failing page ("Pagina 2 kon niet…") — surface it as-is so the
      // owner knows which photo to redo; keep the other pages in the tray for a quick retry.
      setMpError(e instanceof Error && /Pagina/.test(e.message) ? e.message : 'Combineren mislukt — voeg de pagina’s los toe.')
    } finally {
      setCombining(false)
    }
  }, [mpPages, combining, addFiles])

  // Re-try a file that failed (a transient AI error or a rate-limit that has since cleared).
  const retry = useCallback((item: Item) => {
    const again: Item = { ...item, status: 'queued', message: undefined, rateLimited: false }
    patch(item.id, { status: 'queued', message: 'Opnieuw in wachtrij…', rateLimited: false })
    pending.current.push(again)
    void kick()
  }, [kick, patch])

  const retryAllFailed = useCallback(() => {
    setItems((prev) => {
      const failed = prev.filter((i) => i.status === 'error')
      for (const f of failed) pending.current.push({ ...f, status: 'queued', message: undefined, rateLimited: false })
      return prev.map((i) => (i.status === 'error' ? { ...i, status: 'queued' as Status, message: 'Opnieuw in wachtrij…', rateLimited: false } : i))
    })
    void kick()
  }, [kick])

  // "Toch toevoegen" — re-submit an uncertain semantic duplicate with force=true as a NEW attempt.
  const forceAdd = useCallback((item: Item) => {
    const retry: Item & { force?: boolean } = { id: nextId(), file: item.file, status: 'queued', force: true }
    setItems((prev) => [...prev, retry])
    pending.current.push(retry)
    // Mark the original as resolved so it doesn't keep offering the button.
    patch(item.id, { status: 'done', message: 'Toch toegevoegd — zie de nieuwe regel hieronder.', destination: item.destination })
    void kick()
  }, [kick, patch])

  // [DUP-ARCHIVED] "Terugzetten" — de upload werd geweigerd omdat deze factuur al bestaat, maar
  // in Genegeerd. Opnieuw uploaden lost dat niet op (en kan bij identieke bytes ook niet); de
  // bestaande factuur terugzetten wél. Zet hem terug in de controlewachtrij, waar hij hoort.
  const restoreIgnored = useCallback(async (item: Item) => {
    const target = item.archived
    if (!target || item.restoring) return
    patch(item.id, { restoring: true })
    try {
      const res = await fetch(`/api/email/confirm/${target.invoice_id}`, { method: 'PATCH' })
      if (res.ok) {
        // Klaar: de knop verdwijnt (archived weg) en de regel vertelt wat er nu geldt.
        patch(item.id, {
          status: 'done', destination: 'invoice', restoring: false, archived: undefined, canForce: false,
          message: 'Teruggezet — de factuur staat weer in je controlewachtrij op Inkomend.',
        })
      } else {
        // [UI-HONESTY] Een 409 betekent dat hij niet (meer) in Genegeerd staat. Nooit "gelukt" zeggen.
        const data = await res.json().catch(() => ({}))
        patch(item.id, { restoring: false, message: data.error || 'Terugzetten mislukt — ververs de pagina en probeer het opnieuw.' })
      }
    } catch {
      patch(item.id, { restoring: false, message: 'Terugzetten mislukt — controleer je verbinding en probeer het opnieuw.' })
    }
  }, [patch])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false)
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
  }, [addFiles])

  const busyCount = items.filter((i) => i.status === 'queued' || i.status === 'busy').length
  const done = items.filter((i) => i.status === 'done')
  const dups = items.filter((i) => i.status === 'duplicate')
  const errs = items.filter((i) => i.status === 'error')
  const countBy = (d: string) => done.filter((i) => i.destination === d).length
  // [AUTO-ADVANCE-HONESTY] Invoices split by WHERE they now wait: auto-booked ones sit
  // on Inkoopfacturen, the rest in the verify queue. The summary used to lump both into
  // "X factuur/bon" with a single "Naar Te verifiëren →", so a batch the app fully
  // handled itself pointed at an empty queue.
  const autoBooked = done.filter((i) => i.autoVerified).length
  const toVerify = done.filter(
    (i) => (i.destination === 'invoice' || i.destination === 'receipt') && !i.autoVerified,
  ).length
  const anyResult = done.length + dups.length + errs.length > 0

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 80px' }}>
        {/* [HEADER-SYSTEM] Title "Uploaden" + back live in the shared sub-page bar;
            the in-body h1 was removed. The descriptive subtitle stays. */}
        <div style={{ margin: '16px 0 8px' }}>
          <p style={{ fontSize: 13.5, color: M3.neutral, marginTop: 4, lineHeight: 1.5 }}>
            Facturen, bonnen én bankafschriften — alles op één plek. Kies of sleep <strong>meerdere bestanden tegelijk</strong>;
            de app leest en sorteert elk bestand automatisch naar de juiste plek.
          </p>
        </div>

        {/* Drop zone + pickers */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          style={{
            border: `2px dashed ${dragActive ? M3.primary : M3.outlineVariant}`,
            background: dragActive ? '#EAF2FE' : M3.surface,
            borderRadius: 18, padding: '28px 18px', textAlign: 'center', transition: 'all .12s ease', marginTop: 8,
          }}
        >
          <div style={{ fontSize: 34 }}>📤</div>
          <p style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, margin: '8px 0 2px' }}>
            Sleep bestanden hierheen
          </p>
          <p style={{ fontSize: 12.5, color: M3.neutral, marginBottom: 16 }}>
            of kies ze hieronder — PDF, foto’s, bankafschriften (MT940/CAMT) én kassa-/grootboek-bestanden (Excel)
          </p>

          <input ref={fileRef} type="file" accept={ACCEPT} multiple style={{ display: 'none' }}
            onChange={(e) => { addFiles(e.target.files); if (fileRef.current) fileRef.current.value = '' }} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }}
            onChange={(e) => { addFiles(e.target.files); if (cameraRef.current) cameraRef.current.value = '' }} />

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => fileRef.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer', background: M3.primary, color: M3.onPrimary, fontFamily: FONT, fontSize: 14.5, fontWeight: 600 }}>
              📎 Bestanden kiezen
            </button>
            <button onClick={() => cameraRef.current?.click()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer', background: M3.primaryContainer, color: '#041E49', fontFamily: FONT, fontSize: 14.5, fontWeight: 600 }}>
              📷 Foto’s maken
            </button>
          </div>
          <p style={{ fontSize: 11.5, color: '#8e8e93', margin: '14px 4px 0', lineHeight: 1.45 }}>
            Je kunt meerdere foto’s of bestanden in één keer selecteren. Eén PDF = één factuur.
          </p>
        </div>

        {/* [MULTI-PAGE] "Eén factuur, meerdere pagina's" — combine the photos of ONE paper invoice
            into a single PDF so it lands as ONE invoice, not one per page. */}
        <div style={{ marginTop: 14, background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 14, padding: 14 }}>
          {!mpMode ? (
            <>
              <p style={{ fontSize: 13.5, fontWeight: 700, color: M3.onSurface, margin: 0 }}>Factuur met meerdere pagina’s?</p>
              <p style={{ fontSize: 12.5, color: M3.neutral, margin: '4px 0 10px', lineHeight: 1.5 }}>
                Hoort een papieren factuur bij elkaar? Voeg de pagina’s hier samen tot <strong>één factuur</strong> —
                anders wordt elke foto een aparte factuur.
              </p>
              <button onClick={() => { setMpMode(true); setMpError(null) }}
                style={{ background: M3.primaryContainer, color: '#041E49', border: 'none', borderRadius: 999, padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                📄 Pagina’s samenvoegen
              </button>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: 13.5, fontWeight: 700, color: M3.onSurface, margin: 0 }}>Eén factuur, meerdere pagina’s</p>
                <button onClick={() => { setMpMode(false); setMpPages([]); setMpError(null) }}
                  style={{ background: 'transparent', border: 'none', color: M3.neutral, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                  Annuleren
                </button>
              </div>
              <p style={{ fontSize: 12.5, color: M3.neutral, margin: '4px 0 10px', lineHeight: 1.5 }}>
                Voeg de pagina’s in volgorde toe. We maken er één PDF van en lezen die als <strong>één factuur</strong>.
              </p>

              <input ref={mpFileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={(e) => { addMpPages(e.target.files); if (mpFileRef.current) mpFileRef.current.value = '' }} />
              <input ref={mpCameraRef} type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }}
                onChange={(e) => { addMpPages(e.target.files); if (mpCameraRef.current) mpCameraRef.current.value = '' }} />

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={() => mpFileRef.current?.click()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: `1px solid ${M3.outlineVariant}`, cursor: 'pointer', background: M3.surface, color: M3.onSurface, fontFamily: FONT, fontSize: 13.5, fontWeight: 600 }}>
                  📎 Foto’s kiezen
                </button>
                <button onClick={() => mpCameraRef.current?.click()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: `1px solid ${M3.outlineVariant}`, cursor: 'pointer', background: M3.surface, color: M3.onSurface, fontFamily: FONT, fontSize: 13.5, fontWeight: 600 }}>
                  📷 Pagina fotograferen
                </button>
              </div>

              {mpPages.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {mpPages.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: M3.onSurface }}>
                      <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, background: M3.primaryContainer, color: '#041E49', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                      <button onClick={() => removeMpPage(i)} aria-label={`Pagina ${i + 1} verwijderen`}
                        style={{ flexShrink: 0, background: 'transparent', border: 'none', color: M3.error, fontSize: 16, lineHeight: 1, cursor: 'pointer', fontFamily: FONT }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              {mpError && <p style={{ fontSize: 12, color: M3.error, margin: '8px 0 0', lineHeight: 1.4 }}>{mpError}</p>}

              <button onClick={combineAndUpload} disabled={combining || mpPages.length === 0}
                style={{ marginTop: 12, width: '100%', background: combining || mpPages.length === 0 ? '#C7C7CC' : M3.primary, color: '#fff', border: 'none', borderRadius: 12, padding: '12px 18px', fontSize: 14, fontWeight: 700, cursor: combining || mpPages.length === 0 ? 'default' : 'pointer', fontFamily: FONT }}>
                {combining ? 'Bezig met samenvoegen…' : mpPages.length > 0 ? `Combineer ${mpPages.length} pagina${mpPages.length === 1 ? '' : '’s'} → één factuur` : 'Voeg eerst pagina’s toe'}
              </button>
            </>
          )}
        </div>

        {/* [REPROCESS] Book kassa/grootboek/dagomzet files you already uploaded earlier — no re-upload. */}
        <div style={{ marginTop: 14, background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 14, padding: 14 }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: M3.onSurface, margin: 0 }}>Al eerder geüpload?</p>
          <p style={{ fontSize: 12.5, color: M3.neutral, margin: '4px 0 10px', lineHeight: 1.5 }}>
            Kassa-, grootboek- en dagomzet-bestanden die al in je bestanden staan maar nog niet geboekt zijn,
            worden hiermee alsnog verwerkt — zonder opnieuw te uploaden. Veilig om te herhalen (corrigeert, telt nooit dubbel).
          </p>
          <button onClick={runReprocess} disabled={reproc.busy}
            style={{ background: reproc.busy ? '#9AA0A6' : '#0B8043', color: '#fff', border: 'none', borderRadius: 999, padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: reproc.busy ? 'default' : 'pointer', fontFamily: FONT }}>
            {reproc.busy ? '🔄 Bezig met boeken…' : '🔄 Boek mijn opgeslagen bestanden'}
          </button>

          {reproc.done && reproc.error && (
            <p style={{ fontSize: 13, color: M3.error, margin: '10px 0 0', lineHeight: 1.5 }}>{reproc.error}</p>
          )}

          {reproc.done && reproc.summary && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: M3.onSurface, margin: '0 0 6px' }}>
                {reproc.summary.booked > 0
                  ? `✓ ${reproc.summary.booked} bestand(en) geboekt — ${reproc.summary.turnoverDays} dag(en) kassa-omzet${reproc.summary.ledgerDays ? `, ${reproc.summary.ledgerDays} dag(en) controle-check` : ''}.`
                  : 'Geen nieuwe kassa-/grootboek-bestanden gevonden om te boeken.'}
                {reproc.summary.review > 0 && <span style={{ color: M3.warn }}> · {reproc.summary.review} nakijken in Dagomzet</span>}
                {reproc.summary.failed > 0 && <span style={{ color: M3.error }}> · {reproc.summary.failed} mislukt</span>}
              </p>
              {(reproc.results ?? []).filter((r) => r.status !== 'skip').slice(0, 40).map((r, i) => (
                <p key={i} style={{ fontSize: 12, margin: '2px 0', color: r.status === 'booked' ? M3.success : r.status === 'review' ? M3.warn : r.status === 'error' ? M3.error : M3.neutral, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.status === 'booked' ? '✓' : r.status === 'review' ? '⚠️' : '✗'} {r.file} — {r.message}
                </p>
              ))}
              {reproc.summary.booked > 0 && (
                <Link href="/dashboard/dagomzet" style={{ display: 'inline-block', marginTop: 8, fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', background: M3.primaryContainer, borderRadius: 999, padding: '7px 14px' }}>
                  Naar Dagomzet →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Progress banner */}
        {items.length > 0 && (
          <div style={{ marginTop: 16, fontSize: 13, color: M3.neutral }}>
            {busyCount > 0
              ? `Bezig met verwerken… ${items.length - busyCount}/${items.length} klaar`
              : `Klaar — ${items.length} bestand(en) verwerkt`}
          </div>
        )}

        {/* Per-file result list */}
        {items.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it) => {
              const d = it.destination ? DEST[it.destination] : null
              const border =
                it.status === 'error' ? M3.error
                : it.status === 'duplicate' ? M3.warn
                : it.status === 'done' ? M3.success
                : M3.outlineVariant
              const isImg = it.file.type.startsWith('image/')
              // The at-a-glance summary of WHAT the file is (so you don't open each one).
              const extracted = [it.vendor, it.total != null ? eur.format(it.total) : null, it.number ? `nr. ${it.number}` : null]
                .filter(Boolean).join('  ·  ')
              return (
                <div key={it.id} style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderLeft: `4px solid ${border}`, borderRadius: 12, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Thumbnail (image) or a status/type glyph — recognise the file instantly. */}
                    {isImg && it.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.preview} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 8, flexShrink: 0, background: '#F1F3F4' }} />
                    ) : (
                      <div style={{ width: 46, height: 46, borderRadius: 8, background: '#F1F3F4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                        {it.status === 'queued' ? '⏳' : it.status === 'busy' ? '🔄' : it.status === 'done' ? (d?.icon ?? '📄') : it.status === 'duplicate' ? '⚠️' : '📄'}
                      </div>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 600, color: M3.onSurface, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.file.name}
                      </p>
                      {/* Extracted identity for a recognised invoice: leverancier · bedrag · nummer. */}
                      {it.status === 'done' && extracted && (
                        <p style={{ fontSize: 12.5, fontWeight: 600, color: M3.onSurface, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{extracted}</p>
                      )}
                      <p style={{ fontSize: 12, color: it.status === 'error' ? (it.rateLimited ? M3.warn : M3.error) : it.status === 'duplicate' ? M3.warn : M3.neutral, margin: '2px 0 0', lineHeight: 1.4 }}>
                        {it.status === 'queued' ? (it.message || 'In wachtrij…')
                          : it.status === 'busy' ? 'Bezig met lezen…'
                          : it.message || (d ? d.label : 'Klaar')}
                      </p>
                      {/* [UPLOAD-VERIFY] Open the file itself to check it — without leaving the page. */}
                      {it.preview && (it.status === 'done' || it.status === 'error' || it.status === 'duplicate') && (
                        <a href={it.preview} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-block', marginTop: 4, fontSize: 12, fontWeight: 600, color: M3.primary, textDecoration: 'none' }}>
                          Bekijk bestand →
                        </a>
                      )}
                    </div>
                    {it.status === 'done' && d && (
                      // [AUTO-ADVANCE-HONESTY] The badge names the OUTCOME, not just the type:
                      // "Factuur" on a row the app already booked reads as "still to do".
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: it.autoVerified ? '#0B5A28' : d.color, background: it.autoVerified ? '#E6F4EA' : '#F1F3F4', borderRadius: 999, padding: '3px 10px' }}>
                        {it.autoVerified ? 'Automatisch geboekt' : d.label}
                      </span>
                    )}
                  </div>
                  {/* Actions row: retry a failure, or override an uncertain duplicate. */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {it.status === 'error' && (
                      <button onClick={() => retry(it)}
                        style={{ marginTop: 8, background: 'transparent', color: M3.primary, border: `1px solid ${M3.primaryContainer}`, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                        ↻ Opnieuw proberen
                      </button>
                    )}
                    {/* [DUP-ARCHIVED] De bestaande factuur staat in Genegeerd → terugzetten is de
                        handeling die hier werkt. Eerst, want bij een identiek bestand is het de enige. */}
                    {it.status === 'duplicate' && it.archived && (
                      <button onClick={() => restoreIgnored(it)} disabled={it.restoring}
                        style={{ marginTop: 8, background: M3.primary, color: '#fff', border: 'none', borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: it.restoring ? 'default' : 'pointer', fontFamily: FONT, opacity: it.restoring ? 0.6 : 1 }}>
                        {it.restoring ? 'Bezig…' : 'Terugzetten uit Genegeerd'}
                      </button>
                    )}
                    {it.status === 'duplicate' && it.canForce && (
                      <button onClick={() => forceAdd(it)}
                        style={{ marginTop: 8, background: 'transparent', color: M3.warn, border: `1px solid #E0C48A`, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                        Toch toevoegen — dit is een ander bestand
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Summary + where things landed */}
        {anyResult && busyCount === 0 && (
          <div style={{ marginTop: 18, background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderRadius: 14, padding: 16 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: M3.onSurface, margin: '0 0 8px' }}>Klaar ✓</p>
            <p style={{ fontSize: 13, color: M3.neutral, margin: '0 0 12px', lineHeight: 1.6 }}>
              {autoBooked > 0 && <><strong style={{ color: M3.success }}>{autoBooked} automatisch geboekt</strong> · </>}
              {toVerify > 0 && <>{toVerify} factuur/bon te controleren · </>}
              {countBy('bank') > 0 && <>{countBy('bank')} bankafschrift · </>}
              {countBy('turnover') > 0 && <>{countBy('turnover')} kassa-omzet · </>}
              {countBy('ledger') > 0 && <>{countBy('ledger')} controle-check · </>}
              {countBy('document') > 0 && <>{countBy('document')} bestand · </>}
              {countBy('statement') > 0 && <>{countBy('statement')} rekeningoverzicht · </>}
              {dups.length > 0 && <>{dups.length} dubbel · </>}
              {errs.length > 0 && <span style={{ color: M3.error }}>{errs.length} mislukt</span>}
            </p>
            {errs.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <button onClick={retryAllFailed}
                  style={{ background: M3.error, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                  ↻ Alle {errs.length} mislukte opnieuw proberen
                </button>
                <p style={{ fontSize: 11.5, color: M3.neutral, margin: '6px 2px 0', lineHeight: 1.45 }}>
                  Mislukt komt meestal door de limiet van 240 documenten per uur of een tijdelijke leesfout — opnieuw proberen lost het vaak op.
                </p>
              </div>
            )}
            {/* [AUTO-ADVANCE-HONESTY] What "automatisch geboekt" means, once — booked as
                a purchase invoice, nothing paid, and checkable on Inkoopfacturen. */}
            {autoBooked > 0 && (
              <p style={{ fontSize: 12.5, color: '#0B5A28', background: '#E6F4EA', border: '1px solid #B7E1C4', borderRadius: 10, padding: '10px 12px', margin: '0 0 12px', lineHeight: 1.5 }}>
                {autoBooked === 1 ? 'Eén factuur was' : `${autoBooked} facturen waren`} zeker genoeg om zelf te controleren
                en {autoBooked === 1 ? 'is' : 'zijn'} meteen geboekt als inkoopfactuur — klaar voor je boekhouder.
                Er is niets betaald; nakijken kan bij Inkoopfacturen onder “Automatisch verwerkt”.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {autoBooked > 0 && (
                <Link href="/dashboard/incoming/manage?filter=auto" style={{ fontSize: 13, fontWeight: 600, color: '#0B5A28', textDecoration: 'none', background: '#E6F4EA', borderRadius: 999, padding: '8px 14px' }}>
                  Naar Inkoopfacturen →
                </Link>
              )}
              {toVerify > 0 && (
                <Link href="/dashboard/incoming" style={{ fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', background: M3.primaryContainer, borderRadius: 999, padding: '8px 14px' }}>
                  Naar Te verifiëren →
                </Link>
              )}
              {countBy('bank') > 0 && (
                <Link href="/dashboard/bank" style={{ fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', background: M3.primaryContainer, borderRadius: 999, padding: '8px 14px' }}>
                  Naar Bank →
                </Link>
              )}
              {countBy('turnover') > 0 && (
                <Link href="/dashboard/dagomzet" style={{ fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', background: M3.primaryContainer, borderRadius: 999, padding: '8px 14px' }}>
                  Naar Dagomzet →
                </Link>
              )}
              {countBy('document') > 0 && (
                <Link href="/dashboard/bestanden" style={{ fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', background: M3.primaryContainer, borderRadius: 999, padding: '8px 14px' }}>
                  Naar Bestanden →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
