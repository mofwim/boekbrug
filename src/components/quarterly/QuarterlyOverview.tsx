// src/components/quarterly/QuarterlyOverview.tsx
// [BOEK-013] Quarterly Overview — simplified ZZP view — May 2026

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { QuarterlySummary, ZzpQuarterlySummary } from "@/lib/quarterly";
import { formatEur } from "@/lib/quarterly";
import { downloadCsv } from "@/lib/export";
import { useParentPath } from "@/lib/navigation-hooks";
import type { Role } from "@/lib/navigation";
import { quarterFromParams } from "@/lib/quarter";
// [TZ] The filing date pinned to Europe/Amsterdam — a legal record's date is the record.
import { formatDateNL } from "@/lib/format-nl";
import { useToast } from "@/components/ui/Toast";
import { statusLabel } from '@/lib/invoice-status'
import { useLocale } from '@/lib/i18n/use-locale'

const QUARTERS = [1, 2, 3, 4] as const;
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

/**
 * The year options, guaranteed to contain the SELECTED year. The list is a fixed three-year window,
 * and ?year now seeds the selection — so a link (or a bookmark) naming an older year would set a
 * state the dropdown has no option for, leaving the select visually blank while the figures below
 * it were correct. Widening the list to include it keeps the control honest about what it is showing.
 */
function yearOptions(selected: number): number[] {
  return YEARS.includes(selected) ? YEARS : [...YEARS, selected].sort((a, b) => b - a);
}
/**
 * [QUARTER-DEEPLINK] Honour ?year&quarter when another screen linked us to a SPECIFIC period.
 *
 * [QUARTER-DEFAULT] With no params: the LAST COMPLETED quarter — the one whose BTW is actually due
 * — exactly like /api/result, /api/aangifte, /api/readiness and the klaar flow (quarter.ts). An
 * open-quarter default drops the owner on a partial quarter and disagrees with every other surface.
 *
 * This screen only ever read module constants, so the URL was decoration: the waarheid
 * surface renders "Naar de BTW-aangifte van deze periode" with ?year&quarter on it, and landing
 * here from the Dit-kwartaal lens silently opened the PREVIOUS quarter instead. Same numbers,
 * different period, no indication anything had moved — precisely the class of bug quarter.ts was
 * written to end ("a link from one to another never lands on a different quarter").
 *
 * quarterFromParams is the shared validator every quarter route uses (bounds 2000–2100, Q1–Q4) and
 * falls back to the last COMPLETED quarter, so a bare visit behaves exactly as before.
 */
