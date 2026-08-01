// [GOCARDLESS] Pure node test — run: npx tsx --test src/lib/gocardless-client.test.ts
//
// Tests the HTTP side with an injected fetch: no network, no secrets. What is pinned here is
// exactly what goes wrong at a real bank link if you get it wrong — a token fetched again for
// every account in a cron run (the token endpoint has its own limit), a spent daily budget
// presented as a crash instead of "tomorrow we fetch the rest", or an expired consent that
// reads as a validation bug so the owner is never asked to reconnect.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyStatus,
  clearGoCardlessTokenCache,
  createGoCardlessClient,
  dutchGoCardlessError,
  GoCardlessError,
  GOCARDLESS_API_BASE,
  isTokenFailure,
  needsReconnect,
  normalizeBalances,
  normalizeInstitutions,
  normalizeRequisition,
  parseErrorBody,
  pickDisplayBalance,
  refineErrorCode,
  REQUISITION_IN_PROGRESS,
  requisitionNeedsReconnect,
} from "./gocardless-client";

const SECRET_ID = "test-secret-id";
const SECRET_KEY = "test-secret-key";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fake fetch that answers the given responses in order and records every call. */
function fakeFetch(responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const spec = responses[Math.min(i, responses.length - 1)];
    i++;
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const status = spec.status ?? 200;
    const text = JSON.stringify(spec.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h: string) => spec.headers?.[h] ?? null },
      json: async () => JSON.parse(text),
      text: async () => text,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const tokenBody = { access: "access-1", access_expires: 86_400, refresh: "refresh-1", refresh_expires: 2_592_000 };

// ─── credentials + configuration ──────────────────────────────────────────────────────────────

test("a missing credential pair fails as NOT_CONFIGURED, before any request", () => {
  clearGoCardlessTokenCache();
  const { impl, calls } = fakeFetch([{ body: {} }]);
  assert.throws(
    () => createGoCardlessClient({ secretId: "", secretKey: "", fetchImpl: impl }),
    (err: unknown) => err instanceof GoCardlessError && err.code === "NOT_CONFIGURED",
  );
  assert.equal(calls.length, 0, "an unconfigured server must not talk to GoCardless at all");
});

// ─── token handling ───────────────────────────────────────────────────────────────────────────

test("the token is fetched once and reused across calls", async () => {
  clearGoCardlessTokenCache();
  const { impl, calls } = fakeFetch([
    { body: tokenBody },
    { body: [] },
    { body: [] },
  ]);
  const client = createGoCardlessClient({ secretId: SECRET_ID, secretKey: SECRET_KEY, fetchImpl: impl });

  await client.getInstitutions("nl");
  await client.getInstitutions("nl");

  // A cron run that syncs forty accounts must not fetch forty tokens.
  const tokenCalls = calls.filter((c) => c.url.endsWith("/token/new/"));
  assert.equal(tokenCalls.length, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].headers.Authorization, "Bearer access-1");
});

test("an expired access token is refreshed with the refresh token, not re-exchanged", async () => {
  clearGoCardlessTokenCache();
  let clock = 1_000_000;
  const { impl, calls } = fakeFetch([
    { body: tokenBody },
    { body: [] },
    { body: { access: "access-2", access_expires: 86_400 } },
    { body: [] },
  ]);
  const client = createGoCardlessClient({
    secretId: SECRET_ID,
    secretKey: SECRET_KEY,
    fetchImpl: impl,
    now: () => clock,
  });

  await client.getInstitutions("nl");
  clock += 86_400_000; // a day later: access dead, refresh still good
  await client.getInstitutions("nl");

  assert.equal(calls[2].url, `${GOCARDLESS_API_BASE}/token/refresh/`);
  assert.equal(JSON.parse(calls[2].body ?? "{}").refresh, "refresh-1");
  assert.equal(calls[3].headers.Authorization, "Bearer access-2");
  assert.equal(calls.filter((c) => c.url.endsWith("/token/new/")).length, 1);
});

