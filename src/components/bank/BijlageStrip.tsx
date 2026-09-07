// src/components/bank/BijlageStrip.tsx
// [BIJLAGE-BIJ-REGEL] · [REGEL-WEG] The owner's own controls under a bank line: the files kept with
// it, a button to add one, and — on a line no invoice claims — a button to delete the line.
//
// A component holds no language of its own: every string arrives through `t`, and the two
// actions are callbacks. It renders in every tab (te bevestigen, geen factuur, gekoppeld,
// genegeerd), because the question "what is this line?" is asked on all of them.

"use client";

import { useRef, useState } from "react";
import type { BankAttachment } from "@/lib/bank-attachments";

export interface BijlageStripProps {
  attachments: readonly BankAttachment[];
  t: (key: string) => string;
  busy?: boolean;
  /** Absent → no delete button (a linked line is not deletable, and the caller knows). */
  onDeleteLine?: () => void;
  onAddFile: (file: File) => void;
  onOpen: (attachment: BankAttachment) => void;
  onRemove: (attachment: BankAttachment) => void;
}

const FONT = "'Roboto', -apple-system, sans-serif";
const SMALL: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "none", cursor: "pointer",
  fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#5F6368", padding: "4px 6px",
};

export default function BijlageStrip({ attachments, t, busy, onDeleteLine, onAddFile, onOpen, onRemove }: BijlageStripProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div data-testid="bijlage-strip" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6, fontFamily: FONT }}>
      {attachments.map((a) => (
        <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 2, border: "1px solid #DADCE0", borderRadius: 999, padding: "2px 4px 2px 10px", fontSize: 12, color: "#3C4043", maxWidth: "100%" }}>
          <button type="button" onClick={() => onOpen(a)} disabled={busy} style={{ ...SMALL, padding: 0, color: "#1A73E8", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.fileName}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>attach_file</span>
            {a.fileName}
          </button>
          <button type="button" onClick={() => onRemove(a)} disabled={busy} aria-label={t("bank.bijlage.verwijderen")} title={t("bank.bijlage.verwijderen")} style={{ ...SMALL, padding: "0 4px", color: "#9AA0A6" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>close</span>
          </button>
        </span>
      ))}
      <input
        ref={fileInput} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.txt,application/pdf,image/*,text/plain"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onAddFile(f); e.target.value = ""; }}
      />
      <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} style={SMALL}>
        <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>upload_file</span>
        {t("bank.bijlage.toevoegen")}
      </button>
      {onDeleteLine && !confirmDelete && (
        <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy} style={{ ...SMALL, marginInlineStart: "auto", color: "#9AA0A6" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>delete</span>
          {t("bank.regelWeg")}
        </button>
      )}
      {onDeleteLine && confirmDelete && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginInlineStart: "auto", fontSize: 12, color: "#3C4043" }}>
          {t("bank.regelWegVraag")}
          <button type="button" onClick={() => { setConfirmDelete(false); onDeleteLine(); }} disabled={busy} style={{ ...SMALL, color: "#C5221F" }}>{t("bank.regelWegJa")}</button>
          <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} style={SMALL}>{t("bank.bijlage.annuleren")}</button>
        </span>
      )}
    </div>
  );
}
