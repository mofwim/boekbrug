// src/lib/icp.ts
// [ICP] Intracommunautaire prestaties — rubriek 3b + de ICP-opgaaf. Pure; no I/O.
// Run: npx tsx src/lib/icp.test.ts
//
// Selling to a business in another EU country is not a 0%-sale like any other. Two things follow
// from it, and the app did neither:
//
//   1. RUBRIEK 3b. The turnover belongs in "Leveringen naar landen binnen de EU", not in 1e
//      ("0% of niet bij u belast"). Both carry €0 BTW, so the amount to pay is identical — but
//      the Belastingdienst cross-checks 3b against the ICP-opgaaf, and a 3b of zero next to an
//      ICP that lists customers is precisely the mismatch that starts a letter.
//
//   2. THE ICP-OPGAAF. A SEPARATE declaration, per customer VAT number, of what you supplied
//      them in the period. It is not part of the BTW-aangifte and nothing else reminds you of
//      it. Forgetting it is a verzuimboete — for a declaration whose entire content the app can
//      already assemble from the invoices.
//
// SAFETY PROPERTY, deliberately: moving turnover from 1e to 3b can never change what the owner
// pays. Both rubrieken carry €0 BTW, so 5a, 5b and 5g are untouched by everything in this file.
// It corrects WHERE the turnover is stated and surfaces an obligation — it never restates a
// figure that costs or saves money.
//
// A customer is intra-EU when they carry a VALID-SHAPED VAT number of another member state. No
// VAT number ⇒ a consumer ⇒ not ICP (that is OSS/local VAT, a different regime this app does not
// compute). NL ⇒ domestic. That single rule is also the reason the app must not guess from a
// country name or an address: the VAT number is the thing the opgaaf is keyed on.

/**
 * Number of characters AFTER the country prefix, per member state. Ranges, not formats: a length
 * check catches the typo the owner actually makes (a digit dropped, a number pasted twice) without
 * telling someone their perfectly valid number is wrong — which is the worse failure of the two.
 * NL is absent on purpose: a Dutch customer is domestic, never ICP.
 */
export const EU_VAT_LENGTH: Record<string, [number, number]> = {
  AT: [9, 9],   // U + 8 digits
  BE: [10, 10],
  BG: [9, 10],
  CY: [9, 9],
  CZ: [8, 10],
  DE: [9, 9],
  DK: [8, 8],
  EE: [9, 9],
  EL: [9, 9],   // Greece files as EL, not GR
  ES: [9, 9],
  FI: [8, 8],
  FR: [11, 11],
  HR: [11, 11],
  HU: [8, 8],
  IE: [8, 9],
  IT: [11, 11],
  LT: [9, 12],
  LU: [8, 8],
  LV: [11, 11],
  MT: [8, 8],
  PL: [10, 10],
  PT: [9, 9],
  RO: [2, 10],
  SE: [12, 12],
  SI: [8, 8],
  SK: [10, 10],
};

/** Greece writes GR on paper and EL on the opgaaf — normalise so both reach the same customer. */
const PREFIX_ALIAS: Record<string, string> = { GR: "EL" };

/** Strip everything the eye ignores (spaces, dots, dashes) and upper-case. */
export function normalizeVatNumber(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/[\s.\-/]/g, "").toUpperCase();
}

export type VatShape =
  | { kind: "eu"; country: string; vat: string }        // another member state, plausible length
  | { kind: "eu_suspect"; country: string; vat: string } // EU prefix, length that cannot be right
  | { kind: "domestic" }                                 // NL — never ICP
  | { kind: "none" };                                    // absent, or not an EU prefix at all

/**
 * Classify a customer's VAT number. Deliberately conservative: anything that is not clearly the
 * VAT number of ANOTHER member state comes back as "none", because a wrong entry in the ICP is a
 * correction letter, while a missing one the owner can still be told about.
 */
