// [EXPORT-CSV] Pure node test — run: npx tsx --test src/lib/export.test.ts
//
// export.ts builds the file the ACCOUNTANT opens, and it had no test at all — 380 lines whose
// output leaves the app and lands in someone else's Excel. What is covered here is the part that
// can be wrong without anyone noticing: the derived BTW rate, the Dutch number format, and the
// CSV itself, where a wrong separator or an unescaped cell silently shifts a column and moves an
// amount into the field beside it.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  calcBtwRate,
  fmtAmountNL,
  fmtDateNL,
  toExportRowFull,
  invoicesToCsv,
  invoicesToCsvAccountant,
  type InvRow,
} from './export'

/** Count CSV fields the way a reader does: a delimiter inside quotes does not separate. */
function fieldCount(line: string): number {
  let n = 1, inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuotes = line[i + 1] === '"' ? (i++, inQuotes) : !inQuotes
    else if (c === ';' && !inQuotes) n++
  }
  return n
}

const ROW: InvRow = {
  invoice_number: '2026-001',
  client_name: 'Stichting Contour de Twern',
  client_email: 'info@example.nl',
  client_address: 'Spoorlaan 444',
  client_postal_code: '5038CH',
  client_city: 'Tilburg',
  status: 'sent',
  direction: 'outgoing',
  total_ex_btw: 362.38,
  btw_amount: 32.61,
  total_inc_btw: 394.99,
  invoice_date: '2026-08-08',
  due_date: '2026-09-07',
  invoice_type: 'factuur',
} as InvRow

// ── the derived rate ───────────────────────────────────────────────────────────────────────────

test('[EXPORT-CSV] the rate is derived, never stored — and an odd one is shown, not hidden', () => {
  assert.equal(calcBtwRate(21, 100), 21)
  assert.equal(calcBtwRate(9, 100), 9)
  assert.equal(calcBtwRate(0, 100), 0)
  // A mixed-rate invoice has no single rate. The per-invoice overview is accountant-facing and
  // shows the blended figure ON PURPOSE, so they can trace it; snapping it to a clean 21% would
  // hide the very thing worth looking at. (This is also why calcBtwSummary was deleted: it
  // BUCKETED on this number, which turned a 15% blend into a wholly-21% quarter.)
  assert.equal(calcBtwRate(150, 1000), 15)
  assert.equal(calcBtwRate(32.61, 362.38), 9, 'the real Kiwi invoice reads as 9%')
})

test('[EXPORT-CSV] a zero or missing base never divides', () => {
  assert.equal(calcBtwRate(21, 0), 0)
  assert.equal(calcBtwRate(21, null), 0)
  assert.equal(calcBtwRate(null, 100), 0)
  assert.ok(Number.isFinite(calcBtwRate(21, 0)), 'no Infinity may reach a spreadsheet')
})

// ── the Dutch formats ──────────────────────────────────────────────────────────────────────────

test('[EXPORT-CSV] amounts use the Dutch comma, and always two decimals', () => {
  assert.equal(fmtAmountNL(394.99), '394,99')
  assert.equal(fmtAmountNL(1000), '1000,00')
  assert.equal(fmtAmountNL(-51.8), '-51,80')
  assert.equal(fmtAmountNL(0), '0,00')
  // No thousands separator: it would be a SECOND comma in a semicolon-delimited file, and Excel
  // NL reads the amount up to the first one.
  assert.doesNotMatch(fmtAmountNL(1234567.89), /\./)
})

