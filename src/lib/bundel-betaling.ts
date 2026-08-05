// src/lib/bundel-betaling.ts
// [BUNDEL-BETALING] Pure logic for paying SEVERAL incoming (supplier) invoices
// in ONE transfer — the mirror of the outgoing bundel-betaalverzoek. The owner
// selects open inkoopfacturen of the same leverancier and gets ONE EPC/SEPA QR:
// beneficiary = the SUPPLIER's IBAN, amount = the sum of the open bedragen,
// reference = every kenmerk/factuurnummer. NO I/O, NO money movement — exactly
// like PreparePaymentSheet, this only pre-fills a transfer the owner confirms
// inside their OWN bank app. Testable with `npx tsx`.
//
// Identity rule: the bundle is keyed on the supplier's IBAN, not the name. OCR
// spells a vendor name three different ways, but the money can only go to ONE
// account — invoices whose vendor_iban differs (or is missing/invalid) never
// share a bundle, so a batch can never silently pay the wrong party.

import { buildEpcQrPayload, isValidIban, normalizeIban, EPC_REMITTANCE_MAX } from "./epc-qr";
// [CREDIT-SAFE] The one answer to "is this a debt?" that the whole money line shares.
import { creditStance, payableAsDebt } from "./creditnota-signal";

/** The incoming-invoice fields the bundle logic reads. A subset of the row. */
export interface BundelBetalingInvoice {
  id: string;
  status: string | null;                 // must be 'received' (open, te betalen)
  invoice_number: string | null;
  payment_reference: string | null;      // betalingskenmerk — preferred reference
  client_name: string | null;            // supplier/vendor name (the beneficiary)
  vendor_iban: string | null;            // the account the money goes TO
  total_inc_btw: number | null;
  amount_paid?: number | null;           // [PARTIAL-PAY] already settled
  // [CREDIT-SAFE] Needed to tell a DEBT from a CREDIT. A creditnota from a supplier is also
  // 'received' and also has an open balance — and openAmount() takes |total|, so without this it
  // joins the transfer as a positive amount and the owner pays MORE, by twice its value.
  invoice_type?: string | null;
}

export interface BundelBetalingResult {
  ok: boolean;
  error?: string;            // Dutch, UI-ready — why no bundle could be built
  epcPayload?: string;       // EPC069-12 payload for the one QR
  beneficiaryName?: string;  // supplier name
  iban?: string;             // supplier IBAN, canonicalized
  amount?: number;           // EUR — sum of the open amounts
  reference?: string;        // every kenmerk/invoice number, comma-separated
  /** Per-invoice open amounts, in the order given (only when ok). */
  items?: { invoiceId: string; invoiceNumber: string | null; amount: number }[];
}

/** Same cap as the outgoing bundle — keeps the reference recognisable within
 *  the EPC remittance limit (140 chars). */
export const MAX_BUNDEL_BETALING = 20;

/** Openstaand per invoice: |total| minus what [PARTIAL-PAY] already settled. */
function openAmount(invoice: BundelBetalingInvoice): number {
  const total = Math.abs(invoice.total_inc_btw ?? 0);
  const paid = Math.max(0, invoice.amount_paid ?? 0);
  return Math.round(Math.max(0, total - paid) * 100) / 100;
}

/**
 * Build ONE payment preparation covering several open supplier invoices, or
 * explain (in Dutch) why not. All the "can we?" rules live here so the UI and
 * any future API route agree exactly.
 */
