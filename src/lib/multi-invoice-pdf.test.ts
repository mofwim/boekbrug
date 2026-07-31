// [MULTI-INVOICE] Pure node test — run: npx tsx src/lib/multi-invoice-pdf.test.ts
// Locks BOTH directions of the detector, and the second one matters most: this is a soft flag on
// the busiest path in the app, so a false positive would nag on ordinary invoices until the
// warning stops being read. Every "normal invoice" case below must stay silent.
import { detectMultipleInvoices } from "./multi-invoice-pdf";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— stays SILENT on an ordinary single invoice —");
check("empty / missing text", detectMultipleInvoices("") === null && detectMultipleInvoices(null) === null);
check(
  "one invoice, number printed twice (header + payment block)",
  detectMultipleInvoices(`
    BALKIP B.V.
    Factuurnummer: 26302362
    Factuurdatum: 03-04-2026
    Totaal incl. BTW  € 1.210,00
    Bij betaling graag factuurnummer 26302362 vermelden.
  `) === null,
);
check(
  "a creditnota that REFERENCES the original invoice number",
  detectMultipleInvoices(`
    CREDITNOTA
    Factuurnummer: CN-2026-014
    Creditnota van factuurnummer 26302362
    Totaal incl. BTW  € -121,00
    Te betalen  € 0,00
  `) === null,
);
check(
  "a reminder naming the original invoice",
  detectMultipleInvoices(`
    HERINNERING
    Factuurnummer: H-889
    Betreft factuurnummer 26302362 van 03-04-2026
    Te betalen bedrag € 1.210,00
  `) === null,
);
check(
  "two numbers but only ONE settlement → not two invoices",
  detectMultipleInvoices(`
    Factuurnummer: 1001
    Nota nummer: 1002
    Totaal incl. BTW € 500,00
  `) === null,
);
check(
  "a bare counter is not an invoice identity",
  detectMultipleInvoices(`
    Factuurnummer: 1
    Factuurnummer: 2
    Te betalen € 10,00
    Te betalen € 20,00
  `) === null,
);

console.log("\n— FLAGS a scanned stack: several invoices in one file —");
{
  const stack = detectMultipleInvoices(`
    FAMZFOOD — Factuurnummer: 2026-0441
    Factuurdatum: 02-04-2026
    Totaal incl. BTW € 340,50

    FAMZFOOD — Factuurnummer: 2026-0452
    Factuurdatum: 09-04-2026
    Totaal incl. BTW € 122,75

    FAMZFOOD — Factuurnummer: 2026-0463
    Factuurdatum: 16-04-2026
    Totaal incl. BTW € 88,20
  `);
  check("detected", stack !== null);
  check("all three numbers collected", stack?.numbers.length === 3);
  check("reason names the count", !!stack && /3 verschillende facturen/.test(stack.reason));
  check("reason tells the owner what to do", !!stack && /los toe/.test(stack.reason));
}
{
  const two = detectMultipleInvoices(`
    Invoice number: INV-9001
    Amount due 120.00
    Invoice no. INV-9002
    Amount due 240.00
  `);
  check("English labels, two invoices", two !== null && two.numbers.length === 2);
}
{
  // Same invoice number in different casing/spacing is ONE invoice, not two.
  const same = detectMultipleInvoices(`
    Factuurnummer: ab-100
    Totaal incl. € 10,00
    Factuurnummer: AB-100
    Te betalen € 10,00
  `);
  check("case/space-insensitive: one number, no flag", same === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
