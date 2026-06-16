"use client";
// src/app/dashboard/incoming/IncomingInvoicesClient.tsx
// [BOEK-011] Verification queue — incoming invoices from email  ([BRIDGE-B])
// Mobile-first, iOS-style design
//
// Features:
// - Tabs: Te bevestigen | Genegeerd
// - Tap a card → expands (accordion) with full details + PDF view
// - "Verifiëren" → review/edit AI amounts (TRAIL 2/3) →
//     "Bevestig / verifieer" (becomes a shared Crediteur, unpaid)  OR
//     "Markeer als betaald" → Bank/Contant (marks paid)
// - "Negeer" → confirmation → archive (recoverable)
// - Restore ignored invoices → back to the verification queue

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
// [BOEK-011] Centralized navigation — single source of truth across the app
import { useHomePath, useParentPath } from "@/lib/navigation-hooks";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IncomingInvoice {
  id: string;
  client_name: string;
  client_email: string | null;
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
  invoice_date: string;
  invoice_number: string;
  source: string;
  pdf_url: string | null;
  document_id: string | null;
  created_at: string;
  // [BOEK-011] folder where the file was stored in Mijn Bestanden
  folder_id: string | null;
  folder_name: string | null;
}

interface ConnectionStatus {
  connected: boolean;
  provider: "gmail" | "outlook" | null;
  email: string | null;
  connected_at: string | null;
  pending_count: number;
}

interface Props {
  initialInvoices: IncomingInvoice[];
  ignoredInvoices: IncomingInvoice[];
  connectionStatus: ConnectionStatus;
  // [BOEK-011] Used by the Logo Universal Click pattern (Navigation Strategy v1.0)
  userRole: "zzper" | "accountant";
}

type Tab = "pending" | "ignored";

// ── Formatters ────────────────────────────────────────────────────────────────

const NL_CURRENCY = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});

