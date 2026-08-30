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
  pushHoldFlagsOf,
  pushHoldReason,
  acknowledgedFlags,
  PUSH_BLOCKING_FLAGS,
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
import { quarterRange as kasboekQuarterRange } from "./kasboek";
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

  // [BON-NUMMER] Een VERZONNEN nummer moet hier net zo hard stoppen als een leeg nummer.
  // Dit was het lek: een leeg veld werd geweigerd, maar "CAMERA-1784373782895" glipte erdoor
  // en landde als factuurnummer op een inkoopboeking in het wettelijke inkoopboek — een
  // kenmerk dat op geen enkel papier terug te vinden is, en dat na 'verwerkt' bevroor.
  for (const verzonnen of [
    "CAMERA-1784373782895",
    "UPLOAD-1700000000000",
    "EMAIL-1699999999999",
  ]) {
    const p = isPushable(invoice({ invoice_number: verzonnen }));
    assert.equal(p.ok === false && p.code, "MISSING_NUMBER", `${verzonnen} mag niet doorgaan`);
  }

  // En een ECHT nummer gaat gewoon door — ook een bonnummer met een schuine streep erin.
  assert.equal(isPushable(invoice({ invoice_number: "2/667957" })).ok, true);
  assert.equal(isPushable(invoice({ invoice_number: "CAMERA-OPNAME-7" })).ok, true,
    "alleen prefix + puur tijdstempel is een plaatshouder, niet elk nummer met 'CAMERA' erin");

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

test("[KWARTAALGRENS] beide implementaties van het kwartaalvenster zeggen hetzelfde", () => {
  // Er zijn er TWEE: snelstart-queue.quarterRange ({from,to}) en kasboek.quarterRange
  // ({start,end}). Ze zijn het vandaag met elkaar eens — en dat is precies de toestand waar dit
  // repo elders voor waarschuwt: "two roundings that agree today diverge the first time one of
  // them is improved" (accountant-pricing.ts).
  //
  // Hier is de inzet de aangifte zelf. Een kwartaalgrens bepaalt in WELKE btw-aangifte een euro
  // valt; lopen de twee uiteen, dan telt de ene motor een betaling in Q1 en de andere in Q2, en
  // geen van beide meldt iets. Andere veldnamen maakten dat verschil bovendien onzichtbaar voor
  // de typechecker.
  //
  // Vier kwartalen over een schrikkeljaar en een gewoon jaar; kwartalen eindigen nooit in
  // februari, dus de schrikkeldag toetst hier de kalenderrekensom en niet de grens zelf.
  for (const year of [2024, 2026, 2027]) {
    for (const q of [1, 2, 3, 4] as const) {
      const queue = quarterRange(year, q);
      const kas = kasboekQuarterRange(year, q);
      assert.equal(queue.from, kas.start, `${year} Q${q}: startdatum loopt uiteen`);
      assert.equal(queue.to, kas.end, `${year} Q${q}: einddatum loopt uiteen`);
    }
  }
});

test("[KWARTAALGRENS] de vier kwartalen sluiten op elkaar aan en laten geen dag vallen", () => {
  // Een gat tussen Q1 en Q2 is een dag waarvan de omzet in geen enkele aangifte zit; een overlap
  // is een dag die in twee aangiftes zit. Beide zijn stil.
  const year = 2026;
  assert.equal(quarterRange(year, 1).from, `${year}-01-01`, "het jaar begint niet op 1 januari");
  assert.equal(quarterRange(year, 4).to, `${year}-12-31`, "het jaar eindigt niet op 31 december");
  for (const q of [1, 2, 3] as const) {
    const eind = new Date(`${quarterRange(year, q).to}T00:00:00Z`);
    const volgende = new Date(`${quarterRange(year, (q + 1) as 2 | 3 | 4).from}T00:00:00Z`);
    assert.equal(
      (volgende.getTime() - eind.getTime()) / 86_400_000,
      1,
      `Q${q} en Q${q + 1} sluiten niet op elkaar aan`,
    );
  }
});


// ─── [CREDIT-SIGN-PUSH] The last door ─────────────────────────────────────────
// Every other refusal in isPushable is about a document that is INCOMPLETE. This one is complete
// and wrong, which is worse: the sum reconciles to the cent, so nothing downstream objects, and
// SnelStart has no opinion about whether a supplier's CR-numbered document was a credit.

const sweets = (over: Partial<SnelStartInvoice> = {}): SnelStartInvoice => ({
  id: "cr", invoice_number: "CR0301267", invoice_date: "2026-07-02", due_date: "2026-08-01",
  direction: "incoming", invoice_type: "factuur", status: "received",
  total_ex_btw: 31.07, btw_amount: 2.8, total_inc_btw: 33.87,
  client_name: "Dutch Sweets Company B.V.", ...over,
});

test("[CREDIT-SIGN-PUSH] a credit-numbered document booked as a debt does not leave the building", () => {
  const check = isPushable(sweets());
  assert.equal(check.ok, false);
  assert.equal(check.ok === false && check.code, "CREDIT_SIGN_UNRESOLVED");
  // Its amounts are perfect — 31,07 + 2,80 = 33,87 — so no other gate would ever have stopped it.
  assert.ok(Math.abs(31.07 + 2.8 - 33.87) < 0.005, "the fixture reconciles exactly");
});

