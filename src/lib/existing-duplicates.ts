// src/lib/existing-duplicates.ts
// [DUBBEL-TERUGKIJKEN] De dubbele boekingen die al in de administratie staan. Puur, geen I/O.
// Run: npx tsx --test src/lib/existing-duplicates.test.ts
//
// ── WAAROM DIT NAAST assessPossibleDuplicate STAAT ──
//
// Bij binnenkomst staan er TWEE poorten voor een document. Eerst de harde
// (findSemanticDuplicate): zelfde nummer én zelfde bedrag én zelfde datum is geen vermoeden maar
// hetzelfde stuk, en die wordt geweigerd. Wat daar doorheen komt gaat langs de zachte
// (assessPossibleDuplicate), die de gevallen vlagt die de harde niet kan bewijzen.
//
// Daarom slaat de zachte poort het exacte geval expres over — "don't downgrade it to a mere
// possible", staat er, en dat klopt: de harde heeft het dan al tegengehouden.
//
// Achteraf klopt het niet meer. Op geschiedenis van vóór 18 augustus heeft géén van beide poorten
// ooit gedraaid, en dan is precies het exacte geval het meest voorkomende — dezelfde factuur twee
// keer ingelezen, één keer uit de mail en één keer als foto. De eerste versie van de terugblik
// gebruikte alleen de zachte rechter en miste daardoor vier van de zes echte gevallen: Ipekci,
// Vegimex, Altena en WonenBreburg, alle vier tot op de cent identiek. De test tegen de rijen uit
// productie liet dat meteen zien, en dat is de reden dat hij met die rijen is geschreven.
//
// Dus de terugblik voert beide poorten uit, in dezelfde volgorde als de intake.

import { assessPossibleDuplicate, normalizeInvoiceNumber, type PossibleDupCandidate } from "./safecore";

export interface BestaandeDubbele {
  /** De factuur die als tweede binnenkwam — de boeking die er waarschijnlijk te veel is. */
  id: string;
  /** Waar hij op lijkt. */
  lijktOp: string;
  /** 'zeker' = nummer, bedrag én datum gelijk. 'mogelijk' = het oordeel van de zachte poort. */
  zekerheid: "zeker" | "mogelijk";
  reden: string;
}

/** Zelfde cent? Vergelijkt op honderdsten, nooit op float-gelijkheid. */
function zelfdeCent(a: number | null | undefined, b: number | null | undefined): boolean {
  if (typeof a !== "number" || typeof b !== "number") return false;
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * De harde poort, achteraf: hetzelfde nummer, hetzelfde bedrag, dezelfde datum.
 *
 * Alle drie, en dat is de reden dat dit veilig genoeg is om "zeker" te noemen. Twee facturen van
 * één leverancier delen zelden een nummer; delen ze óók het bedrag en de datum, dan is het geen
 * toeval meer maar hetzelfde papier.
 */
function zelfdeStuk(a: PossibleDupCandidate, b: PossibleDupCandidate): boolean {
  const na = normalizeInvoiceNumber(a.invoice_number);
  if (!na || na !== normalizeInvoiceNumber(b.invoice_number)) return false;
  if (!zelfdeCent(a.total_inc_btw, b.total_inc_btw)) return false;
  return !!a.invoice_date && a.invoice_date === b.invoice_date;
}

/**
 * Beoordeel een administratie op dubbele boekingen.
 *
 * `rijen` moet op binnenkomst gesorteerd staan (oudste eerst): elke factuur wordt beoordeeld tegen
 * wat er lag toen HIJ binnenkwam, precies zoals de intake dat zou hebben gedaan. Zo levert de
 * terugblik geen ander antwoord op dan de controle zelf gegeven zou hebben, en wijst hij altijd de
 * tweede boeking aan — niet de eerste, die niets fout deed.
 */
export function vindBestaandeDubbelen(rijen: readonly PossibleDupCandidate[]): BestaandeDubbele[] {
  const uit: BestaandeDubbele[] = [];
  for (let i = 0; i < rijen.length; i++) {
    const factuur = rijen[i];
    const eerder = rijen.slice(0, i);

    const hard = eerder.find((k) => zelfdeStuk(factuur, k));
    if (hard) {
      uit.push({
        id: factuur.id,
        lijktOp: hard.invoice_number ?? hard.id,
        zekerheid: "zeker",
        reden: "zelfde factuurnummer, bedrag en datum",
      });
      continue;
    }

    const zacht = assessPossibleDuplicate(
      {
        invoiceNumber: factuur.invoice_number,
        vendor: factuur.client_name,
        totalIncBtw: factuur.total_inc_btw,
        invoiceDate: factuur.invoice_date,
      },
      eerder,
    );
    if (zacht) {
      uit.push({
        id: factuur.id,
        lijktOp: zacht.match.invoice_number ?? zacht.match.id,
        zekerheid: "mogelijk",
        reden: zacht.reason,
      });
    }
  }
  return uit;
}
