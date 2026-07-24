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

import { buildEpcQrPayload, isValidIban, normalizeIban } from "./epc-qr";

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
  const total = invoice.total_inc_btw ?? 0;
  const paid = Math.max(0, invoice.amount_paid ?? 0);
  const amount = paid > 0.005 ? Math.max(0, total - paid) : total;
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

/** Openstaand per invoice: |total| minus what [PARTIAL-PAY] already settled. */
function openAmount(invoice: BetaalverzoekInvoice): number {
  const total = Math.abs(invoice.total_inc_btw ?? 0);
  const paid = Math.max(0, invoice.amount_paid ?? 0);
  return Math.round(Math.max(0, total - paid) * 100) / 100;
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
  const amount = Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100;

  // Reference: EVERY invoice number, comma-separated — exactly the strings
  // bank-matching.referenceMatches() looks for in the incoming bank line.
  const reference = invoices
    .map((inv) => (inv.invoice_number || inv.payment_reference || "").trim())
    .filter(Boolean)
    .join(", ");

  const qr = buildEpcQrPayload({ iban, name: beneficiaryName, amount, reference });
  if (!qr.ok || !qr.payload) {
    return { ok: false, error: qr.error ?? "Geen betaal-QR mogelijk." };
  }

  return { ok: true, epcPayload: qr.payload, beneficiaryName, iban, amount, reference, items };
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
  const totalAmt = invoice.total_inc_btw ?? 0;
  const paidAmt = Math.max(0, invoice.amount_paid ?? 0);
  const settledByInstalments = totalAmt > 0 && paidAmt >= totalAmt - 0.005;
  const alreadyPaid = invoice.status === "paid" || settledByInstalments;
  // A paid invoice still renders (so the customer sees "already paid"), but we must
  // still be able to build the beneficiary/amount block. Build with a payable-status
  // stand-in when it's paid (amount_paid stripped so the shown amount is the
  // full total, matching the status-'paid' rendering), so buildBetaalverzoek's
  // guards don't reject it.
  const probe = alreadyPaid ? { ...invoice, status: "sent", amount_paid: 0 } : invoice;
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

  const remaining = Math.round(
    items.filter((it) => !it.alreadyPaid).reduce((s, it) => s + it.amount, 0) * 100
  ) / 100;
  const alreadyPaid = remaining <= 0;
  // Once everything is settled we still render the view (the "al betaald"
  // banner) — show the settled sum, since asking for €0 is meaningless.
  const amount = alreadyPaid
    ? Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100
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
