// [WERK] Pure node test — run: npx tsx --test src/lib/werk.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  hasWorkLayer, workSkin, readFields, readLines, linesTotalEx, storedLines, workMargin, workCounts,
  canInvoice, canDelete, statusKey, WORK_STATUSES, HAND_STATUSES,
  storedVisits, readVisit, unbilledVisits, addRepeat, nextVisitOn, visitInvoiceLines, shortDateNL,
  canInvoiceTogether, togetherGroups, workInvoiceLines, REPEATS, REPEAT_KEYS, isRepeat,
  financialReadiness, overBudget, workSignals,
  contractFee, canInvoicePeriod, periodInvoiceLines, periodLabelNL, storedPeriods, daysUntil, contractStat, contractGroups, periodOf,
  bundleHours, bundleState, canInvoiceBundle, bundleInvoiceLines,
} from "./werk";

test("[WERK] the layer exists for the four verticals and their sister trades, and for nobody else", () => {
  assert.equal(workSkin("automonteur")?.skin, "werkorder");
  assert.equal(workSkin("transport")?.skin, "rit");
  assert.equal(workSkin("bouw-klus")?.skin, "klus");
  assert.equal(workSkin("loodgieter")?.skin, "klus");
  assert.equal(workSkin("elektricien")?.skin, "klus");
  assert.equal(workSkin("schilder")?.skin, "klus");
  assert.equal(workSkin("schoonmaak")?.skin, "opdracht");
  // [WERK-2] The fietsenmaker's reparatiebon, the consultant's opdracht, the hovenier's repeating garden.
  assert.equal(workSkin("fietsenmaker")?.skin, "reparatie");
  assert.equal(workSkin("dienstverlening")?.skin, "opdracht");
  assert.equal(workSkin("hovenier")?.skin, "klus");
  // [RIJSCHOOL] One leerling is the work; the lessen are its beurten; the lesauto is a vehicle.
  assert.equal(workSkin("rijschool")?.skin, "les");
  assert.equal(workSkin("rijschool")?.recurring, true);
  assert.equal(workSkin("rijschool")?.vehicle, true);
  assert.deepEqual(workSkin("rijschool")?.visitKeys, { list: "werk.les.lessen", done: "werk.les.lesGedaan", invoice: "werk.les.lesFactuur", open: "werk.les.lessenOpen" });
  assert.equal(workSkin("hovenier")?.recurring, true);
  assert.equal(workSkin("bouw-klus")?.recurring, false, "a builder's klus happens once");
  assert.equal(workSkin("schoonmaak")?.recurring, true);
  assert.equal(workSkin("automonteur")?.recurring, false);
  // A kapper's app stays exactly what it was: the haircut is rung up at the Kassa.
  assert.equal(hasWorkLayer("kapper"), false);
  assert.equal(hasWorkLayer(null), false);
  assert.equal(hasWorkLayer("astronaut"), false);
  assert.equal(workSkin("astronaut"), null);
});

test("[WERK] every skin's statuses are drawn from the one closed set, in the trade's order", () => {
  for (const vak of ["automonteur", "transport", "bouw-klus", "schoonmaak", "fietsenmaker", "dienstverlening", "rijschool"]) {
    const skin = workSkin(vak)!;
    for (const s of skin.statuses) {
      assert.ok(WORK_STATUSES.includes(s), `${vak}: ${s} is not a work status`);
      assert.equal(statusKey(skin, s), `werk.status.${skin.skin}.${s}`, `${vak}: ${s} has the trade's own word`);
    }
    assert.equal(skin.statuses[0], "open", `${vak}: starts planned`);
    assert.ok(skin.statuses.includes("klaar") && skin.statuses.includes("gefactureerd"), `${vak}: finishes and invoices`);
    assert.ok(skin.lineKinds.length >= 2, `${vak}: charges at least two kinds of line`);
  }
  // A courier never waits for a part; a garage does. (EsGarage "wacht", Autoflex "Wachten op toestemming".)
  assert.ok(!workSkin("transport")!.statuses.includes("wacht_onderdeel"));
  assert.ok(workSkin("automonteur")!.statuses.includes("wacht_onderdeel"));
  assert.ok(!HAND_STATUSES.includes("gefactureerd"), "invoicing is a door, not a tap");
});

