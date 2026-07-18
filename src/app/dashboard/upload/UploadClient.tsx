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
// Same accept set as the app's intake button: images + PDF + bank-statement formats + the
// spreadsheet exports a shop uploads monthly (kassa Z-report, PIN/kas grootboek).
const ACCEPT = 'image/*,application/pdf,.pdf,.xml,.mt940,.sta,.camt,.053,.txt,.940,.xls,.xlsx,.csv'

type Status = 'queued' | 'busy' | 'done' | 'duplicate' | 'error'
interface Item {
  id: string
  file: File
  status: Status
  destination?: 'invoice' | 'receipt' | 'bank' | 'document' | 'turnover' | 'ledger'
  message?: string
  canForce?: boolean
  force?: boolean   // set on a "toch toevoegen" retry → sends force=true to override a semantic dup
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
  // [REPROCESS] Book the kassa/grootboek/dagomzet files already sitting in bestanden — no re-upload.
  const [reproc, setReproc] = useState<{ busy: boolean; done: boolean; summary?: ReprocSummary; results?: ReprocResult[] }>({ busy: false, done: false })
  const runReprocess = useCallback(async () => {
    setReproc({ busy: true, done: false })
    try {
      const res = await fetch('/api/documents/reprocess', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      setReproc({ busy: false, done: true, summary: data.summary, results: data.results })
    } catch {
      setReproc({ busy: false, done: true })
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
          const fd = new FormData()
          fd.append('file', item.file)
          if (item.force) fd.append('force', 'true') // "toch toevoegen" override for a semantic dup
          const res = await fetch('/api/intake', { method: 'POST', body: fd })
          const data = await res.json().catch(() => ({}))
          if (res.ok) {
            patch(item.id, {
              status: 'done', destination: data.destination, message: data.message,
              vendor: data.vendor ?? null, total: data.total_inc_btw ?? null, number: data.invoice_number ?? null,
            })
          } else if (res.status === 409 && data.duplicate) {
            patch(item.id, { status: 'duplicate', message: data.error || 'Al toegevoegd', canForce: !!data.canForce })
          } else if (res.status === 429) {
            // Rate limit (60 documenten/uur) — NOT a broken file. Say so honestly + offer a retry.
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
    const newItems: Item[] = arr.map((file) => ({
      id: nextId(), file, status: 'queued' as Status,
      // An objectURL for every file: shown as an inline thumbnail for images, and opened by the
      // "bekijk" link for any file — so the owner recognises/checks each one without leaving the page.
      preview: URL.createObjectURL(file),
    }))
    setItems((prev) => [...prev, ...newItems])
    pending.current.push(...newItems)
    void kick()
  }, [kick])

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
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: d.color, background: '#F1F3F4', borderRadius: 999, padding: '3px 10px' }}>
                        {d.label}
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
              {countBy('invoice') + countBy('receipt') > 0 && <>{countBy('invoice') + countBy('receipt')} factuur/bon · </>}
              {countBy('bank') > 0 && <>{countBy('bank')} bankafschrift · </>}
              {countBy('turnover') > 0 && <>{countBy('turnover')} kassa-omzet · </>}
              {countBy('ledger') > 0 && <>{countBy('ledger')} controle-check · </>}
              {countBy('document') > 0 && <>{countBy('document')} bestand · </>}
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
                  Mislukt komt meestal door de limiet van 60 documenten per uur of een tijdelijke leesfout — opnieuw proberen lost het vaak op.
                </p>
              </div>
            )}
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
