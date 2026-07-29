// src/lib/reminder-original.ts
// [HERINNERING-ORIGINEEL] Een herinnering waarvan we het origineel AL hebben, is geen kost.
//
// De hele Nederlandse escalatieladder — betalingsherinnering, aanmaning, sommatie,
// ingebrekestelling, WIK-brief — gaat over een factuur die je al hoort te hebben. Geen van die
// documenten is een NIEUWE kost. Ze in de wachtrij zetten kost de eigenaar elke keer een
// beoordeling van iets dat hij al beoordeeld heeft.
//
// Maar "nooit importeren" is óók fout, en dat is de reden dat dit bestand bestaat in plaats van
// één regel die herinneringen weggooit. Een Nederlandse betalingsherinnering herhaalt de HELE
// factuur: nummer, datum, bedragen, btw. Als de originele factuur nooit is aangekomen — spam,
// ontbrekende bijlage, leverancier die hem vergat — dan is die herinnering het ENIGE bewijs dat
// de eigenaar heeft van een echte, aftrekbare kost. Weggooien betekent dan: voorbelasting kwijt,
// stil, zonder spoor. Precies de schade waar deze app tegen bestaat.
//
// Dus wordt er één vraag gesteld, en die vraag is te beantwoorden met gegevens die er al liggen:
//
//     Staat de factuur waar deze herinnering over gaat al in de boeken?
//
//   JA  → niet importeren. Het is geen tweede kost, en de eigenaar heeft er niets aan.
//         Wel verantwoorden in de skip-registry, met het factuurnummer erin, zodat "waar is die
//         herinnering gebleven" altijd te beantwoorden is.
//   NEE → importeren, mét de herinneringsvlag. Misschien is dit het enige bewijs; de mens beslist.
//
// Het antwoord hangt aan `reminder_of_invoice_number`, dat de uitlezer al teruggaf maar dat tot nu
// toe alleen in een melding belandde. Er werd nooit iets mee gedaan.

import { normalizeInvoiceNumber } from '@/lib/safecore'

/** Wat we van de herinnering weten. Beide velden mogen ontbreken. */
export interface ReminderFacts {
  isReminder?: boolean | null
  /** Het nummer van de ORIGINELE factuur, zoals de uitlezer het teruggaf. */
  reminderOfInvoiceNumber?: string | null
}

export type ReminderDecision =
  /** Geen herinnering, of we weten niet waar hij over gaat → gewoon de normale weg. */
  | { action: 'import' }
  /** Herinnering waarvan het origineel nog niet in de boeken staat → importeren, wél gevlagd. */
  | { action: 'import-flagged' }
  /** Herinnering waarvan het origineel al geboekt is → overslaan, mét verantwoording. */
  | { action: 'skip'; originalNumber: string; reason: string }

/**
 * Puur. `knownInvoiceNumbers` is de verzameling factuurnummers die deze gebruiker al heeft, al
 * genormaliseerd door de aanroeper (zie normalizeInvoiceNumber — die vangt "26 / 3958" ≡ "26/3958",
 * en dat is precies de variatie die een herinnering introduceert doordat hij het nummer opnieuw
 * afdrukt in een andere lay-out).
 */
export function decideReminder(
  facts: ReminderFacts,
  knownInvoiceNumbers: ReadonlySet<string>,
): ReminderDecision {
  if (facts.isReminder !== true) return { action: 'import' }

  const raw = (facts.reminderOfInvoiceNumber ?? '').trim()
  if (!raw) {
    // Een herinnering die niet zegt waar hij over gaat, kunnen we niet nakijken. Dan importeren we
    // hem gevlagd: de mens ziet "dit lijkt een herinnering" en beslist zelf. Nooit overslaan op
    // een vermoeden — dat is de kant waar geld verdwijnt.
    return { action: 'import-flagged' }
  }

  const key = normalizeInvoiceNumber(raw)
  if (!key) return { action: 'import-flagged' }

  if (knownInvoiceNumbers.has(key)) {
    return {
      action: 'skip',
      originalNumber: raw,
      reason: reminderSkipReason(raw),
    }
  }

  // Het origineel is er NIET. Deze herinnering kan het enige bewijs van de kost zijn.
  return { action: 'import-flagged' }
}

/** De verantwoording in de skip-registry. Noemt het nummer, zodat het na te lopen is. */
export function reminderSkipReason(originalNumber: string): string {
  return (
    `herinnering voor factuur ${originalNumber} — die factuur staat al in je boekhouding, ` +
    `dus deze herinnering is niet als tweede kost geïmporteerd`
  )
}
