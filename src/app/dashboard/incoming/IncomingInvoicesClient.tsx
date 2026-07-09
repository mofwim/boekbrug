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

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
// [BOEK-011] Centralized navigation — single source of truth across the app
import { useHomePath, useParentPath } from "@/lib/navigation-hooks";

// ── Types ─────────────────────────────────────────────────────────────────────

// [IMPORT-MONITOR] Read-time health verdict computed server-side (page.tsx via
// @/lib/import-health). Mirrored here so the client stays self-contained — the
// shape MUST match ImportHealth in @/lib/import-health.
interface ImportHealth {
  level: "clean" | "needs-review";
  // Plain-language Dutch reasons, owner-facing. Empty when level === 'clean'.
  reasons: string[];
  flags: {
    arithmetic: boolean;
    vendor: boolean;
    invoiceNumber: boolean;
    invoiceDate: boolean;
  };
}

interface IncomingInvoice {
  id: string;
  client_name: string;
  client_email: string | null;
  // [BRIDGE-CREDITNOTA-SIGN] 'creditnota' → amounts are NEGATIVE by design
  // (matching the paper + outgoing creditnota [BOEK-031]); drives the badge
  // and the signed amount display. Optional: the page select must include it
  // (patch note) — absent means 'factuur' (default).
  invoice_type?: string | null;
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
  // [BRIDGE-EXTRACT] per-field AI confidence (0–1) — flags weak fields in the modal
  field_confidence: {
    vendor?: number;
    invoice_number?: number;
    invoice_date?: number;
    // [SMART-INTAKE] intake suggestion: a kassabon routed here is likely paid.
    // A SUGGESTION only — the human confirms via "Markeer als betaald".
    _intake_kind?: string;     // 'receipt' when it came from the camera as a bon
    _intake_suggest?: string;  // 'paid' → surface "Markeer als betaald" prominently
  } | null;
  // [IMPORT-MONITOR] import-health verdict — drives the calm/attention surface
  health: ImportHealth;
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

// [BRIDGE-CREDITNOTA-SIGN] Amount display that keeps the SIGN. The old
// `x > 0 ? format : "—"` guard rendered every creditnota amount (negative by
// design, matching [BOEK-031] outgoing) as "—" — the bug in the screenshot.
// Now: 0/absent/non-finite → "—" (unchanged for empty invoices); any other
// finite value (positive OR negative) → formatted with its sign.
// NL_CURRENCY renders negatives natively (e.g. "€ -4,84").
function formatSignedAmount(amount: number): string {
  return Number.isFinite(amount) && amount !== 0 ? NL_CURRENCY.format(amount) : "—";
}

// ── Email connect card ────────────────────────────────────────────────────────

function ConnectEmailCard({ status }: { status: ConnectionStatus }) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // [BOEK-011] One tap = full import. The server caps each call at 25 new
  // invoices (function time limit); it reports `remaining` and we simply call
  // again until the backlog is drained — with live progress so the user sees
  // "Bezig… 25 van 61" instead of a silent partial import. MAX_ROUNDS guards
  // against a server bug ever looping us forever.
  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);

    const MAX_ROUNDS = 12; // 12 × 25 = 300 invoices per tap — plenty
    let totalSaved = 0;
    let totalFound = 0;
    let round = 0;
    // [BOEK-TRUST] Accumulate the balance buckets across all rounds so the final
    // message can reassure honestly: everything fetched this session landed in a
    // known bucket (imported / skipped / duplicate), or is being retried.
    let totalSkipped = 0;
    let totalDuplicate = 0;
    let totalErrors = 0;
    let anyUnbalanced = false;
    // [BOEK-011] No-progress guard: if a round saves nothing AND remaining
    // didn't shrink, looping again would just repeat the same work. Stop and
    // tell the user honestly instead of spinning.
    let lastRemaining = Number.POSITIVE_INFINITY;

    try {
      while (round < MAX_ROUNDS) {
        round++;
        const res = await fetch("/api/email/sync", { method: "POST" });
        const data = await res.json();

        if (data.error) {
          setSyncResult(`Fout: ${data.error}`);
          setSyncing(false);
          return;
        }

        totalSaved += data.saved ?? 0;
        totalFound += data.verified ?? 0;
        // [BOEK-TRUST] Roll up the reconciliation buckets.
        if (data.balance) {
          totalSkipped += data.balance.skipped ?? 0;
          totalDuplicate += data.balance.duplicate ?? 0;
          if (data.balance.balanced === false) anyUnbalanced = true;
        }
        totalErrors += data.errors ?? 0;
        const remaining = data.remaining ?? 0;

        if (remaining > 0) {
          // [BOEK-011] Progress = invoices saved OR non-invoices registered.
          // A batch that's all logos saves 0 but still shrinks the backlog
          // (those attachments are now in the skip registry). Only flag "no
          // progress" when NOTHING advanced AND remaining didn't fall.
          const advanced = (data.saved ?? 0) > 0 || (data.skipped ?? 0) > 0;
          const noProgress = !advanced && remaining >= lastRemaining;
          if (noProgress) {
            setSyncResult(
              totalSaved > 0
                ? `${totalSaved} opgeslagen — de rest kon nu niet verwerkt worden, probeer later opnieuw`
                : "Er kon nu niets verwerkt worden — probeer het later opnieuw"
            );
            setSyncing(false);
            return;
          }
          lastRemaining = remaining;
          // Live progress — the denominator grows as we learn about the backlog
          setSyncResult(
            `Bezig met importeren… ${totalSaved} opgeslagen, nog ~${remaining} te gaan`
          );
          continue; // next batch immediately
        }

        // [BOEK-TRUST] Done — honest, reassuring summary built from the balance.
        // The reassurance the owner opens the app for: everything that arrived
        // is accounted for. We keep it to one calm line; details stay implicit.
        //   · normal case → "X geïmporteerd. Alles is verwerkt."
        //   · some retried → name it plainly, it's not a loss (next sync retries)
        //   · rare gap    → "even controleren" without alarm
        let message: string;
        if (anyUnbalanced) {
          message = `${totalSaved} geïmporteerd — we controleren nog een paar items`;
        } else if (totalErrors > 0) {
          message = `${totalSaved} geïmporteerd. ${totalErrors} worden zo opnieuw geprobeerd.`;
        } else {
          const extra = totalSkipped + totalDuplicate;
          message =
            extra > 0
              ? `${totalSaved} geïmporteerd. Alles is verwerkt (${extra} overgeslagen of al aanwezig).`
              : `${totalSaved} geïmporteerd. Alles is verwerkt.`;
        }
        setSyncResult(message);
        setTimeout(() => window.location.reload(), 1500);
        return;
      }

      // MAX_ROUNDS hit — extremely large mailbox; be honest, let them tap again
      setSyncResult(
        `${totalSaved} opgeslagen — er staan er nog meer klaar, synchroniseer opnieuw`
      );
    } catch {
      setSyncResult(
        totalSaved > 0
          ? `${totalSaved} opgeslagen — verbinding onderbroken, synchroniseer opnieuw voor de rest`
          : "Sync mislukt — probeer opnieuw"
      );
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
  // [QUEUE-EDIT-UX] When true, the modal opens with the edit fields already
  // active — the card's "Bewerken" entry point skips the extra
  // "Gegevens aanpassen" tap. Optional: the normal Verifiëren flow is unchanged.
  startEditing = false,
}: {
  invoice: IncomingInvoice;
  // [BRIDGE-B] verify → becomes a SHARED Crediteur (unpaid). pay → mark paid (needs method).
  // [BRIDGE-EXTRACT] amounts now also carries reviewed client_name/invoice_number/invoice_date.
  onVerify: (amounts: {
    total_ex_btw: number; btw_amount: number; total_inc_btw: number;
    client_name: string; invoice_number: string; invoice_date: string;
  }) => void;
  onPay: (
    amounts: {
      total_ex_btw: number; btw_amount: number; total_inc_btw: number;
      client_name: string; invoice_number: string; invoice_date: string;
    },
    method: "bank" | "kas",
    // [BRIDGE-QUARTER] real payment date (YYYY-MM-DD) — Axis 2 / cash
    paymentDate: string
  ) => void;
  onCancel: () => void;
  // [QUEUE-EDIT-UX] open with edit fields active (card "Bewerken" entry point)
  startEditing?: boolean;
}) {
  const [exBtw, setExBtw] = useState(invoice.total_ex_btw || 0);
  const [btwAmount, setBtwAmount] = useState(invoice.btw_amount || 0);
  // [BRIDGE-EXTRACT] inline edit of the AI-extracted vendor / number / date.
  // Edited alongside amounts under the same "Bedragen aanpassen" toggle.
  const [vendor, setVendor] = useState(invoice.client_name || "");
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoice_number || "");
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoice_date || "");
  const [submitting, setSubmitting] = useState(false);
  // [BRIDGE-B] payStep = showing the Bank/Contant choice (after "Markeer als betaald")
  const [payStep, setPayStep] = useState(false);
  // [BRIDGE-QUARTER] real payment date (defaults to today) + confirmation amount.
  // confirmAmount is UI-only for now (NOT stored) — explicit defer per brief §2.
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [confirmAmount, setConfirmAmount] = useState("");

  // Total is always derived — never edited directly. This IS TRAIL 2: excl + BTW = incl.
  const totalIncBtw = exBtw + btwAmount;

  // [BRIDGE-B] TRAIL 3 — legal BTW rate must round to 0 / 9 / 21. FLAG, never block.
  // [BTW-MIXED-RATE] A blended rate (e.g. 9%+21% food invoice → ~11%) is valid:
  // any value 0–21 can be a mix of legal NL rates. Only < 0 or > 21 is impossible.
  // [BRIDGE-CREDITNOTA-SIGN] abs-guard instead of `exBtw > 0`: on a creditnota
  // both values are negative (neg ÷ neg = a positive rate), so the check now
  // runs there too instead of being silently skipped.
  const btwRate = Math.abs(exBtw) > 0.005 ? Math.round((btwAmount / exBtw) * 100) : null;
  const rateFlag = btwRate !== null && (btwRate < 0 || btwRate > 21);

  // [BRIDGE-EXTRACT] N-N page-number pattern in the invoice number → soft flag
  // (e.g. "1-1" likely a page indicator the AI mistook for a number). Never blocks.
  const numberFlag = /^\d{1,2}\s*[-/]\s*\d{1,2}$/.test(invoiceNumber.trim());

  // [BRIDGE-EXTRACT] Per-field low-confidence flags — the AI told us which fields
  // it was unsure about. Threshold 0.7: below = ask the user to confirm. An empty
  // field (guard nulled it → conf 0) also flags. These are SOFT (never block).
  const fc = invoice.field_confidence;
  const LOW = 0.7;
  const vendorLow = (fc?.vendor ?? 1) < LOW || !vendor.trim();
  const numberLow = (fc?.invoice_number ?? 1) < LOW || numberFlag;
  const dateLow = (fc?.invoice_date ?? 1) < LOW;
  const anyLow = vendorLow || numberLow || dateLow;

  // Auto-open the edit fields when the AI flagged any field as uncertain, so the
  // user lands directly on what needs confirming instead of having to find it.
  // [QUEUE-EDIT-UX] Also open when entered via the card's "Bewerken" button.
  const [editing, setEditing] = useState(anyLow || startEditing);

  const amounts = {
    total_ex_btw: exBtw,
    btw_amount: btwAmount,
    total_inc_btw: totalIncBtw,
    // [BRIDGE-EXTRACT] reviewed metadata — persisted by the confirm route
    client_name: vendor.trim(),
    invoice_number: invoiceNumber.trim(),
    invoice_date: invoiceDate.trim(),
  };

  const handleVerify = () => {
    setSubmitting(true);
    onVerify(amounts);
  };
  const handlePay = (method: "bank" | "kas") => {
    setSubmitting(true);
    onPay(amounts, method, paymentDate);
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

            {/* [IMPORT-MONITOR] Part 3 — surface the arithmetic WHY in the modal.
                The per-field ⚠️ flags below already cover vendor/number/date and
                an unexpected BTW rate. This adds the one thing the modal never
                showed: the stored _safecore reason from an email-path arithmetic
                hold (e.g. "excl + BTW ≠ totaal"), so the owner sees exactly what
                to fix. Only renders when the health verdict flags arithmetic and
                a concrete reason exists. */}
            {invoice.health.flags.arithmetic &&
              invoice.health.reasons.length > 0 && (
                <div
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    padding: "12px 14px", marginBottom: 16,
                    background: "#fff4e5", borderRadius: 12,
                    border: "1px solid #ffd9a8",
                  }}
                >
                  <span style={{ fontSize: 15, lineHeight: 1.3 }}>⚠️</span>
                  <span style={{ fontSize: 12.5, color: "#9a5b00", lineHeight: 1.5 }}>
                    {invoice.health.reasons
                      .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
                      .join(" · ")}
                    . Controleer en pas de bedragen aan.
                  </span>
                </div>
              )}

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

            {/* [BRIDGE-EXTRACT] Vendor / number / date — editable under the same toggle */}
            <div
              style={{
                background: "#f2f2f7", borderRadius: 14,
                padding: "16px", marginBottom: 16,
              }}
            >
              {/* [BRIDGE-EXTRACT] AI-uncertainty banner — asks the user to confirm
                  the specific fields the AI was not sure about. Soft, never blocks. */}
              {anyLow && (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "10px 12px", marginBottom: 14,
                  background: "#fff4e5", borderRadius: 10,
                  border: "1px solid #ffd9a8",
                }}>
                  <span style={{ fontSize: 14, lineHeight: 1.3 }}>💡</span>
                  <span style={{ fontSize: 12.5, color: "#9a5b00", lineHeight: 1.4 }}>
                    De AI was niet zeker over{" "}
                    {[
                      vendorLow ? "de leverancier" : null,
                      numberLow ? "het factuurnummer" : null,
                      dateLow ? "de factuurdatum" : null,
                    ].filter(Boolean).join(", ")}
                    . Controleer en pas aan waar nodig.
                  </span>
                </div>
              )}

              {/* Vendor */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 }}>
                <span style={{ fontSize: 14, color: vendorLow ? "#EA8600" : "#6b6b6e", flexShrink: 0, fontWeight: vendorLow ? 600 : 400 }}>
                  Leverancier {vendorLow && "⚠️"}
                </span>
                {editing ? (
                  <input
                    type="text"
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    style={{
                      flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 15,
                      borderRadius: 8, border: "1.5px solid #007aff",
                      textAlign: "right", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#1c1c1e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {vendor || "—"}
                  </span>
                )}
              </div>

              {/* Invoice number */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: numberFlag ? 6 : 12, gap: 10 }}>
                <span style={{ fontSize: 14, color: "#6b6b6e", flexShrink: 0 }}>Factuurnummer</span>
                {editing ? (
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    style={{
                      flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 15,
                      borderRadius: 8,
                      border: `1.5px solid ${numberFlag ? "#EA8600" : "#007aff"}`,
                      textAlign: "right", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: numberFlag ? "#EA8600" : "#1c1c1e" }}>
                    {invoiceNumber || "—"}
                  </span>
                )}
              </div>

              {/* [BRIDGE-EXTRACT] N-N flag — likely a page number, not an invoice number */}
              {numberFlag && (
                <div style={{ fontSize: 12, color: "#EA8600", lineHeight: 1.4, marginBottom: 12, display: "flex", gap: 6 }}>
                  <span>⚠️</span>
                  <span>"{invoiceNumber}" lijkt een paginanummer — controleer het factuurnummer.</span>
                </div>
              )}

              {/* Invoice date */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, color: dateLow ? "#EA8600" : "#6b6b6e", flexShrink: 0, fontWeight: dateLow ? 600 : 400 }}>
                  Factuurdatum {dateLow && "⚠️"}
                </span>
                {editing ? (
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    style={{
                      padding: "6px 10px", fontSize: 15,
                      borderRadius: 8, border: "1.5px solid #007aff",
                      textAlign: "right", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#1c1c1e" }}>
                    {/* [QUEUE-EDIT-UX] NL format (19-05-2026), not raw ISO — the
                        card already does this; the modal forgot. The edit
                        <input type="date"> keeps ISO (browser requirement). */}
                    {invoiceDate ? formatDate(invoiceDate) : "—"}
                  </span>
                )}
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
                {/* [QUEUE-EDIT-UX] "Gegevens" not "Bedragen" — the toggle also
                    opens vendor / invoice number / date, not just amounts. */}
                Gegevens aanpassen
              </button>
            )}

            {/* [SMART-INTAKE] When the intake router flagged this as a paid bon,
                surface "Markeer als betaald" as the PRIMARY action (the human
                still confirms Bank/Contant). Otherwise the normal order:
                verify (unpaid Crediteur) primary, mark-paid secondary. */}
            {fc?._intake_suggest === "paid" ? (
              <>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
                  padding: "8px 12px", borderRadius: 10, background: "#e8f5e9",
                  color: "#1b5e20", fontSize: 13, fontWeight: 600,
                }}>
                  <span style={{ fontSize: 16 }}>🧾</span>
                  Kassabon — waarschijnlijk al betaald. Controleer en bevestig.
                </div>

                {/* PRIMARY — mark as paid (suggested for a bon) */}
                <button
                  onClick={() => setPayStep(true)}
                  disabled={submitting}
                  style={{
                    width: "100%", padding: "16px", borderRadius: 14,
                    background: submitting ? "#c7c7cc" : "#34c759",
                    color: "#fff", border: "none", fontWeight: 700, fontSize: 16,
                    cursor: submitting ? "not-allowed" : "pointer", marginBottom: 8,
                  }}
                >
                  Markeer als betaald
                </button>

                {/* SECONDARY — verify as unpaid (if the bon is actually not paid) */}
                <button
                  onClick={handleVerify}
                  disabled={submitting}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 14,
                    background: "#eef4ff", color: "#007aff",
                    border: "1.5px solid #007aff",
                    fontWeight: 600, fontSize: 15,
                    cursor: submitting ? "not-allowed" : "pointer", marginBottom: 8,
                  }}
                >
                  {submitting ? "Bezig…" : "Toch niet betaald — verifieer"}
                </button>
              </>
            ) : (
              <>
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
              </>
            )}

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

            {/* [BRIDGE-QUARTER] Real payment date — the day the money actually
                moved. Defaults to today; the user corrects it if they paid earlier. */}
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1c1c1e", marginBottom: 6 }}>
              Betaaldatum
            </label>
            <input
              type="date"
              value={paymentDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setPaymentDate(e.target.value)}
              disabled={submitting}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 12,
                border: "1px solid #d1d1d6", fontSize: 15, marginBottom: 14,
                fontFamily: "inherit", color: "#1c1c1e", background: "#fff",
                boxSizing: "border-box",
              }}
            />

            {/* [BRIDGE-QUARTER] Confirmation amount — UI only for now (not stored).
                Explicit defer per brief §2: helps the user sanity-check, no DB write. */}
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1c1c1e", marginBottom: 6 }}>
              Betaald bedrag <span style={{ color: "#8e8e93", fontWeight: 400 }}>(optioneel)</span>
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder={totalIncBtw.toFixed(2)}
              value={confirmAmount}
              onChange={(e) => setConfirmAmount(e.target.value)}
              disabled={submitting}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 12,
                border: "1px solid #d1d1d6", fontSize: 15, marginBottom: 20,
                fontFamily: "inherit", color: "#1c1c1e", background: "#fff",
                boxSizing: "border-box",
              }}
            />

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
  // [QUEUE-EDIT-UX] opens the same verify modal with edit fields active
  onEdit,
  onIgnore,
  onRestore,
  selectMode = false,
  selected = false,
  onSelect = () => {},
  // [INTAKE-FOCUS] deep-link target: element id for scrollIntoView + brief ring
  domId,
  highlighted = false,
}: {
  invoice: IncomingInvoice;
  mode: Tab;
  expanded: boolean;
  onToggle: () => void;
  onConfirmPaid: () => void;
  // [QUEUE-EDIT-UX] card-level edit entry point (pending tab only)
  onEdit: () => void;
  onIgnore: () => void;
  onRestore: () => void;
  // [INTAKE-VERIFY-BULK] selection (pending bulk-verify)
  selectMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  // [INTAKE-FOCUS]
  domId?: string;
  highlighted?: boolean;
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
      id={domId}
      style={{
        background: "#fff", borderRadius: 16, marginBottom: 12,
        overflow: "hidden",
        // [INTAKE-FOCUS] brief ring when deep-linked from the upload results
        // modal; scrollMarginTop keeps the card clear of the sticky header.
        boxShadow: highlighted
          ? "0 1px 4px rgba(0,0,0,0.08), 0 0 0 3px rgba(0,122,255,0.35)"
          : "0 1px 4px rgba(0,0,0,0.08)",
        transition: "box-shadow 0.5s ease",
        scrollMarginTop: 96,
      }}
    >
      {/* Header — always visible, tappable */}
      <button
        onClick={selectMode ? onSelect : onToggle}
        style={{
          width: "100%", padding: "16px", border: "none",
          background: "transparent", cursor: "pointer", textAlign: "left",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 12,
        }}
      >
        {/* [INTAKE-VERIFY-BULK] selection checkbox — only in pending select mode */}
        {selectMode && (
          <span
            style={{
              flexShrink: 0, width: 22, height: 22, borderRadius: 11,
              border: `2px solid ${selected ? "#34c759" : "#c7c7cc"}`,
              background: selected ? "#34c759" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 13, fontWeight: 700,
            }}
          >
            {selected ? "✓" : ""}
          </span>
        )}
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
          {/* [BRIDGE-CREDITNOTA-SIGN] Creditnota badge — a credit note is a
              DIFFERENT financial animal (negative amounts by design), so the
              owner must see it at a glance. Independent of the health badge:
              a clean creditnota shows Creditnota + "ready", a broken one shows
              Creditnota + "Aandacht nodig". */}
          {invoice.invoice_type === "creditnota" && (
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                marginTop: 6, marginRight: 6, padding: "3px 9px", borderRadius: 8,
                background: "#fdecea", border: "1px solid #f5b5ae",
              }}
            >
              <span style={{ fontSize: 12, color: "#b3261e", fontWeight: 600 }}>
                Creditnota
              </span>
            </div>
          )}
          {/* [IMPORT-MONITOR] Health badge — only in the pending queue. Flagged
              invoices get a calm-but-clear attention pill; clean invoices get a
              quiet "ready to confirm" hint (calm, never the alarming "review").
              The ignored tab shows nothing here — it must not nag. */}
          {mode === "pending" && (
            invoice.health.level === "needs-review" ? (
              <div
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  marginTop: 6, padding: "3px 9px", borderRadius: 8,
                  background: "#fff4e5", border: "1px solid #ffd9a8",
                }}
              >
                <span style={{ fontSize: 11 }}>⚠️</span>
                <span style={{ fontSize: 12, color: "#9a5b00", fontWeight: 600 }}>
                  Aandacht nodig
                </span>
              </div>
            ) : (
              <div
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  marginTop: 6,
                }}
              >
                <span style={{ fontSize: 11, color: "#34c759" }}>✓</span>
                <span style={{ fontSize: 12, color: "#8e8e93" }}>
                  Klaar om te bevestigen
                </span>
              </div>
            )
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 18, color: "#1c1c1e", whiteSpace: "nowrap" }}>
            {formatSignedAmount(invoice.total_inc_btw)}
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

          {/* [IMPORT-MONITOR] Part 3 — the WHY. For a flagged invoice, show the
              plain-language reason(s) the system is unsure, sourced from the
              read-time health verdict (stored _safecore reason and/or the AI's
              low-confidence fields). Reassurance-shaped: "here's what to check",
              not a dense breakdown. Shown only in the pending queue; clean
              invoices show nothing here (no demand on the tired owner). */}
          {mode === "pending" &&
            invoice.health.level === "needs-review" &&
            invoice.health.reasons.length > 0 && (
              <div
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "12px 14px", marginBottom: 14,
                  background: "#fff4e5", borderRadius: 12,
                  border: "1px solid #ffd9a8",
                }}
              >
                <span style={{ fontSize: 15, lineHeight: 1.3 }}>💡</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#9a5b00", marginBottom: 4 }}>
                    Even controleren
                  </div>
                  <div style={{ fontSize: 12.5, color: "#9a5b00", lineHeight: 1.5 }}>
                    {/* Capitalize the first reason; join the rest naturally. */}
                    {invoice.health.reasons
                      .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
                      .join(" · ")}
                    .
                  </div>
                </div>
              </div>
            )}

          {/* Detail rows */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            <DetailRow label="Factuurnummer" value={invoice.invoice_number || "—"} />
            <DetailRow label="Afzender" value={invoice.client_email || "—"} />
            <DetailRow
              label="Bedrag excl. BTW"
              value={formatSignedAmount(invoice.total_ex_btw)}
            />
            <DetailRow
              label="BTW"
              value={formatSignedAmount(invoice.btw_amount)}
            />
            <DetailRow
              label="Totaal"
              value={formatSignedAmount(invoice.total_inc_btw)}
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
              {/* [QUEUE-EDIT-UX] Direct edit entry — same verify modal, edit
                  fields already open. Saves the Verifiëren→Gegevens-aanpassen
                  detour when the owner already knows something needs fixing. */}
              <button
                onClick={onEdit}
                style={{
                  flex: 1, padding: "13px 0", borderRadius: 12,
                  background: "#eaf2ff", border: "none", color: "#007aff",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                Bewerken
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

// [INTAKE-FEEDBACK] Per-file outcome shown in the results modal.
type IntakeResult = {
  name: string;
  status: "invoice" | "document" | "bank" | "duplicate" | "error";
  message: string;
  // present for document / duplicate → deep-link + focus in Mijn bestanden
  link?: { folderId: string | null; focusId: string };
  // [INTAKE-FOCUS] present for invoice/receipt → "Naar controle →" deep-links to
  // this card in the verify queue (?focus=). The API always returned invoice_id;
  // the modal just never used it — the owner was told "controleer en bevestig"
  // without a path to the invoice.
  invoiceId?: string;
};

const RESULT_META: Record<IntakeResult["status"], { icon: string; color: string }> = {
  invoice:   { icon: "✓",  color: "#34c759" },
  document:  { icon: "📁", color: "#007aff" },
  bank:      { icon: "🏦", color: "#007aff" },
  duplicate: { icon: "ℹ️", color: "#8e8e93" },
  error:     { icon: "⚠️", color: "#b3261e" },
};

function ManualUpload({ onUploaded }: { onUploaded: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // [SMART-INTAKE-B] separate camera input (capture) alongside the file input
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // [INTAKE-MULTI] batch progress
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  // [INTAKE-FEEDBACK] results modal — tells the user WHERE each file landed
  const [results, setResults] = useState<IntakeResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  // [INTAKE-MULTI] Max files per batch — protects the server / AI from a huge drop.
  const MAX_BATCH = 20;

  const isOkType = (file: File) =>
    file.type === "application/pdf" ||
    file.type.startsWith("image/") ||
    file.name.toLowerCase().endsWith(".pdf") ||
    /\.(xml|mt940|sta|camt|053|txt)$/i.test(file.name);

  // [INTAKE-FEEDBACK] Upload one file via /api/intake and map the response to a
  // structured outcome (never throws) — the modal renders the destination.
  const uploadOne = async (file: File): Promise<IntakeResult> => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/intake", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));

      if (res.ok) {
        const dest = (data as { destination?: string }).destination;
        const message = (data as { message?: string }).message || "Toegevoegd";
        if (dest === "document") {
          const docId = (data as { document_id?: string }).document_id;
          return {
            name: file.name, status: "document", message,
            link: docId ? { folderId: (data as { folder_id?: string }).folder_id ?? null, focusId: docId } : undefined,
          };
        }
        if (dest === "bank") {
          return { name: file.name, status: "bank", message };
        }
        // invoice | receipt → lives in this verify queue
        // [INTAKE-FOCUS] keep invoice_id so the row can deep-link to the card
        return {
          name: file.name, status: "invoice", message,
          invoiceId: (data as { invoice_id?: string }).invoice_id,
        };
      }

      // Not ok — duplicate is informative, not a failure.
      if ((data as { duplicate?: boolean }).duplicate) {
        const existing = (data as { existing?: { id: string; folder_id: string | null } }).existing;
        return {
          name: file.name, status: "duplicate",
          message: (data as { error?: string }).error || "Al toegevoegd",
          link: existing?.id ? { folderId: existing.folder_id ?? null, focusId: existing.id } : undefined,
        };
      }
      return { name: file.name, status: "error", message: (data as { error?: string }).error || "Upload mislukt" };
    } catch {
      return { name: file.name, status: "error", message: "Upload mislukt — probeer opnieuw" };
    }
  };

  // [INTAKE-FEEDBACK] Sequential batch — collect every outcome, then show the
  // results modal. No silent reload: the user sees where each file went, and
  // reloads (to refresh the queue) only when they tap "Klaar".
  const handleFiles = async (fileList: FileList | null) => {
    if (uploading || !fileList || fileList.length === 0) return;

    const all = Array.from(fileList);
    if (all.length > MAX_BATCH) {
      alert(`Maximaal ${MAX_BATCH} bestanden per keer. Je koos er ${all.length}.`);
      return;
    }

    const accepted: File[] = [];
    const collected: IntakeResult[] = [];
    for (const f of all) {
      if (isOkType(f)) accepted.push(f);
      else collected.push({ name: f.name, status: "error", message: "Niet ondersteund bestandstype" });
    }

    if (accepted.length === 0) {
      setResults(collected);
      setShowResults(true);
      return;
    }

    setUploading(true);
    setTotal(accepted.length);
    for (let i = 0; i < accepted.length; i++) {
      setCurrent(i + 1);
      collected.push(await uploadOne(accepted[i]));
    }
    setUploading(false);
    setCurrent(0);
    setTotal(0);

    onUploaded();
    setResults(collected);
    setShowResults(true);
  };

  // [INTAKE-FEEDBACK] Close the modal AND refresh so new invoices show in the queue.
  const closeResults = () => {
    setShowResults(false);
    window.location.reload();
  };

  const openInBestanden = (link: { folderId: string | null; focusId: string }) => {
    window.location.href = `/dashboard/bestanden?folder=${link.folderId ?? ""}&focus=${link.focusId}`;
  };

  // [INTAKE-FOCUS] "Naar controle →" — same full-navigation pattern as
  // openInBestanden/closeResults (this page reloads anyway to refresh the
  // queue); ?focus= makes the main component expand + scroll + ring the card.
  const goToInvoice = (invoiceId: string) => {
    window.location.href = `/dashboard/incoming?focus=${invoiceId}`;
  };

  const addedCount = results.filter((r) => r.status === "invoice" || r.status === "document" || r.status === "bank").length;

  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          fontSize: 13, fontWeight: 600, color: "#8e8e93",
          textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
        }}
      >
        Toevoegen
      </div>

      {/* [SMART-INTAKE-B] Camera button — fast path for the cashier (10 sec) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      <button
        onClick={() => !uploading && cameraInputRef.current?.click()}
        disabled={uploading}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          width: "100%", padding: "16px", borderRadius: 16, marginBottom: 10,
          background: uploading ? "#c7c7cc" : "#007aff", color: "#fff",
          border: "none", fontWeight: 700, fontSize: 16,
          cursor: uploading ? "not-allowed" : "pointer",
        }}
      >
        <span style={{ fontSize: 20 }}>📷</span>
        {uploading ? "Verwerken…" : "Foto maken"}
      </button>

      {/* File / drag-drop (PDF, image, bank statement) — [INTAKE-MULTI] multiple */}
      <label
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          padding: "20px", borderRadius: 16,
          border: `2px dashed ${dragOver ? "#007aff" : "#c7c7cc"}`,
          background: dragOver ? "#f0f7ff" : "#fafafa",
          cursor: uploading ? "not-allowed" : "pointer",
        }}
        onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          multiple
          accept=".pdf,image/*,.xml,.mt940,.sta,.camt,.053,.txt"
          style={{ display: "none" }}
          disabled={uploading}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />
        <span style={{ fontSize: 28 }}>{uploading ? "⏳" : "📎"}</span>
        <span style={{ fontSize: 14, color: uploading ? "#8e8e93" : "#007aff", fontWeight: 600 }}>
          {uploading
            ? (total > 1 ? `${current} van ${total} verwerkt…` : "Verwerken…")
            : "Kies bestanden of sleep hier naartoe"}
        </span>
        <span style={{ fontSize: 12, color: "#8e8e93" }}>
          PDF, afbeelding of bankafschrift — meerdere tegelijk
        </span>

        {/* [INTAKE-MULTI] Batch progress bar */}
        {uploading && total > 1 && (
          <div style={{ width: "100%", height: 4, background: "#e5e5ea", borderRadius: 9999, overflow: "hidden", marginTop: 4 }}>
            <div style={{
              width: `${Math.round((current / total) * 100)}%`,
              height: "100%", background: "#007aff", borderRadius: 9999,
              transition: "width 0.3s cubic-bezier(0.4,0,0.2,1)",
            }} />
          </div>
        )}
      </label>

      {/* [INTAKE-FEEDBACK] Results modal — where did each file go? */}
      {showResults && results.length > 0 && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000 }}
          onClick={closeResults}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: "20px 20px 0 0", padding: "24px 20px",
              paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
              width: "100%", maxWidth: 430, maxHeight: "80vh", overflowY: "auto",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 19, color: "#1c1c1e", marginBottom: 4 }}>
              {addedCount > 0
                ? `${addedCount} bestand${addedCount > 1 ? "en" : ""} toegevoegd`
                : "Klaar"}
            </div>
            <div style={{ fontSize: 14, color: "#8e8e93", marginBottom: 16 }}>
              Dit is er met je {results.length > 1 ? "bestanden" : "bestand"} gebeurd:
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {results.map((r, i) => {
                const meta = RESULT_META[r.status];
                return (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 12, background: "#f7f7f9" }}>
                    <span style={{ fontSize: 16, lineHeight: "20px" }}>{meta.icon}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "#1c1c1e", margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.name}
                      </p>
                      <p style={{ fontSize: 12, color: meta.color, margin: 0 }}>{r.message}</p>
                      {r.link && (
                        <button
                          type="button"
                          onClick={() => openInBestanden(r.link!)}
                          style={{ marginTop: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: "#007aff", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}
                        >
                          Bekijk in bestanden →
                        </button>
                      )}
                      {/* [INTAKE-FOCUS] Invoice/receipt landed in THIS queue,
                          hidden behind this modal — give the owner the path to
                          it instead of just "controleer en bevestig". */}
                      {r.status === "invoice" && r.invoiceId && (
                        <button
                          type="button"
                          onClick={() => goToInvoice(r.invoiceId!)}
                          style={{ marginTop: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: "#007aff", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}
                        >
                          Naar controle →
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={closeResults}
              style={{
                width: "100%", padding: "16px", borderRadius: 14,
                background: "#34c759", color: "#fff", border: "none",
                fontWeight: 700, fontSize: 16, cursor: "pointer",
              }}
            >
              Klaar
            </button>
          </div>
        </div>
      )}
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

  // [INTAKE-FOCUS] Deep-link target from the upload results modal
  // ("Naar controle →" navigates to /dashboard/incoming?focus={invoiceId}).
  // On mount: expand the card, scroll it into view, show a brief ring, then
  // clean the param so a later manual refresh doesn't re-trigger. Reading
  // window.location (client-only) avoids the useSearchParams Suspense
  // requirement — this effect never runs on the server.
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("focus");
    if (!id) return;
    setFocusId(id);
    setExpandedId(id);
    window.history.replaceState({}, "", window.location.pathname);
    const t = setTimeout(() => setFocusId(null), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!focusId) return;
    // rAF: let the (possibly expanded) card lay out before we scroll to it.
    requestAnimationFrame(() => {
      document
        .getElementById(`incoming-card-${focusId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [focusId, pending]);

  // Modal state
  const [confirmPaidFor, setConfirmPaidFor] = useState<IncomingInvoice | null>(null);
  // [QUEUE-EDIT-UX] card "Bewerken" → same verify modal, edit fields pre-opened.
  const [editFor, setEditFor] = useState<IncomingInvoice | null>(null);
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
      amounts: {
        total_ex_btw: number; btw_amount: number; total_inc_btw: number;
        client_name: string; invoice_number: string; invoice_date: string;
      }
    ) => {
      // Optimistic — remove from pending
      setPending((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setConfirmPaidFor(null);
      setEditFor(null); // [QUEUE-EDIT-UX] close whichever entry point opened the modal
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

  // ── [INTAKE-VERIFY-BULK] Bulk verify — select many → confirm via modal ──
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  // "Selecteer alle" picks only the READY ones (health ok); needs-review invoices
  // stay out so they get individual attention.
  const selectAllReady = () => {
    setSelected(new Set(
      pending.filter((p) => p.health.level !== "needs-review").map((p) => p.id)
    ));
  };

  // Sequential batch verify — uses each invoice's extracted amounts as-is (no
  // per-invoice review). Optimistic remove on success; partial failures reported.
  const handleVerifyBatch = useCallback(async () => {
    const targets = pending.filter((p) => selected.has(p.id));
    if (targets.length === 0) return;
    setBulkConfirmOpen(false);
    setBulkRunning(true);

    let ok = 0;
    const failedNames: string[] = [];
    for (const inv of targets) {
      try {
        const res = await fetch(`/api/email/confirm/${inv.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "verify",
            total_ex_btw: inv.total_ex_btw,
            btw_amount: inv.btw_amount,
            total_inc_btw: inv.total_inc_btw,
            client_name: inv.client_name,
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
          }),
        });
        if (res.ok) {
          ok++;
          setPending((prev) => prev.filter((p) => p.id !== inv.id));
        } else {
          failedNames.push(inv.client_name || inv.invoice_number);
        }
      } catch {
        failedNames.push(inv.client_name || inv.invoice_number);
      }
    }

    setBulkRunning(false);
    setSelectMode(false);
    setSelected(new Set());
    if (failedNames.length === 0) {
      showToast(`✓ ${ok} factuur${ok > 1 ? "en" : ""} geverifieerd`);
    } else {
      showToast(`${ok} geverifieerd · ${failedNames.length} mislukt — ververs de pagina`);
    }
  }, [pending, selected]);

  // ── [BRIDGE-B] Pay — → paid (requires payment_method: bank | kas) ──
  const handlePay = useCallback(
    async (
      invoice: IncomingInvoice,
      amounts: {
        total_ex_btw: number; btw_amount: number; total_inc_btw: number;
        client_name: string; invoice_number: string; invoice_date: string;
      },
      method: "bank" | "kas",
      // [BRIDGE-QUARTER] real payment date (YYYY-MM-DD)
      paymentDate: string
    ) => {
      // Optimistic — remove from pending
      setPending((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setConfirmPaidFor(null);
      setEditFor(null); // [QUEUE-EDIT-UX] close whichever entry point opened the modal
      setExpandedId(null);

      try {
        const res = await fetch(`/api/email/confirm/${invoice.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "pay",
            payment_method: method,
            payment_date: paymentDate,
            ...amounts,
          }),
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

  // ── [IMPORT-MONITOR] Two orthogonal facts the header must convey ──────────────
  // HEALTH: "is anything WRONG?"  → invoices the AI/arithmetic flagged.
  // FLOW:   "is anything waiting to be SENT onward?" → every pending invoice
  //          (the upload path holds all in 'processing'; even a clean one needs
  //          one confirming tap to reach the accountant).
  // These are separate. A clean-but-unsent invoice is HEALTHY (no warning) AND
  // waiting-to-flow. Collapsing them into one line is what produced the old
  // dishonesty ("Alles verwerkt" when invoices were in fact still queued, or an
  // alarming "review" on a perfectly clean upload). We keep them apart:
  //   - calm about correctness (don't nag a clean invoice)
  //   - honest about flow (never imply "done" while items wait to be sent)
  const needsAttentionCount = pending.filter(
    (inv) => inv.health.level === "needs-review"
  ).length;
  const readyToConfirmCount = pending.length - needsAttentionCount;

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
        {/* [IMPORT-MONITOR] Two-axis subtitle — calm about correctness, honest
            about flow. Never says "done" while items still wait to be sent. */}
        {pending.length === 0 ? (
          <p style={{ fontSize: 14, color: "#8e8e93", margin: "4px 0 0" }}>
            Alles verwerkt
          </p>
        ) : needsAttentionCount > 0 ? (
          <p style={{ fontSize: 14, color: "#EA8600", margin: "4px 0 0", fontWeight: 600 }}>
            {needsAttentionCount}{" "}
            {needsAttentionCount === 1 ? "factuur heeft" : "facturen hebben"} je
            aandacht nodig
            {readyToConfirmCount > 0 && (
              <span style={{ color: "#8e8e93", fontWeight: 400 }}>
                {" "}· {readyToConfirmCount} klaar om te bevestigen
              </span>
            )}
          </p>
        ) : (
          <p style={{ fontSize: 14, color: "#8e8e93", margin: "4px 0 0" }}>
            <span style={{ color: "#34c759", fontWeight: 600 }}>
              Niets om te corrigeren
            </span>{" "}
            · {readyToConfirmCount}{" "}
            {readyToConfirmCount === 1 ? "factuur klaar" : "facturen klaar"} om te
            bevestigen
          </p>
        )}
        {/* [BRIDGE-POLISH 3b] Entry to the management surface for confirmed
            incoming invoices (received/paid). iOS-styled to match THIS surface. */}
        <Link
          href="/dashboard/incoming/manage"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            marginTop: 12, padding: "8px 14px", borderRadius: 10,
            background: "#eef4ff", color: "#007aff",
            fontSize: 14, fontWeight: 600, textDecoration: "none",
          }}
        >
          Bevestigde inkoopfacturen ›
        </Link>
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

        {/* [INTAKE-VERIFY-BULK] Bulk-select toolbar — pending tab only */}
        {tab === "pending" && pending.length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0 4px", marginBottom: 12, gap: 8,
          }}>
            {!selectMode ? (
              <button
                onClick={() => setSelectMode(true)}
                style={{
                  background: "#eef4ff", border: "none", color: "#007aff",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                  padding: "8px 16px", borderRadius: 980, whiteSpace: "nowrap",
                }}
              >
                Selecteer
              </button>
            ) : (
              <>
                <button
                  onClick={selectAllReady}
                  style={{
                    background: "#eef4ff", border: "none", color: "#007aff",
                    fontWeight: 700, fontSize: 14, cursor: "pointer",
                    padding: "8px 16px", borderRadius: 980, whiteSpace: "nowrap",
                  }}
                >
                  Selecteer klaar ({pending.filter((p) => p.health.level !== "needs-review").length})
                </button>
                <button
                  onClick={exitSelectMode}
                  style={{
                    background: "#f2f2f7", border: "none", color: "#3c3c43",
                    fontWeight: 600, fontSize: 14, cursor: "pointer",
                    padding: "8px 16px", borderRadius: 980, whiteSpace: "nowrap",
                  }}
                >
                  Annuleer
                </button>
              </>
            )}
          </div>
        )}

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
                onEdit={() => setEditFor(inv)}
                onIgnore={() => setIgnoreFor(inv)}
                onRestore={() => handleRestore(inv)}
                selectMode={tab === "pending" && selectMode}
                selected={selected.has(inv.id)}
                onSelect={() => toggleSelect(inv.id)}
                domId={`incoming-card-${inv.id}`}
                highlighted={focusId === inv.id}
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
          onPay={(amounts, method, paymentDate) => handlePay(confirmPaidFor, amounts, method, paymentDate)}
          onCancel={() => setConfirmPaidFor(null)}
        />
      )}

      {/* [QUEUE-EDIT-UX] Same modal, edit fields pre-opened — the card's
          "Bewerken" entry point. Save = the normal Bevestig/verifieer flow
          (whoever just corrected the data is ready to confirm it). */}
      {editFor && (
        <ConfirmPaidModal
          invoice={editFor}
          startEditing
          onVerify={(amounts) => handleVerify(editFor, amounts)}
          onPay={(amounts, method, paymentDate) => handlePay(editFor, amounts, method, paymentDate)}
          onCancel={() => setEditFor(null)}
        />
      )}

      {/* [INTAKE-VERIFY-BULK] Sticky action bar — select mode, ≥1 selected */}
      {tab === "pending" && selectMode && selected.size > 0 && !bulkRunning && (
        <div
          style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1500,
            padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
            background: "rgba(255,255,255,0.96)", backdropFilter: "blur(8px)",
            borderTop: "1px solid #e5e5ea",
            display: "flex", justifyContent: "center",
          }}
        >
          <button
            onClick={() => setBulkConfirmOpen(true)}
            style={{
              width: "100%", maxWidth: 430, padding: "16px", borderRadius: 14,
              background: "#34c759", color: "#fff", border: "none",
              fontWeight: 700, fontSize: 16, cursor: "pointer",
            }}
          >
            Bevestig {selected.size} factuur{selected.size > 1 ? "en" : ""}
          </button>
        </div>
      )}

      {/* [INTAKE-VERIFY-BULK] Running overlay */}
      {bulkRunning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", fontSize: 15, fontWeight: 600, color: "#1c1c1e" }}>
            Bezig met verifiëren…
          </div>
        </div>
      )}

      {/* [INTAKE-VERIFY-BULK] Confirmation modal before the batch runs */}
      {bulkConfirmOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000 }}
          onClick={() => setBulkConfirmOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: "20px 20px 0 0", padding: "24px 20px",
              paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
              width: "100%", maxWidth: 430,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 19, color: "#1c1c1e", marginBottom: 4 }}>
              {selected.size} factuur{selected.size > 1 ? "en" : ""} bevestigen?
            </div>
            <div style={{ fontSize: 14, color: "#8e8e93", marginBottom: 20 }}>
              De geselecteerde facturen worden geverifieerd en als Crediteur naar je boekhouder gestuurd. De bedragen worden overgenomen zoals uitgelezen.
            </div>
            <button
              onClick={handleVerifyBatch}
              style={{
                width: "100%", padding: "16px", borderRadius: 14,
                background: "#34c759", color: "#fff", border: "none",
                fontWeight: 700, fontSize: 16, cursor: "pointer", marginBottom: 8,
              }}
            >
              Ja, bevestig {selected.size}
            </button>
            <button
              onClick={() => setBulkConfirmOpen(false)}
              style={{
                width: "100%", padding: "14px", borderRadius: 14,
                background: "#f2f2f7", color: "#1c1c1e", border: "none",
                fontWeight: 600, fontSize: 15, cursor: "pointer",
              }}
            >
              Annuleren
            </button>
          </div>
        </div>
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