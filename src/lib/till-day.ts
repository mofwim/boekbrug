// src/lib/till-day.ts
// [KASSA] The day of a shop that has no till — pure arithmetic, no I/O.
// Run: npx tsx src/lib/till-day.test.ts
//
// ── WHY THIS EXISTS ──
// daily_turnover was reachable through exactly one door: a Z-report file. Its `source` column has
// allowed 'manual' since the table was created, and no line of code has ever written it — every
// caller passes 'z_report' (intake, reprocess, the import route). So an owner without a till had
// no way to put a day's revenue into the BTW-authoritative table at all.
//
// That is not a missing convenience. A barber who takes PIN has his revenue arrive over the bank
// as a pos_income line, and bank_transactions carries NO btw_rate column — there is no screen
// anywhere that can give a bank revenue line a rate. financial-result then counts it as revenue
// with no rate (cashOmzetZonderBtw), and /api/btw/file BLOCKS the filing on exactly that signal
// ("er staat nog omzet zonder BTW-tarief"). His own aangifte is held shut by money he cannot
// classify, and his only escapes are a Z-report he does not have or acknowledging the warning and
// filing a 5a he knows is too low.
//
// A manual day fixes it at the source: the rate split he could not express anywhere else.
//
// ── THE RULE THAT GOVERNS EVERYTHING HERE: ONE DAY, ONE SOURCE ──
// A day's cash revenue can reach the books twice — as daily_turnover.cash_amount and as a
// cash_entries row with category 'omzet'. Both engines deliberately suppress the second when the
// first exists (financial-result.ts `covered`, kasboek.ts `isTillCountedOmzet`), because summing
// them once put a shop taking EUR 500 a day EUR 45.000 above reality inside one quarter.
//
// So this module NEVER produces both. A till sale is not a cash movement that also lands in the
// drawer ledger; it is one line of a day, and the day is written to daily_turnover alone. The
// drawer still balances, because buildKasboek counts daily_turnover.cash_amount as ontvangsten.
//
// ── WHY GROSS IN, NET DERIVED ──
// The Z-report path trusts the till's printed base/btw and never re-derives them (turnoverBtw says
// why: the till already rounded per line, and its documented figure is the one that belongs in the
// books). Here there IS no printed figure — the owner types what he charged, which for a consumer
// shop is always the gross price. So we derive, and we derive in ONE direction only: per rate, from
// the summed gross. Summing per-sale btw instead would accumulate a cent of drift per haircut and
// eventually trip checkTurnoverArithmetic on an honest day.

import { round2 } from "./invoice-totals";
import type { DailyTurnover } from "./turnover";

/** The BTW rates a Dutch shop can ring up. Same set the articles catalogue and /api/cash accept. */
export const TILL_RATES = [0, 9, 21] as const;
export type TillRate = (typeof TILL_RATES)[number];

/**
 * How the customer paid. These are DATABASE values, and they are English on purpose — they
 * aggregate one-to-one into daily_turnover's pin_amount / cash_amount / other_amount, so the
 * vocabulary matches the columns it feeds rather than the Dutch used for cash_entries.category.
 * 'pin' is the Dutch domain term for a card payment and stays as it is.
 */
export const TILL_METHODS = ["pin", "cash", "other"] as const;
export type TillMethod = (typeof TILL_METHODS)[number];

/** One rung-up sale. `unit_price_incl` is what the customer PAYS — gross, including btw. */
export interface TillSale {
  description: string;
  quantity: number;
  unit_price_incl: number;
  btw_rate: number;
  method: TillMethod;
}

/** The gross a sale is worth, rounded to the cent — the figure the customer actually paid. */
export function saleGross(sale: Pick<TillSale, "quantity" | "unit_price_incl">): number {
  return round2((sale.quantity ?? 0) * (sale.unit_price_incl ?? 0));
}

/**
 * The gross unit price of a catalogue article. articles.unit_price is stored EX-btw (it feeds
 * invoice lines, which are net), while a shop's price list is what the customer pays. One
 * conversion, in one place, so a EUR 25 haircut is never rung up as EUR 25 net + btw.
 */
export function articleGrossPrice(unitPriceExcl: number, btwRate: number): number {
  return round2((unitPriceExcl ?? 0) * (1 + (btwRate ?? 0) / 100));
}

/** Gross totals of a day, per rate and per payment method. */
export interface DayGross {
  gross_0: number;
  gross_9: number;
  gross_21: number;
  pin: number;
  cash: number;
  other: number;
}

export const EMPTY_DAY_GROSS: DayGross = {
  gross_0: 0, gross_9: 0, gross_21: 0, pin: 0, cash: 0, other: 0,
};

