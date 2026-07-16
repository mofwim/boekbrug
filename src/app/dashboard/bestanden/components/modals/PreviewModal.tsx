"use client";
// src/app/dashboard/bestanden/components/modals/PreviewModal.tsx
// [BOEK-033] File preview modal — PDF iframe + image + download

import { useState, useEffect } from "react";
import { T } from "../../tokens";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/Spinner";
import { BestandRow } from "../../types";
import { fileEmoji, formatSize, formatDate } from "../../helpers";
import { getSignedUrl } from "../../signedUrl";

export function PreviewModal({ doc, onClose }: { doc: BestandRow; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const canPreview = doc.file_type.startsWith("image/") || doc.file_type === "application/pdf";

  useEffect(() => {
    // [F#3/F#4] Cancel-guarded via the shared cached/deduped signed-URL helper: the
    // cleanup flips `cancelled` on doc change/unmount, so a late resolve of the
    // previous document can never write into this render (no stale image/PDF).
    let cancelled = false;
    getSignedUrl(doc.id).then((u) => {
      if (cancelled) return;
      setUrl(u);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [doc.id]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const btnBase: React.CSSProperties = {
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
    gap: 8, padding: "10px 20px", border: "none",
    borderRadius: T.full, fontSize: 14, fontWeight: 500, cursor: "pointer",
    textDecoration: "none",
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", alignItems: "flex-end",
      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 560, margin: "0 auto",
        background: T.surface,
        borderRadius: `${T.xl} ${T.xl} 0 0`,
        boxShadow: T.elev3, overflow: "hidden",
        display: "flex", flexDirection: "column", maxHeight: "92dvh",
      }}>
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 0" }}>
          <div style={{ width: 36, height: 4, borderRadius: T.full, background: T.surfaceVariant }} />
        </div>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: `1px solid ${T.surfaceVariant}` }}>
          <span style={{ fontSize: 24, flexShrink: 0 }}>{fileEmoji(doc.file_type)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: T.onSurface, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {doc.file_name}
            </p>
            <p style={{ fontSize: 12, color: T.outline, margin: "2px 0 0" }}>
              {formatSize(doc.file_size)} · {formatDate(doc.created_at)}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 36, height: 36, border: "none", background: T.surfaceVariant,
            borderRadius: T.full, display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer", flexShrink: 0,
          }}>
            <Icon name="close" size={18} color={T.outline} />
          </button>
        </div>

        {/* Preview area */}
        <div style={{
          flex: 1, overflow: "auto", background: "#F8F9FA",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 16, minHeight: 220,
        }}>
          {loading ? <Spinner size={36} /> :
           !canPreview || !url ? (
            <div style={{ textAlign: "center", padding: 32 }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>{fileEmoji(doc.file_type)}</div>
              <p style={{ fontSize: 14, color: T.outline, marginBottom: 16 }}>Preview niet beschikbaar</p>
              {url && (
                <a href={url} download={doc.file_name} style={{ ...btnBase, background: T.primary, color: T.onPrimary, flex: "none" }}>
                  <Icon name="download" size={18} color={T.onPrimary} /> Downloaden
                </a>
              )}
            </div>
           ) : doc.file_type.startsWith("image/") ? (
            <img src={url} alt={doc.file_name} style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: T.md, boxShadow: T.elev2 }} />
           ) : (
            <iframe src={url} title={doc.file_name} style={{ width: "100%", height: "60vh", border: "none", borderRadius: T.md }} />
          )}
        </div>

        {/* Actions */}
        {url && (
          <div style={{ padding: "12px 20px", display: "flex", gap: 10, borderTop: `1px solid ${T.surfaceVariant}` }}>
            <a href={url} download={doc.file_name} style={{ ...btnBase, background: T.primary, color: T.onPrimary }}>
              <Icon name="download" size={18} color={T.onPrimary} /> Downloaden
            </a>
            {/* [F#5] Only offer inline "open in new tab" for types we render (image/pdf).
                Opening an arbitrary type (e.g. html/svg) inline runs it on the storage
                origin — harmless to the app (cross-origin) but pointless; download it. */}
            {canPreview && (
              <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...btnBase, background: T.primaryContainer, color: T.onPrimaryContainer }}>
                <Icon name="open_in_new" size={18} color={T.onPrimaryContainer} /> Openen
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}