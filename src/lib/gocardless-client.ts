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
 * The API's own default for both `max_historical_days` and `access_valid_for_days`. Used as the
 * fallback whenever we cannot read what a specific bank allows — a value the API is guaranteed
 * to accept beats a guess that can be too high and fail the whole connect.
 */
export const API_DEFAULT_DAYS = 90;

/** PSD2's default consent window. Banks that allow longer say so in `max_access_valid_for_days`. */
export const DEFAULT_ACCESS_VALID_FOR_DAYS = API_DEFAULT_DAYS;

/**
 * The documented ceiling for a plain end-user agreement: "access_valid_for_days must be > 0 and
 * <= 180". (The schema's own maximum is 730, but that upper range needs reconfirmation, which is
 * GB-only and irrelevant to a Dutch product.)
 */
export const MAX_ACCESS_VALID_FOR_DAYS = 180;

/**
 * How much history to request. Banks differ (`transaction_total_days` on the institution says
 * what THIS bank allows); we ask for the institution's own maximum, capped here at the schema's
 * documented maximum so a bank that reports something absurd cannot make us request years we
 * would only throw away.
 */
export const MAX_HISTORICAL_DAYS_CAP = 730;

/**
 * The access we ask for, and the ladder we walk if a bank refuses it.
 *
 * We ask for what we USE and nothing more: `transactions` is the feature, `details` gives the
 * IBAN and account holder shown on the connection card. `balances` is deliberately absent —
 * nothing in this app reads a saldo, and asking an owner to hand over data we will not use is
 * over-collection, not future-proofing (see docs/legal/05_Verwerkingsregister.md).
 *
 * But the scope is not ours alone to choose. The API documents three separate refusals:
 *   · "the following scopes are required together: ['balances', 'details']"
 *   · "the following scopes are mandatory for this institution: ['transactions']"
 *   · "the access scopes supported by the institution are ['transactions']"
 * A single fixed list therefore makes some banks IMPOSSIBLE to connect — the owner picks his
 * bank, gets "koppelen mislukt", and no amount of retrying helps. So on a scope refusal we step
 * down this ladder: what we use → everything (satisfies "required together" / "mandatory") →
 * transactions only (the minimum that still makes the feature work).
 */
export const ACCESS_SCOPE_LADDER: ReadonlyArray<readonly string[]> = [
  ["details", "transactions"],
  ["balances", "details", "transactions"],
  ["transactions"],
];

/** What we ask for first. Exported for the tests and for anyone reading the consent screen. */
export const ACCESS_SCOPE = ACCESS_SCOPE_LADDER[0];

// ─── Errors ───────────────────────────────────────────────────────────────────────────────────

export type GoCardlessErrorCode =
  | "NOT_CONFIGURED" // our own secret_id/secret_key are missing from the environment
  | "INVALID_CREDENTIALS" // 401 InvalidToken / AuthenticationFailed — our secrets or token failed
  | "IP_NOT_ALLOWED" // 403 IPAccessDenied — OUR server's IP is not on the portal's whitelist
  | "QUOTA_EXCEEDED" // 402 — OUR GoCardless plan's free usage limit is spent
  | "FORBIDDEN" // 403 — authenticated but not allowed (scope, permissions)
  | "RATE_LIMITED" // 429 — the daily per-account budget is spent; retryAfterSeconds says when
  | "CONSENT_EXPIRED" // 401/403 — the end-user agreement ran out; the owner must reconnect
  | "ACCOUNT_SUSPENDED" // 409 — suspended after repeated failures; the owner must reconnect
  | "ACCOUNT_INACTIVE" // 401 — the account was deactivated or no longer exists at the bank
  | "SCOPE_UNSUPPORTED" // 400 — this institution refuses the access_scope combination we asked for
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
    // The next two are OUR misconfiguration, not the owner's. He must not be sent to his bank to
    // fix something only we can fix, so the text says plainly that it is on us.
    case "IP_NOT_ALLOWED":
      return "De bankkoppeling staat op deze server niet toegestaan. Dit ligt aan onze instellingen, niet aan jou — neem contact op met support. Je afschrift uploaden werkt gewoon.";
    case "QUOTA_EXCEEDED":
      return "De bankkoppeling heeft zijn maandlimiet bereikt. Dit ligt aan ons abonnement, niet aan jou — neem contact op met support. Je afschrift uploaden werkt gewoon.";
    case "FORBIDDEN":
      return "De bank geeft geen toegang tot deze gegevens.";
    case "RATE_LIMITED":
      return "Je bank staat een beperkt aantal opvragingen per dag toe, en dat aantal is voor vandaag bereikt. Morgen haalt BoekBrug automatisch de rest op.";
    case "CONSENT_EXPIRED":
      return "Je toestemming voor deze bankkoppeling is verlopen. Banken mogen die maximaal 90 tot 180 dagen laten staan — koppel je bank opnieuw om verder te gaan.";
    case "ACCOUNT_SUSPENDED":
      return "De bank heeft deze koppeling stilgezet na herhaalde fouten. Koppel je bank opnieuw.";
    case "ACCOUNT_INACTIVE":
      return "Deze rekening bestaat niet meer bij je bank, of is opgeheven. Koppel je bank opnieuw.";
    case "SCOPE_UNSUPPORTED":
      return "Deze bank staat de gevraagde toegang niet toe. Upload je afschrift zoals je gewend bent.";
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

