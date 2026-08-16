// [DEEL-CREDIT × REGEL-KORTING × E-FACTUUR] Run: npx tsx --test src/lib/partial-credit-ubl.test.ts
//
// ── WAAROM DIT BESTAAT ──
//
// Drie dingen landden binnen een dag op main, uit verschillende sessies: korting per factuurregel,
// een creditnota voor een DEEL van een factuur, en de e-factuur die allebei moet kunnen uitdrukken.
// Elk voor zich getest. De COMBINATIE was dat niet, en daar is vandaag al één fout gevonden — een
// vast regelkortingsbedrag dat onverkort van een deelcreditering werd afgetrokken, € 17,50 te
// weinig terug voor de klant.
//
// Die fout ging over geld dat de klant misloopt. Dit bestand gaat over de fout ernaast, die stiller
// is: een creditnota waarvan de BEDRAGEN kloppen maar het BESTAND wordt geweigerd. Peppol
// controleert per regel of het regelbedrag terug te rekenen is uit aantal, prijs en aftrek. Klopt
// dat op een cent na niet, dan weigert het ontvangende access point het document — en de
// ondernemer ziet een verstuurde creditnota, terwijl zijn klant niets heeft gekregen en de
// correctie nooit in diens boekhouding komt.
//
// Er is geen scherm dat dat meldt. Vandaar hier.
//
// ── DE DRIE REGELS DIE HET DOCUMENT DRAGEN ──
//
//   PEPPOL-EN16931-R120  regelbedrag == (aantal ÷ BaseQuantity) × prijs − aftrek
//   BR-27                cbc:PriceAmount mag NIET negatief zijn; het teken zit in het aantal
//   BR-CO-10             LegalMonetaryTotal/LineExtensionAmount == de som van de regelbedragen
//
// De gevallen hieronder zijn niet willekeurig gekozen: het zijn de vormen waarin een deelcredit een
// bedrag oplevert dat NIET netjes deelbaar is — een vast bedrag over een deel van de regel, een
// prijs met oneindige decimalen (incl.-btw ingetypt), een breuk als 1 van 7, en de stapeling van
// een regelkorting met een documentkorting. Precies daar ontstaat het cent-verschil dat een bestand
// laat weigeren, en precies daar is een test die alleen ronde getallen voert waardeloos.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildInvoiceUbl } from "./ubl-export";
import { buildCreditSelection } from "./partial-credit";
import { creditLinesFor } from "./creditnota-lines";
import { computeInvoiceTotals } from "./invoice-totals";
import { applyDiscount, lineNetEx } from "./invoice-discount";