test("a rejected refresh token falls back to a full exchange instead of failing the sync", async () => {
  clearGoCardlessTokenCache();
  let clock = 1_000_000;
  const { impl, calls } = fakeFetch([
    { body: tokenBody },
    { body: [] },
    { status: 401, body: { detail: "invalid refresh" } },
    { body: { access: "access-3", access_expires: 86_400, refresh: "refresh-3" } },
    { body: [] },
  ]);
  const client = createGoCardlessClient({
    secretId: SECRET_ID,
    secretKey: SECRET_KEY,
    fetchImpl: impl,
    now: () => clock,
  });

  await client.getInstitutions("nl");
  clock += 86_400_000;
  await client.getInstitutions("nl");

  assert.equal(calls[3].url, `${GOCARDLESS_API_BASE}/token/new/`);
  assert.equal(calls[4].headers.Authorization, "Bearer access-3");
});

test("a 401 on a normal call drops the cached token so the next account does not reuse a dead one", async () => {
  clearGoCardlessTokenCache();
  const { impl, calls } = fakeFetch([
    { body: tokenBody },
    { status: 401, body: { detail: "Invalid token" } },
    { body: tokenBody },
    { body: [] },
  ]);
  const client = createGoCardlessClient({ secretId: SECRET_ID, secretKey: SECRET_KEY, fetchImpl: impl });

  await assert.rejects(() => client.getInstitutions("nl"));
  await client.getInstitutions("nl");

  assert.equal(calls.filter((c) => c.url.endsWith("/token/new/")).length, 2);
});

test("rejected credentials are INVALID_CREDENTIALS, not a validation error", async () => {
  clearGoCardlessTokenCache();
  const { impl } = fakeFetch([{ status: 401, body: { detail: "Invalid secrets" } }]);
  const client = createGoCardlessClient({ secretId: SECRET_ID, secretKey: SECRET_KEY, fetchImpl: impl });
  await assert.rejects(
    () => client.getInstitutions("nl"),
    (err: unknown) => err instanceof GoCardlessError && err.code === "INVALID_CREDENTIALS",
  );
});

// ─── rate limiting ────────────────────────────────────────────────────────────────────────────

test("a spent daily budget is RATE_LIMITED and carries how long to wait", async () => {
  clearGoCardlessTokenCache();
  const { impl } = fakeFetch([
    { body: tokenBody },
    {
      status: 429,
      body: { detail: "Rate limit exceeded" },
      headers: { "HTTP_X_RATELIMIT_ACCOUNT_SUCCESS_RESET": "43200", "Retry-After": "60" },
    },
  ]);
  const client = createGoCardlessClient({ secretId: SECRET_ID, secretKey: SECRET_KEY, fetchImpl: impl });

  await assert.rejects(
    () => client.getAccountTransactions("acc-1"),
    (err: unknown) => {
      assert.ok(err instanceof GoCardlessError);
      assert.equal(err.code, "RATE_LIMITED");
      // The LARGEST wait wins: retrying after the shorter one just earns another 429.
      assert.equal(err.retryAfterSeconds, 43_200);
      return true;
    },
  );
});

test("the Dutch text for a spent budget reassures rather than alarms", () => {
  // This one reaches the owner on a perfectly healthy connection, so it must not read as a fault.
  const text = dutchGoCardlessError("RATE_LIMITED");
  assert.match(text, /morgen/i);
  assert.doesNotMatch(text, /fout|mislukt/i);
});

// ─── error classification ─────────────────────────────────────────────────────────────────────
//
// Every payload below is copied VERBATIM from the published OpenAPI spec's own examples
// (bankaccountdata.gocardless.com/api/v2/swagger.json). That matters: this whole layer decides
// who is asked to fix a problem — the owner, or us — and a hand-invented error string would
// prove only that the code agrees with my imagination of the API.

