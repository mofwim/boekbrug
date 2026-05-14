// components/quarterly/QuarterlyOverview.tsx
// Quarterly financial overview (BOEK-013 + BOEK-014 export trigger)

"use client";

import { useEffect, useState } from "react";
import type { QuarterlySummary } from "@/lib/quarterly";
import { formatEur } from "@/lib/quarterly";
import { downloadCsv } from "@/lib/export";

const QUARTERS = [1, 2, 3, 4] as const;
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

export function QuarterlyOverview() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(
    Math.ceil((new Date().getMonth() + 1) / 3) as 1 | 2 | 3 | 4
  );
  const [data, setData] = useState<QuarterlySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/quarterly?year=${year}&quarter=${quarter}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [year, quarter]);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(`/api/export?year=${year}&quarter=${quarter}`);
      const csv = await res.text();
      downloadCsv(csv, `boekbrug-Q${quarter}-${year}.csv`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {QUARTERS.map((q) => (
            <button
              key={q}
              onClick={() => setQuarter(q)}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                quarter === q
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Q{q}
            </button>
          ))}
        </div>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="text-sm border rounded-md px-3 py-1.5 bg-background"
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <button
          onClick={handleExport}
          disabled={exporting || !data || data.invoiceCount === 0}
          className="ml-auto flex items-center gap-2 px-4 py-1.5 text-sm font-medium border rounded-md hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {exporting ? "Exporteren…" : "Exporteer CSV"}
        </button>
      </div>

      {loading && <OverviewSkeleton />}

      {!loading && data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="Totaal excl. BTW"
              value={formatEur(data.totalExcl)}
              accent="default"
            />
            <SummaryCard
              label="Totaal BTW"
              value={formatEur(data.totalBtw)}
              accent="default"
            />
            <SummaryCard
              label="Betaald"
              value={formatEur(data.paid)}
              accent="green"
            />
            <SummaryCard
              label="Openstaand"
              value={formatEur(data.outstanding + data.overdue)}
              accent={data.overdue > 0 ? "red" : "default"}
              sub={data.overdue > 0 ? `${formatEur(data.overdue)} te laat` : undefined}
            />
          </div>

          {/* BTW breakdown */}
          {data.btwBreakdown.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/50">
                <h3 className="text-sm font-medium">BTW overzicht</h3>
              </div>
              <div className="divide-y">
                {data.btwBreakdown.map((b) => (
                  <div
                    key={b.rate}
                    className="flex items-center justify-between px-4 py-3 text-sm"
                  >
                    <span className="text-muted-foreground">BTW {b.rate}%</span>
                    <div className="text-right">
                      <p className="font-medium">{formatEur(b.totalBtw)}</p>
                      <p className="text-xs text-muted-foreground">
                        over {formatEur(b.totalExcl)}
                      </p>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-3 text-sm font-medium bg-muted/30">
                  <span>Totaal BTW</span>
                  <span>{formatEur(data.totalBtw)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Invoice list */}
          {data.invoices.length === 0 ? (
            <p className="text-center text-muted-foreground py-12 text-sm">
              Geen facturen in Q{quarter} {year}
            </p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/50 flex justify-between items-center">
                <h3 className="text-sm font-medium">
                  Facturen ({data.invoiceCount})
                </h3>
              </div>
              <div className="divide-y">
                {data.invoices.map((inv) => (
                  <a
                    key={inv.id}
                    href={`/dashboard/invoice/${inv.id}`}
                    className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50 transition-colors"
                  >
                    <div>
                      <p className="font-medium">{inv.invoice_number}</p>
                      <p className="text-muted-foreground text-xs">{inv.client_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{formatEur(inv.total_inc_btw)}</p>
                      <StatusBadge status={inv.status} />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string;
  accent: "default" | "green" | "red";
  sub?: string;
}) {
  const accentClass =
    accent === "green"
      ? "text-green-600"
      : accent === "red"
      ? "text-red-600"
      : "text-foreground";

  return (
    <div className="border rounded-lg px-4 py-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-lg font-semibold ${accentClass}`}>{value}</p>
      {sub && <p className="text-xs text-red-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: "text-green-600",
    sent: "text-blue-600",
    draft: "text-muted-foreground",
    overdue: "text-red-600",
  };
  const labels: Record<string, string> = {
    paid: "Betaald",
    sent: "Verzonden",
    draft: "Concept",
    overdue: "Te laat",
  };
  return (
    <span className={`text-xs font-medium ${map[status] ?? "text-muted-foreground"}`}>
      {labels[status] ?? status}
    </span>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="border rounded-lg px-4 py-3 h-20 animate-pulse bg-muted" />
        ))}
      </div>
      <div className="h-40 rounded-lg border animate-pulse bg-muted" />
    </div>
  );
}
