// src/lib/sales-overview.ts
// [ACTING-FOR] The sales member's work board: what is outstanding, and may I act on it?
// Run: npx tsx --test src/lib/sales-overview.test.ts
//
// WHY THIS IS ITS OWN MODULE
//
// Someone who makes invoices does not make them to make them — they make them to get paid. A
// screen that only says "here are your invoices" leaves half the job undone: which one is still
// outstanding, which one is late, and how much money is that together.
//
// Everything here is pure. The clock arrives as a parameter (`nowMs`), so the test is exact and
// no `new Date()` ever lands in a render (react-hooks/purity).
//
// WHAT IS DELIBERATELY NOT HERE
// No bank data, no profit, no costs. The sales member sees, for every invoice THEY made, whether
// it has been paid — not how the company is doing. 'paid' comes from invoices.status, which the
// owner or the bank reconciliation sets; the member reads it, never writes it.
//
// NOTE ON LANGUAGE: identifiers and comments are English (see AGENTS.md). The state VALUES and
// the `reason` sentences stay Dutch — they are rendered on a Dutch screen.

import { round2 } from './invoice-totals'
// [DEEL-CREDIT] "What is still owed after a credit" has ONE definition in this app, and it is not
// this file's. See outstandingAmount below for why the second spelling had to go.
import { openAfterCredit } from './credited-invoices'

export type InvoiceState = "concept" | "open" | "te-laat" | "betaald" | "vervallen";

export interface SalesInvoice {
  id: string;
  invoice_number: string | null;
  client_name: string | null;
  client_email: string | null;
  invoice_date: string | null;
  due_date: string | null;
  total_inc_btw: number | null;
  amount_paid: number | null;
  status: string | null;
  /**
   * [CREDITNOTA-NO-CHASE] 'factuur' | 'creditnota' | 'pro_forma'. Absent reads as 'factuur', so a
   * caller that does not select the column keeps the behaviour it always had.
   */
  invoice_type?: string | null;
  /** ISO time of the last reminder sent, or null. */
  last_reminder_at?: string | null;
  /** How many reminders already went out — the cron tiers included. */
  reminder_count?: number;
}

/**
 * Which state is this invoice in, in the words the sales member uses?
 *
 * 'vervallen' is the catch-all for a cancelled/archived invoice. It deliberately does NOT count
 * as 'open': including it in "what still has to come in" produces a number that is wrong.
 */
export function stateOf(f: SalesInvoice, nowMs: number): InvoiceState {
  const s = (f.status ?? "").toLowerCase();
  if (s === "draft") return "concept";
  if (s === "paid") return "betaald";
  if (s === "archived" || s === "cancelled" || s === "credited") return "vervallen";
  // 'sent' and 'overdue' both mean "sent, not yet paid". Whether it is LATE is decided by the due
  // date — not by the status, which is only updated by a cron and therefore lags behind.
  const due = f.due_date ? Date.parse(`${f.due_date}T23:59:59.999Z`) : NaN;
  if (Number.isFinite(due) && nowMs > due) return "te-laat";
  return "open";
}

/**
 * What still has to come in. Never negative, and never more than the total.
 *
 * ── [DEEL-CREDIT] WHY THE CREDITED AMOUNT IS A PARAMETER ──
 *
 * This used to be `|total| − amount_paid`, and it was the app's SECOND answer to a question that
 * already had one. Credit € 50 of a € 500 invoice and the two answers part company:
 *
 *     the reminder e-mail  (openAfterCredit)   asks the customer for   € 450
 *     this screen          (outstandingAmount) tells the owner         € 500
 *
 * Same invoice, same second. The customer holds a creditnota saying € 50 is theirs; the owner's
 * own "openstaand", and the accountant's debiteurenlijst, both still say € 500. The accountant
 * chases the difference by telephone, on money the owner gave back in writing.
 *
 * The creditnota cannot net it out from the other side either, because every list that shows this
 * number has already dropped it: `isOpenReceivable` refuses a creditnota by design, since leaving
 * it in inflates the COUNT and the overdue count even when the euros happen to cancel. So the
 * credit is subtracted here or it is subtracted nowhere.
 *
 * The bank line solves the same problem the other way and is deliberately NOT changed: there an
 * invoice and its creditnota are two open items that a payment settles TOGETHER (findSupplierSumMatch,
 * reconcileBatch's [BATCH-SIGN]), so the credit nets by PAIRING. Subtracting it from the invoice
 * there as well would count it twice — € 500 − € 50 paired against a further − € 50 is € 400 for a
 * € 450 payment. Two models, each correct where it lives; this comment exists so the next reader
 * does not "harmonise" them.
 *
 * Defaults to 0, so a caller that has no creditnota rows to hand gets exactly the number it got
 * before — a screen without the information must not start guessing at it.
 */
