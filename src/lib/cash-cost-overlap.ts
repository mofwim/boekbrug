// src/lib/cash-cost-overlap.ts
// [KAS-DUBBELE-KOST] The same purchase, written down twice: once as a hand-typed cash expense and
// once as a purchase invoice. Pure — no I/O, no clock.
//
// ── WHY THIS EXISTS ──
//
// The app already knows this is the wrong way round. KasClient's [KAS-UPLOAD] button says so in as
// many words: a cash-paid receipt belongs in the intake, "deliberately NOT a manual cash 'kosten'
// entry (that would drop the voorbelasting and double-count once the same receipt is booked as an
// invoice)".
//
// It STEERS the owner correctly and then does not check. The 'kosten' category is open to the
// owner (OWNER_CASH_CATEGORIES in cash.ts), the add form offers it as the natural way to write
// down "€ 121 to the wholesaler", and nothing anywhere compares that line to the invoice that
// arrives by e-mail the next morning. Both are then in the books, and both are counted:
//
//   · the invoice books ex-BTW into `kosten` and its BTW into voorbelasting, on accrual
//     (financial-result.ts, INCOMING_OK = paid|received);
//   · the cash entry books its own amount into `kosten` as well — and, when it carries a bon and a
//     rate, a SECOND voorbelasting on the same money.
//
// So the cost is deducted twice and the BTW may be reclaimed twice. That is not a display bug: it
// lands in the aangifte, and an inspector reading the kasboek beside the inkoopfacturen finds the
// same bill in both. It is also invisible from either side alone — each row is individually
// correct, which is exactly why nobody notices.
//
// ── AND THE DRAWER, IN THE WORST CASE ──
//
// If the invoice was ALSO marked paid-in-cash, reconcileCashSettlements has already created its
// own 'betaling' entry for it (cash-settle.ts). The drawer then goes down TWICE for one handover:
// once by the system settlement, once by the hand-typed line. A kasboek that reports less money
// than is in the till is the shape the Belastingdienst reads as hidden turnover — see
// [KAS-NEGATIEF] in kasboek.ts, which blocks a filing over exactly that number.
//
// ── WHAT THIS DOES NOT DO ──
//
// It does not delete, merge, or rewrite anything, and it never books. Which of the two rows is the
// right one is a question about paper the owner has and we do not — the same discipline
// duplicate-payable.ts states for its own pairs. This produces a QUESTION with its evidence
// attached: what matched, how far apart, and what it costs if it is really one purchase.
//
// It is deliberately conservative. A false positive costs one dismissed question; a false negative
// costs a wrong aangifte. But a NOISY detector is worse than none — it trains the owner to ignore
// it — so the amount must agree TO THE CENT, and a system-managed settlement is never a candidate.

import { round2 } from "./invoice-totals";
// [KAS-DUBBELE-KOST] The app's one legal-suffix-folding supplier key, so "Enka Horeca B.V." on the
// invoice and "enka horeca" in the drawer are the same supplier here and on the pay screen alike.
import { supplierKey } from "./duplicate-payable";

/** A cash book line, as this reads it. A structural subset of the cash_entries row. */
export interface CashCostEntry {
  id: string;
  entry_date: string | null;
  direction: "in" | "out" | null;
  amount: number | null;
  category: string | null;
  description: string | null;
  /**
   * [CASH-SETTLE] Set only on a system-managed 'betaling' row, which IS the invoice's settlement
   * and is therefore never a duplicate of it. Carried so such a row can be excluded by fact rather
   * than by its category alone.
   */
  invoice_id?: string | null;
  /** Present + a bon (document_id) is what makes the cash entry deduct BTW a second time. */
  btw_rate?: number | null;
  document_id?: string | null;
}

/** A purchase invoice, as this reads it. */
export interface PurchaseForOverlap {
  id: string;
  invoice_number: string | null;
  client_name: string | null;
  invoice_date: string | null;
  payment_date?: string | null;
  total_ex_btw: number | null;
  total_inc_btw: number | null;
  status: string | null;
  payment_method?: string | null;
  invoice_type?: string | null;
  direction?: string | null;
}

/** Which figure the cash line equalled. Reported, because it changes what the owner should look at. */
export type OverlapAmountBasis = "gross" | "net";

