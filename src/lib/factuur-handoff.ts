// src/lib/factuur-handoff.ts
// [FUNNEL-OVERDRACHT] Wat iemand op /factuur-maken invulde, meenemen naar zijn account.
//
// Het gat dat dit dicht. De gratis factuurgenerator is de sterkste instappagina die er is:
// geen account, echte uitkomst, en de bezoeker heeft er al vijf minuten werk in zitten. Onder
// aan die pagina stond een knop met de tekst "Maak een gratis account. **Bewaar je facturen**
// en houd je BTW bij." — en daarachter zat een kale link naar /register. De gegevens stonden
// wél in localStorage (afzender + laatste nummer), maar nergens in register, onboarding of het
// dashboard werd die sleutel gelezen. Nul verwijzingen.
//
// Wat de bezoeker dus meemaakte: factuur invullen, lezen dat hij hem kan bewaren, registreren,
// en dan een leeg scherm — bedrijfsnaam, adres, KVK, BTW, IBAN, de klant en alle regels
// opnieuw. Precies op het moment dat hij besloot te blijven. Dat is geen ontbrekende functie
// maar een belofte die het product zelf doet en niet nakomt, op de plek waar het het meeste
// kost.
//
// Waarom localStorage en niet sessionStorage. De bestaande scan-overdracht
// (/factuur-scannen → /factuur-maken) gebruikt sessionStorage, en dat klopt daar: twee
// pagina's, één tabblad, één handeling. Registreren is iets anders — er zit een
// bevestigingsmail tussen, en die opent bij veel mensen een NIEUW tabblad of zelfs een andere
// browser. sessionStorage is dan weg, en de overdracht zou juist falen bij de gebruiker die
// het netjes deed. Vandaar localStorage, met een houdbaarheidsdatum in plaats van
// tabblad-levensduur.
//
// Waarom een houdbaarheidsdatum. Een concept dat maanden later opduikt bij iemand die allang
// iets anders doet, is verwarrend en voelt als een lek. Zeven dagen dekt registreren +
// mailbevestiging + een dag bedenktijd ruim, en alles daarna vervalt stil.
//
// Waarom het factuurNUMMER niet meekomt. In de gratis tool is het nummer een gewoon
// invoerveld; in het product komt het uit de doorlopende reeks die art. 35 Wet OB voorschrijft
// en die serverkant wordt uitgedeeld. Een zelfgekozen nummer daarin laten binnenwandelen zou
// precies het gat in de reeks maken waar de rest van deze codebase zo hard voor werkt. De
// regels en de tegenpartij komen mee; het nummer wordt opnieuw en juist toegekend.
//
// Pure + node-testbaar (run: npx tsx src/lib/factuur-handoff.test.ts).

/** De minimale opslag-vorm die we nodig hebben — zo blijft dit testbaar zonder browser. */
export interface HandoffStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const HANDOFF_KEY = "boekbrug.factuur-overdracht";

/** Verhoog dit bij een niet-compatibele wijziging: oude payloads worden dan stil genegeerd. */
export const HANDOFF_VERSION = 1;

/** Zie de kop: lang genoeg voor mailbevestiging + bedenktijd, kort genoeg om niet te spoken. */
export const HANDOFF_TTL_DAYS = 7;

export interface HandoffSender {
  company_name: string;
  full_name: string;
  address: string;
  postal_code: string;
  city: string;
  kvk_number: string;
  btw_number: string;
  iban: string;
  email: string;
}

export interface HandoffClient {
  client_name: string;
  client_address: string;
  client_postal_code: string;
  client_city: string;
  client_btw_number: string;
  client_email: string;
}

export interface HandoffLine {
  description: string;
  quantity: number;
  unit_price: number;
  btw_rate: number;
}

export interface FactuurHandoff {
  version: number;
  savedAt: string; // ISO timestamp
  sender: HandoffSender;
  client: HandoffClient;
  lines: HandoffLine[];
  invoiceDate: string; // yyyy-mm-dd, '' als onbekend
  deliveryDate: string;
}

