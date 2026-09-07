// src/components/bank/LijnFactuurSheet.tsx
// [REGEL-FACTUUR] "Say what this payment was." The sheet that turns a bank line into an invoice
// without a file. Holds no language of its own: every string comes through `t`, the money rule
// is stated by the server's own answer (line-invoice.ts), and this component only asks the three
// things the owner knows — the party, the rate, and whether the document exists somewhere.

"use client";

import { useState } from "react";
import { sheetPaddingBottom } from "@/lib/design/tokens";
import { useCloseOnBack } from "@/lib/use-close-on-back";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

export interface LijnFactuurPrefill {
  transactionId: string;
  amount: number;
  date: string | null;
  counterpartName: string | null;
  description: string | null;
  suggestedRate: number | null;
  basedOn: number;
}

export interface LijnFactuurSheetProps {
  prefill: LijnFactuurPrefill;
  t: (key: string, vars?: Record<string, string | number>) => string;
  busy?: boolean;
  onSubmit: (input: { rate: 0 | 9 | 21; hasDocumentElsewhere: boolean; clientName: string; description: string }) => void;
  onClose: () => void;
}

const FONT = "'Roboto', -apple-system, sans-serif";
const eur = (n: number) => `€ ${Math.abs(n).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function LijnFactuurSheet({ prefill, t, busy, onSubmit, onClose }: LijnFactuurSheetProps) {
  // [BACK-CLOSES] The system back button closes the sheet, never the page behind it.
  useCloseOnBack(true, onClose);
  useBodyScrollLock(true);
  const isPurchase = prefill.amount < 0;
  const [name, setName] = useState(prefill.counterpartName ?? "");
  const [rate, setRate] = useState<0 | 9 | 21>((prefill.suggestedRate === 0 || prefill.suggestedRate === 9 || prefill.suggestedRate === 21) ? prefill.suggestedRate : 21);
  const [hasDoc, setHasDoc] = useState(false);
  const [description, setDescription] = useState(prefill.description ?? "");
  const btwOff = isPurchase && !hasDoc;
  const chip = (r: 0 | 9 | 21) => (
    <button
      key={r} type="button" disabled={busy || btwOff} onClick={() => setRate(r)}
      style={{ border: `1px solid ${rate === r && !btwOff ? "#1A73E8" : "#DADCE0"}`, background: rate === r && !btwOff ? "#E8F0FE" : "#fff", color: btwOff ? "#9AA0A6" : "#202124", borderRadius: 999, padding: "8px 14px", fontSize: 13.5, fontWeight: 600, fontFamily: FONT, cursor: busy || btwOff ? "default" : "pointer" }}
    >
      {r}%
    </button>
  );
  return (
    <div role="dialog" aria-modal="true" aria-label={t("bank.lf.titel")} onClick={() => !busy && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 3000 }}>
      <div onClick={(e) => e.stopPropagation()} data-testid="lijn-factuur-sheet"
        style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "22px 20px", paddingBottom: sheetPaddingBottom(22), width: "100%", maxWidth: 460, fontFamily: FONT, maxHeight: "88vh", overflowY: "auto" }}>
        <p style={{ fontSize: 18, fontWeight: 700, color: "#202124", margin: 0 }}>{t("bank.lf.titel")}</p>
        <p style={{ fontSize: 13, color: "#5F6368", margin: "4px 0 16px", lineHeight: 1.45 }}>
          {isPurchase ? t("bank.lf.uitlegInkoop") : t("bank.lf.uitlegVerkoop")}
        </p>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#202124", marginBottom: 12 }}>
          <span>{prefill.date ?? "—"}</span>
          <span style={{ fontWeight: 700 }}>{eur(prefill.amount)}</span>
        </div>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#3c4043", marginBottom: 5 }}>{isPurchase ? t("bank.lf.leverancier") : t("bank.lf.klant")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy}
            style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", fontSize: 15, borderRadius: 10, border: "1px solid #d1d1d6", outline: "none", color: "#202124", fontFamily: FONT }} />
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#3c4043", marginBottom: 5 }}>{t("bank.lf.omschrijving")}</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy}
            style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", fontSize: 15, borderRadius: 10, border: "1px solid #d1d1d6", outline: "none", color: "#202124", fontFamily: FONT }} />
        </label>
        {isPurchase && (
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12, fontSize: 13.5, color: "#202124", lineHeight: 1.45 }}>
            <input type="checkbox" checked={hasDoc} onChange={(e) => setHasDoc(e.target.checked)} disabled={busy} style={{ marginTop: 3 }} />
            <span>{t("bank.lf.documentElders")}</span>
          </label>
        )}
        <div style={{ marginBottom: 6, fontSize: 12.5, fontWeight: 600, color: "#3c4043" }}>{t("bank.lf.btw")}</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>{[21, 9, 0].map((r) => chip(r as 0 | 9 | 21))}</div>
        {btwOff && <p style={{ fontSize: 12.5, color: "#8D6E00", margin: "0 0 12px", lineHeight: 1.45 }}>{t("bank.lf.geenBtwZonderDocument")}</p>}
        {!btwOff && prefill.suggestedRate !== null && prefill.basedOn > 0 && (
          <p style={{ fontSize: 12.5, color: "#5F6368", margin: "0 0 12px" }}>{t("bank.lf.tariefUitFacturen", { rate: prefill.suggestedRate, count: prefill.basedOn })}</p>
        )}
        <button type="button" disabled={busy || !name.trim()} onClick={() => onSubmit({ rate: btwOff ? 0 : rate, hasDocumentElsewhere: hasDoc, clientName: name.trim(), description: description.trim() })}
          style={{ marginTop: 8, width: "100%", padding: "12px", borderRadius: 999, border: "none", background: !name.trim() ? "#E8EAED" : "#1A73E8", color: !name.trim() ? "#70757a" : "#fff", fontSize: 14.5, fontWeight: 600, fontFamily: FONT, cursor: busy || !name.trim() ? "default" : "pointer" }}>
          {busy ? t("bank.lf.bezig") : t("bank.lf.boek")}
        </button>
        <button type="button" disabled={busy} onClick={onClose}
          style={{ marginTop: 8, width: "100%", padding: "10px", borderRadius: 999, border: "none", background: "transparent", color: "#5F6368", fontSize: 13.5, fontWeight: 600, fontFamily: FONT, cursor: "pointer" }}>
          {t("bank.lf.annuleren")}
        </button>
      </div>
    </div>
  );
}
