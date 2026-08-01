// [NAMENS] Pure node test — run: npx tsx --test src/lib/verkoop-overzicht.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  standVan,
  openstaandBedrag,
  telOp,
  magHerinneren,
  volgendeHandmatigeOffset,
  MAX_HANDMATIGE_HERINNERINGEN,
  HERINNERING_RUSTDAGEN,
  type VerkoopFactuur,
} from "./verkoop-overzicht";

const NU = Date.parse("2026-08-15T12:00:00.000Z");
const dag = (n: number) => new Date(NU + n * 86_400_000).toISOString().slice(0, 10);

const f = (over: Partial<VerkoopFactuur> = {}): VerkoopFactuur => ({
  id: "x",
  invoice_number: "20260001",
  client_name: "Klant",
  client_email: "klant@voorbeeld.nl",
  invoice_date: dag(-30),
  due_date: dag(-1),
  total_inc_btw: 121,
  amount_paid: 0,
  status: "sent",
  ...over,
});

// ── de stand ──────────────────────────────────────────────────────────────────────────────────

test("een concept is geen openstaande factuur", () => {
  assert.equal(standVan(f({ status: "draft" }), NU), "concept");
});

test("de VERVALDATUM bepaalt of iets te laat is, niet de status", () => {
  // status 'overdue' wordt door een cron gezet en loopt dus achter. Een factuur die gisteren
  // verviel is vandaag te laat, ook al staat er nog 'sent' — anders ziet de verkoper hem pas
  // morgen, en dat is precies de dag die telt bij betalingen.
  assert.equal(standVan(f({ status: "sent", due_date: dag(-1) }), NU), "te-laat");
  assert.equal(standVan(f({ status: "sent", due_date: dag(+1) }), NU), "open");
  // En andersom: 'overdue' met een vervaldatum in de toekomst is gewoon open.
  assert.equal(standVan(f({ status: "overdue", due_date: dag(+5) }), NU), "open");
});

test("de vervaldag zelf is nog niet te laat", () => {
  // Iemand mag de hele dag van de vervaldatum betalen. Om 12:00 op die dag een herinnering
  // sturen is te vroeg en leest als wantrouwen.
  assert.equal(standVan(f({ due_date: dag(0) }), NU), "open");
});

test("betaald en vervallen zijn eigen standen", () => {
  assert.equal(standVan(f({ status: "paid" }), NU), "betaald");
  for (const s of ["archived", "cancelled", "credited"]) {
    assert.equal(standVan(f({ status: s }), NU), "vervallen", s);
  }
});

// ── het bedrag ────────────────────────────────────────────────────────────────────────────────

test("een deelbetaling telt mee, en het openstaande zakt nooit onder nul", () => {
  assert.equal(openstaandBedrag(f({ total_inc_btw: 121, amount_paid: 50 })), 71);
  assert.equal(openstaandBedrag(f({ total_inc_btw: 121, amount_paid: 121 })), 0);
  assert.equal(openstaandBedrag(f({ total_inc_btw: 121, amount_paid: 500 })), 0, "geen negatief bedrag");
  assert.equal(openstaandBedrag(f({ total_inc_btw: null, amount_paid: null })), 0);
});

test("een creditnota (negatief totaal) telt als bedrag, niet als min", () => {
  assert.equal(openstaandBedrag(f({ total_inc_btw: -121 })), 121);
});

// ── de optelsom ───────────────────────────────────────────────────────────────────────────────

test("het werkbord telt de juiste dingen bij elkaar", () => {
  const lijst = [
    f({ id: "1", status: "draft" }),
    f({ id: "2", due_date: dag(+7), total_inc_btw: 100 }),          // open
    f({ id: "3", due_date: dag(-10), total_inc_btw: 200 }),          // te laat
    f({ id: "4", due_date: dag(-3), total_inc_btw: 300, amount_paid: 100 }), // te laat, deels betaald
    f({ id: "5", status: "paid", total_inc_btw: 999 }),
    f({ id: "6", status: "archived", total_inc_btw: 5000 }),         // telt nergens mee
  ];
  const t = telOp(lijst, NU);
  assert.equal(t.concepten, 1);
  assert.equal(t.open, 1);
  assert.equal(t.teLaat, 2);
  assert.equal(t.betaald, 1);
  assert.equal(t.openstaand, 100 + 200 + 200, "open + te laat, met de deelbetaling eraf");
  assert.equal(t.teLaatBedrag, 400, "alleen het te late deel");
});

