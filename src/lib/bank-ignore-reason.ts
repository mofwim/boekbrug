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

/**
 * [GENEGEERD-TELT] Hoort deze genegeerde regel nog in de boekhouding?
 *
 * ── DE REDEN IS EEN AANTEKENING, BEHALVE WANNEER HET DAT NIET IS ──
 *
 * "Negeren" doet twee heel verschillende dingen, afhankelijk van waaróm. Bij drie van de vijf
 * redenen zegt de eigenaar dat dit geld niet in zijn boeken hoort; bij de vierde zegt hij alleen
 * dat er nooit een factuur bij komt. Die twee als hetzelfde behandelen kost geld, en in beide
 * richtingen:
 *
 *   · Een als `prive` weggezette regel bleef in de kosten staan en zijn BTW in de voorbelasting.
 *     Dat is een aftrek waar geen recht op bestaat — precies de post waar de Belastingdienst naar
 *     kijkt, en de eigenaar heeft zelf aangegeven dat het niet zakelijk was.
 *   · Een als `dubbel` weggezette regel telde zijn kosten en voorbelasting een TWEEDE keer. De
 *     eigenaar heeft de dubbeling gemeld en hij staat er nog steeds in.
 *   · `niet_van_mij` is geld dat nooit van hem was (een bankvergissing, een terugboeking).
 *
 * En de reden die juist WEL moet blijven tellen:
 *
 *   · `geen_factuur` — huur, lease, een abonnement. Een echte zakelijke kost waar alleen nooit een
 *     factuur bij komt. Die uit de boeken halen zou de kosten verlagen, de winst verhogen en de
 *     eigenaar te veel belasting laten betalen. Dat is de duurste van de twee fouten, en dit is
 *     verreweg de meest gekozen reden.
 *
 * ── WAAROM `anders` EN "GEEN REDEN" BLIJVEN TELLEN ──
 *
 * Ze zeggen niets over de aard van het bedrag, en de veilige richting bij onwetendheid is: laat
 * staan wat er staat. Uitsluiten zou stilzwijgend kosten uit reeds ingediende kwartalen halen op
 * grond van een aanname die de eigenaar nooit heeft gedaan. Toen dit werd geschreven stond er in
 * de productiedatabase precies één genegeerde regel, en die had geen reden — dus verandert deze
 * regel aan geen enkel bestaand cijfer iets, en pakt hij vanaf de volgende keer wel.
 *
 * Het gevolg staat vanaf nu ook op het scherm bij de keuze zelf: een reden die geld uit de boeken
 * haalt mag geen aantekening lijken.
 */
export function ignoredLineCountsInBooks(reason: string | null | undefined): boolean {
  switch (toBankIgnoreReason(reason)) {
    case 'prive':
    case 'dubbel':
    case 'niet_van_mij':
      return false
    // 'geen_factuur' is een echte kost; 'anders' en null zeggen niets. Beide blijven tellen.
    default:
      return true
  }
}

/**
 * [GENEGEERD-TELT] De twee groepen redenen, als de LABELS die op de knoppen staan.
 *
 * Afgeleid van ignoredLineCountsInBooks in plaats van naast die regel opgeschreven. Een zin die
 * zegt "Privé haalt het bedrag uit je kosten" terwijl de regel het er laat staan is erger dan geen
 * zin: de eigenaar neemt dan een besluit op grond van iets dat niet gebeurt.
 *
 * En het zijn de labels zoals ze op het scherm staan, niet vertaalde omschrijvingen — AGENTS.md:
 * een zin die naar een knop wijst noemt die knop zoals hij geschreven is, anders zoekt de lezer
 * naar een woord dat nergens in de interface staat.
 */
export function ignoreReasonGroups(): { excluded: string[]; kept: string[] } {
  const excluded: string[] = []
  const kept: string[] = []
  for (const r of BANK_IGNORE_REASONS) {
    ;(ignoredLineCountsInBooks(r) ? kept : excluded).push(BANK_IGNORE_REASON_LABELS[r].label)
  }
  return { excluded, kept }
}

/** Het korte label voor het Genegeerd-tabblad. Onbekend/leeg → null (dan toont het scherm niets). */
export function bankIgnoreReasonLabel(reason: string | null | undefined): string | null {
  const r = toBankIgnoreReason(reason)
  return r ? BANK_IGNORE_REASON_LABELS[r].label : null
}