/** Reduce a spec example to the code the callers act on, exactly as request() does. */
const codeFor = (status: number, body: unknown) =>
  refineErrorCode(classifyStatus(status), parseErrorBody(JSON.stringify(body)));

test("an expired End User Agreement asks the owner to reconnect — it does NOT read as a broken login", () => {
  // THE bug this file exists to prevent. EUAExpiredError arrives as a 401 and carries no `type`,
  // so on the status alone it is indistinguishable from "our credentials died" — and the owner
  // would be told to contact support when one tap on "opnieuw koppelen" is the actual fix.
  assert.equal(
    codeFor(401, {
      summary: "End User Agreement (EUA) $EUA_ID has expired",
      detail: "EUA was valid for 90 days and it expired at 2026-08-01. The end user must connect the account once more with new EUA and Requisition",
      status_code: 401,
    }),
    "CONSENT_EXPIRED",
  );

  // The typed twin, on the same endpoints.
  assert.equal(
    codeFor(401, {
      summary: "Couldn't update account transactions",
      detail: "Access has expired or it has been revoked. To restore access reconnect the account.",
      type: "AccessExpiredError",
      status_code: 401,
    }),
    "CONSENT_EXPIRED",
  );

  // A 403 saying there is no valid agreement means the same thing to the owner.
  assert.equal(
    codeFor(403, {
      summary: "No valid End User Agreement",
      detail: "Account exists but there is no valid End User Agreement permitting you to access it",
      status_code: 403,
    }),
    "CONSENT_EXPIRED",
  );
});

test("a genuinely dead token still reads as a credentials failure", () => {
  // The other side of the same 401: this one really is ours.
  assert.equal(
    codeFor(401, { summary: "Invalid token", detail: "Token is invalid or expired", status_code: 401 }),
    "INVALID_CREDENTIALS",
  );
});

test("the token cache is only dropped for a token failure, never for a lapsed consent", () => {
  // Load-bearing for the cron: one owner's expired consent must not force a fresh token
  // exchange for every account behind it, because the token endpoint has its own rate limit.
  const tokenDead = parseErrorBody('{"summary":"Invalid token","detail":"Token is invalid or expired"}');
  assert.equal(isTokenFailure(tokenDead), true);

  const consentDead = parseErrorBody(
    '{"summary":"End User Agreement (EUA) x has expired","detail":"EUA was valid for 90 days"}',
  );
  assert.equal(isTokenFailure(consentDead), false);

  const accessDead = parseErrorBody(
    '{"summary":"Couldn\'t update account transactions","detail":"Access has expired or it has been revoked.","type":"AccessExpiredError"}',
  );
  assert.equal(isTokenFailure(accessDead), false);

  // An unreadable body on a 401 falls to the safe side: assume the token and re-fetch it.
  assert.equal(isTokenFailure(null), true);
});

test("the account-level errors are read from `type`, not guessed from prose", () => {
  assert.equal(
    codeFor(429, { summary: "Couldn't update account transactions", detail: "Daily request limit set by the Institution has been exceeded.", type: "RateLimitError" }),
    "RATE_LIMITED",
  );
  assert.equal(
    codeFor(401, { summary: "Couldn't update account balances", detail: "Account has been deactivated or it no longer exists.", type: "AccountInactiveError" }),
    "ACCOUNT_INACTIVE",
  );
  assert.equal(
    codeFor(403, { summary: "Couldn't update account details", detail: "Access to account is forbidden.", type: "AccountAccessForbidden" }),
    "FORBIDDEN",
  );
  // The INSTITUTION is down, not GoCardless — same instruction ("try later"), and never a
  // reason to mark the owner's connection dead.
  assert.equal(
    codeFor(503, { summary: "Couldn't update account transactions", detail: "Institution service unavailable", type: "ServiceError" }),
    "SERVER",
  );
  assert.equal(
    codeFor(503, { summary: "Couldn't update account transactions", detail: "Couldn't connect to Institution", type: "ConnectionError" }),
    "SERVER",
  );
});

