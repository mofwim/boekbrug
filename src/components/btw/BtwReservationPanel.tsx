// src/components/btw/BtwReservationPanel.tsx
// [BTW-RESERVERING] The panel that says how much of the balance is already the Belastingdienst's.
//
// It holds NO language of its own. Every string arrives on the copy object that
// btw-reservation-copy.ts builds, including the text direction — so an owner reading Arabic gets
// the words and the direction from the same call and the two cannot end up out of step. A single
// Dutch string left in here is how a translation stays permanently half-finished: the screen keeps
// looking right in Dutch, so nothing ever points at the gap.
//
// It also renders nothing until it has something true to say. No skeleton, no "…berekenen", no
// placeholder amount: this tile is about money the owner does not have, and a shape that fills in
// a second later teaches them to read it before it is finished.

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { M3, FONT } from "@/lib/design/tokens";
import { useLocale } from "@/lib/i18n/use-locale";
import { btwReservationPanel, type BtwReservationPanel as PanelCopy } from "@/lib/btw-reservation-copy";
import type { BtwReservation } from "@/lib/btw-reservation";

type Answer = BtwReservation & {
  balanceAsOf?: string | null;
  uncomputed?: string[];
  oldestConsidered?: string | null;
};

export default function BtwReservationPanel() {
  const router = useRouter();
  const locale = useLocale();
  const [panel, setPanel] = useState<PanelCopy | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/btw-reservation");
        if (!res.ok) return; // 401 / 503 — the route already decided it has nothing honest to say
        const data = (await res.json()) as Answer;
        if (cancelled) return;
        setPanel(
          btwReservationPanel(
            data,
            {
              balanceAsOf: data.balanceAsOf,
              uncomputed: data.uncomputed,
              oldestConsidered: data.oldestConsidered,
            },
            locale,
          ),
        );
      } catch {
        /* A tile that could not load shows nothing. It never guesses a figure. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (!panel) return null;

  const short = panel.free?.short ?? false;

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
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: M3.onSurfaceVariant,
          marginBottom: 12,
          letterSpacing: 0.2,
        }}
      >
        {panel.heading}
      </div>

      {/* The two halves of the balance, side by side. `free` is absent — not zero, not a dash —
          when the balance could not be read, and then only the owed half is shown. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginBottom: panel.deadline ? 12 : 0 }}>
        <div>
          <div style={{ fontSize: 13, color: M3.onSurfaceVariant }}>{panel.reserved.label}</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: M3.onSurface }}>
            {panel.reserved.amount}
          </div>
        </div>
        {panel.free && (
          <div>
            <div style={{ fontSize: 13, color: M3.onSurfaceVariant }}>{panel.free.label}</div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 600,
                color: panel.free.short ? M3.error : M3.onSurface,
              }}
            >
              {panel.free.amount}
            </div>
          </div>
        )}
      </div>

      {panel.deadline && (
        <div style={{ fontSize: 14, color: M3.onSurface, marginBottom: 8 }}>{panel.deadline}</div>
      )}

      {panel.refundExpected && (
        <div style={{ fontSize: 13, color: M3.onSurfaceVariant, marginBottom: 8 }}>
          {panel.refundExpected}
        </div>
      )}

      {/* Every limit of this figure, stated. The list is deliberately not collapsed behind a
          "read more" — a caveat nobody opens is a caveat that was not made. */}
      {panel.caveats.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: "0 0 12px",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {panel.caveats.map((sentence) => (
            <li key={sentence} style={{ fontSize: 12, color: M3.mutedText, lineHeight: 1.45 }}>
              {sentence}
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={() => router.push("/dashboard/aangifte")}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: M3.primary,
          fontSize: 14,
          fontWeight: 500,
          fontFamily: FONT,
          textAlign: "start",
        }}
      >
        {panel.action}
      </button>
    </section>
  );
}
