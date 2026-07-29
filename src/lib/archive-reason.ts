// src/lib/archive-reason.ts
// [NEGEER-REDEN] Waarom is deze factuur genegeerd?
//
// Het tabblad Genegeerd was tot nu toe een lijst zonder geheugen. Een factuur belandde erin en
// drie maanden later — bij de kwartaalafsluiting, of als de leverancier belt — stond daar een
// bedrag zonder één woord waarom het daar stond. De eigenaar moet dan opnieuw de hele afweging
// maken die hij ooit al gemaakt heeft, met minder informatie dan toen.
//
// Eén klik bij het negeren lost dat op. Bewust een KORTE lijst: hoe langer de lijst, hoe groter
// de kans dat er zomaar iets gekozen wordt, en dan is het antwoord slechter dan geen antwoord.
// Deze vier dekken wat er in de praktijk gebeurt met een inkomende factuur, en ze zijn ook precies
// de verdeling die ertoe doet:
//
//   · dubbel        → de factuur is echt, maar staat al ergens. Zegt iets over de IMPORT.
//   · niet_van_mij  → de factuur is echt, maar niet van deze onderneming. Zegt iets over de MAILBOX.
//   · geen_factuur  → het was helemaal geen boekbaar stuk. Zegt iets over de AFZENDER — en dit is
//                     de reden die een afzenderregel rechtvaardigt: wie drie keer een reclamemail
//                     stuurt, stuurt de vierde ook.
//   · anders        → eerlijk niets beweren is beter dan een vakje verkeerd aankruisen.
//
// De reden is een NOTITIE, geen besluit: hij verandert niets aan wat er met de factuur gebeurt
// (archiveren blijft archiveren, terugzetten blijft mogelijk) en telt nergens in de cijfers mee.
// Daarom mag hij ook ontbreken — bij een oude rij, of als de eigenaar geen zin heeft in de vraag.

export const ARCHIVE_REASONS = ['dubbel', 'niet_van_mij', 'geen_factuur', 'anders'] as const

export type ArchiveReason = (typeof ARCHIVE_REASONS)[number]

/** Wat de eigenaar in het keuzelijstje leest, met de subtekst die de keuze eenduidig maakt. */
export const ARCHIVE_REASON_LABELS: Record<ArchiveReason, { label: string; hint: string }> = {
  dubbel: {
    label: 'Dubbel',
    hint: 'deze factuur staat al in mijn boekhouding',
  },
  niet_van_mij: {
    label: 'Niet van mij',
    hint: 'privé, of aan de verkeerde ontvanger gestuurd',
  },
  geen_factuur: {
    label: 'Geen factuur',
    hint: 'reclame, offerte, rekeningoverzicht of nieuwsbrief',
  },
  anders: {
    label: 'Anders',
    hint: 'geen van bovenstaande',
  },
}

/** Het korte label voor het Genegeerd-tabblad. Onbekend/leeg → null (dan toont het scherm niets). */
export function archiveReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null
  return isArchiveReason(reason) ? ARCHIVE_REASON_LABELS[reason].label : null
}

/**
 * Serverkant: is dit een reden die we kennen? Alles wat we niet kennen wordt null — een
 * onbekende waarde uit een oude of geknutselde client mag nooit als notitie in de database
 * belanden, en mag de archivering al helemaal niet laten mislukken.
 */
export function isArchiveReason(v: unknown): v is ArchiveReason {
  return typeof v === 'string' && (ARCHIVE_REASONS as readonly string[]).includes(v)
}

/** Normaliseer wat de client stuurde naar een opslagbare waarde. */
export function normalizeArchiveReason(v: unknown): ArchiveReason | null {
  return isArchiveReason(v) ? v : null
}
