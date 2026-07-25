// [SNELSTART] Pure node test — run: npx tsx --test src/lib/snelstart-mapping.test.ts
//
// Legt de boekhoudkundige regels van de koppeling vast. Deze vier zijn het belangrijkst,
// want elk ervan zet bij een fout een onwaarheid in een échte administratie:
//   • alleen gecontroleerde facturen/creditnota's worden geboekt;
//   • het BTW-soort komt uit de administratie, wordt nooit geraden;
//   • regels + BTW tellen exact op tot het factuurbedrag;
//   • een creditnota is het spiegelbeeld van een factuur.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildBoekingLines,
  deriveHeaderRate,
  dutchMappingError,
  isPushable,
  mapInvoiceToBoeking,
  relatieSoortFor,
  resolveBtwSoort,
  round2,
  SnelStartMappingError,
  toSnelStartDate,
  type SnelStartInvoice,
  type SnelStartInvoiceLine,
} from "./snelstart-mapping";
import { quarterRange } from "./snelstart-queue";
import type { SnelStartBtwTarief } from "./snelstart-client";

const GB = "11111111-1111-4111-8111-111111111111"; // grootboek-id
const REL = "22222222-2222-4222-8222-222222222222"; // relatie-id

const TARIEVEN: SnelStartBtwTarief[] = [
  { btwSoort: "Geen", percentage: 0 },
  { btwSoort: "Laag", percentage: 9 },
  { btwSoort: "Hoog", percentage: 21 },
];

function invoice(over: Partial<SnelStartInvoice> = {}): SnelStartInvoice {
  return {
    id: "inv-1",
    invoice_number: "2026-001",
    invoice_date: "2026-04-12",
    due_date: "2026-05-12",
    direction: "outgoing",
    invoice_type: "factuur",
    status: "sent",
    total_ex_btw: 100,
    btw_amount: 21,
    total_inc_btw: 121,
    client_name: "Bakkerij Jansen",
    ...over,
  };
}

const line = (over: Partial<SnelStartInvoiceLine> = {}): SnelStartInvoiceLine => ({
  description: "Werkzaamheden",
  quantity: 1,
  unit_price: 100,
  btw_rate: 21,
  line_total: 100,
  ...over,
});

// ── Wat mag er door ───────────────────────────────────────────────────────────

test("alleen gecontroleerde facturen en creditnota's zijn boekbaar", () => {
  assert.equal(isPushable(invoice()).ok, true);
  assert.equal(isPushable(invoice({ status: "paid" })).ok, true);
  assert.equal(isPushable(invoice({ direction: "incoming", status: "received" })).ok, true);
  assert.equal(isPushable(invoice({ invoice_type: "creditnota" })).ok, true);

  // Een concept, offerte of pro forma is geen feit — die hoort niet in een administratie.
  assert.equal(isPushable(invoice({ status: "draft" })).ok, false);
  assert.equal(isPushable(invoice({ invoice_type: "offerte" })).ok, false);
  assert.equal(isPushable(invoice({ invoice_type: "pro_forma" })).ok, false);
  assert.equal(isPushable(invoice({ status: "archived" })).ok, false);
  // Inkomend en nog niet gecontroleerd ('processing'/'unclear') blijft staan.
  assert.equal(isPushable(invoice({ direction: "incoming", status: "processing" })).ok, false);
  assert.equal(isPushable(invoice({ direction: "incoming", status: "unclear" })).ok, false);
  // Zonder richting weten we niet of het kosten of omzet is.
  assert.equal(isPushable(invoice({ direction: null })).ok, false);
});

test("ontbrekende kerngegevens geven een gerichte reden", () => {
  const noNumber = isPushable(invoice({ invoice_number: "  " }));
  assert.equal(noNumber.ok === false && noNumber.code, "MISSING_NUMBER");

  const noDate = isPushable(invoice({ invoice_date: null }));
  assert.equal(noDate.ok === false && noDate.code, "MISSING_DATE");

  const noName = isPushable(invoice({ client_name: null }));
  assert.equal(noName.ok === false && noName.code, "MISSING_RELATION");

  const noAmount = isPushable(invoice({ total_inc_btw: 0 }));
  assert.equal(noAmount.ok === false && noAmount.code, "NO_AMOUNTS");

  // Elke reden heeft een Nederlandse tekst — geen enkele code valt door de mand.
  for (const code of [
    "NOT_EXPORTABLE",
    "MISSING_NUMBER",
    "MISSING_DATE",
    "MISSING_RELATION",
    "NO_AMOUNTS",
    "AMOUNT_MISMATCH",
    "NO_BTW_MATCH",
  ] as const) {
    assert.ok(dutchMappingError(code).length > 10);
  }
});

// ── BTW ───────────────────────────────────────────────────────────────────────

