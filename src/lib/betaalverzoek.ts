// src/lib/betaalverzoek.ts
// [BETAALVERZOEK] Pure logic for the outgoing payment request (anchor gateway #3).
// NO I/O, NO money movement. Two responsibilities, both testable with `npx tsx`:
//
//   1. buildBetaalverzoek(invoice, owner) — decide whether an invoice CAN be turned
//      into a payment request and, if so, produce the EPC/SEPA QR payload + the
//      copy-able payment details (owner's OWN IBAN, amount, invoice number as the
//      reference). Reuses buildEpcQrPayload so the QR is identical in spirit to the
//      pay-a-supplier flow — only the roles flip (the OWNER is now the beneficiary).
//
//   2. toPublicPayView(row) — the SECURITY BOUNDARY for the public /pay/[token]
//      page. It maps a full invoice row down to the MINIMAL set of fields a paying
//      customer needs. Everything else (client email, address, BTW number, internal
//      ids, other invoices) is deliberately dropped here so the public read API can
//      never leak it, even by accident. This is the single allowlist.

import { buildEpcQrPayload, isValidIban, normalizeIban, EPC_REMITTANCE_MAX } from "./epc-qr";
import { round2 } from "./invoice-totals";

// ─── Inputs ────────────────────────────────────────────────────────────────────

/** The invoice fields betaalverzoek logic reads. A subset of the invoices row. */
export interface BetaalverzoekInvoice {
  id: string;
  direction: string | null;
  invoice_type: string | null;
  status: string | null;
  invoice_number: string | null;
  payment_reference: string | null;
  total_inc_btw: number | null;
  // [PARTIAL-PAY] running total already settled by instalments (0/absent when
  // fully open). Both flows request only what is still OPEN: the single-invoice
  // request asks for the REMAINDER (never the full total), and the bundle asks
  // the per-invoice open amount so a half-paid invoice is never over-asked.
  amount_paid?: number | null;
  // [DEEL-CREDIT] What has been given back on this invoice with a creditnota, incl. btw, as a
  // POSITIVE amount. Absent or 0 on an invoice with no credit against it, which is nearly all of
  // them — and then every amount below is exactly what it was before partial credits existed.
  //
  // It is deliberately NOT folded into amount_paid. A credit and a payment both lower what the
  // customer must transfer, and they are opposite facts everywhere else in the app: amount_paid is
  // money that came in, a credit is money that was never owed. Merging them here would put a
  // payment on the books that nobody made.
  credited_inc_btw?: number | null;
  client_name: string | null;
  pay_token: string | null;
  due_date?: string | null;
}

/** The owner's own payout details (from their profile). The beneficiary of the QR. */
export interface BetaalverzoekOwner {
  iban: string | null;
  company_name: string | null;
  full_name: string | null;
}

export interface BetaalverzoekResult {
  ok: boolean;
  error?: string; // Dutch, UI-ready — why no request could be built
  /** EPC069-12 payload to encode into the "Scan om te betalen" QR. */
  epcPayload?: string;
  beneficiaryName?: string; // owner / company name
  iban?: string;            // owner IBAN, canonicalized
  amount?: number;          // EUR incl. BTW
  reference?: string;       // invoice number / betalingskenmerk
}

// ─── Guards ──────────────────────────────────────────────────────────────────

const PAYABLE_TYPES = new Set(["factuur", "creditnota"]);
// A betaalverzoek only makes sense for a real, issued invoice — never a draft
// (no legal number yet), never an offerte/pro_forma (not a demand for payment),
// and not once it's already paid.
const REQUESTABLE_STATUSES = new Set(["sent", "overdue", "processing"]);

/**
 * Build a betaalverzoek for an outgoing invoice, or explain (in Dutch) why not.
 * All the "can we?" rules live here so the API route and the UI agree exactly.
 */
