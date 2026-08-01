// src/lib/gocardless-client.ts
// [GOCARDLESS] Client for the GoCardless Bank Account Data API (v2, formerly Nordigen).
//
// Why this link exists: until now a bank statement only entered BoekBrug because the owner
// exported an MT940/CAMT file from his bank and uploaded it. That is the single step people
// forget, and every downstream promise (matched invoices, a complete kwartaal, an accountant
// who sees the whole money line) silently degrades when a month is never uploaded. This is the
// PSD2 road: the bank hands us the transactions directly, once the owner has consented at his
// own bank.
//
// ── The four-step dance (all under https://bankaccountdata.gocardless.com/api/v2) ────────────
//   1. POST /token/new/          {secret_id, secret_key} → {access, access_expires, refresh, refresh_expires}
//   2. GET  /institutions/?country=nl                    → the banks we may offer
//   3. POST /agreements/enduser/ {institution_id, max_historical_days, access_valid_for_days,
//                                 access_scope}          → the consent the owner is about to give
//      POST /requisitions/       {institution_id, agreement, redirect, reference, user_language}
//                                                        → {id, link}; we send the owner to `link`
//   4. GET  /requisitions/{id}/                          → status LN + the account ids
//      GET  /accounts/{id}/transactions/?date_from=&date_to=
//
// ── Two hard limits that shape the design ────────────────────────────────────────────────────
//   · RATE LIMIT. Each access scope (details/balances/transactions) may be called only a
//     handful of times per DAY per account (GoCardless narrowed this to 10/day in Aug 2024 and
//     documents an intent to reach 4/day). So this client is built to be called RARELY and to
//     report a 429 as a first-class, non-alarming outcome — never to retry into the wall. The
//     sync layer above is what enforces "at most once per day per account".
//   · CONSENT EXPIRY. An end-user agreement lasts at most `access_valid_for_days` (90 by the
//     PSD2 default). After that the bank refuses and the owner must re-consent. That is not an
//     error in our code; it is a fact of the regulation, and the UI has to say so in time.
//
// Everything touching the network lives HERE. The shape translation (a Berlin Group JSON
// transaction → our BankTransaction) is pure and lives in gocardless-map.ts, so the rules that
// decide money-truth stay testable without a socket.

import { createHash } from "crypto";

export const GOCARDLESS_API_BASE = "https://bankaccountdata.gocardless.com/api/v2";

/** Never hand out a token that expires mid-flight. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

/**
 * PSD2's default consent window. GoCardless caps `access_valid_for_days` at 90 for most banks
 * (some now allow 180); we ask for the default and let the API lower it rather than guessing
 * per institution.
 */
export const DEFAULT_ACCESS_VALID_FOR_DAYS = 90;

/**
 * How much history to request. Banks differ (`transaction_total_days` on the institution says
 * what THIS bank allows); we ask for the institution's own maximum, capped here so a bank that
 * reports something absurd cannot make us request years we would only throw away.
 */
export const MAX_HISTORICAL_DAYS_CAP = 730;

/** The scopes we need. `balances` is included so the owner's saldo can be shown next to the
 *  transactions; `details` gives us the IBAN + account holder for the connection card. */
export const ACCESS_SCOPE = ["balances", "details", "transactions"] as const;

// ─── Errors ───────────────────────────────────────────────────────────────────────────────────

export type GoCardlessErrorCode =
  | "NOT_CONFIGURED" // our own secret_id/secret_key are missing from the environment
  | "INVALID_CREDENTIALS" // 401 — our secrets were rejected/rotated
  | "FORBIDDEN" // 403 — authenticated but not allowed (plan/scope)
  | "RATE_LIMITED" // 429 — the daily per-account budget is spent; retryAfterSeconds says when
  | "CONSENT_EXPIRED" // the end-user agreement ran out — the owner must reconnect his bank
  | "ACCOUNT_SUSPENDED" // GoCardless suspended the account after repeated failures
  | "VALIDATION" // 400/422 — we asked something the API refuses
  | "NOT_FOUND" // 404
  | "SERVER" // 5xx on their side
  | "NETWORK"; // the request never completed

export class GoCardlessError extends Error {
  readonly code: GoCardlessErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  /** Truncated raw body — for logs and the error trail on the connection row. Never a token:
   *  tokens travel in request headers, never in a response body. */
  readonly details?: string;

