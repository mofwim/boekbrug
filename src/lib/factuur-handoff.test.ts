// [FUNNEL-OVERDRACHT] Pure node test — run: npx tsx src/lib/factuur-handoff.test.ts
import {
  buildHandoff, readHandoff, writeHandoff, clearHandoff,
  hasInvoiceContent, hasSenderContent, isMeaningfulLine,
  toOnboardingCompany, describeHandoff,
  HANDOFF_KEY, HANDOFF_TTL_DAYS,
  type HandoffStorage,
} from "./factuur-handoff";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

/** Een opslag die zich gedraagt zoals localStorage, inclusief het kunnen wéigeren. */
function mem(initial: Record<string, string> = {}, opts: { failWrites?: boolean; failReads?: boolean } = {}): HandoffStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => { if (opts.failReads) throw new Error("blocked"); return k in data ? data[k] : null; },
    setItem: (k, v) => { if (opts.failWrites) throw new Error("quota"); data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}

const NU = new Date("2026-07-31T12:00:00Z");
const daysAgo = (n: number) => new Date(NU.getTime() - n * 86_400_000);

const volleDraft = (now = NU) => buildHandoff({
  sender: { company_name: "Garage Jansen", address: "Kerkstraat 12", postal_code: "5000 AA", city: "Tilburg", kvk_number: "12345678", btw_number: "nl123456789b01", iban: "nl91 abna 0417 1643 00" },
  client: { client_name: "Bakkerij de Vries", client_email: "info@devries.nl" },
  lines: [
    { description: "Grote beurt", quantity: 1, unit_price: 250, btw_rate: 21 },
    { description: "Remblokken", quantity: 4, unit_price: 32.5, btw_rate: 21 },
  ],
  invoiceDate: "2026-07-31",
  now,
});

console.log("\n— de rondgang: wat erin gaat komt er hetzelfde uit —");
{
  const s = mem();
  const h = volleDraft();
  check("schrijven lukt", writeHandoff(s, h) === true);
  const back = readHandoff(s, NU);
  check("er komt iets terug", back !== null);
  check("de klant overleeft", back?.client.client_name === "Bakkerij de Vries");
  check("beide regels overleven", back?.lines.length === 2);
  check("bedragen blijven exact", back?.lines[1].unit_price === 32.5 && back?.lines[1].quantity === 4);
  check("het BTW-tarief blijft staan", back?.lines[0].btw_rate === 21);
  check("de factuurdatum komt mee", back?.invoiceDate === "2026-07-31");
}

console.log("\n— het factuurnummer komt met opzet NIET mee (art. 35) —");
{
  // In de gratis tool is het nummer een gewoon veld; in het product komt het uit de
  // doorlopende reeks. Een zelfgekozen nummer laten binnenwandelen maakt precies het gat in
  // die reeks waar de rest van de codebase voor waakt.
  const s = mem();
  writeHandoff(s, volleDraft());
  const opgeslagen = JSON.parse(s.data[HANDOFF_KEY]);
  check("er zit geen nummerveld in de payload", !("invoiceNumber" in opgeslagen) && !("invoice_number" in opgeslagen));
  const keys = Object.keys(opgeslagen);
  check("...ook niet onder een andere naam", !keys.some((k) => /nummer|number/i.test(k)));
}

console.log("\n— houdbaarheid: een concept van maanden geleden mag niet opduiken —");
{
  const vers = mem(); writeHandoff(vers, volleDraft(daysAgo(1)));
  check("één dag oud komt gewoon door", readHandoff(vers, NU) !== null);

  const rand = mem(); writeHandoff(rand, volleDraft(daysAgo(HANDOFF_TTL_DAYS - 0.1)));
  check("net binnen de termijn komt door", readHandoff(rand, NU) !== null);

  const oud = mem(); writeHandoff(oud, volleDraft(daysAgo(HANDOFF_TTL_DAYS + 1)));
  check("net erbuiten wordt genegeerd", readHandoff(oud, NU) === null);

  const eeuwen = mem(); writeHandoff(eeuwen, volleDraft(daysAgo(400)));
  check("een jaar oud zeker", readHandoff(eeuwen, NU) === null);

  // Een verzette systeemklok mag geen eeuwig geldige payload opleveren.
  const toekomst = mem(); writeHandoff(toekomst, volleDraft(new Date(NU.getTime() + 5 * 86_400_000)));
  check("een payload uit de toekomst wordt niet vertrouwd", readHandoff(toekomst, NU) === null);
}

console.log("\n— kapotte opslag levert een lege staat op, nooit een crash —");
{
  check("lege opslag → null", readHandoff(mem(), NU) === null);
  check("geen JSON → null", readHandoff(mem({ [HANDOFF_KEY]: "{niet eens json" }), NU) === null);
  check("JSON maar geen object → null", readHandoff(mem({ [HANDOFF_KEY]: '"tekst"' }), NU) === null);
  check("een array → null", readHandoff(mem({ [HANDOFF_KEY]: "[1,2,3]" }), NU) === null);
  check("null als payload → null", readHandoff(mem({ [HANDOFF_KEY]: "null" }), NU) === null);
  check("een andere versie → null", readHandoff(mem({ [HANDOFF_KEY]: JSON.stringify({ ...volleDraft(), version: 99 }) }), NU) === null);
  check("zonder savedAt → null", readHandoff(mem({ [HANDOFF_KEY]: JSON.stringify({ ...volleDraft(), savedAt: "" }) }), NU) === null);
  check("met onleesbare savedAt → null", readHandoff(mem({ [HANDOFF_KEY]: JSON.stringify({ ...volleDraft(), savedAt: "gisteren" }) }), NU) === null);
  check("geblokkeerde opslag bij lezen → null, geen exception", readHandoff(mem({}, { failReads: true }), NU) === null);
  check("volle opslag bij schrijven → false, geen exception", writeHandoff(mem({}, { failWrites: true }), volleDraft()) === false);
}

