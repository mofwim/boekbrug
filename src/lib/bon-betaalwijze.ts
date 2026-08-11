// src/lib/bon-betaalwijze.ts
// [BON-BETAALWIJZE] Hoe is deze bon betaald? Pure logica, geen I/O.
// Run: npx tsx --test src/lib/bon-betaalwijze.test.ts
//
// WAAROM DIT BESTAAT
// Voor een KASSABON is "hoe is er betaald" de eerste vraag van de boekhouder, en de enige die
// hij niet zelf kan afleiden: een contante bon heeft geen bankregel om tegenaan te leggen.
// Vroeg hij het niet, dan boekte hij mis; vroeg hij het wel, dan verhuisde het gesprek naar
// WhatsApp. En het antwoord staat al die tijd OP HET PAPIER — "Bankpas", "PIN", "Kontant",
// "Wisselgeld". Wij lazen het, zetten het in field_confidence._intake_paid_method (een jsonb die
// geen enkele voorwaarde in de app leest) en lieten invoices.payment_method leeg.
//
// Dit bestand is de vertaling van wat er op de bon staat naar de twee waarden die de rest van de
// app al kent: 'bank' en 'kas'.
//
// ── WAAROM 'pin' HIER VERDWIJNT ─────────────────────────────────────────────────────────────
// De AI-enum kent 'pin' als aparte waarde, maar de rest van de app niet: bank/confirm schrijft
// "bank", pay-toggle schrijft "bank"|"kas", en cash-settle zoekt op .eq("payment_method","kas").
// Een rij met "pin" zit in GEEN van beide emmers — onzichtbaar voor allebei de reconcilers. Een
// pinbetaling landt op de bankrekening, dus 'pin' → 'bank'. Dat is geen vereenvoudiging maar de
// enige lezing die klopt.
//
// ── WAT DIT BEWUST NIET DOET ────────────────────────────────────────────────────────────────
// Het zegt niet uit WELKE portemonnee. Een pinbon bewijst dat er met een pas is betaald, niet
// dat het de zakelijke pas was; contant bewijst niet dat het uit de kassalade kwam. Die vraag
// beantwoordt de bankkoppeling later gratis (matcht er een bankregel → zakelijk), en pas als er
// definitief geen match is, is het een échte vraag aan de ondernemer. Hier gokken naar 'privé'
// zou een bewering zijn zonder bewijs.

import { round2 } from './invoice-totals'

/** De twee waarden die de rest van de app kent. */
export type Betaalwijze = "bank" | "kas";

export interface BetaalwijzeGok {
  /** De afgeleide betaalwijze, of null als de bon het niet zegt. */
  method: Betaalwijze | null;
  /**
   * Mag dit zonder vragen worden weggeschreven? Alleen true bij ondubbelzinnig bewijs.
   * Bij tegenstrijdig bewijs (zowel contant- als pin-woorden) is dit false EN method null:
   * de ondernemer krijgt dan de vraag, precies zoals afgesproken — gok slim, vraag alleen
   * als we het niet weten.
   */
  zeker: boolean;
  /** Het woord op de bon waar de gok op rust, zodat een geschil na te lezen is. */
  bewijs: string | null;
  /** De laatste vier cijfers van de pas, als de bon ze afdrukt. Maakt de bankmatch betrouwbaar. */
  kaartLaatste4: string | null;
}

// Woorden die ALLEEN op een kaartbetaling staan. "Bankpas", "Kaartbetaling" en "Betaling gelukt"
// komen van de Nederlandse betaalterminal-bon; V PAY en Maestro zijn de debitcard-schema's.
const KAART_WOORDEN = [
  "bankpas", "kaartbetaling", "betaling gelukt", "pinpas", "pinnen", "gepind",
  "maestro", "v pay", "vpay", "contactloos", "contactless", "debitcard", "debit card",
  "creditcard", "credit card", "mastercard", "visa", "american express", "amex",
  "leesmethode", "terminal", "kaarthouder",
] as const;

// Woorden die ALLEEN op een contante betaling staan. "Afronding" en "Wisselgeld" zijn de
// verklikkers: allebei bestaan uitsluitend bij contant afrekenen (5-cent-afronding, wisselgeld).
const CONTANT_WOORDEN = [
  "kontant", "contant", "wisselgeld", "afronding", "cash", "contante betaling",
] as const;

/** "PIN" los — te kort voor een substring-zoektocht, dus als heel woord. */
const PIN_WOORD = /(^|[^a-z0-9])pin([^a-z0-9]|$)/i;

/**
 * Leest de betaalregel van een bon.
 *
 * `tekst` is wat er op de bon staat rond de afrekening (de hele bon mag ook). `aiMethod` is wat
 * het model zelf concludeerde; die telt alleen mee als de tekst zelf niets zegt — het papier
 * wint van de interpretatie.
 */
