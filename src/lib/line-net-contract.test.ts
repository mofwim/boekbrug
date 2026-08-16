// [REGEL-KORTING] Run: npx tsx --test src/lib/line-net-contract.test.ts
//
// ── DE AFSPRAAK DIE DRIE KEER HET VERSCHIL MAAKTE ──
//
// `invoice_lines.line_total` is NETTO: aantal × prijs, min de korting die op die regel zelf zit.
// Dat staat in invoice_line_discount.sql en het is met opzet die kant op gekozen — een lezer die
// van kortingskolommen nooit heeft gehoord telt line_total op en komt op het JUISTE bedrag uit.
// Andersom zou elke vergeten lezer de klant te veel in rekening brengen.
//
// Die keuze is geen nettigheid gebleken. Drie onafhankelijke afnemers zijn er bij nacontrole
// alleen door goed gegaan, geen van drieën omdat iemand aan regelkorting had gedacht:
//
//   · de uitgifteroute, die bij het versturen de totalen herberekent (computeInvoiceTotals);
//   · de e-factuur, die per regel een bedrag en een aftrek moet kunnen reproduceren (UBL);
//   · de SnelStart-push, die per factuurregel één boekingsregel in het inkoopboek zet.
//
// Alle drie lezen `line_total` en rekenen NIET zelf aantal × prijs uit. Zou één van hen dat wél
// gaan doen — een volstrekt normale "opschoning" — dan verdwijnt de korting stilletjes bij precies
// die ene afnemer, en spreken twee oppervlakken elkaar tegen over hetzelfde geld. Bij de
// SnelStart-push zou de boekhouder het BRUTO-bedrag in de administratie krijgen.
//
// Een broncodepoort zou hier te bros zijn: `aantal × prijs` staat op legitieme plekken in deze
// codebase (de UBL berekent bewust een brutoregel om de aftrek uit af te leiden). Dus wordt de
// afspraak gemeten aan de UITKOMST: dezelfde regel, door de drie afnemers, moet hetzelfde
// nettobedrag opleveren.

import { test } from "node:test";
import assert from "node:assert/strict";

import { lineNetEx } from "./invoice-discount";
import { computeInvoiceTotals } from "./invoice-totals";
import { buildBoekingLines } from "./snelstart-mapping";
import { buildInvoiceUbl } from "./ubl-export";

const SUPPLIER = {
  company_name: "Kiwi Food Market",
  address: "Verdiplein 13-14",
  postal_code: "5049NM",
  city: "Tilburg",
  kvk_number: "94386676",
  btw_number: "NL005079680B23",
  iban: "NL73INGB0107197480",
};

/** Tien stuks à € 50 met € 25 van de regel af → € 475 netto, niet € 500. */
const REGEL = {
  id: "a",
  description: "Advies",
  quantity: 10,
  unit_price: 50,
  btw_rate: 21,
  unit: null,
  discount_type: "amount" as const,
  discount_value: 25,
};

const NETTO = 475;
const BRUTO = 500;

test("[REGEL-NETTO] the stored line total is net, and that is what the writers write", () => {
  // Als dit getal ooit bruto wordt, is de rest van dit bestand zinloos — dan klopt de afspraak
  // zelf niet meer en zijn alle drie de afnemers ineens fout op dezelfde manier.
  assert.equal(lineNetEx(REGEL as never), NETTO);
  assert.notEqual(lineNetEx(REGEL as never), BRUTO);
});

test("[REGEL-NETTO] the issuing route's totals engine bills the net amount", () => {
  // computeInvoiceTotals draait bij het VERSTUREN over de opgeslagen regels heen. Zou hij hier
  // aantal × prijs pakken, dan draagt de genummerde, onherroepelijke factuur de volle prijs
  // terwijl het concept de korting toonde.
  const totals = computeInvoiceTotals([{ line_total: lineNetEx(REGEL as never), btw_rate: 21 }] as never);
  assert.equal(totals.total_ex_btw, NETTO);
  assert.equal(totals.btw_amount, 99.75, "btw over het VERLAAGDE bedrag, niet over de volle prijs");
});

