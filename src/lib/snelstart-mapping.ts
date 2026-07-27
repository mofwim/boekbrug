// src/lib/snelstart-mapping.ts
// [SNELSTART] Factuur → SnelStart-boeking. Pure vertaling, geen netwerk — juli 2026
//
// Alles wat het netwerk raakt staat in snelstart-client.ts. Dit bestand doet uitsluitend
// het rekenwerk en is daarom volledig testbaar zonder API-sleutel. De regels hieronder
// zijn de boekhoudkundige kern van de koppeling:
//
//  1. Alleen ECHTE boekingen gaan mee. Een offerte, pro forma of concept is geen feit;
//     die in een administratie boeken maakt de BTW-aangifte onwaar. Zie isPushable().
//  2. Het BTW-soort wordt NOOIT geraden. SnelStart heeft per administratie eigen
//     BTW-tarieven (met eigen enum-namen); wij halen die lijst op en zoeken het tarief
//     op percentage. Vinden we niets, dan stopt de factuur met een duidelijke fout —
//     liever een blokkade dan een boeking met het verkeerde tarief.
//  3. De optelling moet kloppen. Σ regels + Σ BTW moet gelijk zijn aan het factuurbedrag.
//     Een centverschil (afrondingsruis uit de OCR) corrigeren we op de grootste regel;
//     een écht verschil is een fout, geen detail.
//  4. Een creditnota is dezelfde boeking met omgekeerd teken — niet een aparte soort.
//
// Veldnamen van de payload volgen de B2B-API v2 (factuurDatum / vervalDatum /
// factuurBedrag / boekingsregels / btw), zie docs/SNELSTART_INTEGRATION.md.

import type { SnelStartBtwTarief, BoekingType } from "@/lib/snelstart-client";

// ─── Invoer (ruwe DB-vormen, losgekoppeld van database.types voor testbaarheid) ────

export interface SnelStartInvoice {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null; // 'YYYY-MM-DD'
  due_date: string | null;
  direction: string | null; // 'incoming' | 'outgoing'
  invoice_type: string | null; // 'factuur' | 'creditnota' | 'pro_forma' | 'offerte'
  status: string | null;
  total_ex_btw: number | null;
  btw_amount: number | null;
  total_inc_btw: number | null;
  client_name: string | null; // klant (outgoing) of leverancier (incoming)
}

export interface SnelStartInvoiceLine {
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  btw_rate: number | null;
  line_total: number | null; // EX BTW
}

// ─── Fouten ───────────────────────────────────────────────────────────────────────

export type MappingErrorCode =
  | "NOT_EXPORTABLE"
  | "MISSING_NUMBER"
  | "MISSING_DATE"
  | "MISSING_RELATION"
  | "NO_AMOUNTS"
  | "AMOUNT_MISMATCH"
  | "NO_BTW_MATCH";

export class SnelStartMappingError extends Error {
  readonly code: MappingErrorCode;
  constructor(code: MappingErrorCode, message: string) {
    super(message);
    this.name = "SnelStartMappingError";
    this.code = code;
  }
}

export function dutchMappingError(code: MappingErrorCode): string {
  switch (code) {
    case "NOT_EXPORTABLE":
      return "Deze factuur kan niet naar SnelStart: alleen gecontroleerde facturen en creditnota's worden geboekt.";
    case "MISSING_NUMBER":
      return "Deze factuur heeft geen factuurnummer. Vul het nummer aan en probeer opnieuw.";
    case "MISSING_DATE":
      return "Deze factuur heeft geen factuurdatum. Vul de datum aan en probeer opnieuw.";
    case "MISSING_RELATION":
      return "Deze factuur heeft geen klant- of leveranciersnaam. Zonder naam kan SnelStart de relatie niet aanmaken.";
    case "NO_AMOUNTS":
      return "Deze factuur heeft geen bedragen. Vul de bedragen aan en probeer opnieuw.";
    case "AMOUNT_MISMATCH":
      return "De bedragen van deze factuur tellen niet op (excl. + BTW ≠ incl.). Controleer de factuur eerst.";
    case "NO_BTW_MATCH":
      return "Het BTW-tarief van deze factuur bestaat niet in je SnelStart-administratie. Voeg het tarief daar toe en probeer opnieuw.";
  }
}

// ─── Welke facturen mogen überhaupt door? ─────────────────────────────────────────

/** Statussen waarin een factuur een FEIT is en dus geboekt mag worden.
 *  Uitgaand: verstuurd/betaald/te laat. Inkomend: gecontroleerd of betaald.
 *  Bewust NIET: draft, processing, unclear (nog niet gecontroleerd) en archived. */
