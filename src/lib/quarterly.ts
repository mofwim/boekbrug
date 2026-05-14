// lib/quarterly.ts
// Quarterly overview logic (BOEK-013)
// Pure functions — no DB calls — easy to test

export type BtwRate = 0 | 9 | 21;

export interface InvoiceForQuarterly {
  id: string;
  invoice_number: string;
  client_name: string;
  status: string;
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
  btw_rate: BtwRate;
  invoice_date: string;
  due_date?: string;
}

export interface QuarterlyBtwBreakdown {
  rate: BtwRate;
  totalExcl: number;
  totalBtw: number;
}

export interface QuarterlySummary {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  label: string; // "Q1 2026"
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

/** Get the quarter (1-4) for a given date string */
export function getQuarter(date: string): 1 | 2 | 3 | 4 {
  const month = new Date(date).getMonth(); // 0-11
  return (Math.floor(month / 3) + 1) as 1 | 2 | 3 | 4;
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

/** Build a QuarterlySummary from a list of invoices */
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

    if (inv.status === "paid") {
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
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}
