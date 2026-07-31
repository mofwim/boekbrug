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
  label: string;
}

/** De keuzes zoals ze in het menu staan — "Alles" eerst, want dat is het gedrag van vandaag. */
export const INVOICE_PERIODS: readonly PeriodOption[] = [
  { id: "all", label: "Alle periodes" },
  { id: "this-month", label: "Deze maand" },
  { id: "last-month", label: "Vorige maand" },
  { id: "this-quarter", label: "Dit kwartaal" },
  { id: "last-quarter", label: "Vorig kwartaal" },
  { id: "this-year", label: "Dit jaar" },
  { id: "last-year", label: "Vorig jaar" },
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
const MONTHS = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

/** De laatste dag van een maand, zonder Date: schrikkeljaren inbegrepen. */
function lastDay(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function monthWindow(year: number, month: number): PeriodWindow {
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay(year, month))}`,
    label: `${MONTHS[month - 1]} ${year}`,
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
export function resolveInvoicePeriod(period: InvoicePeriod, todayIso: string): PeriodWindow {
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;

  switch (period) {
    case "this-month":
      return monthWindow(year, month);
    case "last-month":
      // Januari terug is december van vórig jaar — de rand waar dit soort code op stukgaat.
      return month === 1 ? monthWindow(year - 1, 12) : monthWindow(year, month - 1);
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
