// [STATEMENT-RECONCILE] Pure node test — run: npx tsx src/lib/statement-reconcile.test.ts
// De vergelijking tussen een leveranciersoverzicht en de eigen administratie. Twee fouten zijn
// hier duur: een ONTBREKENDE factuur missen (dan doet de controle niets), en een factuur die we
// wél hebben 'ontbrekend' noemen (dan gaat de eigenaar zoeken naar iets dat er is, en gelooft hij
// de volgende melding niet meer). Beide kanten staan hieronder vastgepind.
import {
  reconcileStatement,
  normalizeInvoiceNumber,
  invoiceNumberTail,
  derivePeriod,
  summarizeReconcile,
  reconcileNote,
  type StatementLine,
  type BookedInvoice,
} from "./statement-reconcile";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  invoice_number: "2026-118",
  date: "2026-05-10",
  amount: 121,
  kind: "invoice",
  ...over,
});

const booked = (over: Partial<BookedInvoice> = {}): BookedInvoice => ({
  id: "inv-1",
  invoice_number: "2026-118",
  invoice_date: "2026-05-10",
  total_inc_btw: 121,
  status: "received",
  ...over,
});

console.log("\n[STATEMENT-RECONCILE] normalisatie");
check("streepjes/spaties/hoofdletters doen niet mee",
  normalizeInvoiceNumber("f 2026-0118") === normalizeInvoiceNumber("F20260118"));
check("null → lege string", normalizeInvoiceNumber(null) === "");
check("staart zonder voorloopnullen", invoiceNumberTail("F2026-000118") === "118");
check("staart van 2 cijfers is te zwak → leeg", invoiceNumberTail("F-42") === "");
check("staart van een nummer zonder cijfers → leeg", invoiceNumberTail("FACTUUR") === "");

console.log("\n[STATEMENT-RECONCILE] de kern: wat ontbreekt");
{
  const r = reconcileStatement({
    lines: [line({ invoice_number: "2026-118" }), line({ invoice_number: "2026-140", amount: 84.7 })],
    booked: [booked({ id: "a", invoice_number: "2026-118" })],
  });
  check("de factuur die we hebben staat in matched", r.matched.length === 1 && r.matched[0].how === "number");
  check("de factuur die we niet hebben staat in missing", r.missing.length === 1 && r.missing[0].invoice_number === "2026-140");
  check("het ontbrekende bedrag wordt geteld", r.missingAmount === 84.7);
}

console.log("\n[STATEMENT-RECONCILE] geen vals alarm");
{
  // Zelfde factuur, ander formaat nummer op het overzicht dan in onze boeken.
  const r = reconcileStatement({
    lines: [line({ invoice_number: "F 2026 / 0118" })],
    booked: [booked({ invoice_number: "f2026-0118" })],
  });
  check("nummer met andere leestekens matcht toch", r.missing.length === 0 && r.matched.length === 1);
}
{
  const r = reconcileStatement({
    lines: [line({ invoice_number: "118" })],
    booked: [booked({ invoice_number: "F2026-0118" })],
  });
  check("kort overzichtsnummer matcht op de staart", r.matched.length === 1 && r.matched[0].how === "number_tail");
}
{
  // Geen nummer op het overzicht, wel bedrag + datum.
  const r = reconcileStatement({
    lines: [line({ invoice_number: null, amount: 121, date: "2026-05-12" })],
    booked: [booked({ invoice_date: "2026-05-10", total_inc_btw: 121 })],
  });
  check("bedrag + datum binnen het venster matcht", r.matched.length === 1 && r.matched[0].how === "amount_date");
}
{
  const r = reconcileStatement({
    lines: [line({ invoice_number: null, amount: 121, date: "2026-05-30" })],
    booked: [booked({ invoice_date: "2026-05-10", total_inc_btw: 121 })],
  });
  check("zelfde bedrag maar 20 dagen ernaast matcht NIET (te zwak om te gokken)", r.missing.length === 1);
}
{
  const r = reconcileStatement({
    lines: [line({ invoice_number: null, amount: 121, date: null })],
    booked: [booked({ total_inc_btw: 121 })],
  });
  check("alleen bedrag, geen datum → geen match (nooit op bedrag alleen koppelen)", r.missing.length === 1);
}
{
  const r = reconcileStatement({
    lines: [line({ amount: 121.01 })],
    booked: [booked({ invoice_number: "ANDERS", total_inc_btw: 121 })],
  });
  check("1 cent verschil valt binnen de tolerantie", r.matched.length === 1);
}

console.log("\n[STATEMENT-RECONCILE] creditnota's en betalingen");
{
  const r = reconcileStatement({
    lines: [line({ invoice_number: "C-9", amount: -50, kind: "credit" })],
    booked: [booked({ id: "c", invoice_number: "C-9", total_inc_btw: -50 })],
  });
  check("een creditregel matcht op nummer", r.matched.length === 1 && r.missing.length === 0);
}
{
  const r = reconcileStatement({
    lines: [
      line({ kind: "payment", invoice_number: null, amount: -500, description: "Betaling ontvangen" }),
      line({ kind: "other", invoice_number: null, amount: 1234, description: "Totaal openstaand" }),
    ],
    booked: [],
  });
  check("betaling en saldoregel tellen niet mee als ontbrekend", r.missing.length === 0 && r.skipped.length === 2);
}

