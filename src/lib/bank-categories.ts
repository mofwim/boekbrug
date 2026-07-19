// src/lib/bank-categories.ts
// [BANK-IDENTITY] The ONE source of truth for the bank-transaction category
// vocabulary. Before this module the same list lived — and DISAGREED — in four
// places (bank-identity.ts, the categorize API route, the categorise UI client, and
// the result engine). That drift is exactly how a category silently vanishes from a
// money total. Everything category-shaped now imports from here.
//
// Two things a category answers:
//   1. What can the owner pick?  → SELECTABLE_CATEGORIES (with Dutch labels)
//   2. Where does it land in the P&L?  → PNL_ROLE (revenue / cost / excluded)
//
// The auto-detection identities themselves (how a raw bank line is classified) stay
// in bank-identity.ts; this module is the confirmed, storable vocabulary that sits on
// top of them and the single mapping into the financial result.

import type { TxIdentity } from "./bank-identity";

// The category stored on a transaction / in counterpart memory. It is the union of
// the auto-detectable identities that are meaningful to keep (transfer, tax, prive,
// pos_income, fee) and the two business classifications the owner assigns to the rest
// (kosten, omzet). 'unknown' is a transient classifier state, never a stored
// category, so it is intentionally NOT part of this vocabulary.
export type BankCategory = Exclude<TxIdentity, "unknown"> | "kosten" | "omzet";

export interface SelectableCategory {
  key: BankCategory;
  label: string; // Dutch, shown as a chip in the categorise UI
}

// Every category the owner may confirm on a bank line. This is the UNION of what the
// API previously allowed (kosten, omzet, prive, transfer, tax, fee, pos_income) and
// what the UI previously showed (kosten, prive, transfer, tax, omzet) — so nothing
// that was ever selectable is lost. Revenue first, then costs, then the non-P&L ones.
export const SELECTABLE_CATEGORIES: readonly SelectableCategory[] = [
  { key: "omzet", label: "Omzet" },
  { key: "pos_income", label: "Pinomzet" },
  { key: "kosten", label: "Zakelijke kost" },
  { key: "fee", label: "Bankkosten" },
  { key: "prive", label: "Privé" },
  { key: "transfer", label: "Overboeking" },
  { key: "tax", label: "Belasting" },
] as const;

// The set of accepted category keys — derive it from the list so it can never drift.
export const ALLOWED_CATEGORIES: ReadonlySet<BankCategory> = new Set(
  SELECTABLE_CATEGORIES.map((c) => c.key),
);

// Where a category lands in the profit & loss:
//   'omzet'    → revenue (net; a bare bank line carries no BTW document, so it moves
//                the net total only — pos_income is takings, so it belongs here too)
//   'kosten'   → cost (net) — includes 'fee' (bankkosten), see below
//   'excluded' → never touches revenue/cost/BTW (transfer, prive, tax)
export type PnlRole = "omzet" | "kosten" | "excluded";

export const PNL_ROLE: Record<BankCategory, PnlRole> = {
  omzet: "omzet",
  pos_income: "omzet", // M-5: card-terminal / PSP takings ARE revenue — was dropped
  kosten: "kosten",
  // [BANKKOSTEN-DEDUCTIBLE] Dutch bank charges (account fees, transaction/PIN fees, iDEAL/
  // acquirer bank costs) are a REAL, deductible business cost. Excluding them systematically
  // OVERSTATED profit. They are VAT-EXEMPT (vrijstelling betalingsverkeer, art. 11 lid 1-i Wet
  // OB) → booked as a NET cost with €0 voorbelasting (the financial engine writes no BTW for a
  // bare bank line, so this is automatic). NO double-count with the card-settlement triangle:
  // the triangle derives the acquirer COMMISSION only from 'pos_income' settlement lines, and
  // the classifier makes 'pos_income' and 'fee' disjoint — a 'fee' line never enters the
  // triangle's bank-net, so counting it as cost here books each euro exactly once.
  fee: "kosten",
  transfer: "excluded",
  prive: "excluded",
  tax: "excluded",
};

// The P&L role for any stored category value (which arrives as a plain string). An
// unrecognised / null value has no role, so callers skip it rather than guess.
export function pnlRole(category: string | null | undefined): PnlRole | undefined {
  if (!category) return undefined;
  return PNL_ROLE[category as BankCategory];
}