const BOOKABLE_OUTGOING = new Set(["sent", "paid", "overdue"]);
const BOOKABLE_INCOMING = new Set(["received", "processed", "paid"]);

export type PushableCheck = { ok: true } | { ok: false; code: MappingErrorCode };

export function isPushable(invoice: SnelStartInvoice): PushableCheck {
  const type = invoice.invoice_type ?? "factuur";
  if (type !== "factuur" && type !== "creditnota") return { ok: false, code: "NOT_EXPORTABLE" };

  const status = invoice.status ?? "";
  if (invoice.direction === "outgoing") {
    if (!BOOKABLE_OUTGOING.has(status)) return { ok: false, code: "NOT_EXPORTABLE" };
  } else if (invoice.direction === "incoming") {
    if (!BOOKABLE_INCOMING.has(status)) return { ok: false, code: "NOT_EXPORTABLE" };
  } else {
    // Richtingloze rijen bestaan in de data (oude import). Zonder richting weten we niet
    // of het een kostenpost of omzet is — dat is precies het verschil dat de aangifte maakt.
    return { ok: false, code: "NOT_EXPORTABLE" };
  }

  if (!invoice.invoice_date) return { ok: false, code: "MISSING_DATE" };
  if (!invoice.invoice_number?.trim()) return { ok: false, code: "MISSING_NUMBER" };
  if (!invoice.client_name?.trim()) return { ok: false, code: "MISSING_RELATION" };

  const inc = invoice.total_inc_btw;
  if (typeof inc !== "number" || !Number.isFinite(inc) || Math.abs(inc) < 0.005) {
    return { ok: false, code: "NO_AMOUNTS" };
  }
  return { ok: true };
}

// ─── Geld ─────────────────────────────────────────────────────────────────────────

export function round2(n: number): number {
  // Math.round(x*100) op een negatief getal rondt .5 de verkeerde kant op voor bedragen
  // (−0.005 → −0). Teken apart houden geeft symmetrisch afronden, wat een creditnota
  // exact het spiegelbeeld van de factuur maakt.
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100)) / 100;
}

/** Cent-tolerantie voor optel-controles. Twee cent: genoeg voor afrondingsruis over
 *  een handvol regels, te weinig om een echte fout te verbergen. */
const CENT_TOLERANCE = 0.02;

// ─── BTW-soort bepalen ────────────────────────────────────────────────────────────

/**
 * Zoekt het BTW-soort dat bij een percentage hoort, in de tarieven van DEZE administratie.
 *
 * Bij meerdere treffers op hetzelfde percentage (een administratie kan naast 'Hoog' ook
 * een verlegde variant kennen) wint de gewone variant: verleggen is een uitzondering die
 * de gebruiker expliciet moet kiezen, niet iets wat een automaat mag toepassen.
 */
export function resolveBtwSoort(tarieven: SnelStartBtwTarief[], rate: number): string {
  const matches = tarieven.filter((t) => Math.abs(t.percentage - rate) < 0.005);
  if (matches.length > 0) {
    const plain = matches.find((t) => !/verlegd/i.test(t.btwSoort));
    return (plain ?? matches[0]).btwSoort;
  }
  if (Math.abs(rate) < 0.005) {
    // 0% zonder eigen tarief-rij: elke administratie kent 'Geen'.
    const geen = tarieven.find((t) => /^geen$/i.test(t.btwSoort));
    if (geen) return geen.btwSoort;
    return "Geen";
  }
  throw new SnelStartMappingError(
    "NO_BTW_MATCH",
    `Geen BTW-soort in de administratie voor ${rate}%`,
  );
}

/** Het BTW-percentage dat uit de KOPregels volgt (btw ÷ excl.). Gebruikt wanneer een
 *  factuur geen regels heeft — bij ingelezen inkoopfacturen is dat de normale situatie. */
export function deriveHeaderRate(invoice: SnelStartInvoice): number {
  const ex = invoice.total_ex_btw ?? 0;
  const btw = invoice.btw_amount ?? 0;
  if (!Number.isFinite(ex) || Math.abs(ex) < 0.005) return 0;
  const raw = (btw / ex) * 100;
  // Naar het dichtstbijzijnde Nederlandse tarief trekken als we daar vlakbij zitten:
  // OCR-centen mogen 20.98% niet in een niet-bestaand tarief veranderen.
  for (const standard of [0, 9, 21]) {
    if (Math.abs(raw - standard) < 0.6) return standard;
  }
  return Math.round(raw * 100) / 100;
}

// ─── Regels bouwen ────────────────────────────────────────────────────────────────

export interface Boekingsregel {
  omschrijving: string;
  bedrag: number; // EX BTW
  btwSoort: string;
  grootboek: { id: string };
}

