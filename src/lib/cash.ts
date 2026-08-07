// src/lib/cash.ts
// [CASH-LEDGER] Pure helpers for the cash book. No I/O, testable
// (run: npx tsx src/lib/cash.test.ts).

// The category vocabulary a cash entry can carry — the same identities as the bank
// ledger, so both channels combine into one honest picture.
// [CASH-SETTLE] 'betaling' = paying an ALREADY-BOOKED supplier invoice in cash. It is a pure
// BALANCE movement (kas ↓), never a cost: the invoice already booked the cost + voorbelasting on
// accrual. computeResult only ever maps 'omzet'/'kosten' into the P&L (financial-result.ts), so
// any other category — 'betaling' included — is automatically excluded from kosten/omzet/BTW,
// while computeCashBalance still counts it in the drawer. This is exactly how the bank side works
// (a bank line matched to an invoice is skipped as a cost, counted only as settlement).
// [CASH-COST-VAT] 'salaris' = cash wages: a real business cost, never any BTW/voorbelasting.
export const CASH_CATEGORIES = ["omzet", "kosten", "salaris", "prive", "transfer", "tax", "fee", "betaling"] as const;
export type CashCategory = (typeof CASH_CATEGORIES)[number];

export function isCashCategory(v: unknown): v is CashCategory {
  return typeof v === "string" && (CASH_CATEGORIES as readonly string[]).includes(v);
}

// ─── [CASH-SETTLE] Invoice ↔ kasboek settlement (mirror of the bank circle) ────────────
// Paying an incoming invoice in cash must (a) move the kas balance and (b) NOT re-book the cost.
// So we create a linked 'betaling' entry: direction 'out', amount = the GROSS the owner handed
// over (total_inc_btw), btw_rate null (voorbelasting already came from the invoice). Linked by
// invoice_id so it's idempotent, reversible, and reconcilable — never double-counted.

export interface SettleableInvoice {
  id: string;
  // [CASH-SETTLE-BIDIR] Which way the cash moved the drawer. An INCOMING (purchase) invoice paid
  // in cash → money LEAVES the drawer ('out'). An OUTGOING (sales) invoice paid in cash → money
  // ENTERS the drawer ('in'). Either way the entry is category 'betaling' → P&L-NEUTRAL, because
  // the cost (incoming) / the omzet (outgoing) was ALREADY booked on accrual by the invoice. So
  // the drawer moves but nothing is double-counted. Default 'incoming' for older callers.
  direction?: "incoming" | "outgoing";
  // [CASH-CREDITNOTA] A creditnota moves the drawer the OTHER way from an invoice of the same
  // direction, because the money travels the other way. Read from the stored invoice_type, with
  // the sign as a second witness — see settlementDirection below for what goes wrong without it.
  invoice_type?: string | null;
  total_inc_btw: number | null;
  // [CASH-SETTLE] Fallback components: when total_inc_btw is null but ex + btw are present, the
  // gross paid = ex + btw. Without this, a cash-paid invoice with a null gross booked its cost
  // but never moved the drawer (kas overstated, never healed).
  total_ex_btw?: number | null;
  btw_amount?: number | null;
  payment_date?: string | null;
  invoice_number?: string | null;
  client_name?: string | null;
  // [CASH-PARTIAL] The portion already settled through the BANK (instalments recorded in
  // invoices.amount_paid by the bank confirm/unlink paths). The cash the owner physically handed
  // over is the REMAINDER — settling the full gross would overstate the drawer movement by every
  // bank instalment. Absent/0 for the common fully-cash case → identical to before.
  //
  // [MANUAL-PARTIAL-PAY] CAREFUL: amount_paid is no longer bank-only. Since a manual payment can
  // be recorded as 'kas', amount_paid includes cash instalments too — so `gross − amount_paid`
  // now yields 0 for a fully cash-paid invoice, which would make the reconciler DELETE the
  // kasboek entry as stale and silently break the drawer balance. That is why cash_paid below
  // exists and takes precedence: the cash portion is read from the instalments themselves.
  amount_paid?: number | null;
  // [MANUAL-PARTIAL-PAY] The CASH portion, summed from the invoice's instalments with
  // method='kas' (bank_tx_invoices). Authoritative when present — it says what physically left
  // or entered the drawer, instead of inferring it from what the bank did NOT pay. Absent for
  // legacy invoices settled before manual instalments existed → the fallback below applies.
  cash_paid?: number | null;
  // [CASH-INSTALMENT] The cash instalments themselves, each with its own day and amount. Present
  // → the drawer gets ONE entry PER instalment, because that is what physically happened: €500
  // out of the till on 3 May and €710 on 12 June are two movements, not one of €1.210 on the
  // later date. Summing them into a single entry made the balance wrong for every day in
  // between and could move money across an already-filed quarter.
  cash_instalments?: CashInstalment[];
}

