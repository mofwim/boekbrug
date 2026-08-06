// src/lib/e-invoice.ts
// [E-FACTUUR] The supplier's own figures, in machine form. No AI, no OCR, no reading of a picture.
// Run: npx tsx --test src/lib/e-invoice.test.ts
//
// ── WHY THIS IS THE MOST IMPORTANT WITNESS IN THE APP ──
// Everything else this import does to be sure of a number is a way of checking a READING:
//
//   · the arithmetic gate compares three figures one read produced;
//   · field_confidence is the model's opinion of its own answer;
//   · [GEGROND] asks whether the figure occurs in the document's own characters;
//   · [DOCCHECK] asks whether it sits where a total is printed;
//   · the OCR pass is a second reading, with different failure modes.
//
// An e-invoice is not a reading at all. Factur-X and ZUGFeRD are ordinary-looking PDFs that carry
// the invoice a second time as XML attached inside the file; a Peppol/UBL invoice is that XML on
// its own. Either way the supplier states the totals in a structured form THEY produced. There is
// nothing to interpret, and no picture in between.
//
// The app could not see any of it. A Factur-X PDF was photographed by the model like any other
// page while the exact figures sat unread inside the same bytes.
//
// ── AND IT MATTERS MORE EVERY YEAR ──
// The Netherlands makes Peppol e-invoicing mandatory for businesses over €800k turnover from
// 1 January 2027, and for everyone — zzp included — from 1 January 2028, with EU ViDA behind it.
// German suppliers already send ZUGFeRD today, so a Dutch buyer receives these now.
//
// ── WHAT THIS FILE DOES AND DOES NOT DO ──
// It finds the XML and reads the money out of it. It does not validate against EN 16931, does not
// check Schematron, does not care about line items, and it refuses anything it cannot read
// completely and consistently — a half-parsed e-invoice is worth less than no e-invoice, because
// it would be trusted.
//
// Both syntaxes are supported because both occur: CII (Factur-X / ZUGFeRD / XRechnung) and UBL
// (Peppol / NLCIUS). They are two spellings of the same European semantic model, and an importer
// that knows only one fails SILENTLY on the other — the totals simply are not where it looked.

import zlib from 'node:zlib'
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFHexString, PDFString } from 'pdf-lib'

/** What an e-invoice states about the money. Every field required — see completeness below. */
export interface EInvoiceFigures {
  totalIncBtw: number
  totalExBtw: number
  btwAmount: number
  /** 'cii' (Factur-X / ZUGFeRD / XRechnung) or 'ubl' (Peppol / NLCIUS). For the audit trail. */
  syntax: 'cii' | 'ubl'
  /** The document's own number, when it states one. Never invented. */
  invoiceNumber: string | null
}

/**
 * The attachment names the standards use. ZUGFeRD 1.0 called it something else than 2.x, and an
 * extractor that knows only the current name fails silently on the older one — the file is there,
 * nothing looks for it, and the PDF is treated as an ordinary picture.
 */
const EMBEDDED_XML_NAMES = [
  'factur-x.xml',        // Factur-X, ZUGFeRD 2.1+
  'zugferd-invoice.xml', // ZUGFeRD 1.0 and 2.0
  'xrechnung.xml',       // XRechnung as a PDF attachment
  'cii.xml',
  'ubl-invoice.xml',
]

/**
 * The invoice XML carried inside a PDF, or null when there is none.
 *
 * Never throws: this runs on untrusted mail inside the sync loop, and a malformed PDF must leave
 * the import exactly as it was rather than take the batch down.
 */
export function extractEmbeddedInvoiceXml(pdfBytes: Buffer): Promise<string | null> {
  return extractEmbedded(pdfBytes).catch(() => null)
}

async function extractEmbedded(pdfBytes: Buffer): Promise<string | null> {
  // updateMetadata:false — we only read. throwOnInvalidObject stays off so a slightly broken but
  // readable PDF still gives up its attachment.
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false })
  const names = doc.catalog.lookup(PDFName.of('Names'), PDFDict)
  if (!names) return null
  const embedded = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict)
  if (!embedded) return null
  const list = embedded.lookup(PDFName.of('Names'), PDFArray)
  if (!list) return null

  // The array alternates name, filespec, name, filespec…
  let fallback: string | null = null
  for (let i = 0; i + 1 < list.size(); i += 2) {
    const rawName = list.lookup(i)
    const name =
      rawName instanceof PDFHexString || rawName instanceof PDFString
        ? rawName.decodeText()
        : String(rawName ?? '')
    const spec = list.lookup(i + 1, PDFDict)
    if (!spec) continue
    const content = readFileSpec(spec)
    if (!content) continue
    if (EMBEDDED_XML_NAMES.includes(name.toLowerCase().trim())) return content
    // A .xml attachment under a name nobody standardised is still worth a look — but only after
    // every known name has been ruled out, so a real factur-x.xml always wins.
    if (fallback === null && /\.xml$/i.test(name) && looksLikeInvoiceXml(content)) fallback = content
  }
  return fallback
}