test("a suspended account is its own outcome, and needs a new consent", () => {
  assert.equal(
    codeFor(409, {
      summary: "Account suspended",
      detail: "This account or its requisition was suspended due to numerous errors that occurred while accessing it.",
      status_code: 409,
    }),
    "ACCOUNT_SUSPENDED",
  );
});

test("our own misconfigurations are never dressed up as the owner's problem", () => {
  // An un-whitelisted server IP fails EVERY endpoint. Read as a plain 403 it says "the bank
  // refuses", and the owner reconnects forever against a setting only we can change.
  assert.equal(
    codeFor(403, {
      summary: "IP address access denied",
      detail: "Your IP $IP_ADDRESS isn't whitelisted to perform this action",
      status_code: 403,
    }),
    "IP_NOT_ALLOWED",
  );
  // A spent free tier is a 402 on connect. As a generic validation error it reads "the bank
  // refused, try again" — an instruction that can never succeed.
  assert.equal(
    codeFor(402, { summary: "Payment Required", detail: "Free usage limit exceeded", status_code: 402 }),
    "QUOTA_EXCEEDED",
  );
  // Both must say plainly that it is on us.
  for (const code of ["IP_NOT_ALLOWED", "QUOTA_EXCEEDED"] as const) {
    assert.match(dutchGoCardlessError(code), /support/i);
    assert.match(dutchGoCardlessError(code), /uploaden/i, "the owner still has a way forward");
  }
});

test("an access_scope refusal is recognised, so the caller can retry with a narrower scope", () => {
  assert.equal(
    codeFor(400, {
      access_scope: [{ summary: "Institution access scope dependencies error", detail: "For this institution the following scopes are required together: ['balances', 'details']" }],
      summary: "Unsupported access scope selected.",
      detail: "The access scopes supported by the institution are ['transactions'].",
      status_code: 400,
    }),
    "SCOPE_UNSUPPORTED",
  );
});

test("a field-level validation error is read at all — the message hangs under the FIELD, not under summary", () => {
  // The API uses two non-overlapping error shapes. On connect it returns the second one: the
  // offending field is the KEY and there is no top-level summary or detail anywhere. Reading
  // only the ErrorResponse shape makes every one of these look like an empty body — so the
  // scope refusal would never be recognised and the retry ladder would never walk.
  const body = parseErrorBody(JSON.stringify({
    access_scope: [
      { summary: "Institution access scope dependencies error", detail: "For this institution the following scopes are required together: ['balances', 'details']" },
    ],
    status_code: 400,
  }));
  assert.ok(body);
  assert.equal(body.summary, undefined, "there genuinely is no top-level summary");
  assert.deepEqual(body.fields, ["access_scope"]);
  assert.match(body.text, /required together/);

  // And the single-object form, used for institution_id.
  const single = parseErrorBody(JSON.stringify({
    institution_id: { summary: "Unknown Institution ID X", detail: "Get Institution IDs from /institutions/" },
    status_code: 400,
  }));
  assert.deepEqual(single?.fields, ["institution_id"]);
  assert.match(single?.text ?? "", /unknown institution id/);
});

test("an unrecognised body keeps whatever the status said", () => {
  // A real bug of ours must never be promoted into a "reconnect your bank" nudge the owner can
  // do nothing about.
  assert.equal(
    codeFor(400, { summary: "Fields required", detail: "institution_id: This field is required.", status_code: 400 }),
    "VALIDATION",
  );
  assert.equal(refineErrorCode("SERVER", null), "SERVER");
  assert.equal(parseErrorBody("not json at all"), null);
  assert.equal(parseErrorBody(undefined), null);
});