/** Codes that mean the owner has to go back to his bank and consent again. One list, so the
 *  sync, the callback and the panel all agree on what "dead connection" means. */
export function needsReconnect(code: GoCardlessErrorCode): boolean {
  return code === "CONSENT_EXPIRED" || code === "ACCOUNT_SUSPENDED" || code === "ACCOUNT_INACTIVE";
}

/**
 * Translate an HTTP status into our code. One place, so every caller judges "must the owner
 * reconnect?" (401/403) the same way as "try again later" (429/5xx).
 */
export function classifyStatus(status: number): GoCardlessErrorCode {
  if (status === 401) return "INVALID_CREDENTIALS";
  if (status === 402) return "QUOTA_EXCEEDED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "ACCOUNT_SUSPENDED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER";
  return "VALIDATION";
}

/**
 * A parsed error body.
 *
 * The API uses TWO shapes and they do not overlap:
 *
 *   1. ErrorResponse — `{summary, detail, type?, status_code}`. What the account endpoints and
 *      most failures return.
 *   2. Field errors — the offending FIELD is the key, and the message hangs under it:
 *        {"access_scope": [{"summary": "…", "detail": "…"}], "status_code": 400}
 *        {"institution_id": {"summary": "…", "detail": "…"}, "status_code": 400}
 *      There is no top-level summary or detail at all. Reading only shape 1 makes every
 *      validation error on connect look like an empty body — including the access_scope
 *      refusal the retry ladder depends on, which would then never retry.
 *
 * So both are flattened here: `fields` names which fields complained, and `text` is every
 * summary/detail found anywhere, lowercased, for the narrow prose rules below.
 */
export interface GoCardlessErrorBody {
  summary?: string;
  detail?: string;
  /** Present on the account-endpoint errors, absent on the generic ones. Authoritative when set. */
  type?: string;
  status_code?: number;
  /** Field names carrying a validation error, e.g. ["access_scope"]. */
  fields: string[];
  /** Every summary/detail in the body, lowercased and joined. */
  text: string;
}

/** Keys that are envelope metadata rather than a complaining field. */
const ENVELOPE_KEYS = new Set(["summary", "detail", "type", "status_code"]);

export function parseErrorBody(raw: string | undefined): GoCardlessErrorBody | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;

  const parts: string[] = [];
  const fields: string[] = [];

  const harvest = (value: unknown): void => {
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) harvest(item);
      return;
    }
    if (value && typeof value === "object") {
      const inner = value as Record<string, unknown>;
      if (typeof inner.summary === "string") parts.push(inner.summary);
      if (typeof inner.detail === "string") parts.push(inner.detail);
    }
  };

  for (const [key, value] of Object.entries(rec)) {
    if (ENVELOPE_KEYS.has(key)) {
      if (key === "summary" || key === "detail") harvest(value);
      continue;
    }
    fields.push(key);
    harvest(value);
  }

  return {
    summary: typeof rec.summary === "string" ? rec.summary : undefined,
    detail: typeof rec.detail === "string" ? rec.detail : undefined,
    type: typeof rec.type === "string" ? rec.type : undefined,
    status_code: typeof rec.status_code === "number" ? rec.status_code : undefined,
    fields,
    text: parts.join(" ").toLowerCase(),
  };
}

/**
 * Turn one HTTP failure into the code the caller acts on.
 *
 * ── Why the status alone is not enough ───────────────────────────────────────────────────────
 * The status code and the thing the owner must DO are not the same axis. A 401 is our token
 * having died (support's problem) OR his 90-day consent having lapsed (his problem, one tap to
 * fix). A 403 is our server's IP missing from the portal whitelist (ours) OR the bank refusing a
 * scope (his). Reading only the status sends half of these to the wrong person.
 *
 * ── Why `type` comes first ───────────────────────────────────────────────────────────────────
 * The account endpoints return a machine-readable `type` (RateLimitError, AccessExpiredError,
 * AccountInactiveError, …). Matching on that is exact. Only where the API omits it — the EUA
 * errors carry their meaning in prose — do we fall back to matching the documented summary, and
 * that fallback is deliberately narrow: an unrecognised body keeps whatever the status said, so
 * a future message can never silently turn one of our own bugs into a "reconnect your bank"
 * nudge the owner cannot act on.
 */