function readFileSpec(spec: PDFDict): string | null {
  const ef = spec.lookup(PDFName.of('EF'), PDFDict)
  if (!ef) return null
  const stream = ef.lookup(PDFName.of('F')) ?? ef.lookup(PDFName.of('UF'))
  if (!(stream instanceof PDFRawStream)) return null
  const raw = Buffer.from(stream.getContents())
  const filter = String(stream.dict.get(PDFName.of('Filter')) ?? '')
  try {
    // FlateDecode is what every producer uses; an uncompressed attachment is legal too.
    const bytes = filter.includes('FlateDecode') ? zlib.inflateSync(raw) : raw
    return stripBom(bytes.toString('utf8'))
  } catch {
    // A stream we cannot inflate is not evidence about the invoice. Fall through as "no XML",
    // which leaves the ordinary reading path exactly as it was.
    return null
  }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/** Cheap shape test, so an unrelated .xml attachment is not parsed as an invoice. */
export function looksLikeInvoiceXml(xml: string): boolean {
  const head = xml.slice(0, 4000)
  return /<(?:\w+:)?(?:CrossIndustryInvoice|Invoice|CreditNote)[\s>]/.test(head)
}

/**
 * The money an e-invoice states, or null when it does not state it completely.
 *
 * NULL IS THE IMPORTANT RETURN. A partially-read e-invoice is worse than none, because whatever it
 * produced would be trusted above the model — so anything short of three self-consistent figures
 * in euro is refused, and the ordinary reading path carries on untouched.
 */
export function parseEInvoice(xml: string): EInvoiceFigures | null {
  if (!xml || !looksLikeInvoiceXml(xml)) return null
  const isCii = /<(?:\w+:)?CrossIndustryInvoice[\s>]/.test(xml.slice(0, 4000))
  return isCii ? parseCii(xml) : parseUbl(xml)
}

/**
 * Factur-X / ZUGFeRD / XRechnung. The totals live together in one summation block, and they are
 * read from INSIDE it on purpose: the same element names occur again per line and per tax rate, so
 * a document-wide search for GrandTotalAmount can pick up a line's figure on some layouts.
 */
function parseCii(xml: string): EInvoiceFigures | null {
  const block = firstBlock(xml, 'SpecifiedTradeSettlementHeaderMonetarySummation')
  if (!block) return null
  const inc = firstAmount(block, 'GrandTotalAmount')
  const ex = firstAmount(block, 'TaxBasisTotalAmount')
  const btw = firstAmount(block, 'TaxTotalAmount')
  const currency = firstCurrency(block, 'GrandTotalAmount') ?? firstCurrency(block, 'TaxTotalAmount')
  const header = firstBlock(xml, 'ExchangedDocument')
  return complete({
    inc, ex, btw, currency, syntax: 'cii',
    invoiceNumber: header ? firstText(header, 'ID') : null,
  })
}

/**
 * Peppol / NLCIUS. LegalMonetaryTotal is the header block; the per-rate figures sit in TaxSubtotal
 * with the SAME element names, which is exactly the trap the block-scoped read avoids.
 *
 * BTW is taken from LegalMonetaryTotal's own two figures rather than from TaxTotal/TaxAmount,
 * because TaxAmount appears once per rate as well and the first occurrence is not always the total.
 * The subtraction cannot pick the wrong element; a mis-picked TaxAmount can.
 */
function parseUbl(xml: string): EInvoiceFigures | null {
  const block = firstBlock(xml, 'LegalMonetaryTotal')
  if (!block) return null
  // PayableAmount is what the buyer owes and is the figure a bookkeeper books; TaxInclusiveAmount
  // equals it except when a prepayment or a rounding line is present, so it is the fallback.
  const inc = firstAmount(block, 'PayableAmount') ?? firstAmount(block, 'TaxInclusiveAmount')
  const ex = firstAmount(block, 'TaxExclusiveAmount')
  const currency = firstCurrency(block, 'PayableAmount') ?? firstCurrency(block, 'TaxInclusiveAmount')
  const btw = inc !== null && ex !== null ? round2(inc - ex) : null
  return complete({
    inc, ex, btw, currency, syntax: 'ubl',
    // The document-level ID is the first cbc:ID before any cac: block starts.
    invoiceNumber: firstText(xml.slice(0, indexOfFirstCac(xml)), 'ID'),
  })
}

/**
 * The single gate every parse passes through.
 *
 * Three figures, in euro, that agree with each other to the cent. An e-invoice whose own numbers do
 * not add up is not a better witness than the model — it is a broken document, and treating it as
 * authoritative would be the worst possible outcome of this whole feature.
 */
function complete(v: {
  inc: number | null; ex: number | null; btw: number | null
  currency: string | null; syntax: 'cii' | 'ubl'; invoiceNumber: string | null
}): EInvoiceFigures | null {
  const { inc, ex, btw } = v
  if (inc === null || ex === null || btw === null) return null
  if (![inc, ex, btw].every((n) => Number.isFinite(n))) return null
  // Currency: absent is accepted (some producers omit the attribute), a NON-euro one is not — this
  // app books euro, and silently treating 1 200 SEK as € 1 200 is the kind of error that survives
  // every other check in the building.
  if (v.currency !== null && v.currency.toUpperCase() !== 'EUR') return null
  if (Math.abs(inc) < 0.005) return null
  if (Math.abs(round2(ex + btw) - round2(inc)) > 0.01) return null
  return {
    totalIncBtw: round2(inc),
    totalExBtw: round2(ex),
    btwAmount: round2(btw),
    syntax: v.syntax,
    invoiceNumber: v.invoiceNumber?.trim() || null,
  }
}

// ─── Tag scanning ─────────────────────────────────────────────────────────────
//
// Namespace PREFIXES are chosen by whoever wrote the document — rsm/ram/cbc/cac are conventions,
// not rules, and a producer may bind the same namespace to any prefix it likes. So every match here
// is on the LOCAL name with an optional prefix, never on the prefix itself. A parser that keys on
// "ram:" reads a correct invoice as an empty one.

function localTag(name: string): string {
  return `(?:[A-Za-z0-9_.-]+:)?${name}`
}

/** The inside of the first <name>…</name>, so sibling blocks cannot leak into a header read. */
function firstBlock(xml: string, name: string): string | null {
  const re = new RegExp(`<${localTag(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${localTag(name)}>`, 'i')
  return re.exec(xml)?.[1] ?? null
}

function firstText(xml: string, name: string): string | null {
  const re = new RegExp(`<${localTag(name)}(?:\\s[^>]*)?>([^<]*)</${localTag(name)}>`, 'i')
  const raw = re.exec(xml)?.[1]
  return raw === undefined ? null : decodeXmlEntities(raw).trim()
}

function firstAmount(xml: string, name: string): number | null {
  const raw = firstText(xml, name)
  if (raw === null || raw.trim() === '') return null
  // XML amounts are always '.' decimal with no grouping (EN 16931), so no locale guessing here —
  // guessing is what produces a factor-of-1000 error, and this is the one place we need not.
  const n = Number(raw.trim())
  return Number.isFinite(n) ? n : null
}

function firstCurrency(xml: string, name: string): string | null {
  const re = new RegExp(`<${localTag(name)}\\s[^>]*currencyID\\s*=\\s*"([^"]*)"`, 'i')
  return re.exec(xml)?.[1]?.trim() || null
}

/** Where the first cac: (aggregate) element begins — everything before it is document-level. */
function indexOfFirstCac(xml: string): number {
  const m = /<(?:[A-Za-z0-9_.-]+:)?(?:AccountingSupplierParty|AccountingCustomerParty|InvoiceLine|LegalMonetaryTotal|TaxTotal)[\s>]/i.exec(xml)
  return m ? m.index : xml.length
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Does the supplier's own statement contradict what was read off the page?
 *
 * A cent of tolerance, because the two come from different places and either may be rounded for
 * display. Anything larger is not a rounding difference: it is the document and the reading
 * disagreeing about how much money this is.
 */
export function eInvoiceContradicts(
  figures: EInvoiceFigures,
  readTotalIncBtw: number | null | undefined,
): boolean {
  if (typeof readTotalIncBtw !== 'number' || !Number.isFinite(readTotalIncBtw)) return false
  return Math.abs(Math.abs(readTotalIncBtw) - Math.abs(figures.totalIncBtw)) > 0.01
}

/**
 * The e-invoice verdict stored on the row by the reader, for the gates that must act on it.
 *
 * Mirrors groundingOf/placementOf: field_confidence is jsonb, so every reader validates rather than
 * trusts. `null` means the question could not be asked — never that it was answered "fine".
 */
export function eInvoiceOf(fieldConfidence: unknown): (EInvoiceFigures & { contradicts: boolean }) | null {
  if (!fieldConfidence || typeof fieldConfidence !== 'object') return null
  const e = (fieldConfidence as Record<string, unknown>)._einvoice
  if (!e || typeof e !== 'object') return null
  const o = e as Record<string, unknown>
  const nums = ['totalIncBtw', 'totalExBtw', 'btwAmount'] as const
  if (!nums.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number))) return null
  if (o.syntax !== 'cii' && o.syntax !== 'ubl') return null
  return {
    totalIncBtw: o.totalIncBtw as number,
    totalExBtw: o.totalExBtw as number,
    btwAmount: o.btwAmount as number,
    syntax: o.syntax,
    invoiceNumber: typeof o.invoiceNumber === 'string' ? o.invoiceNumber : null,
    contradicts: o.contradicts === true,
  }
}

/** Does the supplier's own file disagree with what was read? Only `true` blocks; unknown never does. */
export function eInvoiceContradictsRead(fieldConfidence: unknown): boolean {
  return eInvoiceOf(fieldConfidence)?.contradicts === true
}
