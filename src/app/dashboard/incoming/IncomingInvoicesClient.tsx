"use client";
// src/app/dashboard/incoming/IncomingInvoicesClient.tsx
// [BOEK-011] Payment confirmation queue — incoming invoices from email
// Mobile-first, iOS-style design
// The client sees pending invoices and marks them as paid with one tap

import { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface IncomingInvoice {
  id: string;
  client_name: string;
  client_email: string | null;
  total_inc_btw: number;
  invoice_date: string;
  invoice_number: string;
  source: string;
  created_at: string;
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
  connectionStatus: ConnectionStatus;
}

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

// ── Email connect button ──────────────────────────────────────────────────────

function ConnectEmailCard({ status }: { status: ConnectionStatus }) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

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
          `${data.classified} facturen gevonden, ${data.saved} opgeslagen`
        );
        // Reload to show new invoices
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
    setDisconnecting(true);
    await fetch("/api/email/sync", { method: "DELETE" });
    window.location.reload();
  };

  if (status.connected) {
    const providerIcon = status.provider === "gmail" ? "📧" : "📮";
    const providerName = status.provider === "gmail" ? "Gmail" : "Outlook";

    return (
      <div
        style={{
          background: "var(--ios-secondary-bg, #f2f2f7)",
          borderRadius: 16,
          padding: "16px 20px",
          marginBottom: 24,
        }}
      >
        {/* Connection info */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 28 }}>{providerIcon}</span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 2,
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 15,
                  color: "var(--ios-label, #1c1c1e)",
                }}
              >
                {providerName} verbonden
              </span>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#34c759",
                  display: "inline-block",
                }}
              />
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--ios-secondary-label, #8e8e93)",
              }}
            >
              {status.email}
            </div>
          </div>
        </div>

        {/* Actions row */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              flex: 1,
              background: syncing
                ? "var(--ios-tertiary-bg, #e5e5ea)"
                : "#007aff",
              color: syncing ? "var(--ios-secondary-label, #8e8e93)" : "#fff",
              border: "none",
              borderRadius: 10,
              padding: "10px 0",
              fontWeight: 600,
              fontSize: 14,
              cursor: syncing ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
          >
            {syncing ? "Bezig…" : "Synchroniseer nu"}
          </button>

          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            style={{
              background: "transparent",
              border: "1.5px solid #ff3b30",
              color: "#ff3b30",
              borderRadius: 10,
              padding: "10px 16px",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Ontkoppel
          </button>
        </div>

        {syncResult && (
          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              color: syncResult.startsWith("Fout") ? "#ff3b30" : "#34c759",
              textAlign: "center",
            }}
          >
            {syncResult}
          </div>
        )}
      </div>
    );
  }

  // Not connected — show connect options
  return (
    <div
      style={{
        background: "var(--ios-secondary-bg, #f2f2f7)",
        borderRadius: 20,
        padding: "24px 20px",
        marginBottom: 24,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 44, marginBottom: 12 }}>📬</div>
      <div
        style={{
          fontWeight: 700,
          fontSize: 17,
          color: "var(--ios-label, #1c1c1e)",
          marginBottom: 8,
        }}
      >
        Verbind je e-mail
      </div>
      <div
        style={{
          fontSize: 14,
          color: "var(--ios-secondary-label, #8e8e93)",
          marginBottom: 24,
          lineHeight: 1.5,
          maxWidth: 280,
          margin: "0 auto 24px",
        }}
      >
        Facturen komen automatisch binnen — je hoeft niets meer door te sturen.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <a
          href="/api/email/connect?provider=gmail"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background: "#fff",
            border: "1.5px solid #e5e5ea",
            borderRadius: 12,
            padding: "14px 20px",
            textDecoration: "none",
            color: "var(--ios-label, #1c1c1e)",
            fontWeight: 600,
            fontSize: 15,
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          <span style={{ fontSize: 20 }}>📧</span>
          Verbind Gmail
        </a>

        <a
          href="/api/email/connect?provider=outlook"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background: "#fff",
            border: "1.5px solid #e5e5ea",
            borderRadius: 12,
            padding: "14px 20px",
            textDecoration: "none",
            color: "var(--ios-label, #1c1c1e)",
            fontWeight: 600,
            fontSize: 15,
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          <span style={{ fontSize: 20 }}>📮</span>
          Verbind Outlook
        </a>
      </div>
    </div>
  );
}