test("[REGEL-NETTO] the e-factuur reproduces the net amount from price minus allowance", () => {
  // De UBL berekent hier wél een brutoregel — maar alleen om er de aftrek uit af te leiden. Wat er
  // in LineExtensionAmount belandt moet het netto bedrag zijn, en (aantal × prijs − aftrek) moet
  // dat getal teruggeven: dat is wat het ontvangende access point narekent (PEPPOL-EN16931-R120).
  const regel = { ...REGEL, line_total: lineNetEx(REGEL as never) };
  const { xml } = buildInvoiceUbl(
    {
      invoice_number: "2026-001", invoice_date: "2026-08-15", due_date: "2026-09-14",
      invoice_type: "factuur", total_ex_btw: NETTO, btw_amount: 99.75, total_inc_btw: 574.75,
      client_name: "Klant", client_address: "Straat 1", client_postal_code: "1234AB",
      client_city: "Tilburg", client_btw_number: null,
    } as never,
    [regel] as never,
    SUPPLIER as never,
  );
  const blok = xml.match(/<cac:InvoiceLine>([\s\S]*?)<\/cac:InvoiceLine>/)?.[1] ?? "";
  const bedrag = Number(blok.match(/<cbc:LineExtensionAmount[^>]*>([-\d.]+)</)?.[1]);
  const aftrek = Number(blok.match(/<cac:AllowanceCharge>[\s\S]*?<cbc:Amount[^>]*>([-\d.]+)</)?.[1] ?? 0);
  assert.equal(bedrag, NETTO, "the line amount the customer's system books");
  assert.equal(aftrek, BRUTO - NETTO, "…and the discount stated as an allowance, not hidden in the price");
});

test("[REGEL-NETTO] the SnelStart booking line carries the net amount, never the gross", () => {
  // Dit is de afnemer met de stilste fout: de boekhouder ziet één boekingsregel per factuurregel,
  // en een bruto bedrag daar is een kostenpost die € 25 te hoog in de administratie staat zonder
  // dat er ergens iets rood wordt.
  const { boekingsregels } = buildBoekingLines({
    invoice: { invoice_type: "factuur", total_ex_btw: NETTO, btw_amount: 99.75 } as never,
    lines: [{ ...REGEL, line_total: lineNetEx(REGEL as never) }] as never,
    tarieven: [{ btwSoort: "Hoog", percentage: 21 }] as never,
    grootboekId: "gb-1",
  });
  assert.equal(boekingsregels.length, 1);
  assert.equal(boekingsregels[0].bedrag, NETTO);
  assert.notEqual(boekingsregels[0].bedrag, BRUTO);
});

test("[REGEL-NETTO] all three consumers agree to the cent on the same line", () => {
  // De eigenlijke bewering. Elk afzonderlijk goed is niet genoeg: twee oppervlakken die over
  // hetzelfde geld iets anders zeggen is precies de fout die vandaag twee keer is gevonden (de
  // herinneringsmail tegenover het scherm, en de deelcreditering tegenover de regelkorting).
  const regel = { ...REGEL, line_total: lineNetEx(REGEL as never) };

  const viaTotals = computeInvoiceTotals([regel] as never).total_ex_btw;
  const viaSnelStart = buildBoekingLines({
    invoice: { invoice_type: "factuur", total_ex_btw: NETTO, btw_amount: 99.75 } as never,
    lines: [regel] as never,
    tarieven: [{ btwSoort: "Hoog", percentage: 21 }] as never,
    grootboekId: "gb-1",
  }).boekingsregels[0].bedrag;

  assert.equal(viaTotals, viaSnelStart, "the invoice total and the bookkeeping line must be one number");
  assert.equal(viaTotals, NETTO);
});