const emptySender = (): HandoffSender => ({
  company_name: "", full_name: "", address: "", postal_code: "",
  city: "", kvk_number: "", btw_number: "", iban: "", email: "",
});

const emptyClient = (): HandoffClient => ({
  client_name: "", client_address: "", client_postal_code: "",
  client_city: "", client_btw_number: "", client_email: "",
});

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Een eindig getal, anders 0. NaN/Infinity uit een kapotte payload mag nooit een bedrag worden. */
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const isoDate = (v: unknown): string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";

/**
 * Is deze regel de moeite van het meenemen waard? Een lege regel overzetten is erger dan niets
 * overzetten: de gebruiker krijgt dan rommel te zien die hij eerst moet opruimen.
 */
export function isMeaningfulLine(l: HandoffLine): boolean {
  return l.description.trim().length > 0 || l.quantity !== 0 || l.unit_price !== 0;
}

/**
 * Heeft deze overdracht überhaupt inhoud? Iemand die de pagina opent en meteen wegklikt moet
 * later géén "we vonden je factuur" te zien krijgen — dat is een loze belofte in de andere
 * richting. We eisen dus dat er iets van een tegenpartij OF een echte regel in zit; de
 * afzendergegevens alleen zijn niet genoeg, want die staan er al door eerder bezoek.
 */
export function hasInvoiceContent(h: FactuurHandoff | null): boolean {
  if (!h) return false;
  return h.client.client_name.trim().length > 0 || h.lines.some(isMeaningfulLine);
}

/** Staat er iets bruikbaars in het afzenderblok? Bepaalt of onboarding iets voor te vullen heeft. */
export function hasSenderContent(h: FactuurHandoff | null): boolean {
  if (!h) return false;
  const s = h.sender;
  return [s.company_name, s.full_name, s.address, s.kvk_number, s.btw_number, s.iban]
    .some((v) => v.trim().length > 0);
}

/**
 * Bouw een overdracht. Neemt losse velden aan zodat de aanroeper geen exacte vorm hoeft te
 * kennen; alles wordt hier gezuiverd, want dit is de enige plek waar de payload ontstaat.
 */
export function buildHandoff(input: {
  sender: Partial<HandoffSender>;
  client: Partial<HandoffClient>;
  lines: Array<Partial<HandoffLine>>;
  invoiceDate?: string;
  deliveryDate?: string;
  now?: Date;
}): FactuurHandoff {
  const now = input.now ?? new Date();
  return {
    version: HANDOFF_VERSION,
    savedAt: now.toISOString(),
    sender: pickStrings(input.sender, emptySender()),
    client: pickStrings(input.client, emptyClient()),
    lines: (input.lines ?? [])
      .map((l) => ({
        description: str(l.description),
        quantity: num(l.quantity),
        unit_price: num(l.unit_price),
        // Onbekend tarief → 21%. Nooit 0: dat zou een gewone dienst stil als vrijgesteld
        // presenteren, en dat is de duurste van de twee fouten.
        btw_rate: typeof l.btw_rate === "number" && Number.isFinite(l.btw_rate) ? l.btw_rate : 21,
      }))
      .filter(isMeaningfulLine),
    invoiceDate: isoDate(input.invoiceDate),
    deliveryDate: isoDate(input.deliveryDate),
  };
}

/**
 * Neem uit `src` precies de sleutels die `shape` kent, en alleen als string. Onbekende velden
 * uit een payload van een andere versie verdwijnen zo vanzelf, en een getal of object waar een
 * string hoort wordt een lege string in plaats van iets dat later door de UI breekt.
 */
function pickStrings<T extends object>(src: unknown, shape: T): T {
  const s = (src ?? {}) as Record<string, unknown>;
  const out = { ...shape } as Record<string, string>;
  for (const k of Object.keys(shape)) out[k] = str(s[k]);
  return out as T;
}

/** Schrijf de overdracht weg. Faalt stil: opslag kan vol of geblokkeerd zijn, en dan is een
 *  mislukte overdracht vervelend maar een crash op de factuurpagina veel erger. */
