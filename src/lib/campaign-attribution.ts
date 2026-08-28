// src/lib/campaign-attribution.ts
// [HERKOMST] Where a visit came from, kept alive long enough to reach the signup.
//
// The funnel it serves: someone clicks a tagged link, lands on /factuur-maken/<vak>, spends five
// minutes on an invoice, downloads it, clicks through to /register, confirms an e-mail, and only
// THEN becomes a user. The utm_* parameters were on the first URL and nowhere afterwards, so the
// event that finally matters — register_completed — is the one event that no longer knows where
// the person came from. Storing them on arrival is what makes the last step attributable.
//
// WHY localStorage AND SEVEN DAYS. Same reason as factuur-handoff.ts, and deliberately the same
// numbers: registration has a confirmation mail in the middle of it, and that mail opens in a new
// tab or another browser for a lot of people. sessionStorage would drop exactly the visitor who
// did it properly. Seven days covers signup plus a mail plus a night's thought; after that a stale
// campaign would start crediting a click nobody made, which is worse than no attribution at all.
//
// FIRST TOUCH WINS. A visit that arrives tagged and later passes an untagged URL keeps its
// original source: overwriting on every navigation would credit whichever internal page happened
// to be last, which is nobody's campaign.
//
// WHAT THIS DOES NOT DO. It never reads document.referrer to guess a search term. Google strips
// the query from the referrer, so anything recovered that way is either empty or a guess dressed
// as data; search terms come from Search Console, which is the only place that has them.
//
// Pure + node-testbaar (run: npx tsx --test src/lib/campaign-attribution.test.ts).

/** The same minimal storage shape factuur-handoff.ts uses, so both stay testable without a browser. */
export interface AttributionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ATTRIBUTION_KEY = "boekbrug.herkomst";
export const ATTRIBUTION_TTL_DAYS = 7;

/** The four utm_* keys worth keeping. utm_term is absent on purpose: see the header. */
export interface Attribution {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  savedAt: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 64) : "");

/** Read utm_* out of a querystring. Returns null when the link carried no campaign at all. */
export function parseAttribution(search: string | URLSearchParams): Omit<Attribution, "savedAt"> | null {
  const p = typeof search === "string" ? new URLSearchParams(search) : search;
  const found = {
    source: str(p.get("utm_source")),
    medium: str(p.get("utm_medium")),
    campaign: str(p.get("utm_campaign")),
    content: str(p.get("utm_content")),
  };
  // A link with only utm_content and no source is noise, not a campaign.
  return found.source || found.medium || found.campaign ? found : null;
}

/**
 * Store the campaign of THIS visit, unless one is already stored — first touch wins.
 * Returns what is now stored, so the caller can attach it to an event straight away.
 */
export function rememberAttribution(
  storage: AttributionStorage,
  search: string | URLSearchParams,
  now: Date = new Date(),
): Attribution | null {
  const existing = readAttribution(storage, now);
  if (existing) return existing;

  const fresh = parseAttribution(search);
  if (!fresh) return null;

  const record: Attribution = { ...fresh, savedAt: now.toISOString() };
  try {
    storage.setItem(ATTRIBUTION_KEY, JSON.stringify(record));
  } catch {
    // Storage full or blocked. The visit is still attributable for as long as this page lives;
    // it just will not survive the confirmation mail. Not worth an error a visitor would see.
    return record;
  }
  return record;
}

/** The stored campaign, or null when there is none or it has expired. */
export function readAttribution(
  storage: AttributionStorage,
  now: Date = new Date(),
): Attribution | null {
  let raw: string | null;
  try {
    raw = storage.getItem(ATTRIBUTION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const p = parsed as Record<string, unknown>;
  const savedAt = typeof p.savedAt === "string" ? p.savedAt : "";
  const savedMs = Date.parse(savedAt);
  if (!Number.isFinite(savedMs)) return null;

  const ageDays = (now.getTime() - savedMs) / 86_400_000;
  // A record from the future means a moved system clock — as suspect as an expired one.
  if (ageDays > ATTRIBUTION_TTL_DAYS || ageDays < -1) return null;

  const record: Attribution = {
    source: str(p.source),
    medium: str(p.medium),
    campaign: str(p.campaign),
    content: str(p.content),
    savedAt,
  };
  return record.source || record.medium || record.campaign ? record : null;
}

/** Forget the stored campaign. */
export function clearAttribution(storage: AttributionStorage): void {
  try {
    storage.removeItem(ATTRIBUTION_KEY);
  } catch {
    /* nothing to do */
  }
}
