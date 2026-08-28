// src/lib/package-share.ts
// [PAKKET-LINK] Wat een deel-link is, en wanneer hij nog werkt — puur, geen I/O.
//
// De beslissing "mag dit token nu nog een pakket openen" staat hier en nergens anders, omdat zij
// op twee plekken nodig is (de publieke download beslist ermee, het scherm van de eigenaar toont
// ermee) en die twee mogen nooit uit elkaar lopen: een link die het scherm "actief" noemt terwijl
// de route hem weigert, is een ondernemer die denkt dat zijn boekhouder het pakket heeft.
//
// FAIL-CLOSED, en dat is de hele toon van dit bestand: alles wat niet aantoonbaar geldig is, is
// ongeldig. Geen datum? Verlopen. Onleesbare datum? Verlopen. Deze link opent een compleet
// kwartaal aan boekhouding voor iemand zonder account — de twijfel hoort altijd dicht te vallen.

/** Hoe lang een deel-link leeft. Een kwartaalafhandeling is klaar in weken, niet in maanden. */
export const SHARE_VALIDITY_DAYS = 30;

export interface ShareRow {
  expires_at: string | null;
  revoked_at: string | null;
}

export type ShareStatus = "live" | "revoked" | "expired";

/**
 * Mag dit token nu nog iets openen?
 *
 * De volgorde is niet willekeurig: INGETROKKEN wint van VERLOPEN, omdat intrekken een handeling
 * van de eigenaar is en verlopen alleen tijd. Wie zijn link introk hoort dat terug te zien, ook
 * als de dertig dagen intussen ook om zijn.
 */
export function shareStatus(row: ShareRow, nowMs: number): ShareStatus {
  if (row.revoked_at) {
    const t = Date.parse(row.revoked_at);
    // Een onleesbare intrekkingsdatum telt als ingetrokken: de kolom is alleen gevuld ALS er is
    // ingetrokken, dus de aanwezigheid is het feit — de datum is er de toelichting bij.
    if (!Number.isFinite(t) || t <= nowMs) return "revoked";
  }
  if (!row.expires_at) return "expired";
  const eind = Date.parse(row.expires_at);
  if (!Number.isFinite(eind) || eind <= nowMs) return "expired";
  return "live";
}

/** De vervaldatum voor een NIEUWE link, vanaf nu. */
export function shareExpiry(nowMs: number): string {
  return new Date(nowMs + SHARE_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Hoeveel hele dagen deze link nog meegaat (0 zodra hij dood is). Voor het scherm. */
export function shareDaysLeft(row: ShareRow, nowMs: number): number {
  if (shareStatus(row, nowMs) !== "live") return 0;
  const eind = Date.parse(row.expires_at as string);
  return Math.max(0, Math.ceil((eind - nowMs) / 86400000));
}

/**
 * Is dit een bruikbaar e-mailadres om een pakket heen te sturen?
 *
 * Dezelfde vorm als de uitnodigingsroute gebruikt. Bewust géén strengere regel: een adres dat de
 * mailprovider wél accepteert en wij niet, is een boekhouder die zijn stukken niet krijgt omdat
 * wij zijn adres te exotisch vonden.
 */
export function isBruikbaarEmail(waarde: unknown): waarde is string {
  return typeof waarde === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(waarde.trim());
}
