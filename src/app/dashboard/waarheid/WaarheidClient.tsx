"use client";

// [TRUTH-LENS] The living financial truth + a unified time lens. ONE number set, re-sliced by the
// lens (Dit kwartaal / Vorig / Dit jaar / Alles / Aangepast). Every figure comes from /api/truth,
// the SAME reconcile pipeline the quarterly aangifte uses — the dashboard and the aangifte can
// never disagree. A window that includes today is "living" (loopt nog), not a final filed period.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const FONT = "'Inter', -apple-system, system-ui, sans-serif";
const M = {
  primary: "#1a73e8", surface: "#fff", onSurface: "#202124", muted: "#5f6368",
  line: "#e8eaed", goodBg: "#e6f4ea", warnBg: "#fef7e0", warnFg: "#7a4f00",
};
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });

type Lens = "this-quarter" | "last-quarter" | "ytd" | "all";

interface TruthResult {
  omzet: number; kosten: number; resultaat: number;
  btwVerschuldigd: number; btwVoorbelasting: number; btwSaldo: number;
}
interface Divergence {
  changed: boolean;
  omzetDelta: number; kostenDelta: number;
  btwVerschuldigdDelta: number; btwVoorbelastingDelta: number; btwSaldoDelta: number;
  needsSuppletie: boolean;
}
interface FiledInfo {
  filedAt: string;
  figures: TruthResult;
  divergence: Divergence;
}
interface TruthResponse {
  ok: boolean;
  lens: Lens; label: string; quarter: number | null; year: number | null;
  isLiveWindow: boolean;
  filed: FiledInfo | null;
  result: TruthResult;
  datelessVerifiedCount: number;
  reconciliation: { grossMismatchDays: number; incompleteDays: number };
}

const LENSES: { key: Lens; label: string }[] = [
  { key: "this-quarter", label: "Dit kwartaal" },
  { key: "last-quarter", label: "Vorig kwartaal" },
  { key: "ytd", label: "Dit jaar" },
  { key: "all", label: "Alles" },
];