export function outstandingAmount(f: SalesInvoice, creditedIncBtw = 0): number {
  return openAfterCredit(f.total_inc_btw, f.amount_paid, creditedIncBtw);
}

/**
 * [DEEL-CREDIT] How much has been credited against each invoice id, as a positive amount.
 * Built by `creditedTotalsFrom`; an absent id means nothing was credited.
 */
export type CreditedByInvoice = ReadonlyMap<string, number>;

/** What has been credited against this invoice, or 0 when the caller supplied no map. */
function creditedFor(f: SalesInvoice, credited?: CreditedByInvoice): number {
  return credited?.get(f.id) ?? 0;
}

export interface SalesTotals {
  drafts: number;
  open: number;
  overdue: number;
  paid: number;
  /** Sum of everything that still has to come in — open AND overdue. */
  outstanding: number;
  /** Only the overdue part. This is the number someone can act on today. */
  overdueAmount: number;
}

/**
 * The four counts and the two euro totals of a list of invoices.
 *
 * ── [CREDITNOTA-NO-CHASE] A creditnota is not a small debt ──
 *
 * It is written with status 'sent', a due date of today and a NEGATIVE total — and
 * outstandingAmount takes the absolute value of that. So without the skip below a € 50 creditnota
 * did not reduce the € 500 it corrects, it ADDED to it:
 *
 *     openstaand  € 550     te laat  € 550     te-laat count  2
 *
 * for a customer who owes € 450 and is one invoice late. Wrong in both directions at once, and by
 * twice the credit — the one number this screen exists to show, and the count beside it.
 *
 * The rule was written for exactly this and lives four other places (invoice-reminders.ts twice,
 * canRemind below, buildDebtorBoard). It reached every surface that judges ONE invoice and none
 * that adds them up, which is why it took a partial credit to make it visible: while a creditnota
 * could only ever be a whole invoice, the original was 'credited' and fell out on status anyway.
 *
 * `credited` is what has been credited against each remaining invoice — see outstandingAmount.
 */
export function summarise(
  invoices: readonly SalesInvoice[],
  nowMs: number,
  credited?: CreditedByInvoice,
): SalesTotals {
  const t: SalesTotals = { drafts: 0, open: 0, overdue: 0, paid: 0, outstanding: 0, overdueAmount: 0 };
  for (const f of invoices) {
    // [CREDITNOTA-NO-CHASE] The opposite of a receivable, so it belongs in no count and no total.
    if ((f.invoice_type ?? "factuur") !== "factuur") continue;
    const state = stateOf(f, nowMs);
    const rest = outstandingAmount(f, creditedFor(f, credited));
    if (state === "concept") t.drafts++;
    else if (state === "betaald") t.paid++;
    else if (state === "open") { t.open++; t.outstanding += rest; }
    else if (state === "te-laat") { t.overdue++; t.outstanding += rest; t.overdueAmount += rest; }
    // 'vervallen' counts towards nothing — see stateOf.
  }
  // Round AFTER summing: rounding per item and then adding gives a different number than the sum
  // of the real amounts, and that difference is exactly what someone will call about.
  t.outstanding = round2(t.outstanding);
  t.overdueAmount = round2(t.overdueAmount);
  return t;
}

// ── May a reminder go out? ────────────────────────────────────────────────────────────────────

/** Sending more than this by hand is no longer reminding. */
export const MAX_MANUAL_REMINDERS = 3;
/** This much must sit between two reminders — including between a cron mail and a manual one. */
export const REMINDER_COOLDOWN_DAYS = 3;

export type ReminderVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * May this invoice get a reminder right now?
 *
 * WHY THIS IS SO STRICT
 * On the other side of this button sits a CUSTOMER of the entrepreneur, not a user of ours. One
 * reminder too many costs that entrepreneur a relationship, and that is damage they did not
 * cause themselves and cannot undo. So this fails to "no, and here is why" — with a sentence the
 * sales member can read, rather than a button that does nothing.
 */
