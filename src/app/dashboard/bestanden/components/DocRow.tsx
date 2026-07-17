"use client";
// src/app/dashboard/bestanden/components/DocRow.tsx
// [BOEK-033] File row in list view

import { useState, DragEvent } from "react";
import { T } from "../tokens";
import { Icon } from "./ui/Icon";
import { BestandRow } from "../types";
import { fileEmoji, formatDate, formatSize } from "../helpers";

interface DocRowProps {
  doc: BestandRow;
  selected: boolean;
  onPreview: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  // [BRUG-FILES-SHARED] one-click share toggle from the row's share badge.
  onToggleShare: (docId: string, currentlyShared: boolean) => void;
  // [BESTANDEN-SEARCH] In search results, show an "open folder location" chip
  // beneath the file name. Only passed in search mode; omitted in normal views.
  onOpenLocation?: () => void;
  folderLabel?: string;
}

export function DocRow({ doc, selected, onPreview, onSelect, onContextMenu, onDragStart, onToggleShare, onOpenLocation, folderLabel }: DocRowProps) {
  const [hovered, setHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      draggable
      onDragStart={e => { setIsDragging(true); onDragStart(e); }}
      onDragEnd={() => setIsDragging(false)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={e => {
        if (isDragging) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || selected) { onSelect(e); }
        else onPreview();
      }}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e); }}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px", cursor: isDragging ? "grabbing" : "pointer",
        userSelect: "none", opacity: isDragging ? 0.6 : 1,
        background: selected ? T.primaryContainer : hovered ? T.surfaceVariant : "transparent",
        transition: "background 0.1s",
      }}
    >
      {/* Checkbox */}
      <div
        onClick={e => { e.stopPropagation(); onSelect(e); }}
        style={{
          width: 20, height: 20, borderRadius: T.full, flexShrink: 0,
          background: selected ? T.primary : "transparent",
          border: `2px solid ${selected ? T.primary : "#dadce0"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          opacity: selected || hovered ? 1 : 0, transition: "all 0.15s", cursor: "pointer",
        }}
      >
        {selected && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      <span style={{ fontSize: 20, flexShrink: 0 }}>{fileEmoji(doc.file_type)}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 14, fontWeight: 500, margin: "0 0 2px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: selected ? T.primary : T.onSurface,
        }}>
          {doc.file_name}
        </p>
        <p style={{ fontSize: 12, color: T.outline, margin: 0 }}>
          {formatDate(doc.created_at)} · {formatSize(doc.file_size)}
        </p>
        {/* [BESTANDEN-SEARCH] Open the folder that contains this file (search mode). */}
        {onOpenLocation && (
          <button
            onClick={e => { e.stopPropagation(); onOpenLocation(); }}
            title={folderLabel ? `Open map: ${folderLabel}` : "Open in Mijn bestanden"}
            style={{
              marginTop: 4, display: "inline-flex", alignItems: "center", gap: 5,
              border: "none", background: T.surfaceVariant, borderRadius: T.full,
              padding: "3px 10px", fontSize: 12, color: T.primary, cursor: "pointer",
              maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden",
            }}
          >
            <Icon name="folder_open" size={13} color={T.primary} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {folderLabel ?? "Mijn bestanden"}
            </span>
          </button>
        )}
      </div>

      {/* [BRUG-FILES-SHARED] Share badge — one click toggles sharing. Solid when
          shared (visible to the accountant); faint on hover when not, as an invite. */}
      {(doc.shared || hovered) && (
        <button
          onClick={e => { e.stopPropagation(); onToggleShare(doc.id, !!doc.shared); }}
          title={doc.shared ? "Gedeeld met boekhouder — tik om te stoppen" : "Delen met boekhouder"}
          aria-label={doc.shared ? "Niet meer delen" : "Delen met boekhouder"}
          style={{
            width: 26, height: 26, border: "none", flexShrink: 0,
            background: doc.shared ? T.primaryContainer : "transparent",
            borderRadius: T.full, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: doc.shared ? 1 : 0.5, transition: "all 0.15s",
          }}
        >
          <Icon name="share" size={15} color={doc.shared ? T.primary : T.outline} />
        </button>
      )}

      {doc.starred && <Icon name="star" size={16} color={T.star} style={{ flexShrink: 0 }} />}
      {doc.ai_processed && <span style={{ fontSize: 11, fontWeight: 600, color: T.success, flexShrink: 0 }}>AI ✓</span>}

      {hovered && !selected && (
        <button
          onClick={e => { e.stopPropagation(); onContextMenu(e); }}
          style={{
            width: 30, height: 30, border: "none", background: "none",
            cursor: "pointer", display: "flex", alignItems: "center",
            justifyContent: "center", borderRadius: T.full, flexShrink: 0,
          }}
        >
          <Icon name="more_vert" size={18} color={T.outline} />
        </button>
      )}
    </div>
  );
}