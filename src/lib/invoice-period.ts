// src/lib/invoice-period.ts
// [PERIODE] Welke [start, eind] een periodekeuze betekent — puur, injecteerbaar, testbaar.
//
// De inkoopfacturenlijst toonde ALLE tijd. Dat is precies goed voor "wat moet ik betalen" en
// precies verkeerd voor elke andere vraag die iemand aan die lijst stelt: wat kocht ik in maart,
// wat staat er open uit dit kwartaal, hoeveel gaf ik dit jaar uit. Met het bedrag boven de lijst
// erbij ([OPEN-TOTAL]) is een periode geen filter meer maar de helft van het antwoord.
//
// Geen Date-rekenwerk op ISO-strings die daarna weer terug moeten: alles gebeurt op de kalender
// (jaar/maand als getallen) en komt eruit als 'YYYY-MM-DD'. Zo kan er geen tijdzone tussen komen —
// dezelfde reden waarom de rest van deze app zijn dagen van amsterdamToday() krijgt en niet van
// new Date() (format-nl.ts).
//
// `todayIso` wordt MEEGEGEVEN, nooit hier gelezen: dat houdt de module puur en maakt de randen
// (januari terug naar december, Q1 terug naar Q4 van vorig jaar) testbaar zonder de klok te zetten.

import type { MessageKey } from "./i18n/messages";
import { LOCALE_META, resolveLocale } from "./i18n/locale";

export type InvoicePeriod =
  | "all"
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "last-quarter"
  | "this-year"
  | "last-year";

export interface PeriodOption {
  id: InvoicePeriod;
  /**
   * [TAAL] Een SLEUTEL uit de catalogus, geen woord.
   *
   * Hier stonden de Nederlandse woorden zelf, en dit menu staat boven de inkoopfacturenlijst — een
   * volledig vertaald scherm. Een Arabische eigenaar las dus "كل الفترات" nergens en "Alle
   * periodes" wel, midden tussen zijn eigen taal. De sleutel ink.allePeriodes bestond zelfs al en
   * werd nooit bereikt: het menu vond altijd eerst dit woord.
   */
  label: MessageKey;
}

/** De keuzes zoals ze in het menu staan — "Alles" eerst, want dat is het gedrag van vandaag. */
export const INVOICE_PERIODS: readonly PeriodOption[] = [
  { id: "all", label: "ink.allePeriodes" },
  { id: "this-month", label: "ink.periode.dezeMaand" },
  { id: "last-month", label: "ink.periode.vorigeMaand" },
  { id: "this-quarter", label: "ink.periode.ditKwartaal" },
  { id: "last-quarter", label: "ink.periode.vorigKwartaal" },
  { id: "this-year", label: "ink.periode.ditJaar" },
  { id: "last-year", label: "ink.periode.vorigJaar" },
];

export interface PeriodWindow {
  /** ISO 'YYYY-MM-DD', inclusief. Null bij "alles" — dan is er geen ondergrens. */
  start: string | null;
  /** ISO 'YYYY-MM-DD', inclusief. Null bij "alles". */
  end: string | null;
  /** Wat er in de kop komt te staan: "maart 2026", "Q2 2026", "2025". Leeg bij "alles". */
  label: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
/**
 * De maandnaam in de taal van de EIGENAAR.
 *
 * [TAAL] Hier stond een vaste Nederlandse lijst, en die reisde mee tot in het label boven de
 * lijst: een Arabisch scherm dat "yuli 2026" zegt is niet fout gespeld maar onvertaald. Cijfers
 * blijven overal Latijns — zie de `intl`-tag in locale.ts, waar dat voor het Arabisch met
 * -u-nu-latn is vastgelegd: een bedrag en een jaartal moeten in elke taal hetzelfde lezen als op
 * het bankafschrift ernaast.
 *
 * Intl en geen tabel per taal: de maandnamen van vier talen met de hand onderhouden is precies het
 * soort lijst dat na één taal erbij half af blijft.
 */
function monthName(month: number, locale: unknown): string {
  const tag = LOCALE_META[resolveLocale(locale)].intl;
  // Dag 15: het midden van de maand, dus geen tijdzone kan hem over een grens duwen.
  return new Intl.DateTimeFormat(tag, { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(2000, month - 1, 15)));
}

/** De laatste dag van een maand, zonder Date: schrikkeljaren inbegrepen. */
function lastDay(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function monthWindow(year: number, month: number, locale: unknown): PeriodWindow {
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay(year, month))}`,
    label: `${monthName(month, locale)} ${year}`,
  };
}

function quarterWindow(year: number, quarter: number): PeriodWindow {
  const firstMonth = (quarter - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  return {
    start: `${year}-${pad(firstMonth)}-01`,
    end: `${year}-${pad(lastMonth)}-${pad(lastDay(year, lastMonth))}`,
    label: `Q${quarter} ${year}`,
  };
}

function yearWindow(year: number): PeriodWindow {
  return { start: `${year}-01-01`, end: `${year}-12-31`, label: `${year}` };
}

/**
 * Los een periodekeuze op tegen de dag van de eigenaar (Amsterdam, meegegeven).
 *
 * "Alles" geeft bewust null/null terug in plaats van een heel ruim venster: een lijst zonder
 * ondergrens is iets anders dan een lijst vanaf het jaar 2000, en alleen het eerste kan nooit per
 * ongeluk een oude factuur wegfilteren.
 */
export function resolveInvoicePeriod(
  period: InvoicePeriod,
  todayIso: string,
  /**
   * [TAAL] De taal waarin de maandnaam gelezen wordt. Optioneel en standaard Nederlands, zodat
   * elke bestaande aanroep — en elke test die "juli 2026" verwacht — onveranderd blijft: de
   * kwartaal- en jaarlabels ("Q3 2026", "2025") bevatten geen woord en veranderen sowieso nooit.
   */
  locale: unknown = "nl",
): PeriodWindow {
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;

  switch (period) {
    case "this-month":
      return monthWindow(year, month, locale);
    case "last-month":
      // Januari terug is december van vórig jaar — de rand waar dit soort code op stukgaat.
      return month === 1 ? monthWindow(year - 1, 12, locale) : monthWindow(year, month - 1, locale);
    case "this-quarter":
      return quarterWindow(year, quarter);
    case "last-quarter":
      return quarter === 1 ? quarterWindow(year - 1, 4) : quarterWindow(year, quarter - 1);
    case "this-year":
      return yearWindow(year);
    case "last-year":
      return yearWindow(year - 1);
    case "all":
    default:
      return { start: null, end: null, label: "" };
  }
}

/**
 * Valt deze factuurdatum in het venster?
 *
 * Een factuur ZONDER datum valt in geen enkele periode — en dat is een keuze met gevolgen, dus
 * zegt het scherm het hardop in plaats van de rij te laten verdwijnen (zie de melding onder de
 * periodekiezer). Hem overal laten meetellen zou hem in elke periode dubbel tonen; hem stilletjes
 * weglaten is precies het soort verdwijning waar de rest van deze app tegen beveiligd is.
 *
 * Puur stringvergelijk op 'YYYY-MM-DD': dat sorteert lexicografisch gelijk aan chronologisch, dus
 * er komt geen Date en dus geen tijdzone aan te pas.
 */
export function isInPeriod(invoiceDate: string | null | undefined, win: PeriodWindow): boolean {
  if (!win.start || !win.end) return true; // "alles": geen grens, dus alles hoort erbij
  if (!invoiceDate) return false;
  const day = invoiceDate.slice(0, 10);
  return day >= win.start && day <= win.end;
}
