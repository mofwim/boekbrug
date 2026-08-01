// [NAMENS] Pure node test — run: npx tsx --test src/lib/namens-poorten.test.ts
//
// WAAROM DEZE TEST BESTAAT
//
// Een verkoopmedewerker deelt de sessie-vorm van een gewone gebruiker: hij is ingelogd, hij heeft
// een user.id, en elke bestaande factuurroute gaat er vanuit dat dát id de eigenaar van de
// boekhouding is. De routes die hij nodig heeft zijn omgebouwd om NAMENS de eigenaar te werken
// (zie de OMGEBOUWD-lijst hieronder); de rest is bewust dichtgezet (alleen-eigenaar.ts).
//
// DE FOUT DIE DIT VOORKOMT
// Iemand voegt over een half jaar /api/invoice/iets-nieuws toe, schrijft `sender_id: user.id`
// zoals overal, en er gebeurt niets zichtbaars — behalve dat een medewerker daar een tweede
// nummerreeks onder hetzelfde BTW-nummer opent. Art. 35 Wet OB eist doorlopende nummering zonder
// gaten, en een uitgegeven nummer komt niet terug. Zo'n fout ontdek je bij een controle, niet in
// een foutmelding.
//
// Daarom: elke route onder /api/invoice moet EEN VAN TWEE dingen doen — de eigenaar oplossen
// (getActingFor) of een medewerker weigeren (vereisEigenaar). Zwijgen is geen optie.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WORTEL = "src/app/api/invoice";

function alleRoutes(dir: string): string[] {
  const uit: string[] = [];
  for (const naam of readdirSync(dir)) {
    const pad = join(dir, naam);
    if (statSync(pad).isDirectory()) uit.push(...alleRoutes(pad));
    else if (naam === "route.ts") uit.push(pad);
  }
  return uit;
}

test("er zijn factuurroutes om te bewaken", () => {
  // Vangnet onder het vangnet: verhuist de map, dan zou de test hieronder over een lege lijst
  // lopen en altijd slagen. Een lege poort is erger dan geen poort.
  const routes = alleRoutes(WORTEL);
  assert.ok(routes.length >= 8, `slechts ${routes.length} routes gevonden onder ${WORTEL}`);
});

test("elke factuurroute lost de eigenaar op OF weigert een medewerker", () => {
  const zwijgt: string[] = [];
  for (const pad of alleRoutes(WORTEL)) {
    const bron = readFileSync(pad, "utf8");
    const handeltNamens = /getActingFor/.test(bron);
    const weigert = /vereisEigenaar/.test(bron);
    if (!handeltNamens && !weigert) zwijgt.push(pad);
  }
  assert.deepEqual(
    zwijgt,
    [],
    "Deze routes zeggen niets over wie er handelt. Kies één van twee:\n" +
      "  · omgebouwd: getActingFor() + factuurEigenaar() — zoals /api/invoice/send;\n" +
      "  · nog niet aan de beurt: vereisEigenaar('…') bovenaan de handler.\n" +
      "Niets doen betekent dat een verkoopmedewerker hier onder ZIJN eigen id boekt, en dat is " +
      "een tweede nummerreeks onder het BTW-nummer van zijn baas.",
  );
});

/**
 * De routes waar een verkoopmedewerker daadwerkelijk doorheen loopt — de hele levensloop van
 * een factuur zoals hij die kan bewandelen: maken, opslaan/bewerken/weggooien, versturen,
 * herinneren, dupliceren, corrigeren met een creditnota, en er een betaallink bij maken.
 *
 * Elk van deze moet de EIGENAAR hebben opgelost. Vergeet er één dat, dan boekt de medewerker
 * daar onder zijn eigen id — en dan lopen er twee nummerreeksen onder één BTW-nummer.
 */
const OMGEBOUWD = [
  "src/app/api/invoice/draft/route.ts",
  "src/app/api/invoice/send/route.ts",
  "src/app/api/invoice/[id]/route.ts",
  "src/app/api/invoice/[id]/duplicate/route.ts",
  "src/app/api/invoice/[id]/reminder/route.ts",
  "src/app/api/invoice/creditnota/route.ts",
  "src/app/api/invoice/[id]/betaalverzoek/route.ts",
];