const SUPPLIER = {
  company_name: "Kiwi Food Market",
  address: "Verdiplein 13-14",
  postal_code: "5049NM",
  city: "Tilburg",
  kvk_number: "94386676",
  btw_number: "NL005079680B23",
  iban: "NL73INGB0107197480",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

interface Geval {
  naam: string;
  lines: Record<string, unknown>[];
  selection: { id: string; quantity: number }[];
  documentDiscount?: { type: string; value: number };
  /** Wat de klant hoort terug te krijgen, excl. btw. Met de hand nagerekend. */
  expectedEx: number;
}

const CASES: Geval[] = [
  {
    // Het geval uit de gevonden fout, nu van de andere kant bekeken. De klant betaalde € 47,50 per
    // stuk (500 − 25 over tien), dus drie stuks is € 142,50 — niet 150 − 25 = € 125.
    naam: "a fixed line discount, three of ten credited",
    lines: [{ id: "a", description: "Advies", quantity: 10, unit_price: 50, btw_rate: 21, unit: null,
              discount_type: "amount", discount_value: 25 }],
    selection: [{ id: "a", quantity: 3 }],
    expectedEx: -142.5,
  },
  {
    // Een percentage is al pro rata. Zou het NOG een keer worden geschaald, dan kwam hier een lager
    // bedrag uit — de spiegelbeeldfout van de vorige.
    naam: "a percentage needs no scaling: one of three",
    lines: [{ id: "a", description: "Werk", quantity: 3, unit_price: 33.33, btw_rate: 21, unit: null,
              discount_type: "percent", discount_value: 12.5 }],
    selection: [{ id: "a", quantity: 1 }],
    expectedEx: -29.16,
  },
  {
    // Twee tarieven op één creditnota, allebei deels. De btw moet PER TARIEF worden gerond, en de
    // prijs van de 9%-regel is 1,75 ÷ 1,09 — oneindig veel decimalen, ingetypt als incl.-prijs.
    naam: "two rates, both partly credited, one with an inclusive-typed price",
    lines: [{ id: "a", description: "Eten", quantity: 7, unit_price: 1.75 / 1.09, btw_rate: 9, unit: null,
              discount_type: "amount", discount_value: 1.11 },
            { id: "b", description: "Uur", quantity: 4, unit_price: 62.5, btw_rate: 21, unit: null,
              discount_type: "percent", discount_value: 7.5 }],
    selection: [{ id: "a", quantity: 2 }, { id: "b", quantity: 1 }],
    expectedEx: -60.7,
  },
  {
    // Eén zevende van een vaste korting is geen rond bedrag, en de prijs eindigt op 9,99. Als er
    // ergens een cent wegvalt tussen het regelbedrag en de aftrek, valt hij hier.
    naam: "an ugly fraction: one of seven, with a fixed discount",
    lines: [{ id: "a", description: "Stuks", quantity: 7, unit_price: 9.99, btw_rate: 21, unit: null,
              discount_type: "amount", discount_value: 3.33 }],
    selection: [{ id: "a", quantity: 1 }],
    expectedEx: -9.51,
  },
  {
    // Allebei tegelijk: de regel heeft een eigen korting én de factuur heeft er een. EN 16931 legt
    // de volgorde vast — de regelaftrek verlaagt BT-131, de documentaftrek werkt op de SOM van die
    // verlaagde bedragen — en allebei moeten ze meeschalen met het gecrediteerde deel.
    naam: "a line discount stacked on a document discount, partly credited",
    lines: [{ id: "a", description: "Levering", quantity: 9, unit_price: 19.95, btw_rate: 21, unit: null,
              discount_type: "amount", discount_value: 12.34 }],
    selection: [{ id: "a", quantity: 4 }],
    documentDiscount: { type: "amount", value: 30 },
    expectedEx: -60.99,
  },
];

/** Bouw de creditnota zoals de route dat doet, en geef het UBL terug. */
function creditnotaUbl(g: Geval): { xml: string; totalExBtw: number } {
  // De bronregels dragen een NETTO line_total — de afspraak van invoice_line_discount.sql.
  const src = g.lines.map((l) => ({ ...l, line_total: lineNetEx(l as never) }));
  const sel = buildCreditSelection({
    lines: src as never,
    selection: g.selection as never,
    discountType: g.documentDiscount?.type ?? null,
    discountValue: g.documentDiscount?.value ?? null,
  });
  // [CREDIT-SIGN] De spiegel: pas hier worden de bedragen negatief.
  const mirrored = creditLinesFor(sel.lines as never, "cn-1", "deelcredit");
  const totals = sel.discount
    ? applyDiscount(mirrored as never, sel.discount)
    : computeInvoiceTotals(mirrored as never);
  const { xml } = buildInvoiceUbl(
    {
      invoice_number: "2026-C1", invoice_date: "2026-08-15", due_date: "2026-09-14",
      invoice_type: "creditnota",
      total_ex_btw: totals.total_ex_btw, btw_amount: totals.btw_amount, total_inc_btw: totals.total_inc_btw,
      client_name: "Klant", client_address: "Straat 1", client_postal_code: "1234AB",
      client_city: "Tilburg", client_btw_number: null,
      discount_type: sel.discount?.type ?? null, discount_value: sel.discount?.value ?? null,
    } as never,
    mirrored as never,
    SUPPLIER as never,
  );
  return { xml, totalExBtw: totals.total_ex_btw };
}

/** Elk cbc-getal binnen ÉÉN regelblok, zodat een lezing nooit naar een buurregel afdwaalt. */
// [CREDITNOTA-DOCUMENT] Reads BOTH document shapes. A creditnota is a CreditNote with
// CreditNoteLine/CreditedQuantity, and a helper that knew only the invoice spelling would find
// ZERO lines on one — and then assert nothing at all, vacuously, forever.
function lineBlocks(xml: string): string[] {
  return [...xml.matchAll(/<cac:(?:Invoice|CreditNote)Line>([\s\S]*?)<\/cac:(?:Invoice|CreditNote)Line>/g)].map((m) => m[1]);
}
function num(block: string, re: RegExp): number | null {
  const m = block.match(re);
  return m ? Number(m[1]) : null;
}

for (const g of CASES) {
  test(`[DEEL-CREDIT-UBL] ${g.naam} — the file still reproduces every line amount`, () => {
    const { xml, totalExBtw } = creditnotaUbl(g);

    // Eerst het bedrag zelf. Een bestand dat perfect valideert over het verkeerde bedrag is geen
    // geslaagde test — dat was precies de € 17,50-fout.
    assert.equal(totalExBtw, g.expectedEx, "the credited amount itself must be right first");

    const blocks = lineBlocks(xml);
    assert.ok(blocks.length > 0, "a creditnota without lines has nothing to check");

    let sum = 0;
    for (const b of blocks) {
      const lea = num(b, /<cbc:LineExtensionAmount[^>]*>([-\d.]+)</);
      const aantal = num(b, /<cbc:(?:Invoiced|Credited)Quantity[^>]*>([-\d.]+)</);
      const prijs = num(b, /<cbc:PriceAmount[^>]*>([-\d.]+)</);
      const baseQuantity = num(b, /<cbc:BaseQuantity[^>]*>([-\d.]+)</) ?? 1;
      const aftrek = num(b, /<cac:AllowanceCharge>[\s\S]*?<cbc:Amount[^>]*>([-\d.]+)</) ?? 0;

      assert.ok(lea !== null && aantal !== null && prijs !== null,
        "a line must carry an amount, a quantity and a price");
      sum += lea as number;

      // BR-27: een prijs is een prijs. Het teken van een creditnota zit in het AANTAL.
      assert.ok((prijs as number) >= 0, `BR-27: PriceAmount may not be negative (${prijs})`);

      // PEPPOL-EN16931-R120 — de regel die het access point echt narekent.
      const gereproduceerd = round2(((aantal as number) / baseQuantity) * (prijs as number) - aftrek);
      assert.equal(gereproduceerd, lea,
        `R120: (${aantal} / ${baseQuantity}) × ${prijs} − ${aftrek} must equal ${lea}`);
    }

    // BR-CO-10 — wijkt dit een cent af, dan wordt het hele document geweigerd, hoe goed de regels
    // afzonderlijk ook kloppen.
    const legal = num(xml, /<cac:LegalMonetaryTotal>[\s\S]*?<cbc:LineExtensionAmount[^>]*>([-\d.]+)</);
    assert.equal(round2(sum), legal, "BR-CO-10: the sum of the line amounts must equal LegalMonetaryTotal");
  });
}

test("[DEEL-CREDIT-UBL] a FULL credit is still exactly the old path", () => {
  // De weg die er al was mag door dit alles niet één cent zijn verschoven: elke creditnota die deze
  // app ooit heeft gemaakt liep hierlangs.
  const lines = [{ id: "a", description: "Advies", quantity: 10, unit_price: 50, btw_rate: 21, unit: null,
                   discount_type: "amount", discount_value: 25 }];
  const src = lines.map((l) => ({ ...l, line_total: lineNetEx(l as never) }));
  const heel = buildCreditSelection({ lines: src as never, selection: null });
  assert.equal(heel.isFull, true);
  assert.equal(heel.totalExBtw, 475, "ten at fifty, minus the twenty-five that came off the line");
});