test("classifyStatus maps every status the spec documents", () => {
  assert.equal(classifyStatus(401), "INVALID_CREDENTIALS");
  assert.equal(classifyStatus(402), "QUOTA_EXCEEDED");
  assert.equal(classifyStatus(403), "FORBIDDEN");
  assert.equal(classifyStatus(404), "NOT_FOUND");
  assert.equal(classifyStatus(409), "ACCOUNT_SUSPENDED");
  assert.equal(classifyStatus(429), "RATE_LIMITED");
  assert.equal(classifyStatus(500), "SERVER");
  assert.equal(classifyStatus(503), "SERVER");
  assert.equal(classifyStatus(400), "VALIDATION");
});

test("needsReconnect names exactly the outcomes a new consent fixes", () => {
  // This predicate decides whether the panel offers "Opnieuw koppelen" or a "Ververs" button
  // that could only fail.
  assert.equal(needsReconnect("CONSENT_EXPIRED"), true);
  assert.equal(needsReconnect("ACCOUNT_SUSPENDED"), true);
  assert.equal(needsReconnect("ACCOUNT_INACTIVE"), true);
  assert.equal(needsReconnect("RATE_LIMITED"), false, "tomorrow it works again — nothing to reconnect");
  assert.equal(needsReconnect("SERVER"), false);
  assert.equal(needsReconnect("QUOTA_EXCEEDED"), false, "ours to fix, not his");
});

test("the requisition statuses that only a new consent can resolve", () => {
  // The spec's StatusEnum has eleven values; treating anything but LN as "try again" would
  // leave an owner retrying a link that is permanently dead.
  assert.equal(requisitionNeedsReconnect("EX"), true, "expired");
  assert.equal(requisitionNeedsReconnect("SU"), true, "suspended");
  assert.equal(requisitionNeedsReconnect("ER"), true, "error");
  for (const inFlight of REQUISITION_IN_PROGRESS) {
    assert.equal(requisitionNeedsReconnect(inFlight), false, `${inFlight} is mid-journey, not dead`);
  }
  assert.equal(requisitionNeedsReconnect("LN"), false);
  assert.equal(requisitionNeedsReconnect("RJ"), false, "rejected — retrying the same link CAN work");
});

test("every error code has Dutch text — no owner ever sees an empty message", () => {
  const codes = [
    "NOT_CONFIGURED", "INVALID_CREDENTIALS", "IP_NOT_ALLOWED", "QUOTA_EXCEEDED", "FORBIDDEN",
    "RATE_LIMITED", "CONSENT_EXPIRED", "ACCOUNT_SUSPENDED", "ACCOUNT_INACTIVE",
    "SCOPE_UNSUPPORTED", "VALIDATION", "NOT_FOUND", "SERVER", "NETWORK",
  ] as const;
  for (const code of codes) {
    assert.ok(dutchGoCardlessError(code).length > 10, `${code} has no usable Dutch text`);
  }
});

test("a fetch that never completes is NETWORK, not an unhandled crash", async () => {
  clearGoCardlessTokenCache();
  const impl = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  const client = createGoCardlessClient({ secretId: SECRET_ID, secretKey: SECRET_KEY, fetchImpl: impl });
  await assert.rejects(
    () => client.getInstitutions("nl"),
    (err: unknown) => err instanceof GoCardlessError && err.code === "NETWORK",
  );
});

// ─── request shapes ───────────────────────────────────────────────────────────────────────────

test("an agreement asks only for the access we use, and reads back what was GRANTED", async () => {
  clearGoCardlessTokenCache();
  const { impl, calls } = fakeFetch([
    { body: tokenBody },
    { body: { id: "agr-1", access_valid_for_days: 30, max_historical_days: 180 } },
  ]);
  const client = createGoCardlessClient({ secretId: SECRET_ID, secretKey: SECRET_KEY, fetchImpl: impl });

  const agreement = await client.createAgreement({ institutionId: "ING_INGBNL2A", maxHistoricalDays: 365 });

  const sent = JSON.parse(calls[1].body ?? "{}");
  assert.equal(sent.institution_id, "ING_INGBNL2A");
  assert.equal(sent.max_historical_days, 365);
  assert.equal(sent.access_valid_for_days, 90);
  // NOT balances: nothing in this app reads a saldo, and asking an owner to hand over data we
  // will not use is over-collection.
  assert.deepEqual(sent.access_scope, ["details", "transactions"]);

  // The bank may cap the window lower than we asked. The expiry we show the owner has to be the
  // one the bank granted, or his connection dies before the date on his screen.
  assert.equal(agreement.accessValidForDays, 30);
  assert.equal(agreement.maxHistoricalDays, 180);
});

