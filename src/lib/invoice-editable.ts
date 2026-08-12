// src/lib/invoice-editable.ts
// [OFFERTE-BEWERKBAAR] May this document still be changed? Pure, no I/O.
// Run: npx tsx --test src/lib/invoice-editable.test.ts
//
// WHY THIS IS A FILE AND NOT AN `if`
// The rule was `status === 'draft'`, written once in the screen and once in the route. That is the
// right rule for a FACTUUR and the wrong one for an OFFERTE, and the difference matters in both
// directions:
//
//   · A factuur that has been sent carries a legal number from a gapless series (Art. 35 Wet OB,
//     forward-only). Editing it is not a correction, it is rewriting a document someone already
//     has — that is what a creditnota is for. This must stay impossible.
//   · An offerte is a PRICE QUOTE. It has no number, it is in no series, it is not a legal
//     invoice, and the Belastingdienst does not count it. A customer asking "can you do it for
//     less?" is the ordinary course of business — and until now, an offerte that had been sent
//     could not be touched. The owner's only route was to make a second one and hope the customer
//     looked at the right one.
//
// So the two questions were being answered by one flag, and the quote inherited the invoice's
// restrictions for no reason anyone had chosen.

/** The invoice_type values that mean "this is a quote, not an invoice". */
const QUOTE_TYPES = new Set(["pro_forma", "offerte"]);

/** Is this document a quote rather than a legal invoice? */
export function isQuote(invoiceType: string | null | undefined): boolean {
  return QUOTE_TYPES.has((invoiceType ?? "").trim());
}

export interface EditableInput {
  /** invoices.status */
  status: string | null | undefined;
  /** invoices.invoice_type */
  invoiceType: string | null | undefined;
  /** invoices.invoice_number — the thing that makes a document legally issued. */
  invoiceNumber: string | null | undefined;
}

/**
 * May this document still be edited?
 *
 * A draft is editable, as before. A QUOTE is editable for as long as it is still a quote — which
 * is exactly the owner's own rule: change it until you turn it into an invoice.
 *
 * THE SECOND CONDITION IS NOT REDUNDANT. A quote is editable only while it carries NO number.
 * Sending a quote CONVERTS it (see /api/invoice/send: `isConversion` → invoice_type becomes
 * 'factuur'), so after conversion the type alone would already refuse. But a row that somehow
 * holds a number while still typed as a quote is a legally issued document whatever its type says,
 * and the one thing this function may never do is open one of those for editing. Two conditions,
 * so no single wrong field can unlock a numbered document.
 */
export function isInvoiceEditable(input: EditableInput): boolean {
  const status = (input.status ?? "").trim();
  const number = (input.invoiceNumber ?? "").trim();

  if (status === "draft") return true;
  return isQuote(input.invoiceType) && number.length === 0;
}

/**
 * Why an edit was refused, in Dutch, for the owner.
 *
 * Never a bare "niet toegestaan": the two reasons need different actions from the owner, and
 * telling them which one they hit is the difference between "make a creditnota" and "you are
 * looking at the wrong row".
 */
export function editRefusalText(input: EditableInput): string {
  if (isInvoiceEditable(input)) return "";
  if (isQuote(input.invoiceType)) {
    return "Deze offerte heeft al een factuurnummer gekregen en telt daarmee als verstuurde factuur. Corrigeer hem met een creditnota.";
  }
  return "Een verstuurde factuur kan niet meer worden gewijzigd. Corrigeer hem met een creditnota.";
}

// ─── [HERSTEL] Editing a SENT invoice — the market rule, with the locks that keep it honest ─────
//
// The owner's decision, after the legal picture was on the table: BoekBrug follows what the
// Dutch market (Moneybird et al.) already does. A sent invoice MAY be edited in full — same
// number, PDF regenerated, the customer automatically receives the corrected version with a
// sentence saying it replaces the earlier one — for as long as NOTHING ELSE has attached itself
// to that invoice. The moment money or the Belastingdienst has seen it, editing stops being a
// correction and becomes rewriting history someone else already booked:
//
//   · a payment (full or partial, bank or kas) — the amount is now also a fact in a bank
//     statement that will never change with it;
//   · a filed BTW-aangifte covering its date — the figures went to the Belastingdienst; the
//     document behind them may not shift afterwards (that is what a suppletie is for);
//   · a creditnota — the correction already happened, in the other legal shape;
//   · an accountant who marked it verwerkt — it is in someone else's books now.
//
// After any of those: creditnota, as before. The NUMBER is never editable in any state — the
// gapless series (Art. 35 Wet OB) is the one thing both routes protect.
//
// Pure: the route gathers the facts, this function only decides. `null` for a fact means "could
// not be established" and BLOCKS ([LOCK-READ-HONEST]): a database hiccup is not evidence that
// nothing is attached.