test('[TZ] the export date is DD-MM-YYYY, and the SAME day in every timezone', () => {
  // This file used to format dates itself, with new Date(iso).toLocaleDateString("nl-NL").
  // invoice_date is a DATE column with no zone, so that parse means UTC midnight and any
  // timezone west of UTC renders the day BEFORE. Measured on the old code:
  //   UTC / Europe/Amsterdam  8-8-2026 · America/New_York  7-8-2026 · Pacific/Honolulu  7-8-2026
  // On the file that goes to someone else's bookkeeping. It now delegates to format-nl.ts, which
  // reads the ISO prefix as a string and never builds a Date.
  assert.equal(fmtDateNL('2026-08-08'), '08-08-2026')
  assert.equal(fmtDateNL('2026-01-01'), '01-01-2026', 'padded, like every screen in the app')
  // A full timestamp still resolves, and a missing date says so rather than inventing one.
  assert.equal(fmtDateNL('2026-08-08T23:30:00Z'), '08-08-2026')
  assert.equal(fmtDateNL(null), '—')
})

// ── the row, and the file ──────────────────────────────────────────────────────────────────────

test('[EXPORT-CSV] the full row carries every client field the CSV promises', () => {
  const r = toExportRowFull(ROW, 'Q3 2026')
  assert.equal(r.invoice_number, '2026-001')
  assert.equal(r.client_email, 'info@example.nl')
  assert.equal(r.client_postal_code, '5038CH')
  assert.equal(r.invoice_type, 'factuur')
  assert.equal(r.btw_rate, 9)
  assert.equal(r.period, 'Q3 2026')
  assert.equal(r.invoice_date, '08-08-2026', 'padded and timezone-proof — see the [TZ] test above')
})

test('[EXPORT-CSV] every row has exactly as many cells as the header has columns', () => {
  // The failure this catches is the quiet one: a column added to the header and not to the row
  // shifts every field after it, so an amount lands under a date and nothing looks broken.
  const csv = invoicesToCsv([toExportRowFull(ROW, 'Q3 2026')])
  const [header, row] = csv.split('\n')
  assert.equal(
    fieldCount(row), header.split(';').length,
    `header has ${header.split(';').length} columns, the row has ${fieldCount(row)}`,
  )
  assert.match(header, /^Factuurnummer;/)
  assert.ok(header.includes('BTW tarief %'))
})

test('[EXPORT-CSV] a semicolon in a client name does not open a new column', () => {
  // Dutch Excel splits on ';', so an unquoted one in a NAME moves the amounts one field to the
  // left for that row only — the kind of error an accountant finds and the owner cannot explain.
  const csv = invoicesToCsv([
    toExportRowFull({ ...ROW, client_name: 'Jansen; Bouw & Zn' } as InvRow, 'Q3 2026'),
  ])
  const [header, row] = csv.split('\n')
  // Counted with a parser that honours quoting, not with split(';') — a quoted cell still
  // CONTAINS the delimiter, so a naive split reports one column too many and accuses correct
  // code. (It did, on the first run of this test.)
  assert.equal(fieldCount(row), header.split(';').length, 'the name must be quoted')
  assert.ok(row.includes('"Jansen; Bouw & Zn"'), 'quoted, and the name itself intact')
})

test('[EXPORT-CSV] a formula lead is neutralised — the CSV opens in someone else\'s Excel', () => {
  // =, +, - and @ at the start of a cell are executed by Excel. A client name is attacker-chosen
  // text on an incoming invoice, and the file is opened by an accountant on another machine.
  for (const name of ['=HYPERLINK("http://x")', '+1+1', '-1+1', '@SUM(A1)']) {
    const csv = invoicesToCsv([toExportRowFull({ ...ROW, client_name: name } as InvRow, 'Q3 2026')])
    const cell = csv.split('\n')[1].split(';').find((c) => c.includes(name.slice(1, 6)))
    assert.ok(cell, `the name must still be present: ${name}`)
    assert.doesNotMatch(
      cell!, /^"?[=+\-@]/,
      `a cell may not START with a formula lead: ${cell}`,
    )
  }
})

test('[EXPORT-CSV] an empty export is a header, not an empty file', () => {
  // An accountant who receives a 0-byte file cannot tell "no invoices this quarter" from "the
  // export broke".
  const csv = invoicesToCsv([])
  assert.ok(csv.startsWith('Factuurnummer;'))
  assert.equal(csv.split('\n').length, 1)
})