export function classifyVatNumber(raw: string | null | undefined): VatShape {
  const v = normalizeVatNumber(raw);
  if (v.length < 3) return { kind: "none" };
  const rawPrefix = v.slice(0, 2);
  if (!/^[A-Z]{2}$/.test(rawPrefix)) return { kind: "none" };
  const country = PREFIX_ALIAS[rawPrefix] ?? rawPrefix;
  if (country === "NL") return { kind: "domestic" };
  const range = EU_VAT_LENGTH[country];
  if (!range) return { kind: "none" };
  const body = v.slice(2);
  // The body must be alphanumeric — a number with punctuation left in it after normalising is
  // not a VAT number, it is a note somebody typed into the field.
  if (!/^[A-Z0-9]+$/.test(body)) return { kind: "eu_suspect", country, vat: v };
  if (body.length < range[0] || body.length > range[1]) return { kind: "eu_suspect", country, vat: v };
  return { kind: "eu", country, vat: v };
}

/** One sales invoice, as much of it as the ICP needs. */
export interface IcpInvoice {
  invoiceNumber: string | null;
  clientName: string | null;
  clientVatNumber: string | null;
  direction: "incoming" | "outgoing" | null;
  status: string | null;
  totalExBtw: number | null;
  btwAmount: number | null;
}

/** One line of the ICP-opgaaf: everything the form asks for, per customer. */
export interface IcpLine {
  vatNumber: string;        // normalised, as it goes on the opgaaf
  country: string;          // the 2-letter member state
  clientName: string | null;
  amountExBtw: number;      // net of any creditnota (they carry negative amounts)
  invoiceCount: number;
}

/** An invoice that looks intra-EU but cannot be listed as it stands. */
export interface IcpProblem {
  kind: "btw_charged" | "suspect_vat";
  invoiceNumber: string | null;
  clientName: string | null;
  vatNumber: string;
  detail: string;
}

export interface IcpResult {
  lines: IcpLine[];         // sorted by amount, biggest first — the opgaaf's own reading order
  totalExBtw: number;       // Σ amountExBtw — this is rubriek 3b
  problems: IcpProblem[];
}

// Sales statuses whose turnover the ledger already counts. Identical to the aangifte's own
// OUT_OK: 3b may never contain a euro that 1a/1b/1e did not, or the rubrieken stop adding up.
const DECLARED_OUTGOING = new Set(["paid", "sent", "overdue"]);

const EMPTY: IcpResult = { lines: [], totalExBtw: 0, problems: [] };

/**
 * Build the ICP-opgaaf (and therefore rubriek 3b) from the period's sales invoices. Pure.
 *
 * An invoice is listed when it is a declared outgoing sale, to a customer with a plausible VAT
 * number of another member state, carrying NO BTW. An intra-EU sale on which BTW was charged is
 * NOT listed — that turnover is already sitting in 1a/1b with its BTW, and quietly moving it to
 * 3b would drop that BTW out of 5a. It is reported as a problem instead, which is the honest
 * version: either the customer's number is wrong, or the invoice is.
 *
 * Under KOR there are no intra-EU supplies to report in this sense, so it short-circuits.
 */
