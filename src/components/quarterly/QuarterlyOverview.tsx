// src/components/quarterly/QuarterlyOverview.tsx
// [BOEK-013] Quarterly Overview — simplified ZZP view — May 2026

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { QuarterlySummary, ZzpQuarterlySummary } from "@/lib/quarterly";
import { formatEur } from "@/lib/quarterly";
import { downloadCsv } from "@/lib/export";
import { useParentPath } from "@/lib/navigation-hooks";
import type { Role } from "@/lib/navigation";

const QUARTERS = [1, 2, 3, 4] as const;
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];
const CURRENT_QUARTER = Math.ceil((new Date().getMonth() + 1) / 3) as 1 | 2 | 3 | 4;

interface Client {
  id: string;
  full_name: string | null;
  company_name: string | null;
}

interface Props {
  isAccountant: boolean;
  // [BOEK-013] role passed from page.tsx for navigation helper
  role: Role;
}

export function QuarterlyOverview({ isAccountant, role }: Props) {
  return isAccountant ? <AccountantView role={role} /> : <ZzpView role={role} />;
}

// ─────────────────────────────────────────────────────────
// ZZP View
// ─────────────────────────────────────────────────────────
function ZzpView({ role }: { role: Role }) {
  const parentHref = useParentPath(role);
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(CURRENT_QUARTER);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [mode, setMode] = useState<"paid" | "all">("paid");
  const [data, setData] = useState<ZzpQuarterlySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    setData(null);
    const params = new URLSearchParams({
      year: String(year),
      quarter: String(quarter),
      mode,
    });
    fetch(`/api/quarterly?${params}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [quarter, year, mode]);

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ year: String(year), quarter: String(quarter) });
      const res = await fetch(`/api/export?${params}`);
      const csv = await res.text();
      downloadCsv(csv, `boekbrug-Q${quarter}-${year}.csv`);
    } finally {
      setExporting(false);
    }
  }

  const quarterLabel = ["", "Januari – Maart", "April – Juni", "Juli – September", "Oktober – December"][quarter];

  return (
    <div className="space-y-4 pb-8">

      {/* Back button — [BOEK-013] uses navigation helper */}
      <div className="px-1">
        <Link href={parentHref} className="inline-flex items-center gap-1.5 text-sm text-primary font-medium">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Dashboard
        </Link>
      </div>

      {/* Quarter + year selector */}
      <div className="bg-background border rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex bg-muted rounded-xl p-1 gap-1">
          {QUARTERS.map((q) => (
            <button
              key={q}
              onClick={() => setQuarter(q)}
              className={`flex-1 py-2 text-sm rounded-lg font-medium transition-all ${
                quarter === q
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              Q{q}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="flex-1 text-sm border rounded-xl px-3 py-2 bg-background font-medium focus:outline-none"
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          <button
            onClick={handleExport}
            disabled={exporting || !data}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl font-medium border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exporting ? "…" : "CSV"}
          </button>
        </div>
      </div>

      {/* [BOEK-013] Mode buttons — duidelijk actief/inactief onderscheid */}
      <div className="grid grid-cols-2 gap-3">

        {/* Betaald button */}
        <button
          onClick={() => setMode("paid")}
          className={`py-4 rounded-2xl text-sm font-bold border-2 transition-all ${
            mode === "paid"
              ? "bg-emerald-500 border-emerald-500 text-white shadow-md"
              : "bg-background border-muted text-muted-foreground"
          }`}
        >
          <span className="flex items-center justify-center gap-1.5">
            {mode === "paid" && (
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            )}
            Betaald
          </span>
          <span className={`block text-xs font-normal mt-1 ${mode === "paid" ? "text-emerald-100" : "text-muted-foreground"}`}>
            Ontvangen & betaald
          </span>
        </button>

        {/* Alles button */}
        <button
          onClick={() => setMode("all")}
          className={`py-4 rounded-2xl text-sm font-bold border-2 transition-all ${
            mode === "all"
              ? "bg-blue-500 border-blue-500 text-white shadow-md"
              : "bg-background border-muted text-muted-foreground"
          }`}
        >
          <span className="flex items-center justify-center gap-1.5">
            {mode === "all" && (
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            )}
            Alles
          </span>
          <span className={`block text-xs font-normal mt-1 ${mode === "all" ? "text-blue-100" : "text-muted-foreground"}`}>
            Incl. uitstaand
          </span>
        </button>

      </div>

      {loading && <ZzpSkeleton />}

      {!loading && data && (
        <>
          {/* Period title */}
          <div className="px-1">
            <p className="text-2xl font-bold tracking-tight">Q{quarter} {year}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{quarterLabel}</p>
          </div>

          {/* [BOEK-013] Inkomsten — label boven tabel beschrijft wat de cijfers zijn */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2 px-0.5">
              {mode === "paid"
                ? "Inkomsten — alleen betaalde facturen"
                : "Inkomsten — betaald én uitstaand"}
            </p>
            <div className="bg-background border-2 border-emerald-400 rounded-2xl overflow-hidden shadow-sm">
              <div className="grid grid-cols-2 divide-x divide-emerald-100 border-b border-emerald-100 bg-emerald-50">
                <div className="px-4 py-2.5">
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                    Inkomsten incl. BTW
                  </p>
                </div>
                <div className="px-4 py-2.5">
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                    BTW
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-emerald-100">
                <div className="px-4 py-5">
                  <p className="text-2xl font-bold tabular-nums text-emerald-700 leading-none">
                    {formatEur(data.totalIn)}
                  </p>
                </div>
                <div className="px-4 py-5">
                  <p className="text-2xl font-bold tabular-nums text-emerald-700 leading-none">
                    {formatEur(data.totalBtwIn)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* [BOEK-013] Uitgaven — label boven tabel beschrijft wat de cijfers zijn */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2 px-0.5">
              {mode === "paid"
                ? "Uitgaven — alleen betaalde facturen"
                : "Uitgaven — betaald én uitstaand"}
            </p>
            <div className="bg-background border-2 border-red-400 rounded-2xl overflow-hidden shadow-sm">
              <div className="grid grid-cols-2 divide-x divide-red-100 border-b border-red-100 bg-red-50">
                <div className="px-4 py-2.5">
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">
                    Uitgaven incl. BTW
                  </p>
                </div>
                <div className="px-4 py-2.5">
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">
                    BTW
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-red-100">
                <div className="px-4 py-5">
                  <p className="text-2xl font-bold tabular-nums text-red-700 leading-none">
                    {formatEur(data.totalOut)}
                  </p>
                </div>
                <div className="px-4 py-5">
                  <p className="text-2xl font-bold tabular-nums text-red-700 leading-none">
                    {formatEur(data.totalBtwOut)}
                  </p>
                </div>
              </div>
            </div>
          </div>

        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Accountant View — unchanged
// ─────────────────────────────────────────────────────────
function AccountantView({ role }: { role: Role }) {
  const parentHref = useParentPath(role);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(CURRENT_QUARTER);
  const [data, setData] = useState<QuarterlySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [clientsLoading, setClientsLoading] = useState(false);

  useEffect(() => {
    setClientsLoading(true);
    fetch("/api/quarterly/clients")
      .then((r) => r.json())
      .then((d) => {
        setClients(d ?? []);
        if (d?.length > 0) setSelectedClientId(d[0].id);
      })
      .finally(() => setClientsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedClientId) return;
    setLoading(true);
    setData(null);
    const params = new URLSearchParams({
      year: String(year),
      quarter: String(quarter),
      clientId: selectedClientId,
    });
    fetch(`/api/quarterly?${params}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [year, quarter, selectedClientId]);

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        year: String(year),
        quarter: String(quarter),
        clientId: selectedClientId,
      });
      const res = await fetch(`/api/export?${params}`);
      const csv = await res.text();
      downloadCsv(csv, `boekbrug-Q${quarter}-${year}.csv`);
    } finally {
      setExporting(false);
    }
  }

  if (!clientsLoading && clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <svg className="w-7 h-7 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <p className="text-sm font-medium mb-1">Geen klanten gekoppeld</p>
        <p className="text-xs text-muted-foreground mb-5">Nodig een klant uit om kwartaaloverzichten te bekijken</p>
        <a href="/dashboard/clients/invite" className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl">
          Klant uitnodigen
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="px-1">
        <Link href={parentHref} className="inline-flex items-center gap-1.5 text-sm text-primary font-medium">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Dashboard
        </Link>
      </div>

      {clients.length > 0 && (
        <div className="bg-background border rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Klant</p>
          </div>
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="w-full px-4 py-3.5 text-sm font-medium bg-background appearance-none focus:outline-none"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name ?? c.full_name ?? "Onbekend"}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="bg-background border rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex bg-muted rounded-xl p-1 gap-1">
          {QUARTERS.map((q) => (
            <button
              key={q}
              onClick={() => setQuarter(q)}
              className={`flex-1 py-2 text-sm rounded-lg font-medium transition-all ${
                quarter === q ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              Q{q}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="flex-1 text-sm border rounded-xl px-3 py-2 bg-background font-medium focus:outline-none"
          >
            {YEARS.map((y) => (<option key={y} value={y}>{y}</option>))}
          </select>
          <button
            onClick={handleExport}
            disabled={exporting || !data || (data?.invoiceCount ?? 0) === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl font-medium border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exporting ? "…" : "CSV"}
          </button>
        </div>
      </div>

      {loading && <AccountantSkeleton />}

      {!loading && data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <SummaryCard label="Excl. BTW" value={formatEur(data.totalExcl)} accent="default" />
            <SummaryCard label="Totaal BTW" value={formatEur(data.totalBtw)} accent="default" />
            <SummaryCard label="Betaald" value={formatEur(data.paid)} accent="green" />
            <SummaryCard
              label="Openstaand"
              value={formatEur((data.outstanding ?? 0) + (data.overdue ?? 0))}
              accent={(data.overdue ?? 0) > 0 ? "red" : "default"}
              sub={(data.overdue ?? 0) > 0 ? `${formatEur(data.overdue)} te laat` : undefined}
            />
          </div>

          {(data.btwBreakdown?.length ?? 0) > 0 && (
            <div className="bg-background border rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold">BTW aangifte Q{quarter} {year}</h3>
              </div>
              <div className="divide-y">
                {data.btwBreakdown.map((b) => (
                  <div key={b.rate} className="flex items-center justify-between px-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium">BTW {b.rate}%</p>
                      <p className="text-xs text-muted-foreground mt-0.5">over {formatEur(b.totalExcl)}</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{formatEur(b.totalBtw)}</p>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-3.5 bg-muted/30">
                  <p className="text-sm font-semibold">Totaal BTW</p>
                  <p className="text-sm font-bold tabular-nums">{formatEur(data.totalBtw)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-background border rounded-2xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Facturen <span className="text-muted-foreground font-normal">({data.invoiceCount})</span>
              </h3>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Betaald</span>
            </div>
            {(data.invoices?.length ?? 0) === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground">Geen facturen in Q{quarter} {year}</p>
              </div>
            ) : (
              <div className="divide-y">
                {data.invoices.map((inv) => (
                  <a
                    key={inv.id}
                    href={`/dashboard/invoice/${inv.id}`}
                    className="flex items-center justify-between px-4 py-3.5 active:bg-muted/60 transition-colors"
                  >
                    <div className="min-w-0 flex-1 mr-3">
                      <p className="text-sm font-medium truncate">{inv.invoice_number}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{inv.client_name}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <p className="text-sm font-semibold tabular-nums">{formatEur(inv.total_inc_btw ?? 0)}</p>
                      <StatusBadge status={inv.status ?? "draft"} />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────

function SummaryCard({ label, value, accent, sub }: {
  label: string;
  value: string;
  accent: "default" | "green" | "red";
  sub?: string;
}) {
  const accentClass = accent === "green" ? "text-green-600" : accent === "red" ? "text-red-600" : "text-foreground";
  return (
    <div className="bg-background border rounded-2xl px-4 py-3.5 shadow-sm">
      <p className="text-xs text-muted-foreground mb-1.5">{label}</p>
      <p className={`text-lg font-bold tabular-nums leading-tight ${accentClass}`}>{value}</p>
      {sub && <p className="text-xs text-red-500 mt-1">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: "bg-green-100 text-green-700",
    sent: "bg-blue-100 text-blue-700",
    draft: "bg-muted text-muted-foreground",
    overdue: "bg-red-100 text-red-700",
  };
  const labels: Record<string, string> = {
    paid: "Betaald",
    sent: "Verzonden",
    draft: "Concept",
    overdue: "Te laat",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {labels[status] ?? status}
    </span>
  );
}

function ZzpSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-8 w-32 rounded-lg animate-pulse bg-muted" />
      <div className="h-[110px] rounded-2xl border animate-pulse bg-muted" />
      <div className="h-[110px] rounded-2xl border animate-pulse bg-muted" />
    </div>
  );
}

function AccountantSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="border rounded-2xl h-[72px] animate-pulse bg-muted" />
        ))}
      </div>
      <div className="h-40 rounded-2xl border animate-pulse bg-muted" />
    </div>
  );
}