export interface Btwregel {
  btwSoort: string;
  btwBedrag: number;
}

export interface BoekingPayload {
  factuurnummer: string;
  factuurDatum: string; // ISO datetime
  vervalDatum?: string;
  omschrijving: string;
  factuurBedrag: number; // INCL. BTW (negatief bij creditnota)
  boekingsregels: Boekingsregel[];
  btw: Btwregel[];
  leverancier?: { id: string };
  klant?: { id: string };
}

export interface MappedBoeking {
  type: BoekingType;
  payload: BoekingPayload;
  /** Bedrag zoals verstuurd — gaat mee in snelstart_exports als bewijs. */
  amount: number;
}

/** SnelStart wil een datum als ISO-tijdstip; onze kolommen zijn kale datums. */
export function toSnelStartDate(date: string): string {
  return `${date}T00:00:00`;
}

function describe(invoice: SnelStartInvoice): string {
  const type = invoice.invoice_type === "creditnota" ? "Creditnota" : "Factuur";
  const nr = invoice.invoice_number?.trim() ?? "";
  const naam = invoice.client_name?.trim() ?? "";
  return `${type} ${nr}${naam ? ` — ${naam}` : ""}`.slice(0, 100);
}

/**
 * Zet de factuurregels om in boekingsregels + de BTW-samenvatting per soort.
 *
 * Eén boekingsregel per factuurregel (SnelStart verwacht bedragen EX BTW per regel), en
 * de BTW gebundeld per soort — zo herkent een boekhouder zijn eigen factuur terug in de
 * administratie in plaats van één anonieme bulkregel.
 */
export function buildBoekingLines(params: {
  invoice: SnelStartInvoice;
  lines: SnelStartInvoiceLine[];
  tarieven: SnelStartBtwTarief[];
  grootboekId: string;
}): { boekingsregels: Boekingsregel[]; btw: Btwregel[] } {
  const { invoice, lines, tarieven, grootboekId } = params;
  const sign = invoice.invoice_type === "creditnota" ? -1 : 1;

  // Alleen regels met een bruikbaar bedrag; 0-regels (koptekst, toelichting) hebben in een
  // boeking geen betekenis.
  const usable = lines.filter(
    (l) => typeof l.line_total === "number" && Number.isFinite(l.line_total) && l.line_total !== 0,
  );

  const headerEx = round2(Math.abs(invoice.total_ex_btw ?? 0));
  const linesSum = round2(usable.reduce((s, l) => s + Math.abs(l.line_total as number), 0));

  // Regels gebruiken we alleen als ze het kopbedrag ook echt verklaren. Wijken ze af, dan
  // is de kop de waarheid (die is gecontroleerd bij het boeken) en zouden regels een
  // verkeerd kostenbedrag in de administratie zetten.
  const useLines = usable.length > 0 && Math.abs(linesSum - headerEx) <= CENT_TOLERANCE;

  const boekingsregels: Boekingsregel[] = [];

  if (useLines) {
    for (const line of usable) {
      const rate = typeof line.btw_rate === "number" ? line.btw_rate : deriveHeaderRate(invoice);
      boekingsregels.push({
        omschrijving: (line.description?.trim() || describe(invoice)).slice(0, 100),
        bedrag: round2(sign * Math.abs(line.line_total as number)),
        btwSoort: resolveBtwSoort(tarieven, rate),
        grootboek: { id: grootboekId },
      });
    }
  } else {
    const rate = deriveHeaderRate(invoice);
    boekingsregels.push({
      omschrijving: describe(invoice),
      bedrag: round2(sign * headerEx),
      btwSoort: resolveBtwSoort(tarieven, rate),
      grootboek: { id: grootboekId },
    });
  }

  // Afrondingsrest op de grootste regel corrigeren, zodat Σ regels exact het kopbedrag is.
  const built = round2(boekingsregels.reduce((s, r) => s + r.bedrag, 0));
  const target = round2(sign * headerEx);
  const drift = round2(target - built);
  if (drift !== 0) {
    if (Math.abs(drift) > CENT_TOLERANCE) {
      throw new SnelStartMappingError(
        "AMOUNT_MISMATCH",
        `Regels tellen op tot ${built}, kop zegt ${target}`,
      );
    }
    let biggest = 0;
    for (let i = 1; i < boekingsregels.length; i++) {
      if (Math.abs(boekingsregels[i].bedrag) > Math.abs(boekingsregels[biggest].bedrag)) biggest = i;
    }
    boekingsregels[biggest].bedrag = round2(boekingsregels[biggest].bedrag + drift);
  }

  // BTW per soort, afgeleid uit de regels — en daarna geijkt op het BTW-bedrag van de kop,
  // want dát is het bedrag dat in de aangifte staat.
  const btwBySoort = new Map<string, number>();
  const totalExPerSoort = new Map<string, number>();
  for (const regel of boekingsregels) {
    totalExPerSoort.set(
      regel.btwSoort,
      round2((totalExPerSoort.get(regel.btwSoort) ?? 0) + regel.bedrag),
    );
  }
  for (const [soort, ex] of totalExPerSoort) {
    const tarief = tarieven.find((t) => t.btwSoort === soort);
    const pct = tarief?.percentage ?? 0;
    btwBySoort.set(soort, round2((ex * pct) / 100));
  }

  const headerBtw = round2(sign * Math.abs(invoice.btw_amount ?? 0));
  const computedBtw = round2([...btwBySoort.values()].reduce((s, v) => s + v, 0));
  const btwDrift = round2(headerBtw - computedBtw);
  if (btwDrift !== 0) {
    if (Math.abs(btwDrift) > CENT_TOLERANCE) {
      throw new SnelStartMappingError(
        "AMOUNT_MISMATCH",
        `BTW uit regels is ${computedBtw}, kop zegt ${headerBtw}`,
      );
    }
    // Ruis op de zwaarste BTW-soort leggen.
    let heaviest: string | null = null;
    for (const [soort, bedrag] of btwBySoort) {
      if (heaviest === null || Math.abs(bedrag) > Math.abs(btwBySoort.get(heaviest) as number)) {
        heaviest = soort;
      }
    }
    if (heaviest !== null) {
      btwBySoort.set(heaviest, round2((btwBySoort.get(heaviest) as number) + btwDrift));
    }
  }

  const btw: Btwregel[] = [...btwBySoort.entries()]
    .filter(([, bedrag]) => bedrag !== 0)
    .map(([btwSoort, btwBedrag]) => ({ btwSoort, btwBedrag }));

  return { boekingsregels, btw };
}

