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
> & {
  // [ICP] Turnover supplied to businesses in other EU member states (ex BTW), read from the
  // customers' VAT numbers — it belongs in rubriek 3b, not in 1e. Not part of FinancialResult
  // because no RATE distinguishes it: 0% is 0% until you look at who the customer is. Both
  // rubrieken carry €0 BTW, so stating it correctly can never move 5a, 5b or 5g.
  intraEuOmzet?: number;
  // [VRIJGESTELD] Turnover exempt under art. 11 Wet OB. It reaches NO rubriek — not even 1e,
  // which is for 0%-taxed and reverse-charged supplies, not for an exemption — so it arrives
  // here only to be NAMED in the notes. Exactly the treatment cashOmzetZonderBtw gets: a figure
  // the owner can see and reconcile against their own books, never a silent omission.
  vrijgesteldeOmzet?: number;
  // The pro-rata percentage applied to input BTW on costs serving both activities, or null when
  // the regime is off or the ratio was undecidable.
  proRataPercent?: number | null;
  // Input BTW on mixed costs left OUT of 5b because no ratio could be determined. > 0 ⇒ 5b is
  // deliberately too low, and the note says so.
  voorbelastingUnresolved?: number;
  // Input BTW on costs attributed wholly to exempt activity — never deductible. Shown so an
  // owner who expected a refund can see what it went to.
  voorbelastingGeblokkeerd?: number;
  // Turnover from sources this feature cannot classify (till Z-report, rated cash sales) and
  // therefore booked as TAXED. Named in the notes rather than left for the owner to find.
  onclassificeerbareOmzet?: number;
  // Whether the exempt regime applied at all — see the field of the same name on FinancialResult.
  exemptRegime?: boolean;
};

export interface AangifteCompleteness {
  turnoverDays: number;          // days of dagomzet imported for the period
  quarterDays: number;           // calendar days in the quarter
  incomingInvoiceCount: number;  // purchase invoices feeding 5b (voorbelasting)
  outgoingInvoiceCount: number;  // sales invoices feeding 1a/1b
  hasEuPurchase: boolean;        // an incoming invoice from outside NL (rubriek 4b — not auto-computed)
  // [ICP] The richer version of the line above: the EU purchases NAMED, built by
  // foreignPurchaseNote(). When present it replaces the bare "there are EU purchases" sentence.
  euPurchaseNote?: string | null;
  // Verified invoices with NO invoice_date. A date-range fetch silently drops them, so they
  // are NOT in the figures above — surfaced as a note so the concept isn't quietly too low.
  datelessVerifiedCount?: number;
  // [COUNT-BASIS] Which set the two counts above describe. Under kasstelsel the rubrieken are
  // built from SETTLEMENTS (money that moved in this quarter), not from the invoices DATED in it
  // — two genuinely different sets, on purpose: an invoice from last year paid in March belongs
  // in this quarter, and one issued in March but unpaid does not. The counts then had to be
  // taken from the settled set, and the sentences had to stop saying "ingevoerd" about them.
  // Absent → 'factuur' (the accrual wording, unchanged).
  scheme?: "factuur" | "kas";
}

export interface AangifteRow {
  code: "1a" | "1b" | "1c" | "1e" | "3b";
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
  // [VRIJGESTELD] Exempt turnover — likewise NOT in any rubriek, and for a stronger reason: an
  // exemption is not a rate, so there is no box on the form it belongs in. 0 off-regime.
  vrijgesteldeOmzet: number;
  notes: string[];               // honest limits — what each figure depends on
  isConcept: true;
}