export function canRemind(f: SalesInvoice, nowMs: number, creditedIncBtw = 0): ReminderVerdict {
  // [CREDITNOTA-NO-CHASE] Eerst, en vóór alle andere regels: een creditnota is geen vordering maar
  // het tegendeel ervan. Hij wordt geschreven met status 'sent', een vervaldatum van vandaag en een
  // NEGATIEF totaal — en outstandingAmount() neemt daar de absolute waarde van. Zonder deze regel
  // ziet elke lijst hem dus als een te late factuur van datzelfde bedrag, met een levende
  // herinnerknop eronder. Wie daarop drukt, maant de klant van de ondernemer aan om geld te betalen
  // dat hij juist terugkrijgt.
  //
  // De nachtelijke cron weigert dit al twee keer (invoice-reminders.ts: hasCreditnota, en
  // invoiceType !== 'factuur'). Die twee weigeringen zaten in de cron en niet in deze module, dus
  // elke knop die later langs canRemind ging, erfde ze niet. Nu staat de regel waar hij hoort.
  if ((f.invoice_type ?? "factuur") !== "factuur") {
    return { allowed: false, reason: "Een creditnota is geen openstaande vordering." };
  }
  const state = stateOf(f, nowMs);
  if (state === "concept") return { allowed: false, reason: "Deze factuur is nog niet verstuurd." };
  if (state === "betaald") return { allowed: false, reason: "Deze factuur is betaald." };
  if (state === "vervallen") return { allowed: false, reason: "Deze factuur telt niet meer mee." };
  // [DEEL-CREDIT] …or fully CREDITED, which the caller supplies as `creditedIncBtw`. An invoice
  // whose credits cover it is settled just as finally as one that was paid, and the sentence below
  // is true of both: there is nothing left to claim.
  if (outstandingAmount(f, creditedIncBtw) <= 0) {
    // Fully paid while the status has not been updated yet. Sending a reminder about money that
    // already arrived is the most painful mail this product can send.
    return { allowed: false, reason: "Er staat niets meer open op deze factuur." };
  }
  if (!f.client_email) return { allowed: false, reason: "Deze klant heeft geen e-mailadres." };
  if (state !== "te-laat") {
    return { allowed: false, reason: "De vervaldatum is nog niet voorbij — herinneren kan vanaf dan." };
  }
  if ((f.reminder_count ?? 0) >= MAX_MANUAL_REMINDERS) {
    return {
      allowed: false,
      // [DEBITEUREN] Deliberately role-neutral. This sentence used to say "vraag je werkgever",
      // which was already wrong for the owner reading it on their own screen, and became wrong a
      // second way once an accountant could reach this button. What comes after three reminders —
      // a WIK-aanmaning, an incassobureau, writing it off — is a decision with legal consequences
      // (art. 6:96 BW), and it belongs to the entrepreneur no matter who is looking at the screen.
      reason: `Er zijn al ${MAX_MANUAL_REMINDERS} herinneringen verstuurd. Wat hierna komt — een aanmaning of incasso — is een beslissing van de ondernemer, geen knop.`,
    };
  }
  if (f.last_reminder_at) {
    const ms = Date.parse(f.last_reminder_at);
    if (Number.isFinite(ms)) {
      const days = (nowMs - ms) / 86_400_000;
      if (days < REMINDER_COOLDOWN_DAYS) {
        const left = Math.max(1, Math.ceil(REMINDER_COOLDOWN_DAYS - days));
        return { allowed: false, reason: `Er ging net een herinnering uit. Wacht nog ${left} dag${left === 1 ? "" : "en"}.` };
      }
    } else {
      // Unreadable date: then we do not know when the previous one went out, and standing still
      // is the safe answer. Better a day late than a customer reminded twice in one day.
      return { allowed: false, reason: "De vorige herinnering is niet te dateren — probeer het morgen." };
    }
  }
  return { allowed: true };
}

/**
 * The next `day_offset` for a MANUAL reminder.
 *
 * The cron uses positive tiers (14, 30) and invoice_reminders has UNIQUE(invoice_id,
 * day_offset). Manual sends therefore get NEGATIVE numbers: -1, -2, -3. That way they never
 * collide with a cron tier, every send stays its own row in the trail, and the unique index keeps
 * doing what it exists for.
 */
export function nextManualOffset(alreadyUsed: readonly number[]): number {
  const manual = alreadyUsed.filter((n) => n < 0);
  return manual.length === 0 ? -1 : Math.min(...manual) - 1;
}
