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
// Run: npx tsx --test src/lib/aanbetaling.test.ts

import { round2 } from "./invoice-totals";
import { applyDiscount, lineNetEx, type Discount, type DiscountLine } from "./invoice-discount";

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

/** The offerte's net excl. amount per btw rate, after line AND document discounts. */
function netByRate(src: OfferteSource): RateGroup[] {
  const groups = new Map<string, RateGroup>();
  for (const l of src.lines) {
    const rate = Number(l.btw_rate) || 0;
    const exempt = l.vat_treatment === "exempt";
    const key = `${rate}|${exempt ? 1 : 0}`;
    const g = groups.get(key) ?? { rate, exempt, net: 0 };
    g.net += lineNetEx(l);
    groups.set(key, g);
  }
  // The document discount, as invoice-discount allocates it over the rate groups. An exempt group
  // and a taxed 0% group share the rate key there; both are 0% so the allocation is the same money.
  const allowances = applyDiscount(src.lines, src.discount).allowances;
  for (const a of allowances) {
    const same = [...groups.values()].filter((g) => g.rate === a.rate);
    const total = same.reduce((s, g) => s + g.net, 0);
    for (const g of same) g.net -= total > 0 ? (a.amount * g.net) / total : 0;
  }
  return [...groups.values()].map((g) => ({ ...g, net: round2(g.net) })).filter((g) => g.net > 0);
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