/**
 * Whole euros, the way the Belastingdienst rounds — and SYMMETRICALLY around zero.
 *
 * ── WHY NOT Math.round ──
 * Math.round breaks ties toward +∞, not away from zero. So `Math.round(1.5)` is 2 while
 * `Math.round(-1.5)` is −1: the same half-euro rounds up in one direction and down in the other.
 *
 * On a normal quarter that is invisible, because every rubriek is positive. It stops being
 * invisible on a quarter that nets NEGATIVE — a business that issued a large creditnota, a
 * refunded season, a corrected invoice from an earlier period. Those are exactly the quarters
 * where a figure is already unusual and least likely to be double-checked, and there the bias runs
 * one way every time: consistently toward zero, which on a reclaim is consistently against the
 * owner.
 *
 * The amount is at most €1 per rubriek, and it is still worth fixing for a reason that has nothing
 * to do with the euro: this figure is copied into an aangifte. A number that cannot be reproduced
 * by the person checking it — because their calculator rounds −1,50 to −2 and ours said −1 — costs
 * far more in trust than it ever could in tax.
 *
 * `-0` is normalised to `0`: JavaScript keeps them distinct, and a rubriek printed as "−0" on a
 * concept an accountant reads is a question nobody should have to ask.
 */
const euro = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.sign(n) * Math.round(Math.abs(n));
  return rounded === 0 ? 0 : rounded;
};

