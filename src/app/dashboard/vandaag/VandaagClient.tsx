// src/app/dashboard/vandaag/VandaagClient.tsx
// [TODAY-LISTS-V1 + TODAY-UX-CLARITY] "Vandaag" client — the owner's daily
// control center for invoices. Shows TASKS + DATES only, never a computed
// amount/total (locked principle: a wrong number breaks trust; a wrong task is
// just ignored).
//
// [TODAY-UX-CLARITY] Clarity pass — the card now answers the two questions the
// owner actually has ("why is this in front of me?" / "what do I do?"):
//   1. Calmer urgency: a long-overdue invoice reads "Al lang open" (calm amber),
//      NOT a scary red "59 dagen te laat" — a routine supplier bill is not a
//      catastrophe, and it is often already paid-but-unrecorded.
//   2. "Al betaald?" context action — jumps to the manage surface to confirm
//      (Vandaag stays READ-ONLY; the write happens where the logic already lives).
//   3. One clear primary verb per direction ("Betalen" / "Herinnering") instead
//      of the ambiguous "Bekijk / betaal".
//   4. "Negeren" reads as "verbergen voor vandaag" (hide), not "delete".
//   5. Section header shows a count ("1 factuur") for a sense of control.
//   6. Long-overdue items are grouped separately from soon-due ones.
//
// Payment state is `status` ONLY (never payment_date/marked_paid_at). Direction-
// aware navigation: incoming → IncomingManageClient (?focus=), outgoing → invoice
// detail. Design: Material You (ZZP surface), mobile-first. All copy in Dutch.

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
// [TODAY-UX-FIELDS] Display-only formatters (single source of truth). formatEuroNL
// simply RENDERS a stored number; no arithmetic happens in "Vandaag".
import { formatEuroNL, formatDateNL } from "@/lib/format-nl";

// ─── Material You tokens (matched 1:1 with IncomingManageClient) ──────────────

const M3 = {
  primary: "#1A73E8",
  onSurface: "#202124",
  onSurfaceVariant: "#5F6368",
  warning: "#E37400", // soon-due / long-open (calm amber)
  error: "#B3261E", // recently overdue (real attention)
  hairline: "#E0E0E0",
  hover: "#F1F3F4",
};

// Long-overdue threshold (days). Past this, we drop the alarming day-counter in
// favour of a calm "al lang open" — see clarity rationale above.
const LONG_OPEN_DAYS = 30;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VandaagInvoice {
  id: string;
  client_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null; // ISO date
  due_date: string | null; // ISO date — page.tsx already filters out nulls
  total_inc_btw: number | null; // STORED total — read-only, never computed here
  amount_paid?: number | null; // [PARTIAL-PAY] settled so far; remaining = |total| − amount_paid
  status: string;
  direction: string;
}

interface Props {
  payable: VandaagInvoice[]; // List 1 — incoming, status='received'
  remind: VandaagInvoice[]; // List 2 — outgoing, status IN ('sent','overdue')
}

// ─── Date helpers (timezone-proof) ────────────────────────────────────────────
// Mirrors lib/format-nl.ts: a date-only string ("2026-06-12") is handled by
// STRING surgery, never `new Date('2026-06-12')` (which parses as UTC midnight and
// shifts a day in negative-offset zones). We compare whole calendar days only.

function todayDayNumber(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"
  return dayNumberFromIso(parts);
}

// Convert an ISO date prefix ("YYYY-MM-DD…") to a whole-day count via UTC noon.
// UTC noon is safe: no DST/offset can push a date-only value across midnight.
function dayNumberFromIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return NaN;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Math.floor(utc / 86_400_000);
}

// Days until due: negative = overdue, 0 = today, positive = future.
function daysUntilDue(dueIso: string): number {
  return dayNumberFromIso(dueIso) - todayDayNumber();
}

function isLongOpen(dueIso: string): boolean {
  return daysUntilDue(dueIso) <= -LONG_OPEN_DAYS;
}

