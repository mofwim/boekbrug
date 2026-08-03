// src/lib/iban-change.ts
// [IBAN-WISSEL] Een bekende leverancier die ineens een ANDER rekeningnummer op zijn factuur zet.
//
// Waarom dit een eigen poort verdient, en niet zomaar een extra veldje:
//
// Dit is de handtekening van factuurfraude. De aanval is oud en werkt nog steeds: iemand
// onderschept of imiteert de mail van een leverancier die je al maanden betaalt, verandert
// één regel — het IBAN — en laat de rest staan. Bedrag klopt, nummer klopt, briefhoofd klopt,
// de btw klopt. Elke controle die dit systeem al doet, geeft groen: de rekensom klopt, het is
// geen duplicaat, de datum is er, de leverancier is bekend. Precies daarom glipt hij erdoor.
//
// Het enige wat NIET klopt is het rekeningnummer, en dat is exact het gegeven dat de
// leveranciersregistratie al bijhoudt: `suppliers.iban` is daar de STERKSTE identiteitssleutel.
// De gegevens liggen er dus al; er werd alleen nooit een vraag over gesteld.
//
// Wat er vandaag zonder deze poort gebeurt (nagelopen in resolveSupplierForImport): een factuur
// met een nieuw IBAN vindt géén rij op dat IBAN, en de KVK- en naam-adoptie eisen allebei
// `iban IS NULL` — dus die bestaande rij mét IBAN wordt niet geraakt. Resultaat: er komt stilletjes
// een TWEEDE leveranciersrij bij (of de KVK-index vangt hem af), en de eigenaar hoort er niets over.
// Hij ziet een factuur van een vertrouwde naam en tikt het nummer over in zijn bank.
//
// GEEN BLOKKADE. Een IBAN-wissel is soms gewoon echt: een leverancier stapt over van bank, of
// gaat over in een andere BV. Blokkeren zou een echte factuur onbetaalbaar maken. Dus dit vlagt,
// zoals elke andere poort in dit systeem vlagt (Pijler ⑤: het oog bevestigt, het voert niet in).
// De eigenaar krijgt beide nummers naast elkaar te zien en één instructie die hem redt:
// bel de leverancier op een nummer dat je zelf opzoekt — niet op het nummer dat op deze factuur staat.
//
// Best-effort, net als de registratie zelf: één indexed query, en elke fout betekent "geen
// melding", nooit een mislukte import.

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeIban, supplierNameKey, isReliableSupplierName, normalizeKvk } from '@/lib/supplier-registry'
// [ALARM] Opgevangen fouten die tóch iemand moeten bereiken — zie report-handled.ts.
import { reportHandledFailure } from '@/lib/report-handled'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>

/** Het oude en het nieuwe nummer, allebei genormaliseerd. */
export interface IbanChange {
  /** Het IBAN dat we al van deze leverancier kenden. */
  from: string
  /** Het IBAN dat op DEZE factuur staat. */
  to: string
}

/**
 * De uitkomst van de IBAN-controle, inclusief het geval dat hij NIET KON DRAAIEN.
 *
 * Dat derde geval is het hele punt van dit type. Eerder gaven "deze leverancier is nieuw", "het
 * nummer is ongewijzigd" en "de leveranciersregistratie was onbereikbaar" alle drie `null` terug,
 * en `null` betekent: geen waarschuwing. Bij factuurfraude klopt de rekensom juist wél — het
 * gewijzigde rekeningnummer is het enige signaal — dus een stil overgeslagen controle is precies
 * de dure fout.
 */
export type IbanCheck =
  | { status: 'ok'; change: IbanChange | null }
  | { status: 'unavailable' }

/** "NL91 ABNA 0417 1643 00" — in blokken van vier, zoals het op een factuur staat. */
export function formatIban(iban: string): string {
  return (iban.match(/.{1,4}/g) ?? [iban]).join(' ')
}

/**
 * Puur: is het gedrukte IBAN een WISSEL ten opzichte van wat we al kenden?
 *
 * Alleen waar als we allebei de nummers hebben én ze verschillen. Een eerste IBAN voor een
 * leverancier die we nog zonder kenden is GEEN wissel — dat is de registratie die rijker wordt,
 * en daar een waarschuwing van maken zou het signaal in ruis verdrinken.
 */
