// src/lib/category-wait.ts
// [WAAROM-WACHT-CAT] Why the app will not code THIS bank line for you. Pure, no I/O.
//
// ── WHY THIS EXISTS ──
//
// The categorisatie screen labels every to-do line with one word: "onthouden", "lijkt op X",
// "herkend", "voorstel". Three of those are true and useful. The fourth was actively misleading.
//
// suggestIdentity returns `confident: false` on a REMEMBERED category when the sign contradicts
// it — the owner once coded this counterparty as 'omzet' and this line is a debit, or coded it as
// 'kosten' and money came back. That is not a detail: applying the memory blindly would book
// turnover as a negative amount, quietly lowering omzet without tripping the rate warning (the
// reasoning is written out in bank-identity.ts, [TEKEN-EERST]).
//
// The screen rendered that line as "onthouden" — exactly like a memory the app IS sure of. The one
// suggestion the app distrusts looked like the one it trusts most, and the owner has no way to
// tell them apart. That is the same failure as a health check whose "could not run" renders green.
//
// So: name the reason, and let the screen say it in words. Three reasons, three different
// afternoons:
//
//   · the memory points the other way   — a refund, a repayment, a reversal. Check the direction.
//   · it resembles another counterparty — helpful, not identity. Two shops sharing a name are not
//                                         one business.
//   · never seen before                 — the suggestion is the bare sign, and the app says so
//                                         rather than dressing a guess as a proposal.
//
// A confident suggestion gets no reason at all: it is not waiting on an explanation, it is waiting
// on a tap, and the sweep button is right above it.

import type { IdentitySuggestion } from "./bank-identity";
import type { MessageKey } from "./i18n/messages";

export type CategoryWaitReason =
  | "memory_contradicts_direction"
  | "resembles_another_counterparty"
  | "counterparty_never_seen";

/**
 * Name why this suggestion is not one the app will apply for the owner.
 *
 * Judged on the SUGGESTION, before the double-booking hold is folded in: a line whose money is
 * already booked carries its own explanation on the screen ([DUBBEL-GEDEKT]) and must not be
 * described here as a classifier problem it never had.
 */
export function judgeCategoryWait(suggestion: IdentitySuggestion): CategoryWaitReason | null {
  if (suggestion.confident) return null;
  // A remembered category can only be un-confident one way: the sign contradicts it. That is the
  // case worth a sentence, because the label above it says "onthouden" either way.
  if (suggestion.source === "memory") return "memory_contradicts_direction";
  if (suggestion.source === "similar") return "resembles_another_counterparty";
  // 'ai' without confidence is the bare kosten/omzet fallback — a guess by sign alone. ('supplier'
  // is always confident, so it never reaches here; if that ever changes, this reads as the guess
  // it would then be, which is the safe direction to be wrong in.)
  return "counterparty_never_seen";
}

/**
 * The short label above a to-do line — the one that used to say "onthouden" for a memory the app
 * distrusts.
 *
 * It lives here and not in the JSX for the reason AGENTS.md gives: a component holds no language
 * of its own, and a nested ternary inside a render is the one place nobody can write a test
 * against. The full sentence still goes underneath; this is the two words above it.
 */
export type CategoryHint = { key: MessageKey; name?: string };

export function categoryHint(args: {
  source: "memory" | "ai" | "similar" | "supplier";
  /** The machine tag judgeCategoryWait produced for this line, or null when it is confident. */
  waitReason: string | null | undefined;
  /** On a 'similar' suggestion: the counterparty it resembles, already made readable. */
  similarTo?: string | null;
  /** Whether the app would fill this one in itself. */
  confident: boolean;
}): CategoryHint {
  if (args.source === "memory") {
    // The distinction this module exists for. Judged on the REASON, never on `confident`: the
    // screen's confident flag folds in the double-booking hold, and a line whose money is already
    // booked is not a contradicted memory.
    return { key: args.waitReason === "memory_contradicts_direction" ? "cat.onthoudenAndersom" : "cat.onthouden" };
  }
  if (args.source === "similar") {
    const naam = (args.similarTo ?? "").trim();
    return naam ? { key: "cat.lijktOp", name: naam } : { key: "cat.lijktOpEerdere" };
  }
  return { key: args.confident ? "cat.herkend" : "cat.voorstel" };
}
