// src/lib/reverse-charge-invoice.ts
// [VERLEGD-VERKOOP] The domestic verleggingsregeling on a SALES invoice. Pure, no I/O.
// Run: npx tsx --test src/lib/reverse-charge-invoice.test.ts
//
// A subcontractor in bouw, an uitzender, a cleaner, a scrap dealer: they invoice WITHOUT btw and
// the customer — the hoofdaannemer — accounts for it (art. 12 lid 5 Wet OB 1968 jo. art. 24b
// Uitvoeringsbesluit OB 1968). Until this module the app knew that regime on ONE side only: a
// purchase that says "btw verlegd" reaches rubriek 2a. On the selling side the only way to issue
// such an invoice was to pick 0% and type the words into a line: the PDF printed no statutory
// sentence, the e-invoice found the words by regex or exported the supply as plain zero-rated, and
// nothing asked for the customer's btw-id. That invoice is formally deficient — art. 35a lid 1 Wet
// OB wants the customer's btw-identificatienummer (sub d) and the words "btw verlegd" (sub j) —
// which is the ground on which the customer's own filing gets questioned. The first companies in
// the test are bouwbedrijven, where a subcontractor cannot issue their basic invoice without it.
//
// Two things live here, beside each other so they cannot disagree:
//
//   · the REFUSAL at the send door — a verlegd invoice without the customer's btw-id, under the
//     KOR, or with btw on a verlegd line never gets a number;
//   · the SENTENCE the PDF prints, with the customer's number in it, the way the intracommunautaire
//     sentence in icp.ts does. That module keeps the EU case (a buyer in another member state is
//     verlegd on a different legal ground); this one keeps the domestic case; the PDF asks the EU
//     one first and prints ONE sentence, never two.
//
// What it does NOT do: decide whether the regeling applies. That is the owner's judgement about
// their trade and their customer; the app records the choice and makes the document complete.
//
// Dutch strings: the refusal reaches the screen through the send route's `error`, exactly like
// kor-invoice.ts, and the sentence is document content read by a Dutch customer.

import { normalizeVatNumber } from "./icp";
import { hasReverseChargeLine, isReverseChargeLine, type TreatedLine } from "./line-vat-treatment";

export type ReverseChargeCheck =
  | { ok: true }
  | {
      ok: false;
      code: "verlegd_zonder_btw_nummer" | "verlegd_onder_kor" | "verlegd_met_btw";
      /** 1-based positions of the lines concerned, in the numbering the owner sees. */
      lines: number[];
      error: string;
    };

/** 1-based positions of the verlegd lines. Empty when nothing on the document is verlegd. */
export function reverseChargeLineNumbers(
  lines: readonly (TreatedLine | null | undefined)[] | null | undefined,
): number[] {
  const out: number[] = [];
  (lines ?? []).forEach((l, i) => {
    if (isReverseChargeLine(l)) out.push(i + 1);
  });
  return out;
}

/**
 * May this invoice go out?
 *
 * An invoice without a verlegd line returns ok for everything, so nothing changes for the owners
 * who never use the regeling — which is most of them.
 */
export function checkReverseChargeInvoice(args: {
  korActive: boolean | null | undefined;
  clientBtwNumber: string | null | undefined;
  lines: readonly (TreatedLine | null | undefined)[] | null | undefined;
}): ReverseChargeCheck {
  const nrs = reverseChargeLineNumbers(args.lines);
  if (nrs.length === 0) return { ok: true };
  const welke = nrs.length === 1 ? `Regel ${nrs[0]}` : `Regels ${nrs.join(", ")}`;
  const werkwoord = nrs.length === 1 ? "verlegt" : "verleggen";

  // Under the KOR the owner's supply is exempt (art. 25 Wet OB); there is no btw to shift, and a
  // document claiming a verlegging makes a statement about a regime the owner is not in.
  if (args.korActive) {
    return {
      ok: false,
      code: "verlegd_onder_kor",
      lines: nrs,
      error:
        `${welke} ${werkwoord} de btw naar de klant, maar je hebt de kleineondernemersregeling (KOR) ` +
        "aanstaan — onder de KOR is je prestatie vrijgesteld en geldt de verleggingsregeling niet. " +
        "Kies gewoon 0% zonder verlegging, of pas de KOR aan bij Instellingen.",
    };
  }

  // A verlegd line that charges btw contradicts itself: shifted btw is btw the seller does not
  // charge. Stating it anyway makes it owed (art. 37 Wet OB) while the customer also declares it.
  const metBtw: number[] = [];
  (args.lines ?? []).forEach((l, i) => {
    if (isReverseChargeLine(l) && Number(l?.btw_rate) > 0) metBtw.push(i + 1);
  });
  if (metBtw.length > 0) {
    const welkeMetBtw = metBtw.length === 1 ? `Regel ${metBtw[0]}` : `Regels ${metBtw.join(", ")}`;
    return {
      ok: false,
      code: "verlegd_met_btw",
      lines: metBtw,
      error:
        `${welkeMetBtw} ${metBtw.length === 1 ? "verlegt" : "verleggen"} de btw naar de klant én ` +
        "rekent btw. Dat kan niet allebei: bij verlegging staat er 0% op de regel.",
    };
  }

  // Art. 35a lid 1 sub d: the customer's btw-identificatienummer, on the invoice. Without it the
  // customer cannot declare the shifted btw against a document that names them, and the seller's
  // 0% rests on nothing.
  if (normalizeVatNumber(args.clientBtwNumber).length === 0) {
    return {
      ok: false,
      code: "verlegd_zonder_btw_nummer",
      lines: nrs,
      error:
        `${welke} ${werkwoord} de btw naar de klant, maar het btw-nummer van de klant ontbreekt. ` +
        "Bij verlegging moet dat nummer op de factuur staan (art. 35a Wet OB) — zonder dat nummer " +
        "kan de klant de verlegde btw niet aangeven. Vul het btw-nummer in bij de klant en verstuur opnieuw.",
    };
  }

  return { ok: true };
}

/**
 * The statutory sentence for a domestic verlegging, or null when it does not apply.
 *
 * Null for a quote (not a legal invoice, no btw statement — the boundary icp.ts draws too), under
 * the KOR (the send door refuses that document anyway), and on any document without a verlegd
 * line. The customer's number is normalised the way the EU sentence normalises it; a legacy row
 * without one still gets the words the law asks for verbatim.
 */
export function domesticReverseChargeNotice(args: {
  lines: readonly (TreatedLine | null | undefined)[] | null | undefined;
  clientBtwNumber: string | null | undefined;
  invoiceType: string | null | undefined;
  korActive?: boolean | null;
}): string | null {
  const type = args.invoiceType ?? "factuur";
  if (type !== "factuur" && type !== "creditnota") return null;
  if (args.korActive === true) return null;
  if (!hasReverseChargeLine(args.lines)) return null;
  const nr = normalizeVatNumber(args.clientBtwNumber);
  return nr
    ? `Btw verlegd — artikel 12 lid 5 Wet OB 1968. BTW-nummer afnemer: ${nr}.`
    : "Btw verlegd — artikel 12 lid 5 Wet OB 1968.";
}