// ── Invoice card ──────────────────────────────────────────────────────────────

function InvoiceCard({
  invoice,
  onConfirmPaid,
  onDismiss,
}: {
  invoice: IncomingInvoice;
  onConfirmPaid: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [exiting, setExiting] = useState(false);

  const handlePaid = async () => {
    setConfirming(true);
    // Optimistic exit animation
    setTimeout(() => setExiting(true), 200);
    setTimeout(() => onConfirmPaid(invoice.id), 500);
  };

  const handleDismiss = () => {
    setDismissing(true);
    setExiting(true);
    setTimeout(() => onDismiss(invoice.id), 400);
  };

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 16,
        marginBottom: 12,
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
        opacity: exiting ? 0 : 1,
        transform: exiting ? "translateX(60px) scale(0.96)" : "none",
        maxHeight: exiting ? 0 : 300,
      }}
    >
      {/* Top: vendor + amount */}
      <div
        style={{
          padding: "16px 16px 12px",
          borderBottom: "1px solid #f2f2f7",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 16,
                color: "#1c1c1e",
                marginBottom: 3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {invoice.client_name || "Onbekende afzender"}
            </div>
            <div style={{ fontSize: 13, color: "#8e8e93" }}>
              {formatDate(invoice.invoice_date)}
            </div>
          </div>

          <div
            style={{
              fontWeight: 700,
              fontSize: 20,
              color: "#1c1c1e",
              letterSpacing: "-0.5px",
              whiteSpace: "nowrap",
            }}
          >
            {invoice.total_inc_btw > 0
              ? formatAmount(invoice.total_inc_btw)
              : "Bedrag onbekend"}
          </div>
        </div>

        {/* Source badge */}
        <div style={{ marginTop: 8 }}>
          <span
            style={{
              background: "#e5f3ff",
              color: "#007aff",
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 8px",
              borderRadius: 20,
              letterSpacing: 0.2,
            }}
          >
            {invoice.source === "email" ? "📧 E-mail" : "📎 Upload"}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
        }}
      >
        <button
          onClick={handleDismiss}
          disabled={dismissing || confirming}
          style={{
            padding: "14px 0",
            background: "transparent",
            border: "none",
            borderRight: "1px solid #f2f2f7",
            color: "#8e8e93",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Negeer
        </button>

        <button
          onClick={handlePaid}
          disabled={confirming || dismissing}
          style={{
            padding: "14px 0",
            background: confirming ? "#e5ffe9" : "transparent",
            border: "none",
            color: confirming ? "#34c759" : "#007aff",
            fontWeight: 700,
            fontSize: 14,
            cursor: confirming ? "default" : "pointer",
            transition: "all 0.2s",
          }}
        >
          {confirming ? "✓ Betaald" : "Markeer betaald"}
        </button>
      </div>
    </div>
  );
}

// ── Manual upload section ─────────────────────────────────────────────────────