export function buildIcp(args: { invoices: IcpInvoice[]; korActive?: boolean }): IcpResult {
  if (args.korActive === true) return EMPTY;

  const byVat = new Map<string, IcpLine>();
  const problems: IcpProblem[] = [];

  for (const i of args.invoices) {
    if (i.direction !== "outgoing") continue;
    if (!DECLARED_OUTGOING.has(i.status ?? "")) continue;

    const shape = classifyVatNumber(i.clientVatNumber);
    if (shape.kind === "domestic" || shape.kind === "none") continue;

    if (shape.kind === "eu_suspect") {
      problems.push({
        kind: "suspect_vat",
        invoiceNumber: i.invoiceNumber,
        clientName: i.clientName,
        vatNumber: shape.vat,
        detail:
          `Het BTW-nummer ${shape.vat} heeft niet de lengte die ${shape.country} gebruikt. ` +
          "Een ICP-opgaaf met een onjuist nummer wordt afgekeurd — controleer het bij de klant of via VIES.",
      });
      continue;
    }

    const btw = Math.abs(Number(i.btwAmount) || 0);
    if (btw >= 0.005) {
      problems.push({
        kind: "btw_charged",
        invoiceNumber: i.invoiceNumber,
        clientName: i.clientName,
        vatNumber: shape.vat,
        detail:
          "Er is BTW berekend op een verkoop aan een EU-ondernemer. Bij een intracommunautaire levering " +
          "verleg je de BTW (0%) en meld je hem in de ICP-opgaaf. Klopt het BTW-nummer, dan hoort er geen " +
          "BTW op de factuur; klopt het niet, dan is dit geen ICP-levering.",
      });
      continue; // its turnover stays in 1a/1b, where its BTW already is
    }

    const ex = Number(i.totalExBtw) || 0;
    const existing = byVat.get(shape.vat);
    if (existing) {
      existing.amountExBtw += ex;
      existing.invoiceCount += 1;
      // A creditnota carries no client name of its own in some imports; keep the first real one.
      if (!existing.clientName && i.clientName) existing.clientName = i.clientName;
    } else {
      byVat.set(shape.vat, {
        vatNumber: shape.vat,
        country: shape.country,
        clientName: i.clientName,
        amountExBtw: ex,
        invoiceCount: 1,
      });
    }
  }

  // A customer whose invoices and creditnotas cancel out to zero has nothing to report, and a
  // zero line on the opgaaf is a line the Belastingdienst asks about. Keep negatives though —
  // a credit that lands in a later quarter than its invoice is a real, reportable correction.
  const lines = [...byVat.values()]
    .filter((l) => Math.abs(l.amountExBtw) >= 0.5)
    .sort((a, b) => Math.abs(b.amountExBtw) - Math.abs(a.amountExBtw));
  const totalExBtw = lines.reduce((s, l) => s + l.amountExBtw, 0);
  return { lines, totalExBtw, problems };
}

// ── The purchase mirror: rubriek 4a/4b ────────────────────────────────────────────────────────
//
// Buying from a business in another EU country shifts the BTW to YOU: the supplier invoices 0%
// and you declare the Dutch BTW in rubriek 4b, then deduct the same amount in 5b. For a fully
// deductible entrepreneur those two cancel and 5g does not move — which is exactly why this app
// does NOT compute them. Deciding WHICH Dutch rate applies to a foreign purchase is a judgement,
// and for a KOR or partly-exempt owner the deduction is not available, so the two would stop
// cancelling and the app would have invented a bill.
//
// What the app CAN do is stop making the accountant hunt. Until now the concept said only "there
// are EU purchases" — true, unhelpful, and the accountant still had to page through the invoices
// to find them. This lists them: supplier, VAT number, amount. No figure is claimed; the work is
// simply laid out for the person who does it.

/** One foreign purchase the accountant must place in 4a/4b. */
export interface ForeignPurchase {
  invoiceNumber: string | null;
  supplierName: string | null;
  vatNumber: string;
  country: string;
  amountExBtw: number;
  /** true when the supplier already charged BTW — then it is probably NOT a verlegde inkoop. */
  btwCharged: boolean;
}

export interface ForeignPurchaseResult {
  purchases: ForeignPurchase[];
  totalExBtw: number;
}

// Purchase statuses the ledger counts — the same allow-list as everywhere else, so this listing
// can never name an invoice the quarter's figures do not include.
const DECLARED_INCOMING = new Set(["received", "paid"]);

/**
 * List the period's purchases from suppliers in other EU member states. Pure, and deliberately
 * a LISTING rather than a calculation — see the note above for why 4a/4b is not computed.
 */
export function buildForeignPurchases(args: { invoices: IcpInvoice[] }): ForeignPurchaseResult {
  const purchases: ForeignPurchase[] = [];
  for (const i of args.invoices) {
    if (i.direction !== "incoming") continue;
    if (!DECLARED_INCOMING.has(i.status ?? "")) continue;
    const shape = classifyVatNumber(i.clientVatNumber);
    // A suspect number still names a foreign supplier — the accountant needs the invoice either
    // way, and a listing (unlike the ICP-opgaaf) is not something that can be rejected.
    if (shape.kind !== "eu" && shape.kind !== "eu_suspect") continue;
    purchases.push({
      invoiceNumber: i.invoiceNumber,
      supplierName: i.clientName,
      vatNumber: shape.vat,
      country: shape.country,
      amountExBtw: Number(i.totalExBtw) || 0,
      btwCharged: Math.abs(Number(i.btwAmount) || 0) >= 0.005,
    });
  }
  purchases.sort((a, b) => Math.abs(b.amountExBtw) - Math.abs(a.amountExBtw));
  return { purchases, totalExBtw: purchases.reduce((s, p) => s + p.amountExBtw, 0) };
}

