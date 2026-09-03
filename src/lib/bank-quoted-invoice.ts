// src/lib/bank-quoted-invoice.ts
// [AL-GEBOEKT] The invoice a payment NAMES, whatever its status. Pure, no I/O.
// Run: npx tsx --test src/lib/bank-quoted-invoice.test.ts
//
// ── THE BUG THIS EXISTS FOR ──
//
// Reported from /bank with a screenshot. A payment of € 797,86 to HVO Meat, whose description
// reads `USTD//2919045/`, was offered three invoices of € 2.449,64, € 2.822,27 and € 3.008,71 —
// under the sentence "Meerdere facturen passen bij deze betaling". A payment of € 803,26 to
// GROOTHANDEL M.H. BAL was offered seven, four of them from BALKIP B.V.
//
// Checked against production, every one of those payments names an invoice that EXISTS, at the
// exact cent, from the exact supplier:
//
//   2919045     € 797,86    HVO Meat                  ← the € 797,86 payment
//   2034382     € 1.056,87  CAN Vleesgroothandel      ← the € 1.056,87 payment
//   263591      € 803,26    GROOTHANDEL M.H. BAL      ← the € 803,26 payment
//   FAC-2601629 € 811,40    NAR FOOD                  ← the € 811,40 payment
//
// All four already `paid`. isEligible refuses a settled invoice — correctly, or a bill would be
// paid twice — so the true match is dropped and the scorer goes on to the supplier's OTHER
// invoices, which clear the listing floor on "same counterparty, nearby date". The card then
// presents them as matches.
//
// That is not a cosmetic misfire. Confirming one books this payment against a DIFFERENT, genuinely
// open invoice: a bill marked paid that nobody paid, and the real payment still unexplained.
// 36 of 333 pending debits were in this state, 29 of them exact to the cent.
//
// ── WHY THE EXISTING MACHINERY MISSED IT ──
//
// Two mechanisms already answer "why did this line not book": the paid-explain pass
// ([BANK-PAID-EXPLAINED]) and judgeBankWait ([WAAROM-WACHT-BANK]). Both are gated on
// `outcome === "none"`, on one assumption written into the route: *bij een kandidatenlijst is die
// lijst het antwoord*. That holds right up until the list is wrong, which is exactly this case.
//
// judgeBankWait could not have caught it either way: it is handed the OPEN invoices only, so
// "already settled" and "never entered" look identical from inside it. Its own header admits the
// blind spot — "a supplier whose every invoice happens to be settled is not in the open pool" —
// and chose silence as the safe error. Silence was safe; what filled the silence was not.
//
// ── WHY A LOOKUP AND NOT ANOTHER SCORING PASS ──
//
// The scorer is O(n·m) and [CIRKEL-PERF] measured ~9s on 3000 transactions × 1500 paid invoices.
// It is also not needed: the payment already states the number, and only the SETTLED invoices have
// to be searched — a small slice. A number the supplier printed and the bank carried back unchanged
// is a stronger claim than any similarity score.
//
// ── AND WHY IT REUSES referenceMatches INSTEAD OF PARSING ──
//
// The first version of this module built an index of invoice numbers and looked up whatever
// parseReferenceNumbers returned. Its tests failed on all four real lines, which is the whole
// reason they were written from production rows rather than from invented ones:
// parseReferenceNumbers splits on COMMAS — it exists for "1234,5678", a payment run settling
// several invoices at once — so `USTD//2919045/` came back as the single token `ustd2919045`,
// which matches no invoice. Extracting digit runs instead would have fixed those three and still
// missed `FAC-2601629`, whose number carries a letter prefix.
//
// referenceMatches already knows all of this, including the traps it documents: a structured
// RF-reference, a bare calendar year that must never count as identity, and a short numeric needle
// that may only match as a WHOLE token so invoice 2050 cannot match reference 26302050. Writing a
// second reader of the same field would mean maintaining those three rules in two places, and the
// copy that drifts is always the one nobody is looking at.

import { referenceMatches } from "./bank-matching";

/** One invoice, reduced to what naming it requires. */
export interface QuotedInvoiceRow {
  id: string;
  invoice_number: string | null;
  total_inc_btw: number | null;
  status: string | null;
  client_name: string | null;
  accountant_status?: string | null;
}

/**
 * Statuses in which an invoice can no longer be offered as a candidate.
 *
 * Deliberately NOT imported from bank-matching's EXCLUDED_STATUSES, and that is a decision rather
 * than duplication: that set also holds 'draft' and 'processing', which are not settled at all —
 * they are not ready. Telling an owner "this is already booked" about a draft would be false, and
 * a queued one already has its own answer ([CIRKEL] links straight to the verify step). Only these
 * two mean the money question is closed.
 */
const SETTLED_STATUSES = new Set(["paid", "archived"]);

/**
 * The invoices this question is even about: the settled ones.
 *
 * Narrowing here rather than in the caller keeps the rule in one place, and it is what makes the
 * scan cheap — an open invoice needs no rescue, because the matcher can simply offer it.
 */
export function settledOnly(rows: readonly QuotedInvoiceRow[]): QuotedInvoiceRow[] {
  return rows.filter((r) =>
    r.invoice_number && (SETTLED_STATUSES.has(r.status ?? "") || r.accountant_status === "verwerkt"));
}

/** What the payment names, and what became of it. */
export interface QuotedSettled {
  invoiceId: string;
  invoiceNumber: string;
  amount: number | null;
  clientName: string | null;
  /** The payment and the invoice agree to the cent — then this is almost certainly the same bill. */
  amountAgrees: boolean;
  /** 'verwerkt' locks a quarter; the sentence differs because so does the remedy. */
  lockedByAccountant: boolean;
}

/**
 * Does this line quote an invoice that exists and is already settled?
 *
 * Returns null in every other case — no quoted number, an unknown number, or a number that names
 * an invoice still open. An open one needs no rescue: the matcher can offer it normally.
 */
export function quotedSettledInvoice(
  line: { amount: number | null; reference: string | null; description?: string | null },
  settled: readonly QuotedInvoiceRow[],
): QuotedSettled | null {
  // Both fields, because banks put the reference in either — the four production lines carry it in
  // `description` (`USTD//2919045/`) while a SEPA batch fills `reference`. referenceMatches reads
  // the pair exactly as the matcher does.
  const tx = { reference: line.reference, description: line.description ?? "" };

  // Prefer an invoice whose amount also agrees: with two settled invoices whose numbers both occur
  // in one description, the one that matches the euro is the one this payment is about.
  let zwak: QuotedSettled | null = null;
  for (const hit of settled) {
    if (!referenceMatches(tx, hit.invoice_number)) continue;

    const total = typeof hit.total_inc_btw === "number" ? hit.total_inc_btw : null;
    const amountAgrees =
      total != null && line.amount != null && Math.abs(Math.abs(total) - Math.abs(line.amount)) < 0.01;

    const gevonden: QuotedSettled = {
      invoiceId: hit.id,
      invoiceNumber: hit.invoice_number ?? "",
      amount: total,
      clientName: hit.client_name,
      amountAgrees,
      lockedByAccountant: hit.accountant_status === "verwerkt" && !SETTLED_STATUSES.has(hit.status ?? ""),
    };
    if (amountAgrees) return gevonden;
    zwak ??= gevonden;
  }
  return zwak;
}
