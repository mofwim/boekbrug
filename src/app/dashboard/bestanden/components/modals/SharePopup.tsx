"use client";
// src/app/dashboard/bestanden/components/modals/SharePopup.tsx
// [BOEK-033] Share with accountant popup

import { T } from "../../tokens";
import { Icon } from "../ui/Icon";

interface SharePopupProps {
  fileName: string;
  accountantName: string;
  onShare: () => void;
  onKeepPrivate: () => void;
}

export function SharePopup({ fileName, accountantName, onShare, onKeepPrivate }: SharePopupProps) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", alignItems: "flex-end",
      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
    }}>
      <div style={{
        width: "100%", maxWidth: 480, margin: "0 auto",
        background: T.surface,
        borderRadius: `${T.xl} ${T.xl} 0 0`,
        boxShadow: T.elev3, padding: "12px 24px 32px",
        fontFamily: "'Google Sans','Roboto',sans-serif",
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <div style={{ width: 36, height: 4, borderRadius: T.full, background: T.surfaceVariant }} />
        </div>

        <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
          <div style={{
            width: 48, height: 48, borderRadius: T.lg, background: T.primaryContainer,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon name="share" size={24} color={T.primary} />
          </div>
          <div>
            <p style={{ fontSize: 16, fontWeight: 600, color: T.onSurface, margin: "0 0 4px" }}>
              Delen met boekhouder?
            </p>
            <p style={{ fontSize: 13, color: T.outline, margin: 0, lineHeight: 1.5 }}>
              &quot;{fileName}&quot; is geüpload. Wil je dit delen met{" "}
              <strong style={{ color: T.onSurface }}>{accountantName}</strong>?
            </p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={onShare} style={{
            padding: "12px", background: T.primary, color: T.onPrimary,
            border: "none", borderRadius: T.full, fontSize: 15, fontWeight: 500, cursor: "pointer",
          }}>
            Ja, delen
          </button>
          <button onClick={onKeepPrivate} style={{
            padding: "12px", background: T.primaryContainer, color: T.onPrimaryContainer,
            border: "none", borderRadius: T.full, fontSize: 15, fontWeight: 500, cursor: "pointer",
          }}>
            Nee, privé houden
          </button>
        </div>
      </div>
    </div>
  );
}