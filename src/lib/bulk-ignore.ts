// src/lib/bulk-ignore.ts
// [NEGEER-BULK] Wat de wachtrij MELDT nadat een stapel facturen in één tik is genegeerd.
// Puur, geen I/O — de lus zelf staat in IncomingInvoicesClient.
//
// ── WAAROM DIT EEN EIGEN BESTAND IS ──
// Negeren per factuur kent één uitkomst per keer: het lukte, of de server zei waarom niet, en die
// zin wordt letterlijk getoond (confirmFailureMessage). Bij een stapel is dat onmogelijk: twintig
// facturen kunnen drie verschillende antwoorden opleveren en die passen niet in één snackbar.
//
// De verleiding is dan om te versimpelen naar "18 genegeerd, 2 mislukt". Dat is precies de
// oneerlijkheid die deze app overal bestrijdt, want "mislukt" verbergt het enige onderscheid dat
// de eigenaar nodig heeft: MOET IK IETS DOEN, OF MOET IK WACHTEN.
//
// ── DE TWEEDELING, EN WAAROM 409 DE GRENS IS ──
// /api/email/confirm/[id] DELETE kent precies twee soorten nee:
//
//   · 409 — de STAAT van deze factuur verbiedt het. Drie gevallen, alle drie blijvend:
//       money_settled  "er is al betaald — draai eerst de betaling terug"
//       bank_linked    "er hangt een banktransactie aan — ontkoppel die eerst"
//       (naamloos)     de rij was ondertussen niet meer 'processing'/'received'
//     Opnieuw proberen kan hier NIET werken; er moet eerst iets anders gebeuren.
//
//   · al het andere — 503 (de geldcontrole kon niet worden uitgevoerd → de route weigert
//     fail-closed en zegt zelf "probeer het zo meteen opnieuw"), 500, 401, of een netwerkfout.
//     Hier is niets aan de factuur mis; opnieuw proberen is juist wél het antwoord.
//
// Daarom classificeren we op STATUS en niet op de foutcode: de codes zijn er drie en er kunnen er
// meer komen, maar de vraag "is dit blijvend?" wordt door de statuscode al beantwoord. Een nieuwe
// 409-reden erbij valt vanzelf aan de goede kant.
//
// ── WAT DE MELDING BEWUST NIET DOET ──
// Ze noemt geen REDEN per factuur. Dat is geen verlies: een geweigerde factuur blijft gewoon in de
// wachtrij staan, en één tik op die kaart geeft de volledige zin van de server via het bestaande
// enkelvoudige pad. De stapel telt; de kaart legt uit. Zo hoeft de snackbar nooit te kiezen welke
// van de twintig redenen hij laat zien.

/** Blijvend geweigerd (er moet eerst iets anders gebeuren) of tijdelijk niet gelukt. */
export type IgnoreFailureKind = "refused" | "unavailable";

/**
 * Eén HTTP-status → blijvend of tijdelijk.
 *
 * Een netwerkfout (fetch die throwt) heeft geen status; geef daar 0 door — dat valt hier op
 * "unavailable", en dat is juist: er is dan niets gewijzigd en het kan zo meteen wél lukken.
 */
export function classifyIgnoreFailure(status: number): IgnoreFailureKind {
  return status === 409 ? "refused" : "unavailable";
}

export type BulkIgnoreTally = {
  /** Aantal facturen dat de server daadwerkelijk heeft gearchiveerd. */
  ok: number;
  /** Blijvend geweigerd — 409. */
  refused: number;
  /** Tijdelijk niet gelukt — al het andere. */
  unavailable: number;
};

/** "1 factuur" / "3 facturen" — het enkelvoud klopt ook bij 0 ("0 facturen"). */
function facturen(n: number): string {
  return n === 1 ? "1 factuur" : `${n} facturen`;
}

/**
 * De zin onder een afgeronde stapel.
 *
 * Drie regels die alle uitkomsten dekken:
 *   1. Alles gelukt → alleen het aantal. Geen ruis.
 *   2. Er ging iets mis → noem de twee soorten APART, en zeg erbij dat die facturen nog in de
 *      wachtrij staan. Dat laatste is de belangrijkste helft: het scherm haalt ze niet weg, dus de
 *      eigenaar moet weten dat wat hij nog ziet staan geen weergavefout is.
 *   3. "Probeer opnieuw" staat er ALLEEN als er iets is waarvoor dat kan werken.
 */
export function bulkIgnoreSummary(t: BulkIgnoreTally): string {
  const { ok, refused, unavailable } = t;
  const failed = refused + unavailable;

  if (failed === 0) {
    // Ook het (theoretische) geval ok === 0 & failed === 0 valt hier: er is dan niets gebeurd en
    // er valt niets te melden dat verder gaat dan wat er staat.
    return `✓ ${facturen(ok)} genegeerd`;
  }

  const parts: string[] = [];
  parts.push(ok > 0 ? `${ok} genegeerd` : "Niets genegeerd");
  if (refused > 0) parts.push(`${refused} geweigerd`);
  if (unavailable > 0) parts.push(`${unavailable} niet gelukt`);

  // De staart kiest de handeling die daadwerkelijk helpt.
  const tail =
    refused > 0 && unavailable > 0
      ? "ze staan nog in de wachtrij — open ze los"
      : refused > 0
        ? `open ${refused === 1 ? "hem" : "ze"} los om te zien waarom`
        : "probeer het zo meteen opnieuw";

  return `${parts.join(" · ")} — ${tail}`;
}

/**
 * Mag de melding een "Ongedaan maken" aanbieden?
 *
 * Alleen als er echt iets is weggehaald. Een undo-knop naast "Niets genegeerd" zou een handeling
 * aanbieden die niets ongedaan te maken heeft.
 */
export function bulkIgnoreOffersUndo(t: BulkIgnoreTally): boolean {
  return t.ok > 0;
}

/**
 * Dezelfde vorm voor de terugweg (Ongedaan maken → PATCH per factuur).
 *
 * Hier is geen tweedeling nodig: PATCH weigert alleen met 409 "staat niet (meer) in Genegeerd", en
 * dat is voor de eigenaar hetzelfde bericht als elke andere fout — kijk even, het klopt niet.
 */
export function bulkRestoreSummary(ok: number, failed: number): string {
  if (failed === 0) return `${facturen(ok)} teruggezet`;
  if (ok === 0) return "Terugzetten mislukt — ververs de pagina";
  return `${ok} teruggezet · ${failed} niet — ververs de pagina`;
}
