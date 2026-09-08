// [WERK] Pure node test — run: npx tsx --test src/lib/werk.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  hasWorkLayer, workSkin, readFields, readLines, linesTotalEx, storedLines, workMargin, workCounts,
  canInvoice, canDelete, statusKey, WORK_STATUSES, HAND_STATUSES,
} from "./werk";

test("[WERK] the layer exists for the four verticals and their sister trades, and for nobody else", () => {
  assert.equal(workSkin("automonteur")?.skin, "werkorder");
  assert.equal(workSkin("transport")?.skin, "rit");
  assert.equal(workSkin("bouw-klus")?.skin, "klus");
  assert.equal(workSkin("loodgieter")?.skin, "klus");
  assert.equal(workSkin("elektricien")?.skin, "klus");
  assert.equal(workSkin("schilder")?.skin, "klus");
  assert.equal(workSkin("schoonmaak")?.skin, "opdracht");
  // A kapper's app stays exactly what it was.
  assert.equal(hasWorkLayer("kapper"), false);
  assert.equal(hasWorkLayer("dienstverlening"), false);
  assert.equal(hasWorkLayer(null), false);
  assert.equal(hasWorkLayer("astronaut"), false);
  assert.equal(workSkin("astronaut"), null);
});

test("[WERK] every skin's statuses are drawn from the one closed set, in the trade's order", () => {
  for (const vak of ["automonteur", "transport", "bouw-klus", "schoonmaak"]) {
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
