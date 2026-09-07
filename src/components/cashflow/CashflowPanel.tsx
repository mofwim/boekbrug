// src/components/cashflow/CashflowPanel.tsx
// [VOORUIT] The panel that says how much money there will be in 7 and in 30 days.
//
// It holds NO language of its own. Every string arrives on the copy object that
// cashflow-forecast-copy.ts builds, including the text direction — the same rule as
// BtwReservationPanel, for the same reason: one Dutch string baked in here and a translation stays
// permanently half-finished.
//
// It renders nothing until it has something true to say — no skeleton, no placeholder amount. And
// the pure view is exported apart from the fetching shell so the render gate can hand it a copy
// object and see the branches (a shortfall, an unknown balance, a caveat list) actually paint.

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { M3, FONT } from "@/lib/design/tokens";
import { useLocale } from "@/lib/i18n/use-locale";
import { cashflowPanel, type CashflowPanelCopy } from "@/lib/cashflow-forecast-copy";
import type { CashflowForecast } from "@/lib/cashflow-forecast";

export function CashflowPanelView({
  panel,
  selected,
  onSelect,
  onAction,
}: {
  panel: CashflowPanelCopy;
  /** Which horizon (days) is open. */
  selected: number;
  onSelect: (days: number) => void;
  onAction: () => void;
}) {
  const h = panel.horizons.find((x) => x.days === selected) ?? panel.horizons[0];
  const short = h.end?.short ?? false;

  return (
    <section
      dir={panel.dir}
      style={{
        fontFamily: FONT,
        background: short ? M3.errorContainer : M3.surfaceVariant,
        border: `1px solid ${short ? M3.error : M3.outlineVariant}`,
        borderRadius: 16,
        padding: "16px",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: M3.onSurfaceVariant, letterSpacing: 0.2 }}>
          {panel.heading}
        </div>
        <div role="tablist" style={{ display: "flex", gap: 4 }}>
          {panel.horizons.map((x) => {
            const on = x.days === h.days;
            return (
              <button
                key={x.days}
                role="tab"
                aria-selected={on}
                onClick={() => onSelect(x.days)}
                style={{
                  fontFamily: FONT,
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: `1px solid ${on ? M3.primary : M3.outlineVariant}`,
                  background: on ? M3.primaryContainer : "transparent",
                  color: on ? M3.onPrimaryContainer : M3.onSurfaceVariant,
                  cursor: "pointer",
                }}
              >
                {x.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Now and then, side by side. Both absent — not zero, not a dash — when the bank balance
          could not be read; the movements below are then all there is. */}
      {(h.start || h.end) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginBottom: 12 }}>
          {h.start && (
            <div>
              <div style={{ fontSize: 13, color: M3.onSurfaceVariant }}>{h.start.label}</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: M3.onSurface }}>{h.start.amount}</div>
            </div>
          )}
          {h.end && (
            <div>
              <div style={{ fontSize: 13, color: M3.onSurfaceVariant }}>{h.end.label}</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: h.end.short ? M3.error : M3.onSurface }}>
                {h.end.amount}
              </div>
            </div>
          )}
        </div>
      )}

      {h.movements.length > 0 && (
        <dl style={{ margin: "0 0 8px", display: "grid", gridTemplateColumns: "1fr auto", rowGap: 4, columnGap: 16, fontSize: 14 }}>
          {h.movements.map((m) => (
            <div key={m.label} style={{ display: "contents" }}>
              <dt style={{ color: M3.onSurfaceVariant }}>{m.label}</dt>
              <dd style={{ margin: 0, color: M3.onSurface, textAlign: "end", fontVariantNumeric: "tabular-nums" }}>{m.amount}</dd>
            </div>
          ))}
        </dl>
      )}

      {h.incasso && <div style={{ fontSize: 13, color: M3.onSurfaceVariant, marginBottom: 8 }}>{h.incasso}</div>}
      {h.lowest && (
        <div style={{ fontSize: 14, color: short ? M3.error : M3.onSurface, marginBottom: 8 }}>{h.lowest}</div>
      )}

      {/* Every limit of this figure, stated. Not collapsed: a caveat nobody opens was not made. */}
      {h.caveats.length > 0 && (
        <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {h.caveats.map((sentence) => (
            <li key={sentence} style={{ fontSize: 12, color: M3.mutedText, lineHeight: 1.45 }}>{sentence}</li>
          ))}
        </ul>
      )}

      <button
        onClick={onAction}
        style={{
          background: "transparent", border: "none", padding: 0, cursor: "pointer",
          color: M3.primary, fontSize: 14, fontWeight: 500, fontFamily: FONT, textAlign: "start",
        }}
      >
        {panel.action}
      </button>
    </section>
  );
}

export default function CashflowPanel() {
  const router = useRouter();
  const locale = useLocale();
  const [panel, setPanel] = useState<CashflowPanelCopy | null>(null);
  const [selected, setSelected] = useState(7);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cashflow");
        if (!res.ok) return; // 401 / 503 — the route already decided it has nothing honest to say
        const data = (await res.json()) as CashflowForecast;
        if (cancelled) return;
        setPanel(cashflowPanel(data, locale));
      } catch {
        /* A tile that could not load shows nothing. It never guesses a figure. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (!panel) return null;

  return (
    <CashflowPanelView
      panel={panel}
      selected={selected}
      onSelect={setSelected}
      onAction={() => router.push("/dashboard/incoming/manage")}
    />
  );
}
