"use client";

// components/export/ExportMenu.tsx
// [BOEK-014] Export dropdown — May 2026
// Handles: CSV (quarter/year/all-clients), PDF BTW aangifte, PDF factuuroverzicht, bank file parse
// Usage: <ExportMenu year={2026} quarter={1} isAccountant={false} />

import { useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExportFormat = "csv-quarter" | "csv-year" | "csv-all-clients" | "pdf-btw" | "pdf-list";
type UploadState = "idle" | "uploading" | "done" | "error";
type ExportState = "idle" | "loading" | "done" | "error";

interface ExportMenuProps {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  /** Optional: filter by status before export */
  statusFilter?: string;
  // [BOEK-014] new props for accountant mode
  isAccountant?: boolean;
  selectedClientId?: string;
  disabled?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExportMenu({
  year,
  quarter,
  statusFilter,
  isAccountant = false,
  selectedClientId,
  disabled = false,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadResult, setUploadResult] = useState<UploadResultData | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Export handler ───────────────────────────────────────────────────────────

  async function handleExport(format: ExportFormat) {
    setOpen(false);
    setExportState("loading");

    try {
      const params = new URLSearchParams({ year: String(year) });
      if (statusFilter) params.set("status", statusFilter);

      let url: string;
      let filename: string;

      if (format === "csv-quarter") {
        params.set("quarter", String(quarter));
        if (isAccountant && selectedClientId) params.set("clientId", selectedClientId);
        filename = `boekbrug-facturen-Q${quarter}-${year}.csv`;
        url = `/api/export?${params}`;

      } else if (format === "csv-year") {
        if (isAccountant && selectedClientId) params.set("clientId", selectedClientId);
        filename = `boekbrug-facturen-${year}.csv`;
        url = `/api/export?${params}`;

      } else if (format === "csv-all-clients") {
        // [BOEK-014] accountant: all linked clients in one CSV
        params.set("quarter", String(quarter));
        params.set("accountant", "true");
        filename = `boekbrug-klanten-Q${quarter}-${year}.csv`;
        url = `/api/export?${params}`;

      } else if (format === "pdf-btw") {
        params.set("format", "pdf-btw");
        params.set("scope", "quarter");
        params.set("quarter", String(quarter));
        if (isAccountant && selectedClientId) params.set("clientId", selectedClientId);
        filename = `boekbrug-btw-aangifte-Q${quarter}-${year}.pdf`;
        url = `/api/export?${params}`;

      } else {
        // pdf-list
        params.set("format", "pdf-list");
        params.set("scope", "quarter");
        params.set("quarter", String(quarter));
        if (isAccountant && selectedClientId) params.set("clientId", selectedClientId);
        filename = `boekbrug-factuuroverzicht-Q${quarter}-${year}.pdf`;
        url = `/api/export?${params}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Export mislukt");
      }

      const blob = await res.blob();
      triggerDownload(blob, filename);
      setExportState("done");
    } catch (err) {
      console.error("[BOEK-014] Export error:", err);
      setExportState("error");
    } finally {
      setTimeout(() => setExportState("idle"), 3000);
    }
  }

  // ── Bank file upload ─────────────────────────────────────────────────────────

  async function handleBankFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setOpen(false);
    setUploadState("uploading");
    setUploadResult(null);
    setUploadError(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/export", { method: "POST", body: form });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error ?? "Verwerking mislukt");

      setUploadResult(json);
      setUploadState("done");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Onbekende fout");
      setUploadState("error");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── Button label ─────────────────────────────────────────────────────────────

  const buttonLabel =
    exportState === "loading"
      ? "Bezig..."
      : exportState === "done"
      ? "Gedownload ✓"
      : exportState === "error"
      ? "Fout ✗"
      : "Exporteer";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={exportState === "loading" || disabled}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
      >
        {exportState === "loading" ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
        ) : (
          <DownloadIcon />
        )}
        {buttonLabel}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />

          <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-gray-100 bg-white shadow-xl">
            <div className="p-1.5">

              {/* CSV section */}
              <SectionLabel>📄 CSV</SectionLabel>
              <MenuItem onClick={() => handleExport("csv-quarter")}>
                Dit kwartaal — Q{quarter} {year}
              </MenuItem>
              <MenuItem onClick={() => handleExport("csv-year")}>
                Heel jaar — {year}
              </MenuItem>

              {/* [BOEK-014] Accountant only: all clients */}
              {isAccountant && (
                <MenuItem onClick={() => handleExport("csv-all-clients")}>
                  Alle klanten — Q{quarter} {year}
                </MenuItem>
              )}

              <Divider />

              {/* PDF section */}
              <SectionLabel>📋 PDF</SectionLabel>
              <MenuItem onClick={() => handleExport("pdf-btw")}>
                BTW aangifte Q{quarter} {year}
              </MenuItem>
              <MenuItem onClick={() => handleExport("pdf-list")}>
                Factuuroverzicht Q{quarter} {year}
              </MenuItem>

              <Divider />

              {/* Bank file section */}
              <SectionLabel>🏦 Bankbestand</SectionLabel>
              <MenuItem
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadState === "uploading"}
              >
                {uploadState === "uploading"
                  ? "Bezig met verwerken..."
                  : "MT940 / CAMT.053 inlezen"}
              </MenuItem>

            </div>
          </div>
        </>
      )}

      {/* Hidden file input for bank upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mt940,.sta,.txt,.xml,.camt"
        className="hidden"
        onChange={handleBankFile}
      />

      {/* Bank parse result panel */}
      {uploadState === "done" && uploadResult && (
        <BankResultPanel
          result={uploadResult}
          onClose={() => {
            setUploadState("idle");
            setUploadResult(null);
          }}
        />
      )}

      {/* Bank parse error */}
      {uploadState === "error" && uploadError && (
        <div className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {uploadError}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
      {children}
    </p>
  );
}

function Divider() {
  return <div className="my-1 border-t border-gray-100" />;
}

function MenuItem({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v8M5 7l3 3 3-3M2 12h12" />
    </svg>
  );
}

// ─── Bank result panel ────────────────────────────────────────────────────────

interface UploadResultData {
  format: "MT940" | "CAMT053";
  accountIban: string | null;
  accountName: string | null;
  transactionCount: number;
  summary: {
    totalCredits: number;
    totalDebits: number;
    creditCount: number;
    debitCount: number;
    dateFrom: string | null;
    dateTo: string | null;
  };
  parseErrors: string[];
}

function BankResultPanel({
  result,
  onClose,
}: {
  result: UploadResultData;
  onClose: () => void;
}) {
  const eur = (n: number) =>
    n.toLocaleString("nl-NL", { style: "currency", currency: "EUR" });

  return (
    <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-gray-100 bg-white shadow-xl">
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {result.format} ingelezen
            </p>
            {result.accountIban && (
              <p className="text-xs text-gray-400">{result.accountIban}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Stat label="Transacties" value={String(result.transactionCount)} />
          <Stat
            label="Periode"
            value={
              result.summary.dateFrom
                ? `${fmtDate(result.summary.dateFrom)} – ${fmtDate(result.summary.dateTo)}`
                : "—"
            }
          />
          <Stat
            label={`Ontvangen (${result.summary.creditCount}×)`}
            value={eur(result.summary.totalCredits)}
            positive
          />
          <Stat
            label={`Betaald (${result.summary.debitCount}×)`}
            value={eur(result.summary.totalDebits)}
            negative
          />
        </div>

        {result.parseErrors.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2">
            <p className="text-xs font-medium text-amber-700">
              {result.parseErrors.length} waarschuwing(en)
            </p>
            {result.parseErrors.slice(0, 3).map((e, i) => (
              <p key={i} className="mt-0.5 text-xs text-amber-600">{e}</p>
            ))}
          </div>
        )}

        <p className="mt-3 text-xs text-gray-400">
          Koppeling met facturen komt in de volgende update.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <p className="text-xs text-gray-400">{label}</p>
      <p
        className={`mt-0.5 text-sm font-semibold ${
          positive ? "text-green-600" : negative ? "text-red-500" : "text-gray-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nl-NL");
}