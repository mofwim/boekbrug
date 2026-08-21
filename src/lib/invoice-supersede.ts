// src/lib/invoice-supersede.ts
// [SUPERSEDE] "Deze vervangt factuur X" — may the flagged invoice replace the one it was matched
// against, and if not, why not? Decided ONCE, in a pure function, so the button, the confirmation
// and the API route can never disagree. NO I/O.
//
// The situation this answers is ordinary and keeps happening: a supplier invoices the wrong
// amount, corrects it, and re-sends. Both copies import. Since [DEDUP-CORRECTED] the queue says
// so ("zelfde factuurnummer, ander bedrag"), but saying it was all it did — the owner still had
// to go to another screen, find the old one, and remove it there. Two screens and a good memory
// for what is really one answer.
//
// What "vervangen" does, and what it deliberately does NOT do:
//   · The OLD invoice is ARCHIVED, never deleted. Bewaarplicht (art. 52 AWR) keeps the record
//     seven years, and every financial surface reads an allow-list, so archiving takes it out of
//     kosten, BTW, the bank matcher and the accountant's workspace in one status change.
//   · It is REVERSIBLE. Archiving is the same reversible move the remove button already makes:
//     the invoice sits under Inkomend › Genegeerd and comes back with one tap. This is NOT the
//     creditnota case (replaced_by_number), where a booked correction makes a restore a double
//     count — here nothing was booked, so being wrong costs nothing but a tap.
//   · The NEW invoice is untouched. It stays in the verify queue and is confirmed like any other.
//     Superseding is not a shortcut past verification.
//
// And the refusals, which are the whole reason this is a decision and not an update:
//   · MONEY on the old invoice. Once anything is settled — 'paid', or a deelbetaling on an open
//     invoice — archiving would hide euros that genuinely moved. This is exactly the wall the
//     owner hit in the first place, so it names the same exit: undo the payment first.
//   · The ACCOUNTANT's lock ('verwerkt') outranks the owner's tap, as everywhere else.
//   · The two must be a real PAIR: same owner, both purchase invoices, and not the same row. A
//     supersede that could point anywhere would be an archive button with no argument checking.

export interface SupersedeInvoice {
  id: string;
  status?: string | null;
  direction?: string | null;
  invoice_number?: string | null;
  amount_paid?: number | null;
  accountant_status?: string | null;
}

export type SupersedeRefusal =
  | "same_invoice"
  | "not_incoming"
  | "already_archived"
  | "money_settled"
  | "verwerkt"
  | "not_supersedable";

/** Dutch, owner-facing, one sentence per refusal — the server saying no in words the owner reads. */
export const SUPERSEDE_REFUSAL_TEXT: Record<SupersedeRefusal, string> = {
  same_invoice: "Een factuur kan zichzelf niet vervangen.",
  not_incoming: "Alleen een inkoopfactuur kan op deze manier vervangen worden.",
  already_archived: "Die factuur staat al bij Genegeerd — er valt niets te vervangen.",
  money_settled:
    "Op de oude factuur is al betaald. Draai die betaling eerst terug, dan kun je hem vervangen — anders zou geld uit je kas- en bankoverzicht verdwijnen terwijl het echt is verplaatst.",
  verwerkt:
    "Je boekhouder heeft de oude factuur al verwerkt — vraag hem de verwerking eerst ongedaan te maken.",
  not_supersedable: "Deze factuur kan niet op deze manier vervangen worden.",
};

const CENT = 0.005;

/** Has any money been settled against this invoice? Status OR a running deelbetaling. */
function hasSettledMoney(inv: SupersedeInvoice): boolean {
  if ((inv.status ?? "") === "paid") return true;
  return Math.max(0, Number(inv.amount_paid ?? 0)) > CENT;
}

/**
 * May `replacement` supersede `old`? Returns null when it may, or the machine-readable reason to
 * refuse. Both sides are checked: the replacement must itself be a purchase invoice the owner is
 * still working on, or "vervangen" would be a way to archive an arbitrary invoice from a screen
 * that never showed it.
 */
export function refuseSupersede(
  old: SupersedeInvoice,
  replacement: SupersedeInvoice,
): SupersedeRefusal | null {
  if (old.id === replacement.id) return "same_invoice";
  if ((old.direction ?? "") !== "incoming" || (replacement.direction ?? "") !== "incoming") {
    return "not_incoming";
  }
  if ((old.status ?? "") === "archived") return "already_archived";
  // The accountant's lock comes BEFORE the money check on purpose: when both are true, the way
  // out runs through the accountant, and naming the payment first would send the owner down a
  // road that ends in the same wall.
  if (old.accountant_status === "verwerkt") return "verwerkt";
  if (hasSettledMoney(old)) return "money_settled";
  // The replacement must still be a live purchase invoice. An archived or already-paid row asking
  // to replace something is not a correction the owner is looking at — it is a stale client.
  if (!new Set(["processing", "received"]).has(replacement.status ?? "")) return "not_supersedable";
  // Only an invoice that is still IN the books can be taken out of them.
  return new Set(["processing", "received"]).has(old.status ?? "") ? null : "not_supersedable";
}

// [VERVANG] Er stond hier een supersedeConfirmBody(): dezelfde bevestigingstekst, in het
// Nederlands, met dezelfde inhoud als 'ink.vervang.uitlegMetNr' in messages.ts. Die laatste is wat
// er DAADWERKELIJK op het scherm komt, en hij bestaat in drie talen. Twee versies van één
// waarschuwing is één versie die niemand ziet — en juist deze zou de indruk wekken de bron te
// zijn, want hij staat naast de regel. Weg dus; de zin woont waar hij gerenderd wordt.

