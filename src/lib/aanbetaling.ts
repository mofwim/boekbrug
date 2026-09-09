// src/lib/aanbetaling.ts
// [AANBETALING] A deposit on an accepted offerte, and its settlement on the final invoice.
//
// Bouw and installatie bill 30–50% up front; Jortt calls it a termijnfactuur, e-Boekhouden a
// deelfactuur, Moneybird writes the deposit as a negative line on the final invoice. All three
// agree on the money: the deposit is an ordinary invoice with its own btw (factuurstelsel — the
// btw is due when the deposit is invoiced), and the final invoice bills the whole offerte and takes
// the deposit off again per btw rate, so the btw on the whole work is charged exactly once.
//
// Pure. The deposit is computed PER RATE GROUP after the offerte's own discounts, so a mixed 9%/21%
// offerte gets a 9% and a 21% deposit line and the btw stays exact. The settlement is the mirror:
// a credit line per rate, written the way this app writes a credit inside an invoice — negative
// QUANTITY, positive price (negative-line.ts, Peppol BR-27).
//
// [TAAL-DB] The line texts are document content, read by a Dutch customer: Dutch in every language.
//
// [AANBETALING-KORTING] The offerte's DOCUMENT discount reaches the final invoice as credit lines,
// never as the header discount. Measured before this existed: an offerte of EUR 1.000 @ 21% plus
// EUR 500 @ 9% with 10% korting and a 30% deposit billed EUR 1.626,89 over the two documents
// against EUR 1.579,50 agreed — EUR 47,39 too much, on a numbered invoice. A header discount is a
// share of the invoice's NET subtotal, and the settlement lines sit inside that subtotal; so the
// deposit, itself computed from the discounted amount, was discounted a second time, by exactly
// pct × deposit. A fixed-amount discount did not drift, which is why it survived a casual test.
// A credit line per rate group carries the exact euros applyDiscount would have removed from that
// group, so the final invoice's net per rate is the offerte's net per rate minus the deposit — and
// deposit + final = offerte, to the cent, in every rate. discountLines and depositLines read the
// same apportionment (allowanceByGroup), so the two documents cannot disagree about it.
//
// Run: npx tsx --test src/lib/aanbetaling.test.ts

import { round2 } from "./invoice-totals";
import { applyDiscount, discountLabel, lineNetEx, type Discount, type DiscountLine } from "./invoice-discount";

export interface DepositLine {
  description: string;
  quantity: number;
  unit_price: number;
  btw_rate: number;
  vat_treatment: "exempt" | null;
}

export interface OfferteSource {
  lines: (DiscountLine & { vat_treatment?: string | null })[];
  /** The offerte's document-level discount, already parsed. */
  discount: Discount | null;
  invoiceNumber: string | null;
}

/** A percentage the owner typed: a whole number from 1 to 99, or nothing. */
export function parseDepositPercent(raw: unknown): number | null {
  const s = typeof raw === "string" ? raw.trim().replace("%", "").replace(",", ".") : String(raw ?? "");
  if (!/^\d{1,2}(\.0+)?$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 99 ? n : null;
}

interface RateGroup { rate: number; exempt: boolean; net: number }

/** One group per (rate, exemption): an exempt 0% and a taxed 0% are different money on the aangifte. */
const groupKey = (rate: number, exempt: boolean): string => `${rate}|${exempt ? 1 : 0}`;

/** The offerte's rate groups, net after the LINE discounts only. */
function groupsOf(src: OfferteSource): Map<string, RateGroup> {
  const groups = new Map<string, RateGroup>();
  for (const l of src.lines) {
    const rate = Number(l.btw_rate) || 0;
    const exempt = l.vat_treatment === "exempt";
    const key = groupKey(rate, exempt);
    const g = groups.get(key) ?? { rate, exempt, net: 0 };
    g.net += lineNetEx(l);
    groups.set(key, g);
  }
  return groups;
}

/**
 * What the offerte's document discount takes off each group, in cents that sum to the allowance
 * per rate. invoice-discount allocates per RATE; an exempt group and a taxed 0% group share a rate
 * there, so that rate's allowance is split over the two pro rata, remainder on the smaller — the
 * rule applyDiscount itself uses, so the parts always add up to what the owner agreed.
 */
function allowanceByGroup(groups: Map<string, RateGroup>, src: OfferteSource): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of applyDiscount(src.lines, src.discount).allowances) {
    const same = [...groups.entries()]
      .filter(([, g]) => g.rate === a.rate && g.net > 0)
      .sort((x, y) => y[1].net - x[1].net);
    const total = same.reduce((s, [, g]) => s + g.net, 0);
    if (total <= 0) continue;
    let assigned = 0;
    same.forEach(([key, g], i) => {
      const part = i === same.length - 1 ? round2(a.amount - assigned) : round2((a.amount * g.net) / total);
      assigned = round2(assigned + part);
      if (part !== 0) out.set(key, round2((out.get(key) ?? 0) + part));
    });
  }
  return out;
}