export interface SentEditFacts {
  status: string | null | undefined;
  invoiceType: string | null | undefined;
  invoiceNumber: string | null | undefined;
  /** invoices.direction — only the owner's own OUTGOING invoices qualify. */
  direction: string | null | undefined;
  /** Total already settled on this invoice. null = could not read → blocked. */
  amountPaid: number | null;
  /** A bank transaction or split allocation points at this invoice. null = unknown → blocked. */
  hasBankLink: boolean | null;
  /** A kas entry books a payment on this invoice. null = unknown → blocked. */
  hasCashLink: boolean | null;
  /** A creditnota references this invoice. null = unknown → blocked. */
  hasCreditnota: boolean | null;
  /** invoices.accountant_status — 'verwerkt' freezes the row. */
  accountantStatus: string | null | undefined;
  /**
   * Is the quarter of the CURRENT invoice_date — and, when the edit moves the date, of the NEW
   * one — covered by a filed aangifte (btw_filings)? null = the check itself failed → blocked.
   * A database where btw_filings does not exist yet is `false` (nothing was ever filed), not null.
   */
  quarterFiled: boolean | null;
}

/** One refusal: a stable code for the screen, a Dutch sentence for the API response. */
export interface SentEditBlocker {
  code:
    | "not-sent"
    | "not-invoice"
    | "incoming"
    | "paid"
    | "bank-linked"
    | "cash-linked"
    | "credited"
    | "accountant"
    | "quarter-filed"
    | "unknown";
  text: string;
}

/** The statuses in which an issued factuur is still "out and unanswered". */
const SENT_EDITABLE_STATUSES = new Set(["sent", "overdue"]);

/**
 * Every reason this sent invoice may NOT be edited, in the order the owner should hear them.
 * Empty array = the edit may proceed (and the customer will be told).
 */
export function sentEditBlockers(f: SentEditFacts): SentEditBlocker[] {
  const out: SentEditBlocker[] = [];
  const status = (f.status ?? "").trim();
  const number = (f.invoiceNumber ?? "").trim();

  if ((f.invoiceType ?? "").trim() !== "factuur" || number.length === 0) {
    out.push({
      code: "not-invoice",
      text: "Alleen een verstuurde factuur met een nummer kan zo worden hersteld.",
    });
  }
  if (f.direction === "incoming") {
    out.push({
      code: "incoming",
      text: "Een inkomende factuur is het document van je leverancier — corrigeer de lezing ervan, niet het document.",
    });
  }
  if (!SENT_EDITABLE_STATUSES.has(status)) {
    out.push({
      code: status === "paid" ? "paid" : "not-sent",
      text:
        status === "paid"
          ? "Deze factuur is al betaald — corrigeer hem met een creditnota."
          : "Alleen een verstuurde, nog openstaande factuur kan worden hersteld.",
    });
  }
  if (f.amountPaid === null) {
    out.push({ code: "unknown", text: "We konden de betalingen op deze factuur niet controleren — probeer het zo meteen opnieuw." });
  } else if (f.amountPaid > 0.005) {
    out.push({
      code: "paid",
      text: "Er is al (deels) op deze factuur betaald — het bedrag is nu ook een feit in een bankafschrift. Corrigeer met een creditnota.",
    });
  }
  if (f.hasBankLink === null) {
    out.push({ code: "unknown", text: "We konden de bankkoppelingen van deze factuur niet controleren — probeer het zo meteen opnieuw." });
  } else if (f.hasBankLink) {
    out.push({
      code: "bank-linked",
      text: "Deze factuur is al aan een banktransactie gekoppeld. Ontkoppel die eerst op de Bank-pagina, of corrigeer met een creditnota.",
    });
  }
  if (f.hasCashLink === null) {
    out.push({ code: "unknown", text: "We konden het kasboek niet controleren — probeer het zo meteen opnieuw." });
  } else if (f.hasCashLink) {
    out.push({
      code: "cash-linked",
      text: "Er staat een kasboeking op deze factuur — corrigeer met een creditnota.",
    });
  }
  if (f.hasCreditnota === null) {
    out.push({ code: "unknown", text: "We konden niet controleren of er al een creditnota bestaat — probeer het zo meteen opnieuw." });
  } else if (f.hasCreditnota) {
    out.push({
      code: "credited",
      text: "Er bestaat al een creditnota voor deze factuur — de correctie is al gedaan, in die vorm.",
    });
  }
  if ((f.accountantStatus ?? "").trim() === "verwerkt") {
    out.push({
      code: "accountant",
      text: "Je boekhouder heeft deze factuur al verwerkt — hij staat in andermans boeken. Corrigeer met een creditnota.",
    });
  }
  if (f.quarterFiled === null) {
    out.push({ code: "unknown", text: "We konden niet nagaan of dit kwartaal al is ingediend — probeer het zo meteen opnieuw." });
  } else if (f.quarterFiled) {
    out.push({
      code: "quarter-filed",
      text: "Het kwartaal van deze factuur is al bij de Belastingdienst ingediend — de cijfers erachter mogen niet meer schuiven. Corrigeer met een creditnota.",
    });
  }
  return out;
}