console.log("\n[STATEMENT-RECONCILE] onleesbaar ≠ ontbrekend");
{
  const r = reconcileStatement({
    lines: [line({ invoice_number: null, amount: null, date: null })],
    booked: [],
  });
  check("regel zonder nummer én zonder bedrag → unreadable, niet missing",
    r.missing.length === 0 && r.unreadable.length === 1);
  check("de samenvatting claimt dan niets over volledigheid",
    /niet lezen/.test(summarizeReconcile(r)));
}

console.log("\n[STATEMENT-RECONCILE] genegeerde facturen");
{
  const r = reconcileStatement({
    lines: [line({ invoice_number: "2026-118" })],
    booked: [booked({ invoice_number: "2026-118", status: "archived" })],
  });
  check("genegeerd telt niet als ontbrekend", r.missing.length === 0);
  check("…maar wel apart, want de leverancier ziet hem nog open", r.archived.length === 1 && r.matched.length === 0);
  check("de samenvatting noemt het", /genegeerd/.test(summarizeReconcile(r)));
}

console.log("\n[STATEMENT-RECONCILE] elke factuur maar één keer");
{
  // Twee identieke regels op het overzicht, maar wij hebben er één → precies één ontbreekt.
  const r = reconcileStatement({
    lines: [line({ invoice_number: "2026-118" }), line({ invoice_number: "2026-118" })],
    booked: [booked({ id: "a", invoice_number: "2026-118" })],
  });
  check("een tweede identieke regel matcht niet nogmaals op dezelfde factuur",
    r.matched.length === 1 && r.missing.length === 1);
}

console.log("\n[STATEMENT-RECONCILE] wij hebben iets dat er niet op staat");
{
  const r = reconcileStatement({
    lines: [
      line({ invoice_number: "2026-118", date: "2026-05-01" }),
      line({ invoice_number: "2026-121", date: "2026-05-10", amount: 60 }),
    ],
    booked: [
      booked({ id: "a", invoice_number: "2026-118", invoice_date: "2026-05-01" }),
      booked({ id: "d", invoice_number: "2026-121", invoice_date: "2026-05-10", total_inc_btw: 60 }),
      booked({ id: "b", invoice_number: "2026-119", invoice_date: "2026-05-09" }),
      booked({ id: "c", invoice_number: "2026-200", invoice_date: "2026-09-01" }), // ná de periode
    ],
  });
  check("factuur binnen de periode die niet op het overzicht staat wordt gemeld",
    r.notOnStatement.length === 1 && r.notOnStatement[0].id === "b");
  check("een factuur buiten de periode wordt met rust gelaten",
    !r.notOnStatement.some((i) => i.id === "c"));
}
{
  // Eén regel ⇒ afgeleide periode is één dag breed. Met de periode uit de KOP van het overzicht
  // kunnen we wél iets zeggen over wat wij extra hebben.
  const r = reconcileStatement({
    lines: [line({ invoice_number: "2026-118", date: "2026-05-10" })],
    period: { from: "2026-05-01", to: "2026-05-31" },
    booked: [
      booked({ id: "a", invoice_number: "2026-118", invoice_date: "2026-05-10" }),
      booked({ id: "b", invoice_number: "2026-119", invoice_date: "2026-05-09" }),
    ],
  });
  check("een expliciete periode uit de kop verruimt de vergelijking",
    r.notOnStatement.length === 1 && r.notOnStatement[0].id === "b");
  check("de gemelde periode is die van de kop", r.period?.from === "2026-05-01" && r.period?.to === "2026-05-31");
}
{
  const r = reconcileStatement({ lines: [line({ date: null })], booked: [booked({ id: "x", invoice_number: "ANDERS" })] });
  check("zonder periode doen we geen uitspraak over wat wij extra hebben", r.notOnStatement.length === 0);
}

console.log("\n[STATEMENT-RECONCILE] periode + notitie");
{
  const p = derivePeriod([line({ date: "2026-05-10" }), line({ date: "2026-03-02" }), line({ date: null })]);
  check("periode = vroegste t/m laatste regeldatum", p?.from === "2026-03-02" && p?.to === "2026-05-10");
}
{
  const r = reconcileStatement({
    lines: [line({ invoice_number: "2026-118" }), line({ invoice_number: "2026-140" })],
    booked: [booked({ invoice_number: "2026-118" })],
  });
  const note = reconcileNote(r, "Sligro");
  check("de notitie noemt de leverancier", /Sligro/.test(note));
  check("de notitie noemt het nummer dat de eigenaar moet zoeken", /2026-140/.test(note));
  check("…en niet het nummer dat hij al heeft", !/2026-118/.test(note.split("Ontbreekt:")[1] ?? ""));
}
{
  const r = reconcileStatement({ lines: [line()], booked: [booked()] });
  check("alles compleet → geen 'ontbreekt' in de notitie", !/Ontbreekt/.test(reconcileNote(r)));
}

console.log("\n[STATEMENT-RECONCILE] lege invoer");
{
  const r = reconcileStatement({ lines: [], booked: [] });
  check("geen regels → geen claims", r.missing.length === 0 && r.matched.length === 0 && r.period === null);
  check("de samenvatting zegt dat er geen regels waren", /Geen factuurregels/.test(summarizeReconcile(r)));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