export function buildBetaalverzoek(
  invoice: BetaalverzoekInvoice,
  owner: BetaalverzoekOwner
): BetaalverzoekResult {
  if (invoice.direction !== "outgoing" || !PAYABLE_TYPES.has(invoice.invoice_type ?? "")) {
    return { ok: false, error: "Een betaalverzoek kan alleen voor een uitgaande factuur." };
  }
  if (invoice.status === "draft") {
    return { ok: false, error: "Verstuur de factuur eerst — een concept heeft nog geen definitief nummer." };
  }
  if (invoice.status === "paid") {
    return { ok: false, error: "Deze factuur is al betaald." };
  }
  if (!REQUESTABLE_STATUSES.has(invoice.status ?? "")) {
    return { ok: false, error: "Voor deze factuur kan geen betaalverzoek worden gemaakt." };
  }

  const iban = (owner.iban ?? "").trim();
  if (!isValidIban(iban)) {
    return { ok: false, error: "Vul eerst je eigen IBAN in bij je bedrijfsgegevens — daar wordt de betaling op ontvangen." };
  }

  const beneficiaryName = (owner.company_name || owner.full_name || "").trim();
  if (!beneficiaryName) {
    return { ok: false, error: "Vul eerst je bedrijfsnaam in bij je gegevens." };
  }

  // A creditnota's total is negative (a refund the OWNER owes) — you cannot ask the
  // customer to pay a negative amount. Guard on a strictly-positive amount.
  //
  // [PARTIAL-PAY] Request the REMAINING openstaand, never the full total: a
  // customer who already paid a bank-confirmed €400 instalment on a €1.000
  // invoice must see €600 on the pay page/QR, not the full €1.000 again.
  //
  // [DEEL-CREDIT] The sign guard stays FIRST and separate. openAmount below works in magnitudes
  // (it has to — a payment is a positive figure), so asking it about a creditnota would turn a
  // refund the owner owes into an amount to demand from the customer. The direction is decided
  // here, on the signed total, before any magnitude is taken.
  const total = invoice.total_inc_btw ?? 0;
  if (!Number.isFinite(total) || total <= 0) {
    return { ok: false, error: "Het factuurbedrag is niet geschikt voor een betaalverzoek." };
  }
  // …and only then the remainder: minus instalments, minus what was credited back.
  const amount = openAmount(invoice);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Het factuurbedrag is niet geschikt voor een betaalverzoek." };
  }

  // Reference: the INVOICE NUMBER first. This must be exactly what the
  // reconciliation engine reads back from the incoming bank transaction —
  // bank-matching.referenceMatches() searches ONLY invoice_number, so quoting
  // anything else would not auto-reconcile. payment_reference is a defensive
  // fallback for the (shouldn't-happen) case of a sent invoice with no number.
  const reference = (invoice.invoice_number || invoice.payment_reference || "").trim();

  const qr = buildEpcQrPayload({ iban, name: beneficiaryName, amount, reference });
  if (!qr.ok || !qr.payload) {
    return { ok: false, error: qr.error ?? "Geen betaal-QR mogelijk." };
  }

  return {
    ok: true,
    epcPayload: qr.payload,
    beneficiaryName,
    iban,
    amount,
    reference,
  };
}

// ─── [BUNDEL-BETAALVERZOEK] Several invoices, one payment ───────────────────────

/** Hard cap on invoices per bundle — keeps the combined reference recognisable
 *  and the EPC remittance (140 chars) meaningful. */
export const MAX_BUNDLE_INVOICES = 20;

export interface BundelBetaalverzoekResult extends BetaalverzoekResult {
  /** Per-invoice open amounts, in the order given (only when ok). */
  items?: { invoiceId: string; invoiceNumber: string | null; amount: number }[];
}

/**
 * Openstaand per invoice: |total| minus what [PARTIAL-PAY] already settled and minus what
 * [DEEL-CREDIT] was credited back.
 *
 * This one function decides what the public payment page shows, what the QR asks for, and what a
 * payment request adds up to. So the credit has to come off HERE and nowhere else: a partly
 * credited invoice that kept asking for its full total would have a real customer transferring
 * money the owner had already put in writing they were not owed — from a link that stays live
 * forever.
 */
