// lib/ubl-export.ts
// [BOEK-020] UBL 2.1 invoice export — pure generator (data in → XML string out)
// June 2026
//
// Standard: UBL 2.1 (urn:oasis:names:specification:ubl:schema:xsd:Invoice-2)
// Accepted by Dutch accounting software (Exact Online, Snelstart, Twinfield, Yuki).
// The DEFAULT document is NOT SI-UBL / Peppol BIS (no CustomizationID) — deliberately lenient
// for import use, unchanged since it shipped. [SI-UBL] UblBuildOptions.peppol asks the same
// builder for the Peppol BIS 3.0 identity of the same invoice — see the option's doc comment.
//
// Design rules:
//  - Pure function: takes RAW data (not display-formatted rows), returns an XML string.
//    No date/amount pre-formatting from export.ts — those produce display values
//    (comma decimals, no zero-padding) that UBL rejects.
//  - Amounts: dot decimal, exactly 2 decimals.
//  - Dates: YYYY-MM-DD (zero-padded).
//  - Totals are DERIVED from invoice_lines for internal consistency
//    (TaxExclusiveAmount = LineExtensionAmount = Σ line amounts;
//     TaxInclusiveAmount = TaxExclusiveAmount + Σ tax). The stored invoice header
//     totals are only used as a cross-check (warning, never silent override).
//  - xmlbuilder2 handles XML escaping (& < > " ') and element nesting.
//  - btw_rate: on invoice_lines it IS a real column — read it directly (do NOT
//    recompute via the invoices-level Math.round trick).

import { create } from "xmlbuilder2";
// [UNIT] De enige plek waar een eenheid een UN/ECE Rec 20-code wordt. Zie units.ts voor
// waarom de terugval C62 blijft: geen bestaande factuur mag van betekenis veranderen.
import { toUnitCode } from "./units";
// [E-FACTUUR] Dezelfde zinsherkenning als de aangifte-vlag — één definitie van een juridisch feit.
import { RE_REVERSE_CHARGE } from "./regime-flags";
import { isReverseChargedInvoice, classifyVatNumber, normalizeVatNumber } from "./icp";
import { applyDiscount, parseDiscount } from "./invoice-discount";
import { round2 } from "./invoice-totals";
// [KLANT-EXTRA] Dezelfde drie vrije klantregels als op de PDF — één leesdefinitie voor beide
// documenten, zodat de e-factuur nooit een andere geadresseerde draagt dan het papier.
import { clientExtraLines } from "./client-extra-lines";

// ─── Input shapes (raw DB-ish, decoupled from database.types for testability) ──

/** Seller = the ZZP'er, from `profiles`. */
export interface UblSupplier {
  company_name: string | null;
  full_name: string | null;
  kvk_number: string | null;
  btw_number: string | null;
  iban: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
}

/** Invoice header, from `invoices` (raw — dates as 'YYYY-MM-DD', amounts as numbers). */
export interface UblInvoiceHeader {
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  invoice_type: string | null; // 'factuur' | 'creditnota' | 'pro_forma' | 'offerte'
  total_ex_btw: number | null;
  btw_amount: number | null;
  total_inc_btw: number | null;
  client_name: string | null;
  client_address: string | null;
  client_postal_code: string | null;
  client_city: string | null;
  client_btw_number: string | null;
  /**
   * [KORTING] Een korting op de hele factuur. Hoort in het CONTRACT van deze export, niet in een
   * cast bij het gebruik: dit bestand gaat naar een access point dat het weigert als de bedragen
   * niet met elkaar kloppen (BR-CO-10), dus wat erin mag is precies wat hier staat.
   */
  discount_type?: string | null;
  discount_value?: number | null;
  /**
   * [CREDIT-REF] BG-3: the invoice this creditnota corrects, when the caller knows it. A booking
   * system matches a credit note to its original by this reference; without it the credit lands
   * as an orphan a person must pair by hand. Optional and best-effort — an old creditnota without
   * a stored original simply carries no BillingReference, exactly as before.
   */
  original_invoice_number?: string | null;
  original_invoice_date?: string | null;
  /**
   * [KLANT-EXTRA] The three free lines under the customer's name ("t.a.v. …", a project or
   * purchase-order reference). Optional: a caller reading a database where
   * client_extra_lines.sql is still open simply has no keys here, and the XML is what it
   * always was. When present they are REQUIRED in the XML too — a receiving system books an
   * invoice against exactly the reference these lines carry, so an e-factuur without them is
   * refused by the same desk that refuses the paper without them.
   */
  client_extra_line1?: string | null;
  client_extra_line2?: string | null;
  client_extra_line3?: string | null;
  client_extra_line4?: string | null;
}

/** Invoice line, from `invoice_lines`. `line_total` is treated as EX BTW. */
export interface UblInvoiceLine {
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  btw_rate: number | null; // real column on invoice_lines (default 21)
  line_total: number | null; // ex BTW (quantity * unit_price)
  /**
   * [UNIT] De eenheid zoals de ondernemer hem koos ("uur", "m²", "stuk"). Optioneel: op een
   * regel zonder eenheid valt de export terug op C62, precies zoals hij dat altijd al deed.
   */
  unit?: string | null;
  /**
   * [E-FACTUUR] 'exempt' = art. 11 Wet OB. The same flag the aangifte reads to keep this turnover
   * out of every rubriek — and the reason it must reach the UBL: an exempt supply is category E,
   * not the Z that every 0% line used to get. Optional, and absent on a deployment where the
   * column has not been added yet, which then behaves exactly as before.
   */
  vat_treatment?: string | null;
  /**
   * [REGEL-KORTING] De korting op DEZE regel. `line_total` hierboven is er al mee verlaagd — dat
   * is de afspraak van de kolom — dus deze twee veranderen geen enkel bedrag in dit bestand. Wat
   * ze doen is het VERSCHIL verklaren: zonder hen zou de e-factuur een stuksprijs moeten
   * verzinnen die het verlaagde regelbedrag oplevert, en dan staat er een prijs op die de
   * ondernemer nooit heeft afgesproken. Met hen staat er wat er is: de prijs, en de korting
   * eronder (EN 16931 BG-27).
   *
   * Optioneel, en afwezig op een installatie waar invoice_line_discount.sql nog open staat: het
   * bestand is dan precies wat het altijd was.
   */
  discount_type?: string | null;
  discount_value?: number | null;
}

// ─── Errors (stable codes — UI/route maps to Dutch copy) ───────────────────────

export type UblErrorCode =
  | "SUPPLIER_MISSING_KVK"
  | "SUPPLIER_MISSING_BTW"
  | "SUPPLIER_MISSING_NAME"
  | "NO_LINES"
  | "MISSING_INVOICE_NUMBER"
  | "MISSING_INVOICE_DATE"
  // [SI-UBL] Peppol routes on the buyer's electronic address (BT-49). Without any — this app
  // can offer their BTW number (EAS 9944) and nothing else — a BIS document has no destination,
  // and a file that LOOKS deliverable but is not is worse than a refusal that says why.
  | "CLIENT_MISSING_PEPPOL_ADDRESS"
  // [SI-UBL-EAS] The buyer HAS a VAT number, but from a country whose VAT-number EAS code is not
  // in our verified table. Stamping 9944 (NL:VAT) on a DE number would hand the network an
  // address that can never resolve — the file validates and then silently goes nowhere.
  | "CLIENT_PEPPOL_EAS_UNSUPPORTED"
  // [LAND-ONBEKEND] The buyer states a VAT number that is shaped like a foreign one and belongs to
  // no EU member state — GB, CHE, a US EIN typed into the field. BT-55 is mandatory (BR-11) and
  // this app holds no country column anywhere, so the only value available is the NL fallback —
  // which would put "country: NL" on the same document as "VAT number: GB123456789". A file that
  // contradicts itself about where the buyer is, is worse than no file: it validates, it arrives,
  // and the receiving system books a domestic Dutch supply.
  | "CLIENT_COUNTRY_UNKNOWN";

