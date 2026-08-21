// src/lib/articles.ts
// [ARTIKELEN] Pure helpers for the line-item catalog (gateway #1): input validation and
// the picker match/rank. No I/O — the API routes and the invoice UI call these, so the
// rules live in one tested place. Run: npx tsx src/lib/articles.test.ts

// [SMART-FILTER] foldText lives in one place (src/lib/search.ts) so every search box
// folds accents identically; re-exported here because consumers import it from this module.
import { foldText } from "./search";
import { round2, isValidBtwRate } from "./invoice-totals";
// [PRIJS-MODUS] The one conversion, shared with both invoice screens. A second one here would be a
// second answer to "what is € 0,90 all-in, exactly", and the two would drift on the cent.
import { exFromIncl, type PriceMode } from "./price-mode";
export { foldText };

export interface Article {
  id: string;
  code: string | null;
  description: string;
  unit_price: number;
  btw_rate: number;
  unit: string | null;
  active: boolean;
  usage_count: number;
}

export interface ArticleInput {
  code: string | null;
  description: string;
  unit_price: number;
  btw_rate: number;
  unit: string | null;
}

export type NormalizeResult =
  | { ok: true; value: ArticleInput }
  | { ok: false; error: string };


/**
 * Validate + coerce raw article input (from a form / JSON body) into a clean ArticleInput.
 * Dutch error messages. description is required; btw_rate must be a real NL rate (0/9/21);
 * unit_price ≥ 0; code/unit are trimmed to null when empty so the UNIQUE(user, code) index
 * treats "no code" as NULL (many allowed) rather than "" (one allowed).
 *
 * [PRIJS-MODUS] `price_mode` says WHICH price was typed — "excl" (the default, and what every
 * caller before this sent) or "incl". It is an INPUT STAND, never a storage format: unit_price
 * stays the ex-btw price in both cases, exactly like invoice_lines.unit_price, because everything
 * downstream reads ex — the aangifte's rate split, the PDF, the closing package, the export to the
 * accountant. See the header of price-mode.ts; this is the same conversion the invoice screens use,
 * imported rather than repeated so the catalogue and the line cannot disagree about one price.
 */
export function normalizeArticleInput(raw: unknown): NormalizeResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Ongeldige gegevens." };
  const r = raw as Record<string, unknown>;

  const description = typeof r.description === "string" ? r.description.trim() : "";
  if (!description) return { ok: false, error: "Omschrijving is verplicht." };

  const priceNum = typeof r.unit_price === "number" ? r.unit_price : Number(r.unit_price);
  if (!Number.isFinite(priceNum) || priceNum < 0) return { ok: false, error: "Prijs moet 0 of hoger zijn." };

  // The rate is validated BEFORE the price is converted, and that order is not cosmetic: an
  // incl-price cannot be divided by a rate we have refused. Reading it first would convert with
  // whatever Number() made of the junk — 21 from "21%", NaN from "eenentwintig" — and store a
  // price nobody typed.
  // [BTW-TARIEF] isValidBtwRate, not a local `new Set([0, 9, 21])` behind `Number(...)`. That
  // naive form was here, and it had the exact bug invoice-totals.ts documents at length: `Number(null)` and `Number("")` are
  // both 0, and 0 IS a real rate (vrijgesteld/verlegd) — so an article saved with a MISSING rate
  // was silently filed as 0%. Measured before the fix: `{ btw_rate: null }` → accepted, stored at
  // 0%, and every invoice line drawn from that article then carries no btw at all.
  //
  // In incl-modus it is worse than a wrong label: at "0%" the price is not divided either, so
  // € 12,10 all-in is stored as € 12,10 ex and the customer is billed € 14,64. A missing rate has
  // to be a question, never a guess.
  if (!isValidBtwRate(r.btw_rate)) return { ok: false, error: "BTW-tarief moet 0%, 9% of 21% zijn." };
  const rateNum = Number(r.btw_rate);

  // [PRIJS-MODUS][CENT] In excl-modus: exactly what it did before, rounded to cents.
  //
  // In incl-modus the stored ex-price is deliberately NOT rounded, and that is the whole point.
  // € 0,90 all-in at 9% is € 0,8256880734…, and storing € 0,83 is a DIFFERENT price: 150 × 0,83 is
  // € 124,50 ex — € 135,71 incl — where the owner promised 150 × € 0,90 = € 135,00. Measured on
  // invoice 20260001; the same four rows are written out in the header of price-mode.ts.
  //
  // articles.unit_price is an unconstrained `numeric` (articles.sql), the same type
  // invoice_lines.unit_price uses, so the fraction survives being stored. unitPriceDecimals is
  // what turns it back into a price a human reads.
  const mode: PriceMode = r.price_mode === "incl" ? "incl" : "excl";
  const unit_price = mode === "incl" ? exFromIncl(priceNum, rateNum) : round2(priceNum);

  const codeRaw = typeof r.code === "string" ? r.code.trim() : "";
  const unitRaw = typeof r.unit === "string" ? r.unit.trim() : "";

  return {
    ok: true,
    value: { code: codeRaw || null, description, unit_price, btw_rate: rateNum, unit: unitRaw || null },
  };
}

/**
 * Rank a catalog for the invoice-line picker against a query. An exact code match wins
 * ("22" → that article first); then code prefix; then description substring. Case- and
 * space-insensitive. Archived (inactive) articles are excluded. An empty query returns the
 * most-used actives first (usage_count desc) so the picker is useful before typing.
 */
export function matchArticles(articles: Article[], query: string, limit = 8): Article[] {
  const actives = articles.filter((a) => a.active);
  const q = foldText(query.trim());
  if (!q) {
    return [...actives].sort((a, b) => b.usage_count - a.usage_count).slice(0, limit);
  }
  const scored = actives
    .map((a) => {
      const code = foldText(a.code ?? "");
      const desc = foldText(a.description);
      let score = -1;
      if (code && code === q) score = 100;
      else if (code && code.startsWith(q)) score = 80;
      else if (desc.includes(q)) score = 40 + Math.min(20, a.usage_count);
      else if (code && code.includes(q)) score = 30;
      return { a, score };
    })
    .filter((s) => s.score >= 0)
    .sort((x, y) => y.score - x.score || y.a.usage_count - x.a.usage_count);
  return scored.slice(0, limit).map((s) => s.a);
}