  constructor(
    code: GoCardlessErrorCode,
    message: string,
    opts?: { status?: number; retryAfterSeconds?: number; details?: string },
  ) {
    super(message);
    this.name = "GoCardlessError";
    this.code = code;
    this.status = opts?.status;
    this.retryAfterSeconds = opts?.retryAfterSeconds;
    this.details = opts?.details;
  }
}

/** Dutch text for the owner. The Error.message itself stays technical, for logs. */
export function dutchGoCardlessError(code: GoCardlessErrorCode): string {
  switch (code) {
    case "NOT_CONFIGURED":
      return "De bankkoppeling is nog niet ingesteld op de server. Je kunt je afschrift wel gewoon uploaden.";
    case "INVALID_CREDENTIALS":
      return "De bankkoppeling kan zich niet aanmelden. Neem contact op met support — je kunt intussen je afschrift uploaden.";
    case "FORBIDDEN":
      return "De bank geeft geen toegang tot deze gegevens.";
    case "RATE_LIMITED":
      return "Je bank staat een beperkt aantal opvragingen per dag toe, en dat aantal is voor vandaag bereikt. Morgen haalt BoekBrug automatisch de rest op.";
    case "CONSENT_EXPIRED":
      return "Je toestemming voor deze bankkoppeling is verlopen. Banken mogen die maximaal 90 dagen laten staan — koppel je bank opnieuw om verder te gaan.";
    case "ACCOUNT_SUSPENDED":
      return "De bank heeft deze koppeling stilgezet. Koppel je bank opnieuw.";
    case "VALIDATION":
      return "De bank wees dit verzoek af. Probeer opnieuw te koppelen.";
    case "NOT_FOUND":
      return "Deze bankkoppeling bestaat niet meer. Koppel je bank opnieuw.";
    case "SERVER":
      return "De bankkoppeling is tijdelijk niet bereikbaar. Probeer het later opnieuw.";
    case "NETWORK":
      return "Geen verbinding met de bankkoppeling. Probeer het later opnieuw.";
  }
}

/**
 * Translate an HTTP status into our code. One place, so every caller judges "must the owner
 * reconnect?" (401/403) the same way as "try again later" (429/5xx).
 */
export function classifyStatus(status: number): GoCardlessErrorCode {
  if (status === 401) return "INVALID_CREDENTIALS";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER";
  return "VALIDATION";
}

/**
 * GoCardless answers an expired/revoked consent with a 4xx whose BODY carries the reason, not
 * with a distinct status. Reading the body is therefore the only way to tell "reconnect your
 * bank" (a thing the owner must act on) apart from "we sent something wrong" (our bug).
 *
 * Deliberately narrow: only the documented consent/suspension summaries promote the code. An
 * unrecognised body keeps whatever the status said, so a future message can never silently
 * turn a real validation bug into a "reconnect your bank" nudge the owner cannot act on.
 */
export function refineErrorCode(
  fromStatus: GoCardlessErrorCode,
  body: string | undefined,
): GoCardlessErrorCode {
  if (!body) return fromStatus;
  const text = body.toLowerCase();
  if (text.includes("expired") && (text.includes("consent") || text.includes("access"))) {
    return "CONSENT_EXPIRED";
  }
  if (text.includes("suspended")) return "ACCOUNT_SUSPENDED";
  return fromStatus;
}

// ─── Token cache ──────────────────────────────────────────────────────────────────────────────
//
// The access token lives 24 hours and the refresh token 30 days. A serverless instance that
// syncs forty accounts in one cron run must not fetch forty tokens: besides the latency, the
// token endpoint has its own rate limit and burning it would take down every user's sync.

interface CachedTokens {
  access: string;
  accessExpiresAtMs: number;
  refresh: string | null;
  refreshExpiresAtMs: number;
}

const TOKEN_CACHE = new Map<string, CachedTokens>();

/** Cache key = hash of the credential pair. The secret is never itself a map key: hashing is
 *  free and keeps it out of heap dumps and error messages. */
function cacheKey(secretId: string, secretKey: string): string {
  return createHash("sha256").update(`${secretId} ${secretKey}`).digest("hex");
}

/** For tests, and for the moment credentials are rotated: a dead secret must not leave a live
 *  token behind in this instance. */
