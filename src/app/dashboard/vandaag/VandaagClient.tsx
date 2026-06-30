// src/app/dashboard/vandaag/VandaagClient.tsx
// [TODAY-LISTS-V1] "Vandaag" client — two task lists, no numbers.
//
// Shows TASKS + DATES only — never a computed amount/total (locked principle: a
// wrong number breaks trust; a wrong task is just ignored). Each card: party name
// + human due-date status + "Bekijk / betaal" (jumps to the invoice page where
// the real actions live) + "Negeren" (session-only visual hide, no DB).
//
// Design: Material You (ZZP surface) — #1A73E8 primary, rounded cards, mobile-first.
// All copy in Dutch.

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VandaagInvoice {
  id: string;
  client_name: string | null;
  due_date: string | null; // ISO date — page.tsx already filters out nulls
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
// shifts a day in negative-offset zones). We compare whole calendar days only, so
// "vervalt over 3 dagen" can never be off by a timezone.

// "today" as a calendar day count (days since epoch) in Europe/Amsterdam.
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

// Human Dutch due-date status. No numbers other than the day count itself.
function dueLabel(dueIso: string): string {
  const d = daysUntilDue(dueIso);
  if (d < 0) {
    const late = Math.abs(d);
    return late === 1 ? "1 dag te laat" : `${late} dagen te laat`;
  }
  if (d === 0) return "vervalt vandaag";
  if (d === 1) return "vervalt morgen";
  return `vervalt over ${d} dagen`;
}

// Urgent = due today or already overdue → red accent; else amber.
function isUrgent(dueIso: string): boolean {
  return daysUntilDue(dueIso) <= 0;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VandaagClient({ payable, remind }: Props) {
  const router = useRouter();

  // [TODAY-LISTS-V1] "Negeren" = session-only visual hide (no DB write, like
  // BANK-SLOT-DISMISS). The invoice is untouched; it returns on reload because it
  // is still unpaid — that is intended (a reminder, not a deletion).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const dismiss = (id: string) =>
    setDismissed((prev: Set<string>) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  // [TODAY-ROUTE-FIX] Direction-aware navigation. An incoming invoice has its
  // complete owner surface in IncomingManageClient (PDF, PAY-SAFE/QR, vendor
  // details) and lands on the exact row via ?focus=. The single invoice page
  // (/dashboard/invoice/[id]) is the outgoing surface (creditnota, actions) and
  // renders an incoming invoice incompletely, so we never send incoming there.
  const open = (id: string, direction: string) =>
    router.push(
      direction === "incoming"
        ? `/dashboard/incoming/manage?focus=${id}`
        : `/dashboard/invoice/${id}`
    );

  // Apply the ≤3-day window + session dismissals, keep oldest-due first (already
  // sorted ascending server-side; we re-sort defensively after filtering).
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
            color: "#202124",
            margin: "0 0 4px",
          }}
        >
          Vandaag
        </h1>
        <p style={{ fontSize: 15, color: "#5f6368", margin: 0 }}>
          Wat heeft je aandacht nodig.
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
            onDismiss={dismiss}
          />
          <ListSection
            title="Herinner je klant"
            subtitle="Verstuurde facturen die nog niet betaald zijn"
            invoices={visibleRemind}
            onOpen={open}
            onDismiss={dismiss}
          />
        </>
      )}
    </div>
  );
}

// Keep only invoices due within 3 days (or overdue) and not session-dismissed,
// oldest-due first. Defensive null-guard on due_date (page.tsx already excludes
// nulls, but the type allows it).
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

function ListSection({
  title,
  subtitle,
  invoices,
  onOpen,
  onDismiss,
}: {
  title: string;
  subtitle: string;
  invoices: VandaagInvoice[];
  onOpen: (id: string, direction: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (invoices.length === 0) return null;

  return (
    <section style={{ marginBottom: 32 }}>
      <div style={{ marginBottom: 12 }}>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "#202124",
            margin: "0 0 2px",
          }}
        >
          {title}
        </h2>
        <p style={{ fontSize: 13, color: "#5f6368", margin: 0 }}>{subtitle}</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {invoices.map((inv) => (
          <InvoiceCard
            key={inv.id}
            invoice={inv}
            onOpen={onOpen}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </section>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
// No amount, no total — only the party name + human due status. By design.

function InvoiceCard({
  invoice,
  onOpen,
  onDismiss,
}: {
  invoice: VandaagInvoice;
  onOpen: (id: string, direction: string) => void;
  onDismiss: (id: string) => void;
}) {
  const due = invoice.due_date as string;
  const urgent = isUrgent(due);
  const accent = urgent ? "#B3261E" : "#EA8600";

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #E0E0E0",
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
              color: "#202124",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {invoice.client_name?.trim() || "Onbekende partij"}
          </div>
          <div style={{ fontSize: 14, color: accent, fontWeight: 500, marginTop: 2 }}>
            {dueLabel(due)}
          </div>
        </div>

        {/* "Negeren" — session-only visual hide. No DB, no status change. */}
        <button
          type="button"
          onClick={() => onDismiss(invoice.id)}
          aria-label="Negeren"
          title="Negeren — verbergen voor vandaag"
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: 16,
            border: "none",
            background: "#F1F3F4",
            color: "#5f6368",
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>

      {/* Primary action — jump to the invoice page (one source of truth for the
          amount, PDF, pay, mark-as-paid). "Vandaag" never duplicates that logic. */}
      <button
        type="button"
        onClick={() => onOpen(invoice.id, invoice.direction)}
        style={{
          width: "100%",
          padding: "10px 16px",
          borderRadius: 20,
          border: "none",
          background: "#1A73E8",
          color: "#ffffff",
          fontSize: 15,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Bekijk / betaal
      </button>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyAllClear() {
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #E0E0E0",
        borderRadius: 16,
        padding: "40px 24px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
      <div style={{ fontSize: 17, fontWeight: 600, color: "#202124", marginBottom: 4 }}>
        Niets dat nu je aandacht nodig heeft
      </div>
      <div style={{ fontSize: 14, color: "#5f6368" }}>
        Geen facturen die binnen 3 dagen vervallen of te laat zijn.
      </div>
    </div>
  );
}