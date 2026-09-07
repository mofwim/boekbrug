// src/lib/bank-storno.ts
// [STORNO] A reversed incasso names the payment it undoes. Pure, no I/O.
// Run: npx tsx --test src/lib/bank-storno.test.ts
//
// The storno detector (direct-debit.ts) has read "money IN with a direct-debit marker" for a while,
// and nothing on /bank used it: the credit sat in "Geen factuur", the original debit stayed
// matched, and the invoice it had paid stayed 'paid' — the one state a storno exists to deny. The
// owner's only offered action was attach-invoice, which would have minted a sale.
//
// The pairing is strict, because the action it unlocks un-pays an invoice:
//   · the same amount to the cent, opposite sign;
//   · the same party — the same account, or a strong name identity when the bank gave no account;
//   · the origin dated on or before the storno, at most STORNO_WINDOW_DAYS earlier;
//   · the origin is a matched line that paid an invoice;
//   · exactly ONE such origin. Two candidates is a question for the owner, never a guess.

import { normalizeIban, isStrongNameIdentity } from "./bank-matching";
import { readDirectDebit } from "./direct-debit";

export const STORNO_WINDOW_DAYS = 45;

export interface StornoLine {
  id: string;
  amount: number | null;
  date: string | null;
  counterpartIban?: string | null;
  counterpartName?: string | null;
  description?: string | null;
  reference?: string | null;
  typeCode?: string | null;
  mandateId?: string | null;
  creditorId?: string | null;
}

export interface OriginLine {
  id: string;
  amount: number | null;
  date: string | null;
  counterpartIban?: string | null;
  counterpartName?: string | null;
  status?: string | null;
  invoiceId?: string | null;
}

/** Money IN that the bank marks as a direct-debit event: the reversal of a collection. */
export function isStornoLine(line: StornoLine): boolean {
  if (!(Number(line.amount) > 0)) return false;
  const read = readDirectDebit({
    typeCode: line.typeCode, mandateId: line.mandateId, creditorId: line.creditorId,
    text: `${line.description ?? ""} ${line.reference ?? ""}`, amount: line.amount,
  });
  return read.reversal && read.signal !== null;
}

function daysBetween(a: string, b: string): number | null {
  const ta = Date.parse(a.slice(0, 10)), tb = Date.parse(b.slice(0, 10));
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86_400_000);
}

function sameParty(a: { counterpartIban?: string | null; counterpartName?: string | null }, b: { counterpartIban?: string | null; counterpartName?: string | null }): boolean {
  const ia = normalizeIban(a.counterpartIban), ib = normalizeIban(b.counterpartIban);
  if (ia && ib) return ia === ib;
  return isStrongNameIdentity(a.counterpartName ?? null, b.counterpartName ?? null);
}

/** The one matched debit this storno reverses, or null when there is none or more than one. */
export function findStornoOrigin(storno: StornoLine, candidates: readonly OriginLine[]): OriginLine | null {
  if (!isStornoLine(storno) || !storno.date) return null;
  const cents = Math.round(Number(storno.amount) * 100);
  const hits = candidates.filter((c) => {
    if (c.status !== "matched" || !c.invoiceId || !c.date) return false;
    if (Math.round(Number(c.amount) * 100) !== -cents) return false;
    const gap = daysBetween(c.date, storno.date as string);
    if (gap === null || gap < 0 || gap > STORNO_WINDOW_DAYS) return false;
    return sameParty(storno, c);
  });
  return hits.length === 1 ? hits[0] : null;
}