export function clearGoCardlessTokenCache(): void {
  TOKEN_CACHE.clear();
}

// ─── Shapes we read back ──────────────────────────────────────────────────────────────────────
//
// Deliberately minimal and defensive. The API returns far more than this and may add fields at
// any time; we read only what we use, and never assume a field is present.

export interface GoCardlessInstitution {
  id: string;
  name: string;
  bic: string | null;
  /** How many days of history THIS bank exposes. Drives max_historical_days on the agreement. */
  transactionTotalDays: number | null;
  logo: string | null;
}

export interface GoCardlessRequisition {
  id: string;
  status: string;
  institutionId: string | null;
  /** The URL the owner must visit to consent at his own bank. Present right after creation. */
  link: string | null;
  /** GoCardless account ids — filled once status is LN (LINKED). */
  accounts: string[];
  reference: string | null;
}

export interface GoCardlessAccountDetails {
  iban: string | null;
  currency: string | null;
  ownerName: string | null;
  name: string | null;
  product: string | null;
  bic: string | null;
}

export interface GoCardlessBalance {
  amount: number | null;
  currency: string | null;
  balanceType: string | null;
  referenceDate: string | null;
}

/**
 * One Berlin Group transaction, exactly as the API hands it over. Every field is optional
 * because every field genuinely is: the documented example has a debit line with no creditor
 * name and no transactionId at all. Interpreting this is gocardless-map.ts's job, not ours.
 */
export interface GoCardlessRawTransaction {
  transactionId?: string | null;
  internalTransactionId?: string | null;
  entryReference?: string | null;
  endToEndId?: string | null;
  mandateId?: string | null;
  bookingDate?: string | null;
  valueDate?: string | null;
  bookingDateTime?: string | null;
  valueDateTime?: string | null;
  transactionAmount?: { amount?: string | number | null; currency?: string | null } | null;
  creditorName?: string | null;
  creditorAccount?: { iban?: string | null } | null;
  debtorName?: string | null;
  debtorAccount?: { iban?: string | null } | null;
  remittanceInformationUnstructured?: string | null;
  remittanceInformationUnstructuredArray?: string[] | null;
  remittanceInformationStructured?: string | null;
  remittanceInformationStructuredArray?: string[] | null;
  additionalInformation?: string | null;
  proprietaryBankTransactionCode?: string | null;
  bankTransactionCode?: string | null;
}

export interface GoCardlessTransactions {
  booked: GoCardlessRawTransaction[];
  /** Read but NOT imported by the sync: a pending line has no final amount or date and would
   *  import a second time the moment it books. See gocardless-sync.ts. */
  pending: GoCardlessRawTransaction[];
}

// ─── Client ───────────────────────────────────────────────────────────────────────────────────

export interface GoCardlessClientOptions {
  secretId?: string;
  secretKey?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests (token expiry). */
  now?: () => number;
}

export interface GoCardlessClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
  getInstitutions(country: string): Promise<GoCardlessInstitution[]>;
  createAgreement(args: {
    institutionId: string;
    maxHistoricalDays: number;
    accessValidForDays?: number;
  }): Promise<{ id: string; accessValidForDays: number; maxHistoricalDays: number }>;
  createRequisition(args: {
    institutionId: string;
    redirect: string;
    reference: string;
    agreementId?: string | null;
    userLanguage?: string;
  }): Promise<GoCardlessRequisition>;
  getRequisition(id: string): Promise<GoCardlessRequisition>;
  deleteRequisition(id: string): Promise<void>;
  getAccountDetails(accountId: string): Promise<GoCardlessAccountDetails>;
  getAccountBalances(accountId: string): Promise<GoCardlessBalance[]>;
  getAccountTransactions(
    accountId: string,
    range?: { dateFrom?: string | null; dateTo?: string | null },
  ): Promise<GoCardlessTransactions>;
}

/** True when the server is configured for the bank link at all. Lets the UI hide the card
 *  instead of offering a button that can only fail. */
export function isGoCardlessConfigured(): boolean {
  return Boolean(process.env.GOCARDLESS_SECRET_ID && process.env.GOCARDLESS_SECRET_KEY);
}