/**
 * Is this a rate a Dutch shop can ring up?
 *
 * The empty cases are refused EXPLICITLY, and that is the whole point of the function. `Number(null)`
 * and `Number("")` are both 0 — and 0 is a perfectly valid rate here — so a plain
 * `TILL_RATES.includes(Number(x))` answers "yes, 0%" to a rate that was never given. That is the one
 * failure direction this module must not have: a sale whose rate went missing would be booked as
 * exempt turnover, and 21% btw the owner owes would simply never reach rubriek 1a. A missing rate has
 * to be refused at the door, not defaulted.
 */
export function isTillRate(rate: unknown): rate is TillRate {
  if (typeof rate !== "number" && typeof rate !== "string") return false;
  if (typeof rate === "string" && rate.trim() === "") return false;
  const n = Number(rate);
  return Number.isFinite(n) && TILL_RATES.includes(n as TillRate);
}

/** Is this one of the three payment methods? */
export function isTillMethod(method: unknown): method is TillMethod {
  return typeof method === "string" && (TILL_METHODS as readonly string[]).includes(method);
}

/**
 * Sum a day's sales into gross-per-rate and gross-per-method. Both splits describe the SAME money
 * from two angles, so they always add up to the same total — which is what makes the day's internal
 * identity (pin+contant+overig == totaal) exact rather than approximate.
 *
 * A sale at an unknown rate or method is not silently dropped and not silently bucketed: the caller
 * validates before it gets here (validateSale), and this function is total over what it accepts.
 */
export function sumSales(sales: readonly TillSale[]): DayGross {
  const out: DayGross = { ...EMPTY_DAY_GROSS };
  for (const s of sales) {
    const gross = saleGross(s);
    if (s.btw_rate === 21) out.gross_21 = round2(out.gross_21 + gross);
    else if (s.btw_rate === 9) out.gross_9 = round2(out.gross_9 + gross);
    else out.gross_0 = round2(out.gross_0 + gross);
    if (s.method === "pin") out.pin = round2(out.pin + gross);
    else if (s.method === "cash") out.cash = round2(out.cash + gross);
    else out.other = round2(out.other + gross);
  }
  return out;
}

/**
 * Turn gross-per-rate + a payment split into the DailyTurnover row the engines read.
 *
 * The derivation is deliberately arranged so base + btw == gross TO THE CENT for every rate:
 * base is rounded first, and btw is the REMAINDER rather than a second independent rounding. That
 * is what makes checkTurnoverArithmetic's total identity (omzet + btw == totaal) exact instead of
 * merely within tolerance — an honest day must never be refused by the gate that guards the write.
 */
export function buildTurnoverRow(date: string, g: DayGross): DailyTurnover {
  const base_0 = round2(g.gross_0);
  const base_9 = round2(g.gross_9 / 1.09);
  const btw_9 = round2(round2(g.gross_9) - base_9);
  const base_21 = round2(g.gross_21 / 1.21);
  const btw_21 = round2(round2(g.gross_21) - base_21);
  const total_incl = round2(round2(g.gross_0) + round2(g.gross_9) + round2(g.gross_21));
  return {
    turnover_date: date,
    base_0, base_9, base_21,
    btw_9, btw_21,
    total_incl,
    pin_amount: round2(g.pin),
    cash_amount: round2(g.cash),
    other_amount: round2(g.other),
  };
}

/** A day's sales → the row that represents them. The whole aggregate path in one call. */
export function salesToTurnoverRow(date: string, sales: readonly TillSale[]): DailyTurnover {
  return buildTurnoverRow(date, sumSales(sales));
}

// ── What may be written, and when ────────────────────────────────────────────

/** One ticket line as it arrives from the screen, before anything is trusted. */
export interface TicketLineInput {
  description?: unknown;
  quantity?: unknown;
  unit_price_incl?: unknown;
  btw_rate?: unknown;
  method?: unknown;
  article_id?: unknown;
}

export interface ValidatedLine extends TillSale {
  article_id: string | null;
}

export type TicketResult =
  | { ok: true; lines: ValidatedLine[] }
  /** Dutch — this reaches the owner. See the language rule in AGENTS.md. */
  | { ok: false; error: string };

/** The most lines one customer can be rung up for. A ticket longer than this is a runaway client. */
const MAX_TICKET_LINES = 100;
/** No single line may exceed this gross. A slipped decimal is far more likely than a EUR 100.000 haircut. */
const MAX_LINE_GROSS = 100_000;

/**
 * Validate a whole ticket. All-or-nothing on purpose: a half-accepted ticket leaves the owner with a
 * day total that does not match what he charged, and no way to see which line went missing. The same
 * contract the Z-report import uses for a file.
 */
