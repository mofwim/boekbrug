// src/lib/btw-soort.ts
// [GEEN-BTW-SOORT] Not every 21 % on a document is BTW you may reclaim. Pure, no I/O.
// Run: npx tsx --test src/lib/btw-soort.test.ts
//
// ── THE INVOICE THAT PROVOKED THIS ──
//
// Coöperatie Univé Zuid-Nederland, invoice 142257742, 14-08-2026: € 195,28 + € 41,01 = € 236,29.
// The reader saw 21 %, wrote it into btw_amount, the invoice was confirmed, and € 41,01 is now
// standing in the administration as voorbelasting.
//
// An insurer charges no BTW. Insurance is exempt (art. 11-1-k Wet OB); what sits on the premium is
// ASSURANTIEBELASTING, a different tax that happens to be 21 % as well, and it cannot be reclaimed
// through the btw-aangifte. The document is honest, the arithmetic adds up, every gate in this app
// passes — and the number is wrong in the one direction that gets assessed back with interest.
//
// That is why this file exists: the danger is not a misread. Everything was read correctly. The
// gap is that the app had no idea a percentage can be a DIFFERENT TAX.
//
// ── THE FIVE FAMILIES ──
//
//   assurantiebelasting  — insurance premiums. Same 21 %, not BTW, never deductible.
//   horeca               — food and drink consumed in a horeca business. BTW genuinely exists on
//                          the bill and may NOT be deducted (art. 15 lid 5 Wet OB). No threshold,
//                          no exception, not even for a working lunch.
//   financieel           — bank charges, interest, insurance brokerage. Exempt (art. 11-1-i/j),
//                          so an amount presented as BTW is a reading to check.
//   buiten_btw           — the Belastingdienst, a pension fund, wages. No supply, so no BTW at all.
//   verhuur              — rent. Usually exempt (art. 11-1-b) BUT landlord and tenant may OPT for
//                          taxed rental, which is very common for business premises. So this one
//                          is a QUESTION and never a verdict — see below.
//
// ── WHY IT ASKS AND NEVER CORRECTS ──
//
// Every rule here is a guess about what a company DOES, taken from its name. An insurer can invoice
// a taxable advisory service. A landlord who opted for belaste verhuur charges 21 % entirely
// lawfully, and silently stripping it would destroy a real deduction. A supplier with "Bank" in its
// name may be a bakery ("Bankethuis") or a software vendor.
//
// So this module produces a SENTENCE, not a correction. It fires only when BTW is actually being
// claimed — with nothing claimed there is nothing to warn about — and the owner decides. That is
// the same rule the rest of this app lives by: the machine may point, the human books.
//
// ── AND WHY A NAME LIST IS THE RIGHT SHAPE HERE, THIS ONCE ──
//
// Elsewhere in this codebase a hand-kept list is a smell — three of them went stale in one day. A
// list is right here because the thing being recognised IS a fixed set of legal categories, not a
// changing set of files: the Wet OB has these exemptions and no others, and a new entry means the
// law changed. What must never be hand-kept is the VERDICT, and it is not: the verdict is always
// "check this", which is safe to be wrong about in both directions.

/** Which legal family the doubt belongs to. */
export type BtwDoubtKind =
  | "assurantiebelasting"
  | "horeca"
  | "financieel"
  | "buiten_btw"
  | "verhuur";

/** One doubt about an amount booked as reclaimable BTW. */
export interface BtwDoubt {
  kind: BtwDoubtKind;
  /** Dutch, shown to the owner. States the rule and asks; never asserts the amount is wrong. */
  message: string;
  /** The article, so an accountant can check the claim rather than take it on faith. */
  wet: string;
}

/** What this judgement needs. Everything optional except the amounts — a name may be missing. */
export interface BtwDoubtInput {
  supplierName: string | null | undefined;
  /** The BTW booked as reclaimable. No claim, no warning. */
  btwAmount: number | null | undefined;
  totalExBtw: number | null | undefined;
  /** Free text off the document, when the caller has it — a premium line names itself. */
  description?: string | null;
}

// ── The patterns, and why they are anchored the way they are ────────────────────────────────
//
// Two traps, both found by running this against the owner's real supplier names.
//
// 1. \b DOES NOT WORK AFTER AN ACCENT. In JavaScript \w is [A-Za-z0-9_], so "é" is a non-word
//    character: in "Univé Zuid-Nederland" there is no boundary between the "é" and the space, and
//    /\buniv[ée]\b/ silently fails to match the exact company that provoked this whole file.
//
// 2. DUTCH COMPOUNDS PUT THE WORD IN THE MIDDLE. "brandverzekering", "autoverzekering",
//    "bedrijfstakpensioenfonds" — a leading \b refuses every one of them. The owner's actual
//    pension fund is called "Stichting Bedrijfstakpensioenfonds voor het Levensmiddelenbedrijf".
//
// So: terms that appear inside compounds are matched as plain substrings, and terms that would
// over-match as a fragment get letter-lookarounds instead of \b — which do the right thing next to
// an accent. The tests below hold both directions: "Bankethuis" must not read as a bank, and
// "brandverzekering" must read as insurance.

/** Standalone-ish: not glued to another letter on either side. Works next to accents, unlike \b. */
const alleen = (term: string) => `(?<![a-z])${term}(?![a-z])`;