function readCredentials(opts: GoCardlessClientOptions): { secretId: string; secretKey: string } {
  const secretId = opts.secretId ?? process.env.GOCARDLESS_SECRET_ID;
  const secretKey = opts.secretKey ?? process.env.GOCARDLESS_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new GoCardlessError(
      "NOT_CONFIGURED",
      "GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY missing from the environment",
    );
  }
  return { secretId, secretKey };
}

export function createGoCardlessClient(opts: GoCardlessClientOptions = {}): GoCardlessClient {
  const { secretId, secretKey } = readCredentials(opts);
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const key = cacheKey(secretId, secretKey);

  async function fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, init);
    } catch (err) {
      throw new GoCardlessError("NETWORK", `Request to GoCardless failed: ${String(err)}`);
    }
  }

  /** POST /token/new/ — exchanges our two secrets for an access + refresh token pair. */
  async function newTokens(): Promise<CachedTokens> {
    const res = await fetchOrThrow(`${GOCARDLESS_API_BASE}/token/new/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ secret_id: secretId, secret_key: secretKey }),
    });

    if (!res.ok) {
      const details = await safeText(res);
      // A rejected credential pair answers 401, but the endpoint also answers 400 on a
      // malformed pair. Both mean the same thing for us: these secrets cannot be used.
      const code: GoCardlessErrorCode =
        res.status >= 500 ? "SERVER" : res.status === 429 ? "RATE_LIMITED" : "INVALID_CREDENTIALS";
      throw new GoCardlessError(code, `Token request failed (${res.status})`, {
        status: res.status,
        retryAfterSeconds: retryAfter(res),
        details,
      });
    }

    const json = (await safeJson(res)) as {
      access?: string;
      access_expires?: number;
      refresh?: string;
      refresh_expires?: number;
    } | null;

    if (!json?.access) {
      throw new GoCardlessError("INVALID_CREDENTIALS", "GoCardless returned no access token");
    }

    // Documented lifetimes: access 24h, refresh 30d. Fall back to those when the field is absent
    // rather than treating a missing number as "expires now" (which would refetch every call).
    const accessTtl = (typeof json.access_expires === "number" ? json.access_expires : 86_400) * 1000;
    const refreshTtl =
      (typeof json.refresh_expires === "number" ? json.refresh_expires : 2_592_000) * 1000;

    return {
      access: json.access,
      accessExpiresAtMs: now() + accessTtl,
      refresh: json.refresh ?? null,
      refreshExpiresAtMs: now() + refreshTtl,
    };
  }

  /** POST /token/refresh/ — cheaper than a full exchange, and the documented way to stay under
   *  the token endpoint's own limit. Returns null when the refresh token is no longer accepted,
   *  so the caller falls back to a full exchange instead of failing the whole sync. */
  async function refreshTokens(refresh: string): Promise<CachedTokens | null> {
    const res = await fetchOrThrow(`${GOCARDLESS_API_BASE}/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return null;

    const json = (await safeJson(res)) as { access?: string; access_expires?: number } | null;
    if (!json?.access) return null;

    const accessTtl = (typeof json.access_expires === "number" ? json.access_expires : 86_400) * 1000;
    const cached = TOKEN_CACHE.get(key);
    return {
      access: json.access,
      accessExpiresAtMs: now() + accessTtl,
      // The refresh token itself is unchanged by a refresh — keep it and its own expiry.
      refresh,
      refreshExpiresAtMs: cached?.refreshExpiresAtMs ?? now() + 2_592_000_000,
    };
  }

  async function ensureToken(): Promise<string> {
    const cached = TOKEN_CACHE.get(key);
    if (cached && cached.accessExpiresAtMs - TOKEN_EXPIRY_MARGIN_MS > now()) {
      return cached.access;
    }

    if (cached?.refresh && cached.refreshExpiresAtMs - TOKEN_EXPIRY_MARGIN_MS > now()) {
      const refreshed = await refreshTokens(cached.refresh);
      if (refreshed) {
        TOKEN_CACHE.set(key, refreshed);
        return refreshed.access;
      }
      // Refresh rejected — fall through to a full exchange rather than failing here.
    }

    const fresh = await newTokens();
    TOKEN_CACHE.set(key, fresh);
    return fresh.access;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await ensureToken();
    const url = path.startsWith("http") ? path : `${GOCARDLESS_API_BASE}${path}`;

    const res = await fetchOrThrow(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (res.status === 401) {
      // Token expired early or our secrets were rotated. Dropping the cached pair is essential:
      // otherwise every remaining account in this cron run breaks on the same dead token.
      TOKEN_CACHE.delete(key);
    }

    if (!res.ok) {
      const details = await safeText(res);
      const code = refineErrorCode(classifyStatus(res.status), details);
      throw new GoCardlessError(code, `GoCardless ${method} ${path} → ${res.status}`, {
        status: res.status,
        retryAfterSeconds: retryAfter(res),
        details,
      });
    }

    if (res.status === 204) return null as T;
    return ((await safeJson(res)) ?? null) as T;
  }

  return {
    request,

    async getInstitutions(country) {
      // The API expects a two-letter country code; it is case-insensitive but documented lower.
      const raw = await request<unknown>(
        "GET",
        `/institutions/?country=${encodeURIComponent(country.toLowerCase())}`,
      );
      return normalizeInstitutions(raw);
    },

    async createAgreement({ institutionId, maxHistoricalDays, accessValidForDays }) {
      const created = await request<{
        id?: string;
        access_valid_for_days?: number;
        max_historical_days?: number;
      }>("POST", "/agreements/enduser/", {
        institution_id: institutionId,
        max_historical_days: maxHistoricalDays,
        access_valid_for_days: accessValidForDays ?? DEFAULT_ACCESS_VALID_FOR_DAYS,
        access_scope: [...ACCESS_SCOPE],
      });
      if (!created?.id) {
        throw new GoCardlessError("VALIDATION", "GoCardless returned no agreement id");
      }
      return {
        id: created.id,
        // Read back what the API GRANTED, not what we asked for: a bank may cap the window
        // lower, and the expiry date we show the owner has to be the real one.
        accessValidForDays: created.access_valid_for_days ?? accessValidForDays ?? DEFAULT_ACCESS_VALID_FOR_DAYS,
        maxHistoricalDays: created.max_historical_days ?? maxHistoricalDays,
      };
    },

    async createRequisition({ institutionId, redirect, reference, agreementId, userLanguage }) {
      const created = await request<unknown>("POST", "/requisitions/", {
        institution_id: institutionId,
        redirect,
        reference,
        ...(agreementId ? { agreement: agreementId } : {}),
        // Dutch consent screens for a Dutch product. The bank's own screen decides in the end.
        user_language: userLanguage ?? "NL",
      });
      const req = normalizeRequisition(created);
      if (!req.id) throw new GoCardlessError("VALIDATION", "GoCardless returned no requisition id");
      return req;
    },

    async getRequisition(id) {
      const raw = await request<unknown>("GET", `/requisitions/${encodeURIComponent(id)}/`);
      return normalizeRequisition(raw);
    },

    async deleteRequisition(id) {
      await request<unknown>("DELETE", `/requisitions/${encodeURIComponent(id)}/`);
    },

    async getAccountDetails(accountId) {
      const raw = await request<{ account?: Record<string, unknown> }>(
        "GET",
        `/accounts/${encodeURIComponent(accountId)}/details/`,
      );
      return normalizeAccountDetails(raw?.account ?? null);
    },

    async getAccountBalances(accountId) {
      const raw = await request<{ balances?: unknown }>(
        "GET",
        `/accounts/${encodeURIComponent(accountId)}/balances/`,
      );
      return normalizeBalances(raw?.balances);
    },

    async getAccountTransactions(accountId, range) {
      const params = new URLSearchParams();
      if (range?.dateFrom) params.set("date_from", range.dateFrom);
      if (range?.dateTo) params.set("date_to", range.dateTo);
      const qs = params.toString();
      const raw = await request<{ transactions?: { booked?: unknown; pending?: unknown } }>(
        "GET",
        `/accounts/${encodeURIComponent(accountId)}/transactions/${qs ? `?${qs}` : ""}`,
      );
      return {
        booked: asTransactionArray(raw?.transactions?.booked),
        pending: asTransactionArray(raw?.transactions?.pending),
      };
    },
  };
}

// ─── Response normalisation ───────────────────────────────────────────────────────────────────
//
// Exported and pure, so the tests can pin these shape translations without a socket.

export function normalizeInstitutions(raw: unknown): GoCardlessInstitution[] {
  if (!Array.isArray(raw)) return [];
  const out: GoCardlessInstitution[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== "string" || !rec.id) continue;
    const daysRaw = rec.transaction_total_days;
    const days = typeof daysRaw === "string" ? Number(daysRaw) : daysRaw;
    out.push({
      id: rec.id,
      name: typeof rec.name === "string" ? rec.name : rec.id,
      bic: typeof rec.bic === "string" ? rec.bic : null,
      transactionTotalDays: typeof days === "number" && Number.isFinite(days) ? days : null,
      logo: typeof rec.logo === "string" ? rec.logo : null,
    });
  }
  return out;
}