/** One recorded cash payment against an invoice (a bank_tx_invoices row with method 'kas'). */
export interface CashInstalment {
  /** bank_tx_invoices.id — the stable identity of this movement, and the kasboek entry's key. */
  id: string;
  /** Magnitude actually handed over / received. */
  amount: number;
  /** ISO day the money moved. Null only on a malformed legacy row. */
  paid_on?: string | null;
}

/** The CASH the owner actually handed over for this invoice. Pure.
 *
 *  Two regimes, in order:
 *   1. [MANUAL-PARTIAL-PAY] cash_paid present → that IS the cash, exactly. Every cash instalment
 *      is a recorded row (method='kas'), so no inference is needed or wanted.
 *   2. LEGACY (no instalment rows: invoices settled before this existed) → the gross
 *      (total_inc_btw, or ex+btw when the gross wasn't stored) MINUS what the bank settled.
 *
 *  Returns null when that yields no positive amount — a €0/credit/refund (creditnota) or a
 *  fully-bank-settled invoice is never a cash settlement, so we don't auto-book one. */
export function settlementGross(inv: SettleableInvoice): number | null {
  const raw =
    typeof inv.total_inc_btw === "number" && inv.total_inc_btw !== 0
      ? inv.total_inc_btw
      : typeof inv.total_ex_btw === "number" && typeof inv.btw_amount === "number"
        ? inv.total_ex_btw + inv.btw_amount
        : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;

  // 1) Recorded cash instalments are the truth when we have them.
  if (inv.cash_paid != null) {
    const cash = Math.round(Math.max(0, Number(inv.cash_paid)) * 100) / 100;
    return cash > 0.005 ? cash : null;
  }

  // 2) [CASH-PARTIAL] Legacy inference: €500 invoice, €300 paid by bank instalment, remainder
  // paid in cash → the drawer moved €200, not €500. Rounded to cents so float noise never
  // produces a €0.004 entry.
  const paidByBank = Math.max(0, Number(inv.amount_paid ?? 0));
  const remainder = Math.round((raw - paidByBank) * 100) / 100;
  return remainder > 0.005 ? remainder : null;
}

export interface CashSettlementRow {
  invoice_id: string;
  /** [CASH-INSTALMENT] The instalment this movement is, or null for a legacy aggregate entry. */
  settlement_id: string | null;
  direction: "in" | "out";
  amount: number;
  category: "betaling";
  btw_rate: null;
  entry_date?: string;
  description: string;
}

/** Round to cents; the drawer is counted in coins, not in float dust. */
function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * [CASH-CREDITNOTA] Is this document a credit rather than a bill?
 *
 * Two witnesses, and either one is enough. invoice_type is the DECLARED truth and survives a
 * mis-signed amount; a negative gross is the ARITHMETIC truth and survives a row imported before
 * the type was set, or one the reader typed as a plain invoice. Requiring both would let a single
 * missing field book the drawer backwards, which is the failure this exists to stop.
 */