test("a bank that refuses our scope combination is still connectable", async () => {
  // Without the ladder, an institution whose scopes must be requested together — or which only
  // supports 'transactions' — is IMPOSSIBLE to connect: the owner picks his bank, gets
  // "koppelen mislukt", and no amount of retrying helps.
  clearGoCardlessTokenCache();
  const scopeRefusal = {
    status: 400,
    body: {
      access_scope: [{ summary: "Institution access scope dependencies error", detail: "For this institution the following scopes are required together: ['balances', 'details']" }],
      status_code: 400,
    },
  };
  const { impl, calls } = fakeFetch([
    { body: tokenBody },
    scopeRefusal,                                    // ["details","transactions"] → refused
    { body: { id: "agr-2", access_scope: ["balances", "details", "transactions"] } },
  ]);
  const client = createGoCardlessClient({ secretId: SECRET_ID, secretKey: SECRET_KEY, fetchImpl: impl });

  const agreement = await client.createAgreement({ institutionId: "ODD_BANK", maxHistoricalDays: 90 });

  assert.equal(agreement.id, "agr-2");
  assert.deepEqual(JSON.parse(calls[1].body ?? "{}").access_scope, ["details", "transactions"]);
  assert.deepEqual(JSON.parse(calls[2].body ?? "{}").access_scope, ["balances", "details", "transactions"]);
  // And the granted scope travels back, so nothing downstream assumes what we asked for.
  assert.deepEqual(agreement.accessScope, ["balances", "details", "transactions"]);
});

test("the scope ladder does not retry an error that is not about scope", async () => {
  // A wrong institution id must fail once and say so, not burn three attempts and report a
  // scope problem that does not exist.
  clearGoCardlessTokenCache();
  const { impl, calls } = fakeFetch([
    { body: tokenBody },
    { status: 400, body: { institution_id: { summary: "Unknown Institution ID X" }, summary: "Unknown Institution ID X", detail: "Get Institution IDs from /institutions/", status_code: 400 } },
  ]);
  const client = createGoCardlessClient({ secretId: SECRET_ID, secretKey: SECRET_KEY, fetchImpl: impl });

  await assert.rejects(
    () => client.createAgreement({ institutionId: "NOPE", maxHistoricalDays: 90 }),
    (err: unknown) => err instanceof GoCardlessError && err.code === "VALIDATION",
  );
  assert.equal(calls.length, 2, "one token call, one agreement attempt — no ladder walk");
});

test("a requisition sends the redirect, reference and agreement, and returns the consent link", async () => {
  clearGoCardlessTokenCache();
  const { impl, calls } = fakeFetch([
    { body: tokenBody },
    { body: { id: "req-1", status: "CR", link: "https://ob.gocardless.com/psd2/start/req-1", accounts: [] } },
  ]);
  const client = createGoCardlessClient({ secretId: SECRET_ID, secretKey: SECRET_KEY, fetchImpl: impl });

  const req = await client.createRequisition({
    institutionId: "ING_INGBNL2A",
    redirect: "https://boekbrug.nl/api/bank/gocardless/callback",
    reference: "user-abc:nonce",
    agreementId: "agr-1",
  });

  const sent = JSON.parse(calls[1].body ?? "{}");
  assert.equal(sent.institution_id, "ING_INGBNL2A");
  assert.equal(sent.redirect, "https://boekbrug.nl/api/bank/gocardless/callback");
  assert.equal(sent.reference, "user-abc:nonce");
  assert.equal(sent.agreement, "agr-1");
  assert.equal(sent.user_language, "NL");
  assert.equal(req.link, "https://ob.gocardless.com/psd2/start/req-1");
});

