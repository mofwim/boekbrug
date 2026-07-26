// src/lib/ubl-invoice.ts
// [UBL-INTAKE] Extract the money-truth from a UBL / Peppol XML e-invoice (a common B2B / overheid
// format in NL). Previously such a file was filed as an opaque 'unsupported_type' document and its
// BTW/voorbelasting silently never reached the books — a missing invoice. This reads the standard
// UBL Invoice / CreditNote leaf elements so the file can flow into the normal verify queue like a
// PDF invoice. Intentionally tolerant + prefix-agnostic (cbc:/cac: prefixes vary by issuer): a
// clean extraction enters the queue; a partial one still enters (flagged), never silently lost.

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
  vendorIban: string | null;
  totalExBtw: number | null;
  btwAmount: number | null;
  totalIncBtw: number | null;
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
  const btwAmount = num(firstTag(taxBlock, "TaxAmount"));

  return {
    isCreditNote,
    invoiceNumber: invoiceNumber || null,
    invoiceDate: invoiceDate && /^\d{4}-\d{2}-\d{2}/.test(invoiceDate) ? invoiceDate.slice(0, 10) : null,
    dueDate: dueDate && /^\d{4}-\d{2}-\d{2}/.test(dueDate) ? dueDate.slice(0, 10) : null,
    currency: currency || null,
    supplierName: supplierName || null,
    vendorIban,
    totalExBtw,
    btwAmount,
    totalIncBtw,
  };
}