function isCreditDocument(inv: SettleableInvoice): boolean {
  if ((inv.invoice_type ?? "").toLowerCase() === "creditnota") return true;
  return typeof inv.total_inc_btw === "number" && inv.total_inc_btw < 0;
}

/**
 * [CASH-CREDITNOTA] Which way the drawer moves. The invoice's direction alone does not say.
 *
 * `direction` records who sent the document, not which way the money travelled — and on a
 * creditnota those are opposite. A supplier who refunds me in cash sends an INCOMING document
 * while money comes INTO the till; I who refund a customer send an OUTGOING one while money goes
 * OUT. Booking by direction alone puts every cash-settled creditnota in the drawer backwards, and
 * a wrong-signed entry is off by TWICE its amount: the balance the Belastingdienst reads is short
 * by 2 × the refund, on a book whose whole purpose is that it reconciles.
 *
 * settlementGross already refuses a creditnota — `raw <= 0 → null`, with the reason written on it.
 * That guard sits on the LEGACY aggregate path, and the per-instalment path added later returns
 * before it is ever consulted. Same shape as everything else this session: a refusal written,
 * argued for, and bypassed by a newer path above it.
 */
function settlementDirection(inv: SettleableInvoice): "in" | "out" {
  const outgoing = inv.direction === "outgoing";
  // XOR: a credit flips whichever way the invoice direction would have pointed.
  return outgoing !== isCreditDocument(inv) ? "in" : "out";
}

/** How a settlement reads in the kasboek. Direction follows the MONEY (settlementDirection), which
 *  on an ordinary invoice is the invoice's own direction: an outgoing (sales) invoice paid in cash
 *  raises the drawer ('in'), an incoming (purchase) invoice lowers it ('out'). Both are category
 *  'betaling' (P&L-neutral) — the omzet/cost already came from the invoice. `part` numbers a
 *  movement when there are several ("1e termijn"), so the owner can tell them apart in a list of
 *  otherwise identical lines. */
function settlementDescription(inv: SettleableInvoice, part?: { index: number; of: number }): string {
  const credit = isCreditDocument(inv);
  const noun = credit ? "creditnota" : "factuur";
  // The verb follows the drawer, not the document — for the same reason the direction does.
  const verb = settlementDirection(inv) === "in"
    ? "Ontvangen (contant)"
    : credit ? "Terugbetaling" : "Betaling";
  const label = [verb, noun, inv.invoice_number ?? ""].join(" ").trim();
  const withParty = inv.client_name ? `${label} — ${inv.client_name}` : label;
  return part && part.of > 1 ? `${withParty} (${part.index}e termijn van ${part.of})` : withParty;
}

function isoDay(value: string | null | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;
}

/**
 * [CASH-INSTALMENT] Every drawer movement this invoice caused — one row per cash instalment.
 *
 * This is the heart of the change. A cash payment is a physical event with a day and an amount;
 * two payments are two events. Aggregating them into one entry (the old model, forced by a
 * one-per-invoice unique index) made the kasboek claim the money left the till all at once, on
 * the day of the LAST instalment — so the balance was wrong for every day in between and part of
 * the money could jump into a different, possibly already-filed, quarter.
 *
 * Falls back to a single aggregate row when no instalments are recorded: invoices settled before
 * instalments existed, where the only truth available is "gross minus what the bank paid".
 * Returns [] when there is nothing usable to book — a €0/negative gross, or a fully bank-settled
 * invoice — because a garbage entry in the kasboek is worse than none.
 */