export function buildBundelBetaling(
  invoices: BundelBetalingInvoice[]
): BundelBetalingResult {
  if (invoices.length < 2) {
    return { ok: false, error: "Selecteer minimaal twee inkoopfacturen om samen te betalen." };
  }
  if (invoices.length > MAX_BUNDEL_BETALING) {
    return { ok: false, error: `Maximaal ${MAX_BUNDEL_BETALING} facturen per betaling.` };
  }

  for (const inv of invoices) {
    if (inv.status !== "received") {
      const nr = inv.invoice_number ? `Factuur ${inv.invoice_number}` : "Een geselecteerde factuur";
      return { ok: false, error: `${nr} staat niet open als te betalen.` };
    }
    // [CREDIT-SAFE] A creditnota is money coming BACK, and it must never join a transfer.
    //
    // The one guard that could have caught this — `items.some(it => it.amount <= 0)` below — is
    // defeated two functions up: openAmount takes Math.abs(total), so a credit of € 51,80 arrives
    // as a POSITIVE € 51,80, passes the check, and is ADDED to the total. The owner transfers
    // € 103,60 more than they owe: once for not subtracting it, once for adding it.
    //
    // Refused rather than silently dropped. The screen says "3 geselecteerd" over the rows the
    // owner picked; quietly paying two of them would make the count and the money disagree, and
    // this is the screen where that difference IS the product.
    if (!payableAsDebt(creditStance({
      invoiceNumber: inv.invoice_number,
      totalIncBtw: inv.total_inc_btw,
      invoiceType: inv.invoice_type ?? null,
      vendorNumbers: [],
    }))) {
      const nr = inv.invoice_number ? `Factuur ${inv.invoice_number}` : "Een geselecteerde regel";
      return {
        ok: false,
        error: `${nr} is een creditnota — dat geld komt naar je toe. Haal hem uit de selectie; hij gaat vanzelf van je openstaande saldo af.`,
      };
    }
  }

  // ONE beneficiary account. Every invoice must carry the SAME valid IBAN —
  // a missing IBAN can't prove it belongs to the same supplier, so it's out.
  const ibans = invoices.map((inv) => inv.vendor_iban);
  if (ibans.some((i) => !isValidIban(i))) {
    return { ok: false, error: "Niet elke geselecteerde factuur heeft een geldig IBAN — betaal die factuur apart via de PDF." };
  }
  const normalized = new Set(ibans.map((i) => normalizeIban(i ?? "")));
  if (normalized.size > 1) {
    return { ok: false, error: "Selecteer facturen van dezelfde leverancier (zelfde IBAN) — één betaling gaat naar één rekening." };
  }
  const iban = normalizeIban(ibans[0] ?? "");

  const beneficiaryName = invoices
    .map((inv) => (inv.client_name ?? "").trim())
    .find(Boolean) ?? "";
  if (!beneficiaryName) {
    return { ok: false, error: "De leveranciersnaam ontbreekt — geen QR mogelijk." };
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

  // Reference: betalingskenmerk when present, else the invoice number — per
  // invoice, comma-separated. These are the strings the supplier's own
  // reconciliation AND our bank-import read back from the single debit.
  const reference = invoices
    .map((inv) => (inv.payment_reference || inv.invoice_number || "").trim())
    .filter(Boolean)
    .join(", ");

  // [BUNDEL-REFERENCE-FITS] Mirror of the outgoing rule: every kenmerk must reach the bank
  // statement or the debit can never be reconciled to the invoices it paid. The EPC remittance
  // is capped at 140 characters and the payload builder truncates SILENTLY, so a bundle whose
  // references do not fit would produce a payment quoting only part of the set. Refuse up front.
  if (reference.length > EPC_REMITTANCE_MAX) {
    let used = 0, fits = 0;
    for (const inv of invoices) {
      const num = (inv.payment_reference || inv.invoice_number || "").trim();
      if (!num) continue;
      const add = fits === 0 ? num.length : num.length + 2;
      if (used + add > EPC_REMITTANCE_MAX) break;
      used += add; fits++;
    }
    return {
      ok: false,
      error: `Te veel facturen voor \u00e9\u00e9n betaling: de bank kan maar ${EPC_REMITTANCE_MAX} tekens aan kenmerk meesturen, dus niet alle factuurnummers passen erin. Selecteer er maximaal ${Math.max(1, fits)} en betaal de rest in een tweede overboeking.`,
    };
  }

  const qr = buildEpcQrPayload({ iban, name: beneficiaryName, amount, reference });
  if (!qr.ok || !qr.payload) {
    return { ok: false, error: qr.error ?? "Geen betaal-QR mogelijk." };
  }

  return { ok: true, epcPayload: qr.payload, beneficiaryName, iban, amount, reference, items };
}