console.log("\n— rommel in de regels wordt nooit een bedrag —");
{
  const vies = JSON.stringify({
    ...volleDraft(),
    lines: [
      { description: "Goed", quantity: 2, unit_price: 10, btw_rate: 9 },
      { description: "NaN", quantity: NaN, unit_price: 5, btw_rate: 21 },   // NaN → JSON null
      { description: "tekst als bedrag", quantity: "3", unit_price: "10", btw_rate: 21 },
      { description: "", quantity: 0, unit_price: 0, btw_rate: 21 },        // leeg → weg
      null,
      { description: "geen tarief", quantity: 1, unit_price: 4 },
    ],
  });
  const h = readHandoff(mem({ [HANDOFF_KEY]: vies }), NU);
  check("er komt iets terug ondanks de rommel", h !== null);
  check("lege regels zijn eruit gefilterd", !h!.lines.some((l) => !isMeaningfulLine(l)));
  check("geen enkel bedrag is NaN", h!.lines.every((l) => Number.isFinite(l.quantity) && Number.isFinite(l.unit_price)));
  check("een tekstbedrag wordt 0, niet 'NaN'", h!.lines.some((l) => l.description === "tekst als bedrag" && l.unit_price === 0));
  // Het duurste stille foutje: een ontbrekend tarief dat als 0% doorgaat leest als vrijgesteld.
  check("een ontbrekend tarief wordt 21%, nooit 0%", h!.lines.find((l) => l.description === "geen tarief")?.btw_rate === 21);
  check("een echt 9%-tarief blijft 9%", h!.lines[0].btw_rate === 9);
}

console.log("\n— we bieden alleen iets aan als er ook iets ís —");
{
  const leeg = buildHandoff({ sender: {}, client: {}, lines: [] });
  check("een lege overdracht heeft geen factuurinhoud", hasInvoiceContent(leeg) === false);
  check("...en niets om onboarding mee te vullen", hasSenderContent(leeg) === false);
  check("null is ook niets", hasInvoiceContent(null) === false && hasSenderContent(null) === false);

  // Alleen afzendergegevens: die staan er al door een eerder bezoek aan de gratis tool. Dat is
  // géén reden om "we vonden je factuur" te tonen — dat zou zelf een loze belofte zijn.
  const alleenAfzender = buildHandoff({ sender: { company_name: "Garage Jansen" }, client: {}, lines: [] });
  check("alleen afzender → geen factuur aanbieden", hasInvoiceContent(alleenAfzender) === false);
  check("...maar onboarding heeft er wél iets aan", hasSenderContent(alleenAfzender) === true);

  const alleenKlant = buildHandoff({ sender: {}, client: { client_name: "De Vries" }, lines: [] });
  check("alleen een klantnaam is al genoeg om aan te bieden", hasInvoiceContent(alleenKlant) === true);
  const alleenRegel = buildHandoff({ sender: {}, client: {}, lines: [{ description: "Werk", quantity: 1, unit_price: 100, btw_rate: 21 }] });
  check("alleen een regel ook", hasInvoiceContent(alleenRegel) === true);
}

console.log("\n— het afzenderblok naar de onboarding —");
{
  const c = toOnboardingCompany(volleDraft());
  check("bedrijfsnaam komt over", c.company_name === "Garage Jansen");
  check("KVK komt over", c.kvk_number === "12345678");
  check("BTW wordt genormaliseerd naar hoofdletters", c.btw_number === "NL123456789B01");
  check("IBAN verliest zijn spaties", c.iban === "NL91ABNA0417164300");
  check("postcode en plaats gaan niet verloren", c.address === "Kerkstraat 12, 5000 AA Tilburg");

  // Een eenmanszaak vult vaak alleen zijn eigen naam in.
  const zzp = toOnboardingCompany(buildHandoff({ sender: { full_name: "Mo Bakker" }, client: {}, lines: [] }));
  check("zonder bedrijfsnaam valt hij terug op de eigen naam", zzp.company_name === "Mo Bakker");
  const niets = toOnboardingCompany(buildHandoff({ sender: {}, client: {}, lines: [] }));
  check("niets ingevuld geeft lege velden, geen 'undefined'", niets.company_name === "" && niets.address === "");
}

console.log("\n— de zin die de gebruiker leest —");
{
  check("klant + regels", describeHandoff(volleDraft()) === "Bakkerij de Vries — 2 regels");
  const een = buildHandoff({ sender: {}, client: { client_name: "X" }, lines: [{ description: "Werk", quantity: 1, unit_price: 1, btw_rate: 21 }] });
  check("enkelvoud klopt", describeHandoff(een) === "X — 1 regel");
  const zonderKlant = buildHandoff({ sender: {}, client: {}, lines: [{ description: "Werk", quantity: 1, unit_price: 1, btw_rate: 21 }] });
  check("zonder klant blijft het leesbaar", zonderKlant && describeHandoff(zonderKlant) === "1 regel");
}

console.log("\n— opruimen —");
{
  const s = mem();
  writeHandoff(s, volleDraft());
  check("staat erin", readHandoff(s, NU) !== null);
  clearHandoff(s);
  check("en is daarna weg", readHandoff(s, NU) === null);
  // Lezen mag NIET opruimen: tussen registreren en de eerste factuur zitten meerdere schermen,
  // en een overdracht die bij het eerste kijkje verdampt is geen overdracht.
  const s2 = mem();
  writeHandoff(s2, volleDraft());
  readHandoff(s2, NU); readHandoff(s2, NU);
  check("twee keer lezen laat hem staan", readHandoff(s2, NU) !== null);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