export function normalizeRequisition(raw: unknown): GoCardlessRequisition {
  const rec = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const accounts = Array.isArray(rec.accounts)
    ? rec.accounts.filter((a): a is string => typeof a === "string" && a.length > 0)
    : [];
  return {
    id: typeof rec.id === "string" ? rec.id : "",
    status: typeof rec.status === "string" ? rec.status : "",
    institutionId: typeof rec.institution_id === "string" ? rec.institution_id : null,
    link: typeof rec.link === "string" ? rec.link : null,
    accounts,
    reference: typeof rec.reference === "string" ? rec.reference : null,
  };
}

export function normalizeAccountDetails(raw: unknown): GoCardlessAccountDetails {
  const rec = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    iban: str(rec.iban),
    currency: str(rec.currency),
    ownerName: str(rec.ownerName),
    name: str(rec.name),
    product: str(rec.product),
    bic: str(rec.bic),
  };
}

export function normalizeBalances(raw: unknown): GoCardlessBalance[] {
  if (!Array.isArray(raw)) return [];
  const out: GoCardlessBalance[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const amt = (rec.balanceAmount ?? null) as Record<string, unknown> | null;
    const rawAmount = amt?.amount;
    const parsed = typeof rawAmount === "string" ? Number(rawAmount) : rawAmount;
    out.push({
      // A non-finite balance becomes null rather than NaN: a saldo we cannot read must show as
      // unknown, never as a number that poisons a sum somewhere downstream.
      amount: typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null,
      currency: typeof amt?.currency === "string" ? amt.currency : null,
      balanceType: typeof rec.balanceType === "string" ? rec.balanceType : null,
      referenceDate: typeof rec.referenceDate === "string" ? rec.referenceDate : null,
    });
  }
  return out;
}

