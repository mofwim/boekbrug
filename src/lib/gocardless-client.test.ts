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
  normalizeBalances,
  normalizeInstitutions,
  normalizeRequisition,
  pickDisplayBalance,
  refineErrorCode,
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

// ─── consent expiry ───────────────────────────────────────────────────────────────────────────

test("an expired consent is told apart from a validation error, so the owner is asked to reconnect", () => {
  // GoCardless answers both with a 4xx; only the body distinguishes them. Getting this wrong
  // leaves the owner with a dead connection and a message he cannot act on.
  assert.equal(
    refineErrorCode("VALIDATION", '{"summary":"Access expired","detail":"End User Agreement expired"}'),
    "CONSENT_EXPIRED",
  );
  assert.equal(
    refineErrorCode("VALIDATION", '{"summary":"Account suspended","detail":"suspended after failures"}'),
    "ACCOUNT_SUSPENDED",
  );
  // An unrecognised body must NOT be promoted — a real bug of ours would otherwise read as
  // "reconnect your bank", which the owner can do nothing about.
  assert.equal(refineErrorCode("VALIDATION", '{"detail":"institution_id is required"}'), "VALIDATION");
  assert.equal(refineErrorCode("SERVER", undefined), "SERVER");
});

test("classifyStatus maps the statuses each caller branches on", () => {
  assert.equal(classifyStatus(401), "INVALID_CREDENTIALS");
  assert.equal(classifyStatus(403), "FORBIDDEN");
  assert.equal(classifyStatus(404), "NOT_FOUND");
  assert.equal(classifyStatus(429), "RATE_LIMITED");
  assert.equal(classifyStatus(500), "SERVER");
  assert.equal(classifyStatus(400), "VALIDATION");
});

test("every error code has Dutch text — no owner ever sees an empty message", () => {
  const codes = [
    "NOT_CONFIGURED", "INVALID_CREDENTIALS", "FORBIDDEN", "RATE_LIMITED",
    "CONSENT_EXPIRED", "ACCOUNT_SUSPENDED", "VALIDATION", "NOT_FOUND", "SERVER", "NETWORK",
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

test("an agreement asks for the three scopes and reads back what was GRANTED", async () => {
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
  assert.deepEqual(sent.access_scope, ["balances", "details", "transactions"]);

  // The bank may cap the window lower than we asked. The expiry we show the owner has to be the
  // one the bank granted, or his connection dies before the date on his screen.
  assert.equal(agreement.accessValidForDays, 30);
  assert.equal(agreement.maxHistoricalDays, 180);
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

test("institutions keep the history window the bank actually offers", () => {
  const list = normalizeInstitutions([
    { id: "ING_INGBNL2A", name: "ING", bic: "INGBNL2A", transaction_total_days: "730", logo: "https://x/l.png" },
    { id: "RABO_RABONL2U", name: "Rabobank" },
    { name: "no id — dropped" },
    "not an object",
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].transactionTotalDays, 730);
  assert.equal(list[1].transactionTotalDays, null);
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
