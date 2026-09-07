// src/lib/iban-change-text.ts
// [BETAALMOMENT] The IBAN-change vocabulary, in a module a SCREEN is allowed to import.
//
// ── WHY THIS FILE EXISTS, AND WHY IT IS NOT NEW ──
//
// Every line below already existed — inside src/lib/iban-change.ts, which opens a Supabase client
// and reports handled failures. A client component importing that pulls server code into the
// browser bundle, so the screen that most needs these words could not have them.
//
// It is the same move locale.ts made out of blog.ts, for the same reason and with the same result:
// iban-change.ts re-exports these names, so every existing import keeps working, unchanged.
//
// ── WHY THE SCREEN NEEDS THEM ──
//
// Invoice-redirect fraud is defeated at exactly one moment: showing the account change while the
// owner is about to pay. Everything else about such an invoice is right by construction — amount,
// number, btw, date are copied from a real bill — so this is the one axis carrying a signal, and
// it is the axis every other check reads as clean.
//
// Measured on Enka Horeca 26713540 (€ 1.559,97, unpaid, due 27 September): the supplier was known
// at NL89RABO0322814162 and that invoice prints NL61INGB0116981407. The finding existed, the
// sentence existed, and on the screen the owner pays from it was reachable only by opening a sheet
// behind a button labelled "Bekijk PDF".

/** Het oude en het nieuwe nummer, allebei genormaliseerd. */
export interface IbanChange {
  /** Het IBAN dat we al van deze leverancier kenden. */
  from: string
  /** Het IBAN dat op DEZE factuur staat. */
  to: string
}

/** "NL91 ABNA 0417 1643 00" — in blokken van vier, zoals het op een factuur staat. */
export function formatIban(iban: string): string {
  return (iban.match(/.{1,4}/g) ?? [iban]).join(' ')
}

/**
 * De zin die de eigenaar leest. Eén bron, zodat de wachtrij, de kaart en een toekomstige
 * melding niet ieder hun eigen formulering krijgen.
 *
 * De instructie is het belangrijkste deel: bellen op een zelf opgezocht nummer. Een gewaarschuwde
 * eigenaar die het nummer BELT dat op de vervalste factuur staat, belt de fraudeur.
 */
export function ibanChangeReason(change: IbanChange): string {
  return (
    `deze leverancier gebruikte eerder rekeningnummer ${formatIban(change.from)}, ` +
    `en op deze factuur staat ${formatIban(change.to)} — controleer dit vóór je betaalt, ` +
    `en bel de leverancier op een nummer dat je zelf opzoekt (niet het nummer op deze factuur)`
  )
}

/** The stored block this reads. Everything optional — a row from before the field existed has none. */
export interface StoredIbanChangeSource {
  _safecore?: {
    iban_changed?: boolean
    iban_changed_from?: string | null
    iban_changed_to?: string | null
  } | null
}

/**
 * [BETAALMOMENT] The change as it was STORED at import, for the screens that read a row rather
 * than run the check.
 *
 * assessIbanChange (in iban-change.ts) answers the question at IMPORT, against the registry. This
 * answers it afterwards, from what that decision wrote down — and it is a separate function
 * because the two have different failure modes: the import-time one can find nothing to compare
 * with, while this one can meet a row written before `iban_changed_from` was recorded.
 *
 * `iban_changed === true` is the whole condition; the numbers are carried when they are there.
 * A change whose "from" was never stored is STILL a change: returning null because a field is
 * missing would hide the finding on exactly the oldest rows, which are the ones nobody re-reads.
 * Callers that need both numbers ask for them and say something else when they are absent.
 */
export function storedIbanChange(
  fc: StoredIbanChangeSource | null | undefined,
): { from: string | null; to: string | null } | null {
  const sc = fc?._safecore
  if (!sc || sc.iban_changed !== true) return null
  const clean = (v: string | null | undefined): string | null => {
    const s = (v ?? '').trim()
    return s.length > 0 ? s : null
  }
  return { from: clean(sc.iban_changed_from), to: clean(sc.iban_changed_to) }
}
