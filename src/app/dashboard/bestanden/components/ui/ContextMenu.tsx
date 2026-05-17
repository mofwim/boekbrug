"use client";
// src/app/dashboard/bestanden/components/ui/ContextMenu.tsx
// [BOEK-033] Right-click context menu — files and folders

import { useEffect, useRef } from "react";
import { T } from "../../tokens";
import { Icon } from "./Icon";
import { ContextMenuItem } from "../../types";

export function ContextMenu({
  x, y, items, onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Reposition so menu never overflows viewport
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const menuW = 220;
  const menuH = items.length * 40 + 16;
  const left = x + menuW > vw ? x - menuW : x;
  const top  = y + menuH > vh ? y - menuH : y;

  useEffect(() => {
    const fn = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", fn);
    document.addEventListener("touchstart", fn);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fn);
      document.removeEventListener("touchstart", fn);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed", top, left, zIndex: 9999,
        background: T.surface,
        borderRadius: T.md,
        boxShadow: T.elev3,
        border: `1px solid ${T.surfaceVariant}`,
        minWidth: menuW, padding: "4px 0",
        fontFamily: "'Google Sans','Roboto',sans-serif",
      }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.divider && i > 0 && (
            <div style={{ height: 1, background: T.surfaceVariant, margin: "4px 0" }} />
          )}
          <button
            onClick={() => { item.onClick(); onClose(); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 12,
              padding: "9px 16px", background: "none", border: "none",
              fontSize: 14, color: item.danger ? T.error : T.onSurface,
              cursor: "pointer", textAlign: "left", transition: "background 0.1s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = item.danger ? T.errorContainer : T.surfaceVariant)}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            <Icon name={item.icon} size={18} color={item.danger ? T.error : T.outline} />
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}