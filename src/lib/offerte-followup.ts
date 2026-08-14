// src/lib/offerte-followup.ts
// [OFFERTE-OPVOLGING] Een offerte die stil verloopt. Puur, geen I/O.
// Run: npx tsx --test src/lib/offerte-followup.test.ts
//
// ── HET GAT ──
//
// Op elke offerte-PDF staat "Geldig tot", met de datum erachter. Het is het enige wat op dat
// document een termijn stelt, de klant leest het, en de app weet er NIETS van. Geen badge, geen
// filter, geen signaal — en de herinneringscron sluit offertes met zoveel woorden uit
// (invoiceType moet 'factuur' zijn). Geteld in deze codebase: nul plekken waar het begrip
// "verlopen offerte" bestaat.
//
// Wat er dus gebeurt: je stuurt een offerte, de klant denkt erover na, en drie weken later is hij
// verlopen zonder dat iemand hem heeft opgevolgd. Dat is geen boekhoudfout maar omzet die nooit is
// opgehaald — en het is de goedkoopste omzet die er is, want het werk om hem te winnen is al
// gedaan.
//
// ── WAT DIT MODULE WEL EN NIET DOET ──
//
// Het beantwoordt één vraag: moet de ondernemer vandaag naar deze offerte kijken? Meer niet.
//
// Het verandert NOOIT een status. Een verlopen offerte blijft precies wat hij is — verlopen is
// geen gebeurtenis in de boekhouding, het is een datum die voorbij is. Zou de app hem automatisch
// archiveren of afwijzen, dan verdwijnt een lopend gesprek met een klant uit beeld omdat er een
// dag verstreek. Wat de ondernemer daarna doet — bellen, opnieuw sturen, laten gaan — is zijn
// keuze, en die keuze mag niet al voor hem gemaakt zijn.
//
// Het stuurt ook niets naar de KLANT. Dat is dezelfde grens die de terugkerende facturen trekken
// (recurring.ts): de app doet het hele werk behalve de laatste tik, want een bericht dat vanzelf
// naar een derde gaat is een brief die de ondernemer nooit heeft geschreven. Een offerte
// opvolgen is bovendien een verkoopgesprek, geen incasso — de toon daarvan hoort bij de mens.
//
// ── WANNEER IS EEN OFFERTE "NOG IN BEHANDELING" ──
//
// invoice_type is 'pro_forma' (of 'offerte'), en de status is 'sent'. Alle andere gevallen zijn
// afgehandeld, en ze zijn het op twee verschillende manieren:
//
//   · omgezet via het aanmaakscherm → de offerterij krijgt status 'archived';
//   · omgezet bij het versturen (/api/invoice/send) → dezelfde rij WORDT een factuur, dus
//     invoice_type is dan geen offerte meer.
//
// Er bestaat ook een kolom `offerte_converted_to`, met een foreign key en al. Niets in deze app
// schrijft hem, en niets leest hem. Hij staat hier genoemd omdat het de kolom is waar een lezer
// naar zou grijpen — en die zou dan een lege waarde vinden en concluderen dat er nooit iets is
// omgezet.

/** Zoveel van een offertetij als deze regel leest. De DB-rij voldoet eraan. */
export interface FollowupQuote {
  invoice_type?: string | null;
  status?: string | null;
  /** "Geldig tot" — op een offerte is dit de geldigheidsdatum, niet een vervaldag voor betaling. */
  due_date?: string | null;
  /** [OFFERTE-AKKOORD] Wat de klant antwoordde, als hij antwoordde. */
  offerte_response?: string | null;
}

/**
 * Wat er met deze offerte aan de hand is. Null = niets, en dat is verreweg het vaakst.
 *
 * [OFFERTE-AKKOORD] 'geaccepteerd' staat vooraan omdat het het dringendst is en het leukst: de
 * klant heeft ja gezegd en er ligt werk klaar om gefactureerd te worden. De app maakt die factuur
 * niet zelf — nummeren is de tik van de ondernemer (Art. 35) — dus zonder deze regel zou een
 * akkoord in een notificatie hangen en verder nergens meer opduiken.
 */
export type QuoteFollowupState = "geaccepteerd" | "verloopt-binnenkort" | "verlopen";

/** De typen waaronder een offerte wordt opgeslagen. 'pro_forma' is wat de app schrijft. */
const QUOTE_TYPES = new Set(["pro_forma", "offerte"]);

/** Standaard: vanaf drie dagen voor het verlopen is het iets van vandaag. */
export const DEFAULT_SOON_DAYS = 3;

