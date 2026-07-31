// [VAK-SJABLONEN] Pure node test — run: npx tsx src/lib/vak-sjablonen.test.ts
import { VAKKEN, vakBySlug, vakOpties, vakRegelsVoorFormulier, type BtwTarief } from "./vak-sjablonen";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("\n— GEEN PRIJZEN. Dit is de belangrijkste regel van het bestand —");
{
  // Een voorgevuld uurtarief is fout voor iedereen behalve toevallig één iemand, en een
  // verkeerd bedrag dat ongemerkt meegaat op een echte factuur is erger dan een leeg veld.
  // Deze test is er om te voorkomen dat "even een richtprijs erbij" ooit binnenglipt.
  const alleRegels = VAKKEN.flatMap((v) => v.regels);
  const metPrijs = alleRegels.filter((r) => Object.prototype.hasOwnProperty.call(r, "unit_price") || Object.prototype.hasOwnProperty.call(r, "prijs"));
  check(`geen enkele sjabloonregel draagt een prijs (${alleRegels.length} regels gecontroleerd)`, metPrijs.length === 0);

  // En ook niet verstopt in de omschrijving.
  const bedragInTekst = alleRegels.filter((r) => /€|\bEUR\b|\d+[.,]\d{2}\b/.test(r.description));
  check(`geen bedrag verstopt in een omschrijving${bedragInTekst.length ? " (" + bedragInTekst.map((r) => r.description).join(", ") + ")" : ""}`, bedragInTekst.length === 0);

  const formulier = VAKKEN.flatMap((v) => vakRegelsVoorFormulier(v.slug));
  check("het formulier krijgt overal een leeg prijsveld", formulier.every((r) => r.unit_price === ""));
  check("...en aantal 1, zodat er alleen een bedrag hoeft te worden ingevuld", formulier.every((r) => r.quantity === "1"));
}

console.log("\n— alleen tarieven die op een Nederlandse factuur bestaan —");
{
  const toegestaan: BtwTarief[] = [21, 9, 0];
  const fout = VAKKEN.flatMap((v) => v.regels.filter((r) => !toegestaan.includes(r.btw_rate)).map((r) => `${v.slug}:${r.description}=${r.btw_rate}`));
  check(`elk tarief is 21, 9 of 0${fout.length ? " (" + fout.join(", ") + ")" : ""}`, fout.length === 0);

  // 0% is nooit een stilzwijgende default — het betekent iets specifieks (verlegd, export,
  // vrijgesteld) en mag daarom niet zomaar in een sjabloon staan zonder uitleg.
  const nul = VAKKEN.flatMap((v) => v.regels.filter((r) => r.btw_rate === 0).map(() => v.slug));
  check("geen enkel sjabloon zet zomaar 0% neer", nul.length === 0);
}

console.log("\n— de default is het HOGE tarief; het lage is een bewuste keuze —");
{
  // Te veel BTW rekenen kost de klant geld; te weinig rekenen kost de ondernemer een
  // naheffing. Van die twee is de tweede zwaarder, dus waar het tarief van de situatie
  // afhangt staat 21% ingevuld met een let_op — niet andersom.
  for (const slug of ["schilder", "schoonmaak", "transport"]) {
    const v = vakBySlug(slug)!;
    check(`${slug}: situatie-afhankelijk, dus alle regels op 21%`, v.regels.every((r) => r.btw_rate === 21));
    check(`${slug}: en de uitleg wanneer 9% mag staat erbij`, /9%/.test(v.let_op ?? ""));
  }
}

console.log("\n— de vakken waar 9% wél vaststaat —");
{
  const kapper = vakBySlug("kapper")!;
  check("kappersdiensten staan op 9%", kapper.regels.filter((r) => /knip|kleur|golf|föhn/i.test(r.description)).every((r) => r.btw_rate === 9));
  check("...maar verkochte producten op 21%", kapper.regels.find((r) => /product/i.test(r.description))?.btw_rate === 21);

  const fiets = vakBySlug("fietsenmaker")!;
  check("fietsreparatie staat op 9%", fiets.regels.filter((r) => /reparatie|band|beurt/i.test(r.description)).every((r) => r.btw_rate === 9));
  check("...maar onderdelen en verkoop op 21%", fiets.regels.filter((r) => /onderdeel|onderdelen|verkoop/i.test(r.description)).every((r) => r.btw_rate === 21));

  // Het onderscheid arbeid/materiaal is precies waarom deze twee vakken een let_op hebben.
  check("de kapper legt het productverschil uit", /21%/.test(kapper.let_op ?? ""));
  check("de fietsenmaker ook", /21%/.test(fiets.let_op ?? ""));
}

