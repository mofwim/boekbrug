// [DUP-TRASHED] Blijft de byte-hash-poort de prullenbak kennen?
// Run: npx tsx --test src/lib/intake-trashed-dedup.test.ts
//
// WAAROM DIT EEN TEST IS
//
// De bug: gooide de eigenaar een bestand weg en uploadde hij het opnieuw, dan antwoordde /api/intake
// "dit bestand staat al in: <map>" — een map waar het bestand voor hem niet meer staat. En omdat de
// byte-hash-poort met opzet niet te forceren is, was dat een doodlopende weg: hij kon zijn eigen
// bestand nooit meer toevoegen.
//
// De valkuil zit in de REPARATIE, niet in de bug. De voor de hand liggende fix is een `.eq("trashed",
// false)` op de zoekopdracht. Die is fout, en stil fout: de UNIQUE index uit
// documents_content_hash_unique.sql staat op (user_id, content_hash) WHERE content_hash IS NOT NULL
// en weet niets van weggegooid. Een weggegooide rij bezet die sleutel dus nog. Filter je hem alleen
// uit de SELECT, dan verplaatst de 409 zich naar een 23505 op de INSERT erna — en waar de eigenaar
// eerst een verwarrende melding kreeg, krijgt hij dan een 500. Beter bedoeld, slechter afgelopen.
//
// De werkende weg is de rij vinden, zien dat hij weggegooid is, en de HASH van díe rij afhalen
// (content_hash = null) zodat de sleutel vrijkomt. Dat is wat releaseTrashedHash doet.
//
// Deze test bewaakt precies dat verschil. Hij is grof — hij leest de bron als tekst — maar hij vangt
// de ene bewerking die iemand over een half jaar redelijkerwijs zal proberen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROUTE = "src/app/api/intake/route.ts";

/**
 * De route ZONDER commentaar. Dit is geen detail: de uitleg bij releaseTrashedHash noemt letterlijk
 * de verkeerde oplossing (`.eq("trashed", false)`) om te vertellen waarom die fout is. Zou deze test
 * de ruwe tekst lezen, dan zou hij op zijn eigen waarschuwing afgaan en altijd falen — een poort die
 * dichtslaat op het bordje dat ernaast hangt. Wat we willen keuren is de code.
 *
 * Naïef maar hier veilig: de route bevat geen enkele `://`, dus een `//` markeert altijd commentaar
 * en nooit het midden van een URL. Komt er ooit een URL in dit bestand, dan moet deze strip mee.
 */
const bron = () =>
  readFileSync(ROUTE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

test("de weggegooid-uitzondering bestaat nog", () => {
  const src = bron();
  assert.ok(
    /content_hash:\s*null/.test(src),
    "de sleutel wordt nergens meer vrijgegeven — een weggegooid bestand is dan weer voorgoed geblokkeerd",
  );
  assert.ok(
    /trashedDuplicateCleared\s*\(/.test(src),
    "de poort die weggegooid van levend onderscheidt is weg",
  );
});

test("géén SQL-filter op trashed in de dedup-zoekopdracht", () => {
  // Zie de kop: filteren in de SELECT laat de UNIQUE index de blokkade overnemen, en die geeft een
  // 500 in plaats van een 409. Als deze regel ooit moet vervallen, hoort daar eerst een migratie bij
  // die de index partieel maakt op trashed = false.
  assert.ok(
    !/\.eq\(\s*["']trashed["']/.test(bron()),
    `${ROUTE} filtert op trashed in SQL — dan verschuift de blokkade naar de UNIQUE index (23505 → 500). ` +
      "Vergelijk in JS op `trashed === true` en geef de hash vrij; zie releaseTrashedHash.",
  );
});

test("elke hash-botsing die tot een 409 leidt, kent het trashed-veld", () => {
  // Elke POORT die op content_hash zoekt en daarop een duplicaat kan melden, moet weten of de
  // gevonden rij weggegooid is. Zonder dat veld valt de beslissing terug op onvolledige informatie
  // en is de doodlopende weg terug — zonder dat er iets breekt of rood wordt.
  //
  // Eén soort query is de uitzondering: de 23505-HERSTELQUERY. Die draait pas NA een botsing op de
  // UNIQUE index, en op dat punt is de gevonden rij per definitie levend — weggegooide sleutels zijn
  // vóór de insert al vrijgegeven. Die hoeft het veld niet.
  //
  // Deze test telde die uitzonderingen eerst gewoon ("hoogstens twee"). Dat was de verkeerde vorm: er
  // kwam er een derde bij (het onleesbare-pad kreeg ook [DEDUP-ATOMIC]) en de test viel, terwijl er
  // niets mis was. Een drempel die je bij elke legitieme toevoeging ophoogt, bewaakt op den duur niets
  // meer. Dus niet tellen maar kijken: staat er vlak vóór deze query een 23505-afhandeling, dan is het
  // een herstelquery. Zo niet, dan is het een poort en hoort 'trashed' erbij.
  const src = bron();
  const gates: string[] = [];
  const recoveries: string[] = [];
  const marker = '.from("documents")';
  for (let i = src.indexOf(marker); i !== -1; i = src.indexOf(marker, i + 1)) {
    // `storage.from("documents")` is de Storage-bucket, geen tabel. Zonder deze uitsluiting telt een
    // `.remove([storagePath])` mee als zoekopdracht.
    if (/storage\s*$/.test(src.slice(Math.max(0, i - 12), i))) continue;
    // Bovengrens op het venster: tot de VOLGENDE .from("documents"). Zonder die grens loopt een
    // aanroep zonder terminator door tot een `single()` verderop in het bestand, en dan wordt een
    // wildvreemde query als deze query gelezen.
    const next = src.indexOf(marker, i + 1);
    const chunk = src.slice(i, next === -1 ? src.length : next);
    const end = chunk.search(/maybeSingle\(\)|\.single\(\)/);
    if (end === -1) continue;
    const q = chunk.slice(0, end);
    if (!/\.eq\(\s*["']content_hash["']/.test(q) || !/select\(/.test(q)) continue;
    // Het venster vóór de query: ruim genoeg voor de `if (docErr && …code === "23505")` eromheen,
    // te klein om een 23505 van een heel ander blok binnen te halen.
    (/23505/.test(src.slice(Math.max(0, i - 400), i)) ? recoveries : gates).push(q);
  }

  assert.ok(
    gates.length + recoveries.length >= 4,
    `slechts ${gates.length + recoveries.length} hash-zoekopdrachten gevonden — leest deze test de route nog wel?`,
  );
  assert.ok(recoveries.length >= 1, "geen enkele 23505-herstelquery herkend — klopt de contextdetectie nog?");

  const blind = gates.filter((q) => !/trashed/.test(q));
  assert.deepEqual(
    blind.map((q) => q.split("\n")[0].trim()),
    [],
    `${blind.length} POORT-zoekopdracht(en) in ${ROUTE} vragen 'trashed' niet op — dan kan een ` +
      "weggegooid bestand weer als levend duplicaat geweigerd worden, en zit de eigenaar klem.",
  );
});
