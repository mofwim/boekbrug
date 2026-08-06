// src/lib/text-to-pdf.ts
// [MAILTEKST] Turn the text of an e-mail into a PDF, so a body-only invoice becomes a real document.
// Run: npx tsx --test src/lib/text-to-pdf.test.ts
//
// ── WHY A PDF AND NOT "JUST IMPORT THE TEXT" ──
// Three separate reasons, and each on its own would be enough:
//
//   · BEWAARPLICHT. An invoice is a tax document the owner must be able to produce for seven
//     years. "It was in an e-mail we no longer have" is not a document. This gives the accountant
//     and the Belastingdienst something to open.
//   · THE PIPELINE ALREADY WORKS. Every door, every gate, every screen in this app takes a stored
//     file: the byte-hash duplicate gate, the storage write, the verify queue, the evidence
//     package, "Origineel toevoegen", the re-read button. A second kind of invoice with no file
//     behind it would need all of them taught a new case.
//   · THE TEXT LAYER IS THE WITNESS. A PDF built from text HAS a text layer, so [GEGROND] and
//     [DOCCHECK] work on it exactly as on a supplier's own PDF — the total is either in the
//     document's characters or it is not. Import it as a picture and both checks go blind.
//
// ── WHAT IT IS NOT ──
// Not a renderer. It does not reproduce the supplier's layout, colours or logo, and it does not
// pretend to: the header on page one says in plain Dutch that this is the text of a received
// e-mail, so nobody can mistake it for the supplier's own document.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const PAGE = { width: 595.28, height: 841.89 } // A4 in points
const MARGIN = 48
const FONT_SIZE = 10
const LINE_HEIGHT = 13
/** Bounded: a mail with a runaway quoted history must not produce a thousand-page document. */
const MAX_LINES = 2000

/**
 * WinAnsi is what the standard fonts encode, and pdf-lib THROWS on a character outside it. An
 * emoji in a signature would then take down the whole import of that message — so everything
 * unrepresentable becomes a space here, deliberately keeping the position so amounts do not shift
 * into each other.
 *
 * The euro sign survives: it IS in WinAnsi (0x80), and it is the one character on the page that
 * the grounding check needs.
 */
function toWinAnsi(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 32
    if (ch === '€' || ch === '\n') { out += ch; continue }
    // Printable ASCII, and the Latin-1 range the standard fonts cover.
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) { out += ch; continue }
    out += ' '
  }
  return out
}

/** Break a line at the page width, on spaces where possible. */
function wrap(line: string, widthOf: (s: string) => number, maxWidth: number): string[] {
  if (line === '') return ['']
  if (widthOf(line) <= maxWidth) return [line]
  const out: string[] = []
  let current = ''
  for (const word of line.split(' ')) {
    const candidate = current ? `${current} ${word}` : word
    if (widthOf(candidate) <= maxWidth) { current = candidate; continue }
    if (current) out.push(current)
    // A single word wider than the page (a long URL) is cut rather than dropped.
    let rest = word
    while (widthOf(rest) > maxWidth && rest.length > 1) {
      let cut = rest.length
      while (cut > 1 && widthOf(rest.slice(0, cut)) > maxWidth) cut--
      out.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    current = rest
  }
  if (current) out.push(current)
  return out
}

/**
 * An A4 PDF holding this text, with a one-line header saying where it came from.
 *
 * Never throws: a body that cannot be rendered must leave the import exactly as it was rather than
 * take the message down. Returns null in that case, and the caller then treats the mail as it did
 * before this existed.
 */
export async function textToPdf(
  text: string,
  header: { subject: string; from: string; date: string },
): Promise<Buffer | null> {
  try {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const widthOf = (s: string) => font.widthOfTextAtSize(s, FONT_SIZE)
    const maxWidth = PAGE.width - MARGIN * 2

    // Dutch, per AGENTS.md: this is text a user reads. It says plainly what the document is, so a
    // rendered e-mail can never be mistaken for the supplier's own invoice.
    const intro = [
      'Dit is de tekst van een ontvangen e-mail, door BoekBrug bewaard als document.',
      `Onderwerp: ${header.subject || '(geen onderwerp)'}`,
      `Afzender: ${header.from || '(onbekend)'}`,
      `Ontvangen: ${header.date || '(onbekend)'}`,
    ].map(toWinAnsi)

    const bodyLines = toWinAnsi(text).split('\n').slice(0, MAX_LINES)
    const truncated = toWinAnsi(text).split('\n').length > MAX_LINES

    let page = doc.addPage([PAGE.width, PAGE.height])
    let y = PAGE.height - MARGIN

    const draw = (line: string, f = font) => {
      if (y < MARGIN) {
        page = doc.addPage([PAGE.width, PAGE.height])
        y = PAGE.height - MARGIN
      }
      page.drawText(line, { x: MARGIN, y, size: FONT_SIZE, font: f, color: rgb(0, 0, 0) })
      y -= LINE_HEIGHT
    }

    for (const line of intro) for (const part of wrap(line, widthOf, maxWidth)) draw(part, bold)
    y -= LINE_HEIGHT
    for (const line of bodyLines) for (const part of wrap(line, widthOf, maxWidth)) draw(part)
    // Named, never silent: a document that stops mid-invoice must say that it does.
    if (truncated) draw('— de rest van deze e-mail is niet meegenomen (te lang) —', bold)

    return Buffer.from(await doc.save())
  } catch (e) {
    console.error('[MAILTEKST] could not render the e-mail body as a PDF', {
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}
