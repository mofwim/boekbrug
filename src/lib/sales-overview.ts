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

/** What still has to come in. Never negative, and never more than the total. */
export function outstandingAmount(f: SalesInvoice): number {
  const total = typeof f.total_inc_btw === "number" && Number.isFinite(f.total_inc_btw)
    ? Math.abs(f.total_inc_btw)
    : 0;
  const paid = typeof f.amount_paid === "number" && Number.isFinite(f.amount_paid) && f.amount_paid > 0
    ? f.amount_paid
    : 0;
  const rest = total - paid;
  return rest <= 0 ? 0 : Math.round(rest * 100) / 100;
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

export function summarise(invoices: readonly SalesInvoice[], nowMs: number): SalesTotals {
  const t: SalesTotals = { drafts: 0, open: 0, overdue: 0, paid: 0, outstanding: 0, overdueAmount: 0 };
  for (const f of invoices) {
    const state = stateOf(f, nowMs);
    const rest = outstandingAmount(f);
    if (state === "concept") t.drafts++;
    else if (state === "betaald") t.paid++;
    else if (state === "open") { t.open++; t.outstanding += rest; }
    else if (state === "te-laat") { t.overdue++; t.outstanding += rest; t.overdueAmount += rest; }
    // 'vervallen' counts towards nothing — see stateOf.
  }
  // Round AFTER summing: rounding per item and then adding gives a different number than the sum
  // of the real amounts, and that difference is exactly what someone will call about.
  t.outstanding = Math.round(t.outstanding * 100) / 100;
  t.overdueAmount = Math.round(t.overdueAmount * 100) / 100;
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
export function canRemind(f: SalesInvoice, nowMs: number): ReminderVerdict {
  const state = stateOf(f, nowMs);
  if (state === "concept") return { allowed: false, reason: "Deze factuur is nog niet verstuurd." };
  if (state === "betaald") return { allowed: false, reason: "Deze factuur is betaald." };
  if (state === "vervallen") return { allowed: false, reason: "Deze factuur telt niet meer mee." };
  if (outstandingAmount(f) <= 0) {
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
      reason: `Er zijn al ${MAX_MANUAL_REMINDERS} herinneringen verstuurd. Vraag je werkgever wat er verder moet gebeuren.`,
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
