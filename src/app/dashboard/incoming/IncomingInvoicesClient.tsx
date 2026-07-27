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
//
// ─────────────────────────────────────────────────────────────────────────────
// [INCOMING-TIDY] Layout regroup (presentation only) — juli 2026
// ─────────────────────────────────────────────────────────────────────────────
// WHY: the page had grown into one long, flat column — a status line, a re-read
// button, a manage link, a big e-mail card with four stacked text links, tabs, a
// select toolbar, a search field, the invoice list, and finally (below dozens of
// cards) the upload block. Everything was full-width and equally loud, so nothing
// read as a group and "een factuur toevoegen" was unreachable without scrolling
// past the whole queue.
//
// The same four-section grammar as the ZZP home (ZzpDashboard, [DASH-SIMPLIFY]):
//   1. Status        — one card answering "waar sta ik?" (+ the re-read action
//                      and the link to the confirmed inkoopfacturen)
//   2. Toevoegen     — camera / bestanden / meerdere pagina's, in one card, at
//                      the TOP (as on the home) instead of below the list
//   3. Automatisch   — the e-mail connection, compact: one sync button, with the
//      inlezen         secondary controls (backfill, overgeslagen, ontkoppel)
//                      behind one "Meer opties" expander — nothing removed
//   4. Facturen      — tabs, select toolbar, search and the cards
//
// Nothing about the data, the routes or the verify/ignore/restore logic changed;
// every control that existed before still exists and does exactly the same thing.
// Shared visual language: #F8F9FA page, white cards with EL1, R radii, Roboto,
// Material Symbols (all names below are in layout.tsx's icon subset).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import Link from "next/link";
// [BOEK-011] Centralized navigation — single source of truth across the app
import { FONT } from "@/lib/design/tokens";
import { triggerBankAutoConfirm } from "@/lib/bank-auto-confirm-trigger";
import { combineImagesToPdf } from "@/lib/combine-images-pdf";
import { rowMatchesQuery } from "@/lib/search";
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
  };
}

// [OBSERVABILITY] Map a stored skip reason to a short, owner-facing line. Known codes get a
// friendly phrase; a Dutch reason the AI already wrote (e.g. "rekeningoverzicht — …") is shown
// as-is (trimmed). Never a raw technical token the owner can't understand.
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

// ── [INCOMING-TIDY] Design tokens ─────────────────────────────────────────────
// Same values the ZZP home and Inkoopfacturen use, so the three purchase surfaces
// read as one system. Kept local (like every other dashboard client) — only FONT
// comes from the shared token file.
const R = { sm: 8, md: 12, lg: 16, xl: 20, full: 9999 };
const EL1 = "0 1px 2px rgba(0,0,0,0.08)";
const C = {
  primary: "#1A73E8",
  primaryContainer: "#E8F0FE",
  onPrimaryContainer: "#174EA6",
  bg: "#F8F9FA",
  surface: "#FFFFFF",
  onSurface: "#202124",
  muted: "#5F6368",
  faint: "#8A929C",
  line: "#E8EAED",
  success: "#137333",
  successContainer: "#E6F4EA",
  warn: "#B06000",
  warnStrong: "#9A5B00",
  warnContainer: "#FEF7E0",
  warnLine: "#FDE293",
  error: "#B3261E",
  errorContainer: "#FCE8E6",
  errorLine: "#F5B5AE",
} as const;

// [INCOMING-TIDY] Material Symbols helper. Every name used on this page is in the
// icon subset loaded in app/layout.tsx — an unlisted name renders as raw text, so
// check that list before introducing a new one.
function Icon({
  name,
  size = 20,
  color,
  spin,
}: {
  name: string;
  size?: number;
  color?: string;
  spin?: boolean;
}) {
  return (
    <span
      className="material-symbols-outlined"
      aria-hidden="true"
      style={{
        fontSize: size,
        color,
        lineHeight: 1,
        flexShrink: 0,
        animation: spin ? "bbSpin 1s linear infinite" : undefined,
      }}
    >
      {name}
    </span>
  );
}

// [INCOMING-TIDY] The small uppercase header that turns a flat column into
// scannable groups — same component (and role) as SectionLabel on the ZZP home.
function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        gap: 10, margin: "0 2px 10px",
      }}
    >
      <span
        style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.6,
          textTransform: "uppercase", color: C.faint,
        }}
      >
        {children}
      </span>
      {right}
    </div>
  );
}