test("transactions are requested for a date window and split into booked and pending", async () => {
  clearGoCardlessTokenCache();
  const { impl, calls } = fakeFetch([
    { body: tokenBody },
    {
      body: {
        transactions: {
          booked: [{ transactionAmount: { amount: "45.00" } }],
          pending: [{ transactionAmount: { amount: "-10.00" } }],
        },
      },
    },
  ]);
  const client = createGoCardlessClient({ secretId: SECRET_ID, secretKey: SECRET_KEY, fetchImpl: impl });

  const txs = await client.getAccountTransactions("acc-1", { dateFrom: "2026-01-01", dateTo: "2026-03-31" });

  assert.match(calls[1].url, /date_from=2026-01-01/);
  assert.match(calls[1].url, /date_to=2026-03-31/);
  assert.equal(txs.booked.length, 1);
  assert.equal(txs.pending.length, 1);
});

test("a transactions body without the expected shape yields empty lists, not a crash", async () => {
  clearGoCardlessTokenCache();
  const { impl } = fakeFetch([{ body: tokenBody }, { body: { transactions: null } }]);
  const client = createGoCardlessClient({ secretId: SECRET_ID, secretKey: SECRET_KEY, fetchImpl: impl });
  const txs = await client.getAccountTransactions("acc-1");
  assert.deepEqual(txs, { booked: [], pending: [] });
});

// ─── normalisation ────────────────────────────────────────────────────────────────────────────

test("institutions keep both day counts the bank publishes — as numbers, not strings", () => {
  // Both arrive as STRINGS in this API ("90", "180"). max_access_valid_for_days is the one that
  // decides whether the owner re-authorises twice a year or four times, so losing it is not
  // cosmetic. Shape copied from the spec's own N26 example.
  const list = normalizeInstitutions([
    {
      id: "N26_NTSBDEB1", name: "N26 Bank", bic: "NTSBDEB1",
      transaction_total_days: "90", max_access_valid_for_days: "180",
      countries: ["NL"], logo: "https://cdn-logos.gocardless.com/ais/N26.png",
    },
    { id: "RABO_RABONL2U", name: "Rabobank" },
    { name: "no id — dropped" },
    "not an object",
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].transactionTotalDays, 90);
  assert.equal(list[0].maxAccessValidForDays, 180);
  assert.equal(list[1].transactionTotalDays, null);
  assert.equal(list[1].maxAccessValidForDays, null);
  assert.equal(list[1].bic, null);
});

test("a requisition with no accounts yet normalises to an empty list, never undefined", () => {
  const req = normalizeRequisition({ id: "req-1", status: "CR", institution_id: "ING_INGBNL2A" });
  assert.deepEqual(req.accounts, []);
  assert.equal(req.link, null);
  // A garbage body must not throw — the callback route reads this before it can know better.
  assert.equal(normalizeRequisition(null).id, "");
});

test("the displayed saldo prefers the booked balance over the available one", () => {
  const balances = normalizeBalances([
    { balanceAmount: { amount: "1500.25", currency: "EUR" }, balanceType: "interimAvailable" },
    { balanceAmount: { amount: "1420.00", currency: "EUR" }, balanceType: "closingBooked", referenceDate: "2026-03-31" },
  ]);
  // Booked is what the transactions add up to; available includes reservations that are not
  // transactions yet, so it would never reconcile against the imported lines.
  assert.equal(pickDisplayBalance(balances)?.amount, 1420);
});

test("an unreadable saldo is null, never NaN", () => {
  const balances = normalizeBalances([{ balanceAmount: { amount: "n/a" }, balanceType: "closingBooked" }]);
  assert.equal(balances[0].amount, null);
  assert.equal(pickDisplayBalance(balances), null);
});