export function validateTicket(raw: unknown): TicketResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Er staat niets op de bon." };
  }
  if (raw.length > MAX_TICKET_LINES) {
    return { ok: false, error: "Deze bon heeft te veel regels." };
  }
  const lines: ValidatedLine[] = [];
  for (const item of raw as TicketLineInput[]) {
    if (!item || typeof item !== "object") return { ok: false, error: "Ongeldige regel op de bon." };

    const description = typeof item.description === "string" ? item.description.trim() : "";
    if (!description) return { ok: false, error: "Elke regel heeft een omschrijving nodig." };

    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity === 0) {
      return { ok: false, error: `Controleer het aantal bij "${description}".` };
    }
    const unitPrice = Number(item.unit_price_incl);
    if (!Number.isFinite(unitPrice)) {
      return { ok: false, error: `Controleer de prijs bij "${description}".` };
    }
    // A negative PRICE is not how a refund is written here — a refund is a negative quantity of a
    // real price. Allowing both would let one ticket express the same correction two ways, and the
    // day's rate split would depend on which one the screen happened to send.
    if (unitPrice < 0) {
      return { ok: false, error: `Een prijs kan niet negatief zijn — gebruik een negatief aantal om "${description}" terug te boeken.` };
    }
    if (Math.abs(round2(quantity * unitPrice)) > MAX_LINE_GROSS) {
      return { ok: false, error: `Het bedrag bij "${description}" is te hoog — controleer de komma.` };
    }
    // [KASSA] A missing rate is refused, never defaulted — see isTillRate for what that costs.
    if (!isTillRate(item.btw_rate)) {
      return { ok: false, error: `Kies een btw-tarief bij "${description}" (0%, 9% of 21%).` };
    }
    if (!isTillMethod(item.method)) {
      return { ok: false, error: `Kies bij "${description}" hoe er betaald is.` };
    }
    lines.push({
      description,
      quantity,
      unit_price_incl: unitPrice,
      btw_rate: Number(item.btw_rate),
      method: item.method,
      article_id: typeof item.article_id === "string" && item.article_id ? item.article_id : null,
    });
  }
  return { ok: true, lines };
}

/** What else already claims this day's revenue. */
export interface DayClaims {
  /** A daily_turnover row for this day whose source is NOT 'manual' (a real Z-report). */
  hasImportedDay: boolean;
  /** Cash-book entries dated this day with category 'omzet'. */
  cashOmzetCount: number;
  /**
   * Sales already rung up on the Kassa for this day. Only the HAND-TYPED day asks about these — the
   * Kassa itself owns them, and rebuilds the day from them on every sale. Omitted means zero.
   */
  tillSaleCount?: number;
  /**
   * A hand-typed day stands on this date: a daily_turnover row this app wrote, with NO till sales
   * behind it. Only the KASSA asks about this one, and it is the mirror of tillSaleCount above.
   *
   * Without it the two doors were asymmetric in the one direction that loses money silently. The
   * typed day refused to overwrite the Kassa, but the Kassa did not refuse to overwrite the typed
   * day: rebuildTillDay rewrites the day from till_sales alone, so the first ticket rung up on a
   * date the owner had already typed would replace his whole day's takings with that one sale —
   * upserted over the same row, with the audit trail recording an ordinary sale and no screen
   * anywhere showing that a figure had gone.
   */
  hasTypedDay?: boolean;
}

/**
 * ── ONE DAY, ONE SOURCE ──
 *
 * Why this refuses rather than merges. A day's cash revenue can reach the books through two
 * sources, and both engines deliberately suppress the second when the first exists
 * (financial-result.ts `covered`, kasboek.ts `isTillCountedOmzet`) — because adding them put a shop
 * taking EUR 500 a day roughly EUR 45.000 above reality inside one quarter.
 *
 * The suppression works. That is exactly the problem: writing a turnover day on top of existing cash
 * 'omzet' entries does not corrupt anything, it SILENTLY SWITCHES THOSE ENTRIES OFF. The owner sees
 * rows in his Kas screen that no longer reach his omzet, his btw or his drawer, and nothing anywhere
 * says so. A write whose side effect is to un-count money the owner already entered has to be
 * refused at the door and explained, not performed quietly.
 *
 * The imported-day case is the same argument in the other direction: a real Z-report is a printed
 * document with the till's own rounding, and a hand-rung day must never overwrite it.
 *
 * Returns the Dutch sentence to show, or null when the day is free.
 */
