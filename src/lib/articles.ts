// src/lib/articles.ts
// [ARTIKELEN] Pure helpers for the line-item catalog (gateway #1): input validation and
// the picker match/rank. No I/O — the API routes and the invoice UI call these, so the
// rules live in one tested place. Run: npx tsx src/lib/articles.test.ts

// [SMART-FILTER] foldText lives in one place (src/lib/search.ts) so every search box
// folds accents identically; re-exported here because consumers import it from this module.
import { foldText } from "./search";
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

const VALID_RATES = new Set([0, 9, 21]);

/**
 * Validate + coerce raw article input (from a form / JSON body) into a clean ArticleInput.
 * Dutch error messages. description is required; btw_rate must be a real NL rate (0/9/21);
 * unit_price ≥ 0; code/unit are trimmed to null when empty so the UNIQUE(user, code) index
 * treats "no code" as NULL (many allowed) rather than "" (one allowed).
 */
export function normalizeArticleInput(raw: unknown): NormalizeResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Ongeldige gegevens." };
  const r = raw as Record<string, unknown>;

  const description = typeof r.description === "string" ? r.description.trim() : "";
  if (!description) return { ok: false, error: "Omschrijving is verplicht." };

  const priceNum = typeof r.unit_price === "number" ? r.unit_price : Number(r.unit_price);
  if (!Number.isFinite(priceNum) || priceNum < 0) return { ok: false, error: "Prijs moet 0 of hoger zijn." };
  const unit_price = Math.round(priceNum * 100) / 100;

  const rateNum = typeof r.btw_rate === "number" ? r.btw_rate : Number(r.btw_rate);
  if (!VALID_RATES.has(rateNum)) return { ok: false, error: "BTW-tarief moet 0%, 9% of 21% zijn." };

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
