// src/lib/bewaarkluis.ts
// [KLUIS] De Bewaarkluis — het enige product dat blijft lopen nadat de klant weg is.
//
// Waarom dit bestaat, in één alinea:
// De fiscale bewaarplicht (art. 52 AWR) stopt niet als een onderneming stopt. Wie in 2026
// zijn zaak sluit, moet zijn administratie tot en met 2033 kunnen tonen. Dat is de enige
// verplichting van een ondernemer die de relatie met zijn software OVERLEEFT. Alles wat wij
// verder bouwen concurreert met SnelStart, Moneybird en Excel; hierin concurreren wij met
// een schoenendoos op zolder en een externe harde schijf die niemand meer kan lezen.
//
// Wat wij verkopen — en wat nadrukkelijk NIET:
//   ✔ Bewaren, doorzoekbaar houden en op elk moment kunnen exporteren van een afgesloten
//     administratie, voor de resterende bewaarjaren.
//   ✘ NIET het overnemen van je bewaarplicht. Die is en blijft van jou. Wij zijn je tweede
//     exemplaar, nooit je enige. Die zin staat hier in code omdat de verkooppagina hem
//     nooit mag laten vallen — zie KLUIS_NOOIT en de bijbehorende test.
//
// De prijsopbouw is bewust saai: één bedrag per bewaarjaar, vooruit betaald. Vooruit
// betalen is geen verkooptruc maar de enige constructie waarin wij nooit opslag beloven
// die niet betaald is — en dus de enige waarin een belofte van zeven jaar geloofwaardig is.

import { RETENTION_YEARS, keepThroughYear } from "./compliance-vault";

/** De bewaarplicht zelf. Eén bron: hetzelfde getal als de compliance-kluis gebruikt. */
export const BEWAARPLICHT_YEARS = RETENTION_YEARS;

/** Prijs per bewaarjaar bij jaarlijkse betaling, in euro incl. btw. */
export const KLUIS_YEAR_PRICE_EUR = 24;

/**
 * Prijs per bewaarjaar wanneer alle resterende jaren in één keer vooruit worden voldaan.
 * Lager omdat het ons ook echt minder kost: geen incasso's, geen mislukte betalingen,
 * geen herinneringen, en de opslag is voor de volle termijn gedekt.
 */
export const KLUIS_PREPAY_YEAR_PRICE_EUR = 19;

/** Hoeveel opslag in de kluisprijs zit. Daarboven bellen wij — nooit een naheffing. */
export const KLUIS_INCLUDED_GB = 25;

/**
 * Hoe lang wij een afgesloten administratie sowieso gratis bewaren, ook zonder kluis.
 * Twaalf maanden is ruim: het dekt een volledige aangiftecyclus plus de periode waarin
 * iemand pas ontdekt dat hij iets nodig heeft.
 */
export const KLUIS_GRACE_MONTHS = 12;

/** Aankondiging vóór wij ooit iets verwijderen. Nooit korter, nooit stilzwijgend. */
export const KLUIS_DELETE_NOTICE_DAYS = 30;

/**
 * Aankondiging als BoekBrug zelf zou stoppen. Een vooruitbetaalde belofte van zeven jaar
 * is alleen eerlijk met een uitgang die vooraf vaststaat: drie maanden van tevoren, en
 * iedereen krijgt automatisch zijn volledige archief toegestuurd.
 */
export const KLUIS_SHUTDOWN_NOTICE_DAYS = 90;

/**
 * Planningsgetal voor de omvang van een archief: een genormaliseerde scan komt op
 * ongeveer een halve MB uit (lange zijde 2500 px, zie image-normalize-client).
 * Gebruikt om de klant vooraf te tonen wat zijn archief wéégt — nooit om te factureren.
 */
export const AVG_DOCUMENT_MB = 0.5;

// ─── Wat wij nooit doen ───────────────────────────────────────────────────────
// Spiegelt ALWAYS_FREE in fair-use.ts. Staat in code zodat een latere wijziging bewust
// moet gebeuren en de verkooptekst er niet stilletjes overheen kan groeien.

export const KLUIS_NOOIT: readonly string[] = [
  "Wij nemen je bewaarplicht niet over — die blijft wettelijk van jou als ondernemer",
  "Wij zijn je tweede exemplaar, nooit je enige: download je eigen kopie ook",
  "Wij verwijderen nooit iets zonder minstens 30 dagen aankondiging per e-mail",
  "Wij schrijven nooit automatisch af en verlengen nooit stilzwijgend",
  "Exporteren blijft altijd werken, ook als je niets (meer) betaalt",
  "De kluis is nooit een voorwaarde voor het gratis boekhoudersportaal",
];

