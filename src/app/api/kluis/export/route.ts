// src/app/api/kluis/export/route.ts
// [KLUIS] Compliance-kluis export — a ZIP of one fiscal year's administratie:
// every stored document for that year + a manifest (index.csv) + a README that
// states the 7-year bewaarplicht. Owner-only (session/RLS): documents are fetched
// scoped by user_id and downloaded from the owner's own storage, so no cross-user
// access is possible. This embodies the open-door principle — the whole year exports
// cleanly, for the accountant or the owner, at any time.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import JSZip from 'jszip'
import { keepThroughYear } from '@/lib/compliance-vault'

export const dynamic = 'force-dynamic'

// Bounds so one export can't exhaust server memory. Honest if we hit them: the
// README records exactly what was left out (never a silent truncation).
const MAX_FILES = 500
const MAX_TOTAL_BYTES = 150 * 1024 * 1024 // 150 MB

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const eur = (n: number | null) => (n == null ? '' : n.toFixed(2).replace('.', ','))
// A storage path may contain slashes/odd chars — keep a safe, readable file name.
const safeName = (s: string) => s.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120) || 'bestand'

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const yearRaw = req.nextUrl.searchParams.get('year')
  const year = Number(yearRaw)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Ongeldig jaar' }, { status: 400 })
  }

  // The year's records — owner-scoped.
  const [{ data: documents }, { data: invoices }] = await Promise.all([
    supabase
      .from('documents')
      .select('file_name, file_url, file_type, doc_type, period, invoice_id, created_at')
      .eq('user_id', user.id)
      .eq('year', year)
      .eq('trashed', false),
    supabase
      .from('invoices')
      .select('invoice_number, invoice_date, direction, invoice_type, client_name, total_ex_btw, btw_amount, total_inc_btw, status')
      .eq('sender_id', user.id)
      .gte('invoice_date', `${year}-01-01`)
      .lte('invoice_date', `${year}-12-31`),
  ])

  const docs = documents ?? []
  const invs = invoices ?? []
  if (docs.length === 0 && invs.length === 0) {
    return NextResponse.json({ error: `Geen stukken gevonden voor ${year}.` }, { status: 404 })
  }

  const zip = new JSZip()
  const root = zip.folder(`administratie-${year}`)!
  const docFolder = root.folder('documenten')!

  // ── documents: download each from the owner's storage, note failures honestly ──
  const manifest: string[] = ['Bestand;Type;Kwartaal;Gekoppelde factuur;Toegevoegd;Status']
  const skipped: string[] = []
  let usedBytes = 0
  let added = 0
  const usedNames = new Set<string>()

  for (const d of docs) {
    if (added >= MAX_FILES) { skipped.push(`${d.file_name} (limiet ${MAX_FILES} bestanden bereikt)`); continue }
    let status = 'ok'
    let name = safeName(d.file_name || 'bestand')
    if (!d.file_url) {
      status = 'geen bestand'
    } else {
      const { data: blob, error } = await supabase.storage.from('documents').download(d.file_url)
      if (error || !blob) {
        status = 'niet gevonden in opslag'
        skipped.push(`${d.file_name} (${status})`)
      } else {
        const buf = Buffer.from(await blob.arrayBuffer())
        if (usedBytes + buf.length > MAX_TOTAL_BYTES) {
          status = `overgeslagen (max ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB per export)`
          skipped.push(`${d.file_name} (${status})`)
        } else {
          // De-dupe identical names so no file silently overwrites another.
          if (usedNames.has(name)) name = `${added + 1}-${name}`
          usedNames.add(name)
          docFolder.file(name, buf)
          usedBytes += buf.length
          added++
        }
      }
    }
    manifest.push([
      csvCell(status === 'ok' ? name : d.file_name),
      csvCell(d.doc_type ?? ''),
      csvCell(d.period ?? ''),
      csvCell(d.invoice_id ?? ''),
      csvCell(d.created_at ? String(d.created_at).slice(0, 10) : ''),
      csvCell(status),
    ].join(';'))
  }

  // ── invoices manifest (the financial records themselves) ──
  const invLines: string[] = ['Factuurnummer;Datum;Richting;Type;Klant;Excl. BTW;BTW;Incl. BTW;Status']
  const sortedInv = [...invs].sort((a, b) => (a.invoice_date ?? '').localeCompare(b.invoice_date ?? ''))
  for (const i of sortedInv) {
    invLines.push([
      csvCell(i.invoice_number ?? ''),
      csvCell(i.invoice_date ?? ''),
      csvCell(i.direction === 'outgoing' ? 'uit' : i.direction === 'incoming' ? 'in' : ''),
      csvCell(i.invoice_type ?? ''),
      csvCell(i.client_name ?? ''),
      csvCell(eur(i.total_ex_btw)),
      csvCell(eur(i.btw_amount)),
      csvCell(eur(i.total_inc_btw)),
      csvCell(i.status ?? ''),
    ].join(';'))
  }

  root.file('documenten-index.csv', '﻿' + manifest.join('\r\n') + '\r\n')
  root.file('facturen-index.csv', '﻿' + invLines.join('\r\n') + '\r\n')

  const readme = [
    `Administratie ${year} — geëxporteerd uit BoekBrug`,
    ``,
    `Deze map bevat je stukken over ${year}:`,
    `  • documenten/            — je bankafschriften, bonnen en overige documenten`,
    `  • documenten-index.csv   — overzicht van die documenten`,
    `  • facturen-index.csv     — al je facturen (in en uit) over ${year}`,
    ``,
    `Bewaarplicht: de Belastingdienst vraagt je administratie 7 jaar te bewaren.`,
    `De stukken over ${year} bewaar je dus tot en met ${keepThroughYear(year)}.`,
    ``,
    `Documenten in dit bestand: ${added}${skipped.length ? ` (overgeslagen: ${skipped.length})` : ''}.`,
    `Facturen in het overzicht: ${invs.length}.`,
    ...(skipped.length ? ['', 'Overgeslagen bestanden:', ...skipped.map((s) => `  - ${s}`)] : []),
    ``,
    `BoekBrug — je financiële waarheid, altijd exporteerbaar.`,
  ].join('\n')
  root.file('LEESMIJ.txt', readme)

  const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return new NextResponse(content as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="boekbrug-administratie-${year}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}
