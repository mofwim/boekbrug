// src/lib/aangifte.ts
// [AANGIFTE] Pure mapper: the reconciled financial result -> a CONCEPT BTW-aangifte in
// the exact Belastingdienst rubriek layout (1a/1b/1c/1e, 5a/5b/5g). No I/O, fully
// testable (run: npx tsx src/lib/aangifte.test.ts) — and its test is pinned to a REAL
// accountant filing (Kiwi Food Market, Q1 2026) so the mapping provably reproduces the
// actual form.
//
// THREE HARD RULES (the owner's, honoured literally):
//   1. Every number is DERIVED from data the owner already imported — nothing invented.
//   2. It is a CONCEPT, never a filing. Amounts are only as complete as the uploads, and
//      the notes say exactly what each figure depends on — no false reassurance.
//   3. Whole euros, and 5a is the SUM of the rounded rubrieken (as the Belastingdienst
//      form computes it), so our concept reconciles line-for-line with the accountant's.

import type { FinancialResult } from "./financial-result";

/** Only the parts of the result the aangifte needs. */
export type AangifteInput = Pick<
  FinancialResult,
  "salesByRate" | "btwVoorbelasting" | "cashOmzetZonderBtw"
>;

export interface AangifteCompleteness {
  turnoverDays: number;          // days of dagomzet imported for the period
  quarterDays: number;           // calendar days in the quarter
  incomingInvoiceCount: number;  // purchase invoices feeding 5b (voorbelasting)
  outgoingInvoiceCount: number;  // sales invoices feeding 1a/1b
  hasEuPurchase: boolean;        // an incoming invoice from outside NL (rubriek 4b — not auto-computed)
}

export interface AangifteRow {
  code: "1a" | "1b" | "1c" | "1e";
  label: string;
  omzet: number;                 // whole euros
  btw: number;                   // whole euros (0 for 1e)
}

export interface ConceptAangifte {
  quarterLabel: string;
  rows: AangifteRow[];
  verschuldigd: number;          // 5a — sum of the rounded rubriek BTW
  voorbelasting: number;         // 5b
  saldo: number;                 // 5g — te betalen (>0) of terug te ontvangen (<0)
  cashOmzetZonderBtw: number;    // omzet without a known rate — deliberately NOT in any rubriek
  notes: string[];               // honest limits — what each figure depends on
  isConcept: true;
}

const euro = (n: number) => Math.round(n); // Belastingdienst rounds to whole euros

const RATE_LABEL: Record<string, string> = {
  "1a": "Leveringen/diensten belast met hoog tarief (21%)",
  "1b": "Leveringen/diensten belast met laag tarief (9%)",
  "1c": "Leveringen/diensten belast met overige tarieven, behalve 0%",
  "1e": "Leveringen/diensten belast met 0% of niet bij u belast",
};

/**
 * Map the reconciled result into a concept aangifte. 21% -> 1a, 9% -> 1b, 0% -> 1e, any
 * other non-zero rate -> 1c (aggregated). 5a is the sum of the rounded rubriek BTW so it
 * ties to the paper form; 5b is the documented voorbelasting; 5g = 5a - 5b.
 */
