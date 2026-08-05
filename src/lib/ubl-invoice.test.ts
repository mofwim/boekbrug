// [UBL-INTAKE] Pure node test — run: npx tsx src/lib/ubl-invoice.test.ts
import { looksLikeUblInvoice, parseUblInvoice } from "./ubl-invoice";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>
  <cbc:ID>2026-00123</cbc:ID>
  <cbc:IssueDate>2026-03-15</cbc:IssueDate>
  <cbc:DueDate>2026-04-14</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>Groothandel De Vries B.V.</cbc:Name></cac:PartyName>
    <cac:PartyLegalEntity><cbc:RegistrationName>De Vries Groothandel B.V.</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyName><cbc:Name>Mijn Winkel</cbc:Name></cac:PartyName>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cac:PayeeFinancialAccount><cbc:ID>NL25RABO0133368882</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">105.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">500.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">500.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">605.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">605.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

console.log("\n— UBL detection —");
check("recognises a UBL invoice", looksLikeUblInvoice(UBL) === true);
check("rejects a CAMT bank statement", looksLikeUblInvoice('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt/></Document>') === false);
check("rejects empty/plain text", looksLikeUblInvoice("hello world") === false);

console.log("\n— UBL extraction —");
const v = parseUblInvoice(UBL);
check("invoice number = the first bare cbc:ID (not CustomizationID)", v.invoiceNumber === "2026-00123");
check("issue date", v.invoiceDate === "2026-03-15");
check("due date", v.dueDate === "2026-04-14");
check("supplier name (RegistrationName preferred, supplier-scoped)", v.supplierName === "De Vries Groothandel B.V.");
check("does NOT pick the customer name", v.supplierName !== "Mijn Winkel");
check("vendor IBAN", v.vendorIban === "NL25RABO0133368882");
check("total ex btw = 500", v.totalExBtw === 500);
check("btw = 105", v.btwAmount === 105);
check("total incl = 605", v.totalIncBtw === 605);
check("not a creditnota", v.isCreditNote === false);

console.log("\n— CreditNote sign —");
const cn = parseUblInvoice(UBL.replace(/Invoice/g, "CreditNote"));
check("detects a creditnota root", cn.isCreditNote === true);

console.log("\n— [BTW-SPLIT] the per-rate breakdown, which a mixed-rate invoice has no other witness for —");
{
  // The Enka Horeca shape, as a Peppol file would state it. Here nothing has to be read off a
  // column: TaxableAmount, TaxAmount and Percent are typed elements, so the app can verify the btw
  // instead of admitting it compared it with nothing.
  const MIXED = UBL.replace(
    `<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">105.00</cbc:TaxAmount></cac:TaxTotal>`,
    `<cac:TaxTotal>
      <cbc:TaxAmount currencyID="EUR">122.64</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="EUR">1101.38</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="EUR">99.06</cbc:TaxAmount>
        <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>9</cbc:Percent></cac:TaxCategory>
      </cac:TaxSubtotal>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="EUR">112.12</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="EUR">23.58</cbc:TaxAmount>
        <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>`,
  );
  const m = parseUblInvoice(MIXED);
  check("the TaxTotal's OWN TaxAmount still wins over the subtotals", m.btwAmount === 122.64);
  check("both rate rows are extracted", m.btwRows.length === 2);
  check("9% row: base and btw from their own elements",
    m.btwRows[0].rate === 9 && m.btwRows[0].base === 1101.38 && m.btwRows[0].btw === 99.06);
  check("21% row", m.btwRows[1].rate === 21 && m.btwRows[1].base === 112.12 && m.btwRows[1].btw === 23.58);
  check("and the columns reproduce the totals the file states",
    Math.abs(m.btwRows.reduce((s, r) => s + r.btw, 0) - 122.64) < 0.005);

  // A rate that is not a Dutch one drops the WHOLE breakdown rather than half of it. A partial
  // block would sum short and turn a perfectly good invoice into a flagged one — the opposite of
  // what this evidence is for.
  const foreign = parseUblInvoice(MIXED.replace("<cbc:Percent>21</cbc:Percent>", "<cbc:Percent>19</cbc:Percent>"));
  check("a non-NL rate discards the breakdown entirely", foreign.btwRows.length === 0);
  check("…while the totals it does not touch survive", foreign.btwAmount === 122.64);

  // An invoice with no subtotals at all is the ordinary case and must stay silent.
  check("no TaxSubtotal → an empty list, not a fabricated row", parseUblInvoice(UBL).btwRows.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
