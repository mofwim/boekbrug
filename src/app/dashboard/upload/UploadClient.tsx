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

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { BackLink } from '@/components/ui/BackLink'

const M3 = {
  primary: '#1A73E8', onPrimary: '#fff', onSurface: '#202124', neutral: '#5F6368',
  surface: '#FFFFFF', outlineVariant: '#E0E0E0', success: '#137333', error: '#B3261E',
  warn: '#B26A00', primaryContainer: '#D3E3FD', bg: '#F8F9FA',
}
const FONT = "'Roboto', -apple-system, sans-serif"
// Same accept set as the app's intake button: images + PDF + the bank-statement formats.
const ACCEPT = 'image/*,application/pdf,.pdf,.xml,.mt940,.sta,.camt,.053,.txt'

type Status = 'queued' | 'busy' | 'done' | 'duplicate' | 'error'
interface Item {
  id: string
  file: File
  status: Status
  destination?: 'invoice' | 'receipt' | 'bank' | 'document'
  message?: string
  canForce?: boolean
  force?: boolean   // set on a "toch toevoegen" retry → sends force=true to override a semantic dup
}

// Destination → how the owner reads it (label + emoji + colour).
const DEST: Record<string, { label: string; icon: string; color: string }> = {
  invoice:  { label: 'Factuur',       icon: '🧾', color: M3.primary },
  receipt:  { label: 'Bon',           icon: '🧾', color: M3.primary },
  bank:     { label: 'Bankafschrift', icon: '🏦', color: '#0B8043' },
  document: { label: 'Bestand',       icon: '📁', color: M3.neutral },
}

let idc = 0
const nextId = () => `f${++idc}-${Date.now()}`

export default function UploadClient() {
  const [items, setItems] = useState<Item[]>([])
  const [dragActive, setDragActive] = useState(false)
  const pending = useRef<Item[]>([])   // FIFO queue (source of truth for the runner)
  const running = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

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
          const fd = new FormData()
          fd.append('file', item.file)
          if (item.force) fd.append('force', 'true') // "toch toevoegen" override for a semantic dup
          const res = await fetch('/api/intake', { method: 'POST', body: fd })
          const data = await res.json().catch(() => ({}))
          if (res.ok) {
            patch(item.id, { status: 'done', destination: data.destination, message: data.message })
          } else if (res.status === 409 && data.duplicate) {
            patch(item.id, { status: 'duplicate', message: data.error || 'Al toegevoegd', canForce: !!data.canForce })
          } else {
            patch(item.id, { status: 'error', message: data.error || 'Uploaden mislukt' })
          }
        } catch {
          patch(item.id, { status: 'error', message: 'Uploaden mislukt — probeer opnieuw' })
        }
      }
    } finally {
      running.current = false
    }
  }, [patch])

  const addFiles = useCallback((files: FileList | File[] | null) => {
    const arr = files ? Array.from(files) : []
    if (arr.length === 0) return
    const newItems: Item[] = arr.map((file) => ({ id: nextId(), file, status: 'queued' as Status }))
    setItems((prev) => [...prev, ...newItems])
    pending.current.push(...newItems)
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

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false)
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
  }, [addFiles])

  const busyCount = items.filter((i) => i.status === 'queued' || i.status === 'busy').length
  const done = items.filter((i) => i.status === 'done')
  const dups = items.filter((i) => i.status === 'duplicate')
  const errs = items.filter((i) => i.status === 'error')
  const countBy = (d: string) => done.filter((i) => i.destination === d).length
  const anyResult = done.length + dups.length + errs.length > 0

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 80px' }}>
        <BackLink style={{ color: M3.primary }} />

        <div style={{ margin: '16px 0 8px' }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: M3.onSurface, margin: 0 }}>Uploaden</h1>
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
            of kies ze hieronder — PDF, foto’s en bankafschriften (MT940/CAMT)
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
              return (
                <div key={it.id} style={{ background: M3.surface, border: `1px solid ${M3.outlineVariant}`, borderLeft: `4px solid ${border}`, borderRadius: 12, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>
                      {it.status === 'queued' ? '⏳' : it.status === 'busy' ? '🔄' : it.status === 'done' ? (d?.icon ?? '✅') : it.status === 'duplicate' ? '⚠️' : '❌'}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 600, color: M3.onSurface, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {it.file.name}
                      </p>
                      <p style={{ fontSize: 12, color: it.status === 'error' ? M3.error : it.status === 'duplicate' ? M3.warn : M3.neutral, margin: '2px 0 0', lineHeight: 1.4 }}>
                        {it.status === 'queued' ? 'In wachtrij…'
                          : it.status === 'busy' ? 'Bezig met lezen…'
                          : it.message || (d ? d.label : 'Klaar')}
                      </p>
                    </div>
                    {it.status === 'done' && d && (
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: d.color, background: '#F1F3F4', borderRadius: 999, padding: '3px 10px' }}>
                        {d.label}
                      </span>
                    )}
                  </div>
                  {it.status === 'duplicate' && it.canForce && (
                    <button onClick={() => forceAdd(it)}
                      style={{ marginTop: 8, background: 'transparent', color: M3.warn, border: `1px solid #E0C48A`, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                      Toch toevoegen — dit is een ander bestand
                    </button>
                  )}
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
              {countBy('invoice') + countBy('receipt') > 0 && <>{countBy('invoice') + countBy('receipt')} factuur/bon · </>}
              {countBy('bank') > 0 && <>{countBy('bank')} bankafschrift · </>}
              {countBy('document') > 0 && <>{countBy('document')} bestand · </>}
              {dups.length > 0 && <>{dups.length} dubbel · </>}
              {errs.length > 0 && <span style={{ color: M3.error }}>{errs.length} mislukt</span>}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {countBy('invoice') + countBy('receipt') > 0 && (
                <Link href="/dashboard/incoming" style={{ fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', background: M3.primaryContainer, borderRadius: 999, padding: '8px 14px' }}>
                  Naar Te verifiëren →
                </Link>
              )}
              {countBy('bank') > 0 && (
                <Link href="/dashboard/bank" style={{ fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none', background: M3.primaryContainer, borderRadius: 999, padding: '8px 14px' }}>
                  Naar Bank →
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
