// src/lib/offerte-akkoord.ts
// [OFFERTE-AKKOORD] De klant zegt ja of nee op een offerte. Puur, geen I/O.
// Run: npx tsx --test src/lib/offerte-akkoord.test.ts
//
// ── WAT DIT OPLOST ──
//
// De offerte gaat als PDF de deur uit en het antwoord komt terug per mail, per app of per
// telefoon. In de app staat dan nergens dát er ja is gezegd, wanneer, of door wie. Gaat het later
// mis over wat er precies was besteld, dan is er niets om op terug te vallen dan iemands geheugen
// — en de ondernemer is de partij die dan moet bewijzen.
//
// ── DE GRENS DIE HIER NIET WORDT OVERSCHREDEN ──
//
// Akkoord geven maakt GEEN factuur. Nooit.
//
// Factureren verbruikt een nummer uit de doorlopende reeks (Art. 35 Wet OB) en dat is
// onomkeerbaar. Een nummer laten ontstaan door een klik van een DERDE — iemand buiten het bedrijf,
// via een link die eeuwig blijft werken — is precies de macht die deze app nergens weggeeft. Het
// is dezelfde lijn als bij de terugkerende facturen (recurring.ts): alles behalve de laatste tik.
//
// Een geaccepteerde offerte is dus een SEIN. Hij verschijnt bovenaan op Vandaag met de vraag om
// hem om te zetten, en de ondernemer doet dat zelf.
//
// ── WAT HET TOKEN IS ──
//
// Het geheim in de link IS de toegang, net als pay_token. Wie hem heeft, mag antwoorden. Daarom:
// een EIGEN token, en niet pay_token hergebruiken — dan ontsluit één geheim twee dingen, en kan
// een link die is gedeeld om akkoord te geven ook een betaalpagina openen.
//
// ── ANTWOORDEN NA DE GELDIGHEIDSDATUM MAG ──
//
// Een offerte die gisteren verliep en vandaag wordt geaccepteerd is goed nieuws. De ondernemer is
// nergens aan gebonden — hij factureert zelf — dus weigeren zou werk weggooien om één dag. Het
// antwoord wordt vastgelegd met zijn datum, en wie wil zien dat het laat was ziet het.

/** Wat een klant kan antwoorden. "Misschien" is een gesprek, geen toestand van een document. */
export type QuoteAnswer = "accepted" | "declined";

/** Zoveel van de offerterij als deze regels lezen. De DB-rij voldoet eraan. */
export interface AnswerableQuote {
  invoice_type?: string | null;
  status?: string | null;
  due_date?: string | null;
  offerte_response?: string | null;
  offerte_responded_at?: string | null;
  offerte_response_name?: string | null;
}

/** Waarom er niet (meer) geantwoord kan worden. Null = het mag. */
export type AnswerRefusal = "not_a_quote" | "not_sent" | "already_answered";

const QUOTE_TYPES = new Set(["pro_forma", "offerte"]);

/** Is dit een antwoord dat de app kent? Alles anders wordt geweigerd, nooit geraden. */
export function isQuoteAnswer(value: unknown): value is QuoteAnswer {
  return value === "accepted" || value === "declined";
}

/** Het al gegeven antwoord, of null. Alleen de twee bekende waarden tellen. */
export function answerOf(quote: AnswerableQuote): QuoteAnswer | null {
  return isQuoteAnswer(quote.offerte_response) ? quote.offerte_response : null;
}

/**
 * Mag deze offerte nog een antwoord krijgen?
 *
 * HET EERSTE ANTWOORD STAAT. Een tweede klik overschrijft niets, en dat is geen strengheid maar
 * eerlijkheid: het vastgelegde moment is het bewijs, en bewijs dat door de tegenpartij kan worden
 * overschreven is geen bewijs. Wie zich bedenkt, belt — en dan legt de ondernemer het vast op de
 * manier waarop dat hoort, met een mens erbij.
 *
 * Een offerte die AL VERLOPEN is mag wél nog worden geaccepteerd; zie de kop.
 */
export function answerRefusal(quote: AnswerableQuote): AnswerRefusal | null {
  if (!QUOTE_TYPES.has(String(quote.invoice_type ?? ""))) return "not_a_quote";
  // Alleen een verstuurde offerte: een concept is nooit bij de klant geweest, dus er is niemand
  // die er iets over te zeggen heeft.
  if (quote.status !== "sent") return "not_sent";
  if (answerOf(quote)) return "already_answered";
  return null;
}