export function assessIbanChange(
  printed: string | null | undefined,
  known: string | null | undefined,
): IbanChange | null {
  const to = normalizeIban(printed)
  const from = normalizeIban(known)
  if (!to || !from) return null
  if (to === from) return null
  return { from, to }
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

/**
 * Het IBAN dat we AL kennen voor deze leverancier, gezocht op de sleutels die niet meeveranderen
 * met het rekeningnummer: eerst KVK (wettelijk, uniek), dan de genormaliseerde naamsleutel.
 *
 * Bewust NIET op IBAN zelf — dat is juist het veld dat verdacht is; erop zoeken zou de vraag
 * beantwoorden met zichzelf.
 *
 * THROWS when a lookup could not RUN. `null` means one thing only: we looked and this supplier has
 * no account number on record yet. detectIbanChange turns the throw into a stated 'unavailable'.
 *
 * ── WHY THIS FUNCTION NO LONGER CATCHES ──
 * It used to. The two `if (error) throw` lines below were added precisely so a failed read could
 * not read as "no IBAN on record" — and a `catch { return null }` around the whole body caught
 * them, three lines further down, and returned exactly the null they were written to prevent. The
 * comments said the throw reached detectIbanChange; it never did once.
 *
 * Verified, not assumed: with a stub whose read answers { data: null, error }, detectIbanChange
 * returned { status: 'ok', change: null } — a completed check with nothing to report. On THIS check
 * that sentence means the owner pays whatever account the paper prints. Invoice fraud is the case
 * where everything else on the paper is correct; the changed account number is the only signal
 * there is, so a silently skipped check is the whole of the exposure.
 *
 * So there is no catch. Any failure to complete the lookup — a read error, or anything unforeseen —
 * leaves as a throw and is stated. detectIbanChange is the only caller, and it already handles it.
 */
export async function knownIbanForVendor(
  supabase: Client,
  userId: string,
  vendor: { name?: string | null; kvk?: string | null },
): Promise<string | null> {
  {
    const kvk = normalizeKvk(vendor.kvk)
    if (kvk) {
      // [IBAN-CHECK-HONEST] A dropped error here is the difference between "this supplier has no
      // IBAN on record yet" (normal — first invoice) and "we could not look". Both used to arrive
      // as null, and null means NO FRAUD FLAG on the one check that stands between the owner and a
      // redirected payment. Throw; detectIbanChange turns it into a stated 'unavailable'.
      const { data, error } = await supabase
        .from('suppliers')
        .select('iban')
        .eq('user_id', userId)
        .eq('kvk_number', kvk)
        .not('iban', 'is', null)
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(error.message)
      const hit = (data as { iban: string | null } | null)?.iban
      if (hit) return normalizeIban(hit)
    }

    const cleanName = (vendor.name ?? '').trim()
    // Een onbetrouwbare naam ("Onbekende afzender", een los woord) mag nooit twee echte
    // leveranciers op één hoop gooien — dan zou een normale factuur vals gevlagd worden.
    if (!isReliableSupplierName(cleanName)) return null
    const key = supplierNameKey(cleanName)
    if (!key) return null

    // [IBAN-CHECK-HONEST] Same rule as the kvk lookup above.
    const { data, error } = await supabase
      .from('suppliers')
      .select('iban')
      .eq('user_id', userId)
      .eq('name_key', key)
      .not('iban', 'is', null)
      .order('created_at', { ascending: true }) // de oudste = het nummer waarop al betaald is
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return normalizeIban((data as { iban: string | null } | null)?.iban)
  }
}

/**
 * De hele poort in één aanroep, voor de importpaden: kennen we deze leverancier al onder een
 * ander rekeningnummer? Geeft null als er niets te melden valt.
 */
export async function detectIbanChange(
  supabase: Client,
  userId: string,
  vendor: { name?: string | null; kvk?: string | null; iban?: string | null },
): Promise<IbanCheck> {
  const printed = normalizeIban(vendor.iban)
  // Geen IBAN op de factuur → niets om mee te vergelijken. Dat is een volledig uitgevoerde check
  // met een lege uitkomst, niet een mislukte: er valt niets te controleren.
  if (!printed) return { status: 'ok', change: null }
  try {
    const known = await knownIbanForVendor(supabase, userId, vendor)
    return { status: 'ok', change: assessIbanChange(printed, known) }
  } catch (e) {
    // [IBAN-CHECK-HONEST] Swallowing this used to produce a clean-looking invoice with no flag —
    // which on THIS check means the owner pays whatever account the paper prints, without ever
    // being told the app could not verify it. The import still proceeds (a supplier-registry
    // outage may not stop the books), but it proceeds SAYING so.
    // [ALARM] The one check standing between the owner and a redirected payment did not run. The
    // invoice is flagged on screen, which is right — and a flag the owner may click past is not the
    // same as us knowing our fraud check is down.
    reportHandledFailure({
      tag: 'IBAN-CHECK-HONEST',
      message: 'supplier lookup failed — invoice flagged as unverified',
      severity: 'gate-unavailable',
      context: { userId, error: e instanceof Error ? e.message : String(e) },
    })
    return { status: 'unavailable' }
  }
}
