// src/lib/vat-statement.ts
// [BTW-VERKLARING] Why this invoice charges no btw, in one sentence on the document. Pure, no I/O.
// Run: npx tsx --test src/lib/vat-statement.test.ts
//
// WHAT WAS MEASURED
// Four invoices were rendered, all with EUR 0,00 btw, and three of them printed text that was
// character-for-character identical:
//
//     KOR-ondernemer                 (nothing)
//     vrijgestelde prestatie         (nothing)
//     0% zonder reden                (nothing)
//     btw verlegd, EU-afnemer        "Btw verlegd — intracommunautaire prestatie. …"
//
// So three different legal situations produced one document. A customer receives EUR 1.000 with no
// btw and nothing on the page saying why; their bookkeeper cannot classify it and may well assume
// it was verlegd, which it was not.
//
// The exempt case is the sharpest. This product OFFERS the choice — the create screen has a
// "Vrijgesteld" option, gated on the owner's own declaration — and then never mentions it on the
// document. Art. 35a wants an invoice for an exempt supply to make the exemption visible; the word
// "vrijgesteld" appeared zero times in invoice-pdf.tsx.
//
// WHAT THE APP CAN AND CANNOT KNOW, WHICH IS THE WHOLE DESIGN
//
//   · KOR — the app KNOWS. profiles.kor_active is a fact it holds, so the sentence is automatic.
//   · Vrijgesteld — the app knows THAT, never WHICH. The exemptions live in art. 11 Wet OB and the
//     applicable one depends on the trade: education, care, insurance, and so on each have their
//     own provision. Guessing one and printing it would put a false legal ground on a customer's
//     invoice, which is worse than the silence it replaces. So the owner writes their own line
//     once, in Instellingen, and every invoice carries it.
//   · Plain 0% — the app knows nothing at all. Export, intra-EU goods and several services are all
//     0%, and which one applies is not derivable from anything stored. Without the owner's own
//     note this stays silent ON PURPOSE: inventing a ground is the one outcome worse than none.
//
// The reverse-charge sentence is NOT produced here. icp.ts already derives it from the customer's
// EU VAT number, and it is the one case the app can prove. This module never speaks over it.

/** The note lives on the profile and is free text, so it needs a ceiling before it reaches a PDF. */
export const MAX_NOTE_LENGTH = 200;

export interface VatStatementLine {
  vat_treatment?: string | null;
}

export interface VatStatementArgs {
  /** 'factuur' | 'creditnota' | 'pro_forma' | 'offerte'. */
  invoiceType?: string | null;
  /** The document's own btw. Anything non-zero means btw WAS charged and nothing is explained. */
  btwAmount?: number | null;
  korActive?: boolean | null;
  lines?: readonly VatStatementLine[] | null;
  /** The owner's own sentence from Instellingen. Empty when they have not written one. */
  note?: string | null;
  /** True when icp.ts already put the reverse-charge sentence on the page. */
  reverseChargeStated?: boolean;
}

/** Only the literal flag counts — the same hardening every other reader of this column applies. */
function hasExemptLine(lines: readonly VatStatementLine[] | null | undefined): boolean {
  return (lines ?? []).some((l) => l?.vat_treatment === "exempt");
}

/** Free text on its way to a customer's document: one line, trimmed, bounded. */
export function cleanVatNote(note: string | null | undefined): string {
  const s = String(note ?? "").replace(/\s+/g, " ").trim();
  return s.length > MAX_NOTE_LENGTH ? s.slice(0, MAX_NOTE_LENGTH).trimEnd() : s;
}

/**
 * The sentence explaining why no btw is charged, or null when there is nothing to explain.
 *
 * Null in three situations, and each is deliberate: btw WAS charged (so the rate rows say it all),
 * the reverse-charge line already said it, or the app genuinely does not know and the owner has
 * not told it.
 */
export function vatStatement(args: VatStatementArgs): string | null {
  // A quote is not a legal invoice and carries no btw statement — the same boundary
  // reverseChargeNotice draws, and the two must not disagree about it.
  const type = args.invoiceType ?? "factuur";
  if (type !== "factuur" && type !== "creditnota") return null;

  // Btw on the document means there is nothing to explain: the per-rate rows already say what was
  // charged and at which rate.
  if (Math.abs(Number(args.btwAmount) || 0) >= 0.005) return null;

  // Never speak over icp.ts. Two sentences claiming different reasons for one zero is worse than
  // either of them alone.
  if (args.reverseChargeStated) return null;

  const note = cleanVatNote(args.note);

  // KOR first: it is the regime of the whole business, so it outranks anything on a single line.
  // The owner's note is not appended — the scheme is its own complete explanation, and a second
  // sentence about an exemption would contradict it.
  if (args.korActive) {
    return "Geen btw in rekening gebracht: kleineondernemersregeling (KOR).";
  }

  if (hasExemptLine(args.lines)) {
    // The owner's own wording when they have written one; otherwise the true part of it. "This is
    // exempt" without the provision is incomplete, but it is not false, and it is a great deal
    // more than a customer could previously read.
    return note || "Vrijgesteld van btw.";
  }

  // Plain 0%. The app has no basis for a reason, so it says only what the owner has told it to.
  return note || null;
}