export default function WaarheidClient() {
  const [lens, setLens] = useState<Lens>("this-quarter");
  const [data, setData] = useState<TruthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filing, setFiling] = useState(false);

  const load = useCallback(async (l: Lens) => {
    setLoading(true); setError(false);
    try {
      const res = await fetch(`/api/truth?lens=${l}`);
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(true); setData(null); }
      else setData(json as TruthResponse);
    } catch {
      setError(true); setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(lens); }, [lens, load]);

  // [TRUTH-FILED] Mark this quarter as filed (freeze the snapshot) / un-file it (unlock).
  const setFiled = useCallback(async (mark: boolean) => {
    if (!data?.quarter || !data?.year) return;
    setFiling(true);
    try {
      if (mark) {
        await fetch("/api/btw/file", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year: data.year, quarter: data.quarter }),
        });
      } else {
        await fetch(`/api/btw/file?year=${data.year}&quarter=${data.quarter}`, { method: "DELETE" });
      }
      await load(lens);
    } finally {
      setFiling(false);
    }
  }, [data, lens, load]);

  const r = data?.result;
  const isQuarterLens = !!(data?.quarter && data?.year);
  const div = data?.filed?.divergence;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "16px 14px 96px", fontFamily: FONT, color: M.onSurface }}>
      <Link href="/dashboard" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: M.primary, fontSize: 14, fontWeight: 600, textDecoration: "none", marginBottom: 10 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>arrow_back</span>
        Terug
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 26, color: M.primary }}>monitoring</span>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Je financiële waarheid</h1>
      </div>
      <p style={{ fontSize: 13.5, color: M.muted, margin: "0 0 16px", lineHeight: 1.5 }}>
        Eén doorlopend beeld, live berekend uit je facturen, bank en kas. Kies een periode.
      </p>

      {/* Time lens */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, overflowX: "auto", paddingBottom: 2 }}>
        {LENSES.map((l) => (
          <button
            key={l.key}
            onClick={() => setLens(l.key)}
            style={{
              flexShrink: 0, padding: "8px 14px", borderRadius: 980, border: "none", cursor: "pointer",
              fontFamily: FONT, fontSize: 13.5, fontWeight: 600,
              background: lens === l.key ? M.primary : "#f1f3f4",
              color: lens === l.key ? "#fff" : "#3c4043",
            }}
          >
            {l.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "56px 0", color: M.muted, fontSize: 14 }}>Bezig met berekenen…</div>
      ) : error ? (
        <div style={{ textAlign: "center", padding: "40px 24px", color: M.muted }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 600, color: M.onSurface, marginBottom: 6 }}>Kon je waarheid niet laden</div>
          <button onClick={() => load(lens)} style={{ marginTop: 8, background: M.primary, color: "#fff", border: "none", borderRadius: 980, padding: "9px 20px", fontWeight: 600, cursor: "pointer" }}>Opnieuw proberen</button>
        </div>
      ) : data && r ? (
        <>
          {/* Period + living/final/filed state */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{data.label}</span>
            {data.filed ? (
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3730a3", background: "#e8eaf6", borderRadius: 980, padding: "2px 10px" }}>
                🔒 Ingediend · definitief
              </span>
            ) : data.isLiveWindow ? (
              <span style={{ fontSize: 11.5, fontWeight: 700, color: M.warnFg, background: M.warnBg, borderRadius: 980, padding: "2px 10px" }}>loopt nog</span>
            ) : (
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#137333", background: M.goodBg, borderRadius: 980, padding: "2px 10px" }}>afgesloten periode</span>
            )}
          </div>

          {/* [TRUTH-FILED] Divergence since filing → the suppletie heads-up. This is the payoff of
              the whole "living truth vs frozen aangifte" split: the only app that tells the owner a
              late invoice moved a quarter they already sent to the Belastingdienst. */}
          {data.filed && div?.changed && (
            <div style={{
              background: div.needsSuppletie ? "#fce8e6" : M.warnBg,
              border: `1px solid ${div.needsSuppletie ? "#e57373" : "#fbbc04"}`,
              borderRadius: 14, padding: "12px 14px", marginBottom: 14,
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: div.needsSuppletie ? "#a50e0e" : M.warnFg, marginBottom: 4 }}>
                {div.needsSuppletie ? "⚠️ Suppletie nodig" : "Let op — dit kwartaal is gewijzigd"}
              </div>
              <div style={{ fontSize: 12.5, color: div.needsSuppletie ? "#7a1c1c" : M.warnFg, lineHeight: 1.5 }}>
                Sinds je indiening is de BTW met <strong>{eur.format(Math.abs(div.btwSaldoDelta))}</strong> {div.btwSaldoDelta >= 0 ? "gestegen" : "gedaald"}
                {" "}(je {div.btwSaldoDelta >= 0 ? "moet meer betalen" : "krijgt meer terug"}).{" "}
                {div.needsSuppletie
                  ? "Dat is meer dan €1.000 — dien een suppletie in bij de Belastingdienst."
                  : "Onder €1.000 mag je dit verwerken in je volgende aangifte."}
              </div>
            </div>
          )}

          {/* Resultaat — the headline */}
          <div style={{ background: M.surface, border: `1px solid ${M.line}`, borderRadius: 18, padding: 20, marginBottom: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 13, color: M.muted, fontWeight: 600, marginBottom: 6 }}>Resultaat (winst)</div>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.5, color: r.resultaat >= 0 ? "#137333" : "#c5221f" }}>
              {eur.format(r.resultaat)}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
              <Stat label="Omzet" value={eur.format(r.omzet)} />
              <Stat label="Kosten" value={eur.format(r.kosten)} />
            </div>
          </div>

          {/* BTW position */}
          <div style={{ background: M.surface, border: `1px solid ${M.line}`, borderRadius: 18, padding: 20, marginBottom: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 13, color: M.muted, fontWeight: 600, marginBottom: 6 }}>
              {r.btwSaldo >= 0 ? "BTW te betalen" : "BTW terug te ontvangen"}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: M.onSurface }}>{eur.format(Math.abs(r.btwSaldo))}</div>
            <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
              <Stat label="Verschuldigd" value={eur.format(r.btwVerschuldigd)} />
              <Stat label="Voorbelasting" value={eur.format(r.btwVoorbelasting)} />
            </div>
            {/* Quarter lens → the aangifte for this exact period is one tap away (same numbers). */}
            {data.quarter && data.year && (
              <Link
                href={`/dashboard/quarterly?year=${data.year}&quarter=${data.quarter}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 14, fontSize: 13.5, fontWeight: 600, color: M.primary, textDecoration: "none" }}
              >
                Naar de BTW-aangifte van deze periode
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
              </Link>
            )}
          </div>

          {/* Honesty notes — never a silent gap */}
          <div style={{ fontSize: 12.5, color: M.muted, lineHeight: 1.6, padding: "0 4px" }}>
            <p style={{ margin: "0 0 6px" }}>
              Op basis van factuurdatum (niet betaaldatum) — dit is je fiscale resultaat, niet je banksaldo.
            </p>
            {data.datelessVerifiedCount > 0 && (
              <p style={{ margin: "0 0 6px", color: M.warnFg }}>
                ⚠️ {data.datelessVerifiedCount} bevestigde factu{data.datelessVerifiedCount === 1 ? "ur telt" : "ren tellen"} nog niet mee — er ontbreekt een datum.
              </p>
            )}
            {(data.reconciliation.grossMismatchDays > 0 || data.reconciliation.incompleteDays > 0) && (
              <p style={{ margin: 0, color: M.warnFg }}>
                ⚠️ {data.reconciliation.grossMismatchDays + data.reconciliation.incompleteDays} kassadag(en) nog niet volledig gereconcilieerd — controleer vóór de aangifte.
              </p>
            )}
          </div>

          {/* [TRUTH-FILED] File / unlock — only for a single-quarter lens. Filing freezes the
              snapshot so later divergence surfaces as a suppletie; unlocking is always allowed
              (reversible). */}
          {isQuarterLens && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${M.line}` }}>
              {data.filed ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, color: M.muted }}>
                    Ingediend op {new Date(data.filed.filedAt).toLocaleDateString("nl-NL")}
                  </span>
                  <button
                    onClick={() => setFiled(false)}
                    disabled={filing}
                    style={{ background: "none", border: "none", color: M.muted, fontSize: 12.5, fontWeight: 600, cursor: filing ? "default" : "pointer", textDecoration: "underline", padding: 0 }}
                  >
                    {filing ? "Bezig…" : "Indiening ongedaan maken"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setFiled(true)}
                  disabled={filing}
                  style={{ width: "100%", padding: "13px 0", borderRadius: 12, background: M.primary, border: "none", color: "#fff", fontWeight: 700, fontSize: 14, cursor: filing ? "default" : "pointer" }}
                >
                  {filing ? "Bezig…" : "Markeer als ingediend bij de Belastingdienst"}
                </button>
              )}
              <p style={{ fontSize: 11.5, color: M.muted, margin: "8px 2px 0", lineHeight: 1.5 }}>
                Dit legt de cijfers van dit kwartaal vast. Komt er later nog een factuur bij, dan
                zien we het verschil en zeggen we of een suppletie nodig is.
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "#5f6368", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}