// Urgency tier drives BOTH the label and the colour, so they can never disagree.
type Urgency = "long-open" | "overdue" | "soon";

function urgencyOf(dueIso: string): Urgency {
  const d = daysUntilDue(dueIso);
  if (d <= -LONG_OPEN_DAYS) return "long-open";
  if (d < 0) return "overdue";
  return "soon";
}

// Human Dutch due-date status. Long-overdue is deliberately calm (no big number).
function dueLabel(dueIso: string): string {
  const d = daysUntilDue(dueIso);
  if (d <= -LONG_OPEN_DAYS) return "Al lang open";
  if (d < 0) {
    const late = Math.abs(d);
    return late === 1 ? "1 dag te laat" : `${late} dagen te laat`;
  }
  if (d === 0) return "Vervalt vandaag";
  if (d === 1) return "Vervalt morgen";
  return `Vervalt over ${d} dagen`;
}

// Calm amber for soon-due AND long-open; saved red only for the recently overdue
// window (1–29 days) where a nudge is genuinely useful, not alarming.
function accentOf(dueIso: string): string {
  return urgencyOf(dueIso) === "overdue" ? M3.error : M3.warning;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VandaagClient({ payable, remind }: Props) {
  const router = useRouter();

  // [TODAY-LISTS-V1] "Negeren" = session-only visual hide (no DB write, like
  // BANK-SLOT-DISMISS). The invoice is untouched; it returns on reload because it
  // is still unpaid — intended (a reminder, not a deletion).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const dismiss = (id: string) =>
    setDismissed((prev: Set<string>) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  // [TODAY-ROUTE-FIX] Direction-aware navigation. Incoming → the complete manage
  // surface (PDF, PAY-SAFE/QR, vendor details), landing on the exact row via
  // ?focus=. Outgoing → the invoice detail page (creditnota, actions). We never
  // send an incoming invoice to the detail page (it renders incoming incompletely).
  const open = (id: string, direction: string) =>
    router.push(
      direction === "incoming"
        ? `/dashboard/incoming/manage?focus=${id}`
        : `/dashboard/invoice/${id}`
    );

  // [TODAY-UX-CLARITY] "Al betaald?" — the owner confirms a payment they already
  // made (paid-but-unrecorded is the #1 cause of a scary "overdue"). Vandaag stays
  // READ-ONLY: this routes to the manage surface AND asks it to open the existing
  // mark-as-paid dialog (?action=pay), so the owner lands directly on Bank/Contant
  // + date. The write itself still happens only in IncomingManageClient (one
  // source of truth) — Vandaag merely passes the intent via the URL.
  const confirmPaid = (id: string) =>
    router.push(`/dashboard/incoming/manage?focus=${id}&action=pay`);

  const visiblePayable = useMemo(
    () => filterWindow(payable, dismissed),
    [payable, dismissed]
  );
  const visibleRemind = useMemo(
    () => filterWindow(remind, dismissed),
    [remind, dismissed]
  );

  const nothingToDo =
    visiblePayable.length === 0 && visibleRemind.length === 0;

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "24px 16px 64px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: M3.onSurface,
            margin: "0 0 4px",
          }}
        >
          Vandaag
        </h1>
        <p style={{ fontSize: 15, color: M3.onSurfaceVariant, margin: 0 }}>
          Dit heeft vandaag je aandacht nodig.
        </p>
      </header>

      {nothingToDo ? (
        <EmptyAllClear />
      ) : (
        <>
          <ListSection
            title="Te betalen"
            subtitle="Facturen die jij moet betalen"
            invoices={visiblePayable}
            onOpen={open}
            onConfirmPaid={confirmPaid}
            onDismiss={dismiss}
          />
          <ListSection
            title="Herinner je klant"
            subtitle="Verstuurde facturen die nog niet betaald zijn"
            invoices={visibleRemind}
            onOpen={open}
            onConfirmPaid={null}
            onDismiss={dismiss}
          />
        </>
      )}
    </div>
  );
}

