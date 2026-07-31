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
import { M3, COLUMN } from '@/lib/design/tokens'
// [UPLOAD-ERRORS] Eén vertaler van HTTP-status → wat de eigenaar leest én of er een knop verschijnt.
// Puur en getest, want een knop die niets kan opleveren is erger dan geen knop.
import { describeUploadFailure } from '@/lib/upload-failure'

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
  // [UNREAD-HONESTY] /api/intake antwoordt `ok: true, could_not_read: true` wanneer het bestand wél
  // veilig is opgeslagen maar NIET gelezen kon worden (onscherpe foto, mislukte AI-lezing). Dat is
  // geen fout — het bestand staat er — maar ook geen "klaar": dit is juist het bestand waar de
  // eigenaar iets mee moet. De pagina las dit veld niet, dus zo'n regel kreeg de groene rand van een
  // geslaagde upload en telde in het overzicht mee als "1 bestand". Kleur en telling zeiden geslaagd
  // terwijl de tekst ernaast zei dat we het niet konden lezen.
  couldNotRead?: boolean
  // [UPLOAD-ERRORS] Zie describeUploadFailure: een 402 (maandtegoed op) en een 413 (te groot) kunnen
  // per definitie niet slagen bij opnieuw proberen, dus dan hoort er geen knop te staan.
  fairUse?: boolean
  noRetry?: boolean
  // [MULTI-INVOICE] How many different invoices this ONE file appeared to contain. Only one was
  // read, so this row is a WARNING even though the upload succeeded — the others exist nowhere.
  multiInvoice?: number
}

/** Wat /api/intake terugstuurt, voor zover deze pagina het leest. Expliciet opgeschreven omdat het
 *  verschil tussen "geen veld" en "geen JSON" hier betekenis heeft (zie [UPLOAD-ERRORS]). */
interface IntakeResponse {
  destination?: Item['destination']
  message?: string
  auto_verified?: boolean
  could_not_read?: boolean
  vendor?: string | null
  total_inc_btw?: number | null
  invoice_number?: string | null
  duplicate?: boolean
  error?: string
  canForce?: boolean
  archived?: Item['archived']
  // [MULTI-INVOICE] Eén bestand met meerdere factuurnummers erin; de route noemt de nummers.
  multipleInvoices?: { numbers?: string[] }
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

// [UPLOAD-ERRORS] Alle uitkomst-vlaggen van de vorige poging gaan bij een herkansing terug op nul.
// Bleven ze staan, dan hield een geslaagde tweede poging de kleur en de knopregels van de mislukking
// waaruit ze kwam. Op modulehoogte, zodat het object stabiel is en de useCallbacks hun geheugen
// houden. `as const` niet: patch() verwacht een gewone Partial<Item>, geen readonly variant.
const RESET_ON_RETRY: Partial<Item> = {
  message: undefined, rateLimited: false, fairUse: false, noRetry: false, couldNotRead: false,
}

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