const NL_DATE = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function formatDate(dateStr: string): string {
  try {
    return NL_DATE.format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function formatAmount(amount: number): string {
  return NL_CURRENCY.format(amount);
}

// ── Email connect card ────────────────────────────────────────────────────────

function ConnectEmailCard({ status }: { status: ConnectionStatus }) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/email/sync", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setSyncResult(`Fout: ${data.error}`);
      } else {
        setSyncResult(
          `${data.verified ?? 0} facturen gevonden, ${data.saved ?? 0} opgeslagen`
        );
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch {
      setSyncResult("Sync mislukt — probeer opnieuw");
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("E-mailverbinding verwijderen?")) return;
    await fetch("/api/email/sync", { method: "DELETE" });
    window.location.reload();
  };

  if (status.connected) {
    const providerName = status.provider === "gmail" ? "Gmail" : "Outlook";

    return (
      <div
        style={{
          background: "#f2f2f7",
          borderRadius: 16,
          padding: "16px 20px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 28 }}>📧</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: "#1c1c1e" }}>
                {providerName} verbonden
              </span>
              <span
                style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: "#34c759", display: "inline-block",
                }}
              />
            </div>
            <div style={{ fontSize: 13, color: "#8e8e93", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {status.email}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              flex: 1,
              background: syncing ? "#e5e5ea" : "#007aff",
              color: syncing ? "#8e8e93" : "#fff",
              border: "none", borderRadius: 10, padding: "10px 0",
              fontWeight: 600, fontSize: 14,
              cursor: syncing ? "not-allowed" : "pointer",
            }}
          >
            {syncing ? "Bezig…" : "Synchroniseer nu"}
          </button>
          <button
            onClick={handleDisconnect}
            style={{
              background: "transparent", border: "1.5px solid #ff3b30",
              color: "#ff3b30", borderRadius: 10, padding: "10px 16px",
              fontWeight: 600, fontSize: 14, cursor: "pointer",
            }}
          >
            Ontkoppel
          </button>
        </div>

        {syncResult && (
          <div
            style={{
              marginTop: 10, fontSize: 13, textAlign: "center",
              color: syncResult.startsWith("Fout") ? "#ff3b30" : "#34c759",
            }}
          >
            {syncResult}
          </div>
        )}
      </div>
    );
  }

  // Not connected
  return (
    <div
      style={{
        background: "#f2f2f7", borderRadius: 20,
        padding: "24px 20px", marginBottom: 20, textAlign: "center",
      }}
    >
      <div style={{ fontSize: 44, marginBottom: 12 }}>📬</div>
      <div style={{ fontWeight: 700, fontSize: 17, color: "#1c1c1e", marginBottom: 8 }}>
        Verbind je e-mail
      </div>
      <div
        style={{
          fontSize: 14, color: "#8e8e93", lineHeight: 1.5,
          maxWidth: 280, margin: "0 auto 24px",
        }}
      >
        Facturen komen automatisch binnen — je hoeft niets meer door te sturen.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(["gmail", "outlook"] as const).map((provider) => (
          <a
            key={provider}
            href={`/api/email/connect?provider=${provider}`}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 10, background: "#fff", border: "1.5px solid #e5e5ea",
              borderRadius: 12, padding: "14px 20px", textDecoration: "none",
              color: "#1c1c1e", fontWeight: 600, fontSize: 15,
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}
          >
            <span style={{ fontSize: 20 }}>{provider === "gmail" ? "📧" : "📮"}</span>
            Verbind {provider === "gmail" ? "Gmail" : "Outlook"}
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Confirm-paid modal — review & edit AI-extracted amounts ───────────────────

function ConfirmPaidModal({
  invoice,
  onVerify,
  onPay,
  onCancel,
}: {
  invoice: IncomingInvoice;
  // [BRIDGE-B] verify → becomes a SHARED Crediteur (unpaid). pay → mark paid (needs method).
  onVerify: (amounts: { total_ex_btw: number; btw_amount: number; total_inc_btw: number }) => void;
  onPay: (
    amounts: { total_ex_btw: number; btw_amount: number; total_inc_btw: number },
    method: "bank" | "kas"
  ) => void;
  onCancel: () => void;
}) {
  const [exBtw, setExBtw] = useState(invoice.total_ex_btw || 0);
  const [btwAmount, setBtwAmount] = useState(invoice.btw_amount || 0);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // [BRIDGE-B] payStep = showing the Bank/Contant choice (after "Markeer als betaald")
  const [payStep, setPayStep] = useState(false);

  // Total is always derived — never edited directly. This IS TRAIL 2: excl + BTW = incl.
  const totalIncBtw = exBtw + btwAmount;

  // [BRIDGE-B] TRAIL 3 — legal BTW rate must round to 0 / 9 / 21. FLAG, never block.
  const btwRate = exBtw > 0 ? Math.round((btwAmount / exBtw) * 100) : null;
  const rateFlag = btwRate !== null && btwRate !== 0 && btwRate !== 9 && btwRate !== 21;

  const amounts = {
    total_ex_btw: exBtw,
    btw_amount: btwAmount,
    total_inc_btw: totalIncBtw,
  };

  const handleVerify = () => {
    setSubmitting(true);
    onVerify(amounts);
  };
  const handlePay = (method: "bank" | "kas") => {
    setSubmitting(true);
    onPay(amounts, method);
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        zIndex: 2000,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: "20px 20px 0 0",
          padding: "24px 20px",
          paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
          width: "100%", maxWidth: 430,
        }}
      >
        {!payStep ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 19, color: "#1c1c1e", marginBottom: 4 }}>
              Factuur bevestigen
            </div>
            <div style={{ fontSize: 14, color: "#8e8e93", marginBottom: 20 }}>
              Controleer de bedragen. AI heeft ze automatisch uitgelezen.
            </div>

            {/* Amounts breakdown */}
            <div
              style={{
                background: "#f2f2f7", borderRadius: 14,
                padding: "16px", marginBottom: 16,
              }}
            >
              {/* Excl BTW */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 14, color: "#6b6b6e" }}>Bedrag excl. BTW</span>
                {editing ? (
                  <input
                    type="number"
                    value={exBtw}
                    onChange={(e) => setExBtw(Math.max(0, parseFloat(e.target.value) || 0))}
                    style={{
                      width: 110, padding: "6px 10px", fontSize: 16,
                      borderRadius: 8, border: "1.5px solid #007aff",
                      textAlign: "right", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#1c1c1e" }}>
                    {formatAmount(exBtw)}
                  </span>
                )}
              </div>

              {/* BTW amount */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: rateFlag ? 6 : 12 }}>
                <span style={{ fontSize: 14, color: "#6b6b6e" }}>BTW</span>
                {editing ? (
                  <input
                    type="number"
                    value={btwAmount}
                    onChange={(e) => setBtwAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    style={{
                      width: 110, padding: "6px 10px", fontSize: 16,
                      borderRadius: 8,
                      border: `1.5px solid ${rateFlag ? "#EA8600" : "#007aff"}`,
                      textAlign: "right", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: rateFlag ? "#EA8600" : "#1c1c1e" }}>
                    {formatAmount(btwAmount)}
                  </span>
                )}
              </div>

              {/* [BRIDGE-B] TRAIL 3 flag — non-blocking warning on an unexpected BTW rate */}
              {rateFlag && (
                <div style={{ fontSize: 12, color: "#EA8600", lineHeight: 1.4, marginBottom: 12, display: "flex", gap: 6 }}>
                  <span>⚠️</span>
                  <span>BTW-tarief lijkt {btwRate}% — controleer de bedragen (verwacht 0%, 9% of 21%).</span>
                </div>
              )}

              {/* Divider */}
              <div style={{ height: 1, background: "#d1d1d6", margin: "12px 0" }} />

              {/* Total — always computed */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#1c1c1e" }}>Totaal</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#1c1c1e" }}>
                  {formatAmount(totalIncBtw)}
                </span>
              </div>
            </div>

            {/* Edit toggle */}
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                style={{
                  width: "100%", padding: "10px", marginBottom: 10,
                  background: "transparent", border: "none",
                  color: "#007aff", fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                Bedragen aanpassen
              </button>
            )}

            {/* PRIMARY — verify (becomes a shared Crediteur, unpaid) */}
            <button
              onClick={handleVerify}
              disabled={submitting}
              style={{
                width: "100%", padding: "16px", borderRadius: 14,
                background: submitting ? "#c7c7cc" : "#34c759",
                color: "#fff", border: "none", fontWeight: 700, fontSize: 16,
                cursor: submitting ? "not-allowed" : "pointer", marginBottom: 8,
              }}
            >
              {submitting ? "Bezig…" : "Bevestig / verifieer"}
            </button>

            {/* SECONDARY — mark as paid → opens Bank/Contant choice */}
            <button
              onClick={() => setPayStep(true)}
              disabled={submitting}
              style={{
                width: "100%", padding: "14px", borderRadius: 14,
                background: "#eef4ff", color: "#007aff",
                border: "1.5px solid #007aff",
                fontWeight: 600, fontSize: 15,
                cursor: submitting ? "not-allowed" : "pointer", marginBottom: 8,
              }}
            >
              Markeer als betaald
            </button>

            {/* Cancel */}
            <button
              onClick={onCancel}
              disabled={submitting}
              style={{
                width: "100%", padding: "14px", borderRadius: 14,
                background: "#f2f2f7", color: "#1c1c1e", border: "none",
                fontWeight: 600, fontSize: 15, cursor: "pointer",
              }}
            >
              Annuleren
            </button>
          </>
        ) : (
          /* [BRIDGE-B] Payment-method step — mirrors the outgoing "mark paid" dialog */
          <>
            <div style={{ fontWeight: 700, fontSize: 19, color: "#1c1c1e", marginBottom: 4 }}>
              Hoe is deze factuur betaald?
            </div>
            <div style={{ fontSize: 14, color: "#8e8e93", marginBottom: 20 }}>
              De factuur wordt als betaald gemarkeerd en doorgestuurd naar je boekhouder.
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button
                onClick={() => handlePay("bank")}
                disabled={submitting}
                style={{
                  flex: 1, padding: "16px", borderRadius: 14,
                  background: submitting ? "#c7c7cc" : "#34c759",
                  color: "#fff", border: "none", fontWeight: 700, fontSize: 16,
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                🏛️ Bank
              </button>
              <button
                onClick={() => handlePay("kas")}
                disabled={submitting}
                style={{
                  flex: 1, padding: "16px", borderRadius: 14,
                  background: submitting ? "#c7c7cc" : "#34c759",
                  color: "#fff", border: "none", fontWeight: 700, fontSize: 16,
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                💳 Contant
              </button>
            </div>

            {/* Back to the review step */}
            <button
              onClick={() => setPayStep(false)}
              disabled={submitting}
              style={{
                width: "100%", padding: "14px", borderRadius: 14,
                background: "transparent", color: "#8e8e93", border: "none",
                fontWeight: 600, fontSize: 15, cursor: "pointer",
              }}
            >
              ‹ Terug
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Simple confirm dialog (for Negeer) ────────────────────────────────────────

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmColor,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 2000, padding: 24,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 18, padding: "24px 20px",
          width: "100%", maxWidth: 320, textAlign: "center",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 17, color: "#1c1c1e", marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 14, color: "#6b6b6e", marginBottom: 20, lineHeight: 1.5 }}>
          {message}
        </div>
        <button
          onClick={onConfirm}
          style={{
            width: "100%", padding: "14px", borderRadius: 12,
            background: confirmColor, color: "#fff", border: "none",
            fontWeight: 700, fontSize: 15, cursor: "pointer", marginBottom: 8,
          }}
        >
          {confirmLabel}
        </button>
        <button
          onClick={onCancel}
          style={{
            width: "100%", padding: "12px", borderRadius: 12,
            background: "transparent", color: "#8e8e93", border: "none",
            fontWeight: 600, fontSize: 15, cursor: "pointer",
          }}
        >
          Annuleren
        </button>
      </div>
    </div>
  );
}

// ── Invoice card — collapsible accordion ──────────────────────────────────────

function InvoiceCard({
  invoice,
  mode,
  expanded,
  onToggle,
  onConfirmPaid,
  onIgnore,
  onRestore,
}: {
  invoice: IncomingInvoice;
  mode: Tab;
  expanded: boolean;
  onToggle: () => void;
  onConfirmPaid: () => void;
  onIgnore: () => void;
  onRestore: () => void;
}) {
  const [loadingPdf, setLoadingPdf] = useState(false);

  const handleOpenPdf = async () => {
    setLoadingPdf(true);
    try {
      const res = await fetch(`/api/email/file/${invoice.id}`);
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        alert(data.error || "Kon bestand niet openen");
      }
    } catch {
      alert("Kon bestand niet openen");
    } finally {
      setLoadingPdf(false);
    }
  };

  return (
    <div
      style={{
        background: "#fff", borderRadius: 16, marginBottom: 12,
        overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
      }}
    >
      {/* Header — always visible, tappable */}
      <button
        onClick={onToggle}
        style={{
          width: "100%", padding: "16px", border: "none",
          background: "transparent", cursor: "pointer", textAlign: "left",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700, fontSize: 16, color: "#1c1c1e", marginBottom: 3,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {invoice.client_name || "Onbekende afzender"}
          </div>
          <div style={{ fontSize: 13, color: "#8e8e93" }}>
            {formatDate(invoice.invoice_date)}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 18, color: "#1c1c1e", whiteSpace: "nowrap" }}>
            {invoice.total_inc_btw > 0 ? formatAmount(invoice.total_inc_btw) : "—"}
          </span>
          <span
            style={{
              fontSize: 18, color: "#c7c7cc",
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 0.2s",
            }}
          >
            ›
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: "0 16px 16px" }}>
          <div style={{ height: 1, background: "#f2f2f7", marginBottom: 14 }} />

          {/* Detail rows */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            <DetailRow label="Factuurnummer" value={invoice.invoice_number || "—"} />
            <DetailRow label="Afzender" value={invoice.client_email || "—"} />
            <DetailRow
              label="Bedrag excl. BTW"
              value={invoice.total_ex_btw > 0 ? formatAmount(invoice.total_ex_btw) : "—"}
            />
            <DetailRow
              label="BTW"
              value={invoice.btw_amount > 0 ? formatAmount(invoice.btw_amount) : "—"}
            />
            <DetailRow
              label="Totaal"
              value={invoice.total_inc_btw > 0 ? formatAmount(invoice.total_inc_btw) : "—"}
              bold
            />
            <DetailRow
              label="Bron"
              value={invoice.source === "email" ? "E-mail" : "Upload"}
            />
          </div>

          {/* View PDF button */}
          {invoice.pdf_url && (
            <button
              onClick={handleOpenPdf}
              disabled={loadingPdf}
              style={{
                width: "100%", padding: "12px", borderRadius: 12,
                background: "#eef4ff", border: "1.5px solid #007aff",
                color: "#007aff", fontWeight: 600, fontSize: 14,
                cursor: loadingPdf ? "wait" : "pointer", marginBottom: 10,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>📄</span>
              {loadingPdf ? "Openen…" : "Bekijk factuur"}
            </button>
          )}

          {/* [BOEK-011] Folder location — link to Mijn Bestanden */}
          {invoice.folder_id && (
            <a
              href={`/dashboard/bestanden?folder=${invoice.folder_id}`}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 12px", borderRadius: 10, marginBottom: 10,
                background: "#f7f7f7", textDecoration: "none",
              }}
            >
              <span style={{ fontSize: 15 }}>📁</span>
              <span style={{ flex: 1, fontSize: 13, color: "#6b6b6e" }}>
                Opgeslagen in{" "}
                <span style={{ color: "#1c1c1e", fontWeight: 600 }}>
                  {invoice.folder_name || "Mijn Bestanden"}
                </span>
              </span>
              <span style={{ fontSize: 15, color: "#c7c7cc" }}>›</span>
            </a>
          )}

          {/* Actions — depend on mode */}
          {mode === "pending" ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={onIgnore}
                style={{
                  flex: 1, padding: "13px 0", borderRadius: 12,
                  background: "#f2f2f7", border: "none", color: "#8e8e93",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                Negeer
              </button>
              <button
                onClick={onConfirmPaid}
                style={{
                  flex: 2, padding: "13px 0", borderRadius: 12,
                  background: "#34c759", border: "none", color: "#fff",
                  fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}
              >
                Verifiëren
              </button>
            </div>
          ) : (
            <button
              onClick={onRestore}
              style={{
                width: "100%", padding: "13px 0", borderRadius: 12,
                background: "#eef4ff", border: "1.5px solid #007aff",
                color: "#007aff", fontWeight: 600, fontSize: 14, cursor: "pointer",
              }}
            >
              Terugzetten naar wachtrij
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 13, color: "#8e8e93" }}>{label}</span>
      <span
        style={{
          fontSize: 13, color: "#1c1c1e",
          fontWeight: bold ? 700 : 500,
          textAlign: "right", overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Manual upload ─────────────────────────────────────────────────────────────

function ManualUpload({ onUploaded }: { onUploaded: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (uploading) return;
    const okType =
      file.type === "application/pdf" ||
      file.type.startsWith("image/") ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!okType) {
      alert("Alleen PDF of afbeelding toegestaan");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/email/upload", { method: "POST", body: formData });
      if (res.ok) {
        onUploaded();
        window.location.reload();
      } else {
        const data = await res.json();
        alert(data.error || "Upload mislukt");
      }
    } catch {
      alert("Upload mislukt — probeer opnieuw");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          fontSize: 13, fontWeight: 600, color: "#8e8e93",
          textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
        }}
      >
        Handmatig uploaden
      </div>
      <label
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          padding: "20px", borderRadius: 16,
          border: `2px dashed ${dragOver ? "#007aff" : "#c7c7cc"}`,
          background: dragOver ? "#f0f7ff" : "#fafafa",
          cursor: uploading ? "not-allowed" : "pointer",
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        <input
          type="file"
          accept=".pdf,image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <span style={{ fontSize: 28 }}>{uploading ? "⏳" : "📎"}</span>
        <span style={{ fontSize: 14, color: uploading ? "#8e8e93" : "#007aff", fontWeight: 600 }}>
          {uploading ? "Verwerken…" : "Kies bestand of sleep hier naartoe"}
        </span>
        <span style={{ fontSize: 12, color: "#8e8e93" }}>PDF of afbeelding</span>
      </label>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function IncomingInvoicesClient({
  initialInvoices,
  ignoredInvoices,
  connectionStatus,
  userRole,
}: Props) {
  // [BOEK-011] Navigation paths — resolved through the central navigation helper
  // homeHref   = role-based home (Logo target — Rule 1 of Navigation Strategy v1.0)
  // parentHref = canonical parent of the current page (Terug target — Rule 2)
  const homeHref = useHomePath(userRole);
  const parentHref = useParentPath(userRole);

  const [pending, setPending] = useState<IncomingInvoice[]>(initialInvoices);
  const [ignored, setIgnored] = useState<IncomingInvoice[]>(ignoredInvoices);
  const [tab, setTab] = useState<Tab>("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Modal state
  const [confirmPaidFor, setConfirmPaidFor] = useState<IncomingInvoice | null>(null);
  const [ignoreFor, setIgnoreFor] = useState<IncomingInvoice | null>(null);

  // OAuth result toast
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      showToast(`${connected === "gmail" ? "Gmail" : "Outlook"} succesvol verbonden!`);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (error) {
      showToast("Verbinding mislukt — probeer opnieuw");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ── [BRIDGE-B] Verify — processing → received (shared Crediteur, unpaid) ──
  const handleVerify = useCallback(
    async (
      invoice: IncomingInvoice,
      amounts: { total_ex_btw: number; btw_amount: number; total_inc_btw: number }
    ) => {
      // Optimistic — remove from pending
      setPending((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setConfirmPaidFor(null);
      setExpandedId(null);

      try {
        const res = await fetch(`/api/email/confirm/${invoice.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "verify", ...amounts }),
        });
        if (res.ok) {
          showToast("✓ Factuur geverifieerd");
        } else {
          showToast("Verificatie mislukt — ververs de pagina");
        }
      } catch {
        showToast("Fout — ververs de pagina");
      }
    },
    []
  );

  // ── [BRIDGE-B] Pay — → paid (requires payment_method: bank | kas) ──
  const handlePay = useCallback(
    async (
      invoice: IncomingInvoice,
      amounts: { total_ex_btw: number; btw_amount: number; total_inc_btw: number },
      method: "bank" | "kas"
    ) => {
      // Optimistic — remove from pending
      setPending((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setConfirmPaidFor(null);
      setExpandedId(null);

      try {
        const res = await fetch(`/api/email/confirm/${invoice.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pay", payment_method: method, ...amounts }),
        });
        if (res.ok) {
          showToast("✓ Factuur gemarkeerd als betaald");
        } else {
          showToast("Bevestiging mislukt — ververs de pagina");
        }
      } catch {
        showToast("Fout — ververs de pagina");
      }
    },
    []
  );

  // ── Ignore — archive ──
  const handleIgnore = useCallback(async (invoice: IncomingInvoice) => {
    setPending((prev) => prev.filter((inv) => inv.id !== invoice.id));
    setIgnored((prev) => [invoice, ...prev]);
    setIgnoreFor(null);
    setExpandedId(null);

    try {
      await fetch(`/api/email/confirm/${invoice.id}`, { method: "DELETE" });
      showToast("Factuur genegeerd");
    } catch {
      showToast("Fout — ververs de pagina");
    }
  }, []);

  // ── Restore ignored → pending ──
  const handleRestore = useCallback(async (invoice: IncomingInvoice) => {
    setIgnored((prev) => prev.filter((inv) => inv.id !== invoice.id));
    setPending((prev) => [invoice, ...prev]);
    setExpandedId(null);

    try {
      await fetch(`/api/email/confirm/${invoice.id}`, { method: "PATCH" });
      showToast("Factuur teruggezet");
    } catch {
      showToast("Fout — ververs de pagina");
    }
  }, []);

  const list = tab === "pending" ? pending : ignored;

  return (
    <div
      style={{
        maxWidth: 430, margin: "0 auto", padding: "0 0 100px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
      }}
    >
      {/* [BOEK-011] Header — Logo Universal Click + Terug via <Link>
          Implements Navigation Strategy v1.0:
          - Logo always → home (dynamic by role)
          - Terug uses <Link>, never router.back()
          - Logo + Terug are separate concerns: Logo = escape hatch from anywhere,
            Terug = explicit parent (/dashboard for /dashboard/incoming) */}
      <div style={{ padding: "20px 20px 0", marginBottom: 16 }}>
        {/* Logo row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <Link
            href={homeHref}
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#007aff",
              textDecoration: "none",
              letterSpacing: -0.3,
            }}
          >
            BoekBrug
          </Link>
        </div>

        {/* [BOEK-011] Terug — canonical parent via useParentPath.
            For /dashboard/incoming the parent is /dashboard (zzp home),
            but the rule lives in src/lib/navigation.ts now — not here. */}
        <Link
          href={parentHref}
          style={{
            color: "#007aff",
            textDecoration: "none",
            fontSize: 17,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginBottom: 8,
          }}
        >
          ‹ Terug
        </Link>
        <h1
          style={{
            fontSize: 28, fontWeight: 700, color: "#1c1c1e",
            margin: 0, letterSpacing: -0.5,
          }}
        >
          Inkomend
        </h1>
        <p style={{ fontSize: 14, color: "#8e8e93", margin: "4px 0 0" }}>
          {pending.length === 0
            ? "Alles verwerkt"
            : `${pending.length} ${pending.length === 1 ? "factuur" : "facturen"} wacht op bevestiging`}
        </p>
      </div>

      <div style={{ padding: "0 16px" }}>
        <ConnectEmailCard status={connectionStatus} />

        {/* Tabs */}
        <div
          style={{
            display: "flex", gap: 8, marginBottom: 16,
            background: "#f2f2f7", borderRadius: 12, padding: 4,
          }}
        >
          {([
            ["pending", `Te bevestigen${pending.length ? ` (${pending.length})` : ""}`],
            ["ignored", `Genegeerd${ignored.length ? ` (${ignored.length})` : ""}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setTab(key); setExpandedId(null); }}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 9, border: "none",
                background: tab === key ? "#fff" : "transparent",
                color: tab === key ? "#1c1c1e" : "#8e8e93",
                fontWeight: 600, fontSize: 14, cursor: "pointer",
                boxShadow: tab === key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Invoice list */}
        {list.length > 0 ? (
          <div style={{ marginBottom: 24 }}>
            {list.map((inv) => (
              <InvoiceCard
                key={inv.id}
                invoice={inv}
                mode={tab}
                expanded={expandedId === inv.id}
                onToggle={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                onConfirmPaid={() => setConfirmPaidFor(inv)}
                onIgnore={() => setIgnoreFor(inv)}
                onRestore={() => handleRestore(inv)}
              />
            ))}
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "48px 24px", color: "#8e8e93" }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>
              {tab === "pending" ? "✅" : "📭"}
            </div>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 8, color: "#1c1c1e" }}>
              {tab === "pending" ? "Alles bijgewerkt" : "Geen genegeerde facturen"}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              {tab === "pending"
                ? "Nieuwe facturen verschijnen hier zodra ze binnenkomen."
                : "Facturen die je negeert komen hier terecht."}
            </div>
          </div>
        )}

        {/* Manual upload — only on pending tab */}
        {tab === "pending" && <ManualUpload onUploaded={() => {}} />}
      </div>

      {/* Confirm-paid modal */}
      {confirmPaidFor && (
        <ConfirmPaidModal
          invoice={confirmPaidFor}
          onVerify={(amounts) => handleVerify(confirmPaidFor, amounts)}
          onPay={(amounts, method) => handlePay(confirmPaidFor, amounts, method)}
          onCancel={() => setConfirmPaidFor(null)}
        />
      )}

      {/* Ignore confirmation */}
      {ignoreFor && (
        <ConfirmDialog
          title="Factuur negeren?"
          message="De factuur wordt verplaatst naar Genegeerd. Je kunt hem later terugzetten."
          confirmLabel="Ja, negeer"
          confirmColor="#ff3b30"
          onConfirm={() => handleIgnore(ignoreFor)}
          onCancel={() => setIgnoreFor(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed", bottom: 32, left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(28,28,30,0.92)", color: "#fff",
            padding: "12px 20px", borderRadius: 20, fontSize: 14, fontWeight: 600,
            backdropFilter: "blur(12px)", whiteSpace: "nowrap", zIndex: 3000,
            boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}