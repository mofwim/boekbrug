// tests/render/werk.test.tsx
// [WERK] The trade's own work screen renders real rows: a garage's werkorders grouped by the
// trade's own status words, a courier's ritten, the line editor, the margin line. No browser,
// no session: the components take their data as props, and the rows exercise the branches.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkList, WorkCard, StatusChips, LinesEditor, MarginLine, AttachedList, VisitsPanel, DocumentsList, TogetherOffer, WorkForm, WorkSheet, HistoryList, HoursForm, ReadinessList, ContractsPanel, EMPTY_FORM, invoiceButtonState, type T } from "../../src/app/dashboard/werk/WerkPanels";
import { VakCardView } from "../../src/components/settings/VakCard";
import { werkZin, werkSignaalZin } from "../../src/app/dashboard/vandaag/VandaagClient";
import { workSkin } from "../../src/lib/werk";
import type { WorkRow } from "../../src/lib/werk-rows";
import { translator } from "../../src/lib/i18n/t";

const t = translator("nl") as unknown as T;

const werkorder = (over: Partial<WorkRow>): WorkRow => ({
  id: "w1", vak: "automonteur", title: "Remmen vervangen", client_id: null, client_name: "J. Jansen", vehicle_id: "v1", kenteken: "12ABC3",
  status: "open", planned_on: "2026-09-09", done_on: null, fields: { km_stand: 123456 }, lines: [], repeat_every: null, visits: [], billed_periods: [], notes: null, invoice_id: null, created_at: "2026-09-08T10:00:00Z",
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
  const margin = renderToStaticMarkup(<MarginLine t={t} hoursTotal={5.5} margin={{ revenue: 480, costs: 148.5, margin: 331.5, share: 0.69, confidence: "werkelijk" }} />);
  assert.ok(margin.includes("480,00") && margin.includes("148,50") && margin.includes("331,50") && margin.includes("69%") && margin.includes("5,5"));
  const none = renderToStaticMarkup(<MarginLine t={t} hoursTotal={0} margin={{ revenue: null, costs: 95, margin: null, share: null, confidence: "incompleet" }} />);
  assert.ok(none.includes("—") && none.includes("95,00"), "no revenue → dashes, costs still shown");
});

test("[WERK] attached hours and purchases render, an invoiced hour cannot be detached, and the invoice button follows the state", () => {
  const html = renderToStaticMarkup(
    <AttachedList t={t} onDetachHours={() => {}} onDetachCost={() => {}}
      hours={[{ id: "h1", worked_on: "2026-09-08", description: "Remmen", hours: 1.5, hourly_rate: 65, invoice_id: null, client_name: null }, { id: "h2", worked_on: "2026-09-07", description: "Diagnose", hours: 0.5, hourly_rate: 65, invoice_id: "inv", client_name: null }]}
      costs={[{ id: "c1", client_name: "Fource", invoice_number: "F-1", invoice_date: "2026-09-07", total_ex_btw: 74.3, total_inc_btw: 89.9, status: "received" }]} />,
  );
  assert.ok(html.includes("Remmen") && html.includes("Fource") && html.includes("74,30"));
  assert.equal((html.match(/Losmaken/g) ?? []).length, 2, "the invoiced hour has no detach button; the open hour and the cost do");
  assert.equal(invoiceButtonState({ status: "klaar", invoice_id: null }, null), "make");
  assert.equal(invoiceButtonState({ status: "bezig", invoice_id: null }, null), "none");
  assert.equal(invoiceButtonState({ status: "gefactureerd", invoice_id: "x" }, null), "view");
});

test("[WERK] Vandaag speaks the trade's word", () => {
  assert.equal(werkZin({ pluralKey: "werk.noun.werkorders", counts: { open: 2, bezig: 1, wacht: 1, klaar: 3, klaarExBtw: 0 } }, t),
    "Werkorders: 3 klaar voor de factuur, 3 in behandeling, 1 wachten.");
  assert.equal(werkZin({ pluralKey: "werk.noun.werkorders", counts: { open: 2, bezig: 1, wacht: 1, klaar: 3, klaarExBtw: 2840 } }, t),
    "Werkorders: 3 klaar voor de factuur · € 2.840,00, 3 in behandeling, 1 wachten.", "the amount tells him what to do now");
  assert.equal(werkZin({ pluralKey: "werk.noun.ritten", counts: { open: 0, bezig: 0, wacht: 0, klaar: 0, klaarExBtw: 0 } }, t), "Geen open Ritten.");
  assert.equal(werkZin(null, t), null);
});