test("[WERK] the werkorder opens on a kenteken, the rit on two addresses, the klus on a werkadres", () => {
  assert.equal(workSkin("automonteur")!.vehicle, true);
  assert.deepEqual(workSkin("transport")!.fields.filter((f) => f.required).map((f) => f.key), ["van", "naar"]);
  assert.deepEqual(workSkin("bouw-klus")!.fields.filter((f) => f.required).map((f) => f.key), ["adres"]);
  assert.deepEqual(workSkin("schoonmaak")!.fields.filter((f) => f.required).map((f) => f.key), ["locatie"]);
  assert.deepEqual(workSkin("automonteur")!.lineKinds.map((k) => k.kind), ["arbeid", "onderdeel"]);
  assert.deepEqual(workSkin("bouw-klus")!.lineKinds.map((k) => k.kind), ["arbeid", "materiaal", "meerwerk", "voorrijkosten"]);
  assert.deepEqual(workSkin("hovenier")!.lineKinds.map((k) => k.kind), ["arbeid", "materiaal", "meerwerk", "voorrijkosten", "afvoer"]);
  // [WERK-3] The taxi line starts on 9%; the courier writes the time window and repeats a fixed route.
  assert.deepEqual(workSkin("transport")!.lineKinds.find((k) => k.kind === "personen")?.btw, 9);
  assert.ok(workSkin("transport")!.fields.some((f) => f.key === "laadtijd" && f.onCard));
  assert.equal(workSkin("transport")!.recurring, true);
  assert.ok(workSkin("automonteur")!.fields.some((f) => f.key === "telefoon"));
  // The reparatiebon opens on the bike; repair labour starts at 9%, a part at 21% (vak-sjablonen.ts).
  assert.deepEqual(workSkin("fietsenmaker")!.fields.filter((f) => f.required).map((f) => f.key), ["fiets"]);
  assert.equal(workSkin("fietsenmaker")!.vehicle, false, "a bike has no kenteken");
  assert.deepEqual(workSkin("fietsenmaker")!.lineKinds.map((k) => [k.kind, k.btw]), [["arbeid", 9], ["onderdeel", 21]]);
  const bike = readLines(workSkin("fietsenmaker")!, [{ kind: "arbeid", description: "Band plakken", quantity: 0.5, unit_price: 40 }, { kind: "onderdeel", description: "Binnenband", quantity: 1, unit_price: 8 }]);
  assert.deepEqual(bike.ok ? bike.lines.map((l) => l.btw_rate) : null, [9, 21], "the kind's own rate when none is typed");
  // The courier writes who took delivery.
  assert.ok(workSkin("transport")!.fields.some((f) => f.key === "ontvanger"));
  // The consultant's opdracht needs no location; the hours screen feeds it.
  assert.deepEqual(workSkin("dienstverlening")!.fields.filter((f) => f.required), []);
});

test("[WERK-BEURT] repeating work: rhythms, beurten read and stored, the next one due, and the lines an invoice gets", () => {
  assert.deepEqual([...REPEATS], ["week", "twee_weken", "vier_weken", "maand", "kwartaal"]);
  for (const r of REPEATS) assert.ok(REPEAT_KEYS[r].startsWith("werk.herhaal."));
  assert.equal(isRepeat("week"), true);
  assert.equal(isRepeat("dagelijks"), false);
  // Stored beurten: an unreadable day is dropped, never guessed.
  assert.deepEqual(storedVisits([{ on: "2026-09-01" }, { on: "gisteren" }, { on: "2026-09-08", note: " ramen ", invoice_id: "inv" }, null]),
    [{ on: "2026-09-01", note: null, invoice_id: null }, { on: "2026-09-08", note: "ramen", invoice_id: "inv" }]);
  assert.deepEqual(readVisit({}, [], "2026-09-08"), { ok: true, visit: { on: "2026-09-08", note: null, invoice_id: null } });
  assert.deepEqual(readVisit({ on: "8 september" }, [], "2026-09-08"), { ok: false, reason: "not_a_date" });
  assert.deepEqual(readVisit({}, new Array(400).fill({ on: "2026-01-01", note: null, invoice_id: null }), "2026-09-08"), { ok: false, reason: "too_many" });
  // Rhythms: weeks add days; a month clips to the last day.
  assert.equal(addRepeat("2026-09-01", "week"), "2026-09-08");
  assert.equal(addRepeat("2026-09-01", "twee_weken"), "2026-09-15");
  assert.equal(addRepeat("2026-12-25", "vier_weken"), "2027-01-22");
  assert.equal(addRepeat("2026-01-31", "maand"), "2026-02-28");
  assert.equal(addRepeat("2026-03-31", "maand"), "2026-04-30");
  assert.equal(addRepeat("2026-11-30", "kwartaal"), "2027-02-28");
  assert.equal(addRepeat("2026-12-15", "maand"), "2027-01-15");
  // Next beurt: after the last one done; before any, the planned day.
  assert.equal(nextVisitOn({ repeat_every: "week", visits: [{ on: "2026-09-01", note: null, invoice_id: null }, { on: "2026-09-08", note: null, invoice_id: null }], planned_on: "2026-08-01" }), "2026-09-15");
  assert.equal(nextVisitOn({ repeat_every: "week", visits: [], planned_on: "2026-09-10" }), "2026-09-10");
  assert.equal(nextVisitOn({ repeat_every: null, visits: [], planned_on: "2026-09-10" }), null);
  // The invoice: the lines once per unbilled beurt, the days named in Dutch on the line.
  const lines = [{ kind: "vast", description: "Schoonmaak kantoor", quantity: 1, unit: "post", unit_price: 85, btw_rate: 21 }, { kind: "arbeid", description: "Extra uren", quantity: 2, unit: "uur", unit_price: 30, btw_rate: 21 }];
  const visits = [{ on: "2026-09-08", note: null, invoice_id: null }, { on: "2026-09-01", note: null, invoice_id: null }, { on: "2026-08-25", note: null, invoice_id: "old" }];
  const billed = visitInvoiceLines(lines, unbilledVisits(visits));
  assert.deepEqual(billed.map((l) => [l.description, l.quantity]), [["Schoonmaak kantoor · 2 beurten (1 sep, 8 sep)", 2], ["Extra uren · 2 beurten (1 sep, 8 sep)", 4]]);
  assert.equal(linesTotalEx(billed), 290);
  assert.deepEqual(visitInvoiceLines(lines, []), [], "no beurt, no line");
  assert.equal(shortDateNL("2026-12-03"), "3 dec");
  // The guard: repeating work is invoiceable while a done beurt waits, never when nothing was done.
  assert.equal(canInvoice({ status: "bezig", invoice_id: null, repeat_every: "week", visits }), true);
  assert.equal(canInvoice({ status: "bezig", invoice_id: null, repeat_every: "week", visits: [visits[2]] }), false);
  assert.equal(canInvoice({ status: "geannuleerd", invoice_id: null, repeat_every: "week", visits }), false);
  assert.equal(canInvoice({ status: "bezig", invoice_id: null, repeat_every: null, visits }), false, "one-off work must be klaar");
});