/** Wat de kluis wél doet — de verkooptekst leest hier uit, niet andersom. */
export const KLUIS_WEL: readonly string[] = [
  "Je volledige administratie blijft online staan, per jaar en per kwartaal geordend",
  "Doorzoekbaar op bedrag, leverancier, datum en documentsoort",
  "Eén knop per jaar exporteren: een ZIP met alle stukken plus een index voor de Belastingdienst",
  "Je boekhouder kan er ook bij, zolang je hem gekoppeld laat",
  "Opslag binnen de EU, versleuteld in transport en in rust",
  "Een jaarlijkse controle of alle bestanden nog leesbaar zijn — je hoort het als er iets mis is",
];

// ─── Rekenwerk ────────────────────────────────────────────────────────────────

/**
 * Hoeveel bewaarjaren er nog te gaan zijn voor een archief waarvan het jongste boekjaar
 * `lastFiscalYear` is. Stukken uit jaar Y moeten bewaard blijven tot en met Y + 7; daarna
 * mag alles weg. Nooit negatief: een archief dat al buiten de termijn valt kost 0 jaar.
 */
export function remainingBewaarjaren(lastFiscalYear: number, currentYear: number): number {
  if (!Number.isFinite(lastFiscalYear) || !Number.isFinite(currentYear)) return 0;
  return Math.max(0, keepThroughYear(Math.trunc(lastFiscalYear)) - Math.trunc(currentYear));
}

export interface KluisQuote {
  /** Resterende bewaarjaren — waar de prijs op gebaseerd is. */
  years: number;
  /** Het jaar tot en met wanneer bewaard moet worden. */
  keepThroughYear: number;
  /** Prijs per jaar bij jaarlijks betalen. */
  perYearEur: number;
  /** Alles in één keer vooruit: het lagere jaartarief × resterende jaren. */
  prepayTotalEur: number;
  /** Wat dezelfde periode jaarlijks betalen zou kosten — voor een eerlijke vergelijking. */
  annualTotalEur: number;
  /** Verschil tussen beide routes; 0 als er niets te bewaren valt. */
  prepaySavingEur: number;
}

/**
 * De offerte voor één archief. Puur rekenwerk, geen I/O — de pagina toont exact dit.
 * Bij nul resterende jaren is alles nul: wij vragen nooit geld voor een bewaarplicht die
 * al is afgelopen.
 */
export function kluisQuote(lastFiscalYear: number, currentYear: number): KluisQuote {
  const years = remainingBewaarjaren(lastFiscalYear, currentYear);
  const prepayTotalEur = years * KLUIS_PREPAY_YEAR_PRICE_EUR;
  const annualTotalEur = years * KLUIS_YEAR_PRICE_EUR;
  return {
    years,
    keepThroughYear: keepThroughYear(Math.trunc(lastFiscalYear)),
    perYearEur: KLUIS_YEAR_PRICE_EUR,
    prepayTotalEur,
    annualTotalEur,
    prepaySavingEur: annualTotalEur - prepayTotalEur,
  };
}

/** Wat een archief van `documentCount` stukken bij benadering weegt, in MB. */
export function estimateArchiveMb(documentCount: number): number {
  if (!Number.isFinite(documentCount) || documentCount <= 0) return 0;
  return Math.round(documentCount * AVG_DOCUMENT_MB);
}

/** Leesbaar: "840 MB" of "2,1 GB". */
export function formatArchiveSize(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return "0 MB";
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1).replace(".", ",")} GB`;
}

// ─── De gratis bewaartermijn na opzegging ─────────────────────────────────────

/** Wanneer de gratis bewaartermijn na afsluiten van het account afloopt. */
export function graceEndsAt(closedAt: string | number | Date): Date {
  const d = closedAt instanceof Date ? new Date(closedAt.getTime()) : new Date(closedAt);
  d.setUTCMonth(d.getUTCMonth() + KLUIS_GRACE_MONTHS);
  return d;
}

/** Zit dit afgesloten account nog binnen de gratis bewaartermijn? */
export function isWithinGrace(
  closedAt: string | number | Date,
  now: string | number | Date = new Date(),
): boolean {
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  return nowMs < graceEndsAt(closedAt).getTime();
}

/**
 * Wanneer de waarschuwing "hierna verwijderen wij" verstuurd moet worden: 30 dagen vóór
 * het einde van de gratis bewaartermijn. Vóór, niet erna — dezelfde regel als bij het
 * eerlijk gebruik.
 */
export function deleteNoticeAt(closedAt: string | number | Date): Date {
  const end = graceEndsAt(closedAt);
  end.setUTCDate(end.getUTCDate() - KLUIS_DELETE_NOTICE_DAYS);
  return end;
}

/** Euro's zoals Nederland ze schrijft: "€ 133" of "€ 12,99". */
export function eur(amount: number): string {
  const whole = Number.isInteger(amount);
  return `€ ${amount.toFixed(whole ? 0 : 2).replace(".", ",")}`;
}
