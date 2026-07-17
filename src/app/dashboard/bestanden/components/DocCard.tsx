"use client";
// src/app/dashboard/bestanden/components/DocCard.tsx
// [BOEK-033] File card in grid view

import { useState, useEffect, DragEvent } from "react";
import { T } from "../tokens";
import { Icon } from "./ui/Icon";
import { BestandRow } from "../types";
import { fileEmoji, formatDate } from "../helpers";
import { getSignedUrl } from "../signedUrl";

interface DocCardProps {
  doc: BestandRow;
  selected: boolean;
  onPreview: () => void;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  cardRef: (el: HTMLDivElement | null) => void;
  // [BRUG-FILES-SHARED] one-click share toggle from the card's share badge.
  onToggleShare: (docId: string, currentlyShared: boolean) => void;
}

// [BESTANDEN-THUMB] Show the image itself as the card thumbnail (instead of a
// generic icon) for image files only. PDFs/other types keep the icon — a PDF
// first-page thumbnail is a separate, heavier feature (queued).
function isImage(fileType: string | null): boolean {
  return !!fileType && fileType.startsWith("image/");
}

export function DocCard({ doc, selected, onPreview, onSelect, onContextMenu, onDragStart, cardRef, onToggleShare }: DocCardProps) {
  const [hovered, setHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // [BESTANDEN-THUMB] Lazily fetch a signed URL for image files (files are
  // private). Only for images — never fetch for icons (keeps the grid fast).
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);

  useEffect(() => {
    if (!isImage(doc.file_type)) return;
    let cancelled = false;
    // [F#1] Shared, deduped, concurrency-capped fetch (see signedUrl.ts) — no more
    // one-request-per-card storm, and remounts reuse the cached URL.
    getSignedUrl(doc.id).then((url) => {
      if (cancelled) return;
      if (url) setThumbUrl(url); else setThumbFailed(true);
    });
    return () => { cancelled = true; };
  }, [doc.id, doc.file_type]);

  const showThumb = isImage(doc.file_type) && thumbUrl && !thumbFailed;

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
          border: `2px solid ${selected ? T.primary : "#dadce0"}`,
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
        position: "relative", transition: "background 0.15s", overflow: "hidden",
      }}>
        {showThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl!}
            alt={doc.file_name}
            loading="lazy"
            onError={() => setThumbFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span style={{ fontSize: 30 }}>{fileEmoji(doc.file_type)}</span>
        )}

        {/* More button */}
        {hovered && !selected && !isDragging && (
          <button
            onClick={e => { e.stopPropagation(); onContextMenu(e); }}
            aria-label="Meer opties"
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

        {/* [BRUG-FILES-SHARED] Share badge — one click toggles sharing. Solid when
            shared; faint on hover when not, inviting the owner to share. */}
        {(doc.shared || hovered) && !isDragging && (
          <button
            onClick={e => { e.stopPropagation(); onToggleShare(doc.id, !!doc.shared); }}
            title={doc.shared ? "Gedeeld met boekhouder — tik om te stoppen" : "Delen met boekhouder"}
            aria-label={doc.shared ? "Niet meer delen" : "Delen met boekhouder"}
            style={{
              position: "absolute", bottom: 6, left: 6,
              width: 24, height: 24, border: "none",
              background: doc.shared ? T.primary : "rgba(255,255,255,0.92)",
              borderRadius: T.full, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: T.elev1, opacity: doc.shared ? 1 : 0.85, transition: "all 0.15s",
            }}
          >
            <Icon name="share" size={13} color={doc.shared ? T.onPrimary : T.outline} />
          </button>
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