test("[WERK-VERZAMEL] several finished pieces of work of one client go on one invoice, and nothing else does", () => {
  const rit = (over: Partial<{ id: string; status: string; invoice_id: string | null; repeat_every: string | null; client_id: string | null; client_name: string | null }>) =>
    ({ id: "r", status: "klaar", invoice_id: null, repeat_every: null, client_id: null, client_name: "Bol Logistiek", ...over });
  assert.deepEqual(canInvoiceTogether([rit({ id: "a" }), rit({ id: "b", client_name: " bol logistiek " })]), { ok: true });
  assert.deepEqual(canInvoiceTogether([rit({ id: "a" })]), { ok: false, reason: "too_few" });
  assert.deepEqual(canInvoiceTogether([rit({ id: "a" }), rit({ id: "b", status: "bezig" })]), { ok: false, reason: "not_invoiceable" });
  assert.deepEqual(canInvoiceTogether([rit({ id: "a" }), rit({ id: "b", invoice_id: "inv" })]), { ok: false, reason: "not_invoiceable" });
  assert.deepEqual(canInvoiceTogether([rit({ id: "a" }), rit({ id: "b", repeat_every: "week" })]), { ok: false, reason: "recurring" });
  assert.deepEqual(canInvoiceTogether([rit({ id: "a" }), rit({ id: "b", client_name: "PostNL" })]), { ok: false, reason: "different_clients" });
  assert.deepEqual(canInvoiceTogether([rit({ id: "a", client_id: "c1" }), rit({ id: "b", client_id: "c2", client_name: "Bol Logistiek" })]), { ok: false, reason: "different_clients" });
  assert.deepEqual(canInvoiceTogether([rit({ id: "a", client_name: null }), rit({ id: "b", client_name: null })]), { ok: false, reason: "no_client" });
  // The offer on the list: only clients with two or more, only finished and unbilled, never repeating.
  const groups = togetherGroups([rit({ id: "a" }), rit({ id: "b" }), rit({ id: "c", client_name: "PostNL" }), rit({ id: "d", status: "bezig" }), rit({ id: "e", client_name: "PostNL", repeat_every: "week" })]);
  assert.deepEqual(groups.map((g) => [g.client_name, g.rows.map((r) => r.id)]), [["Bol Logistiek", ["a", "b"]]]);
});

