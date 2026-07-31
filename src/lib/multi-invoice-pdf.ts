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

// ── [ONE-INVOICE-UNVERIFIED] Het gat in de controle hierboven ────────────────────────────────
//
// De kop van dit bestand noemt het geval zelf: "wie een stapel inkoopfacturen in één keer door de
// SCANNER haalt, krijgt één PDF". Precies die stapel is wat detectMultipleInvoices nooit kan zien.
// Hij leest de tekstlaag, en een scan heeft er geen — extractPdfText geeft dan null terug, en de
// functie hierboven stapt bij `typeof text !== "string"` meteen weer uit. Geen tekst, geen nummers,
// geen signaal. De controle die voor de scanner is geschreven, zwijgt juist bij de scanner.
//
// En zwijgen is hier niet neutraal. Zonder vlag is er niets dat automatisch boeken tegenhoudt, dus
// de uitkomst van een gescande stapel is: één factuur wordt gelezen, zonder mens geboekt, en de
// andere bestaan nergens — geen rij, geen bestand-met-waarschuwing, geen regel in "Overgeslagen".
// Dat is exact het scenario dat de kop hierboven beschrijft, alleen langs de weg waar de controle
// blind is.
//
// Dit is dus geen tweede detector maar het eerlijke antwoord op "ik kon het niet controleren".
// shouldAutoAdvanceInvoice noemt zichzelf "fail-closed by construction": elke twijfel, elk ontbrekend
// signaal → de mens. Een ONTBREKENDE controle is geen geslaagde controle, en zo hoort hij ook te
// tellen.
//
// Bewust smal, want automatisch boeken is de moeite waard om te behouden:
//   · ÉÉN pagina → één factuur. Een foto van een bon, een gewone factuur-PDF: niets aan de hand,
//     ook zonder tekstlaag. Dit raakt ze niet.
//   · MEER pagina's MÉT tekstlaag → detectMultipleInvoices heeft echt gekeken en niets gevonden.
//     Dat is een uitspraak, en die vertrouwen we.
//   · MEER pagina's ZONDER tekstlaag → we hebben niet gekeken. Alleen dít geval wacht op een mens.
//
// Het kost de eigenaar één bevestigende tik op een gescande meerpagina-factuur, en niet meer dan
// dat: de factuur komt gewoon binnen, precies zoals bij het signaal hierboven. Blokkeren doet ook
// deze nooit.

/** Waarom we niet kunnen zeggen dat dit bestand één factuur is. */
export interface UnverifiedSingleInvoice {
  reason: string;
}

/**
 * Kon er überhaupt gecontroleerd worden of dit ene bestand één factuur bevat?
 *
 * `null` = ja (of de vraag speelt niet) → de aanroeper doet niets.
 * Een object = nee → vlag zetten en niet automatisch boeken.
 *
 * Puur. `pages` is 0 wanneer het bestand geen PDF is of niet te openen was; dat telt als "geen
 * meerpagina-bestand", want een niet-PDF is per definitie één beeld.
 */
export function cannotVerifySingleInvoice(input: {
  pages: number;
  hasTextLayer: boolean;
}): UnverifiedSingleInvoice | null {
  if (input.hasTextLayer) return null;
  if (!Number.isFinite(input.pages) || input.pages <= 1) return null;
  return {
    reason:
      `dit is een gescand bestand van ${input.pages} pagina's zonder leesbare tekstlaag — we konden ` +
      `niet nagaan of het één factuur is of een stapel. Controleer of alle facturen erin zijn geboekt`,
  };
}

// ─── De signalen opslaan en weer weghalen ────────────────────────────────────────────────────
//
// Schrijven en wissen staan hier NAAST elkaar, met één lijst sleutels per signaal ertussen. Dat is
// dezelfde afspraak als in possible-duplicate-collect.ts, en om dezelfde reden: dit bestand is de
// enige plek die weet uit welke velden deze signalen bestaan, en een tweede handgeschreven lijst
// (in de route, bijvoorbeeld) is een fout die op de volgende sleutel wacht.

/** De sleutels van "we ZAGEN meerdere facturen". */
const MULTI_INVOICE_KEYS = [
  "multiple_invoices",
  "multiple_invoices_reason",
  "multiple_invoices_numbers",
] as const;

