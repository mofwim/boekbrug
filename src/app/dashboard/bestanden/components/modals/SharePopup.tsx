"use client";
// src/app/dashboard/bestanden/components/modals/SharePopup.tsx
// [BOEK-033] Share with accountant popup
// [BRUG-FILES-SHARED] Owner now picks the QUARTER when sharing, so the file lands
// in the right quarter of the accountant's closing package. Explicit owner action.

import { useState } from "react";
import { T } from "../../tokens";
import { Icon } from "../ui/Icon";

interface SharePopupProps {
  fileName: string;
  accountantName: string;
  // [BRUG-FILES-SHARED] onShare now reports which quarter/year the owner chose.
  onShare: (period: string, year: number) => void;
  onKeepPrivate: () => void;
}

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_QUARTER = Math.ceil((NOW.getMonth() + 1) / 3);

const QUARTER_LABELS: Record<number, string> = {
  1: "Q1 (jan–mrt)",
  2: "Q2 (apr–jun)",
  3: "Q3 (jul–sep)",
  4: "Q4 (okt–dec)",
};

export function SharePopup({ fileName, accountantName, onShare, onKeepPrivate }: SharePopupProps) {
  // [BRUG-FILES-SHARED] default to the current quarter; owner can change it.
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [quarter, setQuarter] = useState<number>(CURRENT_QUARTER);

  const years = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

  const selectStyle: React.CSSProperties = {
    flex: 1,
    padding: "10px 12px",
    border: `1px solid ${T.surfaceVariant}`,
    borderRadius: T.md,
    fontSize: 14,
    color: T.onSurface,
    background: T.surface,
    fontFamily: "inherit",
    cursor: "pointer",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", alignItems: "flex-end",
      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
    }}>
      <div style={{
        width: "100%", maxWidth: 480, margin: "0 auto",
        background: T.surface,
        borderRadius: `${T.xl} ${T.xl} 0 0`,
        boxShadow: T.elev3, padding: "12px 24px 32px",
        fontFamily: "'Google Sans','Roboto',sans-serif",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <div style={{ width: 36, height: 4, borderRadius: T.full, background: T.surfaceVariant }} />
        </div>

        <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: T.lg, background: T.primaryContainer,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon name="share" size={24} color={T.primary} />
          </div>
          <div>
            <p style={{ fontSize: 16, fontWeight: 600, color: T.onSurface, margin: "0 0 4px" }}>
              Delen met boekhouder?
            </p>
            <p style={{ fontSize: 13, color: T.outline, margin: 0, lineHeight: 1.5 }}>
              &quot;{fileName}&quot; wordt gedeeld met{" "}
              <strong style={{ color: T.onSurface }}>{accountantName}</strong>.
            </p>
          </div>
        </div>

        {/* [BRUG-FILES-SHARED] Quarter picker — owner knows exactly which quarter. */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: T.onSurface, margin: "0 0 8px" }}>
            Voor welk kwartaal?
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <select
              value={quarter}
              onChange={(e) => setQuarter(Number(e.target.value))}
              style={selectStyle}
              aria-label="Kwartaal"
            >
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>{QUARTER_LABELS[q]}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={{ ...selectStyle, flex: "0 0 110px" }}
              aria-label="Jaar"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={() => onShare(`${year}-Q${quarter}`, year)}
            style={{
              padding: "12px", background: T.primary, color: T.onPrimary,
              border: "none", borderRadius: T.full, fontSize: 15, fontWeight: 500, cursor: "pointer",
            }}
          >
            Ja, delen
          </button>
          <button onClick={onKeepPrivate} style={{
            padding: "12px", background: T.primaryContainer, color: T.onPrimaryContainer,
            border: "none", borderRadius: T.full, fontSize: 15, fontWeight: 500, cursor: "pointer",
          }}>
            Nee, privé houden
          </button>
        </div>
      </div>
    </div>
  );
}