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
// [BON-NUMMER] Eén definitie van "dit nummer is verzonnen" — gedeeld met de verify-queue.
import { isPlaceholderInvoiceNumber } from "@/lib/safecore";
// [CREDIT-SIGN-PUSH] Eén definitie van "dit nummer zegt credit" — gedeeld met de wachtrij, de
// betaalpagina en de auto-advance-poort. Een tweede lijst hier zou onvermijdelijk gaan afwijken.
import { looksLikeCreditnotaByNumber } from "@/lib/creditnota-signal";
// [PUSH-ACK] Dezelfde classifier als de wachtrij. Puur (geen netwerk, geen DB), dus dit bestand
// blijft testbaar zonder API-sleutel.
import { classifyImportHealth } from "@/lib/import-health";

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
  // [PUSH-ACK] De opgeslagen signalen: _safecore (dubbel, herinnering, meerdere facturen,
  // rekeningnummer gewijzigd), de AI-zekerheden, en _push_ack — waar de eigenaar heeft gezegd
  // "ik weet het, stuur toch door". Zonder dit veld ziet deze poort geen enkel voorbehoud.
  field_confidence?: unknown;
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
  | "NEEDS_REVIEW"
  | "CREDIT_SIGN_UNRESOLVED"
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
    case "NEEDS_REVIEW":
      // The generic half; the caller adds the specific reasons from pushHoldReason(). Kept apart so
      // the sentence never becomes "er is iets mis" — a refusal the owner cannot picture is one
      // they cannot act on, and this one stands between them and their boekhouder.
      return "Deze factuur heeft nog een openstaand voorbehoud. Bekijk het en kies \u201cIk weet het, stuur toch door\u201d als het klopt.";
    case "CREDIT_SIGN_UNRESOLVED":
      // Names the evidence, the consequence and the one tap out — a refusal the owner cannot act on
      // is just a wall, and this one sits between them and their boekhouder.
      return "Dit nummer begint met een creditnota-kenmerk terwijl het bedrag positief in de boeken staat. Zo geboekt telt het als schuld mee en wordt de btw opgeteld in plaats van afgetrokken — en na verwerking door je boekhouder kunnen wij dat niet meer corrigeren. Open de factuur en kies \u201cJa, dit is een creditnota\u201d (of corrigeer de bedragen) en stuur hem daarna opnieuw door.";
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
  // [BON-NUMMER] Een LEEG nummer werd hier altijd al geweigerd, maar een VERZONNEN nummer
  // ("CAMERA-1784373782895", "UPLOAD-…", "EMAIL-…") glipte erdoor en landde als factuurnummer
  // op een inkoopboeking in het wettelijke inkoopboek — een kenmerk dat op geen enkel papier
  // terug te vinden is, en dat na 'verwerkt' door prevent_verwerkt_invoice_changes bevroor.
  // Intake schrijft zulke nummers niet meer, maar de rijen die er al zijn moeten hier stoppen.
  if (!invoice.invoice_number?.trim() || isPlaceholderInvoiceNumber(invoice.invoice_number)) {
    return { ok: false, code: "MISSING_NUMBER" };
  }
  if (!invoice.client_name?.trim()) return { ok: false, code: "MISSING_RELATION" };

  const inc = invoice.total_inc_btw;
  if (typeof inc !== "number" || !Number.isFinite(inc) || Math.abs(inc) < 0.005) {
    return { ok: false, code: "NO_AMOUNTS" };
  }

  // [PUSH-ACK] Any voorbehoud the verify queue raised and the owner has not ticked off holds the
  // booking here. See the block at the foot of this file for why it is an acknowledgement and not
  // a lock. It reads the SAME classifier the queue badge reads — a second opinion about what
  // "needs review" means would let the screen and the ledger disagree about one document.
  // Skipped entirely when the caller did not supply field_confidence, so an older call site keeps
  // its previous behaviour instead of being silently blocked by a field it never passed.
  if (invoice.field_confidence !== undefined && pushHoldFlagsOf(invoice).length > 0) {
    return { ok: false, code: "NEEDS_REVIEW" };
  }

  // [CREDIT-SIGN-PUSH] A document whose own number says credit, booked as a debt, does not leave
  // this building.
  //
  // Everything else this gate refuses is a document that is INCOMPLETE — no date, no number, no
  // relation, no amount. This one is complete and wrong, which is worse, because nothing further
  // down will notice: the mapping's sum check passes (31,07 + 2,80 = 33,87 reconciles perfectly),
  // and SnelStart has no opinion about whether a supplier's CR-numbered document was a credit.
  //
  // CREDITFACTUUR CR0301267 was exactly this, sat in status 'received' — which is BOOKABLE_INCOMING
  // — and would have gone across as an inkoopboeking of +€ 33,87 in the legal purchase ledger, with
  // its btw ADDED to the reclaim instead of subtracted. And that is where it would have stayed:
  // once the accountant marks a row 'verwerkt', prevent_verwerkt_invoice_changes freezes it and
  // this app can no longer correct what it sent.
  //
  // That asymmetry is the whole reason this check lives HERE and not only on the screen. A screen
  // warning is reversible by tapping it; a booking in someone else's administration is not ours to
  // take back. The push is the last door, so it is the one that has to be shut.
  //
  // It is the same deterministic rule the verify queue and auto-advance use — the supplier's own
  // numbering, not our guess — and it has an exit that takes one tap: "Ja, dit is een creditnota"
  // flips the sign, and the row then pushes correctly AS a creditnota. Refusing is therefore never
  // a dead end, which is what makes it safe to refuse at all.
  if (looksLikeCreditnotaByNumber({
    invoiceNumber: invoice.invoice_number,
    totalIncBtw: inc,
    invoiceType: invoice.invoice_type,
  })) {
    return { ok: false, code: "CREDIT_SIGN_UNRESOLVED" };
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

// ─── [PUSH-ACK] Voorbehouden die een boeking tegenhouden, en het akkoord dat ze opheft ──────
//
// isPushable weigerde tot nu toe alleen ONVOLLEDIGE documenten: geen datum, geen nummer, geen
// naam, geen bedrag. Elk voorbehoud dat de wachtrij wél kent — "mogelijk dubbel", "dit lijkt een
// betalingsherinnering", "meerdere facturen in één bestand", "ander rekeningnummer" — reisde
// ongezien mee naar de administratie van de boekhouder. En juist die drie eerste zijn precies de
// gevallen die daar een DUBBELE of een ONVOLLEDIGE boeking worden.
//
// ── WAAROM DIT EEN AKKOORD NODIG HEEFT EN NIET ALLEEN EEN SLOT ──
// Een factuur kan met een vlag én terecht doorgestuurd worden: de eigenaar heeft naar het papier
// gekeken, weet dat die "mogelijke dubbele" een tweede echte levering is, en wil hem geboekt
// hebben. Een slot zonder sleutel zou die factuur voorgoed buiten de administratie houden — en dat
// is geen voorzichtigheid meer, dat is data die verdwijnt. Vandaar: tegenhouden tot de eigenaar het
// ZELF zegt, en dat zeggen vastleggen.
//
// ── WAAROM HET AKKOORD DE VLAGGEN OPSOMT ──
// Het akkoord geldt voor de voorbehouden die er OP DAT MOMENT waren. Zou het de factuur in het
// algemeen vrijgeven, dan zou één tik ook elke LATERE waarschuwing ontwapenen — een gewijzigd
// rekeningnummer dat pas bij de volgende import wordt ontdekt, bijvoorbeeld. Dat is het verschil
// tussen "ik heb hiernaar gekeken" en "kijk hier nooit meer naar", en alleen het eerste is wat
// iemand bedoelt als hij op die knop drukt.

/** De vlaggen die een boeking tegenhouden. Volgorde = de volgorde waarin ze op het scherm komen. */
export const PUSH_BLOCKING_FLAGS = [
  "possibleDuplicate",
  "reminder",
  "multipleInvoices",
  "ibanChanged",
  "arithmetic",
] as const;

export type PushBlockingFlag = (typeof PUSH_BLOCKING_FLAGS)[number];

/** Nederlands, want dit staat op het scherm van de ondernemer. */
const HOLD_REASON: Record<PushBlockingFlag, string> = {
  possibleDuplicate: "lijkt op een factuur die je al hebt — controleer of dit geen dubbele boeking wordt",
  reminder: "lijkt een betalingsherinnering — controleer of de originele factuur al is doorgestuurd",
  multipleInvoices: "dit bestand lijkt meerdere facturen te bevatten; er is er één ingelezen",
  ibanChanged: "deze leverancier stond bij ons onder een ander rekeningnummer",
  arithmetic: "de bedragen kloppen onderling niet",
};

export function pushHoldReason(flag: PushBlockingFlag): string {
  return HOLD_REASON[flag];
}

type AckShape = { flags?: unknown };

/** Welke voorbehouden heeft de eigenaar al afgetikt? Onbekende vormen tellen als "geen". */
export function acknowledgedFlags(fieldConfidence: unknown): Set<string> {
  const fc = fieldConfidence as { _push_ack?: AckShape } | null | undefined;
  const raw = fc?._push_ack?.flags;
  return new Set(Array.isArray(raw) ? raw.filter((f): f is string => typeof f === "string") : []);
}

/**
 * De voorbehouden die deze factuur NU nog tegenhouden: de vlaggen die aanstaan, min de vlaggen
 * waarvoor de eigenaar al akkoord heeft gegeven. Leeg = niets houdt hem tegen.
 *
 * Puur, zodat het scherm en de push-route dezelfde lijst tonen en versturen — een teller die iets
 * anders zegt dan de poort is precies waar snelstart-queue.ts al voor waarschuwt.
 */
export function pushHoldFlags(
  flags: Partial<Record<PushBlockingFlag, boolean>>,
  fieldConfidence: unknown,
): PushBlockingFlag[] {
  const acked = acknowledgedFlags(fieldConfidence);
  return PUSH_BLOCKING_FLAGS.filter((f) => flags[f] === true && !acked.has(f));
}

/**
 * De openstaande voorbehouden van één factuur, voor het scherm én voor de poort.
 *
 * Dezelfde bron als het amberen "Aandacht nodig" in de wachtrij, zodat er nooit een factuur is die
 * op het ene scherm een waarschuwing draagt en op het andere zonder slag of stoot de administratie
 * van de boekhouder in gaat.
 */
/** De kolommen die pushHoldFlagsOf nodig heeft. Als constante, zodat een route die dit leest niet
 *  per ongeluk field_confidence vergeet — precies de manier waarop deze poort blind was. */
export const SNELSTART_ACK_SELECT =
  "id, invoice_number, invoice_date, due_date, direction, invoice_type, status, total_ex_btw, btw_amount, total_inc_btw, client_name, field_confidence" as const;

export function pushHoldFlagsOf(invoice: SnelStartInvoice): PushBlockingFlag[] {
  const health = classifyImportHealth({
    total_ex_btw: invoice.total_ex_btw,
    btw_amount: invoice.btw_amount,
    total_inc_btw: invoice.total_inc_btw,
    invoice_date: invoice.invoice_date,
    invoice_number: invoice.invoice_number,
    invoice_type: invoice.invoice_type,
    field_confidence: invoice.field_confidence as never,
  });
  return pushHoldFlags(health.flags, invoice.field_confidence);
}