test("BTW-soort komt uit de administratie, niet uit een aanname", () => {
  assert.equal(resolveBtwSoort(TARIEVEN, 21), "Hoog");
  assert.equal(resolveBtwSoort(TARIEVEN, 9), "Laag");
  assert.equal(resolveBtwSoort(TARIEVEN, 0), "Geen");

  // Een administratie met eigen namen wordt letterlijk gevolgd.
  assert.equal(
    resolveBtwSoort([{ btwSoort: "HoogTarief", percentage: 21 }], 21),
    "HoogTarief",
  );

  // Verleggen is een expliciete keuze van de gebruiker, geen automatische afleiding.
  const metVerlegd: SnelStartBtwTarief[] = [
    { btwSoort: "VerlegdHoog", percentage: 21 },
    { btwSoort: "Hoog", percentage: 21 },
  ];
  assert.equal(resolveBtwSoort(metVerlegd, 21), "Hoog");

  // Onbekend tarief → blokkeren in plaats van iets verkeerds boeken.
  assert.throws(
    () => resolveBtwSoort(TARIEVEN, 6),
    (err: unknown) => err instanceof SnelStartMappingError && err.code === "NO_BTW_MATCH",
  );
});

test("kop-percentage wordt afgeleid en naar het echte tarief getrokken", () => {
  assert.equal(deriveHeaderRate(invoice()), 21);
  assert.equal(deriveHeaderRate(invoice({ total_ex_btw: 100, btw_amount: 9 })), 9);
  assert.equal(deriveHeaderRate(invoice({ total_ex_btw: 100, btw_amount: 0 })), 0);
  // OCR-centen: 20,98% is 21%.
  assert.equal(deriveHeaderRate(invoice({ total_ex_btw: 100, btw_amount: 20.98 })), 21);
  // Geen bedragen → 0, geen NaN/Infinity de administratie in.
  assert.equal(deriveHeaderRate(invoice({ total_ex_btw: 0, btw_amount: 0 })), 0);
});

// ── Regels ────────────────────────────────────────────────────────────────────

test("factuurregels worden regel-voor-regel geboekt met BTW gebundeld per soort", () => {
  const { boekingsregels, btw } = buildBoekingLines({
    invoice: invoice({ total_ex_btw: 150, btw_amount: 25.5, total_inc_btw: 175.5 }),
    lines: [
      line({ description: "Advies", line_total: 100, btw_rate: 21 }),
      line({ description: "Brood", line_total: 50, btw_rate: 9 }),
    ],
    tarieven: TARIEVEN,
    grootboekId: GB,
  });

  assert.equal(boekingsregels.length, 2);
  assert.deepEqual(
    boekingsregels.map((r) => [r.omschrijving, r.bedrag, r.btwSoort]),
    [
      ["Advies", 100, "Hoog"],
      ["Brood", 50, "Laag"],
    ],
  );
  assert.equal(boekingsregels[0].grootboek.id, GB);
  assert.deepEqual(
    [...btw].sort((a, b) => a.btwSoort.localeCompare(b.btwSoort)),
    [
      { btwSoort: "Hoog", btwBedrag: 21 },
      { btwSoort: "Laag", btwBedrag: 4.5 },
    ].sort((a, b) => a.btwSoort.localeCompare(b.btwSoort)),
  );
});

test("regels die het kopbedrag niet verklaren worden genegeerd — de kop is de waarheid", () => {
  const { boekingsregels } = buildBoekingLines({
    invoice: invoice(), // kop: 100 excl.
    lines: [line({ line_total: 40 })], // regels verklaren maar 40
    tarieven: TARIEVEN,
    grootboekId: GB,
  });
  assert.equal(boekingsregels.length, 1);
  assert.equal(boekingsregels[0].bedrag, 100);
});

test("facturen zonder regels (ingelezen inkoop) krijgen één regel uit de kop", () => {
  const { boekingsregels, btw } = buildBoekingLines({
    invoice: invoice({
      direction: "incoming",
      status: "received",
      client_name: "Sligro",
      total_ex_btw: 80,
      btw_amount: 7.2,
      total_inc_btw: 87.2,
    }),
    lines: [],
    tarieven: TARIEVEN,
    grootboekId: GB,
  });
  assert.equal(boekingsregels.length, 1);
  assert.equal(boekingsregels[0].bedrag, 80);
  assert.equal(boekingsregels[0].btwSoort, "Laag");
  assert.deepEqual(btw, [{ btwSoort: "Laag", btwBedrag: 7.2 }]);
});

test("afrondingsruis van een cent wordt gecorrigeerd, een echt verschil blokkeert", () => {
  // 33,33 + 33,33 + 33,34 = 100,00 — de kop klopt, de BTW-berekening rondt af.
  const { boekingsregels, btw } = buildBoekingLines({
    invoice: invoice(),
    lines: [
      line({ line_total: 33.33 }),
      line({ line_total: 33.33 }),
      line({ line_total: 33.34 }),
    ],
    tarieven: TARIEVEN,
    grootboekId: GB,
  });
  assert.equal(round2(boekingsregels.reduce((s, r) => s + r.bedrag, 0)), 100);
  assert.equal(btw.reduce((s, b) => s + b.btwBedrag, 0), 21);

  // Excl. + BTW ≠ incl.: dit is een kapotte factuur, geen afrondingsdetail.
  assert.throws(
    () =>
      mapInvoiceToBoeking({
        invoice: invoice({ total_ex_btw: 100, btw_amount: 21, total_inc_btw: 200 }),
        lines: [line()],
        tarieven: TARIEVEN,
        grootboekId: GB,
        relatieId: REL,
      }),
    (err: unknown) => err instanceof SnelStartMappingError && err.code === "AMOUNT_MISMATCH",
  );
});

