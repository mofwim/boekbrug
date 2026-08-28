// src/lib/voorbeeld-dossier.ts
// [PROEFDOSSIER] The example client file — the proof moment for an accountant with zero clients.
//
// ── WHY THIS EXISTS ──
// A fresh accountant logs in and sees an empty portal with one button: "invite your first
// client". Nothing on that screen shows what they are inviting the client INTO. The moment that
// convinces an office is seeing a FILLED client file — the quarter, the statuses, the question
// that stayed a question — and until their first client accepts and uploads, that moment did not
// exist. This module is that moment, two minutes after registration.
//
// ── WHY IT IS PURE DATA AND NOT SEEDED ROWS ──
// The obvious build (a demo administration in the real tables) is the one this codebase must
// refuse: fictional invoices in `invoices` would be reachable by every aggregate, export and
// cron that reads those tables, and each of those would need to learn to skip them. One missed
// filter and a fictional €1.635 stands in something real. So the file is CONSTANTS, rendered by
// one screen, reachable by nothing else. The screen says "fictief" on it; this module guarantees
// the database never has to.
//
// ── WHY THE TOTALS ARE DERIVED, NOT TYPED ──
// Someone will recompute them — an accountant is exactly the reader who checks a column. Typed
// totals drift from their rows the first time anyone edits a row ([PRIJS-KOLOM] measured that
// class on the real invoice PDF). So the totals below are FUNCTIONS of the rows, the screen only
// renders what dossierTotalen() returns, and the unit test recomputes everything independently.
//
// And the honesty pitch is IN the arithmetic: the invoice that still carries a question is
// excluded from voorbelasting and kosten — visible in the numbers, not just claimed in a
// sentence. That exclusion is the product ("een vraagpost, niet een gok"), so it is tested.

// [CENT] The one cent-rounder — see invoice-totals.ts.
import { round2 } from "./invoice-totals";

export type VoorbeeldStatus = "verwerkt" | "vraag";

export interface VoorbeeldVerkoop {
  nummer: string;
  klant: string;
  exBtw: number;
  btwTarief: 9 | 21;
  /** 'paid' | 'sent' — rendered through the existing status.* vocabulary. */
  status: "paid" | "sent";
}

export interface VoorbeeldInkoop {
  leverancier: string;
  exBtw: number;
  btwTarief: 9 | 21;
  status: VoorbeeldStatus;
  /** The question that stayed a question — only on the 'vraag' row. */
  vraag?: string;
}

/** A bakery, because its mixed 9%/21% rates show the split a real administratie carries. */
export const VOORBEELD_KLANT = "Bakkerij Voorbeeld & Zn." as const;
export const VOORBEELD_KWARTAAL = "Q2 2026" as const;

export const VOORBEELD_VERKOOP: readonly VoorbeeldVerkoop[] = [
  { nummer: "20260012", klant: "Lunchroom De Hoek", exBtw: 1500, btwTarief: 9, status: "paid" },
  { nummer: "20260013", klant: "Cateraar Zuidplein", exBtw: 750, btwTarief: 9, status: "sent" },
];

export const VOORBEELD_INKOOP: readonly VoorbeeldInkoop[] = [
  { leverancier: "Meelhandel Jansen", exBtw: 400, btwTarief: 9, status: "verwerkt" },
  { leverancier: "Energiebedrijf Voorbeeld", exBtw: 180, btwTarief: 21, status: "verwerkt" },
  {
    leverancier: "Verpakkingen De Berg",
    exBtw: 100,
    btwTarief: 21,
    status: "vraag",
    // [TAAL-DB] De vraag zoals hij bij een echte klant in het dossier staat — Nederlands, want zo
    // staat hij ook in een echte administratie tussen boekhouder en klant.
    vraag: "De foto is onscherp — het bedrag is niet van de bon te lezen. Kun je hem opnieuw fotograferen?",
  },
];

export function btwVan(exBtw: number, tarief: number): number {
  return round2((exBtw * tarief) / 100);
}

export function inclVan(exBtw: number, tarief: number): number {
  return round2(exBtw + btwVan(exBtw, tarief));
}

export interface VoorbeeldTotalen {
  omzetEx: number;
  /** Only the CONFIRMED purchase rows — the question does not count yet, and that is the pitch. */
  kostenEx: number;
  btwVerschuldigd: number;
  voorbelasting: number;
  /** verschuldigd − voorbelasting; positive = te betalen. */
  saldo: number;
  verwerkteInkoop: number;
  openVragen: number;
}

export function dossierTotalen(): VoorbeeldTotalen {
  const omzetEx = round2(VOORBEELD_VERKOOP.reduce((s, r) => s + r.exBtw, 0));
  const btwVerschuldigd = round2(VOORBEELD_VERKOOP.reduce((s, r) => s + btwVan(r.exBtw, r.btwTarief), 0));
  const verwerkt = VOORBEELD_INKOOP.filter((r) => r.status === "verwerkt");
  const kostenEx = round2(verwerkt.reduce((s, r) => s + r.exBtw, 0));
  const voorbelasting = round2(verwerkt.reduce((s, r) => s + btwVan(r.exBtw, r.btwTarief), 0));
  return {
    omzetEx,
    kostenEx,
    btwVerschuldigd,
    voorbelasting,
    saldo: round2(btwVerschuldigd - voorbelasting),
    verwerkteInkoop: verwerkt.length,
    openVragen: VOORBEELD_INKOOP.filter((r) => r.status === "vraag").length,
  };
}