export function writeHandoff(storage: HandoffStorage, h: FactuurHandoff): boolean {
  try {
    storage.setItem(HANDOFF_KEY, JSON.stringify(h));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lees de overdracht. Alles wat niet klopt — kapotte JSON, een andere versie, een verlopen
 * of onleesbare datum — wordt null. Nooit een exception, nooit een halve payload: dit draait
 * op het dashboard van iemand die net binnen is, en dáár is een lege staat het juiste antwoord
 * op twijfel.
 */
export function readHandoff(storage: HandoffStorage, now: Date = new Date()): FactuurHandoff | null {
  let raw: string | null;
  try {
    raw = storage.getItem(HANDOFF_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const p = parsed as Record<string, unknown>;
  if (p.version !== HANDOFF_VERSION) return null;

  const savedAt = str(p.savedAt);
  const savedMs = Date.parse(savedAt);
  if (!Number.isFinite(savedMs)) return null;
  const ageDays = (now.getTime() - savedMs) / 86_400_000;
  // Ook een payload uit de toekomst is verdacht (verzette systeemklok): behandel hem als
  // onbruikbaar in plaats van als eeuwig geldig.
  if (ageDays > HANDOFF_TTL_DAYS || ageDays < -1) return null;

  const rawLines = Array.isArray(p.lines) ? p.lines : [];
  return {
    version: HANDOFF_VERSION,
    savedAt,
    sender: pickStrings(p.sender, emptySender()),
    client: pickStrings(p.client, emptyClient()),
    lines: rawLines
      .map((l) => {
        const o = (l ?? {}) as Record<string, unknown>;
        return {
          description: str(o.description),
          quantity: num(o.quantity),
          unit_price: num(o.unit_price),
          btw_rate: typeof o.btw_rate === "number" && Number.isFinite(o.btw_rate) ? o.btw_rate : 21,
        };
      })
      .filter(isMeaningfulLine),
    invoiceDate: isoDate(p.invoiceDate),
    deliveryDate: isoDate(p.deliveryDate),
  };
}

/** Weggooien. Gebeurt pas als de factuur echt is opgeslagen of de gebruiker hem wegklikt —
 *  niet bij lezen, want tussen registreren en de eerste factuur zit meer dan één scherm. */
export function clearHandoff(storage: HandoffStorage): void {
  try {
    storage.removeItem(HANDOFF_KEY);
  } catch {
    /* niets aan te doen, en niets ergs */
  }
}

/**
 * Het afzenderblok vertaald naar de velden die de onboarding opslaat. Dit is de helft van de
 * overdracht die zonder vragen mag: het zijn de eigen bedrijfsgegevens die de gebruiker
 * minuten geleden zelf intikte, dus ze terugzien is herkenning en geen verrassing.
 *
 * Het adres van de generator is één veld (straat + nummer) en dat komt overeen met wat de
 * onboarding als `address` bewaart; postcode en plaats worden erachter gezet omdat de
 * onboarding daar geen aparte velden voor heeft en ze anders verloren gaan.
 */
export function toOnboardingCompany(h: FactuurHandoff): {
  company_name: string;
  kvk_number: string;
  btw_number: string;
  iban: string;
  address: string;
} {
  const s = h.sender;
  const adres = [s.address.trim(), [s.postal_code.trim(), s.city.trim()].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return {
    company_name: (s.company_name.trim() || s.full_name.trim()),
    kvk_number: s.kvk_number.trim(),
    btw_number: s.btw_number.trim().toUpperCase(),
    iban: s.iban.trim().replace(/\s+/g, "").toUpperCase(),
    address: adres,
  };
}

/** Korte omschrijving van wat er klaarstaat, voor de vraag op het dashboard. */
export function describeHandoff(h: FactuurHandoff): string {
  const n = h.lines.filter(isMeaningfulLine).length;
  const klant = h.client.client_name.trim();
  const regels = n === 1 ? "1 regel" : `${n} regels`;
  return klant ? `${klant} — ${regels}` : regels;
}