function ManualUpload({
  onUploaded,
}: {
  onUploaded: (invoice: IncomingInvoice) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (uploading) return;

    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/heic"];
    if (!allowed.includes(file.type) && !file.name.endsWith(".pdf")) {
      alert("Alleen PDF of afbeelding toegestaan");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/email/upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.invoice) {
          onUploaded(data.invoice);
        }
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
          fontSize: 13,
          fontWeight: 600,
          color: "#8e8e93",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: 10,
        }}
      >
        Handmatig uploaden
      </div>

      <label
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          padding: "20px",
          border: `2px dashed ${dragOver ? "#007aff" : "#c7c7cc"}`,
          borderRadius: 16,
          background: dragOver ? "#f0f7ff" : "#fafafa",
          cursor: uploading ? "not-allowed" : "pointer",
          transition: "all 0.15s",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
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
        <span
          style={{
            fontSize: 14,
            color: uploading ? "#8e8e93" : "#007aff",
            fontWeight: 600,
          }}
        >
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
  connectionStatus,
}: Props) {
  const [invoices, setInvoices] = useState<IncomingInvoice[]>(initialInvoices);
  const [toast, setToast] = useState<string | null>(null);

  // Check URL params for OAuth result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");

    if (connected) {
      showToast(
        `${connected === "gmail" ? "Gmail" : "Outlook"} succesvol verbonden!`
      );
      window.history.replaceState({}, "", window.location.pathname);
    } else if (error) {
      const messages: Record<string, string> = {
        gmail_denied: "Gmail-toegang geweigerd",
        outlook_denied: "Outlook-toegang geweigerd",
        token_exchange_failed: "Verbinding mislukt — probeer opnieuw",
      };
      showToast(messages[error] || "Verbinding mislukt");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleConfirmPaid = useCallback(async (id: string) => {
    // Optimistic UI — remove immediately
    setInvoices((prev) => prev.filter((inv) => inv.id !== id));

    try {
      const res = await fetch(`/api/email/confirm/${id}`, { method: "POST" });
      if (!res.ok) {
        // Rollback — but we don't have the invoice anymore
        // In production: re-fetch from server
        showToast("Bevestiging mislukt — ververs de pagina");
      } else {
        showToast("✓ Factuur gemarkeerd als betaald");
      }
    } catch {
      showToast("Fout — ververs de pagina");
    }
  }, []);

  const handleDismiss = useCallback(async (id: string) => {
    setInvoices((prev) => prev.filter((inv) => inv.id !== id));
    // Soft delete / archive the incoming invoice
    await fetch(`/api/email/confirm/${id}`, {
      method: "DELETE",
    }).catch(() => {});
  }, []);

  const handleManualUpload = useCallback((invoice: IncomingInvoice) => {
    setInvoices((prev) => [invoice, ...prev]);
    showToast("Factuur toegevoegd");
  }, []);

  const pendingCount = invoices.length;

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        padding: "0 0 100px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "20px 20px 0",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <a
            href="/dashboard"
            style={{
              color: "#007aff",
              textDecoration: "none",
              fontSize: 17,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            ‹ Dashboard
          </a>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "#1c1c1e",
                margin: 0,
                letterSpacing: -0.5,
              }}
            >
              Inkomend
            </h1>
            <p
              style={{
                fontSize: 14,
                color: "#8e8e93",
                margin: "4px 0 0",
              }}
            >
              {pendingCount === 0
                ? "Alles verwerkt"
                : `${pendingCount} ${pendingCount === 1 ? "factuur" : "facturen"} wacht op bevestiging`}
            </p>
          </div>

          {pendingCount > 0 && (
            <div
              style={{
                background: "#ff3b30",
                color: "#fff",
                borderRadius: "50%",
                width: 28,
                height: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {pendingCount}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "0 16px" }}>
        {/* Connection card */}
        <ConnectEmailCard status={connectionStatus} />

        {/* Invoices list */}
        {pendingCount > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#8e8e93",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 10,
                paddingLeft: 4,
              }}
            >
              Wachten op bevestiging
            </div>

            {invoices.map((inv) => (
              <InvoiceCard
                key={inv.id}
                invoice={inv}
                onConfirmPaid={handleConfirmPaid}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        )}

        {/* Empty state when connected but no invoices */}
        {connectionStatus.connected && pendingCount === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "48px 24px",
              color: "#8e8e93",
            }}
          >
            <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 8, color: "#1c1c1e" }}>
              Alles bijgewerkt
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              Nieuwe facturen verschijnen hier zodra ze binnenkomen in je e-mail.
            </div>
          </div>
        )}

        {/* Manual upload */}
        <ManualUpload onUploaded={handleManualUpload} />
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 32,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(28,28,30,0.92)",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 20,
            fontSize: 14,
            fontWeight: 600,
            backdropFilter: "blur(12px)",
            whiteSpace: "nowrap",
            zIndex: 1000,
            boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}