/**
 * Pick the balance to show. `interimAvailable` is what a bank app calls "beschikbaar saldo" and
 * is the number the owner recognises; `closingBooked` is the bookkeeping truth at end of day.
 * Prefer booked (it matches what the transactions add up to), fall back to available.
 */
export function pickDisplayBalance(balances: GoCardlessBalance[]): GoCardlessBalance | null {
  const byType = (t: string) =>
    balances.find((b) => b.balanceType?.toLowerCase() === t.toLowerCase() && b.amount !== null);
  return byType("closingBooked") ?? byType("interimBooked") ?? byType("interimAvailable") ?? balances.find((b) => b.amount !== null) ?? null;
}

function asTransactionArray(raw: unknown): GoCardlessRawTransaction[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is GoCardlessRawTransaction => Boolean(t) && typeof t === "object");
}

// ─── Small helpers ────────────────────────────────────────────────────────────────────────────

/**
 * How long until we may try again. GoCardless reports the account-scoped budget in its own
 * headers and the global one in the standard pair; `Retry-After` is not always present, so all
 * three are read and the LARGEST wait wins — undershooting just earns another 429.
 */
function retryAfter(res: Response): number | undefined {
  const candidates = [
    res.headers?.get?.("Retry-After"),
    res.headers?.get?.("HTTP_X_RATELIMIT_ACCOUNT_SUCCESS_RESET"),
    res.headers?.get?.("HTTP_X_RATELIMIT_RESET"),
    res.headers?.get?.("X-RateLimit-Reset"),
  ];
  let best: number | undefined;
  for (const raw of candidates) {
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    if (best === undefined || n > best) best = n;
  }
  return best;
}

/** Reading the body must NEVER replace the actual error — hence the safety nets. */
async function safeText(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    return text ? text.slice(0, 500) : undefined;
  } catch {
    return undefined;
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
