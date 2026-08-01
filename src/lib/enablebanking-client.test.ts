// [ENABLEBANKING] Pure node test — run: npx tsx --test src/lib/enablebanking-client.test.ts
//
// Two things here are worth more than the rest. The JWT is VERIFIED against a real key pair rather
// than string-matched, because a token that merely looks right is exactly what the vendor's own
// JavaScript sample produces (its base64 helper strips one padding character and never converts to
// base64url, so it fails intermittently depending on the timestamp). And the pagination is driven
// to its end, because dropping a continuation key imports the first page and reports success —
// money missing with nothing to notice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";

import {
  ENABLEBANKING_API_BASE,
  EnableBankingError,
  MAX_TRANSACTION_PAGES,
  classifyStatus,
  clearJwtCache,
  createEnableBankingClient,
  dutchEnableBankingError,
  isEnableBankingConfigured,
  mintJwt,
  needsReconnect,
  normalizePrivateKey,
  readCredentials,
  refineErrorCode,
  shouldBackOffAfter,
} from "./enablebanking-client";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const CREDS = { applicationId: "568a81fa-269d-4d48-9953-715cea47369b", privateKey };

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/** assert.throws does not hand back the error, and the error is the thing under test here. */
function caught(fn: () => unknown): EnableBankingError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof EnableBankingError, `expected an EnableBankingError, got ${String(err)}`);
    return err;
  }
  throw new Error("expected a throw, got none");
}

// ─── the key ──────────────────────────────────────────────────────────────────────────────────

test("a PEM pasted through a single-line environment field is still usable", () => {
  // Vercel and most CI systems store a multi-line secret with literal \n. A key that looks right
  // but was flattened would otherwise fail as a signature error, which reads like a permissions
  // problem and sends you looking in the wrong place entirely.
  const flattened = privateKey.replace(/\n/g, "\\n");
  assert.equal(normalizePrivateKey(flattened), privateKey.trim() + "\n");
  assert.equal(normalizePrivateKey(privateKey), privateKey.trim() + "\n");
});

test("anything that is not a private key is refused before it can be used", () => {
  assert.equal(normalizePrivateKey("not a key"), null);
  assert.equal(normalizePrivateKey("-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----"), null);
  // The public half is a common paste mistake — it is a key, just the wrong one.
  assert.equal(normalizePrivateKey(publicKey), null);
});