const RATE_LABEL: Record<string, string> = {
  "1a": "Leveringen/diensten belast met hoog tarief (21%)",
  "1b": "Leveringen/diensten belast met laag tarief (9%)",
  "1c": "Leveringen/diensten belast met overige tarieven, behalve 0%",
  "1e": "Leveringen/diensten belast met 0% of niet bij u belast",
  "3b": "Leveringen naar landen binnen de EU",
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
  // [REGIME-FLAGS] Optional accountant-handoff notes (KOR / BTW verlegd / margeregeling) —
  // regimes this concept does NOT auto-compute. Appended to the notes so the concept the
  // owner sees and the ZIP hands over is honest about what the accountant must still handle.
  regimeNotes?: string[],
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
  // [ICP] Intra-EU supplies are 0%-turnover that the rate alone cannot distinguish, so they land
  // in the 1e bucket above. Move them to 3b, where the Belastingdienst cross-checks them against
  // the ICP-opgaaf. Capped at what 1e actually holds: 1e can never go negative, and turnover that
  // is not there is not invented. Both rubrieken carry €0 BTW, which is the whole safety of this
  // step — 5a, and therefore 5g, is identical with or without it.
  //
  // It moves in EITHER direction. A quarter whose EU turnover nets negative — a creditnota for a
  // sale invoiced earlier — has a genuinely negative 3b, and clamping that to zero would leave
  // the credit sitting in 1e while the ICP-opgaaf beside it reports the negative. The two are
  // handed to the same accountant; they may not contradict each other.
  const intraEu = Math.round(input.intraEuOmzet ?? 0);
  const e1 = euro(om1e);
  // Only ever move what 1e actually holds, in the direction it holds it. Mixed signs (positive
  // EU turnover against a negative 0%-bucket, or the reverse) move nothing: there is no honest
  // amount to shift, and the note still names the ICP lines.
  const om3b =
    intraEu > 0 && e1 > 0 ? Math.min(intraEu, e1)
    : intraEu < 0 && e1 < 0 ? Math.max(intraEu, e1)
    : 0;
  const rest1e = e1 - om3b;
  if (rest1e !== 0) rows.push({ code: "1e", label: RATE_LABEL["1e"], omzet: rest1e, btw: 0 });
  if (om3b !== 0) rows.push({ code: "3b", label: RATE_LABEL["3b"], omzet: om3b, btw: 0 });

  const verschuldigd = rows.reduce((s, r) => s + r.btw, 0); // 5a — sum of rounded rubrieken
  const voorbelasting = euro(input.btwVoorbelasting);        // 5b
  const saldo = verschuldigd - voorbelasting;                // 5g

  // ── Honest notes — no false reassurance. Every figure states what it depends on. ──
  const notes: string[] = [];
  notes.push("Dit is een CONCEPT op basis van je ingevoerde gegevens — geen ingediende aangifte. Je boekhouder controleert en dient in.");
  // [COUNT-BASIS] Under kas the counts describe invoices that were PAID in this quarter, so they
  // are named that way. The old wording ("ingevoerde inkoopfacturen") counted the invoices dated
  // in the quarter while 5a/5b were built from the settlements — a number that could be off by
  // any amount in either direction, printed in the block this page calls its trust layer.
  const onCash = completeness.scheme === "kas";
  notes.push(
    `Verkoop-BTW (5a) is berekend uit ${completeness.turnoverDays} dag(en) dagomzet` +
    `${completeness.outgoingInvoiceCount
      ? ` en ${completeness.outgoingInvoiceCount} ${onCash ? "in dit kwartaal betaalde verkoopfactu(u)r(en)" : "verkoopfactu(u)r(en)"}`
      : ""}.`,
  );
  if (completeness.turnoverDays > 0 && completeness.turnoverDays < completeness.quarterDays) {
    notes.push(
      `Let op: dit kwartaal heeft ${completeness.quarterDays} dagen, maar er zijn ${completeness.turnoverDays} kassadagen geïmporteerd. ` +
      "Ontbrekende dagen tellen NIET mee — controleer of alle Z-rapporten erin zitten.",
    );
  }
  // [VRIJGESTELD] The exempt figure counts as turnover HERE too. Without it this sentence tells a
  // fully exempt owner — a dentist with EUR 132.000 of care turnover, correctly in no rubriek —
  // that they have "nog geen omzet ingevoerd", which is both false and the opposite of reassuring:
  // it reads as "your quarter is empty" at the moment their data is complete.
  if (completeness.turnoverDays === 0 && input.salesByRate.length === 0 && !(input.vrijgesteldeOmzet ?? 0)) {
    notes.push("Er is nog geen omzet ingevoerd — 5a is leeg tot je dagomzet of verkoopfacturen toevoegt.");
  }
  notes.push(
    onCash
      ? `Voorbelasting (5b) telt alleen de ${completeness.incomingInvoiceCount} inkoopfactu(u)r(en) die je in dit kwartaal hebt BETAALD (kasstelsel). ` +
        "Een onbetaalde inkoopfactuur telt pas mee zodra je hem betaalt."
      : `Voorbelasting (5b) telt alleen ${completeness.incomingInvoiceCount} ingevoerde inkoopfactu(u)r(en). ` +
        "Ontbreekt er een inkoopfactuur, dan is de voorbelasting te laag en het te betalen bedrag te hoog.",
  );
  if (input.cashOmzetZonderBtw > 0) {
    notes.push(
      `€${euro(input.cashOmzetZonderBtw)} omzet heeft nog geen BTW-tarief (contante omzet, bankomzet of een niet-gesplitste kassadag) — die is NIET in 1a/1b ingedeeld. ` +
      "Ken een tarief toe voor een compleet beeld.",
    );
  }
  // [VRIJGESTELD] Exempt turnover, and what it costs on the deduction side. Four separate
  // sentences because they are four separate facts, and an owner who reads only the first one
  // must not be left with a wrong impression of the other three — the same discipline the KOR
  // note follows, where "the afdracht lapses" without "and so does the aftrek" was the trap.
  const vrijgesteld = euro(input.vrijgesteldeOmzet ?? 0);
  if (vrijgesteld !== 0) {
    notes.push(
      `€${vrijgesteld.toLocaleString("nl-NL")} van je omzet is VRIJGESTELD (art. 11 Wet OB) en staat daarom in GEEN ` +
      "enkele rubriek — ook niet in 1e, want dat vak is voor 0%-omzet en verlegde omzet, niet voor een " +
      "vrijstelling. Die omzet telt wel gewoon mee in je resultaat en in je inkomstenbelasting.",
    );
    if (typeof input.proRataPercent === "number") {
      notes.push(
        `Omdat je zowel belaste als vrijgestelde omzet hebt, is de BTW op kosten die BEIDE dienen voor ` +
        `${input.proRataPercent}% afgetrokken (pro rata: belaste omzet ÷ totale omzet, naar boven afgerond). ` +
        "Kosten die je aan één kant hebt toegewezen volgen die toewijzing, niet dit percentage. " +
        "Je boekhouder toetst of de omzetverhouding hier de juiste maatstaf is — bij een sterk afwijkend " +
        "werkelijk gebruik mag of moet daarvan worden afgeweken, en voor investeringsgoederen geldt " +
        "bovendien een herzieningstermijn die dit concept niet bijhoudt.",
      );
    }
    const geblokkeerd = euro(input.voorbelastingGeblokkeerd ?? 0);
    if (geblokkeerd > 0) {
      notes.push(
        `€${geblokkeerd.toLocaleString("nl-NL")} BTW op inkopen die je volledig aan je VRIJGESTELDE werk hebt ` +
        "toegewezen is NIET in 5b meegeteld. Dat is geen fout: bij vrijgestelde omzet bestaat er geen recht op aftrek.",
      );
    }
  }
  // [VRIJGESTELD] The boundary of this feature, in the concept the owner actually reads — not
  // only in a migration header they never will. A till Z-report has no exempt column and a cash
  // sale carries no exempt flag, so for a declared exempt owner that turnover was booked as
  // TAXED without anyone being asked. Saying nothing would let a physio with a cash book read a
  // concept that looks complete and is not.
  const onclassificeerbaar = euro(input.onclassificeerbareOmzet ?? 0);
  if (input.exemptRegime && onclassificeerbaar > 0) {
    notes.push(
      `LET OP: €${onclassificeerbaar.toLocaleString("nl-NL")} omzet komt uit je dagomzet (kassa) of uit ` +
      "contante verkopen. Die kunnen in BoekBrug nog NIET als vrijgesteld worden aangemerkt en zijn " +
      "hier dus als BELASTE omzet meegeteld — inclusief de BTW erover. Is een deel daarvan " +
      "vrijgesteld werk, dan klopt dit concept op dat punt niet en moet je boekhouder het corrigeren. " +
      "Verkoopfacturen kun je wel per regel op 'vrijgesteld' zetten.",
    );
  }
  const onopgelost = euro(input.voorbelastingUnresolved ?? 0);
  if (onopgelost > 0) {
    notes.push(
      `LET OP: €${onopgelost.toLocaleString("nl-NL")} BTW op gemengde kosten kon NIET worden verdeeld, omdat er in dit ` +
      "tijdvak geen bruikbare omzetverhouding is (geen omzet, of per saldo negatieve omzet). Die BTW staat " +
      "NIET in 5b — de voorbelasting is dus bewust te LAAG en het te betalen bedrag te hoog. Je boekhouder " +
      "bepaalt het percentage.",
    );
  }
  // [ICP] The EU-purchase note. When the caller supplies the LISTING (euPurchaseNote), that one
  // wins: it names the invoices instead of merely announcing that some exist, which is the
  // difference between a warning and something the accountant can act on. The bare sentence
  // stays as the fallback for callers that do not build the listing.
  // [ICP] When 3b could NOT take the whole intra-EU figure — capped by what the 0%-bucket held,
  // or signs that do not match — the concept and the ICP-opgaaf beside it disagree. They go to
  // the same accountant, so the difference is stated rather than left to be discovered.
  if (intraEu !== 0 && om3b !== intraEu) {
    notes.push(
      `Let op: de intracommunautaire leveringen tellen op tot €${Math.abs(intraEu).toLocaleString("nl-NL")}` +
      `${intraEu < 0 ? " negatief" : ""}, maar rubriek 3b kon er €${Math.abs(om3b).toLocaleString("nl-NL")}` +
      `${om3b < 0 ? " negatief" : ""} van opnemen — de 0%-omzet in dit kwartaal is niet groot genoeg (of heeft ` +
      "een ander teken). Dat wijst op een verkoop aan een EU-ondernemer waarop tóch BTW is berekend, of op een " +
      "creditnota uit een ander tijdvak. Controleer dit vóór je de ICP-opgaaf doet: die twee bedragen worden " +
      "naast elkaar gelegd.",
    );
  }
  if (completeness.euPurchaseNote) {
    notes.push(completeness.euPurchaseNote);
  } else if (completeness.hasEuPurchase) {
    notes.push(
      "Er zijn inkopen uit het buitenland (EU). BTW-verlegging (rubriek 4b) en de bijbehorende voorbelasting " +
      "worden hier NIET automatisch berekend — je boekhouder verwerkt dit.",
    );
  }
  if ((completeness.datelessVerifiedCount ?? 0) > 0) {
    const n = completeness.datelessVerifiedCount ?? 0;
    notes.push(
      `Let op: ${n} geverifieerde factu(u)r(en) ${n === 1 ? "heeft" : "hebben"} geen factuurdatum en ${n === 1 ? "telt" : "tellen"} ` +
      "daarom NIET mee in dit kwartaal — voer de factuurdatum in zodat de omzet/voorbelasting compleet is.",
    );
  }
  // [REGIME-FLAGS] Special-regime notes last (KOR / verlegd / marge) — the concept is only a
  // mapping of the rate we read; these regimes change what the accountant must file.
  for (const rn of regimeNotes ?? []) notes.push(rn);

  return {
    quarterLabel,
    rows,
    verschuldigd,
    voorbelasting,
    saldo,
    cashOmzetZonderBtw: euro(input.cashOmzetZonderBtw),
    vrijgesteldeOmzet: euro(input.vrijgesteldeOmzet ?? 0),
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
// [PRIVEGEBRUIK] Rubriek 1d — the correction this app cannot compute, and never mentioned.
//
// WHAT IS MISSING
// BTW is owed on the PRIVATE use of business goods and services: a van also driven privately,
// a phone or internet subscription used at home, electricity, goods taken from stock. That
// correction belongs in rubriek 1d, in the LAST aangifte of the year. This app builds
// 1a/1b/1c/1e/3b and has never had a 1d — not in the concept, not in a note, nowhere.
//
// WHY IT IS A NOTE AND NOT A FIGURE
// The inputs simply are not here: the catalogue value of a vehicle, the private kilometres, the
// private share of a subscription. Computing 1d would mean inventing all three. Same rule as
// rubriek 4b (EU purchases) right above: say plainly that it is not computed, never guess.
//
// WHY IT IS SAID BEFORE Q4 AS WELL
// A note that only appears in the last quarter arrives too late to act on. The correction can
// only be substantiated with records kept DURING the year — a kilometre administration cannot
// be reconstructed in January. So Q1–Q3 get the one thing still actionable then (keep the
// records), and Q4 gets the actual instruction (it belongs in THIS filing).
//
// The failure direction matters: leaving 1d out means declaring too LITTLE BTW, which surfaces
// as a naheffing with belastingrente — the owner never finds out on their own. That is exactly
// the kind of silence this product refuses.
export function privegebruikNote(quarter: 1 | 2 | 3 | 4): string {
  return quarter === 4
    ? "Privégebruik (rubriek 1d) hoort in DEZE aangifte — de laatste van het jaar — en wordt hier " +
      "NIET berekend. Gebruik je zakelijke spullen ook privé (auto, telefoon, internet, energie, " +
      "goederen uit voorraad), dan is daarover BTW verschuldigd. Je boekhouder bepaalt het bedrag."
    : "Denk aan het privégebruik (rubriek 1d): de BTW-correctie over zakelijk gebruik dat ook privé " +
      "is (auto, telefoon, internet, energie) komt in de LAATSTE aangifte van het jaar. Die wordt " +
      "hier niet berekend en kan alleen worden onderbouwd met gegevens die je NU bijhoudt — " +
      "bijvoorbeeld een kilometeradministratie.";
}

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