test("[WERK-2] a fietsenmaker's reparatie opens on the bike and ends 'Klaar voor ophalen'; a rit prints who received it", () => {
  const skin = workSkin("fietsenmaker")!;
  const rep: WorkRow = werkorder({ id: "f", vak: "fietsenmaker", title: "Band plakken", kenteken: null, vehicle_id: null, status: "klaar", fields: { fiets: "Gazelle zwart", framenummer: "GZ123" } });
  const html = renderToStaticMarkup(<WorkList skin={skin} t={t} rows={[rep]} />);
  assert.ok(html.includes("Klaar voor ophalen"), "the bike shop's word for done");
  assert.ok(html.includes("Fiets (merk, kleur): Gazelle zwart"), "the bike is on the card");
  assert.ok(!html.includes("Kenteken"), "a bike has no plate");
  const chips = renderToStaticMarkup(<StatusChips skin={skin} current="open" t={t} onPick={() => {}} />);
  assert.ok(chips.includes("Ingenomen") && chips.includes("In reparatie") && chips.includes("Wacht op onderdelen"));
  const form = renderToStaticMarkup(<WorkForm skin={workSkin("transport")!} t={t} value={{ ...EMPTY_FORM }} onChange={() => {}} />);
  assert.ok(form.includes("Ontvangen door"), "the courier writes who took delivery");
  assert.ok(form.includes("Herhaalt") && form.includes("Laadtijd"), "a fixed route repeats (EasyTrans' periodic order), and the rit carries its time window");
  const garage = renderToStaticMarkup(<WorkForm skin={workSkin("automonteur")!} t={t} value={{ ...EMPTY_FORM }} onChange={() => {}} />);
  assert.ok(!garage.includes("Herhaalt") && garage.includes("Telefoon klant"), "a werkorder never repeats; the customer's phone is on it");
  const cleaning = renderToStaticMarkup(<WorkForm skin={workSkin("schoonmaak")!} t={t} value={{ ...EMPTY_FORM }} onChange={() => {}} />);
  assert.ok(cleaning.includes("Herhaalt") && cleaning.includes("Elke week") && cleaning.includes("Eenmalig"), "an opdracht may repeat");
});

test("[WERK-BEURT] repeating work shows its rhythm, the next beurt and the unbilled count; the beurten panel links billed ones", () => {
  const skin = workSkin("schoonmaak")!;
  const visits = [{ on: "2026-09-01", note: null, invoice_id: "inv-1" }, { on: "2026-09-08", note: "ramen", invoice_id: null }];
  const row: WorkRow = werkorder({ id: "s", vak: "schoonmaak", title: "Kantoor Westhaven", kenteken: null, vehicle_id: null, status: "bezig", fields: { locatie: "Westhaven 12" }, repeat_every: "week", visits });
  const card = renderToStaticMarkup(<WorkCard skin={skin} t={t} row={row} />);
  assert.ok(card.includes("Elke week"), "the rhythm");
  assert.ok(card.includes("Volgende: 15-09-2026"), "one week after the last beurt");
  assert.ok(card.includes("1 beurten nog te factureren"), "the unbilled count");
  const panel = renderToStaticMarkup(<VisitsPanel visits={visits} t={t} onVisit={() => {}} onUnvisit={() => {}} invoiceHref={(id) => `/dashboard/invoice/${id}/edit`} />);
  assert.ok(panel.includes("Beurt gedaan"), "the one tap");
  assert.ok(panel.includes("ramen"), "the note");
  assert.ok(panel.includes('href="/dashboard/invoice/inv-1/edit"'), "a billed beurt links to its invoice");
  assert.equal((panel.match(/aria-label="Verwijderen"/g) ?? []).length, 1, "only the unbilled beurt can be taken back");
  assert.equal(invoiceButtonState(row, null), "make", "a done beurt makes the work invoiceable while the row stays open");
  assert.equal(invoiceButtonState({ ...row, visits: [visits[0]] }, null), "none");
  const empty = renderToStaticMarkup(<VisitsPanel visits={[]} t={t} />);
  assert.ok(empty.includes("Nog geen beurten."));
});

test("[WERK-VERZAMEL] the list offers one invoice per client with two or more finished pieces of work", () => {
  const rit = (id: string, over: Partial<WorkRow> = {}): WorkRow => werkorder({ id, vak: "transport", kenteken: null, vehicle_id: null, status: "klaar", client_name: "Bol Logistiek", fields: { van: "A", naar: "B" }, ...over });
  const html = renderToStaticMarkup(<TogetherOffer t={t} onTogether={() => {}} rows={[rit("a"), rit("b"), rit("c", { client_name: "PostNL" }), rit("d", { status: "bezig" })]} />);
  assert.ok(html.includes("Verzamelfactuur · Bol Logistiek · 2 stuks"), "two finished ritten for one client");
  assert.ok(!html.includes("PostNL"), "one rit is the ordinary Maak factuur");
  const none = renderToStaticMarkup(<TogetherOffer t={t} rows={[rit("a")]} />);
  assert.equal(none, "", "nothing to offer, nothing drawn");
});

