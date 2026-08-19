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
//
// ── [CREDIT-VERREKEN] A SUPPLIER CREDIT IS SETTLED BY DEDUCTING IT ─────────────────────────────
//
// A wholesaler who takes goods back sends a creditnota and expects it OFF the next payment. That
// is how it is done in this trade: you transfer the difference and you name both documents in the
// description, so their administration knows which credit you applied. Reported with the screen
// open on exactly that: an invoice of € 1.764,76 and a credit of € 52,38 from the same supplier,
// selected together, refused with "haal hem uit de selectie".
//
// The refusal was right for what the code did — the credit would have been ADDED (openAmount takes
// a magnitude), so the owner paid twice its value too much. It was wrong as an answer: the thing
// the owner asked for is ordinary, and "do it outside the app" is not a feature.
//
// So a creditnota may now join a bundle, and it SUBTRACTS. Four things make that safe:
//
//   1. Only a row that IS a credit. creditStance has four answers and only 'credit' — the sign and
//      the type agreeing — may be netted. A row typed creditnota while its money sits positive
//      ('conflict') is the app contradicting itself, and one the supplier's NUMBERING hints at
//      ('suspected') is a guess nobody confirmed. Netting on a guess pays too little, the supplier
//      dunts for the rest, and the owner has no way to see why.
//   2. Only from the SAME supplier. A credit from another vendor deducted here underpays this one.
//      The IBAN decides it whenever the credit has one. A creditnota often carries no IBAN at all —
//      there is nothing to pay on it — and then the vendor NAME must match (counterpartKey, the key
//      the bank screens already use for "same party"). No IBAN and no matching name is a refusal.
//   3. Never a payment of nothing or less. Once the credits are worth more than the invoices there
//      is no transfer to make, and the answer says so instead of building a QR for € 0,00.
//   4. Both numbers reach the bank. The reference names the invoices, then "-/-", then the credits —
//      the notation a Dutch creditor administration reads as a deduction. It counts against the same
//      140-character EPC limit as everything else, so a set whose references do not fit is refused
//      rather than silently truncated.
//
// What this module still does NOT do is move money or mark anything settled. The owner confirms the
// transfer in their own bank, and the screen then marks every row in the bundle — the credit
// included, which is what stops it from being deducted a second time next month.
//
// That settle step books each row in FULL (pay-toggle → apply_manual_payment, which takes
// abs(total_inc_btw), so a creditnota closes at its own value). This module deducts each credit in
// full for exactly that reason: a partial deduction here would leave a remainder the settle step
// cannot express, and the two would drift apart on the one screen where they must not.

import { buildEpcQrPayload, isValidIban, normalizeIban, EPC_REMITTANCE_MAX } from "./epc-qr";
import { paymentReferenceFor } from "./payment-reference";
// [CREDIT-SAFE] The one answer to "is this a debt?" that the whole money line shares.
import { creditStance, payableAsDebt } from "./creditnota-signal";
// [CREDIT-VERREKEN] The app's existing "is this the same party?" key — it strips punctuation and
// legal suffixes, so "Enka Horeca B.V." and "ENKA HORECA BV" are one supplier. Used here only for
// a creditnota that carries no IBAN of its own; see the header note.
import { counterpartKey } from "./bank-identity";
import { round2 } from "./invoice-totals";

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
  /**
   * Per-invoice open amounts: the invoices first, then the creditnota's, which carry a NEGATIVE
   * amount because that is what they do to the transfer. Only when ok.
   *
   * [CREDIT-VERREKEN] Signed rather than absolute, so the screen can show the deduction as a
   * deduction. A sheet listing "€ 52,38" under an invoice of "€ 1.764,76" over a total of
   * "€ 1.712,38" is a document that does not add up in front of the owner.
   */
  items?: { invoiceId: string; invoiceNumber: string | null; amount: number }[];
  /** Sum of the invoices, before the credits come off. Only when ok and something was deducted. */
  debtTotal?: number;
  /** What the creditnota's take off, as a POSITIVE number. Only when ok and > 0. */
  creditTotal?: number;
}

/** Same cap as the outgoing bundle — keeps the reference recognisable within
 *  the EPC remittance limit (140 chars). */
export const MAX_BUNDEL_BETALING = 20;

/** Openstaand per invoice: |total| minus what [PARTIAL-PAY] already settled. */
function openAmount(invoice: BundelBetalingInvoice): number {
  const total = Math.abs(invoice.total_inc_btw ?? 0);
  const paid = Math.max(0, invoice.amount_paid ?? 0);
  return round2(Math.max(0, total - paid));
}

/**
 * Build ONE payment preparation covering several open supplier invoices, or
 * explain (in Dutch) why not. All the "can we?" rules live here so the UI and
 * any future API route agree exactly.
 */
