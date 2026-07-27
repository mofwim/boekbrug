// [BRUG-RETOUR] Pure node test — run: npx tsx --test src/lib/vragen.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildOpenVragen,
  vraagTekst,
  vraagAntwoordPrefix,
  bouwAntwoordBericht,
  vragenBannerTekst,
  VRAAG_STATUS,
} from "./vragen";

const doc = (id: string, name: string | null, trashed = false) => ({
  id,
  file_name: name,
  trashed,
});
const status = (
  subject_id: string,
  s: string,
  vraag_text: string | null = null,
  updated_at: string | null = "2026-07-01T10:00:00.000Z",
) => ({ subject_id, status: s, vraag_text, updated_at });

test("alleen status 'vraag' is een vraag aan de klant", () => {
  const rows = [
    status("a", "te_verwerken"),
    status("b", "in_behandeling"),
    status("c", "verwerkt"),
    status("d", VRAAG_STATUS, "Mist de bon van 3 juni?"),
  ];
  const open = buildOpenVragen(rows, [doc("a", "a.pdf"), doc("b", "b.pdf"), doc("c", "c.pdf"), doc("d", "d.pdf")]);
  assert.equal(open.length, 1);
  assert.equal(open[0].documentId, "d");
  assert.equal(open[0].question, "Mist de bon van 3 juni?");
});

test("een vraag zonder toelichting wordt niet verzonnen", () => {
  // De boekhouder MAG de status op 'vraag' zetten zonder tekst. Dan is het antwoord
  // "hij liet geen toelichting achter" — nooit een vraag die niemand stelde.
  const open = buildOpenVragen([status("a", VRAAG_STATUS, "   ")], [doc("a", "bon.jpg")]);
  assert.equal(open.length, 1);
  assert.equal(open[0].question, null);

  assert.equal(vraagTekst(null), null);
  assert.equal(vraagTekst(undefined), null);
  assert.equal(vraagTekst(""), null);
  assert.equal(vraagTekst("  \n "), null);
  assert.equal(vraagTekst("  Welke bon?  "), "Welke bon?");
});

test("een vraag over een onvindbaar document verdwijnt niet stil", () => {
  // Verbergen is óók een bewering: dan denkt de klant dat er niets openstaat terwijl de
  // boekhouder wacht. De rij blijft, gemarkeerd, zodat het scherm het eerlijk kan zeggen.
  const open = buildOpenVragen([status("weg", VRAAG_STATUS, "Waar is deze?")], []);
  assert.equal(open.length, 1);
  assert.equal(open[0].documentMissing, true);
  assert.equal(open[0].documentName, null);
});

test("een document in de prullenbak is gemarkeerd, niet weggelaten", () => {
  const open = buildOpenVragen([status("a", VRAAG_STATUS, "?")], [doc("a", "bon.jpg", true)]);
  assert.equal(open[0].documentTrashed, true);
  assert.equal(open[0].documentMissing, false);
  assert.equal(open[0].documentName, "bon.jpg");
});

test("oudste vraag eerst; een ontbrekende datum sluit achteraan aan", () => {
  const open = buildOpenVragen(
    [
      status("nieuw", VRAAG_STATUS, "?", "2026-07-20T10:00:00.000Z"),
      status("zonder", VRAAG_STATUS, "?", null),
      status("oud", VRAAG_STATUS, "?", "2026-05-01T10:00:00.000Z"),
    ],
    [doc("nieuw", "n.pdf"), doc("zonder", "z.pdf"), doc("oud", "o.pdf")],
  );
  assert.deepEqual(open.map((v) => v.documentId), ["oud", "nieuw", "zonder"]);
});

test("het antwoord noemt het document waar het over gaat", () => {
  // De boekhouder leest het antwoord in zijn berichtenscherm, los van het document.
  // Zonder deze kopregel is "ja die heb ik" onbruikbaar.
  assert.equal(vraagAntwoordPrefix("bon-juni.pdf"), 'Over je vraag bij "bon-juni.pdf":');
  assert.equal(vraagAntwoordPrefix(null), "Over je vraag:");
  assert.equal(vraagAntwoordPrefix("   "), "Over je vraag:");

  const lang = "x".repeat(200);
  const prefix = vraagAntwoordPrefix(lang);
  assert.ok(prefix.length < 100, "een absurde bestandsnaam mag het bericht niet opeten");
  assert.ok(prefix.includes("…"));
});

test("een leeg antwoord wordt nooit verstuurd", () => {
  // Anders krijgt de boekhouder een bericht dat alleen uit onze eigen kopregel bestaat.
  assert.equal(bouwAntwoordBericht("bon.pdf", "   "), null);
  assert.equal(bouwAntwoordBericht("bon.pdf", ""), null);
  assert.equal(
    bouwAntwoordBericht("bon.pdf", "  Die zit in de doos van juni.  "),
    'Over je vraag bij "bon.pdf":\nDie zit in de doos van juni.',
  );
});

test("de banner telt in gewoon Nederlands en zwijgt bij nul", () => {
  assert.equal(vragenBannerTekst(0), null);
  assert.equal(vragenBannerTekst(-1), null);
  assert.equal(vragenBannerTekst(1), "Je boekhouder heeft een vraag");
  assert.equal(vragenBannerTekst(3), "Je boekhouder heeft 3 vragen");
});

test("de klant kan een vraag niet zelf afvinken — die weg bestaat hier niet", () => {
  // Vangnet tegen een latere 'handige' toevoeging: een status is een bewering van de
  // boekhouder. Zodra hier een functie verschijnt die een status zet, faalt deze test en
  // moet die keuze bewust worden gemaakt, niet per ongeluk.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./vragen") as Record<string, unknown>;
  for (const naam of Object.keys(mod)) {
    assert.ok(
      !/^(set|mark|update|resolve|close|beantwoord)/i.test(naam),
      `vragen.ts exporteert ${naam} — de klant mag de status van de boekhouder niet schrijven`,
    );
  }
});
