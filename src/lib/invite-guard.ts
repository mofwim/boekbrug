// src/lib/invite-guard.ts
// [SEC-INVITE] Mag deze uitnodiging opnieuw worden verstuurd? — puur, geen I/O.
//
// ── WAAROM DIT EEN EIGEN BESTANDJE IS ──
// Deze beslissing zat als één inline `existing?.status === 'pending'` in
// accountant.repository.ts, waar geen enkele test bij kan: de repository doet I/O en het
// project draait alleen `src/lib/*.test.ts`. En zij bleek precies de plek te zijn waar twee
// bugs elkaar verborgen hielden:
//
//   1. De accept-route schreef de status nooit weg (stille 0-rij-write op een tabel zonder
//      UPDATE-policy), dus élke uitnodiging bleef eeuwig 'pending' — en dit blok weigerde
//      daardoor 14 dagen lang elke herhaling naar hetzelfde adres. Een boekhouder die een
//      adres verkeerd typte, of wiens klant nog niet had geklikt, zat vast.
//   2. Zodra die write is gerepareerd kan er wél meer dan één rij per adres ontstaan, en
//      de `.maybeSingle()` eronder wordt dan een harde fout in plaats van null.
//
// De twee reparaties MOETEN samen landen; deze functie is het stuk dat CI kan vasthouden.

/** De statussen die public.invitations kent. */
export type InvitationStatus = "pending" | "accepted" | "expired" | "declined";

/**
 * Blokkeert een bestaande uitnodiging het opnieuw versturen?
 *
 * Alleen een uitnodiging die nog écht openstaat blokkeert. Alles anders — geaccepteerd,
 * verlopen, geweigerd, of helemaal niets gevonden — laat een nieuwe uitnodiging toe.
 *
 * De faalrichting is bewust TOESTAAN. Een uitnodiging te veel is een mailtje; een
 * uitnodiging die niet verstuurd kan worden is een klant die nooit gekoppeld raakt, en die
 * koppeling is het hele product. Bij een onbekende status dus doorlaten.
 *
 * Geef de status van de NIEUWSTE rij mee, niet van een willekeurige: een adres kan door de
 * tijd heen meerdere uitnodigingen hebben gehad en alleen de laatste zegt iets.
 */
export function shouldBlockReinvite(newestStatus: string | null | undefined): boolean {
  return newestStatus === "pending";
}

/**
 * Welke rij is "de nieuwste"? Helper voor het geval de aanroeper zelf moet sorteren.
 * Rijen zonder bruikbare datum verliezen altijd van een rij mét datum — een onleesbare
 * tijdstempel mag nooit de beslissing bepalen.
 */
export function newestInvitation<T extends { status: string; created_at?: string | null }>(
  rows: readonly T[],
): T | null {
  let best: T | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const ms = row.created_at ? Date.parse(row.created_at) : NaN;
    const usable = Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
    if (best === null || usable > bestMs) {
      best = row;
      bestMs = usable;
    }
  }
  return best;
}