/** The honest Dutch note, naming what the accountant has to place. */
export function foreignPurchaseNote(r: ForeignPurchaseResult): string | null {
  if (r.purchases.length === 0) return null;
  const n = r.purchases.length;
  const eur = `€${Math.round(r.totalExBtw).toLocaleString("nl-NL")}`;
  const labels = r.purchases.slice(0, 5).map((p) => p.invoiceNumber ?? p.supplierName ?? "?").filter(Boolean).join(", ");
  const more = n > 5 ? ` (+${n - 5} meer)` : "";
  const charged = r.purchases.filter((p) => p.btwCharged).length;
  return (
    `Inkopen uit de EU: ${n === 1 ? "1 inkoopfactuur" : `${n} inkoopfacturen`} van ${eur} van een leverancier ` +
    `in een andere lidstaat${labels ? ` (${labels}${more})` : ""}. Hierbij is de BTW naar jou verlegd: die hoort in ` +
    "rubriek 4b, met dezelfde BTW als aftrek in 5b. Dit concept berekent die verlegging NIET — welk Nederlands " +
    "tarief geldt is een beoordeling, en bij KOR of vrijgestelde omzet vallen de twee niet tegen elkaar weg. " +
    (charged > 0
      ? `Let op: op ${charged === 1 ? "1 van deze facturen" : `${charged} van deze facturen`} is al BTW berekend — dan is het waarschijnlijk geen verlegde inkoop. `
      : "") +
    "Je boekhouder plaatst dit."
  );
}

/** [ICP] The foreign-purchase listing as a CSV for the accountant's package. */
export function buildForeignPurchaseCsv(r: ForeignPurchaseResult, periodLabel: string): string {
  const EUR = (n: number) => n.toFixed(2).replace(".", ",");
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const L: string[] = [];
  L.push(`BoekBrug — EU-inkopen ${periodLabel} (rubriek 4a/4b)`);
  L.push("LET OP: dit is een LIJST, geen berekening. De verlegde BTW (4b) en de bijbehorende aftrek (5b) staan NIET in het concept — je boekhouder plaatst ze.");
  L.push("");
  L.push(["Land", "BTW-nummer", "Leverancier", "Factuur", "Bedrag (excl. BTW)", "BTW op factuur?"].map(esc).join(";"));
  for (const p of r.purchases) {
    L.push([p.country, p.vatNumber, p.supplierName ?? "", p.invoiceNumber ?? "", EUR(p.amountExBtw), p.btwCharged ? "ja — controleer" : "nee"].map(esc).join(";"));
  }
  L.push("");
  L.push(["", "", "", "Totaal", EUR(r.totalExBtw), ""].map(esc).join(";"));
  return L.join("\r\n");
}

// ── The sentence that has to be ON the invoice ────────────────────────────────────────────────
//
// Art. 226 punt 11a van richtlijn 2006/112/EG (art. 35a Wet OB): when the CUSTOMER owes the BTW,
// the invoice must carry the words "Btw verlegd". Not a recommendation — an invoice without it is
// formally deficient, and that is the ground on which the 0% gets challenged and the customer's
// own deduction gets refused. Until now the only way it appeared was if the owner happened to
// type it into a line description.
//
// The app already knows exactly when it applies — the same rule the ICP-opgaaf runs on — so it
// can simply say it. Deliberately generic wording: "Btw verlegd" is what the directive asks for
// verbatim, and "intracommunautaire prestatie" covers goods and services alike. Naming a specific
// article (138 for goods, 44/196 for services) would be a guess about which of the two this
// invoice is, and a wrong citation is worse than none.

