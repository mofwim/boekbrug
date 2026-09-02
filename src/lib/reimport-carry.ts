// src/lib/reimport-carry.ts
// [REIMPORT-CARRY] Wat blijft er staan als een factuur OPNIEUW wordt ingelezen? Puur, geen I/O.
// Run: npx tsx --test src/lib/reimport-carry.test.ts
//
// WAAROM DIT EEN EIGEN BESTAND IS
// "Opnieuw inlezen" bestaat om een slechte AI-lezing te herstellen. Maar de route verving
// `_safecore` in zijn geheel door het verse rekenoordeel — en in dat ene object wonen DRIE
// soorten waarheid door elkaar:
//
//   1. het REKENOORDEEL (arithmetic_ok / reason / flags / held_at) — gaat over de bedragen,
//      dus een verse lezing is daar de baas;
//   2. de DUBBEL-SIGNALEN (possible_duplicate*, dedup, dedup_reason) — gaan over de RELATIE
//      met een ándere factuur. De re-import draait geen enkele dedup-query, dus een verse
//      lezing kan die niet opnieuw afleiden. Ze verdwenen dus gewoon;
//   3. het HERINNERINGS-signaal (reminder, reminder_of) — dat de verse lezing juist wél
//      opnieuw bepaalt.
//
// Gevolg van (2): een factuur met "mogelijk dubbel met X" werd door één druk op de knop
// schoon. classifyImportHealth zag geen vlag meer, de rij mocht weer auto-boeken, en dezelfde
// kostenpost kon een tweede keer de administratie in. De knop die het vertrouwen moest
// herstellen, wiste juist het signaal dat om aandacht vroeg — zonder melding, en zonder dat er
// iets op het scherm veranderde behalve dat de waarschuwing weg was.
//
// De `_dedup*`-tak in de oude carry-lus was daarbij dode code: geen enkele schrijver zet een
// top-level sleutel die zo begint. Dedup woont IN `_safecore`.

/** De sleutels binnen `_safecore` die over het REKENWERK gaan — de verse lezing is hier de baas. */
const ARITHMETIC_KEYS = ["arithmetic_ok", "reason", "flags", "held_at"] as const;

/**
 * De sleutels op het TOP-niveau van field_confidence die de OPGESLAGEN bedragen verklaren.
 *
 * Ze horen bij de bedragen, niet bij de lezing: blijven de bedragen staan, dan blijft de
 * verklaring staan. Wie hier een nieuwe soort verklaring toevoegt en deze lijst vergeet, laat hem
 * bij een mislukte herlezing verdampen terwijl de bedragen die hij verklaart gewoon blijven staan.
 */
const AMOUNT_EXPLAINING_KEYS: readonly string[] = [
  "_btw_derived",     // [BTW-SUM-FIX] de BTW is onze rekensom, niet die van de factuur
  "_btw_rows",        // [BTW-SPLIT]   de btw-specificatie zoals die op het papier staat
  "_total_printed",   // [PRINTED-TOTAL] het gedrukte te-betalen totaal, dat afwijkt van het onze
  "_total_derived",   // [PRINTED-TOTAL] wij hebben één van de drie bedragen zelf uitgerekend
  // [STATIEGELD-GAT] Precies het geval waar de regel hierboven voor is geschreven, en het werd bij
  // het toevoegen van de sleutel vergeten. Deze verklaart het GAT in de opgeslagen bedragen: "het
  // verschil van € 176,40 staat op de factuur als Statiegeld". Blijven die bedragen staan, dan
  // staat het gat er ook nog — maar de verklaring én de één-tik-oplossing waren na één druk op
  // "Opnieuw inlezen" weg, en de controlelijst viel terug op het botte "excl. + btw komt niet uit
  // op het totaal". De knop die het lezen moest verbeteren maakte de factuur dan minder begrijpelijk
  // dan ervoor.
  "_statiegeld",
];