export interface CashCostOverlap {
  entry: CashCostEntry;
  invoice: PurchaseForOverlap;
  /** 'gross' = the cash line equals the invoice incl. btw; 'net' = it equals the ex-BTW figure. */
  basis: OverlapAmountBasis;
  /** Whole days between the cash line's date and the invoice's. 0 when they are the same day. */
  daysApart: number;
  /** The description names the supplier — the strongest extra witness this pairing can have. */
  nameMatched: boolean;
  /**
   * True when the invoice is ALSO settled in cash — status 'paid' with method 'kas' — so the
   * DRAWER is short by the entry's amount on top of the double cost. The expensive case.
   *
   * Read from the invoice, not from the presence of a 'betaling' row, and that is deliberate:
   * reconcileCashSettlements is self-healing and runs on every Kas load and hourly, so the
   * settlement either exists or is about to. Looking for the row itself would make this answer
   * flap depending on whether the reconciler had got there yet — a warning that appears and
   * disappears between two page loads is worse than one that is a day early.
   */
  drawerDoubled: boolean;
  /** The ex-BTW amount currently deducted twice. */
  doubleCountedCost: number;
  /**
   * The voorbelasting deducted twice, or 0. Only a cash entry with BOTH a bon and a rate claims
   * BTW of its own — financial-result.ts requires document_id && btw_rate > 0 — so a bare typed
   * line doubles the cost and not the BTW.
   */
  doubleCountedBtw: number;
}

/** Half a cent — the same settled-amount margin as the rest of the money line. */
const CENT = 0.005;

/**
 * How far apart the two dates may be. A cash handover and its invoice are usually the same day,
 * but a bon can be entered late and an e-mailed invoice can arrive days after the counter. A month
 * covers the honest lag; widening it further would start pairing one month's expense with the
 * next month's identical bill, which is a different purchase.
 */
export const OVERLAP_WINDOW_DAYS = 31;

/** Statuses whose cost financial-result.ts actually books. A row it never counted is not doubled. */
const COST_BOOKING_STATUS = new Set(["paid", "received"]);

const DAY_MS = 86_400_000;

const isoDay = (value: string | null | undefined): string | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

/** Whole days between two ISO days, or null when either cannot be read. */
function daysBetween(a: string | null, b: string | null): number | null {
  const x = a ? Date.parse(`${a}T00:00:00Z`) : NaN;
  const y = b ? Date.parse(`${b}T00:00:00Z`) : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.round(Math.abs(x - y) / DAY_MS);
}