// [INCOMING-TIDY] The one card shape of this page: white, one elevation, one radius.
function Card({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: C.surface, borderRadius: R.lg, boxShadow: EL1,
        padding: 16, ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Email connect card ────────────────────────────────────────────────────────

function ConnectEmailCard({ status }: { status: ConnectionStatus }) {
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
  // [INCOMING-TIDY] One expander for the three secondary controls (backfill,
  // overgeslagen, ontkoppel). They used to sit as four loose text links under the
  // card and dominated it; nothing is removed, they are one tap away.
  const [moreOpen, setMoreOpen] = useState(false);

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
    // [AUTO-ADVANCE-HONESTY] Of everything imported, how many the app verified and
    // booked itself. Those land on Inkoopfacturen, NOT in the queue below — so the
    // summary must say so, or "12 geïmporteerd" followed by a queue showing 3 reads
    // as if nine invoices went missing.
    let totalAutoBooked = 0;
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
        totalAutoBooked += data.autoAdvanced ?? 0;
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
        // [AUTO-ADVANCE-HONESTY] Say where the imported invoices actually went. The
        // page reloads right after this line, so without it the owner reads
        // "12 geïmporteerd" and then counts 3 cards — the nine the app verified and
        // booked itself look lost. They are on Inkoopfacturen, and nothing was paid.
        if (totalAutoBooked > 0) {
          message +=
            totalAutoBooked === 1
              ? " 1 daarvan was zeker genoeg en is automatisch geboekt — die staat bij Inkoopfacturen."
              : ` ${totalAutoBooked} daarvan waren zeker genoeg en zijn automatisch geboekt — die staan bij Inkoopfacturen.`;
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
      <Card style={{ padding: 14 }}>
        {/* Identity row — provider, live/dead dot, mailbox */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: R.md, flexShrink: 0,
              background: needsReauth ? C.errorContainer : C.primaryContainer,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Icon
              name="mark_email_unread"
              size={22}
              color={needsReauth ? C.error : C.primary}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: C.onSurface }}>
                {needsReauth ? `${providerName} — verbinding verlopen` : `${providerName} verbonden`}
              </span>
              <span
                style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: needsReauth ? "#EA4335" : "#34A853", display: "inline-block",
                }}
              />
            </div>
            <div style={{ fontSize: 13, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {status.email}
            </div>
          </div>
        </div>

        {needsReauth && (
          <div style={{ background: C.errorContainer, border: `1px solid ${C.errorLine}`, borderRadius: R.md, padding: "12px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.error, marginBottom: 6 }}>
              Automatisch inlezen is gestopt
            </div>
            <div style={{ fontSize: 13, color: "#8C1D18", marginBottom: 10, lineHeight: 1.45 }}>
              Je {providerName}-koppeling is verlopen. Er komen geen nieuwe facturen meer binnen totdat je opnieuw verbindt.
            </div>
            <a
              href={`/api/email/connect?provider=${status.provider}`}
              style={{ display: "inline-block", background: C.error, color: "#fff", borderRadius: R.sm, padding: "9px 16px", fontWeight: 600, fontSize: 14, textDecoration: "none" }}
            >
              Verbind {providerName} opnieuw
            </a>
          </div>
        )}

        {/* [INCOMING-TIDY] The one action that matters here, full width. The rest
            (backfill / overgeslagen / ontkoppel) moved behind "Meer opties". */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => handleSync()}
            disabled={syncing}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              background: syncing ? "#F1F3F4" : C.primary,
              color: syncing ? C.muted : "#fff",
              border: "none", borderRadius: R.md, padding: "11px 0",
              fontWeight: 600, fontSize: 14, fontFamily: "inherit",
              cursor: syncing ? "not-allowed" : "pointer",
            }}
          >
            <Icon name="refresh" size={18} spin={syncing} />
            {syncing ? "Bezig…" : "Synchroniseer nu"}
          </button>
          <button
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-label="Meer opties voor je e-mailkoppeling"
            style={{
              display: "flex", alignItems: "center", gap: 4,
              background: "#F1F3F4", border: "none", borderRadius: R.md,
              padding: "11px 14px", color: "#3C4043",
              fontWeight: 600, fontSize: 13.5, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            Meer
            <Icon name={moreOpen ? "expand_less" : "expand_more"} size={18} color="#3C4043" />
          </button>
        </div>

        {syncResult && (
          <div
            style={{
              marginTop: 10, fontSize: 13, lineHeight: 1.45,
              padding: "10px 12px", borderRadius: R.sm,
              background: syncResult.startsWith("Fout") ? C.errorContainer : C.successContainer,
              color: syncResult.startsWith("Fout") ? C.error : C.success,
            }}
          >
            {syncResult}
          </div>
        )}

        {/* [INCOMING-TIDY] Secondary controls — same functionality as the old loose
            links, collected in one place so the card has a single voice. */}
        {moreOpen && (
          <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {/* [BACKFILL] Re-scan an earlier period. The daily sync only looks forward, so an
                invoice that was missed at the time (and is now fixable) needs a one-off re-pull.
                Nothing is duplicated — the re-scan imports only what's still missing. */}
            {!backfillOpen ? (
              <button
                onClick={() => setBackfillOpen(true)}
                disabled={syncing}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  background: "transparent", border: "none", padding: "2px 0",
                  color: syncing ? "#DADCE0" : C.onSurface, textAlign: "left",
                  fontSize: 13.5, fontWeight: 500, fontFamily: "inherit",
                  cursor: syncing ? "default" : "pointer",
                }}
              >
                <Icon name="schedule" size={19} color={syncing ? "#DADCE0" : C.muted} />
                <span style={{ flex: 1 }}>Mis je een factuur? Oudere e-mails ophalen</span>
                <Icon name="chevron_right" size={18} color={C.faint} />
              </button>
            ) : (
              <div style={{ background: C.bg, borderRadius: R.md, padding: 12 }}>
                <div style={{ fontSize: 12.5, color: "#3C4043", lineHeight: 1.5, marginBottom: 8 }}>
                  Ik scan je e-mail opnieuw vanaf deze datum en importeer wat er nog mist. Al
                  geïmporteerde facturen blijven zoals ze zijn — niets wordt dubbel.
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="date"
                    value={backfillDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setBackfillDate(e.target.value)}
                    disabled={syncing}
                    style={{
                      border: "1px solid #DADCE0", borderRadius: R.sm, padding: "8px 10px",
                      fontSize: 14, fontFamily: "inherit", background: "#fff", color: C.onSurface,
                    }}
                  />
                  <button
                    onClick={() => handleSync(backfillDate)}
                    disabled={syncing || !backfillDate}
                    style={{
                      background: syncing ? "#E0E0E0" : C.primary,
                      color: syncing ? C.muted : "#fff",
                      border: "none", borderRadius: R.sm, padding: "8px 16px",
                      fontWeight: 600, fontSize: 14, fontFamily: "inherit",
                      cursor: syncing || !backfillDate ? "not-allowed" : "pointer",
                    }}
                  >
                    {syncing ? "Bezig…" : "Opnieuw ophalen"}
                  </button>
                  <button
                    onClick={() => setBackfillOpen(false)}
                    disabled={syncing}
                    style={{
                      background: "transparent", border: "none", color: C.muted,
                      fontSize: 13, fontFamily: "inherit",
                      cursor: syncing ? "default" : "pointer", padding: "8px 4px",
                    }}
                  >
                    Annuleer
                  </button>
                </div>
              </div>
            )}

            {/* [OBSERVABILITY] What did import NOT turn into an invoice, and why. Read-only
                transparency so a misjudged or unreadable document is never invisibly lost. */}
            {!skippedOpen ? (
              <button
                onClick={openSkipped}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  background: "transparent", border: "none", padding: "2px 0",
                  color: C.onSurface, textAlign: "left",
                  fontSize: 13.5, fontWeight: 500, fontFamily: "inherit", cursor: "pointer",
                }}
              >
                <Icon name="rule" size={19} color={C.muted} />
                <span style={{ flex: 1 }}>Bekijk wat is overgeslagen bij het importeren</span>
                <Icon name="chevron_right" size={18} color={C.faint} />
              </button>
            ) : (
              <div style={{ background: C.bg, borderRadius: R.md, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.onSurface }}>Overgeslagen bij import</span>
                  <button
                    onClick={() => setSkippedOpen(false)}
                    style={{ background: "transparent", border: "none", color: C.muted, fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}
                  >
                    Sluit
                  </button>
                </div>
                {skippedLoading ? (
                  <div style={{ fontSize: 13, color: C.muted }}>Laden…</div>
                ) : (
                  <>
                    {couldNotReadCount > 0 && (
                      <div style={{ fontSize: 12.5, color: C.warnStrong, background: C.warnContainer, borderRadius: R.sm, padding: "8px 10px", marginBottom: 8, lineHeight: 1.5 }}>
                        {couldNotReadCount} {couldNotReadCount === 1 ? "bestand konden" : "bestanden konden"} we niet lezen — {couldNotReadCount === 1 ? "het staat" : "ze staan"} in je bestanden, controleer {couldNotReadCount === 1 ? "het" : "ze"} even.
                      </div>
                    )}
                    {(skippedItems?.length ?? 0) === 0 && couldNotReadCount === 0 ? (
                      <div style={{ fontSize: 12.5, color: C.muted }}>
                        Niets overgeslagen — alles wat binnenkwam is verwerkt.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {(skippedItems ?? []).map((s, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                            <span style={{ color: C.onSurface, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                              {s.filename}
                            </span>
                            <span style={{ color: C.muted, flexShrink: 0, maxWidth: "55%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {friendlySkipReason(s.reason)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
                      Mis je hier een echte factuur? Gebruik &ldquo;Oudere e-mails ophalen&rdquo; hierboven, of voeg hem toe met een foto.
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              onClick={handleDisconnect}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                background: "transparent", border: "none", padding: "2px 0",
                color: "#C5221F", textAlign: "left",
                fontSize: 13.5, fontWeight: 500, fontFamily: "inherit", cursor: "pointer",
              }}
            >
              <Icon name="link_off" size={19} color="#C5221F" />
              <span style={{ flex: 1 }}>Ontkoppel {providerName}</span>
            </button>
          </div>
        )}
      </Card>
    );
  }

  // Not connected
  return (
    <Card style={{ padding: "22px 18px", textAlign: "center" }}>
      <div
        style={{
          width: 52, height: 52, borderRadius: R.lg, margin: "0 auto 12px",
          background: C.primaryContainer, display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <Icon name="mark_email_unread" size={28} color={C.primary} />
      </div>
      <div style={{ fontWeight: 700, fontSize: 17, color: C.onSurface, marginBottom: 6 }}>
        Verbind je e-mail
      </div>
      <div
        style={{
          fontSize: 14, color: C.muted, lineHeight: 1.5,
          maxWidth: 280, margin: "0 auto 18px",
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
              gap: 10, background: provider === "gmail" ? C.primary : "#fff",
              border: provider === "gmail" ? "1.5px solid transparent" : `1.5px solid ${C.line}`,
              borderRadius: R.md, padding: "13px 20px", textDecoration: "none",
              color: provider === "gmail" ? "#fff" : C.onSurface, fontWeight: 600, fontSize: 15,
            }}
          >
            <Icon
              name="mark_email_unread"
              size={20}
              color={provider === "gmail" ? "#fff" : C.primary}
            />
            Verbind {provider === "gmail" ? "Gmail" : "Outlook"}
          </a>
        ))}
      </div>
    </Card>
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
          paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
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
                    display: "flex", alignItems: "flex-start", gap: 9,
                    padding: "12px 14px", marginBottom: 16,
                    background: C.warnContainer, borderRadius: R.md,
                    border: `1px solid ${C.warnLine}`,
                  }}
                >
                  <Icon name="warning" size={17} color={C.warn} />
                  <span style={{ fontSize: 12.5, color: C.warnStrong, lineHeight: 1.5 }}>
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
                <div style={{ fontSize: 12, color: C.warn, lineHeight: 1.4, marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 6 }}>
                  <Icon name="warning" size={15} color={C.warn} />
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
                  display: "flex", alignItems: "flex-start", gap: 9,
                  padding: "10px 12px", marginBottom: 14,
                  background: C.warnContainer, borderRadius: R.sm,
                  border: `1px solid ${C.warnLine}`,
                }}>
                  <Icon name="info" size={16} color={C.warn} />
                  <span style={{ fontSize: 12.5, color: C.warnStrong, lineHeight: 1.4 }}>
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
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 14, color: vendorLow ? C.warn : "#5f6368", flexShrink: 0, fontWeight: vendorLow ? 600 : 400 }}>
                  Leverancier {vendorLow && <Icon name="warning" size={14} color={C.warn} />}
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
                <div style={{ fontSize: 12, color: C.warn, lineHeight: 1.4, marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 6 }}>
                  <Icon name="warning" size={15} color={C.warn} />
                  <span>&ldquo;{invoiceNumber}&rdquo; lijkt een paginanummer — controleer het factuurnummer.</span>
                </div>
              )}

              {/* Invoice date */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 14, color: (dateLow || dateMissing) ? C.warn : "#5f6368", flexShrink: 0, fontWeight: (dateLow || dateMissing) ? 600 : 400 }}>
                  Factuurdatum {(dateLow || dateMissing) && <Icon name="warning" size={14} color={C.warn} />}
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
                <div style={{ fontSize: 12.5, color: "#EA4335", textAlign: "right", marginTop: 6 }}>
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
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
                  padding: "9px 12px", borderRadius: R.sm, background: C.successContainer,
                  color: C.success, fontSize: 13, fontWeight: 600,
                }}>
                  <Icon name="receipt_long" size={17} color={C.success} />
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
              max={new Date().toISOString().slice(0, 10)}
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
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  padding: "16px", borderRadius: 14,
                  background: submitting ? "#dadce0" : "#34a853",
                  color: "#fff", border: "none", fontWeight: 700, fontSize: 16, fontFamily: "inherit",
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                <Icon name="account_balance" size={19} /> Bank
              </button>
              <button
                onClick={() => handlePay("kas")}
                disabled={submitting}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  padding: "16px", borderRadius: 14,
                  background: submitting ? "#dadce0" : "#34a853",
                  color: "#fff", border: "none", fontWeight: 700, fontSize: 16, fontFamily: "inherit",
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                <Icon name="payments" size={19} /> Contant
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
        <div style={{ fontWeight: 700, fontSize: 17, color: "#202124", marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 14, color: "#5f6368", marginBottom: 20, lineHeight: 1.5 }}>
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
  const [loadingPdf, setLoadingPdf] = useState(false);

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
        window.location.reload(); // pick up the refreshed amounts + health
        return;
      }
      if (data.notInvoice) {
        alert(
          "Bij het opnieuw inlezen bleek dit geen boekbare factuur te zijn" +
            (data.reason ? ` (${data.reason})` : "") +
            ". De gegevens zijn niet gewijzigd — je kunt hem negeren als hij niet klopt."
        );
      } else {
        alert(data.error || "Opnieuw inlezen is niet gelukt — probeer het later opnieuw.");
      }
    } catch {
      alert("Opnieuw inlezen is niet gelukt — probeer het later opnieuw.");
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
        background: C.surface, borderRadius: R.lg, marginBottom: 10,
        overflow: "hidden",
        // [INTAKE-FOCUS] brief ring when deep-linked from the upload results
        // modal; scrollMarginTop keeps the card clear of the sticky header.
        boxShadow: highlighted
          ? `${EL1}, 0 0 0 3px rgba(26,115,232,0.35)`
          : EL1,
        transition: "box-shadow 0.5s ease",
        scrollMarginTop: 96,
      }}
    >
      {/* Header — always visible, tappable */}
      <button
        onClick={selectMode ? onSelect : onToggle}
        style={{
          width: "100%", padding: "14px 14px", border: "none",
          background: "transparent", cursor: "pointer", textAlign: "left",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 10, fontFamily: "inherit",
        }}
      >
        {/* [INTAKE-VERIFY-BULK] selection checkbox — only in pending select mode */}
        {selectMode && (
          <span
            style={{
              flexShrink: 0, width: 22, height: 22, borderRadius: 11,
              border: `2px solid ${selected ? "#34A853" : "#DADCE0"}`,
              background: selected ? "#34A853" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {selected && <Icon name="check" size={14} color="#fff" />}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700, fontSize: 15.5, color: C.onSurface, marginBottom: 2,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {invoice.client_name || "Onbekende afzender"}
          </div>
          <div style={{ fontSize: 12.5, color: C.muted }}>
            {formatDate(invoice.invoice_date)}
          </div>

          {/* [INCOMING-TIDY] Badges share one wrapping row, so a creditnota that
              also needs attention can never push the layout apart on a phone. */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 }}>
            {/* [BRIDGE-CREDITNOTA-SIGN] Creditnota badge — a credit note is a
                DIFFERENT financial animal (negative amounts by design), so the
                owner must see it at a glance. Independent of the health badge:
                a clean creditnota shows Creditnota + "ready", a broken one shows
                Creditnota + "Aandacht nodig". */}
            {invoice.invoice_type === "creditnota" && (
              <span
                style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "2px 8px", borderRadius: R.sm,
                  background: C.errorContainer, border: `1px solid ${C.errorLine}`,
                  fontSize: 11.5, color: C.error, fontWeight: 600,
                }}
              >
                Creditnota
              </span>
            )}
            {/* [IMPORT-MONITOR] Health badge — only in the pending queue. Flagged
                invoices get a calm-but-clear attention pill; clean invoices get a
                quiet "ready to confirm" hint (calm, never the alarming "review").
                The ignored tab shows nothing here — it must not nag. */}
            {mode === "pending" && (
              invoice.health.level === "needs-review" ? (
                <span
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "2px 8px", borderRadius: R.sm,
                    background: C.warnContainer, border: `1px solid ${C.warnLine}`,
                    fontSize: 11.5, color: C.warn, fontWeight: 600,
                  }}
                >
                  <Icon name="warning" size={13} color={C.warn} />
                  Aandacht nodig
                </span>
              ) : (
                <span
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    fontSize: 11.5, color: C.muted,
                  }}
                >
                  <Icon name="check_circle" size={13} color="#34A853" />
                  Klaar om te bevestigen
                </span>
              )
            )}
          </div>
        </div>

        {/* [INCOMING-TIDY] Right column stacks (amount above its badge) instead of
            sitting in one horizontal row — on a phone the deelbetaling badge used to
            squeeze the amount and the supplier name against each other. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
            <span style={{ fontWeight: 700, fontSize: 16.5, color: C.onSurface, whiteSpace: "nowrap" }}>
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
                    fontSize: 10.5, fontWeight: 600, color: C.warn, background: C.warnContainer,
                    border: `1px solid ${C.warnLine}`, borderRadius: 6, padding: "1px 6px", whiteSpace: "nowrap",
                  }}
                >
                  Deels betaald · € {remaining.toFixed(2)} open
                </span>
              );
            })()}
          </div>
          <span
            style={{
              display: "flex",
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 0.2s",
            }}
          >
            <Icon name="chevron_right" size={20} color="#C9CDD2" />
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: "0 14px 14px" }}>
          <div style={{ height: 1, background: C.line, marginBottom: 12 }} />

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
                  display: "flex", alignItems: "flex-start", gap: 9,
                  padding: "12px 14px", marginBottom: 12,
                  background: C.warnContainer, borderRadius: R.md,
                  border: `1px solid ${C.warnLine}`,
                }}
              >
                <Icon name="info" size={18} color={C.warn} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.warn, marginBottom: 3 }}>
                    Even controleren
                  </div>
                  <div style={{ fontSize: 12.5, color: C.warnStrong, lineHeight: 1.5 }}>
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
                      marginTop: 10, padding: "7px 12px", borderRadius: R.sm,
                      background: reimporting ? "#F5E6C8" : "#fff", cursor: reimporting ? "default" : "pointer",
                      border: `1px solid ${C.warnLine}`, color: C.warn, fontWeight: 600, fontSize: 12.5,
                      fontFamily: "inherit",
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}
                  >
                    <Icon name="refresh" size={15} color={C.warn} spin={reimporting} />
                    {reimporting ? "Bezig met opnieuw inlezen…" : "Opnieuw inlezen"}
                  </button>
                </div>
              </div>
            )}

          {/* Detail rows */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 12 }}>
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
                width: "100%", padding: "11px", borderRadius: R.md,
                background: C.primaryContainer, border: "none",
                color: C.primary, fontWeight: 600, fontSize: 14, fontFamily: "inherit",
                cursor: loadingPdf ? "wait" : "pointer", marginBottom: 8,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <Icon name="picture_as_pdf" size={18} />
              {loadingPdf ? "Openen…" : "Bekijk factuur"}
            </button>
          )}

          {/* [BOEK-011] Folder location — link to Mijn Bestanden */}
          {invoice.folder_id && (
            <a
              href={`/dashboard/bestanden?folder=${invoice.folder_id}`}
              style={{
                display: "flex", alignItems: "center", gap: 9,
                padding: "10px 12px", borderRadius: R.md, marginBottom: 8,
                background: C.bg, textDecoration: "none",
              }}
            >
              <Icon name="folder" size={18} color={C.muted} />
              <span style={{ flex: 1, fontSize: 12.5, color: C.muted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                Opgeslagen in{" "}
                <span style={{ color: C.onSurface, fontWeight: 600 }}>
                  {invoice.folder_name || "Mijn Bestanden"}
                </span>
              </span>
              <Icon name="chevron_right" size={17} color={C.faint} />
            </a>
          )}

          {/* Actions — depend on mode */}
          {mode === "confirmed" ? (
            /* [INCOMING-BEVESTIGD] Already out of the queue — read-only status, no verify action.
               'paid' = settled (green); 'received' = verified but still te betalen (blue). Full
               management (mark paid, edit, accountant handoff) lives on Crediteuren. */
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px",
                borderRadius: R.full, fontSize: 12.5, fontWeight: 700,
                background: invoice.status === "paid" ? C.successContainer : C.primaryContainer,
                color: invoice.status === "paid" ? C.success : C.onPrimaryContainer,
              }}>
                <Icon
                  name={invoice.status === "paid" ? "check_circle" : "schedule"}
                  size={15}
                  color={invoice.status === "paid" ? C.success : C.onPrimaryContainer}
                />
                {invoice.status === "paid" ? "Betaald" : "Bevestigd · te betalen"}
              </span>
              <a
                href="/dashboard/incoming/manage"
                style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 3, fontSize: 13, fontWeight: 600, color: C.primary, textDecoration: "none" }}
              >
                Beheren
                <Icon name="chevron_right" size={16} />
              </a>
            </div>
          ) : mode === "pending" ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={onIgnore}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: R.md,
                  background: C.bg, border: "none", color: C.muted,
                  fontWeight: 600, fontSize: 13.5, fontFamily: "inherit", cursor: "pointer",
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
                  flex: 1, padding: "12px 0", borderRadius: R.md,
                  background: C.primaryContainer, border: "none", color: C.primary,
                  fontWeight: 600, fontSize: 13.5, fontFamily: "inherit", cursor: "pointer",
                }}
              >
                Bewerken
              </button>
              <button
                onClick={onConfirmPaid}
                style={{
                  flex: 2, padding: "12px 0", borderRadius: R.md,
                  background: "#34A853", border: "none", color: "#fff",
                  fontWeight: 700, fontSize: 13.5, fontFamily: "inherit", cursor: "pointer",
                }}
              >
                Verifiëren
              </button>
            </div>
          ) : (
            <button
              onClick={onRestore}
              style={{
                width: "100%", padding: "12px 0", borderRadius: R.md,
                background: C.primaryContainer, border: "none",
                color: C.primary, fontWeight: 600, fontSize: 13.5, fontFamily: "inherit", cursor: "pointer",
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
      <span style={{ fontSize: 12.5, color: C.muted }}>{label}</span>
      <span
        style={{
          fontSize: 12.5, color: C.onSurface,
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
// [INTAKE-AUTO-FEEDBACK] 'auto' is its own outcome, split off from 'invoice'.
// /api/intake auto-advances a clean, confident invoice straight to 'received'
// ([AUTO-ADVANCE]) — it is BOOKED and lives on Inkoopfacturen, NOT in this verify
// queue. The modal used to report it as a plain "invoice" and offer "Naar controle
// →" to /dashboard/incoming?focus=…, where the card is not: the owner was sent
// looking for an invoice the app had already handled. Now the two are separate
// outcomes with separate destinations. 'receipt' likewise (a bon always waits for
// a human pay-confirm), 'turnover'/'ledger' are the booked sheet paths.
type IntakeStatus =
  | "auto"      // invoice read, verified AND booked automatically → Inkoopfacturen
  | "invoice"   // invoice read → waits for one confirming tap in this queue
  | "receipt"   // bon read → waits here too (probably already paid)
  | "document"  // no invoice/bon recognised → kept in Mijn bestanden
  | "bank"      // bank statement → transactions imported
  | "turnover"  // kassa/dagomzet sheet → booked in Dagomzet
  | "ledger"    // grootboek sheet → reconciliation witness
  | "duplicate" // already added earlier
  | "error";

type IntakeResult = {
  name: string;
  status: IntakeStatus;
  message: string;
  // present for document / duplicate → deep-link + focus in Mijn bestanden
  link?: { folderId: string | null; focusId: string };
  // [INTAKE-FOCUS] present for invoice/receipt → "Naar controle →" deep-links to
  // this card in the verify queue (?focus=). The API always returned invoice_id;
  // the modal just never used it — the owner was told "controleer en bevestig"
  // without a path to the invoice.
  // [INTAKE-AUTO-FEEDBACK] on an 'auto' row the same id deep-links to the BOOKED
  // invoice on /dashboard/incoming/manage instead.
  invoiceId?: string;
  // [INTAKE-AUTO-FEEDBACK] What the app read, echoed by the API (vendor /
  // invoice_number / total_inc_btw). Shown on the row so the owner recognises the
  // invoice without opening anything — the whole point of an automatic booking is
  // that you can still check it at a glance.
  vendor?: string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  // Where the file itself was filed in Mijn bestanden ("2026 / Q3 / juli / Facturen").
  folderName?: string | null;
  // [DEDUP-SOFT] Soft heads-up: looks like an invoice that is already in the books.
  possibleDuplicate?: string | null;
  // [TRUST-INTAKE] The file was stored but could NOT be read — never dressed up as
  // a confident "geen factuur herkend".
  couldNotRead?: boolean;
};

// Per-outcome presentation: icon (Material Symbols subset), accent colour and the
// short label that says WHAT happened before the server's own sentence.
const RESULT_META: Record<
  IntakeStatus,
  { icon: string; color: string; bg: string; label: string }
> = {
  auto:      { icon: "task_alt",      color: C.success, bg: C.successContainer,  label: "Automatisch verwerkt" },
  invoice:   { icon: "receipt_long",  color: C.primary, bg: C.primaryContainer,  label: "Wacht op je controle" },
  receipt:   { icon: "receipt_long",  color: C.primary, bg: C.primaryContainer,  label: "Bon — wacht op je controle" },
  document:  { icon: "folder",        color: C.muted,   bg: "#F1F3F4",           label: "In je bestanden" },
  bank:      { icon: "account_balance", color: C.primary, bg: C.primaryContainer, label: "Bankafschrift" },
  turnover:  { icon: "point_of_sale", color: C.success, bg: C.successContainer,  label: "Omzet geboekt" },
  ledger:    { icon: "link",          color: "#7B1FA2", bg: "#F3E5F5",           label: "Controle-check" },
  duplicate: { icon: "info",          color: C.muted,   bg: "#F1F3F4",           label: "Al toegevoegd" },
  error:     { icon: "error",         color: C.error,   bg: C.errorContainer,    label: "Niet gelukt" },
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
        const d = data as {
          destination?: string;
          message?: string;
          document_id?: string;
          folder_id?: string | null;
          folder_name?: string | null;
          could_not_read?: boolean;
          invoice_id?: string;
          auto_verified?: boolean;
          vendor?: string | null;
          invoice_number?: string | null;
          total_inc_btw?: number | null;
          possibleDuplicate?: { invoice_number?: string | null; client_name?: string | null; reason?: string };
        };
        const dest = d.destination;
        const message = d.message || "Toegevoegd";
        if (dest === "document") {
          const docId = d.document_id;
          return {
            name: file.name, status: "document", message,
            couldNotRead: d.could_not_read === true,
            folderName: d.folder_name ?? null,
            link: docId ? { folderId: d.folder_id ?? null, focusId: docId } : undefined,
          };
        }
        if (dest === "bank") return { name: file.name, status: "bank", message };
        if (dest === "turnover") return { name: file.name, status: "turnover", message };
        if (dest === "ledger") return { name: file.name, status: "ledger", message };

        // invoice | receipt.
        // [INTAKE-AUTO-FEEDBACK] auto_verified === true → the app already verified
        // AND booked it (status 'received'); it is on Inkoopfacturen, not in this
        // queue. Anything else waits here for one confirming tap.
        // [INTAKE-FOCUS] keep invoice_id so the row can deep-link to the invoice.
        const dup = d.possibleDuplicate;
        return {
          name: file.name,
          status: d.auto_verified === true ? "auto" : dest === "receipt" ? "receipt" : "invoice",
          message,
          invoiceId: d.invoice_id,
          vendor: d.vendor ?? null,
          invoiceNumber: d.invoice_number ?? null,
          amount: typeof d.total_inc_btw === "number" ? d.total_inc_btw : null,
          folderName: d.folder_name ?? null,
          possibleDuplicate: dup
            ? `Mogelijk dubbel${dup.invoice_number ? ` met ${dup.invoice_number}` : ""}${dup.client_name ? ` (${dup.client_name})` : ""} — controleer voor je bevestigt.`
            : null,
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
      alert("Kies foto's of afbeeldingen — de pagina's van de factuur.");
      return;
    }
    setMpPages((prev) => {
      const merged = [...prev, ...imgs];
      if (merged.length > MAX_PAGES) {
        alert(`Maximaal ${MAX_PAGES} pagina's per factuur.`);
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
        alert(result.message || "Uploaden mislukt — probeer het opnieuw.");
        return;
      }
      setMpOpen(false);
      setMpPages([]);
      onUploaded();
      setResults([result]);
      setShowResults(true);
    } catch (e) {
      // A combine failure names the failing page — keep the pages so the owner redoes only that one.
      alert(e instanceof Error && /Pagina/.test(e.message)
        ? `${e.message} De andere pagina's blijven bewaard.`
        : "Combineren mislukt. Maak duidelijkere foto's, of voeg de pagina's los toe.");
    } finally {
      setCombining(false);
    }
  };

  // [INTAKE-FEEDBACK] Close the modal AND refresh so new invoices show in the queue.
  const closeResults = () => {
    setShowResults(false);
    window.location.reload();
  };

  const openInBestanden = (link: { folderId: string | null; focusId: string }) => {
    window.location.assign(`/dashboard/bestanden?folder=${link.folderId ?? ""}&focus=${link.focusId}`);
  };

  // [INTAKE-FOCUS] "Naar controle →" — same full-navigation pattern as
  // openInBestanden/closeResults (this page reloads anyway to refresh the
  // queue); ?focus= makes the main component expand + scroll + ring the card.
  const goToInvoice = (invoiceId: string) => {
    window.location.assign(`/dashboard/incoming?focus=${invoiceId}`);
  };

  // [INTAKE-AUTO-FEEDBACK] An auto-verified invoice is NOT in this queue — it is
  // booked on Inkoopfacturen, which takes the same ?focus= deep link (expand +
  // scroll + highlight the row). Without this the owner was pointed at a card
  // that isn't there.
  const goToBooked = (invoiceId: string) => {
    window.location.assign(`/dashboard/incoming/manage?focus=${invoiceId}`);
  };

  // [INTAKE-AUTO-FEEDBACK] Honest headline + one-line breakdown. "Toegevoegd" is
  // everything the app actually kept and did something with; the split beneath it
  // says WHAT it did — automatically booked, waiting for you, or filed.
  const autoCount = results.filter((r) => r.status === "auto").length;
  const queueCount = results.filter((r) => r.status === "invoice" || r.status === "receipt").length;
  const fileCount = results.filter(
    (r) => r.status === "document" || r.status === "bank" || r.status === "turnover" || r.status === "ledger"
  ).length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const duplicateCount = results.filter((r) => r.status === "duplicate").length;
  const addedCount = autoCount + queueCount + fileCount;

  const headline =
    addedCount === 0
      ? errorCount > 0
        ? "Er ging iets mis"
        : "Klaar"
      : autoCount === addedCount
        ? autoCount === 1
          ? "Factuur automatisch verwerkt"
          : `${autoCount} facturen automatisch verwerkt`
        : `${addedCount} bestand${addedCount > 1 ? "en" : ""} toegevoegd`;

  const summaryParts = [
    autoCount > 0 ? `${autoCount} automatisch geboekt` : null,
    queueCount > 0 ? `${queueCount} wacht${queueCount > 1 ? "en" : ""} op je controle` : null,
    fileCount > 0 ? `${fileCount} in je administratie` : null,
    duplicateCount > 0 ? `${duplicateCount} al aanwezig` : null,
    errorCount > 0 ? `${errorCount} niet gelukt` : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <Card style={{ padding: 14 }}>
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
            width: "100%", padding: "14px", borderRadius: R.md, marginBottom: 10,
            background: uploading ? "#F1F3F4" : C.primary,
            color: uploading ? C.muted : "#fff",
            border: "none", fontWeight: 600, fontSize: 15.5, fontFamily: "inherit",
            cursor: uploading ? "not-allowed" : "pointer",
          }}
        >
          <Icon name="photo_camera" size={21} />
          {uploading ? "Verwerken…" : "Foto maken"}
        </button>

        {/* File / drag-drop (PDF, image, bank statement) — [INTAKE-MULTI] multiple */}
        <label
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
            padding: "18px 14px", borderRadius: R.md,
            border: `1.5px dashed ${dragOver ? C.primary : "#DADCE0"}`,
            background: dragOver ? C.primaryContainer : C.bg,
            cursor: uploading ? "not-allowed" : "pointer",
            transition: "background 0.15s, border-color 0.15s",
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
          <Icon
            name={uploading ? "hourglass_empty" : "upload_file"}
            size={26}
            color={uploading ? C.muted : C.primary}
          />
          <span style={{ fontSize: 14, color: uploading ? C.muted : C.primary, fontWeight: 600 }}>
            {uploading
              ? (total > 1 ? `${current} van ${total} verwerkt…` : "Verwerken…")
              : "Kies bestanden of sleep hier naartoe"}
          </span>
          <span style={{ fontSize: 12, color: C.muted, textAlign: "center" }}>
            PDF, afbeelding of bankafschrift — meerdere tegelijk (max {MAX_BATCH})
          </span>

          {/* [INTAKE-MULTI] Batch progress bar */}
          {uploading && total > 1 && (
            <div style={{ width: "100%", height: 4, background: "#E0E0E0", borderRadius: R.full, overflow: "hidden", marginTop: 4 }}>
              <div style={{
                width: `${Math.round((current / total) * 100)}%`,
                height: "100%", background: C.primary, borderRadius: R.full,
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
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "11px 12px", borderRadius: R.md, marginTop: 10,
              background: "transparent", color: C.onSurface, border: `1px solid ${C.line}`,
              fontWeight: 500, fontSize: 13.5, fontFamily: "inherit", textAlign: "left",
              cursor: uploading ? "not-allowed" : "pointer",
            }}
          >
            <Icon name="picture_as_pdf" size={19} color={C.muted} />
            <span style={{ flex: 1 }}>Factuur met meerdere pagina&apos;s</span>
            <Icon name="chevron_right" size={18} color={C.faint} />
          </button>
        ) : (
          <div style={{ marginTop: 10, padding: 14, borderRadius: R.md, border: `1.5px solid ${C.primary}`, background: "#F5FAFF" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.onSurface, marginBottom: 4 }}>
              Eén factuur, meerdere pagina&apos;s
            </div>
            <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12, lineHeight: 1.4 }}>
              Fotografeer of kies elke pagina van dezelfde factuur. We voegen ze samen tot één
              factuur — geen losse facturen. (Voor verschillende facturen: voeg ze los toe.)
            </div>

            {/* Collected pages */}
            {mpPages.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {mpPages.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", borderRadius: R.sm, border: `1px solid ${C.line}` }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.primary, minWidth: 58 }}>Pagina {i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <button onClick={() => removeMpPage(i)} aria-label="Verwijder pagina"
                      disabled={combining}
                      style={{ border: "none", background: "transparent", padding: 0, display: "flex", cursor: combining ? "default" : "pointer" }}>
                      <Icon name="close" size={18} color="#9AA0A6" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add-page actions */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button onClick={() => !combining && mpCameraRef.current?.click()} disabled={combining}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: R.md, border: `1px solid ${C.line}`, background: "#fff", color: C.primary, fontWeight: 600, fontSize: 13, fontFamily: "inherit", cursor: combining ? "default" : "pointer" }}>
                <Icon name="add_a_photo" size={17} /> Fotograferen
              </button>
              <button onClick={() => !combining && mpFileRef.current?.click()} disabled={combining}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: R.md, border: `1px solid ${C.line}`, background: "#fff", color: C.primary, fontWeight: 600, fontSize: 13, fontFamily: "inherit", cursor: combining ? "default" : "pointer" }}>
                <Icon name="attach_file" size={17} /> Pagina&apos;s kiezen
              </button>
            </div>

            {/* Combine + cancel */}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={cancelMultiPage} disabled={combining}
                style={{ padding: "11px 16px", borderRadius: R.md, border: "none", background: "#F1F3F4", color: C.muted, fontWeight: 600, fontSize: 14, fontFamily: "inherit", cursor: combining ? "default" : "pointer" }}>
                Annuleer
              </button>
              <button onClick={combineAndUpload} disabled={combining || uploading || mpPages.length === 0}
                style={{ flex: 1, padding: "11px", borderRadius: R.md, border: "none", fontWeight: 700, fontSize: 14, fontFamily: "inherit",
                  background: combining || uploading || mpPages.length === 0 ? "#DADCE0" : C.primary, color: "#fff",
                  cursor: combining || uploading || mpPages.length === 0 ? "default" : "pointer" }}>
                {combining ? "Bezig…" : mpPages.length > 0 ? `Combineer ${mpPages.length} pagina${mpPages.length === 1 ? "" : "'s"} → één factuur` : "Voeg eerst pagina's toe"}
              </button>
            </div>
          </div>
        )}

        {/* [MULTI-PAGE] Honest note: one PDF must be one invoice — the app reads a PDF as a single
            invoice (all pages together). A PDF holding several DIFFERENT invoices can't be split. */}
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10, lineHeight: 1.45 }}>
          Let op: één PDF = één factuur (alle pagina&apos;s samen). Zitten er meerdere verschillende
          facturen in één PDF? Splits ze niet — voeg elke factuur los toe.
        </div>
      </Card>

      {/* [INTAKE-FEEDBACK] Results modal — where did each file go?
          [INTAKE-AUTO-FEEDBACK] …and, for an invoice the app could verify itself,
          that it is already BOOKED — with the path to it on Inkoopfacturen. */}
      {showResults && results.length > 0 && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000 }}
          onClick={closeResults}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: "20px 20px 0 0", padding: "22px 20px",
              paddingBottom: "calc(22px + env(safe-area-inset-bottom))",
              width: "100%", maxWidth: 460, maxHeight: "84vh", overflowY: "auto",
              fontFamily: FONT,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              {addedCount > 0 && (
                <Icon
                  name={autoCount === addedCount ? "task_alt" : "check_circle"}
                  size={24}
                  color={autoCount === addedCount ? C.success : C.primary}
                />
              )}
              <div style={{ fontWeight: 700, fontSize: 19, color: C.onSurface }}>{headline}</div>
            </div>
            <div style={{ fontSize: 13.5, color: C.muted, marginBottom: 16, lineHeight: 1.5 }}>
              {summaryParts.length > 0
                ? summaryParts.join(" · ")
                : `Dit is er met je ${results.length > 1 ? "bestanden" : "bestand"} gebeurd:`}
            </div>

            {/* [INTAKE-AUTO-FEEDBACK] The reassurance the automatic path owes the
                owner: what "automatisch verwerkt" MEANS (geboekt, niet betaald) and
                where it now lives — stated once, above the rows. */}
            {autoCount > 0 && (
              <div style={{
                display: "flex", gap: 10, alignItems: "flex-start",
                padding: "12px 14px", marginBottom: 14, borderRadius: R.md,
                background: C.successContainer, border: "1px solid #B7E1C4",
              }}>
                <Icon name="auto_awesome" size={19} color={C.success} />
                <div style={{ fontSize: 12.5, color: "#0B5A28", lineHeight: 1.5 }}>
                  {autoCount === 1 ? "Deze factuur is" : `Deze ${autoCount} facturen zijn`} gelezen,
                  gecontroleerd en meteen geboekt als inkoopfactuur — klaar voor je boekhouder.
                  Er is <strong>niets betaald</strong>: {autoCount === 1 ? "hij staat" : "ze staan"} bij
                  Inkoopfacturen onder &ldquo;Automatisch verwerkt&rdquo;, waar je{" "}
                  {autoCount === 1 ? "hem" : "ze"} kunt nakijken of alsnog aanpassen.
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
              {results.map((r, i) => {
                const meta = RESULT_META[r.status];
                // What the app read — shown as one compact line so the invoice is
                // recognisable without opening it.
                const facts = [
                  r.vendor || null,
                  typeof r.amount === "number" && r.amount !== 0 ? formatSignedAmount(r.amount) : null,
                  r.invoiceNumber ? `nr. ${r.invoiceNumber}` : null,
                ].filter(Boolean) as string[];
                return (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "12px", borderRadius: R.md, background: C.bg }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: R.sm, flexShrink: 0, background: meta.bg,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon name={meta.icon} size={18} color={meta.color} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 12.5, fontWeight: 700, color: meta.color, margin: "0 0 3px" }}>
                        {meta.label}
                      </p>
                      {facts.length > 0 && (
                        <p style={{ fontSize: 13.5, fontWeight: 600, color: C.onSurface, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {facts.join(" · ")}
                        </p>
                      )}
                      <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.45 }}>{r.message}</p>
                      {/* The file itself — same file name the owner picked, plus where it landed. */}
                      <p style={{ fontSize: 11.5, color: C.faint, margin: "4px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.name}
                        {r.folderName ? ` · opgeslagen in ${r.folderName}` : ""}
                      </p>
                      {/* [DEDUP-SOFT] Soft heads-up — never blocks. Only when the
                          server's own sentence doesn't already carry it, so the row
                          never says "mogelijk dubbel" twice. */}
                      {r.possibleDuplicate && !/dubbel/i.test(r.message) && (
                        <p style={{ fontSize: 12, color: C.warn, margin: "6px 0 0", lineHeight: 1.45 }}>
                          {r.possibleDuplicate}
                        </p>
                      )}
                      {/* Destination links — one per row, pointing at where it IS. */}
                      {r.link && (
                        <button
                          type="button"
                          onClick={() => openInBestanden(r.link!)}
                          style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, cursor: "pointer", color: C.primary, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit" }}
                        >
                          Bekijk in bestanden
                          <Icon name="chevron_right" size={15} />
                        </button>
                      )}
                      {/* [INTAKE-AUTO-FEEDBACK] Booked automatically → Inkoopfacturen. */}
                      {r.status === "auto" && r.invoiceId && (
                        <button
                          type="button"
                          onClick={() => goToBooked(r.invoiceId!)}
                          style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, cursor: "pointer", color: C.success, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit" }}
                        >
                          Bekijk bij Inkoopfacturen
                          <Icon name="chevron_right" size={15} />
                        </button>
                      )}
                      {/* [INTAKE-FOCUS] Invoice/receipt landed in THIS queue,
                          hidden behind this modal — give the owner the path to
                          it instead of just "controleer en bevestig". */}
                      {(r.status === "invoice" || r.status === "receipt") && r.invoiceId && (
                        <button
                          type="button"
                          onClick={() => goToInvoice(r.invoiceId!)}
                          style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, cursor: "pointer", color: C.primary, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit" }}
                        >
                          Naar controle
                          <Icon name="chevron_right" size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* [INTAKE-AUTO-FEEDBACK] With more than one automatic booking, one link
                to the whole set (the manage screen opens on its "Automatisch
                verwerkt" filter) instead of a link per row. */}
            {autoCount > 1 && (
              <a
                href="/dashboard/incoming/manage?filter=auto"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  width: "100%", padding: "13px", borderRadius: R.md, marginBottom: 8,
                  background: C.successContainer, color: C.success,
                  fontWeight: 600, fontSize: 14.5, textDecoration: "none", boxSizing: "border-box",
                }}
              >
                <Icon name="request_quote" size={19} />
                Bekijk de {autoCount} automatisch verwerkte facturen
              </a>
            )}

            <button
              onClick={closeResults}
              style={{
                width: "100%", padding: "15px", borderRadius: R.md,
                background: C.primary, color: "#fff", border: "none",
                fontWeight: 700, fontSize: 15.5, fontFamily: "inherit", cursor: "pointer",
              }}
            >
              Klaar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function IncomingInvoicesClient({
  initialInvoices,
  ignoredInvoices,
  confirmedInvoices,
  connectionStatus,
}: Props) {
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

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

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

  // ── Ignore — archive ──
  const handleIgnore = useCallback(async (invoice: IncomingInvoice) => {
    setPending((prev) => prev.filter((inv) => inv.id !== invoice.id));
    setIgnored((prev) => [invoice, ...prev]);
    setIgnoreFor(null);
    setExpandedId(null);

    // [UI-HONESTY] A fetch that resolves is NOT proof of success — a 4xx/5xx (not found, RLS reject)
    // resolves with res.ok=false. The old code showed "genegeerd" regardless, so a failed ignore
    // looked done. Check res.ok and, on failure, roll back to the queue and say so.
    const rollback = () => {
      setIgnored((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setPending((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
    };
    try {
      const res = await fetch(`/api/email/confirm/${invoice.id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Factuur genegeerd");
      } else {
        rollback();
        showToast("Negeren mislukt — factuur staat nog in de wachtrij");
      }
    } catch {
      rollback();
      showToast("Fout — factuur staat nog in de wachtrij");
    }
  }, []);

  // ── Restore ignored → pending ──
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
    if (
      targets.length > 1 &&
      !window.confirm(
        `${targets.length} facturen opnieuw inlezen? Dit leest elke gemarkeerde factuur opnieuw en kan even duren.`
      )
    ) {
      return;
    }
    setReimportAllRunning(true);
    setReimportAllDone(0);

    let reread = 0;
    let notInvoice = 0;
    let skipped = 0;
    let failed = 0;
    for (const inv of targets) {
      try {
        const res = await fetch(`/api/email/reimport/${inv.id}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) reread++;
        else if (data.notInvoice) notInvoice++;
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
      alert(
        "Opnieuw inlezen klaar:\n" +
          `• ${reread} opnieuw ingelezen\n` +
          (notInvoice ? `• ${notInvoice} bleek geen boekbare factuur — je kunt die negeren\n` : "") +
          (skipped ? `• ${skipped} overgeslagen (al bevestigd)\n` : "") +
          (failed ? `• ${failed} niet gelukt — probeer die later los opnieuw\n` : "")
      );
    }
    window.location.reload();
  }, [pending, reimportAllRunning]);

  const list = tab === "pending" ? pending : tab === "confirmed" ? confirmed : ignored;

  // [SEARCH] Live, in-place filter over the loaded list (supplier name / invoice number /
  // whole-euro amount). The page holds the full set (server caps at 100/50), so this is
  // complete — no navigation, no reload.
  // [SMART-FILTER] shared matcher — leverancier / factuurnummer / bedrag
  // (decimaal- én duizendtal-bewust, zie src/lib/search.ts)
  const rawQ = search.trim();
  const searchedList = rawQ
    ? list.filter((inv) =>
        rowMatchesQuery(rawQ, [inv.client_name, inv.invoice_number], [inv.total_inc_btw])
      )
    : list;

  // [INCOMING-TIDY] Health lens over the pending queue. With a mailbox backfill the
  // queue is dozens of cards deep, and the two states in it need opposite handling:
  // the flagged ones want one-by-one attention, the clean ones want one bulk tap. The
  // status card's two counters double as this filter (tap = only those, tap again =
  // all), so the number you read is the list you get. Pending tab only; purely a view.
  const [healthLens, setHealthLens] = useState<"all" | "attention" | "ready">("all");
  const filteredList =
    tab === "pending" && healthLens !== "all"
      ? searchedList.filter((inv) =>
          healthLens === "attention"
            ? inv.health.level === "needs-review"
            : inv.health.level !== "needs-review"
        )
      : searchedList;

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

  // [INCOMING-TIDY] Tabs carry their own counts; switching one always resets the
  // per-card expansion and the health lens (which only means anything on pending).
  const switchTab = (next: Tab) => {
    setTab(next);
    setExpandedId(null);
    setHealthLens("all");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        // [HEADER-SYSTEM] Was var(--font-sans) (could resolve to a non-Roboto
        // face); now the shared Roboto FONT token, matching the shared bar above.
        fontFamily: FONT,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* [HEADER-SYSTEM] The title "Inkomend" + back live in the shared sub-page
          bar (DashboardChrome/STATIC_TITLES); this page starts at its content.
          [INCOMING-TIDY] One column, four labelled sections, a bigger gap BETWEEN
          groups (20) than WITHIN one — the same grammar as the ZZP home. */}
      <main
        style={{
          maxWidth: 480, margin: "0 auto", padding: "16px 16px 110px",
          display: "flex", flexDirection: "column", gap: 20,
        }}
      >
        {/* ── 1. STATUS — "waar sta ik?" in één kaart ─────────────────────────── */}
        <section>
          <SectionLabel>Status</SectionLabel>
          <Card style={{ padding: 16 }}>
            {/* [IMPORT-MONITOR] Two-axis headline — calm about correctness, honest
                about flow. Never says "done" while items still wait to be sent. */}
            {pending.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: R.md, flexShrink: 0,
                  background: C.successContainer, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon name="task_alt" size={22} color={C.success} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.onSurface }}>Alles verwerkt</div>
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                    Er wacht niets op je controle.
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, color: C.onSurface, letterSpacing: -0.5 }}>
                    {pending.length}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.onSurface }}>
                    {pending.length === 1 ? "factuur wacht op jou" : "facturen wachten op jou"}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 14 }}>
                  {needsAttentionCount > 0
                    ? "Bevestig wat klaarstaat en kijk de gemarkeerde facturen even na."
                    : "Niets om te corrigeren — één tik en ze gaan naar je boekhouder."}
                </div>

                {/* [INCOMING-TIDY] The two counters that used to be one long sentence.
                    Each is also the filter for its own half of the queue, so the number
                    you read is the list you get. */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <StatCell
                    icon="warning"
                    tone={C.warn}
                    bg={C.warnContainer}
                    line={C.warnLine}
                    count={needsAttentionCount}
                    label="Aandacht nodig"
                    active={tab === "pending" && healthLens === "attention"}
                    disabled={needsAttentionCount === 0}
                    onClick={() => {
                      if (tab !== "pending") switchTab("pending");
                      setHealthLens((v) => (v === "attention" ? "all" : "attention"));
                    }}
                  />
                  <StatCell
                    icon="check_circle"
                    tone={C.success}
                    bg={C.successContainer}
                    line="#B7E1C4"
                    count={readyToConfirmCount}
                    label="Klaar om te bevestigen"
                    active={tab === "pending" && healthLens === "ready"}
                    disabled={readyToConfirmCount === 0}
                    onClick={() => {
                      if (tab !== "pending") switchTab("pending");
                      setHealthLens((v) => (v === "ready" ? "all" : "ready"));
                    }}
                  />
                </div>

                {/* [REIMPORT-ALL] One tap re-reads every "Aandacht nodig" invoice — each keeps its
                    own current state (improve-or-keep, never verified). Only when something is
                    actually flagged. */}
                {needsAttentionCount > 0 && (
                  <button
                    type="button"
                    onClick={handleReimportAllNeedsAttention}
                    disabled={reimportAllRunning}
                    aria-label="Alle facturen die aandacht nodig hebben opnieuw inlezen"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      width: "100%", marginTop: 10, padding: "11px 14px", borderRadius: R.md,
                      background: C.warnContainer, color: C.warn,
                      border: `1px solid ${C.warnLine}`,
                      fontSize: 13.5, fontWeight: 600, fontFamily: "inherit",
                      cursor: reimportAllRunning ? "default" : "pointer",
                      opacity: reimportAllRunning ? 0.7 : 1,
                    }}
                  >
                    <Icon name="refresh" size={18} spin={reimportAllRunning} />
                    {reimportAllRunning
                      ? `Bezig met opnieuw inlezen… (${reimportAllDone}/${needsAttentionCount})`
                      : `Alles met aandacht opnieuw inlezen (${needsAttentionCount})`}
                  </button>
                )}
              </>
            )}

            {/* [BRIDGE-POLISH 3b] Entry to the management surface for confirmed
                incoming invoices (received/paid) — including everything the app
                verified automatically. */}
            <Link
              href="/dashboard/incoming/manage"
              style={{
                display: "flex", alignItems: "center", gap: 10,
                marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}`,
                textDecoration: "none", color: C.onSurface,
              }}
            >
              <Icon name="request_quote" size={20} color={C.primary} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Bevestigde inkoopfacturen</span>
              <Icon name="chevron_right" size={18} color={C.faint} />
            </Link>
          </Card>
        </section>

        {/* ── 2. TOEVOEGEN — de dagelijkse invoer, bovenaan (net als op de home) ─ */}
        {/* Was the LAST block on the page: with a full queue you had to scroll past
            every card to photograph a bon. Same component, same flow, now in reach. */}
        <section>
          <SectionLabel>Toevoegen</SectionLabel>
          <ManualUpload onUploaded={() => {}} />
        </section>

        {/* ── 3. AUTOMATISCH INLEZEN — de e-mailkoppeling ─────────────────────── */}
        <section>
          <SectionLabel>Automatisch inlezen</SectionLabel>
          <ConnectEmailCard status={connectionStatus} />
        </section>

        {/* ── 4. FACTUREN — tabs, selectie, zoeken en de lijst ────────────────── */}
        <section>
          <SectionLabel
            right={
              tab === "pending" && pending.length > 0 ? (
                !selectMode ? (
                  <button
                    onClick={() => setSelectMode(true)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      background: "transparent", border: "none", color: C.primary,
                      fontWeight: 600, fontSize: 13, fontFamily: "inherit",
                      cursor: "pointer", padding: 0,
                    }}
                  >
                    <Icon name="checklist" size={17} />
                    Selecteer
                  </button>
                ) : (
                  <button
                    onClick={exitSelectMode}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      background: "transparent", border: "none", color: C.muted,
                      fontWeight: 600, fontSize: 13, fontFamily: "inherit",
                      cursor: "pointer", padding: 0,
                    }}
                  >
                    <Icon name="close" size={17} />
                    Klaar met selecteren
                  </button>
                )
              ) : undefined
            }
          >
            Facturen
          </SectionLabel>

          {/* Tabs — segmented control */}
          <div
            style={{
              display: "flex", gap: 4, marginBottom: 12,
              background: "#EDEFF2", borderRadius: R.md, padding: 4,
            }}
          >
            {([
              ["pending", "Te bevestigen", pending.length],
              ["confirmed", "Bevestigd", confirmed.length],
              ["ignored", "Genegeerd", ignored.length],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => switchTab(key)}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: R.sm, border: "none",
                  background: tab === key ? "#fff" : "transparent",
                  color: tab === key ? C.onSurface : C.muted,
                  fontWeight: 600, fontSize: 13, fontFamily: "inherit", cursor: "pointer",
                  boxShadow: tab === key ? EL1 : "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  minWidth: 0,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {label}
                </span>
                {count > 0 && (
                  <span
                    style={{
                      flexShrink: 0, fontSize: 11, fontWeight: 700, borderRadius: R.full,
                      padding: "1px 6px",
                      background: tab === key ? C.primaryContainer : "#E0E3E7",
                      color: tab === key ? C.onPrimaryContainer : C.muted,
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* [INTAKE-VERIFY-BULK] Select-all bar — only while selecting */}
          {tab === "pending" && selectMode && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                onClick={selectAllReady}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  background: C.primaryContainer, border: "none", color: C.onPrimaryContainer,
                  fontWeight: 600, fontSize: 13.5, fontFamily: "inherit", cursor: "pointer",
                  padding: "10px 14px", borderRadius: R.md,
                }}
              >
                <Icon name="done_all" size={18} />
                Selecteer alles wat klaar is ({pending.filter((p) => p.health.level !== "needs-review").length})
              </button>
            </div>
          )}

          {/* [SEARCH] In-page live filter (this page only) */}
          {(list.length > 0 || rawQ) && (
            <div style={{ position: "relative", marginBottom: 12 }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", display: "flex" }}>
                <Icon name="search" size={19} color="#9AA0A6" />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Zoek op leverancier, factuurnummer of bedrag…"
                aria-label="Inkomende facturen zoeken"
                style={{
                  width: "100%", boxSizing: "border-box", padding: "11px 38px",
                  borderRadius: R.md, border: `1px solid ${C.line}`, fontSize: 14.5,
                  outline: "none", background: "#fff", color: C.onSurface, fontFamily: "inherit",
                }}
              />
              {search && (
                <button onClick={() => setSearch("")} aria-label="Zoekopdracht wissen"
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, borderRadius: "50%", border: "none", background: "#E5E5EA", color: "#3A3A3C", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                  <Icon name="close" size={14} color="#3A3A3C" />
                </button>
              )}
            </div>
          )}

          {/* [INCOMING-TIDY] Active health lens — always visible and always
              undoable, so a filtered list can never be mistaken for the whole queue. */}
          {tab === "pending" && healthLens !== "all" && (
            <button
              onClick={() => setHealthLens("all")}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                marginBottom: 12, padding: "9px 12px", borderRadius: R.md,
                background: healthLens === "attention" ? C.warnContainer : C.successContainer,
                border: `1px solid ${healthLens === "attention" ? C.warnLine : "#B7E1C4"}`,
                color: healthLens === "attention" ? C.warn : C.success,
                fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", textAlign: "left",
              }}
            >
              <Icon name={healthLens === "attention" ? "warning" : "check_circle"} size={17} />
              <span style={{ flex: 1 }}>
                Je ziet alleen {healthLens === "attention" ? "wat aandacht nodig heeft" : "wat klaar is"}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                Toon alles
                <Icon name="close" size={15} />
              </span>
            </button>
          )}

          {/* Invoice list */}
          {filteredList.length > 0 ? (
            <div>
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
          ) : rawQ || (tab === "pending" && healthLens !== "all") ? (
            <Card style={{ textAlign: "center", padding: "36px 24px", color: C.muted }}>
              <Icon name="search_off" size={40} color="#C9CDD2" />
              <div style={{ fontWeight: 600, fontSize: 15.5, margin: "10px 0 6px", color: C.onSurface }}>
                Geen facturen gevonden
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                {rawQ
                  ? `Niets voor “${rawQ}” in ${tab === "pending" ? "te bevestigen" : tab === "confirmed" ? "bevestigd" : "genegeerd"}.`
                  : "Niets in deze selectie — tik op “Toon alles” hierboven."}
              </div>
            </Card>
          ) : (
            <Card style={{ textAlign: "center", padding: "36px 24px", color: C.muted }}>
              <Icon
                name={tab === "pending" ? "task_alt" : tab === "confirmed" ? "request_quote" : "inbox"}
                size={44}
                color={tab === "pending" ? C.success : "#C9CDD2"}
              />
              <div style={{ fontWeight: 600, fontSize: 16, margin: "10px 0 6px", color: C.onSurface }}>
                {tab === "pending" ? "Alles bijgewerkt" : tab === "confirmed" ? "Nog niets bevestigd" : "Geen genegeerde facturen"}
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                {tab === "pending"
                  ? "Nieuwe facturen verschijnen hier zodra ze binnenkomen."
                  : tab === "confirmed"
                    ? "Facturen die je verifieert of markeert als betaald verschijnen hier."
                    : "Facturen die je negeert komen hier terecht."}
              </div>
            </Card>
          )}
        </section>
      </main>

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
            borderTop: `1px solid ${C.line}`,
            display: "flex", justifyContent: "center",
          }}
        >
          <button
            onClick={() => setBulkConfirmOpen(true)}
            style={{
              width: "100%", maxWidth: 448, padding: "15px", borderRadius: R.md,
              background: "#34A853", color: "#fff", border: "none",
              fontWeight: 700, fontSize: 15.5, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            Bevestig {selected.size} factuur{selected.size > 1 ? "en" : ""}
          </button>
        </div>
      )}

      {/* [INTAKE-VERIFY-BULK] Running overlay */}
      {bulkRunning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100 }}>
          <div style={{ background: "#fff", borderRadius: R.lg, padding: "24px 28px", fontSize: 15, fontWeight: 600, color: C.onSurface }}>
            Bezig met verifiëren…
          </div>
        </div>
      )}

      {/* [REIMPORT-ALL] Block the page while the batch re-read runs — so an edit modal can't be
          opened mid-run and then wiped by the end-of-run reload, and no card can be verified into
          a 409. */}
      {reimportAllRunning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100 }}>
          <div style={{ background: "#fff", borderRadius: R.lg, padding: "24px 28px", fontSize: 15, fontWeight: 600, color: C.onSurface, textAlign: "center" }}>
            Bezig met opnieuw inlezen…
            <div style={{ fontSize: 13, fontWeight: 400, color: C.muted, marginTop: 4 }}>
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
              paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
              width: "100%", maxWidth: 460,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 19, color: C.onSurface, marginBottom: 4 }}>
              {selected.size} factuur{selected.size > 1 ? "en" : ""} bevestigen?
            </div>
            <div style={{ fontSize: 14, color: C.muted, marginBottom: 20, lineHeight: 1.5 }}>
              De geselecteerde facturen worden geverifieerd en als Crediteur naar je boekhouder gestuurd. De bedragen worden overgenomen zoals uitgelezen.
            </div>
            <button
              onClick={handleVerifyBatch}
              style={{
                width: "100%", padding: "15px", borderRadius: R.md,
                background: "#34A853", color: "#fff", border: "none",
                fontWeight: 700, fontSize: 15.5, fontFamily: "inherit", cursor: "pointer", marginBottom: 8,
              }}
            >
              Ja, bevestig {selected.size}
            </button>
            <button
              onClick={() => setBulkConfirmOpen(false)}
              style={{
                width: "100%", padding: "13px", borderRadius: R.md,
                background: C.bg, color: C.onSurface, border: "none",
                fontWeight: 600, fontSize: 15, fontFamily: "inherit", cursor: "pointer",
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
          confirmColor="#EA4335"
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
            padding: "12px 20px", borderRadius: R.xl, fontSize: 14, fontWeight: 600,
            backdropFilter: "blur(12px)", maxWidth: "92vw", textAlign: "center",
            zIndex: 3000, boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
          }}
        >
          {toast}
        </div>
      )}

      <style>{`@keyframes bbSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// [INCOMING-TIDY] One half of the status card: a count with its meaning, doubling
// as the filter for that half of the queue. Disabled (and visibly quiet) at zero —
// tapping a counter that would empty the list is never useful.
function StatCell({
  icon, tone, bg, line, count, label, active, disabled, onClick,
}: {
  icon: string;
  tone: string;
  bg: string;
  line: string;
  count: number;
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{
        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
        padding: "10px 12px", borderRadius: R.md, textAlign: "left",
        background: disabled ? C.bg : bg,
        border: `1px solid ${active ? tone : disabled ? "transparent" : line}`,
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit", width: "100%",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name={icon} size={17} color={disabled ? C.faint : tone} />
        <span style={{ fontSize: 19, fontWeight: 700, color: disabled ? C.faint : tone }}>{count}</span>
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: disabled ? C.faint : tone, lineHeight: 1.3 }}>
        {label}
      </span>
    </button>
  );
}