/**
 * De volledige vertaling: BoekBrug-factuur → SnelStart-boeking.
 *
 * `relatieId` is de al opgezochte/aangemaakte relatie in SnelStart (leverancier bij
 * inkomend, klant bij uitgaand) — het opzoeken zelf is netwerkwerk en hoort in de route.
 */
export function mapInvoiceToBoeking(params: {
  invoice: SnelStartInvoice;
  lines: SnelStartInvoiceLine[];
  tarieven: SnelStartBtwTarief[];
  grootboekId: string;
  relatieId: string;
}): MappedBoeking {
  const { invoice, lines, tarieven, grootboekId, relatieId } = params;

  const check = isPushable(invoice);
  if (!check.ok) {
    throw new SnelStartMappingError(check.code, `Factuur ${invoice.id} is niet boekbaar`);
  }

  const sign = invoice.invoice_type === "creditnota" ? -1 : 1;
  const { boekingsregels, btw } = buildBoekingLines({ invoice, lines, tarieven, grootboekId });

  const factuurBedrag = round2(sign * Math.abs(invoice.total_inc_btw as number));

  // Laatste kruiscontrole: wat we sturen moet optellen tot het factuurbedrag. Zonder deze
  // controle kan een factuur waarvan excl. + BTW ≠ incl. (kapotte OCR) tóch de
  // administratie in — en dan klopt de BTW-aangifte niet meer.
  const sum = round2(
    boekingsregels.reduce((s, r) => s + r.bedrag, 0) + btw.reduce((s, b) => s + b.btwBedrag, 0),
  );
  if (Math.abs(sum - factuurBedrag) > CENT_TOLERANCE) {
    throw new SnelStartMappingError(
      "AMOUNT_MISMATCH",
      `Boeking telt op tot ${sum}, factuurbedrag is ${factuurBedrag}`,
    );
  }

  const payload: BoekingPayload = {
    factuurnummer: (invoice.invoice_number as string).trim().slice(0, 50),
    factuurDatum: toSnelStartDate(invoice.invoice_date as string),
    omschrijving: describe(invoice),
    factuurBedrag,
    boekingsregels,
    btw,
  };
  if (invoice.due_date) payload.vervalDatum = toSnelStartDate(invoice.due_date);

  if (invoice.direction === "incoming") {
    payload.leverancier = { id: relatieId };
    return { type: "inkoopboeking", payload, amount: factuurBedrag };
  }
  payload.klant = { id: relatieId };
  return { type: "verkoopboeking", payload, amount: factuurBedrag };
}

/** Welke relatiesoort hoort bij een richting. */
export function relatieSoortFor(direction: string | null): "Klant" | "Leverancier" {
  return direction === "incoming" ? "Leverancier" : "Klant";
}