test('[EXPORT-CSV] a creditnota keeps its negative amounts and its type', () => {
  // The sign IS the correction. An export that dropped it would show a credit note as an ordinary
  // sale of the same size — the books would be out by twice the amount.
  const r = toExportRowFull(
    { ...ROW, invoice_type: 'creditnota', total_ex_btw: -100, btw_amount: -21, total_inc_btw: -121 } as InvRow,
    'Q3 2026',
  )
  assert.equal(r.invoice_type, 'creditnota')
  assert.equal(r.total_inc_btw, -121)
  assert.equal(r.btw_rate, 21, 'a negative over a negative is still 21%')
  const csv = invoicesToCsv([r])
  assert.ok(csv.includes('-121,00') || csv.includes('-121'), 'the minus reaches the file')
})

// ─── [SLUIS] The accountant's all-clients export ──────────────────────────────

test("[SLUIS] the accountant CSV names the administration AND the invoice's counterpart", () => {
  // The one it lost. This file spans many administrations, so column 1 has to say whose books a
  // row belongs to — and it said so by writing the administration's name into the slot where the
  // owner's export puts client_name. The counterpart then disappeared: its e-mail, street,
  // postcode and city all still on the row, with somebody else's name beside them.
  //
  // An accountant reconciles by name. A hundred rows in which every name reads "Kiwi Food Market"
  // cannot be reconciled at all.
  const row = { ...toExportRowFull(ROW, 'Q3 2026'), klant_id: 'klant-1' }
  const csv = invoicesToCsvAccountant([row], { 'klant-1': 'Kiwi Food Market' })
  const [header, line] = csv.split('\n')

  assert.match(header, /^Administratie;/, "column 1 says whose books this is")
  assert.ok(header.includes('Tegenpartij'), "the invoice's own counterpart has a column of its own")

  const cells = line.split(';')
  assert.equal(cells[0], 'Kiwi Food Market', 'the administration')
  assert.equal(cells[3], 'Stichting Contour de Twern', 'and the party the invoice is actually with')
  assert.notEqual(cells[0], cells[3], 'the two must be separate columns, not the same value twice')

  // Same invariant as the owner's export: a column added to one and not the other shifts every
  // field after it, and an amount lands under a date with nothing looking broken.
  assert.equal(
    fieldCount(line), header.split(';').length,
    `header has ${header.split(';').length} columns, the row has ${fieldCount(line)}`,
  )
})

test("[SLUIS] both exports carry the same columns, with the administration in front", () => {
  // The two files are read side by side by the same person. Keeping them column-for-column
  // identical apart from the leading one is what makes that possible — and it is the cheapest way
  // to notice that a column added to one was forgotten in the other.
  const row = { ...toExportRowFull(ROW, 'Q3 2026'), klant_id: 'klant-1' }
  const owner = invoicesToCsv([row]).split('\n')[0].split(';')
  const accountant = invoicesToCsvAccountant([row], {}).split('\n')[0].split(';')

  assert.equal(accountant[0], 'Administratie')
  assert.deepEqual(
    accountant.slice(1).map((c) => (c === 'Tegenpartij' ? 'Klant' : c)),
    owner,
    "the accountant export is the owner export plus one leading column — no more, no less",
  )
})

test("[SLUIS] an unknown administration falls back to the counterpart, and still names it twice", () => {
  // A row whose klant_id is not in the lookup. The fallback is the counterpart's own name, which
  // is the only name in hand — and it must still appear in the Tegenpartij column, because the
  // reader cannot know that column 1 fell back.
  const row = { ...toExportRowFull(ROW, 'Q3 2026'), klant_id: 'onbekend' }
  const cells = invoicesToCsvAccountant([row], {}).split('\n')[1].split(';')
  assert.equal(cells[0], 'Stichting Contour de Twern')
  assert.equal(cells[3], 'Stichting Contour de Twern')
})