export class UblValidationError extends Error {
  code: UblErrorCode;
  constructor(code: UblErrorCode, message: string) {
    super(message);
    this.name = "UblValidationError";
    this.code = code;
  }
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

// [CENT] round2 comes from invoice-totals — the same function the draft, the issue route, the
// screen and the PDF round with. It used to be defined here as
// `Math.round((n + Number.EPSILON) * 100) / 100`, which is a DIFFERENT function, and the
// difference reached the customer:
//
//     one line, € 21,50 excl., 21%
//     screen · database · PDF · aangifte     btw 4,52     total 26,02
//     the XML this file produced             btw 4.51     PayableAmount 26.01
//
// Number.EPSILON is 2,2e-16 — far too small to recover the half cent that 21,50 × 0,21 loses in
// binary floating point (it is 4,514999999999999), so this rounded down where every other surface
// rounded up. The file is internally consistent, so no Peppol rule fires and the header cross-check
// below only warns above one cent: the e-invoice simply arrives at the customer's bookkeeping a
// cent lighter than the invoice they were sent. They pay 26,01, the ledger expects 26,02, and the
// invoice never closes.
//
// 492 amounts under € 5.000 at 9% and 21% do this — every price on a half euro.

/** Format a number as a UBL amount: dot decimal, exactly 2 places. */
function money(n: number): string {
  return round2(n).toFixed(2);
}

/**
 * [KOPER-LAND] The buyer's country code for BT-55, from the only evidence the row carries.
 *
 * A VAT number states its country in its first two letters, and classifyVatNumber already parses
 * exactly that — including the two prefixes that are not the ISO code of their member state (EL for
 * Greece, and the UK/XI question it deliberately leaves as "none"). Anything it cannot place —
 * absent, malformed, or a prefix outside the EU table — falls back to NL, which is what this line
 * always said and is right for the overwhelming majority of these invoices.
 *
 * ── IT FOLLOWS THE SAME EVIDENCE AS THE REVERSE CHARGE, ON PURPOSE ──
 *
 * `kind === "eu"` is the exact test isReverseChargedInvoice makes (icp.ts), and this reads it
 * rather than a stricter or looser one of its own. That is the whole point: the defect being fixed
 * is a document that reverse-charges to a German VAT number while calling the buyer Dutch, and a
 * country derived from a DIFFERENT rule than the treatment would simply move the contradiction
 * somewhere else. Where the app charges no BTW because it read an EU number, the country is that
 * number's country; everywhere else it is NL, exactly as before.
 *
 * `eu_suspect` therefore does NOT count — the reverse charge does not fire on it either.
 */
/**
 * [LAND-ONBEKEND] Does this row state a foreign VAT number this app cannot place in a country?
 *
 * The narrow case, and deliberately narrow. A buyer with NO VAT number keeps the NL fallback —
 * that is every domestic consumer invoice this app has ever written, and nothing about them
 * changes. A buyer with an NL number is Dutch. A buyer with an EU number gets that member state.
 *
 * What is left is a number that LOOKS like a VAT identifier from somewhere else: two letters that
 * are not NL and not an EU prefix, followed by the alphanumerics of a real identifier. GB, CHE,
 * NO, plus whatever a UK or Swiss customer's own number happens to be. For those, and only those,
 * the document would otherwise state a Dutch buyer beside a British VAT number.
 *
 * Not caught, on purpose: text somebody typed into the field ("zie bijlage", a phone number). It
 * does not have the shape of a VAT identifier, it is not evidence of a country, and refusing an
 * invoice over it would block a domestic sale for a typo.
 */
export function foreignVatOutsideEu(clientVatNumber: string | null | undefined): boolean {
  const v = normalizeVatNumber(clientVatNumber);
  if (!v) return false;
  // Two letters, then an identifier that contains at least one DIGIT. Every VAT number in the
  // world does; a phrase somebody typed into the field does not, and "zie bijlage" normalises to
  // ZIEBIJLAGE — two letters and eight alphanumerics, which a shape check without the digit rule
  // happily reads as a foreign VAT number and refuses a domestic invoice over.
  if (!/^[A-Z]{2}[A-Z0-9]{4,13}$/.test(v)) return false;
  if (!/\d/.test(v.slice(2))) return false;
  return classifyVatNumber(v).kind === "none";
}

export function buyerCountryCode(clientVatNumber: string | null | undefined): string {
  const shape = classifyVatNumber(clientVatNumber);
  if (shape.kind !== "eu") return "NL";
  // Greece files its VAT numbers under EL and is ISO 3166-1 GR. BT-55 is a COUNTRY code, so it
  // takes GR — the one member state where the VAT prefix and the country code differ, and the one
  // place classifyVatNumber's answer (which is about VAT numbers) must be translated before use.
  return shape.country === "EL" ? "GR" : shape.country;
}

/** Format a quantity: up to six decimals, dot decimal, no trailing-zero noise. */
function qty(n: number): string {
  // [R120] Zes decimalen, niet twee. De validator rekent met de GEDRUKTE aantal-waarde:
  // een regel 0,333 x 100 als "0.33" afdrukken laat hem 33,00 uitrekenen tegenover een
  // LineExtensionAmount van 33,30 — PEPPOL-EN16931-R120, bestand geweigerd. UBL accepteert
  // decimalen ruimhartig; de precisie moet dus bij het aantal blijven, en de takkeuze in de
  // Price-sectie rekent met dezelfde gedrukte waarde zodat document en beslissing nooit
  // van elkaar kunnen afwijken.
  return String(Number(n.toFixed(6)));
}

/**
 * Normalize a date to UBL YYYY-MM-DD (zero-padded).
 * Accepts 'YYYY-MM-DD' (Supabase `date`), full ISO timestamps, or Date.
 */
function toUblDate(input: string | null): string | null {
  if (!input) return null;
  // Already a clean date string?
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** UBL InvoiceTypeCode (UNCL 1001): 380 = commercial invoice, 381 = credit note,
 *  325 = proforma. A pro_forma/offerte must never be emitted as 380 (that would label a non-legal
 *  quote as a real invoice). The export route already blocks these (no invoice number), so this is
 *  correct-by-construction defence in depth. */
function invoiceTypeCode(invoiceType: string | null): "380" | "381" | "325" {
  if (invoiceType === "creditnota") return "381";
  if (invoiceType === "pro_forma" || invoiceType === "offerte") return "325";
  return "380";
}

/**
 * UBL tax category code (UNCL 5305) for one line or rate group.
 *
 * ── WHY A 0% LINE IS NOT AUTOMATICALLY "Z" ──
 * Three legally different things are all stored as btw_rate 0 in this app, and UBL has a separate
 * code for each:
 *
 *   Z   zero rated        — a supply that IS taxed, at 0%;
 *   E   exempt from VAT   — art. 11 Wet OB: care, education, insurance. Not a rate at all;
 *   AE  VAT reverse charge — art. 12 lid 5 / the construction sector: the BUYER owes the BTW.
 *
 * Sending E as Z tells the receiver's system it may treat the supply as taxable at 0%, which is
 * what it does with an export — and E and AE are the ones a receiver has to book differently.
 * Under BR-E-* and BR-AE-* of Peppol BIS Billing 3.0 both codes also REQUIRE a reason on the
 * TaxSubtotal (TaxExemptionReason), so a validator rejects the document rather than mis-reading
 * it. That is why this was worth fixing before any Dutch e-invoicing mandate lands rather
 * than after: an invoice that fails validation is an invoice that was never delivered.
 *
 * A line says which one it is via vat_treatment ('exempt') — the same flag the aangifte reads to
 * keep that turnover out of every rubriek. Reverse charge is not a column in this app; it is read
 * off the owner's own line text, see lineVatKind().
 */
export type UblTaxCategory = "S" | "Z" | "E" | "AE";

export function taxCategoryId(rate: number, treatment?: VatKind): UblTaxCategory {
  if (treatment === "reverse_charge") return "AE";
  if (treatment === "exempt") return "E";
  return rate > 0 ? "S" : "Z";
}

/** What kind of supply a line is, beyond its rate. */
export type VatKind = "taxed" | "exempt" | "reverse_charge";

/**
 * The reason text BR-E-10 / BR-AE-10 require next to an E or AE category. Dutch, because it is
 * printed on a document a Dutch counterparty reads — and because naming the article is what makes
 * the claim checkable.
 */
export function taxExemptionReason(category: UblTaxCategory, intraCommunity = false): string | null {
  if (category === "E") return "Vrijgesteld van btw op grond van artikel 11 Wet OB 1968";
  // [AE-GROND] AE has TWO origins in this file and they are two different articles of law.
  //
  // A DOMESTIC verlegging — bouw, onderaanneming, schroot — rests on art. 12 lid 5 Wet OB, which
  // is the delegation the Uitvoeringsbesluit hangs on. An INTRACOMMUNAUTAIRE supply to a VAT-
  // registered buyer in another member state does not: it is art. 138 BTW-richtlijn (art. 9 lid 2
  // sub b jo. tabel II Wet OB on the Dutch side), and the buyer accounts for it under art. 196.
  //
  // One string served both, so every intracommunautaire e-factuur this app has ever produced
  // carried a Dutch DOMESTIC article as the legal ground for a cross-border reverse charge. No
  // euro moves on it — the amounts and the AE category are right either way — but it is a false
  // legal statement on a fiscal document that a foreign accountant reads, and it is the sentence
  // their software quotes back when the booking is questioned.
  //
  // Defaulted to false so every existing caller keeps the domestic text it had.
  if (category === "AE") {
    return intraCommunity
      ? "Btw verlegd — intracommunautaire levering, artikel 138 BTW-richtlijn"
      : "Btw verlegd — artikel 12 lid 5 Wet OB 1968";
  }
  return null;
}

/**
 * Is this supply reverse-charged to the buyer?
 *
 * Deliberately evidence-based: this app has no per-line reverse-charge flag, so the only honest
 * signal is the one the law itself requires the seller to put on the invoice. Article 226 point
 * 11a of the VAT Directive (art. 35a lid 1 sub k Wet OB) says a reverse-charged invoice must carry
 * the words "btw verlegd" — so an invoice that IS reverse-charged says so, and one that does not
 * is not one. Reading the owner's own words is not a guess; inferring it from a 0% rate would be.
 *
 * RE_REVERSE_CHARGE comes from regime-flags.ts, which is the module that already asks this exact
 * question of this exact text to warn the accountant. A second regex here would be a second
 * definition of a legal fact about one document, and the aangifte would flag an invoice the
 * e-invoice exported as an ordinary 0% supply.
 *
 * Requires zero BTW on the line as well: a line that charged BTW cannot also have reverse-charged
 * it, whatever the description says.
 */
export function lineVatKind(line: UblInvoiceLine, documentIsReverseCharged = false): VatKind {
  const rate = Number(line.btw_rate ?? 0);
  if (rate > 0) return "taxed";
  if (line.vat_treatment === "exempt") return "exempt";
  if (RE_REVERSE_CHARGE.test(line.description ?? "")) return "reverse_charge";
  // [E-FACTUUR-VERLEGD] The document-level fact, from the same predicate the PDF prints its
  // "Btw verlegd" sentence from (isReverseChargedInvoice in icp.ts): an EU customer with a VAT
  // number, zero BTW on the invoice, not KOR. Reading the line text alone left this case as Z —
  // so the paper document and the e-invoice for ONE sale told two different tax stories, and the
  // receiving system booked no reverse charge at all.
  //
  // Last of the four, deliberately. An exempt line stays E: art. 11 is a different fact and does
  // not become verlegging because the customer happens to sit in Germany. A taxed line is
  // unreachable here anyway, because a document carrying BTW is never reverse-charged.
  if (documentIsReverseCharged) return "reverse_charge";
  return "taxed"; // a genuine 0% supply — Z
}

const NS = {
  inv: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  // [CREDITNOTA-DOCUMENT] UBL 2.1 has TWO document types, not one document with a code on it. A
  // credit note is a CreditNote in its own namespace — see the block above buildInvoiceUbl.
  cn: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
};
const EUR = "EUR";

// [SI-UBL-EAS] BT-49 scheme per buyer country — the EAS code that says WHAT KIND of identifier
// the electronic address is. 9944 means specifically "NL:VAT": a German VAT number under 9944 is
// an address on the wrong street, syntactically valid and undeliverable. This table carries only
// codes verified against the EN 16931 EAS code list; a VAT prefix outside it REFUSES the Peppol
// variant rather than guessing, because a wrong scheme fails silently after delivery "succeeds".
const PEPPOL_EAS_BY_VAT_COUNTRY: Record<string, string> = {
  NL: "9944",
  DE: "9930",
  BE: "9925",
  FR: "9957",
  AT: "9914",
  IT: "9906",
  ES: "9920",
  LU: "9938",
  SE: "9955",
};

/**
 * The buyer's Peppol electronic address: EAS scheme + the NORMALIZED participant value — or null
 * when no deliverable address can be derived.
 *
 * [SI-UBL-EAS-COHERENT] Two defects lived here, found by the day-end audit:
 *   · this judged the raw 2-char prefix while buyerCountryCode judges through classifyVatNumber,
 *     so a malformed "DE12345" or a post-Brexit GB number got an EAS address while the SAME file
 *     said Country=NL — one document, two contradictory claims about the buyer;
 *   · the emitted value was the raw entry ("DE 123.456.789"), which can never match the
 *     registered participant "9930:de123456789" — validating and undeliverable at once.
 * One judge now: classifyVatNumber. A shape it refuses (eu_suspect, none — GB included, which is
 * why GB left the table) refuses the Peppol variant; the value that ships is the normalized one.
 */
export function peppolEndpointForVat(
  btwNumber: string | null | undefined,
): { eas: string; value: string } | null {
  const shape = classifyVatNumber(btwNumber);
  if (shape.kind === "domestic") {
    return { eas: PEPPOL_EAS_BY_VAT_COUNTRY.NL, value: normalizeVatNumber(btwNumber) };
  }
  if (shape.kind !== "eu") return null;
  const eas = PEPPOL_EAS_BY_VAT_COUNTRY[shape.country] ?? null;
  return eas ? { eas, value: shape.vat } : null;
}

// ─── Validation ─────────────────────────────────────────────────────────────────

function supplierName(s: UblSupplier): string | null {
  return s.company_name?.trim() || s.full_name?.trim() || null;
}

/**
 * Resolve the lines to use for the UBL.
 * If the invoice has real line items, use them. If it has none (e.g. a scanned /
 * imported invoice where only header totals were extracted) but it does have a
 * usable ex-BTW total, synthesize ONE summary line from the header totals so
 * the invoice is still exportable. Amounts stay faithful to the stored totals;
 * any rounding gap is surfaced as a warning by buildInvoiceUbl().
 * Returns [] only when there is neither line detail nor a usable total.
 *
 * [CREDIT-SIGN] `ex > 0` and not `ex !== 0`, for as long as this function existed — and a
 * creditnota's ex total is NEGATIVE. So a creditnota of an invoice that has no lines got no
 * synthesized line either, validateUblInputs answered NO_LINES, and buildInvoiceUbl threw: the
 * e-factuur could not be produced at all. The very same document as a factuur exported fine.
 *
 * It is reachable with ordinary data: invoices without lines are why this function exists (the
 * warning above says so), and the creditnota route copies the lines of the invoice it corrects —
 * no lines in, no lines out.
 *
 * The synthesized line follows the STORED convention rather than the printed one: a creditnota is
 * stored negative ([CREDIT-SIGN]), so its summary line is -1 x |ex|. buildInvoiceUbl flips that
 * back to +1 x |ex| for the file, which is what UBL wants and what PEPPOL-EN16931-R120 checks. A
 * synthesized `quantity: 1` would come out of that flip as -1 against a positive amount, and the
 * access point would refuse the file for a different reason than before.
 */
export function effectiveLines(
  header: UblInvoiceHeader,
  lines: UblInvoiceLine[]
): UblInvoiceLine[] {
  if (lines && lines.length > 0) return lines;
  const ex = Number(header.total_ex_btw ?? 0);
  if (Number.isFinite(ex) && ex !== 0) {
    const btw = Number(header.btw_amount ?? 0);
    // Both signs divide out to the same rate: -21 / -100 is 21%, as it should be.
    const rate = Math.round((btw / ex) * 100);
    return [
      {
        description: "Factuurbedrag",
        quantity: ex < 0 ? -1 : 1,
        unit_price: Math.abs(ex),
        btw_rate: rate,
        line_total: ex,
      },
    ];
  }
  return [];
}

/**
 * Validate inputs without throwing — useful for the UI to pre-check
 * and decide whether to show/enable the export button.
 */
export function validateUblInputs(
  header: UblInvoiceHeader,
  lines: UblInvoiceLine[],
  supplier: UblSupplier
): { ok: true } | { ok: false; code: UblErrorCode } {
  if (!supplierName(supplier)) return { ok: false, code: "SUPPLIER_MISSING_NAME" };
  if (!supplier.kvk_number?.trim()) return { ok: false, code: "SUPPLIER_MISSING_KVK" };
  if (!supplier.btw_number?.trim()) return { ok: false, code: "SUPPLIER_MISSING_BTW" };
  if (!header.invoice_number?.trim()) return { ok: false, code: "MISSING_INVOICE_NUMBER" };
  if (!toUblDate(header.invoice_date)) return { ok: false, code: "MISSING_INVOICE_DATE" };
  // NO_LINES only when there is neither line detail nor usable header totals.
  if (effectiveLines(header, lines).length === 0) return { ok: false, code: "NO_LINES" };
  return { ok: true };
}

// ─── Tax grouping ────────────────────────────────────────────────────────────────

interface TaxGroup {
  rate: number; // e.g. 21, 9, 0
  category: UblTaxCategory;
  taxable: number; // Σ line ex-btw at this rate AND category
  tax: number; // round2(taxable * rate/100)
  /** [KOR-E] This group is E because of the KOR, not art. 11 — the exemption reason differs. */
  korExempt?: boolean;
}

// [KOR-E] Under the KOR a supply is VRIJGESTELD (art. 25 Wet OB 1968) — category E, not the Z of
// a genuine zero rate. Z claims "0% applies to this supply", which is a different legal fact; a
// buyer's system reading Z may still expect the seller in the ICP/aangifte chains a KOR'er is
// exempt from. The reason text names the article, same discipline as taxExemptionReason.
export const KOR_EXEMPTION_REASON = "Vrijgesteld van btw — kleineondernemersregeling (artikel 25 Wet OB 1968)";

/**
 * One TaxSubtotal per (rate, category) pair — not per rate.
 *
 * [E-FACTUUR] It used to be per rate, which silently merged three different supplies. An invoice
 * with €500 of exempt care and €500 of genuinely 0%-rated export came out as ONE 0% subtotal of
 * €1.000 in category Z, and the €500 that is exempt vanished into a category it does not belong
 * to. BR-S-08 / BR-Z-08 / BR-E-08 / BR-AE-08 each require the taxable amount of their category to
 * equal the sum of the lines carrying it, so the merged version is not only wrong in meaning, it
 * fails validation as soon as both appear on one invoice.
 */
function groupByRate(lines: UblInvoiceLine[], documentIsReverseCharged = false, korActive = false): TaxGroup[] {
  const map = new Map<string, { rate: number; category: UblTaxCategory; taxable: number; korExempt: boolean }>();
  for (const l of lines) {
    const rate = Number(l.btw_rate ?? 0);
    // [KOR-E] Only a would-be Z becomes E under the KOR: an explicit art.-11 exemption stays E on
    // its own ground, AE stays AE, and a taxed line (a pre-KOR invoice exported later) stays S.
    const baseCategory = taxCategoryId(rate, lineVatKind(l, documentIsReverseCharged));
    const korExempt = korActive && baseCategory === "Z";
    const category: UblTaxCategory = korExempt ? "E" : baseCategory;
    // [KOR-E] The key does NOT include korExempt. BR-E-08 asserts one E breakdown per rate whose
    // taxable equals the sum of ALL E lines — a KOR-converted group and an art.-11 group split
    // apart would each fail it, and the file would carry two contradictory legal claims about one
    // rate. Merged, the group takes the KOR reason as soon as ANY line is there because of the
    // KOR: art. 25 covers the whole enterprise, so the claim stays true for the art.-11 lines too.
    const key = `${rate}|${category}`;
    const ex = Number(l.line_total ?? 0);
    const cur = map.get(key);
    if (cur) { cur.taxable += ex; cur.korExempt = cur.korExempt || korExempt; }
    else map.set(key, { rate, category, taxable: ex, korExempt });
  }
  return [...map.values()]
    // 21 before 9 before 0; within one rate, a stable order by category so the XML is reproducible.
    .sort((a, b) => b.rate - a.rate || a.category.localeCompare(b.category))
    .map((g) => ({
      rate: g.rate,
      category: g.category,
      taxable: round2(g.taxable),
      tax: round2(g.taxable * (g.rate / 100)),
      korExempt: g.korExempt,
    }));
}

// ─── Generator ────────────────────────────────────────────────────────────────────

/** What the generator cannot read off the invoice row itself. */
export interface UblBuildOptions {
  /**
   * [E-FACTUUR-VERLEGD] The owner's KOR status, from their profile. Under KOR no BTW is charged
   * for a reason that has nothing to do with verlegging, so a zero-BTW invoice to an EU customer
   * is NOT reverse-charged — same rule the PDF applies. Absent ⇒ not KOR, which is the majority
   * case and the behaviour of every caller before this option existed.
   */
  korActive?: boolean;
  /**
   * [SI-UBL] Peppol BIS Billing 3.0 mode. The default document stays exactly what it was —
   * "bewust soepel", built to IMPORT into Exact/SnelStart/Twinfield/Yuki, no CustomizationID.
   * With peppol:true the SAME document carries the BIS identity and the fields an access point
   * validates: CustomizationID + ProfileID (and no UBLVersionID — BIS files do not carry one),
   * EndpointID on both parties (supplier: KVK, EAS 0106; buyer: BTW-nummer, EAS 9944),
   * a BuyerReference (PEPPOL-EN16931-R003), and a refusal when the buyer has no electronic
   * address at all. Sending over the network still needs an access-point contract — this makes
   * the FILE ready, it does not transmit it.
   */
  peppol?: boolean;
}

export interface UblBuildResult {
  xml: string;
  /** Non-fatal cross-check notes (e.g. derived totals differ from stored header). */
  warnings: string[];
}

/**
 * Build a valid UBL 2.1 invoice XML from raw data.
 * Throws UblValidationError on missing required data.
 */
export function buildInvoiceUbl(
  header: UblInvoiceHeader,
  lines: UblInvoiceLine[],
  supplier: UblSupplier,
  opts?: UblBuildOptions
): UblBuildResult {
  const check = validateUblInputs(header, lines, supplier);
  if (!check.ok) {
    throw new UblValidationError(check.code, `UBL export blocked: ${check.code}`);
  }
  // [SI-UBL] The buyer's electronic address is the routing key of a Peppol document.
  if (opts?.peppol && !header.client_btw_number?.trim()) {
    throw new UblValidationError("CLIENT_MISSING_PEPPOL_ADDRESS", "UBL export blocked: CLIENT_MISSING_PEPPOL_ADDRESS");
  }
  // [SI-UBL-EAS] …and the scheme of that address depends on the buyer's country. Hardcoding 9944
  // stamped NL:VAT on every buyer, so a BIS file for a German customer carried an address that can
  // never resolve. Refuse what we cannot address rather than misaddress it — and judge the number
  // through the SAME classifier the Country element uses, so the file can never say Country=NL
  // next to a German electronic address ([SI-UBL-EAS-COHERENT]).
  const buyerPeppol = opts?.peppol ? peppolEndpointForVat(header.client_btw_number) : null;
  if (opts?.peppol && !buyerPeppol) {
    throw new UblValidationError("CLIENT_PEPPOL_EAS_UNSUPPORTED", "UBL export blocked: CLIENT_PEPPOL_EAS_UNSUPPORTED");
  }

  // [LAND-ONBEKEND] BT-55 is mandatory and this app has no country column, so the only value it
  // can offer a non-EU buyer is the NL fallback. On a row that ALSO states a British or Swiss VAT
  // number, that produces one document making two contradictory claims about where the buyer sits
  // — and the contradiction is invisible: the file validates, arrives, and is booked as a domestic
  // Dutch supply by a system that trusts the country element over the number beside it.
  //
  // Refusing is the same choice this file already makes one line up for a Peppol address it cannot
  // scheme, and for the same reason: a file that LOOKS deliverable and is wrong costs more than a
  // refusal that says why. It applies to EVERY build, not only the Peppol one — the plain UBL file
  // is attached to the customer's own invoice mail, so it reaches a foreign accountant either way.
  if (foreignVatOutsideEu(header.client_btw_number)) {
    throw new UblValidationError("CLIENT_COUNTRY_UNKNOWN", "UBL export blocked: CLIENT_COUNTRY_UNKNOWN");
  }

  // [E-FACTUUR-VERLEGD] One question, asked once, for the whole document — and asked of the same
  // function the PDF asks. Every category below (line, subtotal, allowance) reads this variable,
  // so the three places in the XML cannot disagree with each other or with the paper invoice.
  const docReverseCharged = isReverseChargedInvoice({
    clientVatNumber: header.client_btw_number,
    btwAmount: header.btw_amount,
    invoiceType: header.invoice_type,
    korActive: opts?.korActive,
  });

  const warnings: string[] = [];
  const issueDate = toUblDate(header.invoice_date)!; // validated
  const dueDate = toUblDate(header.due_date);

  // Use real line items, or a synthesized summary line for header-only invoices.
  const effLinesRaw = effectiveLines(header, lines);
  if (lines.length === 0 && effLinesRaw.length > 0) {
    warnings.push("No invoice_lines — synthesized a single summary line from header totals.");
  }
  // [UBL-CREDIT] A creditnota (UBL type 381) carries POSITIVE amounts: UBL conveys the direction
  // with the type code, and this app stores a creditnota negative ([CREDIT-SIGN]). So the document
  // is flipped once here, and every total and tax group below derives from the result.
  //
  // [MIN-REGEL] FLIPPED, not made absolute — and that distinction is worth EUR 143,70 on the
  // invoice this was found with.
  //
  // Math.abs() is the same thing as a negation only while every line has the same sign. A
  // creditnota of an invoice that contained a RETURN does not: crediting the whole invoice
  // un-returns that line, so it sits in the creditnota as a positive amount among negative ones
  // (see creditnota-lines.ts). Math.abs() then turned that line the wrong way and the file credited
  // the customer for it a second time:
  //
  //     stored creditnota   -123,85  -174,31  -150,00  +71,85   =  -376,31
  //     Math.abs()           123,85   174,31   150,00   71,85   =   520,01   what was sent
  //     negation             123,85   174,31   150,00  -71,85   =   376,31   what the header says
  //
  // Nothing caught it: the XML was internally consistent per line, the PDF was right, and the
  // header/line mismatch only reaches a server log. It predates the credit-line feature — an
  // invoice with a statiegeld or emballage line has always produced one.
  //
  // The unit PRICE stays a magnitude, because a price is one: BR-27 forbids a negative
  // cbc:PriceAmount, and the sign belongs in the quantity (negative-line.ts).
  const isCredit = header.invoice_type === "creditnota";
  const effLines = isCredit
    ? effLinesRaw.map((l) => ({
        ...l,
        // A line with NO quantity means "one of this thing", and on a credit note that is 1 — the
        // value the absolute used to produce. Negating the default instead would emit -1 against a
        // positive line amount, and (-1 ÷ 1) x price is not that amount: PEPPOL-EN16931-R120 then
        // refuses the file. The `?? 1` was doing real work; only the sign of the REAL values moves.
        quantity: l.quantity == null ? 1 : -Number(l.quantity),
        unit_price: Math.abs(Number(l.unit_price ?? 0)),
        line_total: -Number(l.line_total ?? 0),
      }))
    : effLinesRaw;

  // [KOR-E] One document-level fact, read once, applied identically to subtotal, line and
  // allowance categories — the three places a category appears may never disagree.
  const korDoc = !!opts?.korActive;
  const catFor = (rate: number, kind?: VatKind): UblTaxCategory => {
    const c = taxCategoryId(rate, kind);
    return korDoc && c === "Z" ? "E" : c;
  };

  // Derive totals from lines (internal consistency over stored header).
  const rawGroups = groupByRate(effLines, docReverseCharged, korDoc);
  const lineExtensionTotal = round2(rawGroups.reduce((s, g) => s + g.taxable, 0));

  // [KORTING] Een korting op de hele factuur is in Peppol BIS 3.0 GEEN aftrek van het totaal maar
  // een cac:AllowanceCharge — en elke AllowanceCharge draagt precies ÉÉN TaxCategory. Een factuur
  // met 21%- en 9%-regels heeft er dus één per tarief, met de korting pro rata verdeeld. Dat is
  // ook fiscaal de enige juiste vorm: btw is per tarief verschuldigd, dus een korting die niet
  // wordt verdeeld zet allebei de aangifterubrieken fout, in tegengestelde richting.
  //
  // Verdeling en afronding komen uit invoice-discount.ts, dezelfde module als het scherm en de PDF
  // gebruiken. Drie plekken die hetzelfde uitrekenen moeten hetzelfde antwoord geven — en hier is
  // dat geen nettigheid: wijkt LegalMonetaryTotal een cent af van de som van de regels en de
  // toeslagen, dan weigert het ontvangende access point het bestand (BR-CO-10).
  const korting = parseDiscount(header.discount_type, header.discount_value);
  const kortingUitkomst = applyDiscount(
    rawGroups.map((g) => ({ line_total: g.taxable, btw_rate: g.rate })),
    korting,
  );
  const allowanceByRate = new Map<number, number>();
  for (const a of kortingUitkomst.allowances) allowanceByRate.set(a.rate, a.amount);
  const allowanceTotal = kortingUitkomst.discount_ex_btw;

  // [KORTING-PER-GROEP] applyDiscount aggregates per RATE, but the tax groups are keyed by
  // (rate, CATEGORY) — at rate 0 a Z-group and an E-group (vrijgesteld) can coexist. Handing
  // every group at rate r the full rate-r allowance subtracts it once per group while
  // taxExclusive subtracts it once in total, so Σ TaxableAmount ≠ TaxExclusiveAmount and the
  // access point refuses the file (BR-CO-13). Distribute the rate's allowance over that rate's
  // groups instead: proportional to their share, remainder on the last so the parts sum to the
  // allowance to the cent — the same idiom applyDiscount itself uses one layer up. Only groups
  // pointing the same way as the allowance take part (its sign filter, mirrored), so a negative
  // return-line group never receives a "discount" that reads as a surcharge in the XML.
  const offByGroup = new Map<number, number>();
  for (const [rate, amount] of allowanceByRate) {
    const idx = rawGroups
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => g.rate === rate && Math.sign(g.taxable) === Math.sign(amount) && g.taxable !== 0)
      .sort((a, b) => Math.abs(b.g.taxable) - Math.abs(a.g.taxable));
    if (idx.length === 0) continue;
    const base = idx.reduce((sum, { g }) => sum + Math.abs(g.taxable), 0);
    let assigned = 0;
    for (let k = 0; k < idx.length; k++) {
      const part = k === idx.length - 1
        ? round2(amount - assigned)
        : round2((amount * Math.abs(idx[k].g.taxable)) / base);
      assigned = round2(assigned + part);
      if (part !== 0) offByGroup.set(idx[k].i, part);
    }
  }

  const groups = rawGroups.map((g, i) => {
    const off = offByGroup.get(i) ?? 0;
    if (off === 0) return g;
    const taxable = round2(g.taxable - off);
    return { ...g, taxable, tax: round2((taxable * g.rate) / 100) };
  });
  const taxExclusive = round2(lineExtensionTotal - allowanceTotal);
  const totalTax = round2(groups.reduce((s, g) => s + g.tax, 0));
  const taxInclusive = round2(taxExclusive + totalTax);

  // Cross-check against stored header totals (warn only). Compare magnitudes so
  // a creditnota's negative header doesn't false-alarm against positive lines.
  const storedEx = Math.abs(Number(header.total_ex_btw ?? 0));
  const storedInc = Math.abs(Number(header.total_inc_btw ?? 0));
  if (storedEx && Math.abs(storedEx - lineExtensionTotal) > 0.01) {
    warnings.push(
      `Header total_ex_btw (${money(storedEx)}) differs from line sum (${money(lineExtensionTotal)}).`
    );
  }
  if (storedInc && Math.abs(storedInc - taxInclusive) > 0.01) {
    warnings.push(
      `Header total_inc_btw (${money(storedInc)}) differs from derived total (${money(taxInclusive)}).`
    );
  }

  const sName = supplierName(supplier)!;

  // ── [CREDITNOTA-DOCUMENT] A credit note is a DIFFERENT UBL document ──
  //
  // This wrote <Invoice> for everything and carried the direction in InvoiceTypeCode 381. UBL 2.1
  // has two document types, and EN 16931 / Peppol route 381 through CreditNote-2 with
  // CreditNoteTypeCode and CreditNoteLine — 381 is not even in the Invoice transaction's code list.
  // Many importers dispatch on the root element before reading any code.
  //
  // Including this one. Proven by round trip, in this repo: e-invoice.ts:293 decides
  // `isCreditNote: /<(?:\w+:)?CreditNote[\s>]/.test(...)` — the ROOT ELEMENT, never the type code
  // — so a creditnota exported here and re-imported here came back isCreditNote:false and booked
  // as a positive purchase invoice with positive voorbelasting. The app contradicted itself in one
  // round trip; a stranger's bookkeeping does the same thing with the owner's correction.
  const isCreditNote = (header.invoice_type ?? "factuur") === "creditnota";
  const docName = isCreditNote ? "CreditNote" : "Invoice";
  const root = create({ version: "1.0", encoding: "UTF-8" }).ele(isCreditNote ? NS.cn : NS.inv, docName, {
    "xmlns:cbc": NS.cbc,
    "xmlns:cac": NS.cac,
  });

  // ── Header fields (order matters in UBL 2.1) ──
  // [SI-UBL] BIS mode swaps the version tag for the BIS identity pair; the schema puts
  // CustomizationID and ProfileID exactly here, before ID. Everything else in this file is
  // shared between the two modes — one builder, so the lenient file and the Peppol file can
  // never disagree about a single amount.
  if (opts?.peppol) {
    root.ele(NS.cbc, "CustomizationID").txt("urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0");
    root.ele(NS.cbc, "ProfileID").txt("urn:fdc:peppol.eu:2017:poacc:billing:01:1.0");
  } else {
    root.ele(NS.cbc, "UBLVersionID").txt("2.1");
  }
  root.ele(NS.cbc, "ID").txt(header.invoice_number!.trim());
  root.ele(NS.cbc, "IssueDate").txt(issueDate);
  // [CREDIT-VERVALDATUM] CreditNote-2 has NO cbc:DueDate in its schema — the element exists only
  // on Invoice-2. Writing it anyway made every creditnota schema-invalid, refused before any
  // business rule runs. BT-9 travels on a credit note as PaymentMeans/PaymentDueDate — below.
  if (dueDate && !isCreditNote) root.ele(NS.cbc, "DueDate").txt(dueDate);
  // The code keeps its meaning; only the element it lives in follows the document type.
  root.ele(NS.cbc, isCreditNote ? "CreditNoteTypeCode" : "InvoiceTypeCode").txt(invoiceTypeCode(header.invoice_type));
  root.ele(NS.cbc, "DocumentCurrencyCode").txt(EUR);
  // [SI-UBL] PEPPOL-EN16931-R003: a buyer reference or order reference must be present. This app
  // stores no separate buyer reference, so the invoice number stands in — the buyer's package
  // shows it verbatim, which is also the reference a Dutch customer actually quotes when paying.
  if (opts?.peppol) root.ele(NS.cbc, "BuyerReference").txt(header.invoice_number!.trim());

  // ── [CREDIT-REF] BillingReference (BG-3) — which invoice this creditnota corrects ──
  // By UBL sequence it sits here, after BuyerReference and before the parties. Best-effort: a
  // caller that knows the original passes it; a creditnota without one carries no reference,
  // exactly the file it always was.
  if (isCreditNote && header.original_invoice_number?.trim()) {
    const origRef = root.ele(NS.cac, "BillingReference").ele(NS.cac, "InvoiceDocumentReference");
    origRef.ele(NS.cbc, "ID").txt(header.original_invoice_number.trim());
    const origDate = toUblDate(header.original_invoice_date ?? null);
    if (origDate) origRef.ele(NS.cbc, "IssueDate").txt(origDate);
  }

  // ── AccountingSupplierParty (the ZZP'er) ──
  const supParty = root
    .ele(NS.cac, "AccountingSupplierParty")
    .ele(NS.cac, "Party");
  // [SI-UBL] EndpointID sits FIRST inside Party by schema order. Supplier: KVK, EAS 0106.
  if (opts?.peppol) supParty.ele(NS.cbc, "EndpointID", { schemeID: "0106" }).txt(supplier.kvk_number!.trim());
  supParty.ele(NS.cac, "PartyName").ele(NS.cbc, "Name").txt(sName);
  const supAddr = supParty.ele(NS.cac, "PostalAddress");
  if (supplier.address?.trim()) supAddr.ele(NS.cbc, "StreetName").txt(supplier.address.trim());
  if (supplier.city?.trim()) supAddr.ele(NS.cbc, "CityName").txt(supplier.city.trim());
  if (supplier.postal_code?.trim()) supAddr.ele(NS.cbc, "PostalZone").txt(supplier.postal_code.trim());
  supAddr.ele(NS.cac, "Country").ele(NS.cbc, "IdentificationCode").txt("NL");
  // VAT scheme
  const supTax = supParty.ele(NS.cac, "PartyTaxScheme");
  supTax.ele(NS.cbc, "CompanyID").txt(supplier.btw_number!.trim());
  supTax.ele(NS.cac, "TaxScheme").ele(NS.cbc, "ID").txt("VAT");
  // Legal entity + KVK
  const supLegal = supParty.ele(NS.cac, "PartyLegalEntity");
  supLegal.ele(NS.cbc, "RegistrationName").txt(sName);
  supLegal.ele(NS.cbc, "CompanyID").txt(supplier.kvk_number!.trim());

  // ── AccountingCustomerParty (the client) ──
  const cusParty = root
    .ele(NS.cac, "AccountingCustomerParty")
    .ele(NS.cac, "Party");
  // [SI-UBL] Buyer electronic address (BT-49): their BTW-nummer under the EAS code of ITS OWN
  // country — 9944 for an NL number, 9930 for a DE one ([SI-UBL-EAS]). Guarded above: peppol
  // mode refused the document already when the number is absent or its country unmapped. The
  // VALUE is the normalized number: "DE 123.456.789" as typed can never match the registered
  // participant "9930:de123456789" — the raw form validates and is undeliverable at once.
  if (opts?.peppol) cusParty.ele(NS.cbc, "EndpointID", { schemeID: buyerPeppol!.eas }).txt(buyerPeppol!.value);
  cusParty
    .ele(NS.cac, "PartyName")
    .ele(NS.cbc, "Name")
    .txt(header.client_name?.trim() || "Onbekend");
  const cusAddr = cusParty.ele(NS.cac, "PostalAddress");
  // [KLANT-EXTRA] The owner's free lines under the customer's name, on the SAME document this
  // XML claims to be. EN 16931 gives a buyer address exactly two slots beyond the street:
  // BT-51 (AdditionalStreetName) and BT-163 (one cac:AddressLine) — so line 1 takes BT-51 and
  // lines 2+3 share BT-163, joined. Order is not free in UBL 2.1: AdditionalStreetName sits
  // right after StreetName, AddressLine after PostalZone and BEFORE Country — on the wrong
  // spot the file is not schema-valid and never reaches the desk these lines exist for.
  const extraRegels = clientExtraLines(header);
  if (header.client_address?.trim()) cusAddr.ele(NS.cbc, "StreetName").txt(header.client_address.trim());
  if (extraRegels[0]) cusAddr.ele(NS.cbc, "AdditionalStreetName").txt(extraRegels[0]);
  if (header.client_city?.trim()) cusAddr.ele(NS.cbc, "CityName").txt(header.client_city.trim());
  if (header.client_postal_code?.trim()) cusAddr.ele(NS.cbc, "PostalZone").txt(header.client_postal_code.trim());
  if (extraRegels.length > 1) {
    cusAddr.ele(NS.cac, "AddressLine").ele(NS.cbc, "Line").txt(extraRegels.slice(1).join(", "));
  }
  // [KOPER-LAND] BT-55 is the buyer's country, and it was the literal "NL" on every export.
  //
  // That is not a harmless default here, because THIS SAME CALL decides the reverse charge on the
  // buyer being somewhere else: documentIsReverseCharged is true only for a non-NL EU VAT number.
  // So the file stated, in one breath, buyer VAT DE123456789 · buyer country NL · category AE —
  // a document that contradicts itself about the one fact the tax treatment rests on (art. 35a
  // lid 1 sub e). The app already knew better one module away: the ICP-opgaaf derives DE from this
  // very field.
  //
  // The VAT number is the only country evidence on the row — there is no country column on
  // clients or invoices — so it is what this reads, and NL remains the fallback for a customer
  // without one. That keeps every domestic invoice byte-identical to what it was.
  cusAddr.ele(NS.cac, "Country").ele(NS.cbc, "IdentificationCode").txt(buyerCountryCode(header.client_btw_number));
  if (header.client_btw_number?.trim()) {
    const cusTax = cusParty.ele(NS.cac, "PartyTaxScheme");
    cusTax.ele(NS.cbc, "CompanyID").txt(header.client_btw_number.trim());
    cusTax.ele(NS.cac, "TaxScheme").ele(NS.cbc, "ID").txt("VAT");
  }
  // [SI-UBL] BT-44 (buyer name) lives in PartyLegalEntity/RegistrationName under BIS — the
  // PartyName above is not where a BIS validator looks for it.
  if (opts?.peppol) {
    cusParty.ele(NS.cac, "PartyLegalEntity").ele(NS.cbc, "RegistrationName").txt(header.client_name?.trim() || "Onbekend");
  }

  // ── PaymentMeans (IBAN) — optional, before TaxTotal ──
  if (supplier.iban?.trim()) {
    const pm = root.ele(NS.cac, "PaymentMeans");
    pm.ele(NS.cbc, "PaymentMeansCode").txt("30"); // 30 = credit transfer
    // [CREDIT-VERVALDATUM] BT-9 on a credit note lives HERE — CreditNote-2 has no cbc:DueDate.
    // Order is fixed: PaymentDueDate directly after PaymentMeansCode, before the account.
    if (isCreditNote && dueDate) pm.ele(NS.cbc, "PaymentDueDate").txt(dueDate);
    pm.ele(NS.cac, "PayeeFinancialAccount").ele(NS.cbc, "ID").txt(supplier.iban.trim());
  } else if (isCreditNote && dueDate) {
    // [CREDIT-VERVALDATUM] Without an IBAN there is no PaymentMeans to carry BT-9, so the date is
    // dropped — a fact, and the warnings channel exists for exactly this kind of fact.
    warnings.push("Creditnota carries a due date, but without a supplier IBAN there is no PaymentMeans to hold it — the date is not in the XML.");
  }

  // ── AllowanceCharge (document-level discount, one per tax GROUP it reduces) ──
  // [KORTING] Volgorde is niet vrij in UBL: AllowanceCharge staat vóór TaxTotal. Op de verkeerde
  // plek is het bestand niet schemavalide en komt het niet door de eerste poort heen.
  //
  // [KORTING-CATEGORIE] The allowance carries the category of the GROUP it actually reduces, and
  // offByGroup already knows that mapping to the cent. Stamping the RATE's default category was
  // wrong on an art.-11 invoice: the discount reduced the E group while its TaxCategory said Z —
  // BR-Z-01 then demands a Z breakdown that does not exist, and the file is refused over a label
  // its own amounts contradict. (On a reverse-charged invoice the same rule yields AE, as before.)
  const emitAllowance = (amount: number, category: UblTaxCategory, rate: number) => {
    const ac = root.ele(NS.cac, "AllowanceCharge");
    ac.ele(NS.cbc, "ChargeIndicator").txt("false"); // false = korting, true = toeslag
    ac.ele(NS.cbc, "AllowanceChargeReason").txt("Korting");
    ac.ele(NS.cbc, "Amount", { currencyID: EUR }).txt(money(amount));
    const acCat = ac.ele(NS.cac, "TaxCategory");
    acCat.ele(NS.cbc, "ID").txt(category);
    acCat.ele(NS.cbc, "Percent").txt(String(rate));
    acCat.ele(NS.cac, "TaxScheme").ele(NS.cbc, "ID").txt("VAT");
  };
  const ratesDistributed = new Set<number>();
  for (const [i] of offByGroup) ratesDistributed.add(rawGroups[i].rate);
  for (const [i, part] of offByGroup) emitAllowance(part, rawGroups[i].category, rawGroups[i].rate);
  // A rate whose allowance found no group (the sign filter above) still has to appear, or
  // AllowanceTotalAmount stops equalling the sum of its parts (BR-CO-11).
  for (const a of kortingUitkomst.allowances) {
    if (ratesDistributed.has(a.rate)) continue;
    emitAllowance(a.amount, catFor(a.rate, docReverseCharged ? "reverse_charge" : undefined), a.rate);
  }

  // ── TaxTotal (one TaxSubtotal per rate) ──
  const taxTotal = root.ele(NS.cac, "TaxTotal");
  taxTotal.ele(NS.cbc, "TaxAmount", { currencyID: EUR }).txt(money(totalTax));
  for (const g of groups) {
    const sub = taxTotal.ele(NS.cac, "TaxSubtotal");
    sub.ele(NS.cbc, "TaxableAmount", { currencyID: EUR }).txt(money(g.taxable));
    sub.ele(NS.cbc, "TaxAmount", { currencyID: EUR }).txt(money(g.tax));
    const cat = sub.ele(NS.cac, "TaxCategory");
    cat.ele(NS.cbc, "ID").txt(g.category);
    cat.ele(NS.cbc, "Percent").txt(String(g.rate));
    // [E-FACTUUR] BR-E-10 / BR-AE-10: an exempt or reverse-charged subtotal MUST carry a reason.
    // The element order matters — cbc:TaxExemptionReason sits between Percent and cac:TaxScheme in
    // the UBL sequence, and a document with the right content in the wrong order is rejected just
    // as hard as one with the wrong content.
    // [KOR-E] A KOR exemption names its own article — art. 11 would claim a different law.
    // [AE-GROND] `docReverseCharged` IS the intracommunautaire case and nothing else:
    // isReverseChargedInvoice returns true only for a buyer with an EU (non-NL) VAT number on a
    // zero-BTW factuur outside the KOR. A DOMESTIC verlegging reaches AE by the other road — the
    // owner writing "btw verlegd" on a line — and keeps art. 12 lid 5, which is its real ground.
    const reason = g.korExempt ? KOR_EXEMPTION_REASON : taxExemptionReason(g.category, docReverseCharged);
    if (reason) cat.ele(NS.cbc, "TaxExemptionReason").txt(reason);
    cat.ele(NS.cac, "TaxScheme").ele(NS.cbc, "ID").txt("VAT");
  }

  // ── LegalMonetaryTotal ──
  const lmt = root.ele(NS.cac, "LegalMonetaryTotal");
  lmt.ele(NS.cbc, "LineExtensionAmount", { currencyID: EUR }).txt(money(lineExtensionTotal));
  // [KORTING] TaxExclusiveAmount = regels − kortingen. Zonder AllowanceTotalAmount ernaast klopt
  // de optelling van het bestand niet met zichzelf en wordt het geweigerd (BR-CO-10, BR-CO-13).
  lmt.ele(NS.cbc, "TaxExclusiveAmount", { currencyID: EUR }).txt(money(taxExclusive));
  lmt.ele(NS.cbc, "TaxInclusiveAmount", { currencyID: EUR }).txt(money(taxInclusive));
  if (allowanceTotal > 0) {
    lmt.ele(NS.cbc, "AllowanceTotalAmount", { currencyID: EUR }).txt(money(allowanceTotal));
  }
  lmt.ele(NS.cbc, "PayableAmount", { currencyID: EUR }).txt(money(taxInclusive));

  // ── InvoiceLine (1..n) ──
  effLines.forEach((l, i) => {
    const rate = Number(l.btw_rate ?? 0);
    const ex = round2(Number(l.line_total ?? 0));
    const line = root.ele(NS.cac, isCreditNote ? "CreditNoteLine" : "InvoiceLine");
    line.ele(NS.cbc, "ID").txt(String(i + 1));
    // [UNIT] Hier stond `unitCode: "C62"` HARDGECODEERD op elke regel. C62 betekent
    // "one / stuk" — juist voor een product, en fout voor alles wat je per uur, per m² of per
    // kilometer levert: "2 uur arbeid" ging de deur uit als "2 stuks". Het BEDRAG klopte
    // altijd, maar de e-factuur beschreef iets anders dan er geleverd was, en dat is het
    // document dat telt bij een controle of een geschil.
    //
    // Peppol BIS Billing 3.0 eist een code uit UN/ECE Rec 20 rev. 11; toUnitCode() is de enige
    // plek waar die keuze wordt gemaakt, en valt terug op C62 zodra hij het niet zeker weet.
    // Daardoor verandert geen enkele bestaande factuur van betekenis.
    //
    // [MIN-REGEL] The minus of a credit line lives in the QUANTITY, and in nothing else.
    //
    // A supplier who settles a return on the next invoice writes one negative line among the
    // ordinary ones (ATAPACK 26304787: −3 × € 23,95 = −71,85). EN 16931 rule BR-27 says the item
    // net price shall not be negative, and an access point REFUSES a file that breaks it. So the
    // same line can be stored two ways, and only one of them can be delivered:
    //
    //     quantity −3, price 23.95    → −71,85   deliverable
    //     quantity 3, price −23.95    → −71,85   refused by BR-27
    //
    // Both look identical on the PDF, which is what makes the second one dangerous: the invoice
    // is right on paper and never arrives electronically. This app's line editor now refuses a
    // negative price outright (negative-line.ts), but rows already in the database were typed
    // before that — a "Statiegeld retour" line at 1 × € −3,86 is exactly this shape — and an
    // imported line carries whatever the source put in it.
    //
    // So the sign is moved here, once, for both fields: whatever the row says, the document says
    // −3 × 23,95. The arithmetic the validator checks (PEPPOL-EN16931-R120: line amount =
    // quantity × price ÷ base quantity) gives back the same signed line total either way, so
    // LineExtensionAmount keeps its minus and the totals are untouched. A line whose price was
    // already positive is emitted byte-for-byte as before.
    const storedQuantity = Number(l.quantity ?? 1);
    const storedPrice = round2(Number(l.unit_price ?? 0));
    const priceCarriedTheMinus = storedPrice < 0;
    const aantal = priceCarriedTheMinus ? -storedQuantity : storedQuantity;
    const stuksprijs = Math.abs(storedPrice);
    line.ele(NS.cbc, isCreditNote ? "CreditedQuantity" : "InvoicedQuantity", { unitCode: toUnitCode(l.unit) }).txt(qty(aantal));
    line.ele(NS.cbc, "LineExtensionAmount", { currencyID: EUR }).txt(money(ex));

    // [REGEL-KORTING] Wat de regel kostte VOORDAT haar eigen korting eraf ging.
    //
    // Gerekend met de volle opgeslagen prijs, niet met de afgeronde stuksprijs hieronder: dit is
    // het bedrag dat de schrijfroute als bruto hanteerde, en de korting moet het verschil met het
    // opgeslagen regeltotaal exact overbruggen. Zonder korting is dit letterlijk `ex` en verandert
    // er niets aan het bestand dat deze factuur altijd al opleverde.
    const brutoRegel = round2(aantal * Math.abs(Number(l.unit_price ?? 0)));
    const regelKorting = parseDiscount(l.discount_type, l.discount_value);
    // Afgeleid uit de OPGESLAGEN getallen, niet opnieuw uitgerekend uit het percentage. Wijkt een
    // oude rij een cent af, dan telt dit bestand nog steeds op — en optellen is hier geen
    // schoonheid maar de voorwaarde om afgeleverd te worden (PEPPOL-EN16931-R120 rekent
    // aantal × prijs − korting na en vergelijkt het met het regelbedrag).
    const kortingBedrag = regelKorting ? round2(brutoRegel - ex) : 0;

    if (kortingBedrag !== 0) {
      // BG-27, en de plek is niet vrij: in UBL 2.1 staat cac:AllowanceCharge NA
      // LineExtensionAmount en VÓÓR cac:Item. Op een andere plek is het bestand niet
      // schemavalide en komt het niet door de eerste poort heen.
      //
      // Géén cac:TaxCategory hier, anders dan bij de documentkorting: een regelkorting erft het
      // tarief van de regel waar hij op staat (ClassifiedTaxCategory hieronder). EN 16931 kent
      // BG-27 dan ook geen eigen btw-categorie toe.
      const ac = line.ele(NS.cac, "AllowanceCharge");
      ac.ele(NS.cbc, "ChargeIndicator").txt("false"); // false = korting, true = toeslag
      ac.ele(NS.cbc, "AllowanceChargeReason").txt("Korting");
      if (regelKorting?.type === "percent") {
        // BT-138. Alleen bij een percentage: bij een vast bedrag zou elk getal hier een
        // percentage suggereren dat niemand heeft afgesproken.
        ac.ele(NS.cbc, "MultiplierFactorNumeric").txt(String(regelKorting.value));
      }
      ac.ele(NS.cbc, "Amount", { currencyID: EUR }).txt(money(kortingBedrag));
      // BT-137 — waar de korting overheen gaat. Samen met Amount is de regel naleesbaar zonder
      // dat iemand hem hoeft terug te rekenen.
      ac.ele(NS.cbc, "BaseAmount", { currencyID: EUR }).txt(money(round2(ex + kortingBedrag)));
    }

    const item = line.ele(NS.cac, "Item");
    const desc = l.description?.trim() || "Artikel";
    item.ele(NS.cbc, "Description").txt(desc);
    item.ele(NS.cbc, "Name").txt(desc);
    const cat = item.ele(NS.cac, "ClassifiedTaxCategory");
    // [E-FACTUUR] The LINE's own category, so it matches the subtotal its amount was counted into.
    // ClassifiedTaxCategory carries no exemption reason — that lives on the TaxSubtotal above.
    cat.ele(NS.cbc, "ID").txt(catFor(rate, lineVatKind(l, docReverseCharged)));
    cat.ele(NS.cbc, "Percent").txt(String(rate));
    cat.ele(NS.cac, "TaxScheme").ele(NS.cbc, "ID").txt("VAT");
    // [PRIJS-RECONSTRUEERBAAR] De prijs moet het regelbedrag OPLEVEREN.
    //
    // Hier stond alleen `PriceAmount = money(unit_price)`, en money() rondt af op centen. Bij een
    // prijs die geen rond bedrag is — en dat is elke regel van iemand die zijn prijzen INCLUSIEF
    // btw intypt — zei het bestand dus:
    //
    //     InvoicedQuantity     150
    //     PriceAmount          0.83        150 x 0,83 = 124,50
    //     LineExtensionAmount  123.85      maar de regel zegt 123,85
    //
    // Dat is 65 cent verschil op één regel, in het document dat naar het access point gaat. Peppol
    // BIS 3.0 rekent die vermenigvuldiging na (PEPPOL-EN16931-R120: regelbedrag = aantal x prijs
    // gedeeld door het basisaantal) en weigert het bestand. En los van elke regel: een mens die de
    // factuur naleest komt op een ander getal uit dan de factuur.
    //
    // UBL heeft hier `cbc:BaseQuantity` voor — het aantal eenheden waarvoor de prijs geldt. Zodra
    // de afgeronde stuksprijs het regelbedrag niet reproduceert, wordt de prijs uitgedrukt PER
    // REGEL: "EUR 123,85 per 150 stuks". Dat is exact per constructie, voor elk aantal en elke
    // breuk, want het is dezelfde deling in beide richtingen.
    //
    // De gewone factuur verandert niet. Is de stuksprijs al een rond bedrag — verreweg de meeste
    // regels — dan klopt de vermenigvuldiging en blijft er precies staan wat er stond, zonder
    // BaseQuantity. Alleen de regel die anders zou liegen, krijgt de andere vorm.
    //
    // [MIN-REGEL] The fallback branch carries the same rule, and it did not get it for free.
    //
    // The exact branch above reproduces the sign by itself: −3 × 23,95 = −71,85, so the price
    // stays 23,95 and only the quantity is negative. This one wrote `PriceAmount = ex`, and on a
    // credit line `ex` is a negative amount — a BR-27 violation on precisely the lines that need
    // this form (a fractional price on a return). Both fields are therefore expressed as
    // magnitudes: the sign is already in InvoicedQuantity, and (quantity ÷ BaseQuantity) × price
    // hands the signed line total back. PEPPOL-EN16931-R121 also requires BaseQuantity itself to
    // be a positive number, which is the same abs().
    //
    // [REGEL-KORTING] De vermenigvuldiging die de validator narekent gaat over het BRUTObedrag.
    //
    // R120 luidt voluit: regelbedrag = aantal × prijs ÷ basisaantal + toeslagen − kortingen. De
    // korting staat hierboven als AllowanceCharge, dus de prijs moet het bedrag VÓÓR die korting
    // opleveren — en dat is precies de prijs die de ondernemer met zijn klant afsprak. De vorige
    // versie vergeleek met `ex` (nu het NETTO bedrag), en dat zou op elke gekorte regel de
    // uitwijkvorm hieronder hebben gekozen: een verzonnen stuksprijs die het verlaagde bedrag
    // oplevert, met de korting er nog eens naast. Twee keer korting in één regel, en een prijs op
    // de e-factuur die nergens is overeengekomen.
    //
    // Het bedrag dat de prijs moet OPLEVEREN is dus het regelbedrag plus de korting die we
    // hierboven al apart hebben gezet — niet het bruto dat uit aantal × prijs volgt. Dat verschil
    // is het vangnet: is er een regel waarvan het opgeslagen totaal om wat voor reden dan ook niet
    // gelijk is aan aantal × prijs, en staat er GEEN korting bij die het verklaart, dan valt hij
    // hieronder terug op de vorm die per definitie klopt. Zo bleef dit bestand altijd al
    // aflevernaar, en dat mag een nieuwe kolom niet ongedaan maken.
    //
    // Zonder korting is dit letterlijk `ex` en staat hier exact de test die er altijd stond.
    const teReproduceren = round2(ex + kortingBedrag);
    const price = line.ele(NS.cac, "Price");
    // [R120] Beslis met het aantal ZOALS HET WORDT AFGEDRUKT — de validator kent alleen dat.
    const aantalGedrukt = Number(qty(aantal));
    if (round2(aantalGedrukt * stuksprijs) === teReproduceren) {
      price.ele(NS.cbc, "PriceAmount", { currencyID: EUR }).txt(money(stuksprijs));
    } else {
      price.ele(NS.cbc, "PriceAmount", { currencyID: EUR }).txt(money(Math.abs(teReproduceren)));
      // Zelfde eenheidscode als InvoicedQuantity — anders vergelijkt de validator appels met peren.
      price.ele(NS.cbc, "BaseQuantity", { unitCode: toUnitCode(l.unit) }).txt(qty(Math.abs(aantal)));
    }
  });

  const xml = root.end({ prettyPrint: true });
  return { xml, warnings };
}