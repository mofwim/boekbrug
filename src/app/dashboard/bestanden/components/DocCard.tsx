"use client";
// src/app/dashboard/bestanden/components/DocCard.tsx
// [BOEK-033] File card in grid view

import { useState, DragEvent } from "react";
import { T } from "../tokens";
import { Icon } from "./ui/Icon";
import { BestandRow } from "../types";
import { fileEmoji, formatDate } from "../helpers";

interface DocCardProps {
  doc: BestandRow;
  selected: boolean;
  onPreview: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  cardRef: (el: HTMLDivElement | null) => void;
}

export function DocCard({ doc, selected, onPreview, onSelect, onContextMenu, onDragStart, cardRef }: DocCardProps) {
  const [hovered, setHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      ref={cardRef}
      data-doc-card
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
        background: "white", borderRadius: T.lg, overflow: "hidden",
        cursor: isDragging ? "grabbing" : "pointer", userSelect: "none",
        position: "relative",
        boxShadow: selected ? `0 0 0 2px ${T.primary}, ${T.elev2}` : isDragging ? T.elev3 : hovered ? T.elev2 : T.elev1,
        transform: selected ? "scale(0.97)" : isDragging ? "scale(1.04) rotate(0.5deg)" : hovered ? "translateY(-1px)" : "none",
        transition: isDragging ? "none" : "all 0.15s cubic-bezier(0.4,0,0.2,1)",
        border: `2px solid ${selected ? T.primary : "transparent"}`,
        opacity: isDragging ? 0.7 : 1,
      }}
    >
      {/* Checkbox */}
      <div
        onClick={e => { e.stopPropagation(); onSelect(e); }}
        style={{
          position: "absolute", top: 8, left: 8, zIndex: 2,
          width: 20, height: 20, borderRadius: T.full,
          background: selected ? T.primary : "rgba(255,255,255,0.92)",
          border: `2px solid ${selected ? T.primary : "#BDBDBD"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          opacity: selected || hovered ? 1 : 0,
          transition: "all 0.15s", cursor: "pointer", boxShadow: T.elev1,
        }}
      >
        {selected && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* Thumbnail */}
      <div style={{
        height: 96, background: selected ? T.primaryContainer : "#F8F9FA",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", transition: "background 0.15s",
      }}>
        <span style={{ fontSize: 30 }}>{fileEmoji(doc.file_type)}</span>

        {/* More button */}
        {hovered && !selected && !isDragging && (
          <button
            onClick={e => { e.stopPropagation(); onContextMenu(e); }}
            style={{
              position: "absolute", top: 6, right: 6,
              width: 26, height: 26, border: "none",
              background: "rgba(255,255,255,0.92)", borderRadius: T.full,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", boxShadow: T.elev1,
            }}
          >
            <Icon name="more_vert" size={15} color={T.outline} />
          </button>
        )}

        {/* AI badge */}
        {doc.ai_processed && !hovered && (
          <div style={{
            position: "absolute", top: 6, right: 6,
            width: 20, height: 20, borderRadius: T.sm,
            background: T.successContainer,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon name="star" size={12} color={T.success} />
          </div>
        )}

        {/* Star badge */}
        {doc.starred && (
          <Icon name="star" size={14} color={T.star}
            style={{ position: "absolute", bottom: 6, right: 6 }} />
        )}
      </div>

      {/* Info */}
      <div style={{ padding: "9px 11px 11px" }}>
        <p style={{
          fontSize: 12, fontWeight: 500, margin: "0 0 2px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: selected ? T.primary : T.onSurface,
        }}>
          {doc.file_name}
        </p>
        <p style={{ fontSize: 11, color: T.outline, margin: 0 }}>
          {formatDate(doc.created_at)}
        </p>
      </div>
    </div>
  );
}