test("een genegeerde factuur van €5000 vervuilt het openstaande niet", () => {
  // Dit is waarom 'vervallen' een eigen stand is. Zonder die scheiding zou het werkbord een
  // bedrag tonen dat nooit gaat binnenkomen, en daar wordt naar gehandeld.
  const t = telOp([f({ status: "archived", total_inc_btw: 5000, due_date: dag(-40) })], NU);
  assert.equal(t.openstaand, 0);
  assert.equal(t.teLaat, 0);
});

// ── de herinnering ────────────────────────────────────────────────────────────────────────────

test("herinneren mag pas ná de vervaldatum", () => {
  const nogNiet = magHerinneren(f({ due_date: dag(+3) }), NU);
  assert.equal(nogNiet.mag, false);
  if (!nogNiet.mag) assert.match(nogNiet.reden, /vervaldatum/);
  assert.equal(magHerinneren(f({ due_date: dag(-1) }), NU).mag, true);
});

test("nooit herinneren aan geld dat al binnen is", () => {
  // De pijnlijkste mail die dit product kan versturen: een aanmaning voor een betaalde factuur.
  // Twee wegen erheen — de status staat op 'paid', of het bedrag is vol maar de status loopt achter.
  assert.equal(magHerinneren(f({ status: "paid" }), NU).mag, false);
  const volBetaald = magHerinneren(f({ status: "sent", amount_paid: 121 }), NU);
  assert.equal(volBetaald.mag, false);
  if (!volBetaald.mag) assert.match(volBetaald.reden, /niets meer open/);
});

test("zonder e-mailadres van de klant is er niets te versturen", () => {
  const uit = magHerinneren(f({ client_email: null }), NU);
  assert.equal(uit.mag, false);
  if (!uit.mag) assert.match(uit.reden, /e-mailadres/);
});

test("een concept herinneren kan niet", () => {
  assert.equal(magHerinneren(f({ status: "draft" }), NU).mag, false);
});

test("er zit rust tussen twee herinneringen — ook na een cron-mail", () => {
  const gisteren = new Date(NU - 86_400_000).toISOString();
  const uit = magHerinneren(f({ laatste_herinnering: gisteren }), NU);
  assert.equal(uit.mag, false);
  if (!uit.mag) assert.match(uit.reden, /Wacht nog/);

  const langGeleden = new Date(NU - (HERINNERING_RUSTDAGEN + 1) * 86_400_000).toISOString();
  assert.equal(magHerinneren(f({ laatste_herinnering: langGeleden }), NU).mag, true);
});

test("een onleesbare vorige datum zet de knop UIT, niet aan", () => {
  // Faalrichting: liever een dag te laat herinnerd dan een klant twee keer op één dag.
  const uit = magHerinneren(f({ laatste_herinnering: "geen datum" }), NU);
  assert.equal(uit.mag, false);
});

test("er is een bovengrens — daarna is het geen herinneren meer", () => {
  const uit = magHerinneren(f({ herinneringen: MAX_HANDMATIGE_HERINNERINGEN }), NU);
  assert.equal(uit.mag, false);
  if (!uit.mag) assert.match(uit.reden, /werkgever/, "en de verkoper hoort te weten bij wie hij moet zijn");
  assert.equal(magHerinneren(f({ herinneringen: MAX_HANDMATIGE_HERINNERINGEN - 1 }), NU).mag, true);
});

test("elke weigering zegt WAAROM, in een zin die een mens leest", () => {
  const gevallen = [
    f({ status: "draft" }),
    f({ status: "paid" }),
    f({ client_email: null }),
    f({ due_date: dag(+5) }),
    f({ herinneringen: 9 }),
  ];
  for (const g of gevallen) {
    const uit = magHerinneren(g, NU);
    assert.equal(uit.mag, false);
    if (!uit.mag) {
      assert.ok(uit.reden.length > 15, "geen kale 'niet toegestaan'");
      assert.ok(/[.!]$/.test(uit.reden), "een hele zin");
    }
  }
});

// ── het spoor ─────────────────────────────────────────────────────────────────────────────────

test("handmatige herinneringen krijgen NEGATIEVE offsets, zodat ze nooit een cron-tier blokkeren", () => {
  // invoice_reminders heeft UNIQUE(invoice_id, day_offset) en de cron gebruikt 14 en 30. Zou een
  // handmatige verzending een positief nummer pakken, dan kon hij een cron-tier bezet houden —
  // en dan blijft de automatische herinnering stilletjes uit.
  assert.equal(volgendeHandmatigeOffset([]), -1);
  assert.equal(volgendeHandmatigeOffset([14]), -1, "een cron-tier telt niet mee");
  assert.equal(volgendeHandmatigeOffset([-1]), -2);
  assert.equal(volgendeHandmatigeOffset([14, 30, -1, -2]), -3);
  assert.ok(volgendeHandmatigeOffset([14, 30]) < 0);
});