export function refineErrorCode(
  fromStatus: GoCardlessErrorCode,
  body: GoCardlessErrorBody | null,
): GoCardlessErrorCode {
  if (!body) return fromStatus;

  // 1. The documented `type` values. Exact, so they win.
  switch (body.type) {
    case "RateLimitError":
      return "RATE_LIMITED";
    case "AccessExpiredError":
      return "CONSENT_EXPIRED";
    case "AccountInactiveError":
      return "ACCOUNT_INACTIVE";
    case "AccountAccessForbidden":
    case "AccountResourceUnavailable":
      return "FORBIDDEN";
    case "UnknownRequestError":
      return "SERVER";
    case "ServiceError":
    case "ConnectionError":
      // The INSTITUTION is unreachable, not GoCardless. Same instruction for the owner
      // ("try later"), and never a reason to mark his connection dead.
      return "SERVER";
  }

  // 2. A complaint about access_scope, named by the field itself. Checked BEFORE the prose
  //    rules because the retry ladder in createAgreement hangs on it, and the message wording
  //    varies across the three documented scope refusals while the field name does not.
  if (body.fields.includes("access_scope")) return "SCOPE_UNSUPPORTED";

  const text = body.text;
  if (!text.trim()) return fromStatus;

  // 3. IPAccessDenied — OURS, on every endpoint. Without this it reads as "the bank refuses",
  //    and the owner reconnects forever against a whitelist only we can change.
  if (text.includes("isn't whitelisted") || text.includes("ip address access denied")) {
    return "IP_NOT_ALLOWED";
  }

  // 4. The End User Agreement errors. These carry NO `type`, and they are the single most
  //    important thing to get right: EUAExpiredError arrives as a 401, so on status alone it
  //    reads as "our credentials broke" and the owner is told to contact support when in fact
  //    one tap on "opnieuw koppelen" fixes it. AccountValidEUAError (403) means the same thing.
  if (text.includes("end user agreement") || text.includes("eua")) {
    if (text.includes("expired") || text.includes("no valid")) return "CONSENT_EXPIRED";
    if (text.includes("access scope") || text.includes("scope")) return "SCOPE_UNSUPPORTED";
  }
  if (text.includes("access has expired") || text.includes("has been revoked")) {
    return "CONSENT_EXPIRED";
  }
  if (text.includes("suspended")) return "ACCOUNT_SUSPENDED";

  // 5. A scope refusal that named itself only in prose.
  if (text.includes("access_scope") || text.includes("access scope")) return "SCOPE_UNSUPPORTED";

  return fromStatus;
}

/**
 * Is this 401 about OUR token, as opposed to the owner's consent?
 *
 * Load-bearing for the token cache. Three of the documented 401s (EUAExpiredError,
 * AccessExpiredError, AccountInactiveError) say nothing about our token — it is perfectly
 * valid. Dropping it on those would make one owner's lapsed consent force a fresh token
 * exchange, and in a cron run over many expired connections that hammers the token endpoint,
 * which has a rate limit of its own. Only a genuine token failure clears the cache.
 */
export function isTokenFailure(body: GoCardlessErrorBody | null): boolean {
  if (!body) return true; // unreadable body on a 401 → assume the token, the safe direction
  if (body.type) return false; // a typed account error is never about the token
  const text = body.text;
  if (!text.trim()) return true;
  if (text.includes("end user agreement") || text.includes("eua")) return false;
  if (text.includes("access has expired") || text.includes("has been revoked")) return false;
  return text.includes("token") || text.includes("no active account found");
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
  /** How many days of history THIS bank exposes. Drives max_historical_days on the agreement.
   *  Asking for more is a hard 400 ("must be > 0 and <= transaction_total_days"), so it is read
   *  from the institution rather than assumed. */
  transactionTotalDays: number | null;
  /** The longest consent THIS bank grants, in days. Many allow 180, not the 90 default — and
   *  that is the difference between the owner re-authorising twice a year or four times. */
  maxAccessValidForDays: number | null;
  logo: string | null;
}

/**
 * The requisition's lifecycle, as the API's own StatusEnum defines it. Spelled out because the
 * callback has to tell three very different situations apart, and a two-letter code in an `if`
 * tells the next reader nothing:
 *
 *   CR  created            — made, the owner has not started at his bank yet
 *   ID  identifying        ─┐
 *   GC  giving consent      │ in flight: the owner is somewhere inside his bank's screens.
 *   UA  undergoing auth     │ Not a failure — he simply is not finished.
 *   SA  selecting accounts  │
 *   GA  granting access    ─┘
 *   LN  linked             — the ONLY status that means the accounts are ours to read
 *   RJ  rejected           — the bank refused (wrong credentials, SSN mismatch)
 *   ER  error              — the attempt broke down at the bank
 *   SU  suspended          — shut down after repeated failures; needs a fresh consent
 *   EX  expired            — the consent window ran out; needs a fresh consent
 */