export function daySourceConflict(claims: DayClaims): string | null {
  if (claims.hasImportedDay) {
    return "Voor deze dag is al een kassa-rapport ingelezen. Die dag staat al in je omzet — een handmatige verkoop zou dat rapport overschrijven.";
  }
  if (claims.hasTypedDay) {
    return "Voor deze dag heb je de omzet al met de hand ingevuld. Eén dag telt uit één bron: haal die dag weg bij Dagomzet als je hem alsnog op de Kassa wilt aanslaan.";
  }
  if ((claims.tillSaleCount ?? 0) > 0) {
    // A typed day and a rung-up day are the same row from two directions, and the Kassa rebuilds
    // that row from its sales after every ticket. So a typed total here would not merely be
    // overwritten by the next sale — it would look accepted, sit on the screen, and vanish the next
    // time a customer paid, with nothing saying which figure the aangifte ended up using.
    return "Je hebt vandaag al verkopen aangeslagen op de Kassa. Die tellen samen het dagtotaal — vul deze dag niet ook met de hand in.";
  }
  if (claims.cashOmzetCount > 0) {
    const n = claims.cashOmzetCount;
    return n === 1
      ? "Je hebt voor deze dag al één contante verkoop in je Kas geboekt. Eén dag telt uit één bron: haal die kasboeking weg, of boek deze verkoop daar."
      : `Je hebt voor deze dag al ${n} contante verkopen in je Kas geboekt. Eén dag telt uit één bron: haal die kasboekingen weg, of boek deze verkoop daar.`;
  }
  return null;
}

/** A whole day typed by hand: gross per rate, plus how it was paid. */
export interface ManualDayInput {
  gross_0?: unknown;
  gross_9?: unknown;
  gross_21?: unknown;
  pin?: unknown;
  cash?: unknown;
  other?: unknown;
}

export type ManualDayResult =
  | { ok: true; gross: DayGross }
  /** Dutch — this reaches the owner. */
  | { ok: false; error: string };

/** A day typed by hand cannot exceed this. A slipped decimal is likelier than a EUR 1m day. */
const MAX_DAY_GROSS = 1_000_000;
/** The two splits must agree to the cent. One cent of slack absorbs the owner's own rounding. */
const SPLIT_TOLERANCE = 0.011;

function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = Number(v);
  return Number.isFinite(n) ? round2(n) : null;
}

/**
 * Validate a hand-typed day.
 *
 * ── WHY THE TWO SPLITS MUST AGREE ──
 * The rate split (what was sold) and the payment split (how it was paid) describe the same money.
 * The app does not merely display them: the payment split is what SUPPRESSES the day's PIN
 * settlement when it lands on the bank (financial-result's covered-day budget reads pin_amount) and
 * what feeds the drawer as ontvangsten (buildKasboek reads cash_amount). A day whose splits
 * disagree therefore does not produce a slightly wrong screen — it produces revenue counted twice
 * (pin too low, so the bank line is only partly suppressed) or a drawer that never balances.
 *
 * So this is not a tidiness check and it must not be relaxed into a warning.
 */
export function validateManualDay(raw: ManualDayInput | null | undefined): ManualDayResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Ongeldige gegevens." };

  const fields = {
    gross_0: money(raw.gross_0), gross_9: money(raw.gross_9), gross_21: money(raw.gross_21),
    pin: money(raw.pin), cash: money(raw.cash), other: money(raw.other),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) return { ok: false, error: "Vul alleen bedragen in." };
    // A negative typed day is refused. A refund day is real, but it is not something anyone types
    // into a "what did you take today" form by accident — and a minus sign that slipped in is far
    // more likely, which would REDUCE the quarter's btw with nothing to catch it.
    if (value < 0) return { ok: false, error: "Een bedrag kan niet negatief zijn." };
    if (value > MAX_DAY_GROSS) return { ok: false, error: `Het bedrag bij ${key} is te hoog — controleer de komma.` };
  }

  const gross = fields as DayGross;
  const rateTotal = round2(gross.gross_0 + gross.gross_9 + gross.gross_21);
  const paidTotal = round2(gross.pin + gross.cash + gross.other);

  if (rateTotal === 0) return { ok: false, error: "Vul de omzet van deze dag in." };
  if (paidTotal === 0) return { ok: false, error: "Vul in hoe er betaald is (pin, contant of overig)." };
  if (Math.abs(rateTotal - paidTotal) > SPLIT_TOLERANCE) {
    return {
      ok: false,
      error: `De omzet (€${rateTotal.toFixed(2)}) en de betaalwijzen (€${paidTotal.toFixed(2)}) zijn niet gelijk. Ze moeten dezelfde dag beschrijven.`,
    };
  }
  return { ok: true, gross };
}
