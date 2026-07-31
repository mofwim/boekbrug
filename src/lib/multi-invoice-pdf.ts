// src/lib/multi-invoice-pdf.ts
// [MULTI-INVOICE] "Eén PDF = één factuur" — de zin staat onder elke uploadknop, en tot nu toe
// was het alléén een zin. Niets in de pipeline controleerde hem.
//
// Wie een stapel inkoopfacturen in één keer door de scanner haalt, krijgt één PDF. De extractor
// leest daar precies ÉÉN factuur uit — meestal de eerste — en de rest verdwijnt zonder spoor:
// geen rij, geen bestand-met-waarschuwing, geen regel in "Overgeslagen". Alleen de kosten en de
// voorbelasting die niemand meer terugvindt. Dat is exact de ontbrekende factuur die deze app
// bestaat om te voorkomen, en het is de enige weg naar binnen waar niets meekijkt.
//
// Dit is een ZACHT signaal, geen blokkade. Blokkeren zou een legitieme verzamelfactuur weigeren
// (óók een ontbrekende crediteur), dus: de factuur komt gewoon binnen, maar met een vlag die
// (a) automatisch boeken uitsluit en (b) de eigenaar in gewone taal vertelt wat hij moet doen.
//
// Bewust SMAL — liever een gemiste stapel dan een gevlagde gewone factuur:
//   · minstens TWEE VERSCHILLENDE gelabelde factuurnummers ("Factuurnummer: X"), want één nummer
//     dat twee keer op één blad staat (kop + betaalblok) is de normaalste zaak van de wereld;
//   · minstens TWEE totaal-ankers ("Totaal incl.", "Te betalen"), want een creditnota of een
//     herinnering noemt óók een tweede factuurnummer — maar rekent maar één keer af;
//   · nummers die als KRUISVERWIJZING zijn ingeleid ("betreft factuur", "creditnota van
//     factuur", "referentie") tellen niet mee: dat is een verwijzing, geen tweede factuur.
//
// Een rekeningoverzicht komt hier nooit langs: dat wordt eerder al afgevangen (is_statement) en
// belandt bij de volledigheidscontrole, niet in de boeken.
//
// Puur — geen I/O, geen AI. Draai de test met: npx tsx src/lib/multi-invoice-pdf.test.ts

export interface MultiInvoiceSignal {
  /** De verschillende factuurnummers die we in dit ene bestand vonden (genormaliseerd, ≥ 2). */
  numbers: string[];
  /** Korte, eigenaargerichte reden — gaat één op één de verify-rij en de uploadmelding in. */
  reason: string;
}

/** Label vóór het nummer dat DIT document identificeert. */
const NUMBER_LABEL =
  /(?:factuurnummer|factuurnr\.?|faktuurnummer|nota ?nummer|invoice\s*(?:number|no\.?|nr\.?|#))\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9./_-]{2,24})/gi;

/**
 * Woorden die van het volgende nummer een VERWIJZING maken in plaats van een identiteit.
 * Gemeten over de tekst vlak vóór het label, zodat "creditnota m.b.t. factuurnummer 123" niet
 * als een tweede factuur telt.
 */
const CROSS_REFERENCE =
  /(betreft|referentie|ref\.|inzake|m\.?b\.?t\.?|met betrekking tot|creditnota (?:van|voor|op)|correctie (?:van|op)|herinnering (?:van|voor)|aanmaning (?:van|voor)|oorspronkelijke?|origine(?:e)?l|vervangt|behorend bij|uw factuur|onze referentie)\s*$/i;

/** Hoeveel tekens vóór het label we meenemen om een kruisverwijzing te herkennen. */
const LOOKBEHIND = 40;

/** Een afrekening. Een echte tweede factuur heeft er zelf ook één. */
const TOTAL_ANCHOR =
  /(totaal\s*(?:incl|inclusief|te\s*betalen)|totaalbedrag|te\s*betalen\s*bedrag|\bte\s*betalen\b|total\s*(?:amount|incl)|amount\s*due)/gi;

/** Vergelijkbaar maken zonder verschillende nummers samen te vegen: alleen spaties + kast. */
function normalizeNumber(n: string): string {
  return n.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Bevat deze ene PDF-tekst meerdere VERSCHILLENDE facturen?
 * `null` = geen aanwijzing (verreweg het normale geval) — de aanroeper doet dan niets.
 */
export function detectMultipleInvoices(text: string | null | undefined): MultiInvoiceSignal | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;

  const found: string[] = [];
  const seen = new Set<string>();
  // A fresh regex per call — a module-level /g regex carries lastIndex between calls.
  const labels = new RegExp(NUMBER_LABEL.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = labels.exec(t)) !== null) {
    const before = t.slice(Math.max(0, m.index - LOOKBEHIND), m.index);
    if (CROSS_REFERENCE.test(before)) continue; // a reference to another invoice, not a second one
    const key = normalizeNumber(m[1]);
    // A bare page/line counter ("Factuurnummer: 1") is never an invoice identity.
    if (key.length < 3) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(key);
  }

  if (found.length < 2) return null;

  const totals = t.match(new RegExp(TOTAL_ANCHOR.source, "gi"))?.length ?? 0;
  if (totals < 2) return null; // one settlement → one invoice that merely names another number

  const shown = found.slice(0, 3).join(", ");
  return {
    numbers: found,
    reason:
      `dit bestand lijkt ${found.length} verschillende facturen te bevatten (${shown}` +
      `${found.length > 3 ? ", …" : ""}) — er is er maar ÉÉN ingelezen; voeg de andere los toe`,
  };
}
