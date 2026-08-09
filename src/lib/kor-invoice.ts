// src/lib/kor-invoice.ts
// [KOR-FACTUUR] Under the KOR an invoice may not charge btw. Pure, no I/O.
// Run: npx tsx --test src/lib/kor-invoice.test.ts
//
// WHY THIS HAS TO EXIST AT INVOICE TIME AND NOT ONLY IN THE AANGIFTE
//
// This app already knows about the KOR everywhere DOWNSTREAM. regime-flags.ts writes a careful
// paragraph about it, and it is thorough — it even names the trap that the right to DEDUCT lapses
// too, so an owner does not reclaim voorbelasting they are not entitled to. The readiness check
// knows. The closing package knows.
//
// The invoice screen did not. `kor_active` appeared nowhere in it, so an owner in the KOR could
// pick 21%, send the invoice, and hear about it at the aangifte — up to three months later, with
// the customer holding the document.
//
// By then it is money, not a warning:
//
//   · Art. 37 Wet OB: whoever states btw on an invoice OWES that btw, whether or not it was due.
//     Putting the number on the page is the taxable event for this purpose.
//   · Under the KOR there is no right to deduct, so nothing offsets it.
//   · And it cannot be withdrawn. A numbered invoice is corrected with a creditnota (Art. 35), so
//     the fix is a second document to a customer who did nothing wrong.
//
// The one moment where it is still free to fix is the moment before it is sent. That is what this
// module is for.
//
// WHERE IT IS ENFORCED, AND WHY THERE
//   · The create screen offers 0% and nothing else, with the reason written next to it. That
//     prevents the mistake rather than reporting it.
//   · The SEND route refuses. A draft carrying 21% is harmless — it is editable and nobody has it.
//     A sent one is irreversible, and the send route is the only place that already reads the
//     owner's profile. It also catches the case the screen cannot: a draft made BEFORE the owner
//     switched the KOR on.
//
// It refuses rather than silently correcting. Quietly changing the amounts on a document the owner
// just reviewed, on the press of the one irreversible button, is not a fix.

/** The only rate a KOR invoice may carry. Not a default — the only one. */
export const KOR_ALLOWED_RATE = 0;

export interface KorLine {
  btw_rate?: number | null;
}

export type KorCheck =
  | { ok: true }
  | { ok: false; code: "kor_btw_charged"; lines: number[]; error: string };

/** 1-based positions of the lines that charge btw. Empty when the invoice is KOR-clean. */
export function korLineViolations(lines: readonly KorLine[] | null | undefined): number[] {
  const out: number[] = [];
  (lines ?? []).forEach((l, i) => {
    const rate = Number(l?.btw_rate);
    // A rate that is not a number at all is somebody else's error to report — this module only
    // ever objects to btw that is definitely being charged.
    if (Number.isFinite(rate) && rate !== KOR_ALLOWED_RATE) out.push(i + 1);
  });
  return out;
}

/**
 * May this invoice go out?
 *
 * `korActive === false` (or unknown) returns ok for everything, so nothing changes for the owners
 * who are not in the scheme — which is most of them.
 */
export function checkKorInvoice(args: {
  korActive: boolean | null | undefined;
  lines: readonly KorLine[] | null | undefined;
}): KorCheck {
  if (!args.korActive) return { ok: true };
  const lines = korLineViolations(args.lines);
  if (lines.length === 0) return { ok: true };

  // Dutch: this sentence goes to the screen. It has to say what is wrong, why it matters in money,
  // and what to do — an owner who reads only "mag niet" will simply try again.
  const welke = lines.length === 1 ? `Regel ${lines[0]}` : `Regels ${lines.join(", ")}`;
  return {
    ok: false,
    code: "kor_btw_charged",
    lines,
    error:
      `${welke} ${lines.length === 1 ? "rekent" : "rekenen"} BTW, maar je hebt de ` +
      "kleineondernemersregeling (KOR) aanstaan — daaronder breng je geen BTW in rekening. " +
      "Zet het tarief op 0%. Verstuur je hem tóch met BTW, dan ben je die BTW verschuldigd " +
      "(art. 37 Wet OB) terwijl je onder de KOR niets mag terugvragen, en terugdraaien kan alleen " +
      "nog met een creditnota. Klopt de KOR niet meer? Pas hem aan bij Instellingen.",
  };
}

/** The line the create screen shows beside the rate menu, so the missing choices are explained. */
export const KOR_RATE_HINT =
  "Je hebt de KOR aanstaan, dus je brengt geen BTW in rekening — 0% is het enige tarief. " +
  "Klopt dat niet meer? Pas het aan bij Instellingen.";
