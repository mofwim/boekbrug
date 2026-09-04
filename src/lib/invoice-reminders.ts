// src/lib/invoice-reminders.ts
// [REMINDERS] Pure decision engine for automatic payment reminders — July 2026.
//
// This module answers ONE question, with NO I/O: given an outgoing invoice, the
// owner's schedule, what has already been sent, and today's date — which reminder
// tier (if any) should be e-mailed RIGHT NOW? The cron (/api/cron/reminders) does
// the DB reads/writes and the send; all the judgement lives here so it is unit-
// testable without a database, a clock, or a mail server.
//
// Design decisions baked in (each guards trust/correctness):
//   · "Highest reached tier" rule — we send the LARGEST offset that is due and
//     unsent, and treat smaller unsent tiers as superseded. So an invoice first
//     seen at day 35 with schedule {14,30} gets ONE tier-30 reminder, never a
//     retroactive tier-14 followed by tier-30 the next day (that reads as spam).
//   · Idempotency is enforced twice: here (skip a tier already in sentOffsets)
//     AND in the DB (UNIQUE(invoice_id, day_offset)) as the race backstop.
//   · Every eligibility guard (paid, credit note, wrong type/direction, paused,
//     no e-mail) returns null so a single call is the complete "should we?" gate.
//   · Day math is whole-calendar-day and timezone-proof (UTC-noon anchor), the
//     same method as VandaagClient — no `new Date('YYYY-MM-DD')` UTC-midnight
//     drift. Today is passed IN (as a day-number) so the function stays pure.

import { round2 } from './invoice-totals'

/** One cent of slack — OCR/xlsx totals can sit a rounding tick under the payment. */
const PAID_EPS = 0.01;

/**
 * Convert an ISO date prefix ("YYYY-MM-DD…") to a whole-day count via UTC noon.
 * UTC noon is safe: no DST/offset can push a date-only value across midnight.
 * Returns null on an unparseable value (caller treats it as "no due date").
 */
export function dayNumberFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Math.floor(utc / 86_400_000);
}

/**
 * Today as a whole-day number in Europe/Amsterdam (the app's fixed business
 * timezone, matching VandaagClient). Impure by design — the cron calls this once
 * per run and passes the result into the pure decision function below.
 */
export function amsterdamTodayDayNumber(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // "YYYY-MM-DD"
  return dayNumberFromIso(parts) as number;
}

export interface ReminderDecisionInput {
  /** Invoice due date (ISO). Null/invalid → never remind (nothing to anchor to). */
  dueDate: string | null | undefined;
  /** Today as a day-number (from amsterdamTodayDayNumber) — passed in for purity. */
  todayDayNumber: number;
  /** Owner's cadence, days after due (e.g. [14, 30]). Unordered/dirty input is tolerated. */
  offsets: number[];
  /** day_offsets already sent for this invoice (from invoice_reminders). */
  sentOffsets: number[];
  /** Invoice status — only 'sent'/'overdue' are remindable; 'paid'/'draft'/… never. */
  status: string | null | undefined;
  /** Must be 'factuur' — no reminders for creditnota/pro_forma/offerte. */
  invoiceType?: string | null;
  /** Must be 'outgoing' — we only chase money owed TO the owner. */
  direction?: string | null;
  /** Signed stored total; must be > 0 (a credit/zero invoice is never "owed to you"). */
  totalIncBtw?: number | null;
  /** Running settled magnitude; if it covers the total, treat as paid. */
  amountPaid?: number | null;
  /** Client recipient — no e-mail address, nothing to send to. */
  clientEmail?: string | null;
  /** Per-invoice opt-out. */
  remindersPaused?: boolean | null;
  /**
   * [HERINNER-AAN] Day-number van het moment waarop deze eigenaar herinneringen aanzette
   * (profiles.reminders_enabled_at). Een factuur die VOOR dat moment verviel wordt nooit
   * aangemaand.
   *
   * ── WAAROM DIT ER IS ──
   * Deze functie geeft de HOOGST bereikte trap terug, en dat is juist: wie een factuur van 40
   * dagen oud voor het eerst bekijkt hoort niet eerst trap 14 te sturen. Maar het betekent ook dat
   * een stapel oude facturen in één ronde de zwaarste brief oplevert — de ingebrekestelling met
   * incassokosten.
   *
   * Zolang herinneringen standaard UIT stonden was dat de keuze van iemand die zijn eigen
   * openstaande posten kende. Sinds ze standaard AAN staan is het dat niet meer: wie zijn
   * administratie meeneemt uit een ander pakket importeert facturen van maanden geleden, en de
   * eerste cron-ronde na registratie zou die klanten aanmanen voor schulden die misschien allang
   * buiten dit pakket om zijn voldaan. Een brief die de app nooit had mogen sturen kan niet worden
   * teruggehaald — dezelfde reden waarom invoice_schedules.sql weigert een factuur zelf te
   * versturen.
   *
   * Optioneel: undefined = geen rem (het gedrag van vóór deze regel), zodat bestaande aanroepers
   * en tests onveranderd blijven en de migratie de rijen mag vullen in zijn eigen tempo.
   */
  remindersActiveSinceDay?: number | null;
  /**
   * [CREDITNOTA-NO-CHASE] A creditnota was issued against this invoice — the owner cancelled
   * the demand. The invoice deliberately keeps its status and amounts (the +omzet must stay to
   * be netted by the creditnota's −omzet), so nothing in the status or the money tells us it is
   * no longer owed. Without this flag the cron keeps e-mailing the customer "please pay" for an
   * invoice that was withdrawn — a wrong demand sent to a third party, automatically.
   */
  hasCreditnota?: boolean | null;
}