export function gokBetaalwijze(
  tekst: string | null | undefined,
  aiMethod?: "bank" | "kas" | "pin" | null,
): BetaalwijzeGok {
  const t = (tekst ?? "").toLowerCase();
  const kaartLaatste4 = leesKaartLaatste4(tekst);

  const kaartHit = KAART_WOORDEN.find((w) => t.includes(w)) ?? (PIN_WOORD.test(t) ? "pin" : null);
  const contantHit = CONTANT_WOORDEN.find((w) => t.includes(w)) ?? null;

  // Tegenstrijdig bewijs → niets beweren. Dit is de "vraag het dan maar"-tak: liever één vraag
  // dan een verkeerde boeking die niemand meer terugvindt.
  if (kaartHit && contantHit) {
    return { method: null, zeker: false, bewijs: `${kaartHit} + ${contantHit}`, kaartLaatste4 };
  }
  if (kaartHit) return { method: "bank", zeker: true, bewijs: kaartHit, kaartLaatste4 };
  if (contantHit) return { method: "kas", zeker: true, bewijs: contantHit, kaartLaatste4 };

  // Het papier zwijgt → val terug op het model, maar noem dat NIET zeker: het is een
  // interpretatie, geen afdruk.
  const uitAi = normaliseerBetaalwijze(aiMethod);
  if (uitAi) return { method: uitAi, zeker: false, bewijs: null, kaartLaatste4 };

  return { method: null, zeker: false, bewijs: null, kaartLaatste4 };
}

/**
 * Vertaalt de AI-enum naar de twee waarden die de app kent. 'pin' → 'bank' (zie de kop).
 * Alles wat we niet kennen wordt null — nooit een derde waarde die geen reconciler herkent.
 */
export function normaliseerBetaalwijze(
  method: string | null | undefined,
): Betaalwijze | null {
  switch ((method ?? "").trim().toLowerCase()) {
    case "bank":
    case "pin":
    case "pinpas":
    case "bankpas":
    case "creditcard":
      return "bank";
    case "kas":
    case "contant":
    case "kontant":
    case "cash":
      return "kas";
    default:
      return null;
  }
}

/** De laatste vier cijfers van de pas, als de bon ze afdrukt ("Kaart xxxxxxxxxxxx6596"). */
export function leesKaartLaatste4(tekst: string | null | undefined): string | null {
  const t = tekst ?? "";
  // Gemaskeerd pasnummer: een rij x'en of sterretjes gevolgd door vier cijfers.
  const gemaskeerd = /[x*]{4,}\s*(\d{4})(?!\d)/i.exec(t);
  if (gemaskeerd) return gemaskeerd[1];
  // Of expliciet benoemd: "kaart 6596" / "pas 6596".
  const benoemd = /\b(?:kaart|pas|card)\b[^0-9\n]{0,12}(\d{4})(?!\d)/i.exec(t);
  return benoemd ? benoemd[1] : null;
}

/**
 * Het afrondingsverschil bij contant afrekenen.
 *
 * Nederland rondt CONTANTE bedragen af op 5 cent; pinnen niet. Gevolg: wat er uit de la gaat is
 * niet altijd wat er op de bon aan goederen + btw staat. Twee echte bonnen:
 *   · Nettorama  € 10,74 te betalen → kontant 10,75, wisselgeld 0,00  → 1 cent MEER uit de la
 *   · Omur Markt € 112,92 totaal    → kontant 120,00, afronding 0,02, wisselgeld 7,10
 *                                     → er ging 112,90 uit de la, 2 cent MINDER
 *
 * De bon zelf blijft € 112,92 waard (dát is de kostenpost en de btw-grondslag); alleen de
 * KASLADE beweegt anders. Wie de lade uit total_inc_btw afleidt, bouwt per contante bon een
 * kasverschil van een paar cent op dat niemand later nog kan verklaren.
 *
 * Retourneert het bedrag dat werkelijk uit de la ging, of null als de bon te weinig zegt.
 */
export function contantUitLade(
  totaalInc: number | null | undefined,
  contantGegeven: number | null | undefined,
  wisselgeld: number | null | undefined,
): number | null {
  if (typeof contantGegeven === "number" && typeof wisselgeld === "number") {
    return afgerond2(contantGegeven - wisselgeld);
  }
  // Zonder tendergegevens is de beste schatting het bontotaal afgerond op 5 cent.
  if (typeof totaalInc === "number" && Number.isFinite(totaalInc)) {
    return afgerond2(Math.round(totaalInc * 20) / 20);
  }
  return null;
}

const afgerond2 = round2;
