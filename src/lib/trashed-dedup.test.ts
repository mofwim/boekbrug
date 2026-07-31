// [DUP-TRASHED] Blijft de byte-hash-poort de prullenbak kennen — op ALLE vier de plekken?
// Run: npx tsx --test src/lib/trashed-dedup.test.ts
//
// WAAROM DIT EEN TEST IS
//
// De bug: gooide de eigenaar een bestand weg en bood hij het opnieuw aan, dan antwoordde de poort
// "dit bestand staat al in: <map>" — een map waar het bestand voor hem niet meer staat. En omdat die
// poort met opzet niet te forceren is, was dat een doodlopende weg: hij kon zijn eigen bestand nooit
// meer toevoegen. Op de mailsync was het nog stiller: daar staat niemand te kijken, dus een opnieuw
// gestuurde factuur werd zonder een woord als duplicaat overgeslagen.
//
// De valkuil zit in de REPARATIE, niet in de bug. De voor de hand liggende fix is een
// `.eq("trashed", false)` op de zoekopdracht. Die is fout, en stil fout: de UNIQUE index uit
// documents_content_hash_unique.sql staat op (user_id, content_hash) WHERE content_hash IS NOT NULL
// en weet niets van weggegooid. Een weggegooide rij bezet die sleutel dus nog. Filter je hem alleen
// uit de SELECT, dan verplaatst de 409 zich naar een 23505 op de INSERT erna — en waar de eigenaar
// eerst een verwarrende melding kreeg, krijgt hij dan een 500. Beter bedoeld, slechter afgelopen.
//
// De werkende weg is de rij vinden, zien dat hij weggegooid is, en de HASH van díe rij afhalen
// (content_hash = null) zodat de sleutel vrijkomt. Dat is wat releaseTrashedHash doet.
//
// Deze test is grof — hij leest de bron als tekst — maar hij vangt de twee bewerkingen die iemand
// over een half jaar redelijkerwijs zal proberen: de verkeerde fix, en een nieuwe poort die het veld
// simpelweg vergeet op te vragen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** De module waar de uitzondering woont. */
const LIB = "src/lib/trashed-dedup.ts";

/**
 * Elke bron met een byte-hash-poort. Komt er een vijfde upload-ingang bij, zet hem hier neer — dan
 * bewaakt deze test hem meteen mee. Dat is het hele punt van de lijst: de bug zat oorspronkelijk op
 * alle vier tegelijk, precies omdat niemand ze naast elkaar had gelegd.
 */
const POORTEN = [
  "src/app/api/intake/route.ts",
  "src/app/api/email/upload/route.ts",
  "src/app/api/bank/attach-invoice/route.ts",
  "src/lib/email-integration.ts",
] as const;

/**
 * Bron ZONDER commentaar. Dit is geen detail: de uitleg bij releaseTrashedHash noemt letterlijk de
 * verkeerde oplossing (`.eq("trashed", false)`) om te vertellen waarom die fout is. Zou deze test de
 * ruwe tekst lezen, dan ging hij af op zijn eigen waarschuwing — een poort die dichtslaat op het
 * bordje dat ernaast hangt.
 *
 * `://` wordt eerst geneutraliseerd, anders knipt de `//`-strip midden in een URL. email-integration
 * bevat er vijftien (Gmail/Graph-endpoints); de eerdere versie van deze test las alleen de
 * intake-route, die er geen had, en die aanname zou hier stilletjes zijn meegereisd.
 */