/**
 * The single reminder tier (day_offset) to send now, or null if none is due.
 * Pure: no I/O, no clock (today is an input). Safe to call on every candidate.
 */
export function reminderTierDue(input: ReminderDecisionInput): number | null {
  const {
    dueDate,
    todayDayNumber,
    offsets,
    sentOffsets,
    status,
    invoiceType,
    direction,
    totalIncBtw,
    amountPaid,
    clientEmail,
    remindersPaused,
    remindersActiveSinceDay,
    hasCreditnota,
  } = input;

  // ── Eligibility guards (any failure → no reminder) ──────────────────
  if (remindersPaused) return null;
  // [CREDITNOTA-NO-CHASE] Withdrawn with a creditnota → never chase it again. Checked up here
  // with the other opt-outs: a credited invoice can still be 'sent', still have a positive
  // total and still be past due, so every guard below would happily let the mail go out.
  if (hasCreditnota) return null;
  if (direction != null && direction !== "outgoing") return null;
  if (invoiceType != null && invoiceType !== "factuur") return null;
  // Remindable states only. A 'paid' (or draft/processing/…) invoice is out.
  if (status !== "sent" && status !== "overdue") return null;
  if (!clientEmail || !clientEmail.trim()) return null;

  // Money guard: a credit note or zero invoice owes nothing; a fully-covered
  // invoice (amount_paid ≥ total, even if status hasn't flipped yet) is settled.
  const total = typeof totalIncBtw === "number" ? totalIncBtw : NaN;
  if (!Number.isFinite(total) || total <= 0) return null;
  const paid = typeof amountPaid === "number" && amountPaid > 0 ? amountPaid : 0;
  if (paid >= total - PAID_EPS) return null;

  // ── Timing ──────────────────────────────────────────────────────────
  const dueDay = dayNumberFromIso(dueDate);
  if (dueDay == null) return null;
  const daysOverdue = todayDayNumber - dueDay;
  if (daysOverdue <= 0) return null; // not yet overdue (or due today)

  // [HERINNER-AAN] De stapel van vóór het aanzetten blijft van de ondernemer. Zie het veld voor
  // waarom: zonder deze regel stuurt de eerste ronde van een nieuw account de zwaarste trap naar
  // iedereen in een geïmporteerde administratie.
  //
  // Op de VERVALDATUM en niet op de factuurdatum: het gaat om het moment waarop er aangemaand kon
  // worden. Een factuur die gisteren verviel terwijl de schakelaar vorige week aanging hoort
  // gewoon gejaagd te worden; een factuur die in maart verviel niet.
  if (
    typeof remindersActiveSinceDay === "number" &&
    Number.isFinite(remindersActiveSinceDay) &&
    dueDay < remindersActiveSinceDay
  ) {
    return null;
  }

  // Normalise the schedule: positive integers, unique, ascending.
  const schedule = [...new Set(offsets)]
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  if (schedule.length === 0) return null;

  // "Highest reached tier" — the largest offset that is due by now.
  let currentTier: number | null = null;
  for (const off of schedule) {
    if (off <= daysOverdue) currentTier = off;
    else break;
  }
  if (currentTier == null) return null; // overdue, but no tier reached yet

  // Idempotency (first line of defence; DB UNIQUE is the race backstop).
  const sent = new Set(sentOffsets);
  if (sent.has(currentTier)) return null;

  return currentTier;
}

/**
 * The amount still owed on an invoice — the ONLY figure a reminder may show.
 *
 * A reminder is a financial statement to a third party: showing the FULL total
 * on an invoice that is half-paid is a wrong number (the client already paid
 * part), and "a wrong number breaks trust" is a locked app principle. So the
 * reminder always shows openstaand = |total| − amount_paid, never the total.
 *
 * Pure + defensive: magnitude only (handles a stray creditnota sign), never
 * negative (an over-linked payment clamps to 0), rounded to cents so float
 * noise from OCR/xlsx totals can't leak a €599,9999 into the e-mail.
 */
export function openstaandOf(
  total: number | null | undefined,
  amountPaid: number | null | undefined,
): number {
  const t = typeof total === "number" && Number.isFinite(total) ? Math.abs(total) : 0;
  const p = typeof amountPaid === "number" && Number.isFinite(amountPaid) && amountPaid > 0 ? amountPaid : 0;
  const remaining = t - p;
  if (remaining <= 0) return 0;
  return round2(remaining);
}