console.log("\n— de valkuilen zijn benoemd, niet weggelaten —");
{
  const schilder = vakBySlug("schilder")!;
  check("de schilder: de twee-jaargrens staat er", /twee jaar/i.test(schilder.let_op ?? ""));
  check("...en dat materiaal altijd 21% blijft", /materia/i.test(schilder.let_op ?? ""));
  check("...en het advies om arbeid en materiaal te splitsen", /apart/i.test(schilder.let_op ?? ""));

  const transport = vakBySlug("transport")!;
  check("transport: goederen vs. personen staat erin", /personen/i.test(transport.let_op ?? "") && /goederen/i.test(transport.let_op ?? ""));

  const schoonmaak = vakBySlug("schoonmaak")!;
  check("schoonmaak: binnen een woning vs. bedrijfsruimte", /woning/i.test(schoonmaak.let_op ?? "") && /bedrijf/i.test(schoonmaak.let_op ?? ""));

  const bouw = vakBySlug("bouw-klus")!;
  check("bouw: de verleggingsregeling wordt genoemd", /verleg/i.test(bouw.let_op ?? ""));
  // "BTW verlegd" is iets anders dan 0% en dat verschil moet expliciet zijn, anders wordt het
  // sjabloon zelf de bron van de fout die het hoort te voorkomen.
  check("...en dat het iets ánders is dan 0%", /iets anders dan 0%/i.test(bouw.let_op ?? ""));

  const loodgieter = vakBySlug("loodgieter")!;
  check("loodgieter: het misverstand over het lage tarief wordt rechtgezet", /alleen voor schilder/i.test(loodgieter.let_op ?? ""));
}

console.log("\n— de vorm klopt overal —");
{
  check("elk vak heeft een unieke slug", new Set(VAKKEN.map((v) => v.slug)).size === VAKKEN.length);
  check("elk vak heeft een uniek label", new Set(VAKKEN.map((v) => v.label)).size === VAKKEN.length);
  check("elke slug is url-veilig", VAKKEN.every((v) => /^[a-z0-9-]+$/.test(v.slug)));
  check("elk vak heeft een omschrijving", VAKKEN.every((v) => v.omschrijving.trim().length > 0));
  check("elk vak heeft minstens vier regels", VAKKEN.every((v) => v.regels.length >= 4));
  check("geen lege omschrijvingen", VAKKEN.every((v) => v.regels.every((r) => r.description.trim().length > 0)));
  check("binnen een vak geen dubbele regels", VAKKEN.every((v) => new Set(v.regels.map((r) => r.description)).size === v.regels.length));
  check("de beroepen die gevraagd waren zitten erin",
    ["automonteur", "loodgieter", "elektricien", "transport"].every((s) => vakBySlug(s) !== null));
}

console.log("\n— opzoeken en omzetten —");
{
  check("een bekend vak wordt gevonden", vakBySlug("automonteur")?.label === "Automonteur / garage");
  check("een onbekend vak → null, geen crash", vakBySlug("astronaut") === null);
  check("null → null", vakBySlug(null) === null);
  check("lege string → null", vakBySlug("") === null);
  check("de keuzelijst telt evenveel opties als vakken", vakOpties().length === VAKKEN.length);

  const regels = vakRegelsVoorFormulier("automonteur");
  check("het formulier krijgt alle regels", regels.length === vakBySlug("automonteur")!.regels.length);
  check("de eenheid staat in de omschrijving", regels[0].description.includes("(per uur)"));
  check("het tarief komt mee", regels.every((r) => [21, 9, 0].includes(r.btw_rate)));
  check("een onbekend vak levert een lege lijst, geen fout", vakRegelsVoorFormulier("astronaut").length === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
