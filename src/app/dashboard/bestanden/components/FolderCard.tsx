"use client";
// src/app/dashboard/bestanden/components/FolderCard.tsx
// [BOEK-033] Folder card in grid view — drag, drop, context menu, rename, select

import { useState, DragEvent } from "react";
import { T } from "../tokens";
import { Icon } from "./ui/Icon";
import { FolderRow } from "../types";
import { folderColor } from "../helpers";

interface FolderCardProps {
  folder: FolderRow;
  selected: boolean;
  isDragOver: boolean;
  onOpen: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent, folder: FolderRow) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, folder: FolderRow) => void;
  onDragEnter: () => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}

export function FolderCard({
  folder, selected, isDragOver,
  onOpen, onSelect, onContextMenu,
  onDragStart, onDragEnter, onDragLeave, onDrop,
}: FolderCardProps) {
  const [hovered, setHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isShared = folder.name === "Gedeeld met boekhouder";

  const bg = isDragOver
    ? T.primaryContainer
    : selected
    ? `${T.primary}18`
    : "white";

  const border = isDragOver
    ? `2px solid ${T.primary}`
    : selected
    ? `2px solid ${T.primary}`
    : `2px solid transparent`;

  const shadow = isDragOver
    ? `0 0 0 2px ${T.primary}40, ${T.elev2}`
    : hovered
    ? T.elev2
    : T.elev1;

  return (
    <div
      data-folder-card
      data-folder-id={folder.id}
      draggable
      onDragStart={e => { setIsDragging(true); onDragStart(e, folder); }}
      onDragEnd={() => setIsDragging(false)}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={onDrop}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || selected) { onSelect(e); }
        else onOpen();
      }}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e, folder); }}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 8, padding: 16, borderRadius: T.lg,
        cursor: isDragging ? "grabbing" : "pointer",
        userSelect: "none", position: "relative",
        background: bg, border, boxShadow: shadow,
        opacity: isDragging ? 0.6 : 1,
        transform: isDragOver ? "scale(0.97)" : hovered && !isDragging ? "translateY(-1px)" : "none",
        transition: isDragging ? "none" : "all 0.15s cubic-bezier(0.4,0,0.2,1)",
      }}
    >
      {/* Checkbox */}
      <div
        onClick={e => { e.stopPropagation(); onSelect(e); }}
        style={{
          position: "absolute", top: 8, left: 8,
          width: 20, height: 20, borderRadius: T.full,
          background: selected ? T.primary : "rgba(255,255,255,0.9)",
          border: `2px solid ${selected ? T.primary : "#dadce0"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          opacity: selected || hovered ? 1 : 0,
          transition: "all 0.15s", cursor: "pointer", zIndex: 1,
        }}
      >
        {selected && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* More button */}
      {hovered && !selected && (
        <button
          onClick={e => { e.stopPropagation(); onContextMenu(e, folder); }}
          style={{
            position: "absolute", top: 6, right: 6,
            width: 26, height: 26, border: "none",
            background: "rgba(255,255,255,0.92)",
            borderRadius: T.full,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", boxShadow: T.elev1, zIndex: 1,
          }}
        >
          <Icon name="more_vert" size={15} color={T.outline} />
        </button>
      )}

      {/* Folder icon */}
      <Icon name="folder" size={44} color={folderColor(folder.color)} />

      {/* Name */}
      <p style={{
        fontSize: 12, fontWeight: 500, margin: 0,
        textAlign: "center", color: selected ? T.primary : T.onSurface,
        overflow: "hidden", display: "-webkit-box",
        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        width: "100%",
      }}>
        {folder.name}
      </p>

      {/* Badges */}
      {isShared && (
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "2px 8px",
          background: T.primaryContainer, color: T.primary, borderRadius: T.full,
        }}>
          Gedeeld
        </span>
      )}
      {folder.starred && (
        <Icon name="star" size={14} color={T.star}
          style={{ position: "absolute", bottom: 8, right: 8 }} />
      )}
    </div>
  );
}