/** The mandatory reverse-charge sentence for this invoice, or null when it does not apply. */
export function reverseChargeNotice(args: {
  clientVatNumber: string | null | undefined;
  btwAmount: number | null | undefined;
  invoiceType: string | null | undefined;
  korActive?: boolean;
  /** The invoice's own line texts — if the owner already wrote it, we do not say it twice. */
  lineTexts?: Array<string | null | undefined>;
}): string | null {
  // An offerte or pro forma is not a legal invoice and may not carry a BTW statement at all.
  const type = args.invoiceType ?? "factuur";
  if (type !== "factuur" && type !== "creditnota") return null;
  // Under KOR nothing is charged for a different reason entirely; claiming verlegging there
  // would be a statement about a regime the owner is not in.
  if (args.korActive === true) return null;
  // BTW on the invoice means it was NOT shifted to the customer, whatever the VAT number says.
  if (Math.abs(Number(args.btwAmount) || 0) >= 0.005) return null;
  const shape = classifyVatNumber(args.clientVatNumber);
  if (shape.kind !== "eu") return null;
  for (const t of args.lineTexts ?? []) {
    if (/btw\s*verlegd|reverse\s*charge|verleggingsregeling/i.test(String(t ?? ""))) return null;
  }
  return `Btw verlegd — intracommunautaire prestatie. BTW-nummer afnemer: ${shape.vat}.`;
}

/** Below this, rubriek 3b rounds to €0 and there is nothing to state. */
export const ICP_MIN_EUR = 0.5;

/**
 * The honest Dutch note for the concept aangifte and the accountant, or null when there is
 * nothing intra-EU in the period. Says the two things the owner cannot read off the rubrieken:
 * that a SECOND declaration exists, and that this app did not file it.
 */
export function icpNote(r: IcpResult): string | null {
  if (r.lines.length === 0 && r.problems.length === 0) return null;
  const parts: string[] = [];
  if (r.lines.length > 0 && Math.abs(r.totalExBtw) >= ICP_MIN_EUR) {
    const n = r.lines.length;
    const eur = `€${Math.round(r.totalExBtw).toLocaleString("nl-NL")}`;
    parts.push(
      `Intracommunautaire leveringen: ${eur} naar ${n === 1 ? "1 EU-ondernemer" : `${n} EU-ondernemers`} ` +
      "staat in rubriek 3b (niet in 1e). Hierover moet je ook een APARTE ICP-opgaaf doen, per BTW-nummer — " +
      "die is geen onderdeel van de BTW-aangifte en wordt hier NIET ingediend.",
    );
  }
  if (r.problems.length > 0) {
    const n = r.problems.length;
    parts.push(
      `Let op: ${n === 1 ? "1 verkoopfactuur aan een EU-ondernemer kan" : `${n} verkoopfacturen aan EU-ondernemers kunnen`} ` +
      "niet zo in de ICP-opgaaf — er is BTW berekend of het BTW-nummer klopt niet. Controleer deze eerst; " +
      "een afgekeurde opgaaf telt als niet gedaan.",
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * [ICP] The opgaaf as a CSV for the accountant's package: exactly the columns the form asks for,
 * one line per customer. It travels beside the concept aangifte, never inside it — the ICP is a
 * separate declaration and must not read as a rubriek of the BTW-aangifte.
 */
export function buildIcpCsv(r: IcpResult, periodLabel: string): string {
  const EUR = (n: number) => n.toFixed(2).replace(".", ",");
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const L: string[] = [];
  L.push(`BoekBrug — Concept ICP-opgaaf ${periodLabel}`);
  L.push("LET OP: concept op basis van de ingevoerde verkoopfacturen — GEEN ingediende opgaaf. De ICP-opgaaf staat LOS van de BTW-aangifte.");
  L.push("");
  L.push(["Land", "BTW-nummer", "Klant", "Bedrag (excl. BTW)", "Facturen"].map(esc).join(";"));
  for (const l of r.lines) {
    L.push([l.country, l.vatNumber, l.clientName ?? "", EUR(l.amountExBtw), l.invoiceCount].map(esc).join(";"));
  }
  L.push("");
  L.push(["", "", "Totaal (= rubriek 3b)", EUR(r.totalExBtw), ""].map(esc).join(";"));
  if (r.problems.length > 0) {
    L.push("");
    L.push("Eerst controleren — deze facturen kunnen zo niet in de opgaaf:");
    L.push(["Factuur", "Klant", "BTW-nummer", "Waarom"].map(esc).join(";"));
    for (const p of r.problems) {
      L.push([p.invoiceNumber ?? "", p.clientName ?? "", p.vatNumber, p.detail].map(esc).join(";"));
    }
  }
  return L.join("\r\n");
}
