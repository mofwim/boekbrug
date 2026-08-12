"use client";
// src/app/dashboard/bestanden/components/modals/AiSuggestionModal.tsx
// [BOEK-033] AI classification suggestion popup after file upload

import { T } from "../../tokens";
import { sheetPaddingBottom } from "@/lib/design/tokens";
import { Icon } from "../ui/Icon";
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'

interface AiSuggestionModalProps {
  fileName: string;
  suggestedPath: string;       // e.g. "2026 / Q2 / Bank"
  onAccept: () => void;        // move to suggested folder
  onChooseManually: () => void; // open MoveModal
  // [BACK-CLOSES] "Not now" — the file stays where it was uploaded. This modal had NO way out at
  // all: no ✕, no backdrop click, two buttons that both act. On a phone the back button is the
  // universal escape, and a modal that eats it is a modal the owner is stuck in.
  onDismiss: () => void;
}

export function AiSuggestionModal({
  fileName, suggestedPath, onAccept, onChooseManually, onDismiss,
}: AiSuggestionModalProps) {
  // [BACK-CLOSES] Back means "not now", which is the harmless one of the three outcomes: nothing
  // moves and the file is still in the root where the owner can find it.
  useCloseOnBack(true, onDismiss)
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 400,
      display: "flex", alignItems: "flex-end",
      background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
    }}>
      <div className="sheet-scroll" style={{
        width: "100%", maxWidth: 480, margin: "0 auto",
        background: T.surface,
        borderRadius: `${T.xl} ${T.xl} 0 0`,
        // [SHEET-BOTTOM] Reserve the bottom bar. Without it the last button in
        // this panel lands behind BottomNav, which paints at z-index 2000.
        paddingBottom: sheetPaddingBottom(0),
        boxShadow: "0 -4px 32px rgba(0,0,0,0.18)",
        fontFamily: "'Roboto',sans-serif",
        overflow: "hidden",
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 0" }}>
          <div style={{ width: 36, height: 4, borderRadius: T.full, background: T.surfaceVariant }} />
        </div>

        {/* Header */}
        <div style={{ padding: "16px 24px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 36, height: 36, borderRadius: T.md,
              background: T.primaryContainer,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <Icon name="star" size={20} color={T.primary} />
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: T.primary, margin: 0 }}>
                AI stelt voor
              </p>
              <p style={{ fontSize: 12, color: T.outline, margin: 0 }}>
                Gebaseerd op inhoud van het bestand
              </p>
            </div>
          </div>
        </div>

        {/* File name */}
        <div style={{ padding: "12px 24px 0" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "12px 14px",
            background: "#F8F9FA", borderRadius: T.md,
            border: `1px solid ${T.surfaceVariant}`,
          }}>
            <Icon name="description" size={20} color={T.outline} />
            <p style={{
              fontSize: 14, fontWeight: 500, color: T.onSurface, margin: 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {fileName}
            </p>
          </div>
        </div>

        {/* Suggested path */}
        <div style={{ padding: "12px 24px 0" }}>
          <p style={{ fontSize: 12, color: T.outline, margin: "0 0 6px", fontWeight: 500 }}>
            Aanbevolen locatie:
          </p>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 14px",
            background: T.primaryContainer, borderRadius: T.md,
            border: `1.5px solid ${T.primary}40`,
          }}>
            <Icon name="folder" size={18} color={T.primary} />
            <p style={{ fontSize: 14, fontWeight: 600, color: T.primary, margin: 0 }}>
              {suggestedPath}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: "20px 24px 28px", display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={onAccept}
            style={{
              padding: "13px", background: T.primary, color: T.onPrimary,
              border: "none", borderRadius: T.full,
              fontSize: 15, fontWeight: 600, cursor: "pointer",
              transition: "opacity 0.1s",
            }}
            onMouseDown={e => (e.currentTarget.style.opacity = "0.85")}
            onMouseUp={e => (e.currentTarget.style.opacity = "1")}
          >
            Ja, hier plaatsen
          </button>
          <button
            onClick={onChooseManually}
            style={{
              padding: "13px", background: T.surfaceVariant, color: T.onSurface,
              border: "none", borderRadius: T.full,
              fontSize: 15, fontWeight: 500, cursor: "pointer",
            }}
          >
            Kies zelf een map
          </button>
        </div>
      </div>
    </div>
  );
}