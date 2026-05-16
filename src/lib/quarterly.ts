// src/lib/quarterly.ts
// [BOEK-013] Quarterly overview logic — May 2026
// Pure functions — no DB calls — easy to test

export type BtwRate = number;

export interface InvoiceForQuarterly {
  id: string;
  invoice_number: string;
  client_name: string;
  status: string;
  direction: string; // 'outgoing' | 'incoming'
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
  btw_rate: number;
  invoice_date: string;
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
// mode='all'   → outgoing:paid+sent+overdue + incoming:paid+received+processing
export function buildZzpSummary(
  invoices: InvoiceForQuarterly[],
  year: number,
  quarter: 1 | 2 | 3 | 4,
  mode: 'paid' | 'all'
): ZzpQuarterlySummary {
  const OUTGOING_STATUSES_ALL = ['paid', 'sent', 'overdue'];
  const INCOMING_STATUSES_ALL = ['paid', 'received', 'processing'];

  let totalIn = 0;
  let totalOut = 0;
  let totalBtwIn = 0;
  let totalBtwOut = 0;

  for (const inv of invoices) {
    const isOutgoing = inv.direction === 'outgoing';
    const isIncoming = inv.direction === 'incoming';

    if (mode === 'paid') {
      if (isOutgoing && inv.status === 'paid') {
        totalIn += inv.total_inc_btw;
        totalBtwIn += inv.btw_amount;
      }
      if (isIncoming && inv.status === 'paid') {
        totalOut += inv.total_inc_btw;
        totalBtwOut += inv.btw_amount;
      }
    } else {
      // mode === 'all'
      if (isOutgoing && OUTGOING_STATUSES_ALL.includes(inv.status)) {
        totalIn += inv.total_inc_btw;
        totalBtwIn += inv.btw_amount;
      }
      if (isIncoming && INCOMING_STATUSES_ALL.includes(inv.status)) {
        totalOut += inv.total_inc_btw;
        totalBtwOut += inv.btw_amount;
      }
    }
  }

  return { year, quarter, mode, totalIn, totalOut, totalBtwIn, totalBtwOut };
}

/** Build a full QuarterlySummary — used by accountant mode (unchanged) */
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
    totalExcl += inv.total_ex_btw;
    totalBtw += inv.btw_amount;
    totalIncl += inv.total_inc_btw;

    if (inv.status === 'paid') {
      paid += inv.total_inc_btw;
    } else if (inv.due_date && new Date(inv.due_date) < now) {
      overdue += inv.total_inc_btw;
    } else {
      outstanding += inv.total_inc_btw;
    }

    const existing = btwMap.get(inv.btw_rate) ?? { excl: 0, btw: 0 };
    btwMap.set(inv.btw_rate, {
      excl: existing.excl + inv.total_ex_btw,
      btw: existing.btw + inv.btw_amount,
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