test("[WERK] the invoice lines: the car first, a heading on a verzamelfactuur, hours at their rate, then the work's own lines", () => {
  const skin = workSkin("automonteur")!;
  const row = { title: "Remmen vervangen", fields: { km_stand: 123456.4 }, lines: [{ kind: "onderdeel", description: "Remblokken", quantity: 1, unit: "stuk", unit_price: 89.9, btw_rate: 21 }], planned_on: "2026-09-08", done_on: null, repeat_every: null, visits: [] };
  const hour = { description: "Arbeid", quantity: 1.5, unit: "uur", unit_price: 65, btw_rate: 21 };
  const lines = workInvoiceLines({ skin, row, kenteken: "12-ABC-3", hourLines: [hour], heading: false });
  assert.deepEqual(lines.map((l) => [l.description, l.quantity, l.unit_price]), [["Kenteken 12-ABC-3 · km-stand 123456", 1, 0], ["Arbeid", 1.5, 65], ["Remblokken", 1, 89.9]]);
  // A rit on a verzamelfactuur gets its heading: day and route, at € 0.
  const ritSkin = workSkin("transport")!;
  const rit = { title: "Pallets", fields: { van: "Rotterdam", naar: "Eindhoven" }, lines: [{ kind: "ritprijs", description: "Ritprijs", quantity: 1, unit: "post", unit_price: 120, btw_rate: 21 }], planned_on: "2026-09-02", done_on: "2026-09-03", repeat_every: null, visits: [] };
  assert.deepEqual(workInvoiceLines({ skin: ritSkin, row: rit, kenteken: null, hourLines: [], heading: true }).map((l) => l.description), ["Pallets · 3 sep · Rotterdam → Eindhoven", "Ritprijs"]);
  assert.deepEqual(workInvoiceLines({ skin: ritSkin, row: rit, kenteken: null, hourLines: [], heading: false }).map((l) => l.description), ["Ritprijs"], "alone, no heading");
  // Repeating work bills its unbilled beurten, not its lines once.
  const opdracht = { ...rit, repeat_every: "week", visits: [{ on: "2026-09-01", note: null, invoice_id: null }, { on: "2026-09-08", note: null, invoice_id: null }] };
  assert.deepEqual(workInvoiceLines({ skin: workSkin("schoonmaak"), row: opdracht, kenteken: null, hourLines: [], heading: false }).map((l) => [l.description, l.quantity]), [["Ritprijs · 2 beurten (1 sep, 8 sep)", 2]]);
});

test("[WERK] fields: the trade's own, typed, Dutch decimals accepted, nonsense and missing required refused", () => {
  const rit = workSkin("transport")!;
  const ok = readFields(rit, { van: " Rotterdam ", naar: "Eindhoven", km: "112,5", colli: 3, chauffeur: "", onbekend: "x" });
  assert.deepEqual(ok, { ok: true, fields: { van: "Rotterdam", naar: "Eindhoven", colli: 3, km: 112.5 } });
  assert.deepEqual(readFields(rit, { van: "Rotterdam" }), { ok: false, key: "naar", reason: "required" });
  assert.deepEqual(readFields(rit, { van: "R", naar: "E", km: "ongeveer 40" }), { ok: false, key: "km", reason: "not_a_number" });
  assert.deepEqual(readFields(rit, { van: "R", naar: "E", colli: -1 }), { ok: false, key: "colli", reason: "negative" });
  assert.deepEqual(readFields(rit, { van: "x".repeat(301), naar: "E" }), { ok: false, key: "van", reason: "too_long" });
  const werkorder = workSkin("automonteur")!;
  assert.deepEqual(readFields(werkorder, { km_stand: 123456, klacht: "piept bij remmen", van: "Rotterdam" }),
    { ok: true, fields: { km_stand: 123456, klacht: "piept bij remmen" } });
  assert.deepEqual(readFields(werkorder, null), { ok: true, fields: {} });
});