export function buildBundelBetaling(
  invoices: BundelBetalingInvoice[],
  /**
   * [CREDIT-VERREKEN] Every document number known from this supplier, for the 'suspected' state.
   *
   * A credit note booked as an ordinary debt can only be recognised by comparing its number prefix
   * against the OTHER numbers the same supplier uses (creditnota-signal.ts explains why one prefix
   * on its own is too little to act on), and this module holds no history. Passing nothing means
   * that check cannot fire — which is what it did before this parameter existed. The screen has
   * the list and passes it.
   */
  vendorNumbers: readonly (string | null | undefined)[] = [],
): BundelBetalingResult {
  if (invoices.length < 2) {
    return { ok: false, error: "Selecteer minimaal twee inkoopfacturen om samen te betalen." };
  }
  if (invoices.length > MAX_BUNDEL_BETALING) {
    return { ok: false, error: `Maximaal ${MAX_BUNDEL_BETALING} facturen per betaling.` };
  }

  // [CREDIT-VERREKEN] Sort the selection into what is owed and what comes off it. Only a row whose
  // sign AND type agree that it is a credit may be deducted; the other two credit stances are a
  // contradiction and a guess, and neither is something to subtract from a payment.
  const debts: BundelBetalingInvoice[] = [];
  const credits: BundelBetalingInvoice[] = [];

  for (const inv of invoices) {
    if (inv.status !== "received") {
      const nr = inv.invoice_number ? `Factuur ${inv.invoice_number}` : "Een geselecteerde factuur";
      return { ok: false, error: `${nr} staat niet open als te betalen.` };
    }
    const stance = creditStance({
      invoiceNumber: inv.invoice_number,
      totalIncBtw: inv.total_inc_btw,
      invoiceType: inv.invoice_type ?? null,
      vendorNumbers,
    });
    const nr = inv.invoice_number ? `Factuur ${inv.invoice_number}` : "Een geselecteerde regel";
    if (payableAsDebt(stance)) { debts.push(inv); continue; }
    if (stance === "credit") { credits.push(inv); continue; }
    // 'conflict' — typed creditnota, positive money. We do not know which half is true, and both
    // answers are wrong: deducting it underpays, adding it overpays.
    if (stance === "conflict") {
      return {
        ok: false,
        error: `${nr} staat als creditnota gemarkeerd, maar het bedrag is positief. Zet eerst recht wat het is — zo weten wij niet of het geld naar je toe komt of van je af gaat.`,
      };
    }
    // 'suspected' — the supplier's own numbering says credit and nobody confirmed it. Netting on a
    // guess pays too little, and the owner would have no way to see why the supplier dunned them.
    return {
      ok: false,
      error: `${nr} lijkt op een creditnota, maar dat is nog niet bevestigd. Open hem en bevestig het — daarna kun je hem hier verrekenen.`,
    };
  }

  if (debts.length === 0) {
    return {
      ok: false,
      error: "Er staat geen te betalen factuur in de selectie. Een creditnota maak je niet over — kies er een factuur van dezelfde leverancier bij, dan gaat hij daarvan af.",
    };
  }

  // ONE beneficiary account. Every INVOICE must carry the SAME valid IBAN — a missing IBAN can't
  // prove it belongs to the same supplier, so it's out.
  const ibans = debts.map((inv) => inv.vendor_iban);
  if (ibans.some((i) => !isValidIban(i))) {
    return { ok: false, error: "Niet elke geselecteerde factuur heeft een geldig IBAN — betaal die factuur apart via de PDF." };
  }
  const normalized = new Set(ibans.map((i) => normalizeIban(i ?? "")));
  if (normalized.size > 1) {
    return { ok: false, error: "Selecteer facturen van dezelfde leverancier (zelfde IBAN) — één betaling gaat naar één rekening." };
  }
  const iban = normalizeIban(ibans[0] ?? "");

  // The beneficiary is named by the INVOICES: they are what the money is for.
  const beneficiaryName = debts
    .map((inv) => (inv.client_name ?? "").trim())
    .find(Boolean) ?? "";
  if (!beneficiaryName) {
    return { ok: false, error: "De leveranciersnaam ontbreekt — geen QR mogelijk." };
  }

  // [CREDIT-VERREKEN] A credit may only come off the supplier it belongs to. Its IBAN decides that
  // whenever it has one; a creditnota often carries none, because there is nothing to pay on it,
  // and then the vendor name has to match. Deducting another supplier's credit here would underpay
  // this one by exactly its value, and the shortfall would surface weeks later as a dunning letter.
  const beneficiaryKey = counterpartKey(beneficiaryName);
  for (const cn of credits) {
    const nr = cn.invoice_number ? `Creditnota ${cn.invoice_number}` : "Een geselecteerde creditnota";
    if (cn.vendor_iban && isValidIban(cn.vendor_iban)) {
      if (normalizeIban(cn.vendor_iban) !== iban) {
        return { ok: false, error: `${nr} hoort bij een andere leverancier (ander IBAN) — die kun je hier niet verrekenen.` };
      }
      continue;
    }
    const key = counterpartKey(cn.client_name ?? null);
    if (!key || !beneficiaryKey || key !== beneficiaryKey) {
      return {
        ok: false,
        error: `${nr} heeft geen IBAN en de naam komt niet overeen met ${beneficiaryName}. Wij kunnen dan niet vaststellen dat het dezelfde leverancier is, en een creditnota van iemand anders van deze factuur aftrekken laat je te weinig betalen.`,
      };
    }
  }

  // Invoices first, then the credits — the order the sheet shows the netting in.
  const items = [
    ...debts.map((inv) => ({ invoiceId: inv.id, invoiceNumber: inv.invoice_number, amount: openAmount(inv) })),
    ...credits.map((inv) => ({ invoiceId: inv.id, invoiceNumber: inv.invoice_number, amount: -openAmount(inv) })),
  ];
  if (items.some((it) => it.amount === 0)) {
    return { ok: false, error: "Een van de geselecteerde facturen heeft geen openstaand bedrag." };
  }
  const debtTotal = round2(debts.reduce((s, inv) => s + openAmount(inv), 0));
  const creditTotal = round2(credits.reduce((s, inv) => s + openAmount(inv), 0));
  const amount = round2(debtTotal - creditTotal);

  // [CREDIT-VERREKEN] There is no transfer of nothing, and no transfer of less than nothing. This
  // is a real outcome — a credit bigger than the bill it is being applied to — and the answer says
  // what to do with it rather than building a QR the bank would refuse.
  if (amount <= 0) {
    return {
      ok: false,
      error: creditTotal > 0
        ? `De creditnota's zijn samen € ${creditTotal.toFixed(2).replace(".", ",")} waard en de facturen € ${debtTotal.toFixed(2).replace(".", ",")} — er blijft niets te betalen over. Kies er een factuur bij, of vraag de leverancier om het verschil terug te storten.`
        : "Een van de geselecteerde facturen heeft geen openstaand bedrag.",
    };
  }

  // Reference: betalingskenmerk when present, else the invoice number — per
  // invoice, comma-separated. These are the strings the supplier's own
  // reconciliation AND our bank-import read back from the single debit.
  //
  // [CREDIT-VERREKEN] The credits are named too, after "-/-" — the notation a Dutch creditor
  // administration reads as a deduction. Without them the supplier sees a payment that is short by
  // the credit and no reason for it, which is exactly the letter this feature exists to avoid.
  // [KENMERK-BEIDE] Per invoice, BOTH identifiers when it carries two different ones. The old
  // `payment_reference || invoice_number` dropped the document's own number as soon as a kenmerk
  // existed — on a bundle that means the supplier sees one debit and cannot tell which of the
  // invoices in it were settled. Shared with the single-invoice sheet so the two can never answer
  // this differently.
  const refOf = (inv: BundelBetalingInvoice) => paymentReferenceFor(inv);
  const debtRefs = debts.map(refOf).filter(Boolean).join(", ");
  const creditRefs = credits.map(refOf).filter(Boolean).join(", ");
  const reference = creditRefs ? `${debtRefs} -/- ${creditRefs}` : debtRefs;

  // [BUNDEL-REFERENCE-FITS] Mirror of the outgoing rule: every kenmerk must reach the bank
  // statement or the debit can never be reconciled to the invoices it paid. The EPC remittance
  // is capped at 140 characters and the payload builder truncates SILENTLY, so a bundle whose
  // references do not fit would produce a payment quoting only part of the set. Refuse up front.
  if (reference.length > EPC_REMITTANCE_MAX) {
    // [CREDIT-VERREKEN] The credits are counted FIRST and never dropped: a payment short by a
    // credit whose number is not on it is the letter this feature exists to prevent. So the
    // question is how many INVOICES still fit beside them.
    const creditPart = creditRefs ? ` -/- ${creditRefs}` : "";
    let used = creditPart.length, fits = 0;
    for (const inv of debts) {
      const num = refOf(inv);
      if (!num) continue;
      const add = fits === 0 ? num.length : num.length + 2;
      if (used + add > EPC_REMITTANCE_MAX) break;
      used += add; fits++;
    }
    if (fits === 0) {
      return {
        ok: false,
        error: `De kenmerken passen niet in \u00e9\u00e9n betaling: de bank stuurt maar ${EPC_REMITTANCE_MAX} tekens mee, en de creditnota's nemen die al in beslag. Verreken er minder tegelijk.`,
      };
    }
    return {
      ok: false,
      error: `Te veel facturen voor \u00e9\u00e9n betaling: de bank kan maar ${EPC_REMITTANCE_MAX} tekens aan kenmerk meesturen, dus niet alle factuurnummers passen erin. Selecteer er maximaal ${fits} en betaal de rest in een tweede overboeking.`,
    };
  }

  const qr = buildEpcQrPayload({ iban, name: beneficiaryName, amount, reference });
  if (!qr.ok || !qr.payload) {
    return { ok: false, error: qr.error ?? "Geen betaal-QR mogelijk." };
  }

  return {
    ok: true, epcPayload: qr.payload, beneficiaryName, iban, amount, reference, items,
    // Only when something was actually deducted, so an ordinary bundle carries exactly the fields
    // it always did and a screen cannot render an empty "waarvan verrekend" row.
    ...(creditTotal > 0 ? { debtTotal, creditTotal } : {}),
  };
}