export function buildCashSettlements(inv: SettleableInvoice): CashSettlementRow[] {
  // [CASH-CREDITNOTA] Follows the money, not the document — see settlementDirection.
  const dir = settlementDirection(inv);

  const instalments = (inv.cash_instalments ?? [])
    .filter((p) => p && p.id && cents(Math.abs(Number(p.amount) || 0)) > 0.005)
    .map((p) => ({ id: p.id, amount: cents(Math.abs(Number(p.amount))), paid_on: isoDay(p.paid_on) }));

  if (instalments.length > 0) {
    // Oldest first, so the numbering in the description matches the order the money moved.
    instalments.sort((a, b) => (a.paid_on ?? "").localeCompare(b.paid_on ?? "") || a.id.localeCompare(b.id));
    return instalments.map((p, i) => ({
      invoice_id: inv.id,
      settlement_id: p.id,
      direction: dir,
      amount: p.amount,
      category: "betaling" as const,
      btw_rate: null,
      // An instalment without a date would silently land on "today" in the ledger; fall back to
      // the invoice's payment date, which is at least the right neighbourhood.
      ...((p.paid_on ?? isoDay(inv.payment_date)) ? { entry_date: (p.paid_on ?? isoDay(inv.payment_date))! } : {}),
      description: settlementDescription(inv, { index: i + 1, of: instalments.length }),
    }));
  }

  // [CASH-CREDITNOTA] The legacy aggregate path deliberately still books nothing for a credit:
  // settlementGross returns null on a non-positive gross, and here there are no instalment rows to
  // read an amount from — only `gross − amount_paid`, which is meaningless over a negative gross.
  // So the asymmetry with the branch above is intentional: that one has a real per-payment amount
  // and can book the movement correctly, this one would have to invent it. No entry beats a
  // wrong one, and every cash payment recorded since instalments exist takes the branch above.
  const amount = settlementGross(inv);
  if (amount === null) return [];
  const iso = isoDay(inv.payment_date);
  return [
    {
      invoice_id: inv.id,
      settlement_id: null,
      direction: dir,
      amount,
      category: "betaling" as const,
      btw_rate: null,
      ...(iso ? { entry_date: iso } : {}),
      description: settlementDescription(inv),
    },
  ];
}

/** The single aggregate settlement — kept for the legacy path and for callers that only ever
 *  deal with a one-payment invoice. Returns null when nothing should be booked. */
export function buildCashSettlement(inv: SettleableInvoice): CashSettlementRow | null {
  const rows = buildCashSettlements(inv);
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];
  // Several instalments: report their sum with no settlement key, which is precisely what the
  // old model wrote. Only a caller that has not been taught about instalments asks this.
  const total = cents(rows.reduce((s, r) => s + r.amount, 0));
  const last = rows[rows.length - 1];
  return { ...last, settlement_id: null, amount: total, description: settlementDescription(inv) };
}

/**
 * Reconcile the kasboek against the set of invoices that are currently paid-in-cash. Pure +
 * self-healing, so it is correct no matter WHICH pay path ran (server confirm, the manage-screen
 * executePay, a pen-mark suggestion the owner confirmed):
 *   - toCreate  : paid-kas invoices that have no linked 'betaling' entry yet.
 *   - toDeleteIds: 'betaling' entries whose invoice is no longer paid-in-cash (un-paid, or switched
 *     to bank) — the reversal, so undoing a cash payment removes its kas movement automatically.
 */
export interface ExistingSettlement {
  id: string;
  invoice_id: string | null;
  /** [CASH-INSTALMENT] Which instalment this entry is. NULL on a legacy aggregate entry. */
  settlement_id?: string | null;
  amount?: number | null;
  entry_date?: string | null;
  direction?: "in" | "out" | null;
}

/** A legacy aggregate entry has no instalment key; fold it onto one bucket so it stays unique
 *  per invoice (mirrors the coalesce in the database's unique index). */
const AGGREGATE_KEY = "";