test("[WERK] lines: the skin's kinds only, a description always, a Dutch btw rate always", () => {
  const w = workSkin("automonteur")!;
  const ok = readLines(w, [
    { kind: "arbeid", description: "Remmen vervangen", quantity: "1,5", unit_price: "65" },
    { kind: "onderdeel", description: "Remblokken voor", quantity: 1, unit_price: 89.9, btw_rate: 21 },
  ]);
  assert.deepEqual(ok, { ok: true, lines: [
    { kind: "arbeid", description: "Remmen vervangen", quantity: 1.5, unit: "uur", unit_price: 65, btw_rate: 21 },
    { kind: "onderdeel", description: "Remblokken voor", quantity: 1, unit: "stuk", unit_price: 89.9, btw_rate: 21 },
  ] });
  assert.equal(linesTotalEx(ok.ok ? ok.lines : []), 187.4);
  assert.deepEqual(readLines(w, undefined), { ok: true, lines: [] });
  assert.deepEqual(readLines(w, [{ kind: "materiaal", description: "x", quantity: 1, unit_price: 1 }]), { ok: false, index: 0, reason: "bad_kind" });
  assert.deepEqual(readLines(w, [{ kind: "arbeid", description: " ", quantity: 1, unit_price: 1 }]), { ok: false, index: 0, reason: "no_description" });
  assert.deepEqual(readLines(w, [{ kind: "arbeid", description: "x", quantity: 0, unit_price: 1 }]), { ok: false, index: 0, reason: "bad_quantity" });
  assert.deepEqual(readLines(w, [{ kind: "arbeid", description: "x", quantity: 1, unit_price: -1 }]), { ok: false, index: 0, reason: "bad_price" });
  assert.deepEqual(readLines(w, [{ kind: "arbeid", description: "x", quantity: 1, unit_price: 1, btw_rate: 13 }]), { ok: false, index: 0, reason: "bad_btw" });
  assert.deepEqual(readLines(w, "nee"), { ok: false, index: -1, reason: "not_a_list" });
  // Stored rows are read back defensively.
  assert.deepEqual(storedLines([{ kind: "arbeid", description: "a", quantity: 1, unit: "uur", unit_price: 2, btw_rate: 21 }, { broken: true }]),
    [{ kind: "arbeid", description: "a", quantity: 1, unit: "uur", unit_price: 2, btw_rate: 21 }]);
  assert.deepEqual(storedLines(null), []);
});

test("[WERK-4] financieel gereed lists what is missing, and the amount the invoice would come to", () => {
  const lines = [{ kind: "arbeid", description: "x", quantity: 2, unit: "uur", unit_price: 50, btw_rate: 21 }];
  const row = { status: "klaar", invoice_id: null, repeat_every: null, visits: [], client_name: "Jansen", lines };
  const ready = financialReadiness({ row, hours: [{ hours: 1.5, hourly_rate: 60, invoice_id: null }, { hours: 3, hourly_rate: null, invoice_id: "old" }] });
  assert.equal(ready.ok, true);
  assert.equal(ready.amountExBtw, 190, "2×50 + 1,5×60; the billed hour does not count");
  const noClient = financialReadiness({ row: { ...row, client_name: " " }, hours: [] });
  assert.deepEqual(noClient.items.map((i) => [i.key, i.ok]), [["client", false], ["lines", true], ["hoursRate", true], ["status", true]]);
  assert.equal(noClient.ok, false);
  const unpriced = financialReadiness({ row, hours: [{ hours: 2, hourly_rate: null, invoice_id: null }] });
  assert.equal(unpriced.items.find((i) => i.key === "hoursRate")?.ok, false, "an unbilled hour without a rate is a missing tick");
  assert.equal(financialReadiness({ row: { ...row, status: "bezig" }, hours: [] }).items.find((i) => i.key === "status")?.ok, false);
  assert.equal(financialReadiness({ row: { ...row, lines: [] }, hours: [] }).items.find((i) => i.key === "lines")?.ok, false);
  const rec = financialReadiness({ row: { ...row, status: "bezig", repeat_every: "week", visits: [{ on: "2026-09-01", note: null, invoice_id: null }, { on: "2026-09-08", note: null, invoice_id: null }] }, hours: [] });
  assert.equal(rec.ok, true);
  assert.equal(rec.amountExBtw, 200, "the lines once per unbilled beurt");
});

test("[WERK-4] the margin says how far to trust it; begroot is measured while the work runs", () => {
  assert.equal(workMargin({ revenueExBtw: 480, costsExBtw: 148.5, invoiced: true, costCount: 2 }).confidence, "werkelijk");
  assert.equal(workMargin({ revenueExBtw: 480, costsExBtw: 0, invoiced: true, costCount: 0 }).confidence, "geschat", "an invoice without any cost attached is a guess about the margin");
  assert.equal(workMargin({ revenueExBtw: 480, costsExBtw: 100, invoiced: false, costCount: 1 }).confidence, "geschat", "lines are not revenue yet");
  assert.equal(workMargin({ revenueExBtw: null, costsExBtw: 95 }).confidence, "incompleet");
  const lines = [{ kind: "arbeid", description: "x", quantity: 10, unit: "uur", unit_price: 55, btw_rate: 21 }];
  assert.deepEqual(overBudget({ fields: { begroot: 600 }, lines }, 100), { begroot: 600, actual: 650, over: true });
  assert.deepEqual(overBudget({ fields: { begroot: 700 }, lines }), { begroot: 700, actual: 550, over: false });
  assert.equal(overBudget({ fields: {}, lines }), null, "no begroting, no comparison");
});