// ── De hele vertaling ─────────────────────────────────────────────────────────

test("uitgaande factuur wordt een verkoopboeking op de klant", () => {
  const { type, payload, amount } = mapInvoiceToBoeking({
    invoice: invoice(),
    lines: [line()],
    tarieven: TARIEVEN,
    grootboekId: GB,
    relatieId: REL,
  });

  assert.equal(type, "verkoopboeking");
  assert.deepEqual(payload.klant, { id: REL });
  assert.equal(payload.leverancier, undefined);
  assert.equal(payload.factuurnummer, "2026-001");
  assert.equal(payload.factuurDatum, "2026-04-12T00:00:00");
  assert.equal(payload.vervalDatum, "2026-05-12T00:00:00");
  assert.equal(payload.factuurBedrag, 121);
  assert.equal(amount, 121);
  assert.equal(
    round2(
      payload.boekingsregels.reduce((s, r) => s + r.bedrag, 0) +
        payload.btw.reduce((s, b) => s + b.btwBedrag, 0),
    ),
    payload.factuurBedrag,
  );
});

test("inkomende factuur wordt een inkoopboeking op de leverancier", () => {
  const { type, payload } = mapInvoiceToBoeking({
    invoice: invoice({ direction: "incoming", status: "received", client_name: "Sligro" }),
    lines: [line()],
    tarieven: TARIEVEN,
    grootboekId: GB,
    relatieId: REL,
  });

  assert.equal(type, "inkoopboeking");
  assert.deepEqual(payload.leverancier, { id: REL });
  assert.equal(payload.klant, undefined);
  assert.equal(payload.omschrijving, "Factuur 2026-001 — Sligro");
});

test("een creditnota is het exacte spiegelbeeld van de factuur", () => {
  const factuur = mapInvoiceToBoeking({
    invoice: invoice(),
    lines: [line()],
    tarieven: TARIEVEN,
    grootboekId: GB,
    relatieId: REL,
  });
  const credit = mapInvoiceToBoeking({
    invoice: invoice({ invoice_type: "creditnota" }),
    lines: [line()],
    tarieven: TARIEVEN,
    grootboekId: GB,
    relatieId: REL,
  });

  assert.equal(credit.payload.factuurBedrag, -factuur.payload.factuurBedrag);
  assert.equal(credit.payload.boekingsregels[0].bedrag, -factuur.payload.boekingsregels[0].bedrag);
  assert.equal(credit.payload.btw[0].btwBedrag, -factuur.payload.btw[0].btwBedrag);
  assert.equal(credit.payload.omschrijving.startsWith("Creditnota"), true);
});

test("een niet-boekbare factuur komt de vertaling niet in", () => {
  assert.throws(
    () =>
      mapInvoiceToBoeking({
        invoice: invoice({ status: "draft" }),
        lines: [line()],
        tarieven: TARIEVEN,
        grootboekId: GB,
        relatieId: REL,
      }),
    (err: unknown) => err instanceof SnelStartMappingError && err.code === "NOT_EXPORTABLE",
  );
});

// ── Kleine bouwstenen ─────────────────────────────────────────────────────────

test("round2 rondt symmetrisch af, ook onder nul", () => {
  assert.equal(round2(0.005), 0.01);
  assert.equal(round2(-0.005), -0.01);
  assert.equal(round2(12.344), 12.34);
  assert.equal(round2(12.346), 12.35);

  // Dít is waarom round2 het teken apart houdt: met Math.round(x*100) rondt een negatief
  // bedrag de andere kant op dan zijn positieve tweelingbroer, en dan is een creditnota
  // niet meer exact het spiegelbeeld van de factuur.
  for (const n of [0.005, 1.015, 2.675, 12.345, 99.995]) {
    assert.equal(round2(-n), -round2(n), `spiegel van ${n}`);
  }
});

test("datums gaan als ISO-tijdstip mee en richting bepaalt de relatiesoort", () => {
  assert.equal(toSnelStartDate("2026-01-09"), "2026-01-09T00:00:00");
  assert.equal(relatieSoortFor("incoming"), "Leverancier");
  assert.equal(relatieSoortFor("outgoing"), "Klant");
});

test("kwartaalvenster dekt de hele periode, ook in een schrikkeljaar", () => {
  assert.deepEqual(quarterRange(2026, 1), { from: "2026-01-01", to: "2026-03-31" });
  assert.deepEqual(quarterRange(2026, 2), { from: "2026-04-01", to: "2026-06-30" });
  assert.deepEqual(quarterRange(2026, 4), { from: "2026-10-01", to: "2026-12-31" });
  assert.deepEqual(quarterRange(2024, 1), { from: "2024-01-01", to: "2024-03-31" });
});