test("[WERK-BON] the files attached to work render with a detach, and the settings card offers every trade", () => {
  const docs = renderToStaticMarkup(<DocumentsList t={t} onDetach={() => {}} documents={[{ id: "d1", file_name: "bon-fource.pdf", created_at: "2026-09-08T10:00:00Z" }]} />);
  assert.ok(docs.includes("bon-fource.pdf") && docs.includes("Losmaken"));
  assert.equal(renderToStaticMarkup(<DocumentsList t={t} documents={[]} />), "");
  const card = renderToStaticMarkup(<VakCardView vak="automonteur" loaded busy={false} note="saved" onChoose={() => {}} t={t} />);
  assert.ok(card.includes("Mijn vak") && card.includes("Geen vak gekozen") && card.includes("Automonteur / garage") && card.includes("Transport / koerier / taxi"));
  assert.ok(card.includes("Werkorders als tweede knop"), "a trade with a work layer says what it just gained");
  assert.ok(card.includes("Opgeslagen."));
  const none = renderToStaticMarkup(<VakCardView vak="kapper" loaded busy={false} note={null} onChoose={() => {}} t={t} />);
  assert.ok(!none.includes("tweede knop"), "a kapper gains no screen and is not told he did");
});

test("[WERK-3] the review's findings stay fixed: decimals render as typed, the sheet shows the refusal, hours and history have a place", () => {
  const skin = workSkin("automonteur")!;
  // A price of 47,50 is drawn with its comma — the box that used to eat it (Number("47,") → 47).
  const editor = renderToStaticMarkup(<LinesEditor skin={skin} t={t} onChange={() => {}} lines={[{ kind: "arbeid", description: "Remmen", quantity: 1.5, unit: "uur", unit_price: 47.5, btw_rate: 21 }]} suggestions={[{ description: "Kleine beurt", unit_price: 89, btw_rate: 21, unit: "stuk" }]} />);
  assert.ok(editor.includes('value="47,5"') && editor.includes('value="1,5"'), "numbers are shown the Dutch way, decimals intact");
  assert.ok(editor.includes("<datalist") && editor.includes("Kleine beurt"), "the owner's articles are offered on the description");
  // A refusal from the server is INSIDE the sheet, where the owner is looking.
  const sheet = renderToStaticMarkup(<WorkSheet title="Werkorder" onClose={() => {}} error="Zet een klant op dit werk."><p>x</p></WorkSheet>);
  assert.ok(sheet.includes('role="alert"') && sheet.includes("Zet een klant op dit werk."));
  // Hours are written on the work; the budget line names the agreement.
  const hours = renderToStaticMarkup(<HoursForm t={t} onSave={() => {}} defaultRate={65} />);
  assert.ok(hours.includes("Uren opschrijven") && hours.includes('value="65"'));
  const budget = renderToStaticMarkup(<MarginLine t={t} hoursTotal={48} margin={{ revenue: null, costs: 0, margin: null, share: null, confidence: "incompleet" }} budget={{ agreed: 40, spent: 48, over: true }} />);
  assert.ok(budget.includes("48 van 40 afgesproken uren"), "over budget is said in numbers");
  // The car's history: a returning Golf shows what was done before.
  const history = renderToStaticMarkup(<HistoryList t={t} history={[{ id: "a", title: "APK", status: "gefactureerd", on: "2026-03-02", invoice_id: "i", total_ex_btw: 120 }]} />);
  assert.ok(history.includes("APK") && history.includes("120,00"));
});

test("[RIJSCHOOL] a leerling's lessen are beurten in the trade's own word, and the lesauto is on the form", () => {
  const skin = workSkin("rijschool")!;
  const row: WorkRow = werkorder({ id: "l", vak: "rijschool", title: "Pakket 20 lessen", client_name: "S. de Boer", status: "bezig", fields: { lespakket: "20 lessen", examen_datum: "2026-10-01" }, repeat_every: "week", visits: [{ on: "2026-09-01", note: null, invoice_id: null }, { on: "2026-09-08", note: null, invoice_id: null }], lines: [{ kind: "les", description: "Rijles", quantity: 1, unit: "uur", unit_price: 55, btw_rate: 21 }] });
  const card = renderToStaticMarkup(<WorkCard skin={skin} t={t} row={row} />);
  assert.ok(card.includes("In opleiding") && card.includes("2 lessen nog te factureren"), "not 'beurten'");
  const panel = renderToStaticMarkup(<VisitsPanel visits={row.visits} t={t} onVisit={() => {}} keys={skin.visitKeys} />);
  assert.ok(panel.includes("Les gegeven") && !panel.includes("Beurt gedaan"));
  const form = renderToStaticMarkup(<WorkForm skin={skin} t={t} value={{ ...EMPTY_FORM }} onChange={() => {}} />);
  assert.ok(form.includes("Kenteken") && form.includes("Instructeur") && form.includes("Lespakket") && form.includes("Examendatum"));
});

