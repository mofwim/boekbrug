// src/lib/quarterly.ts
// [BOEK-013] Quarterly overview logic — May 2026
// [BOEK-FOUNDATION-TYPES] Null safety for DB-nullable fields — May 2026
// Pure functions — no DB calls — easy to test

export type BtwRate = number;

// [BOEK-FOUNDATION-TYPES] Interface reflects actual DB schema (nullable fields)
export interface InvoiceForQuarterly {
  id: string;
  invoice_number: string | null;
  client_name: string | null;
  status: string | null;
  direction: string; // 'outgoing' | 'incoming'
  total_ex_btw: number | null;
  btw_amount: number | null;
  total_inc_btw: number | null;
  btw_rate: number;
  invoice_date: string | null;
  due_date?: string;
}

export interface QuarterlyBtwBreakdown {
  rate: BtwRate;
  totalExcl: number;
  totalBtw: number;
}

// [BOEK-013] Full summary — used by accountant mode (unchanged)
export interface QuarterlySummary {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  label: string;
  totalExcl: number;
  totalBtw: number;
  totalIncl: number;
  paid: number;
  outstanding: number;
  overdue: number;
  invoiceCount: number;
  btwBreakdown: QuarterlyBtwBreakdown[];
  invoices: InvoiceForQuarterly[];
}

// [BOEK-013] Simplified ZZP summary — 4 numbers only, in + out
export interface ZzpQuarterlySummary {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  mode: 'paid' | 'all';
  totalIn: number;       // paid outgoing (money received by ZZP)
  totalOut: number;      // paid incoming (money paid by ZZP)
  totalBtwIn: number;    // BTW on outgoing invoices
  totalBtwOut: number;   // BTW on incoming invoices
}

/** Get quarter start date string for filtering */
export function quarterStartDate(year: number, q: 1 | 2 | 3 | 4): string {
  const month = (q - 1) * 3 + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Get quarter end date string for filtering */
export function quarterEndDate(year: number, q: 1 | 2 | 3 | 4): string {
  const month = q * 3;
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
}

/** Get the quarter (1-4) for a given date string */
export function getQuarter(date: string): 1 | 2 | 3 | 4 {
  const month = new Date(date).getMonth();
  return (Math.floor(month / 3) + 1) as 1 | 2 | 3 | 4;
}

// [BOEK-013] Build simplified ZZP summary — 4 numbers only
// mode='paid'  → outgoing:paid only + incoming:paid only
// mode='all'   → outgoing:paid+sent+overdue + incoming:paid+received  [BRIDGE-B: verified only]
// [BOEK-FOUNDATION-TYPES] Null-safe: incomplete invoices treated as 0
export function buildZzpSummary(
  invoices: InvoiceForQuarterly[],
  year: number,
  quarter: 1 | 2 | 3 | 4,
  mode: 'paid' | 'all'
): ZzpQuarterlySummary {
  const OUTGOING_STATUSES_ALL = ['paid', 'sent', 'overdue'];
  // [BRIDGE-B] 'processing' removed: unverified incoming invoices must NOT count
  // in quarterly totals (AI prepares, human confirms). 'all' = verified only.
  const INCOMING_STATUSES_ALL = ['paid', 'received'];

  let totalIn = 0;
  let totalOut = 0;
  let totalBtwIn = 0;
  let totalBtwOut = 0;

  for (const inv of invoices) {
    const isOutgoing = inv.direction === 'outgoing';
    const isIncoming = inv.direction === 'incoming';

    // [BOEK-FOUNDATION-TYPES] Safe defaults for nullable fields
    const incBtw = inv.total_inc_btw ?? 0;
    const btw = inv.btw_amount ?? 0;
    const status = inv.status ?? '';

    if (mode === 'paid') {
      if (isOutgoing && status === 'paid') {
        totalIn += incBtw;
        totalBtwIn += btw;
      }
      if (isIncoming && status === 'paid') {
        totalOut += incBtw;
        totalBtwOut += btw;
      }
    } else {
      // mode === 'all'
      if (isOutgoing && OUTGOING_STATUSES_ALL.includes(status)) {
        totalIn += incBtw;
        totalBtwIn += btw;
      }
      if (isIncoming && INCOMING_STATUSES_ALL.includes(status)) {
        totalOut += incBtw;
        totalBtwOut += btw;
      }
    }
  }

  return { year, quarter, mode, totalIn, totalOut, totalBtwIn, totalBtwOut };
}

/** Build a full QuarterlySummary — used by accountant mode */
// [BOEK-FOUNDATION-TYPES] Null-safe: incomplete invoices treated as 0
export function buildQuarterlySummary(
  invoices: InvoiceForQuarterly[],
  year: number,
  quarter: 1 | 2 | 3 | 4
): QuarterlySummary {
  const now = new Date();

  let totalExcl = 0;
  let totalBtw = 0;
  let totalIncl = 0;
  let paid = 0;
  let outstanding = 0;
  let overdue = 0;

  const btwMap = new Map<BtwRate, { excl: number; btw: number }>();

  for (const inv of invoices) {
    // [BOEK-FOUNDATION-TYPES] Safe defaults for nullable numeric fields
    const exBtw = inv.total_ex_btw ?? 0;
    const btw = inv.btw_amount ?? 0;
    const incBtw = inv.total_inc_btw ?? 0;

    totalExcl += exBtw;
    totalBtw += btw;
    totalIncl += incBtw;

    if (inv.status === 'paid') {
      paid += incBtw;
    } else if (inv.due_date && new Date(inv.due_date) < now) {
      overdue += incBtw;
    } else {
      outstanding += incBtw;
    }

    const existing = btwMap.get(inv.btw_rate) ?? { excl: 0, btw: 0 };
    btwMap.set(inv.btw_rate, {
      excl: existing.excl + exBtw,
      btw: existing.btw + btw,
    });
  }

  const btwBreakdown: QuarterlyBtwBreakdown[] = Array.from(btwMap.entries())
    .sort(([a], [b]) => b - a)
    .map(([rate, { excl, btw }]) => ({ rate, totalExcl: excl, totalBtw: btw }));

  return {
    year,
    quarter,
    label: `Q${quarter} ${year}`,
    totalExcl,
    totalBtw,
    totalIncl,
    paid,
    outstanding,
    overdue,
    invoiceCount: invoices.length,
    btwBreakdown,
    invoices,
  };
}

/** Format euros: 1234.5 → "€ 1.234,50" (Dutch locale) */
export function formatEur(amount: number): string {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}