/** A money column as a usable positive magnitude; 0 when the column cannot be read. */
function magnitude(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

/**
 * Is this cash line one the OWNER typed as a cost?
 *
 * Excluded, each for its own reason:
 *   · a 'betaling' row — that IS the invoice's settlement, created and healed by
 *     reconcileCashSettlements, and P&L-neutral by design. Flagging it would report the correct
 *     mechanism as an error.
 *   · anything carrying invoice_id — same fact, established by the link rather than the label, so
 *     a row whose category was edited by hand cannot slip through.
 *   · direction 'in' — money coming back under 'kosten' is a refund OF a cost, not a second one.
 */
export function isOwnerTypedCost(e: CashCostEntry): boolean {
  if ((e.category ?? "") !== "kosten") return false;
  if (e.invoice_id != null) return false;
  if (e.direction !== "out") return false;
  return magnitude(e.amount) > CENT;
}

/** Does this purchase invoice actually put a cost in the books? */
export function booksACost(inv: PurchaseForOverlap): boolean {
  // A creditnota is the reverse of a cost; pairing one with a cash outflow would be nonsense.
  if ((inv.invoice_type ?? "") === "creditnota") return false;
  // Absent direction reads as incoming: the caller queries by receiver_id, so a row without the
  // column is a purchase. Only an explicit 'outgoing' is a sale.
  if ((inv.direction ?? "incoming") !== "incoming") return false;
  if (!COST_BOOKING_STATUS.has(inv.status ?? "")) return false;
  return magnitude(inv.total_inc_btw) > CENT || magnitude(inv.total_ex_btw) > CENT;
}

/**
 * Does the cash line's free text name this supplier?
 *
 * A witness, never a requirement: owners write "boodschappen", "diesel", or nothing at all, and
 * demanding a name would silence the detector on the majority of real pairs. Legal suffixes are
 * folded by supplierKey, so "Enka Horeca B.V." on the invoice matches "enka horeca" in the drawer
 * — the same key the pay screen groups its own duplicates by.
 *
 * Matched as WHOLE TOKENS, not as a substring. A raw `includes` lets a short supplier match inside
 * an unrelated word ("Aldi" inside "kwaliteitscontrole"), which is the same fragment-matching bug
 * [TRUST-MATCH] closed in bank-matching for invoice numbers — and a false witness here promotes a
 * coincidence to the top of the list.
 *
 * A supplier key of fewer than four characters is not used at all: a two- or three-letter token
 * appears in half the free text ever typed.
 */
export function descriptionNamesSupplier(description: string | null, supplier: string | null): boolean {
  const naam = supplierKey(supplier);
  if (naam.length < 4) return false;
  const woorden = supplierKey(description).split(" ").filter(Boolean);
  const gezocht = naam.split(" ").filter(Boolean);
  if (gezocht.length === 0 || woorden.length < gezocht.length) return false;
  for (let i = 0; i + gezocht.length <= woorden.length; i++) {
    if (gezocht.every((w, j) => woorden[i + j] === w)) return true;
  }
  return false;
}

/**
 * Every hand-typed cash cost that appears to be a purchase invoice the books already hold.
 *
 * Pairs are one-to-one and greedy on the strongest evidence: an invoice already claimed by a
 * nearer, better-witnessed cash line is not offered again, and neither is a cash line already
 * paired. Two identical amounts in one month are then two questions about two pairs rather than
 * one row accused four times.
 */
export function detectCashCostOverlaps(args: {
  entries: readonly CashCostEntry[];
  invoices: readonly PurchaseForOverlap[];
  windowDays?: number;
}): CashCostOverlap[] {
  const window = args.windowDays ?? OVERLAP_WINDOW_DAYS;
  const typed = args.entries.filter(isOwnerTypedCost);
  const payable = args.invoices.filter(booksACost);
  if (typed.length === 0 || payable.length === 0) return [];

  // ── The amount is an INDEX, not a scan ──
  //
  // The obvious shape is a nested loop over both sides, and it works — but it is O(n × m) on two
  // lists that both grow with the business, on an endpoint the Kas screen calls TWICE per refresh.
  // Ten times the shop is ten times BOTH sides, so a hundred times the work.
  //
  // The match is EXACT to the cent, so the amount can be a key instead of a comparison, and the
  // whole thing collapses to one pass over each side. Measured, with no matches (the everyday
  // case, where the nested loop still had to visit every pair):
  //
  //      500 ×   500 =   250k nominal pairs → 1,2 ms
  //     2000 ×  4000 =  8.000k              → 2,8 ms
  //     4000 ×  8000 = 32.000k              → 4,5 ms
  //
  // Linear in n + m rather than in n × m — those 32 million pairs are never visited at all.
  //
  // The key is integer cents because that is the conventional and cheapest form — NOT because it
  // repairs anything: both sides already go through round2, which is what collapses float noise,
  // so `60.5` would key just as correctly today. Written down so the next reader does not mistake
  // a convention for a guard and defend it as though money depended on it.
  // Takes an ALREADY-rounded amount — every caller below passes a round2 result, and it has to.
  //
  // `Math.round(v * 100)` alone handles ordinary float noise (0.1 + 0.2 keys as 30 either way), so
  // rounding a second time in here would read as the protection and be none. The place the app's
  // round2 is genuinely load-bearing is the HALF CENT: 1.005 is really 1.00499999999999989, so a
  // bare conversion keys it as 100 while the invoice — stored already rounded to 1.01 — keys as
  // 101, and a real pair goes unreported. round2 carries the epsilon that closes exactly that gap.
  //
  // Both halves of this were established by negative control, in that order: the first two
  // attempts to prove the guard did not bite at all, because they were aimed at noise this line
  // absorbs by itself.
  const cents = (rounded: number): number => Math.round(rounded * 100);
  const byGross = new Map<number, PurchaseForOverlap[]>();
  const byNet = new Map<number, PurchaseForOverlap[]>();
  for (const inv of payable) {
    const gross = round2(magnitude(inv.total_inc_btw));
    const net = round2(magnitude(inv.total_ex_btw));
    if (gross > CENT) {
      const k = cents(gross);
      const list = byGross.get(k); if (list) list.push(inv); else byGross.set(k, [inv]);
    }
    if (net > CENT) {
      const k = cents(net);
      const list = byNet.get(k); if (list) list.push(inv); else byNet.set(k, [inv]);
    }
  }

  // Every pairing that survives the rules, strongest first, then assigned one-to-one below.
  type Pairing = { overlap: CashCostOverlap; strength: number };
  const pairings: Pairing[] = [];

  for (const e of typed) {
    const amount = round2(magnitude(e.amount));
    const entryDay = isoDay(e.entry_date);
    const key = cents(amount);
    // Gross first, so an invoice reachable by BOTH figures (a 0%/verlegd purchase, where ex and
    // inc are equal) reports the figure the owner actually handed over.
    //
    // `seen` keeps the net pass from re-offering that same invoice under the weaker basis. It
    // changes no ANSWER — the one-to-one assignment below would drop the second copy anyway, and
    // a negative control confirmed the output is identical without it. It is here to keep the
    // reported `basis` deterministic at the point it is decided rather than by an accident of sort
    // stability twenty lines later, and to not build a pairing that is certain to be discarded.
    const seen = new Set<string>();
    const candidates: Array<{ inv: PurchaseForOverlap; basis: OverlapAmountBasis }> = [
      ...(byGross.get(key) ?? []).map((inv) => ({ inv, basis: "gross" as const })),
      // 'net' is here because writing the ex-BTW amount into the drawer is an ordinary slip — the
      // invoice shows both numbers — and it is the same money.
      ...(byNet.get(key) ?? []).map((inv) => ({ inv, basis: "net" as const })),
    ];
    for (const { inv, basis } of candidates) {
      if (seen.has(inv.id)) continue;
      seen.add(inv.id);

      // The invoice's own date is the document date; a cash-settled invoice also has a payment
      // date, and that is nearer to when the money physically moved. Whichever is closer wins —
      // both are the same purchase, and taking the max would drop honest pairs on a late invoice.
      const viaInvoiceDate = daysBetween(entryDay, isoDay(inv.invoice_date));
      const viaPaymentDate = daysBetween(entryDay, isoDay(inv.payment_date));
      const gap = viaInvoiceDate == null ? viaPaymentDate
        : viaPaymentDate == null ? viaInvoiceDate
        : Math.min(viaInvoiceDate, viaPaymentDate);
      // A date neither side can read is not evidence of anything, so the pair is not offered.
      // Silence beats a question the owner cannot check.
      if (gap == null || gap > window) continue;

      const nameMatched = descriptionNamesSupplier(e.description, inv.client_name);
      const drawerDoubled =
        (inv.status ?? "") === "paid" && (inv.payment_method ?? "") === "kas";

      // What the double entry actually costs, in the two figures the aangifte is built from.
      // The cost is the INVOICE's ex-BTW: that is the amount booked a second time, whichever of
      // the two figures the owner happened to type into the drawer. Read from the invoice here
      // rather than carried out of the index above — the index answers "which invoices", not
      // "how much", and threading a second value through it would be two places to get it wrong.
      const net = round2(magnitude(inv.total_ex_btw));
      const doubleCountedCost = net > CENT ? net : round2(magnitude(inv.total_inc_btw));
      // Only a cash line with BOTH a bon and a rate deducts BTW of its own — financial-result.ts
      // requires document_id && btw_rate > 0. A bare typed line doubles the cost and not the BTW,
      // and saying otherwise would overstate the damage on the commonest shape of all.
      const rate = Number(e.btw_rate);
      const claimsOwnBtw = e.document_id != null && Number.isFinite(rate) && rate > 0;
      const doubleCountedBtw = claimsOwnBtw ? round2(amount - amount / (1 + rate / 100)) : 0;

      pairings.push({
        overlap: {
          entry: e, invoice: inv, basis, daysApart: gap, nameMatched, drawerDoubled,
          doubleCountedCost, doubleCountedBtw,
        },
        // Strength orders the greedy assignment, nothing else. A named supplier outweighs any
        // date gap (it is independent evidence); after that, nearer in time is stronger; the
        // drawer case breaks a remaining tie because it is the one that also moves the balance.
        strength: (nameMatched ? 10_000 : 0) + (window - gap) * 10 + (drawerDoubled ? 1 : 0),
      });
    }
  }

  pairings.sort((a, b) =>
    b.strength - a.strength ||
    // A stable last resort so the same books always produce the same list — a question that
    // reorders itself between two loads reads as two different questions.
    a.overlap.entry.id.localeCompare(b.overlap.entry.id) ||
    a.overlap.invoice.id.localeCompare(b.overlap.invoice.id));

  const usedEntries = new Set<string>();
  const usedInvoices = new Set<string>();
  const out: CashCostOverlap[] = [];
  for (const p of pairings) {
    if (usedEntries.has(p.overlap.entry.id) || usedInvoices.has(p.overlap.invoice.id)) continue;
    usedEntries.add(p.overlap.entry.id);
    usedInvoices.add(p.overlap.invoice.id);
    out.push(p.overlap);
  }
  // Newest movement first: the drawer is read from the recent end, and a pair the owner still
  // remembers is the one they can actually resolve.
  return out.sort((a, b) => (b.entry.entry_date ?? "").localeCompare(a.entry.entry_date ?? ""));
}

/**
 * Below this the doubled cost rounds to nothing on every surface, and "1 regel, € 0 dubbel" reads
 * as noise. The same materiality floor the art. 29 notes use, for the same reason.
 */
export const DOUBLE_COST_MIN_EUR = 0.5;

/**
 * [KAS-DUBBELE-KOST] An honest Dutch note for the concept aangifte, or null when there is nothing
 * (material) to say.
 *
 * A NOTE, never a block and never a correction — and the distinction is deliberate. A negative
 * drawer is arithmetic: money cannot leave a till that never held it, so readiness.ts refuses the
 * filing over it. This is a PAIRING: cent-exact and inside a month is strong evidence, not proof,
 * and two genuinely separate purchases of the same amount in one month do happen. Blocking a
 * filing on a probable duplicate would stop an owner doing their legal duty on a guess.
 *
 * But it belongs here, because HERE is where the doubled cost lands. The Kas screen is where the
 * owner can act; the aangifte is where the consequence is, and the accountant reading this note is
 * usually the only person who will look at both sides. Silence on this page is the one thing the
 * app must not choose — see vatClawbackNote directly, which exists for exactly that reason.
 *
 * Dutch, like every other note on this page: it is read by the owner and their boekhouder.
 */
export function doubleCostNote(overlaps: readonly CashCostOverlap[]): string | null {
  const t = overlapTotals(overlaps);
  if (t.count === 0 || t.cost < DOUBLE_COST_MIN_EUR) return null;
  const eur = (n: number) => `€${Math.round(n).toLocaleString("nl-NL")}`;
  const namen = overlaps.slice(0, 5).map((o) => o.invoice.invoice_number ?? "?").filter(Boolean).join(", ");
  const meer = t.count > 5 ? ` (+${t.count - 5} meer)` : "";
  const btwZin = t.btw >= DOUBLE_COST_MIN_EUR
    ? ` Daar zit ${eur(t.btw)} btw in die dan twee keer is teruggevraagd.`
    : "";
  // The drawer half is a different fact with a different remedy, so it gets its own sentence
  // rather than being folded into the cost figure.
  const kasZin = t.drawer >= DOUBLE_COST_MIN_EUR
    ? ` Bij een deel ervan staat de factuur óók op contant, waardoor je kassaldo ${eur(t.drawer)} te laag staat.`
    : "";
  return (
    `LET OP — mogelijk dubbel geboekte kosten: ${t.count === 1 ? "1 kasregel komt" : `${t.count} kasregels komen`} ` +
    `tot op de cent overeen met een inkoopfactuur die al in de boeken staat${namen ? ` (${namen}${meer})` : ""}. ` +
    `Als dat dezelfde aankoop is, is ${eur(t.cost)} aan kosten twee keer afgetrokken.${btwZin}${kasZin} ` +
    "Dit wordt NIET automatisch gecorrigeerd en is geen zekerheid — twee losse aankopen van hetzelfde " +
    "bedrag bestaan. Controleer de regels op de Kas-pagina voordat je indient."
  );
}

/** What the whole set costs, for a caller that reports one figure before the list. */
export function overlapTotals(overlaps: readonly CashCostOverlap[]): {
  count: number; cost: number; btw: number; drawer: number;
} {
  let cost = 0, btw = 0, drawer = 0;
  for (const o of overlaps) {
    cost += o.doubleCountedCost;
    btw += o.doubleCountedBtw;
    if (o.drawerDoubled) drawer += round2(magnitude(o.entry.amount));
  }
  // Rounded after summing, for the reason kasboek.ts gives: rounding each item and then adding
  // gives a different number from the sum of the real amounts, and that difference is what
  // someone calls about.
  return { count: overlaps.length, cost: round2(cost), btw: round2(btw), drawer: round2(drawer) };
}
