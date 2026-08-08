// src/lib/offerte-send.ts
// [OFFERTE-VERSTUREN] May this document be e-mailed to the customer AS A QUOTE? Pure, no I/O.
// Run: npx tsx --test src/lib/offerte-send.test.ts
//
// WHY THIS EXISTS
// The app could not send a quote. Every path through /api/invoice/send either CONVERTS the quote
// into an official factuur (isConversion → a number from the gapless series, Art. 35, no way back),
// converts it without sending, or re-delivers an invoice that already has a number. So the owner's
// only way to get a quote in front of a customer was to turn it into an invoice first — which is
// the opposite of what a quote is for.
//
// WHY A SEPARATE DOOR AND NOT A FLAG ON THE SEND ROUTE
// That route exists to mint numbers: it holds the atomic allocator, the Art. 35 guards, the
// conversion, the CAS on issuance. A boolean threading through it would put "never mint a number"
// one wrong branch away from "mint one", on the one action in this app that cannot be undone.
// A door that CANNOT mint is a stronger guarantee than a door that decides not to.

/** The two spellings invoices.invoice_type accepts for a quote (database.sql CHECK). */
const QUOTE_TYPES = new Set(["pro_forma", "offerte"]);

export interface OfferteSendInput {
  invoiceType: string | null | undefined;
  /** A quote that carries one is not a quote any more — it was converted. */
  invoiceNumber: string | null | undefined;
  clientEmail: string | null | undefined;
  /** Sending an empty document to a customer is worse than not sending. */
  lineCount: number;
}

export type OfferteSendCheck =
  | { ok: true }
  | { ok: false; code: OfferteRefusal; error: string };

export type OfferteRefusal =
  | "not_a_quote"
  | "already_invoice"
  | "no_client_email"
  | "no_lines";

/**
 * Decide whether this document may go out as a quote.
 *
 * Every refusal has its OWN code and its own Dutch sentence: the four reasons need four different
 * actions from the owner, and "versturen mislukt" would leave them guessing which one they hit.
 */
export function checkOfferteSendable(input: OfferteSendInput): OfferteSendCheck {
  const type = (input.invoiceType ?? "").trim();
  if (!QUOTE_TYPES.has(type)) {
    return {
      ok: false,
      code: "not_a_quote",
      error: "Dit is geen offerte. Een factuur verstuur je via de factuurknop.",
    };
  }
  // A number means the send route already converted it. Mailing it as a quote afterwards would put
  // a document in the customer's inbox that says "vrijblijvend" while the books hold an issued,
  // numbered invoice for the same work.
  if ((input.invoiceNumber ?? "").trim().length > 0) {
    return {
      ok: false,
      code: "already_invoice",
      error: "Deze offerte is al omgezet naar een factuur en kan niet meer als offerte worden verstuurd.",
    };
  }
  if (!isPlausibleEmail(input.clientEmail)) {
    return {
      ok: false,
      code: "no_client_email",
      error: "Vul eerst een e-mailadres van de klant in — daar sturen we de offerte naartoe.",
    };
  }
  if (!Number.isFinite(input.lineCount) || input.lineCount < 1) {
    return {
      ok: false,
      code: "no_lines",
      error: "Deze offerte heeft nog geen regels. Vul ze in voordat je hem verstuurt.",
    };
  }
  return { ok: true };
}

/**
 * Enough of an address to be worth attempting.
 *
 * Deliberately loose: the mail provider is the real judge, and a stricter pattern here would refuse
 * valid addresses (plus-tags, long TLDs, IDN) that Resend delivers without complaint. What this
 * catches is the empty field and the obvious typo — the cases where attempting a send would only
 * produce a bounce the owner has to interpret.
 */
function isPlausibleEmail(value: string | null | undefined): boolean {
  const s = (value ?? "").trim();
  if (s.length < 5 || /\s/.test(s)) return false;
  const at = s.indexOf("@");
  if (at < 1 || at !== s.lastIndexOf("@")) return false;
  const domain = s.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

/**
 * The subject line for the e-mail.
 *
 * The company name, because a quote arrives at someone who asked several suppliers the same
 * question and needs to see whose it is before opening anything.
 */
export function offerteSubject(senderName: string): string {
  const name = (senderName ?? "").trim();
  return name ? `Offerte van ${name}` : "Offerte";
}

/** What to call the attachment. Not "factuur-…", which is what it is not. */
export function offerteFileName(clientName: string | null | undefined, dateIso: string | null | undefined): string {
  const safe = (clientName ?? "").trim().replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const date = (dateIso ?? "").trim().slice(0, 10);
  return ["offerte", safe || null, date || null].filter(Boolean).join("-") + ".pdf";
}