/**
 * [INCASSO-ONGEDAAN] De sleutels die vastleggen wat de APP heeft gedaan, niet wat er op het papier
 * staat. Die overleven een herlezing ALTIJD, en om een andere reden dan alle lijsten hierboven.
 *
 * AMOUNT_EXPLAINING_KEYS blijven staan zolang de bedragen blijven staan — komen er verse bedragen,
 * dan gaat de oude verklaring terecht mee weg. Deze sleutel werkt precies andersom. `_auto_incasso`
 * zegt niet iets over het document; het zegt dat wij deze factuur ooit automatisch als betaald
 * hebben geboekt. Opnieuw naar de pdf kijken kan dat feit niet opnieuw afleiden en kan het ook niet
 * weerleggen. Het is een audit-spoor, net als `_intake_paid_evidence` een paar regels hoger, en om
 * dezelfde reden onaantastbaar.
 *
 * Waarom het geld kost als hij toch verdwijnt. incassoDecision houdt sinds vandaag een factuur
 * tegen die OPEN staat én deze sleutel draagt: die combinatie kan maar één ding betekenen — wij
 * hebben hem geboekt en iemand heeft hem teruggezet, meestal na een storno, precies zoals de
 * melding van de cron zelf voorstelt. De idempotentie-sleutel zelf staat in de bank_tx_invoices-rij
 * die het ongedaan maken juist weghaalt, dus dit merkteken is wat er nog over is. Valt het weg bij
 * een druk op "Opnieuw inlezen", dan is de factuur weer een gewone openstaande factuur van een
 * gemarkeerde leverancier en boekt de eerstvolgende cron-ronde het hele bedrag opnieuw — uurlijks,
 * op een afschrijving die is teruggedraaid.
 *
 * De kop van AMOUNT_EXPLAINING_KEYS waarschuwt hier woordelijk voor ("wie hier een nieuwe soort
 * verklaring toevoegt en deze lijst vergeet…") en `_statiegeld` is het bewijs dat het al een keer
 * is gebeurd. Dit is dezelfde vergissing, maar dan met een boeking eraan.
 */
const ACTION_TRAIL_KEYS: readonly string[] = [
  "_auto_incasso",    // [AUTO-INCASSO] wij hebben deze factuur zelf als betaald geboekt
];

/**
 * [SAFECORE-BLIJFT] De enige sleutels in `_safecore` die de VERSE lezing bezit.
 *
 * Alles wat hier NIET in staat, blijft staan. Dat is de omgekeerde regel van hiervoor, en de
 * omkering is de hele correctie.
 *
 * Wat er stond: een witte lijst van relatie- en rekensleutels, en `_safecore` werd verder van nul
 * opgebouwd. Elke andere waarschuwing verdampte dus bij één druk op "Opnieuw inlezen" — en de
 * herleesroute leidt er géén van opnieuw af:
 *
 *   · iban_changed / _from / _to     het rekeningnummer van deze leverancier is gewijzigd
 *   · iban_check_unavailable         die controle kon niet draaien
 *   · multiple_invoices              dit bestand droeg meer dan één factuur
 *   · one_invoice_unverified         we konden dit document niet nakijken
 *   · credit_word_in_header          "creditnota" stond in de kop
 *
 * En het is erger dan een gat: invoice-checks.ts zegt bij een ontbrekende iban_changed niet niets,
 * maar het TEGENDEEL — "ongewijzigd ten opzichte van eerdere facturen" — op een factuur waarvan
 * het rekeningnummer wél veranderde. Het ene signaal dat tussen de eigenaar en een omgeleide
 * betaling staat, wordt dan omgedraaid tot een geruststelling.
 *
 * Een witte lijst vergeet; een zwarte lijst kan alleen te veel bewaren. Bij een waarschuwing is
 * te veel bewaren de goedkope kant: die ziet de eigenaar en klikt hij weg. De andere kant ziet
 * niemand.
 *
 * Wat de verse lezing wél bezit, en waarom:
 *   · het rekenoordeel — verse bedragen geven een vers oordeel, inclusief het OPHEFFEN van een
 *     oude hold. Zonder dat kan een terecht gecorrigeerde factuur nooit meer schoon worden.
 *   · de herinneringsvlag — deze knop bestaat er juist voor om een ten onrechte gezette
 *     "dit is een herinnering" weer weg te halen. Meedragen maakt hem onherstelbaar.
 *
 * De relatiesleutels (possible_duplicate*, dedup*) hoeven hier niet meer bij naam te staan: ze
 * overleven nu omdat álles overleeft. [SUPERSEDE] blijft daarmee even hard gedekt als voorheen.
 */
const FRESH_OWNS: ReadonlySet<string> = new Set([
  "arithmetic_ok",
  "reason",
  "flags",
  "held_at",
  "reminder",
  "reminder_of",
]);

/** Het rekenoordeel zoals evaluateArithmetic het teruggeeft. */
export interface ArithmeticVerdict {
  ok: boolean;
  reason?: string;
  flags?: string[];
}

export interface ReimportCarryInput {
  /** field_confidence zoals het nu in de database staat. */
  priorFc: Record<string, unknown> | null;
  /** De per-veld zekerheden uit de VERSE AI-lezing. */
  aiConfidence: Record<string, unknown> | null;
  /** Zijn er bruikbare verse bedragen? Zo nee, dan blijven de OPGESLAGEN bedragen staan. */
  freshHasTotal: boolean;
  /** Het verse rekenoordeel over die verse bedragen; null als er geen verse bedragen zijn. */
  verdict: ArithmeticVerdict | null;
  /** Tijdstempel voor een nieuw hold — meegegeven, zodat deze module puur blijft. */
  heldAt: string;
  /** Zag de VERSE lezing een betalingsherinnering? */
  freshIsReminder: boolean;
  /** Het originele factuurnummer waar die herinnering bij hoort. */
  freshReminderOf: string | null;
}

