// [FACTUUR-SCENARIOS] The realistic-invoice battery — run: npx tsx src/lib/factuur-scenarios.test.ts
//
// The bank side has had one of these since [BANK-SCENARIOS] (S1..S35): one numbered case per REAL
// situation, asserting the humanly-correct outcome of the pure engines. The reading and BTW side
// had nothing equivalent, so "does the app read this correctly" could only be answered per module.
//
// Every case below is a SHAPE measured in this owner's production data, not an invented one. The
// amounts are the real ones where they are the point of the case. Together they walk one quarter
// from raw amounts to a filed aangifte and assert what the Belastingdienst should see.
//
// The rule these serve, and it is the same one the bank battery serves: a WRONG automatic booking
// is worse than a missed one. Where the paper is unambiguous the app may act; where it is not, it
// must hold and say why — never guess with money.

import { evaluateArithmetic } from "./safecore";
import { classifyImportHealth } from "./import-health";
import { buildAangifte, type AangifteInput, type AangifteCompleteness } from "./aangifte";
import { totalIsDerivedFromGrounded } from "./amount-grounding";
import { taxableBase, impliedRate, untaxedThatWouldExplain } from "./untaxed-amount";
import { doubtAboutInputVat } from "./btw-soort";
import { deriveVendorRate, proposeSplit } from "./vendor-vat-rate";
import { verlegdeBtwOpInkoop, totaalVerlegd } from "./verlegde-btw";
import { reconcileBtw } from "./btw-reconcile";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const eur = (n: number) => Math.round(n * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n— S1 · GROOTHANDEL M.H. BAL: subtotal and BTW printed, gross never restated —");
{
  // 96 invoices in production, 53 of them grounded this way. The reader finds excl and btw on the
  // page and computes the total; the total itself is nowhere in the text.
  const ex = 611.61, btw = 55.04, incl = 666.65;
  check("de bedragen tellen op", eur(ex + btw) === incl);
  check("het tarief is 9%", Math.round(impliedRate(ex, btw, 0)!) === 9);

  const grounding = { totalIncBtw: "absent" as const, totalExBtw: "found" as const, btwAmount: "found" as const };
  check("het totaal geldt als GEGROND (afgeleid uit twee gevonden bedragen)",
    totalIsDerivedFromGrounded(grounding, { totalIncBtw: incl, totalExBtw: ex, btwAmount: btw }));

  const h = classifyImportHealth({
    total_ex_btw: ex, btw_amount: btw, total_inc_btw: incl,
    invoice_date: "2026-09-03", invoice_number: "264502", invoice_type: "factuur",
    field_confidence: { _grounding: { ...grounding, source: "text" } } as never,
  });
  check("de factuur krijgt GEEN 'controleer het aan de factuur zelf'",
    !h.flags.notOnDocument, `flags: ${JSON.stringify(h.flags)}`);
  check("…en wordt niet op rekenkundige gronden vastgehouden", !h.flags.arithmetic);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n— S2 · Elegance Brands: statiegeld naast het subtotaal —");
{
  // Invoice 2026080832, verbatim from the paper:
  //   Subtotaal 835,30 · BTW 9% 75,22 · Totaal Statiegeld 176,40 · Totaal 1.086,92
  const sub = 835.30, btw = 75.22, statiegeld = 176.40, totaal = 1086.92;
  check("zoals gelezen telt het NIET op", eur(sub + btw) !== totaal);

  const v = evaluateArithmetic({ totalExBtw: sub, btwAmount: btw, totalIncBtw: totaal, invoiceDate: "2026-08-08" });
  check("safecore houdt hem tegen", !v.ok);
  const gat = eur(totaal - sub - btw);
  check("het gat is exact het statiegeld", gat === statiegeld, `gat=${gat}`);

  // [STATIEGELD-GAT] folds it into the base, and [NUL-POST] records how much of that base is untaxed.
  const nieuweEx = eur(sub + statiegeld);
  check("na verwerking telt het wél op", eur(nieuweEx + btw) === totaal);
  check("het tarief over de VOLLE grondslag is onwettig (7,43%)",
    Math.abs(impliedRate(nieuweEx, btw, 0)! - 7.43) < 0.02);
  check("het tarief over de BELASTE grondslag is 9%",
    Math.round(impliedRate(nieuweEx, btw, statiegeld)!) === 9);
  check("de belaste grondslag is weer het subtotaal", eur(taxableBase(nieuweEx, statiegeld)) === sub);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n— S3 · Coöperatie Univé: 21% die geen btw is —");
{
  // Invoice 142257742, booked 'received' with EUR 41,01 standing as voorbelasting.
  const d = doubtAboutInputVat({ supplierName: "Coöperatie Univé Zuid-Nederland U.A.", totalExBtw: 195.28, btwAmount: 41.01 });
  check("de app waarschuwt", d !== null);
  check("…en noemt assurantiebelasting", !!d && /assurantiebelasting/.test(d.message));
  check("…met het wetsartikel erbij", !!d && d.wet.includes("11-1-k"));
  check("op EUR 0 btw zwijgt hij",
    doubtAboutInputVat({ supplierName: "Univé Zuid-Nederland", totalExBtw: 236.29, btwAmount: 0 }) === null);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n— S4 · Enka Horeca: een GROOTHANDEL die twee tarieven mengt —");
{
  // 16 booked invoices with fully deductible BTW. Its name contains 'Horeca' and it is not a
  // restaurant; its invoices blend 9% and 21%.
  check("geen horeca-waarschuwing op een groothandel",
    doubtAboutInputVat({ supplierName: "Enka Horeca B.V.", totalExBtw: 1000, btwAmount: 90 }) === null);
  const gemengd = [
    ...Array.from({ length: 10 }, () => ({ totalExBtw: 100, btwAmount: 9, totalIncBtw: 109 })),
    { totalExBtw: 100, btwAmount: 9.45, totalIncBtw: 109.45 },
    { totalExBtw: 100, btwAmount: 11.1, totalIncBtw: 111.1 },
  ];
  check("geen vast tarief voor een gemengde leverancier", deriveVendorRate(gemengd) === null);
  check("…en geen statiegeld-verklaring voor een tarief TUSSEN twee tarieven",
    untaxedThatWouldExplain(1000, 106.3) === null);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n— S5 · Sumer Food: de uitsplitsing stond niet op het papier —");
{
  // The shape of 44 held invoices: a real total, no split at all.
  const totaal = 1560.42;
  const v = evaluateArithmetic({ totalExBtw: 0, btwAmount: 0, totalIncBtw: totaal, invoiceDate: "2026-05-15" });
  check("safecore houdt hem tegen", !v.ok);
  const rec = reconcileBtw(0, 0, totaal);
  check("er wordt GEEN nul-btw 'reparatie' aangeboden", !rec.exclRepairPossible && !rec.btwRepairPossible);

  // Twelve earlier invoices, every one 9%.
  const historie = Array.from({ length: 12 }, (_, i) => ({ totalExBtw: 100 + i, btwAmount: eur((100 + i) * 0.09), totalIncBtw: eur((100 + i) * 1.09) }));
  const tarief = deriveVendorRate(historie);
  check("de leverancier heeft een aantoonbaar vast tarief", tarief?.rate === 9 && tarief.basedOn === 12);
  const s = proposeSplit(totaal, 9)!;
  check("het voorstel telt exact op", eur(s.totalExBtw + s.btwAmount) === totaal);
  check("…en levert precies 9%", Math.round(impliedRate(s.totalExBtw, s.btwAmount, 0)!) === 9);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n— S6 · Onderaannemer: BTW verlegd naar de aannemer —");
{
  const v = verlegdeBtwOpInkoop({ text: "Factuurbedrag exclusief. BTW verlegd naar de aannemer.", totalExBtw: 20000, btwAmount: 0 })!;
  check("de verlegging wordt herkend", !!v);
  check("21% over de grondslag", v.bedrag === 4200);
  const t = totaalVerlegd([v])!;
  check("het totaal voor rubriek 2a klopt", t.btw === 4200 && t.grondslag === 20000);
  check("een factuur die WEL btw rekent is geen verlegging",
    verlegdeBtwOpInkoop({ text: "BTW verlegd", totalExBtw: 20000, btwAmount: 4200 }) === null);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n— S7 · Het kwartaal, van bedragen tot aangifte —");
{
  // A quarter built from the cases above: till turnover at 9% and 21%, purchase BTW, and one
  // reverse-charged subcontractor invoice.
  const compl: AangifteCompleteness = {
    turnoverDays: 91, quarterDays: 92, incomingInvoiceCount: 206, outgoingInvoiceCount: 1,
    hasEuPurchase: false,
  };
  const input: AangifteInput = {
    salesByRate: [
      { rate: 21, omzet: 1185, btw: 249 },
      { rate: 9, omzet: 176604, btw: 15894 },
    ],
    btwVoorbelasting: 12002,
    cashOmzetZonderBtw: 0,
    verlegdNaarMij: { grondslag: 20000, btw: 4200, aantal: 1 },
  };
  const a = buildAangifte(input, compl, "Q2 2026");
  const row = (c: string) => a.rows.find((r) => r.code === c);
  check("1a: 21%-omzet en btw", row("1a")?.omzet === 1185 && row("1a")?.btw === 249);
  check("1b: 9%-omzet en btw", row("1b")?.omzet === 176604 && row("1b")?.btw === 15894);
  check("2a: de verlegde btw staat erop", row("2a")?.btw === 4200);
  check("5a = 249 + 15.894 + 4.200", a.verschuldigd === 20343);
  check("5b = 12.002 + dezelfde 4.200", a.voorbelasting === 16202);
  check("5g = 5a - 5b", a.saldo === a.verschuldigd - a.voorbelasting);
  // The whole point of the reverse charge: it must not change what is paid.
  const zonder = buildAangifte({ ...input, verlegdNaarMij: null }, compl, "Q2 2026");
  check("de verlegging verandert het te betalen saldo NIET", a.saldo === zonder.saldo,
    `met=${a.saldo} zonder=${zonder.saldo}`);
  check("het concept zegt dat het een CONCEPT is", a.notes.some((n) => n.includes("CONCEPT")));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n— S8 · Een creditnota keert alles om —");
{
  const v = evaluateArithmetic(
    { totalExBtw: -611.61, btwAmount: -55.04, totalIncBtw: -666.65, invoiceDate: "2026-09-03" },
    { isCreditNote: true },
  );
  check("een negatieve creditnota is rekenkundig in orde", v.ok, v.reason ?? "");
  check("het tarief blijft 9%", Math.round(impliedRate(-611.61, -55.04, 0)!) === 9);
  check("de belaste grondslag blijft negatief", taxableBase(-611.61, 100) < 0);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n— S9 · De grens: een misread die intern klopt —");
{
  // NemaFood 262697. The read adds up perfectly and is still wrong; the document says
  // 1.065,14 + 95,54 = 1.160,68. Nothing here may wave it through.
  const ex = 1054.64, btw = 94.92, incl = 1149.56;
  check("de gelezen bedragen tellen op", eur(ex + btw) === incl);
  check("…en toch geldt het totaal NIET als gegrond",
    !totalIsDerivedFromGrounded(
      { totalIncBtw: "absent", totalExBtw: "absent", btwAmount: "absent" },
      { totalIncBtw: incl, totalExBtw: ex, btwAmount: btw }));
  const h = classifyImportHealth({
    total_ex_btw: ex, btw_amount: btw, total_inc_btw: incl,
    invoice_date: "2026-07-28", invoice_number: "262697", invoice_type: "factuur",
    field_confidence: {
      _grounding: {
        totalIncBtw: "absent", totalExBtw: "absent", btwAmount: "absent", source: "ocr",
        alternative: { ex: 1065.14, btw: 95.54, inc: 1160.68 },
      },
    } as never,
  });
  check("de app waarschuwt nog steeds", h.flags.notOnDocument);
  check("…en biedt het totaal van het papier aan", h.alternativeTotals?.inc === 1160.68);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
