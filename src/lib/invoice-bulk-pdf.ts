// src/lib/invoice-bulk-pdf.ts
// [BULK-PDF] Several invoices, one download. Pure — no I/O, no rendering.
// Run: npx tsx --test src/lib/invoice-bulk-pdf.test.ts
//
// ── THE REQUEST ──
//
// "I want to download invoices as pdf, but I have to open each one, open the pdf, and press save —
// far too many steps." Both lists already have multi-select (the bundled betaalverzoek on the sales
// side, bulk pay on the purchase side), so what was missing is not a way to CHOOSE several — it is
// a way to take them away.
//
// This module decides everything about that download except the bytes: how many may go at once,
// what each file is called, and whether the answer is one pdf or an archive.
//
// ── WHY THE NAMES MATTER MORE THAN THEY LOOK ──
//
// A zip of "invoice.pdf, invoice(1).pdf, invoice(2).pdf" is worse than downloading them one by one,
// because now nobody knows which is which. The name is the whole product here: the invoice number
// first, so a file manager sorts the way a bookkeeper reads, then the counterparty.
//
// Collisions are REAL, not theoretical: a draft has no number yet, and two of them would produce
// the same name. The archive would then silently keep one — last write wins in every zip library —
// and the owner would have asked for five invoices and received four, with nothing saying so. So
// names are made unique here, where a test can prove it, and never left to the archive.

/**
 * How many invoices may be downloaded in one go.
 *
 * Not a database limit — a limit on what one request may RENDER. A sales invoice with no stored pdf
 * has to be drawn from its lines, and a hundred of those is already several seconds of work on a
 * serverless function with a ceiling. Above this the owner is told to select fewer, rather than
 * being handed a request that dies halfway with nothing to show for it.
 */
// [TZ-SERVER] De dag van de EIGENAAR voor de bestandsnaam — zie bulkZipName.
import { amsterdamToday } from "./format-nl";

export const BULK_PDF_MAX = 100;

export interface BulkPdfInvoice {
  id: string;
  invoice_number?: string | null;
  client_name?: string | null;
}

export type BulkPdfPlan =
  /** Dutch, owner-facing, and it says what to do next — never just "te veel". */
  | { ok: false; error: string }
  | {
      ok: true;
      /** One invoice → the pdf itself. No archive to unpack for a single file. */
      single: boolean;
      /** id → file name, unique within this download. */
      names: Map<string, string>;
    };

/** Everything a file system dislikes, plus the whitespace runs that come with a company name. */
function safeName(raw: string): string {
  return raw
    // Written as escapes on purpose. Typing these bytes literally into the class works and even
    // compiles, but it makes this a BINARY file to git: no readable diff, no reviewable change,
    // and a merge conflict here becomes all-or-nothing instead of line-by-line. More than one
    // session works on this repo, so that is a real cost for zero benefit.
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function planBulkPdf(invoices: readonly BulkPdfInvoice[]): BulkPdfPlan {
  if (invoices.length === 0) {
    return { ok: false, error: "Selecteer eerst de facturen die je wilt downloaden." };
  }
  if (invoices.length > BULK_PDF_MAX) {
    return {
      ok: false,
      error: `Je kunt er ${BULK_PDF_MAX} tegelijk downloaden. Selecteer er minder en herhaal het daarna voor de rest.`,
    };
  }

  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const inv of invoices) {
    const nummer = safeName(String(inv.invoice_number ?? "").trim());
    const klant = safeName(String(inv.client_name ?? "").trim());
    // Number first: a file manager sorts on it, and that is the order a bookkeeper reads in.
    const base = [nummer || "zonder-nummer", klant].filter(Boolean).join(" - ");
    let name = `${base}.pdf`;
    // A draft has no number, so two of them collide. Left alone the archive keeps ONE of the two
    // and the owner never learns that five became four.
    let n = 2;
    while (used.has(name.toLowerCase())) {
      name = `${base} (${n}).pdf`;
      n += 1;
    }
    used.add(name.toLowerCase());
    names.set(inv.id, name);
  }

  return { ok: true, single: invoices.length === 1, names };
}

/** What the archive itself is called when there is more than one. */
export function bulkZipName(now: Date = new Date()): string {
  // [TZ-SERVER] The OWNER's day. The note that stood here argued for UTC getters because "a local
  // getter answers differently depending on where this runs, and a file name that disagrees with
  // the invoice dates inside it is a small thing that costs trust" — and the second half of that
  // sentence is the argument against the first. The dates INSIDE are Amsterdam dates, so between
  // midnight and 01:00 or 02:00 the UTC name disagreed with every one of them. amsterdamToday() is
  // not a local getter either: it is a fixed timezone, so it does not move with the server.
  return `facturen-${amsterdamToday(now)}.zip`;
}
