// src/lib/uren-refusal.ts
// [SERVER-ZIN] The sentence behind each reason /api/uren can refuse an hour. Pure.
//
// The route used to carry these as Dutch literals. That is right for a Dutch owner and wrong for
// every other one: the screen shows a server sentence as it is (server-message.ts), so an Arabic
// interface put "Vul in hoeveel uur je gewerkt hebt." in a toast. The sentences now live in the
// catalogue and the route translates them with the language of whoever is typing.
//
// Written as literal keys, not assembled from the code: the [TAAL] gate looks for each declared key
// as a literal string to prove it is rendered somewhere.

import type { MessageKey } from '@/lib/i18n/messages'
import type { TimeEntryRefusal } from '@/lib/uren'

/** One catalogue key per refusal. Typed against both sides, so a new refusal without a sentence is a build error. */
export const UREN_REFUSAL_KEY: Record<TimeEntryRefusal, MessageKey> = {
  no_date: 'uren.fout.geenDatum',
  bad_date: 'uren.fout.geenBestaandeDatum',
  no_description: 'uren.fout.geenOmschrijving',
  description_too_long: 'uren.fout.omschrijvingTeLang',
  no_hours: 'uren.fout.geenUren',
  hours_too_many: 'uren.fout.teVeelUren',
  bad_rate: 'uren.fout.tariefGeenBedrag',
}