test("[WERK-4] the Vandaag signals count money between the work and the invoice, and nothing else", () => {
  const meer = { kind: "meerwerk", description: "extra kraan", quantity: 1, unit: "post", unit_price: 80, btw_rate: 21 };
  const arbeid = { kind: "arbeid", description: "x", quantity: 4, unit: "uur", unit_price: 55, btw_rate: 21 };
  const rows: Array<{ id: string; status: string; fields: Record<string, string | number>; lines: typeof meer[] }> = [
    { id: "a", status: "bezig", fields: { begroot: 200 }, lines: [arbeid, meer] },
    { id: "b", status: "open", fields: { afgesproken_uren: 10 }, lines: [meer] },
    { id: "c", status: "gefactureerd", fields: {}, lines: [meer] },
  ];
  const signals = workSignals({ rows, hoursWithoutRate: 3, hoursByWork: new Map([["b", 12]]), unlinkedCosts: { n: 2, amount: 184.32 } });
  assert.deepEqual(signals, [
    { kind: "meerwerk_open", n: 2, amount: 160 },
    { kind: "hours_without_rate", n: 3 },
    { kind: "costs_unlinked", n: 2, amount: 184.32 },
    { kind: "over_budget", n: 2 },
  ], "invoiced work is not counted; a over 200 by lines, b over 10 hours");
  assert.deepEqual(workSignals({ rows: [], hoursWithoutRate: 0, hoursByWork: new Map(), unlinkedCosts: { n: 0, amount: 0 } }), []);
});

test("[CONTRACT] a fee contract is billed per period, once, never ahead, and its beurten are covered", () => {
  const visits = [{ on: "2026-09-01", note: null, invoice_id: null }];
  const lines = [{ kind: "vast", description: "Schoonmaak", quantity: 1, unit: "post", unit_price: 85, btw_rate: 9 }];
  const row = { id: "c", title: "Kantoor Janssen", client_name: "Janssen", status: "bezig", invoice_id: null, repeat_every: "week", fields: { locatie: "Tilburg", maandbedrag: 1850, afgesproken_uren: 72, einddatum: "2026-10-20" }, lines, visits, billed_periods: [] as Array<{ period: string; invoice_id: string }> };
  assert.equal(contractFee(row), 1850);
  assert.equal(contractFee({ ...row, fields: { locatie: "x" } }), null, "no fee → per beurt");
  assert.equal(contractFee({ ...row, repeat_every: null }), null, "one-off work has no fee");
  assert.equal(canInvoice(row), false, "a fee contract is not billed by its beurten");
  assert.equal(canInvoicePeriod(row, "2026-09", "2026-09-08"), true);
  assert.equal(canInvoicePeriod(row, "2026-10", "2026-09-08"), false, "never a future month");
  assert.equal(canInvoicePeriod({ ...row, billed_periods: [{ period: "2026-09", invoice_id: "inv" }] }, "2026-09", "2026-09-08"), false, "once");
  assert.equal(canInvoicePeriod({ ...row, status: "geannuleerd" }, "2026-09", "2026-09-08"), false);
  assert.deepEqual(periodInvoiceLines(row, "2026-09"), [{ description: "Kantoor Janssen · Tilburg · september 2026", quantity: 1, unit_price: 1850, btw_rate: 9 }], "the row's own rate, the month in Dutch");
  assert.equal(periodLabelNL("2026-01"), "januari 2026");
  assert.deepEqual(storedPeriods([{ period: "2026-09", invoice_id: "a" }, { period: "sept", invoice_id: "b" }, null]), [{ period: "2026-09", invoice_id: "a" }]);
  assert.equal(daysUntil("2026-10-20", "2026-09-08"), 42);
  assert.equal(daysUntil("2026-09-01", "2026-09-08"), -7);
  assert.equal(daysUntil(undefined, "2026-09-08"), null);
  // Readiness follows the period door for a fee contract.
  const ready = financialReadiness({ row, hours: [{ hours: 4, hourly_rate: null, invoice_id: null }], today: "2026-09-08" });
  assert.equal(ready.ok, true, "an unpriced hour does not block a fee invoice — the fee covers it");
  assert.equal(ready.amountExBtw, 1850);
  assert.equal(financialReadiness({ row: { ...row, billed_periods: [{ period: "2026-09", invoice_id: "inv" }] }, hours: [], today: "2026-09-08" }).ok, false);
  // Counts: the unbilled period is what is ready, worth the fee.
  assert.deepEqual(workCounts([row], "2026-09-08"), { open: 0, bezig: 0, wacht: 0, klaar: 1, klaarExBtw: 1850 });
  assert.deepEqual(workCounts([{ ...row, billed_periods: [{ period: "2026-09", invoice_id: "inv" }] }], "2026-09-08"), { open: 0, bezig: 1, wacht: 0, klaar: 0, klaarExBtw: 0 });
  // The overview: hours over the agreed ones and an end within sixty days both ask for attention.
  const stat = contractStat({ row, hoursMonth: 81, costsMonth: 95, today: "2026-09-08" });
  assert.equal(stat.revenueMonth, 1850);
  assert.equal(stat.marginMonth, 1755);
  assert.deepEqual(stat.reasons, ["uren", "einde"]);
  assert.equal(stat.health, "aandacht");
  assert.equal(stat.periodBilled, false);
  const perBeurt = contractStat({ row: { ...row, fields: { locatie: "Breda", afgesproken_uren: 72 }, visits: [...visits, { on: "2026-09-08", note: null, invoice_id: null }, { on: "2026-08-25", note: null, invoice_id: "old" }] }, hoursMonth: 60, costsMonth: 0, today: "2026-09-08" });
  assert.equal(perBeurt.fee, null);
  assert.equal(perBeurt.revenueMonth, 170, "two beurten this month × 85");
  assert.equal(perBeurt.visitsMonth, 2);
  assert.equal(perBeurt.health, "goed");
  const groups = contractGroups([perBeurt, stat, { ...perBeurt, id: "z", client_name: "Aardse" }]);
  assert.deepEqual(groups.map((g) => [g.client_name, g.contracts.length]), [["Janssen", 2], ["Aardse", 1]], "the client with attention first");
  assert.equal(periodOf("2026-09-08"), "2026-09");
  // Vandaag: the contract end is a signal.
  const sig = workSignals({ rows: [{ id: "c", status: "bezig", fields: row.fields, lines }], hoursWithoutRate: 0, hoursByWork: new Map(), unlinkedCosts: { n: 0, amount: 0 }, today: "2026-09-08" });
  assert.deepEqual(sig, [{ kind: "contract_ending", n: 1 }]);
});

