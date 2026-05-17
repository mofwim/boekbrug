"use client";
// src/app/dashboard/bestanden/components/ui/BulkBar.tsx
// [BOEK-033] Floating bulk action bar — appears when files/folders are selected

import { T } from "../../tokens";
import { Icon } from "./Icon";

interface BulkBarProps {
  selectedCount: number;
  onShare: () => void;
  onMove: () => void;
  onDelete: () => void;
  onStar: () => void;
  onClear: () => void;
}

export function BulkBar({ selectedCount, onShare, onMove, onDelete, onStar, onClear }: BulkBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%",
      transform: "translateX(-50%)",
      zIndex: 100,
      display: "flex", alignItems: "center", gap: 4,
      background: T.onSurface,
      borderRadius: T.xl,
      boxShadow: T.elev3,
      padding: "10px 16px",
      animation: "m3fadeUp 0.2s cubic-bezier(0.4,0,0.2,1)",
      whiteSpace: "nowrap",
    }}>
      <style>{`
        @keyframes m3fadeUp {
          from { opacity:0; transform:translateX(-50%) translateY(8px); }
          to   { opacity:1; transform:translateX(-50%) translateY(0); }
        }
      `}</style>

      <span style={{ fontSize: 14, fontWeight: 600, color: "white", marginRight: 4 }}>
        {selectedCount} geselecteerd
      </span>
      <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)", margin: "0 4px" }} />

      {[
        { label: "Ster", icon: "star", onClick: onStar },
        { label: "Delen", icon: "share", onClick: onShare },
        { label: "Verplaatsen", icon: "drive_file_move", onClick: onMove },
      ].map(btn => (
        <button key={btn.label} onClick={btn.onClick} style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 10px", background: "none", border: "none",
          color: "white", fontSize: 13, cursor: "pointer",
          borderRadius: T.md, transition: "background 0.1s",
        }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
          onMouseLeave={e => (e.currentTarget.style.background = "none")}
        >
          <Icon name={btn.icon} size={16} color="white" />
          <span className="hidden sm:block">{btn.label}</span>
        </button>
      ))}

      <button onClick={onDelete} style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "6px 10px", background: "none", border: "none",
        color: "#F28B82", fontSize: 13, cursor: "pointer", borderRadius: T.md,
      }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(242,139,130,0.12)")}
        onMouseLeave={e => (e.currentTarget.style.background = "none")}
      >
        <Icon name="delete" size={16} color="#F28B82" />
        <span className="hidden sm:block">Verwijderen</span>
      </button>

      <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)", margin: "0 4px" }} />
      <button onClick={onClear} style={{
        width: 28, height: 28, border: "none", background: "none",
        cursor: "pointer", display: "flex", alignItems: "center",
        justifyContent: "center", borderRadius: T.full,
      }}>
        <Icon name="close" size={16} color="white" />
      </button>
    </div>
  );
}