test("[WERK-4] the readiness list names the missing tick, the margin names its trust, Vandaag names the leak", () => {
  const ready = renderToStaticMarkup(<ReadinessList t={t} readiness={{ ok: true, amountExBtw: 685, items: [{ key: "client", ok: true }, { key: "lines", ok: true }, { key: "hoursRate", ok: true }, { key: "status", ok: true }] }} />);
  assert.ok(ready.includes("Klaar voor de factuur · € 685,00") && (ready.match(/✓/g) ?? []).length === 4);
  const notReady = renderToStaticMarkup(<ReadinessList t={t} readiness={{ ok: false, amountExBtw: 0, items: [{ key: "client", ok: true }, { key: "lines", ok: false }, { key: "hoursRate", ok: false }, { key: "status", ok: true }] }} />);
  assert.ok(notReady.includes("Nog niet klaar voor de factuur") && notReady.includes("⚠ Iets om te factureren") && notReady.includes("⚠ Elk uur heeft een tarief"));
  const margin = renderToStaticMarkup(<MarginLine t={t} hoursTotal={0} margin={{ revenue: 480, costs: 0, margin: 480, share: 1, confidence: "geschat" }} estimate={{ begroot: 400, actual: 480, over: true }} />);
  assert.ok(margin.includes("geschat, nog geen kosten") && margin.includes("Begroot € 400,00 · werkelijk € 480,00"));
  assert.deepEqual(werkSignaalZin({ kind: "costs_unlinked", n: 2, amount: 184.32 }, t), { text: "2 bonnen (€ 184,32) van bekende leveranciers hangen aan geen werk.", href: "/dashboard/incoming/manage" });
  assert.equal(werkSignaalZin({ kind: "over_budget", n: 1 }, t).text, "1 stuks werk boven de begroting.");
});

test("[CONTRACT] the portfolio groups a client's locations, names the attention, and offers this month's invoice once", () => {
  const stat = (over: Partial<Parameters<typeof ContractsPanel>[0]["groups"][number]["contracts"][number]>) => ({
    id: "c1", title: "Schoonmaak", client_name: "Janssen Vastgoed", locatie: "Kantoor Tilburg", fee: 1850, revenueMonth: 1850, hoursMonth: 81, agreedHours: 72, costsMonth: 95, marginMonth: 1755,
    visitsMonth: 4, einddatum: "2026-10-20", daysLeft: 42, periodBilled: false, health: "aandacht" as const, reasons: ["uren", "einde"] as Array<"uren" | "einde">, ...over,
  });
  const html = renderToStaticMarkup(
    <ContractsPanel period="2026-09" t={t} onInvoicePeriod={() => {}} groups={[
      { client_name: "Janssen Vastgoed", contracts: [stat({}), stat({ id: "c2", locatie: "Magazijn Waalwijk", fee: null, revenueMonth: 340, hoursMonth: 20, agreedHours: 24, health: "goed", reasons: [], einddatum: null, daysLeft: null })] },
      { client_name: "Delta BV", contracts: [stat({ id: "c3", locatie: "Winkel Breda", periodBilled: true, health: "goed", reasons: [], einddatum: null, daysLeft: null })] },
    ]} />,
  );
  assert.ok(html.includes("Janssen Vastgoed · 2") && html.includes("Kantoor Tilburg") && html.includes("Magazijn Waalwijk"));
  assert.ok(html.includes("€ 1.850,00 per maand") && html.includes("loopt af over 42 dagen") && html.includes("Aandacht"));
  assert.ok(html.includes("81 van 72 uur deze maand"), "hours against the agreed ones");
  assert.ok(html.includes("Factureer september 2026"), "this month's fee, offered");
  assert.ok(html.includes("september 2026 gefactureerd"), "…and marked once it is on an invoice");
  assert.ok(html.includes("Per beurt") && html.includes("geschat"), "a per-beurt contract says so, and the margin says its trust");
  assert.equal(invoiceButtonState({ status: "bezig", invoice_id: null, repeat_every: "week", visits: [], fields: { maandbedrag: 1850 }, billed_periods: [] }, null, "2026-09-08"), "make");
  assert.equal(invoiceButtonState({ status: "bezig", invoice_id: null, repeat_every: "week", visits: [], fields: { maandbedrag: 1850 }, billed_periods: [{ period: "2026-09", invoice_id: "x" }] }, null, "2026-09-08"), "none");
  assert.equal(werkSignaalZin({ kind: "contract_ending", n: 2 }, t).text, "2 contracten lopen binnen 60 dagen af.");
});