test("[WERK] margin is revenue minus attached costs; nothing to divide by gives no share", () => {
  assert.deepEqual(workMargin({ revenueExBtw: 480, costsExBtw: 148.5 }), { revenue: 480, costs: 148.5, margin: 331.5, share: 0.69, confidence: "geschat" });
  assert.deepEqual(workMargin({ revenueExBtw: null, costsExBtw: 95 }), { revenue: null, costs: 95, margin: null, share: null, confidence: "incompleet" });
  assert.equal(workMargin({ revenueExBtw: 0, costsExBtw: 10 }).share, null);
});

test("[WERK-BEURT] a repeating opdracht with a done beurt counts as ready to invoice, and cannot be deleted once a beurt is billed", () => {
  const v = (invoice_id: string | null) => ({ on: "2026-09-01", note: null, invoice_id });
  const lines = [{ kind: "vast", description: "Schoonmaak", quantity: 1, unit: "post", unit_price: 85, btw_rate: 21 }];
  assert.deepEqual(workCounts([
    { status: "bezig", repeat_every: "week", visits: [v(null), { ...v(null), on: "2026-09-08" }], lines },
    { status: "bezig", repeat_every: "week", visits: [v("inv")], lines },
    { status: "open", repeat_every: null, visits: [], lines },
    { status: "klaar", repeat_every: null, visits: [], lines: [{ kind: "arbeid", description: "x", quantity: 2, unit: "uur", unit_price: 60, btw_rate: 21 }] },
  ]), { open: 1, bezig: 1, wacht: 0, klaar: 2, klaarExBtw: 290 }, "two beurten × 85 + 2 × 60: what 'klaar voor de factuur' is worth");
  assert.equal(canDelete({ invoice_id: null, attachedCosts: 0, attachedHours: 0, visits: [v("inv")] }), false);
  assert.equal(canDelete({ invoice_id: null, attachedCosts: 0, attachedHours: 0, visits: [v(null)] }), true);
});

test("[WERK] counts, and the two guards", () => {
  assert.deepEqual(workCounts([
    { status: "open" }, { status: "bezig" }, { status: "wacht_klant" }, { status: "wacht_onderdeel" },
    { status: "klaar" }, { status: "klaar" }, { status: "gefactureerd" }, { status: "geannuleerd" },
  ]), { open: 1, bezig: 1, wacht: 2, klaar: 2, klaarExBtw: 0 });
  assert.equal(canInvoice({ status: "klaar", invoice_id: null }), true);
  assert.equal(canInvoice({ status: "klaar", invoice_id: "x" }), false, "once");
  assert.equal(canInvoice({ status: "bezig", invoice_id: null }), false, "only finished work");
  assert.equal(canDelete({ invoice_id: null, attachedCosts: 0, attachedHours: 0 }), true);
  assert.equal(canDelete({ invoice_id: null, attachedCosts: 1, attachedHours: 0 }), false);
  assert.equal(canDelete({ invoice_id: "x", attachedCosts: 0, attachedHours: 0 }), false);
});