export function computeCashSettlementSync(
  paidKasInvoices: SettleableInvoice[],
  existing: ExistingSettlement[],
): { toCreate: CashSettlementRow[]; toUpdate: Array<{ id: string; row: CashSettlementRow }>; toDeleteIds: string[] } {
  const paidIds = new Set(paidKasInvoices.map((i) => i.id));
  // [CASH-DUP-HEAL] Track EVERY linked entry, keyed by invoice AND instalment, not "last wins". A
  // duplicate 'betaling' row (a pre-index race, dirty legacy data) double-counts the drawer
  // forever if the reconcile can only see one of them — the extras were invisible to heal AND
  // excluded from delete. The first entry per key is kept/healed; every extra is deleted.
  const linkedByInvoice = new Map<string, ExistingSettlement[]>();
  for (const e of existing) {
    if (!e.invoice_id) continue;
    const list = linkedByInvoice.get(e.invoice_id);
    if (list) list.push(e);
    else linkedByInvoice.set(e.invoice_id, [e]);
  }

  const toCreate: CashSettlementRow[] = [];
  const toUpdate: Array<{ id: string; row: CashSettlementRow }> = [];
  const toDeleteIds: string[] = [];

  for (const inv of paidKasInvoices) {
    const wanted = buildCashSettlements(inv);
    const linked = linkedByInvoice.get(inv.id) ?? [];

    // [CASH-STALE-DELETE] Nothing to book (gross edited to €0/negative, or the bank has since
    // settled the whole amount). NEVER create one — and a previously-linked entry must not
    // survive either: leaving it would keep the drawer permanently wrong by the stale amount,
    // with no future reconcile ever fixing it. Deleting it IS the self-healing contract.
    if (wanted.length === 0) {
      for (const e of linked) toDeleteIds.push(e.id);
      continue;
    }

    // Index what exists by instalment key, keeping the first of any duplicates.
    const byKey = new Map<string, ExistingSettlement>();
    for (const e of linked) {
      const key = e.settlement_id ?? AGGREGATE_KEY;
      if (byKey.has(key)) toDeleteIds.push(e.id); // duplicate on the same key
      else byKey.set(key, e);
    }

    for (const row of wanted) {
      const key = row.settlement_id ?? AGGREGATE_KEY;
      const found = byKey.get(key);
      if (!found) {
        toCreate.push(row);
        continue;
      }
      byKey.delete(key);
      // [CASH-SETTLE] Heal a stale entry: an invoice's gross, date or direction can be corrected
      // after it was paid (the confirm route persists a re-reviewed amount), and the drawer must
      // follow — otherwise the kas balance is off by the delta forever.
      const amountDrift = typeof found.amount === "number" ? Math.abs(found.amount - row.amount) > 0.005 : true;
      const dateDrift = !!row.entry_date && (found.entry_date ?? null) !== row.entry_date;
      // [CASH-SETTLE-BIDIR] A corrected direction (or a legacy 'out' entry from before the
      // bidirectional model) would move the drawer the wrong way.
      const directionDrift = !!found.direction && found.direction !== row.direction;
      if (amountDrift || dateDrift || directionDrift) toUpdate.push({ id: found.id, row });
    }

    // [CASH-INSTALMENT] Whatever is left over belongs to no current instalment: the legacy
    // aggregate entry of an invoice that now has per-instalment rows (this is the migration, done
    // silently and exactly once), or the entry of an instalment the owner has since undone.
    for (const orphan of byKey.values()) toDeleteIds.push(orphan.id);
  }

  for (const e of existing) {
    if (e.invoice_id && !paidIds.has(e.invoice_id)) toDeleteIds.push(e.id);
  }
  return { toCreate, toUpdate, toDeleteIds };
}

export interface CashMovement {
  direction: "in" | "out";
  amount: number | null;
  /**
   * [KAS-DUBBELTELLING] The two fields the drawer needs to avoid counting a day's takings twice.
   *
   * Optional on the type because computeCashBalance (the plain running total) does not need them,
   * and a movement without them is simply never suppressed — the safe direction for a figure that
   * would otherwise be silently reduced.
   */
  date?: string | null;
  category?: string | null;
}