test("configuration needs BOTH halves, and says so by staying unconfigured", () => {
  assert.equal(isEnableBankingConfigured({} as unknown as NodeJS.ProcessEnv), false);
  assert.equal(isEnableBankingConfigured({ ENABLEBANKING_APPLICATION_ID: "x" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(
    isEnableBankingConfigured({ ENABLEBANKING_PRIVATE_KEY: privateKey } as unknown as NodeJS.ProcessEnv),
    false,
  );
  assert.equal(
    isEnableBankingConfigured({
      ENABLEBANKING_APPLICATION_ID: "x",
      ENABLEBANKING_PRIVATE_KEY: privateKey,
    } as unknown as NodeJS.ProcessEnv),
    true,
  );
  assert.deepEqual(
    readCredentials({
      ENABLEBANKING_APPLICATION_ID: " x ",
      ENABLEBANKING_PRIVATE_KEY: privateKey,
    } as unknown as NodeJS.ProcessEnv),
    { applicationId: "x", privateKey: privateKey.trim() + "\n" },
  );
});

// ─── the JWT ──────────────────────────────────────────────────────────────────────────────────

test("the minted JWT verifies against the public key and carries the vendor's claims", () => {
  const jwt = mintJwt(CREDS, 1_800_000_000);
  const [header, payload, signature] = jwt.split(".");

  assert.deepEqual(decode(header), {
    typ: "JWT",
    alg: "RS256",
    kid: "568a81fa-269d-4d48-9953-715cea47369b",
  });
  assert.deepEqual(decode(payload), {
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat: 1_800_000_000,
    exp: 1_800_003_600,
  });

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  assert.equal(
    verifier.verify(publicKey, Buffer.from(signature, "base64url")),
    true,
    "the signature must verify — this is the whole credential",
  );
});

test("every segment is base64url, with no padding and no + or /", () => {
  // The vendor's JS sample gets this wrong. A "+" or "/" in a JWT segment is rejected by the API,
  // and only for the timestamps that happen to encode to one — so it fails intermittently.
  for (let i = 0; i < 200; i++) {
    const jwt = mintJwt(CREDS, 1_800_000_000 + i);
    assert.match(jwt, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, `segment ${i} is not base64url`);
  }
});

test("a key that cannot sign fails before any request, as our problem not the owner's", () => {
  const err = caught(() =>
    mintJwt({ applicationId: "x", privateKey: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----\n" }, 1),
  );
  assert.equal(err.code, "INVALID_KEY");
  assert.match(dutchEnableBankingError(err.code), /wij pakken dit op/i);
});

// ─── error classification ─────────────────────────────────────────────────────────────────────

test("a 401 about consent sends the owner to reconnect, a 401 about the key does not", () => {
  // The distinction the GoCardless client had to be corrected for: one of these the owner fixes in
  // a minute, the other he can do nothing about. Getting it backwards wastes his day either way.
  assert.equal(refineErrorCode(classifyStatus(401), "Consent has expired"), "CONSENT_EXPIRED");
  assert.equal(refineErrorCode(classifyStatus(401), "Invalid JWT signature"), "INVALID_KEY");
  assert.equal(refineErrorCode(classifyStatus(401), null), "UNAUTHORIZED");

  assert.equal(needsReconnect("CONSENT_EXPIRED"), true);
  assert.equal(needsReconnect("SESSION_INVALID"), true);
  assert.equal(needsReconnect("INVALID_KEY"), false);
  assert.equal(needsReconnect("RATE_LIMITED"), false);

  assert.match(dutchEnableBankingError("CONSENT_EXPIRED"), /opnieuw/i);
});

test("our own outage does not spend the account's daily read", () => {
  assert.equal(shouldBackOffAfter("SERVER"), false);
  assert.equal(shouldBackOffAfter("NETWORK"), false);
  assert.equal(shouldBackOffAfter("RATE_LIMITED"), true);
  assert.equal(shouldBackOffAfter(null), true);
});

test("status codes map to the code that decides what happens next", () => {
  assert.equal(classifyStatus(403), "FORBIDDEN");
  assert.equal(classifyStatus(404), "NOT_FOUND");
  assert.equal(classifyStatus(422), "VALIDATION");
  assert.equal(classifyStatus(429), "RATE_LIMITED");
  assert.equal(classifyStatus(500), "SERVER");
  assert.equal(classifyStatus(503), "SERVER");
});

// ─── the requests ─────────────────────────────────────────────────────────────────────────────

interface Call { url: string; method: string; headers: Record<string, string>; body: string | undefined }

function stubFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    });
    const next = responses[Math.min(i++, responses.length - 1)];
    return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
      status: next.status ?? 200,
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("every request carries the bearer token, and the token is reused within its hour", () => {
  clearJwtCache();
  const { calls, fetchImpl } = stubFetch([{ body: { aspsps: [] } }]);
  const client = createEnableBankingClient({ credentials: CREDS, fetchImpl, now: () => new Date("2026-08-01T10:00:00Z") });
  return client.listAspsps("NL").then(() => client.listAspsps("NL")).then(() => {
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `${ENABLEBANKING_API_BASE}/aspsps?country=NL`);
    assert.match(calls[0].headers.Authorization, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(calls[0].headers.Authorization, calls[1].headers.Authorization, "one token per hour, not one per call");
  });
});

test("starting an authorisation sends an absolute consent expiry, not a day count", async () => {
  clearJwtCache();
  const { calls, fetchImpl } = stubFetch([{ body: { url: "https://bank.example/authorize?x=1" } }]);
  const client = createEnableBankingClient({
    credentials: CREDS,
    fetchImpl,
    now: () => new Date("2026-08-01T10:00:00Z"),
  });

  const { url } = await client.startAuthorization({
    aspspName: "ING",
    aspspCountry: "NL",
    redirectUrl: "https://boekbrug.nl/api/bank/enablebanking/callback",
    state: "nonce-123",
  });

  assert.equal(url, "https://bank.example/authorize?x=1");
  const body = JSON.parse(calls[0].body!);
  // PSD2 caps this at 90 days, and Enable Banking wants the moment rather than the count.
  assert.equal(body.access.valid_until, "2026-10-30T10:00:00.000Z");
  assert.deepEqual(body.aspsp, { name: "ING", country: "NL" });
  assert.equal(body.state, "nonce-123");
  // A zzp'er's account is a business account; asking as "personal" can get a different consent.
  assert.equal(body.psu_type, "business");
});

test("transactions follow the continuation key to the end", async () => {
  clearJwtCache();
  const { calls, fetchImpl } = stubFetch([
    { body: { transactions: [{ entry_reference: "a" }, { entry_reference: "b" }], continuation_key: "K1" } },
    { body: { transactions: [{ entry_reference: "c" }], continuation_key: "K2" } },
    { body: { transactions: [{ entry_reference: "d" }] } },
  ]);
  const client = createEnableBankingClient({ credentials: CREDS, fetchImpl });

  const txs = await client.getTransactions("acct-uid", { dateFrom: "2026-04-01" });

  assert.equal(txs.length, 4, "all three pages must arrive, not just the first");
  assert.equal(calls.length, 3);
  assert.ok(!calls[0].url.includes("continuation_key"));
  assert.ok(calls[1].url.includes("continuation_key=K1"));
  assert.ok(calls[2].url.includes("continuation_key=K2"));
  assert.ok(calls[0].url.includes("date_from=2026-04-01"));
});

test("a bank that never stops paginating fails loudly instead of looping", async () => {
  clearJwtCache();
  const { fetchImpl } = stubFetch([{ body: { transactions: [{ x: 1 }], continuation_key: "forever" } }]);
  const client = createEnableBankingClient({ credentials: CREDS, fetchImpl });

  const err = (await client
    .getTransactions("acct-uid", { dateFrom: "2026-04-01" })
    .then(() => null, (e) => e)) as EnableBankingError;

  assert.ok(err instanceof EnableBankingError);
  assert.match(err.message, new RegExp(String(MAX_TRANSACTION_PAGES)));
});

test("an error response becomes a typed error carrying the provider's own words", async () => {
  clearJwtCache();
  const { fetchImpl } = stubFetch([{ status: 401, body: "Consent has expired for this session" }]);
  const client = createEnableBankingClient({ credentials: CREDS, fetchImpl });

  const err = (await client.getSession("s-1").then(() => null, (e) => e)) as EnableBankingError;
  assert.equal(err.code, "CONSENT_EXPIRED");
  assert.equal(err.status, 401);
  assert.match(err.detail!, /Consent has expired/);
});

test("an unreachable network is its own code, so it does not cost a daily read", async () => {
  clearJwtCache();
  const fetchImpl = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  const client = createEnableBankingClient({ credentials: CREDS, fetchImpl });

  const err = (await client.getApplication().then(() => null, (e) => e)) as EnableBankingError;
  assert.equal(err.code, "NETWORK");
  assert.equal(shouldBackOffAfter(err.code), false);
});

test("constructing a client without credentials refuses immediately", () => {
  const err = caught(() => createEnableBankingClient({ credentials: null }));
  assert.equal(err.code, "NOT_CONFIGURED");
});
