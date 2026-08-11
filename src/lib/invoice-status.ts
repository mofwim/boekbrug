// src/lib/invoice-status.ts
// [STATUS] What an invoice's status is CALLED and what colour it is chipped in. One place.
// Pure. Run: npx tsx --test src/lib/invoice-status.test.ts
//
// There were seven, and they had already drifted:
//
//   src/components/invoice/InvoiceRow.tsx        label only
//   src/components/ui/StatusFilter.tsx           label only
//   src/components/search/SearchBar.tsx          label + bg + `text`
//   src/components/quarterly/QuarterlyOverview.tsx   label only — and 'overdue' read "Te laat"
//   src/app/dashboard/invoice/[id]/page.tsx      label + bg + `color`   ← the Design System one
//   src/app/dashboard/facturen/FacturenClient.tsx    label + an inline ternary further down
//   src/app/dashboard/zoeken/ZoekenClient.tsx    label + bg + `text`
//
// So the same overdue invoice was "Verlopen" in the list and "Te laat" in the quarterly overview,
// and a sent invoice wore #D3E3FD on its own page and #e8f0fe in search — two blues for one state.
// Small, and exactly the shape of every defect this codebase keeps producing: one fact, several
// definitions, and no way to notice they disagree.
//
// It became worth fixing the moment the app got a second language. Seven copies is seven places to
// translate, so the honest prediction is that two of them get done and the owner reads a screen
// that is half Arabic — which is why this is one module and not seven translated maps.
//
// There was an eighth, found while replacing the seventh: a private `DS` object inside
// InvoiceRow.tsx, not the design tokens it looks like it comes from.
//
// WHICH VALUES WON. The Design System ones, named as such in invoice/[id]/page.tsx ("[DS] Design
// System v1.0 — Status chip colors") and agreeing with InvoiceRow's DS on every status but one.
// Search and Zoeken carried an older, lighter palette.
//
// THE ONE REAL DISAGREEMENT is `received`, and it is not a typo — the two files mean different
// things by it. InvoiceRow chips it amber (#FEF7E0/#B26A00) with a reason written down: an
// incoming invoice that is not yet paid, a creditor. The detail page chipped it blue, the same
// blue as `sent`, which reads as "this is done". Amber wins because it is the one with an
// argument attached, and because a bill you still owe should not look settled.
//
// And "Verlopen" over "Te laat": five files to one, and it is the word the filter tab uses, so it
// is the word the owner already searches with.
//
// The key for the text colour is `color`, not `text` — two of the seven used each.
//
// STILL TO DO, named so it is not mistaken for finished:
//
//   · src/lib/bridge-tree.ts pushes a 'Verlopen' badge. Its header says its labels are folder path
//     segments that must match "byte-for-byte, or the merge silently fails", so making them
//     language-dependent is a change to a MERGE KEY, not to a caption. It needs its own pass, with
//     the display badges separated from the path segments first.
//   · The accountant's action vocabulary — verwerkt / in_behandeling / vraag — is a different set
//     of words for a different thing, currently duplicated in BrugClient, the quarterly page and
//     InvoiceRow's DS.action. Same consolidation, same reasons, not the same vocabulary.

import { translator } from "./i18n/t";
import type { MessageKey } from "./i18n/messages";
import type { Locale } from "./i18n/locale";

/** Every status the product actually chips. */
export const INVOICE_STATUSES = [
  "draft", "sent", "paid", "overdue", "received", "processing", "processed", "unclear", "credit",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

interface StatusStyle {
  key: MessageKey;
  bg: string;
  color: string;
}

const STYLE: Record<InvoiceStatus, StatusStyle> = {
  draft:      { key: "status.draft",      bg: "#f1f3f4", color: "#5f6368" },
  sent:       { key: "status.sent",       bg: "#D3E3FD", color: "#1967D2" },
  paid:       { key: "status.paid",       bg: "#CEEAD6", color: "#137333" },
  overdue:    { key: "status.overdue",    bg: "#F9DEDC", color: "#B3261E" },
  // Amber, not blue — see the note above. An unpaid bill may not look settled.
  received:   { key: "status.received",   bg: "#FEF7E0", color: "#B26A00" },
  processing: { key: "status.processing", bg: "#FEF7E0", color: "#EA8600" },
  processed:  { key: "status.processed",  bg: "#CEEAD6", color: "#137333" },
  unclear:    { key: "status.unclear",    bg: "#F9DEDC", color: "#B3261E" },
  credit:     { key: "status.credit",     bg: "#FCE8E6", color: "#C5221F" },
};

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === "string" && (INVOICE_STATUSES as readonly string[]).includes(value);
}

/**
 * The word for a status, in the owner's language.
 *
 * An unknown status returns the raw value rather than a guess or a blank. A status this module
 * does not know is a database value that arrived from somewhere new, and showing it is how it
 * gets noticed; "—" would hide it and an empty chip would look like a rendering fault.
 */
export function statusLabel(status: unknown, locale?: Locale | string | null): string {
  if (!isInvoiceStatus(status)) return typeof status === "string" ? status : "";
  return translator(locale)(STYLE[status].key);
}

export interface StatusChip {
  label: string;
  bg: string;
  color: string;
}

/** Label and colours together, so a screen cannot take one from here and the other from itself. */
export function statusChip(status: unknown, locale?: Locale | string | null): StatusChip {
  if (!isInvoiceStatus(status)) {
    return { label: statusLabel(status, locale), bg: "#f1f3f4", color: "#5f6368" };
  }
  const s = STYLE[status];
  return { label: statusLabel(status, locale), bg: s.bg, color: s.color };
}
