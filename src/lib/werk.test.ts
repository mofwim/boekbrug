// [WERK] Pure node test — run: npx tsx --test src/lib/werk.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  hasWorkLayer, workSkin, readFields, readLines, linesTotalEx, storedLines, workMargin, workCounts,
  canInvoice, canDelete, statusKey, WORK_STATUSES, HAND_STATUSES,
  storedVisits, readVisit, unbilledVisits, addRepeat, nextVisitOn, visitInvoiceLines, shortDateNL,
  canInvoiceTogether, togetherGroups, workInvoiceLines, REPEATS, REPEAT_KEYS, isRepeat,
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
  for (const vak of ["automonteur", "transport", "bouw-klus", "schoonmaak", "fietsenmaker", "dienstverlening"]) {
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
  assert.deepEqual(workSkin("bouw-klus")!.lineKinds.map((k) => k.kind), ["arbeid", "materiaal", "meerwerk"]);
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
  assert.deepEqual([...REPEATS], ["week", "twee_weken", "vier_weken", "maand"]);
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

test("[WERK] margin is revenue minus attached costs; nothing to divide by gives no share", () => {
  assert.deepEqual(workMargin({ revenueExBtw: 480, costsExBtw: 148.5 }), { revenue: 480, costs: 148.5, margin: 331.5, share: 0.69 });
  assert.deepEqual(workMargin({ revenueExBtw: null, costsExBtw: 95 }), { revenue: null, costs: 95, margin: null, share: null });
  assert.equal(workMargin({ revenueExBtw: 0, costsExBtw: 10 }).share, null);
});

test("[WERK] counts, and the two guards", () => {
  assert.deepEqual(workCounts([
    { status: "open" }, { status: "bezig" }, { status: "wacht_klant" }, { status: "wacht_onderdeel" },
    { status: "klaar" }, { status: "klaar" }, { status: "gefactureerd" }, { status: "geannuleerd" },
  ]), { open: 1, bezig: 1, wacht: 2, klaar: 2 });
  assert.equal(canInvoice({ status: "klaar", invoice_id: null }), true);
  assert.equal(canInvoice({ status: "klaar", invoice_id: "x" }), false, "once");
  assert.equal(canInvoice({ status: "bezig", invoice_id: null }), false, "only finished work");
  assert.equal(canDelete({ invoice_id: null, attachedCosts: 0, attachedHours: 0 }), true);
  assert.equal(canDelete({ invoice_id: null, attachedCosts: 1, attachedHours: 0 }), false);
  assert.equal(canDelete({ invoice_id: "x", attachedCosts: 0, attachedHours: 0 }), false);
});