/**
 * Running kas balance: money in minus money out. A deposit to the bank (storting) is
 * an 'out' (cash leaves the drawer); a withdrawal (opname) is an 'in'. Transfers are
 * included here because they genuinely change the cash on hand — they are only
 * excluded from REVENUE/COST, not from the balance. Pure.
 */
export function computeCashBalance(entries: CashMovement[]): number {
  return entries.reduce(
    (sum, e) => sum + (e.direction === "in" ? e.amount ?? 0 : -(e.amount ?? 0)),
    0,
  );
}

/**
 * The FULL drawer balance shown as "SALDO IN KASSA": the configured opening float (beginsaldo),
 * PLUS the net of every cash_entries movement (computeCashBalance), PLUS the till's daily CASH
 * takings (daily_turnover.cash_amount). Those takings are physical cash in the drawer but live in
 * daily_turnover, NOT cash_entries — so summing cash_entries alone understates the drawer and can
 * show a FALSE negative "meer uitgaven dan ontvangsten" alarm for every till shop.
 *
 * Every surface that displays the drawer balance — the Kas page AND the home snapshot — MUST use
 * this one definition, or they diverge and one shows a wrong (often negative) saldo. Pure.
 */
export function computeDrawerBalance(input: {
  openingBalance?: number | null;
  entries: CashMovement[];
  /**
   * The till's daily rows, WITH their date. Dated on purpose: the date is what makes the
   * double-count below detectable, and a caller that cannot supply it cannot avoid the bug — so
   * the type refuses to let it be omitted rather than failing open on money.
   */
  tillDays: Array<{ date?: string | null; cash_amount: number | null }>;
}): number {
  const opening = Number(input.openingBalance) || 0;
  const tillCashIn = input.tillDays.reduce<number>((s, t) => s + (Number(t.cash_amount) || 0), 0);

  // ── [KAS-DUBBELTELLING] The same money, counted from two sources ──
  //
  // A till shop's cash takings arrive here twice by design of the data model, not by mistake:
  //   · daily_turnover.cash_amount — what the Z-report counted;
  //   · a cash_entries row, direction 'in', category 'omzet' — which the Kas page's default
  //     category makes the natural way to record the same counted drawer.
  //
  // computeResult already knows this: financial-result.ts skips a cash 'omzet' entry on a day the
  // turnover covers, so REVENUE was right. The drawer summed both, so a shop taking €500 a day in
  // cash ended a quarter roughly €45.000 above what the drawer physically held.
  //
  // That figure is not decorative. It goes into the Kasboek sheet the closing package hands the
  // accountant — the cash administration the Belastingdienst reads — and it feeds the drawer
  // witness that /api/btw/file and readiness.ts use to REFUSE a filing on a negative drawer. A
  // drawer that really dipped to −300 showed as +700, and the quarter filed with the single
  // strongest naheffing signal masked.
  //
  // So on a day the till already counted, a cash 'omzet' entry is the SAME money and is skipped.
  // Only 'omzet': a cash purchase, a bank deposit or a private withdrawal on that day are real
  // separate movements and still count.
  const coveredDays = new Set(
    input.tillDays
      .filter((t) => (Number(t.cash_amount) || 0) !== 0 && typeof t.date === "string" && t.date)
      .map((t) => t.date as string),
  );

  const counted = input.entries.filter((e) => {
    if ((e.category ?? "") !== "omzet") return true;
    // Fail-SAFE on a missing date, mirroring financial-result.ts: a shop that USES a till has its
    // cash sales inside the Z-report, so a dateless cash omzet is treated as covered rather than
    // double-counted; a ZZP with no till (no covered days at all) still counts it.
    return e.date ? !coveredDays.has(e.date) : coveredDays.size === 0;
  });

  return Math.round((opening + computeCashBalance(counted) + tillCashIn) * 100) / 100;
}