function openAmount(invoice: BetaalverzoekInvoice): number {
  const total = Math.abs(invoice.total_inc_btw ?? 0);
  const paid = Math.max(0, invoice.amount_paid ?? 0);
  const credited = Math.max(0, invoice.credited_inc_btw ?? 0);
  return round2(Math.max(0, total - paid - credited));
}

/** Case/whitespace-insensitive client key — a bundle is paid by ONE customer. */
function clientKey(name: string | null): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * Build ONE betaalverzoek covering several open invoices of the same customer.
 * Amount = the sum of the open bedragen; reference = every invoice number, so
 * the reconciliation engine (which matches per invoice_number and can book one
 * bank transaction against several invoices via book_bank_batch) closes the
 * whole set when the single payment arrives.
 *
 * All the "can we?" rules live here — the API route and the UI agree exactly.
 */
export function buildBundelBetaalverzoek(
  invoices: BetaalverzoekInvoice[],
  owner: BetaalverzoekOwner
): BundelBetaalverzoekResult {
  if (invoices.length < 2) {
    return { ok: false, error: "Selecteer minimaal twee facturen voor een gebundeld betaalverzoek." };
  }
  if (invoices.length > MAX_BUNDLE_INVOICES) {
    return { ok: false, error: `Maximaal ${MAX_BUNDLE_INVOICES} facturen per betaalverzoek.` };
  }

  // Only real, issued, unpaid VERKOOP-facturen. A creditnota (negative) or
  // offerte in the set would make the sum lie — reject the whole bundle.
  for (const inv of invoices) {
    if (inv.direction !== "outgoing" || (inv.invoice_type ?? "factuur") !== "factuur") {
      return { ok: false, error: "Een gebundeld betaalverzoek kan alleen voor uitgaande facturen (geen creditnota's of offertes)." };
    }
    if (inv.status === "draft") {
      return { ok: false, error: "Verstuur alle facturen eerst — een concept heeft nog geen definitief nummer." };
    }
    if (inv.status === "paid") {
      const nr = inv.invoice_number ? `Factuur ${inv.invoice_number}` : "Een geselecteerde factuur";
      return { ok: false, error: `${nr} is al betaald — haal deze uit de selectie.` };
    }
    if (!REQUESTABLE_STATUSES.has(inv.status ?? "")) {
      return { ok: false, error: "Voor een van de geselecteerde facturen kan geen betaalverzoek worden gemaakt." };
    }
  }

  // ONE customer pays the bundle — mixed clients would send someone another
  // klant's facturen.
  const keys = new Set(invoices.map((i) => clientKey(i.client_name)));
  if (keys.size > 1) {
    return { ok: false, error: "Selecteer facturen van dezelfde klant — één betaalverzoek wordt door één klant betaald." };
  }

  const iban = (owner.iban ?? "").trim();
  if (!isValidIban(iban)) {
    return { ok: false, error: "Vul eerst je eigen IBAN in bij je bedrijfsgegevens — daar wordt de betaling op ontvangen." };
  }
  const beneficiaryName = (owner.company_name || owner.full_name || "").trim();
  if (!beneficiaryName) {
    return { ok: false, error: "Vul eerst je bedrijfsnaam in bij je gegevens." };
  }

  const items = invoices.map((inv) => ({
    invoiceId: inv.id,
    invoiceNumber: inv.invoice_number,
    amount: openAmount(inv),
  }));
  if (items.some((it) => it.amount <= 0)) {
    return { ok: false, error: "Een van de geselecteerde facturen heeft geen openstaand bedrag." };
  }
  const amount = round2(items.reduce((s, it) => s + it.amount, 0));

  // Reference: EVERY invoice number, comma-separated — exactly the strings
  // bank-matching.referenceMatches() looks for in the incoming bank line.
  const reference = invoices
    .map((inv) => (inv.invoice_number || inv.payment_reference || "").trim())
    .filter(Boolean)
    .join(", ");

  // [BUNDEL-REFERENCE-FITS] Every invoice number MUST reach the bank statement, or the payment
  // can never be reconciled to the invoices it settled. The EPC remittance is capped at 140
  // characters and buildEpcQrPayload truncates silently: a 20-invoice bundle fits only ~14
  // numbers, so the customer pays the full sum while quoting a partial list — the batch engine
  // then sums the invoices it CAN see, finds they do not equal the payment, and reports a
  // mismatch that nothing can resolve. Refuse up front, with the number that does fit, instead
  // of minting an unreconcilable request. (MAX_BUNDLE_INVOICES stays the hard ceiling; this is
  // the real, reference-length-driven limit underneath it.)
  if (reference.length > EPC_REMITTANCE_MAX) {
    const fits = countFittingReferences(invoices);
    return {
      ok: false,
      error: `Te veel facturen voor één betaalverzoek: de bank kan maar ${EPC_REMITTANCE_MAX} tekens aan kenmerk meesturen, dus niet alle factuurnummers passen erin. Selecteer er maximaal ${fits} en maak zo nodig een tweede betaalverzoek.`,
    };
  }

  const qr = buildEpcQrPayload({ iban, name: beneficiaryName, amount, reference });
  if (!qr.ok || !qr.payload) {
    return { ok: false, error: qr.error ?? "Geen betaal-QR mogelijk." };
  }

  return { ok: true, epcPayload: qr.payload, beneficiaryName, iban, amount, reference, items };
}

