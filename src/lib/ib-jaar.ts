// src/lib/ib-jaar.ts
// [IB-JAAR] The year, arranged the way the IB-aangifte asks for it.
//
// The IB-aangifte is the ZZP'er's biggest yearly fear and the main reason they still pay for
// help. Every competitor that addresses it does one of two things: a human does the filing
// (expensive tiers), or the software maps the administration onto the FORM's structure so the
// owner — or their boekhouder — copies numbers instead of computing them. This module is the
// second thing, honestly bounded.
//
// ── What it does and refuses to do ──
//
// It PRESENTS the year's already-reconciled truth (computeResultForRange — the same single
// engine every screen uses) in the vocabulary of the form's "Winst uit onderneming" section,
// adds the one signal the administration genuinely holds (the urencriterium, from the owner's
// own hour registration), and NAMES what the administration does not track — afschrijvingen,
// voorraadmutatie, privé-gebruik — instead of showing a "winst" that silently pretends those
// are zero. It computes NO tax: aftrekposten, MKB-winstvrijstelling and tariffs change yearly
// and belong to the Belastingdienst's own form and the boekhouder's judgement. A wrong "your
// tax will be €X" is worse than no number; a faithful "your omzet/kosten/saldo, and here is
// what still needs a human" is exactly what the closing package already promises.
//
// Pure: the route reads, this arranges. Tested in ib-jaar.test.ts.

import { round2 } from "./invoice-totals";
import { URENCRITERIUM_HOURS } from "./urencriterium";

// The threshold lives in urencriterium.ts, which is where the criterion is now assessed DURING the
// year as well as after it. Re-exported so every existing importer keeps its one authority for the
// number — two modules each declaring 1.225 is how they come to disagree.
export { URENCRITERIUM_HOURS };

export interface IbJaarInput {
  year: number;
  /** From computeResultForRange over [year-01-01, year-12-31]. */
  omzet: number;
  kosten: number;
  resultaat: number;
  /** Revenue recorded without a BTW rate — the form does not care, but honesty does. */
  cashOmzetZonderBtw: number;
  /** Σ time_entries.hours in the year, or null when the read failed ("could not look"). */
  hoursTotal: number | null;
  /**
   * [BEDRIJFSMIDDEL] From the same range result: purchases registered as an asset (withheld from
   * kosten) and the year's depreciation (inside kosten). Optional so a caller from before the
   * register still arranges a year; absent reads as "no register".
   */
  investeringen?: number;
  afschrijvingen?: number;
  /** [AANSLAG] Money on Belastingdienst letters kept out of kosten (income tax, Zvw, btw settlement). */
  aanslagen?: number;
  /** The register could not be read: every purchase counted as a cost, nothing was depreciated. */
  assetsUnreadable?: boolean;
  /** Σ boekwaarde on 31 December of every asset still on the books, or null when unreadable. */
  boekwaardeEinde?: number | null;
  /** Assets on the books at some point in the year. */
  assetCount?: number;
}

export interface IbJaarOverzicht {
  year: number;
  /** Winst-en-verliesrekening, in the form's own order. `kosten` INCLUDES afschrijvingen. */
  wv: { opbrengsten: number; kosten: number; saldo: number; afschrijvingen: number };
  /** [BEDRIJFSMIDDEL] The balance-sheet half the form asks about: what is on the books. */
  /** [AANSLAG] Tax letters withheld from kosten, euros. Shown only when there were any. */
  aanslagen?: number;
  bedrijfsmiddelen: {
    investeringen: number;
    /** null = the register could not be read. */
    boekwaardeEinde: number | null;
    aantal: number;
    unreadable: boolean;
  };
  uren: {
    total: number | null;
    threshold: number;
    /** null = could not look (never "not met" over a failed read). */
    met: boolean | null;
    sentence: string;
  };
  /** What this administration does NOT track — the lines a human must still add. */
  nietBijgehouden: string[];
  /** Honest caveats about the numbers above. */
  kanttekeningen: string[];
}