/** Kan er nog worden geantwoord? */
export function canAnswer(quote: AnswerableQuote): boolean {
  return answerRefusal(quote) === null;
}

/**
 * Is er geantwoord ná de geldigheidsdatum?
 *
 * Alleen informatief — het verandert niets aan de geldigheid van het antwoord. De ondernemer ziet
 * het en beslist; dat is precies de reden dat de app het niet voor hem beslist.
 */
export function answeredAfterExpiry(quote: AnswerableQuote): boolean {
  const tot = typeof quote.due_date === "string" ? quote.due_date.slice(0, 10) : "";
  const op = typeof quote.offerte_responded_at === "string" ? quote.offerte_responded_at.slice(0, 10) : "";
  if (!tot || !op) return false;
  return op > tot;
}

/**
 * De naam die de klant intypte, opgeschoond.
 *
 * Leeg mag: iemand die op akkoord klikt zonder zijn naam te typen heeft nog steeds akkoord
 * gegeven, en het antwoord tegenhouden om een leeg tekstvakje zou de afspraak kwijtmaken om een
 * formaliteit. Wat er WEL gebeurt is begrenzen — dit is vrije tekst uit een publieke pagina.
 */
export const MAX_NAME_LENGTH = 120;

export function cleanResponderName(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!s) return null;
  return s.slice(0, MAX_NAME_LENGTH);
}

/** Wat de publieke pagina van een offerte laat zien. Eén allowlist, net als bij de betaalpagina. */
export interface PublicQuoteView {
  quoteNumber: string | null;
  quoteDate: string | null;
  /** "Geldig tot". */
  validUntil: string | null;
  clientName: string | null;
  senderName: string;
  totalIncBtw: number;
  lines: { description: string; quantity: number | null; unit: string | null; lineTotal: number }[];
  /** Het al gegeven antwoord, zodat de pagina laat zien wat er is vastgelegd. */
  answer: QuoteAnswer | null;
  answeredAt: string | null;
  answeredBy: string | null;
  /** Mag er nog worden geantwoord? */
  open: boolean;
  /** Is de geldigheidsdatum voorbij? De pagina zegt het eerlijk en blokkeert niets. */
  expired: boolean;
}

export interface PublicQuoteInput {
  quote: AnswerableQuote & {
    invoice_number?: string | null;
    invoice_date?: string | null;
    client_name?: string | null;
    total_inc_btw?: number | null;
  };
  lines: readonly {
    description?: string | null;
    quantity?: number | null;
    unit?: string | null;
    line_total?: number | null;
  }[];
  senderName: string | null;
  todayIso: string;
}

/**
 * De publieke projectie van een offerte.
 *
 * Alles wat hier NIET in staat, bereikt de klant niet: geen id's, geen tokens, geen klantadres,
 * geen btw-nummer van de ondernemer, geen interne notities. Dezelfde regel als
 * toPublicPayView — één plek die bepaalt wat een buitenstaander ziet, zodat "wat lekt er" een
 * vraag is met één antwoord.
 *
 * Null wanneer dit geen offerte is die getoond mag worden; de route maakt daar een 404 van, zonder
 * te zeggen waarom.
 */
export function toPublicQuoteView(input: PublicQuoteInput): PublicQuoteView | null {
  const q = input.quote;
  if (!QUOTE_TYPES.has(String(q.invoice_type ?? ""))) return null;
  // Een concept is nooit verstuurd — er is geen klant die deze link kan hebben, dus er is niets
  // te tonen. (Een AL BEANTWOORDE offerte wordt wel getoond: de klant mag terugzien wat hij zei.)
  if (q.status !== "sent") return null;

  const validUntil = typeof q.due_date === "string" && q.due_date ? q.due_date.slice(0, 10) : null;
  return {
    quoteNumber: q.invoice_number ?? null,
    quoteDate: typeof q.invoice_date === "string" ? q.invoice_date.slice(0, 10) : null,
    validUntil,
    clientName: q.client_name ?? null,
    senderName: input.senderName?.trim() || "",
    totalIncBtw: Math.abs(Number(q.total_inc_btw) || 0),
    lines: input.lines.map((l) => ({
      description: (l.description ?? "").trim(),
      quantity: typeof l.quantity === "number" ? l.quantity : null,
      unit: l.unit ?? null,
      lineTotal: Number(l.line_total) || 0,
    })),
    answer: answerOf(q),
    answeredAt: q.offerte_responded_at ?? null,
    answeredBy: q.offerte_response_name ?? null,
    open: canAnswer(q),
    expired: !!validUntil && validUntil < input.todayIso,
  };
}
