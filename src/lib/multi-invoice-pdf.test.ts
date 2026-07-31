// [MULTI-INVOICE] Pure node test — run: npx tsx src/lib/multi-invoice-pdf.test.ts
// Locks BOTH directions of the detector, and the second one matters most: this is a soft flag on
// the busiest path in the app, so a false positive would nag on ordinary invoices until the
// warning stops being read. Every "normal invoice" case below must stay silent.
import { detectMultipleInvoices, cannotVerifySingleInvoice, mergeMultipleInvoices, mergeUnverifiedSingle, clearSingleInvoiceDoubt } from "./multi-invoice-pdf";

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

// ── [ONE-INVOICE-UNVERIFIED] Kon de controle hierboven überhaupt draaien? ─────────────────────
// De detector leest de tekstlaag, en een gescande stapel heeft er geen — dus juist bij het geval
// waarvoor hij is geschreven geeft hij null terug. Deze functie is het eerlijke antwoord daarop.
// Ook hier telt de STILTE het zwaarst: automatisch boeken is de moeite waard om te behouden, dus
// alles wat één beeld is of wél leesbaar was, moet ongemoeid blijven.
{
  // HET GEVAL. Meerdere pagina's, geen tekstlaag → we hebben niet gekeken.
  const scan = cannotVerifySingleInvoice({ pages: 4, hasTextLayer: false });
  check("gescande stapel zonder tekstlaag → vlag", scan !== null);
  check("de reden noemt het aantal pagina's", !!scan && /4 pagina/.test(scan.reason));
  check("de reden bewéért niet dat we meerdere facturen zagen", !!scan && !/bevat \d+ verschillende/.test(scan.reason));

  // DE STILTES.
  check("één pagina zonder tekstlaag → stil (een foto is één factuur)",
    cannotVerifySingleInvoice({ pages: 1, hasTextLayer: false }) === null);
  check("meerdere pagina's MET tekstlaag → stil (de detector heeft echt gekeken)",
    cannotVerifySingleInvoice({ pages: 9, hasTextLayer: true }) === null);
  check("geen PDF (pages 0) → stil",
    cannotVerifySingleInvoice({ pages: 0, hasTextLayer: false }) === null);
  check("één pagina MET tekstlaag → stil",
    cannotVerifySingleInvoice({ pages: 1, hasTextLayer: true }) === null);

  // De grens ligt op twee, niet op drie.
  check("twee pagina's zonder tekstlaag → vlag (de grens is 2)",
    cannotVerifySingleInvoice({ pages: 2, hasTextLayer: false }) !== null);

  // Onzin uit een kapotte PDF mag geen vlag opleveren.
  check("NaN pagina's → stil, geen vlag op een rekenfout",
    cannotVerifySingleInvoice({ pages: NaN, hasTextLayer: false }) === null);
}

console.log("\n— het signaal opslaan en weer weghalen —");
{
  const signal = { numbers: ["2026-0441", "2026-0452"], reason: "twee facturen" };

  // Schrijven laat al bestaande waarschuwingen met rust.
  const base = { vendor: 0.9, _safecore: { arithmetic_ok: false, reason: "excl + BTW ≠ totaal" } };
  const flagged = mergeMultipleInvoices(base, signal) as { vendor: number; _safecore: Record<string, unknown> };
  check("merge zet de drie sleutels", flagged._safecore.multiple_invoices === true
    && flagged._safecore.multiple_invoices_reason === "twee facturen"
    && Array.isArray(flagged._safecore.multiple_invoices_numbers));
  check("merge laat de rekenkundige uitspraak staan", flagged._safecore.arithmetic_ok === false);
  check("merge raakt de AI-scores niet aan", flagged.vendor === 0.9);
  check("merge muteert de invoer niet", (base._safecore as Record<string, unknown>).multiple_invoices === undefined);
  check("niets te vlaggen → invoer ongewijzigd terug", mergeMultipleInvoices(base, null) === base);

  // Wissen is de omgekeerde weg, en NIETS meer.
  const cleared = clearSingleInvoiceDoubt(flagged) as { vendor: number; _safecore: Record<string, unknown> };
  check("wissen haalt alle drie de sleutels weg",
    cleared._safecore.multiple_invoices === undefined
    && cleared._safecore.multiple_invoices_reason === undefined
    && cleared._safecore.multiple_invoices_numbers === undefined);
  check("wissen laat de rekenfout staan — die is niet beantwoord", cleared._safecore.arithmetic_ok === false);
  check("schrijven-dan-wissen is een rondgang", JSON.stringify(cleared) === JSON.stringify(base));

  // De TWEEDE grond — "we konden het niet nagaan" — hoort bij dezelfde vraag.
  const unver = mergeUnverifiedSingle({}, { reason: "gescande stapel" }, 7) as { _safecore: Record<string, unknown> };
  check("mergeUnverifiedSingle zet zijn eigen drie sleutels", unver._safecore.one_invoice_unverified === true
    && unver._safecore.one_invoice_unverified_pages === 7);
  const unverCleared = clearSingleInvoiceDoubt(unver) as { _safecore: Record<string, unknown> };
  check("ÉÉN antwoord wist ook die tweede grond", unverCleared._safecore.one_invoice_unverified === undefined
    && unverCleared._safecore.one_invoice_unverified_reason === undefined
    && unverCleared._safecore.one_invoice_unverified_pages === undefined);

  // Allebei tegelijk gezet (kan niet via de route, maar de wisser mag er niet op stuklopen).
  const both = mergeUnverifiedSingle(mergeMultipleInvoices({}, signal), { reason: "x" }, 3);
  const bothCleared = clearSingleInvoiceDoubt(both) as { _safecore: Record<string, unknown> };
  check("beide gronden tegelijk → allebei weg",
    Object.keys(bothCleared._safecore).length === 0);

  // Geen nep-succes: de aanroeper moet "gewist" van "er stond niets" kunnen onderscheiden.
  check("niets gevlagd → null", clearSingleInvoiceDoubt({ vendor: 0.9 }) === null);
  check("leeg _safecore → null", clearSingleInvoiceDoubt({ _safecore: { arithmetic_ok: true } }) === null);
  check("null / niet-object / array → null", clearSingleInvoiceDoubt(null) === null
    && clearSingleInvoiceDoubt("nope") === null && clearSingleInvoiceDoubt([1, 2]) === null);
  check("wissen is idempotent", clearSingleInvoiceDoubt(cleared) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