  // [BLOB-CLEANUP] …maar "op unmount" is op deze pagina niet vaak. Wie een ochtend bonnen verwerkt
  // blijft hier staan en doet batch na batch; elke foto houdt intussen zijn volledige bytes in het
  // geheugen vast, want een objectURL is een harde referentie. Op een telefoon met tweehonderd
  // bonnen is dat honderden MB's die pas vrijkomen als het tabblad dichtgaat.
  //
  // De lijst leegmaken is dus niet alleen opruimen op het scherm — het is de enige plek waar dit
  // geheugen tussentijds terug kan. Daarom hoort de knop hier en niet alleen bij de opmaak.
  // [QUEUE-PURITY] Het intrekken gebeurt BUITEN de state-updater, om dezelfde reden als bij
  // retryAllFailed: React mag een updater meer dan eens aanroepen voor één klik. Twee keer intrekken
  // is op zich onschadelijk, maar de ref eronder muteren niet — en een updater met neveneffecten is
  // hier al een keer duur geweest.
  const clearFinished = useCallback(() => {
    const keep = items.filter((i) => i.status === 'queued' || i.status === 'busy')
    if (keep.length === items.length) return
    // Alleen de URL's van rijen die ECHT weggaan. Een rij die nog in de wachtrij staat heeft zijn
    // preview straks nog nodig — en na "toch toevoegen" DELEN twee rijen dezelfde URL, dus de vraag
    // is niet "gaat deze rij weg" maar "blijft er nog iemand naar kijken".
    const kept = new Set(keep.map((i) => i.preview).filter((u): u is string => !!u))
    const gone = items
      .map((i) => i.preview)
      .filter((u): u is string => !!u && !kept.has(u))
    for (const u of gone) URL.revokeObjectURL(u)
    objectUrls.current = objectUrls.current.filter((u) => !gone.includes(u))
    setItems(keep)
  }, [items])

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
          // [UPLOAD-ERRORS] `null` bij een onleesbare body, geen `{}`. Dat onderscheid is het hele
          // punt: een 413 of 504 komt van het PLATFORM en heeft een HTML-body, dus `data.error`
          // bestond daar nooit — en juist daardoor viel elk zo'n geval in de algemene zin "Lezen
          // mislukt", over een bestand waar niets mis mee was.
          const data = (await res.json().catch(() => null)) as IntakeResponse | null
          if (res.ok) {
            patch(item.id, {
              status: 'done', destination: data?.destination, message: data?.message,
              autoVerified: data?.auto_verified === true,
              // [UNREAD-HONESTY] Opgeslagen maar niet gelezen — apart van 'klaar' gehouden.
              couldNotRead: data?.could_not_read === true,
              multiInvoice: data?.multipleInvoices?.numbers?.length,
              vendor: data?.vendor ?? null, total: data?.total_inc_btw ?? null, number: data?.invoice_number ?? null,
            })
          } else if (res.status === 409 && data?.duplicate) {
            patch(item.id, {
              status: 'duplicate', message: data.error || 'Al toegevoegd', canForce: !!data.canForce,
              // [DUP-ARCHIVED] alleen gezet als de bestaande factuur écht in Genegeerd staat
              archived: data.archived ?? undefined,
            })
          } else {
            // [UPLOAD-ERRORS] Eén vertaler voor álle overige statussen — 402 fair use, 413 te groot,
            // 429 te snel, 504 te lang, 5xx storing — zodat de melding en de knop bij de oorzaak
            // passen in plaats van bij het gemiddelde. Getest in src/lib/upload-failure.test.ts.
            patch(item.id, { status: 'error', ...describeUploadFailure(res.status, data?.error) })
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
    // [MP-PURE-UPDATER] Never set state from inside a state updater: a reducer must be pure, and
    // React may run it twice (StrictMode / concurrent rendering), which fired the cap warning
    // twice for one pick. Compute the capped list first, then write both pieces of state once.
    const merged = [...mpPages, ...imgs]
    const capped = merged.length > MAX_PAGES
    setMpPages(capped ? merged.slice(0, MAX_PAGES) : merged)
    setMpError(capped ? `Maximaal ${MAX_PAGES} pagina’s per factuur.` : null)
  }, [mpPages])

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
      // combineImagesToPdf names either the failing page ("Pagina 2 kon niet…") or why the set
      // cannot fit one upload ("Deze 20 pagina's passen samen niet…") — both are actionable.
      setMpError(e instanceof Error && /^(Pagina|Deze \d+ pagina)/.test(e.message) ? e.message : 'Combineren mislukt — voeg de pagina’s los toe.')
    } finally {
      setCombining(false)
    }
  }, [mpPages, combining, addFiles])

  // Re-try a file that failed (a transient AI error or a rate-limit that has since cleared).
  const retry = useCallback((item: Item) => {
    const again: Item = { ...item, status: 'queued', ...RESET_ON_RETRY }
    patch(item.id, { status: 'queued', ...RESET_ON_RETRY, message: 'Opnieuw in wachtrij…' })
    pending.current.push(again)
    void kick()
  }, [kick, patch])

  // [QUEUE-PURITY] De wachtrij wordt hier gevuld BUITEN de state-updater. Dit stond vroeger binnen
  // setItems(prev => …), en dat is precies de plek waar het niet mag: React mag zo'n updater meer dan
  // eens aanroepen voor dezelfde klik — StrictMode doet het in ontwikkeling standaard, en bij het
  // opnieuw baseren van een onderbroken update kan het in productie ook. Elke extra aanroep duwde
  // dezelfde bestanden nóg een keer in pending.current, dus het bestand ging twee keer omhoog en de
  // tweede keer kwam terug als "dit bestand staat al in je bestanden" — op precies het bestand dat de
  // eigenaar aan het herstellen was. Een updater hoort puur te zijn; het duwen is een neveneffect.
  const retryAllFailed = useCallback(() => {
    // [UPLOAD-ERRORS] Alleen wat een herkansing KAN halen. Een 402 (maandtegoed op) en een 413 (te
    // groot) gaan niet mee: die zouden gegarandeerd hetzelfde antwoord terugbrengen, en dan telt het
    // overzicht ze opnieuw als mislukt terwijl de eigenaar denkt dat hij iets heeft geprobeerd.
    const failed = items.filter((i) => i.status === 'error' && !i.noRetry)
    if (failed.length === 0) return
    for (const f of failed) pending.current.push({ ...f, status: 'queued', ...RESET_ON_RETRY })
    // Dezelfde lijst voor de rijen die "in wachtrij" gaan heten als voor de rijen die er echt in
    // liggen — anders kan de melding op het scherm en de inhoud van de wachtrij uit elkaar lopen.
    const queued = new Set(failed.map((f) => f.id))
    setItems((prev) => prev.map((i) => (queued.has(i.id) ? { ...i, status: 'queued' as Status, ...RESET_ON_RETRY, message: 'Opnieuw in wachtrij…' } : i)))
    void kick()
  }, [items, kick])

  // "Toch toevoegen" — re-submit an uncertain semantic duplicate with force=true as a NEW attempt.
  const forceAdd = useCallback((item: Item) => {
    // De nieuwe poging erft de preview van het origineel: het is hetzelfde bestand, dus de miniatuur
    // en "Bekijk bestand →" horen er ook op te staan. Zonder dit kreeg juist de regel met de échte
    // uitkomst geen afbeelding en geen link — de regel waarop de eigenaar wil kunnen controleren.
    const retry: Item = { id: nextId(), file: item.file, status: 'queued', force: true, preview: item.preview }
    setItems((prev) => [...prev, retry])
    pending.current.push(retry)
    // [UI-HONESTY] De oorspronkelijke regel blijft staan als wat hij is: geweigerd als duplicaat.
    // Hier stond `status: 'done'` met "Toch toegevoegd", gezet op het moment van KLIKKEN — dus vóór
    // de upload. Mislukte die daarna (429, leesfout, verbinding weg), dan bleef een groene regel een
    // toevoeging claimen die nooit gebeurde, en telde het overzicht hem als geslaagd mee. De uitkomst
    // hoort op de nieuwe regel, en nergens anders.
    //
    // canForce en archived gaan wél weg: beide knoppen zijn nu uitgewerkt. Nog een keer forceren zou
    // een derde regel maken, en alsnog "terugzetten uit Genegeerd" zou de teruggezette factuur NAAST
    // de zojuist geforceerde zetten — twee facturen voor één papier.
    patch(item.id, {
      canForce: false,
      archived: undefined,
      message: 'Je hebt dit toch toegevoegd — de uitkomst staat op de nieuwe regel hieronder.',
    })
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
  // [UNREAD-HONESTY] Opgeslagen maar NIET gelezen — een eigen categorie, niet "klaar" en niet "fout".
  // Deze regels vielen onder countBy('document') en verdwenen zo in "1 bestand", terwijl dit juist de
  // bestanden zijn waar de eigenaar nog iets mee moet.
  const unread = done.filter((i) => i.couldNotRead)
  const countBy = (d: string) => done.filter((i) => i.destination === d && !i.couldNotRead).length
  // [UPLOAD-ERRORS] Alleen wat een herkansing kan halen telt voor de "alles opnieuw"-knop.
  const retryable = errs.filter((i) => !i.noRetry).length
  // [AUTO-ADVANCE-HONESTY] Invoices split by WHERE they now wait: auto-booked ones sit
  // on Inkoopfacturen, the rest in the verify queue. The summary used to lump both into
  // "X factuur/bon" with a single "Naar Te verifiëren →", so a batch the app fully
  // handled itself pointed at an empty queue.
  const autoBooked = done.filter((i) => i.autoVerified).length
  const toVerify = done.filter(
    (i) => (i.destination === 'invoice' || i.destination === 'receipt') && !i.autoVerified,
  ).length
  // [MULTI-INVOICE] Files that imported one invoice and silently left others behind. Counted
  // separately from the plain successes, because "klaar" is exactly what they are NOT.
  const multiFiles = done.filter((i) => i.multiInvoice).length
  const anyResult = done.length + dups.length + errs.length > 0

  return (
    <div style={{ minHeight: '100vh', background: M3.bg, fontFamily: FONT }}>
      <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '20px 16px 80px' }}>
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
            style={{ background: reproc.busy ? '#70757a' : '#0B8043', color: '#fff', border: 'none', borderRadius: 999, padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: reproc.busy ? 'default' : 'pointer', fontFamily: FONT }}>
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
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: M3.neutral }}>
              {busyCount > 0
                ? `Bezig met verwerken… ${items.length - busyCount}/${items.length} klaar`
                : `Klaar — ${items.length} bestand(en) verwerkt`}
            </span>
            {/* [BLOB-CLEANUP] De lijst opruimen zonder de pagina te verlaten. Naast het schoonvegen
                van het scherm is dit de enige plek waar het geheugen van de vorige batch tussentijds
                terugkomt: elke miniatuur houdt zijn volledige bestand vast tot de URL is ingetrokken.
                Rijen die nog in de wachtrij staan blijven staan — die zijn nog niet af. */}
            {items.length - busyCount > 0 && (
              <button onClick={clearFinished}
                style={{ background: 'transparent', border: `1px solid ${M3.outlineVariant}`, color: M3.neutral, borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                Lijst opruimen
              </button>
            )}
          </div>
        )}

        {/* Per-file result list */}
        {items.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it) => {
              const d = it.destination ? DEST[it.destination] : null
              // [MULTI-INVOICE] A file that held several invoices imported fine — and still lost
              // the others. A green edge would read as "done"; it is the one 'done' row the owner
              // must act on, so it wears the warning colour.
              const border =
                it.status === 'error' ? M3.error
                : it.status === 'duplicate' ? M3.warn
                // [UNREAD-HONESTY] Opgeslagen, maar niet gelezen → dezelfde aandachtskleur als een
                // duplicaat en als een bestand met meerdere facturen, niet het groen van geslaagd.
                // Het bestand is veilig, maar er moet nog iets gebeuren, en dat is wat de rand
                // hoort te zeggen.
                : it.status === 'done' ? (it.couldNotRead || it.multiInvoice ? M3.warn : M3.success)
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
                        {it.status === 'queued' ? '⏳' : it.status === 'busy' ? '🔄'
                          : it.status === 'done' ? (it.couldNotRead ? '⚠️' : (d?.icon ?? '📄'))
                          : it.status === 'duplicate' ? '⚠️' : '📄'}
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
                      <p style={{ fontSize: 12, color: it.status === 'error' ? (it.rateLimited || it.fairUse ? M3.warn : M3.error) : it.status === 'duplicate' || it.couldNotRead || it.multiInvoice ? M3.warn : M3.neutral, margin: '2px 0 0', lineHeight: 1.4 }}>
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
                    {it.status === 'done' && it.couldNotRead ? (
                      // [UNREAD-HONESTY] "Bestand" zou hier klinken als afgehandeld. Het bestand
                      // staat er inderdaad — maar ongelezen, en dát is wat de eigenaar moet weten.
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#8A5A00', background: '#FEF7E0', borderRadius: 999, padding: '3px 10px' }}>
                        Niet gelezen
                      </span>
                    ) : it.status === 'done' && d ? (
                      // [AUTO-ADVANCE-HONESTY] The badge names the OUTCOME, not just the type:
                      // "Factuur" on a row the app already booked reads as "still to do".
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: it.multiInvoice ? '#7C5800' : it.autoVerified ? '#0B5A28' : d.color, background: it.multiInvoice ? '#FEE8C4' : it.autoVerified ? '#E6F4EA' : '#F1F3F4', borderRadius: 999, padding: '3px 10px' }}>
                        {it.multiInvoice ? `${it.multiInvoice} facturen` : it.autoVerified ? 'Automatisch geboekt' : d.label}
                      </span>
                    ) : null}
                  </div>
                  {/* Actions row: retry a failure, or override an uncertain duplicate. */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {/* [UPLOAD-ERRORS] Geen knop waar opnieuw proberen gegarandeerd hetzelfde
                        antwoord geeft (402 maandtegoed, 413 te groot). Een knop die niets kan
                        opleveren laat de eigenaar denken dat de app stuk is. */}
                    {it.status === 'error' && !it.noRetry && (
                      <button onClick={() => retry(it)}
                        style={{ marginTop: 8, background: 'transparent', color: M3.primary, border: `1px solid ${M3.primaryContainer}`, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
                        ↻ Opnieuw proberen
                      </button>
                    )}
                    {/* Bij fair use is de uitweg geen herhaling maar een keuze — en die staat op
                        /prijzen. De server stuurt dat adres zelf mee; hier stond het nergens. */}
                    {it.status === 'error' && it.fairUse && (
                      <Link href="/prijzen"
                        style={{ marginTop: 8, background: M3.primaryContainer, color: '#041E49', borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}>
                        Bekijk de mogelijkheden →
                      </Link>
                    )}
                    {/* [UNREAD-HONESTY] Het bestand is bewaard maar niet gelezen. De handeling die
                        wél helpt is een betere foto — niet dezelfde nog een keer. */}
                    {it.status === 'done' && it.couldNotRead && (
                      <Link href="/dashboard/bestanden"
                        style={{ marginTop: 8, background: '#FEF7E0', color: '#8A5A00', borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}>
                        Bekijk in Bestanden →
                      </Link>
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
            {/* [UNREAD-HONESTY] Het vinkje is een uitspraak, geen versiering. Staat er nog iets open
                — niet gelezen, dubbel, of mislukt — dan is de batch wél af maar niet schoon, en dan
                hoort er geen ✓ boven te staan dat de eigenaar laat ophouden met kijken. */}
            <p style={{ fontSize: 14, fontWeight: 700, color: M3.onSurface, margin: '0 0 8px' }}>
              {unread.length + dups.length + errs.length === 0 ? 'Klaar ✓' : 'Klaar — met aandachtspunten'}
            </p>
            <p style={{ fontSize: 13, color: M3.neutral, margin: '0 0 12px', lineHeight: 1.6 }}>
              {autoBooked > 0 && <><strong style={{ color: M3.success }}>{autoBooked} automatisch geboekt</strong> · </>}
              {toVerify > 0 && <>{toVerify} factuur/bon te controleren · </>}
              {countBy('bank') > 0 && <>{countBy('bank')} bankafschrift · </>}
              {countBy('turnover') > 0 && <>{countBy('turnover')} kassa-omzet · </>}
              {countBy('ledger') > 0 && <>{countBy('ledger')} controle-check · </>}
              {countBy('document') > 0 && <>{countBy('document')} bestand · </>}
              {countBy('statement') > 0 && <>{countBy('statement')} rekeningoverzicht · </>}
              {/* Eigen post, want dit is een getal waar de eigenaar nog iets mee moet en dat
                  vroeger onzichtbaar opging in "X bestand". */}
              {unread.length > 0 && <span style={{ color: M3.warn }}>{unread.length} niet gelezen · </span>}
              {multiFiles > 0 && <span style={{ color: M3.warn }}>{multiFiles} bestand(en) met meerdere facturen · </span>}
              {dups.length > 0 && <>{dups.length} dubbel · </>}
              {errs.length > 0 && <span style={{ color: M3.error }}>{errs.length} mislukt</span>}
            </p>
            {/* [UNREAD-HONESTY] Wat "niet gelezen" betekent en wat eraan te doen is — één keer,
                zoals het blok hieronder dat voor "automatisch geboekt" doet. */}
            {unread.length > 0 && (
              <p style={{ fontSize: 12.5, color: '#8A5A00', background: '#FEF7E0', border: '1px solid #F3D99B', borderRadius: 10, padding: '10px 12px', margin: '0 0 12px', lineHeight: 1.5 }}>
                {unread.length === 1 ? 'Eén bestand staat' : `${unread.length} bestanden staan`} veilig in je bestanden, maar
                {unread.length === 1 ? ' kon' : ' konden'} niet automatisch gelezen worden — er is dus niets van geboekt.
                Was het een factuur of bon? Maak er dan een scherpere foto van, of controleer het zelf in Bestanden.
              </p>
            )}
            {/* [UPLOAD-ERRORS] De knop telt alleen wat een herkansing kan halen. Stond hier eerst
                errs.length, dus ook een 402 of 413 werd meegeteld in "Alle N opnieuw proberen" —
                en die kwamen gegarandeerd als mislukt terug. */}
            {retryable > 0 && (
              <div style={{ marginBottom: 12 }}>
                <button onClick={retryAllFailed}
                  style={{ background: M3.error, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                  ↻ Alle {retryable} mislukte opnieuw proberen
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
              {/* [UNREAD-HONESTY] Ook de niet-gelezen bestanden staan in Bestanden. Nu unread uit
                  countBy('document') is gehaald, zou een batch met alléén onleesbare bestanden
                  anders zónder weg erheen eindigen — precies de batch die er een nodig heeft. */}
              {(countBy('document') > 0 || unread.length > 0 || countBy('statement') > 0) && (
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
