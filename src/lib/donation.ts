// src/lib/donation.ts
// [STEUN] Configuratie en poortwachter voor de donatiepagina — juli 2026
//
// Waarom er een poortwachter is: geld vragen mag pas als duidelijk is WIE het vraagt.
// Zolang er geen ingeschreven rechtspersoon met KVK-nummer achter BoekBrug staat, mag er
// geen donatiepagina online staan — niet omdat het onbeleefd is, maar omdat een oproep tot
// betaling zonder identificeerbare ontvanger juridisch niet houdbaar is (art. 3:15d BW /
// Dienstenwet eisen naam, KVK en contactgegevens) en omdat een donateur moet weten aan wie
// hij geeft.
//
// Daarom: de pagina bestaat alleen als BEIDE dingen geconfigureerd zijn:
//   1. NEXT_PUBLIC_COMPANY_KVK   — er is een echte rechtspersoon
//   2. NEXT_PUBLIC_DONATION_URL  — er is een echte betaallink
// Ontbreekt er één, dan geeft /steun een 404 en toont de footer geen link. Geen half
// werkende betaalpagina, geen "binnenkort".

import { company } from "@/content/legal/company";

export interface DonationConfig {
  /** Mag de pagina bestaan? */
  enabled: boolean;
  /** De betaallink (betaalverzoek, Stripe/Mollie payment link, of een IBAN-pagina). */
  url: string | null;
  /** Reden waarom hij uit staat — voor de ontwikkelaar, nooit voor de bezoeker. */
  reason: "ok" | "geen_kvk" | "geen_betaallink" | "geen_kvk_en_betaallink";
}

/** Leest een env-variabele en behandelt lege strings als niet gezet. */
function env(key: string): string | null {
  const value = process.env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Is de rechtspersoon bekend? `company.kvk` valt terug op "(volgt)" zolang de
 * env-variabele niet gezet is — die waarde telt uitdrukkelijk NIET als bekend.
 */
export function hasLegalEntity(kvk: string = company.kvk): boolean {
  const normalized = kvk.trim().toLowerCase();
  if (normalized.length === 0) return false;
  if (normalized.includes("volgt") || normalized.includes("invullen")) return false;
  // Een KVK-nummer is acht cijfers. Alles wat daar niet op lijkt behandelen we als
  // "nog niet ingevuld" — liever een pagina te weinig dan een verzonnen nummer.
  return /^\d{8}$/.test(normalized.replace(/\s/g, ""));
}

export function donationConfig(): DonationConfig {
  const url = env("NEXT_PUBLIC_DONATION_URL");
  const entity = hasLegalEntity();

  if (entity && url) return { enabled: true, url, reason: "ok" };
  if (!entity && !url) return { enabled: false, url: null, reason: "geen_kvk_en_betaallink" };
  if (!entity) return { enabled: false, url: null, reason: "geen_kvk" };
  return { enabled: false, url: null, reason: "geen_betaallink" };
}