const VERZEKERAAR = new RegExp(
  // Compound-friendly: brandverzekering, autoverzekering, assurantiekantoor.
  "verzeker|assurant|" +
  // Standalone: "univé"/"unive" must not swallow "universiteit" or "universeel".
  [alleen("univ[ée]"), alleen("asr"), alleen("cz"), alleen("vgz"), alleen("fbto"), alleen("ohra")].join("|") + "|" +
  "achmea|aegon|nationale[- ]nederlanden|interpolis|centraal beheer|allianz|zilveren kruis|menzis|" +
  "reaal|delta lloyd|klaverblad|goudse|nh1816|turien",
  "i",
);

// Horeca is about EATING THERE, so the words are the venue types. Deliberately NOT the industry
// word "horeca": the owner's own supplier "Enka Horeca B.V." is a wholesaler whose 14 booked
// invoices carry fully deductible BTW, and flagging those would be wrong 14 times out of 14.
const HORECA = new RegExp(
  [alleen("caf[ée]"), alleen("grill"), alleen("hotel")].join("|") + "|" +
  "restaurant|cafetaria|eetcaf[ée]|bistro|brasserie|lunchroom|snackbar|pizzeria|shoarma|grillroom|" +
  "mcdonald|burger king|kfc|starbucks|catering|traiteur|kantine",
  "i",
);

// Anchored on real bank names and on the COST words. Never on the four letters "bank": that
// matches Bankethuis, banketbakkerij and bankstel — a bakery is not a bank.
const FINANCIEEL = new RegExp(
  "bankkosten|incassokosten|hypothe(?:ek|que)|" +
  [alleen("rente"), alleen("lening"), alleen("krediet")].join("|") + "|" +
  "abn ?amro|rabobank|ing bank|sns bank|" + [alleen("knab"), alleen("bunq")].join("|") + "|triodos|asn bank",
  "i",
);

// Compound-friendly throughout: bedrijfstakpensioenfonds, loonheffing, premieafdracht.
const BUITEN_BTW = /belastingdienst|pensioen|loonheffing|salaris|sociale (?:lasten|verzekering)|premie werknemers|uwv/i;

const VERHUUR = /vastgoed|verhuur|huurovereenkomst|makelaar|woningcorporatie|pandbeheer/i;

/** Is the effective rate ~21 %? The assurantiebelasting trap is that it matches BTW exactly. */
function isTwentyOne(btw: number, ex: number): boolean {
  if (!(ex > 0)) return false;
  return Math.abs((btw / ex) * 100 - 21) <= 0.6;
}

/**
 * Should the owner look at this reclaimed BTW before it goes into an aangifte?
 *
 * Answers null for the overwhelming majority of invoices. Only speaks when something is actually
 * being claimed AND the counterparty looks like one of the five families above.
 */
export function doubtAboutInputVat(input: BtwDoubtInput): BtwDoubt | null {
  const btw = typeof input.btwAmount === "number" ? input.btwAmount : 0;
  // Nothing claimed → nothing to warn about. This also keeps the whole module silent on the
  // exempt invoices that are already booked correctly, which is most of them.
  if (!Number.isFinite(btw) || Math.abs(btw) < 0.005) return null;
  const ex = typeof input.totalExBtw === "number" && Number.isFinite(input.totalExBtw) ? input.totalExBtw : 0;

  const haystack = `${input.supplierName ?? ""} ${input.description ?? ""}`;

  // Insurance first, and deliberately so: it is the only family where the WRONG amount looks
  // exactly like a right one, because assurantiebelasting is 21 % too.
  if (VERZEKERAAR.test(haystack)) {
    return {
      kind: "assurantiebelasting",
      wet: "art. 11-1-k Wet OB / Wet op belastingen van rechtsverkeer",
      message: isTwentyOne(btw, ex)
        ? "Verzekeringen dragen geen btw maar assurantiebelasting — óók 21%, en die mag je niet " +
          "terugvragen. Controleer of dit bedrag echt btw is voordat je het in je aangifte meeneemt."
        : "Dit lijkt een verzekeraar. Verzekeringspremies dragen geen btw maar assurantiebelasting, " +
          "en die is niet aftrekbaar. Controleer wat dit bedrag precies is.",
    };
  }

  if (HORECA.test(haystack)) {
    return {
      kind: "horeca",
      wet: "art. 15 lid 5 Wet OB",
      message:
        "Eten en drinken in een horecagelegenheid: de btw op deze rekening mag je niet terugvragen, " +
        "ook niet bij een zakelijke lunch. De kosten zelf blijven wel aftrekbaar.",
    };
  }

  if (BUITEN_BTW.test(haystack)) {
    return {
      kind: "buiten_btw",
      wet: "art. 1 Wet OB",
      message:
        "Hier staat meestal geen btw op: belasting, pensioenpremie en loonkosten zijn geen levering " +
        "of dienst. Controleer of dit bedrag echt btw is.",
    };
  }

  if (FINANCIEEL.test(haystack)) {
    return {
      kind: "financieel",
      wet: "art. 11-1-i/j Wet OB",
      message:
        "Bankkosten, rente en financiële diensten zijn vrijgesteld van btw. Controleer of dit " +
        "bedrag echt btw is die je mag terugvragen.",
    };
  }

  // Rent is last, and it is the softest sentence of the five — see the header. Opting for taxed
  // rental is normal for business premises, so 21 % here is very often completely correct.
  if (VERHUUR.test(haystack)) {
    return {
      kind: "verhuur",
      wet: "art. 11-1-b Wet OB",
      message:
        "Verhuur is meestal vrijgesteld van btw, maar huurder en verhuurder kunnen kiezen voor " +
        "btw-belaste verhuur — dan klopt dit gewoon. Staat die keuze in je huurcontract?",
    };
  }

  return null;
}
