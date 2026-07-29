// src/lib/sender-rules.ts
// [AFZENDERREGEL] "Altijd negeren van deze afzender."
//
// Het probleem is klein en het herhaalt zich eindeloos. Er zit één adres in de mailbox dat elke
// week een PDF stuurt die geen boekbaar stuk is: een reclamemail met een prijslijst, een
// nieuwsbrief met een bijlage, een rekeningoverzicht van een partij waar niets mee geboekt hoeft
// te worden. De AI leest hem, de wachtrij toont hem, de eigenaar negeert hem. Volgende week weer.
//
// Eén regel maakt daar een eind aan. En bewust ÉÉN soort regel: overslaan. Geen categorieën, geen
// btw-standaarden, geen automatisch doorboeken — dat is het soort regelsysteem dat groot begint te
// worden en waarvan de eigenaar op een dag niet meer weet waarom een factuur ergens in belandde.
// Een regel die alleen maar iets NIET importeert, kan hooguit één fout maken (te veel overslaan),
// en die fout is zichtbaar en met één tik terug te draaien.
//
// DRIE HEKKEN, omdat dit het enige mechanisme in de app is dat facturen ONGEZIEN wegneemt:
//
//   1. Wat overgeslagen wordt, komt in de skip-registry — dezelfde lijst die al elke niet-
//      geïmporteerde bijlage verantwoordt ("Overgeslagen bij import, en waarom"). Overslaan is
//      dus nooit onzichtbaar; het is alleen niet meer in de weg.
//   2. Het BESTAND blijft. Alleen de factuur-import wordt overgeslagen, de mail zelf blijft in
//      de mailbox staan. Er gaat niets verloren dat er anders wel was.
//   3. De regel is per adres, nooit per domein. "@kpn.com" zou de reclamemail én de echte
//      telefoonrekening treffen. Een adres is een adres.
//
// De regel wordt ook nooit uit zichzelf voorgesteld bij een factuur die de eigenaar negeert omdat
// hij DUBBEL is of NIET VAN HEM — dat zijn eigenschappen van die ene factuur, niet van de
// afzender. Alleen "geen factuur" zegt iets over wat dit adres structureel stuurt.

/**
 * Het adresdeel uit een From-kop, genormaliseerd naar kleine letters.
 * `"KPN Zakelijk" <Noreply@KPN.com>` → `noreply@kpn.com`
 *
 * Geeft null als er geen bruikbaar adres in staat — dan mag er geen regel op gemaakt worden,
 * want een regel op rommel matcht onvoorspelbaar.
 */
export function normalizeSenderEmail(from: string | null | undefined): string | null {
  if (!from) return null
  const raw = String(from).trim()
  if (!raw) return null
  // `Naam <adres>` → adres; anders het hele veld.
  const angled = raw.match(/<([^>]+)>/)
  const candidate = (angled ? angled[1] : raw).trim().toLowerCase()
  // Minimaal iets@iets.iets — geen spaties. Bewust streng: liever geen regel dan een regel die
  // op het verkeerde matcht.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return null
  return candidate
}

/** Wordt deze afzender overgeslagen? Vergelijkt genormaliseerd, dus hoofdletters/opmaak doen niet mee. */
export function senderIsBlocked(from: string | null | undefined, blocked: ReadonlySet<string>): boolean {
  const email = normalizeSenderEmail(from)
  return email !== null && blocked.has(email)
}

/** De reden die in de skip-registry belandt, zodat "waar is die bijlage gebleven" altijd te beantwoorden is. */
export function blockedSenderSkipReason(email: string): string {
  return `overgeslagen door je eigen regel: altijd negeren van ${email} — je kunt die regel opheffen bij Genegeerd`
}

/**
 * Mag het scherm een regel VOORSTELLEN na deze negeer-actie?
 *
 * Alleen bij 'geen_factuur': dat is de enige reden die iets zegt over wat dit ADRES stuurt.
 * 'dubbel' en 'niet_van_mij' gaan over deze ene factuur — daar een blijvende regel van maken
 * zou echte facturen laten verdwijnen. 'anders' is per definitie te vaag om op te bouwen.
 *
 * En natuurlijk alleen als er een echt adres is om de regel op te hangen.
 */
export function mayOfferSenderRule(reason: string | null | undefined, from: string | null | undefined): boolean {
  return reason === 'geen_factuur' && normalizeSenderEmail(from) !== null
}
