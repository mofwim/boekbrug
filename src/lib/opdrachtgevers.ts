// src/lib/opdrachtgevers.ts
// [OPDRACHTGEVER] Who this year's money came from, per opdrachtgever.
//
// ── WHY THIS EXISTS ──
//
// Since 1 January 2025 the Belastingdienst enforces the Wet DBA again. The enforcement is aimed at
// the OPDRACHTGEVER, which is why clients drop zzp'ers; what the zzp'er risks themselves is the
// zelfstandigenaftrek and the mkb-winstvrijstelling, retroactively. In that assessment the Hoge
// Raad counts extern ondernemerschap — how many clients, whose rate, whose acquisition, whose
// investments — as a full factor.
//
// Every figure that answers "how many clients, and how big is the biggest" is already in this
// app's own invoices, and no bookkeeping package shows it. So this module adds them up. That is
// all it does.
//
// ── WHAT IT REFUSES TO DO ──
//
// It does not judge. There is no threshold in this file, no colour, no verdict, because there is
// no rule to check against: "70% from one client" and "you need three clients" are VAR-era
// folklore, not law, and printing either as a limit would be a confident wrong answer about
// somebody's largest deduction. The screen states the facts and says, once, that the assessment
// weighs more than these numbers.
//
// Pure. Run: npx tsx --test src/lib/opdrachtgevers.test.ts

import { round2 } from "./invoice-totals";
import { foldText } from "./search";

export interface OpdrachtgeverInvoice {
  client_id: string | null;
  client_name: string | null;
  /** Ex btw, signed: a creditnota is stored negative and nets against the client's revenue. */
  total_ex_btw: number | null;
  invoice_date: string | null;
}

export interface OpdrachtgeverHours {
  client_id: string | null;
  hours: number | null;
}

export interface OpdrachtgeverRow {
  /** client_id when the invoice carries one, else the folded name — the app's usual pairing. */
  key: string;
  name: string;
  /** Ex btw, credit notes netted. */
  revenue: number;
  /** Percentage of the year's revenue, one decimal. Null when the year's revenue is zero. */
  share: number | null;
  /** Hours written on this client this year — every hour, billable or not. */
  hours: number;
  invoices: number;
  firstInvoice: string | null;
  lastInvoice: string | null;
}

export interface OpdrachtgeverYear {
  year: number;
  /** The year's revenue ex btw over all opdrachtgevers. */
  revenue: number;
  /** How many opdrachtgevers this year's revenue came from. */
  clients: number;
  /** Newest first by revenue. */
  rows: OpdrachtgeverRow[];
  /** The share of the largest one, or null when there is no revenue to divide. */
  largestShare: number | null;
}

/** An invoice's key: its client link, else its name folded — the same pairing the customer card uses. */
function keyOf(iv: OpdrachtgeverInvoice): string | null {
  if (iv.client_id) return iv.client_id;
  const name = (iv.client_name ?? "").trim();
  return name ? `name:${foldText(name)}` : null;
}

export function opdrachtgeverYear(args: {
  year: number;
  invoices: readonly OpdrachtgeverInvoice[];
  hours: readonly OpdrachtgeverHours[];
}): OpdrachtgeverYear {
  const hoursByClient = new Map<string, number>();
  for (const h of args.hours) {
    if (!h.client_id) continue;
    hoursByClient.set(h.client_id, (hoursByClient.get(h.client_id) ?? 0) + (Number(h.hours) || 0));
  }

  const byKey = new Map<string, OpdrachtgeverRow>();
  for (const iv of args.invoices) {
    const key = keyOf(iv);
    if (!key) continue;
    // An amount that is not there is not zero: Number(null) is 0 and would count a real invoice
    // as a client with no revenue, which is the one direction this screen may not be wrong in.
    if (iv.total_ex_btw === null || iv.total_ex_btw === undefined) continue;
    const amount = Number(iv.total_ex_btw);
    if (!Number.isFinite(amount)) continue;
    const row = byKey.get(key) ?? {
      key, name: (iv.client_name ?? "").trim() || "—",
      revenue: 0, share: null, hours: hoursByClient.get(key) ?? 0, invoices: 0,
      firstInvoice: null, lastInvoice: null,
    };
    row.revenue += amount;
    row.invoices += 1;
    const day = iv.invoice_date ?? null;
    if (day) {
      if (!row.firstInvoice || day < row.firstInvoice) row.firstInvoice = day;
      if (!row.lastInvoice || day > row.lastInvoice) row.lastInvoice = day;
    }
    byKey.set(key, row);
  }

  const rows = [...byKey.values()].map((r) => ({ ...r, revenue: round2(r.revenue), hours: round2(r.hours) }));
  const revenue = round2(rows.reduce((s, r) => s + r.revenue, 0));
  // The share is of the POSITIVE total: a year whose revenue nets to zero or below has no
  // percentages to state, and a share against a negative divisor would print a minus that means
  // nothing. Null there, never a number the owner cannot read.
  for (const r of rows) r.share = revenue > 0 ? Math.round((r.revenue / revenue) * 1000) / 10 : null;
  rows.sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "nl"));
  return {
    year: args.year,
    revenue,
    clients: rows.length,
    rows,
    largestShare: rows.length > 0 ? rows[0].share : null,
  };
}
