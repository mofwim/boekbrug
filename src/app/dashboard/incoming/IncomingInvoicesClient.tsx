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
// [TZ] The owner's Amsterdam day, never the UTC one — see format-nl.ts.
import { amsterdamToday } from '@/lib/format-nl'
import Link from "next/link";
// [BOEK-011] Centralized navigation — single source of truth across the app
import { FONT } from "@/lib/design/tokens";
import { triggerBankAutoConfirm } from "@/lib/bank-auto-confirm-trigger";
import { combineImagesToPdf } from "@/lib/combine-images-pdf";
import { rowMatchesQuery } from "@/lib/search";
// [NEGEER-REDEN] Eén lijst redenen, gedeeld met de API en met de CHECK-constraint.
import { ARCHIVE_REASONS, ARCHIVE_REASON_LABELS, archiveReasonLabel, type ArchiveReason } from "@/lib/archive-reason";
// [AFZENDERREGEL] Alleen bij "geen factuur" mag een blijvende regel voorgesteld worden.
import { mayOfferSenderRule } from "@/lib/sender-rules";
// [INTAKE-IMG-NORMALIZE] A lone HEIC/HEIF/WebP/BMP/TIFF (an iPhone photo) reaches the reader as an
// "unsupported type" and is filed unreadable — losing the invoice. Normalize to a bounded JPEG
// before upload; a PDF (incl. the multi-page combine's output) passes through untouched.
import { normalizeImageForUpload, MAX_INTAKE_UPLOAD_BYTES } from "@/lib/image-normalize-client";

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
    reminder: boolean;
    // [DEDUP-SOFT] stond al in ImportHealth maar ontbrak in deze spiegel.
    possibleDuplicate: boolean;
    // [IBAN-WISSEL] Bekende leverancier, ander rekeningnummer. Krijgt bewust een EIGEN,
    // zwaardere badge: dit is geen leesfout maar een geldwaarschuwing, en de handeling
    // erachter (bellen op een zelf opgezocht nummer) is een andere dan "controleer de cijfers".
    ibanChanged: boolean;
  };
}