/** How many of these invoices' numbers fit in one EPC remittance, joined by ", ". */
function countFittingReferences(invoices: BetaalverzoekInvoice[]): number {
  let used = 0;
  let n = 0;
  for (const inv of invoices) {
    const num = (inv.invoice_number || inv.payment_reference || "").trim();
    if (!num) continue;
    const add = n === 0 ? num.length : num.length + 2; // ", "
    if (used + add > EPC_REMITTANCE_MAX) break;
    used += add;
    n++;
  }
  return Math.max(1, n);
}

// ─── Public projection (the allowlist) ─────────────────────────────────────────

/** EXACTLY the fields the public /pay page may see. No email, address, BTW, ids. */
export interface PublicPayView {
  invoiceNumber: string | null;
  clientName: string | null;   // "Factuur aan …" — the customer's own name, shown for recognition
  beneficiaryName: string;     // who they pay (owner/company)
  iban: string;                // owner IBAN (formatted for display by the client)
  amount: number;              // EUR incl. BTW
  reference: string;           // what to put in the payment description
  status: string | null;       // so a paid/again view can differ
  dueDate: string | null;
  epcPayload: string;          // to render the QR client-side
  alreadyPaid: boolean;
}

/**
 * Map a full invoice row + owner details → the minimal public view, or null when
 * the invoice isn't payable (draft/paid-type/invalid). Returning null makes the
 * public API respond 404 rather than leak the existence of a non-payable invoice.
 * This is the ONLY place invoice data crosses into the anonymous surface — keep the
 * projection tight.
 */
export function toPublicPayView(
  invoice: BetaalverzoekInvoice,
  owner: BetaalverzoekOwner
): PublicPayView | null {
  // [PARTIAL-PAY] An invoice fully settled by instalments (amount_paid covers
  // the total) may still carry status 'sent' — treat it as paid here so the
  // customer sees "already paid" instead of a €0-request 404.
  // [DEEL-CREDIT] "Nothing left to transfer" now has two causes — instalments and credits — and
  // one function that knows both. A partly credited invoice with the rest already paid must read
  // as settled here, or the customer gets a EUR 0 request and a 404 about their own invoice.
  const totalAmt = invoice.total_inc_btw ?? 0;
  const settledByInstalments = totalAmt > 0 && openAmount(invoice) <= 0.005;
  const alreadyPaid = invoice.status === "paid" || settledByInstalments;
  // A paid invoice still renders (so the customer sees "already paid"), but we must
  // still be able to build the beneficiary/amount block. Build with a payable-status
  // stand-in when it's paid (amount_paid stripped so the shown amount is the
  // full total, matching the status-'paid' rendering), so buildBetaalverzoek's
  // guards don't reject it.
  const probe = alreadyPaid ? { ...invoice, status: "sent", amount_paid: 0, credited_inc_btw: 0 } : invoice;
  const built = buildBetaalverzoek(probe, owner);
  if (!built.ok) return null;

  return {
    invoiceNumber: invoice.invoice_number,
    clientName: invoice.client_name,
    beneficiaryName: built.beneficiaryName!,
    iban: built.iban!,
    amount: built.amount!,
    reference: built.reference!,
    status: invoice.status,
    dueDate: invoice.due_date ?? null,
    epcPayload: built.epcPayload!,
    alreadyPaid,
  };
}