export function buildAangifte(
  input: AangifteInput,
  completeness: AangifteCompleteness,
  quarterLabel: string,
): ConceptAangifte {
  let btw1a = 0, om1a = 0, btw1b = 0, om1b = 0, btw1c = 0, om1c = 0, om1e = 0;
  for (const s of input.salesByRate) {
    if (s.rate === 21) { om1a += s.omzet; btw1a += s.btw; }
    else if (s.rate === 9) { om1b += s.omzet; btw1b += s.btw; }
    else if (s.rate === 0 && Math.round(s.btw) === 0) { om1e += s.omzet; } // genuine 0%
    // Any other rate — OR a rate-0 bucket that carries BTW (an undecidable/mis-derived
    // rate, e.g. a null-field or blended-rate invoice) — goes to 1c so the BTW stays
    // VISIBLE and 5a reflects it, never silently zeroed into 1e.
    else { om1c += s.omzet; btw1c += s.btw; }
  }

  const rows: AangifteRow[] = [
    { code: "1a", label: RATE_LABEL["1a"], omzet: euro(om1a), btw: euro(btw1a) },
    { code: "1b", label: RATE_LABEL["1b"], omzet: euro(om1b), btw: euro(btw1b) },
  ];
  if (euro(om1c) !== 0 || euro(btw1c) !== 0) rows.push({ code: "1c", label: RATE_LABEL["1c"], omzet: euro(om1c), btw: euro(btw1c) });
  if (euro(om1e) !== 0) rows.push({ code: "1e", label: RATE_LABEL["1e"], omzet: euro(om1e), btw: 0 });

  const verschuldigd = rows.reduce((s, r) => s + r.btw, 0); // 5a — sum of rounded rubrieken
  const voorbelasting = euro(input.btwVoorbelasting);        // 5b
  const saldo = verschuldigd - voorbelasting;                // 5g

  // ── Honest notes — no false reassurance. Every figure states what it depends on. ──
  const notes: string[] = [];
  notes.push("Dit is een CONCEPT op basis van je ingevoerde gegevens — geen ingediende aangifte. Je boekhouder controleert en dient in.");
  notes.push(
    `Verkoop-BTW (5a) is berekend uit ${completeness.turnoverDays} dag(en) dagomzet` +
    `${completeness.outgoingInvoiceCount ? ` en ${completeness.outgoingInvoiceCount} verkoopfactu(u)r(en)` : ""}.`,
  );
  if (completeness.turnoverDays > 0 && completeness.turnoverDays < completeness.quarterDays) {
    notes.push(
      `Let op: dit kwartaal heeft ${completeness.quarterDays} dagen, maar er zijn ${completeness.turnoverDays} kassadagen geïmporteerd. ` +
      "Ontbrekende dagen tellen NIET mee — controleer of alle Z-rapporten erin zitten.",
    );
  }
  if (completeness.turnoverDays === 0 && input.salesByRate.length === 0) {
    notes.push("Er is nog geen omzet ingevoerd — 5a is leeg tot je dagomzet of verkoopfacturen toevoegt.");
  }
  notes.push(
    `Voorbelasting (5b) telt alleen ${completeness.incomingInvoiceCount} ingevoerde inkoopfactu(u)r(en). ` +
    "Ontbreekt er een inkoopfactuur, dan is de voorbelasting te laag en het te betalen bedrag te hoog.",
  );
  if (input.cashOmzetZonderBtw > 0) {
    notes.push(
      `€${euro(input.cashOmzetZonderBtw)} omzet heeft nog geen BTW-tarief (contante omzet of een niet-gesplitste kassadag) — die is NIET in 1a/1b ingedeeld. ` +
      "Ken een tarief toe voor een compleet beeld.",
    );
  }
  if (completeness.hasEuPurchase) {
    notes.push(
      "Er zijn inkopen uit het buitenland (EU). BTW-verlegging (rubriek 4b) en de bijbehorende voorbelasting " +
      "worden hier NIET automatisch berekend — je boekhouder verwerkt dit.",
    );
  }

  return {
    quarterLabel,
    rows,
    verschuldigd,
    voorbelasting,
    saldo,
    cashOmzetZonderBtw: euro(input.cashOmzetZonderBtw),
    notes,
    isConcept: true,
  };
}

/**
 * [AANGIFTE] The concept aangifte as a CSV for the accountant's closing package — the
 * rubrieken + 5a/5b/5g + the honest notes. RAW concept only ("geen ingediende aangifte");
 * it travels WITH the evidence (invoice PDFs, dagomzet.csv, bank statement) in the same
 * ZIP, so every figure is traceable to its source. Pure (semicolon CSV, Excel-NL).
 */
export function buildAangifteCsv(a: ConceptAangifte): string {
  const EUR = (n: number) => n.toFixed(2).replace(".", ",");
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const L: string[] = [];
  L.push(`BoekBrug — Concept BTW-aangifte ${a.quarterLabel}`);
  L.push("LET OP: concept op basis van de ingevoerde gegevens — GEEN ingediende aangifte. De boekhouder controleert en dient in.");
  L.push("");
  L.push(["Rubriek", "Omschrijving", "Omzet", "BTW"].map(esc).join(";"));
  for (const r of a.rows) {
    L.push([r.code, r.label, EUR(r.omzet), r.btw ? EUR(r.btw) : ""].map(esc).join(";"));
  }
  L.push("");
  L.push(["5a", "Verschuldigde omzetbelasting", "", EUR(a.verschuldigd)].map(esc).join(";"));
  L.push(["5b", "Voorbelasting", "", EUR(a.voorbelasting)].map(esc).join(";"));
  L.push(["5g", `Concept ${a.saldo >= 0 ? "te betalen" : "terug te ontvangen"}`, "", EUR(Math.abs(a.saldo))].map(esc).join(";"));
  L.push("");
  L.push("Waar dit op gebaseerd is (controleer voor indiening):");
  for (const n of a.notes) L.push(esc(n));
  return L.join("\r\n");
}