test("elke route die een medewerker mag gebruiken, rekent op naam van de EIGENAAR", () => {
  for (const pad of OMGEBOUWD) {
    const bron = readFileSync(pad, "utf8");
    assert.ok(/getActingFor/.test(bron), `${pad} lost de eigenaar niet op`);
    assert.ok(/factuurEigenaar/.test(bron), `${pad} gebruikt factuurEigenaar() niet`);
  }
});

test("geen van die routes bepaalt eigenaarschap nog met user.id", () => {
  // De vorm die overal in deze codebase stond: `.eq('sender_id', user.id)` of
  // `sender_id: user.id`. Dat is precies wat fout gaat zodra de ingelogde mens niet de eigenaar
  // is. Audit-regels (`userId: user.id`) blijven wél toegestaan — die horen de ACTOR te noemen.
  for (const pad of OMGEBOUWD) {
    const bron = readFileSync(pad, "utf8");
    for (const patroon of [
      /\.eq\(\s*['"]sender_id['"]\s*,\s*user\.id\s*\)/,
      /sender_id:\s*user\.id/,
      /generateInvoiceNumber\([^)]*,\s*user\.id\s*,/,
      /\$\{user\.id\}\/facturen/,
    ]) {
      assert.ok(
        !patroon.test(bron),
        `${pad} bepaalt eigenaarschap nog met user.id (${patroon}) — dat hoort ownerId te zijn`,
      );
    }
  }
});

test("de twee routes die een NUMMER uitgeven doen dat met de sessie-client", () => {
  // next_invoice_seq() weigert onvoorwaardelijk zodra auth.uid() NULL is. service_role kan hier
  // dus niet in de plaats treden, en dat is de wacht die voorkomt dat een willekeurige
  // serverroute nummers kan uitgeven. Zie company_members_sales_role.sql.
  for (const pad of ["src/app/api/invoice/send/route.ts", "src/app/api/invoice/creditnota/route.ts"]) {
    const bron = readFileSync(pad, "utf8");
    assert.ok(
      /generateInvoiceNumber\(\s*supabase\s*,\s*ownerId\s*,/.test(bron),
      `${pad}: het nummer moet uit de reeks van ownerId komen, via de sessie-client`,
    );
    assert.ok(
      !/generateInvoiceNumber\(\s*createPipelineClient\(\)/.test(bron),
      `${pad}: service_role mag geen nummers slaan`,
    );
  }
});

test("niemand schrijft created_by zonder terugval — dat brak het aanmaken van een factuur", () => {
  // ECHT GEBEURD, EN DIT WAS DE ERNSTIGSTE FOUT VAN DEZE HELE BOUW.
  //
  // created_by komt uit company_members_sales_role.sql. De code die hem schrijft stond al op
  // main, met `as any` erbij omdat de gegenereerde types hem niet kennen. Maar `as any` zwijgt de
  // TYPECONTROLE, niet de database: zolang de migratie niet is toegepast antwoordt PostgREST met
  // PGRST204 en faalt het HELE verzoek. Op zo'n installatie kon er geen factuur meer worden
  // aangemaakt — door niemand.
  //
  // tsc was schoon, 441 tests waren groen, de build slaagde. Geen van drieën kijkt naar de echte
  // database. Daarom staat de regel nu hier, waar hij wél gecontroleerd wordt.
  const OVERAL = ["src/app/api", "src/app/dashboard"];
  const teControleren: string[] = [];
  const loop = (dir: string) => {
    for (const naam of readdirSync(dir)) {
      const pad = join(dir, naam);
      if (statSync(pad).isDirectory()) loop(pad);
      else if (/\.tsx?$/.test(naam)) teControleren.push(pad);
    }
  };
  for (const d of OVERAL) loop(d);

  const zondig: string[] = [];
  for (const pad of teControleren) {
    const bron = readFileSync(pad, "utf8");
    // Alleen een SCHRIJFACTIE telt: created_by binnen een .insert()/.update()/.upsert().
    //
    // Niet elk voorkomen is er een. Een typedeclaratie (`{ id: string; created_by: string }`),
    // een leesfilter (`.eq('created_by', …)`) en een select-lijst raken de kolom ook, maar die
    // zijn ofwel onschadelijk ofwel al in een try/catch gevangen. Deze test viel eerst op zo'n
    // typedeclaratie — een poort die op de verkeerde dingen afgaat, leert mensen hem te negeren.
    const schrijft = /\.(insert|update|upsert)\([\s\S]{0,4000}?created_by/.test(bron);
    if (!schrijft) continue;
    // Mag alleen binnen de terugval, of als de sleutel via `...spoor` binnenkomt.
    if (!/schrijfMetSpoor/.test(bron)) zondig.push(pad);
  }
  assert.deepEqual(
    zondig,
    [],
    "Deze bestanden schrijven created_by rechtstreeks. Op een database zonder de migratie faalt " +
      "dat verzoek volledig (PGRST204). Gebruik schrijfMetSpoor() uit src/lib/created-by.ts.",
  );
});

test("wat een medewerker NIET mag, weigert hem met een leesbare zin", () => {
  // De andere kant van de grens. Deze routes gaan er allemaal van uit dat de ingelogde mens de
  // eigenaar is; ze zijn bewust dicht in plaats van half omgebouwd.
  for (const pad of [
    "src/app/api/invoice/numbering/route.ts",      // verandert de reeks van het hele bedrijf
    "src/app/api/invoice/pay-toggle/route.ts",     // raakt de geldwaarheid en de bankafstemming
    "src/app/api/invoice/schedules/route.ts",      // een doorlopende verplichting
    "src/app/api/invoice/[id]/archive/route.ts",   // een factuur uit de boeken halen
  ]) {
    const bron = readFileSync(pad, "utf8");
    assert.ok(/vereisEigenaar/.test(bron), `${pad} hoort dicht te staan voor een medewerker`);
  }
});

test("de send-route slaat het nummer op naam van de EIGENAAR", () => {
  // De enige regel in de codebase waar een wettelijk factuurnummer ontstaat. Zou hier ooit weer
  // `user.id` staan, dan krijgt elke medewerker zijn eigen reeks — de fout die deze hele bouw
  // moest voorkomen, in één woord.
  const bron = readFileSync("src/app/api/invoice/send/route.ts", "utf8");
  assert.ok(
    /generateInvoiceNumber\(\s*supabase\s*,\s*ownerId\s*,/.test(bron),
    "generateInvoiceNumber moet ownerId krijgen — niet user.id",
  );
  // En met de SESSIE-client: next_invoice_seq() weigert onvoorwaardelijk zodra auth.uid() NULL
  // is, dus service_role kan hier niet in de plaats treden.
  assert.ok(
    !/generateInvoiceNumber\(\s*createPipelineClient\(\)/.test(bron),
    "service_role mag geen nummers slaan — zie de wacht in next_invoice_seq()",
  );
});

test("de browser schrijft geen facturen meer rechtstreeks", () => {
  // De pagina deed `supabase.from('invoices').insert({ sender_id: user.id, ... })`. Dat kon
  // zolang er één mens per boekhouding was. Komt die vorm terug, dan kiest de BROWSER weer wie
  // de eigenaar is — en dan is /api/invoice/draft een omweg die niemand meer neemt.
  const pagina = readFileSync("src/app/dashboard/invoice/new/page.tsx", "utf8");
  assert.ok(
    !/from\(['"]invoices['"]\)\s*\.insert/.test(pagina),
    "de nieuwe-factuurpagina mag niet zelf in invoices schrijven — dat loopt via /api/invoice/draft",
  );
  assert.ok(
    !/from\(['"]invoice_lines['"]\)\s*\.insert/.test(pagina),
    "en ook niet in invoice_lines",
  );
  assert.ok(/\/api\/invoice\/draft/.test(pagina), "hij hoort de serverroute te gebruiken");
});