const eur = (n: number) => `€ ${Math.abs(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildIbJaarOverzicht(input: IbJaarInput): IbJaarOverzicht {
  const { year, hoursTotal } = input;

  const uren = (() => {
    if (hoursTotal === null) {
      return {
        total: null, threshold: URENCRITERIUM_HOURS, met: null as boolean | null,
        sentence: "We konden je urenregistratie nu niet lezen — het urencriterium is niet beoordeeld.",
      };
    }
    const total = round2(hoursTotal);
    const met = total >= URENCRITERIUM_HOURS;
    return {
      total, threshold: URENCRITERIUM_HOURS, met,
      sentence: met
        ? `Je registreerde ${total.toLocaleString("nl-NL")} uur in ${year} — het urencriterium (1.225 uur) is op basis van je registratie gehaald.`
        : `Je registreerde ${total.toLocaleString("nl-NL")} uur in ${year} — nog ${round2(URENCRITERIUM_HOURS - total).toLocaleString("nl-NL")} uur onder het urencriterium (1.225 uur). Alleen geregistreerde uren tellen hier; werkte je meer, registreer het.`,
    };
  })();

  const kanttekeningen: string[] = [];
  // [BEDRIJFSMIDDEL] A register that could not be read is a year figure that quietly went back to
  // "every purchase is a cost" — said first, because it moves the winst.
  if (input.assetsUnreadable) {
    kanttekeningen.push(
      "Het register van bedrijfsmiddelen kon nu niet gelezen worden: elke inkoop telt hieronder als kost en er is niets afgeschreven. Ververs de pagina voordat je cijfers overneemt.",
    );
  }
  if (Math.abs(input.cashOmzetZonderBtw) >= 0.005) {
    kanttekeningen.push(
      `${eur(input.cashOmzetZonderBtw)} omzet staat nog zonder BTW-tarief. Voor de winst telt hij gewoon mee; voor de BTW-aangifte moet het tarief er alsnog bij.`,
    );
  }

  const aantal = input.assetCount ?? 0;
  const unreadable = input.assetsUnreadable === true;
  return {
    year,
    wv: {
      opbrengsten: round2(input.omzet), kosten: round2(input.kosten), saldo: round2(input.resultaat),
      afschrijvingen: round2(input.afschrijvingen ?? 0),
    },
    aanslagen: round2(input.aanslagen ?? 0),
    bedrijfsmiddelen: {
      investeringen: round2(input.investeringen ?? 0),
      boekwaardeEinde: unreadable ? null : round2(input.boekwaardeEinde ?? 0),
      aantal,
      unreadable,
    },
    uren,
    // The honest list. Every entry is a thing the IB form asks about and this administration has
    // no source for — presenting a "winst" without naming these invites copying a wrong number
    // into a legal form.
    nietBijgehouden: [
      // [BEDRIJFSMIDDEL] With an empty register the old sentence stands: an investment of € 450 or
      // more is sitting in the costs as a whole. With a register, what is still a boekhouder's call
      // is named instead — the register does the ordinary rule and nothing beyond it.
      aantal === 0 && !unreadable
        ? "afschrijvingen (een investering van € 450 of meer hoort in het register Bedrijfsmiddelen — zolang het leeg is, staat zo'n inkoop hier als volledige kost)"
        : "willekeurige afschrijving (starters), investeringsaftrek (KIA) en boekwinst of -verlies bij verkoop van een bedrijfsmiddel — bespreek die met je boekhouder",
      "voorraadmutatie (begin- en eindvoorraad)",
      "privé-gebruik (auto van de zaak, privé-deel van kosten)",
      "fiscale aftrekposten (zelfstandigenaftrek, startersaftrek, MKB-winstvrijstelling — die past de aangifte zelf toe)",
    ],
    kanttekeningen,
  };
}
