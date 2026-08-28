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
}

export interface IbJaarOverzicht {
  year: number;
  /** Winst-en-verliesrekening, in the form's own order. */
  wv: { opbrengsten: number; kosten: number; saldo: number };
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
  if (Math.abs(input.cashOmzetZonderBtw) >= 0.005) {
    kanttekeningen.push(
      `${eur(input.cashOmzetZonderBtw)} omzet staat nog zonder BTW-tarief. Voor de winst telt hij gewoon mee; voor de BTW-aangifte moet het tarief er alsnog bij.`,
    );
  }

  return {
    year,
    wv: { opbrengsten: round2(input.omzet), kosten: round2(input.kosten), saldo: round2(input.resultaat) },
    uren,
    // The honest list. Every entry is a thing the IB form asks about and this administration has
    // no source for — presenting a "winst" without naming these invites copying a wrong number
    // into a legal form.
    nietBijgehouden: [
      "afschrijvingen (investeringen boven € 450 schrijf je af — die staan hier als volledige kost of nog nergens)",
      "voorraadmutatie (begin- en eindvoorraad)",
      "privé-gebruik (auto van de zaak, privé-deel van kosten)",
      "fiscale aftrekposten (zelfstandigenaftrek, startersaftrek, MKB-winstvrijstelling — die past de aangifte zelf toe)",
    ],
    kanttekeningen,
  };
}
