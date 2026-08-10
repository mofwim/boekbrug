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

  // Never speak over icp.ts. Two sentences claiming different reasons for one zero is worse than
  // either of them alone.
  if (args.reverseChargeStated) return null;

  const note = cleanVatNote(args.note);
  const btwCharged = Math.abs(Number(args.btwAmount) || 0) >= 0.005;

  // ── [BTW-VERKLARING-GEMENGD] The exempt branch is asked BEFORE "was any btw charged" ──
  //
  // The zero-btw short-circuit used to stand above everything, and it is right for the two
  // questions below it: "why is there no btw at all" only has an answer when there is no btw at
  // all. It is the wrong question for an EXEMPT LINE, which is a fact about that line and not
  // about the document's total.
  //
  // Rendered and read back with pdfjs, a caterer's invoice — EUR 500 of food at 9% plus a EUR 500
  // food-safety course exempt under art. 11 — carried EUR 45 of btw, so the guard returned null
  // and the page said nothing at all about the exempt half. The all-exempt invoice beside it was
  // correct. It is not a rare shape: a physiotherapist selling taxed products beside exempt
  // treatment, a school with taxed catering, any trade that does both.
  //
  // Art. 35a lid 1 sub k asks for the reference on the invoice that carries the exempt supply,
  // not only on invoices that carry nothing else.
  if (hasExemptLine(args.lines)) {
    // KOR outranks it — see below — so that case is left to the branch that owns it.
    if (!args.korActive) {
      // The owner's own wording when they have written one; otherwise the true part of it. "This
      // is exempt" without the provision is incomplete, but it is not false, and it is a great
      // deal more than a customer could previously read.
      //
      // When the invoice ALSO charges btw, the sentence has to say that it is about part of it.
      // A bare "Vrijgesteld van btw." above a total with EUR 45 of btw in it reads as a claim
      // about the whole document, and a bookkeeper would be right to disbelieve one of the two.
      //
      // Without a note the scope sentence IS the whole statement — gluing the fallback onto it
      // produced "Een deel van dit bedrag is vrijgesteld van btw: vrijgesteld van btw.", which is
      // how a template reads when nobody rendered it.
      if (!btwCharged) return note || "Vrijgesteld van btw.";
      return note
        ? `Een deel van dit bedrag is vrijgesteld van btw: ${lowerFirst(note)}`
        : "Een deel van dit bedrag is vrijgesteld van btw.";
    }
  }

  // Btw on the document means there is nothing further to explain: the per-rate rows already say
  // what was charged and at which rate.
  if (btwCharged) return null;

  // KOR: it is the regime of the whole business, so it outranks anything on a single line. The
  // owner's note is not appended — the scheme is its own complete explanation, and a second
  // sentence about an exemption would contradict it.
  if (args.korActive) {
    return "Geen btw in rekening gebracht: kleineondernemersregeling (KOR).";
  }

  // Plain 0%. The app has no basis for a reason, so it says only what the owner has told it to.
  return note || null;
}

/** "Vrijgesteld van btw." → "vrijgesteld van btw." — it becomes the tail of a longer sentence. */
function lowerFirst(s: string): string {
  return s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s;
}
