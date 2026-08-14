// src/lib/partial-credit.ts
// [DEEL-CREDIT] Crediteren van een DEEL van een factuur. Puur, geen I/O.
// Run: npx tsx --test src/lib/partial-credit.test.ts
//
// ── WAAROM DIT ER MOET ZIJN ──
//
// Tot nu toe kende de app één soort creditnota: de hele factuur terug, en precies één per factuur
// (invoices_one_creditnota_per_original). Een klant die € 50 van een factuur van € 500 betwist —
// één beschadigd artikel, één uur dat niet is geleverd — kon niet worden bediend. De enige uitweg
// was de HELE factuur crediteren en een nieuwe sturen, en daarmee vervalt een nummer dat de klant
// allang in zijn eigen boeken heeft staan. Dat is geen randgeval; in de handel is het dinsdag.
//
// ── HET ENIGE BEDRAG DAT NOOIT MAG SCHUIVEN ──
//
// De som van alle creditnota's op één factuur mag die factuur NOOIT overschrijden. Gaat hij er
// overheen, dan geeft de ondernemer meer terug dan hij ooit in rekening bracht: de btw op het
// meerdere wordt teruggevraagd zonder dat hij is afgedragen, en de klant krijgt een tegoed dat
// nergens vandaan komt. Er is geen scherm waarop dat opvalt — beide documenten zien er los van
// elkaar volkomen normaal uit.
//
// Dat plafond staat daarom op DRIE plekken, en dat is met opzet geen dubbelop:
//   · hier, zodat het scherm het kan tonen vóór er iets gebeurt;
//   · in de route, zodat een client die het scherm overslaat wordt geweigerd;
//   · in de database (trigger, zie creditnota_partial.sql), zodat twee gelijktijdige verzoeken
//     elkaar niet kunnen passeren. Dat laatste is niet theoretisch: de unieke index die hier
//     wordt vervangen bestond precies omdat twee snelle kliks allebei door de SELECT kwamen.
//
// ── DE DOCUMENTKORTING IS DE ADDER ONDER HET GRAS ──
//
// Een korting op de hele factuur reist NIET zomaar mee naar een deelcreditnota.
//
// Een percentage wel: 10% van de gecrediteerde regels is per definitie hetzelfde deel van de
// korting. Maar een VAST BEDRAG niet. Neem een factuur van € 1.000 met € 200 korting; de klant
// betaalde € 800. Crediteer je regels ter waarde van € 500 en neem je die € 200 klakkeloos mee,
// dan geef je € 300 terug voor iets waarvoor € 400 is betaald — € 100 in je eigen zak, op een
// document dat niemand nakijkt omdat beide bedragen kloppen met zichzelf.
//
// Dus: een vast bedrag wordt geschaald naar het aandeel dat wordt gecrediteerd. Bij een VOLLEDIGE
// creditnota is dat aandeel 1 en komt er letterlijk uit wat er hiervoor uitkwam — de bestaande
// weg verandert geen cent.

import { round2 } from "./invoice-totals";
import { applyDiscount, parseDiscount, lineGrossEx, lineNetEx, type Discount } from "./invoice-discount";

/** Een regel van de ORIGINELE factuur, zoals dit bestand hem leest. */
export interface CreditableLine {
  id?: string | null;
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  btw_rate?: number | null;
  line_total?: number | null;
  unit?: string | null;
  vat_treatment?: string | null;
  discount_type?: string | null;
  discount_value?: number | string | null;
}

/** Wat de ondernemer van één regel wil crediteren. */
export interface LineSelection {
  /** De id van de originele regel. */
  id: string;
  /** Het aantal dat wordt gecrediteerd. 0 = deze regel niet. Nooit meer dan het origineel. */
  quantity: number;
}

export interface CreditSelectionInput {
  lines: readonly CreditableLine[];
  /** Leeg of afwezig = de HELE factuur, precies zoals de route dat altijd deed. */
  selection?: readonly LineSelection[] | null;
  /** De documentkorting van de originele factuur. */
  discountType?: string | null;
  discountValue?: number | string | null;
}

/** Eén regel zoals hij op de creditnota komt te staan — nog POSITIEF; de route spiegelt. */
export interface SelectedCreditLine extends CreditableLine {
  quantity: number;
}