export const REQUISITION_STATUS = {
  CREATED: "CR",
  LINKED: "LN",
  REJECTED: "RJ",
  ERROR: "ER",
  SUSPENDED: "SU",
  EXPIRED: "EX",
} as const;

/** In-flight statuses: the owner is mid-journey at his bank. Neither success nor failure. */
export const REQUISITION_IN_PROGRESS = ["CR", "ID", "GC", "UA", "SA", "GA"] as const;

/** Statuses that can only be resolved by consenting again — never by retrying the same link. */
export function requisitionNeedsReconnect(status: string): boolean {
  return status === "EX" || status === "SU" || status === "ER";
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
  }): Promise<{
    id: string;
    accessValidForDays: number;
    maxHistoricalDays: number;
    /** The scope the bank actually granted — may be wider than asked, see ACCESS_SCOPE_LADDER. */
    accessScope: string[];
  }>;
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
      const body = parseErrorBody(details);
      // The token endpoint answers 401 AuthenticationFailed on a wrong pair, 403 IPAccessDenied
      // when our server's IP is not whitelisted in the portal, and 429 on its own limit. The
      // 403 must NOT read as "wrong credentials": the secrets are right, the network address
      // is not, and that is a setting only we can change.
      const code: GoCardlessErrorCode =
        res.status >= 500
          ? "SERVER"
          : res.status === 429
            ? "RATE_LIMITED"
            : res.status === 403
              ? refineErrorCode("IP_NOT_ALLOWED", body)
              : "INVALID_CREDENTIALS";
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

    if (!res.ok) {
      const details = await safeText(res);
      const body = parseErrorBody(details);

      // A 401 about OUR TOKEN must drop the cached pair, or every remaining account in this cron
      // run breaks on the same dead token. A 401 about the owner's CONSENT must not: our token
      // is fine, and discarding it would make one lapsed consent force a fresh exchange for
      // everybody behind it.
      if (res.status === 401 && isTokenFailure(body)) {
        TOKEN_CACHE.delete(key);
      }

      const code = refineErrorCode(classifyStatus(res.status), body);
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
      let lastScopeError: GoCardlessError | null = null;

      // Walk the scope ladder — see ACCESS_SCOPE_LADDER for why a fixed list would make some
      // banks unconnectable. Only a SCOPE refusal advances the ladder; any other error is the
      // real answer and is thrown at once rather than retried three times.
      for (const scope of ACCESS_SCOPE_LADDER) {
        try {
          const created = await request<{
            id?: string;
            access_valid_for_days?: number;
            max_historical_days?: number;
            access_scope?: string[];
          }>("POST", "/agreements/enduser/", {
            institution_id: institutionId,
            max_historical_days: maxHistoricalDays,
            access_valid_for_days: accessValidForDays ?? DEFAULT_ACCESS_VALID_FOR_DAYS,
            access_scope: [...scope],
          });
          if (!created?.id) {
            throw new GoCardlessError("VALIDATION", "GoCardless returned no agreement id");
          }
          return {
            id: created.id,
            // Read back what the API GRANTED, not what we asked for: a bank may cap the window
            // lower, and the expiry date we show the owner has to be the real one or his feed
            // dies before the date on his screen.
            accessValidForDays:
              created.access_valid_for_days ?? accessValidForDays ?? DEFAULT_ACCESS_VALID_FOR_DAYS,
            maxHistoricalDays: created.max_historical_days ?? maxHistoricalDays,
            accessScope: created.access_scope ?? [...scope],
          };
        } catch (err) {
          if (err instanceof GoCardlessError && err.code === "SCOPE_UNSUPPORTED") {
            lastScopeError = err;
            continue;
          }
          throw err;
        }
      }
      throw lastScopeError ?? new GoCardlessError("SCOPE_UNSUPPORTED", "No usable access scope");
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
    // Both day counts arrive as STRINGS in this API ("90", "180"), not numbers.
    const num = (v: unknown): number | null => {
      const n = typeof v === "string" ? Number(v) : v;
      return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
    };
    out.push({
      id: rec.id,
      name: typeof rec.name === "string" ? rec.name : rec.id,
      bic: typeof rec.bic === "string" ? rec.bic : null,
      transactionTotalDays: num(rec.transaction_total_days),
      maxAccessValidForDays: num(rec.max_access_valid_for_days),
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
