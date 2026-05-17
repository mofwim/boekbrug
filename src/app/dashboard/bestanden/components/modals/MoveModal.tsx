"use client";
// src/app/dashboard/bestanden/components/modals/MoveModal.tsx
// [BOEK-033] Fix 1 — z-index 300 (backdrop 290)
// [BOEK-033] Fix 2 — centered modal, Drive-style, two action buttons
// [BOEK-033] Fix 4 — "Hoofdmap" instead of "Root (geen map)"

import { useState, useEffect } from "react";
import { T } from "../../tokens";
import { Icon } from "../ui/Icon";
import { FolderRow } from "../../types";
import { folderColor } from "../../helpers";

interface MoveModalProps {
  folders: FolderRow[];
  excludeId?: string;
  onMove: (folderId: string | null) => void;
  onClose: () => void;
}

export function MoveModal({ folders, excludeId, onMove, onClose }: MoveModalProps) {
  const [selected, setSelected] = useState<string | null | "__none__">("__none__");

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const available = folders.filter(f => f.id !== excludeId);

  const rowStyle = (active: boolean): React.CSSProperties => ({
    width: "100%", display: "flex", alignItems: "center", gap: 12,
    padding: "10px 16px", background: active ? T.primaryContainer : "none",
    border: "none", borderRadius: T.md,
    fontSize: 14, color: active ? T.primary : T.onSurface,
    cursor: "pointer", textAlign: "left",
    fontWeight: active ? 600 : 400,
    transition: "background 0.1s",
  });

  return (
    <>
      {/* Backdrop — z-index 290 */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 290,
        }}
      />

      {/* Modal — centered, z-index 300 */}
      <div style={{
        position: "fixed",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 300,
        width: "min(400px, 90vw)",
        maxHeight: "60vh",
        background: "white",
        borderRadius: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        display: "flex", flexDirection: "column",
        fontFamily: "'Google Sans','Roboto',sans-serif",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "20px 20px 12px",
          borderBottom: `1px solid ${T.surfaceVariant}`,
        }}>
          <p style={{ fontSize: 16, fontWeight: 600, color: T.onSurface, margin: 0 }}>
            Verplaatsen naar
          </p>
          <button onClick={onClose} style={{
            width: 32, height: 32, border: "none", background: T.surfaceVariant,
            borderRadius: T.full, display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer",
          }}>
            <Icon name="close" size={16} color={T.outline} />
          </button>
        </div>

        {/* Folder list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
          {/* Hoofdmap */}
          <button
            onClick={() => setSelected("__none__")}
            style={rowStyle(selected === "__none__")}
            onMouseEnter={e => { if (selected !== "__none__") e.currentTarget.style.background = T.surfaceVariant; }}
            onMouseLeave={e => { if (selected !== "__none__") e.currentTarget.style.background = "none"; }}
          >
            <Icon name="home" size={20} color={selected === "__none__" ? T.primary : T.outline} />
            Hoofdmap
          </button>

          {available.map(f => (
            <button
              key={f.id}
              onClick={() => setSelected(f.id)}
              style={rowStyle(selected === f.id)}
              onMouseEnter={e => { if (selected !== f.id) e.currentTarget.style.background = T.surfaceVariant; }}
              onMouseLeave={e => { if (selected !== f.id) e.currentTarget.style.background = "none"; }}
            >
              <Icon name="folder" size={20} color={selected === f.id ? T.primary : folderColor(f.color)} />
              {f.name}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 10,
          padding: "12px 20px 16px",
          borderTop: `1px solid ${T.surfaceVariant}`,
        }}>
          <button onClick={onClose} style={{
            padding: "8px 20px", background: "none",
            border: "none", borderRadius: T.full,
            fontSize: 14, fontWeight: 500,
            color: T.primary, cursor: "pointer",
          }}
            onMouseEnter={e => (e.currentTarget.style.background = T.primaryContainer)}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
          >
            Annuleren
          </button>
          <button
            onClick={() => onMove(selected === "__none__" ? null : selected as string)}
            style={{
              padding: "8px 20px", background: T.primary,
              border: "none", borderRadius: T.full,
              fontSize: 14, fontWeight: 500,
              color: T.onPrimary, cursor: "pointer",
            }}
            onMouseDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
            onMouseUp={e => (e.currentTarget.style.transform = "none")}
          >
            Hier verplaatsen
          </button>
        </div>
      </div>
    </>
  );
}