export interface CreditSelection {
  /** De gekozen regels, met het gekozen aantal. Positief; het spiegelen gebeurt later. */
  lines: SelectedCreditLine[];
  /** De documentkorting zoals hij op DEZE creditnota hoort — geschaald bij een vast bedrag. */
  discount: Discount | null;
  /** Wat er wordt gecrediteerd, incl. btw, als POSITIEF bedrag. */
  totalIncBtw: number;
  totalExBtw: number;
  btwAmount: number;
  /** Is dit de hele factuur? Dan is dit exact de creditnota van vóór deze functie. */
  isFull: boolean;
}

/** Waarom een selectie niet kan. Null als er niets mis is. */
export type CreditSelectionFault =
  | "no_lines"
  | "nothing_selected"
  | "unknown_line"
  | "quantity_exceeds_line"
  | "quantity_negative";

const EPSILON = 0.005;

/** Het aantal van een regel, als bruikbaar getal. */
function qtyOf(l: CreditableLine): number {
  const q = Number(l.quantity ?? 0);
  return Number.isFinite(q) ? q : 0;
}

/**
 * Controleer een selectie tegen de regels waar hij bij hoort.
 *
 * Streng, want dit is de kant die niet in de hand wordt gehouden: een client die een aantal
 * stuurt dat hoger is dan de regel zou meer crediteren dan er ooit is geleverd, en op een
 * genummerd document is dat niet terug te draaien.
 */
export function checkCreditSelection(
  lines: readonly CreditableLine[],
  selection: readonly LineSelection[] | null | undefined,
): CreditSelectionFault | null {
  if (!lines.length) return "no_lines";
  if (!selection || selection.length === 0) return null; // geen selectie = de hele factuur

  const byId = new Map(lines.filter((l) => l.id).map((l) => [String(l.id), l]));
  let anything = false;
  for (const s of selection) {
    const bron = byId.get(String(s.id));
    if (!bron) return "unknown_line";
    const gevraagd = Number(s.quantity);
    if (!Number.isFinite(gevraagd)) return "quantity_negative";

    // Het TEKEN van de originele regel bepaalt de richting. Een creditregel binnen een factuur
    // ([MIN-REGEL], een retour die op de volgende factuur is verrekend) heeft een negatief
    // aantal, en daarvan crediteren betekent een negatief aantal terugnemen. De magnitude is
    // wat begrensd moet worden, in allebei de richtingen.
    const origineel = qtyOf(bron);
    if (origineel === 0) return "quantity_exceeds_line";
    if (gevraagd !== 0 && Math.sign(gevraagd) !== Math.sign(origineel)) return "quantity_negative";
    if (Math.abs(gevraagd) > Math.abs(origineel) + 1e-9) return "quantity_exceeds_line";
    if (Math.abs(gevraagd) > 0) anything = true;
  }
  return anything ? null : "nothing_selected";
}

/**
 * Bouw de creditnota-inhoud uit een selectie.
 *
 * Zonder selectie: de hele factuur, en dan is het resultaat regel voor regel het origineel — de
 * weg die er al was, ongewijzigd tot op de cent.
 */