// ── [STRIPPENKAART] Hours sold up front, drawn down by the work ───────────────────────────────

test("[STRIPPENKAART] a bundle is hours on a non-repeating row; a rhythm makes it a contract instead", () => {
  assert.equal(bundleHours({ fields: { bundel_uren: 10 } }), 10);
  assert.equal(bundleHours({ fields: {} }), null);
  assert.equal(bundleHours({ fields: { bundel_uren: 0 } }), null, "zero hours is not a bundle");
  assert.equal(bundleHours({ repeat_every: "maand", fields: { bundel_uren: 10 } }), null, "a bundle is sold once");
});

test("[STRIPPENKAART] the balance counts every hour on the opdracht, and the overrun is stated not hidden", () => {
  const row = { status: "bezig", invoice_id: "inv-1", fields: { bundel_uren: 10 } };
  assert.deepEqual(bundleState({ row, hoursUsed: 4 }), { sold: 10, used: 4, remaining: 6, overrun: 0, invoiced: true });
  assert.deepEqual(bundleState({ row, hoursUsed: 12.5 }), { sold: 10, used: 12.5, remaining: 0, overrun: 2.5, invoiced: true });
  assert.equal(bundleState({ row: { status: "open", fields: {} }, hoursUsed: 3 }), null, "not a bundle, no balance");
});

test("[STRIPPENKAART] the bundle is billed once, and never through the ordinary door that would close the row", () => {
  const priced = [{ kind: "vast", description: "Strippenkaart 10 uur", quantity: 1, unit_price: 950, btw_rate: 21 }] as const;
  const fresh = { status: "open", invoice_id: null, fields: { bundel_uren: 10 }, lines: priced };
  assert.equal(canInvoiceBundle(fresh), true);
  assert.equal(canInvoice({ status: "klaar", invoice_id: null, fields: { bundel_uren: 10 } }), false,
    "the ordinary door refuses a bundle — it would close the row and the later hours could never be written on it");
  assert.equal(canInvoiceBundle({ ...fresh, invoice_id: "inv-1" }), false, "once");
  assert.equal(canInvoiceBundle({ ...fresh, lines: [] }), false, "a bundle without a price is not an invoice");
  assert.equal(canInvoiceBundle({ ...fresh, status: "geannuleerd" }), false);
});

test("[STRIPPENKAART] the invoice carries the row's own lines — the hours are its delivery, not its lines", () => {
  const lines = bundleInvoiceLines({ lines: [
    { kind: "vast", description: "Strippenkaart 10 uur", quantity: 1, unit_price: 950, btw_rate: 21 },
    { kind: "arbeid", description: "Nog geen prijs", quantity: 1, unit_price: 0, btw_rate: 21 },
  ] as never });
  assert.deepEqual(lines, [{ description: "Strippenkaart 10 uur", quantity: 1, unit_price: 950, btw_rate: 21 }]);
});

test("[STRIPPENKAART] a bundle that is used up is a signal, with the hours worked past it", () => {
  const rows = [
    { id: "w1", status: "bezig", fields: { bundel_uren: 10 }, lines: [] },
    { id: "w2", status: "bezig", fields: { bundel_uren: 5 }, lines: [] },
  ];
  const signals = workSignals({
    rows, hoursWithoutRate: 0, unlinkedCosts: { n: 0, amount: 0 },
    hoursByWork: new Map([["w1", 13], ["w2", 4]]),
  });
  assert.deepEqual(signals.filter((s) => s.kind === "bundle_over"), [{ kind: "bundle_over", n: 1, hours: 3 }]);
});

test("[RETAINER] a dienstverlener's opdracht carries the retainer, the end date and the bundle", () => {
  const keys = workSkin("dienstverlening")!.fields.map((f) => f.key);
  for (const k of ["maandbedrag", "einddatum", "bundel_uren"]) {
    assert.ok(keys.includes(k), `the dienstverlening opdracht is missing ${k}`);
  }
  // A retainer is the schoonmaak contract's arithmetic on a consultant's row: same fee, same
  // period door, same renewal countdown.
  assert.equal(contractFee({ repeat_every: "maand", fields: { maandbedrag: 1500 } }), 1500);
});