/**
 * Bouwt het nieuwe field_confidence voor een opnieuw ingelezen factuur.
 *
 * Retourneert null als er niets te bewaren valt (dan hoort de kolom leeg te zijn).
 */
export function buildReimportFieldConfidence(input: ReimportCarryInput): Record<string, unknown> | null {
  const { priorFc, aiConfidence, freshHasTotal, verdict, heldAt, freshIsReminder, freshReminderOf } = input;

  const carried: Record<string, unknown> = {};
  const priorSafecore = asRecord(priorFc?._safecore);

  if (priorFc) {
    for (const k of Object.keys(priorFc)) {
      // De camera-hints beschrijven hoe het document binnenkwam; een herlezing verandert daar
      // niets aan. (Ook _intake_paid_evidence en _intake_paid_card4 horen hierbij: dat is het
      // bewijs waarop de betaalwijze rust — een audit-spoor dat niet mag verdampen.)
      if (k.startsWith("_intake")) carried[k] = priorFc[k];
      // [INCASSO-ONGEDAAN] Wat de app heeft gedaan, onvoorwaardelijk — zie ACTION_TRAIL_KEYS.
      // Bewust NIET achter `!freshHasTotal`: een verse lezing met bedragen erin zegt nog steeds
      // niets over de vraag of wij ooit een incasso hebben geboekt.
      else if (ACTION_TRAIL_KEYS.includes(k)) carried[k] = priorFc[k];
      // [BTW-SUM-FIX] / [BTW-SPLIT] / [PRINTED-TOTAL] Deze sleutels verklaren de OPGESLAGEN
      // bedragen: "deze BTW is van ons, niet van de factuur", "de btw-specificatie op het papier
      // telt op tot iets anders", "op de factuur staat een ander te betalen totaal", "het derde
      // bedrag hebben wij zelf uitgerekend". Blijven die bedragen staan, dan moet de verklaring
      // meegaan; komen er verse bedragen, dan gaat de verklaring met de oude bedragen mee weg.
      //
      // Zonder deze regel doet de knop "Opnieuw inlezen" precies het verkeerde bij een lezing die
      // NIETS oplevert: de bedragen blijven ongewijzigd staan, maar de verse (lege) aiConfidence
      // overschrijft de basis en de verklaring verdwijnt — een vastgehouden factuur wordt dan weer
      // schoon zonder dat er iets aan is veranderd. Dat is de gevaarlijke richting.
      else if (!freshHasTotal && AMOUNT_EXPLAINING_KEYS.includes(k)) carried[k] = priorFc[k];
    }
  }

  // ── _safecore, per soort waarheid opnieuw samengesteld ──────────────────────────────────
  const safecore: Record<string, unknown> = {};

  // (2) Alles wat er stond blijft staan — behalve wat de verse lezing bezit. Zie FRESH_OWNS.
  if (priorSafecore) {
    for (const k of Object.keys(priorSafecore)) {
      if (!FRESH_OWNS.has(k)) safecore[k] = priorSafecore[k];
    }
  }

  // (1) Het rekenoordeel. Verse bedragen → vers oordeel (en een schone lezing laat geen oud
  // hold staan). Geen verse bedragen → de opgeslagen bedragen zijn ongewijzigd, dus het oude
  // oordeel geldt onverkort.
  if (freshHasTotal) {
    if (verdict && !verdict.ok) {
      safecore.arithmetic_ok = false;
      if (verdict.reason !== undefined) safecore.reason = verdict.reason;
      if (verdict.flags !== undefined) safecore.flags = verdict.flags;
      safecore.held_at = heldAt;
    }
  } else if (priorSafecore) {
    for (const k of ARITHMETIC_KEYS) {
      if (k in priorSafecore) safecore[k] = priorSafecore[k];
    }
  }

  // (3) De herinnering komt van de VERSE lezing — nooit blind overgenomen. Dat is precies wat
  // deze knop hoort te kunnen: een ten onrechte gezette herinneringsvlag weer weghalen. Zou je
  // hem meedragen, dan is die vlag onherstelbaar door het enige middel dat ervoor bestaat.
  if (freshIsReminder) {
    safecore.reminder = true;
    if (freshReminderOf) safecore.reminder_of = freshReminderOf;
  }

  if (Object.keys(safecore).length > 0) carried._safecore = safecore;

  const merged = { ...(aiConfidence ?? {}), ...carried };
  return Object.keys(merged).length > 0 ? merged : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