// ─── [BUNDEL-BETAALVERZOEK] Public projection for a bundle ──────────────────────

/** One line of the public bundle view — number + open amount, nothing else. */
export interface PublicPayItem {
  invoiceNumber: string | null;
  amount: number;        // open amount; the invoice magnitude once it's paid
  alreadyPaid: boolean;
  dueDate: string | null;
}

/** The bundle variant of PublicPayView: same allowlist + the per-invoice lines. */
export interface PublicBundlePayView extends PublicPayView {
  items: PublicPayItem[];
}

/**
 * Map the invoices of a bundle + owner details → the minimal public view, or
 * null when the bundle isn't renderable (any draft/foreign/wrong-type invoice,
 * missing IBAN). LIVE semantics: an invoice paid AFTER the link was shared
 * shows as settled and drops out of the amount, so a reopened link always asks
 * exactly what is still open. All invoices paid → alreadyPaid (no new demand).
 */
export function toPublicBundlePayView(
  invoices: BetaalverzoekInvoice[],
  owner: BetaalverzoekOwner
): PublicBundlePayView | null {
  if (invoices.length === 0) return null;

  for (const inv of invoices) {
    if (inv.direction !== "outgoing" || (inv.invoice_type ?? "factuur") !== "factuur") return null;
    if (inv.status !== "paid" && !REQUESTABLE_STATUSES.has(inv.status ?? "")) return null;
  }

  const items: PublicPayItem[] = invoices.map((inv) => {
    const paid = inv.status === "paid";
    return {
      invoiceNumber: inv.invoice_number,
      amount: paid ? Math.abs(inv.total_inc_btw ?? 0) : openAmount(inv),
      alreadyPaid: paid,
      dueDate: inv.due_date ?? null,
    };
  });

  const remaining = round2(
    items.filter((it) => !it.alreadyPaid).reduce((s, it) => s + it.amount, 0));
  const alreadyPaid = remaining <= 0;
  // Once everything is settled we still render the view (the "al betaald"
  // banner) — show the settled sum, since asking for €0 is meaningless.
  const amount = alreadyPaid
    ? round2(items.reduce((s, it) => s + it.amount, 0))
    : remaining;

  // Reference: only the invoices that still need paying — the numbers the
  // customer should quote NOW.
  const openInvoices = alreadyPaid ? invoices : invoices.filter((inv) => inv.status !== "paid");
  const reference = openInvoices
    .map((inv) => (inv.invoice_number || inv.payment_reference || "").trim())
    .filter(Boolean)
    .join(", ");

  const iban = (owner.iban ?? "").trim();
  const beneficiaryName = (owner.company_name || owner.full_name || "").trim();
  const qr = buildEpcQrPayload({ iban, name: beneficiaryName, amount, reference });
  if (!qr.ok || !qr.payload) return null;

  // Earliest due date of the still-open invoices — the honest "pay before".
  const dueDate = openInvoices
    .map((inv) => inv.due_date ?? null)
    .filter((d): d is string => !!d)
    .sort()[0] ?? null;

  return {
    invoiceNumber: null,
    clientName: invoices[0].client_name,
    beneficiaryName,
    iban: normalizeIban(iban),
    amount,
    reference,
    status: alreadyPaid ? "paid" : "sent",
    dueDate,
    epcPayload: qr.payload,
    alreadyPaid,
    items,
  };
}
