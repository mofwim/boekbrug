// src/lib/ubl-invoice.ts
// [UBL-INTAKE] Extract the money-truth from a UBL / Peppol XML e-invoice (a common B2B / overheid
// format in NL). Previously such a file was filed as an opaque 'unsupported_type' document and its
// BTW/voorbelasting silently never reached the books — a missing invoice. This reads the standard
// UBL Invoice / CreditNote leaf elements so the file can flow into the normal verify queue like a
// PDF invoice. Intentionally tolerant + prefix-agnostic (cbc:/cac: prefixes vary by issuer): a
// clean extraction enters the queue; a partial one still enters (flagged), never silently lost.

import { checkVendorBtw } from "./vendor-identity";

/** Does this text look like a UBL/Peppol e-invoice (not a CAMT bank statement)? */
export function looksLikeUblInvoice(xml: string): boolean {
  if (!xml) return false;
  const head = xml.slice(0, 4000);
  // A CAMT/ISO-20022 bank statement is handled elsewhere — exclude it explicitly.
  if (/urn:iso:std:iso:20022|<BkToCstmrStmt|<Document[^>]*camt\./i.test(head)) return false;
  // UBL invoice roots (with or without a namespace prefix) or the oasis UBL namespace.
  return (
    /<(?:\w+:)?Invoice[\s>]/i.test(head) ||
    /<(?:\w+:)?CreditNote[\s>]/i.test(head) ||
    /urn:oasis:names:specification:ubl:schema/i.test(head) ||
    // Peppol BIS / EN16931 markers
    /peppol|en16931|<cbc:CustomizationID/i.test(head)
  );
}

