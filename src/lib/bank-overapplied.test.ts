// [BANK-OVERAPPLIED-LOUD] Run: npx tsx --test src/lib/bank-overapplied.test.ts
//
// De race die dit bestand NIET sluit, is gedocumenteerd. Wat het wél belooft is dat de stand nooit
// STIL verkeerd kan zijn — dus de tests die ertoe doen zijn die over het verschil tussen "niets aan
// de hand" en "de controle heeft niet gedraaid".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readOverApplied, overAppliedNotice } from "./bank-overapplied";

const USER = "11111111-2222-3333-4444-555555555555";
const TX = "aaaaaaaa-0000-0000-0000-000000000001";

/** Een nep-client die precies de vorm teruggeeft die PostgREST teruggeeft. */
function nepClient(opts: {
  links?: { data: unknown[] | null; error: { message: string } | null };
  invoices?: { data: unknown[] | null; error: { message: string } | null };
  gooit?: boolean;
}) {
  return {
    from(tabel: string) {
      if (opts.gooit) throw new Error("verbinding weg");
      const antwoord = tabel === "bank_tx_invoices"
        ? (opts.links ?? { data: [], error: null })
        : (opts.invoices ?? { data: [], error: null });
      const ketting: Record<string, unknown> = {};
      const zelf = () => ketting;
      for (const m of ["select", "eq", "in", "or", "order"]) ketting[m] = zelf;
      // De koppelingen worden zonder .range() opgehaald, de facturen mét (fetchAllRowsForIds).
      ketting.range = () => Promise.resolve(antwoord);
      ketting.then = (res: (v: unknown) => unknown) => Promise.resolve(antwoord).then(res);
      return ketting;
    },
  };
}

const FACTUUR = (id: string, total: number, direction = "incoming", type = "factuur") =>
  ({ id, direction, invoice_type: type, total_inc_btw: total });

test("een regel die precies is opgemaakt slaat geen alarm", async () => {
  const v = await readOverApplied({
    client: nepClient({
      links: { data: [{ invoice_id: "i1", amount_applied: 850 }], error: null },
      invoices: { data: [FACTUUR("i1", 850)], error: null },
    }),
    userId: USER, transactionId: TX, txAmount: -850,
  });
  assert.ok(v);
  assert.equal(v.over, false);
  assert.equal(v.appliedSum, 850);
});

test("twee facturen op één regel die samen boven het bedrag uitkomen: alarm", async () => {
  // Precies de vorm die in de productiedatabase staat: een regel van € 0,59 met tweemaal € 0,59.
  const v = await readOverApplied({
    client: nepClient({
      links: { data: [{ invoice_id: "i1", amount_applied: 0.59 }, { invoice_id: "i2", amount_applied: 0.59 }], error: null },
      invoices: { data: [FACTUUR("i1", 0.59), FACTUUR("i2", 0.59)], error: null },
    }),
    userId: USER, transactionId: TX, txAmount: -0.59,
  });
  assert.ok(v);
  assert.equal(v.over, true);
  assert.equal(v.appliedSum, 1.18);
});

test("[LIJN-BUDGET] een creditnota op de regel geeft geld TERUG en slaat dus geen alarm", async () => {
  // De reden dat dit getekend telt. Een debet van € 850 opgebouwd uit een inkoopfactuur van
  // € 1.000 en een inkoopcredit van € 150: magnitudes tellen op tot € 1.150 en zouden alarm slaan
  // over een boeking die precies klopt. Getekend is het € 850.
  const v = await readOverApplied({
    client: nepClient({
      links: { data: [{ invoice_id: "i1", amount_applied: 1000 }, { invoice_id: "c1", amount_applied: 150 }], error: null },
      invoices: { data: [FACTUUR("i1", 1000), FACTUUR("c1", -150, "incoming", "creditnota")], error: null },
    }),
    userId: USER, transactionId: TX, txAmount: -850,
  });
  assert.ok(v);
  assert.equal(v.appliedSum, 850, "de credit gaf € 150 terug aan de regel");
  assert.equal(v.over, false);
});

test("een cent afrondingsstof is geen over-besteding", async () => {
  const v = await readOverApplied({
    client: nepClient({
      links: { data: [{ invoice_id: "i1", amount_applied: 850.01 }], error: null },
      invoices: { data: [FACTUUR("i1", 850.01)], error: null },
    }),
    userId: USER, transactionId: TX, txAmount: -850,
  });
  assert.ok(v);
  assert.equal(v.over, false);
});

test("een NULL bedrag betekent 'volledig voldaan', niet 'niets'", async () => {
  // Een koppeling van vóór de kolom. NULL als 0 lezen maakt de regel rijker dan ze is, en dat is
  // de richting waarin dezelfde euro twee keer kan worden uitgegeven.
  const v = await readOverApplied({
    client: nepClient({
      links: { data: [{ invoice_id: "i1", amount_applied: null }, { invoice_id: "i2", amount_applied: 500 }], error: null },
      invoices: { data: [FACTUUR("i1", 1000), FACTUUR("i2", 500)], error: null },
    }),
    userId: USER, transactionId: TX, txAmount: -1000,
  });
  assert.ok(v);
  assert.equal(v.appliedSum, 1500, "de NULL telt voor het eigen totaal van haar factuur");
  assert.equal(v.over, true);
});

test("een mislukte lezing is GEEN 'niets aan de hand'", async () => {
  // De hele reden dat dit null teruggeeft en niet 0. supabase-js gooit niet op een queryfout, dus
  // zonder dit onderscheid gaf een mislukte herlezing een som van 0 — en 0 is nooit groter dan het
  // regelbedrag. De enige waarborg tegen de enige race die dit pad openlaat verdween dan in stilte.
  const v = await readOverApplied({
    client: nepClient({ links: { data: null, error: { message: "timeout" } } }),
    userId: USER, transactionId: TX, txAmount: -850,
  });
  assert.equal(v, null);
});

test("een zusterkoppeling waarvan de factuur onleesbaar is maakt de som onmeetbaar", async () => {
  // Niet meetbaar mag geen alarm slaan én geen stilte rechtvaardigen — dezelfde behandeling als
  // een leesfout, want een som waar een post uit ontbreekt staat te LAAG.
  const v = await readOverApplied({
    client: nepClient({
      links: { data: [{ invoice_id: "i1", amount_applied: 900 }, { invoice_id: "weg", amount_applied: 900 }], error: null },
      invoices: { data: [FACTUUR("i1", 900)], error: null },
    }),
    userId: USER, transactionId: TX, txAmount: -850,
  });
  assert.equal(v, null);
});

test("een client die gooit laat de boeking staan en meldt niets", async () => {
  const v = await readOverApplied({ client: nepClient({ gooit: true }), userId: USER, transactionId: TX, txAmount: -850 });
  assert.equal(v, null);
});

test("de zin noemt beide bedragen en zegt wat de eigenaar moet doen", async () => {
  const bericht = overAppliedNotice({ appliedSum: 1.18, lineAmount: 0.59, over: true });
  assert.match(bericht.body, /€ 0\.59/);
  assert.match(bericht.body, /€ 1\.18/);
  assert.match(bericht.body, /Ontkoppel/, "een waarschuwing zonder handeling is een zorg, geen bericht");
});
