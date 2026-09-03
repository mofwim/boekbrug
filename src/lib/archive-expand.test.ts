// src/lib/archive-expand.test.ts
// [ARCHIEF-OPEN] Uitpakken met echte zips, niet met een nagebootste bibliotheek.
// Run: npx tsx --test src/lib/archive-expand.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { expandArchives } from "./archive-expand";

async function zipMet(files: Record<string, string>): Promise<string> {
  const z = new JSZip();
  for (const [naam, inhoud] of Object.entries(files)) z.file(naam, inhoud);
  return (await z.generateAsync({ type: "nodebuffer" })).toString("base64");
}

const bijlage = (filename: string, data: string) => ({
  filename, mimeType: "application/zip", data, messageId: "m1", size: 0,
});

test("[ARCHIEF-OPEN] de dagafsluiting komt eruit als een leesbaar document", async () => {
  // De echte naam van productie, 29 keer, 28 dagen achter elkaar.
  const data = await zipMet({ "dagafsluiting.pdf": "%PDF-1.4 nep" });
  const r = await expandArchives([bijlage("Jouw dagafsluiting - 220826 1912.zip", data)]);

  assert.equal(r.attachments.length, 1);
  assert.match(r.attachments[0].filename, /dagafsluiting\.pdf$/);
  assert.equal(r.attachments[0].mimeType, "application/pdf", "een PDF moet als PDF verder, niet als zip");
  assert.equal(Buffer.from(r.attachments[0].data, "base64").toString(), "%PDF-1.4 nep");
  // De naam draagt de envelop mee, anders zijn tien dagafsluitingen niet uit elkaar te houden.
  assert.match(r.attachments[0].filename, /Jouw dagafsluiting - 220826 1912/);
});

test("[ARCHIEF-OPEN] een gewone bijlage blijft precies zoals hij was", async () => {
  const pdf = { filename: "factuur.pdf", mimeType: "application/pdf", data: "eA==", messageId: "m", size: 1 };
  const r = await expandArchives([pdf]);
  assert.deepEqual(r.attachments, [pdf]);
  assert.deepEqual(r.skipped, []);
});

test("[ARCHIEF-OPEN] rommel in het archief wordt geteld, niet verzwegen", async () => {
  const data = await zipMet({
    "dagafsluiting.pdf": "%PDF nep",
    "__MACOSX/._dagafsluiting.pdf": "x",
    "readme.exe": "x",
  });
  const r = await expandArchives([bijlage("dag.zip", data)]);
  assert.equal(r.attachments.length, 1, "alleen de PDF gaat door");
  assert.equal(r.skipped.length, 2, "en de rest is geteld");
  for (const s of r.skipped) {
    assert.match(s.filename, /dag\.zip →/, "de melding zegt uit welk archief het kwam");
    assert.ok(s.reason.length > 5, "en waarom het niet doorging");
  }
});

test("[ARCHIEF-OPEN] een kapot archief verdwijnt niet, het meldt zich", async () => {
  // DE regel. Deze 410 overgeslagen bijlagen bestonden doordat "overslaan" geen zin opleverde.
  const r = await expandArchives([bijlage("stuk.zip", Buffer.from("dit is geen zip").toString("base64"))]);
  assert.equal(r.attachments.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /beschadigd|wachtwoord/);
});

test("[ARCHIEF-OPEN] een archief in een archief blijft dicht", async () => {
  const binnen = await zipMet({ "factuur.pdf": "%PDF" });
  const buiten = await zipMet({ "binnenin.zip": binnen, "echt.pdf": "%PDF" });
  const r = await expandArchives([bijlage("buiten.zip", buiten)]);
  assert.equal(r.attachments.length, 1, "alleen het losse document");
  assert.match(r.attachments[0].filename, /echt\.pdf$/);
  assert.ok(r.skipped.some((s) => /archief in een archief/.test(s.reason)));
});

test("[ARCHIEF-OPEN] te veel bestanden → niets erdoor, en dat is expres", async () => {
  // Half uitpakken levert een administratie op waarvan niemand weet welk deel erin zit.
  const veel: Record<string, string> = {};
  for (let i = 0; i < 30; i++) veel[`f${i}.pdf`] = "%PDF";
  const r = await expandArchives([bijlage("veel.zip", await zipMet(veel))]);
  assert.equal(r.attachments.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /te veel/);
});

test("[ARCHIEF-OPEN] meerdere bijlagen tegelijk houden hun volgorde en identiteit", async () => {
  const data = await zipMet({ "bon.jpg": "JPEGnep" });
  const r = await expandArchives([
    { filename: "eerste.pdf", mimeType: "application/pdf", data: "eA==", messageId: "m", size: 1 },
    bijlage("dag.zip", data),
    { filename: "laatste.pdf", mimeType: "application/pdf", data: "eQ==", messageId: "m", size: 1 },
  ]);
  assert.equal(r.attachments.length, 3);
  assert.equal(r.attachments[0].filename, "eerste.pdf");
  assert.match(r.attachments[1].filename, /bon\.jpg$/);
  assert.equal(r.attachments[1].mimeType, "image/jpeg");
  assert.equal(r.attachments[2].filename, "laatste.pdf");
});

test("[ARCHIEF-OPEN] een uitgepakt archief geeft zijn eigen sleutel terug — anders bevriest de sync", async () => {
  // DE bug die deze test bestaat om te vangen, en die geen enkele bestaande poort zag.
  //
  // De watermerkcontrole in email-integration.ts loopt over de OORSPRONKELIJK opgehaalde bijlagen
  // en eist dat elke `messageId:filename` is afgehandeld. Vervangen wij een zip door zijn inhoud,
  // dan komt de sleutel van het ARCHIEF daar nooit meer langs: het bericht leest eeuwig als
  // onvoltooid, het watermerk schuift nooit op, en de sync loopt rond en hongert elke mailbox
  // erna uit. Niet "een bijlage te veel" — de hele e-mailkant staat stil.
  const data = await zipMet({ "dagafsluiting.pdf": "%PDF" });
  const r = await expandArchives([
    { filename: "dag.zip", mimeType: "application/zip", data, messageId: "msg-1", size: 0 },
  ]);
  assert.deepEqual(r.consumedKeys, ["msg-1:dag.zip"]);
});

test("[ARCHIEF-OPEN] óók een kapot archief telt als afgehandeld", async () => {
  // Anders bevriest het watermerk juist op het bestand dat niet open ging — het slechtste geval:
  // één beschadigde zip legt de mailbox voorgoed stil.
  const r = await expandArchives([
    { filename: "stuk.zip", mimeType: "application/zip", data: Buffer.from("geen zip").toString("base64"), messageId: "msg-2", size: 0 },
  ]);
  assert.equal(r.attachments.length, 0);
  assert.deepEqual(r.consumedKeys, ["msg-2:stuk.zip"], "een onleesbaar archief blijft anders eeuwig openstaan");
});

test("[ARCHIEF-OPEN] een gewone bijlage levert géén sleutel op", async () => {
  // Die is niet vervangen; hem hier afvinken zou de watermerkcontrole laten liegen over een
  // bestand dat de gewone weg nog moet gaan.
  const r = await expandArchives([
    { filename: "factuur.pdf", mimeType: "application/pdf", data: "eA==", messageId: "msg-3", size: 1 },
  ]);
  assert.deepEqual(r.consumedKeys, []);
});