// Keep only invoices due within 3 days (or overdue) and not session-dismissed,
// oldest-due first. Defensive null-guard on due_date (page.tsx excludes nulls).
function filterWindow(
  invoices: VandaagInvoice[],
  dismissed: Set<string>
): VandaagInvoice[] {
  return invoices
    .filter((inv) => inv.due_date && !dismissed.has(inv.id))
    .filter((inv) => daysUntilDue(inv.due_date as string) <= 3)
    .sort(
      (a, b) =>
        dayNumberFromIso(a.due_date as string) -
        dayNumberFromIso(b.due_date as string)
    );
}

// ─── List section ─────────────────────────────────────────────────────────────
// [TODAY-UX-CLARITY] header shows a count; long-open items are grouped under a
// calm sub-heading, separated from the soon/recently-due items.

function ListSection({
  title,
  subtitle,
  invoices,
  onOpen,
  onConfirmPaid,
  onDismiss,
}: {
  title: string;
  subtitle: string;
  invoices: VandaagInvoice[];
  onOpen: (id: string, direction: string) => void;
  // null when the list is outgoing (no "Al betaald?" — that is the client's job).
  onConfirmPaid: ((id: string) => void) | null;
  onDismiss: (id: string) => void;
}) {
  if (invoices.length === 0) return null;

  // Split: active (soon + recently overdue) vs long-open (calm, grouped below).
  const active = invoices.filter((inv) => !isLongOpen(inv.due_date as string));
  const longOpen = invoices.filter((inv) => isLongOpen(inv.due_date as string));

  const countLabel =
    invoices.length === 1 ? "1 factuur" : `${invoices.length} facturen`;

  return (
    <section style={{ marginBottom: 32 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 12,
          gap: 8,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: M3.onSurface,
              margin: "0 0 2px",
            }}
          >
            {title}
          </h2>
          <p style={{ fontSize: 13, color: M3.onSurfaceVariant, margin: 0 }}>
            {subtitle}
          </p>
        </div>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: M3.onSurfaceVariant,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {countLabel}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {active.map((inv) => (
          <InvoiceCard
            key={inv.id}
            invoice={inv}
            onOpen={onOpen}
            onConfirmPaid={onConfirmPaid}
            onDismiss={onDismiss}
          />
        ))}
      </div>

      {longOpen.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: M3.onSurfaceVariant,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              margin: "0 0 8px",
            }}
          >
            Al langer open
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {longOpen.map((inv) => (
              <InvoiceCard
                key={inv.id}
                invoice={inv}
                onOpen={onOpen}
                onConfirmPaid={onConfirmPaid}
                onDismiss={onDismiss}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
// [TODAY-UX-FIELDS] Card shows party name, invoice number, dates, and the STORED
// total (read directly from total_inc_btw — never computed here), plus the human
// due status and the clear action buttons.

function InvoiceCard({
  invoice,
  onOpen,
  onConfirmPaid,
  onDismiss,
}: {
  invoice: VandaagInvoice;
  onOpen: (id: string, direction: string) => void;
  onConfirmPaid: ((id: string) => void) | null;
  onDismiss: (id: string) => void;
}) {
  const due = invoice.due_date as string;
  const accent = accentOf(due);
  const isIncoming = invoice.direction === "incoming";

  // [HONEST-HOME] A negative incoming total is a creditnota: it REDUCES what you
  // owe, it is not something you "pay". So it must not offer "Betalen" / "Al
  // betaald?" — only "Bekijken". (This is the same rule the home snapshot uses.)
  const isCredit = isIncoming && (invoice.total_inc_btw ?? 0) < 0;

  // One clear verb per direction (clarity #3). Outgoing says "Bekijken" — NOT
  // "Herinnering sturen" — because the button currently routes to the invoice
  // page; there is no reminder-send logic yet, so the label must not promise an
  // action we don't perform. When a real reminder flow is built, change this.
  const primaryLabel = isCredit ? "Bekijken" : isIncoming ? "Betalen" : "Bekijken";

  return (
    <div
      style={{
        background: "#ffffff",
        border: `1px solid ${M3.hairline}`,
        borderRadius: 16,
        borderLeft: `4px solid ${accent}`,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
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
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: M3.onSurface,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {invoice.client_name?.trim() || "Onbekende partij"}
          </div>

          {/* [TODAY-UX-FIELDS] Invoice number — quiet secondary line. */}
          {invoice.invoice_number?.trim() && (
            <div
              style={{
                fontSize: 13,
                color: M3.onSurfaceVariant,
                marginTop: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Factuur {invoice.invoice_number.trim()}
            </div>
          )}

          <div
            style={{ fontSize: 14, color: accent, fontWeight: 500, marginTop: 4 }}
          >
            {dueLabel(due)}
          </div>

          {/* [TODAY-UX-FIELDS] Dates — factuurdatum + vervaldatum, via the shared
              display formatter (DD-MM-YYYY, timezone-proof). */}
          <div
            style={{ fontSize: 12, color: M3.onSurfaceVariant, marginTop: 2 }}
          >
            Factuurdatum {formatDateNL(invoice.invoice_date)} · Vervalt{" "}
            {formatDateNL(invoice.due_date)}
          </div>

          {/* [TODAY-UX-FIELDS] STORED total — read directly from total_inc_btw, never computed here.
              [PARTIAL-PAY] When a deelbetaling already settled part of it, show the REMAINING
              openstaand (the reconciled truth the bank matcher booked), with the full total as a
              sub-note — never the full total as "te betalen" when only part is left. */}
          {typeof invoice.total_inc_btw === "number" && (() => {
            const total = invoice.total_inc_btw;
            const paid = Math.max(0, invoice.amount_paid ?? 0);
            const isPartial = paid > 0.005 && paid < Math.abs(total) - 0.005;
            const openstaand = isPartial ? (total < 0 ? -1 : 1) * (Math.abs(total) - paid) : total;
            return (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: M3.onSurface }}>
                  {formatEuroNL(openstaand)}
                </div>
                {isPartial && (
                  <div style={{ fontSize: 12, color: "#b06000", marginTop: 2 }}>
                    deels betaald · van {formatEuroNL(total)}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* "Negeren" — session-only visual hide. No DB, no status change. */}
        <button
          type="button"
          onClick={() => onDismiss(invoice.id)}
          aria-label="Verbergen voor vandaag"
          title="Verbergen voor vandaag"
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            height: 32,
            padding: "0 10px",
            borderRadius: 16,
            border: "none",
            background: M3.hover,
            color: M3.onSurfaceVariant,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Verbergen
        </button>
      </div>

      {/* Actions row. Primary verb (direction-aware) + an optional "Al betaald?"
          context action for incoming invoices (routes to manage to confirm). */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => onOpen(invoice.id, invoice.direction)}
          style={{
            flex: 1,
            padding: "10px 16px",
            borderRadius: 20,
            border: "none",
            background: M3.primary,
            color: "#ffffff",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {primaryLabel}
        </button>

        {isIncoming && !isCredit && onConfirmPaid && (
          <button
            type="button"
            onClick={() => onConfirmPaid(invoice.id)}
            style={{
              flexShrink: 0,
              padding: "10px 16px",
              borderRadius: 20,
              border: `1px solid ${M3.primary}`,
              background: "#ffffff",
              color: M3.primary,
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Al betaald?
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyAllClear() {
  return (
    <div
      style={{
        background: "#ffffff",
        border: `1px solid ${M3.hairline}`,
        borderRadius: 16,
        padding: "40px 24px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
      <div
        style={{
          fontSize: 17,
          fontWeight: 600,
          color: M3.onSurface,
          marginBottom: 4,
        }}
      >
        Niets dat nu je aandacht nodig heeft
      </div>
      <div style={{ fontSize: 14, color: M3.onSurfaceVariant }}>
        Geen facturen die binnen 3 dagen vervallen of te laat zijn.
      </div>
    </div>
  );
}