const bron = (pad: string) =>
  readFileSync(pad, "utf8")
    .replace(/:\/\//g, ":  ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

/** Elke `.from("documents")` / `.from('documents')` die een lookup op content_hash uitvoert. */
function hashQueries(src: string): { query: string; isRecovery: boolean }[] {
  const out: { query: string; isRecovery: boolean }[] = [];
  const re = /\.from\(\s*["']documents["']\s*\)/g;
  const starts: number[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) starts.push(m.index);
  for (let k = 0; k < starts.length; k++) {
    const i = starts[k];
    // `storage.from("documents")` is de Storage-bucket, geen tabel. Zonder deze uitsluiting telt een
    // `.remove([storagePath])` mee als zoekopdracht.
    if (/storage\s*$/.test(src.slice(Math.max(0, i - 12), i))) continue;
    // Bovengrens: tot de VOLGENDE .from("documents"). Zonder die grens loopt een aanroep zonder
    // terminator door tot een `single()` verderop in het bestand, en dan wordt een wildvreemde query
    // als deze query gelezen.
    const chunk = src.slice(i, k + 1 < starts.length ? starts[k + 1] : src.length);
    const end = chunk.search(/maybeSingle\(\)|\.single\(\)/);
    if (end === -1) continue;
    const query = chunk.slice(0, end);
    if (!/\.eq\(\s*["']content_hash["']/.test(query) || !/select\(/.test(query)) continue;
    // Het venster vóór de query: ruim genoeg voor de `if (docErr && …code === "23505")` eromheen,
    // te klein om een 23505 uit een heel ander blok binnen te halen.
    out.push({ query, isRecovery: /23505/.test(src.slice(Math.max(0, i - 400), i)) });
  }
  return out;
}

test("de weggegooid-uitzondering bestaat nog", () => {
  const lib = bron(LIB);
  assert.ok(
    /content_hash:\s*null/.test(lib),
    `${LIB} geeft de sleutel nergens meer vrij — een weggegooid bestand is dan weer voorgoed geblokkeerd`,
  );
  assert.ok(
    /export\s+async\s+function\s+trashedDuplicateCleared/.test(lib),
    "de poort die weggegooid van levend onderscheidt is weg",
  );
  // De vergelijking MOET op `=== true`. Een `!row.trashed` zou een oude rij met NULL als weggegooid
  // lezen en de poort openzetten voor een bestand dat gewoon nog bestaat.
  assert.ok(
    /dup\.trashed\s*!==\s*true/.test(lib),
    "trashed wordt niet meer expliciet op `=== true` vergeleken — een NULL-rij glipt er dan doorheen",
  );
});

test("géén SQL-filter op trashed in een dedup-zoekopdracht", () => {
  // Zie de kop: filteren in de SELECT laat de UNIQUE index de blokkade overnemen, en die geeft een
  // 500 in plaats van een 409. Moet die regel ooit vervallen, dan hoort daar eerst een migratie bij
  // die de index partieel maakt op trashed = false.
  for (const pad of POORTEN) {
    assert.ok(
      !/\.eq\(\s*["']trashed["']/.test(bron(pad)),
      `${pad} filtert op trashed in SQL — dan verschuift de blokkade naar de UNIQUE index ` +
        "(23505 → 500). Vergelijk in code op `trashed === true` en geef de hash vrij; zie releaseTrashedHash.",
    );
  }
});

test("elke poort die op content_hash zoekt, kent het trashed-veld", () => {
  // Eén soort query is de uitzondering: de 23505-HERSTELQUERY. Die draait pas NA een botsing op de
  // UNIQUE index, en op dat punt is de gevonden rij per definitie levend — weggegooide sleutels zijn
  // vóór de insert al vrijgegeven. Die hoeft het veld niet.
  //
  // Deze test telde die uitzonderingen eerst gewoon ("hoogstens twee"). Dat was de verkeerde vorm: er
  // kwam er een derde bij en de test viel terwijl er niets mis was. Een drempel die je bij elke
  // legitieme toevoeging ophoogt bewaakt op den duur niets meer. Dus niet tellen maar kijken.
  const blind: string[] = [];
  let gates = 0;
  let recoveries = 0;
  for (const pad of POORTEN) {
    for (const q of hashQueries(bron(pad))) {
      if (q.isRecovery) { recoveries++; continue; }
      gates++;
      if (!/trashed/.test(q.query)) blind.push(`${pad}: ${q.query.split("\n")[0].trim()}`);
    }
  }

  assert.ok(gates >= 7, `slechts ${gates} poorten gevonden — leest deze test de bronnen nog wel?`);
  assert.ok(recoveries >= 1, "geen enkele 23505-herstelquery herkend — klopt de contextdetectie nog?");
  assert.deepEqual(
    blind,
    [],
    `${blind.length} POORT-zoekopdracht(en) vragen 'trashed' niet op — dan kan een weggegooid bestand ` +
      "weer als levend duplicaat geweigerd worden, en zit de eigenaar klem.",
  );
});