/** De sleutels van "we KONDEN het niet nagaan" — dezelfde vraag, andere grond. */
const UNVERIFIED_SINGLE_KEYS = [
  "one_invoice_unverified",
  "one_invoice_unverified_reason",
  "one_invoice_unverified_pages",
] as const;

/** Onveranderlijk een _safecore-blok bijwerken; geeft altijd een nieuw object terug. */
function withSafecore(fieldConfidence: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const fc =
    fieldConfidence && typeof fieldConfidence === "object" && !Array.isArray(fieldConfidence)
      ? { ...(fieldConfidence as Record<string, unknown>) }
      : {};
  const prior = fc._safecore;
  const safecore =
    prior && typeof prior === "object" && !Array.isArray(prior)
      ? { ...(prior as Record<string, unknown>) }
      : {};
  fc._safecore = { ...safecore, ...patch };
  return fc;
}

/**
 * Zet "dit bestand bevat meerdere facturen" in field_confidence._safecore.
 *
 * classifyImportHealth leest deze sleutels → needs-review, dus nooit automatisch boeken, en de
 * controlerij toont de reden. Geeft de invoer ongewijzigd terug als er niets te vlaggen valt.
 */
export function mergeMultipleInvoices(fieldConfidence: unknown, signal: MultiInvoiceSignal | null): unknown {
  if (!signal) return fieldConfidence ?? null;
  return withSafecore(fieldConfidence, {
    multiple_invoices: true,
    multiple_invoices_reason: signal.reason,
    multiple_invoices_numbers: signal.numbers,
  });
}

/**
 * Zet "we konden niet nagaan of dit één factuur is" in field_confidence._safecore.
 *
 * De keerzijde van hierboven, en het bewijs dat de twee bij elkaar horen: import-health zet ze op
 * DEZELFDE vlag, omdat de eigenaar in beide gevallen dezelfde vraag beantwoordt.
 */
export function mergeUnverifiedSingle(
  fieldConfidence: unknown,
  signal: UnverifiedSingleInvoice | null,
  pages: number,
): unknown {
  if (!signal) return fieldConfidence ?? null;
  return withSafecore(fieldConfidence, {
    one_invoice_unverified: true,
    one_invoice_unverified_reason: signal.reason,
    one_invoice_unverified_pages: pages,
  });
}

/**
 * De omgekeerde weg: haal BEIDE signalen weg, en niets anders.
 *
 * Eén functie voor allebei, omdat de eigenaar één vraag beantwoordt — "nee, dit is één factuur" —
 * en import-health die twee gronden al op dezelfde vlag zet. Zou dit er maar één wissen, dan bleef
 * de badge staan na een antwoord dat hem hoorde weg te halen, en dat is precies hoe een
 * waarschuwing ruis wordt.
 *
 * Wat blijft staan: de rekenkundige uitspraak, een gewisseld IBAN, een mogelijk duplicaat. Geen
 * daarvan is beantwoord door een antwoord over dít, en stilletjes een andere waarschuwing
 * meenemen zou een echte waarschuwing weghalen van een factuur waar niemand meer naar kijkt.
 *
 * Geeft `null` terug wanneer er niets te wissen viel, zodat de aanroeper "gewist" kan onderscheiden
 * van "er stond niets" in plaats van een succes te melden dat er niet was.
 */
export function clearSingleInvoiceDoubt(fieldConfidence: unknown): Record<string, unknown> | null {
  if (!fieldConfidence || typeof fieldConfidence !== "object" || Array.isArray(fieldConfidence)) {
    return null;
  }
  const fc = fieldConfidence as Record<string, unknown>;
  const prior = fc._safecore;
  if (!prior || typeof prior !== "object" || Array.isArray(prior)) return null;
  const safecore = { ...(prior as Record<string, unknown>) };
  const flagged = safecore.multiple_invoices === true || safecore.one_invoice_unverified === true;
  if (!flagged) return null; // niets gevlagd → geen nep-succes
  for (const k of [...MULTI_INVOICE_KEYS, ...UNVERIFIED_SINGLE_KEYS]) delete safecore[k];
  return { ...fc, _safecore: safecore };
}