// [OBSERVABILITY] Map a stored skip reason to a short, owner-facing line. Known codes get a
// friendly phrase; a Dutch reason the AI already wrote (e.g. "rekeningoverzicht — …") is shown
// as-is (trimmed). Never a raw technical token the owner can't understand.
import { useRouter } from "next/navigation";
import { useDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { M3 } from '@/lib/design/tokens'

function friendlySkipReason(reason: string): string {
  const r = (reason || "").toLowerCase();
  if (r === "could_not_read") return "kon niet gelezen worden — staat in je bestanden";
  if (r === "not_invoice") return "leek geen factuur";
  if (r.startsWith("portal_link") || r.includes("geen bijlage")) return "e-mail zonder leesbare bijlage";
  // An AI-written Dutch reason is already human — show it, capped.
  return reason.length > 80 ? `${reason.slice(0, 77)}…` : reason;
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
  // [PARTIAL-PAY] running total settled by instalments (0 when unpaid). A value 0 < amount_paid <
  // |total| means the invoice is a deelbetaling: still openstaand, but part is already received.
  amount_paid?: number | null;
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
  // [INCOMING-BEVESTIGD] 'received' (verified, te betalen) or 'paid' (settled) on the Bevestigd
  // tab; absent on pending ('processing') / ignored ('archived').
  status?: string | null;
  // [NEGEER-REDEN] Waarom deze factuur genegeerd is. Alleen gevuld op de Genegeerd-lijst, en ook
  // daar mag hij ontbreken: oude rijen weten het niet meer, en de vraag is vrijwillig.
  archive_reason?: string | null;
  // [SUPERSEDE] Which invoice replaced this one. Only on the Genegeerd list, optional even there.
  superseded_by_number?: string | null;
}

interface ConnectionStatus {
  connected: boolean;
  provider: "gmail" | "outlook" | null;
  email: string | null;
  connected_at: string | null;
  needs_reauth: boolean;
  pending_count: number;
}

interface Props {
  initialInvoices: IncomingInvoice[];
  ignoredInvoices: IncomingInvoice[];
  confirmedInvoices: IncomingInvoice[];
  connectionStatus: ConnectionStatus;
  // [BOEK-011] Used by the Logo Universal Click pattern (Navigation Strategy v1.0)
  userRole: "zzper" | "accountant";
}

type Tab = "pending" | "ignored" | "confirmed";

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
  const dialog = useDialog();
  // [INSTANT] router.refresh() re-runs this route's server component and
  // streams fresh props in; window.location.reload() threw away the whole
  // document — bundle, scroll position, which tab was open, which card was
  // expanded — and rebuilt it from nothing. Same data, a fraction of the wait.
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  // [BACKFILL] Re-scan control — an owner-triggered re-pull over a chosen start date, for
  // invoices the incremental sync already passed (e.g. one missed before a fix landed).
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillDate, setBackfillDate] = useState<string>(
    () => `${new Date().getFullYear()}-01-01`
  );
  // [OBSERVABILITY] "Overgeslagen bij import" — transparency into what the pipeline did NOT
  // turn into an invoice, so nothing is silently lost. Loaded on demand when opened.
  const [skippedOpen, setSkippedOpen] = useState(false);
  const [skippedLoading, setSkippedLoading] = useState(false);
  const [skippedItems, setSkippedItems] = useState<
    { filename: string; reason: string; createdAt: string }[] | null
  >(null);
  const [couldNotReadCount, setCouldNotReadCount] = useState(0);

  // [BOEK-011] One tap = full import. The server caps each call at 25 new
  // invoices (function time limit); it reports `remaining` and we simply call
  // again until the backlog is drained — with live progress so the user sees
  // "Bezig… 25 van 61" instead of a silent partial import. MAX_ROUNDS guards
  // against a server bug ever looping us forever.
  // [BACKFILL] When `backfillSince` (an ISO date) is passed, the SAME batch loop runs against
  // /api/email/backfill (re-scan from that date, watermark held) instead of the incremental
  // /api/email/sync. Everything else — the continue-until-drained loop, the honest summary — is
  // identical, so a re-scan reuses the exact proven machinery.
  const handleSync = async (backfillSince?: string) => {
    setSyncing(true);
    setSyncResult(null);

    const MAX_ROUNDS = 12; // 12 × 25 = 300 invoices per tap — plenty
    let totalSaved = 0;
    let round = 0;
    // [BOEK-TRUST] Accumulate the balance buckets across all rounds so the final
    // message can reassure honestly: everything fetched this session landed in a
    // known bucket (imported / skipped / duplicate), or is being retried.
    let totalSkipped = 0;
    let totalDuplicate = 0;
    let totalErrors = 0;
    let totalCouldNotRead = 0;
    let anyUnbalanced = false;
    // [BOEK-011] No-progress guard: if a round saves nothing AND remaining
    // didn't shrink, looping again would just repeat the same work. Stop and
    // tell the user honestly instead of spinning.
    let lastRemaining = Number.POSITIVE_INFINITY;

    try {
      while (round < MAX_ROUNDS) {
        round++;
        const res = backfillSince
          ? await fetch("/api/email/backfill", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sinceDate: backfillSince }),
            })
          : await fetch("/api/email/sync", { method: "POST" });
        const data = await res.json();

        if (data.error) {
          setSyncResult(`Fout: ${data.error}`);
          setSyncing(false);
          return;
        }

        totalSaved += data.saved ?? 0;
        // [BOEK-TRUST] Roll up the reconciliation buckets.
        if (data.balance) {
          totalSkipped += data.balance.skipped ?? 0;
          totalDuplicate += data.balance.duplicate ?? 0;
          if (data.balance.balanced === false) anyUnbalanced = true;
        }
        totalCouldNotRead += data.couldNotRead ?? 0;
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
        // [COULD-NOT-READ] Never hide files we couldn't read: tell the owner to check
        // them in bestanden (they were kept, not discarded, and not booked as anything).
        if (totalCouldNotRead > 0) {
          message +=
            totalCouldNotRead === 1
              ? " 1 bestand konden we niet lezen — het staat in je bestanden, controleer het even."
              : ` ${totalCouldNotRead} bestanden konden we niet lezen — ze staan in je bestanden, controleer ze even.`;
        }
        setSyncResult(message);
        setTimeout(() => router.refresh(), 1500);
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
    const ok = await dialog.confirm({
      title: "E-mailverbinding verwijderen?",
      message: "Nieuwe facturen komen dan niet meer automatisch binnen. Facturen die al ingelezen zijn, blijven staan.",
      confirmLabel: "Verbinding verwijderen",
      danger: true,
    });
    if (!ok) return;
    await fetch("/api/email/sync", { method: "DELETE" });
    router.refresh();
  };

  // [OBSERVABILITY] Load the "overgeslagen bij import" list the first time it's opened.
  const openSkipped = async () => {
    setSkippedOpen(true);
    if (skippedItems !== null || skippedLoading) return;
    setSkippedLoading(true);
    try {
      const res = await fetch("/api/email/skipped");
      const data = await res.json();
      if (res.ok) {
        setSkippedItems(data.skipped ?? []);
        setCouldNotReadCount(data.couldNotReadCount ?? 0);
      } else {
        setSkippedItems([]);
      }
    } catch {
      setSkippedItems([]);
    } finally {
      setSkippedLoading(false);
    }
  };

  if (status.connected) {
    const providerName = status.provider === "gmail" ? "Gmail" : "Outlook";
    // [EMAIL-HEALTH] The grant can be dead while the row still exists — never render the calm green
    // "verbonden" state in that case, or the automatic import rots silently behind a false ✓.
    const needsReauth = status.needs_reauth;

    return (
      <div
        style={{
          background: "#f8f9fa",
          borderRadius: 16,
          padding: "16px 20px",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 28 }}>📧</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: "#202124" }}>
                {needsReauth ? `${providerName} — verbinding verlopen` : `${providerName} verbonden`}
              </span>
              <span
                style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: needsReauth ? "#ea4335" : "#34a853", display: "inline-block",
                }}
              />
            </div>
            <div style={{ fontSize: 13, color: "#5f6368", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {status.email}
            </div>
          </div>
        </div>

        {needsReauth && (
          <div style={{ background: "#FCE8E6", border: "1px solid #F5B5AE", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#B3261E", marginBottom: 6 }}>
              Automatisch inlezen is gestopt
            </div>
            <div style={{ fontSize: 13, color: "#8C1D18", marginBottom: 10, lineHeight: 1.45 }}>
              Je {providerName}-koppeling is verlopen. Er komen geen nieuwe facturen meer binnen totdat je opnieuw verbindt.
            </div>
            <a
              href={`/api/email/connect?provider=${status.provider}`}
              style={{ display: "inline-block", background: "#B3261E", color: "#fff", borderRadius: 10, padding: "9px 16px", fontWeight: 600, fontSize: 14, textDecoration: "none" }}
            >
              Verbind {providerName} opnieuw
            </a>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => handleSync()}
            disabled={syncing}
            style={{
              flex: 1,
              background: syncing ? "#e0e0e0" : "#1a73e8",
              color: syncing ? "#5f6368" : "#fff",
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
              background: "transparent", border: "1.5px solid #ea4335",
              color: M3.error, borderRadius: 10, padding: "10px 16px",
              fontWeight: 600, fontSize: 14, cursor: "pointer",
            }}
          >
            Ontkoppel
          </button>
        </div>

        {/* [BACKFILL] Re-scan an earlier period. The daily sync only looks forward, so an
            invoice that was missed at the time (and is now fixable) needs a one-off re-pull.
            Nothing is duplicated — the re-scan imports only what's still missing. */}
        <div style={{ marginTop: 10 }}>
          {!backfillOpen ? (
            <button
              onClick={() => setBackfillOpen(true)}
              disabled={syncing}
              style={{
                background: "transparent", border: "none",
                color: syncing ? "#dadce0" : "#1a73e8",
                fontSize: 13, fontWeight: 500,
                cursor: syncing ? "default" : "pointer", padding: 0,
              }}
            >
              Mis je een factuur? Oudere e-mails opnieuw ophalen…
            </button>
          ) : (
            <div style={{ background: "#fff", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12.5, color: "#3c4043", lineHeight: 1.5, marginBottom: 8 }}>
                Ik scan je e-mail opnieuw vanaf deze datum en importeer wat er nog mist. Al
                geïmporteerde facturen blijven zoals ze zijn — niets wordt dubbel.
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="date"
                  value={backfillDate}
                  max={amsterdamToday()}
                  onChange={(e) => setBackfillDate(e.target.value)}
                  disabled={syncing}
                  style={{
                    border: "1px solid #dadce0", borderRadius: 8, padding: "8px 10px",
                    fontSize: 14, fontFamily: "inherit",
                  }}
                />
                <button
                  onClick={() => handleSync(backfillDate)}
                  disabled={syncing || !backfillDate}
                  style={{
                    background: syncing ? "#e0e0e0" : "#1a73e8",
                    color: syncing ? "#5f6368" : "#fff",
                    border: "none", borderRadius: 8, padding: "8px 16px",
                    fontWeight: 600, fontSize: 14,
                    cursor: syncing || !backfillDate ? "not-allowed" : "pointer",
                  }}
                >
                  {syncing ? "Bezig…" : "Opnieuw ophalen"}
                </button>
                <button
                  onClick={() => setBackfillOpen(false)}
                  disabled={syncing}
                  style={{
                    background: "transparent", border: "none", color: "#5f6368",
                    fontSize: 13, cursor: syncing ? "default" : "pointer", padding: "8px 4px",
                  }}
                >
                  Annuleer
                </button>
              </div>
            </div>
          )}
        </div>

        {syncResult && (
          <div
            style={{
              marginTop: 10, fontSize: 13, textAlign: "center",
              color: syncResult.startsWith("Fout") ? "#ea4335" : "#34a853",
            }}
          >
            {syncResult}
          </div>
        )}

        {/* [OBSERVABILITY] What did import NOT turn into an invoice, and why. Read-only
            transparency so a misjudged or unreadable document is never invisibly lost. */}
        <div style={{ marginTop: 10 }}>
          {!skippedOpen ? (
            <button
              onClick={openSkipped}
              style={{
                background: "transparent", border: "none", color: "#5f6368",
                fontSize: 12.5, cursor: "pointer", padding: 0,
              }}
            >
              Bekijk wat is overgeslagen bij het importeren
            </button>
          ) : (
            <div style={{ background: "#fff", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#202124" }}>Overgeslagen bij import</span>
                <button
                  onClick={() => setSkippedOpen(false)}
                  style={{ background: "transparent", border: "none", color: "#5f6368", fontSize: 13, cursor: "pointer" }}
                >
                  Sluit
                </button>
              </div>
              {skippedLoading ? (
                <div style={{ fontSize: 13, color: "#5f6368" }}>Laden…</div>
              ) : (
                <>
                  {couldNotReadCount > 0 && (
                    <div style={{ fontSize: 12.5, color: "#7A4B00", background: "#FFF3E0", borderRadius: 8, padding: "8px 10px", marginBottom: 8, lineHeight: 1.5 }}>
                      {couldNotReadCount} {couldNotReadCount === 1 ? "bestand konden" : "bestanden konden"} we niet lezen — {couldNotReadCount === 1 ? "het staat" : "ze staan"} in je bestanden, controleer {couldNotReadCount === 1 ? "het" : "ze"} even.
                    </div>
                  )}
                  {(skippedItems?.length ?? 0) === 0 && couldNotReadCount === 0 ? (
                    <div style={{ fontSize: 12.5, color: "#5f6368" }}>
                      Niets overgeslagen — alles wat binnenkwam is verwerkt.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(skippedItems ?? []).map((s, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                          <span style={{ color: "#202124", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                            {s.filename}
                          </span>
                          <span style={{ color: "#5f6368", flexShrink: 0, maxWidth: "55%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {friendlySkipReason(s.reason)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, color: "#a0a0a5", marginTop: 8, lineHeight: 1.5 }}>
                    Mis je hier een echte factuur? Gebruik &ldquo;Oudere e-mails opnieuw ophalen&rdquo; hierboven, of voeg hem toe met een foto.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Not connected
  return (
    <div
      style={{
        background: "#f8f9fa", borderRadius: 20,
        padding: "24px 20px", marginBottom: 20, textAlign: "center",
      }}
    >
      <div style={{ fontSize: 44, marginBottom: 12 }}>📬</div>
      <div style={{ fontWeight: 700, fontSize: 17, color: "#202124", marginBottom: 8 }}>
        Verbind je e-mail
      </div>
      <div
        style={{
          fontSize: 14, color: "#5f6368", lineHeight: 1.5,
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
              gap: 10, background: "#fff", border: "1.5px solid #e0e0e0",
              borderRadius: 12, padding: "14px 20px", textDecoration: "none",
              color: "#202124", fontWeight: 600, fontSize: 15,
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
    amsterdamToday()
  );
  const [confirmAmount, setConfirmAmount] = useState("");

  // Total is always derived — never edited directly. This IS TRAIL 2: excl + BTW = incl.
  const totalIncBtw = exBtw + btwAmount;

  // [BRIDGE-CREDITNOTA-SIGN] The old `Math.max(0, …)` forced every edited amount ≥ 0, which turned
  // a creditnota positive the moment the user touched a field. A creditnota's amounts follow the
  // safecore rule (evaluateCreditnotaArithmetic): only the NET total must be negative — the ex/BTW
  // signs are NOT constrained (the real Altena case is ex −123, BTW +13,42, totaal −109,58). So for
  // a creditnota we accept the real signed value the reviewer reads off the paper (no clamp); for a
  // normal invoice we keep the ≥ 0 clamp.
  const isCredit = invoice.invoice_type === "creditnota";
  const clampAmount = (raw: number) => (isCredit ? raw : Math.max(0, raw));

  // [BRIDGE-B] TRAIL 3 — legal BTW rate must round to 0 / 9 / 21. FLAG, never block.
  // [BTW-MIXED-RATE] A blended rate (e.g. 9%+21% food invoice → ~11%) is valid:
  // any value 0–21 can be a mix of legal NL rates. Only < 0 or > 21 is impossible.
  // [BRIDGE-CREDITNOTA-SIGN] Magnitude ratio (mirrors safecore): |BTW / excl|. On a mixed-sign
  // net-credit (positive goods-BTW over a negative net excl) the raw ratio is negative, so the old
  // `btwRate < 0` test false-flagged a correctly-read Altena-style creditnota. Only a magnitude
  // above 21% is actually impossible for a (blended) NL rate.
  const btwRate = Math.abs(exBtw) > 0.005 ? Math.round(Math.abs(btwAmount / exBtw) * 100) : null;
  const rateFlag = btwRate !== null && btwRate > 21;

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
  // [DATE-GATE] Open the editor whenever the invoice date is missing so the
  // reviewer immediately sees the (required) date input.
  const [editing, setEditing] = useState(anyLow || startEditing || !invoiceDate);

  const amounts = {
    total_ex_btw: exBtw,
    btw_amount: btwAmount,
    total_inc_btw: totalIncBtw,
    // [BRIDGE-EXTRACT] reviewed metadata — persisted by the confirm route
    client_name: vendor.trim(),
    invoice_number: invoiceNumber.trim(),
    invoice_date: invoiceDate.trim(),
  };

  // [DATE-GATE] An incoming invoice may not be confirmed without a real invoice
  // date (the date sets the tax period). Mirror of the server gate: nudge inline
  // and open the editor instead of firing a raw server error.
  const dateMissing = !invoiceDate.trim();
  const handleVerify = () => {
    if (dateMissing) { setEditing(true); return; }
    setSubmitting(true);
    onVerify(amounts);
  };
  const handlePay = (method: "bank" | "kas") => {
    if (dateMissing) { setEditing(true); return; }
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
          paddingBottom: "calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))",
          width: "100%", maxWidth: 430,
        }}
      >
        {!payStep ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 19, color: "#202124", marginBottom: 4 }}>
              Factuur bevestigen
            </div>
            <div style={{ fontSize: 14, color: "#5f6368", marginBottom: 20 }}>
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
                background: "#f8f9fa", borderRadius: 14,
                padding: "16px", marginBottom: 16,
              }}
            >
              {/* Excl BTW */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 14, color: "#5f6368" }}>Bedrag excl. BTW</span>
                {editing ? (
                  <input
                    type="number"
                    value={exBtw}
                    onChange={(e) => setExBtw(clampAmount(parseFloat(e.target.value) || 0))}
                    style={{
                      width: 110, padding: "6px 10px", fontSize: 16,
                      borderRadius: 8, border: "1.5px solid #1a73e8",
                      textAlign: "right", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#202124" }}>
                    {formatAmount(exBtw)}
                  </span>
                )}
              </div>

              {/* BTW amount */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: rateFlag ? 6 : 12 }}>
                <span style={{ fontSize: 14, color: "#5f6368" }}>BTW</span>
                {editing ? (
                  <input
                    type="number"
                    value={btwAmount}
                    onChange={(e) => setBtwAmount(clampAmount(parseFloat(e.target.value) || 0))}
                    style={{
                      width: 110, padding: "6px 10px", fontSize: 16,
                      borderRadius: 8,
                      border: `1.5px solid ${rateFlag ? "#EA8600" : "#1a73e8"}`,
                      textAlign: "right", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: rateFlag ? "#EA8600" : "#202124" }}>
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
              <div style={{ height: 1, background: "#dadce0", margin: "12px 0" }} />

              {/* Total — always computed */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#202124" }}>Totaal</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: "#202124" }}>
                  {formatAmount(totalIncBtw)}
                </span>
              </div>
            </div>

            {/* [BRIDGE-EXTRACT] Vendor / number / date — editable under the same toggle */}
            <div
              style={{
                background: "#f8f9fa", borderRadius: 14,
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
                <span style={{ fontSize: 14, color: vendorLow ? "#EA8600" : "#5f6368", flexShrink: 0, fontWeight: vendorLow ? 600 : 400 }}>
                  Leverancier {vendorLow && "⚠️"}
                </span>
                {editing ? (
                  <input
                    type="text"
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    style={{
                      flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 15,
                      borderRadius: 8, border: "1.5px solid #1a73e8",
                      textAlign: "right", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#202124", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {vendor || "—"}
                  </span>
                )}
              </div>

              {/* Invoice number */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: numberFlag ? 6 : 12, gap: 10 }}>
                <span style={{ fontSize: 14, color: "#5f6368", flexShrink: 0 }}>Factuurnummer</span>
                {editing ? (
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    style={{
                      flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 15,
                      borderRadius: 8,
                      border: `1.5px solid ${numberFlag ? "#EA8600" : "#1a73e8"}`,
                      textAlign: "right", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: numberFlag ? "#EA8600" : "#202124" }}>
                    {invoiceNumber || "—"}
                  </span>
                )}
              </div>

              {/* [BRIDGE-EXTRACT] N-N flag — likely a page number, not an invoice number */}
              {numberFlag && (
                <div style={{ fontSize: 12, color: "#EA8600", lineHeight: 1.4, marginBottom: 12, display: "flex", gap: 6 }}>
                  <span>⚠️</span>
                  <span>&ldquo;{invoiceNumber}&rdquo; lijkt een paginanummer — controleer het factuurnummer.</span>
                </div>
              )}

              {/* Invoice date */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, color: (dateLow || dateMissing) ? "#EA8600" : "#5f6368", flexShrink: 0, fontWeight: (dateLow || dateMissing) ? 600 : 400 }}>
                  Factuurdatum {(dateLow || dateMissing) && "⚠️"}
                </span>
                {editing ? (
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    style={{
                      padding: "6px 10px", fontSize: 15,
                      borderRadius: 8, border: "1.5px solid #1a73e8",
                      textAlign: "right", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#202124" }}>
                    {/* [QUEUE-EDIT-UX] NL format (19-05-2026), not raw ISO — the
                        card already does this; the modal forgot. The edit
                        <input type="date"> keeps ISO (browser requirement). */}
                    {invoiceDate ? formatDate(invoiceDate) : "—"}
                  </span>
                )}
              </div>
              {dateMissing && (
                <div style={{ fontSize: 12.5, color: M3.error, textAlign: "right", marginTop: 6 }}>
                  Factuurdatum ontbreekt — verplicht om te bevestigen.
                </div>
              )}
            </div>

            {/* Edit toggle */}
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                style={{
                  width: "100%", padding: "10px", marginBottom: 10,
                  background: "transparent", border: "none",
                  color: "#1a73e8", fontWeight: 600, fontSize: 14, cursor: "pointer",
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
                    background: submitting ? "#dadce0" : "#34a853",
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
                    background: "#e8f0fe", color: "#1a73e8",
                    border: "1.5px solid #1a73e8",
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
                    background: submitting ? "#dadce0" : "#34a853",
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
                    background: "#e8f0fe", color: "#1a73e8",
                    border: "1.5px solid #1a73e8",
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
                background: "#f8f9fa", color: "#202124", border: "none",
                fontWeight: 600, fontSize: 15, cursor: "pointer",
              }}
            >
              Annuleren
            </button>
          </>
        ) : (
          /* [BRIDGE-B] Payment-method step — mirrors the outgoing "mark paid" dialog */
          <>
            <div style={{ fontWeight: 700, fontSize: 19, color: "#202124", marginBottom: 4 }}>
              Hoe is deze factuur betaald?
            </div>
            <div style={{ fontSize: 14, color: "#5f6368", marginBottom: 20 }}>
              De factuur wordt als betaald gemarkeerd en doorgestuurd naar je boekhouder.
            </div>

            {/* [BRIDGE-QUARTER] Real payment date — the day the money actually
                moved. Defaults to today; the user corrects it if they paid earlier. */}
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#202124", marginBottom: 6 }}>
              Betaaldatum
            </label>
            <input
              type="date"
              value={paymentDate}
              max={amsterdamToday()}
              onChange={(e) => setPaymentDate(e.target.value)}
              disabled={submitting}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 12,
                border: "1px solid #dadce0", fontSize: 15, marginBottom: 14,
                fontFamily: "inherit", color: "#202124", background: "#fff",
                boxSizing: "border-box",
              }}
            />

            {/* [BRIDGE-QUARTER] Confirmation amount — UI only for now (not stored).
                Explicit defer per brief §2: helps the user sanity-check, no DB write. */}
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#202124", marginBottom: 6 }}>
              Betaald bedrag <span style={{ color: "#5f6368", fontWeight: 400 }}>(optioneel)</span>
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
                border: "1px solid #dadce0", fontSize: 15, marginBottom: 20,
                fontFamily: "inherit", color: "#202124", background: "#fff",
                boxSizing: "border-box",
              }}
            />

            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button
                onClick={() => handlePay("bank")}
                disabled={submitting}
                style={{
                  flex: 1, padding: "16px", borderRadius: 14,
                  background: submitting ? "#dadce0" : "#34a853",
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
                  background: submitting ? "#dadce0" : "#34a853",
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
                background: "transparent", color: "#5f6368", border: "none",
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
  choices,
  choiceValue,
  onChoice,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  onConfirm: () => void;
  onCancel: () => void;
  // [NEGEER-REDEN] Optioneel keuzelijstje boven de knoppen. Optioneel gehouden zodat elke
  // bestaande aanroep van deze dialoog onveranderd blijft werken.
  choices?: { value: string; label: string; hint: string }[];
  choiceValue?: string | null;
  onChoice?: (value: string | null) => void;
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
        <div style={{ fontWeight: 700, fontSize: 17, color: "#202124", marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 14, color: "#5f6368", marginBottom: choices?.length ? 14 : 20, lineHeight: 1.5 }}>
          {message}
        </div>
        {/* [NEGEER-REDEN] Vrijwillig. Nog een keer klikken op een gekozen reden zet hem weer uit,
            zodat "ik weet het niet" een echte uitkomst is en niet iets wat je moet omzeilen. */}
        {choices && choices.length > 0 && (
          <div style={{ textAlign: "left", marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: "#80868b", marginBottom: 8, fontWeight: 600 }}>
              Waarom? (optioneel)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {choices.map((c) => {
                const active = choiceValue === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => onChoice?.(active ? null : c.value)}
                    style={{
                      display: "flex", alignItems: "baseline", gap: 8, width: "100%",
                      padding: "9px 11px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                      background: active ? "#e8f0fe" : "#f8f9fa",
                      border: `1px solid ${active ? "#1a73e8" : "#e8eaed"}`,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? "#1a73e8" : "#3c4043", whiteSpace: "nowrap" }}>
                      {c.label}
                    </span>
                    <span style={{ fontSize: 12, color: "#80868b", lineHeight: 1.35 }}>
                      {c.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
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
            background: "transparent", color: "#5f6368", border: "none",
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
  const dialog = useDialog();
  const toast = useToast();
  const router = useRouter();
  const [loadingPdf, setLoadingPdf] = useState(false);

  // [SUPERSEDE] The invoice this one was flagged against, when the flag names one we can act on
  // EXACTLY. `possible_duplicate_of` next to it is a display string that falls back to a vendor
  // name, so it can label the button but must never select the row — the id does that, server
  // side, from this same stored flag. Absent on rows imported before the id was written: the
  // warning still shows, only the shortcut is missing, and that is the honest state of affairs.
  const supersedeTarget = (() => {
    // [SUPERSEDE] pending AND confirmed. A corrected re-issue the owner already verified is
    // still 'received', which refuseSupersede permits, so the shortcut must not vanish just
    // because the row moved one tab over — that was the difference between one tap and a trip
    // to another screen. Only the Genegeerd tab is excluded: an archived row answers nothing.
    if (mode === "ignored" || !invoice.health.flags.possibleDuplicate) return null;
    const fc = invoice.field_confidence as { _safecore?: Record<string, unknown> } | null;
    const s = fc?._safecore;
    if (!s || typeof s.possible_duplicate_id !== "string" || s.possible_duplicate_id.length === 0) {
      return null;
    }
    const of = typeof s.possible_duplicate_of === "string" ? s.possible_duplicate_of.trim() : "";
    return { label: of ? `factuur ${of}` : "de andere factuur" };
  })();

  const [superseding, setSuperseding] = useState(false);
  const handleSupersede = async () => {
    if (superseding || !supersedeTarget) return;
    // Ask BEFORE anything happens, and describe the consequence rather than the action: what
    // leaves the books, and that it comes back with one tap. The server decides for real — this
    // dialog is the owner's informed yes, never the permission.
    const ok = await dialog.confirm({
      title: `Vervangt deze ${supersedeTarget.label}?`,
      message:
        `${supersedeTarget.label.charAt(0).toUpperCase() + supersedeTarget.label.slice(1)} verdwijnt uit je lijst ` +
        `en telt niet meer mee in je kosten en voorbelasting. Hij blijft bewaard (7 jaar bewaarplicht) en je kunt ` +
        `hem terugzetten bij Inkomend › Genegeerd.\n\n` +
        `Deze factuur blijft gewoon in de wachtrij staan — je controleert hem daarna zoals altijd.`,
      confirmLabel: "Ja, vervangen",
    });
    if (!ok) return;
    setSuperseding(true);
    try {
      const res = await fetch(`/api/invoice/${invoice.id}/supersede`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server asked the same questions of fresher data — show ITS answer, not ours. This
        // is where "the old one is already paid" lands, with the exit named.
        await dialog.alert({
          title: "Vervangen kan nu niet",
          message: data?.detail || "Vervangen mislukt — ververs de pagina en probeer het opnieuw.",
        });
        return;
      }
      toast(
        data?.archivedNumber
          ? `Factuur ${data.archivedNumber} staat nu bij Genegeerd`
          : "De oude factuur staat nu bij Genegeerd",
      );
      router.refresh(); // the flag is answered; the queue re-renders without it
    } catch {
      await dialog.alert({
        title: "Geen verbinding",
        message: "Vervangen is niet gelukt. Controleer je verbinding en probeer het opnieuw.",
      });
    } finally {
      setSuperseding(false);
    }
  };

  // [SUPERSEDE] The OTHER answer: "no, these really are two invoices." Confirming the invoice is
  // deliberately NOT read as this answer — that tap says the amounts are right, not that two
  // documents were compared — so the question needs its own way to be closed, or it would follow
  // the invoice around forever and reappear if it were ever restored to the queue.
  const handleDismissDuplicate = async () => {
    if (superseding || !supersedeTarget) return;
    setSuperseding(true);
    try {
      const res = await fetch(`/api/invoice/${invoice.id}/supersede`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await dialog.alert({
          title: "Niet gelukt",
          message: data?.detail || "De melding kon niet worden weggehaald — probeer het opnieuw.",
        });
        return;
      }
      toast("Genoteerd — dit zijn twee verschillende facturen");
      router.refresh();
    } catch {
      await dialog.alert({
        title: "Geen verbinding",
        message: "De melding kon niet worden weggehaald. Probeer het opnieuw.",
      });
    } finally {
      setSuperseding(false);
    }
  };

  // [REIMPORT] Re-read this invoice's stored PDF with the current extractor. Only offered on
  // a flagged item still in the queue; the server refuses anything already verified/archived.
  const [reimporting, setReimporting] = useState(false);
  const handleReimport = async () => {
    if (reimporting) return;
    setReimporting(true);
    try {
      const res = await fetch(`/api/email/reimport/${invoice.id}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        router.refresh(); // pick up the refreshed amounts + health
        return;
      }
      if (data.notInvoice) {
        // [HERLEES-ARCHIVEER] main's newer behaviour, kept whole: the server now
        // archives such a document itself with reason "Geen factuur", so the
        // honest message is "it has been put away, and this is how you get it
        // back" — not "sort it out yourself". If archiving failed (money is
        // already booked against it, say), we say that instead.
        // Only the DELIVERY changed here: the app's own dialog rather than a
        // browser box, and router.refresh() rather than throwing the whole
        // document away. See docs/MOTION_SYSTEM.md.
        if (data.archived) {
          await dialog.alert({
            title: "Dit lijkt geen boekbare factuur",
            message:
              "Bij het opnieuw inlezen vonden we geen factuurgegevens" +
              (data.reason ? ` (${data.reason})` : "") +
              ". Hij staat nu bij Genegeerd, met reden “Geen factuur”.\n\n" +
              "Klopt dat niet? Zet hem daar met één tik terug.",
          });
          router.refresh(); // de kaart hoort nu bij Genegeerd, niet meer in de wachtrij
          return;
        }
        await dialog.alert({
          title: "Dit lijkt geen boekbare factuur",
          message:
            "Bij het opnieuw inlezen vonden we geen factuurgegevens" +
            (data.reason ? ` (${data.reason})` : "") +
            ". " +
            (data.detail ?? "De opgeslagen gegevens zijn niet gewijzigd — je kunt hem zelf negeren."),
        });
      } else {
        toast(data.error || "Opnieuw inlezen is niet gelukt — probeer het later opnieuw.", { tone: "error" });
      }
    } catch {
      toast("Opnieuw inlezen is niet gelukt — probeer het later opnieuw.", { tone: "error" });
    } finally {
      setReimporting(false);
    }
  };

  const handleOpenPdf = async () => {
    setLoadingPdf(true);
    try {
      const res = await fetch(`/api/email/file/${invoice.id}`);
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        toast(data.error || "Kon bestand niet openen", { tone: "error" });
      }
    } catch {
      toast("Kon bestand niet openen", { tone: "error" });
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
          ? "0 1px 4px rgba(0,0,0,0.08), 0 0 0 3px rgba(26,115,232,0.35)"
          : "0 1px 4px rgba(0,0,0,0.08)",
        transition: "box-shadow 0.5s ease",
        scrollMarginTop: 96,
      }}
    >
      {/* Header — always visible, tappable */}
      <button
        className="inv-row"
        onClick={selectMode ? onSelect : onToggle}
        // [ROW-LAYOUT] display/align/gap live in the .inv-row class (globals.css) so the
        // stack-on-mobile media query can override them; the flex:1 main pushes the side
        // cluster right, so justify-content:space-between is no longer needed here.
        style={{
          width: "100%", padding: "16px", border: "none",
          background: "transparent", cursor: "pointer", textAlign: "left",
        }}
      >
        {/* [INTAKE-VERIFY-BULK] selection checkbox — only in pending select mode */}
        {selectMode && (
          <span
            style={{
              flexShrink: 0, width: 22, height: 22, borderRadius: 11,
              border: `2px solid ${selected ? "#34a853" : "#dadce0"}`,
              background: selected ? "#34a853" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 13, fontWeight: 700,
            }}
          >
            {selected ? "✓" : ""}
          </span>
        )}
        <div className="inv-row-main">
          <div
            style={{
              fontWeight: 700, fontSize: 16, color: "#202124", marginBottom: 3,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {invoice.client_name || "Onbekende afzender"}
          </div>
          <div style={{ fontSize: 13, color: "#5f6368" }}>
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
          {/* [NEGEER-REDEN] Op de Genegeerd-lijst: waarom staat hij hier? Neutraal grijs — dit is
              een notitie, geen waarschuwing. Ontbreekt hij (oude rij, of de vraag overgeslagen),
              dan staat er niets: liever geen label dan een verzonnen label. */}
          {mode === "ignored" && archiveReasonLabel(invoice.archive_reason) && (
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                marginTop: 6, marginRight: 6, padding: "3px 9px", borderRadius: 8,
                background: "#f1f3f4", border: "1px solid #e0e3e6",
              }}
            >
              <span style={{ fontSize: 12, color: "#5f6368", fontWeight: 600 }}>
                {archiveReasonLabel(invoice.archive_reason)}
              </span>
            </div>
          )}
          {/* [SUPERSEDE] En WELKE factuur hem verving. "Dubbel" hierboven zegt de categorie; drie
              maanden later, bij de kwartaalafsluiting of als de leverancier belt, is de vraag niet
              "waarom staat dit hier" maar "waar is hij dan wél gebleven". Zonder dit antwoord moet
              de eigenaar dat uit zijn hoofd reconstrueren — precies het geheugenverlies dat het
              Genegeerd-tabblad ooit had. Ontbreekt het nummer (oude rij, of de migratie nog niet
              gedraaid), dan staat er niets: liever geen label dan een verzonnen label. */}
          {mode === "ignored" && (invoice.superseded_by_number ?? "").trim() && (
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                marginTop: 6, marginRight: 6, padding: "3px 9px", borderRadius: 8,
                background: "#f1f3f4", border: "1px solid #e0e3e6",
              }}
            >
              <span style={{ fontSize: 12, color: "#5f6368", fontWeight: 600 }}>
                Vervangen door {invoice.superseded_by_number}
              </span>
            </div>
          )}
          {/* [IMPORT-MONITOR] Health badge — only in the pending queue. Flagged
              invoices get a calm-but-clear attention pill; clean invoices get a
              quiet "ready to confirm" hint (calm, never the alarming "review").
              The ignored tab shows nothing here — it must not nag. */}
          {mode === "pending" && (
            /* [IBAN-WISSEL] Een gewisseld rekeningnummer krijgt de ROOD-badge, niet de amberen
               "Aandacht nodig". Reden: bij factuurfraude klopt al het andere — bedrag, nummer,
               btw, datum — dus de gewone amberen pil zou dit laten lezen als "de AI twijfelde
               ergens over", terwijl dit het enige signaal is dat over GELD gaat. Eigen kleur,
               eigen woorden, en de reden eronder noemt beide nummers. */
            invoice.health.flags.ibanChanged ? (
              <div
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  marginTop: 6, padding: "3px 9px", borderRadius: 8,
                  background: "#fce8e6", border: "1px solid #f5b5ae",
                }}
              >
                <span style={{ fontSize: 11 }}>🏦</span>
                <span style={{ fontSize: 12, color: "#b3261e", fontWeight: 700 }}>
                  Ander rekeningnummer
                </span>
              </div>
            ) : invoice.health.level === "needs-review" ? (
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
                <span style={{ fontSize: 11, color: M3.success }}>✓</span>
                <span style={{ fontSize: 12, color: "#5f6368" }}>
                  Klaar om te bevestigen
                </span>
              </div>
            )
          )}
        </div>

        {/* [ROW-LAYOUT] .inv-row-side-h (globals.css) keeps amount + badge + chevron in one
            horizontal cluster on a wide screen, and drops it to a full-width, right-aligned
            strip below 520px so the deelbetaling badge stops squeezing the afzender name. */}
        <div className="inv-row-side-h">
          <span style={{ fontWeight: 700, fontSize: 18, color: "#202124", whiteSpace: "nowrap" }}>
            {formatSignedAmount(invoice.total_inc_btw)}
          </span>
          {/* [PARTIAL-PAY] Deelbetaling badge — part received, rest still openstaand. Shown only
              while 0 < amount_paid < total (a fully-paid invoice leaves this list entirely). */}
          {(() => {
            const paid = Math.max(0, invoice.amount_paid ?? 0);
            const total = Math.abs(invoice.total_inc_btw ?? 0);
            if (!(paid > 0.005 && paid < total - 0.005)) return null;
            const remaining = Math.max(0, total - paid);
            return (
              <span
                title={`Deelbetaling: € ${paid.toFixed(2)} van € ${total.toFixed(2)} ontvangen`}
                style={{
                  fontSize: 11, fontWeight: 600, color: "#b06000", background: "#fef7e0",
                  border: "1px solid #fde293", borderRadius: 6, padding: "2px 6px", whiteSpace: "nowrap",
                }}
              >
                Deels betaald · € {remaining.toFixed(2)} open
              </span>
            );
          })()}
          <span
            style={{
              fontSize: 18, color: "#dadce0",
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
          <div style={{ height: 1, background: "#f8f9fa", marginBottom: 14 }} />

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
                  {/* [REIMPORT] Self-heal: re-read the stored PDF with the current extractor.
                      Safe — the server only refreshes an invoice still in this queue and never
                      overwrites verified data. Falls back to manual Bewerken if it can't help. */}
                  <button
                    onClick={handleReimport}
                    disabled={reimporting}
                    style={{
                      marginTop: 10, padding: "7px 12px", borderRadius: 9,
                      background: reimporting ? "#f0d9b8" : "#fff", cursor: reimporting ? "default" : "pointer",
                      border: "1px solid #e0a94f", color: "#9a5b00", fontWeight: 600, fontSize: 12.5,
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 13 }}>↻</span>
                    {reimporting ? "Bezig met opnieuw inlezen…" : "Opnieuw inlezen"}
                  </button>
                  {/* [SUPERSEDE] "Deze vervangt factuur X" — the answer to the one flag on this
                      card that is not a reading problem. A supplier who invoices the wrong amount
                      and corrects it leaves TWO invoices in the books; the queue said so and then
                      left the owner to go to another screen, find the old one and remove it
                      there. Two screens for what is one answer. Shown only when the flag names an
                      invoice we can act on EXACTLY (an id, written at import time) — for a row
                      imported before that existed the warning still shows, just without the
                      shortcut, and removing the old one by hand still works. */}
                  {supersedeTarget && (
                    <button
                      onClick={handleSupersede}
                      disabled={superseding}
                      style={{
                        marginTop: 10, marginLeft: 8, padding: "7px 12px", borderRadius: 9,
                        background: superseding ? "#f0d9b8" : "#fff", cursor: superseding ? "default" : "pointer",
                        border: "1px solid #e0a94f", color: "#9a5b00", fontWeight: 600, fontSize: 12.5,
                        display: "inline-flex", alignItems: "center", gap: 6,
                      }}
                    >
                      <span style={{ fontSize: 13 }}>⇄</span>
                      {superseding
                        ? "Bezig…"
                        : `Deze vervangt ${supersedeTarget.label}`}
                    </button>
                  )}
                  {/* [SUPERSEDE] The second answer, so the question can be closed BOTH ways. Without
                      it the only way out was to replace something — and an owner whose two invoices
                      are genuinely different had nothing to tap, so the warning followed the invoice
                      for good. Confirming is not read as this answer: that tap means the amounts are
                      right, not that two documents were compared. */}
                  {supersedeTarget && (
                    <button
                      onClick={handleDismissDuplicate}
                      disabled={superseding}
                      style={{
                        marginTop: 10, marginLeft: 8, padding: "7px 12px", borderRadius: 9,
                        background: "transparent", cursor: superseding ? "default" : "pointer",
                        border: "1px solid transparent", color: "#9a5b00", fontWeight: 600, fontSize: 12.5,
                        display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "underline",
                      }}
                    >
                      Nee, andere factuur
                    </button>
                  )}
                </div>
              </div>
            )}

          {/* [SUPERSEDE] On the Bevestigd tab the "Even controleren" box above does not render — it
              is a queue concept — so a confirmed invoice that still carries a duplicate warning had
              nowhere to answer it. That is the common shape of this exact problem: the corrected
              re-issue gets verified first (its amounts are right, so it looks clean), and only then
              does the owner notice the old one is still in the books. Both answers belong here too,
              compact and without the queue's "check this" framing. */}
          {mode === "confirmed" && supersedeTarget && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap",
              padding: "10px 12px", marginBottom: 14,
              background: "#fff4e5", borderRadius: 10, border: "1px solid #ffd9a8",
            }}>
              <div style={{ flex: 1, minWidth: 180, fontSize: 12.5, color: "#9a5b00", lineHeight: 1.5 }}>
                Mogelijk dubbel met {supersedeTarget.label}.
              </div>
              <button
                onClick={handleSupersede}
                disabled={superseding}
                style={{
                  padding: "6px 11px", borderRadius: 9, background: superseding ? "#f0d9b8" : "#fff",
                  cursor: superseding ? "default" : "pointer", border: "1px solid #e0a94f",
                  color: "#9a5b00", fontWeight: 600, fontSize: 12.5,
                }}
              >
                {superseding ? "Bezig…" : `Deze vervangt ${supersedeTarget.label}`}
              </button>
              <button
                onClick={handleDismissDuplicate}
                disabled={superseding}
                style={{
                  padding: "6px 11px", borderRadius: 9, background: "transparent",
                  cursor: superseding ? "default" : "pointer", border: "1px solid transparent",
                  color: "#9a5b00", fontWeight: 600, fontSize: 12.5, textDecoration: "underline",
                }}
              >
                Nee, andere factuur
              </button>
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
                background: "#e8f0fe", border: "1.5px solid #1a73e8",
                color: "#1a73e8", fontWeight: 600, fontSize: 14,
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
                background: "#f8f9fa", textDecoration: "none",
              }}
            >
              <span style={{ fontSize: 15 }}>📁</span>
              <span style={{ flex: 1, fontSize: 13, color: "#5f6368" }}>
                Opgeslagen in{" "}
                <span style={{ color: "#202124", fontWeight: 600 }}>
                  {invoice.folder_name || "Mijn Bestanden"}
                </span>
              </span>
              <span style={{ fontSize: 15, color: "#dadce0" }}>›</span>
            </a>
          )}

          {/* Actions — depend on mode */}
          {mode === "confirmed" ? (
            /* [INCOMING-BEVESTIGD] Already out of the queue — read-only status, no verify action.
               'paid' = settled (green); 'received' = verified but still te betalen (blue). Full
               management (mark paid, edit, accountant handoff) lives on Crediteuren. */
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px",
                borderRadius: 980, fontSize: 13, fontWeight: 700,
                background: invoice.status === "paid" ? "#e6f4ea" : "#e8f0fe",
                color: invoice.status === "paid" ? "#137333" : "#1a56c4",
              }}>
                <span style={{ fontSize: 15 }}>{invoice.status === "paid" ? "✓" : "•"}</span>
                {invoice.status === "paid" ? "Betaald" : "Bevestigd · te betalen"}
              </span>
              <a
                href="/dashboard/incoming/manage"
                style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: "#1a73e8", textDecoration: "none" }}
              >
                Beheren ›
              </a>
            </div>
          ) : mode === "pending" ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={onIgnore}
                style={{
                  flex: 1, padding: "13px 0", borderRadius: 12,
                  background: "#f8f9fa", border: "none", color: "#5f6368",
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
                  background: "#eaf2ff", border: "none", color: "#1a73e8",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                Bewerken
              </button>
              <button
                onClick={onConfirmPaid}
                style={{
                  flex: 2, padding: "13px 0", borderRadius: 12,
                  background: "#34a853", border: "none", color: "#fff",
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
                background: "#e8f0fe", border: "1.5px solid #1a73e8",
                color: "#1a73e8", fontWeight: 600, fontSize: 14, cursor: "pointer",
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
      <span style={{ fontSize: 13, color: "#5f6368" }}>{label}</span>
      <span
        style={{
          fontSize: 13, color: "#202124",
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
  // [AUTO-ADVANCE-HONESTY] "auto" is a DIFFERENT outcome from "invoice", not a nicer word for
  // it: /api/intake books a clean, confident invoice straight to 'received' (auto_verified),
  // so it is NOT in this verify queue — it is with the Inkoopfacturen. Reporting it as
  // "invoice" pointed the owner at a card that is not here. "statement" / "turnover" /
  // "ledger" are the destinations the route gained since; without them each fell through to
  // the "invoice" default below and was announced as an invoice awaiting a tap.
  status: "auto" | "invoice" | "statement" | "turnover" | "ledger" | "document" | "bank" | "duplicate" | "error";
  message: string;
  // present for document / duplicate → deep-link + focus in Mijn bestanden
  link?: { folderId: string | null; focusId: string };
  // [INTAKE-FOCUS] present for invoice/receipt → "Naar controle →" deep-links to
  // this card in the verify queue (?focus=). The API always returned invoice_id;
  // the modal just never used it — the owner was told "controleer en bevestig"
  // without a path to the invoice.
  invoiceId?: string;
};

const RESULT_META: Record<IntakeResult["status"], { icon: string; color: string; label: string }> = {
  auto:      { icon: "✓",  color: M3.success, label: "Automatisch verwerkt" },
  invoice:   { icon: "✓",  color: M3.success, label: "Wacht op je controle" },
  statement: { icon: "🧾", color: "#9a5b00",  label: "Rekeningoverzicht gecontroleerd" },
  turnover:  { icon: "🛒", color: M3.success, label: "Omzet geboekt" },
  ledger:    { icon: "🔗", color: "#7B1FA2",  label: "Controle-check" },
  document:  { icon: "📁", color: "#1a73e8",  label: "In je bestanden" },
  bank:      { icon: "🏦", color: "#1a73e8",  label: "Bankafschrift" },
  duplicate: { icon: "ℹ️", color: "#5f6368",  label: "Al toegevoegd" },
  error:     { icon: "⚠️", color: "#b3261e",  label: "Niet gelukt" },
};

function ManualUpload({ onUploaded }: { onUploaded: () => void }) {
  const toast = useToast();
  const router = useRouter();
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

  // [MULTI-PAGE] "Meerdere pagina's = één factuur" flow. The owner explicitly gathers the
  // pages of ONE invoice (photograph or pick), we combine them into a single multi-page PDF,
  // and send it as ONE file — so a 2/3-page invoice never becomes 2/3 separate invoices.
  const [mpOpen, setMpOpen] = useState(false);
  const [mpPages, setMpPages] = useState<File[]>([]);
  const [combining, setCombining] = useState(false);
  const mpCameraRef = useRef<HTMLInputElement>(null);
  const mpFileRef = useRef<HTMLInputElement>(null);

  // [INTAKE-MULTI] Max files per batch — protects the server / AI from a huge drop.
  const MAX_BATCH = 20;
  // [MULTI-PAGE] A single invoice with more pages than this is unusual — cap so the combined
  // PDF and the AI read stay sane. Well above any real paper invoice.
  const MAX_PAGES = 20;

  // [INTAKE-KEEP-ALL] Accept every common invoice/document format. PDFs and images go to the
  // extractor; the rest (XML/UBL e-invoices, Office docs, CSV, e-mail files, bank exports) are
  // kept in bestanden by the server so nothing is ever lost. Only clearly non-document binaries
  // are refused here to avoid a pointless upload.
  const isOkType = (file: File) =>
    file.type === "application/pdf" ||
    file.type.startsWith("image/") ||
    /\.(pdf|xml|ubl|mt940|sta|camt|053|txt|csv|docx?|xlsx?|ods|odt|html?|eml|p7m)$/i.test(file.name);

  // [INTAKE-FEEDBACK] Upload one file via /api/intake and map the response to a
  // structured outcome (never throws) — the modal renders the destination.
  const uploadOne = async (file: File): Promise<IntakeResult> => {
    try {
      // [INTAKE-IMG-NORMALIZE] Convert an unreadable/oversized image to a bounded JPEG first; a
      // PDF/normal JPG/PNG is returned untouched. Never throws (worst case the original goes).
      const uploadFile = await normalizeImageForUpload(file, MAX_INTAKE_UPLOAD_BYTES);
      const formData = new FormData();
      formData.append("file", uploadFile);
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
        // [STATEMENT-RECONCILE] A supplier statement is a completeness CHECK, not a booking:
        // nothing enters the books, so it must not be announced as an added invoice.
        if (dest === "statement") {
          const docId = (data as { document_id?: string }).document_id;
          return {
            name: file.name, status: "statement", message,
            link: docId ? { folderId: (data as { folder_id?: string }).folder_id ?? null, focusId: docId } : undefined,
          };
        }
        if (dest === "turnover" || dest === "ledger") {
          return { name: file.name, status: dest, message };
        }
        // [AUTO-ADVANCE-HONESTY] A clean, confident invoice is booked straight to 'received' and
        // is therefore NOT in this queue — sending the owner to "controle" showed them a list
        // without the card they were promised. Same invoice_id, a truthful destination.
        // [INTAKE-FOCUS] keep invoice_id so the row can deep-link to the card either way.
        const autoVerified = (data as { auto_verified?: boolean }).auto_verified === true;
        return {
          name: file.name, status: autoVerified ? "auto" : "invoice", message,
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
      toast(`Maximaal ${MAX_BATCH} bestanden per keer. Je koos er ${all.length}.`, { tone: "error" });
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

    // [BANK-AUTO-RUN] If any file was a bank statement, close the circle right here: the
    // near-certain payments (reference + amount to the cent) get auto-booked so a matching
    // invoice moves to 'paid' immediately — the owner never has to walk over to /bank for it.
    // Best-effort; a matched count is surfaced on the bank line's result row.
    if (collected.some((r) => r.status === "bank")) {
      const booked = await triggerBankAutoConfirm();
      if (booked > 0) {
        for (const r of collected) {
          if (r.status === "bank") {
            r.message = `${r.message} — ${booked} betaling${booked === 1 ? "" : "en"} automatisch gekoppeld.`;
          }
        }
      }
    }

    onUploaded();
    setResults(collected);
    setShowResults(true);
  };

  // ── [MULTI-PAGE] "Meerdere pagina's = één factuur" ─────────────────────────────
  // Collect the pages (photograph or pick — images only), then combine them into ONE PDF and
  // send it through the SAME /api/intake as a single file. Never guesses: the owner opted in.
  const addMpPages = (fl: FileList | null) => {
    if (!fl || fl.length === 0) return;
    const imgs = Array.from(fl).filter(
      (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name),
    );
    if (imgs.length === 0) {
      toast("Kies foto's of afbeeldingen — de pagina's van de factuur.", { tone: "error" });
      return;
    }
    setMpPages((prev) => {
      const merged = [...prev, ...imgs];
      if (merged.length > MAX_PAGES) {
        toast(`Maximaal ${MAX_PAGES} pagina's per factuur.`, { tone: "error" });
        return merged.slice(0, MAX_PAGES);
      }
      return merged;
    });
  };
  const removeMpPage = (idx: number) => setMpPages((prev) => prev.filter((_, i) => i !== idx));
  const cancelMultiPage = () => { setMpOpen(false); setMpPages([]); };
  const combineAndUpload = async () => {
    // [MP-GUARD] Never run while a normal batch upload is in flight — both write the results
    // modal, and the loser's outcome would silently vanish.
    if (mpPages.length === 0 || combining || uploading) return;
    setCombining(true);
    try {
      const pdf = await combineImagesToPdf(mpPages);
      const result = await uploadOne(pdf);
      // [MP-RETRY] On a transient upload failure, KEEP the collected pages + the panel so the
      // owner can retry — never make them re-photograph every page.
      if (result.status === "error") {
        toast(result.message || "Uploaden mislukt — probeer het opnieuw.", { tone: "error" });
        return;
      }
      setMpOpen(false);
      setMpPages([]);
      onUploaded();
      setResults([result]);
      setShowResults(true);
    } catch (e) {
      // A combine failure names the failing page — keep the pages so the owner redoes only that one.
      toast(e instanceof Error && /Pagina/.test(e.message)
        ? `${e.message} De andere pagina's blijven bewaard.`
        : "Combineren mislukt. Maak duidelijkere foto's, of voeg de pagina's los toe.", { tone: "error" });
    } finally {
      setCombining(false);
    }
  };

  // [INTAKE-FEEDBACK] Close the modal AND refresh so new invoices show in the queue.
  const closeResults = () => {
    setShowResults(false);
    router.refresh();
  };

  const openInBestanden = (link: { folderId: string | null; focusId: string }) => {
    router.push(`/dashboard/bestanden?folder=${link.folderId ?? ""}&focus=${link.focusId}`);
  };

  // [INTAKE-FOCUS] "Naar controle →" — same full-navigation pattern as
  // openInBestanden/closeResults (this page reloads anyway to refresh the
  // queue); ?focus= makes the main component expand + scroll + ring the card.
  const goToInvoice = (invoiceId: string) => {
    window.location.assign(`/dashboard/incoming?focus=${invoiceId}`);
  };

  const addedCount = results.filter((r) => r.status === "invoice" || r.status === "document" || r.status === "bank").length;

  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          fontSize: 13, fontWeight: 600, color: "#5f6368",
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
          background: uploading ? "#dadce0" : "#1a73e8", color: "#fff",
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
          border: `2px dashed ${dragOver ? "#1a73e8" : "#dadce0"}`,
          background: dragOver ? "#e8f0fe" : "#f8f9fa",
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
          accept=".pdf,image/*,.xml,.ubl,.mt940,.sta,.camt,.053,.txt,.csv,.doc,.docx,.xls,.xlsx,.ods,.odt,.html,.htm,.eml,.p7m"
          style={{ display: "none" }}
          disabled={uploading}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />
        <span style={{ fontSize: 28 }}>{uploading ? "⏳" : "📎"}</span>
        <span style={{ fontSize: 14, color: uploading ? "#5f6368" : "#1a73e8", fontWeight: 600 }}>
          {uploading
            ? (total > 1 ? `${current} van ${total} verwerkt…` : "Verwerken…")
            : "Kies bestanden of sleep hier naartoe"}
        </span>
        <span style={{ fontSize: 12, color: "#5f6368" }}>
          PDF, afbeelding of bankafschrift — meerdere tegelijk (max {MAX_BATCH})
        </span>

        {/* [INTAKE-MULTI] Batch progress bar */}
        {uploading && total > 1 && (
          <div style={{ width: "100%", height: 4, background: "#e0e0e0", borderRadius: 9999, overflow: "hidden", marginTop: 4 }}>
            <div style={{
              width: `${Math.round((current / total) * 100)}%`,
              height: "100%", background: "#1a73e8", borderRadius: 9999,
              transition: "width 0.3s cubic-bezier(0.4,0,0.2,1)",
            }} />
          </div>
        )}
      </label>

      {/* [MULTI-PAGE] Hidden inputs for the multi-page flow (camera adds one page at a time;
          the file picker can add several images at once). Images only — pages of one invoice. */}
      <input
        ref={mpCameraRef} type="file" accept="image/*" capture="environment"
        style={{ display: "none" }}
        onChange={(e) => { addMpPages(e.target.files); e.currentTarget.value = ""; }}
      />
      <input
        ref={mpFileRef} type="file" accept="image/*" multiple
        style={{ display: "none" }}
        onChange={(e) => { addMpPages(e.target.files); e.currentTarget.value = ""; }}
      />

      {/* [MULTI-PAGE] Entry button — a paper invoice of 2+ pages photographed as several images. */}
      {!mpOpen ? (
        <button
          onClick={() => !uploading && setMpOpen(true)}
          disabled={uploading}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            width: "100%", padding: "12px", borderRadius: 14, marginTop: 10,
            background: "#fff", color: "#007aff", border: "1.5px solid #d1d1d6",
            fontWeight: 600, fontSize: 14, cursor: uploading ? "not-allowed" : "pointer",
          }}
        >
          <span style={{ fontSize: 17 }}>📄</span>
          Factuur met meerdere pagina&apos;s
        </button>
      ) : (
        <div style={{ marginTop: 10, padding: 14, borderRadius: 16, border: "1.5px solid #007aff", background: "#f5faff" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1c1c1e", marginBottom: 4 }}>
            Eén factuur, meerdere pagina&apos;s
          </div>
          <div style={{ fontSize: 12.5, color: "#5f6368", marginBottom: 12, lineHeight: 1.4 }}>
            Fotografeer of kies elke pagina van dezelfde factuur. We voegen ze samen tot één
            factuur — geen losse facturen. (Voor verschillende facturen: voeg ze los toe.)
          </div>

          {/* Collected pages */}
          {mpPages.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {mpPages.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", borderRadius: 10, border: "1px solid #e5e5ea" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#007aff", minWidth: 58 }}>Pagina {i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#5f6368", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <button onClick={() => removeMpPage(i)} aria-label="Verwijder pagina"
                    disabled={combining}
                    style={{ border: "none", background: "transparent", color: "#70757a", fontSize: 18, cursor: combining ? "default" : "pointer", lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Add-page actions */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button onClick={() => !combining && mpCameraRef.current?.click()} disabled={combining}
              style={{ flex: 1, padding: "10px", borderRadius: 12, border: "1px solid #d1d1d6", background: "#fff", color: "#007aff", fontWeight: 600, fontSize: 13, cursor: combining ? "default" : "pointer" }}>
              📷 Pagina fotograferen
            </button>
            <button onClick={() => !combining && mpFileRef.current?.click()} disabled={combining}
              style={{ flex: 1, padding: "10px", borderRadius: 12, border: "1px solid #d1d1d6", background: "#fff", color: "#007aff", fontWeight: 600, fontSize: 13, cursor: combining ? "default" : "pointer" }}>
              🖼️ Pagina&apos;s kiezen
            </button>
          </div>

          {/* Combine + cancel */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={cancelMultiPage} disabled={combining}
              style={{ padding: "11px 16px", borderRadius: 12, border: "none", background: "#f1f3f4", color: "#5f6368", fontWeight: 600, fontSize: 14, cursor: combining ? "default" : "pointer" }}>
              Annuleer
            </button>
            <button onClick={combineAndUpload} disabled={combining || uploading || mpPages.length === 0}
              style={{ flex: 1, padding: "11px", borderRadius: 12, border: "none", fontWeight: 700, fontSize: 14,
                background: combining || uploading || mpPages.length === 0 ? "#c7c7cc" : "#007aff", color: "#fff",
                cursor: combining || uploading || mpPages.length === 0 ? "default" : "pointer" }}>
              {combining ? "Bezig…" : mpPages.length > 0 ? `Combineer ${mpPages.length} pagina${mpPages.length === 1 ? "" : "'s"} → één factuur` : "Voeg eerst pagina's toe"}
            </button>
          </div>
        </div>
      )}

      {/* [MULTI-PAGE] Honest note: one PDF must be one invoice — the app reads a PDF as a single
          invoice (all pages together). A PDF holding several DIFFERENT invoices can't be split. */}
      <div style={{ fontSize: 11.5, color: "#8e8e93", marginTop: 8, lineHeight: 1.45 }}>
        Let op: één PDF = één factuur (alle pagina&apos;s samen). Zitten er meerdere verschillende
        facturen in één PDF? Splits ze niet — voeg elke factuur los toe.
      </div>

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
              paddingBottom: "calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))",
              width: "100%", maxWidth: 430, maxHeight: "80vh", overflowY: "auto",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 19, color: "#202124", marginBottom: 4 }}>
              {addedCount > 0
                ? `${addedCount} bestand${addedCount > 1 ? "en" : ""} toegevoegd`
                : "Klaar"}
            </div>
            <div style={{ fontSize: 14, color: "#5f6368", marginBottom: 16 }}>
              Dit is er met je {results.length > 1 ? "bestanden" : "bestand"} gebeurd:
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {results.map((r, i) => {
                const meta = RESULT_META[r.status];
                return (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 12, background: "#f8f9fa" }}>
                    <span style={{ fontSize: 16, lineHeight: "20px" }}>{meta.icon}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "#202124", margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.name}
                      </p>
                      {/* [AUTO-ADVANCE-HONESTY] WHAT happened, in the app's own words, before the
                          server's sentence. The message alone could not distinguish an invoice
                          that is waiting for a tap from one that is already booked — and those
                          are the two outcomes the owner must never confuse. */}
                      <p style={{ fontSize: 12, color: meta.color, margin: 0, fontWeight: 600 }}>{meta.label}</p>
                      <p style={{ fontSize: 12, color: "#5f6368", margin: 0 }}>{r.message}</p>
                      {r.link && (
                        <button
                          type="button"
                          onClick={() => openInBestanden(r.link!)}
                          style={{ marginTop: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: "#1a73e8", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}
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
                          style={{ marginTop: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: "#1a73e8", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}
                        >
                          Naar controle →
                        </button>
                      )}
                      {/* [AUTO-ADVANCE-HONESTY] Already booked → the link goes where the invoice
                          actually IS (Inkoopfacturen), never to a queue it never entered. */}
                      {r.status === "auto" && (
                        <Link
                          href={r.invoiceId ? `/dashboard/incoming/manage?focus=${r.invoiceId}` : "/dashboard/incoming/manage"}
                          style={{ marginTop: 6, display: "inline-block", color: "#1a73e8", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}
                        >
                          Naar Inkoopfacturen →
                        </Link>
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
                background: "#34a853", color: "#fff", border: "none",
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
  confirmedInvoices,
  connectionStatus,
}: Props) {
  const dialog = useDialog();
  const toast = useToast();
  const router = useRouter();
  // [BOEK-011] Navigation paths — resolved through the central navigation helper
  // [SUBNAV] Logo (home) + Terug (canonical parent) now come from the shared
  // sub-page header (DashboardChrome), so this page no longer computes them.

  const [pending, setPending] = useState<IncomingInvoice[]>(initialInvoices);
  const [ignored, setIgnored] = useState<IncomingInvoice[]>(ignoredInvoices);
  // [INCOMING-BEVESTIGD] Read-only surface of recently confirmed invoices — no mutations here.
  const [confirmed] = useState<IncomingInvoice[]>(confirmedInvoices);
  const [tab, setTab] = useState<Tab>("pending");
  // [SEARCH] In-page live filter — dedicated to this page only. Filters the loaded
  // incoming invoices (supplier / invoice number / amount) instantly, in place.
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
    // Expand + ring on the next tick (never synchronously in the effect body —
    // avoids a cascading re-render during the effects pass).
    const applyTimer = setTimeout(() => {
      setFocusId(id);
      setExpandedId(id);
    }, 0);
    window.history.replaceState({}, "", window.location.pathname);
    const t = setTimeout(() => setFocusId(null), 2600);
    return () => { clearTimeout(applyTimer); clearTimeout(t); };
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
  // [NEGEER-REDEN] De keuze in de negeer-dialoog. Altijd null bij het openen — nooit een
  // voorgeselecteerde reden, want dan legt het scherm de eigenaar een antwoord in de mond.
  const [ignoreReason, setIgnoreReason] = useState<ArchiveReason | null>(null);
  // [AFZENDERREGEL] De factuur waarvoor we zojuist "altijd negeren van deze afzender" aanbieden,
  // en de regels die al gelden (getoond bij Genegeerd, zodat ze op te heffen zijn).
  const [ruleOfferFor, setRuleOfferFor] = useState<IncomingInvoice | null>(null);
  const [senderRules, setSenderRules] = useState<{ id: string; sender_email: string }[]>([]);
  // [RITME] Leveranciers met een vast ritme waarvan de verwachte factuur uitblijft. Verreweg
  // meestal leeg — dan is er ook geen banner. Zie de drie zwijg-regels in supplier-cadence.ts.
  const [missing, setMissing] = useState<{ supplier: string; reason: string; lastSeen: string }[]>([]);
  const [missingDismissed, setMissingDismissed] = useState(false);

  // [NEGEER-UNDO] Een toast met een handeling erin ("Ongedaan maken"). De tijd staat bewust
  // langer (7s) wanneer er iets te ondoen valt: 3 seconden is genoeg om iets te LEZEN, niet om
  // te beslissen dat je het toch niet wilde.
  // [MOTION] De weergave komt nu van de app-brede snackbar (components/ui/Toast); deze wikkel
  // vertaalt alleen de lokale {label, run}-vorm naar {label, onClick}, zodat de ruim twintig
  // aanroepen hieronder ongewijzigd blijven.
  const showToast = (msg: string, action?: { label: string; run: () => void }) =>
    toast(msg, action
      ? { action: { label: action.label, onClick: action.run }, duration: 7000 }
      : { duration: 3000 });

  // OAuth result toast — shown on the next tick (never synchronously in the
  // effect body — avoids a cascading re-render during the effects pass).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (!connected && !error) return;
    const msg = connected
      ? `${connected === "gmail" ? "Gmail" : "Outlook"} succesvol verbonden!`
      : "Verbinding mislukt — probeer opnieuw";
    const t = setTimeout(() => showToast(msg), 0);
    window.history.replaceState({}, "", window.location.pathname);
    return () => clearTimeout(t);
  }, []);

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
          // [BANK-AUTO-RUN] The invoice is now verified ('received') and matchable. If the
          // bank line that paid it is already waiting, book that link right here — the owner
          // never has to open /bank to connect a payment that's already in. Best-effort.
          const booked = await triggerBankAutoConfirm();
          showToast(
            booked > 0
              ? `✓ Geverifieerd · ${booked} betaling${booked > 1 ? "en" : ""} automatisch gekoppeld`
              : "✓ Factuur geverifieerd"
          );
        } else {
          // [UI-HONESTY] The server rejected it — roll back the optimistic remove so the invoice
          // stays visible in the queue instead of vanishing on a lie.
          setPending((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
          showToast("Verificatie mislukt — factuur staat nog in de wachtrij");
        }
      } catch {
        setPending((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
        showToast("Fout — factuur staat nog in de wachtrij");
      }
    },
    []
  );

  // ── [INTAKE-VERIFY-BULK] Bulk verify — select many → confirm via modal ──
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  // ── [REIMPORT-ALL] One-tap re-read of every "Aandacht nodig" invoice ──
  // Re-runs the extractor over each flagged invoice's stored file, exactly like the
  // per-card "Opnieuw inlezen" — improve-or-keep, never auto-verifies, status stays
  // 'processing'. So each invoice keeps its own current state; only the READ is redone.
  const [reimportAllRunning, setReimportAllRunning] = useState(false);
  const [reimportAllDone, setReimportAllDone] = useState(0);

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
    // [TRUST-BULK] Bulk verify books the stored amounts AS-IS, with no per-invoice
    // review. So a card flagged "Aandacht nodig" (an uncertain/likely-wrong amount, a
    // missing date, a rekenfout) must NEVER be swept into a batch unseen — that is the
    // one path that could write a known-uncertain number into the accountant's books.
    // We confirm only the clean ones and send the flagged ones back for individual
    // review, honestly. (selectAllReady already excludes them; this guards the manual
    // hand-tap case too.)
    const flagged = targets.filter((p) => p.health.level === "needs-review");
    const cleanTargets = targets.filter((p) => p.health.level !== "needs-review");
    if (cleanTargets.length === 0) {
      setBulkConfirmOpen(false);
      showToast(`${flagged.length} factuur${flagged.length > 1 ? "en hebben" : " heeft"} aandacht nodig — open ${flagged.length > 1 ? "ze" : "hem"} los om te controleren`);
      return;
    }
    setBulkConfirmOpen(false);
    setBulkRunning(true);

    let ok = 0;
    const failedNames: string[] = [];
    for (const inv of cleanTargets) {
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
    // [BANK-AUTO-RUN] ONE auto-confirm pass after the whole batch (never per invoice — that
    // would re-scan the full set N times). Everything just verified is now matchable; any bank
    // lines already waiting for them get booked in a single sweep.
    const booked = ok > 0 ? await triggerBankAutoConfirm() : 0;
    const heldNote = flagged.length > 0 ? ` · ${flagged.length} met aandacht overgeslagen` : "";
    const bookedNote = booked > 0 ? ` · ${booked} betaling${booked > 1 ? "en" : ""} gekoppeld` : "";
    if (failedNames.length === 0) {
      showToast(`✓ ${ok} factuur${ok > 1 ? "en" : ""} geverifieerd${bookedNote}${heldNote}`);
    } else {
      showToast(`${ok} geverifieerd · ${failedNames.length} mislukt${heldNote} — ververs de pagina`);
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
          // [UI-HONESTY] Roll back the optimistic remove — the payment was NOT recorded.
          setPending((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
          showToast("Bevestiging mislukt — factuur staat nog in de wachtrij");
        }
      } catch {
        setPending((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
        showToast("Fout — factuur staat nog in de wachtrij");
      }
    },
    []
  );

  // ── Restore ignored → pending ──
  // [NEGEER-UNDO] Staat bewust VÓÓR handleIgnore: de "Ongedaan maken"-knop in de negeer-toast
  // roept dit pad aan, en zo hoeft dat niet via een ref (die de React-compiler terecht weigert:
  // een ref muteren rond de render is een side-effect). Eén herstelpad, één waarheid.
  const handleRestore = useCallback(async (invoice: IncomingInvoice) => {
    setIgnored((prev) => prev.filter((inv) => inv.id !== invoice.id));
    setPending((prev) => [invoice, ...prev]);
    setExpandedId(null);

    // [UI-HONESTY] Same as ignore: only claim "teruggezet" when the server actually accepted it;
    // otherwise roll back to the ignored list so the UI reflects the real state.
    const rollback = () => {
      setPending((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setIgnored((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
    };
    try {
      const res = await fetch(`/api/email/confirm/${invoice.id}`, { method: "PATCH" });
      if (res.ok) {
        showToast("Factuur teruggezet");
      } else {
        rollback();
        showToast("Terugzetten mislukt — probeer opnieuw");
      }
    } catch {
      rollback();
      showToast("Fout — probeer opnieuw");
    }
  }, []);

  // ── Ignore — archive ──
  const handleIgnore = useCallback(async (invoice: IncomingInvoice, reason: ArchiveReason | null) => {
    setPending((prev) => prev.filter((inv) => inv.id !== invoice.id));
    // [NEGEER-REDEN] Optimistisch mee in de lijst, zodat het label meteen klopt met wat er
    // zojuist gekozen is — ook vóór de volgende paginalading.
    setIgnored((prev) => [{ ...invoice, archive_reason: reason }, ...prev]);
    setIgnoreFor(null);
    setIgnoreReason(null);
    setExpandedId(null);

    // [UI-HONESTY] A fetch that resolves is NOT proof of success — a 4xx/5xx (not found, RLS reject)
    // resolves with res.ok=false. The old code showed "genegeerd" regardless, so a failed ignore
    // looked done. Check res.ok and, on failure, roll back to the queue and say so.
    const rollback = () => {
      setIgnored((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setPending((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
    };
    try {
      const res = await fetch(`/api/email/confirm/${invoice.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        // [NEGEER-UNDO] Negeren is één tik en het haalt een factuur uit beeld — dus hoort de weg
        // terug in dezelfde tik te zitten, niet in een tabblad dat je eerst moet vinden. Hergebruikt
        // exact het herstelpad van de Genegeerd-lijst (PATCH), dus er is geen tweede waarheid.
        // [AFZENDERREGEL] Alleen bij "geen factuur" bieden we de blijvende regel aan: dat is de
        // enige reden die iets zegt over wat dit ADRES structureel stuurt. "Dubbel" en "niet van
        // mij" gaan over deze ene factuur — daar een regel van maken zou echte post laten
        // verdwijnen. Het aanbod is een tweede scherm, nooit iets dat vanzelf gebeurt.
        if (mayOfferSenderRule(reason, invoice.client_email)) {
          setRuleOfferFor(invoice);
          showToast("Factuur genegeerd");
        } else {
          showToast("Factuur genegeerd", {
            label: "Ongedaan maken",
            run: () => { void handleRestore(invoice); },
          });
        }
      } else {
        rollback();
        showToast("Negeren mislukt — factuur staat nog in de wachtrij");
      }
    } catch {
      rollback();
      showToast("Fout — factuur staat nog in de wachtrij");
    }
  }, [handleRestore]);

  // [RITME] Eén keer per paginabezoek ophalen. Het is een read-only rekensom over bestaande
  // facturen — geen AI, geen kosten — en het antwoord is meestal een lege lijst.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/incoming/missing");
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (!cancelled && Array.isArray(data.missing)) setMissing(data.missing);
      } catch {
        // Stil falen: dit is een extra oog, nooit iets waar de pagina op mag stukgaan.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── [AFZENDERREGEL] De regels van de eigenaar: ophalen, aanzetten, opheffen ──
  // Alleen geladen wanneer het Genegeerd-tabblad open staat: daar horen ze thuis (het is de plek
  // waar je kijkt als je iets mist) en zo kost het de wachtrij niets.
  const loadSenderRules = useCallback(async () => {
    try {
      const res = await fetch("/api/email/sender-rules");
      if (!res.ok) {
        // [UI-HONESTY] Een lege lijst tonen zou hier LIEGEN: er kunnen regels zijn die op dit
        // moment post tegenhouden, en dan denkt de eigenaar dat er niets staat terwijl hij ze
        // niet kan opheffen. De server maakt onderscheid tussen "tabel bestaat niet" (echt geen
        // regels, stille lege lijst) en een echte fout; die laatste zeggen we hardop.
        const data = await res.json().catch(() => ({}));
        if (data?.error) showToast(data.error);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setSenderRules(Array.isArray(data.rules) ? data.rules : []);
    } catch {
      showToast("Afzenderregels konden niet worden geladen — ververs de pagina");
    }
  }, []);

  const addSenderRule = useCallback(async (invoice: IncomingInvoice) => {
    setRuleOfferFor(null);
    try {
      const res = await fetch("/api/email/sender-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: invoice.client_email, invoice_id: invoice.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(`Post van ${data.sender_email ?? "deze afzender"} wordt voortaan overgeslagen`);
        void loadSenderRules();
      } else {
        // [UI-HONESTY] Nooit "regel ingesteld" zeggen als er niets is ingesteld.
        showToast(data.error || "Regel instellen mislukt — probeer het opnieuw");
      }
    } catch {
      showToast("Regel instellen mislukt — controleer je verbinding");
    }
  }, [loadSenderRules]);

  const removeSenderRule = useCallback(async (email: string) => {
    // Optimistisch weg uit de lijst; bij een fout halen we de echte stand weer op.
    setSenderRules((prev) => prev.filter((r) => r.sender_email !== email));
    try {
      const res = await fetch(`/api/email/sender-rules?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      if (res.ok) {
        showToast(`Post van ${email} komt weer binnen`);
      } else {
        showToast("Regel opheffen mislukt — probeer het opnieuw");
        void loadSenderRules();
      }
    } catch {
      showToast("Regel opheffen mislukt — controleer je verbinding");
      void loadSenderRules();
    }
  }, [loadSenderRules]);

  // ── [REIMPORT-ALL] Re-read every flagged invoice in one tap ──
  // Sequential (never hammer the AI): one reimport call per "Aandacht nodig" invoice.
  // Each call is improve-or-keep and leaves status='processing', so an invoice's own
  // state is preserved — only its extraction is refreshed. One page reload at the end
  // picks up the new amounts + health for every card at once.
  const handleReimportAllNeedsAttention = useCallback(async () => {
    if (reimportAllRunning) return;
    const targets = pending.filter((p) => p.health.level === "needs-review");
    if (targets.length === 0) return;
    // [REREAD-STRONG] The re-read is a heavier, on-demand read per invoice; confirm before running
    // it across the whole flagged set so a large queue isn't kicked off (and the page blocked) by
    // an accidental tap.
    if (targets.length > 1) {
      const ok = await dialog.confirm({
        title: `${targets.length} facturen opnieuw inlezen?`,
        message: "Elke gemarkeerde factuur wordt opnieuw gelezen. Dat kan even duren — je kunt ondertussen niets anders doen op dit scherm.",
        confirmLabel: "Opnieuw inlezen",
      });
      if (!ok) return;
    }
    setReimportAllRunning(true);
    setReimportAllDone(0);

    let reread = 0;
    let notInvoice = 0;
    // [HERLEES-ARCHIVEER] Hoeveel daarvan de server ook echt heeft weggezet. Apart geteld, want
    // "bleek geen factuur" en "is verplaatst naar Genegeerd" zijn twee verschillende beweringen en
    // de samenvatting mag alleen het tweede zeggen als het ook gebeurd is.
    let archivedNotInvoice = 0;
    let skipped = 0;
    let failed = 0;
    for (const inv of targets) {
      try {
        const res = await fetch(`/api/email/reimport/${inv.id}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) reread++;
        else if (data.notInvoice) { notInvoice++; if (data.archived) archivedNotInvoice++; }
        // 409 = the card is no longer 'processing' (e.g. the owner verified it just before this
        // reached it). That is not a failure — count it as skipped so the summary stays honest.
        else if (res.status === 409) skipped++;
        else failed++;
      } catch {
        failed++;
      }
      setReimportAllDone((n) => n + 1);
    }

    setReimportAllRunning(false);
    // A blocking summary only when something needs the owner's eye; otherwise the refreshed cards
    // are the feedback. "opnieuw ingelezen" (re-read), not "bijgewerkt" — reimport always re-reads
    // but keeps the stored amounts when the fresh read is no better, so it may not have changed.
    if (notInvoice > 0 || failed > 0) {
      // Kept as a dialog rather than a snackbar: this is a multi-line result
      // the owner has to act on, and it must not scroll away unread.
      await dialog.alert({
        title: "Opnieuw inlezen klaar",
        message:
          `• ${reread} opnieuw ingelezen\n` +
          (archivedNotInvoice
            ? `• ${archivedNotInvoice} bleek geen boekbare factuur — verplaatst naar Genegeerd (reden: geen factuur)\n`
            : "") +
          (notInvoice - archivedNotInvoice > 0
            ? `• ${notInvoice - archivedNotInvoice} bleek geen boekbare factuur, maar kon niet worden weggezet — bekijk die zelf\n`
            : "") +
          (skipped ? `• ${skipped} overgeslagen (al bevestigd)\n` : "") +
          (failed ? `• ${failed} niet gelukt — probeer die later los opnieuw` : ""),
      });
    }
    router.refresh();
  }, [pending, reimportAllRunning, dialog, router]);

  const list = tab === "pending" ? pending : tab === "confirmed" ? confirmed : ignored;

  // [SEARCH] Live, in-place filter over the loaded list (supplier name / invoice number /
  // whole-euro amount). The page holds the full set (server caps at 100/50), so this is
  // complete — no navigation, no reload.
  // [SMART-FILTER] shared matcher — leverancier / factuurnummer / bedrag
  // (decimaal- én duizendtal-bewust, zie src/lib/search.ts)
  const rawQ = search.trim();
  const filteredList = rawQ
    ? list.filter((inv) =>
        rowMatchesQuery(rawQ, [inv.client_name, inv.invoice_number], [inv.total_inc_btw])
      )
    : list;

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
        // [HEADER-SYSTEM] Was var(--font-sans) (could resolve to a non-Roboto
        // face); now the shared Roboto FONT token, matching the shared bar above.
        fontFamily: FONT,
      }}
    >
      {/* [HEADER-SYSTEM] The title "Inkomend" + back live in the shared sub-page
          bar (DashboardChrome/STATIC_TITLES). This block is now just the status
          subtitle. (Removed a stale comment describing a Logo/Terug header that no
          longer exists here.) */}
      <div style={{ padding: "20px 20px 0", marginBottom: 16 }}>
        {/* [IMPORT-MONITOR] Two-axis subtitle — calm about correctness, honest
            about flow. Never says "done" while items still wait to be sent. */}
        {pending.length === 0 ? (
          <p style={{ fontSize: 14, color: "#5f6368", margin: "4px 0 0" }}>
            Alles verwerkt
          </p>
        ) : needsAttentionCount > 0 ? (
          <p style={{ fontSize: 14, color: "#EA8600", margin: "4px 0 0", fontWeight: 600 }}>
            {needsAttentionCount}{" "}
            {needsAttentionCount === 1 ? "factuur heeft" : "facturen hebben"} je
            aandacht nodig
            {readyToConfirmCount > 0 && (
              <span style={{ color: "#5f6368", fontWeight: 400 }}>
                {" "}· {readyToConfirmCount} klaar om te bevestigen
              </span>
            )}
          </p>
        ) : (
          <p style={{ fontSize: 14, color: "#5f6368", margin: "4px 0 0" }}>
            <span style={{ color: M3.success, fontWeight: 600 }}>
              Niets om te corrigeren
            </span>{" "}
            · {readyToConfirmCount}{" "}
            {readyToConfirmCount === 1 ? "factuur klaar" : "facturen klaar"} om te
            bevestigen
          </p>
        )}
        {/* [REIMPORT-ALL] One tap re-reads every "Aandacht nodig" invoice — each keeps its
            own current state (improve-or-keep, never verified). Only on the pending tab and
            only when something is actually flagged. */}
        {tab === "pending" && needsAttentionCount > 0 && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={handleReimportAllNeedsAttention}
              disabled={reimportAllRunning}
              aria-label="Alle facturen die aandacht nodig hebben opnieuw inlezen"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 10,
                background: "#fef7e0", color: "#B06000",
                border: "1px solid #FDE293",
                fontSize: 14, fontWeight: 600,
                cursor: reimportAllRunning ? "default" : "pointer",
                opacity: reimportAllRunning ? 0.7 : 1,
              }}
            >
              {reimportAllRunning
                ? `Bezig met opnieuw inlezen… (${reimportAllDone}/${needsAttentionCount})`
                : `↻ Alles met aandacht opnieuw inlezen (${needsAttentionCount})`}
            </button>
          </div>
        )}

        {/* [BRIDGE-POLISH 3b] Entry to the management surface for confirmed
            incoming invoices (received/paid). iOS-styled to match THIS surface. */}
        <Link
          href="/dashboard/incoming/manage"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            marginTop: 12, padding: "8px 14px", borderRadius: 10,
            background: "#e8f0fe", color: "#1a73e8",
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
            background: "#f8f9fa", borderRadius: 12, padding: 4,
          }}
        >
          {([
            ["pending", `Te bevestigen${pending.length ? ` (${pending.length})` : ""}`],
            ["confirmed", `Bevestigd${confirmed.length ? ` (${confirmed.length})` : ""}`],
            ["ignored", `Genegeerd${ignored.length ? ` (${ignored.length})` : ""}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key); setExpandedId(null);
                // [AFZENDERREGEL] Regels pas ophalen als het tabblad waar ze staan open gaat —
                // de wachtrij hoeft er niet op te wachten.
                if (key === "ignored") void loadSenderRules();
              }}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 9, border: "none",
                background: tab === key ? "#fff" : "transparent",
                color: tab === key ? "#202124" : "#5f6368",
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
                  background: "#e8f0fe", border: "none", color: "#1a73e8",
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
                    background: "#e8f0fe", border: "none", color: "#1a73e8",
                    fontWeight: 700, fontSize: 14, cursor: "pointer",
                    padding: "8px 16px", borderRadius: 980, whiteSpace: "nowrap",
                  }}
                >
                  Selecteer klaar ({pending.filter((p) => p.health.level !== "needs-review").length})
                </button>
                <button
                  onClick={exitSelectMode}
                  style={{
                    background: "#f8f9fa", border: "none", color: "#3c4043",
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

        {/* [RITME] De factuur die NIET kwam. Alleen op het tabblad "Te bevestigen", want daar
            komt de eigenaar om zijn inkomende post af te handelen — en dit is het enige dat hij
            daar NIET kan zien staan. Blauw en rustig, geen alarm: er is niets stuk, er is iets
            afwezig. Wegklikbaar, want een banner die je niet weg kunt krijgen wordt meubilair. */}
        {tab === "pending" && missing.length > 0 && !missingDismissed && (
          <div style={{
            marginBottom: 16, padding: "13px 15px", borderRadius: 12,
            background: "#e8f0fe", border: "1px solid #c6dafc",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#174ea6", marginBottom: 6 }}>
                {missing.length === 1
                  ? "Er lijkt een factuur te ontbreken"
                  : `Er lijken ${missing.length} facturen te ontbreken`}
              </div>
              <button
                onClick={() => setMissingDismissed(true)}
                aria-label="Melding sluiten"
                style={{
                  background: "transparent", border: "none", color: "#174ea6",
                  fontSize: 16, lineHeight: 1, cursor: "pointer", padding: 0,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {missing.map((m) => (
                <div key={`${m.supplier}-${m.lastSeen}`} style={{ fontSize: 13, color: "#1f3d68", lineHeight: 1.5 }}>
                  {m.reason}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* [AFZENDERREGEL] De regels van de eigenaar staan bij Genegeerd, want dat is de plek waar
            je kijkt als je iets mist. Elke regel met het adres erbij en één knop om hem op te
            heffen — een mechanisme dat post ongezien tegenhoudt moet net zo makkelijk uit als aan. */}
        {tab === "ignored" && senderRules.length > 0 && (
          <div style={{
            marginBottom: 16, padding: "12px 14px", borderRadius: 12,
            background: "#f8f9fa", border: "1px solid #e8eaed",
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#3c4043", marginBottom: 8 }}>
              Afzenders die je overslaat
            </div>
            <div style={{ fontSize: 12, color: "#5f6368", marginBottom: 10, lineHeight: 1.45 }}>
              Bijlagen van deze adressen worden niet geïmporteerd. De e-mails zelf blijven gewoon in
              je mailbox staan, en wat overgeslagen is zie je terug bij “Overgeslagen bij import”.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {senderRules.map((r) => (
                <div key={r.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                  padding: "8px 10px", borderRadius: 9, background: "#fff", border: "1px solid #e8eaed",
                }}>
                  <span style={{ fontSize: 13, color: "#202124", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.sender_email}
                  </span>
                  <button
                    onClick={() => removeSenderRule(r.sender_email)}
                    style={{
                      background: "transparent", border: "none", color: "#1a73e8",
                      fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", padding: 0,
                    }}
                  >
                    Opheffen
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* [SEARCH] In-page live filter (this page only) */}
        {(list.length > 0 || rawQ) && (
          <div style={{ position: "relative", marginBottom: 14 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" strokeWidth="2" style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)" }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoek op leverancier, factuurnummer of bedrag…"
              aria-label="Inkomende facturen zoeken"
              style={{ width: "100%", boxSizing: "border-box", padding: "11px 38px", borderRadius: 12, border: "1px solid #d1d1d6", fontSize: 15, outline: "none", background: "#fff", color: "#1c1c1e" }}
            />
            {search && (
              <button onClick={() => setSearch("")} aria-label="Zoekopdracht wissen"
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, borderRadius: "50%", border: "none", background: "#e5e5ea", color: "#3a3a3c", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>✕</button>
            )}
          </div>
        )}

        {/* Invoice list */}
        {filteredList.length > 0 ? (
          <div style={{ marginBottom: 24 }}>
            {filteredList.map((inv) => (
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
        ) : rawQ ? (
          <div style={{ textAlign: "center", padding: "48px 24px", color: "#8e8e93" }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>🔍</div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6, color: "#1c1c1e" }}>Geen facturen gevonden</div>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>Niets voor &ldquo;{rawQ}&rdquo; in {tab === "pending" ? "te verwerken" : tab === "confirmed" ? "bevestigd" : "genegeerd"}.</div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "48px 24px", color: "#5f6368" }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>
              {tab === "pending" ? "✅" : tab === "confirmed" ? "🗂️" : "📭"}
            </div>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 8, color: "#202124" }}>
              {tab === "pending" ? "Alles bijgewerkt" : tab === "confirmed" ? "Nog niets bevestigd" : "Geen genegeerde facturen"}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              {tab === "pending"
                ? "Nieuwe facturen verschijnen hier zodra ze binnenkomen."
                : tab === "confirmed"
                  ? "Facturen die je verifieert of markeert als betaald verschijnen hier."
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
            padding: "12px 16px calc(12px + var(--bottom-nav-h) + env(safe-area-inset-bottom))",
            background: "rgba(255,255,255,0.96)", backdropFilter: "blur(8px)",
            borderTop: "1px solid #e0e0e0",
            display: "flex", justifyContent: "center",
          }}
        >
          <button
            onClick={() => setBulkConfirmOpen(true)}
            style={{
              width: "100%", maxWidth: 430, padding: "16px", borderRadius: 14,
              background: "#34a853", color: "#fff", border: "none",
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
          <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", fontSize: 15, fontWeight: 600, color: "#202124" }}>
            Bezig met verifiëren…
          </div>
        </div>
      )}

      {/* [REIMPORT-ALL] Block the page while the batch re-read runs — so an edit modal can't be
          opened mid-run and then wiped by the end-of-run reload, and no card can be verified into
          a 409. */}
      {reimportAllRunning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", fontSize: 15, fontWeight: 600, color: "#202124", textAlign: "center" }}>
            Bezig met opnieuw inlezen…
            <div style={{ fontSize: 13, fontWeight: 400, color: "#5f6368", marginTop: 4 }}>
              {reimportAllDone}/{needsAttentionCount}
            </div>
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
              paddingBottom: "calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))",
              width: "100%", maxWidth: 430,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 19, color: "#202124", marginBottom: 4 }}>
              {selected.size} factuur{selected.size > 1 ? "en" : ""} bevestigen?
            </div>
            <div style={{ fontSize: 14, color: "#5f6368", marginBottom: 20 }}>
              De geselecteerde facturen worden geverifieerd en als Crediteur naar je boekhouder gestuurd. De bedragen worden overgenomen zoals uitgelezen.
            </div>
            <button
              onClick={handleVerifyBatch}
              style={{
                width: "100%", padding: "16px", borderRadius: 14,
                background: "#34a853", color: "#fff", border: "none",
                fontWeight: 700, fontSize: 16, cursor: "pointer", marginBottom: 8,
              }}
            >
              Ja, bevestig {selected.size}
            </button>
            <button
              onClick={() => setBulkConfirmOpen(false)}
              style={{
                width: "100%", padding: "14px", borderRadius: 14,
                background: "#f8f9fa", color: "#202124", border: "none",
                fontWeight: 600, fontSize: 15, cursor: "pointer",
              }}
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      {/* [AFZENDERREGEL] Het aanbod, ná het negeren. Bewust een apart schermpje en geen vinkje in
          de negeer-dialoog: een blijvende regel die post tegenhoudt verdient een eigen ja, niet
          een vakje dat je per ongeluk meeneemt terwijl je iets anders aan het doen was. */}
      {ruleOfferFor && (
        <ConfirmDialog
          title="Altijd overslaan?"
          message={`Je negeerde dit als “geen factuur”. Wil je bijlagen van ${ruleOfferFor.client_email} voortaan overslaan? De e-mails blijven in je mailbox, en je kunt de regel bij Genegeerd weer opheffen.`}
          confirmLabel="Ja, altijd overslaan"
          confirmColor="#1a73e8"
          onConfirm={() => addSenderRule(ruleOfferFor)}
          onCancel={() => setRuleOfferFor(null)}
        />
      )}

      {/* Ignore confirmation */}
      {ignoreFor && (
        <ConfirmDialog
          title="Factuur negeren?"
          message="De factuur wordt verplaatst naar Genegeerd. Je kunt hem later terugzetten."
          confirmLabel="Ja, negeer"
          confirmColor="#ea4335"
          choices={ARCHIVE_REASONS.map((v) => ({
            value: v,
            label: ARCHIVE_REASON_LABELS[v].label,
            hint: ARCHIVE_REASON_LABELS[v].hint,
          }))}
          choiceValue={ignoreReason}
          onChoice={(v) => setIgnoreReason(v as ArchiveReason | null)}
          onConfirm={() => handleIgnore(ignoreFor, ignoreReason)}
          onCancel={() => { setIgnoreFor(null); setIgnoreReason(null); }}
        />
      )}

      {/* Toast */}
    </div>
  );
}