/**
 * Hele dagen tussen twee ISO-datums (YYYY-MM-DD). Negatief = de datum is voorbij.
 *
 * Op UTC-middernacht gerekend, zodat zomertijd geen dag kan opeten. De datums zelf zijn kale
 * dagen zonder tijdzone — "geldig tot 3 september" betekent die dag, waar de lezer ook zit.
 */
export function daysBetweenIso(fromIso: string, toIso: string): number | null {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** Is dit een offerte die nog op antwoord wacht? */
export function isOpenQuote(quote: FollowupQuote): boolean {
  if (!QUOTE_TYPES.has(String(quote.invoice_type ?? ""))) return false;
  // Alleen een VERSTUURDE offerte kan verlopen. Een concept is nooit de deur uit geweest, dus er
  // is niets om op te volgen — en er staat ook geen "Geldig tot" bij de klant op tafel.
  return quote.status === "sent";
}

/** Dagen tot deze offerte verloopt. Null als er geen geldigheidsdatum op staat. */
export function daysUntilExpiry(quote: FollowupQuote, todayIso: string): number | null {
  const tot = typeof quote.due_date === "string" ? quote.due_date.slice(0, 10) : "";
  if (!tot) return null;
  return daysBetweenIso(todayIso, tot);
}

/**
 * Moet de ondernemer vandaag naar deze offerte kijken?
 *
 * Null is het normale antwoord, en dat is met opzet: een lijst die elke offerte noemt is een lijst
 * die niemand nog leest. Er wordt alleen iets gezegd over een offerte die BIJNA verloopt of AL
 * verlopen is.
 *
 * Een offerte ZONDER geldigheidsdatum levert null op. Er staat dan geen termijn op het document
 * dat de klant heeft, dus er is niets verstreken — er zelf een datum bij verzinnen zou een
 * deadline stellen die nooit is afgesproken.
 */
export function quoteFollowupState(
  quote: FollowupQuote,
  todayIso: string,
  soonDays: number = DEFAULT_SOON_DAYS,
): QuoteFollowupState | null {
  if (!isOpenQuote(quote)) return null;

  // [OFFERTE-AKKOORD] Het antwoord van de klant gaat vóór elke datum.
  //
  // JA is het dringendst wat er op deze lijst kan staan: er ligt getekend werk dat nog niet is
  // gefactureerd, en de factuur komt er alleen als de ondernemer hem maakt. Dat een geaccepteerde
  // offerte ook nog verloopt is dan niet meer interessant — hij is niet blijven liggen, hij is
  // GEWONNEN.
  //
  // NEE haalt hem juist van de lijst. Blijven porren over een offerte waarvan de klant al heeft
  // gezegd dat het niet doorgaat, is de ondernemer werk geven dat er niet is.
  if (quote.offerte_response === "accepted") return "geaccepteerd";
  if (quote.offerte_response === "declined") return null;

  const dagen = daysUntilExpiry(quote, todayIso);
  if (dagen === null) return null;
  if (dagen < 0) return "verlopen";
  return dagen <= soonDays ? "verloopt-binnenkort" : null;
}

/**
 * De offertes die vandaag aandacht vragen, de dringendste eerst.
 *
 * Verlopen vóór bijna-verlopen, en binnen elk daarvan de oudste datum eerst: dat is de volgorde
 * waarin ze zijn blijven liggen, en dus de volgorde waarin ze het snelst koud worden.
 */
export function quotesNeedingFollowup<T extends FollowupQuote>(
  quotes: readonly T[],
  todayIso: string,
  soonDays: number = DEFAULT_SOON_DAYS,
): { quote: T; state: QuoteFollowupState; days: number }[] {
  const out: { quote: T; state: QuoteFollowupState; days: number }[] = [];
  for (const q of quotes) {
    const state = quoteFollowupState(q, todayIso, soonDays);
    if (!state) continue;
    const days = daysUntilExpiry(q, todayIso);
    // Een geaccepteerde offerte hoort op de lijst, ook zonder geldigheidsdatum: het antwoord is
    // wat hem daar zet, niet de datum.
    if (days === null && state !== "geaccepteerd") continue;
    out.push({ quote: q, state, days: days ?? 0 });
  }
  // Geaccepteerd bovenaan — dat is werk dat klaarligt, en de rest is werk dat wegloopt.
  const rang = (s: QuoteFollowupState) => (s === "geaccepteerd" ? 0 : 1);
  return out.sort((a, b) => rang(a.state) - rang(b.state) || a.days - b.days);
}