/** The offerte's net excl. amount per btw rate, after line AND document discounts. */
function netByRate(src: OfferteSource): RateGroup[] {
  const groups = groupsOf(src);
  const off = allowanceByGroup(groups, src);
  return [...groups.entries()]
    .map(([key, g]) => ({ ...g, net: round2(g.net - (off.get(key) ?? 0)) }))
    .filter((g) => g.net > 0);
}

/** The deposit invoice's lines: one per rate group, `pct` of that group's net amount. */
export function depositLines(src: OfferteSource, pct: number): DepositLine[] {
  const nr = (src.invoiceNumber ?? "").trim();
  const head = nr ? `Aanbetaling ${pct}% op offerte ${nr}` : `Aanbetaling ${pct}%`;
  return netByRate(src).map((g): DepositLine => ({
    description: g.exempt ? `${head} (vrijgesteld)` : `${head} (${g.rate}% btw)`,
    quantity: 1,
    unit_price: round2((g.net * pct) / 100),
    btw_rate: g.rate,
    vat_treatment: g.exempt ? "exempt" : null,
  })).filter((l) => l.unit_price > 0);
}

/**
 * [AANBETALING-KORTING] The offerte's document discount as credit lines on the final invoice: one
 * per rate group, carrying exactly the euros applyDiscount removes from that group. Empty when the
 * offerte has no document discount. Line discounts are not here — they stay on the lines they
 * belong to, and travel with them.
 */
export function discountLines(src: OfferteSource): DepositLine[] {
  const label = discountLabel(src.discount);
  if (!label) return [];
  const groups = groupsOf(src);
  const off = allowanceByGroup(groups, src);
  const nr = (src.invoiceNumber ?? "").trim();
  const head = nr ? `${label} op offerte ${nr}` : label;
  const out: DepositLine[] = [];
  for (const [key, g] of groups) {
    const amount = off.get(key) ?? 0;
    if (amount <= 0) continue;
    out.push({
      description: g.exempt ? `${head} (vrijgesteld)` : `${head} (${g.rate}% btw)`,
      quantity: -1,
      unit_price: amount,
      btw_rate: g.rate,
      vat_treatment: g.exempt ? "exempt" : null,
    });
  }
  return out;
}

export interface IssuedDeposit {
  invoiceNumber: string | null;
  lines: { quantity?: number | null; unit_price?: number | null; line_total?: number | null; btw_rate?: number | null; vat_treatment?: string | null }[];
}

/**
 * The settlement lines on the final invoice: the mirror of every issued deposit, per rate group,
 * as a credit line (quantity −1). Sum of deposit + settlement is zero per rate, so the final
 * invoice charges the whole offerte's btw exactly once across the two documents.
 */
export function settlementLines(deposits: readonly IssuedDeposit[]): DepositLine[] {
  const out: DepositLine[] = [];
  for (const d of deposits) {
    const groups = new Map<string, RateGroup>();
    for (const l of d.lines) {
      const rate = Number(l.btw_rate) || 0;
      const exempt = l.vat_treatment === "exempt";
      const key = `${rate}|${exempt ? 1 : 0}`;
      const ex = typeof l.line_total === "number" ? l.line_total : (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
      const g = groups.get(key) ?? { rate, exempt, net: 0 };
      g.net += ex;
      groups.set(key, g);
    }
    const nr = (d.invoiceNumber ?? "").trim();
    const head = nr ? `Verrekening aanbetaling ${nr}` : "Verrekening aanbetaling";
    for (const g of groups.values()) {
      const amount = round2(g.net);
      if (amount <= 0) continue;
      out.push({
        description: g.exempt ? `${head} (vrijgesteld)` : `${head} (${g.rate}% btw)`,
        quantity: -1,
        unit_price: amount,
        btw_rate: g.rate,
        vat_treatment: g.exempt ? "exempt" : null,
      });
    }
  }
  return out;
}