test("[CREDIT-SIGN-PUSH] the refusal names the way out, because it stands between the owner and their boekhouder", () => {
  const dutch = dutchMappingError("CREDIT_SIGN_UNRESOLVED");
  assert.match(dutch, /creditnota/i, "it must name what it thinks this is");
  assert.match(dutch, /btw/i, "and why it matters — the btw goes the wrong way");
  assert.match(dutch, /opnieuw/i, "and that the push can be retried after the fix");
});

test("[CREDIT-SIGN-PUSH] and it pushes the moment the sign is resolved", () => {
  // The exit that makes refusing safe. One tap flips the triplet and sets the type; the row is then
  // a creditnota with the sign of one, which the mapping already books as the mirror of an invoice.
  const fixed = sweets({ invoice_type: "creditnota", total_ex_btw: -31.07, btw_amount: -2.8, total_inc_btw: -33.87 });
  assert.equal(isPushable(fixed).ok, true, "a correctly booked creditnota is pushable");
});

test("[CREDIT-SIGN-PUSH] it stays out of the way of everything else", () => {
  // The false-positive side. An ordinary invoice from the same supplier, a credit note already
  // stored negative, and a number with no credit prefix must all pass exactly as before.
  assert.equal(isPushable(sweets({ invoice_number: "RE0802039", total_ex_btw: 679.33, btw_amount: 61.14, total_inc_btw: 740.47 })).ok, true);
  assert.equal(isPushable(sweets({ total_inc_btw: -33.87, total_ex_btw: -31.07, btw_amount: -2.8 })).ok, true);
  assert.equal(isPushable(sweets({ invoice_number: "2033161" })).ok, true);
});

// ─── [PUSH-ACK] Voorbehouden houden de boeking tegen; het akkoord van de eigenaar heft ze op ──

const ack = (flags: string[]) => ({ _push_ack: { at: "2026-08-03T10:00:00Z", by: "u1", flags } });
const dubbel = { _safecore: { possible_duplicate: true, possible_duplicate_of: "F-2001" } };

const held = (fc: unknown, over: Partial<SnelStartInvoice> = {}): SnelStartInvoice => ({
  id: "h", invoice_number: "2033161", invoice_date: "2026-05-10", due_date: "2026-06-10",
  direction: "incoming", invoice_type: "factuur", status: "received",
  total_ex_btw: 100, btw_amount: 21, total_inc_btw: 121, client_name: "Groothandel",
  field_confidence: fc, ...over,
});

test("[PUSH-ACK] a flagged invoice does not reach the accountant's ledger by itself", () => {
  const check = isPushable(held(dubbel));
  assert.equal(check.ok, false);
  assert.equal(check.ok === false && check.code, "NEEDS_REVIEW");
  assert.deepEqual(pushHoldFlagsOf(held(dubbel)), ["possibleDuplicate"]);
});

test("[PUSH-ACK] the owner's acknowledgement releases exactly what it acknowledged", () => {
  const cleared = held({ ...dubbel, ...ack(["possibleDuplicate"]) });
  assert.equal(isPushable(cleared).ok, true, "ticked off → it books");
  assert.deepEqual(pushHoldFlagsOf(cleared), []);
});

test("[PUSH-ACK] …and NOT a warning that appeared afterwards", () => {
  // The reason the acknowledgement lists its flags instead of releasing the invoice wholesale. A
  // changed bank account is the signature of invoice fraud and is often discovered on a LATER
  // import — one tap on last week's duplicate warning must not disarm it.
  const later = held({
    _safecore: { possible_duplicate: true, iban_changed: true, iban_changed_from: "NL91ABNA0417164300", iban_changed_to: "NL02RABO0123456789" },
    ...ack(["possibleDuplicate"]),
  });
  assert.deepEqual(pushHoldFlagsOf(later), ["ibanChanged"]);
  assert.equal(isPushable(later).ok, false, "the new warning still holds the booking");
});

test("[PUSH-ACK] every blocking flag has a sentence, and every sentence says what to check", () => {
  // A refusal the owner cannot picture is one they cannot act on, and this one stands between them
  // and their boekhouder. An empty or generic reason would make the button the only thing to read.
  for (const flag of PUSH_BLOCKING_FLAGS) {
    const reason = pushHoldReason(flag);
    assert.ok(reason.length > 25, `${flag} has no usable sentence`);
    assert.match(reason, /controleer|kloppen|bevat|rekeningnummer/i, `${flag}'s reason names nothing to check`);
  }
});

test("[PUSH-ACK] a clean invoice is untouched, and a missing field_confidence changes nothing", () => {
  // The quiet side. Adding a gate that holds everything would be worse than the gap it closes.
  assert.equal(isPushable(held(null)).ok, true, "no signals → nothing to hold");
  assert.equal(isPushable(held({ vendor: 0.99, invoice_number: 0.98, invoice_date: 0.99 })).ok, true);
  // A call site that never passes the column keeps its old behaviour rather than being blocked by
  // a field it does not know about.
  const legacy = { ...held(null) };
  delete (legacy as { field_confidence?: unknown }).field_confidence;
  assert.equal(isPushable(legacy).ok, true, "an older call site is not silently blocked");
});

test("[PUSH-ACK] a malformed acknowledgement grants nothing", () => {
  // Fail closed on junk: a hand-made row, or an older shape, must not read as blanket permission.
  for (const junk of [{ _push_ack: true }, { _push_ack: { flags: "possibleDuplicate" } }, { _push_ack: {} }, { _push_ack: null }]) {
    assert.deepEqual(acknowledgedFlags(junk), new Set(), JSON.stringify(junk));
    assert.equal(isPushable(held({ ...dubbel, ...junk })).ok, false);
  }
});
