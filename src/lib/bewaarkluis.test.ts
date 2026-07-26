// [KLUIS] Pure node test — run: npx tsx --test src/lib/bewaarkluis.test.ts
//
// Elke test hieronder komt overeen met een zin die wij publiek zeggen op /kluis of in de
// Algemene Voorwaarden §5.7. Gaat er één stuk, dan klopt onze verkooptekst niet meer.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BEWAARPLICHT_YEARS,
  KLUIS_DELETE_NOTICE_DAYS,
  KLUIS_GRACE_MONTHS,
  KLUIS_NOOIT,
  KLUIS_PREPAY_YEAR_PRICE_EUR,
  KLUIS_SHUTDOWN_NOTICE_DAYS,
  KLUIS_WEL,
  KLUIS_YEAR_PRICE_EUR,
  deleteNoticeAt,
  estimateArchiveMb,
  eur,
  formatArchiveSize,
  graceEndsAt,
  isWithinGrace,
  kluisQuote,
  remainingBewaarjaren,
} from "./bewaarkluis";
import { RETENTION_YEARS } from "./compliance-vault";

test("de bewaartermijn komt uit één bron", () => {
  assert.equal(BEWAARPLICHT_YEARS, RETENTION_YEARS);
  assert.equal(BEWAARPLICHT_YEARS, 7);
});

test("stukken uit 2026 moeten tot en met 2033 bewaard blijven", () => {
  assert.equal(remainingBewaarjaren(2026, 2026), 7);
  assert.equal(remainingBewaarjaren(2026, 2030), 3);
  assert.equal(remainingBewaarjaren(2026, 2033), 0);
});

test("een afgelopen bewaarplicht kost niets — nooit geld voor lucht", () => {
  assert.equal(remainingBewaarjaren(2010, 2026), 0);
  const q = kluisQuote(2010, 2026);
  assert.equal(q.years, 0);
  assert.equal(q.prepayTotalEur, 0);
  assert.equal(q.annualTotalEur, 0);
  assert.equal(q.prepaySavingEur, 0);
});

test("onzin in de invoer levert geen rekening op", () => {
  assert.equal(remainingBewaarjaren(NaN, 2026), 0);
  assert.equal(remainingBewaarjaren(2026, NaN), 0);
  assert.equal(kluisQuote(NaN, 2026).prepayTotalEur, 0);
});

test("de offerte voor een zaak die vandaag sluit klopt met de gepubliceerde prijs", () => {
  const q = kluisQuote(2026, 2026);
  assert.equal(q.years, 7);
  assert.equal(q.keepThroughYear, 2033);
  assert.equal(q.prepayTotalEur, 7 * KLUIS_PREPAY_YEAR_PRICE_EUR);
  assert.equal(q.annualTotalEur, 7 * KLUIS_YEAR_PRICE_EUR);
  assert.ok(q.prepaySavingEur > 0, "vooruit betalen moet voordeliger zijn, anders is de keuze een fopkeuze");
});

test("vooruit betalen is goedkoper per jaar, nooit duurder", () => {
  assert.ok(KLUIS_PREPAY_YEAR_PRICE_EUR < KLUIS_YEAR_PRICE_EUR);
  for (let years = 0; years <= 7; years++) {
    const q = kluisQuote(2026, 2026 + (7 - years));
    assert.equal(q.years, years);
    assert.ok(q.prepayTotalEur <= q.annualTotalEur);
  }
});

test("de gratis bewaartermijn na opzegging is een jaar, en de waarschuwing komt ervóór", () => {
  assert.equal(KLUIS_GRACE_MONTHS, 12);
  const closed = "2026-07-26T00:00:00.000Z";
  const end = graceEndsAt(closed);
  assert.equal(end.toISOString().slice(0, 10), "2027-07-26");

  // De waarschuwing valt binnen de termijn, niet erna.
  const notice = deleteNoticeAt(closed);
  assert.ok(notice.getTime() < end.getTime());
  assert.equal(
    Math.round((end.getTime() - notice.getTime()) / 86_400_000),
    KLUIS_DELETE_NOTICE_DAYS,
  );
  assert.equal(isWithinGrace(closed, notice), true, "op het moment van waarschuwen staat alles er nog");
});

test("binnen de gratis termijn verwijderen wij niets", () => {
  const closed = "2026-01-01T00:00:00.000Z";
  assert.equal(isWithinGrace(closed, "2026-12-31T00:00:00.000Z"), true);
  assert.equal(isWithinGrace(closed, "2027-01-02T00:00:00.000Z"), false);
});

test("wij kondigen een eigen stop ruim aan", () => {
  assert.ok(
    KLUIS_SHUTDOWN_NOTICE_DAYS >= 90,
    "een vooruitbetaalde belofte van zeven jaar vraagt minstens een kwartaal uitlooptijd",
  );
});

test("de belofte dat de bewaarplicht van de ondernemer blijft, staat er letterlijk", () => {
  const nooit = KLUIS_NOOIT.join(" ").toLowerCase();
  assert.ok(nooit.includes("bewaarplicht niet over"), "wij mogen nooit suggereren dat wij de bewaarplicht overnemen");
  assert.ok(nooit.includes("tweede exemplaar"));
  assert.ok(nooit.includes("exporteren blijft altijd werken"));
  // De kluis mag het gratis boekhoudersportaal nooit aantasten — dezelfde regel als in
  // fair-use.ts, hier herhaald omdat dit een betaald product is en de verleiding groter.
  assert.ok(/boekhoudersportaal/.test(nooit));
});

test("wat de kluis wél doet is concreet genoeg om na te rekenen", () => {
  assert.ok(KLUIS_WEL.length >= 4);
  for (const regel of KLUIS_WEL) assert.ok(regel.length > 20, `te vaag: ${regel}`);
  assert.ok(KLUIS_WEL.join(" ").toLowerCase().includes("export"));
});

test("de omvang van een archief wordt getoond, niet gefactureerd", () => {
  assert.equal(estimateArchiveMb(0), 0);
  assert.equal(estimateArchiveMb(-3), 0);
  assert.equal(estimateArchiveMb(NaN), 0);
  // Een winkel met 50 stukken per maand, zeven jaar lang.
  assert.equal(estimateArchiveMb(50 * 12 * 7), 2100);
  assert.equal(formatArchiveSize(2100), "2,1 GB");
  assert.equal(formatArchiveSize(840), "840 MB");
  assert.equal(formatArchiveSize(0), "0 MB");
});

test("bedragen staan er Nederlands op", () => {
  assert.equal(eur(19), "€ 19");
  assert.equal(eur(133), "€ 133");
  assert.equal(eur(12.99), "€ 12,99");
});