const num = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  const t = String(s).trim().replace(/\s/g, "");
  if (!t) return null;
  // UBL amounts are canonical (dot decimal, no thousands sep) but be tolerant of a comma decimal.
  const normalized = t.includes(",") && !t.includes(".") ? t.replace(",", ".") : t.replace(/,(?=\d{3}\b)/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

// Match the FIRST occurrence of a (optionally-prefixed) leaf element's text content.
function firstTag(xml: string, local: string): string | null {
  const re = new RegExp(`<(?:\\w+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${local}>`, "i");
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

export interface UblInvoiceExtract {
  isCreditNote: boolean;
  invoiceNumber: string | null;
  invoiceDate: string | null; // ISO YYYY-MM-DD
  dueDate: string | null;
  currency: string | null;
  supplierName: string | null;
  /**
   * [BTW-NUMMER-BEWAARD] The supplier's VAT identification number, from the supplier party's
   * PartyTaxScheme/CompanyID. This is the one document type where the number is not read off a
   * picture but stated by the supplier's own system, and it is also the path most likely to carry
   * a foreign supplier — an e-factuur from a German or Belgian company is exactly the invoice
   * whose reverse charge an accountant has to place in rubriek 4b.
   *
   * null when the file states none, or states something that is not shaped like a VAT number.
   */
  supplierVatNumber: string | null;
  vendorIban: string | null;
  totalExBtw: number | null;
  btwAmount: number | null;
  totalIncBtw: number | null;
  // [BTW-SPLIT] The per-rate breakdown, one entry per cac:TaxSubtotal. Always positive magnitudes,
  // exactly as UBL states them; the caller applies the creditnota sign the same way it does to the
  // totals. Empty when the file carries no subtotals.
  btwRows: { rate: number; base: number; btw: number }[];
}

/** Every occurrence of an (optionally-prefixed) element, whole block including its tags. */
function allBlocks(xml: string, local: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${local}\\b[\\s\\S]*?</(?:\\w+:)?${local}>`, "gi");
  return xml.match(re) ?? [];
}

/**
 * Parse a UBL/Peppol invoice into the fields the intake pipeline needs. Best-effort + defensive:
 * any field that can't be found is null (the verify queue then flags it) — we NEVER fabricate a
 * number, and we prefer the explicit LegalMonetaryTotal over line sums.
 */
export function parseUblInvoice(xml: string): UblInvoiceExtract {
  const isCreditNote = /<(?:\w+:)?CreditNote[\s>]/i.test(xml.slice(0, 4000));

  // Invoice number = the first top-level <cbc:ID> (CustomizationID/ProfileID use their own tags,
  // and party IDs appear later inside cac: blocks, so the first bare ID is the document number).
  const invoiceNumber = firstTag(xml, "ID");

  const invoiceDate = firstTag(xml, "IssueDate");
  const dueDate = firstTag(xml, "DueDate");
  const currency = firstTag(xml, "DocumentCurrencyCode");

  // Supplier name: prefer the legal RegistrationName, then PartyName/Name — scoped to the
  // AccountingSupplierParty block so we never pick up the customer's name.
  let supplierName: string | null = null;
  const supBlock = /<(?:\w+:)?AccountingSupplierParty\b[\s\S]*?<\/(?:\w+:)?AccountingSupplierParty>/i.exec(xml)?.[0] ?? "";
  if (supBlock) {
    supplierName =
      firstTag(supBlock, "RegistrationName") ||
      firstTag(supBlock, "Name") ||
      null;
  }

  // [BTW-NUMMER-BEWAARD] Supplier VAT id, from the SUPPLIER block only — the customer party
  // carries a CompanyID of its own in the very same shape, and picking the wrong one would put
  // the owner's own number on the invoice as if it were the vendor's.
  //
  // PartyTaxScheme/CompanyID is where BT-31 lives. PartyLegalEntity/CompanyID is the KvK-style
  // registration number and is deliberately NOT read here: the two look alike in a file and mean
  // different things, and a KvK number classified as a VAT number is a wrong entry on a fiscal
  // listing. Shape-checked, never trusted for being present.
  let supplierVatNumber: string | null = null;
  if (supBlock) {
    const taxSchemeBlock = /<(?:\w+:)?PartyTaxScheme\b[\s\S]*?<\/(?:\w+:)?PartyTaxScheme>/i.exec(supBlock)?.[0] ?? "";
    const raw = (firstTag(taxSchemeBlock, "CompanyID") ?? "").replace(/[\s.\-/]/g, "").toUpperCase();
    // The app's OWN verdict on VAT-number shape, not a second one written here. A local regex
    // over "two letters then alphanumerics" accepts ZIEBIJLAGE, which is what a supplier types
    // into a field their software insists on filling — and it would then travel as a VAT number
    // onto a fiscal listing. checkVendorBtw knows the EU-27 prefixes and the NL pattern.
    if (checkVendorBtw(raw) === "ok") supplierVatNumber = raw;
  }

  // Supplier IBAN: PayeeFinancialAccount/ID (the account the invoice should be paid to).
  let vendorIban: string | null = null;
  const payeeBlock = /<(?:\w+:)?PayeeFinancialAccount\b[\s\S]*?<\/(?:\w+:)?PayeeFinancialAccount>/i.exec(xml)?.[0] ?? "";
  if (payeeBlock) {
    const iban = firstTag(payeeBlock, "ID");
    if (iban && /^[A-Z]{2}\d{2}[A-Z0-9]{6,}$/i.test(iban.replace(/\s/g, ""))) vendorIban = iban.replace(/\s/g, "").toUpperCase();
  }

  // Monetary totals from LegalMonetaryTotal (authoritative), tax from TaxTotal.
  const legalBlock = /<(?:\w+:)?LegalMonetaryTotal\b[\s\S]*?<\/(?:\w+:)?LegalMonetaryTotal>/i.exec(xml)?.[0] ?? "";
  const totalExBtw = num(firstTag(legalBlock, "TaxExclusiveAmount") ?? firstTag(legalBlock, "LineExtensionAmount"));
  const totalIncBtw = num(firstTag(legalBlock, "TaxInclusiveAmount") ?? firstTag(legalBlock, "PayableAmount"));
  const taxBlock = /<(?:\w+:)?TaxTotal\b[\s\S]*?<\/(?:\w+:)?TaxTotal>/i.exec(xml)?.[0] ?? "";
  // firstTag finds the TaxTotal's own TaxAmount, which UBL prints before the subtotals.
  const btwAmount = num(firstTag(taxBlock, "TaxAmount"));

  // [BTW-SPLIT] The per-rate breakdown. On a mixed-rate invoice this is the only thing that can
  // verify the btw total at all — any blend between the rates present is legal, so btw/excl proves
  // nothing (see btw-split.ts, and the Enka Horeca invoice that cost € 0,46 of voorbelasting).
  //
  // Here it costs nothing to be certain: UBL states TaxableAmount, TaxAmount and Percent as
  // separate typed elements. No column to pick, no OCR to misread — the disagreement a PDF reader
  // can produce is structurally impossible. A mixed-rate e-invoice therefore gets a real tick
  // rather than an honest "we could not check this".
  const btwRows: { rate: number; base: number; btw: number }[] = [];
  for (const sub of allBlocks(taxBlock, "TaxSubtotal")) {
    const base = num(firstTag(sub, "TaxableAmount"));
    const tax = num(firstTag(sub, "TaxAmount"));
    // Percent lives one level down, in cac:TaxCategory. Scoped rather than taken from the whole
    // subtotal, so a percentage that turns up in some other child cannot be read as the rate.
    const catBlock = /<(?:\w+:)?TaxCategory\b[\s\S]*?<\/(?:\w+:)?TaxCategory>/i.exec(sub)?.[0] ?? "";
    const pct = num(firstTag(catBlock, "Percent"));
    // Only a legal Dutch rate. A foreign or malformed rate would poison the column sums this
    // block exists to provide, and a half-read breakdown is worse than none: it would turn a
    // correct invoice into a flagged one.
    if (base == null || tax == null || pct == null || ![0, 9, 21].includes(pct)) {
      btwRows.length = 0;
      break;
    }
    btwRows.push({ rate: pct, base: Math.abs(base), btw: Math.abs(tax) });
  }

  return {
    isCreditNote,
    invoiceNumber: invoiceNumber || null,
    invoiceDate: invoiceDate && /^\d{4}-\d{2}-\d{2}/.test(invoiceDate) ? invoiceDate.slice(0, 10) : null,
    dueDate: dueDate && /^\d{4}-\d{2}-\d{2}/.test(dueDate) ? dueDate.slice(0, 10) : null,
    currency: currency || null,
    supplierName: supplierName || null,
    supplierVatNumber,
    vendorIban,
    totalExBtw,
    btwAmount,
    totalIncBtw,
    btwRows,
  };
}
