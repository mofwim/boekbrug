// src/lib/bank-ignore-reason.ts
// [BANK-IGNORE-REDEN] Waarom is deze bankregel genegeerd?
//
// De invoicekant kreeg dit al met archive-reason.ts, en het bankblad had exact dezelfde kwaal, één
// onderwerp verderop: het tabblad Genegeerd was een lijst zonder geheugen. Een afschrijving belandt
// erin en drie maanden later — bij de kwartaalafsluiting, of als de boekhouder ernaar vraagt — staat
// daar een bedrag zonder één woord waarom.
//
// Bij een bankregel weegt dat zwaarder dan bij een factuur, want negeren doet hier meer. De regel
// verdwijnt in één tik uit ÉLKE lijst die hem nog had kunnen verklaren — de matcher, auto-confirm,
// auto-categorize, de nachtelijke sweep en elke categorize-lezing — en voor een afschrijving
// verdwijnt ook de [VOORBELASTING-RISK]-waarschuwing mee, omdat undocumentedCount pending-scoped is.
// Het is daarmee de meest ingrijpende eentikshandeling in de hele bankmap, en tot voor kort de enige
// die geen enkel spoor naliet.
//
// Vijf redenen, bewust kort: hoe langer de lijst, hoe groter de kans dat er zomaar iets gekozen
// wordt, en dan is het antwoord slechter dan geen antwoord (dezelfde afweging als bij de facturen).
// Ze dekken wat er in de praktijk met een onverklaarde bankregel gebeurt, en elk zegt iets ANDERS:
//
//   · prive         → de uitgave is echt, maar hoort niet in deze boekhouding. Zegt iets over de
//                     REKENING: staat er privéverkeer op een zakelijke rekening?
//   · geen_factuur  → een vaste last of abonnement waar nooit een factuur bij komt (huur, lease,
//                     verzekering). Zegt iets over wat je van deze tegenpartij mag VERWACHTEN.
//   · dubbel        → deze regel staat er al een keer in. Zegt iets over de IMPORT.
//   · niet_van_mij  → een terugboeking, een vergissing, geld dat weer wegging. Zegt iets over de BANK.
//   · anders        → eerlijk niets beweren is beter dan een vakje verkeerd aankruisen.
//
// De reden is een NOTITIE, geen besluit: hij verandert niets aan wat er met de regel gebeurt
// (negeren blijft negeren, terugzetten blijft één tik) en telt nergens in de cijfers mee. Daarom
// mag hij ook ontbreken — bij een rij van vóór deze kolom, of als de eigenaar de vraag overslaat.
//
// Pure + node-testbaar (run: npx tsx src/lib/bank-ignore-reason.test.ts).

export const BANK_IGNORE_REASONS = ['prive', 'geen_factuur', 'dubbel', 'niet_van_mij', 'anders'] as const

export type BankIgnoreReason = (typeof BANK_IGNORE_REASONS)[number]

/** Wat de eigenaar leest, met de subtekst die de keuze eenduidig maakt. */
export const BANK_IGNORE_REASON_LABELS: Record<BankIgnoreReason, { label: string; hint: string }> = {
  prive: {
    label: 'Privé',
    hint: 'wel echt uitgegeven, maar niet zakelijk',
  },
  geen_factuur: {
    label: 'Hier komt geen factuur bij',
    hint: 'vaste last, abonnement, huur of lease',
  },
  dubbel: {
    label: 'Dubbel',
    hint: 'deze regel staat er al een keer in',
  },
  niet_van_mij: {
    label: 'Niet van mij',
    hint: 'terugboeking of vergissing van de bank',
  },
  anders: {
    label: 'Anders',
    hint: 'geen van bovenstaande',
  },
}

/**
 * Is dit een reden die we mogen opslaan? De database kent dezelfde vijf via een CHECK-constraint
 * (bank_ignore_reason.sql), dus een waarde die hier niet doorkomt zou daar alsnog stuklopen — met
 * een 500 in plaats van een genegeerde regel. Alles wat niet klopt wordt daarom stil null, want de
 * reden is een notitie: hem kwijtraken mag nooit het negeren zelf tegenhouden.
 */
export function toBankIgnoreReason(v: unknown): BankIgnoreReason | null {
  return typeof v === 'string' && (BANK_IGNORE_REASONS as readonly string[]).includes(v)
    ? (v as BankIgnoreReason)
    : null
}

/** Het korte label voor het Genegeerd-tabblad. Onbekend/leeg → null (dan toont het scherm niets). */
export function bankIgnoreReasonLabel(reason: string | null | undefined): string | null {
  const r = toBankIgnoreReason(reason)
  return r ? BANK_IGNORE_REASON_LABELS[r].label : null
}
