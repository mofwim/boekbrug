// src/lib/client-country.ts
// [KLANT-LAND] The customer's country, and the one legal question it decides at the send door.
// Pure, no I/O. Run: npx tsx --test src/lib/client-country.test.ts
//
// This schema held no country for a customer anywhere (client_country.sql). Everything that had to
// know where a customer sits read it off the btw-nummer's prefix — which is right for an EU
// business that gave one, and blind for everyone else. The money audit's first sales finding
// followed from that: a EUR 10.000 sale to a German business could leave at 0% with no customer
// btw-id, no "btw verlegd" sentence and nothing refusing it. Art. 138 BTW-richtlijn (art. 9 lid 2
// sub b jo. tabel II Wet OB) grants the 0% only with the buyer's VAT identification number; without
// it the seller owes the 21%, assessed later with interest.
//
// With a country recorded the door can ask the one question that matters: is this a 0% factuur to
// a BUSINESS in another member state without its btw-id? Yes → refused, with both ways out named
// (the number, or Dutch btw for a consumer). A customer whose country is unknown reads as the
// Netherlands, which is what every row was before the column existed — the guard never fires on
// a guess.
//
// Codes are ISO 3166-1 alpha-2 in upper case. 'EL', the VAT prefix Greece uses, is accepted and
// stored as the country code 'GR', so a number and a country typed from the same letterhead agree.
//
// Dutch strings: the refusal reaches the screen through the send route's `error`, exactly like
// kor-invoice.ts and reverse-charge-invoice.ts; the country names are document content read by a
// Dutch customer on the invoice.

import type { TreatedLine } from "./line-vat-treatment";

/** The 27 member states, ISO codes (Greece is GR here, EL only as a VAT prefix). */
export const EU_MEMBER_STATES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV",
  "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

// The names a Dutch invoice prints under the city of a foreign customer. Unlisted codes print as
// the code itself, which is still an unambiguous statement of the country.
const COUNTRY_NAMES_NL: Record<string, string> = {
  AT: "Oostenrijk", BE: "België", BG: "Bulgarije", HR: "Kroatië", CY: "Cyprus", CZ: "Tsjechië",
  DK: "Denemarken", EE: "Estland", FI: "Finland", FR: "Frankrijk", DE: "Duitsland", GR: "Griekenland",
  HU: "Hongarije", IE: "Ierland", IT: "Italië", LV: "Letland", LT: "Litouwen", LU: "Luxemburg",
  MT: "Malta", NL: "Nederland", PL: "Polen", PT: "Portugal", RO: "Roemenië", SK: "Slowakije",
  SI: "Slovenië", ES: "Spanje", SE: "Zweden",
  GB: "Verenigd Koninkrijk", CH: "Zwitserland", NO: "Noorwegen", US: "Verenigde Staten",
  TR: "Turkije", MA: "Marokko", SR: "Suriname", CW: "Curaçao", AW: "Aruba", CA: "Canada",
  AU: "Australië", IN: "India", CN: "China", JP: "Japan", ZA: "Zuid-Afrika", AE: "Verenigde Arabische Emiraten",
};

/** The stored code for whatever was typed: two letters, upper case, or nothing. */
export function normalizeCountry(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) return null;
  return s === "EL" ? "GR" : s;
}

export function isEuMemberState(code: string | null | undefined): boolean {
  const c = normalizeCountry(code);
  return c !== null && EU_MEMBER_STATES.has(c);
}

/** An EU member state that is not the Netherlands — the ICP's and the 0%-guard's question. */
export function isOtherEuMemberState(code: string | null | undefined): boolean {
  const c = normalizeCountry(code);
  return c !== null && c !== "NL" && EU_MEMBER_STATES.has(c);
}

/** The Dutch name for the document, or the code when the list has no name for it. */
export function countryNameNl(code: string | null | undefined): string {
  const c = normalizeCountry(code);
  if (!c) return "";
  return COUNTRY_NAMES_NL[c] ?? c;
}

export type EuZeroRatedCheck =
  | { ok: true }
  | { ok: false; code: "eu_nul_zonder_btw_nummer"; country: string; error: string };

/**
 * May this invoice leave at 0% to a customer in another member state?
 *
 * Refuses only the shape the law refuses: a factuur (or creditnota) to a customer whose recorded
 * country is another member state, with no line charging btw, not wholly exempt, and no customer
 * btw-id. Everything else — a Dutch customer, an unknown country, a KOR owner, a quote, an invoice
 * that charges btw, an exempt supply — passes untouched, so nothing changes for the owners who
 * never sell abroad.
 */
export function checkEuZeroRatedInvoice(args: {
  clientCountry: string | null | undefined;
  clientBtwNumber: string | null | undefined;
  invoiceType: string | null | undefined;
  korActive: boolean | null | undefined;
  lines: readonly (TreatedLine | null | undefined)[] | null | undefined;
}): EuZeroRatedCheck {
  const type = args.invoiceType ?? "factuur";
  if (type !== "factuur" && type !== "creditnota") return { ok: true };
  if (args.korActive) return { ok: true };
  const country = normalizeCountry(args.clientCountry);
  if (!country || !isOtherEuMemberState(country)) return { ok: true };
  const lines = (args.lines ?? []).filter((l): l is TreatedLine => !!l);
  // A header-only row carries nothing to judge; refusing on nothing is the wrong direction.
  if (lines.length === 0) return { ok: true };
  if (lines.some((l) => Number(l.btw_rate) > 0)) return { ok: true };
  // An exempt supply (art. 11) needs no buyer number — the exemption is not a zero rate.
  if (lines.every((l) => l.vat_treatment === "exempt")) return { ok: true };
  if (String(args.clientBtwNumber ?? "").replace(/[\s.\-/]/g, "").length > 0) return { ok: true };
  const land = countryNameNl(country);
  return {
    ok: false,
    code: "eu_nul_zonder_btw_nummer",
    country,
    error:
      `Deze factuur gaat zonder btw naar een klant in ${land} (EU), maar het btw-nummer van de klant ` +
      "ontbreekt. Zonder dat nummer mag de btw niet naar de klant worden verlegd (0%): dan ben je zelf " +
      "de Nederlandse btw verschuldigd. Is de klant een ondernemer, vul dan zijn btw-nummer in bij de " +
      "klant; is het een particulier, reken dan Nederlandse btw.",
  };
}