function useQuarterFromUrl(): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const sp = useSearchParams();
  const { year, quarter } = quarterFromParams((k) => sp.get(k));
  return { year, quarter };
}

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
  const toast = useToast();
  const parentHref = useParentPath(role);
  // [QUARTER-DEEPLINK] Seed from ?year&quarter (the link that sent us here), else the shared
  // last-completed-quarter default. Lazy initial state only: the selector below stays fully in the
  // owner's hands afterwards — a link chooses the starting period, it does not lock it.
  const urlPeriod = useQuarterFromUrl();
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(urlPeriod.quarter);
  const [year, setYear] = useState(urlPeriod.year);
  const [mode, setMode] = useState<"paid" | "all">("paid");
  const [data, setData] = useState<ZzpQuarterlySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [packaging, setPackaging] = useState(false); // [CLOSING-PACKAGE]
  // [TRUST-OWNER] The RECONCILED figures (invoices + bank + cash + card takings) — the SAME source
  // as the accountant view, the closing package and /api/aangifte. For a retail shop most omzet is
  // pin/contant with NO invoice, so the invoices-only /api/quarterly totals (data.totalIn) show a
  // fraction of the real omzet and must never be presented as the Q2 aangifte. null → show "…".
  const [recon, setRecon] = useState<{
    omzet: number; verschuldigd: number; voorbelasting: number; saldo: number;
    salesByRate: { rate: number; omzet: number; btw: number }[];
    // [HONESTY] Carried so the "BTW te betalen (5g)" tile can never read silently too low —
    // omzet booked with no rate (cashOmzetZonderBtw) and verified-but-dateless invoices both
    // leave the reconciled figure incomplete; surface them here exactly as Resultaat does.
    cashOmzetZonderBtw: number; datelessVerifiedCount: number;
  } | null>(null);
  // [TRUTH-FILED] Filing state for THIS quarter: is it marked ingediend, and has the live truth
  // diverged since (→ carry-forward vs suppletie). Read-only here — see [ONE-FILING-DOOR] below.
  const [filed, setFiled] = useState<{
    filedAt: string;
    divergence: { changed: boolean; btwSaldoDelta: number; needsSuppletie: boolean };
  } | null>(null);
  // [FILING-NO-OVERWRITE] `filed === null` used to mean two things — "not filed" and "we could not
  // read it" — and the second one puts the file button back on screen, where one tap replaces a
  // frozen snapshot. Kept apart, so an unreadable state disables the button instead of inviting it.
  const [filedUnknown, setFiledUnknown] = useState(false);

  useEffect(() => {
    void (async () => {
      // Reset binnen de async-wikkel, vóór de eerste await: dezelfde tick als voorheen,
      // zonder synchrone setState in de effect-body.
      setLoading(true);
      setData(null);
      setRecon(null);
    })();
    const params = new URLSearchParams({
      year: String(year),
      quarter: String(quarter),
      mode,
    });
    // [NAN-GUARD] Only store a real summary — an error body ({error}) would otherwise become
    // `data` and render "€ NaN" in the Facturen tiles. On a bad response leave data null (→ the
    // loading/empty state), never a broken figure shown as data.
    fetch(`/api/quarterly?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d && !d.error ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));

    // [TRUST-OWNER] Reconciled omzet + BTW in parallel — accrual (invoice date), all channels,
    // independent of the paid/all mode. This is the real Q2 number the owner files.
    const rparams = new URLSearchParams({ year: String(year), quarter: String(quarter) });
    (async () => {
      try {
        const [rRes, aRes] = await Promise.all([
          fetch(`/api/result?${rparams}`),
          fetch(`/api/aangifte?${rparams}`),
        ]);
        if (!rRes.ok || !aRes.ok) return;
        const r = await rRes.json();
        const a = await aRes.json();
        const omzet = Number(r?.result?.omzet);
        const verschuldigd = Number(a?.aangifte?.verschuldigd);
        const voorbelasting = Number(a?.aangifte?.voorbelasting);
        const saldo = Number(a?.aangifte?.saldo);
        const salesByRate = Array.isArray(r?.result?.salesByRate) ? r.result.salesByRate : [];
        const cashOmzetZonderBtw = Number(r?.result?.cashOmzetZonderBtw) || 0;
        const datelessVerifiedCount = Number(r?.datelessVerifiedCount) || 0;
        if ([omzet, verschuldigd, voorbelasting, saldo].every(Number.isFinite)) {
          setRecon({ omzet, verschuldigd, voorbelasting, saldo, salesByRate, cashOmzetZonderBtw, datelessVerifiedCount });
        }
      } catch { /* leave recon null → the owner sees "…", never a wrong number */ }
    })();
  }, [quarter, year, mode]);

  // [TRUTH-FILED] Load whether this quarter is marked ingediend + any divergence since.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Reset binnen de async-wikkel, vóór de eerste await: dezelfde tick als voorheen,
      // zonder synchrone setState in de effect-body.
      setFiled(null);
      setFiledUnknown(false);
      try {
        const res = await fetch(`/api/btw/file?year=${year}&quarter=${quarter}`);
        // [FILING-NO-OVERWRITE] A failed lookup is not "niet ingediend". Both of these paths used
        // to leave `filed` null and say nothing, which is the state that offers to file again.
        if (!res.ok) { if (!cancelled) setFiledUnknown(true); return; }
        const j = await res.json();
        if (!cancelled && j?.ok) setFiled(j.filed ?? null);
        else if (!cancelled) setFiledUnknown(true);
      } catch { if (!cancelled) setFiledUnknown(true); }
    })();
    return () => { cancelled = true; };
  }, [quarter, year]);


  // [CLOSING-PACKAGE] Download the full quarterly package (ZIP) for the accountant.
  async function handlePackageExport() {
    setPackaging(true);
    try {
      const params = new URLSearchParams({ year: String(year), quarter: String(quarter) });
      const res = await fetch(`/api/closing-package?${params}`);
      if (!res.ok) {
        toast("Pakket genereren mislukt — probeer opnieuw", { tone: "error" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kwartaalpakket-Q${quarter}-${year}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast("Pakket genereren mislukt — controleer je verbinding", { tone: "error" });
    } finally {
      setPackaging(false);
    }
  }

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
            {yearOptions(year).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          <button
            onClick={handleExport}
            disabled={exporting || !data}
            title="Alleen de facturen (CSV). Voor de volledige BTW-cijfers incl. pin & contant: gebruik het Kwartaalpakket."
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl font-medium border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exporting ? "…" : "Facturen"}
          </button>

          {/* [CLOSING-PACKAGE] Full quarterly package (ZIP) for the accountant */}
          <button
            onClick={handlePackageExport}
            disabled={packaging || !data}
            title="Download alle facturen, bonnen en het bankafschrift als één ZIP voor je boekhouder"
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl font-medium border bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            {packaging ? "Pakket maken…" : "Kwartaalpakket"}
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

          {/* [TRUST-OWNER] The REAL Q2 figures — omzet incl. pin & contant + BTW te betalen — from
              the reconciled engine (same as the accountant + closing ZIP), NOT invoices only. This
              is what you actually file. The facturen tables below are a subset for reference. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-background border-2 border-emerald-400 rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Omzet (excl. BTW)</p>
              <p className="text-2xl font-bold tabular-nums text-emerald-700 leading-none mt-1.5">{recon ? formatEur(recon.omzet) : "…"}</p>
              <p className="text-[11px] text-muted-foreground mt-1.5">incl. pin & contant</p>
            </div>
            <div className="bg-background border-2 border-blue-400 rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">BTW te betalen (5g)</p>
              <p className="text-2xl font-bold tabular-nums text-blue-700 leading-none mt-1.5">{recon ? formatEur(recon.saldo) : "…"}</p>
              <p className="text-[11px] text-muted-foreground mt-1.5">na voorbelasting</p>
            </div>
          </div>

          {/* [TRUST-OWNER] Concept BTW-aangifte from the reconciled figures — verschuldigd per
              tarief, minus voorbelasting = te betalen (5g). Same numbers as the accountant + ZIP. */}
          {recon && (recon.salesByRate.length > 0 || recon.verschuldigd !== 0 || recon.voorbelasting !== 0) && (
            <div className="bg-background border rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold">Concept BTW-aangifte Q{quarter} {year}</h3>
              </div>
              <div className="divide-y">
                {recon.salesByRate.filter((b) => b.omzet !== 0 || b.btw !== 0).map((b) => (
                  <div key={b.rate} className="flex items-center justify-between px-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium">Verschuldigd {b.rate}%</p>
                      <p className="text-xs text-muted-foreground mt-0.5">over {formatEur(b.omzet)}</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{formatEur(b.btw)}</p>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-3.5">
                  <p className="text-sm font-medium">Verschuldigd (5a)</p>
                  <p className="text-sm font-semibold tabular-nums">{formatEur(recon.verschuldigd)}</p>
                </div>
                <div className="flex items-center justify-between px-4 py-3.5">
                  <p className="text-sm font-medium">Voorbelasting (5b)</p>
                  <p className="text-sm font-semibold tabular-nums">− {formatEur(recon.voorbelasting)}</p>
                </div>
                <div className="flex items-center justify-between px-4 py-3.5 bg-muted/30">
                  <p className="text-sm font-semibold">Te betalen (5g)</p>
                  <p className="text-sm font-bold tabular-nums">{formatEur(recon.saldo)}</p>
                </div>
              </div>
            </div>
          )}

          {/* [HONESTY] Same nudges Resultaat shows — so the "BTW te betalen (5g)" above is never
              read as complete when it isn't. Omzet with no rate isn't in the BTW; a dateless
              verified invoice is dropped from the quarter entirely. */}
          {recon && recon.cashOmzetZonderBtw > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-[13px] text-amber-800 leading-relaxed">
              {formatEur(recon.cashOmzetZonderBtw)} omzet staat nog zonder BTW-tarief (contante omzet, bankomzet of een
              niet-gesplitste kassadag) — die BTW zit dus niet in het bedrag hierboven. Ken het tarief toe bij Kas of Dagomzet
              voor een compleet BTW-cijfer.
            </div>
          )}
          {recon && recon.datelessVerifiedCount > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-[13px] text-amber-800 leading-relaxed">
              {recon.datelessVerifiedCount === 1
                ? "1 geverifieerde factuur heeft geen datum"
                : `${recon.datelessVerifiedCount} geverifieerde facturen hebben geen datum`} en telt daardoor niet mee in dit
              kwartaal. Vul de factuurdatum in, anders is je omzet of BTW-aftrek te laag.
            </div>
          )}

          {/* [TRUTH-FILED] Filing status for this quarter — the frozen-aangifte layer. Marking a
              quarter ingediend freezes its figures; if the live truth diverges later (a late
              invoice), we show the carry-forward vs suppletie guidance. Reversible. */}
          {recon && (
            <div style={{ marginTop: 12 }}>
              {filed?.divergence?.changed && (
                <div style={{
                  background: filed.divergence.needsSuppletie ? "#fce8e6" : "#fef7e0",
                  border: `1px solid ${filed.divergence.needsSuppletie ? "#e57373" : "#fbbc04"}`,
                  borderRadius: 12, padding: "12px 14px", marginBottom: 10,
                }}>
                  <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: filed.divergence.needsSuppletie ? "#a50e0e" : "#7a4f00" }}>
                    {filed.divergence.needsSuppletie ? "⚠️ Suppletie nodig" : "Let op — dit kwartaal is gewijzigd sinds indiening"}
                  </p>
                  <p style={{ fontSize: 12.5, margin: "4px 0 0", lineHeight: 1.5, color: filed.divergence.needsSuppletie ? "#7a1c1c" : "#7a4f00" }}>
                    De BTW is met <strong>{formatEur(Math.abs(filed.divergence.btwSaldoDelta))}</strong> {filed.divergence.btwSaldoDelta >= 0 ? "gestegen" : "gedaald"}.{" "}
                    {filed.divergence.needsSuppletie
                      ? "Meer dan €1.000 — dien een suppletie in."
                      : "Onder €1.000 — verwerk dit in je volgende aangifte."}
                  </p>
                </div>
              )}
              {/* [ONE-FILING-DOOR] The STATE is shown here; the ACTION lives on Waarheid.
                  This screen used to file and unlock the quarter itself, so btw_filings — the one
                  record in this app that cannot be reconstructed once it is overwritten — had two
                  writers, each with its own copy of the confirmation flow. That is the trap the
                  resultaat→waarheid merge note already named ("two screens over one engine means
                  every completeness signal has to be implemented twice, and the second one is
                  where they get forgotten"), and it had already happened twice on this exact
                  block: the discarded DELETE response and the impossible "kwartaal loopt nog"
                  override both lived on for a release after being fixed on the other side.
                  Reading the state on both screens is fine and useful — it is a fact about the
                  quarter you are exporting. Writing it from both is what had to end. */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                {filed ? (
                  <span style={{ fontSize: 12.5 }} className="text-muted-foreground">
                    🔒 Ingediend op {formatDateNL(filed.filedAt)} · definitief
                  </span>
                ) : filedUnknown ? (
                  <p style={{ fontSize: 12.5 }} className="text-muted-foreground">
                    We konden niet controleren of dit kwartaal al is ingediend. Ververs de pagina.
                  </p>
                ) : (
                  <span style={{ fontSize: 12.5 }} className="text-muted-foreground">
                    Nog niet als ingediend gemarkeerd
                  </span>
                )}
                {/* Deep-linked to THIS quarter, so the action opens on the period you were
                    looking at — never on whatever period Waarheid would have defaulted to. */}
                <Link
                  href={`/dashboard/waarheid?year=${year}&quarter=${quarter}`}
                  className="text-xs font-semibold underline"
                  style={{ color: "#1a73e8" }}
                >
                  {filed ? "Beheer je indiening op Waarheid" : "Markeer als ingediend op Waarheid"}
                </Link>
              </div>
            </div>
          )}

          {/* [BOEK-013] Facturen (subset of the reconciled omzet above) — label maakt duidelijk
              dat dit alleen de facturen zijn, niet de totale omzet incl. pin/contant. */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2 px-0.5">
              {mode === "paid"
                ? "Facturen — inkomsten (alleen betaald)"
                : "Facturen — inkomsten (betaald én uitstaand)"}
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
                  {/* [ROW-LAYOUT] text-xl on phone so a 6-figure amount fits on one line;
                      at text-2xl the narrow grid-cols-2 cell wrapped "€" onto its own line. */}
                  <p className="text-xl sm:text-2xl font-bold tabular-nums text-emerald-700 leading-none">
                    {formatEur(data.totalIn)}
                  </p>
                </div>
                <div className="px-4 py-5">
                  <p className="text-xl sm:text-2xl font-bold tabular-nums text-emerald-700 leading-none">
                    {formatEur(data.totalBtwIn)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* [BOEK-013] Facturen — uitgaven (subset). De voorbelasting in de aangifte hierboven
              telt óók bonnen/kosten zonder factuur mee; deze tabel toont alleen de facturen. */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2 px-0.5">
              {mode === "paid"
                ? "Facturen — uitgaven (alleen betaald)"
                : "Facturen — uitgaven (betaald én uitstaand)"}
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
                  <p className="text-xl sm:text-2xl font-bold tabular-nums text-red-700 leading-none">
                    {formatEur(data.totalOut)}
                  </p>
                </div>
                <div className="px-4 py-5">
                  <p className="text-xl sm:text-2xl font-bold tabular-nums text-red-700 leading-none">
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
  const toast = useToast();
  const parentHref = useParentPath(role);
  // [QUARTER-DEEPLINK] Same rule as the ZZP view — a link may choose the period it opens on.
  const urlPeriod = useQuarterFromUrl();
  const [year, setYear] = useState(urlPeriod.year);
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(urlPeriod.quarter);
  const [data, setData] = useState<QuarterlySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [clientsLoading, setClientsLoading] = useState(false);
  const [packaging, setPackaging] = useState(false); // [CLOSING-PACKAGE]
  // [TRUST-ACCOUNTANT] The RECONCILED figures (invoices + bank + cash + turnover) — the
  // same source as the owner's screens, the closing package and clients/[id]/kwartaal. The
  // money tiles + the BTW-aangifte block read these, NOT the invoices-only /api/quarterly
  // summary (which for a cash/retail client shows a fraction of the real omzet/BTW and must
  // never be presented as the aangifte). null → the tiles show "…" instead of a wrong number.
  const [recon, setRecon] = useState<{
    omzet: number; verschuldigd: number; voorbelasting: number; saldo: number;
    salesByRate: { rate: number; omzet: number; btw: number }[];
    // [HONESTY] see the owner view — surfaced so the accountant's 5g tile is never silently low.
    cashOmzetZonderBtw: number; datelessVerifiedCount: number;
  } | null>(null);

  useEffect(() => {
    void (async () => { setClientsLoading(true); })();
    // [BRIDGE-QUARTER-ACC] Honor ?clientId from the URL (e.g. the "Kwartaal"
    // button on the accountant dashboard) so we open the RIGHT client, not just
    // the first one. Falls back to the first client when no param is present.
    const urlClientId =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("clientId")
        : null;
    fetch("/api/quarterly/clients")
      .then((r) => r.json())
      .then((d) => {
        setClients(d ?? []);
        if (d?.length > 0) {
          const match = urlClientId && d.some((c: Client) => c.id === urlClientId);
          setSelectedClientId(match ? urlClientId! : d[0].id);
        }
      })
      .finally(() => setClientsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedClientId) return;
    void (async () => {
      // Reset binnen de async-wikkel, vóór de eerste await: dezelfde tick als voorheen,
      // zonder synchrone setState in de effect-body.
      setLoading(true);
      setData(null);
      setRecon(null);
    })();
    const params = new URLSearchParams({
      year: String(year),
      quarter: String(quarter),
      clientId: selectedClientId,
    });
    // [NAN-GUARD] Same as the owner view — never let an error body become `data` and render NaN.
    fetch(`/api/quarterly?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d && !d.error ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));

    // [TRUST-ACCOUNTANT] Reconciled figures in parallel — same source as the owner + ZIP.
    (async () => {
      try {
        const [rRes, aRes] = await Promise.all([
          fetch(`/api/result?${params}`),
          fetch(`/api/aangifte?${params}`),
        ]);
        if (!rRes.ok || !aRes.ok) return;
        const r = await rRes.json();
        const a = await aRes.json();
        const omzet = Number(r?.result?.omzet);
        const verschuldigd = Number(a?.aangifte?.verschuldigd);
        const voorbelasting = Number(a?.aangifte?.voorbelasting);
        const saldo = Number(a?.aangifte?.saldo);
        const salesByRate = Array.isArray(r?.result?.salesByRate) ? r.result.salesByRate : [];
        const cashOmzetZonderBtw = Number(r?.result?.cashOmzetZonderBtw) || 0;
        const datelessVerifiedCount = Number(r?.datelessVerifiedCount) || 0;
        if ([omzet, verschuldigd, voorbelasting, saldo].every(Number.isFinite)) {
          setRecon({ omzet, verschuldigd, voorbelasting, saldo, salesByRate, cashOmzetZonderBtw, datelessVerifiedCount });
        }
      } catch { /* leave recon null → tiles show a dash, never a wrong number */ }
    })();
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

  // [CLOSING-PACKAGE] Download the client's full quarterly package (ZIP).
  async function handlePackageExport() {
    if (!selectedClientId) return;
    setPackaging(true);
    try {
      const params = new URLSearchParams({
        year: String(year),
        quarter: String(quarter),
        clientId: selectedClientId,
      });
      const res = await fetch(`/api/closing-package?${params}`);
      if (!res.ok) {
        toast("Pakket genereren mislukt — probeer opnieuw", { tone: "error" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kwartaalpakket-Q${quarter}-${year}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast("Pakket genereren mislukt — controleer je verbinding", { tone: "error" });
    } finally {
      setPackaging(false);
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
        <Link href="/dashboard/clients/invite" className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl">
          Klant uitnodigen
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
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
            {yearOptions(year).map((y) => (<option key={y} value={y}>{y}</option>))}
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

          {/* [CLOSING-PACKAGE] Full quarterly package (ZIP) for this client */}
          <button
            onClick={handlePackageExport}
            disabled={packaging || !data || !selectedClientId}
            title="Download alle facturen, bonnen en het bankafschrift van deze klant als één ZIP"
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl font-medium border bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            {packaging ? "Pakket maken…" : "Kwartaalpakket"}
          </button>
        </div>
      </div>

      {loading && <AccountantSkeleton />}

      {!loading && data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {/* [TRUST-ACCOUNTANT] Reconciled omzet + BTW-saldo (5g), not invoices-only. */}
            <SummaryCard label="Omzet (excl. BTW)" value={recon ? formatEur(recon.omzet) : "…"} accent="default" />
            <SummaryCard label="BTW te betalen (5g)" value={recon ? formatEur(recon.saldo) : "…"} accent="default" />
            <SummaryCard label="Betaald" value={formatEur(data.paid)} accent="green" />
            <SummaryCard
              label="Openstaand"
              value={formatEur((data.outstanding ?? 0) + (data.overdue ?? 0))}
              accent={(data.overdue ?? 0) > 0 ? "red" : "default"}
              sub={(data.overdue ?? 0) > 0 ? `${formatEur(data.overdue)} te laat` : undefined}
            />
          </div>

          {/* [TRUST-ACCOUNTANT] The concept BTW-aangifte from the RECONCILED figures (all
              channels), not the invoices-only breakdown — verschuldigd per tarief, minus
              voorbelasting, = te betalen (5g). Same numbers as the owner + the closing ZIP. */}
          {recon && (recon.salesByRate.length > 0 || recon.verschuldigd !== 0 || recon.voorbelasting !== 0) && (
            <div className="bg-background border rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold">Concept BTW-aangifte Q{quarter} {year}</h3>
              </div>
              <div className="divide-y">
                {recon.salesByRate.filter((b) => b.omzet !== 0 || b.btw !== 0).map((b) => (
                  <div key={b.rate} className="flex items-center justify-between px-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium">Verschuldigd {b.rate}%</p>
                      <p className="text-xs text-muted-foreground mt-0.5">over {formatEur(b.omzet)}</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{formatEur(b.btw)}</p>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-3.5">
                  <p className="text-sm font-medium">Verschuldigd (5a)</p>
                  <p className="text-sm font-semibold tabular-nums">{formatEur(recon.verschuldigd)}</p>
                </div>
                <div className="flex items-center justify-between px-4 py-3.5">
                  <p className="text-sm font-medium">Voorbelasting (5b)</p>
                  <p className="text-sm font-semibold tabular-nums">− {formatEur(recon.voorbelasting)}</p>
                </div>
                <div className="flex items-center justify-between px-4 py-3.5 bg-muted/30">
                  <p className="text-sm font-semibold">Te betalen (5g)</p>
                  <p className="text-sm font-bold tabular-nums">{formatEur(recon.saldo)}</p>
                </div>
              </div>
            </div>
          )}

          {/* [HONESTY] Surface the same incompleteness signals to the accountant before handover. */}
          {recon && recon.cashOmzetZonderBtw > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-[13px] text-amber-800 leading-relaxed">
              {formatEur(recon.cashOmzetZonderBtw)} omzet staat nog zonder BTW-tarief (contante omzet, bankomzet of een
              niet-gesplitste kassadag) — die BTW zit dus niet in het bedrag hierboven. Ken het tarief toe bij Kas of Dagomzet.
            </div>
          )}
          {recon && recon.datelessVerifiedCount > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-[13px] text-amber-800 leading-relaxed">
              {recon.datelessVerifiedCount === 1
                ? "1 geverifieerde factuur heeft geen datum"
                : `${recon.datelessVerifiedCount} geverifieerde facturen hebben geen datum`} en telt daardoor niet mee in dit
              kwartaal — vul de factuurdatum in, anders is de omzet of BTW-aftrek te laag.
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
                      {/* [QUARTER-VENDOR-NAME] party name as primary, invoice_number as fallback */}
                      <p className="text-sm font-medium truncate">
                        {inv.client_name || inv.invoice_number}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {inv.client_name && <span>{inv.invoice_number} &middot; </span>}
                        {inv.invoice_date}
                      </p>
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
  const taal = useLocale()
  const map: Record<string, string> = {
    paid: "bg-green-100 text-green-700",
    sent: "bg-blue-100 text-blue-700",
    draft: "bg-muted text-muted-foreground",
    overdue: "bg-red-100 text-red-700",
  };
  // [STATUS] Dit was de enige plek die 'overdue' "Te laat" noemde; vijf andere zeiden "Verlopen",
  // en dat is ook het woord op het filtertabblad. Het woord komt nu uit invoice-status.ts.
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {statusLabel(status, taal)}
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