// tests/render/werk.test.tsx
// [WERK] The trade's own work screen renders real rows: a garage's werkorders grouped by the
// trade's own status words, a courier's ritten, the line editor, the margin line. No browser,
// no session: the components take their data as props, and the rows exercise the branches.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkList, WorkCard, StatusChips, LinesEditor, MarginLine, AttachedList, invoiceButtonState, type T } from "../../src/app/dashboard/werk/WerkPanels";
import { werkZin } from "../../src/app/dashboard/vandaag/VandaagClient";
import { workSkin } from "../../src/lib/werk";
import type { WorkRow } from "../../src/lib/werk-rows";
import { translator } from "../../src/lib/i18n/t";

const t = translator("nl") as unknown as T;

const werkorder = (over: Partial<WorkRow>): WorkRow => ({
  id: "w1", vak: "automonteur", title: "Remmen vervangen", client_id: null, client_name: "J. Jansen", vehicle_id: "v1", kenteken: "12ABC3",
  status: "open", planned_on: "2026-09-09", done_on: null, fields: { km_stand: 123456 }, lines: [], notes: null, invoice_id: null, created_at: "2026-09-08T10:00:00Z",
  ...over,
});

test("[WERK] a garage's werkorders group under the trade's own status words, plate first on the card", () => {
  const skin = workSkin("automonteur")!;
  const html = renderToStaticMarkup(
    <WorkList skin={skin} t={t} rows={[
      werkorder({ id: "a", status: "open" }),
      werkorder({ id: "b", status: "wacht_onderdeel", title: "Distributieriem", kenteken: "XX99YY" }),
      werkorder({ id: "c", status: "klaar", lines: [{ kind: "arbeid", description: "Remmen", quantity: 1.5, unit: "uur", unit_price: 65, btw_rate: 21 }] }),
    ]} />,
  );
  assert.ok(html.length > 500, "renders");
  for (const word of ["Gepland", "Wacht op onderdelen", "Gereed"]) assert.ok(html.includes(word), `status word ${word}`);
  assert.ok(html.includes("12-ABC-3"), "the plate is printed with its dashes");
  assert.ok(html.includes("Kilometerstand: 123.456"), "the odometer is on the card");
  assert.ok(html.includes("97,50"), "the lines total ex btw is on the card");
  assert.ok(!html.includes("Gefactureerd"), "an empty group is not drawn");
});

test("[WERK] a courier's ritten use the courier's words and the two addresses", () => {
  const skin = workSkin("transport")!;
  const rit: WorkRow = werkorder({ id: "r", vak: "transport", title: "Pallets", kenteken: null, vehicle_id: null, status: "bezig", fields: { van: "Rotterdam", naar: "Eindhoven", km: 112.5 } });
  const html = renderToStaticMarkup(<WorkCard skin={skin} t={t} row={rit} />);
  assert.ok(html.includes("Onderweg"), "a rit in progress is 'Onderweg', never 'In behandeling'");
  assert.ok(html.includes("Laadadres: Rotterdam") && html.includes("Losadres: Eindhoven"));
  assert.ok(html.includes("Kilometers: 112,5"));
});

test("[WERK] the status chips offer the trade's hand statuses and never 'gefactureerd'", () => {
  const skin = workSkin("automonteur")!;
  const html = renderToStaticMarkup(<StatusChips skin={skin} current="bezig" t={t} onPick={() => {}} />);
  assert.ok(html.includes("In behandeling") && html.includes("Wacht op klant") && html.includes("Gereed"));
  assert.ok(!html.includes(">Gefactureerd<"), "invoicing is a door, not a chip");
});

test("[WERK] the line editor prints the trade's kinds and the total; the margin line prints all three figures", () => {
  const skin = workSkin("bouw-klus")!;
  const html = renderToStaticMarkup(
    <LinesEditor skin={skin} t={t} onChange={() => {}} lines={[
      { kind: "arbeid", description: "Leidingwerk", quantity: 4, unit: "uur", unit_price: 55, btw_rate: 21 },
      { kind: "materiaal", description: "Koperbuis", quantity: 12, unit: "stuk", unit_price: 3.4, btw_rate: 21 },
      { kind: "meerwerk", description: "Extra kraan", quantity: 1, unit: "post", unit_price: 80, btw_rate: 21 },
    ]} />,
  );
  for (const word of ["Arbeid", "Materiaal", "Meerwerk"]) assert.ok(html.includes(word), word);
  assert.ok(html.includes("340,80"), "4×55 + 12×3,40 + 80");
  const margin = renderToStaticMarkup(<MarginLine t={t} hoursTotal={5.5} margin={{ revenue: 480, costs: 148.5, margin: 331.5, share: 0.69 }} />);
  assert.ok(margin.includes("480,00") && margin.includes("148,50") && margin.includes("331,50") && margin.includes("69%") && margin.includes("5,5"));
  const none = renderToStaticMarkup(<MarginLine t={t} hoursTotal={0} margin={{ revenue: null, costs: 95, margin: null, share: null }} />);
  assert.ok(none.includes("—") && none.includes("95,00"), "no revenue → dashes, costs still shown");
});

test("[WERK] attached hours and purchases render, an invoiced hour cannot be detached, and the invoice button follows the state", () => {
  const html = renderToStaticMarkup(
    <AttachedList t={t} onDetachHours={() => {}} onDetachCost={() => {}}
      hours={[{ id: "h1", worked_on: "2026-09-08", description: "Remmen", hours: 1.5, hourly_rate: 65, invoice_id: null }, { id: "h2", worked_on: "2026-09-07", description: "Diagnose", hours: 0.5, hourly_rate: 65, invoice_id: "inv" }]}
      costs={[{ id: "c1", client_name: "Fource", invoice_number: "F-1", invoice_date: "2026-09-07", total_ex_btw: 74.3, total_inc_btw: 89.9, status: "received" }]} />,
  );
  assert.ok(html.includes("Remmen") && html.includes("Fource") && html.includes("74,30"));
  assert.equal((html.match(/Losmaken/g) ?? []).length, 2, "the invoiced hour has no detach button; the open hour and the cost do");
  assert.equal(invoiceButtonState({ status: "klaar", invoice_id: null }, null), "make");
  assert.equal(invoiceButtonState({ status: "bezig", invoice_id: null }, null), "none");
  assert.equal(invoiceButtonState({ status: "gefactureerd", invoice_id: "x" }, null), "view");
});

test("[WERK] Vandaag speaks the trade's word", () => {
  assert.equal(werkZin({ pluralKey: "werk.noun.werkorders", counts: { open: 2, bezig: 1, wacht: 1, klaar: 3 } }, t),
    "Werkorders: 3 klaar voor de factuur, 3 in behandeling, 1 wachten.");
  assert.equal(werkZin({ pluralKey: "werk.noun.ritten", counts: { open: 0, bezig: 0, wacht: 0, klaar: 0 } }, t), "Geen open Ritten.");
  assert.equal(werkZin(null, t), null);
});