export function buildCreditSelection(input: CreditSelectionInput): CreditSelection {
  const documentkorting = parseDiscount(input.discountType, input.discountValue);
  const alles = !input.selection || input.selection.length === 0;

  // Het regelbedrag wordt HERBEREKEND uit het gekozen aantal, en dat is geen detail.
  //
  // `line_total` van de bronregel hoort bij het VOLLE aantal. De spiegel in creditnota-lines.ts
  // draait precies dat veld om, dus zonder deze herberekening zou een creditnota van 3 van de 10
  // stuks een regel opleveren die "−3 stuks" zegt en het bedrag van tien draagt: de klant krijgt
  // ruim drie keer te veel terug, op een document waarop het aantal en het bedrag elkaar
  // tegenspreken zonder dat één van beide er verkeerd uitziet.
  //
  // Bij een VOLLEDIGE creditnota levert lineNetEx exact het opgeslagen bedrag op — dezelfde
  // afronding, dezelfde regelkorting — dus daar verandert er niets.
  const metBedrag = (l: CreditableLine, quantity: number): SelectedCreditLine => ({
    ...l,
    quantity,
    line_total: lineNetEx({
      quantity,
      unit_price: l.unit_price,
      discount_type: l.discount_type,
      discount_value: l.discount_value,
    }),
  });

  const gekozen: SelectedCreditLine[] = alles
    ? input.lines.map((l) => metBedrag(l, qtyOf(l)))
    : (() => {
        const gevraagd = new Map(input.selection!.map((s) => [String(s.id), Number(s.quantity) || 0]));
        return input.lines
          .filter((l) => l.id && Math.abs(gevraagd.get(String(l.id)) ?? 0) > 0)
          .map((l) => metBedrag(l, gevraagd.get(String(l.id))!));
      })();

  // Het aandeel dat wordt gecrediteerd, gemeten over de BRUTO regelbedragen — dus vóór de
  // regelkortingen. Dat is de juiste noemer: de documentkorting werd destijds ook over het geheel
  // berekend, en een deel daarvan hoort bij dit deel van de levering.
  //
  // Bruto en niet netto, omdat een regel met een eigen korting anders twee keer meetelt in de
  // verhouding: één keer in de teller en één keer in de noemer, allebei verlaagd — wat op een
  // factuur met ongelijk verdeelde regelkortingen een ander aandeel oplevert dan het aandeel van
  // de levering. De regelkortingen zitten hoe dan ook al in de bedragen zelf.
  const brutoAlles = round2(input.lines.reduce((s, l) => s + Math.abs(lineGrossEx(l)), 0));
  const brutoGekozen = round2(
    gekozen.reduce((s, l) => s + Math.abs(lineGrossEx({ ...l, quantity: l.quantity })), 0),
  );
  const aandeel = brutoAlles === 0 ? 0 : brutoGekozen / brutoAlles;

  // Een percentage is al pro rata; een vast bedrag moet worden meegeschaald. Zie de kop.
  const korting: Discount | null = !documentkorting
    ? null
    : documentkorting.type === "percent"
      ? documentkorting
      : { type: "amount", value: round2(documentkorting.value * aandeel) };

  const totalen = applyDiscount(
    gekozen.map((l) => ({
      // Het regelbedrag wordt HERBEREKEND uit het gekozen aantal — het opgeslagen line_total
      // hoort bij het volle aantal en zou een deelcreditnota op het hele bedrag zetten.
      quantity: l.quantity,
      unit_price: l.unit_price,
      btw_rate: l.btw_rate,
      discount_type: l.discount_type,
      discount_value: l.discount_value,
    })),
    korting && korting.value > 0 ? korting : null,
  );

  return {
    lines: gekozen,
    discount: korting && korting.value > 0 ? korting : null,
    totalExBtw: totalen.total_ex_btw,
    btwAmount: totalen.btw_amount,
    totalIncBtw: totalen.total_inc_btw,
    // "Alles" is niet alleen een lege selectie: een selectie die toevallig elke regel voor het
    // volle aantal noemt, is dezelfde creditnota en moet dat ook zeggen.
    isFull:
      alles ||
      (gekozen.length === input.lines.length &&
        gekozen.every((l) => Math.abs(l.quantity - qtyOf(l)) < 1e-9)),
  };
}

/**
 * Hoeveel er nog gecrediteerd MAG worden op een factuur, incl. btw en als positief bedrag.
 *
 * `alreadyCredited` is de som van de magnitudes van de bestaande creditnota's. Nooit negatief:
 * is er om wat voor reden dan ook al meer gecrediteerd dan de factuur groot is, dan is het
 * antwoord nul en niet een uitnodiging om het verschil goed te maken.
 */
export function creditableRemaining(
  originalTotalIncBtw: number | null | undefined,
  alreadyCredited: number,
): number {
  const totaal = Math.abs(Number(originalTotalIncBtw) || 0);
  const gedaan = Math.abs(Number(alreadyCredited) || 0);
  const rest = round2(totaal - gedaan);
  return rest > 0 ? rest : 0;
}

/**
 * Past deze creditnota nog binnen de factuur?
 *
 * De marge van een halve cent is dezelfde die de rest van de app hanteert voor "dit bedrag is
 * afbetaald": afrondingsruis mag een laatste, kloppende creditnota niet tegenhouden.
 */
export function fitsWithinOriginal(
  originalTotalIncBtw: number | null | undefined,
  alreadyCredited: number,
  wanted: number,
): boolean {
  return Math.abs(wanted) <= creditableRemaining(originalTotalIncBtw, alreadyCredited) + EPSILON;
}

/**
 * De weigering die de ondernemer leest wanneer een creditnota niet meer past.
 *
 * Nederlands in een Engels bestand (AGENTS.md): dit is geen commentaar maar de zin die de route
 * terugstuurt en het scherm toont, en de route heeft geen taalinstelling om mee te vertalen.
 */
export function overCreditReason(remaining: number): string {
  return remaining <= 0
    ? "Deze factuur is al volledig gecrediteerd."
    : `Er kan nog maximaal € ${remaining.toFixed(2).replace(".", ",")} van deze factuur worden gecrediteerd.`;
}
